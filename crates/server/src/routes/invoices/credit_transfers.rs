//! Moving a patient's credit balance to another invoice.
//!
//! A credit balance arises when the patient paid more than an invoice asks
//! for after credit notes and applied advances (an overpayment, or a credit
//! note issued after payment). Billing either refunds it (the refund journal)
//! or moves it to another open invoice of the same patient and currency. A
//! move is a `credit_transfer` refund leg on the source invoice and a
//! `credit_transfer` payment leg on the target, written in one transaction
//! and linked in `invoice_credit_transfers`, so every balance, status, ledger
//! and accounting consumer sees ordinary journal rows. The legs are reversed
//! together only.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    InvoicePaymentContext, MoneyInput, can_manage_invoice_finance, decimal_to_string,
    ensure_patient_access, err, insert_invoice_payment_accounting_entries,
    insert_invoice_refund_accounting_entries, invoice_balance_due, load_invoice_detail,
    normalize_optional, parse_optional_date, recompute_invoice_settlement_status,
    run_paid_invoice_follow_up, write_invoice_audit,
};
use crate::auth::middleware::AuthUser;
use crate::money::CommercialRounding;
use crate::state::AppState;

pub(crate) const CREDIT_TRANSFER_METHOD: &str = "credit_transfer";

#[derive(Deserialize)]
pub(crate) struct CreateCreditTransferRequest {
    request_id: Uuid,
    target_invoice_id: Uuid,
    amount_gross: MoneyInput,
    transferred_on: Option<String>,
    note: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ReverseCreditTransferRequest {
    reason: String,
    reversed_on: Option<String>,
}

/// Payment context and balances of an invoice locked by the caller.
pub(crate) struct LockedInvoice {
    pub context: InvoicePaymentContext,
    pub status: String,
    pub paid_amount: Decimal,
}

impl LockedInvoice {
    /// What the patient still owes on the invoice.
    pub fn balance_due(&self) -> Decimal {
        invoice_balance_due(
            &self.status,
            self.context.total_gross,
            self.context.credited_amount,
            self.paid_amount,
            self.context.prepayment_applied_amount,
        )
    }

    /// Cash beyond what the invoice asks for: the patient's credit balance.
    pub fn refundable_credit(&self) -> Decimal {
        (self.paid_amount
            - (self.context.total_gross
                - self.context.credited_amount
                - self.context.prepayment_applied_amount)
                .max(Decimal::ZERO))
        .max(Decimal::ZERO)
    }
}

/// Loads the payment context of an invoice the caller has locked.
pub(crate) async fn load_locked_invoice(
    transaction: &mut Transaction<'_, Postgres>,
    invoice_id: Uuid,
) -> Result<Option<LockedInvoice>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT invoice.order_id, invoice.patient_id, invoice.invoice_number,
                  invoice.status, invoice.total_vat, invoice.total_gross,
                  invoice.credited_amount, invoice.prepayment_applied_amount,
                  invoice.paid_amount, invoice.line_items, invoice.currency
           FROM invoices invoice
           WHERE invoice.id = $1
           FOR UPDATE OF invoice"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut **transaction)
    .await?
    else {
        return Ok(None);
    };
    let status = row.try_get::<String, _>("status")?;
    Ok(Some(LockedInvoice {
        context: InvoicePaymentContext {
            invoice_id,
            order_id: row.try_get("order_id")?,
            patient_id: row.try_get("patient_id")?,
            invoice_number: row.try_get("invoice_number")?,
            invoice_status: status.clone(),
            total_vat: row.try_get("total_vat")?,
            total_gross: row.try_get("total_gross")?,
            credited_amount: row.try_get("credited_amount")?,
            prepayment_applied_amount: row.try_get("prepayment_applied_amount")?,
            currency: row.try_get("currency")?,
            line_items: row
                .try_get::<Value, _>("line_items")
                .unwrap_or_else(|_| json!([])),
        },
        status,
        paid_amount: row.try_get("paid_amount")?,
    }))
}

