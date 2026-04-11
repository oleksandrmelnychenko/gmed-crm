use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/invoices", get(list_my_invoices))
        .route("/me/invoices/{invoice_id}", get(get_my_invoice))
        .route("/invoices", get(list_invoices))
        .route("/invoices/{invoice_id}", get(get_invoice))
        .route("/invoices/{invoice_id}/status", post(update_invoice_status))
        .route(
            "/invoices/{invoice_id}/dunning",
            get(list_dunning_events).post(create_dunning_event),
        )
        .route(
            "/quotes/{quote_id}/invoices",
            post(create_invoice_from_quote),
        )
}

#[derive(Deserialize)]
struct ListInvoicesQuery {
    search: Option<String>,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    quote_id: Option<Uuid>,
    status: Option<String>,
    invoice_type: Option<String>,
}

#[derive(Deserialize)]
struct ListMyInvoicesQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
struct CreateInvoiceRequest {
    invoice_type: Option<String>,
    due_date: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdateInvoiceStatusRequest {
    status: String,
    due_date: Option<String>,
    paid_amount: Option<f64>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct CreateDunningEventRequest {
    level: String,
    note: Option<String>,
}

struct QuoteInvoiceContext {
    quote_id: Uuid,
    order_id: Uuid,
    patient_id: Uuid,
    contract_id: Option<Uuid>,
    quote_number: String,
    order_number: String,
    quote_status: String,
    total_net: Decimal,
    total_vat: Decimal,
    total_gross: Decimal,
    line_items: Value,
    notes: Option<String>,
}

struct InvoiceDunningContext {
    invoice_id: Uuid,
    patient_id: Uuid,
    status: String,
    due_date: Option<NaiveDate>,
    total_gross: Decimal,
    paid_amount: Decimal,
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

fn is_valid_invoice_type(value: &str) -> bool {
    matches!(value, "advance" | "interim" | "final")
}

fn is_valid_invoice_status(value: &str) -> bool {
    matches!(
        value,
        "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled"
    )
}

fn is_valid_dunning_level(value: &str) -> bool {
    matches!(value, "first" | "second" | "collections")
}

fn gen_invoice_number(seq: i64) -> String {
    format!("INV-{}-{:04}", Utc::now().format("%Y%m%d"), seq)
}

fn parse_optional_date(value: Option<&str>) -> Result<Option<NaiveDate>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| "Invalid date (YYYY-MM-DD)"),
        _ => Ok(None),
    }
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn extract_source_line_ids(line_items: &Value) -> Vec<Uuid> {
    let mut ids = Vec::new();
    let Some(items) = line_items.as_array() else {
        return ids;
    };

    for item in items {
        let Some(raw) = item.get("source_order_leistung_id").and_then(Value::as_str) else {
            continue;
        };
        if let Ok(id) = Uuid::parse_str(raw) {
            ids.push(id);
        }
    }

    ids
}

async fn can_access_patient(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<bool, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::Billing) {
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

async fn load_quote_invoice_context(
    state: &AppState,
    quote_id: Uuid,
) -> Result<Option<QuoteInvoiceContext>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT q.id, q.order_id, q.quote_number, q.status, q.total_net, q.total_vat, q.total_gross,
                  q.line_items, q.notes, o.patient_id, o.order_number, o.contract_id,
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
        tracing::error!(error = %e, quote_id = %quote_id, "load invoice quote");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load quote")
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    Ok(Some(QuoteInvoiceContext {
        quote_id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
        order_id: row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
        patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        contract_id: row
            .try_get::<Option<Uuid>, _>("contract_id")
            .unwrap_or_default(),
        quote_number: row.try_get::<String, _>("quote_number").unwrap_or_default(),
        order_number: row.try_get::<String, _>("order_number").unwrap_or_default(),
        quote_status: row.try_get::<String, _>("status").unwrap_or_default(),
        total_net: row
            .try_get::<Decimal, _>("total_net")
            .unwrap_or(Decimal::ZERO),
        total_vat: row
            .try_get::<Decimal, _>("total_vat")
            .unwrap_or(Decimal::ZERO),
        total_gross: row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO),
        line_items: row
            .try_get::<Value, _>("line_items")
            .unwrap_or_else(|_| serde_json::json!([])),
        notes: row
            .try_get::<Option<String>, _>("notes")
            .unwrap_or_default(),
    }))
}

