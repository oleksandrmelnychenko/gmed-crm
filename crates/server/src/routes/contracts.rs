use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
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
            "/agency-services",
            get(list_agency_services).post(create_agency_service),
        )
        .route(
            "/agency-services/{service_id}/update",
            post(update_agency_service),
        )
        .route(
            "/agency-services/{service_id}/price-versions",
            post(create_agency_service_price_version),
        )
        .route(
            "/agency-services/{service_id}/price-versions/{price_version_id}",
            post(update_agency_service_price_version).delete(delete_agency_service_price_version),
        )
        .route(
            "/agency-services/{service_id}",
            delete(delete_agency_service),
        )
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
    lead_id: Option<Uuid>,
    status: Option<String>,
}

#[derive(Deserialize)]
struct ListAgencyServicesQuery {
    search: Option<String>,
    active_only: Option<bool>,
}

#[derive(Deserialize)]
struct CreateFrameworkContractRequest {
    patient_id: Option<String>,
    lead_id: Option<String>,
    signed_at: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    conditions: Option<Value>,
    status: Option<String>,
    client_reference: Option<String>,
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
    lead_id: Option<Uuid>,
    status: Option<String>,
}

#[derive(Deserialize, Clone)]
struct QuoteLineItemInput {
    description_items: Option<Vec<crate::service_description::ServiceDescriptionItem>>,
    description: String,
    quantity: f64,
    unit_price: f64,
    vat_rate: Option<f64>,
    is_cost_passthrough: Option<bool>,
    source_order_leistung_id: Option<Uuid>,
    external_document_id: Option<Uuid>,
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

#[derive(Deserialize)]
struct UpsertAgencyServiceRequest {
    description_items: Option<Vec<crate::service_description::ServiceDescriptionItem>>,
    service_key: Option<String>,
    service_name: String,
    description: Option<String>,
    unit_label: Option<String>,
    unit_price: f64,
    currency: Option<String>,
    vat_rate: Option<f64>,
    is_active: Option<bool>,
    valid_from: String,
    valid_to: Option<String>,
}

#[derive(Deserialize)]
struct CreateAgencyServicePriceVersionRequest {
    name: String,
    unit_price: Decimal,
    currency: Option<String>,
    vat_rate: Option<Decimal>,
    valid_from: String,
    valid_to: Option<String>,
}

struct NormalizedAgencyServicePriceVersion {
    name: String,
    unit_price: Decimal,
    currency: String,
    vat_rate: Decimal,
    valid_from: NaiveDate,
    valid_to: Option<NaiveDate>,
}

struct NormalizedAgencyServicePayload {
    description_items: Option<serde_json::Value>,
    service_key: Option<String>,
    service_name: String,
    description: Option<String>,
    unit_label: String,
    unit_price: Decimal,
    currency: String,
    vat_rate: Decimal,
    is_active: bool,
    valid_from: NaiveDate,
    valid_to: Option<NaiveDate>,
}

#[derive(Serialize, Clone)]
struct QuoteLineItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    description_items: Option<Value>,
    description: String,
    quantity: String,
    unit_price: String,
    vat_rate: String,
    is_cost_passthrough: bool,
    line_net: String,
    line_vat: String,
    line_gross: String,
    source_order_leistung_id: Option<Uuid>,
    external_document_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    notes: Option<String>,
}

struct OrderAccessContext {
    patient_id: Option<Uuid>,
    lead_id: Option<Uuid>,
    contract_id: Option<Uuid>,
    order_number: String,
}

impl OrderAccessContext {
    fn subject(&self) -> Result<access::RecordSubject, access::RecordSubjectError> {
        if let Some(patient_id) = self.patient_id {
            Ok(access::RecordSubject::Patient(patient_id))
        } else {
            access::RecordSubject::from_ids(None, self.lead_id)
        }
    }
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

fn parse_optional_subject_uuid(
    value: Option<&str>,
    invalid_message: &'static str,
) -> Result<Option<Uuid>, &'static str> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(raw) => Uuid::parse_str(raw).map(Some).map_err(|_| invalid_message),
        None => Ok(None),
    }
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn quantity_to_string(value: Decimal) -> String {
    value.round_dp(4).normalize().to_string()
}

fn quote_decimal_value(value: Option<&Value>) -> Decimal {
    value
        .and_then(|value| match value {
            Value::String(value) => value.parse::<Decimal>().ok(),
            Value::Number(value) => value.to_string().parse::<Decimal>().ok(),
            _ => None,
        })
        .unwrap_or(Decimal::ZERO)
}

fn strict_quote_decimal_value(value: Option<&Value>) -> Option<Decimal> {
    value.and_then(|value| match value {
        Value::String(value) => value.parse::<Decimal>().ok(),
        Value::Number(value) => value.to_string().parse::<Decimal>().ok(),
        _ => None,
    })
}

fn quote_line_signature(
    description: &str,
    quantity: Decimal,
    unit_price: Decimal,
    vat_rate: Decimal,
    is_cost_passthrough: bool,
) -> String {
    json!([
        description.trim(),
        quantity_to_string(quantity),
        decimal_to_string(unit_price),
        decimal_to_string(vat_rate),
        is_cost_passthrough,
    ])
    .to_string()
}

fn normalized_quote_line_signatures(items: &[QuoteLineItem]) -> Vec<String> {
    let mut signatures = items
        .iter()
        .filter_map(|item| {
            Some(quote_line_signature(
                &item.description,
                item.quantity.parse::<Decimal>().ok()?,
                item.unit_price.parse::<Decimal>().ok()?,
                item.vat_rate.parse::<Decimal>().ok()?,
                item.is_cost_passthrough,
            ))
        })
        .collect::<Vec<_>>();
    signatures.sort();
    signatures
}

fn stored_quote_line_signatures(value: &Value) -> Option<Vec<String>> {
    let items = value.as_array()?;
    let mut signatures = Vec::with_capacity(items.len());
    for item in items {
        let item = item.as_object()?;
        signatures.push(quote_line_signature(
            item.get("description")?.as_str()?,
            strict_quote_decimal_value(item.get("quantity"))?,
            strict_quote_decimal_value(item.get("unit_price"))?,
            strict_quote_decimal_value(item.get("vat_rate"))?,
            item.get("is_cost_passthrough")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        ));
    }
    signatures.sort();
    Some(signatures)
}

fn quote_lines_match_persisted(value: &Value, persisted: &[QuoteLineItem]) -> bool {
    let Some(stored) = stored_quote_line_signatures(value) else {
        return false;
    };
    !stored.is_empty() && stored == normalized_quote_line_signatures(persisted)
}

fn add_remaining_quote_quantities(mut line_items: Value, allocated_quantities: &Value) -> Value {
    let Some(items) = line_items.as_array_mut() else {
        return line_items;
    };
    for (index, item) in items.iter_mut().enumerate() {
        let quoted = quote_decimal_value(item.get("quantity"));
        let allocated = quote_decimal_value(allocated_quantities.get(index.to_string().as_str()));
        let remaining = (quoted - allocated).max(Decimal::ZERO).round_dp(2);
        if let Some(map) = item.as_object_mut() {
            map.insert(
                "invoiced_quantity".to_string(),
                Value::String(decimal_to_string(allocated)),
            );
            map.insert(
                "remaining_quantity".to_string(),
                Value::String(decimal_to_string(remaining)),
            );
            map.insert(
                "fully_invoiced".to_string(),
                json!(remaining <= Decimal::ZERO),
            );
        }
    }
    line_items
}

fn normalize_agency_service_key(value: &str) -> Result<String, &'static str> {
    let trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() {
        return Err("Service key is required");
    }
    if trimmed.len() > 80 {
        return Err("Service key cannot exceed 80 characters");
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
    {
        return Err("Service key may contain only lowercase letters, digits, '_' and '-'");
    }
    Ok(trimmed)
}

