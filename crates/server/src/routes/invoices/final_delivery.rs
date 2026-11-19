//! What a final invoice proposes: the delivered quantities, not the estimate
//! copied 1:1 (owner 2026-11-17).
//!
//! The order services (`order_leistungen`) are the only record of what was
//! delivered: an approved interpreter report puts its hours on the planned
//! line (a second report adds a line of its own), a completed appointment
//! moves one unit of a planned treatment block to a delivered line of its
//! own, staff mark other services delivered. So per estimate line:
//!
//! * the linked service, once delivered or approved, gives the actual
//!   quantity of the line;
//! * delivered services of the same catalogue service that no estimate line
//!   links ("siblings": the second report, the appointment units) are
//!   proposed as lines of their own under that estimate line;
//! * a line whose service is still planned proposes nothing (not delivered,
//!   QA 2026-11-19); only a line linking no service keeps the estimate
//!   («по смете»);
//! * delivered services matching no estimate line are proposed as lines
//!   outside the estimate.
//!
//! A service line outside the estimate carries the source
//! [`FINAL_ORDER_SERVICE_SOURCE`] and the service id, like the lines of a
//! termination settlement.

use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::str::FromStr;
use uuid::Uuid;

use crate::money::{self, CommercialRounding};

/// Invoice line source of a delivered order service a final invoice bills
/// beside the estimate lines.
pub(crate) const FINAL_ORDER_SERVICE_SOURCE: &str = "final_order_service";

/// One not cancelled service of the order, as the proposal reads it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct OrderServiceFact {
    pub id: Uuid,
    pub status: String,
    /// Delivery is recorded (delivered_at or approved_at): an `invoiced`
    /// service billed ahead of delivery has none (QA3 C S1-1).
    pub delivery_recorded: bool,
    pub quantity: Decimal,
    pub agency_service_id: Option<Uuid>,
    pub description: String,
    pub name: String,
    pub unit: Option<String>,
    pub unit_price: Decimal,
    pub vat_rate: Decimal,
    /// The line's discount in percent (owner 2026-11-18).
    pub discount_percent: Decimal,
    pub is_cost_passthrough: bool,
    /// The position's tax profile and its category (owner 2026-11-19).
    pub tax_profile_id: Option<Uuid>,
    pub vat_category: Option<String>,
    /// Active settlement invoices that bill the service (allocation or line).
    pub billing_invoice_ids: Vec<Uuid>,
    /// Invoices that billed the service and are credited in full.
    pub credited_invoice_ids: Vec<Uuid>,
    /// Waived by the release of a final invoice that did not bill it.
    pub waived: bool,
}

impl OrderServiceFact {
    /// Delivery is recorded: delivered, approved, or invoiced after its
    /// delivery. A service an interim billed while it was planned (the
    /// estimated outlays) is not delivered: the final credits it back (QA3
    /// C S1-1).
    pub fn delivered(&self) -> bool {
        match self.status.as_str() {
            "delivered" | "approved" => true,
            // Only the estimated outlays placeholder is read by its recorded
            // delivery: other services reach `invoiced` from paths that do
            // not stamp it (an approved interpreter report).
            "invoiced" => {
                self.delivery_recorded
                    || !(self.is_cost_passthrough
                        && self.description.trim() == ESTIMATED_OUTLAYS_DESCRIPTION)
            }
            _ => false,
        }
    }

    /// Billed by an active invoice other than `editing`. An `invoiced`
    /// service whose invoices are all credited in full is billable again.
    pub fn billed_besides(&self, editing: Option<Uuid>) -> bool {
        self.waived
            || (self.status == "invoiced" && self.credited_invoice_ids.is_empty())
            || self
                .billing_invoice_ids
                .iter()
                .any(|id| Some(*id) != editing)
    }
}

fn json_decimal(value: Option<&Value>) -> Option<Decimal> {
    match value? {
        Value::String(text) => Decimal::from_str(text.trim()).ok(),
        Value::Number(number) => Decimal::from_str(&number.to_string()).ok(),
        _ => None,
    }
}

fn json_uuid(value: Option<&Value>) -> Option<Uuid> {
    value
        .and_then(Value::as_str)
        .and_then(|text| Uuid::parse_str(text).ok())
}

