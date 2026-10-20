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
               AS login_emailed_at,
           (SELECT e.delivery_status FROM portal_login_emails e
             WHERE e.patient_id = p.id AND e.user_id = u.id AND e.status = 'sent'
             ORDER BY e.created_at DESC
             LIMIT 1)
               AS login_email_delivery
    FROM patient_assignments pa
    JOIN users u ON u.id = pa.user_id AND u.role = 'patient'
    WHERE pa.patient_id = p.id AND pa.revoked_at IS NULL AND pa.source <> 'lead_guardian'
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

    let mut login_user = patient.try_get::<Option<Uuid>, _>("user_id").ok().flatten();
    let mut login_active = patient
        .try_get::<Option<bool>, _>("login_active")
        .ok()
        .flatten()
        .unwrap_or(false);
    let mut login_email = patient
        .try_get::<Option<String>, _>("login_email")
        .ok()
        .flatten();
    // A former minor's own login of the converted request (owner decision
    // 2026-10-20): the login the child had as a lead becomes the patient's
    // login instead of a conflict over its e-mail.
    let mut linked_request_login = false;
    if login_user.is_none()
        && let Some(email) = normalize_portal_email(
            patient
                .try_get::<Option<String>, _>("email")
                .ok()
                .flatten()
                .as_deref(),
        )
    {
        match link_converted_request_login(&state, auth.user_id, patient_id, &email).await {
            Ok(Some(user_id)) => {
                login_user = Some(user_id);
                login_active = true;
                login_email = Some(email);
                linked_request_login = true;
            }
            Ok(None) => {}
            Err(response) => return response,
        }
    }

    // A linked login gets a new password.
    if let Some(user_id) = login_user {
        if !login_active {
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
            "email": login_email,
            "created": false,
            "linked_request_login": linked_request_login,
            "one_time_password": one_time_password,
        }))
        .into_response();
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
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, patient_id, "begin"),
    };
    let reused_user = match super::lead_portal_account::reusable_guardian_in_tx(
        &mut tx,
        &email,
        &name,
        patient
            .try_get::<Option<chrono::NaiveDate>, _>("birth_date")
            .ok()
            .flatten(),
        None,
        Some(patient_id),
    )
    .await
    {
        Ok(user_id) => user_id,
        Err(error) => return internal(error, patient_id, "check guardian identity"),
    };
    if let Some(user_id) = reused_user {
        if let Err(error) = sqlx::query(
            "INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT(patient_id,user_id) DO UPDATE SET revoked_at=NULL,source='manual'",
        ).bind(patient_id).bind(user_id).bind(auth.user_id).execute(&mut *tx).await {
            return internal(error,patient_id,"link existing guardian login");
        }
        if let Err(error) = super::lead_portal_account::link_guardian_relationships_in_tx(
            &mut tx,
            user_id,
            patient_id,
            auth.user_id,
        )
        .await
        {
            return internal(error, patient_id, "link guardian relationships");
        }
        if let Err(error) = audit::write_in_transaction(&mut tx,&audit::domain_event(
            "reuse_guardian_for_own_patient",Some(auth.user_id),"patient",Some(patient_id),
            json!({"portal_user_id":user_id,"password_changed":false,"child_access_preserved":true}),
        )).await { return internal(error,patient_id,"audit reuse"); }
        if let Err(error) = tx.commit().await {
            return internal(error, patient_id, "commit reuse");
        }
        return Json(
            json!({"user_id":user_id,"email":email,"created":false,"reused":true,
            "password_changed":false,"one_time_password":null}),
        )
        .into_response();
    }
    match email_owner(&mut *tx, &email, None).await {
        Ok(None) => {}
        Ok(Some(owner)) => return email_taken_response(owner),
        Err(error) => return internal(error, patient_id, "email owner"),
    }
    let one_time_password = password_policy::generate_one_time_password();
    let hash = match password::hash_password(&one_time_password) {
        Ok(hash) => hash,
        Err(error) => return internal(error, patient_id, "hash password"),
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

/// Links the own login of the patient's converted request
/// (`leads.portal_user_id`) to the patient record once the patient is of age
/// (owner decision 2026-10-20), as
/// [`crate::routes::lead_portal_account::link_to_patient_in_tx`] does for an
/// adult at the conversion: a minor's request kept that login closed, so the
/// conversion did not link it. Only an active login with the patient's
/// e-mail qualifies that was never a parent's or guardian's login and
/// reaches no other patient. The caller checked the age.
async fn link_converted_request_login(
    state: &AppState,
    actor: Uuid,
    patient_id: Uuid,
    email: &str,
) -> Result<Option<Uuid>, axum::response::Response> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| internal(error, patient_id, "begin request login"))?;
    let candidate = sqlx::query(
        r#"SELECT l.id AS lead_id, u.id AS user_id
           FROM leads l
           JOIN users u ON u.id = l.portal_user_id AND u.role = 'patient' AND u.is_active
           WHERE l.converted_patient_id = $1
             AND lower(btrim(u.email)) = $2
             AND NOT EXISTS (
                 SELECT 1 FROM lead_portal_access a
                 WHERE a.user_id = u.id AND a.kind = 'guardian'
             )
             AND NOT EXISTS (
                 SELECT 1 FROM patient_assignments pa
                 WHERE pa.user_id = u.id AND pa.patient_id <> $1 AND pa.revoked_at IS NULL
             )
           ORDER BY l.created_at DESC, l.id DESC
           LIMIT 1
           FOR UPDATE OF u"#,
    )
    .bind(patient_id)
    .bind(email)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| internal(error, patient_id, "find request login"))?;
    let Some(candidate) = candidate else {
        return Ok(None);
    };
    let lead_id: Uuid = candidate
        .try_get("lead_id")
        .map_err(|error| internal(error, patient_id, "decode request login"))?;
    let user_id: Uuid = candidate
        .try_get("user_id")
        .map_err(|error| internal(error, patient_id, "decode request login"))?;
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, revoked_by = NULL, manually_revoked_at = NULL,
                         revoked_reason = NULL, source = 'manual'"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(actor)
    .execute(&mut *tx)
    .await
    .map_err(|error| internal(error, patient_id, "link request login"))?;
    sqlx::query(
        "UPDATE consent_records SET patient_id = $2 WHERE lead_id = $1 AND patient_id IS NULL",
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| internal(error, patient_id, "link request consents"))?;
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "link_request_login_to_patient",
            Some(actor),
            "patient",
            Some(patient_id),
            json!({
                "portal_user_id": user_id,
                "lead_id": lead_id,
                "reason": "patient_of_age",
            }),
        ),
    )
    .await
    .map_err(|error| internal(error, patient_id, "audit request login"))?;
    tx.commit()
        .await
        .map_err(|error| internal(error, patient_id, "commit request login"))?;
    Ok(Some(user_id))
}
