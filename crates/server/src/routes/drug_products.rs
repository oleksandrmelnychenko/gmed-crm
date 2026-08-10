#![allow(clippy::result_large_err)]

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
        .route("/drug-products/import-preview", post(preview_drug_import))
        .route(
            "/drug-products/{product_id}/verify",
            post(verify_drug_product),
        )
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
            get(retired_case_medication_route),
        )
        .route(
            "/cases/{case_id}/medikamente/{medication_id}/drug-matches",
            post(retired_case_medication_route),
        )
        .route(
            "/cases/{case_id}/medikamente/{medication_id}/drug-matches/{match_id}/verify",
            post(retired_case_medication_match_route),
        )
        .route(
            "/patients/{patient_id}/medications/{medication_id}/equivalents",
            get(get_patient_medication_equivalents),
        )
        .route(
            "/patients/{patient_id}/medications/{medication_id}/drug-matches",
            post(create_patient_medication_drug_match),
        )
        .route(
            "/patients/{patient_id}/medications/{medication_id}/drug-matches/{match_id}/verify",
            post(verify_patient_medication_drug_match),
        )
        .route(
            "/patients/{patient_id}/medications/{medication_id}/expiry-confirm",
            post(confirm_patient_medication_expiry),
        )
}

async fn retired_case_medication_route(
    Path((_case_id, _medication_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    err(
        StatusCode::GONE,
        "Case medications moved to the patient record (/patients/{id}/medications)",
    )
}

async fn retired_case_medication_match_route(
    Path((_case_id, _medication_id, _match_id)): Path<(Uuid, Uuid, Uuid)>,
) -> axum::response::Response {
    err(
        StatusCode::GONE,
        "Case medications moved to the patient record (/patients/{id}/medications)",
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

#[derive(Deserialize)]
struct DrugImportPreviewRequest {
    rows: Vec<DrugImportPreviewRow>,
}

#[derive(Deserialize)]
struct DrugImportPreviewRow {
    brand_name: Option<String>,
    country_code: Option<String>,
    atc_code: Option<String>,
    form: Option<String>,
    strength: Option<String>,
    manufacturer: Option<String>,
    substances: Option<Vec<String>>,
    clinical_note: Option<String>,
    verification_status: Option<String>,
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

    match load_german_equivalents(
        &state.db,
        product_id,
        query.include_candidates.unwrap_or(false),
    )
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

async fn preview_drug_import(
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<DrugImportPreviewRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    if body.rows.len() > 500 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Import preview is limited to 500 rows",
        );
    }

    let received_count = body.rows.len();
    let mut valid_count = 0usize;
    let mut issue_count = 0usize;
    let preview = body
        .rows
        .into_iter()
        .take(25)
        .enumerate()
        .map(|(index, row)| {
            let brand_name = normalize_optional_text(row.brand_name).unwrap_or_default();
            let country_code = normalize_country_code(row.country_code.as_deref());
            let verification_status = row
                .verification_status
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("candidate")
                .to_lowercase();
            let substances = row
                .substances
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| normalize_optional_text(Some(value)))
                .collect::<Vec<_>>();
            let mut issues = Vec::new();

            if brand_name.is_empty() {
                issues.push("brand_name is required".to_string());
            }
            if country_code.is_none() {
                issues.push("country_code is required".to_string());
            }
            if !matches!(
                verification_status.as_str(),
                "curated" | "candidate" | "verified" | "rejected"
            ) {
                issues.push("verification_status is invalid".to_string());
            }
            if substances.is_empty() {
                issues.push("at least one substance is recommended".to_string());
            }

            if issues.is_empty() {
                valid_count += 1;
            } else {
                issue_count += 1;
            }

            serde_json::json!({
                "row_number": index + 1,
                "brand_name": brand_name,
                "normalized_brand_name": normalize_search_value(&brand_name),
                "country_code": country_code.unwrap_or_default(),
                "atc_code": normalize_optional_text(row.atc_code),
                "form": normalize_optional_text(row.form),
                "strength": normalize_optional_text(row.strength),
                "manufacturer": normalize_optional_text(row.manufacturer),
                "substances": substances,
                "clinical_note": normalize_optional_text(row.clinical_note),
                "verification_status": verification_status,
                "issues": issues,
            })
        })
        .collect::<Vec<_>>();

    Json(serde_json::json!({
        "mode": "dry_run",
        "received_count": received_count,
        "valid_preview_count": valid_count,
        "issue_preview_count": issue_count,
        "preview": preview,
        "message": "Import preview only; no drug products were written.",
    }))
    .into_response()
}

async fn verify_drug_product(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(product_id): Path<Uuid>,
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
        .unwrap_or("verified")
        .to_lowercase();
    if !matches!(
        status.as_str(),
        "curated" | "candidate" | "verified" | "rejected"
    ) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid verification status",
        );
    }

    match sqlx::query(
        r#"UPDATE drug_products
           SET verification_status = $2,
               clinical_note = COALESCE($3, clinical_note),
               updated_by = $4,
               updated_at = now()
           WHERE id = $1
           RETURNING brand_name, country_code, verification_status"#,
    )
    .bind(product_id)
    .bind(&status)
    .bind(normalize_optional_text(body.note))
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            state.audit_sender.try_send(audit::domain_event(
                "drug_product_verified".to_string(),
                Some(auth.user_id),
                "drug_product",
                Some(product_id),
                serde_json::json!({
                    "brand_name": row.try_get::<String, _>("brand_name").unwrap_or_default(),
                    "country_code": row.try_get::<String, _>("country_code").unwrap_or_default(),
                    "verification_status": row.try_get::<String, _>("verification_status").unwrap_or(status),
                }),
            ));
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Drug product not found"),
        Err(error) => {
            tracing::error!(error = %error, product_id = %product_id, "verify drug product");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to verify drug product",
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

async fn get_patient_medication_equivalents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, medication_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<EquivalentQuery>,
) -> axum::response::Response {
    if let Err(resp) = require_patient_drug_access(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    match load_medication_german_equivalents(
        &state.db,
        patient_id,
        medication_id,
        query.include_candidates.unwrap_or(false),
    )
    .await
    {
        Ok(Some(payload)) => Json(payload).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Medication not found"),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, medication_id = %medication_id, "load patient medication equivalents");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication equivalents",
            )
        }
    }
}

