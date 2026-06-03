use axum::{
    Json, Router,
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use printpdf::{
    BuiltinFont, Color, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfWarnMsg, Point, Pt, Rgb,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Number as JsonNumber, Value, json};
use sqlx::Row;
use std::collections::BTreeMap;
use std::str::FromStr;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::pdf_text::{pdf_text_save_options, win_ansi_show_text_op};
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

const INVOICE_PDF_PAGE_WIDTH_MM: f32 = 210.0;
const INVOICE_PDF_PAGE_HEIGHT_MM: f32 = 297.0;
const INVOICE_PDF_LEFT_MARGIN_MM: f32 = 18.0;
const INVOICE_PDF_RIGHT_MARGIN_MM: f32 = 18.0;
const INVOICE_PDF_TOP_MARGIN_MM: f32 = 18.0;
const INVOICE_PDF_BOTTOM_MARGIN_MM: f32 = 16.0;
const INVOICE_PDF_FOOTER_GAP_MM: f32 = 10.0;
const INVOICE_PDF_CONTENT_WIDTH_MM: f32 =
    INVOICE_PDF_PAGE_WIDTH_MM - INVOICE_PDF_LEFT_MARGIN_MM - INVOICE_PDF_RIGHT_MARGIN_MM;
const AUTO_DUNNING_CHECK_INTERVAL_SECS: u64 = 60 * 60;
const DEFAULT_AUTO_DUNNING_SECOND_DELAY_DAYS: i64 = 14;
const DEFAULT_AUTO_DUNNING_COLLECTIONS_DELAY_DAYS: i64 = 28;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/invoices", get(list_my_invoices))
        .route("/me/invoices/{invoice_id}", get(get_my_invoice))
        .route(
            "/me/invoices/{invoice_id}/pdf",
            get(download_my_invoice_pdf),
        )
        .route("/invoices/accounting-ledger", get(get_accounting_ledger))
        .route(
            "/invoices/accounting-ledger/export",
            get(export_accounting_ledger),
        )
        .route("/invoices", get(list_invoices))
        .route("/invoices/{invoice_id}", get(get_invoice))
        .route("/invoices/{invoice_id}/pdf", get(download_invoice_pdf))
        .route("/invoices/{invoice_id}/status", post(update_invoice_status))
        .route(
            "/invoices/{invoice_id}/visibility",
            post(update_invoice_visibility),
        )
        .route("/invoices/{invoice_id}/payer", post(update_invoice_payer))
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
    page: Option<usize>,
    per_page: Option<usize>,
}

