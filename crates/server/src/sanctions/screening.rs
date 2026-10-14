//! Who is screened, when, and what happens to a possible match.
//!
//! Subjects:
//! * the patient of a lead (`lead_patient`);
//! * for a minor patient, the lead's trusted contacts whose relation is
//!   parent or guardian (`lead_guardian`), with the name parts, citizenships
//!   and residence country the parent entered in the cabinet
//!   (`lead_representatives`, by the id of the contact). An explicit link to
//!   an existing patient fills missing basic identity, never medical data;
//! * for an adult patient, the representative and the legal guardian
//!   (Betreuer) named in the cabinet — the same `lead_guardian` subject, its
//!   relation is the role;
//! * the third-party payer of a lead (`lead_payer`) from
//!   `lead_payer_declarations`: a person, or a company, an organisation or an
//!   insurer screened as an organisation by its name, with what the payer
//!   stated through its own link (`lead_payer_statements`: the habitual
//!   residence and, once sent, an organisation's representative and
//!   beneficial owners) — see [`payer_subjects`];
//! * the bank the lead will be paid from (`lead_bank`, owner decision
//!   2026-10-11): the bank named in the payment route of the declaration
//!   (`bank_name`, with the account country as its country), whoever answered
//!   it — the patient in the cabinet, a paying parent, the third-party payer
//!   through its own link or staff. Screened against list entities only with
//!   [`SanctionsIndex::screen_bank`](super::matching::SanctionsIndex::screen_bank);
//!   `patient-bank` while the patient pays, `payer-bank` while a third party
//!   pays — see [`bank_subjects`];
//! * the invoice recipient (`lead_recipient`, owner decision 2026-10-11): a
//!   third party — a person or an organisation — the lead named in step 3
//!   of the cabinet (`lead_invoice_recipients`) that does not pay. A
//!   recipient who pays is the third-party payer and screened as such
//!   (`lead_payer`), never twice — see [`recipient_subjects`];
//! * patients (`patient`) that are active or inactive. Prospective patients
//!   are covered by their lead.
//!
//! Not screened (owner decisions 2026-10-12 and 2026-10-14): the persons and
//! institutions the person names in the cabinet as trusted persons
//! (`leads.portal_trusted_persons`, the menu item «Vertrauenspersonen») and
//! as recipients of the consent form (`consent_form_choices.recipients`,
//! `crate::consent_choices`).
//! * the relations of such a patient that pay or receive the invoices
//!   (`patient_relation`, QA 2026-10-11 B-25): the default payer, a relation
//!   an order or an invoice names as payer, and the parents and guardians of
//!   a minor patient (the contracting party and default invoice recipient) —
//!   see [`relation_subjects`]. The hit belongs to the patient.
//! * a free-text payer contact of an order or an invoice (`payer_contact`,
//!   `payer_contact_name`, not a relation, 2026-10-12): owned by the patient
//!   of an active or inactive patient's order or invoice, by the lead for an
//!   order of a lead whose patient is still prospective — see
//!   [`payer_contact_subjects`].
//!
//! Every subject but a bank counts for the blocked-country policy
//! ([`SubjectRecord::countries`]).
//!
//! Triggers: database triggers queue a lead or patient whenever a screened
//! field changes (any writer: wizard, public intake, patient portal, the
//! patient card's relations, the payer of an order or an invoice); the worker
//! in [`spawn_screening_worker`] screens the queue. A new list version
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
    /// The bank of the lead's payment route.
    LeadBank,
    /// A third-party invoice recipient who does not pay.
    LeadRecipient,
    Patient,
    /// A relation of a patient who pays or receives the patient's invoices.
    PatientRelation,
    /// A free-text payer contact of an order or an invoice (not a relation),
    /// of a patient or of a lead.
    PayerContact,
}

impl SubjectKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LeadPatient => "lead_patient",
            Self::LeadGuardian => "lead_guardian",
            Self::LeadPayer => "lead_payer",
            Self::LeadBank => "lead_bank",
            Self::LeadRecipient => "lead_recipient",
            Self::Patient => "patient",
            Self::PatientRelation => "patient_relation",
            Self::PayerContact => "payer_contact",
        }
    }
}

/// `relation` of a payer contact subject.
pub const PAYER_CONTACT_RELATION: &str = "payer_contact";
/// `subject_ref` of a payer contact: this prefix and 16 hex characters of the
/// hash of the name ([`payer_contact_ref`]); one subject per name and owner.
pub const PAYER_CONTACT_REF_PREFIX: &str = "contact-";

/// `relation` of a relation subject: the patient's default payer
/// (`patient_relations.is_default_payer`).
pub const RELATION_ROLE_DEFAULT_PAYER: &str = "default_payer";
/// `relation` of a relation subject: an order or an invoice of the patient
/// names it as payer (`payer_patient_relation_id`).
pub const RELATION_ROLE_INVOICE_PAYER: &str = "invoice_payer";
/// `relation` of a relation subject: a parent or guardian of a minor patient,
/// the contracting party (§ 1629 BGB) and default invoice recipient.
pub const RELATION_ROLE_LEGAL_REPRESENTATIVE: &str = "legal_representative";

/// `subject_ref` of the invoice recipient (one per lead).
pub const INVOICE_RECIPIENT_REF: &str = "invoice-recipient";
/// `relation` of the invoice recipient in the hit's snapshot.
pub const INVOICE_RECIPIENT_RELATION: &str = "invoice_recipient";

/// `subject_ref` of the bank the patient pays through (the patient or nobody
/// else declared as payer).
pub const PATIENT_BANK_REF: &str = "patient-bank";
/// `subject_ref` of the bank a third party (a paying parent included) pays
/// through.
pub const PAYER_BANK_REF: &str = "payer-bank";

/// One screened person or organisation and whose record it belongs to.
#[derive(Debug, Clone, Serialize)]
pub struct SubjectRecord {
    pub kind: SubjectKind,
    pub lead_id: Option<Uuid>,
    pub patient_id: Option<Uuid>,
    /// Guardian contact id or payer declaration id, the relation id of a
    /// patient's relation, [`payer_contact_ref`] of a payer contact; empty
    /// for the patient.
    pub subject_ref: String,
    pub subject: Subject,
    /// ISO codes of the residence country (country policy only).
    pub residence: Vec<String>,
    /// Relation of a guardian as entered.
    pub relation: Option<String>,
}

