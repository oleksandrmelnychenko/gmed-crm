use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cases", get(list_cases).post(create_case))
        .route("/cases/meta/doctors", get(list_case_doctors))
        .route(
            "/cases/text-snippets",
            get(list_case_text_snippets).post(create_case_text_snippet),
        )
        .route(
            "/cases/text-snippets/{snippet_id}/update",
            post(update_case_text_snippet),
        )
        .route("/cases/{case_id}", get(get_case_full))
        .route("/cases/{case_id}/history", get(get_case_history))
        .route("/cases/{case_id}/status", post(update_case_status))
        .route("/cases/{case_id}/anamnesis", post(update_anamnesis))
        .route(
            "/cases/{case_id}/intake-completion",
            post(update_intake_completion),
        )
        .route(
            "/cases/{case_id}/vorerkrankungen",
            post(retired_case_clinical_route),
        )
        .route(
            "/cases/{case_id}/allergien",
            post(retired_case_clinical_route),
        )
        .route(
            "/cases/{case_id}/operationen",
            post(retired_case_clinical_route),
        )
        .route(
            "/cases/{case_id}/medikamente",
            post(retired_case_clinical_route),
        )
        .route(
            "/cases/{case_id}/medikamente/{medication_id}/expiry-confirm",
            post(retired_case_medication_route),
        )
        .route("/cases/{case_id}/pain", post(save_pain_records))
        .route("/cases/{case_id}/symptome", post(save_symptome))
        .route(
            "/patients/{patient_id}/pain",
            get(get_patient_pain_records).post(save_patient_pain_records),
        )
        .route(
            "/patients/{patient_id}/symptoms",
            get(get_patient_symptoms).post(save_patient_symptoms),
        )
        .route(
            "/patients/{patient_id}/symptome",
            get(get_patient_symptoms).post(save_patient_symptoms),
        )
        .route("/cases/{case_id}/cardiology", post(save_cardiology))
        .route(
            "/cases/{case_id}/gastroenterology",
            post(save_gastroenterology),
        )
        .route("/cases/{case_id}/orthopedics", post(save_orthopedics))
        .route("/cases/{case_id}/neurology", post(save_neurology))
        .route("/cases/{case_id}/pulmonology", post(save_pulmonology))
        .route("/cases/{case_id}/urology", post(save_urology))
        .route(
            "/cases/{case_id}/vegetative",
            post(retired_case_clinical_route),
        )
        .route(
            "/cases/{case_id}/impfstatus",
            post(retired_case_clinical_route),
        )
}

async fn retired_case_clinical_route(Path(_case_uuid): Path<Uuid>) -> axum::response::Response {
    err(
        StatusCode::GONE,
        "Case clinical sections moved to the patient record (/patients/{id}/...)",
    )
}

async fn retired_case_medication_route(
    Path((_case_uuid, _medication_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    err(
        StatusCode::GONE,
        "Case medications moved to the patient record (/patients/{id}/medications)",
    )
}

#[derive(Deserialize)]
struct CreateCaseRequest {
    patient_id: Option<Uuid>,
    lead_id: Option<Uuid>,
    hauptanfragegrund: Option<String>,
    zuweiser_doctor_id: Option<Uuid>,
    zuweiser: Option<String>,
}

#[derive(Deserialize)]
struct UpdateAnamnesisRequest {
    hauptanfragegrund: Option<String>,
    zuweiser_doctor_id: Option<Uuid>,
    zuweiser: Option<String>,
}

#[derive(Deserialize)]
struct UpdateIntakeCompletionRequest {
    completed: bool,
    hauptanfragegrund: Option<String>,
}

#[derive(Deserialize)]
struct UpdateCaseStatusRequest {
    status: String,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct CaseTextSnippetRequest {
    label: String,
    category: Option<String>,
    body: String,
    is_active: Option<bool>,
}

#[derive(Deserialize, Serialize, Clone)]
struct PainItem {
    lokalisierung: String,
    seit_wann: Option<String>,
    ursache: Option<String>,
    qualitaet: Option<String>,
    kontinuitaet: Option<String>,
    entwicklung: Option<String>,
    nrs_aktuell: Option<i32>,
    nrs_anfang: Option<i32>,
    dauer_anfang: Option<String>,
    dauer_aktuell: Option<String>,
    ausstrahlung: Option<String>,
    auftreten: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct SymptomItem {
    beschreibung: String,
    fachrichtung: Option<String>,
}

#[derive(Default, Clone, Copy, Debug)]
pub struct MedicationExpiryRunSummary {
    pub events_created: u64,
    pub notifications_created: u64,
}

const MEDICATION_EXPIRY_CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;

struct PatientMedicationExpiryCandidate {
    patient_medication_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_name: String,
    medication_name: String,
    expiry_date: chrono::NaiveDate,
}

#[derive(Deserialize, Serialize, Clone)]
struct CardiologyAssessmentRequest {
    is_relevant: Option<bool>,
    chest_pain: Option<bool>,
    dyspnea: Option<bool>,
    palpitations: Option<bool>,
    syncope: Option<bool>,
    edema: Option<bool>,
    known_diagnosis: Option<String>,
    prior_cardiac_workup: Option<String>,
    cardiovascular_risk_factors: Option<String>,
    anticoagulation: Option<String>,
    family_history: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct GastroenterologyAssessmentRequest {
    is_relevant: Option<bool>,
    abdominal_pain: Option<bool>,
    reflux: Option<bool>,
    nausea: Option<bool>,
    diarrhea: Option<bool>,
    constipation: Option<bool>,
    gi_bleeding: Option<bool>,
    prior_endoscopy: Option<String>,
    bowel_habits: Option<String>,
    liver_history: Option<String>,
    food_intolerance: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct OrthopedicsAssessmentRequest {
    is_relevant: Option<bool>,
    joint_pain: Option<bool>,
    back_pain: Option<bool>,
    mobility_limitation: Option<bool>,
    trauma_history: Option<bool>,
    prior_imaging: Option<String>,
    assistive_devices: Option<String>,
    physiotherapy_history: Option<String>,
    pain_triggers: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct NeurologyAssessmentRequest {
    is_relevant: Option<bool>,
    headache: Option<bool>,
    dizziness: Option<bool>,
    sensory_changes: Option<bool>,
    weakness: Option<bool>,
    seizure_history: Option<bool>,
    gait_balance_issues: Option<bool>,
    prior_neuro_imaging: Option<String>,
    prior_neurology_workup: Option<String>,
    cognitive_changes: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct PulmonologyAssessmentRequest {
    is_relevant: Option<bool>,
    chronic_cough: Option<bool>,
    dyspnea: Option<bool>,
    wheezing: Option<bool>,
    chest_tightness: Option<bool>,
    hemoptysis: Option<bool>,
    smoking_history: Option<String>,
    prior_chest_imaging: Option<String>,
    inhaler_therapy: Option<String>,
    sleep_apnea_history: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct UrologyAssessmentRequest {
    is_relevant: Option<bool>,
    dysuria: Option<bool>,
    hematuria: Option<bool>,
    flank_pain: Option<bool>,
    urinary_frequency: Option<bool>,
    urinary_retention: Option<bool>,
    incontinence: Option<bool>,
    prior_urology_workup: Option<String>,
    catheter_history: Option<String>,
    stone_history: Option<String>,
    red_flags: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct ItemsWrapper<T> {
    items: Vec<T>,
}

#[derive(Deserialize)]
struct ListCasesQuery {
    search: Option<String>,
    status: Option<String>,
    patient_id: Option<Uuid>,
    lead_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct CaseHistoryQuery {
    limit: Option<i64>,
}

fn gen_case_id(seq: i64) -> String {
    let now = chrono::Utc::now();
    format!("C-{}-{:04}", now.format("%Y%m%d"), seq)
}

fn normalize_case_text_snippet_label(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn normalize_case_text_snippet_body(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn normalize_case_text_snippet_category(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "general".to_string())
}

fn symptom_matches_specialty(item: &serde_json::Value, aliases: &[&str]) -> bool {
    item["fachrichtung"]
        .as_str()
        .map(|value| {
            let normalized = value.trim().to_lowercase();
            aliases
                .iter()
                .any(|alias| normalized.contains(&alias.to_lowercase()))
        })
        .unwrap_or(false)
}

async fn list_cases(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListCasesQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    if let Some(ref status) = query.status
        && !is_valid_case_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());

    match sqlx::query(
        r#"SELECT c.id, c.case_id, c.patient_id, c.lead_id, c.source_lead_id, c.manager_id,
                  c.status, c.closed_reason, c.closed_at, c.status_changed_at,
                  c.hauptanfragegrund, c.created_at,
                  COALESCE(p.first_name, l.first_name) AS first_name,
                  COALESCE(p.last_name, l.last_name) AS last_name,
                  p.patient_id AS p_pid,
                  ord.id AS linked_order_id
           FROM cases c
           LEFT JOIN patients p ON p.id = c.patient_id
           LEFT JOIN leads l ON l.id = COALESCE(c.source_lead_id, c.lead_id)
           LEFT JOIN LATERAL (
               SELECT o.id FROM orders o
               WHERE o.case_id = c.id
               ORDER BY o.created_at ASC
               LIMIT 1
           ) ord ON true
           WHERE ($1::text = '%%'
                  OR de_normalize(concat_ws(' ',
                       c.case_id, c.hauptanfragegrund, c.zuweiser,
                       p.first_name, p.last_name, p.patient_id, l.first_name, l.last_name,
                       p.email, p.phone_primary, p.phone_secondary, l.email, l.phone,
                       p.insurance_number
                     )) LIKE de_normalize($1)
                  OR (length(regexp_replace($1, '\D', '', 'g')) >= 3 AND
                      phone_digits(concat_ws(' ', p.phone_primary, p.phone_secondary, l.phone))
                      LIKE '%' || regexp_replace($1, '\D', '', 'g') || '%')
           )
             AND ($2::text IS NULL OR c.status = $2)
             AND ($3::uuid IS NULL OR c.patient_id = $3)
             AND ($4::uuid IS NULL OR c.lead_id = $4 OR c.source_lead_id = $4)
           ORDER BY c.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.status)
    .bind(query.patient_id)
    .bind(query.lead_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut cases = Vec::with_capacity(rows.len());
            for r in rows {
                let case_id = r.try_get::<Uuid, _>("id").unwrap_or_default();
                let patient_id = r
                    .try_get::<Option<Uuid>, _>("patient_id")
                    .unwrap_or_default();
                let lead_id = r.try_get::<Option<Uuid>, _>("lead_id").unwrap_or_default();
                let source_lead_id = r
                    .try_get::<Option<Uuid>, _>("source_lead_id")
                    .unwrap_or_default();

                match can_access_case_subject(&state, &auth, case_id, patient_id, lead_id).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                cases.push(serde_json::json!({
                    "id": case_id,
                    "case_uuid": case_id,
                    "case_id": r.try_get::<String, _>("case_id").unwrap_or_default(),
                    "patient_id": patient_id,
                    "lead_id": lead_id,
                    "source_lead_id": source_lead_id,
                    "linked_order_id": r.try_get::<Option<Uuid>, _>("linked_order_id").unwrap_or_default(),
                    "patient_name": format!(
                        "{} {}",
                        r.try_get::<String, _>("first_name").unwrap_or_default(),
                        r.try_get::<String, _>("last_name").unwrap_or_default()
                    ),
                    "patient_pid": r.try_get::<String, _>("p_pid").unwrap_or_default(),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "closed_reason": r.try_get::<Option<String>, _>("closed_reason").unwrap_or_default(),
                    "closed_at": r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("closed_at").unwrap_or_default().map(|v| v.to_rfc3339()),
                    "status_changed_at": r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("status_changed_at").unwrap_or_default().map(|v| v.to_rfc3339()),
                    "hauptanfragegrund": r.try_get::<Option<String>, _>("hauptanfragegrund").unwrap_or_default(),
                    "created_at": r.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(cases).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to list cases");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list cases")
        }
    }
}

fn is_valid_case_status(value: &str) -> bool {
    matches!(value, "open" | "in_progress" | "closed")
}

fn is_valid_case_close_reason(value: &str) -> bool {
    matches!(value, "abgeschlossen" | "abgebrochen" | "dublette")
}

/// Allowed case lifecycle transitions — the single source of truth for how an
/// episode moves through its status. See docs/case-patient-unification-strategy-ua.md (D4).
/// Closing requires a reason; reopening a closed case clears it.
fn case_status_transition_allowed(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    matches!(
        (from, to),
        ("open", "in_progress")
            | ("open", "closed")
            | ("in_progress", "closed")
            | ("closed", "in_progress")
    )
}

async fn list_case_text_snippets(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT s.id, s.label, s.category, s.body, s.is_active,
                  s.created_at, s.updated_at,
                  created_user.name AS created_by_name,
                  updated_user.name AS updated_by_name
           FROM case_text_snippets s
           LEFT JOIN users created_user ON created_user.id = s.created_by
           LEFT JOIN users updated_user ON updated_user.id = s.updated_by
           ORDER BY s.is_active DESC, s.category, s.label, s.created_at DESC"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "label": row.try_get::<String, _>("label").unwrap_or_default(),
                        "category": row.try_get::<String, _>("category").unwrap_or_else(|_| "general".to_string()),
                        "body": row.try_get::<String, _>("body").unwrap_or_default(),
                        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "created_by_name": row.try_get::<Option<String>, _>("created_by_name").unwrap_or_default(),
                        "updated_by_name": row.try_get::<Option<String>, _>("updated_by_name").unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, "list case text snippets");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load case text snippets",
            )
        }
    }
}

async fn create_case_text_snippet(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CaseTextSnippetRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    let Some(label) = normalize_case_text_snippet_label(&body.label) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Snippet label is required",
        );
    };
    let Some(snippet_body) = normalize_case_text_snippet_body(&body.body) else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Snippet body is required");
    };
    let category = normalize_case_text_snippet_category(body.category.as_deref());
    let is_active = body.is_active.unwrap_or(true);

    match sqlx::query(
        r#"INSERT INTO case_text_snippets (
                label, category, body, is_active, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id, created_at, updated_at"#,
    )
    .bind(label.clone())
    .bind(category.clone())
    .bind(snippet_body.clone())
    .bind(is_active)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let snippet_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            state.audit_sender.try_send(audit::domain_event(
                "create_case_text_snippet",
                Some(auth.user_id),
                "case_text_snippet",
                Some(snippet_id),
                serde_json::json!({
                    "label": label,
                    "category": category,
                    "is_active": is_active,
                }),
            ));

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": snippet_id,
                    "label": label,
                    "category": category,
                    "body": snippet_body,
                    "is_active": is_active,
                    "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                })),
            )
                .into_response()
        }
        Err(error) => {
            tracing::error!(error = %error, user_id = %auth.user_id, "create case text snippet");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create case text snippet",
            )
        }
    }
}

async fn update_case_text_snippet(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(snippet_id): Path<Uuid>,
    Json(body): Json<CaseTextSnippetRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    let Some(label) = normalize_case_text_snippet_label(&body.label) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Snippet label is required",
        );
    };
    let Some(snippet_body) = normalize_case_text_snippet_body(&body.body) else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Snippet body is required");
    };
    let category = normalize_case_text_snippet_category(body.category.as_deref());
    let is_active = body.is_active.unwrap_or(true);

    match sqlx::query(
        r#"UPDATE case_text_snippets
           SET label = $2,
               category = $3,
               body = $4,
               is_active = $5,
               updated_by = $6,
               updated_at = now()
           WHERE id = $1
           RETURNING updated_at"#,
    )
    .bind(snippet_id)
    .bind(label.clone())
    .bind(category.clone())
    .bind(snippet_body.clone())
    .bind(is_active)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            state.audit_sender.try_send(audit::domain_event(
                "update_case_text_snippet",
                Some(auth.user_id),
                "case_text_snippet",
                Some(snippet_id),
                serde_json::json!({
                    "label": label,
                    "category": category,
                    "is_active": is_active,
                }),
            ));

            Json(serde_json::json!({
                "id": snippet_id,
                "label": label,
                "category": category,
                "body": snippet_body,
                "is_active": is_active,
                "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            }))
            .into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Case text snippet not found"),
        Err(error) => {
            tracing::error!(error = %error, snippet_id = %snippet_id, "update case text snippet");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update case text snippet",
            )
        }
    }
}