#[derive(Deserialize)]
struct ListMyInvoicesQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
struct AccountingLedgerQuery {
    year: Option<i32>,
    patient_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct CreateInvoiceRequest {
    invoice_type: Option<String>,
    due_date: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MoneyInput {
    String(String),
    Number(JsonNumber),
}

impl MoneyInput {
    fn parse_decimal(&self) -> Option<Decimal> {
        match self {
            Self::String(value) => Decimal::from_str(value.trim()).ok(),
            Self::Number(value) => Decimal::from_str(&value.to_string()).ok(),
        }
    }
}

#[derive(Deserialize)]
struct UpdateInvoiceStatusRequest {
    status: String,
    due_date: Option<String>,
    paid_amount: Option<MoneyInput>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdateInvoiceVisibilityRequest {
    portal_visible: Option<bool>,
    hide_amounts_from_patient: Option<bool>,
    line_items_visible_to_patient: Option<bool>,
    pdf_visible_to_patient: Option<bool>,
    visibility_note: Option<String>,
}

#[derive(Deserialize)]
struct UpdateInvoicePayerRequest {
    payer_patient_relation_id: Option<Uuid>,
    payer_contact_name: Option<String>,
    payer_contact_email: Option<String>,
    payer_contact_phone: Option<String>,
    payer_contact_relationship: Option<String>,
    payer_notes: Option<String>,
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
    billing_release_status: String,
    package_coverage_status: String,
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

struct InvoiceAccountingContext {
    invoice_id: Uuid,
    order_id: Uuid,
    patient_id: Uuid,
    invoice_number: String,
    paid_amount: Decimal,
    paid_at: Option<DateTime<Utc>>,
    total_vat: Decimal,
    total_gross: Decimal,
    currency: String,
    line_items: Value,
}

struct ExternalInvoiceAccountingContext {
    external_invoice_id: Uuid,
    order_id: Uuid,
    patient_id: Uuid,
    external_invoice_number: String,
    status: String,
    paid_at: Option<DateTime<Utc>>,
    amount_vat: Decimal,
    amount_gross: Decimal,
    currency: String,
}

struct AccountingEntryInsert<'a> {
    entry_kind: &'a str,
    direction: &'a str,
    category: &'a str,
    source_invoice_id: Option<Uuid>,
    source_external_invoice_id: Option<Uuid>,
    order_id: Uuid,
    patient_id: Uuid,
    entry_date: NaiveDate,
    description: String,
    amount_net: Decimal,
    amount_vat: Decimal,
    amount_gross: Decimal,
    currency: &'a str,
    metadata: Value,
    created_by: Option<Uuid>,
}

struct AutoDunningCandidate {
    invoice_id: Uuid,
    created_by: Uuid,
    status: String,
    due_date: NaiveDate,
    total_gross: Decimal,
    paid_amount: Decimal,
    first_sent_at: Option<DateTime<Utc>>,
    second_sent_at: Option<DateTime<Utc>>,
    collections_sent_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct AutoDunningRunSummary {
    pub overdue_marked: u64,
    pub dunning_events_created: u64,
}

#[derive(Clone)]
struct InvoicePdfLineItem {
    description: String,
    quantity: String,
    unit_price: String,
    vat_rate: String,
    is_cost_passthrough: bool,
    line_net: String,
    line_vat: String,
    line_gross: String,
    notes: Option<String>,
}

#[derive(Clone)]
struct InvoicePdfDunningEvent {
    level: String,
    balance_due: String,
    sent_at: DateTime<Utc>,
    note: Option<String>,
}

struct InvoicePdfContext {
    invoice_id: Uuid,
    patient_id: Uuid,
    invoice_number: String,
    invoice_type: String,
    status: String,
    portal_visible: bool,
    hide_amounts_from_patient: bool,
    pdf_visible_to_patient: bool,
    issued_at: DateTime<Utc>,
    due_date: Option<NaiveDate>,
    total_net: String,
    total_vat: String,
    total_gross: String,
    paid_amount: String,
    balance_due: String,
    notes: Option<String>,
    patient_pid: String,
    patient_name: String,
    patient_title: Option<String>,
    birth_date: Option<NaiveDate>,
    order_number: String,
    quote_number: Option<String>,
    language: String,
    line_items: Vec<InvoicePdfLineItem>,
    dunning_events: Vec<InvoicePdfDunningEvent>,
}

#[derive(Clone, Copy)]
enum InvoicePdfColor {
    Primary,
    Body,
    Muted,
}

struct InvoicePdfLayout {
    pages: Vec<PdfPage>,
    page_ops: Vec<Op>,
    page_number: usize,
    y_mm: f32,
    footer_text: String,
    regular_font: PdfFontHandle,
    bold_font: PdfFontHandle,
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

fn can_read_invoices(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    )
}

fn can_create_invoices(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::PatientManager | Role::Billing)
}

fn can_manage_invoice_finance(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn can_manage_invoice_visibility(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn can_read_accounting_ledger(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::CeoAssistant | Role::Billing)
}

fn normalize_invoice_list_page(page: Option<usize>) -> Result<usize, &'static str> {
    match page {
        Some(0) => Err("Invalid invoice page"),
        Some(value) => Ok(value),
        None => Ok(1),
    }
}

fn normalize_invoice_list_per_page(per_page: Option<usize>) -> Result<usize, &'static str> {
    match per_page {
        Some(0) => Err("Invalid invoice page size"),
        Some(value) => Ok(value.min(50)),
        None => Ok(12),
    }
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

fn invoice_is_patient_visible(status: &str) -> bool {
    status != "draft"
}

fn invoice_portal_visibility_payload(
    portal_visible: bool,
    hide_amounts_from_patient: bool,
    line_items_visible_to_patient: bool,
    pdf_visible_to_patient: bool,
) -> Value {
    let visible_to_patient = portal_visible;
    let amounts_visible_to_patient = visible_to_patient && !hide_amounts_from_patient;
    let line_items_visible_to_patient = amounts_visible_to_patient && line_items_visible_to_patient;
    let pdf_visible_to_patient =
        visible_to_patient && amounts_visible_to_patient && pdf_visible_to_patient;

    let redaction_reason = if !visible_to_patient {
        Some("invoice_hidden_from_patient")
    } else if !amounts_visible_to_patient {
        Some("amounts_hidden_from_patient")
    } else if !line_items_visible_to_patient {
        Some("line_items_hidden_from_patient")
    } else {
        None
    };

    serde_json::json!({
        "visible_to_patient": visible_to_patient,
        "amounts_visible_to_patient": amounts_visible_to_patient,
        "line_items_visible_to_patient": line_items_visible_to_patient,
        "pdf_visible_to_patient": pdf_visible_to_patient,
        "redaction_reason": redaction_reason,
    })
}

fn row_invoice_portal_visibility(row: &sqlx::postgres::PgRow) -> Value {
    invoice_portal_visibility_payload(
        row.try_get::<bool, _>("portal_visible").unwrap_or(true),
        row.try_get::<bool, _>("hide_amounts_from_patient")
            .unwrap_or(false),
        row.try_get::<bool, _>("line_items_visible_to_patient")
            .unwrap_or(true),
        row.try_get::<bool, _>("pdf_visible_to_patient")
            .unwrap_or(true),
    )
}

fn redact_patient_invoice_payload(invoice: &mut Value) {
    let Some(visibility) = invoice.get("portal_visibility").cloned() else {
        return;
    };
    let amounts_visible = visibility
        .get("amounts_visible_to_patient")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let line_items_visible = visibility
        .get("line_items_visible_to_patient")
        .and_then(Value::as_bool)
        .unwrap_or(amounts_visible);

    let Some(map) = invoice.as_object_mut() else {
        return;
    };

    if !amounts_visible {
        for key in [
            "total_net",
            "total_vat",
            "total_gross",
            "paid_amount",
            "balance_due",
        ] {
            map.insert(key.to_string(), Value::Null);
        }
    }

    if !line_items_visible {
        map.insert("line_items".to_string(), serde_json::json!([]));
    }
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

fn normalize_optional(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn round_accounting_money(value: Decimal) -> Decimal {
    value.round_dp(2)
}

fn value_to_decimal(value: &Value) -> Decimal {
    match value {
        Value::String(text) => Decimal::from_str(text).unwrap_or(Decimal::ZERO),
        Value::Number(number) => Decimal::from_str(&number.to_string()).unwrap_or(Decimal::ZERO),
        _ => Decimal::ZERO,
    }
}

fn proportional_share(amount: Decimal, part: Decimal, total: Decimal) -> Decimal {
    if amount == Decimal::ZERO || part == Decimal::ZERO || total == Decimal::ZERO {
        Decimal::ZERO
    } else {
        round_accounting_money(amount * part / total)
    }
}

fn invoice_passthrough_totals(line_items: &Value) -> (Decimal, Decimal, Decimal) {
    let Some(items) = line_items.as_array() else {
        return (Decimal::ZERO, Decimal::ZERO, Decimal::ZERO);
    };

    items.iter().fold(
        (Decimal::ZERO, Decimal::ZERO, Decimal::ZERO),
        |(net, vat, gross), item| {
            let is_cost_passthrough = item
                .get("is_cost_passthrough")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !is_cost_passthrough {
                return (net, vat, gross);
            }
            (
                net + value_to_decimal(item.get("line_net").unwrap_or(&Value::Null)),
                vat + value_to_decimal(item.get("line_vat").unwrap_or(&Value::Null)),
                gross + value_to_decimal(item.get("line_gross").unwrap_or(&Value::Null)),
            )
        },
    )
}

async fn write_invoice_audit(
    state: &AppState,
    user_id: Uuid,
    action: &str,
    invoice_id: Uuid,
    context: Value,
) {
    state.audit_sender.try_send(audit::domain_event(
        action.to_string(),
        Some(user_id),
        "invoice",
        Some(invoice_id),
        context,
    ));
}

async fn insert_accounting_entry(
    state: &AppState,
    entry: AccountingEntryInsert<'_>,
) -> Result<(), sqlx::Error> {
    if entry.amount_gross == Decimal::ZERO
        && entry.amount_net == Decimal::ZERO
        && entry.amount_vat == Decimal::ZERO
    {
        return Ok(());
    }

    sqlx::query(
        r#"INSERT INTO accounting_entries (
                entry_kind, direction, category, source_invoice_id, source_external_invoice_id,
                order_id, patient_id, entry_date, description,
                amount_net, amount_vat, amount_gross, currency, metadata, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15
           )"#,
    )
    .bind(entry.entry_kind)
    .bind(entry.direction)
    .bind(entry.category)
    .bind(entry.source_invoice_id)
    .bind(entry.source_external_invoice_id)
    .bind(entry.order_id)
    .bind(entry.patient_id)
    .bind(entry.entry_date)
    .bind(entry.description)
    .bind(round_accounting_money(entry.amount_net))
    .bind(round_accounting_money(entry.amount_vat))
    .bind(round_accounting_money(entry.amount_gross))
    .bind(entry.currency)
    .bind(entry.metadata)
    .bind(entry.created_by)
    .execute(&state.db)
    .await?;

    Ok(())
}

async fn load_invoice_accounting_context(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Option<InvoiceAccountingContext>, sqlx::Error> {
    sqlx::query(
        r#"SELECT id, order_id, patient_id, invoice_number, paid_amount, paid_at,
                  total_vat, total_gross, line_items
           FROM invoices
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    .map(|row| {
        row.map(|row| InvoiceAccountingContext {
            invoice_id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
            order_id: row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            invoice_number: row
                .try_get::<String, _>("invoice_number")
                .unwrap_or_default(),
            paid_amount: row
                .try_get::<Decimal, _>("paid_amount")
                .unwrap_or(Decimal::ZERO),
            paid_at: row
                .try_get::<Option<DateTime<Utc>>, _>("paid_at")
                .unwrap_or_default(),
            total_vat: row
                .try_get::<Decimal, _>("total_vat")
                .unwrap_or(Decimal::ZERO),
            total_gross: row
                .try_get::<Decimal, _>("total_gross")
                .unwrap_or(Decimal::ZERO),
            currency: "EUR".to_string(),
            line_items: row
                .try_get::<Value, _>("line_items")
                .unwrap_or_else(|_| serde_json::json!([])),
        })
    })
}

async fn load_external_invoice_accounting_context(
    state: &AppState,
    external_invoice_id: Uuid,
) -> Result<Option<ExternalInvoiceAccountingContext>, sqlx::Error> {
    sqlx::query(
        r#"SELECT id, order_id, patient_id, external_invoice_number, status, paid_at,
                  amount_vat, amount_gross, currency
           FROM external_invoices
           WHERE id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_optional(&state.db)
    .await
    .map(|row| {
        row.map(|row| ExternalInvoiceAccountingContext {
            external_invoice_id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
            order_id: row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            external_invoice_number: row
                .try_get::<String, _>("external_invoice_number")
                .unwrap_or_default(),
            status: row.try_get::<String, _>("status").unwrap_or_default(),
            paid_at: row
                .try_get::<Option<DateTime<Utc>>, _>("paid_at")
                .unwrap_or_default(),
            amount_vat: row
                .try_get::<Decimal, _>("amount_vat")
                .unwrap_or(Decimal::ZERO),
            amount_gross: row
                .try_get::<Decimal, _>("amount_gross")
                .unwrap_or(Decimal::ZERO),
            currency: row
                .try_get::<String, _>("currency")
                .unwrap_or_else(|_| "EUR".to_string()),
        })
    })
}

async fn total_accounted_invoice_gross(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Decimal, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount_gross), 0)
           FROM accounting_entries
           WHERE source_invoice_id = $1
             AND entry_kind = 'invoice_payment'"#,
    )
    .bind(invoice_id)
    .fetch_one(&state.db)
    .await
}

async fn total_accounted_external_invoice_gross(
    state: &AppState,
    external_invoice_id: Uuid,
) -> Result<Decimal, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount_gross), 0)
           FROM accounting_entries
           WHERE source_external_invoice_id = $1
             AND entry_kind = 'external_invoice_payment'"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&state.db)
    .await
}

async fn sync_invoice_accounting_entries_from_current_state(
    state: &AppState,
    invoice_id: Uuid,
    actor_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let Some(context) = load_invoice_accounting_context(state, invoice_id).await? else {
        return Ok(());
    };

    let already_accounted = total_accounted_invoice_gross(state, invoice_id).await?;
    let delta_gross = round_accounting_money(context.paid_amount - already_accounted);
    if delta_gross == Decimal::ZERO {
        return Ok(());
    }

    let (_, passthrough_vat_total, passthrough_gross_total) =
        invoice_passthrough_totals(&context.line_items);
    let service_vat_total = context.total_vat - passthrough_vat_total;

    let passthrough_gross =
        proportional_share(delta_gross, passthrough_gross_total, context.total_gross);
    let passthrough_vat =
        proportional_share(delta_gross, passthrough_vat_total, context.total_gross);
    let passthrough_net = passthrough_gross - passthrough_vat;

    let service_gross = delta_gross - passthrough_gross;
    let service_vat = proportional_share(delta_gross, service_vat_total, context.total_gross);
    let service_net = service_gross - service_vat;

    let entry_date = context.paid_at.unwrap_or_else(Utc::now).date_naive();

    insert_accounting_entry(
        state,
        AccountingEntryInsert {
            entry_kind: "invoice_payment",
            direction: "income",
            category: "service_revenue",
            source_invoice_id: Some(context.invoice_id),
            source_external_invoice_id: None,
            order_id: context.order_id,
            patient_id: context.patient_id,
            entry_date,
            description: format!("Invoice payment {}", context.invoice_number),
            amount_net: service_net,
            amount_vat: service_vat,
            amount_gross: service_gross,
            currency: &context.currency,
            metadata: serde_json::json!({
            "invoice_number": context.invoice_number,
            "payment_delta_gross": decimal_to_string(delta_gross),
            }),
            created_by: actor_id,
        },
    )
    .await?;

    insert_accounting_entry(
        state,
        AccountingEntryInsert {
            entry_kind: "invoice_payment",
            direction: "income",
            category: "cost_passthrough_revenue",
            source_invoice_id: Some(context.invoice_id),
            source_external_invoice_id: None,
            order_id: context.order_id,
            patient_id: context.patient_id,
            entry_date,
            description: format!("Cost passthrough payment {}", context.invoice_number),
            amount_net: passthrough_net,
            amount_vat: passthrough_vat,
            amount_gross: passthrough_gross,
            currency: &context.currency,
            metadata: serde_json::json!({
            "invoice_number": context.invoice_number,
            "payment_delta_gross": decimal_to_string(delta_gross),
            }),
            created_by: actor_id,
        },
    )
    .await?;

    Ok(())
}

pub async fn sync_external_invoice_accounting_entries_from_current_state(
    state: &AppState,
    external_invoice_id: Uuid,
    actor_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let Some(context) =
        load_external_invoice_accounting_context(state, external_invoice_id).await?
    else {
        return Ok(());
    };

    let already_accounted =
        total_accounted_external_invoice_gross(state, external_invoice_id).await?;
    let target_gross = if context.status == "paid" {
        context.amount_gross
    } else {
        Decimal::ZERO
    };
    let delta_gross = round_accounting_money(target_gross - already_accounted);
    if delta_gross == Decimal::ZERO {
        return Ok(());
    }

    let delta_vat = proportional_share(delta_gross, context.amount_vat, context.amount_gross);
    let delta_net = delta_gross - delta_vat;
    let entry_date = context.paid_at.unwrap_or_else(Utc::now).date_naive();

    insert_accounting_entry(
        state,
        AccountingEntryInsert {
            entry_kind: "external_invoice_payment",
            direction: "expense",
            category: "provider_expense",
            source_invoice_id: None,
            source_external_invoice_id: Some(context.external_invoice_id),
            order_id: context.order_id,
            patient_id: context.patient_id,
            entry_date,
            description: format!(
                "External invoice payment {}",
                context.external_invoice_number
            ),
            amount_net: delta_net,
            amount_vat: delta_vat,
            amount_gross: delta_gross,
            currency: &context.currency,
            metadata: serde_json::json!({
            "external_invoice_number": context.external_invoice_number,
            "payment_delta_gross": decimal_to_string(delta_gross),
            }),
            created_by: actor_id,
        },
    )
    .await?;

    Ok(())
}

fn validate_dunning_level_transition(
    existing_levels: &[String],
    level: &str,
) -> Result<(), &'static str> {
    match level {
        "first" => {
            if existing_levels.iter().any(|existing| existing == "first") {
                return Err("First reminder already exists for this invoice");
            }
        }
        "second" => {
            if !existing_levels.iter().any(|existing| existing == "first") {
                return Err("Second reminder requires a first reminder");
            }
            if existing_levels.iter().any(|existing| existing == "second") {
                return Err("Second reminder already exists for this invoice");
            }
        }
        "collections" => {
            if !existing_levels.iter().any(|existing| existing == "second") {
                return Err("Collections escalation requires a second reminder");
            }
            if existing_levels
                .iter()
                .any(|existing| existing == "collections")
            {
                return Err("Collections escalation already exists for this invoice");
            }
        }
        _ => {}
    }

    Ok(())
}

async fn load_existing_dunning_levels(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT level FROM invoice_dunning_events WHERE invoice_id = $1 ORDER BY sent_at, created_at",
    )
    .bind(invoice_id)
    .fetch_all(&state.db)
    .await
}

async fn resolve_auto_dunning_actor_user_id(state: &AppState) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role IN ('billing', 'ceo', 'ceo_assistant')
           ORDER BY CASE role
               WHEN 'billing' THEN 0
               WHEN 'ceo' THEN 1
               ELSE 2
           END,
           created_at
           LIMIT 1"#,
    )
    .fetch_optional(&state.db)
    .await
}

async fn load_auto_dunning_candidates(
    state: &AppState,
) -> Result<Vec<AutoDunningCandidate>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT i.id, i.created_by, i.status, i.due_date, i.total_gross, i.paid_amount,
                  max(ide.sent_at) FILTER (WHERE ide.level = 'first') AS first_sent_at,
                  max(ide.sent_at) FILTER (WHERE ide.level = 'second') AS second_sent_at,
                  max(ide.sent_at) FILTER (WHERE ide.level = 'collections') AS collections_sent_at
           FROM invoices i
           LEFT JOIN invoice_dunning_events ide ON ide.invoice_id = i.id
           WHERE i.due_date IS NOT NULL
             AND i.status NOT IN ('draft', 'paid', 'cancelled')
           GROUP BY i.id, i.created_by, i.status, i.due_date, i.total_gross, i.paid_amount"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AutoDunningCandidate {
            invoice_id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
            created_by: row.try_get::<Uuid, _>("created_by").unwrap_or_default(),
            status: row.try_get::<String, _>("status").unwrap_or_default(),
            due_date: row
                .try_get::<NaiveDate, _>("due_date")
                .unwrap_or_else(|_| Utc::now().date_naive()),
            total_gross: row
                .try_get::<Decimal, _>("total_gross")
                .unwrap_or(Decimal::ZERO),
            paid_amount: row
                .try_get::<Decimal, _>("paid_amount")
                .unwrap_or(Decimal::ZERO),
            first_sent_at: row
                .try_get::<Option<DateTime<Utc>>, _>("first_sent_at")
                .unwrap_or_default(),
            second_sent_at: row
                .try_get::<Option<DateTime<Utc>>, _>("second_sent_at")
                .unwrap_or_default(),
            collections_sent_at: row
                .try_get::<Option<DateTime<Utc>>, _>("collections_sent_at")
                .unwrap_or_default(),
        })
        .collect())
}

