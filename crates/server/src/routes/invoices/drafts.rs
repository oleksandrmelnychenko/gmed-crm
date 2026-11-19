//! Changing and deleting a draft invoice (owner 2026-11-14: «черновик
//! видалити треба, едіт треба»).
//!
//! A draft carries no number and is no issued document yet (§ 14 UStG, GoBD
//! apply from the release), so billing may still change it:
//!
//! - `PUT /invoices/{id}/draft` sets the due date and the printed remark and,
//!   where the draft was made from quote positions, rebuilds its lines from a
//!   new selection of quote lines and quantities within what is still open
//!   (the draft's own quantities count as open). The lines are built by the
//!   same code as a new invoice (`build_selected_invoice_snapshot`), so the
//!   VAT and pass-through rules do not change. A prepayment advance instead
//!   takes a manual split of its amount over the quote's VAT groups (owner
//!   decision 2026-11-14), within each group's open gross. The invoice date
//!   is not set on a draft: it is the day of the release. The recipient is
//!   changed through `/invoices/{id}/payer`.
//! - `DELETE /invoices/{id}` deletes a draft: it is cancelled without number
//!   and without a cancellation document, which frees everything it reserved
//!   (quote quantities, package overages, concierge services, supplier
//!   invoices: they count only for invoices that are not cancelled) and
//!   leaves it out of the invoice list. The row and its audit history stay.
//!   An issued invoice is never deleted; it is cancelled with a Storno.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::BTreeMap;
use uuid::Uuid;

use super::{
    CreateInvoiceLineSelection, InvoiceCreationSnapshot, MoneyInput, QuoteInvoiceContext,
    build_selected_invoice_snapshot, closed_quote_invoice_message, coded_err, decimal_to_string,
    document_terms, ensure_interim_leaves_open_advance, ensure_patient_access,
    ensure_quote_line_parts_within_totals, err, invoice_json_decimal,
    invoice_snapshot_has_package_overage, line_comments, link_package_consumptions_tx,
    load_allocated_quote_quantities, load_billed_quote_lines, load_invoice_detail,
    load_prepayment_advance_groups, load_quote_invoice_context, lock_invoiceable_quote_tx,
    normalize_optional, parse_optional_date, prepayment_advance_snapshot, quote_line_amounts,
    write_invoice_audit_tx,
};
use crate::auth::middleware::AuthUser;
use crate::money::CommercialRounding;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// The draft's lines cannot be rebuilt here; the reason is in `reason`.
pub(super) const DRAFT_LINES_LOCKED: &str = "invoice_draft_lines_locked";
/// The invoice is released (or cancelled): it is no draft any more.
pub(super) const NOT_A_DRAFT: &str = "invoice_not_a_draft";

/// One VAT group of a prepayment advance: own services at a rate, or the
/// pass-through costs, with the gross of the quote no invoice bills yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct AdvanceGroup {
    pub(super) is_cost_passthrough: bool,
    pub(super) vat_rate: Decimal,
    pub(super) open_gross: Decimal,
}

/// Default split of an advance amount (owner decision 2026-11-14): GMED's own
/// service groups are covered first, in full with their VAT, in proportion
/// to their open gross when the amount does not reach them all; only the rest
/// goes to the pass-through cost groups, in proportion likewise. The last
/// group of each kind takes the rounding cents, so the shares add up to the
/// amount. `shares[i]` belongs to `groups[i]`.
pub(super) fn own_services_first(amount: Decimal, groups: &[AdvanceGroup]) -> Vec<Decimal> {
    let amount = amount.round_cents().max(Decimal::ZERO);
    let mut shares = vec![Decimal::ZERO; groups.len()];
    let own_open: Decimal = groups
        .iter()
        .filter(|group| !group.is_cost_passthrough)
        .map(|group| group.open_gross.max(Decimal::ZERO))
        .sum();
    let passthrough_open: Decimal = groups
        .iter()
        .filter(|group| group.is_cost_passthrough)
        .map(|group| group.open_gross.max(Decimal::ZERO))
        .sum();
    // Without pass-through groups the own groups take the whole amount (and
    // the other way round), as the former proportional split did.
    let own_amount = if passthrough_open > Decimal::ZERO {
        amount.min(own_open)
    } else {
        amount
    };
    let passthrough_amount = if own_open > Decimal::ZERO || passthrough_open > Decimal::ZERO {
        amount - own_amount
    } else {
        Decimal::ZERO
    };
    distribute(&mut shares, groups, false, own_amount);
    distribute(&mut shares, groups, true, passthrough_amount);
    shares
}

/// The editor's default split: own services first, but no group above what
/// it has open (C-S3-3); a rest that fits nowhere stays unassigned, so the
/// editor shows the shares do not add up instead of proposing an over-share.
pub(super) fn capped_default_split(amount: Decimal, groups: &[AdvanceGroup]) -> Vec<Decimal> {
    own_services_first(amount, groups)
        .into_iter()
        .zip(groups)
        .map(|(share, group)| share.min(group.open_gross.max(Decimal::ZERO)))
        .collect()
}

