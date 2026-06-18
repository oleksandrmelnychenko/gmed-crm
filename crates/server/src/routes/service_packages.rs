#![allow(clippy::result_large_err)]

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/service-packages",
            get(list_service_packages).post(create_service_package),
        )
        .route(
            "/service-packages/{package_id}",
            post(update_service_package),
        )
        .route(
            "/patients/{patient_id}/service-packages",
            get(list_patient_service_packages).post(assign_patient_service_package),
        )
        .route(
            "/patients/{patient_id}/service-packages/{patient_service_package_id}/consume",
            post(create_package_consumption),
        )
        .route(
            "/patients/{patient_id}/service-packages/{patient_service_package_id}/overage-approval",
            post(update_overage_approval),
        )
}

#[derive(Deserialize)]
struct ServicePackageItemInput {
    agency_service_id: Option<Uuid>,
    service_key: Option<String>,
    description: String,
    included_quantity: Option<Decimal>,
    unit_label: Option<String>,
    overage_unit_price_net: Option<Decimal>,
    tax_profile_id: Option<Uuid>,
    requires_patient_approval: Option<bool>,
}

#[derive(Deserialize)]
struct UpsertServicePackageRequest {
    package_key: String,
    name: String,
    description: Option<String>,
    currency: Option<String>,
    base_price_net: Option<Decimal>,
    tax_profile_id: Option<Uuid>,
    is_active: Option<bool>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    items: Option<Vec<ServicePackageItemInput>>,
}

#[derive(Deserialize)]
struct AssignPatientPackageRequest {
    package_id: Uuid,
    order_id: Option<Uuid>,
    status: Option<String>,
    starts_on: Option<String>,
    ends_on: Option<String>,
    payer_contact_name: Option<String>,
    payer_contact_email: Option<String>,
    payer_contact_phone: Option<String>,
    payer_contact_relationship: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct CreatePackageConsumptionRequest {
    package_item_id: Option<Uuid>,
    order_id: Option<Uuid>,
    order_leistung_id: Option<Uuid>,
    quantity: Decimal,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdateOverageApprovalRequest {
    package_item_id: Option<Uuid>,
    approval_status: String,
    notes: Option<String>,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error").to_lowercase(),
            "message": message,
        })),
    )
        .into_response()
}

fn can_read_packages(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    )
}

fn can_manage_package_catalog(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn can_manage_patient_packages(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::PatientManager | Role::Billing)
}

fn is_valid_patient_package_status(value: &str) -> bool {
    matches!(
        value,
        "draft" | "active" | "paused" | "completed" | "cancelled"
    )
}

fn is_valid_approval_status(value: &str) -> bool {
    matches!(value, "approved" | "declined")
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::CeoAssistant | Role::Billing) {
        return Ok(());
    }

    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "validate package access");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn normalize_required_key(
    value: &str,
    field: &'static str,
) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase().replace([' ', '-'], "_");
    if normalized.is_empty()
        || normalized.len() > 80
        || !normalized
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} must be a non-empty snake_case key"),
        ));
    }
    Ok(normalized)
}

fn normalize_required_text(
    value: &str,
    field: &'static str,
) -> Result<String, axum::response::Response> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} is required"),
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_optional_date(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveDate>, String> {
    match value {
        Some(raw) if !raw.trim().is_empty() => NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map(Some)
            .map_err(|_| format!("Invalid {field} (YYYY-MM-DD)")),
        _ => Ok(None),
    }
}

async fn tax_profile_rate(
    state: &AppState,
    tax_profile_id: Option<Uuid>,
) -> Result<Decimal, axum::response::Response> {
    let Some(tax_profile_id) = tax_profile_id else {
        return Ok(Decimal::ZERO);
    };

    match sqlx::query_scalar::<_, Decimal>("SELECT vat_rate FROM tax_profiles WHERE id = $1")
        .bind(tax_profile_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(rate)) => Ok(rate),
        Ok(None) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Tax profile not found",
        )),
        Err(e) => {
            tracing::error!(error = %e, tax_profile_id = %tax_profile_id, "load package tax profile");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load tax profile",
            ))
        }
    }
}

