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
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/subscriptions", get(list_my_subscriptions))
        .route(
            "/service-packages",
            get(list_service_packages).post(create_service_package),
        )
        .route(
            "/service-packages/{package_id}",
            post(update_service_package),
        )
        .route(
            "/service-packages/{package_id}/price-versions",
            post(create_service_package_price_version),
        )
        .route(
            "/service-packages/{package_id}/price-versions/{price_version_id}",
            post(update_service_package_price_version).delete(delete_service_package_price_version),
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
    id: Option<Uuid>,
    agency_service_id: Option<Uuid>,
    agency_service_price_version_id: Option<Uuid>,
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
struct CreateServicePackagePriceVersionRequest {
    name: String,
    base_price_net: Decimal,
    currency: Option<String>,
    tax_profile_id: Option<Uuid>,
    valid_from: String,
    valid_to: Option<String>,
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
    portal_visible: Option<bool>,
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

struct PackageItemConsumptionContext {
    id: Uuid,
    included_quantity: Decimal,
    requires_patient_approval: bool,
    agency_service_price_version_id: Option<Uuid>,
    unit_price_net: Decimal,
    currency: String,
    vat_rate: Decimal,
    tax_profile_id: Option<Uuid>,
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
        r#"SELECT sp.id, sp.package_key, sp.name, sp.description,
                  COALESCE(current_price.currency, sp.currency) AS currency,
                  COALESCE(current_price.base_price_net, sp.base_price_net) AS base_price_net,
                  COALESCE(current_price.base_price_vat, sp.base_price_vat) AS base_price_vat,
                  COALESCE(current_price.base_price_gross, sp.base_price_gross) AS base_price_gross,
                  CASE
                      WHEN current_price.id IS NOT NULL THEN current_price.tax_profile_id
                      ELSE sp.tax_profile_id
                  END AS tax_profile_id,
                  sp.is_active,
                  COALESCE(current_price.valid_from, sp.valid_from) AS valid_from,
                  CASE
                      WHEN current_price.id IS NOT NULL THEN current_price.valid_to
                      ELSE sp.valid_to
                  END AS valid_to,
                  current_tax.profile_key AS tax_profile_key,
                  current_tax.name AS tax_profile_name,
                  current_tax.vat_rate AS tax_profile_vat_rate,
                  COALESCE((
                      SELECT jsonb_agg(
                          jsonb_build_object(
                              'id', price.id,
                              'name', price.name,
                              'base_price_net', price.base_price_net::TEXT,
                              'base_price_vat', price.base_price_vat::TEXT,
                              'base_price_gross', price.base_price_gross::TEXT,
                              'currency', price.currency,
                              'tax_profile_id', price.tax_profile_id,
                              'tax_profile_key', price_tax.profile_key,
                              'tax_profile_name', price_tax.name,
                              'tax_profile_vat_rate', price_tax.vat_rate::TEXT,
                              'valid_from', price.valid_from,
                              'valid_to', price.valid_to,
                              'created_at', price.created_at
                          ) ORDER BY price.valid_from DESC, price.created_at DESC
                      )
                      FROM service_package_price_versions price
                      LEFT JOIN tax_profiles price_tax ON price_tax.id = price.tax_profile_id
                      WHERE price.package_id = sp.id
                  ), '[]'::jsonb) AS price_versions
           FROM service_packages sp
           LEFT JOIN LATERAL (
               SELECT version.id, version.base_price_net, version.base_price_vat,
                      version.base_price_gross, version.currency, version.tax_profile_id,
                      version.valid_from, version.valid_to
               FROM service_package_price_versions version
               WHERE version.package_id = sp.id
                 AND version.valid_from <= CURRENT_DATE
                 AND (version.valid_to IS NULL OR version.valid_to >= CURRENT_DATE)
               ORDER BY version.valid_from DESC, version.created_at DESC
               LIMIT 1
           ) current_price ON true
           LEFT JOIN tax_profiles current_tax
             ON current_tax.id = CASE
                 WHEN current_price.id IS NOT NULL THEN current_price.tax_profile_id
                 ELSE sp.tax_profile_id
             END
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
            r#"SELECT spi.id, spi.package_id, spi.agency_service_id,
                      spi.agency_service_price_version_id, spi.service_key,
                      spi.description, spi.included_quantity, spi.unit_label,
                      spi.overage_unit_price_net, spi.tax_profile_id,
                      spi.requires_patient_approval, spi.sort_order,
                      c.service_name AS agency_service_name,
                      CASE
                          WHEN pinned_price.id IS NOT NULL THEN pinned_price.unit_price
                          WHEN spi.overage_unit_price_net IS NOT NULL
                              THEN spi.overage_unit_price_net
                          WHEN current_price.id IS NOT NULL THEN current_price.unit_price
                          WHEN c.valid_from <= CURRENT_DATE
                               AND (c.valid_to IS NULL OR c.valid_to >= CURRENT_DATE)
                              THEN c.unit_price
                          ELSE NULL
                      END AS agency_service_unit_price,
                      CASE
                          WHEN pinned_price.id IS NOT NULL THEN pinned_price.currency
                          WHEN current_price.id IS NOT NULL THEN current_price.currency
                          WHEN c.valid_from <= CURRENT_DATE
                               AND (c.valid_to IS NULL OR c.valid_to >= CURRENT_DATE)
                              THEN c.currency
                          ELSE NULL
                      END AS agency_service_currency,
                      CASE
                          WHEN pinned_price.id IS NOT NULL THEN pinned_price.vat_rate
                          WHEN current_price.id IS NOT NULL THEN current_price.vat_rate
                          WHEN c.valid_from <= CURRENT_DATE
                               AND (c.valid_to IS NULL OR c.valid_to >= CURRENT_DATE)
                              THEN c.vat_rate
                          ELSE NULL
                      END AS agency_service_vat_rate,
                      tp.profile_key AS tax_profile_key,
                      tp.name AS tax_profile_name,
                      tp.vat_rate AS tax_profile_vat_rate
               FROM service_package_items spi
               LEFT JOIN agency_service_catalog c ON c.id = spi.agency_service_id
               LEFT JOIN agency_service_price_versions pinned_price
                 ON pinned_price.id = spi.agency_service_price_version_id
                AND pinned_price.agency_service_id = spi.agency_service_id
               LEFT JOIN LATERAL (
                   SELECT version.id, version.unit_price, version.currency, version.vat_rate
                   FROM agency_service_price_versions version
                   WHERE version.agency_service_id = spi.agency_service_id
                     AND version.valid_from <= CURRENT_DATE
                     AND (version.valid_to IS NULL OR version.valid_to >= CURRENT_DATE)
                   ORDER BY version.valid_from DESC, version.created_at DESC
                   LIMIT 1
               ) current_price ON true
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
                "agency_service_price_version_id": row.try_get::<Option<Uuid>, _>("agency_service_price_version_id").unwrap_or_default(),
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
                "price_versions": row.try_get::<Value, _>("price_versions").unwrap_or_else(|_| serde_json::json!([])),
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
    let mut retained_ids = Vec::with_capacity(items.len());

    for (index, item) in items.iter().enumerate() {
        let description = item.description.trim();
        let service_key = normalize_optional(item.service_key.as_deref());
        let unit_label =
            normalize_optional(item.unit_label.as_deref()).unwrap_or_else(|| "unit".to_string());
        let item_id = if let Some(item_id) = item.id {
            let result = sqlx::query(
                r#"UPDATE service_package_items
                   SET agency_service_id = $3,
                       agency_service_price_version_id = $4,
                       service_key = $5,
                       description = $6,
                       included_quantity = $7,
                       unit_label = $8,
                       overage_unit_price_net = $9,
                       tax_profile_id = $10,
                       requires_patient_approval = $11,
                       sort_order = $12
                   WHERE id = $1 AND package_id = $2"#,
            )
            .bind(item_id)
            .bind(package_id)
            .bind(item.agency_service_id)
            .bind(item.agency_service_price_version_id)
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

            if result.rows_affected() == 0 {
                return Err(sqlx::Error::RowNotFound);
            }

            item_id
        } else {
            let row = sqlx::query(
                r#"INSERT INTO service_package_items (
                        package_id, agency_service_id, agency_service_price_version_id,
                        service_key, description,
                        included_quantity, unit_label, overage_unit_price_net,
                        tax_profile_id, requires_patient_approval, sort_order
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                   RETURNING id"#,
            )
            .bind(package_id)
            .bind(item.agency_service_id)
            .bind(item.agency_service_price_version_id)
            .bind(service_key)
            .bind(description)
            .bind(item.included_quantity.unwrap_or(Decimal::ONE).round_dp(2))
            .bind(unit_label)
            .bind(item.overage_unit_price_net.map(|value| value.round_dp(2)))
            .bind(item.tax_profile_id)
            .bind(item.requires_patient_approval.unwrap_or(false))
            .bind(index as i32)
            .fetch_one(&mut **tx)
            .await?;

            row.try_get::<Uuid, _>("id")?
        };
        retained_ids.push(item_id);
    }

    sqlx::query(
        r#"DELETE FROM service_package_items spi
           WHERE spi.package_id = $1
             AND NOT (spi.id = ANY($2::uuid[]))
             AND NOT EXISTS (
                SELECT 1
                FROM service_package_consumptions spc
                WHERE spc.package_item_id = spi.id
             )"#,
    )
    .bind(package_id)
    .bind(&retained_ids)
    .execute(&mut **tx)
    .await?;

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
        if item.agency_service_price_version_id.is_some() && item.overage_unit_price_net.is_some() {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "agency_service_price_version_id and overage_unit_price_net are mutually exclusive",
            ));
        }
        if item.agency_service_price_version_id.is_some() && item.agency_service_id.is_none() {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "agency_service_id is required for an explicit catalog price version",
            ));
        }
    }
    Ok(())
}