fn auto_dunning_note(level: &str) -> String {
    match level {
        "first" => "[system auto-dunning] First reminder created automatically after due date passed."
            .to_string(),
        "second" => "[system auto-dunning] Second reminder created automatically after first reminder remained unpaid."
            .to_string(),
        "collections" => "[system auto-dunning] Collections escalation created automatically after second reminder remained unpaid."
            .to_string(),
        _ => "[system auto-dunning] Reminder created automatically.".to_string(),
    }
}

fn next_auto_dunning_level(
    candidate: &AutoDunningCandidate,
    today: NaiveDate,
    second_delay_days: i64,
    collections_delay_days: i64,
) -> Option<&'static str> {
    if candidate.collections_sent_at.is_some() {
        return None;
    }
    if candidate.first_sent_at.is_none() {
        return Some("first");
    }

    let first_sent_at = candidate.first_sent_at?;
    if candidate.second_sent_at.is_none()
        && first_sent_at.date_naive() <= today - chrono::Duration::days(second_delay_days)
    {
        return Some("second");
    }

    let second_sent_at = candidate.second_sent_at?;
    if candidate.collections_sent_at.is_none()
        && second_sent_at.date_naive() <= today - chrono::Duration::days(collections_delay_days)
    {
        return Some("collections");
    }

    None
}

async fn load_auto_dunning_delay_days(state: &AppState) -> Result<(i64, i64), sqlx::Error> {
    let second_delay_days = sqlx::query_scalar::<_, String>(
        r#"SELECT value::text
           FROM system_settings
           WHERE key = 'auto_dunning_second_delay_days'"#,
    )
    .fetch_optional(&state.db)
    .await?
    .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
    .filter(|value| *value > 0)
    .unwrap_or(DEFAULT_AUTO_DUNNING_SECOND_DELAY_DAYS);

    let collections_delay_days = sqlx::query_scalar::<_, String>(
        r#"SELECT value::text
           FROM system_settings
           WHERE key = 'auto_dunning_collections_delay_days'"#,
    )
    .fetch_optional(&state.db)
    .await?
    .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
    .filter(|value| *value > 0)
    .unwrap_or(DEFAULT_AUTO_DUNNING_COLLECTIONS_DELAY_DAYS);

    Ok((second_delay_days, collections_delay_days))
}

pub async fn run_auto_dunning_scheduler_once(
    state: &AppState,
) -> Result<AutoDunningRunSummary, sqlx::Error> {
    let today = Utc::now().date_naive();
    let automation_actor_user_id = resolve_auto_dunning_actor_user_id(state).await?;
    let (second_delay_days, collections_delay_days) = load_auto_dunning_delay_days(state).await?;
    let mut summary = AutoDunningRunSummary::default();

    for candidate in load_auto_dunning_candidates(state).await? {
        let balance_due = (candidate.total_gross - candidate.paid_amount).max(Decimal::ZERO);
        if balance_due <= Decimal::ZERO || candidate.due_date >= today {
            continue;
        }

        let actor_user_id = automation_actor_user_id.unwrap_or(candidate.created_by);
        if candidate.status != "overdue" {
            let result = sqlx::query(
                "UPDATE invoices
                 SET status = 'overdue'
                 WHERE id = $1
                   AND status NOT IN ('draft', 'paid', 'cancelled', 'overdue')",
            )
            .bind(candidate.invoice_id)
            .execute(&state.db)
            .await?;

            if result.rows_affected() > 0 {
                summary.overdue_marked += result.rows_affected();
                write_invoice_audit(
                    state,
                    actor_user_id,
                    "auto_mark_invoice_overdue",
                    candidate.invoice_id,
                    serde_json::json!({
                        "trigger": "invoice_scheduler",
                        "due_date": candidate.due_date.to_string(),
                        "balance_due": decimal_to_string(balance_due),
                    }),
                )
                .await;
                crate::realtime::publish_invoice_event(
                    state,
                    Some(actor_user_id),
                    "invoice.overdue_marked",
                    candidate.invoice_id,
                    serde_json::json!({
                        "trigger": "invoice_scheduler",
                        "status": "overdue",
                        "due_date": candidate.due_date.to_string(),
                        "balance_due": decimal_to_string(balance_due),
                    }),
                )
                .await;
            }
        }

        let Some(level) =
            next_auto_dunning_level(&candidate, today, second_delay_days, collections_delay_days)
        else {
            continue;
        };

        let existing_levels = load_existing_dunning_levels(state, candidate.invoice_id).await?;
        if validate_dunning_level_transition(&existing_levels, level).is_err() {
            continue;
        }

        let note = auto_dunning_note(level);
        let inserted = sqlx::query(
            r#"INSERT INTO invoice_dunning_events (
                    invoice_id, level, note, due_date_snapshot, balance_due, created_by
               ) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (invoice_id, level) DO NOTHING
               RETURNING id"#,
        )
        .bind(candidate.invoice_id)
        .bind(level)
        .bind(note.clone())
        .bind(Some(candidate.due_date))
        .bind(balance_due)
        .bind(actor_user_id)
        .fetch_optional(&state.db)
        .await?;

        if inserted.is_some() {
            summary.dunning_events_created += 1;
            write_invoice_audit(
                state,
                actor_user_id,
                "auto_create_invoice_dunning_event",
                candidate.invoice_id,
                serde_json::json!({
                    "trigger": "invoice_scheduler",
                    "level": level,
                    "balance_due": decimal_to_string(balance_due),
                    "due_date_snapshot": candidate.due_date.to_string(),
                }),
            )
            .await;
            crate::realtime::publish_invoice_event(
                state,
                Some(actor_user_id),
                "invoice.dunning_created",
                candidate.invoice_id,
                serde_json::json!({
                    "trigger": "invoice_scheduler",
                    "level": level,
                    "balance_due": decimal_to_string(balance_due),
                    "due_date_snapshot": candidate.due_date.to_string(),
                }),
            )
            .await;
        }
    }

    Ok(summary)
}

pub fn spawn_auto_dunning_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            AUTO_DUNNING_CHECK_INTERVAL_SECS,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            match run_auto_dunning_scheduler_once(&state).await {
                Ok(summary) => {
                    if summary.overdue_marked > 0 || summary.dunning_events_created > 0 {
                        tracing::info!(
                            overdue_marked = summary.overdue_marked,
                            dunning_events_created = summary.dunning_events_created,
                            "Auto dunning scheduler applied invoice updates"
                        );
                    }
                }
                Err(error) => {
                    tracing::error!(error = %error, "Auto dunning scheduler failed");
                }
            }
        }
    });
}

fn invoice_pdf_color(kind: InvoicePdfColor) -> Color {
    match kind {
        InvoicePdfColor::Primary => Color::Rgb(Rgb::new(0.10, 0.31, 0.85, None)),
        InvoicePdfColor::Muted => Color::Rgb(Rgb::new(0.40, 0.46, 0.54, None)),
        InvoicePdfColor::Body => Color::Rgb(Rgb::new(0.07, 0.13, 0.22, None)),
    }
}

fn pt_to_mm(value: f32) -> f32 {
    value * 0.352_778
}

fn invoice_pdf_line_height_mm(size_pt: f32, multiplier: f32) -> f32 {
    pt_to_mm(size_pt * multiplier)
}

