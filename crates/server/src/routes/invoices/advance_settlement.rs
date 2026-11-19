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

use super::advance_rows;
use super::document::{
    DeductedAdvance, VatBreakdownRow, advance_vat_rows, deducted_advance_rows,
    load_deducted_advances,
};
use super::{
    CreditNoteIssue, InvoicePaymentContext, IssuedCreditNote, can_manage_invoice_finance,
    coded_err, credit_notes, decimal_to_string, ensure_patient_access, err, load_invoice_detail,
    load_invoice_for_credit_note, plan_credit_note_tx, recompute_invoice_settlement_status,
    store_credit_note_tx, write_invoice_audit_tx,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;

/// Same quote, unless the final invoice settles the whole order (no quote,
/// cancelled order) or the advance's quote was replaced or closed (SQL over
/// `final_invoice` and `advance`).
macro_rules! final_quote_covers_advance {
    () => {
        r#"(
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
    )"#
    };
}

/// `final_invoice` settles `advance`: same order and patient, both issued
/// and active, the advance released first, billed to the same recipient (or
/// an advance billing confirmed by number at the final's release), and of the
/// same quote unless the final invoice settles the whole order (no quote,
/// cancelled order) or the advance's quote was replaced or closed.
///
/// "Released first" compares the release order (`release_sequence`, a
/// database sequence taken at the release), not the clock: `issued_at` is the
/// `now()` of two transactions and a clock that steps back between them left
/// the advance unsettled (flaky `invoice_payer_api` test, 2026-10-12).
/// Invoices released before the sequence existed fall back to `issued_at`.
pub(crate) const FINAL_SETTLES_ADVANCE: &str = concat!(
    r#"
    final_invoice.order_id = advance.order_id
    AND final_invoice.patient_id = advance.patient_id
    AND final_invoice.invoice_type = 'final'
    AND final_invoice.status NOT IN ('draft', 'cancelled')
    AND advance.invoice_type = 'advance'
    AND advance.status NOT IN ('draft', 'cancelled')
    AND CASE
            WHEN advance.release_sequence IS NOT NULL
                 AND final_invoice.release_sequence IS NOT NULL
                THEN advance.release_sequence < final_invoice.release_sequence
            ELSE advance.issued_at <= final_invoice.issued_at
        END
    AND (
        invoice_recipient_identity(advance.recipient_snapshot)
            IS NOT DISTINCT FROM invoice_recipient_identity(final_invoice.recipient_snapshot)
        OR COALESCE(
               final_invoice.recipient_snapshot -> 'confirmations'
                   -> 'advance_recipient_mismatch' -> 'advance_invoice_numbers',
               '[]'::jsonb
           ) ? advance.invoice_number
    )
    AND "#,
    final_quote_covers_advance!()
);

/// The quote part of [`FINAL_SETTLES_ADVANCE`]: which advances a final
/// invoice (also a draft about to be released) bills, whoever received them.
pub(crate) const FINAL_QUOTE_COVERS_ADVANCE: &str = final_quote_covers_advance!();

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
           ORDER BY final_invoice.release_sequence NULLS FIRST, final_invoice.issued_at,
                    final_invoice.id
           LIMIT 1"#
    );
    let Some(row) = sqlx::query(sqlx::AssertSqlSafe::<&str>(&sql))
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
    final_release_invoice_id: Option<Uuid>,
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
    // The rest comes from the invoice balance above. An advance whose line
    // snapshot carries no amounts (seeded or early advances, QA D-55/D-56)
    // has no creditable lines: its rest is credited by amount with the
    // advance's own VAT split instead of being skipped.
    let creditable = credit_notes::creditable_lines_for_invoice(
        &context.line_items,
        &existing,
        context.total_gross,
    );
    // A categorised advance closes, per VAT category, what each category
    // has not paid (or deducted): its payments' splits are frozen, so a
    // manual split leaves categories paid unevenly (QA 2026-11-16 S1-1).
    let by_category = category_rest(transaction, advance_invoice_id, scope)
        .await
        .map_err(|error| failed_response(error, advance_invoice_id, "advance rest by category"))?
        .filter(|rows| rows.iter().map(|row| row.gross).sum::<Decimal>() == rest)
        .and_then(|rows| category_rest_selection(&creditable, &rows));
    let Some(selection) =
        by_category.or_else(|| credit_notes::proportional_selection(&creditable, rest))
    else {
        tracing::warn!(
            invoice_id = %advance_invoice_id,
            rest = %rest,
            "advance rest left open: no line of the advance can take the credit"
        );
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
        final_release_invoice_id,
    };
    let plan = plan_credit_note_tx(transaction, &context, issue.selection).await?;
    let issued = store_credit_note_tx(
        transaction,
        &context,
        &issue,
        &plan,
        &[],
        json!({
            "advance_rest": true,
            "settled_by_invoice_number": final_invoice_number,
        }),
    )
    .await?;
    Ok(Some(issued))
}