fn normalize_agency_service_payload(
    body: UpsertAgencyServiceRequest,
) -> Result<NormalizedAgencyServicePayload, &'static str> {
    let service_name = body.service_name.trim();
    if service_name.is_empty() {
        return Err("Service name is required");
    }
    if service_name.len() > 160 {
        return Err("Service name cannot exceed 160 characters");
    }
    let service_key = body
        .service_key
        .as_deref()
        .map(normalize_agency_service_key)
        .transpose()?;

    let description_items = body
        .description_items
        .map(crate::service_description::normalize_items)
        .transpose()?;
    let description = match description_items.as_ref() {
        Some(items) => crate::service_description::items_text(items),
        None => body
            .description
            .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string())),
    };
    let unit_label = body
        .unit_label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unit".to_string());
    if unit_label.len() > 48 {
        return Err("Unit label cannot exceed 48 characters");
    }

    if !body.unit_price.is_finite() || body.unit_price < 0.0 {
        return Err("Unit price must be a valid non-negative number");
    }
    let unit_price =
        Decimal::try_from(body.unit_price).map_err(|_| "Unit price must be a valid number")?;

    let vat_input = body.vat_rate.unwrap_or(19.0);
    if !vat_input.is_finite() || !(0.0..=100.0).contains(&vat_input) {
        return Err("VAT rate must be between 0 and 100");
    }
    let vat_rate = Decimal::try_from(vat_input).map_err(|_| "VAT rate must be a valid number")?;

    let currency = body
        .currency
        .map(|value| value.trim().to_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "EUR".to_string());
    if currency.len() > 8 {
        return Err("Currency cannot exceed 8 characters");
    }

    let valid_from =
        parse_optional_date(Some(body.valid_from.as_str()))?.ok_or("Valid-from is required")?;
    let valid_to = parse_optional_date(body.valid_to.as_deref())?;
    if let Some(valid_to) = valid_to
        && valid_to < valid_from
    {
        return Err("Valid-to cannot be earlier than valid-from");
    }

    Ok(NormalizedAgencyServicePayload {
        description_items: description_items.map(|items| json!(items)),
        service_key,
        service_name: service_name.to_string(),
        description,
        unit_label,
        unit_price,
        currency,
        vat_rate,
        is_active: body.is_active.unwrap_or(true),
        valid_from,
        valid_to,
    })
}

fn normalize_agency_service_price_version(
    body: CreateAgencyServicePriceVersionRequest,
) -> Result<NormalizedAgencyServicePriceVersion, &'static str> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err("Price name is required");
    }
    if name.chars().count() > 160 {
        return Err("Price name cannot exceed 160 characters");
    }
    if body.unit_price < Decimal::ZERO {
        return Err("Unit price must be a valid non-negative number");
    }
    let vat_rate = body.vat_rate.unwrap_or(Decimal::new(19, 0));
    if vat_rate < Decimal::ZERO || vat_rate > Decimal::new(100, 0) {
        return Err("VAT rate must be between 0 and 100");
    }
    let currency = body
        .currency
        .map(|value| value.trim().to_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "EUR".to_string());
    if currency.len() > 8 {
        return Err("Currency cannot exceed 8 characters");
    }
    let valid_from =
        parse_optional_date(Some(body.valid_from.as_str()))?.ok_or("Valid-from is required")?;
    let valid_to = parse_optional_date(body.valid_to.as_deref())?;
    if let Some(valid_to) = valid_to
        && valid_to < valid_from
    {
        return Err("Valid-to cannot be earlier than valid-from");
    }
    Ok(NormalizedAgencyServicePriceVersion {
        name,
        unit_price: body.unit_price.round_dp(2),
        currency,
        vat_rate: vat_rate.round_dp(2),
        valid_from,
        valid_to,
    })
}

fn generate_agency_service_key(service_name: &str) -> String {
    let mut base = service_name
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    while base.contains("__") {
        base = base.replace("__", "_");
    }
    let base = base.trim_matches('_');
    let base = if base.is_empty() { "service" } else { base };
    let base = base.chars().take(56).collect::<String>();
    let suffix = Uuid::new_v4().simple().to_string();
    format!("{base}_{}", &suffix[..8])
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

async fn audit(
    state: &AppState,
    user_id: Uuid,
    action: &str,
    entity_type: &str,
    entity_id: Option<Uuid>,
    new_value: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    let context = match new_value {
        Some(value) => serde_json::json!({ "new_value": value }),
        None => serde_json::json!({}),
    };
    state.audit_sender.try_send(audit::domain_event(
        action.to_string(),
        Some(user_id),
        entity_type.to_string(),
        entity_id,
        context,
    ));
    Ok(())
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

async fn list_agency_services(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListAgencyServicesQuery>,
) -> axum::response::Response {
    if !can_read_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match sqlx::query(
        r#"SELECT catalog.id, catalog.service_key, catalog.service_name, catalog.description, catalog.description_items,
                  catalog.unit_label,
                  COALESCE(current_price.unit_price, catalog.unit_price) AS unit_price,
                  COALESCE(current_price.currency, catalog.currency) AS currency,
                  COALESCE(current_price.vat_rate, catalog.vat_rate) AS vat_rate,
                  catalog.is_active,
                  COALESCE(current_price.valid_from, catalog.valid_from) AS valid_from,
                  CASE
                      WHEN current_price.id IS NOT NULL THEN current_price.valid_to
                      ELSE catalog.valid_to
                  END AS valid_to,
                  catalog.created_at, catalog.updated_at,
                  COALESCE((
                      SELECT jsonb_agg(
                          jsonb_build_object(
                              'id', price.id,
                              'name', price.name,
                              'unit_price', price.unit_price::TEXT,
                              'currency', price.currency,
                              'vat_rate', price.vat_rate::TEXT,
                              'valid_from', price.valid_from,
                              'valid_to', price.valid_to,
                              'created_at', price.created_at
                          ) ORDER BY price.valid_from DESC, price.created_at DESC
                      )
                      FROM agency_service_price_versions price
                      WHERE price.agency_service_id = catalog.id
                  ), '[]'::jsonb) AS price_versions,
                  (
                      (SELECT COUNT(*) FROM order_leistungen line WHERE line.agency_service_id = catalog.id)
                    + (SELECT COUNT(*) FROM service_package_items item WHERE item.agency_service_id = catalog.id)
                    + (SELECT COUNT(*) FROM order_service_groups service_group WHERE service_group.agency_service_id = catalog.id)
                  )::BIGINT AS usage_count
           FROM agency_service_catalog catalog
           LEFT JOIN LATERAL (
               SELECT version.id, version.unit_price, version.currency, version.vat_rate,
                      version.valid_from, version.valid_to
               FROM agency_service_price_versions version
               WHERE version.agency_service_id = catalog.id
                 AND version.valid_from <= CURRENT_DATE
                 AND (version.valid_to IS NULL OR version.valid_to >= CURRENT_DATE)
               ORDER BY version.valid_from DESC, version.created_at DESC
               LIMIT 1
           ) current_price ON true
           WHERE (
                    $1::TEXT IS NULL
                    OR catalog.service_key ILIKE $1
                    OR catalog.service_name ILIKE $1
                    OR COALESCE(catalog.description, '') ILIKE $1
                 )
             AND ($2::BOOL IS NULL OR catalog.is_active = $2)
           ORDER BY catalog.is_active DESC, catalog.valid_from DESC, catalog.service_name ASC"#,
    )
    .bind(
        query
            .search
            .as_ref()
            .map(|value| format!("%{}%", value.trim()))
            .filter(|value| value != "%%"),
    )
    .bind(query.active_only)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items: Vec<Value> = rows
                .into_iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "service_key": row.try_get::<String, _>("service_key").unwrap_or_default(),
                        "service_name": row.try_get::<String, _>("service_name").unwrap_or_default(),
                        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                        "description_items": row.try_get::<Value, _>("description_items").unwrap_or_else(|_| json!([])),
                        "unit_label": row.try_get::<String, _>("unit_label").unwrap_or_else(|_| "unit".to_string()),
                        "unit_price": row.try_get::<Decimal, _>("unit_price").unwrap_or(Decimal::ZERO),
                        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                        "vat_rate": row.try_get::<Decimal, _>("vat_rate").unwrap_or(Decimal::ZERO),
                        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                        "valid_from": row.try_get::<NaiveDate, _>("valid_from").ok().map(|value| value.to_string()),
                        "valid_to": row.try_get::<Option<NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
                        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").ok().map(|value| value.to_rfc3339()),
                        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").ok().map(|value| value.to_rfc3339()),
                        "usage_count": row.try_get::<i64, _>("usage_count").unwrap_or_default(),
                        "price_versions": row.try_get::<Value, _>("price_versions").unwrap_or_else(|_| json!([])),
                    })
                })
                .collect();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list agency services");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list agency services",
            )
        }
    }
}