async fn create_patient_medication_drug_match(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, medication_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateMedicationDrugMatch>,
) -> axum::response::Response {
    if let Err(resp) = require_patient_drug_access(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    if let Err(resp) = ensure_patient_medication(&state, patient_id, medication_id).await {
        return resp;
    }

    let confidence =
        Decimal::try_from(body.confidence.unwrap_or(0.70)).unwrap_or_else(|_| Decimal::new(70, 2));
    if confidence < Decimal::ZERO || confidence > Decimal::ONE {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Confidence must be between 0 and 1",
        );
    }

    match sqlx::query(
        r#"INSERT INTO medication_drug_matches (
                patient_medication_id, drug_product_id, match_kind, confidence,
                verification_status, note, created_by
           ) VALUES ($1, $2, 'staff_candidate', $3, 'candidate', $4, $5)
           ON CONFLICT (patient_medication_id, drug_product_id)
               WHERE patient_medication_id IS NOT NULL
           DO UPDATE SET confidence = EXCLUDED.confidence,
                         note = EXCLUDED.note,
                         updated_at = now()
           RETURNING id, verification_status, confidence"#,
    )
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
                "patient",
                Some(patient_id),
                serde_json::json!({
                    "patient_medication_id": medication_id,
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
            tracing::error!(error = %error, patient_id = %patient_id, medication_id = %medication_id, "create patient medication drug match");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create medication match",
            )
        }
    }
}

