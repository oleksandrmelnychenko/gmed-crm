#![allow(clippy::result_large_err)]

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::{
        HeaderValue, StatusCode,
        header::{CACHE_CONTROL, PRAGMA},
    },
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use tower_http::set_header::SetResponseHeaderLayer;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::file_sniff::validate_upload_magic_bytes;
use crate::routes::documents::{is_iso_country_code, read_document_storage_bytes};
use crate::routes::patients::{
    normalize_patient_lab_result_payload, normalize_patient_vital_measurement_payload,
};
use crate::state::AppState;
use gmed_domain::role::Role;

// The first-release workspace exposes clinical imports to the CEO only.
// Keep this route contract aligned with the global release-role gate.
const IMPORT_ROLES: &[Role] = &[Role::Ceo];
const UNSUPPORTED_IMPORT_FILE: &str = "Clinical import supports only PDF, PNG, and JPEG documents";
const MAX_IMPORT_FILE_BYTES: usize = 25 * 1024 * 1024;

fn validate_clinical_import_file(
    original_filename: Option<&str>,
    mime_type: Option<&str>,
    data: &[u8],
) -> Result<(), &'static str> {
    let mime_type = mime_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        mime_type.as_str(),
        "application/pdf" | "image/png" | "image/jpeg"
    ) {
        return Err(UNSUPPORTED_IMPORT_FILE);
    }

    let validated_mime =
        validate_upload_magic_bytes(original_filename, Some(mime_type.as_str()), data)?
            .ok_or(UNSUPPORTED_IMPORT_FILE)?;
    if matches!(
        validated_mime.as_str(),
        "application/pdf" | "image/png" | "image/jpeg"
    ) {
        Ok(())
    } else {
        Err(UNSUPPORTED_IMPORT_FILE)
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/clinical-document-imports",
            get(list_imports).post(create_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}",
            get(get_import).delete(delete_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}/retry",
            post(retry_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}/complete",
            post(complete_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}/prepare",
            post(prepare_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}/medications",
            post(persist_imported_medication),
        )
        .route(
            "/patients/{patient_id}/medication-import-history",
            get(list_medication_import_history),
        )
        .layer(SetResponseHeaderLayer::overriding(
            PRAGMA,
            HeaderValue::from_static("no-cache"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("private, no-store, max-age=0"),
        ))
}

#[derive(Deserialize)]
struct CreateImportRequest {
    document_id: Uuid,
}

#[derive(Deserialize)]
struct CompleteImportRequest {
    reviewed_draft: Value,
}

#[derive(Deserialize)]
struct PrepareImportRequest {
    reviewed_draft: Value,
    #[serde(default)]
    source_country: Option<String>,
    #[serde(default)]
    patient_identity_confirmed: bool,
    candidate_payloads: Value,
}

#[derive(Deserialize)]
struct ParsedDocumentSubject {
    status: String,
    conflict: bool,
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<String>,
    patient_identifier: Option<String>,
    patient_identifier_namespace: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum SubjectIdentityDecision {
    Missing,
    Matched,
    NameConfirmationRequired,
    ConfirmedNameMismatch,
    HardMismatch,
    ConfirmationWithoutSubject,
}

fn normalize_identity_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn normalize_patient_identifier(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

fn evaluate_document_subject_identity(
    stored_draft: &Value,
    patient_first_name: &str,
    patient_last_name: &str,
    patient_birth_date: chrono::NaiveDate,
    patient_identifier: &str,
    patient_identity_confirmed: bool,
) -> SubjectIdentityDecision {
    let Some(subject_value) = stored_draft.get("subject") else {
        return if patient_identity_confirmed {
            SubjectIdentityDecision::ConfirmationWithoutSubject
        } else {
            SubjectIdentityDecision::Missing
        };
    };
    if subject_value.is_null() {
        return if patient_identity_confirmed {
            SubjectIdentityDecision::ConfirmationWithoutSubject
        } else {
            SubjectIdentityDecision::Missing
        };
    }
    let Ok(subject) = serde_json::from_value::<ParsedDocumentSubject>(subject_value.clone()) else {
        return SubjectIdentityDecision::HardMismatch;
    };
    if subject.conflict || subject.status != "extracted" {
        return SubjectIdentityDecision::HardMismatch;
    }
    let subject_birth_date = subject.birth_date.as_deref().filter(|value| !value.trim().is_empty());
    if let Some(birth_date) = subject_birth_date {
        let Ok(birth_date) = chrono::NaiveDate::parse_from_str(birth_date, "%Y-%m-%d") else {
            return SubjectIdentityDecision::HardMismatch;
        };
        if birth_date != patient_birth_date {
            return SubjectIdentityDecision::HardMismatch;
        }
    }
    let subject_identifier = subject
        .patient_identifier
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let identifier_namespace = subject
        .patient_identifier_namespace
        .as_deref()
        .unwrap_or("source_document");
    if subject_identifier.is_some()
        && !matches!(identifier_namespace, "source_document" | "gmed_patient_id")
    {
        return SubjectIdentityDecision::HardMismatch;
    }
    let identifier_mismatch = subject_identifier.is_some_and(|value| {
        normalize_patient_identifier(value) != normalize_patient_identifier(patient_identifier)
    });
    if identifier_namespace == "gmed_patient_id" && identifier_mismatch {
        return SubjectIdentityDecision::HardMismatch;
    }
    let external_identifier_mismatch =
        identifier_namespace == "source_document" && identifier_mismatch;
    let subject_first_name = subject
        .first_name
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let subject_last_name = subject
        .last_name
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let first_name_mismatch = subject_first_name.is_some_and(|value| {
        normalize_identity_name(value) != normalize_identity_name(patient_first_name)
    });
    let last_name_mismatch = subject_last_name.is_some_and(|value| {
        normalize_identity_name(value) != normalize_identity_name(patient_last_name)
    });
    if first_name_mismatch || last_name_mismatch || external_identifier_mismatch {
        if patient_identity_confirmed {
            SubjectIdentityDecision::ConfirmedNameMismatch
        } else {
            SubjectIdentityDecision::NameConfirmationRequired
        }
    } else if subject_birth_date.is_some()
        || (identifier_namespace == "gmed_patient_id" && subject_identifier.is_some())
        || (subject_first_name.is_some() && subject_last_name.is_some())
    {
        SubjectIdentityDecision::Matched
    } else if patient_identity_confirmed {
        SubjectIdentityDecision::ConfirmationWithoutSubject
    } else {
        SubjectIdentityDecision::Missing
    }
}

#[derive(Default)]
enum NullableField<T> {
    #[default]
    Missing,
    Null,
    Value(T),
}

impl<'de, T> Deserialize<'de> for NullableField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(|value| match value {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

impl<T> NullableField<T> {
    fn is_supplied(&self) -> bool {
        !matches!(self, Self::Missing)
    }

    fn into_option(self) -> Option<T> {
        match self {
            Self::Value(value) => Some(value),
            Self::Missing | Self::Null => None,
        }
    }
}

#[derive(Deserialize)]
struct ReviewedCandidate {
    id: String,
    target: String,
    value: String,
    #[serde(default = "default_selected")]
    selected: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ImportedMedicationRequest {
    candidate_id: String,
    #[serde(default)]
    medication_series_id: Option<Uuid>,
    #[serde(default)]
    create_new_series: bool,
    #[serde(default, alias = "active_ingredient")]
    wirkstoff: Option<String>,
    #[serde(default, alias = "brand_name")]
    handelsname: NullableField<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default, alias = "strength")]
    staerke: NullableField<String>,
    #[serde(default, alias = "dosage_form")]
    form: NullableField<String>,
    #[serde(default)]
    dose_morgens: NullableField<String>,
    #[serde(default)]
    dose_mittags: NullableField<String>,
    #[serde(default)]
    dose_abends: NullableField<String>,
    #[serde(default)]
    dose_nachts: NullableField<String>,
    #[serde(default)]
    einheit: NullableField<String>,
    #[serde(default)]
    hinweis: NullableField<String>,
    #[serde(default)]
    grund: NullableField<String>,
    #[serde(default, alias = "route")]
    einnahmeform: NullableField<String>,
    #[serde(default, alias = "prescribed_on")]
    verordnet_am: NullableField<String>,
    #[serde(default, alias = "start_date")]
    einnahme_von: NullableField<String>,
    #[serde(default, alias = "end_date")]
    einnahme_bis: NullableField<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    on_hold: Option<bool>,
    #[serde(default)]
    hold_from: NullableField<String>,
    #[serde(default)]
    hold_until: NullableField<String>,
    #[serde(default)]
    hold_note: NullableField<String>,
    #[serde(default)]
    apothekenpflichtig: Option<bool>,
    #[serde(default)]
    rezeptpflichtig: Option<bool>,
    #[serde(default)]
    btm: Option<bool>,
    #[serde(default)]
    aut_idem_sperre: Option<bool>,
    #[serde(default)]
    abgabebeschraenkung: Option<bool>,
    #[serde(default)]
    sonstige_vermerke: NullableField<String>,
    #[serde(default, alias = "country_code")]
    source_country: Option<String>,
    #[serde(default, alias = "effective_date")]
    source_date: Option<String>,
    #[serde(default)]
    source_page: Option<i32>,
    #[serde(default, alias = "raw_text")]
    source_raw_text: Option<String>,
    #[serde(default, alias = "identifiers")]
    source_identifiers: Value,
    #[serde(default, alias = "field_confidence")]
    source_field_confidence: Value,
    #[serde(default)]
    drug_product_id: Option<Uuid>,
}

struct NormalizedImportedMedication {
    candidate_id: String,
    requested_series_id: Option<Uuid>,
    create_new_series: bool,
    wirkstoff: String,
    handelsname: String,
    category: String,
    staerke: Option<String>,
    form: Option<String>,
    dose_morgens: Option<String>,
    dose_mittags: Option<String>,
    dose_abends: Option<String>,
    dose_nachts: Option<String>,
    einheit: Option<String>,
    hinweis: Option<String>,
    grund: Option<String>,
    einnahmeform: Option<String>,
    verordnet_am: Option<String>,
    einnahme_von: Option<String>,
    einnahme_bis: Option<String>,
    status: String,
    on_hold: bool,
    hold_from: Option<String>,
    hold_until: Option<String>,
    hold_note: Option<String>,
    apothekenpflichtig: bool,
    rezeptpflichtig: bool,
    btm: bool,
    aut_idem_sperre: bool,
    abgabebeschraenkung: bool,
    sonstige_vermerke: Option<String>,
    source_country: Option<String>,
    source_date: Option<chrono::NaiveDate>,
    source_page: Option<i32>,
    source_raw_text: Option<String>,
    source_identifiers: Value,
    source_field_confidence: Value,
    drug_product_id: Option<Uuid>,
    identity_key: String,
    supplied_fields: HashSet<&'static str>,
    review_fingerprint: String,
    fingerprint: String,
}

#[derive(Default, Deserialize)]
struct MedicationHistoryQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

fn default_selected() -> bool {
    true
}

fn is_manual_candidate_id(value: &str) -> bool {
    value
        .strip_prefix("manual:")
        .and_then(|id| Uuid::parse_str(id).ok())
        .is_some()
}

fn imported_medication_text(
    value: Option<String>,
    field: &str,
    max_len: usize,
) -> Result<Option<String>, axum::response::Response> {
    let value = value.map(|value| value.trim().to_string());
    let value = value.filter(|value| !value.is_empty());
    if value.as_ref().is_some_and(|value| value.len() > max_len) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} is too long"),
        ));
    }
    Ok(value)
}

fn imported_medication_date(
    value: Option<String>,
    field: &str,
) -> Result<Option<String>, axum::response::Response> {
    let value = imported_medication_text(value, field, 10)?;
    match value {
        Some(value) => chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d")
            .map(|date| Some(date.to_string()))
            .map_err(|_| {
                err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    &format!("{field} must use YYYY-MM-DD"),
                )
            }),
        None => Ok(None),
    }
}

