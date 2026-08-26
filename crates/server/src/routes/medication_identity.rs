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
use crate::services::medication_identity::{
    ConfirmMedicationIdentityInput, MedicationIdentityError, confirm_identity,
    generate_candidate_set, load_latest_candidate_set,
};
use crate::state::AppState;

const MEDICATION_IDENTITY_ROLES: &[Role] = &[Role::Ceo];

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/medications/{medication_id}/identity-candidates",
            get(get_latest_candidates).post(generate_candidates),
        )
        .route(
            "/patients/{patient_id}/medications/{medication_id}/identity-confirmations",
            axum::routing::post(confirm_candidate),
        )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfirmIdentityRequest {
    candidate_set_id: Uuid,
    candidate_id: Uuid,
    medication_version: String,
    source_snapshot_id: Option<Uuid>,
    staff_acknowledged: bool,
    note: Option<String>,
    idempotency_key: Option<String>,
}

async fn generate_candidates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_id, medication_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }

    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("generate_medication_identity_candidates");
    audit_context.set_context(json!({
        "patient_medication_id": medication_id,
        "source_state": "internal_curated",
    }));

    match generate_candidate_set(&state.db, patient_id, medication_id, auth.user_id).await {
        Ok(response) => Json(response).into_response(),
        Err(error_value) => service_error(error_value, patient_id, medication_id),
    }
}

async fn get_latest_candidates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_id, medication_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }

    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("read_medication_identity_candidates");
    audit_context.set_context(json!({ "patient_medication_id": medication_id }));

    match load_latest_candidate_set(&state.db, patient_id, medication_id).await {
        Ok(Some(response)) => Json(response).into_response(),
        Ok(None) => error(
            StatusCode::NOT_FOUND,
            "Medication identity candidate set not found",
        ),
        Err(error_value) => service_error(error_value, patient_id, medication_id),
    }
}

async fn confirm_candidate(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_id, medication_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<ConfirmIdentityRequest>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }

    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("confirm_medication_identity");
    audit_context.set_context(json!({
        "patient_medication_id": medication_id,
        "candidate_set_id": request.candidate_set_id,
        "candidate_id": request.candidate_id,
        "medication_version": request.medication_version,
        "source_state": "internal_curated",
    }));

    let input = ConfirmMedicationIdentityInput {
        candidate_set_id: request.candidate_set_id,
        candidate_id: request.candidate_id,
        medication_version: request.medication_version,
        source_snapshot_id: request.source_snapshot_id,
        staff_acknowledged: request.staff_acknowledged,
        note: request.note,
        idempotency_key: request.idempotency_key,
    };

    let result =
        match confirm_identity(&state.db, patient_id, medication_id, auth.user_id, input).await {
            Ok(result) => result,
            Err(error_value) => return service_error(error_value, patient_id, medication_id),
        };

    state.audit_sender.try_send(audit::domain_event(
        "medication_identity_confirmed",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "patient_medication_id": medication_id,
            "medication_version": result.medication_version,
            "refresh_token": result.refresh_token,
            "source_state": "internal_curated",
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.medication_identity_confirmed",
        patient_id,
        json!({
            "patient_medication_id": medication_id,
            "identity_status": result.identity_status,
            "medication_version": result.medication_version,
            "refresh_token": result.refresh_token,
        }),
    )
    .await;

    Json(result).into_response()
}

async fn authorize(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Option<axum::response::Response> {
    if let Err(response) = auth.require_any_role(MEDICATION_IDENTITY_ROLES) {
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
                "validate medication identity patient access"
            );
            Some(error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

fn service_error(
    error_value: MedicationIdentityError,
    patient_id: Uuid,
    medication_id: Uuid,
) -> axum::response::Response {
    let (status, message) = match error_value {
        MedicationIdentityError::MedicationNotFound
        | MedicationIdentityError::CandidateSetNotFound
        | MedicationIdentityError::CandidateNotFound => (
            StatusCode::NOT_FOUND,
            "Medication identity record not found",
        ),
        MedicationIdentityError::StaleMedication => (
            StatusCode::CONFLICT,
            "Medication changed; regenerate candidates before confirming",
        ),
        MedicationIdentityError::StaleCandidate => (
            StatusCode::CONFLICT,
            "Drug catalogue evidence changed; regenerate candidates before confirming",
        ),
        MedicationIdentityError::IdempotencyConflict => (
            StatusCode::CONFLICT,
            "Idempotency key belongs to another confirmation",
        ),
        MedicationIdentityError::CandidateNotConfirmable => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "Candidate evidence is insufficient for confirmation",
        ),
        MedicationIdentityError::SourceSnapshotMismatch => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "Source snapshot is not valid for this candidate",
        ),
        MedicationIdentityError::StaffAcknowledgementRequired => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "Staff acknowledgement is required",
        ),
        MedicationIdentityError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "Confirmation input is invalid",
        ),
        MedicationIdentityError::Database(database_error) => {
            tracing::error!(
                error = %database_error,
                patient_id = %patient_id,
                medication_id = %medication_id,
                "medication identity workflow"
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Medication identity workflow failed",
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
