//! The rules for a person's name, city and phone, one set for every place a
//! lead's people are entered (owner 2026-10-24): the lead cabinet, the staff
//! wizard, a representative, the payer and the invoice recipient. The
//! frontend mirrors them in `frontend/src/lib/person-fields.ts`.
//!
//! The rules apply to a new or changed value only; a value stored before
//! stays acceptable as it is (no migration).

/// Longest first, middle or last name.
pub const NAME_MAX: usize = 100;
/// Longest city.
pub const CITY_MAX: usize = 120;
/// Longest phone number.
pub const PHONE_MAX: usize = 40;
/// Fewest digits of a phone number.
pub const PHONE_MIN_DIGITS: usize = 6;

/// A text on one line: trimmed, inner whitespace collapsed to one space.
pub fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether a name (as [`one_line`] makes it) fits: at most [`NAME_MAX`]
/// characters, no control characters.
pub fn name_fits(value: &str) -> bool {
    let value = one_line(value);
    value.chars().count() <= NAME_MAX && !value.chars().any(char::is_control)
}

/// Whether a city (as [`one_line`] makes it) fits: at most [`CITY_MAX`]
/// characters.
pub fn city_fits(value: &str) -> bool {
    one_line(value).chars().count() <= CITY_MAX
}

/// A usable phone number: at least [`PHONE_MIN_DIGITS`] digits, besides
/// digits only `+ - ( ) / .` and spaces, at most [`PHONE_MAX`] characters.
/// Surrounding spaces do not count.
pub fn is_valid_phone(value: &str) -> bool {
    let phone = one_line(value);
    phone.chars().count() <= PHONE_MAX
        && phone.chars().filter(char::is_ascii_digit).count() >= PHONE_MIN_DIGITS
        && phone
            .chars()
            .all(|ch| ch.is_ascii_digit() || " +-()/.".contains(ch))
}

/// Whether `value` is a change of `stored`: the rules check only those.
pub fn changed(value: &str, stored: Option<&str>) -> bool {
    one_line(value) != one_line(stored.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_phone_has_six_digits_and_the_usual_separators() {
        for phone in [
            "+49 30 123456",
            "(030) 123-456",
            "030/123.456",
            " 0301234567 ",
        ] {
            assert!(is_valid_phone(phone), "{phone}");
        }
        for phone in [
            "12345",
            "+49 123",
            "call 0301234567",
            "0301234567 ext",
            "1".repeat(41).as_str(),
        ] {
            assert!(!is_valid_phone(phone), "{phone}");
        }
    }

    #[test]
    fn names_and_cities_are_one_line_and_short() {
        assert_eq!(one_line("  Anna   Maria \t"), "Anna Maria");
        assert!(name_fits(&"a".repeat(NAME_MAX)));
        assert!(!name_fits(&"a".repeat(NAME_MAX + 1)));
        // Collapsed spaces do not count.
        assert!(name_fits(&format!(
            "{}   {}",
            "a".repeat(50),
            "b".repeat(49)
        )));
        assert!(city_fits(&"b".repeat(CITY_MAX)));
        assert!(!city_fits(&"b".repeat(CITY_MAX + 1)));
    }

    #[test]
    fn only_a_change_is_checked() {
        assert!(!changed(" Anna  Muster ", Some("Anna Muster")));
        assert!(changed("Anna", Some("Anne")));
        assert!(changed("Anna", None));
        assert!(!changed("", None));
    }
}
