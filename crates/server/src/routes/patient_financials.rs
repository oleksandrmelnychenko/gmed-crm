use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::{access, audit};
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/financial-summary",
            get(get_patient_financial_summary),
        )
        .route(
            "/patients/{patient_id}/financial-ledger",
            get(get_patient_financial_ledger),
        )
        .route(
            "/patients/{patient_id}/financial-ledger/export",
            get(export_patient_financial_ledger),
        )
        .route(
            "/patients/{patient_id}/account-statement",
            get(get_patient_account_statement),
        )
        .route(
            "/patients/{patient_id}/balance-adjustments",
            get(list_patient_balance_adjustments).post(create_patient_balance_adjustment),
        )
        .route(
            "/patients/{patient_id}/balance-adjustments/{adjustment_id}/reversal",
            post(reverse_patient_balance_adjustment),
        )
        .route("/me/account-statement", get(get_my_account_statement))
}

#[derive(Deserialize)]
struct PatientFinancialQuery {
    from: Option<String>,
    to: Option<String>,
    order_id: Option<Uuid>,
    package_id: Option<Uuid>,
    include_pass_through: Option<bool>,
    currency: Option<String>,
}

#[derive(Deserialize)]
struct CreatePatientBalanceAdjustmentRequest {
    request_id: Uuid,
    direction: String,
    category: String,
    amount: Value,
    currency: String,
    effective_on: String,
    order_id: Option<Uuid>,
    reason: String,
    note: Option<String>,
    portal_visible: Option<bool>,
}

#[derive(Deserialize)]
struct ReversePatientBalanceAdjustmentRequest {
    request_id: Uuid,
    reason: String,
    effective_on: Option<String>,
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

fn can_read_patient_financials(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    )
}

