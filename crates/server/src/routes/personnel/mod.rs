//! Personnel files (Personalakte / Entgeltunterlagen).
//!
//! From 01.01.2027 every document that proves employment and social
//! insurance is kept digitally, unchanged, promptly and under a
//! self-explaining name (§ 8 BVV). This module keeps one file per employee:
//!
//! * [`documents`]: the append-only archive (upload, versions, download,
//!   legal hold, deletion after the retention period);
//! * [`intake`]: scanned files waiting to be assigned to an employee;
//! * [`profile_import`]: copies of documents from the interpreter profile;
//! * [`completeness`]: which monthly documents are missing or were archived
//!   late, and the monthly reminder;
//! * [`export`]: the ZIP handed to an auditor or the payroll office;
//! * [`integrity`] and [`tsa`]: hash-chain verification and the daily
//!   RFC 3161 time stamp.
//!
//! Only the CEO holds the `personnel.*` capabilities. An employee with a
//! login sees their own file (an ownership check, not a capability).
//! See `docs/personnel-files-plan-2026-09-30_ua.md`.

pub mod completeness;
pub mod documents;
pub mod export;
pub mod intake;
pub mod integrity;
pub mod profile_import;
pub mod tsa;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};
use uuid::Uuid;

use crate::{audit, auth::middleware::AuthUser, routes::documents::MAX_FILE_SIZE, state::AppState};
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/personnel/categories", get(list_categories))
        .route("/personnel/categories/{code}", patch(update_category))
        .route(
            "/personnel/settings",
            get(get_settings).patch(update_settings),
        )
        .route("/personnel/linkable-users", get(list_linkable_users))
        .route(
            "/personnel/employees",
            get(list_employees).post(create_employee),
        )
        .route(
            "/personnel/employees/{employee_id}",
            get(get_employee).patch(update_employee),
        )
        .route(
            "/personnel/employees/{employee_id}/events",
            get(list_employee_events),
        )
        .route(
            "/personnel/employees/{employee_id}/documents",
            post(documents::upload_document),
        )
        .route(
            "/personnel/employees/{employee_id}/profile-documents",
            get(profile_import::list_importable),
        )
        .route(
            "/personnel/employees/{employee_id}/profile-documents/import",
            post(profile_import::import_profile_document),
        )
        .route(
            "/personnel/employees/{employee_id}/file-name",
            get(documents::preview_file_name),
        )
        .route(
            "/personnel/documents/{document_id}/file",
            get(documents::download_document),
        )
        .route(
            "/personnel/documents/{document_id}/legal-hold",
            post(documents::set_legal_hold),
        )
        .route(
            "/personnel/documents/{document_id}/delete",
            post(documents::delete_document),
        )
        .route(
            "/personnel/retention/due",
            get(documents::list_due_for_deletion),
        )
        .route("/personnel/me", get(documents::get_own_file))
        .route(
            "/personnel/intake",
            get(intake::list_intake).post(intake::upload_intake),
        )
        .route(
            "/personnel/intake/{item_id}/file",
            get(intake::download_intake),
        )
        .route(
            "/personnel/intake/{item_id}/archive",
            post(intake::archive_intake),
        )
        .route(
            "/personnel/intake/{item_id}/discard",
            post(intake::discard_intake),
        )
        .route(
            "/personnel/completeness",
            get(completeness::get_completeness),
        )
        .route("/personnel/export", post(export::export_archive))
        .route("/personnel/integrity", get(integrity::get_integrity))
        .route(
            "/personnel/integrity/run",
            post(integrity::run_integrity_check),
        )
        .route("/personnel/integrity/anchor", post(integrity::anchor_now))
        .route(
            "/personnel/integrity/anchors/{anchor_id}/token",
            get(integrity::download_anchor_token),
        )
        .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024))
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

pub(crate) fn err(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

pub(crate) fn internal(error: impl std::fmt::Display, context: &str) -> Response {
    tracing::error!(error = %error, "{context}");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Personnel file request failed",
    )
}

