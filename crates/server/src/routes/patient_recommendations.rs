#![allow(clippy::result_large_err)]

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/recommendations", get(list_my_recommendations))
        .route(
            "/me/recommendations/{recommendation_id}/decision",
            post(create_my_recommendation_decision),
        )
        .route(
            "/me/recommendations/{recommendation_id}/appointment-request",
            post(create_my_recommendation_appointment_request),
        )
        .route(
            "/patients/{patient_id}/recommendations",
            get(list_patient_recommendations).post(create_patient_recommendation),
        )
        .route(
            "/patients/{patient_id}/recommendations/{recommendation_id}/update",
            post(update_patient_recommendation),
        )
        .route(
            "/patients/{patient_id}/recommendations/{recommendation_id}/delete",
            post(delete_patient_recommendation),
        )
}

#[derive(Deserialize)]
struct CreateRecommendationRequest {
    title: String,
    description: Option<String>,
    recommendation_type: Option<String>,
    source_doctor_id: Option<Uuid>,
    source_appointment_id: Option<Uuid>,
    source_document_id: Option<Uuid>,
    source_order_id: Option<Uuid>,
    due_at: Option<String>,
    priority: Option<String>,
    portal_visible: Option<bool>,
    recommended_on: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    reminder_lead_days: Option<i32>,
    reminder_at: Option<String>,
    lifecycle_status: Option<String>,
    outcome_note: Option<String>,
    outcome_at: Option<String>,
    note_intern: Option<String>,
}

#[derive(Deserialize)]
struct UpdateRecommendationRequest {
    title: Option<String>,
    description: Option<String>,
    recommendation_type: Option<String>,
    source_doctor_id: Option<Uuid>,
    source_appointment_id: Option<Uuid>,
    source_document_id: Option<Uuid>,
    source_order_id: Option<Uuid>,
    due_at: Option<String>,
    priority: Option<String>,
    status: Option<String>,
    portal_visible: Option<bool>,
    recommended_on: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    reminder_lead_days: Option<i32>,
    reminder_at: Option<String>,
    lifecycle_status: Option<String>,
    outcome_note: Option<String>,
    outcome_at: Option<String>,
    note_intern: Option<String>,
}

#[derive(Deserialize)]
struct RecommendationDecisionRequest {
    decision: String,
    note: Option<String>,
}

#[derive(Deserialize, Default)]
struct RecommendationAppointmentRequest {
    note: Option<String>,
}

async fn list_patient_recommendations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    // it_admin can open the clinical profile, which surfaces this read-only
    // panel; keep the read gate aligned with PATIENT_CLINICAL_ROLES.
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::ItAdmin]) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    match sqlx::query(&recommendation_select_sql("WHERE pr.patient_id = $1"))
        .bind(patient_id)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(recommendation_json)
                .collect::<Vec<serde_json::Value>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient recommendations");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load recommendations",
            )
        }
    }
}

