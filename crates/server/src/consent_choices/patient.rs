//! What of a patient's consent choices applies (owner request 2026-11-16).
//!
//! After the conversion an existing patient may change the options of the
//! Einverständniserklärung and the trusted persons it names: staff in the
//! patient card ([`SOURCE_STAFF`], with how the client told them) or the
//! patient in the portal ([`SOURCE_PORTAL`]). Every change is a new row of
//! `consent_form_choices`; the newest row is what the next consent form
//! prints and the person signs ([`super::current_for`]).
//!
//! What applies is derived from the history ([`effective_consent`]):
//!
//! * a removed person, a narrower scope or an unticked option is a
//!   (partial) withdrawal and applies at once;
//! * an added person, a wider scope or a newly ticked option applies only
//!   once a consent form that records that choice is signed; until then the
//!   state signed before applies ([`pending_additions`]).
//!
//! The rows of the lead the patient came from count as applying, as they
//! did before (the lead's rules). Trusted persons are never
//! sanctions-screened (owner decision 2026-10-12).

use std::collections::BTreeSet;

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use super::{CHILD_TEMPLATES, ConsentChoices, ConsentRecipient, DisclosureDecision, TEMPLATE};

/// Source of a change staff record in the patient card.
pub const SOURCE_STAFF: &str = "patient_staff";
/// Source of a change the patient (or a parent with access) makes in the portal.
pub const SOURCE_PORTAL: &str = "patient_portal";

/// The scopes `all` stands for.
const DETAILED_SCOPES: [&str; 3] = ["medical", "organisational", "financial"];

/// One saved choice, oldest first, as the derivation reads it.
#[derive(Debug, Clone)]
pub struct ChoiceStep {
    pub id: Uuid,
    pub choices: ConsentChoices,
    pub recipients: Vec<ConsentRecipient>,
    /// A change after the conversion ([`SOURCE_STAFF`] / [`SOURCE_PORTAL`]).
    pub patient_change: bool,
    /// A signed consent form records this choice.
    pub signed: bool,
}

/// The options and persons that apply now.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct EffectiveConsent {
    pub choices: ConsentChoices,
    pub recipients: Vec<ConsentRecipient>,
}

/// Who a trusted person is, independent of how to reach them: the name
/// (case and spacing ignored) and the date of birth.
fn person_key(person: &ConsentRecipient) -> (String, Option<NaiveDate>) {
    (
        person
            .name
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase(),
        person.birth_date,
    )
}

/// The detailed scopes a person may be told; a person without codes (named
/// before 2026-10-19, a free text) counts as told everything, as the lead's
/// rules printed it.
fn scope_set(person: &ConsentRecipient) -> BTreeSet<&'static str> {
    if person.scope_codes.is_empty() || person.scope_codes.iter().any(|code| code == "all") {
        return DETAILED_SCOPES.into_iter().collect();
    }
    DETAILED_SCOPES
        .into_iter()
        .filter(|scope| person.scope_codes.iter().any(|code| code == scope))
        .collect()
}

fn scope_codes_of(set: &BTreeSet<&'static str>) -> Vec<String> {
    if set.len() == DETAILED_SCOPES.len() {
        return vec!["all".to_string()];
    }
    DETAILED_SCOPES
        .into_iter()
        .filter(|scope| set.contains(scope))
        .map(str::to_string)
        .collect()
}

