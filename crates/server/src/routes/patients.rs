use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;
use sqlx::types::Json as SqlxJson;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/patients", get(list_patients).post(create_patient))
        .route("/patients/{patient_id}", get(get_patient))
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
            "/patients/{patient_id}/framework-contracts",
            get(list_patient_framework_contracts),
        )
        .route(
            "/patients/{patient_id}/invoices",
            get(list_patient_invoices),
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
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePatientRequest {
    title: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Option<Vec<String>>,
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
    legal_status: Option<Value>,
    notes: Option<String>,
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

fn validate_create(req: &CreatePatientRequest) -> Result<(), &'static str> {
    if req.first_name.is_empty() || req.first_name.len() > 200 {
        return Err("First name required (max 200)");
    }
    if req.last_name.is_empty() || req.last_name.len() > 200 {
        return Err("Last name required (max 200)");
    }
    if req.birth_date.is_empty() {
        return Err("Birth date required");
    }
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
                  p.languages, p.phone_primary, p.email,
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
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    match sqlx::query!(
        r#"SELECT id, patient_id, title, first_name, last_name,
                  birth_date, gender, nationality, residence_country,
                  languages, phone_primary, phone_secondary, email,
                  address_street, address_city, address_zip, address_country,
                  insurance_provider, insurance_number, insurance_type,
                  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
                  legal_status, notes, is_active, created_at, updated_at
           FROM patients WHERE id = $1"#,
        patient_uuid
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(r)) => {
            if !has_patient_access(&state, &auth, r.id).await? {
                return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
            }

            let policies = load_patient_field_policies(&state, &auth).await?;
            let patient_json = build_patient_detail_json(
                &auth,
                &policies,
                PatientDetailInput {
                    id: r.id,
                    patient_id: r.patient_id,
                    title: r.title,
                    first_name: r.first_name,
                    last_name: r.last_name,
                    birth_date: r.birth_date,
                    gender: r.gender,
                    nationality: r.nationality,
                    residence_country: r.residence_country,
                    languages: r.languages,
                    phone_primary: r.phone_primary,
                    phone_secondary: r.phone_secondary,
                    email: r.email,
                    address_street: r.address_street,
                    address_city: r.address_city,
                    address_zip: r.address_zip,
                    address_country: r.address_country,
                    insurance_provider: r.insurance_provider,
                    insurance_number: r.insurance_number,
                    insurance_type: r.insurance_type,
                    emergency_contact_name: r.emergency_contact_name,
                    emergency_contact_phone: r.emergency_contact_phone,
                    emergency_contact_relation: r.emergency_contact_relation,
                    legal_status: r.legal_status,
                    notes: r.notes,
                    is_active: r.is_active,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                },
            );
            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'view_patient', 'patient', $2, $3)",
            )
            .bind(auth.user_id)
            .bind(patient_uuid)
            .bind(json!({
                "role": auth.role,
                "visible_fields": collect_visible_fields(&patient_json),
            }))
            .execute(&state.db)
            .await;

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

    let birth_date =
        chrono::NaiveDate::parse_from_str(&body.birth_date, "%Y-%m-%d").map_err(|_| {
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
    let langs = body.languages.unwrap_or_default();

    let row = sqlx::query!(
        r#"INSERT INTO patients (
            patient_id, title, first_name, last_name, birth_date, gender,
            nationality, residence_country, languages,
            phone_primary, phone_secondary, email,
            address_street, address_city, address_zip, address_country,
            insurance_provider, insurance_number, insurance_type,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
            notes, created_by
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23, $24
        ) RETURNING id, patient_id, created_at"#,
        pid,
        body.title,
        body.first_name,
        body.last_name,
        birth_date,
        body.gender,
        body.nationality,
        body.residence_country,
        &langs,
        body.phone_primary,
        body.phone_secondary,
        body.email,
        body.address_street,
        body.address_city,
        body.address_zip,
        body.address_country,
        body.insurance_provider,
        body.insurance_number,
        body.insurance_type,
        body.emergency_contact_name,
        body.emergency_contact_phone,
        body.emergency_contact_relation,
        body.notes,
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

    sqlx::query!(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
        row.id,
        auth.user_id
    )
    .execute(&state.db)
    .await
    .ok();

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'create_patient', 'patient', $2, $3)",
        auth.user_id,
        row.id,
        serde_json::json!({ "patient_id": row.patient_id })
    )
    .execute(&state.db)
    .await;

    tracing::info!(by = %auth.user_id, patient = %row.patient_id, "Patient created");

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

    let current = match sqlx::query!(
        "SELECT first_name, last_name FROM patients WHERE id = $1",
        patient_uuid
    )
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

    let first = body.first_name.as_deref().unwrap_or(&current.first_name);
    let last = body.last_name.as_deref().unwrap_or(&current.last_name);
    let legal_status = match body.legal_status {
        Some(value) => match normalize_legal_status(value) {
            Ok(value) => Some(SqlxJson(value)),
            Err(response) => return response,
        },
        None => None,
    };
    let legal_status_updated = legal_status.is_some();
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
            title = COALESCE($2, title),
            first_name = $3, last_name = $4,
            phone_primary = COALESCE($5, phone_primary),
            phone_secondary = COALESCE($6, phone_secondary),
            email = COALESCE($7, email),
            nationality = COALESCE($8, nationality),
            residence_country = COALESCE($9, residence_country),
            languages = COALESCE($10, languages),
            address_street = COALESCE($11, address_street),
            address_city = COALESCE($12, address_city),
            address_zip = COALESCE($13, address_zip),
            address_country = COALESCE($14, address_country),
            insurance_provider = COALESCE($15, insurance_provider),
            insurance_number = COALESCE($16, insurance_number),
            insurance_type = COALESCE($17, insurance_type),
            emergency_contact_name = COALESCE($18, emergency_contact_name),
            emergency_contact_phone = COALESCE($19, emergency_contact_phone),
            emergency_contact_relation = COALESCE($20, emergency_contact_relation),
            legal_status = COALESCE($21::jsonb, legal_status),
            notes = COALESCE($22, notes),
            updated_at = now()
        WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .bind(body.title)
    .bind(first)
    .bind(last)
    .bind(body.phone_primary)
    .bind(body.phone_secondary)
    .bind(body.email)
    .bind(body.nationality)
    .bind(body.residence_country)
    .bind(body.languages)
    .bind(body.address_street)
    .bind(body.address_city)
    .bind(body.address_zip)
    .bind(body.address_country)
    .bind(body.insurance_provider)
    .bind(body.insurance_number)
    .bind(body.insurance_type)
    .bind(body.emergency_contact_name)
    .bind(body.emergency_contact_phone)
    .bind(body.emergency_contact_relation)
    .bind(legal_status)
    .bind(body.notes)
    .execute(&state.db)
    .await;

    let audit_context = serde_json::json!({
        "legal_status_updated": legal_status_updated,
        "contract_status": contract_status,
        "compliance_completed": compliance_completed,
    });

    match result {
        Ok(_) => {
            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'update_patient', 'patient', $2, $3)",
            )
            .bind(auth.user_id)
            .bind(patient_uuid)
            .bind(audit_context)
            .execute(&state.db)
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
        r#"SELECT a.id, a.title, a.date, a.time_start, a.appointment_type, a.status,
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

async fn list_patient_framework_contracts(
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

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'generate_patient_label', 'patient', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(patient_uuid)
    .bind(json!({
        "format": format.id,
        "country_code": country_code,
    }))
    .execute(&state.db)
    .await;

    Ok(Json(payload))
}

async fn list_patient_invoices(
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

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'create_patient_relation', 'patient', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(patient_uuid)
    .bind(serde_json::json!({
        "relation_id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "relation_type": body.relation_type,
        "related_patient_id": body.related_patient_id
    }))
    .execute(&state.db)
    .await;

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

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'update_patient_relation', 'patient', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(patient_uuid)
    .bind(serde_json::json!({
        "relation_id": relation_id,
        "relation_type": body.relation_type,
        "related_patient_id": body.related_patient_id
    }))
    .execute(&state.db)
    .await;

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

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'delete_patient_relation', 'patient', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(patient_uuid)
    .bind(serde_json::json!({ "relation_id": relation_id }))
    .execute(&state.db)
    .await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn get_patient_timeline(
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
        r#"SELECT *
           FROM (
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
                           ELSE 'Legal/compliance status updated'
                       END AS title,
                       CASE
                           WHEN al.action = 'dsgvo_data_export' THEN 'dsgvo_export'
                           WHEN al.action = 'dsgvo_anonymize' THEN 'dsgvo_anonymize'
                           WHEN al.action LIKE 'privacy_request_%' THEN 'privacy_request'
                           WHEN al.action IN ('consent_granted', 'consent_revoked') THEN 'consent'
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
                            'privacy_request_created',
                            'privacy_request_reviewed',
                            'privacy_request_executed'
                        )
                        OR (
                            al.action = 'update_patient'
                            AND COALESCE((al.context->>'legal_status_updated')::boolean, false)
                        )
                  )
           ) events
           ORDER BY happened_at DESC, entity_type, entity_id"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient timeline");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient timeline",
        )
    })?;

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

    Ok(Json(items))
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

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'assign_patient', 'patient', $2, $3)",
        auth.user_id,
        patient_uuid,
        serde_json::json!({ "assigned_to": body.user_id, "assigned_role": target_role })
    )
    .execute(&state.db)
    .await;

    tracing::info!(by = %auth.user_id, patient = %patient_uuid, to = %body.user_id, "Patient assigned");

    Ok(Json(serde_json::json!({"ok": true})))
}

