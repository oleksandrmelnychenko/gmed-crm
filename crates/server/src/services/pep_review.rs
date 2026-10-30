//! PEP and sanctions answers per person, and the staff review of the PEP
//! status per person (owner decision 2026-10-23).
//!
//! Every person answers the PEP and sanctions questions for themself: the
//! patient in the cabinet (`lead_gwg_declarations`), each parent or
//! representative in block R (`lead_representatives.country_questions`), the
//! payer in the own statement (`lead_payer_statements`). Staff's "PEP status
//! checked" is a review layer on top, never an answer of the person, and is
//! kept per subject in the wizard state
//! (`wizard_state.aml_enhanced_due_diligence`):
//!
//! - `patient`: the existing fields `pepStatusChecked`, `pepContractPartner`
//!   and `pepBeneficialOwner`; the day and the reviewer in
//!   `pepReviews.patient.checkedOn` / `checkedBy`;
//! - `representative:<trusted contact id>` and `payer`:
//!   `pepReviews.<subject> = { checked, isPep, checkedOn, checkedBy }`.
//!
//! `checkedOn` and `checkedBy` are the server's: [`stamp_reviews`] sets them
//! when staff change a review and keeps the stored ones otherwise, whatever
//! the client sent. A GwG sheet shows the person's own answer and, separately,
//! the review of that person; question 5 b) follows the review once staff
//! reviewed the person, the person's answer before (never both ORed).

use chrono::NaiveDate;
use serde_json::{Map, Value, json};
use uuid::Uuid;

/// The patient (contract partner) as subject of a review.
pub const SUBJECT_PATIENT: &str = "patient";
/// The third-party payer (a person or an organisation).
pub const SUBJECT_PAYER: &str = "payer";
const REPRESENTATIVE_PREFIX: &str = "representative:";
const REVIEWS_KEY: &str = "pepReviews";

/// `representative:<id>`: a parent, guardian, representative or legal
/// guardian, by the id of the trusted contact.
pub fn representative_subject(id: Uuid) -> String {
    format!("{REPRESENTATIVE_PREFIX}{id}")
}

/// Whether `key` names a subject a review can be stored for.
pub fn is_subject_key(key: &str) -> bool {
    key == SUBJECT_PATIENT
        || key == SUBJECT_PAYER
        || key
            .strip_prefix(REPRESENTATIVE_PREFIX)
            .is_some_and(|id| Uuid::parse_str(id).is_ok())
}

/// A person's own answers to the PEP and sanctions questions; `None` while
/// the question is unanswered.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PersonAnswers {
    pub pep_self: Option<bool>,
    pub pep_self_details: Option<String>,
    pub pep_related: Option<bool>,
    pub pep_related_details: Option<String>,
    pub sanctions_links: Option<bool>,
    pub sanctions_links_details: Option<String>,
}