fn ticked(choices: &ConsentChoices) -> [(&'static str, bool); 8] {
    [
        ("agency_processing", choices.agency_processing),
        ("doctors_to_agency", choices.doctors_to_agency),
        ("data_system", choices.data_system),
        ("named_recipients", choices.named_recipients),
        ("channel_email", choices.channel_email),
        ("channel_threema", choices.channel_threema),
        ("channel_whatsapp", choices.channel_whatsapp),
        ("channel_telegram", choices.channel_telegram),
    ]
}

fn both(left: &ConsentChoices, right: &ConsentChoices) -> ConsentChoices {
    ConsentChoices {
        agency_processing: left.agency_processing && right.agency_processing,
        doctors_to_agency: left.doctors_to_agency && right.doctors_to_agency,
        data_system: left.data_system && right.data_system,
        named_recipients: left.named_recipients && right.named_recipients,
        channel_email: left.channel_email && right.channel_email,
        channel_threema: left.channel_threema && right.channel_threema,
        channel_whatsapp: left.channel_whatsapp && right.channel_whatsapp,
        channel_telegram: left.channel_telegram && right.channel_telegram,
    }
}

fn named(step: &ChoiceStep) -> &[ConsentRecipient] {
    if step.choices.named_recipients {
        &step.recipients
    } else {
        &[]
    }
}

/// What applies after `steps` (oldest first): the newest step that applies
/// in full — a lead's choice, or one a signed form records — narrowed by
/// every later change. A person stays while every later change still names
/// them, with the scopes all of them allow and the contact data of the
/// newest; a person a later change adds is not there.
pub fn effective_consent(steps: &[ChoiceStep]) -> EffectiveConsent {
    let base = steps
        .iter()
        .rposition(|step| !step.patient_change || step.signed);
    let (mut effective, later) = match base {
        Some(index) => (
            EffectiveConsent {
                choices: steps[index].choices,
                recipients: named(&steps[index]).to_vec(),
            },
            &steps[index + 1..],
        ),
        None => (EffectiveConsent::default(), steps),
    };
    for step in later {
        effective.choices = both(&effective.choices, &step.choices);
        let now = named(step);
        effective.recipients = effective
            .recipients
            .iter()
            .filter_map(|before| {
                let newer = now
                    .iter()
                    .find(|person| person_key(person) == person_key(before))?;
                let scopes: BTreeSet<_> = scope_set(before)
                    .intersection(&scope_set(newer))
                    .copied()
                    .collect();
                if scopes.is_empty() {
                    return None;
                }
                let mut person = newer.clone();
                if scope_set(newer) != scopes {
                    person.scope_codes = scope_codes_of(&scopes);
                    person.scope = None;
                }
                Some(person)
            })
            .collect();
    }
    if !effective.choices.named_recipients {
        effective.recipients.clear();
    }
    if effective.recipients.is_empty() {
        effective.choices.named_recipients = false;
    }
    effective
}

/// What the newest choice adds to what applies, waiting for a signature.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct PendingAdditions {
    /// Options ticked in the newest choice that do not apply yet.
    pub options: Vec<&'static str>,
    /// For each person of the newest choice: whether they (or a scope of
    /// theirs) wait for the signature.
    pub recipients: Vec<bool>,
}

impl PendingAdditions {
    pub fn any(&self) -> bool {
        !self.options.is_empty() || self.recipients.iter().any(|pending| *pending)
    }
}

/// The additions of `requested` (the newest choice) over `effective`.
pub fn pending_additions(
    requested_choices: &ConsentChoices,
    requested_recipients: &[ConsentRecipient],
    effective: &EffectiveConsent,
) -> PendingAdditions {
    let options = ticked(requested_choices)
        .into_iter()
        .zip(ticked(&effective.choices))
        .filter(|((_, wanted), (_, applies))| *wanted && !*applies)
        .map(|((key, _), _)| key)
        .collect();
    let recipients = requested_recipients
        .iter()
        .map(|person| {
            requested_choices.named_recipients
                && effective
                    .recipients
                    .iter()
                    .find(|applies| person_key(applies) == person_key(person))
                    .is_none_or(|applies| !scope_set(person).is_subset(&scope_set(applies)))
        })
        .collect();
    PendingAdditions {
        options,
        recipients,
    }
}

/// Whether `after` only withdraws from `before`: no option is ticked that
/// was not, nobody is named who was not, and no scope is wider.
pub fn only_withdraws(
    after: &ConsentChoices,
    after_recipients: &[ConsentRecipient],
    before: &ConsentChoices,
    before_recipients: &[ConsentRecipient],
) -> bool {
    if !after.only_withdraws(before) {
        return false;
    }
    let before_named: &[ConsentRecipient] = if before.named_recipients {
        before_recipients
    } else {
        &[]
    };
    let after_named: &[ConsentRecipient] = if after.named_recipients {
        after_recipients
    } else {
        &[]
    };
    after_named.iter().all(|person| {
        before_named
            .iter()
            .find(|earlier| person_key(earlier) == person_key(person))
            .is_some_and(|earlier| scope_set(person).is_subset(&scope_set(earlier)))
    })
}

/// How many persons of `before` are no longer named (with their key) in
/// `after`, and how many of `after` are new.
pub fn person_changes(before: &[ConsentRecipient], after: &[ConsentRecipient]) -> (usize, usize) {
    let removed = before
        .iter()
        .filter(|person| {
            !after
                .iter()
                .any(|now| person_key(now) == person_key(person))
        })
        .count();
    let added = after
        .iter()
        .filter(|person| {
            !before
                .iter()
                .any(|then| person_key(then) == person_key(person))
        })
        .count();
    (removed, added)
}

/// One row of the history as the screens show it.
#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub id: Uuid,
    pub chosen_at: DateTime<Utc>,
    pub source: String,
    pub access_kind: String,
    pub recorded_how: Option<String>,
    pub recorded_note: Option<String>,
    pub chosen_by_name: Option<String>,
    pub choices: ConsentChoices,
    pub recipients_count: usize,
    pub signed: bool,
}