fn imported_source_country(
    value: Option<String>,
) -> Result<Option<String>, axum::response::Response> {
    let Some(country) = value else {
        return Ok(None);
    };
    if country != country.trim()
        || country.len() != 2
        || !country.bytes().all(|byte| byte.is_ascii_uppercase())
        || !is_iso_country_code(&country)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "source_country must be a canonical ISO-3166 alpha-2 country code",
        ));
    }
    Ok(Some(country))
}

fn imported_medication_json_object(
    value: Value,
    field: &str,
    max_bytes: usize,
) -> Result<Value, axum::response::Response> {
    let value = if value.is_null() { json!({}) } else { value };
    if !value.is_object() || serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() > max_bytes) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} must be a small JSON object"),
        ));
    }
    Ok(value)
}

fn confidence_object_is_valid(value: &Value) -> bool {
    value.as_object().is_some_and(|fields| {
        fields.values().all(|confidence| {
            confidence
                .as_f64()
                .is_some_and(|confidence| (0.0..=1.0).contains(&confidence))
        })
    })
}

fn normalize_medication_identity(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn medication_regimen_fingerprint(regimen: &Value) -> String {
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(
            serde_json::to_vec(regimen).expect("medication regimen JSON serializes")
        ))
    )
}

fn medication_snapshot_fingerprint(snapshot: &Value) -> Option<String> {
    let text = |key: &str| {
        snapshot
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let normalized = |key: &str| text(key).map(|value| normalize_medication_identity(&value));
    let regimen = json!({
        "wirkstoff": normalized("wirkstoff")?,
        "handelsname": normalized("handelsname").unwrap_or_default(),
        "category": text("category").unwrap_or_else(|| "dauer".to_string()),
        "staerke": normalized("staerke"),
        "form": normalized("form"),
        "dose_morgens": text("dose_morgens"),
        "dose_mittags": text("dose_mittags"),
        "dose_abends": text("dose_abends"),
        "dose_nachts": text("dose_nachts"),
        "einheit": normalized("einheit"),
        "hinweis": text("hinweis"),
        "grund": text("grund"),
        "einnahmeform": normalized("einnahmeform"),
        "verordnet_am": text("verordnet_am"),
        "einnahme_von": text("einnahme_von"),
        "einnahme_bis": text("einnahme_bis"),
        "status": text("status").unwrap_or_else(|| "aktiv".to_string()),
        "on_hold": snapshot.get("on_hold").and_then(Value::as_bool).unwrap_or(false),
        "hold_from": text("hold_from"),
        "hold_until": text("hold_until"),
        "hold_note": text("hold_note"),
        "apothekenpflichtig": snapshot.get("apothekenpflichtig").and_then(Value::as_bool).unwrap_or(false),
        "rezeptpflichtig": snapshot.get("rezeptpflichtig").and_then(Value::as_bool).unwrap_or(false),
        "btm": snapshot.get("btm").and_then(Value::as_bool).unwrap_or(false),
        "aut_idem_sperre": snapshot.get("aut_idem_sperre").and_then(Value::as_bool).unwrap_or(false),
        "abgabebeschraenkung": snapshot.get("abgabebeschraenkung").and_then(Value::as_bool).unwrap_or(false),
        "sonstige_vermerke": text("sonstige_vermerke"),
    });
    Some(medication_regimen_fingerprint(&regimen))
}

fn imported_medication_fingerprint(medication: &NormalizedImportedMedication) -> String {
    medication_regimen_fingerprint(&json!({
        "wirkstoff": medication.identity_key,
        "handelsname": normalize_medication_identity(&medication.handelsname),
        "category": medication.category,
        "staerke": medication.staerke.as_deref().map(normalize_medication_identity),
        "form": medication.form.as_deref().map(normalize_medication_identity),
        "dose_morgens": medication.dose_morgens,
        "dose_mittags": medication.dose_mittags,
        "dose_abends": medication.dose_abends,
        "dose_nachts": medication.dose_nachts,
        "einheit": medication.einheit.as_deref().map(normalize_medication_identity),
        "hinweis": medication.hinweis,
        "grund": medication.grund,
        "einnahmeform": medication.einnahmeform.as_deref().map(normalize_medication_identity),
        "verordnet_am": medication.verordnet_am,
        "einnahme_von": medication.einnahme_von,
        "einnahme_bis": medication.einnahme_bis,
        "status": medication.status,
        "on_hold": medication.on_hold,
        "hold_from": medication.hold_from,
        "hold_until": medication.hold_until,
        "hold_note": medication.hold_note,
        "apothekenpflichtig": medication.apothekenpflichtig,
        "rezeptpflichtig": medication.rezeptpflichtig,
        "btm": medication.btm,
        "aut_idem_sperre": medication.aut_idem_sperre,
        "abgabebeschraenkung": medication.abgabebeschraenkung,
        "sonstige_vermerke": medication.sonstige_vermerke,
    }))
}

fn snapshot_text(snapshot: &Value, field: &str) -> Option<String> {
    snapshot
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn medication_matches_strong_identity(
    medication: &NormalizedImportedMedication,
    snapshot: &Value,
    stored_identifiers: &Value,
) -> bool {
    let mut selector_count = 0usize;
    let mut matches = true;
    for (field, supplied, value) in [
        (
            "handelsname",
            medication.supplied_fields.contains("handelsname"),
            Some(medication.handelsname.as_str()).filter(|value| !value.is_empty()),
        ),
        (
            "staerke",
            medication.supplied_fields.contains("staerke"),
            medication.staerke.as_deref(),
        ),
        (
            "form",
            medication.supplied_fields.contains("form"),
            medication.form.as_deref(),
        ),
        (
            "einnahmeform",
            medication.supplied_fields.contains("einnahmeform"),
            medication.einnahmeform.as_deref(),
        ),
    ] {
        if supplied && let Some(value) = value {
            selector_count += 1;
            let actual = snapshot_text(snapshot, field)
                .as_deref()
                .map(normalize_medication_identity);
            let expected = normalize_medication_identity(value);
            matches &= actual.as_deref() == Some(expected.as_str());
        }
    }
    if let Some(identifiers) = medication.source_identifiers.as_object()
        && !identifiers.is_empty()
    {
        selector_count += 1;
        matches &= stored_identifiers.as_object().is_some_and(|stored| {
            identifiers
                .iter()
                .all(|(key, value)| stored.get(key) == Some(value))
        });
    }
    selector_count > 0 && matches
}

fn medication_has_strong_identity_selector(medication: &NormalizedImportedMedication) -> bool {
    (medication.supplied_fields.contains("handelsname") && !medication.handelsname.is_empty())
        || (medication.supplied_fields.contains("staerke") && medication.staerke.is_some())
        || (medication.supplied_fields.contains("form") && medication.form.is_some())
        || (medication.supplied_fields.contains("einnahmeform")
            && medication.einnahmeform.is_some())
        || medication
            .source_identifiers
            .as_object()
            .is_some_and(|identifiers| !identifiers.is_empty())
}

fn imported_non_lifecycle_regimen_changed(
    medication: &NormalizedImportedMedication,
    snapshot: &Value,
) -> bool {
    let differs_normalized = |field: &'static str, value: Option<&str>| {
        medication.supplied_fields.contains(field)
            && value.map(normalize_medication_identity)
                != snapshot_text(snapshot, field)
                    .as_deref()
                    .map(normalize_medication_identity)
    };
    let differs_exact = |field: &'static str, value: Option<&str>| {
        medication.supplied_fields.contains(field)
            && value.map(str::trim) != snapshot_text(snapshot, field).as_deref().map(str::trim)
    };
    let differs_bool = |field: &'static str, value: bool| {
        medication.supplied_fields.contains(field)
            && snapshot
                .get(field)
                .and_then(Value::as_bool)
                .unwrap_or(false)
                != value
    };
    differs_normalized("handelsname", Some(&medication.handelsname))
        || differs_exact("category", Some(&medication.category))
        || differs_normalized("staerke", medication.staerke.as_deref())
        || differs_normalized("form", medication.form.as_deref())
        || differs_exact("dose_morgens", medication.dose_morgens.as_deref())
        || differs_exact("dose_mittags", medication.dose_mittags.as_deref())
        || differs_exact("dose_abends", medication.dose_abends.as_deref())
        || differs_exact("dose_nachts", medication.dose_nachts.as_deref())
        || differs_normalized("einheit", medication.einheit.as_deref())
        || differs_exact("hinweis", medication.hinweis.as_deref())
        || differs_exact("grund", medication.grund.as_deref())
        || differs_normalized("einnahmeform", medication.einnahmeform.as_deref())
        || differs_exact("verordnet_am", medication.verordnet_am.as_deref())
        || differs_exact("einnahme_von", medication.einnahme_von.as_deref())
        || differs_bool("apothekenpflichtig", medication.apothekenpflichtig)
        || differs_bool("rezeptpflichtig", medication.rezeptpflichtig)
        || differs_bool("btm", medication.btm)
        || differs_bool("aut_idem_sperre", medication.aut_idem_sperre)
        || differs_bool("abgabebeschraenkung", medication.abgabebeschraenkung)
        || differs_exact("sonstige_vermerke", medication.sonstige_vermerke.as_deref())
}

fn inherit_unspecified_medication_fields(
    medication: &mut NormalizedImportedMedication,
    snapshot: &Value,
) {
    macro_rules! inherit_text {
        ($field:ident) => {
            if !medication.supplied_fields.contains(stringify!($field)) {
                medication.$field = snapshot_text(snapshot, stringify!($field));
            }
        };
    }
    if !medication.supplied_fields.contains("handelsname") {
        medication.handelsname = snapshot_text(snapshot, "handelsname").unwrap_or_default();
    }
    if !medication.supplied_fields.contains("category") {
        medication.category = snapshot_text(snapshot, "category").unwrap_or_else(|| "dauer".into());
    }
    inherit_text!(staerke);
    inherit_text!(form);
    inherit_text!(dose_morgens);
    inherit_text!(dose_mittags);
    inherit_text!(dose_abends);
    inherit_text!(dose_nachts);
    inherit_text!(einheit);
    inherit_text!(hinweis);
    inherit_text!(grund);
    inherit_text!(einnahmeform);
    inherit_text!(verordnet_am);
    inherit_text!(einnahme_von);
    inherit_text!(einnahme_bis);
    inherit_text!(hold_from);
    inherit_text!(hold_until);
    inherit_text!(hold_note);
    inherit_text!(sonstige_vermerke);
    if !medication.supplied_fields.contains("status") {
        medication.status = snapshot_text(snapshot, "status").unwrap_or_else(|| "aktiv".into());
    }
    if !medication.supplied_fields.contains("on_hold")
        && !medication.supplied_fields.contains("status")
    {
        medication.on_hold = snapshot
            .get("on_hold")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    }
    macro_rules! inherit_bool {
        ($field:ident) => {
            if !medication.supplied_fields.contains(stringify!($field)) {
                medication.$field = snapshot
                    .get(stringify!($field))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
            }
        };
    }
    inherit_bool!(apothekenpflichtig);
    inherit_bool!(rezeptpflichtig);
    inherit_bool!(btm);
    inherit_bool!(aut_idem_sperre);
    inherit_bool!(abgabebeschraenkung);
    medication.fingerprint = imported_medication_fingerprint(medication);
}

