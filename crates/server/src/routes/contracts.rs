use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/framework-contracts",
            get(list_framework_contracts).post(create_framework_contract),
        )
        .route(
            "/framework-contracts/{contract_id}",
            get(get_framework_contract),
        )
        .route(
            "/framework-contracts/{contract_id}/status",
            post(update_framework_contract_status),
        )
        .route("/quotes", get(list_quotes))
        .route(
            "/orders/{order_id}/quotes",
            get(list_order_quotes).post(create_quote),
        )
        .route("/quotes/{quote_id}", get(get_quote))
        .route("/quotes/{quote_id}/versions", get(list_quote_versions))
        .route("/quotes/{quote_id}/status", post(update_quote_status))
}

#[derive(Deserialize)]
struct ListFrameworkContractsQuery {
    search: Option<String>,
    patient_id: Option<Uuid>,
    status: Option<String>,
}

#[derive(Deserialize)]
struct CreateFrameworkContractRequest {
    patient_id: Uuid,
    signed_at: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    conditions: Option<Value>,
    status: Option<String>,
}

#[derive(Deserialize)]
struct UpdateFrameworkContractStatusRequest {
    status: String,
    signed_at: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    conditions: Option<Value>,
}

#[derive(Deserialize)]
struct ListQuotesQuery {
    search: Option<String>,
    order_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    status: Option<String>,
}

#[derive(Deserialize, Clone)]
struct QuoteLineItemInput {
    description: String,
    quantity: f64,
    unit_price: f64,
    vat_rate: Option<f64>,
    is_cost_passthrough: Option<bool>,
    source_order_leistung_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct CreateQuoteRequest {
    valid_until: Option<String>,
    notes: Option<String>,
    line_items: Option<Vec<QuoteLineItemInput>>,
}

#[derive(Deserialize)]
struct UpdateQuoteStatusRequest {
    status: String,
    paid_amount: Option<f64>,
    notes: Option<String>,
}

#[derive(Serialize, Clone)]
struct QuoteLineItem {
    description: String,
    quantity: String,
    unit_price: String,
    vat_rate: String,
    is_cost_passthrough: bool,
    line_net: String,
    line_vat: String,
    line_gross: String,
    source_order_leistung_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    notes: Option<String>,
}

struct OrderAccessContext {
    patient_id: Uuid,
    contract_id: Option<Uuid>,
    order_number: String,
}

struct QuoteTotals {
    total_net: Decimal,
    total_vat: Decimal,
    total_gross: Decimal,
}

struct QuoteVersionSnapshotInput {
    quote_id: Uuid,
    order_id: Uuid,
    quote_number: String,
    status: String,
    total_net: Decimal,
    total_vat: Decimal,
    total_gross: Decimal,
    valid_until: Option<NaiveDate>,
    paid_amount: Decimal,
    paid_at: Option<DateTime<Utc>>,
    line_items: Value,
    notes: Option<String>,
    change_reason: Option<String>,
    created_by: Uuid,
}

fn is_valid_contract_status(value: &str) -> bool {
    matches!(
        value,
        "draft" | "sent" | "signed" | "expired" | "terminated"
    )
}

fn is_valid_quote_status(value: &str) -> bool {
    matches!(
        value,
        "draft" | "sent" | "accepted" | "rejected" | "expired"
    )
}

fn gen_contract_number(seq: i64) -> String {
    format!("FC-{}-{:04}", Utc::now().format("%Y%m%d"), seq)
}

fn gen_quote_number(seq: i64) -> String {
    format!("KV-{}-{:04}", Utc::now().format("%Y%m%d"), seq)
}

fn parse_optional_date(value: Option<&str>) -> Result<Option<NaiveDate>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| "Invalid date (YYYY-MM-DD)"),
        _ => Ok(None),
    }
}

fn parse_optional_datetime(value: Option<&str>) -> Result<Option<DateTime<Utc>>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => DateTime::parse_from_rfc3339(raw)
            .map(|value| Some(value.with_timezone(&Utc)))
            .map_err(|_| "Invalid datetime (RFC3339)"),
        _ => Ok(None),
    }
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