/// A patient's consent history with the derived state.
#[derive(Debug, Clone)]
pub struct PatientConsentState {
    /// The newest choice: what the next consent form prints.
    pub requested: Option<RequestedChoice>,
    pub effective: EffectiveConsent,
    pub pending: PendingAdditions,
    /// Newest first.
    pub history: Vec<HistoryEntry>,
}

#[derive(Debug, Clone)]
pub struct RequestedChoice {
    pub id: Uuid,
    pub choices: ConsentChoices,
    pub recipients: Vec<ConsentRecipient>,
    pub disclosure: Option<DisclosureDecision>,
}

/// The rows of a patient's choices, the same selection as
/// [`super::current_for`] (a minor's own choice does not count), oldest
/// first, each with whether a signed consent form records it.
const STEPS_SQL: &str = r#"
    SELECT c.id, c.choices, c.recipients, c.disclosure, c.source, c.access_kind,
           c.recorded_how, c.recorded_note, c.chosen_at, u.name AS chosen_by_name,
           EXISTS (
               SELECT 1 FROM documents d
               WHERE d.signed_at IS NOT NULL
                 AND d.file_deleted_at IS NULL
                 AND d.generated_template_id = ANY($2)
                 AND d.generated_bindings -> '_own_consent_choice' ->> 'id' = c.id::text
           ) AS signed
    FROM consent_form_choices c
    LEFT JOIN leads subject ON subject.id = c.lead_id
    LEFT JOIN users u ON u.id = c.chosen_by
    WHERE c.template_id = 'privacy_consents'
      AND (c.patient_id = $1
           OR c.lead_id IN (SELECT l.id FROM leads l
                            WHERE l.converted_patient_id = $1 OR l.prospect_patient_id = $1))
      AND NOT (
          c.access_kind = 'self'
          AND subject.date_of_birth IS NOT NULL
          AND subject.date_of_birth
              > ((c.chosen_at AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years')
      )
    ORDER BY c.seq ASC"#;

/// The consent forms whose signature confirms a choice.
pub fn consent_form_templates() -> Vec<String> {
    std::iter::once(TEMPLATE)
        .chain(CHILD_TEMPLATES)
        .map(str::to_string)
        .collect()
}

/// Loads the history of a patient's choices and derives what applies.
pub async fn load_state<'e, E>(
    executor: E,
    patient_id: Uuid,
) -> Result<PatientConsentState, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    use sqlx::Row;
    let rows = sqlx::query(STEPS_SQL)
        .bind(patient_id)
        .bind(consent_form_templates())
        .fetch_all(executor)
        .await?;
    let mut steps = Vec::with_capacity(rows.len());
    let mut history = Vec::with_capacity(rows.len());
    let mut requested = None;
    for row in rows {
        let Ok(choices) = serde_json::from_value::<ConsentChoices>(row.get::<Value, _>("choices"))
        else {
            continue;
        };
        let recipients: Vec<ConsentRecipient> =
            serde_json::from_value(row.get::<Value, _>("recipients")).unwrap_or_default();
        let source: String = row.get("source");
        let id: Uuid = row.get("id");
        let signed: bool = row.get("signed");
        let patient_change = source == SOURCE_STAFF || source == SOURCE_PORTAL;
        history.push(HistoryEntry {
            id,
            chosen_at: row.get("chosen_at"),
            source: source.clone(),
            access_kind: row.get("access_kind"),
            recorded_how: row.get("recorded_how"),
            recorded_note: row.get("recorded_note"),
            chosen_by_name: row.get("chosen_by_name"),
            choices,
            recipients_count: if choices.named_recipients {
                recipients.len()
            } else {
                0
            },
            signed,
        });
        requested = Some(RequestedChoice {
            id,
            choices,
            recipients: recipients.clone(),
            disclosure: row
                .get::<Option<Value>, _>("disclosure")
                .and_then(|value| serde_json::from_value(value).ok()),
        });
        steps.push(ChoiceStep {
            id,
            choices,
            recipients,
            patient_change,
            signed,
        });
    }
    let effective = effective_consent(&steps);
    let pending = requested
        .as_ref()
        .map(|requested| pending_additions(&requested.choices, &requested.recipients, &effective))
        .unwrap_or_default();
    history.reverse();
    Ok(PatientConsentState {
        requested,
        effective,
        pending,
        history,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core() -> ConsentChoices {
        ConsentChoices {
            agency_processing: true,
            doctors_to_agency: true,
            data_system: true,
            ..ConsentChoices::default()
        }
    }

    fn person(name: &str, scopes: &[&str]) -> ConsentRecipient {
        ConsentRecipient {
            name: name.into(),
            relation: "relative".into(),
            phone: Some("+49 30 1234567".into()),
            birth_date: NaiveDate::from_ymd_opt(1970, 1, 2),
            scope_codes: scopes.iter().map(|scope| scope.to_string()).collect(),
            ..ConsentRecipient::default()
        }
    }

    fn step(
        persons: Vec<ConsentRecipient>,
        channel_email: bool,
        patient_change: bool,
        signed: bool,
    ) -> ChoiceStep {
        ChoiceStep {
            id: Uuid::new_v4(),
            choices: ConsentChoices {
                named_recipients: !persons.is_empty(),
                channel_email,
                ..core()
            },
            recipients: persons,
            patient_change,
            signed,
        }
    }

    #[test]
    fn a_removed_person_no_longer_applies_at_once() {
        let lead = step(
            vec![
                person("Eva Muster", &["all"]),
                person("Otto Muster", &["all"]),
            ],
            true,
            false,
            false,
        );
        let change = step(vec![person("Eva Muster", &["all"])], true, true, false);
        let effective = effective_consent(&[lead, change.clone()]);
        assert_eq!(effective.recipients.len(), 1);
        assert_eq!(effective.recipients[0].name, "Eva Muster");
        let pending = pending_additions(&change.choices, &change.recipients, &effective);
        assert!(!pending.any());
    }

    #[test]
    fn an_added_person_waits_for_the_signature_of_that_choice() {
        let lead = step(vec![person("Eva Muster", &["all"])], false, false, false);
        let mut change = step(
            vec![
                person("Eva Muster", &["all"]),
                person("Karl Neu", &["medical"]),
            ],
            true,
            true,
            false,
        );
        let effective = effective_consent(&[lead.clone(), change.clone()]);
        assert_eq!(effective.recipients.len(), 1);
        assert!(!effective.choices.channel_email);
        let pending = pending_additions(&change.choices, &change.recipients, &effective);
        assert_eq!(pending.options, vec!["channel_email"]);
        assert_eq!(pending.recipients, vec![false, true]);
        // Signed: the addition applies.
        change.signed = true;
        let effective = effective_consent(&[lead, change.clone()]);
        assert_eq!(effective.recipients.len(), 2);
        assert!(effective.choices.channel_email);
        assert!(!pending_additions(&change.choices, &change.recipients, &effective).any());
    }

    #[test]
    fn a_narrower_scope_applies_at_once_and_a_wider_one_waits() {
        let lead = step(
            vec![person("Eva Muster", &["medical", "financial"])],
            false,
            false,
            false,
        );
        let narrower = step(vec![person("Eva Muster", &["medical"])], false, true, false);
        let effective = effective_consent(&[lead.clone(), narrower]);
        assert_eq!(effective.recipients[0].scope_codes, vec!["medical"]);
        let wider = step(vec![person("eva  muster", &["all"])], false, true, false);
        let effective = effective_consent(&[lead, wider.clone()]);
        assert_eq!(
            effective.recipients[0].scope_codes,
            vec!["medical", "financial"]
        );
        assert_eq!(
            pending_additions(&wider.choices, &wider.recipients, &effective).recipients,
            vec![true]
        );
    }

    #[test]
    fn a_removal_after_an_unsigned_addition_stays_a_removal() {
        let lead = step(vec![person("Eva Muster", &["all"])], false, false, false);
        let added = step(
            vec![person("Eva Muster", &["all"]), person("Karl Neu", &["all"])],
            false,
            true,
            false,
        );
        let removed = step(vec![person("Karl Neu", &["all"])], false, true, false);
        let effective = effective_consent(&[lead, added, removed.clone()]);
        assert!(effective.recipients.is_empty());
        assert!(!effective.choices.named_recipients);
        assert_eq!(
            pending_additions(&removed.choices, &removed.recipients, &effective),
            PendingAdditions {
                options: vec!["named_recipients"],
                recipients: vec![true]
            }
        );
    }

    #[test]
    fn an_older_version_signed_later_still_yields_to_a_later_removal() {
        let lead = step(vec![], false, false, false);
        let mut added = step(vec![person("Karl Neu", &["all"])], true, true, false);
        let narrowed = step(vec![person("Karl Neu", &["all"])], false, true, false);
        added.signed = true;
        let effective = effective_consent(&[lead, added, narrowed]);
        assert_eq!(effective.recipients.len(), 1);
        assert!(!effective.choices.channel_email);
    }

    #[test]
    fn only_withdrawing_compares_persons_and_scopes() {
        let before = vec![
            person("Eva Muster", &["all"]),
            person("Otto Muster", &["medical"]),
        ];
        let choices = ConsentChoices {
            named_recipients: true,
            ..core()
        };
        assert!(only_withdraws(&choices, &before[..1], &choices, &before));
        assert!(!only_withdraws(
            &choices,
            &[person("Otto Muster", &["all"])],
            &choices,
            &before
        ));
        assert!(!only_withdraws(
            &choices,
            &[person("Karl Neu", &["medical"])],
            &choices,
            &before
        ));
        assert_eq!(person_changes(&before, &before[1..]), (1, 0));
    }
}