fn compute_price_parts(base_price_net: Decimal, vat_rate: Decimal) -> (Decimal, Decimal, Decimal) {
    let net = base_price_net.round_dp(2);
    let vat = (net * vat_rate / Decimal::new(100, 0)).round_dp(2);
    (net, vat, (net + vat).round_dp(2))
}

async fn load_service_package_payloads(
    state: &AppState,
    package_id: Option<Uuid>,
) -> Result<Vec<Value>, axum::response::Response> {
    let package_rows = sqlx::query(
        r#"SELECT sp.id, sp.package_key, sp.name, sp.description, sp.currency,
                  sp.base_price_net, sp.base_price_vat, sp.base_price_gross,
                  sp.tax_profile_id, sp.is_active, sp.valid_from, sp.valid_to,
                  tp.profile_key AS tax_profile_key,
                  tp.name AS tax_profile_name,
                  tp.vat_rate AS tax_profile_vat_rate
           FROM service_packages sp
           LEFT JOIN tax_profiles tp ON tp.id = sp.tax_profile_id
           WHERE ($1::uuid IS NULL OR sp.id = $1)
           ORDER BY sp.is_active DESC, sp.package_key"#,
    )
    .bind(package_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, package_id = ?package_id, "load service packages");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load service packages",
        )
    })?;

    let package_ids = package_rows
        .iter()
        .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
        .collect::<Vec<_>>();
    let mut items_by_package = HashMap::<Uuid, Vec<Value>>::new();

    if !package_ids.is_empty() {
        let item_rows = sqlx::query(
            r#"SELECT spi.id, spi.package_id, spi.agency_service_id, spi.service_key,
                      spi.description, spi.included_quantity, spi.unit_label,
                      spi.overage_unit_price_net, spi.tax_profile_id,
                      spi.requires_patient_approval, spi.sort_order,
                      c.service_name AS agency_service_name,
                      c.unit_price AS agency_service_unit_price,
                      c.currency AS agency_service_currency,
                      c.vat_rate AS agency_service_vat_rate,
                      tp.profile_key AS tax_profile_key,
                      tp.name AS tax_profile_name,
                      tp.vat_rate AS tax_profile_vat_rate
               FROM service_package_items spi
               LEFT JOIN agency_service_catalog c ON c.id = spi.agency_service_id
               LEFT JOIN tax_profiles tp ON tp.id = spi.tax_profile_id
               WHERE spi.package_id = ANY($1)
               ORDER BY spi.sort_order, spi.created_at"#,
        )
        .bind(&package_ids)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "load service package items");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load service package items",
            )
        })?;

        for row in item_rows {
            let package_id = row.try_get::<Uuid, _>("package_id").unwrap_or_default();
            items_by_package.entry(package_id).or_default().push(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "package_id": package_id,
                "agency_service_id": row.try_get::<Option<Uuid>, _>("agency_service_id").unwrap_or_default(),
                "agency_service_name": row.try_get::<Option<String>, _>("agency_service_name").unwrap_or_default(),
                "agency_service_unit_price": row.try_get::<Option<Decimal>, _>("agency_service_unit_price").unwrap_or_default().map(decimal_to_string),
                "agency_service_currency": row.try_get::<Option<String>, _>("agency_service_currency").unwrap_or_default(),
                "agency_service_vat_rate": row.try_get::<Option<Decimal>, _>("agency_service_vat_rate").unwrap_or_default().map(decimal_to_string),
                "service_key": row.try_get::<Option<String>, _>("service_key").unwrap_or_default(),
                "description": row.try_get::<String, _>("description").unwrap_or_default(),
                "included_quantity": decimal_to_string(row.try_get::<Decimal, _>("included_quantity").unwrap_or(Decimal::ZERO)),
                "unit_label": row.try_get::<String, _>("unit_label").unwrap_or_else(|_| "unit".to_string()),
                "overage_unit_price_net": row.try_get::<Option<Decimal>, _>("overage_unit_price_net").unwrap_or_default().map(decimal_to_string),
                "tax_profile_id": row.try_get::<Option<Uuid>, _>("tax_profile_id").unwrap_or_default(),
                "tax_profile_key": row.try_get::<Option<String>, _>("tax_profile_key").unwrap_or_default(),
                "tax_profile_name": row.try_get::<Option<String>, _>("tax_profile_name").unwrap_or_default(),
                "tax_profile_vat_rate": row.try_get::<Option<Decimal>, _>("tax_profile_vat_rate").unwrap_or_default().map(decimal_to_string),
                "requires_patient_approval": row.try_get::<bool, _>("requires_patient_approval").unwrap_or(false),
                "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or(0),
            }));
        }
    }

    Ok(package_rows
        .into_iter()
        .map(|row| {
            let id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            serde_json::json!({
                "id": id,
                "package_key": row.try_get::<String, _>("package_key").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                "base_price_net": decimal_to_string(row.try_get::<Decimal, _>("base_price_net").unwrap_or(Decimal::ZERO)),
                "base_price_vat": decimal_to_string(row.try_get::<Decimal, _>("base_price_vat").unwrap_or(Decimal::ZERO)),
                "base_price_gross": decimal_to_string(row.try_get::<Decimal, _>("base_price_gross").unwrap_or(Decimal::ZERO)),
                "tax_profile_id": row.try_get::<Option<Uuid>, _>("tax_profile_id").unwrap_or_default(),
                "tax_profile_key": row.try_get::<Option<String>, _>("tax_profile_key").unwrap_or_default(),
                "tax_profile_name": row.try_get::<Option<String>, _>("tax_profile_name").unwrap_or_default(),
                "tax_profile_vat_rate": row.try_get::<Option<Decimal>, _>("tax_profile_vat_rate").unwrap_or_default().map(decimal_to_string),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
                "valid_from": row.try_get::<NaiveDate, _>("valid_from").map(|value| value.to_string()).unwrap_or_default(),
                "valid_to": row.try_get::<Option<NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
                "items": items_by_package.remove(&id).unwrap_or_default(),
            })
        })
        .collect())
}

