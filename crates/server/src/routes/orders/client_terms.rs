//! The client's signature of an order covers the terms it was given for (QA
//! C3-01, 2026-10-12).
//!
//! The terms are what the single order (Einzelauftrag) shows the client: the
//! not cancelled services (description, quantity, unit price, VAT rate,
//! pass-through), the programme period and the gross total
//! (`order_client_terms` in the database). A staff edit that changes them —
//! a service added or changed in the lead wizard or the order workspace, a
//! wizard line removed, the programme period moved — works like this:
//!
//! * the order row is locked and its terms are read before the change;
//! * after the change the terms are read again; when they differ, the order
//!   records `client_terms_changed_at` (order documents generated before it
//!   are outdated and no longer count as the signed version);
//! * when the client had signed the order, the change is refused with 409
//!   `order_signed_terms_change` (the signed and the new total in German
//!   format, for the confirmation) unless the request confirms the reset; with
//!   the confirmation the client's and GMED's order signatures are reset in the
//!   same transaction and audited (`reset_order_client_signature`).
//!
//! Billing actuals — hours of an approved interpreter report, a completed
//! appointment, an approved amendment — do not pass through here: they keep
//! the signature, and the order shows the signed total next to the current
//! one.

use axum::{Json, http::StatusCode, response::IntoResponse};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::audit;

/// Error code of a refused change of signed terms.
pub(crate) const SIGNED_TERMS_CHANGE: &str = "order_signed_terms_change";

/// The order before a staff edit, read under its row lock.
pub(crate) struct TermsBefore {
    terms: Value,
    signed_patient: bool,
    signed_agency: bool,
    signed_terms: Option<Value>,
    currency: String,
}

/// What the edit did to the client's signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TermsChange {
    /// The terms are the same (also: nothing was written).
    Unchanged,
    /// The terms changed on an order the client had not signed.
    Changed,
    /// The terms of a signed order changed with the confirmation: the order
    /// signatures were reset.
    SignatureReset,
}

impl TermsChange {
    pub(crate) fn signature_reset(self) -> bool {
        self == Self::SignatureReset
    }
}

/// Locks the order and reads its terms before an edit. `None`: no such order.
pub(crate) async fn lock_before(
    conn: &mut PgConnection,
    order_id: Uuid,
) -> Result<Option<TermsBefore>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT signed_patient, signed_agency, client_signed_terms,
                  UPPER(currency) AS currency,
                  order_client_terms(id) AS terms
           FROM orders
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(order_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|row| TermsBefore {
        terms: row.try_get("terms").unwrap_or(Value::Null),
        signed_patient: row.try_get("signed_patient").unwrap_or(false),
        signed_agency: row.try_get("signed_agency").unwrap_or(false),
        signed_terms: row.try_get("client_signed_terms").unwrap_or_default(),
        currency: row
            .try_get::<String, _>("currency")
            .unwrap_or_else(|_| "EUR".to_string()),
    }))
}

fn total_of(terms: Option<&Value>) -> Option<Decimal> {
    let value = terms?.get("total_gross")?;
    let total: Option<Decimal> = match value {
        Value::Number(number) => number.to_string().parse().ok(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    };
    total.map(|amount| amount.normalize())
}

fn money_label(value: Option<Decimal>, currency: &str) -> String {
    value
        .map(|amount| crate::order_document_texts::format_money_de(amount, currency))
        .unwrap_or_else(|| "—".to_string())
}

/// The refusal of a change of signed terms without the confirmation. The
/// labels are placeholders of the translated message ("889,15 €").
fn signed_terms_change_refusal(
    signed_total: Option<Decimal>,
    new_total: Option<Decimal>,
    currency: &str,
    signed_at: Option<&Value>,
) -> axum::response::Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": SIGNED_TERMS_CHANGE,
            "message": "The client signed this order; changing its services or period resets the signature and needs a new signed order document. Confirm with confirm_signature_reset",
            "signed_total": signed_total.map(|value| value.to_string()),
            "new_total": new_total.map(|value| value.to_string()),
            "signed_total_label": money_label(signed_total, currency),
            "new_total_label": money_label(new_total, currency),
            "signed_at": signed_at.cloned().unwrap_or(Value::Null),
        })),
    )
        .into_response()
}

