//! Authenticator-app second factor. Enrolment is self-service under `/me`,
//! the login challenge is public, and CEO can reset a lost device.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::{middleware::AuthUser, tokens, totp};
use crate::state::AppState;
use gmed_domain::role::Role;

const CHALLENGE_TTL_MINUTES: i64 = 5;
const MAX_CHALLENGE_ATTEMPTS: i32 = 5;
const ISSUER: &str = "GMED Console";

pub fn public_router() -> Router<AppState> {
    Router::new().route("/auth/totp", post(complete_totp_login))
}

pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/me/totp", get(totp_status))
        .route("/me/totp/setup", post(start_enrolment))
        .route("/me/totp/confirm", post(confirm_enrolment))
        .route("/me/totp/disable", post(disable_totp))
        .route("/users/{user_id}/totp/reset", post(reset_user_totp))
}

#[derive(Deserialize)]
struct CodeRequest {
    code: String,
}

#[derive(Deserialize)]
struct ChallengeRequest {
    challenge_id: Uuid,
    code: String,
}

/// Roles that must carry a second factor, from `system_settings`.
pub async fn required_roles(state: &AppState) -> Vec<String> {
    sqlx::query_scalar::<_, Value>(
        "SELECT value FROM system_settings WHERE key = 'mfa_totp_required_roles'",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
    .unwrap_or_default()
}

pub async fn has_confirmed_totp(state: &AppState, user_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL)",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
}

/// Opens a challenge after the password matched; the caller answers it on
/// `/auth/totp`.
pub async fn open_challenge(
    state: &AppState,
    user_id: Uuid,
    ip: Option<&str>,
    user_agent: Option<&str>,
    device_info: Option<&Value>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO totp_login_challenges (user_id, ip_address, user_agent, device_info, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id"#,
    )
    .bind(user_id)
    .bind(ip)
    .bind(user_agent)
    .bind(device_info)
    .bind(Utc::now() + Duration::minutes(CHALLENGE_TTL_MINUTES))
    .fetch_one(&state.db)
    .await
}

async fn load_secret(
    state: &AppState,
    user_id: Uuid,
    confirmed_only: bool,
) -> Result<Option<(Vec<u8>, Option<i64>)>, String> {
    let row = sqlx::query(
        r#"SELECT secret_ciphertext, secret_nonce, secret_key_id, last_used_step
           FROM user_totp
           WHERE user_id = $1 AND ($2::bool = false OR confirmed_at IS NOT NULL)"#,
    )
    .bind(user_id)
    .bind(confirmed_only)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| format!("load totp secret: {e}"))?;
    let Some(row) = row else {
        return Ok(None);
    };
    let ciphertext: Vec<u8> = row.try_get("secret_ciphertext").unwrap_or_default();
    let nonce: Vec<u8> = row.try_get("secret_nonce").unwrap_or_default();
    let key_id: String = row.try_get("secret_key_id").unwrap_or_default();
    let last_used: Option<i64> = row.try_get("last_used_step").unwrap_or_default();
    let secret = state
        .message_keys
        .decrypt(&key_id, &ciphertext, &nonce)
        .map_err(|e| format!("open totp secret: {e}"))?;
    Ok(Some((secret, last_used)))
}

async fn record_used_step(state: &AppState, user_id: Uuid, step: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE user_totp SET last_used_step = GREATEST(COALESCE(last_used_step, 0), $2), updated_at = now() WHERE user_id = $1",
    )
    .bind(user_id)
    .bind(step)
    .execute(&state.db)
    .await
    .map(|_| ())
}

fn now_secs() -> u64 {
    u64::try_from(Utc::now().timestamp()).unwrap_or(0)
}

async fn totp_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    let enrolled = match has_confirmed_totp(&state, auth.user_id).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "totp status");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load status");
        }
    };
    let role = serde_json::to_value(auth.role)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();
    let required = required_roles(&state).await.iter().any(|r| r == &role);
    Json(json!({ "enrolled": enrolled, "required": required })).into_response()
}

