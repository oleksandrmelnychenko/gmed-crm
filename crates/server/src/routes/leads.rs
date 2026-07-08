use axum::{
    Json, Router,
    body::Body,
    extract::{Extension, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_BUNDLE_BYTES: usize = 512 * 1024;
const MAX_ATTACHMENTS: usize = 20;

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

pub fn public_router() -> Router<AppState> {
    Router::new().route("/public/lead-intake", post(ingest_lead_intake))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/leads", get(list_leads).post(create_lead))
        .route("/leads/{lead_id}", get(get_lead))
        .route("/leads/{lead_id}/update", post(update_lead))
        .route(
            "/leads/{lead_id}/promote-console",
            post(promote_lead_to_console),
        )
        .route("/leads/{lead_id}/qualify", post(qualify_lead))
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

// ----------------------------------------------------------------------------
// Authenticated CRUD
// ----------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateLeadRequest {
    first_name: String,
    last_name: String,
    email: Option<String>,
    phone: Option<String>,
    source: Option<String>,
    country: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct QualifyRequest {
    status: String,
}

#[derive(Deserialize)]
struct FailedLeadResolutionRequest {
    resolution: String,
    reason: String,
    note: Option<String>,
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
    last_name: Option<String>,
    street_address: Option<String>,
    city: Option<String>,
    zip_code: Option<String>,
    needs_interpreter: Option<bool>,
    primary_concern_text: Option<String>,
    additional_concerns: Option<String>,
    selected_program: Option<String>,
    services: Option<Vec<String>>,
    requested_specialties: Option<serde_json::Value>,
    wizard_state: Option<serde_json::Value>,
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

async fn list_leads(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListLeadsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
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
    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let source_pattern = format!("%{}%", query.source.unwrap_or_default());
    let country_pattern = format!("%{}%", query.country.unwrap_or_default());

    match sqlx::query(
        r#"SELECT id, first_name, last_name, email, phone, source, country,
                  intake_source, flow, qualification_status, compliance_status,
                  converted_patient_id, date_of_birth, legal_sex,
                  consent_privacy_practices, consent_healthcare,
                  submitted_at, created_at, console_promoted_at, console_promoted_by,
                  failed_outcome_status, failed_reason, failed_processed_at,
                  (SELECT COUNT(*) FROM lead_attachments a WHERE a.lead_id = leads.id) AS attachment_count
           FROM leads
           WHERE ($1::bool = true OR qualification_status != 'archived')
             AND ($2::text IS NULL OR qualification_status = $2)
             AND (
                $3::text = '%%'
                OR de_normalize(concat_ws(' ',
                     first_name, middle_name, last_name,
                     email, phone, whatsapp_number,
                     city, country, source,
                     notes, message, primary_concern_text,
                     additional_concerns, selected_program
                   )) LIKE de_normalize($3)
                OR (length(regexp_replace($3, '\D', '', 'g')) >= 3
                    AND phone_digits(concat_ws(' ', phone, whatsapp_number)) LIKE '%' || regexp_replace($3, '\D', '', 'g') || '%')
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
                    OR lower(replace(COALESCE(source, ''), ' ', '_')) IN ('website_wizard', 'visitor_facade') THEN 'questionnaire'
                  ELSE 'console'
                END = $7)
             AND ($8::text IS NULL OR flow = $8)
           ORDER BY created_at DESC
           LIMIT 200"#,
    )
    .bind(include_archived)
    .bind(query.status)
    .bind(search_pattern)
    .bind(source_pattern)
    .bind(country_pattern)
    .bind(query.intake_source)
    .bind(query.lead_type)
    .bind(query.flow)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut leads = Vec::with_capacity(rows.len());
            for r in rows {
                // conversion_ready is surfaced on the list payload so the
                // `Convert` button on the leads card can reflect the same
                // gate the backend enforces, without making the user click
                // through and wait for a 422. The full readiness object
                // stays on the detail endpoint — we only lift the single
                // boolean here to keep the list payload light.
                let readiness = build_lead_conversion_readiness(&r);
                leads.push(json!({
                    "id": r.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "first_name": r.try_get::<String, _>("first_name").unwrap_or_default(),
                    "last_name": r.try_get::<String, _>("last_name").unwrap_or_default(),
                    "email": r.try_get::<Option<String>, _>("email").unwrap_or_default(),
                    "phone": r.try_get::<Option<String>, _>("phone").unwrap_or_default(),
                    "source": r.try_get::<Option<String>, _>("source").unwrap_or_default(),
                    "country": r.try_get::<Option<String>, _>("country").unwrap_or_default(),
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
                    "compliance_status": r.try_get::<String, _>("compliance_status").unwrap_or_default(),
                    "qualification_ready": readiness.qualification_ready,
                    "conversion_ready": readiness.conversion_ready,
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
                }));
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
        "new" | "in_progress" | "qualified" | "not_qualified" | "converted" | "archived"
    )
}

fn is_valid_lead_type(value: &str) -> bool {
    matches!(value, "form" | "questionnaire" | "console")
}

fn normalize_lead_origin(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_")
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
    }) || source
        .as_deref()
        .is_some_and(|value| matches!(value, "website_wizard" | "visitor_facade"))
    {
        return "questionnaire";
    }

    "console"
}

fn is_valid_compliance_status(value: &str) -> bool {
    matches!(value, "pending" | "documents_sent" | "signed" | "rejected")
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

#[derive(Default)]
struct LeadConversionReadinessInput {
    qualification_status: String,
    compliance_status: String,
    converted_patient_id: Option<Uuid>,
    date_of_birth: Option<NaiveDate>,
    legal_sex: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    consent_privacy_practices: bool,
    consent_healthcare: bool,
}

fn evaluate_lead_conversion_readiness(
    input: &LeadConversionReadinessInput,
) -> LeadConversionReadiness {
    let lead_qualified = input.qualification_status == "qualified";
    let compliance_completed = input.compliance_status == "signed";
    let birth_date_present = input.date_of_birth.is_some();
    let legal_sex_present = input.legal_sex.as_deref().is_some_and(is_valid_legal_sex);
    let primary_contact_present = input
        .email
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || input
            .phone
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());

    let checks = vec![
        json!({
            "key": "lead_qualified",
            "label": "Lead qualified",
            "passed": lead_qualified,
            "blocking_for": "conversion",
        }),
        json!({
            "key": "compliance_completed",
            "label": "Compliance completed",
            "passed": compliance_completed,
            "blocking_for": "qualification",
        }),
        json!({
            "key": "birth_date_present",
            "label": "Birth date captured",
            "passed": birth_date_present,
            "blocking_for": "qualification",
        }),
        json!({
            "key": "legal_sex_present",
            "label": "Legal sex captured",
            "passed": legal_sex_present,
            "blocking_for": "qualification",
        }),
        json!({
            "key": "primary_contact_present",
            "label": "Primary contact available",
            "passed": primary_contact_present,
            "blocking_for": "qualification",
        }),
        json!({
            "key": "privacy_consent",
            "label": "Privacy practices accepted",
            "passed": input.consent_privacy_practices,
            "blocking_for": "qualification",
        }),
        json!({
            "key": "healthcare_consent",
            "label": "Healthcare consent captured",
            "passed": input.consent_healthcare,
            "blocking_for": "qualification",
        }),
    ];

    let mut qualification_reasons = Vec::new();
    if !compliance_completed {
        qualification_reasons.push("Compliance is not signed yet".to_string());
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

    let qualification_ready = qualification_reasons.is_empty();
    let mut conversion_reasons = qualification_reasons.clone();
    if !lead_qualified {
        conversion_reasons.insert(0, "Lead must be qualified before conversion".to_string());
    }
    if input.converted_patient_id.is_some() {
        conversion_reasons.push("Lead is already converted".to_string());
    }
    let conversion_ready = conversion_reasons.is_empty();

    LeadConversionReadiness {
        qualification_ready,
        conversion_ready,
        qualification_reasons: qualification_reasons.clone(),
        conversion_reasons: conversion_reasons.clone(),
        payload: json!({
            "qualification_ready": qualification_ready,
            "conversion_ready": conversion_ready,
            "qualification_reasons": qualification_reasons,
            "blocking_reasons": conversion_reasons,
            "checks": checks,
        }),
    }
}

fn build_lead_conversion_readiness(row: &sqlx::postgres::PgRow) -> LeadConversionReadiness {
    evaluate_lead_conversion_readiness(&LeadConversionReadinessInput {
        qualification_status: row.try_get("qualification_status").unwrap_or_default(),
        compliance_status: row.try_get("compliance_status").unwrap_or_default(),
        converted_patient_id: row.try_get("converted_patient_id").unwrap_or_default(),
        date_of_birth: row.try_get("date_of_birth").unwrap_or_default(),
        legal_sex: row.try_get("legal_sex").unwrap_or_default(),
        email: row.try_get("email").unwrap_or_default(),
        phone: row.try_get("phone").unwrap_or_default(),
        consent_privacy_practices: row.try_get("consent_privacy_practices").unwrap_or(false),
        consent_healthcare: row.try_get("consent_healthcare").unwrap_or(false),
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
                  consent_privacy_practices,
                  consent_healthcare
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

    Ok(row.as_ref().map(build_lead_conversion_readiness))
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
        "can_resolve_failed": failed_outcome_status != "delete_anonymized"
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

async fn create_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateLeadRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    if body.first_name.trim().is_empty() || body.last_name.trim().is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Name required");
    }

    match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, source, country,
                notes, created_by, intake_source
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')
           RETURNING id"#,
    )
    .bind(body.first_name.trim())
    .bind(body.last_name.trim())
    .bind(body.email.as_deref())
    .bind(body.phone.as_deref())
    .bind(body.source.as_deref())
    .bind(body.country.as_deref())
    .bind(body.notes.as_deref())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => {
            state.audit_sender.try_send(audit::domain_event(
                "create_lead",
                Some(auth.user_id),
                "lead",
                Some(id),
                json!({}),
            ));
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
            (StatusCode::CREATED, Json(json!({ "id": id }))).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "create lead");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn get_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    let row = match sqlx::query(
        r#"SELECT id, first_name, middle_name, last_name, suffix,
                  date_of_birth, legal_sex,
                  email, email_consent, phone, primary_phone_type, phones,
                  whatsapp_consent, whatsapp_number,
                  source, country, street_address, city, state, zip_code,
                  primary_language, needs_interpreter,
                  location, location_detailed, wants_membership, selected_program,
                  can_travel, has_medical_records, records_in_accepted_language,
                  has_travel_documents, currently_in_treatment, has_health_risk_for_travel,
                  primary_concern_text, additional_concerns,
                  services, has_insurance, insurance_covers_germany,
                  preferred_location, visit_timing, message,
                  consent_automated_contact, consent_healthcare,
                  consent_opt_out, consent_privacy_practices,
                  raw_payload, intake_source, flow, locale, submitted_at,
                  console_promoted_at, console_promoted_by,
                  compliance_status, qualification_status, converted_patient_id,
                  failed_outcome_status, failed_from_status, failed_reason, failed_note,
                  failed_processed_at, failed_processed_by,
                  notes, user_agent, created_at, updated_at,
                  requested_specialties, wizard_state
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
        r#"SELECT id, file_name, content_type, size_bytes, uploaded_at
           FROM lead_attachments
           WHERE lead_id = $1
           ORDER BY uploaded_at ASC"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
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
        "converted_patient_id".into(),
        row.try_get::<Option<Uuid>, _>("converted_patient_id")
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
    let readiness = build_lead_conversion_readiness(&row);
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

    Json(Value::Object(obj)).into_response()
}

async fn update_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<UpdateLeadRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
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

    let legal_sex = body.legal_sex.as_deref().map(str::to_lowercase);
    if let Some(ref value) = legal_sex
        && !is_valid_legal_sex(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid legal_sex");
    }

    let date_of_birth = match body.date_of_birth.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            match NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d") {
                Ok(value) => Some(value),
                Err(_) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid date_of_birth (YYYY-MM-DD)",
                    );
                }
            }
        }
        _ => None,
    };

    let first_name = match body.first_name.as_deref() {
        Some(value) if value.trim().is_empty() => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "first_name cannot be empty");
        }
        Some(value) => Some(value.trim().to_string()),
        None => None,
    };
    let last_name = match body.last_name.as_deref() {
        Some(value) if value.trim().is_empty() => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "last_name cannot be empty");
        }
        Some(value) => Some(value.trim().to_string()),
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
        && body.last_name.is_none()
        && body.street_address.is_none()
        && body.city.is_none()
        && body.zip_code.is_none()
        && body.needs_interpreter.is_none()
        && body.primary_concern_text.is_none()
        && body.additional_concerns.is_none()
        && body.selected_program.is_none()
        && body.services.is_none()
        && body.requested_specialties.is_none()
        && body.wizard_state.is_none()
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "No lead changes supplied");
    }

    match sqlx::query(
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
               wizard_state = COALESCE($23::jsonb, wizard_state)
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(body.email.as_deref())
    .bind(body.phone.as_deref())
    .bind(body.country.as_deref())
    .bind(body.primary_language.as_deref())
    .bind(date_of_birth)
    .bind(legal_sex)
    .bind(compliance_status)
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
    .bind(body.requested_specialties.as_ref().map(|value| value.to_string()))
    .bind(body.wizard_state.as_ref().map(|value| value.to_string()))
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            let readiness = match load_lead_conversion_readiness(&state, lead_id).await {
                Ok(Some(value)) => value,
                Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
                Err(resp) => return resp,
            };

            state.audit_sender.try_send(audit::domain_event(
                "update_lead",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({
                    "compliance_status": body.compliance_status,
                    "date_of_birth": body.date_of_birth,
                    "legal_sex": body.legal_sex,
                    "contact_updated": body.email.is_some() || body.phone.is_some(),
                    "consent_healthcare": body.consent_healthcare,
                    "consent_privacy_practices": body.consent_privacy_practices,
                }),
            ));
            crate::realtime::publish_lead_event(
                &state,
                Some(auth.user_id),
                "lead.updated",
                lead_id,
                json!({
                    "compliance_status": body.compliance_status,
                    "date_of_birth": body.date_of_birth,
                    "legal_sex": body.legal_sex,
                    "contact_updated": body.email.is_some() || body.phone.is_some(),
                    "consent_healthcare": body.consent_healthcare,
                    "consent_privacy_practices": body.consent_privacy_practices,
                }),
            )
            .await;

            Json(json!({
                "ok": true,
                "readiness": readiness.payload,
            }))
            .into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, lead_id = %lead_id, "update lead");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn promote_lead_to_console(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
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

    if current
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .unwrap_or_default()
        .is_some()
    {
        return err(
            StatusCode::CONFLICT,
            "Converted leads cannot be promoted to console",
        );
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

    match sqlx::query(
        r#"UPDATE leads
           SET console_promoted_at = COALESCE(console_promoted_at, now()),
               console_promoted_by = COALESCE(console_promoted_by, $2),
               created_by = COALESCE(created_by, $2),
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "promote_lead_to_console",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({
                    "previous_lead_type": previous_type,
                    "lead_type": "console",
                }),
            ));

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
        Ok(_) => err(StatusCode::NOT_FOUND, "Lead not found"),
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    match body.status.as_str() {
        "new" | "in_progress" | "qualified" | "not_qualified" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status"),
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

    if converted_patient_id.is_some() {
        return err(StatusCode::CONFLICT, "Lead is already converted");
    }
    if failed_outcome_status == "delete_anonymized" {
        return err(
            StatusCode::CONFLICT,
            "Lead payload is already deleted via failed-lead workflow",
        );
    }
    if current_status == "archived" && body.status != current_status {
        return err(
            StatusCode::CONFLICT,
            "Archived leads must be handled through the failed-lead workflow",
        );
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

    match sqlx::query("UPDATE leads SET qualification_status = $2 WHERE id = $1")
        .bind(lead_id)
        .bind(&body.status)
        .execute(&state.db)
        .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "qualify_lead",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({ "status": body.status.clone() }),
            ));
            if current_status != body.status
                && let Err(resp) = crate::routes::workflow_lifecycle::record_event(
                    &state,
                    crate::routes::workflow_lifecycle::RecordEvent {
                        entity_type: "lead",
                        entity_id: lead_id,
                        from_stage: Some(current_status.as_str()),
                        to_stage: &body.status,
                        transition_kind: "status_change",
                        changed_by: Some(auth.user_id),
                        note: None,
                        metadata: json!({
                            "status": body.status.clone(),
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
        Ok(_) => err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, "qualify lead");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn convert_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }

    let lead = match sqlx::query(
        r#"SELECT id, first_name, last_name, email, phone, country, primary_language,
                  date_of_birth, legal_sex, qualification_status, converted_patient_id,
                  failed_outcome_status
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
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
    if converted_patient_id.is_some() {
        return err(StatusCode::CONFLICT, "Lead already converted");
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

    let readiness = match load_lead_conversion_readiness(&state, lead_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(resp) => return resp,
    };
    if !readiness.conversion_ready {
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

    let seq: i64 = sqlx::query_scalar::<_, i64>(r#"SELECT nextval('patient_id_seq')"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let pid = format!("P-{}-{:04}", chrono::Utc::now().format("%Y%m%d"), seq);

    let first_name: String = lead.try_get("first_name").unwrap_or_default();
    let last_name: String = lead.try_get("last_name").unwrap_or_default();
    let email: Option<String> = lead.try_get("email").ok().flatten();
    let phone: Option<String> = lead.try_get("phone").ok().flatten();
    let country: Option<String> = lead.try_get("country").ok().flatten();
    let primary_language: Option<String> = lead.try_get("primary_language").ok().flatten();
    let languages: Vec<String> = primary_language.into_iter().collect();

    let patient_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender,
                                 email, phone_primary, nationality, languages, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id"#,
    )
    .bind(&pid)
    .bind(&first_name)
    .bind(&last_name)
    .bind(birth_date)
    .bind(gender)
    .bind(email)
    .bind(phone)
    .bind(country)
    .bind(&languages)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "create patient from lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let _ = sqlx::query(
        "UPDATE leads SET qualification_status = 'converted', converted_patient_id = $2 WHERE id = $1",
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&state.db)
    .await;

    let _ = sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await;

    if let Err(resp) = crate::routes::workflow_checklists::ensure_default_patient_workflow(
        &state,
        patient_id,
        Some(auth.user_id),
    )
    .await
    {
        return resp;
    }

    state.audit_sender.try_send(audit::domain_event(
        "convert_lead",
        Some(auth.user_id),
        "lead",
        Some(lead_id),
        json!({ "patient_id": patient_id, "patient_pid": pid.clone() }),
    ));
    let previous_status: String = lead.try_get("qualification_status").unwrap_or_default();
    if let Err(resp) = crate::routes::workflow_lifecycle::record_event(
        &state,
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
        return resp;
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

/// Shared tail for a lead→patient conversion: mark the lead converted (sticky),
/// self-assign the operator, seed the patient workflow, and emit
/// audit/lifecycle/realtime events. Returns an error response on a hard failure.
async fn finalize_lead_conversion(
    state: &AppState,
    auth: &AuthUser,
    lead_id: Uuid,
    previous_status: &str,
    patient_id: Uuid,
    pid: &str,
) -> Result<(), axum::response::Response> {
    let _ = sqlx::query(
        "UPDATE leads SET qualification_status = 'converted', converted_patient_id = $2 WHERE id = $1",
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&state.db)
    .await;

    let _ = sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await;

    crate::routes::workflow_checklists::ensure_default_patient_workflow(
        state,
        patient_id,
        Some(auth.user_id),
    )
    .await?;

    state.audit_sender.try_send(audit::domain_event(
        "convert_lead",
        Some(auth.user_id),
        "lead",
        Some(lead_id),
        json!({ "patient_id": patient_id, "patient_pid": pid }),
    ));

    crate::routes::workflow_lifecycle::record_event(
        state,
        crate::routes::workflow_lifecycle::RecordEvent {
            entity_type: "lead",
            entity_id: lead_id,
            from_stage: Some(previous_status),
            to_stage: "converted",
            transition_kind: "converted",
            changed_by: Some(auth.user_id),
            note: Some("Lead converted to patient"),
            metadata: json!({ "patient_id": patient_id, "patient_pid": pid }),
        },
    )
    .await?;

    crate::realtime::publish_lead_event(
        state,
        Some(auth.user_id),
        "lead.converted",
        lead_id,
        json!({ "patient_id": patient_id, "patient_pid": pid }),
    )
    .await;
    crate::realtime::publish_patient_event(
        state,
        Some(auth.user_id),
        "patient.created",
        patient_id,
        json!({ "patient_pid": pid, "source_lead_id": lead_id }),
    )
    .await;

    Ok(())
}

/// Wizard conversion path (convert-then-comply, design decision D2): converts a
/// lead into a patient once identity basics are present — date of birth, a valid
/// legal sex, and an email or phone — WITHOUT requiring compliance to be signed
/// or the lead to be `qualified`. Those steps happen later against the patient
/// inside the wizard. Carries over the lead's address on top of the standard copy.
async fn wizard_convert_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }

    let lead = match sqlx::query(
        r#"SELECT id, first_name, last_name, email, phone, country, primary_language,
                  date_of_birth, legal_sex, qualification_status, converted_patient_id,
                  failed_outcome_status, street_address, city, zip_code
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(l)) => l,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, "wizard convert lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let converted_patient_id: Option<Uuid> = lead.try_get("converted_patient_id").ok().flatten();
    if converted_patient_id.is_some() {
        return err(StatusCode::CONFLICT, "Lead already converted");
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
    let email: Option<String> = lead.try_get("email").ok().flatten();
    let phone: Option<String> = lead.try_get("phone").ok().flatten();
    let has_contact = email.as_deref().is_some_and(|v| !v.trim().is_empty())
        || phone.as_deref().is_some_and(|v| !v.trim().is_empty());
    if !has_contact {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Lead needs an email or phone before conversion",
        );
    }

    let seq: i64 = sqlx::query_scalar::<_, i64>(r#"SELECT nextval('patient_id_seq')"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let pid = format!("P-{}-{:04}", chrono::Utc::now().format("%Y%m%d"), seq);

    let first_name: String = lead.try_get("first_name").unwrap_or_default();
    let last_name: String = lead.try_get("last_name").unwrap_or_default();
    let country: Option<String> = lead.try_get("country").ok().flatten();
    let primary_language: Option<String> = lead.try_get("primary_language").ok().flatten();
    let languages: Vec<String> = primary_language.into_iter().collect();
    let street_address: Option<String> = lead.try_get("street_address").ok().flatten();
    let city: Option<String> = lead.try_get("city").ok().flatten();
    let zip_code: Option<String> = lead.try_get("zip_code").ok().flatten();

    let patient_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender,
                                 email, phone_primary, nationality, languages,
                                 address_street, address_city, address_zip, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id"#,
    )
    .bind(&pid)
    .bind(&first_name)
    .bind(&last_name)
    .bind(birth_date)
    .bind(gender)
    .bind(email)
    .bind(phone)
    .bind(country)
    .bind(&languages)
    .bind(street_address)
    .bind(city)
    .bind(zip_code)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "wizard create patient from lead");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let previous_status: String = lead.try_get("qualification_status").unwrap_or_default();
    if let Err(resp) =
        finalize_lead_conversion(&state, &auth, lead_id, &previous_status, patient_id, &pid).await
    {
        return resp;
    }

    tracing::info!(by = %auth.user_id, lead = %lead_id, patient = %patient_id, "Lead wizard-converted to patient");

    Json(json!({ "patient_id": patient_id, "patient_pid": pid })).into_response()
}

async fn resolve_failed_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<FailedLeadResolutionRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::Ceo]) {
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

    let current = match sqlx::query(
        r#"SELECT qualification_status,
                  converted_patient_id,
                  failed_outcome_status
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

    if converted_patient_id.is_some() {
        return err(
            StatusCode::CONFLICT,
            "Converted leads cannot enter the failed-lead workflow",
        );
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

    let update_result = if resolution == "archive" {
        sqlx::query(
            r#"UPDATE leads
               SET qualification_status = 'archived',
                   failed_outcome_status = 'archived',
                   failed_from_status = $2,
                   failed_reason = $3,
                   failed_note = $4,
                   failed_processed_at = now(),
                   failed_processed_by = $5
               WHERE id = $1"#,
        )
        .bind(lead_id)
        .bind(current_status.clone())
        .bind(reason)
        .bind(note)
        .bind(auth.user_id)
        .execute(&state.db)
        .await
    } else {
        let deleted_result = anonymize_lead_pii(
            &state.db,
            lead_id,
            Some(current_status.clone()),
            reason,
            note,
            Some(auth.user_id),
        )
        .await;

        if let Ok(result) = &deleted_result
            && result.rows_affected() > 0
        {
            let _ = sqlx::query("DELETE FROM lead_attachments WHERE lead_id = $1")
                .bind(lead_id)
                .execute(&state.db)
                .await;
        }

        deleted_result
    };

    match update_result {
        Ok(result) if result.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "resolve_failed_lead",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({
                    "resolution": resolution.clone(),
                    "reason": reason,
                    "note": note,
                    "failed_from_status": current_status.clone(),
                }),
            ));

            if let Err(resp) = crate::routes::workflow_lifecycle::record_event(
                &state,
                crate::routes::workflow_lifecycle::RecordEvent {
                    entity_type: "lead",
                    entity_id: lead_id,
                    from_stage: Some(current_status.as_str()),
                    to_stage: lifecycle_stage,
                    transition_kind: if resolution == "archive" {
                        "archived"
                    } else {
                        "deleted"
                    },
                    changed_by: Some(auth.user_id),
                    note: Some(reason),
                    metadata: json!({
                        "resolution": outcome_status,
                        "note": note,
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
                "lead.failed_resolved",
                lead_id,
                json!({
                    "resolution": outcome_status,
                    "reason": reason,
                    "note": note,
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT file_name, content_type, data
           FROM lead_attachments
           WHERE id = $1 AND lead_id = $2"#,
    )
    .bind(attachment_id)
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let file_name: String = row.try_get("file_name").unwrap_or_default();
            let content_type: Option<String> = row.try_get("content_type").ok().flatten();
            let data: Vec<u8> = row.try_get("data").unwrap_or_default();

            let mime = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
            let disposition = format!("attachment; filename=\"{}\"", file_name.replace('"', "'"));

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
    std::env::var(name)
        .ok()
        .and_then(|v| if v.trim().is_empty() { None } else { Some(v) })
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
    if provided != expected.as_str() {
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

    let parsed = match parse_multipart(multipart).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };

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
    let services = string_array(&payload["services"]);
    let phones_json = if payload["phones"].is_array() {
        payload["phones"].clone()
    } else {
        json!([])
    };

    let submitted_at = parsed.bundle.get("submittedAt").and_then(str_opt);
    let flow = parsed.bundle.get("flow").and_then(str_opt);
    let locale = parsed.bundle.get("locale").and_then(str_opt);
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
    .bind(date_opt(&payload["dateOfBirth"]))
    .bind(str_opt(&payload["legalSex"]))
    .bind(str_opt(&payload["email"]))
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
    .bind(str_opt(&payload["primaryLanguage"]))
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
async fn anonymize_lead_pii(
    pool: &gmed_db::DbPool,
    lead_id: Uuid,
    failed_from_status: Option<String>,
    reason: &str,
    note: Option<&str>,
    processed_by: Option<Uuid>,
) -> Result<sqlx::postgres::PgQueryResult, sqlx::Error> {
    sqlx::query(
        r#"UPDATE leads
           SET first_name = 'Deleted',
               middle_name = NULL,
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
               qualification_status = 'archived',
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
    .bind(note)
    .bind(processed_by)
    .execute(pool)
    .await
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

/// Run one purge sweep: find every lead that has been sitting in an
/// archived/failed state past the retention window, anonymise it, delete
/// its attachments, and emit an `auto_purge_lead` audit event for each
/// anonymised row.
pub async fn auto_purge_stale_archived(
    state: &crate::state::AppState,
) -> Result<LeadPurgeReport, sqlx::Error> {
    let retention_days = load_archived_lead_retention_days(&state.db).await;

    // Coarse filtering happens in SQL. The WHERE clause here mirrors the
    // guards in `should_auto_purge` — if you edit one, edit both.
    let candidates: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id FROM leads
        WHERE qualification_status IN ('archived', 'not_qualified')
          AND COALESCE(failed_outcome_status, 'none') != 'delete_anonymized'
          AND first_name != $2
          AND COALESCE(failed_processed_at, updated_at)
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

    for lead_id in candidates {
        match anonymize_lead_pii(
            &state.db,
            lead_id,
            None,
            "auto_purge_storage_limitation",
            Some("Auto-purged per cleanup_archived_leads_days retention"),
            None,
        )
        .await
        {
            Ok(result) if result.rows_affected() > 0 => {
                report.anonymized += 1;
                let _ = sqlx::query("DELETE FROM lead_attachments WHERE lead_id = $1")
                    .bind(lead_id)
                    .execute(&state.db)
                    .await;
                state.audit_sender.try_send(audit::domain_event(
                    "auto_purge_lead",
                    None,
                    "lead",
                    Some(lead_id),
                    json!({
                        "reason": "storage_limitation_retention",
                        "retention_days": retention_days,
                        "gdpr_article": "5(1)(e)",
                    }),
                ));
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

#[cfg(test)]
mod lead_conversion_readiness_tests {
    use super::*;

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
            consent_privacy_practices: true,
            consent_healthcare: true,
        }
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
