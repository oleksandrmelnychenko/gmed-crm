//! Advance money per VAT category (money QA 2026-11-15).
//!
//! An advance invoice splits its amount over VAT categories (own services at
//! a rate, 0 % own services, pass-through costs). Its cash is split the same
//! way: pro rata over the categories (owner 2026-11-15), unless staff set the
//! split of a payment by hand. Each payment's split is frozen when it is
//! recorded (`invoice_payment_category_splits`, QA 2026-11-16 S1-1): a pro
//! rata payment stores the split computed then, a later payment never
//! re-spreads earlier cash. Payments recorded before keep the former reading
//! until the next payment on the advance freezes them with it. What an
//! advance deducts on a settlement invoice is planned per category: never
//! more than the advance holds in a category and never more than the
//! settlement invoice bills in it, so the final invoice cannot show negative
//! VAT. The rows are stored on the allocation (`vat_rows`); allocations made
//! before keep the former pro rata reading.

use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use std::collections::BTreeMap;
use uuid::Uuid;

use super::credit_notes;
use super::document::{VatBreakdownRow, VatGroupKind, advance_vat_rows, deducted_advance_rows};
use crate::money::CommercialRounding;

/// The category of a row: its kind and, for taxed rows, its rate.
pub(super) type Category = (VatGroupKind, Decimal);

pub(super) fn category_of(row: &VatBreakdownRow) -> Category {
    category(row.kind, row.rate)
}

pub(super) fn category(kind: VatGroupKind, rate: Decimal) -> Category {
    let rate = if kind == VatGroupKind::Taxed {
        rate.normalize()
    } else {
        Decimal::ZERO
    };
    (kind, rate)
}

/// The category of a line or a requested split part.
pub(super) fn category_for(is_cost_passthrough: bool, vat_rate: Decimal) -> Category {
    let kind = if vat_rate > Decimal::ZERO {
        VatGroupKind::Taxed
    } else if is_cost_passthrough {
        VatGroupKind::Passthrough
    } else {
        VatGroupKind::ZeroRated
    };
    category(kind, vat_rate)
}

pub(super) fn kind_key(kind: VatGroupKind) -> &'static str {
    match kind {
        VatGroupKind::Taxed => "taxed",
        VatGroupKind::ZeroRated => "zero_rated",
        VatGroupKind::Passthrough => "passthrough",
    }
}

fn kind_from_key(key: &str) -> Option<VatGroupKind> {
    match key {
        "taxed" => Some(VatGroupKind::Taxed),
        "zero_rated" => Some(VatGroupKind::ZeroRated),
        "passthrough" => Some(VatGroupKind::Passthrough),
        _ => None,
    }
}

fn json_decimal(value: &Value, key: &str) -> Option<Decimal> {
    match value.get(key)? {
        Value::String(text) => text.trim().parse().ok(),
        Value::Number(number) => number.to_string().parse().ok(),
        _ => None,
    }
}

pub(super) fn rows_to_json(rows: &[VatBreakdownRow]) -> Value {
    Value::Array(
        rows.iter()
            .map(|row| {
                json!({
                    "kind": kind_key(row.kind),
                    "rate": row.rate.normalize().to_string(),
                    "net": row.net.to_string(),
                    "vat": row.vat.to_string(),
                    "gross": row.gross.to_string(),
                })
            })
            .collect(),
    )
}

pub(super) fn rows_from_json(value: &Value) -> Option<Vec<VatBreakdownRow>> {
    let items = value.as_array()?;
    let mut rows = Vec::with_capacity(items.len());
    for item in items {
        let kind = kind_from_key(item.get("kind")?.as_str()?)?;
        let gross = json_decimal(item, "gross")?;
        let vat = json_decimal(item, "vat").unwrap_or(Decimal::ZERO);
        let (kind, rate) = category(kind, json_decimal(item, "rate").unwrap_or(Decimal::ZERO));
        rows.push(VatBreakdownRow {
            kind,
            rate,
            net: json_decimal(item, "net").unwrap_or(gross - vat),
            vat,
            gross,
        });
    }
    Some(rows)
}

/// Adds `rows` into `into`, category by category.
pub(super) fn add_rows(into: &mut Vec<VatBreakdownRow>, rows: &[VatBreakdownRow]) {
    for row in rows {
        let key = category_of(row);
        match into.iter_mut().find(|item| category_of(item) == key) {
            Some(item) => {
                item.net += row.net;
                item.vat += row.vat;
                item.gross += row.gross;
            }
            None => into.push(VatBreakdownRow {
                kind: key.0,
                rate: key.1,
                ..row.clone()
            }),
        }
    }
}

/// `base` less `minus` per category, never below zero.
pub(super) fn subtract_rows(
    base: &[VatBreakdownRow],
    minus: &[VatBreakdownRow],
) -> Vec<VatBreakdownRow> {
    base.iter()
        .map(|row| {
            let key = category_of(row);
            let (gross, vat) = minus
                .iter()
                .filter(|item| category_of(item) == key)
                .fold((Decimal::ZERO, Decimal::ZERO), |(gross, vat), item| {
                    (gross + item.gross, vat + item.vat)
                });
            let gross = (row.gross - gross).max(Decimal::ZERO);
            let vat = (row.vat - vat).max(Decimal::ZERO).min(gross);
            VatBreakdownRow {
                kind: key.0,
                rate: key.1,
                net: gross - vat,
                vat,
                gross,
            }
        })
        .collect()
}