async fn start_enrolment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if auth.role == Role::Patient {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    // A confirmed factor is replaced only after a code from the old device
    // (disable first); an unconfirmed attempt can simply start over.
    match has_confirmed_totp(&state, auth.user_id).await {
        Ok(true) => {
            return err(
                StatusCode::CONFLICT,
                "Two-factor authentication is already active",
            );
        }
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, "totp enrolment lookup");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to start enrolment",
            );
        }
    }

    let secret = totp::generate_secret();
    let (ciphertext, nonce, key_id) = match state.message_keys.encrypt(&secret) {
        Ok(sealed) => sealed,
        Err(e) => {
            tracing::error!(error = %e, "seal totp secret");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to start enrolment",
            );
        }
    };
    let email: String = match sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(auth.user_id)
        .fetch_one(&state.db)
        .await
    {
        Ok(email) => email,
        Err(e) => {
            tracing::error!(error = %e, "load user for totp enrolment");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to start enrolment",
            );
        }
    };
    if let Err(e) = sqlx::query(
        r#"INSERT INTO user_totp (user_id, secret_ciphertext, secret_nonce, secret_key_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE
           SET secret_ciphertext = EXCLUDED.secret_ciphertext,
               secret_nonce = EXCLUDED.secret_nonce,
               secret_key_id = EXCLUDED.secret_key_id,
               confirmed_at = NULL,
               last_used_step = NULL,
               updated_at = now()"#,
    )
    .bind(auth.user_id)
    .bind(&ciphertext)
    .bind(&nonce)
    .bind(&key_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, "store totp secret");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to start enrolment",
        );
    }

    Json(json!({
        "secret": totp::base32_encode(&secret),
        "otpauth_uri": totp::otpauth_uri(ISSUER, &email, &secret),
        "issuer": ISSUER,
        "account": email,
    }))
    .into_response()
}

async fn confirm_enrolment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CodeRequest>,
) -> axum::response::Response {
    let pending = match load_secret(&state, auth.user_id, false).await {
        Ok(Some(pending)) => pending,
        Ok(None) => return err(StatusCode::CONFLICT, "Start the enrolment first"),
        Err(e) => {
            tracing::error!(error = %e, "confirm totp");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to confirm enrolment",
            );
        }
    };
    let Some(step) = totp::verify(&pending.0, &body.code, now_secs(), pending.1) else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "The code does not match");
    };
    if let Err(e) = sqlx::query(
        "UPDATE user_totp SET confirmed_at = now(), last_used_step = $2, updated_at = now() WHERE user_id = $1",
    )
    .bind(auth.user_id)
    .bind(step)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, "confirm totp");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to confirm enrolment");
    }
    state.audit_sender.try_send(audit::domain_event(
        "totp_enrolled",
        Some(auth.user_id),
        "user",
        Some(auth.user_id),
        json!({}),
    ));
    Json(json!({ "enrolled": true })).into_response()
}

async fn disable_totp(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CodeRequest>,
) -> axum::response::Response {
    let current = match load_secret(&state, auth.user_id, true).await {
        Ok(Some(current)) => current,
        Ok(None) => {
            return err(
                StatusCode::CONFLICT,
                "Two-factor authentication is not active",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, "disable totp");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to disable");
        }
    };
    if totp::verify(&current.0, &body.code, now_secs(), current.1).is_none() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "The code does not match");
    }
    if let Err(e) = sqlx::query("DELETE FROM user_totp WHERE user_id = $1")
        .bind(auth.user_id)
        .execute(&state.db)
        .await
    {
        tracing::error!(error = %e, "disable totp");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to disable");
    }
    state.audit_sender.try_send(audit::domain_event(
        "totp_disabled",
        Some(auth.user_id),
        "user",
        Some(auth.user_id),
        json!({}),
    ));
    Json(json!({ "enrolled": false })).into_response()
}

/// Lost device: CEO removes the factor so the person can enrol again. Every
/// session of that user ends, since the account is briefly password-only.
async fn reset_user_totp(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo]) {
        return e;
    }
    let removed = sqlx::query("DELETE FROM user_totp WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await;
    match removed {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "No second factor enrolled"),
        Err(e) => {
            tracing::error!(error = %e, "reset totp");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to reset");
        }
    }
    tokens::revoke_all_families(&state.db, user_id, "totp_reset").await;
    state.audit_sender.try_send(audit::domain_event(
        "totp_reset",
        Some(auth.user_id),
        "user",
        Some(user_id),
        json!({ "sessions_revoked": true }),
    ));
    Json(json!({ "ok": true })).into_response()
}

