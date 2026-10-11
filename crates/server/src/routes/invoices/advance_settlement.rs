//! An advance invoice settled by the final invoice (QA 2026-10-11, D-56/D-63/
//! D-64).
//!
//! An advance invoice (Anzahlungsrechnung) asks for a prepayment; the final
//! invoice (Schlussrechnung) bills the whole service and deducts only the
//! advance money actually received (§ 14 Abs. 5 Satz 2 UStG). What the advance
//! asked for beyond the money credited into the final invoice is therefore no
//! longer owed as such: left open, the patient would be asked twice (the open
//! advance plus the final invoice). Issued invoices are never edited (GoBD):
//! that rest is closed by the documented correction, an ordinary credit note
//! (`CN-…`, gapless number, VAT per rate in the advance's own split, archived
//! PDF, audit) on the advance invoice, in the transaction that releases the
//! final invoice. Cash the patient paid on the advance beyond what the final
//! invoice used becomes a refundable credit balance of the advance.
//!
//! The same correction follows a credit note on a final invoice that brings it
//! below the advance money credited into it (a service dropped after the
//! patient prepaid): the excess allocation is released and the advance's rest
//! is closed, so the money is refundable. A credit note on a patient invoice
//! that re-bills a supplier cost reverses the part of the cost allocation the
//! credit takes back: the cost is unbilled again, as after a Storno.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Row, Transaction};
use uuid::Uuid;

use super::{
    CreditNoteIssue, InvoicePaymentContext, IssuedCreditNote, can_manage_invoice_finance,
    coded_err, credit_notes, decimal_to_string, ensure_patient_access, err, load_invoice_detail,
    load_invoice_for_credit_note, plan_credit_note_tx, recompute_invoice_settlement_status,
    store_credit_note_tx, write_invoice_audit_tx,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;

/// `final_invoice` settles `advance`: same order and patient, both issued
/// and active, the advance issued first, billed to the same recipient (or an
/// advance billing confirmed by number at the final's release), and of the
/// same quote unless the final invoice settles the whole order (no quote,
/// cancelled order) or the advance's quote was replaced or closed.
pub(crate) const FINAL_SETTLES_ADVANCE: &str = r#"
    final_invoice.order_id = advance.order_id
    AND final_invoice.patient_id = advance.patient_id
    AND final_invoice.invoice_type = 'final'
    AND final_invoice.status NOT IN ('draft', 'cancelled')
    AND advance.invoice_type = 'advance'
    AND advance.status NOT IN ('draft', 'cancelled')
    AND advance.issued_at <= final_invoice.issued_at
    AND (
        invoice_recipient_identity(advance.recipient_snapshot)
            IS NOT DISTINCT FROM invoice_recipient_identity(final_invoice.recipient_snapshot)
        OR COALESCE(
               final_invoice.recipient_snapshot -> 'confirmations'
                   -> 'advance_recipient_mismatch' -> 'advance_invoice_numbers',
               '[]'::jsonb
           ) ? advance.invoice_number
    )
    AND (
        final_invoice.quote_id IS NULL
        OR advance.quote_id IS NULL
        OR advance.quote_id = final_invoice.quote_id
        OR EXISTS (
            SELECT 1 FROM orders settled_order
            WHERE settled_order.id = final_invoice.order_id
              AND settled_order.status = 'cancelled'
        )
        OR EXISTS (
            SELECT 1 FROM quotes advance_quote
            WHERE advance_quote.id = advance.quote_id
              AND advance_quote.status IN ('superseded', 'rejected', 'expired')
        )
    )"#;

/// What an advance still asks for beyond the money credited from it into
/// settlement invoices: its corrected total minus its allocations.
pub(crate) fn advance_rest(total_gross: Decimal, credited: Decimal, allocated: Decimal) -> Decimal {
    (total_gross - credited - allocated).max(Decimal::ZERO)
}

/// Which rest of an advance a credit note closes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AdvanceRest {
    /// What the patient has not paid: the request the final invoice replaces.
    /// Paid money not credited yet stays available for the order's invoices.
    Unpaid,
    /// Everything not credited into a settlement invoice: unpaid parts are
    /// dropped, paid money becomes a refundable credit balance.
    Unused,
}