async fn create_case(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateCaseRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    let subject = match access::RecordSubject::from_ids(body.patient_id, body.lead_id) {
        Ok(subject) => subject,
        Err(access::RecordSubjectError::Missing) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Case requires patient_id or lead_id",
            );
        }
        Err(access::RecordSubjectError::Ambiguous) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Case cannot belong to patient and lead at the same time",
            );
        }
    };

    match subject {
        access::RecordSubject::Patient(patient_id) => {
            if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
                return resp;
            }
        }
        access::RecordSubject::Lead(lead_id) => {
            let lead = match sqlx::query("SELECT converted_patient_id FROM leads WHERE id = $1")
                .bind(lead_id)
                .fetch_optional(&state.db)
                .await
            {
                Ok(Some(row)) => row,
                Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
                Err(error) => {
                    tracing::error!(error = %error, lead_id = %lead_id, "load lead case subject");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            if lead
                .try_get::<Option<Uuid>, _>("converted_patient_id")
                .unwrap_or_default()
                .is_some()
            {
                return err(
                    StatusCode::CONFLICT,
                    "Converted lead must use its patient context",
                );
            }

            let existing = match sqlx::query(
                r#"SELECT id, case_id, manager_id, created_at, retention_until
                   FROM cases
                   WHERE lead_id = $1 OR source_lead_id = $1
                   ORDER BY created_at DESC, id DESC
                   LIMIT 1"#,
            )
            .bind(lead_id)
            .fetch_optional(&state.db)
            .await
            {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!(error = %error, lead_id = %lead_id, "load existing lead case");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            if let Some(row) = existing {
                let manager_id = row.try_get::<Uuid, _>("manager_id").unwrap_or_default();
                if !auth.role.has_full_access() && manager_id != auth.user_id {
                    return err(StatusCode::FORBIDDEN, "Insufficient permissions");
                }
                return (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "case_uuid": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "case_id": row.try_get::<String, _>("case_id").unwrap_or_default(),
                        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "retention_until": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_until").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "already_exists": true,
                    })),
                )
                    .into_response();
            }
        }
    }

    let seq: i64 = match sqlx::query_scalar!("SELECT nextval('case_id_seq') AS \"v!\"")
        .fetch_one(&state.db)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "seq error");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let cid = gen_case_id(seq);

    let zuweiser_label =
        match resolve_case_doctor_label(&state, body.zuweiser_doctor_id, body.zuweiser.as_deref())
            .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    let retention_years = load_case_retention_years(&state, 30).await;

    let row = match sqlx::query(
        "INSERT INTO cases (
            case_id, patient_id, lead_id, manager_id, hauptanfragegrund,
            zuweiser_doctor_id, zuweiser, retention_until, last_clinical_update_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 * interval '1 year'), now())
         RETURNING id, case_id, created_at, retention_until",
    )
    .bind(&cid)
    .bind(subject.patient_id())
    .bind(subject.lead_id())
    .bind(auth.user_id)
    .bind(body.hauptanfragegrund.clone())
    .bind(body.zuweiser_doctor_id)
    .bind(zuweiser_label.clone())
    .bind(retention_years)
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "create case");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let created_case_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
    let created_case_code = row.try_get::<String, _>("case_id").unwrap_or(cid.clone());
    let created_at = row
        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
        .unwrap_or_else(|_| chrono::Utc::now());
    let retention_until = row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_until")
        .unwrap_or_default();

    let overview_snapshot = serde_json::json!({
        "hauptanfragegrund": body.hauptanfragegrund,
        "zuweiser_doctor_id": body.zuweiser_doctor_id,
        "zuweiser": zuweiser_label,
    });

    version_log(
        &state,
        created_case_id,
        auth.user_id,
        "overview",
        serde_json::Value::Null,
        overview_snapshot,
    )
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "create_case",
        Some(auth.user_id),
        "case",
        Some(created_case_id),
        serde_json::json!({
            "case_id": created_case_code.clone(),
            "patient_id": subject.patient_id(),
            "lead_id": subject.lead_id(),
        }),
    ));
    crate::realtime::publish_case_event(
        &state,
        Some(auth.user_id),
        "case.created",
        created_case_id,
        serde_json::json!({
            "case_id": created_case_code.clone(),
            "patient_id": subject.patient_id(),
            "lead_id": subject.lead_id(),
        }),
    )
    .await;

    tracing::info!(by = %auth.user_id, case = %created_case_code, "Case created");

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": created_case_id,
            "case_uuid": created_case_id,
            "case_id": created_case_code,
            "patient_id": subject.patient_id(),
            "lead_id": subject.lead_id(),
            "created_at": created_at,
            "retention_until": retention_until.map(|value| value.to_rfc3339()),
        })),
    )
        .into_response()
}