/// Appends one row to the personnel journal through the caller's connection
/// (inside its transaction when it has one).
pub(crate) async fn record_event(
    conn: &mut PgConnection,
    employee_id: Option<Uuid>,
    document_id: Option<Uuid>,
    actor_id: Option<Uuid>,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO personnel_document_events (employee_id, document_id, actor_id, action, details)
           VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(employee_id)
    .bind(document_id)
    .bind(actor_id)
    .bind(action)
    .bind(details)
    .execute(conn)
    .await
    .map(|_| ())
}

/// Journal row outside a transaction; a failure is logged, not returned,
/// because the read it records has already happened.
pub(crate) async fn record_event_logged(
    state: &AppState,
    employee_id: Option<Uuid>,
    document_id: Option<Uuid>,
    actor_id: Option<Uuid>,
    action: &str,
    details: Value,
) {
    let result = match state.db.acquire().await {
        Ok(mut conn) => {
            record_event(
                &mut conn,
                employee_id,
                document_id,
                actor_id,
                action,
                details,
            )
            .await
        }
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        tracing::error!(%error, action, "record personnel event");
    }
}

pub(crate) fn audit_event(
    state: &AppState,
    action: &str,
    actor: Uuid,
    entity_id: Option<Uuid>,
    context: Value,
) {
    state.audit_sender.try_send(audit::domain_event(
        action,
        Some(actor),
        "personnel",
        entity_id,
        context,
    ));
}

async fn setting_text(state: &AppState, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, Value>("SELECT value FROM system_settings WHERE key = $1")
        .bind(key)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .map(|value| match value {
            Value::String(text) => text,
            other => other.to_string(),
        })
}

pub(crate) const DEFAULT_LATE_DAYS: i64 = 7;

/// Days after the end of a month before a document counts as late.
pub(crate) async fn late_days(state: &AppState) -> i64 {
    setting_text(state, "personnel_late_days")
        .await
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|value| (0..=60).contains(value))
        .unwrap_or(DEFAULT_LATE_DAYS)
}

pub(crate) async fn deletion_enabled(state: &AppState) -> bool {
    setting_text(state, "personnel_retention_deletion_enabled")
        .await
        .is_some_and(|value| value.trim() == "true")
}

/// The configured time-stamping authority, if any.
pub(crate) async fn tsa_url(state: &AppState) -> Option<String> {
    setting_text(state, "personnel_tsa_url")
        .await
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Parses `YYYY-MM` into the first day of that month.
pub(crate) fn parse_month(value: &str) -> Option<NaiveDate> {
    let (year, month) = value.trim().split_once('-')?;
    let year = year.parse::<i32>().ok()?;
    let month = month.parse::<u32>().ok()?;
    if !(2000..=2100).contains(&year) {
        return None;
    }
    NaiveDate::from_ymd_opt(year, month, 1)
}

pub(crate) fn format_month(date: NaiveDate) -> String {
    date.format("%Y-%m").to_string()
}

pub(crate) fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok()
}

fn trimmed(value: Option<String>, max: usize) -> Option<String> {
    value
        .map(|value| value.trim().chars().take(max).collect::<String>())
        .filter(|value| !value.is_empty())
}

/// A category row.
#[derive(Debug, Clone)]
pub(crate) struct Category {
    pub code: String,
    pub file_label: String,
    pub monthly: bool,
    pub is_health: bool,
    pub expected_monthly: bool,
    pub retention_years: i32,
    pub retention_from: String,
    pub legal_basis: String,
}

impl Category {
    fn from_row(row: &PgRow) -> Self {
        Self {
            code: row.try_get("code").unwrap_or_default(),
            file_label: row.try_get("file_label").unwrap_or_default(),
            monthly: row.try_get("monthly").unwrap_or(false),
            is_health: row.try_get("is_health").unwrap_or(false),
            expected_monthly: row.try_get("expected_monthly").unwrap_or(false),
            retention_years: row.try_get("retention_years").unwrap_or_default(),
            retention_from: row.try_get("retention_from").unwrap_or_default(),
            legal_basis: row.try_get("legal_basis").unwrap_or_default(),
        }
    }