fn can_read_profit_margin(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn can_manage_patient_balance(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
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
            tracing::error!(error = %e, patient_id = %patient_id, "validate patient financial access");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

fn parse_query_date(value: Option<&str>, field: &'static str) -> Result<Option<NaiveDate>, String> {
    match value {
        Some(raw) if !raw.trim().is_empty() => NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map(Some)
            .map_err(|_| format!("Invalid {field} (YYYY-MM-DD)")),
        _ => Ok(None),
    }
}

fn parse_query_currency(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let currency = raw.trim().to_uppercase();
    if currency.len() != 3
        || !currency
            .chars()
            .all(|character| character.is_ascii_alphabetic())
    {
        return Err("Invalid currency (ISO 4217 code expected)".to_string());
    }
    Ok(Some(currency))
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn value_to_decimal(value: &Value) -> Decimal {
    match value {
        Value::String(text) => text.parse().unwrap_or(Decimal::ZERO),
        Value::Number(number) => number.to_string().parse().unwrap_or(Decimal::ZERO),
        _ => Decimal::ZERO,
    }
}

fn line_service_type(item: &Value) -> String {
    item.get("service_type")
        .and_then(Value::as_str)
        .or_else(|| item.get("service_key").and_then(Value::as_str))
        .unwrap_or("other")
        .to_string()
}

struct SettlementMovement {
    id: String,
    kind: String,
    entry_date: NaiveDate,
    occurred_at: DateTime<Utc>,
    order_id: Option<Uuid>,
    order_number: Option<String>,
    document_number: Option<String>,
    description: String,
    debit: Decimal,
    credit: Decimal,
}

struct SettlementLedger {
    opening_balance: Decimal,
    debit_total: Decimal,
    credit_total: Decimal,
    calculated_balance: Decimal,
    settlement_invoice_debit: Decimal,
    external_balance: Decimal,
    movements: Vec<Value>,
}

async fn load_patient_settlement_ledger(
    state: &AppState,
    patient_id: Uuid,
    query: &PatientFinancialQuery,
    portal_scope: bool,
    currency: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
) -> Result<SettlementLedger, sqlx::Error> {
    let rows = sqlx::query(
        r#"WITH scoped_invoices AS (
               SELECT invoice.*, orders.order_number
               FROM invoices invoice
               JOIN orders ON orders.id = invoice.order_id
               WHERE invoice.patient_id = $1
                 AND ($3::uuid IS NULL OR invoice.order_id = $3)
                 AND ($4::uuid IS NULL OR EXISTS (
                        SELECT 1
                        FROM patient_service_packages package
                        WHERE package.patient_id = invoice.patient_id
                          AND package.package_id = $4
                          AND (
                                package.order_id = invoice.order_id
                                OR EXISTS (
                                    SELECT 1
                                    FROM service_package_consumptions consumption
                                    WHERE consumption.patient_service_package_id = package.id
                                      AND (
                                            consumption.order_id = invoice.order_id
                                            OR consumption.invoice_id = invoice.id
                                      )
                                )
                          )
                 ))
                 AND orders.currency = $6
                 AND (
                        $5::boolean = false
                        OR (
                            invoice.portal_visible = true
                            AND invoice.hide_amounts_from_patient = false
                            AND invoice.status NOT IN ('draft', 'cancelled')
                        )
                 )
           ), scoped_external AS (
               SELECT external.*, orders.order_number,
                      provider.name AS provider_name
               FROM external_invoices external
               JOIN orders ON orders.id = external.order_id
               LEFT JOIN providers provider ON provider.id = external.provider_id
               WHERE external.patient_id = $1
                 AND $5::boolean = false
                 AND external.status <> 'cancelled'
                 AND external.patient_receivable_gross > 0
                 AND ($3::uuid IS NULL OR external.order_id = $3)
                 AND ($4::uuid IS NULL OR EXISTS (
                        SELECT 1
                        FROM patient_service_packages package
                        WHERE package.patient_id = external.patient_id
                          AND package.package_id = $4
                          AND package.order_id = external.order_id
                 ))
                 AND external.currency = $6
           ), scoped_adjustments AS (
               SELECT adjustment.*, orders.order_number
               FROM patient_balance_adjustments adjustment
               LEFT JOIN orders ON orders.id = adjustment.order_id
               WHERE adjustment.patient_id = $1
                 AND adjustment.currency = $6
                 AND ($3::uuid IS NULL OR adjustment.order_id = $3)
                 AND ($4::uuid IS NULL OR EXISTS (
                        SELECT 1
                        FROM patient_service_packages package
                        WHERE package.patient_id = adjustment.patient_id
                          AND package.package_id = $4
                          AND package.order_id = adjustment.order_id
                 ))
           ), journal_paid AS (
               SELECT payment.invoice_id,
                      COALESCE(SUM(
                          CASE
                              WHEN payment.transaction_type = 'payment' THEN payment.amount_gross
                              ELSE -payment.amount_gross
                          END
                      ), 0) AS journal_amount
               FROM invoice_payment_transactions payment
               JOIN scoped_invoices invoice ON invoice.id = payment.invoice_id
               GROUP BY payment.invoice_id
           ), journal_refunded AS (
               SELECT refund.invoice_id,
                      COALESCE(SUM(
                          CASE
                              WHEN refund.transaction_type = 'refund' THEN refund.amount_gross
                              ELSE -refund.amount_gross
                          END
                      ), 0) AS journal_amount
               FROM invoice_refund_transactions refund
               JOIN scoped_invoices invoice ON invoice.id = refund.invoice_id
               GROUP BY refund.invoice_id
           )
           SELECT 'invoice:' || invoice.id::text AS movement_id,
                  'invoice'::text AS movement_kind,
                  invoice.issued_at::date AS entry_date,
                  invoice.issued_at AS occurred_at,
                  invoice.order_id,
                  invoice.order_number,
                  invoice.invoice_number AS document_number,
                  'Patient invoice'::text AS description,
                  invoice.total_gross AS debit,
                  0::numeric AS credit
           FROM scoped_invoices invoice
           WHERE invoice.invoice_type <> 'advance'
             AND invoice.status NOT IN ('draft', 'cancelled')
             AND ($2::date IS NULL OR invoice.issued_at::date <= $2)

           UNION ALL

           SELECT 'credit-note:' || credit.id::text,
                  CASE
                      WHEN credit.transaction_type = 'reversal'
                          THEN 'credit_note_reversal'
                      ELSE 'credit_note'
                  END,
                  credit.issued_on,
                  credit.created_at,
                  invoice.order_id,
                  invoice.order_number,
                  CASE
                      WHEN $5::boolean = true AND credit.portal_visible = false
                          THEN invoice.invoice_number
                      ELSE credit.document_number
                  END,
                  CASE
                      WHEN $5::boolean = true AND credit.portal_visible = false
                          THEN 'Invoice adjustment'
                      ELSE credit.reason
                  END,
                  CASE
                      WHEN credit.transaction_type = 'reversal'
                          THEN credit.amount_gross
                      ELSE 0::numeric
                  END,
                  CASE
                      WHEN credit.transaction_type = 'credit_note'
                          THEN credit.amount_gross
                      ELSE 0::numeric
                  END
           FROM invoice_credit_note_transactions credit
           JOIN scoped_invoices invoice ON invoice.id = credit.invoice_id
           WHERE invoice.invoice_type <> 'advance'
             AND ($2::date IS NULL OR credit.issued_on <= $2)

           UNION ALL

           SELECT 'payment:' || payment.id::text,
                  CASE
                      WHEN payment.transaction_type = 'reversal'
                          THEN 'payment_reversal'
                      ELSE 'payment'
                  END,
                  payment.received_on,
                  payment.created_at,
                  invoice.order_id,
                  invoice.order_number,
                  invoice.invoice_number,
                  CASE
                      WHEN payment.transaction_type = 'reversal'
                          THEN 'Payment reversal'
                      WHEN invoice.invoice_type = 'advance'
                          THEN 'Advance payment received'
                      ELSE 'Payment received'
                  END,
                  CASE
                      WHEN payment.transaction_type = 'reversal'
                          THEN payment.amount_gross
                      ELSE 0::numeric
                  END,
                  CASE
                      WHEN payment.transaction_type = 'payment'
                          THEN payment.amount_gross
                      ELSE 0::numeric
                  END
           FROM invoice_payment_transactions payment
           JOIN scoped_invoices invoice ON invoice.id = payment.invoice_id
           WHERE $2::date IS NULL OR payment.received_on <= $2

           UNION ALL

           SELECT 'refund:' || refund.id::text,
                  CASE
                      WHEN refund.transaction_type = 'reversal'
                          THEN 'refund_reversal'
                      ELSE 'refund'
                  END,
                  refund.refunded_on,
                  refund.created_at,
                  invoice.order_id,
                  invoice.order_number,
                  invoice.invoice_number,
                  refund.reason,
                  CASE
                      WHEN refund.transaction_type = 'refund'
                          THEN refund.amount_gross
                      ELSE 0::numeric
                  END,
                  CASE
                      WHEN refund.transaction_type = 'reversal'
                          THEN refund.amount_gross
                      ELSE 0::numeric
                  END
           FROM invoice_refund_transactions refund
           JOIN scoped_invoices invoice ON invoice.id = refund.invoice_id
           WHERE $2::date IS NULL OR refund.refunded_on <= $2

           UNION ALL

           SELECT 'adjustment:' || adjustment.id::text,
                  CASE
                      WHEN adjustment.transaction_type = 'reversal'
                          THEN 'balance_adjustment_reversal'
                      ELSE 'balance_adjustment'
                  END,
                  adjustment.effective_on,
                  adjustment.created_at,
                  adjustment.order_id,
                  adjustment.order_number,
                  NULL::text,
                  CASE
                      WHEN $5::boolean = true AND adjustment.portal_visible = false
                          THEN 'Account adjustment'
                      ELSE adjustment.reason
                  END,
                  CASE WHEN adjustment.direction = 'debit' THEN adjustment.amount ELSE 0::numeric END,
                  CASE WHEN adjustment.direction = 'credit' THEN adjustment.amount ELSE 0::numeric END
           FROM scoped_adjustments adjustment
           WHERE $2::date IS NULL OR adjustment.effective_on <= $2

           UNION ALL

           SELECT 'payment-balance:' || invoice.id::text,
                  'payment'::text,
                  COALESCE(invoice.paid_at::date, invoice.issued_at::date),
                  COALESCE(invoice.paid_at, invoice.updated_at, invoice.created_at),
                  invoice.order_id,
                  invoice.order_number,
                  invoice.invoice_number,
                  CASE
                      WHEN invoice.invoice_type = 'advance'
                          THEN 'Advance payment opening balance'
                      ELSE 'Payment opening balance'
                  END,
                  0::numeric,
                  GREATEST(
                      invoice.paid_amount
                          - (
                              COALESCE(journal.journal_amount, 0)
                              - COALESCE(refunded.journal_amount, 0)
                          ),
                      0
                  )
           FROM scoped_invoices invoice
           LEFT JOIN journal_paid journal ON journal.invoice_id = invoice.id
           LEFT JOIN journal_refunded refunded ON refunded.invoice_id = invoice.id
           WHERE invoice.paid_amount
                 > COALESCE(journal.journal_amount, 0)
                   - COALESCE(refunded.journal_amount, 0)
             AND ($2::date IS NULL OR COALESCE(invoice.paid_at::date, invoice.issued_at::date) <= $2)

           UNION ALL

           SELECT 'external:' || external.id::text,
                  'external_receivable'::text,
                  COALESCE(external.invoice_date, external.created_at::date),
                  external.created_at,
                  external.order_id,
                  external.order_number,
                  external.external_invoice_number,
                  COALESCE(external.provider_name, 'External provider'),
                  external.patient_receivable_gross,
                  0::numeric
           FROM scoped_external external
           WHERE $2::date IS NULL
              OR COALESCE(external.invoice_date, external.created_at::date) <= $2

           UNION ALL

           SELECT 'external-allocation:' || allocation.id::text,
                  'external_allocation'::text,
                  allocation.created_at::date,
                  allocation.created_at,
                  external.order_id,
                  external.order_number,
                  patient_invoice.invoice_number,
                  COALESCE(external.provider_name, 'External provider')
                      || ' -> ' || patient_invoice.invoice_number,
                  0::numeric,
                  allocation.amount_gross
           FROM external_invoice_patient_invoice_allocations allocation
           JOIN scoped_external external
             ON external.id = allocation.external_invoice_id
           JOIN invoices patient_invoice
             ON patient_invoice.id = allocation.patient_invoice_id
           WHERE $2::date IS NULL OR allocation.created_at::date <= $2

           UNION ALL

           SELECT 'external-allocation-reversal:' || allocation.id::text,
                  'external_allocation_reversal'::text,
                  allocation.reversed_at::date,
                  allocation.reversed_at,
                  external.order_id,
                  external.order_number,
                  patient_invoice.invoice_number,
                  COALESCE(NULLIF(allocation.reversal_note, ''),
                           'External receivable allocation reversed'),
                  allocation.amount_gross,
                  0::numeric
           FROM external_invoice_patient_invoice_allocations allocation
           JOIN scoped_external external
             ON external.id = allocation.external_invoice_id
           JOIN invoices patient_invoice
             ON patient_invoice.id = allocation.patient_invoice_id
           WHERE allocation.reversed_at IS NOT NULL
             AND ($2::date IS NULL OR allocation.reversed_at::date <= $2)

           UNION ALL

           SELECT 'external-allocation-reopened:' || allocation.id::text,
                  'external_allocation_reversal'::text,
                  patient_invoice.updated_at::date,
                  patient_invoice.updated_at,
                  external.order_id,
                  external.order_number,
                  patient_invoice.invoice_number,
                  'Patient invoice cancelled; external receivable reopened'::text,
                  allocation.amount_gross,
                  0::numeric
           FROM external_invoice_patient_invoice_allocations allocation
           JOIN scoped_external external
             ON external.id = allocation.external_invoice_id
           JOIN invoices patient_invoice
             ON patient_invoice.id = allocation.patient_invoice_id
           WHERE allocation.reversed_at IS NULL
             AND patient_invoice.status IN ('draft', 'cancelled')
             AND patient_invoice.updated_at >= allocation.created_at
             AND ($2::date IS NULL OR patient_invoice.updated_at::date <= $2)

           ORDER BY entry_date, occurred_at, movement_id"#,
    )
    .bind(patient_id)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .bind(portal_scope)
    .bind(currency)
    .fetch_all(&state.db)
    .await?;

    let mut source_movements = rows
        .into_iter()
        .map(|row| SettlementMovement {
            id: row.try_get::<String, _>("movement_id").unwrap_or_default(),
            kind: row
                .try_get::<String, _>("movement_kind")
                .unwrap_or_default(),
            entry_date: row
                .try_get::<NaiveDate, _>("entry_date")
                .unwrap_or_else(|_| Utc::now().date_naive()),
            occurred_at: row
                .try_get::<DateTime<Utc>, _>("occurred_at")
                .unwrap_or_else(|_| Utc::now()),
            order_id: row
                .try_get::<Option<Uuid>, _>("order_id")
                .unwrap_or_default(),
            order_number: row
                .try_get::<Option<String>, _>("order_number")
                .unwrap_or_default(),
            document_number: row
                .try_get::<Option<String>, _>("document_number")
                .unwrap_or_default(),
            description: row.try_get::<String, _>("description").unwrap_or_default(),
            debit: row.try_get::<Decimal, _>("debit").unwrap_or(Decimal::ZERO),
            credit: row.try_get::<Decimal, _>("credit").unwrap_or(Decimal::ZERO),
        })
        .collect::<Vec<_>>();
    source_movements.sort_by(|left, right| {
        left.entry_date
            .cmp(&right.entry_date)
            .then_with(|| left.occurred_at.cmp(&right.occurred_at))
            .then_with(|| left.id.cmp(&right.id))
    });

    let settlement_invoice_debit = source_movements
        .iter()
        .filter(|movement| {
            matches!(
                movement.kind.as_str(),
                "invoice" | "credit_note" | "credit_note_reversal"
            )
        })
        .fold(Decimal::ZERO, |total, movement| {
            total + movement.debit - movement.credit
        })
        .round_dp(2);
    let external_balance = source_movements
        .iter()
        .filter(|movement| movement.kind.starts_with("external_"))
        .fold(Decimal::ZERO, |balance, movement| {
            balance + movement.debit - movement.credit
        })
        .max(Decimal::ZERO)
        .round_dp(2);
    let opening_balance = source_movements
        .iter()
        .filter(|movement| from.is_some_and(|from_date| movement.entry_date < from_date))
        .fold(Decimal::ZERO, |balance, movement| {
            balance + movement.debit - movement.credit
        })
        .round_dp(2);
    let mut running_balance = opening_balance;
    let mut debit_total = Decimal::ZERO;
    let mut credit_total = Decimal::ZERO;
    let mut movements = Vec::new();

    for movement in source_movements
        .into_iter()
        .filter(|movement| from.is_none_or(|from_date| movement.entry_date >= from_date))
    {
        debit_total = (debit_total + movement.debit).round_dp(2);
        credit_total = (credit_total + movement.credit).round_dp(2);
        running_balance = (running_balance + movement.debit - movement.credit).round_dp(2);
        movements.push(serde_json::json!({
            "id": movement.id,
            "kind": movement.kind,
            "direction": if movement.debit > Decimal::ZERO { "debit" } else { "credit" },
            "entry_date": movement.entry_date.to_string(),
            "occurred_at": movement.occurred_at.to_rfc3339(),
            "order_id": movement.order_id,
            "order_number": movement.order_number,
            "document_number": movement.document_number,
            "description": movement.description,
            "debit": decimal_to_string(movement.debit),
            "credit": decimal_to_string(movement.credit),
            "balance_after": decimal_to_string(running_balance),
            "currency": currency,
        }));
    }

    Ok(SettlementLedger {
        opening_balance,
        debit_total,
        credit_total,
        calculated_balance: running_balance,
        settlement_invoice_debit,
        external_balance,
        movements,
    })
}

async fn load_patient_account_statement(
    state: &AppState,
    patient_id: Uuid,
    query: &PatientFinancialQuery,
    portal_scope: bool,
) -> Result<Value, sqlx::Error> {
    let from = parse_query_date(query.from.as_deref(), "from").map_err(sqlx::Error::Protocol)?;
    let to = parse_query_date(query.to.as_deref(), "to").map_err(sqlx::Error::Protocol)?;
    let mut available_currencies = sqlx::query_scalar::<_, String>(
        r#"SELECT DISTINCT currency
           FROM (
               SELECT UPPER(TRIM(orders.currency)) AS currency
               FROM invoices invoice
               JOIN orders ON orders.id = invoice.order_id
               WHERE invoice.patient_id = $1
                 AND invoice.status <> 'cancelled'
                 AND TRIM(COALESCE(orders.currency, '')) <> ''
                 AND (
                        $2::boolean = false
                        OR (
                            invoice.portal_visible = true
                            AND invoice.status NOT IN ('draft', 'cancelled')
                        )
                 )
               UNION ALL
               SELECT UPPER(TRIM(external.currency)) AS currency
               FROM external_invoices external
               WHERE external.patient_id = $1
                 AND $2::boolean = false
                 AND external.status <> 'cancelled'
                 AND TRIM(COALESCE(external.currency, '')) <> ''
               UNION ALL
               SELECT adjustment.currency
               FROM patient_balance_adjustments adjustment
               WHERE adjustment.patient_id = $1
           ) currencies
           ORDER BY currency"#,
    )
    .bind(patient_id)
    .bind(portal_scope)
    .fetch_all(&state.db)
    .await?;
    let currency = parse_query_currency(query.currency.as_deref())
        .map_err(sqlx::Error::Protocol)?
        .unwrap_or_else(|| {
            if available_currencies.iter().any(|value| value == "EUR") {
                "EUR".to_string()
            } else {
                available_currencies
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "EUR".to_string())
            }
        });
    if !available_currencies.iter().any(|value| value == &currency) {
        available_currencies.push(currency.clone());
        available_currencies.sort();
    }

    let invoice_rows = sqlx::query(
        r#"SELECT invoice.id, invoice.order_id, invoice.invoice_number,
                  invoice.invoice_type, invoice.status, invoice.issued_at,
                  invoice.due_date, invoice.total_gross,
                  COALESCE((
                      SELECT SUM(CASE WHEN credit.transaction_type = 'credit_note' THEN credit.amount_gross ELSE -credit.amount_gross END)
                      FROM invoice_credit_note_transactions credit
                      WHERE credit.invoice_id = invoice.id
                        AND ($3::date IS NULL OR credit.issued_on <= $3)
                  ), 0) AS credited_amount,
                  CASE WHEN $3::date IS NULL THEN invoice.paid_amount ELSE
                      COALESCE((
                          SELECT SUM(CASE WHEN payment.transaction_type = 'payment' THEN payment.amount_gross ELSE -payment.amount_gross END)
                          FROM invoice_payment_transactions payment
                          WHERE payment.invoice_id = invoice.id
                            AND payment.received_on <= $3
                      ), 0)
                      - COALESCE((
                          SELECT SUM(CASE WHEN refund.transaction_type = 'refund' THEN refund.amount_gross ELSE -refund.amount_gross END)
                          FROM invoice_refund_transactions refund
                          WHERE refund.invoice_id = invoice.id
                            AND refund.refunded_on <= $3
                      ), 0)
                  END AS paid_amount,
                  CASE WHEN $3::date IS NULL THEN invoice.prepayment_applied_amount ELSE COALESCE((
                      SELECT SUM(allocation.amount_gross)
                      FROM invoice_prepayment_allocations allocation
                      WHERE allocation.target_invoice_id = invoice.id
                        AND allocation.created_at::date <= $3
                  ), 0) END AS prepayment_applied_amount,
                  invoice.portal_visible,
                  invoice.hide_amounts_from_patient, orders.order_number,
                  COALESCE((
                      SELECT SUM(allocation.amount_gross)
                      FROM invoice_prepayment_allocations allocation
                      WHERE allocation.advance_invoice_id = invoice.id
                        AND ($3::date IS NULL OR allocation.created_at::date <= $3)
                  ), 0) AS allocated_from_advance
           FROM invoices invoice
           JOIN orders ON orders.id = invoice.order_id
           WHERE invoice.patient_id = $1
             AND invoice.status <> 'cancelled'
             AND ($2::date IS NULL OR invoice.issued_at::date >= $2)
             AND ($3::date IS NULL OR invoice.issued_at::date <= $3)
             AND ($4::uuid IS NULL OR invoice.order_id = $4)
             AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM patient_service_packages package
                    WHERE package.patient_id = invoice.patient_id
                      AND package.package_id = $5
                      AND (
                            package.order_id = invoice.order_id
                            OR EXISTS (
                                SELECT 1
                                FROM service_package_consumptions consumption
                                WHERE consumption.patient_service_package_id = package.id
                                  AND (
                                        consumption.order_id = invoice.order_id
                                        OR consumption.invoice_id = invoice.id
                                  )
                            )
                      )
             ))
             AND (
                    $6::boolean = false
                    OR (
                        invoice.portal_visible = true
                        AND invoice.status NOT IN ('draft', 'cancelled')
                    )
             )
             AND orders.currency = $7
           ORDER BY invoice.issued_at DESC, invoice.created_at DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .bind(portal_scope)
    .bind(&currency)
    .fetch_all(&state.db)
    .await?;

    let mut items = Vec::new();
    let mut invoiced_gross = Decimal::ZERO;
    let mut cash_paid = Decimal::ZERO;
    let mut prepayment_applied = Decimal::ZERO;
    let mut available_prepayment = Decimal::ZERO;
    let mut invoice_due = Decimal::ZERO;
    let mut hidden_amount_count = 0_u64;

    for row in invoice_rows {
        let invoice_type = row.try_get::<String, _>("invoice_type").unwrap_or_default();
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let total_gross = row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO);
        let paid = row
            .try_get::<Decimal, _>("paid_amount")
            .unwrap_or(Decimal::ZERO);
        let credited = row
            .try_get::<Decimal, _>("credited_amount")
            .unwrap_or(Decimal::ZERO);
        let applied = row
            .try_get::<Decimal, _>("prepayment_applied_amount")
            .unwrap_or(Decimal::ZERO);
        let allocated = row
            .try_get::<Decimal, _>("allocated_from_advance")
            .unwrap_or(Decimal::ZERO);
        let due = if status == "draft" {
            Decimal::ZERO
        } else {
            (total_gross - credited - paid - applied).max(Decimal::ZERO)
        };
        let advance_available = if invoice_type == "advance" {
            (paid.min(total_gross - credited) - allocated).max(Decimal::ZERO)
        } else {
            Decimal::ZERO
        };
        let amounts_visible = !portal_scope
            || !row
                .try_get::<bool, _>("hide_amounts_from_patient")
                .unwrap_or(true);
        let payment_state = if !amounts_visible {
            "amount_hidden"
        } else if status == "draft" {
            "not_issued"
        } else if due <= Decimal::ZERO {
            "paid"
        } else if paid + applied > Decimal::ZERO {
            "partially_paid"
        } else {
            "unpaid"
        };

        if amounts_visible {
            invoiced_gross += (total_gross - credited).max(Decimal::ZERO);
            cash_paid += paid;
            prepayment_applied += applied;
            available_prepayment += advance_available;
            invoice_due += due;
        } else {
            hidden_amount_count += 1;
        }

        items.push(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "kind": if invoice_type == "advance" { "prepayment" } else { "invoice" },
            "entry_date": row.try_get::<chrono::DateTime<Utc>, _>("issued_at").map(|value| value.date_naive().to_string()).unwrap_or_default(),
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
            "document_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
            "description": if invoice_type == "advance" { "Advance payment" } else { "Patient invoice" },
            "status": status,
            "payment_state": payment_state,
            "paid_by": "patient",
            "amounts_visible": amounts_visible,
            "amount_gross": if amounts_visible { serde_json::json!(decimal_to_string(total_gross)) } else { Value::Null },
            "credited_amount": if amounts_visible { serde_json::json!(decimal_to_string(credited)) } else { Value::Null },
            "adjusted_amount_gross": if amounts_visible { serde_json::json!(decimal_to_string((total_gross - credited).max(Decimal::ZERO))) } else { Value::Null },
            "cash_paid": if amounts_visible { serde_json::json!(decimal_to_string(paid)) } else { Value::Null },
            "prepayment_applied": if amounts_visible { serde_json::json!(decimal_to_string(applied)) } else { Value::Null },
            "prepayment_allocated": if amounts_visible && invoice_type == "advance" { serde_json::json!(decimal_to_string(allocated)) } else { Value::Null },
            "prepayment_available": if amounts_visible && invoice_type == "advance" { serde_json::json!(decimal_to_string(advance_available)) } else { Value::Null },
            "amount_due": if amounts_visible { serde_json::json!(decimal_to_string(due)) } else { Value::Null },
            "due_date": row.try_get::<Option<NaiveDate>, _>("due_date").unwrap_or_default().map(|value| value.to_string()),
        }));
    }

    let credit_rows = sqlx::query(
        r#"SELECT credit.id, credit.transaction_type, credit.document_number,
                  credit.reason, credit.amount_gross, credit.issued_on,
                  credit.portal_visible, invoice.id AS invoice_id,
                  invoice.order_id, invoice.invoice_number,
                  invoice.hide_amounts_from_patient, orders.order_number
           FROM invoice_credit_note_transactions credit
           JOIN invoices invoice ON invoice.id = credit.invoice_id
           JOIN orders ON orders.id = invoice.order_id
           WHERE invoice.patient_id = $1
             AND invoice.status <> 'cancelled'
             AND ($2::date IS NULL OR credit.issued_on >= $2)
             AND ($3::date IS NULL OR credit.issued_on <= $3)
             AND ($4::uuid IS NULL OR invoice.order_id = $4)
             AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM patient_service_packages package
                    WHERE package.patient_id = invoice.patient_id
                      AND package.package_id = $5
                      AND package.order_id = invoice.order_id
             ))
             AND orders.currency = $6
             AND (
                    $7::boolean = false
                    OR (
                        invoice.portal_visible = true
                        AND credit.portal_visible = true
                    )
             )
           ORDER BY credit.issued_on DESC, credit.created_at DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .bind(&currency)
    .bind(portal_scope)
    .fetch_all(&state.db)
    .await?;

    for row in credit_rows {
        let transaction_type = row
            .try_get::<String, _>("transaction_type")
            .unwrap_or_default();
        let amount = row
            .try_get::<Decimal, _>("amount_gross")
            .unwrap_or(Decimal::ZERO);
        let effective_amount = if transaction_type == "credit_note" {
            -amount
        } else {
            amount
        };
        let amounts_visible = !portal_scope
            || !row
                .try_get::<bool, _>("hide_amounts_from_patient")
                .unwrap_or(true);
        items.push(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "kind": if transaction_type == "credit_note" { "credit_note" } else { "credit_note_reversal" },
            "entry_date": row.try_get::<NaiveDate, _>("issued_on").map(|value| value.to_string()).unwrap_or_default(),
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
            "invoice_id": row.try_get::<Uuid, _>("invoice_id").unwrap_or_default(),
            "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
            "document_number": row.try_get::<String, _>("document_number").unwrap_or_default(),
            "description": row.try_get::<String, _>("reason").unwrap_or_default(),
            "status": if transaction_type == "credit_note" { "credited" } else { "reversed" },
            "payment_state": "invoice_adjustment",
            "amounts_visible": amounts_visible,
            "amount_gross": if amounts_visible { serde_json::json!(decimal_to_string(effective_amount)) } else { Value::Null },
            "currency": currency,
        }));
    }

    let mut external_receivable = Decimal::ZERO;
    let external_item_count: u64;
    if portal_scope {
        external_item_count = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*)
               FROM external_invoices external
               JOIN external_invoice_receivable_balances balance
                 ON balance.external_invoice_id = external.id
               WHERE external.patient_id = $1
                 AND external.status <> 'cancelled'
                 AND balance.remaining_receivable_gross > 0
                 AND external.currency = $2"#,
        )
        .bind(patient_id)
        .bind(&currency)
        .fetch_one(&state.db)
        .await?
        .max(0) as u64;
    } else {
        let external_rows = sqlx::query(
            r#"SELECT external.id, external.order_id,
                      external.external_invoice_number, external.invoice_date,
                      external.created_at, external.status, external.paid_by,
                      external.service_delivered, external.amount_gross,
                      external.currency, external.patient_receivable_gross,
                      CASE WHEN $3::date IS NULL THEN balance.allocated_receivable_gross ELSE COALESCE((
                          SELECT SUM(allocation.amount_gross)
                          FROM external_invoice_patient_invoice_allocations allocation
                          JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
                          WHERE allocation.external_invoice_id = external.id
                            AND allocation.created_at::date <= $3
                            AND (allocation.reversed_at IS NULL OR allocation.reversed_at::date > $3)
                            AND patient_invoice.status NOT IN ('draft', 'cancelled')
                      ), 0) END AS allocated_receivable_gross,
                      CASE WHEN $3::date IS NULL THEN balance.remaining_receivable_gross ELSE GREATEST(
                          external.patient_receivable_gross - COALESCE((
                              SELECT SUM(allocation.amount_gross)
                              FROM external_invoice_patient_invoice_allocations allocation
                              JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
                              WHERE allocation.external_invoice_id = external.id
                                AND allocation.created_at::date <= $3
                                AND (allocation.reversed_at IS NULL OR allocation.reversed_at::date > $3)
                                AND patient_invoice.status NOT IN ('draft', 'cancelled')
                          ), 0),
                          0
                      ) END AS remaining_receivable_gross,
                      external.provider_liability_gross, orders.order_number,
                      provider.name AS provider_name
               FROM external_invoices external
               JOIN external_invoice_receivable_balances balance
                 ON balance.external_invoice_id = external.id
               JOIN orders ON orders.id = external.order_id
               LEFT JOIN providers provider ON provider.id = external.provider_id
               WHERE external.patient_id = $1
                 AND external.status <> 'cancelled'
                 AND ($2::date IS NULL OR COALESCE(external.invoice_date, external.created_at::date) >= $2)
                 AND ($3::date IS NULL OR COALESCE(external.invoice_date, external.created_at::date) <= $3)
                 AND ($4::uuid IS NULL OR external.order_id = $4)
                 AND ($5::uuid IS NULL OR EXISTS (
                        SELECT 1
                        FROM patient_service_packages package
                        WHERE package.patient_id = external.patient_id
                          AND package.package_id = $5
                          AND package.order_id = external.order_id
                 ))
                 AND external.currency = $6
               ORDER BY COALESCE(external.invoice_date, external.created_at::date) DESC,
                        external.created_at DESC"#,
        )
        .bind(patient_id)
        .bind(from)
        .bind(to)
        .bind(query.order_id)
        .bind(query.package_id)
        .bind(&currency)
        .fetch_all(&state.db)
        .await?;

        external_item_count = external_rows.len() as u64;
        for row in external_rows {
            let paid_by = row
                .try_get::<String, _>("paid_by")
                .unwrap_or_else(|_| "unpaid".to_string());
            let service_delivered = row.try_get::<bool, _>("service_delivered").unwrap_or(false);
            let receivable = row
                .try_get::<Decimal, _>("patient_receivable_gross")
                .unwrap_or(Decimal::ZERO);
            let allocated_receivable = row
                .try_get::<Decimal, _>("allocated_receivable_gross")
                .unwrap_or(Decimal::ZERO);
            let remaining_receivable = row
                .try_get::<Decimal, _>("remaining_receivable_gross")
                .unwrap_or(Decimal::ZERO);
            let liability = row
                .try_get::<Decimal, _>("provider_liability_gross")
                .unwrap_or(Decimal::ZERO);
            external_receivable += remaining_receivable;
            let payment_state =
                if receivable > Decimal::ZERO && remaining_receivable <= Decimal::ZERO {
                    "reconciled_to_patient_invoice"
                } else {
                    match paid_by.as_str() {
                        "patient" => "patient_paid",
                        "agency" => "gmed_paid_patient_due",
                        _ if service_delivered => "provider_unpaid_patient_due",
                        _ => "provider_unpaid",
                    }
                };
            let created_at = row
                .try_get::<chrono::DateTime<Utc>, _>("created_at")
                .map(|value| value.date_naive())
                .unwrap_or_else(|_| Utc::now().date_naive());
            let entry_date = row
                .try_get::<Option<NaiveDate>, _>("invoice_date")
                .unwrap_or_default()
                .unwrap_or(created_at);

            items.push(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "kind": "external_expense",
                "entry_date": entry_date.to_string(),
                "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                "document_number": row.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
                "description": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default().unwrap_or_else(|| "External provider".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "payment_state": payment_state,
                "paid_by": paid_by,
                "service_delivered": service_delivered,
                "amounts_visible": true,
                "amount_gross": decimal_to_string(row.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)),
                "patient_receivable": decimal_to_string(receivable),
                "allocated_receivable": decimal_to_string(allocated_receivable),
                "remaining_receivable": decimal_to_string(remaining_receivable),
                "provider_liability": decimal_to_string(liability),
                "amount_due": decimal_to_string(remaining_receivable),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            }));
        }

        let service_rows = sqlx::query(
            r#"SELECT service.id, service.order_id, service.created_at,
                      service.description,
                      COALESCE(service.agency_service_name_snapshot, service.description) AS service_name,
                      service.quantity,
                      COALESCE(service.unit_price_snapshot, service.unit_price) AS unit_price,
                      COALESCE(service.vat_rate_snapshot, service.vat_rate) AS vat_rate,
                      COALESCE(service.currency_snapshot, service.currency) AS currency,
                      service.status, orders.order_number,
                      COALESCE(SUM(allocation.quantity) FILTER (
                          WHERE invoice.status <> 'cancelled'
                      ), 0) AS invoiced_quantity
               FROM order_leistungen service
               JOIN orders ON orders.id = service.order_id
               LEFT JOIN invoice_order_line_allocations allocation
                      ON allocation.order_leistung_id = service.id
               LEFT JOIN invoices invoice ON invoice.id = allocation.invoice_id
               WHERE orders.patient_id = $1
                 AND ($2::date IS NULL OR service.created_at::date >= $2)
                 AND ($3::date IS NULL OR service.created_at::date <= $3)
                 AND ($4::uuid IS NULL OR service.order_id = $4)
                 AND ($5::uuid IS NULL OR EXISTS (
                        SELECT 1
                        FROM patient_service_packages package
                        WHERE package.patient_id = orders.patient_id
                          AND package.package_id = $5
                          AND (
                                package.order_id = service.order_id
                                OR EXISTS (
                                    SELECT 1
                                    FROM service_package_consumptions consumption
                                    WHERE consumption.patient_service_package_id = package.id
                                      AND consumption.order_leistung_id = service.id
                                )
                          )
                 ))
                 AND COALESCE(service.currency_snapshot, service.currency) = $6
               GROUP BY service.id, orders.order_number
               ORDER BY service.created_at DESC"#,
        )
        .bind(patient_id)
        .bind(from)
        .bind(to)
        .bind(query.order_id)
        .bind(query.package_id)
        .bind(&currency)
        .fetch_all(&state.db)
        .await?;

        for row in service_rows {
            let quantity = row
                .try_get::<Decimal, _>("quantity")
                .unwrap_or(Decimal::ZERO);
            let invoiced_quantity = row
                .try_get::<Decimal, _>("invoiced_quantity")
                .unwrap_or(Decimal::ZERO);
            let unit_price = row
                .try_get::<Decimal, _>("unit_price")
                .unwrap_or(Decimal::ZERO);
            let vat_rate = row
                .try_get::<Decimal, _>("vat_rate")
                .unwrap_or(Decimal::ZERO);
            let gross = (quantity * unit_price * (Decimal::new(100, 0) + vat_rate)
                / Decimal::new(100, 0))
            .round_dp(2);
            let financial_state = if invoiced_quantity <= Decimal::ZERO {
                "not_invoiced"
            } else if invoiced_quantity < quantity {
                "partially_invoiced"
            } else {
                "invoiced"
            };
            items.push(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "kind": "service",
                "entry_date": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map(|value| value.date_naive().to_string()).unwrap_or_default(),
                "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                "description": row.try_get::<String, _>("service_name").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "payment_state": financial_state,
                "amounts_visible": true,
                "quantity": decimal_to_string(quantity),
                "invoiced_quantity": decimal_to_string(invoiced_quantity),
                "amount_gross": decimal_to_string(gross),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            }));
        }
    }

    items.sort_by(|left, right| {
        right
            .get("entry_date")
            .and_then(Value::as_str)
            .cmp(&left.get("entry_date").and_then(Value::as_str))
    });
    let total_due = invoice_due + external_receivable;
    let settlement =
        load_patient_settlement_ledger(state, patient_id, query, portal_scope, &currency, from, to)
            .await?;
    let reconciliation_required = settlement.settlement_invoice_debit > Decimal::ZERO
        && settlement.external_balance > Decimal::ZERO;
    let settlement_complete = !reconciliation_required
        && (!portal_scope || (hidden_amount_count == 0 && external_item_count == 0));
    let balance_side = if !settlement_complete {
        "reconciliation_required"
    } else if settlement.calculated_balance > Decimal::ZERO {
        "debit"
    } else if settlement.calculated_balance < Decimal::ZERO {
        "credit"
    } else {
        "settled"
    };

    Ok(serde_json::json!({
        "patient_id": patient_id,
        "currency": currency,
        "available_currencies": available_currencies,
        "scope": if portal_scope { "patient_portal" } else { "staff" },
        "amounts_complete": !portal_scope || (hidden_amount_count == 0 && external_item_count == 0),
        "summary": {
            "invoiced_gross": decimal_to_string(invoiced_gross),
            "cash_paid": decimal_to_string(cash_paid),
            "prepayment_applied": decimal_to_string(prepayment_applied),
            "available_prepayment": decimal_to_string(available_prepayment),
            "invoice_due": decimal_to_string(invoice_due),
            "external_receivable": if portal_scope { Value::Null } else { serde_json::json!(decimal_to_string(external_receivable)) },
            "total_due": if reconciliation_required || (portal_scope && (hidden_amount_count > 0 || external_item_count > 0)) { Value::Null } else { serde_json::json!(decimal_to_string(total_due)) },
            "reconciliation_required": reconciliation_required,
            "opening_balance": decimal_to_string(settlement.opening_balance),
            "debit_total": decimal_to_string(settlement.debit_total),
            "credit_total": decimal_to_string(settlement.credit_total),
            "calculated_balance": decimal_to_string(settlement.calculated_balance),
            "closing_balance": if settlement_complete { serde_json::json!(decimal_to_string(settlement.calculated_balance)) } else { Value::Null },
            "balance_side": balance_side,
            "unreconciled_external_debit": if reconciliation_required { serde_json::json!(decimal_to_string(settlement.external_balance)) } else { serde_json::json!("0") },
        },
        "redaction": {
            "hidden_invoice_amount_count": hidden_amount_count,
            "external_expense_count": if portal_scope { external_item_count } else { 0 },
            "services_hidden": portal_scope,
        },
        "movements": settlement.movements,
        "items": items,
    }))
}