async fn insert_quote_version_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    snapshot: &QuoteVersionSnapshotInput,
) -> Result<i32, sqlx::Error> {
    sqlx::query("SELECT id FROM quotes WHERE id = $1 FOR UPDATE")
        .bind(snapshot.quote_id)
        .execute(&mut **tx)
        .await?;

    let version_number: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM quote_versions WHERE quote_id = $1",
    )
    .bind(snapshot.quote_id)
    .fetch_one(&mut **tx)
    .await?;

    sqlx::query(
        r#"INSERT INTO quote_versions (
                quote_id, version_number, order_id, quote_number, status,
                total_net, total_vat, total_gross, valid_until, paid_amount, paid_at,
                line_items, notes, change_reason, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11,
                $12, $13, $14, $15
           )"#,
    )
    .bind(snapshot.quote_id)
    .bind(version_number)
    .bind(snapshot.order_id)
    .bind(snapshot.quote_number.as_str())
    .bind(snapshot.status.as_str())
    .bind(snapshot.total_net)
    .bind(snapshot.total_vat)
    .bind(snapshot.total_gross)
    .bind(snapshot.valid_until)
    .bind(snapshot.paid_amount)
    .bind(snapshot.paid_at)
    .bind(snapshot.line_items.clone())
    .bind(snapshot.notes.clone())
    .bind(snapshot.change_reason.clone())
    .bind(snapshot.created_by)
    .execute(&mut **tx)
    .await?;

    Ok(version_number)
}

fn compute_quote_totals(items: &[QuoteLineItem]) -> QuoteTotals {
    let mut total_net = Decimal::ZERO;
    let mut total_vat = Decimal::ZERO;
    let mut total_gross = Decimal::ZERO;

    for item in items {
        total_net += Decimal::from_str_exact(&item.line_net).unwrap_or(Decimal::ZERO);
        total_vat += Decimal::from_str_exact(&item.line_vat).unwrap_or(Decimal::ZERO);
        total_gross += Decimal::from_str_exact(&item.line_gross).unwrap_or(Decimal::ZERO);
    }

    QuoteTotals {
        total_net: total_net.round_dp(2),
        total_vat: total_vat.round_dp(2),
        total_gross: total_gross.round_dp(2),
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message
        })),
    )
        .into_response()
}

fn can_read_contracts(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    )
}

fn can_manage_contracts(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::PatientManager | Role::Billing)
}

async fn can_access_patient(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<bool, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::CeoAssistant | Role::Billing) {
        return Ok(true);
    }

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "validate patient access");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            )
        })
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    match can_access_patient(state, auth, patient_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(resp) => Err(resp),
    }
}

async fn load_contract_patient_id(
    state: &AppState,
    contract_id: Uuid,
) -> Result<Option<Uuid>, axum::response::Response> {
    sqlx::query_scalar("SELECT patient_id FROM framework_contracts WHERE id = $1")
        .bind(contract_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, contract_id = %contract_id, "load contract patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate framework contract",
            )
        })
}

async fn load_contract_detail(
    state: &AppState,
    contract_id: Uuid,
    auth: &AuthUser,
) -> Result<Option<Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT fc.id, fc.patient_id, fc.contract_number, fc.status, fc.signed_at,
                  fc.valid_from, fc.valid_to, fc.conditions, fc.created_at, fc.updated_at,
                  p.first_name, p.last_name, p.patient_id AS patient_pid
           FROM framework_contracts fc
           JOIN patients p ON p.id = fc.patient_id
           WHERE fc.id = $1"#,
    )
    .bind(contract_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, contract_id = %contract_id, "load contract detail");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load framework contract",
        )
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    match can_access_patient(state, auth, patient_id).await {
        Ok(true) => {}
        Ok(false) => return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(resp) => return Err(resp),
    }

    Ok(Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "patient_id": patient_id,
        "patient_name": format!(
            "{} {}",
            row.try_get::<String, _>("first_name").unwrap_or_default(),
            row.try_get::<String, _>("last_name").unwrap_or_default()
        ).trim().to_string(),
        "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
        "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "signed_at": row.try_get::<Option<DateTime<Utc>>, _>("signed_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        "valid_from": row.try_get::<Option<NaiveDate>, _>("valid_from").unwrap_or_default().map(|v| v.to_string()),
        "valid_to": row.try_get::<Option<NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
        "conditions": row.try_get::<Option<Value>, _>("conditions").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
    })))
}