async fn create_patient_recommendation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<CreateRecommendationRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }
    if let Err(resp) = ensure_patient_exists(&state, patient_id).await {
        return resp;
    }

    let title = match normalize_required_text(&body.title, "Recommendation title is required") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let recommendation_type =
        match normalize_recommendation_type(body.recommendation_type.as_deref()) {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let priority = match normalize_priority(body.priority.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let due_at = match parse_due_at(body.due_at) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let description = normalize_optional_text(body.description.as_deref());
    let portal_visible = body.portal_visible.unwrap_or(true);
    let lifecycle_status = match body.lifecycle_status.as_deref() {
        Some(value) => match normalize_lifecycle_status(value) {
            Ok(value) => value,
            Err(resp) => return resp,
        },
        None => "aktiv",
    };
    let recommended_on = match validate_optional_date(body.recommended_on.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let valid_from = match validate_optional_date(body.valid_from.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let valid_to = match validate_optional_date(body.valid_to.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let reminder_at = match validate_optional_date(body.reminder_at.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let outcome_at = match validate_optional_date(body.outcome_at.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let reminder_lead_days = match validate_lead_days(body.reminder_lead_days) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let outcome_note = normalize_optional_text(body.outcome_note.as_deref());
    let note_intern = normalize_optional_text(body.note_intern.as_deref());

    if let Err(resp) = validate_sources(
        &state,
        patient_id,
        body.source_doctor_id,
        body.source_appointment_id,
        body.source_document_id,
        body.source_order_id,
    )
    .await
    {
        return resp;
    }

    let recommendation_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_recommendations (
                patient_id, title, description, recommendation_type,
                source_doctor_id, source_appointment_id, source_document_id, source_order_id,
                due_at, priority, status, portal_visible,
                recommended_on, valid_from, valid_to, reminder_lead_days, reminder_at,
                lifecycle_status, outcome_note, outcome_at, note_intern,
                created_by, updated_by
           ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, 'active', $11,
                $12, $13, $14, $15, $16,
                $17, $18, $19, $20,
                $21, $21
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(&title)
    .bind(description.as_deref())
    .bind(&recommendation_type)
    .bind(body.source_doctor_id)
    .bind(body.source_appointment_id)
    .bind(body.source_document_id)
    .bind(body.source_order_id)
    .bind(due_at)
    .bind(&priority)
    .bind(portal_visible)
    .bind(recommended_on.as_deref())
    .bind(valid_from.as_deref())
    .bind(valid_to.as_deref())
    .bind(reminder_lead_days)
    .bind(reminder_at.as_deref())
    .bind(lifecycle_status)
    .bind(outcome_note.as_deref())
    .bind(outcome_at.as_deref())
    .bind(note_intern.as_deref())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "create recommendation");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create recommendation",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "recommendation_created",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "recommendation_id": recommendation_id,
            "recommendation_type": recommendation_type,
            "portal_visible": portal_visible,
        }),
    ));

    notify_patient_users(
        &state,
        patient_id,
        recommendation_id,
        "recommendation",
        "New recommendation",
        &title,
    )
    .await;

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "recommendation.created",
        patient_id,
        json!({
            "recommendation_id": recommendation_id,
            "portal_visible": portal_visible,
        }),
    )
    .await;

    match load_recommendation_row(&state, recommendation_id).await {
        Ok(Some(row)) => (StatusCode::CREATED, Json(recommendation_json(&row))).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Recommendation not found"),
        Err(resp) => resp,
    }
}

async fn update_patient_recommendation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, recommendation_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRecommendationRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let current = match load_recommendation_row(&state, recommendation_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Recommendation not found"),
        Err(resp) => return resp,
    };
    let current_patient_id = current
        .try_get::<Uuid, _>("patient_id")
        .unwrap_or_else(|_| Uuid::nil());
    if current_patient_id != patient_id {
        return err(StatusCode::NOT_FOUND, "Recommendation not found");
    }

    if let Err(resp) = validate_sources(
        &state,
        patient_id,
        body.source_doctor_id,
        body.source_appointment_id,
        body.source_document_id,
        body.source_order_id,
    )
    .await
    {
        return resp;
    }

    let title = match body.title.as_deref() {
        Some(value) => match normalize_required_text(value, "Recommendation title is required") {
            Ok(value) => Some(value),
            Err(resp) => return resp,
        },
        None => None,
    };
    let description = body
        .description
        .as_deref()
        .map(str::trim)
        .map(|value| value.to_string());
    let recommendation_type = match body.recommendation_type.as_deref() {
        Some(_) => match normalize_recommendation_type(body.recommendation_type.as_deref()) {
            Ok(value) => Some(value),
            Err(resp) => return resp,
        },
        None => None,
    };
    let priority = match body.priority.as_deref() {
        Some(_) => match normalize_priority(body.priority.as_deref()) {
            Ok(value) => Some(value),
            Err(resp) => return resp,
        },
        None => None,
    };
    let status = match body.status.as_deref() {
        Some(value) => match normalize_status(value) {
            Ok(value) => Some(value),
            Err(resp) => return resp,
        },
        None => None,
    };
    let lifecycle_status = match body.lifecycle_status.as_deref() {
        Some(value) => match normalize_lifecycle_status(value) {
            Ok(value) => Some(value),
            Err(resp) => return resp,
        },
        None => None,
    };
    let due_at = match body.due_at {
        Some(value) => match parse_due_at(Some(value)) {
            Ok(value) => value,
            Err(resp) => return resp,
        },
        None => None,
    };
    let recommended_on = match validate_optional_date(body.recommended_on.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let valid_from = match validate_optional_date(body.valid_from.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let valid_to = match validate_optional_date(body.valid_to.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let reminder_at = match validate_optional_date(body.reminder_at.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let outcome_at = match validate_optional_date(body.outcome_at.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let reminder_lead_days = match validate_lead_days(body.reminder_lead_days) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let outcome_note = normalize_optional_text(body.outcome_note.as_deref());
    let note_intern = normalize_optional_text(body.note_intern.as_deref());

    if let Err(e) = sqlx::query(
        r#"UPDATE patient_recommendations
           SET title = COALESCE($3, title),
               description = COALESCE($4, description),
               recommendation_type = COALESCE($5, recommendation_type),
               source_doctor_id = COALESCE($6, source_doctor_id),
               source_appointment_id = COALESCE($7, source_appointment_id),
               source_document_id = COALESCE($8, source_document_id),
               source_order_id = COALESCE($9, source_order_id),
               due_at = COALESCE($10, due_at),
               priority = COALESCE($11, priority),
               status = COALESCE($12, status),
               portal_visible = COALESCE($13, portal_visible),
               recommended_on = COALESCE($14, recommended_on),
               valid_from = COALESCE($15, valid_from),
               valid_to = COALESCE($16, valid_to),
               reminder_lead_days = COALESCE($17, reminder_lead_days),
               reminder_at = COALESCE($18, reminder_at),
               lifecycle_status = COALESCE($19, lifecycle_status),
               outcome_note = COALESCE($20, outcome_note),
               outcome_at = COALESCE($21, outcome_at),
               note_intern = COALESCE($22, note_intern),
               updated_by = $23
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(recommendation_id)
    .bind(patient_id)
    .bind(title.as_deref())
    .bind(description.as_deref())
    .bind(recommendation_type.as_deref())
    .bind(body.source_doctor_id)
    .bind(body.source_appointment_id)
    .bind(body.source_document_id)
    .bind(body.source_order_id)
    .bind(due_at)
    .bind(priority.as_deref())
    .bind(status)
    .bind(body.portal_visible)
    .bind(recommended_on.as_deref())
    .bind(valid_from.as_deref())
    .bind(valid_to.as_deref())
    .bind(reminder_lead_days)
    .bind(reminder_at.as_deref())
    .bind(lifecycle_status)
    .bind(outcome_note.as_deref())
    .bind(outcome_at.as_deref())
    .bind(note_intern.as_deref())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_id, recommendation_id = %recommendation_id, "update recommendation");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update recommendation",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "recommendation_updated",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({ "recommendation_id": recommendation_id }),
    ));

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "recommendation.updated",
        patient_id,
        json!({ "recommendation_id": recommendation_id }),
    )
    .await;

    match load_recommendation_row(&state, recommendation_id).await {
        Ok(Some(row)) => Json(recommendation_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Recommendation not found"),
        Err(resp) => resp,
    }
}

async fn delete_patient_recommendation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, recommendation_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let result = match sqlx::query(
        "DELETE FROM patient_recommendations WHERE id = $1 AND patient_id = $2",
    )
    .bind(recommendation_id)
    .bind(patient_id)
    .execute(&state.db)
    .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, recommendation_id = %recommendation_id, "delete recommendation");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete recommendation",
            );
        }
    };

    if result.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Recommendation not found");
    }

    state.audit_sender.try_send(audit::domain_event(
        "recommendation_deleted",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({ "recommendation_id": recommendation_id }),
    ));

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "recommendation.deleted",
        patient_id,
        json!({ "recommendation_id": recommendation_id }),
    )
    .await;

    StatusCode::NO_CONTENT.into_response()
}

