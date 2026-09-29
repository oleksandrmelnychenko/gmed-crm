//! Correcting and cancelling supplier invoices without an order: company
//! costs and patient costs not assigned to an order yet (owner decision
//! 2026-09-28, status audit Q12). Finance roles only (CEO, billing). Each
//! change is audited in its own transaction.

use crate::{audit, auth::middleware::AuthUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
};
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/external-invoices/{invoice_id}/update", post(update))
        .route("/external-invoices/{invoice_id}/cancel", post(cancel))
}

/// Omitted fields keep their value.
#[derive(Deserialize)]
struct UpdateRequest {
    supplier_name: Option<String>,
    external_invoice_number: Option<String>,
    provider_id: Option<Uuid>,
    #[serde(default)]
    clear_provider: bool,
    invoice_date: Option<String>,
    due_date: Option<String>,
    amount_net: Option<f64>,
    amount_vat: Option<f64>,
    amount_gross: Option<f64>,
    currency: Option<String>,
    notes: Option<String>,
    /// `updated_at` the client edited; a concurrent change answers 409.
    expected_updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Deserialize)]
struct CancelRequest {
    reason: Option<String>,
}

/// An invoice without an order stays correctable until it is paid: no
/// payment by GMED or the patient, not cancelled. Company invoices are
/// approved for payment on import, so approval alone does not freeze them.
fn editable(status: &str, paid_by: &str, company_paid: rust_decimal::Decimal) -> bool {
    matches!(status, "expected" | "received" | "approved" | "overdue")
        && paid_by == "unpaid"
        && company_paid <= rust_decimal::Decimal::ZERO
}

