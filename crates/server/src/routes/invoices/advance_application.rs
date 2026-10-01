//! Paid advances applied to the final invoice of an order.
//!
//! An advance invoice is a request for prepayment; its cash settles the
//! order's final (settlement) invoice. When the final invoice is released —
//! or when an advance is paid after the final invoice was released — the
//! order's paid advances that are not applied yet are credited against the
//! final invoice automatically, oldest advance first and up to what the final
//! invoice still asks for. Each credit is an ordinary prepayment allocation
//! (the same rows, idempotency record and audit event as the manual
//! "apply prepayment" action, marked automatic), so it can be released and
//! re-applied by hand. Interim invoices keep the manual action.

use rust_decimal::Decimal;
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use super::decimal_to_string;
use crate::audit;
use crate::state::AppState;

/// One advance credited against a settlement invoice.
#[derive(Debug, Clone)]
pub(crate) struct AppliedAdvance {
    pub allocation_id: Uuid,
    pub request_id: Uuid,
    pub target_invoice_id: Uuid,
    pub advance_invoice_id: Uuid,
    pub advance_invoice_number: String,
    pub amount_gross: Decimal,
    pub patient_id: Uuid,
}

/// Amounts to take from each advance (oldest first) to cover `open` of the
/// target invoice: `(advance index, amount)` pairs.
pub(crate) fn plan_advance_application(
    open: Decimal,
    available: &[Decimal],
) -> Vec<(usize, Decimal)> {
    let mut left = open.max(Decimal::ZERO);
    let mut plan = Vec::new();
    for (index, amount) in available.iter().enumerate() {
        if left <= Decimal::ZERO {
            break;
        }
        let take = (*amount).min(left);
        if take > Decimal::ZERO {
            plan.push((index, take));
            left -= take;
        }
    }
    plan
}

/// Credits the order's paid, unapplied advances against a released final
/// invoice inside the caller's transaction. Returns nothing for other invoice
/// types, drafts, cancelled or settled invoices and orders without advances.
/// The caller recomputes the invoice status afterwards.
pub(crate) async fn apply_available_advances_tx(
    transaction: &mut Transaction<'_, Postgres>,
    target_invoice_id: Uuid,
    actor_id: Uuid,
) -> Result<Vec<AppliedAdvance>, sqlx::Error> {
    let Some(target) = sqlx::query(
        r#"SELECT order_id, patient_id, invoice_type, status, total_gross, credited_amount,
                  paid_amount, prepayment_applied_amount
           FROM invoices
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(target_invoice_id)
    .fetch_optional(&mut **transaction)
    .await?
    else {
        return Ok(Vec::new());
    };
    let Some(order_id) = target.try_get::<Option<Uuid>, _>("order_id")? else {
        return Ok(Vec::new());
    };
    let status = target.try_get::<String, _>("status")?;
    if target.try_get::<String, _>("invoice_type")? != "final"
        || matches!(status.as_str(), "draft" | "cancelled")
    {
        return Ok(Vec::new());
    }
    let patient_id = target.try_get::<Uuid, _>("patient_id")?;
    let open = target.try_get::<Decimal, _>("total_gross")?
        - target.try_get::<Decimal, _>("credited_amount")?
        - target.try_get::<Decimal, _>("paid_amount")?
        - target.try_get::<Decimal, _>("prepayment_applied_amount")?;
    if open <= Decimal::ZERO {
        return Ok(Vec::new());
    }

    let advances = sqlx::query(
        r#"SELECT advance.id, advance.invoice_number,
                  GREATEST(
                      LEAST(advance.paid_amount, advance.total_gross - advance.credited_amount)
                      - COALESCE((
                          SELECT SUM(allocation.amount_gross)
                          FROM invoice_prepayment_allocations allocation
                          WHERE allocation.advance_invoice_id = advance.id
                      ), 0),
                      0
                  ) AS available_amount
           FROM invoices advance
           WHERE advance.order_id = $1
             AND advance.patient_id = $2
             AND advance.invoice_type = 'advance'
             AND advance.status NOT IN ('draft', 'cancelled')
             AND advance.paid_amount > 0
             -- § 14 Abs. 5 Satz 2 UStG: only advances billed to the same
             -- recipient, unless billing confirmed the difference at release.
             AND EXISTS (
                 SELECT 1 FROM invoices target
                 WHERE target.id = $3
                   AND (
                       COALESCE(target.recipient_snapshot -> 'confirmations'
                                ? 'advance_recipient_mismatch', false)
                       OR invoice_recipient_identity(advance.recipient_snapshot)
                          IS NOT DISTINCT FROM invoice_recipient_identity(target.recipient_snapshot)
                   )
             )
           ORDER BY advance.issued_at, advance.id
           FOR UPDATE OF advance"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(target_invoice_id)
    .fetch_all(&mut **transaction)
    .await?;
    let available = advances
        .iter()
        .map(|row| row.try_get::<Decimal, _>("available_amount"))
        .collect::<Result<Vec<_>, _>>()?;

    let mut applied = Vec::new();
    for (index, amount) in plan_advance_application(open, &available) {
        let advance = &advances[index];
        let advance_invoice_id = advance.try_get::<Uuid, _>("id")?;
        let request_id = Uuid::new_v4();
        let allocation_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO invoice_prepayment_allocations (
                    request_id, advance_invoice_id, target_invoice_id, amount_gross, created_by
               ) VALUES ($1, $2, $3, $4, $5)
               RETURNING id"#,
        )
        .bind(request_id)
        .bind(advance_invoice_id)
        .bind(target_invoice_id)
        .bind(amount)
        .bind(actor_id)
        .fetch_one(&mut **transaction)
        .await?;
        sqlx::query(
            r#"INSERT INTO invoice_prepayment_allocation_requests (
                    target_invoice_id, request_id, advance_invoice_id, amount_gross,
                    allocation_id, created_by
               ) VALUES ($1, $2, $3, $4, $5, $6)"#,
        )
        .bind(target_invoice_id)
        .bind(request_id)
        .bind(advance_invoice_id)
        .bind(amount)
        .bind(allocation_id)
        .bind(actor_id)
        .execute(&mut **transaction)
        .await?;
        applied.push(AppliedAdvance {
            allocation_id,
            request_id,
            target_invoice_id,
            advance_invoice_id,
            advance_invoice_number: advance.try_get("invoice_number")?,
            amount_gross: amount,
            patient_id,
        });
    }
    Ok(applied)
}