async fn list_my_recommendations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(&recommendation_select_sql(
        "WHERE pr.patient_id = $1 AND pr.portal_visible = true",
    ))
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(recommendation_json)
                .collect::<Vec<serde_json::Value>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list my recommendations");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load recommendations",
            )
        }
    }
}

async fn create_my_recommendation_decision(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(recommendation_id): Path<Uuid>,
    Json(body): Json<RecommendationDecisionRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let decision = match normalize_patient_decision(&body.decision) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let note = normalize_optional_text(body.note.as_deref());

    let row = match load_portal_recommendation_row(&state, patient_id, recommendation_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Recommendation not found"),
        Err(resp) => return resp,
    };
    let current_status = row.try_get::<String, _>("status").unwrap_or_default();
    if !matches!(current_status.as_str(), "active" | "completed" | "declined") {
        return err(
            StatusCode::CONFLICT,
            "Recommendation is not available for patient decisions",
        );
    }

    let next_status = match decision {
        "already_done" => "completed",
        "declined" => "declined",
        _ => "active",
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO patient_recommendation_decisions (
                recommendation_id, patient_id, decided_by, decision, note
           ) VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(recommendation_id)
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(decision)
    .bind(note.as_deref())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, recommendation_id = %recommendation_id, "insert recommendation decision");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save recommendation decision",
        );
    }

    if let Err(e) = sqlx::query(
        r#"UPDATE patient_recommendations
           SET patient_decision = $2,
               decision_note = $3,
               decided_at = now(),
               status = $4,
               updated_by = $5
           WHERE id = $1 AND patient_id = $6"#,
    )
    .bind(recommendation_id)
    .bind(decision)
    .bind(note.as_deref())
    .bind(next_status)
    .bind(auth.user_id)
    .bind(patient_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, recommendation_id = %recommendation_id, "update recommendation decision");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update recommendation decision",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "recommendation_patient_decision",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "recommendation_id": recommendation_id,
            "decision": decision,
            "status": next_status,
        }),
    ));

    notify_assigned_staff(
        &state,
        patient_id,
        recommendation_id,
        "recommendation_decision",
        "Patient decision on recommendation",
        &format!("Patient selected {decision}."),
    )
    .await;

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "recommendation.patient_decision",
        patient_id,
        json!({
            "recommendation_id": recommendation_id,
            "decision": decision,
            "status": next_status,
        }),
    )
    .await;

    match load_recommendation_row(&state, recommendation_id).await {
        Ok(Some(row)) => Json(recommendation_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Recommendation not found"),
        Err(resp) => resp,
    }
}

