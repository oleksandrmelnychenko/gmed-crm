//! How accounting-ledger entries read for people.
//!
//! Postings store a technical description ("invoice_refund refund INV-…",
//! "Provider payment …") and their payment method in `metadata`. The ledger
//! view and its CSV export name the operation instead:
//!
//! * a credit transfer between two invoices is booked as a refund leg on the
//!   source invoice and a payment leg on the target (both `credit_transfer`).
//!   No money moves, so it is shown and exported as a credit transfer
//!   ("Guthabenumbuchung"), never as a refund or a receipt (QA D3-05);
//! * the CSV for the bookkeeping uses German bookkeeping terms throughout:
//!   booking type, income/expense, category and booking text, German dates
//!   and decimal commas (QA round 1–3 remark "technical English texts").

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::Value;

use crate::routes::invoices::credit_transfers::CREDIT_TRANSFER_METHOD;

/// The fields of an accounting entry the texts are made of.
pub(crate) struct LedgerEntry<'a> {
    pub entry_kind: &'a str,
    pub description: &'a str,
    pub metadata: &'a Value,
    /// Number of the patient invoice the entry belongs to, if any.
    pub invoice_number: Option<&'a str>,
    /// Number of the supplier invoice the entry belongs to, if any.
    pub external_invoice_number: Option<&'a str>,
}

fn metadata_text<'a>(metadata: &'a Value, key: &str) -> Option<&'a str> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// Payment method of the receipt or refund the entry books, if recorded.
pub(crate) fn payment_method<'a>(entry: &LedgerEntry<'a>) -> Option<&'a str> {
    metadata_text(entry.metadata, "payment_method")
}

/// A leg of a credit transfer between two invoices of the patient.
pub(crate) fn is_credit_transfer(entry: &LedgerEntry<'_>) -> bool {
    matches!(entry.entry_kind, "invoice_payment" | "invoice_refund")
        && payment_method(entry) == Some(CREDIT_TRANSFER_METHOD)
}

/// Whether money actually moved (a credit transfer moves none).
pub(crate) fn is_cash_effective(entry: &LedgerEntry<'_>) -> bool {
    !is_credit_transfer(entry)
}

/// "payment"/"refund" or "reversal" of the journal row the entry books.
fn transaction_type<'a>(entry: &LedgerEntry<'a>) -> &'a str {
    let key = if entry.entry_kind == "invoice_refund" {
        "refund_transaction_type"
    } else {
        "payment_transaction_type"
    };
    metadata_text(entry.metadata, key)
        .or_else(|| entry.description.split_whitespace().nth(1))
        .unwrap_or("")
}

fn is_reversal(entry: &LedgerEntry<'_>) -> bool {
    transaction_type(entry) == "reversal"
}

/// The other invoice of a credit transfer (stored as the payment reference).
fn counter_invoice<'a>(entry: &LedgerEntry<'a>) -> &'a str {
    metadata_text(entry.metadata, "payment_reference").unwrap_or("—")
}

fn own_invoice<'a>(entry: &LedgerEntry<'a>) -> &'a str {
    entry
        .invoice_number
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| metadata_text(entry.metadata, "invoice_number"))
        .unwrap_or("—")
}

/// The description the ledger view shows (the UI words it in RU/DE): a
/// credit-transfer leg names the other invoice instead of a refund/receipt.
pub(crate) fn display_description(entry: &LedgerEntry<'_>) -> String {
    if !is_credit_transfer(entry) {
        return entry.description.to_string();
    }
    let counter = counter_invoice(entry);
    match (entry.entry_kind, is_reversal(entry)) {
        ("invoice_refund", false) => format!("Credit applied to invoice {counter}"),
        ("invoice_refund", true) => format!("Reversal of credit applied to invoice {counter}"),
        (_, false) => format!("Credit from invoice {counter}"),
        (_, true) => format!("Reversal of credit from invoice {counter}"),
    }
}

/// Booking type and booking text of the CSV, in German bookkeeping terms.
pub(crate) struct GermanBooking {
    pub kind: String,
    pub text: String,
}

fn strip_prefix_number<'a>(description: &'a str, prefix: &str) -> Option<&'a str> {
    description
        .strip_prefix(prefix)
        .map(str::trim)
        .filter(|rest| !rest.is_empty())
}