async fn get_case_full(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    let case = match sqlx::query(
        r#"SELECT c.id, c.case_id, c.patient_id, c.lead_id, c.source_lead_id,
                  c.manager_id, c.status,
                  c.closed_reason, c.closed_at, c.status_changed_at,
                  c.hauptanfragegrund, c.zuweiser_doctor_id, c.zuweiser, c.intake_snapshot,
                  c.notes, c.created_at, c.updated_at, c.retention_until,
                  c.last_clinical_update_at, c.version_count,
                  c.intake_completed_at, c.intake_completed_by,
                  d.name AS zuweiser_doctor_name,
                  p.name AS zuweiser_provider_name,
                  pat.patient_id AS patient_pid,
                  pat.first_name AS patient_first_name,
                  pat.last_name AS patient_last_name,
                  mgr.name AS manager_name,
                  ord.id AS linked_order_id,
                  ord.order_number AS linked_order_number
           FROM cases c
           LEFT JOIN provider_doctors d ON d.id = c.zuweiser_doctor_id
           LEFT JOIN providers p ON p.id = d.provider_id
           LEFT JOIN patients pat ON pat.id = c.patient_id
           LEFT JOIN users mgr ON mgr.id = c.manager_id
           LEFT JOIN LATERAL (
               SELECT o.id, o.order_number FROM orders o
               WHERE o.case_id = c.id
               ORDER BY o.created_at ASC
               LIMIT 1
           ) ord ON true
           WHERE c.id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(c)) => c,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Case not found"),
        Err(e) => {
            tracing::error!(error = %e, "get case");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let case_id = case.try_get::<Uuid, _>("id").unwrap_or(case_uuid);
    let patient_id = case
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default();
    let lead_id = case
        .try_get::<Option<Uuid>, _>("lead_id")
        .unwrap_or_default();
    let source_lead_id = case
        .try_get::<Option<Uuid>, _>("source_lead_id")
        .unwrap_or_default();
    match can_access_case_subject(&state, &auth, case_id, patient_id, lead_id).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let pains = sqlx::query!("SELECT lokalisierung, seit_wann, ursache, qualitaet, kontinuitaet, entwicklung, nrs_aktuell, nrs_anfang, dauer_anfang, dauer_aktuell, ausstrahlung, auftreten FROM pain_records WHERE case_id = $1 ORDER BY sort_order", case_uuid)
        .fetch_all(&state.db).await.unwrap_or_default();
    let symptoms = sqlx::query!(
        "SELECT beschreibung, fachrichtung FROM symptome WHERE case_id = $1 ORDER BY sort_order",
        case_uuid
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let cardiology = sqlx::query(
        r#"SELECT is_relevant, chest_pain, dyspnea, palpitations, syncope, edema,
                  known_diagnosis, prior_cardiac_workup, cardiovascular_risk_factors,
                  anticoagulation, family_history, red_flags, notes
           FROM case_cardiology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let gastroenterology = sqlx::query(
        r#"SELECT is_relevant, abdominal_pain, reflux, nausea, diarrhea, constipation,
                  gi_bleeding, prior_endoscopy, bowel_habits, liver_history,
                  food_intolerance, red_flags, notes
           FROM case_gastroenterology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let orthopedics = sqlx::query(
        r#"SELECT is_relevant, joint_pain, back_pain, mobility_limitation, trauma_history,
                  prior_imaging, assistive_devices, physiotherapy_history, pain_triggers,
                  red_flags, notes
           FROM case_orthopedics_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let neurology = sqlx::query(
        r#"SELECT is_relevant, headache, dizziness, sensory_changes, weakness,
                  seizure_history, gait_balance_issues, prior_neuro_imaging,
                  prior_neurology_workup, cognitive_changes, red_flags, notes
           FROM case_neurology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let pulmonology = sqlx::query(
        r#"SELECT is_relevant, chronic_cough, dyspnea, wheezing, chest_tightness,
                  hemoptysis, smoking_history, prior_chest_imaging, inhaler_therapy,
                  sleep_apnea_history, red_flags, notes
           FROM case_pulmonology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let urology = sqlx::query(
        r#"SELECT is_relevant, dysuria, hematuria, flank_pain, urinary_frequency,
                  urinary_retention, incontinence, prior_urology_workup,
                  catheter_history, stone_history, red_flags, notes
           FROM case_urology_assessments
           WHERE case_id = $1"#,
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    let mut pains_json = Vec::new();
    for p in pains {
        pains_json.push(serde_json::json!({"lokalisierung": p.lokalisierung, "seit_wann": p.seit_wann, "ursache": p.ursache, "qualitaet": p.qualitaet, "kontinuitaet": p.kontinuitaet, "entwicklung": p.entwicklung, "nrs_aktuell": p.nrs_aktuell, "nrs_anfang": p.nrs_anfang, "dauer_anfang": p.dauer_anfang, "dauer_aktuell": p.dauer_aktuell, "ausstrahlung": p.ausstrahlung, "auftreten": p.auftreten}));
    }
    let mut symptoms_json = Vec::new();
    for s in symptoms {
        symptoms_json.push(
            serde_json::json!({"beschreibung": s.beschreibung, "fachrichtung": s.fachrichtung}),
        );
    }
    let cardiology_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["cardio", "kardio"]));
    let gastroenterology_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["gastro", "kolo", "colo"]));
    let orthopedics_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["ortho", "orthop", "trauma", "bewegung"]));
    let neurology_recommended = symptoms_json
        .iter()
        .any(|item| symptom_matches_specialty(item, &["neuro", "neurol"]));
    let pulmonology_recommended = symptoms_json.iter().any(|item| {
        symptom_matches_specialty(item, &["pulmo", "pneumo", "respir", "asthma", "lung"])
    });
    let urology_recommended = symptoms_json.iter().any(|item| {
        symptom_matches_specialty(
            item,
            &["uro", "urolog", "renal", "kidney", "bladder", "prostat"],
        )
    });
    let recent_history = match load_case_history(&state.db, case_uuid, 12).await {
        Ok(items) => items,
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load case history");
            Vec::new()
        }
    };

    Json(serde_json::json!({
        "id": case_id,
        "case_uuid": case_id,
        "case_id": case.try_get::<String, _>("case_id").unwrap_or_default(),
        "patient_id": patient_id,
        "lead_id": lead_id,
        "source_lead_id": source_lead_id,
        "patient_pid": case.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
        "patient_first_name": case.try_get::<Option<String>, _>("patient_first_name").unwrap_or_default(),
        "patient_last_name": case.try_get::<Option<String>, _>("patient_last_name").unwrap_or_default(),
        "manager_name": case.try_get::<Option<String>, _>("manager_name").unwrap_or_default(),
        "linked_order_id": case.try_get::<Option<Uuid>, _>("linked_order_id").unwrap_or_default(),
        "linked_order_number": case.try_get::<Option<String>, _>("linked_order_number").unwrap_or_default(),
        "manager_id": case.try_get::<Uuid, _>("manager_id").unwrap_or_default(),
        "status": case.try_get::<String, _>("status").unwrap_or_default(),
        "closed_reason": case.try_get::<Option<String>, _>("closed_reason").unwrap_or_default(),
        "closed_at": case.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("closed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "status_changed_at": case.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("status_changed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "hauptanfragegrund": case.try_get::<Option<String>, _>("hauptanfragegrund").unwrap_or_default(),
        "intake_snapshot": case.try_get::<Option<serde_json::Value>, _>("intake_snapshot").unwrap_or_default(),
        "zuweiser_doctor_id": case.try_get::<Option<Uuid>, _>("zuweiser_doctor_id").unwrap_or_default(),
        "zuweiser": case.try_get::<Option<String>, _>("zuweiser").unwrap_or_default(),
        "zuweiser_registry_name": case.try_get::<Option<String>, _>("zuweiser_doctor_name").unwrap_or_default(),
        "zuweiser_provider_name": case.try_get::<Option<String>, _>("zuweiser_provider_name").unwrap_or_default(),
        "notes": case.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "created_at": case.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "updated_at": case.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "retention_until": case.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_until").unwrap_or_default().map(|value| value.to_rfc3339()),
        "last_clinical_update_at": case.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_clinical_update_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "version_count": case.try_get::<i32, _>("version_count").unwrap_or_default(),
        "intake_completed_at": case.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("intake_completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "intake_completed_by": case.try_get::<Option<Uuid>, _>("intake_completed_by").unwrap_or_default(),
        "pain_records": pains_json,
        "symptome": symptoms_json,
        "cardiology_recommended": cardiology_recommended,
        "cardiology": cardiology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "chest_pain": item.try_get::<bool, _>("chest_pain").unwrap_or(false),
            "dyspnea": item.try_get::<bool, _>("dyspnea").unwrap_or(false),
            "palpitations": item.try_get::<bool, _>("palpitations").unwrap_or(false),
            "syncope": item.try_get::<bool, _>("syncope").unwrap_or(false),
            "edema": item.try_get::<bool, _>("edema").unwrap_or(false),
            "known_diagnosis": item.try_get::<Option<String>, _>("known_diagnosis").unwrap_or_default(),
            "prior_cardiac_workup": item.try_get::<Option<String>, _>("prior_cardiac_workup").unwrap_or_default(),
            "cardiovascular_risk_factors": item.try_get::<Option<String>, _>("cardiovascular_risk_factors").unwrap_or_default(),
            "anticoagulation": item.try_get::<Option<String>, _>("anticoagulation").unwrap_or_default(),
            "family_history": item.try_get::<Option<String>, _>("family_history").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "gastroenterology_recommended": gastroenterology_recommended,
        "gastroenterology": gastroenterology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "abdominal_pain": item.try_get::<bool, _>("abdominal_pain").unwrap_or(false),
            "reflux": item.try_get::<bool, _>("reflux").unwrap_or(false),
            "nausea": item.try_get::<bool, _>("nausea").unwrap_or(false),
            "diarrhea": item.try_get::<bool, _>("diarrhea").unwrap_or(false),
            "constipation": item.try_get::<bool, _>("constipation").unwrap_or(false),
            "gi_bleeding": item.try_get::<bool, _>("gi_bleeding").unwrap_or(false),
            "prior_endoscopy": item.try_get::<Option<String>, _>("prior_endoscopy").unwrap_or_default(),
            "bowel_habits": item.try_get::<Option<String>, _>("bowel_habits").unwrap_or_default(),
            "liver_history": item.try_get::<Option<String>, _>("liver_history").unwrap_or_default(),
            "food_intolerance": item.try_get::<Option<String>, _>("food_intolerance").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "orthopedics_recommended": orthopedics_recommended,
        "orthopedics": orthopedics.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "joint_pain": item.try_get::<bool, _>("joint_pain").unwrap_or(false),
            "back_pain": item.try_get::<bool, _>("back_pain").unwrap_or(false),
            "mobility_limitation": item.try_get::<bool, _>("mobility_limitation").unwrap_or(false),
            "trauma_history": item.try_get::<bool, _>("trauma_history").unwrap_or(false),
            "prior_imaging": item.try_get::<Option<String>, _>("prior_imaging").unwrap_or_default(),
            "assistive_devices": item.try_get::<Option<String>, _>("assistive_devices").unwrap_or_default(),
            "physiotherapy_history": item.try_get::<Option<String>, _>("physiotherapy_history").unwrap_or_default(),
            "pain_triggers": item.try_get::<Option<String>, _>("pain_triggers").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "neurology_recommended": neurology_recommended,
        "neurology": neurology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "headache": item.try_get::<bool, _>("headache").unwrap_or(false),
            "dizziness": item.try_get::<bool, _>("dizziness").unwrap_or(false),
            "sensory_changes": item.try_get::<bool, _>("sensory_changes").unwrap_or(false),
            "weakness": item.try_get::<bool, _>("weakness").unwrap_or(false),
            "seizure_history": item.try_get::<bool, _>("seizure_history").unwrap_or(false),
            "gait_balance_issues": item.try_get::<bool, _>("gait_balance_issues").unwrap_or(false),
            "prior_neuro_imaging": item.try_get::<Option<String>, _>("prior_neuro_imaging").unwrap_or_default(),
            "prior_neurology_workup": item.try_get::<Option<String>, _>("prior_neurology_workup").unwrap_or_default(),
            "cognitive_changes": item.try_get::<Option<String>, _>("cognitive_changes").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "pulmonology_recommended": pulmonology_recommended,
        "pulmonology": pulmonology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "chronic_cough": item.try_get::<bool, _>("chronic_cough").unwrap_or(false),
            "dyspnea": item.try_get::<bool, _>("dyspnea").unwrap_or(false),
            "wheezing": item.try_get::<bool, _>("wheezing").unwrap_or(false),
            "chest_tightness": item.try_get::<bool, _>("chest_tightness").unwrap_or(false),
            "hemoptysis": item.try_get::<bool, _>("hemoptysis").unwrap_or(false),
            "smoking_history": item.try_get::<Option<String>, _>("smoking_history").unwrap_or_default(),
            "prior_chest_imaging": item.try_get::<Option<String>, _>("prior_chest_imaging").unwrap_or_default(),
            "inhaler_therapy": item.try_get::<Option<String>, _>("inhaler_therapy").unwrap_or_default(),
            "sleep_apnea_history": item.try_get::<Option<String>, _>("sleep_apnea_history").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "urology_recommended": urology_recommended,
        "urology": urology.map(|item| serde_json::json!({
            "is_relevant": item.try_get::<bool, _>("is_relevant").unwrap_or(false),
            "dysuria": item.try_get::<bool, _>("dysuria").unwrap_or(false),
            "hematuria": item.try_get::<bool, _>("hematuria").unwrap_or(false),
            "flank_pain": item.try_get::<bool, _>("flank_pain").unwrap_or(false),
            "urinary_frequency": item.try_get::<bool, _>("urinary_frequency").unwrap_or(false),
            "urinary_retention": item.try_get::<bool, _>("urinary_retention").unwrap_or(false),
            "incontinence": item.try_get::<bool, _>("incontinence").unwrap_or(false),
            "prior_urology_workup": item.try_get::<Option<String>, _>("prior_urology_workup").unwrap_or_default(),
            "catheter_history": item.try_get::<Option<String>, _>("catheter_history").unwrap_or_default(),
            "stone_history": item.try_get::<Option<String>, _>("stone_history").unwrap_or_default(),
            "red_flags": item.try_get::<Option<String>, _>("red_flags").unwrap_or_default(),
            "notes": item.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        })),
        "history": recent_history,
    })).into_response()
}

async fn list_case_doctors(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT d.id, d.provider_id, d.name, d.title, d.role_code, d.role_label, d.subrole, d.fachbereich,
                  COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', ms.id,
                            'code', ms.code,
                            'name_en', ms.name_en,
                            'name_de', ms.name_de,
                            'name_ru', ms.name_ru,
                            'is_active', ms.is_active,
                            'sort_order', ms.sort_order,
                            'is_primary', ds.is_primary
                        )
                        ORDER BY ds.is_primary DESC, ms.sort_order, ms.name_de, ms.name_en
                    )
                    FROM provider_doctor_specializations ds
                    JOIN medical_specializations ms ON ms.id = ds.specialization_id
                    WHERE ds.doctor_id = d.id
                      AND ms.deleted_at IS NULL
                  ), '[]'::jsonb) AS specializations,
                  p.name AS provider_name
           FROM provider_doctor_links l
           JOIN provider_doctors d ON d.id = l.doctor_id
           JOIN providers p ON p.id = l.provider_id
           WHERE p.is_active = true
             AND p.provider_type = 'medical'
           ORDER BY p.name,
                    CASE d.role_code
                      WHEN 'clinical_director' THEN 1
                      WHEN 'chefarzt' THEN 2
                      WHEN 'oberarzt' THEN 3
                      WHEN 'facharzt' THEN 4
                      WHEN 'assistenzarzt' THEN 5
                      ELSE 6
                    END,
                    d.name"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or_default(),
                        "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
                        "name": row.try_get::<String, _>("name").unwrap_or_default(),
                        "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
                        "role_code": row.try_get::<Option<String>, _>("role_code").unwrap_or_default(),
                        "role_label": row.try_get::<Option<String>, _>("role_label").unwrap_or_default(),
                        "subrole": row.try_get::<Option<String>, _>("subrole").unwrap_or_default(),
                        "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
                        "specializations": row.try_get::<serde_json::Value, _>("specializations").unwrap_or_else(|_| serde_json::json!([])),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to list case doctors");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load case doctors")
        }
    }
}