fn normalize_imported_medication(
    body: ImportedMedicationRequest,
) -> Result<NormalizedImportedMedication, axum::response::Response> {
    let candidate_id = body.candidate_id.trim().to_string();
    if candidate_id.is_empty() || candidate_id.len() > 128 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid candidate_id",
        ));
    }
    if body.medication_series_id.is_some() && body.create_new_series {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "medication_series_id and create_new_series are mutually exclusive",
        ));
    }
    let mut supplied_fields = HashSet::new();
    macro_rules! supplied_option {
        ($($field:ident),+ $(,)?) => {
            $(if body.$field.is_some() {
                supplied_fields.insert(stringify!($field));
            })+
        };
    }
    macro_rules! supplied_nullable {
        ($($field:ident),+ $(,)?) => {
            $(if body.$field.is_supplied() {
                supplied_fields.insert(stringify!($field));
            })+
        };
    }
    supplied_nullable!(
        handelsname,
        staerke,
        form,
        dose_morgens,
        dose_mittags,
        dose_abends,
        dose_nachts,
        einheit,
        hinweis,
        grund,
        einnahmeform,
        verordnet_am,
        einnahme_von,
        einnahme_bis,
        hold_from,
        hold_until,
        hold_note,
        sonstige_vermerke,
    );
    supplied_option!(
        category,
        status,
        on_hold,
        apothekenpflichtig,
        rezeptpflichtig,
        btm,
        aut_idem_sperre,
        abgabebeschraenkung,
    );
    let wirkstoff =
        imported_medication_text(body.wirkstoff, "wirkstoff", 300)?.ok_or_else(|| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "wirkstoff must be reviewed before a medication can be imported",
            )
        })?;
    let handelsname = imported_medication_text(body.handelsname.into_option(), "handelsname", 300)?
        .unwrap_or_default();
    let category = imported_medication_text(body.category, "category", 32)?
        .unwrap_or_else(|| "dauer".to_string());
    if !matches!(category.as_str(), "dauer" | "besondere" | "selbst") {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid category"));
    }
    let raw_status = imported_medication_text(body.status, "status", 32)?
        .unwrap_or_else(|| "aktiv".to_string())
        .to_lowercase();
    let status = match raw_status.as_str() {
        "aktiv" | "active" => "aktiv",
        "pausiert" | "paused" | "held" | "on_hold" => "pausiert",
        "abgesetzt" | "stopped" | "discontinued" => "abgesetzt",
        "geplant" | "planned" => "geplant",
        _ => return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status")),
    }
    .to_string();
    let on_hold = body.on_hold.unwrap_or(false) || status == "pausiert";
    let status = if on_hold {
        "pausiert".to_string()
    } else {
        status
    };
    let verordnet_am = imported_medication_date(body.verordnet_am.into_option(), "verordnet_am")?;
    let einnahme_von = imported_medication_date(body.einnahme_von.into_option(), "einnahme_von")?;
    let einnahme_bis = imported_medication_date(body.einnahme_bis.into_option(), "einnahme_bis")?;
    let hold_from = imported_medication_date(body.hold_from.into_option(), "hold_from")?;
    let hold_until = imported_medication_date(body.hold_until.into_option(), "hold_until")?;
    let source_date = imported_medication_date(body.source_date, "source_date")?.map(|value| {
        chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d").expect("source_date was validated")
    });
    if matches!((&einnahme_von, &einnahme_bis), (Some(from), Some(until)) if until < from) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "einnahme_bis must be on or after einnahme_von",
        ));
    }
    if matches!((&hold_from, &hold_until), (Some(from), Some(until)) if until < from) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "hold_until must be on or after hold_from",
        ));
    }
    let source_country = imported_source_country(body.source_country)?;
    if body.source_page.is_some_and(|page| page <= 0) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "source_page must be positive",
        ));
    }
    let source_identifiers =
        imported_medication_json_object(body.source_identifiers, "source_identifiers", 8_192)?;
    let source_field_confidence = imported_medication_json_object(
        body.source_field_confidence,
        "source_field_confidence",
        16_384,
    )?;
    if !confidence_object_is_valid(&source_field_confidence) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "source_field_confidence values must be numbers between 0 and 1",
        ));
    }

    let staerke = imported_medication_text(body.staerke.into_option(), "staerke", 160)?;
    let form = imported_medication_text(body.form.into_option(), "form", 120)?;
    let dose_morgens =
        imported_medication_text(body.dose_morgens.into_option(), "dose_morgens", 80)?;
    let dose_mittags =
        imported_medication_text(body.dose_mittags.into_option(), "dose_mittags", 80)?;
    let dose_abends = imported_medication_text(body.dose_abends.into_option(), "dose_abends", 80)?;
    let dose_nachts = imported_medication_text(body.dose_nachts.into_option(), "dose_nachts", 80)?;
    let einheit = imported_medication_text(body.einheit.into_option(), "einheit", 80)?;
    let hinweis = imported_medication_text(body.hinweis.into_option(), "hinweis", 2_000)?;
    let grund = imported_medication_text(body.grund.into_option(), "grund", 1_000)?;
    let einnahmeform =
        imported_medication_text(body.einnahmeform.into_option(), "einnahmeform", 120)?;
    let hold_note = imported_medication_text(body.hold_note.into_option(), "hold_note", 1_000)?;
    let sonstige_vermerke = imported_medication_text(
        body.sonstige_vermerke.into_option(),
        "sonstige_vermerke",
        2_000,
    )?;
    let source_raw_text =
        imported_medication_text(body.source_raw_text, "source_raw_text", 20_000)?;
    let identity_key = normalize_medication_identity(&wirkstoff);
    let mut medication = NormalizedImportedMedication {
        candidate_id,
        requested_series_id: body.medication_series_id,
        create_new_series: body.create_new_series,
        wirkstoff,
        handelsname,
        category,
        staerke,
        form,
        dose_morgens,
        dose_mittags,
        dose_abends,
        dose_nachts,
        einheit,
        hinweis,
        grund,
        einnahmeform,
        verordnet_am,
        einnahme_von,
        einnahme_bis,
        status,
        on_hold,
        hold_from,
        hold_until,
        hold_note,
        apothekenpflichtig: body.apothekenpflichtig.unwrap_or(false),
        rezeptpflichtig: body.rezeptpflichtig.unwrap_or(false),
        btm: body.btm.unwrap_or(false),
        aut_idem_sperre: body.aut_idem_sperre.unwrap_or(false),
        abgabebeschraenkung: body.abgabebeschraenkung.unwrap_or(false),
        sonstige_vermerke,
        source_country,
        source_date,
        source_page: body.source_page,
        source_raw_text,
        source_identifiers,
        source_field_confidence,
        drug_product_id: body.drug_product_id,
        identity_key,
        supplied_fields,
        review_fingerprint: String::new(),
        fingerprint: String::new(),
    };
    medication.fingerprint = imported_medication_fingerprint(&medication);
    let mut supplied_fields = medication
        .supplied_fields
        .iter()
        .copied()
        .collect::<Vec<_>>();
    supplied_fields.sort_unstable();
    medication.review_fingerprint = medication_regimen_fingerprint(&json!({
        "regimen_fingerprint": medication.fingerprint,
        "supplied_fields": supplied_fields,
        "medication_series_id": medication.requested_series_id,
        "create_new_series": medication.create_new_series,
        "source_country": medication.source_country,
        "source_date": medication.source_date,
        "source_page": medication.source_page,
        "source_raw_text": medication.source_raw_text,
        "source_identifiers": medication.source_identifiers,
        "source_field_confidence": medication.source_field_confidence,
        "drug_product_id": medication.drug_product_id,
    }));
    Ok(medication)
}

async fn ensure_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    auth.require_any_role(IMPORT_ROLES)?;
    if auth.role.has_full_access() || !access::requires_patient_assignment(auth.role) {
        return Ok(());
    }
    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "validate clinical document import access");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

async fn medication_section_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(
               jsonb_agg(
                   (to_jsonb(m) - 'patient_id' - 'source_raw_text'
                                - 'source_identifiers' - 'source_field_confidence')
                   ORDER BY m.sort_order, m.created_at
               ),
               '[]'::jsonb
           )
           FROM patient_medications m
           WHERE m.patient_id = $1 AND m.superseded_at IS NULL"#,
    )
    .bind(patient_id)
    .fetch_one(&mut **tx)
    .await
}

