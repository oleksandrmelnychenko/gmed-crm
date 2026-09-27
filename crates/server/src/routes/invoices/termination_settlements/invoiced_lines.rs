//! Which order services the lines of an order's invoices already bill.
//!
//! Invoice lines built from a quote carry the order service they came from
//! (`source_order_leistung_id`). Quotes written by hand or before that link
//! existed do not, so their invoice lines named no service and the settlement
//! counted the service as not invoiced: "create final invoice" billed a flat
//! fee a second time (1,000 € while only 29.30 € was actually open). Such
//! legacy lines are matched to the order's services by description, unit
//! price and VAT rate; a line that matches nothing is reported, never guessed.

use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::BTreeMap;
use std::str::FromStr;
use uuid::Uuid;

use crate::money::CommercialRounding;

/// An order service lines can bill.
#[derive(Debug, Clone)]
pub(crate) struct ServiceKey {
    pub id: Uuid,
    /// Normalised names the service is known by (catalog name, description).
    pub names: Vec<String>,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub vat_rate: Decimal,
}

/// One line of a non-cancelled settlement invoice of the order.
#[derive(Debug, Clone)]
pub(crate) struct InvoicedLine {
    pub source_service_id: Option<Uuid>,
    /// Third-party cost lines are matched through their receivable allocation.
    pub third_party: bool,
    pub description: String,
    pub quantity: Decimal,
    pub unit_price: Option<Decimal>,
    pub vat_rate: Option<Decimal>,
    pub gross: Decimal,
}

fn json_decimal(item: &Value, key: &str) -> Option<Decimal> {
    match item.get(key)? {
        Value::String(text) => Decimal::from_str(text.trim()).ok(),
        Value::Number(number) => Decimal::from_str(&number.to_string()).ok(),
        _ => None,
    }
}

/// Lower-case, single-spaced text for comparing service names.
pub(crate) fn normalize_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