/// Reads `order_service_delivery_facts(order)` (migration 20261117120006).
pub(crate) fn parse_facts(value: &Value) -> Vec<OrderServiceFact> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let text = |key: &str| {
                item.get(key)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            let ids = |key: &str| {
                item.get(key)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|id| json_uuid(Some(id)))
                    .collect::<Vec<_>>()
            };
            let is_cost_passthrough = crate::money::json_line_pass_through(item)
                || item
                    .get("is_cost_passthrough")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
            let tax_profile_id = json_uuid(item.get("tax_profile_id"));
            let vat_category = tax_profile_id
                .and(crate::money::json_line_vat_category(item))
                .map(ToOwned::to_owned);
            // The profile's rate is the position's rate (owner 2026-11-19).
            let stored_rate = tax_profile_id
                .and(json_decimal(item.get("tax_profile_vat_rate")))
                .or_else(|| json_decimal(item.get("vat_rate")))
                .unwrap_or(Decimal::ZERO)
                .round_commercial(2);
            Some(OrderServiceFact {
                id: json_uuid(item.get("id"))?,
                status: text("status"),
                delivery_recorded: item
                    .get("delivery_recorded")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                quantity: json_decimal(item.get("quantity")).unwrap_or(Decimal::ZERO),
                agency_service_id: json_uuid(item.get("agency_service_id")),
                description: text("description"),
                name: text("name"),
                unit: item
                    .get("unit")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|unit| !unit.is_empty())
                    .map(ToOwned::to_owned),
                unit_price: json_decimal(item.get("unit_price"))
                    .unwrap_or(Decimal::ZERO)
                    .round_cents(),
                // A pass-through service stores its purchase rate; the
                // patient is billed 0 % (QA 2026-11-19, S1-1).
                vat_rate: money::billed_vat_rate(is_cost_passthrough, stored_rate),
                discount_percent: money::json_discount_percent(item),
                is_cost_passthrough,
                tax_profile_id,
                vat_category,
                billing_invoice_ids: ids("billing_invoice_ids"),
                credited_invoice_ids: ids("credited_invoice_ids"),
                waived: item.get("waived").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect()
}

fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The estimate line states other terms than its service has now: unit
/// price, discount, billed VAT rate, or (when the line names one) the tax
/// profile. Invoices bill the signed estimate (QA3 D S2-2), so such a line
/// waits for a new estimate version.
pub(crate) fn quote_line_terms_differ(quote_line: &Value, fact: &OrderServiceFact) -> bool {
    let cents = |value: Option<Decimal>| value.map(|value| value.round_cents());
    let rate = |value: Option<Decimal>| value.map(|value| value.round_commercial(2));
    let quoted_price = cents(json_decimal(quote_line.get("unit_price")));
    let quoted_rate = rate(json_decimal(quote_line.get("vat_rate"))).unwrap_or(Decimal::ZERO);
    let quoted_discount = money::json_discount_percent(quote_line);
    let quoted_profile = json_uuid(quote_line.get("tax_profile_id"));
    quoted_price.is_some_and(|price| price != fact.unit_price.round_cents())
        || quoted_rate != fact.vat_rate.round_commercial(2)
        || quoted_discount.round_commercial(2) != fact.discount_percent.round_commercial(2)
        || quoted_profile.is_some_and(|profile| Some(profile) != fact.tax_profile_id)
}

/// What the order records as delivered for one estimate line.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct LineDelivery {
    /// Delivered quantity of the linked service; `None` while it is planned
    /// or the line links none.
    pub linked_actual: Option<Decimal>,
    /// Quantity of the linked service as it stands (a planned block keeps
    /// only its units not yet delivered).
    pub linked_quantity: Option<Decimal>,
    /// Delivered services of the same catalogue service no estimate line
    /// links, billed or not: delivery of this line is tracked.
    pub tracked_by_siblings: bool,
    /// The linked service no longer has the price, discount, VAT rate or
    /// tax profile the estimate states (QA3 D S2-2): what is billed is the
    /// signed estimate, so a new estimate version comes first.
    pub terms_changed: bool,
}

impl LineDelivery {
    /// Delivery of the line is recorded somewhere in the order.
    pub fn tracked(&self) -> bool {
        self.linked_actual.is_some() || self.tracked_by_siblings
    }

    /// What the line itself bills on a final invoice in total (billed parts
    /// included): the delivered quantity of its service, nothing when only
    /// siblings carry the delivery, the estimate otherwise (a planned block
    /// at most its open units).
    pub fn final_total(&self, quoted: Decimal) -> Decimal {
        if let Some(actual) = self.linked_actual {
            return actual.round_commercial(2);
        }
        // A service the order still has planned was not delivered: the
        // final invoice proposes nothing for it, also for the estimated
        // outlays («Voraussichtliche Auslagen»); staff may still type a
        // quantity (QA 2026-11-19, S1-2). Only a line linking no service at
        // all (a legacy quote) keeps the estimate.
        if self.tracked_by_siblings || self.linked_quantity.is_some() {
            return Decimal::ZERO;
        }
        quoted
    }
}

