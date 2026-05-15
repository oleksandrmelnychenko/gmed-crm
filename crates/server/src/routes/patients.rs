use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::Datelike;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;
use sqlx::types::Json as SqlxJson;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/patients", get(list_patients).post(create_patient))
        .route("/patients/{patient_id}", get(get_patient))
        .route(
            "/patients/{patient_id}/vitals",
            get(list_patient_vitals).post(create_patient_vital_measurement),
        )
        .route(
            "/patients/{patient_id}/card-entries",
            get(list_patient_card_entries).post(create_patient_card_entry),
        )
        .route(
            "/patients/{patient_id}/medical-orders",
            get(list_patient_medical_orders).post(create_patient_medical_order),
        )
        .route(
            "/patients/{patient_id}/risk-scores",
            get(list_patient_risk_scores).post(create_patient_risk_score),
        )
        .route("/patients/{patient_id}/recheck", get(get_patient_recheck))
        .route("/patients/{patient_id}/assignments", get(list_assignments))
        .route("/patients/{patient_id}/cases", get(list_patient_cases))
        .route("/patients/{patient_id}/orders", get(list_patient_orders))
        .route(
            "/patients/{patient_id}/appointments",
            get(list_patient_appointments),
        )
        .route(
            "/patients/{patient_id}/documents",
            get(list_patient_documents),
        )
        .route(
            "/patients/{patient_id}/document-alerts",
            get(get_patient_document_alerts),
        )
        .route(
            "/patients/{patient_id}/framework-contracts",
            get(list_patient_framework_contracts),
        )
        .route(
            "/patients/{patient_id}/invoices",
            get(list_patient_invoices),
        )
        .route(
            "/patients/{patient_id}/service-report",
            get(get_patient_service_report),
        )
        .route(
            "/patients/{patient_id}/relations",
            get(list_relations).post(create_relation),
        )
        .route("/patients/{patient_id}/label", get(get_patient_label))
        .route("/patients/{patient_id}/timeline", get(get_patient_timeline))
        .route("/patients/{patient_id}/update", post(update_patient))
        .route("/patients/{patient_id}/assign", post(assign_patient))
        .route("/patients/{patient_id}/revoke", post(revoke_assignment))
        .route(
            "/patients/{patient_id}/medical-orders/{medical_order_id}/update",
            post(update_patient_medical_order),
        )
        .route(
            "/patients/{patient_id}/relations/{relation_id}/update",
            post(update_relation),
        )
        .route(
            "/patients/{patient_id}/relations/{relation_id}/delete",
            post(delete_relation),
        )
        .route("/patients/{patient_id}/activate", post(activate_patient))
        .route(
            "/patients/{patient_id}/deactivate",
            post(deactivate_patient),
        )
        .route("/patients/{patient_id}/delete", post(delete_patient))
}

#[derive(Debug, Clone)]
struct FieldPolicy {
    access_level: String,
    condition_type: Option<String>,
}

#[derive(Deserialize)]
struct CreatePatientRequest {
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: String,
    gender: String,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Option<Vec<String>>,
    functional_labels: Option<Vec<String>>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_type: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
    emergency_contact_relation: Option<String>,
    patient_relations: Option<Vec<UpsertRelationRequest>>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePatientRequest {
    title: Option<Value>,
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<String>,
    gender: Option<String>,
    phone_primary: Option<Value>,
    phone_secondary: Option<Value>,
    email: Option<Value>,
    nationality: Option<Value>,
    residence_country: Option<Value>,
    languages: Option<Vec<String>>,
    functional_labels: Option<Vec<String>>,
    address_street: Option<Value>,
    address_city: Option<Value>,
    address_zip: Option<Value>,
    address_country: Option<Value>,
    insurance_provider: Option<Value>,
    insurance_number: Option<Value>,
    insurance_type: Option<Value>,
    emergency_contact_name: Option<Value>,
    emergency_contact_phone: Option<Value>,
    emergency_contact_relation: Option<Value>,
    legal_status: Option<Value>,
    clinical_warnings: Option<String>,
    notes: Option<Value>,
}

#[derive(Deserialize)]
struct CreatePatientVitalMeasurementRequest {
    measured_at: String,
    bp_systolic: Option<f64>,
    bp_diastolic: Option<f64>,
    heart_rate: Option<i32>,
    weight_kg: Option<f64>,
    height_cm: Option<f64>,
    bmi: Option<f64>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct CreatePatientCardEntryRequest {
    entry_date: String,
    category: String,
    source: Option<String>,
    content: String,
}

#[derive(Deserialize)]
struct CreatePatientMedicalOrderRequest {
    order_date: String,
    order_type: String,
    title: String,
    instructions: String,
    due_date: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePatientMedicalOrderRequest {
    order_date: Option<String>,
    order_type: Option<String>,
    title: Option<String>,
    instructions: Option<String>,
    status: Option<String>,
    due_date: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct CreatePatientRiskScoreRequest {
    computed_at: String,
    score_type: String,
    score_value: f64,
    scale_max: Option<f64>,
    interpretation: Option<String>,
    source: Option<String>,
    inputs: Option<Value>,
}

#[derive(Deserialize)]
struct AssignRequest {
    user_id: Uuid,
}

#[derive(Deserialize)]
struct ListQuery {
    search: Option<String>,
    active_only: Option<bool>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct UpsertRelationRequest {
    related_patient_id: Option<Uuid>,
    related_name: String,
    relation_type: String,
    is_emergency_contact: Option<bool>,
    phone: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct PatientLabelQuery {
    format: Option<String>,
}

#[derive(Clone)]
struct RequiredPatientDocumentRule {
    key: String,
    label: String,
    art: Vec<String>,
    category: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct PatientDocumentAlertsSummary {
    configured_rule_count: usize,
    document_pack_complete: bool,
    stored_document_pack_complete: bool,
    out_of_sync: bool,
    required_documents: Vec<Value>,
    missing_documents: Vec<Value>,
    missing_count: usize,
}

#[derive(Clone)]
pub(crate) struct PatientRecheckReadiness {
    pub(crate) can_create_order: bool,
    pub(crate) blocking_reasons: Vec<String>,
    pub(crate) payload: Value,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PatientLabelFormat {
    pub(crate) id: &'static str,
    pub(crate) label: &'static str,
    pub(crate) width_mm: i32,
    pub(crate) height_mm: i32,
}

#[derive(Debug, Clone)]
pub(crate) struct PatientLabelAgencySettings {
    pub(crate) name: String,
    pub(crate) care_of: String,
    pub(crate) address: Option<String>,
    pub(crate) phone: Option<String>,
    pub(crate) email: Option<String>,
}

const PATIENT_CARD_ENTRY_CATEGORIES: &[&str] = &[
    "medical_update",
    "patient_report",
    "provider_report",
    "treatment_note",
    "followup_note",
    "warning",
    "other",
];

const PATIENT_MEDICAL_ORDER_TYPES: &[&str] = &[
    "physiotherapy",
    "diet",
    "lab_recheck",
    "imaging",
    "medication_followup",
    "procedure",
    "other",
];

const PATIENT_MEDICAL_ORDER_STATUSES: &[&str] = &["active", "completed", "cancelled"];

const PATIENT_RISK_SCORE_TYPES: &[&str] = &[
    "cha2ds2_vasc",
    "has_bled",
    "framingham",
    "fall_risk",
    "frailty",
    "nutrition_risk",
    "other",
];

pub(crate) const PATIENT_LABEL_FORMATS: [PatientLabelFormat; 3] = [
    PatientLabelFormat {
        id: "compact-90x48",
        label: "Compact 90 x 48 mm",
        width_mm: 90,
        height_mm: 48,
    },
    PatientLabelFormat {
        id: "standard-105x74",
        label: "Standard 105 x 74 mm",
        width_mm: 105,
        height_mm: 74,
    },
    PatientLabelFormat {
        id: "sheet-70x37",
        label: "Sheet 70 x 37 mm",
        width_mm: 70,
        height_mm: 37,
    },
];

const ALLOWED_PATIENT_FUNCTIONAL_LABELS: [&str; 5] = [
    "vip",
    "high_risk",
    "mobility_support",
    "fall_risk",
    "complex_coordination",
];
const ALLOWED_PATIENT_COUNTRIES: [&str; 21] = [
    "Germany",
    "Ukraine",
    "Austria",
    "Switzerland",
    "Poland",
    "Czech Republic",
    "Denmark",
    "Latvia",
    "Greece",
    "Turkey",
    "United Arab Emirates",
    "Saudi Arabia",
    "Egypt",
    "Nigeria",
    "Ghana",
    "Brazil",
    "China",
    "Russia",
    "Pakistan",
    "United Kingdom",
    "United States",
];
const ALLOWED_PATIENT_NATIONALITIES: [&str; 21] = [
    "German",
    "Ukrainian",
    "Austrian",
    "Swiss",
    "Polish",
    "Czech",
    "Danish",
    "Latvian",
    "Greek",
    "Turkish",
    "Emirati",
    "Saudi",
    "Egyptian",
    "Nigerian",
    "Ghanaian",
    "Brazilian",
    "Chinese",
    "Russian",
    "Pakistani",
    "British",
    "American",
];
const ALLOWED_PATIENT_LANGUAGES: [&str; 17] = [
    "de", "uk", "ru", "en", "ar", "pt", "fr", "es", "it", "tr", "pl", "cs", "da", "el", "lv", "zh",
    "ur",
];

fn validate_create(req: &CreatePatientRequest) -> Result<(), &'static str> {
    let first_name = req.first_name.trim();
    let last_name = req.last_name.trim();
    let birth_date = req.birth_date.trim();

    if first_name.is_empty() || first_name.len() > 200 {
        return Err("First name required (max 200)");
    }
    if last_name.is_empty() || last_name.len() > 200 {
        return Err("Last name required (max 200)");
    }
    if birth_date.is_empty() {
        return Err("Birth date required");
    }
    let parsed_birth_date = chrono::NaiveDate::parse_from_str(birth_date, "%Y-%m-%d")
        .map_err(|_| "Invalid birth_date format (YYYY-MM-DD)")?;
    match req.gender.as_str() {
        "male" => {}
        "female" => {}
        "diverse" => {}
        _ => return Err("Gender must be male, female, or diverse"),
    }
    if let Some(ref it) = req.insurance_type {
        match it.as_str() {
            "private" => {}
            "public" => {}
            "self_pay" => {}
            "foreign" => {}
            _ => return Err("Invalid insurance type"),
        }
    }
    validate_optional_patient_select(
        req.nationality.as_deref(),
        &ALLOWED_PATIENT_NATIONALITIES,
        "nationality",
    )?;
    validate_optional_patient_select(
        req.residence_country.as_deref(),
        &ALLOWED_PATIENT_COUNTRIES,
        "residence_country",
    )?;
    validate_optional_patient_select(
        req.address_country.as_deref(),
        &ALLOWED_PATIENT_COUNTRIES,
        "address_country",
    )?;
    validate_patient_languages(req.languages.as_deref())?;
    if let Some(relations) = req.patient_relations.as_ref() {
        for relation in relations {
            validate_relation_payload_fields(relation)?;
        }
    }
    if is_minor_birth_date(parsed_birth_date, chrono::Utc::now().date_naive())
        && !has_minor_guardian(req)
    {
        return Err(
            "Minor patients require a guardian/parent relation or guardian emergency contact",
        );
    }
    Ok(())
}

fn validate_optional_patient_select(
    value: Option<&str>,
    allowed_values: &[&str],
    field_name: &'static str,
) -> Result<(), &'static str> {
    let Some(value) = value else {
        return Ok(());
    };
    let value = value.trim();
    if value.is_empty() || allowed_values.contains(&value) {
        return Ok(());
    }
    match field_name {
        "nationality" => Err("Invalid nationality"),
        "residence_country" => Err("Invalid residence_country"),
        "address_country" => Err("Invalid address_country"),
        _ => Err("Invalid select value"),
    }
}

fn validate_optional_patient_select_update(
    value: Option<&str>,
    current: Option<&str>,
    allowed_values: &[&str],
    field_name: &'static str,
) -> Result<(), &'static str> {
    let Some(value) = value else {
        return Ok(());
    };
    let value = value.trim();
    if value.is_empty() || allowed_values.contains(&value) {
        return Ok(());
    }
    if current.is_some_and(|current| current.trim() == value) {
        return Ok(());
    }
    match field_name {
        "nationality" => Err("Invalid nationality"),
        "residence_country" => Err("Invalid residence_country"),
        "address_country" => Err("Invalid address_country"),
        _ => Err("Invalid select value"),
    }
}

fn validate_patient_languages(languages: Option<&[String]>) -> Result<(), &'static str> {
    let Some(languages) = languages else {
        return Ok(());
    };
    for language in languages {
        let language = language.trim();
        if !language.is_empty() && !ALLOWED_PATIENT_LANGUAGES.contains(&language) {
            return Err("Invalid patient language");
        }
    }
    Ok(())
}

fn normalize_patient_select_value(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn normalize_patient_language_values(
    languages: Option<Vec<String>>,
) -> Result<Vec<String>, &'static str> {
    let mut normalized = Vec::new();
    for language in languages.unwrap_or_default() {
        let language = language.trim();
        if language.is_empty() {
            continue;
        }
        if !ALLOWED_PATIENT_LANGUAGES.contains(&language) {
            return Err("Invalid patient language");
        }
        if !normalized.iter().any(|item| item == language) {
            normalized.push(language.to_string());
        }
    }
    Ok(normalized)
}

fn normalize_patient_language_values_for_update(
    languages: Vec<String>,
    current: &[String],
) -> Result<Vec<String>, &'static str> {
    let mut normalized = Vec::new();
    for language in languages {
        let language = language.trim();
        if language.is_empty() {
            continue;
        }
        if !ALLOWED_PATIENT_LANGUAGES.contains(&language)
            && !current.iter().any(|current| current == language)
        {
            return Err("Invalid patient language");
        }
        if !normalized.iter().any(|item| item == language) {
            normalized.push(language.to_string());
        }
    }
    Ok(normalized)
}

fn is_minor_birth_date(birth_date: chrono::NaiveDate, today: chrono::NaiveDate) -> bool {
    let mut age = today.year() - birth_date.year();
    if (today.month(), today.day()) < (birth_date.month(), birth_date.day()) {
        age -= 1;
    }
    age < 18
}

fn has_minor_guardian(req: &CreatePatientRequest) -> bool {
    if let Some(relations) = req.patient_relations.as_ref()
        && relations.iter().any(|relation| {
            is_guardian_or_parent_relation_type(&relation.relation_type)
                && !relation.related_name.trim().is_empty()
        })
    {
        return true;
    }

    has_guardian_or_parent_contact(
        req.emergency_contact_relation.as_deref(),
        req.emergency_contact_name.as_deref(),
        req.emergency_contact_phone.as_deref(),
    )
}

fn has_guardian_or_parent_contact(
    relation: Option<&str>,
    name: Option<&str>,
    phone: Option<&str>,
) -> bool {
    is_guardian_or_parent_relation_type(relation.unwrap_or(""))
        && name.is_some_and(|value| !value.trim().is_empty())
        && phone.is_some_and(|value| !value.trim().is_empty())
}

fn is_guardian_or_parent_relation_type(value: &str) -> bool {
    matches!(value.trim(), "guardian" | "parent")
}

fn validate_relation_payload_fields(body: &UpsertRelationRequest) -> Result<(), &'static str> {
    if body.related_name.trim().is_empty() || body.related_name.trim().len() > 200 {
        return Err("Related name required (max 200)");
    }

    match body.relation_type.trim() {
        "spouse" | "parent" | "child" | "sibling" | "relative" | "guardian" | "caregiver"
        | "friend" | "other" => {}
        _ => return Err("Invalid relation type"),
    }