async fn get_patient_account_statement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if !can_read_patient_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    if let Err(message) = parse_query_date(query.from.as_deref(), "from") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    if let Err(message) = parse_query_date(query.to.as_deref(), "to") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    if let Err(message) = parse_query_currency(query.currency.as_deref()) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }

    match load_patient_account_statement(&state, patient_id, &query, false).await {
        Ok(statement) => Json(statement).into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient account statement");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient account statement",
            )
        }
    }
}

async fn get_my_account_statement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if auth.role != Role::Patient {
        return err(StatusCode::FORBIDDEN, "Patient access required");
    }
    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(patient_id) => patient_id,
        Err(resp) => return resp,
    };
    if let Err(message) = parse_query_currency(query.currency.as_deref()) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    let portal_query = PatientFinancialQuery {
        from: None,
        to: None,
        order_id: None,
        package_id: None,
        include_pass_through: None,
        currency: query.currency,
    };
    match load_patient_account_statement(&state, patient_id, &portal_query, true).await {
        Ok(statement) => Json(statement).into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load portal account statement");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load account statement",
            )
        }
    }
}

async fn get_patient_financial_summary(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if !can_read_patient_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let from = match parse_query_date(query.from.as_deref(), "from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let to = match parse_query_date(query.to.as_deref(), "to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let currency = match parse_query_currency(query.currency.as_deref()) {
        Ok(Some(value)) => value,
        Ok(None) => "EUR".to_string(),
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let include_pass_through = query.include_pass_through.unwrap_or(true);
    if !include_pass_through {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Pass-through positions cannot yet be excluded symmetrically from revenue and cost",
        );
    }

    let invoice_rows = match sqlx::query(
        r#"SELECT id, order_id, invoice_number, status, issued_at, due_date,
                  total_net, total_vat, total_gross,
                  COALESCE((
                      SELECT SUM(CASE WHEN credit.transaction_type = 'credit_note' THEN credit.amount_gross ELSE -credit.amount_gross END)
                      FROM invoice_credit_note_transactions credit
                      WHERE credit.invoice_id = invoices.id
                        AND ($3::date IS NULL OR credit.issued_on <= $3)
                  ), 0) AS credited_amount,
                  CASE WHEN $3::date IS NULL THEN paid_amount ELSE
                      COALESCE((
                          SELECT SUM(CASE WHEN payment.transaction_type = 'payment' THEN payment.amount_gross ELSE -payment.amount_gross END)
                          FROM invoice_payment_transactions payment
                          WHERE payment.invoice_id = invoices.id
                            AND payment.received_on <= $3
                      ), 0)
                      - COALESCE((
                          SELECT SUM(CASE WHEN refund.transaction_type = 'refund' THEN refund.amount_gross ELSE -refund.amount_gross END)
                          FROM invoice_refund_transactions refund
                          WHERE refund.invoice_id = invoices.id
                            AND refund.refunded_on <= $3
                      ), 0)
                  END AS paid_amount,
                  COALESCE((
                      SELECT SUM(CASE WHEN credit.transaction_type = 'credit_note' THEN credit.amount_net ELSE -credit.amount_net END)
                      FROM invoice_credit_note_transactions credit
                      WHERE credit.invoice_id = invoices.id
                        AND ($3::date IS NULL OR credit.issued_on <= $3)
                  ), 0) AS credited_net,
                  COALESCE((
                      SELECT SUM(CASE WHEN credit.transaction_type = 'credit_note' THEN credit.amount_vat ELSE -credit.amount_vat END)
                      FROM invoice_credit_note_transactions credit
                      WHERE credit.invoice_id = invoices.id
                        AND ($3::date IS NULL OR credit.issued_on <= $3)
                  ), 0) AS credited_vat,
                  CASE WHEN $3::date IS NULL THEN prepayment_applied_amount ELSE COALESCE((
                      SELECT SUM(allocation.amount_gross)
                      FROM invoice_prepayment_allocations allocation
                      WHERE allocation.target_invoice_id = invoices.id
                        AND allocation.created_at::date <= $3
                  ), 0) END AS prepayment_applied_amount,
                  line_items
           FROM invoices
           WHERE patient_id = $1
             AND invoice_type <> 'advance'
             AND status IN ('sent', 'partially_paid', 'paid', 'overdue')
             AND ($2::date IS NULL OR issued_at::date >= $2)
             AND ($3::date IS NULL OR issued_at::date <= $3)
             AND ($4::uuid IS NULL OR order_id = $4)
             AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM patient_service_packages psp
                    WHERE psp.patient_id = invoices.patient_id
                      AND psp.package_id = $5
                      AND (
                            psp.order_id = invoices.order_id
                            OR EXISTS (
                                SELECT 1
                                FROM service_package_consumptions spc
                                WHERE spc.patient_service_package_id = psp.id
                                  AND (
                                        spc.order_id = invoices.order_id
                                        OR spc.invoice_id = invoices.id
                                  )
                            )
                      )
             ))
             AND EXISTS (
                    SELECT 1
                    FROM orders currency_order
                    WHERE currency_order.id = invoices.order_id
                      AND currency_order.currency = $6
             )
           ORDER BY issued_at DESC, created_at DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .bind(&currency)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient invoice financials");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient financial summary",
            );
        }
    };

    let external_receivable_row = match sqlx::query(
        r#"SELECT COALESCE(SUM(
                  CASE WHEN UPPER(external.currency) = $6
                             AND UPPER(receivable_order.currency) = $6
                       THEN CASE WHEN $3::date IS NULL THEN balance.remaining_receivable_gross ELSE GREATEST(
                       external.patient_receivable_gross - COALESCE((
                          SELECT SUM(allocation.amount_gross)
                          FROM external_invoice_patient_invoice_allocations allocation
                          JOIN invoices patient_invoice ON patient_invoice.id = allocation.patient_invoice_id
                          WHERE allocation.external_invoice_id = external.id
                            AND allocation.created_at::date <= $3
                            AND (allocation.reversed_at IS NULL OR allocation.reversed_at::date > $3)
                            AND patient_invoice.status NOT IN ('draft', 'cancelled')
                      ), 0),
                       0
                   ) END ELSE 0 END
               ), 0) AS patient_receivable_gross,
               COUNT(*) FILTER (
                   WHERE UPPER(external.currency) <> UPPER(receivable_order.currency)
               ) AS currency_mismatch_count
           FROM external_invoices external
           JOIN orders receivable_order ON receivable_order.id = external.order_id
           JOIN external_invoice_receivable_balances balance
             ON balance.external_invoice_id = external.id
           WHERE external.patient_id = $1
             AND external.status <> 'cancelled'
             AND ($2::date IS NULL OR COALESCE(external.invoice_date, external.created_at::date) >= $2)
             AND ($3::date IS NULL OR COALESCE(external.invoice_date, external.created_at::date) <= $3)
             AND ($4::uuid IS NULL OR external.order_id = $4)
             AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM patient_service_packages package
                    WHERE package.patient_id = external.patient_id
                      AND package.package_id = $5
                      AND package.order_id = external.order_id
             ))
             AND (
                 UPPER(external.currency) = $6
                 OR UPPER(receivable_order.currency) = $6
             )"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .bind(&currency)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient external receivables");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient financial summary",
            );
        }
    };

    let expense_row = match sqlx::query(
        r#"SELECT COALESCE(SUM(external.amount_net) FILTER (
                      WHERE UPPER(external.currency) = $6
                        AND UPPER(patient_order.currency) = $6
                        AND external.amount_net >= 0
                        AND external.amount_vat >= 0
                        AND external.amount_gross >= 0
                        AND external.amount_net + external.amount_vat = external.amount_gross
                  ), 0) AS expenses_net,
                  COALESCE(SUM(external.amount_vat) FILTER (
                      WHERE UPPER(external.currency) = $6
                        AND UPPER(patient_order.currency) = $6
                        AND external.amount_net >= 0
                        AND external.amount_vat >= 0
                        AND external.amount_gross >= 0
                        AND external.amount_net + external.amount_vat = external.amount_gross
                  ), 0) AS expenses_vat,
                  COALESCE(SUM(external.amount_gross) FILTER (
                      WHERE UPPER(external.currency) = $6
                        AND UPPER(patient_order.currency) = $6
                        AND external.amount_net >= 0
                        AND external.amount_vat >= 0
                        AND external.amount_gross >= 0
                        AND external.amount_net + external.amount_vat = external.amount_gross
                  ), 0) AS expenses_gross,
                  COUNT(*) FILTER (
                      WHERE external.amount_net < 0
                         OR external.amount_vat < 0
                         OR external.amount_gross < 0
                         OR external.amount_net + external.amount_vat <> external.amount_gross
                   ) AS invalid_expense_count,
                   COUNT(*) FILTER (
                       WHERE UPPER(external.currency) <> UPPER(patient_order.currency)
                   ) AS currency_mismatch_count
           FROM external_invoices external
           JOIN orders patient_order ON patient_order.id = external.order_id
           WHERE external.patient_id = $1
             AND external.status <> 'cancelled'
             AND external.paid_by <> 'patient'
             AND (external.service_delivered OR external.status IN ('approved', 'paid'))
             AND ($2::date IS NULL OR COALESCE(external.invoice_date, external.received_at::date, external.created_at::date) >= $2)
             AND ($3::date IS NULL OR COALESCE(external.invoice_date, external.received_at::date, external.created_at::date) <= $3)
             AND ($4::uuid IS NULL OR external.order_id = $4)
             AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM patient_service_packages psp
                    WHERE psp.patient_id = external.patient_id
                      AND psp.package_id = $5
                      AND (
                            psp.order_id = external.order_id
                            OR EXISTS (
                                SELECT 1
                                FROM service_package_consumptions spc
                                WHERE spc.patient_service_package_id = psp.id
                                  AND (
                                        spc.order_id = external.order_id
                                  )
                            )
                      )
             ))
             AND (
                 UPPER(external.currency) = $6
                 OR UPPER(patient_order.currency) = $6
             )"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .bind(&currency)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient expense financials");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient financial summary",
            );
        }
    };

    let mut revenue_net = Decimal::ZERO;
    let mut revenue_vat = Decimal::ZERO;
    let mut revenue_gross = Decimal::ZERO;
    let mut paid_amount = Decimal::ZERO;
    let mut prepayment_applied_amount = Decimal::ZERO;
    let mut open_balance = Decimal::ZERO;
    let mut overdue_amount = Decimal::ZERO;
    let mut order_breakdown = Vec::new();
    let mut service_breakdown = std::collections::BTreeMap::<String, (Decimal, Decimal)>::new();
    let as_of_date = to.unwrap_or_else(|| Utc::now().date_naive());

    for row in invoice_rows {
        let total_net = row
            .try_get::<Decimal, _>("total_net")
            .unwrap_or(Decimal::ZERO);
        let total_vat = row
            .try_get::<Decimal, _>("total_vat")
            .unwrap_or(Decimal::ZERO);
        let total_gross = row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO);
        let credited = row
            .try_get::<Decimal, _>("credited_amount")
            .unwrap_or(Decimal::ZERO);
        let credited_net = row
            .try_get::<Decimal, _>("credited_net")
            .unwrap_or(Decimal::ZERO);
        let credited_vat = row
            .try_get::<Decimal, _>("credited_vat")
            .unwrap_or(Decimal::ZERO);
        let paid = row
            .try_get::<Decimal, _>("paid_amount")
            .unwrap_or(Decimal::ZERO);
        let prepayment_applied = row
            .try_get::<Decimal, _>("prepayment_applied_amount")
            .unwrap_or(Decimal::ZERO);
        let balance =
            (total_gross - credited - paid - prepayment_applied).max(Decimal::ZERO);
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let due_date = row
            .try_get::<Option<NaiveDate>, _>("due_date")
            .unwrap_or_default();
        let line_items = row
            .try_get::<Value, _>("line_items")
            .unwrap_or_else(|_| serde_json::json!([]));

        revenue_net += (total_net - credited_net).max(Decimal::ZERO);
        revenue_vat += (total_vat - credited_vat).max(Decimal::ZERO);
        revenue_gross += (total_gross - credited).max(Decimal::ZERO);
        paid_amount += paid;
        prepayment_applied_amount += prepayment_applied;
        open_balance += balance;
        if (to.is_none() && status == "overdue")
            || due_date.is_some_and(|value| value < as_of_date && balance > Decimal::ZERO)
        {
            overdue_amount += balance;
        }

        if let Some(items) = line_items.as_array() {
            for item in items {
                let original_gross =
                    value_to_decimal(item.get("line_gross").unwrap_or(&Value::Null));
                let original_net =
                    value_to_decimal(item.get("line_net").unwrap_or(&Value::Null));
                let gross = if total_gross > Decimal::ZERO {
                    (original_gross * (total_gross - credited).max(Decimal::ZERO)
                        / total_gross)
                        .round_dp(2)
                } else {
                    Decimal::ZERO
                };
                let net = if total_net > Decimal::ZERO {
                    (original_net * (total_net - credited_net).max(Decimal::ZERO)
                        / total_net)
                        .round_dp(2)
                } else {
                    Decimal::ZERO
                };
                let entry = service_breakdown
                    .entry(line_service_type(item))
                    .or_insert((Decimal::ZERO, Decimal::ZERO));
                entry.0 += net;
                entry.1 += gross;
            }
        }

        order_breakdown.push(serde_json::json!({
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "invoice_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
            "status": status,
            "revenue_net": decimal_to_string(total_net),
            "revenue_vat": decimal_to_string(total_vat),
            "revenue_gross": decimal_to_string(total_gross),
            "credited_amount": decimal_to_string(credited),
            "adjusted_revenue_net": decimal_to_string((total_net - credited_net).max(Decimal::ZERO)),
            "adjusted_revenue_vat": decimal_to_string((total_vat - credited_vat).max(Decimal::ZERO)),
            "adjusted_revenue_gross": decimal_to_string((total_gross - credited).max(Decimal::ZERO)),
            "paid_amount": decimal_to_string(paid),
            "prepayment_applied_amount": decimal_to_string(prepayment_applied),
            "settled_amount": decimal_to_string(paid + prepayment_applied),
            "open_balance": decimal_to_string(balance),
        }));
    }

    let external_receivable_gross = external_receivable_row
        .try_get::<Decimal, _>("patient_receivable_gross")
        .unwrap_or(Decimal::ZERO);
    let receivable_currency_mismatch_count = external_receivable_row
        .try_get::<i64, _>("currency_mismatch_count")
        .unwrap_or_default();
    let reconciliation_required =
        revenue_gross > Decimal::ZERO && external_receivable_gross > Decimal::ZERO;

    let expenses_net = expense_row
        .try_get::<Decimal, _>("expenses_net")
        .unwrap_or(Decimal::ZERO);
    let expenses_vat = expense_row
        .try_get::<Decimal, _>("expenses_vat")
        .unwrap_or(Decimal::ZERO);
    let expenses_gross = expense_row
        .try_get::<Decimal, _>("expenses_gross")
        .unwrap_or(Decimal::ZERO);
    let invalid_expense_count = expense_row
        .try_get::<i64, _>("invalid_expense_count")
        .unwrap_or_default();
    let expense_currency_mismatch_count = expense_row
        .try_get::<i64, _>("currency_mismatch_count")
        .unwrap_or_default();
    let expense_economics_valid = invalid_expense_count == 0
        && expense_currency_mismatch_count == 0
        && receivable_currency_mismatch_count == 0;
    let margin_net = revenue_net - expenses_net;
    let margin_percent = if revenue_net > Decimal::ZERO {
        (margin_net / revenue_net * Decimal::new(100, 0)).round_dp(2)
    } else {
        Decimal::ZERO
    };
    let margin_allowed = can_read_profit_margin(auth.role);
    let mut issues = Vec::new();
    if reconciliation_required {
        issues.push("invoice_and_external_receivable_reconciliation_required");
    }
    if !expense_economics_valid {
        if invalid_expense_count > 0 {
            issues.push("external_invoice_amount_mismatch");
        }
        if expense_currency_mismatch_count > 0 || receivable_currency_mismatch_count > 0 {
            issues.push("external_invoice_currency_mismatch");
        }
    }

    let service_breakdown = service_breakdown
        .into_iter()
        .map(|(service_type, (net, gross))| {
            serde_json::json!({
                "service_type": service_type,
                "revenue_net": decimal_to_string(net),
                "revenue_gross": decimal_to_string(gross),
            })
        })
        .collect::<Vec<_>>();

    Json(serde_json::json!({
        "patient_id": patient_id,
        "currency": currency,
        "filters": {
            "from": from.map(|value| value.to_string()),
            "to": to.map(|value| value.to_string()),
            "order_id": query.order_id,
            "package_id": query.package_id,
            "include_pass_through": include_pass_through,
        },
        "revenue_net": decimal_to_string(revenue_net),
        "revenue_vat": decimal_to_string(revenue_vat),
        "revenue_gross": decimal_to_string(revenue_gross),
        "paid_amount": decimal_to_string(paid_amount),
        "prepayment_applied_amount": decimal_to_string(prepayment_applied_amount),
        "settled_amount": decimal_to_string(paid_amount + prepayment_applied_amount),
        "external_receivable_gross": decimal_to_string(external_receivable_gross),
        "open_balance": decimal_to_string(open_balance),
        "overdue_amount": decimal_to_string(overdue_amount),
        "expenses_net": if margin_allowed && expense_economics_valid { serde_json::json!(decimal_to_string(expenses_net)) } else { Value::Null },
        "expenses_vat": if margin_allowed && expense_economics_valid { serde_json::json!(decimal_to_string(expenses_vat)) } else { Value::Null },
        "expenses_gross": if margin_allowed && expense_economics_valid { serde_json::json!(decimal_to_string(expenses_gross)) } else { Value::Null },
        "margin_net": if margin_allowed && expense_economics_valid { serde_json::json!(decimal_to_string(margin_net)) } else { Value::Null },
        "margin_percent": if margin_allowed && expense_economics_valid { serde_json::json!(decimal_to_string(margin_percent)) } else { Value::Null },
        "margin_visible": margin_allowed,
        "economics_valid": expense_economics_valid,
        "reconciliation_required": reconciliation_required,
        "breakdown_by_order": order_breakdown,
        "breakdown_by_service_type": service_breakdown,
        "issues": issues,
    }))
    .into_response()
}

