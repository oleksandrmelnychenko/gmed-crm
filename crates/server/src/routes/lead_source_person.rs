//! «Нова заявка для цієї особи» (owner decision 2026-10-25): a parent,
//! guardian or other relation recorded on a patient (`patient_relations`) or
//! on an open request (`leads.trusted_contacts[]`) becomes a lead of their
//! own with the identity data GMED already holds pre-filled.
//!
//! `POST /leads` takes `source_person` (`{patient_id, relation_id}` or
//! `{lead_id, contact_id}`). The server
//!
//! - needs, besides `leads.create`, read access to the source patient
//!   ([`super::patients::has_patient_access`]) or edit access to the source
//!   lead (the same capability as the request itself);
//! - refuses with 409 `existing_parent_patient_use_repeat_intake` when the
//!   relation / contact already points to an own patient record;
//! - merges the person first-non-empty: the relation row (or the trusted
//!   contact) first, then the `lead_representatives` row of the child's
//!   request ([`crate::services::lead_guardian_identity::load_contact`]),
//!   where the identity document and the birth place live;
//! - fills ONLY the empty fields of the new lead (the request body wins) and
//!   the identity block of `lead_gwg_declarations` (COALESCE upsert, as the
//!   repeat intake does), audits `lead_prefilled_from_relation` with the
//!   field names — never the values — and the source ids;
//! - remembers the source on the lead (`source_relation_id`,
//!   `source_contact_lead_id` + `source_contact_id`), so the conversion points
//!   the relation / the contact at the new patient record
//!   ([`super::lead_portal_account::link_source_person_in_tx`]).
//!
//! Data reuse only. Never copied: PEP / sanctions answers, scans, the relation
//! type, custody, consents, signatures, guardian grants, the child's payer
//! declaration, payment route or funds, risk decisions, medical data,
//! `legal_sex`. The child's own PEP / sanctions answers about this person are
//! returned as read-only `hints` for staff; the cabinet asks again.

use axum::{Json, http::StatusCode, response::IntoResponse};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::lead_guardian_identity::{self, CanonicalGuardianIdentity};
use crate::state::AppState;

/// The 409 code shared with the guardian-login case of `create_lead`.
pub(crate) const EXISTING_PATIENT_CODE: &str = "existing_parent_patient_use_repeat_intake";
/// The audit action of the pre-fill (field names only).
pub(crate) const AUDIT_ACTION: &str = "lead_prefilled_from_relation";

/// `source_person` of `POST /leads`.
#[derive(Clone, Copy, Debug, Deserialize)]
pub(crate) struct SourcePersonRequest {
    #[serde(default)]
    pub patient_id: Option<Uuid>,
    #[serde(default)]
    pub relation_id: Option<Uuid>,
    #[serde(default)]
    pub lead_id: Option<Uuid>,
    #[serde(default)]
    pub contact_id: Option<Uuid>,
}

/// Where the person is recorded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourcePerson {
    /// A `patient_relations` row of `patient_id`.
    PatientRelation { patient_id: Uuid, relation_id: Uuid },
    /// A `trusted_contacts[]` entry of `lead_id`.
    LeadContact { lead_id: Uuid, contact_id: Uuid },
}

impl SourcePersonRequest {
    /// One of the two id pairs, complete.
    pub(crate) fn resolve(self) -> Result<SourcePerson, &'static str> {
        match (
            self.patient_id,
            self.relation_id,
            self.lead_id,
            self.contact_id,
        ) {
            (Some(patient_id), Some(relation_id), None, None) => {
                Ok(SourcePerson::PatientRelation {
                    patient_id,
                    relation_id,
                })
            }
            (None, None, Some(lead_id), Some(contact_id)) => Ok(SourcePerson::LeadContact {
                lead_id,
                contact_id,
            }),
            _ => Err("source_person needs patient_id + relation_id or lead_id + contact_id"),
        }
    }
}

impl SourcePerson {
    /// The ids for the audit row and the response.
    pub(crate) fn ids(&self) -> Value {
        match self {
            SourcePerson::PatientRelation {
                patient_id,
                relation_id,
            } => json!({ "patient_id": patient_id, "relation_id": relation_id }),
            SourcePerson::LeadContact {
                lead_id,
                contact_id,
            } => json!({ "lead_id": lead_id, "contact_id": contact_id }),
        }
    }
}

/// The child's own answers about this person, shown to staff, never written.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Hints {
    pub pep_self: Option<bool>,
    pub sanctions_links: Option<bool>,
    /// The person's identity scan on the child's request; staff may look at
    /// it, the new request gets its own upload.
    pub identity_document_id: Option<Uuid>,
}

impl Hints {
    fn answer(value: Option<bool>) -> Value {
        match value {
            Some(true) => json!("yes"),
            Some(false) => json!("no"),
            None => Value::Null,
        }
    }