async fn list_framework_contracts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListFrameworkContractsQuery>,
) -> axum::response::Response {
    if !can_read_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    if let Some(ref status) = query.status
        && !is_valid_contract_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());

    match sqlx::query(
        r#"SELECT fc.id, fc.patient_id, fc.contract_number, fc.status, fc.signed_at,
                  fc.valid_from, fc.valid_to, fc.conditions, fc.created_at, fc.updated_at,
                  p.first_name, p.last_name, p.patient_id AS patient_pid
           FROM framework_contracts fc
           JOIN patients p ON p.id = fc.patient_id
           WHERE ($1::text = '%%'
                    OR fc.contract_number ILIKE $1
                    OR p.first_name ILIKE $1
                    OR p.last_name ILIKE $1
                    OR p.patient_id ILIKE $1)
             AND ($2::uuid IS NULL OR fc.patient_id = $2)
             AND ($3::text IS NULL OR fc.status = $3)
           ORDER BY fc.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.patient_id)
    .bind(query.status)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
                match can_access_patient(&state, &auth, patient_id).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                items.push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "patient_id": patient_id,
                    "patient_name": format!(
                        "{} {}",
                        row.try_get::<String, _>("first_name").unwrap_or_default(),
                        row.try_get::<String, _>("last_name").unwrap_or_default()
                    ).trim().to_string(),
                    "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
                    "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "signed_at": row.try_get::<Option<DateTime<Utc>>, _>("signed_at").unwrap_or_default().map(|v| v.to_rfc3339()),
                    "valid_from": row.try_get::<Option<NaiveDate>, _>("valid_from").unwrap_or_default().map(|v| v.to_string()),
                    "valid_to": row.try_get::<Option<NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
                    "conditions": row.try_get::<Option<Value>, _>("conditions").unwrap_or_default(),
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list framework contracts");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list framework contracts",
            )
        }
    }
}

async fn create_framework_contract(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateFrameworkContractRequest>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match ensure_patient_access(&state, &auth, body.patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    let status = body.status.unwrap_or_else(|| "draft".to_string());
    if !is_valid_contract_status(&status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let signed_at = match parse_optional_datetime(body.signed_at.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let valid_from = match parse_optional_date(body.valid_from.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let valid_to = match parse_optional_date(body.valid_to.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let seq: i64 = match sqlx::query_scalar("SELECT nextval('contract_number_seq')")
        .fetch_one(&state.db)
        .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "contract sequence");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create contract",
            );
        }
    };

    let contract_number = gen_contract_number(seq);
    let signed_at = if status == "signed" && signed_at.is_none() {
        Some(Utc::now())
    } else {
        signed_at
    };

    match sqlx::query(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, valid_from, valid_to,
                conditions, status, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
           )
           RETURNING id, created_at, updated_at"#,
    )
    .bind(body.patient_id)
    .bind(contract_number.clone())
    .bind(signed_at)
    .bind(valid_from)
    .bind(valid_to)
    .bind(body.conditions.unwrap_or(Value::Null))
    .bind(status.clone())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let contract_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            state.audit_sender.try_send(audit::domain_event(
                "create_framework_contract",
                Some(auth.user_id),
                "framework_contract",
                Some(contract_id),
                serde_json::json!({
                    "contract_number": contract_number,
                    "patient_id": body.patient_id,
                    "status": status,
                }),
            ));

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": contract_id,
                    "contract_number": contract_number,
                    "status": status,
                    "signed_at": signed_at.map(|v| v.to_rfc3339()),
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "create framework contract");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create contract",
            )
        }
    }
}