async fn load_invoice_dunning_context(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Option<InvoiceDunningContext>, axum::response::Response> {
    let row = sqlx::query(
        "SELECT id, patient_id, status, due_date, total_gross, paid_amount
         FROM invoices
         WHERE id = $1",
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice dunning context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load invoice dunning context",
        )
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    Ok(Some(InvoiceDunningContext {
        invoice_id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
        patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        status: row.try_get::<String, _>("status").unwrap_or_default(),
        due_date: row
            .try_get::<Option<NaiveDate>, _>("due_date")
            .unwrap_or_default(),
        total_gross: row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO),
        paid_amount: row
            .try_get::<Decimal, _>("paid_amount")
            .unwrap_or(Decimal::ZERO),
    }))
}

async fn validate_invoice_creation_for_quote(
    state: &AppState,
    ctx: &QuoteInvoiceContext,
    invoice_type: &str,
) -> Result<(), axum::response::Response> {
    if matches!(ctx.quote_status.as_str(), "rejected" | "expired") {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Cannot invoice a rejected or expired quote",
        ));
    }

    let duplicate_exists: bool = if invoice_type == "advance" {
        sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1
                FROM invoices
                WHERE quote_id = $1
                  AND invoice_type = 'advance'
                  AND status <> 'cancelled'
            )",
        )
        .bind(ctx.quote_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, quote_id = %ctx.quote_id, "check duplicate advance invoice");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate invoice duplication",
            )
        })?
    } else {
        sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1
                FROM invoices
                WHERE quote_id = $1
                  AND invoice_type IN ('interim', 'final')
                  AND status <> 'cancelled'
            )",
        )
        .bind(ctx.quote_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, quote_id = %ctx.quote_id, "check duplicate invoice");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate invoice duplication",
            )
        })?
    };

    if duplicate_exists {
        return Err(err(
            StatusCode::CONFLICT,
            "An active invoice already exists for this quote scope",
        ));
    }

    if invoice_type != "advance" {
        let source_ids = extract_source_line_ids(&ctx.line_items);
        if !source_ids.is_empty() {
            let invalid_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)
                 FROM order_leistungen
                 WHERE order_id = $1
                   AND id = ANY($2)
                   AND status <> 'approved'",
            )
            .bind(ctx.order_id)
            .bind(&source_ids)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, order_id = %ctx.order_id, "validate approved order services");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate order services for invoice",
                )
            })?;

            if invalid_count > 0 {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "All order services must be approved before invoice creation",
                ));
            }
        }
    }

    Ok(())
}

async fn mark_quote_services_invoiced(
    state: &AppState,
    ctx: &QuoteInvoiceContext,
    invoice_type: &str,
) -> Result<(), axum::response::Response> {
    if invoice_type == "advance" {
        return Ok(());
    }

    let source_ids = extract_source_line_ids(&ctx.line_items);
    if source_ids.is_empty() {
        return Ok(());
    }

    sqlx::query(
        "UPDATE order_leistungen
         SET status = 'invoiced'
         WHERE order_id = $1
           AND id = ANY($2)
           AND status = 'approved'",
    )
    .bind(ctx.order_id)
    .bind(&source_ids)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %ctx.order_id, "mark order services invoiced");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to mark order services as invoiced",
        )
    })?;

    Ok(())
}

