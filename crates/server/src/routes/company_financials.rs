use std::str::FromStr;

use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/company-financial-position",
        get(get_company_financial_position),
    )
}

#[derive(Deserialize)]
struct CompanyFinancialQuery {
    from: Option<String>,
    to: Option<String>,
    currency: Option<String>,
    movement: Option<String>,
    search: Option<String>,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn can_read_company_financials(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn parse_date(value: Option<&str>, field: &str) -> Result<Option<NaiveDate>, String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| format!("Invalid {field}; expected YYYY-MM-DD"))
        })
        .transpose()
}

fn parse_currency(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let currency = value.to_uppercase();
    if currency.len() != 3 || !currency.chars().all(|character| character.is_ascii_uppercase()) {
        return Err("Invalid currency; expected a three-letter ISO code".to_string());
    }
    Ok(Some(currency))
}

fn parse_movement(value: Option<&str>) -> Result<String, String> {
    let movement = value.unwrap_or("all").trim().to_lowercase();
    if matches!(movement.as_str(), "all" | "inflow" | "outflow") {
        Ok(movement)
    } else {
        Err("Invalid movement filter".to_string())
    }
}

fn parse_search(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > 100 {
        return Err("Search is too long".to_string());
    }
    Ok(Some(format!("%{value}%")))
}

