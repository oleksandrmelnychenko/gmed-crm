//! The one e-mail address rule every form and API in GMED applies.
//!
//! The same rule runs in the browser (`frontend/src/lib/contact-validation.ts`,
//! `isValidEmailAddress`), so a form refuses what the server would refuse.
//! It accepts what real mailboxes use and refuses typing mistakes and
//! placeholders: `name@domain.tld` with an ASCII local part, a domain of at
//! least two labels and a top-level domain of at least two letters (or an
//! `xn--` IDN label).

/// Longest address SMTP can deliver to (RFC 5321 path limit minus brackets).
const MAX_LENGTH: usize = 254;
const MAX_LOCAL_LENGTH: usize = 64;
const MAX_LABEL_LENGTH: usize = 63;

/// Whether `value` (surrounding whitespace ignored) is a deliverable-looking
/// e-mail address.
pub fn is_valid_email(value: &str) -> bool {
    let value = value.trim();
    if value.len() > MAX_LENGTH {
        return false;
    }
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    valid_local_part(local) && valid_domain(domain)
}

/// The trimmed, lower-cased address when it is valid.
pub fn normalize_email(value: &str) -> Option<String> {
    is_valid_email(value).then(|| value.trim().to_lowercase())
}

fn valid_local_part(local: &str) -> bool {
    !local.is_empty()
        && local.len() <= MAX_LOCAL_LENGTH
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "!#$%&'*+/=?^_`{|}~.-".contains(c))
}

fn valid_domain(domain: &str) -> bool {
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 || !labels.iter().all(|label| valid_label(label)) {
        return false;
    }
    let tld = labels[labels.len() - 1];
    (tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()))
        || (tld.len() > 4 && tld.to_ascii_lowercase().starts_with("xn--"))
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= MAX_LABEL_LENGTH
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::{is_valid_email, normalize_email};

    #[test]
    fn accepts_real_addresses() {
        for valid in [
            "max.muster@example.de",
            " Anna.Muster+gmed@mail.example.co.uk ",
            "o'brien@example.ie",
            "a_b-c@sub-domain.example.com",
            "x@xn--80ak6aa92e.xn--p1ai",
            "info@gmed-health.com",
            "test@example.invalid",
        ] {
            assert!(is_valid_email(valid), "{valid}");
        }
    }

    #[test]
    fn refuses_garbage() {
        for invalid in [
            "",
            "asdf",
            "@example.de",
            "max@",
            "max@example",
            "max@example.",
            "max@.example.de",
            "max@example..de",
            "max@@example.de",
            "max@exa@mple.de",
            "max muster@example.de",
            "max@exa mple.de",
            ".max@example.de",
            "max.@example.de",
            "ma..x@example.de",
            "max@example.d",
            "max@example.123",
            "max@-example.de",
            "max@example-.de",
            "max@exam_ple.de",
            "max,muster@example.de",
            "max@example,de",
            "макс@пример.рф",
            "max@example.de>",
            "<max@example.de>",
            "a@b.c",
            "1@2.3",
        ] {
            assert!(!is_valid_email(invalid), "{invalid}");
        }
        let long_local = format!("{}@example.de", "a".repeat(65));
        assert!(!is_valid_email(&long_local));
        let long = format!("max@{}.de", "a".repeat(260));
        assert!(!is_valid_email(&long));
    }

    #[test]
    fn normalizes_case_and_whitespace() {
        assert_eq!(
            normalize_email("  Max.Muster@Example.DE "),
            Some("max.muster@example.de".to_string())
        );
        assert_eq!(normalize_email("max@example"), None);
    }
}
