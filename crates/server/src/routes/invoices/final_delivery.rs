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
//! * a line without any such record keeps the estimate quantity
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
    pub quantity: Decimal,
    pub agency_service_id: Option<Uuid>,
    pub description: String,
    pub name: String,
    pub unit: Option<String>,
    pub unit_price: Decimal,
    pub vat_rate: Decimal,
    pub is_cost_passthrough: bool,
    /// Active settlement invoices that bill the service (allocation or line).
    pub billing_invoice_ids: Vec<Uuid>,
    /// Invoices that billed the service and are credited in full.
    pub credited_invoice_ids: Vec<Uuid>,
}

impl OrderServiceFact {
    /// Delivery is recorded: delivered, approved, or already invoiced.
    pub fn delivered(&self) -> bool {
        matches!(self.status.as_str(), "delivered" | "approved" | "invoiced")
    }

    /// Billed by an active invoice other than `editing`. An `invoiced`
    /// service whose invoices are all credited in full is billable again.
    pub fn billed_besides(&self, editing: Option<Uuid>) -> bool {
        (self.status == "invoiced" && self.credited_invoice_ids.is_empty())
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
            Some(OrderServiceFact {
                id: json_uuid(item.get("id"))?,
                status: text("status"),
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
                vat_rate: json_decimal(item.get("vat_rate"))
                    .unwrap_or(Decimal::ZERO)
                    .round_commercial(2),
                is_cost_passthrough: item
                    .get("is_cost_passthrough")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                billing_invoice_ids: ids("billing_invoice_ids"),
                credited_invoice_ids: ids("credited_invoice_ids"),
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
        if self.tracked_by_siblings {
            return Decimal::ZERO;
        }
        self.linked_quantity
            .map_or(quoted, |quantity| quantity.round_commercial(2).min(quoted))
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
        .map(|linked| {
            let linked = *linked;
            LineDelivery {
                linked_actual: linked
                    .filter(|fact| fact.delivered())
                    .map(|fact| fact.quantity),
                linked_quantity: linked.map(|fact| fact.quantity),
                tracked_by_siblings: false,
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
    let amounts = money::line_amounts(quantity, fact.unit_price, fact.vat_rate);
    let mut line = json!({
        "description": fact.description,
        "quantity": money::money_string(quantity),
        "unit": fact.unit.clone().unwrap_or_else(|| "unit".to_string()),
        "unit_price": money::money_string(fact.unit_price),
        "vat_rate": money::money_string(fact.vat_rate),
        "line_net": money::money_string(amounts.net),
        "line_vat": money::money_string(amounts.vat),
        "line_gross": money::money_string(amounts.gross),
        "is_cost_passthrough": fact.is_cost_passthrough,
        "source": FINAL_ORDER_SERVICE_SOURCE,
        "source_order_leistung_id": fact.id,
        "quoted_quantity": "0",
    });
    if let Some(comment) = comment {
        super::line_comments::set_line_comment(&mut line, Some(comment));
    }
    (line, amounts)
}

/// Error code: a picked service is not a delivered, unbilled service of the
/// order outside the quote.
pub(super) const ORDER_SERVICE_NOT_BILLABLE: &str = "final_order_service_not_billable";

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
    if invoice_type != "final" || ctx.order_contract_terminated {
        return Err(super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only a final invoice bills services outside the quote",
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(id: u128, status: &str, quantity: &str, catalog: Option<u128>) -> OrderServiceFact {
        OrderServiceFact {
            id: Uuid::from_u128(id),
            status: status.to_string(),
            quantity: Decimal::from_str(quantity).unwrap(),
            agency_service_id: catalog.map(Uuid::from_u128),
            description: format!("Service {id}"),
            name: format!("Service {id}"),
            unit: None,
            unit_price: Decimal::from(60),
            vat_rate: Decimal::from(19),
            is_cost_passthrough: false,
            billing_invoice_ids: Vec::new(),
            credited_invoice_ids: Vec::new(),
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
    fn a_planned_line_keeps_the_estimate() {
        let plan = delivery_plan(&[line(1, "3")], &[fact(1, "planned", "3", Some(100))], None);
        assert!(!plan.lines[0].tracked());
        assert_eq!(plan.lines[0].final_total(dec("3")), dec("3"));
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