/// The rest of a categorised advance per VAT category: what each category
/// still asks beyond what it was paid (`Unpaid`, or deducted when that is
/// more) or deducted (`Unused`). `None` for an advance without line amounts.
async fn category_rest(
    conn: &mut PgConnection,
    advance_id: Uuid,
    scope: AdvanceRest,
) -> Result<Option<Vec<super::document::VatBreakdownRow>>, sqlx::Error> {
    if super::advance_rows::settlement_rows(conn, advance_id)
        .await?
        .is_none()
    {
        return Ok(None);
    }
    let (rows, paid) = super::advance_rows::advance_paid(conn, advance_id).await?;
    let mut allocated = Vec::new();
    for allocation in super::advance_rows::allocation_rows(conn, advance_id, true).await? {
        super::advance_rows::add_rows(&mut allocated, &allocation.rows);
    }
    let used = rows
        .iter()
        .map(|row| {
            let key = super::advance_rows::category_of(row);
            let sum = |items: &[super::document::VatBreakdownRow]| {
                items
                    .iter()
                    .filter(|item| super::advance_rows::category_of(item) == key)
                    .fold((Decimal::ZERO, Decimal::ZERO), |(gross, vat), item| {
                        (gross + item.gross, vat + item.vat)
                    })
            };
            let (allocated_gross, allocated_vat) = sum(&allocated);
            let (paid_gross, paid_vat) = sum(&paid);
            let (gross, vat) = match scope {
                AdvanceRest::Unpaid if paid_gross > allocated_gross => (paid_gross, paid_vat),
                _ => (allocated_gross, allocated_vat),
            };
            super::document::VatBreakdownRow {
                kind: key.0,
                rate: key.1,
                net: gross - vat,
                vat,
                gross,
            }
        })
        .collect::<Vec<_>>();
    let mut rest = super::advance_rows::subtract_rows(&rows, &used);
    rest.retain(|row| row.gross > Decimal::ZERO);
    Ok(Some(rest))
}

/// A credit of `rest` per VAT category, each category shared over its own
/// open lines; `None` when a category has no line to take it.
fn category_rest_selection(
    creditable: &[credit_notes::CreditableLine],
    rest: &[super::document::VatBreakdownRow],
) -> Option<credit_notes::CreditSelection> {
    let mut selected = Vec::new();
    for row in rest {
        let key = super::advance_rows::category_of(row);
        let lines = creditable
            .iter()
            .filter(|line| {
                super::advance_rows::category_for(line.is_cost_passthrough, line.vat_rate) == key
            })
            .cloned()
            .collect::<Vec<_>>();
        match credit_notes::proportional_selection(&lines, row.gross)? {
            credit_notes::CreditSelection::Lines(items) => selected.extend(items),
            _ => return None,
        }
    }
    (!selected.is_empty()).then_some(credit_notes::CreditSelection::Lines(selected))
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
           ORDER BY advance.release_sequence NULLS FIRST, advance.issued_at, advance.id"#
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe::<&str>(&sql))
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
            Some(final_invoice_id),
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

/// Paid advance money that a released final invoice took as a payment.
pub(crate) struct AppliedAdvanceRest {
    pub advance_invoice_id: Uuid,
    pub advance_invoice_number: String,
    pub credit_transfer_id: Uuid,
    pub amount_gross: Decimal,
    pub payload: Value,
}

/// What the release of a final invoice did beyond deducting its advances.
#[derive(Default)]
pub(super) struct ReleaseRests {
    /// Credit notes on the advances for the paid share no category of the
    /// final takes (the VAT correction of that share).
    pub credit_notes: Vec<IssuedCreditNote>,
    /// That money moved onto the final as a payment.
    pub transfers: Vec<AppliedAdvanceRest>,
}

impl ReleaseRests {
    pub async fn discard_documents(&mut self) {
        for credit in &mut self.credit_notes {
            credit.discard_document().await;
        }
    }

    pub fn audit_json(&self) -> Value {
        json!({
            "advance_rest_credit_notes": self
                .credit_notes
                .iter()
                .map(IssuedCreditNote::summary_json)
                .collect::<Vec<_>>(),
            "advance_rest_transfers": self.transfers.iter().map(|transfer| json!({
                "credit_transfer_id": transfer.credit_transfer_id,
                "advance_invoice_id": transfer.advance_invoice_id,
                "advance_invoice_number": transfer.advance_invoice_number,
                "amount_gross": decimal_to_string(transfer.amount_gross),
            })).collect::<Vec<_>>(),
        })
    }
}

