//! Who is screened, when, and what happens to a possible match.
//!
//! Subjects:
//! * the patient of a lead (`lead_patient`);
//! * for a minor patient, the lead's trusted contacts whose relation is
//!   parent or guardian (`lead_guardian`), with the name parts, citizenships
//!   and residence country the parent entered in the cabinet
//!   (`lead_representatives`, by the id of the contact);
//! * for an adult patient, the representative and the legal guardian
//!   (Betreuer) named in the cabinet — the same `lead_guardian` subject, its
//!   relation is the role;
//! * the third-party payer of a lead (`lead_payer`) from
//!   `lead_payer_declarations`: a person, or a company, an organisation or an
//!   insurer screened as an organisation by its name, with what the payer
//!   stated through its own link (`lead_payer_statements`: the habitual
//!   residence and, once sent, an organisation's representative and
//!   beneficial owners) — see [`payer_subjects`];
//! * patients (`patient`) that are active or inactive. Prospective patients
//!   are covered by their lead.
//!
//! Triggers: database triggers queue a lead or patient whenever a screened
//! field changes (any writer: wizard, public intake, patient portal); the
//! worker in [`spawn_screening_worker`] screens the queue. A new list version
//! re-screens every open subject ([`rescreen_all`]). The gate screens the
//! lead once more right before qualification, conversion and the agency
//! countersignature.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::NaiveDate;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::fsf::ListEntry;
use super::matching::{Match, Subject};
use super::normalize::{country_code, name_tokens};
use super::store::{self, ActiveIndex};
use super::{HIT_ENTITY_TYPE, POSSIBLE_MATCH_NOTIFICATION_KIND};
use crate::audit;
use crate::state::AppState;

const QUEUE_POLL_SECONDS: u64 = 15;
const QUEUE_BATCH: i64 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubjectKind {
    LeadPatient,
    LeadGuardian,
    LeadPayer,
    Patient,
}

impl SubjectKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LeadPatient => "lead_patient",
            Self::LeadGuardian => "lead_guardian",
            Self::LeadPayer => "lead_payer",
            Self::Patient => "patient",
        }
    }
}

/// One screened person or organisation and whose record it belongs to.
#[derive(Debug, Clone, Serialize)]
pub struct SubjectRecord {
    pub kind: SubjectKind,
    pub lead_id: Option<Uuid>,
    pub patient_id: Option<Uuid>,
    /// Guardian contact id or payer declaration id; empty for the patient.
    pub subject_ref: String,
    pub subject: Subject,
    /// ISO codes of the residence country (country policy only).
    pub residence: Vec<String>,
    /// Relation of a guardian as entered.
    pub relation: Option<String>,
}

impl SubjectRecord {
    /// Citizenships and residence, the countries the country policy checks.
    pub fn countries(&self) -> Vec<String> {
        let mut countries = self.subject.citizenships.clone();
        for code in &self.residence {
            if !countries.contains(code) {
                countries.push(code.clone());
            }
        }
        countries
    }

    fn snapshot(&self) -> Value {
        json!({
            "first_name": self.subject.first_name,
            "middle_name": self.subject.middle_name,
            "last_name": self.subject.last_name,
            "date_of_birth": self.subject.date_of_birth,
            "citizenships": self.subject.citizenships,
            "residence": self.residence,
            "organisation": self.subject.organisation,
            "relation": self.relation,
        })
    }
}

/// The subjects of one lead.
#[derive(Debug, Clone)]
pub struct LeadSubjects {
    pub lead_id: Uuid,
    pub converted_patient_id: Option<Uuid>,
    pub prospect_patient_id: Option<Uuid>,
    pub subjects: Vec<SubjectRecord>,
}

fn text(row: &sqlx::postgres::PgRow, column: &str) -> String {
    row.try_get::<Option<String>, _>(column)
        .ok()
        .flatten()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn non_empty(value: String) -> Option<String> {
    if value.is_empty() { None } else { Some(value) }
}

fn iso_codes(values: &[String]) -> Vec<String> {
    let mut codes = Vec::new();
    for value in values {
        if let Some(code) = country_code(value)
            && !codes.contains(&code)
        {
            codes.push(code);
        }
    }
    codes
}

fn json_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn json_codes(value: &Value, key: &str) -> Vec<String> {
    match value.get(key) {
        Some(Value::Array(items)) => iso_codes(
            &items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>(),
        ),
        Some(Value::String(single)) => iso_codes(std::slice::from_ref(single)),
        _ => Vec::new(),
    }
}

fn json_date(value: &Value, key: &str) -> Option<NaiveDate> {
    let raw = json_text(value, key);
    NaiveDate::parse_from_str(raw.get(..10).unwrap_or(&raw), "%Y-%m-%d").ok()
}

/// Parent or legal guardian, in the languages staff type relations in.
pub fn is_guardian_relation(relation: &str) -> bool {
    let relation = relation.trim().to_lowercase();
    [
        "parent",
        "mother",
        "father",
        "guardian",
        "eltern",
        "mutter",
        "vater",
        "vormund",
        "sorgeberecht",
        "мать",
        "мама",
        "отец",
        "папа",
        "родител",
        "опекун",
        "опека",
        "мати",
        "батьк",
        "опікун",
        "піклувальн",
    ]
    .iter()
    .any(|word| relation.contains(word))
}

/// A person's full name split into given names and the last word.
fn split_full_name(name: &str) -> (String, String) {
    let words: Vec<&str> = name.split_whitespace().collect();
    match words.as_slice() {
        [] => (String::new(), String::new()),
        [single] => (String::new(), (*single).to_string()),
        [given @ .., last] => (given.join(" "), (*last).to_string()),
    }
}

fn is_anonymized_lead(first_name: &str, last_name: &str, failed_outcome: &str) -> bool {
    failed_outcome == "delete_anonymized"
        || (first_name == crate::routes::leads::ANONYMIZED_FIRST_NAME && last_name == "Lead")
}

/// The subjects of a lead; `None` when the lead does not exist or has been
/// anonymised.
pub async fn load_lead_subjects(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
) -> Result<Option<LeadSubjects>, sqlx::Error> {
    Ok(load_leads_subjects(db, &[lead_id])
        .await?
        .into_iter()
        .next())
}

/// The subjects of several leads with two queries; anonymised and missing
/// leads are left out.
pub async fn load_leads_subjects(
    db: &gmed_db::DbPool,
    lead_ids: &[Uuid],
) -> Result<Vec<LeadSubjects>, sqlx::Error> {
    if lead_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(
        r#"SELECT id, first_name, middle_name, last_name, date_of_birth, citizenships,
                  country, wizard_state->>'registration_country' AS registration_country,
                  trusted_contacts, failed_outcome_status, converted_patient_id,
                  prospect_patient_id
           FROM leads
           WHERE id = ANY($1)"#,
    )
    .bind(lead_ids)
    .fetch_all(db)
    .await?;
    let mut payers = load_payer_rows(db, lead_ids).await;
    let mut representatives = load_representative_rows(db, lead_ids).await?;
    let today = crate::app_time::today();
    let mut leads = Vec::with_capacity(rows.len());
    for row in rows {
        let lead_id: Uuid = row.try_get("id")?;
        let payer_rows = payers.remove(&lead_id).unwrap_or_default();
        let representative_rows = representatives.remove(&lead_id).unwrap_or_default();
        if let Some(lead) = lead_subjects_from_row(&row, &payer_rows, &representative_rows, today) {
            leads.push(lead);
        }
    }
    Ok(leads)
}

/// What the cabinet holds about the representatives of the leads
/// (`lead_representatives`), as JSON rows by lead: the role, the name parts,
/// the citizenships and the residence country of a trusted contact
/// (`contact_id`).
async fn load_representative_rows(
    db: &gmed_db::DbPool,
    lead_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Value>>, sqlx::Error> {
    let rows: Vec<(Uuid, Value)> = sqlx::query_as(
        "SELECT r.lead_id, to_jsonb(r) FROM lead_representatives r WHERE r.lead_id = ANY($1)",
    )
    .bind(lead_ids)
    .fetch_all(db)
    .await?;
    let mut by_lead: HashMap<Uuid, Vec<Value>> = HashMap::new();
    for (lead_id, row) in rows {
        by_lead.entry(lead_id).or_default().push(row);
    }
    Ok(by_lead)
}

/// The row of a trusted contact among a lead's representative rows.
fn representative_row<'a>(rows: &'a [Value], contact: &Value) -> Option<&'a Value> {
    let contact_id = json_text(contact, "id").to_lowercase();
    if contact_id.is_empty() {
        return None;
    }
    rows.iter()
        .find(|row| json_text(row, "contact_id").to_lowercase() == contact_id)
}

