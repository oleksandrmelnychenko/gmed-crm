//! What staff note on a draft for its issued document (owner 2026-11-17):
//!
//! - money that arrived before the invoice: the day, the amount (left open =
//!   what the invoice leaves to pay at its release, after the advances it
//!   credits; less = a part payment) and the payment method. Only roles
//!   that record payments set it; the release records it as a payment with
//!   that day (`record_received_payment_at_release`) and the invoice states it.
//! - the service period: a range, or only its end («bis MM.YYYY»). Without it
//!   the period comes from the invoice's lines and its order.
//!
//! Both are stored on the draft and frozen with the release (GoBD).

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::{MoneyInput, decimal_to_string, document, is_valid_invoice_payment_method};
use crate::money::CommercialRounding;

/// Absent keeps what the draft has; an explicit `null` clears it.
pub(super) fn explicit_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
pub(super) struct ReceivedPaymentInput {
    received_on: String,
    /// Absent = what the invoice leaves to pay at its release.
    amount_gross: Option<MoneyInput>,
    payment_method: String,
}

#[derive(Deserialize)]
pub(super) struct ServicePeriodInput {
    from: Option<String>,
    to: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ReceivedPayment {
    pub received_on: NaiveDate,
    /// `None`: what the invoice leaves to pay at its release.
    pub amount_gross: Option<Decimal>,
    pub payment_method: String,
}

impl ReceivedPayment {
    pub(super) fn to_json(&self) -> Value {
        json!({
            "received_on": self.received_on.to_string(),
            "amount_gross": self.amount_gross.map(decimal_to_string),
            "payment_method": self.payment_method,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ServicePeriod {
    pub from: Option<NaiveDate>,
    pub to: NaiveDate,
}

impl ServicePeriod {
    pub(super) fn to_json(self) -> Value {
        json!({
            "from": self.from.map(|value| value.to_string()),
            "to": self.to.to_string(),
        })
    }
}

fn day(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok()
}

/// The received payment as typed: a day not after `today`, an amount above
/// zero in whole cents (without one: what is left to pay at the release), a
/// payment method of the payment journal.
pub(super) fn parse_received_payment(
    input: &ReceivedPaymentInput,
    today: NaiveDate,
) -> Result<ReceivedPayment, &'static str> {
    let received_on = day(&input.received_on).ok_or("Invalid payment date")?;
    if received_on > today {
        return Err("Invalid payment date");
    }
    let amount_gross = match &input.amount_gross {
        Some(amount) => Some(
            amount
                .parse_decimal()
                .filter(|amount| *amount > Decimal::ZERO && *amount == amount.round_cents())
                .ok_or("Invalid payment amount")?,
        ),
        None => None,
    };
    let payment_method = input.payment_method.trim();
    if !is_valid_invoice_payment_method(payment_method) {
        return Err("Invalid payment method");
    }
    Ok(ReceivedPayment {
        received_on,
        amount_gross,
        payment_method: payment_method.to_string(),
    })
}

/// The service period as typed: its end, and its start when known, not after
/// the end.
pub(super) fn parse_service_period(
    input: &ServicePeriodInput,
) -> Result<ServicePeriod, &'static str> {
    let to = day(&input.to).ok_or("Invalid service period")?;
    let from = match input.from.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => Some(day(raw).ok_or("Invalid service period")?),
    };
    if from.is_some_and(|from| from > to) {
        return Err("Invalid service period");
    }
    Ok(ServicePeriod { from, to })
}

/// What a draft holds of both.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct DraftTerms {
    pub received_payment: Option<ReceivedPayment>,
    pub service_period: Option<ServicePeriod>,
}

pub(super) async fn load(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<DraftTerms, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT payment_received_on, payment_received_amount, payment_received_method,
                  service_period_from, service_period_to
           FROM invoices WHERE id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else {
        return Ok(DraftTerms::default());
    };
    let received_payment = match (
        row.try_get::<Option<NaiveDate>, _>("payment_received_on")?,
        row.try_get::<Option<Decimal>, _>("payment_received_amount")?,
        row.try_get::<Option<String>, _>("payment_received_method")?,
    ) {
        (Some(received_on), amount_gross, Some(payment_method)) => Some(ReceivedPayment {
            received_on,
            amount_gross,
            payment_method,
        }),
        _ => None,
    };
    let service_period = row
        .try_get::<Option<NaiveDate>, _>("service_period_to")?
        .map(|to| ServicePeriod {
            from: row
                .try_get::<Option<NaiveDate>, _>("service_period_from")
                .unwrap_or_default(),
            to,
        });
    Ok(DraftTerms {
        received_payment,
        service_period,
    })
}

pub(super) async fn store(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    terms: &DraftTerms,
) -> Result<(), sqlx::Error> {
    let received = terms.received_payment.as_ref();
    sqlx::query(
        r#"UPDATE invoices
           SET payment_received_on = $2, payment_received_amount = $3,
               payment_received_method = $4, service_period_from = $5,
               service_period_to = $6, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .bind(received.map(|payment| payment.received_on))
    .bind(received.and_then(|payment| payment.amount_gross))
    .bind(received.map(|payment| payment.payment_method.clone()))
    .bind(terms.service_period.and_then(|period| period.from))
    .bind(terms.service_period.map(|period| period.to))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The period the invoice states when staff set none: the one of its lines
/// and its order, else the order's planned one (an invoice for services not
/// rendered yet claims no date of its own).
pub(super) async fn default_service_period(
    conn: &mut PgConnection,
    invoice_type: &str,
    order_id: Option<Uuid>,
    line_items: &Value,
) -> Result<Option<(NaiveDate, NaiveDate)>, sqlx::Error> {
    let (period, _) =
        document::load_invoice_service_timing(conn, invoice_type, order_id, line_items).await?;
    match (period, order_id) {
        (Some(period), _) => Ok(Some(period)),
        (None, Some(order_id)) => document::order_planned_period(conn, order_id).await,
        (None, None) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn received(on: &str, amount: &str, method: &str) -> ReceivedPaymentInput {
        ReceivedPaymentInput {
            received_on: on.to_string(),
            amount_gross: (!amount.is_empty()).then(|| MoneyInput::String(amount.to_string())),
            payment_method: method.to_string(),
        }
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 17).unwrap()
    }

    fn parse(input: &ReceivedPaymentInput) -> Result<ReceivedPayment, &'static str> {
        parse_received_payment(input, today())
    }

    #[test]
    fn a_received_payment_is_dated_up_to_today_in_whole_cents() {
        let payment = parse(&received("2026-11-15", "2000.00", "bank_transfer")).unwrap();
        assert_eq!(
            payment.received_on,
            NaiveDate::from_ymd_opt(2026, 11, 15).unwrap()
        );
        assert_eq!(payment.amount_gross, Some(Decimal::new(2000, 0)));
        assert!(parse(&received("2026-11-17", "1", "cash")).is_ok());
        // Without an amount: left open, the release takes what is due then.
        assert_eq!(
            parse(&received("2026-11-15", "", "cash"))
                .unwrap()
                .amount_gross,
            None
        );

        for (input, message) in [
            (received("2026-11-18", "10", "cash"), "Invalid payment date"),
            (received("17.11.2026", "10", "cash"), "Invalid payment date"),
            (
                received("2026-11-15", "0", "cash"),
                "Invalid payment amount",
            ),
            (
                received("2026-11-15", "-5", "cash"),
                "Invalid payment amount",
            ),
            (
                received("2026-11-15", "10.005", "cash"),
                "Invalid payment amount",
            ),
            (
                received("2026-11-15", "10", "crypto"),
                "Invalid payment method",
            ),
            (
                received("2026-11-15", "10", "legacy_import"),
                "Invalid payment method",
            ),
        ] {
            assert_eq!(parse(&input), Err(message));
        }
    }

    #[test]
    fn a_service_period_is_a_range_or_only_its_end() {
        let range = parse_service_period(&ServicePeriodInput {
            from: Some("2026-11-20".to_string()),
            to: "2026-11-25".to_string(),
        })
        .unwrap();
        assert_eq!(range.from, NaiveDate::from_ymd_opt(2026, 11, 20));
        let until = parse_service_period(&ServicePeriodInput {
            from: Some(" ".to_string()),
            to: "2026-12-31".to_string(),
        })
        .unwrap();
        assert_eq!(until.from, None);
        assert!(
            parse_service_period(&ServicePeriodInput {
                from: Some("2026-11-26".to_string()),
                to: "2026-11-25".to_string(),
            })
            .is_err()
        );
        assert!(
            parse_service_period(&ServicePeriodInput {
                from: None,
                to: String::new(),
            })
            .is_err()
        );
    }
}