fn wrap_invoice_text(text: &str, font_size_pt: f32, available_width_mm: f32) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let average_char_width_mm = pt_to_mm(font_size_pt) * 0.54;
    let max_chars = ((available_width_mm / average_char_width_mm).floor() as usize).max(18);
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in normalized.split_whitespace() {
        let projected_len = if current.is_empty() {
            word.chars().count()
        } else {
            current.chars().count() + 1 + word.chars().count()
        };

        if projected_len <= max_chars {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
            continue;
        }

        if !current.is_empty() {
            lines.push(current);
            current = String::new();
        }

        if word.chars().count() <= max_chars {
            current.push_str(word);
            continue;
        }

        let mut chunk = String::new();
        for ch in word.chars() {
            chunk.push(ch);
            if chunk.chars().count() >= max_chars {
                lines.push(chunk.clone());
                chunk.clear();
            }
        }
        current = chunk;
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

fn append_invoice_pdf_text_line(
    ops: &mut Vec<Op>,
    text: &str,
    x_mm: f32,
    y_mm: f32,
    size_pt: f32,
    font: &PdfFontHandle,
    color: InvoicePdfColor,
) {
    ops.push(Op::SetFont {
        font: font.clone(),
        size: Pt(size_pt),
    });
    ops.push(Op::StartTextSection);
    ops.push(Op::SetTextCursor {
        pos: Point::new(Mm(x_mm), Mm(y_mm)),
    });
    ops.push(Op::SetFillColor {
        col: invoice_pdf_color(color),
    });
    ops.push(win_ansi_show_text_op(text));
    ops.push(Op::EndTextSection);
}

fn invoice_pdf_text_font_handles() -> (PdfFontHandle, PdfFontHandle) {
    (
        PdfFontHandle::Builtin(BuiltinFont::Helvetica),
        PdfFontHandle::Builtin(BuiltinFont::HelveticaBold),
    )
}

fn invoice_pdf_footer_line(footer_text: &str, page_number: usize, total_pages: usize) -> String {
    format!("{footer_text} · Page {page_number} of {total_pages}")
}

impl InvoicePdfLayout {
    fn new(footer_text: String, regular_font: PdfFontHandle, bold_font: PdfFontHandle) -> Self {
        Self {
            pages: Vec::new(),
            page_ops: Vec::new(),
            page_number: 1,
            y_mm: INVOICE_PDF_PAGE_HEIGHT_MM - INVOICE_PDF_TOP_MARGIN_MM,
            footer_text,
            regular_font,
            bold_font,
        }
    }

    fn available_width(&self, indent_mm: f32) -> f32 {
        (INVOICE_PDF_CONTENT_WIDTH_MM - indent_mm).max(50.0)
    }

    fn finish_page(&mut self) {
        if self.page_ops.is_empty() {
            return;
        }

        self.pages.push(PdfPage::new(
            Mm(INVOICE_PDF_PAGE_WIDTH_MM),
            Mm(INVOICE_PDF_PAGE_HEIGHT_MM),
            std::mem::take(&mut self.page_ops),
        ));
        self.page_number += 1;
        self.y_mm = INVOICE_PDF_PAGE_HEIGHT_MM - INVOICE_PDF_TOP_MARGIN_MM;
    }

    fn ensure_space(&mut self, needed_mm: f32) {
        if self.y_mm - needed_mm < INVOICE_PDF_BOTTOM_MARGIN_MM + INVOICE_PDF_FOOTER_GAP_MM {
            self.finish_page();
        }
    }

    fn spacer(&mut self, amount_mm: f32) {
        if amount_mm <= 0.0 {
            return;
        }
        self.ensure_space(amount_mm);
        self.y_mm -= amount_mm;
    }

    #[allow(clippy::too_many_arguments)]
    fn text_block(
        &mut self,
        text: &str,
        size_pt: f32,
        bold: bool,
        indent_mm: f32,
        color: InvoicePdfColor,
        before_mm: f32,
        after_mm: f32,
    ) {
        let lines = wrap_invoice_text(text, size_pt, self.available_width(indent_mm));
        if lines.is_empty() {
            return;
        }

        if before_mm > 0.0 {
            self.spacer(before_mm);
        }

        let line_height_mm = invoice_pdf_line_height_mm(size_pt, 1.35);
        let x_mm = INVOICE_PDF_LEFT_MARGIN_MM + indent_mm;
        let font = if bold {
            self.bold_font.clone()
        } else {
            self.regular_font.clone()
        };

        for line in lines {
            self.ensure_space(line_height_mm);
            append_invoice_pdf_text_line(
                &mut self.page_ops,
                &line,
                x_mm,
                self.y_mm,
                size_pt,
                &font,
                color,
            );
            self.y_mm -= line_height_mm;
        }

        if after_mm > 0.0 {
            self.spacer(after_mm);
        }
    }

    fn finish(mut self) -> Vec<PdfPage> {
        self.finish_page();
        let total_pages = self.pages.len();
        let footer_text = self.footer_text.clone();
        let regular_font = self.regular_font.clone();
        for (index, page) in self.pages.iter_mut().enumerate() {
            append_invoice_pdf_text_line(
                &mut page.ops,
                &invoice_pdf_footer_line(&footer_text, index + 1, total_pages),
                INVOICE_PDF_LEFT_MARGIN_MM,
                INVOICE_PDF_BOTTOM_MARGIN_MM,
                8.0,
                &regular_font,
                InvoicePdfColor::Muted,
            );
        }
        self.pages
    }
}

fn invoice_pdf_label<'a>(language: &str, key: &'a str) -> &'a str {
    match (language, key) {
        ("uk", "invoice_title") => "Рахунок",
        ("ru", "invoice_title") => "Счёт",
        ("en", "invoice_title") => "Invoice",
        (_, "invoice_title") => "Rechnung",
        ("uk", "issued_on") => "Виставлено",
        ("ru", "issued_on") => "Выставлен",
        ("en", "issued_on") => "Issued on",
        (_, "issued_on") => "Ausgestellt am",
        ("uk", "due_date") => "Термін оплати",
        ("ru", "due_date") => "Срок оплаты",
        ("en", "due_date") => "Due date",
        (_, "due_date") => "Fällig am",
        ("uk", "patient_id") => "ID пацієнта",
        ("ru", "patient_id") => "ID пациента",
        ("en", "patient_id") => "Patient ID",
        (_, "patient_id") => "Patienten-ID",
        ("uk", "patient_name") => "Пацієнт",
        ("ru", "patient_name") => "Пациент",
        ("en", "patient_name") => "Patient",
        (_, "patient_name") => "Patient",
        ("uk", "birth_date") => "Дата народження",
        ("ru", "birth_date") => "Дата рождения",
        ("en", "birth_date") => "Birth date",
        (_, "birth_date") => "Geburtsdatum",
        ("uk", "order_number") => "Замовлення",
        ("ru", "order_number") => "Заказ",
        ("en", "order_number") => "Order",
        (_, "order_number") => "Auftrag",
        ("uk", "quote_number") => "Кошторис",
        ("ru", "quote_number") => "Смета",
        ("en", "quote_number") => "Quote",
        (_, "quote_number") => "Angebot",
        ("uk", "status") => "Статус",
        ("ru", "status") => "Статус",
        ("en", "status") => "Status",
        (_, "status") => "Status",
        ("uk", "invoice_type") => "Тип рахунку",
        ("ru", "invoice_type") => "Тип счёта",
        ("en", "invoice_type") => "Invoice type",
        (_, "invoice_type") => "Rechnungstyp",
        ("uk", "totals_heading") => "Підсумки",
        ("ru", "totals_heading") => "Итоги",
        ("en", "totals_heading") => "Totals",
        (_, "totals_heading") => "Summen",
        ("uk", "total_net") => "Нетто",
        ("ru", "total_net") => "Нетто",
        ("en", "total_net") => "Net total",
        (_, "total_net") => "Netto",
        ("uk", "total_vat") => "ПДВ",
        ("ru", "total_vat") => "НДС",
        ("en", "total_vat") => "VAT",
        (_, "total_vat") => "MwSt.",
        ("uk", "total_gross") => "Брутто",
        ("ru", "total_gross") => "Итого",
        ("en", "total_gross") => "Gross total",
        (_, "total_gross") => "Brutto",
        ("uk", "paid_amount") => "Сплачено",
        ("ru", "paid_amount") => "Оплачено",
        ("en", "paid_amount") => "Paid amount",
        (_, "paid_amount") => "Bezahlt",
        ("uk", "balance_due") => "До сплати",
        ("ru", "balance_due") => "Остаток",
        ("en", "balance_due") => "Balance due",
        (_, "balance_due") => "Offener Betrag",
        ("uk", "items_heading") => "Позиції",
        ("ru", "items_heading") => "Позиции",
        ("en", "items_heading") => "Line items",
        (_, "items_heading") => "Positionen",
        ("uk", "item_quantity") => "К-сть",
        ("ru", "item_quantity") => "Кол-во",
        ("en", "item_quantity") => "Qty",
        (_, "item_quantity") => "Menge",
        ("uk", "item_unit_price") => "Ціна",
        ("ru", "item_unit_price") => "Цена",
        ("en", "item_unit_price") => "Unit price",
        (_, "item_unit_price") => "Einzelpreis",
        ("uk", "item_vat_rate") => "Ставка ПДВ",
        ("ru", "item_vat_rate") => "Ставка НДС",
        ("en", "item_vat_rate") => "VAT rate",
        (_, "item_vat_rate") => "MwSt.-Satz",
        ("uk", "item_total") => "Сума",
        ("ru", "item_total") => "Сумма",
        ("en", "item_total") => "Total",
        (_, "item_total") => "Gesamt",
        ("uk", "item_net") => "Нетто рядка",
        ("ru", "item_net") => "Нетто позиции",
        ("en", "item_net") => "Line net",
        (_, "item_net") => "Position netto",
        ("uk", "item_vat") => "ПДВ рядка",
        ("ru", "item_vat") => "НДС позиции",
        ("en", "item_vat") => "Line VAT",
        (_, "item_vat") => "Position MwSt.",
        ("uk", "cost_passthrough") => "Без ПДВ як перевиставлені витрати",
        ("ru", "cost_passthrough") => "Без НДС как перевыставленные расходы",
        ("en", "cost_passthrough") => "VAT-free cost passthrough item",
        (_, "cost_passthrough") => "MwSt-freie Durchlaufkostenposition",
        ("uk", "notes_heading") => "Примітки",
        ("ru", "notes_heading") => "Примечания",
        ("en", "notes_heading") => "Notes",
        (_, "notes_heading") => "Hinweise",
        ("uk", "note_label") => "Примітка",
        ("ru", "note_label") => "Примечание",
        ("en", "note_label") => "Note",
        (_, "note_label") => "Notiz",
        ("uk", "dunning_heading") => "Нагадування про оплату",
        ("ru", "dunning_heading") => "Напоминания об оплате",
        ("en", "dunning_heading") => "Dunning history",
        (_, "dunning_heading") => "Mahnverlauf",
        ("uk", "no_items") => "Позиції ще не матеріалізовані.",
        ("ru", "no_items") => "Позиции ещё не материализованы.",
        ("en", "no_items") => "No invoice items have been materialized yet.",
        (_, "no_items") => "Es wurden noch keine Rechnungspositionen materialisiert.",
        ("uk", "generated_footer") => "Згенеровано",
        ("ru", "generated_footer") => "Сгенерировано",
        ("en", "generated_footer") => "Generated",
        (_, "generated_footer") => "Erzeugt",
        _ => key,
    }
}

fn invoice_pdf_status_label(language: &str, value: &str) -> &'static str {
    match (language, value) {
        ("uk", "draft") => "Чернетка",
        ("uk", "sent") => "Надіслано",
        ("uk", "partially_paid") => "Частково сплачено",
        ("uk", "paid") => "Сплачено",
        ("uk", "overdue") => "Прострочено",
        ("uk", "cancelled") => "Скасовано",
        ("ru", "draft") => "Черновик",
        ("ru", "sent") => "Отправлен",
        ("ru", "partially_paid") => "Частично оплачен",
        ("ru", "paid") => "Оплачен",
        ("ru", "overdue") => "Просрочен",
        ("ru", "cancelled") => "Отменён",
        ("en", "draft") => "Draft",
        ("en", "sent") => "Sent",
        ("en", "partially_paid") => "Partially paid",
        ("en", "paid") => "Paid",
        ("en", "overdue") => "Overdue",
        ("en", "cancelled") => "Cancelled",
        (_, "draft") => "Entwurf",
        (_, "sent") => "Versandt",
        (_, "partially_paid") => "Teilbezahlt",
        (_, "paid") => "Bezahlt",
        (_, "overdue") => "Überfällig",
        (_, "cancelled") => "Storniert",
        _ => "Status",
    }
}

fn invoice_pdf_type_label(language: &str, value: &str) -> &'static str {
    match (language, value) {
        ("uk", "advance") => "Авансовий",
        ("uk", "interim") => "Проміжний",
        ("uk", "final") => "Фінальний",
        ("ru", "advance") => "Авансовый",
        ("ru", "interim") => "Промежуточный",
        ("ru", "final") => "Итоговый",
        ("en", "advance") => "Advance",
        ("en", "interim") => "Interim",
        ("en", "final") => "Final",
        (_, "advance") => "Vorauszahlung",
        (_, "interim") => "Zwischenrechnung",
        (_, "final") => "Schlussrechnung",
        _ => "Invoice",
    }
}

fn invoice_pdf_dunning_level_label(language: &str, value: &str) -> &'static str {
    match (language, value) {
        ("uk", "first") => "1-ше нагадування",
        ("uk", "second") => "2-ге нагадування",
        ("uk", "collections") => "Інкасо",
        ("ru", "first") => "1-е напоминание",
        ("ru", "second") => "2-е напоминание",
        ("ru", "collections") => "Инкассо",
        ("en", "first") => "First reminder",
        ("en", "second") => "Second reminder",
        ("en", "collections") => "Collections",
        (_, "first") => "1. Mahnung",
        (_, "second") => "2. Mahnung",
        (_, "collections") => "Inkasso",
        _ => "Dunning",
    }
}

fn normalize_invoice_pdf_language(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "de" | "de-de" | "de_at" | "de-at" => Some("de"),
        "uk" | "ua" | "uk-ua" | "ua-ua" => Some("uk"),
        "ru" | "ru-ru" => Some("ru"),
        "en" | "en-gb" | "en-us" => Some("en"),
        _ => None,
    }
}

fn resolve_invoice_pdf_language(languages: &[String]) -> String {
    languages
        .iter()
        .find_map(|value| normalize_invoice_pdf_language(value))
        .unwrap_or("de")
        .to_string()
}

fn invoice_pdf_value_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn parse_invoice_pdf_line_items(line_items: &Value) -> Vec<InvoicePdfLineItem> {
    let Some(items) = line_items.as_array() else {
        return Vec::new();
    };

    items
        .iter()
        .map(|item| InvoicePdfLineItem {
            description: invoice_pdf_value_to_string(item.get("description")),
            quantity: invoice_pdf_value_to_string(item.get("quantity")),
            unit_price: invoice_pdf_value_to_string(item.get("unit_price")),
            vat_rate: invoice_pdf_value_to_string(item.get("vat_rate")),
            is_cost_passthrough: item
                .get("is_cost_passthrough")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            line_net: invoice_pdf_value_to_string(item.get("line_net")),
            line_vat: invoice_pdf_value_to_string(item.get("line_vat")),
            line_gross: invoice_pdf_value_to_string(item.get("line_gross")),
            notes: item
                .get("notes")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
        })
        .collect()
}

fn format_invoice_pdf_money(raw: &str) -> String {
    let parsed = Decimal::from_str_exact(raw.trim()).unwrap_or(Decimal::ZERO);
    format!("EUR {}", decimal_to_string(parsed))
}

fn format_invoice_pdf_date(value: Option<NaiveDate>) -> String {
    value
        .map(|date| date.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string())
}

fn format_invoice_pdf_datetime(value: DateTime<Utc>) -> String {
    value.format("%d.%m.%Y %H:%M UTC").to_string()
}

fn invoice_pdf_filename(context: &InvoicePdfContext) -> String {
    let base = context
        .invoice_number
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => ch,
        })
        .collect::<String>();
    format!("{}.pdf", base.trim())
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