fn distribute(shares: &mut [Decimal], groups: &[AdvanceGroup], passthrough: bool, amount: Decimal) {
    let indices = groups
        .iter()
        .enumerate()
        .filter(|(_, group)| {
            group.is_cost_passthrough == passthrough && group.open_gross > Decimal::ZERO
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let total: Decimal = indices.iter().map(|index| groups[*index].open_gross).sum();
    if amount <= Decimal::ZERO || total <= Decimal::ZERO {
        return;
    }
    let mut remaining = amount;
    for (position, index) in indices.iter().enumerate() {
        let share = if position + 1 == indices.len() {
            remaining
        } else {
            (amount * groups[*index].open_gross / total).round_cents()
        };
        remaining -= share;
        shares[*index] = share;
    }
}

/// A manual split of the advance amount: every named group must exist, take
/// no more than its open gross and not less than zero, no group twice, and
/// the shares must add up to the advance amount. Groups not named get none.
pub(super) fn manual_split(
    amount: Decimal,
    groups: &[AdvanceGroup],
    requested: &[(bool, Decimal, Decimal)],
) -> Result<Vec<Decimal>, &'static str> {
    let mut shares = vec![Decimal::ZERO; groups.len()];
    let mut named = vec![false; groups.len()];
    for (is_cost_passthrough, vat_rate, gross) in requested {
        let vat_rate = if *is_cost_passthrough {
            Decimal::ZERO
        } else {
            vat_rate.round_commercial(2).normalize()
        };
        let Some(index) = groups.iter().position(|group| {
            group.is_cost_passthrough == *is_cost_passthrough
                && group.vat_rate.normalize() == vat_rate
        }) else {
            // A group no longer open is shown with its old share; zero is fine.
            if gross.is_zero() {
                continue;
            }
            return Err("The split names a VAT group the quote does not have open");
        };
        if named[index] {
            return Err("A VAT group was given more than once");
        }
        named[index] = true;
        let gross = gross.round_cents();
        if gross < Decimal::ZERO {
            return Err("A share of the advance cannot be negative");
        }
        if gross > groups[index].open_gross {
            return Err("A share exceeds what its VAT group has left to bill");
        }
        shares[index] = gross;
    }
    let total: Decimal = shares.iter().copied().sum();
    if total != amount.round_cents() {
        return Err("The shares must add up to the advance amount");
    }
    if total <= Decimal::ZERO {
        return Err("The advance amount must be greater than zero");
    }
    Ok(shares)
}

/// The quote quantities of the draft being rebuilt are open again for it:
/// takes them off what quote lines are billed already.
pub(super) async fn without_own_allocations(
    state: &AppState,
    ctx: &QuoteInvoiceContext,
    mut allocated: BTreeMap<usize, Decimal>,
) -> Result<BTreeMap<usize, Decimal>, axum::response::Response> {
    let Some(invoice_id) = ctx.editing_invoice_id else {
        return Ok(allocated);
    };
    let rows = sqlx::query(
        r#"SELECT quote_line_index, SUM(quantity) AS quantity
           FROM invoice_order_line_allocations
           WHERE invoice_id = $1 AND quote_id = $2
           GROUP BY quote_line_index"#,
    )
    .bind(invoice_id)
    .bind(ctx.quote_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(%error, %invoice_id, "load the quantities of the draft being edited");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load remaining invoice quantities",
        )
    })?;
    for row in rows {
        let Some(index) = row
            .try_get::<i32, _>("quote_line_index")
            .ok()
            .and_then(|index| usize::try_from(index).ok())
        else {
            continue;
        };
        let own = row
            .try_get::<Option<Decimal>, _>("quantity")
            .ok()
            .flatten()
            .unwrap_or(Decimal::ZERO);
        if let Some(quantity) = allocated.get_mut(&index) {
            *quantity -= own;
        }
    }
    allocated.retain(|_, quantity| *quantity > Decimal::ZERO);
    Ok(allocated)
}

struct DraftRow {
    patient_id: Uuid,
    status: String,
    released: bool,
    invoice_number: Option<String>,
    invoice_type: String,
    quote_id: Option<Uuid>,
    order_id: Option<Uuid>,
    total_net: Decimal,
    total_vat: Decimal,
    total_gross: Decimal,
    line_items: Value,
    due_date: Option<NaiveDate>,
    notes: Option<String>,
    termination_final: bool,
}

impl DraftRow {
    fn is_draft(&self) -> bool {
        self.status == "draft" && !self.released
    }
}

const DRAFT_SELECT: &str = r#"SELECT invoice.patient_id, invoice.status::text AS status,
              invoice.released_at IS NOT NULL AS released, invoice.invoice_number,
              invoice.invoice_type, invoice.quote_id, invoice.order_id, invoice.total_net, invoice.total_vat,
              invoice.total_gross, invoice.line_items, invoice.due_date, invoice.notes,
              EXISTS (
                  SELECT 1 FROM order_termination_settlements settlement
                  WHERE settlement.final_invoice_id = invoice.id
              ) AS termination_final
       FROM invoices invoice
       WHERE invoice.id = $1"#;

fn draft_row(row: &sqlx::postgres::PgRow) -> DraftRow {
    DraftRow {
        patient_id: row.try_get("patient_id").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        released: row.try_get("released").unwrap_or(false),
        invoice_number: row.try_get("invoice_number").unwrap_or_default(),
        invoice_type: row.try_get("invoice_type").unwrap_or_default(),
        quote_id: row.try_get("quote_id").unwrap_or_default(),
        order_id: row.try_get("order_id").unwrap_or_default(),
        total_net: row.try_get("total_net").unwrap_or(Decimal::ZERO),
        total_vat: row.try_get("total_vat").unwrap_or(Decimal::ZERO),
        total_gross: row.try_get("total_gross").unwrap_or(Decimal::ZERO),
        line_items: row
            .try_get::<Value, _>("line_items")
            .unwrap_or_else(|_| json!([])),
        due_date: row.try_get("due_date").unwrap_or_default(),
        notes: row.try_get("notes").unwrap_or_default(),
        termination_final: row.try_get("termination_final").unwrap_or(false),
    }
}

async fn load_draft(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<DraftRow, axum::response::Response> {
    match sqlx::query(DRAFT_SELECT)
        .bind(invoice_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => Ok(draft_row(&row)),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Invoice not found")),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "load invoice draft");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load the invoice",
            ))
        }
    }
}

fn not_a_draft() -> axum::response::Response {
    coded_err(
        StatusCode::CONFLICT,
        NOT_A_DRAFT,
        "Only a draft invoice can be changed or deleted; an issued invoice is corrected by cancelling it",
        json!({}),
    )
}

