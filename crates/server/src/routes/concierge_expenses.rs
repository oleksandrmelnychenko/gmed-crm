use std::str::FromStr;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    audit,
    auth::middleware::AuthUser,
    file_scan::{FileScanOutcome, scan_upload_bytes},
    file_sniff::validate_upload_magic_bytes,
    routes::documents::{
        MAX_FILE_SIZE, read_document_storage_bytes, remove_document_blob, store_document_blob,
    },
    state::AppState,
};
use gmed_domain::role::Role;

fn max_money() -> Decimal {
    Decimal::new(999_999_999_999, 2)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/concierge-expenses", get(list_expense_review_queue))
        .route(
            "/concierge-services/{service_id}/expense-context",
            get(get_expense_context),
        )
        .route(
            "/concierge-services/{service_id}/expenses",
            get(list_expenses).post(submit_expense),
        )
        .route(
            "/concierge-services/{service_id}/expenses/{expense_id}/receipt",
            get(download_receipt),
        )
        .route(
            "/concierge-services/{service_id}/expenses/{expense_id}/post",
            post(post_expense),
        )
        .route(
            "/concierge-services/{service_id}/expenses/{expense_id}/reject",
            post(reject_expense),
        )
        .route(
            "/concierge-services/{service_id}/expenses/{expense_id}/reverse",
            post(reverse_expense),
        )
        .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024))
}

#[derive(Clone)]
struct ServiceContext {
    patient_id: Uuid,
    assigned_concierge_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    currency: String,
}

#[derive(Default)]
struct ExpenseMultipart {
    request_id: Option<Uuid>,
    order_id: Option<Uuid>,
    order_leistung_id: Option<Uuid>,
    vendor: Option<String>,
    expense_date: Option<NaiveDate>,
    amount_net: Option<Decimal>,
    amount_vat: Option<Decimal>,
    amount_gross: Option<Decimal>,
    currency: Option<String>,
    paid_by: Option<String>,
    service_delivered: Option<bool>,
    note: Option<String>,
    file_data: Option<Vec<u8>>,
    file_name: Option<String>,
    declared_mime: Option<String>,
}

#[derive(Deserialize)]
struct PostExpenseRequest {
    request_id: Uuid,
    order_id: Uuid,
    order_leistung_id: Option<Uuid>,
    financial_account_id: Option<Uuid>,
    paid_on: Option<NaiveDate>,
    payment_method: Option<String>,
    payment_reference: Option<String>,
}

#[derive(Deserialize)]
struct RejectExpenseRequest {
    request_id: Uuid,
    reason: String,
}

#[derive(Deserialize)]
struct ReverseExpenseRequest {
    request_id: Uuid,
    reason: String,
    reversed_on: NaiveDate,
}

#[derive(Deserialize)]
struct ExpenseReviewQueueQuery {
    page: Option<i64>,
    page_size: Option<i64>,
}

struct LockedExpense {
    id: Uuid,
    patient_id: Uuid,
    submitted_order_id: Option<Uuid>,
    submitted_order_leistung_id: Option<Uuid>,
    vendor_name: String,
    expense_date: NaiveDate,
    amount_net: Decimal,
    amount_vat: Decimal,
    amount_gross: Decimal,
    currency: String,
    paid_by: String,
    service_delivered: bool,
    note: Option<String>,
}

#[derive(Clone, Copy)]
struct NotificationDelivery {
    notification_id: Uuid,
    user_id: Uuid,
}

async fn insert_finance_review_notifications(
    transaction: &mut Transaction<'_, Postgres>,
    expense_id: Uuid,
    actor_user_id: Uuid,
    vendor: &str,
    amount_gross: Decimal,
    currency: &str,
) -> Result<Vec<NotificationDelivery>, sqlx::Error> {
    let rows = sqlx::query(
        r#"INSERT INTO user_notifications (
               user_id, kind, title, body, entity_type, entity_id
           )
           SELECT finance_user.id,
                  'concierge_expense_submitted',
                  'Concierge expense requires review',
                  $3,
                  'concierge_expense',
                  $1
           FROM users finance_user
           WHERE finance_user.is_active = true
             AND finance_user.role IN ('ceo', 'billing')
             AND finance_user.id <> $2
           RETURNING id, user_id"#,
    )
    .bind(expense_id)
    .bind(actor_user_id)
    .bind(format!(
        "A new receipt from {vendor} for {} {currency} is waiting for financial review.",
        amount_gross.round_dp(2)
    ))
    .fetch_all(&mut **transaction)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(NotificationDelivery {
                notification_id: row.try_get("id").ok()?,
                user_id: row.try_get("user_id").ok()?,
            })
        })
        .collect())
}

async fn insert_concierge_decision_notifications(
    transaction: &mut Transaction<'_, Postgres>,
    expense_id: Uuid,
    service_id: Uuid,
    actor_user_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) -> Result<Vec<NotificationDelivery>, sqlx::Error> {
    let rows = sqlx::query(
        r#"INSERT INTO user_notifications (
               user_id, kind, title, body, entity_type, entity_id
           )
           SELECT DISTINCT target_user.id, $4, $5, $6, 'concierge_expense', $1
           FROM concierge_expense_submissions submission
           JOIN concierge_services service
             ON service.id = submission.concierge_service_id
           JOIN users target_user
             ON target_user.id IN (submission.submitted_by, service.assigned_concierge_id)
           WHERE submission.id = $1
             AND submission.concierge_service_id = $2
             AND target_user.id <> $3
             AND target_user.is_active = true
             AND target_user.role = 'concierge'
           RETURNING id, user_id"#,
    )
    .bind(expense_id)
    .bind(service_id)
    .bind(actor_user_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .fetch_all(&mut **transaction)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(NotificationDelivery {
                notification_id: row.try_get("id").ok()?,
                user_id: row.try_get("user_id").ok()?,
            })
        })
        .collect())
}

async fn publish_notification_deliveries(
    state: &AppState,
    deliveries: Vec<NotificationDelivery>,
    entity_id: Uuid,
) {
    for delivery in deliveries {
        crate::realtime::publish_notification_event(
            state,
            delivery.user_id,
            "notification.created",
            Some(delivery.notification_id),
            json!({
                "entity_type": "concierge_expense",
                "entity_id": entity_id,
            }),
        )
        .await;
    }
}

fn err(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}

fn hash_json(value: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

fn hash_bytes(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    hex::encode(hasher.finalize())
}

fn clean_text(value: Option<String>, max: usize) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(max).collect())
}

fn parse_money(value: &str, field: &'static str) -> Result<Decimal, Response> {
    let parsed = Decimal::from_str(value.trim()).map_err(|_| {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} must be a decimal amount"),
        )
    })?;
    if parsed.scale() > 2 || parsed < Decimal::ZERO || parsed > max_money() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} must be a non-negative amount with at most two decimals"),
        ));
    }
    Ok(parsed.round_dp(2))
}

fn validate_amounts(net: Decimal, vat: Decimal, gross: Decimal) -> Result<(), Response> {
    let Some(sum) = net.checked_add(vat) else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Amounts are out of range",
        ));
    };
    if gross <= Decimal::ZERO || sum != gross {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "amount_net plus amount_vat must equal amount_gross",
        ));
    }
    Ok(())
}

fn normalize_currency(value: &str) -> Result<String, Response> {
    let currency = value.trim().to_ascii_uppercase();
    if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "currency must be an ISO 4217 three-letter code",
        ));
    }
    Ok(currency)
}

fn normalize_payment_method(value: Option<&str>) -> Result<String, Response> {
    let value = value.unwrap_or("other").trim().to_ascii_lowercase();
    if !matches!(value.as_str(), "bank_transfer" | "cash" | "card" | "other") {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "payment_method must be bank_transfer, cash, card, or other",
        ));
    }
    Ok(value)
}

async fn load_service_context(
    state: &AppState,
    service_id: Uuid,
) -> Result<ServiceContext, Response> {
    match sqlx::query(
        r#"SELECT patient_id, assigned_concierge_id, provider_id, UPPER(currency) AS currency
           FROM concierge_services
           WHERE id = $1"#,
    )
    .bind(service_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => Ok(ServiceContext {
            patient_id: row.try_get("patient_id").map_err(|_| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode service",
                )
            })?,
            assigned_concierge_id: row.try_get("assigned_concierge_id").unwrap_or_default(),
            provider_id: row.try_get("provider_id").unwrap_or_default(),
            currency: row
                .try_get("currency")
                .unwrap_or_else(|_| "EUR".to_string()),
        }),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Concierge service not found")),
        Err(error) => {
            tracing::error!(error = %error, service_id = %service_id, "load concierge expense service context");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load service",
            ))
        }
    }
}

async fn lock_service_context(
    transaction: &mut Transaction<'_, Postgres>,
    service_id: Uuid,
) -> Result<ServiceContext, Response> {
    match sqlx::query(
        r#"SELECT patient_id, assigned_concierge_id, provider_id, UPPER(currency) AS currency
           FROM concierge_services
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(service_id)
    .fetch_optional(&mut **transaction)
    .await
    {
        Ok(Some(row)) => Ok(ServiceContext {
            patient_id: row.try_get("patient_id").map_err(|_| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode service",
                )
            })?,
            assigned_concierge_id: row.try_get("assigned_concierge_id").unwrap_or_default(),
            provider_id: row.try_get("provider_id").unwrap_or_default(),
            currency: row
                .try_get("currency")
                .unwrap_or_else(|_| "EUR".to_string()),
        }),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Concierge service not found")),
        Err(error) => {
            tracing::error!(error = %error, service_id = %service_id, "lock concierge expense service context");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load service",
            ))
        }
    }
}

