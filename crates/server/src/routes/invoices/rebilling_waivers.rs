//! Supplier costs GMED absorbs instead of re-billing them to the patient
//! (owner 2026-10-12).
//!
//! A GMED-paid supplier cost stays a patient receivable until a patient
//! invoice re-bills it. A credit note on that invoice below the cost reverses
//! the credited part of the allocation (QA D-64), so the cost is "not billed"
//! again and counts as patient debt. Billing drops that rest from re-billing
//! with a reason: `POST /external-invoices/{id}/rebilling-waivers` records a
//! waiver over the whole open receivable of the supplier invoice. The
//! receivable view (`external_invoice_receivable_balances`) subtracts active
//! waivers, so the cost leaves «Расходы для перевыставления», the account
//! statement debt, the patient balances and the company receivables at once.
//! The supplier invoice, its payments and their bookkeeping do not change.
//!
//! Waivers are append-only; a wrong one is reversed once with a reason
//! (`…/rebilling-waivers/{waiver_id}/reversal`), which puts the amount back
//! into re-billing. Both write their audit row in the same transaction.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::{coded_err, decimal_to_string, ensure_patient_access, err};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// Error code: the reason is missing or not 3–1000 characters.
pub(crate) const REBILLING_WAIVER_REASON_REQUIRED: &str = "rebilling_waiver_reason_required";
/// Error code: the supplier invoice has no open patient receivable to waive.
pub(crate) const REBILLING_WAIVER_NOTHING_TO_WAIVE: &str = "rebilling_waiver_nothing_to_waive";
/// Error code: cancelled or company supplier invoices are no patient receivable.
pub(crate) const REBILLING_WAIVER_NOT_POSSIBLE: &str = "rebilling_waiver_not_possible";
/// Error code: the waiver was reversed already.
pub(crate) const REBILLING_WAIVER_ALREADY_REVERSED: &str = "rebilling_waiver_already_reversed";

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/external-invoices/{invoice_id}/rebilling-waivers",
            post(create_rebilling_waiver),
        )
        .route(
            "/external-invoices/{invoice_id}/rebilling-waivers/{waiver_id}/reversal",
            post(reverse_rebilling_waiver),
        )
}

#[derive(Deserialize)]
struct CreateRebillingWaiverRequest {
    request_id: Uuid,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct ReverseRebillingWaiverRequest {
    reason: Option<String>,
}

/// The reason of a waiver or of its reversal: 3–1000 characters.
fn normalize_reason(value: Option<&str>) -> Option<String> {
    let value = value.map(str::trim)?;
    (3..=1000)
        .contains(&value.chars().count())
        .then(|| value.to_string())
}

fn reason_required() -> axum::response::Response {
    coded_err(
        StatusCode::UNPROCESSABLE_ENTITY,
        REBILLING_WAIVER_REASON_REQUIRED,
        "A reason of 3 to 1000 characters is required",
        json!({}),
    )
}

fn can_waive(auth: &AuthUser) -> bool {
    auth.can(Capability::InvoicesFinance)
}

fn waiver_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "external_invoice_id": row.try_get::<Uuid, _>("external_invoice_id").unwrap_or_default(),
        "amount_gross": decimal_to_string(row.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)),
        "reason": row.try_get::<String, _>("reason").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "reversed_at": row.try_get::<Option<DateTime<Utc>>, _>("reversed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "reversal_reason": row.try_get::<Option<String>, _>("reversal_reason").unwrap_or_default(),
    })
}

/// The supplier invoice row a waiver changes, locked for the transaction
/// (allocations lock the same row, so the open receivable cannot change
/// between the check and the write).
struct LockedExternalInvoice {
    patient_id: Option<Uuid>,
    status: String,
    invoice_scope: String,
    external_invoice_number: String,
}

async fn lock_external_invoice(
    conn: &mut sqlx::PgConnection,
    external_invoice_id: Uuid,
) -> Result<Option<LockedExternalInvoice>, sqlx::Error> {
    Ok(sqlx::query(
        r#"SELECT patient_id, status, invoice_scope, external_invoice_number
           FROM external_invoices WHERE id = $1 FOR UPDATE"#,
    )
    .bind(external_invoice_id)
    .fetch_optional(conn)
    .await?
    .map(|row| LockedExternalInvoice {
        patient_id: row.try_get("patient_id").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        invoice_scope: row.try_get("invoice_scope").unwrap_or_default(),
        external_invoice_number: row.try_get("external_invoice_number").unwrap_or_default(),
    }))
}

