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
//!   row of `consent_form_choices` (history; the newest counts). For a minor
//!   the parent or guardian with access chooses for the child (QA 2026-10-12,
//!   A2-06); only such a choice counts (A3-01): the lead's own login of a
//!   minor saves nothing ([`BY_GUARDIAN`]), and a choice the lead's own login
//!   saved while the person was under 18 (by the date of birth on file) is
//!   ignored everywhere — the cabinet, the generated form, the electronic
//!   signature ([`current_for`]).
//! * A choice needs the three consents GMED's service runs on
//!   ([`ConsentChoices::has_core`]: processing by GMED, the doctors' records
//!   to GMED, storage in GMED's data system). An empty or partial "choice" is
//!   no consent at all: the cabinet does not save it ([`CORE_REQUIRED`]) and a
//!   form recording one is not signed electronically ([`INCOMPLETE`]). Who
//!   does not consent simply saves nothing; the form then goes on paper
//!   (QA 2026-10-12, A2-02).
//! * A generated form prints «[x]» only for what was chosen and «[ ]» for the
//!   rest and keeps who chose, when and the choice itself in its
//!   `generated_bindings` ([`BINDING_KEY`]). The adult form
//!   (`privacy_consents`) and the minor's forms ([`CHILD_TEMPLATES`], the
//!   parents or the guardian declare for the child) use the same options.
//! * A form without an own choice — or with a choice changed since — is not
//!   offered for an electronic signature (`document_signatures`:
//!   `consent_choice_missing` / `consent_choice_changed`); the paper
//!   signature stays possible, the person ticks the boxes on the printed
//!   copy.
//! * The person who chose signs the form: an electronic package without that
//!   person among the client signers is refused ([`CHOOSER_MUST_SIGN`]).
//!
//! See `docs/architecture/document-signatures-germany_ua.md`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

/// The consent form whose options the person chooses; also the key of the
/// option set in `consent_form_choices.template_id` (the minor's forms use
/// the same options).
pub const TEMPLATE: &str = "privacy_consents";
/// The Einverständniserklärung for a minor (two holders of parental
/// responsibility, or one alone / a guardian): the same options, chosen by a
/// parent or the guardian in the cabinet.
pub const CHILD_TEMPLATES: [&str; 2] =
    ["consent_data_release_child", "consent_data_release_single"];
/// Key of the choice inside `documents.generated_bindings`.
pub const BINDING_KEY: &str = "_own_consent_choice";
/// Marks patient forms that reproduce the scoped disclosure (since 2026-10-16).
pub const PATIENT_FORM_DISCLOSURE_KEY: &str = "_third_party_disclosure_recorded";
/// Version of the option texts shown in the cabinet.
pub const TEXT_VERSION: &str = "2026-10-12";
/// Refusal of an electronic signature: no own choice in the document.
pub const MISSING: &str = "consent_choice_missing";
/// Refusal of an electronic signature: the person chose differently since the
/// document was generated.
pub const CHANGED: &str = "consent_choice_changed";
/// Refusal of an electronic signature: the recorded choice lacks one of the
/// three consents the service runs on (a choice saved before 2026-10-12's
/// rule; [`ConsentChoices::has_core`]).
pub const INCOMPLETE: &str = "consent_choice_incomplete";
/// Refusal of a save in the cabinet: the three consents the service runs on
/// are not all ticked.
pub const CORE_REQUIRED: &str = "consent_core_required";
/// Refusal of an electronic package: the person who chose the options is not
/// among the client signers.
pub const CHOOSER_MUST_SIGN: &str = "consent_chooser_must_sign";
/// Refusal of a save in the cabinet: the lead's own login of a minor; a
/// parent or the guardian chooses with their own access (QA 2026-10-12,
/// A3-01).
pub const BY_GUARDIAN: &str = "consent_choice_by_guardian";

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

    /// The three consents GMED's service runs on (owner decision 2026-10-11:
    /// "the three consents the service runs on"): without them GMED can
    /// neither obtain, keep nor pass on the records of the request. The other
    /// options (named recipients, the channels) stay free.
    pub fn has_core(&self) -> bool {
        self.agency_processing && self.doctors_to_agency && self.data_system
    }
}

/// Who a named recipient (a trusted person of the cabinet) is to the person,
/// in the order the cabinet offers it; `friend` since 2026-10-14.
pub const RECIPIENT_RELATIONS: [&str; 7] = [
    "spouse",
    "child",
    "relative",
    "friend",
    "family_doctor",
    "clinic",
    "other",
];
/// At most this many recipients per choice (and trusted persons per lead).
pub const MAX_RECIPIENTS: usize = 5;
const RECIPIENT_TEXT_MAX: usize = 120;
/// Refusal of a save in the cabinet: "named recipients" is ticked, but nobody
/// is named.
pub const RECIPIENTS_REQUIRED: &str = "consent_recipients_required";
/// Refusal of a save in the cabinet: a recipient is incomplete, too long, of
/// an unknown kind, or there are more than [`MAX_RECIPIENTS`].
pub const RECIPIENTS_INVALID: &str = "consent_recipients_invalid";
pub const DISCLOSURE_VERSION: &str = "2026-10-14";
pub const DISCLOSURE_REQUIRED: &str = "disclosure_consent_required";