impl AdvanceRest {
    pub fn amount(
        self,
        total_gross: Decimal,
        credited: Decimal,
        paid: Decimal,
        allocated: Decimal,
    ) -> Decimal {
        match self {
            Self::Unpaid => advance_rest(total_gross, credited, paid.max(allocated)),
            Self::Unused => advance_rest(total_gross, credited, allocated),
        }
    }
}

/// The oldest released final invoice that settles the advance.
pub(crate) struct SettlingFinal {
    pub id: Uuid,
    pub invoice_number: String,
    pub balance_due: Decimal,
}

pub(crate) async fn settling_final_invoice(
    conn: &mut PgConnection,
    advance_invoice_id: Uuid,
) -> Result<Option<SettlingFinal>, sqlx::Error> {
    let sql = format!(
        r#"SELECT final_invoice.id, final_invoice.invoice_number,
                  GREATEST(final_invoice.total_gross - final_invoice.credited_amount
                           - final_invoice.paid_amount - final_invoice.prepayment_applied_amount,
                           0) AS balance_due
           FROM invoices advance
           JOIN invoices final_invoice ON {FINAL_SETTLES_ADVANCE}
           WHERE advance.id = $1
           ORDER BY final_invoice.issued_at, final_invoice.id
           LIMIT 1"#
    );
    let Some(row) = sqlx::query(&sql)
        .bind(advance_invoice_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };
    Ok(Some(SettlingFinal {
        id: row.try_get("id")?,
        invoice_number: row
            .try_get::<Option<String>, _>("invoice_number")?
            .unwrap_or_default(),
        balance_due: row.try_get("balance_due")?,
    }))
}

async fn allocated_from_advance(
    conn: &mut PgConnection,
    advance_invoice_id: Uuid,
) -> Result<Decimal, sqlx::Error> {
    sqlx::query_scalar::<_, Decimal>(
        r#"SELECT COALESCE(SUM(amount_gross), 0)
           FROM invoice_prepayment_allocations
           WHERE advance_invoice_id = $1"#,
    )
    .bind(advance_invoice_id)
    .fetch_one(conn)
    .await
}

/// The advance block of the invoice detail: which final invoice settles it
/// and what rest a credit note would still close (0 once closed): `open_rest`
/// everything not credited into a settlement invoice, `unpaid_rest` the part
/// of it the patient never paid.
pub(crate) async fn advance_settlement_json(
    conn: &mut PgConnection,
    advance_invoice_id: Uuid,
    total_gross: Decimal,
    credited: Decimal,
    paid: Decimal,
) -> Result<Value, sqlx::Error> {
    let Some(settling) = settling_final_invoice(conn, advance_invoice_id).await? else {
        return Ok(Value::Null);
    };
    let allocated = allocated_from_advance(conn, advance_invoice_id).await?;
    Ok(json!({
        "final_invoice_id": settling.id,
        "final_invoice_number": settling.invoice_number,
        "final_balance_due": decimal_to_string(settling.balance_due),
        "applied_amount": decimal_to_string(allocated),
        "open_rest": decimal_to_string(
            AdvanceRest::Unused.amount(total_gross, credited, paid, allocated)
        ),
        "unpaid_rest": decimal_to_string(
            AdvanceRest::Unpaid.amount(total_gross, credited, paid, allocated)
        ),
    }))
}

fn failed_response(error: sqlx::Error, invoice_id: Uuid, step: &str) -> axum::response::Response {
    tracing::error!(%error, %invoice_id, step, "advance settlement");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to create credit note",
    )
}