impl SubjectRecord {
    /// Citizenships and residence, the countries the country policy checks.
    /// A bank has none: the policy is about people, the account country is
    /// only a hint for the CEO's review. A patient's relation that pays or
    /// receives the invoices and a payer contact count like the lead's payer
    /// and invoice recipient (owner rule 2026-10-11, applied to the patient
    /// side 2026-10-12): their country holds what the patient's own blocked
    /// country holds until the CEO lifts it for the patient.
    pub fn countries(&self) -> Vec<String> {
        if self.kind == SubjectKind::LeadBank {
            return Vec::new();
        }
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

/// The subjects of several leads with batched queries; anonymised and missing
/// leads are left out, and linked representatives never cause per-person reads.
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
    let mut representatives = {
        let mut conn = db.acquire().await?;
        crate::services::lead_guardian_identity::load_many(&mut conn, lead_ids).await?
    };
    let mut recipients = load_recipient_rows(db, lead_ids).await?;
    let mut contacts = load_lead_contact_rows(db, lead_ids).await?;
    let today = crate::app_time::today();
    let mut leads = Vec::with_capacity(rows.len());
    for row in rows {
        let lead_id: Uuid = row.try_get("id")?;
        let payer_rows = payers.remove(&lead_id).unwrap_or_default();
        let representative_rows = representatives.remove(&lead_id).unwrap_or_default();
        let recipient = recipients.remove(&lead_id);
        let contact_rows = contacts.remove(&lead_id).unwrap_or_default();
        if let Some(mut lead) =
            lead_subjects_from_row(&row, &payer_rows, &representative_rows, today)
        {
            lead.subjects
                .extend(recipient_subjects(lead_id, recipient.as_ref(), &payer_rows));
            let contacts =
                payer_contact_subjects(Owner::Lead(lead_id), &contact_rows, &lead.subjects, &[]);
            lead.subjects.extend(contacts);
            leads.push(lead);
        }
    }
    Ok(leads)
}

/// The free-text payer contacts (`payer_contact_name`, with the
/// `payer_address_country`) of the leads' orders whose patient is not
/// screened yet — none, or the prospective patient of an open lead — as JSON
/// rows `{name, country}` by lead. Once the patient is active the patient
/// owns them ([`load_patient_contact_rows`]).
async fn load_lead_contact_rows(
    db: &gmed_db::DbPool,
    lead_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Value>>, sqlx::Error> {
    let rows: Vec<(Uuid, Value)> = sqlx::query_as(
        r#"SELECT o.source_lead_id,
                  jsonb_build_object('name', o.payer_contact_name,
                                     'country', o.payer_address_country,
                                     'organisation', o.payer_contact_is_organisation)
           FROM orders o
           LEFT JOIN patients p ON p.id = o.patient_id
           WHERE o.source_lead_id = ANY($1)
             AND NULLIF(btrim(o.payer_contact_name), '') IS NOT NULL
             AND (p.id IS NULL OR p.lifecycle_status = 'prospective')
           ORDER BY o.created_at, o.id"#,
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

/// The invoice recipients of the leads (`lead_invoice_recipients`, step 3 of
/// the cabinet since 2026-10-11) as JSON rows, by lead.
async fn load_recipient_rows(
    db: &gmed_db::DbPool,
    lead_ids: &[Uuid],
) -> Result<HashMap<Uuid, Value>, sqlx::Error> {
    let rows: Vec<(Uuid, Value)> = sqlx::query_as(
        "SELECT r.lead_id, to_jsonb(r) FROM lead_invoice_recipients r WHERE r.lead_id = ANY($1)",
    )
    .bind(lead_ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().collect())
}

/// The row of a trusted contact among a lead's representative rows.
#[cfg(test)]
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
    representatives: &[crate::services::lead_guardian_identity::CanonicalGuardianIdentity],
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

    if crate::routes::leads::is_minor_on(date_of_birth, today) {
        for identity in representatives {
            let contact = &identity.contact;
            let relation = json_text(contact, "relation");
            if !is_guardian_relation(&relation) {
                continue;
            }
            // What the parent entered in the cabinet; a row of an adult role
            // (from before a corrected date of birth) says nothing here.
            let extras = (identity.role == "legal_representative").then_some(&identity.extras);
            subjects.push(guardian_subject(
                lead_id,
                identity.position,
                contact,
                extras,
                relation,
            ));
        }
    } else {
        // An adult's contacts are not screened — but for the representative
        // and the legal guardian (Betreuer) the lead named in the cabinet.
        for identity in representatives {
            let contact = &identity.contact;
            let role = &identity.role;
            if role == "authorised_representative" || role == "legal_guardian" {
                subjects.push(guardian_subject(
                    lead_id,
                    identity.position,
                    contact,
                    Some(&identity.extras),
                    role.clone(),
                ));
            }
        }
    }

    subjects.extend(payer_subjects(lead_id, payer_rows));
    subjects.extend(bank_subjects(lead_id, payer_rows));

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

/// The bank of the payment route among a lead's declarations (owner decision
/// 2026-10-11, after the compliance consultant's note that the EU list names
/// banks as well).
///
/// Section 8 of the declaration is one payment route per lead, whoever
/// answered it: the patient in the cabinet, a paying parent in the own login,
/// the third-party payer through its own link (written to the same columns)
/// or staff. A non-empty `bank_name` is a subject of its own: an organisation
/// by its name (in `last_name`, like an organisation payer), with the
/// `account_country` as its country — shown to the CEO, never part of the
/// country policy ([`SubjectRecord::countries`]). The reference says whose
/// payment it is: [`PAYER_BANK_REF`] while a third party pays,
/// [`PATIENT_BANK_REF`] otherwise; the risk assessment counts a confirmed hit
/// for that subject (T16; an open one only holds).
pub fn bank_subjects(lead_id: Uuid, rows: &[Value]) -> Vec<SubjectRecord> {
    let mut subjects = Vec::new();
    for row in rows {
        let bank_name = json_text(row, "bank_name");
        if bank_name.is_empty() {
            continue;
        }
        let third_party = json_text(row, "payer_kind") == "third_party";
        let (subject_ref, relation) = if third_party {
            (PAYER_BANK_REF, "payer_bank")
        } else {
            (PATIENT_BANK_REF, "patient_bank")
        };
        if subjects
            .iter()
            .any(|record: &SubjectRecord| record.subject_ref == subject_ref)
        {
            continue;
        }
        subjects.push(SubjectRecord {
            kind: SubjectKind::LeadBank,
            lead_id: Some(lead_id),
            patient_id: None,
            subject_ref: subject_ref.to_string(),
            subject: Subject {
                first_name: String::new(),
                middle_name: None,
                last_name: bank_name,
                date_of_birth: None,
                citizenships: Vec::new(),
                organisation: true,
            },
            residence: json_codes(row, "account_country"),
            relation: Some(relation.to_string()),
        });
    }
    subjects
}

/// The invoice recipient of a lead as a subject (owner decision 2026-10-11):
/// a third party (`recipient = 'third_party'`) the lead named in step 3 of
/// the cabinet, while it does not pay.
///
/// A recipient pays by the server's own rule
/// ([`SectionSeven::of_recipient`](crate::routes::lead_invoice_recipient::SectionSeven::of_recipient)):
/// the box "Der Rechnungsempfänger ist auch der Zahler" is ticked (the default
/// once a recipient is chosen) and
/// the declaration names a third party as payer. That recipient is the payer
/// and screened as `lead_payer`; it is no subject here, so nobody is reviewed
/// twice. Until a third party is declared as payer (or with "nein", or before
/// the answer) the recipient is a subject of its own.
///
/// An organisation (`recipient_type = 'organisation'`) is screened against
/// the listed entities by its name — in `last_name`, like an organisation
/// payer — with its seat as residence. A person is screened by first and last
/// name with the country of the address as residence (the cabinet asks no
/// birth date or citizenship of a recipient). A row without a type is a
/// person when it holds a last name, otherwise an organisation by its name.
/// One subject per lead under [`INVOICE_RECIPIENT_REF`].
pub fn recipient_subjects(
    lead_id: Uuid,
    recipient: Option<&Value>,
    payer_rows: &[Value],
) -> Vec<SubjectRecord> {
    use crate::routes::lead_invoice_recipient::{
        RECIPIENT_THIRD_PARTY, RECIPIENT_TYPE_ORGANISATION, RECIPIENT_TYPE_PERSON,
    };
    let Some(row) = recipient else {
        return Vec::new();
    };
    if json_text(row, "recipient") != RECIPIENT_THIRD_PARTY {
        return Vec::new();
    }
    let answered_pays = row.get("recipient_is_payer").and_then(Value::as_bool) == Some(true);
    let recipient_organisation = json_text(row, "recipient_type") == RECIPIENT_TYPE_ORGANISATION;
    let recipient_name = if recipient_organisation {
        json_text(row, "organisation_name")
    } else {
        format!(
            "{} {}",
            json_text(row, "first_name"),
            json_text(row, "last_name")
        )
    };
    let third_party_payer = payer_rows.iter().any(|payer| {
        let payer_type = json_text(payer, "payer_type");
        let organisation = matches!(
            payer_type.as_str(),
            "company" | "organisation" | "insurance"
        );
        let payer_name = if organisation {
            json_text(payer, "organisation_name")
        } else {
            format!(
                "{} {}",
                json_text(payer, "first_name"),
                json_text(payer, "last_name")
            )
        };
        json_text(payer, "payer_kind") == "third_party"
            && !json_text(row, "recipient_type").is_empty()
            && recipient_organisation == organisation
            && !recipient_name.trim().is_empty()
            && (recipient_organisation
                || (!json_text(row, "first_name").is_empty()
                    && !json_text(row, "last_name").is_empty()))
            && crate::routes::lead_invoice_recipient::same_name(&recipient_name, &payer_name)
    });
    if answered_pays && third_party_payer {
        return Vec::new();
    }
    let recipient_type = json_text(row, "recipient_type");
    let last_name = json_text(row, "last_name");
    let organisation = recipient_type == RECIPIENT_TYPE_ORGANISATION
        || (recipient_type != RECIPIENT_TYPE_PERSON && last_name.is_empty());
    let subject = if organisation {
        Subject {
            first_name: String::new(),
            middle_name: None,
            last_name: json_text(row, "organisation_name"),
            date_of_birth: None,
            citizenships: Vec::new(),
            organisation: true,
        }
    } else {
        Subject {
            first_name: json_text(row, "first_name"),
            middle_name: None,
            last_name,
            date_of_birth: None,
            citizenships: Vec::new(),
            organisation: false,
        }
    };
    vec![SubjectRecord {
        kind: SubjectKind::LeadRecipient,
        lead_id: Some(lead_id),
        patient_id: None,
        subject_ref: INVOICE_RECIPIENT_REF.to_string(),
        subject,
        residence: json_codes(row, "country"),
        relation: Some(INVOICE_RECIPIENT_RELATION.to_string()),
    }]
}

/// Possible matches of one subject: a bank against the listed entities by
/// the distinctive words of its name, everybody else by the person or
/// organisation matcher.
pub fn screen_subject(
    index: &super::matching::SanctionsIndex,
    record: &SubjectRecord,
) -> Vec<Match> {
    if record.kind == SubjectKind::LeadBank {
        index.screen_bank(&record.subject)
    } else {
        index.screen(&record.subject)
    }
}

/// A patient row as a subject; `None` for prospective, deleted or anonymised
/// records.
fn patient_subject_from_row(row: &sqlx::postgres::PgRow) -> Option<SubjectRecord> {
    let patient_id: Uuid = row.try_get("id").ok()?;
    let lifecycle = text(row, "lifecycle_status");
    let anonymized: bool = row
        .try_get::<Option<bool>, _>("anonymized")
        .unwrap_or(None)
        .unwrap_or(false);
    if anonymized || matches!(lifecycle.as_str(), "prospective" | "deleted") {
        return None;
    }
    let mut citizenships = iso_codes(
        &row.try_get::<Vec<String>, _>("citizenships")
            .unwrap_or_default(),
    );
    if let Some(code) = country_code(&text(row, "nationality"))
        && !citizenships.contains(&code)
    {
        citizenships.push(code);
    }
    let residence = iso_codes(&[text(row, "residence_country"), text(row, "address_country")]);
    Some(SubjectRecord {
        kind: SubjectKind::Patient,
        lead_id: None,
        patient_id: Some(patient_id),
        subject_ref: String::new(),
        subject: Subject {
            first_name: text(row, "first_name"),
            middle_name: None,
            last_name: text(row, "last_name"),
            date_of_birth: row.try_get("birth_date").unwrap_or(None),
            citizenships,
            organisation: false,
        },
        residence,
        relation: None,
    })
}

/// A patient as a subject; `None` for missing, prospective, deleted or
/// anonymised records.
pub async fn load_patient_subject(
    db: &gmed_db::DbPool,
    patient_id: Uuid,
) -> Result<Option<SubjectRecord>, sqlx::Error> {
    let row = sqlx::query(PATIENT_SUBJECT_SELECT)
        .bind(vec![patient_id])
        .fetch_optional(db)
        .await?;
    Ok(row.as_ref().and_then(patient_subject_from_row))
}

const PATIENT_SUBJECT_SELECT: &str = r#"
    SELECT id, first_name, last_name, birth_date, citizenships, nationality,
           residence_country, address_country, lifecycle_status,
           legal_status ? 'anonymized_at' AS anonymized
    FROM patients
    WHERE id = ANY($1)"#;

/// The subjects of a patient ([`load_patients_subjects`]).
pub async fn load_patient_subjects(
    db: &gmed_db::DbPool,
    patient_id: Uuid,
) -> Result<Vec<SubjectRecord>, sqlx::Error> {
    Ok(load_patients_subjects(db, &[patient_id])
        .await?
        .remove(&patient_id)
        .unwrap_or_default())
}

/// The subjects of several patients by patient: the patient
/// ([`patient_subject_from_row`]), the relations that pay or receive the
/// invoices ([`relation_subjects`]) and the free-text payer contacts of its
/// orders and invoices ([`payer_contact_subjects`]). Missing, prospective,
/// deleted or anonymised records are left out — the relations and contacts
/// of a patient that is not screened are not screened either.
pub async fn load_patients_subjects(
    db: &gmed_db::DbPool,
    patient_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<SubjectRecord>>, sqlx::Error> {
    let mut by_patient: HashMap<Uuid, Vec<SubjectRecord>> = HashMap::new();
    if patient_ids.is_empty() {
        return Ok(by_patient);
    }
    let patients: Vec<SubjectRecord> = sqlx::query(PATIENT_SUBJECT_SELECT)
        .bind(patient_ids)
        .fetch_all(db)
        .await?
        .iter()
        .filter_map(patient_subject_from_row)
        .collect();
    let screened: Vec<Uuid> = patients
        .iter()
        .filter_map(|patient| patient.patient_id)
        .collect();
    if screened.is_empty() {
        return Ok(by_patient);
    }
    let mut relations = load_relation_rows(db, &screened).await?;
    let mut contacts = load_patient_contact_rows(db, &screened).await?;
    let with_contacts: Vec<Uuid> = contacts.keys().copied().collect();
    let declared = load_declared_payers(db, &with_contacts).await?;
    let today = crate::app_time::today();
    for patient in patients {
        let Some(patient_id) = patient.patient_id else {
            continue;
        };
        let relation_rows = relations.remove(&patient_id).unwrap_or_default();
        let birth_date = patient.subject.date_of_birth;
        let mut subjects = vec![patient];
        subjects.extend(relation_subjects(
            patient_id,
            birth_date,
            &relation_rows,
            today,
        ));
        let contact_rows = contacts.remove(&patient_id).unwrap_or_default();
        let contact_records = payer_contact_subjects(
            Owner::Patient(patient_id),
            &contact_rows,
            &subjects,
            declared.get(&patient_id).map(Vec::as_slice).unwrap_or(&[]),
        );
        subjects.extend(contact_records);
        by_patient.insert(patient_id, subjects);
    }
    Ok(by_patient)
}

/// The relations of the patients as JSON rows for [`relation_subjects`], by
/// patient: the relation's own columns, whether an order or an invoice names
/// it as payer (`names_payer`) and the patient record it is linked to
/// (`linked`, `null` for a separate contact).
async fn load_relation_rows(
    db: &gmed_db::DbPool,
    patient_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Value>>, sqlx::Error> {
    let rows: Vec<(Uuid, Value)> = sqlx::query_as(
        r#"SELECT r.patient_id,
                  jsonb_build_object(
                      'id', r.id,
                      'related_name', r.related_name,
                      'notes', r.notes,
                      'relation_type', r.relation_type,
                      'address_country', r.address_country,
                      'is_default_payer', r.is_default_payer,
                      'is_organisation', r.is_organisation,
                      'names_payer',
                          EXISTS (SELECT 1 FROM orders o
                                  WHERE o.payer_patient_relation_id = r.id)
                          OR EXISTS (SELECT 1 FROM invoices i
                                     WHERE i.payer_patient_relation_id = r.id),
                      'linked', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
                          'first_name', p.first_name,
                          'last_name', p.last_name,
                          'birth_date', p.birth_date,
                          'citizenships', to_jsonb(p.citizenships),
                          'nationality', p.nationality,
                          'residence_country', p.residence_country,
                          'address_country', p.address_country
                      ) END
                  )
           FROM patient_relations r
           LEFT JOIN patients p ON p.id = r.related_patient_id
           WHERE r.patient_id = ANY($1)
           ORDER BY r.created_at, r.id"#,
    )
    .bind(patient_ids)
    .fetch_all(db)
    .await?;
    let mut by_patient: HashMap<Uuid, Vec<Value>> = HashMap::new();
    for (patient_id, row) in rows {
        by_patient.entry(patient_id).or_default().push(row);
    }
    Ok(by_patient)
}

/// The free-text payer contacts of the patients' orders and invoices
/// (`payer_contact_name` with the `payer_address_country` and the
/// organisation box `payer_contact_is_organisation`) as JSON rows
/// `{name, country, organisation}` by patient, orders first, oldest first.
/// Every order and invoice counts, whatever its status, like a relation an
/// order names as payer.
async fn load_patient_contact_rows(
    db: &gmed_db::DbPool,
    patient_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Value>>, sqlx::Error> {
    let rows: Vec<(Uuid, Value)> = sqlx::query_as(
        r#"SELECT patient_id, contact FROM (
               SELECT o.patient_id, 0 AS source, o.created_at, o.id,
                      jsonb_build_object('name', o.payer_contact_name,
                                         'country', o.payer_address_country,
                                         'organisation', o.payer_contact_is_organisation)
                          AS contact
               FROM orders o
               WHERE o.patient_id = ANY($1)
                 AND NULLIF(btrim(o.payer_contact_name), '') IS NOT NULL
               UNION ALL
               SELECT i.patient_id, 1 AS source, i.created_at, i.id,
                      jsonb_build_object('name', i.payer_contact_name,
                                         'country', i.payer_address_country,
                                         'organisation', i.payer_contact_is_organisation)
               FROM invoices i
               WHERE i.patient_id = ANY($1)
                 AND NULLIF(btrim(i.payer_contact_name), '') IS NOT NULL
           ) contacts
           ORDER BY source, created_at, id"#,
    )
    .bind(patient_ids)
    .fetch_all(db)
    .await?;
    let mut by_patient: HashMap<Uuid, Vec<Value>> = HashMap::new();
    for (patient_id, row) in rows {
        by_patient.entry(patient_id).or_default().push(row);
    }
    Ok(by_patient)
}

/// The third-party payers and invoice recipients the patients' leads declared
/// (`lead_payer`, `lead_recipient` of a lead converted into the patient or
/// whose prospective patient it is), by patient. The lead's payer declaration
/// writes its payer onto the lead's orders as a free-text contact
/// (`routes::lead_payer::sync_order_payers`); such a contact is screened with
/// what the lead declared about it ([`payer_contact_subjects`]).
async fn load_declared_payers(
    db: &gmed_db::DbPool,
    patient_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<SubjectRecord>>, sqlx::Error> {
    let mut by_patient: HashMap<Uuid, Vec<SubjectRecord>> = HashMap::new();
    if patient_ids.is_empty() {
        return Ok(by_patient);
    }
    let leads: Vec<(Uuid, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        r#"SELECT id, converted_patient_id, prospect_patient_id
           FROM leads
           WHERE converted_patient_id = ANY($1) OR prospect_patient_id = ANY($1)"#,
    )
    .bind(patient_ids)
    .fetch_all(db)
    .await?;
    if leads.is_empty() {
        return Ok(by_patient);
    }
    let lead_ids: Vec<Uuid> = leads.iter().map(|(id, _, _)| *id).collect();
    for lead in load_leads_subjects(db, &lead_ids).await? {
        let declared: Vec<SubjectRecord> = lead
            .subjects
            .into_iter()
            .filter(|record| {
                matches!(
                    record.kind,
                    SubjectKind::LeadPayer | SubjectKind::LeadRecipient
                )
            })
            .collect();
        let mut owners: Vec<Uuid> = Vec::new();
        for patient_id in [lead.converted_patient_id, lead.prospect_patient_id]
            .into_iter()
            .flatten()
        {
            if patient_ids.contains(&patient_id) && !owners.contains(&patient_id) {
                owners.push(patient_id);
            }
        }
        for patient_id in owners {
            by_patient
                .entry(patient_id)
                .or_default()
                .extend(declared.iter().cloned());
        }
    }
    Ok(by_patient)
}

/// Legal forms that make a separate contact's name an organisation's. Only
/// words no person's name consists of: no `ko`, `sa` or `ao`, which are also
/// names, and compared as written (lower case), not in the canonical form
/// that folds `ООО` into an initial `O`.
const ORGANISATION_LEGAL_FORMS: &[&str] = &[
    "gmbh", "mbh", "ag", "kg", "kgaa", "ohg", "ug", "llc", "ltd", "limited", "inc", "corp", "plc",
    "llp", "jsc", "pjsc", "ojsc", "cjsc", "ooo", "oao", "zao", "pao", "sarl", "srl", "spa", "bv",
    "nv", "fze", "ооо", "оао", "зао", "пао", "тов", "пат",
];

/// Institutions that are organisations without a legal form in the name:
/// banks, savings banks, insurers and foundations (QA 2026-10-12: «Testgrad
/// Commerce Bank» was taken for a person). Whole words, or the end of a
/// compound ("Commerzbank", "Kreissparkasse", "Сбербанк"). Kept in step with
/// `relationNameSuggestsOrganisation` (frontend
/// `pages/patients/model/sheet-forms.ts`).
const ORGANISATION_WORDS: &[&str] = &[
    "bank",
    "banque",
    "banca",
    "banco",
    "bankhaus",
    "sparkasse",
    "versicherung",
    "insurance",
    "assurance",
    "krankenkasse",
    "stiftung",
    "foundation",
    "банк",
    "фонд",
    "страховая",
    "страхова",
];
const ORGANISATION_WORD_ENDINGS: &[&str] =
    &["bank", "sparkasse", "versicherung", "stiftung", "банк"];

/// Whether a contact's name carries a legal form ([`ORGANISATION_LEGAL_FORMS`])
/// or names an institution ([`ORGANISATION_WORDS`]).
fn names_an_organisation(name: &str) -> bool {
    name.split(|ch: char| !ch.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .any(|word| {
            let word = word.to_lowercase();
            ORGANISATION_LEGAL_FORMS.contains(&word.as_str())
                || ORGANISATION_WORDS.contains(&word.as_str())
                || ORGANISATION_WORD_ENDINGS.iter().any(|ending| {
                    word.chars().count() > ending.chars().count() && word.ends_with(ending)
                })
        })
}

/// The birth date in a relation's notes: the lead conversion writes a trusted
/// contact's birth date there as `Geburtsdatum: 1985-03-02`
/// (`routes::leads`), staff may write `Geburtsdatum: 02.03.1985`.
fn notes_birth_date(notes: &str) -> Option<NaiveDate> {
    const LABEL: &str = "geburtsdatum:";
    notes.lines().find_map(|line| {
        let line = line.trim();
        if !line.get(..LABEL.len())?.eq_ignore_ascii_case(LABEL) {
            return None;
        }
        let value = line[LABEL.len()..].trim();
        let head = value.get(..10).unwrap_or(value);
        NaiveDate::parse_from_str(head, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(head, "%d.%m.%Y"))
            .ok()
    })
}

/// A separate contact by its name as staff entered it (the relation has no
/// citizenship; a birth date only in its notes, [`notes_birth_date`]): a
/// person by given names and the last word, an organisation by the whole
/// name.
///
/// `organisation` is the box "Организация" of the relation dialog
/// (`patient_relations.is_organisation`) or of the order and invoice payer
/// dialogs (`payer_contact_is_organisation`, 2026-10-12): ticked, an
/// organisation; not ticked, a person. A single word is screened as an
/// organisation all the same, since a person needs a given name to be
/// screened (like a payer without a first name). Without an answer (`None`:
/// rows from before the box, relations written by the patient creation or
/// the lead conversion) the name decides: a legal form
/// ([`ORGANISATION_LEGAL_FORMS`]) or a single word make it an organisation.
fn contact_subject(
    name: &str,
    date_of_birth: Option<NaiveDate>,
    organisation: Option<bool>,
) -> Subject {
    let whole = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let (first_name, last_name) = split_full_name(&whole);
    let organisation = match organisation {
        Some(true) => true,
        Some(false) => first_name.is_empty(),
        None => first_name.is_empty() || names_an_organisation(&whole),
    };
    if organisation {
        Subject {
            first_name: String::new(),
            middle_name: None,
            last_name: whole,
            date_of_birth: None,
            citizenships: Vec::new(),
            organisation: true,
        }
    } else {
        Subject {
            first_name,
            middle_name: None,
            last_name,
            date_of_birth,
            citizenships: Vec::new(),
            organisation: false,
        }
    }
}

/// Whether a separate contact without an answer to the organisation box is
/// screened as an organisation ([`contact_subject`]): what the relation
/// dialog shows for such a row until staff save it.
pub fn contact_name_is_organisation(name: &str) -> bool {
    contact_subject(name, None, None).organisation
}

/// The relations of a patient that are screened (QA 2026-10-11 B-25: a
/// relation marked "Оплачивает счета пациента по умолчанию" became the invoice
/// recipient without screening), in this order of precedence for the role in
/// `relation`:
///
/// * the default payer (`is_default_payer`, [`RELATION_ROLE_DEFAULT_PAYER`]),
///   who receives the patient's invoices unless an order names another payer;
/// * a relation an order or an invoice of the patient names as payer
///   (`names_payer`, [`RELATION_ROLE_INVOICE_PAYER`]);
/// * for a minor patient (Europe/Berlin), every `parent` and `guardian`
///   relation ([`RELATION_ROLE_LEGAL_REPRESENTATIVE`]): the contracting party
///   and the default invoice recipient of a minor
///   (`services::contracting_party`), as the lead screens a minor's parents.
///
/// Other relations (an adult's spouse, a friend, an emergency contact) are no
/// subjects. A relation linked to a patient record (`linked`) is screened with
/// that record's name, birth date and citizenships — the name an invoice
/// carries — a separate contact by its name, the birth date in its notes and
/// the organisation box (`is_organisation`, [`contact_subject`]). The
/// residence is the relation's address country (where its invoices go), then
/// the linked record's countries; with the citizenships they count for the
/// blocked-country policy ([`SubjectRecord::countries`]). One subject per
/// relation, the relation id as `subject_ref`; the hit belongs to the
/// patient.
pub fn relation_subjects(
    patient_id: Uuid,
    patient_birth_date: Option<NaiveDate>,
    rows: &[Value],
    today: NaiveDate,
) -> Vec<SubjectRecord> {
    let minor = crate::routes::leads::is_minor_on(patient_birth_date, today);
    let mut subjects = Vec::new();
    for row in rows {
        let relation_id = json_text(row, "id").to_lowercase();
        if relation_id.is_empty() {
            continue;
        }
        let flag = |key: &str| row.get(key).and_then(Value::as_bool) == Some(true);
        let role = if flag("is_default_payer") {
            RELATION_ROLE_DEFAULT_PAYER
        } else if flag("names_payer") {
            RELATION_ROLE_INVOICE_PAYER
        } else if minor
            && matches!(
                json_text(row, "relation_type").as_str(),
                "parent" | "guardian"
            )
        {
            RELATION_ROLE_LEGAL_REPRESENTATIVE
        } else {
            continue;
        };
        let mut residence = json_codes(row, "address_country");
        let subject = match row.get("linked").filter(|linked| linked.is_object()) {
            Some(linked) => {
                let mut citizenships = json_codes(linked, "citizenships");
                for code in json_codes(linked, "nationality") {
                    if !citizenships.contains(&code) {
                        citizenships.push(code);
                    }
                }
                for code in json_codes(linked, "residence_country")
                    .into_iter()
                    .chain(json_codes(linked, "address_country"))
                {
                    if !residence.contains(&code) {
                        residence.push(code);
                    }
                }
                Subject {
                    first_name: json_text(linked, "first_name"),
                    middle_name: None,
                    last_name: json_text(linked, "last_name"),
                    date_of_birth: json_date(linked, "birth_date"),
                    citizenships,
                    organisation: false,
                }
            }
            None => contact_subject(
                &json_text(row, "related_name"),
                notes_birth_date(&json_text(row, "notes")),
                row.get("is_organisation").and_then(Value::as_bool),
            ),
        };
        subjects.push(SubjectRecord {
            kind: SubjectKind::PatientRelation,
            lead_id: None,
            patient_id: Some(patient_id),
            subject_ref: relation_id,
            subject,
            residence,
            relation: Some(role.to_string()),
        });
    }
    subjects
}

/// The canonical name tokens of a subject, sorted: two subjects with the same
/// key are the same name, whatever the spelling noise, the word order or the
/// split into first and last name.
fn name_key(subject: &Subject) -> Vec<String> {
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
    tokens
}

/// `subject_ref` of a payer contact with the name key `key`
/// ([`PAYER_CONTACT_REF_PREFIX`] and 16 hex characters of its hash).
pub fn payer_contact_ref(key: &[String]) -> String {
    let digest = hex::encode(Sha256::digest(key.join(" ").as_bytes()));
    format!("{PAYER_CONTACT_REF_PREFIX}{}", &digest[..16])
}

/// The free-text payer contacts of an owner's orders and invoices
/// (`payer_contact_name`, a payer who is no relation; rows
/// `{name, country, organisation}`) as subjects of the owner, 2026-10-12.
///
/// * One subject per name ([`name_key`], [`payer_contact_ref`]): the same
///   contact on an order and its invoices is reviewed once; the countries of
///   all of them (`payer_address_country`) are its residence and count for
///   the blocked-country policy.
/// * A contact with the name of another subject of the owner (`known`: the
///   patient or the lead's patient, a relation, the lead's payer or invoice
///   recipient) is that subject and not screened twice — the lead's payer
///   declaration writes its payer onto the lead's orders as such a contact.
/// * A patient's contact with the name of a payer or invoice recipient one of
///   the patient's leads declared (`declared`) is screened with what the lead
///   declared (birth date, citizenships, organisation or person, residence):
///   the same data as the lead's subject, so the CEO's decision on the lead's
///   hit carries over ([`covered_by_lead_hit`]).
/// * Otherwise the contact is screened by its name and the organisation box
///   of the order and invoice payer dialogs (`payer_contact_is_organisation`,
///   [`contact_subject`]). Records of the same name that disagree: a ticked
///   box on any of them makes it an organisation (it is then compared with
///   the listed entities). Without any answer — rows from before the box —
///   the legal form in the name decides.
pub fn payer_contact_subjects(
    owner: Owner,
    rows: &[Value],
    known: &[SubjectRecord],
    declared: &[SubjectRecord],
) -> Vec<SubjectRecord> {
    let (lead_id, patient_id) = match owner {
        Owner::Lead(id) => (Some(id), None),
        Owner::Patient(id) => (None, Some(id)),
    };
    let known_keys: Vec<Vec<String>> = known
        .iter()
        .filter(|record| record.kind != SubjectKind::LeadBank)
        .map(|record| name_key(&record.subject))
        .filter(|key| !key.is_empty())
        .collect();
    /// The records of one contact name.
    struct Contact {
        key: Vec<String>,
        /// The name as first written.
        name: String,
        countries: Vec<String>,
        /// The answer to the organisation box over all records.
        organisation: Option<bool>,
    }
    let mut contacts: Vec<Contact> = Vec::new();
    for row in rows {
        let name = json_text(row, "name");
        let key = name_key(&contact_subject(&name, None, None));
        if key.is_empty() || known_keys.contains(&key) {
            continue;
        }
        let countries = json_codes(row, "country");
        let answer = row.get("organisation").and_then(Value::as_bool);
        let index = match contacts.iter().position(|contact| contact.key == key) {
            Some(index) => index,
            None => {
                contacts.push(Contact {
                    key,
                    name,
                    countries: Vec::new(),
                    organisation: None,
                });
                contacts.len() - 1
            }
        };
        let contact = &mut contacts[index];
        for code in countries {
            if !contact.countries.contains(&code) {
                contact.countries.push(code);
            }
        }
        contact.organisation = match (contact.organisation, answer) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), _) | (_, Some(false)) => Some(false),
            (None, None) => None,
        };
    }
    contacts
        .into_iter()
        .map(|contact| {
            let (subject, mut residence) = match declared
                .iter()
                .find(|record| name_key(&record.subject) == contact.key)
            {
                Some(record) => (record.subject.clone(), record.residence.clone()),
                None => (
                    contact_subject(&contact.name, None, contact.organisation),
                    Vec::new(),
                ),
            };
            for code in contact.countries {
                if !residence.contains(&code) {
                    residence.push(code);
                }
            }
            SubjectRecord {
                kind: SubjectKind::PayerContact,
                lead_id,
                patient_id,
                subject_ref: payer_contact_ref(&contact.key),
                subject,
                residence,
                relation: Some(PAYER_CONTACT_RELATION.to_string()),
            }
        })
        .collect()
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
    let report = screen_owner(state, &index, Owner::Lead(lead_id), subjects).await?;
    // The risk assessment follows the stored data; a new open hit is no
    // trigger (only a confirmed one is T16), it holds through the gate.
    let mut tx = state.db.begin().await?;
    crate::risk::store::reassess(&mut tx, lead_id, crate::risk::store::Cause::Screening, None)
        .await?;
    tx.commit().await?;
    Ok(report)
}

/// Screens a patient, the relations that pay or receive its invoices and the
/// payer contacts of its orders and invoices ([`load_patient_subjects`]) and
/// stores their possible matches.
pub async fn screen_patient(
    state: &AppState,
    patient_id: Uuid,
) -> Result<ScreenReport, sqlx::Error> {
    let Some(index) = store::active_index(&state.db).await? else {
        return Ok(ScreenReport::default());
    };
    let subjects = load_patient_subjects(&state.db, patient_id).await?;
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
                let matches = screen_subject(&index, &record)
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

/// A hit of one of a patient's leads (converted into the patient or with the
/// patient as prospect).
#[derive(Debug, Clone)]
pub struct LeadHit {
    pub kind: String,
    pub logical_id: String,
    pub subject_fingerprint: String,
    pub entry_fingerprint: String,
    pub status: String,
}

/// Whether a match of a patient's subject is already a hit of one of the
/// patient's leads, so no hit of the patient is created:
///
/// * the patient keeps the CEO's false-positive decisions about the lead's
///   patient (`lead_patient`) as long as the data are the same;
/// * a payer contact ([`payer_contact_subjects`]) that is the lead's payer,
///   invoice recipient or payer contact with the same data is covered by the
///   lead's hit: a false positive as long as the data are the same, an open
///   or confirmed hit because it holds the patient through the gate already
///   (`gate::Scope::expand`) — the CEO reviews one person once.
///
/// The lead's decisions are never about a relation that happens to carry the
/// same data.
pub fn covered_by_lead_hit(
    kind: SubjectKind,
    logical_id: &str,
    subject_fingerprint: &str,
    entry_fingerprint: &str,
    lead_hits: &[LeadHit],
) -> bool {
    let kinds: &[&str] = match kind {
        SubjectKind::Patient => &["lead_patient"],
        SubjectKind::PayerContact => &["lead_payer", "lead_recipient", "payer_contact"],
        _ => return false,
    };
    lead_hits.iter().any(|hit| {
        kinds.contains(&hit.kind.as_str())
            && hit.logical_id == logical_id
            && hit.subject_fingerprint == subject_fingerprint
            && match hit.status.as_str() {
                "false_positive" => hit.entry_fingerprint == entry_fingerprint,
                "open" | "confirmed" => kind == SubjectKind::PayerContact,
                _ => false,
            }
    })
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

    // The hits of the patient's leads: what the CEO decided (or still
    // reviews) about the lead's subjects carries over (`covered_by_lead_hit`).
    let lead_hits: Vec<LeadHit> = match owner {
        Owner::Patient(patient_id) => {
            sqlx::query_as::<_, (String, String, String, String, String)>(
                r#"SELECT h.subject_kind, h.list_logical_id, h.subject_fingerprint,
                          h.entry_fingerprint, h.status
                   FROM sanctions_hits h
                   JOIN leads l ON l.id = h.lead_id
                   WHERE l.converted_patient_id = $1 OR l.prospect_patient_id = $1"#,
            )
            .bind(patient_id)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(
                |(kind, logical_id, subject_fingerprint, entry_fingerprint, status)| LeadHit {
                    kind,
                    logical_id,
                    subject_fingerprint,
                    entry_fingerprint,
                    status,
                },
            )
            .collect()
        }
        Owner::Lead(_) => Vec::new(),
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
            if covered_by_lead_hit(
                record.kind,
                &entry.logical_id,
                &subject_fp,
                &entry_fp,
                &lead_hits,
            ) {
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

/// Screens every open lead and every active or inactive patient (with the
/// relations that pay or receive its invoices and the payer contacts of its
/// orders and invoices) again, after a new list version.
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

/// Removes the screening results of patient relations deleted with the
/// person they named (the erasure of a patient removes other patients'
/// relations linked to the erased record), with their notifications.
pub async fn purge_for_relations_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    relation_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    if relation_ids.is_empty() {
        return Ok(());
    }
    let subject_refs: Vec<String> = relation_ids.iter().map(Uuid::to_string).collect();
    sqlx::query(
        r#"DELETE FROM user_notifications
           WHERE entity_type = $2
             AND entity_id IN (
                 SELECT h.id FROM sanctions_hits h
                 WHERE h.subject_kind = 'patient_relation' AND h.subject_ref = ANY($1)
             )"#,
    )
    .bind(&subject_refs)
    .bind(HIT_ENTITY_TYPE)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "DELETE FROM sanctions_hits WHERE subject_kind = 'patient_relation' AND subject_ref = ANY($1)",
    )
    .bind(&subject_refs)
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
    fn the_bank_of_the_payment_route_is_an_organisation_subject_of_whoever_pays() {
        let lead_id = Uuid::new_v4();
        // The patient pays: the patient's bank, the account country as hint.
        let own = bank_subjects(
            lead_id,
            &[json!({
                "payer_kind": "self",
                "payment_method": "bank_transfer",
                "bank_name": " Testgrad Commerce Bank ",
                "account_country": "RU",
            })],
        );
        assert_eq!(own.len(), 1);
        let bank = &own[0];
        assert_eq!(bank.kind, SubjectKind::LeadBank);
        assert_eq!(bank.kind.as_str(), "lead_bank");
        assert_eq!(bank.lead_id, Some(lead_id));
        assert_eq!(bank.subject_ref, PATIENT_BANK_REF);
        assert_eq!(bank.relation.as_deref(), Some("patient_bank"));
        assert!(bank.subject.organisation);
        assert_eq!(bank.subject.first_name, "");
        assert_eq!(bank.subject.last_name, "Testgrad Commerce Bank");
        assert_eq!(bank.residence, ["RU"]);
        // The account country is no citizenship or residence of a person.
        assert!(bank.countries().is_empty());
        assert_eq!(bank.snapshot()["organisation"], true);

        // A third party (a paying parent included) pays: the payer's bank.
        let payer = bank_subjects(
            lead_id,
            &[json!({
                "payer_kind": "third_party",
                "payer_type": "person",
                "first_name": "Viktor",
                "last_name": "Zahler",
                "bank_name": "Severoprom Bank",
                "account_country": "BY",
                "payer_statement": null,
            })],
        );
        assert_eq!(payer.len(), 1);
        assert_eq!(payer[0].subject_ref, PAYER_BANK_REF);
        assert_eq!(payer[0].relation.as_deref(), Some("payer_bank"));
        // The payer itself stays a subject of its own.
        assert_eq!(
            payer_subjects(
                lead_id,
                &[json!({
                    "payer_kind": "third_party",
                    "first_name": "Viktor",
                    "last_name": "Zahler",
                    "bank_name": "Severoprom Bank",
                })]
            )
            .len(),
            1
        );
        // No bank named, no subject.
        for row in [
            json!({ "payer_kind": "self", "payment_method": "cash" }),
            json!({ "payer_kind": "self", "bank_name": "   " }),
            json!({ "payer_kind": "third_party", "bank_name": null }),
        ] {
            assert!(
                bank_subjects(lead_id, std::slice::from_ref(&row)).is_empty(),
                "{row}"
            );
        }
        assert_ne!(
            subject_fingerprint(&own[0].subject),
            subject_fingerprint(&payer[0].subject)
        );
    }

    #[test]
    fn a_bank_is_screened_by_the_bank_matcher() {
        let index = crate::sanctions::matching::SanctionsIndex::build(
            crate::sanctions::fsf::parse_fsf_xml(include_bytes!(
                "testdata/synthetic_fsf_1_1_banks.xml"
            ))
            .unwrap()
            .entries,
        );
        let lead_id = Uuid::new_v4();
        let record = |name: &str| {
            bank_subjects(
                lead_id,
                &[json!({ "payer_kind": "self", "bank_name": name, "account_country": "DE" })],
            )
            .remove(0)
        };
        assert_eq!(
            screen_subject(&index, &record("Testgrad Commerce Bank")).len(),
            1
        );
        assert!(screen_subject(&index, &record("Deutsche Bank")).is_empty());
        // Word order and the generic word do not matter; the word alone
        // matches nothing.
        let generic = record("Bank Testgrad Commerce");
        assert_eq!(screen_subject(&index, &generic).len(), 1);
        assert!(screen_subject(&index, &record("Bank")).is_empty());
    }

    #[test]
    fn a_third_party_invoice_recipient_who_does_not_pay_is_a_subject_of_its_own() {
        let lead_id = Uuid::new_v4();
        let person = json!({
            "recipient": "third_party",
            "recipient_is_payer": false,
            "recipient_type": "person",
            "first_name": " Mia ",
            "last_name": "Muster",
            "country": "AT",
            "relationship_kind": "employer",
        });
        let subjects = recipient_subjects(lead_id, Some(&person), &[]);
        assert_eq!(subjects.len(), 1);
        let record = &subjects[0];
        assert_eq!(record.kind, SubjectKind::LeadRecipient);
        assert_eq!(record.kind.as_str(), "lead_recipient");
        assert_eq!(record.lead_id, Some(lead_id));
        assert_eq!(record.subject_ref, INVOICE_RECIPIENT_REF);
        assert_eq!(record.relation.as_deref(), Some("invoice_recipient"));
        assert!(!record.subject.organisation);
        assert_eq!(
            (
                record.subject.first_name.as_str(),
                record.subject.last_name.as_str()
            ),
            ("Mia", "Muster")
        );
        assert_eq!(record.residence, ["AT"]);
        assert_eq!(record.countries(), ["AT"]);
        assert!(record.subject.is_screenable());

        // An organisation by its name, its seat as residence; a person's
        // data of an earlier answer do not count.
        let organisation = json!({
            "recipient": "third_party",
            "recipient_is_payer": false,
            "recipient_type": "organisation",
            "organisation_name": "Beispiel GmbH",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "country": "CY",
        });
        let subjects = recipient_subjects(lead_id, Some(&organisation), &[]);
        assert_eq!(subjects.len(), 1);
        assert!(subjects[0].subject.organisation);
        assert_eq!(subjects[0].subject.first_name, "");
        assert_eq!(subjects[0].subject.last_name, "Beispiel GmbH");
        assert_eq!(subjects[0].residence, ["CY"]);
        assert_eq!(subjects[0].snapshot()["organisation"], true);
        assert_ne!(
            subject_fingerprint(&subjects[0].subject),
            subject_fingerprint(&record.subject)
        );

        // Before "Ist der Rechnungsempfänger der Zahler?" is answered the
        // recipient is screened as well.
        let unanswered = json!({
            "recipient": "third_party",
            "recipient_type": "person",
            "first_name": "Mia",
            "last_name": "Muster",
        });
        assert_eq!(recipient_subjects(lead_id, Some(&unanswered), &[]).len(), 1);
        // A row without a type: a person by a last name, else an
        // organisation by its name.
        let untyped = json!({ "recipient": "third_party", "organisation_name": "Beispiel GmbH" });
        assert!(
            recipient_subjects(lead_id, Some(&untyped), &[])[0]
                .subject
                .organisation
        );
    }

    #[test]
    fn an_invoice_recipient_who_pays_or_the_patient_side_is_no_recipient_subject() {
        let lead_id = Uuid::new_v4();
        let third_party_payer = json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "first_name": "Viktor",
            "last_name": "Zahler",
        });
        let pays = json!({
            "recipient": "third_party",
            "recipient_is_payer": true,
            "recipient_type": "person",
            "first_name": "Viktor",
            "last_name": "Zahler",
        });
        // The recipient who pays is the payer: one subject, `lead_payer`.
        assert!(
            recipient_subjects(
                lead_id,
                Some(&pays),
                std::slice::from_ref(&third_party_payer)
            )
            .is_empty()
        );
        assert_eq!(
            payer_subjects(lead_id, std::slice::from_ref(&third_party_payer)).len(),
            1
        );
        // "Pays" answered but nobody declared as third-party payer yet: the
        // recipient is not screened as payer, so it is screened here.
        assert_eq!(
            recipient_subjects(lead_id, Some(&pays), &[json!({ "payer_kind": "self" })]).len(),
            1
        );
        let mut different = pays.clone();
        different["first_name"] = json!("Another");
        assert_eq!(
            recipient_subjects(
                lead_id,
                Some(&different),
                std::slice::from_ref(&third_party_payer)
            )
            .len(),
            1
        );
        // A recipient who does not pay stays a subject next to another payer.
        let other = json!({
            "recipient": "third_party",
            "recipient_is_payer": false,
            "recipient_type": "organisation",
            "organisation_name": "Beispiel GmbH",
        });
        assert_eq!(
            recipient_subjects(
                lead_id,
                Some(&other),
                std::slice::from_ref(&third_party_payer)
            )
            .len(),
            1
        );
        // The patient side as recipient, no answer, no row: nothing.
        for row in [
            json!({ "recipient": "self", "recipient_is_payer": true }),
            json!({ "recipient": null }),
        ] {
            assert!(
                recipient_subjects(lead_id, Some(&row), &[]).is_empty(),
                "{row}"
            );
        }
        assert!(recipient_subjects(lead_id, None, &[]).is_empty());
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

    fn relation_row(id: Uuid, name: &str, relation_type: &str, extra: Value) -> Value {
        let mut row = json!({
            "id": id.to_string().to_uppercase(),
            "related_name": name,
            "relation_type": relation_type,
            "address_country": null,
            "is_default_payer": false,
            "is_organisation": null,
            "names_payer": false,
            "linked": null,
        });
        for (key, value) in extra.as_object().cloned().unwrap_or_default() {
            row[key.as_str()] = value;
        }
        row
    }

    #[test]
    fn relations_that_pay_or_receive_the_invoices_are_subjects_of_the_patient() {
        let patient_id = Uuid::new_v4();
        let today = NaiveDate::from_ymd_opt(2026, 10, 11).unwrap();
        let adult = NaiveDate::from_ymd_opt(1980, 1, 1);
        let default_payer = Uuid::new_v4();
        let order_payer = Uuid::new_v4();
        let rows = vec![
            relation_row(
                default_payer,
                "  Testomir   Korneev ",
                "other",
                json!({ "is_default_payer": true, "address_country": "Deutschland" }),
            ),
            relation_row(
                order_payer,
                "Viktor Zahler",
                "friend",
                json!({ "names_payer": true }),
            ),
            // An adult's spouse, parent and emergency contact pay nothing.
            relation_row(Uuid::new_v4(), "Mia Muster", "spouse", json!({})),
            relation_row(Uuid::new_v4(), "Anna Muster", "parent", json!({})),
            // A row without an id is nobody's subject.
            relation_row(
                Uuid::new_v4(),
                "Ben Muster",
                "other",
                json!({ "id": "", "is_default_payer": true }),
            ),
        ];
        let subjects = relation_subjects(patient_id, adult, &rows, today);
        assert_eq!(subjects.len(), 2, "{subjects:?}");
        let payer = &subjects[0];
        assert_eq!(payer.kind, SubjectKind::PatientRelation);
        assert_eq!(payer.kind.as_str(), "patient_relation");
        assert_eq!(payer.patient_id, Some(patient_id));
        assert_eq!(payer.lead_id, None);
        // The relation id, lower case whatever the row says.
        assert_eq!(payer.subject_ref, default_payer.to_string());
        assert_eq!(payer.relation.as_deref(), Some("default_payer"));
        assert!(!payer.subject.organisation);
        assert_eq!(
            (
                payer.subject.first_name.as_str(),
                payer.subject.last_name.as_str()
            ),
            ("Testomir", "Korneev")
        );
        // The address country (a legacy name) is read as its code and counts
        // for the country policy like the lead's payer's (2026-10-12).
        assert_eq!(payer.residence, ["DE"]);
        assert_eq!(payer.countries(), ["DE"]);
        assert_eq!(payer.snapshot()["relation"], "default_payer");
        assert_eq!(subjects[1].subject_ref, order_payer.to_string());
        assert_eq!(subjects[1].relation.as_deref(), Some("invoice_payer"));

        // A minor's parents and guardians are the contracting party and the
        // default invoice recipient; the default payer keeps its role.
        let minor = NaiveDate::from_ymd_opt(2015, 6, 1);
        let mother = Uuid::new_v4();
        let rows = vec![
            relation_row(mother, "Anna Muster", "parent", json!({})),
            relation_row(Uuid::new_v4(), "Ben Muster", "guardian", json!({})),
            relation_row(Uuid::new_v4(), "Mia Muster", "sibling", json!({})),
            relation_row(
                Uuid::new_v4(),
                "Viktor Zahler",
                "parent",
                json!({ "is_default_payer": true }),
            ),
        ];
        let subjects = relation_subjects(patient_id, minor, &rows, today);
        let roles: Vec<&str> = subjects
            .iter()
            .filter_map(|record| record.relation.as_deref())
            .collect();
        assert_eq!(
            roles,
            [
                "legal_representative",
                "legal_representative",
                "default_payer"
            ]
        );
        assert_eq!(subjects[0].subject_ref, mother.to_string());
        // Without a birth date the patient counts as an adult.
        assert!(relation_subjects(patient_id, None, &rows[..3], today).is_empty());
    }

    #[test]
    fn a_relation_is_screened_as_its_patient_record_or_by_the_contact_name() {
        let patient_id = Uuid::new_v4();
        let today = NaiveDate::from_ymd_opt(2026, 10, 11).unwrap();
        // Linked to a patient record: that record's name, birth date and
        // citizenships — the name the invoice carries — not the stored text.
        let linked = relation_row(
            Uuid::new_v4(),
            "Old Name",
            "spouse",
            json!({
                "is_default_payer": true,
                "address_country": "AT",
                "linked": {
                    "first_name": "Testomir",
                    "last_name": "Korneev",
                    "birth_date": "1961-03-14",
                    "citizenships": ["RU"],
                    "nationality": "Ukraine",
                    "residence_country": "CY",
                    "address_country": "AT",
                },
            }),
        );
        let record = &relation_subjects(patient_id, None, &[linked], today)[0];
        assert!(!record.subject.organisation);
        assert_eq!(record.subject.first_name, "Testomir");
        assert_eq!(record.subject.last_name, "Korneev");
        assert_eq!(
            record.subject.date_of_birth,
            NaiveDate::from_ymd_opt(1961, 3, 14)
        );
        assert_eq!(record.subject.citizenships, ["RU", "UA"]);
        assert_eq!(record.residence, ["AT", "CY"]);
        // Citizenships and countries of the linked record count for the
        // country policy.
        assert_eq!(record.countries(), ["RU", "UA", "AT", "CY"]);

        // A separate contact without an answer to the organisation box: a
        // person by given names and the last word; a legal form or a single
        // word make it an organisation by the whole name.
        let subject = |name: &str| contact_subject(name, None, None);
        let person = subject("Anna Maria Beispiel");
        assert!(!person.organisation);
        assert_eq!(
            (person.first_name.as_str(), person.last_name.as_str()),
            ("Anna Maria", "Beispiel")
        );
        // The birth date the lead conversion wrote into the notes counts for
        // a person (a conflicting date then rules a namesake out).
        let converted = relation_row(
            Uuid::new_v4(),
            "Anna Muster",
            "parent",
            json!({
                "is_default_payer": true,
                "notes": "Email: anna@example.com\nGeburtsdatum: 1985-03-02\nAdresse: Musterweg 1",
            }),
        );
        assert_eq!(
            relation_subjects(patient_id, None, &[converted], today)[0]
                .subject
                .date_of_birth,
            NaiveDate::from_ymd_opt(1985, 3, 2)
        );
        assert_eq!(
            notes_birth_date("geburtsdatum: 02.03.1985"),
            NaiveDate::from_ymd_opt(1985, 3, 2)
        );
        for notes in [
            "",
            "Geburtsdatum:",
            "Geburtsdatum: unbekannt",
            "Dr. Geburtsdatum: 1985-03-02",
        ] {
            assert_eq!(notes_birth_date(notes), None, "{notes}");
        }
        assert_eq!(
            contact_subject(
                "Polartek Shipping LLC",
                NaiveDate::from_ymd_opt(1985, 3, 2),
                None
            )
            .date_of_birth,
            None
        );
        for name in [
            "Polartek Shipping LLC",
            "Beispiel GmbH & Co. KG",
            "ООО Полартек",
            "Polartek",
            // Banks, insurers and foundations without a legal form (QA 2026-10-12).
            "Testgrad Commerce Bank",
            "Banque Beispiel Privée",
            "Kreissparkasse Beispielstadt",
            "Beispiel Commerzbank",
            "Сбер Банк Беспримерный",
            "Beispiel Versicherung",
            "Stiftung Beispielhilfe",
        ] {
            let organisation = subject(name);
            assert!(organisation.organisation, "{name}");
            assert_eq!(organisation.first_name, "", "{name}");
            assert_eq!(organisation.last_name, name, "{name}");
        }
        // Initials, short names and names that merely contain such a word stay people.
        for name in [
            "Anna O. Muster",
            "Sa Ko",
            "Ao Beispiel",
            "Anna Bankowski",
            "Ben Fondel",
        ] {
            assert!(!subject(name).organisation, "{name}");
        }
    }

    #[test]
    fn a_relation_payer_on_the_list_is_found_and_another_name_is_not() {
        let index = crate::sanctions::matching::SanctionsIndex::build(
            crate::sanctions::fsf::parse_fsf_xml(include_bytes!("testdata/synthetic_fsf_1_1.xml"))
                .unwrap()
                .entries,
        );
        let today = NaiveDate::from_ymd_opt(2026, 10, 11).unwrap();
        let record = |name: &str| {
            relation_subjects(
                Uuid::new_v4(),
                None,
                &[relation_row(
                    Uuid::new_v4(),
                    name,
                    "other",
                    json!({ "is_default_payer": true }),
                )],
                today,
            )
            .remove(0)
        };
        assert_eq!(screen_subject(&index, &record("Testomir Korneev")).len(), 1);
        assert_eq!(
            screen_subject(&index, &record("Polartek Shipping LLC")).len(),
            1
        );
        assert!(screen_subject(&index, &record("Mia Beispiel")).is_empty());
    }

    #[test]
    fn the_organisation_box_decides_how_a_separate_contact_is_screened() {
        let index = crate::sanctions::matching::SanctionsIndex::build(
            crate::sanctions::fsf::parse_fsf_xml(include_bytes!("testdata/synthetic_fsf_1_1.xml"))
                .unwrap()
                .entries,
        );
        let today = NaiveDate::from_ymd_opt(2026, 10, 11).unwrap();
        let record = |name: &str, organisation: Value| {
            relation_subjects(
                Uuid::new_v4(),
                None,
                &[relation_row(
                    Uuid::new_v4(),
                    name,
                    "other",
                    json!({ "is_default_payer": true, "is_organisation": organisation }),
                )],
                today,
            )
            .remove(0)
        };
        // A company name without a legal form: the guess takes it for a
        // person, the ticked box screens it against the listed entities.
        let guessed = record("Polartek Shipping", Value::Null);
        assert!(!guessed.subject.organisation);
        assert!(screen_subject(&index, &guessed).is_empty());
        let ticked = record("Polartek Shipping", json!(true));
        assert!(ticked.subject.organisation);
        assert_eq!(ticked.subject.first_name, "");
        assert_eq!(ticked.subject.last_name, "Polartek Shipping");
        assert_eq!(screen_subject(&index, &ticked).len(), 1);
        // Not ticked: a person, also with a word that looks like a legal
        // form; a single word still goes as an organisation (a person needs
        // a given name).
        let person = record("Anna Ag", json!(false));
        assert!(!person.subject.organisation);
        assert_eq!(person.subject.first_name, "Anna");
        assert!(record("Anna Ag", Value::Null).subject.organisation);
        assert!(record("Polartek", json!(false)).subject.organisation);
        // The answer is part of the fingerprint: a changed box is reviewed
        // again.
        assert_ne!(
            subject_fingerprint(&guessed.subject),
            subject_fingerprint(&ticked.subject)
        );
        // What the dialog shows for a row without an answer.
        assert!(contact_name_is_organisation("Beispiel GmbH"));
        assert!(contact_name_is_organisation("Polartek"));
        assert!(!contact_name_is_organisation("Viktor Zahler"));
    }

    fn contact(name: &str, country: Option<&str>) -> Value {
        json!({ "name": name, "country": country })
    }

    #[test]
    fn a_payer_contact_is_one_subject_per_name_with_the_countries_of_all_its_records() {
        let patient_id = Uuid::new_v4();
        let patient = SubjectRecord {
            kind: SubjectKind::Patient,
            lead_id: None,
            patient_id: Some(patient_id),
            subject_ref: String::new(),
            subject: Subject {
                first_name: "Anna".into(),
                last_name: "Muster".into(),
                ..Subject::default()
            },
            residence: vec!["DE".into()],
            relation: None,
        };
        let relation = relation_subjects(
            patient_id,
            None,
            &[relation_row(
                Uuid::new_v4(),
                "Ben Muster",
                "spouse",
                json!({ "is_default_payer": true }),
            )],
            NaiveDate::from_ymd_opt(2026, 10, 12).unwrap(),
        );
        let mut known = vec![patient];
        known.extend(relation);
        let subjects = payer_contact_subjects(
            Owner::Patient(patient_id),
            &[
                contact("Viktor Zahler", Some("AT")),
                // The same name on an invoice, spelled differently: one
                // subject, both countries.
                contact("  ZAHLER   Viktor ", Some("Russland")),
                contact("Viktor Zahler", None),
                // The relation and the patient are screened as such.
                contact("Ben Muster", Some("RU")),
                contact("Anna Muster", None),
                contact("Beispiel GmbH", Some("CY")),
                contact("   ", Some("RU")),
            ],
            &known,
            &[],
        );
        assert_eq!(subjects.len(), 2, "{subjects:?}");
        let person = &subjects[0];
        assert_eq!(person.kind, SubjectKind::PayerContact);
        assert_eq!(person.kind.as_str(), "payer_contact");
        assert_eq!(person.patient_id, Some(patient_id));
        assert_eq!(person.lead_id, None);
        assert_eq!(person.relation.as_deref(), Some(PAYER_CONTACT_RELATION));
        assert!(person.subject_ref.starts_with(PAYER_CONTACT_REF_PREFIX));
        assert_eq!(
            person.subject_ref.len(),
            PAYER_CONTACT_REF_PREFIX.len() + 16
        );
        assert!(!person.subject.organisation);
        assert_eq!(person.residence, ["AT", "RU"]);
        // The countries count for the blocked-country policy.
        assert_eq!(person.countries(), ["AT", "RU"]);
        let company = &subjects[1];
        assert!(company.subject.organisation);
        assert_eq!(company.subject.last_name, "Beispiel GmbH");
        assert_eq!(company.countries(), ["CY"]);
        // The reference follows the name, not the record or the spelling.
        let again = payer_contact_subjects(
            Owner::Lead(Uuid::new_v4()),
            &[contact("Viktor  Zahler", None)],
            &[],
            &[],
        );
        assert_eq!(again[0].subject_ref, person.subject_ref);
        assert!(again[0].lead_id.is_some());
        assert_eq!(again[0].patient_id, None);
    }

    #[test]
    fn the_payer_dialogs_organisation_box_decides_how_a_payer_contact_is_screened() {
        let index = crate::sanctions::matching::SanctionsIndex::build(
            crate::sanctions::fsf::parse_fsf_xml(include_bytes!("testdata/synthetic_fsf_1_1.xml"))
                .unwrap()
                .entries,
        );
        let patient_id = Uuid::new_v4();
        let with = |name: &str, organisation: Value| json!({ "name": name, "country": null, "organisation": organisation });
        let screened = |rows: &[Value]| {
            payer_contact_subjects(Owner::Patient(patient_id), rows, &[], &[]).remove(0)
        };
        // A company name without a legal form: the guess (old rows) takes it
        // for a person, the ticked box compares it with the listed entities.
        let guessed = screened(&[with("Polartek Shipping", Value::Null)]);
        assert!(!guessed.subject.organisation);
        assert!(screen_subject(&index, &guessed).is_empty());
        let ticked = screened(&[with("Polartek Shipping", json!(true))]);
        assert!(ticked.subject.organisation);
        assert_eq!(ticked.subject.last_name, "Polartek Shipping");
        assert_eq!(screen_subject(&index, &ticked).len(), 1);
        // Not ticked: a person, even with a word that looks like a legal form.
        let person = screened(&[with("Anna Ag", json!(false))]);
        assert!(!person.subject.organisation);
        assert_eq!(person.subject.first_name, "Anna");
        assert!(
            screened(&[with("Anna Ag", Value::Null)])
                .subject
                .organisation
        );
        // The same name on an order (old row, no answer) and an invoice
        // (ticked): one subject, an organisation.
        let both = payer_contact_subjects(
            Owner::Patient(patient_id),
            &[
                with("Polartek Shipping", Value::Null),
                with("polartek  shipping", json!(true)),
            ],
            &[],
            &[],
        );
        assert_eq!(both.len(), 1);
        assert!(both[0].subject.organisation);
        assert_eq!(both[0].subject_ref, guessed.subject_ref);
        // A changed answer is a changed fingerprint: reviewed again.
        assert_ne!(
            subject_fingerprint(&guessed.subject),
            subject_fingerprint(&ticked.subject)
        );
    }

    #[test]
    fn a_payer_contact_the_lead_declared_is_screened_with_the_leads_data() {
        let lead_id = Uuid::new_v4();
        let declared = payer_subjects(
            lead_id,
            &[json!({
                "payer_kind": "third_party",
                "payer_type": "person",
                "first_name": "Testomir",
                "last_name": "Korneev",
                "date_of_birth": "1961-03-14",
                "citizenships": ["RU"],
                "country": "CY",
            })],
        );
        // On the lead's own orders the declaration's payer is the lead's
        // payer subject, not a contact of its own.
        assert!(
            payer_contact_subjects(
                Owner::Lead(lead_id),
                &[contact("Testomir Korneev", Some("CY"))],
                &declared,
                &[],
            )
            .is_empty()
        );
        // On the converted patient's orders it is the patient's contact,
        // screened with what the lead declared: the same fingerprint as the
        // lead's subject, so the CEO's decision on the lead's hit carries
        // over.
        let patient_id = Uuid::new_v4();
        let subjects = payer_contact_subjects(
            Owner::Patient(patient_id),
            &[contact("Testomir Korneev", Some("AT"))],
            &[],
            &declared,
        );
        assert_eq!(subjects.len(), 1);
        let record = &subjects[0];
        assert_eq!(
            record.subject.date_of_birth,
            NaiveDate::from_ymd_opt(1961, 3, 14)
        );
        assert_eq!(record.subject.citizenships, ["RU"]);
        assert_eq!(record.residence, ["CY", "AT"]);
        assert_eq!(record.countries(), ["RU", "CY", "AT"]);
        let fingerprint = subject_fingerprint(&record.subject);
        assert_eq!(fingerprint, subject_fingerprint(&declared[0].subject));

        let hit = |kind: &str, status: &str, subject: &str| LeadHit {
            kind: kind.into(),
            logical_id: "900101".into(),
            subject_fingerprint: subject.into(),
            entry_fingerprint: "entry".into(),
            status: status.into(),
        };
        let covered = |hits: &[LeadHit]| {
            covered_by_lead_hit(
                SubjectKind::PayerContact,
                "900101",
                &fingerprint,
                "entry",
                hits,
            )
        };
        assert!(covered(&[hit(
            "lead_payer",
            "false_positive",
            &fingerprint
        )]));
        assert!(covered(&[hit("lead_payer", "open", &fingerprint)]));
        assert!(covered(&[hit("lead_recipient", "confirmed", &fingerprint)]));
        assert!(covered(&[hit("payer_contact", "open", &fingerprint)]));
        // Other data, another list entry or another kind: a hit of its own.
        assert!(!covered(&[hit("lead_payer", "false_positive", "other")]));
        assert!(!covered(&[hit(
            "lead_patient",
            "false_positive",
            &fingerprint
        )]));
        assert!(!covered_by_lead_hit(
            SubjectKind::PayerContact,
            "900101",
            &fingerprint,
            "amended",
            &[hit("lead_payer", "false_positive", &fingerprint)],
        ));
        // The patient keeps only false positives about the lead's patient;
        // a relation never inherits.
        assert!(covered_by_lead_hit(
            SubjectKind::Patient,
            "900101",
            "fp",
            "entry",
            &[hit("lead_patient", "false_positive", "fp")],
        ));
        assert!(!covered_by_lead_hit(
            SubjectKind::Patient,
            "900101",
            "fp",
            "entry",
            &[hit("lead_patient", "open", "fp")],
        ));
        assert!(!covered_by_lead_hit(
            SubjectKind::PatientRelation,
            "900101",
            "fp",
            "entry",
            &[hit("lead_patient", "false_positive", "fp")],
        ));
    }
}