/// A delivered service no estimate line links, not billed yet.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ExtraService {
    pub fact: OrderServiceFact,
    /// The estimate line of the same catalogue service, if any.
    pub quote_line_index: Option<usize>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct DeliveryPlan {
    pub lines: Vec<LineDelivery>,
    pub extras: Vec<ExtraService>,
}

/// Reads the delivery of each estimate line and the services outside the
/// estimate. `editing` is a draft being rebuilt: its own lines do not count
/// as billing a service.
pub(crate) fn delivery_plan(
    quote_lines: &[Value],
    facts: &[OrderServiceFact],
    editing: Option<Uuid>,
) -> DeliveryPlan {
    // The service each estimate line bills: the one it names, or for a line
    // written without that link the service of the same wording (the rule
    // of `services_outside_quote`).
    let mut linked_ids = quote_lines
        .iter()
        .filter_map(|line| json_uuid(line.get("source_order_leistung_id")))
        .collect::<BTreeSet<_>>();
    let mut links = Vec::with_capacity(quote_lines.len());
    for line in quote_lines {
        let linked = match json_uuid(line.get("source_order_leistung_id")) {
            Some(id) => facts.iter().find(|fact| fact.id == id),
            None => {
                let wording = line
                    .get("description")
                    .and_then(Value::as_str)
                    .map(normalize)
                    .unwrap_or_default();
                let found = facts.iter().find(|fact| {
                    !wording.is_empty()
                        && !linked_ids.contains(&fact.id)
                        && normalize(&fact.description) == wording
                });
                if let Some(fact) = found {
                    linked_ids.insert(fact.id);
                }
                found
            }
        };
        links.push(linked);
    }
    // The estimate line a service outside the estimate belongs to: the same
    // catalogue service as the line's own service.
    let sibling_line = |fact: &OrderServiceFact| {
        fact.agency_service_id.and_then(|catalog| {
            links.iter().position(|linked| {
                linked.is_some_and(|linked| linked.agency_service_id == Some(catalog))
            })
        })
    };

    let mut lines = links
        .iter()
        .zip(quote_lines)
        .map(|(linked, quote_line)| {
            let linked = *linked;
            LineDelivery {
                linked_actual: linked
                    .filter(|fact| fact.delivered())
                    .map(|fact| fact.quantity),
                linked_quantity: linked.map(|fact| fact.quantity),
                tracked_by_siblings: false,
                terms_changed: linked.is_some_and(|fact| quote_line_terms_differ(quote_line, fact)),
            }
        })
        .collect::<Vec<_>>();
    let mut extras = Vec::new();
    for fact in facts {
        if linked_ids.contains(&fact.id) || !fact.delivered() {
            continue;
        }
        let line_index = sibling_line(fact);
        if let Some(index) = line_index {
            lines[index].tracked_by_siblings = true;
        }
        if fact.billed_besides(editing) || fact.quantity <= Decimal::ZERO {
            continue;
        }
        extras.push(ExtraService {
            fact: fact.clone(),
            quote_line_index: line_index,
        });
    }
    DeliveryPlan { lines, extras }
}

/// The extra service as the quote API offers it to the create dialog.
pub(crate) fn extra_service_json(extra: &ExtraService) -> Value {
    let fact = &extra.fact;
    json!({
        "order_leistung_id": fact.id,
        "description": fact.description,
        "name": fact.name,
        "unit": fact.unit,
        "quantity": money::money_string(fact.quantity.round_commercial(2)),
        "unit_price": money::money_string(fact.unit_price),
        "vat_rate": money::money_string(fact.vat_rate),
        "discount_percent": money::money_string(fact.discount_percent),
        "is_cost_passthrough": fact.is_cost_passthrough,
        "quote_line_index": extra.quote_line_index,
    })
}

/// One service outside the estimate picked for a final invoice.
#[derive(serde::Deserialize)]
pub(super) struct OrderServiceSelection {
    pub(super) order_leistung_id: Uuid,
    pub(super) quantity: super::MoneyInput,
    pub(super) comment: Option<String>,
}