fn can_read_expenses(auth: &AuthUser, context: &ServiceContext) -> bool {
    auth.role == Role::Ceo
        || auth.role == Role::Billing
        || (auth.role == Role::Concierge && context.assigned_concierge_id == Some(auth.user_id))
}

fn can_submit_expense(auth: &AuthUser, context: &ServiceContext) -> bool {
    auth.role == Role::Ceo
        || (auth.role == Role::Concierge && context.assigned_concierge_id == Some(auth.user_id))
}

fn require_finance(auth: &AuthUser) -> Result<(), Response> {
    if matches!(auth.role, Role::Ceo | Role::Billing) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn get_expense_context(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
) -> Response {
    let context = match load_service_context(&state, service_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !can_read_expenses(&auth, &context) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let patient = match sqlx::query(
        r#"SELECT id, patient_id, first_name, last_name
           FROM patients WHERE id = $1"#,
    )
    .bind(context.patient_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "display_name": format!(
                "{} {}",
                row.try_get::<String, _>("first_name").unwrap_or_default(),
                row.try_get::<String, _>("last_name").unwrap_or_default(),
            ).trim(),
            "pid": row.try_get::<String, _>("patient_id").unwrap_or_default(),
        }),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %context.patient_id, "load concierge expense patient context");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load context");
        }
    };
    let service = match sqlx::query(
        r#"SELECT id, title, UPPER(currency) AS currency, provider_id
           FROM concierge_services WHERE id = $1"#,
    )
    .bind(service_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
        }),
        Err(error) => {
            tracing::error!(error = %error, service_id = %service_id, "load concierge expense service display context");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load context");
        }
    };

    let mut orders: Vec<Value> = Vec::new();
    if matches!(auth.role, Role::Ceo | Role::Billing) {
        let rows = match sqlx::query(
        r#"SELECT order_row.id AS order_id, order_row.order_number,
                  UPPER(order_row.currency) AS currency, order_row.status,
                  service.id AS service_id,
                  COALESCE(service.agency_service_name_snapshot, service.description) AS service_name,
                  COALESCE(service.agency_service_description_snapshot, service.description) AS service_description,
                  service.provider_id
           FROM orders order_row
           LEFT JOIN order_leistungen service
             ON service.order_id = order_row.id
            AND UPPER(service.currency) = UPPER(order_row.currency)
           WHERE order_row.patient_id = $1
             AND order_row.status <> 'cancelled'
           ORDER BY order_row.created_at DESC, service.created_at, service.id"#,
    )
        .bind(context.patient_id)
        .fetch_all(&state.db)
        .await
        {
            Ok(rows) => rows,
            Err(error) => {
                tracing::error!(error = %error, patient_id = %context.patient_id, "load concierge expense order context");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load context");
            }
        };
        for row in rows {
            let order_id = row.try_get::<Uuid, _>("order_id").unwrap_or_default();
            let order_id_text = order_id.to_string();
            if orders
                .last()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                != Some(order_id_text.as_str())
            {
                orders.push(json!({
                    "id": order_id,
                    "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                    "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "leistungen": [],
                }));
            }
            if let Some(order_service_id) = row
                .try_get::<Option<Uuid>, _>("service_id")
                .unwrap_or_default()
                && let Some(leistungen) = orders
                    .last_mut()
                    .and_then(|value| value.get_mut("leistungen"))
                    .and_then(Value::as_array_mut)
            {
                leistungen.push(json!({
                    "id": order_service_id,
                    "name": row.try_get::<String, _>("service_name").unwrap_or_default(),
                    "description": row.try_get::<String, _>("service_description").unwrap_or_default(),
                    "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
                }));
            }
        }
    }

    Json(json!({
        "patient": patient,
        "service": service,
        "mapped_order": Value::Null,
        "eligible_orders": orders,
    }))
    .into_response()
}

async fn parse_expense_multipart(mut multipart: Multipart) -> Result<ExpenseMultipart, Response> {
    let mut input = ExpenseMultipart::default();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(error = %error, "read concierge expense multipart field");
                return Err(err(StatusCode::BAD_REQUEST, "Invalid multipart request"));
            }
        };
        let name = field.name().unwrap_or_default().to_string();
        if name == "file" {
            if input.file_data.is_some() {
                return Err(err(
                    StatusCode::BAD_REQUEST,
                    "Only one receipt file is allowed",
                ));
            }
            input.file_name = field.file_name().map(ToOwned::to_owned);
            input.declared_mime = field.content_type().map(ToOwned::to_owned);
            let bytes = field.bytes().await.map_err(|error| {
                tracing::warn!(error = %error, "read concierge receipt file");
                err(StatusCode::BAD_REQUEST, "Failed to read receipt file")
            })?;
            if bytes.len() > MAX_FILE_SIZE {
                return Err(err(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "File too large (max 25MB)",
                ));
            }
            input.file_data = Some(bytes.to_vec());
            continue;
        }

        let value = field.text().await.map_err(|_| {
            err(
                StatusCode::BAD_REQUEST,
                &format!("Failed to read multipart field {name}"),
            )
        })?;
        match name.as_str() {
            "request_id" => {
                input.request_id = Some(Uuid::parse_str(value.trim()).map_err(|_| {
                    err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "request_id must be a UUID",
                    )
                })?)
            }
            "order_id" if !value.trim().is_empty() => {
                input.order_id = Some(Uuid::parse_str(value.trim()).map_err(|_| {
                    err(StatusCode::UNPROCESSABLE_ENTITY, "order_id must be a UUID")
                })?)
            }
            "order_leistung_id" if !value.trim().is_empty() => {
                input.order_leistung_id = Some(Uuid::parse_str(value.trim()).map_err(|_| {
                    err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "order_leistung_id must be a UUID",
                    )
                })?)
            }
            "vendor" => input.vendor = clean_text(Some(value), 200),
            "expense_date" => {
                input.expense_date = Some(
                    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").map_err(|_| {
                        err(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "expense_date must be YYYY-MM-DD",
                        )
                    })?,
                )
            }
            "amount_net" => input.amount_net = Some(parse_money(&value, "amount_net")?),
            "amount_vat" => input.amount_vat = Some(parse_money(&value, "amount_vat")?),
            "amount_gross" => input.amount_gross = Some(parse_money(&value, "amount_gross")?),
            "currency" => input.currency = Some(normalize_currency(&value)?),
            "paid_by" => input.paid_by = Some(value.trim().to_ascii_lowercase()),
            "service_delivered" => {
                input.service_delivered = Some(match value.trim().to_ascii_lowercase().as_str() {
                    "true" | "1" | "yes" => true,
                    "false" | "0" | "no" => false,
                    _ => {
                        return Err(err(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "service_delivered must be true or false",
                        ));
                    }
                })
            }
            "note" => input.note = clean_text(Some(value), 2000),
            _ => {}
        }
    }
    Ok(input)
}