async fn create_agency_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertAgencyServiceRequest>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let payload = match normalize_agency_service_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let service_key = payload
        .service_key
        .unwrap_or_else(|| generate_agency_service_key(&payload.service_name));

    match sqlx::query(
        r#"WITH inserted AS (
             INSERT INTO agency_service_catalog (
                service_key, service_name, description, unit_label, unit_price,
                currency, vat_rate, is_active, valid_from, valid_to, created_by, updated_by, description_items
             ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $11, $12
             )
             RETURNING id, created_at, updated_at
           )
           INSERT INTO agency_service_price_versions (
               agency_service_id, name, unit_price, currency, vat_rate,
               valid_from, valid_to, created_by
           )
           SELECT id, $2, $5, $6, $7, $9, $10, $11
           FROM inserted
           RETURNING agency_service_id AS id, created_at, created_at AS updated_at"#,
    )
    .bind(service_key)
    .bind(payload.service_name)
    .bind(payload.description)
    .bind(payload.unit_label)
    .bind(payload.unit_price)
    .bind(payload.currency)
    .bind(payload.vat_rate)
    .bind(payload.is_active)
    .bind(payload.valid_from)
    .bind(payload.valid_to)
    .bind(auth.user_id)
    .bind(payload.description_items)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let service_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            let _ = audit(
                &state,
                auth.user_id,
                "create_agency_service",
                "agency_service_catalog",
                Some(service_id),
                Some(json!({ "service_id": service_id })),
            )
            .await;
            (
                StatusCode::CREATED,
                Json(json!({
                    "id": service_id,
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").ok().map(|value| value.to_rfc3339()),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").ok().map(|value| value.to_rfc3339()),
                })),
            )
                .into_response()
        }
        Err(e)
            if e.to_string()
                .contains("agency_service_catalog_service_key_key") =>
        {
            err(StatusCode::CONFLICT, "Agency service key already exists")
        }
        Err(e) => {
            tracing::error!(error = %e, "create agency service");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create agency service",
            )
        }
    }
}

async fn update_agency_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
    Json(body): Json<UpsertAgencyServiceRequest>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let payload = match normalize_agency_service_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, %service_id, "begin agency service update");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update agency service",
            );
        }
    };

    let updated = match sqlx::query(
        r#"WITH updated AS (
             UPDATE agency_service_catalog
           SET service_key = COALESCE($2, service_key),
               service_name = $3,
               description = $4,
               description_items = COALESCE($13, description_items),
               unit_label = $5,
               unit_price = $6,
               currency = $7,
               vat_rate = $8,
               is_active = $9,
               valid_from = $10,
               valid_to = $11,
               updated_by = $12,
               updated_at = now()
             WHERE id = $1
             RETURNING id
           )
           INSERT INTO agency_service_price_versions (
               agency_service_id, name, unit_price, currency, vat_rate,
               valid_from, valid_to, created_by
           )
           SELECT id, $3, $6, $7, $8, $10, $11, $12
           FROM updated
           ON CONFLICT (agency_service_id, valid_from) DO UPDATE
           SET unit_price = EXCLUDED.unit_price,
               currency = EXCLUDED.currency,
               vat_rate = EXCLUDED.vat_rate,
               valid_to = EXCLUDED.valid_to,
               created_by = EXCLUDED.created_by,
               created_at = now()
           RETURNING agency_service_id"#,
    )
    .bind(service_id)
    .bind(payload.service_key)
    .bind(payload.service_name)
    .bind(payload.description)
    .bind(payload.unit_label)
    .bind(payload.unit_price)
    .bind(payload.currency)
    .bind(payload.vat_rate)
    .bind(payload.is_active)
    .bind(payload.valid_from)
    .bind(payload.valid_to)
    .bind(auth.user_id)
    .bind(payload.description_items)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value.is_some(),
        Err(e)
            if e.to_string()
                .contains("agency_service_catalog_service_key_key") =>
        {
            return err(StatusCode::CONFLICT, "Agency service key already exists");
        }
        Err(e) => {
            tracing::error!(error = %e, service_id = %service_id, "update agency service");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update agency service",
            );
        }
    };
    if !updated {
        return err(StatusCode::NOT_FOUND, "Agency service not found");
    }

    if let Err(error) = sqlx::query(
        r#"WITH ordered AS (
               SELECT id, LEAD(valid_from) OVER (ORDER BY valid_from, created_at, id) AS next_from
               FROM agency_service_price_versions
               WHERE agency_service_id = $1
           )
           UPDATE agency_service_price_versions price
           SET valid_to = CASE
               WHEN ordered.next_from IS NOT NULL THEN ordered.next_from - 1
               ELSE price.valid_to
           END
           FROM ordered
           WHERE price.id = ordered.id"#,
    )
    .bind(service_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %service_id, "normalize agency service prices after service update");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update agency service",
        );
    }

    if let Err(error) = sqlx::query(
        r#"WITH selected AS (
               SELECT unit_price, currency, vat_rate, valid_from, valid_to
               FROM agency_service_price_versions
               WHERE agency_service_id = $1
               ORDER BY
                   (valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)) DESC,
                   valid_from DESC,
                   created_at DESC
               LIMIT 1
           )
           UPDATE agency_service_catalog catalog
           SET unit_price = selected.unit_price,
               currency = selected.currency,
               vat_rate = selected.vat_rate,
               valid_from = selected.valid_from,
               valid_to = selected.valid_to,
               updated_by = $2,
               updated_at = now()
           FROM selected
           WHERE catalog.id = $1"#,
    )
    .bind(service_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %service_id, "sync agency service price after service update");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update agency service",
        );
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(%error, %service_id, "commit agency service update");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update agency service",
        );
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_agency_service",
        "agency_service_catalog",
        Some(service_id),
        Some(json!({ "service_id": service_id })),
    )
    .await;
    Json(json!({ "ok": true })).into_response()
}