/// The invoice line of a service outside the estimate.
pub(crate) fn extra_service_line(
    fact: &OrderServiceFact,
    quantity: Decimal,
    comment: Option<String>,
) -> (Value, money::LineAmounts) {
    let vat_rate = money::billed_vat_rate(fact.is_cost_passthrough, fact.vat_rate);
    let amounts = money::line_amounts(quantity, fact.unit_price, vat_rate, fact.discount_percent);
    let mut line = json!({
        "description": fact.description,
        "quantity": money::money_string(quantity),
        "unit": fact.unit.clone().unwrap_or_else(|| "unit".to_string()),
        "unit_price": money::money_string(fact.unit_price),
        "vat_rate": money::money_string(vat_rate),
        "line_net": money::money_string(amounts.net),
        "line_vat": money::money_string(amounts.vat),
        "line_gross": money::money_string(amounts.gross),
        "is_cost_passthrough": fact.is_cost_passthrough,
        "source": FINAL_ORDER_SERVICE_SOURCE,
        "source_order_leistung_id": fact.id,
        "quoted_quantity": "0",
    });
    if let (Some(profile_id), Some(map)) = (fact.tax_profile_id, line.as_object_mut()) {
        map.insert("tax_profile_id".to_string(), json!(profile_id));
        if let Some(category) = fact.vat_category.as_deref() {
            map.insert("vat_category".to_string(), json!(category));
        }
    }
    if fact.discount_percent > Decimal::ZERO
        && let Some(map) = line.as_object_mut()
    {
        map.insert(
            "discount_percent".to_string(),
            json!(money::money_string(fact.discount_percent)),
        );
    }
    money::store_line_discount_amount(&mut line, quantity, fact.unit_price, amounts.net);
    if let Some(comment) = comment {
        super::line_comments::set_line_comment(&mut line, Some(comment));
    }
    (line, amounts)
}

/// Invoice line source of the credit a final invoice gives for quantities
/// earlier invoices billed and the order never delivered (QA3 C S1-1).
pub(crate) const NOT_DELIVERED_CREDIT_SOURCE: &str = "final_not_delivered_credit";

/// Wording of that credit line on the invoice (German document language).
pub(crate) const NOT_DELIVERED_CREDIT_SUFFIX: &str =
    "nicht erbracht – Gutschrift der Zwischenrechnung";

/// The negative line crediting `credit_quantity` of `billed_quantity` an
/// earlier invoice billed of estimate line `line_index` (amounts `billed`):
/// the whole billed amount when nothing of it was delivered, else the
/// proportional net with its own VAT. `None` when nothing is to credit.
pub(crate) fn not_delivered_credit_line(
    quote_line: &Value,
    line_index: usize,
    billed_quantity: Decimal,
    credit_quantity: Decimal,
    billed: money::LineAmounts,
) -> Option<(Value, money::LineAmounts)> {
    if credit_quantity <= Decimal::ZERO
        || billed_quantity <= Decimal::ZERO
        || billed.net <= Decimal::ZERO
    {
        return None;
    }
    let vat_rate = json_decimal(quote_line.get("vat_rate"))
        .unwrap_or(Decimal::ZERO)
        .round_commercial(2);
    let amounts = if credit_quantity >= billed_quantity {
        billed
    } else {
        let net = (billed.net * credit_quantity / billed_quantity).round_cents();
        let vat = money::vat_amount(net, vat_rate);
        money::LineAmounts {
            net,
            vat,
            gross: (net + vat).round_cents(),
        }
    };
    let amounts = money::LineAmounts {
        net: -amounts.net,
        vat: -amounts.vat,
        gross: -amounts.gross,
    };
    let description = quote_line
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("Leistung");
    let unit_price = json_decimal(quote_line.get("unit_price"))
        .unwrap_or(Decimal::ZERO)
        .round_cents();
    let mut line = json!({
        "description": format!("{description} – {NOT_DELIVERED_CREDIT_SUFFIX}"),
        "quantity": money::money_string(-credit_quantity),
        "unit": quote_line.get("unit").and_then(Value::as_str).unwrap_or("unit"),
        "unit_price": money::money_string(unit_price),
        "vat_rate": money::money_string(vat_rate),
        "line_net": money::money_string(amounts.net),
        "line_vat": money::money_string(amounts.vat),
        "line_gross": money::money_string(amounts.gross),
        "is_cost_passthrough": money::json_line_pass_through(quote_line),
        "source": NOT_DELIVERED_CREDIT_SOURCE,
        "credited_quote_line_index": line_index,
        "quoted_quantity": "0",
    });
    if let Some(map) = line.as_object_mut() {
        if let Some(service) = quote_line.get("source_order_leistung_id").cloned() {
            map.insert("credited_order_leistung_id".to_string(), service);
        }
        for key in ["tax_profile_id", "vat_category", "discount_percent"] {
            if let Some(value) = quote_line.get(key).filter(|value| !value.is_null()) {
                map.insert(key.to_string(), value.clone());
            }
        }
    }
    Some((line, amounts))
}