async fn lock_invoice(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    invoice_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, sqlx::Error> {
    sqlx::query(
        r#"SELECT external.status, external.paid_by, external.invoice_scope, external.order_id,
                  external.patient_id, external.supplier_name, external.external_invoice_number,
                  external.provider_id, external.invoice_date, external.due_date,
                  external.amount_net, external.amount_vat, external.amount_gross,
                  UPPER(external.currency) AS currency, external.notes, external.updated_at,
                  settlement.company_paid_gross
           FROM external_invoices external
           JOIN external_invoice_provider_settlement_balances settlement
             ON settlement.external_invoice_id = external.id
           WHERE external.id = $1
           FOR UPDATE OF external"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut **transaction)
    .await
}

fn snapshot(row: &sqlx::postgres::PgRow) -> Value {
    let decimal = |column: &str| {
        row.try_get::<rust_decimal::Decimal, _>(column)
            .unwrap_or_default()
            .to_string()
    };
    json!({
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "supplier_name": row.try_get::<Option<String>, _>("supplier_name").unwrap_or_default(),
        "external_invoice_number": row.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
        "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
        "invoice_date": row.try_get::<Option<chrono::NaiveDate>, _>("invoice_date").unwrap_or_default(),
        "due_date": row.try_get::<Option<chrono::NaiveDate>, _>("due_date").unwrap_or_default(),
        "amount_net": decimal("amount_net"),
        "amount_vat": decimal("amount_vat"),
        "amount_gross": decimal("amount_gross"),
        "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
    })
}

fn trimmed(value: &Option<String>) -> Option<String> {
    value.as_deref().map(str::trim).map(str::to_string)
}

async fn update(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<UpdateRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo, Role::Billing]) {
        return response.into_response();
    }
    let supplier_name = trimmed(&body.supplier_name);
    let invoice_number = trimmed(&body.external_invoice_number);
    if supplier_name
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.chars().count() > 500)
    {
        return super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invoice supplier is required (at most 500 characters)",
        );
    }
    if invoice_number
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.chars().count() > 250)
    {
        return super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "External invoice number is required (at most 250 characters)",
        );
    }
    let notes = trimmed(&body.notes);
    if notes
        .as_deref()
        .is_some_and(|value| value.chars().count() > 10_000)
    {
        return super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invoice notes are too long",
        );
    }
    let currency = trimmed(&body.currency).map(|value| value.to_uppercase());
    if currency.as_deref().is_some_and(|value| {
        value.len() != 3
            || !value
                .chars()
                .all(|character| character.is_ascii_uppercase())
    }) {
        return super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invoice currency must be a three-letter code",
        );
    }
    if let Err(response) =
        super::validate_provider_doctor_context(&state, body.provider_id, None).await
    {
        return response;
    }
    let invoice_date = match super::parse_optional_invoice_date(body.invoice_date.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let due_date = match super::parse_optional_order_date(body.due_date.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut amounts = [None, None, None];
    for (slot, (value, subject)) in amounts.iter_mut().zip([
        (body.amount_net, "Invoice net amount"),
        (body.amount_vat, "Invoice VAT amount"),
        (body.amount_gross, "Invoice gross amount"),
    ]) {
        if let Some(value) = value {
            match super::money_decimal_from_f64(value, subject) {
                Ok(amount) => *slot = Some(amount),
                Err(response) => return response,
            }
        }
    }

    let failed = |error: sqlx::Error, step: &str| {
        tracing::error!(%error, %invoice_id, step, "update supplier invoice without order");
        super::err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update invoice",
        )
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => return failed(error, "begin"),
    };
    let current = match lock_invoice(&mut transaction, invoice_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return super::err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => return failed(error, "lock"),
    };
    if current
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default()
        .is_some()
    {
        return super::err(
            StatusCode::CONFLICT,
            "This invoice belongs to an order; edit it on the order",
        );
    }
    if let Some(expected) = body.expected_updated_at
        && current
            .try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
            .is_ok_and(|value| value != expected)
    {
        return super::err(
            StatusCode::CONFLICT,
            "The invoice changed meanwhile; reload it and try again",
        );
    }
    let status = current.try_get::<String, _>("status").unwrap_or_default();
    let paid_by = current.try_get::<String, _>("paid_by").unwrap_or_default();
    let company_paid = current
        .try_get::<rust_decimal::Decimal, _>("company_paid_gross")
        .unwrap_or_default();
    if !editable(&status, &paid_by, company_paid) {
        return super::err(
            StatusCode::CONFLICT,
            "Only an unpaid, not cancelled invoice can be edited",
        );
    }
    let stored = |column: &str| {
        current
            .try_get::<rust_decimal::Decimal, _>(column)
            .unwrap_or_default()
    };
    let (amount_net, amount_vat, amount_gross) = match super::validate_money_components(
        amounts[0].unwrap_or_else(|| stored("amount_net")),
        amounts[1].unwrap_or_else(|| stored("amount_vat")),
        amounts[2].unwrap_or_else(|| stored("amount_gross")),
        "Invoice",
    ) {
        Ok(values) => values,
        Err(response) => return response,
    };
    let before = snapshot(&current);

    let updated = sqlx::query(
        r#"UPDATE external_invoices
           SET supplier_name = COALESCE($2, supplier_name),
               external_invoice_number = COALESCE($3, external_invoice_number),
               provider_id = CASE WHEN $4 THEN NULL ELSE COALESCE($5, provider_id) END,
               invoice_date = COALESCE($6, invoice_date),
               due_date = COALESCE($7, due_date),
               amount_net = $8,
               amount_vat = $9,
               amount_gross = $10,
               currency = COALESCE($11, currency),
               notes = CASE WHEN $12::text IS NULL THEN notes ELSE NULLIF($12, '') END,
               -- A payable invoice follows its (possibly new) due date; due
               -- dates are Europe/Berlin calendar days like the scheduler's.
               status = CASE
                   WHEN status IN ('approved', 'overdue') THEN
                       CASE WHEN COALESCE($7, due_date) < $13 THEN 'overdue' ELSE 'approved' END
                   ELSE status
               END,
               updated_at = now()
           WHERE id = $1
           RETURNING id, status, supplier_name, external_invoice_number, provider_id,
                     invoice_date, due_date, amount_net, amount_vat, amount_gross,
                     UPPER(currency) AS currency, notes"#,
    )
    .bind(invoice_id)
    .bind(supplier_name.as_deref())
    .bind(invoice_number.as_deref())
    .bind(body.clear_provider)
    .bind(body.provider_id)
    .bind(invoice_date)
    .bind(due_date)
    .bind(amount_net)
    .bind(amount_vat)
    .bind(amount_gross)
    .bind(currency.as_deref())
    .bind(notes.as_deref())
    .bind(crate::app_time::today())
    .fetch_one(&mut *transaction)
    .await;
    let updated = match updated {
        Ok(row) => row,
        Err(error) => {
            if error
                .as_database_error()
                .is_some_and(|database_error| database_error.is_unique_violation())
            {
                return super::err(
                    StatusCode::CONFLICT,
                    "An invoice with this supplier and number already exists",
                );
            }
            if let Some(response) = super::external_invoice_guard_response(&error) {
                return response;
            }
            return failed(error, "update");
        }
    };
    let after = snapshot(&updated);
    let mut event = audit::domain_diff_event(
        "update_unassigned_external_invoice",
        Some(auth.user_id),
        "external_invoice",
        Some(invoice_id),
        before,
        after.clone(),
    );
    event.context = json!({
        "invoice_scope": current.try_get::<String, _>("invoice_scope").unwrap_or_default(),
        "patient_id": current.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
    });
    if let Err(error) = audit::write_in_transaction(&mut transaction, &event).await {
        return failed(error, "audit");
    }
    if let Err(error) = transaction.commit().await {
        return failed(error, "commit");
    }
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "provider_invoice.updated",
        "external_invoice",
        invoice_id,
        json!({"status": after["status"]}),
    )
    .await;
    Json(json!({"id": invoice_id, "invoice": after})).into_response()
}

