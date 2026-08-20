use std::str::FromStr;

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/company-provider-liabilities/{external_invoice_id}/settlements",
            get(get_provider_settlement).post(create_provider_payment),
        )
        .route(
            "/company-provider-liabilities/{external_invoice_id}/settlements/{payment_id}/reversal",
            post(reverse_provider_payment),
        )
        .route(
            "/company-provider-statements/{provider_id}",
            get(get_provider_statement),
        )
}

#[derive(Deserialize)]
struct CreateProviderPaymentRequest {
    request_id: Uuid,
    financial_account_id: Uuid,
    amount_gross: String,
    paid_on: String,
    payment_method: String,
    reference: Option<String>,
    note: Option<String>,
}

#[derive(Deserialize)]
struct ReverseProviderPaymentRequest {
    request_id: Uuid,
    paid_on: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct ProviderStatementQuery {
    from: Option<String>,
    to: Option<String>,
    currency: Option<String>,
}

struct PaymentInput {
    amount_gross: Decimal,
    paid_on: NaiveDate,
    payment_method: String,
    reference: Option<String>,
    note: Option<String>,
}

struct ExternalInvoiceContext {
    id: Uuid,
    order_id: Uuid,
    patient_id: Uuid,
    external_invoice_number: String,
    status: String,
    paid_by: String,
    provider_settlement_base_status: Option<String>,
    due_date: Option<NaiveDate>,
    amount_vat: Decimal,
    amount_gross: Decimal,
    currency: String,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn can_manage_provider_settlements(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| format!("Invalid {field}; expected YYYY-MM-DD"))
}

fn parse_positive_amount(value: &str) -> Result<Decimal, &'static str> {
    let amount = Decimal::from_str(value.trim())
        .map_err(|_| "Invalid amount")?
        .round_dp(2);
    if amount <= Decimal::ZERO {
        return Err("Amount must be greater than zero");
    }
    Ok(amount)
}

fn clean_optional(value: Option<&str>, max: usize) -> Result<Option<String>, &'static str> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.chars().count() > max) {
        return Err("Value is too long");
    }
    Ok(value.map(str::to_string))
}

fn payment_method_is_valid(value: &str) -> bool {
    matches!(value, "bank_transfer" | "cash" | "card" | "other")
}

fn payment_row_payload(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "external_invoice_id": row.try_get::<Uuid, _>("external_invoice_id").unwrap_or_default(),
        "financial_account_id": row.try_get::<Uuid, _>("financial_account_id").unwrap_or_default(),
        "financial_account_name": row.try_get::<String, _>("financial_account_name").unwrap_or_default(),
        "transaction_type": row.try_get::<String, _>("transaction_type").unwrap_or_default(),
        "reverses_transaction_id": row.try_get::<Option<Uuid>, _>("reverses_transaction_id").unwrap_or_default(),
        "amount_gross": decimal_to_string(row.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)),
        "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
        "paid_on": row.try_get::<NaiveDate, _>("paid_on").map(|value| value.to_string()).unwrap_or_default(),
        "payment_method": row.try_get::<String, _>("payment_method").unwrap_or_default(),
        "reference": row.try_get::<Option<String>, _>("reference").unwrap_or_default(),
        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
        "created_by": row.try_get::<Uuid, _>("created_by").unwrap_or_default(),
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

const PAYMENT_RESPONSE_QUERY: &str = r#"
    SELECT payment_tx.id, payment_tx.external_invoice_id,
           payment_tx.financial_account_id, account.name AS financial_account_name,
           payment_tx.transaction_type, payment_tx.reverses_transaction_id,
           payment_tx.amount_gross, payment_tx.currency, payment_tx.paid_on,
           payment_tx.payment_method, payment_tx.reference, payment_tx.note,
           payment_tx.created_by, creator.name AS created_by_name,
           payment_tx.created_at
    FROM external_invoice_provider_payment_transactions payment_tx
    JOIN company_financial_accounts account ON account.id = payment_tx.financial_account_id
    JOIN users creator ON creator.id = payment_tx.created_by
"#;