/// How the lines of a draft can be changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LinesMode {
    /// Rebuilt from quote lines and quantities.
    QuotePositions,
    /// A prepayment advance: its amount is split over the quote's VAT groups.
    AdvanceSplit,
    /// Fixed; the reason code says why.
    Locked(&'static str),
}

impl LinesMode {
    fn name(self) -> &'static str {
        match self {
            Self::QuotePositions => "quote_positions",
            Self::AdvanceSplit => "advance_split",
            Self::Locked(_) => "locked",
        }
    }

    fn reason(self) -> Option<&'static str> {
        match self {
            Self::Locked(reason) => Some(reason),
            _ => None,
        }
    }
}

fn line_source(line: &Value) -> Option<&str> {
    line.get("source").and_then(Value::as_str)
}

/// A draft made from quote positions (with the package overages that came
/// along) is rebuilt from the quote; a prepayment advance is re-split. Lines
/// of other sources (supplier invoices, concierge services, a termination
/// settlement) come from their own dialogs: such a draft is deleted and made
/// again.
fn lines_mode(draft: &DraftRow) -> LinesMode {
    if draft.quote_id.is_none() {
        return LinesMode::Locked("no_quote");
    }
    if draft.termination_final {
        return LinesMode::Locked("termination_settlement");
    }
    let lines = draft.line_items.as_array().cloned().unwrap_or_default();
    if lines.is_empty() {
        return LinesMode::Locked("other_sources");
    }
    if lines
        .iter()
        .all(|line| line_source(line) == Some("advance_prepayment"))
    {
        return if draft.invoice_type == "advance" {
            LinesMode::AdvanceSplit
        } else {
            LinesMode::Locked("other_sources")
        };
    }
    let from_quote = lines.iter().all(|line| {
        line_source(line) == Some("service_package_overage")
            || (draft.invoice_type == "final" && super::final_delivery::is_order_service_line(line))
            || (line.get("quote_line_index").is_some_and(Value::is_u64)
                && line_source(line).is_none_or(|source| {
                    !matches!(source, "advance_prepayment" | "external_invoice")
                }))
    });
    if from_quote {
        LinesMode::QuotePositions
    } else {
        LinesMode::Locked("other_sources")
    }
}

fn group_key(is_cost_passthrough: bool, vat_rate: Decimal) -> (bool, Decimal) {
    if is_cost_passthrough {
        (true, Decimal::ZERO)
    } else {
        (false, vat_rate.round_commercial(2).normalize())
    }
}

/// The current gross per VAT group of a prepayment advance draft.
fn advance_line_shares(line_items: &Value) -> BTreeMap<(bool, Decimal), Decimal> {
    let mut shares = BTreeMap::new();
    for line in line_items.as_array().into_iter().flatten() {
        let passthrough = crate::money::json_line_pass_through(&line);
        let vat_rate = invoice_json_decimal(line, "vat_rate").unwrap_or(Decimal::ZERO);
        let gross = invoice_json_decimal(line, "line_gross").unwrap_or(Decimal::ZERO);
        *shares
            .entry(group_key(passthrough, vat_rate))
            .or_insert(Decimal::ZERO) += gross;
    }
    shares
}

async fn editing_context(
    state: &AppState,
    invoice_id: Uuid,
    quote_id: Uuid,
) -> Result<QuoteInvoiceContext, axum::response::Response> {
    let Some(mut ctx) = load_quote_invoice_context(state, quote_id).await? else {
        return Err(err(StatusCode::NOT_FOUND, "Quote not found"));
    };
    ctx.editing_invoice_id = Some(invoice_id);
    Ok(ctx)
}