    Ok(())
}

fn generate_patient_id(seq: i64) -> String {
    let now = chrono::Utc::now();
    format!("P-{}-{:04}", now.format("%Y%m%d"), seq)
}

fn patient_label_format_json(format: PatientLabelFormat) -> Value {
    json!({
        "id": format.id,
        "label": format.label,
        "width_mm": format.width_mm,
        "height_mm": format.height_mm,
    })
}

#[allow(clippy::result_large_err)]
fn resolve_patient_label_format(
    requested: Option<&str>,
) -> Result<PatientLabelFormat, axum::response::Response> {
    let requested = requested.unwrap_or(PATIENT_LABEL_FORMATS[0].id);

    PATIENT_LABEL_FORMATS
        .iter()
        .copied()
        .find(|format| format.id == requested)
        .ok_or_else(|| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid patient label format",
            )
        })
}

fn normalize_setting_text_value(value: &str) -> Option<String> {
    let normalized = value.trim().trim_matches('"').trim();
    if normalized.is_empty() || normalized.eq_ignore_ascii_case("null") {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn money_json(value: rust_decimal::Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

pub(crate) fn patient_label_salutation(gender: &str) -> &'static str {
    match gender {
        "male" => "Herr",
        "female" => "Frau",
        "diverse" => "Div",
        _ => "",
    }
}

fn resolve_country_abbreviation(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_lowercase();
    if let Some(code) = match normalized.as_str() {
        "de" | "deu" | "germany" | "deutschland" => Some("DE"),
        "at" | "aut" | "austria" | "oesterreich" | "osterreich" | "österreich" => Some("AT"),
        "ch" | "che" | "switzerland" | "schweiz" | "suisse" => Some("CH"),
        "ua" | "ukr" | "ukraine" | "ukraina" => Some("UA"),
        "pl" | "pol" | "poland" | "polska" => Some("PL"),
        "tr" | "tur" | "turkey" | "turkiye" | "tuerkei" | "türkei" => Some("TR"),
        "fr" | "fra" | "france" => Some("FR"),
        "it" | "ita" | "italy" | "italia" => Some("IT"),
        "es" | "esp" | "spain" | "espana" | "españa" => Some("ES"),
        "nl" | "nld" | "netherlands" | "niederlande" => Some("NL"),
        "be" | "bel" | "belgium" | "belgien" => Some("BE"),
        "cz" | "cze" | "czechia" | "czech republic" | "tschechien" => Some("CZ"),
        "gb" | "gbr" | "uk" | "united kingdom" | "great britain" => Some("GB"),
        "us" | "usa" | "united states" | "united states of america" => Some("US"),
        _ => None,
    } {
        return Some(code.to_string());
    }

    let words = trimmed
        .split(|ch: char| !ch.is_alphabetic())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    if words.len() > 1 {
        let initials = words
            .iter()
            .filter_map(|word| word.chars().next())
            .take(3)
            .collect::<String>()
            .to_uppercase();
        if !initials.is_empty() {
            return Some(initials);
        }
    }

    let compact = trimmed
        .chars()
        .filter(|ch| ch.is_alphabetic())
        .take(3)
        .collect::<String>()
        .to_uppercase();
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

pub(crate) fn patient_label_country_code(
    nationality: Option<&str>,
    residence_country: Option<&str>,
) -> Option<String> {
    nationality
        .and_then(resolve_country_abbreviation)
        .or_else(|| residence_country.and_then(resolve_country_abbreviation))
}

pub(crate) async fn load_patient_label_agency_settings(
    state: &AppState,
) -> Result<PatientLabelAgencySettings, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT key, value::TEXT AS value_text
           FROM system_settings
           WHERE key IN (
               'agency_name',
               'agency_care_of',
               'agency_address',
               'agency_phone',
               'agency_email'
           )"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load patient label agency settings");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label settings",
        )
    })?;

    let mut values = HashMap::new();
    for row in rows {
        let key = row.try_get::<String, _>("key").map_err(|e| {
            tracing::error!(error = %e, "Failed to read patient label settings key");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient label settings",
            )
        })?;
        let value = row.try_get::<String, _>("value_text").map_err(|e| {
            tracing::error!(error = %e, "Failed to read patient label settings value");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient label settings",
            )
        })?;

        if let Some(value) = normalize_setting_text_value(&value) {
            values.insert(key, value);
        }
    }

    let name = values
        .get("agency_name")
        .cloned()
        .unwrap_or_else(|| "GMED".to_string());
    let care_of = values
        .get("agency_care_of")
        .cloned()
        .unwrap_or_else(|| format!("c/o {name}"));

    Ok(PatientLabelAgencySettings {
        name,
        care_of,
        address: values.get("agency_address").cloned(),
        phone: values.get("agency_phone").cloned(),
        email: values.get("agency_email").cloned(),
    })
}

async fn list_patients(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    let active_only = query.active_only.unwrap_or(true);
    let search = query.search.unwrap_or_default();
    let search_pattern = format!("%{search}%");
    let provider_id = query.provider_id;
    let doctor_id = query.doctor_id;

    let rows = sqlx::query(
        r#"SELECT p.id, p.patient_id, p.title, p.first_name, p.last_name,
                  p.birth_date, p.gender, p.nationality, p.residence_country,
                  p.languages, p.functional_labels, p.phone_primary, p.email,
                  p.insurance_provider, p.insurance_type,
                  p.is_active, p.created_at
           FROM patients p
           WHERE ($1::bool = false OR p.is_active = true)
             AND ($2::text = '%%' OR p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR p.patient_id ILIKE $2)
             AND (
                $3::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM appointments a
                    WHERE a.patient_id = p.id
                      AND a.provider_id = $3
                )
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    JOIN orders o ON o.id = ol.order_id
                    WHERE o.patient_id = p.id
                      AND ol.provider_id = $3
                )
             )
             AND (
                $4::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM appointments a
                    WHERE a.patient_id = p.id
                      AND a.doctor_id = $4
                )
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    JOIN orders o ON o.id = ol.order_id
                    WHERE o.patient_id = p.id
                      AND ol.doctor_id = $4
                )
             )
           ORDER BY p.created_at DESC
           LIMIT 100"#,
    )
    .bind(active_only)
    .bind(search_pattern)
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await;

    match rows {
        Ok(rows) => {
            let policies = load_patient_field_policies(&state, &auth).await?;
            let mut patients = Vec::with_capacity(rows.len());
            for r in rows {
                let patient_id: Uuid = r.try_get("id").map_err(|_| {
                    err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to decode patient",
                    )
                })?;

                if access::requires_patient_assignment(auth.role)
                    && !has_patient_access(&state, &auth, patient_id).await?
                {
                    continue;
                }

                patients.push(build_patient_summary_json(
                    &auth,
                    &policies,
                    PatientSummaryInput {
                        id: patient_id,
                        patient_id: r.try_get("patient_id").unwrap_or_default(),
                        title: r.try_get("title").unwrap_or_default(),
                        first_name: r.try_get("first_name").unwrap_or_default(),
                        last_name: r.try_get("last_name").unwrap_or_default(),
                        birth_date: r.try_get("birth_date").map_err(|_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        })?,
                        gender: r.try_get("gender").unwrap_or_default(),
                        nationality: r.try_get("nationality").unwrap_or_default(),
                        residence_country: r.try_get("residence_country").unwrap_or_default(),
                        languages: r.try_get("languages").unwrap_or_default(),
                        functional_labels: r.try_get("functional_labels").unwrap_or_default(),
                        phone_primary: r.try_get("phone_primary").unwrap_or_default(),
                        email: r.try_get("email").unwrap_or_default(),
                        insurance_provider: r.try_get("insurance_provider").unwrap_or_default(),
                        insurance_type: r.try_get("insurance_type").unwrap_or_default(),
                        is_active: r.try_get("is_active").unwrap_or(true),
                        created_at: r.try_get("created_at").map_err(|_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        })?,
                    },
                ));
            }
            Ok(Json(patients))
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to list patients");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list patients",
            ))
        }
    }
}

async fn get_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    match sqlx::query(
        r#"SELECT id, patient_id, title, first_name, last_name,
                  birth_date, gender, nationality, residence_country,
                  languages, functional_labels, phone_primary, phone_secondary, email,
                  address_street, address_city, address_zip, address_country,
                  insurance_provider, insurance_number, insurance_type,
                  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
                  legal_status, clinical_warnings, notes, is_active, created_at, updated_at
           FROM patients WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(r)) => {
            let patient_id = r.try_get::<Uuid, _>("id").map_err(|_| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode patient",
                )
            })?;
            if !has_patient_access(&state, &auth, patient_id).await? {
                return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
            }

            let policies = load_patient_field_policies(&state, &auth).await?;
            let patient_json = build_patient_detail_json(
                &auth,
                &policies,
                PatientDetailInput {
                    id: patient_id,
                    patient_id: r.try_get("patient_id").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    title: r.try_get("title").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    first_name: r.try_get("first_name").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    last_name: r.try_get("last_name").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    birth_date: r.try_get("birth_date").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    gender: r.try_get("gender").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    nationality: r.try_get("nationality").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    residence_country: r.try_get("residence_country").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    languages: r.try_get("languages").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    functional_labels: r.try_get("functional_labels").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    phone_primary: r.try_get("phone_primary").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    phone_secondary: r.try_get("phone_secondary").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    email: r.try_get("email").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    address_street: r.try_get("address_street").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    address_city: r.try_get("address_city").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    address_zip: r.try_get("address_zip").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    address_country: r.try_get("address_country").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    insurance_provider: r.try_get("insurance_provider").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    insurance_number: r.try_get("insurance_number").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    insurance_type: r.try_get("insurance_type").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    emergency_contact_name: r.try_get("emergency_contact_name").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    emergency_contact_phone: r.try_get("emergency_contact_phone").map_err(
                        |_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        },
                    )?,
                    emergency_contact_relation: r.try_get("emergency_contact_relation").map_err(
                        |_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        },
                    )?,
                    legal_status: r.try_get("legal_status").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    clinical_warnings: r.try_get("clinical_warnings").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    notes: r.try_get("notes").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    is_active: r.try_get("is_active").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    created_at: r.try_get("created_at").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    updated_at: r.try_get("updated_at").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                },
            );
            state.audit_sender.try_send(audit::domain_event(
                "view_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_uuid),
                json!({
                    "role": auth.role,
                    "visible_fields": collect_visible_fields(&patient_json),
                }),
            ));

            Ok(Json(patient_json))
        }
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Patient not found")),
        Err(e) => {
            tracing::error!(error = %e, "Failed to get patient");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to get patient",
            ))
        }
    }
}

async fn create_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreatePatientRequest>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if let Err(msg) = validate_create(&body) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, msg));
    }

    let CreatePatientRequest {
        title,
        first_name,
        last_name,
        birth_date,
        gender,
        nationality,
        residence_country,
        languages,
        functional_labels,
        phone_primary,
        phone_secondary,
        email,
        address_street,
        address_city,
        address_zip,
        address_country,
        insurance_provider,
        insurance_number,
        insurance_type,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relation,
        patient_relations,
        notes,
    } = body;

    let first_name = first_name.trim().to_string();
    let last_name = last_name.trim().to_string();
    let birth_date =
        chrono::NaiveDate::parse_from_str(birth_date.trim(), "%Y-%m-%d").map_err(|_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid birth_date format (YYYY-MM-DD)",
            )
        })?;

    let seq: i64 = sqlx::query_scalar!("SELECT nextval('patient_id_seq') AS \"val!\"")
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to get patient sequence");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient",
            )
        })?;

    let pid = generate_patient_id(seq);
    let nationality = normalize_patient_select_value(nationality);
    let residence_country = normalize_patient_select_value(residence_country);
    let address_country = normalize_patient_select_value(address_country);
    let langs = match normalize_patient_language_values(languages) {
        Ok(values) => values,
        Err(message) => return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message)),
    };
    let functional_labels = match normalize_functional_labels(functional_labels) {
        Ok(Some(labels)) => labels,
        Ok(None) => Vec::new(),
        Err(response) => return Err(response),
    };

    if let Some(relations) = patient_relations.as_ref() {
        for relation in relations {
            if let Some(related_patient_id) = relation.related_patient_id {
                ensure_related_patient_exists(&state, related_patient_id).await?;
            }
        }
    }

    let row = sqlx::query!(
        r#"INSERT INTO patients (
            patient_id, title, first_name, last_name, birth_date, gender,
            nationality, residence_country, languages, functional_labels,
            phone_primary, phone_secondary, email,
            address_street, address_city, address_zip, address_country,
            insurance_provider, insurance_number, insurance_type,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
            notes, created_by
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23, $24, $25
        ) RETURNING id, patient_id, created_at"#,
        pid,
        title,
        first_name,
        last_name,
        birth_date,
        gender,
        nationality,
        residence_country,
        &langs,
        &functional_labels,
        phone_primary,
        phone_secondary,
        email,
        address_street,
        address_city,
        address_zip,
        address_country,
        insurance_provider,
        insurance_number,
        insurance_type,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relation,
        notes,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to create patient");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create patient",
        )
    })?;

    if let Some(relations) = patient_relations {
        for relation in relations {
            sqlx::query(
                r#"INSERT INTO patient_relations (
                        patient_id, related_patient_id, related_name, relation_type,
                        is_emergency_contact, phone, notes
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
            )
            .bind(row.id)
            .bind(relation.related_patient_id)
            .bind(relation.related_name.trim())
            .bind(relation.relation_type.trim())
            .bind(relation.is_emergency_contact.unwrap_or(false))
            .bind(relation.phone.as_deref())
            .bind(relation.notes.as_deref())
            .execute(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %row.id, "Failed to create initial patient relation");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to create patient relation",
                )
            })?;
        }
    }

    sqlx::query!(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
        row.id,
        auth.user_id
    )
    .execute(&state.db)
    .await
    .ok();

    crate::routes::workflow_checklists::ensure_default_patient_workflow(
        &state,
        row.id,
        Some(auth.user_id),
    )
    .await?;

    state.audit_sender.try_send(audit::domain_event(
        "create_patient",
        Some(auth.user_id),
        "patient",
        Some(row.id),
        serde_json::json!({ "patient_id": row.patient_id }),
    ));

    tracing::info!(by = %auth.user_id, patient = %row.patient_id, "Patient created");

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.created",
        row.id,
        serde_json::json!({}),
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": row.id,
            "patient_id": row.patient_id,
            "created_at": row.created_at,
        })),
    ))
}