/// Transfers in and out of an invoice, newest first.
pub(crate) async fn load_invoice_credit_transfers(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT transfer.id, transfer.source_invoice_id, transfer.target_invoice_id,
                  transfer.amount_gross, transfer.currency, transfer.transferred_on,
                  transfer.note, transfer.created_at,
                  source.invoice_number AS source_invoice_number,
                  target.invoice_number AS target_invoice_number,
                  creator.name AS created_by_name,
                  EXISTS (
                      SELECT 1 FROM invoice_payment_transactions reversal
                      WHERE reversal.reverses_transaction_id = transfer.target_payment_transaction_id
                        AND reversal.transaction_type = 'reversal'
                  ) AS is_reversed
           FROM invoice_credit_transfers transfer
           JOIN invoices source ON source.id = transfer.source_invoice_id
           JOIN invoices target ON target.id = transfer.target_invoice_id
           JOIN users creator ON creator.id = transfer.created_by
           WHERE transfer.source_invoice_id = $1 OR transfer.target_invoice_id = $1
           ORDER BY transfer.transferred_on DESC, transfer.created_at DESC, transfer.id DESC"#,
    )
    .bind(invoice_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let source_id = row.try_get::<Uuid, _>("source_invoice_id").unwrap_or_default();
            let outgoing = source_id == invoice_id;
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "direction": if outgoing { "out" } else { "in" },
                "source_invoice_id": source_id,
                "source_invoice_number": row.try_get::<String, _>("source_invoice_number").unwrap_or_default(),
                "target_invoice_id": row.try_get::<Uuid, _>("target_invoice_id").unwrap_or_default(),
                "target_invoice_number": row.try_get::<String, _>("target_invoice_number").unwrap_or_default(),
                "amount_gross": decimal_to_string(row.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)),
                "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
                "transferred_on": row.try_get::<NaiveDate, _>("transferred_on").map(|value| value.to_string()).unwrap_or_default(),
                "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
                "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "is_reversed": row.try_get::<bool, _>("is_reversed").unwrap_or(false),
            })
        })
        .collect())
}

/// Open invoices of the same patient and currency a credit balance can settle.
pub(crate) async fn load_credit_transfer_targets(
    state: &AppState,
    invoice_id: Uuid,
    patient_id: Uuid,
    currency: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT invoice.id, invoice.invoice_number, invoice.invoice_type, invoice.status,
                  invoice.issued_at, invoice.total_gross, invoice.credited_amount,
                  invoice.paid_amount, invoice.prepayment_applied_amount,
                  orders.order_number
           FROM invoices invoice
           LEFT JOIN orders ON orders.id = invoice.order_id
           WHERE invoice.patient_id = $1
             AND invoice.id <> $2
             AND UPPER(invoice.currency) = UPPER($3)
             AND invoice.status NOT IN ('draft', 'cancelled')
             AND invoice.total_gross - invoice.credited_amount
                 - invoice.paid_amount - invoice.prepayment_applied_amount > 0
           ORDER BY invoice.issued_at, invoice.id"#,
    )
    .bind(patient_id)
    .bind(invoice_id)
    .bind(currency)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let status = row.try_get::<String, _>("status").unwrap_or_default();
            let balance = invoice_balance_due(
                &status,
                row.try_get("total_gross").unwrap_or(Decimal::ZERO),
                row.try_get("credited_amount").unwrap_or(Decimal::ZERO),
                row.try_get("paid_amount").unwrap_or(Decimal::ZERO),
                row.try_get("prepayment_applied_amount")
                    .unwrap_or(Decimal::ZERO),
            );
            json!({
                "invoice_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                "invoice_type": row.try_get::<String, _>("invoice_type").unwrap_or_default(),
                "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                "balance_due": decimal_to_string(balance),
            })
        })
        .collect())
}

fn transfer_date(value: Option<&str>) -> Result<NaiveDate, &'static str> {
    match parse_optional_date(value) {
        Ok(Some(date)) if date <= Utc::now().date_naive() => Ok(date),
        Ok(None) => Ok(Utc::now().date_naive()),
        _ => Err("Invalid transfer date"),
    }
}

/// Locks both invoices in id order so concurrent transfers cannot deadlock.
async fn lock_pair(
    transaction: &mut Transaction<'_, Postgres>,
    first: Uuid,
    second: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT id FROM invoices WHERE id = $1 OR id = $2 ORDER BY id FOR UPDATE")
        .bind(first)
        .bind(second)
        .execute(&mut **transaction)
        .await
        .map(|_| ())
}