pub(crate) fn german_booking(entry: &LedgerEntry<'_>) -> GermanBooking {
    let own = own_invoice(entry);
    if is_credit_transfer(entry) {
        let counter = counter_invoice(entry);
        let (kind, text) = match (entry.entry_kind, is_reversal(entry)) {
            ("invoice_refund", false) => (
                "Guthabenumbuchung (abgehend)",
                format!("Guthabenumbuchung von Rechnung {own} auf Rechnung {counter}"),
            ),
            ("invoice_refund", true) => (
                "Storno Guthabenumbuchung (abgehend)",
                format!("Storno der Guthabenumbuchung von Rechnung {own} auf Rechnung {counter}"),
            ),
            (_, false) => (
                "Guthabenumbuchung (eingehend)",
                format!("Guthabenumbuchung auf Rechnung {own} aus Rechnung {counter}"),
            ),
            (_, true) => (
                "Storno Guthabenumbuchung (eingehend)",
                format!("Storno der Guthabenumbuchung auf Rechnung {own} aus Rechnung {counter}"),
            ),
        };
        return GermanBooking {
            kind: kind.to_string(),
            text,
        };
    }
    match entry.entry_kind {
        "invoice_payment" if is_reversal(entry) => GermanBooking {
            kind: "Storno Zahlungseingang".to_string(),
            text: format!("Storno des Zahlungseingangs zu Rechnung {own}"),
        },
        "invoice_payment" => GermanBooking {
            kind: "Zahlungseingang".to_string(),
            text: format!("Zahlungseingang zu Rechnung {own}"),
        },
        "invoice_refund" if is_reversal(entry) => GermanBooking {
            kind: "Storno Rückerstattung".to_string(),
            text: format!("Storno der Rückerstattung zu Rechnung {own}"),
        },
        "invoice_refund" => GermanBooking {
            kind: "Rückerstattung".to_string(),
            text: format!("Rückerstattung an den Patienten zu Rechnung {own}"),
        },
        _ => german_external_booking(entry),
    }
}

/// Payments of supplier invoices (partners, concierge partners).
fn german_external_booking(entry: &LedgerEntry<'_>) -> GermanBooking {
    let description = entry.description.trim();
    let external = entry
        .external_invoice_number
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let number = |prefix: &str| {
        external
            .map(str::to_string)
            .or_else(|| strip_prefix_number(description, prefix).map(str::to_string))
            .unwrap_or_else(|| "—".to_string())
    };
    let patterns: [(&str, &str, &str); 5] = [
        (
            "Provider payment reversal",
            "Storno Zahlung an Leistungserbringer",
            "Storno der Zahlung an den Leistungserbringer, Eingangsrechnung",
        ),
        (
            "Provider payment",
            "Zahlung an Leistungserbringer",
            "Zahlung an den Leistungserbringer, Eingangsrechnung",
        ),
        (
            "Concierge partner payment reversal",
            "Storno Zahlung an Concierge-Partner",
            "Storno der Zahlung an den Concierge-Partner, Eingangsrechnung",
        ),
        (
            "Concierge partner payment",
            "Zahlung an Concierge-Partner",
            "Zahlung an den Concierge-Partner, Eingangsrechnung",
        ),
        (
            "External invoice payment",
            "Zahlung Eingangsrechnung",
            "Zahlung der Eingangsrechnung",
        ),
    ];
    for (prefix, kind, text) in patterns {
        if description.starts_with(prefix) {
            return GermanBooking {
                kind: kind.to_string(),
                text: format!("{text} {}", number(prefix)),
            };
        }
    }
    GermanBooking {
        kind: if entry.entry_kind == "external_invoice_payment" {
            "Zahlung Eingangsrechnung".to_string()
        } else {
            "Buchung".to_string()
        },
        text: description.to_string(),
    }
}

/// "Einnahme" / "Ausgabe".
pub(crate) fn german_direction(direction: &str) -> &'static str {
    if direction == "income" {
        "Einnahme"
    } else {
        "Ausgabe"
    }
}

/// The posting category in bookkeeping terms.
pub(crate) fn german_category(category: &str) -> String {
    match category {
        "service_revenue" => "Erlöse Agenturleistungen".to_string(),
        "cost_passthrough_revenue" => "Weiterberechnete Kosten (Durchlaufposten)".to_string(),
        "patient_credit" => "Guthaben des Patienten".to_string(),
        "provider_expense" => "Aufwand Leistungserbringer".to_string(),
        other => other.to_string(),
    }
}

/// "1234,56" (decimal comma, no thousands separator: numeric in German Excel).
pub(crate) fn german_amount(value: Decimal) -> String {
    format!("{:.2}", crate::money::round_cents(value)).replace('.', ",")
}