/// A trusted contact as a guardian subject. The row the cabinet wrote for the
/// contact (`extras`) adds what the contact entry does not hold: the name as
/// first and last name (while it still is the name of the contact), the
/// citizenships and the residence country. One subject per person: the
/// reference is the id of the contact, with or without a row.
fn guardian_subject(
    lead_id: Uuid,
    position: usize,
    contact: &Value,
    extras: Option<&Value>,
    relation: String,
) -> SubjectRecord {
    let (first, last) = match extras {
        Some(extras) => crate::routes::lead_representatives::name_parts(
            &json_text(contact, "name"),
            Some(&json_text(extras, "first_name")),
            Some(&json_text(extras, "last_name")),
        ),
        None => split_full_name(&json_text(contact, "name")),
    };
    let mut residence = json_codes(contact, "country");
    let mut citizenships = json_codes(contact, "citizenships");
    for code in json_codes(contact, "residence_country").into_iter().chain(
        extras
            .map(|extras| json_codes(extras, "country"))
            .unwrap_or_default(),
    ) {
        if !residence.contains(&code) {
            residence.push(code);
        }
    }
    for code in extras
        .map(|extras| json_codes(extras, "citizenships"))
        .unwrap_or_default()
    {
        if !citizenships.contains(&code) {
            citizenships.push(code);
        }
    }
    let subject_ref = contact
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("contact-{position}"));
    SubjectRecord {
        kind: SubjectKind::LeadGuardian,
        lead_id: Some(lead_id),
        patient_id: None,
        subject_ref,
        subject: Subject {
            first_name: first,
            middle_name: None,
            last_name: last,
            date_of_birth: json_date(contact, "birth_date"),
            citizenships,
            organisation: false,
        },
        residence,
        relation: non_empty(relation),
    }
}

fn lead_subjects_from_row(
    row: &sqlx::postgres::PgRow,
    payer_rows: &[Value],
    representative_rows: &[Value],
    today: NaiveDate,
) -> Option<LeadSubjects> {
    let lead_id: Uuid = row.try_get("id").ok()?;
    let first_name = text(row, "first_name");
    let last_name = text(row, "last_name");
    if is_anonymized_lead(&first_name, &last_name, &text(row, "failed_outcome_status")) {
        return None;
    }
    let date_of_birth: Option<NaiveDate> = row.try_get("date_of_birth").unwrap_or(None);
    let mut citizenships = iso_codes(
        &row.try_get::<Vec<String>, _>("citizenships")
            .unwrap_or_default(),
    );
    if let Some(code) = country_code(&text(row, "registration_country"))
        && !citizenships.contains(&code)
    {
        citizenships.push(code);
    }
    let residence: Vec<String> = country_code(&text(row, "country")).into_iter().collect();

    let mut subjects = vec![SubjectRecord {
        kind: SubjectKind::LeadPatient,
        lead_id: Some(lead_id),
        patient_id: None,
        subject_ref: String::new(),
        subject: Subject {
            first_name,
            middle_name: non_empty(text(row, "middle_name")),
            last_name,
            date_of_birth,
            citizenships,
            organisation: false,
        },
        residence,
        relation: None,
    }];

    let contacts: Value = row
        .try_get::<Option<Value>, _>("trusted_contacts")
        .unwrap_or(None)
        .unwrap_or(Value::Null);
    if crate::routes::leads::is_minor_on(date_of_birth, today) {
        for (position, contact) in contacts.as_array().into_iter().flatten().enumerate() {
            let relation = json_text(contact, "relation");
            if !is_guardian_relation(&relation) {
                continue;
            }
            // What the parent entered in the cabinet; a row of an adult role
            // (from before a corrected date of birth) says nothing here.
            let extras = representative_row(representative_rows, contact)
                .filter(|extras| json_text(extras, "role") == "legal_representative");
            subjects.push(guardian_subject(
                lead_id, position, contact, extras, relation,
            ));
        }
    } else {
        // An adult's contacts are not screened — but for the representative
        // and the legal guardian (Betreuer) the lead named in the cabinet.
        for (position, contact) in contacts.as_array().into_iter().flatten().enumerate() {
            let Some(extras) = representative_row(representative_rows, contact) else {
                continue;
            };
            let role = json_text(extras, "role");
            if role == "authorised_representative" || role == "legal_guardian" {
                subjects.push(guardian_subject(
                    lead_id,
                    position,
                    contact,
                    Some(extras),
                    role,
                ));
            }
        }
    }

    subjects.extend(payer_subjects(lead_id, payer_rows));

    Some(LeadSubjects {
        lead_id,
        converted_patient_id: row.try_get("converted_patient_id").unwrap_or(None),
        prospect_patient_id: row.try_get("prospect_patient_id").unwrap_or(None),
        subjects,
    })
}