async fn update_anamnesis(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<UpdateAnamnesisRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let zuweiser_label =
        match resolve_case_doctor_label(&state, body.zuweiser_doctor_id, body.zuweiser.as_deref())
            .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "overview").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load overview snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let result = sqlx::query(
        "UPDATE cases
         SET hauptanfragegrund = COALESCE($2, hauptanfragegrund),
             zuweiser_doctor_id = COALESCE($3, zuweiser_doctor_id),
             zuweiser = COALESCE($4, zuweiser)
         WHERE id = $1",
    )
    .bind(case_uuid)
    .bind(body.hauptanfragegrund.clone())
    .bind(body.zuweiser_doctor_id)
    .bind(zuweiser_label)
    .execute(&state.db)
    .await;
    if let Err(e) = result {
        tracing::error!(error = %e, "update anamnesis");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "overview").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload overview snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "overview",
        old_value,
        new_value,
    )
    .await;

    Json(serde_json::json!({"ok": true})).into_response()
}

async fn update_intake_completion(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<UpdateIntakeCompletionRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin])
    {
        return response;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(response) => return response,
    }

    let mut transaction = match state.db.begin().await {
        Ok(transaction) => transaction,
        Err(error) => {
            tracing::error!(error = %error, case_id = %case_uuid, "begin case intake completion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let row = match sqlx::query(
        r#"UPDATE cases
           SET hauptanfragegrund = COALESCE($2, hauptanfragegrund)
           WHERE id = $1
           RETURNING hauptanfragegrund"#,
    )
    .bind(case_uuid)
    .bind(body.hauptanfragegrund.clone())
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Case not found"),
        Err(error) => {
            tracing::error!(error = %error, case_id = %case_uuid, "load case intake completion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if body.completed {
        let fields = [(
            "hauptanfragegrund",
            row.try_get::<Option<String>, _>("hauptanfragegrund")
                .unwrap_or_default(),
        )];
        let blocking_fields = fields
            .into_iter()
            .filter_map(|(key, value)| {
                value
                    .as_deref()
                    .is_none_or(|text| text.trim().is_empty())
                    .then_some(key)
            })
            .collect::<Vec<_>>();
        if !blocking_fields.is_empty() {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({
                    "error": "Unprocessable Entity",
                    "message": "Case intake is incomplete",
                    "blocking_fields": blocking_fields,
                })),
            )
                .into_response();
        }
    }

    let row = match sqlx::query(
        r#"UPDATE cases
           SET intake_completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
               intake_completed_by = CASE WHEN $2 THEN $3 ELSE NULL END
           WHERE id = $1
           RETURNING intake_completed_at, intake_completed_by"#,
    )
    .bind(case_uuid)
    .bind(body.completed)
    .bind(auth.user_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Case not found"),
        Err(error) => {
            tracing::error!(error = %error, case_id = %case_uuid, "update case intake completion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(error) = transaction.commit().await {
        tracing::error!(error = %error, case_id = %case_uuid, "commit case intake completion");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        if body.completed {
            "complete_case_intake"
        } else {
            "reopen_case_intake"
        },
        Some(auth.user_id),
        "case",
        Some(case_uuid),
        serde_json::json!({ "completed": body.completed }),
    ));
    crate::realtime::publish_case_event(
        &state,
        Some(auth.user_id),
        "case.intake_completion_changed",
        case_uuid,
        serde_json::json!({ "completed": body.completed }),
    )
    .await;

    Json(serde_json::json!({
        "ok": true,
        "completed": body.completed,
        "intake_completed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("intake_completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "intake_completed_by": row.try_get::<Option<Uuid>, _>("intake_completed_by").unwrap_or_default(),
    }))
    .into_response()
}

async fn update_case_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<UpdateCaseStatusRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin])
    {
        return response;
    }
    if !is_valid_case_status(&body.status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(response) => return response,
    }

    let current = match sqlx::query(
        "SELECT status, closed_reason, closed_at FROM cases WHERE id = $1",
    )
    .bind(case_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Case not found"),
        Err(error) => {
            tracing::error!(error = %error, case_id = %case_uuid, "load case before status change");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let current_status: String = current.try_get("status").unwrap_or_default();
    let current_closed_reason: Option<String> =
        current.try_get("closed_reason").unwrap_or_default();
    if !case_status_transition_allowed(&current_status, &body.status) {
        return err(StatusCode::CONFLICT, "Status transition is not allowed");
    }

    let reason = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if body.status == "closed" {
        let Some(reason) = reason else {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Close reason is required");
        };
        if !is_valid_case_close_reason(reason) {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid close reason");
        }
    }

    if current_status == body.status {
        return Json(serde_json::json!({ "ok": true, "status": current_status })).into_response();
    }

    let row = match sqlx::query(
        r#"UPDATE cases
           SET status = $2,
               closed_reason = CASE WHEN $2 = 'closed' THEN $3 ELSE NULL END,
               closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END,
               status_changed_at = now(),
               updated_at = now()
           WHERE id = $1
           RETURNING status, closed_reason, closed_at, status_changed_at"#,
    )
    .bind(case_uuid)
    .bind(&body.status)
    .bind(reason)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Case not found"),
        Err(error) => {
            tracing::error!(error = %error, case_id = %case_uuid, "update case status");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let audit_action = match body.status.as_str() {
        "closed" => "close_case",
        "in_progress" if current_status == "closed" => "reopen_case",
        _ => "update_case_status",
    };
    state.audit_sender.try_send(audit::domain_event(
        audit_action,
        Some(auth.user_id),
        "case",
        Some(case_uuid),
        serde_json::json!({
            "from_status": current_status,
            "status": body.status,
            "reason": reason,
        }),
    ));
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "status",
        serde_json::json!({
            "status": current_status,
            "closed_reason": current_closed_reason,
        }),
        serde_json::json!({
            "status": body.status,
            "closed_reason": reason,
        }),
    )
    .await;

    Json(serde_json::json!({
        "ok": true,
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "closed_reason": row.try_get::<Option<String>, _>("closed_reason").unwrap_or_default(),
        "closed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("closed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "status_changed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("status_changed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
    }))
    .into_response()
}

async fn require_patient_clinical_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin])?;
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(patient_id)
            .fetch_one(&state.db)
            .await
            .map_err(|error| {
                tracing::error!(error = %error, patient_id = %patient_id, "load patient subject");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
            })?;
    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    }
    ensure_patient_access(state, auth, patient_id).await
}