    pub(crate) fn to_json(&self) -> Value {
        json!({
            "code": self.code,
            "file_label": self.file_label,
            "monthly": self.monthly,
            "is_health": self.is_health,
            "expected_monthly": self.expected_monthly,
            "retention_years": self.retention_years,
            "retention_from": self.retention_from,
            "legal_basis": self.legal_basis,
        })
    }
}

const CATEGORY_COLUMNS: &str = "code, file_label, monthly, is_health, expected_monthly, \
     retention_years, retention_from, legal_basis";

pub(crate) async fn load_categories(state: &AppState) -> Result<Vec<Category>, sqlx::Error> {
    let rows = sqlx::query(&format!(
        "SELECT {CATEGORY_COLUMNS} FROM personnel_document_categories ORDER BY sort_order, code"
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(rows.iter().map(Category::from_row).collect())
}

pub(crate) async fn load_category(
    state: &AppState,
    code: &str,
) -> Result<Option<Category>, sqlx::Error> {
    let row = sqlx::query(&format!(
        "SELECT {CATEGORY_COLUMNS} FROM personnel_document_categories WHERE code = $1"
    ))
    .bind(code.trim())
    .fetch_optional(&state.db)
    .await?;
    Ok(row.as_ref().map(Category::from_row))
}

/// An employee row.
#[derive(Debug, Clone)]
pub(crate) struct Employee {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub salutation: String,
    pub first_name: String,
    pub last_name: String,
    pub personnel_number: Option<String>,
    pub employment_start: Option<NaiveDate>,
    pub employment_end: Option<NaiveDate>,
    pub notes: Option<String>,
    pub user_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Employee {
    fn from_row(row: &PgRow) -> Self {
        Self {
            id: row.try_get("id").unwrap_or_default(),
            user_id: row.try_get("user_id").unwrap_or_default(),
            salutation: row.try_get("salutation").unwrap_or_default(),
            first_name: row.try_get("first_name").unwrap_or_default(),
            last_name: row.try_get("last_name").unwrap_or_default(),
            personnel_number: row.try_get("personnel_number").unwrap_or_default(),
            employment_start: row.try_get("employment_start").unwrap_or_default(),
            employment_end: row.try_get("employment_end").unwrap_or_default(),
            notes: row.try_get("notes").unwrap_or_default(),
            user_name: row.try_get("user_name").unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
            updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
        }
    }

    pub(crate) fn display_name(&self) -> String {
        let name = format!("{} {}", self.first_name.trim(), self.last_name.trim());
        name.trim().to_string()
    }

    pub(crate) fn is_active_on(&self, date: NaiveDate) -> bool {
        self.employment_start.is_none_or(|start| start <= date)
            && self.employment_end.is_none_or(|end| end >= date)
    }

    pub(crate) fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "salutation": self.salutation,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "display_name": self.display_name(),
            "personnel_number": self.personnel_number,
            "employment_start": self.employment_start,
            "employment_end": self.employment_end,
            "is_active": self.is_active_on(crate::app_time::today()),
            "notes": self.notes,
            "created_at": self.created_at.to_rfc3339(),
            "updated_at": self.updated_at.to_rfc3339(),
        })
    }
}

const EMPLOYEE_SELECT: &str = "SELECT e.id, e.user_id, e.salutation, e.first_name, e.last_name, \
     e.personnel_number, e.employment_start, e.employment_end, e.notes, e.created_at, \
     e.updated_at, u.name AS user_name \
     FROM employees e LEFT JOIN users u ON u.id = e.user_id";

pub(crate) async fn load_employee(
    conn: &mut PgConnection,
    employee_id: Uuid,
) -> Result<Option<Employee>, sqlx::Error> {
    let row = sqlx::query(&format!("{EMPLOYEE_SELECT} WHERE e.id = $1"))
        .bind(employee_id)
        .fetch_optional(conn)
        .await?;
    Ok(row.as_ref().map(Employee::from_row))
}