/// The VAT of `gross` taken from a row holding `row_gross` / `row_vat`: all
/// of it for the whole row, else the same share.
fn vat_share(gross: Decimal, row_gross: Decimal, row_vat: Decimal) -> Decimal {
    if row_gross <= Decimal::ZERO || gross <= Decimal::ZERO {
        Decimal::ZERO
    } else if gross >= row_gross {
        row_vat
    } else {
        (gross * row_vat / row_gross).round_cents()
    }
}

/// Splits `amount` over `caps` in proportion to them, every part within its
/// cap; rounding cents go to the first part (not a pass-through cost) that
/// has room. `amount` must not exceed the sum of the caps.
fn split_within(amount: Decimal, caps: &[(VatGroupKind, Decimal)]) -> Vec<Decimal> {
    let total: Decimal = caps.iter().map(|(_, cap)| *cap).sum();
    if amount <= Decimal::ZERO || total <= Decimal::ZERO {
        return vec![Decimal::ZERO; caps.len()];
    }
    if amount >= total {
        return caps.iter().map(|(_, cap)| *cap).collect();
    }
    let mut parts = caps
        .iter()
        .map(|(_, cap)| (amount * *cap / total).round_cents().min(*cap))
        .collect::<Vec<_>>();
    let mut rest = amount - parts.iter().copied().sum::<Decimal>();
    let mut order = (0..caps.len()).collect::<Vec<_>>();
    order.sort_by_key(|index| caps[*index].0 == VatGroupKind::Passthrough);
    for index in order {
        if rest.is_zero() {
            break;
        }
        let room = caps[index].1 - parts[index];
        let take = if rest > Decimal::ZERO {
            rest.min(room)
        } else {
            rest.max(-parts[index])
        };
        parts[index] += take;
        rest -= take;
    }
    parts
}

/// What an advance's retained cash paid per category. Without a split set
/// by hand: pro rata (owner 2026-11-15), the reading of the payment booking
/// and of the former final-invoice deduction. Splits set by hand count as
/// they were set; the rest of the cash goes pro rata over what each category
/// still has open.
pub(super) fn advance_paid_rows(
    advance_rows: &[VatBreakdownRow],
    manual_splits: &[Vec<VatBreakdownRow>],
    cash: Decimal,
) -> Vec<VatBreakdownRow> {
    let capacity: Decimal = advance_rows.iter().map(|row| row.gross).sum();
    let cash = cash.round_cents().max(Decimal::ZERO).min(capacity);
    if manual_splits.is_empty() {
        return deducted_advance_rows(advance_rows, cash);
    }
    let fixed = advance_rows
        .iter()
        .map(|row| {
            let key = category_of(row);
            manual_splits
                .iter()
                .flatten()
                .filter(|part| category_of(part) == key)
                .map(|part| part.gross)
                .sum::<Decimal>()
                .min(row.gross)
                .max(Decimal::ZERO)
        })
        .collect::<Vec<_>>();
    let fixed_total: Decimal = fixed.iter().copied().sum();
    let paid = if cash <= fixed_total {
        // Cash gone (a reversal or refund): the manual parts shrink alike.
        let caps = advance_rows
            .iter()
            .zip(&fixed)
            .map(|(row, cap)| (row.kind, *cap))
            .collect::<Vec<_>>();
        split_within(cash, &caps)
    } else {
        let caps = advance_rows
            .iter()
            .zip(&fixed)
            .map(|(row, cap)| (row.kind, row.gross - *cap))
            .collect::<Vec<_>>();
        split_within(cash - fixed_total, &caps)
            .into_iter()
            .zip(&fixed)
            .map(|(part, cap)| part + *cap)
            .collect()
    };
    advance_rows
        .iter()
        .zip(paid)
        .filter(|(_, gross)| *gross > Decimal::ZERO)
        .map(|(row, gross)| {
            let vat = vat_share(gross, row.gross, row.vat);
            VatBreakdownRow {
                kind: row.kind,
                rate: row.rate,
                net: gross - vat,
                vat,
                gross,
            }
        })
        .collect()
}

/// The part of an advance a settlement invoice takes, per category: within
/// what the advance still holds (`available`) and what the settlement
/// invoice still bills (`target_open`) in each category, and at most `max`
/// gross. Pro rata over those limits when `max` is smaller.
pub(super) fn plan_allocation_rows(
    available: &[VatBreakdownRow],
    target_open: &[VatBreakdownRow],
    max: Decimal,
) -> Vec<VatBreakdownRow> {
    let caps = available
        .iter()
        .map(|row| {
            let key = category_of(row);
            let target = target_open
                .iter()
                .filter(|item| category_of(item) == key)
                .map(|item| item.gross)
                .sum::<Decimal>();
            (row.kind, row.gross.min(target).max(Decimal::ZERO))
        })
        .collect::<Vec<_>>();
    let parts = split_within(max.round_cents().max(Decimal::ZERO), &caps);
    available
        .iter()
        .zip(parts)
        .filter(|(_, gross)| *gross > Decimal::ZERO)
        .map(|(row, gross)| {
            let key = category_of(row);
            let target_vat = target_open
                .iter()
                .filter(|item| category_of(item) == key)
                .map(|item| item.vat)
                .sum::<Decimal>();
            let vat = vat_share(gross, row.gross, row.vat).min(target_vat.max(Decimal::ZERO));
            VatBreakdownRow {
                kind: key.0,
                rate: key.1,
                net: gross - vat,
                vat,
                gross,
            }
        })
        .collect()
}