/// Closes what the advance still asks for (`scope`) with a credit note,
/// inside the caller's transaction. `None` when nothing is left. The caller
/// discards the document when its commit fails and publishes the credit note
/// after it.
pub(super) async fn close_advance_rest_tx(
    transaction: &mut Transaction<'_, Postgres>,
    advance_invoice_id: Uuid,
    final_invoice_number: &str,
    actor_id: Uuid,
    scope: AdvanceRest,
) -> Result<Option<IssuedCreditNote>, axum::response::Response> {
    let Some((context, _)) = load_invoice_for_credit_note(transaction, advance_invoice_id, true)
        .await
        .map_err(|error| failed_response(error, advance_invoice_id, "lock advance"))?
    else {
        return Ok(None);
    };
    if matches!(context.invoice_status.as_str(), "draft" | "cancelled") {
        return Ok(None);
    }
    let paid = sqlx::query_scalar::<_, Decimal>("SELECT paid_amount FROM invoices WHERE id = $1")
        .bind(advance_invoice_id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| failed_response(error, advance_invoice_id, "advance cash"))?;
    let allocated = allocated_from_advance(transaction, advance_invoice_id)
        .await
        .map_err(|error| failed_response(error, advance_invoice_id, "advance allocations"))?;
    let rest = scope.amount(
        context.total_gross,
        context.credited_amount,
        paid,
        allocated,
    );
    if rest <= Decimal::ZERO {
        return Ok(None);
    }
    let existing = credit_notes::load_active_credits(transaction, advance_invoice_id)
        .await
        .map_err(|error| failed_response(error, advance_invoice_id, "advance credits"))?;
    let creditable = credit_notes::creditable_lines(&context.line_items, &existing);
    let Some(selection) = credit_notes::proportional_selection(&creditable, rest) else {
        return Ok(None);
    };
    let request_selection = selection.to_json();
    let reason = format!(
        "Restbetrag der Anzahlungsrechnung {} – abgerechnet mit der Schlussrechnung {}",
        context.invoice_number.trim(),
        final_invoice_number.trim()
    );
    let issue = CreditNoteIssue {
        selection: &selection,
        request_selection: &request_selection,
        reason: &reason,
        issued_on: crate::app_time::today(),
        portal_visible: true,
        request_id: Uuid::new_v4(),
        user_id: actor_id,
        source_order_leistung_id: None,
    };
    let plan = plan_credit_note_tx(transaction, &context, issue.selection).await?;
    let issued = store_credit_note_tx(
        transaction,
        &context,
        &issue,
        &plan,
        json!({
            "advance_rest": true,
            "settled_by_invoice_number": final_invoice_number,
        }),
    )
    .await?;
    Ok(Some(issued))
}

/// After a final invoice was released (and the paid advances were credited
/// into it): closes what every advance it settles asked for and was not
/// paid. Paid money not credited yet stays available to the order.
pub(super) async fn close_settled_advances_tx(
    transaction: &mut Transaction<'_, Postgres>,
    final_invoice_id: Uuid,
    actor_id: Uuid,
) -> Result<Vec<IssuedCreditNote>, axum::response::Response> {
    let sql = format!(
        r#"SELECT advance.id, final_invoice.invoice_number
           FROM invoices final_invoice
           JOIN invoices advance ON {FINAL_SETTLES_ADVANCE}
           WHERE final_invoice.id = $1
           ORDER BY advance.issued_at, advance.id"#
    );
    let rows = sqlx::query(&sql)
        .bind(final_invoice_id)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|error| failed_response(error, final_invoice_id, "settled advances"))?;
    let mut issued: Vec<IssuedCreditNote> = Vec::new();
    for row in rows {
        let advance_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let final_number = row
            .try_get::<Option<String>, _>("invoice_number")
            .unwrap_or_default()
            .unwrap_or_default();
        match close_advance_rest_tx(
            transaction,
            advance_id,
            &final_number,
            actor_id,
            AdvanceRest::Unpaid,
        )
        .await
        {
            Ok(Some(credit)) => issued.push(credit),
            Ok(None) => {}
            Err(response) => {
                for credit in &mut issued {
                    credit.discard_document().await;
                }
                return Err(response);
            }
        }
    }
    Ok(issued)
}

/// What a credit note had to release so that the invoice keeps its rules:
/// advance money credited into it and re-billed supplier costs.
#[derive(Debug, Default, Clone)]
pub(crate) struct CreditRoom {
    /// `(advance invoice, amount)` released from this invoice.
    pub released_prepayments: Vec<(Uuid, Decimal)>,
    /// `(supplier invoice, amount)` no longer billed by this invoice.
    pub reversed_supplier_costs: Vec<(Uuid, Decimal)>,
}

impl CreditRoom {
    pub fn released_advance_ids(&self) -> Vec<Uuid> {
        let mut ids = self
            .released_prepayments
            .iter()
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        ids
    }

    pub fn audit_json(&self) -> Value {
        json!({
            "released_prepayments": self.released_prepayments.iter().map(|(id, amount)| json!({
                "advance_invoice_id": id,
                "amount_gross": decimal_to_string(*amount),
            })).collect::<Vec<_>>(),
            "reversed_supplier_cost_allocations": self.reversed_supplier_costs.iter().map(|(id, amount)| json!({
                "external_invoice_id": id,
                "amount_gross": decimal_to_string(*amount),
            })).collect::<Vec<_>>(),
        })
    }
}