pub(crate) async fn load_employees(state: &AppState) -> Result<Vec<Employee>, sqlx::Error> {
    let rows = sqlx::query(&format!(
        "{EMPLOYEE_SELECT} ORDER BY lower(e.last_name), lower(e.first_name), e.id"
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(rows.iter().map(Employee::from_row).collect())
}

pub(crate) async fn employee_for_user(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<Employee>, sqlx::Error> {
    let row = sqlx::query(&format!("{EMPLOYEE_SELECT} WHERE e.user_id = $1"))
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;
    Ok(row.as_ref().map(Employee::from_row))
}

/// Whether the signed-in user has a personnel file of their own.
pub async fn has_own_file(state: &AppState, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM employees WHERE user_id = $1)")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Categories and settings
// ---------------------------------------------------------------------------

async fn list_categories(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    // Labels are needed by the own-file view too; they carry no personal data.
    if !auth.can(Capability::PersonnelView) && !has_own_file(&state, auth.user_id).await {
        return err(StatusCode::FORBIDDEN, "Forbidden");
    }
    match load_categories(&state).await {
        Ok(categories) => {
            Json(categories.iter().map(Category::to_json).collect::<Vec<_>>()).into_response()
        }
        Err(error) => internal(error, "list personnel categories"),
    }
}

#[derive(Deserialize)]
struct UpdateCategoryRequest {
    retention_years: i32,
}

async fn update_category(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(code): Path<String>,
    Json(body): Json<UpdateCategoryRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelRetention) {
        return response;
    }
    if !(1..=50).contains(&body.retention_years) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Retention must be between 1 and 50 years",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin category update"),
    };
    let previous = match sqlx::query_scalar::<_, i32>(
        "SELECT retention_years FROM personnel_document_categories WHERE code = $1 FOR UPDATE",
    )
    .bind(&code)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Category not found"),
        Err(error) => return internal(error, "load category"),
    };
    if let Err(error) = sqlx::query(
        "UPDATE personnel_document_categories
         SET retention_years = $2, updated_by = $3, updated_at = now()
         WHERE code = $1",
    )
    .bind(&code)
    .bind(body.retention_years)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "update category");
    }
    if let Err(error) = record_event(
        &mut tx,
        None,
        None,
        Some(auth.user_id),
        "category_updated",
        json!({ "code": code, "retention_years": { "old": previous, "new": body.retention_years } }),
    )
    .await
    {
        return internal(error, "record category update");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit category update");
    }
    match load_category(&state, &code).await {
        Ok(Some(category)) => Json(category.to_json()).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Category not found"),
        Err(error) => internal(error, "reload category"),
    }
}

async fn settings_json(state: &AppState) -> Value {
    json!({
        "late_days": late_days(state).await,
        "deletion_enabled": deletion_enabled(state).await,
        "tsa_url": tsa_url(state).await.unwrap_or_default(),
    })
}

async fn get_settings(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    Json(settings_json(&state).await).into_response()
}

#[derive(Deserialize)]
struct UpdateSettingsRequest {
    late_days: Option<i64>,
    deletion_enabled: Option<bool>,
    tsa_url: Option<String>,
}

/// Accepts an empty value (time stamps off) or an absolute http(s) URL.
fn valid_tsa_url(value: &str) -> bool {
    value.is_empty()
        || ((value.starts_with("https://") || value.starts_with("http://"))
            && value.len() <= 500
            && !value.chars().any(char::is_whitespace)
            && reqwest::Url::parse(value).is_ok())
}