async fn load_patient_owned_case_section<'e, E>(
    executor: E,
    patient_id: Uuid,
    section: &str,
) -> Result<serde_json::Value, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let sql = match section {
        "pain_records" => {
            r#"SELECT COALESCE(
                   jsonb_agg((to_jsonb(entry) - 'patient_id') ORDER BY entry.sort_order, entry.created_at, entry.id),
                   '[]'::jsonb
               )
               FROM pain_records entry
               WHERE entry.patient_id = $1"#
        }
        "symptome" => {
            r#"SELECT COALESCE(
                   jsonb_agg((to_jsonb(entry) - 'patient_id') ORDER BY entry.sort_order, entry.created_at, entry.id),
                   '[]'::jsonb
               )
               FROM symptome entry
               WHERE entry.patient_id = $1"#
        }
        _ => return Ok(serde_json::json!([])),
    };
    sqlx::query_scalar(sql)
        .bind(patient_id)
        .fetch_one(executor)
        .await
}

async fn append_patient_owned_version(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
    user_id: Uuid,
    section: &str,
    retention_years: i64,
    old_value: serde_json::Value,
    new_value: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO patient_clinical_versions
             (patient_id, changed_by, section, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(section)
    .bind(old_value)
    .bind(new_value)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE patients
         SET last_clinical_update_at = now(),
             clinical_retention_until = GREATEST(
                 COALESCE(clinical_retention_until, now()),
                 now() + ($2 * interval '1 year')
             )
         WHERE id = $1",
    )
    .bind(patient_id)
    .bind(retention_years.max(1))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn get_patient_pain_records(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_patient_clinical_access(&state, &auth, patient_id).await {
        return response;
    }
    match load_patient_owned_case_section(&state.db, patient_id, "pain_records").await {
        Ok(items) => Json(serde_json::json!({ "items": items })).into_response(),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "load patient pain records");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn save_patient_pain_records(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<ItemsWrapper<PainItem>>,
) -> axum::response::Response {
    if let Err(response) = require_patient_clinical_access(&state, &auth, patient_id).await {
        return response;
    }
    for item in &body.items {
        if item
            .nrs_aktuell
            .is_some_and(|value| !(0..=10).contains(&value))
            || item
                .nrs_anfang
                .is_some_and(|value| !(0..=10).contains(&value))
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "NRS values must be whole numbers from 0 to 10",
            );
        }
    }
    let retention_years = load_case_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "begin patient pain tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value =
        match load_patient_owned_case_section(&mut *tx, patient_id, "pain_records").await {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, patient_id = %patient_id, "snapshot patient pain");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
    if let Err(error) = sqlx::query("DELETE FROM pain_records WHERE patient_id = $1")
        .bind(patient_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, patient_id = %patient_id, "replace patient pain");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (sort_order, item) in body.items.iter().enumerate() {
        if let Err(error) = sqlx::query(
            "INSERT INTO pain_records
                 (patient_id, case_id, lokalisierung, seit_wann, ursache, qualitaet,
                  kontinuitaet, entwicklung, nrs_aktuell, nrs_anfang, dauer_anfang,
                  dauer_aktuell, ausstrahlung, auftreten, sort_order)
             VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
        )
        .bind(patient_id)
        .bind(&item.lokalisierung)
        .bind(&item.seit_wann)
        .bind(&item.ursache)
        .bind(&item.qualitaet)
        .bind(&item.kontinuitaet)
        .bind(&item.entwicklung)
        .bind(item.nrs_aktuell)
        .bind(item.nrs_anfang)
        .bind(&item.dauer_anfang)
        .bind(&item.dauer_aktuell)
        .bind(&item.ausstrahlung)
        .bind(&item.auftreten)
        .bind(sort_order as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, patient_id = %patient_id, "insert patient pain");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    let new_value = match load_patient_owned_case_section(&mut *tx, patient_id, "pain_records")
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "resnapshot patient pain");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = append_patient_owned_version(
        &mut tx,
        patient_id,
        auth.user_id,
        "pain_records",
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %error, patient_id = %patient_id, "version patient pain");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, patient_id = %patient_id, "commit patient pain");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_pain_records",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        serde_json::json!({ "count": body.items.len() }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_id,
        serde_json::json!({ "section": "pain_records" }),
    )
    .await;
    Json(serde_json::json!({ "ok": true, "count": body.items.len() })).into_response()
}