async fn get_framework_contract(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(contract_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match load_contract_detail(&state, contract_id, &auth).await {
        Ok(Some(body)) => Json(body).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Framework contract not found"),
        Err(resp) => resp,
    }
}

async fn update_framework_contract_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(contract_id): Path<Uuid>,
    Json(body): Json<UpdateFrameworkContractStatusRequest>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    if !is_valid_contract_status(&body.status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let patient_id = match load_contract_patient_id(&state, contract_id).await {
        Ok(Some(patient_id)) => patient_id,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Framework contract not found"),
        Err(resp) => return resp,
    };

    match ensure_patient_access(&state, &auth, patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    let signed_at = match parse_optional_datetime(body.signed_at.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let valid_from = match parse_optional_date(body.valid_from.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let valid_to = match parse_optional_date(body.valid_to.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let signed_at = if body.status == "signed" && signed_at.is_none() {
        Some(Utc::now())
    } else {
        signed_at
    };

    match sqlx::query(
        r#"UPDATE framework_contracts
           SET status = $2,
               signed_at = COALESCE($3, signed_at),
               valid_from = COALESCE($4, valid_from),
               valid_to = COALESCE($5, valid_to),
               conditions = COALESCE($6, conditions)
           WHERE id = $1"#,
    )
    .bind(contract_id)
    .bind(body.status.clone())
    .bind(signed_at)
    .bind(valid_from)
    .bind(valid_to)
    .bind(body.conditions)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "update_framework_contract_status",
                Some(auth.user_id),
                "framework_contract",
                Some(contract_id),
                serde_json::json!({
                    "status": body.status,
                    "signed_at": signed_at.map(|v| v.to_rfc3339()),
                }),
            ));

            match load_contract_detail(&state, contract_id, &auth).await {
                Ok(Some(value)) => Json(value).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Framework contract not found"),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Framework contract not found"),
        Err(e) => {
            tracing::error!(error = %e, "update framework contract");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update framework contract",
            )
        }
    }
}

async fn load_order_access_context(
    state: &AppState,
    order_id: Uuid,
) -> Result<Option<OrderAccessContext>, axum::response::Response> {
    let row = sqlx::query("SELECT patient_id, contract_id, order_number FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, order_id = %order_id, "load order access context");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate order access",
            )
        })?;

    let Some(row) = row else {
        return Ok(None);
    };

    Ok(Some(OrderAccessContext {
        patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        contract_id: row
            .try_get::<Option<Uuid>, _>("contract_id")
            .unwrap_or_default(),
        order_number: row.try_get::<String, _>("order_number").unwrap_or_default(),
    }))
}

fn normalize_custom_line_items(
    items: &[QuoteLineItemInput],
) -> Result<Vec<QuoteLineItem>, &'static str> {
    let mut normalized = Vec::with_capacity(items.len());
    for item in items {
        if item.description.trim().is_empty() {
            return Err("Line item description is required");
        }
        if item.quantity <= 0.0 {
            return Err("Line item quantity must be greater than zero");
        }
        if item.unit_price < 0.0 {
            return Err("Line item unit_price must be non-negative");
        }

        let quantity =
            Decimal::try_from(item.quantity).map_err(|_| "Invalid line item quantity")?;
        let unit_price =
            Decimal::try_from(item.unit_price).map_err(|_| "Invalid line item unit_price")?;
        let is_cost_passthrough = item.is_cost_passthrough.unwrap_or(false);
        let vat_rate = if is_cost_passthrough {
            Decimal::ZERO
        } else {
            Decimal::try_from(item.vat_rate.unwrap_or(19.0))
                .map_err(|_| "Invalid line item vat_rate")?
        };
        let line_net = (quantity * unit_price).round_dp(2);
        let line_vat = (line_net * vat_rate / Decimal::new(100, 0)).round_dp(2);
        let line_gross = (line_net + line_vat).round_dp(2);

        normalized.push(QuoteLineItem {
            description: item.description.trim().to_string(),
            quantity: decimal_to_string(quantity),
            unit_price: decimal_to_string(unit_price),
            vat_rate: decimal_to_string(vat_rate),
            is_cost_passthrough,
            line_net: decimal_to_string(line_net),
            line_vat: decimal_to_string(line_vat),
            line_gross: decimal_to_string(line_gross),
            source_order_leistung_id: item.source_order_leistung_id,
            provider_id: item.provider_id,
            doctor_id: item.doctor_id,
            notes: item.notes.clone(),
        });
    }

    Ok(normalized)
}