async fn complete_totp_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChallengeRequest>,
) -> axum::response::Response {
    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string());
    let ip_hash = ip
        .as_deref()
        .and_then(|raw| state.audit_sender.hash_ip_from_str(raw));

    // Count the attempt first, so a wrong code is never free.
    let challenge = sqlx::query(
        r#"UPDATE totp_login_challenges
           SET attempts = attempts + 1
           WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
           RETURNING user_id, attempts, user_agent"#,
    )
    .bind(body.challenge_id)
    .fetch_optional(&state.db)
    .await;
    let challenge = match challenge {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "Sign in again"),
        Err(e) => {
            tracing::error!(error = %e, "load totp challenge");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            );
        }
    };
    let user_id: Uuid = challenge.try_get("user_id").unwrap_or_else(|_| Uuid::nil());
    let attempts: i32 = challenge.try_get("attempts").unwrap_or(0);
    let user_agent: Option<String> = challenge.try_get("user_agent").unwrap_or_default();
    if attempts > MAX_CHALLENGE_ATTEMPTS {
        state.audit_sender.try_send(audit::auth_event(
            "login_failure",
            Some(user_id),
            ip_hash,
            json!({ "reason": "totp_attempts_exhausted" }),
        ));
        return err(StatusCode::UNAUTHORIZED, "Sign in again");
    }

    let secret = match load_secret(&state, user_id, true).await {
        Ok(Some(secret)) => secret,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "Sign in again"),
        Err(e) => {
            tracing::error!(error = %e, "totp login");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            );
        }
    };
    let Some(step) = totp::verify(&secret.0, &body.code, now_secs(), secret.1) else {
        state.audit_sender.try_send(audit::auth_event(
            "login_failure",
            Some(user_id),
            ip_hash,
            json!({ "reason": "totp_mismatch", "attempt": attempts }),
        ));
        return err(StatusCode::UNAUTHORIZED, "The code does not match");
    };

    let consumed = sqlx::query(
        "UPDATE totp_login_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL",
    )
    .bind(body.challenge_id)
    .execute(&state.db)
    .await;
    match consumed {
        Ok(result) if result.rows_affected() == 1 => {}
        _ => return err(StatusCode::UNAUTHORIZED, "Sign in again"),
    }
    if let Err(e) = record_used_step(&state, user_id, step).await {
        tracing::error!(error = %e, "record totp step");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "An internal error occurred",
        );
    }

    let user = sqlx::query("SELECT role, is_active, password_changed_at FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await;
    let user = match user {
        Ok(Some(row)) if row.try_get::<bool, _>("is_active").unwrap_or(false) => row,
        Ok(_) => return err(StatusCode::FORBIDDEN, "Account is disabled"),
        Err(e) => {
            tracing::error!(error = %e, "load user for totp login");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            );
        }
    };
    let role: String = user.try_get("role").unwrap_or_default();
    let password_changed_at = user
        .try_get::<Option<chrono::DateTime<Utc>>, _>("password_changed_at")
        .unwrap_or_default();

    let settings = state.settings.get().await;
    let pair = match tokens::create_session(
        &state.db,
        state.jwt_secret(),
        user_id,
        &role,
        password_changed_at,
        None,
        ip.as_deref(),
        user_agent.as_deref(),
        &settings,
    )
    .await
    {
        Ok(pair) => pair,
        Err(e) => {
            tracing::error!(error = %e, "create session after totp");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            );
        }
    };

    state.audit_sender.try_send(audit::auth_event(
        "login_success",
        Some(user_id),
        ip_hash,
        json!({ "role": role, "second_factor": "totp" }),
    ));

    Json(json!({
        "access_token": pair.access_token,
        "refresh_token": pair.refresh_token,
        "token_type": "Bearer",
        "expires_in": pair.expires_in,
    }))
    .into_response()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message })),
    )
        .into_response()
}