async fn create_my_recommendation_appointment_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(recommendation_id): Path<Uuid>,
    Json(body): Json<RecommendationAppointmentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let row = match load_portal_recommendation_row(&state, patient_id, recommendation_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Recommendation not found"),
        Err(resp) => return resp,
    };
    if row
        .try_get::<Option<Uuid>, _>("appointment_request_id")
        .unwrap_or_default()
        .is_some()
    {
        return err(
            StatusCode::CONFLICT,
            "An appointment request already exists for this recommendation",
        );
    }

    let title = row.try_get::<String, _>("title").unwrap_or_default();
    let recommendation_type = row
        .try_get::<String, _>("recommendation_type")
        .unwrap_or_else(|_| "follow_up".to_string());
    let source_doctor_id = row
        .try_get::<Option<Uuid>, _>("source_doctor_id")
        .unwrap_or_default();
    let source_order_id = row
        .try_get::<Option<Uuid>, _>("source_order_id")
        .unwrap_or_default();
    let note = normalize_optional_text(body.note.as_deref());
    let request_reason = format!("Recommendation: {title}");
    let request_notes = note
        .as_deref()
        .map(|value| format!("Patient note: {value}"))
        .unwrap_or_else(|| "Created from patient portal recommendation action.".to_string());

    let request_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_appointment_requests (
                patient_id, requested_by, order_id, appointment_type, care_path_kind,
                requested_provider_id, requested_doctor_id, specialty, reason, notes
           ) VALUES (
                $1, $2, $3, 'medical', 'followup',
                (SELECT provider_id FROM provider_doctors WHERE id = $4),
                $4, $5, $6, $7
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(source_order_id)
    .bind(source_doctor_id)
    .bind(recommendation_type.replace('_', " "))
    .bind(&request_reason)
    .bind(&request_notes)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, recommendation_id = %recommendation_id, "create appointment request from recommendation");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create appointment request",
            );
        }
    };

    if let Err(e) = sqlx::query(
        r#"UPDATE patient_recommendations
           SET patient_decision = 'schedule',
               decision_note = COALESCE($3, decision_note),
               decided_at = now(),
               appointment_request_id = $2,
               updated_by = $4
           WHERE id = $1 AND patient_id = $5"#,
    )
    .bind(recommendation_id)
    .bind(request_id)
    .bind(note.as_deref())
    .bind(auth.user_id)
    .bind(patient_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, recommendation_id = %recommendation_id, request_id = %request_id, "link appointment request to recommendation");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to link appointment request",
        );
    }

    let _ = sqlx::query(
        r#"INSERT INTO patient_recommendation_decisions (
                recommendation_id, patient_id, decided_by, decision, note
           ) VALUES ($1, $2, $3, 'schedule', $4)"#,
    )
    .bind(recommendation_id)
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(note.as_deref())
    .execute(&state.db)
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "recommendation_appointment_requested",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "recommendation_id": recommendation_id,
            "appointment_request_id": request_id,
        }),
    ));

    notify_assigned_staff(
        &state,
        patient_id,
        recommendation_id,
        "recommendation_appointment_request",
        "Patient requested appointment",
        &format!("Appointment requested for recommendation: {title}"),
    )
    .await;

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "recommendation.appointment_requested",
        patient_id,
        json!({
            "recommendation_id": recommendation_id,
            "appointment_request_id": request_id,
        }),
    )
    .await;
    crate::realtime::publish_appointment_request_event(
        &state,
        Some(auth.user_id),
        "appointment_request.created",
        request_id,
        patient_id,
        Some(auth.user_id),
        json!({
            "source": "recommendation",
            "recommendation_id": recommendation_id,
        }),
    )
    .await;

    match load_recommendation_row(&state, recommendation_id).await {
        Ok(Some(row)) => Json(recommendation_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Recommendation not found"),
        Err(resp) => resp,
    }
}