async fn update_settings(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpdateSettingsRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelRetention) {
        return response;
    }
    let mut updates: Vec<(&str, Value)> = Vec::new();
    if let Some(days) = body.late_days {
        if !(0..=60).contains(&days) {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Late threshold must be between 0 and 60 days",
            );
        }
        updates.push(("personnel_late_days", json!(days)));
    }
    if let Some(enabled) = body.deletion_enabled {
        updates.push(("personnel_retention_deletion_enabled", json!(enabled)));
    }
    if let Some(url) = body.tsa_url {
        let url = url.trim().to_string();
        if !valid_tsa_url(&url) {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "The time-stamping authority needs an http(s) URL",
            );
        }
        updates.push(("personnel_tsa_url", json!(url)));
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin personnel settings"),
    };
    for (key, value) in &updates {
        if let Err(error) = sqlx::query(
            "UPDATE system_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1",
        )
        .bind(key)
        .bind(value)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        {
            return internal(error, "update personnel setting");
        }
    }
    if !updates.is_empty() {
        let details: serde_json::Map<String, Value> = updates
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect();
        if let Err(error) = record_event(
            &mut tx,
            None,
            None,
            Some(auth.user_id),
            "settings_updated",
            Value::Object(details),
        )
        .await
        {
            return internal(error, "record personnel settings");
        }
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit personnel settings");
    }
    Json(settings_json(&state).await).into_response()
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

/// Active staff accounts that are not linked to a personnel file yet.
async fn list_linkable_users(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelManage) {
        return response;
    }
    match sqlx::query(
        r#"SELECT u.id, u.name, u.email, u.role
           FROM users u
           WHERE u.is_active = true
             AND u.role <> 'patient'
             AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id)
           ORDER BY lower(u.name)"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<Uuid, _>("id").ok(),
                        "name": row.try_get::<String, _>("name").unwrap_or_default(),
                        "email": row.try_get::<String, _>("email").unwrap_or_default(),
                        "role": row.try_get::<String, _>("role").unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => internal(error, "list linkable users"),
    }
}

