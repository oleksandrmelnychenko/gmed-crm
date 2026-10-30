use axum::{
    Json, Router,
    body::Body,
    extract::{Extension, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Datelike, NaiveDate};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::HashSet;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::file_scan::{FileScanOutcome, scan_upload_bytes};
use crate::file_sniff::validate_upload_magic_bytes;
use crate::routes::documents::{NewStoredDocument, persist_document_file};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_BUNDLE_BYTES: usize = 512 * 1024;
const MAX_ATTACHMENTS: usize = 20;

/// Why a lead's file is refused. Coded, so the cabinet and the payer's link
/// say what is wrong with the file instead of "please try again" (QA
/// 2026-10-24): a photo renamed to .jpg (HEIC) or a damaged file is refused
/// for its content, a malware hit for good; a scanner that did not answer is
/// worth a retry.
pub(crate) enum LeadAttachmentRefusal {
    /// 422 `unsupported_file_type`: a type not offered, or content that does
    /// not match the type.
    UnsupportedFileType(String),
    /// 422 `file_rejected`: the malware scan found something.
    FileRejected(String),
    /// 503 `file_scan_unavailable`: the scanner did not answer.
    ScanUnavailable,
}

impl LeadAttachmentRefusal {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedFileType(_) => "unsupported_file_type",
            Self::FileRejected(_) => "file_rejected",
            Self::ScanUnavailable => "file_scan_unavailable",
        }
    }

    pub(crate) fn into_response(self) -> axum::response::Response {
        let code = self.code();
        let (status, message) = match self {
            Self::UnsupportedFileType(message) | Self::FileRejected(message) => {
                (StatusCode::UNPROCESSABLE_ENTITY, message)
            }
            Self::ScanUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "The file could not be checked right now; please try again later".to_string(),
            ),
        };
        crate::routes::lead_portal_intake::coded(status, code, &message, json!({}))
    }
}

/// The checks of a lead's file (type against content, malware scan) with the
/// refusal as a value; [`validate_lead_attachment`] turns it into the coded
/// response. Returns the canonical MIME type.
pub(crate) async fn check_lead_attachment(
    file_name: &str,
    content_type: Option<&str>,
    data: &[u8],
) -> Result<String, LeadAttachmentRefusal> {
    let canonical_mime = validate_upload_magic_bytes(Some(file_name), content_type, data)
        .map_err(|message| LeadAttachmentRefusal::UnsupportedFileType(message.to_string()))?
        .unwrap_or_else(|| "application/octet-stream".to_string());

    match scan_upload_bytes(Some(file_name), data).await {
        Ok(FileScanOutcome::Clean) => {}
        Ok(FileScanOutcome::Skipped) => {
            tracing::warn!(file_name, "lead attachment malware scan skipped");
        }
        Err(error) if error == crate::file_scan::MALWARE_FOUND => {
            tracing::warn!(file_name, "lead attachment rejected by malware scan");
            return Err(LeadAttachmentRefusal::FileRejected(error));
        }
        Err(error) => {
            tracing::error!(file_name, error = %error, "lead attachment malware scan failed");
            return Err(LeadAttachmentRefusal::ScanUnavailable);
        }
    }

    Ok(canonical_mime)
}

pub(crate) async fn validate_lead_attachment(
    file_name: &str,
    content_type: Option<&str>,
    data: &[u8],
) -> Result<String, axum::response::Response> {
    check_lead_attachment(file_name, content_type, data)
        .await
        .map_err(LeadAttachmentRefusal::into_response)
}

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

pub fn public_router() -> Router<AppState> {
    // The attachments of a website submission, as nginx allows them; axum's
    // default of 2 MB lost the whole lead with one scan (QA 2026-10-30).
    Router::new().route(
        "/public/lead-intake",
        post(ingest_lead_intake).layer(axum::extract::DefaultBodyLimit::max(30 * 1024 * 1024)),
    )
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/repeat-intakes",
            get(list_repeat_intakes),
        )
        .route(
            "/patients/{patient_id}/previous-requests",
            get(list_previous_requests),
        )
        .route("/leads", get(list_leads).post(create_lead))
        .route("/leads/referrer-patients", get(list_lead_referrer_patients))
        .route("/leads/guardian-candidates", get(list_guardian_candidates))
        .route(
            "/patients/{patient_id}/repeat-intake",
            post(retired_repeat_patient_intake),
        )
        .route("/leads/{lead_id}", get(get_lead))
        .route("/leads/{lead_id}/update", post(update_lead))
        .route(
            "/leads/{lead_id}/import-attachments",
            post(import_lead_attachments),
        )
        .route(
            "/leads/{lead_id}/promote-console",
            post(promote_lead_to_console),
        )
        .route("/leads/{lead_id}/qualify", post(qualify_lead))
        .route("/leads/{lead_id}/prospect", post(create_prospect_patient))
        .route("/leads/{lead_id}/convert", post(convert_lead))
        .route("/leads/{lead_id}/wizard-convert", post(wizard_convert_lead))
        .route("/leads/{lead_id}/failed-flow", post(resolve_failed_lead))
        .route(
            "/leads/{lead_id}/attachments/{attachment_id}",
            get(download_attachment),
        )
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}

/// The code of a write to a lead that became a patient.
pub(crate) const LEAD_CONVERTED: &str = "lead_converted";

/// The 409 of a write to a converted lead (QA 2026-10-25): the lead's data
/// is frozen with the conversion so it does not drift from the patient
/// record; the wizard reads the code and links the patient.
pub(crate) fn lead_converted_response(patient_id: Uuid) -> axum::response::Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": LEAD_CONVERTED,
            "code": LEAD_CONVERTED,
            "message": "Lead already converted",
            "converted_patient_id": patient_id,
        })),
    )
        .into_response()
}

/// Refuses a staff write with [`lead_converted_response`] once the lead is
/// converted. `Ok(())` for an unconverted or unknown lead (the caller's own
/// lookup answers 404); a database error is a 500.
pub(crate) async fn refuse_if_converted<'e, E>(
    executor: E,
    lead_id: Uuid,
) -> Result<(), axum::response::Response>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    match sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT converted_patient_id FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_optional(executor)
    .await
    {
        Ok(Some(Some(patient_id))) => Err(lead_converted_response(patient_id)),
        Ok(_) => Ok(()),
        Err(error) => {
            tracing::error!(%error, %lead_id, "check lead conversion before write");
            Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))
        }
    }
}

/// The identity document staff recorded for the lead on the GwG statements
/// (`lead_gwg_declarations.id_*`), the one source since 2026-10-07; the
/// wizard fields of older leads are the fallback for the number and validity.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct StaffIdentityDocument {
    document_type: Option<String>,
    number: Option<String>,
    issuing_authority: Option<String>,
    issuing_country: Option<String>,
    issued_on: Option<NaiveDate>,
    valid_until: Option<NaiveDate>,
}

impl StaffIdentityDocument {
    /// The number of a passport card, as the card stores it: trimmed, at most
    /// 60 characters (the GwG sheet's own bound).
    fn card_number(value: Option<&str>) -> Option<String> {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= 60)
            .map(str::to_string)
    }
}

/// Loads [`StaffIdentityDocument`] for the conversion of `lead_id`: the GwG
/// statement first, the wizard's `passport_number` / `passport_expiry` where
/// the statement has none (QA 2026-10-25: the card got only the validity).
async fn load_staff_identity_document(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
    wizard_state: &Value,
) -> Result<StaffIdentityDocument, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id_document_type, id_document_number, id_issuing_authority,
                  id_issuing_country, id_issued_on, id_valid_until
           FROM lead_gwg_declarations WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    let text = |key: &str| {
        row.as_ref()
            .and_then(|row| row.try_get::<Option<String>, _>(key).ok().flatten())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let date = |key: &str| {
        row.as_ref()
            .and_then(|row| row.try_get::<Option<NaiveDate>, _>(key).ok().flatten())
    };
    let number =
        StaffIdentityDocument::card_number(text("id_document_number").as_deref()).or_else(|| {
            StaffIdentityDocument::card_number(
                lead_wizard_text(wizard_state, "passport_number").as_deref(),
            )
        });
    Ok(StaffIdentityDocument {
        document_type: text("id_document_type"),
        number,
        issuing_authority: text("id_issuing_authority"),
        issuing_country: text("id_issuing_country"),
        issued_on: date("id_issued_on"),
        valid_until: date("id_valid_until")
            .or_else(|| lead_wizard_date(wizard_state, "passport_expiry")),
    })
}

fn normalized_language_code(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_lowercase().replace('_', "-");
    let base = normalized.split('-').next().unwrap_or_default();
    match normalized.as_str() {
        "deutsch" | "german" => Some("de"),
        "englisch" | "english" => Some("en"),
        "russisch" | "russian" => Some("ru"),
        "ukrainisch" | "ukrainian" => Some("uk"),
        "arabisch" | "arabic" => Some("ar"),
        "portugiesisch" | "portuguese" => Some("pt"),
        "französisch" | "french" => Some("fr"),
        "spanisch" | "spanish" => Some("es"),
        "italienisch" | "italian" => Some("it"),
        "türkisch" | "turkish" => Some("tr"),
        "polnisch" | "polish" => Some("pl"),
        "tschechisch" | "czech" => Some("cs"),
        "dänisch" | "danish" => Some("da"),
        "griechisch" | "greek" => Some("el"),
        "lettisch" | "latvian" => Some("lv"),
        "chinesisch" | "chinese" => Some("zh"),
        "persisch" | "persian" | "farsi" => Some("fa"),
        "urdu" => Some("ur"),
        _ => match base {
            "de" => Some("de"),
            "uk" | "ua" => Some("uk"),
            "ru" => Some("ru"),
            "en" => Some("en"),
            "ar" => Some("ar"),
            "fa" => Some("fa"),
            "pt" => Some("pt"),
            "fr" => Some("fr"),
            "es" => Some("es"),
            "it" => Some("it"),
            "tr" => Some("tr"),
            "pl" => Some("pl"),
            "cs" | "cz" => Some("cs"),
            "da" => Some("da"),
            "el" | "gr" => Some("el"),
            "lv" => Some("lv"),
            "zh" => Some("zh"),
            "ur" => Some("ur"),
            _ => crate::routes::patients::ALLOWED_PATIENT_LANGUAGES
                .iter()
                .copied()
                .find(|candidate| *candidate == base),
        },
    }
}

pub(crate) fn normalize_intake_language(
    value: Option<&str>,
    locale: Option<&str>,
) -> Option<String> {
    value
        .and_then(normalized_language_code)
        .or_else(|| locale.and_then(normalized_language_code))
        .map(str::to_string)
}

/// The languages a patient created from a lead starts with: the lead's
/// preferred language, else the language of its cabinet, else German, the
/// agency's working language. The wizard does not require the field, and a
/// patient without any language was blocked for every repeat order (QA C2-06).
pub(crate) fn converted_patient_languages(
    value: Option<&str>,
    locale: Option<&str>,
) -> Vec<String> {
    vec![normalize_intake_language(value, locale).unwrap_or_else(|| "de".to_string())]
}

// ----------------------------------------------------------------------------
// Authenticated CRUD
// ----------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateLeadRequest {
    creation_key: Option<Uuid>,
    repeat_patient_id: Option<Uuid>,
    /// Empty when the person comes from `source_person` (filled from there).
    #[serde(default)]
    first_name: String,
    #[serde(default)]
    last_name: String,
    /// «Neue Anfrage für diese Person» (owner decision 2026-10-25): a relation
    /// of a patient or a trusted contact of an open lead whose identity data
    /// pre-fill the empty fields of this lead
    /// ([`crate::routes::lead_source_person`]).
    #[serde(default)]
    source_person: Option<super::lead_source_person::SourcePersonRequest>,
    email: Option<String>,
    phone: Option<String>,
    date_of_birth: Option<String>,
    trusted_contacts: Option<Vec<TrustedContactRequest>>,
    source: Option<String>,
    country: Option<String>,
    notes: Option<String>,
    /// ISO 3166-1 alpha-2 codes; a person may hold several.
    citizenships: Option<Vec<String>>,
    /// Who represents a minor (`joint`, `sole_parent`, `guardian`), stated
    /// by staff with the new lead: a guardian (Vormund) can only be named as
    /// contact under the custody "guardian", which needs the lead to exist.
    #[serde(default)]
    custody: Option<String>,
}

#[derive(Deserialize)]
struct QualifyRequest {
    status: String,
    /// Why a lead is "not qualified" (QA 2026-10-11, A-39a): a reason code of
    /// the staff dialog or a free text, stored as `failed_reason` so the
    /// failed-lead workflow starts with it. Ignored for the other statuses.
    #[serde(default)]
    reason: Option<String>,
}

/// The longest reason a status change to "not qualified" stores.
const NOT_QUALIFIED_REASON_MAX_CHARS: usize = 500;

#[derive(Deserialize)]
struct FailedLeadResolutionRequest {
    resolution: String,
    reason: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct TrustedContactRequest {
    id: Option<Uuid>,
    related_patient_id: Option<Uuid>,
    name: String,
    email: Option<String>,
    phone: Option<String>,
    relation: Option<String>,
    birth_date: Option<String>,
    address: Option<String>,
    /// What the contact may be told when the consent form names the staff
    /// contacts (the person made no choice in the cabinet): codes of
    /// [`crate::consent_choices::RECIPIENT_SCOPES`] (owner 2026-10-26).
    #[serde(default)]
    scope_codes: Option<Vec<String>>,
    /// A representative's citizenships and birth data, sent with the contact
    /// by a wizard save (`POST /leads/{id}/update`, F-11 QA 2026-10-25): not
    /// part of the entry, written to the representative's row
    /// (`lead_representatives::sync_wizard_contacts`). Left out, the row
    /// keeps its value; `null` clears it.
    #[serde(default, deserialize_with = "sent")]
    citizenships: Option<Option<Vec<String>>>,
    #[serde(default, deserialize_with = "sent")]
    birth_place: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    birth_country: Option<Option<String>>,
}

impl TrustedContactRequest {
    /// The representative's keys the request carries (see the fields).
    fn representative_details(&self) -> serde_json::Map<String, Value> {
        let mut values = serde_json::Map::new();
        if let Some(citizenships) = &self.citizenships {
            values.insert("citizenships".into(), json!(citizenships));
        }
        if let Some(birth_place) = &self.birth_place {
            values.insert("birth_place".into(), json!(birth_place));
        }
        if let Some(birth_country) = &self.birth_country {
            values.insert("birth_country".into(), json!(birth_country));
        }
        values
    }
}

/// The representatives' keys a wizard save sends with its contacts, by the
/// id each contact has in the normalized list (`normalized`, same order), with
/// the same keys of the contact in the loaded list (`base`).
fn contact_details_edits(
    sent: &[TrustedContactRequest],
    normalized: &Value,
    base: Option<&[TrustedContactRequest]>,
) -> Vec<super::lead_representatives::ContactDetailsEdit> {
    sent.iter()
        .enumerate()
        .filter_map(|(index, contact)| {
            let values = contact.representative_details();
            if values.is_empty() {
                return None;
            }
            let contact_id =
                super::lead_representatives::entry_id(normalized.as_array()?.get(index)?)?;
            let base = base.map(|base| {
                base.iter()
                    .find(|loaded| loaded.id == Some(contact_id))
                    .map(TrustedContactRequest::representative_details)
                    .unwrap_or_default()
            });
            Some(super::lead_representatives::ContactDetailsEdit {
                index,
                contact_id,
                values,
                base,
            })
        })
        .collect()
}

/// A key that is present in the body, also with `null`; an absent key stays
/// `None`.
fn sent<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
struct UpdateLeadRequest {
    email: Option<String>,
    phone: Option<String>,
    country: Option<String>,
    primary_language: Option<String>,
    date_of_birth: Option<String>,
    legal_sex: Option<String>,
    compliance_status: Option<String>,
    consent_healthcare: Option<bool>,
    consent_privacy_practices: Option<bool>,
    notes: Option<String>,
    // Wizard-editable fields (#12): the staff wizard edits far more than the
    // original gate form. All optional + COALESCE, so partial saves are fine.
    first_name: Option<String>,
    middle_name: Option<String>,
    last_name: Option<String>,
    suffix: Option<String>,
    street_address: Option<String>,
    city: Option<String>,
    state: Option<String>,
    zip_code: Option<String>,
    whatsapp_number: Option<String>,
    needs_interpreter: Option<bool>,
    primary_concern_text: Option<String>,
    additional_concerns: Option<String>,
    selected_program: Option<String>,
    services: Option<Vec<String>>,
    /// Sent as `null`, the stored answer is cleared (owner decision
    /// 2026-10-23: clearing "Есть страховка" in the wizard persists); left
    /// out, it stays.
    #[serde(default, deserialize_with = "sent")]
    has_insurance: Option<Option<bool>>,
    insurance_covers_germany: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    /// Sent as `null` or `""`, the stored type is cleared; left out, it stays.
    #[serde(default, deserialize_with = "sent")]
    insurance_type: Option<Option<String>>,
    trusted_contact_name: Option<String>,
    trusted_contact_phone: Option<String>,
    trusted_contact_email: Option<String>,
    trusted_contact_relation: Option<String>,
    trusted_contact_birth_date: Option<String>,
    trusted_contact_address: Option<String>,
    trusted_contacts: Option<Vec<TrustedContactRequest>>,
    /// The list of trusted contacts the wizard loaded, sent with
    /// `trusted_contacts`: what the save leaves as loaded keeps the stored
    /// value (a parent's change in the cabinet since the load), see
    /// `lead_representatives::keep_represented_contacts`.
    trusted_contacts_base: Option<Vec<TrustedContactRequest>>,
    requested_specialties: Option<serde_json::Value>,
    wizard_state: Option<serde_json::Value>,
    /// Whether the client has medical documents: `yes`, `no` or `none`.
    has_medical_records: Option<String>,
    // Empty string explicitly clears the link; omission leaves it unchanged.
    referrer_patient_id: Option<String>,
    /// ISO 3166-1 alpha-2 codes; replaces the list (`leads.citizenships`, the
    /// one source; the legacy `wizard_state.registration_country` is removed).
    citizenships: Option<Vec<String>>,
}

fn normalized_contact_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// A date of birth staff may store: not in the future and not before 1900
/// (the same bar as the lead cabinet, `lead_portal_intake::apply_personal_data_patch`).
fn plausible_birth_date(date: NaiveDate, today: NaiveDate) -> Result<NaiveDate, &'static str> {
    if date > today {
        return Err("date_of_birth cannot be in the future");
    }
    if NaiveDate::from_ymd_opt(1900, 1, 1).is_some_and(|earliest| date < earliest) {
        return Err("date_of_birth is too early");
    }
    Ok(date)
}

/// The first of `(field, value, stored)` that is a new or changed name too
/// long for the shared rule (`services::person_fields`, as the cabinet); a
/// stored name stays acceptable.
fn new_name_too_long<'a>(names: &[(&'a str, &str, Option<&str>)]) -> Option<&'a str> {
    names.iter().find_map(|(field, value, stored)| {
        (crate::services::person_fields::changed(value, *stored)
            && !crate::services::person_fields::name_fits(value))
        .then_some(*field)
    })
}

/// A new or changed city too long for the shared rule; a stored one stays.
fn new_city_too_long(value: Option<&str>, stored: Option<&str>) -> bool {
    value.is_some_and(|city| {
        crate::services::person_fields::changed(city, stored)
            && !crate::services::person_fields::city_fits(city)
    })
}

/// A 422 that names the field it refuses, so the wizard shows it at the field.
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

/// The lead sources the app names (the leads page's source labels), in the
/// normalised form [`normalize_lead_source`] gives. It holds every value the
/// app and the public intake write, older spellings included, so a value
/// already stored stays a known one (QA 2026-10-25: any text was accepted and
/// shown as «Неизвестное значение»).
const KNOWN_LEAD_SOURCES: &[&str] = &[
    "manual",
    "existing_patient",
    "agent",
    "website",
    "apply",
    "website_wizard",
    "wizard",
    "website_questionnaire",
    "questionnaire",
    "oprosnik",
    "website_contact",
    "website_contact_form",
    "website_form",
    "contact_form",
    "contact",
    "visitor_facade",
    "referral",
    "phone",
    "email",
    "whatsapp",
    "partner",
    "social_media",
    "google_ads",
    "facebook",
    "instagram",
    "walk_in",
    "other",
];

/// Lower case, trimmed, runs of spaces and hyphens as one `_` — the form the
/// leads page reads a source in ("Website Wizard" is `website_wizard`).
fn normalize_lead_source(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut separator = false;
    for character in value.trim().chars() {
        if character == '-' || character.is_whitespace() {
            separator = true;
            continue;
        }
        if separator {
            normalized.push('_');
            separator = false;
        }
        normalized.extend(character.to_lowercase());
    }
    normalized
}

/// Whether a lead source sent by staff is one the app knows; none (or a
/// blank one) is accepted as before.
fn lead_source_known(value: Option<&str>) -> bool {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => true,
        Some(value) => KNOWN_LEAD_SOURCES.contains(&normalize_lead_source(value).as_str()),
    }
}

fn normalize_trusted_contacts(contacts: &[TrustedContactRequest]) -> Result<Value, &'static str> {
    if contacts.len() > 50 {
        return Err("Too many trusted contacts");
    }

    let mut ids = HashSet::with_capacity(contacts.len());
    let mut normalized = Vec::with_capacity(contacts.len());
    for contact in contacts {
        let name = contact.name.trim();
        if name.is_empty() {
            return Err("Trusted contact name cannot be empty");
        }

        let id = contact.id.unwrap_or_else(Uuid::new_v4);
        if !ids.insert(id) {
            return Err("Trusted contact ids must be unique");
        }

        let birth_date = match normalized_contact_text(contact.birth_date.as_deref()) {
            Some(value) => {
                let date = NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                    .map_err(|_| "Invalid trusted contact birth_date (YYYY-MM-DD)")?;
                if plausible_birth_date(date, crate::app_time::today()).is_err() {
                    return Err("Trusted contact birth_date is not plausible");
                }
                Some(date.format("%Y-%m-%d").to_string())
            }
            None => None,
        };

        // Format only: a stored address is never judged by its domain again;
        // a new or changed address with a dead domain is refused at the
        // contact by `changed_trusted_contact_issue` (QA 2026-10-24).
        let email = normalized_contact_text(contact.email.as_deref());
        if email
            .as_deref()
            .is_some_and(|value| !crate::email_address::has_valid_format(value))
        {
            return Err("Invalid trusted contact email");
        }

        let scope_codes = match contact.scope_codes.as_deref() {
            Some(codes) => crate::consent_choices::clean_scope_codes(codes)
                .map_err(|_| "Invalid trusted contact scope_codes")?,
            None => Vec::new(),
        };

        let mut entry = json!({
            "id": id,
            "related_patient_id": contact.related_patient_id,
            "name": name,
            "email": email,
            "phone": normalized_contact_text(contact.phone.as_deref()),
            "relation": normalized_contact_text(contact.relation.as_deref()),
            "birth_date": birth_date,
            "address": normalized_contact_text(contact.address.as_deref()),
        });
        // Stored only when chosen: older entries keep their exact shape.
        if !scope_codes.is_empty() {
            entry["scope_codes"] = json!(scope_codes);
        }
        normalized.push(entry);
    }

    Ok(Value::Array(normalized))
}

/// The contact of a list a write would store that the request adds or
/// changes in a way the server refuses (owner 2026-10-22).
#[derive(Debug, PartialEq, Eq)]
enum TrustedContactIssue {
    /// A new or changed phone number without the usual six digits.
    InvalidPhone {
        index: usize,
        id: String,
        name: String,
    },
    /// A minor's contact newly marked as guardian (Vormund): needs the
    /// custody "guardian", which the caller checks.
    GuardianRelation {
        index: usize,
        id: String,
        name: String,
    },
    /// A contact newly marked as mother, father or parent while the child is
    /// under guardianship: only the guardian represents the child then
    /// (§ 1773 BGB, owner 2026-10-27), so parents and a guardian are never
    /// mixed on one child.
    ParentUnderGuardianship {
        index: usize,
        id: String,
        name: String,
    },
    /// A parent, guardian or representative newly born less than 18 years
    /// ago: a representative is of full age, as in the cabinet.
    MinorRepresentative {
        index: usize,
        id: String,
        name: String,
    },
    /// A new or changed e-mail address whose domain accepts no mail; a stored
    /// address is never judged by its domain again (QA 2026-10-24).
    EmailNoMail {
        index: usize,
        id: String,
        name: String,
    },
    /// A parent's, guardian's or representative's new or changed name that
    /// is not spelled as in the passport (the cabinet's rule, QA 2026-10-25:
    /// "Kindermann-H1" saved by staff left the mother unable to edit it).
    InvalidName {
        index: usize,
        id: String,
        name: String,
    },
}

fn contact_text<'a>(contact: &'a Value, key: &str) -> Option<&'a str> {
    contact
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// The stored entry a submitted contact continues: the same id, or for an
/// entry without one (written before ids) the same name.
fn stored_trusted_contact<'a>(stored: &'a Value, contact: &Value) -> Option<&'a Value> {
    let entries = stored.as_array()?;
    let id = contact_text(contact, "id");
    if let Some(found) = id.and_then(|id| {
        entries
            .iter()
            .find(|entry| contact_text(entry, "id") == Some(id))
    }) {
        return Some(found);
    }
    let name = contact_text(contact, "name")?.to_lowercase();
    entries.iter().find(|entry| {
        contact_text(entry, "id").is_none()
            && contact_text(entry, "name").is_some_and(|value| value.to_lowercase() == name)
    })
}

/// The contacts a write renames: `(contact id, stored name, new name)` for
/// every submitted entry with an id whose stored entry carries another name.
/// A parent's login takes the new name ([`lead_portal_account::sync_guardian_names_in_tx`]).
fn renamed_trusted_contacts(stored: &Value, contacts: &Value) -> Vec<(Uuid, String, String)> {
    contacts
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|contact| {
            let id = contact_text(contact, "id").and_then(|id| Uuid::parse_str(id).ok())?;
            let name = contact_text(contact, "name")?;
            let previous = contact_text(stored_trusted_contact(stored, contact)?, "name")?;
            crate::services::person_fields::changed(name, Some(previous))
                .then(|| (id, previous.to_string(), name.to_string()))
        })
        .collect()
}

/// What a write of trusted contacts adds or changes against the stored list:
/// a phone number is checked only when it is new or changed, and a guardian
/// relation of a minor only when the contact is new or its relation changed,
/// so older entries keep loading and saving as they are. The first issue in
/// list order, phone before relation of the same contact.
fn changed_trusted_contact_issue(
    contacts: &Value,
    stored: &Value,
    minor: bool,
) -> Option<TrustedContactIssue> {
    for (index, contact) in contacts.as_array()?.iter().enumerate() {
        let previous = stored_trusted_contact(stored, contact);
        let id = contact_text(contact, "id").unwrap_or_default().to_string();
        let name = contact_text(contact, "name")
            .unwrap_or_default()
            .to_string();
        if let Some(phone) = contact_text(contact, "phone")
            && previous.and_then(|entry| contact_text(entry, "phone")) != Some(phone)
            && !crate::services::person_fields::is_valid_phone(phone)
        {
            return Some(TrustedContactIssue::InvalidPhone { index, id, name });
        }
        if let Some(email) = contact_text(contact, "email")
            && crate::email_address::no_mail_domain_of_change(
                previous.and_then(|entry| contact_text(entry, "email")),
                email,
            )
            .is_some()
        {
            return Some(TrustedContactIssue::EmailNoMail { index, id, name });
        }
        let relation = contact_text(contact, "relation");
        if minor
            && is_legal_guardian_relation(relation)
            && !previous
                .is_some_and(|entry| is_legal_guardian_relation(contact_text(entry, "relation")))
        {
            return Some(TrustedContactIssue::GuardianRelation { index, id, name });
        }
        // A parent, guardian or representative is of full age, as in the
        // cabinet (owner 2026-10-24): checked when the date or the role is
        // new or changed.
        let acts_for = |relation: Option<&str>| {
            is_parent_or_guardian_relation(relation)
                || relation.is_some_and(|relation| relation.eq_ignore_ascii_case("representative"))
        };
        let birth_date = contact_text(contact, "birth_date");
        let changed = previous.is_none_or(|entry| {
            contact_text(entry, "birth_date") != birth_date
                || acts_for(contact_text(entry, "relation")) != acts_for(relation)
        });
        if changed
            && acts_for(relation)
            && birth_date
                .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
                .is_some_and(|date| is_minor_on(Some(date), crate::app_time::today()))
        {
            return Some(TrustedContactIssue::MinorRepresentative { index, id, name });
        }
        // The name of a person who acts for the lead is spelled as in the
        // passport (the cabinet's rule, QA 2026-10-25): checked when the
        // name is new or changed, or the person newly acts for the lead; a
        // stored name is never re-judged.
        let name_changed = previous.is_none_or(|entry| {
            crate::services::person_fields::changed(&name, contact_text(entry, "name"))
                || !acts_for(contact_text(entry, "relation"))
        });
        if name_changed
            && acts_for(relation)
            && crate::routes::lead_portal_intake::name_needs_latin_spelling(&name)
        {
            return Some(TrustedContactIssue::InvalidName { index, id, name });
        }
    }
    None
}

/// The 422 of a refused trusted contact: the code, the list field and which
/// entry (index and id) with the field of the entry, so the wizard shows it
/// at the contact.
fn trusted_contact_issue_response(issue: &TrustedContactIssue) -> axum::response::Response {
    let (code, message, index, id, name, contact_field) = match issue {
        TrustedContactIssue::InvalidPhone { index, id, name } => (
            "trusted_contact_phone_invalid",
            "Invalid trusted contact phone",
            index,
            id,
            name,
            "phone",
        ),
        TrustedContactIssue::ParentUnderGuardianship { index, id, name } => (
            RELATION_PARENT_UNDER_GUARDIANSHIP,
            "Under a court-ordered guardianship only the guardian (Vormund) represents the child; record a parent as another relation",
            index,
            id,
            name,
            "relation",
        ),
        TrustedContactIssue::GuardianRelation { index, id, name } => (
            RELATION_GUARDIAN_NEEDS_CUSTODY,
            "A guardian (Vormund) is possible only under a court-ordered guardianship; choose mother or father for a parent",
            index,
            id,
            name,
            "relation",
        ),
        TrustedContactIssue::MinorRepresentative { index, id, name } => (
            "trusted_contact_representative_minor",
            "A parent or representative is of full age",
            index,
            id,
            name,
            "birth_date",
        ),
        TrustedContactIssue::EmailNoMail { index, id, name } => (
            "trusted_contact_email_no_mail",
            "The domain of this e-mail address accepts no mail",
            index,
            id,
            name,
            "email",
        ),
        TrustedContactIssue::InvalidName { index, id, name } => (
            "trusted_contact_name_invalid",
            "Latin letters only, as in the passport",
            index,
            id,
            name,
            "name",
        ),
    };
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({
            "error": code,
            "code": code,
            "message": message,
            "field": "trusted_contacts",
            "contact_index": index,
            "contact_id": id,
            "contact_name": name,
            "contact_field": contact_field,
        })),
    )
        .into_response()
}

/// A minor's parent or representative contact marked as guardian (Vormund)
/// while the custody is not "guardian" (owner 2026-10-22).
pub(crate) const RELATION_GUARDIAN_NEEDS_CUSTODY: &str = "relation_guardian_needs_custody";
pub(crate) const RELATION_PARENT_UNDER_GUARDIANSHIP: &str = "relation_parent_under_guardianship";

/// The first contact newly marked as a parent (mother, father, parent — not a
/// guardian) or changed into one from another relation: refused while the child is under
/// guardianship ([`TrustedContactIssue::ParentUnderGuardianship`]). Stored
/// parents stay as they are; they are contacts, not representatives.
fn parent_under_guardianship_issue(
    contacts: &Value,
    stored: &Value,
) -> Option<TrustedContactIssue> {
    let parent = |relation: Option<&str>| {
        is_parent_or_guardian_relation(relation) && !is_legal_guardian_relation(relation)
    };
    for (index, contact) in contacts.as_array()?.iter().enumerate() {
        let relation = contact_text(contact, "relation");
        if !parent(relation) {
            continue;
        }
        // A stored parent stays; a stored guardian may be corrected back to
        // the parent staff meant (otherwise the custody, refused while a
        // guardian is on file, could never change again).
        let previous = stored_trusted_contact(stored, contact);
        if previous
            .is_some_and(|entry| is_parent_or_guardian_relation(contact_text(entry, "relation")))
        {
            continue;
        }
        return Some(TrustedContactIssue::ParentUnderGuardianship {
            index,
            id: contact_text(contact, "id").unwrap_or_default().to_string(),
            name: contact_text(contact, "name")
                .unwrap_or_default()
                .to_string(),
        });
    }
    None
}

/// The custody stated with a new lead: `None` when none is stated, an error
/// for an unknown value or for an adult (a custody belongs to a minor).
fn new_lead_custody(value: Option<&str>, minor: bool) -> Result<Option<String>, ()> {
    use crate::routes::lead_representatives::{
        CUSTODY_GUARDIAN, CUSTODY_JOINT, CUSTODY_SOLE_PARENT,
    };
    let Some(value) = value.map(|value| value.trim().to_lowercase()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    if minor && [CUSTODY_JOINT, CUSTODY_SOLE_PARENT, CUSTODY_GUARDIAN].contains(&value.as_str()) {
        Ok(Some(value))
    } else {
        Err(())
    }
}

/// Refuses what [`changed_trusted_contact_issue`] finds; a guardian relation
/// passes when the lead's stated custody is "guardian" (none stated for a new
/// lead).
async fn check_changed_trusted_contacts(
    state: &AppState,
    lead_id: Option<Uuid>,
    contacts: &Value,
    stored: &Value,
    minor: bool,
) -> Result<(), axum::response::Response> {
    // Under a stated guardianship a new parent is refused (owner 2026-10-27).
    if minor
        && let Some(lead_id) = lead_id
        && let Some(issue) = parent_under_guardianship_issue(contacts, stored)
    {
        let custody = sqlx::query_scalar::<_, Option<String>>(
            "SELECT custody FROM lead_gwg_declarations WHERE lead_id = $1",
        )
        .bind(lead_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(%error, %lead_id, "load lead custody");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?
        .flatten();
        if custody.as_deref() == Some(crate::routes::lead_representatives::CUSTODY_GUARDIAN) {
            return Err(trusted_contact_issue_response(&issue));
        }
    }
    let Some(issue) = changed_trusted_contact_issue(contacts, stored, minor) else {
        return Ok(());
    };
    if matches!(issue, TrustedContactIssue::GuardianRelation { .. })
        && let Some(lead_id) = lead_id
    {
        let custody = sqlx::query_scalar::<_, Option<String>>(
            "SELECT custody FROM lead_gwg_declarations WHERE lead_id = $1",
        )
        .bind(lead_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(%error, %lead_id, "load lead custody");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?
        .flatten();
        if custody.as_deref() == Some(crate::routes::lead_representatives::CUSTODY_GUARDIAN) {
            // The guardian relation is allowed; a later contact may still
            // carry a new unusable phone number.
            let phones_only = changed_trusted_contact_issue(contacts, stored, false);
            return match phones_only {
                Some(issue) => Err(trusted_contact_issue_response(&issue)),
                None => Ok(()),
            };
        }
    }
    Err(trusted_contact_issue_response(&issue))
}

#[cfg(test)]
mod changed_trusted_contact_tests {
    use super::*;

    const ID: &str = "7a4c2f1e-0000-4000-8000-000000000001";

    fn contact(id: &str, name: &str, phone: &str, relation: &str) -> Value {
        json!({ "id": id, "name": name, "phone": phone, "relation": relation })
    }

    #[test]
    fn a_new_minors_lead_may_state_the_custody_an_adults_may_not() {
        assert_eq!(new_lead_custody(None, true), Ok(None));
        assert_eq!(new_lead_custody(Some("  "), true), Ok(None));
        assert_eq!(
            new_lead_custody(Some(" Guardian "), true),
            Ok(Some("guardian".into()))
        );
        assert_eq!(
            new_lead_custody(Some("joint"), true),
            Ok(Some("joint".into()))
        );
        assert_eq!(
            new_lead_custody(Some("sole_parent"), true),
            Ok(Some("sole_parent".into()))
        );
        assert_eq!(new_lead_custody(Some("guardian"), false), Err(()));
        assert_eq!(new_lead_custody(Some("both"), true), Err(()));
    }

    #[test]
    fn a_guardian_named_with_the_custody_guardian_passes_the_new_lead_check() {
        // Under the custody "guardian" the new lead's contacts are checked
        // without the minor's guardian rule; the phone rule stays.
        let guardian = json!([contact(ID, "Vera Vormund", "+49 170 1234567", "guardian")]);
        assert!(matches!(
            changed_trusted_contact_issue(&guardian, &json!([]), true),
            Some(TrustedContactIssue::GuardianRelation { .. })
        ));
        assert_eq!(
            changed_trusted_contact_issue(&guardian, &json!([]), false),
            None
        );
        let bad_phone = json!([contact(ID, "Vera Vormund", "12", "guardian")]);
        assert!(matches!(
            changed_trusted_contact_issue(&bad_phone, &json!([]), false),
            Some(TrustedContactIssue::InvalidPhone { .. })
        ));
    }

    /// Owner 2026-10-24: a parent or representative entered by staff is of
    /// full age, as in the cabinet; an older stored entry keeps saving.
    #[test]
    fn a_parent_or_representative_born_less_than_18_years_ago_is_refused() {
        let born = |id: &str, birth_date: &str, relation: &str| json!({ "id": id, "name": "Anna", "relation": relation, "birth_date": birth_date });
        let child = json!([born(ID, "2015-03-02", "mother")]);
        assert_eq!(
            changed_trusted_contact_issue(&child, &json!([]), true),
            Some(TrustedContactIssue::MinorRepresentative {
                index: 0,
                id: ID.into(),
                name: "Anna".into()
            })
        );
        let agent = json!([born(ID, "2015-03-02", "representative")]);
        assert!(matches!(
            changed_trusted_contact_issue(&agent, &json!([]), false),
            Some(TrustedContactIssue::MinorRepresentative { .. })
        ));
        // A sibling may be young; an adult parent passes; a stored entry stays.
        let sibling = json!([born(ID, "2015-03-02", "relative")]);
        assert_eq!(
            changed_trusted_contact_issue(&sibling, &json!([]), true),
            None
        );
        let adult = json!([born(ID, "1985-03-02", "father")]);
        assert_eq!(
            changed_trusted_contact_issue(&adult, &json!([]), true),
            None
        );
        assert_eq!(changed_trusted_contact_issue(&child, &child, true), None);
    }

    /// QA 2026-10-25: a parent's or representative's name is spelled as in
    /// the passport (the cabinet's rule); a stored name is never re-judged, a
    /// friend's name is not judged.
    #[test]
    fn a_representatives_new_or_changed_name_is_spelled_as_in_the_passport() {
        let digits = json!([contact(ID, "Kindermann-H1", "+49 170 1234567", "mother")]);
        assert_eq!(
            changed_trusted_contact_issue(&digits, &json!([]), true),
            Some(TrustedContactIssue::InvalidName {
                index: 0,
                id: ID.into(),
                name: "Kindermann-H1".into()
            })
        );
        let cyrillic = json!([contact(
            ID,
            "Анна Кіндерманн",
            "+49 170 1234567",
            "representative"
        )]);
        assert!(matches!(
            changed_trusted_contact_issue(&cyrillic, &json!([]), false),
            Some(TrustedContactIssue::InvalidName { .. })
        ));
        // Latin letters with marks, hyphens and apostrophes pass.
        let latin = json!([contact(
            ID,
            "Zoë-Élise O'Neill",
            "+49 170 1234567",
            "mother"
        )]);
        assert_eq!(
            changed_trusted_contact_issue(&latin, &json!([]), true),
            None
        );
        // A friend is not identified: the name is free.
        let friend = json!([contact(ID, "Друг 1", "+49 170 1234567", "friend")]);
        assert_eq!(
            changed_trusted_contact_issue(&friend, &json!([]), true),
            None
        );
        // A stored name keeps saving; a changed name is judged again.
        assert_eq!(changed_trusted_contact_issue(&digits, &digits, true), None);
        let renamed = json!([contact(ID, "Kindermann-H2", "+49 170 1234567", "mother")]);
        assert!(matches!(
            changed_trusted_contact_issue(&renamed, &digits, true),
            Some(TrustedContactIssue::InvalidName { .. })
        ));
        // A stored friend who newly acts for the lead is judged.
        let stored_friend = json!([contact(ID, "Freund 2", "+49 170 1234567", "friend")]);
        let now_parent = json!([contact(ID, "Freund 2", "+49 170 1234567", "father")]);
        assert!(matches!(
            changed_trusted_contact_issue(&now_parent, &stored_friend, true),
            Some(TrustedContactIssue::InvalidName { .. })
        ));
        let response = trusted_contact_issue_response(&TrustedContactIssue::InvalidName {
            index: 0,
            id: ID.into(),
            name: "Kindermann-H1".into(),
        });
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// The contacts a write renames, by id, for the login sync.
    #[test]
    fn renamed_contacts_are_listed_with_the_stored_and_the_new_name() {
        let stored = json!([
            contact(ID, "Anna Muster", "+49 170 1234567", "mother"),
            contact("7a4c2f1e-0000-4000-8000-000000000002", "Ben Muster", "", "father"),
            { "name": "Legacy Entry", "relation": "friend" },
        ]);
        let sent = json!([
            contact(ID, "Anna  Mustermann", "+49 170 1234567", "mother"),
            contact("7a4c2f1e-0000-4000-8000-000000000002", "Ben   Muster", "", "father"),
            { "name": "Legacy Renamed", "relation": "friend" },
            contact("7a4c2f1e-0000-4000-8000-000000000003", "New Contact", "", "friend"),
        ]);
        assert_eq!(
            renamed_trusted_contacts(&stored, &sent),
            vec![(
                Uuid::parse_str(ID).unwrap(),
                "Anna Muster".to_string(),
                "Anna  Mustermann".to_string()
            )]
        );
    }

    #[test]
    fn an_unchanged_invalid_phone_keeps_saving() {
        let stored = json!([contact(ID, "Anna", "12", "mother")]);
        let sent = json!([contact(ID, "Anna Maria", "12", "mother")]);
        assert_eq!(changed_trusted_contact_issue(&sent, &stored, true), None);
    }

    #[test]
    fn a_new_or_changed_invalid_phone_is_refused_with_its_index() {
        let stored = json!([contact(ID, "Anna", "+49 170 1234567", "mother")]);
        let changed = json!([contact(ID, "Anna", "abc", "mother")]);
        assert_eq!(
            changed_trusted_contact_issue(&changed, &stored, false),
            Some(TrustedContactIssue::InvalidPhone {
                index: 0,
                id: ID.into(),
                name: "Anna".into()
            })
        );
        let added = json!([
            contact(ID, "Anna", "+49 170 1234567", "mother"),
            contact(
                "7a4c2f1e-0000-4000-8000-000000000002",
                "Ivan",
                "123",
                "father"
            ),
        ]);
        assert!(matches!(
            changed_trusted_contact_issue(&added, &stored, false),
            Some(TrustedContactIssue::InvalidPhone { index: 1, .. })
        ));
    }

    #[test]
    fn a_legacy_entry_without_id_is_matched_by_name() {
        let stored = json!([{ "name": "Anna", "phone": "12", "relation": "Опекун" }]);
        let sent = json!([contact(ID, "anna", "12", "guardian")]);
        assert_eq!(changed_trusted_contact_issue(&sent, &stored, true), None);
    }

    #[test]
    fn a_new_guardian_of_a_minor_is_reported_an_adults_is_not() {
        let stored = json!([contact(ID, "Anna", "", "mother")]);
        let sent = json!([contact(ID, "Anna", "", "guardian")]);
        assert!(matches!(
            changed_trusted_contact_issue(&sent, &stored, true),
            Some(TrustedContactIssue::GuardianRelation { index: 0, .. })
        ));
        assert_eq!(changed_trusted_contact_issue(&sent, &stored, false), None);
        // A guardian already stored stays loadable and savable.
        assert_eq!(changed_trusted_contact_issue(&sent, &sent, true), None);
    }

    #[test]
    fn the_refusal_names_the_code_the_field_and_the_contact() {
        let response = trusted_contact_issue_response(&TrustedContactIssue::GuardianRelation {
            index: 2,
            id: ID.into(),
            name: "Anna".into(),
        });
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}

#[derive(Deserialize)]
struct ListLeadsQuery {
    search: Option<String>,
    status: Option<String>,
    source: Option<String>,
    country: Option<String>,
    intake_source: Option<String>,
    lead_type: Option<String>,
    flow: Option<String>,
    include_archived: Option<bool>,
}

#[derive(Deserialize)]
struct ReferrerPatientsQuery {
    search: Option<String>,
}

#[derive(Deserialize)]
struct GuardianCandidatesQuery {
    search: Option<String>,
    exclude_lead_id: Option<Uuid>,
}

/// Reuse a known adult's contact data without creating a patient or granting access.
async fn list_guardian_candidates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<GuardianCandidatesQuery>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_capability(Capability::LeadsEdit)?;
    // The person-level data of the (at most 50) picked rows: a patient's
    // address, citizenships, birth data and identity document exactly as a
    // linked parent's identity reads them (`lead_guardian_identity`), so the
    // dialog shows what the saved parent will have (DEV 2026-10-26: the GwG
    // block stayed empty for a father picked from the patients). A lead has
    // no link that carries a document: its address, citizenships and birth
    // data only.
    let sql = format!(
        r#"WITH candidates AS (
            SELECT id, 'patient'::text AS source, id AS patient_record_id,
                   patient_id AS display_id, first_name, last_name, birth_date, email,
                   phone_primary AS phone,
                   concat_ws(', ', NULLIF(address_street, ''), NULLIF(address_zip, ''),
                             NULLIF(address_city, ''), NULLIF(address_country, '')) AS address
            FROM patients WHERE is_active AND lifecycle_status = 'active'
            UNION ALL
            SELECT id, 'lead', NULL::uuid, NULL::text, first_name, last_name,
                   date_of_birth, email, phone,
                   concat_ws(', ', NULLIF(street_address, ''), NULLIF(zip_code, ''), NULLIF(city, ''), NULLIF(country, ''))
            FROM leads
            WHERE converted_patient_id IS NULL
              AND qualification_status NOT IN ('converted', 'archived', 'deleted')
              AND ($3::uuid IS NULL OR id <> $3)
        ), picked AS (
            SELECT * FROM candidates
            WHERE (birth_date IS NULL OR birth_date <= ($2::date - INTERVAL '18 years')::date)
              AND ($1::text = '%%' OR de_normalize(concat_ws(' ', display_id, first_name, last_name, email, phone)) LIKE de_normalize($1))
            ORDER BY lower(last_name), lower(first_name), source, id LIMIT 50
        )
        SELECT c.*, CASE WHEN c.source = 'patient' THEN (
                SELECT {identity} FROM patients p {gwg} WHERE p.id = c.id
            ) ELSE (
                SELECT jsonb_build_object(
                    'street', l.street_address, 'zip', l.zip_code, 'city', l.city,
                    'country', l.country, 'citizenships', to_jsonb(l.citizenships),
                    'birth_place', g.birth_place, 'birth_country', g.birth_country)
                FROM leads l LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
                WHERE l.id = c.id
            ) END AS details
        FROM picked c
        ORDER BY lower(c.last_name), lower(c.first_name), c.source, c.id"#,
        identity = crate::services::lead_guardian_identity::PATIENT_IDENTITY_JSON,
        gwg = crate::services::lead_guardian_identity::PATIENT_GWG_JOIN,
    );
    let rows = sqlx::query(&sql)
        .bind(format!("%{}%", query.search.unwrap_or_default().trim()))
        .bind(crate::app_time::today())
        .bind(query.exclude_lead_id)
        .fetch_all(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "list guardian candidates");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load guardian candidates",
            )
        })?;
    let full_patient_contact = auth.can(Capability::PatientsView);
    Ok(Json(Value::Array(
        rows.into_iter()
            .map(|row| {
                guardian_candidate_value(
                    GuardianCandidate {
                        id: row.get("id"),
                        source: row.get("source"),
                        patient_record_id: row.get("patient_record_id"),
                        display_id: row.get("display_id"),
                        first_name: row.get("first_name"),
                        last_name: row.get("last_name"),
                        birth_date: row.get("birth_date"),
                        email: row.get("email"),
                        phone: row.get("phone"),
                        address: row.get("address"),
                        details: row
                            .get::<Option<Value>, _>("details")
                            .unwrap_or(Value::Null),
                    },
                    full_patient_contact,
                )
            })
            .collect(),
    )))
}

struct GuardianCandidate {
    id: Uuid,
    source: String,
    patient_record_id: Option<Uuid>,
    display_id: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: Option<NaiveDate>,
    email: Option<String>,
    phone: Option<String>,
    address: String,
    /// Raw person-level data (address parts, citizenships, birth data and,
    /// for a patient, the identity document), normalised on the way out.
    details: Value,
}

/// Owner 2026-10-23: a role without `patients.view` (Sales) sees only a
/// patient's name and number in the lead pickers, never the patient's birth
/// date, contact data, address, citizenships or document. Lead rows stay
/// complete: those roles see leads anyway.
///
/// The person-level keys ([`lead_guardian_identity::PERSON_DETAIL_KEYS`])
/// are always present: ISO country codes, `null` for what is not known.
///
/// [`lead_guardian_identity::PERSON_DETAIL_KEYS`]: crate::services::lead_guardian_identity::PERSON_DETAIL_KEYS
fn guardian_candidate_value(candidate: GuardianCandidate, full_patient_contact: bool) -> Value {
    use crate::services::lead_guardian_identity::{empty_person_details, person_details};
    if candidate.source == "patient" && !full_patient_contact {
        let mut value = empty_person_details();
        let base = json!({
            "id": candidate.id,
            "source": candidate.source,
            "patient_record_id": candidate.patient_record_id,
            "display_id": candidate.display_id,
            "first_name": candidate.first_name,
            "last_name": candidate.last_name,
            "birth_date": Value::Null,
            "email": Value::Null,
            "phone": Value::Null,
            "address": Value::Null,
            "contact_hidden": true,
        });
        merge_object(&mut value, base);
        return value;
    }
    let mut value = person_details(&candidate.details);
    let base = json!({
        "id": candidate.id,
        "source": candidate.source,
        "patient_record_id": candidate.patient_record_id,
        "display_id": candidate.display_id,
        "first_name": candidate.first_name,
        "last_name": candidate.last_name,
        "birth_date": candidate.birth_date,
        "email": candidate.email,
        "phone": candidate.phone,
        "address": candidate.address,
        "contact_hidden": false,
    });
    merge_object(&mut value, base);
    value
}

/// Copies the keys of `from` (an object) into `into` (an object).
fn merge_object(into: &mut Value, from: Value) {
    if let (Some(into), Value::Object(from)) = (into.as_object_mut(), from) {
        into.extend(from);
    }
}

struct ReferrerPatient {
    id: Uuid,
    patient_id: String,
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: Option<NaiveDate>,
    email: Option<String>,
    phone: Option<String>,
}

/// The referring-patient picker: name and number for every `leads.edit`
/// role; birth date and contact data only with `patients.view`.
fn referrer_patient_value(patient: ReferrerPatient, full_patient_contact: bool) -> Value {
    if !full_patient_contact {
        return json!({
            "id": patient.id,
            "patient_id": patient.patient_id,
            "title": patient.title,
            "first_name": patient.first_name,
            "last_name": patient.last_name,
        });
    }
    json!({
        "id": patient.id,
        "patient_id": patient.patient_id,
        "title": patient.title,
        "first_name": patient.first_name,
        "last_name": patient.last_name,
        "birth_date": patient.birth_date.map(|value| value.to_string()).unwrap_or_default(),
        "email": patient.email,
        "phone": patient.phone,
    })
}

#[cfg(test)]
mod lead_picker_contact_tests {
    use super::*;

    fn patient_candidate() -> GuardianCandidate {
        GuardianCandidate {
            id: Uuid::nil(),
            source: "patient".into(),
            patient_record_id: Some(Uuid::nil()),
            display_id: Some("P-2026-0001".into()),
            first_name: "Anna".into(),
            last_name: "Muster".into(),
            birth_date: NaiveDate::from_ymd_opt(1980, 1, 2),
            email: Some("anna@example.test".into()),
            phone: Some("+49 170 1234567".into()),
            address: "Hauptstr. 1, 10115, Berlin, DE".into(),
            details: json!({
                "street": "Hauptstr. 1",
                "zip": "10115",
                "city": "Berlin",
                "country": "Ukraine",
                "citizenships": ["UA", "de"],
                "birth_place": "Kyiv",
                "birth_country": "UA",
                "id_document_type": "passport",
                "id_document_number": "FA1234567",
                "id_issuing_authority": "Passamt 8031",
                "id_issuing_country": "UA",
                "id_issued_on": "2020-01-02",
                "id_valid_until": "2030-01-01",
            }),
        }
    }

    fn referrer() -> ReferrerPatient {
        ReferrerPatient {
            id: Uuid::nil(),
            patient_id: "P-2026-0001".into(),
            title: None,
            first_name: "Anna".into(),
            last_name: "Muster".into(),
            birth_date: NaiveDate::from_ymd_opt(1980, 1, 2),
            email: Some("anna@example.test".into()),
            phone: Some("+49 170 1234567".into()),
        }
    }

    #[test]
    fn sales_sees_only_name_and_number_of_a_patient() {
        assert!(Role::Sales.can(Capability::LeadsEdit));
        assert!(!Role::Sales.can(Capability::PatientsView));
        let value = guardian_candidate_value(
            patient_candidate(),
            Role::Sales.can(Capability::PatientsView),
        );
        assert_eq!(value["display_id"], "P-2026-0001");
        assert_eq!(value["last_name"], "Muster");
        for key in ["birth_date", "email", "phone", "address"] {
            assert!(value[key].is_null(), "{key} must be hidden");
        }
        // Nor the address parts, birth data or the document (DEV 2026-10-26).
        for key in crate::services::lead_guardian_identity::PERSON_DETAIL_KEYS {
            if key == "citizenships" {
                assert_eq!(value[key], json!([]), "{key} must be hidden");
            } else {
                assert!(value[key].is_null(), "{key} must be hidden");
            }
        }
        assert_eq!(value["contact_hidden"], true);

        let value = referrer_patient_value(referrer(), false);
        assert_eq!(value["patient_id"], "P-2026-0001");
        assert_eq!(value["first_name"], "Anna");
        for key in ["birth_date", "email", "phone"] {
            assert!(value.get(key).is_none(), "{key} must be absent");
        }
    }

    #[test]
    fn a_role_with_patients_view_keeps_the_contact_data() {
        assert!(Role::Ceo.can(Capability::PatientsView));
        let value = guardian_candidate_value(patient_candidate(), true);
        assert_eq!(value["email"], "anna@example.test");
        assert_eq!(value["birth_date"], "1980-01-02");
        assert_eq!(value["contact_hidden"], false);
        // The GwG block's data come along, countries as ISO codes.
        assert_eq!(value["street"], "Hauptstr. 1");
        assert_eq!(value["country"], "UA");
        assert_eq!(value["citizenships"], json!(["UA", "DE"]));
        assert_eq!(value["birth_place"], "Kyiv");
        assert_eq!(value["id_document_number"], "FA1234567");
        assert_eq!(value["id_valid_until"], "2030-01-01");
        let value = referrer_patient_value(referrer(), true);
        assert_eq!(value["phone"], "+49 170 1234567");
        assert_eq!(value["birth_date"], "1980-01-02");
    }

    #[test]
    fn a_lead_candidate_stays_complete_for_sales() {
        let mut candidate = patient_candidate();
        candidate.source = "lead".into();
        candidate.patient_record_id = None;
        candidate.display_id = None;
        let value = guardian_candidate_value(candidate, false);
        assert_eq!(value["email"], "anna@example.test");
        assert_eq!(value["contact_hidden"], false);
    }
}

async fn list_lead_referrer_patients(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ReferrerPatientsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsEdit) {
        return e;
    }

    let full_patient_contact = auth.can(Capability::PatientsView);
    let search_pattern = format!("%{}%", query.search.unwrap_or_default().trim());
    match sqlx::query(
        r#"SELECT id, patient_id, title, first_name, last_name,
                  birth_date, email, phone_primary
           FROM patients
           WHERE is_active = true
             AND lifecycle_status = 'active'
             AND (
                 $1::text = '%%'
                 OR de_normalize(concat_ws(' ', patient_id, title, first_name, last_name))
                    LIKE de_normalize($1)
             )
           ORDER BY lower(last_name), lower(first_name), patient_id
           LIMIT 50"#,
    )
    .bind(search_pattern)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(Value::Array(
            rows.into_iter()
                .map(|row| {
                    referrer_patient_value(
                        ReferrerPatient {
                            id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
                            patient_id: row.try_get::<String, _>("patient_id").unwrap_or_default(),
                            title: row
                                .try_get::<Option<String>, _>("title")
                                .unwrap_or_default(),
                            first_name: row.try_get::<String, _>("first_name").unwrap_or_default(),
                            last_name: row.try_get::<String, _>("last_name").unwrap_or_default(),
                            birth_date: row.try_get::<NaiveDate, _>("birth_date").ok(),
                            email: row
                                .try_get::<Option<String>, _>("email")
                                .unwrap_or_default(),
                            phone: row
                                .try_get::<Option<String>, _>("phone_primary")
                                .unwrap_or_default(),
                        },
                        full_patient_contact,
                    )
                })
                .collect(),
        ))
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, "list lead referrer patients");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

/// Login state of the lead's patient account in a list row; null without one.
fn lead_portal_account_summary(row: &sqlx::postgres::PgRow) -> Value {
    match row
        .try_get::<Option<Uuid>, _>("portal_user_id")
        .ok()
        .flatten()
    {
        Some(user_id) => json!({
            "user_id": user_id,
            "is_active": row
                .try_get::<Option<bool>, _>("portal_active")
                .ok()
                .flatten()
                .unwrap_or(false),
            "password_change_pending": row
                .try_get::<Option<bool>, _>("portal_password_change_pending")
                .ok()
                .flatten()
                .unwrap_or(false),
            "last_login_at": row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("portal_last_login_at")
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339()),
            "login_emailed_at": row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("portal_login_emailed_at")
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339()),
            // Delivery status of that last e-mail, once Mittaro reported one.
            "login_email_delivery": row
                .try_get::<Option<String>, _>("portal_login_email_delivery")
                .ok()
                .flatten(),
        }),
        None => Value::Null,
    }
}

async fn list_leads(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListLeadsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsView) {
        return e;
    }

    if let Some(ref status) = query.status
        && !is_valid_lead_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }
    if let Some(ref lead_type) = query.lead_type
        && !is_valid_lead_type(lead_type)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid lead_type");
    }

    let include_archived = query.include_archived.unwrap_or(false);
    let retention = load_unqualified_lead_retention(&state.db).await;
    let search_text = query.search.unwrap_or_default().trim().to_string();
    let search_pattern = format!("%{search_text}%");
    let source_pattern = format!("%{}%", query.source.unwrap_or_default());
    let country_pattern = format!("%{}%", query.country.unwrap_or_default());
    let concierge_grid_only = lead_service_grid_only(&auth);
    // Search only in what the caller may read: without medical access the
    // request text, notes and program do not match (no inference by search).
    let contact_search_only = concierge_grid_only || !lead_medical_visible(&auth);

    match sqlx::query(
        r#"SELECT id, first_name, last_name, email, phone, source, country, citizenships,
                  date_of_birth,
                  intake_source, flow, qualification_status, compliance_status,
                  submitted_at, created_at, console_promoted_at, console_promoted_by,
                  failed_outcome_status, failed_reason, failed_processed_at, status_changed_at,
                  repeat_patient_id, portal_user_id, retention_warning_sent_at,
                  (SELECT u.is_active FROM users u WHERE u.id = leads.portal_user_id) AS portal_active,
                  (SELECT u.password_reset_required FROM users u WHERE u.id = leads.portal_user_id)
                      AS portal_password_change_pending,
                  (SELECT max(tf.created_at) FROM token_families tf WHERE tf.user_id = leads.portal_user_id)
                      AS portal_last_login_at,
                  (SELECT max(e.created_at) FROM portal_login_emails e
                    WHERE e.lead_id = leads.id AND e.user_id = leads.portal_user_id
                      AND e.status = 'sent')
                      AS portal_login_emailed_at,
                  (SELECT e.delivery_status FROM portal_login_emails e
                    WHERE e.lead_id = leads.id AND e.user_id = leads.portal_user_id
                      AND e.status = 'sent'
                    ORDER BY e.created_at DESC
                    LIMIT 1)
                      AS portal_login_email_delivery,
                  (SELECT COUNT(*) FROM lead_attachments a WHERE a.lead_id = leads.id) AS attachment_count,
                  (SELECT COUNT(*) FROM lead_attachments a
                    WHERE a.lead_id = leads.id AND a.import_refused_at IS NOT NULL)
                      AS refused_attachment_count,
                  converted_patient_id
           FROM leads
           WHERE ($1::bool = true OR $2::text IS NOT NULL
                  OR qualification_status NOT IN ('archived', 'deleted'))
             -- A converted lead leaves the working list; it is found again
             -- with its status, the archive switch or a search (QA 2026-10-25).
             AND (converted_patient_id IS NULL
                  OR $1::bool = true OR $2::text = 'converted' OR $3::text <> '%%')
             AND ($2::text IS NULL OR qualification_status = $2)
             AND (
                $3::text = '%%'
                OR (
                    $9::bool = false
                    AND (
                        -- Every word of the query, in any order ("Mia
                        -- MusterAR", "MusterAR Mia"; QA 2026-10-12, A2-05).
                        search_tokens_match(concat_ws(' ',
                             first_name, middle_name, last_name,
                             email, phone, whatsapp_number,
                             city, country, source,
                             notes, message, primary_concern_text,
                             additional_concerns, selected_program
                           ), $10)
                        OR (length(regexp_replace($3, '\D', '', 'g')) >= 3
                            AND phone_digits(concat_ws(' ', phone, whatsapp_number)) LIKE '%' || regexp_replace($3, '\D', '', 'g') || '%')
                    )
                )
                OR (
                    $9::bool = true
                    AND (
                        search_tokens_match(concat_ws(' ',
                             first_name, middle_name, last_name,
                             email, phone, whatsapp_number,
                             city, country, source
                           ), $10)
                        OR (length(regexp_replace($3, '\D', '', 'g')) >= 3
                            AND phone_digits(concat_ws(' ', phone, whatsapp_number)) LIKE '%' || regexp_replace($3, '\D', '', 'g') || '%')
                    )
                )
             )
             AND ($4::text = '%%' OR COALESCE(source, '') ILIKE $4)
             AND ($5::text = '%%' OR COALESCE(country, '') ILIKE $5)
             AND ($6::text IS NULL OR intake_source = $6)
             AND ($7::text IS NULL OR
                CASE
                  WHEN console_promoted_at IS NOT NULL THEN 'console'
                  WHEN lower(replace(COALESCE(intake_source, ''), '-', '_')) IN ('manual', 'crm_manual', 'console') THEN 'console'
                  WHEN lower(replace(COALESCE(intake_source, ''), '-', '_')) IN ('website_contact', 'website_form', 'contact_form')
                    OR lower(replace(COALESCE(source, ''), ' ', '_')) IN ('website_contact_form', 'contact_form')
                    OR lower(COALESCE(flow, '')) = 'contact' THEN 'form'
                  WHEN lower(replace(COALESCE(intake_source, ''), '-', '_')) IN ('visitor_facade', 'website_wizard', 'wizard', 'questionnaire', 'oprosnik')
                    OR lower(replace(COALESCE(source, ''), ' ', '_')) IN ('website_wizard', 'website_questionnaire', 'visitor_facade') THEN 'questionnaire'
                  ELSE 'console'
                END = $7)
             AND ($8::text IS NULL OR flow = $8)
           -- The list pages and filters in the browser: 200 rows hid the oldest
           -- leads (those closest to the automatic deletion) once the archive was
           -- shown (QA 2026-10-30).
           ORDER BY created_at DESC
           LIMIT 2000"#,
    )
    .bind(include_archived)
    .bind(query.status)
    .bind(search_pattern)
    .bind(source_pattern)
    .bind(country_pattern)
    .bind(query.intake_source)
    .bind(query.lead_type)
    .bind(query.flow)
    .bind(contact_search_only)
    .bind(&search_text)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            // Only the leads the rule gives a date need the exception lookup.
            let dated_ids: Vec<Uuid> = rows
                .iter()
                .filter(|row| {
                    !lead_retention_deadline_json(retention.as_ref(), row, false).is_null()
                })
                .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
                .collect();
            let outside_purge =
                match leads_outside_unqualified_purge(&state.db, &dated_ids).await {
                    Ok(value) => value,
                    Err(e) => {
                        tracing::error!(error = %e, "list leads: purge exceptions");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                };
            let mut leads = Vec::with_capacity(rows.len());
            for r in rows {
                // conversion_ready is surfaced on the list payload so the
                // `Convert` button on the leads card can reflect the same
                // gate the backend enforces, without making the user click
                // through and wait for a 422. The full readiness object
                // stays on the detail endpoint — we only lift the single
                // boolean here to keep the list payload light.
                let lead_id = r.try_get::<Uuid, _>("id").unwrap_or_default();
                // The service grid never evaluates conversion readiness: it is
                // commercial/medical data the projection drops anyway.
                let (qualification_ready, conversion_ready) = if concierge_grid_only {
                    (false, false)
                } else {
                    match load_lead_conversion_readiness(&state, lead_id).await {
                        Ok(Some(readiness)) => {
                            (readiness.qualification_ready, readiness.conversion_ready)
                        }
                        Ok(None) => continue,
                        Err(resp) => return resp,
                    }
                };
                let lead = json!({
                    "id": lead_id,
                    "first_name": r.try_get::<String, _>("first_name").unwrap_or_default(),
                    "last_name": r.try_get::<String, _>("last_name").unwrap_or_default(),
                    "email": r.try_get::<Option<String>, _>("email").unwrap_or_default(),
                    "phone": r.try_get::<Option<String>, _>("phone").unwrap_or_default(),
                    "source": r.try_get::<Option<String>, _>("source").unwrap_or_default(),
                    "country": r.try_get::<Option<String>, _>("country").unwrap_or_default(),
                    "citizenships": r.try_get::<Vec<String>, _>("citizenships").unwrap_or_default(),
                    // A minor's row says so even when the portal state is not loaded.
                    "date_of_birth": r.try_get::<Option<chrono::NaiveDate>, _>("date_of_birth").unwrap_or_default(),
                    "intake_source": r.try_get::<Option<String>, _>("intake_source").unwrap_or_default(),
                    "flow": r.try_get::<Option<String>, _>("flow").unwrap_or_default(),
                    "lead_type": lead_type_from_origin(
                        r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("console_promoted_at")
                            .unwrap_or_default()
                            .is_some(),
                        r.try_get::<Option<String>, _>("intake_source").unwrap_or_default().as_deref(),
                        r.try_get::<Option<String>, _>("source").unwrap_or_default().as_deref(),
                        r.try_get::<Option<String>, _>("flow").unwrap_or_default().as_deref(),
                    ),
                    "console_promoted_at": r
                        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("console_promoted_at")
                        .unwrap_or_default()
                        .map(|value| value.to_rfc3339()),
                    "console_promoted_by": r.try_get::<Option<Uuid>, _>("console_promoted_by").unwrap_or_default(),
                    "qualification_status": r.try_get::<String, _>("qualification_status").unwrap_or_default(),
                    "status_changed_at": r
                        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("status_changed_at")
                        .unwrap_or_default()
                        .map(|value| value.to_rfc3339()),
                    "compliance_status": r.try_get::<String, _>("compliance_status").unwrap_or_default(),
                    // When the unqualified-lead rule deletes this lead; null while it does not apply.
                    "retention_deadline_at": lead_retention_deadline_json(
                        retention.as_ref(),
                        &r,
                        outside_purge.contains(&lead_id),
                    ),
                    "qualification_ready": qualification_ready,
                    "conversion_ready": conversion_ready,
                    // Phase 1 classification: a brand-new lead or an existing customer.
                    "repeat_patient_id": r.try_get::<Option<Uuid>, _>("repeat_patient_id").unwrap_or_default(),
                    // The patient login of the lead, for the expandable row.
                    "portal_account": lead_portal_account_summary(&r),
                    "failed_outcome": {
                        "status": r
                            .try_get::<String, _>("failed_outcome_status")
                            .unwrap_or_else(|_| "none".to_string()),
                        "reason": r.try_get::<Option<String>, _>("failed_reason").unwrap_or_default(),
                        "processed_at": r
                            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("failed_processed_at")
                            .unwrap_or_default()
                            .map(|value| value.to_rfc3339()),
                    },
                    "submitted_at": r
                        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("submitted_at")
                        .unwrap_or_default()
                        .map(|v| v.to_rfc3339()),
                    "created_at": r
                        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                        .map(|v| v.to_rfc3339())
                        .unwrap_or_default(),
                    "attachment_count": r.try_get::<i64, _>("attachment_count").unwrap_or(0),
                    // Questionnaire files the import refused (QA 2026-10-25).
                    "refused_attachment_count": r.try_get::<i64, _>("refused_attachment_count").unwrap_or(0),
                    // A converted lead in the list links its patient record.
                    "converted_patient_id": r.try_get::<Option<Uuid>, _>("converted_patient_id").unwrap_or_default(),
                });
                let mut lead = lead;
                if !lead_medical_visible(&auth)
                    && let Some(reason) = lead["failed_outcome"]["reason"].as_str()
                {
                    // Staff's own words may name a diagnosis: the code only.
                    let code = anonymised_failure_reason(reason).to_string();
                    lead["failed_outcome"]["reason"] = json!(code);
                }
                leads.push(if concierge_grid_only {
                    lead_service_grid_projection(&lead)
                } else {
                    lead
                });
            }
            if !concierge_grid_only {
                // Patient portal progress for the access row (2026-10-03).
                crate::routes::lead_portal_intake::attach_list_progress(&state.db, &mut leads)
                    .await;
            }
            Json(leads).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list leads");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn is_valid_lead_status(value: &str) -> bool {
    matches!(
        value,
        "new"
            | "in_progress"
            | "qualified"
            | "not_qualified"
            | "converted"
            | "archived"
            | "deleted"
    )
}

fn is_valid_lead_type(value: &str) -> bool {
    matches!(value, "form" | "questionnaire" | "console")
}

fn normalize_lead_origin(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn lead_type_from_origin(
    console_promoted: bool,
    intake_source: Option<&str>,
    source: Option<&str>,
    flow: Option<&str>,
) -> &'static str {
    if console_promoted {
        return "console";
    }

    let intake_source = intake_source.map(normalize_lead_origin);
    let source = source.map(normalize_lead_origin);
    let flow = flow.map(normalize_lead_origin);

    if intake_source
        .as_deref()
        .is_some_and(|value| matches!(value, "manual" | "crm_manual" | "console"))
    {
        return "console";
    }

    if intake_source
        .as_deref()
        .is_some_and(|value| matches!(value, "website_contact" | "website_form" | "contact_form"))
        || source
            .as_deref()
            .is_some_and(|value| matches!(value, "website_contact_form" | "contact_form"))
        || flow.as_deref() == Some("contact")
    {
        return "form";
    }

    if intake_source.as_deref().is_some_and(|value| {
        matches!(
            value,
            "visitor_facade" | "website_wizard" | "wizard" | "questionnaire" | "oprosnik"
        )
    }) || source.as_deref().is_some_and(|value| {
        matches!(
            value,
            "website_wizard" | "website_questionnaire" | "visitor_facade"
        )
    }) {
        return "questionnaire";
    }

    "console"
}

fn is_valid_compliance_status(value: &str) -> bool {
    matches!(value, "pending" | "documents_sent" | "signed" | "rejected")
}

const MANUAL_COMPLIANCE_SIGNED_REFUSED: &str =
    "Compliance becomes signed only through a signed DSGVO document";

/// The compliance status a manual lead edit may write. Staff record that the
/// DSGVO documents were sent or rejected (or reset to pending), but `signed`
/// comes only from the signature itself: a document marked as signed DSGVO
/// evidence (`documents::mark_document_signed`, also after an e-signature).
/// A lead that is already `signed` keeps it when the form sends it back
/// unchanged; leads marked by hand before 2026-09-28 stay as they are.
fn manual_compliance_update(
    current: &str,
    requested: Option<&str>,
) -> Result<Option<String>, &'static str> {
    match requested {
        None => Ok(None),
        Some("signed") if current == "signed" => Ok(None),
        Some("signed") => Err(MANUAL_COMPLIANCE_SIGNED_REFUSED),
        Some(value) => Ok(Some(value.to_string())),
    }
}

fn is_valid_legal_sex(value: &str) -> bool {
    matches!(value, "female" | "male" | "diverse" | "no_entry")
}

fn is_valid_failed_lead_resolution(value: &str) -> bool {
    matches!(value, "archive" | "delete")
}

fn current_lead_stage(qualification_status: &str, failed_outcome_status: &str) -> String {
    if failed_outcome_status == "delete_anonymized" {
        "deleted".to_string()
    } else {
        qualification_status.to_string()
    }
}

/// Allowed lead lifecycle transitions — the single source of truth for how a
/// lead moves through its status. See docs/lead-status-strategy-ua.md.
/// `converted` and `deleted` are terminal. `converted` is set only by
/// `convert_lead`; `archived`/`deleted` only by the failed-lead workflow.
fn lead_status_transition_allowed(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    matches!(
        (from, to),
        ("new", "in_progress")
            | ("new", "qualified")
            | ("new", "not_qualified")
            | ("new", "archived")
            | ("in_progress", "qualified")
            | ("in_progress", "not_qualified")
            | ("in_progress", "archived")
            | ("qualified", "converted")
            | ("qualified", "in_progress")
            | ("qualified", "not_qualified")
            | ("qualified", "archived")
            | ("not_qualified", "in_progress")
            | ("not_qualified", "archived")
            | ("archived", "in_progress")
            | ("archived", "deleted")
    )
}

fn failed_outcome_payload(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "status": row
            .try_get::<String, _>("failed_outcome_status")
            .unwrap_or_else(|_| "none".to_string()),
        "from_status": row.try_get::<Option<String>, _>("failed_from_status").unwrap_or_default(),
        "reason": row.try_get::<Option<String>, _>("failed_reason").unwrap_or_default(),
        "note": row.try_get::<Option<String>, _>("failed_note").unwrap_or_default(),
        "processed_at": row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("failed_processed_at")
            .unwrap_or_default()
            .map(|value| value.to_rfc3339()),
        "processed_by": row.try_get::<Option<Uuid>, _>("failed_processed_by").unwrap_or_default(),
    })
}

struct LeadConversionReadiness {
    qualification_ready: bool,
    conversion_ready: bool,
    qualification_reasons: Vec<String>,
    conversion_reasons: Vec<String>,
    payload: Value,
}

fn readiness_decimal(value: Option<&Value>) -> String {
    let parsed = value.and_then(|value| match value {
        Value::Number(number) => number.as_f64(),
        Value::String(raw) => raw.trim().replace(',', ".").parse::<f64>().ok(),
        _ => None,
    });
    format!("{:.4}", parsed.unwrap_or_default())
}

fn readiness_line_signatures(value: &Value) -> Vec<String> {
    let mut signatures = value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .map(|item| {
            format!(
                "{}|{}|{}|{}",
                item.get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim(),
                readiness_decimal(item.get("quantity")),
                readiness_decimal(item.get("unit_price")),
                readiness_decimal(item.get("vat_rate")),
            )
        })
        .collect::<Vec<_>>();
    signatures.sort();
    signatures
}

pub(crate) fn normalized_patient_relation_type(value: Option<&str>) -> &'static str {
    let normalized = value.unwrap_or_default().trim().to_lowercase();
    if normalized.contains("spouse")
        || normalized.contains("partner")
        || normalized.contains("ehe")
        || normalized.contains("супруг")
        || normalized.contains("чолов")
        || normalized.contains("друж")
    {
        "spouse"
    } else if ["mother", "mutter", "мать", "мам", "мати"]
        .iter()
        .any(|value| normalized.contains(value))
    {
        "mother"
    } else if ["father", "vater", "отец", "пап"]
        .iter()
        .any(|value| normalized.contains(value))
        // Ukrainian "батько" (father), not "батьки" / "батьків" (parents).
        || (normalized.contains("батьк")
            && !normalized.contains("батьки")
            && !normalized.contains("батьків"))
    {
        "father"
    } else if normalized.contains("parent")
        || normalized.contains("eltern")
        || normalized.contains("родител")
        || normalized.contains("бать")
    {
        "parent"
    } else if normalized.contains("child")
        || normalized.contains("son")
        || normalized.contains("daughter")
        || normalized.contains("kind")
        || normalized.contains("сын")
        || normalized.contains("доч")
        || normalized.contains("син")
    {
        "child"
    } else if normalized.contains("sibling")
        || normalized.contains("brother")
        || normalized.contains("sister")
        || normalized.contains("bruder")
        || normalized.contains("schwester")
        || normalized.contains("брат")
        || normalized.contains("сестр")
    {
        "sibling"
    } else if normalized.contains("guardian")
        || normalized.contains("vormund")
        || normalized.contains("опек")
        || normalized.contains("піклув")
    {
        "guardian"
    } else if normalized.contains("caregiver")
        || normalized.contains("betreuer")
        || normalized.contains("ухаж")
        || normalized.contains("догляд")
    {
        "caregiver"
    } else if normalized.contains("friend")
        || normalized.contains("freund")
        || normalized.contains("друг")
    {
        "friend"
    } else if normalized.contains("relative")
        || normalized.contains("verwand")
        || normalized.contains("родствен")
        || normalized.contains("родич")
    {
        "relative"
    } else {
        "other"
    }
}

/// The patient's emergency contact among the lead's trusted contacts: the
/// entry marked `is_emergency_contact` (name, phone, relation). A trusted
/// contact is no emergency contact by itself (owner decision 2026-10-19), so
/// without a mark there is none — never the first entry of the list, which
/// the legacy `trusted_contact_*` columns mirror.
fn emergency_contact_of(contacts: &Value) -> (Option<String>, Option<String>, Option<String>) {
    let text = |contact: &Value, key: &str| {
        contact
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    contacts
        .as_array()
        .into_iter()
        .flatten()
        .find(|contact| {
            contact
                .get("is_emergency_contact")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                && text(contact, "name").is_some()
        })
        .map(|contact| {
            (
                text(contact, "name"),
                text(contact, "phone"),
                text(contact, "relation"),
            )
        })
        .unwrap_or_default()
}

/// The emergency contact a conversion writes: the contact marked as such;
/// without a mark, the legacy single contact of the `trusted_contact_*`
/// columns (the old one-contact model named the emergency contact there) —
/// but never while a parent or guardian is among the contacts, since a
/// minor's parents are not the emergency contact by themselves (owner
/// decision 2026-10-19).
fn emergency_contact_for_patient(
    contacts: &Value,
    legacy: (Option<String>, Option<String>, Option<String>),
) -> (Option<String>, Option<String>, Option<String>) {
    let marked = emergency_contact_of(contacts);
    if marked.0.is_some() {
        return marked;
    }
    let represented = contacts.as_array().into_iter().flatten().any(|contact| {
        is_parent_or_guardian_relation(contact.get("relation").and_then(Value::as_str))
    });
    if represented
        || legacy
            .0
            .as_deref()
            .is_none_or(|name| name.trim().is_empty())
    {
        return (None, None, None);
    }
    legacy
}

pub(crate) fn is_parent_or_guardian_relation(value: Option<&str>) -> bool {
    matches!(
        normalized_patient_relation_type(value),
        "parent" | "mother" | "father" | "guardian"
    )
}

/// A guardian (Vormund) rather than a parent.
pub(crate) fn is_legal_guardian_relation(value: Option<&str>) -> bool {
    normalized_patient_relation_type(value) == "guardian"
}

pub(crate) fn is_minor_on(date_of_birth: Option<NaiveDate>, today: NaiveDate) -> bool {
    let Some(date_of_birth) = date_of_birth else {
        return false;
    };
    let mut age = today.year() - date_of_birth.year();
    if (today.month(), today.day()) < (date_of_birth.month(), date_of_birth.day()) {
        age -= 1;
    }
    age < 18
}

fn normalized_identity_email(value: Option<&str>) -> Option<String> {
    normalized_contact_text(value).map(|value| value.to_lowercase())
}

fn normalized_identity_phone(value: Option<&str>) -> Option<String> {
    let mut digits = value
        .unwrap_or_default()
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
    if let Some(international) = digits.strip_prefix("00") {
        digits = international.to_string();
    }
    (digits.len() >= 6).then_some(digits)
}

fn normalized_person_name(first_name: &str, last_name: &str) -> String {
    format!("{first_name} {last_name}")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn guardian_contact_matches_owner(
    guardians: &Value,
    owner_id: Option<Uuid>,
    owner_name: &str,
    contact_kind: &str,
    normalized_contact: &str,
) -> bool {
    guardians.as_array().is_some_and(|contacts| {
        contacts.iter().any(|contact| {
            if !is_parent_or_guardian_relation(contact.get("relation").and_then(Value::as_str)) {
                return false;
            }
            let linked = owner_id.is_some_and(|owner_id| {
                contact
                    .get("related_patient_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    == Some(owner_id)
            });
            let contact_name = contact
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            let same_contact = match contact_kind {
                "email" => {
                    normalized_identity_email(contact.get("email").and_then(Value::as_str))
                        .as_deref()
                        == Some(normalized_contact)
                }
                "phone" => {
                    normalized_identity_phone(contact.get("phone").and_then(Value::as_str))
                        .as_deref()
                        == Some(normalized_contact)
                }
                _ => false,
            };
            linked
                || (owner_id.is_none()
                    && !contact_name.is_empty()
                    && contact_name == owner_name
                    && same_contact)
        })
    })
}

struct LeadContactIdentity<'a> {
    lead_id: Option<Uuid>,
    patient_ids: Vec<Uuid>,
    first_name: &'a str,
    last_name: &'a str,
    date_of_birth: Option<NaiveDate>,
    email: Option<&'a str>,
    phone: Option<&'a str>,
    guardians: &'a Value,
}

async fn validate_lead_contact_identity(
    state: &AppState,
    candidate: &LeadContactIdentity<'_>,
) -> Result<(), axum::response::Response> {
    validate_lead_contact_identity_from(state, candidate, None).await
}

/// [`validate_lead_contact_identity`] for a lead pre-filled from a relation
/// or trusted contact (`source_person`, owner decision 2026-10-25): an e-mail
/// or phone whose only owner is the source record — the child whose relation
/// or contact the data come from — passes, because the parent's contact data
/// on the child's record are the parent's own. Any other owner still
/// conflicts.
async fn validate_lead_contact_identity_from(
    state: &AppState,
    candidate: &LeadContactIdentity<'_>,
    source: Option<&super::lead_source_person::SourcePersonData>,
) -> Result<(), axum::response::Response> {
    let contacts = [
        ("email", normalized_identity_email(candidate.email)),
        ("phone", normalized_identity_phone(candidate.phone)),
    ];

    for (kind, normalized) in contacts {
        let Some(normalized) = normalized else {
            continue;
        };
        let conflicts = sqlx::query(
            r#"SELECT l.id AS owner_lead_id,
                      COALESCE(l.prospect_patient_id, l.repeat_patient_id, l.converted_patient_id) AS owner_patient_id,
                      l.first_name, l.last_name, l.date_of_birth,
                      l.trusted_contacts AS guardians
                 FROM leads l
                WHERE l.qualification_status <> 'archived'
                  AND COALESCE(l.failed_outcome_status, 'none') = 'none'
                  AND (
                    ($1 = 'email' AND lower(btrim(COALESCE(l.email, ''))) = $2)
                    OR ($1 = 'phone' AND (
                      regexp_replace(phone_digits(l.phone), '^00', '') = $2
                      OR regexp_replace(phone_digits(l.whatsapp_number), '^00', '') = $2
                      OR EXISTS (
                        SELECT 1
                          FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(l.phones) = 'array' THEN l.phones ELSE '[]'::jsonb END
                          ) item
                         WHERE regexp_replace(phone_digits(item->>'number'), '^00', '') = $2
                      )
                    ))
                  )
                UNION ALL
               SELECT p.source_lead_id AS owner_lead_id, p.id AS owner_patient_id,
                      p.first_name, p.last_name, p.birth_date AS date_of_birth,
                      COALESCE(
                        CASE WHEN jsonb_typeof(p.intake_profile->'trusted_contacts') = 'array'
                          THEN p.intake_profile->'trusted_contacts' ELSE '[]'::jsonb END,
                        '[]'::jsonb
                      ) || COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                          'related_patient_id', pr.related_patient_id,
                          'name', COALESCE(NULLIF(btrim(concat_ws(' ', rp.first_name, rp.last_name)), ''), pr.related_name),
                          -- A relation without a patient record carries its own
                          -- e-mail (the conversion and the patient card write it).
                          'email', COALESCE(NULLIF(btrim(rp.email), ''), pr.email),
                          'phone', COALESCE(rp.phone_primary, pr.phone),
                          'relation', pr.relation_type
                        ))
                          FROM patient_relations pr
                          LEFT JOIN patients rp ON rp.id = pr.related_patient_id
                         WHERE pr.patient_id = p.id
                           AND pr.relation_type IN ('parent', 'mother', 'father', 'guardian')
                      ), '[]'::jsonb) AS guardians
                 FROM patients p
                WHERE p.lifecycle_status IN ('prospective', 'active', 'inactive')
                  AND (
                    ($1 = 'email' AND (
                      lower(btrim(COALESCE(p.email, ''))) = $2
                      OR EXISTS (
                        SELECT 1 FROM patient_contacts pc
                         WHERE pc.patient_id = p.id AND pc.contact_kind = 'email'
                           AND lower(btrim(pc.value)) = $2
                      )
                    ))
                    OR ($1 = 'phone' AND (
                      regexp_replace(phone_digits(p.phone_primary), '^00', '') = $2
                      OR regexp_replace(phone_digits(p.phone_secondary), '^00', '') = $2
                      OR EXISTS (
                        SELECT 1 FROM patient_contacts pc
                         WHERE pc.patient_id = p.id AND pc.contact_kind = 'phone'
                           AND regexp_replace(phone_digits(pc.value), '^00', '') = $2
                      )
                    ))
                  )"#,
        )
        .bind(kind)
        .bind(&normalized)
        .fetch_all(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(%error, contact_kind = kind, "validate lead contact identity");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate contact identity")
        })?;

        for conflict in conflicts {
            let owner_lead_id: Option<Uuid> = conflict.try_get("owner_lead_id").unwrap_or_default();
            let owner_patient_id: Option<Uuid> =
                conflict.try_get("owner_patient_id").unwrap_or_default();
            if candidate
                .lead_id
                .is_some_and(|lead_id| owner_lead_id == Some(lead_id))
                || owner_patient_id.is_some_and(|id| candidate.patient_ids.contains(&id))
                || source.is_some_and(|source| source.owns(owner_lead_id, owner_patient_id))
            {
                continue;
            }

            let owner_first: String = conflict.try_get("first_name").unwrap_or_default();
            let owner_last: String = conflict.try_get("last_name").unwrap_or_default();
            let owner_name = normalized_person_name(&owner_first, &owner_last);
            let owner_birth_date: Option<NaiveDate> =
                conflict.try_get("date_of_birth").unwrap_or_default();
            let owner_guardians: Value =
                conflict.try_get("guardians").unwrap_or_else(|_| json!([]));
            let candidate_name = normalized_person_name(candidate.first_name, candidate.last_name);
            let today = crate::app_time::today();
            let candidate_is_minor = is_minor_on(candidate.date_of_birth, today);
            let owner_is_minor = is_minor_on(owner_birth_date, today);
            let guardian_exception = (candidate_is_minor
                && !owner_is_minor
                && guardian_contact_matches_owner(
                    candidate.guardians,
                    owner_patient_id,
                    &owner_name,
                    kind,
                    &normalized,
                ))
                || (owner_is_minor
                    && !candidate_is_minor
                    && guardian_contact_matches_owner(
                        &owner_guardians,
                        candidate.patient_ids.first().copied(),
                        &candidate_name,
                        kind,
                        &normalized,
                    ));
            if guardian_exception {
                continue;
            }

            return Err(field_err(
                kind,
                if kind == "email" {
                    "Email is already used by another person"
                } else {
                    "Phone is already used by another person"
                },
            ));
        }
    }

    Ok(())
}

/// Readiness reason when the VKS cannot be created yet: it lists medical work
/// types only, so they must be chosen in the wizard first.
const COST_ESTIMATE_WORK_TYPES_MISSING: &str = "Medical work types are not selected";

/// The signed patient form (Patientenformular) is missing in a new patient's
/// first onboarding; a repeat order may go without it (owner decision
/// 2026-10-23, `crate::lead_self_disclosure`).
const SELF_DISCLOSURE_UNSIGNED: &str = "Patient form is not signed";

fn lead_cost_estimate_work_types_selected(wizard_state: &Value) -> bool {
    wizard_state
        .get("selected_specialization_work_type_ids")
        .or_else(|| wizard_state.get("selectedSpecializationWorkTypeIds"))
        .and_then(Value::as_array)
        .is_some_and(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .any(|id| Uuid::parse_str(id.trim()).is_ok())
        })
}

#[derive(Default)]
struct LeadConversionReadinessInput {
    qualification_status: String,
    compliance_status: String,
    converted_patient_id: Option<Uuid>,
    date_of_birth: Option<NaiveDate>,
    legal_sex: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    street_address: Option<String>,
    city: Option<String>,
    zip_code: Option<String>,
    // The reason of the request (staff `primary_concern_text` or the lead's
    // own `request_reason`) is optional since 2026-10-19 (owner) and is not
    // part of the readiness.
    requested_specialties: Value,
    /// Staff record (a paper consent, the wizard toggle) or the cabinet's
    /// consent; see `cabinet_consent_*` for the latter alone.
    consent_privacy_practices: bool,
    consent_healthcare: bool,
    /// An active cabinet consent record (`lead_inquiry_processing` /
    /// `health_data_processing`) of the adult lead or a parent / guardian.
    cabinet_consent_privacy: bool,
    cabinet_consent_healthcare: bool,
    /// `{how, note, staff_user_id}` of the newest active consent when staff
    /// recorded it in the client's form; `null` for the client's own.
    cabinet_consent_privacy_recorded: Value,
    cabinet_consent_healthcare_recorded: Value,
    identity_document_verified: bool,
    dsgvo_document_signed: bool,
    confidentiality_release_signed: bool,
    enhanced_due_diligence_required: bool,
    enhanced_due_diligence_document_generated: bool,
    enhanced_due_diligence_document_signed: bool,
    /// A GwG sheet of the third-party payer was generated and is not signed
    /// yet: the compliance is not complete (owner decision 2026-10-30). The
    /// sheet itself stays voluntary; only an open one counts.
    payer_gwg_sheet_unsigned: bool,
    contract_signed: bool,
    /// The selected contract was terminated (repeat intake): a new contract
    /// must be created, so the reason must say so instead of "not signed".
    contract_terminated: bool,
    framework_document_generated: bool,
    order_exists: bool,
    order_service_ready: bool,
    order_document_generated: bool,
    order_cost_estimate_document_generated: bool,
    order_signed_patient: bool,
    order_signed_agency: bool,
    quote_accepted: bool,
    /// The catalog has active medical work types for the requested
    /// specialisations. Without any, the VKS has nothing to list and is not
    /// required until the catalog is filled.
    cost_estimate_catalog_available: bool,
    /// The wizard has medical work types selected for the VKS.
    cost_estimate_work_types_selected: bool,
    /// A VKS generated from medical work types exists (agency lines never count).
    cost_estimate_document_generated: bool,
    prepayment_ready: bool,
    /// Existing customer (2B): overdue invoices are surfaced for attention.
    /// Since 2026-09 debt never blocks execution, so this does not gate conversion.
    debt_attention: bool,
    debt_attention_reason: Option<String>,
    /// Existing customer (2B): a package-covered order needs no separate Kostenvoranschlag.
    package_covered: bool,
    /// "Кто платит": the payer declaration and, for a third-party payer, the
    /// signed Kostenübernahmeerklärung (see `lead_payer.rs`).
    payer: super::lead_payer::PayerReadiness,
    /// The risk assessment holds the lead until staff decided (level ≥ 2 not
    /// released, or rejected; `crate::risk`). Level 1, released and
    /// grandfathered leads pass.
    risk_assessment_held: bool,
    /// A parent or guardian contact with an e-mail or phone; for a minor it
    /// stands in for the child's own contact.
    guardian_contact_present: bool,
    /// The patient form (Patientenformular): required and signed? Required
    /// only in a new patient's first onboarding (owner decision 2026-10-23,
    /// `crate::lead_self_disclosure`).
    self_disclosure: crate::lead_self_disclosure::Status,
    /// The contract details of a minor's representatives that are still
    /// missing (`lead_representatives::contract_details_missing`, keys like
    /// `representative:<id>:birth_place`). The conversion refuses with them
    /// (422 `representative_details_incomplete`), so the release list says so
    /// before staff click; never a qualification reason.
    contract_details_missing: Vec<String>,
}

fn evaluate_lead_conversion_readiness(
    input: &LeadConversionReadinessInput,
) -> LeadConversionReadiness {
    let lead_qualified = input.qualification_status == "qualified";
    let compliance_signed = input.compliance_status == "signed";
    // The payer's open GwG sheet keeps the compliance open (owner 2026-10-30).
    let compliance_completed = compliance_signed && !input.payer_gwg_sheet_unsigned;
    let birth_date_present = input.date_of_birth.is_some();
    let legal_sex_present = input.legal_sex.as_deref().is_some_and(is_valid_legal_sex);
    let primary_contact_present = input
        .email
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || input
            .phone
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        // A minor is reached through a parent or guardian (the wizard keeps
        // the child's own e-mail and phone optional).
        || (input.guardian_contact_present
            && is_minor_on(input.date_of_birth, crate::app_time::today()));
    let address_present = [&input.street_address, &input.city, &input.zip_code]
        .into_iter()
        .all(|value| {
            value
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        });
    let address_ready = !input.consent_healthcare || address_present;
    let specialties_present = match &input.requested_specialties {
        Value::Array(items) => items.iter().any(|value| match value {
            Value::String(value) => !value.trim().is_empty(),
            Value::Object(_) => true,
            _ => false,
        }),
        Value::Object(items) => !items.is_empty(),
        _ => false,
    };
    let master_data_ready =
        birth_date_present && legal_sex_present && primary_contact_present && address_ready;
    // Nothing in the medical step is required: the reason of the request is
    // optional since 2026-10-19 (owner).
    let medical_ready = true;
    let service_ready = specialties_present;
    // A repeat order may go without the patient form (owner decision 2026-10-23).
    let self_disclosure_ready = !input.self_disclosure.required || input.self_disclosure.signed;
    // The risk assessment's check belongs to this step (`stage: documents`):
    // the step is not ready while staff still have to decide.
    let documents_ready = compliance_completed
        && !input.risk_assessment_held
        && input.consent_privacy_practices
        && input.consent_healthcare
        && input.identity_document_verified
        && input.dsgvo_document_signed
        && input.confidentiality_release_signed
        && (!input.enhanced_due_diligence_required
            || (input.enhanced_due_diligence_document_generated
                && input.enhanced_due_diligence_document_signed))
        && self_disclosure_ready
        && input.payer.ready_for_conversion();
    // The VKS lists the selected medical work types, never the agency's services.
    let cost_estimate_ready = !input.cost_estimate_catalog_available
        || (input.cost_estimate_work_types_selected && input.cost_estimate_document_generated);
    let commercial_ready = input.contract_signed
        && input.framework_document_generated
        && input.order_exists
        && input.order_service_ready
        && input.order_document_generated
        && (input.package_covered || input.order_cost_estimate_document_generated)
        && input.order_signed_patient
        && input.order_signed_agency
        && (input.package_covered || input.quote_accepted)
        && (input.package_covered || cost_estimate_ready);

    let risk_assessment_released = !input.risk_assessment_held;
    let mut checks = vec![
        json!({
            "key": "lead_qualified",
            "label": "Lead qualified",
            "passed": lead_qualified,
            "blocking_for": "conversion",
            "stage": "service",
        }),
        json!({
            "key": "compliance_completed",
            "label": "Compliance completed",
            "passed": compliance_completed,
            "blocking_for": "qualification",
            "stage": "documents",
        }),
        json!({
            "key": "risk_assessment_released",
            "label": "Risk assessment released",
            "passed": risk_assessment_released,
            "blocking_for": "qualification",
            "stage": "documents",
        }),
        json!({
            "key": "birth_date_present",
            "label": "Birth date captured",
            "passed": birth_date_present,
            "blocking_for": "qualification",
            "stage": "master_data",
        }),
        json!({
            "key": "legal_sex_present",
            "label": "Legal sex captured",
            "passed": legal_sex_present,
            "blocking_for": "qualification",
            "stage": "master_data",
        }),
        json!({
            "key": "primary_contact_present",
            "label": "Primary contact available",
            "passed": primary_contact_present,
            "blocking_for": "qualification",
            "stage": "master_data",
        }),
        json!({
            "key": "privacy_consent",
            "label": "Inquiry processing consent given",
            "passed": input.consent_privacy_practices,
            "blocking_for": "qualification",
            "stage": "documents",
        }),
        json!({
            "key": "healthcare_consent",
            "label": "Healthcare consent captured",
            "passed": input.consent_healthcare,
            "blocking_for": "qualification",
            "stage": "documents",
        }),
        json!({
            "key": "address_present",
            "label": "Address captured when healthcare consent exists",
            "passed": address_ready,
            "blocking_for": "conversion",
            "stage": "master_data",
        }),
        json!({
            "key": "specialties_present",
            "label": "Requested specialty selected",
            "passed": specialties_present,
            "blocking_for": "conversion",
            "stage": "service",
        }),
        json!({
            "key": "identity_document_verified",
            "label": "Identity document verified",
            "passed": input.identity_document_verified,
            "blocking_for": "conversion",
            "stage": "documents",
        }),
        json!({
            "key": "dsgvo_document_signed",
            "label": "DSGVO document signed",
            "passed": input.dsgvo_document_signed,
            "blocking_for": "conversion",
            "stage": "documents",
        }),
        json!({
            "key": "self_disclosure_signed",
            "label": "Patient form signed (first onboarding of a new patient)",
            "passed": self_disclosure_ready,
            "required": input.self_disclosure.required,
            "blocking_for": "conversion",
            "stage": "documents",
        }),
        json!({
            "key": "confidentiality_release_signed",
            "label": "Confidentiality release signed",
            "passed": input.confidentiality_release_signed,
            "blocking_for": "conversion",
            "stage": "documents",
        }),
        json!({
            "key": "enhanced_due_diligence_document_generated",
            "label": "Enhanced due diligence documented when required",
            "passed": !input.enhanced_due_diligence_required
                || input.enhanced_due_diligence_document_generated,
            "blocking_for": "conversion",
            "stage": "documents",
        }),
        json!({
            "key": "enhanced_due_diligence_document_signed",
            "label": "Enhanced due diligence document signed when required",
            "passed": !input.enhanced_due_diligence_required
                || input.enhanced_due_diligence_document_signed,
            "blocking_for": "conversion",
            "stage": "documents",
        }),
        json!({
            "key": "contract_signed",
            "label": "Framework contract signed",
            "passed": input.contract_signed,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "framework_document_generated",
            "label": "Framework contract document generated",
            "passed": input.framework_document_generated,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "order_exists",
            "label": "Order created",
            "passed": input.order_exists,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "order_service_ready",
            "label": "Order service configured",
            "passed": input.order_service_ready,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "order_document_generated",
            "label": "Order document generated",
            "passed": input.order_document_generated,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "order_cost_estimate_document_generated",
            "label": "Order cost estimate document generated",
            "passed": input.package_covered || input.order_cost_estimate_document_generated,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "order_signed_patient",
            "label": "Order signed by customer",
            "passed": input.order_signed_patient,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "order_signed_agency",
            "label": "Order signed by agency",
            "passed": input.order_signed_agency,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "quote_accepted",
            "label": "Quote accepted",
            "passed": input.package_covered || input.quote_accepted,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "cost_estimate_document_generated",
            "label": "Cost estimate document generated",
            "passed": cost_estimate_ready,
            "blocking_for": "conversion",
            "stage": "commercial",
        }),
        json!({
            "key": "debt_clear",
            "label": "No overdue invoices",
            "passed": !input.debt_attention,
            "blocking_for": null,
            "stage": "commercial",
        }),
        json!({
            "key": "prepayment_ready",
            "label": "Required prepayment received",
            "passed": input.prepayment_ready,
            "blocking_for": null,
            "stage": "commercial",
        }),
    ];

    let mut qualification_reasons = Vec::new();
    if !compliance_signed {
        qualification_reasons.push("Compliance is not signed yet".to_string());
    }
    if input.payer_gwg_sheet_unsigned {
        qualification_reasons.push("Payer GwG sheet is not signed".to_string());
    }
    if !birth_date_present {
        qualification_reasons.push("Birth date is missing".to_string());
    }
    if !legal_sex_present {
        qualification_reasons.push("Legal sex is missing".to_string());
    }
    if !primary_contact_present {
        qualification_reasons.push("Email or phone is required".to_string());
    }
    if !input.consent_privacy_practices {
        qualification_reasons.push("Privacy practices consent is missing".to_string());
    }
    if !input.consent_healthcare {
        qualification_reasons.push("Healthcare consent is missing".to_string());
    }
    if !risk_assessment_released {
        qualification_reasons.push("Risk assessment waits for a staff decision".to_string());
    }

    let qualification_ready = qualification_reasons.is_empty();
    let mut conversion_reasons = qualification_reasons.clone();
    if !lead_qualified {
        conversion_reasons.push("Lead must be qualified before conversion".to_string());
    }
    if input.consent_healthcare && !address_present {
        conversion_reasons.push("Complete street, city and postal code".to_string());
    }
    if !specialties_present {
        conversion_reasons.push("Requested specialty is missing".to_string());
    }
    if !input.identity_document_verified {
        conversion_reasons.push("Identity document is not verified".to_string());
    }
    if !input.dsgvo_document_signed {
        // "Compliance is not signed yet" is this very fact (the signed consent
        // form sets the compliance status): one blocker, not the same missing
        // signature listed twice as if a further consent were needed.
        conversion_reasons.retain(|reason| reason != "Compliance is not signed yet");
        conversion_reasons.push("Signed DSGVO document is missing".to_string());
    }
    if !input.confidentiality_release_signed {
        conversion_reasons.push("Signed confidentiality release is missing".to_string());
    }
    if !self_disclosure_ready {
        conversion_reasons.push(SELF_DISCLOSURE_UNSIGNED.to_string());
    }
    if input.enhanced_due_diligence_required && !input.enhanced_due_diligence_document_generated {
        conversion_reasons.push("Enhanced due diligence document is missing".to_string());
    } else if input.enhanced_due_diligence_required && !input.enhanced_due_diligence_document_signed
    {
        conversion_reasons.push("Enhanced due diligence document is not signed".to_string());
    }
    input.payer.extend(&mut checks, &mut conversion_reasons);
    if !input.contract_signed {
        if input.contract_terminated {
            conversion_reasons
                .push("Framework contract was terminated; create a new contract".to_string());
        } else {
            conversion_reasons.push("Framework contract is not signed".to_string());
        }
    }
    if !input.framework_document_generated {
        conversion_reasons.push("Framework contract document is missing".to_string());
    }
    if !input.order_exists {
        conversion_reasons.push("Onboarding order is missing".to_string());
    }
    if !input.order_service_ready {
        conversion_reasons.push("Order needs at least one valid service".to_string());
    }
    if !input.order_document_generated {
        conversion_reasons.push("Order document is missing".to_string());
    }
    if !input.package_covered && !input.order_cost_estimate_document_generated {
        conversion_reasons.push("Order cost estimate document is missing".to_string());
    }
    if !input.order_signed_patient {
        conversion_reasons.push("Customer order signature is missing".to_string());
    }
    if !input.order_signed_agency {
        conversion_reasons.push("Agency order signature is missing".to_string());
    }
    if !input.package_covered && !input.quote_accepted {
        conversion_reasons.push("Quote is not accepted".to_string());
    }
    let cost_estimate_required = !input.package_covered && input.cost_estimate_catalog_available;
    if cost_estimate_required && !input.cost_estimate_work_types_selected {
        conversion_reasons.push(COST_ESTIMATE_WORK_TYPES_MISSING.to_string());
    } else if cost_estimate_required && !input.cost_estimate_document_generated {
        conversion_reasons.push("Preliminary cost calculation document is missing".to_string());
    }
    if !input.contract_details_missing.is_empty() {
        conversion_reasons.push(CONTRACT_DETAILS_MISSING.to_string());
    }
    if input.converted_patient_id.is_some() {
        conversion_reasons.push("Lead is already converted".to_string());
    }
    let conversion_ready = conversion_reasons.is_empty();

    let mut payload = json!({
        "qualification_ready": qualification_ready,
        "conversion_ready": conversion_ready,
        "qualification_reasons": qualification_reasons,
        "blocking_reasons": conversion_reasons,
        "checks": checks,
        // The wizard shows these as given in the cabinet next to its own
        // toggles (which record a paper consent).
        "cabinet_consents": {
            "privacy_practices": input.cabinet_consent_privacy,
            "healthcare": input.cabinet_consent_healthcare,
            // How the client gave a consent staff recorded (owner 2026-10-30).
            "privacy_practices_recorded": input.cabinet_consent_privacy_recorded,
            "healthcare_recorded": input.cabinet_consent_healthcare_recorded,
        },
        "steps": [
            { "key": "master_data", "label": "Stammdaten", "ready": master_data_ready },
            { "key": "medical", "label": "Medizinische Merkmale", "ready": medical_ready },
            { "key": "service", "label": "Servicehistorie", "ready": service_ready },
            { "key": "documents", "label": "Unterlagen", "ready": documents_ready },
            { "key": "commercial", "label": "Vertrag & Auftrag", "ready": commercial_ready },
            { "key": "release", "label": "Freigabe", "ready": conversion_ready }
        ],
    });
    // The missing keys point the wizard at the person and the field; left
    // out when there is nothing to complete.
    if !input.contract_details_missing.is_empty() {
        payload["contract_details_missing"] = json!(input.contract_details_missing);
    }

    LeadConversionReadiness {
        qualification_ready,
        conversion_ready,
        qualification_reasons,
        conversion_reasons,
        payload,
    }
}

/// The conversion reason of [`LeadConversionReadinessInput::contract_details_missing`];
/// the frontend maps this exact text.
const CONTRACT_DETAILS_MISSING: &str = "Contract details of the representatives are missing";

/// `{how, note}` of a consent staff recorded for the client (the
/// `recorded_by_staff` context of its record), `null` otherwise.
fn recorded_by_staff(row: &sqlx::postgres::PgRow, column: &str) -> Value {
    match row.try_get::<Option<Value>, _>(column).ok().flatten() {
        Some(recorded) if recorded["how"].is_string() => {
            json!({ "how": recorded["how"], "note": recorded["note"] })
        }
        _ => Value::Null,
    }
}

fn lead_conversion_readiness_input(row: &sqlx::postgres::PgRow) -> LeadConversionReadinessInput {
    let wizard_state = row
        .try_get::<Value, _>("wizard_state")
        .unwrap_or_else(|_| json!({}));
    let quote_line_items = row
        .try_get::<Value, _>("quote_line_items")
        .unwrap_or_else(|_| json!([]));
    let order_service_line_items = row
        .try_get::<Value, _>("order_service_line_items")
        .unwrap_or_else(|_| json!([]));
    let quote_matches_order = !readiness_line_signatures(&quote_line_items).is_empty()
        && readiness_line_signatures(&quote_line_items)
            == readiness_line_signatures(&order_service_line_items);
    let cabinet_consent_privacy: bool = row.try_get("cabinet_consent_privacy").unwrap_or(false);
    let cabinet_consent_healthcare: bool =
        row.try_get("cabinet_consent_healthcare").unwrap_or(false);
    LeadConversionReadinessInput {
        qualification_status: row.try_get("qualification_status").unwrap_or_default(),
        compliance_status: row.try_get("compliance_status").unwrap_or_default(),
        converted_patient_id: row.try_get("converted_patient_id").unwrap_or_default(),
        date_of_birth: row.try_get("date_of_birth").unwrap_or_default(),
        legal_sex: row.try_get("legal_sex").unwrap_or_default(),
        email: row.try_get("email").unwrap_or_default(),
        phone: row.try_get("phone").unwrap_or_default(),
        street_address: row.try_get("street_address").unwrap_or_default(),
        city: row.try_get("city").unwrap_or_default(),
        zip_code: row.try_get("zip_code").unwrap_or_default(),
        requested_specialties: row
            .try_get("requested_specialties")
            .unwrap_or_else(|_| json!([])),
        // A consent given in the cabinet counts like the staff's record of it.
        consent_privacy_practices: row.try_get("consent_privacy_practices").unwrap_or(false)
            || cabinet_consent_privacy,
        consent_healthcare: row.try_get("consent_healthcare").unwrap_or(false)
            || cabinet_consent_healthcare,
        cabinet_consent_privacy,
        cabinet_consent_healthcare,
        cabinet_consent_privacy_recorded: recorded_by_staff(
            row,
            "cabinet_consent_privacy_recorded",
        ),
        cabinet_consent_healthcare_recorded: recorded_by_staff(
            row,
            "cabinet_consent_healthcare_recorded",
        ),
        identity_document_verified: row.try_get("identity_document_verified").unwrap_or(false),
        dsgvo_document_signed: row.try_get("dsgvo_document_signed").unwrap_or(false),
        confidentiality_release_signed: row
            .try_get("confidentiality_release_signed")
            .unwrap_or(false),
        // Set by `load_lead_conversion_readiness` from the owner's rule.
        enhanced_due_diligence_required: false,
        enhanced_due_diligence_document_generated: row
            .try_get("enhanced_due_diligence_document_generated")
            .unwrap_or(false),
        enhanced_due_diligence_document_signed: row
            .try_get("enhanced_due_diligence_document_signed")
            .unwrap_or(false),
        payer_gwg_sheet_unsigned: row.try_get("payer_gwg_sheet_unsigned").unwrap_or(false),
        contract_signed: row.try_get("contract_signed").unwrap_or(false),
        contract_terminated: false,
        framework_document_generated: row.try_get("framework_document_generated").unwrap_or(false),
        order_exists: row.try_get("order_exists").unwrap_or(false),
        order_service_ready: row.try_get("order_service_ready").unwrap_or(false),
        order_document_generated: row.try_get("order_document_generated").unwrap_or(false),
        order_cost_estimate_document_generated: row
            .try_get("order_cost_estimate_document_generated")
            .unwrap_or(false),
        order_signed_patient: row.try_get("order_signed_patient").unwrap_or(false),
        order_signed_agency: row.try_get("order_signed_agency").unwrap_or(false),
        quote_accepted: row.try_get("quote_accepted").unwrap_or(false) && quote_matches_order,
        cost_estimate_catalog_available: row
            .try_get("cost_estimate_catalog_available")
            .unwrap_or(false),
        cost_estimate_work_types_selected: lead_cost_estimate_work_types_selected(&wizard_state),
        cost_estimate_document_generated: row
            .try_get("cost_estimate_document_generated")
            .unwrap_or(false),
        // Receiving the required prepayment and accepting the current quote are
        // separate readiness checks. A later catalog-price change invalidates
        // the quote, but it must not make money already received disappear.
        prepayment_ready: row.try_get("prepayment_ready").unwrap_or(false),
        debt_attention: false,
        debt_attention_reason: None,
        package_covered: false,
        payer: Default::default(),
        risk_assessment_held: false,
        guardian_contact_present: guardian_contact_present(
            &row.try_get::<Value, _>("trusted_contacts")
                .unwrap_or_else(|_| json!([])),
        ),
        // Set by `load_lead_conversion_readiness` from the owner's rule.
        self_disclosure: Default::default(),
        // Set by `load_lead_conversion_readiness` (needs the representatives).
        contract_details_missing: Vec::new(),
    }
}

/// A parent or guardian among the trusted contacts with an e-mail or phone:
/// a minor is reached through them, the child's own address is optional
/// (QA 2026-10-06, B1-a; QA 2026-10-22).
fn guardian_contact_present(contacts: &Value) -> bool {
    let has = |contact: &Value, key: &str| {
        contact
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    };
    contacts.as_array().is_some_and(|contacts| {
        contacts.iter().any(|contact| {
            is_parent_or_guardian_relation(contact.get("relation").and_then(Value::as_str))
                && has(contact, "name")
                && (has(contact, "email") || has(contact, "phone"))
        })
    })
}

async fn load_lead_conversion_readiness(
    state: &AppState,
    lead_id: Uuid,
) -> Result<Option<LeadConversionReadiness>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT qualification_status,
                  compliance_status,
                  converted_patient_id,
                  date_of_birth,
                  legal_sex,
                  email,
                  phone,
                  trusted_contacts,
                  street_address,
                  city,
                  zip_code,
                  requested_specialties,
                  country,
                  wizard_state,
                  consent_privacy_practices,
                  consent_healthcare,
                  -- The consents given in the cabinet count like the staff's
                  -- record of a paper consent (owner 2026-10-20): an active
                  -- record of the adult lead, or of a parent / guardian.
                  -- A minor's own login never counts: only a parent's or the
                  -- guardian's record (`access_kind = guardian`).
                  EXISTS (
                      SELECT 1 FROM consent_records cr
                      WHERE cr.lead_id = leads.id
                        AND cr.consent_type = 'lead_inquiry_processing'
                        AND cr.granted AND cr.revoked_at IS NULL
                        AND (cr.expires_at IS NULL OR cr.expires_at > now())
                        AND (cr.context->>'access_kind' = 'guardian'
                             OR cr.context ? 'recorded_by_staff'
                             OR leads.date_of_birth IS NULL
                             OR leads.date_of_birth
                                <= ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years'))
                  ) AS cabinet_consent_privacy,
                  EXISTS (
                      SELECT 1 FROM consent_records cr
                      WHERE cr.lead_id = leads.id
                        AND cr.consent_type = 'health_data_processing'
                        AND cr.granted AND cr.revoked_at IS NULL
                        AND (cr.expires_at IS NULL OR cr.expires_at > now())
                        AND (cr.context->>'access_kind' = 'guardian'
                             OR cr.context ? 'recorded_by_staff'
                             OR leads.date_of_birth IS NULL
                             OR leads.date_of_birth
                                <= ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years'))
                  ) AS cabinet_consent_healthcare,
                  -- How the client gave the newest active consent staff
                  -- recorded in the client's form (owner 2026-10-30): the
                  -- wizard and the patient card say «Записал сотрудник ·
                  -- лично» instead of «в кабинете» / «на бумаге».
                  (SELECT cr.context->'recorded_by_staff'
                     FROM consent_records cr
                    WHERE cr.lead_id = leads.id
                      AND cr.consent_type = 'lead_inquiry_processing'
                      AND cr.granted AND cr.revoked_at IS NULL
                      AND (cr.expires_at IS NULL OR cr.expires_at > now())
                    ORDER BY cr.granted_at DESC LIMIT 1) AS cabinet_consent_privacy_recorded,
                  (SELECT cr.context->'recorded_by_staff'
                     FROM consent_records cr
                    WHERE cr.lead_id = leads.id
                      AND cr.consent_type = 'health_data_processing'
                      AND cr.granted AND cr.revoked_at IS NULL
                      AND (cr.expires_at IS NULL OR cr.expires_at > now())
                    ORDER BY cr.granted_at DESC LIMIT 1) AS cabinet_consent_healthcare_recorded,
                  -- Repeat intakes (patient_first) reuse the compliance evidence
                  -- already stored on the patient instead of demanding new copies.
                  EXISTS (
                      SELECT 1 FROM documents d
                      WHERE (
                              d.lead_id = leads.id
                              OR (leads.prospect_patient_id IS NOT NULL
                                  AND d.patient_id = leads.prospect_patient_id)
                            )
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                        AND d.compliance_kind = 'identity'
                        AND d.signed_at IS NOT NULL
                  ) AS identity_document_verified,
                  EXISTS (
                      SELECT 1 FROM documents d
                      WHERE (
                              d.lead_id = leads.id
                              OR (leads.prospect_patient_id IS NOT NULL
                                  AND d.patient_id = leads.prospect_patient_id)
                            )
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                        AND d.compliance_kind = 'dsgvo'
                        AND d.signed_at IS NOT NULL
                        -- After the patient revoked the consent only one signed
                        -- later counts (owner decision 2026-10-12).
                        AND d.signed_at > COALESCE(
                            (SELECT (rp.legal_status->>'dsgvo_revoked_at')::timestamptz
                             FROM patients rp WHERE rp.id = leads.prospect_patient_id),
                            '-infinity'::timestamptz)
                  ) AS dsgvo_document_signed,
                  EXISTS (
                      SELECT 1 FROM documents d
                      WHERE (
                              d.lead_id = leads.id
                              OR (leads.prospect_patient_id IS NOT NULL
                                  AND d.patient_id = leads.prospect_patient_id)
                            )
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                        -- The Einverständniserklärung for a minor carries the
                        -- Schweigepflichtsentbindung too (owner decision 2026-10-12).
                        AND (d.compliance_kind = 'confidentiality_release'
                             OR (d.compliance_kind = 'dsgvo'
                                 AND COALESCE(NULLIF(btrim(d.generated_template_id), ''), btrim(d.art))
                                     IN ('consent_data_release_child',
                                         'consent_data_release_single',
                                         'consent_data_release')))
                        AND d.signed_at IS NOT NULL
                        AND d.signed_at > COALESCE(
                            (SELECT (rp.legal_status->>'confidentiality_release_revoked_at')::timestamptz
                             FROM patients rp WHERE rp.id = leads.prospect_patient_id),
                            '-infinity'::timestamptz)
                  ) AS confidentiality_release_signed,
                  EXISTS (
                      SELECT 1 FROM documents d
                      WHERE d.lead_id = leads.id
                        AND d.generated_template_id = 'enhanced_due_diligence'
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                   ) AS enhanced_due_diligence_document_generated,
                   EXISTS (
                       SELECT 1 FROM documents d
                       WHERE d.lead_id = leads.id
                         AND d.generated_template_id = 'enhanced_due_diligence'
                         AND d.status = 'active'
                         AND d.file_deleted_at IS NULL
                         AND d.compliance_kind = 'enhanced_due_diligence'
                         AND d.signed_at IS NOT NULL
                   ) AS enhanced_due_diligence_document_signed,
                   EXISTS (
                       SELECT 1 FROM documents d
                       WHERE d.lead_id = leads.id
                         AND d.generated_template_id = 'gwg_identification'
                         AND d.status = 'active'
                         AND d.file_deleted_at IS NULL
                         -- The payer's sheet: a person's (subject "payer") or an
                         -- organisation's (the legal-entity form).
                         AND (d.generated_bindings -> 'gwg_identification' ->> 'subject' = 'payer'
                              OR d.generated_bindings -> 'gwg_identification' ->> 'form' = 'legal_entity')
                         AND d.signed_at IS NULL
                         -- A paper or QES signature is a new version of it.
                         AND NOT EXISTS (
                             SELECT 1 FROM documents n WHERE n.replaces_document_id = d.id
                         )
                         -- Only while a third party pays: a payer changed to
                         -- the patient or a parent leaves that sheet behind.
                         AND EXISTS (
                             SELECT 1 FROM lead_payer_declarations p
                             WHERE p.lead_id = leads.id AND p.payer_kind = 'third_party'
                         )
                   ) AS payer_gwg_sheet_unsigned,
                  -- A repeat intake may inherit the patient's signed framework
                  -- contract (wizard_state.framework_contract_id); that contract
                  -- and its already generated document count as done.
                  EXISTS (
                      SELECT 1 FROM framework_contracts fc
                      WHERE (
                              fc.lead_id = leads.id
                              OR (leads.prospect_patient_id IS NOT NULL
                                  AND fc.patient_id = leads.prospect_patient_id
                                  AND fc.id::text = leads.wizard_state->>'framework_contract_id')
                            )
                        AND fc.status = 'signed'
                        AND fc.signed_at IS NOT NULL
                  ) AS contract_signed,
                  (
                    EXISTS (
                      SELECT 1 FROM documents d
                      WHERE d.lead_id = leads.id
                        AND d.generated_template_id = 'framework_contract'
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                    )
                    OR EXISTS (
                      SELECT 1 FROM framework_contracts fc
                      WHERE leads.prospect_patient_id IS NOT NULL
                        AND fc.patient_id = leads.prospect_patient_id
                        AND fc.id::text = leads.wizard_state->>'framework_contract_id'
                        AND fc.status = 'signed'
                    )
                  ) AS framework_document_generated,
                  EXISTS (
                      SELECT 1 FROM orders o
                      WHERE o.source_lead_id = leads.id
                  ) AS order_exists,
                  EXISTS (
                      SELECT 1
                      FROM orders o
                      JOIN order_leistungen ol ON ol.order_id = o.id
                      WHERE o.source_lead_id = leads.id
                        AND length(trim(ol.description)) > 0
                        AND ol.quantity > 0
                        AND ol.unit_price_snapshot >= 0
                  ) AS order_service_ready,
                  EXISTS (
                      SELECT 1 FROM documents d
                      WHERE d.lead_id = leads.id
                        AND d.generated_template_id = 'single_order'
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                  ) AS order_document_generated,
                  EXISTS (
                      SELECT 1 FROM documents d
                      WHERE d.lead_id = leads.id
                        AND d.generated_template_id = 'order_cost_estimate'
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                        -- an estimate printed before the prepayment terms changed is stale
                        AND document_terms_current(d.id) IS NOT FALSE
                  ) AS order_cost_estimate_document_generated,
                  COALESCE((
                      SELECT o.signed_patient
                      FROM orders o
                      WHERE o.source_lead_id = leads.id
                      ORDER BY o.created_at DESC, o.id DESC
                      LIMIT 1
                  ), false) AS order_signed_patient,
                  COALESCE((
                      SELECT o.signed_agency
                      FROM orders o
                      WHERE o.source_lead_id = leads.id
                      ORDER BY o.created_at DESC, o.id DESC
                      LIMIT 1
                  ), false) AS order_signed_agency,
                  COALESCE((
                      -- The quote's total against the order's services as the
                      -- quote prices them (per line: net rounded to cents, VAT
                      -- of the rounded net, none on a pass-through; invoiced
                      -- and cancelled lines left out like the line check
                      -- below), not the stored `total_estimated` a wizard save
                      -- writes from its own state: a save that raced the
                      -- confirmation left a just-accepted estimate "not
                      -- matching the current order" (DEV QA 2026-10-25, F-F5).
                      SELECT q.status = 'accepted'
                             AND q.total_gross = COALESCE((
                                 SELECT sum(
                                     round(ol.quantity * ol.unit_price_snapshot, 2)
                                     + CASE WHEN ol.is_cost_passthrough THEN 0
                                            ELSE round(round(ol.quantity * ol.unit_price_snapshot, 2)
                                                       * ol.vat_rate_snapshot / 100, 2)
                                       END)
                                 FROM order_leistungen ol
                                 WHERE ol.order_id = o.id
                                   AND ol.status NOT IN ('invoiced', 'cancelled')
                             ), o.total_estimated)
                      FROM orders o
                      JOIN LATERAL (
                          SELECT status, total_gross
                          FROM quotes
                          WHERE order_id = o.id
                            AND status <> 'superseded'
                          ORDER BY created_at DESC, id DESC
                          LIMIT 1
                      ) q ON true
                      WHERE o.source_lead_id = leads.id
                      ORDER BY o.created_at DESC, o.id DESC
                      LIMIT 1
                  ), false) AS quote_accepted,
                  COALESCE((
                      SELECT q.line_items
                      FROM orders o
                      JOIN LATERAL (
                          SELECT line_items
                          FROM quotes
                          WHERE order_id = o.id
                            AND status <> 'superseded'
                          ORDER BY created_at DESC, id DESC
                          LIMIT 1
                      ) q ON true
                      WHERE o.source_lead_id = leads.id
                      ORDER BY o.created_at DESC, o.id DESC
                      LIMIT 1
                  ), '[]'::jsonb) AS quote_line_items,
                  COALESCE((
                      SELECT jsonb_agg(
                          jsonb_build_object(
                              'description', ol.description,
                              'quantity', round(ol.quantity, 4),
                              'unit_price', round(ol.unit_price_snapshot, 2),
                              'vat_rate', round(CASE
                                  WHEN ol.is_cost_passthrough THEN 0
                                  ELSE ol.vat_rate_snapshot
                              END, 2)
                          )
                          ORDER BY ol.created_at, ol.id
                      )
                      FROM order_leistungen ol
                      WHERE ol.order_id = (
                          SELECT o.id
                          FROM orders o
                          WHERE o.source_lead_id = leads.id
                          ORDER BY o.created_at DESC, o.id DESC
                          LIMIT 1
                      )
                        -- Keep readiness on the same commercial scope used by quote creation.
                        AND ol.status NOT IN ('invoiced', 'cancelled')
                  ), '[]'::jsonb) AS order_service_line_items,
                  -- Only a VKS that records the medical work types it lists counts.
                  -- Older versions may list agency services and must be recreated.
                  EXISTS (
                      SELECT 1 FROM documents d
                      WHERE d.lead_id = leads.id
                        AND d.generated_template_id = 'cost_estimate'
                        AND d.status = 'active'
                        AND d.file_deleted_at IS NULL
                        AND jsonb_typeof(d.generated_bindings -> '_cost_estimate_work_type_ids') = 'array'
                        AND d.generated_bindings -> '_cost_estimate_work_type_ids' <> '[]'::jsonb
                  ) AS cost_estimate_document_generated,
                  -- The VKS is required only once the catalog has medical work
                  -- types for one of the requested specialisations.
                  EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(
                               CASE WHEN jsonb_typeof(leads.requested_specialties) = 'array'
                                    THEN leads.requested_specialties
                                    ELSE '[]'::jsonb END
                           ) requested(value)
                      JOIN medical_specializations specialization
                        ON specialization.is_active
                       AND lower(COALESCE(requested.value ->> 'code', requested.value #>> '{}'))
                           IN (lower(specialization.code), lower(specialization.name_en))
                      JOIN medical_specialization_work_type_assignments assignment
                        ON assignment.specialization_id = specialization.id
                      JOIN medical_specialization_work_types work_type
                        ON work_type.id = assignment.work_type_id
                       AND work_type.is_active
                       AND work_type.deleted_at IS NULL
                  ) AS cost_estimate_catalog_available,
                  COALESCE((
                      SELECT CASE
                          WHEN NOT o.prepayment_required THEN true
                          ELSE COALESCE((
                              SELECT order_recorded_cash_paid(o.id) >= COALESCE(
                                         NULLIF(o.prepayment_amount, 0),
                                         q.total_gross
                                     )
                              FROM quotes q
                              WHERE q.order_id = o.id
                                AND q.status <> 'superseded'
                              ORDER BY q.created_at DESC, q.id DESC
                              LIMIT 1
                          ), false)
                      END
                      FROM orders o
                      WHERE o.source_lead_id = leads.id
                      ORDER BY o.created_at DESC, o.id DESC
                      LIMIT 1
                  ), false) AS prepayment_ready
           FROM leads
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, lead_id = %lead_id, "load lead readiness");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load lead readiness",
        )
    })?;

    let Some(row) = row else { return Ok(None) };
    let mut input = lead_conversion_readiness_input(&row);
    input.payer = super::lead_payer::load_payer_readiness(&state.db, lead_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, lead_id = %lead_id, "load lead payer readiness");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load lead readiness",
            )
        })?;
    // The enhanced check is required only by the owner's rule (2026-10-07):
    // a black-list residence or citizenship of the patient or the payer, or
    // a confirmed sanctions match — never by a PEP or the high-risk list.
    let enhanced_check_failed = |e: sqlx::Error| {
        tracing::error!(error = %e, lead_id = %lead_id, "load lead enhanced check");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load lead readiness",
        )
    };
    let mut conn = state.db.acquire().await.map_err(enhanced_check_failed)?;
    input.enhanced_due_diligence_required =
        super::lead_enhanced_check::enhanced_check_triggers(&mut conn, lead_id)
            .await
            .map_err(enhanced_check_failed)?
            .required;
    input.risk_assessment_held = crate::risk::store::readiness_held(&mut conn, lead_id)
        .await
        .map_err(enhanced_check_failed)?;
    // A minor is identified through the parents or the guardian who contract
    // (GwG subjects), not by an own identity document the child often lacks;
    // an adult keeps the signed identity document of the lead.
    if !input.identity_document_verified
        && super::lead_representatives::load(&mut conn, lead_id)
            .await
            .map_err(enhanced_check_failed)?
            .is_some_and(|loaded| loaded.minor_representatives_identified())
    {
        input.identity_document_verified = true;
    }
    // The same check the conversion makes (`convert_lead`): a release list
    // that says "ready" while the conversion would refuse is no release list.
    input.contract_details_missing =
        super::lead_representatives::contract_details_missing(&mut conn, lead_id)
            .await
            .map_err(enhanced_check_failed)?;
    drop(conn);
    input.self_disclosure = crate::lead_self_disclosure::status(&state.db, lead_id)
        .await
        .map_err(enhanced_check_failed)?;
    apply_repeat_patient_readiness(state, lead_id, &mut input).await?;
    let legal_readiness = evaluate_lead_conversion_readiness(&input);
    if !state.dev_demo_onboarding {
        return Ok(Some(legal_readiness));
    }
    let proofs = crate::document_signatures::demo_onboarding::current_documents(state, lead_id)
        .await
        .map_err(|code| {
            tracing::error!(code, %lead_id, "load DEV demo onboarding evidence");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load test signature evidence",
            )
        })?;
    for document in &proofs {
        let template: Option<String> = document
            .try_get("generated_template_id")
            .unwrap_or_default();
        match template.as_deref() {
            Some("framework_contract") if !input.contract_terminated => {
                input.contract_signed = true
            }
            Some("single_order") => {
                input.order_signed_patient = true;
                input.order_signed_agency = true;
            }
            Some("privacy_consents") => input.dsgvo_document_signed = true,
            Some("confidentiality_release") => input.confidentiality_release_signed = true,
            Some(crate::lead_self_disclosure::TEMPLATE) => input.self_disclosure.signed = true,
            Some(
                "consent_data_release_child"
                | "consent_data_release_single"
                | "consent_data_release",
            ) => {
                input.dsgvo_document_signed = true;
                input.confidentiality_release_signed = true;
            }
            Some("enhanced_due_diligence") => input.enhanced_due_diligence_document_signed = true,
            Some("cost_coverage_declaration") => {
                let payer = super::lead_payer::load_payer_state(
                    &mut *state.db.acquire().await.map_err(enhanced_check_failed)?,
                    lead_id,
                )
                .await
                .map_err(enhanced_check_failed)?;
                if payer.cost_assumption.current
                    && payer.cost_assumption.document_id == Some(document.get("id"))
                {
                    input.payer.reasons.retain(|reason| {
                        !matches!(
                            reason,
                            super::lead_payer::PayerReason::CostAssumptionUnsigned
                        )
                    });
                }
            }
            _ => {}
        }
    }
    if input.dsgvo_document_signed && input.confidentiality_release_signed && !proofs.is_empty() {
        input.compliance_status = "signed".into();
    }
    let mut readiness = evaluate_lead_conversion_readiness(&input);
    let credited_checks: Vec<Value> = readiness.payload["checks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|check| {
            check["passed"] == true
                && legal_readiness.payload["checks"]
                    .as_array()
                    .is_some_and(|checks| {
                        checks
                            .iter()
                            .any(|legal| legal["key"] == check["key"] && legal["passed"] == false)
                    })
        })
        .map(|check| check["key"].clone())
        .collect();
    let request_ids: std::collections::BTreeSet<Uuid> = proofs
        .iter()
        .map(|document| document.get("demo_request_id"))
        .collect();
    readiness.payload["legal_checks"] = legal_readiness.payload["checks"].clone();
    readiness.payload["demo_onboarding"] = json!({
        "enabled": true, "applied": !credited_checks.is_empty(),
        "credited_checks": credited_checks, "request_ids": request_ids,
    });
    Ok(Some(readiness))
}

// Reuse the patient's current confirmations and the contract selected on this
// repeat order. A signed contract covers any later order until it is terminated.
async fn apply_repeat_patient_readiness(
    state: &AppState,
    lead_id: Uuid,
    input: &mut LeadConversionReadinessInput,
) -> Result<(), axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT p.id AS patient_id, p.legal_status,
                  fc.patient_id AS contract_patient_id, fc.lead_id AS contract_lead_id,
                  fc.status AS contract_status, fc.signed_at,
                  o.package_coverage_status
           FROM leads l
           JOIN patients p ON p.id = l.prospect_patient_id
           -- The current order of the lead, as the main readiness reads it;
           -- a lead with several orders must not answer with an older one.
           LEFT JOIN LATERAL (
               SELECT o.contract_id, o.package_coverage_status
               FROM orders o
               WHERE o.source_lead_id = l.id
               ORDER BY o.created_at DESC, o.id DESC
               LIMIT 1
           ) o ON true
           LEFT JOIN framework_contracts fc ON fc.id = o.contract_id
           WHERE l.id = $1 AND l.intake_model = 'patient_first'
             AND p.lifecycle_status IN ('active', 'inactive')"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, lead_id = %lead_id, "load repeat patient document checks");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to check patient documents",
        )
    })?;
    let Some(row) = row else { return Ok(()) };
    let legal: Value = row.try_get("legal_status").unwrap_or_else(|_| json!({}));
    input.identity_document_verified |= legal["identity_verified"] == true;
    input.dsgvo_document_signed |= legal["dsgvo_signed"] == true;
    input.confidentiality_release_signed |= legal["confidentiality_release_signed"] == true;
    // A lead's compliance is "signed" once its DSGVO consent is signed. For a
    // repeat request the patient's signed consent counts the same way, also
    // when the patient was not created through the wizard (TASK-A164).
    if legal["compliance_completed"] == true || input.dsgvo_document_signed {
        input.compliance_status = "signed".to_string();
    }
    let patient_id: Uuid = row.try_get("patient_id").unwrap_or_default();
    let inherited = row
        .try_get::<Option<Uuid>, _>("contract_patient_id")
        .ok()
        .flatten()
        == Some(patient_id);
    let own_contract = row
        .try_get::<Option<Uuid>, _>("contract_lead_id")
        .ok()
        .flatten()
        == Some(lead_id);
    let signed_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("signed_at").ok().flatten();
    let contract_linked = (inherited || own_contract) && signed_at.is_some();
    // The contract has no validity period: once signed it covers this order
    // whatever its dates, unless it has been terminated since.
    let contract_status = row
        .try_get::<Option<String>, _>("contract_status")
        .ok()
        .flatten()
        .unwrap_or_default();
    input.contract_signed =
        contract_linked && super::order_intakes::contract_usable(&contract_status);
    input.contract_terminated = (inherited || own_contract) && contract_status == "terminated";
    let document_state: (bool, bool) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM documents d WHERE d.order_id=o.id AND d.generated_template_id='single_order' AND d.status='active' AND d.file_deleted_at IS NULL AND d.order_intake_context=repeat_order_document_context(o.id) AND NOT EXISTS(SELECT 1 FROM documents n WHERE n.replaces_document_id=d.id)),
                EXISTS(SELECT 1 FROM documents d WHERE d.order_id=o.id AND d.generated_template_id='order_cost_estimate' AND d.status='active' AND d.file_deleted_at IS NULL AND d.order_intake_context=repeat_order_document_context(o.id) AND document_terms_current(d.id) IS NOT FALSE AND NOT EXISTS(SELECT 1 FROM documents n WHERE n.replaces_document_id=d.id))
         FROM orders o WHERE o.source_lead_id=$1
         ORDER BY o.created_at DESC, o.id DESC LIMIT 1")
        .bind(lead_id).fetch_optional(&state.db).await
        .map_err(|_|err(StatusCode::INTERNAL_SERVER_ERROR,"Failed to check current order documents"))?.unwrap_or((false,false));
    input.order_document_generated = document_state.0;
    input.order_cost_estimate_document_generated = document_state.1;
    // A pre-existing signed framework contract does not need a new PDF for each visit.
    if inherited && input.contract_signed {
        input.framework_document_generated = true;
    }
    // Process mapping 2B: an order covered by the running package skips the
    // separate Kostenvoranschlag; overdue invoices are surfaced for attention (debt never blocks).
    input.package_covered = row
        .try_get::<Option<String>, _>("package_coverage_status")
        .ok()
        .flatten()
        .as_deref()
        == Some("covered");
    let debt =
        super::debt_management::load_patient_debt_management_state(state, patient_id).await?;
    input.debt_attention = debt.overdue_invoice_count > 0;
    input.debt_attention_reason = debt
        .payload
        .get("attention_reason")
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(())
}

async fn load_lead_lifecycle(
    state: &AppState,
    lead_id: Uuid,
    qualification_status: &str,
    failed_outcome_status: &str,
    converted_patient_id: Option<Uuid>,
    created_at: chrono::DateTime<chrono::Utc>,
    failed_processed_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, axum::response::Response> {
    let mut history =
        crate::routes::workflow_lifecycle::load_history(state, "lead", lead_id).await?;
    let current_stage = current_lead_stage(qualification_status, failed_outcome_status);

    if history.is_empty() {
        let fallback_created_at = failed_processed_at.unwrap_or(created_at);
        history.push(json!({
            "from_stage": Value::Null,
            "to_stage": current_stage,
            "transition_kind": "created",
            "note": Value::Null,
            "metadata": {},
            "changed_by": Value::Null,
            "created_at": fallback_created_at.to_rfc3339(),
        }));
    }

    Ok(json!({
        "current_stage": current_lead_stage(qualification_status, failed_outcome_status),
        "stage_entered_at": crate::routes::workflow_lifecycle::stage_entered_at(&history, &current_lead_stage(qualification_status, failed_outcome_status))
            .or_else(|| failed_processed_at.map(|value| value.to_rfc3339()))
            .or_else(|| Some(created_at.to_rfc3339())),
        "can_convert": failed_outcome_status == "none"
            && converted_patient_id.is_none()
            && qualification_status == "qualified",
        // Mirrors `resolve_failed_lead`: only a lead that has not been
        // archived or deleted yet enters the failed-lead workflow.
        "can_resolve_failed": failed_outcome_status == "none"
            && converted_patient_id.is_none(),
        "history": history,
    }))
}

fn lead_gate_err(
    message: &str,
    blocking_reasons: &[String],
    readiness: &Value,
) -> axum::response::Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({
            "error": StatusCode::UNPROCESSABLE_ENTITY
                .canonical_reason()
                .unwrap_or("error"),
            "message": message,
            "blocking_reasons": blocking_reasons,
            "readiness": readiness,
        })),
    )
        .into_response()
}

/// [`lead_gate_err`] with a `code` naming the blocker the wizard explains.
fn lead_gate_err_coded(
    code: &str,
    message: &str,
    blocking_reasons: &[String],
    readiness: &Value,
) -> axum::response::Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({
            "error": StatusCode::UNPROCESSABLE_ENTITY
                .canonical_reason()
                .unwrap_or("error"),
            "code": code,
            "message": message,
            "blocking_reasons": blocking_reasons,
            "readiness": readiness,
        })),
    )
        .into_response()
}

async fn list_repeat_intakes(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_capability(Capability::LeadsConvert)?;
    require_repeat_patient_access(&state, &auth, patient_id).await?;
    let rows = sqlx::query("SELECT id,created_at,updated_at,primary_concern_text FROM leads WHERE repeat_patient_id=$1 AND converted_patient_id IS NULL AND failed_outcome_status='none' ORDER BY updated_at DESC,id")
        .bind(patient_id).fetch_all(&state.db).await.map_err(|_|err(StatusCode::INTERNAL_SERVER_ERROR,"Failed to load repeat intakes"))?;
    Ok(Json(rows.iter().map(|row| json!({"id":row.get::<Uuid,_>("id"),"created_at":row.get::<chrono::DateTime<chrono::Utc>,_>("created_at"),"updated_at":row.get::<chrono::DateTime<chrono::Utc>,_>("updated_at"),"concern":row.get::<Option<String>,_>("primary_concern_text")})).collect()))
}

#[derive(Deserialize)]
struct PreviousRequestsQuery {
    exclude_lead_id: Option<Uuid>,
}

/// Completed earlier requests of a patient, newest first, so a repeat intake
/// can reuse a previous reason instead of retyping it. Only converted leads
/// count; abandoned drafts never became a request.
async fn list_previous_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PreviousRequestsQuery>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_capability(Capability::LeadsConvert)?;
    require_repeat_patient_access(&state, &auth, patient_id).await?;
    let rows = sqlx::query(
        "SELECT l.id, l.created_at, l.primary_concern_text, l.requested_specialties,
                o.order_number, o.date_from, o.date_to
           FROM leads l
           LEFT JOIN LATERAL (
                SELECT order_number, date_from, date_to
                  FROM orders
                 WHERE source_lead_id = l.id AND status <> 'cancelled'
                 ORDER BY created_at DESC, id
                 LIMIT 1
           ) o ON true
          WHERE (l.converted_patient_id = $1 OR l.repeat_patient_id = $1 OR l.prospect_patient_id = $1)
            AND l.id IS DISTINCT FROM $2
            AND l.qualification_status = 'converted'
            AND NULLIF(btrim(l.primary_concern_text), '') IS NOT NULL
          ORDER BY l.created_at DESC, l.id
          LIMIT 10",
    )
    .bind(patient_id)
    .bind(query.exclude_lead_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "load previous patient requests");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load previous requests",
        )
    })?;
    Ok(Json(
        rows.iter()
            .map(|row| {
                json!({
                    "id": row.get::<Uuid, _>("id"),
                    "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                    "concern": row.get::<Option<String>, _>("primary_concern_text"),
                    "specialties": row
                        .get::<Option<Value>, _>("requested_specialties")
                        .unwrap_or_else(|| json!([])),
                    "order_number": row.get::<Option<String>, _>("order_number"),
                    "date_from": row.get::<Option<NaiveDate>, _>("date_from"),
                    "date_to": row.get::<Option<NaiveDate>, _>("date_to"),
                })
            })
            .collect(),
    ))
}

/// A minor patient's repeat intake starts with the parents the patient record
/// knows: its parent and guardian relations become the trusted contacts (the
/// contracting parents of the conversion first, `patients.contracting_relation_ids`,
/// then the others), the custody stated at the conversion is the custody of
/// the request, and a parent without a patient record of their own gets the
/// name parts and address of the relation as their row. Without this the
/// request of a minor has no legal representatives, and its contracts, cost
/// estimates and the patient's own signatures are refused until staff enter
/// both parents again. Identity documents are not copied: they are checked
/// for every request. A linked parent's data come from their patient record
/// ([`crate::services::lead_guardian_identity`]). Nothing for an adult.
async fn prefill_minor_repeat_representation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let Some((birth_date, custody)) = sqlx::query_as::<_, (Option<NaiveDate>, Option<String>)>(
        "SELECT birth_date, custody FROM patients WHERE id = $1",
    )
    .bind(patient_id)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(());
    };
    if !is_minor_on(birth_date, crate::app_time::today()) {
        return Ok(());
    }
    let relations = sqlx::query(
        r#"SELECT r.id, r.related_patient_id, r.relation_type,
                  COALESCE(NULLIF(btrim(concat_ws(' ', person.first_name, person.last_name)), ''),
                           NULLIF(btrim(r.related_name), '')) AS name,
                  COALESCE(NULLIF(btrim(r.email), ''), NULLIF(btrim(person.email), '')) AS email,
                  COALESCE(NULLIF(btrim(r.phone), ''), NULLIF(btrim(person.phone_primary), '')) AS phone,
                  COALESCE(person.birth_date, r.birth_date) AS birth_date,
                  NULLIF(btrim(r.address_street), '') AS street,
                  NULLIF(btrim(r.address_zip), '') AS zip,
                  NULLIF(btrim(r.address_city), '') AS city,
                  NULLIF(btrim(r.address_country), '') AS country,
                  r.citizenships
           FROM patient_relations r
           JOIN patients child ON child.id = r.patient_id
           LEFT JOIN patients person ON person.id = r.related_patient_id
           WHERE r.patient_id = $1
             AND r.relation_type IN ('parent', 'mother', 'father', 'guardian')
           ORDER BY array_position(child.contracting_relation_ids, r.id) NULLS LAST,
                    r.is_default_payer DESC, r.created_at, r.id"#,
    )
    .bind(patient_id)
    .fetch_all(&mut **tx)
    .await?;
    let mut contacts = Vec::new();
    for relation in &relations {
        let Some(name) = relation.try_get::<Option<String>, _>("name")? else {
            continue;
        };
        let contact_id: Uuid = relation.try_get("id")?;
        let related_patient_id: Option<Uuid> = relation.try_get("related_patient_id")?;
        let street: Option<String> = relation.try_get("street")?;
        let zip: Option<String> = relation.try_get("zip")?;
        let city: Option<String> = relation.try_get("city")?;
        // The row holds an ISO code only; a country written out stays in the
        // contact's address text.
        let country = relation
            .try_get::<Option<String>, _>("country")?
            .filter(|code| code.len() == 2 && code.chars().all(|c| c.is_ascii_uppercase()));
        let address_text = [
            street.clone(),
            [zip.clone(), city.clone()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ")
                .into(),
            relation.try_get::<Option<String>, _>("country")?,
        ]
        .into_iter()
        .flatten()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ");
        contacts.push(json!({
            "id": contact_id,
            "related_patient_id": related_patient_id,
            "name": name,
            "email": relation.try_get::<Option<String>, _>("email")?,
            "phone": relation.try_get::<Option<String>, _>("phone")?,
            "relation": relation.try_get::<String, _>("relation_type")?,
            "birth_date": relation
                .try_get::<Option<NaiveDate>, _>("birth_date")?
                .map(|date| date.format("%Y-%m-%d").to_string()),
            "address": (!address_text.is_empty()).then_some(address_text),
        }));
        if related_patient_id.is_none() {
            let (first_name, last_name) =
                super::lead_representatives::name_parts(&name, None, None);
            // The citizenships the conversion kept on the relation: the
            // parents are not asked them again (owner decision 2026-10-23).
            let citizenships = repeat_representative_citizenships(
                relation.try_get::<Vec<String>, _>("citizenships")?,
            );
            sqlx::query(
                r#"INSERT INTO lead_representatives (
                       lead_id, contact_id, role, contact_origin, first_name, last_name,
                       street, zip, city, country, updated_by, citizenships)
                   VALUES ($1, $2, 'legal_representative', 'staff', $3, $4, $5, $6, $7, $8, $9, $10)
                   ON CONFLICT (lead_id, contact_id) DO NOTHING"#,
            )
            .bind(lead_id)
            .bind(contact_id)
            .bind((!first_name.is_empty()).then_some(first_name))
            .bind((!last_name.is_empty()).then_some(last_name))
            .bind(street)
            .bind(zip)
            .bind(city)
            .bind(country)
            .bind(actor)
            .bind(&citizenships)
            .execute(&mut **tx)
            .await?;
        }
    }
    if !contacts.is_empty() {
        let first = &contacts[0];
        let text = |key: &str| first.get(key).and_then(Value::as_str).map(str::to_string);
        sqlx::query(
            r#"UPDATE leads
               SET trusted_contacts = $2::jsonb,
                   trusted_contact_name = $3,
                   trusted_contact_phone = $4,
                   trusted_contact_relation = $5,
                   trusted_contact_birth_date = $6,
                   trusted_contact_address = $7,
                   trusted_contact_email = $8
               WHERE id = $1"#,
        )
        .bind(lead_id)
        .bind(Value::Array(contacts.clone()))
        .bind(text("name"))
        .bind(text("phone"))
        .bind(text("relation"))
        .bind(
            text("birth_date").and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok()),
        )
        .bind(text("address"))
        .bind(text("email"))
        .execute(&mut **tx)
        .await?;
    }
    if let Some(custody) = &custody {
        sqlx::query(
            // Taken over from the patient file: staff's, read-only in the
            // cabinet (owner decision 2026-10-22).
            r#"INSERT INTO lead_gwg_declarations (lead_id, custody, updated_by, custody_set_by_staff)
               VALUES ($1, $2, $3, true)
               ON CONFLICT (lead_id) DO NOTHING"#,
        )
        .bind(lead_id)
        .bind(custody)
        .bind(actor)
        .execute(&mut **tx)
        .await?;
    }
    audit::write_in_transaction(
        tx,
        &audit::domain_event(
            "prefill_repeat_intake_representatives",
            Some(actor),
            "lead",
            Some(lead_id),
            json!({
                "patient_id": patient_id,
                "contacts": contacts.len(),
                "custody": custody,
            }),
        ),
    )
    .await
}

/// A repeat request's GwG sheet starts with the patient's identity document
/// as GMED knows it (walk-through 2026-10-24: the sheet asked for it again):
/// the passport number and validity of the patient card, completed with the
/// type, authority, country and issue date the patient's earlier request
/// recorded for that same document. Another number on the card means another
/// document: only the card's data then. The data are checked for the request
/// as usual (an expired document is named as such); the scan is not copied.
async fn prefill_repeat_identity_document(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let source: Option<String> = sqlx::query_scalar(
        r#"WITH card AS (
               SELECT CASE WHEN char_length(btrim(passport_number)) BETWEEN 1 AND 60
                           THEN btrim(passport_number) END AS number,
                      passport_expiry AS valid_until
               FROM patients WHERE id = $2
           ), earlier AS (
               SELECT g.id_document_type, g.id_document_number, g.id_issuing_authority,
                      g.id_issuing_country, g.id_issued_on, g.id_valid_until
               FROM lead_gwg_declarations g
               JOIN leads p ON p.id = g.lead_id
               WHERE p.id <> $1
                 AND (p.converted_patient_id = $2 OR p.repeat_patient_id = $2)
                 AND (g.id_document_number IS NOT NULL OR g.id_valid_until IS NOT NULL)
               ORDER BY g.id_data_entered_at DESC NULLS LAST, g.updated_at DESC, p.created_at DESC
               LIMIT 1
           ), source AS (
               SELECT card.number, card.valid_until, earlier.*,
                      (earlier.id_document_number IS NOT NULL OR earlier.id_valid_until IS NOT NULL)
                      AND (card.number IS NULL OR earlier.id_document_number IS NULL
                           OR upper(regexp_replace(card.number, '\s', '', 'g'))
                              = upper(regexp_replace(earlier.id_document_number, '\s', '', 'g')))
                          AS same_document
               FROM card LEFT JOIN earlier ON true
           ), prefill AS (
               SELECT CASE WHEN same_document THEN COALESCE(id_document_type, CASE WHEN number IS NOT NULL THEN 'passport' END)
                           WHEN number IS NOT NULL THEN 'passport' END AS document_type,
                      COALESCE(number, CASE WHEN same_document THEN id_document_number END) AS document_number,
                      CASE WHEN same_document THEN id_issuing_authority END AS authority,
                      CASE WHEN same_document THEN id_issuing_country END AS issuing_country,
                      CASE WHEN same_document THEN id_issued_on END AS issued_on,
                      COALESCE(valid_until, CASE WHEN same_document THEN id_valid_until END) AS valid_until,
                      CASE WHEN same_document THEN 'earlier_request' ELSE 'patient_card' END AS source
               FROM source
           )
           INSERT INTO lead_gwg_declarations (
               lead_id, id_document_type, id_document_number, id_issuing_authority,
               id_issuing_country, id_issued_on, id_valid_until,
               id_data_entered_by, id_data_entered_at, updated_by)
           SELECT $1, document_type, document_number, authority, issuing_country, issued_on,
                  valid_until, $3, clock_timestamp(), $3
           FROM prefill
           WHERE document_number IS NOT NULL OR valid_until IS NOT NULL
           ON CONFLICT (lead_id) DO UPDATE SET
               id_document_type = COALESCE(lead_gwg_declarations.id_document_type, EXCLUDED.id_document_type),
               id_document_number = COALESCE(lead_gwg_declarations.id_document_number, EXCLUDED.id_document_number),
               id_issuing_authority = COALESCE(lead_gwg_declarations.id_issuing_authority, EXCLUDED.id_issuing_authority),
               id_issuing_country = COALESCE(lead_gwg_declarations.id_issuing_country, EXCLUDED.id_issuing_country),
               id_issued_on = COALESCE(lead_gwg_declarations.id_issued_on, EXCLUDED.id_issued_on),
               id_valid_until = COALESCE(lead_gwg_declarations.id_valid_until, EXCLUDED.id_valid_until),
               id_data_entered_by = COALESCE(lead_gwg_declarations.id_data_entered_by, EXCLUDED.id_data_entered_by),
               id_data_entered_at = COALESCE(lead_gwg_declarations.id_data_entered_at, EXCLUDED.id_data_entered_at)
           RETURNING (SELECT source FROM prefill)"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(actor)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(source) = source else {
        return Ok(());
    };
    audit::write_in_transaction(
        tx,
        &audit::domain_event(
            "prefill_repeat_intake_identity_document",
            Some(actor),
            "lead",
            Some(lead_id),
            json!({ "patient_id": patient_id, "source": source }),
        ),
    )
    .await
}

/// The citizenships a repeat request's representative row takes from the
/// patient relation: valid ISO codes, upper-cased, each once, in order (the
/// row's check refuses anything else).
fn repeat_representative_citizenships(stored: Vec<String>) -> Vec<String> {
    let mut codes: Vec<String> = Vec::new();
    for code in stored {
        let code = code.trim().to_ascii_uppercase();
        if crate::services::citizenships::is_country_code(&code) && !codes.contains(&code) {
            codes.push(code);
        }
    }
    codes
}

async fn create_repeat_intake(
    state: &AppState,
    auth: &AuthUser,
    patient: Uuid,
    key: Option<Uuid>,
) -> Result<Uuid, axum::response::Response> {
    auth.require_capability(Capability::LeadsConvert)?;
    require_repeat_patient_access(state, auth, patient).await?;
    let key =
        key.ok_or_else(|| err(StatusCode::UNPROCESSABLE_ENTITY, "Creation key is required"))?;
    let failed = |_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create repeat intake",
        )
    };
    let mut tx = state.db.begin().await.map_err(failed)?;
    // A patient has one active repeat-intake draft. Serializing on the patient
    // (instead of the browser request key) also protects against double clicks,
    // another browser, and two assigned managers starting the flow together.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(format!("repeat-patient:{patient}"))
        .execute(&mut *tx)
        .await
        .map_err(failed)?;
    if let Some((id, owner)) = sqlx::query_as::<_, (Uuid, Option<Uuid>)>(
        "SELECT id,repeat_patient_id FROM leads WHERE created_by=$1 AND creation_key=$2",
    )
    .bind(auth.user_id)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(failed)?
    {
        if owner != Some(patient) {
            return Err(err(
                StatusCode::CONFLICT,
                "Creation key belongs to another intake",
            ));
        }
        return Ok(id);
    }
    if let Some(id) = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT l.id
           FROM leads l
           JOIN orders o ON o.source_lead_id = l.id
           WHERE l.repeat_patient_id = $1
             AND l.converted_patient_id IS NULL
             AND l.failed_outcome_status = 'none'
             AND o.intake_state = 'draft'
             AND o.status = 'active'
           ORDER BY l.updated_at DESC, l.id
           LIMIT 1"#,
    )
    .bind(patient)
    .fetch_optional(&mut *tx)
    .await
    .map_err(failed)?
    {
        tx.commit().await.map_err(failed)?;
        return Ok(id);
    }
    // The patient file keeps the country written out ("Ukraine"); the lead
    // keeps an ISO code (DEV 2026-10-21: a name in an ISO column broke the
    // invoice recipient). A name that maps to no code is left out.
    let stored_country: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE(NULLIF(btrim(address_country), ''), NULLIF(btrim(residence_country), '')) FROM patients WHERE id = $1",
    )
    .bind(patient)
    .fetch_optional(&mut *tx)
    .await
    .map_err(failed)?
    .flatten();
    let country = lead_country_code(stored_country.as_deref());
    let id: Option<Uuid> = sqlx::query_scalar(
        // The citizenships the conversion carried to the record come back
        // (scenario test 2026-10-23: the repeat request asked them again).
        "INSERT INTO leads(first_name,last_name,email,phone,source,country,primary_language,date_of_birth,legal_sex,street_address,city,zip_code,created_by,intake_source,intake_model,creation_key,repeat_patient_id,prospect_patient_id,citizenships)
         SELECT first_name,last_name,email,phone_primary,'manual',$4::text,languages[1],birth_date,gender,address_street,address_city,address_zip,$2,'staff_wizard','patient_first',$3,id,id,citizenships
         FROM patients WHERE id=$1 AND lifecycle_status IN ('active','inactive') RETURNING id")
        .bind(patient).bind(auth.user_id).bind(key).bind(country).fetch_optional(&mut *tx).await.map_err(failed)?;
    let id = id.ok_or_else(|| {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Patient is not available for repeat intake",
        )
    })?;
    prefill_minor_repeat_representation(&mut tx, id, patient, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, lead_id = %id, patient_id = %patient, "prefill the parents of a minor's repeat intake");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create repeat intake",
            )
        })?;
    prefill_repeat_identity_document(&mut tx, id, patient, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, lead_id = %id, patient_id = %patient, "prefill the identity document of a repeat intake");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create repeat intake",
            )
        })?;
    let retention = super::patients::load_patient_clinical_retention_years(state, 30).await;
    let (case_id, _) = ensure_prospect_case(&mut tx, id, patient, auth.user_id, "", "", retention)
        .await
        .map_err(failed)?;
    let seq: i64 = sqlx::query_scalar("SELECT nextval('order_number_seq')")
        .fetch_one(&mut *tx)
        .await
        .map_err(failed)?;
    // A signed framework contract has no validity period and covers every later
    // order until it is terminated, so the repeat draft inherits the patient's
    // latest signed one; readiness then needs no new contract PDF.
    let contract_id: Option<Uuid> = sqlx::query_scalar(
        r#"INSERT INTO orders(order_number,patient_id,source_lead_id,case_id,created_by,intake_state,contract_id)
           VALUES($1,$2,$3,$4,$5,'draft',(
               SELECT fc.id FROM framework_contracts fc
               WHERE fc.patient_id = $2
                 AND fc.status = 'signed'
                 AND fc.signed_at IS NOT NULL
                 AND fc.terminated_at IS NULL
               ORDER BY fc.signed_at DESC, fc.created_at DESC, fc.id DESC
               LIMIT 1))
           RETURNING contract_id"#,
    )
    .bind(super::orders::gen_order_number(seq))
    .bind(patient)
    .bind(id)
    .bind(case_id)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(failed)?;
    sqlx::query("INSERT INTO workflow_lifecycle_events(entity_type,entity_id,to_stage,transition_kind,changed_by,metadata) VALUES('lead',$1,'new','created',$2,$3)")
        .bind(id).bind(auth.user_id).bind(json!({"intake_source":"staff_wizard","repeat_patient_id":patient})).execute(&mut *tx).await.map_err(failed)?;
    // The audit row commits with the intake (audit policy: never dropped).
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "create_repeat_intake",
            Some(auth.user_id),
            "lead",
            Some(id),
            json!({"patient_id":patient,"case_id":case_id,"inherited_contract_id":contract_id}),
        ),
    )
    .await
    .map_err(failed)?;
    tx.commit().await.map_err(failed)?;
    crate::realtime::publish_lead_event(
        state,
        Some(auth.user_id),
        "lead.created",
        id,
        json!({"intake_source":"staff_wizard","repeat_patient_id":patient}),
    )
    .await;
    Ok(id)
}

async fn create_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(mut body): Json<CreateLeadRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsEdit) {
        return e;
    }

    if let Some(patient_id) = body.repeat_patient_id {
        return match create_repeat_intake(&state, &auth, patient_id, body.creation_key).await {
            Ok(id) => (StatusCode::CREATED, Json(json!({"id": id}))).into_response(),
            Err(response) => response,
        };
    }

    // «Neue Anfrage für diese Person»: the person GMED already knows fills the
    // empty fields of the body; what the body says wins (owner decision
    // 2026-10-25). Access to the source and the own-record rule are checked
    // there (409 `existing_parent_patient_use_repeat_intake`).
    let (source_person, mut prefilled_fields) = match body.source_person {
        Some(request) => {
            let data = match super::lead_source_person::load(&state, &auth, request).await {
                Ok(data) => data,
                Err(response) => return response,
            };
            let filled = super::lead_source_person::fill_body(
                &data,
                super::lead_source_person::BodyFields {
                    first_name: &mut body.first_name,
                    last_name: &mut body.last_name,
                    date_of_birth: &mut body.date_of_birth,
                    phone: &mut body.phone,
                    email: &mut body.email,
                    country: &mut body.country,
                    citizenships: &mut body.citizenships,
                },
            );
            (Some(data), filled)
        }
        None => (None, Vec::new()),
    };

    if body.first_name.trim().is_empty() || body.last_name.trim().is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Name required");
    }
    // The names on one line and short, as in the cabinet (shared rule).
    body.first_name = crate::services::person_fields::one_line(&body.first_name);
    body.last_name = crate::services::person_fields::one_line(&body.last_name);
    if let Some(field) = new_name_too_long(&[
        ("first_name", &body.first_name, None),
        ("last_name", &body.last_name, None),
    ]) {
        return field_err(field, "Name is too long");
    }
    let date_of_birth = match body.date_of_birth.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            match NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d") {
                Ok(value) => match plausible_birth_date(value, crate::app_time::today()) {
                    Ok(value) => Some(value),
                    Err(message) => return field_err("date_of_birth", message),
                },
                Err(_) => {
                    return field_err("date_of_birth", "Invalid date_of_birth (YYYY-MM-DD)");
                }
            }
        }
        _ => None,
    };
    // Every adult manual lead gets a patient login (owner decision
    // 2026-10-03), so the address is mandatory and must not belong to another
    // account. A minor gets no login of their own — the parents get theirs
    // (QA 2026-10-06, B1-a) —, so the child's address is optional; one that
    // is given must still be valid.
    let minor = is_minor_on(date_of_birth, crate::app_time::today());
    let email_given = body
        .email
        .as_deref()
        .is_some_and(|email| !email.trim().is_empty());
    let portal_email =
        crate::routes::lead_portal_account::normalize_portal_email(body.email.as_deref());
    if portal_email.is_none() && (email_given || !minor) {
        return field_err("email", "A valid email is required");
    }
    if body.phone.as_deref().map(str::trim).is_some_and(|phone| {
        !phone.is_empty() && !crate::services::person_fields::is_valid_phone(phone)
    }) {
        return field_err("phone", "Invalid phone");
    }
    if !lead_source_known(body.source.as_deref()) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "error": "invalid_field",
                "code": "invalid_field",
                "message": "Unknown lead source",
                "field": "source",
            })),
        )
            .into_response();
    }
    // The address of the patient login: an adult's own.
    let account_email = portal_email.clone().filter(|_| !minor);

    if let Some(creation_key) = body.creation_key {
        match sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM leads WHERE created_by = $1 AND creation_key = $2",
        )
        .bind(auth.user_id)
        .bind(creation_key)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(id)) => {
                return Json(json!({"id":id,"idempotent_replay":true})).into_response();
            }
            Ok(None) => {}
            Err(error) => {
                tracing::error!(%error, "resolve lead creation key");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
            }
        }
    }

    let trusted_contacts = match body.trusted_contacts.as_deref() {
        Some(contacts) => match normalize_trusted_contacts(contacts) {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => json!([]),
    };
    // Staff may state a minor's custody with the new lead (QA 2026-10-23):
    // a child under guardianship has no parent to name first.
    let custody = match new_lead_custody(body.custody.as_deref(), minor) {
        Ok(custody) => custody,
        Err(()) => {
            return field_err(
                "custody",
                "joint, sole_parent or guardian is stated for a minor only",
            );
        }
    };
    // Every contact of a new lead is new. A guardian relation passes only
    // under the custody "guardian" stated with it; a parent does not then.
    let contacts_checked =
        if custody.as_deref() == Some(crate::routes::lead_representatives::CUSTODY_GUARDIAN) {
            match changed_trusted_contact_issue(&trusted_contacts, &json!([]), false)
                .or_else(|| parent_under_guardianship_issue(&trusted_contacts, &json!([])))
            {
                Some(issue) => Err(trusted_contact_issue_response(&issue)),
                None => Ok(()),
            }
        } else {
            check_changed_trusted_contacts(&state, None, &trusted_contacts, &json!([]), minor).await
        };
    if let Err(response) = contacts_checked {
        return response;
    }
    let citizenships = match crate::services::citizenships::normalize_citizenships(
        body.citizenships.as_deref().unwrap_or_default(),
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, "begin lead creation");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
        }
    };
    if let Some(email) = account_email.as_deref() {
        let name = format!("{} {}", body.first_name.trim(), body.last_name.trim());
        let existing = match super::lead_portal_account::existing_parent_patients_in_tx(
            &mut tx,
            email,
            &name,
            date_of_birth,
        )
        .await
        {
            Ok(patients) => patients,
            Err(error) => {
                tracing::error!(%error,"check existing parent patient before lead creation");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
            }
        };
        if !existing.is_empty() {
            drop(tx);
            let patient_id = if let [patient] = existing.as_slice() {
                match super::patients::has_patient_edit_access(&state, &auth, *patient).await {
                    Ok(true) => Some(*patient),
                    Ok(false) => None,
                    Err(response) => return response,
                }
            } else {
                None
            };
            return (StatusCode::CONFLICT,Json(json!({
                "error":"existing_parent_patient_use_repeat_intake",
                "code":"existing_parent_patient_use_repeat_intake",
                "message":"This parent already has a patient record. Open that record to activate the existing login or start a repeat intake.",
                "patient_id":patient_id,
            }))).into_response();
        }
    }
    if let Err(response) = validate_lead_contact_identity_from(
        &state,
        &LeadContactIdentity {
            lead_id: None,
            patient_ids: Vec::new(),
            first_name: body.first_name.trim(),
            last_name: body.last_name.trim(),
            date_of_birth,
            email: portal_email.as_deref(),
            phone: body.phone.as_deref(),
            guardians: &trusted_contacts,
        },
        source_person.as_ref(),
    )
    .await
    {
        return response;
    }

    let inserted = sqlx::query_as::<_, (Uuid, bool)>(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, source, country,
                notes, created_by, intake_source, creation_key, date_of_birth,
                trusted_contacts,
                -- The legacy single-contact columns mirror the first entry,
                -- as `update_lead` keeps them (older readers still use them).
                trusted_contact_name, trusted_contact_phone, trusted_contact_relation,
                trusted_contact_birth_date, trusted_contact_address, trusted_contact_email
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $9, $10, $11,
                     NULLIF($11::jsonb #>> '{0,name}', ''),
                     NULLIF($11::jsonb #>> '{0,phone}', ''),
                     NULLIF($11::jsonb #>> '{0,relation}', ''),
                     NULLIF($11::jsonb #>> '{0,birth_date}', '')::date,
                     NULLIF($11::jsonb #>> '{0,address}', ''),
                     NULLIF($11::jsonb #>> '{0,email}', ''))
           ON CONFLICT(created_by,creation_key) WHERE creation_key IS NOT NULL
           DO UPDATE SET creation_key=EXCLUDED.creation_key
           RETURNING id, (xmax = 0)"#,
    )
    .bind(body.first_name.trim())
    .bind(body.last_name.trim())
    .bind(portal_email.as_deref())
    .bind(body.phone.as_deref())
    .bind(body.source.as_deref())
    .bind(body.country.as_deref())
    .bind(body.notes.as_deref())
    .bind(auth.user_id)
    .bind(body.creation_key)
    .bind(date_of_birth)
    .bind(&trusted_contacts)
    .fetch_one(&mut *tx)
    .await;
    let (id, portal_account) = match (inserted, account_email.as_deref()) {
        (Ok((id, false)), _) => {
            return Json(json!({"id":id,"idempotent_replay":true})).into_response();
        }
        (Ok((id, true)), None) => (id, None),
        (Ok((id, true)), Some(account_email)) => {
            let name = format!("{} {}", body.first_name.trim(), body.last_name.trim());
            match crate::routes::lead_portal_account::create_for_lead_in_tx(
                &mut tx,
                id,
                account_email,
                &name,
                auth.user_id,
            )
            .await
            {
                Ok(account) => (id, Some(account)),
                Err(error) if crate::routes::lead_portal_account::is_unique_violation(&error) => {
                    drop(tx);
                    return match crate::routes::lead_portal_account::email_owner(
                        &state.db,
                        account_email,
                        None,
                    )
                    .await
                    {
                        Ok(Some(owner)) => {
                            crate::routes::lead_portal_account::email_taken_response(owner)
                        }
                        _ => err(StatusCode::CONFLICT, "Email already belongs to an account"),
                    };
                }
                Err(error) => {
                    tracing::error!(%error, lead = %id, "create lead portal account");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
                }
            }
        }
        (Err(e), _) => {
            tracing::error!(error = %e, "create lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if !citizenships.is_empty()
        && let Err(error) =
            super::lead_payer::set_lead_citizenships(&mut tx, id, &citizenships).await
    {
        tracing::error!(%error, lead = %id, "store lead citizenships");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
    }
    if let Some(custody) = custody.as_deref() {
        let stored = async {
            // Staff's statement, read-only in the cabinet (owner 2026-10-22),
            // as `POST /leads/{id}/representation` stores it.
            sqlx::query(
                r#"INSERT INTO lead_gwg_declarations (lead_id, custody, custody_set_by_staff)
                   VALUES ($1, $2, true)
                   ON CONFLICT (lead_id) DO UPDATE SET
                       custody = EXCLUDED.custody,
                       custody_set_by_staff = true"#,
            )
            .bind(id)
            .bind(custody)
            .execute(&mut *tx)
            .await?;
            audit::write_in_transaction(
                &mut tx,
                &audit::domain_event(
                    "set_lead_custody",
                    Some(auth.user_id),
                    "lead",
                    Some(id),
                    json!({ "custody": custody, "previous": null, "with_new_lead": true }),
                ),
            )
            .await
        }
        .await;
        if let Err(error) = stored {
            tracing::error!(%error, lead = %id, "store the custody of a new lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
        }
    }
    if let Some(data) = source_person.as_ref() {
        // The address and the identity block of the GwG sheet, the source on
        // the lead, and the audit row with the field names.
        match super::lead_source_person::apply_in_tx(
            &mut tx,
            id,
            data,
            std::mem::take(&mut prefilled_fields),
            auth.user_id,
        )
        .await
        {
            Ok(fields) => prefilled_fields = fields,
            Err(error) => {
                tracing::error!(%error, lead = %id, "pre-fill the lead from its source person");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
            }
        }
    }
    if let Err(error) =
        super::lead_portal_guardians::auto_link_parent_logins_in_tx(&mut tx, id, Some(auth.user_id))
            .await
    {
        tracing::error!(%error, lead = %id, "link parents' logins to the new lead");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
    }
    // The audit row commits with the lead (audit policy: never dropped).
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "create_lead",
            Some(auth.user_id),
            "lead",
            Some(id),
            json!({}),
        ),
    )
    .await
    {
        tracing::error!(%error, lead = %id, "audit lead creation");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(%error, lead = %id, "commit lead creation");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create lead");
    }
    if let Err(resp) = crate::routes::workflow_lifecycle::record_event(
        &state,
        crate::routes::workflow_lifecycle::RecordEvent {
            entity_type: "lead",
            entity_id: id,
            from_stage: None,
            to_stage: "new",
            transition_kind: "created",
            changed_by: Some(auth.user_id),
            note: None,
            metadata: json!({
                "source": body.source,
                "intake_source": "manual",
            }),
        },
    )
    .await
    {
        return resp;
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.created",
        id,
        json!({
            "source": body.source,
            "intake_source": "manual",
        }),
    )
    .await;
    tracing::info!(by = %auth.user_id, lead = %id, "Lead created manually");
    let mut response = json!({
        "id": id,
        "portal_account": portal_account.as_ref().map(|account| {
            crate::routes::lead_portal_account::new_account_payload(account, auth.role)
        }),
    });
    if let Some(data) = source_person.as_ref() {
        response["prefilled_from_source"] =
            super::lead_source_person::response_fragment(data, &prefilled_fields);
    }
    (StatusCode::CREATED, Json(response)).into_response()
}

async fn retired_repeat_patient_intake() -> axum::response::Response {
    err(
        StatusCode::GONE,
        "Repeat intake has been retired. Create a new order for the existing patient.",
    )
}

async fn get_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsView) {
        return e;
    }

    let row = match sqlx::query(
        r#"SELECT id, first_name, middle_name, last_name, suffix,
                  date_of_birth, legal_sex,
                  email, email_consent, phone, primary_phone_type, phones,
                  whatsapp_consent, whatsapp_number,
                  source, country, citizenships, street_address, city, state, zip_code,
                  primary_language, needs_interpreter,
                  location, location_detailed, wants_membership, selected_program,
                  can_travel, has_medical_records, records_in_accepted_language,
                  has_travel_documents, currently_in_treatment, has_health_risk_for_travel,
                  primary_concern_text, additional_concerns,
                  services, has_insurance, insurance_covers_germany,
                  insurance_provider, insurance_number, insurance_type,
                  trusted_contact_name, trusted_contact_phone, trusted_contact_email,
                  trusted_contact_relation,
                  trusted_contact_birth_date, trusted_contact_address, trusted_contacts,
                  preferred_location, visit_timing, message,
                  consent_automated_contact, consent_healthcare,
                  consent_opt_out, consent_privacy_practices,
                  raw_payload, intake_source, flow, locale, submitted_at,
                  console_promoted_at, console_promoted_by,
                  compliance_status, qualification_status, converted_patient_id,
                  failed_outcome_status, failed_from_status, failed_reason, failed_note,
                  failed_processed_at, failed_processed_by,
                  notes, user_agent, created_at, updated_at,
                  requested_specialties, wizard_state, status_changed_at,
                  intake_model, prospect_patient_id, referrer_patient_id,
                  repeat_patient_id, retention_warning_sent_at,
                  source_relation_id, source_contact_lead_id, source_contact_id,
                  (
                      SELECT p.patient_id FROM patients p
                      WHERE p.id = leads.repeat_patient_id
                  ) AS repeat_patient_pid,
                  (
                      SELECT p.patient_id FROM patients p
                      WHERE p.id = leads.referrer_patient_id
                  ) AS referrer_patient_pid,
                  (
                      SELECT NULLIF(concat_ws(' ', p.title, p.first_name, p.last_name), '')
                      FROM patients p
                      WHERE p.id = leads.referrer_patient_id
                  ) AS referrer_patient_name,
                  (
                      SELECT p.lifecycle_status FROM patients p
                      WHERE p.id = leads.prospect_patient_id
                  ) AS prospect_patient_lifecycle,
                  (
                      SELECT c.id FROM cases c
                      WHERE c.source_lead_id = leads.id
                      ORDER BY c.created_at DESC, c.id DESC
                      LIMIT 1
                  ) AS prospect_case_id
           FROM leads
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, "get lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let attachments = match sqlx::query(
        r#"SELECT attachment.id, attachment.file_name, attachment.content_type,
                  attachment.size_bytes, attachment.uploaded_at,
                  attachment.imported_document_id, attachment.imported_at,
                  attachment.import_refused_at, attachment.import_refusal_code,
                  imported.category, imported.art, imported.generated_template_id,
                  imported.compliance_kind
           FROM lead_attachments attachment
           LEFT JOIN documents imported ON imported.id = attachment.imported_document_id
           WHERE attachment.lead_id = $1
           ORDER BY attachment.uploaded_at ASC"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            // The central consent rule (documents.rs): Concierge and Billing
            // get no consent document, also not as the questionnaire upload
            // it was imported from.
            .filter(|r| {
                !crate::routes::documents::consent_document_closed_to_role(auth.role, r)
            })
            .map(|r| {
                json!({
                    "id": r.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "file_name": r.try_get::<String, _>("file_name").unwrap_or_default(),
                    "content_type": r.try_get::<Option<String>, _>("content_type").unwrap_or_default(),
                    "size_bytes": r.try_get::<i64, _>("size_bytes").unwrap_or(0),
                    "uploaded_at": r
                        .try_get::<chrono::DateTime<chrono::Utc>, _>("uploaded_at")
                        .map(|v| v.to_rfc3339())
                        .unwrap_or_default(),
                    "imported_document_id": r
                        .try_get::<Option<Uuid>, _>("imported_document_id")
                        .unwrap_or_default(),
                    "imported_at": r
                        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("imported_at")
                        .unwrap_or_default()
                        .map(|value| value.to_rfc3339()),
                    // A file the import refused for its content (QA
                    // 2026-10-25): staff see which one and why, instead of a
                    // questionnaire upload that never becomes a document.
                    "import_refused_at": r
                        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("import_refused_at")
                        .unwrap_or_default()
                        .map(|value| value.to_rfc3339()),
                    "import_refusal_code": r
                        .try_get::<Option<String>, _>("import_refusal_code")
                        .unwrap_or_default(),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::error!(error = %e, "load lead attachments");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let mut obj = serde_json::Map::new();
    let rfc = |v: Option<chrono::DateTime<chrono::Utc>>| {
        v.map(|dt| Value::String(dt.to_rfc3339()))
            .unwrap_or(Value::Null)
    };
    let s_req =
        |row: &sqlx::postgres::PgRow, col: &str| row.try_get::<String, _>(col).unwrap_or_default();
    let s_opt = |row: &sqlx::postgres::PgRow, col: &str| {
        row.try_get::<Option<String>, _>(col)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null)
    };
    let b_opt = |row: &sqlx::postgres::PgRow, col: &str| {
        row.try_get::<Option<bool>, _>(col)
            .ok()
            .flatten()
            .map(Value::Bool)
            .unwrap_or(Value::Null)
    };
    let b_req =
        |row: &sqlx::postgres::PgRow, col: &str| row.try_get::<bool, _>(col).unwrap_or(false);

    obj.insert(
        "id".into(),
        json!(row.try_get::<Uuid, _>("id").unwrap_or_default()),
    );
    obj.insert(
        "first_name".into(),
        Value::String(s_req(&row, "first_name")),
    );
    obj.insert("middle_name".into(), s_opt(&row, "middle_name"));
    obj.insert("last_name".into(), Value::String(s_req(&row, "last_name")));
    obj.insert("suffix".into(), s_opt(&row, "suffix"));
    obj.insert(
        "date_of_birth".into(),
        row.try_get::<Option<NaiveDate>, _>("date_of_birth")
            .ok()
            .flatten()
            .map(|d| Value::String(d.format("%Y-%m-%d").to_string()))
            .unwrap_or(Value::Null),
    );
    obj.insert("legal_sex".into(), s_opt(&row, "legal_sex"));
    obj.insert("email".into(), s_opt(&row, "email"));
    obj.insert("email_consent".into(), b_opt(&row, "email_consent"));
    obj.insert("phone".into(), s_opt(&row, "phone"));
    obj.insert(
        "primary_phone_type".into(),
        s_opt(&row, "primary_phone_type"),
    );
    obj.insert(
        "phones".into(),
        row.try_get::<Value, _>("phones").unwrap_or(Value::Null),
    );
    obj.insert("whatsapp_consent".into(), b_opt(&row, "whatsapp_consent"));
    obj.insert("whatsapp_number".into(), s_opt(&row, "whatsapp_number"));
    obj.insert("source".into(), s_opt(&row, "source"));
    obj.insert("country".into(), s_opt(&row, "country"));
    obj.insert(
        "citizenships".into(),
        json!(
            row.try_get::<Vec<String>, _>("citizenships")
                .unwrap_or_default()
        ),
    );
    obj.insert("street_address".into(), s_opt(&row, "street_address"));
    obj.insert("city".into(), s_opt(&row, "city"));
    obj.insert("state".into(), s_opt(&row, "state"));
    obj.insert("zip_code".into(), s_opt(&row, "zip_code"));
    obj.insert("primary_language".into(), s_opt(&row, "primary_language"));
    obj.insert("needs_interpreter".into(), b_opt(&row, "needs_interpreter"));
    obj.insert("location".into(), s_opt(&row, "location"));
    obj.insert("location_detailed".into(), s_opt(&row, "location_detailed"));
    obj.insert("wants_membership".into(), b_opt(&row, "wants_membership"));
    obj.insert("selected_program".into(), s_opt(&row, "selected_program"));
    obj.insert("can_travel".into(), b_opt(&row, "can_travel"));
    obj.insert(
        "has_medical_records".into(),
        s_opt(&row, "has_medical_records"),
    );
    obj.insert(
        "records_in_accepted_language".into(),
        b_opt(&row, "records_in_accepted_language"),
    );
    obj.insert(
        "has_travel_documents".into(),
        b_opt(&row, "has_travel_documents"),
    );
    obj.insert(
        "currently_in_treatment".into(),
        b_opt(&row, "currently_in_treatment"),
    );
    obj.insert(
        "has_health_risk_for_travel".into(),
        b_opt(&row, "has_health_risk_for_travel"),
    );
    obj.insert(
        "primary_concern_text".into(),
        s_opt(&row, "primary_concern_text"),
    );
    obj.insert(
        "additional_concerns".into(),
        s_opt(&row, "additional_concerns"),
    );
    obj.insert(
        "services".into(),
        json!(
            row.try_get::<Vec<String>, _>("services")
                .unwrap_or_default()
        ),
    );
    obj.insert("has_insurance".into(), b_opt(&row, "has_insurance"));
    obj.insert(
        "insurance_covers_germany".into(),
        s_opt(&row, "insurance_covers_germany"),
    );
    obj.insert(
        "insurance_provider".into(),
        s_opt(&row, "insurance_provider"),
    );
    obj.insert("insurance_number".into(), s_opt(&row, "insurance_number"));
    obj.insert("insurance_type".into(), s_opt(&row, "insurance_type"));
    obj.insert(
        "trusted_contact_name".into(),
        s_opt(&row, "trusted_contact_name"),
    );
    obj.insert(
        "trusted_contact_phone".into(),
        s_opt(&row, "trusted_contact_phone"),
    );
    obj.insert(
        "trusted_contact_email".into(),
        s_opt(&row, "trusted_contact_email"),
    );
    obj.insert(
        "trusted_contact_relation".into(),
        s_opt(&row, "trusted_contact_relation"),
    );
    obj.insert(
        "trusted_contact_birth_date".into(),
        row.try_get::<Option<NaiveDate>, _>("trusted_contact_birth_date")
            .ok()
            .flatten()
            .map(|date| Value::String(date.format("%Y-%m-%d").to_string()))
            .unwrap_or(Value::Null),
    );
    obj.insert(
        "trusted_contact_address".into(),
        s_opt(&row, "trusted_contact_address"),
    );
    let stored_trusted_contacts = row
        .try_get::<Value, _>("trusted_contacts")
        .unwrap_or_else(|_| json!([]));
    let trusted_contacts = if stored_trusted_contacts
        .as_array()
        .is_some_and(|contacts| !contacts.is_empty())
    {
        stored_trusted_contacts
    } else {
        let legacy_name = row
            .try_get::<Option<String>, _>("trusted_contact_name")
            .ok()
            .flatten()
            .and_then(|value| normalized_contact_text(Some(&value)));
        match legacy_name {
            Some(name) => json!([{
                "id": lead_id,
                "name": name,
                "email": row.try_get::<Option<String>, _>("trusted_contact_email").ok().flatten(),
                "phone": row.try_get::<Option<String>, _>("trusted_contact_phone").ok().flatten(),
                "relation": row.try_get::<Option<String>, _>("trusted_contact_relation").ok().flatten(),
                "birth_date": row
                    .try_get::<Option<NaiveDate>, _>("trusted_contact_birth_date")
                    .ok()
                    .flatten()
                    .map(|date| date.format("%Y-%m-%d").to_string()),
                "address": row.try_get::<Option<String>, _>("trusted_contact_address").ok().flatten(),
            }]),
            None => json!([]),
        }
    };
    obj.insert("trusted_contacts".into(), trusted_contacts);
    obj.insert(
        "preferred_location".into(),
        s_opt(&row, "preferred_location"),
    );
    obj.insert("visit_timing".into(), s_opt(&row, "visit_timing"));
    obj.insert("message".into(), s_opt(&row, "message"));
    obj.insert(
        "consent_automated_contact".into(),
        Value::Bool(b_req(&row, "consent_automated_contact")),
    );
    obj.insert(
        "consent_healthcare".into(),
        Value::Bool(b_req(&row, "consent_healthcare")),
    );
    obj.insert(
        "consent_opt_out".into(),
        Value::Bool(b_req(&row, "consent_opt_out")),
    );
    obj.insert(
        "consent_privacy_practices".into(),
        Value::Bool(b_req(&row, "consent_privacy_practices")),
    );
    obj.insert(
        "raw_payload".into(),
        row.try_get::<Option<Value>, _>("raw_payload")
            .ok()
            .flatten()
            .unwrap_or(Value::Null),
    );
    obj.insert("intake_source".into(), s_opt(&row, "intake_source"));
    obj.insert("flow".into(), s_opt(&row, "flow"));
    obj.insert(
        "lead_type".into(),
        Value::String(
            lead_type_from_origin(
                row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("console_promoted_at")
                    .unwrap_or_default()
                    .is_some(),
                row.try_get::<Option<String>, _>("intake_source")
                    .unwrap_or_default()
                    .as_deref(),
                row.try_get::<Option<String>, _>("source")
                    .unwrap_or_default()
                    .as_deref(),
                row.try_get::<Option<String>, _>("flow")
                    .unwrap_or_default()
                    .as_deref(),
            )
            .to_string(),
        ),
    );
    obj.insert(
        "console_promoted_at".into(),
        rfc(row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("console_promoted_at")
            .ok()
            .flatten()),
    );
    obj.insert(
        "console_promoted_by".into(),
        row.try_get::<Option<Uuid>, _>("console_promoted_by")
            .ok()
            .flatten()
            .map(|id| json!(id))
            .unwrap_or(Value::Null),
    );
    obj.insert("locale".into(), s_opt(&row, "locale"));
    obj.insert(
        "submitted_at".into(),
        rfc(row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("submitted_at")
            .ok()
            .flatten()),
    );
    obj.insert(
        "compliance_status".into(),
        Value::String(s_req(&row, "compliance_status")),
    );
    obj.insert(
        "qualification_status".into(),
        Value::String(s_req(&row, "qualification_status")),
    );
    obj.insert(
        "status_changed_at".into(),
        rfc(row
            .try_get::<chrono::DateTime<chrono::Utc>, _>("status_changed_at")
            .ok()),
    );
    obj.insert(
        "converted_patient_id".into(),
        row.try_get::<Option<Uuid>, _>("converted_patient_id")
            .ok()
            .flatten()
            .map(|id| json!(id))
            .unwrap_or(Value::Null),
    );
    obj.insert(
        "intake_model".into(),
        Value::String(
            row.try_get::<String, _>("intake_model")
                .unwrap_or_else(|_| "legacy".to_string()),
        ),
    );
    obj.insert(
        "prospect_patient_id".into(),
        row.try_get::<Option<Uuid>, _>("prospect_patient_id")
            .ok()
            .flatten()
            .map(|id| json!(id))
            .unwrap_or(Value::Null),
    );
    // A repeat intake of an existing patient. The wizard switches to its
    // repeat mode (document review, debt check, no new patient card) from
    // this field, whether the lead is opened from the patient or the leads list.
    obj.insert(
        "repeat_patient_id".into(),
        row.try_get::<Option<Uuid>, _>("repeat_patient_id")
            .ok()
            .flatten()
            .map(|id| json!(id))
            .unwrap_or(Value::Null),
    );
    obj.insert(
        "repeat_patient_pid".into(),
        s_opt(&row, "repeat_patient_pid"),
    );
    obj.insert(
        "referrer_patient_id".into(),
        row.try_get::<Option<Uuid>, _>("referrer_patient_id")
            .ok()
            .flatten()
            .map(|id| json!(id))
            .unwrap_or(Value::Null),
    );
    obj.insert(
        "referrer_patient_pid".into(),
        s_opt(&row, "referrer_patient_pid"),
    );
    obj.insert(
        "referrer_patient_name".into(),
        s_opt(&row, "referrer_patient_name"),
    );
    obj.insert(
        "prospect_patient_lifecycle".into(),
        row.try_get::<Option<String>, _>("prospect_patient_lifecycle")
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    obj.insert(
        "prospect_case_id".into(),
        row.try_get::<Option<Uuid>, _>("prospect_case_id")
            .ok()
            .flatten()
            .map(|id| json!(id))
            .unwrap_or(Value::Null),
    );
    obj.insert("notes".into(), s_opt(&row, "notes"));
    obj.insert(
        "requested_specialties".into(),
        row.try_get::<Value, _>("requested_specialties")
            .unwrap_or_else(|_| json!([])),
    );
    obj.insert(
        "wizard_state".into(),
        row.try_get::<Value, _>("wizard_state")
            .unwrap_or_else(|_| json!({})),
    );
    obj.insert("user_agent".into(), s_opt(&row, "user_agent"));
    obj.insert(
        "created_at".into(),
        rfc(row
            .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .ok()),
    );
    obj.insert(
        "updated_at".into(),
        rfc(row
            .try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
            .ok()),
    );
    // «Новая заявка для этого человека»: where the lead was pre-filled from,
    // and the child's own PEP answer about this person, read again from the
    // source (the wizard asks again while it is "yes" and the lead's own
    // answer is missing). Never copied to the lead.
    let source_id = |col: &str| row.try_get::<Option<Uuid>, _>(col).ok().flatten();
    let (source_relation_id, source_contact_lead_id, source_contact_id) = (
        source_id("source_relation_id"),
        source_id("source_contact_lead_id"),
        source_id("source_contact_id"),
    );
    obj.insert("source_relation_id".into(), json!(source_relation_id));
    obj.insert(
        "source_contact_lead_id".into(),
        json!(source_contact_lead_id),
    );
    obj.insert("source_contact_id".into(), json!(source_contact_id));
    let source_pep_hint = match super::lead_source_person::source_pep_hint(
        &state.db,
        source_relation_id,
        source_contact_lead_id,
        source_contact_id,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "load lead: source PEP hint");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load lead");
        }
    };
    obj.insert(
        "source_pep_hint".into(),
        super::lead_source_person::hint_json(source_pep_hint),
    );
    let readiness = match load_lead_conversion_readiness(&state, lead_id).await {
        Ok(Some(readiness)) => readiness,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(resp) => return resp,
    };
    let qualification_status = s_req(&row, "qualification_status");
    let failed_outcome_status = row
        .try_get::<String, _>("failed_outcome_status")
        .unwrap_or_else(|_| "none".to_string());
    let converted_patient_id = row
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .ok()
        .flatten();
    let created_at = row
        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
        .unwrap_or_else(|_| chrono::Utc::now());
    let failed_processed_at = row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("failed_processed_at")
        .unwrap_or_default();
    let lifecycle = match load_lead_lifecycle(
        &state,
        lead_id,
        &qualification_status,
        &failed_outcome_status,
        converted_patient_id,
        created_at,
        failed_processed_at,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    obj.insert("attachments".into(), Value::Array(attachments));
    obj.insert("readiness".into(), readiness.payload);
    obj.insert("failed_outcome".into(), failed_outcome_payload(&row));
    obj.insert("lifecycle".into(), lifecycle);
    let outside_purge = match leads_outside_unqualified_purge(&state.db, &[lead_id]).await {
        Ok(ids) => ids.contains(&lead_id),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "load lead: purge exceptions");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load lead");
        }
    };
    obj.insert(
        "retention_deadline_at".into(),
        lead_retention_deadline_json(
            load_unqualified_lead_retention(&state.db).await.as_ref(),
            &row,
            outside_purge,
        ),
    );

    let lead = Value::Object(obj);
    if lead_service_grid_only(&auth) {
        return Json(lead_service_grid_projection(&lead)).into_response();
    }
    if !lead_medical_visible(&auth) {
        return Json(lead_without_medical_fields(lead)).into_response();
    }
    Json(lead).into_response()
}

/// Whether the caller sees leads only as the service grid: `leads.view`
/// without `leads.edit` (the concierge). Editors, roles that may convert and
/// the CEO Assistant (reads everything, changes nothing; RBAC matrix: CEO,
/// CEO Assistant and PM see the lead fully) get the full lead.
fn lead_service_grid_only(auth: &AuthUser) -> bool {
    auth.can(Capability::LeadsView) && !super::lead_payer::may_view(auth)
}

/// Whether the caller may read what a lead says about health: the medical
/// access of patients (`patients.medical.view`). Sales works leads without it
/// and sees contact, source, status, country and language, dates and the
/// responsible person, but none of the fields in [`LEAD_MEDICAL_FIELDS`]
/// (owner decision 2026-09-28).
fn lead_medical_visible(auth: &AuthUser) -> bool {
    auth.can(Capability::PatientsMedicalView)
}

/// Lead fields with medical content: the request text, the requested
/// specialties and program, notes (mixed content, so hidden as a whole), the
/// questionnaire answers on treatment, travel risk and records, insurance, and
/// the raw questionnaire and wizard payloads (clinical intake draft).
const LEAD_MEDICAL_FIELDS: &[&str] = &[
    "primary_concern_text",
    "additional_concerns",
    "message",
    "notes",
    "selected_program",
    "currently_in_treatment",
    "has_health_risk_for_travel",
    "has_medical_records",
    "records_in_accepted_language",
    "has_insurance",
    "insurance_covers_germany",
    "insurance_provider",
    "insurance_number",
    "insurance_type",
    "raw_payload",
];

/// A lead payload without its medical content, for callers without
/// [`lead_medical_visible`]. The fields stay present as null (lists and
/// records empty) so the lead screens render; `medical_fields_hidden` tells
/// them to leave out the medical blocks.
fn lead_without_medical_fields(lead: Value) -> Value {
    let Value::Object(mut fields) = lead else {
        return lead;
    };
    for key in LEAD_MEDICAL_FIELDS {
        if fields.contains_key(*key) {
            fields.insert((*key).to_string(), Value::Null);
        }
    }
    fields.insert("requested_specialties".into(), json!([]));
    fields.insert("wizard_state".into(), json!({}));
    // Staff's words on why the lead failed may name a diagnosis (mixed
    // content, like the notes): the reason code stays, the text goes — the
    // same scrub the erasure applies.
    if let Some(outcome) = fields
        .get_mut("failed_outcome")
        .and_then(Value::as_object_mut)
    {
        if outcome.contains_key("note") {
            outcome.insert("note".into(), Value::Null);
        }
        if let Some(reason) = outcome.get("reason").and_then(Value::as_str) {
            let code = anonymised_failure_reason(reason).to_string();
            outcome.insert("reason".into(), json!(code));
        }
    }
    if let Some(history) = fields
        .get_mut("lifecycle")
        .and_then(|lifecycle| lifecycle.get_mut("history"))
        .and_then(Value::as_array_mut)
    {
        for event in history.iter_mut() {
            let transition = event["transition_kind"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let note = event["note"].as_str().map(str::to_string);
            let metadata = event["metadata"].clone();
            if let Some((next_note, next_metadata)) =
                scrubbed_lifecycle_event(&transition, note.as_deref(), &metadata)
            {
                event["note"] = json!(next_note);
                event["metadata"] = next_metadata;
            }
        }
    }
    // Questionnaire uploads are medical records; only their number stays.
    if let Some(attachments) = fields.get("attachments").and_then(Value::as_array) {
        let count = attachments.len();
        fields.insert("attachment_count".into(), json!(count));
        fields.insert("attachments".into(), json!([]));
    }
    fields.insert("medical_fields_hidden".into(), Value::Bool(true));
    Value::Object(fields)
}

/// The medical fields a lead update carries; a caller without medical access
/// may not overwrite what it cannot read.
fn lead_update_medical_fields(body: &UpdateLeadRequest) -> Vec<&'static str> {
    [
        ("notes", body.notes.is_some()),
        ("primary_concern_text", body.primary_concern_text.is_some()),
        ("additional_concerns", body.additional_concerns.is_some()),
        ("selected_program", body.selected_program.is_some()),
        ("has_medical_records", body.has_medical_records.is_some()),
        ("has_insurance", body.has_insurance.is_some()),
        (
            "insurance_covers_germany",
            body.insurance_covers_germany.is_some(),
        ),
        ("insurance_provider", body.insurance_provider.is_some()),
        ("insurance_number", body.insurance_number.is_some()),
        ("insurance_type", body.insurance_type.is_some()),
        (
            "requested_specialties",
            body.requested_specialties.is_some(),
        ),
        ("wizard_state", body.wizard_state.is_some()),
    ]
    .into_iter()
    .filter_map(|(field, sent)| sent.then_some(field))
    .collect()
}

/// Fields of a lead the service grid may show: who the lead is, where it
/// stands, when it moved, where it comes from, how to reach it and what
/// service it needs. Everything else (medical notes and concerns, insurance
/// and other finance, compliance, address, wizard and raw payloads,
/// attachments, readiness, lifecycle) stays on the server.
const LEAD_SERVICE_GRID_FIELDS: &[&str] = &[
    "id",
    "first_name",
    "last_name",
    "qualification_status",
    "status_changed_at",
    "submitted_at",
    "created_at",
    "updated_at",
    "lead_type",
    "source",
    "country",
    "city",
    "email",
    "phone",
    "primary_phone_type",
    "whatsapp_number",
    "whatsapp_consent",
    "primary_language",
    "locale",
    "needs_interpreter",
    "services",
    "preferred_location",
    "visit_timing",
    "location",
    "can_travel",
    "wants_membership",
    "repeat_patient_id",
    "attachment_count",
];

/// Projects a full lead payload (list row or detail) onto the service grid
/// fields. Dropped keys are absent, except a few the lead screens read
/// without a null check, which come back empty so the read-only grid renders.
fn lead_service_grid_projection(lead: &Value) -> Value {
    let Some(source) = lead.as_object() else {
        return Value::Null;
    };
    let mut projected = serde_json::Map::with_capacity(LEAD_SERVICE_GRID_FIELDS.len() + 8);
    for key in LEAD_SERVICE_GRID_FIELDS {
        if let Some(value) = source.get(*key) {
            projected.insert((*key).to_string(), value.clone());
        }
    }
    projected.insert("intake_source".into(), Value::Null);
    projected.insert("flow".into(), Value::Null);
    projected.insert("notes".into(), Value::Null);
    projected.insert("message".into(), Value::Null);
    projected.insert("attachments".into(), json!([]));
    projected.insert("trusted_contacts".into(), json!([]));
    projected.insert("requested_specialties".into(), json!([]));
    projected.insert("wizard_state".into(), json!({}));
    projected.insert("qualification_ready".into(), Value::Bool(false));
    projected.insert("conversion_ready".into(), Value::Bool(false));
    projected.insert(
        "readiness".into(),
        json!({
            "qualification_ready": false,
            "conversion_ready": false,
            "qualification_reasons": [],
            "blocking_reasons": [],
            "checks": [],
            "steps": [],
        }),
    );
    Value::Object(projected)
}

#[cfg(test)]
mod lead_service_grid_projection_tests {
    use super::*;

    fn full_lead() -> Value {
        json!({
            "id": "0b6a2a44-3a0f-4a67-9b5d-2ec4c4a1f9c1",
            "first_name": "Olena",
            "last_name": "Koval",
            "email": "olena@example.com",
            "phone": "+380501234567",
            "primary_phone_type": "mobile",
            "whatsapp_number": "+380501234567",
            "whatsapp_consent": true,
            "source": "Website",
            "country": "UA",
            "city": "Kyiv",
            "street_address": "Khreshchatyk 1",
            "zip_code": "01001",
            "date_of_birth": "1980-01-01",
            "legal_sex": "female",
            "primary_language": "uk",
            "locale": "ru",
            "needs_interpreter": true,
            "services": ["driver", "concierge"],
            "preferred_location": "Munich",
            "visit_timing": "asap",
            "location": "Germany",
            "can_travel": true,
            "wants_membership": false,
            "lead_type": "questionnaire",
            "intake_source": "website_wizard",
            "flow": "wizard",
            "qualification_status": "qualified",
            "compliance_status": "signed",
            "status_changed_at": "2026-09-01T10:00:00+00:00",
            "submitted_at": "2026-08-30T10:00:00+00:00",
            "created_at": "2026-08-30T10:00:00+00:00",
            "updated_at": "2026-09-01T10:00:00+00:00",
            "repeat_patient_id": null,
            "attachment_count": 2,
            "notes": "internal note",
            "message": "free text",
            "primary_concern_text": "oncology second opinion",
            "additional_concerns": "diabetes",
            "requested_specialties": ["oncology"],
            "has_medical_records": true,
            "currently_in_treatment": true,
            "has_health_risk_for_travel": false,
            "has_insurance": true,
            "insurance_covers_germany": false,
            "insurance_provider": "ACME",
            "insurance_number": "123",
            "insurance_type": "private",
            "trusted_contacts": [{ "name": "Ivan" }],
            "trusted_contact_name": "Ivan",
            "raw_payload": { "secret": true },
            "wizard_state": { "quote_total": "1200.00" },
            "readiness": { "qualification_ready": true, "conversion_ready": true, "checks": [{ "key": "quote" }] },
            "qualification_ready": true,
            "conversion_ready": true,
            "lifecycle": { "history": [] },
            "attachments": [{ "id": "a1" }],
            "failed_outcome": { "status": "none", "reason": "n/a" },
            "converted_patient_id": null,
            "prospect_patient_id": "p1",
            "referrer_patient_id": "p2",
            "console_promoted_by": "u1",
            "user_agent": "Mozilla"
        })
    }

    #[test]
    fn keeps_only_service_grid_fields() {
        let projected = lead_service_grid_projection(&full_lead());
        let projected = projected.as_object().expect("object");

        for key in LEAD_SERVICE_GRID_FIELDS {
            assert!(projected.contains_key(*key), "missing service field {key}");
        }
        assert_eq!(projected["first_name"], "Olena");
        assert_eq!(projected["qualification_status"], "qualified");
        assert_eq!(projected["lead_type"], "questionnaire");
        assert_eq!(projected["country"], "UA");
        assert_eq!(projected["services"], json!(["driver", "concierge"]));
        assert_eq!(projected["needs_interpreter"], true);

        for key in [
            "notes",
            "message",
            "primary_concern_text",
            "additional_concerns",
            "has_medical_records",
            "currently_in_treatment",
            "has_health_risk_for_travel",
            "has_insurance",
            "insurance_covers_germany",
            "insurance_provider",
            "insurance_number",
            "insurance_type",
            "street_address",
            "zip_code",
            "date_of_birth",
            "legal_sex",
            "compliance_status",
            "trusted_contact_name",
            "raw_payload",
            "lifecycle",
            "failed_outcome",
            "prospect_patient_id",
            "referrer_patient_id",
            "console_promoted_by",
            "user_agent",
            "intake_source",
            "flow",
        ] {
            let value = projected.get(key);
            assert!(
                value.is_none() || value == Some(&Value::Null),
                "{key} leaked into the service grid: {value:?}"
            );
        }
        assert_eq!(projected["wizard_state"], json!({}));
        assert_eq!(projected["requested_specialties"], json!([]));
        assert_eq!(projected["trusted_contacts"], json!([]));
        assert_eq!(projected["attachments"], json!([]));
        assert_eq!(projected["readiness"]["checks"], json!([]));
        assert_eq!(projected["readiness"]["qualification_ready"], false);
        assert_eq!(projected["conversion_ready"], false);
        assert_eq!(projected["qualification_ready"], false);
    }

    #[test]
    fn projection_of_a_non_object_is_null() {
        assert_eq!(lead_service_grid_projection(&json!([])), Value::Null);
        assert_eq!(lead_service_grid_projection(&Value::Null), Value::Null);
    }

    #[test]
    fn missing_fields_are_not_invented() {
        let projected = lead_service_grid_projection(&json!({ "id": "x", "first_name": "A" }));
        let projected = projected.as_object().expect("object");
        assert_eq!(projected["id"], "x");
        assert!(!projected.contains_key("email"));
        assert!(!projected.contains_key("services"));
    }
}

/// Whether the stored wizard state has «PEP-статус проверен» ticked
/// (`aml_enhanced_due_diligence.pepStatusChecked`); `None` for an unknown lead.
async fn lead_pep_status_checked(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT COALESCE(
                  wizard_state #> '{aml_enhanced_due_diligence,pepStatusChecked}' = 'true'::jsonb,
                  false)
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut **tx)
    .await
}

/// The audit action of a changed «PEP-статус проверен»; `None` when it did not change.
fn pep_status_audit_action(previous: bool, current: bool) -> Option<&'static str> {
    match (previous, current) {
        (false, true) => Some("lead_pep_status_checked"),
        (true, false) => Some("lead_pep_status_unchecked"),
        _ => None,
    }
}

async fn update_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<UpdateLeadRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsEdit) {
        return e;
    }
    if !lead_medical_visible(&auth) && !lead_update_medical_fields(&body).is_empty() {
        return err(
            StatusCode::FORBIDDEN,
            "Medical lead fields require medical access",
        );
    }

    let compliance_status = body.compliance_status.as_deref().map(str::to_lowercase);
    if let Some(ref value) = compliance_status
        && !is_valid_compliance_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid compliance_status",
        );
    }
    // The same values the public questionnaire stores (CHECK on the column).
    if let Some(value) = body.has_medical_records.as_deref()
        && !matches!(value, "yes" | "no" | "none")
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid has_medical_records",
        );
    }

    let legal_sex = body.legal_sex.as_deref().map(str::to_lowercase);
    if let Some(ref value) = legal_sex
        && !is_valid_legal_sex(value)
    {
        return field_err("legal_sex", "Invalid legal_sex");
    }

    let date_of_birth = match body.date_of_birth.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            match NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d") {
                Ok(value) => match plausible_birth_date(value, crate::app_time::today()) {
                    Ok(value) => Some(value),
                    Err(message) => return field_err("date_of_birth", message),
                },
                Err(_) => {
                    return field_err("date_of_birth", "Invalid date_of_birth (YYYY-MM-DD)");
                }
            }
        }
        _ => None,
    };

    let trusted_contact_birth_date_supplied = body.trusted_contact_birth_date.is_some();
    let trusted_contact_birth_date = match body.trusted_contact_birth_date.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            match NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d") {
                Ok(value) => Some(value),
                Err(_) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid trusted_contact_birth_date (YYYY-MM-DD)",
                    );
                }
            }
        }
        _ => None,
    };
    let trusted_contacts = match body.trusted_contacts.as_deref() {
        Some(contacts) => match normalize_trusted_contacts(contacts) {
            Ok(value) => Some(value),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => None,
    };
    // A representative's citizenships and birth data sent with a contact go
    // to its row in the transaction of the save (F-11, QA 2026-10-25).
    let contact_details = match (body.trusted_contacts.as_deref(), trusted_contacts.as_ref()) {
        (Some(sent), Some(normalized)) => {
            contact_details_edits(sent, normalized, body.trusted_contacts_base.as_deref())
        }
        _ => Vec::new(),
    };

    let insurance_type_supplied = body.insurance_type.is_some();
    let insurance_type = body
        .insurance_type
        .as_ref()
        .and_then(|value| value.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    if let Some(ref value) = insurance_type
        && !matches!(
            value.as_str(),
            "private" | "public" | "self_pay" | "foreign"
        )
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid insurance_type");
    }
    let insurance_covers_germany_supplied = body.insurance_covers_germany.is_some();
    let insurance_covers_germany = body
        .insurance_covers_germany
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    if let Some(ref value) = insurance_covers_germany
        && !matches!(value.as_str(), "yes" | "no" | "not_sure")
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid insurance_covers_germany",
        );
    }

    let primary_language = match body.primary_language.as_deref() {
        Some(value) if value.trim().is_empty() => Some(String::new()),
        Some(value) => match normalized_language_code(value) {
            Some(value) => Some(value.to_string()),
            None => {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid primary_language");
            }
        },
        None => None,
    };

    let first_name = match body.first_name.as_deref() {
        Some(value) if value.trim().is_empty() => {
            return field_err("first_name", "first_name cannot be empty");
        }
        Some(value) => Some(crate::services::person_fields::one_line(value)),
        None => None,
    };
    let last_name = match body.last_name.as_deref() {
        Some(value) if value.trim().is_empty() => {
            return field_err("last_name", "last_name cannot be empty");
        }
        Some(value) => Some(crate::services::person_fields::one_line(value)),
        None => None,
    };
    if let Some(ref value) = body.requested_specialties
        && !value.is_array()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "requested_specialties must be a JSON array",
        );
    }
    if let Some(ref value) = body.wizard_state
        && !value.is_object()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "wizard_state must be a JSON object",
        );
    }
    let citizenships = match body
        .citizenships
        .as_deref()
        .map(crate::services::citizenships::normalize_citizenships)
        .transpose()
    {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let referrer_patient_id_supplied = body.referrer_patient_id.is_some();
    let referrer_patient_id = match body.referrer_patient_id.as_deref() {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => match Uuid::parse_str(value.trim()) {
            Ok(id) => Some(id),
            Err(_) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid referrer_patient_id",
                );
            }
        },
        None => None,
    };
    if let Some(referrer_id) = referrer_patient_id {
        match sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM patients WHERE id = $1)")
            .bind(referrer_id)
            .fetch_one(&state.db)
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Referrer patient not found",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, referrer_patient_id = %referrer_id, "validate lead referrer patient");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }

    if body.email.is_none()
        && body.phone.is_none()
        && body.country.is_none()
        && body.primary_language.is_none()
        && body.date_of_birth.is_none()
        && body.legal_sex.is_none()
        && body.compliance_status.is_none()
        && body.consent_healthcare.is_none()
        && body.consent_privacy_practices.is_none()
        && body.notes.is_none()
        && body.first_name.is_none()
        && body.middle_name.is_none()
        && body.last_name.is_none()
        && body.suffix.is_none()
        && body.street_address.is_none()
        && body.city.is_none()
        && body.state.is_none()
        && body.zip_code.is_none()
        && body.whatsapp_number.is_none()
        && body.needs_interpreter.is_none()
        && body.primary_concern_text.is_none()
        && body.additional_concerns.is_none()
        && body.selected_program.is_none()
        && body.services.is_none()
        && body.has_medical_records.is_none()
        && body.has_insurance.is_none()
        && body.insurance_covers_germany.is_none()
        && body.insurance_provider.is_none()
        && body.insurance_number.is_none()
        && body.insurance_type.is_none()
        && body.trusted_contact_name.is_none()
        && body.trusted_contact_phone.is_none()
        && body.trusted_contact_email.is_none()
        && body.trusted_contact_relation.is_none()
        && body.trusted_contact_birth_date.is_none()
        && body.trusted_contact_address.is_none()
        && body.trusted_contacts.is_none()
        && body.requested_specialties.is_none()
        && body.wizard_state.is_none()
        && body.referrer_patient_id.is_none()
        && body.citizenships.is_none()
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "No lead changes supplied");
    }

    let current_identity = match sqlx::query(
        r#"SELECT first_name, last_name, middle_name, city, date_of_birth, email, phone,
                  trusted_contacts, repeat_patient_id, prospect_patient_id,
                  converted_patient_id, qualification_status, compliance_status,
                  portal_user_id
             FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => {
            tracing::error!(%error, %lead_id, "load lead contact identity");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate contact identity",
            );
        }
    };
    // A deleted lead was anonymised (GDPR Art. 17 / retention): writing data
    // back into it would undo the erasure. The UPDATE repeats the guard.
    if current_identity
        .try_get::<String, _>("qualification_status")
        .is_ok_and(|status| status == "deleted")
    {
        return err(
            StatusCode::CONFLICT,
            "A deleted lead is anonymised and cannot be edited",
        );
    }
    // A converted lead is frozen: the patient record is edited instead, so
    // the two do not drift (QA 2026-10-25; the wizard autosaves).
    if let Some(patient_id) = current_identity
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .ok()
        .flatten()
    {
        return lead_converted_response(patient_id);
    }
    let current_compliance_status = current_identity
        .try_get::<String, _>("compliance_status")
        .unwrap_or_default();
    let compliance_status =
        match manual_compliance_update(&current_compliance_status, compliance_status.as_deref()) {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        };
    // Names and city by the shared rule (as the cabinet), for a new or
    // changed value only.
    let stored_text = |column: &str| {
        current_identity
            .try_get::<Option<String>, _>(column)
            .ok()
            .flatten()
    };
    let (stored_first, stored_last, stored_middle) = (
        stored_text("first_name"),
        stored_text("last_name"),
        stored_text("middle_name"),
    );
    if let Some(field) = new_name_too_long(&[
        (
            "first_name",
            first_name.as_deref().unwrap_or_default(),
            first_name.as_ref().and(stored_first.as_deref()),
        ),
        (
            "last_name",
            last_name.as_deref().unwrap_or_default(),
            last_name.as_ref().and(stored_last.as_deref()),
        ),
        (
            "middle_name",
            body.middle_name.as_deref().unwrap_or_default(),
            body.middle_name.as_ref().and(stored_middle.as_deref()),
        ),
    ]) {
        return field_err(field, "Name is too long");
    }
    if new_city_too_long(body.city.as_deref(), stored_text("city").as_deref()) {
        return field_err("city", "City is too long");
    }
    let effective_first_name = first_name
        .clone()
        .unwrap_or_else(|| current_identity.get::<String, _>("first_name"));
    let effective_last_name = last_name
        .clone()
        .unwrap_or_else(|| current_identity.get::<String, _>("last_name"));
    // Uniqueness is checked only for a contact the request changes to a new
    // value. Data already stored (e.g. an earlier duplicate) must not block
    // unrelated edits such as trusted contacts.
    let current_email = current_identity.get::<Option<String>, _>("email");
    let current_phone = current_identity.get::<Option<String>, _>("phone");
    // A blank address or number is no value: like the create path, which
    // stores none, it is neither validated nor written, so the stored value
    // stays (a `COALESCE` with "" would store the empty string).
    let blank_is_none = |value: Option<&str>| {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let email_sent = blank_is_none(body.email.as_deref());
    let phone_sent = blank_is_none(body.phone.as_deref());
    let changed_email = email_sent.clone().filter(|email| {
        normalized_identity_email(Some(email))
            != normalized_identity_email(current_email.as_deref())
    });
    let changed_phone = phone_sent.clone().filter(|phone| {
        normalized_identity_phone(Some(phone))
            != normalized_identity_phone(current_phone.as_deref())
    });
    // A changed address or number must be usable (the wizard checks the same);
    // an older stored value does not block unrelated edits. "Changed" compares
    // the text as typed: an unusable value has no normalized identity form
    // (e.g. "abc" as a phone), so the identity comparison above would take it
    // for an empty stored value.
    let typed_change = |value: Option<&'_ str>, current: Option<&'_ str>| -> bool {
        value
            .map(str::trim)
            .is_some_and(|value| !value.is_empty() && Some(value) != current.map(str::trim))
    };
    if typed_change(body.email.as_deref(), current_email.as_deref())
        && let Some(email) = body.email.as_deref().map(str::trim)
    {
        if !crate::email_address::has_valid_format(email) {
            return field_err("email", "Invalid email");
        }
        // A dead domain on a changed address is refused with its own code so
        // the wizard says "the domain accepts no mail" at the field.
        if let Some(domain) =
            crate::email_address::no_mail_domain_of_change(current_email.as_deref(), email)
        {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({
                    "error": crate::email_address::EMAIL_DOMAIN_NO_MAIL,
                    "code": crate::email_address::EMAIL_DOMAIN_NO_MAIL,
                    "message": "The domain of this e-mail address accepts no mail",
                    "field": "email",
                    "domain": domain,
                })),
            )
                .into_response();
        }
    }
    if typed_change(body.phone.as_deref(), current_phone.as_deref())
        && body
            .phone
            .as_deref()
            .is_some_and(|phone| !crate::services::person_fields::is_valid_phone(phone))
    {
        return field_err("phone", "Invalid phone");
    }
    let effective_birth_date = date_of_birth.or_else(|| {
        current_identity
            .try_get::<Option<NaiveDate>, _>("date_of_birth")
            .unwrap_or_default()
    });
    let current_guardians: Value = current_identity
        .try_get("trusted_contacts")
        .unwrap_or_else(|_| json!([]));
    let effective_guardians = trusted_contacts.as_ref().unwrap_or(&current_guardians);
    // A new or changed contact is checked; stored entries stay as they are.
    if let Some(contacts) = trusted_contacts.as_ref()
        && let Err(response) = check_changed_trusted_contacts(
            &state,
            Some(lead_id),
            contacts,
            &current_guardians,
            is_minor_on(effective_birth_date, crate::app_time::today()),
        )
        .await
    {
        return response;
    }
    let patient_ids = [
        current_identity
            .try_get::<Option<Uuid>, _>("repeat_patient_id")
            .unwrap_or_default(),
        current_identity
            .try_get::<Option<Uuid>, _>("prospect_patient_id")
            .unwrap_or_default(),
        current_identity
            .try_get::<Option<Uuid>, _>("converted_patient_id")
            .unwrap_or_default(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if let Err(response) = validate_lead_contact_identity(
        &state,
        &LeadContactIdentity {
            lead_id: Some(lead_id),
            patient_ids,
            first_name: &effective_first_name,
            last_name: &effective_last_name,
            date_of_birth: effective_birth_date,
            email: changed_email.as_deref(),
            phone: changed_phone.as_deref(),
            guardians: effective_guardians,
        },
    )
    .await
    {
        return response;
    }
    // A lead with a patient login keeps a usable, unique login address.
    let portal_user_id: Option<Uuid> = current_identity
        .try_get("portal_user_id")
        .unwrap_or_default();
    let portal_email = match (portal_user_id, changed_email.as_deref()) {
        (Some(portal_user_id), Some(email)) => {
            let Some(email) =
                crate::routes::lead_portal_account::normalize_portal_email(Some(email))
            else {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "A valid email is required: it is the patient's login",
                );
            };
            match crate::routes::lead_portal_account::email_owner(
                &state.db,
                &email,
                Some(portal_user_id),
            )
            .await
            {
                Ok(None) => Some(email),
                Ok(Some(owner)) => {
                    return crate::routes::lead_portal_account::email_taken_response(owner);
                }
                Err(error) => {
                    tracing::error!(%error, lead_id = %lead_id, "check lead portal email");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            }
        }
        _ => None,
    };
    // The bindings below take the names by value.
    let name_supplied = first_name.is_some() || last_name.is_some();

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "begin lead update");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let compliance_changed = compliance_status
        .as_deref()
        .is_some_and(|value| value != current_compliance_status);
    // The wizard sends the whole list of trusted contacts. A contact the lead
    // added to in the cabinet (it has a `lead_representatives` row) or with an
    // open parent's access stays even when the list was loaded before and
    // does not name it, and with the loaded list (`trusted_contacts_base`)
    // what staff left as loaded keeps the stored value; the lead row is
    // locked from here, so the list and the write are one step. A base that
    // does not normalize is no base (the save works as before).
    let trusted_contacts_base = body
        .trusted_contacts_base
        .as_deref()
        .and_then(|base| normalize_trusted_contacts(base).ok());
    let trusted_contacts = match trusted_contacts {
        Some(incoming) => {
            match super::lead_representatives::keep_represented_contacts(
                &mut tx,
                lead_id,
                incoming,
                trusted_contacts_base.as_ref(),
            )
            .await
            {
                Ok(contacts) => Some(contacts),
                Err(error) => {
                    tracing::error!(%error, lead_id = %lead_id, "keep represented trusted contacts");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            }
        }
        None => None,
    };
    let representative_changed = trusted_contacts
        .as_ref()
        .is_some_and(|contacts| *contacts != current_guardians);
    // «PEP-статус проверен» lives in the wizard state: its change is audited
    // as an action of its own (GwG traceability), so the stored value before
    // the update is read in the same transaction.
    let previous_pep_status_checked = if body.wizard_state.is_some() {
        match lead_pep_status_checked(&mut tx, lead_id).await {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, lead_id = %lead_id, "read lead PEP check");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    } else {
        None
    };
    // Staff's PEP review per person (owner decision 2026-10-23): the day and
    // the reviewer of each review are the server's, set when staff change it.
    let (wizard_state, changed_pep_reviews) = match body.wizard_state.clone() {
        Some(mut next) => {
            let (previous_aml, reviewer_name) =
                match sqlx::query_as::<_, (Option<Value>, Option<String>)>(
                    r#"SELECT (SELECT wizard_state -> 'aml_enhanced_due_diligence'
                               FROM leads WHERE id = $1),
                              (SELECT name FROM users WHERE id = $2)"#,
                )
                .bind(lead_id)
                .bind(auth.user_id)
                .fetch_one(&mut *tx)
                .await
                {
                    Ok(row) => row,
                    Err(e) => {
                        tracing::error!(error = %e, lead_id = %lead_id, "read lead PEP reviews");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                };
            let changed = match next.get_mut("aml_enhanced_due_diligence") {
                Some(aml) if aml.is_object() => crate::services::pep_review::stamp_reviews(
                    previous_aml.as_ref().unwrap_or(&Value::Null),
                    aml,
                    crate::app_time::today(),
                    reviewer_name.as_deref().unwrap_or_default(),
                ),
                _ => Vec::new(),
            };
            (Some(next), changed)
        }
        None => (None, Vec::new()),
    };
    let update_result = sqlx::query(
        r#"UPDATE leads
           SET email = COALESCE($2, email),
               phone = COALESCE($3, phone),
               country = COALESCE($4, country),
               primary_language = COALESCE($5, primary_language),
               date_of_birth = COALESCE($6, date_of_birth),
               legal_sex = COALESCE($7, legal_sex),
               compliance_status = COALESCE($8, compliance_status),
               consent_healthcare = COALESCE($9, consent_healthcare),
               consent_privacy_practices = COALESCE($10, consent_privacy_practices),
               notes = COALESCE($11, notes),
               first_name = COALESCE($12, first_name),
               last_name = COALESCE($13, last_name),
               street_address = COALESCE($14, street_address),
               city = COALESCE($15, city),
               zip_code = COALESCE($16, zip_code),
               needs_interpreter = COALESCE($17, needs_interpreter),
               primary_concern_text = COALESCE($18, primary_concern_text),
               additional_concerns = COALESCE($19, additional_concerns),
               selected_program = COALESCE($20, selected_program),
               services = COALESCE($21, services),
               requested_specialties = COALESCE($22::jsonb, requested_specialties),
               wizard_state = COALESCE($23::jsonb, wizard_state),
               middle_name = COALESCE($24, middle_name),
               suffix = COALESCE($25, suffix),
               state = COALESCE($26, state),
               whatsapp_number = COALESCE($27, whatsapp_number),
               insurance_provider = COALESCE($28, insurance_provider),
               insurance_number = COALESCE($29, insurance_number),
               insurance_type = CASE WHEN $46 THEN $30 ELSE insurance_type END,
               trusted_contact_name = CASE
                   WHEN $41::jsonb IS NOT NULL THEN NULLIF($41::jsonb #>> '{0,name}', '')
                   ELSE COALESCE($31, trusted_contact_name)
               END,
               trusted_contact_phone = CASE
                   WHEN $41::jsonb IS NOT NULL THEN NULLIF($41::jsonb #>> '{0,phone}', '')
                   ELSE COALESCE($32, trusted_contact_phone)
               END,
               trusted_contact_relation = CASE
                   WHEN $41::jsonb IS NOT NULL THEN NULLIF($41::jsonb #>> '{0,relation}', '')
                   ELSE COALESCE($33, trusted_contact_relation)
               END,
               trusted_contact_birth_date = CASE
                   WHEN $41::jsonb IS NOT NULL THEN NULLIF($41::jsonb #>> '{0,birth_date}', '')::date
                   WHEN $34 THEN $35
                   ELSE trusted_contact_birth_date
               END,
               trusted_contact_address = CASE
                   WHEN $41::jsonb IS NOT NULL THEN NULLIF($41::jsonb #>> '{0,address}', '')
                   ELSE COALESCE($36, trusted_contact_address)
               END,
               trusted_contact_email = CASE
                   WHEN $41::jsonb IS NOT NULL THEN NULLIF($41::jsonb #>> '{0,email}', '')
                   ELSE COALESCE($37, trusted_contact_email)
               END,
               has_insurance = CASE WHEN $45 THEN $38 ELSE has_insurance END,
               insurance_covers_germany = CASE
                   WHEN $39 THEN $40
                   ELSE insurance_covers_germany
               END,
               trusted_contacts = COALESCE($41::jsonb, trusted_contacts),
               referrer_patient_id = CASE
                   WHEN $42 THEN $43
                   ELSE referrer_patient_id
               END,
               has_medical_records = COALESCE($44, has_medical_records)
           WHERE id = $1 AND qualification_status <> 'deleted'"#,
    )
    .bind(lead_id)
    .bind(email_sent.as_deref())
    .bind(phone_sent.as_deref())
    .bind(body.country.as_deref())
    .bind(primary_language.as_deref())
    .bind(date_of_birth)
    .bind(legal_sex)
    .bind(compliance_status.as_deref())
    .bind(body.consent_healthcare)
    .bind(body.consent_privacy_practices)
    .bind(body.notes.as_deref())
    .bind(first_name)
    .bind(last_name)
    .bind(body.street_address.as_deref())
    .bind(body.city.as_deref())
    .bind(body.zip_code.as_deref())
    .bind(body.needs_interpreter)
    .bind(body.primary_concern_text.as_deref())
    .bind(body.additional_concerns.as_deref())
    .bind(body.selected_program.as_deref())
    .bind(body.services.as_deref())
    .bind(
        body.requested_specialties
            .as_ref()
            .map(|value| value.to_string()),
    )
    .bind(wizard_state.as_ref().map(|value| value.to_string()))
    .bind(body.middle_name.as_deref().map(str::trim))
    .bind(body.suffix.as_deref().map(str::trim))
    .bind(body.state.as_deref().map(str::trim))
    .bind(body.whatsapp_number.as_deref().map(str::trim))
    .bind(body.insurance_provider.as_deref().map(str::trim))
    .bind(body.insurance_number.as_deref().map(str::trim))
    .bind(insurance_type.as_deref())
    .bind(body.trusted_contact_name.as_deref().map(str::trim))
    .bind(body.trusted_contact_phone.as_deref().map(str::trim))
    .bind(body.trusted_contact_relation.as_deref().map(str::trim))
    .bind(trusted_contact_birth_date_supplied)
    .bind(trusted_contact_birth_date)
    .bind(body.trusted_contact_address.as_deref().map(str::trim))
    .bind(body.trusted_contact_email.as_deref().map(str::trim))
    .bind(body.has_insurance.flatten())
    .bind(insurance_covers_germany_supplied)
    .bind(insurance_covers_germany.as_deref())
    .bind(trusted_contacts.as_ref().map(Value::to_string))
    .bind(referrer_patient_id_supplied)
    .bind(referrer_patient_id)
    .bind(body.has_medical_records.as_deref())
    .bind(body.has_insurance.is_some())
    .bind(insurance_type_supplied)
    .execute(&mut *tx)
    .await;
    match update_result {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "update lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    // A contact whose relation is no longer parent / guardian keeps no
    // parent's access to the request: ended here, in the transaction of the
    // save, like a custody change ends it.
    let revoked_guardian_access = if trusted_contacts.is_some() {
        match super::lead_representatives::revoke_access_of_former_guardians(
            &mut tx,
            lead_id,
            auth.user_id,
        )
        .await
        {
            Ok(revoked) => revoked,
            Err(error) => {
                tracing::error!(%error, lead_id = %lead_id, "end access of former guardians");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    } else {
        Vec::new()
    };
    // The representatives' rows follow the saved entries (a renamed parent's
    // name), and take the citizenships and birth data sent with a contact; a
    // refused key refuses the save, naming the contact and the key (F-11).
    let representative_details_changed = if trusted_contacts.is_some() {
        match super::lead_representatives::sync_wizard_contacts(
            &mut tx,
            lead_id,
            &contact_details,
            auth.user_id,
        )
        .await
        {
            Ok(Ok(changed)) => changed,
            Ok(Err(response)) => return response,
            Err(error) => {
                tracing::error!(%error, lead_id = %lead_id, "sync representatives with contacts");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    } else {
        false
    };
    let previous_citizenships = match citizenships.as_deref() {
        Some(codes) => {
            match super::lead_payer::set_lead_citizenships(&mut tx, lead_id, codes).await {
                Ok(previous) => Some(previous),
                Err(error) => {
                    tracing::error!(%error, lead_id = %lead_id, "update lead citizenships");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            }
        }
        None => None,
    };
    if let Some(email) = portal_email.as_deref() {
        match crate::routes::lead_portal_account::sync_email_in_tx(&mut tx, lead_id, email).await {
            Ok(_) => {}
            Err(error) if crate::routes::lead_portal_account::is_unique_violation(&error) => {
                return err(StatusCode::CONFLICT, "Email already belongs to an account");
            }
            Err(error) => {
                tracing::error!(%error, lead_id = %lead_id, "sync lead portal email");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }
    // The login carries the lead's name: a renamed lead is renamed in the
    // cabinet's account page and in Users & Roles in the same step. Saving the
    // name again also brings a login that drifted earlier into line.
    let renamed_login = if name_supplied {
        match crate::routes::lead_portal_account::sync_name_in_tx(&mut tx, lead_id).await {
            Ok(synced) => synced,
            Err(error) => {
                tracing::error!(%error, lead_id = %lead_id, "sync lead portal name");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    } else {
        None
    };
    // A parent's or representative's login carries the contact's name too:
    // a contact renamed in the wizard renames its login (QA 2026-10-25).
    let renamed_guardian_logins = match trusted_contacts.as_ref() {
        Some(contacts) => {
            let renames = renamed_trusted_contacts(&current_guardians, contacts);
            if renames.is_empty() {
                Vec::new()
            } else {
                match crate::routes::lead_portal_account::sync_guardian_names_in_tx(
                    &mut tx, lead_id, &renames,
                )
                .await
                {
                    Ok(renamed) => renamed,
                    Err(error) => {
                        tracing::error!(%error, lead_id = %lead_id, "sync guardian login names");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                }
            }
        }
        None => Vec::new(),
    };
    // The audit row commits with the change (a compliance change is a status
    // change of the lead). Personal data are named, never copied: the
    // append-only log outlives the lead's anonymisation (audit policy).
    let mut identity_fields: Vec<&str> = Vec::new();
    if body.date_of_birth.is_some() {
        identity_fields.push("date_of_birth");
    }
    if body.legal_sex.is_some() {
        identity_fields.push("legal_sex");
    }
    if previous_citizenships
        .as_ref()
        .is_some_and(|previous| citizenships.as_ref() != Some(previous))
    {
        identity_fields.push("citizenships");
    }
    let mut audit_context = json!({
        "compliance_status": compliance_status,
        "identity_fields": identity_fields,
        "contact_updated": email_sent.is_some() || phone_sent.is_some(),
        "trusted_contacts_count": body.trusted_contacts.as_ref().map(Vec::len),
        "consent_healthcare": body.consent_healthcare,
        "consent_privacy_practices": body.consent_privacy_practices,
        "referrer_patient_id": referrer_patient_id,
        // Access ids only; the revocation itself is audited by the helper.
        "guardian_access_revoked": revoked_guardian_access,
    });
    if compliance_changed {
        audit_context["previous_compliance_status"] = json!(current_compliance_status);
    }
    if renamed_login.is_some() {
        audit_context["portal_name_synced"] = json!(true);
    }
    if let Err(e) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "update_lead",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            audit_context,
        ),
    )
    .await
    {
        tracing::error!(error = %e, lead_id = %lead_id, "audit lead update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Some(previous) = previous_pep_status_checked {
        let current = match lead_pep_status_checked(&mut tx, lead_id).await {
            Ok(value) => value.unwrap_or(false),
            Err(e) => {
                tracing::error!(error = %e, lead_id = %lead_id, "read lead PEP check");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if let Some(action) = pep_status_audit_action(previous, current)
            && let Err(e) = audit::write_in_transaction(
                &mut tx,
                &audit::domain_event(
                    action,
                    Some(auth.user_id),
                    "lead",
                    Some(lead_id),
                    // Who and when are the row's own; no personal data.
                    json!({ "lead_id": lead_id, "pep_status_checked": current }),
                ),
            )
            .await
        {
            tracing::error!(error = %e, lead_id = %lead_id, "audit lead PEP check");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    // A representative's or the payer's PEP review, audited per subject; the
    // patient's PEP conclusion as its own event (owner 2026-10-23).
    for change in &changed_pep_reviews {
        if let Err(e) = audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                change.audit_action(),
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                // The subject is a role or a contact id; no personal data.
                json!({
                    "lead_id": lead_id,
                    "subject": change.subject,
                    "pep_status_checked": change.checked,
                    "is_pep": change.is_pep,
                }),
            ),
        )
        .await
        {
            tracing::error!(error = %e, lead_id = %lead_id, "audit lead PEP review");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    // Who acts for the lead, their names and countries decide the country
    // triggers of the representatives: the assessment follows in the same
    // transaction, as after the cabinet's change (F-11, QA 2026-10-25).
    if (representative_changed || representative_details_changed)
        && let Err(error) = crate::risk::store::reassess(
            &mut tx,
            lead_id,
            crate::risk::store::Cause::Staff,
            Some(auth.user_id),
        )
        .await
    {
        tracing::error!(%error, %lead_id, "reassess risk after contacts");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let representative_invites = if representative_changed || representative_details_changed {
        match crate::document_signatures::invalidate_representative_identity(
            &mut tx,
            lead_id,
            auth.user_id,
        )
        .await
        {
            Ok((_, remote)) => remote,
            Err(error) => {
                tracing::error!(%error, %lead_id, "invalidate representative invitation");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    } else {
        Vec::new()
    };
    // A parent who already has a patient login gets the request at once
    // (owner decision 2026-10-19).
    if let Err(error) = super::lead_portal_guardians::auto_link_parent_logins_in_tx(
        &mut tx,
        lead_id,
        Some(auth.user_id),
    )
    .await
    {
        tracing::error!(%error, %lead_id, "link parents' logins after lead update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, lead_id = %lead_id, "commit lead update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    crate::document_signatures::withdraw_invalidated_consents(&state, &representative_invites)
        .await;
    if !revoked_guardian_access.is_empty() {
        super::lead_representatives::notify_custody_access_ended(&state, lead_id).await;
    }
    // Open pages show the new name at once: Users & Roles reloads its list and
    // the lead's cabinet reloads the profile.
    if let Some(user_id) = renamed_login {
        crate::realtime::publish_user_profile_event(
            &state,
            Some(auth.user_id),
            user_id,
            json!({ "change": "name", "source": "lead", "lead_id": lead_id }),
        )
        .await;
    }
    for user_id in renamed_guardian_logins {
        crate::realtime::publish_user_profile_event(
            &state,
            Some(auth.user_id),
            user_id,
            json!({ "change": "name", "source": "lead_trusted_contact", "lead_id": lead_id }),
        )
        .await;
    }

    let readiness = match load_lead_conversion_readiness(&state, lead_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(resp) => return resp,
    };
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.updated",
        lead_id,
        // Concierge receives this event but not the lead's date of birth or
        // sex (service grid projection): the fields are named only.
        json!({
            "compliance_status": compliance_status,
            "identity_fields": identity_fields,
            "contact_updated": email_sent.is_some() || phone_sent.is_some(),
            "trusted_contacts_count": body.trusted_contacts.as_ref().map(Vec::len),
            "consent_healthcare": body.consent_healthcare,
            "consent_privacy_practices": body.consent_privacy_practices,
            "referrer_patient_id": referrer_patient_id,
        }),
    )
    .await;

    Json(json!({
        "ok": true,
        "readiness": readiness.payload,
    }))
    .into_response()
}

async fn promote_lead_to_console(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsEdit) {
        return e;
    }

    let current = match sqlx::query(
        r#"SELECT intake_source, source, flow, qualification_status,
                  failed_outcome_status, converted_patient_id, console_promoted_at
           FROM leads
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "load lead before console promotion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let failed_outcome_status = current
        .try_get::<String, _>("failed_outcome_status")
        .unwrap_or_else(|_| "none".to_string());
    if failed_outcome_status == "delete_anonymized" {
        return err(
            StatusCode::CONFLICT,
            "Deleted leads cannot be promoted to console",
        );
    }

    if let Some(patient_id) = current
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .unwrap_or_default()
    {
        return lead_converted_response(patient_id);
    }

    let previous_type = lead_type_from_origin(
        current
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("console_promoted_at")
            .unwrap_or_default()
            .is_some(),
        current
            .try_get::<Option<String>, _>("intake_source")
            .unwrap_or_default()
            .as_deref(),
        current
            .try_get::<Option<String>, _>("source")
            .unwrap_or_default()
            .as_deref(),
        current
            .try_get::<Option<String>, _>("flow")
            .unwrap_or_default()
            .as_deref(),
    );

    // The audit row commits with the promotion (never dropped on a full
    // channel, never written for a failed update).
    let promoted = async {
        let mut tx = state.db.begin().await?;
        let result = sqlx::query(
            r#"UPDATE leads
               SET console_promoted_at = COALESCE(console_promoted_at, now()),
                   console_promoted_by = COALESCE(console_promoted_by, $2),
                   created_by = COALESCE(created_by, $2),
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(lead_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Ok(false);
        }
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "promote_lead_to_console",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({
                    "previous_lead_type": previous_type,
                    "lead_type": "console",
                }),
            ),
        )
        .await?;
        tx.commit().await?;
        Ok::<bool, sqlx::Error>(true)
    }
    .await;
    match promoted {
        Ok(true) => {
            let qualification_status = current
                .try_get::<String, _>("qualification_status")
                .unwrap_or_else(|_| "new".to_string());
            if let Err(resp) = crate::routes::workflow_lifecycle::record_event(
                &state,
                crate::routes::workflow_lifecycle::RecordEvent {
                    entity_type: "lead",
                    entity_id: lead_id,
                    from_stage: Some(&qualification_status),
                    to_stage: &qualification_status,
                    transition_kind: "promoted_to_console",
                    changed_by: Some(auth.user_id),
                    note: Some("Lead promoted into console workflow"),
                    metadata: json!({
                        "previous_lead_type": previous_type,
                        "lead_type": "console",
                    }),
                },
            )
            .await
            {
                return resp;
            }

            crate::realtime::publish_lead_event(
                &state,
                Some(auth.user_id),
                "lead.promoted_to_console",
                lead_id,
                json!({
                    "previous_lead_type": previous_type,
                    "lead_type": "console",
                }),
            )
            .await;

            Json(json!({
                "ok": true,
                "lead_type": "console",
            }))
            .into_response()
        }
        Ok(false) => err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "promote lead to console");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn qualify_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<QualifyRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsEdit) {
        return e;
    }

    match body.status.as_str() {
        "new" | "in_progress" | "qualified" | "not_qualified" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status"),
    }
    let not_qualified_reason = if body.status == "not_qualified" {
        body.reason
            .as_deref()
            .map(|reason| reason.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|reason| !reason.is_empty())
    } else {
        None
    };
    if not_qualified_reason
        .as_ref()
        .is_some_and(|reason| reason.chars().count() > NOT_QUALIFIED_REASON_MAX_CHARS)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Reason is too long");
    }

    let current = match sqlx::query(
        r#"SELECT qualification_status, converted_patient_id, failed_outcome_status
           FROM leads
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "load lead before qualify");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let current_status: String = current.try_get("qualification_status").unwrap_or_default();
    let converted_patient_id: Option<Uuid> =
        current.try_get("converted_patient_id").unwrap_or_default();
    let failed_outcome_status: String = current
        .try_get("failed_outcome_status")
        .unwrap_or_else(|_| "none".to_string());

    if let Some(patient_id) = converted_patient_id {
        return lead_converted_response(patient_id);
    }
    if failed_outcome_status == "delete_anonymized" {
        return err(
            StatusCode::CONFLICT,
            "Lead payload is already deleted via failed-lead workflow",
        );
    }
    if !lead_status_transition_allowed(&current_status, &body.status) {
        return err(StatusCode::CONFLICT, "Status transition is not allowed");
    }

    if body.status == "qualified" {
        let readiness = match load_lead_conversion_readiness(&state, lead_id).await {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
            Err(resp) => return resp,
        };
        if !readiness.qualification_ready {
            return lead_gate_err(
                "Lead is not qualification-ready",
                &readiness.qualification_reasons,
                &readiness.payload,
            );
        }
    }

    // Returning an archived lead to work reopens the order its archiving
    // withdrew, in the same transaction as the status change.
    let restores_archived_lead = failed_outcome_status == "archived"
        && matches!(body.status.as_str(), "new" | "in_progress" | "qualified");
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "begin lead qualification");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    match sqlx::query(
        "UPDATE leads
         SET qualification_status = $2,
             status_changed_at = CASE WHEN qualification_status <> $2 THEN now() ELSE status_changed_at END,
             failed_outcome_status = CASE WHEN $2 IN ('new', 'in_progress', 'qualified') THEN 'none' ELSE failed_outcome_status END,
             -- The reason of not_qualified starts the failed-lead workflow;
             -- an archived or deleted lead keeps the reason it was processed with.
             failed_reason = CASE
                 WHEN $2 = 'not_qualified' AND $4::text IS NOT NULL
                      AND failed_outcome_status = 'none' THEN $4
                 ELSE failed_reason
             END
         WHERE id = $1 AND qualification_status = $3",
    )
    .bind(lead_id)
    .bind(&body.status)
    .bind(&current_status)
    .bind(&not_qualified_reason)
    .execute(&mut *tx)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let reopened_order_ids = if restores_archived_lead {
                match crate::routes::orders::reopen_withdrawn_lead_orders_in_tx(
                    &mut tx,
                    lead_id,
                    auth.user_id,
                )
                .await
                {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            } else {
                Vec::new()
            };
            // Status, reopened orders, history entry and audit row commit
            // together. The append-only audit keeps the reason as its code
            // only (QA 2026-10-12, A3-02): the text of «Другое» may name a
            // person or a diagnosis and lives on the lead and in its history,
            // which the anonymisation clears.
            if let Err(e) = audit::write_in_transaction(
                &mut tx,
                &audit::domain_event(
                    "qualify_lead",
                    Some(auth.user_id),
                    "lead",
                    Some(lead_id),
                    json!({
                        "status": body.status.clone(),
                        "previous_status": current_status.clone(),
                        "reason": not_qualified_reason.as_deref().map(anonymised_failure_reason),
                        "reason_free_text": not_qualified_reason
                            .as_deref()
                            .is_some_and(failure_reason_is_free_text),
                    }),
                ),
            )
            .await
            {
                tracing::error!(error = %e, lead_id = %lead_id, "audit lead qualification");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
            if current_status != body.status
                && let Err(resp) = crate::routes::workflow_lifecycle::record_event_tx(
                    &mut tx,
                    crate::routes::workflow_lifecycle::RecordEvent {
                        entity_type: "lead",
                        entity_id: lead_id,
                        from_stage: Some(current_status.as_str()),
                        to_stage: &body.status,
                        transition_kind: "status_change",
                        changed_by: Some(auth.user_id),
                        note: not_qualified_reason.as_deref(),
                        metadata: json!({
                            "status": body.status.clone(),
                        }),
                    },
                )
                .await
            {
                return resp;
            }
            if let Err(e) = tx.commit().await {
                tracing::error!(error = %e, lead_id = %lead_id, "commit lead qualification");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
            for order_id in &reopened_order_ids {
                crate::realtime::publish_order_event(
                    &state,
                    Some(auth.user_id),
                    "order.status_changed",
                    *order_id,
                    json!({
                        "from_status": "cancelled",
                        "status": "active",
                        "note": "lead_restored",
                    }),
                )
                .await;
            }
            crate::realtime::publish_lead_event(
                &state,
                Some(auth.user_id),
                "lead.status_changed",
                lead_id,
                json!({
                    "from_status": current_status,
                    "status": body.status,
                }),
            )
            .await;
            Json(json!({ "ok": true })).into_response()
        }
        Ok(_) => err(
            StatusCode::CONFLICT,
            "The lead status changed meanwhile; reload the lead and try again",
        ),
        Err(e) => {
            tracing::error!(error = %e, "qualify lead");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct LeadPatientContact {
    contact_kind: &'static str,
    contact_type: &'static str,
    value: String,
    is_primary: bool,
    notes: Option<String>,
}

fn contact_key(kind: &str, value: &str) -> String {
    if kind == "phone" {
        value
            .chars()
            .filter(|character| character.is_ascii_digit())
            .collect()
    } else {
        value.trim().to_lowercase()
    }
}

fn push_lead_contact(
    contacts: &mut Vec<LeadPatientContact>,
    contact_kind: &'static str,
    contact_type: &'static str,
    value: &str,
    is_primary: bool,
    note: Option<&str>,
) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    let key = contact_key(contact_kind, value);
    if key.is_empty() {
        return;
    }

    if let Some(existing) = contacts.iter_mut().find(|contact| {
        contact.contact_kind == contact_kind
            && contact_key(contact.contact_kind, &contact.value) == key
    }) {
        existing.is_primary |= is_primary;
        if let Some(note) = note.filter(|note| !note.trim().is_empty()) {
            match existing.notes.as_mut() {
                Some(notes) if !notes.split("; ").any(|item| item == note) => {
                    notes.push_str("; ");
                    notes.push_str(note);
                }
                None => existing.notes = Some(note.to_string()),
                _ => {}
            }
        }
        return;
    }

    contacts.push(LeadPatientContact {
        contact_kind,
        contact_type,
        value: value.to_string(),
        is_primary,
        notes: note.map(str::to_string),
    });
}

fn patient_contact_type(value: Option<&str>) -> (&'static str, Option<&'static str>) {
    match value.unwrap_or_default().trim().to_lowercase().as_str() {
        "work" | "business" => ("work", Some("Work")),
        "mobile" | "cell" => ("private", Some("Mobile")),
        "home" => ("private", Some("Home")),
        "private" => ("private", None),
        "" => ("private", None),
        _ => ("other", Some("Other")),
    }
}

fn questionnaire_contact_consent_note(value: Option<bool>) -> Option<&'static str> {
    match value {
        Some(true) => Some("Questionnaire contact consent: granted"),
        Some(false) => Some("Questionnaire contact consent: declined"),
        None => None,
    }
}

fn lead_patient_contacts(
    email: Option<&str>,
    email_consent: Option<bool>,
    primary_phone: Option<&str>,
    phones: &Value,
    whatsapp_number: Option<&str>,
    whatsapp_consent: Option<bool>,
) -> Vec<LeadPatientContact> {
    let mut contacts = Vec::new();
    if let Some(email) = email {
        push_lead_contact(
            &mut contacts,
            "email",
            "private",
            email,
            true,
            questionnaire_contact_consent_note(email_consent),
        );
    }
    if let Some(phone) = primary_phone {
        push_lead_contact(&mut contacts, "phone", "private", phone, true, None);
    }

    if let Some(entries) = phones.as_array() {
        for entry in entries {
            let Some(number) = entry.get("number").and_then(Value::as_str) else {
                continue;
            };
            let (contact_type, note) =
                patient_contact_type(entry.get("type").and_then(Value::as_str));
            let has_primary_phone = contacts
                .iter()
                .any(|contact| contact.contact_kind == "phone" && contact.is_primary);
            push_lead_contact(
                &mut contacts,
                "phone",
                contact_type,
                number,
                !has_primary_phone,
                note,
            );
        }
    }

    if let Some(number) = whatsapp_number {
        let has_primary_phone = contacts
            .iter()
            .any(|contact| contact.contact_kind == "phone" && contact.is_primary);
        push_lead_contact(
            &mut contacts,
            "phone",
            "private",
            number,
            !has_primary_phone,
            Some("WhatsApp"),
        );
        if let Some(note) = questionnaire_contact_consent_note(whatsapp_consent) {
            push_lead_contact(
                &mut contacts,
                "phone",
                "private",
                number,
                !has_primary_phone,
                Some(note),
            );
        }
    }

    contacts
}

fn patient_country(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let normalized = value.to_uppercase();
    let canonical = match normalized.as_str() {
        "DE" | "GERMANY" => "Germany",
        "UA" | "UKRAINE" => "Ukraine",
        "AT" | "AUSTRIA" => "Austria",
        "CH" | "SWITZERLAND" => "Switzerland",
        "PL" | "POLAND" => "Poland",
        "CZ" | "CZECH REPUBLIC" => "Czech Republic",
        "DK" | "DENMARK" => "Denmark",
        "LV" | "LATVIA" => "Latvia",
        "GR" | "GREECE" => "Greece",
        "TR" | "TURKEY" => "Turkey",
        "AE" | "UNITED ARAB EMIRATES" => "United Arab Emirates",
        "SA" | "SAUDI ARABIA" => "Saudi Arabia",
        "EG" | "EGYPT" => "Egypt",
        "NG" | "NIGERIA" => "Nigeria",
        "GH" | "GHANA" => "Ghana",
        "BR" | "BRAZIL" => "Brazil",
        "CN" | "CHINA" => "China",
        "RU" | "RUSSIA" => "Russia",
        "PK" | "PAKISTAN" => "Pakistan",
        "GB" | "UNITED KINGDOM" => "United Kingdom",
        "US" | "UNITED STATES" => "United States",
        _ => value,
    };
    Some(canonical.to_string())
}

/// The ISO code of a country as a patient file stores it (the English name
/// [`patient_country`] writes, or a code): leads keep ISO codes only. `None`
/// for a value that names no known country.
fn lead_country_code(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    if let Some(code) = crate::services::lead_guardian_identity::iso_country(value) {
        return Some(code);
    }
    super::patients::ISO_3166_ALPHA_2_COUNTRY_CODES
        .iter()
        .find(|code| {
            patient_country(Some(**code)).is_some_and(|name| name.eq_ignore_ascii_case(value))
        })
        .map(|code| (*code).to_string())
}

fn lead_wizard_text(wizard_state: &Value, key: &str) -> Option<String> {
    wizard_state
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// The single `patients.nationality` of a lead: its first citizenship
/// (`leads.citizenships`), the legacy `registration_country` only while the
/// list is empty.
fn lead_nationality(lead: &sqlx::postgres::PgRow, wizard_state: &Value) -> Option<String> {
    let stored: Vec<String> = lead.try_get("citizenships").unwrap_or_default();
    crate::services::citizenships::lead_citizenships(
        &stored,
        lead_wizard_text(wizard_state, "registration_country").as_deref(),
    )
    .into_iter()
    .next()
}

fn lead_wizard_date(wizard_state: &Value, key: &str) -> Option<NaiveDate> {
    lead_wizard_text(wizard_state, key)
        .and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok())
}

/// What an import of the questionnaire attachments did: the files stored as
/// the lead's documents in this run, and the files refused for their content
/// (this run and earlier ones; `id`, `file_name`, `code`), so the wizard can
/// name them.
pub(crate) struct AttachmentImportSummary {
    pub imported: usize,
    pub refused: Vec<Value>,
}

impl AttachmentImportSummary {
    fn payload(&self) -> Value {
        json!({ "imported": self.imported, "refused": self.refused })
    }
}

async fn import_lead_attachments_internal(
    state: &AppState,
    lead_id: Uuid,
    uploaded_by: Uuid,
) -> Result<AttachmentImportSummary, axum::response::Response> {
    let lead_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM leads WHERE id = $1)",
    )
    .bind(lead_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, lead_id = %lead_id, "check lead before attachment import");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if !lead_exists {
        return Err(err(StatusCode::NOT_FOUND, "Lead not found"));
    }

    let attachments = sqlx::query(
        r#"SELECT id, file_name, content_type, data
           FROM lead_attachments
           WHERE lead_id = $1 AND imported_at IS NULL AND import_refused_at IS NULL
           ORDER BY uploaded_at, id"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, lead_id = %lead_id, "load questionnaire attachments for import");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to import attachments")
    })?;

    let mut imported = 0usize;
    let mut refused_now = 0usize;
    for attachment in attachments {
        let attachment_id: Uuid = attachment.try_get("id").unwrap_or_default();
        let file_name: String = attachment.try_get("file_name").unwrap_or_default();
        let content_type: Option<String> = attachment.try_get("content_type").unwrap_or_default();
        let data: Vec<u8> = attachment.try_get("data").unwrap_or_default();

        let checked = check_lead_attachment(&file_name, content_type.as_deref(), &data).await;
        let canonical_mime = match checked {
            Ok(mime) => mime,
            Err(LeadAttachmentRefusal::ScanUnavailable) => {
                // Nothing can be checked: the whole import waits for the
                // scanner and is retried.
                return Err(LeadAttachmentRefusal::ScanUnavailable.into_response());
            }
            Err(refusal) => {
                // Refused for its content: recorded on the row, so the next
                // import does not try it again; the import goes on with the
                // next file (QA 2026-10-24: one bad file stopped them all).
                let code = refusal.code();
                sqlx::query(
                    r#"UPDATE lead_attachments
                       SET import_refused_at = now(), import_refusal_code = $2
                       WHERE id = $1 AND imported_at IS NULL"#,
                )
                .bind(attachment_id)
                .bind(code)
                .execute(&state.db)
                .await
                .map_err(|error| {
                    tracing::error!(error = %error, lead_id = %lead_id, attachment_id = %attachment_id, "mark questionnaire attachment refused");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to import attachments")
                })?;
                tracing::warn!(lead_id = %lead_id, attachment_id = %attachment_id, code, "questionnaire attachment refused on import");
                refused_now += 1;
                continue;
            }
        };

        let document_exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM documents WHERE id = $1)")
                .bind(attachment_id)
                .fetch_one(&state.db)
                .await
                .unwrap_or(false);

        if !document_exists {
            let input = NewStoredDocument {
                document_id: Some(attachment_id),
                document_number: None,
                patient_id: None,
                lead_id: Some(lead_id),
                order_id: None,
                appointment_id: None,
                auto_name: &file_name,
                original_filename: &file_name,
                art: "questionnaire_attachment",
                category: Some("medical"),
                status: "active",
                visibility: "internal",
                is_medical: true,
                mime_type: &canonical_mime,
                klinik: None,
                ursprung: Some("questionnaire"),
                notes: Some("Imported from the client questionnaire"),
                document_direction: Some("incoming"),
                document_variant: Some("original"),
                document_language: None,
                access_category: None,
                document_date: None,
                source_person: None,
                source_institution: None,
                addressee_person: None,
                addressee_institution: None,
                financial_status: None,
                payment_due_date: None,
                payment_date: None,
                payment_method: None,
                generated_template_id: None,
                generated_bindings: None,
                generated_manual_text: None,
                version_root_document_id: None,
                replaces_document_id: None,
                version_number: 1,
                uploaded_by,
            };
            match persist_document_file(state, &data, &input).await {
                Ok(_) => imported += 1,
                Err(response) => {
                    let created_concurrently = sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS (SELECT 1 FROM documents WHERE id = $1)",
                    )
                    .bind(attachment_id)
                    .fetch_one(&state.db)
                    .await
                    .unwrap_or(false);
                    if !created_concurrently {
                        return Err(response);
                    }
                }
            }
        }

        sqlx::query(
            r#"UPDATE lead_attachments
               SET imported_document_id = $2, imported_at = now()
               WHERE id = $1 AND imported_at IS NULL"#,
        )
        .bind(attachment_id)
        .bind(attachment_id)
        .execute(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, lead_id = %lead_id, attachment_id = %attachment_id, "mark questionnaire attachment imported");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to import attachments")
        })?;
    }

    // The refused files, this run's and earlier ones, by id, name and code.
    let refused: Vec<Value> = sqlx::query(
        r#"SELECT id, file_name, import_refusal_code
           FROM lead_attachments
           WHERE lead_id = $1 AND import_refused_at IS NOT NULL
           ORDER BY uploaded_at, id"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, lead_id = %lead_id, "list refused questionnaire attachments");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to import attachments")
    })?
    .iter()
    .map(|row| {
        json!({
            "id": row.try_get::<Uuid, _>("id").ok(),
            "file_name": row.try_get::<String, _>("file_name").ok(),
            "code": row.try_get::<Option<String>, _>("import_refusal_code").ok().flatten(),
        })
    })
    .collect();

    if imported > 0 || refused_now > 0 {
        // Each file is its own write (the document store is outside a
        // transaction), so the summary row is written on a connection of its
        // own rather than through the channel, which drops events when full.
        let mut conn = state.db.acquire().await.map_err(|error| {
            tracing::error!(error = %error, lead_id = %lead_id, "audit attachment import");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to import attachments",
            )
        })?;
        audit::write_in_transaction(
            &mut conn,
            &audit::domain_event(
                "import_lead_attachments",
                Some(uploaded_by),
                "lead",
                Some(lead_id),
                json!({ "imported_count": imported, "refused_count": refused_now }),
            ),
        )
        .await
        .map_err(|error| {
            tracing::error!(error = %error, lead_id = %lead_id, "audit attachment import");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to import attachments",
            )
        })?;
    }

    Ok(AttachmentImportSummary { imported, refused })
}

async fn import_lead_attachments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    // The imported files would belong to a lead that is a patient already.
    if let Err(response) = refuse_if_converted(&state.db, lead_id).await {
        return response;
    }

    match import_lead_attachments_internal(&state, lead_id, auth.user_id).await {
        Ok(summary) => Json(summary.payload()).into_response(),
        Err(response) => response,
    }
}

#[derive(Deserialize)]
struct ProspectRequest {
    attach_patient_id: Option<Uuid>,
    force_create: Option<bool>,
    hauptanfragegrund: Option<String>,
    zuweiser: Option<String>,
}

async fn ensure_prospect_case(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
    manager_id: Uuid,
    concern: &str,
    zuweiser: &str,
    retention_years: i64,
) -> Result<(Uuid, String), sqlx::Error> {
    // The lead's intake case may be linked through either column: cases opened
    // on the lead before the prospect step (older POST /cases rows) carry only
    // lead_id. Reuse it instead of opening a second case; a row already holding
    // the provenance wins so the update below cannot collide with
    // idx_cases_source_lead_unique.
    let existing = sqlx::query(
        r#"SELECT id, case_id
           FROM cases
           WHERE lead_id = $1 OR source_lead_id = $1
           ORDER BY (source_lead_id IS NOT DISTINCT FROM $1) DESC, created_at DESC, id DESC
           LIMIT 1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(row) = existing {
        let id: Uuid = row.try_get("id")?;
        let code: String = row.try_get("case_id")?;
        sqlx::query(
            r#"UPDATE cases
               SET patient_id = $2,
                   lead_id = NULL,
                   source_lead_id = $1,
                   hauptanfragegrund = COALESCE(NULLIF(btrim($3), ''), hauptanfragegrund),
                   zuweiser = COALESCE(NULLIF(btrim($4), ''), zuweiser),
                   retention_until = GREATEST(
                       COALESCE(retention_until, now()),
                       now() + make_interval(years => $5::int)
                   ),
                   updated_at = now()
               WHERE id = $6"#,
        )
        .bind(lead_id)
        .bind(patient_id)
        .bind(concern)
        .bind(zuweiser)
        .bind(retention_years as i32)
        .bind(id)
        .execute(&mut **tx)
        .await?;
        return Ok((id, code));
    }

    let seq: i64 = sqlx::query_scalar::<_, i64>("SELECT nextval('case_id_seq')")
        .fetch_one(&mut **tx)
        .await?;
    let code = format!("C-{}-{:04}", crate::app_time::today().format("%Y%m%d"), seq);
    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO cases (case_id, patient_id, source_lead_id, manager_id,
                              hauptanfragegrund, zuweiser, retention_until)
           VALUES ($1, $2, $3, $4, NULLIF(btrim($5), ''),
                   NULLIF(btrim($6), ''), now() + make_interval(years => $7::int))
           RETURNING id"#,
    )
    .bind(&code)
    .bind(patient_id)
    .bind(lead_id)
    .bind(manager_id)
    .bind(concern)
    .bind(zuweiser)
    .bind(retention_years as i32)
    .fetch_one(&mut **tx)
    .await?;
    Ok((id, code))
}

async fn ensure_prospect_assignments(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
    case_id: Uuid,
    actor_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           SELECT $1, $2, $2
           UNION
           SELECT $1, c.manager_id, $2
           FROM cases c
           WHERE c.id = $3
           ON CONFLICT (patient_id, user_id) DO UPDATE
           SET assigned_by = EXCLUDED.assigned_by,
               assigned_at = now(),
               revoked_at = NULL,
               source = 'manual'"#,
    )
    .bind(patient_id)
    .bind(actor_id)
    .bind(case_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn prospect_case_response(
    patient_id: Uuid,
    patient_pid: &str,
    case_id: Uuid,
    case_code: &str,
    lifecycle_status: &str,
    already_exists: bool,
    attached: bool,
) -> axum::response::Response {
    Json(json!({
        "patient_id": patient_id,
        "patient_pid": patient_pid,
        "case_id": case_id,
        "case_code": case_code,
        "lifecycle_status": lifecycle_status,
        "already_exists": already_exists,
        "attached": attached,
    }))
    .into_response()
}

async fn require_repeat_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if super::patients::has_patient_edit_access(state, auth, patient_id).await? {
        Ok(())
    } else {
        Err(err(
            StatusCode::FORBIDDEN,
            "Insufficient permissions for this patient",
        ))
    }
}

async fn create_prospect_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<ProspectRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsConvert) {
        return e;
    }

    if let Some(patient_id) = body.attach_patient_id
        && let Err(response) = require_repeat_patient_access(&state, &auth, patient_id).await
    {
        return response;
    }

    let retention_years =
        crate::routes::patients::load_patient_clinical_retention_years(&state, 30).await;

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "begin prospect creation");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let lead = match sqlx::query(
        r#"SELECT id, first_name, middle_name, last_name, suffix,
                  date_of_birth, legal_sex, email, phone, phones, whatsapp_number,
                  country, primary_language, locale,
                  has_insurance, insurance_provider, insurance_number, insurance_type,
                  trusted_contacts,
                  street_address, city, zip_code, notes,
                  primary_concern_text, additional_concerns,
                  qualification_status, converted_patient_id, failed_outcome_status,
                  prospect_patient_id, intake_model, wizard_state, citizenships,
                  to_jsonb(leads) AS lead_snapshot
           FROM leads WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load lead for prospect creation");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Some(patient_id) = lead
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .unwrap_or_default()
    {
        return lead_converted_response(patient_id);
    }
    let failed_outcome_status: String = lead
        .try_get("failed_outcome_status")
        .unwrap_or_else(|_| "none".to_string());
    if failed_outcome_status != "none" {
        return err(
            StatusCode::CONFLICT,
            "Failed leads cannot receive a prospect patient",
        );
    }
    let intake_model: String = lead
        .try_get("intake_model")
        .unwrap_or_else(|_| "legacy".to_string());
    if intake_model != "patient_first" {
        return err(
            StatusCode::CONFLICT,
            "Legacy leads keep the copy-on-convert intake flow",
        );
    }

    let concern = body
        .hauptanfragegrund
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            lead.try_get::<Option<String>, _>("primary_concern_text")
                .ok()
                .flatten()
        })
        .unwrap_or_default();
    let zuweiser = body
        .zuweiser
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_string();

    if let Some(existing) = lead
        .try_get::<Option<Uuid>, _>("prospect_patient_id")
        .ok()
        .flatten()
    {
        if let Err(response) = require_repeat_patient_access(&state, &auth, existing).await {
            return response;
        }
        let patient =
            match sqlx::query("SELECT patient_id, lifecycle_status FROM patients WHERE id = $1")
                .bind(existing)
                .fetch_optional(&mut *tx)
                .await
            {
                Ok(Some(row)) => row,
                Ok(None) => return err(StatusCode::CONFLICT, "Prospect patient no longer exists"),
                Err(error) => {
                    tracing::error!(error = %error, lead_id = %lead_id, "load existing prospect");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
        let (case_uuid, case_code) = match ensure_prospect_case(
            &mut tx,
            lead_id,
            existing,
            auth.user_id,
            &concern,
            &zuweiser,
            retention_years,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "ensure prospect case");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if let Err(error) =
            ensure_prospect_assignments(&mut tx, existing, case_uuid, auth.user_id).await
        {
            tracing::error!(error = %error, lead_id = %lead_id, patient_id = %existing, "assign existing prospect patient");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        if let Err(error) = tx.commit().await {
            tracing::error!(error = %error, lead_id = %lead_id, "commit prospect lookup");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        let pid: String = patient.try_get("patient_id").unwrap_or_default();
        let lifecycle: String = patient.try_get("lifecycle_status").unwrap_or_default();
        return prospect_case_response(
            existing, &pid, case_uuid, &case_code, &lifecycle, true, false,
        );
    }

    let first_name = [
        lead.try_get::<String, _>("first_name").unwrap_or_default(),
        lead.try_get::<Option<String>, _>("middle_name")
            .unwrap_or_default()
            .unwrap_or_default(),
    ]
    .into_iter()
    .filter(|value| !value.trim().is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    let last_name = [
        lead.try_get::<String, _>("last_name").unwrap_or_default(),
        lead.try_get::<Option<String>, _>("suffix")
            .unwrap_or_default()
            .unwrap_or_default(),
    ]
    .into_iter()
    .filter(|value| !value.trim().is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    let date_of_birth: Option<NaiveDate> = lead.try_get("date_of_birth").ok().flatten();
    let legal_sex: Option<String> = lead.try_get("legal_sex").ok().flatten();
    let gender = match legal_sex.as_deref() {
        Some("female") => Some("female"),
        Some("male") => Some("male"),
        Some("diverse") | Some("no_entry") => Some("diverse"),
        Some(_) | None => None,
    };

    let mut missing = Vec::new();
    if first_name.trim().is_empty() {
        missing.push("first_name");
    }
    if last_name.trim().is_empty() {
        missing.push("last_name");
    }
    if date_of_birth.is_none() {
        missing.push("date_of_birth");
    }
    if gender.is_none() {
        missing.push("legal_sex");
    }
    if !missing.is_empty() {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "error": "Lead master data is incomplete for a prospect patient",
                "missing": missing,
            })),
        )
            .into_response();
    }
    let Some(birth_date) = date_of_birth else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Lead is missing date_of_birth",
        );
    };
    let Some(gender) = gender else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Lead is missing legal_sex",
        );
    };

    if let Some(attach_id) = body.attach_patient_id {
        let attachable = match sqlx::query(
            r#"SELECT patient_id, lifecycle_status
               FROM patients
               WHERE id = $1
                 AND lifecycle_status IN ('active', 'inactive')
                 AND lower(btrim(first_name)) = lower(btrim($2))
                 AND lower(btrim(last_name)) = lower(btrim($3))
                 AND birth_date = $4
               FOR UPDATE"#,
        )
        .bind(attach_id)
        .bind(&first_name)
        .bind(&last_name)
        .bind(birth_date)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(Some(row)) => row,
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Patient to attach was not found or is not attachable",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "validate attach patient");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if let Err(error) = sqlx::query(
            "UPDATE leads SET prospect_patient_id = $2, repeat_patient_id = $2 WHERE id = $1",
        )
        .bind(lead_id)
        .bind(attach_id)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, lead_id = %lead_id, "attach prospect patient");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        let (case_uuid, case_code) = match ensure_prospect_case(
            &mut tx,
            lead_id,
            attach_id,
            auth.user_id,
            &concern,
            &zuweiser,
            retention_years,
        )
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "create case for attached patient");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if let Err(error) =
            ensure_prospect_assignments(&mut tx, attach_id, case_uuid, auth.user_id).await
        {
            tracing::error!(error = %error, lead_id = %lead_id, patient_id = %attach_id, "assign attached patient");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        if let Err(error) = audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "attach_prospect_patient",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({ "patient_id": attach_id, "case_id": case_uuid }),
            ),
        )
        .await
        {
            tracing::error!(error = %error, lead_id = %lead_id, "audit prospect attach");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        if let Err(error) = tx.commit().await {
            tracing::error!(error = %error, lead_id = %lead_id, "commit prospect attach");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        crate::realtime::publish_lead_event(
            &state,
            Some(auth.user_id),
            "lead.updated",
            lead_id,
            json!({ "prospect_patient_id": attach_id }),
        )
        .await;
        let pid: String = attachable.try_get("patient_id").unwrap_or_default();
        let lifecycle: String = attachable.try_get("lifecycle_status").unwrap_or_default();
        return prospect_case_response(
            attach_id, &pid, case_uuid, &case_code, &lifecycle, false, true,
        );
    }

    if !body.force_create.unwrap_or(false) {
        let candidates = match sqlx::query(
            r#"SELECT id, patient_id, first_name, last_name, birth_date,
                      lifecycle_status, email, residence_country
               FROM patients
               WHERE lifecycle_status IN ('active', 'inactive')
                 AND (
                   (lower(btrim(first_name)) = lower(btrim($1))
                    AND lower(btrim(last_name)) = lower(btrim($2))
                    AND birth_date = $3)
                   -- A returning patient often writes in with a new spelling or no
                   -- birth date; the same e-mail or phone still identifies them.
                   OR ($4::text IS NOT NULL AND lower(btrim(email)) = lower(btrim($4)))
                   OR ($5::text IS NOT NULL AND length($5) >= 6
                       AND phone_digits(phone_primary) LIKE '%' || $5 || '%')
                 )
               ORDER BY (lower(btrim(last_name)) = lower(btrim($2)) AND birth_date = $3) DESC,
                        created_at DESC
               LIMIT 5"#,
        )
        .bind(&first_name)
        .bind(&last_name)
        .bind(birth_date)
        .bind(
            lead.try_get::<Option<String>, _>("email")
                .ok()
                .flatten()
                .filter(|value| !value.trim().is_empty()),
        )
        .bind(
            lead.try_get::<Option<String>, _>("phone")
                .ok()
                .flatten()
                .map(|value| {
                    value
                        .chars()
                        .filter(char::is_ascii_digit)
                        .collect::<String>()
                })
                .filter(|digits| !digits.is_empty()),
        )
        .fetch_all(&mut *tx)
        .await
        {
            Ok(rows) => rows,
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "search duplicate patients");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if !candidates.is_empty() {
            let mut payload = Vec::with_capacity(candidates.len());
            for row in candidates {
                payload.push(json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "patient_id": row.try_get::<String, _>("patient_id").unwrap_or_default(),
                    "first_name": row.try_get::<String, _>("first_name").unwrap_or_default(),
                    "last_name": row.try_get::<String, _>("last_name").unwrap_or_default(),
                    "birth_date": row
                        .try_get::<chrono::NaiveDate, _>("birth_date")
                        .map(|value| value.to_string())
                        .unwrap_or_default(),
                    "lifecycle_status": row
                        .try_get::<String, _>("lifecycle_status")
                        .unwrap_or_default(),
                    "email": row.try_get::<Option<String>, _>("email").unwrap_or_default(),
                    "residence_country": row
                        .try_get::<Option<String>, _>("residence_country")
                        .unwrap_or_default(),
                }));
            }
            return Json(json!({ "duplicate_candidates": payload })).into_response();
        }
    }

    let email: Option<String> = lead.try_get("email").ok().flatten();
    let phone: Option<String> = lead.try_get("phone").ok().flatten();
    let lead_country: Option<String> = lead.try_get("country").ok().flatten();
    let country = patient_country(lead_country.as_deref());
    let primary_language: Option<String> = lead.try_get("primary_language").ok().flatten();
    let locale: Option<String> = lead.try_get("locale").ok().flatten();
    let languages: Vec<String> =
        converted_patient_languages(primary_language.as_deref(), locale.as_deref());
    let has_insurance: Option<bool> = lead.try_get("has_insurance").ok().flatten();
    let explicit_insurance_type: Option<String> = lead
        .try_get::<Option<String>, _>("insurance_type")
        .ok()
        .flatten();
    let insurance_type = match has_insurance {
        Some(false) => Some("self_pay".to_string()),
        Some(true) => explicit_insurance_type
            .or_else(|| (country.as_deref() != Some("Germany")).then(|| "foreign".to_string())),
        None => explicit_insurance_type,
    };
    let wizard_state: Value = lead.try_get("wizard_state").unwrap_or_else(|_| json!({}));
    let nationality = lead_nationality(&lead, &wizard_state);
    // Staff's identity data on the GwG statements are the one source; the
    // wizard field of older leads is the fallback (trigger flow 2026-10-07).
    let identity_document = match load_staff_identity_document(&mut tx, lead_id, &wizard_state)
        .await
    {
        Ok(document) => document,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load identity document for prospect");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let passport_expiry = identity_document.valid_until;
    let lead_snapshot: Value = lead.try_get("lead_snapshot").unwrap_or_else(|_| json!({}));
    let lead_notes: Option<String> = lead.try_get("notes").ok().flatten();

    let enhanced_check_required =
        match super::lead_enhanced_check::enhanced_check_triggers(&mut tx, lead_id).await {
            Ok(check) => check.required,
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "load lead enhanced check");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };

    // The prospect's emergency contact, as the conversion writes it: the
    // trusted contact marked as such, else the legacy single contact of a
    // lead without parents or guardians.
    let legacy_text = |column: &str| {
        lead.try_get::<Option<String>, _>(column)
            .ok()
            .flatten()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let prospect_emergency_contact = emergency_contact_for_patient(
        &lead
            .try_get::<Value, _>("trusted_contacts")
            .unwrap_or_else(|_| json!([])),
        (
            legacy_text("trusted_contact_name"),
            legacy_text("trusted_contact_phone"),
            legacy_text("trusted_contact_relation"),
        ),
    );
    let seq: i64 = match sqlx::query_scalar::<_, i64>("SELECT nextval('patient_id_seq')")
        .fetch_one(&mut *tx)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "allocate prospect patient id");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let pid = format!("P-{}-{:04}", crate::app_time::today().format("%Y%m%d"), seq);

    let patient_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender,
                                 email, phone_primary, residence_country, languages,
                                 address_street, address_city, address_zip, address_country,
                                 insurance_provider, insurance_number, insurance_type,
                                 emergency_contact_name, emergency_contact_phone,
                                 emergency_contact_relation, intake_profile, legal_status,
                                 notes, source_lead_id, lead_snapshot, created_by,
                                 nationality, passport_expiry, passport_number,
                                 id_document_type, id_issuing_authority, id_issuing_country,
                                 id_issued_on, lifecycle_status, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
                   $26, $27, $28, $29, $30, $31, $32, 'prospective', false)
           RETURNING id"#,
    )
    .bind(&pid)
    .bind(&first_name)
    .bind(&last_name)
    .bind(birth_date)
    .bind(gender)
    .bind(email)
    .bind(phone.as_deref())
    .bind(country.as_deref())
    .bind(&languages)
    .bind(
        lead.try_get::<Option<String>, _>("street_address")
            .ok()
            .flatten(),
    )
    .bind(lead.try_get::<Option<String>, _>("city").ok().flatten())
    .bind(lead.try_get::<Option<String>, _>("zip_code").ok().flatten())
    .bind(country.as_deref())
    .bind(
        lead.try_get::<Option<String>, _>("insurance_provider")
            .ok()
            .flatten(),
    )
    .bind(
        lead.try_get::<Option<String>, _>("insurance_number")
            .ok()
            .flatten(),
    )
    .bind(insurance_type)
    .bind(prospect_emergency_contact.0)
    .bind(prospect_emergency_contact.1)
    .bind(prospect_emergency_contact.2)
    .bind(json!({ "source": "lead_prospect", "source_lead_id": lead_id }))
    .bind(json!({
        "dsgvo_signed": false,
        "confidentiality_release_signed": false,
        "identity_verified": false,
        "document_pack_complete": false,
        "compliance_completed": false,
        "contract_status": "pending",
        "aml_enhanced_due_diligence_required": enhanced_check_required,
        "aml_enhanced_due_diligence": wizard_state
            .get("aml_enhanced_due_diligence")
            .cloned()
            .unwrap_or_else(|| json!({})),
        "notes": null,
    }))
    .bind(lead_notes.as_deref())
    .bind(lead_id)
    .bind(lead_snapshot)
    .bind(auth.user_id)
    .bind(nationality)
    .bind(passport_expiry)
    .bind(identity_document.number.as_deref())
    .bind(identity_document.document_type.as_deref())
    .bind(identity_document.issuing_authority.as_deref())
    .bind(identity_document.issuing_country.as_deref())
    .bind(identity_document.issued_on)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "create prospect patient");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(error) = sqlx::query("UPDATE leads SET prospect_patient_id = $2 WHERE id = $1")
        .bind(lead_id)
        .bind(patient_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, lead_id = %lead_id, "store prospect pointer");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) =
        super::lead_payer::carry_over_to_patient(&mut tx, lead_id, patient_id, false).await
    {
        tracing::error!(error = %error, lead_id = %lead_id, "copy prospect citizenships");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let (case_uuid, case_code) = match ensure_prospect_case(
        &mut tx,
        lead_id,
        patient_id,
        auth.user_id,
        &concern,
        &zuweiser,
        retention_years,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "create prospect case");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(error) =
        ensure_prospect_assignments(&mut tx, patient_id, case_uuid, auth.user_id).await
    {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "assign prospect patient");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "create_prospect_patient",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "patient_id": patient_id,
                "patient_pid": pid.clone(),
                "case_id": case_uuid,
            }),
        ),
    )
    .await
    {
        tracing::error!(error = %error, lead_id = %lead_id, "audit prospect creation");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, lead_id = %lead_id, "commit prospect creation");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.updated",
        lead_id,
        json!({ "prospect_patient_id": patient_id }),
    )
    .await;
    tracing::info!(by = %auth.user_id, lead = %lead_id, patient = %patient_id, "Prospect patient created");

    prospect_case_response(
        patient_id,
        &pid,
        case_uuid,
        &case_code,
        "prospective",
        false,
        false,
    )
}

/// A relation the patient already has, as a repeat conversion compares it
/// with the lead's trusted contacts.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ExistingRelation {
    id: Uuid,
    related_patient_id: Option<Uuid>,
    related_name: String,
    relation_type: String,
    /// The trusted contact entry the relation was created from.
    source_contact_id: Option<Uuid>,
}

/// Mother, father and a parent of unstated role are one kind: an older
/// `parent` relation is the same person as a new `mother`.
fn same_relation_group(left: &str, right: &str) -> bool {
    let parent = |value: &str| matches!(value, "parent" | "mother" | "father");
    left == right || (parent(left) && parent(right))
}

/// The relation a trusted contact of the lead is already on file as
/// (audit 2026-10-20): the one created from the same entry, else the one
/// linked to the same patient record, else one of the same relation group
/// with a compatible name (a patronymic on one side only) — an exact name
/// first, a single compatible one otherwise. A relation another entry
/// created, or one linked to another patient record, is never taken, and
/// none is taken twice (`taken`).
fn matching_relation(
    existing: &[ExistingRelation],
    taken: &[Uuid],
    contact_id: Option<Uuid>,
    related_patient_id: Option<Uuid>,
    name: &str,
    relation_type: &str,
) -> Option<Uuid> {
    let free = || {
        existing
            .iter()
            .filter(|relation| !taken.contains(&relation.id))
    };
    if let Some(contact_id) = contact_id
        && let Some(relation) =
            free().find(|relation| relation.source_contact_id == Some(contact_id))
    {
        return Some(relation.id);
    }
    let candidates = free()
        .filter(|relation| same_relation_group(&relation.relation_type, relation_type))
        .filter(|relation| {
            relation.source_contact_id.is_none() || relation.source_contact_id == contact_id
        })
        .collect::<Vec<_>>();
    if let Some(person) = related_patient_id
        && let Some(relation) = candidates
            .iter()
            .find(|relation| relation.related_patient_id == Some(person))
    {
        return Some(relation.id);
    }
    let named = candidates
        .iter()
        .filter(|relation| {
            relation.related_patient_id.is_none()
                || relation.related_patient_id == related_patient_id
        })
        .filter(|relation| {
            crate::routes::lead_portal_guardians::compatible_person_name(
                &relation.related_name,
                name,
            )
        })
        .collect::<Vec<_>>();
    if let Some(exact) = named.iter().find(|relation| {
        crate::routes::lead_portal_guardians::same_person_name(&relation.related_name, name)
    }) {
        return Some(exact.id);
    }
    match named.as_slice() {
        [single] => Some(single.id),
        _ => None,
    }
}

/// The citizenships the conversion stores on each contact's relation: the
/// effective identity's ISO codes by contact id. A contact without an id or
/// without citizenships is left out (the relation keeps what it has).
fn relation_citizenships_by_contact(
    identities: Vec<crate::services::lead_guardian_identity::CanonicalGuardianIdentity>,
) -> std::collections::HashMap<Uuid, Vec<String>> {
    identities
        .into_iter()
        .filter_map(|identity| {
            let contact_id = identity.contact_id?;
            let codes = identity
                .citizenships
                .into_iter()
                .filter(|code| crate::services::citizenships::is_country_code(code))
                .collect::<Vec<_>>();
            (!codes.is_empty()).then_some((contact_id, codes))
        })
        .collect()
}

async fn convert_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsConvert) {
        return e;
    }

    let preflight = match sqlx::query(
        "SELECT converted_patient_id, failed_outcome_status FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "preflight lead conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Some(patient_id) = preflight
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .unwrap_or_default()
    {
        return lead_converted_response(patient_id);
    }
    if preflight
        .try_get::<String, _>("failed_outcome_status")
        .unwrap_or_else(|_| "none".to_string())
        != "none"
    {
        return err(
            StatusCode::CONFLICT,
            "Failed leads cannot be converted into patients",
        );
    }

    if let Err(response) = import_lead_attachments_internal(&state, lead_id, auth.user_id).await {
        return response;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "begin lead conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let lead = match sqlx::query(
        r#"SELECT id, first_name, middle_name, last_name, suffix,
                  email, email_consent, phone, phones, whatsapp_number, whatsapp_consent,
                  source, intake_source, flow, submitted_at,
                  country, primary_language, locale, needs_interpreter,
                  location, location_detailed, wants_membership, selected_program,
                  can_travel, has_medical_records, records_in_accepted_language,
                  has_travel_documents, currently_in_treatment, has_health_risk_for_travel,
                  services, has_insurance, insurance_covers_germany,
                  insurance_provider, insurance_number, insurance_type,
                  trusted_contact_name, trusted_contact_phone, trusted_contact_email,
                  trusted_contact_relation,
                  trusted_contact_birth_date, trusted_contact_address, trusted_contacts,
                  preferred_location, visit_timing, message,
                  date_of_birth, legal_sex, qualification_status, converted_patient_id,
                  failed_outcome_status, street_address, city, zip_code, notes,
                  intake_model, prospect_patient_id,
                  wizard_state, citizenships, to_jsonb(leads) AS lead_snapshot
           FROM leads WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(l)) => l,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, "convert lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let converted_patient_id: Option<Uuid> = lead.try_get("converted_patient_id").ok().flatten();
    if let Some(patient_id) = converted_patient_id {
        return lead_converted_response(patient_id);
    }
    let failed_outcome_status: String = lead
        .try_get("failed_outcome_status")
        .unwrap_or_else(|_| "none".to_string());
    if failed_outcome_status != "none" {
        return err(
            StatusCode::CONFLICT,
            "Failed leads cannot be converted into patients",
        );
    }

    match super::lead_representatives::contract_details_missing(&mut tx, lead_id).await {
        Ok(missing) if !missing.is_empty() => {
            return super::lead_representatives::contract_details_incomplete(&missing);
        }
        Ok(_) => {}
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "validate representatives before conversion");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to check representatives",
            );
        }
    }

    // Freeze the order while validating and confirming this intake.
    if sqlx::query("SELECT id FROM orders WHERE source_lead_id=$1 FOR UPDATE")
        .bind(lead_id)
        .fetch_all(&mut *tx)
        .await
        .is_err()
    {
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to lock order for confirmation",
        );
    }

    let readiness = match load_lead_conversion_readiness(&state, lead_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(resp) => return resp,
    };
    if !readiness.conversion_ready {
        // QA R-8 (owner decision 2026-10-25): the unidentified payer is named
        // by its code, so the wizard can say what is missing; the CEO's risk
        // release does not lift it.
        let payer_not_identified = super::lead_payer::PayerReason::PayerNotIdentified;
        if readiness
            .conversion_reasons
            .iter()
            .any(|reason| reason == payer_not_identified.message())
        {
            return lead_gate_err_coded(
                payer_not_identified.code(),
                "Lead is not conversion-ready",
                &readiness.conversion_reasons,
                &readiness.payload,
            );
        }
        return lead_gate_err(
            "Lead is not conversion-ready",
            &readiness.conversion_reasons,
            &readiness.payload,
        );
    }

    let date_of_birth: Option<NaiveDate> = lead.try_get("date_of_birth").ok().flatten();
    let Some(birth_date) = date_of_birth else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Lead is missing date_of_birth; cannot convert to patient",
        );
    };

    let legal_sex: Option<String> = lead.try_get("legal_sex").ok().flatten();
    let gender = match legal_sex.as_deref() {
        Some("female") => "female",
        Some("male") => "male",
        Some("diverse") | Some("no_entry") => "diverse",
        _ => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Lead is missing legal_sex; cannot convert to patient",
            );
        }
    };

    let intake_model: String = lead
        .try_get("intake_model")
        .unwrap_or_else(|_| "legacy".to_string());
    let prospect_patient_id: Option<Uuid> = lead.try_get("prospect_patient_id").ok().flatten();
    if intake_model == "patient_first" && prospect_patient_id.is_none() {
        return err(
            StatusCode::CONFLICT,
            "Patient-first lead requires a prospect patient before conversion",
        );
    }
    let activation_patient_id = match intake_model.as_str() {
        "patient_first" => prospect_patient_id,
        _ => None,
    };
    // An existing patient's record: the same access and Art. 18 check as every
    // other way into it (QA 2026-10-30). A new prospect is this lead's own.
    if let Some(prospect_id) = activation_patient_id {
        let existing = match sqlx::query_scalar::<_, String>(
            "SELECT lifecycle_status FROM patients WHERE id = $1",
        )
        .bind(prospect_id)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(status) => {
                status.is_some_and(|status| matches!(status.as_str(), "active" | "inactive"))
            }
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "load lifecycle for conversion");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if existing
            && let Err(response) = require_repeat_patient_access(&state, &auth, prospect_id).await
        {
            return response;
        }
    }

    let first_name = [
        lead.try_get::<String, _>("first_name").unwrap_or_default(),
        lead.try_get::<Option<String>, _>("middle_name")
            .unwrap_or_default()
            .unwrap_or_default(),
    ]
    .into_iter()
    .filter(|value| !value.trim().is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    let last_name = [
        lead.try_get::<String, _>("last_name").unwrap_or_default(),
        lead.try_get::<Option<String>, _>("suffix")
            .unwrap_or_default()
            .unwrap_or_default(),
    ]
    .into_iter()
    .filter(|value| !value.trim().is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    let email: Option<String> = lead.try_get("email").ok().flatten();
    let email_consent: Option<bool> = lead.try_get("email_consent").ok().flatten();
    let phone: Option<String> = lead.try_get("phone").ok().flatten();
    let phones: Value = lead.try_get("phones").unwrap_or_else(|_| json!([]));
    let whatsapp_number: Option<String> = lead.try_get("whatsapp_number").ok().flatten();
    let whatsapp_consent: Option<bool> = lead.try_get("whatsapp_consent").ok().flatten();
    let lead_country: Option<String> = lead.try_get("country").ok().flatten();
    let country = patient_country(lead_country.as_deref());
    let primary_language: Option<String> = lead.try_get("primary_language").ok().flatten();
    let locale: Option<String> = lead.try_get("locale").ok().flatten();
    let languages: Vec<String> =
        converted_patient_languages(primary_language.as_deref(), locale.as_deref());
    let has_insurance: Option<bool> = lead.try_get("has_insurance").ok().flatten();
    let explicit_insurance_type: Option<String> = lead
        .try_get::<Option<String>, _>("insurance_type")
        .ok()
        .flatten();
    let insurance_type = match has_insurance {
        Some(false) => Some("self_pay".to_string()),
        Some(true) => explicit_insurance_type
            .or_else(|| (country.as_deref() != Some("Germany")).then(|| "foreign".to_string())),
        None => explicit_insurance_type,
    };
    let insurance_provider: Option<String> = lead
        .try_get::<Option<String>, _>("insurance_provider")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let insurance_number: Option<String> = lead
        .try_get::<Option<String>, _>("insurance_number")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let trusted_contact_name: Option<String> = lead
        .try_get::<Option<String>, _>("trusted_contact_name")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let trusted_contact_phone: Option<String> = lead
        .try_get::<Option<String>, _>("trusted_contact_phone")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let trusted_contact_email: Option<String> = lead
        .try_get::<Option<String>, _>("trusted_contact_email")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let trusted_contact_relation: Option<String> = lead
        .try_get::<Option<String>, _>("trusted_contact_relation")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let trusted_contact_birth_date: Option<NaiveDate> =
        lead.try_get("trusted_contact_birth_date").ok().flatten();
    let trusted_contact_address: Option<String> = lead
        .try_get::<Option<String>, _>("trusted_contact_address")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let stored_trusted_contacts = lead
        .try_get::<Value, _>("trusted_contacts")
        .unwrap_or_else(|_| json!([]));
    let trusted_contacts = if stored_trusted_contacts
        .as_array()
        .is_some_and(|contacts| !contacts.is_empty())
    {
        stored_trusted_contacts
    } else if let Some(name) = trusted_contact_name.as_ref() {
        json!([{
            "id": lead_id,
            "name": name,
            "phone": trusted_contact_phone,
            "email": trusted_contact_email,
            "relation": trusted_contact_relation,
            "birth_date": trusted_contact_birth_date.map(|value| value.to_string()),
            "address": trusted_contact_address,
        }])
    } else {
        json!([])
    };
    // The patient's emergency contact is the entry marked as such, as the
    // relation rows written below read it; the legacy single contact counts
    // only for a lead without parents or guardians among the contacts.
    let (emergency_contact_name, emergency_contact_phone, emergency_contact_relation) =
        emergency_contact_for_patient(
            &trusted_contacts,
            (
                trusted_contact_name.clone(),
                trusted_contact_phone.clone(),
                trusted_contact_relation.clone(),
            ),
        );
    let street_address: Option<String> = lead.try_get("street_address").ok().flatten();
    let city: Option<String> = lead.try_get("city").ok().flatten();
    let zip_code: Option<String> = lead.try_get("zip_code").ok().flatten();
    let lead_notes: Option<String> = lead.try_get("notes").ok().flatten();
    let wizard_state: Value = lead.try_get("wizard_state").unwrap_or_else(|_| json!({}));
    let nationality = lead_nationality(&lead, &wizard_state);
    // Staff's identity data on the GwG statements are the one source; the
    // wizard field of older leads is the fallback (trigger flow 2026-10-07).
    // The whole document — number, type, issuer, dates — reaches the patient
    // card (QA 2026-10-25: only the validity did).
    let identity_document = match load_staff_identity_document(&mut tx, lead_id, &wizard_state)
        .await
    {
        Ok(document) => document,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load identity document for conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let passport_expiry = identity_document.valid_until;
    let selected_work_type_ids = wizard_state
        .get("selected_specialization_work_type_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|value| Uuid::parse_str(value).ok())
        .collect::<Vec<_>>();
    let selected_work_types = if selected_work_type_ids.is_empty() {
        json!([])
    } else {
        match sqlx::query_scalar::<_, Value>(
            r#"SELECT COALESCE(
                     jsonb_agg(
                         jsonb_build_object(
                             'id', wt.id,
                             'code', wt.code,
                             'name_de', wt.name_de,
                             'name_ru', wt.name_ru,
                             'name_en', wt.name_en,
                             'name_es', wt.name_es,
                             'duration_hours', wt.duration_hours,
                             'min_price_eur', wt.min_price_eur,
                             'max_price_eur', wt.max_price_eur,
                             'specialization_ids', COALESCE((
                                 SELECT jsonb_agg(assignment.specialization_id ORDER BY assignment.specialization_id)
                                 FROM medical_specialization_work_type_assignments assignment
                                 WHERE assignment.work_type_id = wt.id
                             ), '[]'::jsonb)
                         )
                         ORDER BY wt.sort_order, wt.name_de, wt.id
                     ),
                     '[]'::jsonb
                 )
               FROM medical_specialization_work_types wt
               WHERE wt.id = ANY($1::uuid[])
                 AND wt.deleted_at IS NULL"#,
        )
        .bind(&selected_work_type_ids)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(items) => items,
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "load selected work types for lead conversion");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    };
    let requested_work_type_language = wizard_state
        .get("cost_estimate_additional_language")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let lead_snapshot: Value = lead.try_get("lead_snapshot").unwrap_or_else(|_| json!({}));
    let snapshot_value = |key: &str| lead_snapshot.get(key).cloned().unwrap_or(Value::Null);
    // The wizard's record of a consent, or the consent given in the cabinet
    // (`readiness.cabinet_consents`, the readiness rule).
    let consent_given = |column: &str, cabinet_key: &str| -> Value {
        let staff = snapshot_value(column).as_bool().unwrap_or(false);
        let cabinet = readiness.payload["cabinet_consents"][cabinet_key]
            .as_bool()
            .unwrap_or(false);
        json!(staff || cabinet)
    };
    // How that consent came (owner 2026-10-30): `cabinet`, `staff` with how
    // the client gave it, or `paper` (the wizard's toggle); the card said
    // «на бумаге» for every consent.
    let consent_way = |column: &str, cabinet_key: &str| -> Value {
        let cabinet = &readiness.payload["cabinet_consents"];
        if cabinet[cabinet_key].as_bool().unwrap_or(false) {
            let recorded = &cabinet[format!("{cabinet_key}_recorded").as_str()];
            if recorded.is_object() {
                json!({ "via": "staff", "how": recorded["how"], "note": recorded["note"] })
            } else {
                json!({ "via": "cabinet" })
            }
        } else if snapshot_value(column).as_bool().unwrap_or(false) {
            json!({ "via": "paper" })
        } else {
            Value::Null
        }
    };
    let source: Option<String> = lead.try_get("source").ok().flatten();
    let intake_source: Option<String> = lead.try_get("intake_source").ok().flatten();
    let flow: Option<String> = lead.try_get("flow").ok().flatten();
    let lead_type = lead_type_from_origin(
        false,
        intake_source.as_deref(),
        source.as_deref(),
        flow.as_deref(),
    );
    let intake_profile = json!({
        "lead_type": lead_type,
        "source": source,
        "intake_source": intake_source,
        "flow": flow,
        "locale": locale,
        "primary_language": primary_language,
        "country": snapshot_value("country"),
        "state": snapshot_value("state"),
        "submitted_at": lead
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("submitted_at")
            .unwrap_or_default()
            .map(|value| value.to_rfc3339()),
        "email": email.clone(),
        "email_consent": email_consent,
        "phone": phone.clone(),
        "phones": phones.clone(),
        "primary_phone_type": snapshot_value("primary_phone_type"),
        "whatsapp_number": whatsapp_number.clone(),
        "whatsapp_consent": whatsapp_consent,
        "needs_interpreter": lead.try_get::<Option<bool>, _>("needs_interpreter").unwrap_or_default(),
        "location": lead.try_get::<Option<String>, _>("location").unwrap_or_default(),
        "location_detailed": lead.try_get::<Option<String>, _>("location_detailed").unwrap_or_default(),
        "preferred_location": lead.try_get::<Option<String>, _>("preferred_location").unwrap_or_default(),
        "visit_timing": lead.try_get::<Option<String>, _>("visit_timing").unwrap_or_default(),
        "wants_membership": lead.try_get::<Option<bool>, _>("wants_membership").unwrap_or_default(),
        "selected_program": lead.try_get::<Option<String>, _>("selected_program").unwrap_or_default(),
        "can_travel": lead.try_get::<Option<bool>, _>("can_travel").unwrap_or_default(),
        "has_medical_records": lead.try_get::<Option<String>, _>("has_medical_records").unwrap_or_default(),
        "records_in_accepted_language": lead.try_get::<Option<bool>, _>("records_in_accepted_language").unwrap_or_default(),
        "has_travel_documents": lead.try_get::<Option<bool>, _>("has_travel_documents").unwrap_or_default(),
        "currently_in_treatment": lead.try_get::<Option<bool>, _>("currently_in_treatment").unwrap_or_default(),
        "has_health_risk_for_travel": lead.try_get::<Option<bool>, _>("has_health_risk_for_travel").unwrap_or_default(),
        "services": lead.try_get::<Vec<String>, _>("services").unwrap_or_default(),
        "service_comments": wizard_state.get("service_comments").cloned().unwrap_or_else(|| json!({})),
        "primary_concern_text": snapshot_value("primary_concern_text"),
        "additional_concerns": snapshot_value("additional_concerns"),
        "requested_specialties": snapshot_value("requested_specialties"),
        "selected_work_types": selected_work_types,
        "cost_estimate_additional_language": requested_work_type_language.clone(),
        "program_date_from": wizard_state.get("program_date_from").cloned().unwrap_or(Value::Null),
        "program_date_to": wizard_state.get("program_date_to").cloned().unwrap_or(Value::Null),
        "nationality": nationality.clone(),
        "passport_expiry": passport_expiry.map(|value| value.to_string()),
        "passport_number": identity_document.number.clone(),
        "id_document_type": identity_document.document_type.clone(),
        "id_issuing_authority": identity_document.issuing_authority.clone(),
        "id_issuing_country": identity_document.issuing_country.clone(),
        "id_issued_on": identity_document.issued_on.map(|value| value.to_string()),
        "notes": lead_notes.clone(),
        "has_insurance": has_insurance,
        "insurance_covers_germany": lead.try_get::<Option<String>, _>("insurance_covers_germany").unwrap_or_default(),
        "message": lead.try_get::<Option<String>, _>("message").unwrap_or_default(),
        "consent_automated_contact": snapshot_value("consent_automated_contact"),
        // A consent given in the cabinet counts like the staff's record of a
        // paper consent — the readiness rule; the card showed "Нет" for a
        // consent the cabinet holds (QA 2026-10-25).
        "consent_healthcare": consent_given("consent_healthcare", "healthcare"),
        "consent_opt_out": snapshot_value("consent_opt_out"),
        "consent_privacy_practices": consent_given("consent_privacy_practices", "privacy_practices"),
        "consent_healthcare_way": consent_way("consent_healthcare", "healthcare"),
        "consent_privacy_practices_way": consent_way("consent_privacy_practices", "privacy_practices"),
        "discovery_source": wizard_state.get("discovery_source").cloned().unwrap_or(Value::Null),
        "discovery_source_other": wizard_state.get("discovery_source_other").cloned().unwrap_or(Value::Null),
        "referrer": wizard_state.get("referrer").cloned().unwrap_or(Value::Null),
        "trusted_contact": {
            "name": trusted_contact_name.clone(),
            "phone": trusted_contact_phone.clone(),
            "email": trusted_contact_email.clone(),
            "relation": trusted_contact_relation.clone(),
            "birth_date": trusted_contact_birth_date.map(|value| value.to_string()),
            "address": trusted_contact_address.clone(),
        },
        "trusted_contacts": trusted_contacts.clone(),
    });
    let contacts = lead_patient_contacts(
        email.as_deref(),
        email_consent,
        phone.as_deref(),
        &phones,
        whatsapp_number.as_deref(),
        whatsapp_consent,
    );
    let phone_secondary = contacts
        .iter()
        .find(|contact| contact.contact_kind == "phone" && !contact.is_primary)
        .map(|contact| contact.value.as_str());

    let enhanced_check_required = match super::lead_enhanced_check::enhanced_check_triggers(
        &mut tx, lead_id,
    )
    .await
    {
        Ok(check) => check.required,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load lead enhanced check for conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    // DEV can complete the workflow using test evidence; it must never turn
    // that evidence into legal confirmations on the resulting patient.
    let legal_checks = readiness
        .payload
        .get("legal_checks")
        .unwrap_or(&readiness.payload["checks"]);
    let legal_passed = |key: &str| {
        legal_checks.as_array().is_some_and(|checks| {
            checks
                .iter()
                .any(|check| check["key"] == key && check["passed"] == true)
        })
    };
    let legal_status = json!({
        "dsgvo_signed": legal_passed("dsgvo_document_signed"),
        "confidentiality_release_signed": legal_passed("confidentiality_release_signed"),
        "identity_verified": legal_passed("identity_document_verified"),
        "document_pack_complete": legal_passed("dsgvo_document_signed") && legal_passed("confidentiality_release_signed") && legal_passed("identity_document_verified"),
        "compliance_completed": legal_passed("compliance_completed"),
        "contract_status": if legal_passed("contract_signed") { "signed" } else { "unsigned" },
        "demo_onboarding": readiness.payload.get("demo_onboarding"),
        "aml_enhanced_due_diligence_required": enhanced_check_required,
        "aml_enhanced_due_diligence": wizard_state
            .get("aml_enhanced_due_diligence")
            .cloned()
            .unwrap_or_else(|| json!({})),
        "notes": null,
    });

    let (patient_id, pid) = match activation_patient_id {
        Some(prospect_id) => {
            let patient_lifecycle = match sqlx::query(
                "SELECT patient_id, lifecycle_status FROM patients WHERE id = $1 FOR UPDATE",
            )
            .bind(prospect_id)
            .fetch_optional(&mut *tx)
            .await
            {
                Ok(Some(row)) => row,
                Ok(None) => {
                    return err(StatusCode::CONFLICT, "Prospect patient no longer exists");
                }
                Err(e) => {
                    tracing::error!(error = %e, patient_id = %prospect_id, "lock prospect patient");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            let lifecycle_status: String = patient_lifecycle
                .try_get("lifecycle_status")
                .unwrap_or_default();
            let activated_pid = if lifecycle_status == "prospective" {
                match sqlx::query_scalar::<_, String>(
                    r#"UPDATE patients
                       SET first_name = $2, last_name = $3, birth_date = $4, gender = $5,
                           email = $6, phone_primary = $7, phone_secondary = $8,
                           residence_country = $9, languages = $10,
                           address_street = $11, address_city = $12, address_zip = $13,
                           address_country = $14, insurance_provider = $15,
                           insurance_number = $16, insurance_type = $17,
                           emergency_contact_name = $18, emergency_contact_phone = $19,
                           emergency_contact_relation = $20, intake_profile = $21,
                           legal_status = (COALESCE(legal_status, '{}'::jsonb) || $22::jsonb)
                               - (CASE WHEN $22::jsonb->>'dsgvo_signed' = 'true'
                                       THEN ARRAY['dsgvo_revoked_at'] ELSE ARRAY[]::text[] END
                                  || CASE WHEN $22::jsonb->>'confidentiality_release_signed' = 'true'
                                          THEN ARRAY['confidentiality_release_revoked_at'] ELSE ARRAY[]::text[] END),
                           notes = COALESCE(NULLIF(btrim(notes), ''), $23),
                           source_lead_id = $24, lead_snapshot = $25,
                           nationality = $26, passport_expiry = $27,
                           passport_number = COALESCE($28, passport_number),
                           id_document_type = COALESCE($29, id_document_type),
                           id_issuing_authority = COALESCE($30, id_issuing_authority),
                           id_issuing_country = COALESCE($31, id_issuing_country),
                           id_issued_on = COALESCE($32, id_issued_on),
                           lifecycle_status = 'active', is_active = true, updated_at = now()
                       WHERE id = $1 AND lifecycle_status = 'prospective'
                       RETURNING patient_id"#,
                )
                .bind(prospect_id)
                .bind(&first_name)
                .bind(&last_name)
                .bind(birth_date)
                .bind(gender)
                .bind(email)
                .bind(phone.as_deref())
                .bind(phone_secondary)
                .bind(country.as_deref())
                .bind(&languages)
                .bind(street_address)
                .bind(city)
                .bind(zip_code)
                .bind(country.as_deref())
                .bind(insurance_provider)
                .bind(insurance_number)
                .bind(insurance_type)
                .bind(&emergency_contact_name)
                .bind(&emergency_contact_phone)
                .bind(&emergency_contact_relation)
                .bind(&intake_profile)
                .bind(&legal_status)
                .bind(lead_notes.as_deref())
                .bind(lead_id)
                .bind(&lead_snapshot)
                .bind(nationality.as_deref())
                .bind(passport_expiry)
                .bind(identity_document.number.as_deref())
                .bind(identity_document.document_type.as_deref())
                .bind(identity_document.issuing_authority.as_deref())
                .bind(identity_document.issuing_country.as_deref())
                .bind(identity_document.issued_on)
                .fetch_optional(&mut *tx)
                .await
                {
                    Ok(Some(value)) => value,
                    Ok(None) => {
                        return err(
                            StatusCode::CONFLICT,
                            "Prospect patient changed concurrently",
                        );
                    }
                    Err(e) => {
                        tracing::error!(error = %e, patient_id = %prospect_id, "activate prospect patient");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                }
            } else if matches!(lifecycle_status.as_str(), "active" | "inactive") {
                match sqlx::query_scalar::<_, String>(
                    r#"UPDATE patients
                       SET lifecycle_status = 'active',
                           is_active = true,
                           -- an active file has no retention clock running
                           inactive_since = NULL,
                           intake_profile = jsonb_set(
                               COALESCE(intake_profile, '{}'::jsonb),
                               '{lead_intakes}',
                               CASE
                                   WHEN jsonb_typeof(intake_profile->'lead_intakes') = 'array'
                                   THEN intake_profile->'lead_intakes'
                                   ELSE '[]'::jsonb
                               END
                                   || jsonb_build_array(jsonb_build_object(
                                       'lead_id', $2,
                                       'captured_at', now(),
                                       'profile', $3::jsonb,
                                       'snapshot', $4::jsonb
                                   )),
                               true
                           ),
                           -- Only a real renewed signature ends a revocation;
                           -- DEV test onboarding preserves these markers.
                           -- The record's notes and AML data stay: only this lead's own
                           -- AML data are added, and a required check stays required.
                           legal_status = (COALESCE(legal_status, '{}'::jsonb)
                                   || ($5::jsonb - 'notes' - 'aml_enhanced_due_diligence'
                                       - 'aml_enhanced_due_diligence_required')
                                   || CASE WHEN $5::jsonb->'aml_enhanced_due_diligence' <> '{}'::jsonb
                                           THEN jsonb_build_object('aml_enhanced_due_diligence',
                                                $5::jsonb->'aml_enhanced_due_diligence')
                                           ELSE '{}'::jsonb END
                                   || jsonb_build_object('aml_enhanced_due_diligence_required',
                                        COALESCE((legal_status->>'aml_enhanced_due_diligence_required')::boolean, false)
                                        OR COALESCE(($5::jsonb->>'aml_enhanced_due_diligence_required')::boolean, false)))
                               - (CASE WHEN $5::jsonb->>'dsgvo_signed' = 'true'
                                       THEN ARRAY['dsgvo_revoked_at'] ELSE ARRAY[]::text[] END
                                  || CASE WHEN $5::jsonb->>'confidentiality_release_signed' = 'true'
                                          THEN ARRAY['confidentiality_release_revoked_at'] ELSE ARRAY[]::text[] END),
                           notes = COALESCE(NULLIF(btrim(notes), ''), $6),
                           nationality = COALESCE($7, nationality),
                           passport_expiry = COALESCE($8, passport_expiry),
                           passport_number = COALESCE($9, passport_number),
                           id_document_type = COALESCE($10, id_document_type),
                           id_issuing_authority = COALESCE($11, id_issuing_authority),
                           id_issuing_country = COALESCE($12, id_issuing_country),
                           id_issued_on = COALESCE($13, id_issued_on),
                           updated_at = now()
                       WHERE id = $1 AND lifecycle_status IN ('active', 'inactive')
                       RETURNING patient_id"#,
                )
                .bind(prospect_id)
                .bind(lead_id)
                .bind(&intake_profile)
                .bind(&lead_snapshot)
                .bind(&legal_status)
                .bind(lead_notes.as_deref())
                .bind(nationality.as_deref())
                .bind(passport_expiry)
                .bind(identity_document.number.as_deref())
                .bind(identity_document.document_type.as_deref())
                .bind(identity_document.issuing_authority.as_deref())
                .bind(identity_document.issuing_country.as_deref())
                .bind(identity_document.issued_on)
                .fetch_optional(&mut *tx)
                .await
                {
                    Ok(Some(value)) => value,
                    Ok(None) => {
                        return err(
                            StatusCode::CONFLICT,
                            "Attached patient changed concurrently",
                        );
                    }
                    Err(e) => {
                        tracing::error!(error = %e, patient_id = %prospect_id, "activate attached patient");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                }
            } else {
                return err(
                    StatusCode::CONFLICT,
                    "Patient is not convertible from this lead",
                );
            };
            (prospect_id, activated_pid)
        }
        None => {
            let seq: i64 = match sqlx::query_scalar::<_, i64>(r#"SELECT nextval('patient_id_seq')"#)
                .fetch_one(&mut *tx)
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!(error = %error, lead_id = %lead_id, "allocate patient id");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            let pid = format!("P-{}-{:04}", crate::app_time::today().format("%Y%m%d"), seq);
            let inserted = match sqlx::query_scalar::<_, Uuid>(
                r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender,
                                         email, phone_primary, phone_secondary, residence_country,
                                         languages, address_street, address_city, address_zip,
                                         address_country, insurance_provider, insurance_number,
                                         insurance_type, emergency_contact_name, emergency_contact_phone,
                                         emergency_contact_relation, intake_profile, legal_status, notes,
                                         source_lead_id, lead_snapshot, created_by,
                                         nationality, passport_expiry, passport_number,
                                         id_document_type, id_issuing_authority,
                                         id_issuing_country, id_issued_on)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                           $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
                           $27, $28, $29, $30, $31, $32, $33)
                   RETURNING id"#,
            )
            .bind(&pid)
            .bind(&first_name)
            .bind(&last_name)
            .bind(birth_date)
            .bind(gender)
            .bind(email)
            .bind(phone.as_deref())
            .bind(phone_secondary)
            .bind(country.as_deref())
            .bind(&languages)
            .bind(street_address)
            .bind(city)
            .bind(zip_code)
            .bind(country.as_deref())
            .bind(insurance_provider)
            .bind(insurance_number)
            .bind(insurance_type)
            .bind(&emergency_contact_name)
            .bind(&emergency_contact_phone)
            .bind(&emergency_contact_relation)
            .bind(intake_profile)
            .bind(legal_status)
            .bind(lead_notes.as_deref())
            .bind(lead_id)
            .bind(lead_snapshot)
            .bind(auth.user_id)
            .bind(nationality)
            .bind(passport_expiry)
            .bind(identity_document.number.as_deref())
            .bind(identity_document.document_type.as_deref())
            .bind(identity_document.issuing_authority.as_deref())
            .bind(identity_document.issuing_country.as_deref())
            .bind(identity_document.issued_on)
            .fetch_one(&mut *tx)
            .await
            {
                Ok(id) => id,
                Err(e) => {
                    tracing::error!(error = %e, "create patient from lead");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            (inserted, pid)
        }
    };
    if let Err(error) =
        super::lead_payer::carry_over_to_patient(&mut tx, lead_id, patient_id, true).await
    {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "carry over citizenships and payer declaration");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    // The payer's own link ends with the lead; the payer's statement stays
    // with it as GwG evidence (§ 8 Abs. 4 GwG).
    if let Err(error) =
        super::lead_payer_link::revoke_for_conversion(&mut tx, lead_id, auth.user_id).await
    {
        tracing::error!(error = %error, lead_id = %lead_id, "revoke payer link on conversion");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    // A patient the lead was attached to (duplicate dialog, repeat intake)
    // keeps its primary e-mail and phone: the lead's own differing values are
    // added beside them as further contacts (QA 2026-10-25, the insert of a
    // second primary violated `uq_patient_contacts_primary`). A value the
    // patient already has — compared normalised, as the identity check
    // compares — is not added twice.
    for contact in &contacts {
        if let Err(error) = sqlx::query(
            r#"INSERT INTO patient_contacts
                      (patient_id, contact_kind, contact_type, value, is_primary, notes)
               SELECT $1, $2, $3, $4,
                      $5 AND NOT EXISTS (
                          SELECT 1 FROM patient_contacts primary_contact
                          WHERE primary_contact.patient_id = $1
                            AND primary_contact.contact_kind = $2
                            AND primary_contact.is_primary
                      ),
                      $6
               WHERE NOT EXISTS (
                   SELECT 1 FROM patient_contacts existing
                   WHERE existing.patient_id = $1
                     AND existing.contact_kind = $2
                     AND CASE WHEN $2 = 'phone'
                              THEN regexp_replace(phone_digits(existing.value), '^00', '')
                                   = regexp_replace(phone_digits($4), '^00', '')
                              ELSE lower(btrim(existing.value)) = lower(btrim($4))
                         END
               )"#,
        )
        .bind(patient_id)
        .bind(contact.contact_kind)
        .bind(contact.contact_type)
        .bind(&contact.value)
        .bind(contact.is_primary)
        .bind(contact.notes.as_deref())
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "transfer lead contact");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    // What the cabinet holds about the lead's representatives (a legal
    // representative's structured address) goes into the relation, and the
    // parent who pays becomes the patient's default payer: invoices of a
    // minor are then addressed to that parent as contracting party (the
    // existing default-payer rule), not to a second free-text contact.
    let representatives_on_file = match super::lead_representatives::load(&mut tx, lead_id).await {
        Ok(loaded) => loaded.unwrap_or_default(),
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load lead representation for conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let payer_declaration = match super::lead_payer::load_declaration(&mut tx, lead_id).await {
        Ok(declaration) => declaration,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load payer declaration for conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let paying_parent = super::lead_representatives::payer_same_person(
        &representatives_on_file.representation,
        payer_declaration.as_ref(),
    );
    // Where the lead wants the invoice (cabinet step 3, `lead_invoice_recipients`,
    // the one source of the recipient, read as every other reader reads it):
    // a parent chosen as recipient becomes the default payer — the parent the
    // invoices are addressed to — also when the other parent pays; a third
    // party who receives the invoice without paying is the declaration's
    // "other address" (`invoice_address` in the invoice chain), so the paying
    // parent is not marked then. Otherwise the paying parent, as before.
    let invoice_recipient = match super::lead_invoice_recipient::load_for_lead(&mut tx, lead_id)
        .await
    {
        Ok(recipient) => recipient,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load invoice recipient for conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let recipient_parent = invoice_recipient
        .as_ref()
        .filter(|recipient| !recipient.parent_removed)
        .map(|recipient| &recipient.answers)
        .filter(|answers| {
            answers.recipient.as_deref() == Some(super::lead_invoice_recipient::RECIPIENT_SELF)
        })
        .and_then(|answers| answers.representative_contact_id)
        .filter(|id| representatives_on_file.representation.find(*id).is_some());
    // Section 7 derived from the same recipient: "to another address".
    let invoice_elsewhere = match (invoice_recipient.as_ref(), payer_declaration.as_ref()) {
        (Some(recipient), Some(declaration)) => {
            recipient.section_seven(declaration).invoice_to.as_deref()
                == Some(super::lead_payer::INVOICE_TO_OTHER)
        }
        _ => false,
    };
    let paying_parent = match recipient_parent {
        Some(parent) => Some(parent),
        None if invoice_elsewhere => None,
        None => paying_parent,
    };
    // The paying parent's relation, once its entry is seen.
    let mut paying_parent_relation: Option<Uuid> = None;
    // A minor's contracting party (owner decision 2026-10-19): the parents
    // who represent the child — rep1, and rep2 under joint custody — not
    // every parent on file. Their relations, in that order, once seen.
    let minor_custody = representatives_on_file.representation.minor.then(|| {
        representatives_on_file
            .representation
            .answers
            .custody()
            .to_string()
    });
    let contracting_contacts: Vec<Uuid> = if minor_custody.is_some() {
        representatives_on_file
            .representation
            .representatives
            .iter()
            .filter(|person| person.slot.is_some())
            .map(|person| person.id)
            .collect()
    } else {
        Vec::new()
    };
    let mut contracting_relations: Vec<(Uuid, Uuid)> = Vec::new();
    // The relations a repeat conversion compares the contacts with, newest
    // first; each is taken by one contact at most.
    let existing_relations = match sqlx::query(
        r#"SELECT id, related_patient_id, COALESCE(related_name, '') AS related_name,
                  relation_type, source_contact_id
           FROM patient_relations WHERE patient_id = $1
           ORDER BY created_at DESC, id DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| ExistingRelation {
                id: row.get("id"),
                related_patient_id: row.get("related_patient_id"),
                related_name: row.get("related_name"),
                relation_type: row.get("relation_type"),
                source_contact_id: row.get("source_contact_id"),
            })
            .collect::<Vec<_>>(),
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "load patient relations for conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut taken_relations: Vec<Uuid> = Vec::new();
    // The effective citizenships of each contact (the representative row, the
    // contact entry or a linked patient's): the relation keeps them, so a
    // repeat request does not ask the parents again (owner decision 2026-10-23).
    let contact_citizenships = match crate::services::lead_guardian_identity::load(&mut tx, lead_id)
        .await
    {
        Ok(identities) => relation_citizenships_by_contact(identities),
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load contact citizenships for conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    for trusted_contact in trusted_contacts.as_array().into_iter().flatten() {
        let Some(contact) = trusted_contact.as_object() else {
            continue;
        };
        let name = contact
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if name.is_empty() {
            continue;
        }
        let relation = contact.get("relation").and_then(Value::as_str);
        let related_patient_id = contact
            .get("related_patient_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let contact_id = super::lead_representatives::entry_id(trusted_contact);
        let email = contact
            .get("email")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let address = contact_id
            .and_then(|id| representatives_on_file.row_of(id))
            .map(|row| {
                (
                    row.street.clone(),
                    row.zip.clone(),
                    row.city.clone(),
                    row.country.clone(),
                )
            })
            .unwrap_or_default();
        let notes = [
            contact
                .get("email")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("Email: {}", value.trim())),
            contact
                .get("birth_date")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("Geburtsdatum: {}", value.trim())),
            contact
                .get("address")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("Adresse: {}", value.trim())),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n");

        // The contact's date of birth: the contracting parents' documents name
        // it after the conversion as before (owner decision 2026-10-19).
        let birth_date = contact
            .get("birth_date")
            .and_then(Value::as_str)
            .and_then(|value| NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok());
        let relation_type = normalized_patient_relation_type(relation);
        // A trusted contact is no emergency contact by itself (owner
        // decision 2026-10-19); only an explicit mark of the entry carries over.
        let emergency_contact = contact
            .get("is_emergency_contact")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // The relation of the entry: the one a repeat conversion finds
        // ([`matching_relation`]), refreshed with the lead's current name,
        // contact data and address (a value the lead no longer has stays),
        // or a new one that remembers its entry.
        let matched = matching_relation(
            &existing_relations,
            &taken_relations,
            contact_id,
            related_patient_id,
            name,
            relation_type,
        );
        let phone = contact
            .get("phone")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let notes = (!notes.is_empty()).then_some(notes.as_str());
        let citizenships: Vec<String> = contact_id
            .and_then(|id| contact_citizenships.get(&id).cloned())
            .unwrap_or_default();
        let stored = match matched {
            Some(existing_id) => {
                sqlx::query_scalar::<_, Uuid>(
                    r#"UPDATE patient_relations SET
                           related_name = $3,
                           -- An older "parent" becomes "mother"/"father"; a known role is not
                           -- turned back into "parent".
                           relation_type = CASE
                               WHEN $4 = 'parent' AND relation_type IN ('mother', 'father')
                               THEN relation_type ELSE $4 END,
                           related_patient_id = COALESCE($2, related_patient_id),
                           phone = COALESCE($5, phone),
                           notes = COALESCE($6, notes),
                           email = COALESCE($7, email),
                           -- The address is one value: the lead's whole, or the stored one.
                           address_street = CASE WHEN COALESCE($8, $9, $10, $11) IS NOT NULL THEN $8 ELSE address_street END,
                           address_zip = CASE WHEN COALESCE($8, $9, $10, $11) IS NOT NULL THEN $9 ELSE address_zip END,
                           address_city = CASE WHEN COALESCE($8, $9, $10, $11) IS NOT NULL THEN $10 ELSE address_city END,
                           address_country = CASE WHEN COALESCE($8, $9, $10, $11) IS NOT NULL THEN $11 ELSE address_country END,
                           is_emergency_contact = is_emergency_contact OR $12,
                           source_contact_id = COALESCE(source_contact_id, $13),
                           -- A repeat conversion completes a date the relation lacks.
                           birth_date = COALESCE(birth_date, $15),
                           -- The lead's current citizenships; none keeps the stored ones.
                           citizenships = CASE WHEN cardinality($16::text[]) > 0
                               THEN $16::text[] ELSE citizenships END
                       WHERE id = $14 AND patient_id = $1
                       RETURNING id"#,
                )
                .bind(patient_id)
                .bind(related_patient_id)
                .bind(name)
                .bind(relation_type)
                .bind(phone)
                .bind(notes)
                .bind(email)
                .bind(&address.0)
                .bind(&address.1)
                .bind(&address.2)
                .bind(&address.3)
                .bind(emergency_contact)
                .bind(contact_id)
                .bind(existing_id)
                .bind(birth_date)
                .bind(&citizenships)
                .fetch_optional(&mut *tx)
                .await
            }
            None => {
                sqlx::query_scalar::<_, Uuid>(
                    r#"INSERT INTO patient_relations (
                            patient_id, related_patient_id, related_name, relation_type,
                            is_emergency_contact, phone, notes, email,
                            address_street, address_zip, address_city, address_country,
                            source_contact_id, birth_date, citizenships
                       )
                       VALUES ($1, $2, $3, $4, $12, $5, $6, $7, $8, $9, $10, $11, $13, $14, $15)
                       RETURNING id"#,
                )
                .bind(patient_id)
                .bind(related_patient_id)
                .bind(name)
                .bind(relation_type)
                .bind(phone)
                .bind(notes)
                .bind(email)
                .bind(&address.0)
                .bind(&address.1)
                .bind(&address.2)
                .bind(&address.3)
                .bind(emergency_contact)
                .bind(contact_id)
                .bind(birth_date)
                .bind(&citizenships)
                .fetch_optional(&mut *tx)
                .await
            }
        };
        let relation_id = match stored {
            Ok(relation_id) => {
                taken_relations.extend(relation_id);
                relation_id
            }
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "transfer trusted contact to patient relation");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        // A parent or guardian who is a patient already names the child on
        // the own record too (DEV 2026-10-28: the father's card did not list
        // his second child).
        if let (Some(relation_id), Some(_)) = (relation_id, related_patient_id)
            && let Err(error) = super::lead_portal_account::add_reverse_relation_in_tx(
                &mut tx,
                relation_id,
                Some(lead_id),
                auth.user_id,
            )
            .await
        {
            tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "add the reverse relation on conversion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        let (Some(contact_id), Some(relation_id)) = (contact_id, relation_id) else {
            continue;
        };
        if Some(contact_id) == paying_parent && is_parent_or_guardian_relation(relation) {
            paying_parent_relation = Some(relation_id);
        }
        if contracting_contacts.contains(&contact_id)
            && !contracting_relations
                .iter()
                .any(|(_, known)| *known == relation_id)
        {
            contracting_relations.push((contact_id, relation_id));
        }
    }

    // The minor's contracting party on the patient: the custody and the
    // relations of the representing parents, in the order of the lead's
    // representation (rep1 first). A repeat conversion states it anew.
    if let Some(custody) = minor_custody.as_deref() {
        let relation_ids = contracting_contacts
            .iter()
            .filter_map(|contact| {
                contracting_relations
                    .iter()
                    .find(|(known, _)| known == contact)
                    .map(|(_, relation)| *relation)
            })
            .collect::<Vec<_>>();
        let stored = sqlx::query_scalar::<_, Uuid>(
            r#"UPDATE patients
               SET custody = $2,
                   contracting_relation_ids = CASE WHEN cardinality($3::uuid[]) > 0
                       THEN $3::uuid[] ELSE contracting_relation_ids END
               WHERE id = $1
                 AND (custody IS DISTINCT FROM $2
                      OR (cardinality($3::uuid[]) > 0
                          AND contracting_relation_ids IS DISTINCT FROM $3::uuid[]))
               RETURNING id"#,
        )
        .bind(patient_id)
        .bind(custody)
        .bind(&relation_ids)
        .fetch_optional(&mut *tx)
        .await;
        match stored {
            Ok(Some(_)) => {
                if let Err(error) = audit::write_in_transaction(
                    &mut tx,
                    &audit::domain_event(
                        "set_contracting_party_on_conversion",
                        Some(auth.user_id),
                        "patient",
                        Some(patient_id),
                        json!({
                            "lead_id": lead_id,
                            "custody": custody,
                            "contracting_relation_ids": relation_ids,
                        }),
                    ),
                )
                .await
                {
                    tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "audit contracting party on conversion");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            }
            Ok(None) => {}
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "store contracting party on conversion");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }

    // The parent who pays according to the lead being converted is the
    // default payer (audit 2026-10-20: a repeat conversion kept the payer of
    // an earlier inquiry). The mark moves from another relation first: the
    // unique index allows one only. Without a paying parent the mark stays.
    // Never backfilled for earlier conversions. The relation is the entry's
    // own, also when the parent is linked to a patient record of their own.
    if let Some(paying_relation_id) = paying_parent_relation {
        let marked = async {
            let previous = sqlx::query_scalar::<_, Uuid>(
                r#"UPDATE patient_relations SET is_default_payer = false
                   WHERE patient_id = $1 AND is_default_payer AND id <> $2
                   RETURNING id"#,
            )
            .bind(patient_id)
            .bind(paying_relation_id)
            .fetch_optional(&mut *tx)
            .await?;
            let marked = sqlx::query_scalar::<_, Uuid>(
                r#"UPDATE patient_relations
                   SET is_default_payer = true
                   WHERE id = $2 AND patient_id = $1 AND NOT is_default_payer
                   RETURNING id"#,
            )
            .bind(patient_id)
            .bind(paying_relation_id)
            .fetch_optional(&mut *tx)
            .await?;
            Ok::<_, sqlx::Error>(marked.map(|relation_id| (relation_id, previous)))
        }
        .await;
        match marked {
            Ok(Some((relation_id, previous))) => {
                if let Err(error) = audit::write_in_transaction(
                    &mut tx,
                    &audit::domain_event(
                        "set_default_payer_on_conversion",
                        Some(auth.user_id),
                        "patient",
                        Some(patient_id),
                        json!({
                            "lead_id": lead_id,
                            "relation_id": relation_id,
                            "previous_relation_id": previous,
                        }),
                    ),
                )
                .await
                {
                    tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "audit default payer on conversion");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            }
            Ok(None) => {}
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "mark paying parent as default payer");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }

    if !selected_work_type_ids.is_empty()
        && let Err(error) = sqlx::query(
            r#"INSERT INTO patient_requested_work_types (
                    patient_id, case_id, order_id, source_lead_id,
                    work_type_id, additional_language
               )
               SELECT $1,
                      (
                          SELECT c.id
                          FROM cases c
                          WHERE c.lead_id = $2 OR c.source_lead_id = $2
                          ORDER BY c.created_at DESC, c.id DESC
                          LIMIT 1
                      ),
                      (
                          SELECT o.id
                          FROM orders o
                          WHERE o.source_lead_id = $2
                          ORDER BY o.created_at DESC, o.id DESC
                          LIMIT 1
                      ),
                      $2,
                      selected.work_type_id,
                      $4
               FROM unnest($3::uuid[]) AS selected(work_type_id)
               JOIN medical_specialization_work_types wt
                 ON wt.id = selected.work_type_id
                AND wt.deleted_at IS NULL
               ON CONFLICT (patient_id, source_lead_id, work_type_id)
                   WHERE source_lead_id IS NOT NULL
               DO UPDATE SET
                   case_id = EXCLUDED.case_id,
                   order_id = EXCLUDED.order_id,
                   additional_language = EXCLUDED.additional_language,
                   status = 'requested',
                   updated_at = now()"#,
        )
        .bind(patient_id)
        .bind(lead_id)
        .bind(&selected_work_type_ids)
        .bind(requested_work_type_language.as_deref())
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "transfer requested work types");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Err(error) = sqlx::query(
        r#"WITH moved_cases AS (
               -- A lead may still carry a legacy duplicate: a lead_id-only case
               -- next to the prospect case that already holds the provenance.
               -- Only one row may hold source_lead_id (idx_cases_source_lead_unique),
               -- so the duplicate moves to the patient without it.
               UPDATE cases
               SET patient_id = $2,
                   source_lead_id = CASE
                       WHEN source_lead_id IS NOT NULL THEN source_lead_id
                       WHEN EXISTS (
                           SELECT 1 FROM cases provenance
                           WHERE provenance.source_lead_id = $1
                       ) THEN NULL
                       ELSE $1
                   END,
                   lead_id = NULL,
                   notes = COALESCE(
                       NULLIF(btrim(notes), ''),
                       NULLIF(btrim($3), '')
                   )
               WHERE lead_id = $1 OR source_lead_id = $1
               RETURNING id, source_lead_id
           ), moved_documents AS (
               -- A previous payer's archived copies stay in the lead's archive
               -- (retention, audit); they are not the patient's (owner
               -- 2026-10-24).
               UPDATE documents
               SET patient_id = $2, lead_id = NULL
               WHERE lead_id = $1
                 AND NOT (status = 'archived'
                          AND art IN ('payer_identity', 'payer_funds_proof'))
               RETURNING id
           ), moved_contracts AS (
               UPDATE framework_contracts
               SET patient_id = $2, lead_id = NULL
               WHERE lead_id = $1
               RETURNING id
           ), moved_orders AS (
               UPDATE orders
               SET patient_id = $2,
                   intake_state = CASE WHEN intake_state='draft' THEN 'confirmed' ELSE intake_state END,
                   case_id = COALESCE(
                       case_id,
                       (SELECT mc.id FROM moved_cases mc
                        ORDER BY (mc.source_lead_id IS NOT DISTINCT FROM $1) DESC
                        LIMIT 1)
                   )
               WHERE source_lead_id = $1
               RETURNING id
           ), moved_services AS (
               UPDATE order_leistungen service
               SET patient_id = $2
               FROM orders o
               WHERE service.order_id = o.id
                 AND o.source_lead_id = $1
                 AND service.patient_id IS NULL
               RETURNING service.id
           )
           UPDATE leads
           SET qualification_status = 'converted', converted_patient_id = $2, status_changed_at = now()
           WHERE id = $1 AND converted_patient_id IS NULL"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(lead_notes.as_deref())
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "transfer lead onboarding artifacts");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = crate::routes::lead_portal_account::link_to_patient_in_tx(
        &mut tx,
        lead_id,
        patient_id,
        auth.user_id,
    )
    .await
    {
        tracing::error!(%error, lead_id = %lead_id, patient_id = %patient_id, "link lead portal account");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Err(error) = sqlx::query(
        r#"WITH consent_evidence AS (
               SELECT 'document'::text AS source_kind,
                      d.id AS source_id,
                      CASE d.compliance_kind
                        WHEN 'dsgvo' THEN 'dsgvo_data_transfer'
                        WHEN 'confidentiality_release' THEN 'schweigepflicht_release'
                        WHEN 'framework_contract' THEN 'treatment_contract'
                      END AS consent_type,
                      COALESCE(d.signed_by, d.uploaded_by) AS managed_by,
                      d.signed_at AS granted_at,
                      d.signed_at + INTERVAL '1 year' AS expires_at,
                      jsonb_build_object(
                        'source', 'lead_document_signature',
                        'source_document_id', d.id,
                        'source_lead_id', $2,
                        'compliance_kind', d.compliance_kind
                      ) AS context
               FROM documents d
               WHERE d.patient_id = $1
                 AND d.signed_at IS NOT NULL
                 AND d.file_deleted_at IS NULL
                 AND d.compliance_kind IN ('dsgvo', 'confidentiality_release', 'framework_contract')

               UNION ALL

               SELECT 'framework_contract'::text,
                      fc.id,
                      'treatment_contract'::text,
                      fc.created_by,
                      fc.signed_at,
                      COALESCE(
                        fc.valid_to::timestamp AT TIME ZONE 'UTC',
                        fc.signed_at + INTERVAL '1 year'
                      ),
                      jsonb_build_object(
                        'source', 'lead_framework_contract',
                        'source_contract_id', fc.id,
                        'source_lead_id', $2,
                        'contract_number', fc.contract_number
                      )
               FROM framework_contracts fc
               WHERE fc.patient_id = $1
                 AND fc.status = 'signed'
                 AND fc.signed_at IS NOT NULL

               UNION ALL

               SELECT 'lead_contact_consent'::text,
                      l.id,
                      channel.consent_type,
                      $3::uuid,
                      COALESCE(l.submitted_at, l.created_at, now()),
                      COALESCE(l.submitted_at, l.created_at, now()) + INTERVAL '1 year',
                      jsonb_build_object(
                        'source', 'lead_contact_consent',
                        'source_lead_id', l.id,
                        'channel', channel.channel
                      )
               FROM leads l
               CROSS JOIN LATERAL (
                 VALUES
                   ('document_share_email'::text, 'email'::text, $4::bool),
                   ('document_share_whatsapp'::text, 'whatsapp'::text, $5::bool)
               ) AS channel(consent_type, channel, granted)
               WHERE l.id = $2
                 AND channel.granted
           ), latest_evidence AS (
               SELECT DISTINCT ON (consent_type)
                      consent_type, managed_by, granted_at, expires_at, context
               FROM consent_evidence
               WHERE consent_type IS NOT NULL
                 AND managed_by IS NOT NULL
                 AND granted_at IS NOT NULL
               ORDER BY consent_type, granted_at DESC, source_kind, source_id DESC
           )
           INSERT INTO consent_records (
               patient_id, user_id, consent_type, granted, granted_at, expires_at, context
           )
           SELECT $1, evidence.managed_by, evidence.consent_type, true,
                  evidence.granted_at, evidence.expires_at, evidence.context
           FROM latest_evidence evidence
           WHERE NOT EXISTS (
               SELECT 1
               FROM consent_records existing
               WHERE existing.patient_id = $1
                 AND existing.consent_type = evidence.consent_type
                 AND existing.granted = true
                 AND existing.revoked_at IS NULL
                 AND (existing.expires_at IS NULL OR existing.expires_at > now())
           )"#,
    )
    .bind(patient_id)
    .bind(lead_id)
    .bind(auth.user_id)
    .bind(email_consent.unwrap_or(false))
    .bind(whatsapp_consent.unwrap_or(false))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "transfer lead consent evidence");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Err(error) = sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           SELECT $1, $2, $2
           UNION
           SELECT $1, c.manager_id, $2
           FROM cases c
           JOIN users u ON u.id = c.manager_id AND u.is_active
           WHERE c.patient_id = $1
             -- Someone removed from this patient stays removed (QA 2026-10-30).
             AND NOT EXISTS (
                 SELECT 1 FROM patient_assignments r
                 WHERE r.patient_id = $1 AND r.user_id = c.manager_id
                   AND r.revoked_at IS NOT NULL
             )
           ON CONFLICT (patient_id, user_id) DO UPDATE
           SET assigned_by = EXCLUDED.assigned_by,
               assigned_at = now(),
               revoked_at = NULL,
               source = 'manual'"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "assign converted patient");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    // The conversion's audit row and lead history entry commit with it.
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "convert_lead",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "patient_id": patient_id,
                "patient_pid": pid.clone(),
                "conversion_confirmed": true,
                "demo_onboarding": readiness.payload.get("demo_onboarding"),
            }),
        ),
    )
    .await
    {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "audit lead conversion");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let previous_status: String = lead.try_get("qualification_status").unwrap_or_default();
    if let Err(response) = crate::routes::workflow_lifecycle::record_event_tx(
        &mut tx,
        crate::routes::workflow_lifecycle::RecordEvent {
            entity_type: "lead",
            entity_id: lead_id,
            from_stage: Some(previous_status.as_str()),
            to_stage: "converted",
            transition_kind: "converted",
            changed_by: Some(auth.user_id),
            note: Some("Lead converted to patient"),
            metadata: json!({
                "patient_id": patient_id,
                "patient_pid": pid.clone(),
            }),
        },
    )
    .await
    {
        return response;
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, lead_id = %lead_id, patient_id = %patient_id, "commit lead conversion");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let order_ids = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM orders WHERE source_lead_id = $1",
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(order_ids) => order_ids,
        Err(error) => {
            tracing::error!(error = %error, lead_id = %lead_id, "load converted lead orders after conversion");
            Vec::new()
        }
    };
    for order_id in order_ids {
        if let Err(response) =
            super::orders::ensure_created_order_state(&state, order_id, auth.user_id).await
        {
            tracing::error!(order_id=%order_id, status=%response.status(), "failed to initialize converted order");
        }
        if let Err(error) =
            super::orders::carry_lead_needs_into_order_planning(&state, order_id, lead_id).await
        {
            tracing::error!(error = %error, order_id = %order_id, lead_id = %lead_id, "failed to carry lead needs into order planning");
        }
        if crate::routes::workflow_checklists::ensure_default_order_workflow(
            &state,
            order_id,
            Some(auth.user_id),
        )
        .await
        .is_err()
        {
            tracing::error!(lead_id = %lead_id, patient_id = %patient_id, order_id = %order_id, "failed to create default order workflow after conversion");
        }
    }

    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.converted",
        lead_id,
        json!({
            "patient_id": patient_id,
            "patient_pid": pid.clone(),
        }),
    )
    .await;
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.created",
        patient_id,
        json!({
            "patient_pid": pid.clone(),
            "source_lead_id": lead_id,
        }),
    )
    .await;

    tracing::info!(by = %auth.user_id, lead = %lead_id, patient = %patient_id, "Lead converted to patient");

    Json(json!({
        "patient_id": patient_id,
        "patient_pid": pid,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct WizardConvertLeadRequest {
    confirmed: bool,
}

async fn wizard_convert_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<WizardConvertLeadRequest>,
) -> axum::response::Response {
    if !body.confirmed {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Lead conversion must be explicitly confirmed",
        );
    }
    convert_lead(State(state), Extension(auth), Path(lead_id)).await
}

async fn resolve_failed_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<FailedLeadResolutionRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsEdit) {
        return e;
    }

    let resolution = body.resolution.trim().to_lowercase();
    if !is_valid_failed_lead_resolution(&resolution) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid failed lead resolution",
        );
    }

    let reason = body.reason.trim();
    if reason.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failure reason is required",
        );
    }

    if resolution == "delete" && !matches!(auth.role, Role::PatientManager | Role::Ceo) {
        return err(
            StatusCode::FORBIDDEN,
            "Only patient managers or CEO may delete failed leads",
        );
    }

    // The lead, its preparation orders and the outcome change together.
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "begin failed-lead resolution");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to resolve failed lead",
            );
        }
    };
    let current = match sqlx::query(
        r#"SELECT qualification_status,
                  converted_patient_id,
                  failed_outcome_status
           FROM leads
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "load failed-lead context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to resolve failed lead",
            );
        }
    };

    let current_status: String = current.try_get("qualification_status").unwrap_or_default();
    let converted_patient_id: Option<Uuid> =
        current.try_get("converted_patient_id").unwrap_or_default();
    let failed_outcome_status: String = current
        .try_get("failed_outcome_status")
        .unwrap_or_else(|_| "none".to_string());

    if let Some(patient_id) = converted_patient_id {
        return lead_converted_response(patient_id);
    }
    if failed_outcome_status != "none" {
        return err(
            StatusCode::CONFLICT,
            "Failed-lead workflow was already processed for this lead",
        );
    }

    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    // Deleting and anonymising keeps nothing staff typed (QA 2026-10-12): the
    // reason becomes its listed code (the text of «Другое» becomes `other`)
    // and the internal note is dropped — on the lead row, in the audit row,
    // in the lead history and on the withdrawn orders alike. Archiving keeps
    // both.
    // Whether staff typed a reason of their own and a note: the audit records
    // only that (QA 2026-10-12, A3-02).
    let (typed_reason, typed_note) = (failure_reason_is_free_text(reason), note.is_some());
    let (reason, note) = if resolution == "archive" {
        (reason, note)
    } else {
        (anonymised_failure_reason(reason), None)
    };
    let outcome_status = if resolution == "archive" {
        "archived"
    } else {
        "delete_anonymized"
    };
    let lifecycle_stage = if resolution == "archive" {
        "archived"
    } else {
        "deleted"
    };

    // A failed lead no longer needs the order opened while it was prepared:
    // it is withdrawn in this transaction, so the order list never shows an
    // active order of an archived or deleted lead.
    // The append-only audit (the order's cancellation and the lead's
    // resolution) keeps the reason as its code and only whether a text or a
    // note was typed (QA 2026-10-12, A3-02): an archived lead keeps both on its
    // row and in its history, which a later deletion clears.
    let withdrawn_orders = match crate::routes::orders::withdraw_lead_orders_in_tx(
        &mut tx,
        lead_id,
        auth.user_id,
        if resolution == "archive" {
            crate::routes::orders::LEAD_ARCHIVED_CANCELLATION_REASON
        } else {
            crate::routes::orders::LEAD_DELETED_CANCELLATION_REASON
        },
        anonymised_failure_reason(reason),
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    // The status change, the withdrawn orders, its audit row and the lead
    // history entry commit together.
    let lead_audit = audit::domain_event(
        "resolve_failed_lead",
        Some(auth.user_id),
        "lead",
        Some(lead_id),
        json!({
            "resolution": resolution.clone(),
            "reason": anonymised_failure_reason(reason),
            "reason_free_text": typed_reason,
            "note_present": typed_note,
            "failed_from_status": current_status.clone(),
        }),
    );
    let lifecycle = crate::routes::workflow_lifecycle::RecordEvent {
        entity_type: "lead",
        entity_id: lead_id,
        from_stage: Some(current_status.as_str()),
        to_stage: lifecycle_stage,
        transition_kind: lifecycle_stage,
        changed_by: Some(auth.user_id),
        note: Some(reason),
        metadata: json!({
            "resolution": outcome_status,
            "note": note,
        }),
    };
    let update_result = if resolution == "archive" {
        async {
            let result = sqlx::query(
                r#"UPDATE leads
                   SET qualification_status = 'archived',
                       status_changed_at = now(),
                       failed_outcome_status = 'archived',
                       failed_from_status = $2,
                       failed_reason = $3,
                       failed_note = $4,
                       failed_processed_at = now(),
                       failed_processed_by = $5
                   WHERE id = $1 AND converted_patient_id IS NULL AND failed_outcome_status='none'"#,
            )
            .bind(lead_id)
            .bind(current_status.clone())
            .bind(reason)
            .bind(note)
            .bind(auth.user_id)
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() > 0 {
                audit::write_in_transaction(&mut tx, &lead_audit).await?;
                crate::routes::workflow_lifecycle::insert_event(&mut tx, lifecycle).await?;
            }
            Ok::<_, sqlx::Error>((result, Vec::new()))
        }
        .await
    } else {
        purge_lead_and_prospect_in_tx(
            &mut tx,
            LeadPurge {
                lead_id,
                failed_from_status: Some(current_status.clone()),
                reason,
                system_note: None,
                processed_by: Some(auth.user_id),
                lead_audit,
                lifecycle,
            },
        )
        .await
        .map(|purged| (purged.result, purged.removed_blobs))
    };
    let update_result = match update_result {
        Ok((result, removed_blobs)) if result.rows_affected() > 0 => {
            if let Err(e) = tx.commit().await {
                tracing::error!(error = %e, lead_id = %lead_id, "commit failed-lead resolution");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to resolve failed lead",
                );
            }
            // The files of the purged documents go only after the commit.
            for storage_key in &removed_blobs {
                crate::routes::documents::remove_document_blob(storage_key).await;
            }
            crate::routes::orders::publish_withdrawn_lead_orders(
                &state,
                auth.user_id,
                &withdrawn_orders,
            )
            .await;
            Ok(result)
        }
        // Nothing changed: the transaction rolls back when it is dropped.
        Ok((result, _)) => Ok(result),
        Err(error) => Err(error),
    };

    match update_result {
        Ok(result) if result.rows_affected() > 0 => {
            // Realtime events are stored for catch-up: codes only (A3-02).
            crate::realtime::publish_lead_event(
                &state,
                Some(auth.user_id),
                "lead.failed_resolved",
                lead_id,
                json!({
                    "resolution": outcome_status,
                    "reason": anonymised_failure_reason(reason),
                    "note_present": note.is_some(),
                    "failed_from_status": current_status,
                }),
            )
            .await;

            let refreshed = match sqlx::query(
                r#"SELECT qualification_status,
                          converted_patient_id,
                          failed_outcome_status,
                          failed_from_status,
                          failed_reason,
                          failed_note,
                          failed_processed_at,
                          failed_processed_by,
                          created_at
                   FROM leads
                   WHERE id = $1"#,
            )
            .bind(lead_id)
            .fetch_one(&state.db)
            .await
            {
                Ok(row) => row,
                Err(e) => {
                    tracing::error!(error = %e, lead_id = %lead_id, "reload failed lead");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to resolve failed lead",
                    );
                }
            };

            let lifecycle = match load_lead_lifecycle(
                &state,
                lead_id,
                &refreshed
                    .try_get::<String, _>("qualification_status")
                    .unwrap_or_default(),
                &refreshed
                    .try_get::<String, _>("failed_outcome_status")
                    .unwrap_or_else(|_| "none".to_string()),
                refreshed
                    .try_get::<Option<Uuid>, _>("converted_patient_id")
                    .unwrap_or_default(),
                refreshed
                    .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .unwrap_or_else(|_| chrono::Utc::now()),
                refreshed
                    .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("failed_processed_at")
                    .unwrap_or_default(),
            )
            .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };

            Json(json!({
                "ok": true,
                "failed_outcome": failed_outcome_payload(&refreshed),
                "lifecycle": lifecycle,
            }))
            .into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, resolution, "resolve failed lead");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to resolve failed lead",
            )
        }
    }
}

async fn download_attachment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, attachment_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::LeadsView) {
        return e;
    }
    // Questionnaire uploads are medical records (see lead_without_medical_fields).
    if !lead_medical_visible(&auth) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match sqlx::query(
        r#"SELECT attachment.file_name, attachment.content_type, attachment.data,
                  imported.category, imported.art, imported.generated_template_id,
                  imported.compliance_kind
           FROM lead_attachments attachment
           LEFT JOIN documents imported ON imported.id = attachment.imported_document_id
           WHERE attachment.id = $1 AND attachment.lead_id = $2"#,
    )
    .bind(attachment_id)
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        // An upload imported as a consent document is a consent document:
        // closed to Concierge and Billing like the document itself.
        Ok(Some(row))
            if crate::routes::documents::consent_document_closed_to_role(auth.role, &row) =>
        {
            err(StatusCode::FORBIDDEN, "Insufficient permissions")
        }
        Ok(Some(row)) => {
            let file_name: String = row.try_get("file_name").unwrap_or_default();
            let content_type: Option<String> = row.try_get("content_type").ok().flatten();
            let data: Vec<u8> = row.try_get("data").unwrap_or_default();

            let mime = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
            let disposition = crate::content_disposition::attachment(&file_name);

            match axum::response::Response::builder()
                .header("content-type", mime)
                .header("content-disposition", disposition)
                .body(Body::from(data))
            {
                Ok(response) => response.into_response(),
                Err(error) => {
                    tracing::error!(error = %error, "build lead attachment download response");
                    err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to build attachment download",
                    )
                }
            }
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Attachment not found"),
        Err(e) => {
            tracing::error!(error = %e, "download lead attachment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

// ----------------------------------------------------------------------------
// Public intake from the visitor-facade wizard
// ----------------------------------------------------------------------------

fn required_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn required_env_any(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| required_env(name))
}

#[allow(clippy::result_large_err)]
fn check_shared_token(headers: &HeaderMap) -> Result<(), axum::response::Response> {
    let Some(expected) = required_env_any(&["LEAD_INTAKE_TOKEN", "GMED_LEAD_INTAKE_TOKEN"]) else {
        tracing::error!("LEAD_INTAKE_TOKEN / GMED_LEAD_INTAKE_TOKEN not configured");
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "Intake endpoint not configured",
        ));
    };
    let provided = headers
        .get("x-intake-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    // Both sides are hashed first so the comparison runs over equal-length
    // digests and does not stop at the first differing byte.
    if !crate::routes::lead_payer_link::same_hash(
        &crate::auth::tokens::hash_token(provided),
        &crate::auth::tokens::hash_token(expected.as_str()),
    ) {
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid intake token"));
    }
    Ok(())
}

fn str_opt(v: &Value) -> Option<String> {
    let s = v.as_str()?.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn str_opt_without_zero_placeholder(v: &Value) -> Option<String> {
    let s = v.as_str()?.trim();
    if s.is_empty() || s.chars().all(|c| c == '0') {
        None
    } else {
        Some(s.to_string())
    }
}

fn yes_no_to_bool(v: &Value) -> Option<bool> {
    match v.as_str()?.trim().to_ascii_lowercase().as_str() {
        "yes" | "true" => Some(true),
        "no" | "false" => Some(false),
        _ => None,
    }
}

fn bool_opt(v: &Value) -> Option<bool> {
    v.as_bool()
}

fn date_opt(v: &Value) -> Option<NaiveDate> {
    let s = v.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    ["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"]
        .into_iter()
        .find_map(|format| NaiveDate::parse_from_str(s, format).ok())
}

fn string_array(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn first_phone(phones: &Value) -> (Option<String>, Option<String>) {
    let Some(arr) = phones.as_array() else {
        return (None, None);
    };
    let Some(first) = arr.first() else {
        return (None, None);
    };
    let number = first.get("number").and_then(str_opt);
    let kind = first.get("type").and_then(str_opt);
    (number, kind)
}

fn public_intake_labels(source: Option<String>) -> (&'static str, &'static str, &'static str) {
    match source
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("contact") | Some("contact-form") | Some("website_contact") => (
            "website_contact",
            "Website Contact Form",
            "Lead created from website contact form",
        ),
        _ => (
            "visitor_facade",
            "Website Wizard",
            "Lead created from visitor facade",
        ),
    }
}

struct ParsedIntake {
    bundle: Value,
    files: Vec<ParsedFile>,
}

struct ParsedFile {
    file_name: String,
    content_type: Option<String>,
    data: Vec<u8>,
}

async fn parse_multipart(
    mut multipart: Multipart,
) -> Result<ParsedIntake, axum::response::Response> {
    let mut bundle_raw: Option<String> = None;
    let mut files: Vec<ParsedFile> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &format!("Invalid multipart: {e}")))?
    {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "bundle" => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| err(StatusCode::BAD_REQUEST, "Invalid bundle field"))?;
                if bytes.len() > MAX_BUNDLE_BYTES {
                    return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "Bundle too large"));
                }
                let text = String::from_utf8(bytes.to_vec())
                    .map_err(|_| err(StatusCode::BAD_REQUEST, "Bundle must be UTF-8"))?;
                bundle_raw = Some(text);
            }
            "files" => {
                if files.len() >= MAX_ATTACHMENTS {
                    return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "Too many attachments"));
                }
                let file_name = field
                    .file_name()
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| format!("attachment-{}", files.len() + 1));
                let content_type = field.content_type().map(|s| s.to_string());
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| err(StatusCode::BAD_REQUEST, "Failed to read attachment"))?;
                if bytes.is_empty() {
                    continue;
                }
                if bytes.len() > MAX_ATTACHMENT_BYTES {
                    return Err(err(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "Attachment exceeds 25MB limit",
                    ));
                }
                files.push(ParsedFile {
                    file_name,
                    content_type,
                    data: bytes.to_vec(),
                });
            }
            _ => {
                let _ = field.bytes().await;
            }
        }
    }

    let bundle_raw =
        bundle_raw.ok_or_else(|| err(StatusCode::BAD_REQUEST, "Missing bundle field"))?;
    let bundle: Value = serde_json::from_str(&bundle_raw)
        .map_err(|_| err(StatusCode::BAD_REQUEST, "Bundle is not valid JSON"))?;

    if !bundle.is_object() || !bundle.get("payload").is_some_and(|p| p.is_object()) {
        return Err(err(StatusCode::BAD_REQUEST, "Bundle payload missing"));
    }

    Ok(ParsedIntake { bundle, files })
}

async fn ingest_lead_intake(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> axum::response::Response {
    if let Err(resp) = check_shared_token(&headers) {
        return resp;
    }

    let mut parsed = match parse_multipart(multipart).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };

    for file in &mut parsed.files {
        let canonical_mime = match validate_lead_attachment(
            &file.file_name,
            file.content_type.as_deref(),
            &file.data,
        )
        .await
        {
            Ok(value) => value,
            Err(response) => return response,
        };
        file.content_type = Some(canonical_mime);
    }

    let payload = &parsed.bundle["payload"];
    let first_name = str_opt(&payload["firstName"]).unwrap_or_default();
    let last_name = str_opt(&payload["lastName"]).unwrap_or_default();

    if first_name.is_empty() || last_name.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "First and last name are required",
        );
    }

    let (primary_phone, primary_phone_type) = first_phone(&payload["phones"]);
    let email = str_opt(&payload["email"]);
    let date_of_birth = date_opt(&payload["dateOfBirth"]);
    let no_guardians = json!([]);
    if let Err(response) = validate_lead_contact_identity(
        &state,
        &LeadContactIdentity {
            lead_id: None,
            patient_ids: Vec::new(),
            first_name: &first_name,
            last_name: &last_name,
            date_of_birth,
            email: email.as_deref(),
            phone: primary_phone.as_deref(),
            guardians: &no_guardians,
        },
    )
    .await
    {
        return response;
    }
    let services = string_array(&payload["services"]);
    let phones_json = if payload["phones"].is_array() {
        payload["phones"].clone()
    } else {
        json!([])
    };

    let submitted_at = parsed.bundle.get("submittedAt").and_then(str_opt);
    let flow = parsed.bundle.get("flow").and_then(str_opt);
    let locale = parsed.bundle.get("locale").and_then(str_opt);
    let primary_language =
        normalize_intake_language(payload["primaryLanguage"].as_str(), locale.as_deref());
    let (intake_source, lead_source, lifecycle_note) =
        public_intake_labels(parsed.bundle.get("source").and_then(str_opt));

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let remote_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let submitted_at_parsed = submitted_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "lead intake: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Database error");
        }
    };

    let insert = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO leads (
            intake_source, flow, locale, submitted_at, source,
            first_name, middle_name, last_name, suffix, date_of_birth, legal_sex,
            email, email_consent, phone, primary_phone_type, phones,
            whatsapp_consent, whatsapp_number,
            country, street_address, city, state, zip_code,
            primary_language, needs_interpreter,
            location, location_detailed, wants_membership, selected_program,
            can_travel, has_medical_records, records_in_accepted_language, has_travel_documents,
            currently_in_treatment, has_health_risk_for_travel,
            primary_concern_text, additional_concerns,
            services, has_insurance, insurance_covers_germany,
            preferred_location, visit_timing, message,
            consent_automated_contact, consent_healthcare,
            consent_opt_out, consent_privacy_practices,
            raw_payload, remote_ip, user_agent, qualification_status
        ) VALUES (
            $49, $1, $2, $3, $50,
            $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14,
            $15, $16,
            $17, $18, $19, $20, $21,
            $22, $23,
            $24, $25, $26, $27,
            $28, $29, $30, $31,
            $32, $33,
            $34, $35,
            $36, $37, $38,
            $39, $40, $41,
            $42, $43, $44, $45,
            $46, $47::inet, $48, 'new'
        ) RETURNING id"#,
    )
    .bind(flow)
    .bind(locale)
    .bind(submitted_at_parsed)
    .bind(&first_name)
    .bind(str_opt(&payload["middleName"]))
    .bind(&last_name)
    .bind(str_opt(&payload["suffix"]))
    .bind(date_of_birth)
    .bind(str_opt(&payload["legalSex"]))
    .bind(email)
    .bind(bool_opt(&payload["emailConsent"]))
    .bind(primary_phone)
    .bind(primary_phone_type)
    .bind(phones_json)
    .bind(bool_opt(&payload["whatsappConsent"]))
    .bind(str_opt(&payload["whatsappNumber"]))
    .bind(str_opt(&payload["country"]))
    .bind(str_opt(&payload["streetAddress"]))
    .bind(str_opt(&payload["city"]))
    .bind(str_opt_without_zero_placeholder(&payload["state"]))
    .bind(str_opt_without_zero_placeholder(&payload["zipCode"]))
    .bind(primary_language)
    .bind(yes_no_to_bool(&payload["needsInterpreter"]))
    .bind(str_opt(&payload["location"]))
    .bind(str_opt(&payload["locationDetailed"]))
    .bind(yes_no_to_bool(&payload["wantsMembership"]))
    .bind(str_opt(&payload["selectedProgram"]))
    .bind(yes_no_to_bool(&payload["canTravel"]))
    .bind(str_opt(&payload["hasMedicalRecords"]))
    .bind(yes_no_to_bool(&payload["recordsInAcceptedLanguage"]))
    .bind(yes_no_to_bool(&payload["hasTravelDocuments"]))
    .bind(yes_no_to_bool(&payload["currentlyInTreatment"]))
    .bind(yes_no_to_bool(&payload["hasHealthRiskForTravel"]))
    .bind(str_opt(&payload["primaryConcernText"]))
    .bind(str_opt(&payload["additionalConcerns"]))
    .bind(services)
    .bind(yes_no_to_bool(&payload["hasInsurance"]))
    .bind(str_opt(&payload["insuranceCoversGermany"]))
    .bind(str_opt(&payload["preferredLocation"]))
    .bind(str_opt(&payload["visitTiming"]))
    .bind(str_opt(&payload["message"]))
    .bind(
        payload["consentAutomatedContact"]
            .as_bool()
            .unwrap_or(false),
    )
    .bind(payload["consentHealthcare"].as_bool().unwrap_or(false))
    .bind(payload["consentOptOut"].as_bool().unwrap_or(false))
    .bind(
        payload["consentPrivacyPractices"]
            .as_bool()
            .unwrap_or(false),
    )
    .bind(&parsed.bundle)
    .bind(remote_ip)
    .bind(user_agent)
    .bind(intake_source)
    .bind(lead_source)
    .fetch_one(&mut *tx)
    .await;

    let lead_id = match insert {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "lead intake: insert");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to store lead");
        }
    };

    for file in &parsed.files {
        let attach = sqlx::query(
            r#"INSERT INTO lead_attachments
                (lead_id, file_name, content_type, size_bytes, data)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(lead_id)
        .bind(&file.file_name)
        .bind(&file.content_type)
        .bind(file.data.len() as i64)
        .bind(&file.data)
        .execute(&mut *tx)
        .await;

        if let Err(e) = attach {
            tracing::error!(error = %e, lead = %lead_id, "lead intake: attachment insert");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to store attachment",
            );
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "lead intake: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Database error");
    }

    tracing::info!(
        lead_id = %lead_id,
        attachments = parsed.files.len(),
        "lead intake stored from visitor facade"
    );

    if let Err(resp) = crate::routes::workflow_lifecycle::record_event(
        &state,
        crate::routes::workflow_lifecycle::RecordEvent {
            entity_type: "lead",
            entity_id: lead_id,
            from_stage: None,
            to_stage: "new",
            transition_kind: "created",
            changed_by: None,
            note: Some(lifecycle_note),
            metadata: json!({
                "source": lead_source,
                "intake_source": intake_source,
                "attachment_count": parsed.files.len(),
            }),
        },
    )
    .await
    {
        return resp;
    }
    crate::realtime::publish_lead_event(
        &state,
        None,
        "lead.created",
        lead_id,
        json!({
            "source": lead_source,
            "intake_source": intake_source,
            "attachment_count": parsed.files.len(),
        }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "lead_id": lead_id,
            "attachment_count": parsed.files.len(),
        })),
    )
        .into_response()
}

// ============================================================================
// GDPR Art. 5(1)(e) storage-limitation enforcement
// ============================================================================
//
// A lead that never converted into a patient carries a full intake payload —
// medical concerns, phone numbers, insurance status, consent flags. Keeping
// those rows indefinitely is a direct Storage Limitation breach.
//
// The flow is:
//   1. A `failed_outcome_status = 'archived'` row ages past the retention
//      window read from `system_settings.cleanup_archived_leads_days`.
//   2. The background sweeper spawned in `main::spawn_lead_purger` calls
//      `auto_purge_stale_archived` once per day.
//   3. `auto_purge_stale_archived` selects candidates, runs the same NULL
//      blob that the manual `resolve_failed_lead` / `delete_anonymized`
//      resolution uses — extracted into `anonymize_lead_pii` — deletes the
//      attachments, and records a domain-level audit event so the auditor
//      can reconstruct *which* lead was erased *when* and *why*.
//
// The pure decision function `should_auto_purge` exists so the age /
// already-anonymised guard is unit-testable without a database.

/// Identification sentinels left by the anonymisation blob. Used by the
/// sweeper to detect leads that have already been purged and should not be
/// touched again.
pub const ANONYMIZED_FIRST_NAME: &str = "Deleted";
pub const ANONYMIZED_LAST_NAME: &str = "Lead";

/// Default retention window in days when the `cleanup_archived_leads_days`
/// system setting is missing or unparseable.
pub const DEFAULT_ARCHIVED_LEAD_RETENTION_DAYS: i64 = 180;

/// Summary of a single purge sweep, logged and returned so operators and
/// future readers can see how much the sweeper actually did.
#[derive(Debug, Default, Clone, Copy)]
pub struct LeadPurgeReport {
    pub retention_days: i64,
    pub scanned: u64,
    pub anonymized: u64,
    pub errors: u64,
}

/// Anonymise every PII field on a lead row in-place. This is the single
/// source of truth for what "delete a lead" means at the database layer;
/// both the manual `resolve_failed_lead` handler and the background
/// sweeper funnel through it.
///
/// What staff typed stays nowhere on the anonymised row (QA 2026-10-12): the
/// failure reason keeps only a listed code ([`anonymised_failure_reason`]),
/// and the note only a fixed system text (`system_note`, a `'static` string,
/// so a typed note cannot be passed). Nor outside it (A3-02): the lead
/// history and the audit rows lose staff's words in the same transaction
/// ([`scrub_lead_free_text_in_tx`]); what was scrubbed is returned for the
/// caller's audit row.
pub(crate) async fn anonymize_lead_pii(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
    failed_from_status: Option<String>,
    reason: &str,
    system_note: Option<&'static str>,
    processed_by: Option<Uuid>,
) -> Result<(sqlx::postgres::PgQueryResult, LeadFreeTextScrub), sqlx::Error> {
    let reason = anonymised_failure_reason(reason);
    super::lead_portal_plan_requests::erase_for_lead_in_tx(conn, lead_id).await?;
    // The payer declaration of an unconverted lead goes with it (a converted
    // one belongs to the patient record and is kept, § 8 Abs. 4 GwG). The
    // lead's own GwG statements from the cabinet, what the cabinet holds about
    // the lead's representatives, staff's confirmations of the own-account
    // payments (§ 12 Abs. 1 GwG), the payer's own statement and links
    // (phase 3a; the link e-mails go with the links) and the invoice
    // recipient of step 3 (2026-10-11) follow the same rule.
    let result = sqlx::query(
        r#"WITH removed_payer AS (
               DELETE FROM lead_payer_declarations
               WHERE lead_id = $1 AND patient_id IS NULL
           ), removed_payer_statement AS (
               DELETE FROM lead_payer_statements payer_statement
               USING leads lead
               WHERE payer_statement.lead_id = $1
                 AND lead.id = payer_statement.lead_id
                 AND lead.converted_patient_id IS NULL
           ), removed_payer_links AS (
               DELETE FROM lead_payer_links payer_link
               USING leads lead
               WHERE payer_link.lead_id = $1
                 AND lead.id = payer_link.lead_id
                 AND lead.converted_patient_id IS NULL
           ), removed_representatives AS (
               DELETE FROM lead_representatives representatives
               USING leads lead
               WHERE representatives.lead_id = $1
                 AND lead.id = representatives.lead_id
                 AND lead.converted_patient_id IS NULL
           ), removed_statements AS (
               DELETE FROM lead_gwg_declarations statements
               USING leads lead
               WHERE statements.lead_id = $1
                 AND lead.id = statements.lead_id
                 AND lead.converted_patient_id IS NULL
           ), removed_identification_payments AS (
               DELETE FROM lead_identification_payments payments
               USING leads lead
               WHERE payments.lead_id = $1
                 AND lead.id = payments.lead_id
                 AND lead.converted_patient_id IS NULL
           ), removed_invoice_recipient AS (
               DELETE FROM lead_invoice_recipients recipient
               USING leads lead
               WHERE recipient.lead_id = $1
                 AND lead.id = recipient.lead_id
                 AND lead.converted_patient_id IS NULL
           )
           UPDATE leads
           SET first_name = 'Deleted',
               middle_name = NULL,
               citizenships = '{}'::text[],
               last_name = 'Lead',
               suffix = NULL,
               date_of_birth = NULL,
               legal_sex = NULL,
               email = NULL,
               email_consent = NULL,
               phone = NULL,
               primary_phone_type = NULL,
               phones = '[]'::jsonb,
               whatsapp_consent = NULL,
               whatsapp_number = NULL,
               source = 'Deleted',
               country = NULL,
               street_address = NULL,
               city = NULL,
               state = NULL,
               zip_code = NULL,
               primary_language = NULL,
               needs_interpreter = NULL,
               location = NULL,
               location_detailed = NULL,
               wants_membership = NULL,
               selected_program = NULL,
               can_travel = NULL,
               has_medical_records = NULL,
               records_in_accepted_language = NULL,
               has_travel_documents = NULL,
               currently_in_treatment = NULL,
               has_health_risk_for_travel = NULL,
               primary_concern_text = NULL,
               additional_concerns = NULL,
               services = '{}'::text[],
               has_insurance = NULL,
               insurance_covers_germany = NULL,
               insurance_provider = NULL,
               insurance_number = NULL,
               insurance_type = NULL,
               trusted_contact_name = NULL,
               trusted_contact_phone = NULL,
               trusted_contact_email = NULL,
               trusted_contact_relation = NULL,
               trusted_contact_birth_date = NULL,
               trusted_contact_address = NULL,
               trusted_contacts = '[]'::jsonb,
               portal_trusted_persons = '[]'::jsonb,
               referrer_patient_id = NULL,
               preferred_location = NULL,
               visit_timing = NULL,
               message = NULL,
               consent_automated_contact = false,
               consent_healthcare = false,
               consent_opt_out = false,
               consent_privacy_practices = false,
               raw_payload = NULL,
               remote_ip = NULL,
               user_agent = NULL,
               notes = NULL,
               -- The wizard draft repeats what the columns above held (referrer,
               -- passport expiry, AML answers, the commercial draft): none of it
               -- is needed on a deleted lead.
               wizard_state = '{}'::jsonb,
               requested_specialties = '[]'::jsonb,
               qualification_status = 'deleted',
               status_changed_at = now(),
               failed_outcome_status = 'delete_anonymized',
               failed_from_status = $2,
               failed_reason = $3,
               failed_note = $4,
               failed_processed_at = now(),
               failed_processed_by = $5
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(failed_from_status)
    .bind(reason)
    .bind(system_note)
    .bind(processed_by)
    .execute(&mut *conn)
    .await?;
    let scrubbed = if result.rows_affected() > 0 {
        scrub_lead_free_text_in_tx(conn, lead_id).await?
    } else {
        LeadFreeTextScrub::default()
    };
    Ok((result, scrubbed))
}

/// The reasons staff pick when a lead does not fit (frontend
/// `lead-failure-reasons.ts`), and «Другое».
const LEAD_FAILURE_REASON_CODES: [&str; 7] = [
    "not_our_lead",
    "no_response",
    "patient_declined",
    "other_provider",
    "costs",
    "duplicate",
    "other",
];

/// The failure reason an anonymised lead keeps: a listed reason or a system
/// code (`auto_purge_storage_limitation`, `dsgvo_erasure`, … — lower-case
/// letters, digits and at least one `_`); anything staff wrote in their own
/// words (the text of «Другое» may name a person or a diagnosis) becomes
/// `other` (QA 2026-10-12).
pub(crate) fn anonymised_failure_reason(reason: &str) -> &str {
    let reason = reason.trim();
    let system_code = reason.contains('_')
        && reason.len() <= 64
        && reason
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_');
    if LEAD_FAILURE_REASON_CODES.contains(&reason) || system_code {
        reason
    } else {
        "other"
    }
}

/// Whether a failure reason is staff's own words rather than a listed or
/// system code ([`anonymised_failure_reason`]); a blank reason is none.
pub(crate) fn failure_reason_is_free_text(reason: &str) -> bool {
    let reason = reason.trim();
    !reason.is_empty() && anonymised_failure_reason(reason) != reason
}

/// What an erased free text in `audit_log.context` becomes (owner decision
/// 2026-10-12, QA A3-02): a neutral marker in place of staff's words, the row
/// and its codes stay.
pub(crate) const ERASED_AUDIT_TEXT: &str = "[erased]";

/// The lead history entries whose note is the failure reason: a status
/// change (to "not qualified"), an archiving, a deletion.
const REASON_TRANSITIONS: [&str; 3] = ["status_change", "archived", "deleted"];

/// What the anonymisation of a lead scrubbed outside its row.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub(crate) struct LeadFreeTextScrub {
    pub lifecycle_events: u64,
    pub audit_rows: u64,
    pub realtime_events: u64,
}

/// The lead history entry with staff's words removed: the reason of a status
/// change, an archiving or a deletion becomes its code, the internal note in
/// the metadata goes. `None` when nothing changes.
fn scrubbed_lifecycle_event(
    transition_kind: &str,
    note: Option<&str>,
    metadata: &Value,
) -> Option<(Option<String>, Value)> {
    let next_note = match note {
        Some(note) if REASON_TRANSITIONS.contains(&transition_kind) => {
            Some(anonymised_failure_reason(note).to_string())
        }
        other => other.map(str::to_string),
    };
    let mut next_metadata = metadata.clone();
    if let Some(object) = next_metadata.as_object_mut()
        && object.get("note").is_some_and(|note| !note.is_null())
    {
        object.remove("note");
    }
    (next_note.as_deref() != note || &next_metadata != metadata)
        .then_some((next_note, next_metadata))
}

/// An audit context with staff's words about a failed lead replaced by
/// [`ERASED_AUDIT_TEXT`]: a reason that is no code (`reason` of
/// `qualify_lead` and `resolve_failed_lead`, `lead_reason` of the order's
/// `cancel_order`) and any internal note (`note`). Keys, codes, flags and
/// every other value stay — the database lets nothing else change (migration
/// `20261012194730_audit_log_erasure_text_scrub.sql`). `None` when nothing
/// changes.
fn scrubbed_audit_context(context: &Value) -> Option<Value> {
    let mut next = context.clone();
    let object = next.as_object_mut()?;
    for key in ["reason", "lead_reason"] {
        if let Some(Value::String(text)) = object.get_mut(key)
            && failure_reason_is_free_text(text.as_str())
            && text.as_str() != ERASED_AUDIT_TEXT
        {
            *text = ERASED_AUDIT_TEXT.to_string();
        }
    }
    if let Some(Value::String(text)) = object.get_mut("note")
        && text.as_str() != ERASED_AUDIT_TEXT
    {
        *text = ERASED_AUDIT_TEXT.to_string();
    }
    (next != *context).then_some(next)
}

/// Staff's words about a lead outside its row, scrubbed when the lead is
/// deleted and anonymised — by staff, by a retention rule or with the DSGVO
/// erasure of its patient (QA 2026-10-12, A3-02; owner decision 2026-10-12):
///
/// * the lead history (`workflow_lifecycle_events`): the reason of a status
///   change, an archiving or a deletion keeps only its code, the internal
///   note goes;
/// * `audit_log`: the free-text reason and the note of `qualify_lead`,
///   `resolve_failed_lead` and of the `cancel_order` rows of the lead's
///   orders become [`ERASED_AUDIT_TEXT`]. The log stays append-only: the
///   trigger lets only text values of `context` change, and only while the
///   transaction-local setting `gmed.dsgvo_erasure` is on — switched on for
///   these statements alone.
pub(crate) async fn scrub_lead_free_text_in_tx(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
) -> Result<LeadFreeTextScrub, sqlx::Error> {
    let mut scrubbed = LeadFreeTextScrub::default();
    let events: Vec<(Uuid, String, Option<String>, Value)> = sqlx::query_as(
        r#"SELECT id, transition_kind, note, metadata
           FROM workflow_lifecycle_events
           WHERE entity_type = 'lead' AND entity_id = $1
           FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    for (id, transition_kind, note, metadata) in events {
        if let Some((note, metadata)) =
            scrubbed_lifecycle_event(&transition_kind, note.as_deref(), &metadata)
        {
            sqlx::query(
                "UPDATE workflow_lifecycle_events SET note = $2, metadata = $3 WHERE id = $1",
            )
            .bind(id)
            .bind(note)
            .bind(metadata)
            .execute(&mut *conn)
            .await?;
            scrubbed.lifecycle_events += 1;
        }
    }
    // The stored realtime events of the lead (catch-up of open pages) repeat
    // what changed, the reason of an archiving with its note among it; a
    // deleted lead needs none of them.
    scrubbed.realtime_events =
        sqlx::query("DELETE FROM realtime_events WHERE entity_type = 'lead' AND entity_id = $1")
            .bind(lead_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
    let rows: Vec<(i64, Value)> = sqlx::query_as(
        r#"SELECT id, context
           FROM audit_log
           WHERE context IS NOT NULL
             AND ((entity_type = 'lead' AND entity_id = $1
                   AND action IN ('qualify_lead', 'resolve_failed_lead'))
                  OR (entity_type = 'order' AND action = 'cancel_order'
                      AND context ->> 'source_lead_id' = $1::text))"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    let changes: Vec<(i64, Value)> = rows
        .iter()
        .filter_map(|(id, context)| scrubbed_audit_context(context).map(|next| (*id, next)))
        .collect();
    if !changes.is_empty() {
        sqlx::query("SELECT set_config('gmed.dsgvo_erasure', 'on', true)")
            .execute(&mut *conn)
            .await?;
        for (id, context) in &changes {
            sqlx::query("UPDATE audit_log SET context = $2 WHERE id = $1")
                .bind(id)
                .bind(context)
                .execute(&mut *conn)
                .await?;
        }
        sqlx::query("SELECT set_config('gmed.dsgvo_erasure', 'off', true)")
            .execute(&mut *conn)
            .await?;
        scrubbed.audit_rows = changes.len() as u64;
    }
    sqlx::query("SELECT set_config('gmed.dsgvo_erasure', 'on', true)")
        .execute(&mut *conn)
        .await?;
    let payer_rows = sqlx::query(
        r#"UPDATE audit_log a
           SET old_value = gmed_scrub_jsonb_text(a.old_value, '(?s)^.+$', '[erased]'),
               new_value = gmed_scrub_jsonb_text(a.new_value, '(?s)^.+$', '[erased]')
           WHERE ((a.entity_type = 'lead' AND a.entity_id = $1
                   AND a.action IN ('update_lead_payer_declaration', 'lead_portal_update_payer_declaration',
                                    'payer_link_adopt_payer_declaration'))
                  OR (a.entity_type = 'order' AND a.action = 'set_order_payer'
                      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = a.entity_id
                          AND o.source_lead_id = $1)))
             AND (a.old_value IS DISTINCT FROM gmed_scrub_jsonb_text(a.old_value, '(?s)^.+$', '[erased]')
                  OR a.new_value IS DISTINCT FROM gmed_scrub_jsonb_text(a.new_value, '(?s)^.+$', '[erased]'))"#,
    ).bind(lead_id).execute(&mut *conn).await?.rows_affected();
    sqlx::query("SELECT set_config('gmed.dsgvo_erasure', 'off', true)")
        .execute(&mut *conn)
        .await?;
    scrubbed.audit_rows += payer_rows;
    Ok(scrubbed)
}

/// One lead deletion for [`purge_lead_and_prospect`]: what is recorded on the
/// lead, the audit row and the lead history entry written with it.
struct LeadPurge<'a> {
    lead_id: Uuid,
    failed_from_status: Option<String>,
    reason: &'a str,
    /// A fixed system text only: a note staff typed never stays on the row.
    system_note: Option<&'static str>,
    processed_by: Option<Uuid>,
    lead_audit: audit::AuditEvent,
    lifecycle: crate::routes::workflow_lifecycle::RecordEvent<'a>,
}

/// What a lead purge did, for the caller to finish after its commit.
struct LeadPurgeOutcome {
    result: sqlx::postgres::PgQueryResult,
    /// The prospect patient that was deleted with the lead.
    purged_prospect: Option<Uuid>,
    /// Stored files of the removed documents. They are deleted from disk only
    /// after the commit, so a failed purge keeps them.
    removed_blobs: Vec<String>,
}

/// Anonymise the lead and, in the same transaction, remove what it owns: its
/// documents and attachments, and its prospect patient when that patient is
/// still `prospective` and the lead never converted. A prospect has no
/// independent retention basis (GDPR Art. 5(1)(e)); the CASCADE removes its
/// clinical record and funnel case. Active or attached patients are never
/// touched — the guard is in the WHERE clause. When the lead is anonymised,
/// its audit row, the audit row of the prospect and the lead history entry
/// commit in the same transaction.
async fn purge_lead_and_prospect(
    pool: &gmed_db::DbPool,
    purge: LeadPurge<'_>,
) -> Result<(sqlx::postgres::PgQueryResult, Option<Uuid>), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let purged = purge_lead_and_prospect_in_tx(&mut tx, purge).await?;
    tx.commit().await?;
    for storage_key in &purged.removed_blobs {
        crate::routes::documents::remove_document_blob(storage_key).await;
    }
    Ok((purged.result, purged.purged_prospect))
}

/// [`purge_lead_and_prospect`] inside the caller's transaction, so the
/// failed-lead workflow withdraws the lead's order in the same commit. The
/// caller removes [`LeadPurgeOutcome::removed_blobs`] after its commit.
async fn purge_lead_and_prospect_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    purge: LeadPurge<'_>,
) -> Result<LeadPurgeOutcome, sqlx::Error> {
    let LeadPurge {
        lead_id,
        failed_from_status,
        reason,
        system_note,
        processed_by,
        lead_audit,
        lifecycle,
    } = purge;
    let purge_candidate: Option<Uuid> = sqlx::query_scalar(
        r#"SELECT p.id
           FROM leads l
           JOIN patients p ON p.id = l.prospect_patient_id
           WHERE l.id = $1
             AND p.lifecycle_status = 'prospective'
             AND l.converted_patient_id IS NULL
           FOR UPDATE OF l, p"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut **tx)
    .await?;
    // Invoices and signed contracts cascade from `patients`: a prospect that
    // carries accounting records is left alone (§ 257 HGB, § 147 AO).
    let purge_candidate = match purge_candidate {
        Some(patient_id) if prospect_has_accounting_records(tx, patient_id).await? => None,
        other => other,
    };

    let removed_blobs = purge_lead_documents_in_tx(tx, lead_id, purge_candidate).await?;
    purge_lead_side_records_in_tx(tx, lead_id).await?;
    let prospect = match purge_candidate {
        Some(patient_id) => Some(purge_prospect_patient_in_tx(tx, lead_id, patient_id).await?),
        None => None,
    };
    // The patient login lives as long as the lead (owner decision 2026-10-03).
    crate::routes::lead_portal_account::disable_for_lead_in_tx(tx, lead_id, processed_by).await?;

    let (result, scrubbed) = anonymize_lead_pii(
        tx,
        lead_id,
        failed_from_status,
        reason,
        system_note,
        processed_by,
    )
    .await?;
    if result.rows_affected() > 0 {
        // The deletion's own audit row says what it scrubbed in the history
        // and the audit (QA 2026-10-12, A3-02).
        let mut lead_audit = lead_audit;
        if let Some(context) = lead_audit.context.as_object_mut() {
            context.insert("scrubbed_free_text".to_string(), json!(scrubbed));
        }
        audit::write_in_transaction(tx, &lead_audit).await?;
        if let Some(prospect) = prospect {
            let (action, prospect_id) = match prospect {
                ProspectPurge::Deleted(id) => ("purge_prospect_patient", id),
                ProspectPurge::Anonymized(id) => ("anonymize_prospect_patient", id),
            };
            audit::write_in_transaction(
                tx,
                &audit::domain_event(
                    action,
                    processed_by,
                    "patient",
                    Some(prospect_id),
                    json!({
                        "reason": "storage_limitation_retention",
                        "source_lead_id": lead_id,
                        "gdpr_article": "5(1)(e)",
                    }),
                ),
            )
            .await?;
        }
        crate::routes::workflow_lifecycle::insert_event(tx, lifecycle).await?;
    }
    Ok(LeadPurgeOutcome {
        result,
        purged_prospect: match prospect {
            Some(ProspectPurge::Deleted(id)) => Some(id),
            _ => None,
        },
        removed_blobs,
    })
}

/// How the prospect patient of a purged lead was removed.
#[derive(Clone, Copy)]
enum ProspectPurge {
    Deleted(Uuid),
    /// Something still refers to the patient (an appointment, a task, a
    /// document with signature history), so the row stays without any identity.
    Anonymized(Uuid),
}

async fn prospect_has_accounting_records(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM invoices WHERE patient_id = $1)
               OR EXISTS (SELECT 1 FROM external_invoices WHERE patient_id = $1)
               OR EXISTS (
                   SELECT 1 FROM framework_contracts
                   WHERE patient_id = $1 AND status = 'signed'
               )"#,
    )
    .bind(patient_id)
    .fetch_one(&mut **tx)
    .await
}

/// A commercial document that was signed, or an invoice, stays with its file:
/// commercial and tax law oblige the agency to keep it (§ 257 HGB, § 147 AO;
/// Art. 17 Abs. 3 lit. b DSGVO). Drafts of contracts and estimates do not.
const LEAD_DOCUMENT_RETAINED_SQL: &str = r#"(
    lower(concat_ws(' ', category, art, generated_template_id)) ~ '(invoice|rechnung)'
    OR (
        signed_at IS NOT NULL
        AND lower(concat_ws(' ', category, art, generated_template_id, compliance_kind))
            ~ '(contract|vertrag|order|auftrag)'
    )
    -- A live electronic signature result (signed PDF or bundle) is the legal
    -- original of what was signed and is immutable (Art. 17 Abs. 3 lit. b, e
    -- DSGVO); test (DEMO) evidence has no legal value and goes with the lead.
    OR (
        COALESCE(ursprung, '') IN ('electronic_signature', 'electronic_signature_package')
        AND NOT EXISTS (
            SELECT 1 FROM document_signature_requests signature_request
            WHERE signature_request.result_document_id = documents.id
              AND signature_request.test_mode
        )
        AND NOT EXISTS (
            SELECT 1 FROM document_signature_members signature_member
            JOIN document_signature_requests signature_request
              ON signature_request.id = signature_member.request_id
            WHERE signature_member.result_document_id = documents.id
              AND signature_request.test_mode
        )
    )
)"#;

/// Removes the documents a purged lead owns, and those of its prospect patient
/// when that patient goes with it. A row nothing else refers to is deleted; a
/// document with signature or review history keeps an empty row without file,
/// name or text. Returns the stored files to remove after the commit.
async fn purge_lead_documents_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    prospect_patient_id: Option<Uuid>,
) -> Result<Vec<String>, sqlx::Error> {
    // Newest version first: a version chain is deleted from its tip.
    let owned: Vec<(Uuid, Option<String>)> = sqlx::query_as(&format!(
        r#"SELECT id, storage_key
           FROM documents
           WHERE (lead_id = $1 OR ($2::uuid IS NOT NULL AND patient_id = $2))
             AND NOT {LEAD_DOCUMENT_RETAINED_SQL}
           ORDER BY version_number DESC, created_at DESC
           FOR UPDATE"#
    ))
    .bind(lead_id)
    .bind(prospect_patient_id)
    .fetch_all(&mut **tx)
    .await?;
    // A translation generated as a document of its own belongs to neither the
    // lead nor a patient when its source was the lead's: it goes with its
    // source (derived content), and first, as it names the source.
    let owned_ids: Vec<Uuid> = owned.iter().map(|(id, _)| *id).collect();
    let translated =
        crate::routes::documents::translated_documents_of_in_tx(tx, &owned_ids).await?;
    let mut documents: Vec<(Uuid, Option<String>)> = if translated.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as(&format!(
            r#"SELECT id, storage_key
               FROM documents
               WHERE id = ANY($1)
                 AND NOT {LEAD_DOCUMENT_RETAINED_SQL}
               ORDER BY version_number DESC, created_at DESC
               FOR UPDATE"#
        ))
        .bind(&translated)
        .fetch_all(&mut **tx)
        .await?
    };
    documents.extend(owned);

    let mut removed_blobs = Vec::new();
    for (document_id, storage_key) in documents {
        if let Some(storage_key) = storage_key.filter(|key| !key.trim().is_empty()) {
            removed_blobs.push(storage_key);
        }
        let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
        let deleted = async {
            // The draft of a clinical import repeats the text of the document.
            sqlx::query("DELETE FROM clinical_document_imports WHERE document_id = $1")
                .bind(document_id)
                .execute(&mut *savepoint)
                .await?;
            sqlx::query("DELETE FROM documents WHERE id = $1")
                .bind(document_id)
                .execute(&mut *savepoint)
                .await
        }
        .await;
        match deleted {
            Ok(_) => savepoint.commit().await?,
            Err(sqlx::Error::Database(_)) => {
                savepoint.rollback().await?;
                sqlx::query(
                    r#"UPDATE documents
                       SET status = 'archived',
                           visibility = 'internal',
                           storage_key = NULL,
                           auto_name = 'Deleted document',
                           original_filename = NULL,
                           notes = NULL,
                           extracted_text = NULL,
                           source_person = NULL,
                           source_institution = NULL,
                           addressee_person = NULL,
                           addressee_institution = NULL,
                           generated_bindings = NULL,
                           generated_manual_text = NULL,
                           file_deleted_at = COALESCE(file_deleted_at, now()),
                           file_delete_reason = COALESCE(file_delete_reason, 'lead_purge')
                       WHERE id = $1"#,
                )
                .bind(document_id)
                .execute(&mut **tx)
                .await?;
                // The kept row loses the texts derived from its file too
                // (translations, import drafts), as with a deleted file.
                let derived = crate::routes::documents::purge_document_derived_content_in_tx(
                    tx,
                    &[document_id],
                    None,
                )
                .await?;
                removed_blobs.extend(derived.translated_document_files);
            }
            Err(error) => return Err(error),
        }
    }
    Ok(removed_blobs)
}

/// Copies of the lead outside its row: the questionnaire attachments, the
/// notifications that name it, its custom field values and a contract draft.
async fn purge_lead_side_records_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM lead_attachments WHERE lead_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    // Sanctions screening results follow the lead's retention.
    crate::sanctions::screening::purge_for_lead_in_tx(tx, lead_id).await?;
    sqlx::query("DELETE FROM user_notifications WHERE entity_type = 'lead' AND entity_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        r#"DELETE FROM custom_field_values
           WHERE entity_id = $1
             AND field_id IN (SELECT id FROM custom_fields WHERE entity_type = 'lead')"#,
    )
    .bind(lead_id)
    .execute(&mut **tx)
    .await?;
    // The payer's data copied onto the lead's orders (`set_order_payer`); an
    // order with an invoice keeps its recipient for accounting (QA 2026-10-30).
    sqlx::query(
        r#"UPDATE orders o
           SET payer_contact_name = NULL, payer_contact_email = NULL,
               payer_contact_phone = NULL, payer_contact_relationship = NULL,
               payer_notes = NULL, payer_address_street = NULL, payer_address_zip = NULL,
               payer_address_city = NULL, payer_address_country = NULL,
               payer_role = NULL, payer_contact_is_organisation = NULL
           WHERE o.source_lead_id = $1
             AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
             AND NOT EXISTS (SELECT 1 FROM external_invoices e WHERE e.order_id = o.id)"#,
    )
    .bind(lead_id)
    .execute(&mut **tx)
    .await?;
    // A framework contract that was never signed is a draft; a signed one, or
    // one an order refers to, stays.
    sqlx::query(
        r#"DELETE FROM framework_contracts fc
           WHERE fc.lead_id = $1
             AND fc.status <> 'signed'
             AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.contract_id = fc.id)"#,
    )
    .bind(lead_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Deletes the prospect patient of a purged lead with its clinical record. A
/// cancelled preparation order keeps only its link to the lead. When anything
/// else still refers to the patient, the row is anonymised instead.
async fn purge_prospect_patient_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
) -> Result<ProspectPurge, sqlx::Error> {
    let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
    let deleted = async {
        sqlx::query(
            r#"UPDATE order_leistungen SET patient_id = NULL
               WHERE patient_id = $1
                 AND order_id IN (SELECT id FROM orders WHERE source_lead_id = $2)"#,
        )
        .bind(patient_id)
        .bind(lead_id)
        .execute(&mut *savepoint)
        .await?;
        sqlx::query(
            "UPDATE orders SET patient_id = NULL WHERE patient_id = $1 AND source_lead_id = $2",
        )
        .bind(patient_id)
        .bind(lead_id)
        .execute(&mut *savepoint)
        .await?;
        // The audit trigger permits this only while the locked patient is still
        // prospective and its source lead is unconverted. Delete explicitly so
        // the subsequent patient cascade never collides with audit immutability.
        sqlx::query("DELETE FROM patient_clinical_versions WHERE patient_id = $1")
            .bind(patient_id)
            .execute(&mut *savepoint)
            .await?;
        sqlx::query_scalar::<_, Uuid>(
            "DELETE FROM patients WHERE id = $1 AND lifecycle_status = 'prospective' RETURNING id",
        )
        .bind(patient_id)
        .fetch_optional(&mut *savepoint)
        .await
    }
    .await;
    match deleted {
        Ok(Some(id)) => {
            savepoint.commit().await?;
            return Ok(ProspectPurge::Deleted(id));
        }
        Ok(None) | Err(sqlx::Error::Database(_)) => savepoint.rollback().await?,
        Err(error) => return Err(error),
    }
    // The drafts of clinical imports repeat the text of the patient's documents.
    let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
    match sqlx::query("DELETE FROM clinical_document_imports WHERE patient_id = $1")
        .bind(patient_id)
        .execute(&mut *savepoint)
        .await
    {
        Ok(_) => savepoint.commit().await?,
        Err(sqlx::Error::Database(_)) => savepoint.rollback().await?,
        Err(error) => return Err(error),
    }
    let anon = format!("ANON-{}", &patient_id.to_string()[..8]);
    crate::routes::admin_compliance::anonymize_patient_identity(
        &mut **tx,
        patient_id,
        &anon,
        json!({
            "anonymized_at": chrono::Utc::now().to_rfc3339(),
            "anonymized_reason": "lead_purge",
            "source_lead_id": lead_id.to_string(),
        }),
    )
    .await?;
    Ok(ProspectPurge::Anonymized(patient_id))
}

/// Load the retention window from `system_settings`. Falls back to
/// [`DEFAULT_ARCHIVED_LEAD_RETENTION_DAYS`] on any parse or DB failure so
/// the sweeper never silently "skips" a run because of a misconfigured
/// value.
async fn load_archived_lead_retention_days(pool: &gmed_db::DbPool) -> i64 {
    let raw: Option<String> = sqlx::query_scalar(
        r#"SELECT value::TEXT FROM system_settings
           WHERE key = 'cleanup_archived_leads_days'"#,
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    raw.and_then(|v| v.trim_matches('"').parse::<i64>().ok())
        .filter(|days| *days > 0)
        .unwrap_or(DEFAULT_ARCHIVED_LEAD_RETENTION_DAYS)
}

/// Pure decision function. Kept outside the SQL query for unit testing —
/// the SQL WHERE clause in `auto_purge_stale_archived` mirrors this logic
/// 1:1, so a test that changes a boundary here is a reminder to review the
/// query too. Only compiled into the test build; production code asks the
/// database, not this function.
#[cfg(test)]
pub(crate) fn should_auto_purge(
    qualification_status: &str,
    failed_outcome_status: Option<&str>,
    first_name: &str,
    reference_at: chrono::DateTime<chrono::Utc>,
    now: chrono::DateTime<chrono::Utc>,
    retention_days: i64,
) -> bool {
    let is_archivable = matches!(qualification_status, "archived" | "not_qualified");
    let already_anonymized =
        failed_outcome_status == Some("delete_anonymized") || first_name == ANONYMIZED_FIRST_NAME;
    let age_days = (now - reference_at).num_days();
    let stale = age_days >= retention_days;
    is_archivable && !already_anonymized && stale
}

/// Pure mirror of the prospect-deletion guard in `purge_lead_and_prospect`:
/// only a still-`prospective` patient of a never-converted lead is deleted.
#[cfg(test)]
pub(crate) fn should_purge_prospect(lifecycle_status: &str, lead_converted: bool) -> bool {
    lifecycle_status == "prospective" && !lead_converted
}

/// Run one purge sweep: find every lead that has been sitting in an
/// archived/failed state past the retention window, anonymise it, delete
/// its attachments, and emit an `auto_purge_lead` audit event for each
/// anonymised row.
pub async fn auto_purge_stale_archived(
    state: &crate::state::AppState,
) -> Result<LeadPurgeReport, sqlx::Error> {
    let retention_days = load_archived_lead_retention_days(&state.db).await;

    // Coarse filtering happens in SQL. The WHERE clause here mirrors the
    // guards in `should_auto_purge` — if you edit one, edit both. The age
    // counts from the latest of the failed-lead resolution and the last
    // status change: a lead archived long ago, reopened and rejected again
    // today starts a new retention window instead of being erased at once.
    let candidates: Vec<(Uuid, String)> = sqlx::query_as(
        r#"
        SELECT id, qualification_status FROM leads
        WHERE qualification_status IN ('archived', 'not_qualified')
          AND COALESCE(failed_outcome_status, 'none') != 'delete_anonymized'
          AND first_name != $2
          AND GREATEST(COALESCE(failed_processed_at, updated_at), status_changed_at)
              < now() - make_interval(days => $1::int)
        "#,
    )
    .bind(retention_days as i32)
    .bind(ANONYMIZED_FIRST_NAME)
    .fetch_all(&state.db)
    .await?;

    let mut report = LeadPurgeReport {
        retention_days,
        scanned: candidates.len() as u64,
        anonymized: 0,
        errors: 0,
    };

    for (lead_id, from_status) in candidates {
        match purge_lead_and_prospect(
            &state.db,
            LeadPurge {
                lead_id,
                failed_from_status: Some(from_status.clone()),
                reason: "auto_purge_storage_limitation",
                system_note: Some("Auto-purged per cleanup_archived_leads_days retention"),
                processed_by: None,
                lead_audit: audit::domain_event(
                    "auto_purge_lead",
                    None,
                    "lead",
                    Some(lead_id),
                    json!({
                        "reason": "storage_limitation_retention",
                        "retention_days": retention_days,
                        "gdpr_article": "5(1)(e)",
                        "failed_from_status": from_status.clone(),
                    }),
                ),
                // The lead history shows the automatic deletion like a manual one.
                lifecycle: crate::routes::workflow_lifecycle::RecordEvent {
                    entity_type: "lead",
                    entity_id: lead_id,
                    from_stage: Some(from_status.as_str()),
                    to_stage: "deleted",
                    transition_kind: "deleted",
                    changed_by: None,
                    note: Some("auto_purge_storage_limitation"),
                    metadata: json!({
                        "resolution": "delete_anonymized",
                        "trigger": "retention_sweeper",
                        "retention_days": retention_days,
                    }),
                },
            },
        )
        .await
        {
            Ok((result, _)) if result.rows_affected() > 0 => {
                report.anonymized += 1;
                let _ = sqlx::query("DELETE FROM lead_attachments WHERE lead_id = $1")
                    .bind(lead_id)
                    .execute(&state.db)
                    .await;
            }
            Ok(_) => {
                // Row was concurrently anonymised between SELECT and
                // UPDATE. Not an error, just a no-op.
            }
            Err(e) => {
                tracing::error!(
                    lead_id = %lead_id,
                    error = %e,
                    "Auto-purge anonymisation failed"
                );
                report.errors += 1;
            }
        }
    }

    Ok(report)
}

// ── Unqualified leads ──────────────────────────────────────────────────
//
// A lead that is not qualified within the retention window after its creation
// and has no signed DSGVO consent is purged with everything it owns (owner
// decision 2026-10-01): without consent there is no basis to keep its data
// and medical files. The lead row stays as an anonymised tombstone. See
// docs/engineering/03_lead-retention-policy_ua.md.

/// Window of the unqualified-lead rule when the setting cannot be read.
pub const DEFAULT_UNQUALIFIED_LEAD_RETENTION_DAYS: i64 = 14;

/// The responsible user is warned this many days before the deadline.
pub const UNQUALIFIED_LEAD_WARNING_DAYS: i64 = 3;

const UNQUALIFIED_LEAD_PURGE_REASON: &str = "auto_purge_unqualified_retention";

/// Realtime event to staff: the one-time deletion warning of a lead went out
/// (payload `delete_at`, the instant the sweep deletes it).
pub const LEAD_RETENTION_WARNING_EVENT: &str = "lead.retention_warning";
/// Realtime event to staff: the retention sweep deleted the lead (payload
/// `reason`); open lists drop the row, an open wizard says so.
pub const LEAD_PURGED_EVENT: &str = "lead.purged";
/// `user_notifications.kind` of the staff notice after the automatic
/// deletion. It names neither the lead nor the person and points nowhere
/// (`entity_type` NULL): nothing of the lead is left to open.
pub const LEAD_PURGED_NOTIFICATION_KIND: &str = "lead_purged_by_retention";

/// The unqualified-lead rule as configured in `system_settings`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnqualifiedLeadRetention {
    pub days: i64,
    /// Start of the rule in this environment. Leads that existed before count
    /// their window from it, so the rollout deletes nothing at once.
    pub effective_at: chrono::DateTime<chrono::Utc>,
}

impl UnqualifiedLeadRetention {
    /// When the lead is purged, or `None` while the rule does not apply to
    /// it. Mirrors [`UNQUALIFIED_LEAD_SUBJECT_SQL`] and the deadline
    /// expression of the sweep; edit them together. The exceptions that need
    /// other records (a consented repeat intake, an invoice, conversion) are
    /// applied by the callers (`leads_outside_unqualified_purge`).
    pub fn deadline(
        &self,
        qualification_status: &str,
        compliance_status: &str,
        created_at: chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        let unqualified = matches!(
            qualification_status,
            "new" | "in_progress" | "not_qualified" | "archived"
        );
        (unqualified && compliance_status != "signed")
            .then(|| created_at.max(self.effective_at) + chrono::Duration::days(self.days))
    }

    /// When the sweep really deletes the lead ([`effective_deletion_at`] of
    /// its [`deadline`](Self::deadline)), or `None` while the rule does not
    /// apply to it. This is the date everyone is told.
    pub fn deletion_at(
        &self,
        qualification_status: &str,
        compliance_status: &str,
        created_at: chrono::DateTime<chrono::Utc>,
        warning_sent_at: Option<chrono::DateTime<chrono::Utc>>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        self.deadline(qualification_status, compliance_status, created_at)
            .map(|deadline| effective_deletion_at(deadline, warning_sent_at, now))
    }
}

/// A repeat intake (alias `l`) whose patient has a valid signed DSGVO
/// consent: the card records the signed consent (`dsgvo_signed`), the record
/// is not anonymised, and the latest DSGVO consent entry, if any, was not
/// withdrawn. The consent's re-confirmation date does not end it: a signed
/// consent stays the basis until it is withdrawn (Art. 7 Abs. 3 DSGVO).
macro_rules! repeat_patient_consented_sql {
    () => {
        r#"(
    l.repeat_patient_id IS NOT NULL
    AND EXISTS (
        SELECT 1 FROM patients rp
        WHERE rp.id = l.repeat_patient_id
          AND rp.lifecycle_status IN ('active', 'inactive')
          AND (rp.legal_status->>'anonymized_at') IS NULL
          AND rp.legal_status->>'dsgvo_signed' = 'true'
          AND COALESCE((
              SELECT c.granted AND c.revoked_at IS NULL
              FROM consent_records c
              WHERE c.patient_id = rp.id
                AND c.consent_type = 'dsgvo_data_transfer'
              ORDER BY c.created_at DESC, c.id DESC
              LIMIT 1
          ), true)
    ))"#
    };
}

/// Which leads the rule covers (alias `l`; `$4` is the anonymisation sentinel).
/// A repeat intake of a patient with a valid signed DSGVO consent is not
/// covered: the consent is the basis to keep its data (decision 2026-10-11).
const UNQUALIFIED_LEAD_SUBJECT_SQL: &str = concat!(
    r#"
    l.qualification_status IN ('new', 'in_progress', 'not_qualified', 'archived')
    AND l.compliance_status <> 'signed'
    AND l.converted_patient_id IS NULL
    AND COALESCE(l.failed_outcome_status, 'none') <> 'delete_anonymized'
    AND l.first_name <> $4
    AND NOT "#,
    repeat_patient_consented_sql!()
);

/// An invoice of an order of the lead (alias `l`) that is not cancelled. It
/// keeps the lead for accounting (§ 257 HGB, § 147 AO): the sweep never
/// deletes such a lead automatically but leaves it for a manual decision.
const UNQUALIFIED_LEAD_INVOICED_SQL: &str = r#"(
    EXISTS (
        SELECT 1 FROM invoices i JOIN orders o ON o.id = i.order_id
        WHERE o.source_lead_id = l.id AND i.status <> 'cancelled'
    ) OR EXISTS (
        SELECT 1 FROM external_invoices e JOIN orders o ON o.id = e.order_id
        WHERE o.source_lead_id = l.id AND e.status <> 'cancelled'
    ))"#;

/// The leads among `lead_ids` the sweep never deletes although
/// [`UnqualifiedLeadRetention::deadline`] alone gives them a date: they are
/// outside [`UNQUALIFIED_LEAD_SUBJECT_SQL`] (converted, deleted or
/// anonymised, a repeat intake of a patient with a valid signed DSGVO
/// consent) or an invoice keeps them ([`UNQUALIFIED_LEAD_INVOICED_SQL`]).
/// They carry no deletion deadline, so no countdown is shown for them.
async fn leads_outside_unqualified_purge(
    pool: &gmed_db::DbPool,
    lead_ids: &[Uuid],
) -> Result<std::collections::HashSet<Uuid>, sqlx::Error> {
    if lead_ids.is_empty() {
        return Ok(std::collections::HashSet::new());
    }
    // The subject condition names the anonymisation sentinel `$4`; here it is `$2`.
    let subject = UNQUALIFIED_LEAD_SUBJECT_SQL.replace("$4", "$2");
    let ids: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT l.id FROM leads l
           WHERE l.id = ANY($1)
             AND (NOT COALESCE(({subject}), false) OR {UNQUALIFIED_LEAD_INVOICED_SQL})"#
    ))
    .bind(lead_ids)
    .bind(ANONYMIZED_FIRST_NAME)
    .fetch_all(pool)
    .await?;
    Ok(ids.into_iter().collect())
}

/// Whether the sweep never deletes this lead
/// ([`leads_outside_unqualified_purge`]), for the cabinet and the sign-in
/// e-mail that name the deletion date. A failed lookup counts as "no": the
/// date is shown rather than hidden.
pub(crate) async fn is_outside_unqualified_purge(pool: &gmed_db::DbPool, lead_id: Uuid) -> bool {
    match leads_outside_unqualified_purge(pool, &[lead_id]).await {
        Ok(ids) => ids.contains(&lead_id),
        Err(error) => {
            tracing::warn!(lead_id = %lead_id, error = %error, "check lead purge exceptions");
            false
        }
    }
}

/// Deadline of a lead (`$1` days, `$2` start of the rule).
const UNQUALIFIED_LEAD_DEADLINE_SQL: &str =
    "GREATEST(l.created_at, $2) + make_interval(days => $1::int)";

/// When the sweep deletes a lead (alias `l`): the deadline, but never earlier
/// than the warning lead time (`$6` days, [`UNQUALIFIED_LEAD_WARNING_DAYS`])
/// after the staff warning — or, while the lead is not warned yet, after `$3`
/// (now), the earliest the warning can go out. The SQL twin of
/// [`effective_deletion_at`]; every reader of the date (the purge, the staff
/// warning, the reminder e-mail, the API, the cabinet, the sign-in e-mail)
/// goes through one of the two, so they cannot drift. A lead that re-enters
/// the rule after its deadline (qualified → in progress, consent revoked) is
/// warned first and deleted no earlier than that many days after the warning.
const UNQUALIFIED_LEAD_DELETION_SQL: &str = concat!(
    "GREATEST(GREATEST(l.created_at, $2) + make_interval(days => $1::int), ",
    "COALESCE(l.retention_warning_sent_at, $3) + make_interval(days => $6::int))"
);

/// The sweep may delete the lead (alias `l`) now: it was warned, and its
/// deletion instant ([`UNQUALIFIED_LEAD_DELETION_SQL`]) has come. The sweep
/// never deletes silently.
const UNQUALIFIED_LEAD_DUE_SQL: &str = concat!(
    "(l.retention_warning_sent_at IS NOT NULL AND ",
    "GREATEST(GREATEST(l.created_at, $2) + make_interval(days => $1::int), ",
    "COALESCE(l.retention_warning_sent_at, $3) + make_interval(days => $6::int)) <= $3)"
);

/// The instant the sweep deletes a lead whose deadline is `deadline`: the
/// deadline, but never earlier than [`UNQUALIFIED_LEAD_WARNING_DAYS`] after
/// the staff warning — or, while the lead is not warned yet, after `now`, the
/// earliest the warning can go out. One date for everyone: the staff notice,
/// the reminder e-mail to the lead, the API countdown, the cabinet and the
/// sign-in e-mail all name this instant, and the purge waits for it
/// ([`UNQUALIFIED_LEAD_DELETION_SQL`] is the SQL twin).
pub fn effective_deletion_at(
    deadline: chrono::DateTime<chrono::Utc>,
    warning_sent_at: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> chrono::DateTime<chrono::Utc> {
    deadline
        .max(warning_sent_at.unwrap_or(now) + chrono::Duration::days(UNQUALIFIED_LEAD_WARNING_DAYS))
}

/// The rule from `system_settings`, or `None` when it is switched off (window
/// of 0 days) or was never started in this environment.
pub async fn load_unqualified_lead_retention(
    pool: &gmed_db::DbPool,
) -> Option<UnqualifiedLeadRetention> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT key, value::TEXT FROM system_settings
           WHERE key IN (
               'unqualified_lead_retention_days',
               'unqualified_lead_retention_effective_at'
           )"#,
    )
    .fetch_all(pool)
    .await
    .ok()?;
    let setting = |key: &str| {
        rows.iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.trim_matches('"').to_string())
    };
    let effective_at =
        chrono::DateTime::parse_from_rfc3339(&setting("unqualified_lead_retention_effective_at")?)
            .ok()?
            .with_timezone(&chrono::Utc);
    let days = setting("unqualified_lead_retention_days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(DEFAULT_UNQUALIFIED_LEAD_RETENTION_DAYS);
    (days > 0).then_some(UnqualifiedLeadRetention { days, effective_at })
}

/// The deletion instant of a lead row for the API (`retention_deadline_at`):
/// RFC 3339, or null while the rule does not apply to the lead. The same
/// instant the sweep acts on ([`UnqualifiedLeadRetention::deletion_at`]; the
/// row carries `retention_warning_sent_at`): a lead the sweep never deletes
/// ([`leads_outside_unqualified_purge`]) has none.
fn lead_retention_deadline_json(
    policy: Option<&UnqualifiedLeadRetention>,
    row: &sqlx::postgres::PgRow,
    outside_purge: bool,
) -> Value {
    if outside_purge {
        return Value::Null;
    }
    let deletion_at = policy.and_then(|policy| {
        policy.deletion_at(
            &row.try_get::<String, _>("qualification_status").ok()?,
            &row.try_get::<String, _>("compliance_status").ok()?,
            row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .ok()?,
            row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_warning_sent_at")
                .ok()
                .flatten(),
            chrono::Utc::now(),
        )
    });
    json!(deletion_at.map(|value| value.to_rfc3339()))
}

/// When the unqualified-lead rule deletes the lead, if the sweep would — the
/// same instant the API, the staff warning and the reminder name
/// ([`UnqualifiedLeadRetention::deletion_at`]). `None` while the rule is off,
/// does not apply to the lead, or the sweep never deletes it
/// ([`is_outside_unqualified_purge`]). For the cabinet and the sign-in
/// e-mail, which hold no lead row of their own.
pub(crate) async fn unqualified_lead_deletion_at(
    pool: &gmed_db::DbPool,
    lead_id: Uuid,
) -> Option<chrono::DateTime<chrono::Utc>> {
    let policy = load_unqualified_lead_retention(pool).await?;
    if is_outside_unqualified_purge(pool, lead_id).await {
        return None;
    }
    let row = sqlx::query(
        "SELECT qualification_status, compliance_status, created_at, retention_warning_sent_at
         FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;
    policy.deletion_at(
        &row.try_get::<String, _>("qualification_status").ok()?,
        &row.try_get::<String, _>("compliance_status").ok()?,
        row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .ok()?,
        row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_warning_sent_at")
            .ok()
            .flatten(),
        chrono::Utc::now(),
    )
}

/// Summary of one sweep of the unqualified-lead rule.
#[derive(Debug, Default, Clone, Copy)]
pub struct UnqualifiedLeadPurgeReport {
    pub scanned: u64,
    pub purged: u64,
    /// Left for a manual decision: an order of the lead has an invoice or
    /// could not be withdrawn.
    pub blocked: u64,
    pub warned: u64,
    /// Leads whose own login (or parents) got the deletion reminder e-mail.
    pub reminded: u64,
    pub errors: u64,
}

enum UnqualifiedLeadPurge {
    Purged,
    /// The lead changed between the scan and its lock and is no longer due.
    Skipped,
    Blocked,
}

/// Run one sweep of the unqualified-lead rule: warn about deadlines that are
/// close, then purge every lead whose deadline has passed.
pub async fn auto_purge_unqualified_leads(
    state: &crate::state::AppState,
) -> Result<UnqualifiedLeadPurgeReport, sqlx::Error> {
    let Some(policy) = load_unqualified_lead_retention(&state.db).await else {
        return Ok(UnqualifiedLeadPurgeReport::default());
    };
    purge_unqualified_leads(state, policy, chrono::Utc::now(), None).await
}

/// [`auto_purge_unqualified_leads`] with an explicit rule and clock. `only`
/// narrows the sweep to the given leads; the scheduler passes `None`.
#[doc(hidden)]
pub async fn purge_unqualified_leads(
    state: &crate::state::AppState,
    policy: UnqualifiedLeadRetention,
    now: chrono::DateTime<chrono::Utc>,
    only: Option<&[Uuid]>,
) -> Result<UnqualifiedLeadPurgeReport, sqlx::Error> {
    // A lead that left the rule (qualified, signed) starts over: a later
    // re-entry is warned anew instead of being deleted on the old warning,
    // as [`UNQUALIFIED_LEAD_DELETION_SQL`] promises (QA 2026-10-30).
    if let Err(error) = sqlx::query(&format!(
        r#"UPDATE leads AS l
           SET retention_warning_sent_at = NULL, retention_reminder_sent_at = NULL
           WHERE (l.retention_warning_sent_at IS NOT NULL
                  OR l.retention_reminder_sent_at IS NOT NULL)
             AND NOT ({})
             AND ($2::uuid[] IS NULL OR l.id = ANY($2))"#,
        UNQUALIFIED_LEAD_SUBJECT_SQL.replace("$4", "$1"),
    ))
    .bind(ANONYMIZED_FIRST_NAME)
    .bind(only)
    .execute(&state.db)
    .await
    {
        tracing::warn!(%error, "clear retention markers of leads outside the rule");
    }
    let mut report = UnqualifiedLeadPurgeReport {
        warned: warn_about_unqualified_lead_deadlines(state, policy, now, only).await?,
        ..Default::default()
    };
    // The lead hears of the deadline too (owner decision 2026-10-24).
    report.reminded = match remind_leads_before_purge(state, policy, now, only).await {
        Ok(reminded) => reminded,
        Err(error) => {
            tracing::warn!(%error, "deletion reminder e-mails");
            0
        }
    };
    let candidates: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT l.id FROM leads l
           WHERE {UNQUALIFIED_LEAD_SUBJECT_SQL}
             AND {UNQUALIFIED_LEAD_DUE_SQL}
             AND ($5::uuid[] IS NULL OR l.id = ANY($5))
           ORDER BY l.created_at, l.id"#
    ))
    .bind(policy.days as i32)
    .bind(policy.effective_at)
    .bind(now)
    .bind(ANONYMIZED_FIRST_NAME)
    .bind(only)
    .bind(UNQUALIFIED_LEAD_WARNING_DAYS as i32)
    .fetch_all(&state.db)
    .await?;
    report.scanned = candidates.len() as u64;

    for lead_id in candidates {
        match purge_unqualified_lead(state, policy, now, lead_id).await {
            Ok(UnqualifiedLeadPurge::Purged) => report.purged += 1,
            Ok(UnqualifiedLeadPurge::Skipped) => {}
            Ok(UnqualifiedLeadPurge::Blocked) => {
                report.blocked += 1;
                if let Err(error) = notify_unqualified_lead_purge_blocked(state, lead_id).await {
                    tracing::warn!(lead_id = %lead_id, error = %error, "notify blocked lead purge");
                }
            }
            Err(error) => {
                tracing::error!(lead_id = %lead_id, error = %error, "Unqualified lead purge failed");
                report.errors += 1;
            }
        }
    }
    Ok(report)
}

async fn purge_unqualified_lead(
    state: &crate::state::AppState,
    policy: UnqualifiedLeadRetention,
    now: chrono::DateTime<chrono::Utc>,
    lead_id: Uuid,
) -> Result<UnqualifiedLeadPurge, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    // Lock the lead and decide again: it may have been qualified, signed or
    // deleted since the scan.
    let lead = sqlx::query(&format!(
        r#"SELECT l.qualification_status, l.created_by,
                  (SELECT o.created_by FROM orders o
                   WHERE o.source_lead_id = l.id
                   ORDER BY o.created_at, o.id LIMIT 1) AS order_created_by
           FROM leads l
           WHERE l.id = $5
             AND {UNQUALIFIED_LEAD_SUBJECT_SQL}
             AND {UNQUALIFIED_LEAD_DUE_SQL}
           FOR UPDATE OF l"#
    ))
    .bind(policy.days as i32)
    .bind(policy.effective_at)
    .bind(now)
    .bind(ANONYMIZED_FIRST_NAME)
    .bind(lead_id)
    .bind(UNQUALIFIED_LEAD_WARNING_DAYS as i32)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(lead) = lead else {
        return Ok(UnqualifiedLeadPurge::Skipped);
    };
    let from_status: String = lead.try_get("qualification_status")?;
    // Read before the purge unlinks them: the cabinet logins whose open page
    // learns live that the request is gone.
    let portal_users: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT portal_user_id FROM leads WHERE id = $1 AND portal_user_id IS NOT NULL
           UNION
           SELECT user_id FROM lead_portal_access WHERE lead_id = $1 AND revoked_at IS NULL"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *tx)
    .await?;

    // An invoice keeps the lead for accounting (§ 257 HGB, § 147 AO): it is
    // never deleted automatically.
    let invoiced: bool = sqlx::query_scalar(&format!(
        "SELECT {UNQUALIFIED_LEAD_INVOICED_SQL} FROM leads l WHERE l.id = $1"
    ))
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await?;
    if invoiced {
        return Ok(UnqualifiedLeadPurge::Blocked);
    }
    // A signature request still out: the person can sign it, and the signed PDF
    // would land on a deleted lead. The lead waits for the request's end; a
    // signed DSGVO then takes it out of the rule (QA 2026-10-30).
    let signature_open: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
               SELECT 1 FROM document_signature_requests r
               JOIN documents d ON d.id = r.source_document_id
               WHERE d.lead_id = $1 AND r.status IN ('sending', 'pending', 'needs_review')
           )"#,
    )
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await?;
    if signature_open {
        return Ok(UnqualifiedLeadPurge::Skipped);
    }

    // The open preparation order is withdrawn like in the manual deletion. The
    // cancellation needs a user: the one who created the lead, or its order.
    let actor: Option<Uuid> = lead
        .try_get::<Option<Uuid>, _>("created_by")?
        .or(lead.try_get::<Option<Uuid>, _>("order_created_by")?);
    let has_open_order: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
               SELECT 1 FROM orders
               WHERE source_lead_id = $1
                 AND status IN ('active', 'paused')
                 AND (patient_id IS NULL OR intake_state = 'draft')
           )"#,
    )
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await?;
    let withdrawn = if has_open_order {
        let Some(actor) = actor else {
            return Ok(UnqualifiedLeadPurge::Blocked);
        };
        match crate::routes::orders::withdraw_lead_orders_in_tx(
            &mut tx,
            lead_id,
            actor,
            crate::routes::orders::LEAD_DELETED_CANCELLATION_REASON,
            UNQUALIFIED_LEAD_PURGE_REASON,
        )
        .await
        {
            Ok(withdrawn) => withdrawn,
            Err(response) => {
                tracing::warn!(
                    lead_id = %lead_id,
                    status = %response.status(),
                    "Unqualified lead purge: the lead's order could not be withdrawn"
                );
                return Ok(UnqualifiedLeadPurge::Blocked);
            }
        }
    } else {
        Vec::new()
    };

    let purged = purge_lead_and_prospect_in_tx(
        &mut tx,
        LeadPurge {
            lead_id,
            failed_from_status: Some(from_status.clone()),
            reason: UNQUALIFIED_LEAD_PURGE_REASON,
            system_note: Some("Auto-purged: not qualified within unqualified_lead_retention_days"),
            processed_by: None,
            lead_audit: audit::domain_event(
                "auto_purge_lead",
                None,
                "lead",
                Some(lead_id),
                json!({
                    "reason": "unqualified_lead_retention",
                    "retention_days": policy.days,
                    "gdpr_article": "5(1)(e)",
                    "failed_from_status": from_status.clone(),
                }),
            ),
            lifecycle: crate::routes::workflow_lifecycle::RecordEvent {
                entity_type: "lead",
                entity_id: lead_id,
                from_stage: Some(from_status.as_str()),
                to_stage: "deleted",
                transition_kind: "deleted",
                changed_by: None,
                note: Some(UNQUALIFIED_LEAD_PURGE_REASON),
                metadata: json!({
                    "resolution": "delete_anonymized",
                    "trigger": "unqualified_lead_retention",
                    "retention_days": policy.days,
                }),
            },
        },
    )
    .await?;
    if purged.result.rows_affected() == 0 {
        return Ok(UnqualifiedLeadPurge::Skipped);
    }
    // The staff who were warned hear that it happened, in the same
    // transaction as the deletion. The purge above removed every notice that
    // pointed to the lead; this one points nowhere and names nobody.
    let recipients =
        unqualified_lead_recipients(&mut tx, lead.try_get::<Option<Uuid>, _>("created_by")?)
            .await?;
    let mut purged_notices = Vec::with_capacity(recipients.len());
    for recipient in &recipients {
        let notification_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, params)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(LEAD_PURGED_NOTIFICATION_KIND)
        .bind("Lead deleted automatically")
        .bind("Not qualified and no signed consent within the retention period.")
        .bind(json!({
            "reason": "unqualified_lead_retention",
            "retention_days": policy.days,
        }))
        .fetch_one(&mut *tx)
        .await?;
        purged_notices.push((*recipient, notification_id));
    }
    tx.commit().await?;

    for storage_key in &purged.removed_blobs {
        crate::routes::documents::remove_document_blob(storage_key).await;
    }
    if let Some(actor) = actor
        && !withdrawn.is_empty()
    {
        crate::routes::orders::publish_withdrawn_lead_orders(state, actor, &withdrawn).await;
    }
    crate::realtime::publish_lead_event(
        state,
        None,
        "lead.failed_resolved",
        lead_id,
        json!({
            "resolution": "delete_anonymized",
            "reason": UNQUALIFIED_LEAD_PURGE_REASON,
            "failed_from_status": from_status,
        }),
    )
    .await;
    crate::realtime::publish_lead_event(
        state,
        None,
        LEAD_PURGED_EVENT,
        lead_id,
        json!({ "reason": "unqualified_lead_retention" }),
    )
    .await;
    for (recipient, notification_id) in purged_notices {
        crate::realtime::publish_notification_event(
            state,
            recipient,
            "notification.created",
            Some(notification_id),
            json!({ "kind": LEAD_PURGED_NOTIFICATION_KIND }),
        )
        .await;
    }
    // A login the purge switched off loses its socket on the next check; a
    // parent's login that keeps other requests gets the event and reloads.
    crate::realtime::publish_lead_portal_access_ended(state, lead_id, portal_users, "lead_purged")
        .await;
    Ok(UnqualifiedLeadPurge::Purged)
}

/// Staff who hear about the retention of a lead: its creator while that
/// staff login is active, otherwise (a website lead, or a creator who was
/// deactivated meanwhile) every patient manager and CEO, so the one-time
/// warning never goes to nobody.
async fn unqualified_lead_recipients(
    conn: &mut sqlx::PgConnection,
    created_by: Option<Uuid>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT id FROM users
           WHERE is_active = true
             AND role <> 'patient'
             AND (
                 id = $1
                 OR (
                     role IN ('patient_manager', 'ceo')
                     AND NOT EXISTS (
                         SELECT 1 FROM users creator
                         WHERE creator.id = $1 AND creator.is_active
                           AND creator.role <> 'patient'
                     )
                 )
             )
           ORDER BY created_at"#,
    )
    .bind(created_by)
    .fetch_all(conn)
    .await
}

/// Stores a notification about a lead without naming the person: the row
/// outlives nothing it should not, and the lead purge deletes it anyway.
/// Returns `(recipient, notification id)` for the realtime events, which the
/// caller publishes after its commit.
async fn store_lead_retention_notices(
    conn: &mut sqlx::PgConnection,
    recipients: &[Uuid],
    kind: &str,
    title: &str,
    body: &str,
    lead_id: Uuid,
) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    let mut stored = Vec::with_capacity(recipients.len());
    for recipient in recipients {
        let notification_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               VALUES ($1, $2, $3, $4, 'lead', $5)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(kind)
        .bind(title)
        .bind(body)
        .bind(lead_id)
        .fetch_one(&mut *conn)
        .await?;
        stored.push((*recipient, notification_id));
    }
    Ok(stored)
}

async fn publish_lead_retention_notices(
    state: &crate::state::AppState,
    lead_id: Uuid,
    stored: &[(Uuid, Uuid)],
) {
    for (recipient, notification_id) in stored {
        crate::realtime::publish_notification_event(
            state,
            *recipient,
            "notification.created",
            Some(*notification_id),
            json!({ "entity_type": "lead", "entity_id": lead_id }),
        )
        .await;
    }
}

/// Warn once, [`UNQUALIFIED_LEAD_WARNING_DAYS`] before the deadline — or at
/// once for a lead that is overdue and was never warned (it re-entered the
/// rule after its deadline): the sweep deletes only a lead warned at least
/// that many days ago ([`UNQUALIFIED_LEAD_DUE_SQL`]). A lead an invoice
/// keeps is not warned: the sweep never deletes it. Each lead in its own
/// transaction: the warning marker is set together with the notifications,
/// so a failed insert leaves the lead to be warned on the next sweep instead
/// of marked as warned without a notice. Returns the number of leads warned
/// about.
async fn warn_about_unqualified_lead_deadlines(
    state: &crate::state::AppState,
    policy: UnqualifiedLeadRetention,
    now: chrono::DateTime<chrono::Utc>,
    only: Option<&[Uuid]>,
) -> Result<u64, sqlx::Error> {
    let due_soon_sql = {
        let lead_filter = "l.id = $5";
        format!(
            r#"UPDATE leads AS l
               SET retention_warning_sent_at = $3
               WHERE {UNQUALIFIED_LEAD_SUBJECT_SQL}
                 AND NOT {UNQUALIFIED_LEAD_INVOICED_SQL}
                 AND l.retention_warning_sent_at IS NULL
                 AND {UNQUALIFIED_LEAD_DEADLINE_SQL} <= $3 + make_interval(days => $6::int)
                 AND {lead_filter}
               RETURNING l.id, l.created_by, {UNQUALIFIED_LEAD_DELETION_SQL} AS delete_at"#
        )
    };
    // The candidates without a change; each is re-checked under its update.
    let candidates: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT l.id FROM leads AS l
           WHERE {UNQUALIFIED_LEAD_SUBJECT_SQL}
             AND NOT {UNQUALIFIED_LEAD_INVOICED_SQL}
             AND l.retention_warning_sent_at IS NULL
             AND {UNQUALIFIED_LEAD_DEADLINE_SQL} <= $3 + make_interval(days => $6::int)
             AND ($5::uuid[] IS NULL OR l.id = ANY($5))
           ORDER BY l.id"#
    ))
    .bind(policy.days as i32)
    .bind(policy.effective_at)
    .bind(now)
    .bind(ANONYMIZED_FIRST_NAME)
    .bind(only)
    .bind(UNQUALIFIED_LEAD_WARNING_DAYS as i32)
    .fetch_all(&state.db)
    .await?;

    let mut warned = 0;
    for candidate in candidates {
        // One lead's failure leaves the others' warnings and the purge running.
        match warn_about_unqualified_lead(state, policy, now, candidate, &due_soon_sql).await {
            Ok(true) => warned += 1,
            Ok(false) => {}
            Err(error) => {
                tracing::error!(lead_id = %candidate, %error, "Unqualified lead warning failed");
            }
        }
    }
    Ok(warned)
}

/// Warns about one lead, re-checked under its update. False when it no longer
/// falls under the rule.
async fn warn_about_unqualified_lead(
    state: &crate::state::AppState,
    policy: UnqualifiedLeadRetention,
    now: chrono::DateTime<chrono::Utc>,
    candidate: Uuid,
    due_soon_sql: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    let Some(row) = sqlx::query(due_soon_sql)
        .bind(policy.days as i32)
        .bind(policy.effective_at)
        .bind(now)
        .bind(ANONYMIZED_FIRST_NAME)
        .bind(candidate)
        .bind(UNQUALIFIED_LEAD_WARNING_DAYS as i32)
        .fetch_optional(&mut *tx)
        .await?
    else {
        return Ok(false);
    };
    let lead_id: Uuid = row.try_get("id")?;
    // The warning marker is set in the same statement, so the instant is
    // the deadline or the lead time after this warning
    // ([`UNQUALIFIED_LEAD_DELETION_SQL`]): the notice names that day.
    let delete_at: chrono::DateTime<chrono::Utc> = row.try_get("delete_at")?;
    let recipients = unqualified_lead_recipients(&mut tx, row.try_get("created_by")?).await?;
    // The frontend shows these facts in RU/DE (topbar-data.ts).
    let stored = store_lead_retention_notices(
        &mut tx,
        &recipients,
        "lead_retention_warning",
        "Lead will be deleted automatically",
        &format!(
            "Not qualified and no signed consent; deletion on {}.",
            // The German calendar day of the deletion, not the UTC one.
            crate::app_time::date_of(delete_at).format("%Y-%m-%d")
        ),
        lead_id,
    )
    .await?;
    tx.commit().await?;
    publish_lead_retention_notices(state, lead_id, &stored).await;
    // An open leads list or wizard shows the countdown («Автоудаление»)
    // of the instant the warning just fixed, without a reload.
    crate::realtime::publish_lead_event(
        state,
        None,
        LEAD_RETENTION_WARNING_EVENT,
        lead_id,
        json!({ "delete_at": delete_at.to_rfc3339() }),
    )
    .await;
    Ok(true)
}

/// The leads (alias `l`) the sweep would really delete within the warning
/// window ([`UNQUALIFIED_LEAD_WARNING_DAYS`]) and that got no accepted
/// reminder yet (`retention_reminder_sent_at` is set only once the provider
/// accepted an e-mail, so a lead whose e-mails all failed stays due): the
/// rule covers them, no invoice keeps them, the deletion instant
/// ([`UNQUALIFIED_LEAD_DELETION_SQL`]) is still ahead. The instant, not the
/// deadline: an overdue lead that was just warned is reminded too, the lead
/// time before the sweep deletes it (QA 2026-10-24, D-1).
fn retention_reminder_due_sql(lead_filter: &str) -> String {
    format!(
        r#"{UNQUALIFIED_LEAD_SUBJECT_SQL}
           AND NOT {UNQUALIFIED_LEAD_INVOICED_SQL}
           AND l.retention_reminder_sent_at IS NULL
           AND {UNQUALIFIED_LEAD_DELETION_SQL} > $3
           AND {UNQUALIFIED_LEAD_DELETION_SQL} <= $3 + make_interval(days => $6::int)
           AND {lead_filter}"#
    )
}

/// One reminder of a lead, stored before it is sent.
struct ReminderRecipient {
    id: Uuid,
    user_id: Option<Uuid>,
    audience: crate::mail::templates::LoginAudience,
    recipient: String,
    name: String,
    language: crate::mail::templates::MailLanguage,
}

/// The reminder e-mail to the lead before the deletion (owner decision
/// 2026-10-24): [`UNQUALIFIED_LEAD_WARNING_DAYS`] before the deadline, while
/// the DSGVO package is unsigned and the sweep would really delete the
/// request, the lead's own login gets one neutral e-mail through Mittaro; a
/// minor's request goes to each parent with active access instead, each in
/// the parent's language. No e-mail without an address. Nothing is marked
/// while e-mail cannot be sent, so the reminder follows once it can (if the
/// deadline is still ahead). Returns the number of leads reminded.
async fn remind_leads_before_purge(
    state: &crate::state::AppState,
    policy: UnqualifiedLeadRetention,
    now: chrono::DateTime<chrono::Utc>,
    only: Option<&[Uuid]>,
) -> Result<u64, sqlx::Error> {
    let Ok(mailer) = crate::mail::connection::current_mailer(state).await else {
        return Ok(0);
    };
    if !mailer.capability().available {
        return Ok(0);
    }
    let Some(console_url) = mailer.console_url().map(str::to_string) else {
        return Ok(0);
    };
    let candidates: Vec<Uuid> = sqlx::query_scalar(&format!(
        "SELECT l.id FROM leads l WHERE {} ORDER BY l.id",
        retention_reminder_due_sql("($5::uuid[] IS NULL OR l.id = ANY($5))")
    ))
    .bind(policy.days as i32)
    .bind(policy.effective_at)
    .bind(now)
    .bind(ANONYMIZED_FIRST_NAME)
    .bind(only)
    .bind(UNQUALIFIED_LEAD_WARNING_DAYS as i32)
    .fetch_all(&state.db)
    .await?;
    if candidates.is_empty() {
        return Ok(0);
    }
    let agency = crate::mail::agency_identity(&state.db).await;
    let mut reminded = 0;
    for lead_id in candidates {
        match remind_lead_before_purge(state, &mailer, &console_url, &agency, policy, now, lead_id)
            .await
        {
            Ok(true) => reminded += 1,
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(%lead_id, %error, "deletion reminder e-mail");
            }
        }
    }
    Ok(reminded)
}

async fn remind_lead_before_purge(
    state: &crate::state::AppState,
    mailer: &crate::mail::Mailer,
    console_url: &str,
    agency: &crate::mail::templates::AgencyIdentity,
    policy: UnqualifiedLeadRetention,
    now: chrono::DateTime<chrono::Utc>,
    lead_id: Uuid,
) -> Result<bool, sqlx::Error> {
    use crate::mail::templates::{LoginAudience, MailLanguage};
    use crate::routes::lead_portal_account::normalize_portal_email;

    let mut tx = state.db.begin().await?;
    // Locked and decided again: the lead may have been signed or qualified.
    let Some(lead) = sqlx::query(&format!(
        r#"SELECT {UNQUALIFIED_LEAD_DELETION_SQL} AS delete_at, l.primary_language,
                  l.first_name, l.last_name, l.email AS lead_email, l.portal_user_id,
                  u.email AS login_email, u.is_active AS login_active,
                  {closed} AS minor
           FROM leads l
           LEFT JOIN users u ON u.id = l.portal_user_id
           WHERE {due}
           FOR UPDATE OF l"#,
        closed = crate::routes::lead_portal_intake::OWN_LOGIN_CLOSED_SQL,
        due = retention_reminder_due_sql("l.id = $5"),
    ))
    .bind(policy.days as i32)
    .bind(policy.effective_at)
    .bind(now)
    .bind(ANONYMIZED_FIRST_NAME)
    .bind(lead_id)
    .bind(UNQUALIFIED_LEAD_WARNING_DAYS as i32)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Ok(false);
    };
    // The same instant the staff notice and the sweep use (QA 2026-10-24, D-2).
    let delete_at: chrono::DateTime<chrono::Utc> = lead.try_get("delete_at")?;
    let delete_on = crate::app_time::date_of(delete_at);
    let lead_language: Option<String> = lead.try_get("primary_language")?;
    let mut planned: Vec<(Option<Uuid>, LoginAudience, String, String, MailLanguage)> = Vec::new();
    if lead.try_get::<bool, _>("minor").unwrap_or(false) {
        // A minor has no login of its own: each parent with access.
        let parents = sqlx::query(
            r#"SELECT DISTINCT u.id, u.email, u.name
               FROM lead_portal_access a
               JOIN users u ON u.id = a.user_id
               WHERE a.lead_id = $1 AND a.kind = 'guardian' AND a.revoked_at IS NULL
                 AND u.is_active"#,
        )
        .bind(lead_id)
        .fetch_all(&mut *tx)
        .await?;
        for parent in parents {
            let user_id: Uuid = parent.try_get("id")?;
            let Some(email) =
                normalize_portal_email(parent.try_get::<String, _>("email").ok().as_deref())
            else {
                continue;
            };
            let language =
                crate::routes::lead_portal_login_email::guardian_language(&state.db, user_id)
                    .await?
                    .or_else(|| lead_language.clone());
            planned.push((
                Some(user_id),
                LoginAudience::Guardian,
                email,
                crate::routes::lead_portal_login_email::greeting_name(
                    &parent.try_get::<String, _>("name").unwrap_or_default(),
                ),
                MailLanguage::from_code(language.as_deref()),
            ));
        }
    } else {
        // The lead's own login, else the address on the request.
        let text = |column: &str| lead.try_get::<Option<String>, _>(column).ok().flatten();
        let login = lead
            .try_get::<Option<bool>, _>("login_active")?
            .unwrap_or(false)
            .then(|| normalize_portal_email(text("login_email").as_deref()))
            .flatten();
        let (user_id, email) = match login {
            Some(email) => (
                lead.try_get::<Option<Uuid>, _>("portal_user_id")?,
                Some(email),
            ),
            None => (None, normalize_portal_email(text("lead_email").as_deref())),
        };
        if let Some(email) = email {
            let name = format!(
                "{} {}",
                lead.try_get::<String, _>("first_name").unwrap_or_default(),
                lead.try_get::<String, _>("last_name").unwrap_or_default()
            );
            planned.push((
                user_id,
                LoginAudience::Lead,
                email,
                name.trim().to_string(),
                MailLanguage::from_code(lead_language.as_deref()),
            ));
        }
    }
    // One e-mail per address (two parents may share one).
    let mut seen = HashSet::new();
    planned.retain(|(_, _, recipient, _, _)| seen.insert(recipient.clone()));
    if planned.is_empty() {
        // Nobody to write to: nothing marked, a later address is used.
        return Ok(false);
    }
    // The rows are stored before the e-mails go out; the lead is marked as
    // reminded (`retention_reminder_sent_at`) only once the provider accepted
    // at least one of them, so a failed send is retried by the next sweep. An
    // address whose earlier e-mail was not accepted (`failed`, or `pending`
    // after a crash) keeps its row — and with it the idempotency key, which
    // the provider recognises as a replay.
    let mut recipients = Vec::with_capacity(planned.len());
    for (user_id, audience, recipient, name, language) in planned {
        let audience_code = match audience {
            LoginAudience::Guardian => "guardian",
            _ => "lead",
        };
        let retried: Option<Uuid> = sqlx::query_scalar(
            r#"UPDATE lead_retention_reminder_emails
               SET user_id = $2, audience = $3, language = $4, deadline_on = $5,
                   status = 'pending', error_code = NULL
               WHERE id = (
                   SELECT id FROM lead_retention_reminder_emails
                   WHERE lead_id = $1 AND recipient = $6 AND status <> 'sent'
                   ORDER BY created_at DESC, id DESC
                   LIMIT 1
               )
               RETURNING id"#,
        )
        .bind(lead_id)
        .bind(user_id)
        .bind(audience_code)
        .bind(language.code())
        .bind(delete_on)
        .bind(&recipient)
        .fetch_optional(&mut *tx)
        .await?;
        let id: Uuid = match retried {
            Some(id) => id,
            None => {
                sqlx::query_scalar(
                    r#"INSERT INTO lead_retention_reminder_emails
                           (lead_id, user_id, audience, recipient, language, deadline_on)
                       VALUES ($1, $2, $3, $4, $5, $6)
                       RETURNING id"#,
                )
                .bind(lead_id)
                .bind(user_id)
                .bind(audience_code)
                .bind(&recipient)
                .bind(language.code())
                .bind(delete_on)
                .fetch_one(&mut *tx)
                .await?
            }
        };
        recipients.push(ReminderRecipient {
            id,
            user_id,
            audience,
            recipient,
            name,
            language,
        });
    }
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_retention_reminder_queued",
            None,
            "lead",
            Some(lead_id),
            json!({
                "emails": recipients.len(),
                "deadline_on": delete_on.to_string(),
            }),
        ),
    )
    .await?;
    tx.commit().await?;

    let login_url = format!("{console_url}/login");
    let logo_url = crate::mail::templates::logo_url(console_url);
    let mut accepted = 0usize;
    for target in &recipients {
        let rendered = crate::mail::templates::retention_reminder(
            &crate::mail::templates::RetentionReminderEmail {
                language: target.language,
                audience: target.audience,
                recipient_name: &target.name,
                delete_on,
                login_url: &login_url,
                agency,
                logo_url: Some(&logo_url),
            },
        );
        let result = mailer
            .send(&crate::mail::OutgoingEmail {
                to: target.recipient.clone(),
                subject: rendered.subject,
                text: rendered.text,
                html: rendered.html,
                idempotency_key: format!("gmed-lead-retention-reminder-{}", target.id),
            })
            .await;
        let (status, message_id, error_code) = match &result {
            Ok(sent) => ("sent", Some(sent.message_id.clone()), None),
            Err(error) => ("failed", None, Some(error.code())),
        };
        if result.is_ok() {
            accepted += 1;
        }
        let mut conn = state.db.acquire().await?;
        sqlx::query(
            r#"UPDATE lead_retention_reminder_emails
               SET status = $2, provider_message_id = $3, error_code = $4,
                   sent_at = CASE WHEN $2 = 'sent' THEN now() END
               WHERE id = $1"#,
        )
        .bind(target.id)
        .bind(status)
        .bind(&message_id)
        .bind(error_code)
        .execute(&mut *conn)
        .await?;
        audit::write_in_transaction(
            &mut conn,
            &audit::domain_event(
                if result.is_ok() {
                    "lead_retention_reminder_sent"
                } else {
                    "lead_retention_reminder_failed"
                },
                None,
                "lead",
                Some(lead_id),
                json!({
                    "reminder_id": target.id,
                    "portal_user_id": target.user_id,
                    "audience": match target.audience {
                        LoginAudience::Guardian => "guardian",
                        _ => "lead",
                    },
                    "language": target.language.code(),
                    "provider": crate::mail::PROVIDER_ID,
                    "provider_message_id": message_id,
                    "error_code": error_code,
                }),
            ),
        )
        .await?;
    }
    if accepted == 0 {
        // Nothing went out: the lead stays due, the next sweep retries the
        // same rows (while the deadline is still ahead).
        return Ok(false);
    }
    sqlx::query(
        "UPDATE leads SET retention_reminder_sent_at = COALESCE(retention_reminder_sent_at, $2)
         WHERE id = $1",
    )
    .bind(lead_id)
    .bind(now)
    .execute(&state.db)
    .await?;
    Ok(true)
}

/// A due lead that cannot be deleted automatically needs a manual decision.
/// Repeated at most once a week per lead.
async fn notify_unqualified_lead_purge_blocked(
    state: &crate::state::AppState,
    lead_id: Uuid,
) -> Result<(), sqlx::Error> {
    let already_told: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
               SELECT 1 FROM user_notifications
               WHERE kind = 'lead_retention_blocked'
                 AND entity_type = 'lead'
                 AND entity_id = $1
                 AND created_at > now() - interval '7 days'
           )"#,
    )
    .bind(lead_id)
    .fetch_one(&state.db)
    .await?;
    if already_told {
        return Ok(());
    }
    let mut tx = state.db.begin().await?;
    let recipients = unqualified_lead_recipients(&mut tx, None).await?;
    let stored = store_lead_retention_notices(
        &mut tx,
        &recipients,
        "lead_retention_blocked",
        "Lead is due for deletion and needs a decision",
        "It has an order with an invoice or an order that could not be withdrawn.",
        lead_id,
    )
    .await?;
    tx.commit().await?;
    publish_lead_retention_notices(state, lead_id, &stored).await;
    Ok(())
}

#[cfg(test)]
mod unqualified_lead_retention_tests {
    use super::*;

    fn at(day: i64) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-10-01T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
            + chrono::Duration::days(day)
    }

    #[test]
    fn deadline_counts_from_creation_or_from_the_start_of_the_rule() {
        let policy = UnqualifiedLeadRetention {
            days: 14,
            effective_at: at(0),
        };
        // Created after the rule started: creation plus the window.
        assert_eq!(
            policy.deadline("in_progress", "pending", at(3)),
            Some(at(17))
        );
        // An older lead counts from the start of the rule, not from its creation.
        assert_eq!(
            policy.deadline("new", "documents_sent", at(-40)),
            Some(at(14))
        );
        assert_eq!(
            policy.deadline("archived", "rejected", at(-40)),
            Some(at(14))
        );
        assert_eq!(
            policy.deadline("not_qualified", "pending", at(1)),
            Some(at(15))
        );
    }

    /// One date for everyone: the deadline, but never earlier than the lead
    /// time after the staff warning — or after now while nobody was warned.
    #[test]
    fn the_deletion_instant_waits_for_the_warning_lead_time() {
        let now = at(20);
        // Overdue, never warned: the warning goes out now, deletion in 3 days.
        assert_eq!(effective_deletion_at(at(14), None, now), at(23));
        // Warned 1 day before the deadline: 3 days after the warning.
        assert_eq!(effective_deletion_at(at(14), Some(at(13)), now), at(16));
        // Warned 5 days before the deadline: the deadline itself.
        assert_eq!(effective_deletion_at(at(14), Some(at(9)), now), at(14));
        // Not yet warned and the deadline more than 3 days ahead: the deadline.
        assert_eq!(effective_deletion_at(at(30), None, now), at(30));
        let policy = UnqualifiedLeadRetention {
            days: 14,
            effective_at: at(0),
        };
        assert_eq!(
            policy.deletion_at("in_progress", "pending", at(0), None, now),
            Some(at(23))
        );
        assert_eq!(
            policy.deletion_at("in_progress", "signed", at(0), None, now),
            None
        );
    }

    #[test]
    fn rule_spares_qualified_converted_deleted_leads_and_signed_consent() {
        let policy = UnqualifiedLeadRetention {
            days: 14,
            effective_at: at(0),
        };
        for status in ["qualified", "converted", "deleted"] {
            assert_eq!(policy.deadline(status, "pending", at(1)), None, "{status}");
        }
        assert_eq!(policy.deadline("in_progress", "signed", at(1)), None);
    }
}

#[cfg(test)]
mod questionnaire_mapping_tests {
    use super::*;

    #[test]
    fn intake_language_uses_supported_code_or_locale_fallback() {
        assert_eq!(
            normalize_intake_language(Some("English"), Some("de")),
            Some("en".to_string())
        );
        assert_eq!(
            normalize_intake_language(Some("broken@example.com"), Some("ru-RU")),
            Some("ru".to_string())
        );
        assert_eq!(
            normalize_intake_language(None, Some("uk_UA")),
            Some("uk".to_string())
        );
        assert_eq!(
            normalize_intake_language(Some("ky"), Some("ru-RU")),
            Some("ky".to_string())
        );
    }

    /// QA C2-06: a lead converted without a preferred language still gets one,
    /// or every repeat order is blocked by "Preferred language is missing".
    #[test]
    fn a_converted_patient_always_has_a_language() {
        assert_eq!(
            converted_patient_languages(Some("Russian"), Some("de")),
            vec!["ru".to_string()]
        );
        assert_eq!(
            converted_patient_languages(None, Some("uk-UA")),
            vec!["uk".to_string()]
        );
        assert_eq!(
            converted_patient_languages(None, None),
            vec!["de".to_string()]
        );
        assert_eq!(
            converted_patient_languages(Some("  "), Some("")),
            vec!["de".to_string()]
        );
    }

    #[test]
    fn patient_country_names_become_lead_country_codes() {
        assert_eq!(lead_country_code(Some("Ukraine")), Some("UA".to_string()));
        assert_eq!(lead_country_code(Some(" ukraine ")), Some("UA".to_string()));
        assert_eq!(lead_country_code(Some("Denmark")), Some("DK".to_string()));
        assert_eq!(
            lead_country_code(Some("Saudi Arabia")),
            Some("SA".to_string())
        );
        assert_eq!(lead_country_code(Some("de")), Some("DE".to_string()));
        assert_eq!(lead_country_code(Some("Narnia")), None);
        assert_eq!(lead_country_code(Some("  ")), None);
        assert_eq!(lead_country_code(None), None);
    }

    #[test]
    fn questionnaire_country_codes_become_patient_country_names() {
        assert_eq!(patient_country(Some("DE")), Some("Germany".to_string()));
        assert_eq!(
            patient_country(Some("Ukraine")),
            Some("Ukraine".to_string())
        );
        assert_eq!(patient_country(Some("  ")), None);
    }

    #[test]
    fn questionnaire_contacts_are_deduplicated_and_keep_whatsapp_context() {
        let contacts = lead_patient_contacts(
            Some("person@example.com"),
            Some(true),
            Some("+49 151 123 45 67"),
            &json!([
                { "number": "+491511234567", "type": "mobile" },
                { "number": "+49 30 9988", "type": "work" }
            ]),
            Some("+49 (151) 123-45-67"),
            Some(false),
        );

        assert_eq!(contacts.len(), 3);
        assert_eq!(
            contacts
                .iter()
                .filter(|contact| contact.contact_kind == "phone" && contact.is_primary)
                .count(),
            1
        );
        let primary_phone = contacts
            .iter()
            .find(|contact| contact.contact_kind == "phone" && contact.is_primary)
            .expect("primary phone contact");
        assert!(
            primary_phone
                .notes
                .as_deref()
                .is_some_and(|notes| notes.contains("WhatsApp"))
        );
        assert!(
            primary_phone
                .notes
                .as_deref()
                .is_some_and(|notes| { notes.contains("Questionnaire contact consent: declined") })
        );
        assert!(contacts.iter().any(|contact| {
            contact.contact_kind == "email"
                && contact.notes.as_deref() == Some("Questionnaire contact consent: granted")
        }));
        assert!(contacts.iter().any(|contact| {
            contact.contact_kind == "phone"
                && contact.contact_type == "work"
                && contact.value == "+49 30 9988"
        }));
    }
}

#[cfg(test)]
mod manual_compliance_tests {
    use super::*;

    #[test]
    fn staff_cannot_set_signed_by_hand() {
        for current in ["pending", "documents_sent", "rejected"] {
            assert_eq!(
                manual_compliance_update(current, Some("signed")),
                Err(MANUAL_COMPLIANCE_SIGNED_REFUSED)
            );
        }
    }

    #[test]
    fn a_signed_lead_keeps_signed_when_the_form_sends_it_back() {
        assert_eq!(manual_compliance_update("signed", Some("signed")), Ok(None));
    }

    #[test]
    fn other_statuses_stay_manual() {
        assert_eq!(manual_compliance_update("pending", None), Ok(None));
        for requested in ["pending", "documents_sent", "rejected"] {
            assert_eq!(
                manual_compliance_update("signed", Some(requested)),
                Ok(Some(requested.to_string()))
            );
        }
    }
}

#[cfg(test)]
mod relation_type_tests {
    use super::normalized_patient_relation_type;

    #[test]
    fn ukrainian_parents_are_parents_and_batko_is_the_father() {
        assert_eq!(normalized_patient_relation_type(Some("Батьки")), "parent");
        assert_eq!(
            normalized_patient_relation_type(Some("один із батьків")),
            "parent"
        );
        assert_eq!(normalized_patient_relation_type(Some("батько")), "father");
        assert_eq!(normalized_patient_relation_type(Some("мати")), "mother");
        assert_eq!(normalized_patient_relation_type(Some("Vater")), "father");
    }
}

#[cfg(test)]
mod lead_conversion_readiness_tests {
    use super::*;

    #[test]
    fn overdue_invoices_are_surfaced_without_blocking_an_existing_customer() {
        let mut input = ready_input();
        input.debt_attention = true;
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(
            readiness.conversion_ready,
            "{:?}",
            readiness.conversion_reasons
        );
        let check = readiness.payload["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "debt_clear")
            .unwrap();
        assert_eq!(check["passed"], false);
    }

    #[test]
    fn package_covered_repeat_order_needs_no_separate_cost_estimate() {
        let mut input = ready_input();
        input.package_covered = true;
        input.order_cost_estimate_document_generated = false;
        input.quote_accepted = false;
        input.cost_estimate_work_types_selected = false;
        input.cost_estimate_document_generated = false;
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(
            readiness.conversion_ready,
            "{:?}",
            readiness.conversion_reasons
        );
        input.package_covered = false;
        assert!(!evaluate_lead_conversion_readiness(&input).conversion_ready);
    }

    fn ready_input() -> LeadConversionReadinessInput {
        LeadConversionReadinessInput {
            qualification_status: "qualified".to_string(),
            compliance_status: "signed".to_string(),
            converted_patient_id: None,
            date_of_birth: Some(
                NaiveDate::from_ymd_opt(1990, 1, 1).expect("static test date must be valid"),
            ),
            legal_sex: Some("female".to_string()),
            email: Some("lead@example.com".to_string()),
            phone: None,
            street_address: Some("Hauptstr. 1".to_string()),
            city: Some("Berlin".to_string()),
            zip_code: Some("10115".to_string()),
            requested_specialties: json!(["orthopedics"]),
            consent_privacy_practices: true,
            consent_healthcare: true,
            cabinet_consent_privacy: false,
            cabinet_consent_healthcare: false,
            cabinet_consent_privacy_recorded: Value::Null,
            cabinet_consent_healthcare_recorded: Value::Null,
            identity_document_verified: true,
            dsgvo_document_signed: true,
            confidentiality_release_signed: true,
            enhanced_due_diligence_required: false,
            enhanced_due_diligence_document_generated: false,
            enhanced_due_diligence_document_signed: false,
            payer_gwg_sheet_unsigned: false,
            contract_signed: true,
            contract_terminated: false,
            framework_document_generated: true,
            order_exists: true,
            order_service_ready: true,
            order_document_generated: true,
            order_cost_estimate_document_generated: true,
            order_signed_patient: true,
            order_signed_agency: true,
            quote_accepted: true,
            cost_estimate_catalog_available: true,
            cost_estimate_work_types_selected: true,
            cost_estimate_document_generated: true,
            prepayment_ready: true,
            debt_attention: false,
            debt_attention_reason: None,
            package_covered: false,
            payer: crate::routes::lead_payer::PayerReadiness::ready(),
            risk_assessment_held: false,
            guardian_contact_present: false,
            self_disclosure: crate::lead_self_disclosure::Status {
                required: true,
                signed: true,
            },
            contract_details_missing: Vec::new(),
        }
    }

    #[test]
    fn a_new_patients_first_onboarding_needs_the_signed_patient_form() {
        // Owner decision 2026-10-23: required for a new patient, optional
        // for a repeat order.
        let mut input = ready_input();
        assert!(evaluate_lead_conversion_readiness(&input).conversion_ready);
        input.self_disclosure.signed = false;
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(!readiness.conversion_ready);
        assert!(
            readiness
                .conversion_reasons
                .iter()
                .any(|reason| reason == SELF_DISCLOSURE_UNSIGNED),
            "{:?}",
            readiness.conversion_reasons
        );
        let check = readiness.payload["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "self_disclosure_signed")
            .unwrap()
            .clone();
        assert_eq!(check["passed"], false);
        assert_eq!(check["required"], true);
        assert_eq!(readiness.payload["steps"][3]["ready"], false);

        // A repeat request of an existing patient may go without it.
        input.self_disclosure.required =
            crate::lead_self_disclosure::required(None, Some(Uuid::new_v4()));
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(
            readiness.conversion_ready,
            "{:?}",
            readiness.conversion_reasons
        );
        assert!(
            !readiness
                .conversion_reasons
                .iter()
                .any(|reason| reason == SELF_DISCLOSURE_UNSIGNED)
        );
    }

    #[test]
    fn a_minor_is_reached_through_a_parent_contact() {
        // QA 2026-10-22: the wizard keeps a child's own e-mail and phone
        // optional; the readiness must not ask for them when a parent has one.
        let mut input = ready_input();
        input.date_of_birth = Some(crate::app_time::today() - chrono::Duration::days(365 * 9));
        input.email = None;
        input.phone = None;
        let reasons = evaluate_lead_conversion_readiness(&input).conversion_reasons;
        assert!(
            reasons
                .iter()
                .any(|reason| reason == "Email or phone is required"),
            "{reasons:?}"
        );

        input.guardian_contact_present = true;
        let reasons = evaluate_lead_conversion_readiness(&input).conversion_reasons;
        assert!(
            !reasons
                .iter()
                .any(|reason| reason == "Email or phone is required"),
            "{reasons:?}"
        );

        // An adult still needs an own contact.
        input.date_of_birth = NaiveDate::from_ymd_opt(1990, 1, 1);
        let reasons = evaluate_lead_conversion_readiness(&input).conversion_reasons;
        assert!(
            reasons
                .iter()
                .any(|reason| reason == "Email or phone is required"),
            "{reasons:?}"
        );
    }

    #[test]
    fn a_birth_date_must_be_plausible() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 22).expect("date");
        assert!(plausible_birth_date(today, today).is_ok());
        assert!(
            plausible_birth_date(NaiveDate::from_ymd_opt(1900, 1, 1).expect("date"), today).is_ok()
        );
        assert_eq!(
            plausible_birth_date(NaiveDate::from_ymd_opt(2026, 10, 23).expect("date"), today),
            Err("date_of_birth cannot be in the future")
        );
        assert_eq!(
            plausible_birth_date(NaiveDate::from_ymd_opt(1899, 12, 31).expect("date"), today),
            Err("date_of_birth is too early")
        );
    }

    /// Owner 2026-10-24: staff names and city follow the cabinet's rule when
    /// new or changed; a longer stored value does not block other edits.
    #[test]
    fn staff_names_and_city_follow_the_shared_rule_when_changed() {
        let long = "x".repeat(101);
        assert_eq!(
            new_name_too_long(&[("first_name", "Anna", None), ("last_name", &long, None)]),
            Some("last_name")
        );
        assert_eq!(
            new_name_too_long(&[("last_name", &long, Some(long.as_str()))]),
            None
        );
        assert_eq!(new_name_too_long(&[("middle_name", "", None)]), None);
        assert!(new_city_too_long(Some(&"y".repeat(121)), None));
        assert!(!new_city_too_long(
            Some(&"y".repeat(121)),
            Some(&"y".repeat(121))
        ));
        assert!(!new_city_too_long(Some("Berlin"), None));
        assert!(!new_city_too_long(None, None));
    }

    #[test]
    fn a_trusted_contact_born_in_the_future_is_refused() {
        let contact = |birth_date: &str| TrustedContactRequest {
            id: None,
            related_patient_id: None,
            name: "Anna Muster".to_string(),
            phone: None,
            email: None,
            relation: Some("mother".to_string()),
            birth_date: Some(birth_date.to_string()),
            address: None,
            scope_codes: None,
            citizenships: None,
            birth_place: None,
            birth_country: None,
        };
        assert!(normalize_trusted_contacts(&[contact("1985-03-02")]).is_ok());
        assert_eq!(
            normalize_trusted_contacts(&[contact("2999-01-01")]),
            Err("Trusted contact birth_date is not plausible")
        );
    }

    #[test]
    fn guardian_contact_needs_a_parent_relation_and_a_channel() {
        assert!(guardian_contact_present(&json!([
            { "name": "Anna Muster", "relation": "mother", "email": null, "phone": "+49 30 1" }
        ])));
        assert!(!guardian_contact_present(&json!([
            { "name": "Anna Muster", "relation": "mother", "email": " ", "phone": null }
        ])));
        assert!(!guardian_contact_present(&json!([
            { "name": "Eva Friend", "relation": "other", "email": "eva@example.com" }
        ])));
        assert!(!guardian_contact_present(&json!(null)));
    }

    #[test]
    fn the_reason_of_the_request_is_optional_for_readiness() {
        // Owner 2026-10-19: neither the staff "Причина обращения" nor the
        // lead's own reason is required; the readiness never asks for it.
        let readiness = evaluate_lead_conversion_readiness(&ready_input());
        assert!(
            readiness.conversion_ready,
            "{:?}",
            readiness.conversion_reasons
        );
        let checks = readiness.payload["checks"]
            .as_array()
            .expect("readiness checks");
        assert!(
            checks.iter().all(|check| !matches!(
                check["key"].as_str(),
                Some("primary_concern_present" | "medical_characteristics_present")
            )),
            "{checks:?}"
        );
        let steps = readiness.payload["steps"].as_array().expect("steps");
        let step = |key: &str| {
            steps
                .iter()
                .find(|step| step["key"] == key)
                .map(|step| step["ready"].clone())
        };
        assert_eq!(step("medical"), Some(json!(true)));
        assert_eq!(step("service"), Some(json!(true)));

        // The service step waits only for a requested specialty.
        let mut input = ready_input();
        input.requested_specialties = json!([]);
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(
            readiness
                .conversion_reasons
                .contains(&"Requested specialty is missing".to_string())
        );
    }

    #[test]
    fn missing_payer_declaration_blocks_conversion_on_the_documents_step() {
        let mut input = ready_input();
        input.payer = crate::routes::lead_payer::PayerReadiness::default();
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(!readiness.conversion_ready);
        assert!(readiness.qualification_ready);
        assert!(
            readiness
                .conversion_reasons
                .contains(&"Payer declaration is missing".to_string()),
            "{:?}",
            readiness.conversion_reasons
        );
        let documents = readiness.payload["steps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|step| step["key"] == "documents")
            .unwrap();
        assert_eq!(documents["ready"], false);
    }

    #[test]
    fn conversion_readiness_is_true_for_fully_ready_qualified_lead() {
        let readiness = evaluate_lead_conversion_readiness(&ready_input());

        assert!(readiness.qualification_ready);
        assert!(readiness.conversion_ready);
        assert!(readiness.qualification_reasons.is_empty());
        assert!(readiness.conversion_reasons.is_empty());
    }

    #[test]
    fn missing_contract_details_of_representatives_block_the_conversion_only() {
        let mut input = ready_input();
        input.contract_details_missing = vec!["representative:abc:birth_place".to_string()];
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(readiness.qualification_ready);
        assert!(!readiness.conversion_ready);
        assert_eq!(
            readiness.conversion_reasons,
            vec![CONTRACT_DETAILS_MISSING.to_string()]
        );
        assert!(readiness.qualification_reasons.is_empty());
        assert_eq!(
            readiness.payload["contract_details_missing"],
            json!(["representative:abc:birth_place"])
        );
        // Nothing to complete: the key is left out.
        let ready = evaluate_lead_conversion_readiness(&ready_input());
        assert!(ready.payload.get("contract_details_missing").is_none());
    }

    #[test]
    fn signed_lead_can_convert_while_awaiting_prepayment() {
        let mut input = ready_input();
        input.prepayment_ready = false;
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(readiness.conversion_ready);
        assert!(readiness.conversion_reasons.is_empty());
        let payment_check = readiness.payload["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "prepayment_ready")
            .unwrap();
        assert_eq!(payment_check["passed"], false);
        assert!(payment_check["blocking_for"].is_null());
    }

    #[test]
    fn signed_confidentiality_release_is_required_for_conversion() {
        let mut input = ready_input();
        input.confidentiality_release_signed = false;

        let readiness = evaluate_lead_conversion_readiness(&input);

        assert!(!readiness.conversion_ready);
        assert_eq!(
            readiness.conversion_reasons,
            vec!["Signed confidentiality release is missing".to_string()]
        );
        assert_eq!(
            readiness.payload["checks"]
                .as_array()
                .and_then(|checks| checks
                    .iter()
                    .find(|check| { check["key"] == "confidentiality_release_signed" }))
                .map(|check| &check["passed"]),
            Some(&Value::Bool(false))
        );
    }

    #[test]
    fn enhanced_due_diligence_document_is_required_when_the_rule_requires_the_check() {
        let mut input = ready_input();
        input.enhanced_due_diligence_required = true;

        let readiness = evaluate_lead_conversion_readiness(&input);

        assert!(!readiness.conversion_ready);
        assert_eq!(
            readiness.conversion_reasons,
            vec!["Enhanced due diligence document is missing".to_string()]
        );

        input.enhanced_due_diligence_document_generated = true;
        assert_eq!(
            evaluate_lead_conversion_readiness(&input).conversion_reasons,
            vec!["Enhanced due diligence document is not signed".to_string()]
        );
        input.enhanced_due_diligence_document_signed = true;
        assert!(evaluate_lead_conversion_readiness(&input).conversion_ready);
    }

    #[test]
    fn an_open_payer_gwg_sheet_keeps_the_compliance_open() {
        // Owner decision 2026-10-30: the payer's generated, unsigned GwG
        // sheet means the compliance is not complete.
        let mut input = ready_input();
        assert!(evaluate_lead_conversion_readiness(&input).conversion_ready);
        input.payer_gwg_sheet_unsigned = true;
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(!readiness.conversion_ready);
        assert!(
            readiness.payload["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|check| check["key"] == "compliance_completed" && check["passed"] == false)
        );
        assert!(
            readiness.payload["blocking_reasons"]
                .as_array()
                .unwrap()
                .iter()
                .any(|reason| reason == "Payer GwG sheet is not signed")
        );
        assert!(
            !readiness.payload["blocking_reasons"]
                .as_array()
                .unwrap()
                .iter()
                .any(|reason| reason == "Compliance is not signed yet")
        );
    }

    #[test]
    fn a_held_risk_assessment_keeps_the_documents_step_open() {
        let step_ready = |readiness: &LeadConversionReadiness, key: &str| {
            readiness.payload["steps"]
                .as_array()
                .unwrap()
                .iter()
                .find(|step| step["key"] == key)
                .unwrap()["ready"]
                == true
        };
        let mut input = ready_input();
        assert!(step_ready(
            &evaluate_lead_conversion_readiness(&input),
            "documents"
        ));
        input.risk_assessment_held = true;
        let held = evaluate_lead_conversion_readiness(&input);
        // The step, its check and the reason say the same.
        assert!(!step_ready(&held, "documents"));
        assert!(
            held.payload["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|check| {
                    check["key"] == "risk_assessment_released"
                        && check["stage"] == "documents"
                        && check["passed"] == false
                })
        );
        assert!(
            held.qualification_reasons
                .contains(&"Risk assessment waits for a staff decision".to_string())
        );
    }

    #[test]
    fn order_cost_estimate_document_is_required_for_conversion() {
        let mut input = ready_input();
        input.order_cost_estimate_document_generated = false;

        let readiness = evaluate_lead_conversion_readiness(&input);

        assert!(!readiness.conversion_ready);
        assert_eq!(
            readiness.conversion_reasons,
            vec!["Order cost estimate document is missing".to_string()]
        );
    }

    #[test]
    fn preliminary_cost_calculation_is_not_required_without_catalog_work_types() {
        // None of the requested specialisations has medical work types in the
        // catalog yet: there is nothing for the VKS to list, so it does not block.
        let mut input = ready_input();
        input.cost_estimate_catalog_available = false;
        input.cost_estimate_work_types_selected = false;
        input.cost_estimate_document_generated = false;
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(
            readiness.conversion_ready,
            "{:?}",
            readiness.conversion_reasons
        );
        let check = readiness.payload["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "cost_estimate_document_generated")
            .unwrap();
        assert_eq!(check["passed"], true);

        // Once the catalog has work types, the VKS is required again.
        input.cost_estimate_catalog_available = true;
        assert_eq!(
            evaluate_lead_conversion_readiness(&input).conversion_reasons,
            vec![COST_ESTIMATE_WORK_TYPES_MISSING.to_string()]
        );
    }

    #[test]
    fn preliminary_cost_calculation_asks_for_medical_work_types_first() {
        let mut input = ready_input();
        input.cost_estimate_work_types_selected = false;
        // A VKS generated earlier does not stand in for the missing work types.
        let readiness = evaluate_lead_conversion_readiness(&input);
        assert!(!readiness.conversion_ready);
        assert_eq!(
            readiness.conversion_reasons,
            vec![COST_ESTIMATE_WORK_TYPES_MISSING.to_string()]
        );
        let check = readiness.payload["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "cost_estimate_document_generated")
            .unwrap();
        assert_eq!(check["passed"], false);
        let commercial = readiness.payload["steps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|step| step["key"] == "commercial")
            .unwrap();
        assert_eq!(commercial["ready"], false);

        input.cost_estimate_work_types_selected = true;
        input.cost_estimate_document_generated = false;
        assert_eq!(
            evaluate_lead_conversion_readiness(&input).conversion_reasons,
            vec!["Preliminary cost calculation document is missing".to_string()]
        );
    }

    #[test]
    fn cost_estimate_work_type_selection_reads_the_wizard_state() {
        let id = "6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
        assert!(lead_cost_estimate_work_types_selected(
            &json!({ "selected_specialization_work_type_ids": [id] })
        ));
        assert!(lead_cost_estimate_work_types_selected(
            &json!({ "selectedSpecializationWorkTypeIds": [id] })
        ));
        for state in [
            json!({}),
            json!({ "selected_specialization_work_type_ids": [] }),
            json!({ "selected_specialization_work_type_ids": null }),
            json!({ "selected_specialization_work_type_ids": ["not-a-uuid"] }),
        ] {
            assert!(!lead_cost_estimate_work_types_selected(&state), "{state}");
        }
    }

    #[test]
    fn address_is_not_required_before_healthcare_consent() {
        let mut input = ready_input();
        input.consent_healthcare = false;
        input.street_address = None;
        input.city = None;
        input.zip_code = None;

        let readiness = evaluate_lead_conversion_readiness(&input);

        assert!(!readiness.conversion_ready);
        assert_eq!(
            readiness.qualification_reasons,
            vec!["Healthcare consent is missing".to_string()]
        );
        assert!(
            !readiness
                .conversion_reasons
                .contains(&"Complete street, city and postal code".to_string())
        );
        assert_eq!(readiness.payload["steps"][0]["ready"], true);
    }

    #[test]
    fn complete_address_is_required_after_healthcare_consent() {
        for missing_field in ["street", "city", "postal_code"] {
            let mut input = ready_input();
            match missing_field {
                "street" => input.street_address = None,
                "city" => input.city = None,
                "postal_code" => input.zip_code = None,
                _ => unreachable!(),
            }

            let readiness = evaluate_lead_conversion_readiness(&input);

            assert!(!readiness.conversion_ready, "missing {missing_field}");
            assert_eq!(
                readiness.conversion_reasons,
                vec!["Complete street, city and postal code".to_string()],
                "missing {missing_field}"
            );
            assert_eq!(
                readiness.payload["steps"][0]["ready"], false,
                "missing {missing_field}"
            );
        }
    }

    #[test]
    fn an_unsigned_consent_form_is_one_blocker_and_disclosure_is_never_required() {
        // The cabinet consents are given (as for the DEV lead of 2026-10-19
        // who answered "No" to the disclosure to third parties); only the
        // generated consent form is still unsigned.
        let mut input = ready_input();
        input.qualification_status = "in_progress".to_string();
        input.compliance_status = "documents_sent".to_string();
        input.dsgvo_document_signed = false;

        let readiness = evaluate_lead_conversion_readiness(&input);

        assert_eq!(
            readiness.qualification_reasons,
            vec!["Compliance is not signed yet".to_string()]
        );
        assert_eq!(
            readiness.conversion_reasons,
            vec![
                "Lead must be qualified before conversion".to_string(),
                "Signed DSGVO document is missing".to_string(),
            ]
        );
    }

    #[test]
    fn converted_patient_id_forces_conversion_ready_false() {
        let mut input = ready_input();
        input.converted_patient_id = Some(Uuid::new_v4());

        let readiness = evaluate_lead_conversion_readiness(&input);

        assert!(readiness.qualification_ready);
        assert!(!readiness.conversion_ready);
        assert_eq!(
            readiness.conversion_reasons,
            vec!["Lead is already converted".to_string()]
        );
        assert_eq!(
            readiness.payload["conversion_ready"].as_bool(),
            Some(false),
            "payload must mirror the computed conversion gate"
        );
        assert!(
            readiness.payload["blocking_reasons"]
                .as_array()
                .is_some_and(|reasons| reasons
                    .iter()
                    .any(|value| value == "Lead is already converted")),
            "payload must keep the converted-lead blocking reason"
        );
    }
}

#[cfg(test)]
mod auto_purge_tests {
    use super::*;
    use chrono::{Duration, Utc};

    fn now() -> chrono::DateTime<chrono::Utc> {
        Utc::now()
    }

    #[test]
    fn prospect_of_unconverted_lead_is_purged() {
        assert!(should_purge_prospect("prospective", false));
    }

    #[test]
    fn prospect_of_converted_lead_is_never_purged() {
        assert!(!should_purge_prospect("prospective", true));
    }

    #[test]
    fn active_patient_is_never_purged() {
        assert!(!should_purge_prospect("active", false));
        assert!(!should_purge_prospect("active", true));
    }

    #[test]
    fn inactive_patient_is_never_purged() {
        assert!(!should_purge_prospect("inactive", false));
    }

    #[test]
    fn deleted_patient_is_never_purged_again() {
        assert!(!should_purge_prospect("deleted", false));
    }

    #[test]
    fn archived_older_than_retention_is_purged() {
        let ref_at = now() - Duration::days(200);
        assert!(should_auto_purge(
            "archived",
            None,
            "Alice",
            ref_at,
            now(),
            180
        ));
    }

    #[test]
    fn not_qualified_older_than_retention_is_purged() {
        let ref_at = now() - Duration::days(200);
        assert!(should_auto_purge(
            "not_qualified",
            None,
            "Bob",
            ref_at,
            now(),
            180
        ));
    }

    #[test]
    fn archived_within_retention_is_kept() {
        let ref_at = now() - Duration::days(90);
        assert!(!should_auto_purge(
            "archived",
            None,
            "Alice",
            ref_at,
            now(),
            180
        ));
    }

    #[test]
    fn already_anonymized_sentinel_name_is_skipped() {
        // Belt and braces: if the row is older than retention but its
        // first_name is the anonymisation sentinel, do not touch it.
        let ref_at = now() - Duration::days(365);
        assert!(!should_auto_purge(
            "archived",
            None,
            ANONYMIZED_FIRST_NAME,
            ref_at,
            now(),
            180
        ));
    }

    #[test]
    fn already_marked_delete_anonymized_is_skipped() {
        let ref_at = now() - Duration::days(365);
        assert!(!should_auto_purge(
            "archived",
            Some("delete_anonymized"),
            "Alice",
            ref_at,
            now(),
            180
        ));
    }

    /// QA 2026-10-12: an anonymised lead keeps a listed reason or a system
    /// code, never what staff typed.
    #[test]
    fn an_anonymised_lead_keeps_only_a_reason_code() {
        for code in [
            "not_our_lead",
            "duplicate",
            "costs",
            "other",
            "dsgvo_erasure",
            "auto_purge_storage_limitation",
            "auto_purge_unqualified_retention",
        ] {
            assert_eq!(anonymised_failure_reason(code), code);
        }
        for typed in [
            "Synthetischer QA-Fall: Patient aus gesperrtem Land",
            "Anna Muster hat abgesagt",
            "mueller",
            "Diagnose: Diabetes",
            "",
        ] {
            assert_eq!(anonymised_failure_reason(typed), "other", "{typed}");
        }
    }

    /// QA 2026-10-12, A3-02: the deletion scrubs staff's words from the lead
    /// history and the audit context, keeping codes, keys and flags.
    #[test]
    fn the_deletion_scrubs_typed_words_but_keeps_codes() {
        use super::{
            ERASED_AUDIT_TEXT, failure_reason_is_free_text, scrubbed_audit_context,
            scrubbed_lifecycle_event,
        };
        use serde_json::json;
        assert!(failure_reason_is_free_text("Ben Muster, Diagnose X"));
        assert!(!failure_reason_is_free_text(" costs "));
        assert!(!failure_reason_is_free_text(
            "auto_purge_storage_limitation"
        ));
        assert!(!failure_reason_is_free_text("  "));

        let (note, metadata) = scrubbed_lifecycle_event(
            "status_change",
            Some("Ben Muster, Diagnose X"),
            &json!({ "status": "not_qualified" }),
        )
        .unwrap();
        assert_eq!(note.as_deref(), Some("other"));
        assert_eq!(metadata, json!({ "status": "not_qualified" }));
        let (note, metadata) = scrubbed_lifecycle_event(
            "archived",
            Some("duplicate"),
            &json!({ "resolution": "archived", "note": "Interne Notiz" }),
        )
        .unwrap();
        assert_eq!(note.as_deref(), Some("duplicate"));
        assert_eq!(metadata, json!({ "resolution": "archived" }));
        // System notes of other entries and clean entries stay.
        assert_eq!(
            scrubbed_lifecycle_event("converted", Some("Lead converted to patient"), &json!({})),
            None
        );
        assert_eq!(
            scrubbed_lifecycle_event("deleted", Some("other"), &json!({ "note": null })),
            None
        );

        let context = json!({
            "status": "not_qualified",
            "reason": "Ben Muster, Diagnose X",
            "note": "Interne Notiz",
            "lead_reason": "costs",
            "reason_free_text": true,
            "cancelled_service_ids": []
        });
        let scrubbed = scrubbed_audit_context(&context).unwrap();
        assert_eq!(scrubbed["reason"], ERASED_AUDIT_TEXT);
        assert_eq!(scrubbed["note"], ERASED_AUDIT_TEXT);
        assert_eq!(scrubbed["lead_reason"], "costs");
        assert_eq!(scrubbed["reason_free_text"], true);
        assert_eq!(scrubbed["status"], "not_qualified");
        assert_eq!(scrubbed["cancelled_service_ids"], json!([]));
        assert_eq!(scrubbed_audit_context(&scrubbed), None, "idempotent");
        assert_eq!(
            scrubbed_audit_context(&json!({ "reason": "no_response", "note": null })),
            None
        );
    }

    #[test]
    fn converted_lead_is_never_purged() {
        // Converted leads live under a different lifecycle (they have a
        // patient row). The sweeper must not touch them regardless of age.
        let ref_at = now() - Duration::days(3650);
        assert!(!should_auto_purge(
            "converted",
            None,
            "Alice",
            ref_at,
            now(),
            180
        ));
    }

    #[test]
    fn boundary_at_exactly_retention_days_is_purged() {
        // Edge case: a row that turned 180 days old today should be
        // eligible — Storage Limitation does not get a grace day.
        let ref_at = now() - Duration::days(180);
        assert!(should_auto_purge(
            "archived",
            None,
            "Alice",
            ref_at,
            now(),
            180
        ));
    }

    #[test]
    fn new_lead_is_never_purged() {
        let ref_at = now() - Duration::days(3650);
        assert!(!should_auto_purge("new", None, "Alice", ref_at, now(), 180));
    }

    #[test]
    fn in_progress_lead_is_never_purged() {
        let ref_at = now() - Duration::days(3650);
        assert!(!should_auto_purge(
            "in_progress",
            None,
            "Alice",
            ref_at,
            now(),
            180
        ));
    }
}

#[cfg(test)]
mod repeat_conversion_relation_tests {
    use super::*;

    fn identity(
        contact_id: Option<Uuid>,
        citizenships: &[&str],
    ) -> crate::services::lead_guardian_identity::CanonicalGuardianIdentity {
        crate::services::lead_guardian_identity::CanonicalGuardianIdentity {
            contact_id,
            related_patient_id: None,
            position: 0,
            name: "Anna Muster".into(),
            citizenships: citizenships.iter().map(|code| code.to_string()).collect(),
            residences: Vec::new(),
            role: "legal_representative".into(),
            contact: json!({}),
            extras: json!({}),
        }
    }

    /// Owner decision 2026-10-23: the relation keeps the parent's
    /// citizenships; a contact without an id or without codes keeps the
    /// relation's stored ones.
    #[test]
    fn the_conversion_keeps_each_contacts_citizenships_on_its_relation() {
        let anna = Uuid::from_bytes([1; 16]);
        let ben = Uuid::from_bytes([2; 16]);
        let kept = relation_citizenships_by_contact(vec![
            identity(Some(anna), &["DE", "UA"]),
            identity(Some(ben), &[]),
            identity(None, &["PL"]),
        ]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[&anna], vec!["DE".to_string(), "UA".to_string()]);
    }

    #[test]
    fn a_repeat_request_takes_the_relations_valid_citizenships() {
        assert_eq!(
            repeat_representative_citizenships(vec![
                "de".into(),
                " UA ".into(),
                "DE".into(),
                "Ukraine".into(),
                "XX".into(),
            ]),
            vec!["DE".to_string(), "UA".to_string()]
        );
        assert!(repeat_representative_citizenships(Vec::new()).is_empty());
    }

    fn relation(n: u8, name: &str, relation_type: &str) -> ExistingRelation {
        ExistingRelation {
            id: Uuid::from_bytes([n; 16]),
            related_patient_id: None,
            related_name: name.into(),
            relation_type: relation_type.into(),
            source_contact_id: None,
        }
    }

    #[test]
    fn a_repeat_conversion_finds_the_relation_of_the_same_person() {
        let contact = Uuid::from_bytes([9; 16]);
        let older = relation(1, "Anna Muster", "parent");
        // An older "parent" is the same person as a new "mother"; a
        // patronymic on one side only does not make a second person.
        assert_eq!(
            matching_relation(
                std::slice::from_ref(&older),
                &[],
                None,
                None,
                "Anna Muster",
                "mother"
            ),
            Some(older.id)
        );
        assert_eq!(
            matching_relation(
                std::slice::from_ref(&older),
                &[],
                None,
                None,
                "Anna Petrovna Muster",
                "mother"
            ),
            Some(older.id)
        );
        // Not another kind of relation, not one taken already.
        assert_eq!(
            matching_relation(
                std::slice::from_ref(&older),
                &[],
                None,
                None,
                "Anna Muster",
                "spouse"
            ),
            None
        );
        assert_eq!(
            matching_relation(
                std::slice::from_ref(&older),
                &[older.id],
                None,
                None,
                "Anna Muster",
                "mother"
            ),
            None
        );
        // The entry it was created from wins over any name.
        let created = ExistingRelation {
            source_contact_id: Some(contact),
            ..relation(2, "Anna Alt", "mother")
        };
        assert_eq!(
            matching_relation(
                &[older.clone(), created.clone()],
                &[],
                Some(contact),
                None,
                "Anna Neu",
                "mother"
            ),
            Some(created.id)
        );
        // A relation another entry created is never taken by a name.
        assert_eq!(
            matching_relation(
                std::slice::from_ref(&created),
                &[],
                Some(Uuid::from_bytes([8; 16])),
                None,
                "Anna Alt",
                "mother"
            ),
            None
        );
        // The linked patient record decides; another record is another person.
        let person = Uuid::from_bytes([7; 16]);
        let linked = ExistingRelation {
            related_patient_id: Some(person),
            ..relation(3, "Ben Muster", "parent")
        };
        assert_eq!(
            matching_relation(
                std::slice::from_ref(&linked),
                &[],
                None,
                Some(person),
                "Benjamin Muster",
                "father"
            ),
            Some(linked.id)
        );
        assert_eq!(
            matching_relation(
                std::slice::from_ref(&linked),
                &[],
                None,
                Some(Uuid::from_bytes([6; 16])),
                "Ben Muster",
                "father"
            ),
            None
        );
        // Two compatible names without an exact one: nobody is guessed.
        let first = relation(4, "Anna Maria Muster", "mother");
        let second = relation(5, "Anna Luise Muster", "mother");
        assert_eq!(
            matching_relation(&[first, second], &[], None, None, "Anna Muster", "mother"),
            None
        );
    }
}