    pub(crate) fn to_json(&self) -> Value {
        json!({
            "pep_self": Self::answer(self.pep_self),
            "sanctions_links": Self::answer(self.sanctions_links),
            "identity_document_id": self.identity_document_id,
        })
    }
}

/// The person as GMED knows them, merged first-non-empty.
#[derive(Clone, Debug)]
pub(crate) struct SourcePersonData {
    pub source: SourcePerson,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    /// ISO 3166-1 alpha-2.
    pub country: Option<String>,
    /// ISO codes, each once.
    pub citizenships: Vec<String>,
    pub birth_place: Option<String>,
    pub birth_country: Option<String>,
    pub id_document_type: Option<String>,
    pub id_document_number: Option<String>,
    pub id_issuing_authority: Option<String>,
    pub id_issuing_country: Option<String>,
    pub id_issued_on: Option<NaiveDate>,
    pub id_valid_until: Option<NaiveDate>,
    /// Lower-cased e-mails of the source record itself — the child's lead or
    /// patient e-mail and their own portal login: never copied to the person.
    pub record_emails: Vec<String>,
    /// The source record as owner of an e-mail or phone: a lead ...
    pub record_lead_ids: Vec<Uuid>,
    /// ... or a patient. The identity check lets these owners through: the
    /// person's contact data on the child's record are the person's own.
    pub record_patient_ids: Vec<Uuid>,
    pub hints: Hints,
}

impl SourcePersonData {
    fn empty(source: SourcePerson) -> Self {
        Self {
            source,
            first_name: None,
            last_name: None,
            date_of_birth: None,
            phone: None,
            email: None,
            street: None,
            zip: None,
            city: None,
            country: None,
            citizenships: Vec::new(),
            birth_place: None,
            birth_country: None,
            id_document_type: None,
            id_document_number: None,
            id_issuing_authority: None,
            id_issuing_country: None,
            id_issued_on: None,
            id_valid_until: None,
            record_emails: Vec::new(),
            record_lead_ids: Vec::new(),
            record_patient_ids: Vec::new(),
            hints: Hints::default(),
        }
    }

    /// Whether `email` is the source record's own address (lower-cased
    /// comparison): such an address is skipped.
    pub(crate) fn is_record_email(&self, email: &str) -> bool {
        let email = email.trim().to_lowercase();
        self.record_emails.contains(&email)
    }

    /// The e-mail to offer for the new lead: the person's own, well formed,
    /// and not the child's own address.
    fn offered_email(&self) -> Option<String> {
        let email = super::lead_portal_account::normalize_portal_email(self.email.as_deref())?;
        (!self.is_record_email(&email)).then_some(email)
    }

    /// Whether the identity check may ignore a conflict with this owner.
    pub(crate) fn owns(&self, owner_lead: Option<Uuid>, owner_patient: Option<Uuid>) -> bool {
        owner_lead.is_some_and(|id| self.record_lead_ids.contains(&id))
            || owner_patient.is_some_and(|id| self.record_patient_ids.contains(&id))
    }

    /// Whether anything for `lead_gwg_declarations` is known.
    fn has_declaration_data(&self) -> bool {
        self.birth_place.is_some()
            || self.birth_country.is_some()
            || self.id_document_type.is_some()
            || self.id_document_number.is_some()
            || self.id_issuing_authority.is_some()
            || self.id_issuing_country.is_some()
            || self.id_issued_on.is_some()
            || self.id_valid_until.is_some()
    }

    fn has_identity_document(&self) -> bool {
        self.id_document_type.is_some()
            || self.id_document_number.is_some()
            || self.id_issuing_authority.is_some()
            || self.id_issuing_country.is_some()
            || self.id_issued_on.is_some()
            || self.id_valid_until.is_some()
    }
}

/// The body fields of `POST /leads` the source may complete.
pub(crate) struct BodyFields<'a> {
    pub first_name: &'a mut String,
    pub last_name: &'a mut String,
    pub date_of_birth: &'a mut Option<String>,
    pub phone: &'a mut Option<String>,
    pub email: &'a mut Option<String>,
    pub country: &'a mut Option<String>,
    pub citizenships: &'a mut Option<Vec<String>>,
}

fn blank(value: Option<&str>) -> bool {
    value.is_none_or(|value| value.trim().is_empty())
}

fn clean(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn text(value: &Value, key: &str) -> Option<String> {
    clean(value.get(key).and_then(Value::as_str))
}

fn date(value: &Value, key: &str) -> Option<NaiveDate> {
    text(value, key).and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok())
}