async fn save_agency_service_price_version(
    state: &AppState,
    auth: &AuthUser,
    service_id: Uuid,
    price_version_id: Option<Uuid>,
    body: CreateAgencyServicePriceVersionRequest,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let payload = match normalize_agency_service_price_version(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, %service_id, "begin agency service price version save");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save price version",
            );
        }
    };
    let service_exists = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM agency_service_catalog WHERE id = $1 FOR UPDATE",
    )
    .bind(service_id)
    .fetch_optional(&mut *tx)
    .await;
    match service_exists {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Agency service not found"),
        Err(error) => {
            tracing::error!(%error, %service_id, "lock agency service for price version save");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save price version",
            );
        }
    }

    let saved_id = if let Some(price_version_id) = price_version_id {
        match sqlx::query_scalar::<_, Uuid>(
            r#"UPDATE agency_service_price_versions
               SET name = $3,
                   unit_price = $4,
                   currency = $5,
                   vat_rate = $6,
                   valid_from = $7,
                   valid_to = $8,
                   created_by = $9,
                   created_at = now()
               WHERE id = $1 AND agency_service_id = $2
               RETURNING id"#,
        )
        .bind(price_version_id)
        .bind(service_id)
        .bind(&payload.name)
        .bind(payload.unit_price)
        .bind(&payload.currency)
        .bind(payload.vat_rate)
        .bind(payload.valid_from)
        .bind(payload.valid_to)
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
                tracing::error!(%error, %service_id, %price_version_id, "update agency service price version");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to save price version",
                );
            }
        }
    } else {
        match sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO agency_service_price_versions (
                   agency_service_id, name, unit_price, currency, vat_rate,
                   valid_from, valid_to, created_by
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id"#,
        )
        .bind(service_id)
        .bind(&payload.name)
        .bind(payload.unit_price)
        .bind(&payload.currency)
        .bind(payload.vat_rate)
        .bind(payload.valid_from)
        .bind(payload.valid_to)
        .bind(auth.user_id)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(id) => id,
            Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
                return err(StatusCode::CONFLICT, "A price already starts on this date");
            }
            Err(error) => {
                tracing::error!(%error, %service_id, "create agency service price version");
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
               FROM agency_service_price_versions
               WHERE agency_service_id = $1
           )
           UPDATE agency_service_price_versions price
           SET valid_to = CASE
               WHEN ordered.next_from IS NOT NULL THEN ordered.next_from - 1
               WHEN price.id = $2 THEN $3
               ELSE price.valid_to
           END
           FROM ordered
           WHERE price.id = ordered.id"#,
    )
    .bind(service_id)
    .bind(saved_id)
    .bind(payload.valid_to)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %service_id, %saved_id, "normalize agency service price periods");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save price version",
        );
    }

    if let Err(error) = sqlx::query(
        r#"WITH selected AS (
               SELECT unit_price, currency, vat_rate, valid_from, valid_to
               FROM agency_service_price_versions
               WHERE agency_service_id = $1
               ORDER BY
                   (valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)) DESC,
                   valid_from DESC,
                   created_at DESC
               LIMIT 1
           )
           UPDATE agency_service_catalog catalog
           SET unit_price = selected.unit_price,
               currency = selected.currency,
               vat_rate = selected.vat_rate,
               valid_from = selected.valid_from,
               valid_to = selected.valid_to,
               updated_by = $2,
               updated_at = now()
           FROM selected
           WHERE catalog.id = $1"#,
    )
    .bind(service_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %service_id, "sync agency service current price");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save price version");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(%error, %service_id, "commit agency service price version save");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save price version",
        );
    }
    let action = if price_version_id.is_some() {
        "update_agency_service_price_version"
    } else {
        "create_agency_service_price_version"
    };
    let _ = audit(
        state,
        auth.user_id,
        action,
        "agency_service_price_versions",
        Some(saved_id),
        Some(json!({ "service_id": service_id, "price_version_id": saved_id })),
    )
    .await;
    Json(json!({ "id": saved_id, "ok": true })).into_response()
}

async fn create_agency_service_price_version(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
    Json(body): Json<CreateAgencyServicePriceVersionRequest>,
) -> axum::response::Response {
    save_agency_service_price_version(&state, &auth, service_id, None, body).await
}

async fn update_agency_service_price_version(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((service_id, price_version_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateAgencyServicePriceVersionRequest>,
) -> axum::response::Response {
    save_agency_service_price_version(&state, &auth, service_id, Some(price_version_id), body).await
}

async fn delete_agency_service_price_version(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((service_id, price_version_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, %service_id, "begin agency service price version delete");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete price version",
            );
        }
    };
    match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM agency_service_catalog WHERE id = $1 FOR UPDATE",
    )
    .bind(service_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Agency service not found"),
        Err(error) => {
            tracing::error!(%error, %service_id, "lock agency service for price version delete");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete price version",
            );
        }
    }
    let count = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM agency_service_price_versions WHERE agency_service_id = $1",
    )
    .bind(service_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!(%error, %service_id, "count agency service price versions");
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
        "DELETE FROM agency_service_price_versions WHERE id = $1 AND agency_service_id = $2",
    )
    .bind(price_version_id)
    .bind(service_id)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result.rows_affected() > 0,
        Err(error) => {
            tracing::error!(%error, %service_id, %price_version_id, "delete agency service price version");
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
               FROM agency_service_price_versions
               WHERE agency_service_id = $1
           )
           UPDATE agency_service_price_versions price
           SET valid_to = CASE WHEN ordered.next_from IS NULL THEN NULL ELSE ordered.next_from - 1 END
           FROM ordered
           WHERE price.id = ordered.id"#,
    )
    .bind(service_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %service_id, "normalize agency service price periods after delete");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete price version");
    }
    if let Err(error) = sqlx::query(
        r#"WITH selected AS (
               SELECT unit_price, currency, vat_rate, valid_from, valid_to
               FROM agency_service_price_versions
               WHERE agency_service_id = $1
               ORDER BY
                   (valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)) DESC,
                   valid_from DESC,
                   created_at DESC
               LIMIT 1
           )
           UPDATE agency_service_catalog catalog
           SET unit_price = selected.unit_price,
               currency = selected.currency,
               vat_rate = selected.vat_rate,
               valid_from = selected.valid_from,
               valid_to = selected.valid_to,
               updated_by = $2,
               updated_at = now()
           FROM selected
           WHERE catalog.id = $1"#,
    )
    .bind(service_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %service_id, "sync agency service current price after delete");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete price version");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(%error, %service_id, "commit agency service price version delete");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete price version",
        );
    }
    let _ = audit(
        &state,
        auth.user_id,
        "delete_agency_service_price_version",
        "agency_service_price_versions",
        Some(price_version_id),
        Some(json!({ "service_id": service_id, "price_version_id": price_version_id })),
    )
    .await;
    Json(json!({ "ok": true })).into_response()
}

async fn delete_agency_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_manage_contracts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, %service_id, "begin agency service removal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to remove agency service",
            );
        }
    };

    let exists = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM agency_service_catalog WHERE id = $1 FOR UPDATE",
    )
    .bind(service_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value.is_some(),
        Err(error) => {
            tracing::error!(%error, %service_id, "lock agency service for removal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to remove agency service",
            );
        }
    };
    if !exists {
        return err(StatusCode::NOT_FOUND, "Agency service not found");
    }

    let usage_count = match sqlx::query_scalar::<_, i64>(
        r#"SELECT (
                (SELECT COUNT(*) FROM order_leistungen WHERE agency_service_id = $1)
              + (SELECT COUNT(*) FROM service_package_items WHERE agency_service_id = $1)
              + (SELECT COUNT(*) FROM order_service_groups WHERE agency_service_id = $1)
           )::BIGINT"#,
    )
    .bind(service_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %service_id, "count agency service usage");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to remove agency service",
            );
        }
    };

    let action = if usage_count > 0 {
        match sqlx::query(
            r#"UPDATE agency_service_catalog
               SET is_active = false,
                   valid_to = CASE
                       WHEN valid_to IS NULL OR valid_to > CURRENT_DATE THEN CURRENT_DATE
                       ELSE valid_to
                   END,
                   updated_by = $2,
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(service_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        {
            Ok(_) => "archived",
            Err(error) => {
                tracing::error!(%error, %service_id, "archive used agency service");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to archive agency service",
                );
            }
        }
    } else {
        match sqlx::query("DELETE FROM agency_service_catalog WHERE id = $1")
            .bind(service_id)
            .execute(&mut *tx)
            .await
        {
            Ok(_) => "deleted",
            Err(error) => {
                tracing::error!(%error, %service_id, "delete unused agency service");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to delete agency service",
                );
            }
        }
    };

    if let Err(error) = tx.commit().await {
        tracing::error!(%error, %service_id, "commit agency service removal");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to remove agency service",
        );
    }

    let _ = audit(
        &state,
        auth.user_id,
        if action == "archived" {
            "archive_agency_service"
        } else {
            "delete_agency_service"
        },
        "agency_service_catalog",
        Some(service_id),
        Some(json!({
            "service_id": service_id,
            "action": action,
            "usage_count": usage_count,
        })),
    )
    .await;

    Json(json!({
        "ok": true,
        "action": action,
        "usage_count": usage_count,
    }))
    .into_response()
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