fn extract_external_document_ids(line_items: &Value) -> Vec<Uuid> {
    let mut ids = Vec::new();
    let Some(items) = line_items.as_array() else {
        return ids;
    };

    for item in items {
        let Some(raw) = item.get("external_document_id").and_then(Value::as_str) else {
            continue;
        };
        if let Ok(id) = Uuid::parse_str(raw) {
            ids.push(id);
        }
    }

    ids
}

fn vat_source_explanation(
    vat_source: &str,
    tax_profile_name: Option<&str>,
    tax_profile_key: Option<&str>,
    vat_rate: Option<&str>,
) -> String {
    let profile_label = tax_profile_name
        .or(tax_profile_key)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("no tax profile");
    let rate_label = vat_rate
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("{value}%"))
        .unwrap_or_else(|| "the stored VAT rate".to_string());

    match vat_source {
        "tax_profile" => {
            format!("VAT comes from tax profile {profile_label} at {rate_label}.")
        }
        "catalog" => {
            format!("VAT was copied from the agency service catalog at {rate_label}.")
        }
        "manual" => {
            format!("VAT was entered manually for this service line at {rate_label}.")
        }
        "legacy" => {
            format!("VAT is a legacy snapshot on this service line at {rate_label}.")
        }
        _ => format!("VAT source is not classified; invoice uses {rate_label}."),
    }
}

async fn enrich_invoice_line_items(
    state: &AppState,
    line_items: &Value,
) -> Result<Value, axum::response::Response> {
    let Some(items) = line_items.as_array() else {
        return Ok(line_items.clone());
    };
    let source_ids = extract_source_line_ids(line_items);
    if source_ids.is_empty() {
        let enriched = items
            .iter()
            .map(|item| {
                let mut item = item.clone();
                if let Some(map) = item.as_object_mut() {
                    let vat_rate = map
                        .get("vat_rate")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    map.entry("vat_source".to_string())
                        .or_insert_with(|| serde_json::json!("legacy"));
                    map.entry("vat_source_explanation".to_string())
                        .or_insert_with(|| {
                            serde_json::json!(vat_source_explanation(
                                "legacy",
                                None,
                                None,
                                vat_rate.as_deref(),
                            ))
                        });
                }
                item
            })
            .collect::<Vec<_>>();
        return Ok(Value::Array(enriched));
    }

    let rows = sqlx::query(
        r#"SELECT ol.id, ol.vat_source, ol.tax_profile_id,
                  tp.profile_key, tp.name AS tax_profile_name, tp.vat_rate AS tax_profile_vat_rate
           FROM order_leistungen ol
           LEFT JOIN tax_profiles tp ON tp.id = ol.tax_profile_id
           WHERE ol.id = ANY($1)"#,
    )
    .bind(&source_ids)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "enrich invoice line VAT sources");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load invoice VAT sources",
        )
    })?;

    let mut meta_by_line = BTreeMap::<Uuid, Value>::new();
    for row in rows {
        let source_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let vat_source = row
            .try_get::<String, _>("vat_source")
            .unwrap_or_else(|_| "legacy".to_string());
        let tax_profile_name = row
            .try_get::<Option<String>, _>("tax_profile_name")
            .unwrap_or_default();
        let tax_profile_key = row
            .try_get::<Option<String>, _>("profile_key")
            .unwrap_or_default();
        let rate = row
            .try_get::<Option<Decimal>, _>("tax_profile_vat_rate")
            .unwrap_or_default()
            .map(decimal_to_string);
        meta_by_line.insert(source_id, serde_json::json!({
            "vat_source": vat_source,
            "tax_profile_id": row.try_get::<Option<Uuid>, _>("tax_profile_id").unwrap_or_default(),
            "tax_profile_key": tax_profile_key,
            "tax_profile_name": tax_profile_name,
            "tax_profile_vat_rate": rate,
            "vat_source_explanation": vat_source_explanation(
                &vat_source,
                tax_profile_name.as_deref(),
                tax_profile_key.as_deref(),
                rate.as_deref(),
            ),
        }));
    }

    let enriched = items
        .iter()
        .map(|item| {
            let mut item = item.clone();
            let source_id = item
                .get("source_order_leistung_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok());
            if let Some(map) = item.as_object_mut() {
                let meta = source_id
                    .and_then(|id| meta_by_line.get(&id))
                    .and_then(Value::as_object);
                if let Some(meta) = meta {
                    for (key, value) in meta {
                        map.insert(key.clone(), value.clone());
                    }
                } else {
                    let vat_rate = map
                        .get("vat_rate")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    map.entry("vat_source".to_string())
                        .or_insert_with(|| serde_json::json!("legacy"));
                    map.entry("vat_source_explanation".to_string())
                        .or_insert_with(|| {
                            serde_json::json!(vat_source_explanation(
                                "legacy",
                                None,
                                None,
                                vat_rate.as_deref(),
                            ))
                        });
                }
            }
            item
        })
        .collect::<Vec<_>>();

    Ok(Value::Array(enriched))
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

async fn load_quote_invoice_context(
    state: &AppState,
    quote_id: Uuid,
) -> Result<Option<QuoteInvoiceContext>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT q.id, q.order_id, q.quote_number, q.status, q.total_net, q.total_vat, q.total_gross,
                  q.line_items, q.notes, o.patient_id, o.order_number, o.contract_id,
                  o.billing_release_status, o.package_coverage_status,
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
        billing_release_status: row
            .try_get::<String, _>("billing_release_status")
            .unwrap_or_else(|_| "pending".to_string()),
        package_coverage_status: row
            .try_get::<String, _>("package_coverage_status")
            .unwrap_or_else(|_| "unknown".to_string()),
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

    if ctx.billing_release_status != "granted" {
        let message = if ctx.package_coverage_status == "covered" {
            "Order is package-covered and has no billing release for invoice creation"
        } else {
            "Order requires billing release before invoice creation"
        };
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message));
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

async fn link_approved_package_consumptions_to_invoice(
    state: &AppState,
    ctx: &QuoteInvoiceContext,
    invoice_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"UPDATE service_package_consumptions spc
           SET invoice_id = $1
           FROM patient_service_packages psp
           WHERE spc.patient_service_package_id = psp.id
             AND psp.patient_id = $2
             AND spc.order_id = $3
             AND spc.invoice_id IS NULL
             AND spc.approval_status IN ('not_required', 'approved')"#,
    )
    .bind(invoice_id)
    .bind(ctx.patient_id)
    .bind(ctx.order_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, invoice_id = %invoice_id, order_id = %ctx.order_id, "link package consumptions to invoice");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to link package consumption to invoice",
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
                  i.portal_visible, i.hide_amounts_from_patient, i.line_items_visible_to_patient,
                  i.pdf_visible_to_patient, i.visibility_note, i.visibility_updated_at,
                  i.payer_patient_relation_id, i.payer_contact_name, i.payer_contact_email,
                  i.payer_contact_phone, i.payer_contact_relationship, i.payer_notes,
                  i.payer_updated_at,
                  o.order_number, o.contract_id, q.quote_number,
                  p.first_name, p.last_name, p.patient_id AS patient_pid,
                  pr.relation_type AS payer_relation_type,
                  COALESCE(NULLIF(trim(concat_ws(' ', rp.first_name, rp.last_name)), ''), pr.related_name) AS payer_relation_patient_name,
                  rp.patient_id AS payer_relation_patient_pid
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           JOIN patients p ON p.id = i.patient_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           LEFT JOIN patient_relations pr ON pr.id = i.payer_patient_relation_id
           LEFT JOIN patients rp ON rp.id = pr.related_patient_id
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
    let raw_line_items = row
        .try_get::<Value, _>("line_items")
        .unwrap_or_else(|_| serde_json::json!([]));
    let direct_document_ids = extract_external_document_ids(&raw_line_items);
    let source_line_ids = extract_source_line_ids(&raw_line_items);
    let line_items = enrich_invoice_line_items(state, &raw_line_items).await?;

    let supporting_documents = if direct_document_ids.is_empty() && source_line_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query(
            r#"SELECT DISTINCT d.id, d.auto_name, d.original_filename, d.art, d.category
               FROM documents d
               WHERE d.status <> 'archived'
                 AND d.file_deleted_at IS NULL
                 AND (
                        d.id = ANY($1)
                     OR d.id IN (
                            SELECT ol.external_document_id
                            FROM order_leistungen ol
                            WHERE ol.external_document_id IS NOT NULL
                              AND ol.id = ANY($2)
                        )
                 )
               ORDER BY d.auto_name, d.id DESC"#,
        )
        .bind(&direct_document_ids)
        .bind(&source_line_ids)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice supporting documents");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load invoice supporting documents",
            )
        })?
        .into_iter()
        .map(|doc| {
            serde_json::json!({
                "id": doc.try_get::<Uuid, _>("id").unwrap_or_default(),
                "auto_name": doc.try_get::<String, _>("auto_name").unwrap_or_default(),
                "original_filename": doc.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
                "art": doc.try_get::<String, _>("art").unwrap_or_default(),
                "category": doc.try_get::<Option<String>, _>("category").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>()
    };

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
        "line_items": line_items,
        "supporting_documents": supporting_documents,
        "portal_visible": row.try_get::<bool, _>("portal_visible").unwrap_or(true),
        "hide_amounts_from_patient": row.try_get::<bool, _>("hide_amounts_from_patient").unwrap_or(false),
        "line_items_visible_to_patient": row.try_get::<bool, _>("line_items_visible_to_patient").unwrap_or(true),
        "pdf_visible_to_patient": row.try_get::<bool, _>("pdf_visible_to_patient").unwrap_or(true),
        "portal_visibility": row_invoice_portal_visibility(&row),
        "visibility_note": row.try_get::<Option<String>, _>("visibility_note").unwrap_or_default(),
        "visibility_updated_at": row.try_get::<Option<DateTime<Utc>>, _>("visibility_updated_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        "payer": {
            "patient_relation_id": row.try_get::<Option<Uuid>, _>("payer_patient_relation_id").unwrap_or_default(),
            "contact_name": row.try_get::<Option<String>, _>("payer_contact_name").unwrap_or_default(),
            "contact_email": row.try_get::<Option<String>, _>("payer_contact_email").unwrap_or_default(),
            "contact_phone": row.try_get::<Option<String>, _>("payer_contact_phone").unwrap_or_default(),
            "contact_relationship": row.try_get::<Option<String>, _>("payer_contact_relationship").unwrap_or_default(),
            "relation_type": row.try_get::<Option<String>, _>("payer_relation_type").unwrap_or_default(),
            "relation_patient_name": row.try_get::<Option<String>, _>("payer_relation_patient_name").unwrap_or_default(),
            "relation_patient_pid": row.try_get::<Option<String>, _>("payer_relation_patient_pid").unwrap_or_default(),
            "notes": row.try_get::<Option<String>, _>("payer_notes").unwrap_or_default(),
            "updated_at": row.try_get::<Option<DateTime<Utc>>, _>("payer_updated_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        },
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
    })))
}