async fn submit_expense(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
    multipart: Multipart,
) -> Response {
    let initial_service = match load_service_context(&state, service_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !can_submit_expense(&auth, &initial_service) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let mut input = match parse_expense_multipart(multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let request_id = match input.request_id {
        Some(value) => value,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "request_id is required"),
    };
    if input.order_leistung_id.is_some() && input.order_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "order_leistung_id requires order_id",
        );
    }
    let vendor = match input.vendor.take() {
        Some(value) => value,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "vendor is required"),
    };
    let expense_date = match input.expense_date {
        Some(value) if value <= Utc::now().date_naive() => value,
        Some(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "expense_date cannot be in the future",
            );
        }
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "expense_date is required"),
    };
    let amount_net = match input.amount_net {
        Some(value) => value,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "amount_net is required"),
    };
    let amount_vat = match input.amount_vat {
        Some(value) => value,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "amount_vat is required"),
    };
    let amount_gross = match input.amount_gross {
        Some(value) => value,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "amount_gross is required"),
    };
    if let Err(response) = validate_amounts(amount_net, amount_vat, amount_gross) {
        return response;
    }
    let currency = match input.currency.take() {
        Some(value) => value,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "currency is required"),
    };
    let paid_by = match input.paid_by.take() {
        Some(value) if matches!(value.as_str(), "patient" | "agency" | "unpaid") => value,
        _ => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "paid_by must be patient, agency, or unpaid",
            );
        }
    };
    let service_delivered = match input.service_delivered {
        Some(value) => value,
        None => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "service_delivered is required",
            );
        }
    };
    let data = match input.file_data.take() {
        Some(value) if !value.is_empty() => value,
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "receipt file is required"),
    };
    let file_name = input
        .file_name
        .take()
        .unwrap_or_else(|| "receipt".to_string());
    let declared_mime = input
        .declared_mime
        .take()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let mime_type = match validate_upload_magic_bytes(
        Some(file_name.as_str()),
        Some(declared_mime.as_str()),
        &data,
    ) {
        Ok(Some(value)) => value,
        Ok(None) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Receipt must be a PDF, JPEG, PNG, or WEBP file",
            );
        }
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if !matches!(
        mime_type.as_str(),
        "application/pdf" | "image/jpeg" | "image/png" | "image/webp"
    ) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Receipt must be a PDF, JPEG, PNG, or WEBP file",
        );
    }
    match scan_upload_bytes(Some(file_name.as_str()), &data).await {
        Ok(FileScanOutcome::Clean) => {}
        Ok(FileScanOutcome::Skipped) => {
            tracing::warn!(filename = %file_name, "virus scanner unavailable; concierge receipt scan skipped");
        }
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    }

    let receipt_sha256 = hash_bytes(&data);
    let payload_value = json!({
        "service_id": service_id,
        "order_id": input.order_id,
        "order_leistung_id": input.order_leistung_id,
        "vendor": vendor,
        "expense_date": expense_date,
        "amount_net": amount_net.to_string(),
        "amount_vat": amount_vat.to_string(),
        "amount_gross": amount_gross.to_string(),
        "currency": currency,
        "paid_by": paid_by,
        "service_delivered": service_delivered,
        "note": input.note,
        "receipt_sha256": receipt_sha256,
        "mime_type": mime_type,
        "original_filename": file_name,
    });
    let payload_hash = hash_json(&payload_value);

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin concierge expense submission");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to submit expense",
            );
        }
    };
    let service = match lock_service_context(&mut transaction, service_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !can_submit_expense(&auth, &service) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if service.currency != currency {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Expense currency must match the Concierge service",
        );
    }

    let existing = match sqlx::query(
        r#"SELECT id, payload_hash
           FROM concierge_expense_submissions
           WHERE concierge_service_id = $1 AND request_id = $2
           FOR UPDATE"#,
    )
    .bind(service_id)
    .bind(request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, service_id = %service_id, "load expense submission replay");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to submit expense",
            );
        }
    };
    if let Some(row) = existing {
        let expense_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let same_payload =
            row.try_get::<String, _>("payload_hash").unwrap_or_default() == payload_hash;
        drop(transaction);
        if !same_payload {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        return expense_mutation_response(
            &state,
            &auth,
            service_id,
            expense_id,
            true,
            StatusCode::OK,
        )
        .await;
    }

    let duplicate_receipt = match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM concierge_expense_submissions
           WHERE concierge_service_id = $1 AND receipt_sha256 = $2
           FOR UPDATE"#,
    )
    .bind(service_id)
    .bind(&receipt_sha256)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, service_id = %service_id, "check duplicate concierge receipt");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to submit expense",
            );
        }
    };
    if duplicate_receipt.is_some() {
        return err(
            StatusCode::CONFLICT,
            "This receipt was already submitted for the Concierge service",
        );
    }

    if let Some(order_id) = input.order_id {
        let order = match sqlx::query(
            r#"SELECT patient_id, UPPER(currency) AS currency, status
               FROM orders WHERE id = $1 FOR UPDATE"#,
        )
        .bind(order_id)
        .fetch_optional(&mut *transaction)
        .await
        {
            Ok(Some(row)) => row,
            Ok(None) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Order not found"),
            Err(error) => {
                tracing::error!(error = %error, order_id = %order_id, "validate concierge expense order");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to submit expense",
                );
            }
        };
        if order.try_get::<Uuid, _>("patient_id").ok() != Some(service.patient_id)
            || order.try_get::<String, _>("currency").unwrap_or_default() != currency
            || order.try_get::<String, _>("status").unwrap_or_default() == "cancelled"
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order must be active, use the same patient, and match the currency",
            );
        }
    }
    if let Some(order_leistung_id) = input.order_leistung_id {
        let valid = match sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1 FROM order_leistungen
                   WHERE id = $1 AND order_id = $2 AND UPPER(currency) = $3
               )"#,
        )
        .bind(order_leistung_id)
        .bind(input.order_id)
        .bind(&currency)
        .fetch_one(&mut *transaction)
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, order_leistung_id = %order_leistung_id, "validate concierge expense order service");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to submit expense",
                );
            }
        };
        if !valid {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order service must belong to the selected order and currency",
            );
        }
    }

    let (file_size, storage_key, original_filename) =
        match store_document_blob(&data, file_name.as_str()).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    let document_id = Uuid::new_v4();
    let expense_id = Uuid::new_v4();
    let document_insert = sqlx::query(
        r#"INSERT INTO documents (
               id, patient_id, order_id, auto_name, original_filename,
               art, category, status, visibility, is_medical, mime_type, file_size,
               storage_key, klinik, ursprung, notes,
               document_direction, document_variant, access_category,
               document_date, source_person, source_institution,
               addressee_institution, financial_status,
               version_root_document_id, version_number, uploaded_by
           ) VALUES (
               $1, $2, $3, $4, $5,
               'receipt', 'payment', 'active', 'internal', false, $6, $7,
               $8, $9, 'concierge_expense_receipt', $10,
               'incoming', 'original', 'financial',
               $11, $12, $9,
               'GMED', 'open',
               $1, 1, $13
           )"#,
    )
    .bind(document_id)
    .bind(service.patient_id)
    .bind(input.order_id)
    .bind(format!("Receipt - {vendor}"))
    .bind(&original_filename)
    .bind(&mime_type)
    .bind(file_size)
    .bind(&storage_key)
    .bind(&vendor)
    .bind(input.note.as_deref())
    .bind(expense_date)
    .bind(format!("Concierge service {service_id}"))
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = document_insert {
        tracing::error!(error = %error, service_id = %service_id, "insert concierge receipt document");
        remove_document_blob(&storage_key).await;
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save receipt");
    }

    let expense_insert = sqlx::query(
        r#"INSERT INTO concierge_expense_submissions (
               id, concierge_service_id, request_id, patient_id, order_id,
               order_leistung_id, receipt_document_id, vendor_name, expense_date,
               amount_net, amount_vat, amount_gross, currency, paid_by,
               service_delivered, note, payload_hash, receipt_sha256,
               submitted_by
           ) VALUES (
               $1, $2, $3, $4, $5,
               $6, $7, $8, $9,
               $10, $11, $12, $13, $14,
               $15, $16, $17, $18,
               $19
           )"#,
    )
    .bind(expense_id)
    .bind(service_id)
    .bind(request_id)
    .bind(service.patient_id)
    .bind(input.order_id)
    .bind(input.order_leistung_id)
    .bind(document_id)
    .bind(&vendor)
    .bind(expense_date)
    .bind(amount_net)
    .bind(amount_vat)
    .bind(amount_gross)
    .bind(&currency)
    .bind(&paid_by)
    .bind(service_delivered)
    .bind(input.note.as_deref())
    .bind(&payload_hash)
    .bind(&receipt_sha256)
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = expense_insert {
        tracing::warn!(error = %error, service_id = %service_id, "insert concierge expense submission rejected");
        remove_document_blob(&storage_key).await;
        return err(StatusCode::CONFLICT, "Expense submission was rejected");
    }
    let notification_deliveries = match insert_finance_review_notifications(
        &mut transaction,
        expense_id,
        auth.user_id,
        &vendor,
        amount_gross,
        &currency,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "create Concierge expense review notifications");
            remove_document_blob(&storage_key).await;
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to notify financial review",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, expense_id = %expense_id, "commit concierge expense submission");
        remove_document_blob(&storage_key).await;
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to submit expense",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "submit_concierge_expense_receipt",
        Some(auth.user_id),
        "concierge_expense",
        Some(expense_id),
        json!({
            "concierge_service_id": service_id,
            "patient_id": service.patient_id,
            "order_id": input.order_id,
            "receipt_document_id": document_id,
            "amount_gross": amount_gross.to_string(),
            "currency": currency,
            "paid_by": paid_by,
            "status": "pending_review",
        }),
    ));
    crate::realtime::publish_concierge_service_event(
        &state,
        Some(auth.user_id),
        "concierge_expense.submitted",
        service_id,
        json!({ "expense_id": expense_id, "status": "pending_review" }),
    )
    .await;
    publish_notification_deliveries(&state, notification_deliveries, expense_id).await;

    expense_mutation_response(
        &state,
        &auth,
        service_id,
        expense_id,
        false,
        StatusCode::CREATED,
    )
    .await
}

fn decimal_string(row: &sqlx::postgres::PgRow, column: &str) -> String {
    row.try_get::<Decimal, _>(column)
        .unwrap_or(Decimal::ZERO)
        .round_dp(2)
        .to_string()
}