/// Released final invoices of an advance invoice's order that still ask for
/// money, oldest first: where a newly paid advance is credited.
pub(crate) async fn open_final_invoices_for_advance_tx(
    transaction: &mut Transaction<'_, Postgres>,
    advance_invoice_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        r#"SELECT final_invoice.id
           FROM invoices advance
           JOIN invoices final_invoice
             ON final_invoice.order_id = advance.order_id
            AND final_invoice.patient_id = advance.patient_id
           WHERE advance.id = $1
             AND advance.invoice_type = 'advance'
             AND final_invoice.invoice_type = 'final'
             AND final_invoice.status NOT IN ('draft', 'cancelled')
             AND final_invoice.total_gross - final_invoice.credited_amount
                 - final_invoice.paid_amount - final_invoice.prepayment_applied_amount > 0
           ORDER BY final_invoice.issued_at, final_invoice.id"#,
    )
    .bind(advance_invoice_id)
    .fetch_all(&mut **transaction)
    .await
}

/// Unapplied paid advance cash each of `invoice_ids` would receive, allocated
/// oldest first across the open settlement invoices of each order (the rule
/// of [`net_open_balances`] and of the automatic application).
pub(crate) async fn advance_credit_shares(
    pool: &sqlx::PgPool,
    invoice_ids: &[Uuid],
) -> Result<std::collections::BTreeMap<Uuid, Decimal>, sqlx::Error> {
    if invoice_ids.is_empty() {
        return Ok(std::collections::BTreeMap::new());
    }
    let rows = sqlx::query(
        r#"WITH advance_pool AS (
               SELECT advance.order_id,
                      SUM(GREATEST(
                          LEAST(advance.paid_amount, advance.total_gross - advance.credited_amount)
                          - COALESCE((
                              SELECT SUM(allocation.amount_gross)
                              FROM invoice_prepayment_allocations allocation
                              WHERE allocation.advance_invoice_id = advance.id
                          ), 0),
                          0
                      )) AS available
               FROM invoices advance
               WHERE advance.invoice_type = 'advance'
                 AND advance.status NOT IN ('draft', 'cancelled')
                 AND advance.order_id IN (
                     SELECT order_id FROM invoices WHERE id = ANY($1) AND order_id IS NOT NULL
                 )
               GROUP BY advance.order_id
           ), open_invoice AS (
               SELECT invoice.id, invoice.order_id,
                      GREATEST(invoice.total_gross - invoice.credited_amount
                               - invoice.paid_amount - invoice.prepayment_applied_amount, 0) AS due,
                      COALESCE(SUM(GREATEST(invoice.total_gross - invoice.credited_amount
                                            - invoice.paid_amount - invoice.prepayment_applied_amount, 0))
                          OVER (PARTITION BY invoice.order_id
                                ORDER BY invoice.issued_at, invoice.id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS due_before
               FROM invoices invoice
               JOIN advance_pool pool ON pool.order_id = invoice.order_id
               WHERE invoice.invoice_type <> 'advance'
                 AND invoice.status NOT IN ('draft', 'cancelled')
           )
           SELECT open_invoice.id,
                  LEAST(open_invoice.due, GREATEST(pool.available - open_invoice.due_before, 0))
                      AS share
           FROM open_invoice
           JOIN advance_pool pool ON pool.order_id = open_invoice.order_id
           WHERE open_invoice.id = ANY($1)"#,
    )
    .bind(invoice_ids)
    .fetch_all(pool)
    .await?;
    let mut shares = std::collections::BTreeMap::new();
    for row in rows {
        let share = row.try_get::<Decimal, _>("share")?;
        if share > Decimal::ZERO {
            shares.insert(row.try_get::<Uuid, _>("id")?, share);
        }
    }
    Ok(shares)
}

/// After commit: audit and realtime events of automatically applied advances,
/// and the reimbursed-document follow-up of invoices they settled.
pub(crate) async fn follow_up_applied_advances(
    state: &AppState,
    auth: &crate::auth::middleware::AuthUser,
    trigger: &str,
    applied: &[AppliedAdvance],
) {
    if applied.is_empty() {
        return;
    }
    publish_applied_advances(state, auth.user_id, trigger, applied).await;
    let mut settled = applied
        .iter()
        .map(|advance| advance.target_invoice_id)
        .collect::<Vec<_>>();
    settled.sort();
    settled.dedup();
    for invoice_id in settled {
        match sqlx::query("SELECT status, paid_at FROM invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(Some(row)) if row.try_get::<String, _>("status").unwrap_or_default() == "paid" => {
                if let Some(paid_at) = row
                    .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("paid_at")
                    .unwrap_or_default()
                    && let Err(response) =
                        super::sync_reimbursed_financial_documents_for_paid_invoice(
                            state,
                            invoice_id,
                            auth.user_id,
                            paid_at,
                        )
                        .await
                {
                    tracing::error!(
                        %invoice_id,
                        status = %response.status(),
                        "advance applied but reimbursed document follow-up failed"
                    );
                    state.audit_sender.try_send(audit::domain_event(
                        "prepayment_follow_up_failed",
                        Some(auth.user_id),
                        "invoice",
                        Some(invoice_id),
                        json!({
                            "trigger": trigger,
                            "follow_up": "reimbursed_financial_documents",
                        }),
                    ));
                }
            }
            Ok(_) => {}
            Err(error) => {
                tracing::error!(%error, %invoice_id, "load settlement after applied advance");
            }
        }
    }
}