/// After the deductions of a released final invoice (owner 2026-11-17,
/// verify2-A S2-1): an advance may hold paid money in a VAT category the
/// final bills less of (own services came out lower, pass-through costs
/// higher). The deduction stays per category (§ 14 Abs. 5 Satz 2 UStG); the
/// rest is applied to the final anyway as a payment against what it still
/// asks, so the patient pays one amount:
///
/// 1. a credit note on the advance closes its unused share per category
///    (the advance's VAT on a service that is not rendered is corrected);
/// 2. the paid money that share freed is moved onto the final by an ordinary
///    credit transfer (refund leg on the advance, payment leg on the final).
///
/// Both name the final (`final_release_invoice_id`); its Storno reverses
/// them. Nothing happens when the final asks for nothing more (the rest
/// stays on the advance for the close-rest / refund path, fix-96) or the
/// advance belongs to another recipient (credit never moves to another
/// person, owner 2026-11-12). Advances in release order, oldest first.
pub(super) async fn apply_advance_rests_tx(
    transaction: &mut Transaction<'_, Postgres>,
    final_invoice_id: Uuid,
    actor_id: Uuid,
) -> Result<ReleaseRests, axum::response::Response> {
    let mut done = ReleaseRests::default();
    let sql = format!(
        r#"SELECT advance.id, advance.invoice_number AS advance_invoice_number,
                  final_invoice.invoice_number AS final_invoice_number,
                  (invoice_recipient_identity(advance.recipient_snapshot)
                      IS NOT DISTINCT FROM invoice_recipient_identity(final_invoice.recipient_snapshot))
                      AS same_recipient,
                  advance.recipient_snapshot ->> 'name' AS advance_recipient_name,
                  advance.payer_role AS advance_payer_role,
                  final_invoice.recipient_snapshot ->> 'name' AS final_recipient_name,
                  final_invoice.payer_role AS final_payer_role,
                  upper(advance.currency) = upper(final_invoice.currency) AS same_currency,
                  GREATEST(
                      LEAST(advance.paid_amount, advance.total_gross - advance.credited_amount)
                      - COALESCE((
                          SELECT SUM(allocation.amount_gross)
                          FROM invoice_prepayment_allocations allocation
                          WHERE allocation.advance_invoice_id = advance.id
                      ), 0),
                      0
                  ) AS unused_paid
           FROM invoices final_invoice
           JOIN invoices advance ON {FINAL_SETTLES_ADVANCE}
           WHERE final_invoice.id = $1
           ORDER BY advance.release_sequence NULLS FIRST, advance.issued_at, advance.id"#
    );
    let rows = match sqlx::query(sqlx::AssertSqlSafe::<&str>(&sql))
        .bind(final_invoice_id)
        .fetch_all(&mut **transaction)
        .await
    {
        Ok(rows) => rows,
        Err(error) => return Err(failed_response(error, final_invoice_id, "advance rests")),
    };
    for row in rows {
        let text = |column: &str| row.try_get::<Option<String>, _>(column).unwrap_or_default();
        let same_person = row
            .try_get::<Option<bool>, _>("same_recipient")
            .unwrap_or_default()
            .unwrap_or(false)
            || super::payer::advance_names_same_person(
                text("advance_recipient_name").as_deref(),
                text("advance_payer_role").as_deref(),
                text("final_recipient_name").as_deref().unwrap_or_default(),
                text("final_payer_role").as_deref(),
            );
        let unused_paid = row
            .try_get::<Decimal, _>("unused_paid")
            .unwrap_or(Decimal::ZERO);
        if !same_person
            || !row
                .try_get::<Option<bool>, _>("same_currency")
                .unwrap_or_default()
                .unwrap_or(false)
            || unused_paid <= Decimal::ZERO
        {
            continue;
        }
        let advance_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let final_number = text("final_invoice_number").unwrap_or_default();
        let final_open =
            match super::credit_transfers::load_locked_invoice(transaction, final_invoice_id).await
            {
                Ok(Some(value)) => value,
                Ok(None) => break,
                Err(error) => {
                    done.discard_documents().await;
                    return Err(failed_response(error, final_invoice_id, "lock final"));
                }
            };
        if final_open.balance_due() <= Decimal::ZERO {
            break;
        }
        match close_advance_rest_tx(
            transaction,
            advance_id,
            &final_number,
            actor_id,
            AdvanceRest::Unused,
            Some(final_invoice_id),
        )
        .await
        {
            Ok(Some(credit)) => done.credit_notes.push(credit),
            Ok(None) => {}
            Err(response) => {
                done.discard_documents().await;
                return Err(response);
            }
        }
        let advance =
            match super::credit_transfers::load_locked_invoice(transaction, advance_id).await {
                Ok(Some(value)) => value,
                Ok(None) => continue,
                Err(error) => {
                    done.discard_documents().await;
                    return Err(failed_response(error, advance_id, "lock advance rest"));
                }
            };
        let amount = advance
            .refundable_credit()
            .min(final_open.balance_due())
            .min(unused_paid);
        if amount <= Decimal::ZERO {
            continue;
        }
        let request = super::credit_transfers::TransferRequest {
            request_id: Uuid::new_v4(),
            amount_gross: amount,
            transferred_on: crate::app_time::today(),
            note: Some(format!(
                "Restbetrag der Anzahlungsrechnung {} – verrechnet mit der Schlussrechnung {}",
                advance.context.invoice_number.trim(),
                final_number.trim()
            )),
            actor_id,
            final_release_invoice_id: Some(final_invoice_id),
        };
        match super::credit_transfers::transfer_credit_tx(
            transaction,
            &request,
            &advance,
            &final_open,
        )
        .await
        {
            Ok(legs) => done.transfers.push(AppliedAdvanceRest {
                advance_invoice_id: advance_id,
                advance_invoice_number: advance.context.invoice_number.clone(),
                credit_transfer_id: legs.transfer_id,
                amount_gross: amount,
                payload: legs.payload,
            }),
            Err(response) => {
                done.discard_documents().await;
                return Err(response);
            }
        }
    }
    Ok(done)
}

/// The paid advance money the release of `final_invoice_id` moved onto it
/// and that is still there (not reversed): what its Storno gives back.
pub(crate) async fn release_rest_transfers_gross(
    conn: &mut PgConnection,
    final_invoice_id: Uuid,
) -> Result<Decimal, sqlx::Error> {
    sqlx::query_scalar::<_, Decimal>(
        r#"SELECT COALESCE(SUM(transfer.amount_gross), 0)
           FROM invoice_credit_transfers transfer
           WHERE transfer.final_release_invoice_id = $1
             AND transfer.target_invoice_id = $1
             AND NOT EXISTS (
                 SELECT 1 FROM invoice_payment_transactions reversal
                 WHERE reversal.reverses_transaction_id = transfer.target_payment_transaction_id
                   AND reversal.transaction_type = 'reversal'
             )"#,
    )
    .bind(final_invoice_id)
    .fetch_one(conn)
    .await
}

/// Storno of a final invoice, first step (verify2-A S2-3): the advance
/// money its release moved onto it goes back to the advances (credit
/// transfers reversed, newest first). Before the cash check of the Storno:
/// that money is no payment of the patient on this invoice.
pub(super) async fn reverse_release_transfers_tx(
    transaction: &mut Transaction<'_, Postgres>,
    final_invoice_id: Uuid,
    reason: &str,
    actor_id: Uuid,
    // Only what one credit note of the final moved (same transaction time,
    // QA3 B S1-3); `None`: everything the final's release moved.
    only_created_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Vec<Value>, axum::response::Response> {
    let ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT transfer.id
           FROM invoice_credit_transfers transfer
           WHERE transfer.final_release_invoice_id = $1
             AND transfer.target_invoice_id = $1
             AND NOT EXISTS (
                 SELECT 1 FROM invoice_payment_transactions reversal
                 WHERE reversal.reverses_transaction_id = transfer.target_payment_transaction_id
                   AND reversal.transaction_type = 'reversal'
             )
             AND ($2::TIMESTAMPTZ IS NULL OR transfer.created_at = $2)
           ORDER BY transfer.created_at DESC, transfer.id DESC"#,
    )
    .bind(final_invoice_id)
    .bind(only_created_at)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|error| failed_response(error, final_invoice_id, "release transfers"))?;
    let mut payloads = Vec::with_capacity(ids.len());
    for id in ids {
        let Some(transfer) = super::credit_transfers::load_stored_transfer(transaction, id)
            .await
            .map_err(|error| failed_response(error, final_invoice_id, "load release transfer"))?
        else {
            continue;
        };
        payloads.push(
            super::credit_transfers::reverse_credit_transfer_tx(
                transaction,
                &transfer,
                reason,
                crate::app_time::today().max(transfer.transferred_on),
                actor_id,
            )
            .await?,
        );
    }
    Ok(payloads)
}