async fn list_employees(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    let employees = match load_employees(&state).await {
        Ok(value) => value,
        Err(error) => return internal(error, "list employees"),
    };
    let counts = match sqlx::query(
        r#"SELECT employee_id,
                  COUNT(*) FILTER (WHERE deleted_at IS NULL) AS documents,
                  MAX(archived_at) AS last_archived_at
           FROM personnel_documents
           GROUP BY employee_id"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return internal(error, "count personnel documents"),
    };
    let missing = match completeness::missing_for_previous_month(&state).await {
        Ok(value) => value,
        Err(error) => return internal(error, "personnel completeness"),
    };
    let pending_intake = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM personnel_intake_items WHERE status = 'pending'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    let items: Vec<Value> = employees
        .iter()
        .map(|employee| {
            let mut value = employee.to_json();
            let count_row = counts
                .iter()
                .find(|row| row.try_get::<Uuid, _>("employee_id").ok() == Some(employee.id));
            value["document_count"] = json!(
                count_row
                    .and_then(|row| row.try_get::<i64, _>("documents").ok())
                    .unwrap_or(0)
            );
            value["last_archived_at"] = json!(
                count_row
                    .and_then(|row| row
                        .try_get::<Option<DateTime<Utc>>, _>("last_archived_at")
                        .ok()
                        .flatten())
                    .map(|value| value.to_rfc3339())
            );
            value["missing_previous_month"] = json!(
                missing
                    .missing
                    .iter()
                    .filter(|(id, _)| *id == employee.id)
                    .map(|(_, code)| code.clone())
                    .collect::<Vec<_>>()
            );
            value
        })
        .collect();
    Json(json!({
        "employees": items,
        "previous_month": format_month(missing.month),
        "pending_intake": pending_intake,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct EmployeeRequest {
    salutation: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    personnel_number: Option<String>,
    employment_start: Option<String>,
    employment_end: Option<String>,
    user_id: Option<String>,
    notes: Option<String>,
}

/// Validated employee fields. `None` in an optional field of an update means
/// "unchanged"; an empty string clears it.
struct EmployeeFields {
    salutation: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    personnel_number: Option<Option<String>>,
    employment_start: Option<Option<NaiveDate>>,
    employment_end: Option<Option<NaiveDate>>,
    user_id: Option<Option<Uuid>>,
    notes: Option<Option<String>>,
}

#[allow(clippy::result_large_err)]
fn parse_employee_fields(body: EmployeeRequest) -> Result<EmployeeFields, Response> {
    let unprocessable = |message: &str| err(StatusCode::UNPROCESSABLE_ENTITY, message);
    let salutation = match body.salutation.as_deref().map(str::trim) {
        None => None,
        Some(value @ ("frau" | "herr" | "none")) => Some(value.to_string()),
        Some("") => Some("none".to_string()),
        Some(_) => return Err(unprocessable("Unknown salutation")),
    };
    let optional_date =
        |value: Option<String>, label: &str| -> Result<Option<Option<NaiveDate>>, Response> {
            match value {
                None => Ok(None),
                Some(value) if value.trim().is_empty() => Ok(Some(None)),
                Some(value) => parse_date(&value)
                    .map(|date| Some(Some(date)))
                    .ok_or_else(|| unprocessable(&format!("{label} must be a date (YYYY-MM-DD)"))),
            }
        };
    let optional_text = |value: Option<String>, max: usize| -> Option<Option<String>> {
        value.map(|value| trimmed(Some(value), max))
    };
    let user_id = match body.user_id {
        None => None,
        Some(value) if value.trim().is_empty() => Some(None),
        Some(value) => match Uuid::parse_str(value.trim()) {
            Ok(id) => Some(Some(id)),
            Err(_) => return Err(unprocessable("Unknown user")),
        },
    };
    Ok(EmployeeFields {
        salutation,
        first_name: body
            .first_name
            .map(|value| value.trim().chars().take(120).collect()),
        last_name: match body.last_name {
            None => None,
            Some(value) => match trimmed(Some(value), 120) {
                Some(value) => Some(value),
                None => return Err(unprocessable("Last name is required")),
            },
        },
        personnel_number: optional_text(body.personnel_number, 40),
        employment_start: optional_date(body.employment_start, "Employment start")?,
        employment_end: optional_date(body.employment_end, "Employment end")?,
        user_id,
        notes: optional_text(body.notes, 4_000),
    })
}

/// Maps constraint violations of the employees table to client errors.
fn employee_write_error(error: sqlx::Error) -> Response {
    if let sqlx::Error::Database(db_error) = &error {
        match db_error.constraint() {
            Some("uq_employees_personnel_number") => {
                return err(
                    StatusCode::CONFLICT,
                    "This personnel number is already used",
                );
            }
            Some("employees_user_id_key") => {
                return err(
                    StatusCode::CONFLICT,
                    "This user already has a personnel file",
                );
            }
            Some("employees_employment_order") => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Employment end is before its start",
                );
            }
            Some("employees_user_id_fkey") => {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown user");
            }
            _ => {}
        }
    }
    internal(error, "write employee")
}

async fn ensure_linkable_user(state: &AppState, user_id: Uuid) -> Result<(), Response> {
    match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND role <> 'patient')",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only staff accounts can be linked to a personnel file",
        )),
        Err(error) => Err(internal(error, "check linkable user")),
    }
}

async fn create_employee(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<EmployeeRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelManage) {
        return response;
    }
    let fields = match parse_employee_fields(body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(last_name) = fields.last_name.clone() else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Last name is required");
    };
    let user_id = fields.user_id.flatten();
    if let Some(user_id) = user_id
        && let Err(response) = ensure_linkable_user(&state, user_id).await
    {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin employee create"),
    };
    let employee_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO employees (user_id, salutation, first_name, last_name, personnel_number,
                                  employment_start, employment_end, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
           RETURNING id"#,
    )
    .bind(user_id)
    .bind(fields.salutation.as_deref().unwrap_or("none"))
    .bind(fields.first_name.as_deref().unwrap_or(""))
    .bind(&last_name)
    .bind(fields.personnel_number.flatten())
    .bind(fields.employment_start.flatten())
    .bind(fields.employment_end.flatten())
    .bind(fields.notes.flatten())
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(error) => return employee_write_error(error),
    };
    if let Err(error) = record_event(
        &mut tx,
        Some(employee_id),
        None,
        Some(auth.user_id),
        "employee_created",
        json!({ "user_id": user_id }),
    )
    .await
    {
        return internal(error, "record employee create");
    }
    let employee = match load_employee(&mut tx, employee_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Employee not found"),
        Err(error) => return internal(error, "reload employee"),
    };
    if let Err(error) = tx.commit().await {
        return internal(error, "commit employee create");
    }
    audit_event(
        &state,
        "personnel_employee_created",
        auth.user_id,
        Some(employee_id),
        json!({}),
    );
    (StatusCode::CREATED, Json(employee.to_json())).into_response()
}