fn iso_codes(values: &[String]) -> Vec<String> {
    let mut codes: Vec<String> = Vec::new();
    for code in values {
        let code = code.trim().to_ascii_uppercase();
        if crate::services::citizenships::is_country_code(&code) && !codes.contains(&code) {
            codes.push(code);
        }
    }
    codes
}

/// An address written on one line, as the repeat intake and the cabinet
/// write it ("Musterstr. 1, 10115 Berlin, DE"): the parts it clearly has.
/// Anything else stays the street line — staff edit everything in the wizard.
pub(crate) fn split_address_text(
    text: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let parts = text
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let zip_city = |part: &str| -> Option<(String, String)> {
        let (zip, city) = part.split_once(char::is_whitespace)?;
        let zip = zip.trim();
        let city = city.trim();
        (!zip.is_empty()
            && zip.len() <= 10
            && zip.chars().any(|c| c.is_ascii_digit())
            && zip.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !city.is_empty())
        .then(|| (zip.to_string(), city.to_string()))
    };
    match parts.as_slice() {
        [] => (None, None, None, None),
        [street] => (Some((*street).to_string()), None, None, None),
        [street, place] => match zip_city(place) {
            Some((zip, city)) => (Some((*street).to_string()), Some(zip), Some(city), None),
            None => (Some(text.trim().to_string()), None, None, None),
        },
        [street, place, country] => match (
            zip_city(place),
            lead_guardian_identity::iso_country(country),
        ) {
            (Some((zip, city)), Some(code)) => (
                Some((*street).to_string()),
                Some(zip),
                Some(city),
                Some(code),
            ),
            (Some((zip, city)), None) => (
                Some(format!("{street}, {country}")),
                Some(zip),
                Some(city),
                None,
            ),
            _ => (Some(text.trim().to_string()), None, None, None),
        },
        _ => (Some(text.trim().to_string()), None, None, None),
    }
}

/// Fills the empty body fields from the source; returns the names of the
/// fields filled (the body wins where it says anything). A malformed e-mail
/// or phone on the source is not offered; the child's own e-mail never is.
pub(crate) fn fill_body(data: &SourcePersonData, body: BodyFields<'_>) -> Vec<&'static str> {
    let mut filled = Vec::new();
    if body.first_name.trim().is_empty()
        && let Some(value) = &data.first_name
    {
        *body.first_name = value.clone();
        filled.push("first_name");
    }
    if body.last_name.trim().is_empty()
        && let Some(value) = &data.last_name
    {
        *body.last_name = value.clone();
        filled.push("last_name");
    }
    if blank(body.date_of_birth.as_deref())
        && let Some(value) = data.date_of_birth
    {
        *body.date_of_birth = Some(value.format("%Y-%m-%d").to_string());
        filled.push("date_of_birth");
    }
    if blank(body.phone.as_deref())
        && let Some(value) = data
            .phone
            .as_deref()
            .filter(|phone| crate::services::person_fields::is_valid_phone(phone))
    {
        *body.phone = Some(value.to_string());
        filled.push("phone");
    }
    if blank(body.email.as_deref())
        && let Some(value) = data.offered_email()
    {
        *body.email = Some(value);
        filled.push("email");
    }
    if blank(body.country.as_deref())
        && let Some(value) = &data.country
    {
        *body.country = Some(value.clone());
        filled.push("country");
    }
    if body
        .citizenships
        .as_deref()
        .is_none_or(|codes| codes.iter().all(|code| code.trim().is_empty()))
        && !data.citizenships.is_empty()
    {
        *body.citizenships = Some(data.citizenships.clone());
        filled.push("citizenships");
    }
    filled
}

fn coded(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": code,
            "code": code,
            "message": message,
        })),
    )
        .into_response()
}

fn field_err(field: &str, message: &str) -> axum::response::Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({
            "error": StatusCode::UNPROCESSABLE_ENTITY.canonical_reason().unwrap_or("error"),
            "message": message,
            "field": field,
        })),
    )
        .into_response()
}

fn failed(error: sqlx::Error, what: &str) -> axum::response::Response {
    tracing::error!(%error, "load source person: {what}");
    coded(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Internal Server Error",
        "Failed to read the source person",
    )
}

/// 409: the person already has a patient record of their own — open it or
/// start a repeat intake there. The id is given to an actor who may see the
/// record, as the guardian-login case does.
async fn existing_patient_response(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> axum::response::Response {
    let visible = match super::patients::has_patient_access(state, auth, patient_id).await {
        Ok(visible) => visible,
        Err(response) => return response,
    };
    let id = visible.then_some(patient_id);
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": EXISTING_PATIENT_CODE,
            "code": EXISTING_PATIENT_CODE,
            "message": "This person already has a patient record. Open that record to activate the existing login or start a repeat intake.",
            "patient_id": id,
            "existing_patient_id": id,
        })),
    )
        .into_response()
}