async fn replace_package_items(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    package_id: Uuid,
    items: &[ServicePackageItemInput],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM service_package_items WHERE package_id = $1")
        .bind(package_id)
        .execute(&mut **tx)
        .await?;

    for (index, item) in items.iter().enumerate() {
        let description = item.description.trim();
        let service_key = normalize_optional(item.service_key.as_deref());
        let unit_label =
            normalize_optional(item.unit_label.as_deref()).unwrap_or_else(|| "unit".to_string());
        sqlx::query(
            r#"INSERT INTO service_package_items (
                    package_id, agency_service_id, service_key, description,
                    included_quantity, unit_label, overage_unit_price_net,
                    tax_profile_id, requires_patient_approval, sort_order
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
        )
        .bind(package_id)
        .bind(item.agency_service_id)
        .bind(service_key)
        .bind(description)
        .bind(item.included_quantity.unwrap_or(Decimal::ONE).round_dp(2))
        .bind(unit_label)
        .bind(item.overage_unit_price_net.map(|value| value.round_dp(2)))
        .bind(item.tax_profile_id)
        .bind(item.requires_patient_approval.unwrap_or(false))
        .bind(index as i32)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

fn validate_package_items(
    items: &[ServicePackageItemInput],
) -> Result<(), axum::response::Response> {
    for item in items {
        if item.description.trim().is_empty() {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Package item description is required",
            ));
        }
        if item.included_quantity.unwrap_or(Decimal::ONE) < Decimal::ZERO {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "included_quantity must be non-negative",
            ));
        }
        if item
            .overage_unit_price_net
            .is_some_and(|value| value < Decimal::ZERO)
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "overage_unit_price_net must be non-negative",
            ));
        }
    }
    Ok(())
}