async fn update_employee(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(employee_id): Path<Uuid>,
    Json(body): Json<EmployeeRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelManage) {
        return response;
    }
    let fields = match parse_employee_fields(body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Some(Some(user_id)) = fields.user_id
        && let Err(response) = ensure_linkable_user(&state, user_id).await
    {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin employee update"),
    };
    let Some(before) = (match load_employee(&mut tx, employee_id).await {
        Ok(value) => value,
        Err(error) => return internal(error, "load employee"),
    }) else {
        return err(StatusCode::NOT_FOUND, "Employee not found");
    };
    let salutation = fields
        .salutation
        .clone()
        .unwrap_or(before.salutation.clone());
    let first_name = fields
        .first_name
        .clone()
        .unwrap_or(before.first_name.clone());
    let last_name = fields.last_name.clone().unwrap_or(before.last_name.clone());
    let personnel_number = fields
        .personnel_number
        .clone()
        .unwrap_or(before.personnel_number.clone());
    let employment_start = fields.employment_start.unwrap_or(before.employment_start);
    let employment_end = fields.employment_end.unwrap_or(before.employment_end);
    let user_id = fields.user_id.unwrap_or(before.user_id);
    let notes = fields.notes.clone().unwrap_or(before.notes.clone());
    if let Err(error) = sqlx::query(
        r#"UPDATE employees
           SET salutation = $2, first_name = $3, last_name = $4, personnel_number = $5,
               employment_start = $6, employment_end = $7, user_id = $8, notes = $9,
               updated_by = $10
           WHERE id = $1"#,
    )
    .bind(employee_id)
    .bind(&salutation)
    .bind(&first_name)
    .bind(&last_name)
    .bind(&personnel_number)
    .bind(employment_start)
    .bind(employment_end)
    .bind(user_id)
    .bind(&notes)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return employee_write_error(error);
    }
    let changes = json!({
        "salutation": [before.salutation, salutation],
        "first_name": [before.first_name, first_name],
        "last_name": [before.last_name, last_name],
        "personnel_number": [before.personnel_number, personnel_number],
        "employment_start": [before.employment_start, employment_start],
        "employment_end": [before.employment_end, employment_end],
        "user_id": [before.user_id, user_id],
    });
    let changed: serde_json::Map<String, Value> = changes
        .as_object()
        .map(|map| {
            map.iter()
                .filter(|(_, pair)| pair[0] != pair[1])
                .map(|(key, pair)| (key.clone(), json!({ "old": pair[0], "new": pair[1] })))
                .collect()
        })
        .unwrap_or_default();
    if !changed.is_empty() || before.notes != notes {
        let mut details = changed;
        if before.notes != notes {
            details.insert("notes".to_string(), json!("changed"));
        }
        if let Err(error) = record_event(
            &mut tx,
            Some(employee_id),
            None,
            Some(auth.user_id),
            "employee_updated",
            Value::Object(details),
        )
        .await
        {
            return internal(error, "record employee update");
        }
    }
    let employee = match load_employee(&mut tx, employee_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Employee not found"),
        Err(error) => return internal(error, "reload employee"),
    };
    if let Err(error) = tx.commit().await {
        return internal(error, "commit employee update");
    }
    audit_event(
        &state,
        "personnel_employee_updated",
        auth.user_id,
        Some(employee_id),
        json!({}),
    );
    Json(employee.to_json()).into_response()
}