async fn get_patient_financial_ledger(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if !can_read_patient_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let from = match parse_query_date(query.from.as_deref(), "from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let to = match parse_query_date(query.to.as_deref(), "to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let margin_allowed = can_read_profit_margin(auth.role);

    match sqlx::query(
        r#"SELECT ae.id, ae.entry_date, ae.direction, ae.category, ae.description,
                  ae.amount_net, ae.amount_vat, ae.amount_gross, ae.currency,
                  i.invoice_number, ei.external_invoice_number, o.order_number
           FROM accounting_entries ae
           LEFT JOIN invoices i ON i.id = ae.source_invoice_id
           LEFT JOIN external_invoices ei ON ei.id = ae.source_external_invoice_id
           LEFT JOIN orders o ON o.id = ae.order_id
           WHERE ae.patient_id = $1
             AND ($2::date IS NULL OR ae.entry_date >= $2)
             AND ($3::date IS NULL OR ae.entry_date <= $3)
             AND ($4::uuid IS NULL OR ae.order_id = $4)
             AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM patient_service_packages psp
                    WHERE psp.patient_id = ae.patient_id
                      AND psp.package_id = $5
                      AND (
                            psp.order_id = ae.order_id
                            OR EXISTS (
                                SELECT 1
                                FROM service_package_consumptions spc
                                WHERE spc.patient_service_package_id = psp.id
                                  AND (
                                        spc.order_id = ae.order_id
                                        OR spc.invoice_id = ae.source_invoice_id
                                  )
                            )
                      )
             ))
           ORDER BY ae.entry_date DESC, ae.created_at DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let entries = rows
                .into_iter()
                .filter_map(|row| {
                    let direction = row.try_get::<String, _>("direction").unwrap_or_default();
                    if direction == "expense" && !margin_allowed {
                        return None;
                    }
                    Some(serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "entry_date": row.try_get::<NaiveDate, _>("entry_date").map(|value| value.to_string()).unwrap_or_default(),
                        "direction": direction,
                        "category": row.try_get::<String, _>("category").unwrap_or_default(),
                        "description": row.try_get::<String, _>("description").unwrap_or_default(),
                        "amount_net": decimal_to_string(row.try_get::<Decimal, _>("amount_net").unwrap_or(Decimal::ZERO)),
                        "amount_vat": decimal_to_string(row.try_get::<Decimal, _>("amount_vat").unwrap_or(Decimal::ZERO)),
                        "amount_gross": decimal_to_string(row.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)),
                        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                        "invoice_number": row.try_get::<Option<String>, _>("invoice_number").unwrap_or_default(),
                        "external_invoice_number": row.try_get::<Option<String>, _>("external_invoice_number").unwrap_or_default(),
                        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                    }))
                })
                .collect::<Vec<_>>();
            Json(serde_json::json!({
                "patient_id": patient_id,
                "margin_visible": margin_allowed,
                "entries": entries,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient financial ledger");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient financial ledger",
            )
        }
    }
}

