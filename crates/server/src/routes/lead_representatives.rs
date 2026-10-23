//! Who acts for a lead (owner spec "Patientenformular (Lead-Link)", section 3,
//! 2026-10-05): an adult's representative (Vertreter, Bote, bevollmächtigte
//! Person) or legal guardian (Betreuer), and the legal representatives of a
//! minor — both parents, one parent alone or a guardian.
//!
//! Name and contact of such a person stay where parents have always been: one
//! entry of `leads.trusted_contacts`, and the id of the representative is the
//! id of that entry. The table `lead_representatives` adds what the entry
//! cannot hold: the role, the name parts, place of birth, citizenships, the
//! structured address and the identity document, and the answers of block R
//! (`country_questions`). The readers of a representative take entry and row
//! together, most through [`load`]: the guardian logins (their profile,
//! `services::lead_guardian_identity`), the suggested and contracting signers
//! (`document_signatures`), the privacy consents (`consent_choices`), the
//! invoice recipient (`lead_invoice_recipient`), the payer declaration and
//! the conversion (a parent's structured address goes into the patient
//! relation, the parent named as invoice recipient or paying becomes the
//! default payer). The answers that decide who is asked for
//! (`has_representative`, `under_guardianship`, `custody`,
//! `custody_set_by_staff`) are columns of `lead_gwg_declarations`.
//!
//! [`resolve`] is the one place that says who is a representative; the lead
//! cabinet, the staff wizard, the identification status, the GwG
//! identification sheet and the readers above read it through [`load`]. The sanctions screening
//! keeps its own matcher for the relation of a minor's contact (it also
//! screens contacts without an id) and takes the name parts, citizenships and
//! residence from the same rows.
//!
//! The cabinet endpoints accept only the `patient` role and resolve the lead
//! through the caller's own link, like the rest of the request page
//! ([`crate::routes::lead_portal_intake`]); every write changes the entry and
//! the row in one transaction under the lock of the lead row, is audited
//! there with the names of the changed fields (never their values) and is
//! published as `lead.portal_updated` with `change = "representation"`. Staff
//! state the custody of a minor and remove the row of a representative; they
//! do not edit what the lead entered. See
//! docs/architecture/lead-patient-portal_ua.md.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Extension, Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Map, Value, json};
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::documents::StagedDocumentDelete;
use crate::routes::invoices::payer::is_plausible_email;
use crate::routes::lead_payer;
use crate::routes::lead_portal_guardians::same_person_name;
use crate::routes::lead_portal_intake::{
    self as intake, AccessKind, FieldError, UploadKind, field_error,
};
use crate::services::citizenships::{normalize_citizenships, normalize_country_code};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// A parent or guardian of a minor.
pub(crate) const ROLE_LEGAL_REPRESENTATIVE: &str = "legal_representative";
/// The person who acts for an adult (Vertreter, Bote, bevollmächtigte Person).
pub(crate) const ROLE_AUTHORISED_REPRESENTATIVE: &str = "authorised_representative";
/// The legal guardian of an adult (Betreuer).
pub(crate) const ROLE_LEGAL_GUARDIAN: &str = "legal_guardian";

/// Who represents a minor (`lead_gwg_declarations.custody`); nothing stated
/// counts as both parents.
pub(crate) const CUSTODY_JOINT: &str = "joint";
pub(crate) const CUSTODY_SOLE_PARENT: &str = "sole_parent";
pub(crate) const CUSTODY_GUARDIAN: &str = "guardian";
const CUSTODY_VALUES: [&str; 3] = [CUSTODY_JOINT, CUSTODY_SOLE_PARENT, CUSTODY_GUARDIAN];

/// The places of the form: the first and the second legal representative of
/// a minor, an adult's representative and an adult's legal guardian.
pub(crate) const SLOT_REP1: &str = "rep1";
pub(crate) const SLOT_REP2: &str = "rep2";
pub(crate) const SLOT_AGENT: &str = "agent";
pub(crate) const SLOT_GUARDIAN: &str = "guardian";

/// `contact_origin`: the cabinet created the trusted contact entry, or it
/// existed before (staff entered it).
const ORIGIN_PORTAL: &str = "portal";
const ORIGIN_STAFF: &str = "staff";

/// `lead_portal_uploads.kind` of a representative's files.
pub(crate) const UPLOAD_IDENTITY: &str = "representative_identity";
pub(crate) const UPLOAD_AUTHORITY: &str = "representative_authority";
/// `lead_portal_uploads.access_kind` of a file staff uploaded in the wizard.
pub(crate) const ACCESS_STAFF: &str = "staff";

/// Key of the representation in `leads.portal_field_updates`: like a personal
/// data field it says when the lead (or a parent) last changed it.
pub(crate) const REPRESENTATION_MARKER: &str = "representation";

/// What the cabinet edits for one person (API keys), in form order. Date of
/// birth, e-mail and phone are stored in the trusted contact entry, the rest
/// in `lead_representatives`.
const PERSON_FIELDS: [&str; 18] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "birth_place",
    "birth_country",
    "citizenships",
    "street",
    "zip",
    "city",
    "country",
    "email",
    "phone",
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_issued_on",
    "id_valid_until",
];

/// What "send to the manager" needs of an adult's representative or legal
/// guardian (suffixes of the keys `<slot>_<field>`).
const ADULT_REQUIRED: [&str; 14] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "street",
    "zip",
    "city",
    "country",
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_valid_until",
    "id_upload",
    "authority_upload",
];

/// What "send to the manager" needs of a legal representative of a minor. A
/// guardian (Vormund) also needs the appointment deed (`authority_upload`).
const MINOR_REQUIRED: [&str; 16] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "citizenships",
    "street",
    "zip",
    "city",
    "country",
    "email",
    "phone",
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_valid_until",
    "id_upload",
];

const MINOR_INTAKE_REQUIRED: [&str; 6] = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "country",
    "citizenships",
];

// ----------------------------------------------------------------------------
// Who is a representative
// ----------------------------------------------------------------------------

/// The row of a representative in `lead_representatives`: everything the
/// trusted contact entry cannot hold. All empty for a parent or guardian the
/// cabinet has not added to yet.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(default)]
pub(crate) struct Extras {
    pub role: String,
    pub contact_origin: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_place: Option<String>,
    pub birth_country: Option<String>,
    pub citizenships: Vec<String>,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub id_document_type: Option<String>,
    pub id_document_number: Option<String>,
    pub id_issuing_authority: Option<String>,
    pub id_issuing_country: Option<String>,
    pub id_issued_on: Option<NaiveDate>,
    pub id_valid_until: Option<NaiveDate>,
    /// Staff marked the scan unreadable: a new one is needed.
    pub id_document_unreadable: bool,
    pub country_questions: Value,
}

impl Extras {
    fn from_row(row: &PgRow) -> Self {
        let text = |column: &str| {
            row.try_get::<Option<String>, _>(column)
                .ok()
                .flatten()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let date = |column: &str| row.try_get::<Option<NaiveDate>, _>(column).ok().flatten();
        Extras {
            role: text("role").unwrap_or_default(),
            contact_origin: text("contact_origin").unwrap_or_default(),
            first_name: text("first_name"),
            last_name: text("last_name"),
            birth_place: text("birth_place"),
            birth_country: text("birth_country"),
            citizenships: row
                .try_get::<Vec<String>, _>("citizenships")
                .unwrap_or_default(),
            street: text("street"),
            zip: text("zip"),
            city: text("city"),
            country: text("country"),
            id_document_type: text("id_document_type"),
            id_document_number: text("id_document_number"),
            id_issuing_authority: text("id_issuing_authority"),
            id_issuing_country: text("id_issuing_country"),
            id_issued_on: date("id_issued_on"),
            id_valid_until: date("id_valid_until"),
            id_document_unreadable: row
                .try_get::<bool, _>("id_document_unreadable")
                .unwrap_or(false),
            country_questions: row
                .try_get("country_questions")
                .unwrap_or_else(|_| json!({})),
        }
    }
}

/// The answers that decide who the cabinet asks for.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Answers {
    /// Adult: "does somebody act on your behalf?" `None` until answered.
    pub has_representative: Option<bool>,
    /// Adult, asked only after a "yes" to `has_representative` (owner
    /// 2026-10-11): "is it a court-appointed representative (rechtliche
    /// Betreuung)?" `None` until answered.
    pub under_guardianship: Option<bool>,
    /// Minor: who represents the child, as stated by a parent or by staff.
    pub custody: Option<String>,
}

impl Answers {
    /// Whether an adult's form asks for the person of `role` (owner
    /// 2026-10-11): somebody acts for the lead, and that is the legal
    /// guardian (Betreuer) with "yes" to the court-appointed question, an
    /// authorised representative (Vollmacht) with "no". A legal guardianship
    /// stated before the question was nested (2026-10-11) still asks for its
    /// guardian.
    pub(crate) fn asks_adult_role(&self, role: &str) -> bool {
        match role {
            ROLE_AUTHORISED_REPRESENTATIVE => {
                self.has_representative == Some(true) && self.under_guardianship == Some(false)
            }
            ROLE_LEGAL_GUARDIAN => self.under_guardianship == Some(true),
            _ => false,
        }
    }

    /// [`Answers::asks_adult_role`] with the persons on file: an authorised
    /// representative recorded beside a legal guardian (before 2026-10-11, or
    /// by staff) keeps its place while somebody acts for the lead.
    pub(crate) fn keeps_adult_role(&self, role: &str, on_file: bool) -> bool {
        self.asks_adult_role(role)
            || (role == ROLE_AUTHORISED_REPRESENTATIVE
                && on_file
                && self.has_representative == Some(true))
    }

    /// The custody that applies to a minor: both parents until somebody says
    /// otherwise.
    pub(crate) fn custody(&self) -> &str {
        self.custody
            .as_deref()
            .filter(|value| CUSTODY_VALUES.contains(value))
            .unwrap_or(CUSTODY_JOINT)
    }
}

/// One person who acts for the lead: the trusted contact entry with the row
/// that belongs to it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Representative {
    /// The id of the trusted contact entry.
    pub id: Uuid,
    /// The place in the form; `None` for a person on file the cabinet does
    /// not ask for (a third parent, a second one under single custody).
    pub slot: Option<&'static str>,
    pub role: &'static str,
    /// The relation of the trusted contact as entered.
    pub relation: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: Option<NaiveDate>,
    pub email: Option<String>,
    pub phone: Option<String>,
    /// The active guardian logins issued for the entry.
    pub login_user_ids: Vec<Uuid>,
    /// A row of the fitting role exists.
    pub has_data: bool,
    pub extras: Extras,
}

impl Representative {
    /// "First Last", as the trusted contact entry is named.
    pub(crate) fn name(&self) -> String {
        full_name(&self.first_name, &self.last_name)
    }

    /// The e-mail address is a login: staff change it, not the cabinet.
    pub(crate) fn has_login(&self) -> bool {
        !self.login_user_ids.is_empty()
    }

    /// Staff entered the trusted contact with an address (the cabinet did not
    /// create it) and it has no login yet. The address decides which patient
    /// login the automatic parent link attaches to the request, so the
    /// cabinet of a minor does not change it: GMED does (owner decision
    /// 2026-10-23). An address staff left empty the cabinet may still add,
    /// otherwise the request could not be sent.
    pub(crate) fn email_set_by_staff(&self) -> bool {
        !self.has_login()
            && self.extras.contact_origin != ORIGIN_PORTAL
            && self
                .email
                .as_deref()
                .is_some_and(|email| !email.trim().is_empty())
    }

    /// A guardian (Vormund, Pfleger) of a minor rather than a parent: the
    /// custody says so, or the relation of the contact does.
    pub(crate) fn is_guardian_of_minor(&self, custody: &str) -> bool {
        custody == CUSTODY_GUARDIAN
            || crate::routes::leads::is_legal_guardian_relation(self.relation.as_deref())
    }
}

fn full_name(first_name: &str, last_name: &str) -> String {
    [first_name.trim(), last_name.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// First and last name of a trusted contact. The row's parts while "first
/// last" still is the entry's name (staff may have renamed the contact in the
/// wizard since); otherwise the name split at the last space — a single word
/// is the last name.
pub(crate) fn name_parts(name: &str, first: Option<&str>, last: Option<&str>) -> (String, String) {
    let first = first.unwrap_or_default().trim();
    let last = last.unwrap_or_default().trim();
    if same_person_name(&full_name(first, last), name) {
        return (first.to_string(), last.to_string());
    }
    let words = name.split_whitespace().collect::<Vec<_>>();
    match words.split_last() {
        Some((last, given)) => (given.join(" "), (*last).to_string()),
        None => (String::new(), String::new()),
    }
}

/// The id of a trusted contact entry, when it is a UUID.
pub(crate) fn entry_id(entry: &Value) -> Option<Uuid> {
    entry
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id.trim()).ok())
}

fn entry_text(entry: &Value, key: &str) -> Option<String> {
    entry
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn person(
    id: Uuid,
    entry: &Value,
    slot: Option<&'static str>,
    role: &'static str,
    extras: Option<&Extras>,
    logins: &[(Uuid, Uuid)],
) -> Representative {
    let (first_name, last_name) = name_parts(
        &entry_text(entry, "name").unwrap_or_default(),
        extras.and_then(|extras| extras.first_name.as_deref()),
        extras.and_then(|extras| extras.last_name.as_deref()),
    );
    Representative {
        id,
        slot,
        role,
        relation: entry_text(entry, "relation"),
        first_name,
        last_name,
        date_of_birth: entry_text(entry, "birth_date")
            .and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok()),
        email: entry_text(entry, "email"),
        phone: entry_text(entry, "phone"),
        login_user_ids: logins
            .iter()
            .filter(|(contact_id, _)| *contact_id == id)
            .map(|(_, user_id)| *user_id)
            .collect(),
        has_data: extras.is_some(),
        extras: extras.cloned().unwrap_or_default(),
    }
}

/// Who is a representative of the lead — the one rule every reader uses.
///
/// Minor: each trusted contact with a UUID `id` whose relation is parent or
/// guardian ([`crate::routes::leads::is_parent_or_guardian_relation`]). The
/// contacts with an active guardian login come first, in the order the logins
/// were issued (`logins`: contact id and login, oldest first), then the order
/// of the array. The first is `rep1`; the second is `rep2` only under joint
/// custody; further ones are on file without a place in the form.
///
/// Adult: the contact whose row has the role `authorised_representative`
/// (asked for while the lead answered that somebody acts for him) and the one
/// with the role `legal_guardian` (while the lead is under guardianship).
///
/// A row whose role does not fit the lead's age is ignored.
pub(crate) fn resolve(
    minor: bool,
    contacts: &[Value],
    rows: &HashMap<Uuid, Extras>,
    logins: &[(Uuid, Uuid)],
    answers: &Answers,
) -> Vec<Representative> {
    let mut entries: Vec<(Uuid, &Value)> = Vec::new();
    for entry in contacts {
        if let Some(id) = entry_id(entry)
            && !entries.iter().any(|(known, _)| *known == id)
        {
            entries.push((id, entry));
        }
    }
    if minor {
        let custody = answers.custody();
        let mut parents = entries
            .into_iter()
            .filter(|(_, entry)| {
                crate::routes::leads::is_parent_or_guardian_relation(
                    entry.get("relation").and_then(Value::as_str),
                )
            })
            .collect::<Vec<_>>();
        // A stable sort: contacts without a login keep the order of the array.
        parents.sort_by_key(|(id, _)| {
            logins
                .iter()
                .position(|(contact_id, _)| contact_id == id)
                .unwrap_or(usize::MAX)
        });
        return parents
            .into_iter()
            .enumerate()
            .map(|(index, (id, entry))| {
                let slot = match index {
                    0 => Some(SLOT_REP1),
                    1 if custody == CUSTODY_JOINT => Some(SLOT_REP2),
                    _ => None,
                };
                let extras = rows
                    .get(&id)
                    .filter(|extras| extras.role == ROLE_LEGAL_REPRESENTATIVE);
                person(id, entry, slot, ROLE_LEGAL_REPRESENTATIVE, extras, logins)
            })
            .collect();
    }
    let mut people = Vec::new();
    for (role, slot) in [
        (ROLE_AUTHORISED_REPRESENTATIVE, SLOT_AGENT),
        (ROLE_LEGAL_GUARDIAN, SLOT_GUARDIAN),
    ] {
        let found = entries
            .iter()
            .find(|(id, _)| rows.get(id).is_some_and(|extras| extras.role == role));
        let asked = answers.keeps_adult_role(role, found.is_some());
        if let Some((id, entry)) = found {
            people.push(person(
                *id,
                entry,
                asked.then_some(slot),
                role,
                rows.get(id),
                logins,
            ));
        }
    }
    people
}

/// Who acts for a lead: the answers and the persons.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Representation {
    /// Under 18 today: the parents act, and the adult questions are not asked.
    pub minor: bool,
    pub answers: Answers,
    pub representatives: Vec<Representative>,
}

impl Representation {
    pub(crate) fn find(&self, id: Uuid) -> Option<&Representative> {
        self.representatives.iter().find(|person| person.id == id)
    }

    fn in_slot(&self, slot: &str) -> Option<&Representative> {
        self.representatives
            .iter()
            .find(|person| person.slot == Some(slot))
    }

    fn with_role(&self, role: &str) -> Option<&Representative> {
        self.representatives
            .iter()
            .find(|person| person.role == role)
    }
}

/// A file a representative's upload registered in `lead_portal_uploads`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Upload {
    pub document_id: Uuid,
    pub representative_id: Uuid,
    /// [`UPLOAD_IDENTITY`] or [`UPLOAD_AUTHORITY`].
    pub kind: String,
    pub file_name: Option<String>,
    pub size_bytes: Option<i64>,
    pub mime_type: Option<String>,
    pub uploaded_at: Option<DateTime<Utc>>,
    pub uploaded_by: Option<Uuid>,
    /// Staff uploaded it in the wizard (`access_kind = 'staff'`).
    pub by_staff: bool,
    /// Staff marked it as reviewed or confirmed it.
    pub reviewed: bool,
    /// Staff use the document (reviewed, signed, shared, in a review, moved
    /// to a patient): the cabinet can no longer remove it.
    pub locked: bool,
}

/// Everything of a lead's representation, as [`load`] reads it.
#[derive(Clone, Debug, Default)]
pub(crate) struct Loaded {
    pub representation: Representation,
    /// Staff requested contract details, or contractual documents already exist.
    pub document_stage: bool,
    /// The uploads on file of the lead's representatives, oldest first.
    pub uploads: Vec<Upload>,
    /// The custody was stated by staff (`lead_gwg_declarations.
    /// custody_set_by_staff`, owner decision 2026-10-22): the cabinet shows it
    /// read-only and may not change it.
    pub custody_set_by_staff: bool,
    /// The elements of `leads.trusted_contacts` as stored.
    contacts: Vec<Value>,
    rows: HashMap<Uuid, Extras>,
}

impl Loaded {
    /// A file of that kind and person is on file.
    pub(crate) fn has_upload(&self, representative_id: Uuid, kind: &str) -> bool {
        self.uploads
            .iter()
            .any(|upload| upload.representative_id == representative_id && upload.kind == kind)
    }

    /// A minor's contracting representatives are identified (the readiness
    /// check `identity_document_verified`): `rep1` and, under joint custody,
    /// `rep2` each have an identity copy staff took over (reviewed, confirmed
    /// or used for the identity data they entered). The GwG subjects of a
    /// minor are the parents or the guardian, not the child, who often has no
    /// document of its own. `false` for an adult or without any representative.
    pub(crate) fn minor_representatives_identified(&self) -> bool {
        let representation = &self.representation;
        if !representation.minor {
            return false;
        }
        let mut slots = vec![SLOT_REP1];
        if representation.answers.custody() == CUSTODY_JOINT {
            slots.push(SLOT_REP2);
        }
        slots.iter().all(|slot| {
            representation.in_slot(slot).is_some_and(|person| {
                self.uploads.iter().any(|upload| {
                    upload.representative_id == person.id
                        && upload.kind == UPLOAD_IDENTITY
                        && upload.reviewed
                })
            })
        })
    }