/// A payment split set by hand (owner 2026-11-15): every part names a
/// category of the advance, none twice, none negative, none above what the
/// category still has open, and the parts add up to the payment. Returns the
/// rows to store (VAT as the category's share).
pub(super) fn validate_payment_split(
    advance_rows: &[VatBreakdownRow],
    paid_before: &[VatBreakdownRow],
    amount: Decimal,
    parts: &[(Category, Decimal)],
) -> Result<Vec<VatBreakdownRow>, &'static str> {
    let mut rows = Vec::new();
    let mut seen = Vec::new();
    for (key, gross) in parts {
        if *gross < Decimal::ZERO || *gross != gross.round_cents() {
            return Err("A split part must be zero or more, in cents");
        }
        if seen.contains(key) {
            return Err("A VAT category appears twice in the split");
        }
        seen.push(*key);
        let Some(row) = advance_rows.iter().find(|row| category_of(row) == *key) else {
            return Err("The split names a VAT category the advance does not have");
        };
        let paid: Decimal = paid_before
            .iter()
            .filter(|item| category_of(item) == *key)
            .map(|item| item.gross)
            .sum();
        if *gross > row.gross - paid {
            return Err("A split part exceeds what its VAT category has open");
        }
        if gross.is_zero() {
            continue;
        }
        rows.push(part_row(row, paid_before, *gross));
    }
    if rows.iter().map(|row| row.gross).sum::<Decimal>() != amount.round_cents() {
        return Err("The split must add up to the payment amount");
    }
    Ok(rows)
}

