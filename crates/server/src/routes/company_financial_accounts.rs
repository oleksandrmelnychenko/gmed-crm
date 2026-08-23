use std::str::FromStr;

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/company-financial-accounts",
            get(list_company_financial_accounts).post(create_company_financial_account),
        )
        .route(
            "/company-financial-accounts/{account_id}",
            post(update_company_financial_account),
        )
        .route(
            "/company-financial-accounts/{account_id}/adjustments",
            post(create_company_financial_account_adjustment),
        )
        .route(
            "/company-financial-accounts/{account_id}/adjustments/{adjustment_id}/reversal",
            post(reverse_company_financial_account_adjustment),
        )
        .route(
            "/accounting-entries/{entry_id}/financial-account",
            post(assign_accounting_entry_financial_account),
        )
}

#[derive(Deserialize)]
struct AccountListQuery {
    currency: Option<String>,
    include_inactive: Option<bool>,
}

#[derive(Deserialize)]
struct CreateAccountRequest {
    name: String,
    account_type: String,
    currency: String,
    iban: Option<String>,
    opening_balance: String,
    opening_balance_on: String,
    is_default: Option<bool>,
}

#[derive(Deserialize)]
struct UpdateAccountRequest {
    name: Option<String>,
    iban: Option<String>,
    is_default: Option<bool>,
    is_active: Option<bool>,
}

#[derive(Deserialize)]
struct CreateAdjustmentRequest {
    request_id: Uuid,
    direction: String,
    amount: String,
    effective_on: String,
    reason: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct ReverseAdjustmentRequest {
    request_id: Uuid,
    effective_on: String,
    reason: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct AssignEntryAccountRequest {
    financial_account_id: Uuid,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn can_manage_company_accounts(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn parse_currency(value: &str) -> Result<String, &'static str> {
    let currency = value.trim().to_uppercase();
    if currency.len() != 3
        || !currency
            .chars()
            .all(|character| character.is_ascii_uppercase())
    {
        return Err("Invalid currency; expected a three-letter ISO code");
    }
    Ok(currency)
}

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| format!("Invalid {field}; expected YYYY-MM-DD"))
}

fn parse_amount(value: &str, positive_only: bool) -> Result<Decimal, &'static str> {
    let amount = Decimal::from_str(value.trim())
        .map_err(|_| "Invalid amount")?
        .round_dp(2);
    if positive_only && amount <= Decimal::ZERO {
        return Err("Amount must be greater than zero");
    }
    Ok(amount)
}

fn clean_required(value: &str, max: usize, message: &'static str) -> Result<String, &'static str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(message);
    }
    Ok(value.to_string())
}

fn clean_optional(value: Option<&str>, max: usize) -> Result<Option<String>, &'static str> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.chars().count() > max) {
        return Err("Value is too long");
    }
    Ok(value.map(str::to_string))
}

fn account_type_is_valid(value: &str) -> bool {
    matches!(value, "bank" | "cash" | "card" | "other")
}