/// `GET /invoices/{id}/draft`: what the draft editor offers: the header, and
/// either the quote lines with their open quantity (the draft's own included)
/// or the VAT groups of a prepayment advance with their open gross.
pub(super) async fn get_invoice_draft_editor(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if !auth.can(Capability::InvoicesCreate) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let draft = match load_draft(&state, invoice_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(response) = ensure_patient_access(&state, &auth, draft.patient_id).await {
        return response;
    }
    if !draft.is_draft() {
        return not_a_draft();
    }
    let mut mode = lines_mode(&draft);
    let mut quote_lines = Vec::new();
    let mut order_service_lines = Vec::<Value>::new();
    let mut advance = Value::Null;
    if let (LinesMode::QuotePositions | LinesMode::AdvanceSplit, Some(quote_id)) =
        (mode, draft.quote_id)
    {
        let ctx = match editing_context(&state, invoice_id, quote_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
        if closed_quote_invoice_message(&ctx.quote_status).is_some() {
            mode = LinesMode::Locked("quote_closed");
        } else if mode == LinesMode::QuotePositions {
            let allocated = match load_allocated_quote_quantities(&state, quote_id).await {
                Ok(value) => value,
                Err(response) => return response,
            };
            let allocated = match without_own_allocations(&state, &ctx, allocated).await {
                Ok(value) => value,
                Err(response) => return response,
            };
            let billed_amounts =
                match load_billed_quote_lines(&state.db, quote_id, Some(invoice_id)).await {
                    Ok(value) => value,
                    Err(error) => {
                        tracing::error!(%error, %invoice_id, "load billed quote line amounts");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to load remaining invoice quantities",
                        );
                    }
                };
            let mut selected = BTreeMap::<usize, (Decimal, Option<String>)>::new();
            for line in draft.line_items.as_array().into_iter().flatten() {
                let Some(index) = line
                    .get("quote_line_index")
                    .and_then(Value::as_u64)
                    .and_then(|index| usize::try_from(index).ok())
                else {
                    continue;
                };
                if line_source(line) == Some("service_package_overage") {
                    continue;
                }
                let quantity = invoice_json_decimal(line, "quantity").unwrap_or(Decimal::ZERO);
                selected.insert(index, (quantity, line_comments::line_comment(line)));
            }
            let source_lines = ctx.line_items.as_array().cloned().unwrap_or_default();
            let delivery = super::final_delivery::delivery_plan(
                &source_lines,
                &ctx.order_service_facts,
                Some(invoice_id),
            );
            for (line_index, item) in source_lines.iter().enumerate() {
                let service_id = item
                    .get("source_order_leistung_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok());
                if service_id.is_some_and(|id| ctx.cancelled_source_line_ids.contains(&id)) {
                    continue;
                }
                let quoted = invoice_json_decimal(item, "quantity")
                    .unwrap_or(Decimal::ZERO)
                    .round_commercial(2);
                let final_draft = draft.invoice_type == "final" && !draft.termination_final;
                let line_delivery = delivery.lines.get(line_index).cloned().unwrap_or_default();
                let billable = if draft.invoice_type == "advance" {
                    quoted
                } else if final_draft {
                    line_delivery.final_total(quoted)
                } else {
                    service_id
                        .and_then(|id| ctx.service_quantities.get(&id).copied())
                        .map_or(quoted, |quantity| quantity.round_commercial(2).min(quoted))
                };
                let open = (billable
                    - allocated
                        .get(&line_index)
                        .copied()
                        .unwrap_or(Decimal::ZERO)
                        .round_commercial(2))
                .max(Decimal::ZERO);
                let current = selected.get(&line_index);
                if open <= Decimal::ZERO && current.is_none() && !final_draft {
                    continue;
                }
                // The editor's running total bills a part the way the server
                // does (`money::line_part_amounts`).
                let line_amounts = quote_line_amounts(item);
                let billed = billed_amounts.get(&line_index).copied().unwrap_or_default();
                quote_lines.push(json!({
                    "line_index": line_index,
                    "description": item.get("description").and_then(Value::as_str).unwrap_or_default(),
                    "unit": item.get("unit").and_then(Value::as_str),
                    "unit_price": invoice_json_decimal(item, "unit_price").map(decimal_to_string),
                    "vat_rate": invoice_json_decimal(item, "vat_rate").map(decimal_to_string),
                    "discount_percent": decimal_to_string(crate::money::json_discount_percent(item)),
                    "is_cost_passthrough": crate::money::json_line_pass_through(&item),
                    "quoted_quantity": decimal_to_string(quoted),
                    "open_quantity": decimal_to_string(open),
                    "billed_quantity": decimal_to_string(
                        allocated
                            .get(&line_index)
                            .copied()
                            .unwrap_or(Decimal::ZERO)
                            .round_commercial(2),
                    ),
                    "line_net": decimal_to_string(line_amounts.net),
                    "line_gross": decimal_to_string(line_amounts.gross),
                    "billed_net": decimal_to_string(billed.net),
                    "billed_gross": decimal_to_string(billed.gross),
                    "selected_quantity": current.map(|(quantity, _)| decimal_to_string(*quantity)),
                    "comment": current.and_then(|(_, comment)| comment.clone()),
                    "delivery_basis": if line_delivery.tracked() { "actual" } else { "estimate" },
                    "quantity_capped": !final_draft,
                }));
            }
            if draft.invoice_type == "final" && !draft.termination_final {
                let current = super::final_delivery::current_order_service_lines(&draft.line_items);
                order_service_lines = delivery
                    .extras
                    .iter()
                    .map(|extra| {
                        let mut value = super::final_delivery::extra_service_json(extra);
                        let picked = current
                            .iter()
                            .find(|selection| selection.order_leistung_id == extra.fact.id);
                        if let Some(map) = value.as_object_mut() {
                            map.insert(
                                "selected_quantity".to_string(),
                                picked
                                    .and_then(|selection| selection.quantity.parse_decimal())
                                    .map_or(Value::Null, |quantity| {
                                        json!(decimal_to_string(quantity))
                                    }),
                            );
                            map.insert(
                                "comment".to_string(),
                                json!(picked.and_then(|selection| selection.comment.clone())),
                            );
                        }
                        value
                    })
                    .collect();
            }
        } else {
            match load_prepayment_advance_groups(&state, &ctx).await {
                Ok((mut groups, _)) => {
                    let current = advance_line_shares(&draft.line_items);
                    // A share of a group no longer open is shown too (open 0),
                    // so the shown shares add up to the amount (C-S3-3).
                    for ((passthrough, rate), gross) in &current {
                        if *gross > Decimal::ZERO
                            && !groups.iter().any(|group| {
                                group_key(group.is_cost_passthrough, group.vat_rate)
                                    == (*passthrough, *rate)
                            })
                        {
                            groups.push(AdvanceGroup {
                                is_cost_passthrough: *passthrough,
                                vat_rate: *rate,
                                open_gross: Decimal::ZERO,
                            });
                        }
                    }
                    groups.sort_by(|left, right| {
                        (left.is_cost_passthrough, left.vat_rate)
                            .cmp(&(right.is_cost_passthrough, right.vat_rate))
                    });
                    let manual = draft
                        .line_items
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|line| {
                            line.get("advance_allocation").and_then(Value::as_str) == Some("manual")
                        });
                    advance = json!({
                        "amount_gross": decimal_to_string(draft.total_gross),
                        "allocation": if manual { "manual" } else { "own_services_first" },
                        "default_split": capped_default_split(draft.total_gross, &groups)
                            .into_iter()
                            .map(decimal_to_string)
                            .collect::<Vec<_>>(),
                        "groups": groups.iter().map(|group| json!({
                            "is_cost_passthrough": group.is_cost_passthrough,
                            "vat_rate": decimal_to_string(group.vat_rate),
                            "open_gross": decimal_to_string(group.open_gross),
                            "amount_gross": decimal_to_string(
                                current
                                    .get(&group_key(group.is_cost_passthrough, group.vat_rate))
                                    .copied()
                                    .unwrap_or(Decimal::ZERO),
                            ),
                        })).collect::<Vec<_>>(),
                    });
                }
                Err(_) => mode = LinesMode::Locked("nothing_open"),
            }
        }
    }
    let (terms, default_period, payment_term_days) =
        match draft_terms_for_editor(&state, invoice_id, &draft).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    Json(json!({
        "invoice_id": invoice_id,
        "invoice_type": draft.invoice_type,
        "due_date": draft.due_date.map(|value| value.to_string()),
        "notes": draft.notes,
        "payment_received": terms
            .received_payment
            .as_ref()
            .map(document_terms::ReceivedPayment::to_json),
        "service_period": terms.service_period.map(document_terms::ServicePeriod::to_json),
        "payment_term_days": payment_term_days,
        "service_period_default": default_period.map(|(from, to)| json!({
            "from": from.to_string(),
            "to": to.to_string(),
        })),
        "lines_mode": mode.name(),
        "lines_locked_reason": mode.reason(),
        "quote_lines": quote_lines,
        "order_service_lines": order_service_lines,
        "advance": advance,
    }))
    .into_response()
}

#[derive(Deserialize)]
pub(super) struct AdvanceSplitInput {
    is_cost_passthrough: bool,
    vat_rate: MoneyInput,
    amount_gross: MoneyInput,
}

/// The whole header is sent: `due_date` and `notes` replace the stored
/// values (null clears them). `line_items` (quote positions) or
/// `advance_split` (prepayment advance) rebuild the lines; without either
/// the lines stay.
#[derive(Deserialize)]
pub(super) struct UpdateInvoiceDraftRequest {
    due_date: Option<String>,
    notes: Option<String>,
    line_items: Option<Vec<CreateInvoiceLineSelection>>,
    advance_split: Option<Vec<AdvanceSplitInput>>,
    /// Money received before the invoice (Billing/CEO); absent keeps it,
    /// null removes it.
    #[serde(default, deserialize_with = "document_terms::explicit_nullable")]
    payment_received: Option<Option<document_terms::ReceivedPaymentInput>>,
    /// The service period; absent keeps it, null returns to the one of the
    /// lines and the order.
    #[serde(default, deserialize_with = "document_terms::explicit_nullable")]
    service_period: Option<Option<document_terms::ServicePeriodInput>>,
    /// Final drafts: the delivered services outside the quote it bills;
    /// absent keeps the draft's own (`final_delivery`).
    order_services: Option<Vec<super::final_delivery::OrderServiceSelection>>,
}

/// What the draft notes for its document and the period it states without
/// one set by staff.
async fn draft_terms_for_editor(
    state: &AppState,
    invoice_id: Uuid,
    draft: &DraftRow,
) -> Result<
    (
        document_terms::DraftTerms,
        Option<(NaiveDate, NaiveDate)>,
        u64,
    ),
    axum::response::Response,
> {
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %invoice_id, "load the document terms of the draft");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load the invoice",
        )
    };
    let mut conn = state.db.acquire().await.map_err(failed)?;
    let terms = document_terms::load(&mut conn, invoice_id)
        .await
        .map_err(failed)?;
    let default_period = document_terms::default_service_period(
        &mut conn,
        &draft.invoice_type,
        draft.order_id,
        &draft.line_items,
    )
    .await
    .map_err(failed)?;
    let payment_term_days = super::release::load_invoice_payment_term_days(&mut conn)
        .await
        .map_err(failed)?;
    Ok((terms, default_period, payment_term_days))
}