async fn verify_patient_medication_drug_match(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, medication_id, match_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<VerifyRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    if let Err(resp) = ensure_patient_medication(&state, patient_id, medication_id).await {
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
           SET verification_status = $3,
               match_kind = CASE WHEN $3 = 'verified' THEN 'staff_verified' ELSE match_kind END,
               note = COALESCE($4, note),
               verified_by = CASE WHEN $3 = 'verified' THEN $5 ELSE verified_by END,
               verified_at = CASE WHEN $3 = 'verified' THEN now() ELSE verified_at END,
               updated_at = now()
           WHERE id = $1
             AND patient_medication_id = $2
           RETURNING drug_product_id"#,
    )
    .bind(match_id)
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
                "patient",
                Some(patient_id),
                serde_json::json!({
                    "patient_medication_id": medication_id,
                    "match_id": match_id,
                    "drug_product_id": row.try_get::<Uuid, _>("drug_product_id").unwrap_or_default(),
                    "verification_status": status,
                }),
            ));
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Medication match not found"),
        Err(error) => {
            tracing::error!(error = %error, match_id = %match_id, "verify patient medication drug match");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to verify medication match",
            )
        }
    }
}

async fn confirm_patient_medication_expiry(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, medication_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = require_patient_drug_access(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let confirmed = match sqlx::query(
        r#"UPDATE medication_expiry_events
           SET status = 'confirmed',
               confirmed_at = now(),
               confirmed_by = $3
           WHERE patient_medication_id = $1
             AND patient_id = $2
             AND status = 'pending_confirmation'
           RETURNING id, expiry_date"#,
    )
    .bind(medication_id)
    .bind(patient_id)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(
                StatusCode::NOT_FOUND,
                "No pending medication expiry confirmation found",
            );
        }
        Err(error) => {
            tracing::error!(
                error = %error,
                patient_id = %patient_id,
                medication_id = %medication_id,
                "confirm patient medication expiry",
            );
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to confirm medication expiry",
            );
        }
    };

    let expiry_date = confirmed
        .try_get::<chrono::NaiveDate, _>("expiry_date")
        .map(|value| value.to_string())
        .unwrap_or_default();

    state.audit_sender.try_send(audit::domain_event(
        "confirm_medication_expiry".to_string(),
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        serde_json::json!({
            "patient_medication_id": medication_id,
            "expiry_date": expiry_date.clone(),
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.medication_expiry_confirmed",
        patient_id,
        serde_json::json!({
            "patient_medication_id": medication_id,
            "expiry_date": expiry_date,
        }),
    )
    .await;

    Json(serde_json::json!({ "ok": true })).into_response()
}

fn require_staff_drug_access(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::PatientManager, Role::TeamleadInterpreter, Role::Ceo])
}

fn require_patient_drug_access(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::PatientManager, Role::Ceo, Role::ItAdmin])
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role.has_full_access() {
        return Ok(());
    }
    if !access::requires_patient_assignment(auth.role) {
        return Ok(());
    }
    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, patient_id = %patient_id, "validate patient assignment");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            )
        })?;
    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn ensure_patient_medication(
    state: &AppState,
    patient_id: Uuid,
    medication_id: Uuid,
) -> Result<(), axum::response::Response> {
    let found = sqlx::query_scalar::<_, i32>(
        "SELECT 1 FROM patient_medications WHERE id = $1 AND patient_id = $2 AND superseded_at IS NULL",
    )
    .bind(medication_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, patient_id = %patient_id, medication_id = %medication_id, "load patient medication");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate medication",
        )
    })?;
    if found.is_some() {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Medication not found"))
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_country_code(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_uppercase())
        .filter(|value| value.len() == 2 && value.chars().all(|ch| ch.is_ascii_alphabetic()))
}

fn normalize_search_value(value: &str) -> String {
    value.trim().to_lowercase()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_country_code_accepts_two_letter_codes() {
        assert_eq!(normalize_country_code(Some(" de ")), Some("DE".to_string()));
        assert_eq!(normalize_country_code(Some("DEU")), None);
        assert_eq!(normalize_country_code(Some("")), None);
    }

    #[test]
    fn normalize_search_value_trims_and_lowercases() {
        assert_eq!(normalize_search_value("  Sortis "), "sortis");
    }
}