async fn load_invoice_detail(
    state: &AppState,
    invoice_id: Uuid,
    auth: &AuthUser,
) -> Result<Option<Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT i.id, i.quote_id, i.order_id, i.patient_id, i.invoice_number, i.invoice_type,
                  i.status, i.issued_at, i.due_date, i.total_net, i.total_vat, i.total_gross,
                  i.paid_amount, i.paid_at, i.line_items, i.notes, i.created_at, i.updated_at,
                  o.order_number, o.contract_id, q.quote_number,
                  p.first_name, p.last_name, p.patient_id AS patient_pid
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           JOIN patients p ON p.id = i.patient_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           WHERE i.id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice detail");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load invoice")
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    ensure_patient_access(state, auth, patient_id).await?;

    let total_gross = row
        .try_get::<Decimal, _>("total_gross")
        .unwrap_or(Decimal::ZERO);
    let paid_amount = row
        .try_get::<Decimal, _>("paid_amount")
        .unwrap_or(Decimal::ZERO);

    Ok(Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "quote_id": row.try_get::<Option<Uuid>, _>("quote_id").unwrap_or_default(),
        "quote_number": row.try_get::<Option<String>, _>("quote_number").unwrap_or_default(),
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
        "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
        "invoice_type": row.try_get::<String, _>("invoice_type").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "issued_at": row.try_get::<DateTime<Utc>, _>("issued_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "due_date": row.try_get::<Option<NaiveDate>, _>("due_date").unwrap_or_default().map(|v| v.to_string()),
        "total_net": decimal_to_string(row.try_get::<Decimal, _>("total_net").unwrap_or(Decimal::ZERO)),
        "total_vat": decimal_to_string(row.try_get::<Decimal, _>("total_vat").unwrap_or(Decimal::ZERO)),
        "total_gross": decimal_to_string(total_gross),
        "paid_amount": decimal_to_string(paid_amount),
        "balance_due": decimal_to_string((total_gross - paid_amount).max(Decimal::ZERO)),
        "paid_at": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        "line_items": row.try_get::<Value, _>("line_items").unwrap_or_else(|_| serde_json::json!([])),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
    })))
}

async fn list_my_invoices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListMyInvoicesQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    if let Some(ref status) = query.status
        && !is_valid_invoice_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid invoice status");
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        r#"SELECT i.id, i.quote_id, i.order_id, i.patient_id, i.invoice_number, i.invoice_type,
                  i.status, i.issued_at, i.due_date, i.total_net, i.total_vat, i.total_gross,
                  i.paid_amount, i.paid_at, i.notes, i.created_at, i.updated_at,
                  o.order_number, q.quote_number,
                  COALESCE((
                    SELECT count(*)::bigint
                    FROM documents d
                    WHERE d.patient_id = i.patient_id
                      AND d.order_id = i.order_id
                      AND d.uploaded_by = $1
                      AND d.ursprung = 'patient_portal'
                      AND d.art = 'payment_proof'
                  ), 0) AS payment_proof_count,
                  (
                    SELECT max(d.created_at)
                    FROM documents d
                    WHERE d.patient_id = i.patient_id
                      AND d.order_id = i.order_id
                      AND d.uploaded_by = $1
                      AND d.ursprung = 'patient_portal'
                      AND d.art = 'payment_proof'
                  ) AS last_payment_proof_at
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           WHERE i.patient_id = $2
             AND ($3::text IS NULL OR i.status = $3)
           ORDER BY i.issued_at DESC, i.created_at DESC"#,
    )
    .bind(auth.user_id)
    .bind(patient_id)
    .bind(query.status)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items = rows
                .into_iter()
                .map(|row| {
                    let total_gross = row
                        .try_get::<Decimal, _>("total_gross")
                        .unwrap_or(Decimal::ZERO);
                    let paid_amount = row
                        .try_get::<Decimal, _>("paid_amount")
                        .unwrap_or(Decimal::ZERO);

                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "quote_id": row.try_get::<Option<Uuid>, _>("quote_id").unwrap_or_default(),
                        "quote_number": row.try_get::<Option<String>, _>("quote_number").unwrap_or_default(),
                        "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                        "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
                        "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                        "invoice_type": row.try_get::<String, _>("invoice_type").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "issued_at": row.try_get::<DateTime<Utc>, _>("issued_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "due_date": row.try_get::<Option<NaiveDate>, _>("due_date").unwrap_or_default().map(|value| value.to_string()),
                        "total_net": decimal_to_string(row.try_get::<Decimal, _>("total_net").unwrap_or(Decimal::ZERO)),
                        "total_vat": decimal_to_string(row.try_get::<Decimal, _>("total_vat").unwrap_or(Decimal::ZERO)),
                        "total_gross": decimal_to_string(total_gross),
                        "paid_amount": decimal_to_string(paid_amount),
                        "balance_due": decimal_to_string((total_gross - paid_amount).max(Decimal::ZERO)),
                        "paid_at": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "payment_proof_count": row.try_get::<i64, _>("payment_proof_count").unwrap_or(0),
                        "last_payment_proof_at": row.try_get::<Option<DateTime<Utc>>, _>("last_payment_proof_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    })
                })
                .collect::<Vec<_>>();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list my invoices");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list invoices")
        }
    }
}