/// The estimated outlays placeholder of an estimate («Voraussichtliche
/// Auslagen», a pass-through line): a planned amount, never a cost itself.
pub(crate) fn is_estimated_outlays_line(line: &Value) -> bool {
    money::json_line_pass_through(line)
        && line
            .get("description")
            .and_then(Value::as_str)
            .is_some_and(|text| text.trim() == ESTIMATED_OUTLAYS_DESCRIPTION)
}

/// Description of the estimated outlays placeholder line.
pub(crate) const ESTIMATED_OUTLAYS_DESCRIPTION: &str = "Voraussichtliche Auslagen";

/// Error code: a picked service is not a delivered, unbilled service of the
/// order outside the quote.
pub(super) const ORDER_SERVICE_NOT_BILLABLE: &str = "final_order_service_not_billable";

/// Error code: an estimate line bills more than its own service delivered
/// while the rest of the delivery is billed on a separate line.
pub(super) const FINAL_LINE_COUNTS_SEPARATE_SERVICE: &str = "final_line_counts_separate_service";

/// Adds the picked services outside the estimate to a final invoice. Returns
/// the services the lines bill, for [`ensure_order_services_unbilled_tx`].
pub(super) fn append_order_service_lines(
    snapshot: &mut super::InvoiceCreationSnapshot,
    ctx: &super::QuoteInvoiceContext,
    invoice_type: &str,
    selections: &[OrderServiceSelection],
) -> Result<Vec<Uuid>, axum::response::Response> {
    use axum::http::StatusCode;
    if selections.is_empty() {
        return Ok(Vec::new());
    }
    // A delivered service outside the estimate goes on an interim invoice too
    // (QA3 C S3-13); the final then no longer offers it.
    if !matches!(invoice_type, "final" | "interim") || ctx.order_contract_terminated {
        return Err(super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only a final or an interim invoice bills services outside the quote",
        ));
    }
    let quote_lines = ctx.line_items.as_array().cloned().unwrap_or_default();
    let plan = delivery_plan(
        &quote_lines,
        &ctx.order_service_facts,
        ctx.editing_invoice_id,
    );
    let mut seen = BTreeSet::new();
    let mut billed = Vec::new();
    let Some(lines) = snapshot.line_items.as_array_mut() else {
        return Err(super::err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build the invoice lines",
        ));
    };
    for selection in selections {
        if !seen.insert(selection.order_leistung_id) {
            return Err(super::err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invoice line was selected more than once",
            ));
        }
        let Some(quantity) = selection.quantity.parse_decimal() else {
            return Err(super::err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid invoice line quantity",
            ));
        };
        let quantity = quantity.round_commercial(2);
        if quantity < Decimal::ZERO {
            return Err(super::err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invoice line quantity must be greater than zero",
            ));
        }
        if quantity == Decimal::ZERO {
            continue;
        }
        let Some(extra) = plan
            .extras
            .iter()
            .find(|extra| extra.fact.id == selection.order_leistung_id)
        else {
            return Err(super::coded_err(
                StatusCode::CONFLICT,
                ORDER_SERVICE_NOT_BILLABLE,
                "The service is not a delivered, unbilled service of this order outside the quote",
                json!({ "order_leistung_id": selection.order_leistung_id }),
            ));
        };
        let comment = super::line_comments::normalize_line_comment(selection.comment.as_deref())
            .map_err(|message| super::err(StatusCode::UNPROCESSABLE_ENTITY, message))?;
        // The hours of a separate line of the same service are billed on that
        // line: its estimate line bills no more than its own service's
        // delivery, or they are billed twice (QA 2026-11-19, D S2-3: 4 h +
        // 2 h delivered, the estimate line set to 6 h billed 8 h).
        if let Some(index) = extra.quote_line_index {
            let own_delivered = plan.lines.get(index).map(|delivery| {
                let quoted = quote_lines
                    .get(index)
                    .and_then(|line| json_decimal(line.get("quantity")))
                    .unwrap_or(Decimal::ZERO)
                    .round_commercial(2);
                delivery.final_total(quoted)
            });
            let estimate_quantity = lines
                .iter()
                .filter(|line| {
                    !is_order_service_line(line)
                        && line.get("quote_line_index").and_then(Value::as_u64)
                            == u64::try_from(index).ok()
                })
                .filter_map(|line| json_decimal(line.get("quantity")))
                .sum::<Decimal>();
            if let Some(own_delivered) = own_delivered
                && plan.lines[index].linked_actual.is_some()
                && estimate_quantity > own_delivered
            {
                return Err(super::coded_err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    FINAL_LINE_COUNTS_SEPARATE_SERVICE,
                    "The estimate line bills hours another line of this invoice already bills",
                    json!({ "quote_line_index": index, "order_leistung_id": extra.fact.id }),
                ));
            }
        }
        let (line, amounts) = extra_service_line(&extra.fact, quantity, comment);
        lines.push(line);
        snapshot.total_net = (snapshot.total_net + amounts.net).round_cents();
        snapshot.total_vat = (snapshot.total_vat + amounts.vat).round_cents();
        snapshot.total_gross = (snapshot.total_gross + amounts.gross).round_cents();
        billed.push(extra.fact.id);
    }
    Ok(billed)
}