async fn load_external_invoice_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    external_invoice_id: Uuid,
) -> Result<Option<ExternalInvoiceContext>, sqlx::Error> {
    sqlx::query(
        r#"SELECT id, order_id, patient_id, external_invoice_number, status, paid_by,
                  provider_settlement_base_status, due_date,
                  amount_vat, amount_gross, UPPER(currency) AS currency
           FROM external_invoices
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(external_invoice_id)
    .fetch_optional(&mut **transaction)
    .await
    .map(|row| {
        row.map(|row| ExternalInvoiceContext {
            id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
            order_id: row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            external_invoice_number: row
                .try_get::<String, _>("external_invoice_number")
                .unwrap_or_default(),
            status: row.try_get::<String, _>("status").unwrap_or_default(),
            paid_by: row
                .try_get::<String, _>("paid_by")
                .unwrap_or_else(|_| "unpaid".to_string()),
            provider_settlement_base_status: row
                .try_get::<Option<String>, _>("provider_settlement_base_status")
                .unwrap_or_default(),
            due_date: row
                .try_get::<Option<NaiveDate>, _>("due_date")
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

async fn load_payment_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    payment_id: Uuid,
) -> Result<Option<Value>, sqlx::Error> {
    let query = format!("{PAYMENT_RESPONSE_QUERY} WHERE payment_tx.id = $1");
    sqlx::query(&query)
        .bind(payment_id)
        .fetch_optional(&mut **transaction)
        .await
        .map(|row| row.as_ref().map(payment_row_payload))
}

async fn current_company_paid(
    transaction: &mut Transaction<'_, Postgres>,
    external_invoice_id: Uuid,
) -> Result<Decimal, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(
                  CASE WHEN transaction_type = 'payment'
                       THEN amount_gross ELSE -amount_gross END
              ), 0)
           FROM external_invoice_provider_payment_transactions
           WHERE external_invoice_id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&mut **transaction)
    .await
}

async fn get_provider_settlement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(external_invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_manage_provider_settlements(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let summary = match sqlx::query(
        r#"SELECT external.id, external.external_invoice_number,
                  external.amount_gross, UPPER(external.currency) AS currency,
                  external.status, external.paid_by,
                  balance.company_paid_gross,
                  balance.remaining_provider_liability_gross,
                  balance.settlement_status, balance.latest_payment_on,
                  balance.payment_count
           FROM external_invoices external
           JOIN external_invoice_provider_settlement_balances balance
             ON balance.external_invoice_id = external.id
           WHERE external.id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "External invoice not found"),
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "load provider settlement summary");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load provider settlement");
        }
    };

    let payment_query = format!(
        "{PAYMENT_RESPONSE_QUERY} WHERE payment_tx.external_invoice_id = $1 ORDER BY payment_tx.paid_on DESC, payment_tx.created_at DESC, payment_tx.id DESC"
    );
    let payment_rows = match sqlx::query(&payment_query)
        .bind(external_invoice_id)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "load provider settlement history");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load provider settlement");
        }
    };

    Json(json!({
        "external_invoice_id": external_invoice_id,
        "external_invoice_number": summary.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
        "amount_gross": decimal_to_string(summary.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)),
        "currency": summary.try_get::<String, _>("currency").unwrap_or_default(),
        "status": summary.try_get::<String, _>("status").unwrap_or_default(),
        "paid_by": summary.try_get::<String, _>("paid_by").unwrap_or_default(),
        "company_paid_gross": decimal_to_string(summary.try_get::<Decimal, _>("company_paid_gross").unwrap_or(Decimal::ZERO)),
        "remaining_provider_liability_gross": decimal_to_string(summary.try_get::<Decimal, _>("remaining_provider_liability_gross").unwrap_or(Decimal::ZERO)),
        "settlement_status": summary.try_get::<String, _>("settlement_status").unwrap_or_default(),
        "latest_payment_on": summary.try_get::<Option<NaiveDate>, _>("latest_payment_on").unwrap_or_default().map(|value| value.to_string()),
        "payment_count": summary.try_get::<i64, _>("payment_count").unwrap_or(0),
        "transactions": payment_rows.iter().map(payment_row_payload).collect::<Vec<_>>(),
    }))
    .into_response()
}