/// A credit note of an advance reversed together with the Storno of the
/// final whose release issued it.
pub(crate) struct ReversedReleaseCredit {
    pub advance_invoice_id: Uuid,
    pub credit_note_id: Uuid,
    pub reversal_id: Uuid,
    pub patient_id: Uuid,
    pub amount_gross: Decimal,
    blob: Option<super::stored_documents::PendingBlob>,
}

impl ReversedReleaseCredit {
    pub async fn discard_document(&mut self) {
        if let Some(blob) = self.blob.take() {
            blob.discard().await;
        }
    }

    pub fn audit_json(&self) -> Value {
        json!({
            "advance_invoice_id": self.advance_invoice_id,
            "credit_note_transaction_id": self.credit_note_id,
            "reversal_transaction_id": self.reversal_id,
            "amount_gross": decimal_to_string(self.amount_gross),
        })
    }
}

/// Storno of a final invoice, last step (verify2-A S2-3), after its
/// deductions were released: the credit notes its release issued on the
/// advances (unpaid rest, unused rest) are reversed (CNR-…, the fix-100
/// reversal path), so each advance asks for what it asked before the final.
pub(super) async fn reverse_release_credit_notes_tx(
    transaction: &mut Transaction<'_, Postgres>,
    final_invoice_id: Uuid,
    reason: &str,
    actor_id: Uuid,
    only_created_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Vec<ReversedReleaseCredit>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT credit.id, credit.invoice_id, advance.patient_id
           FROM invoice_credit_note_transactions credit
           JOIN invoices advance ON advance.id = credit.invoice_id
           WHERE credit.final_release_invoice_id = $1
             AND credit.transaction_type = 'credit_note'
             AND NOT EXISTS (
                 SELECT 1 FROM invoice_credit_note_transactions reversal
                 WHERE reversal.reverses_transaction_id = credit.id
                   AND reversal.transaction_type = 'reversal'
             )
             AND ($2::TIMESTAMPTZ IS NULL OR credit.created_at = $2)
           ORDER BY credit.created_at DESC, credit.document_number DESC"#,
    )
    .bind(final_invoice_id)
    .bind(only_created_at)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|error| failed_response(error, final_invoice_id, "release credit notes"))?;
    let mut reversed: Vec<ReversedReleaseCredit> = Vec::with_capacity(rows.len());
    for row in rows {
        let credit_note_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let advance_id = row.try_get::<Uuid, _>("invoice_id").unwrap_or_default();
        let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
        match super::reverse_credit_note_tx(
            transaction,
            advance_id,
            credit_note_id,
            reason,
            crate::app_time::today(),
            actor_id,
            patient_id,
        )
        .await
        {
            Ok(value) => reversed.push(ReversedReleaseCredit {
                advance_invoice_id: advance_id,
                credit_note_id,
                reversal_id: value.reversal_id,
                patient_id,
                amount_gross: value.amount_gross,
                blob: value.document.blob,
            }),
            Err(response) => {
                for item in &mut reversed {
                    item.discard_document().await;
                }
                return Err(response);
            }
        }
    }
    Ok(reversed)
}

/// What a credit note had to release so that the invoice keeps its rules:
/// advance money credited into it and re-billed supplier costs.
#[derive(Debug, Default, Clone)]
pub(crate) struct CreditRoom {
    /// `(advance invoice, amount)` released from this invoice.
    pub released_prepayments: Vec<(Uuid, Decimal)>,
    /// `(supplier invoice, amount)` no longer billed by this invoice.
    pub reversed_supplier_costs: Vec<(Uuid, Decimal)>,
    /// The released advance deductions per advance and VAT category, as the
    /// credit-note document states them.
    pub(super) released_advances: Vec<DeductedAdvance>,
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
            "released_advances": super::storno::deducted_advances_to_json(&self.released_advances),
            "reversed_supplier_cost_allocations": self.reversed_supplier_costs.iter().map(|(id, amount)| json!({
                "external_invoice_id": id,
                "amount_gross": decimal_to_string(*amount),
            })).collect::<Vec<_>>(),
        })
    }
}