fn patient_balance_adjustment_payload(row: &sqlx::postgres::PgRow) -> Value {
    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
        "transaction_type": row.try_get::<String, _>("transaction_type").unwrap_or_default(),
        "reverses_adjustment_id": row.try_get::<Option<Uuid>, _>("reverses_adjustment_id").unwrap_or_default(),
        "reversed_by_adjustment_id": row.try_get::<Option<Uuid>, _>("reversed_by_adjustment_id").unwrap_or_default(),
        "is_reversed": row.try_get::<bool, _>("is_reversed").unwrap_or(false),
        "direction": row.try_get::<String, _>("direction").unwrap_or_default(),
        "category": row.try_get::<String, _>("category").unwrap_or_default(),
        "amount": decimal_to_string(row.try_get::<Decimal, _>("amount").unwrap_or(Decimal::ZERO)),
        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
        "effective_on": row.try_get::<NaiveDate, _>("effective_on").map(|value| value.to_string()).unwrap_or_default(),
        "reason": row.try_get::<String, _>("reason").unwrap_or_default(),
        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
        "portal_visible": row.try_get::<bool, _>("portal_visible").unwrap_or(false),
        "created_by": row.try_get::<Uuid, _>("created_by").unwrap_or_default(),
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "created_by_role": row.try_get::<String, _>("created_by_role").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

async fn load_patient_balance_adjustments(
    state: &AppState,
    patient_id: Uuid,
    query: &PatientFinancialQuery,
) -> Result<Vec<Value>, sqlx::Error> {
    let from = parse_query_date(query.from.as_deref(), "from")
        .map_err(sqlx::Error::Protocol)?;
    let to = parse_query_date(query.to.as_deref(), "to")
        .map_err(sqlx::Error::Protocol)?;
    let currency = parse_query_currency(query.currency.as_deref())
        .map_err(sqlx::Error::Protocol)?;
    let rows = sqlx::query(
        r#"SELECT adjustment.id, adjustment.patient_id, adjustment.order_id,
                  adjustment.transaction_type, adjustment.reverses_adjustment_id,
                  adjustment.direction, adjustment.category, adjustment.amount,
                  adjustment.currency, adjustment.effective_on, adjustment.reason,
                  adjustment.note, adjustment.portal_visible, adjustment.created_by,
                  adjustment.created_at, orders.order_number,
                  creator.name AS created_by_name, creator.role AS created_by_role,
                  reversal.id AS reversed_by_adjustment_id,
                  (reversal.id IS NOT NULL) AS is_reversed
           FROM patient_balance_adjustments adjustment
           JOIN users creator ON creator.id = adjustment.created_by
           LEFT JOIN orders ON orders.id = adjustment.order_id
           LEFT JOIN patient_balance_adjustments reversal
             ON reversal.reverses_adjustment_id = adjustment.id
            AND reversal.transaction_type = 'reversal'
           WHERE adjustment.patient_id = $1
             AND ($2::date IS NULL OR adjustment.effective_on >= $2)
             AND ($3::date IS NULL OR adjustment.effective_on <= $3)
             AND ($4::uuid IS NULL OR adjustment.order_id = $4)
             AND ($5::text IS NULL OR adjustment.currency = $5)
           ORDER BY adjustment.effective_on DESC, adjustment.created_at DESC, adjustment.id DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(currency)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .map(patient_balance_adjustment_payload)
        .collect())
}

async fn list_patient_balance_adjustments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if !can_read_patient_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    if let Err(message) = parse_query_date(query.from.as_deref(), "from") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    if let Err(message) = parse_query_date(query.to.as_deref(), "to") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    if let Err(message) = parse_query_currency(query.currency.as_deref()) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    match load_patient_balance_adjustments(&state, patient_id, &query).await {
        Ok(items) => Json(serde_json::json!({ "items": items })).into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient balance adjustments");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load balance adjustments",
            )
        }
    }
}