async fn update_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<UpdatePatientRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient",
            );
        }
    }

    let current = match sqlx::query(
        r#"SELECT title, first_name, last_name, phone_primary, phone_secondary, email,
                  birth_date, gender,
                  nationality, residence_country, languages, functional_labels,
                  address_street, address_city, address_zip, address_country,
                  insurance_provider, insurance_number, insurance_type,
                  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
                  notes
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, "DB error");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient",
            );
        }
    };

    let first = match body.first_name.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "first name required");
            }
            trimmed.to_string()
        }
        None => current.try_get("first_name").unwrap_or_default(),
    };
    let last = match body.last_name.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "last name required");
            }
            trimmed.to_string()
        }
        None => current.try_get("last_name").unwrap_or_default(),
    };
    let birth_date_supplied = body.birth_date.is_some();
    let birth_date: chrono::NaiveDate = match body.birth_date.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Birth date required");
            }
            match chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
                Ok(value) => value,
                Err(_) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid birth_date format (YYYY-MM-DD)",
                    );
                }
            }
        }
        None => current.try_get("birth_date").unwrap_or_default(),
    };
    let gender_supplied = body.gender.is_some();
    let gender = match body.gender.as_deref() {
        Some(value) => match value.trim() {
            "male" => "male".to_string(),
            "female" => "female".to_string(),
            "diverse" => "diverse".to_string(),
            _ => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Gender must be male, female, or diverse",
                );
            }
        },
        None => current.try_get("gender").unwrap_or_default(),
    };
    let nationality_supplied = body.nationality.is_some();
    let residence_country_supplied = body.residence_country.is_some();
    let address_country_supplied = body.address_country.is_some();
    let title = match normalize_patient_text_patch(
        body.title,
        current.try_get("title").unwrap_or_default(),
        "title",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let phone_primary = match normalize_patient_text_patch(
        body.phone_primary,
        current.try_get("phone_primary").unwrap_or_default(),
        "phone_primary",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let phone_secondary = match normalize_patient_text_patch(
        body.phone_secondary,
        current.try_get("phone_secondary").unwrap_or_default(),
        "phone_secondary",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let email = match normalize_patient_text_patch(
        body.email,
        current.try_get("email").unwrap_or_default(),
        "email",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let current_nationality: Option<String> = current.try_get("nationality").unwrap_or_default();
    let nationality = match normalize_patient_text_patch(
        body.nationality,
        current_nationality.clone(),
        "nationality",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if nationality_supplied
        && let Err(message) = validate_optional_patient_select_update(
            nationality.as_deref(),
            current_nationality.as_deref(),
            &ALLOWED_PATIENT_NATIONALITIES,
            "nationality",
        )
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let current_residence_country: Option<String> =
        current.try_get("residence_country").unwrap_or_default();
    let residence_country = match normalize_patient_text_patch(
        body.residence_country,
        current_residence_country.clone(),
        "residence_country",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if residence_country_supplied
        && let Err(message) = validate_optional_patient_select_update(
            residence_country.as_deref(),
            current_residence_country.as_deref(),
            &ALLOWED_PATIENT_COUNTRIES,
            "residence_country",
        )
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let address_street = match normalize_patient_text_patch(
        body.address_street,
        current.try_get("address_street").unwrap_or_default(),
        "address_street",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let address_city = match normalize_patient_text_patch(
        body.address_city,
        current.try_get("address_city").unwrap_or_default(),
        "address_city",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let address_zip = match normalize_patient_text_patch(
        body.address_zip,
        current.try_get("address_zip").unwrap_or_default(),
        "address_zip",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let current_address_country: Option<String> =
        current.try_get("address_country").unwrap_or_default();
    let address_country = match normalize_patient_text_patch(
        body.address_country,
        current_address_country.clone(),
        "address_country",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if address_country_supplied
        && let Err(message) = validate_optional_patient_select_update(
            address_country.as_deref(),
            current_address_country.as_deref(),
            &ALLOWED_PATIENT_COUNTRIES,
            "address_country",
        )
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let insurance_provider = match normalize_patient_text_patch(
        body.insurance_provider,
        current.try_get("insurance_provider").unwrap_or_default(),
        "insurance_provider",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let insurance_number = match normalize_patient_text_patch(
        body.insurance_number,
        current.try_get("insurance_number").unwrap_or_default(),
        "insurance_number",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let insurance_type = match normalize_patient_insurance_type_patch(
        body.insurance_type,
        current.try_get("insurance_type").unwrap_or_default(),
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let emergency_contact_name = match normalize_patient_text_patch(
        body.emergency_contact_name,
        current
            .try_get("emergency_contact_name")
            .unwrap_or_default(),
        "emergency_contact_name",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let emergency_contact_phone = match normalize_patient_text_patch(
        body.emergency_contact_phone,
        current
            .try_get("emergency_contact_phone")
            .unwrap_or_default(),
        "emergency_contact_phone",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let emergency_contact_relation = match normalize_patient_text_patch(
        body.emergency_contact_relation,
        current
            .try_get("emergency_contact_relation")
            .unwrap_or_default(),
        "emergency_contact_relation",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if is_minor_birth_date(birth_date, chrono::Utc::now().date_naive())
        && !has_guardian_or_parent_contact(
            emergency_contact_relation.as_deref(),
            emergency_contact_name.as_deref(),
            emergency_contact_phone.as_deref(),
        )
    {
        let has_existing_guardian_relation = match sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS (
                   SELECT 1
                   FROM patient_relations
                   WHERE patient_id = $1
                     AND relation_type IN ('guardian', 'parent')
                     AND btrim(related_name) <> ''
               )"#,
        )
        .bind(patient_uuid)
        .fetch_one(&state.db)
        .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(
                    error = %e,
                    patient_id = %patient_uuid,
                    "Failed to validate minor guardian relation"
                );
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate minor guardian relation",
                );
            }
        };

        if !has_existing_guardian_relation {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Minor patients require a guardian/parent relation or guardian emergency contact",
            );
        }
    }
    let notes = match normalize_patient_text_patch(
        body.notes,
        current.try_get("notes").unwrap_or_default(),
        "notes",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let current_languages: Vec<String> = current.try_get("languages").unwrap_or_default();
    let languages = if let Some(languages) = body.languages {
        match normalize_patient_language_values_for_update(languages, &current_languages) {
            Ok(values) => values,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        }
    } else {
        current_languages
    };
    let functional_labels_supplied = body.functional_labels.is_some();
    let functional_labels = match normalize_functional_labels(body.functional_labels) {
        Ok(Some(labels)) => labels,
        Ok(None) => current.try_get("functional_labels").unwrap_or_default(),
        Err(response) => return response,
    };
    let legal_status = match body.legal_status {
        Some(value) => match normalize_legal_status(value) {
            Ok(value) => Some(SqlxJson(value)),
            Err(response) => return response,
        },
        None => None,
    };
    let clinical_warnings_supplied = body.clinical_warnings.is_some();
    let clinical_warnings = match body.clinical_warnings {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.len() > 4000 {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "clinical_warnings too long",
                );
            }
            Some((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        None => None,
    };
    let legal_status_updated = legal_status.is_some();
    let clinical_warnings_updated = clinical_warnings_supplied;
    let functional_labels_updated = functional_labels_supplied;
    let birth_date_updated = birth_date_supplied;
    let gender_updated = gender_supplied;
    let contract_status = legal_status
        .as_ref()
        .and_then(|value| value.0.get("contract_status"))
        .cloned()
        .unwrap_or(Value::Null);
    let compliance_completed = legal_status
        .as_ref()
        .and_then(|value| value.0.get("compliance_completed").and_then(Value::as_bool))
        .unwrap_or(false);

    let result = sqlx::query(
        r#"UPDATE patients SET
            title = $2,
            first_name = $3, last_name = $4,
            birth_date = $5,
            gender = $6,
            phone_primary = $7,
            phone_secondary = $8,
            email = $9,
            nationality = $10,
            residence_country = $11,
            languages = $12,
            functional_labels = $13,
            address_street = $14,
            address_city = $15,
            address_zip = $16,
            address_country = $17,
            insurance_provider = $18,
            insurance_number = $19,
            insurance_type = $20,
            emergency_contact_name = $21,
            emergency_contact_phone = $22,
            emergency_contact_relation = $23,
            legal_status = COALESCE($24::jsonb, legal_status),
            notes = $25,
            clinical_warnings = CASE WHEN $26 THEN $27 ELSE clinical_warnings END,
            updated_at = now()
        WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .bind(title)
    .bind(&first)
    .bind(&last)
    .bind(birth_date)
    .bind(gender)
    .bind(phone_primary)
    .bind(phone_secondary)
    .bind(email)
    .bind(nationality)
    .bind(residence_country)
    .bind(languages)
    .bind(functional_labels)
    .bind(address_street)
    .bind(address_city)
    .bind(address_zip)
    .bind(address_country)
    .bind(insurance_provider)
    .bind(insurance_number)
    .bind(insurance_type)
    .bind(emergency_contact_name)
    .bind(emergency_contact_phone)
    .bind(emergency_contact_relation)
    .bind(legal_status)
    .bind(notes)
    .bind(clinical_warnings_supplied)
    .bind(clinical_warnings.flatten())
    .execute(&state.db)
    .await;

    let audit_context = serde_json::json!({
        "legal_status_updated": legal_status_updated,
        "clinical_warnings_updated": clinical_warnings_updated,
        "functional_labels_updated": functional_labels_updated,
        "birth_date_updated": birth_date_updated,
        "gender_updated": gender_updated,
        "contract_status": contract_status,
        "compliance_completed": compliance_completed,
    });

    match result {
        Ok(_) => {
            state.audit_sender.try_send(audit::domain_event(
                "update_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_uuid),
                audit_context,
            ));
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.updated",
                patient_uuid,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to update patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient",
            )
        }
    }
}

async fn list_patient_vitals(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT vm.id,
                  vm.measured_at,
                  vm.bp_systolic,
                  vm.bp_diastolic,
                  vm.heart_rate,
                  vm.weight_kg,
                  vm.height_cm,
                  vm.bmi,
                  vm.notes,
                  vm.recorded_by,
                  vm.created_at,
                  u.name AS recorded_by_name
           FROM patient_vital_measurements vm
           LEFT JOIN users u ON u.id = vm.recorded_by
           WHERE vm.patient_id = $1
           ORDER BY vm.measured_at DESC, vm.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient vitals");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient vitals",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "measured_at": row.get::<chrono::DateTime<chrono::Utc>, _>("measured_at").to_rfc3339(),
                "bp_systolic": row.get::<Option<f64>, _>("bp_systolic"),
                "bp_diastolic": row.get::<Option<f64>, _>("bp_diastolic"),
                "heart_rate": row.get::<Option<i32>, _>("heart_rate"),
                "weight_kg": row.get::<Option<f64>, _>("weight_kg"),
                "height_cm": row.get::<Option<f64>, _>("height_cm"),
                "bmi": row.get::<Option<f64>, _>("bmi"),
                "notes": row.get::<Option<String>, _>("notes"),
                "recorded_by": row.get::<Option<Uuid>, _>("recorded_by"),
                "recorded_by_name": row.get::<Option<String>, _>("recorded_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();
    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

async fn create_patient_vital_measurement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<CreatePatientVitalMeasurementRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record patient vitals",
            );
        }
    }

    let measured_at = match parse_vital_measurement_timestamp(&body.measured_at) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let bp_systolic = match validate_optional_positive_float("bp_systolic", body.bp_systolic) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let bp_diastolic = match validate_optional_positive_float("bp_diastolic", body.bp_diastolic) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let heart_rate = match validate_optional_positive_int("heart_rate", body.heart_rate) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let weight_kg = match validate_optional_positive_float("weight_kg", body.weight_kg) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let height_cm = match validate_optional_positive_float("height_cm", body.height_cm) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let provided_bmi = match validate_optional_positive_float("bmi", body.bmi) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let notes = match normalize_optional_text(body.notes, "notes", 2000) {
        Ok(value) => value,
        Err(response) => return response,
    };

    if bp_systolic.is_some() ^ bp_diastolic.is_some() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Both bp_systolic and bp_diastolic are required together",
        );
    }

    let bmi = provided_bmi.or_else(|| match (weight_kg, height_cm) {
        (Some(weight), Some(height_cm)) => {
            let height_m = height_cm / 100.0;
            if height_m > 0.0 {
                Some(((weight / (height_m * height_m)) * 10.0).round() / 10.0)
            } else {
                None
            }
        }
        _ => None,
    });

    if bp_systolic.is_none()
        && bp_diastolic.is_none()
        && heart_rate.is_none()
        && weight_kg.is_none()
        && height_cm.is_none()
        && bmi.is_none()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "At least one vital measurement is required",
        );
    }

    let row = match sqlx::query(
        r#"INSERT INTO patient_vital_measurements (
                patient_id, measured_at, bp_systolic, bp_diastolic, heart_rate,
                weight_kg, height_cm, bmi, notes, recorded_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(measured_at)
    .bind(bp_systolic)
    .bind(bp_diastolic)
    .bind(heart_rate)
    .bind(weight_kg)
    .bind(height_cm)
    .bind(bmi)
    .bind(notes.clone())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to record patient vitals");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record patient vitals",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "record_patient_vitals",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "measurement_id": row.get::<Uuid, _>("id"),
            "measured_at": measured_at.to_rfc3339(),
            "has_blood_pressure": bp_systolic.is_some(),
            "has_heart_rate": heart_rate.is_some(),
            "has_weight": weight_kg.is_some(),
            "has_height": height_cm.is_some(),
            "has_notes": notes.is_some(),
        }),
    ));

    Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

async fn list_patient_card_entries(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT e.id,
                  e.entry_date,
                  e.category,
                  e.source,
                  e.content,
                  e.author_id,
                  e.created_at,
                  e.updated_at,
                  u.name AS author_name
           FROM patient_card_entries e
           LEFT JOIN users u ON u.id = e.author_id
           WHERE e.patient_id = $1
           ORDER BY e.entry_date DESC, e.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient card entries");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient card entries",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "entry_date": row.get::<chrono::DateTime<chrono::Utc>, _>("entry_date").to_rfc3339(),
                "category": row.get::<String, _>("category"),
                "source": row.get::<Option<String>, _>("source"),
                "content": row.get::<String, _>("content"),
                "author_id": row.get::<Uuid, _>("author_id"),
                "author_name": row.get::<Option<String>, _>("author_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
                "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();

    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

async fn create_patient_card_entry(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<CreatePatientCardEntryRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient card entry",
            );
        }
    }

    let entry_date = match parse_vital_measurement_timestamp(&body.entry_date) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let category = body.category.trim().to_lowercase();
    if !PATIENT_CARD_ENTRY_CATEGORIES.contains(&category.as_str()) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient card entry category",
        );
    }
    let source = match normalize_optional_text(body.source, "source", 120) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let content = body.content.trim();
    if content.is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "content required");
    }
    if content.len() > 4000 {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "content too long");
    }

    let row = match sqlx::query(
        r#"INSERT INTO patient_card_entries (
                patient_id, entry_date, category, source, content, author_id
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(entry_date)
    .bind(category.as_str())
    .bind(source.clone())
    .bind(content)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient card entry");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient card entry",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_card_entry",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "entry_id": row.get::<Uuid, _>("id"),
            "entry_date": entry_date.to_rfc3339(),
            "category": category,
            "source": source,
        }),
    ));

    Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

async fn list_patient_medical_orders(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT mo.id,
                  mo.order_date,
                  mo.order_type,
                  mo.title,
                  mo.instructions,
                  mo.status,
                  mo.due_date,
                  mo.source,
                  mo.ordered_by,
                  mo.created_at,
                  mo.updated_at,
                  u.name AS ordered_by_name
           FROM patient_medical_orders mo
           LEFT JOIN users u ON u.id = mo.ordered_by
           WHERE mo.patient_id = $1
           ORDER BY mo.order_date DESC, mo.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient medical orders");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient medical orders",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "order_date": row.get::<chrono::DateTime<chrono::Utc>, _>("order_date").to_rfc3339(),
                "order_type": row.get::<String, _>("order_type"),
                "title": row.get::<String, _>("title"),
                "instructions": row.get::<String, _>("instructions"),
                "status": row.get::<String, _>("status"),
                "due_date": row.get::<Option<chrono::NaiveDate>, _>("due_date").map(|value| value.to_string()),
                "source": row.get::<Option<String>, _>("source"),
                "ordered_by": row.get::<Uuid, _>("ordered_by"),
                "ordered_by_name": row.get::<Option<String>, _>("ordered_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
                "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();

    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

async fn create_patient_medical_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<CreatePatientMedicalOrderRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient medical order",
            );
        }
    }

    let order_date = match parse_vital_measurement_timestamp(&body.order_date) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let order_type = match validate_patient_medical_order_type(&body.order_type) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let title = match normalize_required_text(&body.title, "title", 160) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let instructions = match normalize_required_text(&body.instructions, "instructions", 4000) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let due_date = match parse_optional_naive_date(body.due_date, "due_date") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let source = match normalize_optional_text(body.source, "source", 120) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let row = match sqlx::query(
        r#"INSERT INTO patient_medical_orders (
                patient_id, order_date, order_type, title, instructions,
                status, due_date, source, ordered_by
           ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(order_date)
    .bind(order_type.as_str())
    .bind(title.as_str())
    .bind(instructions.as_str())
    .bind(due_date)
    .bind(source.clone())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient medical order");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient medical order",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_medical_order",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "order_id": row.get::<Uuid, _>("id"),
            "order_date": order_date.to_rfc3339(),
            "order_type": order_type,
            "status": "active",
            "due_date": due_date.map(|value| value.to_string()),
            "source": source,
        }),
    ));

    Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