async fn validate_package_item_references(
    state: &AppState,
    package_id: Option<Uuid>,
    items: &[ServicePackageItemInput],
) -> Result<(), axum::response::Response> {
    let package_item_ids = items
        .iter()
        .filter_map(|item| item.id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if !package_item_ids.is_empty() {
        let Some(package_id) = package_id else {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Package item id is only valid when updating a service package",
            ));
        };
        let found = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM service_package_items WHERE package_id = $1 AND id = ANY($2)",
        )
        .bind(package_id)
        .bind(&package_item_ids)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, package_id = %package_id, "validate service package item ids");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate package item ids",
            )
        })?;
        if found != package_item_ids.len() as i64 {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Package item not found",
            ));
        }
    }

    let tax_profile_ids = items
        .iter()
        .filter_map(|item| item.tax_profile_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if !tax_profile_ids.is_empty() {
        let found =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tax_profiles WHERE id = ANY($1)")
                .bind(&tax_profile_ids)
                .fetch_one(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, "validate service package item tax profiles");
                    err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to validate package item tax profiles",
                    )
                })?;
        if found != tax_profile_ids.len() as i64 {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Package item tax profile not found",
            ));
        }
    }

    let agency_service_ids = items
        .iter()
        .filter_map(|item| item.agency_service_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if !agency_service_ids.is_empty() {
        let found = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM agency_service_catalog WHERE id = ANY($1)",
        )
        .bind(&agency_service_ids)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "validate service package item agency services");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate package item agency services",
            )
        })?;
        if found != agency_service_ids.len() as i64 {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Package item agency service not found",
            ));
        }
    }

    let price_version_ids = items
        .iter()
        .filter_map(|item| item.agency_service_price_version_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if !price_version_ids.is_empty() {
        let rows = sqlx::query(
            "SELECT id, agency_service_id FROM agency_service_price_versions WHERE id = ANY($1)",
        )
        .bind(&price_version_ids)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "validate service package item price versions");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate package item price versions",
            )
        })?;
        let versions_by_id = rows
            .into_iter()
            .filter_map(|row| {
                Some((
                    row.try_get::<Uuid, _>("id").ok()?,
                    row.try_get::<Uuid, _>("agency_service_id").ok()?,
                ))
            })
            .collect::<HashMap<_, _>>();

        for item in items {
            let Some(price_version_id) = item.agency_service_price_version_id else {
                continue;
            };
            let Some(expected_service_id) = item.agency_service_id else {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "agency_service_id is required for an explicit catalog price version",
                ));
            };
            if versions_by_id.get(&price_version_id) != Some(&expected_service_id) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Agency service price version does not belong to package item service",
                ));
            }
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
    if let Err(resp) = validate_package_item_references(&state, None, &items).await {
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
    .bind(&name)
    .bind(normalize_optional(body.description.as_deref()))
    .bind(&currency)
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

    if let Err(e) = sqlx::query(
        r#"INSERT INTO service_package_price_versions (
               package_id, name, base_price_net, base_price_vat, base_price_gross,
               currency, tax_profile_id, valid_from, valid_to, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE), $9, $10)"#,
    )
    .bind(package_id)
    .bind(&name)
    .bind(base_net)
    .bind(base_vat)
    .bind(base_gross)
    .bind(&currency)
    .bind(body.tax_profile_id)
    .bind(valid_from)
    .bind(valid_to)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, package_id = %package_id, "create service package price version");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create service package",
        );
    }

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
    if let Err(resp) = validate_package_item_references(&state, Some(package_id), &items).await {
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
    .bind(&name)
    .bind(normalize_optional(body.description.as_deref()))
    .bind(&currency)
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

    if let Err(e) = sqlx::query(
        r#"INSERT INTO service_package_price_versions (
               package_id, name, base_price_net, base_price_vat, base_price_gross,
               currency, tax_profile_id, valid_from, valid_to, created_by
           )
           SELECT id, $2, $3, $4, $5, $6, $7, valid_from, valid_to, $8
           FROM service_packages
           WHERE id = $1
           ON CONFLICT (package_id, valid_from) DO UPDATE
           SET base_price_net = EXCLUDED.base_price_net,
               base_price_vat = EXCLUDED.base_price_vat,
               base_price_gross = EXCLUDED.base_price_gross,
               currency = EXCLUDED.currency,
               tax_profile_id = EXCLUDED.tax_profile_id,
               valid_to = EXCLUDED.valid_to,
               created_by = EXCLUDED.created_by,
               created_at = now()"#,
    )
    .bind(package_id)
    .bind(&name)
    .bind(base_net)
    .bind(base_vat)
    .bind(base_gross)
    .bind(&currency)
    .bind(body.tax_profile_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, package_id = %package_id, "save service package price version");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update service package",
        );
    }

    if let Err(e) = sqlx::query(
        r#"WITH ordered AS (
               SELECT id, LEAD(valid_from) OVER (ORDER BY valid_from, created_at, id) AS next_from
               FROM service_package_price_versions
               WHERE package_id = $1
           )
           UPDATE service_package_price_versions price
           SET valid_to = CASE
               WHEN ordered.next_from IS NOT NULL THEN ordered.next_from - 1
               ELSE price.valid_to
           END
           FROM ordered
           WHERE price.id = ordered.id"#,
    )
    .bind(package_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, package_id = %package_id, "normalize package prices after package update");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update service package",
        );
    }

    if let Err(e) = sqlx::query(
        r#"WITH selected AS (
               SELECT base_price_net, base_price_vat, base_price_gross,
                      currency, tax_profile_id, valid_from, valid_to
               FROM service_package_price_versions
               WHERE package_id = $1
               ORDER BY
                   (valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)) DESC,
                   valid_from DESC,
                   created_at DESC
               LIMIT 1
           )
           UPDATE service_packages package
           SET base_price_net = selected.base_price_net,
               base_price_vat = selected.base_price_vat,
               base_price_gross = selected.base_price_gross,
               currency = selected.currency,
               tax_profile_id = selected.tax_profile_id,
               valid_from = selected.valid_from,
               valid_to = selected.valid_to,
               updated_by = $2,
               updated_at = now()
           FROM selected
           WHERE package.id = $1"#,
    )
    .bind(package_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, package_id = %package_id, "sync package price after package update");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update service package",
        );
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

