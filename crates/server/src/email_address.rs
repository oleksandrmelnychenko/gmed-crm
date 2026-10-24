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

/// Whether `value` (surrounding whitespace ignored) is a well-formed e-mail
/// address whose domain is not known to refuse mail (`crate::email_domain`;
/// an unchecked domain is looked up in the background and passes).
pub fn is_valid_email(value: &str) -> bool {
    has_valid_format(value)
        && crate::email_domain::domain_of(value)
            .is_none_or(|domain| !crate::email_domain::known_no_mail(&domain))
}

/// Whether `value` is a well-formed e-mail address; no DNS involved.
pub fn has_valid_format(value: &str) -> bool {
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

/// The trimmed, lower-cased address when it is well-formed; no DNS. For an
/// address already on file: a stored address is never judged by its domain
/// again (QA 2026-10-24), so a domain rated `no_mail` today neither hides the
/// address nor blocks saving another field. Sending to it reports a delivery
/// failure if the domain really is dead (`crate::mail`).
pub fn normalize_stored_email(value: &str) -> Option<String> {
    has_valid_format(value).then(|| value.trim().to_lowercase())
}

/// The domain of `next` when the address is set or changed in this request
/// (it differs from `current`, case and surrounding whitespace aside) and the
/// domain is known to accept no mail (`crate::email_domain`). An unchanged
/// address passes whatever its domain's rating is now; so does a domain with
/// no recent answer (it is looked up in the background).
pub fn no_mail_domain_of_change(current: Option<&str>, next: &str) -> Option<String> {
    let next = next.trim();
    if current.is_some_and(|current| current.trim().eq_ignore_ascii_case(next)) {
        return None;
    }
    let domain = crate::email_domain::domain_of(next)?;
    crate::email_domain::known_no_mail(&domain).then_some(domain)
}

/// The code of the refusal of a new or changed address whose domain accepts
/// no mail: the cabinet and the wizard show "the domain … accepts no mail" at
/// the field (`field` names it) instead of "invalid address".
pub const EMAIL_DOMAIN_NO_MAIL: &str = "email_domain_no_mail";

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
    use super::{
        is_valid_email, no_mail_domain_of_change, normalize_email, normalize_stored_email,
    };

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
        assert_eq!(
            normalize_stored_email("  Max.Muster@Example.DE "),
            Some("max.muster@example.de".to_string())
        );
        assert_eq!(normalize_stored_email("max@example"), None);
    }

    #[test]
    fn an_unchanged_address_is_never_judged_by_its_domain() {
        // The same address again, however it is written: nothing to judge.
        assert_eq!(
            no_mail_domain_of_change(Some("max@example.de"), " Max@Example.DE "),
            None
        );
        // A set or changed address: judged, and the check is off here.
        assert_eq!(no_mail_domain_of_change(None, "max@example.de"), None);
        assert_eq!(
            no_mail_domain_of_change(Some("old@example.de"), "max@example.de"),
            None
        );
        assert_eq!(no_mail_domain_of_change(None, "max"), None);
    }
}