    /// The row of a trusted contact, whatever its role.
    pub(crate) fn row_of(&self, contact_id: Uuid) -> Option<&Extras> {
        self.rows.get(&contact_id)
    }

    /// The cabinet may remove the person: it created the trusted contact, the
    /// contact has no login and staff use none of its files.
    fn can_remove(&self, person: &Representative) -> bool {
        person.has_data
            && person.extras.contact_origin == ORIGIN_PORTAL
            && !person.has_login()
            && !self
                .uploads
                .iter()
                .any(|upload| upload.representative_id == person.id && upload.locked)
    }

    /// A parent's login may not change the name or date of birth of another
    /// person (`representative_not_yours`): one with a login of its own, one
    /// staff entered or one whose files staff use. The other parent whom this
    /// cabinet entered and may still remove stays editable, so the parent who
    /// typed it can finish the date of birth and correct a typo (QA
    /// 2026-10-23: the second parent locked after the first save, the request
    /// could not be sent).
    pub(crate) fn identity_locked(&self, person: &Representative, user_id: Uuid) -> bool {
        !person.login_user_ids.contains(&user_id) && !self.can_remove(person)
    }
}

/// Reads the representation of a lead in the caller's connection or
/// transaction, with the lead's age judged today; `None` when the lead does
/// not exist.
pub(crate) async fn load(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Loaded>, sqlx::Error> {
    load_on(conn, lead_id, crate::app_time::today()).await
}

/// [`load`] with the lead's age judged on `on`: a converted lead is read as
/// of its conversion day, so the parents of a child who has turned 18 since
/// stay its representatives (the identification status of the patient card).
pub(crate) async fn load_on(
    conn: &mut PgConnection,
    lead_id: Uuid,
    on: NaiveDate,
) -> Result<Option<Loaded>, sqlx::Error> {
    let Some(lead) = sqlx::query(
        r#"SELECT l.date_of_birth, l.trusted_contacts,
                  g.has_representative, g.under_guardianship, g.custody,
                  COALESCE(g.custody_set_by_staff, false) AS custody_set_by_staff,
                  (l.converted_patient_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM lead_risk_assessments ra WHERE ra.lead_id=l.id AND 'G'=ANY(ra.requested_blocks))
                   OR EXISTS (SELECT 1 FROM framework_contracts fc WHERE fc.lead_id=l.id)
                   OR EXISTS (SELECT 1 FROM documents d WHERE (d.lead_id=l.id OR d.order_id IN (SELECT o.id FROM orders o WHERE o.source_lead_id=l.id))
                       AND d.status='active' AND d.file_deleted_at IS NULL
                       AND d.generated_template_id IN ('framework_contract','single_order'))
                  ) AS document_stage
           FROM leads l
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let mut rows: HashMap<Uuid, Extras> =
        sqlx::query("SELECT * FROM lead_representatives WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_all(&mut *conn)
            .await?
            .iter()
            .filter_map(|row| {
                Some((
                    row.try_get::<Uuid, _>("contact_id").ok()?,
                    Extras::from_row(row),
                ))
            })
            .collect();
    let logins: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"SELECT trusted_contact_id, user_id
           FROM lead_portal_access
           WHERE lead_id = $1 AND kind = 'guardian' AND revoked_at IS NULL
             AND trusted_contact_id IS NOT NULL
           ORDER BY created_at, id"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    let uploads = sqlx::query(
        r#"SELECT u.document_id, u.kind, u.representative_id, u.created_at, u.reviewed_at,
                  u.uploaded_by, u.access_kind, d.original_filename, d.auto_name, d.file_size, d.mime_type,
                  d.patient_id, d.signed_at,
                  COALESCE(u.kind = 'representative_identity' AND u.created_at <=
                    (SELECT r.id_data_entered_at FROM lead_representatives r
                     WHERE r.lead_id = u.lead_id AND r.contact_id = u.representative_id), false) AS identity_in_use,
                  EXISTS(SELECT 1 FROM document_shares s WHERE s.document_id = d.id) AS shared,
                  EXISTS(SELECT 1 FROM document_review_events r WHERE r.document_id = d.id)
                      AS in_review
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1
             AND u.representative_id IS NOT NULL
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL
           ORDER BY u.created_at, u.document_id"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .filter_map(|row| {
        let reviewed = intake::upload_taken_over(row);
        let moved = row
            .try_get::<Option<Uuid>, _>("patient_id")
            .ok()
            .flatten()
            .is_some();
        Some(Upload {
            document_id: row.try_get("document_id").ok()?,
            representative_id: row
                .try_get::<Option<Uuid>, _>("representative_id")
                .ok()
                .flatten()?,
            kind: row.try_get("kind").ok()?,
            file_name: intake::upload_file_name(row),
            size_bytes: row.try_get::<Option<i64>, _>("file_size").ok().flatten(),
            mime_type: row.try_get::<Option<String>, _>("mime_type").ok().flatten(),
            uploaded_at: row.try_get::<DateTime<Utc>, _>("created_at").ok(),
            uploaded_by: row.try_get::<Uuid, _>("uploaded_by").ok(),
            by_staff: row
                .try_get::<String, _>("access_kind")
                .is_ok_and(|kind| kind == ACCESS_STAFF),
            reviewed,
            locked: reviewed
                || moved
                || row.try_get::<bool, _>("shared").unwrap_or(true)
                || row.try_get::<bool, _>("in_review").unwrap_or(true),
        })
    })
    .collect();
    let contacts = lead
        .try_get::<Option<Value>, _>("trusted_contacts")
        .ok()
        .flatten()
        .and_then(|contacts| contacts.as_array().cloned())
        .unwrap_or_default();
    let stored_ids: Vec<Uuid> = rows.keys().copied().collect();
    let mut effective_contacts = contacts.clone();
    // Explicit links to existing parent records supply missing basic data;
    // no clinical data, documents or consents are copied into this request.
    for identity in crate::services::lead_guardian_identity::load_on(conn, lead_id, on).await? {
        let Some(id) = identity.contact_id else {
            continue;
        };
        if let Some(contact) = effective_contacts
            .iter_mut()
            .find(|contact| entry_id(contact) == Some(id))
        {
            *contact = identity.contact;
        }
        if let Ok(mut effective) = serde_json::from_value::<Extras>(identity.extras) {
            if let Some(stored) = rows.get(&id) {
                effective.contact_origin = stored.contact_origin.clone();
                effective.country_questions = stored.country_questions.clone();
            } else {
                effective.contact_origin = ORIGIN_STAFF.to_string();
            }
            rows.insert(id, effective);
        }
    }
    let answers = Answers {
        has_representative: lead
            .try_get::<Option<bool>, _>("has_representative")
            .ok()
            .flatten(),
        under_guardianship: lead
            .try_get::<Option<bool>, _>("under_guardianship")
            .ok()
            .flatten(),
        custody: lead.try_get::<Option<String>, _>("custody").ok().flatten(),
    };
    let minor = crate::routes::leads::is_minor_on(
        lead.try_get::<Option<NaiveDate>, _>("date_of_birth")
            .ok()
            .flatten(),
        on,
    );
    let mut representatives = resolve(minor, &effective_contacts, &rows, &logins, &answers);
    for person in &mut representatives {
        person.has_data = stored_ids.contains(&person.id);
    }
    Ok(Some(Loaded {
        document_stage: lead.try_get("document_stage").unwrap_or(false),
        // Only a stated custody can be staff's.
        custody_set_by_staff: answers.custody.is_some()
            && lead.try_get("custody_set_by_staff").unwrap_or(false),
        representation: Representation {
            minor,
            answers,
            representatives,
        },
        uploads,
        contacts,
        rows,
    }))
}

/// A parent who also pays is one person (coordinator's addendum 10.1): the
/// representative of a minor who pays. The declaration names the
/// representative itself (kind `representative`, owner decision 2026-10-19),
/// or — a third-party row stored before — the third-party payer is that
/// representative: a natural person whose e-mail address equals the
/// representative's or — when either has none — whose first name, last name
/// and date of birth do. Always `None` for an adult. A third party matches
/// only a representative with a place in the form (the first parent, the
/// second one under joint custody): a parent on file without custody who
/// pays stays a third party, as the declaration's own check keeps it.
pub(crate) fn payer_same_person(
    representation: &Representation,
    payer: Option<&lead_payer::Declaration>,
) -> Option<Uuid> {
    if !representation.minor {
        return None;
    }
    if let Some(declared) = payer.filter(|payer| payer.is_representative()) {
        // Only a parent with a place represents the child: after a switch
        // to sole custody the other parent is on file without one and no
        // longer the paying representative (the same rule as naming one,
        // `lead_payer::fit_to_representation`, and the invoice recipient).
        return declared
            .payer_representative_id
            .and_then(|id| representation.find(id))
            .filter(|person| person.slot.is_some())
            .map(|person| person.id);
    }
    let payer = payer.filter(|payer| payer.is_third_party() && !payer.is_organisation())?;
    let address = |value: Option<&str>| {
        value
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
    };
    let payer_email = address(payer.email.as_deref());
    representation
        .representatives
        .iter()
        .filter(|person| person.slot.is_some())
        .find(
            |person| match (&payer_email, address(person.email.as_deref())) {
                (Some(payer_email), Some(email)) => *payer_email == email,
                _ => {
                    same_person_name(
                        payer.first_name.as_deref().unwrap_or_default(),
                        &person.first_name,
                    ) && same_person_name(
                        payer.last_name.as_deref().unwrap_or_default(),
                        &person.last_name,
                    ) && payer.date_of_birth.is_some()
                        && payer.date_of_birth == person.date_of_birth
                }
            },
        )
        .map(|person| person.id)
}

/// The subject of a minor's representative in the sheet binding, the
/// identification status and the own-account payment.
pub(crate) fn subject_of(representative_id: Uuid) -> String {
    format!("representative:{representative_id}")
}

/// The representative id of a subject `representative:<uuid>`.
pub(crate) fn subject_representative(subject: &str) -> Option<Uuid> {
    Uuid::parse_str(subject.trim().strip_prefix("representative:")?.trim()).ok()
}

// ----------------------------------------------------------------------------
// What is still missing, and the payloads
// ----------------------------------------------------------------------------

fn field_filled(loaded: &Loaded, person: &Representative, field: &str, today: NaiveDate) -> bool {
    let extras = &person.extras;
    match field {
        "first_name" => !person.first_name.is_empty(),
        "last_name" => !person.last_name.is_empty(),
        "date_of_birth" => person.date_of_birth.is_some(),
        "birth_place" => extras.birth_place.is_some(),
        "citizenships" => !extras.citizenships.is_empty(),
        "street" => extras.street.is_some(),
        "zip" => extras.zip.is_some(),
        "city" => extras.city.is_some(),
        "country" => extras.country.is_some(),
        "email" => person.email.is_some(),
        "phone" => person.phone.is_some(),
        "id_document_type" => extras.id_document_type.is_some(),
        "id_document_number" => extras.id_document_number.is_some(),
        "id_issuing_authority" => extras.id_issuing_authority.is_some(),
        "id_issuing_country" => extras.id_issuing_country.is_some(),
        // A document that has expired since it was entered is missing again.
        "id_valid_until" => extras.id_valid_until.is_some_and(|date| date >= today),
        "id_upload" => loaded.has_upload(person.id, UPLOAD_IDENTITY),
        "authority_upload" => loaded.has_upload(person.id, UPLOAD_AUTHORITY),
        _ => true,
    }
}

/// The representation part of `progress.missing_for_submit`, as keys
/// `<slot>_<field>` in form order. The whole list of a place is missing while
/// its person does not exist. An adult first answers the two questions; a
/// minor needs both parents, or the one custodian or guardian (the guardian
/// with the appointment deed).
pub(crate) fn missing_for_submit(loaded: &Loaded, today: NaiveDate) -> Vec<String> {
    representation_missing(loaded, today, loaded.document_stage)
}

pub(crate) fn missing_for_contract(loaded: &Loaded, today: NaiveDate) -> Vec<String> {
    representation_missing(loaded, today, true)
}

pub(crate) async fn contract_details_missing(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    let Some(loaded) = load(conn, lead_id).await? else {
        return Ok(Vec::new());
    };
    if !loaded.representation.minor {
        return Ok(Vec::new());
    }
    Ok(missing_for_contract(&loaded, crate::app_time::today()))
}

/// Call inside the operation's transaction so representation cannot change
/// between validation and creating a contractual record or invitation.
pub(crate) async fn contract_subject_details_missing(
    conn: &mut PgConnection,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
) -> Result<Vec<String>, sqlx::Error> {
    for lead_id in subject_leads(conn, lead_id, patient_id, order_id).await? {
        let missing = contract_details_missing(conn, lead_id).await?;
        if !missing.is_empty() {
            return Ok(missing);
        }
    }
    Ok(Vec::new())
}

/// The leads of a document's lead, patient or order, locked for the caller's
/// transaction.
async fn subject_leads(
    conn: &mut PgConnection,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT l.id FROM leads l WHERE l.qualification_status <> 'deleted' AND (
            l.id=$1 OR l.prospect_patient_id=$2 OR l.converted_patient_id=$2 OR l.repeat_patient_id=$2
            OR EXISTS (SELECT 1 FROM orders o WHERE o.id=$3 AND (o.source_lead_id=l.id
                OR o.patient_id=l.prospect_patient_id OR o.patient_id=l.converted_patient_id OR o.patient_id=l.repeat_patient_id))
        ) ORDER BY l.id FOR UPDATE"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
}

/// Whose data a document's signature needs (DEV 2026-10-19: confirming the
/// GwG sheet of one parent was refused for the other parent's data).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SignatureDetails {
    /// Contracts and every other document of the client side: the
    /// representatives who contract (both parents only under joint custody).
    Contract,
    /// The own document of one representative (its GwG sheet): that person's
    /// data only.
    Representative(Uuid),
    /// The GwG sheet of the adult patient: the patient's own identity
    /// document (owner 2026-10-22: an expired or incomplete document cannot
    /// identify), no representative's data.
    Patient,
    /// The own document of somebody else (the GwG sheet of the payer, whose
    /// data come from the payer's own link): no representative's data.
    Nobody,
    /// The GwG sheet for legal entities of a paying company, organisation or
    /// insurer (owner decision 2026-10-22): the organisation's data, the
    /// person who acts for it, its beneficial owners and its answers.
    PayerOrganisation,
}

impl SignatureDetails {
    /// Reads the document's template (or type) and, for a GwG sheet, its
    /// subject (`generated_bindings.gwg_identification.subject`).
    pub(crate) fn of_document(template: Option<&str>, art: &str, bindings: Option<&Value>) -> Self {
        let gwg_sheet = match template {
            Some(template) => template == "gwg_identification",
            None => art == "gwg_identification",
        };
        if !gwg_sheet {
            return Self::Contract;
        }
        let binding = bindings.and_then(|bindings| bindings.get("gwg_identification"));
        let subject = binding
            .and_then(|binding| binding.get("subject"))
            .and_then(Value::as_str);
        if subject.map(str::trim) == Some("contract_partner") {
            return Self::Patient;
        }
        // The server records the form of the payer's sheet when it makes one.
        let form = binding
            .and_then(|binding| binding.get(crate::routes::documents::GWG_SHEET_FORM_KEY))
            .and_then(Value::as_str);
        if subject.map(str::trim) == Some("payer")
            && form == Some(crate::routes::documents::GWG_LEGAL_ENTITY_FORM)
        {
            return Self::PayerOrganisation;
        }
        subject
            .and_then(subject_representative)
            .map_or(Self::Nobody, Self::Representative)
    }
}

/// [`contract_subject_details_missing`] scoped to the document: a person's
/// own document needs only that person's data. Call inside the operation's
/// transaction.
pub(crate) async fn signature_details_missing(
    conn: &mut PgConnection,
    details: SignatureDetails,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
) -> Result<Vec<String>, sqlx::Error> {
    match details {
        SignatureDetails::Contract => {
            contract_subject_details_missing(conn, lead_id, patient_id, order_id).await
        }
        SignatureDetails::Nobody => Ok(Vec::new()),
        SignatureDetails::PayerOrganisation => {
            for lead_id in subject_leads(conn, lead_id, patient_id, order_id).await? {
                let missing =
                    crate::routes::documents::gwg_legal_entity_signature_missing(conn, lead_id)
                        .await?;
                if !missing.is_empty() {
                    return Ok(missing);
                }
            }
            Ok(Vec::new())
        }
        SignatureDetails::Patient => {
            for lead_id in subject_leads(conn, lead_id, patient_id, order_id).await? {
                let missing =
                    patient_identity_missing(conn, lead_id, crate::app_time::today()).await?;
                if !missing.is_empty() {
                    return Ok(missing);
                }
            }
            Ok(Vec::new())
        }
        SignatureDetails::Representative(id) => {
            for lead_id in subject_leads(conn, lead_id, patient_id, order_id).await? {
                let Some(loaded) = load(conn, lead_id).await? else {
                    continue;
                };
                if loaded.representation.find(id).is_some() {
                    return Ok(missing_for_representative(
                        &loaded,
                        crate::app_time::today(),
                        id,
                    ));
                }
            }
            Ok(Vec::new())
        }
    }
}

/// Why the patient's identity document cannot identify today, as keys
/// `patient_<problem>` (see [`crate::services::identity_document::problems`]).
/// The stored document data are the one source; the wizard's old "passport
/// valid until" is read only while nothing was stored there (like the sheet).
pub(crate) async fn patient_identity_missing(
    conn: &mut PgConnection,
    lead_id: Uuid,
    today: NaiveDate,
) -> Result<Vec<String>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT l.date_of_birth, l.wizard_state->>'passport_expiry' AS legacy_valid_until,
                  g.id_document_type, g.id_document_number, g.id_issuing_authority,
                  g.id_issuing_country, g.id_issued_on, g.id_valid_until,
                  COALESCE(g.id_document_unreadable, false) AS id_document_unreadable
           FROM leads l
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(Vec::new());
    };
    let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
    let (kind, number, authority, country) = (
        text("id_document_type"),
        text("id_document_number"),
        text("id_issuing_authority"),
        text("id_issuing_country"),
    );
    let valid_until = row
        .try_get::<Option<NaiveDate>, _>("id_valid_until")?
        .or_else(|| {
            text("legacy_valid_until")
                .and_then(|value| NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok())
        });
    let document = crate::services::identity_document::Document {
        kind: kind.as_deref(),
        number: number.as_deref(),
        authority: authority.as_deref(),
        country: country.as_deref(),
        issued_on: row.try_get("id_issued_on")?,
        valid_until,
        unreadable: row.try_get("id_document_unreadable")?,
    };
    Ok(crate::services::identity_document::problems(
        &document,
        row.try_get("date_of_birth")?,
        today,
    )
    .into_iter()
    .map(|problem| format!("patient_{problem}"))
    .collect())
}