fn account_row_payload(row: &sqlx::postgres::PgRow) -> Value {
    let opening_balance = row
        .try_get::<Decimal, _>("opening_balance")
        .unwrap_or(Decimal::ZERO);
    let movement_balance = row
        .try_get::<Decimal, _>("movement_balance")
        .unwrap_or(Decimal::ZERO);
    let adjustment_balance = row
        .try_get::<Decimal, _>("adjustment_balance")
        .unwrap_or(Decimal::ZERO);
    let transfer_balance = row
        .try_get::<Decimal, _>("transfer_balance")
        .unwrap_or(Decimal::ZERO);
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "name": row.try_get::<String, _>("name").unwrap_or_default(),
        "account_type": row.try_get::<String, _>("account_type").unwrap_or_default(),
        "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
        "iban": row.try_get::<Option<String>, _>("iban").unwrap_or_default(),
        "opening_balance": decimal_to_string(opening_balance),
        "opening_balance_on": row.try_get::<NaiveDate, _>("opening_balance_on").map(|date| date.to_string()).unwrap_or_default(),
        "movement_balance": decimal_to_string(movement_balance),
        "adjustment_balance": decimal_to_string(adjustment_balance),
        "transfer_balance": decimal_to_string(transfer_balance),
        "current_balance": decimal_to_string(opening_balance + movement_balance + adjustment_balance + transfer_balance),
        "movement_count": row.try_get::<i64, _>("movement_count").unwrap_or(0),
        "transfer_count": row.try_get::<i64, _>("transfer_count").unwrap_or(0),
        "latest_movement_on": row.try_get::<Option<NaiveDate>, _>("latest_movement_on").unwrap_or_default().map(|date| date.to_string()),
        "is_default": row.try_get::<bool, _>("is_default").unwrap_or(false),
        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
        "created_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<chrono::DateTime<Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn adjustment_row_payload(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "financial_account_id": row.try_get::<Uuid, _>("financial_account_id").unwrap_or_default(),
        "account_name": row.try_get::<String, _>("account_name").unwrap_or_default(),
        "transaction_type": row.try_get::<String, _>("transaction_type").unwrap_or_default(),
        "reverses_adjustment_id": row.try_get::<Option<Uuid>, _>("reverses_adjustment_id").unwrap_or_default(),
        "direction": row.try_get::<String, _>("direction").unwrap_or_default(),
        "amount": decimal_to_string(row.try_get::<Decimal, _>("amount").unwrap_or(Decimal::ZERO)),
        "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
        "effective_on": row.try_get::<NaiveDate, _>("effective_on").map(|date| date.to_string()).unwrap_or_default(),
        "reason": row.try_get::<String, _>("reason").unwrap_or_default(),
        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
        "created_by": row.try_get::<Uuid, _>("created_by").unwrap_or_default(),
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn transfer_row_payload(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "transaction_type": row.try_get::<String, _>("transaction_type").unwrap_or_default(),
        "reverses_transfer_id": row.try_get::<Option<Uuid>, _>("reverses_transfer_id").unwrap_or_default(),
        "source_account_id": row.try_get::<Uuid, _>("source_account_id").unwrap_or_default(),
        "source_account_name": row.try_get::<String, _>("source_account_name").unwrap_or_default(),
        "target_account_id": row.try_get::<Uuid, _>("target_account_id").unwrap_or_default(),
        "target_account_name": row.try_get::<String, _>("target_account_name").unwrap_or_default(),
        "amount": decimal_to_string(row.try_get::<Decimal, _>("amount").unwrap_or(Decimal::ZERO)),
        "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
        "effective_on": row.try_get::<NaiveDate, _>("effective_on").map(|date| date.to_string()).unwrap_or_default(),
        "reference": row.try_get::<Option<String>, _>("reference").unwrap_or_default(),
        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
        "created_by": row.try_get::<Uuid, _>("created_by").unwrap_or_default(),
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

async fn list_company_financial_accounts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<AccountListQuery>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let requested_currency = match query.currency.as_deref() {
        Some(value) => match parse_currency(value) {
            Ok(currency) => Some(currency),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => None,
    };

    let available_currencies = match sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT currency FROM company_financial_accounts ORDER BY currency",
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "load company financial account currencies");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load financial accounts",
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

    let account_rows = match sqlx::query(
        r#"SELECT account.id, account.name, account.account_type, account.currency,
                  account.iban, account.opening_balance, account.opening_balance_on,
                  account.is_default, account.is_active, account.created_at, account.updated_at,
                  COALESCE((
                      SELECT SUM(CASE WHEN entry.direction = 'income'
                                      THEN entry.amount_gross ELSE -entry.amount_gross END)
                      FROM accounting_entries entry
                      WHERE entry.financial_account_id = account.id
                        AND entry.entry_date >= account.opening_balance_on
                        AND entry.entry_date <= CURRENT_DATE
                  ), 0) AS movement_balance,
                  COALESCE((
                      SELECT SUM(CASE WHEN adjustment.direction = 'inflow'
                                      THEN adjustment.amount ELSE -adjustment.amount END)
                      FROM company_financial_account_adjustments adjustment
                      WHERE adjustment.financial_account_id = account.id
                        AND adjustment.effective_on >= account.opening_balance_on
                        AND adjustment.effective_on <= CURRENT_DATE
                  ), 0) AS adjustment_balance,
                  COALESCE((
                      SELECT SUM(CASE WHEN transfer.source_account_id = account.id
                                      THEN -transfer.amount ELSE transfer.amount END)
                      FROM company_financial_account_transfers transfer
                      WHERE (transfer.source_account_id = account.id
                             OR transfer.target_account_id = account.id)
                        AND transfer.effective_on >= account.opening_balance_on
                        AND transfer.effective_on <= CURRENT_DATE
                  ), 0) AS transfer_balance,
                  (SELECT COUNT(*) FROM accounting_entries entry
                   WHERE entry.financial_account_id = account.id
                     AND entry.entry_date >= account.opening_balance_on
                     AND entry.entry_date <= CURRENT_DATE)::bigint AS movement_count,
                  (SELECT COUNT(*) FROM company_financial_account_transfers transfer
                   WHERE (transfer.source_account_id = account.id
                          OR transfer.target_account_id = account.id)
                     AND transfer.effective_on >= account.opening_balance_on
                     AND transfer.effective_on <= CURRENT_DATE)::bigint AS transfer_count,
                  GREATEST(
                      (SELECT MAX(entry.entry_date) FROM accounting_entries entry
                       WHERE entry.financial_account_id = account.id),
                      (SELECT MAX(adjustment.effective_on)
                       FROM company_financial_account_adjustments adjustment
                       WHERE adjustment.financial_account_id = account.id),
                      (SELECT MAX(transfer.effective_on)
                       FROM company_financial_account_transfers transfer
                       WHERE transfer.source_account_id = account.id
                          OR transfer.target_account_id = account.id)
                  ) AS latest_movement_on
           FROM company_financial_accounts account
           WHERE account.currency = $1
             AND ($2 OR account.is_active)
           ORDER BY account.is_default DESC, account.is_active DESC, lower(account.name)"#,
    )
    .bind(&currency)
    .bind(query.include_inactive.unwrap_or(false))
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load company financial accounts");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load financial accounts",
            );
        }
    };

    let adjustment_rows = match sqlx::query(
        r#"SELECT adjustment.id, adjustment.financial_account_id,
                  account.name AS account_name, account.currency,
                  adjustment.transaction_type, adjustment.reverses_adjustment_id,
                  adjustment.direction, adjustment.amount, adjustment.effective_on,
                  adjustment.reason, adjustment.note, adjustment.created_by,
                  users.name AS created_by_name, adjustment.created_at
           FROM company_financial_account_adjustments adjustment
           JOIN company_financial_accounts account ON account.id = adjustment.financial_account_id
           JOIN users ON users.id = adjustment.created_by
           WHERE account.currency = $1
           ORDER BY adjustment.effective_on DESC, adjustment.created_at DESC
           LIMIT 250"#,
    )
    .bind(&currency)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load company account adjustments");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load financial accounts",
            );
        }
    };

    let transfer_rows = match sqlx::query(
        r#"SELECT transfer.id, transfer.transaction_type,
                  transfer.reverses_transfer_id,
                  transfer.source_account_id, source.name AS source_account_name,
                  transfer.target_account_id, target.name AS target_account_name,
                  transfer.amount, transfer.currency, transfer.effective_on,
                  transfer.reference, transfer.note, transfer.created_by,
                  users.name AS created_by_name, transfer.created_at
           FROM company_financial_account_transfers transfer
           JOIN company_financial_accounts source ON source.id = transfer.source_account_id
           JOIN company_financial_accounts target ON target.id = transfer.target_account_id
           JOIN users ON users.id = transfer.created_by
           WHERE transfer.currency = $1
           ORDER BY transfer.effective_on DESC, transfer.created_at DESC
           LIMIT 250"#,
    )
    .bind(&currency)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load company account transfers");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load financial accounts",
            );
        }
    };

    let unassigned = match sqlx::query(
        r#"SELECT COUNT(*)::bigint AS movement_count,
                  COALESCE(SUM(CASE WHEN direction = 'income'
                                    THEN amount_gross ELSE -amount_gross END), 0) AS signed_amount
           FROM accounting_entries
           WHERE financial_account_id IS NULL
             AND UPPER(currency) = $1"#,
    )
    .bind(&currency)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "load unassigned company cash movements");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load financial accounts",
            );
        }
    };

    Json(json!({
        "currency": currency,
        "available_currencies": available_currencies,
        "items": account_rows.iter().map(account_row_payload).collect::<Vec<_>>(),
        "adjustments": adjustment_rows.iter().map(adjustment_row_payload).collect::<Vec<_>>(),
        "transfers": transfer_rows.iter().map(transfer_row_payload).collect::<Vec<_>>(),
        "unassigned_movement_count": unassigned.try_get::<i64, _>("movement_count").unwrap_or(0),
        "unassigned_signed_amount": decimal_to_string(unassigned.try_get::<Decimal, _>("signed_amount").unwrap_or(Decimal::ZERO)),
        "generated_at": Utc::now().to_rfc3339(),
    }))
    .into_response()
}