/// Loads and merges the person; checks access and the own-record rule.
pub(crate) async fn load(
    state: &AppState,
    auth: &AuthUser,
    request: SourcePersonRequest,
) -> Result<SourcePersonData, axum::response::Response> {
    let source = request
        .resolve()
        .map_err(|message| field_err("source_person", message))?;
    match source {
        SourcePerson::PatientRelation {
            patient_id,
            relation_id,
        } => load_patient_relation(state, auth, source, patient_id, relation_id).await,
        SourcePerson::LeadContact {
            lead_id,
            contact_id,
        } => load_lead_contact(state, auth, source, lead_id, contact_id).await,
    }
}

async fn load_patient_relation(
    state: &AppState,
    auth: &AuthUser,
    source: SourcePerson,
    patient_id: Uuid,
    relation_id: Uuid,
) -> Result<SourcePersonData, axum::response::Response> {
    if !super::patients::has_patient_access(state, auth, patient_id).await? {
        return Err(coded(
            StatusCode::FORBIDDEN,
            "Forbidden",
            "No access to the source patient",
        ));
    }
    let Some(relation) = sqlx::query(
        r#"SELECT r.related_patient_id, r.related_name, r.phone, r.email,
                  r.address_street, r.address_zip, r.address_city, r.address_country,
                  r.birth_date, r.citizenships, r.source_contact_id
           FROM patient_relations r
           JOIN patients child ON child.id = r.patient_id
           WHERE r.id = $1 AND r.patient_id = $2
             AND child.lifecycle_status <> 'deleted'"#,
    )
    .bind(relation_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| failed(error, "patient relation"))?
    else {
        return Err(coded(
            StatusCode::NOT_FOUND,
            "Not Found",
            "Relation not found on this patient",
        ));
    };
    if let Some(existing) = relation
        .try_get::<Option<Uuid>, _>("related_patient_id")
        .map_err(|error| failed(error, "relation link"))?
    {
        return Err(existing_patient_response(state, auth, existing).await);
    }
    let read = |key: &str| {
        relation
            .try_get::<Option<String>, _>(key)
            .unwrap_or_default()
    };
    let source_contact_id: Option<Uuid> = relation.try_get("source_contact_id").unwrap_or_default();
    let mut data = SourcePersonData::empty(source);
    data.record_patient_ids.push(patient_id);

    // The child's requests that know this contact: the identity document and
    // the birth place live on the newest `lead_representatives` row.
    let contact_keys = [source_contact_id, Some(relation_id)]
        .into_iter()
        .flatten()
        .map(|id| id.to_string())
        .collect::<Vec<_>>();
    let known = sqlx::query_as::<_, (Uuid, String)>(
        r#"SELECT l.id, c ->> 'id'
           FROM leads l
           CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(l.trusted_contacts) = 'array'
                    THEN l.trusted_contacts ELSE '[]'::jsonb END) c
           LEFT JOIN lead_representatives r
                  ON r.lead_id = l.id AND r.contact_id::text = c ->> 'id'
           WHERE (l.converted_patient_id = $1 OR l.repeat_patient_id = $1)
             AND l.qualification_status <> 'deleted'
             AND c ->> 'id' = ANY($2::text[])
           ORDER BY (r.contact_id IS NOT NULL) DESC, r.updated_at DESC NULLS LAST,
                    l.created_at DESC
           LIMIT 1"#,
    )
    .bind(patient_id)
    .bind(&contact_keys)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| failed(error, "child's request contact"))?;
    let identity = match known {
        Some((lead_id, contact_id)) => match Uuid::parse_str(&contact_id) {
            Ok(contact_id) => {
                let mut conn = state
                    .db
                    .acquire()
                    .await
                    .map_err(|error| failed(error, "connection"))?;
                let identity = lead_guardian_identity::load_contact(&mut conn, lead_id, contact_id)
                    .await
                    .map_err(|error| failed(error, "representative identity"))?;
                data.hints = hints(&state.db, lead_id, contact_id)
                    .await
                    .map_err(|error| failed(error, "hints"))?;
                identity
            }
            Err(_) => None,
        },
        None => None,
    };

    // The relation first, the child's request second.
    let (contact, extras) = identity
        .as_ref()
        .map(|identity| (identity.contact.clone(), identity.extras.clone()))
        .unwrap_or((json!({}), json!({})));
    let related_name =
        read("related_name").map(|name| crate::services::person_fields::one_line(&name));
    let (first, last) = match related_name.as_deref().filter(|name| !name.is_empty()) {
        Some(name) => super::lead_representatives::name_parts(
            name,
            text(&extras, "first_name").as_deref(),
            text(&extras, "last_name").as_deref(),
        ),
        None => (
            text(&extras, "first_name").unwrap_or_default(),
            text(&extras, "last_name").unwrap_or_default(),
        ),
    };
    data.first_name = clean(Some(&first));
    data.last_name = clean(Some(&last));
    data.date_of_birth = relation
        .try_get::<Option<NaiveDate>, _>("birth_date")
        .unwrap_or_default()
        .or_else(|| date(&contact, "birth_date"));
    data.phone = read("phone").or_else(|| text(&contact, "phone"));
    data.email = read("email").or_else(|| text(&contact, "email"));
    data.street = read("address_street").or_else(|| text(&extras, "street"));
    data.zip = read("address_zip").or_else(|| text(&extras, "zip"));
    data.city = read("address_city").or_else(|| text(&extras, "city"));
    data.country = read("address_country")
        .and_then(|value| lead_guardian_identity::iso_country(&value))
        .or_else(|| text(&extras, "country"));
    let relation_citizenships = relation
        .try_get::<Option<Vec<String>>, _>("citizenships")
        .unwrap_or_default()
        .unwrap_or_default();
    data.citizenships = iso_codes(&relation_citizenships);
    if data.citizenships.is_empty()
        && let Some(identity) = &identity
    {
        data.citizenships = iso_codes(&identity.citizenships);
    }
    take_declaration(&mut data, &extras);
    record_of_patient(&state.db, &mut data, patient_id)
        .await
        .map_err(|error| failed(error, "child's record"))?;
    Ok(data)
}