async fn ensure_patient_exists(
    state: &AppState,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1 AND is_active = true)",
    )
    .bind(patient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "validate patient");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate patient",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Patient not found"))
    }
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo) {
        return Ok(());
    }

    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "validate recommendation access");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

async fn validate_sources(
    state: &AppState,
    patient_id: Uuid,
    source_doctor_id: Option<Uuid>,
    source_appointment_id: Option<Uuid>,
    source_document_id: Option<Uuid>,
    source_order_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    if let Some(order_id) = source_order_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1 AND patient_id = $2)",
        )
        .bind(order_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Source order does not belong to patient",
            ));
        }
    }

    if let Some(appointment_id) = source_appointment_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM appointments WHERE id = $1 AND patient_id = $2)",
        )
        .bind(appointment_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Source appointment does not belong to patient",
            ));
        }
    }

    if let Some(document_id) = source_document_id {
        let belongs = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE id = $1 AND patient_id = $2)",
        )
        .bind(document_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Source document does not belong to patient",
            ));
        }
    }

    if let Some(doctor_id) = source_doctor_id {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM provider_doctors WHERE id = $1)",
        )
        .bind(doctor_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !exists {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown doctor"));
        }
    }

    Ok(())
}

fn recommendation_select_sql(where_clause: &str) -> String {
    format!(
        r#"SELECT pr.id, pr.patient_id, pr.title, pr.description, pr.recommendation_type,
                  pr.source_doctor_id, pr.source_appointment_id, pr.source_document_id,
                  pr.source_order_id,
                  pr.due_at, pr.priority, pr.status, pr.portal_visible,
                  pr.recommended_on, pr.valid_from, pr.valid_to,
                  pr.reminder_lead_days, pr.reminder_at,
                  pr.lifecycle_status, pr.outcome_note, pr.outcome_at, pr.note_intern,
                  pr.patient_decision, pr.decision_note, pr.decided_at,
                  pr.appointment_request_id, pr.created_by, pr.updated_by,
                  pr.created_at, pr.updated_at,
                  doctor.name AS source_doctor_name,
                  creator.name AS created_by_name,
                  updater.name AS updated_by_name,
                  appointment.title AS source_appointment_title,
                  document.auto_name AS source_document_name,
                  source_order.order_number AS source_order_number,
                  request.status AS appointment_request_status
           FROM patient_recommendations pr
           LEFT JOIN provider_doctors doctor ON doctor.id = pr.source_doctor_id
           LEFT JOIN users creator ON creator.id = pr.created_by
           LEFT JOIN users updater ON updater.id = pr.updated_by
           LEFT JOIN appointments appointment ON appointment.id = pr.source_appointment_id
           LEFT JOIN documents document ON document.id = pr.source_document_id
           LEFT JOIN orders source_order ON source_order.id = pr.source_order_id
           LEFT JOIN patient_appointment_requests request ON request.id = pr.appointment_request_id
           {where_clause}
           ORDER BY CASE pr.status WHEN 'active' THEN 0 ELSE 1 END,
                    pr.due_at NULLS LAST,
                    pr.created_at DESC"#
    )
}

async fn load_recommendation_row(
    state: &AppState,
    recommendation_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(&recommendation_select_sql("WHERE pr.id = $1"))
        .bind(recommendation_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, recommendation_id = %recommendation_id, "load recommendation");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load recommendation",
            )
        })
}

async fn load_portal_recommendation_row(
    state: &AppState,
    patient_id: Uuid,
    recommendation_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(&recommendation_select_sql(
        "WHERE pr.id = $1 AND pr.patient_id = $2 AND pr.portal_visible = true",
    ))
    .bind(recommendation_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, recommendation_id = %recommendation_id, "load portal recommendation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load recommendation",
        )
    })
}