async fn attach_country_aware_drug_candidates(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    medication_id: Uuid,
    medication: &NormalizedImportedMedication,
    user_id: Uuid,
) -> Result<i64, sqlx::Error> {
    let Some(country) = medication.source_country.as_deref() else {
        return Ok(0);
    };
    let atc_code = medication
        .source_identifiers
        .get("atc_code")
        .or_else(|| medication.source_identifiers.get("atc"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(product_id) = medication.drug_product_id {
        sqlx::query(
            r#"INSERT INTO medication_drug_matches (
                    patient_medication_id, drug_product_id, match_kind, confidence,
                    verification_status, note, created_by
               )
               SELECT $1, p.id, 'staff_candidate', 0.70, 'candidate',
                      'Reviewed OCR product candidate; staff verification is still required.', $4
               FROM drug_products p
               WHERE p.id = $2 AND p.country_code = $3 AND p.is_active = true
               ON CONFLICT (patient_medication_id, drug_product_id)
                   WHERE patient_medication_id IS NOT NULL
               DO NOTHING"#,
        )
        .bind(medication_id)
        .bind(product_id)
        .bind(country)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query(
        r#"INSERT INTO medication_drug_matches (
                patient_medication_id, drug_product_id, match_kind, confidence,
                verification_status, note, created_by
           )
           SELECT $1, p.id, 'auto_candidate', 0.65, 'candidate',
                  'Country-scoped OCR candidate; no substitution or verification was performed.', $6
           FROM drug_products p
           WHERE p.country_code = $2
             AND p.is_active = true
             AND (
                    (NULLIF($3, '') IS NOT NULL AND p.normalized_brand_name = $3)
                 OR (NULLIF($4, '') IS NOT NULL AND lower(COALESCE(p.atc_code, '')) = lower($4))
                 OR EXISTS (
                        SELECT 1
                        FROM drug_product_substances dps
                        JOIN drug_substances ds ON ds.id = dps.substance_id
                        WHERE dps.product_id = p.id AND ds.normalized_name = $5
                    )
             )
           ON CONFLICT (patient_medication_id, drug_product_id)
               WHERE patient_medication_id IS NOT NULL
           DO NOTHING"#,
    )
    .bind(medication_id)
    .bind(country)
    .bind(normalize_medication_identity(&medication.handelsname))
    .bind(atc_code.unwrap_or_default())
    .bind(&medication.identity_key)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;

    sqlx::query_scalar(
        r#"SELECT count(*)
           FROM medication_drug_matches
           WHERE patient_medication_id = $1 AND verification_status = 'candidate'"#,
    )
    .bind(medication_id)
    .fetch_one(&mut **tx)
    .await
}

async fn persist_imported_medication(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
    Json(raw_body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    let body = match serde_json::from_value::<ImportedMedicationRequest>(raw_body.clone()) {
        Ok(body) => body,
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid imported medication payload",
            );
        }
    };
    let mut medication = match normalize_imported_medication(body) {
        Ok(medication) => medication,
        Err(response) => return response,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "begin medication import persistence");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to persist imported medication",
            );
        }
    };
    let import_row = match sqlx::query(
        r#"SELECT document_id, reviewed_draft, status, prepared_source_country,
                  prepared_candidate_payloads, prepared_identity_gate_version
           FROM clinical_document_imports
           WHERE id = $1 AND patient_id = $2 AND status IN ('applying', 'applied')
             AND deleted_at IS NULL
           FOR UPDATE"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(
                StatusCode::CONFLICT,
                "Clinical import must be prepared before medication persistence",
            );
        }
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "lock medication import");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to persist imported medication",
            );
        }
    };
    if import_row.get::<i16, _>("prepared_identity_gate_version") < 1 {
        return err(
            StatusCode::CONFLICT,
            "Clinical import identity gate must be completed before medication persistence",
        );
    }
    let document_id = import_row.get::<Uuid, _>("document_id");
    let import_status = import_row.get::<String, _>("status");
    let reviewed_draft = import_row
        .get::<Option<Value>, _>("reviewed_draft")
        .unwrap_or_else(|| json!({}));
    let candidate_is_prepared_and_selected = reviewed_draft
        .get("candidates")
        .and_then(Value::as_array)
        .is_some_and(|candidates| {
            candidates.iter().any(|candidate| {
                candidate.get("id").and_then(Value::as_str)
                    == Some(medication.candidate_id.as_str())
                    && candidate.get("target").and_then(Value::as_str) == Some("medication")
                    && candidate.get("selected").and_then(Value::as_bool) == Some(true)
            })
        });
    if !candidate_is_prepared_and_selected {
        return err(
            StatusCode::CONFLICT,
            "Medication candidate is not selected in the prepared review",
        );
    }
    if import_row
        .get::<Option<String>, _>("prepared_source_country")
        .as_deref()
        != medication.source_country.as_deref()
    {
        return err(
            StatusCode::CONFLICT,
            "Medication source_country differs from the prepared import country",
        );
    }
    let frozen_payload = import_row
        .get::<Value, _>("prepared_candidate_payloads")
        .get(&medication.candidate_id)
        .cloned();
    if frozen_payload.as_ref() != Some(&raw_body) {
        return err(
            StatusCode::CONFLICT,
            "Medication payload differs from the immutable prepared candidate payload",
        );
    }
    let frozen_medication = frozen_payload
        .clone()
        .and_then(|payload| serde_json::from_value::<ImportedMedicationRequest>(payload).ok())
        .and_then(|payload| normalize_imported_medication(payload).ok());
    if frozen_medication
        .as_ref()
        .map(|frozen| frozen.review_fingerprint.as_str())
        != Some(medication.review_fingerprint.as_str())
    {
        return err(
            StatusCode::CONFLICT,
            "Medication payload differs from the immutable prepared candidate payload",
        );
    }
    let prior_event = match sqlx::query(
        r#"SELECT patient_medication_id, medication_series_id, event_type,
                  regimen_fingerprint, review_fingerprint
           FROM patient_medication_import_history
           WHERE source_import_id = $1 AND source_candidate_id = $2"#,
    )
    .bind(import_id)
    .bind(&medication.candidate_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "load prior medication import event");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to persist imported medication",
            );
        }
    };
    if let Some(row) = prior_event {
        let persisted_regimen_fingerprint = row.get::<String, _>("regimen_fingerprint");
        let persisted_review_fingerprint = row.get::<String, _>("review_fingerprint");
        if persisted_review_fingerprint != medication.review_fingerprint {
            return err(
                StatusCode::CONFLICT,
                "This import candidate was already persisted with different reviewed fields",
            );
        }
        let medication_id = row.get::<Option<Uuid>, _>("patient_medication_id");
        let Some(medication_id) = medication_id else {
            return err(
                StatusCode::CONFLICT,
                "The medication previously linked to this import is no longer available",
            );
        };
        let medication_still_exists = match sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM patient_medications WHERE id = $1 AND patient_id = $2)",
        )
        .bind(medication_id)
        .bind(patient_id)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(exists) => exists,
            Err(error) => {
                tracing::error!(error = %error, medication_id = %medication_id, "validate idempotent medication import retry");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to persist imported medication",
                );
            }
        };
        if !medication_still_exists {
            return err(
                StatusCode::CONFLICT,
                "The medication previously linked to this import is no longer available",
            );
        }
        let match_candidate_count = sqlx::query_scalar::<_, i64>(
            r#"SELECT count(*) FROM medication_drug_matches
               WHERE patient_medication_id = $1 AND verification_status = 'candidate'"#,
        )
        .bind(medication_id)
        .fetch_one(&mut *tx)
        .await
        .unwrap_or(0);
        return Json(json!({
            "ok": true,
            "id": medication_id,
            "medication_series_id": row.get::<Uuid, _>("medication_series_id"),
            "action": row.get::<String, _>("event_type"),
            "idempotent": true,
            "regimen_fingerprint": persisted_regimen_fingerprint,
            "source_date": medication.source_date,
            "match_candidate_count": match_candidate_count,
        }))
        .into_response();
    }
    if import_status == "applied" {
        return err(
            StatusCode::CONFLICT,
            "Applied imports accept only idempotent medication retries",
        );
    }
    if let Some(product_id) = medication.drug_product_id {
        let Some(country) = medication.source_country.as_deref() else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "source_country is required when linking a drug product candidate",
            );
        };
        match sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1 FROM drug_products
                   WHERE id = $1 AND country_code = $2 AND is_active = true
               )"#,
        )
        .bind(product_id)
        .bind(country)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Drug product candidate does not match source_country",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, product_id = %product_id, "validate OCR drug product candidate");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to persist imported medication",
                );
            }
        }
    }

    if let Err(error) = sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("{patient_id}:{}", medication.identity_key))
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, patient_id = %patient_id, "lock medication identity");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist imported medication",
        );
    }

    let old_section = match medication_section_snapshot(&mut tx, patient_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "snapshot medications before OCR import");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to persist imported medication",
            );
        }
    };
    let mut identity_rows = match sqlx::query(
        r#"SELECT id, medication_series_id, source_identifiers,
                  (to_jsonb(pm) - 'source_raw_text' - 'source_identifiers'
                                - 'source_field_confidence') AS snapshot
           FROM patient_medications pm
           WHERE patient_id = $1 AND superseded_at IS NULL
             AND NOT $4
             AND (
                 ($2::uuid IS NOT NULL AND medication_series_id = $2)
                 OR ($2::uuid IS NULL
                     AND lower(regexp_replace(btrim(wirkstoff), '\s+', ' ', 'g')) = $3)
             )
           ORDER BY created_at DESC
           FOR UPDATE"#,
    )
    .bind(patient_id)
    .bind(medication.requested_series_id)
    .bind(&medication.identity_key)
    .bind(medication.create_new_series)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "find medication series identity");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to persist imported medication",
            );
        }
    };
    let identity_match = if medication.requested_series_id.is_some() {
        let Some(row) = identity_rows.pop() else {
            return err(
                StatusCode::CONFLICT,
                "medication_series_id is not a current series for this patient",
            );
        };
        if medication_snapshot_fingerprint(&row.get::<Value, _>("snapshot")).is_none()
            || snapshot_text(&row.get::<Value, _>("snapshot"), "wirkstoff")
                .as_deref()
                .map(normalize_medication_identity)
                .as_deref()
                != Some(medication.identity_key.as_str())
        {
            return err(
                StatusCode::CONFLICT,
                "medication_series_id does not match the reviewed Wirkstoff",
            );
        }
        Some(row)
    } else if identity_rows.is_empty() {
        None
    } else if identity_rows.len() == 1 {
        let row = identity_rows.pop().expect("single identity row checked");
        if medication_has_strong_identity_selector(&medication)
            && !medication_matches_strong_identity(
                &medication,
                &row.get::<Value, _>("snapshot"),
                &row.get::<Value, _>("source_identifiers"),
            )
        {
            return err(
                StatusCode::CONFLICT,
                "Medication identity selectors do not match the current series; medication_series_id or create_new_series review is required",
            );
        }
        Some(row)
    } else {
        let matching_indexes = identity_rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| {
                medication_matches_strong_identity(
                    &medication,
                    &row.get::<Value, _>("snapshot"),
                    &row.get::<Value, _>("source_identifiers"),
                )
                .then_some(index)
            })
            .collect::<Vec<_>>();
        if matching_indexes.len() != 1 {
            return err(
                StatusCode::CONFLICT,
                "Multiple medication series match Wirkstoff; medication_series_id review is required",
            );
        }
        Some(identity_rows.swap_remove(matching_indexes[0]))
    };
    let non_lifecycle_regimen_changed = identity_match.as_ref().is_some_and(|row| {
        imported_non_lifecycle_regimen_changed(&medication, &row.get::<Value, _>("snapshot"))
    });
    if let Some(row) = identity_match.as_ref() {
        inherit_unspecified_medication_fields(&mut medication, &row.get::<Value, _>("snapshot"));
    }
    let identity_is_duplicate = identity_match.as_ref().is_some_and(|row| {
        medication_snapshot_fingerprint(&row.get::<Value, _>("snapshot")).as_deref()
            == Some(medication.fingerprint.as_str())
    });

    let historical_observation = identity_match.as_ref().is_some_and(|row| {
        let snapshot = row.get::<Value, _>("snapshot");
        let current_source_date = snapshot_text(&snapshot, "source_date")
            .and_then(|date| chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok());
        !identity_is_duplicate
            && matches!((current_source_date, medication.source_date), (Some(current), Some(incoming)) if incoming < current)
    });
    if identity_match.is_some() && !identity_is_duplicate && !historical_observation {
        let current_source_date = identity_match
            .as_ref()
            .and_then(|row| snapshot_text(&row.get::<Value, _>("snapshot"), "source_date"))
            .and_then(|date| chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok());
        if current_source_date.is_some() && medication.source_date.is_none() {
            return err(
                StatusCode::CONFLICT,
                "source_date is required to change a dated current medication series",
            );
        }
    }

    let is_status_transition =
        medication.on_hold || matches!(medication.status.as_str(), "pausiert" | "abgesetzt");
    let (
        medication_id,
        prior_medication_id,
        medication_series_id,
        event_type,
        old_value,
        new_value,
    ) = if identity_is_duplicate {
        let prior = identity_match.as_ref().expect("duplicate identity checked");
        let id = prior.get::<Uuid, _>("id");
        let series_id = prior.get::<Uuid, _>("medication_series_id");
        let old_snapshot = prior.get::<Value, _>("snapshot");
        let updated = match sqlx::query(
            r#"UPDATE patient_medications
               SET regimen_fingerprint = $2,
                   source_date = CASE
                       WHEN $3::date IS NULL THEN source_date
                       WHEN source_date IS NULL OR source_date < $3 THEN $3
                       ELSE source_date
                   END
               WHERE id = $1
               RETURNING (to_jsonb(patient_medications) - 'source_raw_text'
                                                        - 'source_identifiers'
                                                        - 'source_field_confidence') AS snapshot"#,
        )
        .bind(id)
        .bind(&medication.fingerprint)
        .bind(medication.source_date)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(row) => row,
            Err(error) => {
                tracing::error!(error = %error, medication_id = %id, "backfill medication regimen fingerprint");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to persist imported medication",
                );
            }
        };
        (
            id,
            None,
            series_id,
            "deduplicated",
            Some(old_snapshot),
            updated.get::<Value, _>("snapshot"),
        )
    } else if !historical_observation
        && is_status_transition
        && !non_lifecycle_regimen_changed
        && identity_match.is_some()
    {
        let prior = identity_match.expect("identity match checked");
        let id = prior.get::<Uuid, _>("id");
        let series_id = prior.get::<Uuid, _>("medication_series_id");
        let old_value = prior.get::<Value, _>("snapshot");
        let row = match sqlx::query(
            r#"UPDATE patient_medications
                   SET status = $3, on_hold = $4,
                       hold_from = CASE WHEN $5 THEN $6 ELSE hold_from END,
                       hold_until = CASE WHEN $7 THEN $8 ELSE hold_until END,
                       hold_note = CASE WHEN $9 THEN $10 ELSE hold_note END,
                       einnahme_bis = CASE WHEN $11 THEN $12 ELSE einnahme_bis END,
                       regimen_fingerprint = $13,
                       source_date = COALESCE($14, source_date)
                   WHERE id = $1 AND patient_id = $2 AND superseded_at IS NULL
                   RETURNING (to_jsonb(patient_medications) - 'source_raw_text'
                                                            - 'source_identifiers'
                                                            - 'source_field_confidence') AS snapshot"#,
        )
        .bind(id)
        .bind(patient_id)
        .bind(&medication.status)
        .bind(medication.on_hold)
        .bind(medication.supplied_fields.contains("hold_from"))
        .bind(&medication.hold_from)
        .bind(medication.supplied_fields.contains("hold_until"))
        .bind(&medication.hold_until)
        .bind(medication.supplied_fields.contains("hold_note"))
        .bind(&medication.hold_note)
        .bind(medication.supplied_fields.contains("einnahme_bis"))
        .bind(&medication.einnahme_bis)
        .bind(&medication.fingerprint)
        .bind(medication.source_date)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(row) => row,
            Err(error) => {
                tracing::error!(error = %error, medication_id = %id, "apply medication status transition");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to persist imported medication",
                );
            }
        };
        (
            id,
            Some(id),
            series_id,
            "status_transition",
            Some(old_value),
            row.get::<Value, _>("snapshot"),
        )
    } else {
        let prior_id = identity_match.as_ref().map(|row| row.get::<Uuid, _>("id"));
        let prior_series = identity_match
            .as_ref()
            .map(|row| row.get::<Uuid, _>("medication_series_id"));
        let old_value = identity_match
            .as_ref()
            .map(|row| row.get::<Value, _>("snapshot"));
        let series_id = prior_series.unwrap_or_else(Uuid::new_v4);
        if !historical_observation
            && let Some(prior_id) = prior_id
                && let Err(error) = sqlx::query(
                    "UPDATE patient_medications SET superseded_at = now() WHERE id = $1 AND superseded_at IS NULL",
                )
                .bind(prior_id)
                .execute(&mut *tx)
                .await
            {
                tracing::error!(error = %error, medication_id = %prior_id, "supersede medication regimen");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to persist imported medication",
                );
            }
        let row = match sqlx::query(
                r#"INSERT INTO patient_medications (
                        patient_id, category, wirkstoff, handelsname, staerke, form,
                        dose_morgens, dose_mittags, dose_abends, dose_nachts, einheit,
                        hinweis, grund, einnahmeform, verordnet_am, einnahme_von,
                        einnahme_bis, status, apothekenpflichtig, rezeptpflichtig, btm,
                        aut_idem_sperre, abgabebeschraenkung, sonstige_vermerke,
                        on_hold, hold_from, hold_until, hold_note, sort_order,
                        source_document_id, source_import_id, source_candidate_id,
                        medication_series_id, supersedes_medication_id,
                        regimen_fingerprint, source_country, source_date, source_page, source_raw_text,
                        source_identifiers, source_field_confidence, superseded_at
                   ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                        $22, $23, $24, $25, $26, $27, $28,
                        COALESCE((SELECT max(sort_order) + 1 FROM patient_medications WHERE patient_id = $1), 0),
                        $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41
                   )
                   RETURNING id,
                       (to_jsonb(patient_medications) - 'source_raw_text'
                                                        - 'source_identifiers'
                                                        - 'source_field_confidence') AS snapshot"#,
            )
            .bind(patient_id)
            .bind(&medication.category)
            .bind(&medication.wirkstoff)
            .bind(&medication.handelsname)
            .bind(&medication.staerke)
            .bind(&medication.form)
            .bind(&medication.dose_morgens)
            .bind(&medication.dose_mittags)
            .bind(&medication.dose_abends)
            .bind(&medication.dose_nachts)
            .bind(&medication.einheit)
            .bind(&medication.hinweis)
            .bind(&medication.grund)
            .bind(&medication.einnahmeform)
            .bind(&medication.verordnet_am)
            .bind(&medication.einnahme_von)
            .bind(&medication.einnahme_bis)
            .bind(&medication.status)
            .bind(medication.apothekenpflichtig)
            .bind(medication.rezeptpflichtig)
            .bind(medication.btm)
            .bind(medication.aut_idem_sperre)
            .bind(medication.abgabebeschraenkung)
            .bind(&medication.sonstige_vermerke)
            .bind(medication.on_hold)
            .bind(&medication.hold_from)
            .bind(&medication.hold_until)
            .bind(&medication.hold_note)
            .bind(document_id)
            .bind(import_id)
            .bind(&medication.candidate_id)
            .bind(series_id)
            .bind((!historical_observation).then_some(prior_id).flatten())
            .bind(&medication.fingerprint)
            .bind(&medication.source_country)
            .bind(medication.source_date)
            .bind(medication.source_page)
            .bind(&medication.source_raw_text)
            .bind(&medication.source_identifiers)
            .bind(&medication.source_field_confidence)
            .bind(historical_observation.then(chrono::Utc::now))
            .fetch_one(&mut *tx)
            .await
            {
                Ok(row) => row,
                Err(error) => {
                    tracing::error!(error = %error, patient_id = %patient_id, "insert imported medication regimen");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to persist imported medication",
                    );
                }
            };
        (
            row.get::<Uuid, _>("id"),
            prior_id,
            series_id,
            if historical_observation {
                "historical_observation"
            } else if prior_id.is_some() {
                "regimen_changed"
            } else {
                "created"
            },
            old_value,
            row.get::<Value, _>("snapshot"),
        )
    };

    if let Err(error) = sqlx::query(
        r#"INSERT INTO patient_medication_import_history (
                patient_id, patient_medication_id, prior_medication_id, event_type,
                medication_series_id, regimen_fingerprint, review_fingerprint, source_document_id, source_import_id,
                source_candidate_id, source_country, source_date, source_page, source_raw_text,
                source_identifiers, source_field_confidence, old_value, new_value, reviewed_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)"#,
    )
    .bind(patient_id)
    .bind(medication_id)
    .bind(prior_medication_id)
    .bind(event_type)
    .bind(medication_series_id)
    .bind(&medication.fingerprint)
    .bind(&medication.review_fingerprint)
    .bind(document_id)
    .bind(import_id)
    .bind(&medication.candidate_id)
    .bind(&medication.source_country)
    .bind(medication.source_date)
    .bind(medication.source_page)
    .bind(&medication.source_raw_text)
    .bind(&medication.source_identifiers)
    .bind(&medication.source_field_confidence)
    .bind(old_value)
    .bind(new_value)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, import_id = %import_id, "record medication import history");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist imported medication",
        );
    }

    let match_candidate_count = match attach_country_aware_drug_candidates(
        &mut tx,
        medication_id,
        &medication,
        auth.user_id,
    )
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!(error = %error, medication_id = %medication_id, "attach OCR drug candidates");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to persist imported medication",
            );
        }
    };

    let new_section = match medication_section_snapshot(&mut tx, patient_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "snapshot medications after OCR import");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to persist imported medication",
            );
        }
    };
    if old_section != new_section
        && let Err(error) = sqlx::query(
            r#"INSERT INTO patient_clinical_versions
                   (patient_id, changed_by, section, old_value, new_value)
               VALUES ($1, $2, 'medications', $3, $4)"#,
        )
        .bind(patient_id)
        .bind(auth.user_id)
        .bind(old_section)
        .bind(new_section)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, patient_id = %patient_id, "version imported medication");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist imported medication",
        );
    }
    if let Err(error) = sqlx::query(
        r#"UPDATE patients
           SET last_clinical_update_at = now(),
               clinical_retention_until = GREATEST(
                   COALESCE(clinical_retention_until, now()),
                   now() + interval '30 years'
               )
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, patient_id = %patient_id, "retain imported medication history");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist imported medication",
        );
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, import_id = %import_id, "commit imported medication");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist imported medication",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "clinical_document_medication_persisted",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "medication_id": medication_id,
            "import_id": import_id,
            "candidate_id": medication.candidate_id,
            "action": event_type,
            "source_country": medication.source_country,
            "source_date": medication.source_date,
            "match_candidate_count": match_candidate_count,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_id,
        json!({ "section": "medications", "action": event_type, "medication_id": medication_id }),
    )
    .await;

    Json(json!({
        "ok": true,
        "id": medication_id,
        "action": event_type,
        "idempotent": false,
        "supersedes_medication_id": prior_medication_id,
        "medication_series_id": medication_series_id,
        "regimen_fingerprint": medication.fingerprint,
        "source_date": medication.source_date,
        "match_candidate_count": match_candidate_count,
    }))
    .into_response()
}