async fn load_expense_item(
    state: &AppState,
    service_id: Uuid,
    expense_id: Uuid,
) -> Result<Option<Value>, Response> {
    let row = match sqlx::query(
        r#"SELECT submission.id, submission.concierge_service_id,
                  submission.patient_id, submission.order_id AS submitted_order_id,
                  submission.order_leistung_id AS submitted_order_leistung_id,
                  submission.vendor_name, submission.expense_date,
                  submission.amount_net, submission.amount_vat,
                  submission.amount_gross, submission.currency,
                  submission.paid_by, submission.service_delivered,
                  submission.note, submission.submitted_by,
                  submission.created_at,
                  submitter.name AS submitter_name,
                  document.id AS document_id, document.original_filename,
                  document.mime_type, document.file_size,
                  initial.id AS initial_review_id,
                  initial.action AS initial_action,
                  initial.reason AS initial_reason,
                  initial.external_invoice_id,
                  initial.provider_payment_transaction_id,
                  initial.decided_by AS initial_decided_by,
                  initial.created_at AS initial_decided_at,
                  initial_actor.name AS initial_actor_name,
                  reversal.id AS reversal_id,
                  reversal.reason AS reversal_reason,
                  reversal.decided_by AS reversal_decided_by,
                  reversal.created_at AS reversal_decided_at,
                  reversal_actor.name AS reversal_actor_name,
                  external.status AS external_status,
                  external.paid_by AS external_paid_by,
                  external.service_delivered AS external_service_delivered,
                  external.order_id AS posted_order_id,
                  external.order_leistung_id AS posted_order_leistung_id,
                  external.patient_receivable_gross,
                  external.provider_liability_gross,
                  settlement.company_paid_gross,
                  settlement.remaining_provider_liability_gross,
                  settlement.settlement_status,
                  order_row.order_number,
                  COALESCE(service.agency_service_name_snapshot, service.description)
                      AS order_leistung_name
           FROM concierge_expense_submissions submission
           JOIN users submitter ON submitter.id = submission.submitted_by
           JOIN documents document ON document.id = submission.receipt_document_id
           LEFT JOIN concierge_expense_review_events initial
             ON initial.expense_id = submission.id
            AND initial.action IN ('posted', 'rejected')
           LEFT JOIN users initial_actor ON initial_actor.id = initial.decided_by
           LEFT JOIN concierge_expense_review_events reversal
             ON reversal.reverses_event_id = initial.id
            AND reversal.action = 'reversed'
           LEFT JOIN users reversal_actor ON reversal_actor.id = reversal.decided_by
           LEFT JOIN external_invoices external ON external.id = initial.external_invoice_id
           LEFT JOIN external_invoice_provider_settlement_balances settlement
             ON settlement.external_invoice_id = external.id
           LEFT JOIN orders order_row
             ON order_row.id = COALESCE(external.order_id, submission.order_id)
           LEFT JOIN order_leistungen service
             ON service.id = COALESCE(external.order_leistung_id, submission.order_leistung_id)
           WHERE submission.concierge_service_id = $1
             AND submission.id = $2"#,
    )
    .bind(service_id)
    .bind(expense_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "load concierge expense item");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load expense",
            ));
        }
    };
    let Some(row) = row else {
        return Ok(None);
    };

    let initial_action = row
        .try_get::<Option<String>, _>("initial_action")
        .unwrap_or_default();
    let reversed = row
        .try_get::<Option<Uuid>, _>("reversal_id")
        .unwrap_or_default()
        .is_some();
    let status = if reversed {
        "reversed"
    } else {
        initial_action.as_deref().unwrap_or("pending_review")
    };
    let amount_gross = row
        .try_get::<Decimal, _>("amount_gross")
        .unwrap_or(Decimal::ZERO);
    let paid_by = row
        .try_get::<String, _>("paid_by")
        .unwrap_or_else(|_| "unpaid".to_string());
    let service_delivered = row.try_get::<bool, _>("service_delivered").unwrap_or(false);
    let posted = status == "posted";
    let intended_receivable = if paid_by == "agency" || (paid_by == "unpaid" && service_delivered) {
        amount_gross
    } else {
        Decimal::ZERO
    };
    let intended_company_paid = if paid_by == "agency" {
        amount_gross
    } else {
        Decimal::ZERO
    };
    let intended_liability = if paid_by == "unpaid" {
        amount_gross
    } else {
        Decimal::ZERO
    };
    let patient_receivable = if posted {
        row.try_get::<Option<Decimal>, _>("patient_receivable_gross")
            .unwrap_or_default()
            .unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };
    let provider_liability = if posted {
        row.try_get::<Option<Decimal>, _>("remaining_provider_liability_gross")
            .unwrap_or_default()
            .or_else(|| {
                row.try_get::<Option<Decimal>, _>("provider_liability_gross")
                    .unwrap_or_default()
            })
            .unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };
    let company_paid = if posted {
        row.try_get::<Option<Decimal>, _>("company_paid_gross")
            .unwrap_or_default()
            .unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };

    let mut history = Vec::new();
    history.push(json!({
        "action": "submitted",
        "actor": {
            "id": row.try_get::<Uuid, _>("submitted_by").unwrap_or_default(),
            "display_name": row.try_get::<String, _>("submitter_name").unwrap_or_default(),
        },
        "reason": Value::Null,
        "created_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").ok(),
    }));
    if let Some(action) = initial_action.as_deref() {
        history.push(json!({
            "action": action,
            "actor": {
                "id": row.try_get::<Option<Uuid>, _>("initial_decided_by").unwrap_or_default(),
                "display_name": row.try_get::<Option<String>, _>("initial_actor_name").unwrap_or_default(),
            },
            "reason": row.try_get::<Option<String>, _>("initial_reason").unwrap_or_default(),
            "created_at": row.try_get::<Option<chrono::DateTime<Utc>>, _>("initial_decided_at").unwrap_or_default(),
        }));
    }
    if reversed {
        history.push(json!({
            "action": "reversed",
            "actor": {
                "id": row.try_get::<Option<Uuid>, _>("reversal_decided_by").unwrap_or_default(),
                "display_name": row.try_get::<Option<String>, _>("reversal_actor_name").unwrap_or_default(),
            },
            "reason": row.try_get::<Option<String>, _>("reversal_reason").unwrap_or_default(),
            "created_at": row.try_get::<Option<chrono::DateTime<Utc>>, _>("reversal_decided_at").unwrap_or_default(),
        }));
    }

    Ok(Some(json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "concierge_service_id": row.try_get::<Uuid, _>("concierge_service_id").unwrap_or_default(),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        "order_id": row.try_get::<Option<Uuid>, _>("posted_order_id").unwrap_or_default()
            .or_else(|| row.try_get::<Option<Uuid>, _>("submitted_order_id").unwrap_or_default()),
        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
        "order_leistung_id": row.try_get::<Option<Uuid>, _>("posted_order_leistung_id").unwrap_or_default()
            .or_else(|| row.try_get::<Option<Uuid>, _>("submitted_order_leistung_id").unwrap_or_default()),
        "order_leistung_name": row.try_get::<Option<String>, _>("order_leistung_name").unwrap_or_default(),
        "vendor": row.try_get::<String, _>("vendor_name").unwrap_or_default(),
        "expense_date": row.try_get::<NaiveDate, _>("expense_date").ok(),
        "amount_net": decimal_string(&row, "amount_net"),
        "amount_vat": decimal_string(&row, "amount_vat"),
        "amount_gross": amount_gross.round_dp(2).to_string(),
        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
        "paid_by": paid_by,
        "service_delivered": service_delivered,
        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
        "status": status,
        "submitted_by": {
            "id": row.try_get::<Uuid, _>("submitted_by").unwrap_or_default(),
            "display_name": row.try_get::<String, _>("submitter_name").unwrap_or_default(),
        },
        "submitted_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").ok(),
        "receipt": {
            "document_id": row.try_get::<Uuid, _>("document_id").unwrap_or_default(),
            "original_filename": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
            "mime_type": row.try_get::<Option<String>, _>("mime_type").unwrap_or_default(),
            "file_size": row.try_get::<Option<i64>, _>("file_size").unwrap_or_default(),
            "download_url": format!("/api/v1/concierge-services/{service_id}/expenses/{expense_id}/receipt"),
        },
        "external_invoice": row.try_get::<Option<Uuid>, _>("external_invoice_id").unwrap_or_default().map(|id| json!({
            "id": id,
            "status": row.try_get::<Option<String>, _>("external_status").unwrap_or_default(),
            "paid_by": row.try_get::<Option<String>, _>("external_paid_by").unwrap_or_default(),
            "service_delivered": row.try_get::<Option<bool>, _>("external_service_delivered").unwrap_or_default(),
            "provider_payment_transaction_id": row.try_get::<Option<Uuid>, _>("provider_payment_transaction_id").unwrap_or_default(),
            "settlement_status": row.try_get::<Option<String>, _>("settlement_status").unwrap_or_default(),
        })),
        "balance_consequence": {
            "posting_pending": status == "pending_review",
            "patient_receivable_gross": patient_receivable.round_dp(2).to_string(),
            "company_paid_gross": company_paid.round_dp(2).to_string(),
            "provider_liability_gross": provider_liability.round_dp(2).to_string(),
            "intended_patient_receivable_gross": intended_receivable.round_dp(2).to_string(),
            "intended_company_paid_gross": intended_company_paid.round_dp(2).to_string(),
            "intended_provider_liability_gross": intended_liability.round_dp(2).to_string(),
        },
        "history": history,
    })))
}