async fn list_service_packages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if !can_read_packages(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match load_service_package_payloads(&state, None).await {
        Ok(packages) => Json(packages).into_response(),
        Err(resp) => resp,
    }
}

async fn create_service_package(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertServicePackageRequest>,
) -> axum::response::Response {
    if !can_manage_package_catalog(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let package_key = match normalize_required_key(&body.package_key, "package_key") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let name = match normalize_required_text(&body.name, "name") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let valid_from = match parse_optional_date(body.valid_from.as_deref(), "valid_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let valid_to = match parse_optional_date(body.valid_to.as_deref(), "valid_to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let items = body.items.unwrap_or_default();
    if let Err(resp) = validate_package_items(&items) {
        return resp;
    }
    let base_price_net = body.base_price_net.unwrap_or(Decimal::ZERO);
    if base_price_net < Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "base_price_net must be non-negative",
        );
    }
    let vat_rate = match tax_profile_rate(&state, body.tax_profile_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let (base_net, base_vat, base_gross) = compute_price_parts(base_price_net, vat_rate);
    let currency =
        normalize_optional(body.currency.as_deref()).unwrap_or_else(|| "EUR".to_string());

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin create service package");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create service package",
            );
        }
    };

    let row = match sqlx::query(
        r#"INSERT INTO service_packages (
                package_key, name, description, currency, base_price_net,
                base_price_vat, base_price_gross, tax_profile_id, is_active,
                valid_from, valid_to, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, CURRENT_DATE), $11, $12, $12)
           RETURNING id"#,
    )
    .bind(package_key)
    .bind(name)
    .bind(normalize_optional(body.description.as_deref()))
    .bind(currency)
    .bind(base_net)
    .bind(base_vat)
    .bind(base_gross)
    .bind(body.tax_profile_id)
    .bind(body.is_active.unwrap_or(true))
    .bind(valid_from)
    .bind(valid_to)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
            return err(StatusCode::CONFLICT, "Service package already exists");
        }
        Err(e) => {
            tracing::error!(error = %e, "create service package");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create service package",
            );
        }
    };
    let package_id = row.try_get::<Uuid, _>("id").unwrap_or_default();

    if let Err(e) = replace_package_items(&mut tx, package_id, &items).await {
        tracing::error!(error = %e, package_id = %package_id, "create service package items");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create service package items",
        );
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, package_id = %package_id, "commit create service package");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create service package",
        );
    }

    match load_service_package_payloads(&state, Some(package_id)).await {
        Ok(mut packages) => (
            StatusCode::CREATED,
            Json(
                packages
                    .pop()
                    .unwrap_or_else(|| serde_json::json!({ "id": package_id })),
            ),
        )
            .into_response(),
        Err(resp) => resp,
    }
}