async fn load_quote_line_items_from_order(
    state: &AppState,
    order_id: Uuid,
) -> Result<Vec<QuoteLineItem>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, description, quantity, unit_price, vat_rate, is_cost_passthrough,
                  provider_id, doctor_id, notes
           FROM order_leistungen
           WHERE order_id = $1
             AND status <> 'invoiced'
           ORDER BY created_at"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load quote line items");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to prepare quote")
    })?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let quantity = row
            .try_get::<Decimal, _>("quantity")
            .unwrap_or(Decimal::ZERO);
        let unit_price = row
            .try_get::<Decimal, _>("unit_price")
            .unwrap_or(Decimal::ZERO);
        let is_cost_passthrough = row
            .try_get::<bool, _>("is_cost_passthrough")
            .unwrap_or(false);
        let vat_rate = if is_cost_passthrough {
            Decimal::ZERO
        } else {
            row.try_get::<Decimal, _>("vat_rate")
                .unwrap_or(Decimal::ZERO)
        };
        let line_net = (quantity * unit_price).round_dp(2);
        let line_vat = (line_net * vat_rate / Decimal::new(100, 0)).round_dp(2);
        let line_gross = (line_net + line_vat).round_dp(2);

        items.push(QuoteLineItem {
            description: row.try_get::<String, _>("description").unwrap_or_default(),
            quantity: decimal_to_string(quantity),
            unit_price: decimal_to_string(unit_price),
            vat_rate: decimal_to_string(vat_rate),
            is_cost_passthrough,
            line_net: decimal_to_string(line_net),
            line_vat: decimal_to_string(line_vat),
            line_gross: decimal_to_string(line_gross),
            source_order_leistung_id: Some(row.try_get::<Uuid, _>("id").unwrap_or_default()),
            provider_id: row
                .try_get::<Option<Uuid>, _>("provider_id")
                .unwrap_or_default(),
            doctor_id: row
                .try_get::<Option<Uuid>, _>("doctor_id")
                .unwrap_or_default(),
            notes: row
                .try_get::<Option<String>, _>("notes")
                .unwrap_or_default(),
        });
    }

    Ok(items)
}

async fn load_quote_patient_id(
    state: &AppState,
    quote_id: Uuid,
) -> Result<Option<Uuid>, axum::response::Response> {
    sqlx::query_scalar(
        r#"SELECT o.patient_id
           FROM quotes q
           JOIN orders o ON o.id = q.order_id
           WHERE q.id = $1"#,
    )
    .bind(quote_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, quote_id = %quote_id, "load quote patient");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate quote access",
        )
    })
}

async fn load_quote_detail(
    state: &AppState,
    quote_id: Uuid,
    auth: &AuthUser,
) -> Result<Option<Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT q.id, q.order_id, q.quote_number, q.total_net, q.total_vat, q.total_gross,
                  q.status, q.valid_until, q.paid_amount, q.paid_at, q.line_items, q.notes,
                  q.created_at, q.updated_at,
                  COALESCE((SELECT count(*)::bigint FROM quote_versions qv WHERE qv.quote_id = q.id), 0) AS version_count,
                  COALESCE((SELECT max(version_number) FROM quote_versions qv WHERE qv.quote_id = q.id), 0) AS current_version_number,
                  o.patient_id, o.order_number, o.contract_id,
                  p.first_name, p.last_name, p.patient_id AS patient_pid
           FROM quotes q
           JOIN orders o ON o.id = q.order_id
           JOIN patients p ON p.id = o.patient_id
           WHERE q.id = $1"#,
    )
    .bind(quote_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, quote_id = %quote_id, "load quote detail");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load quote")
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    match can_access_patient(state, auth, patient_id).await {
        Ok(true) => {}
        Ok(false) => return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(resp) => return Err(resp),
    }

    Ok(Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
        "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
        "contract_id": row.try_get::<Option<Uuid>, _>("contract_id").unwrap_or_default(),
        "patient_id": patient_id,
        "patient_name": format!(
            "{} {}",
            row.try_get::<String, _>("first_name").unwrap_or_default(),
            row.try_get::<String, _>("last_name").unwrap_or_default()
        ).trim().to_string(),
        "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
        "quote_number": row.try_get::<String, _>("quote_number").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "total_net": decimal_to_string(row.try_get::<Decimal, _>("total_net").unwrap_or(Decimal::ZERO)),
        "total_vat": decimal_to_string(row.try_get::<Decimal, _>("total_vat").unwrap_or(Decimal::ZERO)),
        "total_gross": decimal_to_string(row.try_get::<Decimal, _>("total_gross").unwrap_or(Decimal::ZERO)),
        "valid_until": row.try_get::<Option<NaiveDate>, _>("valid_until").unwrap_or_default().map(|v| v.to_string()),
        "paid_amount": decimal_to_string(row.try_get::<Decimal, _>("paid_amount").unwrap_or(Decimal::ZERO)),
        "paid_at": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        "line_items": row.try_get::<Value, _>("line_items").unwrap_or_else(|_| serde_json::json!([])),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "version_count": row.try_get::<i64, _>("version_count").unwrap_or(0),
        "current_version_number": row.try_get::<i32, _>("current_version_number").unwrap_or(0),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
    })))
}