fn recommendation_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    json!({
        "recommendation_id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
        "recommendation_type": row.try_get::<String, _>("recommendation_type").unwrap_or_default(),
        "source_doctor_id": row.try_get::<Option<Uuid>, _>("source_doctor_id").unwrap_or_default(),
        "source_doctor_name": row.try_get::<Option<String>, _>("source_doctor_name").unwrap_or_default(),
        "source_appointment_id": row.try_get::<Option<Uuid>, _>("source_appointment_id").unwrap_or_default(),
        "source_appointment_title": row.try_get::<Option<String>, _>("source_appointment_title").unwrap_or_default(),
        "source_document_id": row.try_get::<Option<Uuid>, _>("source_document_id").unwrap_or_default(),
        "source_document_name": row.try_get::<Option<String>, _>("source_document_name").unwrap_or_default(),
        "source_order_id": row.try_get::<Option<Uuid>, _>("source_order_id").unwrap_or_default(),
        "source_order_number": row.try_get::<Option<String>, _>("source_order_number").unwrap_or_default(),
        "due_at": row.try_get::<Option<DateTime<Utc>>, _>("due_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "priority": row.try_get::<String, _>("priority").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "portal_visible": row.try_get::<bool, _>("portal_visible").unwrap_or(false),
        "recommended_on": row.try_get::<Option<String>, _>("recommended_on").unwrap_or_default(),
        "valid_from": row.try_get::<Option<String>, _>("valid_from").unwrap_or_default(),
        "valid_to": row.try_get::<Option<String>, _>("valid_to").unwrap_or_default(),
        "reminder_lead_days": row.try_get::<Option<i32>, _>("reminder_lead_days").unwrap_or_default(),
        "reminder_at": row.try_get::<Option<String>, _>("reminder_at").unwrap_or_default(),
        "lifecycle_status": match row.try_get::<String, _>("lifecycle_status").unwrap_or_default().as_str() {
            "erfolg" => "erfolg",
            "nicht_erfolgt" => "nicht_erfolgt",
            "unbekannt" => "unbekannt",
            _ => "aktiv",
        },
        "outcome_note": row.try_get::<Option<String>, _>("outcome_note").unwrap_or_default(),
        "outcome_at": row.try_get::<Option<String>, _>("outcome_at").unwrap_or_default(),
        "note_intern": row.try_get::<Option<String>, _>("note_intern").unwrap_or_default(),
        "patient_decision": row.try_get::<Option<String>, _>("patient_decision").unwrap_or_default(),
        "decision_note": row.try_get::<Option<String>, _>("decision_note").unwrap_or_default(),
        "decided_at": row.try_get::<Option<DateTime<Utc>>, _>("decided_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "appointment_request_id": row.try_get::<Option<Uuid>, _>("appointment_request_id").unwrap_or_default(),
        "appointment_request_status": row.try_get::<Option<String>, _>("appointment_request_status").unwrap_or_default(),
        "created_by": row.try_get::<Option<Uuid>, _>("created_by").unwrap_or_default(),
        "created_by_name": row.try_get::<Option<String>, _>("created_by_name").unwrap_or_default(),
        "updated_by": row.try_get::<Option<Uuid>, _>("updated_by").unwrap_or_default(),
        "updated_by_name": row.try_get::<Option<String>, _>("updated_by_name").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn normalize_required_text(value: &str, message: &str) -> Result<String, axum::response::Response> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(err(StatusCode::UNPROCESSABLE_ENTITY, message))
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Optional date field stored as TEXT: trims, treats empty as NULL, and rejects
/// anything that is not a plain `YYYY-MM-DD` calendar date.
fn validate_optional_date(value: Option<&str>) -> Result<Option<String>, axum::response::Response> {
    let Some(raw) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let bytes = raw.as_bytes();
    let well_formed = raw.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && raw
            .char_indices()
            .all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
        // Reject shape-valid but impossible calendar dates (e.g. 2025-13-99).
        && chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d").is_ok();
    if well_formed {
        Ok(Some(raw.to_string()))
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid date, expected YYYY-MM-DD",
        ))
    }
}

/// Reminder lead time in days must be a sane non-negative span.
fn validate_lead_days(value: Option<i32>) -> Result<Option<i32>, axum::response::Response> {
    match value {
        Some(v) if !(0..=365).contains(&v) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reminder_lead_days must be between 0 and 365",
        )),
        other => Ok(other),
    }
}