pub(crate) async fn create_credit_transfer(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<CreateCreditTransferRequest>,
) -> axum::response::Response {
    const FAILED: &str = "Failed to transfer credit";
    if !can_manage_invoice_finance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let Some(amount_gross) = body.amount_gross.parse_decimal() else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid transfer amount");
    };
    let amount_gross = amount_gross.round_cents();
    if amount_gross <= Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Transfer amount must be greater than zero",
        );
    }
    if body.target_invoice_id == invoice_id {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Credit can only be moved to another invoice",
        );
    }
    let transferred_on = match transfer_date(body.transferred_on.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let note = normalize_optional(body.note.as_deref());

    let patient_id =
        match sqlx::query_scalar::<_, Uuid>("SELECT patient_id FROM invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
            Err(error) => {
                tracing::error!(%error, %invoice_id, "load credit transfer access");
                return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
            }
        };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "begin credit transfer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if let Err(error) = lock_pair(&mut transaction, invoice_id, body.target_invoice_id).await {
        tracing::error!(%error, %invoice_id, "lock credit transfer invoices");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    match sqlx::query(
        r#"SELECT id, target_invoice_id, amount_gross
           FROM invoice_credit_transfers
           WHERE source_invoice_id = $1 AND request_id = $2"#,
    )
    .bind(invoice_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(existing)) => {
            let same = existing
                .try_get::<Uuid, _>("target_invoice_id")
                .is_ok_and(|value| value == body.target_invoice_id)
                && existing
                    .try_get::<Decimal, _>("amount_gross")
                    .is_ok_and(|value| value == amount_gross);
            if !same {
                return err(
                    StatusCode::CONFLICT,
                    "request_id was already used for another credit transfer",
                );
            }
            let transfer_id = existing.try_get::<Uuid, _>("id").unwrap_or_default();
            drop(transaction);
            return match load_invoice_detail(&state, invoice_id, &auth).await {
                Ok(Some(invoice)) => Json(json!({
                    "credit_transfer_id": transfer_id,
                    "invoice": invoice,
                    "idempotent_replay": true,
                }))
                .into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
                Err(response) => response,
            };
        }
        Ok(None) => {}
        Err(error) => {
            tracing::error!(%error, %invoice_id, "load credit transfer idempotency key");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }

    let (source, target) = match (
        load_locked_invoice(&mut transaction, invoice_id).await,
        load_locked_invoice(&mut transaction, body.target_invoice_id).await,
    ) {
        (Ok(Some(source)), Ok(Some(target))) => (source, target),
        (Ok(_), Ok(_)) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        (Err(error), _) | (_, Err(error)) => {
            tracing::error!(%error, %invoice_id, "load credit transfer invoices");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if source.context.patient_id != target.context.patient_id
        || !source
            .context
            .currency
            .eq_ignore_ascii_case(&target.context.currency)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Credit can only be moved between invoices of the same patient and currency",
        );
    }
    if [&source.status, &target.status]
        .iter()
        .any(|status| matches!(status.as_str(), "draft" | "cancelled"))
    {
        return err(
            StatusCode::CONFLICT,
            "Credit transfers require released invoices",
        );
    }
    if amount_gross > source.refundable_credit() {
        return err(
            StatusCode::CONFLICT,
            "Transfer exceeds the credit balance of the invoice",
        );
    }
    if amount_gross > target.balance_due() {
        return err(
            StatusCode::CONFLICT,
            "Transfer exceeds the open balance of the target invoice",
        );
    }

    let refund_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_refund_transactions (
                invoice_id, transaction_type, request_id, amount_gross,
                payment_method, payment_reference, refunded_on, reason, note, created_by
           ) VALUES ($1, 'refund', $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
    )
    .bind(invoice_id)
    .bind(body.request_id)
    .bind(amount_gross)
    .bind(CREDIT_TRANSFER_METHOD)
    .bind(&target.context.invoice_number)
    .bind(transferred_on)
    .bind(format!(
        "Credit applied to invoice {}",
        target.context.invoice_number
    ))
    .bind(note.clone())
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(sqlx::Error::Database(db_error))
            if matches!(
                db_error.code().as_deref(),
                Some("23505" | "23514" | "P0001")
            ) =>
        {
            tracing::warn!(error = %db_error, %invoice_id, "credit transfer refund leg refused");
            return err(
                StatusCode::CONFLICT,
                "The credit balance changed or the date precedes the latest movement; reload and try again",
            );
        }
        Err(error) => {
            tracing::error!(%error, %invoice_id, "insert credit transfer refund leg");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if let Err(error) = insert_invoice_refund_accounting_entries(
        &mut transaction,
        &source.context,
        refund_id,
        "refund",
        amount_gross,
        CREDIT_TRANSFER_METHOD,
        Some(target.context.invoice_number.as_str()),
        transferred_on,
        auth.user_id,
    )
    .await
    {
        tracing::error!(%error, %invoice_id, "book credit transfer refund leg");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    let payment_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_payment_transactions (
                invoice_id, transaction_type, request_id, amount_gross, payment_method,
                payment_reference, received_on, note, created_by
           ) VALUES ($1, 'payment', $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
    )
    .bind(body.target_invoice_id)
    .bind(body.request_id)
    .bind(amount_gross)
    .bind(CREDIT_TRANSFER_METHOD)
    .bind(&source.context.invoice_number)
    .bind(transferred_on)
    .bind(format!(
        "Credit from invoice {}",
        source.context.invoice_number
    ))
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(sqlx::Error::Database(db_error))
            if matches!(
                db_error.code().as_deref(),
                Some("23505" | "23514" | "P0001")
            ) =>
        {
            return err(
                StatusCode::CONFLICT,
                "The target invoice changed; reload and try again",
            );
        }
        Err(error) => {
            tracing::error!(%error, %invoice_id, "insert credit transfer payment leg");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if let Err(error) = insert_invoice_payment_accounting_entries(
        &mut transaction,
        &target.context,
        payment_id,
        "payment",
        amount_gross,
        CREDIT_TRANSFER_METHOD,
        Some(source.context.invoice_number.as_str()),
        transferred_on,
        auth.user_id,
    )
    .await
    {
        tracing::error!(%error, %invoice_id, "book credit transfer payment leg");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    let transfer_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_credit_transfers (
                request_id, source_invoice_id, target_invoice_id, amount_gross, currency,
                transferred_on, source_refund_transaction_id, target_payment_transaction_id,
                note, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id"#,
    )
    .bind(body.request_id)
    .bind(invoice_id)
    .bind(body.target_invoice_id)
    .bind(amount_gross)
    .bind(source.context.currency.to_uppercase())
    .bind(transferred_on)
    .bind(refund_id)
    .bind(payment_id)
    .bind(note.clone())
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "insert credit transfer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    for id in [invoice_id, body.target_invoice_id] {
        if let Err(error) = recompute_invoice_settlement_status(&mut transaction, id).await {
            tracing::error!(%error, invoice_id = %id, "recompute invoice after credit transfer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(%error, %invoice_id, "commit credit transfer");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    run_paid_invoice_follow_up(&state, &auth, body.target_invoice_id, payment_id).await;
    let payload = json!({
        "credit_transfer_id": transfer_id,
        "request_id": body.request_id,
        "source_invoice_id": invoice_id,
        "source_invoice_number": source.context.invoice_number,
        "target_invoice_id": body.target_invoice_id,
        "target_invoice_number": target.context.invoice_number,
        "refund_transaction_id": refund_id,
        "payment_transaction_id": payment_id,
        "amount_gross": decimal_to_string(amount_gross),
        "currency": source.context.currency,
        "transferred_on": transferred_on.to_string(),
        "patient_id": patient_id,
    });
    for (id, action, event) in [
        (
            invoice_id,
            "credit_transferred_out",
            "invoice.credit_transferred_out",
        ),
        (
            body.target_invoice_id,
            "credit_transferred_in",
            "invoice.credit_transferred_in",
        ),
    ] {
        write_invoice_audit(&state, auth.user_id, action, id, payload.clone()).await;
        crate::realtime::publish_invoice_event(
            &state,
            Some(auth.user_id),
            event,
            id,
            payload.clone(),
        )
        .await;
    }

    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => (
            StatusCode::CREATED,
            Json(json!({
                "credit_transfer_id": transfer_id,
                "invoice": invoice,
            })),
        )
            .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

pub(crate) async fn reverse_credit_transfer(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((invoice_id, transfer_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ReverseCreditTransferRequest>,
) -> axum::response::Response {
    const FAILED: &str = "Failed to reverse credit transfer";
    if !can_manage_invoice_finance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let Some(reason) = normalize_optional(Some(body.reason.as_str())) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reversal reason is required",
        );
    };
    let reversed_on = match transfer_date(body.reversed_on.as_deref()) {
        Ok(value) => value,
        Err(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid reversal date"),
    };
    let transfer = match sqlx::query(
        r#"SELECT transfer.source_invoice_id, transfer.target_invoice_id, transfer.amount_gross,
                  transfer.transferred_on, transfer.source_refund_transaction_id,
                  transfer.target_payment_transaction_id, source.patient_id
           FROM invoice_credit_transfers transfer
           JOIN invoices source ON source.id = transfer.source_invoice_id
           WHERE transfer.id = $1
             AND (transfer.source_invoice_id = $2 OR transfer.target_invoice_id = $2)"#,
    )
    .bind(transfer_id)
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Credit transfer not found"),
        Err(error) => {
            tracing::error!(%error, %transfer_id, "load credit transfer");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let patient_id = transfer
        .try_get::<Uuid, _>("patient_id")
        .unwrap_or_default();
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    let source_id = transfer
        .try_get::<Uuid, _>("source_invoice_id")
        .unwrap_or_default();
    let target_id = transfer
        .try_get::<Uuid, _>("target_invoice_id")
        .unwrap_or_default();
    let amount_gross = transfer
        .try_get::<Decimal, _>("amount_gross")
        .unwrap_or(Decimal::ZERO);
    let refund_id = transfer
        .try_get::<Uuid, _>("source_refund_transaction_id")
        .unwrap_or_default();
    let payment_id = transfer
        .try_get::<Uuid, _>("target_payment_transaction_id")
        .unwrap_or_default();
    if transfer
        .try_get::<NaiveDate, _>("transferred_on")
        .is_ok_and(|date| reversed_on < date)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reversal date cannot precede the transfer",
        );
    }

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %transfer_id, "begin credit transfer reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if let Err(error) = lock_pair(&mut transaction, source_id, target_id).await {
        tracing::error!(%error, %transfer_id, "lock credit transfer reversal");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    match sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1 FROM invoice_payment_transactions
               WHERE reverses_transaction_id = $1 AND transaction_type = 'reversal'
           )"#,
    )
    .bind(payment_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(false) => {}
        Ok(true) => return err(StatusCode::CONFLICT, "Credit transfer was already reversed"),
        Err(error) => {
            tracing::error!(%error, %transfer_id, "check credit transfer reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }
    let (source, target) = match (
        load_locked_invoice(&mut transaction, source_id).await,
        load_locked_invoice(&mut transaction, target_id).await,
    ) {
        (Ok(Some(source)), Ok(Some(target))) => (source, target),
        (Ok(_), Ok(_)) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        (Err(error), _) | (_, Err(error)) => {
            tracing::error!(%error, %transfer_id, "load credit transfer reversal invoices");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    // The moved credit must still be on the target: refunds or advances drawn
    // from it have to be reversed first.
    let target_capacity = match sqlx::query(
        r#"SELECT
               COALESCE((
                   SELECT SUM(CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END)
                   FROM invoice_payment_transactions WHERE invoice_id = $1
               ), 0) AS cash_received,
               COALESCE((
                   SELECT SUM(CASE WHEN transaction_type = 'refund' THEN amount_gross ELSE -amount_gross END)
                   FROM invoice_refund_transactions WHERE invoice_id = $1
               ), 0) AS cash_refunded,
               COALESCE((
                   SELECT SUM(amount_gross) FROM invoice_prepayment_allocations
                   WHERE advance_invoice_id = $1
               ), 0) AS allocated_advance"#,
    )
    .bind(target_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(%error, %transfer_id, "load credit transfer reversal capacity");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let decimal = |column: &str| {
        target_capacity
            .try_get::<Decimal, _>(column)
            .unwrap_or(Decimal::ZERO)
    };
    if decimal("cash_received") - amount_gross
        < decimal("cash_refunded") + decimal("allocated_advance")
    {
        return err(
            StatusCode::CONFLICT,
            "Refunds and applied advances of the target invoice must be reversed first",
        );
    }

    let note = format!("Credit transfer reversed: {reason}");
    let payment_reversal_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_payment_transactions (
                invoice_id, transaction_type, reverses_transaction_id, amount_gross,
                payment_method, payment_reference, received_on, note, created_by
           ) VALUES ($1, 'reversal', $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
    )
    .bind(target_id)
    .bind(payment_id)
    .bind(amount_gross)
    .bind(CREDIT_TRANSFER_METHOD)
    .bind(&source.context.invoice_number)
    .bind(reversed_on)
    .bind(&note)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(sqlx::Error::Database(db_error))
            if matches!(db_error.code().as_deref(), Some("23505" | "P0001")) =>
        {
            return err(
                StatusCode::CONFLICT,
                "The moved credit is no longer on the target invoice",
            );
        }
        Err(error) => {
            tracing::error!(%error, %transfer_id, "insert credit transfer payment reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if let Err(error) = insert_invoice_payment_accounting_entries(
        &mut transaction,
        &target.context,
        payment_reversal_id,
        "reversal",
        amount_gross,
        CREDIT_TRANSFER_METHOD,
        Some(source.context.invoice_number.as_str()),
        reversed_on,
        auth.user_id,
    )
    .await
    {
        tracing::error!(%error, %transfer_id, "book credit transfer payment reversal");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    let refund_reversal_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_refund_transactions (
                invoice_id, transaction_type, reverses_transaction_id, amount_gross,
                payment_method, payment_reference, refunded_on, reason, note, created_by
           ) VALUES ($1, 'reversal', $2, $3, $4, $5, $6, $7, $7, $8)
           RETURNING id"#,
    )
    .bind(source_id)
    .bind(refund_id)
    .bind(amount_gross)
    .bind(CREDIT_TRANSFER_METHOD)
    .bind(&target.context.invoice_number)
    .bind(reversed_on)
    .bind(&note)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(sqlx::Error::Database(db_error))
            if matches!(
                db_error.code().as_deref(),
                Some("23505" | "23514" | "P0001")
            ) =>
        {
            return err(StatusCode::CONFLICT, "Credit transfer was already reversed");
        }
        Err(error) => {
            tracing::error!(%error, %transfer_id, "insert credit transfer refund reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if let Err(error) = insert_invoice_refund_accounting_entries(
        &mut transaction,
        &source.context,
        refund_reversal_id,
        "reversal",
        amount_gross,
        CREDIT_TRANSFER_METHOD,
        Some(target.context.invoice_number.as_str()),
        reversed_on,
        auth.user_id,
    )
    .await
    {
        tracing::error!(%error, %transfer_id, "book credit transfer refund reversal");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    for id in [source_id, target_id] {
        if let Err(error) = recompute_invoice_settlement_status(&mut transaction, id).await {
            tracing::error!(%error, invoice_id = %id, "recompute invoice after credit transfer reversal");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(%error, %transfer_id, "commit credit transfer reversal");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    let payload = json!({
        "credit_transfer_id": transfer_id,
        "source_invoice_id": source_id,
        "target_invoice_id": target_id,
        "payment_reversal_transaction_id": payment_reversal_id,
        "refund_reversal_transaction_id": refund_reversal_id,
        "amount_gross": decimal_to_string(amount_gross),
        "reason": reason,
        "reversed_on": reversed_on.to_string(),
        "patient_id": patient_id,
    });
    for id in [source_id, target_id] {
        write_invoice_audit(
            &state,
            auth.user_id,
            "credit_transfer_reversed",
            id,
            payload.clone(),
        )
        .await;
        crate::realtime::publish_invoice_event(
            &state,
            Some(auth.user_id),
            "invoice.credit_transfer_reversed",
            id,
            payload.clone(),
        )
        .await;
    }

    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => Json(json!({
            "credit_transfer_id": transfer_id,
            "invoice": invoice,
        }))
        .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locked(status: &str, total: i64, credited: i64, paid: i64, applied: i64) -> LockedInvoice {
        LockedInvoice {
            context: InvoicePaymentContext {
                invoice_id: Uuid::nil(),
                order_id: None,
                patient_id: Uuid::nil(),
                invoice_number: "INV-1".to_string(),
                invoice_status: status.to_string(),
                total_vat: Decimal::ZERO,
                total_gross: Decimal::from(total),
                credited_amount: Decimal::from(credited),
                prepayment_applied_amount: Decimal::from(applied),
                currency: "EUR".to_string(),
                line_items: json!([]),
            },
            status: status.to_string(),
            paid_amount: Decimal::from(paid),
        }
    }

    #[test]
    fn credit_balance_is_cash_beyond_what_the_invoice_still_asks_for() {
        // 1000 invoiced, 700 advance applied, 400 paid: 100 overpaid.
        let overpaid = locked("paid", 1000, 0, 400, 700);
        assert_eq!(overpaid.refundable_credit(), Decimal::from(100));
        assert_eq!(overpaid.balance_due(), Decimal::ZERO);
        // A credit note after full payment leaves its amount as credit.
        let credited = locked("paid", 1000, 300, 1000, 0);
        assert_eq!(credited.refundable_credit(), Decimal::from(300));
        let open = locked("partially_paid", 1000, 0, 250, 0);
        assert_eq!(open.refundable_credit(), Decimal::ZERO);
        assert_eq!(open.balance_due(), Decimal::from(750));
    }
}