/// Payer declarations of the leads as JSON rows, by lead.
///
/// The declaration table `lead_payer_declarations` (columns `lead_id`,
/// `payer_kind` 'self' | 'third_party', `first_name`, `last_name`,
/// `date_of_birth`, `citizenships`, `country`) is created by the payer
/// declaration work that lands separately. Until its migration exists this
/// returns nothing (`to_regclass` guard). Rows are read as JSON so that
/// additional columns (for example an organisation name) do not break
/// screening. What the payer stated itself through its own link (phase 3a,
/// `lead_payer_statements`) rides along as `payer_statement` (`null` without
/// a statement).
pub async fn load_payer_rows(db: &gmed_db::DbPool, lead_ids: &[Uuid]) -> HashMap<Uuid, Vec<Value>> {
    let mut by_lead: HashMap<Uuid, Vec<Value>> = HashMap::new();
    let tables: Result<(bool, bool), sqlx::Error> = sqlx::query_as(
        r#"SELECT to_regclass('public.lead_payer_declarations') IS NOT NULL,
                  to_regclass('public.lead_payer_statements') IS NOT NULL"#,
    )
    .fetch_one(db)
    .await;
    let Ok((true, statements)) = tables else {
        return by_lead;
    };
    if lead_ids.is_empty() {
        return by_lead;
    }
    let query = if statements {
        r#"SELECT d.lead_id,
                  to_jsonb(d) || jsonb_build_object('payer_statement', to_jsonb(s))
           FROM lead_payer_declarations d
           LEFT JOIN lead_payer_statements s ON s.lead_id = d.lead_id
           WHERE d.lead_id = ANY($1)"#
    } else {
        "SELECT d.lead_id, to_jsonb(d) FROM lead_payer_declarations d WHERE d.lead_id = ANY($1)"
    };
    let rows: Vec<(Uuid, Value)> = match sqlx::query_as(query).bind(lead_ids).fetch_all(db).await {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(error = %error, "Payer declarations unreadable for sanctions screening");
            return by_lead;
        }
    };
    for (lead_id, row) in rows {
        by_lead.entry(lead_id).or_default().push(row);
    }
    by_lead
}

/// Third-party payers among a lead's declarations.
///
/// A company, an organisation or an insurer (`payer_type` other than
/// `person`) is screened against list entities by its name: the name goes
/// into `last_name`, which is where the matcher reads an organisation's whole
/// name, and its seat country is the residence. A person is screened by first
/// and last name, date of birth and citizenships; a person without a first
/// name is screened as an organisation, as before the payer type existed.
///
/// What the payer stated through its own link (`payer_statement`, phase 3a)
/// adds the habitual residence to the residence countries and — once the
/// payer submitted it — an organisation's legal representative
/// (`payer-representative`, relation `payer_representative`) and each
/// beneficial owner (`payer-owner-<n>` from 1, relation
/// `payer_beneficial_owner`) as subjects of their own.
pub fn payer_subjects(lead_id: Uuid, rows: &[Value]) -> Vec<SubjectRecord> {
    let mut subjects = Vec::new();
    for (position, row) in rows.iter().enumerate() {
        if json_text(row, "payer_kind") != "third_party" {
            continue;
        }
        let statement = row
            .get("payer_statement")
            .filter(|statement| statement.is_object());
        let payer_type = json_text(row, "payer_type");
        let organisation_name = ["organisation_name", "organization_name", "company_name"]
            .iter()
            .map(|key| json_text(row, key))
            .find(|value| !value.is_empty());
        let subject = if !payer_type.is_empty() && payer_type != "person" {
            Subject {
                first_name: String::new(),
                middle_name: None,
                last_name: organisation_name.unwrap_or_default(),
                date_of_birth: None,
                citizenships: Vec::new(),
                organisation: true,
            }
        } else {
            let first_name = json_text(row, "first_name");
            let (organisation, last_name) = match (first_name.is_empty(), organisation_name) {
                (true, Some(name)) => (true, name),
                (true, None) => (true, json_text(row, "last_name")),
                (false, _) => (false, json_text(row, "last_name")),
            };
            Subject {
                first_name,
                middle_name: None,
                last_name,
                date_of_birth: json_date(row, "date_of_birth"),
                citizenships: json_codes(row, "citizenships"),
                organisation,
            }
        };
        let subject_ref = match row.get("id") {
            Some(Value::String(id)) => id.clone(),
            Some(Value::Number(id)) => id.to_string(),
            _ => format!("payer-{position}"),
        };
        let mut residence = json_codes(row, "country");
        for code in statement
            .map(|statement| json_codes(statement, "habitual_residence_country"))
            .unwrap_or_default()
        {
            if !residence.contains(&code) {
                residence.push(code);
            }
        }
        let organisation = !payer_type.is_empty() && payer_type != "person";
        subjects.push(SubjectRecord {
            kind: SubjectKind::LeadPayer,
            lead_id: Some(lead_id),
            patient_id: None,
            subject_ref,
            subject,
            residence,
            relation: Some("payer".to_string()),
        });
        // The people behind an organisation, once the payer sent its answers.
        let Some(statement) = statement
            .filter(|statement| organisation && !json_text(statement, "submitted_at").is_empty())
        else {
            continue;
        };
        let person = |first_name: String,
                      last_name: String,
                      date_of_birth: Option<NaiveDate>,
                      residence: Vec<String>,
                      subject_ref: String,
                      relation: &str| SubjectRecord {
            kind: SubjectKind::LeadPayer,
            lead_id: Some(lead_id),
            patient_id: None,
            subject_ref,
            subject: Subject {
                first_name,
                middle_name: None,
                last_name,
                date_of_birth,
                citizenships: Vec::new(),
                organisation: false,
            },
            residence,
            relation: Some(relation.to_string()),
        };
        let representative_last = json_text(statement, "representative_last_name");
        if !representative_last.is_empty() {
            subjects.push(person(
                json_text(statement, "representative_first_name"),
                representative_last,
                None,
                Vec::new(),
                "payer-representative".to_string(),
                "payer_representative",
            ));
        }
        let owners = statement
            .get("beneficial_owners")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (index, owner) in owners.iter().enumerate() {
            let last_name = json_text(owner, "last_name");
            if last_name.is_empty() {
                continue;
            }
            subjects.push(person(
                json_text(owner, "first_name"),
                last_name,
                json_date(owner, "date_of_birth"),
                json_codes(owner, "country"),
                format!("payer-owner-{}", index + 1),
                "payer_beneficial_owner",
            ));
        }
    }
    subjects
}