/// Evidence of the independent disclosure decision. The original actor/time
/// survive later changes of unrelated consent options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisclosureDecision {
    pub allow_disclosure: bool,
    pub consent_given: bool,
    pub version: String,
    pub language: String,
    pub chosen_at: DateTime<Utc>,
    pub chosen_by: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chosen_by_name: Option<String>,
    pub access_kind: String,
    pub company_name: String,
    pub consent_text: String,
}

pub fn disclosure_consent_text(language: &str, company: &str) -> String {
    let text = match language {
        "ru" => {
            "Я даю явное согласие на то, что [company] предоставляет указанным выше лицам в указанном объёме информацию о моих персональных данных, включая данные о состоянии здоровья, и передаёт им эти данные. Если существует обязанность соблюдать врачебную тайну, я в этом объёме освобождаю лиц, участвующих в организации и лечении, от этой обязанности. Я могу в любое время отозвать это согласие на будущее. Обработка данных, осуществлённая до отзыва, остаётся законной. Дополнительная информация содержится в Уведомлении о защите данных."
        }
        "uk" => {
            "Я надаю явну згоду на те, що [company] надає зазначеним вище особам у вказаному обсязі інформацію про мої персональні дані, зокрема дані про стан здоров’я, та передає їм ці дані. Якщо існує обов’язок дотримуватися лікарської таємниці, я в цьому обсязі звільняю осіб, які беруть участь в організації та лікуванні, від цього обов’язку. Я можу будь-коли відкликати цю згоду на майбутнє. Обробка даних, здійснена до відкликання, залишається законною. Додаткова інформація міститься в Повідомленні про захист даних."
        }
        "en" => {
            "I expressly consent to [company] providing the persons named above with information about my personal data, including my health data, within the specified scope, and transmitting this data to them. Where a duty of confidentiality applies, I release those involved in organisation and treatment from that duty to this extent. I may withdraw this consent at any time with effect for the future. Processing carried out before withdrawal remains unaffected. Further information can be found in the Privacy Notice."
        }
        _ => {
            "Ich willige ausdrücklich ein, dass [company] den oben genannten Personen im angegebenen Umfang Auskunft über meine personenbezogenen Daten, einschließlich meiner Gesundheitsdaten, erteilt und diese Daten an sie übermittelt. Soweit eine Schweigepflicht besteht, entbinde ich die an Organisation und Behandlung Beteiligten insoweit von dieser. Ich kann diese Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen. Die bis dahin erfolgte Verarbeitung bleibt davon unberührt. Weitere Informationen finden Sie im Datenschutzhinweis."
        }
    };
    text.replace("[company]", company)
}

/// A person or institution the person names for the option
/// [`ConsentChoices::named_recipients`] (owner decision 2026-10-12): who they
/// are, how to reach them and the explicitly permitted scope. Part of the choice, so the form
/// prints exactly the list the person chose; not sanctions-screened (owner
/// decision 2026-10-12).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsentRecipient {
    /// The person's name or the institution's name.
    pub name: String,
    /// One of [`RECIPIENT_RELATIONS`].
    pub relation: String,
    /// A phone number or an e-mail address; optional.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contact: Option<String>,
    /// Exactly what may be disclosed; absent only in legacy choices.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

impl ConsentRecipient {
    /// The relation as the German form names it.
    fn relation_label(&self) -> &'static str {
        match self.relation.as_str() {
            "spouse" => "Ehe-/Lebenspartner/in",
            "child" => "Kind",
            "relative" => "Angehörige/r",
            "friend" => "Freund/in / Bekannte/r",
            "family_doctor" => "Hausarzt/Hausärztin",
            "clinic" => "Klinik/Einrichtung",
            _ => "Sonstige",
        }
    }

    /// The line the form prints: name, relationship, contact and disclosure scope.
    pub fn printed_line(&self) -> String {
        let mut line = format!("{} ({})", self.name.trim(), self.relation_label());
        if let Some(contact) = self
            .contact
            .as_deref()
            .map(str::trim)
            .filter(|contact| !contact.is_empty())
        {
            line.push_str(", ");
            line.push_str(contact);
        }
        if let Some(scope) = self.scope.as_deref().filter(|s| !s.trim().is_empty()) {
            line.push_str("; Umfang der Auskunft: ");
            line.push_str(scope);
        }
        line
    }
}