async fn get_provider_statement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    Query(query): Query<ProviderStatementQuery>,
) -> axum::response::Response {
    if !can_manage_provider_settlements(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let today = Utc::now().date_naive();
    let default_from = NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap_or(today);
    let from = match query.from.as_deref() {
        Some(value) => match parse_date(value, "from") {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
        },
        None => default_from,
    };
    let to = match query.to.as_deref() {
        Some(value) => match parse_date(value, "to") {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
        },
        None => today,
    };
    if from > to {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "from cannot be later than to",
        );
    }
    let currency = query
        .currency
        .as_deref()
        .unwrap_or("EUR")
        .trim()
        .to_uppercase();
    if currency.len() != 3
        || !currency
            .chars()
            .all(|character| character.is_ascii_uppercase())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid currency; expected a three-letter ISO code",
        );
    }

    let provider_name = match sqlx::query_scalar::<_, String>(
        "SELECT name FROM providers WHERE id = $1",
    )
    .bind(provider_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(name)) => name,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Provider not found"),
        Err(error) => {
            tracing::error!(error = %error, provider_id = %provider_id, "load provider statement provider");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load provider statement",
            );
        }
    };

    let movement_rows = match sqlx::query(
        r#"WITH statement_movements AS (
               SELECT external.id AS movement_id,
                      COALESCE(external.invoice_date, external.created_at::date) AS movement_date,
                      'invoice'::text AS movement_type,
                      external.id AS external_invoice_id,
                      external.external_invoice_number,
                      external.amount_gross AS amount_charged,
                      0::numeric AS amount_paid,
                      orders.id AS order_id, orders.order_number,
                      patient.id AS patient_id, patient.patient_id AS patient_pid,
                      concat_ws(' ', patient.first_name, patient.last_name) AS patient_name,
                      NULL::text AS financial_account_name,
                      NULL::text AS reference
               FROM external_invoices external
               JOIN orders ON orders.id = external.order_id
               JOIN patients patient ON patient.id = external.patient_id
               WHERE external.provider_id = $1
                 AND UPPER(external.currency) = $2
                 AND external.status NOT IN ('cancelled', 'expected')
                 AND external.paid_by <> 'patient'

               UNION ALL

               SELECT payment_tx.id AS movement_id,
                      payment_tx.paid_on AS movement_date,
                      payment_tx.transaction_type AS movement_type,
                      external.id AS external_invoice_id,
                      external.external_invoice_number,
                      CASE WHEN payment_tx.transaction_type = 'reversal'
                           THEN payment_tx.amount_gross ELSE 0 END AS amount_charged,
                      CASE WHEN payment_tx.transaction_type = 'payment'
                           THEN payment_tx.amount_gross ELSE 0 END AS amount_paid,
                      orders.id AS order_id, orders.order_number,
                      patient.id AS patient_id, patient.patient_id AS patient_pid,
                      concat_ws(' ', patient.first_name, patient.last_name) AS patient_name,
                      account.name AS financial_account_name,
                      payment_tx.reference
               FROM external_invoice_provider_payment_transactions payment_tx
               JOIN external_invoices external
                 ON external.id = payment_tx.external_invoice_id
               JOIN orders ON orders.id = external.order_id
               JOIN patients patient ON patient.id = external.patient_id
               JOIN company_financial_accounts account
                 ON account.id = payment_tx.financial_account_id
               WHERE external.provider_id = $1
                 AND UPPER(payment_tx.currency) = $2
           )
           SELECT movement_id, movement_date, movement_type,
                  external_invoice_id, external_invoice_number,
                  amount_charged, amount_paid,
                  order_id, order_number, patient_id, patient_pid, patient_name,
                  financial_account_name, reference
           FROM statement_movements
           WHERE movement_date <= $3
           ORDER BY movement_date,
                    CASE movement_type
                        WHEN 'invoice' THEN 0
                        WHEN 'payment' THEN 1
                        ELSE 2
                    END,
                    movement_id"#,
    )
    .bind(provider_id)
    .bind(&currency)
    .bind(to)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, provider_id = %provider_id, currency = %currency, "load provider statement movements");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load provider statement",
            );
        }
    };

    let expected_gross = match sqlx::query_scalar::<_, Decimal>(
        r#"SELECT COALESCE(SUM(external.amount_gross), 0)
           FROM external_invoices external
           WHERE external.provider_id = $1
             AND UPPER(external.currency) = $2
             AND external.status = 'expected'
             AND external.paid_by <> 'patient'
             AND COALESCE(external.invoice_date, external.created_at::date) <= $3"#,
    )
    .bind(provider_id)
    .bind(&currency)
    .bind(to)
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, provider_id = %provider_id, currency = %currency, "load provider statement expected costs");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load provider statement",
            );
        }
    };

    let mut opening_balance = Decimal::ZERO;
    let mut running_balance = Decimal::ZERO;
    let mut charged_gross = Decimal::ZERO;
    let mut paid_gross = Decimal::ZERO;
    let mut reversed_gross = Decimal::ZERO;
    let mut movements = Vec::new();
    for row in movement_rows {
        let movement_date = row
            .try_get::<NaiveDate, _>("movement_date")
            .unwrap_or(today);
        let movement_type = row
            .try_get::<String, _>("movement_type")
            .unwrap_or_default();
        let amount_charged = row
            .try_get::<Decimal, _>("amount_charged")
            .unwrap_or(Decimal::ZERO);
        let amount_paid = row
            .try_get::<Decimal, _>("amount_paid")
            .unwrap_or(Decimal::ZERO);
        if movement_date < from {
            opening_balance += amount_charged - amount_paid;
            continue;
        }
        if movements.is_empty() {
            running_balance = opening_balance;
        }
        running_balance += amount_charged - amount_paid;
        if movement_type == "invoice" {
            charged_gross += amount_charged;
        } else if movement_type == "payment" {
            paid_gross += amount_paid;
        } else if movement_type == "reversal" {
            reversed_gross += amount_charged;
        }
        movements.push(json!({
            "id": row.try_get::<Uuid, _>("movement_id").unwrap_or_default(),
            "movement_date": movement_date.to_string(),
            "movement_type": movement_type,
            "external_invoice_id": row.try_get::<Uuid, _>("external_invoice_id").unwrap_or_default(),
            "external_invoice_number": row.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
            "amount_charged": decimal_to_string(amount_charged),
            "amount_paid": decimal_to_string(amount_paid),
            "running_balance": decimal_to_string(running_balance),
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
            "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
            "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
            "financial_account_name": row.try_get::<Option<String>, _>("financial_account_name").unwrap_or_default(),
            "reference": row.try_get::<Option<String>, _>("reference").unwrap_or_default(),
        }));
    }
    if movements.is_empty() {
        running_balance = opening_balance;
    }

    Json(json!({
        "provider_id": provider_id,
        "provider_name": provider_name,
        "currency": currency,
        "period": { "from": from.to_string(), "to": to.to_string() },
        "summary": {
            "opening_balance": decimal_to_string(opening_balance),
            "charged_gross": decimal_to_string(charged_gross),
            "paid_gross": decimal_to_string(paid_gross),
            "reversed_gross": decimal_to_string(reversed_gross),
            "expected_gross": decimal_to_string(expected_gross),
            "closing_balance": decimal_to_string(running_balance),
        },
        "movements": movements,
        "generated_at": Utc::now().to_rfc3339(),
    }))
    .into_response()
}