/// What one representative still lacks for a document of their own, as keys
/// `<slot>_<field>`: the full list of their place, never the other parent's.
/// A person on file without a place in the form (a third parent) needs none.
pub(crate) fn missing_for_representative(
    loaded: &Loaded,
    today: NaiveDate,
    representative_id: Uuid,
) -> Vec<String> {
    let representation = &loaded.representation;
    let Some(person) = representation.find(representative_id) else {
        return Vec::new();
    };
    let Some(slot) = person.slot else {
        return Vec::new();
    };
    let mut missing = if representation.minor {
        let mut missing = place_missing(loaded, today, slot, &MINOR_REQUIRED);
        if slot == SLOT_REP1 && representation.answers.custody() == CUSTODY_GUARDIAN {
            missing.extend(place_missing(
                loaded,
                today,
                SLOT_REP1,
                &["authority_upload"],
            ));
        }
        missing
    } else {
        place_missing(loaded, today, slot, &ADULT_REQUIRED)
    };
    add_identity_problems(&mut missing, slot, person, today);
    missing
}

/// The person's own GwG sheet identifies only with a readable, valid and
/// consistent document (owner 2026-10-22): an expired one is named as such
/// instead of "valid until" missing; an unreadable scan, a number or country
/// that breaks the rules and dates out of order are named too.
fn add_identity_problems(
    missing: &mut Vec<String>,
    slot: &str,
    person: &Representative,
    today: NaiveDate,
) {
    let extras = &person.extras;
    let document = crate::services::identity_document::Document {
        kind: extras.id_document_type.as_deref(),
        number: extras.id_document_number.as_deref(),
        authority: extras.id_issuing_authority.as_deref(),
        country: extras.id_issuing_country.as_deref(),
        issued_on: extras.id_issued_on,
        valid_until: extras.id_valid_until,
        unreadable: extras.id_document_unreadable,
    };
    let problems =
        crate::services::identity_document::problems(&document, person.date_of_birth, today);
    if problems.contains(&"id_document_expired") {
        let valid_until = format!("{slot}_id_valid_until");
        missing.retain(|key| key != &valid_until);
    }
    for problem in problems {
        let key = format!("{slot}_{problem}");
        if !missing.contains(&key) {
            missing.push(key);
        }
    }
}

pub(crate) fn contract_details_incomplete(missing: &[String]) -> axum::response::Response {
    intake::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "representative_details_incomplete",
        "Complete the representative's details before creating a contract or inviting signatures",
        json!({"missing":missing, "scope":"contract"}),
    )
}

/// The refusal of [`signature_details_missing`]: `scope` says whether a
/// contract or one person's own document asked for the data.
pub(crate) fn signature_details_incomplete(
    details: SignatureDetails,
    missing: &[String],
) -> axum::response::Response {
    if details == SignatureDetails::PayerOrganisation {
        return intake::coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "payer_details_incomplete",
            "Complete the paying organisation's details before confirming the signature",
            json!({"missing":missing, "scope":"payer"}),
        );
    }
    if !matches!(
        details,
        SignatureDetails::Representative(_) | SignatureDetails::Patient
    ) {
        return contract_details_incomplete(missing);
    }
    intake::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "representative_details_incomplete",
        "Complete this person's details before confirming the signature",
        json!({"missing":missing, "scope":"person"}),
    )
}

/// What the person of a place still lacks; everything while nobody is there.
fn place_missing(loaded: &Loaded, today: NaiveDate, slot: &str, required: &[&str]) -> Vec<String> {
    let person = loaded.representation.in_slot(slot);
    let mut missing: Vec<_> = required
        .iter()
        .filter(|field| !person.is_some_and(|person| field_filled(loaded, person, field, today)))
        .map(|field| format!("{slot}_{field}"))
        .collect();
    if person.is_some_and(|person| {
        intake::name_needs_latin_spelling(&person.first_name)
            || intake::name_needs_latin_spelling(&person.last_name)
    }) {
        missing.push(format!("{slot}_name_latin"));
    }
    missing
}

fn representation_missing(loaded: &Loaded, today: NaiveDate, full_minor: bool) -> Vec<String> {
    let representation = &loaded.representation;
    let place = |slot: &str, required: &[&str]| place_missing(loaded, today, slot, required);
    let mut missing = Vec::new();
    if representation.minor {
        if representation.answers.custody.is_none() {
            missing.push("custody".to_string());
        }
        let required: &[&str] = if full_minor {
            &MINOR_REQUIRED
        } else {
            &MINOR_INTAKE_REQUIRED
        };
        missing.extend(place(SLOT_REP1, required));
        match representation.answers.custody() {
            CUSTODY_JOINT => missing.extend(place(SLOT_REP2, required)),
            CUSTODY_GUARDIAN if full_minor => {
                missing.extend(place(SLOT_REP1, &["authority_upload"]))
            }
            _ => {}
        }
        return missing;
    }
    // "Does somebody act on your behalf?" first; only its "yes" asks whether
    // that is a court-appointed representative (owner 2026-10-11), and that
    // answer decides whose data the form asks.
    let answers = &representation.answers;
    if answers.has_representative.is_none() {
        missing.push("has_representative".to_string());
    }
    if answers.has_representative == Some(true) && answers.under_guardianship.is_none() {
        missing.push("under_guardianship".to_string());
    }
    if answers.asks_adult_role(ROLE_AUTHORISED_REPRESENTATIVE)
        || representation.in_slot(SLOT_AGENT).is_some()
    {
        missing.extend(place(SLOT_AGENT, &ADULT_REQUIRED));
    }
    if answers.asks_adult_role(ROLE_LEGAL_GUARDIAN) {
        missing.extend(place(SLOT_GUARDIAN, &ADULT_REQUIRED));
    }
    missing
}

fn date_text(value: Option<NaiveDate>) -> Option<String> {
    value.map(|date| date.format("%Y-%m-%d").to_string())
}

/// The keys of a person both the cabinet and the staff wizard get.
fn person_json(person: &Representative) -> Map<String, Value> {
    let extras = &person.extras;
    let value = json!({
        "id": person.id,
        "slot": person.slot,
        "role": person.role,
        "relation": person.relation,
        "first_name": person.first_name,
        "last_name": person.last_name,
        "date_of_birth": date_text(person.date_of_birth),
        "birth_place": extras.birth_place,
        "birth_country": extras.birth_country,
        "citizenships": extras.citizenships,
        "street": extras.street,
        "zip": extras.zip,
        "city": extras.city,
        "country": extras.country,
        "email": person.email,
        "phone": person.phone,
        "id_document_type": extras.id_document_type,
        "id_document_number": extras.id_document_number,
        "id_issuing_authority": extras.id_issuing_authority,
        "id_issuing_country": extras.id_issuing_country,
        "id_issued_on": date_text(extras.id_issued_on),
        "id_valid_until": date_text(extras.id_valid_until),
        "country_questions": representative_question_fields(extras),
    });
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

/// The answers as the request object and the staff wizard show them: an adult
/// has no custody, a minor no adult answers; a minor's custody is never null.
fn answers_json(representation: &Representation) -> Map<String, Value> {
    let answers = &representation.answers;
    let value = if representation.minor {
        json!({
            "has_representative": null,
            "under_guardianship": null,
            "custody": answers.custody(),
            "custody_stated": answers.custody.is_some(),
        })
    } else {
        json!({
            "has_representative": answers.has_representative,
            "under_guardianship": answers.under_guardianship,
            "custody": null,
            "custody_stated": false,
        })
    };
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

/// `representation` of the request object (always an object). `mine` is the
/// entry the caller's login was issued for.
pub(crate) fn portal_payload(loaded: &Loaded, user_id: Uuid) -> Value {
    let files = |person: &Representative, kind: &str| -> Vec<Value> {
        loaded
            .uploads
            .iter()
            .filter(|upload| upload.representative_id == person.id && upload.kind == kind)
            .map(|upload| {
                let mine = upload.uploaded_by == Some(user_id);
                json!({
                    "id": upload.document_id,
                    "file_name": upload.file_name,
                    "size_bytes": upload.size_bytes,
                    "mime_type": upload.mime_type,
                    "uploaded_at": upload.uploaded_at,
                    "uploaded_by_me": mine,
                    "uploaded_by_staff": upload.by_staff,
                    "reviewed": upload.reviewed,
                    "can_delete": mine && !upload.locked,
                })
            })
            .collect()
    };
    let representatives = loaded
        .representation
        .representatives
        .iter()
        .map(|person| {
            let mut value = person_json(person);
            value.insert(
                "mine".into(),
                json!(person.login_user_ids.contains(&user_id)),
            );
            let staff_email = loaded.representation.minor && person.email_set_by_staff();
            value.insert(
                "email_locked".into(),
                json!(person.has_login() || staff_email),
            );
            value.insert(
                "email_locked_reason".into(),
                json!(if person.has_login() {
                    Some("login")
                } else if staff_email {
                    Some("staff")
                } else {
                    None
                }),
            );
            value.insert("can_remove".into(), json!(loaded.can_remove(person)));
            value.insert(
                "identity_locked".into(),
                json!(loaded.identity_locked(person, user_id)),
            );
            value.insert(
                "identity_documents".into(),
                json!(files(person, UPLOAD_IDENTITY)),
            );
            value.insert(
                "authority_documents".into(),
                json!(files(person, UPLOAD_AUTHORITY)),
            );
            Value::Object(value)
        })
        .collect::<Vec<_>>();
    let mut payload = answers_json(&loaded.representation);
    payload.insert("document_stage".into(), json!(loaded.document_stage));
    payload.insert(
        "phase".into(),
        json!(if loaded.representation.minor && !loaded.document_stage {
            "intake"
        } else {
            "documents"
        }),
    );
    // Staff stated the custody: the cabinet shows it as text (owner 2026-10-22).
    payload.insert(
        "custody_set_by_staff".into(),
        json!(loaded.representation.minor && loaded.custody_set_by_staff),
    );
    payload.insert("representatives".into(), Value::Array(representatives));
    Value::Object(payload)
}

/// `representation` of `GET /leads/{id}/portal-intake` and of the two staff
/// endpoints: what the cabinet shows, with what staff need to know about the
/// trusted contact instead of the caller's own flags.
pub(crate) fn staff_payload(loaded: &Loaded) -> Value {
    let files = |person: &Representative, kind: &str| -> Vec<Value> {
        loaded
            .uploads
            .iter()
            .filter(|upload| upload.representative_id == person.id && upload.kind == kind)
            .map(|upload| {
                json!({
                    "id": upload.document_id,
                    "file_name": upload.file_name,
                    "mime_type": upload.mime_type,
                    "uploaded_at": upload.uploaded_at,
                    "uploaded_by_staff": upload.by_staff,
                    "reviewed": upload.reviewed,
                })
            })
            .collect()
    };
    let representatives = loaded
        .representation
        .representatives
        .iter()
        .map(|person| {
            let mut value = person_json(person);
            value.insert("has_login".into(), json!(person.has_login()));
            value.insert("has_data".into(), json!(person.has_data));
            value.insert(
                "contact_origin".into(),
                json!(
                    person
                        .has_data
                        .then_some(person.extras.contact_origin.as_str())
                ),
            );
            value.insert(
                "identity_documents".into(),
                json!(files(person, UPLOAD_IDENTITY)),
            );
            value.insert(
                "authority_documents".into(),
                json!(files(person, UPLOAD_AUTHORITY)),
            );
            Value::Object(value)
        })
        .collect::<Vec<_>>();
    let mut payload = answers_json(&loaded.representation);
    payload.insert("document_stage".into(), json!(loaded.document_stage));
    payload.insert(
        "phase".into(),
        json!(if loaded.representation.minor && !loaded.document_stage {
            "intake"
        } else {
            "documents"
        }),
    );
    payload.insert("representatives".into(), Value::Array(representatives));
    Value::Object(payload)
}

/// When the lead or a parent last changed the representation: the marker of
/// the last cabinet write or a later upload of a representative's file.
pub(crate) fn updated_at(loaded: &Loaded, field_updates: &Value) -> Option<DateTime<Utc>> {
    let marked = field_updates
        .get(REPRESENTATION_MARKER)
        .and_then(|marker| marker.get("at"))
        .and_then(Value::as_str)
        .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
        .map(|at| at.with_timezone(&Utc));
    loaded
        .uploads
        .iter()
        .filter(|upload| !upload.by_staff)
        .filter_map(|upload| upload.uploaded_at)
        .chain(marked)
        .max()
}

/// Stable text of what the cabinet entered, for the marker in
/// `leads.portal_field_updates` (answers and persons, not the files).
fn marker_value(loaded: &Loaded) -> String {
    let mut value = answers_json(&loaded.representation);
    value.insert(
        "representatives".into(),
        Value::Array(
            loaded
                .representation
                .representatives
                .iter()
                .map(|person| Value::Object(person_json(person)))
                .collect(),
        ),
    );
    Value::Object(value).to_string()
}

// ----------------------------------------------------------------------------
// The person as the cabinet edits it
// ----------------------------------------------------------------------------

/// The editable values of one representative: the contact part (name, date
/// of birth, e-mail, phone) and the row.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Person {
    first_name: Option<String>,
    last_name: Option<String>,
    date_of_birth: Option<NaiveDate>,
    birth_place: Option<String>,
    birth_country: Option<String>,
    citizenships: Vec<String>,
    street: Option<String>,
    zip: Option<String>,
    city: Option<String>,
    country: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    id_document_type: Option<String>,
    id_document_number: Option<String>,
    id_issuing_authority: Option<String>,
    id_issuing_country: Option<String>,
    id_issued_on: Option<NaiveDate>,
    id_valid_until: Option<NaiveDate>,
}

impl Person {
    fn of(person: &Representative) -> Self {
        let extras = &person.extras;
        let filled = |value: &str| (!value.is_empty()).then(|| value.to_string());
        Person {
            first_name: filled(&person.first_name),
            last_name: filled(&person.last_name),
            date_of_birth: person.date_of_birth,
            birth_place: extras.birth_place.clone(),
            birth_country: extras.birth_country.clone(),
            citizenships: extras.citizenships.clone(),
            street: extras.street.clone(),
            zip: extras.zip.clone(),
            city: extras.city.clone(),
            country: extras.country.clone(),
            email: person.email.clone(),
            phone: person.phone.clone(),
            id_document_type: extras.id_document_type.clone(),
            id_document_number: extras.id_document_number.clone(),
            id_issuing_authority: extras.id_issuing_authority.clone(),
            id_issuing_country: extras.id_issuing_country.clone(),
            id_issued_on: extras.id_issued_on,
            id_valid_until: extras.id_valid_until,
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "first_name": self.first_name,
            "last_name": self.last_name,
            "date_of_birth": date_text(self.date_of_birth),
            "birth_place": self.birth_place,
            "birth_country": self.birth_country,
            "citizenships": self.citizenships,
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "email": self.email,
            "phone": self.phone,
            "id_document_type": self.id_document_type,
            "id_document_number": self.id_document_number,
            "id_issuing_authority": self.id_issuing_authority,
            "id_issuing_country": self.id_issuing_country,
            "id_issued_on": date_text(self.id_issued_on),
            "id_valid_until": date_text(self.id_valid_until),
        })
    }

    /// "First Last", the name of the trusted contact entry.
    fn name(&self) -> String {
        full_name(
            self.first_name.as_deref().unwrap_or_default(),
            self.last_name.as_deref().unwrap_or_default(),
        )
    }

    /// The address in one line for the readers of the entry's `address`:
    /// "street, zip city, country" with the German name of the country.
    fn address_line(&self) -> Option<String> {
        let locality = [self.zip.as_deref(), self.city.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let line = [
            self.street.clone(),
            Some(locality),
            self.country
                .as_deref()
                .map(crate::routes::documents::german_document_country),
        ]
        .into_iter()
        .flatten()
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
        (!line.is_empty()).then_some(line)
    }
}

/// The names of the fields that differ, in form order.
fn changed_person_fields(before: &Person, after: &Person) -> Vec<&'static str> {
    let (before, after) = (before.to_json(), after.to_json());
    PERSON_FIELDS
        .iter()
        .copied()
        .filter(|field| before[*field] != after[*field])
        .collect()
}

/// The changed keys of one person as the cabinet sent them (`null` or an
/// empty string clears a value), with the role.
#[derive(Debug, Default, PartialEq, Eq)]
struct PersonPatch {
    role: Option<String>,
    texts: HashMap<&'static str, String>,
    citizenships: Option<Vec<String>>,
}

impl PersonPatch {
    fn text(&self, field: &str) -> Option<&str> {
        self.texts.get(field).map(String::as_str)
    }

    fn sends_address(&self) -> bool {
        ["street", "zip", "city", "country"]
            .iter()
            .any(|field| self.texts.contains_key(field))
    }
}

/// 422 `invalid_field` naming a key of the body.
fn invalid_key(key: &str, message: &str) -> axum::response::Response {
    intake::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_field",
        message,
        json!({ "field": key }),
    )
}

/// Reads the body of the upsert: only known keys, each a text or `null`
/// (`citizenships` a list of texts or `null`).
#[allow(clippy::result_large_err)]
fn parse_person_patch(body: &Value) -> Result<PersonPatch, axum::response::Response> {
    let Some(object) = body.as_object() else {
        return Err(invalid_key("body", "A JSON object is expected"));
    };
    let mut patch = PersonPatch::default();
    for (key, value) in object {
        if key == "citizenships" {
            let codes = match value {
                Value::Null => Some(Vec::new()),
                Value::Array(items) => items
                    .iter()
                    .map(|item| item.as_str().map(str::to_string))
                    .collect::<Option<Vec<_>>>(),
                _ => None,
            };
            let Some(codes) = codes else {
                return Err(invalid_key(key, "A list of country codes is expected"));
            };
            patch.citizenships = Some(codes);
            continue;
        }
        let text = match value {
            Value::Null => String::new(),
            Value::String(text) => text.clone(),
            _ => return Err(invalid_key(key, "A text is expected")),
        };
        if key == "role" {
            patch.role = Some(text.trim().to_lowercase());
        } else if let Some(field) = PERSON_FIELDS
            .iter()
            .copied()
            .find(|field| *field == key.as_str())
        {
            patch.texts.insert(field, text);
        } else {
            return Err(invalid_key(key, "Unknown field"));
        }
    }
    Ok(patch)
}

fn iso_country(value: &str, field: &'static str) -> Result<Option<String>, FieldError> {
    normalize_country_code(Some(value))
        .map_err(|_| field_error(field, "Use an ISO 3166-1 alpha-2 country code"))
}