/// A patient as a subject; `None` for missing, prospective, deleted or
/// anonymised records.
pub async fn load_patient_subject(
    db: &gmed_db::DbPool,
    patient_id: Uuid,
) -> Result<Option<SubjectRecord>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT id, first_name, last_name, birth_date, citizenships, nationality,
                  residence_country, address_country, lifecycle_status,
                  legal_status ? 'anonymized_at' AS anonymized
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };
    let lifecycle = text(&row, "lifecycle_status");
    let anonymized: bool = row
        .try_get::<Option<bool>, _>("anonymized")
        .unwrap_or(None)
        .unwrap_or(false);
    if anonymized || matches!(lifecycle.as_str(), "prospective" | "deleted") {
        return Ok(None);
    }
    let mut citizenships = iso_codes(
        &row.try_get::<Vec<String>, _>("citizenships")
            .unwrap_or_default(),
    );
    if let Some(code) = country_code(&text(&row, "nationality"))
        && !citizenships.contains(&code)
    {
        citizenships.push(code);
    }
    let residence = iso_codes(&[
        text(&row, "residence_country"),
        text(&row, "address_country"),
    ]);
    Ok(Some(SubjectRecord {
        kind: SubjectKind::Patient,
        lead_id: None,
        patient_id: Some(patient_id),
        subject_ref: String::new(),
        subject: Subject {
            first_name: text(&row, "first_name"),
            middle_name: None,
            last_name: text(&row, "last_name"),
            date_of_birth: row.try_get("birth_date").unwrap_or(None),
            citizenships,
            organisation: false,
        },
        residence,
        relation: None,
    }))
}

/// Normalised fingerprint of what we know about a subject: a false-positive
/// decision covers exactly this data.
pub fn subject_fingerprint(subject: &Subject) -> String {
    let mut tokens: Vec<String> = name_tokens(&format!(
        "{} {} {}",
        subject.first_name,
        subject.middle_name.as_deref().unwrap_or_default(),
        subject.last_name
    ))
    .into_iter()
    .map(|token| token.canon)
    .collect();
    tokens.sort();
    let mut citizenships = subject.citizenships.clone();
    citizenships.sort();
    let material = json!({
        "tokens": tokens,
        "dob": subject.date_of_birth,
        "citizenships": citizenships,
        "organisation": subject.organisation,
    });
    hex::encode(Sha256::digest(material.to_string().as_bytes()))
}