async fn list_quotes(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListQuotesQuery>,
) -> axum::response::Response {
    if !can_read_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    if let Some(ref status) = query.status
        && !is_valid_quote_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());

    match sqlx::query(
        r#"SELECT q.id, q.order_id, q.quote_number, q.total_net, q.total_vat, q.total_gross,
                  q.status, q.valid_until, q.paid_amount, q.paid_at, q.notes, q.created_at, q.updated_at,
                  o.patient_id, o.order_number, o.contract_id,
                  p.first_name, p.last_name, p.patient_id AS patient_pid
           FROM quotes q
           JOIN orders o ON o.id = q.order_id
           JOIN patients p ON p.id = o.patient_id
           WHERE ($1::text = '%%'
                    OR q.quote_number ILIKE $1
                    OR o.order_number ILIKE $1
                    OR COALESCE(q.notes, '') ILIKE $1
                    OR p.first_name ILIKE $1
                    OR p.last_name ILIKE $1
                    OR p.patient_id ILIKE $1)
             AND ($2::uuid IS NULL OR q.order_id = $2)
             AND ($3::uuid IS NULL OR o.patient_id = $3)
             AND ($4::text IS NULL OR q.status = $4)
           ORDER BY q.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.order_id)
    .bind(query.patient_id)
    .bind(query.status)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
                match can_access_patient(&state, &auth, patient_id).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                items.push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                    "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                    "contract_id": row.try_get::<Option<Uuid>, _>("contract_id").unwrap_or_default(),
                    "patient_id": patient_id,
                    "patient_name": format!(
                        "{} {}",
                        row.try_get::<String, _>("first_name").unwrap_or_default(),
                        row.try_get::<String, _>("last_name").unwrap_or_default()
                    ).trim().to_string(),
                    "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
                    "quote_number": row.try_get::<String, _>("quote_number").unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "total_net": decimal_to_string(row.try_get::<Decimal, _>("total_net").unwrap_or(Decimal::ZERO)),
                    "total_vat": decimal_to_string(row.try_get::<Decimal, _>("total_vat").unwrap_or(Decimal::ZERO)),
                    "total_gross": decimal_to_string(row.try_get::<Decimal, _>("total_gross").unwrap_or(Decimal::ZERO)),
                    "valid_until": row.try_get::<Option<NaiveDate>, _>("valid_until").unwrap_or_default().map(|v| v.to_string()),
                    "paid_amount": decimal_to_string(row.try_get::<Decimal, _>("paid_amount").unwrap_or(Decimal::ZERO)),
                    "paid_at": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").unwrap_or_default().map(|v| v.to_rfc3339()),
                    "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list quotes");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list quotes")
        }
    }
}

async fn list_order_quotes(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    list_quotes(
        State(state),
        Extension(auth),
        Query(ListQuotesQuery {
            search: None,
            order_id: Some(order_id),
            patient_id: None,
            status: None,
        }),
    )
    .await
}

