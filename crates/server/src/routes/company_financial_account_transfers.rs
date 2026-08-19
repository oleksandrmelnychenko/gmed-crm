use std::str::FromStr;

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
};
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/company-financial-account-transfers",
            post(create_company_financial_account_transfer),
        )
        .route(
            "/company-financial-account-transfers/{transfer_id}/reversal",
            post(reverse_company_financial_account_transfer),
        )
}

#[derive(Deserialize)]
struct CreateTransferRequest {
    request_id: Uuid,
    source_account_id: Uuid,
    target_account_id: Uuid,
    amount: String,
    effective_on: String,
    reference: Option<String>,
    note: Option<String>,
}

#[derive(Deserialize)]
struct ReverseTransferRequest {
    request_id: Uuid,
    effective_on: String,
    reference: String,
    note: Option<String>,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn can_manage_company_accounts(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn parse_amount(value: &str) -> Result<Decimal, &'static str> {
    let amount = Decimal::from_str(value.trim())
        .map_err(|_| "Invalid amount")?
        .round_dp(2);
    if amount <= Decimal::ZERO {
        return Err("Amount must be greater than zero");
    }
    Ok(amount)
}

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| format!("Invalid {field}; expected YYYY-MM-DD"))
}

fn clean_optional(value: Option<&str>, max: usize) -> Result<Option<String>, &'static str> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.chars().count() > max) {
        return Err("Value is too long");
    }
    Ok(value.map(str::to_string))
}

fn clean_required(value: &str, max: usize, message: &'static str) -> Result<String, &'static str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(message);
    }
    Ok(value.to_string())
}

async fn lock_request(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(request_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn create_company_financial_account_transfer(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateTransferRequest>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if body.source_account_id == body.target_account_id {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Source and target accounts must differ");
    }
    let amount = match parse_amount(&body.amount) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let effective_on = match parse_date(&body.effective_on, "effective_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if effective_on > Utc::now().date_naive() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Transfer date cannot be in the future");
    }
    let reference = match clean_optional(body.reference.as_deref(), 120) {
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
            tracing::error!(error = %error, "begin company account transfer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record internal transfer");
        }
    };
    if let Err(error) = lock_request(&mut transaction, body.request_id).await {
        tracing::error!(error = %error, "lock company account transfer request");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record internal transfer");
    }

    let replay = match sqlx::query(
        r#"SELECT id, transaction_type, source_account_id, target_account_id,
                  amount, effective_on, reference, note
           FROM company_financial_account_transfers
           WHERE request_id = $1
           FOR UPDATE"#,
    )
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "load company account transfer replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record internal transfer");
        }
    };
    if let Some(row) = replay {
        let exact = row.try_get::<String, _>("transaction_type").ok().as_deref()
            == Some("transfer")
            && row.try_get::<Uuid, _>("source_account_id").ok()
                == Some(body.source_account_id)
            && row.try_get::<Uuid, _>("target_account_id").ok()
                == Some(body.target_account_id)
            && row.try_get::<Decimal, _>("amount").ok() == Some(amount)
            && row.try_get::<NaiveDate, _>("effective_on").ok() == Some(effective_on)
            && row.try_get::<Option<String>, _>("reference").ok().flatten() == reference
            && row.try_get::<Option<String>, _>("note").ok().flatten() == note;
        if !exact {
            return err(StatusCode::CONFLICT, "request_id was already used with different transfer data");
        }
        return Json(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "idempotent_replay": true,
        }))
        .into_response();
    }

    let accounts = match sqlx::query(
        r#"SELECT id, currency, is_active, opening_balance_on
           FROM company_financial_accounts
           WHERE id IN ($1, $2)
           ORDER BY id
           FOR UPDATE"#,
    )
    .bind(body.source_account_id)
    .bind(body.target_account_id)
    .fetch_all(&mut *transaction)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "load internal transfer accounts");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record internal transfer");
        }
    };
    if accounts.len() != 2 {
        return err(StatusCode::NOT_FOUND, "Financial account not found");
    }
    let source = accounts
        .iter()
        .find(|row| row.try_get::<Uuid, _>("id").ok() == Some(body.source_account_id));
    let target = accounts
        .iter()
        .find(|row| row.try_get::<Uuid, _>("id").ok() == Some(body.target_account_id));
    let (Some(source), Some(target)) = (source, target) else {
        return err(StatusCode::NOT_FOUND, "Financial account not found");
    };
    let source_currency = source.try_get::<String, _>("currency").unwrap_or_default();
    let target_currency = target.try_get::<String, _>("currency").unwrap_or_default();
    let source_opening_on = source
        .try_get::<NaiveDate, _>("opening_balance_on")
        .unwrap_or(effective_on);
    let target_opening_on = target
        .try_get::<NaiveDate, _>("opening_balance_on")
        .unwrap_or(effective_on);
    if source_currency != target_currency {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Internal transfers require matching currencies");
    }
    if !source.try_get::<bool, _>("is_active").unwrap_or(false)
        || !target.try_get::<bool, _>("is_active").unwrap_or(false)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Internal transfer accounts must be active");
    }
    if effective_on < source_opening_on || effective_on < target_opening_on {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Transfer cannot precede an account opening date");
    }

    let transfer_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO company_financial_account_transfers (
               transaction_type, request_id, source_account_id,
               target_account_id, amount, currency, effective_on,
               reference, note, created_by
           ) VALUES ('transfer', $1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
    )
    .bind(body.request_id)
    .bind(body.source_account_id)
    .bind(body.target_account_id)
    .bind(amount)
    .bind(&source_currency)
    .bind(effective_on)
    .bind(&reference)
    .bind(&note)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error, "create company account transfer rejected");
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Internal transfer is invalid");
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, transfer_id = %transfer_id, "commit company account transfer");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record internal transfer");
    }
    state.audit_sender.try_send(audit::domain_event(
        "company_financial_account.transfer.create".to_string(),
        Some(auth.user_id),
        "company_financial_account_transfer",
        Some(transfer_id),
        json!({
            "source_account_id": body.source_account_id,
            "target_account_id": body.target_account_id,
            "amount": amount.to_string(),
            "currency": source_currency,
        }),
    ));
    (
        StatusCode::CREATED,
        Json(json!({ "id": transfer_id, "idempotent_replay": false })),
    )
        .into_response()
}