fn normalize_recommendation_type(value: Option<&str>) -> Result<String, axum::response::Response> {
    let normalized = value.unwrap_or("follow_up").trim().to_lowercase();
    if matches!(
        normalized.as_str(),
        "follow_up"
            | "consultation"
            | "lab_test"
            | "imaging"
            | "document"
            | "medication_review"
            | "other"
    ) {
        Ok(normalized)
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid recommendation type",
        ))
    }
}

fn normalize_priority(value: Option<&str>) -> Result<String, axum::response::Response> {
    let normalized = value.unwrap_or("normal").trim().to_lowercase();
    if matches!(normalized.as_str(), "low" | "normal" | "high" | "urgent") {
        Ok(normalized)
    } else {
        Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid priority"))
    }
}

fn normalize_status(value: &str) -> Result<&'static str, axum::response::Response> {
    match value.trim().to_lowercase().as_str() {
        "active" => Ok("active"),
        "completed" => Ok("completed"),
        "declined" => Ok("declined"),
        "cancelled" | "canceled" => Ok("cancelled"),
        "superseded" => Ok("superseded"),
        _ => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid recommendation status",
        )),
    }
}

fn normalize_lifecycle_status(value: &str) -> Result<&'static str, axum::response::Response> {
    match value.trim().to_lowercase().as_str() {
        "aktiv" => Ok("aktiv"),
        "erfolg" => Ok("erfolg"),
        "nicht_erfolgt" => Ok("nicht_erfolgt"),
        "unbekannt" => Ok("unbekannt"),
        _ => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid lifecycle status",
        )),
    }
}

fn normalize_patient_decision(value: &str) -> Result<&'static str, axum::response::Response> {
    match value.trim().to_lowercase().as_str() {
        "schedule" | "scheduled" | "appointment" => Ok("schedule"),
        "already_done" | "done" => Ok("already_done"),
        "need_consultation" | "consultation" => Ok("need_consultation"),
        "decline" | "declined" => Ok("declined"),
        _ => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Decision must be schedule, already_done, need_consultation or decline",
        )),
    }
}

fn parse_due_at(value: Option<String>) -> Result<Option<DateTime<Utc>>, axum::response::Response> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if let Ok(value) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(Some(value.with_timezone(&Utc)));
    }

    if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let Some(naive) = date.and_hms_opt(12, 0, 0) else {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid due_at"));
        };
        return Ok(Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)));
    }

    Err(err(
        StatusCode::UNPROCESSABLE_ENTITY,
        "Invalid due_at (use RFC3339 or YYYY-MM-DD)",
    ))
}

async fn notify_patient_users(
    state: &AppState,
    patient_id: Uuid,
    recommendation_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
    if let Ok(rows) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT pa.user_id, $2, $3, $4, 'recommendation', $5
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = 'patient'
           RETURNING id, user_id"#,
    )
    .bind(patient_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(recommendation_id)
    .fetch_all(&state.db)
    .await
    {
        publish_notification_rows(state, rows).await;
    }
}

async fn notify_assigned_staff(
    state: &AppState,
    patient_id: Uuid,
    recommendation_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
    if let Ok(rows) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT pa.user_id, $2, $3, $4, 'recommendation', $5
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role IN ('patient_manager', 'ceo')
           RETURNING id, user_id"#,
    )
    .bind(patient_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(recommendation_id)
    .fetch_all(&state.db)
    .await
    {
        publish_notification_rows(state, rows).await;
    }
}

async fn publish_notification_rows(state: &AppState, rows: Vec<sqlx::postgres::PgRow>) {
    for row in rows {
        let notification_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
        let user_id = row
            .try_get::<Uuid, _>("user_id")
            .unwrap_or_else(|_| Uuid::nil());
        if notification_id != Uuid::nil() && user_id != Uuid::nil() {
            crate::realtime::publish_notification_event(
                state,
                user_id,
                "notification.created",
                Some(notification_id),
                json!({
                    "entity_type": "recommendation",
                }),
            )
            .await;
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error").to_lowercase(),
            "message": message,
        })),
    )
        .into_response()
}

/// How often the reminder scheduler scans for due Empfehlungen reminders.
/// Hourly, matching the cadence of the other background schedulers
/// (e.g. invoices::spawn_auto_dunning_scheduler). Reminders operate on
/// day-granularity dates, so a sub-hour cadence would add noise without
/// firing anything sooner.
const RECOMMENDATION_REMINDER_CHECK_INTERVAL_SECS: u64 = 60 * 60;