fn lines_locked(reason: &'static str) -> axum::response::Response {
    coded_err(
        StatusCode::CONFLICT,
        DRAFT_LINES_LOCKED,
        "The lines of this draft cannot be changed here; delete the draft and create a new invoice",
        json!({ "reason": reason }),
    )
}

/// `PUT /invoices/{id}/draft`: changes a draft (see the module comment). The
/// rights of creating an invoice; the draft row is locked, the quote too when
/// lines are rebuilt, and the audit row commits with the change.
pub(super) async fn update_invoice_draft(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    body: super::JsonBody<UpdateInvoiceDraftRequest>,
) -> axum::response::Response {
    const FAILED: &str = "Failed to update the draft invoice";
    if !auth.can(Capability::InvoicesCreate) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let body = match super::read_json_body(body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let draft = match load_draft(&state, invoice_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(response) = ensure_patient_access(&state, &auth, draft.patient_id).await {
        return response;
    }
    if !draft.is_draft() {
        return not_a_draft();
    }
    let due_date = match parse_optional_date(body.due_date.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    // The invoice date of a draft is the day it is released, today at the
    // earliest (`release::release_due_date` checks it again then).
    if due_date.is_some_and(|value| value < crate::app_time::today()) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The due date must be on or after the invoice date",
        );
    }
    let notes = normalize_optional(body.notes.as_deref());
    if body.line_items.is_some() && body.advance_split.is_some() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Send either quote lines or an advance split",
        );
    }
    let requested_period = match body.service_period.as_ref() {
        None => None,
        Some(None) => Some(None),
        Some(Some(input)) => match document_terms::parse_service_period(input) {
            Ok(value) => Some(Some(value)),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
    };

    if body.order_services.is_some() && body.line_items.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Send the quote lines with the services outside the quote",
        );
    }

    let mode = lines_mode(&draft);
    let mut rebuilt: Option<(InvoiceCreationSnapshot, &'static str)> = None;
    // The quote lines the rebuilt allocations are checked against.
    let mut rebuilt_quote_lines = Value::Null;
    let mut extra_service_ids = Vec::new();
    if let Some(items) = body.line_items.as_deref() {
        let (LinesMode::QuotePositions, Some(quote_id)) = (mode, draft.quote_id) else {
            return lines_locked(mode.reason().unwrap_or("other_sources"));
        };
        let ctx = match editing_context(&state, invoice_id, quote_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
        if let Some(message) = closed_quote_invoice_message(&ctx.quote_status) {
            return err(StatusCode::UNPROCESSABLE_ENTITY, message);
        }
        let mut snapshot =
            match build_selected_invoice_snapshot(&state, &ctx, &draft.invoice_type, Some(items))
                .await
            {
                Ok(snapshot) => snapshot,
                Err(response) => return response,
            };
        let kept;
        let selections = match body.order_services.as_deref() {
            Some(selections) => selections,
            None => {
                kept = super::final_delivery::current_order_service_lines(&draft.line_items);
                kept.as_slice()
            }
        };
        match super::final_delivery::append_order_service_lines(
            &mut snapshot,
            &ctx,
            &draft.invoice_type,
            selections,
        ) {
            Ok(ids) => extra_service_ids = ids,
            Err(response) => return response,
        }
        if snapshot.line_items.as_array().is_none_or(Vec::is_empty) {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Select at least one invoice item",
            );
        }
        rebuilt = Some((snapshot, "quote_positions"));
        rebuilt_quote_lines = ctx.line_items.clone();
    } else if let Some(split) = body.advance_split.as_deref() {
        let (LinesMode::AdvanceSplit, Some(quote_id)) = (mode, draft.quote_id) else {
            return lines_locked(mode.reason().unwrap_or("other_sources"));
        };
        let ctx = match editing_context(&state, invoice_id, quote_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
        if let Some(message) = closed_quote_invoice_message(&ctx.quote_status) {
            return err(StatusCode::UNPROCESSABLE_ENTITY, message);
        }
        let mut requested = Vec::with_capacity(split.len());
        for input in split {
            let (Some(vat_rate), Some(gross)) = (
                input.vat_rate.parse_decimal(),
                input.amount_gross.parse_decimal(),
            ) else {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid advance split");
            };
            requested.push((input.is_cost_passthrough, vat_rate, gross));
        }
        let groups = match load_prepayment_advance_groups(&state, &ctx).await {
            Ok((groups, _)) => groups,
            Err(response) => return response,
        };
        let shares = match manual_split(draft.total_gross, &groups, &requested) {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        };
        rebuilt = Some((
            prepayment_advance_snapshot(&ctx, &groups, &shares, true),
            "advance_split",
        ));
    }

    // Without an amount the money received is what is left to pay at the
    // release (QA verify2 B-2).
    let requested_payment = match body.payment_received.as_ref() {
        None => None,
        Some(None) => Some(None),
        Some(Some(input)) => {
            match document_terms::parse_received_payment(input, crate::app_time::today()) {
                Ok(value) => Some(Some(value)),
                Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
            }
        }
    };

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "begin draft invoice update");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let locked = match sqlx::query(sqlx::AssertSqlSafe(format!(
        "{DRAFT_SELECT} FOR UPDATE OF invoice"
    )))
    .bind(invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => draft_row(&row),
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "lock draft invoice");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if !locked.is_draft() {
        return not_a_draft();
    }
    if locked.total_gross != draft.total_gross || locked.line_items != draft.line_items {
        return err(
            StatusCode::CONFLICT,
            "The draft changed meanwhile; reload it and try again",
        );
    }

    if let Some((snapshot, kind)) = &rebuilt {
        if *kind == "quote_positions" {
            let quote_id = locked.quote_id.unwrap_or_default();
            if let Err(response) = lock_invoiceable_quote_tx(&mut transaction, quote_id).await {
                return response;
            }
            if let Err(response) = super::final_delivery::ensure_order_services_unbilled_tx(
                &mut transaction,
                Some(invoice_id),
                &extra_service_ids,
            )
            .await
            {
                return response;
            }
            for statement in [
                "DELETE FROM invoice_order_line_allocations WHERE invoice_id = $1",
                "UPDATE service_package_consumptions SET invoice_id = NULL WHERE invoice_id = $1",
            ] {
                if let Err(error) = sqlx::query(statement)
                    .bind(invoice_id)
                    .execute(&mut *transaction)
                    .await
                {
                    tracing::error!(%error, %invoice_id, "free the reservations of the draft");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
                }
            }
            for allocation in &snapshot.allocations {
                if let Err(error) = sqlx::query(
                    r#"INSERT INTO invoice_order_line_allocations (
                            invoice_id, quote_id, quote_line_index, order_leistung_id,
                            quantity, description_snapshot, unit_price_net_snapshot,
                            vat_rate_snapshot, amount_net_snapshot, amount_vat_snapshot,
                            amount_gross_snapshot, discount_percent_snapshot
                       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"#,
                )
                .bind(invoice_id)
                .bind(quote_id)
                .bind(allocation.quote_line_index)
                .bind(allocation.order_leistung_id)
                .bind(allocation.quantity)
                .bind(allocation.description.clone())
                .bind(allocation.unit_price_net)
                .bind(allocation.vat_rate)
                .bind(allocation.amount_net)
                .bind(allocation.amount_vat)
                .bind(allocation.amount_gross)
                .bind(allocation.discount_percent)
                .execute(&mut *transaction)
                .await
                {
                    tracing::error!(%error, %invoice_id, "persist the rebuilt draft allocation");
                    return match error {
                        sqlx::Error::Database(db_error)
                            if matches!(db_error.code().as_deref(), Some("23505" | "P0001")) =>
                        {
                            err(
                                StatusCode::CONFLICT,
                                "Invoice quantity changed; reload the quote and try again",
                            )
                        }
                        _ => err(StatusCode::INTERNAL_SERVER_ERROR, FAILED),
                    };
                }
            }
            let touched = snapshot
                .allocations
                .iter()
                .map(|allocation| allocation.quote_line_index)
                .collect::<Vec<_>>();
            if let Err(response) = ensure_quote_line_parts_within_totals(
                &mut transaction,
                quote_id,
                &rebuilt_quote_lines,
                &touched,
            )
            .await
            {
                return response;
            }
        }
        if *kind == "advance_split" {
            // With the quote locked, each share is checked again against
            // what its group has open now (money QA 2026-11-15, C-S3-2).
            let quote_id = locked.quote_id.unwrap_or_default();
            if let Err(error) = sqlx::query("SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE")
                .bind(quote_id)
                .execute(&mut *transaction)
                .await
            {
                tracing::error!(%error, %invoice_id, "lock the quote of the advance draft");
                return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
            }
            let ctx = match editing_context(&state, invoice_id, quote_id).await {
                Ok(value) => value,
                Err(response) => return response,
            };
            let groups = match load_prepayment_advance_groups(&state, &ctx).await {
                Ok((groups, _)) => groups,
                Err(response) => return response,
            };
            let shares = advance_line_shares(&snapshot.line_items);
            let over = shares.iter().any(|((passthrough, rate), gross)| {
                let open: Decimal = groups
                    .iter()
                    .filter(|group| {
                        group_key(group.is_cost_passthrough, group.vat_rate)
                            == group_key(*passthrough, *rate)
                    })
                    .map(|group| group.open_gross)
                    .sum();
                *gross > open
            });
            if over {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "A share exceeds what its VAT group has left to bill",
                );
            }
        }
        if let Err(error) = sqlx::query(
            r#"UPDATE invoices
               SET line_items = $2, total_net = $3, total_vat = $4, total_gross = $5,
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(invoice_id)
        .bind(&snapshot.line_items)
        .bind(snapshot.total_net)
        .bind(snapshot.total_vat)
        .bind(snapshot.total_gross)
        .execute(&mut *transaction)
        .await
        {
            if let Some(response) = super::invoice_line_profile_conflict(&error) {
                return response;
            }
            tracing::error!(%error, %invoice_id, "store the rebuilt draft lines");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
        if *kind == "quote_positions"
            && let Err(response) = ensure_interim_leaves_open_advance(
                &mut transaction,
                &locked.invoice_type,
                invoice_id,
            )
            .await
        {
            return response;
        }
    }
    // Package overages the rebuilt draft bills are linked to it again.
    let relink_overages = rebuilt.as_ref().is_some_and(|(snapshot, kind)| {
        *kind == "quote_positions" && invoice_snapshot_has_package_overage(snapshot)
    });
    if relink_overages {
        let order_id = match sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT order_id FROM invoices WHERE id = $1",
        )
        .bind(invoice_id)
        .fetch_one(&mut *transaction)
        .await
        {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED),
            Err(error) => {
                tracing::error!(%error, %invoice_id, "load the draft order");
                return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
            }
        };
        if let Err(error) =
            link_package_consumptions_tx(&mut transaction, invoice_id, locked.patient_id, order_id)
                .await
        {
            tracing::error!(%error, %invoice_id, "link package consumption to the rebuilt draft");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }

    if let Err(error) = sqlx::query(
        "UPDATE invoices SET due_date = $2, notes = $3, updated_at = now() WHERE id = $1",
    )
    .bind(invoice_id)
    .bind(due_date)
    .bind(&notes)
    .execute(&mut *transaction)
    .await
    {
        tracing::error!(%error, %invoice_id, "store the draft header");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    let terms_before = match document_terms::load(&mut transaction, invoice_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "load the document terms of the draft");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let mut terms_after = terms_before.clone();
    if let Some(payment) = requested_payment {
        terms_after.received_payment = payment;
    }
    if let Some(period) = requested_period {
        terms_after.service_period = period;
    }
    // Only the roles that record payments note one (owner 2026-11-17); a
    // draft of another role keeps what they noted.
    if terms_after.received_payment != terms_before.received_payment
        && !auth.can(Capability::InvoicesFinance)
    {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if terms_after != terms_before
        && let Err(error) = document_terms::store(&mut transaction, invoice_id, &terms_after).await
    {
        tracing::error!(%error, %invoice_id, "store the document terms of the draft");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    let after = rebuilt.as_ref().map(|(snapshot, kind)| {
        json!({
            "kind": kind,
            "total_net": decimal_to_string(snapshot.total_net),
            "total_vat": decimal_to_string(snapshot.total_vat),
            "total_gross": decimal_to_string(snapshot.total_gross),
            "line_count": snapshot.line_items.as_array().map_or(0, Vec::len),
        })
    });
    if let Err(error) = write_invoice_audit_tx(
        &mut transaction,
        auth.user_id,
        "update_invoice_draft",
        invoice_id,
        json!({
            "patient_id": locked.patient_id,
            "before": {
                "due_date": locked.due_date.map(|value| value.to_string()),
                "notes": locked.notes,
                "total_net": decimal_to_string(locked.total_net),
                "total_vat": decimal_to_string(locked.total_vat),
                "total_gross": decimal_to_string(locked.total_gross),
                "line_count": locked.line_items.as_array().map_or(0, Vec::len),
                "payment_received": terms_before
                    .received_payment
                    .as_ref()
                    .map(document_terms::ReceivedPayment::to_json),
                "service_period": terms_before
                    .service_period
                    .map(document_terms::ServicePeriod::to_json),
            },
            "after": {
                "due_date": due_date.map(|value| value.to_string()),
                "notes": notes,
                "lines": after,
                "payment_received": terms_after
                    .received_payment
                    .as_ref()
                    .map(document_terms::ReceivedPayment::to_json),
                "service_period": terms_after
                    .service_period
                    .map(document_terms::ServicePeriod::to_json),
            },
        }),
    )
    .await
    {
        tracing::error!(%error, %invoice_id, "audit draft invoice update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(%error, %invoice_id, "commit draft invoice update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    crate::realtime::publish_invoice_event(
        &state,
        Some(auth.user_id),
        "invoice.status_changed",
        invoice_id,
        json!({ "status": "draft", "draft_updated": true, "patient_id": locked.patient_id }),
    )
    .await;

    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => Json(invoice).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

/// `DELETE /invoices/{id}`: deletes a draft (see the module comment) with the
/// rights of creating an invoice. Refused for a released or cancelled
/// invoice.
pub(super) async fn discard_invoice_draft(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    const FAILED: &str = "Failed to delete the draft invoice";
    if !auth.can(Capability::InvoicesCreate) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let draft = match load_draft(&state, invoice_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(response) = ensure_patient_access(&state, &auth, draft.patient_id).await {
        return response;
    }
    if !draft.is_draft() {
        return not_a_draft();
    }

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "begin draft invoice deletion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let locked = match sqlx::query(sqlx::AssertSqlSafe(format!(
        "{DRAFT_SELECT} FOR UPDATE OF invoice"
    )))
    .bind(invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => draft_row(&row),
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "lock draft invoice for deletion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if !locked.is_draft() {
        return not_a_draft();
    }

    // Quote quantities, concierge services and supplier invoices count only
    // for invoices that are not cancelled: the status frees them. Package
    // overages carry the invoice id and are unlinked.
    // A draft holds no advance allocation (the database refuses them on
    // drafts); should an old one exist, it goes with the draft and frees
    // the advance money (C-S3-7).
    for statement in [
        "DELETE FROM invoice_prepayment_allocations WHERE target_invoice_id = $1",
        "UPDATE invoices SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'draft' AND released_at IS NULL",
        "UPDATE service_package_consumptions SET invoice_id = NULL WHERE invoice_id = $1",
    ] {
        if let Err(error) = sqlx::query(statement)
            .bind(invoice_id)
            .execute(&mut *transaction)
            .await
        {
            tracing::error!(%error, %invoice_id, "delete draft invoice");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    }
    let concierge_services: i64 = match sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoice_concierge_service_lines WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "count concierge services of the draft");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    if let Err(error) = write_invoice_audit_tx(
        &mut transaction,
        auth.user_id,
        "discard_invoice_draft",
        invoice_id,
        json!({
            "patient_id": locked.patient_id,
            "quote_id": locked.quote_id,
            "invoice_type": locked.invoice_type,
            "invoice_number": locked.invoice_number,
            "total_gross": decimal_to_string(locked.total_gross),
            "line_count": locked.line_items.as_array().map_or(0, Vec::len),
            "concierge_services_freed": concierge_services,
            "status_before": "draft",
            "status": "cancelled",
        }),
    )
    .await
    {
        tracing::error!(%error, %invoice_id, "audit draft invoice deletion");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(%error, %invoice_id, "commit draft invoice deletion");
        return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
    }

    crate::realtime::publish_invoice_event(
        &state,
        Some(auth.user_id),
        "invoice.status_changed",
        invoice_id,
        json!({ "status": "cancelled", "draft_deleted": true, "patient_id": locked.patient_id }),
    )
    .await;

    Json(json!({ "id": invoice_id, "deleted": true })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(value: &str) -> Decimal {
        value.parse().unwrap()
    }

    fn group(passthrough: bool, rate: &str, open: &str) -> AdvanceGroup {
        AdvanceGroup {
            is_cost_passthrough: passthrough,
            vat_rate: dec(rate),
            open_gross: dec(open),
        }
    }

    #[test]
    fn the_advance_covers_own_services_first_then_pass_through_costs() {
        // 550 at 0 %, 119 at 19 %, 300 pass-through: 700 covers 669 own in
        // full, 31 goes to the pass-through costs.
        let groups = [
            group(false, "0", "550"),
            group(false, "19", "119"),
            group(true, "0", "300"),
        ];
        assert_eq!(
            own_services_first(dec("700"), &groups),
            vec![dec("550"), dec("119"), dec("31")]
        );
        // 500 does not reach all own services: split over them, none to costs.
        let shares = own_services_first(dec("500"), &groups);
        assert_eq!(shares[2], Decimal::ZERO);
        assert_eq!(shares[0] + shares[1], dec("500"));
        assert_eq!(shares[0], dec("411.06"));
        // The whole quote: every group in full.
        assert_eq!(
            own_services_first(dec("969"), &groups),
            vec![dec("550"), dec("119"), dec("300")]
        );
    }

    #[test]
    fn without_pass_through_costs_the_split_stays_proportional() {
        let groups = [group(false, "0", "550"), group(false, "19", "226.1")];
        let shares = own_services_first(dec("300"), &groups);
        assert_eq!(shares, vec![dec("212.60"), dec("87.40")]);
        // Only pass-through costs: they take the amount.
        let costs = [group(true, "0", "300")];
        assert_eq!(own_services_first(dec("100"), &costs), vec![dec("100")]);
    }

    #[test]
    fn a_manual_split_stays_within_the_open_groups_and_adds_up() {
        let groups = [group(false, "19", "119"), group(true, "0", "300")];
        assert_eq!(
            manual_split(
                dec("200"),
                &groups,
                &[(false, dec("19"), dec("50")), (true, dec("0"), dec("150"))]
            ),
            Ok(vec![dec("50"), dec("150")])
        );
        assert!(manual_split(dec("200"), &groups, &[(false, dec("19"), dec("119"))]).is_err());
        assert!(
            manual_split(
                dec("200"),
                &groups,
                &[(false, dec("19"), dec("200")), (true, dec("0"), dec("0"))]
            )
            .is_err()
        );
        assert!(manual_split(dec("200"), &groups, &[(false, dec("7"), dec("200"))]).is_err());
        assert!(
            manual_split(
                dec("100"),
                &groups,
                &[(true, dec("0"), dec("50")), (true, dec("0"), dec("50"))]
            )
            .is_err()
        );
        assert!(
            manual_split(
                dec("100"),
                &groups,
                &[(false, dec("19"), dec("150")), (true, dec("0"), dec("-50"))]
            )
            .is_err()
        );
    }
}