async fn update_service_package(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(package_id): Path<Uuid>,
    Json(body): Json<UpsertServicePackageRequest>,
) -> axum::response::Response {
    if !can_manage_package_catalog(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let package_key = match normalize_required_key(&body.package_key, "package_key") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let name = match normalize_required_text(&body.name, "name") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let valid_from = match parse_optional_date(body.valid_from.as_deref(), "valid_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let valid_to = match parse_optional_date(body.valid_to.as_deref(), "valid_to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let items = body.items.unwrap_or_default();
    if let Err(resp) = validate_package_items(&items) {
        return resp;
    }
    let base_price_net = body.base_price_net.unwrap_or(Decimal::ZERO);
    if base_price_net < Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "base_price_net must be non-negative",
        );
    }
    let vat_rate = match tax_profile_rate(&state, body.tax_profile_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let (base_net, base_vat, base_gross) = compute_price_parts(base_price_net, vat_rate);
    let currency =
        normalize_optional(body.currency.as_deref()).unwrap_or_else(|| "EUR".to_string());

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, package_id = %package_id, "begin update service package");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update service package",
            );
        }
    };

    let result = match sqlx::query(
        r#"UPDATE service_packages
           SET package_key = $2,
               name = $3,
               description = $4,
               currency = $5,
               base_price_net = $6,
               base_price_vat = $7,
               base_price_gross = $8,
               tax_profile_id = $9,
               is_active = $10,
               valid_from = COALESCE($11, valid_from),
               valid_to = $12,
               updated_by = $13
           WHERE id = $1"#,
    )
    .bind(package_id)
    .bind(package_key)
    .bind(name)
    .bind(normalize_optional(body.description.as_deref()))
    .bind(currency)
    .bind(base_net)
    .bind(base_vat)
    .bind(base_gross)
    .bind(body.tax_profile_id)
    .bind(body.is_active.unwrap_or(true))
    .bind(valid_from)
    .bind(valid_to)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result,
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
            return err(StatusCode::CONFLICT, "Service package already exists");
        }
        Err(e) => {
            tracing::error!(error = %e, package_id = %package_id, "update service package");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update service package",
            );
        }
    };
    if result.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Service package not found");
    }

    if let Err(e) = replace_package_items(&mut tx, package_id, &items).await {
        tracing::error!(error = %e, package_id = %package_id, "update service package items");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update service package items",
        );
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, package_id = %package_id, "commit update service package");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update service package",
        );
    }

    match load_service_package_payloads(&state, Some(package_id)).await {
        Ok(mut packages) => Json(
            packages
                .pop()
                .unwrap_or_else(|| serde_json::json!({ "id": package_id })),
        )
        .into_response(),
        Err(resp) => resp,
    }
}