impl PersonAnswers {
    /// The answers of block R (`lead_representatives.country_questions`):
    /// the office and the relationship stand for the details.
    pub fn from_country_questions(fields: &Value) -> Self {
        let text = |key: &str| {
            fields[key]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        let office = [text("pep_office"), text("pep_period")]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ");
        let office = Some(office).filter(|office| !office.is_empty());
        let related_details = [text("pep_relationship"), office.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(": ");
        let sanctions_details = [
            text("sanctions_link_name"),
            text("sanctions_link_since_extent"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" – ");
        Self {
            pep_self: fields["pep_self"].as_bool(),
            pep_self_details: office,
            pep_related: fields["pep_related"].as_bool(),
            pep_related_details: Some(related_details).filter(|text| !text.is_empty()),
            sanctions_links: fields["sanctions_links"].as_bool(),
            sanctions_links_details: Some(sanctions_details).filter(|text| !text.is_empty()),
        }
    }

    /// Neither PEP question is answered.
    pub fn pep_unanswered(&self) -> bool {
        self.pep_self.is_none() && self.pep_related.is_none()
    }

    /// The person said "yes" to one of the PEP questions.
    pub fn states_pep(&self) -> bool {
        self.pep_self == Some(true) || self.pep_related == Some(true)
    }

    /// "ja – selbst PeP (Bürgermeister)", "nein", "keine Angabe": the PEP
    /// answers of the person in one line. "nein" only when both questions
    /// are answered with no.
    pub fn pep_line(&self) -> String {
        let detail = |details: &Option<String>| {
            details
                .as_deref()
                .map(str::trim)
                .filter(|details| !details.is_empty())
                .map(|details| format!(" ({details})"))
                .unwrap_or_default()
        };
        let mut yes = Vec::new();
        if self.pep_self == Some(true) {
            yes.push(format!("selbst PeP{}", detail(&self.pep_self_details)));
        }
        if self.pep_related == Some(true) {
            yes.push(format!(
                "Familienmitglied oder nahestehende Person einer PeP{}",
                detail(&self.pep_related_details)
            ));
        }
        if !yes.is_empty() {
            return format!("ja – {}", yes.join("; "));
        }
        match (self.pep_self, self.pep_related) {
            (Some(false), Some(false)) => "nein".to_string(),
            (None, None) => "keine Angabe".to_string(),
            // One question answered with no, the other open.
            _ => "nein (nicht vollständig beantwortet)".to_string(),
        }
    }

    /// "ja – <details>", "nein", "keine Angabe" for the sanctions question.
    pub fn sanctions_line(&self) -> String {
        match self.sanctions_links {
            Some(true) => match self
                .sanctions_links_details
                .as_deref()
                .map(str::trim)
                .filter(|details| !details.is_empty())
            {
                Some(details) => format!("ja – {details}"),
                None => "ja".to_string(),
            },
            Some(false) => "nein".to_string(),
            None => "keine Angabe".to_string(),
        }
    }
}

/// Staff's review of one person's PEP status.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PepReview {
    /// "PEP status checked" is ticked.
    pub checked: bool,
    /// Staff's conclusion: the person is a PEP (or a family member / close
    /// associate of one).
    pub is_pep: bool,
    pub checked_on: Option<NaiveDate>,
    pub checked_by: Option<String>,
}

impl PepReview {
    /// Staff reviewed the person: the box is ticked or staff concluded "PEP".
    pub fn reviewed(&self) -> bool {
        self.checked || self.is_pep
    }

    fn decision(&self) -> (bool, bool) {
        (self.checked, self.is_pep)
    }

    /// "PEP-Status geprüft am 23.10.2026 von Anna Muster – Ergebnis: keine
    /// PEP", or "noch nicht geprüft".
    pub fn line(&self) -> String {
        if !self.reviewed() {
            return "noch nicht geprüft".to_string();
        }
        let mut text = String::from("PEP-Status geprüft");
        if let Some(day) = self.checked_on {
            text.push_str(&format!(" am {}", day.format("%d.%m.%Y")));
        }
        if let Some(name) = self
            .checked_by
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            text.push_str(&format!(" von {name}"));
        }
        text.push_str(if self.is_pep {
            " – Ergebnis: PeP (bzw. Familienmitglied / nahestehende Person)"
        } else {
            " – Ergebnis: keine PeP"
        });
        text
    }
}

/// Question 5 b) of a sheet: staff's conclusion once staff reviewed the
/// person, the person's own answer before. Never both ORed.
pub fn politically_exposed(answers: &PersonAnswers, review: &PepReview) -> bool {
    if review.reviewed() {
        review.is_pep
    } else {
        answers.states_pep()
    }
}

/// Question 5 b) as the boxes print it: `None` while neither staff reviewed
/// the person nor the person answered a PEP question, so neither "Ja" nor
/// "Nein" is ticked (DEV QA 2026-10-30: "[X] Nein" stood beside "keine
/// Angabe"). Otherwise [`politically_exposed`].
pub fn politically_exposed_answer(answers: &PersonAnswers, review: &PepReview) -> Option<bool> {
    (review.reviewed() || !answers.pep_unanswered()).then(|| politically_exposed(answers, review))
}

fn stamps(entry: Option<&Value>) -> (Option<NaiveDate>, Option<String>) {
    let entry = entry.unwrap_or(&Value::Null);
    (
        entry["checkedOn"]
            .as_str()
            .and_then(|day| NaiveDate::parse_from_str(day.trim(), "%Y-%m-%d").ok()),
        entry["checkedBy"]
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string),
    )
}