async fn get_my_invoice(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let Some(mut invoice) = (match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    }) else {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    };

    if invoice
        .get("patient_id")
        .and_then(Value::as_str)
        .map(|value| value != patient_id.to_string())
        .unwrap_or(true)
    {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    }

    let proof_row = match sqlx::query(
        r#"SELECT COALESCE(count(*)::bigint, 0) AS payment_proof_count,
                  max(created_at) AS last_payment_proof_at
           FROM documents
           WHERE patient_id = $1
             AND order_id = $2
             AND uploaded_by = $3
             AND ursprung = 'patient_portal'
             AND art = 'payment_proof'"#,
    )
    .bind(patient_id)
    .bind(
        invoice
            .get("order_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok()),
    )
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "load my invoice proof summary");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load invoice");
        }
    };

    if let Some(map) = invoice.as_object_mut() {
        map.insert(
            "payment_proof_count".to_string(),
            serde_json::json!(
                proof_row
                    .try_get::<i64, _>("payment_proof_count")
                    .unwrap_or(0)
            ),
        );
        map.insert(
            "last_payment_proof_at".to_string(),
            serde_json::json!(
                proof_row
                    .try_get::<Option<DateTime<Utc>>, _>("last_payment_proof_at")
                    .unwrap_or_default()
                    .map(|value| value.to_rfc3339())
            ),
        );
    }

    Json(invoice).into_response()
}

async fn list_invoices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListInvoicesQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo]) {
        return e;
    }

    if let Some(ref status) = query.status
        && !is_valid_invoice_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid invoice status");
    }
    if let Some(ref invoice_type) = query.invoice_type
        && !is_valid_invoice_type(invoice_type)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid invoice type");
    }

    match sqlx::query(
        r#"SELECT i.id, i.quote_id, i.order_id, i.patient_id, i.invoice_number, i.invoice_type,
                  i.status, i.issued_at, i.due_date, i.total_net, i.total_vat, i.total_gross,
                  i.paid_amount, i.paid_at, i.created_at, i.updated_at,
                  o.order_number, q.quote_number, p.first_name, p.last_name, p.patient_id AS patient_pid
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           JOIN patients p ON p.id = i.patient_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           WHERE ($1::text IS NULL
                   OR i.invoice_number ILIKE $1
                   OR o.order_number ILIKE $1
                   OR COALESCE(q.quote_number, '') ILIKE $1
                   OR p.patient_id ILIKE $1
                   OR CONCAT(p.first_name, ' ', p.last_name) ILIKE $1)
             AND ($2::uuid IS NULL OR i.patient_id = $2)
             AND ($3::uuid IS NULL OR i.order_id = $3)
             AND ($4::uuid IS NULL OR i.quote_id = $4)
             AND ($5::text IS NULL OR i.status = $5)
             AND ($6::text IS NULL OR i.invoice_type = $6)
           ORDER BY i.issued_at DESC, i.created_at DESC"#,
    )
    .bind(query.search.as_ref().map(|value| format!("%{}%", value.trim())))
    .bind(query.patient_id)
    .bind(query.order_id)
    .bind(query.quote_id)
    .bind(query.status)
    .bind(query.invoice_type)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::new();
            for row in rows {
                let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
                match can_access_patient(&state, &auth, patient_id).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                let total_gross = row
                    .try_get::<Decimal, _>("total_gross")
                    .unwrap_or(Decimal::ZERO);
                let paid_amount = row
                    .try_get::<Decimal, _>("paid_amount")
                    .unwrap_or(Decimal::ZERO);

                items.push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "quote_id": row.try_get::<Option<Uuid>, _>("quote_id").unwrap_or_default(),
                    "quote_number": row.try_get::<Option<String>, _>("quote_number").unwrap_or_default(),
                    "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                    "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                    "patient_id": patient_id,
                    "patient_name": format!(
                        "{} {}",
                        row.try_get::<String, _>("first_name").unwrap_or_default(),
                        row.try_get::<String, _>("last_name").unwrap_or_default()
                    ).trim().to_string(),
                    "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
                    "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                    "invoice_type": row.try_get::<String, _>("invoice_type").unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "issued_at": row.try_get::<DateTime<Utc>, _>("issued_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                    "due_date": row.try_get::<Option<NaiveDate>, _>("due_date").unwrap_or_default().map(|v| v.to_string()),
                    "total_net": decimal_to_string(row.try_get::<Decimal, _>("total_net").unwrap_or(Decimal::ZERO)),
                    "total_vat": decimal_to_string(row.try_get::<Decimal, _>("total_vat").unwrap_or(Decimal::ZERO)),
                    "total_gross": decimal_to_string(total_gross),
                    "paid_amount": decimal_to_string(paid_amount),
                    "balance_due": decimal_to_string((total_gross - paid_amount).max(Decimal::ZERO)),
                    "paid_at": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").unwrap_or_default().map(|v| v.to_rfc3339()),
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list invoices");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list invoices")
        }
    }
}

