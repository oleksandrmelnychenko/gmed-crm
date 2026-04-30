use axum::{
    Json, Router,
    extract::{Extension, Path, State},
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
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/interpreters/{interpreter_id}/patient-history",
            get(get_interpreter_patient_history),
        )
        .route(
            "/patients/{patient_id}/interpreter-history",
            get(get_patient_interpreter_history),
        )
        .route(
            "/patients/{patient_id}/interpreter-preferences",
            post(set_interpreter_patient_preference),
        )
}

#[derive(Deserialize)]
struct SetInterpreterPatientPreference {
    interpreter_id: Uuid,
    preference: String,
    note: Option<String>,
}

async fn get_interpreter_patient_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = require_history_role(&auth) {
        return resp;
    }

    let assigned_filter = if auth.role == Role::PatientManager {
        Some(auth.user_id)
    } else {
        None
    };

    match sqlx::query(
        r#"WITH history AS (
                SELECT a.patient_id,
                       COUNT(*)::bigint AS appointment_count,
                       COUNT(*) FILTER (WHERE a.status = 'completed')::bigint AS completed_appointment_count,
                       COUNT(ir.id) FILTER (WHERE ir.approval_status = 'approved')::bigint AS approved_report_count,
                       COALESCE(SUM(ir.hours) FILTER (WHERE ir.approval_status = 'approved'), 0) AS total_report_hours,
                       MAX(a.date) AS last_appointment_date
                FROM appointments a
                LEFT JOIN interpreter_reports ir
                       ON ir.appointment_id = a.id
                      AND ir.interpreter_id = $1
                WHERE a.interpreter_id = $1
                  AND (
                        $2::uuid IS NULL
                        OR EXISTS (
                            SELECT 1
                            FROM patient_assignments pa
                            WHERE pa.patient_id = a.patient_id
                              AND pa.user_id = $2
                              AND pa.revoked_at IS NULL
                        )
                  )
                GROUP BY a.patient_id
           ),
           feedback AS (
                SELECT patient_id,
                       AVG(interpreter_score)::float8 AS average_feedback_score,
                       COUNT(*)::bigint AS feedback_count
                FROM patient_feedback_forms
                WHERE interpreter_id = $1
                  AND interpreter_score IS NOT NULL
                GROUP BY patient_id
           ),
           ids AS (
                SELECT patient_id FROM history
                UNION
                SELECT patient_id
                FROM interpreter_patient_preferences pref
                WHERE pref.interpreter_id = $1
                  AND (
                        $2::uuid IS NULL
                        OR EXISTS (
                            SELECT 1
                            FROM patient_assignments pa
                            WHERE pa.patient_id = pref.patient_id
                              AND pa.user_id = $2
                              AND pa.revoked_at IS NULL
                        )
                  )
           )
           SELECT p.id AS patient_id,
                  p.patient_id AS patient_code,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  COALESCE(pref.preference, 'neutral') AS preference,
                  pref.note AS preference_note,
                  COALESCE(history.appointment_count, 0)::bigint AS appointment_count,
                  COALESCE(history.completed_appointment_count, 0)::bigint AS completed_appointment_count,
                  COALESCE(history.approved_report_count, 0)::bigint AS approved_report_count,
                  COALESCE(history.total_report_hours, 0) AS total_report_hours,
                  feedback.average_feedback_score,
                  COALESCE(feedback.feedback_count, 0)::bigint AS feedback_count,
                  history.last_appointment_date
           FROM ids
           JOIN patients p ON p.id = ids.patient_id
           LEFT JOIN history ON history.patient_id = p.id
           LEFT JOIN feedback ON feedback.patient_id = p.id
           LEFT JOIN interpreter_patient_preferences pref
                  ON pref.patient_id = p.id
                 AND pref.interpreter_id = $1
           ORDER BY history.last_appointment_date DESC NULLS LAST, p.patient_id"#,
    )
    .bind(interpreter_id)
    .bind(assigned_filter)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    let total_hours = row
                        .try_get::<Decimal, _>("total_report_hours")
                        .unwrap_or(Decimal::ZERO);
                    serde_json::json!({
                        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
                        "patient_code": row.try_get::<String, _>("patient_code").unwrap_or_default(),
                        "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
                        "preference": row.try_get::<String, _>("preference").unwrap_or_else(|_| "neutral".to_string()),
                        "preference_note": row.try_get::<Option<String>, _>("preference_note").unwrap_or_default(),
                        "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
                        "completed_appointment_count": row.try_get::<i64, _>("completed_appointment_count").unwrap_or_default(),
                        "approved_report_count": row.try_get::<i64, _>("approved_report_count").unwrap_or_default(),
                        "total_report_hours": total_hours.round_dp(2).normalize().to_string(),
                        "average_feedback_score": row.try_get::<Option<f64>, _>("average_feedback_score").unwrap_or_default(),
                        "feedback_count": row.try_get::<i64, _>("feedback_count").unwrap_or_default(),
                        "last_appointment_date": row.try_get::<Option<chrono::NaiveDate>, _>("last_appointment_date").unwrap_or_default().map(|value| value.to_string()),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "load interpreter patient history");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter patient history",
            )
        }
    }
}