/// Applies `patch` to `current`; the result is what gets stored. A
/// representative is of full age and has a last name; a sent expiry date in
/// the past is refused with its own code.
fn apply_person_patch(
    current: &Person,
    patch: &PersonPatch,
    today: NaiveDate,
) -> Result<Person, FieldError> {
    let earliest = NaiveDate::from_ymd_opt(1900, 1, 1).unwrap_or(today);
    let mut next = current.clone();
    if let Some(value) = patch.text("first_name") {
        next.first_name = intake::clean_text(value, "first_name", 100)?;
    }
    if let Some(value) = patch.text("last_name") {
        next.last_name = intake::clean_text(value, "last_name", 100)?;
    }
    if let Some(value) = patch.text("date_of_birth") {
        let date = intake::optional_date(value, "date_of_birth")?;
        if let Some(date) = date {
            if date > today {
                return Err(field_error(
                    "date_of_birth",
                    "Date of birth is in the future",
                ));
            }
            if date < earliest {
                return Err(field_error("date_of_birth", "Date of birth is too early"));
            }
            if crate::routes::leads::is_minor_on(Some(date), today) {
                return Err(field_error(
                    "date_of_birth",
                    "A representative is of full age",
                ));
            }
        }
        next.date_of_birth = date;
    }
    if let Some(value) = patch.text("birth_place") {
        next.birth_place = intake::clean_text(value, "birth_place", 200)?;
    }
    if let Some(value) = patch.text("birth_country") {
        next.birth_country = iso_country(value, "birth_country")?;
    }
    if let Some(values) = &patch.citizenships {
        next.citizenships = normalize_citizenships(values)
            .map_err(|message| field_error("citizenships", message))?;
    }
    if let Some(value) = patch.text("street") {
        next.street = intake::clean_text(value, "street", 200)?;
    }
    if let Some(value) = patch.text("zip") {
        next.zip = intake::clean_text(value, "zip", 20)?;
    }
    if let Some(value) = patch.text("city") {
        next.city = intake::clean_text(value, "city", 200)?;
    }
    if let Some(value) = patch.text("country") {
        next.country = iso_country(value, "country")?;
    }
    if let Some(value) = patch.text("email") {
        let email = intake::clean_text(value, "email", 254)?.map(|email| email.to_lowercase());
        if email
            .as_deref()
            .is_some_and(|email| !is_plausible_email(email))
        {
            return Err(field_error("email", "Invalid e-mail address"));
        }
        next.email = email;
    }
    if let Some(value) = patch.text("phone") {
        next.phone = intake::clean_phone(value, "phone")?;
    }
    if let Some(value) = patch.text("id_document_type") {
        next.id_document_type =
            intake::one_of(value, "id_document_type", &intake::ID_DOCUMENT_TYPE_VALUES)?;
    }
    if let Some(value) = patch.text("id_document_number") {
        next.id_document_number =
            crate::services::identity_document::document_number(value, "id_document_number")?;
    }
    if let Some(value) = patch.text("id_issuing_authority") {
        next.id_issuing_authority = intake::clean_text(value, "id_issuing_authority", 200)?;
    }
    if let Some(value) = patch.text("id_issuing_country") {
        next.id_issuing_country = iso_country(value, "id_issuing_country")?;
    }
    if let Some(value) = patch.text("id_issued_on") {
        let issued_on = intake::optional_date(value, "id_issued_on")?;
        if issued_on.is_some_and(|date| date > today) {
            return Err(field_error(
                "id_issued_on",
                "Date of issue is in the future",
            ));
        }
        if issued_on.is_some_and(|date| date < earliest) {
            return Err(field_error("id_issued_on", "Date of issue is too early"));
        }
        next.id_issued_on = issued_on;
    }
    if let Some(value) = patch.text("id_valid_until") {
        let valid_until = intake::optional_date(value, "id_valid_until")?;
        // The last day of validity still counts.
        if valid_until.is_some_and(|date| date < today) {
            return Err(FieldError {
                code: "id_document_expired",
                field: "id_valid_until",
                message: "The identity document has expired",
            });
        }
        next.id_valid_until = valid_until;
    }
    // The dates of the document fit together and the holder's birth, checked
    // only when one of them changes (old rows still load and save).
    if patch.text("id_issued_on").is_some() || patch.text("id_valid_until").is_some() {
        crate::services::identity_document::check_dates(
            next.id_issued_on,
            next.id_valid_until,
            next.date_of_birth,
            today,
        )?;
    }
    // The trusted contact entry is named by it, and the wizard refuses a
    // contact without a name.
    if next.last_name.is_none() {
        return Err(field_error("last_name", "Required"));
    }
    Ok(next)
}

// ----------------------------------------------------------------------------
// Storage: the entry and the row
// ----------------------------------------------------------------------------

/// Writes the person into the trusted contact entry `id` (name, date of
/// birth, e-mail, phone; the one-line address when an address key was sent),
/// or appends a new entry with `relation`.
fn write_entry(
    contacts: &mut Vec<Value>,
    id: Uuid,
    person: &Person,
    relation: &str,
    address_sent: bool,
) {
    let name = person.name();
    let birth_date = date_text(person.date_of_birth);
    if let Some(entry) = contacts
        .iter_mut()
        .find(|entry| entry_id(entry) == Some(id))
        .and_then(Value::as_object_mut)
    {
        entry.insert("name".into(), json!(name));
        entry.insert("birth_date".into(), json!(birth_date));
        entry.insert("email".into(), json!(person.email));
        entry.insert("phone".into(), json!(person.phone));
        if address_sent {
            entry.insert("address".into(), json!(person.address_line()));
        }
        return;
    }
    // The keys the wizard writes, in its order.
    contacts.push(json!({
        "id": id,
        "related_patient_id": null,
        "name": name,
        "email": person.email,
        "phone": person.phone,
        "relation": relation,
        "birth_date": birth_date,
        "address": person.address_line(),
    }));
}

/// Writes the row of a representative. An existing row keeps its origin.
async fn store_row(
    conn: &mut PgConnection,
    lead_id: Uuid,
    contact_id: Uuid,
    role: &str,
    origin: &str,
    person: &Person,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_representatives (
               lead_id, contact_id, role, contact_origin, first_name, last_name, birth_place,
               birth_country, citizenships, street, zip, city, country, id_document_type,
               id_document_number, id_issuing_authority, id_issuing_country, id_issued_on,
               id_valid_until, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   $17, $18, $19, $20)
           ON CONFLICT (lead_id, contact_id) DO UPDATE SET
               role = EXCLUDED.role,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               birth_place = EXCLUDED.birth_place,
               birth_country = EXCLUDED.birth_country,
               citizenships = EXCLUDED.citizenships,
               street = EXCLUDED.street,
               zip = EXCLUDED.zip,
               city = EXCLUDED.city,
               country = EXCLUDED.country,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()"#,
    )
    .bind(lead_id)
    .bind(contact_id)
    .bind(role)
    .bind(origin)
    .bind(&person.first_name)
    .bind(&person.last_name)
    .bind(&person.birth_place)
    .bind(&person.birth_country)
    .bind(&person.citizenships)
    .bind(&person.street)
    .bind(&person.zip)
    .bind(&person.city)
    .bind(&person.country)
    .bind(&person.id_document_type)
    .bind(&person.id_document_number)
    .bind(&person.id_issuing_authority)
    .bind(&person.id_issuing_country)
    .bind(person.id_issued_on)
    .bind(person.id_valid_until)
    .bind(actor)
    .execute(conn)
    .await
    .map(|_| ())
}

/// Makes sure a legal representative of a minor has a row before a file is
/// linked to it: a parent staff entered gets an empty one (`staff`). Returns
/// whether the person is a representative of the lead at all.
pub(crate) async fn ensure_row_for_upload(
    conn: &mut PgConnection,
    lead_id: Uuid,
    representative_id: Uuid,
    actor: Uuid,
) -> Result<bool, sqlx::Error> {
    let Some(loaded) = load(&mut *conn, lead_id).await? else {
        return Ok(false);
    };
    let Some(person) = loaded.representation.find(representative_id) else {
        return Ok(false);
    };
    if !person.has_data {
        store_row(
            conn,
            lead_id,
            representative_id,
            person.role,
            ORIGIN_STAFF,
            &Person::of(person),
            actor,
        )
        .await?;
    }
    Ok(true)
}

/// Whether `representative_id` is a representative of the lead, and the name
/// the uploaded file is labelled with.
pub(crate) async fn upload_target(
    state: &AppState,
    lead_id: Uuid,
    representative_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    let mut conn = state.db.acquire().await?;
    Ok(load(&mut conn, lead_id).await?.and_then(|loaded| {
        loaded
            .representation
            .find(representative_id)
            .map(Representative::name)
    }))
}

/// Writes the trusted contacts (with the single-contact columns the wizard
/// keeps in step with the first entry) and the marker of the cabinet's change.
async fn store_lead(
    conn: &mut PgConnection,
    lead_id: Uuid,
    contacts: Option<&[Value]>,
    marker: &Value,
) -> Result<(), sqlx::Error> {
    let Some(contacts) = contacts else {
        return sqlx::query(
            r#"UPDATE leads
               SET portal_field_updates = portal_field_updates || $2::jsonb, updated_at = now()
               WHERE id = $1"#,
        )
        .bind(lead_id)
        .bind(marker)
        .execute(conn)
        .await
        .map(|_| ());
    };
    let first = contacts.first();
    let text = |key: &str| first.and_then(|entry| entry_text(entry, key));
    sqlx::query(
        r#"UPDATE leads
           SET trusted_contacts = $2::jsonb,
               trusted_contact_name = $3,
               trusted_contact_phone = $4,
               trusted_contact_relation = $5,
               trusted_contact_birth_date = $6,
               trusted_contact_address = $7,
               trusted_contact_email = $8,
               portal_field_updates = portal_field_updates || $9::jsonb,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(Value::Array(contacts.to_vec()))
    .bind(text("name"))
    .bind(text("phone"))
    .bind(text("relation"))
    .bind(text("birth_date").and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok()))
    .bind(text("address"))
    .bind(text("email"))
    .bind(marker)
    .execute(conn)
    .await
    .map(|_| ())
}

/// Stores the trusted contacts when they changed and marks the cabinet's
/// change with the state it led to.
async fn finish_cabinet_write(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    contacts: Option<&[Value]>,
    actor: Uuid,
    kind: AccessKind,
) -> Result<(), sqlx::Error> {
    // The contacts first: the marker is made from the state they lead to.
    if let Some(contacts) = contacts {
        store_lead(&mut *tx, lead_id, Some(contacts), &json!({})).await?;
    }
    super::lead_portal_guardians::auto_link_parent_logins_in_tx(tx, lead_id, Some(actor)).await?;
    // A parent named as invoice recipient is read from the representation
    // whenever section 7 is derived (`lead_invoice_recipient::load_for_lead`):
    // nothing to copy here.
    let state = load(&mut *tx, lead_id).await?.unwrap_or_default();
    let now = intake::portal_update_time(&mut *tx).await?;
    let marker = json!({
        REPRESENTATION_MARKER: {
            "at": now,
            "by": actor,
            "kind": kind.as_str(),
            "hash": intake::value_marker(
                lead_id,
                REPRESENTATION_MARKER,
                Some(&marker_value(&state)),
            ),
        }
    });
    store_lead(&mut *tx, lead_id, None, &marker).await
}

/// Files moved aside by a removal: deleted for good after the commit, moved
/// back when the transaction fails.
#[derive(Default)]
struct StagedFiles(Vec<StagedDocumentDelete>);

impl StagedFiles {
    async fn rollback(&self) {
        for staged in &self.0 {
            crate::routes::documents::rollback_staged_document_delete(staged).await;
        }
    }

    async fn finalize(&self) {
        for staged in &self.0 {
            crate::routes::documents::finalize_staged_document_delete(staged).await;
        }
    }
}

/// 409 `representative_in_use`: the cabinet did not create the person, the
/// person has a login, or staff already use one of its files.
fn in_use() -> axum::response::Response {
    intake::coded(
        StatusCode::CONFLICT,
        "representative_in_use",
        "This person cannot be removed here; please contact GMED",
        json!({}),
    )
}

/// Removes a person the cabinet created, in the caller's transaction: the
/// files are withdrawn like an upload the patient removes himself, the row
/// goes (and with it the registry rows of the files) and the entry leaves
/// `contacts`. The caller checked [`Loaded::can_remove`]; the files are
/// checked again under their lock.
async fn remove_person(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    staged: &mut StagedFiles,
    lead_id: Uuid,
    contacts: &mut Vec<Value>,
    representative_id: Uuid,
    actor: Uuid,
    kind: AccessKind,
) -> Result<usize, axum::response::Response> {
    let uploads = sqlx::query(
        r#"SELECT u.document_id, u.kind, u.reviewed_at, d.storage_key, d.patient_id, d.lead_id,
                  d.signed_at,
                  EXISTS(SELECT 1 FROM document_shares s WHERE s.document_id = d.id) AS shared,
                  EXISTS(SELECT 1 FROM document_review_events r WHERE r.document_id = d.id)
                      AS in_review
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1
             AND u.representative_id = $2
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL
           ORDER BY u.created_at, u.document_id
           FOR UPDATE OF u, d"#,
    )
    .bind(lead_id)
    .bind(representative_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| intake::internal(error, "lock representative uploads"))?;
    let used = uploads.iter().any(|upload| {
        intake::upload_taken_over(upload)
            || upload
                .try_get::<Option<Uuid>, _>("patient_id")
                .ok()
                .flatten()
                .is_some()
            || upload.try_get::<Option<Uuid>, _>("lead_id").ok().flatten() != Some(lead_id)
            || upload.try_get::<bool, _>("shared").unwrap_or(true)
            || upload.try_get::<bool, _>("in_review").unwrap_or(true)
    });
    if used {
        return Err(in_use());
    }
    for upload in &uploads {
        let document_id: Uuid = upload
            .try_get("document_id")
            .map_err(|error| intake::internal(error, "read representative upload"))?;
        let storage_key: Option<String> = upload.try_get("storage_key").ok().flatten();
        let file =
            crate::routes::documents::stage_document_file_delete(storage_key.as_deref()).await?;
        let file_removed = file.is_some();
        staged.0.extend(file);
        let withdrawn = async {
            sqlx::query(
                r#"UPDATE documents
                   SET status = 'archived',
                       visibility = 'internal',
                       storage_key = NULL,
                       file_deleted_at = now(),
                       file_deleted_by = $2,
                       file_delete_reason = 'Removed by the patient in the portal before review'
                   WHERE id = $1"#,
            )
            .bind(document_id)
            .bind(actor)
            .execute(&mut **tx)
            .await?;
            sqlx::query(
                "UPDATE lead_portal_uploads SET withdrawn_at = now() WHERE document_id = $1",
            )
            .bind(document_id)
            .execute(&mut **tx)
            .await?;
            audit::write_in_transaction(
                &mut *tx,
                &audit::domain_event(
                    "lead_portal_withdraw_document",
                    Some(actor),
                    "document",
                    Some(document_id),
                    json!({
                        "lead_id": lead_id,
                        "access_kind": kind.as_str(),
                        "kind": upload.try_get::<String, _>("kind").unwrap_or_default(),
                        "file_removed_from_disk": file_removed,
                        "representative_removed": true,
                    }),
                ),
            )
            .await
        }
        .await;
        withdrawn.map_err(|error| intake::internal(error, "withdraw representative upload"))?;
        // What was derived from the file goes with it, translations made as
        // documents of their own included; their files are staged with the
        // upload's, so a failed transaction keeps them.
        let derived = crate::routes::documents::purge_document_derived_content_in_tx(
            tx,
            &[document_id],
            Some(actor),
        )
        .await
        .map_err(|error| {
            intake::internal(error, "remove derived content of representative upload")
        })?;
        for storage_key in &derived.translated_document_files {
            staged.0.extend(
                crate::routes::documents::stage_document_file_delete(Some(storage_key.as_str()))
                    .await?,
            );
        }
    }
    sqlx::query("DELETE FROM lead_representatives WHERE lead_id = $1 AND contact_id = $2")
        .bind(lead_id)
        .bind(representative_id)
        .execute(&mut **tx)
        .await
        .map_err(|error| intake::internal(error, "delete representative"))?;
    contacts.retain(|entry| entry_id(entry) != Some(representative_id));
    audit::write_in_transaction(
        &mut *tx,
        &audit::domain_event(
            "lead_portal_remove_representative",
            Some(actor),
            "lead",
            Some(lead_id),
            json!({
                "representative_id": representative_id,
                "access_kind": kind.as_str(),
                "documents_withdrawn": uploads.len(),
            }),
        ),
    )
    .await
    .map_err(|error| intake::internal(error, "audit representative removal"))?;
    Ok(uploads.len())
}

/// The request object after a cabinet call.
async fn request_response(
    state: &AppState,
    lead_id: Uuid,
    user_id: Uuid,
    kind: AccessKind,
    status: StatusCode,
) -> axum::response::Response {
    match intake::request_payload(state, lead_id, user_id, kind).await {
        Ok(payload) => (status, Json(payload)).into_response(),
        Err(error) => intake::internal(error, "load request"),
    }
}

/// Tells an open staff wizard that the lead's representation changed in the
/// cabinet (answers, a person or a person's file).
pub(crate) async fn publish_cabinet_change(
    state: &AppState,
    lead_id: Uuid,
    user_id: Uuid,
    kind: AccessKind,
) {
    crate::realtime::publish_lead_event(
        state,
        Some(user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": REPRESENTATION_MARKER, "access_kind": kind.as_str() }),
    )
    .await;
}

// ----------------------------------------------------------------------------
// Cabinet endpoints
// ----------------------------------------------------------------------------

/// The changed answers of `POST …/representation`.
#[derive(Debug, Default, PartialEq, Eq)]
struct AnswersPatch {
    has_representative: Option<Option<bool>>,
    under_guardianship: Option<Option<bool>>,
    custody: Option<Option<String>>,
}

/// Reads the body of `POST …/representation`: an adult answers the two
/// questions (`true`, `false`, `null`), a parent states the custody. A key
/// that does not fit the lead's age and an unknown key are refused.
#[allow(clippy::result_large_err)]
fn parse_answers_patch(
    body: &Value,
    minor: bool,
) -> Result<AnswersPatch, axum::response::Response> {
    let Some(object) = body.as_object() else {
        return Err(invalid_key("body", "A JSON object is expected"));
    };
    let mut patch = AnswersPatch::default();
    for (key, value) in object {
        match key.as_str() {
            "has_representative" | "under_guardianship" => {
                if minor {
                    return Err(invalid_key(
                        key,
                        "Not asked for a minor: the legal representatives act",
                    ));
                }
                let answer = match value {
                    Value::Null => None,
                    Value::Bool(answer) => Some(*answer),
                    _ => return Err(invalid_key(key, "true, false or null is expected")),
                };
                if key == "has_representative" {
                    patch.has_representative = Some(answer);
                } else {
                    patch.under_guardianship = Some(answer);
                }
            }
            "custody" => {
                if !minor {
                    return Err(invalid_key(key, "Only asked for a minor"));
                }
                patch.custody = Some(parse_custody(value).map_err(|()| {
                    invalid_key(key, "joint, sole_parent or guardian is expected")
                })?);
            }
            _ => return Err(invalid_key(key, "Unknown field")),
        }
    }
    Ok(patch)
}

/// One of [`CUSTODY_VALUES`]; `null` or an empty text takes the statement back.
fn parse_custody(value: &Value) -> Result<Option<String>, ()> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) => {
            let text = text.trim().to_lowercase();
            if text.is_empty() {
                Ok(None)
            } else if CUSTODY_VALUES.contains(&text.as_str()) {
                Ok(Some(text))
            } else {
                Err(())
            }
        }
        _ => Err(()),
    }
}

async fn store_answers(
    conn: &mut PgConnection,
    lead_id: Uuid,
    answers: &Answers,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_gwg_declarations (
               lead_id, has_representative, under_guardianship, custody, updated_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (lead_id) DO UPDATE SET
               has_representative = EXCLUDED.has_representative,
               under_guardianship = EXCLUDED.under_guardianship,
               custody = EXCLUDED.custody,
               -- A custody the cabinet states is the cabinet's.
               custody_set_by_staff = lead_gwg_declarations.custody_set_by_staff
                   AND lead_gwg_declarations.custody IS NOT DISTINCT FROM EXCLUDED.custody,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()"#,
    )
    .bind(lead_id)
    .bind(answers.has_representative)
    .bind(answers.under_guardianship)
    .bind(&answers.custody)
    .bind(actor)
    .execute(conn)
    .await
    .map(|_| ())
}