async fn create_patient_balance_adjustment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<CreatePatientBalanceAdjustmentRequest>,
) -> axum::response::Response {
    if !can_manage_patient_balance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    let direction = body.direction.trim().to_lowercase();
    if !matches!(direction.as_str(), "debit" | "credit") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid adjustment direction");
    }
    let category = body.category.trim().to_lowercase();
    if !matches!(
        category.as_str(),
        "opening_balance" | "fee" | "goodwill" | "correction" | "other"
    ) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid adjustment category");
    }
    let amount = value_to_decimal(&body.amount).round_dp(2);
    if amount <= Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Adjustment amount must be greater than zero",
        );
    }
    let currency = match parse_query_currency(Some(body.currency.as_str())) {
        Ok(Some(currency)) => currency,
        Ok(None) | Err(_) => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid adjustment currency");
        }
    };
    let effective_on = match parse_query_date(Some(body.effective_on.as_str()), "effective_on") {
        Ok(Some(value)) if value <= Utc::now().date_naive() => value,
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid adjustment date"),
    };
    let reason = match normalize_optional(Some(body.reason.as_str())) {
        Some(reason) => reason,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Adjustment reason is required"),
    };
    let note = normalize_optional(body.note.as_deref());
    let portal_visible = body.portal_visible.unwrap_or(true);

    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "begin patient balance adjustment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record balance adjustment");
        }
    };
    match sqlx::query("SELECT id FROM patients WHERE id = $1 FOR UPDATE")
        .bind(patient_id)
        .fetch_optional(&mut *transaction)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "lock patient for balance adjustment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record balance adjustment");
        }
    }
    let existing = match sqlx::query(
        r#"SELECT id, direction, category, amount, currency, effective_on,
                  order_id, reason, note, portal_visible
           FROM patient_balance_adjustments
           WHERE patient_id = $1
             AND request_id = $2
             AND transaction_type = 'adjustment'"#,
    )
    .bind(patient_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, request_id = %body.request_id, "load balance adjustment idempotency key");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record balance adjustment");
        }
    };
    if let Some(existing) = existing {
        let same_request = existing
            .try_get::<String, _>("direction")
            .map(|value| value == direction)
            .unwrap_or(false)
            && existing
                .try_get::<String, _>("category")
                .map(|value| value == category)
                .unwrap_or(false)
            && existing
                .try_get::<Decimal, _>("amount")
                .map(|value| value == amount)
                .unwrap_or(false)
            && existing
                .try_get::<String, _>("currency")
                .map(|value| value == currency)
                .unwrap_or(false)
            && existing
                .try_get::<NaiveDate, _>("effective_on")
                .map(|value| value == effective_on)
                .unwrap_or(false)
            && existing
                .try_get::<Option<Uuid>, _>("order_id")
                .map(|value| value == body.order_id)
                .unwrap_or(false)
            && existing
                .try_get::<String, _>("reason")
                .map(|value| value == reason)
                .unwrap_or(false)
            && existing
                .try_get::<Option<String>, _>("note")
                .map(|value| value == note)
                .unwrap_or(false)
            && existing
                .try_get::<bool, _>("portal_visible")
                .map(|value| value == portal_visible)
                .unwrap_or(false);
        if !same_request {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used for another balance adjustment",
            );
        }
        let adjustment_id = existing.try_get::<Uuid, _>("id").unwrap_or_default();
        if let Err(e) = transaction.commit().await {
            tracing::error!(error = %e, patient_id = %patient_id, "commit balance adjustment replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record balance adjustment");
        }
        return Json(serde_json::json!({
            "adjustment_id": adjustment_id,
            "idempotent_replay": true,
        }))
        .into_response();
    }

    let adjustment_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_balance_adjustments (
                patient_id, order_id, transaction_type, request_id,
                direction, category, amount, currency, effective_on,
                reason, note, portal_visible, created_by
           ) VALUES ($1, $2, 'adjustment', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(body.order_id)
    .bind(body.request_id)
    .bind(&direction)
    .bind(&category)
    .bind(amount)
    .bind(&currency)
    .bind(effective_on)
    .bind(&reason)
    .bind(note.clone())
    .bind(portal_visible)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(id) => id,
        Err(sqlx::Error::Database(db_error))
            if matches!(db_error.code().as_deref(), Some("23505" | "23514" | "P0001")) =>
        {
            return err(StatusCode::CONFLICT, "Balance adjustment is no longer valid; reload and try again");
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "insert patient balance adjustment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record balance adjustment");
        }
    };
    if let Err(e) = transaction.commit().await {
        tracing::error!(error = %e, patient_id = %patient_id, "commit patient balance adjustment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record balance adjustment");
    }

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_balance_adjustment",
        Some(auth.user_id),
        "patient_balance_adjustment",
        Some(adjustment_id),
        serde_json::json!({
            "patient_id": patient_id,
            "order_id": body.order_id,
            "direction": direction,
            "category": category,
            "amount": decimal_to_string(amount),
            "currency": currency,
            "effective_on": effective_on.to_string(),
            "portal_visible": portal_visible,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.balance_adjustment_created",
        patient_id,
        serde_json::json!({ "adjustment_id": adjustment_id }),
    )
    .await;
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "adjustment_id": adjustment_id })),
    )
        .into_response()
}

