use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::medication_intelligence::build_patient_medication_intelligence;
use crate::services::medication_ai_jobs::{
    MedicationAiJobError, create_analysis, load_analysis, retry_analysis,
};
use crate::services::medication_evidence_reviews::{
    MedicationEvidenceReviewError, build_preview, create_review, load_review,
};
use crate::state::AppState;

const MEDICATION_EVIDENCE_REVIEW_ROLES: &[Role] = &[Role::Ceo];

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/medication-evidence-reviews/preview",
            get(get_preview),
        )
        .route(
            "/patients/{patient_id}/medication-evidence-reviews",
            axum::routing::post(create),
        )
        .route(
            "/patients/{patient_id}/medication-evidence-reviews/{review_id}",
            get(get_by_id),
        )
        .route(
            "/patients/{patient_id}/medication-evidence-reviews/{review_id}/ai-analysis",
            get(get_ai_analysis).post(create_ai_analysis),
        )
        .route(
            "/patients/{patient_id}/medication-evidence-reviews/{review_id}/ai-analysis/retry",
            axum::routing::post(retry_ai_analysis),
        )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateReviewRequest {
    intelligence_fingerprint: String,
    idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateAiAnalysisRequest {
    idempotency_key: String,
}

async fn get_preview(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("preview_medication_evidence_review");
    audit_context.set_context(json!({
        "mode": "local_evidence_only",
        "external_calls_enabled": false,
        "clinical_review": "not_configured",
    }));

    let intelligence = match build_patient_medication_intelligence(&state.db, patient_id).await {
        Ok(value) => value,
        Err(error_value) => return intelligence_error(error_value, patient_id),
    };
    match build_preview(
        &state.db,
        patient_id,
        &intelligence,
        state.medication_ai.capability(),
    )
    .await
    {
        Ok(response) => Json(response).into_response(),
        Err(error_value) => service_error(error_value, patient_id, None),
    }
}

async fn create_ai_analysis(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_id, review_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<CreateAiAnalysisRequest>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    let capability = state.medication_ai.capability();
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("create_medication_ai_analysis");
    audit_context.set_context(json!({
        "review_id": review_id,
        "provider_kind": capability.kind,
        "provider_status": capability.status,
        "external_calls_enabled": capability.external_calls_enabled,
    }));
    match create_analysis(
        &state,
        patient_id,
        review_id,
        auth.user_id,
        &request.idempotency_key,
    )
    .await
    {
        Ok(result) if result.created => {
            metrics::counter!(
                crate::business_metrics::MEDICATION_AI_JOBS_TOTAL,
                "outcome" => "requested",
                "reason" => "operator_requested"
            )
            .increment(1);
            state.audit_sender.try_send(audit::domain_event(
                "medication_ai_analysis_requested",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                json!({"analysis_id": result.view.id, "review_id": review_id, "provider_kind": "openai"}),
            ));
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.medication_ai_analysis_requested",
                patient_id,
                json!({
                    "analysis_id": result.view.id,
                    "review_id": review_id,
                    "status": result.view.status,
                }),
            )
            .await;
            (StatusCode::ACCEPTED, Json(result.view)).into_response()
        }
        Ok(result) => Json(result.view).into_response(),
        Err(error_value) => ai_job_error(error_value, patient_id, review_id),
    }
}

async fn get_ai_analysis(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_id, review_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("read_medication_ai_analysis");
    audit_context.set_context(json!({"review_id": review_id}));
    match load_analysis(
        &state.db,
        patient_id,
        review_id,
        state.medication_ai.capability(),
    )
    .await
    {
        Ok(view) => Json(view).into_response(),
        Err(error_value) => ai_job_error(error_value, patient_id, review_id),
    }
}

async fn retry_ai_analysis(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_id, review_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("retry_medication_ai_analysis");
    audit_context.set_context(json!({"review_id": review_id}));
    match retry_analysis(&state, patient_id, review_id, auth.user_id).await {
        Ok(view) => {
            metrics::counter!(
                crate::business_metrics::MEDICATION_AI_JOBS_TOTAL,
                "outcome" => "manual_retry",
                "reason" => "operator_requested"
            )
            .increment(1);
            state.audit_sender.try_send(audit::domain_event(
                "medication_ai_analysis_requested",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                json!({
                    "analysis_id": view.id,
                    "review_id": review_id,
                    "provider_kind": "openai",
                    "reason": "manual_retry",
                }),
            ));
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.medication_ai_analysis_requested",
                patient_id,
                json!({
                    "analysis_id": view.id,
                    "review_id": review_id,
                    "status": view.status,
                    "reason": "manual_retry",
                }),
            )
            .await;
            (StatusCode::ACCEPTED, Json(view)).into_response()
        }
        Err(error_value) => ai_job_error(error_value, patient_id, review_id),
    }
}