/// `POST /external-invoices/{id}/rebilling-waivers` — GMED bears the open
/// patient receivable of a supplier invoice (CEO, Billing).
async fn create_rebilling_waiver(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(external_invoice_id): Path<Uuid>,
    Json(body): Json<CreateRebillingWaiverRequest>,
) -> axum::response::Response {
    if !can_waive(&auth) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let Some(reason) = normalize_reason(body.reason.as_deref()) else {
        return reason_required();
    };
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %external_invoice_id, "waive supplier cost re-billing");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to drop the cost from re-billing",
        )
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => return failed(error),
    };
    let external = match lock_external_invoice(&mut transaction, external_invoice_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "External invoice not found"),
        Err(error) => return failed(error),
    };
    let Some(patient_id) = external.patient_id else {
        return coded_err(
            StatusCode::CONFLICT,
            REBILLING_WAIVER_NOT_POSSIBLE,
            "A company supplier invoice is no patient receivable",
            json!({}),
        );
    };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }

    let replay = match sqlx::query(
        r#"SELECT id, external_invoice_id, amount_gross, reason, created_at,
                  reversed_at, reversal_reason
           FROM external_invoice_rebilling_waivers
           WHERE external_invoice_id = $1 AND request_id = $2"#,
    )
    .bind(external_invoice_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => return failed(error),
    };
    if let Some(replay) = replay {
        if replay.try_get::<String, _>("reason").ok().as_deref() != Some(reason.as_str()) {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        let mut waiver = waiver_json(&replay);
        waiver["idempotent_replay"] = json!(true);
        return Json(waiver).into_response();
    }

    if external.status == "cancelled" || external.invoice_scope != "patient_order" {
        return coded_err(
            StatusCode::CONFLICT,
            REBILLING_WAIVER_NOT_POSSIBLE,
            "Only an active patient supplier invoice can be dropped from re-billing",
            json!({}),
        );
    }
    let remaining = match sqlx::query_scalar::<_, Decimal>(
        r#"SELECT remaining_receivable_gross
           FROM external_invoice_receivable_balances
           WHERE external_invoice_id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value.unwrap_or(Decimal::ZERO),
        Err(error) => return failed(error),
    };
    if remaining <= Decimal::ZERO {
        return coded_err(
            StatusCode::CONFLICT,
            REBILLING_WAIVER_NOTHING_TO_WAIVE,
            "The supplier invoice has no open patient receivable to drop from re-billing",
            json!({}),
        );
    }

    let waiver = match sqlx::query(
        r#"INSERT INTO external_invoice_rebilling_waivers (
               external_invoice_id, request_id, amount_gross, reason, created_by
           ) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, external_invoice_id, amount_gross, reason, created_at,
                     reversed_at, reversal_reason"#,
    )
    .bind(external_invoice_id)
    .bind(body.request_id)
    .bind(remaining)
    .bind(&reason)
    .bind(auth.user_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(row) => row,
        Err(error) => return failed(error),
    };
    let waiver_id = waiver.try_get::<Uuid, _>("id").unwrap_or_default();
    if let Err(error) = audit::write_in_transaction(
        &mut transaction,
        &audit::domain_event(
            "waive_external_invoice_rebilling",
            Some(auth.user_id),
            "external_invoice",
            Some(external_invoice_id),
            json!({
                "waiver_id": waiver_id,
                "external_invoice_number": external.external_invoice_number,
                "patient_id": patient_id,
                "amount_gross": decimal_to_string(remaining),
                "reason": reason,
            }),
        ),
    )
    .await
    {
        return failed(error);
    }
    if let Err(error) = transaction.commit().await {
        return failed(error);
    }
    (StatusCode::CREATED, Json(waiver_json(&waiver))).into_response()
}

/// `POST /external-invoices/{id}/rebilling-waivers/{waiver_id}/reversal` —
/// the waived amount is patient receivable again (CEO, Billing).
async fn reverse_rebilling_waiver(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((external_invoice_id, waiver_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ReverseRebillingWaiverRequest>,
) -> axum::response::Response {
    if !can_waive(&auth) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let Some(reason) = normalize_reason(body.reason.as_deref()) else {
        return reason_required();
    };
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %external_invoice_id, %waiver_id, "reverse supplier cost waiver");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to reverse the waiver",
        )
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => return failed(error),
    };
    let external = match lock_external_invoice(&mut transaction, external_invoice_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "External invoice not found"),
        Err(error) => return failed(error),
    };
    if let Some(patient_id) = external.patient_id
        && let Err(response) = ensure_patient_access(&state, &auth, patient_id).await
    {
        return response;
    }
    let current = match sqlx::query(
        r#"SELECT amount_gross, reversed_at
           FROM external_invoice_rebilling_waivers
           WHERE id = $1 AND external_invoice_id = $2
           FOR UPDATE"#,
    )
    .bind(waiver_id)
    .bind(external_invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Waiver not found"),
        Err(error) => return failed(error),
    };
    if current
        .try_get::<Option<DateTime<Utc>>, _>("reversed_at")
        .unwrap_or_default()
        .is_some()
    {
        return coded_err(
            StatusCode::CONFLICT,
            REBILLING_WAIVER_ALREADY_REVERSED,
            "The waiver was already reversed",
            json!({}),
        );
    }
    let waiver = match sqlx::query(
        r#"UPDATE external_invoice_rebilling_waivers
           SET reversed_at = now(), reversed_by = $2, reversal_reason = $3
           WHERE id = $1
           RETURNING id, external_invoice_id, amount_gross, reason, created_at,
                     reversed_at, reversal_reason"#,
    )
    .bind(waiver_id)
    .bind(auth.user_id)
    .bind(&reason)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(row) => row,
        Err(error) => return failed(error),
    };
    if let Err(error) = audit::write_in_transaction(
        &mut transaction,
        &audit::domain_event(
            "reverse_external_invoice_rebilling_waiver",
            Some(auth.user_id),
            "external_invoice",
            Some(external_invoice_id),
            json!({
                "waiver_id": waiver_id,
                "external_invoice_number": external.external_invoice_number,
                "patient_id": external.patient_id,
                "amount_gross": decimal_to_string(
                    current.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)
                ),
                "reason": reason,
            }),
        ),
    )
    .await
    {
        return failed(error);
    }
    if let Err(error) = transaction.commit().await {
        return failed(error);
    }
    Json(waiver_json(&waiver)).into_response()
}

#[cfg(test)]
mod tests {
    use super::normalize_reason;

    #[test]
    fn a_waiver_needs_a_reason_of_three_to_a_thousand_characters() {
        assert_eq!(normalize_reason(None), None);
        assert_eq!(normalize_reason(Some("  ok ")), None);
        assert_eq!(
            normalize_reason(Some(" Kulanz ")).as_deref(),
            Some("Kulanz")
        );
        assert!(normalize_reason(Some(&"x".repeat(1000))).is_some());
        assert_eq!(normalize_reason(Some(&"x".repeat(1001))), None);
    }
}