async fn load_lead_contact(
    state: &AppState,
    auth: &AuthUser,
    source: SourcePerson,
    lead_id: Uuid,
    contact_id: Uuid,
) -> Result<SourcePersonData, axum::response::Response> {
    // Editing the source lead takes the capability the request itself needs
    // (`leads.create` = `LeadsEdit`), checked by `create_lead` already.
    let Some(lead) = sqlx::query(
        r#"SELECT l.email, l.converted_patient_id, l.prospect_patient_id, l.repeat_patient_id,
                  l.trusted_contacts, u.email AS login_email
           FROM leads l
           LEFT JOIN users u ON u.id = l.portal_user_id
           WHERE l.id = $1 AND l.qualification_status <> 'deleted'"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| failed(error, "source lead"))?
    else {
        return Err(coded(StatusCode::NOT_FOUND, "Not Found", "Lead not found"));
    };
    let contacts: Option<Value> = lead.try_get("trusted_contacts").unwrap_or_default();
    let Some(contact) = contacts
        .as_ref()
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|contact| {
            contact
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok())
                == Some(contact_id)
        })
        .cloned()
    else {
        return Err(coded(
            StatusCode::NOT_FOUND,
            "Not Found",
            "Trusted contact not found on this lead",
        ));
    };
    if let Some(existing) = contact
        .get("related_patient_id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
    {
        return Err(existing_patient_response(state, auth, existing).await);
    }
    let mut conn = state
        .db
        .acquire()
        .await
        .map_err(|error| failed(error, "connection"))?;
    let identity: Option<CanonicalGuardianIdentity> =
        lead_guardian_identity::load_contact(&mut conn, lead_id, contact_id)
            .await
            .map_err(|error| failed(error, "representative identity"))?;
    drop(conn);
    let mut data = SourcePersonData::empty(source);
    data.hints = hints(&state.db, lead_id, contact_id)
        .await
        .map_err(|error| failed(error, "hints"))?;
    let (contact, extras) = identity
        .as_ref()
        .map(|identity| (identity.contact.clone(), identity.extras.clone()))
        .unwrap_or((contact, json!({})));
    let name = text(&contact, "name").map(|name| crate::services::person_fields::one_line(&name));
    let (first, last) = match name.as_deref().filter(|name| !name.is_empty()) {
        Some(name) => super::lead_representatives::name_parts(
            name,
            text(&extras, "first_name").as_deref(),
            text(&extras, "last_name").as_deref(),
        ),
        None => (
            text(&extras, "first_name").unwrap_or_default(),
            text(&extras, "last_name").unwrap_or_default(),
        ),
    };
    data.first_name = clean(Some(&first));
    data.last_name = clean(Some(&last));
    data.date_of_birth = date(&contact, "birth_date").or_else(|| date(&contact, "date_of_birth"));
    data.phone = text(&contact, "phone");
    data.email = text(&contact, "email");
    data.street = text(&extras, "street");
    data.zip = text(&extras, "zip");
    data.city = text(&extras, "city");
    data.country = text(&extras, "country").or_else(|| {
        text(&contact, "country")
            .or_else(|| text(&contact, "residence_country"))
            .and_then(|value| lead_guardian_identity::iso_country(&value))
    });
    if data.street.is_none()
        && data.zip.is_none()
        && data.city.is_none()
        && let Some(address) = text(&contact, "address")
    {
        let (street, zip, city, country) = split_address_text(&address);
        data.street = street;
        data.zip = zip;
        data.city = city;
        if data.country.is_none() {
            data.country = country;
        }
    }
    if let Some(identity) = &identity {
        data.citizenships = iso_codes(&identity.citizenships);
    }
    take_declaration(&mut data, &extras);

    data.record_lead_ids.push(lead_id);
    for key in [
        "converted_patient_id",
        "prospect_patient_id",
        "repeat_patient_id",
    ] {
        if let Some(id) = lead.try_get::<Option<Uuid>, _>(key).unwrap_or_default() {
            data.record_patient_ids.push(id);
        }
    }
    for key in ["email", "login_email"] {
        if let Some(email) = lead.try_get::<Option<String>, _>(key).unwrap_or_default() {
            let email = email.trim().to_lowercase();
            if !email.is_empty() {
                data.record_emails.push(email);
            }
        }
    }
    Ok(data)
}