async fn reverse_company_financial_account_transfer(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(transfer_id): Path<Uuid>,
    Json(body): Json<ReverseTransferRequest>,
) -> axum::response::Response {
    if !can_manage_company_accounts(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let effective_on = match parse_date(&body.effective_on, "effective_on") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    if effective_on > Utc::now().date_naive() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Reversal date cannot be in the future");
    }
    let reference = match clean_required(
        &body.reference,
        120,
        "Internal transfer reversal reason is required",
    ) {
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
            tracing::error!(error = %error, "begin company account transfer reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse internal transfer");
        }
    };
    if let Err(error) = lock_request(&mut transaction, body.request_id).await {
        tracing::error!(error = %error, "lock company account transfer reversal request");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse internal transfer");
    }

    let replay = match sqlx::query(
        r#"SELECT id, transaction_type, reverses_transfer_id,
                  effective_on, reference, note
           FROM company_financial_account_transfers
           WHERE request_id = $1
           FOR UPDATE"#,
    )
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "load company account transfer reversal replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse internal transfer");
        }
    };
    if let Some(row) = replay {
        let exact = row.try_get::<String, _>("transaction_type").ok().as_deref()
            == Some("reversal")
            && row.try_get::<Option<Uuid>, _>("reverses_transfer_id").ok().flatten()
                == Some(transfer_id)
            && row.try_get::<NaiveDate, _>("effective_on").ok() == Some(effective_on)
            && row.try_get::<Option<String>, _>("reference").ok().flatten().as_deref()
                == Some(reference.as_str())
            && row.try_get::<Option<String>, _>("note").ok().flatten() == note;
        if !exact {
            return err(StatusCode::CONFLICT, "request_id was already used with different reversal data");
        }
        return Json(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "idempotent_replay": true,
        }))
        .into_response();
    }

    let original = match sqlx::query(
        r#"SELECT source_account_id, target_account_id, amount,
                  currency, effective_on
           FROM company_financial_account_transfers
           WHERE id = $1 AND transaction_type = 'transfer'
           FOR UPDATE"#,
    )
    .bind(transfer_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Internal transfer not found"),
        Err(error) => {
            tracing::error!(error = %error, transfer_id = %transfer_id, "load company account transfer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse internal transfer");
        }
    };
    let original_effective_on = original
        .try_get::<NaiveDate, _>("effective_on")
        .unwrap_or(effective_on);
    if effective_on < original_effective_on {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Reversal cannot precede the transfer date");
    }
    let source_account_id = original
        .try_get::<Uuid, _>("source_account_id")
        .unwrap_or_default();
    let target_account_id = original
        .try_get::<Uuid, _>("target_account_id")
        .unwrap_or_default();
    let amount = original.try_get::<Decimal, _>("amount").unwrap_or(Decimal::ZERO);
    let currency = original.try_get::<String, _>("currency").unwrap_or_default();
    let reversal_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO company_financial_account_transfers (
               transaction_type, request_id, reverses_transfer_id,
               source_account_id, target_account_id, amount, currency,
               effective_on, reference, note, created_by
           ) VALUES ('reversal', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id"#,
    )
    .bind(body.request_id)
    .bind(transfer_id)
    .bind(target_account_id)
    .bind(source_account_id)
    .bind(amount)
    .bind(&currency)
    .bind(effective_on)
    .bind(&reference)
    .bind(&note)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error, transfer_id = %transfer_id, "reverse company account transfer rejected");
            return err(StatusCode::CONFLICT, "Internal transfer cannot be reversed");
        }
    };
    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, reversal_id = %reversal_id, "commit company account transfer reversal");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reverse internal transfer");
    }
    state.audit_sender.try_send(audit::domain_event(
        "company_financial_account.transfer.reverse".to_string(),
        Some(auth.user_id),
        "company_financial_account_transfer",
        Some(reversal_id),
        json!({ "reverses_transfer_id": transfer_id }),
    ));
    Json(json!({ "id": reversal_id, "idempotent_replay": false })).into_response()
}