async fn create_company_financial_account(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateAccountRequest>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let name = match clean_required(&body.name, 120, "Account name is required") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let account_type = body.account_type.trim().to_lowercase();
    if !account_type_is_valid(&account_type) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid account type");
    }
    let currency = match parse_currency(&body.currency) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let iban = match clean_optional(body.iban.as_deref(), 64) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let opening_balance = match parse_amount(&body.opening_balance, false) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let opening_balance_on = match parse_date(&body.opening_balance_on, "opening_balance_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if opening_balance_on > Utc::now().date_naive() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Opening balance date cannot be in the future",
        );
    }
    let requested_default = body.is_default.unwrap_or(false);

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin create company financial account");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create financial account",
            );
        }
    };
    if let Err(error) = sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&currency)
        .execute(&mut *transaction)
        .await
    {
        tracing::error!(error = %error, currency = %currency, "lock company financial account currency");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create financial account",
        );
    }
    let has_default = match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM company_financial_accounts WHERE currency = $1 AND is_default)",
    )
    .bind(&currency)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, currency = %currency, "check default company financial account");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create financial account");
        }
    };
    let is_default = requested_default || !has_default;
    if is_default
        && let Err(error) = sqlx::query(
            "UPDATE company_financial_accounts SET is_default = false WHERE currency = $1 AND is_default",
        )
        .bind(&currency)
        .execute(&mut *transaction)
        .await
    {
        tracing::error!(error = %error, "clear default company financial account");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create financial account");
    }
    let account_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO company_financial_accounts (
               name, account_type, currency, iban, opening_balance,
               opening_balance_on, is_default, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
    )
    .bind(&name)
    .bind(&account_type)
    .bind(&currency)
    .bind(&iban)
    .bind(opening_balance)
    .bind(opening_balance_on)
    .bind(is_default)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error, "create company financial account rejected");
            return err(
                StatusCode::CONFLICT,
                "Financial account already exists or is invalid",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, "commit company financial account");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create financial account",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "company_financial_account.create".to_string(),
        Some(auth.user_id),
        "company_financial_account",
        Some(account_id),
        json!({ "name": name, "account_type": account_type, "currency": currency, "is_default": is_default }),
    ));
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "company_financial_account.created",
        "company_financial_account",
        account_id,
        json!({ "currency": currency }),
    )
    .await;
    (StatusCode::CREATED, Json(json!({ "id": account_id }))).into_response()
}