/// Persons as they are stored — the trusted persons of the cabinet
/// (`leads.portal_trusted_persons`, 2026-10-14) and the recipients of a
/// choice: the name trimmed with inner spaces collapsed, the relation
/// trimmed, blank contacts dropped. `Err` with [`RECIPIENTS_INVALID`] for an
/// empty name, an unknown relation, a text over 120 characters or more than
/// [`MAX_RECIPIENTS`]. An empty list is valid (nobody named).
pub fn clean_persons(
    persons: Vec<ConsentRecipient>,
) -> Result<Vec<ConsentRecipient>, &'static str> {
    if persons.len() > MAX_RECIPIENTS {
        return Err(RECIPIENTS_INVALID);
    }
    let mut cleaned = Vec::with_capacity(persons.len());
    for person in persons {
        let name = person.name.split_whitespace().collect::<Vec<_>>().join(" ");
        let relation = person.relation.trim().to_string();
        let contact = person
            .contact
            .map(|contact| contact.trim().to_string())
            .filter(|contact| !contact.is_empty());
        let scope = person
            .scope
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if name.is_empty()
            || name.chars().count() > RECIPIENT_TEXT_MAX
            || !RECIPIENT_RELATIONS.contains(&relation.as_str())
            || contact
                .as_ref()
                .is_some_and(|contact| contact.chars().count() > RECIPIENT_TEXT_MAX)
            || scope.as_ref().is_some_and(|s| s.chars().count() > 240)
        {
            return Err(RECIPIENTS_INVALID);
        }
        cleaned.push(ConsentRecipient {
            name,
            relation,
            contact,
            scope,
        });
    }
    Ok(cleaned)
}

/// The recipients of a choice as they are stored ([`clean_persons`]); with
/// [`RECIPIENTS_REQUIRED`] when "named recipients" is ticked and nobody is
/// named.
pub fn clean_recipients(
    choices: &ConsentChoices,
    recipients: Vec<ConsentRecipient>,
) -> Result<Vec<ConsentRecipient>, &'static str> {
    // Without the consent to pass data on, no third party's data is kept.
    if !choices.named_recipients {
        return Ok(Vec::new());
    }
    let cleaned = clean_persons(recipients)?;
    if cleaned.is_empty() {
        return Err(RECIPIENTS_REQUIRED);
    }
    Ok(cleaned)
}

/// A saved choice as a generated form records it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OwnConsentChoice {
    pub id: Uuid,
    pub choices: ConsentChoices,
    /// The persons or institutions named for "named recipients"; printed only
    /// while that option is chosen. Empty in documents generated before
    /// 2026-10-12's recipients.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recipients: Vec<ConsentRecipient>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disclosure: Option<DisclosureDecision>,
    pub chosen_at: DateTime<Utc>,
    /// Where the person chose: `lead_portal`.
    pub source: String,
    /// `self` (the lead's own login) or `guardian` (a parent, guardian or
    /// representative with access); absent in documents generated before
    /// 2026-10-12's QA round.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_kind: Option<String>,
    /// The login that chose.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chosen_by: Option<Uuid>,
    /// The chooser's name, resolved when the form is generated and kept as evidence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chosen_by_name: Option<String>,
    /// The chooser's role ("Personensorgeberechtigte/r"), kept as evidence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chosen_by_role: Option<String>,
    /// The chooser's e-mail addresses (login and contact, lower case): one of
    /// them must sign an electronic package ([`CHOOSER_MUST_SIGN`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chosen_by_emails: Vec<String>,
    /// The lead the choice was saved for; not recorded in the document.
    #[serde(skip)]
    pub lead_id: Option<Uuid>,
}

impl OwnConsentChoice {
    /// The value kept under [`BINDING_KEY`].
    pub fn binding(&self) -> Value {
        json!(self)
    }

    /// The lines the form prints under "an folgende Personen oder
    /// Institutionen": the named recipients while that option is chosen.
    pub fn recipient_lines(&self) -> Vec<String> {
        if !self.choices.named_recipients {
            return Vec::new();
        }
        self.recipients
            .iter()
            .map(ConsentRecipient::printed_line)
            .collect()
    }

    /// The choice a generated document recorded, if any.
    pub fn from_bindings(bindings: Option<&Value>) -> Option<Self> {
        bindings
            .and_then(|bindings| bindings.get(BINDING_KEY))
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
    }

    /// Whether one of `signer_emails` is the person who chose. `true` when
    /// the document does not know the chooser's addresses (older documents,
    /// a choice without a login).
    pub fn signed_by_chooser<'a>(&self, signer_emails: impl IntoIterator<Item = &'a str>) -> bool {
        if self.chosen_by_emails.is_empty() {
            return true;
        }
        signer_emails
            .into_iter()
            .any(|email| self.chosen_by_emails.contains(&email.trim().to_lowercase()))
    }
}