/// What a credit note of `credit_gross` on the invoice would release:
/// `(prepayment, supplier cost)` gross. For the credit-note form and the
/// service-cancellation preview.
pub(super) async fn credit_room_needed(
    conn: &mut PgConnection,
    context: &InvoicePaymentContext,
    credit_gross: Decimal,
) -> Result<(Decimal, Decimal), sqlx::Error> {
    let remaining = context.total_gross - context.credited_amount - credit_gross;
    let external = active_supplier_cost_allocations(conn, context.invoice_id).await?;
    Ok((
        (context.prepayment_applied_amount - remaining).max(Decimal::ZERO),
        (external - remaining).max(Decimal::ZERO),
    ))
}

async fn active_supplier_cost_allocations(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Decimal, sqlx::Error> {
    sqlx::query_scalar::<_, Decimal>(
        r#"SELECT COALESCE(SUM(allocation.amount_gross), 0)
           FROM external_invoice_patient_invoice_allocations allocation
           JOIN external_invoices external ON external.id = allocation.external_invoice_id
           WHERE allocation.patient_invoice_id = $1
             AND allocation.reversed_at IS NULL
             AND external.status <> 'cancelled'"#,
    )
    .bind(invoice_id)
    .fetch_one(conn)
    .await
}

/// Prepares the invoice for a credit note of `credit_gross`, inside the
/// caller's transaction (the invoice row is locked):
///
/// * an advance invoice cannot be credited below what was already credited
///   from it into settlement invoices (409 `credit_note_below_applied_advance`:
///   release it on that invoice first);
/// * a settlement invoice releases the advance money credited into it beyond
///   its corrected total (newest allocation first; a part is re-applied);
/// * a patient invoice reverses the supplier-cost allocations beyond its
///   corrected total (newest first; a part is re-allocated): the cost is
///   unbilled again.
pub(super) async fn make_room_for_credit_tx(
    transaction: &mut Transaction<'_, Postgres>,
    context: &InvoicePaymentContext,
    credit_gross: Decimal,
    actor_id: Uuid,
) -> Result<CreditRoom, axum::response::Response> {
    let invoice_id = context.invoice_id;
    let failed = |error: sqlx::Error, step: &str| failed_response(error, invoice_id, step);
    let remaining = context.total_gross - context.credited_amount - credit_gross;
    let mut room = CreditRoom::default();

    let used_from_advance = allocated_from_advance(transaction, invoice_id)
        .await
        .map_err(|error| failed(error, "advance allocations"))?;
    if used_from_advance > Decimal::ZERO && remaining < used_from_advance {
        return Err(coded_err(
            StatusCode::CONFLICT,
            "credit_note_below_applied_advance",
            "The advance is credited into a final invoice; release that amount on the final invoice before crediting the advance",
            json!({
                "applied_gross": decimal_to_string(used_from_advance),
                "creditable_gross": decimal_to_string(
                    (context.total_gross - context.credited_amount - used_from_advance)
                        .max(Decimal::ZERO)
                ),
            }),
        ));
    }

    let excess_prepayment = context.prepayment_applied_amount - remaining.max(Decimal::ZERO);
    if excess_prepayment > Decimal::ZERO {
        sqlx::query("SELECT set_config('gmed.accounting_actor_id', $1, true)")
            .bind(actor_id.to_string())
            .execute(&mut **transaction)
            .await
            .map_err(|error| failed(error, "release actor"))?;
        let allocations = sqlx::query(
            r#"SELECT id, advance_invoice_id, amount_gross
               FROM invoice_prepayment_allocations
               WHERE target_invoice_id = $1
               ORDER BY created_at DESC, id DESC
               FOR UPDATE"#,
        )
        .bind(invoice_id)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|error| failed(error, "lock prepayment allocations"))?;
        let mut left = excess_prepayment;
        for allocation in allocations {
            if left <= Decimal::ZERO {
                break;
            }
            let allocation_id = allocation.try_get::<Uuid, _>("id").unwrap_or_default();
            let advance_id = allocation
                .try_get::<Uuid, _>("advance_invoice_id")
                .unwrap_or_default();
            let amount = allocation
                .try_get::<Decimal, _>("amount_gross")
                .unwrap_or(Decimal::ZERO);
            let take = amount.min(left);
            // Allocations are immutable: release it (kept in the release
            // history) and re-apply what stays.
            sqlx::query("DELETE FROM invoice_prepayment_allocations WHERE id = $1")
                .bind(allocation_id)
                .execute(&mut **transaction)
                .await
                .map_err(|error| failed(error, "release prepayment allocation"))?;
            let keep = amount - take;
            if keep > Decimal::ZERO {
                let request_id = Uuid::new_v4();
                let new_id = sqlx::query_scalar::<_, Uuid>(
                    r#"INSERT INTO invoice_prepayment_allocations (
                            request_id, advance_invoice_id, target_invoice_id, amount_gross, created_by
                       ) VALUES ($1, $2, $3, $4, $5)
                       RETURNING id"#,
                )
                .bind(request_id)
                .bind(advance_id)
                .bind(invoice_id)
                .bind(keep)
                .bind(actor_id)
                .fetch_one(&mut **transaction)
                .await
                .map_err(|error| failed(error, "re-apply prepayment"))?;
                sqlx::query(
                    r#"INSERT INTO invoice_prepayment_allocation_requests (
                            target_invoice_id, request_id, advance_invoice_id, amount_gross,
                            allocation_id, created_by
                       ) VALUES ($1, $2, $3, $4, $5, $6)"#,
                )
                .bind(invoice_id)
                .bind(request_id)
                .bind(advance_id)
                .bind(keep)
                .bind(new_id)
                .bind(actor_id)
                .execute(&mut **transaction)
                .await
                .map_err(|error| failed(error, "re-apply prepayment request"))?;
            }
            write_invoice_audit_tx(
                transaction,
                actor_id,
                "release_invoice_prepayment",
                invoice_id,
                json!({
                    "allocation_id": allocation_id,
                    "advance_invoice_id": advance_id,
                    "amount_gross": decimal_to_string(take),
                    "kept_gross": decimal_to_string(keep),
                    "patient_id": context.patient_id,
                    "automatic": true,
                    "trigger": "credit_note",
                }),
            )
            .await
            .map_err(|error| failed(error, "audit prepayment release"))?;
            room.released_prepayments.push((advance_id, take));
            left -= take;
        }
        recompute_invoice_settlement_status(transaction, invoice_id)
            .await
            .map_err(|error| failed(error, "recompute after prepayment release"))?;
    }

    let supplier_costs = active_supplier_cost_allocations(transaction, invoice_id)
        .await
        .map_err(|error| failed(error, "supplier cost allocations"))?;
    let excess_supplier = supplier_costs - remaining.max(Decimal::ZERO);
    if excess_supplier > Decimal::ZERO {
        let allocations = sqlx::query(
            r#"SELECT allocation.id, allocation.external_invoice_id, allocation.amount_gross
               FROM external_invoice_patient_invoice_allocations allocation
               JOIN external_invoices external ON external.id = allocation.external_invoice_id
               WHERE allocation.patient_invoice_id = $1
                 AND allocation.reversed_at IS NULL
                 AND external.status <> 'cancelled'
               ORDER BY allocation.created_at DESC, allocation.id DESC
               FOR UPDATE OF allocation"#,
        )
        .bind(invoice_id)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|error| failed(error, "lock supplier cost allocations"))?;
        let note = format!(
            "Rechnungskorrektur (Gutschrift) zu {}",
            context.invoice_number.trim()
        );
        let mut left = excess_supplier;
        for allocation in allocations {
            if left <= Decimal::ZERO {
                break;
            }
            let allocation_id = allocation.try_get::<Uuid, _>("id").unwrap_or_default();
            let external_id = allocation
                .try_get::<Uuid, _>("external_invoice_id")
                .unwrap_or_default();
            let amount = allocation
                .try_get::<Decimal, _>("amount_gross")
                .unwrap_or(Decimal::ZERO);
            let take = amount.min(left);
            sqlx::query(
                r#"UPDATE external_invoice_patient_invoice_allocations
                   SET reversed_at = now(), reversed_by = $2, reversal_note = $3
                   WHERE id = $1 AND reversed_at IS NULL"#,
            )
            .bind(allocation_id)
            .bind(actor_id)
            .bind(&note)
            .execute(&mut **transaction)
            .await
            .map_err(|error| failed(error, "reverse supplier cost allocation"))?;
            let keep = amount - take;
            if keep > Decimal::ZERO {
                sqlx::query(
                    r#"INSERT INTO external_invoice_patient_invoice_allocations (
                            external_invoice_id, patient_invoice_id, amount_gross, created_by
                       ) VALUES ($1, $2, $3, $4)"#,
                )
                .bind(external_id)
                .bind(invoice_id)
                .bind(keep)
                .bind(actor_id)
                .execute(&mut **transaction)
                .await
                .map_err(|error| failed(error, "re-allocate supplier cost"))?;
            }
            audit::write_in_transaction(
                transaction,
                &audit::domain_event(
                    "reverse_external_invoice_receivable_allocation",
                    Some(actor_id),
                    "external_invoice",
                    Some(external_id),
                    json!({
                        "allocation_id": allocation_id,
                        "patient_invoice_id": invoice_id,
                        "amount_gross": decimal_to_string(take),
                        "kept_gross": decimal_to_string(keep),
                        "note": note,
                        "automatic": true,
                        "trigger": "credit_note",
                    }),
                ),
            )
            .await
            .map_err(|error| failed(error, "audit supplier cost reversal"))?;
            room.reversed_supplier_costs.push((external_id, take));
            left -= take;
        }
    }
    Ok(room)
}