/// The cash booking targets of an advance booked by its payment rows: what
/// each category received (`paid`, see [`paid_rows`]), the rest patient
/// credit. Same shape as `invoice_cash_targets`.
pub(super) fn advance_cash_targets(
    paid: &[VatBreakdownRow],
    retained_gross: Decimal,
) -> [(&'static str, Decimal, Decimal); 3] {
    let (mut service_gross, mut service_vat) = (Decimal::ZERO, Decimal::ZERO);
    let (mut passthrough_gross, mut passthrough_vat) = (Decimal::ZERO, Decimal::ZERO);
    for row in paid {
        if row.kind == VatGroupKind::Passthrough {
            passthrough_gross += row.gross;
            passthrough_vat += row.vat;
        } else {
            service_gross += row.gross;
            service_vat += row.vat;
        }
    }
    [
        ("service_revenue", service_gross, service_vat),
        (
            "cost_passthrough_revenue",
            passthrough_gross,
            passthrough_vat,
        ),
        (
            "patient_credit",
            retained_gross - service_gross - passthrough_gross,
            Decimal::ZERO,
        ),
    ]
}

/// The row a payment adds to a category of the advance: `gross`, with the VAT
/// that brings the category's paid VAT to its share of what is paid then (a
/// fully paid category carries exactly its invoiced VAT).
fn part_row(
    row: &VatBreakdownRow,
    paid_before: &[VatBreakdownRow],
    gross: Decimal,
) -> VatBreakdownRow {
    let key = category_of(row);
    let (before_gross, before_vat) = paid_before
        .iter()
        .filter(|item| category_of(item) == key)
        .fold((Decimal::ZERO, Decimal::ZERO), |(gross, vat), item| {
            (gross + item.gross, vat + item.vat)
        });
    let vat = (vat_share(before_gross + gross, row.gross, row.vat) - before_vat)
        .max(Decimal::ZERO)
        .min(gross.max(Decimal::ZERO));
    VatBreakdownRow {
        kind: key.0,
        rate: key.1,
        net: gross - vat,
        vat,
        gross,
    }
}

/// The split a payment without a split set by hand freezes when it is
/// recorded: pro rata over what each category still has open (what the
/// payment form prefills), at most what is open in total.
pub(super) fn pro_rata_payment_rows(
    advance_rows: &[VatBreakdownRow],
    paid_before: &[VatBreakdownRow],
    amount: Decimal,
) -> Vec<VatBreakdownRow> {
    let caps = advance_rows
        .iter()
        .map(|row| {
            let key = category_of(row);
            let paid: Decimal = paid_before
                .iter()
                .filter(|item| category_of(item) == key)
                .map(|item| item.gross)
                .sum();
            (row.kind, (row.gross - paid).max(Decimal::ZERO))
        })
        .collect::<Vec<_>>();
    let open: Decimal = caps.iter().map(|(_, cap)| *cap).sum();
    let parts = split_within(amount.round_cents().max(Decimal::ZERO).min(open), &caps);
    advance_rows
        .iter()
        .zip(parts)
        .filter(|(_, gross)| *gross > Decimal::ZERO)
        .map(|(row, gross)| part_row(row, paid_before, gross))
        .collect()
}

/// A payment on an advance (not reversed) with the split stored for it;
/// `rows` is `None` for a payment recorded before splits were frozen.
#[derive(Clone, Debug)]
pub(super) struct AdvancePayment {
    pub id: Uuid,
    pub amount: Decimal,
    pub created_by: Uuid,
    pub rows: Option<Vec<VatBreakdownRow>>,
}

/// What an advance's retained cash paid per category. Every payment frozen:
/// the sum of the stored splits (refunded cash takes the same share of each
/// category). Otherwise the former reading ([`advance_paid_rows`]: stored
/// splits as set, the rest pro rata over what is open).
pub(super) fn paid_rows(
    advance_rows: &[VatBreakdownRow],
    payments: &[AdvancePayment],
    cash: Decimal,
) -> Vec<VatBreakdownRow> {
    let stored = payments
        .iter()
        .filter_map(|payment| payment.rows.clone())
        .collect::<Vec<_>>();
    if stored.len() < payments.len() {
        return advance_paid_rows(advance_rows, &stored, cash);
    }
    let mut sum = Vec::new();
    for rows in &stored {
        add_rows(&mut sum, rows);
    }
    let paid = advance_rows
        .iter()
        .map(|row| {
            let key = category_of(row);
            let (gross, vat) = sum
                .iter()
                .filter(|item| category_of(item) == key)
                .fold((Decimal::ZERO, Decimal::ZERO), |(gross, vat), item| {
                    (gross + item.gross, vat + item.vat)
                });
            let gross = gross.min(row.gross).max(Decimal::ZERO);
            let vat = vat.min(row.vat).max(Decimal::ZERO).min(gross);
            VatBreakdownRow {
                kind: key.0,
                rate: key.1,
                net: gross - vat,
                vat,
                gross,
            }
        })
        .collect::<Vec<_>>();
    let total: Decimal = paid.iter().map(|row| row.gross).sum();
    let cash = cash.round_cents().max(Decimal::ZERO);
    if cash >= total {
        return paid
            .into_iter()
            .filter(|row| row.gross > Decimal::ZERO)
            .collect();
    }
    let caps = paid
        .iter()
        .map(|row| (row.kind, row.gross))
        .collect::<Vec<_>>();
    paid.iter()
        .zip(split_within(cash, &caps))
        .filter(|(_, gross)| *gross > Decimal::ZERO)
        .map(|(row, gross)| {
            let vat = vat_share(gross, row.gross, row.vat);
            VatBreakdownRow {
                kind: row.kind,
                rate: row.rate,
                net: gross - vat,
                vat,
                gross,
            }
        })
        .collect()
}

/// The splits to freeze for payments recorded before splits were frozen
/// (`rows` = `None`): together exactly what the former reading gives them
/// today, so nothing booked or deducted moves; attributed to those payments
/// in the order they were recorded.
pub(super) fn legacy_payment_rows(
    advance_rows: &[VatBreakdownRow],
    payments: &[AdvancePayment],
    cash: Decimal,
) -> Vec<(Uuid, Vec<VatBreakdownRow>)> {
    let stored = payments
        .iter()
        .filter_map(|payment| payment.rows.clone())
        .collect::<Vec<_>>();
    let mut fixed = Vec::new();
    for rows in &stored {
        add_rows(&mut fixed, rows);
    }
    let reading = advance_paid_rows(advance_rows, &stored, cash);
    let mut rest = subtract_rows(&reading, &fixed);
    rest.retain(|row| row.gross > Decimal::ZERO);
    payments
        .iter()
        .filter(|payment| payment.rows.is_none())
        .map(|payment| {
            let part = deducted_advance_rows(&rest, payment.amount);
            rest = subtract_rows(&rest, &part);
            rest.retain(|row| row.gross > Decimal::ZERO);
            (payment.id, part)
        })
        .collect()
}

/// The VAT rows an advance charges after its active credit notes; an early
/// advance without line amounts is one group.
pub(super) async fn advance_rows(
    conn: &mut PgConnection,
    advance_id: Uuid,
) -> Result<Vec<VatBreakdownRow>, sqlx::Error> {
    let Some(row) = sqlx::query(
        "SELECT line_items, total_net, total_vat, total_gross FROM invoices WHERE id = $1",
    )
    .bind(advance_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(Vec::new());
    };
    let mut line_items = row.try_get::<Value, _>("line_items")?;
    if !credit_notes::line_snapshot_carries_total(
        &line_items,
        row.try_get::<Decimal, _>("total_gross")?,
    ) {
        line_items = json!([{
            "line_net": row.try_get::<Decimal, _>("total_net")?.to_string(),
            "line_vat": row.try_get::<Decimal, _>("total_vat")?.to_string(),
            "line_gross": row.try_get::<Decimal, _>("total_gross")?.to_string(),
        }]);
    }
    let credits = credit_notes::load_active_credits(conn, advance_id).await?;
    Ok(advance_vat_rows(&line_items, &credits))
}

/// The VAT rows a settlement invoice bills after its active credit notes;
/// `None` when its lines carry no amounts (no category to compare).
pub(super) async fn settlement_rows(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<Vec<VatBreakdownRow>>, sqlx::Error> {
    let Some(row) = sqlx::query("SELECT line_items, total_gross FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };
    let line_items = row.try_get::<Value, _>("line_items")?;
    if !credit_notes::line_snapshot_carries_total(
        &line_items,
        row.try_get::<Decimal, _>("total_gross")?,
    ) {
        return Ok(None);
    }
    let credits = credit_notes::load_active_credits(conn, invoice_id).await?;
    Ok(Some(advance_vat_rows(&line_items, &credits)))
}

/// One allocation with its rows: stored, or (allocations made before the
/// rows were stored) the former pro rata share of the advance.
#[derive(Clone, Debug)]
pub(super) struct AllocationRows {
    pub advance_invoice_id: Uuid,
    pub rows: Vec<VatBreakdownRow>,
}

/// The allocations taken from an advance (`by_advance`) or credited into a
/// settlement invoice, oldest first.
pub(super) async fn allocation_rows(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    by_advance: bool,
) -> Result<Vec<AllocationRows>, sqlx::Error> {
    let sql = if by_advance {
        "SELECT advance_invoice_id, amount_gross, vat_rows FROM invoice_prepayment_allocations
         WHERE advance_invoice_id = $1 ORDER BY created_at, id"
    } else {
        "SELECT advance_invoice_id, amount_gross, vat_rows FROM invoice_prepayment_allocations
         WHERE target_invoice_id = $1 ORDER BY created_at, id"
    };
    let rows = sqlx::query(sql)
        .bind(invoice_id)
        .fetch_all(&mut *conn)
        .await?;
    let mut legacy = BTreeMap::<Uuid, Vec<VatBreakdownRow>>::new();
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let advance_invoice_id = row.try_get::<Uuid, _>("advance_invoice_id")?;
        let amount_gross = row.try_get::<Decimal, _>("amount_gross")?;
        let stored = row
            .try_get::<Option<Value>, _>("vat_rows")?
            .and_then(|value| rows_from_json(&value));
        let rows = match stored {
            Some(rows) => rows,
            None => {
                let rows = match legacy.entry(advance_invoice_id) {
                    std::collections::btree_map::Entry::Occupied(entry) => entry.into_mut(),
                    std::collections::btree_map::Entry::Vacant(entry) => {
                        entry.insert(advance_rows(conn, advance_invoice_id).await?)
                    }
                };
                deducted_advance_rows(rows, amount_gross)
            }
        };
        result.push(AllocationRows {
            advance_invoice_id,
            rows,
        });
    }
    Ok(result)
}

/// The advance's payments that are not reversed, oldest first, with their
/// stored splits.
pub(super) async fn advance_payments(
    conn: &mut PgConnection,
    advance_id: Uuid,
) -> Result<Vec<AdvancePayment>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT payment.id, payment.amount_gross, payment.created_by, split.rows
           FROM invoice_payment_transactions payment
           LEFT JOIN invoice_payment_category_splits split
             ON split.payment_transaction_id = payment.id
           WHERE payment.invoice_id = $1
             AND payment.transaction_type = 'payment'
             AND NOT EXISTS (
                 SELECT 1 FROM invoice_payment_transactions reversal
                 WHERE reversal.reverses_transaction_id = payment.id
                   AND reversal.transaction_type = 'reversal'
             )
           ORDER BY payment.created_at, payment.id"#,
    )
    .bind(advance_id)
    .fetch_all(&mut *conn)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(AdvancePayment {
                id: row.try_get("id")?,
                amount: row.try_get("amount_gross")?,
                created_by: row.try_get("created_by")?,
                rows: row
                    .try_get::<Option<Value>, _>("rows")?
                    .and_then(|value| rows_from_json(&value)),
            })
        })
        .collect()
}

