//! German wording that order documents (Einzelauftrag, Kostenvoranschlag,
//! invoices) print for catalogue services: the German unit of a price, the
//! German name of a catalogue service and the payment terms of a cost
//! estimate. Documents are German whatever language the staff UI uses
//! (QA 2026-10-11: no "550,00 EUR/item" or "Interpreter support" on a German
//! document).

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// German money format with the euro sign: `1234.5` -> `"1.234,50 €"`.
/// Other currencies keep their ISO code after the amount.
pub(crate) fn format_money_de(value: Decimal, currency: &str) -> String {
    let rounded = crate::money::round_cents(value);
    let cents = (rounded.abs() * Decimal::ONE_HUNDRED)
        .to_u128()
        .unwrap_or(0);
    let digits = (cents / 100).to_string();
    let mut grouped = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    let sign = if rounded < Decimal::ZERO { "-" } else { "" };
    let currency = currency.trim().to_ascii_uppercase();
    let symbol = if currency.is_empty() || currency == "EUR" {
        "€".to_string()
    } else {
        currency
    };
    format!("{sign}{grouped},{:02} {symbol}", cents % 100)
}

/// The German unit of a catalogue price. The catalogue stores technical or
/// UI-language units ("item", "hour", "шт.", "час"); a German document
/// prints "Stück", "Std." and so on. Unknown units stay as entered.
pub(crate) fn german_unit_label(unit: &str) -> String {
    let trimmed = unit.trim();
    let german = match trimmed.to_lowercase().as_str() {
        "unit" | "units" | "einheit" | "ед." | "ед" | "единица" => "Einheit",
        "item" | "items" | "piece" | "pieces" | "pcs" | "pc" | "stk." | "stk" | "stück" | "шт."
        | "шт" | "штука" => "Stück",
        "hour" | "hours" | "h" | "std." | "std" | "stunde" | "stunden" | "час" | "ч." | "ч"
        | "часы" => "Std.",
        "ride" | "rides" | "trip" | "fahrt" | "поездка" => "Fahrt",
        "day" | "days" | "tag" | "tage" | "день" | "дн." => "Tag",
        "night" | "nights" | "nacht" | "ночь" => "Nacht",
        "week" | "weeks" | "woche" | "неделя" => "Woche",
        "month" | "months" | "monat" | "месяц" => "Monat",
        "package" | "packages" | "paket" | "пакет" => "Paket",
        "appointment" | "appointments" | "termin" | "приём" | "прием" => "Termin",
        _ => return trimmed.to_string(),
    };
    german.to_string()
}

/// The price column of a German document line: `"550,00 € / Stück"`, or the
/// amount alone when the catalogue has no unit.
pub(crate) fn unit_price_label_de(price: Decimal, currency: &str, unit: &str) -> String {
    let amount = format_money_de(price, currency);
    let unit = german_unit_label(unit);
    if unit.is_empty() {
        amount
    } else {
        format!("{amount} / {unit}")
    }
}

/// Prepayment terms of the order a Kostenvoranschlag belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KvPaymentTerms {
    /// The prepayment set on the order, when one is required.
    pub prepayment: Option<Decimal>,
    pub prepayment_due_at: Option<DateTime<Utc>>,
    /// The current order total the prepayment is compared with.
    pub order_total: Option<Decimal>,
}

impl KvPaymentTerms {
    fn covers_total(&self) -> bool {
        matches!(
            (self.prepayment, self.order_total),
            (Some(prepayment), Some(total)) if prepayment >= total
        )
    }

    fn due_suffix(&self) -> String {
        self.prepayment_due_at
            .map(|due| {
                let local = crate::app_time::local(due);
                format!(" bis zum {}", local.format("%d.%m.%Y, %H:%M Uhr"))
            })
            .unwrap_or_default()
    }
}

/// The sentence that introduces the bank details of a Kostenvoranschlag
/// (owner decision 2026-10-11): only the prepayment set on the order is due
/// before the treatment; the rest is billed with the final invoice. Without a
/// prepayment nothing is due before the start.
pub(crate) fn kv_payment_lead_in(terms: &KvPaymentTerms) -> String {
    match terms.prepayment {
        Some(_) if terms.covers_total() => format!(
            "Der angegebene Gesamtbetrag ist als Vorauszahlung{} vor Behandlungs-/Auftragsbeginn zu überweisen an:",
            terms.due_suffix()
        ),
        Some(prepayment) => format!(
            "Vor Behandlungs-/Auftragsbeginn ist die vereinbarte Vorauszahlung in Höhe von {}{} zu überweisen an:",
            format_money_de(prepayment, "EUR"),
            terms.due_suffix()
        ),
        None => "Eine Vorauszahlung vor Behandlungs-/Auftragsbeginn ist nicht vereinbart. \
                 Die Leistungen werden mit der Endabrechnung in Rechnung gestellt und sind zu überweisen an:"
            .to_string(),
    }
}