async fn expense_mutation_response(
    state: &AppState,
    auth: &AuthUser,
    service_id: Uuid,
    expense_id: Uuid,
    idempotent_replay: bool,
    status: StatusCode,
) -> Response {
    let context = match load_service_context(state, service_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !can_read_expenses(auth, &context) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    match load_expense_item(state, service_id, expense_id).await {
        Ok(Some(item)) => (
            status,
            Json(json!({
                "item": item,
                "idempotent_replay": idempotent_replay,
            })),
        )
            .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Expense not found"),
        Err(response) => response,
    }
}

async fn list_expense_review_queue(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ExpenseReviewQueueQuery>,
) -> Response {
    if let Err(response) = require_finance(&auth) {
        return response;
    }

    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(100);
    if page < 1 || !(1..=100).contains(&page_size) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "page must be at least 1 and page_size must be between 1 and 100",
        );
    }
    let offset = page.saturating_sub(1).saturating_mul(page_size);

    let total =
        match sqlx::query_scalar::<_, i64>("SELECT count(*) FROM concierge_expense_submissions")
            .fetch_one(&state.db)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, "count Concierge expense review queue");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load expense review queue",
                );
            }
        };

    let rows = match sqlx::query(
        r#"SELECT submission.id AS expense_id,
                  submission.concierge_service_id,
                  service.patient_id,
                  trim(concat_ws(' ', patient.first_name, patient.last_name)) AS patient_name,
                  patient.patient_id AS patient_pid,
                  service.title,
                  service.status AS service_status,
                  UPPER(service.currency) AS service_currency,
                  service.provider_id,
                  provider.name AS provider_name
           FROM concierge_expense_submissions submission
           JOIN concierge_services service ON service.id = submission.concierge_service_id
           JOIN patients patient ON patient.id = service.patient_id
           LEFT JOIN providers provider ON provider.id = service.provider_id
           LEFT JOIN LATERAL (
               SELECT event.id, event.action
               FROM concierge_expense_review_events event
               WHERE event.expense_id = submission.id
                 AND event.action IN ('posted', 'rejected')
               ORDER BY event.created_at DESC, event.id DESC
               LIMIT 1
           ) initial ON true
           LEFT JOIN LATERAL (
               SELECT event.id
               FROM concierge_expense_review_events event
               WHERE event.reverses_event_id = initial.id
                 AND event.action = 'reversed'
               ORDER BY event.created_at DESC, event.id DESC
               LIMIT 1
           ) reversal ON true
           ORDER BY CASE
                        WHEN reversal.id IS NOT NULL THEN 3
                        WHEN initial.action = 'posted' THEN 1
                        WHEN initial.action = 'rejected' THEN 2
                        ELSE 0
                    END,
                    submission.created_at DESC,
                    submission.id DESC
           LIMIT $1 OFFSET $2"#,
    )
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, page, page_size, "load Concierge expense review queue page");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load expense review queue",
            );
        }
    };

    let loaded_count = rows.len() as i64;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let expense_id = row.try_get::<Uuid, _>("expense_id").unwrap_or_default();
        let service_id = row
            .try_get::<Uuid, _>("concierge_service_id")
            .unwrap_or_default();
        let service = json!({
            "id": service_id,
            "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
            "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "status": row.try_get::<String, _>("service_status").unwrap_or_default(),
            "currency": row.try_get::<String, _>("service_currency").unwrap_or_else(|_| "EUR".to_string()),
            "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
            "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
        });
        match load_expense_item(&state, service_id, expense_id).await {
            Ok(Some(mut item)) => {
                if let Some(object) = item.as_object_mut() {
                    object.insert("service".to_string(), service);
                }
                items.push(item);
            }
            Ok(None) => {}
            Err(response) => return response,
        }
    }

    Json(json!({
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": offset.saturating_add(loaded_count) < total,
    }))
    .into_response()
}

async fn list_expenses(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
) -> Response {
    let context = match load_service_context(&state, service_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !can_read_expenses(&auth, &context) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let ids = match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM concierge_expense_submissions
           WHERE concierge_service_id = $1
           ORDER BY created_at DESC, id DESC"#,
    )
    .bind(service_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, service_id = %service_id, "list concierge expense ids");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list expenses");
        }
    };
    let mut items = Vec::with_capacity(ids.len());
    for expense_id in ids {
        match load_expense_item(&state, service_id, expense_id).await {
            Ok(Some(item)) => items.push(item),
            Ok(None) => {}
            Err(response) => return response,
        }
    }
    Json(json!({ "items": items })).into_response()
}

async fn download_receipt(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((service_id, expense_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let context = match load_service_context(&state, service_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if !can_read_expenses(&auth, &context) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let row = match sqlx::query(
        r#"SELECT document.id, document.storage_key, document.mime_type,
                  document.original_filename, document.auto_name
           FROM concierge_expense_submissions submission
           JOIN documents document ON document.id = submission.receipt_document_id
           WHERE submission.concierge_service_id = $1 AND submission.id = $2"#,
    )
    .bind(service_id)
    .bind(expense_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Receipt not found"),
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "load concierge receipt");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load receipt");
        }
    };
    let document_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
    let storage_key = row
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default();
    let Some(storage_key) = storage_key else {
        return err(StatusCode::NOT_FOUND, "Receipt file is not stored");
    };
    let mime_type = row
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let auto_name = row
        .try_get::<String, _>("auto_name")
        .unwrap_or_else(|_| "receipt".to_string());
    let filename = row
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default()
        .unwrap_or_else(|| auto_name.clone());
    let data = match read_document_storage_bytes(
        document_id,
        storage_key.as_str(),
        Some(mime_type.as_str()),
        Some(filename.as_str()),
        Some(auto_name.as_str()),
    )
    .await
    {
        Ok(value) => value,
        Err(_) => return err(StatusCode::NOT_FOUND, "Receipt file not found on disk"),
    };
    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));
    (
        [
            (header::CONTENT_TYPE, mime_type),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, "private, no-store".to_string()),
        ],
        data,
    )
        .into_response()
}

async fn lock_expense(
    transaction: &mut Transaction<'_, Postgres>,
    service_id: Uuid,
    expense_id: Uuid,
) -> Result<LockedExpense, Response> {
    match sqlx::query(
        r#"SELECT id, patient_id, order_id, order_leistung_id, vendor_name,
                  expense_date, amount_net, amount_vat, amount_gross,
                  currency, paid_by, service_delivered, note
           FROM concierge_expense_submissions
           WHERE id = $1 AND concierge_service_id = $2
           FOR UPDATE"#,
    )
    .bind(expense_id)
    .bind(service_id)
    .fetch_optional(&mut **transaction)
    .await
    {
        Ok(Some(row)) => Ok(LockedExpense {
            id: row
                .try_get("id")
                .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?,
            patient_id: row
                .try_get("patient_id")
                .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?,
            submitted_order_id: row.try_get("order_id").unwrap_or_default(),
            submitted_order_leistung_id: row.try_get("order_leistung_id").unwrap_or_default(),
            vendor_name: row.try_get("vendor_name").unwrap_or_default(),
            expense_date: row
                .try_get("expense_date")
                .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?,
            amount_net: row
                .try_get("amount_net")
                .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?,
            amount_vat: row
                .try_get("amount_vat")
                .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?,
            amount_gross: row
                .try_get("amount_gross")
                .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?,
            currency: row
                .try_get("currency")
                .unwrap_or_else(|_| "EUR".to_string()),
            paid_by: row
                .try_get("paid_by")
                .unwrap_or_else(|_| "unpaid".to_string()),
            service_delivered: row.try_get("service_delivered").unwrap_or(false),
            note: row.try_get("note").unwrap_or_default(),
        }),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Expense not found")),
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "lock concierge expense");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load expense",
            ))
        }
    }
}

async fn review_request_replay(
    transaction: &mut Transaction<'_, Postgres>,
    expense_id: Uuid,
    request_id: Uuid,
    expected_action: &str,
    payload_hash: &str,
) -> Result<Option<bool>, Response> {
    let row = sqlx::query(
        r#"SELECT action, payload_hash
           FROM concierge_expense_review_events
           WHERE expense_id = $1 AND request_id = $2
           FOR UPDATE"#,
    )
    .bind(expense_id)
    .bind(request_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, expense_id = %expense_id, "load concierge expense review replay");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review expense")
    })?;
    let Some(row) = row else {
        return Ok(None);
    };
    let same = row.try_get::<String, _>("action").unwrap_or_default() == expected_action
        && row.try_get::<String, _>("payload_hash").unwrap_or_default() == payload_hash;
    Ok(Some(same))
}

async fn has_initial_review(
    transaction: &mut Transaction<'_, Postgres>,
    expense_id: Uuid,
) -> Result<bool, Response> {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1 FROM concierge_expense_review_events
               WHERE expense_id = $1 AND action IN ('posted', 'rejected')
           )"#,
    )
    .bind(expense_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, expense_id = %expense_id, "check concierge expense initial review");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review expense")
    })
}