async fn load_invoice_pdf_context(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Option<InvoicePdfContext>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT i.id, i.patient_id, i.invoice_number, i.invoice_type, i.status,
                  i.issued_at, i.due_date, i.total_net, i.total_vat, i.total_gross,
                  i.paid_amount, i.line_items, i.notes,
                  i.portal_visible, i.hide_amounts_from_patient, i.pdf_visible_to_patient,
                  o.order_number, q.quote_number,
                  p.patient_id AS patient_pid, p.title, p.first_name, p.last_name,
                  p.birth_date, p.languages
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
        tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice pdf context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load invoice PDF context",
        )
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    let total_gross = row
        .try_get::<Decimal, _>("total_gross")
        .unwrap_or(Decimal::ZERO);
    let paid_amount = row
        .try_get::<Decimal, _>("paid_amount")
        .unwrap_or(Decimal::ZERO);
    let line_items = row
        .try_get::<Value, _>("line_items")
        .unwrap_or_else(|_| serde_json::json!([]));
    let languages = row
        .try_get::<Vec<String>, _>("languages")
        .unwrap_or_default();

    let dunning_rows = sqlx::query(
        r#"SELECT level, balance_due, sent_at, note
           FROM invoice_dunning_events
           WHERE invoice_id = $1
           ORDER BY sent_at, created_at"#,
    )
    .bind(invoice_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice dunning pdf context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load invoice PDF dunning context",
        )
    })?;

    Ok(Some(InvoicePdfContext {
        invoice_id,
        patient_id,
        invoice_number: row
            .try_get::<String, _>("invoice_number")
            .unwrap_or_default(),
        invoice_type: row.try_get::<String, _>("invoice_type").unwrap_or_default(),
        status: row.try_get::<String, _>("status").unwrap_or_default(),
        portal_visible: row.try_get::<bool, _>("portal_visible").unwrap_or(true),
        hide_amounts_from_patient: row
            .try_get::<bool, _>("hide_amounts_from_patient")
            .unwrap_or(false),
        pdf_visible_to_patient: row
            .try_get::<bool, _>("pdf_visible_to_patient")
            .unwrap_or(true),
        issued_at: row
            .try_get::<DateTime<Utc>, _>("issued_at")
            .unwrap_or_else(|_| Utc::now()),
        due_date: row
            .try_get::<Option<NaiveDate>, _>("due_date")
            .unwrap_or_default(),
        total_net: decimal_to_string(
            row.try_get::<Decimal, _>("total_net")
                .unwrap_or(Decimal::ZERO),
        ),
        total_vat: decimal_to_string(
            row.try_get::<Decimal, _>("total_vat")
                .unwrap_or(Decimal::ZERO),
        ),
        total_gross: decimal_to_string(total_gross),
        paid_amount: decimal_to_string(paid_amount),
        balance_due: decimal_to_string((total_gross - paid_amount).max(Decimal::ZERO)),
        notes: row
            .try_get::<Option<String>, _>("notes")
            .unwrap_or_default()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        patient_pid: row.try_get::<String, _>("patient_pid").unwrap_or_default(),
        patient_name: format!(
            "{} {}",
            row.try_get::<String, _>("first_name").unwrap_or_default(),
            row.try_get::<String, _>("last_name").unwrap_or_default()
        )
        .trim()
        .to_string(),
        patient_title: row
            .try_get::<Option<String>, _>("title")
            .unwrap_or_default()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        birth_date: row
            .try_get::<Option<NaiveDate>, _>("birth_date")
            .unwrap_or_default(),
        order_number: row.try_get::<String, _>("order_number").unwrap_or_default(),
        quote_number: row
            .try_get::<Option<String>, _>("quote_number")
            .unwrap_or_default(),
        language: resolve_invoice_pdf_language(&languages),
        line_items: parse_invoice_pdf_line_items(&line_items),
        dunning_events: dunning_rows
            .into_iter()
            .map(|row| InvoicePdfDunningEvent {
                level: row.try_get::<String, _>("level").unwrap_or_default(),
                balance_due: decimal_to_string(
                    row.try_get::<Decimal, _>("balance_due")
                        .unwrap_or(Decimal::ZERO),
                ),
                sent_at: row
                    .try_get::<DateTime<Utc>, _>("sent_at")
                    .unwrap_or_else(|_| Utc::now()),
                note: row
                    .try_get::<Option<String>, _>("note")
                    .unwrap_or_default()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
            })
            .collect(),
    }))
}

fn build_invoice_pdf(context: &InvoicePdfContext) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(&context.invoice_number);
    let (regular_handle, bold_handle) = invoice_pdf_text_font_handles();

    let footer_text = format!(
        "{}: {}",
        invoice_pdf_label(&context.language, "generated_footer"),
        format_invoice_pdf_datetime(Utc::now())
    );
    let mut layout = InvoicePdfLayout::new(footer_text, regular_handle, bold_handle);

    layout.text_block(
        &context.invoice_number,
        10.0,
        true,
        0.0,
        InvoicePdfColor::Primary,
        0.0,
        4.0,
    );
    layout.text_block(
        invoice_pdf_label(&context.language, "invoice_title"),
        22.0,
        true,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        5.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "issued_on"),
            format_invoice_pdf_datetime(context.issued_at)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "due_date"),
            format_invoice_pdf_date(context.due_date)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "status"),
            invoice_pdf_status_label(&context.language, &context.status)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "invoice_type"),
            invoice_pdf_type_label(&context.language, &context.invoice_type)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        4.0,
    );

    let patient_line = match context
        .patient_title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(title) => format!("{title} {}", context.patient_name),
        None => context.patient_name.clone(),
    };
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "patient_name"),
            patient_line
        ),
        12.0,
        true,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "patient_id"),
            context.patient_pid
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "birth_date"),
            format_invoice_pdf_date(context.birth_date)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "order_number"),
            context.order_number
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "quote_number"),
            context.quote_number.as_deref().unwrap_or("n/a")
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        5.0,
    );

    layout.text_block(
        invoice_pdf_label(&context.language, "totals_heading"),
        14.0,
        true,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        3.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "total_net"),
            format_invoice_pdf_money(&context.total_net)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "total_vat"),
            format_invoice_pdf_money(&context.total_vat)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "total_gross"),
            format_invoice_pdf_money(&context.total_gross)
        ),
        11.0,
        true,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "paid_amount"),
            format_invoice_pdf_money(&context.paid_amount)
        ),
        11.0,
        false,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            invoice_pdf_label(&context.language, "balance_due"),
            format_invoice_pdf_money(&context.balance_due)
        ),
        11.0,
        true,
        0.0,
        InvoicePdfColor::Primary,
        0.0,
        5.0,
    );

    layout.text_block(
        invoice_pdf_label(&context.language, "items_heading"),
        14.0,
        true,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        3.0,
    );

    if context.line_items.is_empty() {
        layout.text_block(
            invoice_pdf_label(&context.language, "no_items"),
            11.0,
            false,
            0.0,
            InvoicePdfColor::Muted,
            0.0,
            4.0,
        );
    } else {
        for (index, item) in context.line_items.iter().enumerate() {
            layout.text_block(
                &format!("{}. {}", index + 1, item.description),
                12.0,
                true,
                0.0,
                InvoicePdfColor::Body,
                if index == 0 { 0.0 } else { 1.5 },
                1.0,
            );
            layout.text_block(
                &format!(
                    "{}: {} · {}: {} · {}: {}",
                    invoice_pdf_label(&context.language, "item_quantity"),
                    item.quantity,
                    invoice_pdf_label(&context.language, "item_unit_price"),
                    format_invoice_pdf_money(&item.unit_price),
                    invoice_pdf_label(&context.language, "item_total"),
                    format_invoice_pdf_money(&item.line_gross),
                ),
                10.5,
                false,
                4.0,
                InvoicePdfColor::Muted,
                0.0,
                0.8,
            );
            layout.text_block(
                &format!(
                    "{}: {} · {}: {} · {}: {}",
                    invoice_pdf_label(&context.language, "item_net"),
                    format_invoice_pdf_money(&item.line_net),
                    invoice_pdf_label(&context.language, "item_vat"),
                    format_invoice_pdf_money(&item.line_vat),
                    invoice_pdf_label(&context.language, "item_vat_rate"),
                    if item.vat_rate.trim().is_empty() {
                        "n/a".to_string()
                    } else {
                        format!("{}%", item.vat_rate.trim())
                    },
                ),
                10.5,
                false,
                4.0,
                InvoicePdfColor::Muted,
                0.0,
                0.8,
            );
            if item.is_cost_passthrough {
                layout.text_block(
                    invoice_pdf_label(&context.language, "cost_passthrough"),
                    10.0,
                    true,
                    4.0,
                    InvoicePdfColor::Primary,
                    0.0,
                    0.8,
                );
            }
            if let Some(note) = &item.notes {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        invoice_pdf_label(&context.language, "note_label"),
                        note
                    ),
                    10.0,
                    false,
                    4.0,
                    InvoicePdfColor::Body,
                    0.0,
                    1.0,
                );
            }
        }
        layout.spacer(2.0);
    }

    if !context.dunning_events.is_empty() {
        layout.text_block(
            invoice_pdf_label(&context.language, "dunning_heading"),
            14.0,
            true,
            0.0,
            InvoicePdfColor::Body,
            0.0,
            3.0,
        );
        for event in &context.dunning_events {
            layout.text_block(
                &format!(
                    "{} · {} · {}",
                    invoice_pdf_dunning_level_label(&context.language, &event.level),
                    format_invoice_pdf_datetime(event.sent_at),
                    format_invoice_pdf_money(&event.balance_due),
                ),
                10.5,
                true,
                0.0,
                InvoicePdfColor::Body,
                0.0,
                0.8,
            );
            if let Some(note) = &event.note {
                layout.text_block(note, 10.0, false, 4.0, InvoicePdfColor::Muted, 0.0, 0.8);
            }
        }
        layout.spacer(2.0);
    }

    if let Some(notes) = &context.notes {
        layout.text_block(
            invoice_pdf_label(&context.language, "notes_heading"),
            14.0,
            true,
            0.0,
            InvoicePdfColor::Body,
            0.0,
            3.0,
        );
        layout.text_block(notes, 10.5, false, 0.0, InvoicePdfColor::Body, 0.0, 0.0);
    }

    let mut warnings: Vec<PdfWarnMsg> = Vec::new();
    let save_options = pdf_text_save_options();
    let bytes = document
        .with_pages(layout.finish())
        .save(&save_options, &mut warnings);
    Ok(bytes)
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
                  i.portal_visible, i.hide_amounts_from_patient, i.line_items_visible_to_patient,
                  i.pdf_visible_to_patient,
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
             AND i.status <> 'draft'
             AND i.portal_visible = true
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

                    let mut invoice = serde_json::json!({
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
                        "portal_visibility": row_invoice_portal_visibility(&row),
                    });
                    redact_patient_invoice_payload(&mut invoice);
                    invoice
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
    if !invoice_is_patient_visible(
        invoice
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    ) {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    }
    if !invoice
        .get("portal_visibility")
        .and_then(|value| value.get("visible_to_patient"))
        .and_then(Value::as_bool)
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

    redact_patient_invoice_payload(&mut invoice);
    Json(invoice).into_response()
}

