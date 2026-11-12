//! The own fields of a service kind (owner decision 2026-11-12, concierge QA
//! D-6): a restaurant booking asks for persons, dietary notes and a preferred
//! time; a transfer for the flight or train number, the pickup and drop-off
//! place and a luggage or wheelchair note; tickets for an event for its name,
//! the number of seats and the seat category. Every other service keeps the
//! generic form and stores no details.
//!
//! The kind is not a second picker: it follows the service kind for rides
//! (transfer, chauffeur) and otherwise the partner category the service
//! already carries (gastronomy → restaurant, culture and sport → tickets).
//! The fields live in `concierge_services.details` (JSONB object); this module
//! is their schema: it validates types and lengths of what a client sends and
//! returns only the fields of the service's current kind.

use serde_json::{Map, Value};

/// Server code of a refused `details` object.
pub(crate) const DETAILS_INVALID_CODE: &str = "concierge_service_details_invalid";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DetailsKind {
    Restaurant,
    Transfer,
    Tickets,
}

#[derive(Clone, Copy, Debug)]
enum FieldType {
    /// Free text, trimmed, at most this many characters.
    Text(usize),
    /// A whole number from 1 to this maximum.
    Count(i64),
    /// A time of day "HH:MM" (Europe/Berlin, like every time of the app).
    TimeOfDay,
}

#[derive(Clone, Copy, Debug)]
struct FieldSpec {
    key: &'static str,
    kind: FieldType,
}

const RESTAURANT_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        key: "persons",
        kind: FieldType::Count(100),
    },
    FieldSpec {
        key: "dietary_notes",
        kind: FieldType::Text(500),
    },
    FieldSpec {
        key: "preferred_time",
        kind: FieldType::TimeOfDay,
    },
];

const TRANSFER_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        key: "flight_number",
        kind: FieldType::Text(30),
    },
    FieldSpec {
        key: "pickup_place",
        kind: FieldType::Text(300),
    },
    FieldSpec {
        key: "dropoff_place",
        kind: FieldType::Text(300),
    },
    FieldSpec {
        key: "luggage_note",
        kind: FieldType::Text(500),
    },
];

const TICKETS_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        key: "event_name",
        kind: FieldType::Text(300),
    },
    FieldSpec {
        key: "seats",
        kind: FieldType::Count(100),
    },
    FieldSpec {
        key: "seat_category",
        kind: FieldType::Text(100),
    },
];

impl DetailsKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Restaurant => "restaurant",
            Self::Transfer => "transfer",
            Self::Tickets => "tickets",
        }
    }

    fn fields(self) -> &'static [FieldSpec] {
        match self {
            Self::Restaurant => RESTAURANT_FIELDS,
            Self::Transfer => TRANSFER_FIELDS,
            Self::Tickets => TICKETS_FIELDS,
        }
    }
}

/// The kind whose own fields a service has: rides by their service kind,
/// everything else by its partner category; `None` keeps the generic form.
pub(crate) fn details_kind(service_kind: &str, taxonomy_code: Option<&str>) -> Option<DetailsKind> {
    if matches!(service_kind, "transfer" | "chauffeur") {
        return Some(DetailsKind::Transfer);
    }
    match taxonomy_code? {
        "nonmedical_restaurants"
        | "nonmedical_cafe"
        | "nonmedical_bars"
        | "nonmedical_catering"
        | "nonmedical_private_cook" => Some(DetailsKind::Restaurant),
        "nonmedical_culture" | "nonmedical_sport" => Some(DetailsKind::Tickets),
        _ => None,
    }
}

fn is_time_of_day(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| {
        value
            .get(range)
            .filter(|part| part.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|part| part.parse::<u32>().ok())
    };
    matches!((digits(0..2), digits(3..5)), (Some(hour), Some(minute)) if hour < 24 && minute < 60)
}

/// Checks the `details` a client sent against the schema of `kind` and
/// returns the object to store. `null` and empty values clear a field; a
/// field of another kind, a wrong type or a too long text is refused. A
/// service without own fields accepts only an empty object.
pub(crate) fn validate_details(kind: Option<DetailsKind>, value: &Value) -> Result<Value, String> {
    let entries = match value {
        Value::Null => return Ok(Value::Object(Map::new())),
        Value::Object(entries) => entries,
        _ => return Err("details must be an object".to_string()),
    };
    let fields = kind.map(DetailsKind::fields).unwrap_or(&[]);
    let mut stored = Map::new();
    for (key, raw) in entries {
        let blank = match raw {
            Value::Null => true,
            Value::String(text) => text.trim().is_empty(),
            _ => false,
        };
        if blank {
            continue;
        }
        let Some(spec) = fields.iter().find(|spec| spec.key == key.as_str()) else {
            return Err(match kind {
                Some(kind) => format!(
                    "details.{key} is not a field of a {} service",
                    kind.as_str()
                ),
                None => "this service kind has no own details".to_string(),
            });
        };
        let normalized = match spec.kind {
            FieldType::Text(max) => {
                let Value::String(text) = raw else {
                    return Err(format!("details.{key} must be text"));
                };
                let text = text.trim();
                if text.chars().count() > max {
                    return Err(format!("details.{key} must not exceed {max} characters"));
                }
                Value::String(text.to_string())
            }
            FieldType::Count(max) => match raw.as_i64() {
                Some(count) if (1..=max).contains(&count) => Value::from(count),
                _ => {
                    return Err(format!(
                        "details.{key} must be a whole number from 1 to {max}"
                    ));
                }
            },
            FieldType::TimeOfDay => match raw {
                Value::String(text) if is_time_of_day(text.trim()) => {
                    Value::String(text.trim().to_string())
                }
                _ => return Err(format!("details.{key} must be a time HH:MM")),
            },
        };
        stored.insert(key.clone(), normalized);
    }
    Ok(Value::Object(stored))
}