async fn get_patient_symptoms(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_patient_clinical_access(&state, &auth, patient_id).await {
        return response;
    }
    match load_patient_owned_case_section(&state.db, patient_id, "symptome").await {
        Ok(items) => Json(serde_json::json!({ "items": items })).into_response(),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "load patient symptoms");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn save_patient_symptoms(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<ItemsWrapper<SymptomItem>>,
) -> axum::response::Response {
    if let Err(response) = require_patient_clinical_access(&state, &auth, patient_id).await {
        return response;
    }
    let retention_years = load_case_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "begin patient symptoms tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value = match load_patient_owned_case_section(&mut *tx, patient_id, "symptome").await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "snapshot patient symptoms");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = sqlx::query("DELETE FROM symptome WHERE patient_id = $1")
        .bind(patient_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, patient_id = %patient_id, "replace patient symptoms");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (sort_order, item) in body.items.iter().enumerate() {
        if let Err(error) = sqlx::query(
            "INSERT INTO symptome (patient_id, case_id, beschreibung, fachrichtung, sort_order)
             VALUES ($1, NULL, $2, $3, $4)",
        )
        .bind(patient_id)
        .bind(&item.beschreibung)
        .bind(&item.fachrichtung)
        .bind(sort_order as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, patient_id = %patient_id, "insert patient symptoms");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    let new_value = match load_patient_owned_case_section(&mut *tx, patient_id, "symptome").await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "resnapshot patient symptoms");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = append_patient_owned_version(
        &mut tx,
        patient_id,
        auth.user_id,
        "symptoms",
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %error, patient_id = %patient_id, "version patient symptoms");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, patient_id = %patient_id, "commit patient symptoms");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_symptoms",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        serde_json::json!({ "count": body.items.len() }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_id,
        serde_json::json!({ "section": "symptoms" }),
    )
    .await;
    Json(serde_json::json!({ "ok": true, "count": body.items.len() })).into_response()
}

async fn save_pain_records(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<PainItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    for item in &body.items {
        if item
            .nrs_aktuell
            .is_some_and(|value| !(0..=10).contains(&value))
            || item
                .nrs_anfang
                .is_some_and(|value| !(0..=10).contains(&value))
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "NRS values must be whole numbers from 0 to 10",
            );
        }
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "pain_records").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load pain snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin pain tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM pain_records WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete pain records");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        if let Err(e) = sqlx::query(
            "INSERT INTO pain_records (case_id, lokalisierung, seit_wann, ursache, qualitaet, kontinuitaet, entwicklung, nrs_aktuell, nrs_anfang, dauer_anfang, dauer_aktuell, ausstrahlung, auftreten, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        )
        .bind(case_uuid)
        .bind(&item.lokalisierung)
        .bind(item.seit_wann.clone())
        .bind(item.ursache.clone())
        .bind(item.qualitaet.clone())
        .bind(item.kontinuitaet.clone())
        .bind(item.entwicklung.clone())
        .bind(item.nrs_aktuell)
        .bind(item.nrs_anfang)
        .bind(item.dauer_anfang.clone())
        .bind(item.dauer_aktuell.clone())
        .bind(item.ausstrahlung.clone())
        .bind(item.auftreten.clone())
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert pain records");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit pain records");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "pain_records").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload pain snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "pain_records",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_symptome(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<ItemsWrapper<SymptomItem>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "symptome").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load symptome snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin symptome tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM symptome WHERE case_id = $1")
        .bind(case_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "delete symptome");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (i, item) in body.items.iter().enumerate() {
        if let Err(e) = sqlx::query(
            "INSERT INTO symptome (case_id, beschreibung, fachrichtung, sort_order) VALUES ($1, $2, $3, $4)",
        )
        .bind(case_uuid)
        .bind(&item.beschreibung)
        .bind(item.fachrichtung.clone())
        .bind(i as i32)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, case_id = %case_uuid, "insert symptome");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_uuid, "commit symptome");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "symptome").await {
        Ok(value) => value.unwrap_or(serde_json::json!([])),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload symptome snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "symptome",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true, "count": body.items.len()})).into_response()
}

async fn save_cardiology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<CardiologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "cardiology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load cardiology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_cardiology_assessments (
                case_id, is_relevant, chest_pain, dyspnea, palpitations, syncope, edema,
                known_diagnosis, prior_cardiac_workup, cardiovascular_risk_factors,
                anticoagulation, family_history, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                chest_pain = EXCLUDED.chest_pain,
                dyspnea = EXCLUDED.dyspnea,
                palpitations = EXCLUDED.palpitations,
                syncope = EXCLUDED.syncope,
                edema = EXCLUDED.edema,
                known_diagnosis = EXCLUDED.known_diagnosis,
                prior_cardiac_workup = EXCLUDED.prior_cardiac_workup,
                cardiovascular_risk_factors = EXCLUDED.cardiovascular_risk_factors,
                anticoagulation = EXCLUDED.anticoagulation,
                family_history = EXCLUDED.family_history,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.chest_pain.unwrap_or(false))
    .bind(body.dyspnea.unwrap_or(false))
    .bind(body.palpitations.unwrap_or(false))
    .bind(body.syncope.unwrap_or(false))
    .bind(body.edema.unwrap_or(false))
    .bind(body.known_diagnosis.clone())
    .bind(body.prior_cardiac_workup.clone())
    .bind(body.cardiovascular_risk_factors.clone())
    .bind(body.anticoagulation.clone())
    .bind(body.family_history.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save cardiology assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "cardiology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload cardiology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "cardiology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_gastroenterology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<GastroenterologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "gastroenterology").await
    {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(
                error = %e,
                case_id = %case_uuid,
                "load gastroenterology snapshot"
            );
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_gastroenterology_assessments (
                case_id, is_relevant, abdominal_pain, reflux, nausea, diarrhea,
                constipation, gi_bleeding, prior_endoscopy, bowel_habits,
                liver_history, food_intolerance, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13, $14
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                abdominal_pain = EXCLUDED.abdominal_pain,
                reflux = EXCLUDED.reflux,
                nausea = EXCLUDED.nausea,
                diarrhea = EXCLUDED.diarrhea,
                constipation = EXCLUDED.constipation,
                gi_bleeding = EXCLUDED.gi_bleeding,
                prior_endoscopy = EXCLUDED.prior_endoscopy,
                bowel_habits = EXCLUDED.bowel_habits,
                liver_history = EXCLUDED.liver_history,
                food_intolerance = EXCLUDED.food_intolerance,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.abdominal_pain.unwrap_or(false))
    .bind(body.reflux.unwrap_or(false))
    .bind(body.nausea.unwrap_or(false))
    .bind(body.diarrhea.unwrap_or(false))
    .bind(body.constipation.unwrap_or(false))
    .bind(body.gi_bleeding.unwrap_or(false))
    .bind(body.prior_endoscopy.clone())
    .bind(body.bowel_habits.clone())
    .bind(body.liver_history.clone())
    .bind(body.food_intolerance.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(
            error = %e,
            case_id = %case_uuid,
            "save gastroenterology assessment"
        );
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "gastroenterology").await
    {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(
                error = %e,
                case_id = %case_uuid,
                "reload gastroenterology snapshot"
            );
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "gastroenterology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_orthopedics(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<OrthopedicsAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "orthopedics").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load orthopedics snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_orthopedics_assessments (
                case_id, is_relevant, joint_pain, back_pain, mobility_limitation,
                trauma_history, prior_imaging, assistive_devices, physiotherapy_history,
                pain_triggers, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                joint_pain = EXCLUDED.joint_pain,
                back_pain = EXCLUDED.back_pain,
                mobility_limitation = EXCLUDED.mobility_limitation,
                trauma_history = EXCLUDED.trauma_history,
                prior_imaging = EXCLUDED.prior_imaging,
                assistive_devices = EXCLUDED.assistive_devices,
                physiotherapy_history = EXCLUDED.physiotherapy_history,
                pain_triggers = EXCLUDED.pain_triggers,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.joint_pain.unwrap_or(false))
    .bind(body.back_pain.unwrap_or(false))
    .bind(body.mobility_limitation.unwrap_or(false))
    .bind(body.trauma_history.unwrap_or(false))
    .bind(body.prior_imaging.clone())
    .bind(body.assistive_devices.clone())
    .bind(body.physiotherapy_history.clone())
    .bind(body.pain_triggers.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save orthopedics assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "orthopedics").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload orthopedics snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "orthopedics",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_neurology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<NeurologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "neurology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load neurology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_neurology_assessments (
                case_id, is_relevant, headache, dizziness, sensory_changes,
                weakness, seizure_history, gait_balance_issues, prior_neuro_imaging,
                prior_neurology_workup, cognitive_changes, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12, $13
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                headache = EXCLUDED.headache,
                dizziness = EXCLUDED.dizziness,
                sensory_changes = EXCLUDED.sensory_changes,
                weakness = EXCLUDED.weakness,
                seizure_history = EXCLUDED.seizure_history,
                gait_balance_issues = EXCLUDED.gait_balance_issues,
                prior_neuro_imaging = EXCLUDED.prior_neuro_imaging,
                prior_neurology_workup = EXCLUDED.prior_neurology_workup,
                cognitive_changes = EXCLUDED.cognitive_changes,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.headache.unwrap_or(false))
    .bind(body.dizziness.unwrap_or(false))
    .bind(body.sensory_changes.unwrap_or(false))
    .bind(body.weakness.unwrap_or(false))
    .bind(body.seizure_history.unwrap_or(false))
    .bind(body.gait_balance_issues.unwrap_or(false))
    .bind(body.prior_neuro_imaging.clone())
    .bind(body.prior_neurology_workup.clone())
    .bind(body.cognitive_changes.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save neurology assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "neurology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload neurology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "neurology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_pulmonology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<PulmonologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "pulmonology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load pulmonology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_pulmonology_assessments (
                case_id, is_relevant, chronic_cough, dyspnea, wheezing,
                chest_tightness, hemoptysis, smoking_history, prior_chest_imaging,
                inhaler_therapy, sleep_apnea_history, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12, $13
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                chronic_cough = EXCLUDED.chronic_cough,
                dyspnea = EXCLUDED.dyspnea,
                wheezing = EXCLUDED.wheezing,
                chest_tightness = EXCLUDED.chest_tightness,
                hemoptysis = EXCLUDED.hemoptysis,
                smoking_history = EXCLUDED.smoking_history,
                prior_chest_imaging = EXCLUDED.prior_chest_imaging,
                inhaler_therapy = EXCLUDED.inhaler_therapy,
                sleep_apnea_history = EXCLUDED.sleep_apnea_history,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.chronic_cough.unwrap_or(false))
    .bind(body.dyspnea.unwrap_or(false))
    .bind(body.wheezing.unwrap_or(false))
    .bind(body.chest_tightness.unwrap_or(false))
    .bind(body.hemoptysis.unwrap_or(false))
    .bind(body.smoking_history.clone())
    .bind(body.prior_chest_imaging.clone())
    .bind(body.inhaler_therapy.clone())
    .bind(body.sleep_apnea_history.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save pulmonology assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "pulmonology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload pulmonology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "pulmonology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn save_urology(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Json(body): Json<UrologyAssessmentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let old_value = match load_case_section_snapshot(&state.db, case_uuid, "urology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "load urology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO case_urology_assessments (
                case_id, is_relevant, dysuria, hematuria, flank_pain,
                urinary_frequency, urinary_retention, incontinence,
                prior_urology_workup, catheter_history, stone_history, red_flags, notes
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12, $13
           )
           ON CONFLICT (case_id) DO UPDATE SET
                is_relevant = EXCLUDED.is_relevant,
                dysuria = EXCLUDED.dysuria,
                hematuria = EXCLUDED.hematuria,
                flank_pain = EXCLUDED.flank_pain,
                urinary_frequency = EXCLUDED.urinary_frequency,
                urinary_retention = EXCLUDED.urinary_retention,
                incontinence = EXCLUDED.incontinence,
                prior_urology_workup = EXCLUDED.prior_urology_workup,
                catheter_history = EXCLUDED.catheter_history,
                stone_history = EXCLUDED.stone_history,
                red_flags = EXCLUDED.red_flags,
                notes = EXCLUDED.notes"#,
    )
    .bind(case_uuid)
    .bind(body.is_relevant.unwrap_or(false))
    .bind(body.dysuria.unwrap_or(false))
    .bind(body.hematuria.unwrap_or(false))
    .bind(body.flank_pain.unwrap_or(false))
    .bind(body.urinary_frequency.unwrap_or(false))
    .bind(body.urinary_retention.unwrap_or(false))
    .bind(body.incontinence.unwrap_or(false))
    .bind(body.prior_urology_workup.clone())
    .bind(body.catheter_history.clone())
    .bind(body.stone_history.clone())
    .bind(body.red_flags.clone())
    .bind(body.notes.clone())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, case_id = %case_uuid, "save urology assessment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let new_value = match load_case_section_snapshot(&state.db, case_uuid, "urology").await {
        Ok(value) => value.unwrap_or(serde_json::Value::Null),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "reload urology snapshot");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    version_log(
        &state,
        case_uuid,
        auth.user_id,
        "urology",
        old_value,
        new_value,
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn get_case_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(case_uuid): Path<Uuid>,
    Query(query): Query<CaseHistoryQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin]) {
        return e;
    }
    match can_access_case(&state, &auth, case_uuid, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    match load_case_history(&state.db, case_uuid, limit).await {
        Ok(items) => Json(items).into_response(),
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_uuid, "get case history");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load case history",
            )
        }
    }
}