async fn get_company_financial_position(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<CompanyFinancialQuery>,
) -> axum::response::Response {
    if !can_read_company_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let today = Utc::now().date_naive();
    let default_from = NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap_or(today);
    let from = match parse_date(query.from.as_deref(), "from") {
        Ok(value) => value.unwrap_or(default_from),
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let to = match parse_date(query.to.as_deref(), "to") {
        Ok(value) => value.unwrap_or(today),
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if from > to {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "from cannot be later than to",
        );
    }
    let requested_currency = match parse_currency(query.currency.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let movement = match parse_movement(query.movement.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let search = match parse_search(query.search.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };

    let mut available_currencies = match sqlx::query_scalar::<_, String>(
        r#"SELECT DISTINCT currency
           FROM (
               SELECT UPPER(TRIM(orders.currency)) AS currency
               FROM invoices invoice
               JOIN orders ON orders.id = invoice.order_id
               WHERE invoice.status <> 'cancelled'
               UNION ALL
               SELECT UPPER(TRIM(external.currency))
               FROM external_invoices external
               WHERE external.status <> 'cancelled'
               UNION ALL
               SELECT UPPER(TRIM(adjustment.currency))
               FROM patient_balance_adjustments adjustment
               UNION ALL
               SELECT UPPER(TRIM(entry.currency))
               FROM accounting_entries entry
           ) currencies
           WHERE currency ~ '^[A-Z]{3}$'
           ORDER BY currency"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "load company financial currencies");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load company financial position",
            );
        }
    };
    let currency = requested_currency.unwrap_or_else(|| {
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

    let patient_rows = match sqlx::query(
        r#"WITH source_allocations AS (
               SELECT allocation.advance_invoice_id,
                      COALESCE(SUM(allocation.amount_gross), 0) AS allocated
               FROM invoice_prepayment_allocations allocation
               GROUP BY allocation.advance_invoice_id
           ), invoice_positions AS (
               SELECT invoice.patient_id,
                      COALESCE(SUM(
                          CASE
                              WHEN invoice.invoice_type <> 'advance'
                               AND invoice.status NOT IN ('draft', 'cancelled')
                                  THEN GREATEST(
                                      invoice.total_gross
                                          - invoice.credited_amount
                                          - invoice.paid_amount
                                          - invoice.prepayment_applied_amount,
                                      0
                                  )
                              ELSE 0
                          END
                      ), 0) AS invoice_due,
                      COALESCE(SUM(
                          CASE
                              WHEN invoice.invoice_type = 'advance'
                               AND invoice.status NOT IN ('draft', 'cancelled')
                                  THEN GREATEST(
                                      LEAST(
                                          invoice.paid_amount,
                                          GREATEST(invoice.total_gross - invoice.credited_amount, 0)
                                      ) - COALESCE(source.allocated, 0),
                                      0
                                  )
                              ELSE 0
                          END
                      ), 0) AS available_prepayment,
                      COUNT(*) FILTER (
                          WHERE invoice.invoice_type <> 'advance'
                            AND invoice.status NOT IN ('draft', 'cancelled')
                      )::bigint AS released_invoice_count
               FROM invoices invoice
               JOIN orders ON orders.id = invoice.order_id
               LEFT JOIN source_allocations source
                 ON source.advance_invoice_id = invoice.id
               WHERE UPPER(orders.currency) = $1
               GROUP BY invoice.patient_id
           ), external_allocations AS (
               SELECT allocation.external_invoice_id,
                      COALESCE(SUM(allocation.amount_gross), 0) AS allocated
               FROM external_invoice_patient_invoice_allocations allocation
               JOIN invoices target ON target.id = allocation.patient_invoice_id
               WHERE allocation.reversed_at IS NULL
                 AND target.status NOT IN ('draft', 'cancelled')
               GROUP BY allocation.external_invoice_id
           ), external_positions AS (
               SELECT external.patient_id,
                      COALESCE(SUM(GREATEST(
                          external.patient_receivable_gross - COALESCE(allocation.allocated, 0),
                          0
                      )), 0) AS external_receivable
               FROM external_invoices external
               LEFT JOIN external_allocations allocation
                 ON allocation.external_invoice_id = external.id
               WHERE external.status <> 'cancelled'
                 AND external.patient_receivable_gross > 0
                 AND UPPER(external.currency) = $1
               GROUP BY external.patient_id
           ), manual_positions AS (
               SELECT adjustment.patient_id,
                      COALESCE(SUM(
                          CASE
                              WHEN adjustment.direction = 'debit' THEN adjustment.amount
                              ELSE -adjustment.amount
                          END
                      ), 0) AS manual_balance
               FROM patient_balance_adjustments adjustment
               WHERE adjustment.currency = $1
               GROUP BY adjustment.patient_id
           ), scoped_patients AS (
               SELECT patient_id FROM invoice_positions
               UNION
               SELECT patient_id FROM external_positions
               UNION
               SELECT patient_id FROM manual_positions
           )
           SELECT patient.id, patient.patient_id AS patient_pid,
                  patient.first_name, patient.last_name, patient.is_active,
                  COALESCE(invoice.invoice_due, 0) AS invoice_due,
                  COALESCE(invoice.available_prepayment, 0) AS available_prepayment,
                  COALESCE(invoice.released_invoice_count, 0) AS released_invoice_count,
                  COALESCE(external.external_receivable, 0) AS external_receivable,
                  COALESCE(manual.manual_balance, 0) AS manual_balance
           FROM scoped_patients scoped
           JOIN patients patient ON patient.id = scoped.patient_id
           LEFT JOIN invoice_positions invoice ON invoice.patient_id = patient.id
           LEFT JOIN external_positions external ON external.patient_id = patient.id
           LEFT JOIN manual_positions manual ON manual.patient_id = patient.id"#,
    )
    .bind(&currency)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load company patient positions");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load company financial position",
            );
        }
    };

    let mut patient_receivables = Decimal::ZERO;
    let mut patient_credits = Decimal::ZERO;
    let mut unreconciled_external_receivables = Decimal::ZERO;
    let mut reconciliation_count = 0_u64;
    let mut patient_positions = Vec::new();
    for row in patient_rows {
        let invoice_due = row
            .try_get::<Decimal, _>("invoice_due")
            .unwrap_or(Decimal::ZERO);
        let available_prepayment = row
            .try_get::<Decimal, _>("available_prepayment")
            .unwrap_or(Decimal::ZERO);
        let external_receivable = row
            .try_get::<Decimal, _>("external_receivable")
            .unwrap_or(Decimal::ZERO);
        let manual_balance = row
            .try_get::<Decimal, _>("manual_balance")
            .unwrap_or(Decimal::ZERO);
        let released_invoice_count = row
            .try_get::<i64, _>("released_invoice_count")
            .unwrap_or(0);
        let calculated_balance =
            (invoice_due + external_receivable + manual_balance - available_prepayment)
                .round_dp(2);
        let reconciliation_required =
            external_receivable > Decimal::ZERO && released_invoice_count > 0;
        if calculated_balance > Decimal::ZERO {
            patient_receivables += calculated_balance;
        } else if calculated_balance < Decimal::ZERO {
            patient_credits += -calculated_balance;
        }
        if reconciliation_required {
            reconciliation_count += 1;
            unreconciled_external_receivables += external_receivable;
        }
        if calculated_balance == Decimal::ZERO && !reconciliation_required {
            continue;
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
        patient_positions.push(json!({
            "patient_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
            "patient_name": patient_name,
            "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
            "invoice_due": decimal_to_string(invoice_due),
            "external_receivable": decimal_to_string(external_receivable),
            "manual_balance": decimal_to_string(manual_balance),
            "available_prepayment": decimal_to_string(available_prepayment),
            "calculated_balance": decimal_to_string(calculated_balance),
            "balance_side": if calculated_balance > Decimal::ZERO {
                "debit"
            } else if calculated_balance < Decimal::ZERO {
                "credit"
            } else {
                "settled"
            },
            "reconciliation_required": reconciliation_required,
        }));
    }
    patient_positions.sort_by(|left, right| {
        let left_value = left
            .get("calculated_balance")
            .and_then(Value::as_str)
            .and_then(|value| Decimal::from_str(value).ok())
            .unwrap_or(Decimal::ZERO)
            .abs();
        let right_value = right
            .get("calculated_balance")
            .and_then(Value::as_str)
            .and_then(|value| Decimal::from_str(value).ok())
            .unwrap_or(Decimal::ZERO)
            .abs();
        right_value.cmp(&left_value)
    });

    let provider_rows = match sqlx::query(
        r#"SELECT external.id, external.external_invoice_number,
                  external.invoice_date, external.due_date, external.status,
                  external.provider_liability_gross, external.order_id,
                  orders.order_number, external.patient_id,
                  patient.patient_id AS patient_pid,
                  patient.first_name, patient.last_name,
                  provider.id AS provider_id, provider.name AS provider_name
           FROM external_invoices external
           JOIN orders ON orders.id = external.order_id
           JOIN patients patient ON patient.id = external.patient_id
           LEFT JOIN providers provider ON provider.id = external.provider_id
           WHERE external.status <> 'cancelled'
             AND external.provider_liability_gross > 0
             AND UPPER(external.currency) = $1
           ORDER BY external.due_date NULLS LAST, external.created_at DESC"#,
    )
    .bind(&currency)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load company provider liabilities");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load company financial position",
            );
        }
    };
    let mut provider_payables = Decimal::ZERO;
    let mut expected_provider_costs = Decimal::ZERO;
    let mut provider_liabilities = Vec::with_capacity(provider_rows.len());
    for row in provider_rows {
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let amount = row
            .try_get::<Decimal, _>("provider_liability_gross")
            .unwrap_or(Decimal::ZERO);
        let liability_kind = if status == "expected" {
            expected_provider_costs += amount;
            "expected"
        } else {
            provider_payables += amount;
            "payable"
        };
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
        provider_liabilities.push(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "external_invoice_number": row.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
            "invoice_date": row.try_get::<Option<NaiveDate>, _>("invoice_date").unwrap_or_default().map(|value| value.to_string()),
            "due_date": row.try_get::<Option<NaiveDate>, _>("due_date").unwrap_or_default().map(|value| value.to_string()),
            "status": status,
            "liability_kind": liability_kind,
            "amount_gross": decimal_to_string(amount),
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
            "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
            "patient_name": patient_name,
            "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
            "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
        }));
    }

    let cash_summary = match sqlx::query(
        r#"WITH movements AS (
               SELECT CASE
                          WHEN entry.direction = 'income' THEN entry.amount_gross
                          ELSE -entry.amount_gross
                      END AS signed_amount
               FROM accounting_entries entry
               WHERE entry.entry_date >= $1
                 AND entry.entry_date <= $2
                 AND UPPER(entry.currency) = $3
           )
           SELECT COALESCE(SUM(GREATEST(signed_amount, 0)), 0) AS cash_inflow,
                  COALESCE(SUM(GREATEST(-signed_amount, 0)), 0) AS cash_outflow,
                  COALESCE(SUM(signed_amount), 0) AS net_cash_flow
           FROM movements"#,
    )
    .bind(from)
    .bind(to)
    .bind(&currency)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load company cash summary");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load company financial position",
            );
        }
    };
    let cash_inflow = cash_summary
        .try_get::<Decimal, _>("cash_inflow")
        .unwrap_or(Decimal::ZERO);
    let cash_outflow = cash_summary
        .try_get::<Decimal, _>("cash_outflow")
        .unwrap_or(Decimal::ZERO);
    let net_cash_flow = cash_summary
        .try_get::<Decimal, _>("net_cash_flow")
        .unwrap_or(Decimal::ZERO);

    let cash_rows = match sqlx::query(
        r#"WITH movements AS (
               SELECT entry.id, entry.entry_date, entry.category, entry.description,
                      entry.amount_net, entry.amount_vat, entry.amount_gross,
                      CASE
                          WHEN entry.direction = 'income' THEN entry.amount_gross
                          ELSE -entry.amount_gross
                      END AS signed_amount,
                      invoice.invoice_number,
                       external.external_invoice_number,
                       orders.id AS order_id, orders.order_number,
                       patient.id AS patient_id, patient.patient_id AS patient_pid,
                       patient.first_name, patient.last_name,
                       financial_account.id AS financial_account_id,
                       financial_account.name AS financial_account_name
               FROM accounting_entries entry
               LEFT JOIN invoices invoice ON invoice.id = entry.source_invoice_id
               LEFT JOIN external_invoices external
                 ON external.id = entry.source_external_invoice_id
               LEFT JOIN orders ON orders.id = entry.order_id
               LEFT JOIN patients patient ON patient.id = entry.patient_id
               LEFT JOIN company_financial_accounts financial_account
                 ON financial_account.id = entry.financial_account_id
               WHERE entry.entry_date >= $1
                 AND entry.entry_date <= $2
                 AND UPPER(entry.currency) = $3
           ), filtered AS (
               SELECT *, COUNT(*) OVER() AS total_count
               FROM movements
               WHERE (
                        ($4 = 'all')
                     OR ($4 = 'inflow' AND signed_amount > 0)
                     OR ($4 = 'outflow' AND signed_amount < 0)
               )
                 AND (
                        $5::text IS NULL
                     OR concat_ws(' ', description, invoice_number,
                                  external_invoice_number, order_number, patient_pid,
                                  first_name, last_name) ILIKE $5
                 )
           )
           SELECT *
           FROM filtered
           ORDER BY entry_date DESC, id DESC
           LIMIT 500"#,
    )
    .bind(from)
    .bind(to)
    .bind(&currency)
    .bind(&movement)
    .bind(search)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load company cash movements");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load company financial position",
            );
        }
    };
    let cash_movement_count = cash_rows
        .first()
        .and_then(|row| row.try_get::<i64, _>("total_count").ok())
        .unwrap_or(0);
    let cash_movements = cash_rows
        .into_iter()
        .map(|row| {
            let signed_amount = row
                .try_get::<Decimal, _>("signed_amount")
                .unwrap_or(Decimal::ZERO);
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
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "entry_date": row.try_get::<NaiveDate, _>("entry_date").map(|value| value.to_string()).unwrap_or_default(),
                "movement": if signed_amount >= Decimal::ZERO { "inflow" } else { "outflow" },
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "description": row.try_get::<String, _>("description").unwrap_or_default(),
                "amount_net": decimal_to_string(row.try_get::<Decimal, _>("amount_net").unwrap_or(Decimal::ZERO).abs()),
                "amount_vat": decimal_to_string(row.try_get::<Decimal, _>("amount_vat").unwrap_or(Decimal::ZERO).abs()),
                "amount_gross": decimal_to_string(signed_amount.abs()),
                "signed_amount": decimal_to_string(signed_amount),
                "invoice_number": row.try_get::<Option<String>, _>("invoice_number").unwrap_or_default(),
                "external_invoice_number": row.try_get::<Option<String>, _>("external_invoice_number").unwrap_or_default(),
                "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
                "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
                "patient_pid": row.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
                "patient_name": if patient_name.is_empty() { None::<String> } else { Some(patient_name) },
                "financial_account_id": row.try_get::<Option<Uuid>, _>("financial_account_id").unwrap_or_default(),
                "financial_account_name": row.try_get::<Option<String>, _>("financial_account_name").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    patient_receivables = patient_receivables.round_dp(2);
    patient_credits = patient_credits.round_dp(2);
    provider_payables = provider_payables.round_dp(2);
    expected_provider_costs = expected_provider_costs.round_dp(2);
    unreconciled_external_receivables = unreconciled_external_receivables.round_dp(2);
    let calculated_net_position =
        (patient_receivables - patient_credits - provider_payables).round_dp(2);
    let reconciliation_required = reconciliation_count > 0;

    Json(json!({
        "currency": currency,
        "available_currencies": available_currencies,
        "as_of": today.to_string(),
        "period": {
            "from": from.to_string(),
            "to": to.to_string(),
        },
        "summary": {
            "patient_receivables_calculated": decimal_to_string(patient_receivables),
            "patient_credits": decimal_to_string(patient_credits),
            "provider_payables": decimal_to_string(provider_payables),
            "expected_provider_costs": decimal_to_string(expected_provider_costs),
            "unreconciled_external_receivables": decimal_to_string(unreconciled_external_receivables),
            "reconciliation_required": reconciliation_required,
            "reconciliation_patient_count": reconciliation_count,
            "calculated_net_position": decimal_to_string(calculated_net_position),
            "confirmed_net_position": if reconciliation_required {
                Value::Null
            } else {
                json!(decimal_to_string(calculated_net_position))
            },
            "cash_inflow": decimal_to_string(cash_inflow),
            "cash_outflow": decimal_to_string(cash_outflow),
            "net_cash_flow": decimal_to_string(net_cash_flow),
        },
        "patient_positions": patient_positions,
        "provider_liabilities": provider_liabilities,
        "cash_movements": cash_movements,
        "cash_movement_count": cash_movement_count,
        "cash_movements_truncated": cash_movement_count > 500,
        "generated_at": Utc::now().to_rfc3339(),
    }))
    .into_response()
}