/// The advance's retained cash (payments less refunds) from the journal, not
/// `paid_amount` (inside a payment transaction the column is refreshed only
/// at its end), and what the advance still charges after credit notes.
async fn advance_cash(
    conn: &mut PgConnection,
    advance_id: Uuid,
) -> Result<(Decimal, Decimal), sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT COALESCE((SELECT SUM(CASE WHEN payment.transaction_type = 'payment'
                                            THEN payment.amount_gross ELSE -payment.amount_gross END)
                            FROM invoice_payment_transactions payment
                            WHERE payment.invoice_id = invoice.id), 0)
                  - COALESCE((SELECT SUM(CASE WHEN refund.transaction_type = 'refund'
                                              THEN refund.amount_gross ELSE -refund.amount_gross END)
                              FROM invoice_refund_transactions refund
                              WHERE refund.invoice_id = invoice.id), 0) AS cash,
                  invoice.total_gross - invoice.credited_amount AS capacity
           FROM invoices invoice WHERE invoice.id = $1"#,
    )
    .bind(advance_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(match row {
        Some(row) => (row.try_get("cash")?, row.try_get("capacity")?),
        None => (Decimal::ZERO, Decimal::ZERO),
    })
}

fn capped_cash(cash: Decimal, capacity: Decimal) -> Decimal {
    cash.min(capacity).max(Decimal::ZERO)
}

/// What the advance's retained cash paid per category.
pub(super) async fn advance_paid(
    conn: &mut PgConnection,
    advance_id: Uuid,
) -> Result<(Vec<VatBreakdownRow>, Vec<VatBreakdownRow>), sqlx::Error> {
    let rows = advance_rows(conn, advance_id).await?;
    let (cash, capacity) = advance_cash(conn, advance_id).await?;
    let payments = advance_payments(conn, advance_id).await?;
    let paid = paid_rows(&rows, &payments, capped_cash(cash, capacity));
    Ok((rows, paid))
}

/// Whether the invoice is an advance whose lines carry their amounts (its
/// cash is split per VAT category).
async fn is_categorised_advance(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let is_advance = sqlx::query_scalar::<_, bool>(
        "SELECT invoice_type = 'advance' FROM invoices WHERE id = $1",
    )
    .bind(invoice_id)
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or(false);
    Ok(is_advance && settlement_rows(conn, invoice_id).await?.is_some())
}

