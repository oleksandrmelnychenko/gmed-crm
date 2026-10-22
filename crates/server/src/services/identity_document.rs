//! The rules for the data of an identity document (GwG § 12 (1) Nr. 1):
//! one set for every place that stores them — staff's form in the wizard
//! (patient and representatives), the cabinet and the payer's own link — and
//! for the check before a GwG sheet is confirmed (owner 2026-10-22: "why are
//! there no validators?").
//!
//! Old rows with values that break these rules still load; the rules apply
//! when a value is saved and when the identification is confirmed.

use chrono::NaiveDate;

use crate::routes::lead_portal_intake::FieldError;

/// What a complete document needs, in form order. The date of issue is
/// optional: § 12 GwG names type, number and issuing authority; the
/// validity tells whether the document can identify at all.
pub(crate) const REQUIRED_FIELDS: [&str; 5] = [
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_valid_until",
];

/// Letters and digits a document number needs at least (passports, ID cards
/// and residence permits of the EU and its neighbours have 6 to 12).
pub(crate) const NUMBER_MIN_ALPHANUMERICS: usize = 5;
/// The longest number with its separators.
pub(crate) const NUMBER_MAX_CHARS: usize = 30;

fn error(code: &'static str, field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        code,
        field,
        message,
    }
}

/// A typed document number as stored: spaces collapsed, upper case. Only
/// `A–Z`, digits, space, `-` and `<` (the machine readable zone); at least
/// [`NUMBER_MIN_ALPHANUMERICS`] letters or digits. Empty is `None`.
pub(crate) fn document_number(
    value: &str,
    field: &'static str,
) -> Result<Option<String>, FieldError> {
    let value = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase();
    if value.is_empty() {
        return Ok(None);
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || matches!(ch, ' ' | '-' | '<'))
    {
        return Err(error(
            "id_document_number_invalid",
            field,
            "Use the letters A-Z, digits, spaces, '-' or '<'",
        ));
    }
    if value.chars().count() > NUMBER_MAX_CHARS {
        return Err(error(
            "id_document_number_too_long",
            field,
            "The document number is too long",
        ));
    }
    if value.chars().filter(char::is_ascii_alphanumeric).count() < NUMBER_MIN_ALPHANUMERICS {
        return Err(error(
            "id_document_number_too_short",
            field,
            "The document number is too short",
        ));
    }
    Ok(Some(value))
}

/// Whether a stored number still follows [`document_number`].
pub(crate) fn document_number_valid(value: &str) -> bool {
    document_number(value, "id_document_number")
        .is_ok_and(|number| number.as_deref() == Some(value))
}

/// The issuing country as an ISO 3166-1 alpha-2 code; a country name from
/// another source ("Ukraine", "Deutschland") becomes its code.
pub(crate) fn issuing_country(
    value: &str,
    field: &'static str,
) -> Result<Option<String>, FieldError> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    crate::services::lead_guardian_identity::iso_country(value)
        .map(Some)
        .ok_or_else(|| {
            error(
                "id_issuing_country_invalid",
                field,
                "Use an ISO 3166-1 alpha-2 country code",
            )
        })
}

/// The dates of one document: issued neither in the future, before 1900 nor
/// before the holder's birth; valid until after the day of issue. An expired
/// document passes here: it may be recorded (trigger T12) but never
/// identifies (see [`problems`]).
pub(crate) fn check_dates(
    issued_on: Option<NaiveDate>,
    valid_until: Option<NaiveDate>,
    birth: Option<NaiveDate>,
    today: NaiveDate,
) -> Result<(), FieldError> {
    if let Some(issued) = issued_on {
        if issued > today {
            return Err(error(
                "id_issued_on_future",
                "id_issued_on",
                "Date of issue is in the future",
            ));
        }
        if NaiveDate::from_ymd_opt(1900, 1, 1).is_some_and(|first| issued < first) {
            return Err(error(
                "id_issued_on_too_early",
                "id_issued_on",
                "Date of issue is too early",
            ));
        }
        if birth.is_some_and(|birth| issued < birth) {
            return Err(error(
                "id_issued_on_before_birth",
                "id_issued_on",
                "Date of issue is before the date of birth",
            ));
        }
        if valid_until.is_some_and(|valid| valid <= issued) {
            return Err(error(
                "id_valid_until_before_issue",
                "id_valid_until",
                "Valid until must be after the date of issue",
            ));
        }
    }
    Ok(())
}

/// The stored data of one document.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Document<'a> {
    pub kind: Option<&'a str>,
    pub number: Option<&'a str>,
    pub authority: Option<&'a str>,
    pub country: Option<&'a str>,
    pub issued_on: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub unreadable: bool,
}