fn applied_advance_payload(advance: &AppliedAdvance, trigger: &str) -> serde_json::Value {
    json!({
        "allocation_id": advance.allocation_id,
        "request_id": advance.request_id,
        "advance_invoice_id": advance.advance_invoice_id,
        "advance_invoice_number": advance.advance_invoice_number,
        "amount_gross": decimal_to_string(advance.amount_gross),
        "patient_id": advance.patient_id,
        "automatic": true,
        "trigger": trigger,
    })
}

/// Audit rows of automatically applied advances, written in the transaction
/// that applied them.
pub(crate) async fn audit_applied_advances_tx(
    conn: &mut sqlx::PgConnection,
    actor_id: Uuid,
    trigger: &str,
    applied: &[AppliedAdvance],
) -> Result<(), sqlx::Error> {
    for advance in applied {
        audit::write_in_transaction(
            &mut *conn,
            &audit::domain_event(
                "apply_invoice_prepayment",
                Some(actor_id),
                "invoice",
                Some(advance.target_invoice_id),
                applied_advance_payload(advance, trigger),
            ),
        )
        .await?;
    }
    Ok(())
}

/// Realtime events of automatically applied advances, after commit (their
/// audit rows are written by [`audit_applied_advances_tx`]).
pub(crate) async fn publish_applied_advances(
    state: &AppState,
    actor_id: Uuid,
    trigger: &str,
    applied: &[AppliedAdvance],
) {
    for advance in applied {
        let payload = applied_advance_payload(advance, trigger);
        crate::realtime::publish_invoice_event(
            state,
            Some(actor_id),
            "invoice.prepayment_applied",
            advance.target_invoice_id,
            payload,
        )
        .await;
    }
}

/// One invoice as seen by a "still to pay" figure.
#[derive(Debug, Clone)]
pub(crate) struct OpenInvoice {
    pub order_id: Option<Uuid>,
    pub is_advance: bool,
    /// What the invoice itself still asks for.
    pub due: Decimal,
    /// Paid advance cash of an advance invoice not applied to any invoice yet.
    pub advance_available: Decimal,
    /// Cash beyond what the invoice asks for.
    pub credit_balance: Decimal,
    /// Oldest first: issue time, then id.
    pub issued_at: chrono::DateTime<chrono::Utc>,
    pub id: Uuid,
}