async fn list_patient_service_packages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_packages(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    match sqlx::query(
        r#"SELECT psp.id, psp.package_id, psp.order_id, sp.name AS package_name, psp.status,
                  psp.starts_on, psp.ends_on, psp.assigned_at, psp.notes,
                  psp.payer_contact_name, psp.payer_contact_relationship,
                  o.order_number,
                  spi.id AS package_item_id, COALESCE(c.service_key, spi.service_key) AS service_key,
                  c.service_name AS agency_service_name, spi.description, spi.included_quantity,
                  spi.unit_label, spi.requires_patient_approval,
                  COALESCE(SUM(spc.quantity), 0) AS used_quantity,
                  COALESCE(SUM(spc.overage_quantity), 0) AS overage_quantity,
                  COALESCE(SUM(spc.overage_quantity) FILTER (WHERE spc.approval_status = 'pending'), 0) AS pending_overage_quantity,
                  COALESCE(SUM(spc.overage_quantity) FILTER (WHERE spc.approval_status = 'approved'), 0) AS approved_overage_quantity,
                  COALESCE(SUM(spc.overage_quantity) FILTER (WHERE spc.approval_status = 'declined'), 0) AS declined_overage_quantity,
                  COUNT(spc.id) FILTER (WHERE spc.approval_status = 'pending') AS pending_consumption_count,
                  MAX(spc.consumed_at) AS latest_consumed_at
           FROM patient_service_packages psp
           JOIN service_packages sp ON sp.id = psp.package_id
           LEFT JOIN orders o ON o.id = psp.order_id
           LEFT JOIN service_package_items spi ON spi.package_id = sp.id
           LEFT JOIN agency_service_catalog c ON c.id = spi.agency_service_id
           LEFT JOIN service_package_consumptions spc
                  ON spc.patient_service_package_id = psp.id
                 AND (spc.package_item_id = spi.id OR (spc.package_item_id IS NULL AND spi.id IS NULL))
           WHERE psp.patient_id = $1
           GROUP BY psp.id, psp.package_id, psp.order_id, sp.name, psp.status,
                    psp.starts_on, psp.ends_on, psp.assigned_at, psp.notes,
                    psp.payer_contact_name, psp.payer_contact_relationship,
                    o.order_number, spi.id, COALESCE(c.service_key, spi.service_key), c.service_name,
                    spi.description, spi.included_quantity,
                    spi.unit_label, spi.requires_patient_approval
           ORDER BY psp.assigned_at DESC, spi.sort_order"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items = rows
                .into_iter()
                .map(|row| {
                    let included = row
                        .try_get::<Decimal, _>("included_quantity")
                        .unwrap_or(Decimal::ZERO);
                    let used = row
                        .try_get::<Decimal, _>("used_quantity")
                        .unwrap_or(Decimal::ZERO);
                    let remaining = (included - used).max(Decimal::ZERO);
                    serde_json::json!({
                        "patient_service_package_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "package_id": row.try_get::<Uuid, _>("package_id").unwrap_or_default(),
                        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
                        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                        "package_name": row.try_get::<String, _>("package_name").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "starts_on": row.try_get::<Option<NaiveDate>, _>("starts_on").unwrap_or_default().map(|value| value.to_string()),
                        "ends_on": row.try_get::<Option<NaiveDate>, _>("ends_on").unwrap_or_default().map(|value| value.to_string()),
                        "assigned_at": row.try_get::<chrono::DateTime<Utc>, _>("assigned_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                        "payer_contact_name": row.try_get::<Option<String>, _>("payer_contact_name").unwrap_or_default(),
                        "payer_contact_relationship": row.try_get::<Option<String>, _>("payer_contact_relationship").unwrap_or_default(),
                        "package_item_id": row.try_get::<Option<Uuid>, _>("package_item_id").unwrap_or_default(),
                        "service_key": row.try_get::<Option<String>, _>("service_key").unwrap_or_default(),
                        "agency_service_name": row.try_get::<Option<String>, _>("agency_service_name").unwrap_or_default(),
                        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                        "included_quantity": decimal_to_string(included),
                        "unit_label": row.try_get::<Option<String>, _>("unit_label").unwrap_or_default(),
                        "used_quantity": decimal_to_string(used),
                        "remaining_quantity": decimal_to_string(remaining),
                        "overage_quantity": decimal_to_string(row.try_get::<Decimal, _>("overage_quantity").unwrap_or(Decimal::ZERO)),
                        "pending_overage_quantity": decimal_to_string(row.try_get::<Decimal, _>("pending_overage_quantity").unwrap_or(Decimal::ZERO)),
                        "approved_overage_quantity": decimal_to_string(row.try_get::<Decimal, _>("approved_overage_quantity").unwrap_or(Decimal::ZERO)),
                        "declined_overage_quantity": decimal_to_string(row.try_get::<Decimal, _>("declined_overage_quantity").unwrap_or(Decimal::ZERO)),
                        "pending_consumption_count": row.try_get::<i64, _>("pending_consumption_count").unwrap_or(0),
                        "latest_consumed_at": row.try_get::<Option<chrono::DateTime<Utc>>, _>("latest_consumed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "requires_patient_approval": row.try_get::<bool, _>("requires_patient_approval").unwrap_or(false),
                    })
                })
                .collect::<Vec<_>>();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient packages");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient service packages",
            )
        }
    }
}