async fn create_invoice_from_quote(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(quote_id): Path<Uuid>,
    Json(body): Json<CreateInvoiceRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo]) {
        return e;
    }

    let Some(ctx) = (match load_quote_invoice_context(&state, quote_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    }) else {
        return err(StatusCode::NOT_FOUND, "Quote not found");
    };

    if let Err(resp) = ensure_patient_access(&state, &auth, ctx.patient_id).await {
        return resp;
    }

    let invoice_type = body
        .invoice_type
        .clone()
        .unwrap_or_else(|| "final".to_string());
    if !is_valid_invoice_type(&invoice_type) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid invoice type");
    }

    let due_date = match parse_optional_date(body.due_date.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    if let Err(resp) = validate_invoice_creation_for_quote(&state, &ctx, &invoice_type).await {
        return resp;
    }

    let seq: i64 = match sqlx::query_scalar("SELECT nextval('invoice_number_seq')")
        .fetch_one(&state.db)
        .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "invoice sequence");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create invoice",
            );
        }
    };

    let invoice_number = gen_invoice_number(seq);
    let notes = body.notes.clone().or(ctx.notes.clone());

    match sqlx::query(
        r#"INSERT INTO invoices (
                quote_id, order_id, patient_id, invoice_number, invoice_type, status,
                due_date, total_net, total_vat, total_gross, line_items, notes, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12
           ) RETURNING id"#,
    )
    .bind(ctx.quote_id)
    .bind(ctx.order_id)
    .bind(ctx.patient_id)
    .bind(invoice_number.clone())
    .bind(invoice_type.clone())
    .bind(due_date)
    .bind(ctx.total_net)
    .bind(ctx.total_vat)
    .bind(ctx.total_gross)
    .bind(ctx.line_items.clone())
    .bind(notes)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let invoice_id = row.try_get::<Uuid, _>("id").unwrap_or_default();

            if let Err(resp) = mark_quote_services_invoiced(&state, &ctx, &invoice_type).await {
                return resp;
            }

            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
                 VALUES ($1, $2, 'invoice', $3, $4)",
            )
            .bind(auth.user_id)
            .bind("create_invoice")
            .bind(invoice_id)
            .bind(serde_json::json!({
                "invoice_number": invoice_number,
                "invoice_type": invoice_type,
                "quote_id": ctx.quote_id,
                "order_id": ctx.order_id,
                "patient_id": ctx.patient_id,
                "contract_id": ctx.contract_id,
                "quote_number": ctx.quote_number,
                "order_number": ctx.order_number,
            }))
            .execute(&state.db)
            .await;

            match load_invoice_detail(&state, invoice_id, &auth).await {
                Ok(Some(invoice)) => (StatusCode::CREATED, Json(invoice)).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
                Err(resp) => resp,
            }
        }
        Err(e) => {
            tracing::error!(error = %e, quote_id = %quote_id, "create invoice");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create invoice",
            )
        }
    }
}