/// Whether a document needs the person's own choice for an electronic
/// signature: the generated consent form, for an adult or for a minor.
pub fn needs_own_choice(template: Option<&str>) -> bool {
    template.is_some_and(|template| template == TEMPLATE || CHILD_TEMPLATES.contains(&template))
}

/// Whether the form is the minor's ([`CHILD_TEMPLATES`]).
pub fn is_child_form(template: Option<&str>) -> bool {
    template.is_some_and(|template| CHILD_TEMPLATES.contains(&template))
}

/// Why the document cannot be signed electronically as it is, read from the
/// document alone: a consent form generated without the person's own choice,
/// or with a choice that lacks a consent the service runs on. The minor's
/// form counts only a parent's or the guardian's choice: one the lead's own
/// login saved (`access_kind = self`, generated before 2026-10-12's QA round
/// A3-01) counts as none ([`MISSING`]).
pub fn electronic_signing_refusal(
    template: Option<&str>,
    bindings: Option<&Value>,
) -> Option<&'static str> {
    if !needs_own_choice(template) {
        return None;
    }
    match OwnConsentChoice::from_bindings(bindings) {
        None => Some(MISSING),
        // Older records without `access_kind` are not judged by it.
        Some(choice)
            if is_child_form(template) && choice.access_kind.as_deref() == Some("self") =>
        {
            Some(MISSING)
        }
        Some(choice) if !choice.choices.has_core() => Some(INCOMPLETE),
        Some(_) => None,
    }
}