/// Notify a single staff user directly by `user_id`, reusing the exact
/// `user_notifications` insert + realtime publish path used elsewhere in
/// this module. Used for the recommendation's `created_by` author (a
/// `users(id)`); guarded so an inactive/non-staff/deleted account simply
/// inserts nothing rather than erroring.
async fn notify_staff_user(
    state: &AppState,
    user_id: Uuid,
    recommendation_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
    if let Ok(rows) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT u.id, $2, $3, $4, 'recommendation', $5
           FROM users u
           WHERE u.id = $1
             AND u.is_active = true
             AND u.role <> 'patient'
           RETURNING id, user_id"#,
    )
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(recommendation_id)
    .fetch_all(&state.db)
    .await
    {
        publish_notification_rows(state, rows).await;
    }
}

/// One pass of the reminder scheduler: deliver every due, not-yet-sent
/// reminder exactly once. Returns the number of reminders delivered.
///
/// A reminder is due when the recommendation is still `aktiv`, has not been
/// sent yet (`reminder_sent_at IS NULL`), and either its explicit
/// `reminder_at` date has arrived or its `valid_to` is within
/// `reminder_lead_days` of today. Each row is processed independently and a
/// per-row failure is logged without aborting the rest of the batch.
async fn run_recommendation_reminder_scheduler_once(state: &AppState) -> i64 {
    let due = match sqlx::query(
        r#"SELECT id, patient_id, title, created_by, source_doctor_id
           FROM patient_recommendations
           WHERE lifecycle_status = 'aktiv' AND reminder_sent_at IS NULL
             AND (
               (reminder_at IS NOT NULL AND reminder_at <= to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD'))
               OR (valid_to IS NOT NULL AND reminder_lead_days IS NOT NULL
                   AND (valid_to::date - reminder_lead_days) <= (now() AT TIME ZONE 'utc')::date)
             )"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "Recommendation reminder scheduler query failed");
            return 0;
        }
    };

    let mut delivered = 0_i64;
    for row in due {
        let id = match row.try_get::<Uuid, _>("id") {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(error = %error, "Skipping recommendation reminder with unreadable id");
                continue;
            }
        };
        let patient_id = match row.try_get::<Uuid, _>("patient_id") {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    recommendation_id = %id,
                    "Skipping recommendation reminder with unreadable patient_id"
                );
                continue;
            }
        };
        let title: String = row.try_get("title").unwrap_or_default();
        let created_by: Option<Uuid> = row.try_get("created_by").ok().flatten();

        let reminder_title = "Erinnerung an Empfehlung";
        let reminder_body = format!("Erinnerung: {title}");

        // (a) Patient side — the patient's linked portal users.
        notify_patient_users(
            state,
            patient_id,
            id,
            "recommendation_reminder",
            reminder_title,
            &reminder_body,
        )
        .await;

        // (b) Staff side — the author (created_by) directly, plus the
        //     patient's assigned managers/CEO. source_doctor_id references
        //     provider_doctors, which has no linked login account, so there
        //     is no staff user to resolve from it.
        if let Some(author) = created_by {
            notify_staff_user(
                state,
                author,
                id,
                "recommendation_reminder",
                reminder_title,
                &reminder_body,
            )
            .await;
        }
        notify_assigned_staff(
            state,
            patient_id,
            id,
            "recommendation_reminder",
            reminder_title,
            &reminder_body,
        )
        .await;

        // Stamp so this reminder never re-fires on the next tick.
        match sqlx::query(
            "UPDATE patient_recommendations SET reminder_sent_at = now() WHERE id = $1",
        )
        .bind(id)
        .execute(&state.db)
        .await
        {
            Ok(_) => delivered += 1,
            Err(error) => {
                tracing::error!(
                    error = %error,
                    recommendation_id = %id,
                    "Failed to mark recommendation reminder as sent"
                );
            }
        }
    }

    delivered
}

/// Spawns the background scheduler that delivers Empfehlungen reminders.
/// Fail-safe by construction: a query or row error is logged and the loop
/// keeps running, so one bad tick never silences future reminders.
pub fn spawn_recommendation_reminder_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            RECOMMENDATION_REMINDER_CHECK_INTERVAL_SECS,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            let delivered = run_recommendation_reminder_scheduler_once(&state).await;
            if delivered > 0 {
                tracing::info!(
                    delivered,
                    "Recommendation reminder scheduler delivered reminders"
                );
            }
        }
    });
}