async fn list_medication_import_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<MedicationHistoryQuery>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    let limit = query.limit.unwrap_or(100);
    let offset = query.offset.unwrap_or(0);
    if !(1..=200).contains(&limit) || offset < 0 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Medication history limit must be 1..200 and offset must be non-negative",
        );
    }
    let total = match sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM patient_medication_import_history WHERE patient_id = $1",
    )
    .bind(patient_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(total) => total,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "count medication import history");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication import history",
            );
        }
    };
    match sqlx::query(
        r#"SELECT h.id, h.patient_medication_id, h.prior_medication_id,
                  h.medication_series_id, h.event_type,
                  h.regimen_fingerprint, h.source_document_id, h.source_import_id,
                  h.source_candidate_id, h.source_country, h.source_date, h.source_page,
                  h.source_raw_text, h.source_identifiers, h.source_field_confidence,
                  h.old_value, h.new_value, h.reviewed_by, h.created_at,
                  d.original_filename AS source_document_name,
                  u.name AS reviewed_by_name
           FROM patient_medication_import_history h
           LEFT JOIN documents d ON d.id = h.source_document_id
           LEFT JOIN users u ON u.id = h.reviewed_by
           WHERE h.patient_id = $1
           ORDER BY h.source_date DESC NULLS LAST, h.created_at DESC
           LIMIT $2 OFFSET $3"#,
    )
    .bind(patient_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(json!({
            "items": rows.iter().map(|row| json!({
                "id": row.get::<Uuid, _>("id"),
                "patient_medication_id": row.get::<Option<Uuid>, _>("patient_medication_id"),
                "prior_medication_id": row.get::<Option<Uuid>, _>("prior_medication_id"),
                "medication_series_id": row.get::<Uuid, _>("medication_series_id"),
                "event_type": row.get::<String, _>("event_type"),
                "regimen_fingerprint": row.get::<String, _>("regimen_fingerprint"),
                "source_document_id": row.get::<Option<Uuid>, _>("source_document_id"),
                "source_document_name": row.get::<Option<String>, _>("source_document_name"),
                "source_import_id": row.get::<Uuid, _>("source_import_id"),
                "source_candidate_id": row.get::<String, _>("source_candidate_id"),
                "source_country": row.get::<Option<String>, _>("source_country"),
                "source_date": row.get::<Option<chrono::NaiveDate>, _>("source_date"),
                "source_page": row.get::<Option<i32>, _>("source_page"),
                "source_raw_text": row.get::<Option<String>, _>("source_raw_text"),
                "source_identifiers": row.get::<Value, _>("source_identifiers"),
                "source_field_confidence": row.get::<Value, _>("source_field_confidence"),
                "old_value": row.get::<Option<Value>, _>("old_value"),
                "new_value": row.get::<Value, _>("new_value"),
                "reviewed_by": row.get::<Option<Uuid>, _>("reviewed_by"),
                "reviewed_by_name": row.get::<Option<String>, _>("reviewed_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            })).collect::<Vec<_>>(),
            "total": total,
            "limit": limit,
            "offset": offset,
        }))
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "list medication import history");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication import history",
            )
        }
    }
}

async fn create_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<CreateImportRequest>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }

    let document = match sqlx::query(
        r#"SELECT id, patient_id, is_medical, storage_key, mime_type,
                  original_filename, auto_name
           FROM documents
           WHERE id = $1 AND file_deleted_at IS NULL"#,
    )
    .bind(body.document_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(error) => {
            tracing::error!(error = %error, document_id = %body.document_id, "load import source document");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load document");
        }
    };
    let document_patient_id: Option<Uuid> = document.try_get("patient_id").unwrap_or_default();
    if document_patient_id != Some(patient_id) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document does not belong to this patient",
        );
    }
    if !document.try_get::<bool, _>("is_medical").unwrap_or(false) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Clinical import requires a medical document",
        );
    }
    let Some(storage_key) = document
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default()
    else {
        return err(StatusCode::CONFLICT, "Document file is unavailable");
    };
    let mime_type = document
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default();
    let original_filename = document
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default();
    let auto_name = document
        .try_get::<Option<String>, _>("auto_name")
        .unwrap_or_default();
    let data = match read_document_storage_bytes(
        body.document_id,
        storage_key.as_str(),
        mime_type.as_deref(),
        original_filename.as_deref(),
        auto_name.as_deref(),
    )
    .await
    {
        Ok(data) => data,
        Err(error) => {
            tracing::error!(error = %error, document_id = %body.document_id, "read clinical import source document");
            return err(StatusCode::CONFLICT, "Document file is unavailable");
        }
    };
    if data.len() > MAX_IMPORT_FILE_BYTES {
        return err(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Document exceeds the clinical import size limit",
        );
    }
    if let Err(message) =
        validate_clinical_import_file(original_filename.as_deref(), mime_type.as_deref(), &data)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }

    let row = match sqlx::query(
        r#"INSERT INTO clinical_document_imports
               (patient_id, document_id, requested_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (document_id) WHERE status IN ('queued', 'processing', 'review_required', 'applying')
                                             AND deleted_at IS NULL
           DO UPDATE SET updated_at = clinical_document_imports.updated_at
           RETURNING id, patient_id, document_id, status, document_type, source_language,
                     parser_version, draft, reviewed_draft, prepared_source_country,
                     prepared_patient_identity_confirmed, prepared_identity_gate_version,
                     prepared_at,
                     applied_counts, error_message, worker_id,
                     requested_by, reviewed_by, applied_by, locked_at, completed_at,
                     applied_at, created_at, updated_at"#,
    )
    .bind(patient_id)
    .bind(body.document_id)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, document_id = %body.document_id, "create clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create import");
        }
    };

    let import_id: Uuid = row.get("id");
    state.audit_sender.try_send(audit::domain_event(
        "clinical_document_import_requested",
        Some(auth.user_id),
        "clinical_document_import",
        Some(import_id),
        json!({ "patient_id": patient_id, "document_id": body.document_id }),
    ));

    (StatusCode::CREATED, Json(import_json(&row))).into_response()
}