async fn version_log(
    state: &AppState,
    case_id: Uuid,
    user_id: Uuid,
    section: &str,
    old_value: serde_json::Value,
    new_value: serde_json::Value,
) {
    let retention_years = load_case_retention_years(state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, case_id = %case_id, "begin case version tx");
            return;
        }
    };
    if let Err(e) = sqlx::query(
        "INSERT INTO case_versions (case_id, changed_by, section, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(case_id)
    .bind(user_id)
    .bind(section)
    .bind(old_value)
    .bind(new_value)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, case_id = %case_id, section, "insert case version");
        return;
    }

    if let Err(e) = sqlx::query(
        "UPDATE cases
         SET version_count = version_count + 1,
             last_clinical_update_at = now(),
             retention_until = GREATEST(
                 COALESCE(retention_until, now()),
                 now() + ($2 * interval '1 year')
             )
         WHERE id = $1",
    )
    .bind(case_id)
    .bind(retention_years.max(1))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, case_id = %case_id, section, "update case retention metadata");
        return;
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, case_id = %case_id, section, "commit case version tx");
        return;
    }
    crate::realtime::publish_case_event(
        state,
        Some(user_id),
        "case.updated",
        case_id,
        serde_json::json!({
            "section": section,
        }),
    )
    .await;
}

async fn load_case_retention_years(state: &AppState, default: i64) -> i64 {
    match sqlx::query(r#"SELECT value::TEXT AS value_text FROM system_settings WHERE key = $1"#)
        .bind("clinical_case_retention_years")
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row
            .try_get::<String, _>("value_text")
            .ok()
            .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
            .unwrap_or(default),
        _ => default,
    }
}

async fn load_case_history(
    db: &sqlx::PgPool,
    case_id: Uuid,
    limit: i64,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT cv.id, cv.section, cv.old_value, cv.new_value, cv.created_at,
                  cv.changed_by, u.name AS changed_by_name, u.role AS changed_by_role
           FROM case_versions cv
           JOIN users u ON u.id = cv.changed_by
           WHERE cv.case_id = $1
           ORDER BY cv.created_at DESC, cv.id DESC
           LIMIT $2"#,
    )
    .bind(case_id)
    .bind(limit)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<i64, _>("id").unwrap_or_default(),
                "section": row.try_get::<String, _>("section").unwrap_or_default(),
                "old_value": row.try_get::<Option<serde_json::Value>, _>("old_value").unwrap_or_default(),
                "new_value": row.try_get::<Option<serde_json::Value>, _>("new_value").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "changed_by": row.try_get::<Uuid, _>("changed_by").unwrap_or_default(),
                "changed_by_name": row.try_get::<String, _>("changed_by_name").unwrap_or_default(),
                "changed_by_role": row.try_get::<String, _>("changed_by_role").unwrap_or_default(),
            })
        })
        .collect())
}

async fn load_case_section_snapshot(
    db: &sqlx::PgPool,
    case_id: Uuid,
    section: &str,
) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let query = match section {
        "overview" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'hauptanfragegrund', hauptanfragegrund,
                        'zuweiser_doctor_id', zuweiser_doctor_id,
                        'zuweiser', zuweiser,
                        'notes', notes
                    ) AS value
                   FROM cases
                   WHERE id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "pain_records" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'lokalisierung', lokalisierung,
                                'seit_wann', seit_wann,
                                'ursache', ursache,
                                'qualitaet', qualitaet,
                                'kontinuitaet', kontinuitaet,
                                'entwicklung', entwicklung,
                                'nrs_aktuell', nrs_aktuell,
                                'nrs_anfang', nrs_anfang,
                                'dauer_anfang', dauer_anfang,
                                'dauer_aktuell', dauer_aktuell,
                                'ausstrahlung', ausstrahlung,
                                'auftreten', auftreten
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM pain_records
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "symptome" => Some(
            sqlx::query(
                r#"SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'beschreibung', beschreibung,
                                'fachrichtung', fachrichtung
                            )
                            ORDER BY sort_order
                        ),
                        '[]'::jsonb
                    ) AS value
                   FROM symptome
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "cardiology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'chest_pain', chest_pain,
                        'dyspnea', dyspnea,
                        'palpitations', palpitations,
                        'syncope', syncope,
                        'edema', edema,
                        'known_diagnosis', known_diagnosis,
                        'prior_cardiac_workup', prior_cardiac_workup,
                        'cardiovascular_risk_factors', cardiovascular_risk_factors,
                        'anticoagulation', anticoagulation,
                        'family_history', family_history,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_cardiology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "gastroenterology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'abdominal_pain', abdominal_pain,
                        'reflux', reflux,
                        'nausea', nausea,
                        'diarrhea', diarrhea,
                        'constipation', constipation,
                        'gi_bleeding', gi_bleeding,
                        'prior_endoscopy', prior_endoscopy,
                        'bowel_habits', bowel_habits,
                        'liver_history', liver_history,
                        'food_intolerance', food_intolerance,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_gastroenterology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "orthopedics" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'joint_pain', joint_pain,
                        'back_pain', back_pain,
                        'mobility_limitation', mobility_limitation,
                        'trauma_history', trauma_history,
                        'prior_imaging', prior_imaging,
                        'assistive_devices', assistive_devices,
                        'physiotherapy_history', physiotherapy_history,
                        'pain_triggers', pain_triggers,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_orthopedics_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "neurology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'headache', headache,
                        'dizziness', dizziness,
                        'sensory_changes', sensory_changes,
                        'weakness', weakness,
                        'seizure_history', seizure_history,
                        'gait_balance_issues', gait_balance_issues,
                        'prior_neuro_imaging', prior_neuro_imaging,
                        'prior_neurology_workup', prior_neurology_workup,
                        'cognitive_changes', cognitive_changes,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_neurology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "pulmonology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'chronic_cough', chronic_cough,
                        'dyspnea', dyspnea,
                        'wheezing', wheezing,
                        'chest_tightness', chest_tightness,
                        'hemoptysis', hemoptysis,
                        'smoking_history', smoking_history,
                        'prior_chest_imaging', prior_chest_imaging,
                        'inhaler_therapy', inhaler_therapy,
                        'sleep_apnea_history', sleep_apnea_history,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_pulmonology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        "urology" => Some(
            sqlx::query(
                r#"SELECT jsonb_build_object(
                        'is_relevant', is_relevant,
                        'dysuria', dysuria,
                        'hematuria', hematuria,
                        'flank_pain', flank_pain,
                        'urinary_frequency', urinary_frequency,
                        'urinary_retention', urinary_retention,
                        'incontinence', incontinence,
                        'prior_urology_workup', prior_urology_workup,
                        'catheter_history', catheter_history,
                        'stone_history', stone_history,
                        'red_flags', red_flags,
                        'notes', notes
                    ) AS value
                   FROM case_urology_assessments
                   WHERE case_id = $1"#,
            )
            .bind(case_id)
            .fetch_optional(db)
            .await?,
        ),
        _ => None,
    };

    Ok(query.flatten().and_then(|row| {
        row.try_get::<Option<serde_json::Value>, _>("value")
            .ok()
            .flatten()
    }))
}