/// The identity block of the child's `lead_representatives` row.
fn take_declaration(data: &mut SourcePersonData, extras: &Value) {
    data.birth_place = text(extras, "birth_place");
    data.birth_country = text(extras, "birth_country")
        .filter(|code| crate::services::citizenships::is_country_code(code));
    data.id_document_type = text(extras, "id_document_type")
        .filter(|kind| matches!(kind.as_str(), "passport" | "id_card" | "residence_permit"));
    data.id_document_number =
        text(extras, "id_document_number").filter(|n| n.chars().count() <= 60);
    data.id_issuing_authority =
        text(extras, "id_issuing_authority").filter(|a| a.chars().count() <= 200);
    data.id_issuing_country = text(extras, "id_issuing_country")
        .filter(|code| crate::services::citizenships::is_country_code(code));
    data.id_issued_on = date(extras, "id_issued_on");
    data.id_valid_until = date(extras, "id_valid_until");
}

/// The child's own answers about this person and the person's identity scan
/// on the child's request.
async fn hints(pool: &sqlx::PgPool, lead_id: Uuid, contact_id: Uuid) -> Result<Hints, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT r.country_questions ->> 'pep_self' AS pep_self,
                  r.country_questions ->> 'sanctions_links' AS sanctions_links,
                  (SELECT u.document_id
                   FROM lead_portal_uploads u
                   JOIN documents d ON d.id = u.document_id
                   WHERE u.lead_id = r.lead_id AND u.representative_id = r.contact_id
                     AND u.kind = 'representative_identity'
                     AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL
                   ORDER BY u.created_at DESC
                   LIMIT 1) AS identity_document_id
           FROM lead_representatives r
           WHERE r.lead_id = $1 AND r.contact_id = $2"#,
    )
    .bind(lead_id)
    .bind(contact_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(Hints::default());
    };
    let answer = |key: &str| match row.try_get::<Option<String>, _>(key).unwrap_or_default() {
        Some(value) if value == "true" => Some(true),
        Some(value) if value == "false" => Some(false),
        _ => None,
    };
    Ok(Hints {
        pep_self: answer("pep_self"),
        sanctions_links: answer("sanctions_links"),
        identity_document_id: row.try_get("identity_document_id").unwrap_or_default(),
    })
}

/// The child's own e-mails and requests: the patient's address, the
/// addresses of their requests and their own logins.
async fn record_of_patient(
    pool: &sqlx::PgPool,
    data: &mut SourcePersonData,
    patient_id: Uuid,
) -> Result<(), sqlx::Error> {
    let emails: Vec<String> = sqlx::query_scalar(
        r#"SELECT DISTINCT lower(btrim(e)) FROM (
               SELECT p.email AS e FROM patients p WHERE p.id = $1
               UNION ALL
               SELECT l.email FROM leads l
               WHERE l.converted_patient_id = $1 OR l.repeat_patient_id = $1
                  OR l.prospect_patient_id = $1
               UNION ALL
               SELECT u.email FROM leads l JOIN users u ON u.id = l.portal_user_id
               WHERE l.converted_patient_id = $1 OR l.repeat_patient_id = $1
               UNION ALL
               SELECT u.email FROM patient_assignments pa
               JOIN users u ON u.id = pa.user_id AND u.role = 'patient'
               WHERE pa.patient_id = $1 AND pa.source <> 'lead_guardian'
           ) x WHERE NULLIF(btrim(e), '') IS NOT NULL"#,
    )
    .bind(patient_id)
    .fetch_all(pool)
    .await?;
    data.record_emails.extend(emails);
    let leads: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM leads
         WHERE converted_patient_id = $1 OR repeat_patient_id = $1 OR prospect_patient_id = $1",
    )
    .bind(patient_id)
    .fetch_all(pool)
    .await?;
    data.record_lead_ids.extend(leads);
    Ok(())
}