async fn update_patient_medical_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, medical_order_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdatePatientMedicalOrderRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient medical order",
            );
        }
    }

    let current = match sqlx::query(
        r#"SELECT order_date, order_type, title, instructions, status, due_date, source
           FROM patient_medical_orders
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(medical_order_id)
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Medical order not found"),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, order_id = %medical_order_id, "Failed to load patient medical order");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient medical order",
            );
        }
    };

    let order_date = match body.order_date {
        Some(value) => match parse_vital_measurement_timestamp(&value) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<chrono::DateTime<chrono::Utc>, _>("order_date"),
    };

    let order_type = match body.order_type {
        Some(value) => match validate_patient_medical_order_type(&value) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("order_type"),
    };

    let title = match body.title {
        Some(value) => match normalize_required_text(&value, "title", 160) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("title"),
    };

    let instructions = match body.instructions {
        Some(value) => match normalize_required_text(&value, "instructions", 4000) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("instructions"),
    };

    let status = match body.status {
        Some(value) => match validate_patient_medical_order_status(&value) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("status"),
    };

    let due_date = match parse_optional_patch_naive_date(body.due_date, "due_date") {
        Ok(Some(value)) => value,
        Ok(None) => current.get::<Option<chrono::NaiveDate>, _>("due_date"),
        Err(response) => return response,
    };

    let source = if body.source.is_some() {
        match normalize_optional_text(body.source, "source", 120) {
            Ok(value) => value,
            Err(response) => return response,
        }
    } else {
        current.get::<Option<String>, _>("source")
    };

    match sqlx::query(
        r#"UPDATE patient_medical_orders
           SET order_date = $3,
               order_type = $4,
               title = $5,
               instructions = $6,
               status = $7,
               due_date = $8,
               source = $9
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(medical_order_id)
    .bind(patient_uuid)
    .bind(order_date)
    .bind(order_type.as_str())
    .bind(title.as_str())
    .bind(instructions.as_str())
    .bind(status.as_str())
    .bind(due_date)
    .bind(source.clone())
    .execute(&state.db)
    .await
    {
        Ok(_) => {}
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, order_id = %medical_order_id, "Failed to update patient medical order");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient medical order",
            );
        }
    }

    state.audit_sender.try_send(audit::domain_event(
        "update_patient_medical_order",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "order_id": medical_order_id,
            "order_date": order_date.to_rfc3339(),
            "order_type": order_type,
            "status": status,
            "due_date": due_date.map(|value| value.to_string()),
            "source": source,
        }),
    ));

    Json(json!({ "ok": true })).into_response()
}

async fn list_patient_risk_scores(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT rs.id,
                  rs.computed_at,
                  rs.score_type,
                  rs.score_value,
                  rs.scale_max,
                  rs.interpretation,
                  rs.source,
                  rs.inputs,
                  rs.recorded_by,
                  rs.created_at,
                  u.name AS recorded_by_name
           FROM patient_risk_scores rs
           LEFT JOIN users u ON u.id = rs.recorded_by
           WHERE rs.patient_id = $1
           ORDER BY rs.computed_at DESC, rs.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient risk scores");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient risk scores",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "computed_at": row.get::<chrono::DateTime<chrono::Utc>, _>("computed_at").to_rfc3339(),
                "score_type": row.get::<String, _>("score_type"),
                "score_value": row.get::<f64, _>("score_value"),
                "scale_max": row.get::<Option<f64>, _>("scale_max"),
                "interpretation": row.get::<Option<String>, _>("interpretation"),
                "source": row.get::<Option<String>, _>("source"),
                "inputs": row.get::<Option<SqlxJson<Value>>, _>("inputs").map(|value| value.0),
                "recorded_by": row.get::<Uuid, _>("recorded_by"),
                "recorded_by_name": row.get::<Option<String>, _>("recorded_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();

    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

async fn create_patient_risk_score(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<CreatePatientRiskScoreRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient risk score",
            );
        }
    }

    let computed_at = match parse_vital_measurement_timestamp(&body.computed_at) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let score_type = match validate_patient_risk_score_type(&body.score_type) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let score_value = match validate_nonnegative_float("score_value", body.score_value) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let scale_max = match validate_optional_positive_float("scale_max", body.scale_max) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Some(max) = scale_max
        && score_value > max
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "score_value cannot exceed scale_max",
        );
    }
    let interpretation = match normalize_optional_text(body.interpretation, "interpretation", 500) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let source = match normalize_optional_text(body.source, "source", 120) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let inputs = match normalize_optional_json_object(body.inputs, "inputs") {
        Ok(value) => value,
        Err(response) => return response,
    };

    let row = match sqlx::query(
        r#"INSERT INTO patient_risk_scores (
                patient_id, computed_at, score_type, score_value, scale_max,
                interpretation, source, inputs, recorded_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(computed_at)
    .bind(score_type.as_str())
    .bind(score_value)
    .bind(scale_max)
    .bind(interpretation.clone())
    .bind(source.clone())
    .bind(inputs.as_ref().map(|value| SqlxJson(value.clone())))
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient risk score");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient risk score",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "record_patient_risk_score",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "risk_score_id": row.get::<Uuid, _>("id"),
            "computed_at": computed_at.to_rfc3339(),
            "score_type": score_type,
            "score_value": score_value,
            "scale_max": scale_max,
            "source": source,
            "has_inputs": inputs.is_some(),
        }),
    ));

    Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

#[allow(clippy::result_large_err)]
fn parse_vital_measurement_timestamp(
    value: &str,
) -> Result<chrono::DateTime<chrono::Utc>, axum::response::Response> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "measured_at required",
        ));
    }

    chrono::DateTime::parse_from_rfc3339(trimmed)
        .map(|value| value.with_timezone(&chrono::Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M")
                .map(|value| value.and_utc())
        })
        .map_err(|_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid measured_at format",
            )
        })
}

#[allow(clippy::result_large_err)]
fn validate_optional_positive_float(
    field_name: &str,
    value: Option<f64>,
) -> Result<Option<f64>, axum::response::Response> {
    match value {
        Some(value) if !value.is_finite() || value <= 0.0 => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a positive number"),
        )),
        other => Ok(other),
    }
}

#[allow(clippy::result_large_err)]
fn validate_optional_positive_int(
    field_name: &str,
    value: Option<i32>,
) -> Result<Option<i32>, axum::response::Response> {
    match value {
        Some(value) if value <= 0 => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a positive integer"),
        )),
        other => Ok(other),
    }
}

#[allow(clippy::result_large_err)]
fn validate_nonnegative_float(
    field_name: &str,
    value: f64,
) -> Result<f64, axum::response::Response> {
    if !value.is_finite() || value < 0.0 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a non-negative number"),
        ));
    }
    Ok(value)
}

#[allow(clippy::result_large_err)]
fn normalize_optional_text(
    value: Option<String>,
    field_name: &str,
    max_len: usize,
) -> Result<Option<String>, axum::response::Response> {
    match value {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.len() > max_len {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    &format!("{field_name} too long"),
                ));
            }
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_patient_text_patch(
    value: Option<Value>,
    current: Option<String>,
    field_name: &str,
) -> Result<Option<String>, axum::response::Response> {
    match value {
        None => Ok(current),
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a string or null"),
        )),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_patient_insurance_type_patch(
    value: Option<Value>,
    current: Option<String>,
) -> Result<Option<String>, axum::response::Response> {
    let normalized = normalize_patient_text_patch(value, current, "insurance_type")?;
    if let Some(ref insurance_type) = normalized {
        match insurance_type.as_str() {
            "private" | "public" | "self_pay" | "foreign" => {}
            _ => {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid insurance type",
                ));
            }
        }
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn normalize_optional_json_object(
    value: Option<Value>,
    field_name: &str,
) -> Result<Option<Value>, axum::response::Response> {
    match value {
        Some(Value::Object(map)) => Ok(Some(Value::Object(map))),
        Some(Value::Null) => Ok(None),
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a JSON object"),
        )),
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_required_text(
    value: &str,
    field_name: &str,
    max_len: usize,
) -> Result<String, axum::response::Response> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} required"),
        ));
    }
    if trimmed.len() > max_len {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} too long"),
        ));
    }
    Ok(trimmed.to_string())
}

#[allow(clippy::result_large_err)]
fn parse_optional_naive_date(
    value: Option<String>,
    field_name: &str,
) -> Result<Option<chrono::NaiveDate>, axum::response::Response> {
    match value {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                .map(Some)
                .map_err(|_| {
                    err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        &format!("Invalid {field_name} format"),
                    )
                })
        }
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn parse_optional_patch_naive_date(
    value: Option<String>,
    field_name: &str,
) -> Result<Option<Option<chrono::NaiveDate>>, axum::response::Response> {
    match value {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(Some(None));
            }
            chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                .map(|parsed| Some(Some(parsed)))
                .map_err(|_| {
                    err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        &format!("Invalid {field_name} format"),
                    )
                })
        }
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn validate_patient_medical_order_type(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();
    if !PATIENT_MEDICAL_ORDER_TYPES.contains(&normalized.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient medical order type",
        ));
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn validate_patient_medical_order_status(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();
    if !PATIENT_MEDICAL_ORDER_STATUSES.contains(&normalized.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient medical order status",
        ));
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn validate_patient_risk_score_type(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();
    if !PATIENT_RISK_SCORE_TYPES.contains(&normalized.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient risk score type",
        ));
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn normalize_legal_status(value: Value) -> Result<Value, axum::response::Response> {
    let Value::Object(map) = value else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "legal_status must be an object",
        ));
    };

    let dsgvo_signed = extract_bool_field(&map, "dsgvo_signed")?;
    let confidentiality_release_signed =
        extract_bool_field(&map, "confidentiality_release_signed")?;
    let identity_verified = extract_bool_field(&map, "identity_verified")?;
    let document_pack_complete = extract_bool_field(&map, "document_pack_complete")?;
    let compliance_completed = extract_bool_field(&map, "compliance_completed")?;
    let contract_status = extract_optional_string_field(&map, "contract_status", 100)?;
    let notes = extract_optional_string_field(&map, "notes", 2000)?;

    if let Some(ref status) = contract_status {
        match status.as_str() {
            "not_started" | "pending" | "sent" | "signed" | "expired" | "terminated" => {}
            _ => {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid contract_status",
                ));
            }
        }
    }

    Ok(json!({
        "dsgvo_signed": dsgvo_signed,
        "confidentiality_release_signed": confidentiality_release_signed,
        "identity_verified": identity_verified,
        "document_pack_complete": document_pack_complete,
        "compliance_completed": compliance_completed,
        "contract_status": contract_status,
        "notes": notes,
    }))
}

#[allow(clippy::result_large_err)]
fn extract_bool_field(
    map: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<bool, axum::response::Response> {
    match map.get(key) {
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{key} must be a boolean"),
        )),
        None => Ok(false),
    }
}

#[allow(clippy::result_large_err)]
fn extract_optional_string_field(
    map: &serde_json::Map<String, Value>,
    key: &str,
    max_len: usize,
) -> Result<Option<String>, axum::response::Response> {
    match map.get(key) {
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.len() > max_len {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    &format!("{key} too long"),
                ));
            }
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Some(Value::Null) | None => Ok(None),
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{key} must be a string"),
        )),
    }
}

async fn list_assignments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? && auth.role != Role::Ceo {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT pa.user_id, pa.assigned_at, pa.revoked_at,
                  u.name AS user_name, u.role AS user_role, u.is_active,
                  pa.assigned_by, assigned_by_user.name AS assigned_by_name
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           LEFT JOIN users assigned_by_user ON assigned_by_user.id = pa.assigned_by
           WHERE pa.patient_id = $1
           ORDER BY pa.revoked_at NULLS FIRST, pa.assigned_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list assignments");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient assignments",
        )
    })?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(serde_json::json!({
            "user_id": row.try_get::<Uuid, _>("user_id").unwrap_or_else(|_| Uuid::nil()),
            "user_name": row.try_get::<String, _>("user_name").unwrap_or_default(),
            "user_role": row.try_get::<String, _>("user_role").unwrap_or_default(),
            "user_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
            "assigned_by": row.try_get::<Uuid, _>("assigned_by").unwrap_or_else(|_| Uuid::nil()),
            "assigned_by_name": row.try_get::<Option<String>, _>("assigned_by_name").unwrap_or_default(),
            "assigned_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("assigned_at")
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
            "revoked_at": row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")
                .unwrap_or_default()
                .map(|value| value.to_rfc3339()),
        }));
    }

    Ok(Json(items))
}

async fn list_patient_cases(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT id, case_id, status, hauptanfragegrund, created_at
           FROM cases
           WHERE patient_id = $1
           ORDER BY created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient cases");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient cases",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "case_id": row.try_get::<String, _>("case_id").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "hauptanfragegrund": row.try_get::<Option<String>, _>("hauptanfragegrund").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn list_patient_orders(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT id, order_number, phase, status, needs_description, created_at
           FROM orders
           WHERE patient_id = $1
           ORDER BY created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient orders");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient orders",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                "phase": row.try_get::<String, _>("phase").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "needs_description": row.try_get::<Option<String>, _>("needs_description").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn list_patient_appointments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.appointment_type, a.care_path_kind, a.status,
                  p.name AS provider_name, d.name AS doctor_name
           FROM appointments a
           LEFT JOIN providers p ON p.id = a.provider_id
           LEFT JOIN provider_doctors d ON d.id = a.doctor_id
           WHERE a.patient_id = $1
           ORDER BY a.date DESC, a.time_start DESC NULLS LAST, a.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient appointments");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient appointments",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "date": row.try_get::<chrono::NaiveDate, _>("date").map(|value| value.to_string()).unwrap_or_default(),
                "time_start": row.try_get::<Option<chrono::NaiveTime>, _>("time_start").unwrap_or_default().map(|value| value.format("%H:%M").to_string()),
                "apt_type": row.try_get::<String, _>("appointment_type").unwrap_or_default(),
                "care_path_kind": row.try_get::<String, _>("care_path_kind").unwrap_or_else(|_| "regular".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn list_patient_documents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT d.id,
                  COALESCE(d.original_filename, d.auto_name, 'Document') AS filename,
                  COALESCE(d.category, d.art) AS category,
                  d.status,
                  u.name AS uploaded_by_name,
                  d.created_at
           FROM documents d
           LEFT JOIN users u ON u.id = d.uploaded_by
           WHERE d.patient_id = $1
           ORDER BY d.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient documents");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient documents",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "filename": row.try_get::<String, _>("filename").unwrap_or_default(),
                "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "uploaded_by_name": row.try_get::<Option<String>, _>("uploaded_by_name").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

#[allow(clippy::result_large_err)]
fn parse_required_patient_document_rules(
    value: &Value,
) -> Result<Vec<RequiredPatientDocumentRule>, axum::response::Response> {
    let items = value.as_array().ok_or_else(|| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Required patient document settings are invalid",
        )
    })?;

    let mut rules = Vec::with_capacity(items.len());
    for item in items {
        let object = item.as_object().ok_or_else(|| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Required patient document settings are invalid",
            )
        })?;

        let key = object
            .get("key")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Required patient document settings are invalid",
                )
            })?
            .to_string();
        let label = object
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Required patient document settings are invalid",
                )
            })?
            .to_string();

        let collect_values = |field: &str| -> Result<Vec<String>, axum::response::Response> {
            object
                .get(field)
                .map(|value| {
                    value
                        .as_array()
                        .ok_or_else(|| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Required patient document settings are invalid",
                            )
                        })?
                        .iter()
                        .map(|item| {
                            item.as_str()
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(ToOwned::to_owned)
                                .ok_or_else(|| {
                                    err(
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        "Required patient document settings are invalid",
                                    )
                                })
                        })
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()
                .map(|value| value.unwrap_or_default())
        };

        rules.push(RequiredPatientDocumentRule {
            key,
            label,
            art: collect_values("art")?,
            category: collect_values("category")?,
        });
    }

    Ok(rules)
}