async fn get_invoice(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo]) {
        return e;
    }

    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => Json(invoice).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(resp) => resp,
    }
}

async fn list_dunning_events(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo]) {
        return e;
    }

    let Some(ctx) = (match load_invoice_dunning_context(&state, invoice_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    }) else {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    };

    if let Err(resp) = ensure_patient_access(&state, &auth, ctx.patient_id).await {
        return resp;
    }

    match sqlx::query(
        r#"SELECT ide.id, ide.level, ide.note, ide.due_date_snapshot, ide.balance_due,
                  ide.sent_at, ide.created_at, u.name AS created_by_name, u.role AS created_by_role
           FROM invoice_dunning_events ide
           JOIN users u ON u.id = ide.created_by
           WHERE ide.invoice_id = $1
           ORDER BY ide.sent_at, ide.created_at"#,
    )
    .bind(invoice_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items = rows
                .into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "invoice_id": ctx.invoice_id,
                        "level": row.try_get::<String, _>("level").unwrap_or_default(),
                        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
                        "due_date_snapshot": row.try_get::<Option<NaiveDate>, _>("due_date_snapshot").unwrap_or_default().map(|value| value.to_string()),
                        "balance_due": decimal_to_string(row.try_get::<Decimal, _>("balance_due").unwrap_or(Decimal::ZERO)),
                        "sent_at": row.try_get::<DateTime<Utc>, _>("sent_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
                        "created_by_role": row.try_get::<String, _>("created_by_role").unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "list invoice dunning");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list invoice dunning events",
            )
        }
    }
}

async fn create_dunning_event(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<CreateDunningEventRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Billing, Role::Ceo]) {
        return e;
    }
    if !is_valid_dunning_level(&body.level) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid dunning level");
    }

    let Some(ctx) = (match load_invoice_dunning_context(&state, invoice_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    }) else {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    };

    if let Err(resp) = ensure_patient_access(&state, &auth, ctx.patient_id).await {
        return resp;
    }

    let balance_due = (ctx.total_gross - ctx.paid_amount).max(Decimal::ZERO);
    if balance_due <= Decimal::ZERO || matches!(ctx.status.as_str(), "paid" | "cancelled") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invoice is not eligible for dunning",
        );
    }
    if ctx.status == "draft" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invoice must be sent before dunning starts",
        );
    }

    let today = Utc::now().date_naive();
    let Some(due_date) = ctx.due_date else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invoice due date is required for dunning",
        );
    };
    if due_date >= today {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invoice is not overdue yet",
        );
    }

    let existing_levels = match sqlx::query_scalar::<_, String>(
        "SELECT level FROM invoice_dunning_events WHERE invoice_id = $1 ORDER BY sent_at, created_at",
    )
    .bind(invoice_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(levels) => levels,
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "load existing dunning levels");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate dunning sequence",
            );
        }
    };

    match body.level.as_str() {
        "first" => {
            if existing_levels.iter().any(|level| level == "first") {
                return err(
                    StatusCode::CONFLICT,
                    "First reminder already exists for this invoice",
                );
            }
        }
        "second" => {
            if !existing_levels.iter().any(|level| level == "first") {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Second reminder requires a first reminder",
                );
            }
            if existing_levels.iter().any(|level| level == "second") {
                return err(
                    StatusCode::CONFLICT,
                    "Second reminder already exists for this invoice",
                );
            }
        }
        "collections" => {
            if !existing_levels.iter().any(|level| level == "second") {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Collections escalation requires a second reminder",
                );
            }
            if existing_levels.iter().any(|level| level == "collections") {
                return err(
                    StatusCode::CONFLICT,
                    "Collections escalation already exists for this invoice",
                );
            }
        }
        _ => {}
    }

    match sqlx::query(
        r#"INSERT INTO invoice_dunning_events (
                invoice_id, level, note, due_date_snapshot, balance_due, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, level, note, due_date_snapshot, balance_due, sent_at, created_at"#,
    )
    .bind(invoice_id)
    .bind(body.level.clone())
    .bind(body.note.clone())
    .bind(Some(due_date))
    .bind(balance_due)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let _ = sqlx::query(
                "UPDATE invoices
                 SET status = CASE
                     WHEN status IN ('paid', 'cancelled', 'overdue') THEN status
                     ELSE 'overdue'
                 END
                 WHERE id = $1",
            )
            .bind(invoice_id)
            .execute(&state.db)
            .await;

            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
                 VALUES ($1, $2, 'invoice', $3, $4)",
            )
            .bind(auth.user_id)
            .bind("create_invoice_dunning_event")
            .bind(invoice_id)
            .bind(serde_json::json!({
                "level": body.level,
                "balance_due": decimal_to_string(balance_due),
                "due_date_snapshot": due_date.to_string(),
            }))
            .execute(&state.db)
            .await;

            Json(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "invoice_id": invoice_id,
                "level": row.try_get::<String, _>("level").unwrap_or_default(),
                "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
                "due_date_snapshot": row.try_get::<Option<NaiveDate>, _>("due_date_snapshot").unwrap_or_default().map(|value| value.to_string()),
                "balance_due": decimal_to_string(row.try_get::<Decimal, _>("balance_due").unwrap_or(Decimal::ZERO)),
                "sent_at": row.try_get::<DateTime<Utc>, _>("sent_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "create invoice dunning");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create invoice dunning event",
            )
        }
    }
}