async fn get_employee(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(employee_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    let mut conn = match state.db.acquire().await {
        Ok(conn) => conn,
        Err(error) => return internal(error, "acquire connection"),
    };
    let employee = match load_employee(&mut conn, employee_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Employee not found"),
        Err(error) => return internal(error, "load employee"),
    };
    drop(conn);
    let include_health = auth.can(Capability::PersonnelHealthView);
    let late = late_days(&state).await;
    let documents =
        match documents::list_employee_documents(&state, &employee, include_health, true, late)
            .await
        {
            Ok(value) => value,
            Err(error) => return internal(error, "list personnel documents"),
        };
    Json(json!({
        "employee": employee.to_json(),
        "documents": documents,
        "health_hidden": !include_health,
        "late_days": late,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct EventsQuery {
    limit: Option<i64>,
}

async fn list_employee_events(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(employee_id): Path<Uuid>,
    Query(query): Query<EventsQuery>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    let limit = query.limit.unwrap_or(200).clamp(1, 1_000);
    match sqlx::query(
        r#"SELECT ev.id, ev.document_id, ev.action, ev.details, ev.created_at,
                  u.name AS actor_name, d.archive_file_name
           FROM personnel_document_events ev
           LEFT JOIN users u ON u.id = ev.actor_id
           LEFT JOIN personnel_documents d ON d.id = ev.document_id
           WHERE ev.employee_id = $1
           ORDER BY ev.created_at DESC, ev.id DESC
           LIMIT $2"#,
    )
    .bind(employee_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<i64, _>("id").unwrap_or_default(),
                        "document_id": row.try_get::<Option<Uuid>, _>("document_id").unwrap_or_default(),
                        "archive_file_name": row.try_get::<Option<String>, _>("archive_file_name").unwrap_or_default(),
                        "action": row.try_get::<String, _>("action").unwrap_or_default(),
                        "details": row.try_get::<Value, _>("details").unwrap_or(Value::Null),
                        "actor_name": row.try_get::<Option<String>, _>("actor_name").unwrap_or_default(),
                        "created_at": row
                            .try_get::<DateTime<Utc>, _>("created_at")
                            .map(|value| value.to_rfc3339())
                            .unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => internal(error, "list personnel events"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months_parse_and_format() {
        assert_eq!(parse_month("2026-05"), NaiveDate::from_ymd_opt(2026, 5, 1));
        assert_eq!(parse_month(" 2026-5 "), NaiveDate::from_ymd_opt(2026, 5, 1));
        assert_eq!(parse_month("2026-13"), None);
        assert_eq!(parse_month("1999-01"), None);
        assert_eq!(parse_month("May 2026"), None);
        assert_eq!(
            format_month(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()),
            "2026-01"
        );
    }

    #[test]
    fn tsa_urls_must_be_absolute_http() {
        assert!(valid_tsa_url(""));
        assert!(valid_tsa_url("http://timestamp.example.org/tsa"));
        assert!(valid_tsa_url("https://tsa.example.org"));
        assert!(!valid_tsa_url("ftp://tsa.example.org"));
        assert!(!valid_tsa_url("tsa.example.org"));
        assert!(!valid_tsa_url("https://tsa example.org"));
    }

    #[test]
    fn employee_fields_validate_salutation_dates_and_name() {
        let base = || EmployeeRequest {
            salutation: None,
            first_name: None,
            last_name: Some("Muster".into()),
            personnel_number: None,
            employment_start: None,
            employment_end: None,
            user_id: None,
            notes: None,
        };
        assert!(parse_employee_fields(base()).is_ok());
        let mut bad = base();
        bad.salutation = Some("dr".into());
        assert!(parse_employee_fields(bad).is_err());
        let mut bad = base();
        bad.employment_start = Some("01.05.2026".into());
        assert!(parse_employee_fields(bad).is_err());
        let mut bad = base();
        bad.last_name = Some("   ".into());
        assert!(parse_employee_fields(bad).is_err());
        let mut clear = base();
        clear.employment_end = Some(String::new());
        let fields = parse_employee_fields(clear).ok().unwrap();
        assert_eq!(fields.employment_end, Some(None));
    }
}
