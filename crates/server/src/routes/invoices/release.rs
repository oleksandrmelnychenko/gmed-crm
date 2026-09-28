//! Releasing a draft invoice: it gets its number, its invoice date and a due
//! date on or after that date.
//!
//! Numbers come from `invoice_number_counter`, a single row locked by the
//! releasing transaction: a release that fails rolls its number back, so the
//! issued numbers have no gaps. Drafts carry no number (drafts numbered before
//! this rule keep theirs).

use chrono::{Days, NaiveDate};
use sqlx::PgConnection;

use super::gen_invoice_number;

/// Payment term when neither the request nor the draft names a due date.
pub(super) const DEFAULT_INVOICE_PAYMENT_TERM_DAYS: u64 = 14;

/// `system_settings.invoice_payment_term_days`, else the default.
pub(super) async fn load_invoice_payment_term_days(
    conn: &mut PgConnection,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT value #>> '{}' FROM system_settings WHERE key = 'invoice_payment_term_days'",
    )
    .fetch_optional(conn)
    .await?
    .and_then(|value| value.trim().parse::<u64>().ok())
    .filter(|days| (1..=365).contains(days))
    .unwrap_or(DEFAULT_INVOICE_PAYMENT_TERM_DAYS))
}

/// The due date a released invoice carries: the requested one, else the one
/// prepared on the draft, else the invoice date plus the payment term. It may
/// not lie before the invoice date.
pub(super) fn release_due_date(
    invoice_date: NaiveDate,
    requested: Option<NaiveDate>,
    stored: Option<NaiveDate>,
    payment_term_days: u64,
) -> Result<NaiveDate, &'static str> {
    let due_date = requested.or(stored).unwrap_or_else(|| {
        invoice_date
            .checked_add_days(Days::new(payment_term_days))
            .unwrap_or(invoice_date)
    });
    if due_date < invoice_date {
        return Err("The due date must be on or after the invoice date");
    }
    Ok(due_date)
}

/// Takes the next invoice number inside the releasing transaction.
pub(super) async fn next_invoice_number(
    conn: &mut PgConnection,
    invoice_date: NaiveDate,
) -> Result<String, sqlx::Error> {
    let value: i64 = sqlx::query_scalar(
        r#"UPDATE invoice_number_counter
           SET last_value = last_value + 1
           WHERE singleton
           RETURNING last_value"#,
    )
    .fetch_one(conn)
    .await?;
    Ok(gen_invoice_number(invoice_date, value))
}

/// Number range of credit notes and their reversals (`CN-…`, `CNR-…`).
pub(super) const SERIES_CREDIT_NOTE: &str = "credit_note";
/// Number range of cancellation documents (`STORNO-…`).
pub(super) const SERIES_INVOICE_STORNO: &str = "invoice_storno";

/// Takes the next number of a correction document range inside the issuing
/// transaction. The counter row stays locked until the transaction ends, so a
/// failed issue rolls its number back and the range has no gaps (GoBD).
pub(super) async fn next_correction_number(
    conn: &mut PgConnection,
    series: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"UPDATE invoice_document_number_counters
           SET last_value = last_value + 1
           WHERE series = $1
           RETURNING last_value"#,
    )
    .bind(series)
    .fetch_one(conn)
    .await
}

/// `CN-2026-000042`, `CNR-2026-000043`: credit notes and their reversals
/// share one range.
pub(super) fn credit_note_number(prefix: &str, issued_on: NaiveDate, value: i64) -> String {
    format!("{prefix}-{}-{value:06}", issued_on.format("%Y"))
}

/// `STORNO-20260928-0001`, dated like the invoice numbers.
pub(super) fn storno_number(issued_on: NaiveDate, value: i64) -> String {
    format!("STORNO-{}-{value:04}", issued_on.format("%Y%m%d"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn due_date_defaults_to_the_payment_term_after_the_invoice_date() {
        assert_eq!(
            release_due_date(day("2026-09-27"), None, None, 14),
            Ok(day("2026-10-11"))
        );
        assert_eq!(
            release_due_date(day("2026-09-27"), None, Some(day("2026-10-01")), 14),
            Ok(day("2026-10-01"))
        );
        assert_eq!(
            release_due_date(
                day("2026-09-27"),
                Some(day("2026-09-27")),
                Some(day("2026-10-01")),
                14
            ),
            Ok(day("2026-09-27"))
        );
    }

    #[test]
    fn correction_document_numbers_keep_their_formats() {
        assert_eq!(
            credit_note_number("CN", day("2026-09-28"), 42),
            "CN-2026-000042"
        );
        assert_eq!(
            credit_note_number("CNR", day("2026-01-02"), 7),
            "CNR-2026-000007"
        );
        assert_eq!(storno_number(day("2026-09-28"), 1), "STORNO-20260928-0001");
    }

    #[test]
    fn due_date_before_the_invoice_date_is_refused() {
        assert!(release_due_date(day("2026-09-27"), Some(day("2026-09-26")), None, 14).is_err());
        // A draft prepared with a date that has passed by release needs a new one.
        assert!(release_due_date(day("2026-09-27"), None, Some(day("2026-09-20")), 14).is_err());
    }
}