/// The sentence after the bank details when a prepayment covers only part of
/// the estimate: the rest follows with the final invoice.
pub(crate) fn kv_remainder_note(terms: &KvPaymentTerms) -> Option<&'static str> {
    (terms.prepayment.is_some() && !terms.covers_total())
        .then_some("Der verbleibende Betrag wird mit der Endabrechnung in Rechnung gestellt.")
}

/// The prepayment terms of an order for its Kostenvoranschlag. `None` when
/// the order does not exist.
pub(crate) async fn load_kv_payment_terms(
    db: &PgPool,
    order_id: Uuid,
) -> Result<Option<KvPaymentTerms>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT prepayment_required, prepayment_amount, prepayment_due_at, total_estimated
           FROM orders WHERE id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|row| {
        let required: bool = row.try_get("prepayment_required").unwrap_or(false);
        let amount: Option<Decimal> = row.try_get("prepayment_amount").unwrap_or_default();
        KvPaymentTerms {
            prepayment: amount.filter(|value| required && *value > Decimal::ZERO),
            prepayment_due_at: row.try_get("prepayment_due_at").unwrap_or_default(),
            order_total: row.try_get("total_estimated").unwrap_or_default(),
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    fn dec(value: &str) -> Decimal {
        value.parse().unwrap()
    }

    #[test]
    fn money_uses_the_german_format_with_the_euro_sign() {
        assert_eq!(format_money_de(dec("1234.5"), "EUR"), "1.234,50 €");
        assert_eq!(format_money_de(dec("95"), "eur"), "95,00 €");
        assert_eq!(format_money_de(dec("-12.345"), ""), "-12,35 €");
        assert_eq!(format_money_de(dec("1000000"), "CHF"), "1.000.000,00 CHF");
    }

    #[test]
    fn units_are_printed_in_german() {
        assert_eq!(german_unit_label("item"), "Stück");
        assert_eq!(german_unit_label(" hour "), "Std.");
        assert_eq!(german_unit_label("шт."), "Stück");
        assert_eq!(german_unit_label("поездка"), "Fahrt");
        assert_eq!(german_unit_label("Paket"), "Paket");
        assert_eq!(german_unit_label("Sitzung"), "Sitzung");
        assert_eq!(
            unit_price_label_de(dec("550"), "EUR", "item"),
            "550,00 € / Stück"
        );
        assert_eq!(
            unit_price_label_de(dec("95"), "EUR", "hour"),
            "95,00 € / Std."
        );
        assert_eq!(unit_price_label_de(dec("95"), "EUR", ""), "95,00 €");
    }

    #[test]
    fn a_partial_prepayment_is_due_before_the_start_and_the_rest_with_the_final_invoice() {
        let terms = KvPaymentTerms {
            prepayment: Some(dec("300")),
            prepayment_due_at: Some(Utc.with_ymd_and_hms(2026, 10, 15, 10, 0, 0).unwrap()),
            order_total: Some(dec("889.15")),
        };
        assert_eq!(
            kv_payment_lead_in(&terms),
            "Vor Behandlungs-/Auftragsbeginn ist die vereinbarte Vorauszahlung in Höhe von 300,00 € bis zum 15.10.2026, 12:00 Uhr zu überweisen an:"
        );
        assert_eq!(
            kv_remainder_note(&terms),
            Some("Der verbleibende Betrag wird mit der Endabrechnung in Rechnung gestellt.")
        );
    }

    #[test]
    fn a_prepayment_of_the_whole_total_keeps_the_total_wording() {
        let terms = KvPaymentTerms {
            prepayment: Some(dec("889.15")),
            prepayment_due_at: None,
            order_total: Some(dec("889.15")),
        };
        assert_eq!(
            kv_payment_lead_in(&terms),
            "Der angegebene Gesamtbetrag ist als Vorauszahlung vor Behandlungs-/Auftragsbeginn zu überweisen an:"
        );
        assert_eq!(kv_remainder_note(&terms), None);
    }

    #[test]
    fn without_a_prepayment_nothing_is_due_before_the_start() {
        let terms = KvPaymentTerms {
            prepayment: None,
            prepayment_due_at: None,
            order_total: Some(dec("889.15")),
        };
        let text = kv_payment_lead_in(&terms);
        assert!(text.starts_with(
            "Eine Vorauszahlung vor Behandlungs-/Auftragsbeginn ist nicht vereinbart."
        ));
        assert!(!text.contains("Gesamtbetrag"));
        assert_eq!(kv_remainder_note(&terms), None);
    }
}