async fn ensure_lead_access(
    state: &AppState,
    lead_id: Uuid,
) -> Result<(), axum::response::Response> {
    let converted_patient_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT converted_patient_id FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, lead_id = %lead_id, "validate lead access");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate lead access",
        )
    })?;

    match converted_patient_id {
        None => Err(err(StatusCode::NOT_FOUND, "Lead not found")),
        Some(Some(_)) => Err(err(
            StatusCode::CONFLICT,
            "Converted lead must use its patient context",
        )),
        Some(None) => Ok(()),
    }
}

async fn ensure_subject_access(
    state: &AppState,
    auth: &AuthUser,
    subject: access::RecordSubject,
) -> Result<(), axum::response::Response> {
    match subject {
        access::RecordSubject::Patient(patient_id) => {
            ensure_patient_access(state, auth, patient_id).await
        }
        access::RecordSubject::Lead(lead_id) => ensure_lead_access(state, lead_id).await,
    }
}

async fn load_contract_subject(
    state: &AppState,
    contract_id: Uuid,
) -> Result<Option<access::RecordSubject>, axum::response::Response> {
    let row = sqlx::query("SELECT patient_id, lead_id FROM framework_contracts WHERE id = $1")
        .bind(contract_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, contract_id = %contract_id, "load contract patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate framework contract",
            )
        })?;

    let Some(row) = row else {
        return Ok(None);
    };
    let patient_id = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default();
    let lead_id = row
        .try_get::<Option<Uuid>, _>("lead_id")
        .unwrap_or_default();
    access::RecordSubject::from_ids(patient_id, lead_id)
        .map(Some)
        .map_err(|error| {
            tracing::error!(?error, contract_id = %contract_id, "invalid framework contract subject");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Framework contract has invalid subject",
            )
        })
}

