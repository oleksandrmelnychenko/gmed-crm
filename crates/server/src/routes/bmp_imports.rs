use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
};
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::bmp_import::{
    BmpImportError, ConfirmBmpImportInput, build_preview, confirm_import,
};
use crate::state::AppState;

const BMP_IMPORT_ROLES: &[Role] = &[Role::Ceo];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/patients/{patient_id}/bmp-imports/preview", post(preview))
        .route("/patients/{patient_id}/bmp-imports/confirm", post(confirm))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreviewRequest {
    carrier_xml: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfirmRequest {
    carrier_xml: String,
    preview_fingerprint: String,
    idempotency_key: String,
    staff_acknowledged: bool,
}

async fn preview(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path(patient_id): Path<Uuid>,
    Json(request): Json<PreviewRequest>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("preview_bmp_carrier_import");
    audit_context.set_context(json!({
        "mode": "kbv_bmp_carrier_xml",
        "spec_version": "028",
        "image_decoding": false,
        "external_calls": false,
    }));
    match build_preview(&state.db, patient_id, &request.carrier_xml).await {
        Ok(response) => Json(response).into_response(),
        Err(error_value) => service_error(error_value, patient_id),
    }
}

async fn confirm(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path(patient_id): Path<Uuid>,
    Json(request): Json<ConfirmRequest>,
) -> axum::response::Response {
    if let Some(response) = authorize(&state, &auth, patient_id).await {
        return response;
    }
    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("confirm_bmp_carrier_import");
    audit_context.set_context(json!({
        "mode": "kbv_bmp_carrier_xml",
        "spec_version": "028",
        "preview_fingerprint": request.preview_fingerprint,
        "strategy": "replace_current",
        "staff_acknowledged": request.staff_acknowledged,
    }));
    let result = match confirm_import(
        &state.db,
        patient_id,
        auth.user_id,
        ConfirmBmpImportInput {
            carrier_xml: &request.carrier_xml,
            preview_fingerprint: &request.preview_fingerprint,
            idempotency_key: &request.idempotency_key,
            staff_acknowledged: request.staff_acknowledged,
        },
    )
    .await
    {
        Ok(value) => value,
        Err(error_value) => return service_error(error_value, patient_id),
    };
    if result.created {
        let response = &result.response;
        state.audit_sender.try_send(audit::domain_event(
            "bmp_carrier_import_confirmed",
            Some(auth.user_id),
            "patient",
            Some(patient_id),
            json!({
                "import_id": response.import_id,
                "plan_instance_id": response.plan_instance_id,
                "imported_medications": response.imported_medications,
                "superseded_medications": response.superseded_medications,
                "strategy": response.strategy,
            }),
        ));
        crate::realtime::publish_patient_event(
            &state,
            Some(auth.user_id),
            "patient.bmp_import_confirmed",
            patient_id,
            json!({
                "import_id": response.import_id,
                "imported_medications": response.imported_medications,
                "section": "medications",
            }),
        )
        .await;
        (StatusCode::CREATED, Json(result.response)).into_response()
    } else {
        Json(result.response).into_response()
    }
}

async fn authorize(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Option<axum::response::Response> {
    if let Err(response) = auth.require_any_role(BMP_IMPORT_ROLES) {
        return Some(response);
    }
    if auth.role.has_full_access() || !access::requires_patient_assignment(auth.role) {
        return None;
    }
    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => None,
        Ok(false) => Some(error_response(
            StatusCode::FORBIDDEN,
            "bmp_access_forbidden",
            "Insufficient permissions",
        )),
        Err(error_value) => {
            tracing::error!(error = %error_value, patient_id = %patient_id, "validate BMP import access");
            Some(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "bmp_access_failed",
                "Failed to validate patient access",
            ))
        }
    }
}

fn service_error(error_value: BmpImportError, patient_id: Uuid) -> axum::response::Response {
    let (status, code, message) = match &error_value {
        BmpImportError::PatientNotFound => (
            StatusCode::NOT_FOUND,
            "bmp_patient_not_found",
            "Patient not found",
        ),
        BmpImportError::StalePreview => (
            StatusCode::CONFLICT,
            "bmp_preview_stale",
            "Patient or medication data changed; refresh the BMP preview",
        ),
        BmpImportError::IdentityMismatch => (
            StatusCode::CONFLICT,
            "bmp_patient_identity_mismatch",
            "BMP identity does not match the selected patient",
        ),
        BmpImportError::IdempotencyConflict => (
            StatusCode::CONFLICT,
            "bmp_idempotency_conflict",
            "Idempotency key belongs to another BMP import",
        ),
        BmpImportError::InvalidCarrier(_) | BmpImportError::UnsupportedCarrier(_) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "bmp_carrier_invalid",
            "BMP carrier XML is invalid or unsupported",
        ),
        BmpImportError::BlockingContent => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "bmp_import_blocked",
            "BMP carrier contains content that cannot be imported losslessly",
        ),
        BmpImportError::StaffAcknowledgementRequired => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "bmp_acknowledgement_required",
            "Explicit staff acknowledgement is required",
        ),
        BmpImportError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "bmp_request_invalid",
            "BMP import request is invalid",
        ),
        BmpImportError::Database(sqlx::Error::Database(database_error))
            if database_error.code().as_deref() == Some("40001") =>
        {
            (
                StatusCode::CONFLICT,
                "bmp_preview_stale",
                "Concurrent medication change detected; refresh the BMP preview",
            )
        }
        BmpImportError::Database(_) | BmpImportError::Json(_) => {
            tracing::error!(error = %error_value, patient_id = %patient_id, "BMP import workflow");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "bmp_import_failed",
                "BMP import workflow failed",
            )
        }
    };
    error_response(status, code, message)
}

fn error_response(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (
        status,
        Json::<Value>(json!({
            "error": "bmp_import_failed",
            "code": code,
            "message": message,
        })),
    )
        .into_response()
}