async fn load_required_patient_document_rules(
    state: &AppState,
) -> Result<Vec<RequiredPatientDocumentRule>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT value
           FROM system_settings
           WHERE key = 'required_patient_documents'"#,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load required patient documents setting");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load required patient document settings",
        )
    })?;

    let Some(row) = row else {
        return Ok(Vec::new());
    };

    let value = row.try_get::<Value, _>("value").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Required patient document settings are invalid",
        )
    })?;

    parse_required_patient_document_rules(&value)
}

pub(crate) async fn load_patient_document_alerts_summary(
    state: &AppState,
    patient_uuid: Uuid,
) -> Result<PatientDocumentAlertsSummary, axum::response::Response> {
    let rules = load_required_patient_document_rules(state).await?;

    let patient_row = sqlx::query(
        r#"SELECT legal_status
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient legal status for document alerts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient document alerts",
        )
    })?;

    let Some(patient_row) = patient_row else {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    };

    let stored_document_pack_complete = patient_row
        .try_get::<Value, _>("legal_status")
        .ok()
        .and_then(|value| value.get("document_pack_complete").and_then(Value::as_bool))
        .unwrap_or(false);

    let document_rows = sqlx::query(
        r#"SELECT d.id,
                  COALESCE(d.original_filename, d.auto_name, 'Document') AS filename,
                  d.art,
                  d.category,
                  d.status
           FROM documents d
           WHERE d.patient_id = $1
             AND d.status IN ('draft', 'active')
           ORDER BY d.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient documents for alerts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient document alerts",
        )
    })?;

    let mut evaluated_rules = Vec::with_capacity(rules.len());
    let mut missing_documents = Vec::new();
    for rule in &rules {
        let mut matching_documents = Vec::new();

        for row in &document_rows {
            let art = row
                .try_get::<String, _>("art")
                .unwrap_or_default()
                .trim()
                .to_lowercase()
                .replace([' ', '-'], "_");
            let category = row
                .try_get::<Option<String>, _>("category")
                .unwrap_or_default()
                .unwrap_or_default()
                .trim()
                .to_lowercase()
                .replace([' ', '-'], "_");

            let matches_art = !rule.art.is_empty() && rule.art.iter().any(|value| value == &art);
            let matches_category = !rule.category.is_empty()
                && !category.is_empty()
                && rule.category.iter().any(|value| value == &category);

            if matches_art || matches_category {
                matching_documents.push(json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                    "filename": row.try_get::<String, _>("filename").unwrap_or_default(),
                    "art": row.try_get::<String, _>("art").unwrap_or_default(),
                    "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                }));
            }
        }

        let fulfilled = !matching_documents.is_empty();
        if !fulfilled {
            missing_documents.push(json!({
                "key": rule.key,
                "label": rule.label,
            }));
        }

        evaluated_rules.push(json!({
            "key": rule.key,
            "label": rule.label,
            "fulfilled": fulfilled,
            "matching_documents": matching_documents,
        }));
    }

    let missing_count = missing_documents.len();
    let document_pack_complete = missing_count == 0;

    Ok(PatientDocumentAlertsSummary {
        configured_rule_count: rules.len(),
        document_pack_complete,
        stored_document_pack_complete,
        out_of_sync: stored_document_pack_complete != document_pack_complete,
        required_documents: evaluated_rules,
        missing_documents,
        missing_count,
    })
}

pub(crate) fn patient_document_alerts_payload(summary: &PatientDocumentAlertsSummary) -> Value {
    json!({
        "configured_rule_count": summary.configured_rule_count,
        "document_pack_complete": summary.document_pack_complete,
        "stored_document_pack_complete": summary.stored_document_pack_complete,
        "out_of_sync": summary.out_of_sync,
        "required_documents": summary.required_documents,
        "missing_documents": summary.missing_documents,
        "missing_count": summary.missing_count,
    })
}

pub(crate) async fn load_patient_recheck_readiness(
    state: &AppState,
    patient_uuid: Uuid,
) -> Result<Option<PatientRecheckReadiness>, axum::response::Response> {
    let patient_row = sqlx::query(
        r#"SELECT id,
                  patient_id,
                  first_name,
                  last_name,
                  birth_date,
                  gender,
                  residence_country,
                  address_country,
                  languages,
                  phone_primary,
                  email,
                  legal_status
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient re-check context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient re-check",
        )
    })?;

    let Some(patient_row) = patient_row else {
        return Ok(None);
    };

    let patient_pid = patient_row
        .try_get::<String, _>("patient_id")
        .unwrap_or_default();
    let first_name = patient_row
        .try_get::<String, _>("first_name")
        .unwrap_or_default();
    let last_name = patient_row
        .try_get::<String, _>("last_name")
        .unwrap_or_default();
    let birth_date = patient_row
        .try_get::<chrono::NaiveDate, _>("birth_date")
        .ok()
        .map(|value| value.to_string());
    let gender = patient_row
        .try_get::<String, _>("gender")
        .unwrap_or_default();
    let residence_country = patient_row
        .try_get::<Option<String>, _>("residence_country")
        .unwrap_or_default();
    let address_country = patient_row
        .try_get::<Option<String>, _>("address_country")
        .unwrap_or_default();
    let languages = patient_row
        .try_get::<Vec<String>, _>("languages")
        .unwrap_or_default();
    let phone_primary = patient_row
        .try_get::<Option<String>, _>("phone_primary")
        .unwrap_or_default();
    let email = patient_row
        .try_get::<Option<String>, _>("email")
        .unwrap_or_default();
    let legal_status = patient_row
        .try_get::<Value, _>("legal_status")
        .unwrap_or_else(|_| json!({}));
    let patient_name = format!("{first_name} {last_name}").trim().to_string();

    let existing_context = sqlx::query(
        r#"SELECT EXISTS(SELECT 1 FROM orders WHERE patient_id = $1) AS has_orders,
                  EXISTS(SELECT 1 FROM cases WHERE patient_id = $1) AS has_cases,
                  EXISTS(SELECT 1 FROM appointments WHERE patient_id = $1) AS has_appointments,
                  EXISTS(SELECT 1 FROM framework_contracts WHERE patient_id = $1) AS has_contracts,
                  EXISTS(SELECT 1 FROM invoices WHERE patient_id = $1) AS has_invoices"#,
    )
    .bind(patient_uuid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load existing customer context for re-check");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient re-check",
        )
    })?;
    let requires_recheck = existing_context
        .try_get::<bool, _>("has_orders")
        .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_cases")
            .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_appointments")
            .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_contracts")
            .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_invoices")
            .unwrap_or(false);

    if !requires_recheck {
        return Ok(Some(PatientRecheckReadiness {
            can_create_order: true,
            blocking_reasons: Vec::new(),
            payload: json!({
                "requires_recheck": false,
                "can_create_order": true,
                "base_data_ready": true,
                "compliance_ready": true,
                "identity_ready": true,
                "document_pack_ready": true,
                "contract_ready": true,
                "debt_hold": false,
                "overdue_invoice_count": 0,
                "base_data_missing_fields": [],
                "blocking_reasons": [],
                "checks": [],
                "reason": "Existing-customer re-check is not required before the first operational order",
                "patient": {
                    "id": patient_uuid,
                    "patient_id": patient_pid,
                    "name": patient_name,
                    "birth_date": birth_date,
                    "gender": gender,
                    "phone_primary": phone_primary,
                    "email": email,
                    "residence_country": residence_country,
                    "address_country": address_country,
                    "languages": languages,
                },
                "legal_status": legal_status,
                "document_alerts": {
                    "configured_rule_count": 0,
                    "document_pack_complete": true,
                    "stored_document_pack_complete": true,
                    "out_of_sync": false,
                    "required_documents": [],
                    "missing_documents": [],
                    "missing_count": 0,
                },
                "latest_framework_contract": Value::Null,
            }),
        }));
    }

    let primary_contact_present = phone_primary
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || email
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    let country_present = residence_country
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || address_country
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    let language_present = !languages.is_empty();
    let base_data_ready = primary_contact_present && country_present && language_present;

    let dsgvo_signed = legal_status
        .get("dsgvo_signed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let identity_verified = legal_status
        .get("identity_verified")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let compliance_completed = legal_status
        .get("compliance_completed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let stored_contract_status = legal_status
        .get("contract_status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let compliance_ready = compliance_completed && dsgvo_signed;

    let document_alerts = load_patient_document_alerts_summary(state, patient_uuid).await?;
    let document_pack_ready = document_alerts.document_pack_complete;

    let contract_rows = sqlx::query(
        r#"SELECT id,
                  contract_number,
                  status,
                  signed_at,
                  valid_from,
                  valid_to,
                  created_at
           FROM framework_contracts
           WHERE patient_id = $1
           ORDER BY COALESCE(valid_to, 'infinity'::date) DESC,
                    COALESCE(signed_at, created_at) DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load framework contracts for re-check");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient re-check",
        )
    })?;

    let today = chrono::Utc::now().date_naive();
    let latest_framework_contract = contract_rows.first().map(|row| {
        json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "signed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "valid_from": row.try_get::<Option<chrono::NaiveDate>, _>("valid_from").unwrap_or_default().map(|value| value.to_string()),
            "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
        })
    });
    let valid_framework_contract = contract_rows.iter().any(|row| {
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let valid_from = row
            .try_get::<Option<chrono::NaiveDate>, _>("valid_from")
            .unwrap_or_default();
        let valid_to = row
            .try_get::<Option<chrono::NaiveDate>, _>("valid_to")
            .unwrap_or_default();
        status == "signed"
            && valid_from.map(|value| value <= today).unwrap_or(true)
            && valid_to.map(|value| value >= today).unwrap_or(true)
    });

    let contract_ready = stored_contract_status == "signed" || valid_framework_contract;

    let debt_management =
        crate::routes::debt_management::load_patient_debt_management_state(state, patient_uuid)
            .await?;
    let overdue_invoice_count = debt_management.overdue_invoice_count;
    let debt_hold = debt_management.blocking;

    let mut base_data_missing_fields = Vec::new();
    if !primary_contact_present {
        base_data_missing_fields.push("primary_contact".to_string());
    }
    if !country_present {
        base_data_missing_fields.push("country".to_string());
    }
    if !language_present {
        base_data_missing_fields.push("language".to_string());
    }

    let checks = vec![
        json!({
            "key": "base_data",
            "label": "Base data valid",
            "passed": base_data_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "compliance",
            "label": "Compliance documents valid",
            "passed": compliance_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "identity",
            "label": "Identity verified",
            "passed": identity_verified,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "document_pack",
            "label": "Required patient documents complete",
            "passed": document_pack_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "contract",
            "label": "Contract documents valid",
            "passed": contract_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "debt_clear",
            "label": "Debt-management hold cleared",
            "passed": !debt_hold,
            "blocking_for": "create_order",
        }),
    ];

    let mut blocking_reasons = Vec::new();
    if !base_data_ready {
        if !primary_contact_present {
            blocking_reasons.push("Primary contact is missing".to_string());
        }
        if !country_present {
            blocking_reasons.push("Residence or address country is missing".to_string());
        }
        if !language_present {
            blocking_reasons.push("Preferred language is missing".to_string());
        }
    }
    if !compliance_ready {
        if !compliance_completed {
            blocking_reasons.push("Compliance status is not completed".to_string());
        }
        if !dsgvo_signed {
            blocking_reasons.push("DSGVO/compliance documents are not signed".to_string());
        }
    }
    if !identity_verified {
        blocking_reasons.push("Identity is not verified".to_string());
    }
    if !document_pack_ready {
        blocking_reasons.push(format!(
            "{} required patient document(s) are missing",
            document_alerts.missing_count
        ));
    }
    if !contract_ready {
        blocking_reasons.push("Valid contract documentation is missing".to_string());
    }
    if debt_hold {
        blocking_reasons.push(
            debt_management
                .blocking_reason
                .clone()
                .unwrap_or_else(|| "Patient is still in debt-management hold".to_string()),
        );
    }

    let can_create_order = blocking_reasons.is_empty();

    Ok(Some(PatientRecheckReadiness {
        can_create_order,
        blocking_reasons: blocking_reasons.clone(),
        payload: json!({
            "requires_recheck": true,
            "can_create_order": can_create_order,
            "base_data_ready": base_data_ready,
            "compliance_ready": compliance_ready,
            "identity_ready": identity_verified,
            "document_pack_ready": document_pack_ready,
            "contract_ready": contract_ready,
            "debt_hold": debt_hold,
            "overdue_invoice_count": overdue_invoice_count,
            "debt_management": debt_management.payload,
            "outstanding_balance": debt_management.outstanding_balance.round_dp(2).normalize().to_string(),
            "base_data_missing_fields": base_data_missing_fields,
            "blocking_reasons": blocking_reasons,
            "checks": checks,
            "patient": {
                "id": patient_uuid,
                "patient_id": patient_pid,
                "name": patient_name,
                "birth_date": birth_date,
                "gender": gender,
                "phone_primary": phone_primary,
                "email": email,
                "residence_country": residence_country,
                "address_country": address_country,
                "languages": languages,
            },
            "legal_status": {
                "dsgvo_signed": dsgvo_signed,
                "identity_verified": identity_verified,
                "compliance_completed": compliance_completed,
                "contract_status": stored_contract_status,
            },
            "document_alerts": patient_document_alerts_payload(&document_alerts),
            "latest_framework_contract": latest_framework_contract,
        }),
    }))
}

async fn get_patient_document_alerts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;
    let summary = load_patient_document_alerts_summary(&state, patient_uuid).await?;
    Ok(Json(patient_document_alerts_payload(&summary)))
}

async fn get_patient_recheck(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Billing])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let Some(readiness) = load_patient_recheck_readiness(&state, patient_uuid).await? else {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    };

    state.audit_sender.try_send(audit::domain_event(
        "view_patient_recheck",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "can_create_order": readiness.can_create_order,
            "blocking_reasons": readiness.blocking_reasons.clone(),
        }),
    ));

    Ok(Json(readiness.payload))
}

async fn list_patient_framework_contracts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT id, contract_number, status, signed_at, valid_from, valid_to, created_at
           FROM framework_contracts
           WHERE patient_id = $1
           ORDER BY COALESCE(signed_at, created_at) DESC, created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient framework contracts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient framework contracts",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "signed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "valid_from": row.try_get::<Option<chrono::NaiveDate>, _>("valid_from").unwrap_or_default().map(|value| value.to_string()),
                "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn get_patient_label(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Query(query): Query<PatientLabelQuery>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let format = resolve_patient_label_format(query.format.as_deref())?;
    let agency = load_patient_label_agency_settings(&state).await?;

    let patient = sqlx::query(
        r#"SELECT patient_id, title, first_name, last_name, birth_date, gender,
                  nationality, residence_country, insurance_provider
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient label");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;

    let Some(patient) = patient else {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    };

    let patient_id = patient.try_get::<String, _>("patient_id").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label patient_id");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let title = patient
        .try_get::<Option<String>, _>("title")
        .unwrap_or_default();
    let first_name = patient.try_get::<String, _>("first_name").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label first_name");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let last_name = patient.try_get::<String, _>("last_name").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label last_name");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let birth_date = patient
        .try_get::<chrono::NaiveDate, _>("birth_date")
        .map(|value| value.to_string())
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label birth_date");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient label",
            )
        })?;
    let gender = patient.try_get::<String, _>("gender").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label gender");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let nationality = patient
        .try_get::<Option<String>, _>("nationality")
        .unwrap_or_default();
    let residence_country = patient
        .try_get::<Option<String>, _>("residence_country")
        .unwrap_or_default();
    let insurance_provider = patient
        .try_get::<Option<String>, _>("insurance_provider")
        .unwrap_or_default();
    let country_code =
        patient_label_country_code(nationality.as_deref(), residence_country.as_deref());

    let payload = json!({
        "patient_id": patient_id,
        "title": title,
        "salutation": patient_label_salutation(&gender),
        "first_name": first_name,
        "last_name": last_name,
        "birth_date": birth_date,
        "country_code": country_code.clone(),
        "insurance_provider": insurance_provider,
        "agency": {
            "name": agency.name,
            "care_of": agency.care_of,
            "address": agency.address,
            "phone": agency.phone,
            "email": agency.email,
        },
        "format": patient_label_format_json(format),
        "available_formats": PATIENT_LABEL_FORMATS
            .iter()
            .copied()
            .map(patient_label_format_json)
            .collect::<Vec<_>>(),
        "generated_at": chrono::Utc::now().to_rfc3339(),
    });

    state.audit_sender.try_send(audit::domain_event(
        "generate_patient_label",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "format": format.id,
            "country_code": country_code,
        }),
    ));

    Ok(Json(payload))
}