async fn list_imports(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    match sqlx::query(&format!(
        "{} WHERE i.patient_id = $1 AND i.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 50",
        import_list_select()
    ))
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(json!({
            "items": rows.iter().map(import_summary_json).collect::<Vec<_>>()
        }))
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "list clinical document imports");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load imports")
        }
    }
}

async fn get_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    match fetch_import(&state, patient_id, import_id).await {
        Ok(Some(row)) => Json(import_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Import not found"),
        Err(response) => response,
    }
}

async fn delete_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }

    let row = match sqlx::query(
        r#"UPDATE clinical_document_imports
           SET deleted_at = now(), worker_id = NULL, locked_at = NULL, updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
             AND status <> 'applying'
           RETURNING document_id, status"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            let applying = sqlx::query_scalar::<_, bool>(
                r#"SELECT EXISTS(
                       SELECT 1 FROM clinical_document_imports
                       WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
                         AND status = 'applying'
                   )"#,
            )
            .bind(import_id)
            .bind(patient_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);
            return if applying {
                err(
                    StatusCode::CONFLICT,
                    "Applying imports cannot be deleted before completion",
                )
            } else {
                err(StatusCode::NOT_FOUND, "Import not found")
            };
        }
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, patient_id = %patient_id, "delete clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete import");
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "clinical_document_import_deleted",
        Some(auth.user_id),
        "clinical_document_import",
        Some(import_id),
        json!({
            "patient_id": patient_id,
            "document_id": row.get::<Uuid, _>("document_id"),
            "previous_status": row.get::<String, _>("status"),
        }),
    ));

    StatusCode::NO_CONTENT.into_response()
}

async fn retry_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    let row = match sqlx::query(
        r#"UPDATE clinical_document_imports
           SET status = 'queued', error_message = NULL, worker_id = NULL,
               locked_at = NULL, completed_at = NULL, updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND status = 'failed' AND deleted_at IS NULL
           RETURNING id, patient_id, document_id, status, document_type, source_language,
                     parser_version, draft, reviewed_draft, applied_counts, error_message, worker_id,
                     requested_by, reviewed_by, applied_by, locked_at, completed_at,
                     applied_at, created_at, updated_at"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Only failed imports can be retried"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "retry clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to retry import");
        }
    };
    Json(import_json(&row)).into_response()
}

fn validate_reviewed_draft(
    reviewed_draft: &Value,
) -> Result<Vec<ReviewedCandidate>, axum::response::Response> {
    let candidates = match reviewed_draft.get("candidates").and_then(Value::as_array) {
        Some(candidates) if candidates.len() <= 500 => candidates,
        Some(_) => {
            return Err(err(
                StatusCode::PAYLOAD_TOO_LARGE,
                "A maximum of 500 reviewed candidates is allowed",
            ));
        }
        None => {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "reviewed_draft.candidates must be an array",
            ));
        }
    };
    let mut reviewed = Vec::with_capacity(candidates.len());
    let mut reviewed_ids = HashSet::with_capacity(candidates.len());
    for candidate in candidates {
        let candidate =
            serde_json::from_value::<ReviewedCandidate>(candidate.clone()).map_err(|_| {
                err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Each reviewed candidate requires id, target, value and selected",
                )
            })?;
        if candidate.id.len() > 128
            || candidate.value.trim().is_empty()
            || candidate.value.len() > 20_000
            || !matches!(
                candidate.target.as_str(),
                "diagnosis"
                    | "anamnesis"
                    | "medication"
                    | "examination"
                    | "lab_result"
                    | "vital"
                    | "recommendation"
            )
            || !reviewed_ids.insert(candidate.id.clone())
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid reviewed candidate",
            ));
        }
        reviewed.push(candidate);
    }
    if !reviewed.iter().any(|candidate| candidate.selected) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Select at least one clinical candidate",
        ));
    }
    Ok(reviewed)
}

fn reviewed_candidates_match_parser_draft(
    reviewed: &[ReviewedCandidate],
    stored_draft: &Value,
) -> bool {
    let stored_targets = stored_draft
        .get("candidates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|candidate| {
            Some((
                candidate.get("id")?.as_str()?.to_string(),
                candidate.get("target")?.as_str()?.to_string(),
            ))
        })
        .collect::<HashMap<_, _>>();
    reviewed.iter().all(|candidate| {
        stored_targets.get(&candidate.id) == Some(&candidate.target)
            || is_manual_candidate_id(&candidate.id)
    })
}

fn validate_prepared_candidate_payloads(
    reviewed: &[ReviewedCandidate],
    candidate_payloads: &Value,
    source_country: Option<&str>,
    import_id: Uuid,
) -> Result<(), axum::response::Response> {
    let Some(payloads) = candidate_payloads.as_object() else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "candidate_payloads must be a JSON object",
        ));
    };
    if payloads.len() > 500
        || serde_json::to_vec(candidate_payloads).is_ok_and(|bytes| bytes.len() > 1_048_576)
    {
        return Err(err(
            StatusCode::PAYLOAD_TOO_LARGE,
            "candidate_payloads exceeds the import review limit",
        ));
    }
    let expected = reviewed
        .iter()
        .filter(|candidate| {
            candidate.selected
                && matches!(
                    candidate.target.as_str(),
                    "medication" | "lab_result" | "vital"
                )
        })
        .map(|candidate| (candidate.id.clone(), candidate.target.clone()))
        .collect::<HashMap<_, _>>();
    if payloads.len() != expected.len()
        || payloads
            .keys()
            .any(|candidate_id| !expected.contains_key(candidate_id))
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "candidate_payloads keys must exactly match selected medication, lab_result, and vital candidates",
        ));
    }
    let mut medication_identity_reviews = HashMap::<String, Vec<(Option<Uuid>, bool)>>::new();
    for (candidate_id, target) in expected {
        let payload = payloads
            .get(&candidate_id)
            .expect("prepared payload key set was validated");
        match target.as_str() {
            "medication" => {
                let request = serde_json::from_value::<ImportedMedicationRequest>(payload.clone())
                    .map_err(|_| {
                        err(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "Invalid medication candidate payload",
                        )
                    })?;
                let medication = normalize_imported_medication(request)?;
                if medication.candidate_id != candidate_id
                    || medication.source_country.as_deref() != source_country
                {
                    return Err(err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Medication candidate payload identity or source_country does not match prepare",
                    ));
                }
                medication_identity_reviews
                    .entry(medication.identity_key.clone())
                    .or_default()
                    .push((medication.requested_series_id, medication.create_new_series));
            }
            "lab_result" => {
                let lab = normalize_patient_lab_result_payload(payload)?;
                if lab.source_candidate_id.as_deref() != Some(candidate_id.as_str())
                    || lab.source_import_id != Some(import_id)
                    || lab.source_country.as_deref() != source_country
                {
                    return Err(err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Lab candidate payload identity or source_country does not match prepare",
                    ));
                }
            }
            "vital" => {
                let vital = normalize_patient_vital_measurement_payload(payload)?;
                if vital.source_candidate_id.as_deref() != Some(candidate_id.as_str())
                    || vital.source_import_id != Some(import_id)
                    || vital.source_country.as_deref() != source_country
                {
                    return Err(err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Vital candidate payload identity or source_country does not match prepare",
                    ));
                }
            }
            _ => unreachable!(),
        }
    }
    if medication_identity_reviews.values().any(|siblings| {
        siblings.len() > 1
            && siblings
                .iter()
                .any(|(series_id, create_new)| series_id.is_none() && !create_new)
    }) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Each same-Wirkstoff medication candidate in one prepared review must select medication_series_id or create_new_series",
        ));
    }
    Ok(())
}