async fn create(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path(patient_id): Path<Uuid>,
    Json(request): Json<CreateReviewRequest>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("create_medication_evidence_review");
    audit_context.set_context(json!({
        "mode": "local_evidence_only",
        "intelligence_fingerprint": request.intelligence_fingerprint,
        "external_calls_enabled": false,
        "clinical_review": "not_configured",
    }));

    let intelligence = match build_patient_medication_intelligence(&state.db, patient_id).await {
        Ok(value) => value,
        Err(error_value) => return intelligence_error(error_value, patient_id),
    };
    let result = match create_review(
        &state.db,
        patient_id,
        auth.user_id,
        &request.intelligence_fingerprint,
        &request.idempotency_key,
        &intelligence,
    )
    .await
    {
        Ok(value) => value,
        Err(error_value) => return service_error(error_value, patient_id, None),
    };

    if result.created {
        let review_id = result.response.review.id;
        let bundle_id = result.response.review.bundle_id;
        state.audit_sender.try_send(audit::domain_event(
            "medication_evidence_review_created",
            Some(auth.user_id),
            "patient",
            Some(patient_id),
            json!({
                "review_id": review_id,
                "bundle_id": bundle_id,
                "mode": "local_evidence_only",
                "provider_status": "not_configured",
                "clinical_review": "not_configured",
            }),
        ));
        crate::realtime::publish_patient_event(
            &state,
            Some(auth.user_id),
            "patient.medication_evidence_review_created",
            patient_id,
            json!({
                "review_id": review_id,
                "bundle_id": bundle_id,
                "status": result.response.review.status,
            }),
        )
        .await;
        (StatusCode::CREATED, Json(result.response)).into_response()
    } else {
        Json(result.response).into_response()
    }
}

async fn get_by_id(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_id, review_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("read_medication_evidence_review");
    audit_context.set_context(json!({
        "review_id": review_id,
        "mode": "local_evidence_only",
    }));

    match load_review(&state.db, patient_id, review_id).await {
        Ok(response) => Json(response).into_response(),
        Err(error_value) => service_error(error_value, patient_id, Some(review_id)),
    }
}

async fn authorize(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Option<axum::response::Response> {
    if let Err(response) = auth.require_any_role(MEDICATION_EVIDENCE_REVIEW_ROLES) {
        return Some(response);
    }
    if auth.role.has_full_access() || !access::requires_patient_assignment(auth.role) {
        return None;
    }
    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => None,
        Ok(false) => Some(error(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(error_value) => {
            tracing::error!(
                error = %error_value,
                patient_id = %patient_id,
                "validate medication evidence review patient access"
            );
            Some(error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

fn intelligence_error(error_value: sqlx::Error, patient_id: Uuid) -> axum::response::Response {
    tracing::error!(
        error = %error_value,
        patient_id = %patient_id,
        "build medication evidence review input"
    );
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to build medication evidence preview",
    )
}

fn service_error(
    error_value: MedicationEvidenceReviewError,
    patient_id: Uuid,
    review_id: Option<Uuid>,
) -> axum::response::Response {
    let (status, message) = match error_value {
        MedicationEvidenceReviewError::NotFound => (
            StatusCode::NOT_FOUND,
            "Medication evidence review not found",
        ),
        MedicationEvidenceReviewError::StaleFingerprint => (
            StatusCode::CONFLICT,
            "Medication intelligence changed; refresh preview before creating a review",
        ),
        MedicationEvidenceReviewError::IdempotencyConflict => (
            StatusCode::CONFLICT,
            "Idempotency key belongs to another medication evidence review",
        ),
        MedicationEvidenceReviewError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "Medication evidence review input is invalid",
        ),
        MedicationEvidenceReviewError::InvalidCitation
        | MedicationEvidenceReviewError::InvalidStoredData
        | MedicationEvidenceReviewError::Database(_)
        | MedicationEvidenceReviewError::Json(_) => {
            tracing::error!(
                error = %error_value,
                patient_id = %patient_id,
                review_id = ?review_id,
                "medication evidence review workflow"
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Medication evidence review workflow failed",
            )
        }
    };
    error(status, message)
}

fn ai_job_error(
    error_value: MedicationAiJobError,
    patient_id: Uuid,
    review_id: Uuid,
) -> axum::response::Response {
    let (status, message) = match error_value {
        MedicationAiJobError::ProviderUnavailable => (
            StatusCode::CONFLICT,
            "Medication AI provider is not available",
        ),
        MedicationAiJobError::ReviewNotFound => (
            StatusCode::NOT_FOUND,
            "Medication evidence review or AI analysis not found",
        ),
        MedicationAiJobError::ReviewNotReady => (
            StatusCode::CONFLICT,
            "Medication evidence review is not ready",
        ),
        MedicationAiJobError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "Medication AI analysis input is invalid",
        ),
        MedicationAiJobError::IdempotencyConflict => (
            StatusCode::CONFLICT,
            "Idempotency key belongs to another medication AI analysis",
        ),
        MedicationAiJobError::InvalidStoredData
        | MedicationAiJobError::Database(_)
        | MedicationAiJobError::Json(_) => {
            tracing::error!(
                error = %error_value,
                patient_id = %patient_id,
                review_id = %review_id,
                "medication AI analysis workflow"
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Medication AI analysis workflow failed",
            )
        }
    };
    error(status, message)
}

fn error(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json::<Value>(json!({
            "error": status.canonical_reason().unwrap_or("request_failed"),
            "message": message,
        })),
    )
        .into_response()
}