/// Freezes the split of a payment just recorded on an advance (inside its
/// transaction, before its booking): payments recorded before splits were
/// frozen first get the split the former reading gives them, then the new
/// payment, unless staff set its split by hand, gets the pro rata split of
/// what is open (QA 2026-11-16 S1-1).
pub(super) async fn freeze_advance_payment(
    conn: &mut PgConnection,
    advance_id: Uuid,
    payment_id: Uuid,
) -> Result<(), sqlx::Error> {
    if !is_categorised_advance(conn, advance_id).await? {
        return Ok(());
    }
    let rows = advance_rows(conn, advance_id).await?;
    let (cash, capacity) = advance_cash(conn, advance_id).await?;
    let mut payments = advance_payments(conn, advance_id).await?;
    let Some(index) = payments.iter().position(|payment| payment.id == payment_id) else {
        return Ok(());
    };
    let payment = payments.remove(index);
    let cash_before = capped_cash(cash - payment.amount, capacity);
    for (id, split) in legacy_payment_rows(&rows, &payments, cash_before) {
        let Some(earlier) = payments.iter_mut().find(|item| item.id == id) else {
            continue;
        };
        insert_frozen_split(conn, advance_id, id, &split, earlier.created_by).await?;
        earlier.rows = Some(split);
    }
    if payment.rows.is_none() {
        let paid_before = paid_rows(&rows, &payments, cash_before);
        let split = pro_rata_payment_rows(&rows, &paid_before, payment.amount);
        insert_frozen_split(conn, advance_id, payment.id, &split, payment.created_by).await?;
    }
    Ok(())
}

async fn insert_frozen_split(
    conn: &mut PgConnection,
    advance_id: Uuid,
    payment_id: Uuid,
    rows: &[VatBreakdownRow],
    created_by: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO invoice_payment_category_splits (
                payment_transaction_id, invoice_id, rows, created_by, manual
           ) VALUES ($1, $2, $3, $4, FALSE)"#,
    )
    .bind(payment_id)
    .bind(advance_id)
    .bind(rows_to_json(rows))
    .bind(created_by)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// What a categorised advance's cash paid per category, for its cash