/// The newest choice that counts. A choice of the lead's own login made while
/// the person was a minor — under 18 on the day of the choice (German time) by
/// the date of birth on file now — is ignored (QA 2026-10-12, A3-01): only a
/// parent's or the guardian's choice counts for a minor, and a child's old
/// choice never comes back as the parent's. A corrected date of birth
/// re-judges it.
const CURRENT_SQL: &str = r#"
    SELECT c.id, c.choices, c.chosen_at, c.source, c.access_kind, c.chosen_by, c.lead_id,
           c.recipients, c.disclosure
    FROM consent_form_choices c
    LEFT JOIN leads subject ON subject.id = c.lead_id
    WHERE c.template_id = 'privacy_consents'
      AND (c.lead_id = $1
           OR c.patient_id = $2
           OR c.lead_id IN (SELECT l.id FROM leads l
                            WHERE l.converted_patient_id = $2 OR l.prospect_patient_id = $2))
      AND NOT (
          c.access_kind = 'self'
          AND subject.date_of_birth IS NOT NULL
          AND subject.date_of_birth
              > ((c.chosen_at AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years')
      )
    ORDER BY c.seq DESC
    LIMIT 1"#;

/// The newest own choice of a lead or patient: the lead's, the patient's, or
/// that of a lead the patient came from (a choice made in the cabinet stays
/// with the patient after the conversion). A minor's own choice does not
/// count (see [`CURRENT_SQL`]).
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
    type Row = (
        Uuid,
        Value,
        DateTime<Utc>,
        String,
        String,
        Option<Uuid>,
        Option<Uuid>,
        Value,
        Option<Value>,
    );
    let row: Option<Row> = sqlx::query_as(CURRENT_SQL)
        .bind(lead_id)
        .bind(patient_id)
        .fetch_optional(executor)
        .await?;
    Ok(row.and_then(
        |(
            id,
            choices,
            chosen_at,
            source,
            access_kind,
            chosen_by,
            choice_lead_id,
            recipients,
            disclosure,
        )| {
            Some(OwnConsentChoice {
                id,
                choices: serde_json::from_value(choices).ok()?,
                recipients: serde_json::from_value(recipients).unwrap_or_default(),
                disclosure: disclosure.and_then(|d| serde_json::from_value(d).ok()),
                chosen_at,
                source,
                access_kind: Some(access_kind),
                chosen_by,
                chosen_by_name: None,
                chosen_by_role: None,
                chosen_by_emails: Vec::new(),
                lead_id: choice_lead_id,
            })
        },
    ))
}

/// The person who chose, as the generated form records it: for the lead's own
/// login the person the form is about (`subject_name`, `subject_email`); for
/// a parent's, guardian's or representative's login the representative the
/// login belongs to, with the role the form gives them. Fills
/// `chosen_by_name`, `chosen_by_role` and `chosen_by_emails`; a choice
/// without a login stays unnamed (the older wording).
pub async fn describe_chooser(
    db: &gmed_db::DbPool,
    choice: &mut OwnConsentChoice,
    subject_name: &str,
    subject_email: Option<&str>,
) -> Result<(), sqlx::Error> {
    let Some(user_id) = choice.chosen_by else {
        return Ok(());
    };
    let login: Option<(String, String)> =
        sqlx::query_as("SELECT name, email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(db)
            .await?;
    let mut emails: Vec<String> = Vec::new();
    let mut push_email = |email: Option<&str>| {
        if let Some(email) = email.map(|value| value.trim().to_lowercase())
            && !email.is_empty()
            && !emails.contains(&email)
        {
            emails.push(email);
        }
    };
    push_email(login.as_ref().map(|(_, email)| email.as_str()));
    let mut name = None;
    let mut role = None;
    if choice.access_kind.as_deref() == Some("guardian") {
        if let Some(lead_id) = choice.lead_id {
            let contact: Option<Option<Uuid>> = sqlx::query_scalar(
                r#"SELECT trusted_contact_id FROM lead_portal_access
                   WHERE lead_id = $1 AND user_id = $2 AND kind = 'guardian'
                   ORDER BY (revoked_at IS NULL) DESC, created_at DESC
                   LIMIT 1"#,
            )
            .bind(lead_id)
            .bind(user_id)
            .fetch_optional(db)
            .await?;
            if let Some(contact_id) = contact.flatten() {
                let mut conn = db.acquire().await?;
                if let Some(loaded) =
                    crate::routes::lead_representatives::load(&mut conn, lead_id).await?
                    && let Some(person) = loaded.representation.find(contact_id)
                {
                    let person_name = person.name();
                    if !person_name.is_empty() {
                        name = Some(person_name);
                    }
                    push_email(person.email.as_deref());
                    role = Some(representative_role_label(
                        loaded.representation.minor,
                        person.role,
                        person.is_guardian_of_minor(loaded.representation.answers.custody()),
                    ));
                }
            }
        }
        if name.is_none() {
            name = login
                .as_ref()
                .map(|(login_name, _)| login_name.trim().to_string())
                .filter(|login_name| !login_name.is_empty());
        }
    } else {
        let subject = subject_name.trim();
        if !subject.is_empty() {
            name = Some(subject.to_string());
        }
        push_email(subject_email);
    }
    choice.chosen_by_name = name;
    choice.chosen_by_role = role.map(str::to_string);
    choice.chosen_by_emails = emails;
    Ok(())
}

/// The role of a representative as the consent forms call it.
fn representative_role_label(minor: bool, role: &str, guardian_of_minor: bool) -> &'static str {
    use crate::routes::lead_representatives::{
        ROLE_AUTHORISED_REPRESENTATIVE, ROLE_LEGAL_GUARDIAN,
    };
    if minor {
        return if guardian_of_minor {
            "Vormund"
        } else {
            "Personensorgeberechtigte/r"
        };
    }
    match role {
        ROLE_LEGAL_GUARDIAN => "rechtliche Betreuung",
        ROLE_AUTHORISED_REPRESENTATIVE => "bevollmächtigte Person",
        _ => "Vertreter/in",
    }
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
    if template == Some("lead_self_disclosure") {
        // Existing signed patient forms predate the disclosure section.
        // Preserve their evidence; only new forms promise this snapshot.
        if bindings.and_then(|value| value.get(PATIENT_FORM_DISCLOSURE_KEY))
            != Some(&Value::Bool(true))
        {
            return Ok(None);
        }
        let recorded = OwnConsentChoice::from_bindings(bindings);
        let current = current_for(db, lead_id, patient_id).await?;
        return Ok(disclosure_changed(recorded.as_ref(), current.as_ref()).then_some(CHANGED));
    }
    if !needs_own_choice(template) {
        return Ok(None);
    }
    let Some(recorded) = OwnConsentChoice::from_bindings(bindings) else {
        return Ok(None);
    };
    let current = current_for(db, lead_id, patient_id).await?;
    Ok((current.map(|choice| choice.id) != Some(recorded.id)).then_some(CHANGED))
}

/// The patient form reproduces the disclosure, not unrelated channel choices.
fn disclosure_changed(
    recorded: Option<&OwnConsentChoice>,
    current: Option<&OwnConsentChoice>,
) -> bool {
    let snapshot = |choice: Option<&OwnConsentChoice>| {
        choice
            .filter(|choice| choice.disclosure.is_some() || choice.choices.named_recipients)
            .map(|choice| {
                (
                    choice.disclosure.clone(),
                    choice.recipients.clone(),
                    choice.choices.named_recipients,
                )
            })
    };
    snapshot(recorded) != snapshot(current)
}

/// The consent forms of a package whose chooser is not among the client
/// signers ([`CHOOSER_MUST_SIGN`]): the first such document, if any.
pub fn chooser_missing_from_signers<'a>(
    documents: impl IntoIterator<Item = (Uuid, Option<&'a str>, Option<&'a Value>)>,
    client_emails: &[&str],
) -> Option<Uuid> {
    documents
        .into_iter()
        .find(|(_, template, bindings)| {
            needs_own_choice(*template)
                && OwnConsentChoice::from_bindings(*bindings)
                    .is_some_and(|choice| !choice.signed_by_chooser(client_emails.iter().copied()))
        })
        .map(|(id, _, _)| id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn core() -> ConsentChoices {
        ConsentChoices {
            agency_processing: true,
            doctors_to_agency: true,
            data_system: true,
            ..ConsentChoices::default()
        }
    }

    fn choice() -> OwnConsentChoice {
        OwnConsentChoice {
            id: Uuid::nil(),
            choices: ConsentChoices {
                channel_whatsapp: true,
                ..core()
            },
            recipients: Vec::new(),
            disclosure: None,
            chosen_at: Utc.with_ymd_and_hms(2026, 10, 12, 8, 5, 0).unwrap(),
            source: "lead_portal".into(),
            access_kind: None,
            chosen_by: None,
            chosen_by_name: None,
            chosen_by_role: None,
            chosen_by_emails: Vec::new(),
            lead_id: None,
        }
    }

    #[test]
    fn patient_form_checks_the_same_disclosure_people_and_scope_as_the_consent() {
        let mut recorded = choice();
        recorded.choices.named_recipients = true;
        recorded.recipients = vec![ConsentRecipient {
            name: "Max Muster".into(),
            relation: "friend".into(),
            contact: Some("max@example.test".into()),
            scope: Some("Nur Rechnungen".into()),
        }];
        recorded.disclosure = Some(DisclosureDecision {
            allow_disclosure: true,
            consent_given: true,
            version: DISCLOSURE_VERSION.into(),
            language: "de".into(),
            chosen_at: recorded.chosen_at,
            chosen_by: Uuid::nil(),
            chosen_by_name: Some("Anna Muster".into()),
            access_kind: "self".into(),
            company_name: "GMED Test".into(),
            consent_text: disclosure_consent_text("de", "GMED Test"),
        });
        let mut current = recorded.clone();
        current.id = Uuid::new_v4();
        current.choices.channel_whatsapp = !current.choices.channel_whatsapp;
        assert!(!disclosure_changed(Some(&recorded), Some(&current)));
        for key in ["name", "relation", "contact", "scope"] {
            let mut changed = current.clone();
            let person = &mut changed.recipients[0];
            match key {
                "name" => person.name = "Different Person".into(),
                "relation" => person.relation = "spouse".into(),
                "contact" => person.contact = Some("other@example.test".into()),
                "scope" => person.scope = Some("Medizinische Informationen".into()),
                _ => unreachable!(),
            }
            assert!(disclosure_changed(Some(&recorded), Some(&changed)), "{key}");
        }
        assert!(disclosure_changed(None, Some(&recorded)));
        assert!(disclosure_changed(Some(&recorded), None));
        assert!(!disclosure_changed(None, None));
        let mut legacy = recorded.clone();
        legacy.disclosure = None;
        assert!(!disclosure_changed(Some(&legacy), Some(&legacy)));
        assert!(disclosure_changed(None, Some(&legacy)));
        let mut edited_legacy = legacy.clone();
        edited_legacy.recipients[0].scope = Some("Andere Informationen".into());
        assert!(disclosure_changed(Some(&legacy), Some(&edited_legacy)));
        current.disclosure.as_mut().unwrap().allow_disclosure = false;
        current.disclosure.as_mut().unwrap().consent_given = false;
        current.choices.named_recipients = false;
        current.recipients.clear();
        assert!(disclosure_changed(Some(&recorded), Some(&current)));
    }

    #[test]
    fn the_adult_and_the_minors_consent_forms_need_the_own_choice() {
        for template in [
            "privacy_consents",
            "consent_data_release_child",
            "consent_data_release_single",
        ] {
            assert!(needs_own_choice(Some(template)), "{template}");
            assert_eq!(
                electronic_signing_refusal(Some(template), None),
                Some(MISSING)
            );
        }
        assert!(is_child_form(Some("consent_data_release_single")));
        assert!(!is_child_form(Some("privacy_consents")));
        for other in [
            None,
            Some("confidentiality_release"),
            Some("framework_contract"),
        ] {
            assert!(!needs_own_choice(other));
            assert_eq!(electronic_signing_refusal(other, None), None);
        }
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
    fn a_choice_without_the_three_core_consents_is_no_consent() {
        assert!(core().has_core());
        assert!(!ConsentChoices::default().has_core());
        for missing in ["agency_processing", "doctors_to_agency", "data_system"] {
            let mut value = serde_json::to_value(core()).unwrap();
            value[missing] = json!(false);
            let partial: ConsentChoices = serde_json::from_value(value).unwrap();
            assert!(!partial.has_core(), "{missing}");
            let mut recorded = choice();
            recorded.choices = partial;
            let bindings = json!({ BINDING_KEY: recorded.binding() });
            assert_eq!(
                electronic_signing_refusal(Some(TEMPLATE), Some(&bindings)),
                Some(INCOMPLETE),
                "{missing}"
            );
        }
        // Recipients and channels stay free.
        assert!(
            ConsentChoices {
                named_recipients: false,
                ..core()
            }
            .has_core()
        );
    }

    #[test]
    fn named_recipients_are_checked_and_printed_only_while_chosen() {
        let named = ConsentChoices {
            named_recipients: true,
            ..core()
        };
        let person = |name: &str, relation: &str, contact: Option<&str>| ConsentRecipient {
            name: name.into(),
            relation: relation.into(),
            contact: contact.map(Into::into),
            scope: None,
        };
        assert_eq!(
            clean_recipients(&named, Vec::new()),
            Err(RECIPIENTS_REQUIRED)
        );
        assert_eq!(
            clean_recipients(&core(), vec![person("Olga", "spouse", None)]),
            Ok(Vec::new()),
            "not chosen: nobody is kept"
        );
        assert_eq!(
            clean_recipients(
                &named,
                vec![person("  Olga   Muster ", "spouse", Some("  "))]
            ),
            Ok(vec![person("Olga Muster", "spouse", None)])
        );
        for invalid in [
            person(" ", "spouse", None),
            person("Olga", "neighbour", None),
            person(&"x".repeat(121), "other", None),
            person("Olga", "other", Some(&"1".repeat(121))),
        ] {
            assert_eq!(
                clean_recipients(&named, vec![invalid]),
                Err(RECIPIENTS_INVALID)
            );
        }
        assert_eq!(
            clean_recipients(
                &named,
                vec![person("Olga", "spouse", None); MAX_RECIPIENTS + 1]
            ),
            Err(RECIPIENTS_INVALID)
        );

        let mut recorded = choice();
        recorded.recipients = vec![
            person("Olga Muster", "spouse", Some("+49 151 000000")),
            person("Praxis Dr. Beispiel", "family_doctor", None),
        ];
        assert!(
            recorded.recipient_lines().is_empty(),
            "not chosen: nothing printed"
        );
        recorded.choices.named_recipients = true;
        assert_eq!(
            recorded.recipient_lines(),
            [
                "Olga Muster (Ehe-/Lebenspartner/in), +49 151 000000",
                "Praxis Dr. Beispiel (Hausarzt/Hausärztin)",
            ]
        );
        let restored =
            OwnConsentChoice::from_bindings(Some(&json!({ BINDING_KEY: recorded.binding() })))
                .unwrap();
        assert_eq!(restored, recorded);
    }

    /// The trusted persons of the cabinet (owner 2026-10-14): the same rules
    /// as the recipients, but an empty list is valid and nothing depends on a
    /// choice.
    #[test]
    fn trusted_persons_are_cleaned_like_recipients_and_may_be_empty() {
        let person = |name: &str, relation: &str, contact: Option<&str>| ConsentRecipient {
            name: name.into(),
            relation: relation.into(),
            contact: contact.map(Into::into),
            scope: None,
        };
        assert_eq!(clean_persons(Vec::new()), Ok(Vec::new()));
        assert_eq!(
            clean_persons(vec![
                person("  Oma   Lena ", " relative ", Some(" +49 30 000 ")),
                person("Max Freund", "friend", Some("")),
            ]),
            Ok(vec![
                person("Oma Lena", "relative", Some("+49 30 000")),
                person("Max Freund", "friend", None),
            ])
        );
        for invalid in [
            person("", "friend", None),
            person("Max", "neighbour", None),
            person(&"x".repeat(121), "friend", None),
            person("Max", "friend", Some(&"1".repeat(121))),
        ] {
            assert_eq!(clean_persons(vec![invalid]), Err(RECIPIENTS_INVALID));
        }
        assert_eq!(
            clean_persons(vec![person("Max", "friend", None); MAX_RECIPIENTS + 1]),
            Err(RECIPIENTS_INVALID)
        );
        assert_eq!(
            clean_persons(vec![person("Max", "friend", None); MAX_RECIPIENTS])
                .map(|list| list.len()),
            Ok(MAX_RECIPIENTS)
        );
        // The new relation is offered and printed.
        assert!(RECIPIENT_RELATIONS.contains(&"friend"));
        assert_eq!(
            person("Max Freund", "friend", None).printed_line(),
            "Max Freund (Freund/in / Bekannte/r)"
        );
        // A choice with "named recipients" still needs somebody.
        let named = ConsentChoices {
            named_recipients: true,
            ..core()
        };
        assert_eq!(
            clean_recipients(&named, vec![person("Max", "friend", None)]),
            Ok(vec![person("Max", "friend", None)])
        );
        assert_eq!(
            clean_recipients(&named, Vec::new()),
            Err(RECIPIENTS_REQUIRED)
        );
    }

    #[test]
    fn the_recorded_choice_round_trips_with_its_timestamp() {
        let recorded = choice();
        let bindings = json!({ "_signature_anchors": [], BINDING_KEY: recorded.binding() });
        assert_eq!(
            OwnConsentChoice::from_bindings(Some(&bindings)),
            Some(recorded.clone())
        );
        assert!(recorded.choices.any_channel());
        assert!(!ConsentChoices::default().any_channel());
        assert_eq!(bindings[BINDING_KEY]["chosen_at"], "2026-10-12T08:05:00Z");
        // An unknown option is no valid choice.
        let tampered = json!({ BINDING_KEY: {
            "id": Uuid::nil(), "chosen_at": "2026-10-12T08:05:00Z", "source": "lead_portal",
            "choices": { "agency_processing": true, "staff_ticked": true }
        }});
        assert_eq!(OwnConsentChoice::from_bindings(Some(&tampered)), None);
    }

    #[test]
    fn the_record_keeps_who_chose_and_only_that_person_may_sign() {
        let mut parent = choice();
        parent.access_kind = Some("guardian".into());
        parent.chosen_by = Some(Uuid::nil());
        parent.chosen_by_name = Some("Maria MusterAR".into());
        parent.chosen_by_role = Some("Personensorgeberechtigte/r".into());
        parent.chosen_by_emails = vec!["maria.parent@example.com".into()];
        assert_eq!(parent.binding()["chosen_by_name"], "Maria MusterAR");
        assert_eq!(
            parent.binding()["chosen_by_role"],
            "Personensorgeberechtigte/r"
        );
        let restored =
            OwnConsentChoice::from_bindings(Some(&json!({ BINDING_KEY: parent.binding() })))
                .unwrap();
        assert_eq!(restored, parent);

        assert!(parent.signed_by_chooser(["Maria.Parent@example.com "]));
        assert!(!parent.signed_by_chooser(["other.parent@example.com"]));
        assert!(!parent.signed_by_chooser(std::iter::empty::<&str>()));
        // Unknown addresses (older documents): no check.
        assert!(choice().signed_by_chooser(["anybody@example.com"]));

        let id = Uuid::new_v4();
        let bindings = json!({ BINDING_KEY: parent.binding() });
        let other = json!({});
        assert_eq!(
            chooser_missing_from_signers(
                [
                    (Uuid::nil(), Some("framework_contract"), Some(&other)),
                    (id, Some("consent_data_release_child"), Some(&bindings)),
                ],
                &["other.parent@example.com"],
            ),
            Some(id)
        );
        assert_eq!(
            chooser_missing_from_signers(
                [(id, Some("consent_data_release_child"), Some(&bindings))],
                &["other.parent@example.com", "maria.parent@example.com"],
            ),
            None
        );
    }

    /// QA 2026-10-12, A3-01: the minor's form records only a parent's or the
    /// guardian's choice; one the child's own login saved counts as none.
    #[test]
    fn a_childs_own_choice_never_makes_the_minors_form_signable() {
        let mut own = choice();
        own.access_kind = Some("self".into());
        let own_bindings = json!({ BINDING_KEY: own.binding() });
        let mut parent = choice();
        parent.access_kind = Some("guardian".into());
        let parent_bindings = json!({ BINDING_KEY: parent.binding() });
        for template in CHILD_TEMPLATES {
            assert_eq!(
                electronic_signing_refusal(Some(template), Some(&own_bindings)),
                Some(MISSING),
                "{template}"
            );
            assert_eq!(
                electronic_signing_refusal(Some(template), Some(&parent_bindings)),
                None,
                "{template}"
            );
            // A record without `access_kind` (older documents) is not judged by it.
            let older = json!({ BINDING_KEY: choice().binding() });
            assert_eq!(
                electronic_signing_refusal(Some(template), Some(&older)),
                None,
                "{template}"
            );
        }
        // The adult's own choice stays the adult's.
        assert_eq!(
            electronic_signing_refusal(Some(TEMPLATE), Some(&own_bindings)),
            None
        );
    }

    #[test]
    fn the_representatives_role_is_named_as_the_forms_name_it() {
        use crate::routes::lead_representatives::{
            ROLE_AUTHORISED_REPRESENTATIVE, ROLE_LEGAL_GUARDIAN, ROLE_LEGAL_REPRESENTATIVE,
        };
        assert_eq!(
            representative_role_label(true, ROLE_LEGAL_REPRESENTATIVE, false),
            "Personensorgeberechtigte/r"
        );
        assert_eq!(
            representative_role_label(true, ROLE_LEGAL_REPRESENTATIVE, true),
            "Vormund"
        );
        assert_eq!(
            representative_role_label(false, ROLE_AUTHORISED_REPRESENTATIVE, false),
            "bevollmächtigte Person"
        );
        assert_eq!(
            representative_role_label(false, ROLE_LEGAL_GUARDIAN, false),
            "rechtliche Betreuung"
        );
    }
}