/// What an invoice still asks for once the patient's money already held is
/// counted: `advance_credit` from unapplied paid advances of the same order,
/// then `credit_applied` from credit balances anywhere on the patient's
/// invoices, `to_pay` what remains.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct NetDue {
    pub advance_credit: Decimal,
    pub credit_applied: Decimal,
    pub to_pay: Decimal,
}

/// Nets open invoice balances against money the patient already paid: paid
/// advances not yet applied settle the same order's settlement invoices
/// (oldest first, as the automatic application would), credit balances
/// settle any open invoice (oldest first). One rule for the order card, the
/// invoice list, the account statement and the portal.
pub(crate) fn net_open_balances(invoices: &[OpenInvoice]) -> Vec<NetDue> {
    let mut order = (0..invoices.len()).collect::<Vec<_>>();
    order.sort_by(|left, right| {
        (invoices[*left].issued_at, invoices[*left].id)
            .cmp(&(invoices[*right].issued_at, invoices[*right].id))
    });
    let mut result = vec![NetDue::default(); invoices.len()];
    let mut advance_pools = std::collections::BTreeMap::<Uuid, Decimal>::new();
    for invoice in invoices {
        if let (true, Some(order_id)) = (invoice.is_advance, invoice.order_id) {
            *advance_pools.entry(order_id).or_default() +=
                invoice.advance_available.max(Decimal::ZERO);
        }
    }
    let mut credit_pool: Decimal = invoices
        .iter()
        .map(|invoice| invoice.credit_balance.max(Decimal::ZERO))
        .sum();
    for index in &order {
        let invoice = &invoices[*index];
        let mut left = invoice.due.max(Decimal::ZERO);
        if !invoice.is_advance
            && let Some(pool) = invoice.order_id.and_then(|id| advance_pools.get_mut(&id))
        {
            let take = (*pool).min(left);
            *pool -= take;
            left -= take;
            result[*index].advance_credit = take;
        }
        result[*index].to_pay = left;
    }
    for index in &order {
        let take = credit_pool.min(result[*index].to_pay);
        credit_pool -= take;
        result[*index].credit_applied = take;
        result[*index].to_pay -= take;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(value: i64) -> Decimal {
        Decimal::from(value)
    }

    fn open(
        order: Option<u128>,
        is_advance: bool,
        due: i64,
        advance_available: i64,
        credit_balance: i64,
        day: i64,
    ) -> OpenInvoice {
        OpenInvoice {
            order_id: order.map(Uuid::from_u128),
            is_advance,
            due: dec(due),
            advance_available: dec(advance_available),
            credit_balance: dec(credit_balance),
            issued_at: chrono::DateTime::<chrono::Utc>::from_timestamp(day * 86_400, 0).unwrap(),
            id: Uuid::from_u128(day as u128),
        }
    }

    #[test]
    fn unapplied_advances_net_their_own_order_and_credit_nets_anything() {
        let invoices = [
            // Paid advance of 700 on order 1, final invoice of 1152.20 still open.
            open(Some(1), true, 0, 700, 0, 1),
            open(Some(1), false, 1152, 0, 0, 3),
            // Order 2: an open interim invoice, and an overpaid invoice of 50.
            open(Some(2), false, 300, 0, 0, 2),
            open(Some(2), false, 0, 0, 50, 4),
        ];
        let net = net_open_balances(&invoices);
        assert_eq!(net[1].advance_credit, dec(700));
        assert_eq!(
            net[2].advance_credit,
            dec(0),
            "advances stay within their order"
        );
        assert_eq!(
            net[2].credit_applied,
            dec(50),
            "oldest open invoice takes the credit"
        );
        assert_eq!(net[2].to_pay, dec(250));
        assert_eq!(net[1].to_pay, dec(452));
        assert_eq!(
            net.iter().map(|item| item.to_pay).sum::<Decimal>(),
            dec(702)
        );
    }

    #[test]
    fn advances_are_applied_oldest_first_up_to_the_open_balance() {
        assert_eq!(
            plan_advance_application(dec(1000), &[dec(700), dec(500)]),
            vec![(0, dec(700)), (1, dec(300))]
        );
        assert_eq!(
            plan_advance_application(dec(400), &[dec(700), dec(500)]),
            vec![(0, dec(400))]
        );
        assert_eq!(
            plan_advance_application(dec(1000), &[dec(0), dec(500)]),
            vec![(1, dec(500))]
        );
        assert!(plan_advance_application(dec(0), &[dec(700)]).is_empty());
    }
}