async fn load_contract_detail(
    state: &AppState,
    contract_id: Uuid,
    auth: &AuthUser,
) -> Result<Option<Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT fc.id, fc.patient_id, fc.lead_id, fc.contract_number, fc.status, fc.signed_at,
                  fc.valid_from, fc.valid_to, fc.conditions, fc.client_reference,
                  fc.created_at, fc.updated_at,
                  COALESCE(p.first_name, l.first_name) AS subject_first_name,
                  COALESCE(p.last_name, l.last_name) AS subject_last_name,
                  p.patient_id AS patient_pid
           FROM framework_contracts fc
           LEFT JOIN patients p ON p.id = fc.patient_id
           LEFT JOIN leads l ON l.id = fc.lead_id
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

    let subject = access::RecordSubject::from_ids(
        row.try_get::<Option<Uuid>, _>("patient_id")
            .unwrap_or_default(),
        row.try_get::<Option<Uuid>, _>("lead_id")
            .unwrap_or_default(),
    )
    .map_err(|error| {
        tracing::error!(?error, contract_id = %contract_id, "invalid framework contract subject");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Framework contract has invalid subject",
        )
    })?;
    ensure_subject_access(state, auth, subject).await?;

    Ok(Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "patient_id": subject.patient_id(),
        "lead_id": subject.lead_id(),
        "patient_name": format!(
            "{} {}",
            row.try_get::<String, _>("subject_first_name").unwrap_or_default(),
            row.try_get::<String, _>("subject_last_name").unwrap_or_default()
        ).trim().to_string(),
        "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
        "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "signed_at": row.try_get::<Option<DateTime<Utc>>, _>("signed_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        "valid_from": row.try_get::<Option<NaiveDate>, _>("valid_from").unwrap_or_default().map(|v| v.to_string()),
        "valid_to": row.try_get::<Option<NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
        "conditions": row.try_get::<Option<Value>, _>("conditions").unwrap_or_default(),
        "client_reference": row.try_get::<Option<String>, _>("client_reference").unwrap_or_default(),
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
        r#"SELECT fc.id, fc.patient_id, fc.lead_id, fc.contract_number, fc.status, fc.signed_at,
                  fc.valid_from, fc.valid_to, fc.conditions, fc.client_reference,
                  fc.created_at, fc.updated_at,
                  COALESCE(p.first_name, l.first_name) AS subject_first_name,
                  COALESCE(p.last_name, l.last_name) AS subject_last_name,
                  p.patient_id AS patient_pid
           FROM framework_contracts fc
           LEFT JOIN patients p ON p.id = fc.patient_id
           LEFT JOIN leads l ON l.id = fc.lead_id
           WHERE ($1::text = '%%'
                    OR de_normalize(concat_ws(' ',
                         fc.contract_number,
                         p.first_name, p.last_name, p.patient_id,
                         p.email, p.phone_primary, p.phone_secondary,
                         p.insurance_number, p.insurance_provider,
                         l.first_name, l.last_name, l.email, l.phone
                       )) LIKE de_normalize($1)
                    OR (length(regexp_replace($1, '\D', '', 'g')) >= 3
                        AND phone_digits(concat_ws(' ', p.phone_primary, p.phone_secondary, l.phone)) LIKE '%' || regexp_replace($1, '\D', '', 'g') || '%'))
             AND ($2::uuid IS NULL OR fc.patient_id = $2)
             AND ($3::uuid IS NULL OR fc.lead_id = $3)
             AND ($4::text IS NULL OR fc.status = $4)
           ORDER BY fc.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.patient_id)
    .bind(query.lead_id)
    .bind(query.status)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                let subject = match access::RecordSubject::from_ids(
                    row.try_get::<Option<Uuid>, _>("patient_id")
                        .unwrap_or_default(),
                    row.try_get::<Option<Uuid>, _>("lead_id")
                        .unwrap_or_default(),
                ) {
                    Ok(subject) => subject,
                    Err(error) => {
                        tracing::error!(?error, "invalid framework contract subject in list");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Framework contract has invalid subject",
                        );
                    }
                };
                if let access::RecordSubject::Patient(patient_id) = subject {
                    match can_access_patient(&state, &auth, patient_id).await {
                        Ok(true) => {}
                        Ok(false) => continue,
                        Err(resp) => return resp,
                    }
                }

                items.push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "patient_id": subject.patient_id(),
                    "lead_id": subject.lead_id(),
                    "patient_name": format!(
                        "{} {}",
                        row.try_get::<String, _>("subject_first_name").unwrap_or_default(),
                        row.try_get::<String, _>("subject_last_name").unwrap_or_default()
                    ).trim().to_string(),
                    "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
                    "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "signed_at": row.try_get::<Option<DateTime<Utc>>, _>("signed_at").unwrap_or_default().map(|v| v.to_rfc3339()),
                    "valid_from": row.try_get::<Option<NaiveDate>, _>("valid_from").unwrap_or_default().map(|v| v.to_string()),
                    "valid_to": row.try_get::<Option<NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
                    "conditions": row.try_get::<Option<Value>, _>("conditions").unwrap_or_default(),
                    "client_reference": row.try_get::<Option<String>, _>("client_reference").unwrap_or_default(),
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

    let patient_id =
        match parse_optional_subject_uuid(body.patient_id.as_deref(), "Invalid patient") {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        };
    let lead_id = match parse_optional_subject_uuid(body.lead_id.as_deref(), "Invalid lead") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let subject = match access::RecordSubject::from_ids(patient_id, lead_id) {
        Ok(subject) => subject,
        Err(access::RecordSubjectError::Missing) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Patient or lead is required",
            );
        }
        Err(access::RecordSubjectError::Ambiguous) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Contract cannot belong to patient and lead at the same time",
            );
        }
    };

    if let Err(resp) = ensure_subject_access(&state, &auth, subject).await {
        return resp;
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
    let client_reference = body
        .client_reference
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let conditions = body.conditions.unwrap_or(Value::Null);

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
                patient_id, lead_id, contract_number, signed_at, valid_from, valid_to,
                conditions, status, created_by, client_reference
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
           )
           ON CONFLICT DO NOTHING
           RETURNING id, created_at, updated_at"#,
    )
    .bind(subject.patient_id())
    .bind(subject.lead_id())
    .bind(contract_number.clone())
    .bind(signed_at)
    .bind(valid_from)
    .bind(valid_to)
    .bind(conditions)
    .bind(status.clone())
    .bind(auth.user_id)
    .bind(client_reference.as_deref())
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let contract_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            state.audit_sender.try_send(audit::domain_event(
                "create_framework_contract",
                Some(auth.user_id),
                "framework_contract",
                Some(contract_id),
                serde_json::json!({
                    "contract_number": contract_number,
                    "patient_id": subject.patient_id(),
                    "lead_id": subject.lead_id(),
                    "status": status,
                }),
            ));
            crate::realtime::publish_contract_event(
                &state,
                Some(auth.user_id),
                "framework_contract.created",
                contract_id,
                serde_json::json!({
                    "contract_number": contract_number.clone(),
                    "patient_id": subject.patient_id(),
                    "lead_id": subject.lead_id(),
                    "status": status.clone(),
                }),
            )
            .await;

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": contract_id,
                    "patient_id": subject.patient_id(),
                    "lead_id": subject.lead_id(),
                    "contract_number": contract_number,
                    "status": status,
                    "signed_at": signed_at.map(|v| v.to_rfc3339()),
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                })),
            )
                .into_response()
        }
        Ok(None) => {
            let Some(client_reference) = client_reference else {
                tracing::error!(patient_id = ?subject.patient_id(), lead_id = ?subject.lead_id(), "contract insert returned no row without a client reference");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to create contract",
                );
            };
            match sqlx::query(
                r#"SELECT id, contract_number, status, signed_at, created_at, updated_at
                   FROM framework_contracts
                   WHERE patient_id IS NOT DISTINCT FROM $1
                     AND lead_id IS NOT DISTINCT FROM $2
                     AND client_reference = $3"#,
            )
            .bind(subject.patient_id())
            .bind(subject.lead_id())
            .bind(&client_reference)
            .fetch_optional(&state.db)
            .await
            {
                Ok(Some(row)) => Json(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "patient_id": subject.patient_id(),
                    "lead_id": subject.lead_id(),
                    "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "signed_at": row.try_get::<Option<DateTime<Utc>>, _>("signed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    "client_reference": client_reference,
                    "idempotent_replay": true,
                }))
                .into_response(),
                Ok(None) => {
                    tracing::error!(patient_id = ?subject.patient_id(), lead_id = ?subject.lead_id(), client_reference = %client_reference, "idempotent contract missing after conflict");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create contract")
                }
                Err(e) => {
                    tracing::error!(error = %e, patient_id = ?subject.patient_id(), lead_id = ?subject.lead_id(), client_reference = %client_reference, "load idempotent contract");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create contract")
                }
            }
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

    let subject = match load_contract_subject(&state, contract_id).await {
        Ok(Some(subject)) => subject,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Framework contract not found"),
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_subject_access(&state, &auth, subject).await {
        return resp;
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
            let realtime_payload = serde_json::json!({
                "status": body.status,
                "signed_at": signed_at.map(|v| v.to_rfc3339()),
            });
            state.audit_sender.try_send(audit::domain_event(
                "update_framework_contract_status",
                Some(auth.user_id),
                "framework_contract",
                Some(contract_id),
                realtime_payload.clone(),
            ));
            crate::realtime::publish_contract_event(
                &state,
                Some(auth.user_id),
                "framework_contract.status_changed",
                contract_id,
                realtime_payload,
            )
            .await;

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
    let row = sqlx::query(
        "SELECT patient_id, source_lead_id, contract_id, order_number FROM orders WHERE id = $1",
    )
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
        patient_id: row
            .try_get::<Option<Uuid>, _>("patient_id")
            .unwrap_or_default(),
        lead_id: row
            .try_get::<Option<Uuid>, _>("source_lead_id")
            .unwrap_or_default(),
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

        let quantity = Decimal::try_from(item.quantity)
            .map_err(|_| "Invalid line item quantity")?
            .round_dp(4);
        if quantity <= Decimal::ZERO {
            return Err("Line item quantity is below the supported precision");
        }
        let unit_price =
            Decimal::try_from(item.unit_price).map_err(|_| "Invalid line item unit_price")?;
        let is_cost_passthrough = item.is_cost_passthrough.unwrap_or(false);
        let vat_rate = if is_cost_passthrough {
            Decimal::ZERO
        } else {
            Decimal::try_from(item.vat_rate.unwrap_or(19.0))
                .map_err(|_| "Invalid line item vat_rate")?
        };
        if vat_rate < Decimal::ZERO || vat_rate > Decimal::new(100, 0) {
            return Err("Line item vat_rate must be between 0 and 100");
        }
        let line_net = (quantity * unit_price).round_dp(2);
        let line_vat = (line_net * vat_rate / Decimal::new(100, 0)).round_dp(2);
        let line_gross = (line_net + line_vat).round_dp(2);

        normalized.push(QuoteLineItem {
            description_items: item
                .description_items
                .clone()
                .map(crate::service_description::normalize_items)
                .transpose()?
                .map(|items| json!(items)),
            description: item.description.trim().to_string(),
            quantity: quantity_to_string(quantity),
            unit_price: decimal_to_string(unit_price),
            vat_rate: decimal_to_string(vat_rate),
            is_cost_passthrough,
            line_net: decimal_to_string(line_net),
            line_vat: decimal_to_string(line_vat),
            line_gross: decimal_to_string(line_gross),
            source_order_leistung_id: item.source_order_leistung_id,
            external_document_id: item.external_document_id,
            provider_id: item.provider_id,
            doctor_id: item.doctor_id,
            notes: item.notes.clone(),
        });
    }

    Ok(normalized)
}

fn quote_line_items_from_order_rows(rows: Vec<sqlx::postgres::PgRow>) -> Vec<QuoteLineItem> {
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let quantity = row
            .try_get::<Decimal, _>("quantity")
            .unwrap_or(Decimal::ZERO)
            .round_dp(4);
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

        let catalog_description = row
            .try_get::<Option<String>, _>("agency_service_description_snapshot")
            .unwrap_or_default()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let operator_notes = row
            .try_get::<Option<String>, _>("notes")
            .unwrap_or_default()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let notes = match (catalog_description, operator_notes) {
            (Some(description), Some(notes)) if description != notes => {
                Some(format!("{description}\n{notes}"))
            }
            (Some(description), _) => Some(description),
            (_, notes) => notes,
        };

        items.push(QuoteLineItem {
            description_items: row
                .try_get::<Option<Value>, _>("agency_service_description_items_snapshot")
                .unwrap_or_default(),
            description: row.try_get::<String, _>("description").unwrap_or_default(),
            quantity: quantity_to_string(quantity),
            unit_price: decimal_to_string(unit_price),
            vat_rate: decimal_to_string(vat_rate),
            is_cost_passthrough,
            line_net: decimal_to_string(line_net),
            line_vat: decimal_to_string(line_vat),
            line_gross: decimal_to_string(line_gross),
            source_order_leistung_id: Some(row.try_get::<Uuid, _>("id").unwrap_or_default()),
            external_document_id: row
                .try_get::<Option<Uuid>, _>("external_document_id")
                .unwrap_or_default(),
            provider_id: row
                .try_get::<Option<Uuid>, _>("provider_id")
                .unwrap_or_default(),
            doctor_id: row
                .try_get::<Option<Uuid>, _>("doctor_id")
                .unwrap_or_default(),
            notes,
        });
    }

    items
}

