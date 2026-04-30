use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::drug_matching::{
    load_german_equivalents, load_medication_german_equivalents, search_drug_products,
};
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/drug-products/search", get(search_products))
        .route(
            "/drug-products/{product_id}/german-equivalents",
            get(get_german_equivalents),
        )
        .route(
            "/drug-equivalents/{equivalent_id}/verify",
            post(verify_drug_equivalent),
        )
        .route(
            "/cases/{case_id}/medikamente/{medication_id}/equivalents",
            get(get_medication_equivalents),
        )
        .route(
            "/cases/{case_id}/medikamente/{medication_id}/drug-matches",
            post(create_medication_drug_match),
        )
        .route(
            "/cases/{case_id}/medikamente/{medication_id}/drug-matches/{match_id}/verify",
            post(verify_medication_drug_match),
        )
}

#[derive(Deserialize)]
struct DrugSearchQuery {
    q: String,
    country_code: Option<String>,
    include_candidates: Option<bool>,
}

#[derive(Deserialize)]
struct EquivalentQuery {
    include_candidates: Option<bool>,
}

#[derive(Deserialize)]
struct VerifyRequest {
    verification_status: Option<String>,
    note: Option<String>,
}

#[derive(Deserialize)]
struct CreateMedicationDrugMatch {
    drug_product_id: Uuid,
    confidence: Option<f64>,
    note: Option<String>,
}

async fn search_products(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<DrugSearchQuery>,
) -> axum::response::Response {
    if let Err(resp) = require_staff_drug_access(&auth) {
        return resp;
    }

    match search_drug_products(
        &state.db,
        &query.q,
        query.country_code.as_deref(),
        query.include_candidates.unwrap_or(false),
    )
    .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => {
            tracing::error!(error = %error, "search drug products");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to search drugs")
        }
    }
}

async fn get_german_equivalents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(product_id): Path<Uuid>,
    Query(query): Query<EquivalentQuery>,
) -> axum::response::Response {
    if let Err(resp) = require_staff_drug_access(&auth) {
        return resp;
    }

    match load_german_equivalents(&state.db, product_id, query.include_candidates.unwrap_or(false))
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => {
            tracing::error!(error = %error, product_id = %product_id, "load german drug equivalents");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load German equivalents",
            )
        }
    }
}

async fn get_medication_equivalents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((case_id, medication_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<EquivalentQuery>,
) -> axum::response::Response {
    if let Err(resp) = require_staff_drug_access(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_case_access(&state, &auth, case_id).await {
        return resp;
    }

    match load_medication_german_equivalents(
        &state.db,
        case_id,
        medication_id,
        query.include_candidates.unwrap_or(false),
    )
    .await
    {
        Ok(Some(payload)) => Json(payload).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Medication not found"),
        Err(error) => {
            tracing::error!(error = %error, case_id = %case_id, medication_id = %medication_id, "load medication equivalents");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication equivalents",
            )
        }
    }
}

async fn create_medication_drug_match(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((case_id, medication_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateMedicationDrugMatch>,
) -> axum::response::Response {
    if let Err(resp) = require_staff_drug_access(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_case_access(&state, &auth, case_id).await {
        return resp;
    }

    let confidence = Decimal::try_from(body.confidence.unwrap_or(0.70))
        .unwrap_or_else(|_| Decimal::new(70, 2));
    if confidence < Decimal::ZERO || confidence > Decimal::ONE {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Confidence must be between 0 and 1",
        );
    }

    match sqlx::query(
        r#"INSERT INTO medication_drug_matches (
                case_id, medication_id, drug_product_id, match_kind, confidence,
                verification_status, note, created_by
           ) VALUES ($1, $2, $3, 'staff_candidate', $4, 'candidate', $5, $6)
           ON CONFLICT (case_id, medication_id, drug_product_id)
           DO UPDATE SET confidence = EXCLUDED.confidence,
                         note = EXCLUDED.note,
                         updated_at = now()
           RETURNING id, verification_status, confidence"#,
    )
    .bind(case_id)
    .bind(medication_id)
    .bind(body.drug_product_id)
    .bind(confidence)
    .bind(normalize_optional_text(body.note))
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let match_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            state.audit_sender.try_send(audit::domain_event(
                "drug_match_created".to_string(),
                Some(auth.user_id),
                "case",
                Some(case_id),
                serde_json::json!({
                    "medication_id": medication_id,
                    "drug_product_id": body.drug_product_id,
                    "match_id": match_id,
                }),
            ));
            Json(serde_json::json!({
                "id": match_id,
                "verification_status": row.try_get::<String, _>("verification_status").unwrap_or_else(|_| "candidate".to_string()),
                "confidence": row.try_get::<Decimal, _>("confidence").unwrap_or(confidence).round_dp(2).normalize().to_string(),
            }))
            .into_response()
        }
        Err(error) => {
            tracing::error!(error = %error, case_id = %case_id, medication_id = %medication_id, "create medication drug match");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create medication match",
            )
        }
    }
}