impl InvoicedLine {
    pub fn from_json(item: &Value) -> Self {
        let source = item
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or_default();
        Self {
            source_service_id: item
                .get("source_order_leistung_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok()),
            third_party: source == "external_invoice"
                || item
                    .get("source_external_invoice_id")
                    .is_some_and(|value| !value.is_null()),
            description: normalize_name(
                item.get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
            quantity: json_decimal(item, "quantity").unwrap_or(Decimal::ONE),
            unit_price: json_decimal(item, "unit_price").map(CommercialRounding::round_cents),
            vat_rate: json_decimal(item, "vat_rate").map(|rate| rate.round_commercial(2)),
            gross: json_decimal(item, "line_gross").unwrap_or(Decimal::ZERO),
        }
    }
}

/// Invoiced quantity per service and the gross of lines that bill no known
/// service.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct InvoicedQuantities {
    pub by_service: BTreeMap<Uuid, Decimal>,
    pub unmatched_gross: Decimal,
}

fn same_price(service: &ServiceKey, line: &InvoicedLine) -> bool {
    line.unit_price
        .is_some_and(|price| price == service.unit_price.round_cents())
        && line
            .vat_rate
            .is_none_or(|rate| rate == service.vat_rate.round_commercial(2))
}

/// Attributes invoice lines to services: linked lines to their service, then
/// legacy lines to a service with the same name, price and VAT rate, then to
/// the only service with the same price and VAT rate. A service takes at most
/// its own quantity; what no service can take is unmatched.
pub(crate) fn attribute_invoiced_lines(
    services: &[ServiceKey],
    lines: &[InvoicedLine],
) -> InvoicedQuantities {
    let mut result = InvoicedQuantities::default();
    let mut legacy = Vec::new();
    for line in lines {
        if line.third_party {
            continue;
        }
        match line.source_service_id {
            Some(id) => *result.by_service.entry(id).or_default() += line.quantity,
            None => legacy.push(line),
        }
    }

    let open = |result: &InvoicedQuantities, service: &ServiceKey| {
        (service.quantity
            - result
                .by_service
                .get(&service.id)
                .copied()
                .unwrap_or_default())
        .max(Decimal::ZERO)
    };
    let mut unmatched = Vec::new();
    for line in legacy {
        let mut left = line.quantity;
        for service in services.iter().filter(|service| {
            same_price(service, line) && service.names.contains(&line.description)
        }) {
            let take = open(&result, service).min(left);
            if take > Decimal::ZERO {
                *result.by_service.entry(service.id).or_default() += take;
                left -= take;
            }
        }
        if left > Decimal::ZERO {
            unmatched.push((line, left));
        }
    }
    for (line, mut left) in unmatched {
        let candidates = services
            .iter()
            .filter(|service| same_price(service, line) && open(&result, service) > Decimal::ZERO)
            .collect::<Vec<_>>();
        if let [service] = candidates.as_slice() {
            let take = open(&result, service).min(left);
            *result.by_service.entry(service.id).or_default() += take;
            left -= take;
        }
        if left > Decimal::ZERO && line.quantity > Decimal::ZERO {
            result.unmatched_gross += (line.gross * left / line.quantity).round_cents();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    fn service(id: u128, name: &str, quantity: &str, price: &str) -> ServiceKey {
        ServiceKey {
            id: Uuid::from_u128(id),
            names: vec![normalize_name(name)],
            quantity: dec(quantity),
            unit_price: dec(price),
            vat_rate: dec("19"),
        }
    }

    #[test]
    fn a_legacy_quote_line_without_service_link_bills_its_flat_fee() {
        let services = [
            service(1, "Organisation der Behandlung", "1", "840.34"),
            service(2, "Dolmetscher", "2", "12.31"),
        ];
        let legacy = InvoicedLine::from_json(&json!({
            "description": " Organisation der  Behandlung",
            "quantity": "1",
            "unit_price": "840.34",
            "vat_rate": "19",
            "line_gross": "1000"
        }));
        let result = attribute_invoiced_lines(&services, &[legacy]);
        assert_eq!(result.by_service.get(&Uuid::from_u128(1)), Some(&dec("1")));
        assert_eq!(result.by_service.get(&Uuid::from_u128(2)), None);
        assert_eq!(result.unmatched_gross, Decimal::ZERO);
    }

    #[test]
    fn linked_lines_count_first_and_renamed_legacy_lines_match_a_unique_price() {
        let services = [
            service(1, "Dolmetscher", "10", "60"),
            service(2, "Transfer", "1", "80"),
        ];
        let lines = [
            InvoicedLine::from_json(&json!({
                "description": "Dolmetscher",
                "quantity": "4",
                "unit_price": "60",
                "vat_rate": "19",
                "line_gross": "285.60",
                "source_order_leistung_id": Uuid::from_u128(1).to_string()
            })),
            InvoicedLine::from_json(&json!({
                "description": "Flughafentransfer",
                "quantity": "1",
                "unit_price": "80",
                "vat_rate": "19",
                "line_gross": "95.20"
            })),
            InvoicedLine::from_json(&json!({
                "description": "Hotel",
                "quantity": "1",
                "unit_price": "481.5",
                "vat_rate": "0",
                "line_gross": "481.5",
                "source": "external_invoice",
                "source_external_invoice_id": Uuid::from_u128(9).to_string()
            })),
            InvoicedLine::from_json(&json!({
                "description": "Something else",
                "quantity": "2",
                "unit_price": "15",
                "vat_rate": "19",
                "line_gross": "35.70"
            })),
        ];
        let result = attribute_invoiced_lines(&services, &lines);
        assert_eq!(result.by_service.get(&Uuid::from_u128(1)), Some(&dec("4")));
        assert_eq!(result.by_service.get(&Uuid::from_u128(2)), Some(&dec("1")));
        assert_eq!(result.unmatched_gross, dec("35.70"));
    }

    #[test]
    fn a_service_takes_no_more_than_its_quantity() {
        let services = [service(1, "Dolmetscher", "2", "60")];
        let line = InvoicedLine::from_json(&json!({
            "description": "Dolmetscher",
            "quantity": "3",
            "unit_price": "60",
            "vat_rate": "19",
            "line_gross": "214.20"
        }));
        let result = attribute_invoiced_lines(&services, &[line]);
        assert_eq!(result.by_service.get(&Uuid::from_u128(1)), Some(&dec("2")));
        assert_eq!(result.unmatched_gross, dec("71.40"));
    }
}
