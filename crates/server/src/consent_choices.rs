//! The patient's own choice of the options of the consent form
//! «Einverständniserklärung zur Datenübermittlung» (`privacy_consents`,
//! Anlage 1), 2026-10-12.
//!
//! Since 2026-10-11 the form prints its boxes empty («[ ]», owner decision,
//! Art. 4 Nr. 11 / Art. 7 DSGVO: an active consent, never a pre-ticked one);
//! on paper the person ticks them by hand. With an electronic signature
//! (Skribble QES/AES) nobody can tick a box, so the choice would be lost.
//! The rule now:
//!
//! * The person chooses the options themselves in the lead cabinet
//!   (`POST /me/lead-requests/{lead_id}/consent-choices`, the patient role
//!   only — staff can neither set nor change a choice). Every save is a new
//!   row of `consent_form_choices` (history; the newest counts).
//! * A generated form prints «[x]» only for what the person chose and «[ ]»
//!   for the rest, with the date of the choice, and keeps the choice in its
//!   `generated_bindings` ([`BINDING_KEY`]).
//! * A form without an own choice — or with a choice the person has changed
//!   since — is not offered for an electronic signature
//!   (`document_signatures`: `consent_choice_missing` /
//!   `consent_choice_changed`); the paper signature stays possible, the person
//!   ticks the boxes on the printed copy.
//!
//! See `docs/architecture/document-signatures-germany_ua.md`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

/// The consent form whose options the person chooses.
pub const TEMPLATE: &str = "privacy_consents";
/// Key of the choice inside `documents.generated_bindings`.
pub const BINDING_KEY: &str = "_own_consent_choice";
/// Version of the option texts shown in the cabinet.
pub const TEXT_VERSION: &str = "2026-10-12";
/// Refusal of an electronic signature: no own choice in the document.
pub const MISSING: &str = "consent_choice_missing";
/// Refusal of an electronic signature: the person chose differently since the
/// document was generated.
pub const CHANGED: &str = "consent_choice_changed";

/// The options of the form, in the order it prints them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ConsentChoices {
    /// GMED and its staff collect, process, store and pass on the data.
    pub agency_processing: bool,
    /// The treating doctors may send the records to GMED.
    pub doctors_to_agency: bool,
    /// Storage and processing in GMED's data system.
    pub data_system: bool,
    /// Transfer to the persons or institutions named in the form.
    pub named_recipients: bool,
    pub channel_email: bool,
    pub channel_threema: bool,
    pub channel_whatsapp: bool,
    pub channel_telegram: bool,
}

impl ConsentChoices {
    /// The box "über folgende Kommunikationsmedien": ticked when the person
    /// chose at least one channel.
    pub fn any_channel(&self) -> bool {
        self.channel_email || self.channel_threema || self.channel_whatsapp || self.channel_telegram
    }
}

/// A saved choice as a generated form records it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OwnConsentChoice {
    pub id: Uuid,
    pub choices: ConsentChoices,
    pub chosen_at: DateTime<Utc>,
    /// Where the person chose: `lead_portal`.
    pub source: String,
}

impl OwnConsentChoice {
    /// The value kept under [`BINDING_KEY`].
    pub fn binding(&self) -> Value {
        json!(self)
    }

    /// The choice a generated document recorded, if any.
    pub fn from_bindings(bindings: Option<&Value>) -> Option<Self> {
        bindings
            .and_then(|bindings| bindings.get(BINDING_KEY))
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
    }

    /// The line under the boxes: the date (and time, Europe/Berlin) of the
    /// person's own choice.
    pub fn printed_note(&self) -> String {
        let local = crate::app_time::local(self.chosen_at);
        format!(
            "Die Auswahl hat die unterzeichnende Person am {} um {} Uhr selbst im GMED-Kundenkabinett getroffen; angekreuzt ist nur, was sie gewählt hat.",
            local.format("%d.%m.%Y"),
            local.format("%H:%M")
        )
    }
}

/// Whether a document needs the person's own choice for an electronic
/// signature: the generated consent form.
pub fn needs_own_choice(template: Option<&str>) -> bool {
    template == Some(TEMPLATE)
}

/// Why the document cannot be signed electronically as it is, read from the
/// document alone: a consent form generated without the person's own choice.
pub fn electronic_signing_refusal(
    template: Option<&str>,
    bindings: Option<&Value>,
) -> Option<&'static str> {
    (needs_own_choice(template) && OwnConsentChoice::from_bindings(bindings).is_none())
        .then_some(MISSING)
}