async fn save_service_package_price_version(
    state: &AppState,
    auth: &AuthUser,
    package_id: Uuid,
    price_version_id: Option<Uuid>,
    body: CreateServicePackagePriceVersionRequest,
) -> axum::response::Response {
    if !can_manage_package_catalog(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Price name is required");
    }
    if name.chars().count() > 160 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Price name cannot exceed 160 characters",
        );
    }
    if body.base_price_net < Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "base_price_net must be non-negative",
        );
    }
    let valid_from = match parse_optional_date(Some(body.valid_from.as_str()), "valid_from") {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::UNPROCESSABLE_ENTITY, "valid_from is required"),
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let valid_to = match parse_optional_date(body.valid_to.as_deref(), "valid_to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if let Some(valid_to) = valid_to
        && valid_to < valid_from
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "valid_to cannot be earlier than valid_from",
        );
    }
    let vat_rate = match tax_profile_rate(state, body.tax_profile_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let (base_net, base_vat, base_gross) = compute_price_parts(body.base_price_net, vat_rate);
    let currency = normalize_optional(body.currency.as_deref())
        .unwrap_or_else(|| "EUR".to_string())
        .to_uppercase();
    if currency.len() > 8 {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "currency is too long");
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, %package_id, "begin package price version save");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save price version",
            );
        }
    };
    match sqlx::query_scalar::<_, Uuid>("SELECT id FROM service_packages WHERE id = $1 FOR UPDATE")
        .bind(package_id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Service package not found"),
        Err(error) => {
            tracing::error!(%error, %package_id, "lock package for price version save");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save price version",
            );
        }
    }

    let saved_id = if let Some(price_version_id) = price_version_id {
        match sqlx::query_scalar::<_, Uuid>(
            r#"UPDATE service_package_price_versions
               SET name = $3,
                   base_price_net = $4,
                   base_price_vat = $5,
                   base_price_gross = $6,
                   currency = $7,
                   tax_profile_id = $8,
                   valid_from = $9,
                   valid_to = $10,
                   created_by = $11,
                   created_at = now()
               WHERE id = $1 AND package_id = $2
               RETURNING id"#,
        )
        .bind(price_version_id)
        .bind(package_id)
        .bind(&name)
        .bind(base_net)
        .bind(base_vat)
        .bind(base_gross)
        .bind(&currency)
        .bind(body.tax_profile_id)
        .bind(valid_from)
        .bind(valid_to)
        .bind(auth.user_id)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(Some(id)) => id,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Price version not found"),
            Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
                return err(StatusCode::CONFLICT, "A price already starts on this date");
            }
            Err(error) => {
                tracing::error!(%error, %package_id, %price_version_id, "update package price version");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to save price version",
                );
            }
        }
    } else {
        match sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO service_package_price_versions (
                   package_id, name, base_price_net, base_price_vat, base_price_gross,
                   currency, tax_profile_id, valid_from, valid_to, created_by
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               RETURNING id"#,
        )
        .bind(package_id)
        .bind(&name)
        .bind(base_net)
        .bind(base_vat)
        .bind(base_gross)
        .bind(&currency)
        .bind(body.tax_profile_id)
        .bind(valid_from)
        .bind(valid_to)
        .bind(auth.user_id)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(id) => id,
            Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
                return err(StatusCode::CONFLICT, "A price already starts on this date");
            }
            Err(error) => {
                tracing::error!(%error, %package_id, "create package price version");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to save price version",
                );
            }
        }
    };

    if let Err(error) = sqlx::query(
        r#"WITH ordered AS (
               SELECT id, LEAD(valid_from) OVER (ORDER BY valid_from, created_at, id) AS next_from
               FROM service_package_price_versions
               WHERE package_id = $1
           )
           UPDATE service_package_price_versions price
           SET valid_to = CASE
               WHEN ordered.next_from IS NOT NULL THEN ordered.next_from - 1
               WHEN price.id = $2 THEN $3
               ELSE price.valid_to
           END
           FROM ordered
           WHERE price.id = ordered.id"#,
    )
    .bind(package_id)
    .bind(saved_id)
    .bind(valid_to)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %package_id, %saved_id, "normalize package price periods");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save price version",
        );
    }
    if let Err(error) = sqlx::query(
        r#"WITH selected AS (
               SELECT base_price_net, base_price_vat, base_price_gross,
                      currency, tax_profile_id, valid_from, valid_to
               FROM service_package_price_versions
               WHERE package_id = $1
               ORDER BY
                   (valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)) DESC,
                   valid_from DESC,
                   created_at DESC
               LIMIT 1
           )
           UPDATE service_packages package
           SET base_price_net = selected.base_price_net,
               base_price_vat = selected.base_price_vat,
               base_price_gross = selected.base_price_gross,
               currency = selected.currency,
               tax_profile_id = selected.tax_profile_id,
               valid_from = selected.valid_from,
               valid_to = selected.valid_to,
               updated_by = $2,
               updated_at = now()
           FROM selected
           WHERE package.id = $1"#,
    )
    .bind(package_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %package_id, "sync package current price");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save price version");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(%error, %package_id, "commit package price version save");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save price version",
        );
    }
    Json(serde_json::json!({ "id": saved_id, "ok": true })).into_response()
}