async fn update_company_financial_account(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(account_id): Path<Uuid>,
    Json(body): Json<UpdateAccountRequest>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let name = match body.name.as_deref() {
        Some(value) => match clean_required(value, 120, "Account name is required") {
            Ok(value) => Some(value),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => None,
    };
    let iban = match body.iban.as_deref() {
        Some(value) if value.trim().is_empty() => Some(String::new()),
        Some(value) => match clean_optional(Some(value), 64) {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => None,
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin update company financial account");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update financial account",
            );
        }
    };
    let current = match sqlx::query(
        "SELECT currency, is_default, is_active FROM company_financial_accounts WHERE id = $1 FOR UPDATE",
    )
    .bind(account_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Financial account not found"),
        Err(error) => {
            tracing::error!(error = %error, account_id = %account_id, "load company financial account");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update financial account");
        }
    };
    let currency = current.try_get::<String, _>("currency").unwrap_or_default();
    let current_default = current.try_get::<bool, _>("is_default").unwrap_or(false);
    let current_active = current.try_get::<bool, _>("is_active").unwrap_or(false);
    let target_default = body.is_default.unwrap_or(current_default);
    let target_active = body.is_active.unwrap_or(current_active);
    if current_default && body.is_default == Some(false) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Choose another default account instead of removing the current default",
        );
    }
    if target_default && !target_active {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Default account must remain active",
        );
    }
    if target_default
        && let Err(error) = sqlx::query(
            "UPDATE company_financial_accounts SET is_default = false WHERE currency = $1 AND id <> $2 AND is_default",
        )
        .bind(&currency)
        .bind(account_id)
        .execute(&mut *transaction)
        .await
    {
        tracing::error!(error = %error, account_id = %account_id, "replace default company financial account");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update financial account");
    }
    let updated = sqlx::query(
        r#"UPDATE company_financial_accounts
           SET name = COALESCE($2, name),
               iban = CASE WHEN $3::text IS NULL THEN iban ELSE NULLIF($3, '') END,
               is_default = COALESCE($4, is_default),
               is_active = COALESCE($5, is_active)
           WHERE id = $1
           RETURNING id"#,
    )
    .bind(account_id)
    .bind(name.as_deref())
    .bind(iban.as_deref())
    .bind(body.is_default)
    .bind(body.is_active)
    .fetch_optional(&mut *transaction)
    .await;
    match updated {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Financial account not found"),
        Err(error) => {
            tracing::warn!(error = %error, account_id = %account_id, "update company financial account rejected");
            return err(
                StatusCode::CONFLICT,
                "Financial account update conflicts with existing data",
            );
        }
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, account_id = %account_id, "commit company financial account update");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update financial account",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "company_financial_account.update".to_string(),
        Some(auth.user_id),
        "company_financial_account",
        Some(account_id),
        json!({ "is_default": body.is_default, "is_active": body.is_active }),
    ));
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "company_financial_account.updated",
        "company_financial_account",
        account_id,
        json!({ "is_default": body.is_default, "is_active": body.is_active }),
    )
    .await;
    Json(json!({ "id": account_id })).into_response()
}