const CURRENT_SQL: &str = r#"
    SELECT id, choices, chosen_at, source
    FROM consent_form_choices
    WHERE template_id = 'privacy_consents'
      AND (lead_id = $1
           OR patient_id = $2
           OR lead_id IN (SELECT l.id FROM leads l
                          WHERE l.converted_patient_id = $2 OR l.prospect_patient_id = $2))
    ORDER BY seq DESC
    LIMIT 1"#;

/// The newest own choice of a lead or patient: the lead's, the patient's, or
/// that of a lead the patient came from (a choice made in the cabinet stays
/// with the patient after the conversion).
pub async fn current_for<'e, E>(
    executor: E,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
) -> Result<Option<OwnConsentChoice>, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    if lead_id.is_none() && patient_id.is_none() {
        return Ok(None);
    }
    let row: Option<(Uuid, Value, DateTime<Utc>, String)> = sqlx::query_as(CURRENT_SQL)
        .bind(lead_id)
        .bind(patient_id)
        .fetch_optional(executor)
        .await?;
    Ok(row.and_then(|(id, choices, chosen_at, source)| {
        Some(OwnConsentChoice {
            id,
            choices: serde_json::from_value(choices).ok()?,
            chosen_at,
            source,
        })
    }))
}

/// Why a consent form with an own choice cannot be signed electronically
/// any more: the person chose differently after it was generated
/// ([`CHANGED`]). `None` for other documents and an unchanged choice.
pub async fn changed_since_generation(
    db: &gmed_db::DbPool,
    template: Option<&str>,
    bindings: Option<&Value>,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
) -> Result<Option<&'static str>, sqlx::Error> {
    if !needs_own_choice(template) {
        return Ok(None);
    }
    let Some(recorded) = OwnConsentChoice::from_bindings(bindings) else {
        return Ok(None);
    };
    let current = current_for(db, lead_id, patient_id).await?;
    Ok((current.map(|choice| choice.id) != Some(recorded.id)).then_some(CHANGED))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn choice() -> OwnConsentChoice {
        OwnConsentChoice {
            id: Uuid::nil(),
            choices: ConsentChoices {
                agency_processing: true,
                data_system: true,
                channel_whatsapp: true,
                ..ConsentChoices::default()
            },
            chosen_at: Utc.with_ymd_and_hms(2026, 10, 12, 8, 5, 0).unwrap(),
            source: "lead_portal".into(),
        }
    }

    #[test]
    fn only_the_consent_form_needs_the_persons_own_choice() {
        assert!(needs_own_choice(Some("privacy_consents")));
        for other in [
            None,
            Some("confidentiality_release"),
            Some("consent_data_release_child"),
            Some("framework_contract"),
        ] {
            assert!(!needs_own_choice(other));
            assert_eq!(electronic_signing_refusal(other, None), None);
        }
        assert_eq!(
            electronic_signing_refusal(Some(TEMPLATE), None),
            Some(MISSING)
        );
        let staff_bindings = json!({ "consent_email": true, "consent_whatsapp": true });
        assert_eq!(
            electronic_signing_refusal(Some(TEMPLATE), Some(&staff_bindings)),
            Some(MISSING),
            "staff bindings never count as the person's choice"
        );
        let bindings = json!({ BINDING_KEY: choice().binding() });
        assert_eq!(
            electronic_signing_refusal(Some(TEMPLATE), Some(&bindings)),
            None
        );
    }

    #[test]
    fn the_recorded_choice_round_trips_and_prints_its_date_in_berlin_time() {
        let recorded = choice();
        let bindings = json!({ "_signature_anchors": [], BINDING_KEY: recorded.binding() });
        assert_eq!(
            OwnConsentChoice::from_bindings(Some(&bindings)),
            Some(recorded.clone())
        );
        assert!(recorded.choices.any_channel());
        assert!(!ConsentChoices::default().any_channel());
        let note = recorded.printed_note();
        assert!(note.contains("12.10.2026"), "{note}");
        assert!(note.contains("10:05"), "{note}");
        // An unknown option is no valid choice.
        let tampered = json!({ BINDING_KEY: {
            "id": Uuid::nil(), "chosen_at": "2026-10-12T08:05:00Z", "source": "lead_portal",
            "choices": { "agency_processing": true, "staff_ticked": true }
        }});
        assert_eq!(OwnConsentChoice::from_bindings(Some(&tampered)), None);
    }
}