async fn reverse_patient_balance_adjustment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, adjustment_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ReversePatientBalanceAdjustmentRequest>,
) -> axum::response::Response {
    if !can_manage_patient_balance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    let reason = match normalize_optional(Some(body.reason.as_str())) {
        Some(reason) => reason,
        None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Reversal reason is required"),
    };
    let effective_on = match parse_query_date(body.effective_on.as_deref(), "effective_on") {
        Ok(Some(value)) if value <= Utc::now().date_naive() => value,
        Ok(None) => Utc::now().date_naive(),
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid reversal date"),
    };

    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, adjustment_id = %adjustment_id, "begin balance adjustment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse balance adjustment");
        }
    };
    match sqlx::query("SELECT id FROM patients WHERE id = $1 FOR UPDATE")
        .bind(patient_id)
        .fetch_optional(&mut *transaction)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "lock patient for balance adjustment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse balance adjustment");
        }
    }
    let existing_reversal = match sqlx::query(
        r#"SELECT id, reverses_adjustment_id, reason, effective_on
           FROM patient_balance_adjustments
           WHERE patient_id = $1
             AND request_id = $2
             AND transaction_type = 'reversal'"#,
    )
    .bind(patient_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, request_id = %body.request_id, "load balance adjustment reversal idempotency key");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse balance adjustment");
        }
    };
    if let Some(existing) = existing_reversal {
        let same_request = existing
            .try_get::<Option<Uuid>, _>("reverses_adjustment_id")
            .map(|value| value == Some(adjustment_id))
            .unwrap_or(false)
            && existing
                .try_get::<String, _>("reason")
                .map(|value| value == reason)
                .unwrap_or(false)
            && body.effective_on.as_ref().is_none_or(|_| {
                existing
                    .try_get::<NaiveDate, _>("effective_on")
                    .map(|value| value == effective_on)
                    .unwrap_or(false)
            });
        if !same_request {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used for another balance adjustment reversal",
            );
        }
        let reversal_id = existing.try_get::<Uuid, _>("id").unwrap_or_default();
        if let Err(e) = transaction.commit().await {
            tracing::error!(error = %e, patient_id = %patient_id, "commit balance adjustment reversal replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse balance adjustment");
        }
        return Json(serde_json::json!({
            "reversal_id": reversal_id,
            "idempotent_replay": true,
        }))
        .into_response();
    }
    let row = match sqlx::query(
        r#"SELECT adjustment.order_id, adjustment.transaction_type,
                  adjustment.direction, adjustment.category, adjustment.amount,
                  adjustment.currency, adjustment.effective_on,
                  adjustment.portal_visible,
                  EXISTS (
                      SELECT 1
                      FROM patient_balance_adjustments reversal
                      WHERE reversal.reverses_adjustment_id = adjustment.id
                        AND reversal.transaction_type = 'reversal'
                  ) AS already_reversed
           FROM patient_balance_adjustments adjustment
           WHERE adjustment.id = $1 AND adjustment.patient_id = $2
           FOR UPDATE OF adjustment"#,
    )
    .bind(adjustment_id)
    .bind(patient_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Balance adjustment not found"),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, adjustment_id = %adjustment_id, "lock balance adjustment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse balance adjustment");
        }
    };
    if row.try_get::<String, _>("transaction_type").unwrap_or_default() != "adjustment" {
        return err(StatusCode::CONFLICT, "Only a balance adjustment can be reversed");
    }
    if row.try_get::<bool, _>("already_reversed").unwrap_or(true) {
        return err(StatusCode::CONFLICT, "Balance adjustment was already reversed");
    }
    let original_date = row
        .try_get::<NaiveDate, _>("effective_on")
        .unwrap_or(effective_on);
    if effective_on < original_date {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reversal date cannot precede the adjustment date",
        );
    }
    let original_direction = row.try_get::<String, _>("direction").unwrap_or_default();
    let reversal_direction = if original_direction == "debit" {
        "credit"
    } else {
        "debit"
    };
    let reversal_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_balance_adjustments (
                patient_id, order_id, transaction_type, request_id, reverses_adjustment_id,
                direction, category, amount, currency, effective_on,
                reason, note, portal_visible, created_by
           ) VALUES ($1, $2, 'reversal', $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default())
    .bind(body.request_id)
    .bind(adjustment_id)
    .bind(reversal_direction)
    .bind(row.try_get::<String, _>("category").unwrap_or_default())
    .bind(row.try_get::<Decimal, _>("amount").unwrap_or(Decimal::ZERO))
    .bind(row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()))
    .bind(effective_on)
    .bind(&reason)
    .bind(row.try_get::<bool, _>("portal_visible").unwrap_or(false))
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(id) => id,
        Err(sqlx::Error::Database(db_error))
            if matches!(db_error.code().as_deref(), Some("23505" | "23514" | "P0001")) =>
        {
            return err(StatusCode::CONFLICT, "Balance adjustment was already reversed");
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, adjustment_id = %adjustment_id, "insert balance adjustment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse balance adjustment");
        }
    };
    if let Err(e) = transaction.commit().await {
        tracing::error!(error = %e, patient_id = %patient_id, adjustment_id = %adjustment_id, "commit balance adjustment reversal");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse balance adjustment");
    }

    state.audit_sender.try_send(audit::domain_event(
        "reverse_patient_balance_adjustment",
        Some(auth.user_id),
        "patient_balance_adjustment",
        Some(adjustment_id),
        serde_json::json!({
            "patient_id": patient_id,
            "reversal_id": reversal_id,
            "reason": reason,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.balance_adjustment_reversed",
        patient_id,
        serde_json::json!({
            "adjustment_id": adjustment_id,
            "reversal_id": reversal_id,
        }),
    )
    .await;
    Json(serde_json::json!({ "reversal_id": reversal_id })).into_response()
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

async fn export_patient_financial_ledger(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if !can_read_patient_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let from = match parse_query_date(query.from.as_deref(), "from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let to = match parse_query_date(query.to.as_deref(), "to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let margin_allowed = can_read_profit_margin(auth.role);

    let rows = match sqlx::query(
        r#"SELECT ae.id, ae.entry_date, ae.direction, ae.category, ae.description,
                  ae.amount_net, ae.amount_vat, ae.amount_gross, ae.currency,
                  i.invoice_number, ei.external_invoice_number, o.order_number
           FROM accounting_entries ae
           LEFT JOIN invoices i ON i.id = ae.source_invoice_id
           LEFT JOIN external_invoices ei ON ei.id = ae.source_external_invoice_id
           LEFT JOIN orders o ON o.id = ae.order_id
           WHERE ae.patient_id = $1
             AND ($2::date IS NULL OR ae.entry_date >= $2)
             AND ($3::date IS NULL OR ae.entry_date <= $3)
             AND ($4::uuid IS NULL OR ae.order_id = $4)
             AND ($5::uuid IS NULL OR EXISTS (
                    SELECT 1
                    FROM patient_service_packages psp
                    WHERE psp.patient_id = ae.patient_id
                      AND psp.package_id = $5
                      AND (
                            psp.order_id = ae.order_id
                            OR EXISTS (
                                SELECT 1
                                FROM service_package_consumptions spc
                                WHERE spc.patient_service_package_id = psp.id
                                  AND (
                                        spc.order_id = ae.order_id
                                        OR spc.invoice_id = ae.source_invoice_id
                                  )
                            )
                      )
             ))
           ORDER BY ae.entry_date DESC, ae.created_at DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(query.package_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "export patient financial ledger");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to export patient financial ledger",
            );
        }
    };

    let mut csv = String::from(
        "entry_date,direction,category,description,order_number,invoice_number,external_invoice_number,amount_net,amount_vat,amount_gross,currency\n",
    );
    for row in rows {
        let direction = row.try_get::<String, _>("direction").unwrap_or_default();
        if direction == "expense" && !margin_allowed {
            continue;
        }
        let fields = [
            row.try_get::<NaiveDate, _>("entry_date")
                .map(|value| value.to_string())
                .unwrap_or_default(),
            direction,
            row.try_get::<String, _>("category").unwrap_or_default(),
            row.try_get::<String, _>("description").unwrap_or_default(),
            row.try_get::<Option<String>, _>("order_number")
                .unwrap_or_default()
                .unwrap_or_default(),
            row.try_get::<Option<String>, _>("invoice_number")
                .unwrap_or_default()
                .unwrap_or_default(),
            row.try_get::<Option<String>, _>("external_invoice_number")
                .unwrap_or_default()
                .unwrap_or_default(),
            decimal_to_string(
                row.try_get::<Decimal, _>("amount_net")
                    .unwrap_or(Decimal::ZERO),
            ),
            decimal_to_string(
                row.try_get::<Decimal, _>("amount_vat")
                    .unwrap_or(Decimal::ZERO),
            ),
            decimal_to_string(
                row.try_get::<Decimal, _>("amount_gross")
                    .unwrap_or(Decimal::ZERO),
            ),
            row.try_get::<String, _>("currency")
                .unwrap_or_else(|_| "EUR".to_string()),
        ];
        csv.push_str(
            &fields
                .iter()
                .map(|field| csv_escape(field))
                .collect::<Vec<_>>()
                .join(","),
        );
        csv.push('\n');
    }

    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"patient-financial-ledger.csv\"",
            ),
        ],
        csv,
    )
        .into_response()
}