/// Writes what the body could not carry — the address, the identity block
/// of the GwG sheet — only where the new lead is still empty, remembers the
/// source on the lead and audits the field names. Returns every field filled
/// (`filled_in_body` plus these), for the response.
pub(crate) async fn apply_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    data: &SourcePersonData,
    filled_in_body: Vec<&'static str>,
    actor: Uuid,
) -> Result<Vec<&'static str>, sqlx::Error> {
    let mut fields = filled_in_body;
    let (relation_id, contact_lead_id, contact_id) = match data.source {
        SourcePerson::PatientRelation { relation_id, .. } => (Some(relation_id), None, None),
        SourcePerson::LeadContact {
            lead_id,
            contact_id,
        } => (None, Some(lead_id), Some(contact_id)),
    };
    let (street, zip, city): (bool, bool, bool) = sqlx::query_as(
        r#"UPDATE leads
           SET street_address = COALESCE(NULLIF(btrim(street_address), ''), $2),
               zip_code = COALESCE(NULLIF(btrim(zip_code), ''), $3),
               city = COALESCE(NULLIF(btrim(city), ''), $4),
               source_relation_id = $5,
               source_contact_lead_id = $6,
               source_contact_id = $7
           WHERE id = $1
           RETURNING street_address IS NOT DISTINCT FROM $2 AND $2 IS NOT NULL,
                     zip_code IS NOT DISTINCT FROM $3 AND $3 IS NOT NULL,
                     city IS NOT DISTINCT FROM $4 AND $4 IS NOT NULL"#,
    )
    .bind(lead_id)
    .bind(data.street.as_deref())
    .bind(data.zip.as_deref())
    .bind(data.city.as_deref())
    .bind(relation_id)
    .bind(contact_lead_id)
    .bind(contact_id)
    .fetch_one(&mut **tx)
    .await?;
    if street {
        fields.push("street_address");
    }
    if zip {
        fields.push("zip_code");
    }
    if city {
        fields.push("city");
    }
    if data.has_declaration_data() {
        let row = sqlx::query(
            r#"INSERT INTO lead_gwg_declarations (
                   lead_id, birth_place, birth_country, id_document_type, id_document_number,
                   id_issuing_authority, id_issuing_country, id_issued_on, id_valid_until,
                   id_data_entered_by, id_data_entered_at, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                       CASE WHEN $11 THEN $10 END,
                       CASE WHEN $11 THEN clock_timestamp() END, $10)
               ON CONFLICT (lead_id) DO UPDATE SET
                   birth_place = COALESCE(lead_gwg_declarations.birth_place, EXCLUDED.birth_place),
                   birth_country = COALESCE(lead_gwg_declarations.birth_country, EXCLUDED.birth_country),
                   id_document_type = COALESCE(lead_gwg_declarations.id_document_type, EXCLUDED.id_document_type),
                   id_document_number = COALESCE(lead_gwg_declarations.id_document_number, EXCLUDED.id_document_number),
                   id_issuing_authority = COALESCE(lead_gwg_declarations.id_issuing_authority, EXCLUDED.id_issuing_authority),
                   id_issuing_country = COALESCE(lead_gwg_declarations.id_issuing_country, EXCLUDED.id_issuing_country),
                   id_issued_on = COALESCE(lead_gwg_declarations.id_issued_on, EXCLUDED.id_issued_on),
                   id_valid_until = COALESCE(lead_gwg_declarations.id_valid_until, EXCLUDED.id_valid_until),
                   id_data_entered_by = COALESCE(lead_gwg_declarations.id_data_entered_by, EXCLUDED.id_data_entered_by),
                   id_data_entered_at = COALESCE(lead_gwg_declarations.id_data_entered_at, EXCLUDED.id_data_entered_at),
                   updated_by = EXCLUDED.updated_by
               RETURNING birth_place IS NOT DISTINCT FROM $2 AND $2 IS NOT NULL AS birth_place,
                         birth_country IS NOT DISTINCT FROM $3 AND $3 IS NOT NULL AS birth_country,
                         id_document_type IS NOT DISTINCT FROM $4 AND $4 IS NOT NULL AS id_document_type,
                         id_document_number IS NOT DISTINCT FROM $5 AND $5 IS NOT NULL AS id_document_number,
                         id_issuing_authority IS NOT DISTINCT FROM $6 AND $6 IS NOT NULL AS id_issuing_authority,
                         id_issuing_country IS NOT DISTINCT FROM $7 AND $7 IS NOT NULL AS id_issuing_country,
                         id_issued_on IS NOT DISTINCT FROM $8 AND $8 IS NOT NULL AS id_issued_on,
                         id_valid_until IS NOT DISTINCT FROM $9 AND $9 IS NOT NULL AS id_valid_until"#,
        )
        .bind(lead_id)
        .bind(data.birth_place.as_deref())
        .bind(data.birth_country.as_deref())
        .bind(data.id_document_type.as_deref())
        .bind(data.id_document_number.as_deref())
        .bind(data.id_issuing_authority.as_deref())
        .bind(data.id_issuing_country.as_deref())
        .bind(data.id_issued_on)
        .bind(data.id_valid_until)
        .bind(actor)
        .bind(data.has_identity_document())
        .fetch_one(&mut **tx)
        .await?;
        for field in [
            "birth_place",
            "birth_country",
            "id_document_type",
            "id_document_number",
            "id_issuing_authority",
            "id_issuing_country",
            "id_issued_on",
            "id_valid_until",
        ] {
            if row.try_get::<bool, _>(field)? {
                fields.push(field);
            }
        }
    }
    // Field names and source ids only: the values are personal data of the
    // person and stay on the lead.
    audit::write_in_transaction(
        tx,
        &audit::domain_event(
            AUDIT_ACTION,
            Some(actor),
            "lead",
            Some(lead_id),
            json!({ "fields": &fields, "source": data.source.ids() }),
        ),
    )
    .await?;
    Ok(fields)
}