async fn resolve_medication_expiry_notification_recipients(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let assigned = sqlx::query_scalar(
        r#"SELECT pa.user_id
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = 'patient_manager'
           ORDER BY pa.assigned_at"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await?;

    if !assigned.is_empty() {
        return Ok(assigned);
    }

    let fallback = sqlx::query_scalar(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role IN ('ceo', 'ceo_assistant')
           ORDER BY CASE role
               WHEN 'ceo' THEN 0
               ELSE 1
           END,
           created_at
           LIMIT 1"#,
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(fallback.into_iter().collect())
}

async fn load_patient_medication_expiry_candidates(
    state: &AppState,
    today: chrono::NaiveDate,
) -> Result<Vec<PatientMedicationExpiryCandidate>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT m.id AS patient_medication_id,
                  m.patient_id,
                  p.patient_id AS patient_code,
                  p.first_name,
                  p.last_name,
                  m.handelsname,
                  m.wirkstoff,
                  m.einnahme_bis::date AS expiry_date
           FROM patient_medications m
           JOIN patients p ON p.id = m.patient_id
           LEFT JOIN medication_expiry_events mee
                  ON mee.patient_medication_id = m.id
                 AND mee.status = 'pending_confirmation'
           WHERE m.category = 'dauer'
             AND m.status = 'aktiv'
             AND m.superseded_at IS NULL
             AND m.einnahme_bis ~ '^\d{4}-\d{2}-\d{2}$'
             AND m.einnahme_bis::date < $1
             AND mee.id IS NULL
           ORDER BY m.einnahme_bis, m.created_at"#,
    )
    .bind(today)
    .fetch_all(&state.db)
    .await?;

    let mut candidates = Vec::new();
    for row in rows {
        let trade_name = row.try_get::<String, _>("handelsname").unwrap_or_default();
        let medication_name = if trade_name.trim().is_empty() {
            row.try_get::<Option<String>, _>("wirkstoff")
                .unwrap_or_default()
                .unwrap_or_default()
        } else {
            trade_name
        };
        candidates.push(PatientMedicationExpiryCandidate {
            patient_medication_id: row
                .try_get::<Uuid, _>("patient_medication_id")
                .unwrap_or_default(),
            patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            patient_code: row.try_get::<String, _>("patient_code").unwrap_or_default(),
            patient_name: format!(
                "{} {}",
                row.try_get::<String, _>("first_name").unwrap_or_default(),
                row.try_get::<String, _>("last_name").unwrap_or_default()
            )
            .trim()
            .to_string(),
            medication_name,
            expiry_date: row
                .try_get::<chrono::NaiveDate, _>("expiry_date")
                .unwrap_or(today),
        });
    }
    Ok(candidates)
}

pub async fn run_medication_expiry_scheduler_once(
    state: &AppState,
) -> Result<MedicationExpiryRunSummary, sqlx::Error> {
    let today = chrono::Utc::now().date_naive();
    let mut summary = MedicationExpiryRunSummary::default();

    for candidate in load_patient_medication_expiry_candidates(state, today).await? {
        let inserted = sqlx::query(
            r#"INSERT INTO medication_expiry_events (
                    patient_medication_id, patient_id, expiry_date
               ) VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING
               RETURNING id"#,
        )
        .bind(candidate.patient_medication_id)
        .bind(candidate.patient_id)
        .bind(candidate.expiry_date)
        .fetch_optional(&state.db)
        .await?;

        let Some(inserted) = inserted else {
            continue;
        };
        let medication_expiry_event_id: Uuid = inserted.try_get("id").unwrap_or_default();

        summary.events_created += 1;
        let recipients =
            resolve_medication_expiry_notification_recipients(state, candidate.patient_id).await?;

        for recipient_id in recipients {
            let notification_row = sqlx::query(
                r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                   VALUES ($1, $2, $3, $4, 'patient', $5)
                   RETURNING id, user_id"#,
            )
            .bind(recipient_id)
            .bind("medication_expiry_confirmation")
            .bind(format!(
                "Medication review required for {}",
                candidate.patient_code
            ))
            .bind(format!(
                "{} ({}) reached its intake end date {} and now requires confirmation. Patient: {}.",
                candidate.medication_name,
                candidate.patient_code,
                candidate.expiry_date,
                candidate.patient_name
            ))
            .bind(candidate.patient_id)
            .fetch_one(&state.db)
            .await?;
            let notification_id: Uuid = notification_row.try_get("id").unwrap_or_default();
            let user_id: Uuid = notification_row.try_get("user_id").unwrap_or_default();
            if !notification_id.is_nil() && !user_id.is_nil() {
                crate::realtime::publish_notification_event(
                    state,
                    user_id,
                    "notification.created",
                    Some(notification_id),
                    serde_json::json!({
                        "entity_type": "patient",
                        "entity_id": candidate.patient_id,
                    }),
                )
                .await;
            }
            summary.notifications_created += 1;
        }

        state.audit_sender.try_send(audit::domain_event(
            "auto_flag_medication_expiry".to_string(),
            None,
            "patient",
            Some(candidate.patient_id),
            serde_json::json!({
                "patient_medication_id": candidate.patient_medication_id,
                "medication_name": candidate.medication_name.clone(),
                "expiry_date": candidate.expiry_date.to_string(),
            }),
        ));
        crate::realtime::publish_patient_event(
            state,
            None,
            "patient.medication_expiry_flagged",
            candidate.patient_id,
            serde_json::json!({
                "medication_expiry_event_id": medication_expiry_event_id,
                "patient_medication_id": candidate.patient_medication_id,
                "medication_name": candidate.medication_name,
                "expiry_date": candidate.expiry_date.to_string(),
            }),
        )
        .await;
    }

    Ok(summary)
}

pub fn spawn_medication_expiry_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            MEDICATION_EXPIRY_CHECK_INTERVAL_SECS,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;

        loop {
            interval.tick().await;
            match run_medication_expiry_scheduler_once(&state).await {
                Ok(summary) => {
                    if summary.events_created > 0 || summary.notifications_created > 0 {
                        tracing::info!(
                            events_created = summary.events_created,
                            notifications_created = summary.notifications_created,
                            "Medication expiry scheduler created confirmation work"
                        );
                    }
                }
                Err(error) => {
                    tracing::error!(error = %error, "Medication expiry scheduler failed");
                }
            }
        }
    });
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role.has_full_access() {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate patient access")
        })?;

    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn can_access_case(
    state: &AppState,
    auth: &AuthUser,
    case_id: Uuid,
    patient_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    can_access_case_subject(state, auth, case_id, patient_id, None).await
}

async fn can_access_case_subject(
    state: &AppState,
    auth: &AuthUser,
    case_id: Uuid,
    patient_id: Option<Uuid>,
    lead_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    if auth.role.has_full_access() {
        return Ok(true);
    }

    let (patient_id, lead_id, manager_id) = if patient_id.is_none() && lead_id.is_none() {
        let row = sqlx::query(
            "SELECT patient_id, lead_id, manager_id FROM cases WHERE id = $1",
        )
            .bind(case_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, case_id = %case_id, "Failed to load case access context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate case access")
            })?;

        let Some(row) = row else {
            return Ok(false);
        };
        let manager_id: Uuid = row.try_get("manager_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode case access context",
            )
        })?;
        (
            row.try_get::<Option<Uuid>, _>("patient_id")
                .unwrap_or_default(),
            row.try_get::<Option<Uuid>, _>("lead_id")
                .unwrap_or_default(),
            Some(manager_id),
        )
    } else {
        (patient_id, lead_id, None)
    };

    if manager_id == Some(auth.user_id) {
        return Ok(true);
    }

    if let Some(patient_id) = patient_id {
        return access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate case assignment");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate case access",
                )
            });
    }

    if lead_id.is_some() {
        let manager_id = match manager_id {
            Some(value) => value,
            None => sqlx::query_scalar::<_, Uuid>("SELECT manager_id FROM cases WHERE id = $1")
                .bind(case_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|error| {
                    tracing::error!(error = %error, case_id = %case_id, "load lead case manager");
                    err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to validate case access",
                    )
                })?
                .unwrap_or_else(Uuid::nil),
        };
        return Ok(manager_id == auth.user_id);
    }

    Ok(false)
}

async fn resolve_case_doctor_label(
    state: &AppState,
    doctor_id: Option<Uuid>,
    free_text: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    let normalized_free_text = free_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let Some(doctor_id) = doctor_id else {
        return Ok(normalized_free_text);
    };

    let row = sqlx::query("SELECT name FROM provider_doctors WHERE id = $1")
        .bind(doctor_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %doctor_id, "resolve case doctor");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate doctor",
            )
        })?;

    let Some(row) = row else {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Doctor not found"));
    };

    let doctor_name = row.try_get::<String, _>("name").unwrap_or_default();
    if doctor_name.trim().is_empty() {
        return Ok(normalized_free_text);
    }

    Ok(Some(normalized_free_text.unwrap_or(doctor_name)))
}