fn accounting_ledger_year(query: &AccountingLedgerQuery) -> i32 {
    query.year.unwrap_or_else(|| Utc::now().year())
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

async fn get_accounting_ledger(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<AccountingLedgerQuery>,
) -> axum::response::Response {
    if !can_read_accounting_ledger(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let year = accounting_ledger_year(&query);
    if let Some(patient_id) = query.patient_id
        && let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await
    {
        return resp;
    }
    let rows = match sqlx::query(
        r#"SELECT ae.id, ae.entry_date, ae.direction, ae.category, ae.description,
                  ae.amount_net, ae.amount_vat, ae.amount_gross, ae.currency,
                  i.invoice_number, ei.external_invoice_number, o.order_number,
                  p.patient_id AS patient_pid, p.first_name, p.last_name
           FROM accounting_entries ae
           LEFT JOIN invoices i ON i.id = ae.source_invoice_id
           LEFT JOIN external_invoices ei ON ei.id = ae.source_external_invoice_id
           LEFT JOIN orders o ON o.id = ae.order_id
           LEFT JOIN patients p ON p.id = ae.patient_id
           WHERE EXTRACT(YEAR FROM ae.entry_date) = $1
             AND ($2::uuid IS NULL OR ae.patient_id = $2)
           ORDER BY ae.entry_date DESC, ae.created_at DESC"#,
    )
    .bind(year)
    .bind(query.patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, year, "load accounting ledger");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load accounting ledger",
            );
        }
    };

    let mut income_gross = Decimal::ZERO;
    let mut expense_gross = Decimal::ZERO;
    let mut service_revenue_gross = Decimal::ZERO;
    let mut cost_passthrough_revenue_gross = Decimal::ZERO;
    let mut provider_expense_gross = Decimal::ZERO;
    let mut monthly: BTreeMap<String, (Decimal, Decimal)> = BTreeMap::new();
    let mut entries = Vec::with_capacity(rows.len());

    for row in rows {
        let entry_date: NaiveDate = row
            .try_get("entry_date")
            .unwrap_or_else(|_| Utc::now().date_naive());
        let direction: String = row.try_get("direction").unwrap_or_default();
        let category: String = row.try_get("category").unwrap_or_default();
        let amount_gross: Decimal = row.try_get("amount_gross").unwrap_or(Decimal::ZERO);
        let amount_net: Decimal = row.try_get("amount_net").unwrap_or(Decimal::ZERO);
        let amount_vat: Decimal = row.try_get("amount_vat").unwrap_or(Decimal::ZERO);
        let period = entry_date.format("%Y-%m").to_string();
        let month_bucket = monthly
            .entry(period)
            .or_insert((Decimal::ZERO, Decimal::ZERO));

        if direction == "income" {
            income_gross += amount_gross;
            month_bucket.0 += amount_gross;
        } else {
            expense_gross += amount_gross;
            month_bucket.1 += amount_gross;
        }

        match category.as_str() {
            "service_revenue" => service_revenue_gross += amount_gross,
            "cost_passthrough_revenue" => cost_passthrough_revenue_gross += amount_gross,
            "provider_expense" => provider_expense_gross += amount_gross,
            _ => {}
        }

        let patient_name = [
            row.try_get::<Option<String>, _>("first_name")
                .unwrap_or_default(),
            row.try_get::<Option<String>, _>("last_name")
                .unwrap_or_default(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");

        entries.push(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "entry_date": entry_date.to_string(),
            "direction": direction,
            "category": category,
            "description": row.try_get::<String, _>("description").unwrap_or_default(),
            "amount_net": decimal_to_string(amount_net),
            "amount_vat": decimal_to_string(amount_vat),
            "amount_gross": decimal_to_string(amount_gross),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "invoice_number": row.try_get::<Option<String>, _>("invoice_number").unwrap_or_default(),
            "external_invoice_number": row.try_get::<Option<String>, _>("external_invoice_number").unwrap_or_default(),
            "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
            "patient_pid": row.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
            "patient_name": if patient_name.is_empty() { None::<String> } else { Some(patient_name) },
        }));
    }

    let monthly_json = monthly
        .into_iter()
        .map(|(period, (income, expense))| {
            serde_json::json!({
                "period": period,
                "income_gross": decimal_to_string(income),
                "expense_gross": decimal_to_string(expense),
                "net_surplus": decimal_to_string(income - expense),
            })
        })
        .collect::<Vec<_>>();

    Json(serde_json::json!({
        "year": year,
        "summary": {
            "income_gross": decimal_to_string(income_gross),
            "expense_gross": decimal_to_string(expense_gross),
            "net_surplus": decimal_to_string(income_gross - expense_gross),
            "service_revenue_gross": decimal_to_string(service_revenue_gross),
            "cost_passthrough_revenue_gross": decimal_to_string(cost_passthrough_revenue_gross),
            "provider_expense_gross": decimal_to_string(provider_expense_gross),
        },
        "monthly": monthly_json,
        "entries": entries,
    }))
    .into_response()
}

async fn export_accounting_ledger(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<AccountingLedgerQuery>,
) -> axum::response::Response {
    if !can_read_accounting_ledger(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let year = accounting_ledger_year(&query);
    if let Some(patient_id) = query.patient_id
        && let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await
    {
        return resp;
    }
    let rows = match sqlx::query(
        r#"SELECT ae.entry_date, ae.direction, ae.category, ae.description,
                  ae.amount_net, ae.amount_vat, ae.amount_gross, ae.currency,
                  i.invoice_number, ei.external_invoice_number, o.order_number,
                  p.patient_id AS patient_pid, p.first_name, p.last_name
           FROM accounting_entries ae
           LEFT JOIN invoices i ON i.id = ae.source_invoice_id
           LEFT JOIN external_invoices ei ON ei.id = ae.source_external_invoice_id
           LEFT JOIN orders o ON o.id = ae.order_id
           LEFT JOIN patients p ON p.id = ae.patient_id
           WHERE EXTRACT(YEAR FROM ae.entry_date) = $1
             AND ($2::uuid IS NULL OR ae.patient_id = $2)
           ORDER BY ae.entry_date DESC, ae.created_at DESC"#,
    )
    .bind(year)
    .bind(query.patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, year, "export accounting ledger");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to export accounting ledger",
            );
        }
    };

    let mut csv = String::from(
        "entry_date,direction,category,description,invoice_number,external_invoice_number,order_number,patient_pid,patient_name,amount_net,amount_vat,amount_gross,currency\n",
    );

    for row in rows {
        let patient_name = [
            row.try_get::<Option<String>, _>("first_name")
                .unwrap_or_default(),
            row.try_get::<Option<String>, _>("last_name")
                .unwrap_or_default(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
        let entry_date: NaiveDate = row
            .try_get("entry_date")
            .unwrap_or_else(|_| Utc::now().date_naive());
        let amount_net: Decimal = row.try_get("amount_net").unwrap_or(Decimal::ZERO);
        let amount_vat: Decimal = row.try_get("amount_vat").unwrap_or(Decimal::ZERO);
        let amount_gross: Decimal = row.try_get("amount_gross").unwrap_or(Decimal::ZERO);

        let line = [
            csv_escape(&entry_date.to_string()),
            csv_escape(&row.try_get::<String, _>("direction").unwrap_or_default()),
            csv_escape(&row.try_get::<String, _>("category").unwrap_or_default()),
            csv_escape(&row.try_get::<String, _>("description").unwrap_or_default()),
            csv_escape(
                &row.try_get::<Option<String>, _>("invoice_number")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            ),
            csv_escape(
                &row.try_get::<Option<String>, _>("external_invoice_number")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            ),
            csv_escape(
                &row.try_get::<Option<String>, _>("order_number")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            ),
            csv_escape(
                &row.try_get::<Option<String>, _>("patient_pid")
                    .unwrap_or_default()
                    .unwrap_or_default(),
            ),
            csv_escape(&patient_name),
            csv_escape(&decimal_to_string(amount_net)),
            csv_escape(&decimal_to_string(amount_vat)),
            csv_escape(&decimal_to_string(amount_gross)),
            csv_escape(
                &row.try_get::<String, _>("currency")
                    .unwrap_or_else(|_| "EUR".to_string()),
            ),
        ]
        .join(",");
        csv.push_str(&line);
        csv.push('\n');
    }

    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                &format!("attachment; filename=\"accounting-ledger-{year}.csv\""),
            ),
        ],
        csv,
    )
        .into_response()
}

async fn list_invoices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListInvoicesQuery>,
) -> axum::response::Response {
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
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
    let page = match normalize_invoice_list_page(query.page) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let per_page = match normalize_invoice_list_per_page(query.per_page) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    match sqlx::query(
        r#"SELECT i.id, i.quote_id, i.order_id, i.patient_id, i.invoice_number, i.invoice_type,
                  i.status, i.issued_at, i.due_date, i.total_net, i.total_vat, i.total_gross,
                  i.paid_amount, i.paid_at, i.created_at, i.updated_at,
                  i.portal_visible, i.hide_amounts_from_patient, i.line_items_visible_to_patient,
                  i.pdf_visible_to_patient, i.payer_contact_name, i.payer_contact_relationship,
                  o.order_number, q.quote_number, p.first_name, p.last_name, p.patient_id AS patient_pid
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           JOIN patients p ON p.id = i.patient_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           WHERE ($1::text IS NULL
                   OR de_normalize(concat_ws(' ',
                        i.invoice_number, o.order_number, q.quote_number,
                        p.patient_id, p.first_name, p.last_name,
                        p.email, p.phone_primary, p.phone_secondary,
                        i.payer_contact_name, i.payer_contact_email, i.payer_contact_phone
                      )) LIKE de_normalize($1))
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
                    "portal_visible": row.try_get::<bool, _>("portal_visible").unwrap_or(true),
                    "hide_amounts_from_patient": row.try_get::<bool, _>("hide_amounts_from_patient").unwrap_or(false),
                    "line_items_visible_to_patient": row.try_get::<bool, _>("line_items_visible_to_patient").unwrap_or(true),
                    "pdf_visible_to_patient": row.try_get::<bool, _>("pdf_visible_to_patient").unwrap_or(true),
                    "portal_visibility": row_invoice_portal_visibility(&row),
                    "payer": {
                        "contact_name": row.try_get::<Option<String>, _>("payer_contact_name").unwrap_or_default(),
                        "contact_relationship": row.try_get::<Option<String>, _>("payer_contact_relationship").unwrap_or_default(),
                    },
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            let total = items.len();
            let total_pages = total.div_ceil(per_page).max(1);
            let page = page.min(total_pages);
            let offset = (page - 1) * per_page;
            let items = items
                .into_iter()
                .skip(offset)
                .take(per_page)
                .collect::<Vec<_>>();

            Json(json!({
                "items": items,
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": total_pages,
            }))
            .into_response()
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
    if !can_create_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
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
            if let Err(resp) =
                link_approved_package_consumptions_to_invoice(&state, &ctx, invoice_id).await
            {
                return resp;
            }

            state.audit_sender.try_send(audit::domain_event(
                "create_invoice",
                Some(auth.user_id),
                "invoice",
                Some(invoice_id),
                serde_json::json!({
                    "invoice_number": invoice_number,
                    "invoice_type": invoice_type,
                    "quote_id": ctx.quote_id,
                    "order_id": ctx.order_id,
                    "patient_id": ctx.patient_id,
                    "contract_id": ctx.contract_id,
                    "quote_number": ctx.quote_number,
                    "order_number": ctx.order_number,
                }),
            ));

            crate::realtime::publish_invoice_event(
                &state,
                Some(auth.user_id),
                "invoice.created",
                invoice_id,
                serde_json::json!({
                    "invoice_number": invoice_number,
                    "invoice_type": invoice_type,
                    "quote_id": ctx.quote_id,
                    "order_id": ctx.order_id,
                    "patient_id": ctx.patient_id,
                    "status": "draft",
                }),
            )
            .await;

            match load_invoice_detail(&state, invoice_id, &auth).await {
                Ok(Some(invoice)) => (StatusCode::CREATED, Json(invoice)).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
                Err(resp) => resp,
            }
        }
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => err(
            StatusCode::CONFLICT,
            "An active invoice already exists for this quote scope",
        ),
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
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => Json(invoice).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(resp) => resp,
    }
}

async fn download_invoice_pdf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let Some(context) = (match load_invoice_pdf_context(&state, invoice_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    }) else {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    };

    if let Err(resp) = ensure_patient_access(&state, &auth, context.patient_id).await {
        return resp;
    }

    let pdf_bytes = match build_invoice_pdf(&context) {
        Ok(bytes) => bytes,
        Err(message) => return err(StatusCode::INTERNAL_SERVER_ERROR, message),
    };

    state.audit_sender.try_send(audit::domain_event(
        "download_invoice_pdf",
        Some(auth.user_id),
        "invoice",
        Some(context.invoice_id),
        serde_json::json!({
            "invoice_number": context.invoice_number,
            "source": "staff_workspace",
        }),
    ));

    let disposition = format!(
        "inline; filename=\"{}\"",
        invoice_pdf_filename(&context).replace('"', "")
    );

    axum::response::Response::builder()
        .header("content-type", "application/pdf")
        .header("content-disposition", disposition)
        .body(Body::from(pdf_bytes))
        .unwrap()
}