async fn load_quote_line_items_from_order_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    order_id: Uuid,
) -> Result<Vec<QuoteLineItem>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT id, description, agency_service_description_snapshot, agency_service_description_items_snapshot,
                  quantity, unit_price_snapshot AS unit_price,
                  vat_rate_snapshot AS vat_rate, is_cost_passthrough,
                  external_document_id, provider_id, doctor_id, notes
           FROM order_leistungen
           WHERE order_id = $1
             AND status <> 'invoiced'
           ORDER BY created_at
           FOR SHARE"#,
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(quote_line_items_from_order_rows(rows))
}

async fn load_quote_subject(
    state: &AppState,
    quote_id: Uuid,
) -> Result<Option<access::RecordSubject>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT o.patient_id, o.source_lead_id
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
    })?;

    let Some(row) = row else {
        return Ok(None);
    };
    let patient_id = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default();
    let lead_id = row
        .try_get::<Option<Uuid>, _>("source_lead_id")
        .unwrap_or_default();
    if let Some(patient_id) = patient_id {
        Ok(Some(access::RecordSubject::Patient(patient_id)))
    } else {
        access::RecordSubject::from_ids(None, lead_id)
            .map(Some)
            .map_err(|error| {
                tracing::error!(?error, quote_id = %quote_id, "invalid quote subject");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Quote has invalid subject",
                )
            })
    }
}

