//! The patient login in the patients table (owner request 2026-10-05: the
//! same expandable login row as the leads table, without the GwG sheet).
//!
//! `POST /patients/{id}/portal-account` creates the patient's login with a
//! generated password, or issues a new password for the linked login — the
//! same rules as for a lead's login: CEO and patient managers only, the
//! password is shown once and can be e-mailed from the dialog
//! ([`crate::routes::lead_portal_login_email`]), the address is unique and a
//! conflict names its owner, a minor gets no own login.
//!
//! A login a converted lead already had stays the patient's login
//! ([`crate::routes::lead_portal_account::link_to_patient_in_tx`]).

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::{password, password_policy};
use crate::mail::coded;
use crate::routes::lead_portal_account::{
    email_owner, email_taken_response, is_unique_violation, may_issue_portal_password,
    normalize_portal_email,
};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/patients/{patient_id}/portal-account",
        post(issue_patient_portal_access),
    )
}

fn internal(
    error: impl std::fmt::Display,
    patient_id: Uuid,
    what: &str,
) -> axum::response::Response {
    tracing::error!(%error, %patient_id, what, "patient portal access");
    coded(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Failed")
}

/// SQL fragment: the patient's current portal login (alias `p` for patients).
pub(crate) const PATIENT_PORTAL_LOGIN_SQL: &str = r#"
    SELECT u.id, u.email, u.is_active, u.password_reset_required, u.created_at,
           (SELECT max(tf.created_at) FROM token_families tf WHERE tf.user_id = u.id)
               AS last_login_at,
           (SELECT max(e.created_at) FROM portal_login_emails e
             WHERE e.patient_id = p.id AND e.user_id = u.id AND e.status = 'sent')
               AS login_emailed_at
    FROM patient_assignments pa
    JOIN users u ON u.id = pa.user_id AND u.role = 'patient'
    WHERE pa.patient_id = p.id AND pa.revoked_at IS NULL
    ORDER BY pa.assigned_at DESC
    LIMIT 1"#;

/// `POST /patients/{id}/portal-account`: creates the login or issues a new
/// password. Response: `{user_id, email, created, one_time_password}`.
async fn issue_patient_portal_access(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if !may_issue_portal_password(auth.role) {
        return coded(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Only the CEO or a patient manager can issue patient access",
        );
    }
    match crate::routes::patients::has_patient_edit_access(&state, &auth, patient_id).await {
        Ok(true) => {}
        Ok(false) => {
            return coded(
                StatusCode::FORBIDDEN,
                "forbidden",
                "Insufficient permissions",
            );
        }
        Err(response) => return response,
    }
    let patient = match sqlx::query(&format!(
        r#"SELECT p.first_name, p.last_name, p.email, p.birth_date, p.lifecycle_status,
                  login.id AS user_id, login.email AS login_email, login.is_active AS login_active
           FROM patients p
           LEFT JOIN LATERAL ({PATIENT_PORTAL_LOGIN_SQL}) login ON true
           WHERE p.id = $1"#
    ))
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return coded(
                StatusCode::NOT_FOUND,
                "patient_not_found",
                "Patient not found",
            );
        }
        Err(error) => return internal(error, patient_id, "load patient"),
    };
    if patient
        .try_get::<String, _>("lifecycle_status")
        .is_ok_and(|status| matches!(status.as_str(), "deleted" | "prospective"))
    {
        return coded(
            StatusCode::CONFLICT,
            "patient_not_active",
            "Patient access is issued for an active patient record",
        );
    }

    // A linked login gets a new password.
    if let Some(user_id) = patient.try_get::<Option<Uuid>, _>("user_id").ok().flatten() {
        if !patient
            .try_get::<Option<bool>, _>("login_active")
            .ok()
            .flatten()
            .unwrap_or(false)
        {
            return coded(
                StatusCode::CONFLICT,
                "login_inactive",
                "The patient account is deactivated",
            );
        }
        let one_time_password = password_policy::generate_one_time_password();
        match password_policy::replace_password(&state.db, user_id, &one_time_password, false).await
        {
            Ok(()) => {}
            Err(password_policy::PasswordChangeError::Rejected(message)) => {
                return coded(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "password_rejected",
                    message,
                );
            }
            Err(password_policy::PasswordChangeError::NotFound) => {
                return coded(
                    StatusCode::NOT_FOUND,
                    "login_not_found",
                    "Patient account not found",
                );
            }
            Err(password_policy::PasswordChangeError::Internal) => {
                return coded(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Failed");
            }
        }
        let _ = sqlx::query(
            "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
             WHERE user_id = $1 AND status IN ('pending', 'approved')",
        )
        .bind(user_id)
        .execute(&state.db)
        .await;
        crate::auth::tokens::revoke_all_families(&state.db, user_id, "password_reset").await;
        state.audit_sender.try_send(audit::domain_event(
            "reset_patient_portal_password",
            Some(auth.user_id),
            "patient",
            Some(patient_id),
            json!({ "portal_user_id": user_id, "sessions_revoked": true }),
        ));
        return Json(json!({
            "user_id": user_id,
            "email": patient.try_get::<Option<String>, _>("login_email").ok().flatten(),
            "created": false,
            "one_time_password": one_time_password,
        }))
        .into_response();
    }

    if crate::routes::leads::is_minor_on(
        patient
            .try_get::<Option<chrono::NaiveDate>, _>("birth_date")
            .ok()
            .flatten(),
        crate::app_time::today(),
    ) {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "patient_minor",
            "A minor gets no own login; the parents use their account",
        );
    }
    let Some(email) = normalize_portal_email(
        patient
            .try_get::<Option<String>, _>("email")
            .ok()
            .flatten()
            .as_deref(),
    ) else {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "patient_email_missing",
            "The patient needs a valid email before patient access can be issued",
        );
    };
    match email_owner(&state.db, &email, None).await {
        Ok(None) => {}
        Ok(Some(owner)) => return email_taken_response(owner),
        Err(error) => return internal(error, patient_id, "email owner"),
    }
    let name = format!(
        "{} {}",
        patient
            .try_get::<String, _>("first_name")
            .unwrap_or_default(),
        patient
            .try_get::<String, _>("last_name")
            .unwrap_or_default()
    )
    .trim()
    .to_string();
    let one_time_password = password_policy::generate_one_time_password();
    let hash = match password::hash_password(&one_time_password) {
        Ok(hash) => hash,
        Err(error) => return internal(error, patient_id, "hash password"),
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, patient_id, "begin"),
    };
    let user_id: Uuid = match sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role, is_active, password_reset_required)
           VALUES ($1, $2, $3, 'patient', true, false)
           RETURNING id"#,
    )
    .bind(&email)
    .bind(&hash)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(error) if is_unique_violation(&error) => {
            return match email_owner(&state.db, &email, None).await {
                Ok(Some(owner)) => email_taken_response(owner),
                _ => coded(
                    StatusCode::CONFLICT,
                    "portal_email_taken",
                    "Email already belongs to an account",
                ),
            };
        }
        Err(error) => return internal(error, patient_id, "create login"),
    };
    if let Err(error) = sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return internal(error, patient_id, "link login");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "create_patient_portal_account",
            Some(auth.user_id),
            "patient",
            Some(patient_id),
            json!({ "portal_user_id": user_id, "email": email }),
        ),
    )
    .await
    {
        return internal(error, patient_id, "audit");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, patient_id, "commit");
    }
    (
        StatusCode::CREATED,
        Json(json!({
            "user_id": user_id,
            "email": email,
            "created": true,
            "one_time_password": one_time_password,
        })),
    )
        .into_response()
}