async fn create_quote(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<CreateQuoteRequest>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let order_ctx = match load_order_access_context(&state, order_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(resp) => return resp,
    };

    match ensure_patient_access(&state, &auth, order_ctx.patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    let valid_until = match parse_optional_date(body.valid_until.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let line_items = match body.line_items {
        Some(items) if !items.is_empty() => match normalize_custom_line_items(&items) {
            Ok(items) => items,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        _ => match load_quote_line_items_from_order(&state, order_id).await {
            Ok(items) if !items.is_empty() => items,
            Ok(_) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "No order services available for quote",
                );
            }
            Err(resp) => return resp,
        },
    };

    let totals = compute_quote_totals(&line_items);
    let seq: i64 = match sqlx::query_scalar("SELECT nextval('quote_number_seq')")
        .fetch_one(&state.db)
        .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "quote sequence");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
        }
    };

    let quote_number = gen_quote_number(seq);
    let line_items_value = match serde_json::to_value(&line_items) {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "serialize quote line items");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
        }
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin quote create transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
        }
    };

    let row = match sqlx::query(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                valid_until, line_items, notes, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9
           )
           RETURNING id, created_at, updated_at"#,
    )
    .bind(order_id)
    .bind(quote_number.clone())
    .bind(totals.total_net)
    .bind(totals.total_vat)
    .bind(totals.total_gross)
    .bind(valid_until)
    .bind(line_items_value.clone())
    .bind(body.notes.clone())
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, "create quote");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
        }
    };

    let quote_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
    let snapshot = QuoteVersionSnapshotInput {
        quote_id,
        order_id,
        quote_number: quote_number.clone(),
        status: "draft".to_string(),
        total_net: totals.total_net,
        total_vat: totals.total_vat,
        total_gross: totals.total_gross,
        valid_until,
        paid_amount: Decimal::ZERO,
        paid_at: None,
        line_items: line_items_value,
        notes: body.notes.clone(),
        change_reason: Some("initial_snapshot".to_string()),
        created_by: auth.user_id,
    };

    if let Err(e) = insert_quote_version_snapshot(&mut tx, &snapshot).await {
        tracing::error!(error = %e, quote_id = %quote_id, "insert initial quote version snapshot");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist quote version",
        );
    }

    if let Err(e) = sqlx::query("UPDATE orders SET total_estimated = $2 WHERE id = $1")
        .bind(order_id)
        .bind(totals.total_gross)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, order_id = %order_id, "update order total_estimated from quote");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
    }

    // TODO(audit-migrate): transactional — coupled to quote creation via
    // `.execute(&mut *tx)`. Migration would break rollback semantics.
    if let Err(e) = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, $2, 'quote', $3, $4)",
    )
    .bind(auth.user_id)
    .bind("create_quote")
    .bind(quote_id)
    .bind(serde_json::json!({
        "quote_number": quote_number,
        "order_id": order_id,
        "order_number": order_ctx.order_number,
        "total_gross": decimal_to_string(totals.total_gross),
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, quote_id = %quote_id, "audit quote creation");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, quote_id = %quote_id, "commit quote create transaction");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
    }

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": quote_id,
            "quote_number": quote_number,
            "order_id": order_id,
            "contract_id": order_ctx.contract_id,
            "patient_id": order_ctx.patient_id,
            "status": "draft",
            "total_net": decimal_to_string(totals.total_net),
            "total_vat": decimal_to_string(totals.total_vat),
            "total_gross": decimal_to_string(totals.total_gross),
            "valid_until": valid_until.map(|v| v.to_string()),
            "line_items": line_items,
            "notes": body.notes,
            "version_count": 1,
            "current_version_number": 1,
            "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn get_quote(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(quote_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match load_quote_detail(&state, quote_id, &auth).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(resp) => resp,
    }
}

async fn list_quote_versions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(quote_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let patient_id = match load_quote_patient_id(&state, quote_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(resp) => return resp,
    };

    match ensure_patient_access(&state, &auth, patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    match sqlx::query(
        r#"SELECT qv.id, qv.version_number, qv.order_id, qv.quote_number, qv.status,
                  qv.total_net, qv.total_vat, qv.total_gross, qv.valid_until, qv.paid_amount,
                  qv.paid_at, qv.line_items, qv.notes, qv.change_reason, qv.created_at,
                  u.name AS created_by_name, u.role AS created_by_role
           FROM quote_versions qv
           JOIN users u ON u.id = qv.created_by
           WHERE qv.quote_id = $1
           ORDER BY qv.version_number DESC, qv.created_at DESC"#,
    )
    .bind(quote_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    let line_items = row
                        .try_get::<Value, _>("line_items")
                        .unwrap_or_else(|_| serde_json::json!([]));
                    let line_item_count = line_items.as_array().map(|items| items.len()).unwrap_or(0);
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "quote_id": quote_id,
                        "version_number": row.try_get::<i32, _>("version_number").unwrap_or(0),
                        "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                        "quote_number": row.try_get::<String, _>("quote_number").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "total_net": decimal_to_string(row.try_get::<Decimal, _>("total_net").unwrap_or(Decimal::ZERO)),
                        "total_vat": decimal_to_string(row.try_get::<Decimal, _>("total_vat").unwrap_or(Decimal::ZERO)),
                        "total_gross": decimal_to_string(row.try_get::<Decimal, _>("total_gross").unwrap_or(Decimal::ZERO)),
                        "valid_until": row.try_get::<Option<NaiveDate>, _>("valid_until").unwrap_or_default().map(|v| v.to_string()),
                        "paid_amount": decimal_to_string(row.try_get::<Decimal, _>("paid_amount").unwrap_or(Decimal::ZERO)),
                        "paid_at": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").unwrap_or_default().map(|v| v.to_rfc3339()),
                        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                        "change_reason": row.try_get::<Option<String>, _>("change_reason").unwrap_or_default(),
                        "line_items": line_items,
                        "line_item_count": line_item_count,
                        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
                        "created_by_role": row.try_get::<String, _>("created_by_role").unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, quote_id = %quote_id, "list quote versions");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list quote versions",
            )
        }
    }
}