/// The draft's lines of services outside the quote as selections, so a
/// rebuild that sends no services keeps them.
pub(super) fn current_order_service_lines(line_items: &Value) -> Vec<OrderServiceSelection> {
    line_items
        .as_array()
        .into_iter()
        .flatten()
        .filter(|line| is_order_service_line(line))
        .filter_map(|line| {
            Some(OrderServiceSelection {
                order_leistung_id: json_uuid(line.get("source_order_leistung_id"))?,
                quantity: super::MoneyInput::String(money::money_string(
                    json_decimal(line.get("quantity")).unwrap_or(Decimal::ZERO),
                )),
                comment: super::line_comments::line_comment(line),
            })
        })
        .collect()
}

/// A line of a delivered service outside the quote.
pub(crate) fn is_order_service_line(line: &Value) -> bool {
    line.get("source").and_then(Value::as_str) == Some(FINAL_ORDER_SERVICE_SOURCE)
}

/// With the services locked, refuses a service another active invoice bills
/// meanwhile (`excluded` is the draft being rebuilt).
pub(super) async fn ensure_order_services_unbilled_tx(
    conn: &mut sqlx::PgConnection,
    excluded: Option<Uuid>,
    service_ids: &[Uuid],
) -> Result<(), axum::response::Response> {
    use axum::http::StatusCode;
    if service_ids.is_empty() {
        return Ok(());
    }
    sqlx::query("SELECT id FROM order_leistungen WHERE id = ANY($1) ORDER BY id FOR UPDATE")
        .bind(service_ids)
        .fetch_all(&mut *conn)
        .await
        .map_err(|error| {
            tracing::error!(%error, "lock the services of a final invoice");
            super::err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create invoice",
            )
        })?;
    let taken = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT service.id
           FROM order_leistungen service
           WHERE service.id = ANY($1)
             AND (
                 service.status = 'cancelled'
                 OR (
                     service.status = 'invoiced'
                     -- Invoices credited in full give the service back.
                     AND NOT EXISTS (
                         SELECT 1 FROM invoices credited
                         WHERE credited.order_id = service.order_id
                           AND credited.status <> 'cancelled'
                           AND credited.total_gross > 0
                           AND credited.credited_amount >= credited.total_gross
                           AND credited.line_items @> jsonb_build_array(
                               jsonb_build_object('source_order_leistung_id', service.id::text)
                           )
                     )
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM invoices invoice
                     WHERE invoice.order_id = service.order_id
                       AND invoice.status <> 'cancelled'
                       AND invoice.invoice_type <> 'advance'
                       AND (invoice.total_gross <= 0 OR invoice.credited_amount < invoice.total_gross)
                       AND ($2::UUID IS NULL OR invoice.id <> $2)
                       AND (
                           EXISTS (
                               SELECT 1 FROM invoice_order_line_allocations allocation
                               WHERE allocation.invoice_id = invoice.id
                                 AND allocation.order_leistung_id = service.id
                           )
                           OR invoice.line_items @> jsonb_build_array(
                               jsonb_build_object('source_order_leistung_id', service.id::text)
                           )
                       )
                 )
             )
           ORDER BY service.id"#,
    )
    .bind(service_ids)
    .bind(excluded)
    .fetch_all(&mut *conn)
    .await
    .map_err(|error| {
        tracing::error!(%error, "lock the services of a final invoice");
        super::err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create invoice")
    })?;
    if let Some(service_id) = taken.first() {
        return Err(super::coded_err(
            StatusCode::CONFLICT,
            ORDER_SERVICE_NOT_BILLABLE,
            "The service is not a delivered, unbilled service of this order outside the quote",
            json!({ "order_leistung_id": service_id }),
        ));
    }
    Ok(())
}