/// `POST /me/lead-requests/{lead_id}/representation`: the answers that decide
/// who is asked for. An adult's "no" (or a taken-back answer) removes the
/// person entered for that question; leaving joint custody removes every
/// further representative the cabinet created. A person staff entered stays
/// on file without a place in the form.
pub(crate) async fn update_my_representation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let kind = match intake::lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "lock request"),
    };
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "load representation"),
    };
    let representation = &loaded.representation;
    let patch = match parse_answers_patch(&body, representation.minor) {
        Ok(patch) => patch,
        Err(response) => return response,
    };
    // A custody staff stated is read-only in the cabinet (owner decision
    // 2026-10-22): the parent writes to GMED instead. The same value is no
    // change.
    if patch.custody.as_ref().is_some_and(|custody| {
        loaded.custody_set_by_staff && *custody != representation.answers.custody
    }) {
        return intake::coded(
            StatusCode::CONFLICT,
            "custody_set_by_staff",
            "GMED staff stated the custody; it is changed by GMED only",
            json!({ "field": "custody" }),
        );
    }
    let mut next = representation.answers.clone();
    // The persons that go with the change.
    let mut removed: Vec<Uuid> = Vec::new();
    if let Some(answer) = patch.has_representative {
        next.has_representative = answer;
    }
    if let Some(answer) = patch.under_guardianship {
        next.under_guardianship = answer;
    }
    // The court-appointed question belongs to the "yes" of "does somebody
    // act on your behalf?" (owner 2026-10-11): without it, it goes.
    if !representation.minor && next.has_representative != Some(true) {
        next.under_guardianship = None;
    }
    if !representation.minor {
        for role in [ROLE_AUTHORISED_REPRESENTATIVE, ROLE_LEGAL_GUARDIAN] {
            let Some(person) = representation
                .with_role(role)
                .filter(|person| person.slot.is_some())
            else {
                continue;
            };
            // The person of an answer that no longer asks for anybody goes.
            if !next.keeps_adult_role(role, true) {
                if !loaded.can_remove(person) {
                    continue;
                }
                removed.push(person.id);
            } else if role == ROLE_AUTHORISED_REPRESENTATIVE
                && next.under_guardianship == Some(true)
                && representation.answers.under_guardianship != Some(true)
                && loaded.can_remove(person)
            {
                // The person who acts is the court-appointed representative
                // after all: the one the cabinet entered as authorised goes.
                removed.push(person.id);
            }
        }
    }
    if let Some(custody) = patch.custody {
        let before = representation.answers.custody().to_string();
        next.custody = custody;
        if next.custody() != before && next.custody() != CUSTODY_JOINT {
            removed.extend(
                representation
                    .representatives
                    .iter()
                    .filter(|person| person.slot != Some(SLOT_REP1) && loaded.can_remove(person))
                    .map(|person| person.id),
            );
        }
        // A contact marked as guardian (Vormund) that stays needs the custody
        // "guardian": the same refusal as staff's custody endpoint (owner
        // 2026-10-22); the contact's relation is changed by GMED.
        if next.custody != representation.answers.custody
            && next.custody.as_deref() != Some(CUSTODY_GUARDIAN)
            && let Some((index, person)) =
                representation
                    .representatives
                    .iter()
                    .enumerate()
                    .find(|(_, person)| {
                        !removed.contains(&person.id)
                            && crate::routes::leads::is_legal_guardian_relation(
                                person.relation.as_deref(),
                            )
                    })
        {
            return intake::coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                crate::routes::leads::RELATION_GUARDIAN_NEEDS_CUSTODY,
                "A contact is marked as guardian (Vormund); GMED changes its relation first",
                json!({
                    "error": crate::routes::leads::RELATION_GUARDIAN_NEEDS_CUSTODY,
                    "field": "custody",
                    "contact_index": index,
                    "contact_id": person.id,
                    "contact_name": person.name(),
                    "contact_field": "relation",
                }),
            );
        }
    }
    let fields = [
        (
            "has_representative",
            next.has_representative != representation.answers.has_representative,
        ),
        (
            "under_guardianship",
            next.under_guardianship != representation.answers.under_guardianship,
        ),
        ("custody", next.custody != representation.answers.custody),
    ]
    .into_iter()
    .filter_map(|(field, changed)| changed.then_some(field))
    .collect::<Vec<_>>();
    if fields.is_empty() && removed.is_empty() {
        drop(tx);
        return request_response(&state, lead_id, auth.user_id, kind, StatusCode::OK).await;
    }

    let mut staged = StagedFiles::default();
    let mut contacts = loaded.contacts.clone();
    let mut invalidated = Vec::new();
    let written = async {
        if !fields.is_empty() {
            store_answers(&mut tx, lead_id, &next, auth.user_id)
                .await
                .map_err(|error| intake::internal(error, "store representation"))?;
        }
        for representative_id in &removed {
            remove_person(
                &mut tx,
                &mut staged,
                lead_id,
                &mut contacts,
                *representative_id,
                auth.user_id,
                kind,
            )
            .await?;
        }
        finish_cabinet_write(
            &mut tx,
            lead_id,
            (!removed.is_empty()).then_some(contacts.as_slice()),
            auth.user_id,
            kind,
        )
        .await
        .map_err(|error| intake::internal(error, "mark representation"))?;
        invalidated = crate::document_signatures::invalidate_representative_identity(
            &mut tx,
            lead_id,
            auth.user_id,
        )
        .await
        .map_err(|error| intake::internal(error, "invalidate representative invitation"))?
        .1;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "lead_portal_update_representation",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({
                    "fields": fields,
                    "removed_representatives": removed,
                    "access_kind": kind.as_str(),
                }),
            ),
        )
        .await
        .map_err(|error| intake::internal(error, "audit representation"))?;
        Ok::<_, axum::response::Response>(())
    }
    .await;
    if let Err(response) = written {
        staged.rollback().await;
        return response;
    }
    if let Err(error) = tx.commit().await {
        staged.rollback().await;
        return intake::internal(error, "commit representation");
    }
    staged.finalize().await;
    crate::document_signatures::withdraw_invalidated_consents(&state, &invalidated).await;
    publish_cabinet_change(&state, lead_id, auth.user_id, kind).await;
    request_response(&state, lead_id, auth.user_id, kind, StatusCode::OK).await
}

/// The roles a person of this lead can have: a minor has legal
/// representatives, an adult a representative and a legal guardian.
fn role_fits(role: &str, minor: bool) -> Option<&'static str> {
    match (role, minor) {
        (ROLE_LEGAL_REPRESENTATIVE, true) => Some(ROLE_LEGAL_REPRESENTATIVE),
        (ROLE_AUTHORISED_REPRESENTATIVE, false) => Some(ROLE_AUTHORISED_REPRESENTATIVE),
        (ROLE_LEGAL_GUARDIAN, false) => Some(ROLE_LEGAL_GUARDIAN),
        _ => None,
    }
}

fn role_invalid() -> axum::response::Response {
    intake::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "representative_role_invalid",
        "This role does not fit the request or the person",
        json!({ "field": "role" }),
    )
}

/// `POST /me/lead-requests/{lead_id}/representatives/{representative_id}`:
/// autosave of one person (only the changed keys). A known person is changed;
/// an unknown id creates the trusted contact entry and its row (201). The
/// entry and the row are written in one transaction.
pub(crate) async fn upsert_my_representative(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    // The identity document data of a representative are staff's (trigger
    // flow 2026-10-07): the cabinet uploads the document only.
    if let Some(field) = body.as_object().and_then(|object| {
        object
            .keys()
            .find(|key| crate::risk::cabinet::is_id_data_key(key))
    }) {
        return crate::risk::cabinet::staff_only(field);
    }
    let patch = match parse_person_patch(&body) {
        Ok(patch) => patch,
        Err(response) => return response,
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let kind = match intake::lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "lock request"),
    };
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "load representation"),
    };
    let representation = &loaded.representation;
    let answers = &representation.answers;
    let known = representation.find(representative_id);

    // Who the person is: the stored role, or the one sent for a new person.
    let role = match (known, patch.role.as_deref()) {
        (Some(person), None) => person.role,
        (Some(person), Some(role)) if role == person.role => person.role,
        (Some(_), Some(_)) => return role_invalid(),
        (None, role) => match role.and_then(|role| role_fits(role, representation.minor)) {
            Some(role) => role,
            None => return role_invalid(),
        },
    };
    // An adult's person belongs to the answers that ask for it.
    let declared = match role {
        ROLE_AUTHORISED_REPRESENTATIVE | ROLE_LEGAL_GUARDIAN => {
            answers.keeps_adult_role(role, known.is_some())
        }
        _ => true,
    };
    if !declared {
        return intake::coded(
            StatusCode::CONFLICT,
            "representation_not_declared",
            "Answer the question with yes before entering this person",
            json!({}),
        );
    }
    if known.is_none() {
        // The id of another trusted contact cannot become a representative.
        if loaded
            .contacts
            .iter()
            .any(|entry| entry_id(entry) == Some(representative_id))
            || loaded.rows.contains_key(&representative_id)
        {
            return intake::coded(
                StatusCode::CONFLICT,
                "representative_id_taken",
                "This id belongs to another contact of the request",
                json!({}),
            );
        }
        let taken = if representation.minor {
            let places = if answers.custody() == CUSTODY_JOINT {
                2
            } else {
                1
            };
            representation.representatives.len() >= places
        } else {
            representation.with_role(role).is_some()
        };
        if taken {
            return intake::coded(
                StatusCode::CONFLICT,
                "representative_limit",
                "Nobody else can be entered here",
                json!({}),
            );
        }
    }

    let current = known.map(Person::of).unwrap_or_default();
    let next = match apply_person_patch(&current, &patch, crate::app_time::today()) {
        Ok(next) => next,
        Err(error) => return error.into_response(),
    };
    if kind == AccessKind::Guardian
        && known.is_some_and(|person| loaded.identity_locked(person, auth.user_id))
    {
        let protected_field = if next.first_name != current.first_name {
            Some("first_name")
        } else if next.last_name != current.last_name {
            Some("last_name")
        } else if next.date_of_birth != current.date_of_birth {
            Some("date_of_birth")
        } else {
            None
        };
        if let Some(field) = protected_field {
            return intake::coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "representative_not_yours",
                "Only this representative can change their name or date of birth; contact GMED for corrections",
                json!({ "field": field }),
            );
        }
    }
    if next.email != current.email {
        // The address of a parent with a login is the login: staff change it.
        if known.is_some_and(Representative::has_login) {
            return intake::coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "representative_email_is_login",
                "This address is the login; GMED changes it on request",
                json!({ "field": "email" }),
            );
        }
        // The address of a parent staff entered decides the automatic link
        // of an existing login: the cabinet cannot redirect it.
        if representation.minor && known.is_some_and(Representative::email_set_by_staff) {
            return intake::coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "representative_email_staff",
                "GMED entered this address; GMED changes it on request",
                json!({ "field": "email" }),
            );
        }
        // Two signers of one request need different addresses.
        let duplicate = next.email.as_deref().is_some_and(|email| {
            representation.representatives.iter().any(|other| {
                other.id != representative_id
                    && other
                        .email
                        .as_deref()
                        .is_some_and(|other| other.trim().eq_ignore_ascii_case(email))
            })
        });
        if duplicate {
            return intake::coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "representative_email_duplicate",
                "Another representative already has this e-mail address",
                json!({ "field": "email" }),
            );
        }
    }
    let fields = changed_person_fields(&current, &next);
    if known.is_some() && fields.is_empty() {
        drop(tx);
        return request_response(&state, lead_id, auth.user_id, kind, StatusCode::OK).await;
    }

    // A new person is a parent, a guardian (Vormund, Betreuer) or the
    // representative of an adult; a known one keeps the relation staff or the
    // cabinet gave it.
    let relation = match role {
        ROLE_AUTHORISED_REPRESENTATIVE => "representative",
        ROLE_LEGAL_GUARDIAN => "guardian",
        _ if answers.custody() == CUSTODY_GUARDIAN => "guardian",
        _ => "parent",
    };
    // A row keeps its origin; a parent staff entered gets one marked so.
    let origin = if known.is_some() {
        ORIGIN_STAFF
    } else {
        ORIGIN_PORTAL
    };
    // Keep the payer attached to this same representative when its name,
    // residence or citizenships are corrected. Match before writing the new
    // representative, so an identity correction cannot detach the payer.
    let parent_payer = match lead_payer::load_declaration(&mut tx, lead_id).await {
        // A declaration that names the representative (kind
        // `representative`) holds no copy of its data: nothing to follow.
        Ok(payer) => payer.filter(|payer| {
            payer.is_third_party()
                && payer_same_person(representation, Some(payer)) == Some(representative_id)
        }),
        Err(error) => return intake::internal(error, "load parent payer"),
    };
    let mut contacts = loaded.contacts.clone();
    let mut invalidated = Vec::new();
    write_entry(
        &mut contacts,
        representative_id,
        &next,
        relation,
        patch.sends_address(),
    );
    let written = async {
        if let Some(mut payer) = parent_payer {
            payer.first_name = next.first_name.clone();
            payer.last_name = next.last_name.clone();
            payer.date_of_birth = next.date_of_birth;
            payer.place_of_birth = next.birth_place.clone();
            payer.citizenships = next.citizenships.clone();
            payer.street = next.street.clone();
            payer.zip = next.zip.clone();
            payer.city = next.city.clone();
            payer.country = next.country.clone();
            payer.email = next.email.clone();
            payer.phone = next.phone.clone();
            lead_payer::adopt_payer_identity(&mut tx, lead_id, &payer, Some(auth.user_id), None)
                .await?;
        }
        store_row(
            &mut tx,
            lead_id,
            representative_id,
            role,
            origin,
            &next,
            auth.user_id,
        )
        .await?;
        finish_cabinet_write(
            &mut tx,
            lead_id,
            Some(contacts.as_slice()),
            auth.user_id,
            kind,
        )
        .await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "lead_portal_update_representative",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({
                    "representative_id": representative_id,
                    "role": role,
                    "created": known.is_none(),
                    "fields": fields,
                    "access_kind": kind.as_str(),
                }),
            ),
        )
        .await?;
        invalidated = crate::document_signatures::invalidate_representative_identity(
            &mut tx,
            lead_id,
            auth.user_id,
        )
        .await?
        .1;
        tx.commit().await
    }
    .await;
    if let Err(error) = written {
        return intake::internal(error, "store representative");
    }
    crate::document_signatures::withdraw_invalidated_consents(&state, &invalidated).await;
    publish_cabinet_change(&state, lead_id, auth.user_id, kind).await;
    let status = if known.is_some() {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    request_response(&state, lead_id, auth.user_id, kind, status).await
}

/// `DELETE /me/lead-requests/{lead_id}/representatives/{representative_id}`:
/// removes a person the cabinet created, with its files. A parent staff
/// entered, a parent with a login and a person whose file staff already use
/// stay: 409 `representative_in_use`.
pub(crate) async fn remove_my_representative(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let kind = match intake::lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "lock request"),
    };
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "load representation"),
    };
    let Some(person) = loaded.representation.find(representative_id) else {
        return intake::err(StatusCode::NOT_FOUND, "Representative not found");
    };
    if !loaded.can_remove(person) {
        return in_use();
    }
    let mut staged = StagedFiles::default();
    let mut contacts = loaded.contacts.clone();
    let mut invalidated = Vec::new();
    let written = async {
        remove_person(
            &mut tx,
            &mut staged,
            lead_id,
            &mut contacts,
            representative_id,
            auth.user_id,
            kind,
        )
        .await?;
        finish_cabinet_write(
            &mut tx,
            lead_id,
            Some(contacts.as_slice()),
            auth.user_id,
            kind,
        )
        .await
        .map_err(|error| intake::internal(error, "mark representation"))?;
        invalidated = crate::document_signatures::invalidate_representative_identity(
            &mut tx,
            lead_id,
            auth.user_id,
        )
        .await
        .map_err(|error| intake::internal(error, "invalidate removed representative invitation"))?
        .1;
        Ok::<(), axum::response::Response>(())
    }
    .await;
    if let Err(response) = written {
        staged.rollback().await;
        return response;
    }
    if let Err(error) = tx.commit().await {
        staged.rollback().await;
        return intake::internal(error, "commit representative removal");
    }
    staged.finalize().await;
    crate::document_signatures::withdraw_invalidated_consents(&state, &invalidated).await;
    publish_cabinet_change(&state, lead_id, auth.user_id, kind).await;
    request_response(&state, lead_id, auth.user_id, kind, StatusCode::OK).await
}

/// `POST …/representatives/{representative_id}/identity-document` (multipart
/// `file`): a photo or scan of the representative's identity document. Never
/// the lead's own identity document.
pub(crate) async fn upload_my_representative_identity_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    multipart: Multipart,
) -> axum::response::Response {
    intake::store_my_upload(
        state,
        auth,
        lead_id,
        multipart,
        UploadKind::RepresentativeIdentity,
        Some(representative_id),
    )
    .await
}

/// `POST …/representatives/{representative_id}/authority-document` (multipart
/// `file`): the proof that the person may act — a power of attorney, the
/// appointment deed of a guardian, a proof of sole custody.
pub(crate) async fn upload_my_representative_authority_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    multipart: Multipart,
) -> axum::response::Response {
    intake::store_my_upload(
        state,
        auth,
        lead_id,
        multipart,
        UploadKind::RepresentativeAuthority,
        Some(representative_id),
    )
    .await
}

// ----------------------------------------------------------------------------
// Staff endpoints
// ----------------------------------------------------------------------------

/// `POST /leads/{lead_id}/representatives/{representative_id}/identity-document`
/// (multipart `file`, `leads.edit`): staff upload the copy of a
/// representative's identity document in the wizard (owner report
/// 2026-10-19), stored and registered like the cabinet's upload.
pub(crate) async fn upload_lead_representative_identity_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    multipart: Multipart,
) -> axum::response::Response {
    store_staff_upload(
        state,
        auth,
        lead_id,
        representative_id,
        multipart,
        UploadKind::RepresentativeIdentity,
    )
    .await
}

/// `POST /leads/{lead_id}/representatives/{representative_id}/authority-document`
/// (multipart `file`, `leads.edit`): staff upload the proof that the person
/// may act (power of attorney, appointment deed, proof of sole custody).
pub(crate) async fn upload_lead_representative_authority_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    multipart: Multipart,
) -> axum::response::Response {
    store_staff_upload(
        state,
        auth,
        lead_id,
        representative_id,
        multipart,
        UploadKind::RepresentativeAuthority,
    )
    .await
}