async fn create_provider_payment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(external_invoice_id): Path<Uuid>,
    Json(body): Json<CreateProviderPaymentRequest>,
) -> axum::response::Response {
    if !can_manage_provider_settlements(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let payment_method = body.payment_method.trim().to_lowercase();
    if !payment_method_is_valid(&payment_method) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid payment method");
    }
    let input = match (
        parse_positive_amount(&body.amount_gross),
        parse_date(&body.paid_on, "paid_on"),
        clean_optional(body.reference.as_deref(), 200),
        clean_optional(body.note.as_deref(), 1_000),
    ) {
        (Ok(amount_gross), Ok(paid_on), Ok(reference), Ok(note)) => PaymentInput {
            amount_gross,
            paid_on,
            payment_method,
            reference,
            note,
        },
        (Err(message), _, _, _) | (_, _, Err(message), _) | (_, _, _, Err(message)) => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, message);
        }
        (_, Err(message), _, _) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if input.paid_on > Utc::now().date_naive() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Payment date cannot be in the future");
    }

    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(error) => {
            tracing::error!(error = %error, "begin provider payment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let context = match load_external_invoice_for_update(&mut transaction, external_invoice_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return err(StatusCode::NOT_FOUND, "External invoice not found"),
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "lock external invoice for provider payment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let replay = match sqlx::query(
        r#"SELECT id, financial_account_id, transaction_type, amount_gross,
                  paid_on, payment_method, reference, note, created_by
           FROM external_invoice_provider_payment_transactions
           WHERE external_invoice_id = $1 AND request_id = $2"#,
    )
    .bind(external_invoice_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "load provider payment replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Some(replay) = replay {
        let replay_reference = replay
            .try_get::<Option<String>, _>("reference")
            .ok()
            .flatten();
        let replay_note = replay
            .try_get::<Option<String>, _>("note")
            .ok()
            .flatten();
        let matches = replay.try_get::<String, _>("transaction_type").ok().as_deref() == Some("payment")
            && replay.try_get::<Uuid, _>("financial_account_id").ok() == Some(body.financial_account_id)
            && replay.try_get::<Decimal, _>("amount_gross").ok() == Some(input.amount_gross)
            && replay.try_get::<NaiveDate, _>("paid_on").ok() == Some(input.paid_on)
            && replay.try_get::<String, _>("payment_method").ok().as_deref() == Some(input.payment_method.as_str())
            && replay_reference.as_deref() == input.reference.as_deref()
            && replay_note.as_deref() == input.note.as_deref()
            && replay.try_get::<Uuid, _>("created_by").ok() == Some(auth.user_id);
        if !matches {
            return err(StatusCode::CONFLICT, "request_id was already used with different data");
        }
        let payment_id = replay.try_get::<Uuid, _>("id").unwrap_or_default();
        let payment = match load_payment_in_transaction(&mut transaction, payment_id).await {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Provider payment not found"),
            Err(error) => {
                tracing::error!(error = %error, payment_id = %payment_id, "load replayed provider payment");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if let Err(error) = transaction.commit().await {
            tracing::error!(error = %error, payment_id = %payment_id, "commit provider payment replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        return Json(json!({ "transaction": payment, "idempotent_replay": true })).into_response();
    }

    if context.status == "cancelled" || context.paid_by == "patient" {
        return err(StatusCode::CONFLICT, "External invoice is not payable by the company");
    }
    if !matches!(context.status.as_str(), "approved" | "overdue") {
        return err(StatusCode::CONFLICT, "External invoice is not approved for payment");
    }
    let account = match sqlx::query(
        r#"SELECT currency, opening_balance_on, is_active
           FROM company_financial_accounts
           WHERE id = $1
           FOR SHARE"#,
    )
    .bind(body.financial_account_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Financial account not found"),
        Err(error) => {
            tracing::error!(error = %error, "load provider payment financial account");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if account.try_get::<String, _>("currency").unwrap_or_default() != context.currency {
        return err(StatusCode::CONFLICT, "Financial account currency does not match");
    }
    if !account.try_get::<bool, _>("is_active").unwrap_or(false) {
        return err(StatusCode::CONFLICT, "Financial account is inactive");
    }
    let opening_on = account
        .try_get::<NaiveDate, _>("opening_balance_on")
        .unwrap_or(input.paid_on);
    if input.paid_on < opening_on {
        return err(StatusCode::CONFLICT, "Payment date precedes the account opening balance");
    }

    let already_paid = match current_company_paid(&mut transaction, external_invoice_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "sum provider payments");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if already_paid + input.amount_gross > context.amount_gross {
        return err(StatusCode::CONFLICT, "Provider payment exceeds the outstanding amount");
    }

    let payment_id = Uuid::new_v4();
    if let Err(error) = sqlx::query(
        r#"INSERT INTO external_invoice_provider_payment_transactions (
               id, external_invoice_id, financial_account_id, transaction_type,
               request_id, amount_gross, currency, paid_on, payment_method,
               reference, note, created_by
           ) VALUES ($1, $2, $3, 'payment', $4, $5, $6, $7, $8, $9, $10, $11)"#,
    )
    .bind(payment_id)
    .bind(external_invoice_id)
    .bind(body.financial_account_id)
    .bind(body.request_id)
    .bind(input.amount_gross)
    .bind(&context.currency)
    .bind(input.paid_on)
    .bind(&input.payment_method)
    .bind(input.reference.as_deref())
    .bind(input.note.as_deref())
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "insert provider payment");
        return err(StatusCode::CONFLICT, "Provider payment was rejected");
    }

    let amount_vat = if context.amount_gross == Decimal::ZERO {
        Decimal::ZERO
    } else {
        (input.amount_gross * context.amount_vat / context.amount_gross).round_dp(2)
    };
    let amount_net = input.amount_gross - amount_vat;
    if let Err(error) = sqlx::query(
        r#"INSERT INTO accounting_entries (
               entry_kind, direction, category, source_external_invoice_id,
               source_external_provider_payment_transaction_id,
               order_id, patient_id, entry_date, description,
               amount_net, amount_vat, amount_gross, currency, metadata,
               created_by, financial_account_id
           ) VALUES (
               'external_invoice_payment', 'expense', 'provider_expense', $1,
               $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
           )"#,
    )
    .bind(external_invoice_id)
    .bind(payment_id)
    .bind(context.order_id)
    .bind(context.patient_id)
    .bind(input.paid_on)
    .bind(format!("Provider payment {}", context.external_invoice_number))
    .bind(amount_net)
    .bind(amount_vat)
    .bind(input.amount_gross)
    .bind(&context.currency)
    .bind(json!({
        "external_invoice_number": context.external_invoice_number,
        "provider_payment_transaction_id": payment_id,
        "payment_method": input.payment_method,
        "payment_reference": input.reference,
    }))
    .bind(auth.user_id)
    .bind(body.financial_account_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::error!(error = %error, payment_id = %payment_id, "insert provider payment accounting entry");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_paid = (already_paid + input.amount_gross).round_dp(2);
    let base_status = context
        .provider_settlement_base_status
        .clone()
        .unwrap_or_else(|| context.status.clone());
    let update_result = if new_paid == context.amount_gross {
        sqlx::query(
            r#"UPDATE external_invoices
               SET provider_settlement_base_status = COALESCE(provider_settlement_base_status, $2),
                   status = 'paid', paid_by = 'agency',
                   paid_at = $3::date + TIME '12:00', updated_at = now()
               WHERE id = $1"#,
        )
        .bind(context.id)
        .bind(&base_status)
        .bind(input.paid_on)
        .execute(&mut *transaction)
        .await
    } else {
        sqlx::query(
            r#"UPDATE external_invoices
               SET provider_settlement_base_status = COALESCE(provider_settlement_base_status, $2),
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(context.id)
        .bind(&base_status)
        .execute(&mut *transaction)
        .await
    };
    if let Err(error) = update_result {
        tracing::error!(error = %error, payment_id = %payment_id, "update external invoice provider settlement");
        return err(StatusCode::CONFLICT, "Provider payment status update was rejected");
    }

    let payment = match load_payment_in_transaction(&mut transaction, payment_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Provider payment not found"),
        Err(error) => {
            tracing::error!(error = %error, payment_id = %payment_id, "load created provider payment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, payment_id = %payment_id, "commit provider payment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "create_provider_payment",
        Some(auth.user_id),
        "external_invoice",
        Some(external_invoice_id),
        json!({
            "provider_payment_transaction_id": payment_id,
            "financial_account_id": body.financial_account_id,
            "amount_gross": decimal_to_string(input.amount_gross),
            "currency": context.currency,
            "paid_on": input.paid_on.to_string(),
        }),
    ));

    Json(json!({ "transaction": payment, "idempotent_replay": false })).into_response()
}

async fn reverse_provider_payment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((external_invoice_id, payment_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ReverseProviderPaymentRequest>,
) -> axum::response::Response {
    if !can_manage_provider_settlements(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let paid_on = match parse_date(&body.paid_on, "paid_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if paid_on > Utc::now().date_naive() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Reversal date cannot be in the future");
    }
    let note = match clean_optional(body.note.as_deref(), 1_000) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(error) => {
            tracing::error!(error = %error, "begin provider payment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let context = match load_external_invoice_for_update(&mut transaction, external_invoice_id).await {
        Ok(Some(context)) => context,
        Ok(None) => return err(StatusCode::NOT_FOUND, "External invoice not found"),
        Err(error) => {
            tracing::error!(error = %error, "lock provider payment reversal invoice");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let replay = match sqlx::query(
        r#"SELECT id, reverses_transaction_id, transaction_type, paid_on, note, created_by
           FROM external_invoice_provider_payment_transactions
           WHERE external_invoice_id = $1 AND request_id = $2"#,
    )
    .bind(external_invoice_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "load provider payment reversal replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Some(replay) = replay {
        let replay_note = replay
            .try_get::<Option<String>, _>("note")
            .ok()
            .flatten();
        let matches = replay.try_get::<String, _>("transaction_type").ok().as_deref() == Some("reversal")
            && replay.try_get::<Option<Uuid>, _>("reverses_transaction_id").ok().flatten() == Some(payment_id)
            && replay.try_get::<NaiveDate, _>("paid_on").ok() == Some(paid_on)
            && replay_note.as_deref() == note.as_deref()
            && replay.try_get::<Uuid, _>("created_by").ok() == Some(auth.user_id);
        if !matches {
            return err(StatusCode::CONFLICT, "request_id was already used with different data");
        }
        let reversal_id = replay.try_get::<Uuid, _>("id").unwrap_or_default();
        let value = match load_payment_in_transaction(&mut transaction, reversal_id).await {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Provider payment reversal not found"),
            Err(error) => {
                tracing::error!(error = %error, reversal_id = %reversal_id, "load replayed provider payment reversal");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if let Err(error) = transaction.commit().await {
            tracing::error!(error = %error, reversal_id = %reversal_id, "commit provider payment reversal replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        return Json(json!({ "transaction": value, "idempotent_replay": true })).into_response();
    }

    let original = match sqlx::query(
        r#"SELECT id, financial_account_id, amount_gross, currency, paid_on,
                  payment_method, reference
           FROM external_invoice_provider_payment_transactions
           WHERE id = $1 AND external_invoice_id = $2 AND transaction_type = 'payment'
           FOR UPDATE"#,
    )
    .bind(payment_id)
    .bind(external_invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Provider payment not found"),
        Err(error) => {
            tracing::error!(error = %error, payment_id = %payment_id, "lock provider payment for reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let original_paid_on = original
        .try_get::<NaiveDate, _>("paid_on")
        .unwrap_or(paid_on);
    if paid_on < original_paid_on {
        return err(StatusCode::CONFLICT, "Reversal cannot precede the original payment");
    }
    let existing_reversal = match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id
           FROM external_invoice_provider_payment_transactions
           WHERE reverses_transaction_id = $1 AND transaction_type = 'reversal'"#,
    )
    .bind(payment_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, payment_id = %payment_id, "check provider payment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if existing_reversal.is_some() {
        return err(StatusCode::CONFLICT, "Provider payment was already reversed");
    }

    let amount_gross = original
        .try_get::<Decimal, _>("amount_gross")
        .unwrap_or(Decimal::ZERO);
    let financial_account_id = original
        .try_get::<Uuid, _>("financial_account_id")
        .unwrap_or_default();
    let payment_method = original
        .try_get::<String, _>("payment_method")
        .unwrap_or_else(|_| "other".to_string());
    let reference = original
        .try_get::<Option<String>, _>("reference")
        .unwrap_or_default();
    let reversal_id = Uuid::new_v4();
    if let Err(error) = sqlx::query(
        r#"INSERT INTO external_invoice_provider_payment_transactions (
               id, external_invoice_id, financial_account_id, transaction_type,
               request_id, reverses_transaction_id, amount_gross, currency,
               paid_on, payment_method, reference, note, created_by
           ) VALUES ($1, $2, $3, 'reversal', $4, $5, $6, $7, $8, $9, $10, $11, $12)"#,
    )
    .bind(reversal_id)
    .bind(external_invoice_id)
    .bind(financial_account_id)
    .bind(body.request_id)
    .bind(payment_id)
    .bind(amount_gross)
    .bind(&context.currency)
    .bind(paid_on)
    .bind(&payment_method)
    .bind(reference.as_deref())
    .bind(note.as_deref())
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::warn!(error = %error, payment_id = %payment_id, "insert provider payment reversal rejected");
        return err(StatusCode::CONFLICT, "Provider payment reversal was rejected");
    }

    let amount_vat = if context.amount_gross == Decimal::ZERO {
        Decimal::ZERO
    } else {
        (amount_gross * context.amount_vat / context.amount_gross).round_dp(2)
    };
    let amount_net = amount_gross - amount_vat;
    if let Err(error) = sqlx::query(
        r#"INSERT INTO accounting_entries (
               entry_kind, direction, category, source_external_invoice_id,
               source_external_provider_payment_transaction_id,
               order_id, patient_id, entry_date, description,
               amount_net, amount_vat, amount_gross, currency, metadata,
               created_by, financial_account_id
           ) VALUES (
               'external_invoice_payment', 'expense', 'provider_expense', $1,
               $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
           )"#,
    )
    .bind(external_invoice_id)
    .bind(reversal_id)
    .bind(context.order_id)
    .bind(context.patient_id)
    .bind(paid_on)
    .bind(format!("Provider payment reversal {}", context.external_invoice_number))
    .bind(-amount_net)
    .bind(-amount_vat)
    .bind(-amount_gross)
    .bind(&context.currency)
    .bind(json!({
        "external_invoice_number": context.external_invoice_number,
        "provider_payment_transaction_id": reversal_id,
        "reverses_provider_payment_transaction_id": payment_id,
        "payment_method": payment_method,
        "payment_reference": reference,
    }))
    .bind(auth.user_id)
    .bind(financial_account_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::error!(error = %error, reversal_id = %reversal_id, "insert provider reversal accounting entry");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let remaining_paid = match current_company_paid(&mut transaction, external_invoice_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "sum provider payments after reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if context.status == "paid" && context.paid_by == "agency" && remaining_paid < context.amount_gross {
        let restore_status = if context
            .due_date
            .is_some_and(|date| date < Utc::now().date_naive())
        {
            "overdue".to_string()
        } else {
            context
                .provider_settlement_base_status
                .unwrap_or_else(|| "approved".to_string())
        };
        if let Err(error) = sqlx::query(
            r#"UPDATE external_invoices
               SET status = $2, paid_by = 'unpaid', paid_at = NULL, updated_at = now()
               WHERE id = $1"#,
        )
        .bind(external_invoice_id)
        .bind(restore_status)
        .execute(&mut *transaction)
        .await
        {
            tracing::error!(error = %error, reversal_id = %reversal_id, "restore external invoice after provider payment reversal");
            return err(StatusCode::CONFLICT, "Provider payment reversal status update was rejected");
        }
    }

    let value = match load_payment_in_transaction(&mut transaction, reversal_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Provider payment reversal not found"),
        Err(error) => {
            tracing::error!(error = %error, reversal_id = %reversal_id, "load provider payment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, reversal_id = %reversal_id, "commit provider payment reversal");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "reverse_provider_payment",
        Some(auth.user_id),
        "external_invoice",
        Some(external_invoice_id),
        json!({
            "provider_payment_reversal_id": reversal_id,
            "reverses_provider_payment_id": payment_id,
            "amount_gross": decimal_to_string(amount_gross),
            "currency": context.currency,
            "paid_on": paid_on.to_string(),
        }),
    ));

    Json(json!({ "transaction": value, "idempotent_replay": false })).into_response()
}