async fn post_expense(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((service_id, expense_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PostExpenseRequest>,
) -> Response {
    if let Err(response) = require_finance(&auth) {
        return response;
    }
    let payment_method = match normalize_payment_method(body.payment_method.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let payment_reference = clean_text(body.payment_reference.clone(), 500);
    let payload_hash = hash_json(&json!({
        "action": "posted",
        "order_id": body.order_id,
        "order_leistung_id": body.order_leistung_id,
        "financial_account_id": body.financial_account_id,
        "paid_on": body.paid_on,
        "payment_method": payment_method,
        "payment_reference": payment_reference,
    }));
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin concierge expense post");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
        }
    };
    let service = match lock_service_context(&mut transaction, service_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let expense = match lock_expense(&mut transaction, service_id, expense_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let agency_paid_on = if expense.paid_by == "agency" {
        match body.paid_on {
            Some(value) if value >= expense.expense_date && value <= Utc::now().date_naive() => {
                Some(value)
            }
            Some(_) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "paid_on must be between the expense date and today",
                );
            }
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "paid_on is required for an agency-paid expense",
                );
            }
        }
    } else {
        None
    };
    match review_request_replay(
        &mut transaction,
        expense_id,
        body.request_id,
        "posted",
        &payload_hash,
    )
    .await
    {
        Ok(Some(true)) => {
            drop(transaction);
            return expense_mutation_response(
                &state,
                &auth,
                service_id,
                expense_id,
                true,
                StatusCode::OK,
            )
            .await;
        }
        Ok(Some(false)) => {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        Ok(None) => {}
        Err(response) => return response,
    }
    match has_initial_review(&mut transaction, expense_id).await {
        Ok(false) => {}
        Ok(true) => return err(StatusCode::CONFLICT, "Expense was already reviewed"),
        Err(response) => return response,
    }
    if expense
        .submitted_order_id
        .is_some_and(|value| value != body.order_id)
        || expense
            .submitted_order_leistung_id
            .is_some_and(|value| Some(value) != body.order_leistung_id)
    {
        return err(
            StatusCode::CONFLICT,
            "Finance mapping cannot replace an order mapping captured with the receipt",
        );
    }
    let order = match sqlx::query(
        r#"SELECT patient_id, UPPER(currency) AS currency, status
           FROM orders WHERE id = $1 FOR UPDATE"#,
    )
    .bind(body.order_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Order not found"),
        Err(error) => {
            tracing::error!(error = %error, order_id = %body.order_id, "load finance-mapped expense order");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
        }
    };
    if order.try_get::<Uuid, _>("patient_id").ok() != Some(expense.patient_id)
        || order.try_get::<String, _>("currency").unwrap_or_default() != expense.currency
        || order.try_get::<String, _>("status").unwrap_or_default() == "cancelled"
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Order must be active, belong to the same patient, and match the expense currency",
        );
    }

    let line_provider_id = if let Some(order_leistung_id) = body.order_leistung_id {
        let row = match sqlx::query(
            r#"SELECT provider_id FROM order_leistungen
               WHERE id = $1 AND order_id = $2 AND UPPER(currency) = $3
               FOR UPDATE"#,
        )
        .bind(order_leistung_id)
        .bind(body.order_id)
        .bind(&expense.currency)
        .fetch_optional(&mut *transaction)
        .await
        {
            Ok(Some(row)) => row,
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Order service must belong to the selected order and currency",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, order_leistung_id = %order_leistung_id, "load finance-mapped order service");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
            }
        };
        row.try_get::<Option<Uuid>, _>("provider_id")
            .unwrap_or_default()
    } else {
        None
    };
    if service.provider_id.is_some()
        && line_provider_id.is_some()
        && service.provider_id != line_provider_id
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Concierge partner and order service provider must match",
        );
    }
    let provider_id = line_provider_id.or(service.provider_id);
    if expense.paid_by != "patient" && provider_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A non-medical partner or service provider is required before posting",
        );
    }
    if let Some(provider_id) = provider_id {
        let valid = match sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1 FROM providers
                   WHERE id = $1 AND provider_type = 'non_medical' AND is_active
               )"#,
        )
        .bind(provider_id)
        .fetch_one(&mut *transaction)
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, provider_id = %provider_id, "validate Concierge expense provider");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
            }
        };
        if !valid {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Expense provider must be an active non-medical partner",
            );
        }
    }

    let financial_account_id = if expense.paid_by == "agency" {
        let account_id = if let Some(value) = body.financial_account_id {
            value
        } else {
            match sqlx::query_scalar::<_, Uuid>(
                r#"SELECT id FROM company_financial_accounts
                   WHERE currency = $1 AND is_default AND is_active
                   ORDER BY created_at, id LIMIT 1
                   FOR SHARE"#,
            )
            .bind(&expense.currency)
            .fetch_optional(&mut *transaction)
            .await
            {
                Ok(Some(value)) => value,
                Ok(None) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "An active financial account is required for an agency-paid expense",
                    );
                }
                Err(error) => {
                    tracing::error!(error = %error, "resolve expense financial account");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
                }
            }
        };
        let account = match sqlx::query(
            r#"SELECT currency, opening_balance_on, is_active
               FROM company_financial_accounts WHERE id = $1 FOR SHARE"#,
        )
        .bind(account_id)
        .fetch_optional(&mut *transaction)
        .await
        {
            Ok(Some(row)) => row,
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Financial account not found",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, "load expense financial account");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
            }
        };
        if account.try_get::<String, _>("currency").unwrap_or_default() != expense.currency
            || !account.try_get::<bool, _>("is_active").unwrap_or(false)
            || account
                .try_get::<NaiveDate, _>("opening_balance_on")
                .is_ok_and(|date| agency_paid_on.is_some_and(|paid_on| paid_on < date))
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Financial account must be active, use the same currency, and cover the expense date",
            );
        }
        Some(account_id)
    } else {
        None
    };

    let external_invoice_id = Uuid::new_v4();
    let external_invoice_number = format!("CON-{}", expense.id.simple());
    let initial_status = match expense.paid_by.as_str() {
        "patient" => "paid",
        "agency" => "approved",
        _ if expense.service_delivered => "approved",
        _ => "received",
    };
    let initial_paid_by = if expense.paid_by == "patient" {
        "patient"
    } else {
        "unpaid"
    };
    let paid_at = if expense.paid_by == "patient" {
        Some(expense.expense_date)
    } else {
        None
    };
    if let Err(error) = sqlx::query(
        r#"INSERT INTO external_invoices (
               id, order_id, patient_id, provider_id, order_leistung_id,
               external_invoice_number, invoice_date,
               amount_net, amount_vat, amount_gross, currency,
               status, paid_by, service_delivered, received_at, paid_at,
               notes, created_by
           ) VALUES (
               $1, $2, $3, $4, $5,
               $6, $7,
               $8, $9, $10, $11,
               $12, $13, $14, now(), $15::date + TIME '12:00',
               $16, $17
           )"#,
    )
    .bind(external_invoice_id)
    .bind(body.order_id)
    .bind(expense.patient_id)
    .bind(provider_id)
    .bind(body.order_leistung_id)
    .bind(&external_invoice_number)
    .bind(expense.expense_date)
    .bind(expense.amount_net)
    .bind(expense.amount_vat)
    .bind(expense.amount_gross)
    .bind(&expense.currency)
    .bind(initial_status)
    .bind(initial_paid_by)
    .bind(expense.service_delivered)
    .bind(paid_at)
    .bind(format!(
        "Concierge receipt expense {} - {}{}",
        expense.id,
        expense.vendor_name,
        expense
            .note
            .as_deref()
            .map(|value| format!(" - {value}"))
            .unwrap_or_default(),
    ))
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::warn!(error = %error, expense_id = %expense_id, "insert canonical external invoice for Concierge expense");
        return err(
            StatusCode::CONFLICT,
            "Expense could not be posted to the selected order",
        );
    }

    let mut provider_payment_transaction_id = None;
    if expense.paid_by == "agency" {
        let account_id = financial_account_id.expect("agency financial account validated");
        let payment_id = Uuid::new_v4();
        if let Err(error) = sqlx::query(
            r#"INSERT INTO external_invoice_provider_payment_transactions (
                   id, external_invoice_id, financial_account_id, transaction_type,
                   request_id, amount_gross, currency, paid_on, payment_method,
                   reference, note, created_by
               ) VALUES (
                   $1, $2, $3, 'payment',
                   $4, $5, $6, $7, $8,
                   $9, $10, $11
               )"#,
        )
        .bind(payment_id)
        .bind(external_invoice_id)
        .bind(account_id)
        .bind(body.request_id)
        .bind(expense.amount_gross)
        .bind(&expense.currency)
        .bind(agency_paid_on.expect("agency payment date validated"))
        .bind(&payment_method)
        .bind(payment_reference.as_deref())
        .bind(Some(format!("Concierge expense {}", expense.id)))
        .bind(auth.user_id)
        .execute(&mut *transaction)
        .await
        {
            tracing::warn!(error = %error, expense_id = %expense_id, "insert Concierge provider payment");
            return err(StatusCode::CONFLICT, "Provider payment was rejected");
        }
        if let Err(error) = sqlx::query(
            r#"INSERT INTO accounting_entries (
                   entry_kind, direction, category, source_external_invoice_id,
                   source_external_provider_payment_transaction_id,
                   order_id, patient_id, entry_date, description,
                   amount_net, amount_vat, amount_gross, currency, metadata,
                   created_by, financial_account_id
               ) VALUES (
                   'external_invoice_payment', 'expense', 'provider_expense', $1,
                   $2, $3, $4, $5, $6,
                   $7, $8, $9, $10, $11,
                   $12, $13
               )"#,
        )
        .bind(external_invoice_id)
        .bind(payment_id)
        .bind(body.order_id)
        .bind(expense.patient_id)
        .bind(agency_paid_on.expect("agency payment date validated"))
        .bind(format!(
            "Concierge partner payment {external_invoice_number}"
        ))
        .bind(expense.amount_net)
        .bind(expense.amount_vat)
        .bind(expense.amount_gross)
        .bind(&expense.currency)
        .bind(json!({
            "concierge_expense_id": expense.id,
            "external_invoice_number": external_invoice_number,
            "provider_payment_transaction_id": payment_id,
            "payment_method": payment_method,
            "payment_reference": payment_reference,
        }))
        .bind(auth.user_id)
        .bind(account_id)
        .execute(&mut *transaction)
        .await
        {
            tracing::error!(error = %error, expense_id = %expense_id, "insert Concierge expense accounting entry");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
        }
        if let Err(error) = sqlx::query(
            r#"UPDATE external_invoices
               SET provider_settlement_base_status = 'approved',
                   status = 'paid', paid_by = 'agency',
                   paid_at = $2::date + TIME '12:00', updated_at = now()
               WHERE id = $1"#,
        )
        .bind(external_invoice_id)
        .bind(agency_paid_on.expect("agency payment date validated"))
        .execute(&mut *transaction)
        .await
        {
            tracing::warn!(error = %error, expense_id = %expense_id, "settle Concierge external invoice");
            return err(StatusCode::CONFLICT, "Expense settlement was rejected");
        }
        provider_payment_transaction_id = Some(payment_id);
    }

    let review_event_id = Uuid::new_v4();
    if let Err(error) = sqlx::query(
        r#"INSERT INTO concierge_expense_review_events (
               id, expense_id, request_id, action, external_invoice_id,
               provider_payment_transaction_id, payload_hash, decided_by
           ) VALUES ($1, $2, $3, 'posted', $4, $5, $6, $7)"#,
    )
    .bind(review_event_id)
    .bind(expense_id)
    .bind(body.request_id)
    .bind(external_invoice_id)
    .bind(provider_payment_transaction_id)
    .bind(&payload_hash)
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::warn!(error = %error, expense_id = %expense_id, "insert Concierge expense post review");
        return err(StatusCode::CONFLICT, "Expense review was rejected");
    }
    let notification_deliveries = match insert_concierge_decision_notifications(
        &mut transaction,
        expense_id,
        service_id,
        auth.user_id,
        "concierge_expense_posted",
        "Concierge expense approved",
        &format!(
            "The receipt from {} for {} {} was approved and posted.",
            expense.vendor_name,
            expense.amount_gross.round_dp(2),
            expense.currency
        ),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "create Concierge expense approval notifications");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to notify Concierge about the review",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, expense_id = %expense_id, "commit Concierge expense post");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to post expense");
    }

    state.audit_sender.try_send(audit::domain_event(
        "post_concierge_expense",
        Some(auth.user_id),
        "concierge_expense",
        Some(expense_id),
        json!({
            "review_event_id": review_event_id,
            "external_invoice_id": external_invoice_id,
            "provider_payment_transaction_id": provider_payment_transaction_id,
            "patient_id": expense.patient_id,
            "order_id": body.order_id,
            "amount_gross": expense.amount_gross.to_string(),
            "currency": expense.currency,
            "paid_by": expense.paid_by,
        }),
    ));
    crate::realtime::publish_concierge_service_event(
        &state,
        Some(auth.user_id),
        "concierge_expense.posted",
        service_id,
        json!({
            "expense_id": expense_id,
            "external_invoice_id": external_invoice_id,
            "status": "posted",
        }),
    )
    .await;
    publish_notification_deliveries(&state, notification_deliveries, expense_id).await;
    expense_mutation_response(&state, &auth, service_id, expense_id, false, StatusCode::OK).await
}