async fn download_my_invoice_pdf(
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

    let Some(context) = (match load_invoice_pdf_context(&state, invoice_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    }) else {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    };

    if context.patient_id != patient_id {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    }
    if !invoice_is_patient_visible(&context.status) || !context.portal_visible {
        return err(StatusCode::NOT_FOUND, "Invoice not found");
    }
    if context.hide_amounts_from_patient || !context.pdf_visible_to_patient {
        return err(StatusCode::FORBIDDEN, "Invoice PDF is hidden from patient");
    }

    let pdf_bytes = match build_invoice_pdf(&context) {
        Ok(bytes) => bytes,
        Err(message) => return err(StatusCode::INTERNAL_SERVER_ERROR, message),
    };

    state.audit_sender.try_send(audit::domain_event(
        "download_portal_invoice_pdf",
        Some(auth.user_id),
        "invoice",
        Some(context.invoice_id),
        serde_json::json!({
            "invoice_number": context.invoice_number,
            "source": "patient_portal",
        }),
    ));

    let disposition = format!(
        "inline; filename=\"{}\"",
        invoice_pdf_filename(&context).replace('"', "")
    );

    axum::response::Response::builder()
        .header("content-type", "application/pdf")
        .header("content-disposition", disposition)
        .body(Body::from(pdf_bytes))
        .unwrap()
}

async fn list_dunning_events(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
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
    if !can_manage_invoice_finance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
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

    let existing_levels = match load_existing_dunning_levels(&state, invoice_id).await {
        Ok(levels) => levels,
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "load existing dunning levels");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate dunning sequence",
            );
        }
    };

    if let Err(message) = validate_dunning_level_transition(&existing_levels, &body.level) {
        let status = if message.contains("already exists") {
            StatusCode::CONFLICT
        } else {
            StatusCode::UNPROCESSABLE_ENTITY
        };
        return err(status, message);
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
            let dunning_event_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
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

            write_invoice_audit(
                &state,
                auth.user_id,
                "create_invoice_dunning_event",
                invoice_id,
                serde_json::json!({
                    "level": body.level,
                    "balance_due": decimal_to_string(balance_due),
                    "due_date_snapshot": due_date.to_string(),
                }),
            )
            .await;

            crate::realtime::publish_invoice_event(
                &state,
                Some(auth.user_id),
                "invoice.dunning_created",
                invoice_id,
                serde_json::json!({
                    "dunning_event_id": dunning_event_id,
                    "level": body.level,
                    "status": "overdue",
                    "balance_due": decimal_to_string(balance_due),
                    "due_date_snapshot": due_date.to_string(),
                }),
            )
            .await;

            Json(serde_json::json!({
                "id": dunning_event_id,
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

async fn update_invoice_visibility(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<UpdateInvoiceVisibilityRequest>,
) -> axum::response::Response {
    if !can_manage_invoice_visibility(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let current = match sqlx::query(
        r#"SELECT patient_id, portal_visible, hide_amounts_from_patient,
                  line_items_visible_to_patient, pdf_visible_to_patient
           FROM invoices
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice visibility context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update invoice visibility",
            );
        }
    };

    let patient_id = current.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let portal_visible = body
        .portal_visible
        .unwrap_or_else(|| current.try_get::<bool, _>("portal_visible").unwrap_or(true));
    let hide_amounts = body.hide_amounts_from_patient.unwrap_or_else(|| {
        current
            .try_get::<bool, _>("hide_amounts_from_patient")
            .unwrap_or(false)
    });
    let line_items_visible = if !portal_visible || hide_amounts {
        false
    } else {
        body.line_items_visible_to_patient.unwrap_or_else(|| {
            current
                .try_get::<bool, _>("line_items_visible_to_patient")
                .unwrap_or(true)
        })
    };
    let pdf_visible = if !portal_visible || hide_amounts {
        false
    } else {
        body.pdf_visible_to_patient.unwrap_or_else(|| {
            current
                .try_get::<bool, _>("pdf_visible_to_patient")
                .unwrap_or(true)
        })
    };
    let visibility_note = normalize_optional(body.visibility_note.as_deref());

    match sqlx::query(
        r#"UPDATE invoices
           SET portal_visible = $2,
               hide_amounts_from_patient = $3,
               line_items_visible_to_patient = $4,
               pdf_visible_to_patient = $5,
               visibility_note = $6,
               visibility_updated_by = $7,
               visibility_updated_at = now()
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .bind(portal_visible)
    .bind(hide_amounts)
    .bind(line_items_visible)
    .bind(pdf_visible)
    .bind(visibility_note.clone())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            write_invoice_audit(
                &state,
                auth.user_id,
                "invoice_visibility_changed",
                invoice_id,
                serde_json::json!({
                    "patient_id": patient_id,
                    "portal_visible": portal_visible,
                    "hide_amounts_from_patient": hide_amounts,
                    "line_items_visible_to_patient": line_items_visible,
                    "pdf_visible_to_patient": pdf_visible,
                    "visibility_note": visibility_note,
                }),
            )
            .await;

            crate::realtime::publish_invoice_event(
                &state,
                Some(auth.user_id),
                "invoice.visibility_changed",
                invoice_id,
                serde_json::json!({
                    "patient_id": patient_id,
                    "portal_visibility": invoice_portal_visibility_payload(
                        portal_visible,
                        hide_amounts,
                        line_items_visible,
                        pdf_visible,
                    ),
                }),
            )
            .await;

            match load_invoice_detail(&state, invoice_id, &auth).await {
                Ok(Some(invoice)) => Json(invoice).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "update invoice visibility");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update invoice visibility",
            )
        }
    }
}

async fn update_invoice_payer(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<UpdateInvoicePayerRequest>,
) -> axum::response::Response {
    if !can_manage_invoice_visibility(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let row = match sqlx::query("SELECT patient_id FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "load invoice payer context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update invoice payer",
            );
        }
    };

    let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    if let Some(relation_id) = body.payer_patient_relation_id {
        let relation_matches = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM patient_relations WHERE id = $1 AND patient_id = $2)",
        )
        .bind(relation_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !relation_matches {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Payer relation does not belong to invoice patient",
            );
        }
    }

    let payer_contact_name = normalize_optional(body.payer_contact_name.as_deref());
    let payer_contact_email = normalize_optional(body.payer_contact_email.as_deref());
    let payer_contact_phone = normalize_optional(body.payer_contact_phone.as_deref());
    let payer_contact_relationship = normalize_optional(body.payer_contact_relationship.as_deref());
    let payer_notes = normalize_optional(body.payer_notes.as_deref());

    match sqlx::query(
        r#"UPDATE invoices
           SET payer_patient_relation_id = $2,
               payer_contact_name = $3,
               payer_contact_email = $4,
               payer_contact_phone = $5,
               payer_contact_relationship = $6,
               payer_notes = $7,
               payer_updated_by = $8,
               payer_updated_at = now()
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .bind(body.payer_patient_relation_id)
    .bind(payer_contact_name.clone())
    .bind(payer_contact_email.clone())
    .bind(payer_contact_phone.clone())
    .bind(payer_contact_relationship.clone())
    .bind(payer_notes.clone())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            write_invoice_audit(
                &state,
                auth.user_id,
                "payer_assigned",
                invoice_id,
                serde_json::json!({
                    "patient_id": patient_id,
                    "payer_patient_relation_id": body.payer_patient_relation_id,
                    "payer_contact_name": payer_contact_name,
                    "payer_contact_relationship": payer_contact_relationship,
                }),
            )
            .await;

            crate::realtime::publish_invoice_event(
                &state,
                Some(auth.user_id),
                "invoice.payer_changed",
                invoice_id,
                serde_json::json!({
                    "patient_id": patient_id,
                    "payer_patient_relation_id": body.payer_patient_relation_id,
                }),
            )
            .await;

            match load_invoice_detail(&state, invoice_id, &auth).await {
                Ok(Some(invoice)) => Json(invoice).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(e) => {
            tracing::error!(error = %e, invoice_id = %invoice_id, "update invoice payer");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update invoice payer",
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
    if !can_manage_invoice_finance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
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
        Some(value) => match value.parse_decimal() {
            Some(decimal) if decimal >= Decimal::ZERO => decimal.round_dp(2),
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
    let paid_at_payload = paid_at.as_ref().map(|value| value.to_rfc3339());

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
            if let Err(error) = sync_invoice_accounting_entries_from_current_state(
                &state,
                invoice_id,
                Some(auth.user_id),
            )
            .await
            {
                tracing::error!(error = %error, invoice_id = %invoice_id, "sync invoice accounting entries");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update invoice accounting ledger",
                );
            }

            state.audit_sender.try_send(audit::domain_event(
                "update_invoice_status",
                Some(auth.user_id),
                "invoice",
                Some(invoice_id),
                serde_json::json!({
                    "status": effective_status.clone(),
                    "paid_amount": decimal_to_string(effective_paid_amount),
                    "due_date": due_date.map(|value| value.to_string()),
                }),
            ));

            crate::realtime::publish_invoice_event(
                &state,
                Some(auth.user_id),
                "invoice.status_changed",
                invoice_id,
                serde_json::json!({
                    "patient_id": patient_id,
                    "status": effective_status,
                    "paid_amount": decimal_to_string(effective_paid_amount),
                    "due_date": due_date.map(|value| value.to_string()),
                    "paid_at": paid_at_payload,
                }),
            )
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

#[cfg(test)]
mod tests {
    use super::{
        InvoicePdfContext, InvoicePdfLineItem, build_invoice_pdf, invoice_pdf_footer_line,
    };
    use chrono::{NaiveDate, Utc};
    use uuid::Uuid;

    #[test]
    fn invoice_footer_includes_current_and_total_pages() {
        assert_eq!(invoice_pdf_footer_line("GMED", 2, 5), "GMED · Page 2 of 5");
    }

    #[test]
    fn invoice_pdf_uses_renderable_builtin_font_text() {
        let context = InvoicePdfContext {
            invoice_id: Uuid::new_v4(),
            patient_id: Uuid::new_v4(),
            invoice_number: "INV-UNIT-1".to_string(),
            invoice_type: "final".to_string(),
            status: "sent".to_string(),
            portal_visible: true,
            hide_amounts_from_patient: false,
            pdf_visible_to_patient: true,
            issued_at: Utc::now(),
            due_date: Some(NaiveDate::from_ymd_opt(2026, 6, 30).unwrap()),
            total_net: "145.00".to_string(),
            total_vat: "0.00".to_string(),
            total_gross: "145.00".to_string(),
            paid_amount: "0.00".to_string(),
            balance_due: "145.00".to_string(),
            notes: Some("Zahlbar nach Rechnungserhalt.".to_string()),
            patient_pid: "PT-INV-UNIT".to_string(),
            patient_name: "Max Müller".to_string(),
            patient_title: Some("Dr.".to_string()),
            birth_date: Some(NaiveDate::from_ymd_opt(1990, 1, 1).unwrap()),
            order_number: "ORD-UNIT-1".to_string(),
            quote_number: Some("Q-UNIT-1".to_string()),
            language: "de".to_string(),
            line_items: vec![InvoicePdfLineItem {
                description: "Approved PDF line".to_string(),
                quantity: "1".to_string(),
                unit_price: "145.00".to_string(),
                vat_rate: "0".to_string(),
                is_cost_passthrough: false,
                line_net: "145.00".to_string(),
                line_vat: "0.00".to_string(),
                line_gross: "145.00".to_string(),
                notes: None,
            }],
            dunning_events: Vec::new(),
        };

        let bytes = build_invoice_pdf(&context).unwrap();
        let raw_pdf = String::from_utf8_lossy(&bytes);

        assert!(raw_pdf.contains("/F5"));
        assert!(raw_pdf.contains("/F6"));
        assert!(raw_pdf.contains("INV-UNIT-1"));
        assert!(raw_pdf.contains("Approved PDF line"));
        assert!(raw_pdf.contains("4D6178204DFC6C6C6572"));
        assert!(!raw_pdf.contains("4D6178204DC3BC6C6C6572"));
        assert!(!raw_pdf.contains("[] TJ"));

        let extracted_text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(extracted_text.contains("INV-UNIT-1"));
        assert!(extracted_text.contains("Approved PDF line"));
        assert!(extracted_text.contains("PT-INV-UNIT"));
        assert!(extracted_text.contains("Müller"));
    }
}