async fn assign_patient_service_package(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<AssignPatientPackageRequest>,
) -> axum::response::Response {
    if !can_manage_patient_packages(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let status = body.status.unwrap_or_else(|| "active".to_string());
    if !is_valid_patient_package_status(&status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid package status");
    }
    let starts_on = match parse_optional_date(body.starts_on.as_deref(), "starts_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let ends_on = match parse_optional_date(body.ends_on.as_deref(), "ends_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if let Some(order_id) = body.order_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1 AND patient_id = $2)",
        )
        .bind(order_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order does not belong to patient",
            );
        }
    }

    match sqlx::query(
        r#"INSERT INTO patient_service_packages (
                patient_id, order_id, package_id, status, starts_on, ends_on,
                payer_contact_name, payer_contact_email, payer_contact_phone,
                payer_contact_relationship, notes, assigned_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(body.order_id)
    .bind(body.package_id)
    .bind(status)
    .bind(starts_on)
    .bind(ends_on)
    .bind(normalize_optional(body.payer_contact_name.as_deref()))
    .bind(normalize_optional(body.payer_contact_email.as_deref()))
    .bind(normalize_optional(body.payer_contact_phone.as_deref()))
    .bind(normalize_optional(
        body.payer_contact_relationship.as_deref(),
    ))
    .bind(normalize_optional(body.notes.as_deref()))
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => Json(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "patient_id": patient_id,
            "package_id": body.package_id,
        }))
        .into_response(),
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23503") => {
            err(StatusCode::UNPROCESSABLE_ENTITY, "Package not found")
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, package_id = %body.package_id, "assign patient package");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to assign patient service package",
            )
        }
    }
}

async fn load_patient_package_context(
    state: &AppState,
    patient_id: Uuid,
    patient_service_package_id: Uuid,
) -> Result<Option<(Uuid, String)>, axum::response::Response> {
    sqlx::query(
        r#"SELECT psp.package_id, psp.status
           FROM patient_service_packages psp
           WHERE psp.id = $1 AND psp.patient_id = $2"#,
    )
    .bind(patient_service_package_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map(|row| {
        row.map(|row| {
            (
                row.try_get::<Uuid, _>("package_id").unwrap_or_default(),
                row.try_get::<String, _>("status").unwrap_or_default(),
            )
        })
    })
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, patient_service_package_id = %patient_service_package_id, "load patient package context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient service package",
        )
    })
}