fn validate_reason(value: &str) -> Result<String, Response> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 2000 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reason must contain between 1 and 2000 characters",
        ));
    }
    Ok(value.to_string())
}

async fn reject_expense(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((service_id, expense_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<RejectExpenseRequest>,
) -> Response {
    if let Err(response) = require_finance(&auth) {
        return response;
    }
    let reason = match validate_reason(&body.reason) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let payload_hash = hash_json(&json!({ "action": "rejected", "reason": reason }));
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin Concierge expense rejection");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reject expense",
            );
        }
    };
    if let Err(response) = lock_service_context(&mut transaction, service_id).await {
        return response;
    }
    if let Err(response) = lock_expense(&mut transaction, service_id, expense_id).await {
        return response;
    }
    match review_request_replay(
        &mut transaction,
        expense_id,
        body.request_id,
        "rejected",
        &payload_hash,
    )
    .await
    {
        Ok(Some(true)) => {
            drop(transaction);
            return expense_mutation_response(
                &state,
                &auth,
                service_id,
                expense_id,
                true,
                StatusCode::OK,
            )
            .await;
        }
        Ok(Some(false)) => {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        Ok(None) => {}
        Err(response) => return response,
    }
    match has_initial_review(&mut transaction, expense_id).await {
        Ok(false) => {}
        Ok(true) => return err(StatusCode::CONFLICT, "Expense was already reviewed"),
        Err(response) => return response,
    }
    let event_id = Uuid::new_v4();
    if let Err(error) = sqlx::query(
        r#"INSERT INTO concierge_expense_review_events (
               id, expense_id, request_id, action, reason, payload_hash, decided_by
           ) VALUES ($1, $2, $3, 'rejected', $4, $5, $6)"#,
    )
    .bind(event_id)
    .bind(expense_id)
    .bind(body.request_id)
    .bind(&reason)
    .bind(&payload_hash)
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::warn!(error = %error, expense_id = %expense_id, "insert Concierge expense rejection");
        return err(StatusCode::CONFLICT, "Expense review was rejected");
    }
    let notification_deliveries = match insert_concierge_decision_notifications(
        &mut transaction,
        expense_id,
        service_id,
        auth.user_id,
        "concierge_expense_rejected",
        "Concierge expense rejected",
        &format!("The submitted receipt was rejected. Reason: {reason}"),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "create Concierge expense rejection notifications");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to notify Concierge about the review",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, expense_id = %expense_id, "commit Concierge expense rejection");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to reject expense",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "reject_concierge_expense",
        Some(auth.user_id),
        "concierge_expense",
        Some(expense_id),
        json!({ "review_event_id": event_id, "reason": reason }),
    ));
    crate::realtime::publish_concierge_service_event(
        &state,
        Some(auth.user_id),
        "concierge_expense.rejected",
        service_id,
        json!({ "expense_id": expense_id, "status": "rejected" }),
    )
    .await;
    publish_notification_deliveries(&state, notification_deliveries, expense_id).await;
    expense_mutation_response(&state, &auth, service_id, expense_id, false, StatusCode::OK).await
}