/// The review of `subject` in `wizard_state.aml_enhanced_due_diligence`
/// (`aml`); an empty review when nothing is stored.
pub fn review_of(aml: &Value, subject: &str) -> PepReview {
    let entry = aml
        .get(REVIEWS_KEY)
        .and_then(|reviews| reviews.get(subject));
    let (checked_on, checked_by) = stamps(entry);
    if subject == SUBJECT_PATIENT {
        return PepReview {
            checked: aml["pepStatusChecked"] == true,
            is_pep: aml["pepContractPartner"] == true || aml["pepBeneficialOwner"] == true,
            checked_on,
            checked_by,
        };
    }
    let entry = entry.unwrap_or(&Value::Null);
    PepReview {
        checked: entry["checked"] == true,
        is_pep: entry["isPep"] == true,
        checked_on,
        checked_by,
    }
}

/// A review staff changed with this save: the subject and the new decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangedReview {
    pub subject: String,
    pub checked: bool,
    pub is_pep: bool,
}

/// Audit action of a changed review of a representative or the payer.
pub const PEP_REVIEW_CHANGED_ACTION: &str = "lead_pep_review_changed";
/// Audit action of a changed PEP conclusion of the patient (owner 2026-10-23);
/// the patient's "PEP status checked" box keeps `lead_pep_status_checked` /
/// `lead_pep_status_unchecked`.
pub const PATIENT_PEP_REVIEW_CHANGED_ACTION: &str = "lead_patient_pep_review_changed";

impl ChangedReview {
    /// The audit action of this change.
    pub fn audit_action(&self) -> &'static str {
        if self.subject == SUBJECT_PATIENT {
            PATIENT_PEP_REVIEW_CHANGED_ACTION
        } else {
            PEP_REVIEW_CHANGED_ACTION
        }
    }
}