/// booking; `None` books as any invoice (not a categorised advance, or no
/// payment of it has a stored split).
pub(super) async fn advance_booking_rows(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<Vec<VatBreakdownRow>>, sqlx::Error> {
    if !is_categorised_advance(conn, invoice_id).await? {
        return Ok(None);
    }
    let payments = advance_payments(conn, invoice_id).await?;
    if payments.iter().all(|payment| payment.rows.is_none()) {
        return Ok(None);
    }
    let rows = advance_rows(conn, invoice_id).await?;
    let (cash, capacity) = advance_cash(conn, invoice_id).await?;
    Ok(Some(paid_rows(
        &rows,
        &payments,
        capped_cash(cash, capacity),
    )))
}

/// What an advance still holds per category: its paid cash less what its
/// allocations already deduct.
pub(super) async fn advance_available_rows(
    conn: &mut PgConnection,
    advance_id: Uuid,
) -> Result<Vec<VatBreakdownRow>, sqlx::Error> {
    let (_, paid) = advance_paid(conn, advance_id).await?;
    let mut allocated = Vec::new();
    for allocation in allocation_rows(conn, advance_id, true).await? {
        add_rows(&mut allocated, &allocation.rows);
    }
    let mut rows = subtract_rows(&paid, &allocated);
    rows.retain(|row| row.gross > Decimal::ZERO);
    Ok(rows)
}

/// What a settlement invoice still bills per category beyond the advances
/// already credited into it; `None` without line amounts.
pub(super) async fn target_open_rows(
    conn: &mut PgConnection,
    target_id: Uuid,
) -> Result<Option<Vec<VatBreakdownRow>>, sqlx::Error> {
    let Some(rows) = settlement_rows(conn, target_id).await? else {
        return Ok(None);
    };
    let mut deducted = Vec::new();
    for allocation in allocation_rows(conn, target_id, false).await? {
        add_rows(&mut deducted, &allocation.rows);
    }
    Ok(Some(subtract_rows(&rows, &deducted)))
}

/// The rows of an allocation of at most `max` from `advance_id` into
/// `target_id`. `None` when the target has no line amounts (the amount is
/// then limited by the gross balances only, as before).
pub(super) async fn plan_allocation(
    conn: &mut PgConnection,
    advance_id: Uuid,
    target_id: Uuid,
    max: Decimal,
) -> Result<Option<Vec<VatBreakdownRow>>, sqlx::Error> {
    Ok(plan_allocation_detail(conn, advance_id, target_id, max)
        .await?
        .map(|plan| plan.rows))
}

/// A planned allocation and the gross limits it was planned within.
pub(super) struct AllocationPlan {
    pub rows: Vec<VatBreakdownRow>,
    pub available_gross: Decimal,
    pub target_open_gross: Decimal,
}

pub(super) async fn plan_allocation_detail(
    conn: &mut PgConnection,
    advance_id: Uuid,
    target_id: Uuid,
    max: Decimal,
) -> Result<Option<AllocationPlan>, sqlx::Error> {
    let Some(target_open) = target_open_rows(conn, target_id).await? else {
        return Ok(None);
    };
    // An early advance without line amounts has no VAT categories to match:
    // it is set off by its gross balance, as before.
    if settlement_rows(conn, advance_id).await?.is_none() {
        return Ok(None);
    }
    let available = advance_available_rows(conn, advance_id).await?;
    Ok(Some(AllocationPlan {
        rows: plan_allocation_rows(&available, &target_open, max),
        available_gross: available.iter().map(|row| row.gross).sum(),
        target_open_gross: target_open.iter().map(|row| row.gross).sum(),
    }))
}

/// Inserts an allocation with its rows (the DB checks them against the
/// target's categories) and its idempotency record.
pub(super) async fn insert_allocation(
    conn: &mut PgConnection,
    request_id: Uuid,
    advance_id: Uuid,
    target_id: Uuid,
    amount: Decimal,
    rows: Option<&[VatBreakdownRow]>,
    actor_id: Uuid,
) -> Result<Uuid, sqlx::Error> {
    let allocation_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_prepayment_allocations (
                request_id, advance_invoice_id, target_invoice_id, amount_gross, created_by,
                vat_rows
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id"#,
    )
    .bind(request_id)
    .bind(advance_id)
    .bind(target_id)
    .bind(amount)
    .bind(actor_id)
    .bind(rows.map(rows_to_json))
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        r#"INSERT INTO invoice_prepayment_allocation_requests (
                target_invoice_id, request_id, advance_invoice_id, amount_gross,
                allocation_id, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(target_id)
    .bind(request_id)
    .bind(advance_id)
    .bind(amount)
    .bind(allocation_id)
    .bind(actor_id)
    .execute(&mut *conn)
    .await?;
    Ok(allocation_id)
}

/// Serialises the advance money of one order: recording an advance payment
/// and releasing or settling a final invoice take this lock before any
/// invoice row, so the set-off is never missed and the two never deadlock
/// (money QA 2026-11-15, C-S2-2).
pub(super) async fn lock_order_advances(
    conn: &mut PgConnection,
    order_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('invoice-order-advances:' || $1::text, 0))",
    )
    .bind(order_id)
    .execute(conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(value: &str) -> Decimal {
        value.parse().unwrap()
    }

    fn row(kind: VatGroupKind, rate: &str, vat: &str, gross: &str) -> VatBreakdownRow {
        VatBreakdownRow {
            kind,
            rate: dec(rate),
            net: dec(gross) - dec(vat),
            vat: dec(vat),
            gross: dec(gross),
        }
    }

    /// Money-B S1-1 (M5): the final invoice bills 550 @0 %, 1.002 @19 %
    /// (VAT 160) and 2.000 pass-through; advances hold more own services
    /// than the final bills. The deduction stops at each category.
    #[test]
    fn a_deduction_never_exceeds_a_category_of_the_final_invoice() {
        let available = [
            row(VatGroupKind::Taxed, "19", "290.70", "1820.70"),
            row(VatGroupKind::ZeroRated, "0", "0", "1100"),
            row(VatGroupKind::Passthrough, "0", "0", "1039.65"),
        ];
        let target = [
            row(VatGroupKind::Taxed, "19", "145.35", "910.35"),
            row(VatGroupKind::ZeroRated, "0", "0", "550"),
            row(VatGroupKind::Passthrough, "0", "0", "2000"),
        ];
        let plan = plan_allocation_rows(&available, &target, dec("3460.35"));
        assert_eq!(plan[0].gross, dec("910.35"));
        assert_eq!(plan[0].vat, dec("145.35"));
        assert_eq!(plan[1].gross, dec("550"));
        assert_eq!(plan[2].gross, dec("1039.65"));
        assert_eq!(
            plan.iter().map(|row| row.gross).sum::<Decimal>(),
            dec("2500.00")
        );
    }

    #[test]
    fn a_smaller_amount_is_shared_within_the_limits() {
        let available = [
            row(VatGroupKind::Taxed, "19", "19", "119"),
            row(VatGroupKind::Passthrough, "0", "0", "300"),
        ];
        let target = [
            row(VatGroupKind::Taxed, "19", "19", "119"),
            row(VatGroupKind::Passthrough, "0", "0", "300"),
        ];
        let plan = plan_allocation_rows(&available, &target, dec("200"));
        assert_eq!(
            plan.iter().map(|row| row.gross).sum::<Decimal>(),
            dec("200")
        );
        assert!(plan.iter().all(|row| row.gross <= dec("300")));
        let whole = plan_allocation_rows(&available, &target, dec("1000"));
        assert_eq!(whole, available.to_vec());
    }

    #[test]
    fn a_manual_payment_split_counts_as_set_and_the_rest_goes_pro_rata() {
        let advance = [
            row(VatGroupKind::Taxed, "19", "19", "119"),
            row(VatGroupKind::ZeroRated, "0", "0", "550"),
            row(VatGroupKind::Passthrough, "0", "0", "300"),
        ];
        // 669 paid, all on own services by hand.
        let split = vec![
            row(VatGroupKind::Taxed, "19", "0", "119"),
            row(VatGroupKind::ZeroRated, "0", "0", "550"),
        ];
        let paid = advance_paid_rows(&advance, std::slice::from_ref(&split), dec("669"));
        assert_eq!(paid.len(), 2);
        assert_eq!(paid[0].gross, dec("119"));
        assert_eq!(paid[0].vat, dec("19"));
        assert_eq!(paid[1].gross, dec("550"));
        // Without a manual split: pro rata, as before.
        let pro_rata = advance_paid_rows(&advance, &[], dec("669"));
        assert_eq!(pro_rata, deducted_advance_rows(&advance, dec("669")));
        // A later payment of 300 without split fills the open pass-through.
        let paid = advance_paid_rows(&advance, &[split], dec("969"));
        assert_eq!(paid, advance.to_vec());
    }

    fn payment(amount: &str, rows: Option<Vec<VatBreakdownRow>>) -> AdvancePayment {
        AdvancePayment {
            id: Uuid::new_v4(),
            amount: dec(amount),
            created_by: Uuid::nil(),
            rows,
        }
    }

    /// The A1 advance of QA 2026-11-16: 800 = 0 % 326,58 · 19 % 473,42
    /// (VAT 75,59).
    fn a1_advance() -> Vec<VatBreakdownRow> {
        vec![
            row(VatGroupKind::Taxed, "19", "75.59", "473.42"),
            row(VatGroupKind::ZeroRated, "0", "0", "326.58"),
        ]
    }

    /// S1-1: 300 pro rata, then 200 split by hand 50 @19 % / 150 @0 %. Each
    /// payment keeps its own split; the manual one is not re-spread.
    #[test]
    fn a_manual_split_after_a_pro_rata_payment_is_kept_as_entered() {
        let advance = a1_advance();
        let first = pro_rata_payment_rows(&advance, &[], dec("300"));
        assert_eq!(first[0].gross, dec("177.53"));
        assert_eq!(first[0].vat, dec("28.35"));
        assert_eq!(first[1].gross, dec("122.47"));
        let manual = validate_payment_split(
            &advance,
            &first,
            dec("200"),
            &[
                (category_for(false, dec("19")), dec("50")),
                (category_for(false, Decimal::ZERO), dec("150")),
            ],
        )
        .unwrap();
        assert_eq!(manual[0].gross, dec("50"));
        assert_eq!(manual[0].vat, dec("7.98"));
        let payments = [payment("300", Some(first)), payment("200", Some(manual))];
        let paid = paid_rows(&advance, &payments, dec("500"));
        assert_eq!(paid[0].gross, dec("227.53"));
        assert_eq!(paid[0].vat, dec("36.33"));
        assert_eq!(paid[1].gross, dec("272.47"));
        // Paid in full: the categories carry exactly the invoiced VAT.
        let rest = pro_rata_payment_rows(&advance, &paid, dec("300"));
        let payments = [
            payments[0].clone(),
            payments[1].clone(),
            payment("300", Some(rest)),
        ];
        assert_eq!(paid_rows(&advance, &payments, dec("800")), advance);
    }

    /// A5: a manual split first, then a pro rata payment spreads over what is
    /// still open; the manual part stays as entered.
    #[test]
    fn a_pro_rata_payment_after_a_manual_split_takes_what_is_open() {
        let advance = vec![
            row(VatGroupKind::Taxed, "19", "94.49", "591.78"),
            row(VatGroupKind::ZeroRated, "0", "0", "408.22"),
        ];
        let manual = vec![row(VatGroupKind::ZeroRated, "0", "0", "300")];
        let next = pro_rata_payment_rows(&advance, &manual, dec("200"));
        assert_eq!(
            next.iter().map(|row| row.gross).sum::<Decimal>(),
            dec("200")
        );
        let payments = [
            payment("300", Some(manual)),
            payment("200", Some(next.clone())),
        ];
        let paid = paid_rows(&advance, &payments, dec("500"));
        let zero = paid
            .iter()
            .find(|row| row.kind == VatGroupKind::ZeroRated)
            .unwrap();
        let next_zero = next
            .iter()
            .find(|row| row.kind == VatGroupKind::ZeroRated)
            .unwrap();
        assert_eq!(zero.gross, dec("300") + next_zero.gross);
    }

    /// Payments recorded before splits were frozen get, together, exactly
    /// what the former reading gives today.
    #[test]
    fn legacy_payments_freeze_to_the_former_reading() {
        let advance = a1_advance();
        let manual = vec![
            row(VatGroupKind::Taxed, "19", "7.98", "50"),
            row(VatGroupKind::ZeroRated, "0", "0", "150"),
        ];
        let payments = [payment("300", None), payment("200", Some(manual.clone()))];
        let former = advance_paid_rows(&advance, std::slice::from_ref(&manual), dec("500"));
        let frozen = legacy_payment_rows(&advance, &payments, dec("500"));
        assert_eq!(frozen.len(), 1);
        let payments = [
            payment("300", Some(frozen[0].1.clone())),
            payment("200", Some(manual)),
        ];
        assert_eq!(paid_rows(&advance, &payments, dec("500")), former);
        // Pure pro rata history: the former pro rata reading.
        let payments = [payment("300", None), payment("100", None)];
        let frozen = legacy_payment_rows(&advance, &payments, dec("400"));
        let payments = frozen
            .into_iter()
            .map(|(_, rows)| payment("0", Some(rows)))
            .collect::<Vec<_>>();
        assert_eq!(
            paid_rows(&advance, &payments, dec("400")),
            deducted_advance_rows(&advance, dec("400"))
        );
    }

    #[test]
    fn refunded_cash_shrinks_every_category_alike() {
        let advance = a1_advance();
        let first = pro_rata_payment_rows(&advance, &[], dec("400"));
        let paid = paid_rows(&advance, &[payment("400", Some(first))], dec("200"));
        assert_eq!(
            paid.iter().map(|row| row.gross).sum::<Decimal>(),
            dec("200")
        );
    }

    #[test]
    fn rows_survive_the_json_round_trip() {
        let rows = vec![
            row(VatGroupKind::Taxed, "19.00", "19", "119"),
            row(VatGroupKind::Passthrough, "0", "0", "300"),
        ];
        let back = rows_from_json(&rows_to_json(&rows)).unwrap();
        assert_eq!(back[0].rate, dec("19"));
        assert_eq!(back[1].gross, dec("300"));
        assert_eq!(category_of(&back[0]), category_of(&rows[0]));
    }
}