async fn list_patient_invoices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.issued_at, i.due_date,
                  i.total_gross, i.paid_amount, o.order_number, q.quote_number
           FROM invoices i
           LEFT JOIN orders o ON o.id = i.order_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           WHERE i.patient_id = $1
           ORDER BY i.issued_at DESC, i.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient invoices");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient invoices",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            let total_gross = row
                .try_get::<rust_decimal::Decimal, _>("total_gross")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let paid_amount = row
                .try_get::<rust_decimal::Decimal, _>("paid_amount")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                "invoice_type": row.try_get::<String, _>("invoice_type").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "issued_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("issued_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "due_date": row.try_get::<Option<chrono::NaiveDate>, _>("due_date").unwrap_or_default().map(|value| value.to_string()),
                "total_gross": total_gross.round_dp(2).normalize().to_string(),
                "paid_amount": paid_amount.round_dp(2).normalize().to_string(),
                "balance_due": (total_gross - paid_amount).max(rust_decimal::Decimal::ZERO).round_dp(2).normalize().to_string(),
                "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                "quote_number": row.try_get::<Option<String>, _>("quote_number").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn get_patient_service_report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let summary_row = sqlx::query(
        r#"SELECT COUNT(*) AS service_count,
                  COUNT(*) FILTER (
                      WHERE ol.delivered_at IS NOT NULL
                         OR ol.status IN ('delivered', 'approved', 'invoiced')
                  ) AS delivered_count,
                  COUNT(*) FILTER (
                      WHERE ol.approved_at IS NOT NULL
                         OR ol.status IN ('approved', 'invoiced')
                  ) AS approved_count,
                  COALESCE(
                      SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                      0
                  ) AS total_gross,
                  MIN(COALESCE(ol.approved_at, ol.delivered_at, ol.created_at)) AS first_service_at,
                  MAX(COALESCE(ol.approved_at, ol.delivered_at, ol.created_at)) AS last_service_at
           FROM order_leistungen ol
           JOIN orders o ON o.id = ol.order_id
           WHERE o.patient_id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient service report summary");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient service report",
        )
    })?;

    let item_rows = sqlx::query(
        r#"SELECT ol.id,
                  o.id AS order_id,
                  o.order_number,
                  ol.description,
                  ol.status,
                  ol.quantity,
                  ol.unit_price,
                  ol.currency,
                  ol.vat_rate,
                  (ol.quantity * ol.unit_price) AS line_net,
                  ((ol.quantity * ol.unit_price) * (ol.vat_rate / 100)) AS line_vat,
                  (ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))) AS line_gross,
                  ol.provider_id,
                  p.name AS provider_name,
                  ol.doctor_id,
                  d.name AS doctor_name,
                  ol.is_cost_passthrough,
                  ol.notes,
                  ol.delivered_at,
                  ol.approved_at,
                  COALESCE(ol.approved_at, ol.delivered_at, ol.created_at) AS effective_at
           FROM order_leistungen ol
           JOIN orders o ON o.id = ol.order_id
           LEFT JOIN providers p ON p.id = ol.provider_id
           LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
           WHERE o.patient_id = $1
           ORDER BY effective_at DESC, ol.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient service report items");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient service report",
        )
    })?;

    let service_count = summary_row
        .try_get::<i64, _>("service_count")
        .unwrap_or_default();
    let delivered_count = summary_row
        .try_get::<i64, _>("delivered_count")
        .unwrap_or_default();
    let approved_count = summary_row
        .try_get::<i64, _>("approved_count")
        .unwrap_or_default();
    let total_gross = summary_row
        .try_get::<rust_decimal::Decimal, _>("total_gross")
        .unwrap_or(rust_decimal::Decimal::ZERO);
    let first_service_at = summary_row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("first_service_at")
        .unwrap_or_default();
    let last_service_at = summary_row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_service_at")
        .unwrap_or_default();

    let items = item_rows
        .into_iter()
        .map(|row| {
            let quantity = row
                .try_get::<rust_decimal::Decimal, _>("quantity")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let unit_price = row
                .try_get::<rust_decimal::Decimal, _>("unit_price")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let vat_rate = row
                .try_get::<rust_decimal::Decimal, _>("vat_rate")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let line_net = row
                .try_get::<rust_decimal::Decimal, _>("line_net")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let line_vat = row
                .try_get::<rust_decimal::Decimal, _>("line_vat")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let line_gross = row
                .try_get::<rust_decimal::Decimal, _>("line_gross")
                .unwrap_or(rust_decimal::Decimal::ZERO);

            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_else(|_| Uuid::nil()),
                "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                "description": row.try_get::<String, _>("description").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "quantity": quantity.normalize().to_string(),
                "unit_price": money_json(unit_price),
                "vat_rate": vat_rate.normalize().to_string(),
                "line_net": money_json(line_net),
                "line_vat": money_json(line_vat),
                "line_gross": money_json(line_gross),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
                "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                "doctor_id": row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
                "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
                "is_cost_passthrough": row.try_get::<bool, _>("is_cost_passthrough").unwrap_or(false),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "delivered_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("delivered_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "approved_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("approved_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "effective_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("effective_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    state.audit_sender.try_send(audit::domain_event(
        "view_patient_service_report",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "service_count": service_count,
            "approved_count": approved_count,
            "total_gross": money_json(total_gross),
        }),
    ));

    Ok(Json(json!({
        "patient_id": patient_uuid,
        "summary": {
            "service_count": service_count,
            "delivered_count": delivered_count,
            "approved_count": approved_count,
            "total_gross": money_json(total_gross),
            "first_service_at": first_service_at.map(|value| value.to_rfc3339()),
            "last_service_at": last_service_at.map(|value| value.to_rfc3339()),
        },
        "items": items,
    })))
}

async fn list_relations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT pr.id, pr.patient_id, pr.related_patient_id, pr.related_name, pr.relation_type,
                  pr.is_emergency_contact, pr.phone, pr.notes, pr.created_at,
                  rp.patient_id AS related_patient_pid,
                  rp.first_name AS related_first_name,
                  rp.last_name AS related_last_name
           FROM patient_relations pr
           LEFT JOIN patients rp ON rp.id = pr.related_patient_id
           WHERE pr.patient_id = $1
           ORDER BY pr.is_emergency_contact DESC, pr.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient relations");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient relations",
        )
    })?;

    let items = rows
        .into_iter()
        .map(build_relation_json)
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn create_relation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<UpsertRelationRequest>,
) -> Result<(StatusCode, Json<Value>), axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;
    validate_relation_request(&body, patient_uuid)?;

    if let Some(related_patient_id) = body.related_patient_id {
        ensure_related_patient_exists(&state, related_patient_id).await?;
    }

    let row = sqlx::query(
        r#"INSERT INTO patient_relations (
                patient_id, related_patient_id, related_name, relation_type,
                is_emergency_contact, phone, notes
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
           )
           RETURNING id, patient_id, related_patient_id, related_name, relation_type,
                     is_emergency_contact, phone, notes, created_at"#,
    )
    .bind(patient_uuid)
    .bind(body.related_patient_id)
    .bind(body.related_name.trim())
    .bind(body.relation_type.trim())
    .bind(body.is_emergency_contact.unwrap_or(false))
    .bind(body.phone.as_deref())
    .bind(body.notes.as_deref())
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient relation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create patient relation",
        )
    })?;

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_relation",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({
            "relation_id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            "relation_type": body.relation_type,
            "related_patient_id": body.related_patient_id,
        }),
    ));

    Ok((StatusCode::CREATED, Json(build_relation_json(row))))
}

async fn update_relation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, relation_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpsertRelationRequest>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;
    validate_relation_request(&body, patient_uuid)?;

    if let Some(related_patient_id) = body.related_patient_id {
        ensure_related_patient_exists(&state, related_patient_id).await?;
    }

    let updated = sqlx::query(
        r#"UPDATE patient_relations
           SET related_patient_id = $3,
               related_name = $4,
               relation_type = $5,
               is_emergency_contact = $6,
               phone = $7,
               notes = $8
           WHERE patient_id = $1
             AND id = $2
           RETURNING id, patient_id, related_patient_id, related_name, relation_type,
                     is_emergency_contact, phone, notes, created_at"#,
    )
    .bind(patient_uuid)
    .bind(relation_id)
    .bind(body.related_patient_id)
    .bind(body.related_name.trim())
    .bind(body.relation_type.trim())
    .bind(body.is_emergency_contact.unwrap_or(false))
    .bind(body.phone.as_deref())
    .bind(body.notes.as_deref())
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, relation_id = %relation_id, "Failed to update patient relation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update patient relation",
        )
    })?;

    let Some(row) = updated else {
        return Err(err(StatusCode::NOT_FOUND, "Patient relation not found"));
    };

    state.audit_sender.try_send(audit::domain_event(
        "update_patient_relation",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({
            "relation_id": relation_id,
            "relation_type": body.relation_type,
            "related_patient_id": body.related_patient_id,
        }),
    ));

    Ok(Json(build_relation_json(row)))
}