async fn get_patient_interpreter_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = require_history_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_scope(&state, &auth, patient_id).await {
        return resp;
    }

    match sqlx::query(
        r#"WITH history AS (
                SELECT a.interpreter_id,
                       COUNT(*)::bigint AS appointment_count,
                       COUNT(*) FILTER (WHERE a.status = 'completed')::bigint AS completed_appointment_count,
                       COUNT(ir.id) FILTER (WHERE ir.approval_status = 'approved')::bigint AS approved_report_count,
                       COALESCE(SUM(ir.hours) FILTER (WHERE ir.approval_status = 'approved'), 0) AS total_report_hours,
                       MAX(a.date) AS last_appointment_date
                FROM appointments a
                LEFT JOIN interpreter_reports ir
                       ON ir.appointment_id = a.id
                      AND ir.interpreter_id = a.interpreter_id
                WHERE a.patient_id = $1
                  AND a.interpreter_id IS NOT NULL
                GROUP BY a.interpreter_id
           ),
           feedback AS (
                SELECT interpreter_id,
                       AVG(interpreter_score)::float8 AS average_feedback_score,
                       COUNT(*)::bigint AS feedback_count
                FROM patient_feedback_forms
                WHERE patient_id = $1
                  AND interpreter_id IS NOT NULL
                  AND interpreter_score IS NOT NULL
                GROUP BY interpreter_id
           ),
           ids AS (
                SELECT interpreter_id FROM history
                UNION
                SELECT interpreter_id
                FROM interpreter_patient_preferences
                WHERE patient_id = $1
           )
           SELECT u.id AS interpreter_id,
                  u.name AS interpreter_name,
                  u.role,
                  COALESCE(pref.preference, 'neutral') AS preference,
                  pref.note AS preference_note,
                  COALESCE(history.appointment_count, 0)::bigint AS appointment_count,
                  COALESCE(history.completed_appointment_count, 0)::bigint AS completed_appointment_count,
                  COALESCE(history.approved_report_count, 0)::bigint AS approved_report_count,
                  COALESCE(history.total_report_hours, 0) AS total_report_hours,
                  feedback.average_feedback_score,
                  COALESCE(feedback.feedback_count, 0)::bigint AS feedback_count,
                  history.last_appointment_date
           FROM ids
           JOIN users u ON u.id = ids.interpreter_id
           LEFT JOIN history ON history.interpreter_id = u.id
           LEFT JOIN feedback ON feedback.interpreter_id = u.id
           LEFT JOIN interpreter_patient_preferences pref
                  ON pref.patient_id = $1
                 AND pref.interpreter_id = u.id
           ORDER BY history.last_appointment_date DESC NULLS LAST, u.name"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    let total_hours = row
                        .try_get::<Decimal, _>("total_report_hours")
                        .unwrap_or(Decimal::ZERO);
                    serde_json::json!({
                        "interpreter_id": row.try_get::<Uuid, _>("interpreter_id").unwrap_or_default(),
                        "interpreter_name": row.try_get::<String, _>("interpreter_name").unwrap_or_default(),
                        "role": row.try_get::<String, _>("role").unwrap_or_default(),
                        "preference": row.try_get::<String, _>("preference").unwrap_or_else(|_| "neutral".to_string()),
                        "preference_note": row.try_get::<Option<String>, _>("preference_note").unwrap_or_default(),
                        "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
                        "completed_appointment_count": row.try_get::<i64, _>("completed_appointment_count").unwrap_or_default(),
                        "approved_report_count": row.try_get::<i64, _>("approved_report_count").unwrap_or_default(),
                        "total_report_hours": total_hours.round_dp(2).normalize().to_string(),
                        "average_feedback_score": row.try_get::<Option<f64>, _>("average_feedback_score").unwrap_or_default(),
                        "feedback_count": row.try_get::<i64, _>("feedback_count").unwrap_or_default(),
                        "last_appointment_date": row.try_get::<Option<chrono::NaiveDate>, _>("last_appointment_date").unwrap_or_default().map(|value| value.to_string()),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "load patient interpreter history");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient interpreter history",
            )
        }
    }
}

async fn set_interpreter_patient_preference(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<SetInterpreterPatientPreference>,
) -> axum::response::Response {
    if let Err(resp) = require_history_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_scope(&state, &auth, patient_id).await {
        return resp;
    }
    if !matches!(body.preference.as_str(), "preferred" | "neutral" | "avoid") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid preference");
    }

    let interpreter_exists = match sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM users
                WHERE id = $1
                  AND is_active = true
                  AND role IN ('interpreter', 'teamlead_interpreter')
           )"#,
    )
    .bind(body.interpreter_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %body.interpreter_id, "validate preference interpreter");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate interpreter",
            );
        }
    };
    if !interpreter_exists {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Interpreter not found");
    }

    match sqlx::query(
        r#"INSERT INTO interpreter_patient_preferences (
                patient_id, interpreter_id, preference, note, updated_by
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (patient_id, interpreter_id)
           DO UPDATE SET preference = EXCLUDED.preference,
                         note = EXCLUDED.note,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = now()
           RETURNING id, preference, note, updated_at"#,
    )
    .bind(patient_id)
    .bind(body.interpreter_id)
    .bind(&body.preference)
    .bind(normalize_optional_text(body.note))
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let preference_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            state.audit_sender.try_send(audit::domain_event(
                "interpreter_preference_changed".to_string(),
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                serde_json::json!({
                    "interpreter_id": body.interpreter_id,
                    "preference": body.preference,
                }),
            ));
            Json(serde_json::json!({
                "id": preference_id,
                "patient_id": patient_id,
                "interpreter_id": body.interpreter_id,
                "preference": row.try_get::<String, _>("preference").unwrap_or_else(|_| "neutral".to_string()),
                "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
                "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            }))
            .into_response()
        }
        Err(error) => {
            tracing::error!(
                error = %error,
                patient_id = %patient_id,
                interpreter_id = %body.interpreter_id,
                "set interpreter patient preference",
            );
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter preference",
            )
        }
    }
}

fn require_history_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::PatientManager, Role::TeamleadInterpreter, Role::Ceo])
}

async fn ensure_patient_scope(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::TeamleadInterpreter) {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, patient_id = %patient_id, "validate patient scope");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate access")
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