async fn create_service_package_price_version(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(package_id): Path<Uuid>,
    Json(body): Json<CreateServicePackagePriceVersionRequest>,
) -> axum::response::Response {
    save_service_package_price_version(&state, &auth, package_id, None, body).await
}

async fn update_service_package_price_version(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((package_id, price_version_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateServicePackagePriceVersionRequest>,
) -> axum::response::Response {
    save_service_package_price_version(&state, &auth, package_id, Some(price_version_id), body)
        .await
}

async fn delete_service_package_price_version(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((package_id, price_version_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if !can_manage_package_catalog(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, %package_id, "begin package price version delete");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete price version",
            );
        }
    };
    match sqlx::query_scalar::<_, Uuid>("SELECT id FROM service_packages WHERE id = $1 FOR UPDATE")
        .bind(package_id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Service package not found"),
        Err(error) => {
            tracing::error!(%error, %package_id, "lock package for price version delete");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete price version",
            );
        }
    }
    let count = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM service_package_price_versions WHERE package_id = $1",
    )
    .bind(package_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!(%error, %package_id, "count package price versions");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete price version",
            );
        }
    };
    if count <= 1 {
        return err(
            StatusCode::CONFLICT,
            "The only price version cannot be deleted",
        );
    }
    let deleted = match sqlx::query(
        "DELETE FROM service_package_price_versions WHERE id = $1 AND package_id = $2",
    )
    .bind(price_version_id)
    .bind(package_id)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result.rows_affected() > 0,
        Err(error) => {
            tracing::error!(%error, %package_id, %price_version_id, "delete package price version");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete price version",
            );
        }
    };
    if !deleted {
        return err(StatusCode::NOT_FOUND, "Price version not found");
    }
    if let Err(error) = sqlx::query(
        r#"WITH ordered AS (
               SELECT id, LEAD(valid_from) OVER (ORDER BY valid_from, created_at, id) AS next_from
               FROM service_package_price_versions
               WHERE package_id = $1
           )
           UPDATE service_package_price_versions price
           SET valid_to = CASE WHEN ordered.next_from IS NULL THEN NULL ELSE ordered.next_from - 1 END
           FROM ordered
           WHERE price.id = ordered.id"#,
    )
    .bind(package_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %package_id, "normalize package price periods after delete");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete price version");
    }
    if let Err(error) = sqlx::query(
        r#"WITH selected AS (
               SELECT base_price_net, base_price_vat, base_price_gross,
                      currency, tax_profile_id, valid_from, valid_to
               FROM service_package_price_versions
               WHERE package_id = $1
               ORDER BY
                   (valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)) DESC,
                   valid_from DESC,
                   created_at DESC
               LIMIT 1
           )
           UPDATE service_packages package
           SET base_price_net = selected.base_price_net,
               base_price_vat = selected.base_price_vat,
               base_price_gross = selected.base_price_gross,
               currency = selected.currency,
               tax_profile_id = selected.tax_profile_id,
               valid_from = selected.valid_from,
               valid_to = selected.valid_to,
               updated_by = $2,
               updated_at = now()
           FROM selected
           WHERE package.id = $1"#,
    )
    .bind(package_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %package_id, "sync package current price after delete");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete price version");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(%error, %package_id, "commit package price version delete");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete price version",
        );
    }
    Json(serde_json::json!({ "ok": true })).into_response()
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
                  psp.portal_visible,
                  psp.starts_on, psp.ends_on, psp.assigned_at, psp.notes,
                  psp.payer_contact_name, psp.payer_contact_relationship,
                  psp.package_price_version_id, psp.base_price_net_snapshot,
                  psp.base_price_vat_snapshot, psp.base_price_gross_snapshot,
                  psp.currency_snapshot, psp.tax_profile_id_snapshot,
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
                    psp.portal_visible,
                    psp.starts_on, psp.ends_on, psp.assigned_at, psp.notes,
                    psp.payer_contact_name, psp.payer_contact_relationship,
                    psp.package_price_version_id, psp.base_price_net_snapshot,
                    psp.base_price_vat_snapshot, psp.base_price_gross_snapshot,
                    psp.currency_snapshot, psp.tax_profile_id_snapshot,
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
                        "package_price_version_id": row.try_get::<Option<Uuid>, _>("package_price_version_id").unwrap_or_default(),
                        "base_price_net_snapshot": decimal_to_string(row.try_get::<Decimal, _>("base_price_net_snapshot").unwrap_or(Decimal::ZERO)),
                        "base_price_vat_snapshot": decimal_to_string(row.try_get::<Decimal, _>("base_price_vat_snapshot").unwrap_or(Decimal::ZERO)),
                        "base_price_gross_snapshot": decimal_to_string(row.try_get::<Decimal, _>("base_price_gross_snapshot").unwrap_or(Decimal::ZERO)),
                        "currency_snapshot": row.try_get::<String, _>("currency_snapshot").unwrap_or_else(|_| "EUR".to_string()),
                        "tax_profile_id_snapshot": row.try_get::<Option<Uuid>, _>("tax_profile_id_snapshot").unwrap_or_default(),
                        "portal_visible": row.try_get::<bool, _>("portal_visible").unwrap_or(true),
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