async fn load_quote_detail(
    state: &AppState,
    quote_id: Uuid,
    auth: &AuthUser,
) -> Result<Option<Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT q.id, q.order_id, q.quote_number, q.total_net, q.total_vat, q.total_gross,
                  q.status, q.valid_until, q.paid_amount, q.paid_at, q.line_items, q.notes,
                  COALESCE((
                      SELECT jsonb_object_agg(allocated.quote_line_index::text, allocated.quantity)
                      FROM (
                          SELECT allocation.quote_line_index, SUM(allocation.quantity) AS quantity
                          FROM invoice_order_line_allocations allocation
                          JOIN invoices invoice ON invoice.id = allocation.invoice_id
                          WHERE allocation.quote_id = q.id
                            AND invoice.status <> 'cancelled'
                          GROUP BY allocation.quote_line_index
                      ) allocated
                  ), '{}'::jsonb) AS invoiced_quantities,
                  q.created_at, q.updated_at,
                  COALESCE((SELECT count(*)::bigint FROM quote_versions qv WHERE qv.quote_id = q.id), 0) AS version_count,
                  COALESCE((SELECT max(version_number) FROM quote_versions qv WHERE qv.quote_id = q.id), 0) AS current_version_number,
                  o.patient_id, o.source_lead_id, o.order_number, o.contract_id,
                  COALESCE(p.first_name, l.first_name) AS subject_first_name,
                  COALESCE(p.last_name, l.last_name) AS subject_last_name,
                  p.patient_id AS patient_pid
           FROM quotes q
           JOIN orders o ON o.id = q.order_id
           LEFT JOIN patients p ON p.id = o.patient_id
           LEFT JOIN leads l ON l.id = o.source_lead_id
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

    let patient_id = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default();
    let lead_id = row
        .try_get::<Option<Uuid>, _>("source_lead_id")
        .unwrap_or_default();
    let subject = if let Some(patient_id) = patient_id {
        access::RecordSubject::Patient(patient_id)
    } else {
        access::RecordSubject::from_ids(None, lead_id).map_err(|error| {
            tracing::error!(?error, quote_id = %quote_id, "invalid quote subject");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Quote has invalid subject",
            )
        })?
    };
    ensure_subject_access(state, auth, subject).await?;

    Ok(Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
        "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
        "contract_id": row.try_get::<Option<Uuid>, _>("contract_id").unwrap_or_default(),
        "patient_id": subject.patient_id(),
        "lead_id": subject.lead_id(),
        "patient_name": format!(
            "{} {}",
            row.try_get::<String, _>("subject_first_name").unwrap_or_default(),
            row.try_get::<String, _>("subject_last_name").unwrap_or_default()
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
        "line_items": add_remaining_quote_quantities(
            row.try_get::<Value, _>("line_items").unwrap_or_else(|_| serde_json::json!([])),
            &row.try_get::<Value, _>("invoiced_quantities").unwrap_or_else(|_| serde_json::json!({})),
        ),
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
                  q.status, q.valid_until, q.paid_amount, q.paid_at, q.line_items, q.notes,
                  COALESCE((
                      SELECT jsonb_object_agg(allocated.quote_line_index::text, allocated.quantity)
                      FROM (
                          SELECT allocation.quote_line_index, SUM(allocation.quantity) AS quantity
                          FROM invoice_order_line_allocations allocation
                          JOIN invoices invoice ON invoice.id = allocation.invoice_id
                          WHERE allocation.quote_id = q.id
                            AND invoice.status <> 'cancelled'
                          GROUP BY allocation.quote_line_index
                      ) allocated
                  ), '{}'::jsonb) AS invoiced_quantities,
                  q.created_at, q.updated_at,
                  o.patient_id, o.source_lead_id, o.order_number, o.contract_id,
                  COALESCE(p.first_name, l.first_name) AS subject_first_name,
                  COALESCE(p.last_name, l.last_name) AS subject_last_name,
                  p.patient_id AS patient_pid
           FROM quotes q
           JOIN orders o ON o.id = q.order_id
           LEFT JOIN patients p ON p.id = o.patient_id
           LEFT JOIN leads l ON l.id = o.source_lead_id
           WHERE ($1::text = '%%'
                    OR de_normalize(concat_ws(' ',
                         q.quote_number, o.order_number, q.notes,
                         p.first_name, p.last_name, p.patient_id,
                         l.first_name, l.last_name, l.email, l.phone
                       )) LIKE de_normalize($1))
             AND ($2::uuid IS NULL OR q.order_id = $2)
             AND ($3::uuid IS NULL OR o.patient_id = $3)
             AND ($4::uuid IS NULL OR o.source_lead_id = $4)
             AND ($5::text IS NULL OR q.status = $5)
           ORDER BY q.created_at DESC, q.id DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.order_id)
    .bind(query.patient_id)
    .bind(query.lead_id)
    .bind(query.status)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                let patient_id = row
                    .try_get::<Option<Uuid>, _>("patient_id")
                    .unwrap_or_default();
                let lead_id = row
                    .try_get::<Option<Uuid>, _>("source_lead_id")
                    .unwrap_or_default();
                let subject = if let Some(patient_id) = patient_id {
                    match can_access_patient(&state, &auth, patient_id).await {
                        Ok(true) => access::RecordSubject::Patient(patient_id),
                        Ok(false) => continue,
                        Err(resp) => return resp,
                    }
                } else {
                    match access::RecordSubject::from_ids(None, lead_id) {
                        Ok(subject) => subject,
                        Err(error) => {
                            tracing::error!(?error, "invalid quote subject in list");
                            return err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Quote has invalid subject",
                            );
                        }
                    }
                };

                items.push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                    "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                    "contract_id": row.try_get::<Option<Uuid>, _>("contract_id").unwrap_or_default(),
                    "patient_id": subject.patient_id(),
                    "lead_id": subject.lead_id(),
                    "patient_name": format!(
                        "{} {}",
                        row.try_get::<String, _>("subject_first_name").unwrap_or_default(),
                        row.try_get::<String, _>("subject_last_name").unwrap_or_default()
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
                    "line_items": add_remaining_quote_quantities(
                        row.try_get::<Value, _>("line_items").unwrap_or_else(|_| serde_json::json!([])),
                        &row.try_get::<Value, _>("invoiced_quantities").unwrap_or_else(|_| serde_json::json!({})),
                    ),
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
            lead_id: None,
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

    let order_subject = match order_ctx.subject() {
        Ok(subject) => subject,
        Err(error) => {
            tracing::error!(?error, order_id = %order_id, "invalid quote order subject");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Order has invalid subject",
            );
        }
    };
    if let Err(resp) = ensure_subject_access(&state, &auth, order_subject).await {
        return resp;
    }

    let valid_until = match parse_optional_date(body.valid_until.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin quote create transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
        }
    };
    let persisted_line_items = match load_quote_line_items_from_order_tx(&mut tx, order_id).await {
        Ok(items) if !items.is_empty() => items,
        Ok(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "No order services available for quote",
            );
        }
        Err(error) => {
            tracing::error!(%error, %order_id, "load canonical order services for quote");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to prepare quote");
        }
    };
    if let Some(items) = body.line_items.as_ref().filter(|items| !items.is_empty()) {
        let requested = match normalize_custom_line_items(items) {
            Ok(items) => items,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        };
        if normalized_quote_line_signatures(&requested)
            != normalized_quote_line_signatures(&persisted_line_items)
        {
            return err(
                StatusCode::CONFLICT,
                "Quote lines do not match the current order services",
            );
        }
    };
    // Persist only the canonical order snapshot. Client-supplied lines are a
    // concurrency guard, not a second commercial source of truth.
    let line_items = persisted_line_items;

    let totals = compute_quote_totals(&line_items);
    // A quote revision changes the commercial calculation, not the fact that
    // an advance payment was already received for this order. Carry the most
    // recent payment forward so recalculating a quote never asks staff to
    // record the same money a second time.
    let (carried_paid_amount, carried_paid_at) =
        match sqlx::query_as::<_, (Decimal, Option<DateTime<Utc>>)>(
            r#"SELECT paid_amount, paid_at
           FROM quotes
           WHERE order_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1
           FOR SHARE"#,
        )
        .bind(order_id)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(Some(payment)) => payment,
            Ok(None) => (Decimal::ZERO, None),
            Err(error) => {
                tracing::error!(%error, %order_id, "load prior quote payment");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
            }
        };
    if carried_paid_amount > totals.total_gross {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Received prepayment exceeds the recalculated quote total",
        );
    }
    let seq: i64 = match sqlx::query_scalar("SELECT nextval('quote_number_seq')")
        .fetch_one(&mut *tx)
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

    let row = match sqlx::query(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                valid_until, paid_amount, paid_at, line_items, notes, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
           )
           RETURNING id, created_at, updated_at"#,
    )
    .bind(order_id)
    .bind(quote_number.clone())
    .bind(totals.total_net)
    .bind(totals.total_vat)
    .bind(totals.total_gross)
    .bind(valid_until)
    .bind(carried_paid_amount)
    .bind(carried_paid_at)
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
        paid_amount: carried_paid_amount,
        paid_at: carried_paid_at,
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

    let updated_order = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE orders
           SET total_estimated = $2
           WHERE id = $1
             AND (prepayment_amount IS NULL OR prepayment_amount <= $2)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(totals.total_gross)
    .fetch_optional(&mut *tx)
    .await;
    match updated_order {
        Ok(Some(_)) => {}
        Ok(None) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "prepayment_amount cannot exceed the current quote total",
            );
        }
        Err(error) => {
            tracing::error!(%error, %order_id, "update order total_estimated from quote");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create quote");
        }
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

    crate::realtime::publish_quote_event(
        &state,
        Some(auth.user_id),
        "quote.created",
        quote_id,
        serde_json::json!({
            "quote_number": quote_number.clone(),
            "order_id": order_id,
            "order_number": order_ctx.order_number.clone(),
            "patient_id": order_ctx.patient_id,
            "lead_id": order_ctx.lead_id,
            "status": "draft",
            "total_gross": decimal_to_string(totals.total_gross),
            "paid_amount": decimal_to_string(carried_paid_amount),
        }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": quote_id,
            "quote_number": quote_number,
            "order_id": order_id,
            "contract_id": order_ctx.contract_id,
            "patient_id": order_ctx.patient_id,
            "lead_id": order_ctx.lead_id,
            "status": "draft",
            "total_net": decimal_to_string(totals.total_net),
            "total_vat": decimal_to_string(totals.total_vat),
            "total_gross": decimal_to_string(totals.total_gross),
            "valid_until": valid_until.map(|v| v.to_string()),
            "paid_amount": decimal_to_string(carried_paid_amount),
            "paid_at": carried_paid_at.map(|value| value.to_rfc3339()),
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

    let subject = match load_quote_subject(&state, quote_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_subject_access(&state, &auth, subject).await {
        return resp;
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

    let subject = match load_quote_subject(&state, quote_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(resp) => return resp,
    };

    if let Err(resp) = ensure_subject_access(&state, &auth, subject).await {
        return resp;
    }

    let paid_amount = match body.paid_amount {
        Some(value) => match Decimal::try_from(value) {
            Ok(value) => Some(value.round_dp(2)),
            Err(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid paid_amount"),
        },
        None => None,
    };
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

    let quote_context = match sqlx::query(
        r#"SELECT q.order_id, q.total_gross, q.paid_amount, q.line_items, o.total_estimated
           FROM quotes q
           JOIN orders o ON o.id = q.order_id
           WHERE q.id = $1
           FOR UPDATE OF q, o"#,
    )
    .bind(quote_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(error) => {
            tracing::error!(%error, %quote_id, "lock quote commercial context");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update quote");
        }
    };
    let order_id = quote_context
        .try_get::<Uuid, _>("order_id")
        .unwrap_or_default();
    let quote_total = quote_context
        .try_get::<Decimal, _>("total_gross")
        .unwrap_or(Decimal::ZERO);
    let current_paid_amount = quote_context
        .try_get::<Decimal, _>("paid_amount")
        .unwrap_or(Decimal::ZERO);
    if paid_amount.unwrap_or(current_paid_amount) > quote_total {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "paid_amount cannot exceed the current quote total",
        );
    }

    if body.status == "accepted" {
        let persisted_line_items = match load_quote_line_items_from_order_tx(&mut tx, order_id)
            .await
        {
            Ok(items) if !items.is_empty() => items,
            Ok(_) => {
                return err(
                    StatusCode::CONFLICT,
                    "Quote cannot be accepted without current order services",
                );
            }
            Err(error) => {
                tracing::error!(%error, %quote_id, %order_id, "load current order services before quote acceptance");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update quote");
            }
        };
        let stored_line_items = quote_context
            .try_get::<Value, _>("line_items")
            .unwrap_or_else(|_| json!([]));
        let current_total = compute_quote_totals(&persisted_line_items).total_gross;
        let order_total = quote_context
            .try_get::<Option<Decimal>, _>("total_estimated")
            .unwrap_or_default();
        if !quote_lines_match_persisted(&stored_line_items, &persisted_line_items)
            || quote_total != current_total
            || order_total != Some(current_total)
        {
            return err(
                StatusCode::CONFLICT,
                "Quote no longer matches the current order services",
            );
        }
    }

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

    crate::realtime::publish_quote_event(
        &state,
        Some(auth.user_id),
        "quote.status_changed",
        quote_id,
        serde_json::json!({
            "status": body.status,
            "paid_amount": paid_amount.map(decimal_to_string),
        }),
    )
    .await;

    match load_quote_detail(&state, quote_id, &auth).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(resp) => resp,
    }
}