async fn prepare_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PrepareImportRequest>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    let reviewed = match validate_reviewed_draft(&body.reviewed_draft) {
        Ok(reviewed) => reviewed,
        Err(response) => return response,
    };
    let source_country = match imported_source_country(body.source_country) {
        Ok(country) => country,
        Err(response) => return response,
    };
    if source_country.is_none()
        && reviewed.iter().any(|candidate| {
            candidate.selected
                && matches!(
                    candidate.target.as_str(),
                    "diagnosis" | "lab_result" | "medication" | "vital"
                )
        })
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "source_country is required for selected diagnosis, lab_result, medication, or vital candidates",
        );
    }
    if let Err(response) = validate_prepared_candidate_payloads(
        &reviewed,
        &body.candidate_payloads,
        source_country.as_deref(),
        import_id,
    ) {
        return response;
    }
    let prepared_fingerprint = medication_regimen_fingerprint(&json!({
        "reviewed_draft": body.reviewed_draft,
        "source_country": source_country,
        "patient_identity_confirmed": body.patient_identity_confirmed,
        "candidate_payloads": body.candidate_payloads,
    }));
    // Applying imports created before the patient-identity gate do not have
    // the confirmation flag in their frozen fingerprint. Keep an exact legacy
    // fingerprint so those already-frozen imports can be resumed once and
    // upgraded without accepting any changed review or candidate payload.
    let legacy_prepared_fingerprint = medication_regimen_fingerprint(&json!({
        "reviewed_draft": body.reviewed_draft,
        "source_country": source_country,
        "candidate_payloads": body.candidate_payloads,
    }));
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "begin clinical import prepare");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to prepare import",
            );
        }
    };
    let import = match sqlx::query(
        r#"SELECT i.status, i.draft, i.prepared_payload_fingerprint,
                  i.prepared_patient_identity_confirmed, i.prepared_identity_gate_version,
                  p.first_name, p.last_name, p.birth_date, p.patient_id AS patient_identifier
           FROM clinical_document_imports i
           JOIN patients p ON p.id = i.patient_id
           WHERE i.id = $1 AND i.patient_id = $2 AND i.deleted_at IS NULL
           FOR UPDATE OF i, p"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Import not found"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "lock clinical import prepare");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to prepare import",
            );
        }
    };
    let status = import.get::<String, _>("status");
    let stored_draft = import.get::<Value, _>("draft");
    if status == "applying" {
        let stored_fingerprint = import
            .get::<Option<String>, _>("prepared_payload_fingerprint");
        let prepared_identity_confirmed =
            import.get::<bool, _>("prepared_patient_identity_confirmed");
        let identity_gate_version = import.get::<i16, _>("prepared_identity_gate_version");
        let exact_retry = identity_gate_version >= 1
            && stored_fingerprint.as_deref() == Some(prepared_fingerprint.as_str());
        let legacy_retry = identity_gate_version == 0
            && !prepared_identity_confirmed
            && stored_fingerprint.as_deref() == Some(legacy_prepared_fingerprint.as_str());
        if !exact_retry && !legacy_retry {
            return err(
                StatusCode::CONFLICT,
                "Import was already prepared with a different reviewed selection",
            );
        }
        if legacy_retry {
            match evaluate_document_subject_identity(
                &stored_draft,
                &import.get::<String, _>("first_name"),
                &import.get::<String, _>("last_name"),
                import.get::<chrono::NaiveDate, _>("birth_date"),
                &import.get::<String, _>("patient_identifier"),
                body.patient_identity_confirmed,
            ) {
                SubjectIdentityDecision::HardMismatch => {
                    return err(
                        StatusCode::CONFLICT,
                        "Document subject conflicts with the target patient",
                    );
                }
                SubjectIdentityDecision::NameConfirmationRequired => {
                    return err(
                        StatusCode::CONFLICT,
                        "Document subject identity differs from the target patient; explicit identity confirmation is required",
                    );
                }
                SubjectIdentityDecision::Missing => {
                    return err(
                        StatusCode::CONFLICT,
                        "Document subject is unavailable; explicit patient identity confirmation is required",
                    );
                }
                SubjectIdentityDecision::ConfirmationWithoutSubject
                | SubjectIdentityDecision::Matched
                | SubjectIdentityDecision::ConfirmedNameMismatch => {}
            }
            if let Err(error) = sqlx::query(
                r#"UPDATE clinical_document_imports
                   SET prepared_payload_fingerprint = $3,
                       prepared_patient_identity_confirmed = $5,
                       prepared_identity_gate_version = 1,
                       updated_at = now()
                   WHERE id = $1 AND patient_id = $2 AND status = 'applying'
                     AND prepared_payload_fingerprint = $4
                     AND prepared_identity_gate_version = 0"#,
            )
            .bind(import_id)
            .bind(patient_id)
            .bind(&prepared_fingerprint)
            .bind(&legacy_prepared_fingerprint)
            .bind(body.patient_identity_confirmed)
            .execute(&mut *tx)
            .await
            {
                tracing::error!(error = %error, import_id = %import_id, "upgrade legacy clinical import prepare fingerprint");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to prepare import",
                );
            }
        }
        if let Err(error) = tx.commit().await {
            tracing::error!(error = %error, import_id = %import_id, "commit idempotent clinical import prepare");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to prepare import",
            );
        }
        return Json(json!({
            "ok": true,
            "id": import_id,
            "status": "applying",
            "idempotent": true,
            "source_country": source_country,
            "patient_identity_confirmed": if legacy_retry {
                body.patient_identity_confirmed
            } else {
                prepared_identity_confirmed
            },
        }))
        .into_response();
    }
    if status != "review_required" {
        return err(StatusCode::CONFLICT, "Import is not ready to be prepared");
    }
    if !reviewed_candidates_match_parser_draft(&reviewed, &stored_draft) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reviewed candidates do not match the parser draft",
        );
    }
    match evaluate_document_subject_identity(
        &stored_draft,
        &import.get::<String, _>("first_name"),
        &import.get::<String, _>("last_name"),
        import.get::<chrono::NaiveDate, _>("birth_date"),
        &import.get::<String, _>("patient_identifier"),
        body.patient_identity_confirmed,
    ) {
        SubjectIdentityDecision::HardMismatch => {
            return err(
                StatusCode::CONFLICT,
                "Document subject conflicts with the target patient",
            );
        }
        SubjectIdentityDecision::NameConfirmationRequired => {
            return err(
                StatusCode::CONFLICT,
                "Document subject identity differs from the target patient; explicit identity confirmation is required",
            );
        }
        SubjectIdentityDecision::Missing => {
            return err(
                StatusCode::CONFLICT,
                "Document subject is unavailable; explicit patient identity confirmation is required",
            );
        }
        SubjectIdentityDecision::ConfirmationWithoutSubject
        | SubjectIdentityDecision::Matched
        | SubjectIdentityDecision::ConfirmedNameMismatch => {}
    }
    if let Err(error) = sqlx::query(
        r#"UPDATE clinical_document_imports
           SET status = 'applying', reviewed_draft = $3, reviewed_by = $4,
               prepared_payload_fingerprint = $5, prepared_source_country = $6,
               prepared_candidate_payloads = $7,
               prepared_patient_identity_confirmed = $8,
               prepared_identity_gate_version = 1,
               prepared_at = now(), updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND status = 'review_required'
             AND deleted_at IS NULL"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .bind(&body.reviewed_draft)
    .bind(auth.user_id)
    .bind(&prepared_fingerprint)
    .bind(&source_country)
    .bind(&body.candidate_payloads)
    .bind(body.patient_identity_confirmed)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, import_id = %import_id, "persist clinical import prepare");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to prepare import",
        );
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, import_id = %import_id, "commit clinical import prepare");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to prepare import",
        );
    }
    Json(json!({
        "ok": true,
        "id": import_id,
        "status": "applying",
        "idempotent": false,
        "source_country": source_country,
        "patient_identity_confirmed": body.patient_identity_confirmed,
    }))
    .into_response()
}

async fn complete_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CompleteImportRequest>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    let reviewed = match validate_reviewed_draft(&body.reviewed_draft) {
        Ok(reviewed) => reviewed,
        Err(response) => return response,
    };
    let selected = reviewed
        .iter()
        .filter(|candidate| candidate.selected)
        .collect::<Vec<_>>();

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "begin clinical document import completion");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to complete import",
            );
        }
    };
    let import_row = match sqlx::query(
        r#"SELECT document_id, draft, reviewed_draft, prepared_identity_gate_version
           FROM clinical_document_imports
           WHERE id = $1 AND patient_id = $2 AND status = 'applying'
             AND deleted_at IS NULL
           FOR UPDATE"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Import is not in the applying stage"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "lock clinical document import");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to complete import",
            );
        }
    };
    if import_row.get::<i16, _>("prepared_identity_gate_version") < 1 {
        return err(
            StatusCode::CONFLICT,
            "Clinical import identity gate must be completed before completion",
        );
    }
    let document_id: Uuid = import_row.get("document_id");
    let stored_draft: Value = import_row.get("draft");
    if import_row
        .get::<Option<Value>, _>("reviewed_draft")
        .as_ref()
        != Some(&body.reviewed_draft)
    {
        return err(
            StatusCode::CONFLICT,
            "Completion payload differs from the prepared reviewed selection",
        );
    }
    if !reviewed_candidates_match_parser_draft(&reviewed, &stored_draft) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reviewed candidates do not match the parser draft",
        );
    }

    let mut applied_counts = serde_json::Map::new();
    for candidate in selected {
        let marker = format!("[clinical-import:{import_id}:{}]", candidate.id);
        let result = match candidate.target.as_str() {
            "diagnosis" => {
                sqlx::query(
                    r#"UPDATE patient_diagnoses
                       SET source_document_id = $1, source_import_id = $2, source_candidate_id = $3
                       WHERE id = (
                           SELECT id FROM patient_diagnoses
                           WHERE patient_id = $4 AND note LIKE '%' || $5 || '%'
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(&marker)
                .execute(&mut *tx)
                .await
            }
            "medication" => {
                sqlx::query(
                    r#"UPDATE patient_medications
                       SET source_document_id = COALESCE(source_document_id, $1),
                           source_import_id = COALESCE(source_import_id, $2),
                           source_candidate_id = COALESCE(source_candidate_id, $3)
                       WHERE id = COALESCE(
                           (
                               SELECT id FROM patient_medications
                               WHERE patient_id = $4 AND source_import_id = $2
                                 AND source_candidate_id = $3
                               ORDER BY created_at DESC LIMIT 1
                           ),
                           (
                               SELECT patient_medication_id
                               FROM patient_medication_import_history
                               WHERE patient_id = $4 AND source_import_id = $2
                                 AND source_candidate_id = $3
                               LIMIT 1
                           ),
                           (
                               SELECT id FROM patient_medications
                               WHERE patient_id = $4 AND hinweis LIKE '%' || $5 || '%'
                               ORDER BY created_at DESC LIMIT 1
                           )
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(&marker)
                .execute(&mut *tx)
                .await
            }
            "examination" => {
                sqlx::query(
                    r#"UPDATE patient_examinations
                       SET source_document_id = $1, source_import_id = $2, source_candidate_id = $3
                       WHERE id = (
                           SELECT id FROM patient_examinations
                           WHERE patient_id = $4 AND note LIKE '%' || $5 || '%'
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(&marker)
                .execute(&mut *tx)
                .await
            }
            "lab_result" => {
                sqlx::query(
                    r#"UPDATE patient_lab_results
                       SET source_document_id = $1
                       WHERE patient_id = $2 AND source_import_id = $3
                         AND source_candidate_id = $4"#,
                )
                .bind(document_id)
                .bind(patient_id)
                .bind(import_id)
                .bind(&candidate.id)
                .execute(&mut *tx)
                .await
            }
            "vital" => {
                sqlx::query(
                    r#"UPDATE patient_vital_measurements
                       SET source_document_id = $1
                       WHERE patient_id = $2 AND source_import_id = $3
                         AND source_candidate_id = $4"#,
                )
                .bind(document_id)
                .bind(patient_id)
                .bind(import_id)
                .bind(&candidate.id)
                .execute(&mut *tx)
                .await
            }
            "anamnesis" => {
                sqlx::query(
                    r#"UPDATE patient_clinical_narrative
                       SET source_document_id = $1, source_import_id = $2
                       WHERE id = (
                           SELECT id FROM patient_clinical_narrative
                           WHERE patient_id = $3 AND is_active
                             AND position($4 in COALESCE(anamnese_aktuelle, '')) > 0
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(patient_id)
                .bind(candidate.value.trim())
                .execute(&mut *tx)
                .await
            }
            "recommendation" => {
                sqlx::query(
                    r#"UPDATE patient_recommendations
                       SET source_import_id = $1, source_candidate_id = $2
                       WHERE id = (
                           SELECT id FROM patient_recommendations
                           WHERE patient_id = $3 AND source_document_id = $4
                             AND description = $5
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(document_id)
                .bind(candidate.value.trim())
                .execute(&mut *tx)
                .await
            }
            _ => unreachable!(),
        };
        match result {
            Ok(result) if result.rows_affected() == 1 => {
                let key = match candidate.target.as_str() {
                    "diagnosis" => "diagnoses",
                    "anamnesis" => "anamnesis",
                    "medication" => "medications",
                    "examination" => "examinations",
                    "lab_result" => "lab_results",
                    "vital" => "vitals",
                    "recommendation" => "recommendations",
                    _ => unreachable!(),
                };
                let count = applied_counts.get(key).and_then(Value::as_u64).unwrap_or(0) + 1;
                applied_counts.insert(key.to_string(), json!(count));
            }
            Ok(_) => {
                return err(
                    StatusCode::CONFLICT,
                    "Not all reviewed candidates were persisted; retry the apply step",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, import_id = %import_id, candidate_id = %candidate.id, "attach clinical import provenance");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to complete import",
                );
            }
        }
    }
    let applied_counts = Value::Object(applied_counts);
    let row = match sqlx::query(
        r#"UPDATE clinical_document_imports
           SET status = 'applied', reviewed_draft = $3, reviewed_by = $4,
               applied_by = $4, applied_counts = $5, applied_at = now(), updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND status = 'applying'
             AND deleted_at IS NULL
           RETURNING id, patient_id, document_id, status, document_type, source_language,
                     parser_version, draft, reviewed_draft, prepared_source_country,
                     prepared_patient_identity_confirmed, prepared_identity_gate_version,
                     prepared_at,
                     applied_counts, error_message, worker_id,
                     requested_by, reviewed_by, applied_by, locked_at, completed_at,
                     applied_at, created_at, updated_at"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .bind(&body.reviewed_draft)
    .bind(auth.user_id)
    .bind(&applied_counts)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Import is not in the applying stage"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "complete clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to complete import");
        }
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, import_id = %import_id, "commit clinical document import completion");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to complete import",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "clinical_document_import_applied",
        Some(auth.user_id),
        "clinical_document_import",
        Some(import_id),
        json!({
            "patient_id": patient_id,
            "document_id": row.get::<Uuid, _>("document_id"),
            "applied_counts": applied_counts,
        }),
    ));
    Json(import_json(&row)).into_response()
}

async fn fetch_import(
    state: &AppState,
    patient_id: Uuid,
    import_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(&format!(
        "{} WHERE i.id = $1 AND i.patient_id = $2 AND i.deleted_at IS NULL",
        import_select()
    ))
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, import_id = %import_id, "load clinical document import");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load import")
    })
}

fn import_select() -> &'static str {
    r#"SELECT i.id, i.patient_id, i.document_id, i.status, i.document_type,
              i.source_language, i.parser_version, i.draft, i.reviewed_draft,
              i.prepared_source_country, i.prepared_patient_identity_confirmed,
              i.prepared_identity_gate_version, i.prepared_at,
              i.applied_counts, i.error_message, i.worker_id, i.requested_by, i.reviewed_by,
              i.applied_by, i.locked_at, i.completed_at, i.applied_at,
              i.created_at, i.updated_at,
              d.original_filename AS document_name, d.mime_type
       FROM clinical_document_imports i
       JOIN documents d ON d.id = i.document_id"#
}

fn import_list_select() -> &'static str {
    r#"SELECT i.id, i.patient_id, i.document_id, i.status, i.document_type,
              i.source_language, i.parser_version, i.applied_counts, i.error_message,
              i.prepared_source_country, i.prepared_patient_identity_confirmed,
              i.prepared_identity_gate_version, i.prepared_at,
              i.completed_at, i.applied_at, i.created_at, i.updated_at,
              COALESCE(jsonb_array_length(i.draft->'candidates'), 0)::bigint AS candidate_count,
              d.original_filename AS document_name, d.mime_type
       FROM clinical_document_imports i
       JOIN documents d ON d.id = i.document_id"#
}