/// Billed by an active settlement invoice (SQL over `service`): a quote line
/// allocation or a line naming the service.
const SERVICE_BILLED_SQL: &str = r#"EXISTS (
    SELECT 1
    FROM invoices billing
    WHERE billing.order_id = service.order_id
      AND billing.status <> 'cancelled'
      AND billing.invoice_type <> 'advance'
      AND (billing.total_gross <= 0 OR billing.credited_amount < billing.total_gross)
      AND (
          EXISTS (
              SELECT 1 FROM invoice_order_line_allocations allocation
              WHERE allocation.invoice_id = billing.id
                AND allocation.order_leistung_id = service.id
          )
          OR billing.line_items @> jsonb_build_array(
              jsonb_build_object('source_order_leistung_id', service.id::text)
          )
      )
)"#;

/// Reason stored on a planned estimate line the final invoice did not bill.
const NOT_DELIVERED_REASON: &str = "Nicht erbracht – nicht in der Schlussrechnung";

/// What the release of a final invoice settled: planned estimate lines it
/// did not bill (cancelled) and delivered services it did not bill (waived).
#[derive(Debug, Default)]
pub(super) struct SettledLeftovers {
    pub cancelled: Vec<Uuid>,
    pub waived: Vec<Uuid>,
}

/// Owner decision 2026-11-17: the release of a final invoice (not a
/// termination settlement) closes the order's leftovers. Planned services
/// its quote names and no active invoice bills are cancelled as not
/// delivered; delivered or approved services no active invoice bills are
/// waived, so they are neither owed nor block closing the order.
pub(super) async fn settle_leftovers_tx(
    conn: &mut sqlx::PgConnection,
    invoice_id: Uuid,
    actor_id: Uuid,
) -> Result<SettledLeftovers, sqlx::Error> {
    let applies = sqlx::query_scalar::<_, bool>(
        r#"SELECT invoice.invoice_type = 'final'
                  AND invoice.quote_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM order_termination_settlements settlement
                      WHERE settlement.final_invoice_id = invoice.id
                  )
           FROM invoices invoice WHERE invoice.id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or(false);
    if !applies {
        return Ok(SettledLeftovers::default());
    }
    let cancelled = sqlx::query_scalar::<_, Uuid>(sqlx::AssertSqlSafe(format!(
        r#"UPDATE order_leistungen service
           SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2,
               cancellation_reason = $3, final_settlement_invoice_id = $1
           FROM invoices final_invoice
           JOIN quotes quote ON quote.id = final_invoice.quote_id
           WHERE final_invoice.id = $1
             AND service.order_id = final_invoice.order_id
             AND service.status = 'planned'
             AND quote.line_items @> jsonb_build_array(
                 jsonb_build_object('source_order_leistung_id', service.id::text)
             )
             AND NOT {billed}
           RETURNING service.id"#,
        billed = SERVICE_BILLED_SQL,
    )))
    .bind(invoice_id)
    .bind(actor_id)
    .bind(NOT_DELIVERED_REASON)
    .fetch_all(&mut *conn)
    .await?;
    let waived = sqlx::query_scalar::<_, Uuid>(sqlx::AssertSqlSafe(format!(
        r#"UPDATE order_leistungen service
           SET billing_waived_at = now(), final_settlement_invoice_id = $1
           FROM invoices final_invoice
           WHERE final_invoice.id = $1
             AND service.order_id = final_invoice.order_id
             AND service.status IN ('delivered', 'approved')
             AND service.billing_waived_at IS NULL
             AND NOT {billed}
           RETURNING service.id"#,
        billed = SERVICE_BILLED_SQL,
    )))
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(SettledLeftovers { cancelled, waived })
}