async fn create_package_consumption(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, patient_service_package_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreatePackageConsumptionRequest>,
) -> axum::response::Response {
    if !can_manage_patient_packages(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    if body.quantity <= Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "quantity must be greater than zero",
        );
    }

    let Some((package_id, package_status)) =
        (match load_patient_package_context(&state, patient_id, patient_service_package_id).await {
            Ok(value) => value,
            Err(resp) => return resp,
        })
    else {
        return err(StatusCode::NOT_FOUND, "Patient service package not found");
    };
    if !matches!(package_status.as_str(), "active" | "draft") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Package is not active for consumption",
        );
    }

    let item_context = if let Some(package_item_id) = body.package_item_id {
        match sqlx::query(
            r#"SELECT id, included_quantity, requires_patient_approval
               FROM service_package_items
               WHERE id = $1 AND package_id = $2"#,
        )
        .bind(package_item_id)
        .bind(package_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(row)) => Some((
                row.try_get::<Uuid, _>("id").unwrap_or_default(),
                row.try_get::<Decimal, _>("included_quantity")
                    .unwrap_or(Decimal::ZERO),
                row.try_get::<bool, _>("requires_patient_approval")
                    .unwrap_or(false),
            )),
            Ok(None) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Package item not found"),
            Err(e) => {
                tracing::error!(error = %e, package_item_id = %package_item_id, "load package item");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load package item",
                );
            }
        }
    } else {
        None
    };

    if let Some(order_id) = body.order_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1 AND patient_id = $2)",
        )
        .bind(order_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order does not belong to patient",
            );
        }
    }
    if let Some(order_leistung_id) = body.order_leistung_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                SELECT 1
                FROM order_leistungen ol
                JOIN orders o ON o.id = ol.order_id
                WHERE ol.id = $1
                  AND o.patient_id = $2
                  AND ($3::uuid IS NULL OR ol.order_id = $3)
            )"#,
        )
        .bind(order_leistung_id)
        .bind(patient_id)
        .bind(body.order_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order service does not belong to patient/order",
            );
        }
    }

    let included_quantity = item_context
        .map(|(_, included, _)| included)
        .unwrap_or(Decimal::ZERO);
    let item_requires_approval = item_context
        .map(|(_, _, requires)| requires)
        .unwrap_or(false);
    let package_item_id = item_context.map(|(id, _, _)| id);
    let used_quantity = match sqlx::query_scalar::<_, Decimal>(
        r#"SELECT COALESCE(SUM(quantity), 0)
           FROM service_package_consumptions
           WHERE patient_service_package_id = $1
             AND (
                    ($2::uuid IS NULL AND package_item_id IS NULL)
                 OR package_item_id = $2
             )
             AND approval_status <> 'declined'"#,
    )
    .bind(patient_service_package_id)
    .bind(package_item_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_service_package_id = %patient_service_package_id, "load package used quantity");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load package consumption",
            );
        }
    };
    let remaining_quantity = (included_quantity - used_quantity).max(Decimal::ZERO);
    let overage_quantity = (body.quantity - remaining_quantity).max(Decimal::ZERO);
    let requires_patient_approval = item_requires_approval || overage_quantity > Decimal::ZERO;
    let approval_status = if requires_patient_approval {
        "pending"
    } else {
        "not_required"
    };

    match sqlx::query(
        r#"INSERT INTO service_package_consumptions (
                patient_service_package_id, package_item_id, order_id, order_leistung_id,
                quantity, overage_quantity, requires_patient_approval,
                approval_status, notes, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, consumed_at"#,
    )
    .bind(patient_service_package_id)
    .bind(package_item_id)
    .bind(body.order_id)
    .bind(body.order_leistung_id)
    .bind(body.quantity.round_dp(2))
    .bind(overage_quantity.round_dp(2))
    .bind(requires_patient_approval)
    .bind(approval_status)
    .bind(normalize_optional(body.notes.as_deref()))
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => Json(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "patient_service_package_id": patient_service_package_id,
            "package_item_id": package_item_id,
            "quantity": decimal_to_string(body.quantity),
            "overage_quantity": decimal_to_string(overage_quantity),
            "requires_patient_approval": requires_patient_approval,
            "approval_status": approval_status,
            "consumed_at": row.try_get::<chrono::DateTime<Utc>, _>("consumed_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        }))
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_service_package_id = %patient_service_package_id, "create package consumption");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record package consumption",
            )
        }
    }
}

async fn update_overage_approval(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, patient_service_package_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateOverageApprovalRequest>,
) -> axum::response::Response {
    if !matches!(auth.role, Role::Ceo | Role::Billing) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if !is_valid_approval_status(&body.approval_status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid approval_status");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    let Some((package_id, _)) =
        (match load_patient_package_context(&state, patient_id, patient_service_package_id).await {
            Ok(value) => value,
            Err(resp) => return resp,
        })
    else {
        return err(StatusCode::NOT_FOUND, "Patient service package not found");
    };
    if let Some(package_item_id) = body.package_item_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM service_package_items WHERE id = $1 AND package_id = $2)",
        )
        .bind(package_item_id)
        .bind(package_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Package item not found");
        }
    }

    match sqlx::query(
        r#"UPDATE service_package_consumptions
           SET approval_status = $3,
               notes = COALESCE($4, notes)
           WHERE patient_service_package_id = $1
             AND (
                    ($2::uuid IS NULL AND package_item_id IS NULL)
                 OR package_item_id = $2
             )
             AND overage_quantity > 0
             AND approval_status = 'pending'"#,
    )
    .bind(patient_service_package_id)
    .bind(body.package_item_id)
    .bind(body.approval_status.clone())
    .bind(normalize_optional(body.notes.as_deref()))
    .execute(&state.db)
    .await
    {
        Ok(result) => Json(serde_json::json!({
            "patient_service_package_id": patient_service_package_id,
            "package_item_id": body.package_item_id,
            "approval_status": body.approval_status,
            "updated_count": result.rows_affected(),
        }))
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_service_package_id = %patient_service_package_id, "update overage approval");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update overage approval",
            )
        }
    }
}