async fn create_company_financial_account_adjustment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(account_id): Path<Uuid>,
    Json(body): Json<CreateAdjustmentRequest>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let direction = body.direction.trim().to_lowercase();
    if !matches!(direction.as_str(), "inflow" | "outflow") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid adjustment direction",
        );
    }
    let amount = match parse_amount(&body.amount, true) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let effective_on = match parse_date(&body.effective_on, "effective_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if effective_on > Utc::now().date_naive() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Adjustment date cannot be in the future",
        );
    }
    let reason = match clean_required(&body.reason, 500, "Adjustment reason is required") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let note = match clean_optional(body.note.as_deref(), 2000) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin company account adjustment");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record account adjustment",
            );
        }
    };
    if let Err(error) = sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))",
    )
    .bind(account_id)
    .bind(body.request_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::error!(error = %error, account_id = %account_id, "lock account adjustment request");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to record account adjustment",
        );
    }
    let replay = sqlx::query(
        r#"SELECT id, direction, amount, effective_on, reason, note
           FROM company_financial_account_adjustments
           WHERE financial_account_id = $1 AND request_id = $2
           FOR UPDATE"#,
    )
    .bind(account_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await;
    match replay {
        Ok(Some(row)) => {
            let exact = row.try_get::<String, _>("direction").ok().as_deref()
                == Some(direction.as_str())
                && row.try_get::<Decimal, _>("amount").ok() == Some(amount)
                && row.try_get::<NaiveDate, _>("effective_on").ok() == Some(effective_on)
                && row.try_get::<String, _>("reason").ok().as_deref() == Some(reason.as_str())
                && row.try_get::<Option<String>, _>("note").ok().flatten() == note;
            if !exact {
                return err(
                    StatusCode::CONFLICT,
                    "request_id was already used with different adjustment data",
                );
            }
            return Json(json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "idempotent_replay": true,
            }))
            .into_response();
        }
        Ok(None) => {}
        Err(error) => {
            tracing::error!(error = %error, account_id = %account_id, "load account adjustment replay");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record account adjustment",
            );
        }
    }
    let adjustment_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO company_financial_account_adjustments (
               financial_account_id, transaction_type, request_id, direction,
               amount, effective_on, reason, note, created_by
           ) VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
    )
    .bind(account_id)
    .bind(body.request_id)
    .bind(&direction)
    .bind(amount)
    .bind(effective_on)
    .bind(&reason)
    .bind(&note)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error, account_id = %account_id, "create company account adjustment rejected");
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Account adjustment is invalid",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, account_id = %account_id, "commit company account adjustment");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to record account adjustment",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "company_financial_account.adjustment.create".to_string(),
        Some(auth.user_id),
        "company_financial_account_adjustment",
        Some(adjustment_id),
        json!({ "financial_account_id": account_id, "direction": direction, "amount": decimal_to_string(amount) }),
    ));
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "company_financial_account.adjustment_created",
        "company_financial_account_adjustment",
        adjustment_id,
        json!({ "financial_account_id": account_id, "direction": direction, "amount": decimal_to_string(amount) }),
    )
    .await;
    (
        StatusCode::CREATED,
        Json(json!({ "id": adjustment_id, "idempotent_replay": false })),
    )
        .into_response()
}