async fn update_invoice_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<UpdateInvoiceStatusRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Billing, Role::Ceo]) {
        return e;
    }
    if !is_valid_invoice_status(&body.status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid invoice status");
    }

    let current = match sqlx::query(
        "SELECT patient_id, total_gross, paid_amount FROM invoices WHERE id = $1",
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice update context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update invoice",
            );
        }
    };

    let patient_id = current.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let due_date = match parse_optional_date(body.due_date.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let total_gross = current
        .try_get::<Decimal, _>("total_gross")
        .unwrap_or(Decimal::ZERO);
    let existing_paid_amount = current
        .try_get::<Decimal, _>("paid_amount")
        .unwrap_or(Decimal::ZERO);
    let requested_paid_amount = match body.paid_amount {
        Some(value) => match Decimal::try_from(value) {
            Ok(decimal) if decimal >= Decimal::ZERO => decimal.round_dp(2),
            _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid paid_amount"),
        },
        None => existing_paid_amount,
    };

    let mut effective_status = body.status.clone();
    let mut effective_paid_amount = requested_paid_amount;
    if effective_status == "paid" && effective_paid_amount == Decimal::ZERO {
        effective_paid_amount = total_gross;
    }
    if effective_paid_amount >= total_gross && total_gross > Decimal::ZERO {
        effective_status = "paid".to_string();
    } else if effective_paid_amount > Decimal::ZERO
        && matches!(effective_status.as_str(), "draft" | "sent" | "overdue")
    {
        effective_status = "partially_paid".to_string();
    }

    let paid_at = if effective_status == "paid" {
        Some(Utc::now())
    } else {
        None
    };

    match sqlx::query(
        r#"UPDATE invoices
           SET status = $2,
               due_date = COALESCE($3, due_date),
               paid_amount = $4,
               paid_at = $5,
               notes = COALESCE($6, notes)
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .bind(effective_status.clone())
    .bind(due_date)
    .bind(effective_paid_amount)
    .bind(paid_at)
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
                 VALUES ($1, $2, 'invoice', $3, $4)",
            )
            .bind(auth.user_id)
            .bind("update_invoice_status")
            .bind(invoice_id)
            .bind(serde_json::json!({
                "status": effective_status,
                "paid_amount": decimal_to_string(effective_paid_amount),
                "due_date": due_date.map(|value| value.to_string()),
            }))
            .execute(&state.db)
            .await;

            match load_invoice_detail(&state, invoice_id, &auth).await {
                Ok(Some(invoice)) => Json(invoice).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "update invoice status");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update invoice",
            )
        }
    }
}