async fn delete_relation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, relation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let result = sqlx::query("DELETE FROM patient_relations WHERE patient_id = $1 AND id = $2")
        .bind(patient_uuid)
        .bind(relation_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, relation_id = %relation_id, "Failed to delete patient relation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete patient relation",
        )
    })?;

    if result.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Patient relation not found"));
    }

    state.audit_sender.try_send(audit::domain_event(
        "delete_patient_relation",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({ "relation_id": relation_id }),
    ));

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct PatientTimelineQuery {
    entity_type: Option<String>,
    category: Option<String>,
    source: Option<String>,
    search: Option<String>,
    range: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn get_patient_timeline(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Query(query): Query<PatientTimelineQuery>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let entity_type = query
        .entity_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let category = query
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let source = query
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let search_pattern = format!("%{}%", query.search.as_deref().unwrap_or("").trim());
    let range_cutoff = match query.range.as_deref().unwrap_or("all") {
        "all" => None,
        "30d" => Some(chrono::Utc::now() - chrono::Duration::days(30)),
        "90d" => Some(chrono::Utc::now() - chrono::Duration::days(90)),
        "180d" => Some(chrono::Utc::now() - chrono::Duration::days(180)),
        "365d" => Some(chrono::Utc::now() - chrono::Duration::days(365)),
        _ => {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid timeline range filter",
            ));
        }
    };

    let events_cte = r#"WITH events AS (
            SELECT 'appointment'::text AS entity_type,
                   a.id AS entity_id,
                   a.title AS title,
                   COALESCE(a.appointment_type, 'medical') AS category,
                   a.status AS status,
                   ((a.date::timestamp + COALESCE(a.time_start, time '00:00')) AT TIME ZONE 'UTC') AS happened_at,
                   concat_ws(' · ', p.name, d.name) AS source_label
            FROM appointments a
            LEFT JOIN providers p ON p.id = a.provider_id
            LEFT JOIN provider_doctors d ON d.id = a.doctor_id
            WHERE a.patient_id = $1

            UNION ALL

            SELECT 'case'::text AS entity_type,
                   c.id AS entity_id,
                   COALESCE(c.hauptanfragegrund, c.case_id) AS title,
                   'anamnesis'::text AS category,
                   c.status AS status,
                   c.created_at AS happened_at,
                   c.case_id AS source_label
            FROM cases c
            WHERE c.patient_id = $1

            UNION ALL

            SELECT 'order'::text AS entity_type,
                   o.id AS entity_id,
                   o.order_number AS title,
                   o.phase AS category,
                   o.status AS status,
                   o.created_at AS happened_at,
                   COALESCE(o.needs_description, o.order_number) AS source_label
            FROM orders o
            WHERE o.patient_id = $1

            UNION ALL

            SELECT 'service'::text AS entity_type,
                   ol.id AS entity_id,
                   ol.description AS title,
                   'leistung'::text AS category,
                   ol.status AS status,
                   COALESCE(ol.approved_at, ol.delivered_at, ol.created_at) AS happened_at,
                   concat_ws(' · ', o.order_number, p.name, d.name) AS source_label
            FROM order_leistungen ol
            JOIN orders o ON o.id = ol.order_id
            LEFT JOIN providers p ON p.id = ol.provider_id
            LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
            WHERE o.patient_id = $1

            UNION ALL

            SELECT 'document'::text AS entity_type,
                   d.id AS entity_id,
                   COALESCE(d.auto_name, d.original_filename, 'Document') AS title,
                   COALESCE(d.category, d.art, 'document') AS category,
                   d.status AS status,
                   d.created_at AS happened_at,
                   d.visibility AS source_label
            FROM documents d
            WHERE d.patient_id = $1

            UNION ALL

            SELECT 'contract'::text AS entity_type,
                   fc.id AS entity_id,
                   fc.contract_number AS title,
                   'framework_contract'::text AS category,
                   fc.status AS status,
                   COALESCE(fc.signed_at, fc.created_at) AS happened_at,
                   NULL::text AS source_label
            FROM framework_contracts fc
            WHERE fc.patient_id = $1

            UNION ALL

            SELECT 'invoice'::text AS entity_type,
                   i.id AS entity_id,
                   i.invoice_number AS title,
                   i.invoice_type AS category,
                   i.status AS status,
                   i.issued_at AS happened_at,
                   NULL::text AS source_label
            FROM invoices i
            WHERE i.patient_id = $1

            UNION ALL

            SELECT 'invoice_visibility'::text AS entity_type,
                   i.id AS entity_id,
                   concat('Invoice visibility: ', i.invoice_number) AS title,
                   'invoice_visibility'::text AS category,
                   CASE
                       WHEN COALESCE((al.context->>'portal_visible')::boolean, i.portal_visible) = false THEN 'hidden'
                       WHEN COALESCE((al.context->>'hide_amounts_from_patient')::boolean, i.hide_amounts_from_patient) = true THEN 'amounts_hidden'
                       ELSE 'visible'
                   END AS status,
                   al.created_at AS happened_at,
                   concat_ws(' В· ', u.name, al.context->>'visibility_note') AS source_label
            FROM audit_log al
            JOIN invoices i ON i.id = al.entity_id
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.entity_type = 'invoice'
              AND al.action = 'invoice_visibility_changed'
              AND i.patient_id = $1

            UNION ALL

            SELECT 'recommendation'::text AS entity_type,
                   pr.id AS entity_id,
                   pr.title AS title,
                   pr.recommendation_type AS category,
                   pr.status AS status,
                   COALESCE(pr.due_at, pr.created_at) AS happened_at,
                   concat_ws(' / ', doctor.name, pr.priority) AS source_label
            FROM patient_recommendations pr
            LEFT JOIN provider_doctors doctor ON doctor.id = pr.source_doctor_id
            WHERE pr.patient_id = $1

            UNION ALL

            SELECT 'translation_request'::text AS entity_type,
                   dtr.id AS entity_id,
                   concat('Translation request: ', dtr.requested_language, ' - ', COALESCE(d.auto_name, d.original_filename, 'Document')) AS title,
                   dtr.request_source AS category,
                   dtr.status AS status,
                   COALESCE(dtr.completed_at, dtr.requested_at) AS happened_at,
                   concat_ws(' / ', dtr.requested_language, u.name) AS source_label
            FROM document_translation_requests dtr
            LEFT JOIN documents d ON d.id = dtr.document_id
            LEFT JOIN users u ON u.id = dtr.requested_by
            WHERE dtr.patient_id = $1

            UNION ALL

            SELECT 'service_package'::text AS entity_type,
                   psp.id AS entity_id,
                   sp.name AS title,
                   'service_package'::text AS category,
                   psp.status AS status,
                   psp.assigned_at AS happened_at,
                   concat_ws(' / ', o.order_number, psp.payer_contact_relationship) AS source_label
            FROM patient_service_packages psp
            JOIN service_packages sp ON sp.id = psp.package_id
            LEFT JOIN orders o ON o.id = psp.order_id
            WHERE psp.patient_id = $1

            UNION ALL

            SELECT 'service_package_consumption'::text AS entity_type,
                   spc.id AS entity_id,
                   COALESCE(spi.description, sp.name, 'Package consumption') AS title,
                   'package_consumption'::text AS category,
                   spc.approval_status AS status,
                   spc.consumed_at AS happened_at,
                   concat_ws(' / ', sp.name, o.order_number) AS source_label
            FROM service_package_consumptions spc
            JOIN patient_service_packages psp ON psp.id = spc.patient_service_package_id
            JOIN service_packages sp ON sp.id = psp.package_id
            LEFT JOIN service_package_items spi ON spi.id = spc.package_item_id
            LEFT JOIN orders o ON o.id = spc.order_id
            WHERE psp.patient_id = $1

            UNION ALL

            SELECT 'service_package_change'::text AS entity_type,
                   COALESCE(psp.id, $1) AS entity_id,
                   concat('Package change: ', COALESCE(sp.name, al.action)) AS title,
                   'service_package'::text AS category,
                   COALESCE(psp.status, al.context->>'status', 'changed') AS status,
                   al.created_at AS happened_at,
                   u.name AS source_label
            FROM audit_log al
            LEFT JOIN patient_service_packages psp ON psp.id = al.entity_id
            LEFT JOIN service_packages sp ON sp.id = psp.package_id
            LEFT JOIN users u ON u.id = al.user_id
            WHERE (
                    al.entity_type = 'patient_service_package'
                    AND psp.patient_id = $1
                  )
               OR (
                    al.entity_type = 'patient'
                    AND al.entity_id = $1
                    AND al.action LIKE 'patient_service_package_%'
                  )
               OR (
                    al.context->>'patient_id' = $1::text
                    AND al.action LIKE 'patient_service_package_%'
                  )

            UNION ALL

            SELECT 'service_group'::text AS entity_type,
                   osg.id AS entity_id,
                   osg.group_title AS title,
                   'service_group'::text AS category,
                   osg.status AS status,
                   COALESCE((osg.service_date::timestamp AT TIME ZONE 'UTC'), osg.created_at) AS happened_at,
                   o.order_number AS source_label
            FROM order_service_groups osg
            JOIN orders o ON o.id = osg.order_id
            WHERE o.patient_id = $1

            UNION ALL

            SELECT 'interpreter_preference'::text AS entity_type,
                   COALESCE(interpreter.id, al.entity_id) AS entity_id,
                   concat(
                       'Interpreter preference: ',
                       COALESCE(interpreter.name, 'Interpreter'),
                       ' -> ',
                       COALESCE(al.context->>'preference', 'neutral')
                   ) AS title,
                   'interpreter_preference'::text AS category,
                   COALESCE(al.context->>'preference', 'changed') AS status,
                   al.created_at AS happened_at,
                   actor.name AS source_label
            FROM audit_log al
            LEFT JOIN users actor ON actor.id = al.user_id
            LEFT JOIN users interpreter
                   ON interpreter.id = CASE
                       WHEN COALESCE(al.context->>'interpreter_id', '') ~* '^[0-9a-f-]{36}$'
                       THEN (al.context->>'interpreter_id')::uuid
                       ELSE NULL::uuid
                   END
            WHERE al.entity_type = 'patient'
              AND al.entity_id = $1
              AND al.action = 'interpreter_preference_changed'

            UNION ALL

            SELECT 'drug_verification'::text AS entity_type,
                   COALESCE(
                       CASE
                           WHEN COALESCE(al.context->>'match_id', '') ~* '^[0-9a-f-]{36}$'
                           THEN (al.context->>'match_id')::uuid
                           ELSE NULL::uuid
                       END,
                       al.entity_id
                   ) AS entity_id,
                   concat(
                       'Drug match ',
                       COALESCE(al.context->>'verification_status', 'verified'),
                       ': ',
                       COALESCE(m.handelsname, 'medication')
                   ) AS title,
                   'drug_verification'::text AS category,
                   COALESCE(al.context->>'verification_status', 'verified') AS status,
                   al.created_at AS happened_at,
                   concat_ws(' В· ', actor.name, dp.brand_name) AS source_label
            FROM audit_log al
            JOIN cases c ON c.id = al.entity_id
            LEFT JOIN users actor ON actor.id = al.user_id
            LEFT JOIN medication_drug_matches mdm
                   ON mdm.id = CASE
                       WHEN COALESCE(al.context->>'match_id', '') ~* '^[0-9a-f-]{36}$'
                       THEN (al.context->>'match_id')::uuid
                       ELSE NULL::uuid
                   END
            LEFT JOIN medikamente m ON m.id = mdm.medication_id
            LEFT JOIN drug_products dp ON dp.id = mdm.drug_product_id
            WHERE al.entity_type = 'case'
              AND al.action = 'drug_match_verified'
              AND c.patient_id = $1

            UNION ALL

            SELECT 'card_entry'::text AS entity_type,
                   e.id AS entity_id,
                   CASE
                       WHEN length(e.content) > 120 THEN left(e.content, 117) || '...'
                       ELSE e.content
                   END AS title,
                   e.category AS category,
                   'logged'::text AS status,
                   e.entry_date AS happened_at,
                   concat_ws(' · ', e.source, u.name) AS source_label
            FROM patient_card_entries e
            LEFT JOIN users u ON u.id = e.author_id
            WHERE e.patient_id = $1

            UNION ALL

            SELECT 'medical_order'::text AS entity_type,
                   mo.id AS entity_id,
                   mo.title AS title,
                   mo.order_type AS category,
                   mo.status AS status,
                   mo.order_date AS happened_at,
                   concat_ws(' · ', mo.source, u.name) AS source_label
            FROM patient_medical_orders mo
            LEFT JOIN users u ON u.id = mo.ordered_by
            WHERE mo.patient_id = $1

            UNION ALL

            SELECT 'risk_score'::text AS entity_type,
                   rs.id AS entity_id,
                   CASE
                       WHEN rs.scale_max IS NULL THEN concat(rs.score_type, ' ', trim(to_char(rs.score_value, 'FM999999990.##')))
                       ELSE concat(rs.score_type, ' ', trim(to_char(rs.score_value, 'FM999999990.##')), '/', trim(to_char(rs.scale_max, 'FM999999990.##')))
                   END AS title,
                   rs.score_type AS category,
                   'recorded'::text AS status,
                   rs.computed_at AS happened_at,
                   concat_ws(' · ', rs.source, u.name) AS source_label
            FROM patient_risk_scores rs
            LEFT JOIN users u ON u.id = rs.recorded_by
            WHERE rs.patient_id = $1

            UNION ALL

            SELECT 'compliance'::text AS entity_type,
                   COALESCE(al.entity_id, $1) AS entity_id,
                   CASE
                       WHEN al.action = 'dsgvo_data_export' THEN 'DSGVO data export'
                       WHEN al.action = 'dsgvo_anonymize' THEN 'Patient anonymized'
                       WHEN al.action = 'privacy_request_created' AND COALESCE(al.context->>'request_type', 'erasure') = 'restriction' THEN 'Processing restriction requested'
                       WHEN al.action = 'privacy_request_created' AND COALESCE(al.context->>'request_type', 'erasure') = 'third_party_revoke' THEN 'Third-party sharing revocation requested'
                       WHEN al.action = 'privacy_request_created' THEN 'Privacy erasure requested'
                       WHEN al.action = 'privacy_request_reviewed' THEN 'Privacy request reviewed'
                       WHEN al.action = 'privacy_request_executed' AND COALESCE(al.context->>'request_type', 'erasure') = 'restriction' THEN 'Processing restriction applied'
                       WHEN al.action = 'privacy_request_executed' AND COALESCE(al.context->>'request_type', 'erasure') = 'third_party_revoke' THEN 'Third-party sharing revoked'
                       WHEN al.action = 'privacy_request_executed' THEN 'Privacy request executed'
                       WHEN al.action = 'consent_granted' THEN 'Consent granted'
                       WHEN al.action = 'consent_revoked' THEN 'Consent revoked'
                       WHEN al.action = 'feedback_submitted' THEN 'Patient feedback submitted'
                       WHEN al.action = 'feedback_reviewed' THEN 'Patient feedback reviewed'
                       WHEN al.action = 'workflow_checklist_item_created' THEN 'Workflow checklist item created'
                       WHEN al.action = 'workflow_checklist_item_completed' THEN 'Workflow checklist item completed'
                       ELSE 'Legal/compliance status updated'
                   END AS title,
                   CASE
                       WHEN al.action = 'dsgvo_data_export' THEN 'dsgvo_export'
                       WHEN al.action = 'dsgvo_anonymize' THEN 'dsgvo_anonymize'
                       WHEN al.action LIKE 'privacy_request_%' THEN 'privacy_request'
                       WHEN al.action IN ('consent_granted', 'consent_revoked') THEN 'consent'
                       WHEN al.action LIKE 'feedback_%' THEN 'feedback'
                       WHEN al.action LIKE 'workflow_checklist_item_%' THEN 'workflow'
                       ELSE 'legal_status'
                   END AS category,
                   'completed'::text AS status,
                   al.created_at AS happened_at,
                   concat_ws(' · ', u.name, COALESCE(al.context->>'consent_type', al.context->>'request_type', al.context->>'review_action', al.context->>'article')) AS source_label
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.entity_type = 'patient'
              AND al.entity_id = $1
              AND (
                    al.action IN (
                        'dsgvo_data_export',
                        'dsgvo_anonymize',
                        'consent_granted',
                        'consent_revoked',
                        'feedback_submitted',
                        'feedback_reviewed',
                        'workflow_checklist_item_created',
                        'workflow_checklist_item_completed',
                        'privacy_request_created',
                        'privacy_request_reviewed',
                        'privacy_request_executed'
                    )
                    OR (
                        al.action = 'update_patient'
                        AND COALESCE((al.context->>'legal_status_updated')::boolean, false)
                    )
              )
        )"#;

    let filter_clause = r#"
        WHERE ($2::text IS NULL OR entity_type = $2)
          AND ($3::text IS NULL OR category = $3)
          AND ($4::text IS NULL OR LOWER(COALESCE(source_label, '')) = LOWER($4))
          AND ($5::text = '%%'
                OR title ILIKE $5
                OR category ILIKE $5
                OR status ILIKE $5
                OR entity_type ILIKE $5
                OR COALESCE(source_label, '') ILIKE $5)
          AND ($6::timestamptz IS NULL OR happened_at >= $6)
    "#;

    let rows_sql = format!(
        "{events_cte}
         SELECT entity_type, entity_id, title, category, status, happened_at, source_label,
                COUNT(*) OVER() AS total
         FROM events
         {filter_clause}
         ORDER BY happened_at DESC, entity_type, entity_id
         LIMIT $7 OFFSET $8"
    );
    let rows = sqlx::query(&rows_sql)
    .bind(patient_uuid)
    .bind(entity_type)
    .bind(category)
    .bind(source)
    .bind(&search_pattern)
    .bind(range_cutoff)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient timeline");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient timeline",
        )
    })?;

    let total = rows
        .first()
        .and_then(|row| row.try_get::<i64, _>("total").ok())
        .unwrap_or(0);
    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "entity_type": row.try_get::<String, _>("entity_type").unwrap_or_default(),
                "entity_id": row.try_get::<Uuid, _>("entity_id").unwrap_or_else(|_| Uuid::nil()),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "happened_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("happened_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "source_label": row.try_get::<Option<String>, _>("source_label").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(serde_json::json!({
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + (items.len() as i64) < total,
    })))
}

async fn assign_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<AssignRequest>,
) -> impl IntoResponse {
    if !can_manage_assignment(auth.role) {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1) AS "e!""#,
        patient_uuid
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    }

    if auth.role != Role::Ceo && !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let target_user = sqlx::query("SELECT id, name, role, is_active FROM users WHERE id = $1")
        .bind(body.user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %body.user_id, "Failed to load target user");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate assignment target",
            )
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "User not found"))?;

    let target_role = target_user.try_get::<String, _>("role").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate assignment target",
        )
    })?;
    let target_active = target_user.try_get::<bool, _>("is_active").unwrap_or(false);

    if !target_active {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Cannot assign inactive user",
        ));
    }

    if !assignment_allowed(auth.role, &target_role) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "This role cannot assign the selected user role",
        ));
    }

    let assignment_already_active = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1
               FROM patient_assignments
               WHERE patient_id = $1
                 AND user_id = $2
                 AND revoked_at IS NULL
           )"#,
    )
    .bind(patient_uuid)
    .bind(body.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, user_id = %body.user_id, "Failed to inspect existing patient assignment");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate assignment target",
        )
    })?;

    let patient_context =
        load_patient_assignment_notification_context(&state, patient_uuid).await?;

    sqlx::query!(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (patient_id, user_id) DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()",
        patient_uuid, body.user_id, auth.user_id
    )
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to assign patient");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to assign patient")
    })?;

    if !assignment_already_active {
        insert_patient_assignment_notification(
            &state,
            body.user_id,
            "patient_assignment",
            format!("New patient assignment: {}", patient_context.patient_name),
            format!(
                "You were assigned to patient {} ({}).",
                patient_context.patient_name, patient_context.patient_code
            ),
            patient_uuid,
        )
        .await?;
    }

    state.audit_sender.try_send(audit::domain_event(
        "assign_patient",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({
            "assigned_to": body.user_id,
            "assigned_role": target_role,
        }),
    ));

    tracing::info!(by = %auth.user_id, patient = %patient_uuid, to = %body.user_id, "Patient assigned");

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.assigned",
        patient_uuid,
        serde_json::json!({ "assigned_user_id": body.user_id }),
    )
    .await;

    Ok(Json(serde_json::json!({"ok": true})))
}

#[allow(clippy::result_large_err)]
fn validate_relation_request(
    body: &UpsertRelationRequest,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if let Err(message) = validate_relation_payload_fields(body) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message));
    }

    if let Some(related_patient_id) = body.related_patient_id
        && related_patient_id == patient_id
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Patient relation cannot point to the same patient",
        ));
    }

    Ok(())
}

async fn ensure_related_patient_exists(
    state: &AppState,
    related_patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
    .bind(related_patient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, related_patient_id = %related_patient_id, "Failed to validate related patient");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate related patient",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Related patient not found"))
    }
}

async fn ensure_patient_visible(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(patient_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate patient",
                )
            })?;

    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    }

    if has_patient_access(state, auth, patient_id).await? {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

fn build_relation_json(row: sqlx::postgres::PgRow) -> Value {
    let related_first = row
        .try_get::<Option<String>, _>("related_first_name")
        .unwrap_or_default();
    let related_last = row
        .try_get::<Option<String>, _>("related_last_name")
        .unwrap_or_default();
    let related_name = row.try_get::<String, _>("related_name").unwrap_or_default();
    let related_display_name = match (related_first, related_last) {
        (Some(first), Some(last)) if !first.is_empty() || !last.is_empty() => {
            format!("{first} {last}").trim().to_string()
        }
        (Some(first), None) if !first.is_empty() => first,
        (None, Some(last)) if !last.is_empty() => last,
        _ => related_name.clone(),
    };

    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
        "related_patient_id": row.try_get::<Option<Uuid>, _>("related_patient_id").unwrap_or_default(),
        "related_patient_pid": row.try_get::<Option<String>, _>("related_patient_pid").unwrap_or_default(),
        "related_name": related_name,
        "related_display_name": related_display_name,
        "relation_type": row.try_get::<String, _>("relation_type").unwrap_or_default(),
        "is_emergency_contact": row.try_get::<bool, _>("is_emergency_contact").unwrap_or(false),
        "phone": row.try_get::<Option<String>, _>("phone").unwrap_or_default(),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

struct PatientAssignmentNotificationContext {
    patient_code: String,
    patient_name: String,
}

async fn load_patient_assignment_notification_context(
    state: &AppState,
    patient_id: Uuid,
) -> Result<PatientAssignmentNotificationContext, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT patient_id, first_name, last_name
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "Failed to load patient assignment notification context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Patient not found"))?;

    let patient_code = row.try_get::<String, _>("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?;
    let first_name = row.try_get::<String, _>("first_name").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?;
    let last_name = row.try_get::<String, _>("last_name").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?;
    let patient_name = format!("{first_name} {last_name}").trim().to_string();

    Ok(PatientAssignmentNotificationContext {
        patient_code,
        patient_name,
    })
}