async fn cancel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<CancelRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo, Role::Billing]) {
        return response.into_response();
    }
    let reason = body.reason.as_deref().map(str::trim).unwrap_or_default();
    if !(3..=1000).contains(&reason.chars().count()) {
        return super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A cancellation reason of 3 to 1000 characters is required",
        );
    }
    let failed = |error: sqlx::Error, step: &str| {
        tracing::error!(%error, %invoice_id, step, "cancel supplier invoice without order");
        super::err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to cancel invoice",
        )
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => return failed(error, "begin"),
    };
    let current = match lock_invoice(&mut transaction, invoice_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return super::err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => return failed(error, "lock"),
    };
    if current
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default()
        .is_some()
    {
        return super::err(
            StatusCode::CONFLICT,
            "This invoice belongs to an order; cancel it on the order",
        );
    }
    let status = current.try_get::<String, _>("status").unwrap_or_default();
    let paid_by = current.try_get::<String, _>("paid_by").unwrap_or_default();
    let company_paid = current
        .try_get::<rust_decimal::Decimal, _>("company_paid_gross")
        .unwrap_or_default();
    if status == "cancelled" {
        return super::err(StatusCode::CONFLICT, "The invoice is already cancelled");
    }
    if company_paid > rust_decimal::Decimal::ZERO {
        return super::err(
            StatusCode::CONFLICT,
            "Reverse the company payments of this invoice first",
        );
    }
    if !editable(&status, &paid_by, company_paid) {
        return super::err(
            StatusCode::CONFLICT,
            "A paid invoice cannot be cancelled; reopen the payment first",
        );
    }
    match super::external_invoice_active_allocation_count(&mut *transaction, invoice_id).await {
        Ok(0) => {}
        Ok(_) => return super::external_invoice_allocations_block_cancellation(),
        Err(error) => return failed(error, "allocations"),
    }
    if let Err(error) = sqlx::query(
        r#"UPDATE external_invoices
           SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2,
               cancellation_reason = $3, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .bind(auth.user_id)
    .bind(reason)
    .execute(&mut *transaction)
    .await
    {
        if let Some(response) = super::external_invoice_guard_response(&error) {
            return response;
        }
        return failed(error, "update");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut transaction,
        &audit::domain_event(
            "cancel_unassigned_external_invoice",
            Some(auth.user_id),
            "external_invoice",
            Some(invoice_id),
            json!({
                "previous_status": status,
                "status": "cancelled",
                "reason": reason,
                "invoice_scope": current.try_get::<String, _>("invoice_scope").unwrap_or_default(),
                "patient_id": current.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
                "external_invoice_number": current
                    .try_get::<String, _>("external_invoice_number")
                    .unwrap_or_default(),
                "amount_gross": current
                    .try_get::<rust_decimal::Decimal, _>("amount_gross")
                    .unwrap_or_default()
                    .to_string(),
            }),
        ),
    )
    .await
    {
        return failed(error, "audit");
    }
    if let Err(error) = transaction.commit().await {
        return failed(error, "commit");
    }
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "provider_invoice.cancelled",
        "external_invoice",
        invoice_id,
        json!({"status": "cancelled"}),
    )
    .await;
    Json(json!({"id": invoice_id, "status": "cancelled", "cancellation_reason": reason}))
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::editable;
    use rust_decimal::Decimal;

    #[test]
    fn an_invoice_without_order_stays_editable_until_paid() {
        for status in ["expected", "received", "approved", "overdue"] {
            assert!(editable(status, "unpaid", Decimal::ZERO));
        }
        assert!(!editable("paid", "patient", Decimal::ZERO));
        assert!(!editable("cancelled", "unpaid", Decimal::ZERO));
        assert!(!editable("approved", "unpaid", Decimal::new(100, 2)));
    }
}