/// A representative's file uploaded by staff: the document is stored like the
/// cabinet's ([`intake::store_upload_document`]) and registered in
/// `lead_portal_uploads` as `access_kind = 'staff'`, taken over at once (the
/// cabinet cannot remove it) and outside the cabinet's upload limit. The
/// lead must be open and the person a representative of it. Staff remove
/// the file like any document (`POST /documents/{id}/delete`).
async fn store_staff_upload(
    state: AppState,
    auth: AuthUser,
    lead_id: Uuid,
    representative_id: Uuid,
    mut multipart: Multipart,
    upload_kind: UploadKind,
) -> axum::response::Response {
    if let Err(response) = require_staff_editor(&auth) {
        return response;
    }
    // Before the file is stored: the lead is open and the person belongs to it.
    {
        let mut tx = match state.db.begin().await {
            Ok(tx) => tx,
            Err(error) => return intake::internal(error, "begin"),
        };
        if let Err(response) = lock_open_lead(&mut tx, lead_id).await {
            return response;
        }
    }
    let person = match upload_target(&state, lead_id, representative_id).await {
        Ok(Some(name)) => name,
        Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Representative not found"),
        Err(error) => return intake::internal(error, "resolve representative"),
    };
    let (file_name, content_type, data) = match intake::read_upload_file(&mut multipart).await {
        Ok(file) => file,
        Err(response) => return response,
    };
    let stored = match intake::store_upload_document(
        &state,
        lead_id,
        upload_kind,
        &person,
        &file_name,
        content_type.as_deref(),
        &data,
        auth.user_id,
        true,
    )
    .await
    {
        Ok(stored) => stored,
        Err(response) => return response,
    };
    let action = match upload_kind {
        UploadKind::RepresentativeAuthority => "staff_upload_representative_authority",
        _ => "staff_upload_representative_identity",
    };
    let registered: Result<Result<Loaded, axum::response::Response>, sqlx::Error> = async {
        let mut tx = state.db.begin().await?;
        // The lead may have been converted or the person removed meanwhile.
        if let Err(response) = lock_open_lead(&mut tx, lead_id).await {
            return Ok(Err(response));
        }
        if !ensure_row_for_upload(&mut tx, lead_id, representative_id, auth.user_id).await? {
            return Ok(Err(intake::err(
                StatusCode::NOT_FOUND,
                "Representative not found",
            )));
        }
        sqlx::query(
            r#"INSERT INTO lead_portal_uploads
                   (document_id, lead_id, uploaded_by, access_kind, consent_record_id, kind,
                    representative_id, reviewed_at, reviewed_by)
               VALUES ($1, $2, $3, $4, NULL, $5, $6, now(), $3)"#,
        )
        .bind(stored.document_id)
        .bind(lead_id)
        .bind(auth.user_id)
        .bind(ACCESS_STAFF)
        .bind(upload_kind.as_str())
        .bind(representative_id)
        .execute(&mut *tx)
        .await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                action,
                Some(auth.user_id),
                "document",
                Some(stored.document_id),
                json!({
                    "lead_id": lead_id,
                    "representative_id": representative_id,
                    "kind": upload_kind.as_str(),
                    "mime_type": stored.mime_type,
                    "file_size": stored.file_size,
                }),
            ),
        )
        .await?;
        let Some(loaded) = load(&mut tx, lead_id).await? else {
            return Ok(Err(intake::err(StatusCode::NOT_FOUND, "Lead not found")));
        };
        tx.commit().await?;
        Ok(Ok(loaded))
    }
    .await;
    let loaded = match registered {
        Ok(Ok(loaded)) => loaded,
        Ok(Err(response)) => {
            intake::discard_stored_document(&state, stored.document_id, &stored.storage_key).await;
            return response;
        }
        Err(error) => {
            intake::discard_stored_document(&state, stored.document_id, &stored.storage_key).await;
            return intake::internal(error, "register staff upload");
        }
    };
    publish_staff_change(&state, lead_id, auth.user_id).await;
    (
        StatusCode::CREATED,
        Json(json!({
            "document_id": stored.document_id,
            "representation": staff_payload(&loaded),
        })),
    )
        .into_response()
}

const COUNTRY_QUESTION_FIELDS: [&str; 16] = [
    "birth_place",
    "birth_country",
    "residence_since",
    "stay_reason",
    "stay_reason_details",
    "pep_self",
    "pep_related",
    "sanctions_links",
    "pep_office",
    "pep_country",
    "pep_period",
    "pep_relationship",
    "pep_wealth_origin",
    "sanctions_link_name",
    "sanctions_link_kind",
    "sanctions_link_since_extent",
];

pub(crate) fn country_question_fields(stored: &Value) -> Value {
    Value::Object(
        COUNTRY_QUESTION_FIELDS
            .iter()
            .map(|key| {
                (
                    (*key).to_string(),
                    stored.get(*key).cloned().unwrap_or(Value::Null),
                )
            })
            .collect(),
    )
}

/// Birth data remains authoritative in the representative's basic identity.
/// The questionnaire exposes its effective (including linked-patient) values.
pub(crate) fn representative_question_fields(extras: &Extras) -> Value {
    let mut fields = country_question_fields(&extras.country_questions);
    fields["birth_place"] = json!(extras.birth_place);
    fields["birth_country"] = json!(extras.birth_country);
    fields
}

pub(crate) fn country_question_missing(fields: &Value) -> Vec<String> {
    let blank = |key: &str| {
        fields[key]
            .as_str()
            .is_none_or(|value| value.trim().is_empty())
    };
    let mut missing = Vec::new();
    for field in ["birth_place", "birth_country"] {
        if blank(field) {
            missing.push(field.to_string());
        }
    }
    for field in ["pep_self", "pep_related", "sanctions_links"] {
        if fields[field].as_bool().is_none() {
            missing.push(field.to_string());
        }
    }
    if blank("residence_since") {
        missing.push("residence_since".to_string());
    }
    if blank("stay_reason") {
        missing.push("stay_reason".to_string());
    }
    if fields["stay_reason"] == "other" && blank("stay_reason_details") {
        missing.push("stay_reason_details".to_string());
    }
    if fields["pep_self"] == true || fields["pep_related"] == true {
        for key in [
            "pep_office",
            "pep_country",
            "pep_period",
            "pep_wealth_origin",
        ] {
            if blank(key) {
                missing.push(key.to_string());
            }
        }
        if fields["pep_related"] == true && blank("pep_relationship") {
            missing.push("pep_relationship".to_string());
        }
    }
    if fields["sanctions_links"] == true {
        for key in [
            "sanctions_link_name",
            "sanctions_link_kind",
            "sanctions_link_since_extent",
        ] {
            if blank(key) {
                missing.push(key.to_string());
            }
        }
    }
    missing
}

fn apply_country_questions(current: &Value, body: &Value) -> Result<Value, FieldError> {
    let object = body
        .as_object()
        .ok_or_else(|| field_error("body", "A JSON object is expected"))?;
    let mut next = country_question_fields(current);
    for (key, value) in object {
        let Some(field) = COUNTRY_QUESTION_FIELDS
            .iter()
            .copied()
            .find(|field| *field == key)
        else {
            return Err(field_error(
                "body",
                "An unknown representative question was sent",
            ));
        };
        if matches!(field, "birth_place" | "birth_country") {
            let text = if value.is_null() {
                ""
            } else {
                value
                    .as_str()
                    .ok_or_else(|| field_error(field, "Text is expected"))?
            };
            next[field] = json!(if field == "birth_country" {
                iso_country(text, "birth_country")?
            } else {
                intake::clean_text(text, "birth_place", 200)?
            });
        } else if matches!(field, "pep_self" | "pep_related" | "sanctions_links") {
            if !value.is_null() && !value.is_boolean() {
                return Err(field_error(field, "Answer yes or no"));
            }
            next[field] = value.clone();
        } else {
            let patch = Map::from_iter([(field.to_string(), value.clone())]);
            let cleaned = crate::risk::cabinet::apply_statements(
                &crate::risk::cabinet::Statements::default(),
                &patch,
            )?;
            next[field] = cleaned
                .gwg_json()
                .get(field)
                .cloned()
                .unwrap_or(Value::Null);
        }
    }
    if next["stay_reason"] != "other" {
        next["stay_reason_details"] = Value::Null;
    }
    if next["pep_related"] == false {
        next["pep_relationship"] = Value::Null;
    }
    if next["pep_self"] == false && next["pep_related"] == false {
        for key in [
            "pep_office",
            "pep_country",
            "pep_period",
            "pep_relationship",
            "pep_wealth_origin",
        ] {
            next[key] = Value::Null;
        }
    }
    if next["sanctions_links"] == false {
        for key in [
            "sanctions_link_name",
            "sanctions_link_kind",
            "sanctions_link_since_extent",
        ] {
            next[key] = Value::Null;
        }
    }
    Ok(next)
}

/// Neutral questions are owned by the recorded contracting representative,
/// and may be answered by a login with active access to this child's request.
pub(crate) async fn save_my_country_questions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin representative questions"),
    };
    let kind = match intake::lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "lock representative questions"),
    };
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "load representative questions"),
    };
    let Some(person) = loaded
        .representation
        .find(representative_id)
        .filter(|person| person.slot.is_some())
    else {
        return intake::err(StatusCode::NOT_FOUND, "Acting representative not found");
    };
    let current = representative_question_fields(&person.extras);
    let next = match apply_country_questions(&current, &body) {
        Ok(next) => next,
        Err(error) => return error.into_response(),
    };
    let fields: Vec<&str> = COUNTRY_QUESTION_FIELDS
        .iter()
        .copied()
        .filter(|key| current[*key] != next[*key])
        .collect();
    let new_legal_yes = ["pep_self", "pep_related", "sanctions_links"]
        .iter()
        .any(|key| current[*key] != true && next[*key] == true);
    let birth_changed = ["birth_place", "birth_country"]
        .iter()
        .any(|key| current[*key] != next[*key]);
    let questions_changed = fields
        .iter()
        .any(|key| !matches!(*key, "birth_place" | "birth_country"));
    let mut stored_questions = next.clone();
    if let Some(object) = stored_questions.as_object_mut() {
        object.remove("birth_place");
        object.remove("birth_country");
    }
    let mut invalidated = Vec::new();
    if !fields.is_empty() {
        let saved = async {
            // Saving the questionnaire must not freeze a linked patient's
            // read-only basic-data fallback as explicit lead-specific answers.
            sqlx::query("INSERT INTO lead_representatives (lead_id,contact_id,role,contact_origin,country_questions,updated_by,birth_place,birth_country) VALUES ($1,$2,$3,'staff',$4,$5,$6,$7) ON CONFLICT (lead_id,contact_id) DO UPDATE SET country_questions=CASE WHEN $10 THEN EXCLUDED.country_questions ELSE lead_representatives.country_questions END,birth_place=CASE WHEN $8 THEN EXCLUDED.birth_place ELSE lead_representatives.birth_place END,birth_country=CASE WHEN $9 THEN EXCLUDED.birth_country ELSE lead_representatives.birth_country END,updated_by=EXCLUDED.updated_by,updated_at=now()")
                .bind(lead_id).bind(representative_id).bind(person.role)
                .bind(if questions_changed { stored_questions.clone() } else { json!({}) }).bind(auth.user_id)
                .bind(body.get("birth_place").and_then(|_| next["birth_place"].as_str()))
                .bind(body.get("birth_country").and_then(|_| next["birth_country"].as_str()))
                .bind(body.get("birth_place").is_some()).bind(body.get("birth_country").is_some())
                .bind(questions_changed)
                .execute(&mut *tx).await?;
            let at = intake::portal_update_time(&mut tx).await?;
            let marker = json!({"representative_questions": {
                "at":at,"by":auth.user_id,"kind":kind.as_str(),
                "hash":intake::value_marker(lead_id,"representative_questions",Some(&next.to_string())),
            }});
            store_lead(&mut tx, lead_id, None, &marker).await?;
            audit::write_in_transaction(&mut tx, &audit::domain_event(
                "lead_portal_representative_country_questions", Some(auth.user_id), "lead", Some(lead_id),
                json!({"representative_id":representative_id,"fields":fields,"access_kind":kind.as_str()}),
            )).await?;
            crate::risk::store::reassess(&mut tx, lead_id, crate::risk::store::Cause::Cabinet, Some(auth.user_id)).await?;
            if new_legal_yes || birth_changed {
                invalidated = crate::document_signatures::invalidate_representative_identity(&mut tx, lead_id, auth.user_id).await?.1;
            }
            tx.commit().await
        }.await;
        if let Err(error) = saved {
            return intake::internal(error, "save representative questions");
        }
        crate::document_signatures::withdraw_invalidated_consents(&state, &invalidated).await;
        publish_cabinet_change(&state, lead_id, auth.user_id, kind).await;
    } else {
        drop(tx);
    }
    request_response(&state, lead_id, auth.user_id, kind, StatusCode::OK).await
}

/// The roles that work the lead and read its payer block.
#[allow(clippy::result_large_err)]
fn require_staff_editor(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_capability(Capability::LeadsEdit)?;
    if lead_payer::may_view(auth) {
        Ok(())
    } else {
        Err(intake::err(
            StatusCode::FORBIDDEN,
            "Insufficient permissions",
        ))
    }
}

/// Locks an open lead for a staff change; the date of birth decides whether
/// it is a minor.
async fn lock_open_lead(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<(), axum::response::Response> {
    let lead = sqlx::query(
        "SELECT converted_patient_id, qualification_status FROM leads WHERE id = $1 FOR UPDATE",
    )
    .bind(lead_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| intake::internal(error, "lock lead"))?
    .ok_or_else(|| intake::err(StatusCode::NOT_FOUND, "Lead not found"))?;
    if lead
        .try_get::<String, _>("qualification_status")
        .is_ok_and(|status| status == "deleted")
    {
        return Err(intake::coded(
            StatusCode::CONFLICT,
            "lead_deleted",
            "The lead is deleted",
            json!({}),
        ));
    }
    if lead
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .ok()
        .flatten()
        .is_some()
    {
        return Err(intake::coded(
            StatusCode::CONFLICT,
            "lead_converted",
            "The lead is converted; its representation belongs to the patient record",
            json!({}),
        ));
    }
    Ok(())
}

async fn publish_staff_change(state: &AppState, lead_id: Uuid, user_id: Uuid) {
    crate::realtime::publish_lead_event(
        state,
        Some(user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": REPRESENTATION_MARKER }),
    )
    .await;
}

/// `POST /leads/{lead_id}/representation` `{ "custody": … }`: staff state who
/// represents a minor. Nobody is removed by it; the parent may state it
/// again in the cabinet, the last write stands.
pub(crate) async fn set_lead_custody(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = require_staff_editor(&auth) {
        return response;
    }
    let custody = match body.as_object().and_then(|body| body.get("custody")) {
        Some(value) if body.as_object().is_some_and(|body| body.len() == 1) => {
            match parse_custody(value) {
                Ok(custody) => custody,
                Err(()) => {
                    return invalid_key("custody", "joint, sole_parent or guardian is expected");
                }
            }
        }
        _ => return invalid_key("custody", "Only the custody is stated here"),
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    if let Err(response) = lock_open_lead(&mut tx, lead_id).await {
        return response;
    }
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "load representation"),
    };
    if !loaded.representation.minor {
        return intake::coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "custody_minor_only",
            "The custody is stated for a minor only",
            json!({ "field": "custody" }),
        );
    }
    let previous = loaded.representation.answers.custody.clone();
    // A contact marked as guardian (Vormund) needs the custody "guardian"
    // (owner 2026-10-22): leaving it asks staff to change the relation first.
    if previous != custody
        && custody.as_deref() != Some(CUSTODY_GUARDIAN)
        && let Some((index, person)) = loaded
            .representation
            .representatives
            .iter()
            .enumerate()
            .find(|(_, person)| {
                crate::routes::leads::is_legal_guardian_relation(person.relation.as_deref())
            })
    {
        return intake::coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            crate::routes::leads::RELATION_GUARDIAN_NEEDS_CUSTODY,
            "A contact is marked as guardian (Vormund); change its relation to mother or father first",
            json!({
                // The same error code as the contact save, so the screens show one text.
                "error": crate::routes::leads::RELATION_GUARDIAN_NEEDS_CUSTODY,
                "field": "custody",
                "contact_index": index,
                "contact_id": person.id,
                "contact_name": person.name(),
                "contact_field": "relation",
            }),
        );
    }
    let confirmed = previous == custody && custody.is_some() && !loaded.custody_set_by_staff;
    let mut invalidated = Vec::new();
    if previous != custody {
        let written = async {
            // The statements row belongs to the lead: its change time and
            // author stay what the lead's last change made them. A custody
            // staff state is read-only in the cabinet (owner 2026-10-22);
            // taken back, the cabinet may state it again.
            sqlx::query(
                r#"INSERT INTO lead_gwg_declarations (lead_id, custody, custody_set_by_staff)
                   VALUES ($1, $2, $2 IS NOT NULL)
                   ON CONFLICT (lead_id) DO UPDATE SET
                       custody = EXCLUDED.custody,
                       custody_set_by_staff = EXCLUDED.custody_set_by_staff"#,
            )
            .bind(lead_id)
            .bind(&custody)
            .execute(&mut *tx)
            .await?;
            audit::write_in_transaction(
                &mut tx,
                &audit::domain_event(
                    "set_lead_custody",
                    Some(auth.user_id),
                    "lead",
                    Some(lead_id),
                    json!({ "custody": custody, "previous": previous }),
                ),
            )
            .await?;
            invalidated = crate::document_signatures::invalidate_representative_identity(
                &mut tx,
                lead_id,
                auth.user_id,
            )
            .await?
            .1;
            Ok::<(), sqlx::Error>(())
        }
        .await;
        if let Err(error) = written {
            return intake::internal(error, "store custody");
        }
    } else if confirmed {
        // Staff confirm the custody the cabinet stated: from now on it is
        // staff's and read-only in the cabinet.
        let written = async {
            sqlx::query(
                "UPDATE lead_gwg_declarations SET custody_set_by_staff = true WHERE lead_id = $1",
            )
            .bind(lead_id)
            .execute(&mut *tx)
            .await?;
            audit::write_in_transaction(
                &mut tx,
                &audit::domain_event(
                    "set_lead_custody",
                    Some(auth.user_id),
                    "lead",
                    Some(lead_id),
                    json!({ "custody": custody, "previous": previous, "confirmed": true }),
                ),
            )
            .await
        }
        .await;
        if let Err(error) = written {
            return intake::internal(error, "confirm custody");
        }
    }
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "reload representation"),
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit custody");
    }
    crate::document_signatures::withdraw_invalidated_consents(&state, &invalidated).await;
    if previous != custody || confirmed {
        publish_staff_change(&state, lead_id, auth.user_id).await;
    }
    Json(json!({ "representation": staff_payload(&loaded) })).into_response()
}

/// `DELETE /leads/{lead_id}/representatives/{representative_id}`: staff
/// remove what the cabinet entered for a representative — the row and with
/// it the links to the uploaded files. The trusted contact and the documents
/// stay; the wizard can then remove the contact as usual.
pub(crate) async fn remove_lead_representative(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = require_staff_editor(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    if let Err(response) = lock_open_lead(&mut tx, lead_id).await {
        return response;
    }
    let removed = async {
        let unlinked: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM lead_portal_uploads
               WHERE lead_id = $1 AND representative_id = $2"#,
        )
        .bind(lead_id)
        .bind(representative_id)
        .fetch_one(&mut *tx)
        .await?;
        let role: Option<String> = sqlx::query_scalar(
            r#"DELETE FROM lead_representatives
               WHERE lead_id = $1 AND contact_id = $2
               RETURNING role"#,
        )
        .bind(lead_id)
        .bind(representative_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(role) = role else {
            return Ok::<_, sqlx::Error>(false);
        };
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "remove_lead_representative",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({
                    "representative_id": representative_id,
                    "role": role,
                    "upload_links_removed": unlinked,
                }),
            ),
        )
        .await?;
        Ok(true)
    }
    .await;
    match removed {
        Ok(true) => {}
        Ok(false) => return intake::err(StatusCode::NOT_FOUND, "Representative not found"),
        Err(error) => return intake::internal(error, "remove representative"),
    }
    let invalidated = match crate::document_signatures::invalidate_representative_identity(
        &mut tx,
        lead_id,
        auth.user_id,
    )
    .await
    {
        Ok((_, remote)) => remote,
        Err(error) => return intake::internal(error, "invalidate representative invitation"),
    };
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "reload representation"),
    };
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit representative removal");
    }
    crate::document_signatures::withdraw_invalidated_consents(&state, &invalidated).await;
    publish_staff_change(&state, lead_id, auth.user_id).await;
    Json(json!({ "representation": staff_payload(&loaded) })).into_response()
}