async fn reverse_expense(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((service_id, expense_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ReverseExpenseRequest>,
) -> Response {
    if let Err(response) = require_finance(&auth) {
        return response;
    }
    let reason = match validate_reason(&body.reason) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if body.reversed_on > Utc::now().date_naive() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reversed_on cannot be in the future",
        );
    }
    let payload_hash = hash_json(&json!({
        "action": "reversed",
        "reason": reason,
        "reversed_on": body.reversed_on,
    }));
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin Concierge expense reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
    };
    if let Err(response) = lock_service_context(&mut transaction, service_id).await {
        return response;
    }
    let expense = match lock_expense(&mut transaction, service_id, expense_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if body.reversed_on < expense.expense_date {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reversed_on cannot precede the expense date",
        );
    }
    match review_request_replay(
        &mut transaction,
        expense_id,
        body.request_id,
        "reversed",
        &payload_hash,
    )
    .await
    {
        Ok(Some(true)) => {
            drop(transaction);
            return expense_mutation_response(
                &state,
                &auth,
                service_id,
                expense_id,
                true,
                StatusCode::OK,
            )
            .await;
        }
        Ok(Some(false)) => {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        Ok(None) => {}
        Err(response) => return response,
    }

    let posted = match sqlx::query(
        r#"SELECT id, external_invoice_id, provider_payment_transaction_id
           FROM concierge_expense_review_events
           WHERE expense_id = $1 AND action = 'posted'
           FOR UPDATE"#,
    )
    .bind(expense_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(
                StatusCode::CONFLICT,
                "Only a posted expense can be reversed",
            );
        }
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "load posted Concierge expense review");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
    };
    let posted_event_id = posted.try_get::<Uuid, _>("id").unwrap_or_default();
    let external_invoice_id = posted
        .try_get::<Uuid, _>("external_invoice_id")
        .unwrap_or_default();
    let provider_payment_id = posted
        .try_get::<Option<Uuid>, _>("provider_payment_transaction_id")
        .unwrap_or_default();
    let already_reversed = match sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1 FROM concierge_expense_review_events
               WHERE reverses_event_id = $1 AND action = 'reversed'
           )"#,
    )
    .bind(posted_event_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "check Concierge expense reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
    };
    if already_reversed {
        return err(StatusCode::CONFLICT, "Expense was already reversed");
    }
    let external = match sqlx::query(
        r#"SELECT order_id, patient_id, external_invoice_number, status,
                  paid_by, amount_net, amount_vat, amount_gross, currency
           FROM external_invoices WHERE id = $1 FOR UPDATE"#,
    )
    .bind(external_invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Posted external invoice is missing"),
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "lock Concierge external invoice for reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
    };
    if external.try_get::<String, _>("status").unwrap_or_default() == "cancelled" {
        return err(
            StatusCode::CONFLICT,
            "Posted external invoice is already cancelled",
        );
    }

    if let Err(error) = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT patient_invoice.id
           FROM external_invoice_patient_invoice_allocations allocation
           JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
           WHERE allocation.external_invoice_id = $1
           ORDER BY patient_invoice.id
           FOR UPDATE OF patient_invoice"#,
    )
    .bind(external_invoice_id)
    .fetch_all(&mut *transaction)
    .await
    {
        tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "lock patient invoices before Concierge expense reversal");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to reverse expense",
        );
    }
    let active_allocation_count = match sqlx::query_scalar::<_, i64>(
        r#"SELECT count(*)
           FROM external_invoice_patient_invoice_allocations allocation
           JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
           WHERE allocation.external_invoice_id = $1
             AND allocation.reversed_at IS NULL
             AND patient_invoice.status NOT IN ('draft', 'cancelled')"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "check Concierge expense patient allocations before reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
    };
    if active_allocation_count > 0 {
        return err(
            StatusCode::CONFLICT,
            "Reverse the patient invoice allocation before reversing this expense",
        );
    }
    let uncorrected_patient_invoice_count = match sqlx::query_scalar::<_, i64>(
        r#"SELECT count(*)
           FROM (
               SELECT allocation.patient_invoice_id
               FROM external_invoice_patient_invoice_allocations allocation
               JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
               WHERE allocation.external_invoice_id = $1
                 AND patient_invoice.status NOT IN ('draft', 'cancelled')
               GROUP BY allocation.patient_invoice_id, patient_invoice.credited_amount
               HAVING COALESCE(patient_invoice.credited_amount, 0)
                      < SUM(allocation.amount_gross)
           ) uncorrected"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "check patient invoice correction before Concierge expense reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
    };
    if uncorrected_patient_invoice_count > 0 {
        return err(
            StatusCode::CONFLICT,
            "Cancel or credit the patient invoice for the allocated amount before reversing this expense",
        );
    }

    let net_provider_paid = match sqlx::query_scalar::<_, Decimal>(
        r#"SELECT COALESCE(SUM(
               CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
           ), 0)
           FROM external_invoice_provider_payment_transactions
           WHERE external_invoice_id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "sum provider payments before Concierge expense reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
    };
    if provider_payment_id.is_none() && net_provider_paid > Decimal::ZERO {
        return err(
            StatusCode::CONFLICT,
            "Reverse all provider payments before reversing this expense",
        );
    }
    if provider_payment_id.is_some()
        && net_provider_paid != expense.amount_gross
        && net_provider_paid != Decimal::ZERO
    {
        return err(
            StatusCode::CONFLICT,
            "Provider settlement changed; reverse it through the provider payment journal first",
        );
    }
    if let Some(payment_id) = provider_payment_id
        && net_provider_paid == Decimal::ZERO
    {
        let canonical_payment_reversed = match sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1
                   FROM external_invoice_provider_payment_transactions reversal
                   WHERE reversal.reverses_transaction_id = $1
                     AND reversal.transaction_type = 'reversal'
               )"#,
        )
        .bind(payment_id)
        .fetch_one(&mut *transaction)
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, payment_id = %payment_id, "verify canonical Concierge provider payment reversal");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to reverse expense",
                );
            }
        };
        if !canonical_payment_reversed {
            return err(
                StatusCode::CONFLICT,
                "Provider settlement must be reversed through the canonical journal first",
            );
        }
    }

    let mut provider_reversal_id = None;
    if let Some(payment_id) = provider_payment_id.filter(|_| net_provider_paid > Decimal::ZERO) {
        let payment = match sqlx::query(
            r#"SELECT financial_account_id, amount_gross, currency, paid_on,
                      payment_method, reference
               FROM external_invoice_provider_payment_transactions
               WHERE id = $1 AND external_invoice_id = $2
                 AND transaction_type = 'payment'
               FOR UPDATE"#,
        )
        .bind(payment_id)
        .bind(external_invoice_id)
        .fetch_optional(&mut *transaction)
        .await
        {
            Ok(Some(row)) => row,
            Ok(None) => return err(StatusCode::CONFLICT, "Provider payment is missing"),
            Err(error) => {
                tracing::error!(error = %error, payment_id = %payment_id, "load Concierge provider payment for reversal");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to reverse expense",
                );
            }
        };
        let paid_on = payment
            .try_get::<NaiveDate, _>("paid_on")
            .unwrap_or(expense.expense_date);
        if body.reversed_on < paid_on {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "reversed_on cannot precede the provider payment",
            );
        }
        let reversal_id = Uuid::new_v4();
        let account_id = payment
            .try_get::<Uuid, _>("financial_account_id")
            .unwrap_or_default();
        let payment_method = payment
            .try_get::<String, _>("payment_method")
            .unwrap_or_else(|_| "other".to_string());
        let reference = payment
            .try_get::<Option<String>, _>("reference")
            .unwrap_or_default();
        if let Err(error) = sqlx::query(
            r#"INSERT INTO external_invoice_provider_payment_transactions (
                   id, external_invoice_id, financial_account_id, transaction_type,
                   request_id, reverses_transaction_id, amount_gross, currency,
                   paid_on, payment_method, reference, note, created_by
               ) VALUES (
                   $1, $2, $3, 'reversal',
                   $4, $5, $6, $7,
                   $8, $9, $10, $11, $12
               )"#,
        )
        .bind(reversal_id)
        .bind(external_invoice_id)
        .bind(account_id)
        .bind(body.request_id)
        .bind(payment_id)
        .bind(expense.amount_gross)
        .bind(&expense.currency)
        .bind(body.reversed_on)
        .bind(&payment_method)
        .bind(reference.as_deref())
        .bind(Some(reason.as_str()))
        .bind(auth.user_id)
        .execute(&mut *transaction)
        .await
        {
            tracing::warn!(error = %error, expense_id = %expense_id, "insert Concierge provider payment reversal");
            return err(
                StatusCode::CONFLICT,
                "Provider payment reversal was rejected",
            );
        }
        if let Err(error) = sqlx::query(
            r#"INSERT INTO accounting_entries (
                   entry_kind, direction, category, source_external_invoice_id,
                   source_external_provider_payment_transaction_id,
                   order_id, patient_id, entry_date, description,
                   amount_net, amount_vat, amount_gross, currency, metadata,
                   created_by, financial_account_id
               ) VALUES (
                   'external_invoice_payment', 'expense', 'provider_expense', $1,
                   $2, $3, $4, $5, $6,
                   $7, $8, $9, $10, $11,
                   $12, $13
               )"#,
        )
        .bind(external_invoice_id)
        .bind(reversal_id)
        .bind(external.try_get::<Uuid, _>("order_id").unwrap_or_default())
        .bind(
            external
                .try_get::<Uuid, _>("patient_id")
                .unwrap_or_default(),
        )
        .bind(body.reversed_on)
        .bind(format!(
            "Concierge partner payment reversal {}",
            external
                .try_get::<String, _>("external_invoice_number")
                .unwrap_or_default()
        ))
        .bind(-expense.amount_net)
        .bind(-expense.amount_vat)
        .bind(-expense.amount_gross)
        .bind(&expense.currency)
        .bind(json!({
            "concierge_expense_id": expense.id,
            "provider_payment_transaction_id": reversal_id,
            "reverses_provider_payment_transaction_id": payment_id,
            "reason": reason,
        }))
        .bind(auth.user_id)
        .bind(account_id)
        .execute(&mut *transaction)
        .await
        {
            tracing::error!(error = %error, expense_id = %expense_id, "insert Concierge expense reversal accounting entry");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse expense",
            );
        }
        provider_reversal_id = Some(reversal_id);
    }

    let reversal_event_id = Uuid::new_v4();
    if let Err(error) = sqlx::query(
        r#"INSERT INTO concierge_expense_review_events (
               id, expense_id, request_id, action, reason, reverses_event_id,
               external_invoice_id, payload_hash, decided_by
           ) VALUES ($1, $2, $3, 'reversed', $4, $5, $6, $7, $8)"#,
    )
    .bind(reversal_event_id)
    .bind(expense_id)
    .bind(body.request_id)
    .bind(&reason)
    .bind(posted_event_id)
    .bind(external_invoice_id)
    .bind(&payload_hash)
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::warn!(error = %error, expense_id = %expense_id, "insert Concierge expense reversal review");
        return err(StatusCode::CONFLICT, "Expense reversal was rejected");
    }
    if let Err(error) = sqlx::query(
        r#"UPDATE external_invoices
           SET status = 'cancelled', paid_by = 'unpaid', paid_at = NULL,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(external_invoice_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::warn!(error = %error, expense_id = %expense_id, "cancel reversed Concierge external invoice");
        return err(
            StatusCode::CONFLICT,
            "Expense reversal could not cancel its financial record",
        );
    }
    let notification_deliveries = match insert_concierge_decision_notifications(
        &mut transaction,
        expense_id,
        service_id,
        auth.user_id,
        "concierge_expense_reversed",
        "Concierge expense reversed",
        &format!("The posted expense was reversed. Reason: {reason}"),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, expense_id = %expense_id, "create Concierge expense reversal notifications");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to notify Concierge about the reversal",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, expense_id = %expense_id, "commit Concierge expense reversal");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to reverse expense",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "reverse_concierge_expense",
        Some(auth.user_id),
        "concierge_expense",
        Some(expense_id),
        json!({
            "review_event_id": reversal_event_id,
            "reverses_review_event_id": posted_event_id,
            "external_invoice_id": external_invoice_id,
            "provider_payment_reversal_id": provider_reversal_id,
            "reason": reason,
            "reversed_on": body.reversed_on,
        }),
    ));
    crate::realtime::publish_concierge_service_event(
        &state,
        Some(auth.user_id),
        "concierge_expense.reversed",
        service_id,
        json!({ "expense_id": expense_id, "status": "reversed" }),
    )
    .await;
    publish_notification_deliveries(&state, notification_deliveries, expense_id).await;
    expense_mutation_response(&state, &auth, service_id, expense_id, false, StatusCode::OK).await
}