#[allow(clippy::result_large_err)]
fn validate_relation_request(
    body: &UpsertRelationRequest,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if body.related_name.trim().is_empty() || body.related_name.trim().len() > 200 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Related name required (max 200)",
        ));
    }

    if let Some(related_patient_id) = body.related_patient_id
        && related_patient_id == patient_id
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Patient relation cannot point to the same patient",
        ));
    }

    match body.relation_type.trim() {
        "spouse" | "parent" | "child" | "sibling" | "relative" | "guardian" | "caregiver"
        | "friend" | "other" => {}
        _ => {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid relation type",
            ));
        }
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
    match sqlx::query!(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL",
        patient_id, body.user_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let _ = sqlx::query!(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'revoke_assignment', 'patient', $2, $3)",
                auth.user_id, patient_id, serde_json::json!({"revoked_user_id": body.user_id})
            ).execute(&state.db).await;
            tracing::info!(by = %auth.user_id, patient = %patient_id, revoked = %body.user_id, "Assignment revoked");
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
            let _ = sqlx::query!(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1, 'activate_patient', 'patient', $2)",
                auth.user_id, patient_id
            ).execute(&state.db).await;
            tracing::info!(by = %auth.user_id, patient = %patient_id, "Patient activated");
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
            let _ = sqlx::query!(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1, 'deactivate_patient', 'patient', $2)",
                auth.user_id, patient_id
            ).execute(&state.db).await;
            tracing::info!(by = %auth.user_id, patient = %patient_id, "Patient deactivated");
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