async fn reverse_company_financial_account_adjustment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((account_id, adjustment_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ReverseAdjustmentRequest>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let effective_on = match parse_date(&body.effective_on, "effective_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if effective_on > Utc::now().date_naive() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reversal date cannot be in the future",
        );
    }
    let reason = match clean_required(&body.reason, 500, "Reversal reason is required") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let note = match clean_optional(body.note.as_deref(), 2000) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin company account adjustment reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse account adjustment",
            );
        }
    };
    if let Err(error) = sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))",
    )
    .bind(account_id)
    .bind(body.request_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::error!(error = %error, account_id = %account_id, "lock account adjustment reversal request");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to reverse account adjustment",
        );
    }
    let replay = match sqlx::query(
        r#"SELECT id, reverses_adjustment_id, effective_on, reason, note
           FROM company_financial_account_adjustments
           WHERE financial_account_id = $1 AND request_id = $2
           FOR UPDATE"#,
    )
    .bind(account_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, account_id = %account_id, "load account adjustment reversal replay");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse account adjustment",
            );
        }
    };
    if let Some(row) = replay {
        let exact = row
            .try_get::<Option<Uuid>, _>("reverses_adjustment_id")
            .ok()
            .flatten()
            == Some(adjustment_id)
            && row.try_get::<NaiveDate, _>("effective_on").ok() == Some(effective_on)
            && row.try_get::<String, _>("reason").ok().as_deref() == Some(reason.as_str())
            && row.try_get::<Option<String>, _>("note").ok().flatten() == note;
        if !exact {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different reversal data",
            );
        }
        return Json(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "idempotent_replay": true,
        }))
        .into_response();
    }
    let original = match sqlx::query(
        r#"SELECT direction, amount
           FROM company_financial_account_adjustments
           WHERE id = $1 AND financial_account_id = $2
             AND transaction_type = 'adjustment'
           FOR UPDATE"#,
    )
    .bind(adjustment_id)
    .bind(account_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Account adjustment not found"),
        Err(error) => {
            tracing::error!(error = %error, adjustment_id = %adjustment_id, "load account adjustment for reversal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reverse account adjustment",
            );
        }
    };
    let original_direction = original
        .try_get::<String, _>("direction")
        .unwrap_or_default();
    let direction = if original_direction == "inflow" {
        "outflow"
    } else {
        "inflow"
    };
    let amount = original
        .try_get::<Decimal, _>("amount")
        .unwrap_or(Decimal::ZERO);
    let reversal_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO company_financial_account_adjustments (
               financial_account_id, transaction_type, request_id,
               reverses_adjustment_id, direction, amount, effective_on,
               reason, note, created_by
           ) VALUES ($1, 'reversal', $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
    )
    .bind(account_id)
    .bind(body.request_id)
    .bind(adjustment_id)
    .bind(direction)
    .bind(amount)
    .bind(effective_on)
    .bind(&reason)
    .bind(&note)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error, adjustment_id = %adjustment_id, "reverse company account adjustment rejected");
            return err(
                StatusCode::CONFLICT,
                "Account adjustment cannot be reversed",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, reversal_id = %reversal_id, "commit company account adjustment reversal");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to reverse account adjustment",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "company_financial_account.adjustment.reverse".to_string(),
        Some(auth.user_id),
        "company_financial_account_adjustment",
        Some(reversal_id),
        json!({ "financial_account_id": account_id, "reverses_adjustment_id": adjustment_id }),
    ));
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "company_financial_account.adjustment_reversed",
        "company_financial_account_adjustment",
        reversal_id,
        json!({ "financial_account_id": account_id, "reverses_adjustment_id": adjustment_id }),
    )
    .await;
    Json(json!({ "id": reversal_id, "idempotent_replay": false })).into_response()
}