/// Fingerprint of a list entry's identifying data: when the EU amends the
/// names, dates or citizenships, a false-positive decision is reviewed again.
pub fn entry_fingerprint(entry: &ListEntry) -> String {
    let mut names: Vec<String> = entry.names.iter().map(|name| name.display()).collect();
    names.sort();
    let mut citizenships = entry.citizenships.clone();
    citizenships.sort();
    let material = json!({
        "names": names,
        "birth_dates": entry.birth_dates,
        "citizenships": citizenships,
    });
    hex::encode(Sha256::digest(material.to_string().as_bytes()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Owner {
    Lead(Uuid),
    Patient(Uuid),
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ScreenReport {
    pub list_version_date: Option<NaiveDate>,
    pub new_hits: Vec<Uuid>,
}

/// Screens a lead and stores its possible matches.
pub async fn screen_lead(state: &AppState, lead_id: Uuid) -> Result<ScreenReport, sqlx::Error> {
    let Some(index) = store::active_index(&state.db).await? else {
        return Ok(ScreenReport::default());
    };
    let subjects = load_lead_subjects(&state.db, lead_id)
        .await?
        .map(|lead| lead.subjects)
        .unwrap_or_default();
    screen_owner(state, &index, Owner::Lead(lead_id), subjects).await
}

/// Screens a patient and stores its possible matches.
pub async fn screen_patient(
    state: &AppState,
    patient_id: Uuid,
) -> Result<ScreenReport, sqlx::Error> {
    let Some(index) = store::active_index(&state.db).await? else {
        return Ok(ScreenReport::default());
    };
    let subjects: Vec<SubjectRecord> = load_patient_subject(&state.db, patient_id)
        .await?
        .into_iter()
        .collect();
    screen_owner(state, &index, Owner::Patient(patient_id), subjects).await
}

/// Possible matches of each subject against the index (CPU work off the
/// async runtime).
async fn compute_matches(
    index: &ActiveIndex,
    subjects: Vec<SubjectRecord>,
) -> Result<Vec<(SubjectRecord, Vec<(ListEntry, Match)>)>, sqlx::Error> {
    let index = index.index.clone();
    tokio::task::spawn_blocking(move || {
        subjects
            .into_iter()
            .map(|record| {
                let matches = index
                    .screen(&record.subject)
                    .into_iter()
                    .map(|found| (index.entry(found.entry_index).clone(), found))
                    .collect();
                (record, matches)
            })
            .collect()
    })
    .await
    .map_err(|error| sqlx::Error::Protocol(format!("sanctions screening task: {error}")))
}

struct ExistingHit {
    id: Uuid,
    key: (String, String, String),
    status: String,
    subject_fingerprint: String,
    entry_fingerprint: String,
}

async fn screen_owner(
    state: &AppState,
    index: &ActiveIndex,
    owner: Owner,
    subjects: Vec<SubjectRecord>,
) -> Result<ScreenReport, sqlx::Error> {
    let computed = compute_matches(index, subjects).await?;
    let (owner_column, owner_id) = match owner {
        Owner::Lead(id) => ("lead_id", id),
        Owner::Patient(id) => ("patient_id", id),
    };

    let mut tx = state.db.begin().await?;
    let rows = sqlx::query(&format!(
        r#"SELECT id, subject_kind, subject_ref, list_logical_id, status,
                  subject_fingerprint, entry_fingerprint
           FROM sanctions_hits
           WHERE {owner_column} = $1
           FOR UPDATE"#
    ))
    .bind(owner_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut existing = Vec::with_capacity(rows.len());
    for row in rows {
        existing.push(ExistingHit {
            id: row.try_get("id")?,
            key: (
                row.try_get("subject_kind")?,
                row.try_get("subject_ref")?,
                row.try_get("list_logical_id")?,
            ),
            status: row.try_get("status")?,
            subject_fingerprint: row.try_get("subject_fingerprint")?,
            entry_fingerprint: row.try_get("entry_fingerprint")?,
        });
    }

    // A patient converted from a lead keeps the CEO's false-positive
    // decisions about the lead's patient as long as the data are the same.
    let inherited: HashSet<(String, String, String)> = match owner {
        Owner::Patient(patient_id) => sqlx::query_as::<_, (String, String, String)>(
            r#"SELECT h.list_logical_id, h.subject_fingerprint, h.entry_fingerprint
               FROM sanctions_hits h
               JOIN leads l ON l.id = h.lead_id
               WHERE l.converted_patient_id = $1
                 AND h.subject_kind = 'lead_patient'
                 AND h.status = 'false_positive'"#,
        )
        .bind(patient_id)
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .collect(),
        Owner::Lead(_) => HashSet::new(),
    };

    let mut seen: HashSet<(String, String, String)> = HashSet::new();
    let mut new_hits = Vec::new();
    for (record, matches) in computed {
        let subject_fp = subject_fingerprint(&record.subject);
        for (entry, found) in matches {
            let key = (
                record.kind.as_str().to_string(),
                record.subject_ref.clone(),
                entry.logical_id.clone(),
            );
            seen.insert(key.clone());
            let entry_fp = entry_fingerprint(&entry);
            let same_key: Vec<&ExistingHit> =
                existing.iter().filter(|hit| hit.key == key).collect();
            let details = json!({
                "score": found.score,
                "name_score": found.name_score,
                "matched_name": found.matched_name,
                "dob": found.dob,
                "citizenship": found.citizenship,
            });
            let entry_json = serde_json::to_value(&entry)
                .map_err(|error| sqlx::Error::Protocol(format!("serialize entry: {error}")))?;

            if let Some(open) = same_key.iter().find(|hit| hit.status == "open") {
                sqlx::query(
                    r#"UPDATE sanctions_hits
                       SET score = $2, match_details = $3, list_version_id = $4,
                           list_entry = $5, entry_fingerprint = $6,
                           subject_snapshot = $7, subject_fingerprint = $8,
                           still_matches = true, last_screened_at = now(), updated_at = now()
                       WHERE id = $1"#,
                )
                .bind(open.id)
                .bind(found.score)
                .bind(&details)
                .bind(index.version_id)
                .bind(&entry_json)
                .bind(&entry_fp)
                .bind(record.snapshot())
                .bind(&subject_fp)
                .execute(&mut *tx)
                .await?;
                continue;
            }
            let decided = same_key.iter().find(|hit| {
                hit.status == "confirmed"
                    || (hit.status == "false_positive"
                        && hit.subject_fingerprint == subject_fp
                        && hit.entry_fingerprint == entry_fp)
            });
            if let Some(decided) = decided {
                sqlx::query(
                    r#"UPDATE sanctions_hits
                       SET still_matches = true, last_screened_at = now(), updated_at = now()
                       WHERE id = $1"#,
                )
                .bind(decided.id)
                .execute(&mut *tx)
                .await?;
                continue;
            }
            if inherited.contains(&(
                entry.logical_id.clone(),
                subject_fp.clone(),
                entry_fp.clone(),
            )) {
                continue;
            }

            let (lead_id, patient_id) = match owner {
                Owner::Lead(id) => (Some(id), None),
                Owner::Patient(id) => (None, Some(id)),
            };
            let inserted: Option<Uuid> = sqlx::query_scalar(
                r#"INSERT INTO sanctions_hits
                       (subject_kind, lead_id, patient_id, subject_ref, subject_snapshot,
                        subject_fingerprint, list_version_id, list_logical_id, list_entry,
                        entry_fingerprint, score, match_details)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                   ON CONFLICT DO NOTHING
                   RETURNING id"#,
            )
            .bind(record.kind.as_str())
            .bind(lead_id)
            .bind(patient_id)
            .bind(&record.subject_ref)
            .bind(record.snapshot())
            .bind(&subject_fp)
            .bind(index.version_id)
            .bind(&entry.logical_id)
            .bind(&entry_json)
            .bind(&entry_fp)
            .bind(found.score)
            .bind(&details)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(hit_id) = inserted {
                audit::write_in_transaction(
                    &mut tx,
                    &audit::domain_event(
                        "sanctions_hit_created",
                        None,
                        HIT_ENTITY_TYPE,
                        Some(hit_id),
                        json!({
                            "subject_kind": record.kind.as_str(),
                            "lead_id": lead_id,
                            "patient_id": patient_id,
                            "list_version_id": index.version_id,
                            "list_logical_id": entry.logical_id,
                            "eu_reference": entry.eu_reference,
                            "score": found.score,
                        }),
                    ),
                )
                .await?;
                new_hits.push(hit_id);
            }
        }
    }

    for hit in &existing {
        if hit.status != "false_positive" && !seen.contains(&hit.key) {
            sqlx::query(
                r#"UPDATE sanctions_hits
                   SET still_matches = false, last_screened_at = now(), updated_at = now()
                   WHERE id = $1"#,
            )
            .bind(hit.id)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;

    if !new_hits.is_empty() {
        notify_ceo_about_hits(state, &new_hits).await;
    }
    Ok(ScreenReport {
        list_version_date: Some(index.list_date),
        new_hits,
    })
}

/// Tells every active CEO about new possible matches. The notification names
/// nobody; the review page shows the details.
async fn notify_ceo_about_hits(state: &AppState, hits: &[Uuid]) {
    let recipients: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT id FROM users WHERE is_active = true AND role = 'ceo' ORDER BY created_at",
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(recipients) => recipients,
        Err(error) => {
            tracing::error!(error = %error, "Load CEO recipients for sanctions hits");
            return;
        }
    };
    for hit_id in hits {
        for recipient in &recipients {
            let inserted: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
                r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                   VALUES ($1, $2, 'Possible EU sanctions list match',
                           'Review the possible match on the sanctions page.', $3, $4)
                   RETURNING id"#,
            )
            .bind(recipient)
            .bind(POSSIBLE_MATCH_NOTIFICATION_KIND)
            .bind(HIT_ENTITY_TYPE)
            .bind(hit_id)
            .fetch_one(&state.db)
            .await;
            match inserted {
                Ok(notification_id) => {
                    crate::realtime::publish_notification_event(
                        state,
                        *recipient,
                        "notification.created",
                        Some(notification_id),
                        json!({ "entity_type": HIT_ENTITY_TYPE, "entity_id": hit_id }),
                    )
                    .await;
                }
                Err(error) => {
                    tracing::error!(error = %error, hit_id = %hit_id, "Notify CEO about sanctions hit");
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LiveStatus {
    Clear,
    PossibleMatch,
    /// No list has been imported yet.
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
pub struct LiveCheck {
    pub status: LiveStatus,
    pub list_version_date: Option<NaiveDate>,
}

/// Screens a name without storing anything (wizard step 1).
pub async fn live_check(state: &AppState, subject: Subject) -> Result<LiveCheck, sqlx::Error> {
    let Some(index) = store::active_index(&state.db).await? else {
        return Ok(LiveCheck {
            status: LiveStatus::Unavailable,
            list_version_date: None,
        });
    };
    let shared = index.index.clone();
    let possible = tokio::task::spawn_blocking(move || !shared.screen(&subject).is_empty())
        .await
        .map_err(|error| sqlx::Error::Protocol(format!("sanctions live check: {error}")))?;
    Ok(LiveCheck {
        status: if possible {
            LiveStatus::PossibleMatch
        } else {
            LiveStatus::Clear
        },
        list_version_date: Some(index.list_date),
    })
}

/// Screens queued leads and patients. Returns how many queue items were
/// taken.
pub async fn process_queue(state: &AppState) -> Result<usize, sqlx::Error> {
    let items: Vec<(String, Uuid)> = sqlx::query_as(
        r#"DELETE FROM sanctions_screening_queue
           WHERE (subject_type, subject_id) IN (
               SELECT subject_type, subject_id
               FROM sanctions_screening_queue
               ORDER BY queued_at
               LIMIT $1
               FOR UPDATE SKIP LOCKED
           )
           RETURNING subject_type, subject_id"#,
    )
    .bind(QUEUE_BATCH)
    .fetch_all(&state.db)
    .await?;
    if items.is_empty() {
        return Ok(0);
    }
    // Without a list nothing can be screened; the first import re-screens
    // every open subject anyway.
    if store::active_version(&state.db).await?.is_none() {
        return Ok(items.len());
    }
    for (subject_type, subject_id) in &items {
        let result = match subject_type.as_str() {
            "lead" => screen_lead(state, *subject_id).await.map(|_| ()),
            "patient" => screen_patient(state, *subject_id).await.map(|_| ()),
            _ => Ok(()),
        };
        if let Err(error) = result {
            tracing::error!(error = %error, subject_type, subject_id = %subject_id, "Sanctions screening failed; queued again");
            let _ = sqlx::query(
                r#"INSERT INTO sanctions_screening_queue (subject_type, subject_id)
                   VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            )
            .bind(subject_type)
            .bind(subject_id)
            .execute(&state.db)
            .await;
        }
    }
    Ok(items.len())
}

/// Polls the screening queue.
pub fn spawn_screening_worker(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(QUEUE_POLL_SECONDS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if let Err(error) = process_queue(&state).await {
                tracing::error!(error = %error, "Sanctions screening queue failed");
            }
        }
    });
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RescreenReport {
    pub leads: usize,
    pub patients: usize,
    pub new_hits: usize,
    pub errors: usize,
}

/// Screens every open lead and every active or inactive patient again, after
/// a new list version.
pub async fn rescreen_all(state: &AppState) -> Result<RescreenReport, sqlx::Error> {
    let lead_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM leads
           WHERE qualification_status NOT IN ('converted', 'archived', 'deleted')
             AND COALESCE(failed_outcome_status, 'none') <> 'delete_anonymized'
             AND NOT (first_name = $1 AND last_name = 'Lead')
           UNION
           SELECT DISTINCT lead_id FROM sanctions_hits
           WHERE lead_id IS NOT NULL AND status <> 'false_positive'"#,
    )
    .bind(crate::routes::leads::ANONYMIZED_FIRST_NAME)
    .fetch_all(&state.db)
    .await?;
    let patient_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM patients
           WHERE lifecycle_status IN ('active', 'inactive')
             AND NOT (legal_status ? 'anonymized_at')
           UNION
           SELECT DISTINCT patient_id FROM sanctions_hits
           WHERE patient_id IS NOT NULL AND status <> 'false_positive'"#,
    )
    .fetch_all(&state.db)
    .await?;
    let mut report = RescreenReport::default();
    for lead_id in lead_ids {
        match screen_lead(state, lead_id).await {
            Ok(result) => {
                report.leads += 1;
                report.new_hits += result.new_hits.len();
            }
            Err(error) => {
                report.errors += 1;
                tracing::error!(error = %error, lead_id = %lead_id, "Sanctions re-screening of a lead failed");
            }
        }
    }
    for patient_id in patient_ids {
        match screen_patient(state, patient_id).await {
            Ok(result) => {
                report.patients += 1;
                report.new_hits += result.new_hits.len();
            }
            Err(error) => {
                report.errors += 1;
                tracing::error!(error = %error, patient_id = %patient_id, "Sanctions re-screening of a patient failed");
            }
        }
    }
    Ok(report)
}

/// Removes the screening results of a purged lead (and of its prospect
/// patient) with their notifications, inside the purge transaction: they
/// follow the lead's retention.
pub async fn purge_for_lead_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM user_notifications
           WHERE entity_type = $2
             AND entity_id IN (
                 SELECT h.id FROM sanctions_hits h
                 WHERE h.lead_id = $1
                    OR h.patient_id = (
                        SELECT l.prospect_patient_id FROM leads l
                        WHERE l.id = $1 AND l.converted_patient_id IS NULL
                    )
             )"#,
    )
    .bind(lead_id)
    .bind(HIT_ENTITY_TYPE)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"DELETE FROM sanctions_hits
           WHERE lead_id = $1
              OR patient_id = (
                  SELECT l.prospect_patient_id FROM leads l
                  WHERE l.id = $1 AND l.converted_patient_id IS NULL
              )"#,
    )
    .bind(lead_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("DELETE FROM sanctions_country_overrides WHERE lead_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "DELETE FROM sanctions_screening_queue WHERE subject_type = 'lead' AND subject_id = $1",
    )
    .bind(lead_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Removes the screening results of an erased patient inside the erasure
/// transaction.
pub async fn purge_for_patient_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM user_notifications
           WHERE entity_type = $2
             AND entity_id IN (SELECT id FROM sanctions_hits WHERE patient_id = $1)"#,
    )
    .bind(patient_id)
    .bind(HIT_ENTITY_TYPE)
    .execute(&mut **tx)
    .await?;
    sqlx::query("DELETE FROM sanctions_hits WHERE patient_id = $1")
        .bind(patient_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM sanctions_country_overrides WHERE patient_id = $1")
        .bind(patient_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "DELETE FROM sanctions_screening_queue WHERE subject_type = 'patient' AND subject_id = $1",
    )
    .bind(patient_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guardian_relations_are_recognised_in_all_staff_languages() {
        for relation in [
            "Mother",
            "father",
            "Parent",
            "Legal guardian",
            "Mutter",
            "Vormund",
            "мама",
            "Отец",
            "опекун",
            "батько",
        ] {
            assert!(is_guardian_relation(relation), "{relation}");
        }
        for relation in ["Spouse", "Brother", "Freund", "друг", ""] {
            assert!(!is_guardian_relation(relation), "{relation}");
        }
    }

    #[test]
    fn full_names_split_into_given_names_and_surname() {
        assert_eq!(
            split_full_name("Anna Maria Beispiel"),
            ("Anna Maria".into(), "Beispiel".into())
        );
        assert_eq!(split_full_name(" Solo "), (String::new(), "Solo".into()));
        assert_eq!(split_full_name(""), (String::new(), String::new()));
    }

    #[test]
    fn a_guardian_subject_takes_what_the_cabinet_entered_for_the_contact() {
        let lead_id = Uuid::new_v4();
        let contact = json!({
            "id": "5D0C1F0E-0000-4000-8000-000000000001",
            "name": "Anna von Muster",
            "relation": "mother",
            "birth_date": "1985-03-02",
        });
        // Without a row: the name split at the last space, nothing else known.
        let plain = guardian_subject(lead_id, 0, &contact, None, "mother".into());
        assert_eq!(plain.kind, SubjectKind::LeadGuardian);
        assert_eq!(plain.subject_ref, "5D0C1F0E-0000-4000-8000-000000000001");
        assert_eq!(
            (
                plain.subject.first_name.as_str(),
                plain.subject.last_name.as_str()
            ),
            ("Anna von", "Muster")
        );
        assert!(plain.subject.citizenships.is_empty() && plain.residence.is_empty());

        // The row is found by the id of the contact, whatever the case.
        let rows = vec![json!({
            "contact_id": "5d0c1f0e-0000-4000-8000-000000000001",
            "role": "legal_representative",
            "first_name": "Anna",
            "last_name": "von Muster",
            "citizenships": ["DE", "UA"],
            "country": "AT",
        })];
        let extras = representative_row(&rows, &contact);
        assert!(extras.is_some());
        let entered = guardian_subject(lead_id, 0, &contact, extras, "mother".into());
        // The same person under the same reference, now with more data: the
        // fingerprint changes, so an earlier decision is reviewed again.
        assert_eq!(entered.subject_ref, plain.subject_ref);
        assert_eq!(
            (
                entered.subject.first_name.as_str(),
                entered.subject.last_name.as_str()
            ),
            ("Anna", "von Muster")
        );
        assert_eq!(entered.subject.citizenships, vec!["DE", "UA"]);
        assert_eq!(entered.residence, vec!["AT"]);
        assert_eq!(entered.countries(), vec!["DE", "UA", "AT"]);
        assert_eq!(
            entered.subject.date_of_birth,
            NaiveDate::from_ymd_opt(1985, 3, 2)
        );
        assert_ne!(
            subject_fingerprint(&plain.subject),
            subject_fingerprint(&entered.subject)
        );
        // A contact without an id has no row and keeps its position.
        let unnamed = json!({ "name": "Ben Muster", "relation": "father" });
        assert!(representative_row(&rows, &unnamed).is_none());
        assert_eq!(
            guardian_subject(lead_id, 3, &unnamed, None, "father".into()).subject_ref,
            "contact-3"
        );
    }

    #[test]
    fn fingerprints_ignore_spelling_noise_but_not_identity_changes() {
        let base = Subject {
            first_name: "Testomir".into(),
            last_name: "Korneev".into(),
            citizenships: vec!["RU".into(), "DE".into()],
            ..Subject::default()
        };
        let noisy = Subject {
            first_name: " TESTOMIR ".into(),
            last_name: "Korneev".into(),
            citizenships: vec!["DE".into(), "RU".into()],
            ..Subject::default()
        };
        assert_eq!(subject_fingerprint(&base), subject_fingerprint(&noisy));
        let born = Subject {
            date_of_birth: NaiveDate::from_ymd_opt(1990, 1, 1),
            ..base.clone()
        };
        assert_ne!(subject_fingerprint(&base), subject_fingerprint(&born));
    }

    #[test]
    fn an_organisation_payer_is_an_organisation_subject_with_its_seat() {
        let lead_id = Uuid::new_v4();
        let subjects = payer_subjects(
            lead_id,
            &[
                json!({ "payer_kind": "self" }),
                json!({
                    "payer_kind": "third_party",
                    "payer_type": "company",
                    "organisation_name": " Beispiel Shipping GmbH ",
                    // Nothing of a person counts for an organisation.
                    "first_name": "Viktor",
                    "last_name": "Zahler",
                    "date_of_birth": "1970-05-06",
                    "citizenships": ["AT"],
                    "country": "CY"
                }),
                json!({
                    "payer_kind": "third_party",
                    "payer_type": "person",
                    "first_name": "Viktor",
                    "last_name": "Zahler",
                    "date_of_birth": "1970-05-06",
                    "citizenships": ["AT"],
                    "country": "DE"
                }),
                // A row of an older server: no type, a person.
                json!({
                    "payer_kind": "third_party",
                    "first_name": "Erika",
                    "last_name": "Zahler"
                }),
            ],
        );
        assert_eq!(subjects.len(), 3, "a self-payer is no subject");
        assert!(
            subjects
                .iter()
                .all(|record| record.kind == SubjectKind::LeadPayer
                    && record.lead_id == Some(lead_id))
        );

        let company = &subjects[0];
        assert!(company.subject.organisation);
        assert_eq!(company.subject.first_name, "");
        assert_eq!(company.subject.last_name, "Beispiel Shipping GmbH");
        assert_eq!(company.subject.date_of_birth, None);
        assert!(company.subject.citizenships.is_empty());
        assert_eq!(company.residence, ["CY"]);
        assert_eq!(company.countries(), ["CY"]);
        assert!(company.subject.is_screenable());
        assert_eq!(company.snapshot()["organisation"], true);

        let person = &subjects[1];
        assert!(!person.subject.organisation);
        assert_eq!(person.subject.first_name, "Viktor");
        assert_eq!(person.subject.last_name, "Zahler");
        assert_eq!(
            person.subject.date_of_birth,
            NaiveDate::from_ymd_opt(1970, 5, 6)
        );
        assert_eq!(person.countries(), ["AT", "DE"]);
        assert!(!subjects[2].subject.organisation);
        assert_ne!(
            subject_fingerprint(&company.subject),
            subject_fingerprint(&person.subject)
        );
    }

    #[test]
    fn the_payers_own_statement_adds_residence_representative_and_owners_once_sent() {
        let lead_id = Uuid::new_v4();
        let statement = |submitted: bool| {
            json!({
                "habitual_residence_country": "AE",
                "representative_first_name": "Viktor",
                "representative_last_name": "Zahler",
                "beneficial_owners": [
                    { "first_name": "Anna", "last_name": "Muster", "date_of_birth": "1980-02-03",
                      "country": "de", "share_percent": 60 },
                    { "first_name": "Ben", "last_name": "Muster", "share_percent": 40 }
                ],
                "submitted_at": if submitted { json!("2026-10-06T10:00:00+00:00") } else { Value::Null },
            })
        };
        let company = |statement: Value| {
            json!({
                "payer_kind": "third_party",
                "payer_type": "company",
                "organisation_name": "Beispiel GmbH",
                "country": "CY",
                "payer_statement": statement,
            })
        };
        // While the payer drafts, only the residence counts.
        let drafting = payer_subjects(lead_id, &[company(statement(false))]);
        assert_eq!(drafting.len(), 1);
        assert_eq!(drafting[0].residence, ["CY", "AE"]);

        let sent = payer_subjects(lead_id, &[company(statement(true))]);
        assert_eq!(
            sent.len(),
            4,
            "the company, its representative and two owners"
        );
        assert!(
            sent.iter()
                .all(|record| record.kind == SubjectKind::LeadPayer)
        );
        let representative = &sent[1];
        assert_eq!(representative.subject_ref, "payer-representative");
        assert_eq!(
            representative.relation.as_deref(),
            Some("payer_representative")
        );
        assert!(!representative.subject.organisation);
        assert_eq!(representative.subject.last_name, "Zahler");
        let owner = &sent[2];
        assert_eq!(owner.subject_ref, "payer-owner-1");
        assert_eq!(owner.relation.as_deref(), Some("payer_beneficial_owner"));
        assert_eq!(owner.subject.first_name, "Anna");
        assert_eq!(
            owner.subject.date_of_birth,
            NaiveDate::from_ymd_opt(1980, 2, 3)
        );
        assert_eq!(owner.residence, ["DE"]);
        assert_eq!(sent[3].subject_ref, "payer-owner-2");

        // A person payer gains the residence only; a row without a
        // statement stays as before.
        let person = payer_subjects(
            lead_id,
            &[json!({
                "payer_kind": "third_party",
                "payer_type": "person",
                "first_name": "Viktor",
                "last_name": "Zahler",
                "country": "AT",
                "payer_statement": statement(true),
            })],
        );
        assert_eq!(person.len(), 1);
        assert_eq!(person[0].residence, ["AT", "AE"]);
        let plain = payer_subjects(
            lead_id,
            &[json!({
                "payer_kind": "third_party",
                "first_name": "Viktor",
                "last_name": "Zahler",
                "country": "AT",
                "payer_statement": null,
            })],
        );
        assert_eq!(plain[0].residence, ["AT"]);
    }

    #[test]
    fn subject_countries_combine_citizenship_and_residence() {
        let record = SubjectRecord {
            kind: SubjectKind::LeadPatient,
            lead_id: None,
            patient_id: None,
            subject_ref: String::new(),
            subject: Subject {
                citizenships: vec!["UA".into()],
                ..Subject::default()
            },
            residence: vec!["RU".into(), "UA".into()],
            relation: None,
        };
        assert_eq!(record.countries(), vec!["UA", "RU"]);
    }
}