async fn verify_drug_equivalent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(equivalent_id): Path<Uuid>,
    Json(body): Json<VerifyRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    let status = body
        .verification_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("verified");
    if !matches!(status, "verified" | "rejected" | "candidate") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid verification status",
        );
    }

    match sqlx::query(
        r#"UPDATE drug_equivalents
           SET verification_status = $2,
               note = COALESCE($3, note),
               verified_by = CASE WHEN $2 = 'verified' THEN $4 ELSE verified_by END,
               verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE verified_at END,
               updated_at = now()
           WHERE id = $1
           RETURNING source_product_id, equivalent_product_id"#,
    )
    .bind(equivalent_id)
    .bind(status)
    .bind(normalize_optional_text(body.note))
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            state.audit_sender.try_send(audit::domain_event(
                "drug_equivalent_verified".to_string(),
                Some(auth.user_id),
                "drug_equivalent",
                Some(equivalent_id),
                serde_json::json!({
                    "source_product_id": row.try_get::<Uuid, _>("source_product_id").unwrap_or_default(),
                    "equivalent_product_id": row.try_get::<Uuid, _>("equivalent_product_id").unwrap_or_default(),
                    "verification_status": status,
                }),
            ));
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Drug equivalent not found"),
        Err(error) => {
            tracing::error!(error = %error, equivalent_id = %equivalent_id, "verify drug equivalent");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to verify drug equivalent",
            )
        }
    }
}

async fn verify_medication_drug_match(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((case_id, medication_id, match_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<VerifyRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    if let Err(resp) = ensure_case_access(&state, &auth, case_id).await {
        return resp;
    }
    let status = body
        .verification_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("verified");
    if !matches!(status, "verified" | "rejected" | "candidate") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid verification status",
        );
    }

    match sqlx::query(
        r#"UPDATE medication_drug_matches
           SET verification_status = $4,
               match_kind = CASE WHEN $4 = 'verified' THEN 'staff_verified' ELSE match_kind END,
               note = COALESCE($5, note),
               verified_by = CASE WHEN $4 = 'verified' THEN $6 ELSE verified_by END,
               verified_at = CASE WHEN $4 = 'verified' THEN now() ELSE verified_at END,
               updated_at = now()
           WHERE id = $1
             AND case_id = $2
             AND medication_id = $3
           RETURNING drug_product_id"#,
    )
    .bind(match_id)
    .bind(case_id)
    .bind(medication_id)
    .bind(status)
    .bind(normalize_optional_text(body.note))
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            state.audit_sender.try_send(audit::domain_event(
                "drug_match_verified".to_string(),
                Some(auth.user_id),
                "case",
                Some(case_id),
                serde_json::json!({
                    "medication_id": medication_id,
                    "match_id": match_id,
                    "drug_product_id": row.try_get::<Uuid, _>("drug_product_id").unwrap_or_default(),
                    "verification_status": status,
                }),
            ));
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Medication match not found"),
        Err(error) => {
            tracing::error!(error = %error, match_id = %match_id, "verify medication drug match");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to verify medication match",
            )
        }
    }
}

fn require_staff_drug_access(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::PatientManager, Role::TeamleadInterpreter])
}

async fn ensure_case_access(
    state: &AppState,
    auth: &AuthUser,
    case_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }

    let row = sqlx::query("SELECT patient_id, manager_id FROM cases WHERE id = $1")
        .bind(case_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, case_id = %case_id, "load case access");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate case access")
        })?;
    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "Case not found"));
    };
    let manager_id = row.try_get::<Uuid, _>("manager_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to decode case access",
        )
    })?;
    if manager_id == auth.user_id {
        return Ok(());
    }
    let patient_id = row.try_get::<Uuid, _>("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to decode case access",
        )
    })?;
    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, patient_id = %patient_id, "validate case assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate case access")
        })?;
    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}