/// Explicit staff removal, separate from saving a possibly stale contact list.
/// The contact, its extra identity data and this child's guardian access leave
/// together. Uploaded documents and signed history remain in the lead record;
/// the parent's account, patient record and access to other children stay.
pub(crate) async fn remove_lead_trusted_contact(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = require_staff_editor(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    if let Err(response) = lock_open_lead(&mut tx, lead_id).await {
        return response;
    }
    let loaded = match load(&mut tx, lead_id).await {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return intake::err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return intake::internal(error, "load contact"),
    };
    let mut contacts = loaded.contacts;
    let previous_len = contacts.len();
    contacts.retain(|contact| entry_id(contact) != Some(representative_id));
    if contacts.len() == previous_len {
        return intake::err(StatusCode::NOT_FOUND, "Contact not found");
    }
    let written = async {
        // Deleting the extra row unlinks uploads through their foreign key;
        // it does not delete the documents or their audit history.
        sqlx::query("DELETE FROM lead_representatives WHERE lead_id = $1 AND contact_id = $2")
            .bind(lead_id)
            .bind(representative_id)
            .execute(&mut *tx)
            .await?;
        let revoked: Vec<Uuid> = sqlx::query_scalar(
            r#"UPDATE lead_portal_access
               SET revoked_at = now(), revoked_by = $3, revoked_reason = 'contact_removed'
               WHERE lead_id = $1 AND trusted_contact_id = $2
                 AND kind = 'guardian' AND revoked_at IS NULL
               RETURNING id"#,
        )
        .bind(lead_id)
        .bind(representative_id)
        .bind(auth.user_id)
        .fetch_all(&mut *tx)
        .await?;
        store_lead(&mut tx, lead_id, Some(&contacts), &json!({})).await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "remove_lead_trusted_contact",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({ "representative_id": representative_id, "revoked_access_ids": revoked }),
            ),
        )
        .await?;
        crate::risk::store::reassess(
            &mut tx,
            lead_id,
            crate::risk::store::Cause::Staff,
            Some(auth.user_id),
        )
        .await?;
        let (_, remote) = crate::document_signatures::invalidate_representative_identity(
            &mut tx,
            lead_id,
            auth.user_id,
        )
        .await?;
        let loaded = load(&mut tx, lead_id).await?.unwrap_or_default();
        tx.commit().await?;
        Ok::<_, sqlx::Error>((loaded, remote))
    }
    .await;
    let (loaded, remote) = match written {
        Ok(result) => result,
        Err(error) => return intake::internal(error, "remove trusted contact"),
    };
    crate::document_signatures::withdraw_invalidated_consents(&state, &remote).await;
    publish_staff_change(&state, lead_id, auth.user_id).await;
    Json(json!({ "representation": staff_payload(&loaded) })).into_response()
}

/// The wizard saves the whole list of trusted contacts. A stored entry the
/// cabinet added to (it has a row) or that has an open parent's access, and
/// that the incoming list does not name, is kept: a save with a list loaded
/// before the parent entered the second parent, or before staff issued a
/// parent's access, must neither drop that person nor leave the access
/// without its contact. Called in the transaction of the save; the lead row
/// is locked here, so the list cannot change in between. To remove such a
/// contact staff use the explicit trusted-contact DELETE, which also closes
/// the access.
///
/// `base` is the list the wizard loaded (`trusted_contacts_base`, sent by
/// newer clients): then a field of a contact the save leaves as it was
/// loaded takes the stored value, so a parent's change in the cabinet since
/// the load is not reverted by staff editing another field or contact, and
/// a contact added since the load (unknown to the wizard) stays.
pub(crate) async fn keep_represented_contacts(
    conn: &mut PgConnection,
    lead_id: Uuid,
    incoming: Value,
    base: Option<&Value>,
) -> Result<Value, sqlx::Error> {
    let stored: Option<Value> =
        sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id = $1 FOR UPDATE")
            .bind(lead_id)
            .fetch_optional(&mut *conn)
            .await?;
    let represented: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT contact_id FROM lead_representatives WHERE lead_id = $1
           UNION
           SELECT trusted_contact_id FROM lead_portal_access
           WHERE lead_id = $1 AND kind = 'guardian' AND revoked_at IS NULL
             AND trusted_contact_id IS NOT NULL"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    let incoming = match base {
        Some(base) => merge_with_base(stored.as_ref(), base, incoming),
        None => incoming,
    };
    Ok(merge_represented_contacts(
        stored.as_ref(),
        &represented,
        incoming,
    ))
}

/// The keys of a trusted contact entry a wizard save writes.
const CONTACT_ENTRY_FIELDS: [&str; 7] = [
    "related_patient_id",
    "name",
    "email",
    "phone",
    "relation",
    "birth_date",
    "address",
];

/// Three-way merge of a wizard save (`incoming`) with the list it was loaded
/// from (`base`) and the stored list: a field the save leaves as loaded takes
/// the stored value; a stored entry the wizard did not know (not in `base`)
/// and does not name is kept.
fn merge_with_base(stored: Option<&Value>, base: &Value, incoming: Value) -> Value {
    let Value::Array(mut contacts) = incoming else {
        return incoming;
    };
    let stored = stored
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let base = base.as_array().cloned().unwrap_or_default();
    let find = |list: &[Value], id: Uuid| -> Option<Value> {
        list.iter()
            .find(|entry| entry_id(entry) == Some(id))
            .cloned()
    };
    for entry in contacts.iter_mut() {
        let Some(id) = entry_id(entry) else { continue };
        let (Some(loaded), Some(current)) = (find(&base, id), find(&stored, id)) else {
            continue;
        };
        let Some(object) = entry.as_object_mut() else {
            continue;
        };
        for field in CONTACT_ENTRY_FIELDS {
            let sent = object.get(field).cloned().unwrap_or(Value::Null);
            if sent == loaded.get(field).cloned().unwrap_or(Value::Null) {
                object.insert(
                    field.to_string(),
                    current.get(field).cloned().unwrap_or(Value::Null),
                );
            }
        }
    }
    let named = contacts.iter().filter_map(entry_id).collect::<Vec<_>>();
    for entry in &stored {
        if let Some(id) = entry_id(entry)
            && !named.contains(&id)
            && find(&base, id).is_none()
        {
            contacts.push(entry.clone());
        }
    }
    Value::Array(contacts)
}