fn import_summary_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<Uuid, _>("id"),
        "patient_id": row.get::<Uuid, _>("patient_id"),
        "document_id": row.get::<Uuid, _>("document_id"),
        "document_name": row.try_get::<String, _>("document_name").ok(),
        "mime_type": row.try_get::<String, _>("mime_type").ok(),
        "status": row.get::<String, _>("status"),
        "document_type": row.get::<Option<String>, _>("document_type"),
        "source_language": row.get::<Option<String>, _>("source_language"),
        "parser_version": row.get::<Option<String>, _>("parser_version"),
        "candidate_count": row.get::<i64, _>("candidate_count"),
        "prepared_source_country": row.get::<Option<String>, _>("prepared_source_country"),
        "prepared_patient_identity_confirmed": row.get::<bool, _>("prepared_patient_identity_confirmed"),
        "prepared_identity_gate_version": row.get::<i16, _>("prepared_identity_gate_version"),
        "prepared_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("prepared_at"),
        "applied_counts": row.get::<Value, _>("applied_counts"),
        "error_message": row.get::<Option<String>, _>("error_message"),
        "completed_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at"),
        "applied_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("applied_at"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
    })
}

fn import_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<Uuid, _>("id"),
        "patient_id": row.get::<Uuid, _>("patient_id"),
        "document_id": row.get::<Uuid, _>("document_id"),
        "document_name": row.try_get::<String, _>("document_name").ok(),
        "mime_type": row.try_get::<String, _>("mime_type").ok(),
        "status": row.get::<String, _>("status"),
        "document_type": row.get::<Option<String>, _>("document_type"),
        "source_language": row.get::<Option<String>, _>("source_language"),
        "parser_version": row.get::<Option<String>, _>("parser_version"),
        "draft": row.get::<Value, _>("draft"),
        "reviewed_draft": row.get::<Option<Value>, _>("reviewed_draft"),
        "prepared_source_country": row.try_get::<Option<String>, _>("prepared_source_country").unwrap_or_default(),
        "prepared_patient_identity_confirmed": row.try_get::<bool, _>("prepared_patient_identity_confirmed").unwrap_or(false),
        "prepared_identity_gate_version": row.try_get::<i16, _>("prepared_identity_gate_version").unwrap_or(0),
        "prepared_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("prepared_at").unwrap_or_default(),
        "applied_counts": row.get::<Value, _>("applied_counts"),
        "error_message": row.get::<Option<String>, _>("error_message"),
        "requested_by": row.get::<Uuid, _>("requested_by"),
        "reviewed_by": row.get::<Option<Uuid>, _>("reviewed_by"),
        "applied_by": row.get::<Option<Uuid>, _>("applied_by"),
        "locked_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("locked_at"),
        "completed_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at"),
        "applied_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("applied_at"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
    })
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{
        ImportedMedicationRequest, SubjectIdentityDecision, evaluate_document_subject_identity,
        is_manual_candidate_id, normalize_imported_medication, validate_clinical_import_file,
    };
    use serde_json::json;

    #[test]
    fn accepts_only_namespaced_uuid_manual_candidate_ids() {
        assert!(is_manual_candidate_id(
            "manual:63f71b6c-b947-4ef3-87ef-c0e6eed6ceeb"
        ));
        assert!(!is_manual_candidate_id(
            "63f71b6c-b947-4ef3-87ef-c0e6eed6ceeb"
        ));
        assert!(!is_manual_candidate_id("manual:not-a-uuid"));
    }

    #[test]
    fn document_subject_identity_blocks_hard_mismatches_and_requires_name_confirmation() {
        let patient_birth_date = chrono::NaiveDate::from_ymd_opt(1990, 1, 1).unwrap();
        let base_subject = json!({
            "subject": {
                "status": "extracted",
                "conflict": false,
                "first_name": "Anna",
                "last_name": "Muster",
                "birth_date": "1990-01-01",
                "patient_identifier": "pt 123",
                "patient_identifier_namespace": "gmed_patient_id",
                "field_confidence": {},
                "source": { "page": 1, "text": "Anna Muster" },
                "review_reasons": [],
            }
        });
        assert_eq!(
            evaluate_document_subject_identity(
                &base_subject,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                false,
            ),
            SubjectIdentityDecision::Matched
        );

        let mut wrong_name = base_subject.clone();
        wrong_name["subject"]["last_name"] = json!("Andere");
        assert_eq!(
            evaluate_document_subject_identity(
                &wrong_name,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                false,
            ),
            SubjectIdentityDecision::NameConfirmationRequired
        );
        assert_eq!(
            evaluate_document_subject_identity(
                &wrong_name,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                true,
            ),
            SubjectIdentityDecision::ConfirmedNameMismatch
        );

        for hard_mismatch in [
            {
                let mut value = base_subject.clone();
                value["subject"]["status"] = json!("conflict");
                value["subject"]["conflict"] = json!(true);
                value
            },
            {
                let mut value = base_subject.clone();
                value["subject"]["birth_date"] = json!("1991-01-01");
                value
            },
            {
                let mut value = base_subject.clone();
                value["subject"]["patient_identifier"] = json!("PT-999");
                value
            },
        ] {
            assert_eq!(
                evaluate_document_subject_identity(
                    &hard_mismatch,
                    "Anna",
                    "Muster",
                    patient_birth_date,
                    "PT-123",
                    true,
                ),
                SubjectIdentityDecision::HardMismatch
            );
        }

        let external_identifier = json!({
            "subject": {
                "status": "extracted",
                "conflict": false,
                "first_name": "Anna",
                "last_name": "Muster",
                "birth_date": "1990-01-01",
                "patient_identifier": "KLINIK-4711",
                "patient_identifier_namespace": "source_document"
            }
        });
        assert_eq!(
            evaluate_document_subject_identity(
                &external_identifier,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                false,
            ),
            SubjectIdentityDecision::NameConfirmationRequired
        );
        assert_eq!(
            evaluate_document_subject_identity(
                &external_identifier,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                true,
            ),
            SubjectIdentityDecision::ConfirmedNameMismatch
        );

        let legacy_external_identifier = json!({
            "subject": {
                "status": "extracted",
                "conflict": false,
                "first_name": null,
                "last_name": null,
                "birth_date": null,
                "patient_identifier": "KLINIK-4711"
            }
        });
        assert_eq!(
            evaluate_document_subject_identity(
                &legacy_external_identifier,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                false,
            ),
            SubjectIdentityDecision::NameConfirmationRequired
        );
    }

    #[test]
    fn missing_or_insufficient_document_subject_requires_manual_confirmation() {
        let patient_birth_date = chrono::NaiveDate::from_ymd_opt(1990, 1, 1).unwrap();
        assert_eq!(
            evaluate_document_subject_identity(
                &json!({ "subject": null }),
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                false,
            ),
            SubjectIdentityDecision::Missing
        );
        assert_eq!(
            evaluate_document_subject_identity(
                &json!({}),
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                true,
            ),
            SubjectIdentityDecision::ConfirmationWithoutSubject
        );
        let insufficient_subject = json!({
            "subject": {
                "status": "extracted",
                "conflict": false,
                "first_name": "Anna",
                "last_name": null,
                "birth_date": null,
                "patient_identifier": null
            }
        });
        assert_eq!(
            evaluate_document_subject_identity(
                &insufficient_subject,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                false,
            ),
            SubjectIdentityDecision::Missing
        );
        assert_eq!(
            evaluate_document_subject_identity(
                &insufficient_subject,
                "Anna",
                "Muster",
                patient_birth_date,
                "PT-123",
                true,
            ),
            SubjectIdentityDecision::ConfirmationWithoutSubject
        );
    }

    #[test]
    fn accepts_supported_import_magic_bytes() {
        assert!(
            validate_clinical_import_file(
                Some("report.pdf"),
                Some("application/pdf"),
                b"%PDF-1.7\n",
            )
            .is_ok()
        );
        assert!(
            validate_clinical_import_file(
                Some("scan.png"),
                Some("image/png"),
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
            )
            .is_ok()
        );
        assert!(
            validate_clinical_import_file(
                Some("scan.jpg"),
                Some("image/jpeg"),
                &[0xFF, 0xD8, 0xFF],
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_unsupported_or_mismatched_imports() {
        assert!(
            validate_clinical_import_file(
                Some("report.html"),
                Some("text/html"),
                b"<html></html>",
            )
            .is_err()
        );
        assert!(
            validate_clinical_import_file(
                Some("report.pdf"),
                Some("application/pdf"),
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
            )
            .is_err()
        );
    }

    #[test]
    fn medication_import_requires_reviewed_active_ingredient() {
        let request: ImportedMedicationRequest = serde_json::from_value(json!({
            "candidate_id": "med-1",
            "handelsname": "Brand only",
        }))
        .unwrap();
        assert!(normalize_imported_medication(request).is_err());
    }

    #[test]
    fn medication_fingerprint_changes_with_regimen_but_not_whitespace() {
        let request = |dose: &str, ingredient: &str| {
            serde_json::from_value::<ImportedMedicationRequest>(json!({
                "candidate_id": "med-1",
                "wirkstoff": ingredient,
                "handelsname": "Example",
                "staerke": "20 mg",
                "dose_morgens": dose,
                "status": "active",
                "source_country": "DE",
                "field_confidence": { "wirkstoff": 0.98 },
            }))
            .unwrap()
        };
        let first = normalize_imported_medication(request("1", "  Active   ingredient ")).unwrap();
        let same = normalize_imported_medication(request("1", "active ingredient")).unwrap();
        let changed = normalize_imported_medication(request("2", "active ingredient")).unwrap();
        assert_eq!(first.identity_key, "active ingredient");
        assert_eq!(first.fingerprint, same.fingerprint);
        assert_ne!(first.fingerprint, changed.fingerprint);
        assert_eq!(first.source_country.as_deref(), Some("DE"));
    }

    #[test]
    fn medication_confidence_must_be_bounded() {
        let request: ImportedMedicationRequest = serde_json::from_value(json!({
            "candidate_id": "med-1",
            "wirkstoff": "Example ingredient",
            "field_confidence": { "wirkstoff": 1.2 },
        }))
        .unwrap();
        assert!(normalize_imported_medication(request).is_err());
    }
}