/// Sets `checkedOn` / `checkedBy` of every review in `next` (the
/// `aml_enhanced_due_diligence` object about to be stored): today and the
/// reviewer for a review staff changed, the stored stamps for an unchanged
/// one, none for a review that is cleared. Entries of unknown subjects are
/// dropped. Returns the reviews of representatives and the payer that
/// changed, and the patient's review when staff's conclusion (PEP or not)
/// changed; the patient's box alone is audited as before.
pub fn stamp_reviews(
    previous: &Value,
    next: &mut Value,
    today: NaiveDate,
    reviewer: &str,
) -> Vec<ChangedReview> {
    let Some(object) = next.as_object_mut() else {
        return Vec::new();
    };
    let mut reviews: Map<String, Value> = object
        .get(REVIEWS_KEY)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    reviews.retain(|key, value| is_subject_key(key) && value.is_object());
    // A review the server no longer has (the payer changed and the review of
    // the previous payer was cleared) but the client sends back with its old
    // day: an open form echoing what it loaded, not staff deciding now (a
    // changed decision always comes without a day). It is not taken over.
    reviews.retain(|key, value| {
        key == SUBJECT_PATIENT
            || review_of(previous, key).reviewed()
            || value
                .get("checkedOn")
                .and_then(Value::as_str)
                .is_none_or(|day| day.trim().is_empty())
    });
    // A review the client did not send stays as stored: staff clear one by
    // unticking it, never by leaving it out.
    if let Some(stored) = previous.get(REVIEWS_KEY).and_then(Value::as_object) {
        for (key, value) in stored {
            if key != SUBJECT_PATIENT
                && is_subject_key(key)
                && value.is_object()
                && !reviews.contains_key(key)
            {
                reviews.insert(key.clone(), value.clone());
            }
        }
    }
    let mut subjects: Vec<String> = reviews.keys().cloned().collect();
    if !subjects.iter().any(|key| key == SUBJECT_PATIENT) {
        subjects.push(SUBJECT_PATIENT.to_string());
    }
    // The patient's decision lives in the fields of the form itself.
    let next_view = {
        let mut view = Value::Object(object.clone());
        view[REVIEWS_KEY] = Value::Object(reviews.clone());
        view
    };
    let mut changed = Vec::new();
    for subject in subjects {
        let before = review_of(previous, &subject);
        let after = review_of(&next_view, &subject);
        let (checked_on, checked_by) = if !after.reviewed() {
            (None, None)
        } else if before.decision() == after.decision() {
            (before.checked_on, before.checked_by.clone())
        } else {
            (
                Some(today),
                Some(reviewer.trim().to_string()).filter(|name| !name.is_empty()),
            )
        };
        let audited = if subject == SUBJECT_PATIENT {
            before.is_pep != after.is_pep
        } else {
            before.decision() != after.decision()
        };
        if audited {
            changed.push(ChangedReview {
                subject: subject.clone(),
                checked: after.checked,
                is_pep: after.is_pep,
            });
        }
        let stamp = json!({
            "checkedOn": checked_on.map(|day| day.format("%Y-%m-%d").to_string()),
            "checkedBy": checked_by,
        });
        if subject == SUBJECT_PATIENT {
            if checked_on.is_some() || checked_by.is_some() {
                reviews.insert(subject, stamp);
            } else {
                reviews.remove(&subject);
            }
        } else {
            let entry = reviews
                .entry(subject)
                .or_insert_with(|| Value::Object(Map::new()));
            entry["checked"] = json!(after.checked);
            entry["isPep"] = json!(after.is_pep);
            entry["checkedOn"] = stamp["checkedOn"].clone();
            entry["checkedBy"] = stamp["checkedBy"].clone();
        }
    }
    object.insert(REVIEWS_KEY.to_string(), Value::Object(reviews));
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").expect("date")
    }

    #[test]
    fn subject_keys_are_patient_payer_or_a_representative_id() {
        let id = Uuid::new_v4();
        assert!(is_subject_key("patient"));
        assert!(is_subject_key("payer"));
        assert!(is_subject_key(&representative_subject(id)));
        assert!(!is_subject_key("representative:nope"));
        assert!(!is_subject_key("child"));
    }

    #[test]
    fn the_pep_line_is_the_persons_own_answer() {
        assert_eq!(PersonAnswers::default().pep_line(), "keine Angabe");
        let no = PersonAnswers {
            pep_self: Some(false),
            pep_related: Some(false),
            ..PersonAnswers::default()
        };
        assert_eq!(no.pep_line(), "nein");
        let related = PersonAnswers {
            pep_self: Some(false),
            pep_related: Some(true),
            pep_related_details: Some("Bruder, Bürgermeister".to_string()),
            ..PersonAnswers::default()
        };
        assert_eq!(
            related.pep_line(),
            "ja – Familienmitglied oder nahestehende Person einer PeP (Bruder, Bürgermeister)"
        );
        assert_eq!(related.sanctions_line(), "keine Angabe");
    }

    #[test]
    fn block_r_answers_are_read_with_their_details() {
        let answers = PersonAnswers::from_country_questions(&json!({
            "pep_self": true,
            "pep_related": false,
            "pep_office": "Abgeordneter",
            "pep_period": "2019–2023",
            "sanctions_links": false,
        }));
        assert_eq!(answers.pep_self, Some(true));
        assert_eq!(
            answers.pep_self_details.as_deref(),
            Some("Abgeordneter, 2019–2023")
        );
        assert_eq!(answers.sanctions_links, Some(false));
        assert_eq!(
            answers.pep_line(),
            "ja – selbst PeP (Abgeordneter, 2019–2023)"
        );
    }

    #[test]
    fn question_b_follows_the_review_once_staff_reviewed_never_an_or() {
        let says_pep = PersonAnswers {
            pep_self: Some(true),
            pep_related: Some(false),
            ..PersonAnswers::default()
        };
        let says_no = PersonAnswers {
            pep_self: Some(false),
            pep_related: Some(false),
            ..PersonAnswers::default()
        };
        let open = PepReview::default();
        let cleared = PepReview {
            checked: true,
            ..PepReview::default()
        };
        let confirmed = PepReview {
            checked: true,
            is_pep: true,
            ..PepReview::default()
        };
        assert!(politically_exposed(&says_pep, &open));
        assert!(!politically_exposed(&says_no, &open));
        assert!(!politically_exposed(&says_pep, &cleared));
        assert!(politically_exposed(&says_no, &confirmed));
        // No answer and no review: neither box (DEV QA 2026-10-30).
        let unanswered = PersonAnswers::default();
        assert_eq!(politically_exposed_answer(&unanswered, &open), None);
        assert_eq!(politically_exposed_answer(&says_no, &open), Some(false));
        assert_eq!(politically_exposed_answer(&says_pep, &open), Some(true));
        assert_eq!(
            politically_exposed_answer(&unanswered, &cleared),
            Some(false)
        );
        assert_eq!(
            politically_exposed_answer(&unanswered, &confirmed),
            Some(true)
        );
    }

    #[test]
    fn the_patient_review_reads_the_form_fields_and_others_their_entry() {
        let id = Uuid::new_v4();
        let aml = json!({
            "pepStatusChecked": true,
            "pepContractPartner": false,
            "pepReviews": {
                "patient": { "checkedOn": "2026-10-20", "checkedBy": "Anna Muster" },
                representative_subject(id): { "checked": true, "isPep": true }
            }
        });
        let patient = review_of(&aml, SUBJECT_PATIENT);
        assert!(patient.checked && !patient.is_pep);
        assert_eq!(patient.checked_on, Some(day("2026-10-20")));
        assert_eq!(
            patient.line(),
            "PEP-Status geprüft am 20.10.2026 von Anna Muster – Ergebnis: keine PeP"
        );
        let parent = review_of(&aml, &representative_subject(id));
        assert!(parent.checked && parent.is_pep);
        assert_eq!(review_of(&aml, SUBJECT_PAYER), PepReview::default());
        assert_eq!(PepReview::default().line(), "noch nicht geprüft");
    }

    #[test]
    fn stamps_are_the_servers_and_follow_a_changed_decision() {
        let id = Uuid::new_v4();
        let parent = representative_subject(id);
        let previous = json!({
            "pepStatusChecked": true,
            "pepReviews": {
                "patient": { "checkedOn": "2026-10-01", "checkedBy": "Erste Prüferin" },
                parent.clone(): { "checked": true, "isPep": false, "checkedOn": "2026-10-02", "checkedBy": "Erste Prüferin" }
            }
        });
        // The client sends forged stamps, an unchanged patient review, a
        // changed parent review, a new payer review and an unknown key.
        let mut next = json!({
            "pepStatusChecked": true,
            "pepReviews": {
                "patient": { "checkedOn": "1999-01-01", "checkedBy": "Forged" },
                parent.clone(): { "checked": true, "isPep": true, "checkedOn": "1999-01-01" },
                "payer": { "checked": true, "isPep": false },
                "child": { "checked": true }
            }
        });
        let changed = stamp_reviews(&previous, &mut next, day("2026-10-23"), "Zweiter Prüfer");
        let reviews = &next["pepReviews"];
        assert_eq!(reviews["patient"]["checkedOn"], "2026-10-01");
        assert_eq!(reviews["patient"]["checkedBy"], "Erste Prüferin");
        assert_eq!(reviews[parent.as_str()]["checkedOn"], "2026-10-23");
        assert_eq!(reviews[parent.as_str()]["checkedBy"], "Zweiter Prüfer");
        assert_eq!(reviews["payer"]["checkedOn"], "2026-10-23");
        assert!(reviews.get("child").is_none());
        let mut subjects = changed
            .iter()
            .map(|change| change.subject.clone())
            .collect::<Vec<_>>();
        subjects.sort();
        let mut expected = vec![parent.clone(), "payer".to_string()];
        expected.sort();
        assert_eq!(subjects, expected);

        // Clearing a review drops its stamps.
        let previous = next.clone();
        let mut cleared = json!({ "pepStatusChecked": false, "pepReviews": { "payer": { "checked": false, "isPep": false } } });
        stamp_reviews(&previous, &mut cleared, day("2026-10-24"), "Zweiter Prüfer");
        assert!(cleared["pepReviews"].get("patient").is_none());
        assert_eq!(cleared["pepReviews"]["payer"]["checkedOn"], Value::Null);
        // The parent's review the client left out stays as stored.
        assert_eq!(cleared["pepReviews"][parent.as_str()]["isPep"], true);
        assert_eq!(
            cleared["pepReviews"][parent.as_str()]["checkedOn"],
            "2026-10-23"
        );
    }

    #[test]
    fn the_patients_changed_conclusion_is_its_own_audit_event() {
        let previous = json!({ "pepStatusChecked": true });
        // The box alone stays the old event (lead_pep_status_checked).
        let mut ticked = json!({ "pepStatusChecked": true });
        assert!(stamp_reviews(&json!({}), &mut ticked, day("2026-10-23"), "Prüferin").is_empty());
        // Staff conclude "PEP".
        let mut pep = json!({ "pepStatusChecked": true, "pepBeneficialOwner": true });
        let changed = stamp_reviews(&previous, &mut pep, day("2026-10-23"), "Prüferin");
        assert_eq!(
            changed,
            vec![ChangedReview {
                subject: SUBJECT_PATIENT.to_string(),
                checked: true,
                is_pep: true,
            }]
        );
        assert_eq!(changed[0].audit_action(), "lead_patient_pep_review_changed");
        // An unchanged conclusion is not audited again; back to "no PEP" is.
        let stored = pep.clone();
        let mut same = json!({ "pepStatusChecked": true, "pepBeneficialOwner": true });
        assert!(stamp_reviews(&stored, &mut same, day("2026-10-24"), "Prüferin").is_empty());
        let mut back = json!({ "pepStatusChecked": true });
        let changed = stamp_reviews(&stored, &mut back, day("2026-10-24"), "Prüferin");
        assert_eq!(changed.len(), 1);
        assert!(!changed[0].is_pep);
        // A representative's review keeps its action.
        let payer = ChangedReview {
            subject: SUBJECT_PAYER.to_string(),
            checked: true,
            is_pep: false,
        };
        assert_eq!(payer.audit_action(), "lead_pep_review_changed");
    }

    #[test]
    fn an_echoed_review_of_the_previous_payer_is_not_stamped_again() {
        // The payer changed: the server cleared the payer's review. An open
        // form sends the old review back with its old day.
        let previous = json!({ "pepReviews": {} });
        let mut echoed = json!({
            "pepReviews": {
                "payer": { "checked": true, "isPep": false, "checkedOn": "2026-10-20", "checkedBy": "Erste Prüferin" }
            }
        });
        let changed = stamp_reviews(&previous, &mut echoed, day("2026-10-23"), "Zweiter Prüfer");
        assert!(changed.is_empty());
        assert!(!review_of(&echoed, SUBJECT_PAYER).reviewed());
        // Staff deciding now send no day: that review is taken and stamped.
        let mut decided = json!({
            "pepReviews": { "payer": { "checked": true, "isPep": false, "checkedOn": null } }
        });
        let changed = stamp_reviews(&previous, &mut decided, day("2026-10-23"), "Zweiter Prüfer");
        assert_eq!(changed.len(), 1);
        assert_eq!(decided["pepReviews"]["payer"]["checkedOn"], "2026-10-23");
    }
}