async fn assign_accounting_entry_financial_account(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<AssignEntryAccountRequest>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin accounting entry account assignment");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to assign financial account",
            );
        }
    };
    let entry = match sqlx::query(
        r#"SELECT currency, financial_account_id,
                  source_invoice_payment_transaction_id,
                  source_invoice_refund_transaction_id
           FROM accounting_entries
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(entry_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Accounting entry not found"),
        Err(error) => {
            tracing::error!(error = %error, entry_id = %entry_id, "load accounting entry for account assignment");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to assign financial account",
            );
        }
    };
    let currency = entry
        .try_get::<String, _>("currency")
        .unwrap_or_default()
        .to_uppercase();
    let target = match sqlx::query(
        "SELECT currency, is_active FROM company_financial_accounts WHERE id = $1 FOR SHARE",
    )
    .bind(body.financial_account_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Financial account not found"),
        Err(error) => {
            tracing::error!(error = %error, "load financial account for assignment");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to assign financial account",
            );
        }
    };
    if target.try_get::<String, _>("currency").unwrap_or_default() != currency
        || !target.try_get::<bool, _>("is_active").unwrap_or(false)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Financial account must be active and use the movement currency",
        );
    }
    if entry
        .try_get::<Option<Uuid>, _>("financial_account_id")
        .unwrap_or_default()
        == Some(body.financial_account_id)
    {
        return Json(json!({ "updated_count": 0, "idempotent_replay": true })).into_response();
    }
    let payment_transaction_id = entry
        .try_get::<Option<Uuid>, _>("source_invoice_payment_transaction_id")
        .unwrap_or_default();
    let refund_transaction_id = entry
        .try_get::<Option<Uuid>, _>("source_invoice_refund_transaction_id")
        .unwrap_or_default();
    let updated_count = match sqlx::query(
        r#"UPDATE accounting_entries
           SET financial_account_id = $1
           WHERE id = $2
              OR ($3::uuid IS NOT NULL AND source_invoice_payment_transaction_id = $3)
              OR ($4::uuid IS NOT NULL AND source_invoice_refund_transaction_id = $4)"#,
    )
    .bind(body.financial_account_id)
    .bind(entry_id)
    .bind(payment_transaction_id)
    .bind(refund_transaction_id)
    .execute(&mut *transaction)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(error) => {
            tracing::error!(error = %error, entry_id = %entry_id, "assign accounting entry financial account");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to assign financial account",
            );
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, entry_id = %entry_id, "commit accounting entry financial account assignment");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to assign financial account",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "accounting_entry.financial_account.assign".to_string(),
        Some(auth.user_id),
        "accounting_entry",
        Some(entry_id),
        json!({ "financial_account_id": body.financial_account_id, "updated_count": updated_count }),
    ));
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "accounting_entry.financial_account_assigned",
        "accounting_entry",
        entry_id,
        json!({ "financial_account_id": body.financial_account_id, "updated_count": updated_count }),
    )
    .await;
    Json(json!({ "updated_count": updated_count, "idempotent_replay": false })).into_response()
}