/// The Storno of a released final invoice gives back what its release
/// settled: cancelled estimate lines are planned again, waivers are lifted.
pub(super) async fn reopen_leftovers_tx(
    conn: &mut sqlx::PgConnection,
    invoice_id: Uuid,
) -> Result<SettledLeftovers, sqlx::Error> {
    let cancelled = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE order_leistungen
           SET status = 'planned', cancelled_at = NULL, cancelled_by = NULL,
               cancellation_reason = NULL, final_settlement_invoice_id = NULL
           WHERE final_settlement_invoice_id = $1 AND status = 'cancelled'
           RETURNING id"#,
    )
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await?;
    let waived = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE order_leistungen
           SET billing_waived_at = NULL, final_settlement_invoice_id = NULL
           WHERE final_settlement_invoice_id = $1 AND billing_waived_at IS NOT NULL
           RETURNING id"#,
    )
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(SettledLeftovers { cancelled, waived })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(id: u128, status: &str, quantity: &str, catalog: Option<u128>) -> OrderServiceFact {
        OrderServiceFact {
            id: Uuid::from_u128(id),
            status: status.to_string(),
            delivery_recorded: true,
            quantity: Decimal::from_str(quantity).unwrap(),
            agency_service_id: catalog.map(Uuid::from_u128),
            description: format!("Service {id}"),
            name: format!("Service {id}"),
            unit: None,
            unit_price: Decimal::from(60),
            vat_rate: Decimal::from(19),
            discount_percent: Decimal::ZERO,
            is_cost_passthrough: false,
            tax_profile_id: None,
            vat_category: None,
            billing_invoice_ids: Vec::new(),
            credited_invoice_ids: Vec::new(),
            waived: false,
        }
    }

    fn line(service: u128, quantity: &str) -> Value {
        json!({
            "description": "Dolmetscherstunden",
            "quantity": quantity,
            "source_order_leistung_id": Uuid::from_u128(service).to_string(),
        })
    }

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    #[test]
    fn an_approved_report_gives_the_line_its_actual_hours() {
        let plan = delivery_plan(
            &[line(1, "3")],
            &[fact(1, "approved", "5", Some(100))],
            None,
        );
        assert_eq!(plan.lines[0].linked_actual, Some(dec("5")));
        assert_eq!(plan.lines[0].final_total(dec("3")), dec("5"));
        assert!(plan.extras.is_empty());
    }

    #[test]
    fn a_line_whose_service_is_still_planned_proposes_nothing() {
        // QA 2026-11-19, S1-2: «Voraussichtliche Auslagen» never delivered.
        let plan = delivery_plan(&[line(1, "1")], &[fact(1, "planned", "1", Some(100))], None);
        assert!(!plan.lines[0].tracked());
        assert_eq!(plan.lines[0].final_total(dec("1")), Decimal::ZERO);
    }

    #[test]
    fn a_line_linking_no_service_keeps_the_estimate() {
        let unlinked = json!({ "description": "Altes Angebot", "quantity": "2" });
        let plan = delivery_plan(&[unlinked], &[fact(1, "planned", "3", Some(100))], None);
        assert_eq!(plan.lines[0].final_total(dec("2")), dec("2"));
    }

    #[test]
    fn a_pass_through_service_bills_zero_vat() {
        // QA 2026-11-19, S1-1: the service keeps its purchase rate (19 %).
        let facts = parse_facts(&json!([{
            "id": Uuid::from_u128(9).to_string(),
            "status": "delivered",
            "quantity": "1",
            "description": "Klinik MRT",
            "unit_price": "1200",
            "vat_rate": "19",
            "is_cost_passthrough": true,
        }]));
        assert_eq!(facts[0].vat_rate, Decimal::ZERO);
        let (line, amounts) = extra_service_line(&facts[0], dec("1"), None);
        assert_eq!(line["vat_rate"], "0");
        assert_eq!(amounts.vat, Decimal::ZERO);
        assert_eq!(amounts.gross, dec("1200"));
    }

    #[test]
    fn delivered_units_of_a_planned_block_are_proposed_under_its_line() {
        // 3 visits planned, 2 completed appointments took a unit each.
        let plan = delivery_plan(
            &[line(1, "3")],
            &[
                fact(1, "planned", "1", Some(200)),
                fact(2, "delivered", "1", Some(200)),
                fact(3, "delivered", "1", Some(200)),
            ],
            None,
        );
        assert!(plan.lines[0].tracked());
        assert_eq!(plan.lines[0].final_total(dec("3")), Decimal::ZERO);
        assert_eq!(plan.extras.len(), 2);
        assert!(
            plan.extras
                .iter()
                .all(|extra| extra.quote_line_index == Some(0))
        );
    }

    #[test]
    fn a_service_outside_the_estimate_is_proposed_without_a_line() {
        let mut billed = fact(3, "approved", "2", Some(300));
        billed.billing_invoice_ids = vec![Uuid::from_u128(77)];
        let plan = delivery_plan(
            &[line(1, "3")],
            &[
                fact(1, "approved", "3", Some(100)),
                fact(2, "approved", "1", Some(999)),
                billed.clone(),
                fact(4, "planned", "1", Some(888)),
            ],
            None,
        );
        assert_eq!(plan.extras.len(), 1);
        assert_eq!(plan.extras[0].fact.id, Uuid::from_u128(2));
        assert_eq!(plan.extras[0].quote_line_index, None);
        // The draft billing it is being rebuilt: offered again.
        let plan = delivery_plan(&[line(1, "3")], &[billed], Some(Uuid::from_u128(77)));
        assert_eq!(plan.extras.len(), 1);
    }
}