/// `POST /invoices/{id}/advance-rest`: closes the rest of an advance invoice
/// that a released final invoice settles (for advances released before this
/// rule, or after an allocation was released by hand). CEO and Billing.
pub(super) async fn close_advance_rest(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_manage_invoice_finance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let patient_id = match sqlx::query_scalar::<_, Uuid>(
        "SELECT patient_id FROM invoices WHERE id = $1 AND invoice_type = 'advance'",
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(patient_id)) => patient_id,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => return failed_response(error, invoice_id, "load advance"),
    };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(error) => return failed_response(error, invoice_id, "begin"),
    };
    let settling = match settling_final_invoice(&mut transaction, invoice_id).await {
        Ok(Some(value)) => value,
        Ok(None) => {
            return coded_err(
                StatusCode::CONFLICT,
                "advance_not_settled_by_final_invoice",
                "No released final invoice settles this advance invoice yet",
                json!({}),
            );
        }
        Err(error) => return failed_response(error, invoice_id, "settling final"),
    };
    let mut issued = match close_advance_rest_tx(
        &mut transaction,
        invoice_id,
        &settling.invoice_number,
        auth.user_id,
        AdvanceRest::Unused,
    )
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => {
            return coded_err(
                StatusCode::CONFLICT,
                "advance_rest_already_closed",
                "The advance invoice has no open rest",
                json!({}),
            );
        }
        Err(response) => return response,
    };
    if let Err(error) = transaction.commit().await {
        issued.discard_document().await;
        return failed_response(error, invoice_id, "commit");
    }
    issued.publish(&state, auth.user_id).await;
    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => (
            StatusCode::CREATED,
            Json(json!({
                "credit_note_transaction_id": issued.id,
                "document_number": issued.document_number,
                "amount_gross": decimal_to_string(issued.gross),
                "invoice": invoice,
            })),
        )
            .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rest_of_an_advance_is_what_no_settlement_invoice_uses() {
        let dec = |value: i64| Decimal::from(value);
        // D-56: 1000 asked, 600 paid and credited into the final invoice.
        assert_eq!(advance_rest(dec(1000), dec(0), dec(600)), dec(400));
        assert_eq!(
            AdvanceRest::Unpaid.amount(dec(1000), dec(0), dec(600), dec(600)),
            dec(400)
        );
        // D-63: 300 prepaid, the final keeps 285.60 after a credit note: the
        // unused 14.40 is closed (refundable), nothing was left unpaid.
        let kept = Decimal::new(28560, 2);
        assert_eq!(
            AdvanceRest::Unused.amount(dec(300), dec(0), dec(300), kept),
            Decimal::new(1440, 2)
        );
        assert_eq!(
            AdvanceRest::Unpaid.amount(dec(300), dec(0), dec(300), kept),
            dec(0)
        );
        // Paid but not credited yet (another open invoice of the order may
        // still take it): the release of a final invoice leaves it alone.
        assert_eq!(
            AdvanceRest::Unpaid.amount(dec(700), dec(0), dec(700), dec(29)),
            dec(0)
        );
        assert_eq!(advance_rest(dec(300), dec(100), dec(200)), dec(0));
        assert_eq!(advance_rest(dec(300), dec(150), dec(200)), dec(0));
    }
}