/// Why a document cannot identify its holder today, as keys in form order:
/// the missing [`REQUIRED_FIELDS`], then `id_document_number_invalid`,
/// `id_issuing_country_invalid`, `id_dates_invalid` and
/// `id_document_expired` (valid until before today, Europe/Berlin). A scan
/// marked unreadable is only `id_document_unreadable`: a new scan comes
/// first. Empty when the document identifies.
pub(crate) fn problems(
    document: &Document<'_>,
    birth: Option<NaiveDate>,
    today: NaiveDate,
) -> Vec<&'static str> {
    if document.unreadable {
        return vec!["id_document_unreadable"];
    }
    let filled = |value: Option<&str>| value.is_some_and(|value| !value.trim().is_empty());
    let mut problems: Vec<&'static str> = [
        ("id_document_type", filled(document.kind)),
        ("id_document_number", filled(document.number)),
        ("id_issuing_authority", filled(document.authority)),
        ("id_issuing_country", filled(document.country)),
        ("id_valid_until", document.valid_until.is_some()),
    ]
    .into_iter()
    .filter_map(|(field, filled)| (!filled).then_some(field))
    .collect();
    if document
        .number
        .is_some_and(|number| !number.trim().is_empty() && !document_number_valid(number))
    {
        problems.push("id_document_number_invalid");
    }
    if document.country.is_some_and(|country| {
        !country.trim().is_empty() && !crate::services::citizenships::is_country_code(country)
    }) {
        problems.push("id_issuing_country_invalid");
    }
    if check_dates(document.issued_on, document.valid_until, birth, today).is_err() {
        problems.push("id_dates_invalid");
    }
    if document.valid_until.is_some_and(|valid| valid < today) {
        problems.push("id_document_expired");
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[test]
    fn numbers_are_normalised_and_checked() {
        assert_eq!(
            document_number("  fa 123  4567 ", "n").unwrap(),
            Some("FA 123 4567".into())
        );
        assert_eq!(document_number("   ", "n").unwrap(), None);
        assert_eq!(
            document_number("P<UKR1234", "n").unwrap(),
            Some("P<UKR1234".into())
        );
        assert_eq!(
            document_number("AB-12345", "n").unwrap(),
            Some("AB-12345".into())
        );
        assert_eq!(
            document_number("AB12", "n").unwrap_err().code,
            "id_document_number_too_short"
        );
        assert_eq!(
            document_number("- - - 1", "n").unwrap_err().code,
            "id_document_number_too_short"
        );
        assert_eq!(
            document_number("АБ123456", "n").unwrap_err().code,
            "id_document_number_invalid"
        );
        assert_eq!(
            document_number("AB/123456", "n").unwrap_err().code,
            "id_document_number_invalid"
        );
        assert_eq!(
            document_number(&"A".repeat(31), "n").unwrap_err().code,
            "id_document_number_too_long"
        );
        assert!(document_number_valid("FA1234567"));
        assert!(!document_number_valid("fa1234567"));
    }

    #[test]
    fn countries_become_iso_codes() {
        assert_eq!(issuing_country("ua", "c").unwrap(), Some("UA".into()));
        assert_eq!(issuing_country("Ukraine", "c").unwrap(), Some("UA".into()));
        assert_eq!(issuing_country(" ", "c").unwrap(), None);
        assert_eq!(
            issuing_country("Atlantis", "c").unwrap_err().code,
            "id_issuing_country_invalid"
        );
    }

    #[test]
    fn dates_follow_each_other() {
        let today = day(2026, 10, 22);
        let birth = Some(day(1990, 5, 1));
        assert!(check_dates(Some(day(2020, 1, 1)), Some(day(2030, 1, 1)), birth, today).is_ok());
        assert!(check_dates(None, Some(day(2020, 1, 1)), birth, today).is_ok());
        assert_eq!(
            check_dates(Some(day(2026, 10, 23)), None, birth, today)
                .unwrap_err()
                .code,
            "id_issued_on_future"
        );
        assert_eq!(
            check_dates(Some(day(1989, 1, 1)), None, birth, today)
                .unwrap_err()
                .code,
            "id_issued_on_before_birth"
        );
        let wrong_order =
            check_dates(Some(day(2020, 1, 1)), Some(day(2020, 1, 1)), birth, today).unwrap_err();
        assert_eq!(
            (wrong_order.code, wrong_order.field),
            ("id_valid_until_before_issue", "id_valid_until")
        );
        assert_eq!(
            check_dates(Some(day(1899, 12, 31)), None, None, today)
                .unwrap_err()
                .code,
            "id_issued_on_too_early"
        );
        // An expired document is recorded as it is.
        assert!(check_dates(Some(day(2010, 1, 1)), Some(day(2020, 1, 1)), birth, today).is_ok());
    }

    #[test]
    fn problems_name_what_keeps_the_document_from_identifying() {
        let today = day(2026, 10, 22);
        let complete = Document {
            kind: Some("passport"),
            number: Some("FA1234567"),
            authority: Some("Passamt 8031"),
            country: Some("UA"),
            issued_on: Some(day(2020, 1, 1)),
            valid_until: Some(day(2030, 1, 1)),
            unreadable: false,
        };
        assert!(problems(&complete, None, today).is_empty());
        // The last day of validity still counts.
        assert!(
            problems(
                &Document {
                    valid_until: Some(today),
                    ..complete
                },
                None,
                today
            )
            .is_empty()
        );
        assert_eq!(
            problems(
                &Document {
                    valid_until: Some(day(2026, 10, 21)),
                    ..complete
                },
                None,
                today
            ),
            ["id_document_expired"]
        );
        assert_eq!(problems(&Document::default(), None, today), REQUIRED_FIELDS);
        assert_eq!(
            problems(
                &Document {
                    unreadable: true,
                    ..complete
                },
                None,
                today
            ),
            ["id_document_unreadable"]
        );
        assert_eq!(
            problems(
                &Document {
                    number: Some("ab"),
                    country: Some("Ukraine"),
                    ..complete
                },
                None,
                today
            ),
            ["id_document_number_invalid", "id_issuing_country_invalid"]
        );
        assert_eq!(
            problems(&complete, Some(day(2021, 1, 1)), today),
            ["id_dates_invalid"]
        );
    }
}