async fn update_quote_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(quote_id): Path<Uuid>,
    Json(body): Json<UpdateQuoteStatusRequest>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    if !is_valid_quote_status(&body.status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    if let Some(value) = body.paid_amount
        && value < 0.0
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid paid_amount");
    }

    let patient_id = match load_quote_patient_id(&state, quote_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(resp) => return resp,
    };

    match ensure_patient_access(&state, &auth, patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    let paid_amount = body
        .paid_amount
        .and_then(|value| Decimal::try_from(value).ok());
    let paid_at = match paid_amount {
        Some(value) if value > Decimal::ZERO => Some(Utc::now()),
        _ => None,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin quote status update transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update quote");
        }
    };

    let updated_row = match sqlx::query(
        r#"UPDATE quotes
           SET status = $2,
               paid_amount = COALESCE($3, paid_amount),
               paid_at = CASE
                   WHEN $3::numeric IS NOT NULL AND $3 > 0 THEN COALESCE($4, paid_at, now())
                   WHEN $3::numeric IS NOT NULL AND $3 = 0 THEN NULL
                   ELSE paid_at
               END,
               notes = COALESCE($5, notes)
           WHERE id = $1
           RETURNING order_id, quote_number, status, total_net, total_vat, total_gross,
                     valid_until, paid_amount, paid_at, line_items, notes"#,
    )
    .bind(quote_id)
    .bind(body.status.clone())
    .bind(paid_amount)
    .bind(paid_at)
    .bind(body.notes.clone())
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(e) => {
            tracing::error!(error = %e, quote_id = %quote_id, "update quote status");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update quote");
        }
    };

    let snapshot = QuoteVersionSnapshotInput {
        quote_id,
        order_id: updated_row
            .try_get::<Uuid, _>("order_id")
            .unwrap_or_default(),
        quote_number: updated_row
            .try_get::<String, _>("quote_number")
            .unwrap_or_default(),
        status: updated_row
            .try_get::<String, _>("status")
            .unwrap_or_default(),
        total_net: updated_row
            .try_get::<Decimal, _>("total_net")
            .unwrap_or(Decimal::ZERO),
        total_vat: updated_row
            .try_get::<Decimal, _>("total_vat")
            .unwrap_or(Decimal::ZERO),
        total_gross: updated_row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO),
        valid_until: updated_row
            .try_get::<Option<NaiveDate>, _>("valid_until")
            .unwrap_or_default(),
        paid_amount: updated_row
            .try_get::<Decimal, _>("paid_amount")
            .unwrap_or(Decimal::ZERO),
        paid_at: updated_row
            .try_get::<Option<DateTime<Utc>>, _>("paid_at")
            .unwrap_or_default(),
        line_items: updated_row
            .try_get::<Value, _>("line_items")
            .unwrap_or_else(|_| serde_json::json!([])),
        notes: updated_row
            .try_get::<Option<String>, _>("notes")
            .unwrap_or_default(),
        change_reason: Some("status_update".to_string()),
        created_by: auth.user_id,
    };

    if let Err(e) = insert_quote_version_snapshot(&mut tx, &snapshot).await {
        tracing::error!(error = %e, quote_id = %quote_id, "insert quote version snapshot");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist quote version",
        );
    }

    // TODO(audit-migrate): transactional — coupled to quote status update.
    if let Err(e) = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, $2, 'quote', $3, $4)",
    )
    .bind(auth.user_id)
    .bind("update_quote_status")
    .bind(quote_id)
    .bind(serde_json::json!({
        "status": body.status,
        "paid_amount": paid_amount.map(decimal_to_string),
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, quote_id = %quote_id, "audit quote status update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update quote");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, quote_id = %quote_id, "commit quote status update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update quote");
    }

    match load_quote_detail(&state, quote_id, &auth).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(resp) => resp,
    }
}
