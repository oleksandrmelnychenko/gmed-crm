//! Citizenships and countries as ISO 3166-1 alpha-2 codes.
//!
//! A person may hold several citizenships (owner decision 2026-10-03). Leads,
//! patients and third-party payers store them as upper-case alpha-2 codes
//! (`leads.citizenships`, `patients.citizenships`,
//! `lead_payer_declarations.citizenships`), so sanctions screening and the AML
//! country risk compare codes instead of free text. The old single value
//! (`patients.nationality`, the wizard's `registration_country`) keeps the
//! first citizenship for readers that still expect one country.

use crate::routes::patients::ISO_3166_ALPHA_2_COUNTRY_CODES;

/// More citizenships than any real person holds; guards against bulk input.
pub const MAX_CITIZENSHIPS: usize = 10;

pub const INVALID_CITIZENSHIP: &str = "Invalid citizenship (ISO 3166-1 alpha-2 code expected)";
pub const TOO_MANY_CITIZENSHIPS: &str = "Too many citizenships";
pub const INVALID_COUNTRY: &str = "Invalid country (ISO 3166-1 alpha-2 code expected)";

/// Whether `value` is a known ISO 3166-1 alpha-2 code (case-insensitive).
pub fn is_country_code(value: &str) -> bool {
    let code = value.trim().to_ascii_uppercase();
    code.len() == 2 && ISO_3166_ALPHA_2_COUNTRY_CODES.contains(&code.as_str())
}

/// Unique upper-case codes in input order; empty entries are skipped.
pub fn normalize_citizenships(values: &[String]) -> Result<Vec<String>, &'static str> {
    let mut codes: Vec<String> = Vec::with_capacity(values.len());
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !is_country_code(trimmed) {
            return Err(INVALID_CITIZENSHIP);
        }
        let code = trimmed.to_ascii_uppercase();
        if !codes.contains(&code) {
            codes.push(code);
        }
    }
    if codes.len() > MAX_CITIZENSHIPS {
        return Err(TOO_MANY_CITIZENSHIPS);
    }
    Ok(codes)
}

/// One optional country code: `None` for an empty value.
pub fn normalize_country_code(value: Option<&str>) -> Result<Option<String>, &'static str> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some(value) if is_country_code(value) => Ok(Some(value.to_ascii_uppercase())),
        Some(_) => Err(INVALID_COUNTRY),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn citizenships_are_upper_case_unique_and_known() {
        assert_eq!(
            normalize_citizenships(&strings(&["de", " UA ", "DE", ""])).unwrap(),
            strings(&["DE", "UA"])
        );
        assert_eq!(
            normalize_citizenships(&strings(&["XX"])),
            Err(INVALID_CITIZENSHIP)
        );
        assert_eq!(
            normalize_citizenships(&strings(&["Germany"])),
            Err(INVALID_CITIZENSHIP)
        );
        assert!(normalize_citizenships(&[]).unwrap().is_empty());
    }

    #[test]
    fn too_many_citizenships_are_rejected() {
        let codes = strings(&[
            "DE", "AT", "CH", "FR", "IT", "ES", "PT", "NL", "BE", "LU", "PL",
        ]);
        assert_eq!(normalize_citizenships(&codes), Err(TOO_MANY_CITIZENSHIPS));
    }

    #[test]
    fn country_code_is_optional_and_validated() {
        assert_eq!(normalize_country_code(None), Ok(None));
        assert_eq!(normalize_country_code(Some("  ")), Ok(None));
        assert_eq!(normalize_country_code(Some("at")), Ok(Some("AT".into())));
        assert_eq!(
            normalize_country_code(Some("Austria")),
            Err(INVALID_COUNTRY)
        );
    }
}