/// `prefilled_from_source` of the `POST /leads` response.
pub(crate) fn response_fragment(data: &SourcePersonData, fields: &[&str]) -> Value {
    json!({
        "fields": fields,
        "hints": data.hints.to_json(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_needs_one_complete_pair() {
        let patient = Uuid::new_v4();
        let relation = Uuid::new_v4();
        let request = SourcePersonRequest {
            patient_id: Some(patient),
            relation_id: Some(relation),
            lead_id: None,
            contact_id: None,
        };
        assert_eq!(
            request.resolve().unwrap(),
            SourcePerson::PatientRelation {
                patient_id: patient,
                relation_id: relation
            }
        );
        let mixed = SourcePersonRequest {
            patient_id: Some(patient),
            relation_id: None,
            lead_id: Some(patient),
            contact_id: None,
        };
        assert!(mixed.resolve().is_err());
    }

    #[test]
    fn one_line_address_splits_into_its_parts() {
        assert_eq!(
            split_address_text("Musterstr. 1, 10115 Berlin, DE"),
            (
                Some("Musterstr. 1".into()),
                Some("10115".into()),
                Some("Berlin".into()),
                Some("DE".into())
            )
        );
        assert_eq!(
            split_address_text("Musterstr. 1, 10115 Berlin"),
            (
                Some("Musterstr. 1".into()),
                Some("10115".into()),
                Some("Berlin".into()),
                None
            )
        );
        assert_eq!(
            split_address_text("Somewhere far away"),
            (Some("Somewhere far away".into()), None, None, None)
        );
        assert_eq!(
            split_address_text("Musterstr. 1, Berlin"),
            (Some("Musterstr. 1, Berlin".into()), None, None, None)
        );
    }

    #[test]
    fn body_wins_and_the_childs_email_is_skipped() {
        let mut data = SourcePersonData::empty(SourcePerson::LeadContact {
            lead_id: Uuid::nil(),
            contact_id: Uuid::nil(),
        });
        data.first_name = Some("Anna".into());
        data.last_name = Some("Muster".into());
        data.phone = Some("+49 170 1234567".into());
        data.email = Some("Child@Example.test".into());
        data.record_emails.push("child@example.test".into());
        data.citizenships = vec!["UA".into()];
        let mut first = String::new();
        let mut last = "Given".to_string();
        let mut dob = None;
        let mut phone = Some("+49 30 1".to_string());
        let mut email = None;
        let mut country = None;
        let mut citizenships = None;
        let filled = fill_body(
            &data,
            BodyFields {
                first_name: &mut first,
                last_name: &mut last,
                date_of_birth: &mut dob,
                phone: &mut phone,
                email: &mut email,
                country: &mut country,
                citizenships: &mut citizenships,
            },
        );
        assert_eq!(filled, vec!["first_name", "citizenships"]);
        assert_eq!(first, "Anna");
        assert_eq!(last, "Given");
        assert_eq!(phone.as_deref(), Some("+49 30 1"));
        assert_eq!(email, None, "the child's own address is never the parent's");
    }

    #[test]
    fn hints_are_yes_no_or_null() {
        let hints = Hints {
            pep_self: Some(true),
            sanctions_links: Some(false),
            identity_document_id: None,
        };
        assert_eq!(
            hints.to_json(),
            json!({ "pep_self": "yes", "sanctions_links": "no", "identity_document_id": null })
        );
    }
}