/// What a credit note planned as `plan` on the invoice would release:
/// `(prepayment, supplier cost)` gross, by the rules of
/// [`make_room_for_credit_tx`]. For the service-cancellation preview: it
/// credits service lines, so no re-billing line adds to the cap.
pub(super) async fn credit_room_needed(
    conn: &mut PgConnection,
    context: &InvoicePaymentContext,
    plan: &credit_notes::CreditNotePlan,
) -> Result<(Decimal, Decimal), sqlx::Error> {
    let remaining = context.total_gross - context.credited_amount - plan.gross;
    let external = active_supplier_cost_allocations(conn, context.invoice_id).await?;
    let mut released = Decimal::ZERO;
    if context.prepayment_applied_amount > Decimal::ZERO {
        if let Some(billed) = rows_after_credit(conn, context, plan_as_credit(plan)).await? {
            let allocations = target_allocations(conn, context.invoice_id, false).await?;
            let kept = kept_allocation_rows(
                &billed,
                &allocations
                    .iter()
                    .map(|allocation| (allocation.stored, allocation.rows.clone()))
                    .collect::<Vec<_>>(),
            );
            for (allocation, kept) in allocations.iter().zip(kept) {
                if let Some(kept) = kept {
                    released +=
                        allocation.amount - kept.iter().map(|row| row.gross).sum::<Decimal>();
                }
            }
        }
        released += (context.prepayment_applied_amount - released - remaining.max(Decimal::ZERO))
            .max(Decimal::ZERO);
    }
    Ok((released, (external - remaining).max(Decimal::ZERO)))
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
/// * a patient invoice reverses the supplier-cost allocations of the credited
///   lines that re-bill them, and those beyond its corrected total (newest
///   first; a part is re-allocated): the cost is unbilled again.
pub(super) async fn make_room_for_credit_tx(
    transaction: &mut Transaction<'_, Postgres>,
    context: &InvoicePaymentContext,
    plan: &credit_notes::CreditNotePlan,
    actor_id: Uuid,
) -> Result<CreditRoom, axum::response::Response> {
    let invoice_id = context.invoice_id;
    let failed = |error: sqlx::Error, step: &str| failed_response(error, invoice_id, step);
    let remaining = context.total_gross - context.credited_amount - plan.gross;
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

    if context.prepayment_applied_amount > Decimal::ZERO {
        release_prepayments_for_credit(transaction, context, plan, remaining, actor_id, &mut room)
            .await?;
    }

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
    let takes = supplier_cost_takes(
        &allocations
            .iter()
            .map(|allocation| {
                (
                    allocation
                        .try_get::<Uuid, _>("external_invoice_id")
                        .unwrap_or_default(),
                    allocation
                        .try_get::<Decimal, _>("amount_gross")
                        .unwrap_or(Decimal::ZERO),
                )
            })
            .collect::<Vec<_>>(),
        &credited_supplier_costs(&context.line_items, &plan.lines),
        remaining,
    );
    if takes.iter().any(|take| *take > Decimal::ZERO) {
        let note = format!(
            "Rechnungskorrektur (Gutschrift) zu {}",
            context.invoice_number.trim()
        );
        for (allocation, take) in allocations.iter().zip(takes) {
            if take <= Decimal::ZERO {
                continue;
            }
            let allocation_id = allocation.try_get::<Uuid, _>("id").unwrap_or_default();
            let external_id = allocation
                .try_get::<Uuid, _>("external_invoice_id")
                .unwrap_or_default();
            let amount = allocation
                .try_get::<Decimal, _>("amount_gross")
                .unwrap_or(Decimal::ZERO);
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
        }
    }
    Ok(room)
}

/// An advance allocation credited into a settlement invoice, with its rows
/// per VAT category: stored (`stored`), or for allocations made before the
/// rows were stored, the advance's pro rata share (the reading of the
/// settlement invoice's document).
struct TargetAllocation {
    id: Uuid,
    advance_id: Uuid,
    amount: Decimal,
    stored: bool,
    rows: Vec<VatBreakdownRow>,
}

/// The allocations credited into `invoice_id`, oldest first; `lock` locks
/// them for this transaction.
async fn target_allocations(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    lock: bool,
) -> Result<Vec<TargetAllocation>, sqlx::Error> {
    let sql = if lock {
        "SELECT id, advance_invoice_id, amount_gross, vat_rows
         FROM invoice_prepayment_allocations
         WHERE target_invoice_id = $1
         ORDER BY created_at, id
         FOR UPDATE"
    } else {
        "SELECT id, advance_invoice_id, amount_gross, vat_rows
         FROM invoice_prepayment_allocations
         WHERE target_invoice_id = $1
         ORDER BY created_at, id"
    };
    let rows = sqlx::query(sql)
        .bind(invoice_id)
        .fetch_all(&mut *conn)
        .await?;
    let mut allocations = Vec::with_capacity(rows.len());
    for row in rows {
        let advance_id = row.try_get::<Uuid, _>("advance_invoice_id")?;
        let amount = row.try_get::<Decimal, _>("amount_gross")?;
        let stored = row
            .try_get::<Option<Value>, _>("vat_rows")?
            .and_then(|value| advance_rows::rows_from_json(&value));
        let (stored, rows) = match stored {
            Some(rows) => (true, rows),
            None => (
                false,
                deducted_advance_rows(&advance_rows::advance_rows(conn, advance_id).await?, amount),
            ),
        };
        allocations.push(TargetAllocation {
            id: row.try_get("id")?,
            advance_id,
            amount,
            stored,
            rows,
        });
    }
    Ok(allocations)
}

/// What the settlement invoice bills per VAT category once `credit` joins
/// its active credit notes; `None` when its lines carry no amounts.
async fn rows_after_credit(
    conn: &mut PgConnection,
    context: &InvoicePaymentContext,
    credit: credit_notes::ExistingCredit,
) -> Result<Option<Vec<VatBreakdownRow>>, sqlx::Error> {
    if !credit_notes::line_snapshot_carries_total(&context.line_items, context.total_gross) {
        return Ok(None);
    }
    let mut credits = credit_notes::load_active_credits(conn, context.invoice_id).await?;
    credits.push(credit);
    Ok(Some(advance_vat_rows(&context.line_items, &credits)))
}

fn plan_as_credit(plan: &credit_notes::CreditNotePlan) -> credit_notes::ExistingCredit {
    credit_notes::ExistingCredit {
        vat: plan.vat,
        gross: plan.gross,
        lines: (!plan.lines.is_empty()).then(|| plan.lines.clone()),
    }
}

/// `base` less `minus`, per category of `base`; categories left at zero are
/// dropped.
fn rows_less(base: &[VatBreakdownRow], minus: &[VatBreakdownRow]) -> Vec<VatBreakdownRow> {
    base.iter()
        .filter_map(|row| {
            let key = advance_rows::category_of(row);
            let (gross, vat) = minus
                .iter()
                .filter(|item| advance_rows::category_of(item) == key)
                .fold((row.gross, row.vat), |(gross, vat), item| {
                    (gross - item.gross, vat - item.vat)
                });
            (!gross.is_zero() || !vat.is_zero()).then_some(VatBreakdownRow {
                kind: key.0,
                rate: key.1,
                net: gross - vat,
                vat,
                gross,
            })
        })
        .collect()
}

/// What each allocation keeps (`None`: unchanged) when the settlement invoice
/// bills `billed` per VAT category: never more in a category than the
/// invoice still bills there beyond the older allocations, so the newest
/// give way first. Allocations without stored rows keep their reading (the
/// gross rule handles them) and take their room first.
fn kept_allocation_rows(
    billed: &[VatBreakdownRow],
    allocations: &[(bool, Vec<VatBreakdownRow>)],
) -> Vec<Option<Vec<VatBreakdownRow>>> {
    let mut left = billed.to_vec();
    allocations
        .iter()
        .map(|(stored, rows)| {
            let kept = if *stored {
                let gross = rows.iter().map(|row| row.gross).sum::<Decimal>();
                advance_rows::plan_allocation_rows(rows, &left, gross)
            } else {
                rows.clone()
            };
            left = advance_rows::subtract_rows(&left, &kept);
            (*stored && !rows_less(rows, &kept).is_empty()).then_some(kept)
        })
        .collect()
}

/// The advance deductions a credit note released: what each advance
/// deducted before less what it deducts after, per VAT category.
fn released_advances(
    before: &[DeductedAdvance],
    after: &[DeductedAdvance],
) -> Vec<DeductedAdvance> {
    before
        .iter()
        .filter_map(|advance| {
            let kept = after
                .iter()
                .find(|item| {
                    item.invoice_number == advance.invoice_number
                        && item.issue_date == advance.issue_date
                })
                .map(|item| item.rows.as_slice())
                .unwrap_or_default();
            let mut rows = rows_less(&advance.rows, kept);
            rows.retain(|row| row.gross > Decimal::ZERO);
            (!rows.is_empty()).then(|| DeductedAdvance {
                invoice_number: advance.invoice_number.clone(),
                issue_date: advance.issue_date,
                rows,
            })
        })
        .collect()
}

/// Releases the advance money a credit note leaves the settlement invoice no
/// longer billing (QA 2026-11-16, fix-81 open items):
///
/// 1. per VAT category: after the credit note no category deducts more gross
///    or VAT than the invoice still bills there (the rule of the final
///    release, `advance_rows::plan_allocation_rows`); the newest allocation
///    gives way first, the rest is re-applied with its rows;
/// 2. by gross, for invoices whose lines carry no amounts and allocations
///    made before rows were stored: nothing beyond the corrected total
///    (newest first, a part is re-applied pro rata).
///
/// Released allocations stay in the release history; each release is
/// audited. `room` receives what was released, per advance and per category
/// as the credit-note document prints it.
async fn release_prepayments_for_credit(
    transaction: &mut Transaction<'_, Postgres>,
    context: &InvoicePaymentContext,
    plan: &credit_notes::CreditNotePlan,
    remaining: Decimal,
    actor_id: Uuid,
    room: &mut CreditRoom,
) -> Result<(), axum::response::Response> {
    let invoice_id = context.invoice_id;
    let failed = |error: sqlx::Error, step: &str| failed_response(error, invoice_id, step);
    let before = load_deducted_advances(transaction, invoice_id)
        .await
        .map_err(|error| failed(error, "deducted advances"))?;
    let mut release_context_set = false;

    if let Some(billed) = rows_after_credit(transaction, context, plan_as_credit(plan))
        .await
        .map_err(|error| failed(error, "invoice rows after credit"))?
    {
        let allocations = target_allocations(transaction, invoice_id, true)
            .await
            .map_err(|error| failed(error, "lock prepayment allocations"))?;
        let kept = kept_allocation_rows(
            &billed,
            &allocations
                .iter()
                .map(|allocation| (allocation.stored, allocation.rows.clone()))
                .collect::<Vec<_>>(),
        );
        let changes = allocations
            .iter()
            .zip(kept)
            .filter_map(|(allocation, kept)| kept.map(|kept| (allocation, kept)))
            .collect::<Vec<_>>();
        if !changes.is_empty() {
            set_release_context(transaction, actor_id)
                .await
                .map_err(|error| failed(error, "release actor"))?;
            release_context_set = true;
            // Every changed allocation is released before the kept parts are
            // re-applied: each insert is checked against the categories.
            for (allocation, _) in &changes {
                sqlx::query("DELETE FROM invoice_prepayment_allocations WHERE id = $1")
                    .bind(allocation.id)
                    .execute(&mut **transaction)
                    .await
                    .map_err(|error| failed(error, "release prepayment allocation"))?;
            }
            for (allocation, kept) in &changes {
                let keep = kept.iter().map(|row| row.gross).sum::<Decimal>();
                if keep > Decimal::ZERO {
                    advance_rows::insert_allocation(
                        transaction,
                        Uuid::new_v4(),
                        allocation.advance_id,
                        invoice_id,
                        keep,
                        Some(kept),
                        actor_id,
                    )
                    .await
                    .map_err(|error| failed(error, "re-apply prepayment"))?;
                }
                let take = allocation.amount - keep;
                write_invoice_audit_tx(
                    transaction,
                    actor_id,
                    "release_invoice_prepayment",
                    invoice_id,
                    json!({
                        "allocation_id": allocation.id,
                        "advance_invoice_id": allocation.advance_id,
                        "amount_gross": decimal_to_string(take),
                        "kept_gross": decimal_to_string(keep),
                        "released_vat_rows": advance_rows::rows_to_json(&rows_less(&allocation.rows, kept)),
                        "kept_vat_rows": advance_rows::rows_to_json(kept),
                        "by_vat_category": true,
                        "patient_id": context.patient_id,
                        "automatic": true,
                        "trigger": "credit_note",
                    }),
                )
                .await
                .map_err(|error| failed(error, "audit prepayment release"))?;
                room.released_prepayments
                    .push((allocation.advance_id, take));
            }
        }
    }

    let applied = sqlx::query_scalar::<_, Decimal>(
        "SELECT COALESCE(SUM(amount_gross), 0) FROM invoice_prepayment_allocations
         WHERE target_invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| failed(error, "applied prepayment"))?;
    let mut left = applied - remaining.max(Decimal::ZERO);
    if left > Decimal::ZERO {
        if !release_context_set {
            set_release_context(transaction, actor_id)
                .await
                .map_err(|error| failed(error, "release actor"))?;
        }
        let allocations = target_allocations(transaction, invoice_id, true)
            .await
            .map_err(|error| failed(error, "lock prepayment allocations"))?;
        for allocation in allocations.iter().rev() {
            if left <= Decimal::ZERO {
                break;
            }
            let take = allocation.amount.min(left);
            // Allocations are immutable: release it (kept in the release
            // history) and re-apply what stays.
            sqlx::query("DELETE FROM invoice_prepayment_allocations WHERE id = $1")
                .bind(allocation.id)
                .execute(&mut **transaction)
                .await
                .map_err(|error| failed(error, "release prepayment allocation"))?;
            let keep = allocation.amount - take;
            if keep > Decimal::ZERO {
                // The kept part keeps the VAT categories of the released one.
                let kept_rows = allocation
                    .stored
                    .then(|| deducted_advance_rows(&allocation.rows, keep));
                advance_rows::insert_allocation(
                    transaction,
                    Uuid::new_v4(),
                    allocation.advance_id,
                    invoice_id,
                    keep,
                    kept_rows.as_deref(),
                    actor_id,
                )
                .await
                .map_err(|error| failed(error, "re-apply prepayment"))?;
            }
            write_invoice_audit_tx(
                transaction,
                actor_id,
                "release_invoice_prepayment",
                invoice_id,
                json!({
                    "allocation_id": allocation.id,
                    "advance_invoice_id": allocation.advance_id,
                    "amount_gross": decimal_to_string(take),
                    "kept_gross": decimal_to_string(keep),
                    "patient_id": context.patient_id,
                    "automatic": true,
                    "trigger": "credit_note",
                }),
            )
            .await
            .map_err(|error| failed(error, "audit prepayment release"))?;
            room.released_prepayments
                .push((allocation.advance_id, take));
            left -= take;
        }
    }

    if !room.released_prepayments.is_empty() {
        recompute_invoice_settlement_status(transaction, invoice_id)
            .await
            .map_err(|error| failed(error, "recompute after prepayment release"))?;
        let after = load_deducted_advances(transaction, invoice_id)
            .await
            .map_err(|error| failed(error, "deducted advances after release"))?;
        room.released_advances = released_advances(&before, &after);
    }
    Ok(())
}

async fn set_release_context(
    transaction: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT set_config('gmed.accounting_actor_id', $1, true),
                set_config('gmed.prepayment_release_context', 'correction', true)",
    )
    .bind(actor_id.to_string())
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// Gross a credit note takes from the lines that re-bill a supplier cost, per
/// supplier invoice.
fn credited_supplier_costs(
    line_items: &Value,
    credited: &[credit_notes::CreditNoteLine],
) -> Vec<(Uuid, Decimal)> {
    let items = line_items.as_array().map(Vec::as_slice).unwrap_or_default();
    let mut costs = Vec::<(Uuid, Decimal)>::new();
    for line in credited {
        let Some(external_id) = items
            .get(line.invoice_line_index)
            .and_then(|item| item.get("source_external_invoice_id"))
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
        else {
            continue;
        };
        match costs.iter_mut().find(|(id, _)| *id == external_id) {
            Some((_, gross)) => *gross += line.gross,
            None => costs.push((external_id, line.gross)),
        }
    }
    costs
}

/// What a credit note takes from each active supplier-cost allocation
/// (`(supplier invoice, amount)`, newest first): what it credits on the line
/// re-billing that cost, even when the rest of a mixed invoice still covers
/// the amount (QA 2026-10-31: the cost stayed "billed", so neither re-billing
/// nor a waiver could take it), then whatever the corrected total
/// (`remaining_total`) no longer covers.
fn supplier_cost_takes(
    allocations: &[(Uuid, Decimal)],
    credited: &[(Uuid, Decimal)],
    remaining_total: Decimal,
) -> Vec<Decimal> {
    let mut takes = vec![Decimal::ZERO; allocations.len()];
    for (external_id, gross) in credited {
        let mut left = *gross;
        for ((allocation_external, amount), take) in allocations.iter().zip(takes.iter_mut()) {
            if allocation_external == external_id {
                let part = (*amount - *take).min(left);
                *take += part;
                left -= part;
            }
        }
    }
    let allocated = allocations
        .iter()
        .map(|(_, amount)| *amount)
        .sum::<Decimal>();
    let mut left = allocated - takes.iter().sum::<Decimal>() - remaining_total.max(Decimal::ZERO);
    for ((_, amount), take) in allocations.iter().zip(takes.iter_mut()) {
        if left <= Decimal::ZERO {
            break;
        }
        let part = (*amount - *take).min(left);
        *take += part;
        left -= part;
    }
    takes
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
        None,
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
    use crate::routes::invoices::document::VatGroupKind;

    fn row(kind: VatGroupKind, rate: &str, vat: &str, gross: &str) -> VatBreakdownRow {
        let (vat, gross) = (
            vat.parse::<Decimal>().unwrap(),
            gross.parse::<Decimal>().unwrap(),
        );
        VatBreakdownRow {
            kind,
            rate: rate.parse().unwrap(),
            net: gross - vat,
            vat,
            gross,
        }
    }

    /// The fix-81 open item: a partial credit note removes the whole 19 %
    /// category of a final while its total stays above the deductions. The
    /// 19 % deduction is released in full, the 0 % one stays.
    #[test]
    fn a_credit_note_removing_a_category_releases_its_deduction() {
        let billed = vec![row(VatGroupKind::ZeroRated, "0", "0", "1000")];
        let allocation = vec![
            row(VatGroupKind::Taxed, "19", "36.33", "227.53"),
            row(VatGroupKind::ZeroRated, "0", "0", "272.47"),
        ];
        let kept = kept_allocation_rows(&billed, &[(true, allocation.clone())]);
        let kept = kept[0].clone().expect("changed");
        assert_eq!(kept, vec![row(VatGroupKind::ZeroRated, "0", "0", "272.47")]);
        assert_eq!(
            rows_less(&allocation, &kept),
            vec![row(VatGroupKind::Taxed, "19", "36.33", "227.53")]
        );
    }

    /// Within a category: the newest allocation gives way first, gross and
    /// VAT stay within what the category still bills.
    #[test]
    fn the_newest_allocation_gives_way_within_a_category() {
        // 19 % billed after the credit note: 119,00 / VAT 19,00.
        let billed = vec![row(VatGroupKind::Taxed, "19", "19.00", "119.00")];
        let older = vec![row(VatGroupKind::Taxed, "19", "15.97", "100.00")];
        let newer = vec![row(VatGroupKind::Taxed, "19", "15.97", "100.00")];
        let kept = kept_allocation_rows(&billed, &[(true, older), (true, newer)]);
        assert!(kept[0].is_none(), "the older allocation fits");
        let newer_kept = kept[1].clone().expect("changed");
        assert_eq!(newer_kept[0].gross, Decimal::new(1900, 2));
        assert!(newer_kept[0].vat <= Decimal::new(303, 2), "{newer_kept:?}");
        // Nothing changes when the category still bills enough.
        let kept = kept_allocation_rows(
            &[row(VatGroupKind::Taxed, "19", "38.00", "238.00")],
            &[(
                true,
                vec![row(VatGroupKind::Taxed, "19", "15.97", "100.00")],
            )],
        );
        assert!(kept[0].is_none());
    }

    #[test]
    fn released_advances_are_the_difference_per_advance() {
        let date = chrono::NaiveDate::from_ymd_opt(2026, 11, 16).unwrap();
        let advance = |number: &str, rows| DeductedAdvance {
            invoice_number: number.to_string(),
            issue_date: date,
            rows,
        };
        let before = vec![
            advance(
                "A-1",
                vec![
                    row(VatGroupKind::Taxed, "19", "36.33", "227.53"),
                    row(VatGroupKind::ZeroRated, "0", "0", "272.47"),
                ],
            ),
            advance("A-2", vec![row(VatGroupKind::ZeroRated, "0", "0", "100")]),
        ];
        let after = vec![
            advance(
                "A-1",
                vec![row(VatGroupKind::ZeroRated, "0", "0", "272.47")],
            ),
            advance("A-2", vec![row(VatGroupKind::ZeroRated, "0", "0", "100")]),
        ];
        assert_eq!(
            released_advances(&before, &after),
            vec![advance(
                "A-1",
                vec![row(VatGroupKind::Taxed, "19", "36.33", "227.53")]
            )]
        );
        assert_eq!(released_advances(&before, &[]), before);
    }

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

    #[test]
    fn a_credited_supplier_line_unbills_its_cost_and_the_total_caps_the_rest() {
        let dec = |value: i64| Decimal::from(value);
        let hotel = Uuid::from_u128(1);
        let clinic = Uuid::from_u128(2);
        // Service 500 + hotel 100: crediting the hotel line leaves 500, which
        // would still "cover" 100.
        assert_eq!(
            supplier_cost_takes(&[(hotel, dec(100))], &[(hotel, dec(100))], dec(500)),
            vec![dec(100)]
        );
        // The credit stops at what is allocated; another cost stays billed.
        assert_eq!(
            supplier_cost_takes(
                &[(clinic, dec(50)), (hotel, dec(80))],
                &[(hotel, dec(100))],
                dec(500)
            ),
            vec![dec(0), dec(80)]
        );
        // A service credit below the costs reverses the newest first (D-64).
        assert_eq!(
            supplier_cost_takes(&[(clinic, dec(20)), (hotel, dec(100))], &[], dec(30)),
            vec![dec(20), dec(70)]
        );
        // Both: the credited line first, then the cap.
        assert_eq!(
            supplier_cost_takes(
                &[(clinic, dec(50)), (hotel, dec(100))],
                &[(hotel, dec(100))],
                dec(20)
            ),
            vec![dec(30), dec(100)]
        );
    }

    #[test]
    fn only_lines_naming_a_supplier_invoice_count_as_credited_costs() {
        let hotel = Uuid::from_u128(1);
        let lines = json!([
            { "description": "Service" },
            { "description": "Hotel", "source_external_invoice_id": hotel.to_string() },
        ]);
        let credited = |index: usize, gross: i64| credit_notes::CreditNoteLine {
            invoice_line_index: index,
            description: String::new(),
            quantity: None,
            unit_price: None,
            vat_rate: Decimal::ZERO,
            is_cost_passthrough: false,
            discount_percent: Decimal::ZERO,
            net: Decimal::from(gross),
            vat: Decimal::ZERO,
            gross: Decimal::from(gross),
        };
        assert_eq!(
            credited_supplier_costs(&lines, &[credited(0, 500), credited(1, 40)]),
            vec![(hotel, Decimal::from(40))]
        );
    }
}
