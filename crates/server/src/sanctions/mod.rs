//! In-house screening against the EU consolidated financial sanctions list
//! and the blocked-country policy (owner decisions 2026-10-03).
//!
//! * [`fsf`] parses the official list (Financial Sanctions Files, XML 1.1).
//! * [`download`] fetches it once a day; [`store`] keeps the versions, the
//!   last good one stays active when a download fails, and the CEO can upload
//!   the file by hand.
//! * [`normalize`] and [`matching`] are the matching engine.
//! * [`screening`] loads the people we screen (lead patient, guardians of a
//!   minor, third-party payer, patients), stores possible matches as hits and
//!   tells the CEO.
//! * [`policy`] is the blocked-country rule with its per-lead CEO override.
//! * [`gate`] blocks qualification, conversion, the agency countersignature
//!   and order/contract work server-side.
//!
//! Nothing about our patients leaves the server: the list comes to us, the
//! comparison runs here. See `docs/architecture/sanctions-screening_ua.md`.

pub mod download;
pub mod fsf;
pub mod gate;
pub mod matching;
pub mod normalize;
pub mod policy;
pub mod screening;
pub mod store;

/// Notification kind for a new possible match (CEO only).
pub const POSSIBLE_MATCH_NOTIFICATION_KIND: &str = "sanctions_possible_match";
/// `user_notifications.entity_type` of a hit.
pub const HIT_ENTITY_TYPE: &str = "sanctions_hit";
/// A reason must say something.
pub const MIN_REASON_CHARS: usize = 10;
pub const MAX_REASON_CHARS: usize = 2_000;

/// Trims a CEO's reason and checks its length.
pub fn normalized_reason(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let length = trimmed.chars().count();
    if (MIN_REASON_CHARS..=MAX_REASON_CHARS).contains(&length) {
        Some(trimmed.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasons_need_ten_to_two_thousand_characters() {
        assert_eq!(normalized_reason("  too short "), None);
        assert_eq!(
            normalized_reason("  Different birth date and city  ").as_deref(),
            Some("Different birth date and city")
        );
        assert_eq!(normalized_reason(&"x".repeat(2_001)), None);
    }
}