/// Compares the terms after an edit with `before` (same transaction, the
/// order row still locked). See the module documentation.
pub(crate) async fn settle(
    conn: &mut PgConnection,
    order_id: Uuid,
    before: &TermsBefore,
    confirmed: bool,
    actor: Option<Uuid>,
    source: &str,
) -> Result<TermsChange, TermsError> {
    let row = sqlx::query(
        r#"SELECT order_client_terms($1) AS terms,
                  order_client_terms($1) IS DISTINCT FROM $2::jsonb AS changed"#,
    )
    .bind(order_id)
    .bind(&before.terms)
    .fetch_one(&mut *conn)
    .await
    .map_err(TermsError::Database)?;
    if !row.try_get::<bool, _>("changed").unwrap_or(false) {
        return Ok(TermsChange::Unchanged);
    }
    let after: Value = row.try_get("terms").unwrap_or(Value::Null);
    let new_total = total_of(Some(&after));
    // The signed version: recorded at the signature, or (orders signed before
    // the rule without a record) the terms right before this change.
    let signed_total =
        total_of(before.signed_terms.as_ref()).or_else(|| total_of(Some(&before.terms)));

    if before.signed_patient && !confirmed {
        return Err(TermsError::Refused(signed_terms_change_refusal(
            signed_total,
            new_total,
            &before.currency,
            before
                .signed_terms
                .as_ref()
                .and_then(|terms| terms.get("signed_at")),
        )));
    }

    let reset = before.signed_patient;
    sqlx::query(
        r#"UPDATE orders
           SET client_terms_changed_at = clock_timestamp(),
               client_terms_changed_by = $2,
               client_signed_terms = CASE
                   WHEN $3 AND client_signed_terms IS NULL
                       THEN $4::jsonb || jsonb_build_object(
                           'signed_at', COALESCE(signed_patient_at, signed_at),
                           'recorded_at_change', true)
                   ELSE client_signed_terms
               END,
               signed_patient = CASE WHEN $3 THEN false ELSE signed_patient END,
               signed_agency = CASE WHEN $3 THEN false ELSE signed_agency END,
               signed_patient_at = CASE WHEN $3 THEN NULL ELSE signed_patient_at END,
               signed_agency_at = CASE WHEN $3 THEN NULL ELSE signed_agency_at END,
               signed_at = CASE WHEN $3 THEN NULL ELSE signed_at END,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(order_id)
    .bind(actor)
    .bind(reset)
    .bind(&before.terms)
    .execute(&mut *conn)
    .await
    .map_err(TermsError::Database)?;

    if !reset {
        return Ok(TermsChange::Changed);
    }
    audit::write_in_transaction(
        conn,
        &audit::domain_event(
            "reset_order_client_signature",
            actor,
            "order",
            Some(order_id),
            json!({
                "source": source,
                "reason": "terms_changed",
                "signed_total": signed_total.map(|value| value.to_string()),
                "new_total": new_total.map(|value| value.to_string()),
                "previous_signed_patient": before.signed_patient,
                "previous_signed_agency": before.signed_agency,
                "signed_terms": before.signed_terms,
                "previous_terms": before.terms,
                "new_terms": after,
            }),
        ),
    )
    .await
    .map_err(TermsError::Database)?;
    Ok(TermsChange::SignatureReset)
}

/// Why `settle` stopped the edit.
pub(crate) enum TermsError {
    /// A change of signed terms without the confirmation (409); the caller
    /// returns it and drops its transaction, so nothing is written.
    Refused(axum::response::Response),
    Database(sqlx::Error),
}

/// The client signature part of an order payload: the version the client
/// signed and whether changes made since wait for a new signature.
pub(crate) fn signature_payload(
    signed_patient: bool,
    signed_terms: Option<&Value>,
    terms_changed_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    let signed_at = signed_terms
        .and_then(|terms| terms.get("signed_at"))
        .cloned()
        .unwrap_or(Value::Null);
    let signed_at_time = signed_at
        .as_str()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&chrono::Utc));
    // Changes after the last signature: the order was signed once and its
    // terms were changed since (the change reset the signature).
    let changes_await_signature = !signed_patient
        && signed_terms.is_some()
        && terms_changed_at.is_some_and(|changed| signed_at_time.is_none_or(|at| changed > at));
    json!({
        "signed_total": total_of(signed_terms).map(|value| value.to_string()),
        "signed_date_from": signed_terms.and_then(|terms| terms.get("date_from")).cloned().unwrap_or(Value::Null),
        "signed_date_to": signed_terms.and_then(|terms| terms.get("date_to")).cloned().unwrap_or(Value::Null),
        "signed_at": signed_at,
        "signed_document_id": signed_terms.and_then(|terms| terms.get("document_id")).cloned().unwrap_or(Value::Null),
        "terms_changed_at": terms_changed_at.map(|value| value.to_rfc3339()),
        "changes_await_signature": changes_await_signature,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn total_reads_numbers_and_strings() {
        assert_eq!(
            total_of(Some(&json!({"total_gross": 889.15}))),
            Some(Decimal::new(88915, 2))
        );
        assert_eq!(
            total_of(Some(&json!({"total_gross": "1002.20"}))),
            Some(Decimal::new(100220, 2))
        );
        assert_eq!(total_of(Some(&json!({"total_gross": null}))), None);
        assert_eq!(total_of(None), None);
    }

    #[test]
    fn changes_await_signature_only_after_a_reset() {
        let signed = json!({"total_gross": 889.15, "signed_at": "2026-10-12T10:00:00Z"});
        let changed = chrono::DateTime::parse_from_rfc3339("2026-10-12T11:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let earlier = chrono::DateTime::parse_from_rfc3339("2026-10-12T09:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        // Signed, nothing changed since.
        assert_eq!(
            signature_payload(true, Some(&signed), None)["changes_await_signature"],
            json!(false)
        );
        // The change reset the signature.
        let payload = signature_payload(false, Some(&signed), Some(changed));
        assert_eq!(payload["changes_await_signature"], json!(true));
        assert_eq!(payload["signed_total"], json!("889.15"));
        // A change before the signature (unsigned draft) is not "awaiting".
        assert_eq!(
            signature_payload(false, Some(&signed), Some(earlier))["changes_await_signature"],
            json!(false)
        );
        // Never signed.
        assert_eq!(
            signature_payload(false, None, Some(changed))["changes_await_signature"],
            json!(false)
        );
    }

    #[test]
    fn refusal_names_both_totals_in_german_format() {
        let response = signed_terms_change_refusal(
            Some(Decimal::new(88915, 2)),
            Some(Decimal::new(100220, 2)),
            "EUR",
            None,
        );
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
}