/// "DD.MM.YYYY".
pub(crate) fn german_date(value: NaiveDate) -> String {
    value.format("%d.%m.%Y").to_string()
}

/// One CSV field for the `;`-separated German export.
pub(crate) fn csv_field(value: &str) -> String {
    if value.contains([';', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry<'a>(
        entry_kind: &'a str,
        description: &'a str,
        metadata: &'a Value,
        invoice_number: Option<&'a str>,
    ) -> LedgerEntry<'a> {
        LedgerEntry {
            entry_kind,
            description,
            metadata,
            invoice_number,
            external_invoice_number: None,
        }
    }

    #[test]
    fn a_credit_transfer_is_neither_a_refund_nor_a_receipt() {
        let out_meta = json!({
            "payment_method": "credit_transfer",
            "payment_reference": "INV-20261012-0009",
            "refund_transaction_type": "refund",
        });
        let out = entry(
            "invoice_refund",
            "invoice_refund refund INV-20261012-0002",
            &out_meta,
            Some("INV-20261012-0002"),
        );
        assert!(is_credit_transfer(&out));
        assert!(!is_cash_effective(&out));
        assert_eq!(
            display_description(&out),
            "Credit applied to invoice INV-20261012-0009"
        );
        let booking = german_booking(&out);
        assert_eq!(booking.kind, "Guthabenumbuchung (abgehend)");
        assert_eq!(
            booking.text,
            "Guthabenumbuchung von Rechnung INV-20261012-0002 auf Rechnung INV-20261012-0009"
        );

        let in_meta = json!({
            "payment_method": "credit_transfer",
            "payment_reference": "INV-20261012-0002",
            "payment_transaction_type": "reversal",
        });
        let reversed_in = entry(
            "invoice_payment",
            "invoice_payment reversal INV-20261012-0009",
            &in_meta,
            Some("INV-20261012-0009"),
        );
        assert_eq!(
            display_description(&reversed_in),
            "Reversal of credit from invoice INV-20261012-0002"
        );
        assert_eq!(
            german_booking(&reversed_in).kind,
            "Storno Guthabenumbuchung (eingehend)"
        );
    }

    #[test]
    fn cash_movements_keep_their_meaning_in_german() {
        let meta = json!({ "payment_method": "bank_transfer" });
        let payment = entry(
            "invoice_payment",
            "invoice_payment payment INV-1",
            &meta,
            Some("INV-1"),
        );
        assert!(is_cash_effective(&payment));
        assert_eq!(
            display_description(&payment),
            "invoice_payment payment INV-1"
        );
        assert_eq!(german_booking(&payment).kind, "Zahlungseingang");
        assert_eq!(
            german_booking(&payment).text,
            "Zahlungseingang zu Rechnung INV-1"
        );

        // Older postings without a transaction type in the metadata.
        let legacy = json!({});
        let refund_reversal = entry(
            "invoice_refund",
            "invoice_refund reversal INV-2",
            &legacy,
            Some("INV-2"),
        );
        assert_eq!(
            german_booking(&refund_reversal).kind,
            "Storno Rückerstattung"
        );

        let provider = entry(
            "external_invoice_payment",
            "Provider payment QA-D3-4711",
            &meta,
            None,
        );
        let booking = german_booking(&provider);
        assert_eq!(booking.kind, "Zahlung an Leistungserbringer");
        assert_eq!(
            booking.text,
            "Zahlung an den Leistungserbringer, Eingangsrechnung QA-D3-4711"
        );
        let reversal = entry(
            "external_invoice_payment",
            "Provider payment reversal QA-D3-4711",
            &meta,
            None,
        );
        assert_eq!(
            german_booking(&reversal).kind,
            "Storno Zahlung an Leistungserbringer"
        );
    }

    #[test]
    fn german_figures_and_fields() {
        assert_eq!(german_amount(Decimal::new(119, 0)), "119,00");
        assert_eq!(german_amount(Decimal::new(-3069, 2)), "-30,69");
        assert_eq!(
            german_date(NaiveDate::from_ymd_opt(2026, 10, 12).unwrap()),
            "12.10.2026"
        );
        assert_eq!(german_direction("income"), "Einnahme");
        assert_eq!(german_direction("expense"), "Ausgabe");
        assert_eq!(german_category("patient_credit"), "Guthaben des Patienten");
        assert_eq!(csv_field("Beispiel; GmbH"), "\"Beispiel; GmbH\"");
        assert_eq!(csv_field("Ben \"B\""), "\"Ben \"\"B\"\"\"");
        assert_eq!(csv_field("Anna Muster"), "Anna Muster");
    }
}