/// `incoming` with the stored entries of `represented` it leaves out, in
/// their stored order, appended.
fn merge_represented_contacts(
    stored: Option<&Value>,
    represented: &[Uuid],
    incoming: Value,
) -> Value {
    let Value::Array(mut contacts) = incoming else {
        return incoming;
    };
    let named = contacts.iter().filter_map(entry_id).collect::<Vec<_>>();
    for entry in stored.and_then(Value::as_array).into_iter().flatten() {
        if let Some(id) = entry_id(entry)
            && represented.contains(&id)
            && !named.contains(&id)
        {
            contacts.push(entry.clone());
        }
    }
    Value::Array(contacts)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 5).unwrap()
    }

    fn id(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    fn contact(n: u8, name: &str, relation: &str) -> Value {
        json!({
            "id": id(n),
            "name": name,
            "relation": relation,
            "email": format!("{}@example.com", name.to_lowercase().replace(' ', ".")),
            "birth_date": "1985-03-02",
        })
    }

    fn row(role: &str, first: &str, last: &str) -> Extras {
        Extras {
            role: role.into(),
            contact_origin: ORIGIN_PORTAL.into(),
            first_name: Some(first.into()),
            last_name: Some(last.into()),
            ..Default::default()
        }
    }

    #[test]
    fn the_parents_of_a_minor_are_its_representatives_and_the_login_comes_first() {
        let contacts = vec![
            contact(1, "Tante Muster", "aunt"),
            contact(2, "Ben Muster", "father"),
            contact(3, "Anna Muster", "Mutter"),
            json!({ "name": "Ohne Kennung", "relation": "parent" }),
            contact(4, "Carla Muster", "guardian"),
        ];
        let rows = HashMap::from([(id(3), row(ROLE_LEGAL_REPRESENTATIVE, "Anna", "Muster"))]);
        // The mother has the login: she is the first representative.
        let logins = vec![(id(3), id(9))];
        let people = resolve(true, &contacts, &rows, &logins, &Answers::default());
        assert_eq!(
            people
                .iter()
                .map(|person| (person.id, person.slot))
                .collect::<Vec<_>>(),
            vec![
                (id(3), Some(SLOT_REP1)),
                (id(2), Some(SLOT_REP2)),
                (id(4), None),
            ]
        );
        assert!(
            people
                .iter()
                .all(|person| person.role == ROLE_LEGAL_REPRESENTATIVE)
        );
        assert_eq!(people[0].login_user_ids, vec![id(9)]);
        assert!(people[0].has_data && !people[1].has_data);
        assert_eq!(people[1].first_name, "Ben");
        assert_eq!(people[1].last_name, "Muster");
        assert_eq!(people[1].date_of_birth, NaiveDate::from_ymd_opt(1985, 3, 2));

        // One parent alone or a guardian: only the first has a place.
        for custody in [CUSTODY_SOLE_PARENT, CUSTODY_GUARDIAN] {
            let answers = Answers {
                custody: Some(custody.into()),
                ..Default::default()
            };
            let people = resolve(true, &contacts, &rows, &logins, &answers);
            assert_eq!(
                people.iter().map(|person| person.slot).collect::<Vec<_>>(),
                vec![Some(SLOT_REP1), None, None],
                "{custody}"
            );
        }
        // An unknown custody value counts as both parents.
        assert_eq!(
            Answers {
                custody: Some("shared".into()),
                ..Default::default()
            }
            .custody(),
            CUSTODY_JOINT
        );
    }

    #[test]
    fn an_adult_is_represented_by_the_persons_of_its_rows() {
        let contacts = vec![
            contact(1, "Ben Muster", "representative"),
            contact(2, "Carla Muster", "guardian"),
            contact(3, "Dora Muster", "mother"),
        ];
        let rows = HashMap::from([
            (id(1), row(ROLE_AUTHORISED_REPRESENTATIVE, "Ben", "Muster")),
            (id(2), row(ROLE_LEGAL_GUARDIAN, "Carla", "Muster")),
            // The row of a parent from the time the lead was a minor.
            (id(3), row(ROLE_LEGAL_REPRESENTATIVE, "Dora", "Muster")),
        ]);
        let answers = Answers {
            has_representative: Some(true),
            under_guardianship: Some(false),
            ..Default::default()
        };
        let people = resolve(false, &contacts, &rows, &[], &answers);
        assert_eq!(
            people
                .iter()
                .map(|person| (person.id, person.role, person.slot))
                .collect::<Vec<_>>(),
            vec![
                (id(1), ROLE_AUTHORISED_REPRESENTATIVE, Some(SLOT_AGENT)),
                // On file, but the lead is not under guardianship (any more).
                (id(2), ROLE_LEGAL_GUARDIAN, None),
            ]
        );
        // A contact without a row is nobody's representative for an adult,
        // and the adult rows mean nothing for a minor.
        assert!(resolve(false, &contacts, &HashMap::new(), &[], &answers).is_empty());
        let as_minor = resolve(true, &contacts, &rows, &[], &Answers::default());
        assert_eq!(
            as_minor
                .iter()
                .map(|person| (person.id, person.has_data))
                .collect::<Vec<_>>(),
            vec![(id(2), false), (id(3), true)]
        );
    }

    #[test]
    fn the_name_parts_of_the_row_count_while_they_are_the_name_of_the_contact() {
        assert_eq!(
            name_parts("Anna  von Muster", Some("Anna"), Some("von Muster")),
            ("Anna".to_string(), "von Muster".to_string())
        );
        // Staff renamed the contact: the name is split at the last space.
        assert_eq!(
            name_parts("Anna Maria Beispiel", Some("Anna"), Some("von Muster")),
            ("Anna Maria".to_string(), "Beispiel".to_string())
        );
        assert_eq!(
            name_parts("Muster", None, None),
            (String::new(), "Muster".to_string())
        );
        assert_eq!(name_parts("  ", None, None), (String::new(), String::new()));
    }

    /// The three matchers of "parent or guardian" — the cabinet and the
    /// guardian logins, the sanctions screening, the suggested signers — must
    /// name the same people for what the cabinet writes and for the relations
    /// staff usually type.
    #[test]
    fn the_relation_matchers_agree_on_parents_and_guardians() {
        for relation in ["parent", "guardian", "Mutter", "mother", "Vater", "father"] {
            assert!(
                crate::routes::leads::is_parent_or_guardian_relation(Some(relation)),
                "leads: {relation}"
            );
            assert!(
                crate::sanctions::screening::is_guardian_relation(relation),
                "screening: {relation}"
            );
            assert!(
                crate::document_signatures::defaults::is_guardian_relation(Some(relation)),
                "signers: {relation}"
            );
        }
        // An adult's representative is none of them.
        for relation in ["representative", "aunt", ""] {
            assert!(
                !crate::routes::leads::is_parent_or_guardian_relation(Some(relation)),
                "leads: {relation}"
            );
            assert!(
                !crate::sanctions::screening::is_guardian_relation(relation),
                "screening: {relation}"
            );
            assert!(
                !crate::document_signatures::defaults::is_guardian_relation(Some(relation)),
                "signers: {relation}"
            );
        }
    }

    fn loaded(minor: bool, answers: Answers, people: Vec<Representative>) -> Loaded {
        Loaded {
            representation: Representation {
                minor,
                answers,
                representatives: people,
            },
            ..Default::default()
        }
    }

    fn complete_person(n: u8, slot: &'static str, role: &'static str) -> Representative {
        Representative {
            id: id(n),
            slot: Some(slot),
            role,
            relation: Some("parent".into()),
            first_name: "Anna".into(),
            last_name: "Muster".into(),
            date_of_birth: NaiveDate::from_ymd_opt(1985, 3, 2),
            email: Some("anna.muster@example.com".into()),
            phone: Some("+49 30 000000".into()),
            login_user_ids: Vec::new(),
            has_data: true,
            extras: Extras {
                role: role.into(),
                contact_origin: ORIGIN_PORTAL.into(),
                first_name: Some("Anna".into()),
                last_name: Some("Muster".into()),
                birth_place: Some("Berlin".into()),
                citizenships: vec!["DE".into()],
                street: Some("Musterweg 1".into()),
                zip: Some("10115".into()),
                city: Some("Berlin".into()),
                country: Some("DE".into()),
                id_document_type: Some("passport".into()),
                id_document_number: Some("C01X00T47".into()),
                id_issuing_authority: Some("Stadt Berlin".into()),
                id_issuing_country: Some("DE".into()),
                id_valid_until: NaiveDate::from_ymd_opt(2031, 2, 1),
                ..Default::default()
            },
        }
    }

    fn upload(n: u8, kind: &str) -> Upload {
        Upload {
            document_id: Uuid::new_v4(),
            representative_id: id(n),
            kind: kind.into(),
            file_name: Some("ausweis.pdf".into()),
            size_bytes: Some(2048),
            mime_type: Some("application/pdf".into()),
            uploaded_at: None,
            uploaded_by: None,
            by_staff: false,
            reviewed: false,
            locked: false,
        }
    }

    fn keys(prefix: &str, fields: &[&str]) -> Vec<String> {
        fields
            .iter()
            .map(|field| format!("{prefix}_{field}"))
            .collect()
    }

    #[test]
    fn a_minor_is_identified_through_the_contracting_representatives() {
        let reviewed = |n: u8| Upload {
            reviewed: true,
            ..upload(n, UPLOAD_IDENTITY)
        };
        let parents = || {
            vec![
                complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE),
                complete_person(2, SLOT_REP2, ROLE_LEGAL_REPRESENTATIVE),
            ]
        };
        // Joint custody: both parents' copies, taken over by staff.
        let mut joint = loaded(true, Answers::default(), parents());
        assert!(!joint.minor_representatives_identified());
        joint.uploads = vec![reviewed(1), upload(2, UPLOAD_IDENTITY)];
        assert!(
            !joint.minor_representatives_identified(),
            "an unreviewed copy is no identification"
        );
        joint.uploads = vec![reviewed(1), reviewed(2)];
        assert!(joint.minor_representatives_identified());
        // Sole custody: the one custodian.
        let mut sole = loaded(
            true,
            Answers {
                custody: Some(CUSTODY_SOLE_PARENT.into()),
                ..Default::default()
            },
            vec![complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE)],
        );
        sole.uploads = vec![reviewed(1)];
        assert!(sole.minor_representatives_identified());
        // Nobody on file, or an adult: never by this rule.
        assert!(!loaded(true, Answers::default(), Vec::new()).minor_representatives_identified());
        let mut adult = loaded(false, Answers::default(), parents());
        adult.uploads = vec![reviewed(1), reviewed(2)];
        assert!(!adult.minor_representatives_identified());
    }

    #[test]
    fn an_adult_answers_both_questions_and_names_the_person_of_a_yes() {
        // "Does somebody act on your behalf?" first (owner 2026-10-11).
        let unanswered = loaded(false, Answers::default(), Vec::new());
        assert_eq!(
            missing_for_submit(&unanswered, today()),
            vec!["has_representative"]
        );
        let nobody = Answers {
            has_representative: Some(false),
            ..Default::default()
        };
        assert!(missing_for_submit(&loaded(false, nobody, Vec::new()), today()).is_empty());
        // Its "yes" asks whether that is a court-appointed representative.
        let acting = Answers {
            has_representative: Some(true),
            ..Default::default()
        };
        assert_eq!(
            missing_for_submit(&loaded(false, acting, Vec::new()), today()),
            vec!["under_guardianship"]
        );

        // "Yes, a legal guardian" without a person: the whole list of that place.
        let both = Answers {
            has_representative: Some(true),
            under_guardianship: Some(true),
            ..Default::default()
        };
        assert!(!both.asks_adult_role(ROLE_AUTHORISED_REPRESENTATIVE));
        assert_eq!(
            missing_for_submit(&loaded(false, both.clone(), Vec::new()), today()),
            keys(SLOT_GUARDIAN, &ADULT_REQUIRED)
        );
        // "Yes, not court-appointed": the authorised representative.
        let agent = Answers {
            under_guardianship: Some(false),
            ..both.clone()
        };
        assert_eq!(
            missing_for_submit(&loaded(false, agent, Vec::new()), today()),
            keys(SLOT_AGENT, &ADULT_REQUIRED)
        );
        // A legal guardianship stated before the question was nested keeps its guardian.
        let older = Answers {
            has_representative: Some(false),
            under_guardianship: Some(true),
            ..Default::default()
        };
        assert_eq!(
            missing_for_submit(&loaded(false, older, Vec::new()), today()),
            keys(SLOT_GUARDIAN, &ADULT_REQUIRED)
        );

        // The representative is entered; the files are still to come.
        let mut entered = loaded(
            false,
            Answers {
                under_guardianship: Some(false),
                ..both
            },
            vec![complete_person(
                1,
                SLOT_AGENT,
                ROLE_AUTHORISED_REPRESENTATIVE,
            )],
        );
        assert_eq!(
            missing_for_submit(&entered, today()),
            vec!["agent_id_upload", "agent_authority_upload"]
        );
        entered.uploads = vec![upload(1, UPLOAD_IDENTITY), upload(1, UPLOAD_AUTHORITY)];
        assert!(missing_for_submit(&entered, today()).is_empty());
    }

    #[test]
    fn a_minor_contract_needs_both_parents_or_the_one_custodian_or_guardian() {
        // Nobody on file yet: both parents by default.
        let mut expected = vec!["custody".to_string()];
        expected.extend(keys(SLOT_REP1, &MINOR_REQUIRED));
        expected.extend(keys(SLOT_REP2, &MINOR_REQUIRED));
        assert_eq!(
            missing_for_contract(&loaded(true, Answers::default(), Vec::new()), today()),
            expected
        );

        // The first parent is complete but for the scan; the identity
        // document of the second one has expired since it was entered.
        let mut second = complete_person(2, SLOT_REP2, ROLE_LEGAL_REPRESENTATIVE);
        second.extras.id_valid_until = NaiveDate::from_ymd_opt(2026, 10, 4);
        second.extras.citizenships.clear();
        let mut both = loaded(
            true,
            Answers::default(),
            vec![
                complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE),
                second,
            ],
        );
        both.uploads = vec![upload(2, UPLOAD_IDENTITY)];
        assert_eq!(
            missing_for_contract(&both, today()),
            vec![
                "custody",
                "rep1_id_upload",
                "rep2_citizenships",
                "rep2_id_valid_until"
            ]
        );

        // One parent alone: the second place is not asked for, and the proof
        // of sole custody is optional.
        let sole = Answers {
            custody: Some(CUSTODY_SOLE_PARENT.into()),
            ..Default::default()
        };
        let mut alone = loaded(
            true,
            sole,
            vec![complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE)],
        );
        alone.uploads = vec![upload(1, UPLOAD_IDENTITY)];
        assert!(missing_for_contract(&alone, today()).is_empty());

        // A guardian needs the appointment deed.
        alone.representation.answers.custody = Some(CUSTODY_GUARDIAN.into());
        assert_eq!(
            missing_for_contract(&alone, today()),
            vec!["rep1_authority_upload"]
        );
        alone.uploads.push(upload(1, UPLOAD_AUTHORITY));
        assert!(missing_for_contract(&alone, today()).is_empty());
    }

    #[test]
    fn a_parents_own_document_needs_only_that_parents_data() {
        // DEV 2026-10-19: the GwG sheet of the first parent was refused for
        // the second parent's data.
        let mut second = complete_person(2, SLOT_REP2, ROLE_LEGAL_REPRESENTATIVE);
        second.phone = None;
        second.extras.citizenships.clear();
        let mut both = loaded(
            true,
            Answers::default(),
            vec![
                complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE),
                second,
            ],
        );
        both.uploads = vec![upload(1, UPLOAD_IDENTITY), upload(2, UPLOAD_IDENTITY)];
        assert!(missing_for_representative(&both, today(), id(1)).is_empty());
        assert_eq!(
            missing_for_representative(&both, today(), id(2)),
            vec!["rep2_citizenships", "rep2_phone"]
        );
        // The contract still needs both parents under joint custody.
        assert_eq!(
            missing_for_contract(&both, today()),
            vec!["custody", "rep2_citizenships", "rep2_phone"]
        );
        // Unknown person or a person without a place: nothing to check.
        assert!(missing_for_representative(&both, today(), id(9)).is_empty());
        // A guardian's own sheet asks for the appointment deed.
        both.representation.answers.custody = Some(CUSTODY_GUARDIAN.into());
        assert_eq!(
            missing_for_representative(&both, today(), id(1)),
            vec!["rep1_authority_upload"]
        );
    }

    #[test]
    fn the_gwg_sheet_scopes_its_signature_to_its_person() {
        let representative = id(4);
        let bindings = json!({"gwg_identification": {"subject": subject_of(representative)}});
        assert_eq!(
            SignatureDetails::of_document(
                Some("gwg_identification"),
                "gwg_identification",
                Some(&bindings)
            ),
            SignatureDetails::Representative(representative)
        );
        // The patient's own sheet checks the patient's document.
        assert_eq!(
            SignatureDetails::of_document(
                Some("gwg_identification"),
                "gwg_identification",
                Some(&json!({"gwg_identification": {"subject": "contract_partner"}}))
            ),
            SignatureDetails::Patient
        );
        for subject in [
            json!({"gwg_identification": {"subject": "payer"}}),
            json!({}),
        ] {
            assert_eq!(
                SignatureDetails::of_document(
                    Some("gwg_identification"),
                    "gwg_identification",
                    Some(&subject)
                ),
                SignatureDetails::Nobody
            );
        }
        assert_eq!(
            SignatureDetails::of_document(None, "gwg_identification", None),
            SignatureDetails::Nobody
        );
        // The sheet for legal entities of a paying organisation checks the
        // organisation's data (owner decision 2026-10-22); the form belongs
        // to the payer's sheet only.
        assert_eq!(
            SignatureDetails::of_document(
                Some("gwg_identification"),
                "gwg_identification",
                Some(&json!({"gwg_identification": {"subject": "payer", "form": "legal_entity"}}))
            ),
            SignatureDetails::PayerOrganisation
        );
        assert_eq!(
            SignatureDetails::of_document(
                Some("gwg_identification"),
                "gwg_identification",
                Some(
                    &json!({"gwg_identification": {"subject": "contract_partner", "form": "legal_entity"}})
                )
            ),
            SignatureDetails::Patient
        );
        // A contract keeps the check of the contracting representatives.
        for template in ["framework_contract", "single_order", "cost_estimate"] {
            assert_eq!(
                SignatureDetails::of_document(Some(template), "contract", Some(&bindings)),
                SignatureDetails::Contract
            );
        }
    }

    #[test]
    fn a_minor_intake_is_short_but_contract_details_are_still_required() {
        let mut parent = complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE);
        parent.date_of_birth = None;
        parent.extras = Extras {
            country: Some("DE".into()),
            citizenships: vec!["DE".into()],
            ..Default::default()
        };
        let mut child = loaded(
            true,
            Answers {
                custody: Some(CUSTODY_GUARDIAN.into()),
                ..Default::default()
            },
            vec![parent],
        );
        assert!(missing_for_submit(&child, today()).is_empty());
        let full = missing_for_contract(&child, today());
        for key in [
            "rep1_date_of_birth",
            "rep1_street",
            "rep1_id_document_number",
            "rep1_id_upload",
            "rep1_authority_upload",
        ] {
            assert!(full.contains(&key.to_string()), "{key}");
        }
        child.document_stage = true;
        assert_eq!(
            missing_for_submit(&child, today()),
            full,
            "an explicit document request reveals full requirements"
        );
    }

    fn patch(body: Value) -> PersonPatch {
        parse_person_patch(&body).unwrap_or_else(|_| panic!("refused: {body}"))
    }

    #[test]
    fn a_person_patch_is_validated_and_names_the_changed_fields() {
        let entered = apply_person_patch(
            &Person::default(),
            &patch(json!({
                "role": " Legal_Representative ",
                "first_name": "  Ben ",
                "last_name": "Muster",
                "date_of_birth": "1984-07-09",
                "birth_country": "de",
                "citizenships": ["de", "UA", "DE"],
                "street": "Musterweg 1",
                "zip": "10115",
                "city": "Berlin",
                "country": "DE",
                "email": "Ben.Muster@Example.com",
                "phone": "+49 30 000000",
                "id_document_type": "id_card",
                "id_valid_until": "2026-10-05",
            })),
            today(),
        )
        .unwrap();
        assert_eq!(entered.name(), "Ben Muster");
        assert_eq!(entered.birth_country.as_deref(), Some("DE"));
        assert_eq!(entered.citizenships, vec!["DE", "UA"]);
        assert_eq!(entered.email.as_deref(), Some("ben.muster@example.com"));
        assert_eq!(
            entered.address_line().as_deref(),
            Some("Musterweg 1, 10115 Berlin, Deutschland")
        );
        assert_eq!(
            patch(json!({ "role": " Legal_Representative " }))
                .role
                .as_deref(),
            Some(ROLE_LEGAL_REPRESENTATIVE)
        );

        // `null` and an empty text clear a value; only what differs is named.
        let cleared = apply_person_patch(
            &entered,
            &patch(json!({ "phone": null, "street": "", "citizenships": null, "city": "Berlin" })),
            today(),
        )
        .unwrap();
        assert_eq!(
            changed_person_fields(&entered, &cleared),
            vec!["citizenships", "street", "phone"]
        );
        assert_eq!(
            cleared.address_line().as_deref(),
            Some("10115 Berlin, Deutschland")
        );

        let refused = |body: Value| {
            apply_person_patch(&entered, &patch(body), today())
                .map(|_| ())
                .unwrap_err()
        };
        // The last name names the trusted contact: it cannot be cleared.
        assert_eq!(refused(json!({ "last_name": " " })).field, "last_name");
        // A representative is of full age.
        assert_eq!(
            refused(json!({ "date_of_birth": "2010-01-01" })).field,
            "date_of_birth"
        );
        assert_eq!(
            refused(json!({ "date_of_birth": "2027-01-01" })).field,
            "date_of_birth"
        );
        assert_eq!(refused(json!({ "country": "Germany" })).field, "country");
        assert_eq!(
            refused(json!({ "citizenships": ["XX"] })).field,
            "citizenships"
        );
        assert_eq!(refused(json!({ "email": "ben.muster" })).field, "email");
        assert_eq!(refused(json!({ "phone": "12" })).field, "phone");
        assert_eq!(
            refused(json!({ "id_document_type": "licence" })).field,
            "id_document_type"
        );
        assert_eq!(
            refused(json!({ "id_issued_on": "2026-10-06" })).field,
            "id_issued_on"
        );
        let expired = refused(json!({ "id_valid_until": "2026-10-04" }));
        assert_eq!(
            (expired.code, expired.field),
            ("id_document_expired", "id_valid_until")
        );

        // Unknown keys and values of another type are refused.
        assert!(parse_person_patch(&json!({ "mine": true })).is_err());
        assert!(parse_person_patch(&json!({ "first_name": 5 })).is_err());
        assert!(parse_person_patch(&json!({ "citizenships": "DE" })).is_err());
        assert!(parse_person_patch(&json!(["first_name"])).is_err());
    }

    #[test]
    fn the_answers_fit_the_age_of_the_lead() {
        let adult = parse_answers_patch(
            &json!({ "has_representative": true, "under_guardianship": null }),
            false,
        )
        .unwrap_or_else(|_| panic!("refused"));
        assert_eq!(adult.has_representative, Some(Some(true)));
        assert_eq!(adult.under_guardianship, Some(None));
        assert_eq!(adult.custody, None);
        let minor = parse_answers_patch(&json!({ "custody": "Sole_Parent" }), true)
            .unwrap_or_else(|_| panic!("refused"));
        assert_eq!(minor.custody, Some(Some(CUSTODY_SOLE_PARENT.to_string())));

        assert!(parse_answers_patch(&json!({ "custody": "joint" }), false).is_err());
        assert!(parse_answers_patch(&json!({ "has_representative": true }), true).is_err());
        assert!(parse_answers_patch(&json!({ "has_representative": "yes" }), false).is_err());
        assert!(parse_answers_patch(&json!({ "custody": "both" }), true).is_err());
        assert!(parse_answers_patch(&json!({ "minor": false }), false).is_err());
    }

    #[test]
    fn a_save_with_the_loaded_list_keeps_what_the_cabinet_changed_since() {
        let loaded = json!([
            contact(1, "Anna Muster", "mother"),
            contact(2, "Ben Muster", "father"),
        ]);
        // Since the load the mother changed her phone in the cabinet and a
        // contact was added; staff removed none.
        let mut stored = loaded.clone();
        stored[0]["phone"] = json!("+49 30 111111");
        stored
            .as_array_mut()
            .unwrap()
            .push(contact(3, "Tante Muster", "aunt"));
        // Staff set the father's date of birth with the list they loaded.
        let mut incoming = loaded.clone();
        incoming[1]["birth_date"] = json!("1983-04-06");
        let merged = merge_with_base(Some(&stored), &loaded, incoming);
        assert_eq!(merged[0]["phone"], "+49 30 111111");
        assert_eq!(merged[1]["birth_date"], "1983-04-06");
        assert_eq!(entry_id(&merged[2]), Some(id(3)));
        // What staff change themselves wins; a contact staff remove goes.
        let mut incoming = json!([loaded[0].clone()]);
        incoming[0]["phone"] = json!("+49 30 222222");
        let merged = merge_with_base(Some(&stored), &loaded, incoming);
        assert_eq!(merged[0]["phone"], "+49 30 222222");
        assert_eq!(
            merged
                .as_array()
                .unwrap()
                .iter()
                .filter_map(entry_id)
                .collect::<Vec<_>>(),
            vec![id(1), id(3)]
        );
    }

    #[test]
    fn a_save_with_an_older_list_keeps_the_contacts_the_cabinet_added_to() {
        let stored = json!([
            contact(1, "Anna Muster", "mother"),
            contact(2, "Ben Muster", "parent"),
            contact(3, "Tante Muster", "aunt"),
        ]);
        // The wizard still has the list from before the second parent.
        let incoming = json!([contact(1, "Anna Muster", "mother")]);
        let merged = merge_represented_contacts(Some(&stored), &[id(1), id(2)], incoming.clone());
        assert_eq!(
            merged
                .as_array()
                .unwrap()
                .iter()
                .filter_map(entry_id)
                .collect::<Vec<_>>(),
            vec![id(1), id(2)]
        );
        // Without a row a contact the list leaves out is removed as before.
        assert_eq!(
            merge_represented_contacts(Some(&stored), &[], incoming.clone()),
            incoming
        );
        // Stored contacts of another shape are nothing to keep.
        assert_eq!(
            merge_represented_contacts(Some(&json!("broken")), &[id(2)], incoming.clone()),
            incoming
        );
    }

    #[test]
    fn a_parent_who_pays_is_the_same_person_as_the_representative() {
        let parent = complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE);
        let minor = Representation {
            minor: true,
            answers: Answers::default(),
            representatives: vec![parent.clone()],
        };
        let payer = |email: Option<&str>, last_name: &str| lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some(lead_payer::PAYER_TYPE_PERSON.into()),
            first_name: Some("anna".into()),
            last_name: Some(last_name.into()),
            date_of_birth: NaiveDate::from_ymd_opt(1985, 3, 2),
            email: email.map(str::to_string),
            ..Default::default()
        };
        // The same address, whatever the spelling of the name.
        assert_eq!(
            payer_same_person(
                &minor,
                Some(&payer(Some(" Anna.Muster@example.com "), "Zahler"))
            ),
            Some(id(1))
        );
        // Two addresses are two persons, even with the same name.
        assert_eq!(
            payer_same_person(&minor, Some(&payer(Some("other@example.com"), "Muster"))),
            None
        );
        // Without an address on one side: name and date of birth decide.
        assert_eq!(
            payer_same_person(&minor, Some(&payer(None, "MUSTER"))),
            Some(id(1))
        );
        assert_eq!(
            payer_same_person(&minor, Some(&payer(None, "Zahler"))),
            None
        );
        // A parent on file without custody (no place in the form) who pays
        // stays a third party.
        let without_custody = Representation {
            representatives: vec![Representative {
                slot: None,
                ..parent.clone()
            }],
            ..minor.clone()
        };
        assert_eq!(
            payer_same_person(
                &without_custody,
                Some(&payer(Some("anna.muster@example.com"), "Muster"))
            ),
            None
        );
        // Named as the paying representative and then left without custody
        // (staff switched to sole custody): no longer the paying parent.
        let declared = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_REPRESENTATIVE.into(),
            payer_representative_id: Some(id(1)),
            ..Default::default()
        };
        assert_eq!(payer_same_person(&minor, Some(&declared)), Some(id(1)));
        assert_eq!(payer_same_person(&without_custody, Some(&declared)), None);
        // Not for an organisation, a self-payer or an adult lead.
        let company = lead_payer::Declaration {
            payer_type: Some("company".into()),
            ..payer(Some("anna.muster@example.com"), "Muster")
        };
        assert_eq!(payer_same_person(&minor, Some(&company)), None);
        let own = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            ..payer(Some("anna.muster@example.com"), "Muster")
        };
        assert_eq!(payer_same_person(&minor, Some(&own)), None);
        assert_eq!(payer_same_person(&minor, None), None);
        let adult = Representation {
            minor: false,
            ..minor
        };
        assert_eq!(
            payer_same_person(
                &adult,
                Some(&payer(Some("anna.muster@example.com"), "Muster"))
            ),
            None
        );
    }

    #[test]
    fn a_paying_parent_is_named_as_the_representative_never_as_a_third_party() {
        let mother = complete_person(1, SLOT_REP1, ROLE_LEGAL_REPRESENTATIVE);
        let father = Representative {
            id: id(2),
            slot: Some(SLOT_REP2),
            first_name: "Ben".into(),
            email: Some("ben.muster@example.com".into()),
            ..complete_person(2, SLOT_REP2, ROLE_LEGAL_REPRESENTATIVE)
        };
        let minor = Representation {
            minor: true,
            answers: Answers::default(),
            representatives: vec![mother, father],
        };
        let representative = |n: u8| lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_REPRESENTATIVE.into(),
            payer_representative_id: Some(id(n)),
            ..Default::default()
        };
        // The declaration names the parent itself.
        assert_eq!(
            payer_same_person(&minor, Some(&representative(2))),
            Some(id(2))
        );
        assert_eq!(payer_same_person(&minor, Some(&representative(9))), None);

        // A third party who is the mother becomes the mother as
        // representative: nothing of a third party stays on the row.
        let mut named = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some(lead_payer::PAYER_TYPE_PERSON.into()),
            first_name: Some("Anna".into()),
            last_name: Some("Muster".into()),
            email: Some("anna.muster@example.com".into()),
            citizenships: vec!["DE".into()],
            relationship_kind: Some("parent".into()),
            invoice_to: Some(lead_payer::INVOICE_TO_PAYER.into()),
            ..Default::default()
        };
        lead_payer::fit_to_representation(&mut named, &minor, None).unwrap();
        assert!(named.is_representative());
        assert!(!named.is_third_party());
        assert_eq!(named.payer_representative_id, Some(id(1)));
        assert_eq!(named.first_name, None);
        assert!(named.citizenships.is_empty());
        assert_eq!(named.relationship_kind, None);
        assert_eq!(named.invoice_to, None);
        // Shown with the representative's own data.
        let shown = named.with_representative(&minor);
        assert_eq!(shown.payer_name().as_deref(), Some("Anna Muster"));
        assert_eq!(shown.date_of_birth, NaiveDate::from_ymd_opt(1985, 3, 2));
        assert_eq!(shown.street.as_deref(), Some("Musterweg 1"));
        assert_eq!(shown.zip.as_deref(), Some("10115"));
        assert_eq!(shown.city.as_deref(), Some("Berlin"));
        assert_eq!(shown.country.as_deref(), Some("DE"));
        assert_eq!(shown.citizenships, ["DE"]);
        // The order names her as contracting party, not as Kostenübernehmer.
        let record = named.representative_payer_record(&minor, None).unwrap();
        assert_eq!(record.contact_name.as_deref(), Some("Anna Muster"));
        assert_eq!(record.payer_role.as_deref(), Some("contracting_party"));
        assert_eq!(record.address_city.as_deref(), Some("Berlin"));
        assert!(named.order_payer_record(None).is_none());

        // A minor does not pay himself; only a current representative of a
        // minor is named.
        let mut own = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            ..Default::default()
        };
        assert_eq!(
            lead_payer::fit_to_representation(&mut own, &minor, None),
            Err("payer_self_minor")
        );
        assert_eq!(
            lead_payer::fit_to_representation(&mut representative(9), &minor, None),
            Err("payer_representative_invalid")
        );
        let adult = Representation {
            minor: false,
            ..minor.clone()
        };
        assert_eq!(
            lead_payer::fit_to_representation(&mut representative(1), &adult, None),
            Err("payer_representative_not_minor")
        );
        assert!(lead_payer::fit_to_representation(&mut own, &adult, None).is_ok());
        // Somebody else stays a third party.
        let mut aunt = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some(lead_payer::PAYER_TYPE_PERSON.into()),
            first_name: Some("Erika".into()),
            last_name: Some("Zahler".into()),
            email: Some("erika@example.com".into()),
            ..Default::default()
        };
        lead_payer::fit_to_representation(&mut aunt, &minor, None).unwrap();
        assert!(aunt.is_third_party());
    }

    #[test]
    fn the_subject_of_a_representative_round_trips() {
        let subject = subject_of(id(7));
        assert_eq!(subject, format!("representative:{}", id(7)));
        assert_eq!(subject_representative(&subject), Some(id(7)));
        assert_eq!(subject_representative("representative:someone"), None);
        assert_eq!(subject_representative("payer"), None);
    }
}