async fn insert_patient_assignment_notification(
    state: &AppState,
    user_id: Uuid,
    kind: &str,
    title: String,
    body: String,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    let notification_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           VALUES ($1, $2, $3, $4, 'patient', $5)
           RETURNING id"#,
    )
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(patient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, patient_id = %patient_id, "Failed to insert patient assignment notification");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to notify assigned user",
        )
    })?;

    crate::realtime::publish_notification_event(
        state,
        user_id,
        "notification.created",
        Some(notification_id),
        serde_json::json!({ "entity_type": "patient", "entity_id": patient_id }),
    )
    .await;

    Ok(())
}

fn can_manage_assignment(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::PatientManager | Role::TeamleadInterpreter
    )
}

fn assignment_allowed(assigner_role: Role, target_role: &str) -> bool {
    match assigner_role {
        Role::Ceo => matches!(
            target_role,
            "patient_manager" | "teamlead_interpreter" | "interpreter" | "concierge"
        ),
        Role::PatientManager => {
            matches!(
                target_role,
                "teamlead_interpreter" | "interpreter" | "concierge"
            )
        }
        Role::TeamleadInterpreter => matches!(target_role, "interpreter"),
        _ => false,
    }
}

async fn has_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<bool, axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(true);
    }

    if !access::requires_patient_assignment(auth.role) {
        return Ok(true);
    }

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate patient access")
        })
}

async fn load_patient_field_policies(
    state: &AppState,
    auth: &AuthUser,
) -> Result<HashMap<String, FieldPolicy>, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::PatientManager) {
        return Ok(HashMap::new());
    }

    let Some(role_name) = access::role_db_name(auth.role) else {
        return Ok(HashMap::new());
    };

    let rows = sqlx::query(
        r#"SELECT field_name, access_level, condition_type
           FROM field_access_policies
           WHERE role = $1
             AND entity_type = 'patient'"#,
    )
    .bind(role_name)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, role = role_name, "Failed to load patient field policies");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load access policies",
        )
    })?;

    let mut policies = HashMap::with_capacity(rows.len());
    for row in rows {
        let field_name: String = row.try_get("field_name").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode access policy",
            )
        })?;
        let access_level: String = row.try_get("access_level").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode access policy",
            )
        })?;
        let condition_type = row.try_get("condition_type").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode access policy",
            )
        })?;

        policies.insert(
            field_name,
            FieldPolicy {
                access_level,
                condition_type,
            },
        );
    }

    Ok(policies)
}

#[derive(Debug)]
struct PatientSummaryInput {
    id: Uuid,
    patient_id: String,
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: chrono::NaiveDate,
    gender: String,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Vec<String>,
    functional_labels: Vec<String>,
    phone_primary: Option<String>,
    email: Option<String>,
    insurance_provider: Option<String>,
    insurance_type: Option<String>,
    is_active: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
struct PatientDetailInput {
    id: Uuid,
    patient_id: String,
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: chrono::NaiveDate,
    gender: String,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Vec<String>,
    functional_labels: Vec<String>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_type: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
    emergency_contact_relation: Option<String>,
    legal_status: serde_json::Value,
    clinical_warnings: Option<String>,
    notes: Option<String>,
    is_active: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

fn build_patient_summary_json(
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    patient: PatientSummaryInput,
) -> Value {
    let mut data = Map::new();
    data.insert("id".to_string(), Value::String(patient.id.to_string()));
    data.insert("patient_id".to_string(), Value::String(patient.patient_id));
    data.insert("gender".to_string(), Value::String(patient.gender));
    data.insert("is_active".to_string(), Value::Bool(patient.is_active));
    data.insert(
        "created_at".to_string(),
        Value::String(patient.created_at.to_rfc3339()),
    );

    insert_name_fields(
        &mut data,
        auth,
        policies,
        patient.title,
        patient.first_name,
        patient.last_name,
    );
    insert_birth_date(&mut data, auth, policies, patient.birth_date);
    insert_phone_fields(&mut data, auth, policies, patient.phone_primary, None);
    insert_email_field(&mut data, auth, policies, patient.email);
    insert_nationality_fields(
        &mut data,
        auth,
        policies,
        patient.nationality,
        patient.residence_country,
    );
    insert_languages_field(&mut data, auth, policies, patient.languages);
    insert_functional_labels_field(&mut data, auth, policies, patient.functional_labels);
    insert_insurance_fields(
        &mut data,
        auth,
        policies,
        patient.insurance_provider,
        None,
        patient.insurance_type,
    );

    Value::Object(data)
}

fn build_patient_detail_json(
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    patient: PatientDetailInput,
) -> Value {
    let mut data = build_patient_summary_json(
        auth,
        policies,
        PatientSummaryInput {
            id: patient.id,
            patient_id: patient.patient_id,
            title: patient.title.clone(),
            first_name: patient.first_name.clone(),
            last_name: patient.last_name.clone(),
            birth_date: patient.birth_date,
            gender: patient.gender.clone(),
            nationality: patient.nationality.clone(),
            residence_country: patient.residence_country.clone(),
            languages: patient.languages.clone(),
            functional_labels: patient.functional_labels.clone(),
            phone_primary: patient.phone_primary.clone(),
            email: patient.email.clone(),
            insurance_provider: patient.insurance_provider.clone(),
            insurance_type: patient.insurance_type.clone(),
            is_active: patient.is_active,
            created_at: patient.created_at,
        },
    );

    if let Value::Object(ref mut map) = data {
        map.insert(
            "updated_at".to_string(),
            Value::String(patient.updated_at.to_rfc3339()),
        );

        if matches!(auth.role, Role::Ceo | Role::PatientManager) {
            insert_optional_string(map, "address_street", patient.address_street);
            insert_optional_string(map, "address_city", patient.address_city);
            insert_optional_string(map, "address_zip", patient.address_zip);
            insert_optional_string(map, "address_country", patient.address_country);
            insert_optional_string(
                map,
                "emergency_contact_name",
                patient.emergency_contact_name,
            );
            insert_optional_string(
                map,
                "emergency_contact_phone",
                patient.emergency_contact_phone,
            );
            insert_optional_string(
                map,
                "emergency_contact_relation",
                patient.emergency_contact_relation,
            );
            map.insert("legal_status".to_string(), patient.legal_status);
            insert_optional_string(map, "notes", patient.notes);
            insert_insurance_fields(
                map,
                auth,
                policies,
                patient.insurance_provider,
                patient.insurance_number,
                patient.insurance_type,
            );
            insert_phone_fields(
                map,
                auth,
                policies,
                patient.phone_primary,
                patient.phone_secondary,
            );
        }

        insert_clinical_warnings_field(map, auth, policies, patient.clinical_warnings);
    }

    data
}

fn collect_visible_fields(value: &Value) -> Vec<String> {
    let Value::Object(map) = value else {
        return Vec::new();
    };

    let mut fields = map.keys().cloned().collect::<Vec<_>>();
    fields.sort();
    fields
}

fn insert_name_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    title: Option<String>,
    first_name: String,
    last_name: String,
) {
    match field_access(policies, "name", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "title", title);
            data.insert("first_name".to_string(), Value::String(first_name));
            data.insert("last_name".to_string(), Value::String(last_name));
        }
        Some(FieldAccess::Masked) => {
            insert_optional_string(data, "title", title);
            data.insert(
                "first_name".to_string(),
                Value::String(mask_text(&first_name)),
            );
            data.insert(
                "last_name".to_string(),
                Value::String(mask_text(&last_name)),
            );
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_birth_date(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    birth_date: chrono::NaiveDate,
) {
    match field_access(policies, "birth_date", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            data.insert(
                "birth_date".to_string(),
                Value::String(birth_date.to_string()),
            );
        }
        Some(FieldAccess::Masked) => {
            let masked = format!("{}-**-**", birth_date.format("%Y"));
            data.insert("birth_date".to_string(), Value::String(masked));
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_phone_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
) {
    match field_access(policies, "phone", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "phone_primary", phone_primary);
            insert_optional_string(data, "phone_secondary", phone_secondary);
        }
        Some(FieldAccess::Masked) => {
            if let Some(phone) = phone_primary {
                data.insert(
                    "phone_primary".to_string(),
                    Value::String(access::mask_phone(&phone)),
                );
            }
            if let Some(phone) = phone_secondary {
                data.insert(
                    "phone_secondary".to_string(),
                    Value::String(access::mask_phone(&phone)),
                );
            }
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_email_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    email: Option<String>,
) {
    match field_access(policies, "email", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => insert_optional_string(data, "email", email),
        Some(FieldAccess::Masked) => {
            if let Some(value) = email {
                data.insert(
                    "email".to_string(),
                    Value::String(access::mask_email(&value)),
                );
            }
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_nationality_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    nationality: Option<String>,
    residence_country: Option<String>,
) {
    match field_access(policies, "nationality", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) | Some(FieldAccess::Masked) => {
            insert_optional_string(data, "nationality", nationality);
            insert_optional_string(data, "residence_country", residence_country);
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_languages_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    languages: Vec<String>,
) {
    match field_access(policies, "languages", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) | Some(FieldAccess::Masked) => {
            data.insert(
                "languages".to_string(),
                Value::Array(languages.into_iter().map(Value::String).collect()),
            );
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_functional_labels_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    functional_labels: Vec<String>,
) {
    match field_access(policies, "functional_labels", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) | Some(FieldAccess::Masked) => {
            data.insert(
                "functional_labels".to_string(),
                Value::Array(functional_labels.into_iter().map(Value::String).collect()),
            );
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_insurance_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_type: Option<String>,
) {
    match field_access(policies, "insurance", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "insurance_provider", insurance_provider);
            insert_optional_string(data, "insurance_number", insurance_number);
            insert_optional_string(data, "insurance_type", insurance_type);
        }
        Some(FieldAccess::Masked) => {
            if let Some(provider) = insurance_provider {
                data.insert(
                    "insurance_provider".to_string(),
                    Value::String(mask_text(&provider)),
                );
            }
            if let Some(number) = insurance_number {
                data.insert(
                    "insurance_number".to_string(),
                    Value::String(mask_text(&number)),
                );
            }
            insert_optional_string(data, "insurance_type", insurance_type);
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_optional_string(data: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        data.insert(key.to_string(), Value::String(value));
    }
}

fn insert_clinical_warnings_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    clinical_warnings: Option<String>,
) {
    match field_access(policies, "vitals", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "clinical_warnings", clinical_warnings)
        }
        Some(FieldAccess::Masked) => {
            if let Some(value) = clinical_warnings {
                data.insert(
                    "clinical_warnings".to_string(),
                    Value::String(mask_text(&value)),
                );
            }
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

#[derive(Debug, Clone, Copy)]
enum FieldAccess {
    Visible,
    Masked,
    Hidden,
}

fn field_access(
    policies: &HashMap<String, FieldPolicy>,
    field_name: &str,
    is_full_access: bool,
) -> Option<FieldAccess> {
    if is_full_access || policies.is_empty() {
        return Some(FieldAccess::Visible);
    }

    let policy = policies.get(field_name)?;

    match policy.access_level.as_str() {
        "full" => Some(FieldAccess::Visible),
        "masked" => Some(FieldAccess::Masked),
        "hidden" => Some(FieldAccess::Hidden),
        "conditional" => match policy.condition_type.as_deref() {
            Some("assigned_appointment") => Some(FieldAccess::Hidden),
            Some("freigegeben") => Some(FieldAccess::Hidden),
            Some("own_data") => Some(FieldAccess::Hidden),
            _ => Some(FieldAccess::Hidden),
        },
        _ => None,
    }
}

fn mask_text(value: &str) -> String {
    match value.chars().next() {
        Some(first) => format!("{first}***"),
        None => String::new(),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_functional_labels(
    value: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, axum::response::Response> {
    let Some(values) = value else {
        return Ok(None);
    };

    let mut normalized = Vec::new();
    for raw in values {
        let label = raw.trim().to_lowercase().replace([' ', '-'], "_");
        if label.is_empty() {
            continue;
        }
        if !ALLOWED_PATIENT_FUNCTIONAL_LABELS.contains(&label.as_str()) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid functional label",
            ));
        }
        if !normalized.iter().any(|existing| existing == &label) {
            normalized.push(label);
        }
    }

    Ok(Some(normalized))
}

#[derive(Deserialize)]
struct RevokeRequest {
    user_id: Uuid,
}

async fn revoke_assignment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<RevokeRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    let patient_context =
        match load_patient_assignment_notification_context(&state, patient_id).await {
            Ok(context) => context,
            Err(response) => return response,
        };
    match sqlx::query!(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL",
        patient_id, body.user_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            if let Err(response) = insert_patient_assignment_notification(
                &state,
                body.user_id,
                "patient_assignment_revoked",
                format!("Patient assignment revoked: {}", patient_context.patient_name),
                format!(
                    "Your access to patient {} ({}) was revoked.",
                    patient_context.patient_name, patient_context.patient_code
                ),
                patient_id,
            )
            .await
            {
                return response;
            }
            state.audit_sender.try_send(audit::domain_event(
                "revoke_assignment",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                serde_json::json!({ "revoked_user_id": body.user_id }),
            ));
            tracing::info!(by = %auth.user_id, patient = %patient_id, revoked = %body.user_id, "Assignment revoked");
            crate::realtime::publish_patient_event_with_targets(
                &state,
                Some(auth.user_id),
                "patient.assignment_revoked",
                patient_id,
                vec![body.user_id],
                serde_json::json!({ "revoked_user_id": body.user_id }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Assignment not found or already revoked"),
        Err(e) => {
            tracing::error!(error = %e, "Failed to revoke assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to revoke assignment")
        }
    }
}

async fn activate_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match sqlx::query!(
        "UPDATE patients SET is_active = true, updated_at = now() WHERE id = $1 AND NOT is_active",
        patient_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "activate_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                serde_json::json!({}),
            ));
            tracing::info!(by = %auth.user_id, patient = %patient_id, "Patient activated");
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.activated",
                patient_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Patient not found or already active"),
        Err(e) => {
            tracing::error!(error = %e, "Failed to activate patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient",
            )
        }
    }
}

async fn deactivate_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match sqlx::query!(
        "UPDATE patients SET is_active = false, updated_at = now() WHERE id = $1 AND is_active",
        patient_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "deactivate_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                serde_json::json!({}),
            ));
            tracing::info!(by = %auth.user_id, patient = %patient_id, "Patient deactivated");
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.deactivated",
                patient_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(
            StatusCode::NOT_FOUND,
            "Patient not found or already inactive",
        ),
        Err(e) => {
            tracing::error!(error = %e, "Failed to deactivate patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to deactivate patient",
            )
        }
    }
}

async fn delete_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo]) {
        return e;
    }

    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(patient_id)
            .fetch_one(&state.db)
            .await;

    match exists {
        Ok(true) => err(
            StatusCode::CONFLICT,
            "Direct patient deletion is disabled. Use the DSGVO compliance workflow.",
        ),
        Ok(false) => err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, "Failed to validate patient deletion");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient deletion",
            )
        }
    }
}