/// The stored details a reader gets: only the fields of the service's current
/// kind (a service moved to another category keeps its old values stored but
/// no longer shows them).
pub(crate) fn visible_details(kind: Option<DetailsKind>, stored: Option<&Value>) -> Value {
    let mut visible = Map::new();
    if let (Some(kind), Some(Value::Object(entries))) = (kind, stored) {
        for spec in kind.fields() {
            if let Some(value) = entries.get(spec.key)
                && !value.is_null()
            {
                visible.insert(spec.key.to_string(), value.clone());
            }
        }
    }
    Value::Object(visible)
}

/// The `details_kind` and `details` of a service row (columns
/// `service_kind`, `taxonomy_node_code`, `details`).
pub(crate) fn details_json(row: &sqlx::postgres::PgRow) -> (Value, Value) {
    use sqlx::Row;
    let service_kind = row.try_get::<String, _>("service_kind").unwrap_or_default();
    let taxonomy_code = row
        .try_get::<Option<String>, _>("taxonomy_node_code")
        .unwrap_or_default();
    let stored = row
        .try_get::<Option<Value>, _>("details")
        .unwrap_or_default();
    let kind = details_kind(&service_kind, taxonomy_code.as_deref());
    (
        kind.map(|kind| Value::String(kind.as_str().to_string()))
            .unwrap_or(Value::Null),
        visible_details(kind, stored.as_ref()),
    )
}

#[cfg(test)]
mod tests {
    use super::{DetailsKind, details_kind, validate_details, visible_details};
    use serde_json::json;

    #[test]
    fn the_kind_follows_rides_and_the_partner_category() {
        assert_eq!(details_kind("transfer", None), Some(DetailsKind::Transfer));
        assert_eq!(
            details_kind("chauffeur", Some("nonmedical_restaurants")),
            Some(DetailsKind::Transfer)
        );
        assert_eq!(
            details_kind("hotel", Some("nonmedical_restaurants")),
            Some(DetailsKind::Restaurant)
        );
        assert_eq!(
            details_kind("other", Some("nonmedical_cafe")),
            Some(DetailsKind::Restaurant)
        );
        assert_eq!(
            details_kind("other", Some("nonmedical_culture")),
            Some(DetailsKind::Tickets)
        );
        assert_eq!(
            details_kind("other", Some("nonmedical_strip_clubs_bordelle")),
            None
        );
        assert_eq!(details_kind("hotel", Some("nonmedical_hotels")), None);
        assert_eq!(details_kind("flight", None), None);
    }

    #[test]
    fn valid_details_are_trimmed_and_blank_fields_dropped() {
        let stored = validate_details(
            Some(DetailsKind::Restaurant),
            &json!({
                "persons": 4,
                "dietary_notes": "  vegetarisch ",
                "preferred_time": "19:30",
            }),
        )
        .unwrap();
        assert_eq!(
            stored,
            json!({ "persons": 4, "dietary_notes": "vegetarisch", "preferred_time": "19:30" })
        );
        let stored = validate_details(
            Some(DetailsKind::Transfer),
            &json!({ "flight_number": "LH 1234", "pickup_place": "", "luggage_note": null }),
        )
        .unwrap();
        assert_eq!(stored, json!({ "flight_number": "LH 1234" }));
        assert_eq!(validate_details(None, &json!({})).unwrap(), json!({}));
        assert_eq!(validate_details(None, &json!(null)).unwrap(), json!({}));
    }

    #[test]
    fn wrong_types_lengths_and_foreign_fields_are_refused() {
        let restaurant = Some(DetailsKind::Restaurant);
        assert!(validate_details(restaurant, &json!({ "persons": 0 })).is_err());
        assert!(validate_details(restaurant, &json!({ "persons": 101 })).is_err());
        assert!(validate_details(restaurant, &json!({ "persons": "4" })).is_err());
        assert!(validate_details(restaurant, &json!({ "persons": 2.5 })).is_err());
        assert!(validate_details(restaurant, &json!({ "preferred_time": "25:00" })).is_err());
        assert!(validate_details(restaurant, &json!({ "preferred_time": "7:30" })).is_err());
        assert!(validate_details(restaurant, &json!({ "dietary_notes": 5 })).is_err());
        assert!(
            validate_details(restaurant, &json!({ "dietary_notes": "x".repeat(501) })).is_err()
        );
        assert!(validate_details(restaurant, &json!({ "seats": 2 })).is_err());
        assert!(validate_details(restaurant, &json!(["persons"])).is_err());
        assert!(validate_details(None, &json!({ "persons": 2 })).is_err());
        assert!(
            validate_details(
                Some(DetailsKind::Tickets),
                &json!({ "seats": 2, "event_name": "Oper" })
            )
            .is_ok()
        );
    }

    #[test]
    fn readers_get_only_the_fields_of_the_current_kind() {
        let stored = json!({ "persons": 2, "flight_number": "LH 1", "event_name": null });
        assert_eq!(
            visible_details(Some(DetailsKind::Restaurant), Some(&stored)),
            json!({ "persons": 2 })
        );
        assert_eq!(
            visible_details(Some(DetailsKind::Transfer), Some(&stored)),
            json!({ "flight_number": "LH 1" })
        );
        assert_eq!(
            visible_details(Some(DetailsKind::Tickets), Some(&stored)),
            json!({})
        );
        assert_eq!(visible_details(None, Some(&stored)), json!({}));
        assert_eq!(visible_details(Some(DetailsKind::Tickets), None), json!({}));
    }
}