async fn list_my_subscriptions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if auth.role != Role::Patient {
        return err(StatusCode::FORBIDDEN, "Patient portal access required");
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(patient_id) => patient_id,
        Err(resp) => return resp,
    };

    // Base package invoices are linked to an order, not directly to a concrete
    // patient_service_package. We therefore expose an explicit linked-order
    // financial scope. If an order has multiple released subscriptions, the
    // shared balance is not repeated on every card; patients can inspect the
    // authoritative amount once in the invoices workspace.
    let rows = match sqlx::query(
        r#"SELECT psp.id, psp.package_id, psp.order_id, psp.status,
                  psp.starts_on, psp.ends_on, psp.assigned_at, psp.portal_visible,
                  sp.name AS package_name, sp.description AS package_description,
                  sp.currency, o.order_number,
                  spi.id AS package_item_id,
                  COALESCE(NULLIF(c.service_name, ''), NULLIF(spi.description, ''), 'Service') AS service_name,
                  COALESCE(c.service_key, spi.service_key) AS service_key,
                  spi.description AS service_description,
                  spi.included_quantity, spi.unit_label, spi.requires_patient_approval,
                  COALESCE(SUM(spc.quantity) FILTER (
                      WHERE spc.approval_status <> 'declined'
                  ), 0) AS used_quantity,
                  COALESCE(SUM(spc.overage_quantity) FILTER (
                      WHERE spc.approval_status <> 'declined'
                  ), 0) AS overage_quantity,
                  COALESCE(SUM(spc.overage_quantity) FILTER (
                      WHERE spc.approval_status = 'pending'
                  ), 0) AS pending_overage_quantity,
                  finance.visible_invoice_count,
                  finance.overdue_invoice_count,
                  finance.settled_amount,
                  finance.balance_due,
                  finance.amounts_visible,
                  finance.linked_subscription_count
           FROM patient_service_packages psp
           JOIN service_packages sp ON sp.id = psp.package_id
           LEFT JOIN orders o ON o.id = psp.order_id AND o.patient_id = psp.patient_id
           LEFT JOIN service_package_items spi ON spi.package_id = sp.id
           LEFT JOIN agency_service_catalog c ON c.id = spi.agency_service_id
           LEFT JOIN service_package_consumptions spc
                  ON spc.patient_service_package_id = psp.id
                 AND spc.package_item_id = spi.id
           LEFT JOIN LATERAL (
               SELECT COUNT(*)::BIGINT AS visible_invoice_count,
                      COUNT(*) FILTER (
                          WHERE invoice.status = 'overdue'
                            AND invoice.total_gross - invoice.credited_amount
                                > invoice.paid_amount + invoice.prepayment_applied_amount
                      )::BIGINT AS overdue_invoice_count,
                      COALESCE(SUM(
                          invoice.paid_amount + invoice.prepayment_applied_amount
                      ), 0) AS settled_amount,
                      COALESCE(SUM(GREATEST(
                          invoice.total_gross
                          - invoice.credited_amount
                          - invoice.paid_amount
                          - invoice.prepayment_applied_amount,
                          0
                      )), 0) AS balance_due,
                      COALESCE(BOOL_AND(NOT invoice.hide_amounts_from_patient), true) AS amounts_visible,
                      (
                          SELECT COUNT(*)::BIGINT
                          FROM patient_service_packages sibling
                          WHERE psp.order_id IS NOT NULL
                            AND sibling.patient_id = psp.patient_id
                            AND sibling.order_id = psp.order_id
                            AND sibling.portal_visible = true
                            AND sibling.status IN ('active', 'paused', 'completed')
                      ) AS linked_subscription_count
               FROM invoices invoice
               WHERE psp.order_id IS NOT NULL
                 AND invoice.order_id = psp.order_id
                 AND invoice.patient_id = psp.patient_id
                 AND invoice.portal_visible = true
                 AND invoice.status NOT IN ('draft', 'cancelled')
           ) finance ON true
           WHERE psp.patient_id = $1
             AND psp.portal_visible = true
             AND psp.status IN ('active', 'paused', 'completed')
           GROUP BY psp.id, psp.package_id, psp.order_id, psp.status,
                    psp.starts_on, psp.ends_on, psp.assigned_at, psp.portal_visible,
                    sp.name, sp.description, sp.currency, o.order_number,
                    spi.id, c.service_name, c.service_key, spi.service_key,
                    spi.description, spi.included_quantity, spi.unit_label,
                    spi.requires_patient_approval,
                    finance.visible_invoice_count, finance.overdue_invoice_count,
                    finance.settled_amount, finance.balance_due, finance.amounts_visible,
                    finance.linked_subscription_count
           ORDER BY
               CASE
                   WHEN psp.status = 'completed' OR psp.ends_on < CURRENT_DATE THEN 3
                   WHEN psp.starts_on > CURRENT_DATE THEN 2
                   ELSE 1
               END,
               psp.starts_on NULLS FIRST,
               psp.assigned_at DESC,
               spi.sort_order,
               spi.created_at"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient portal subscriptions");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load subscriptions",
            );
        }
    };

    let today = Utc::now().date_naive();
    let mut subscriptions = Vec::<Value>::new();
    let mut subscription_indexes = HashMap::<Uuid, usize>::new();

    for row in rows {
        let subscription_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let subscription_index = if let Some(index) = subscription_indexes.get(&subscription_id) {
            *index
        } else {
            let starts_on = row
                .try_get::<Option<NaiveDate>, _>("starts_on")
                .unwrap_or_default();
            let ends_on = row
                .try_get::<Option<NaiveDate>, _>("ends_on")
                .unwrap_or_default();
            let status = row.try_get::<String, _>("status").unwrap_or_default();
            let lifecycle = if status == "completed" || ends_on.is_some_and(|date| date < today) {
                "completed"
            } else if starts_on.is_some_and(|date| date > today) {
                "upcoming"
            } else {
                "active"
            };
            let visible_invoice_count = row
                .try_get::<i64, _>("visible_invoice_count")
                .unwrap_or_default();
            let overdue_invoice_count = row
                .try_get::<i64, _>("overdue_invoice_count")
                .unwrap_or_default();
            let settled_amount = row
                .try_get::<Decimal, _>("settled_amount")
                .unwrap_or(Decimal::ZERO);
            let balance_due = row
                .try_get::<Decimal, _>("balance_due")
                .unwrap_or(Decimal::ZERO);
            let amounts_visible = row.try_get::<bool, _>("amounts_visible").unwrap_or(true);
            let linked_subscription_count = row
                .try_get::<i64, _>("linked_subscription_count")
                .unwrap_or_default();
            let balance_disclosure = if !amounts_visible {
                "hidden_by_invoice"
            } else if linked_subscription_count > 1 {
                "shared_order"
            } else {
                "visible"
            };
            let balance_visible = balance_disclosure == "visible";
            let financial_status = if visible_invoice_count == 0 {
                "not_invoiced"
            } else if balance_due <= Decimal::ZERO {
                "paid"
            } else if overdue_invoice_count > 0 {
                "overdue"
            } else if settled_amount > Decimal::ZERO {
                "partially_paid"
            } else {
                "open"
            };
            let index = subscriptions.len();
            subscriptions.push(serde_json::json!({
                "id": subscription_id,
                "package_id": row.try_get::<Uuid, _>("package_id").unwrap_or_default(),
                "package_name": row.try_get::<String, _>("package_name").unwrap_or_default(),
                "description": row.try_get::<Option<String>, _>("package_description").unwrap_or_default(),
                "status": status,
                "lifecycle": lifecycle,
                "starts_on": starts_on.map(|date| date.to_string()),
                "ends_on": ends_on.map(|date| date.to_string()),
                "assigned_at": row.try_get::<chrono::DateTime<Utc>, _>("assigned_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
                "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                "portal_visible": true,
                "financial": {
                    "scope": "linked_order",
                    "status": financial_status,
                    "visible_invoice_count": visible_invoice_count,
                    "linked_subscription_count": linked_subscription_count,
                    "amounts_visible": balance_visible,
                    "balance_disclosure": balance_disclosure,
                    "balance_due": if balance_visible {
                        serde_json::json!(decimal_to_string(balance_due))
                    } else {
                        Value::Null
                    },
                },
                "services": [],
            }));
            subscription_indexes.insert(subscription_id, index);
            index
        };

        let Some(package_item_id) = row
            .try_get::<Option<Uuid>, _>("package_item_id")
            .unwrap_or_default()
        else {
            continue;
        };
        let included_quantity = row
            .try_get::<Decimal, _>("included_quantity")
            .unwrap_or(Decimal::ZERO);
        let used_quantity = row
            .try_get::<Decimal, _>("used_quantity")
            .unwrap_or(Decimal::ZERO);
        let remaining_quantity = (included_quantity - used_quantity).max(Decimal::ZERO);
        if let Some(services) = subscriptions[subscription_index]
            .get_mut("services")
            .and_then(Value::as_array_mut)
        {
            services.push(serde_json::json!({
                "id": package_item_id,
                "service_key": row.try_get::<Option<String>, _>("service_key").unwrap_or_default(),
                "name": row.try_get::<String, _>("service_name").unwrap_or_else(|_| "Service".to_string()),
                "description": row.try_get::<Option<String>, _>("service_description").unwrap_or_default(),
                "included_quantity": decimal_to_string(included_quantity),
                "used_quantity": decimal_to_string(used_quantity),
                "remaining_quantity": decimal_to_string(remaining_quantity),
                "overage_quantity": decimal_to_string(row.try_get::<Decimal, _>("overage_quantity").unwrap_or(Decimal::ZERO)),
                "pending_overage_quantity": decimal_to_string(row.try_get::<Decimal, _>("pending_overage_quantity").unwrap_or(Decimal::ZERO)),
                "unit_label": row.try_get::<String, _>("unit_label").unwrap_or_else(|_| "unit".to_string()),
                "requires_patient_approval": row.try_get::<bool, _>("requires_patient_approval").unwrap_or(false),
            }));
        }
    }

    let total = subscriptions.len();
    Json(serde_json::json!({
        "items": subscriptions,
        "total": total,
    }))
    .into_response()
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
                payer_contact_relationship, portal_visible, notes, assigned_by,
                package_price_version_id, base_price_net_snapshot,
                base_price_vat_snapshot, base_price_gross_snapshot,
                currency_snapshot, tax_profile_id_snapshot
           )
           SELECT $1, $2, package.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                  price.id,
                  COALESCE(price.base_price_net, package.base_price_net),
                  COALESCE(price.base_price_vat, package.base_price_vat),
                  COALESCE(price.base_price_gross, package.base_price_gross),
                  UPPER(COALESCE(price.currency, package.currency)),
                  CASE
                      WHEN price.id IS NOT NULL THEN price.tax_profile_id
                      ELSE package.tax_profile_id
                  END
           FROM service_packages package
           LEFT JOIN LATERAL (
               SELECT version.id, version.base_price_net, version.base_price_vat,
                      version.base_price_gross, version.currency, version.tax_profile_id
               FROM service_package_price_versions version
               WHERE version.package_id = package.id
                 AND version.valid_from <= COALESCE($5, CURRENT_DATE)
                 AND (version.valid_to IS NULL OR version.valid_to >= COALESCE($5, CURRENT_DATE))
               ORDER BY version.valid_from DESC, version.created_at DESC
               LIMIT 1
           ) price ON true
           WHERE package.id = $3
             AND package.is_active
             AND (
                   price.id IS NOT NULL
                   OR (
                       package.valid_from <= COALESCE($5, CURRENT_DATE)
                       AND (package.valid_to IS NULL OR package.valid_to >= COALESCE($5, CURRENT_DATE))
                   )
             )
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
    .bind(body.portal_visible.unwrap_or(true))
    .bind(normalize_optional(body.notes.as_deref()))
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let patient_service_package_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "service_package.assigned",
                patient_id,
                serde_json::json!({
                    "patient_service_package_id": patient_service_package_id,
                    "package_id": body.package_id,
                }),
            )
            .await;
            Json(serde_json::json!({
                "id": patient_service_package_id,
                "patient_id": patient_id,
                "package_id": body.package_id,
            }))
            .into_response()
        }
        Ok(None) => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Package has no active price for the package start date",
        ),
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
            r#"SELECT item.id, item.included_quantity, item.requires_patient_approval,
                      -- Pricing precedence is intentionally stable:
                      -- pinned catalog version, manual package override, then the
                      -- catalog version effective on the consumption date.
                      CASE
                          WHEN pinned_price.id IS NOT NULL THEN pinned_price.id
                          WHEN item.overage_unit_price_net IS NULL THEN automatic_price.id
                          ELSE NULL
                      END AS agency_service_price_version_id,
                      COALESCE(
                          pinned_price.unit_price,
                          item.overage_unit_price_net,
                          automatic_price.unit_price,
                          catalog.unit_price,
                          0
                      )
                          AS unit_price_net,
                      UPPER(COALESCE(
                          pinned_price.currency,
                          automatic_price.currency,
                          catalog.currency,
                          package.currency,
                          'EUR'
                      ))
                          AS currency,
                      COALESCE(
                          item_tax.vat_rate,
                          pinned_price.vat_rate,
                          automatic_price.vat_rate,
                          catalog.vat_rate,
                          package_tax.vat_rate,
                          0
                      ) AS vat_rate,
                      CASE
                          WHEN item_tax.id IS NOT NULL THEN item_tax.id
                          WHEN catalog.id IS NOT NULL THEN NULL
                          ELSE package_tax.id
                      END AS tax_profile_id
               FROM service_package_items item
               JOIN service_packages package ON package.id = item.package_id
               LEFT JOIN agency_service_catalog catalog ON catalog.id = item.agency_service_id
               LEFT JOIN agency_service_price_versions pinned_price
                 ON pinned_price.id = item.agency_service_price_version_id
                AND pinned_price.agency_service_id = item.agency_service_id
               LEFT JOIN tax_profiles item_tax ON item_tax.id = item.tax_profile_id
               LEFT JOIN tax_profiles package_tax ON package_tax.id = package.tax_profile_id
               LEFT JOIN LATERAL (
                   SELECT version.id, version.unit_price, version.currency, version.vat_rate
                   FROM agency_service_price_versions version
                   WHERE version.agency_service_id = item.agency_service_id
                     AND version.valid_from <= CURRENT_DATE
                     AND (version.valid_to IS NULL OR version.valid_to >= CURRENT_DATE)
                   ORDER BY version.valid_from DESC, version.created_at DESC
                   LIMIT 1
               ) automatic_price ON true
               WHERE item.id = $1
                 AND item.package_id = $2
                 AND (
                       pinned_price.id IS NOT NULL
                       OR item.overage_unit_price_net IS NOT NULL
                       OR item.agency_service_id IS NULL
                       OR automatic_price.id IS NOT NULL
                       OR (
                           catalog.valid_from <= CURRENT_DATE
                           AND (catalog.valid_to IS NULL OR catalog.valid_to >= CURRENT_DATE)
                       )
                 )"#,
        )
        .bind(package_item_id)
        .bind(package_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(row)) => Some(PackageItemConsumptionContext {
                id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
                included_quantity: row
                    .try_get::<Decimal, _>("included_quantity")
                    .unwrap_or(Decimal::ZERO),
                requires_patient_approval: row
                    .try_get::<bool, _>("requires_patient_approval")
                    .unwrap_or(false),
                agency_service_price_version_id: row
                    .try_get::<Option<Uuid>, _>("agency_service_price_version_id")
                    .unwrap_or_default(),
                unit_price_net: row
                    .try_get::<Decimal, _>("unit_price_net")
                    .unwrap_or(Decimal::ZERO),
                currency: row
                    .try_get::<String, _>("currency")
                    .unwrap_or_else(|_| "EUR".to_string()),
                vat_rate: row
                    .try_get::<Decimal, _>("vat_rate")
                    .unwrap_or(Decimal::ZERO),
                tax_profile_id: row
                    .try_get::<Option<Uuid>, _>("tax_profile_id")
                    .unwrap_or_default(),
            }),
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
        .as_ref()
        .map(|context| context.included_quantity)
        .unwrap_or(Decimal::ZERO);
    let item_requires_approval = item_context
        .as_ref()
        .map(|context| context.requires_patient_approval)
        .unwrap_or(false);
    let package_item_id = item_context.as_ref().map(|context| context.id);
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
                approval_status, notes, created_by,
                agency_service_price_version_id, unit_price_net_snapshot,
                currency_snapshot, vat_rate_snapshot, tax_profile_id_snapshot
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15
           )
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
    .bind(
        item_context
            .as_ref()
            .and_then(|context| context.agency_service_price_version_id),
    )
    .bind(
        item_context
            .as_ref()
            .map(|context| context.unit_price_net)
            .unwrap_or(Decimal::ZERO),
    )
    .bind(
        item_context
            .as_ref()
            .map(|context| context.currency.as_str())
            .unwrap_or("EUR"),
    )
    .bind(
        item_context
            .as_ref()
            .map(|context| context.vat_rate)
            .unwrap_or(Decimal::ZERO),
    )
    .bind(
        item_context
            .as_ref()
            .and_then(|context| context.tax_profile_id),
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let consumption_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "service_package.consumed",
                patient_id,
                serde_json::json!({
                    "patient_service_package_id": patient_service_package_id,
                    "package_item_id": package_item_id,
                    "consumption_id": consumption_id,
                }),
            )
            .await;
            Json(serde_json::json!({
                "id": consumption_id,
                "patient_service_package_id": patient_service_package_id,
                "package_item_id": package_item_id,
                "quantity": decimal_to_string(body.quantity),
                "overage_quantity": decimal_to_string(overage_quantity),
                "requires_patient_approval": requires_patient_approval,
                "approval_status": approval_status,
                "consumed_at": row.try_get::<chrono::DateTime<Utc>, _>("consumed_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            }))
            .into_response()
        }
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
        Ok(result) => {
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "service_package.overage_updated",
                patient_id,
                serde_json::json!({
                    "patient_service_package_id": patient_service_package_id,
                    "package_item_id": body.package_item_id,
                    "approval_status": body.approval_status.clone(),
                    "updated_count": result.rows_affected(),
                }),
            )
            .await;
            Json(serde_json::json!({
                "patient_service_package_id": patient_service_package_id,
                "package_item_id": body.package_item_id,
                "approval_status": body.approval_status,
                "updated_count": result.rows_affected(),
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, patient_service_package_id = %patient_service_package_id, "update overage approval");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update overage approval",
            )
        }
    }
}
