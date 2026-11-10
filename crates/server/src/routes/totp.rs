//! Authenticator-app second factor. Enrolment is self-service under `/me`,
//! the login challenge is public, and CEO can reset a lost device.

use std::net::SocketAddr;

use axum::{
    Json, Router,
    extract::{ConnectInfo, Extension, Path, State},
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
use crate::auth::{login_throttle, middleware::AuthUser, tokens, totp};
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

/// One authenticator-code attempt, counted per account before the code is
/// checked, so parallel guesses cannot outrun the limit.
enum CodeAttempt {
    /// The code may be checked; `count` attempts since the last matching code.
    Allowed { count: i32, lock_level: i32 },
    /// Too many wrong codes: the account is locked (`users.locked_until`).
    Locked,
}

/// Whether the `count`-th wrong code in a row locks the account
/// (`max_failed_login_attempts`, the limit of the password step).
fn code_attempts_exhausted(count: i32, max_attempts: i32) -> bool {
    count >= max_attempts.max(1)
}

/// Minutes the account stays locked after wrong codes: the configured lockout,
/// doubled with every further lock until a sign-in completes (at most a day).
fn code_lock_minutes(lockout_minutes: i64, previous_lock_level: i32) -> i64 {
    login_throttle::lock_minutes(lockout_minutes, previous_lock_level.saturating_add(1))
}

async fn lock_account_after_codes(
    state: &AppState,
    user_id: Uuid,
    lock_level: i32,
    lockout_minutes: i64,
) -> Result<chrono::DateTime<Utc>, sqlx::Error> {
    let until = Utc::now() + Duration::minutes(code_lock_minutes(lockout_minutes, lock_level));
    sqlx::query(
        "UPDATE users
         SET totp_failed_attempts = 0,
             totp_lock_level = $2,
             locked_until = GREATEST(COALESCE(locked_until, $3), $3)
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(lock_level.saturating_add(1))
    .bind(until)
    .execute(&state.db)
    .await?;
    tracing::warn!(user_id = %user_id, locked_until = %until, "Account locked after wrong authenticator codes");
    Ok(until)
}

/// Counts the attempt for the account and refuses it while the account is
/// locked or the limit is already used up.
async fn begin_code_attempt(
    state: &AppState,
    user_id: Uuid,
    max_attempts: i32,
    lockout_minutes: i64,
) -> Result<CodeAttempt, sqlx::Error> {
    let row = sqlx::query(
        "UPDATE users SET totp_failed_attempts = totp_failed_attempts + 1
         WHERE id = $1 AND (locked_until IS NULL OR locked_until <= now())
         RETURNING totp_failed_attempts, totp_lock_level",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else {
        return Ok(CodeAttempt::Locked);
    };
    let count: i32 = row.try_get("totp_failed_attempts").unwrap_or(i32::MAX);
    let lock_level: i32 = row.try_get("totp_lock_level").unwrap_or(0);
    if count > max_attempts.max(1) {
        lock_account_after_codes(state, user_id, lock_level, lockout_minutes).await?;
        return Ok(CodeAttempt::Locked);
    }
    Ok(CodeAttempt::Allowed { count, lock_level })
}

/// A wrong code: shown in the account's failed sign-ins and, at the limit,
/// locking the account. Returns the end of a lock this mismatch started.
async fn record_code_mismatch(
    state: &AppState,
    user_id: Uuid,
    count: i32,
    lock_level: i32,
    max_attempts: i32,
    lockout_minutes: i64,
) -> Option<chrono::DateTime<Utc>> {
    if let Err(e) = sqlx::query(
        "UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1",
    )
    .bind(user_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, "count wrong authenticator code");
    }
    if !code_attempts_exhausted(count, max_attempts) {
        return None;
    }
    match lock_account_after_codes(state, user_id, lock_level, lockout_minutes).await {
        Ok(until) => Some(until),
        Err(e) => {
            tracing::error!(error = %e, "lock account after wrong authenticator codes");
            None
        }
    }
}

/// The code matched: every failure count and lock of the account starts over.
async fn clear_code_attempts(state: &AppState, user_id: Uuid) {
    if let Err(e) = sqlx::query(
        "UPDATE users
         SET failed_login_attempts = 0, locked_until = NULL,
             totp_failed_attempts = 0, totp_lock_level = 0
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&state.db)
    .await
    {
        tracing::warn!(error = %e, "reset sign-in failure counts");
    }
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
    let required =
        crate::auth::mfa_policy::role_requires_totp(&role, &required_roles(&state).await);
    Json(json!({ "enrolled": enrolled, "required": required })).into_response()
}

async fn start_enrolment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    // A patient sets up the own second factor like staff do (owner decision
    // 2026-10-19: password change and 2FA stay for patients). A login that
    // reaches only a request (lead cabinet) keeps profile and language: its
    // account page offers no second factor (owner decision 2026-10-05).
    if auth.role == Role::Patient {
        match super::lead_portal_intake::is_lead_only_login(&state.db, auth.user_id).await {
            Ok(false) => {}
            Ok(true) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
            Err(e) => {
                tracing::error!(error = %e, "totp enrolment portal mode");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to start enrolment",
                );
            }
        }
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
    // Sessions opened before the factor existed end; the current one stays and
    // is refreshed by the client, which lifts an enrolment-only confinement.
    let other_sessions_ended =
        tokens::revoke_other_families(&state.db, auth.user_id, auth.family_id, "totp_enrolled")
            .await;
    state.audit_sender.try_send(audit::domain_event(
        "totp_enrolled",
        Some(auth.user_id),
        "user",
        Some(auth.user_id),
        json!({ "other_sessions_ended": other_sessions_ended }),
    ));
    Json(json!({
        "enrolled": true,
        "session_refresh_required": true,
        "other_sessions_ended": other_sessions_ended,
    }))
    .into_response()
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
    // Wrong codes count per account, like at sign-in: a stolen session must
    // not guess its way to removing the second factor.
    let (max_attempts, lockout_minutes) = super::auth::login_lockout_settings(&state).await;
    let (count, lock_level) =
        match begin_code_attempt(&state, auth.user_id, max_attempts, lockout_minutes).await {
            Ok(CodeAttempt::Allowed { count, lock_level }) => (count, lock_level),
            Ok(CodeAttempt::Locked) => {
                state.audit_sender.try_send(audit::domain_event(
                    "totp_disable_blocked",
                    Some(auth.user_id),
                    "user",
                    Some(auth.user_id),
                    json!({ "reason": "too_many_wrong_codes" }),
                ));
                return err(
                    StatusCode::TOO_MANY_REQUESTS,
                    "Too many wrong codes. Try again later",
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "disable totp");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to disable");
            }
        };
    if totp::verify(&current.0, &body.code, now_secs(), current.1).is_none() {
        let locked_until = record_code_mismatch(
            &state,
            auth.user_id,
            count,
            lock_level,
            max_attempts,
            lockout_minutes,
        )
        .await;
        state.audit_sender.try_send(audit::domain_event(
            "totp_disable_failed",
            Some(auth.user_id),
            "user",
            Some(auth.user_id),
            json!({ "reason": "totp_mismatch", "attempt": count, "locked_until": locked_until }),
        ));
        return err(StatusCode::UNPROCESSABLE_ENTITY, "The code does not match");
    }
    clear_code_attempts(&state, auth.user_id).await;
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

/// Lost device: a user administrator removes the factor so the person can
/// enrol again (a CEO account only by the CEO). Every session of that user
/// ends, since the account is briefly password-only.
async fn reset_user_totp(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = super::users::ensure_can_manage_target(&state, &auth, user_id).await {
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
    // The wrong-code counts belonged to the removed factor.
    if let Err(e) =
        sqlx::query("UPDATE users SET totp_failed_attempts = 0, totp_lock_level = 0 WHERE id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
    {
        tracing::warn!(error = %e, "reset wrong-code counts");
    }
    let target_role = super::users::account_role(&state, user_id).await;
    tokens::revoke_all_families(&state.db, user_id, "totp_reset").await;
    state.audit_sender.try_send(audit::domain_event(
        "totp_reset",
        Some(auth.user_id),
        "user",
        Some(user_id),
        json!({
            "sessions_revoked": true,
            "ceo_notified": super::users::account_change_needs_ceo_notice(&auth, &target_role),
        }),
    ));
    super::users::notify_ceos_of_account_change(&state, &auth, user_id, &target_role, "totp_reset")
        .await;
    Json(json!({ "ok": true })).into_response()
}

async fn complete_totp_login(
    State(state): State<AppState>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<ChallengeRequest>,
) -> axum::response::Response {
    let ip = super::auth::request_ip(&headers, peer);
    let ip_hash = ip
        .as_deref()
        .and_then(|raw| state.audit_sender.hash_ip_from_str(raw));

    // Count the attempt first, so a wrong code is never free.
    let challenge = sqlx::query(
        r#"UPDATE totp_login_challenges
           SET attempts = attempts + 1
           WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
           RETURNING user_id, attempts, user_agent, device_info"#,
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
    let device_info: Option<Value> = challenge.try_get("device_info").unwrap_or_default();
    if attempts > MAX_CHALLENGE_ATTEMPTS {
        state.audit_sender.try_send(audit::auth_event(
            "login_failure",
            Some(user_id),
            ip_hash,
            json!({ "reason": "totp_attempts_exhausted" }),
        ));
        return err(StatusCode::UNAUTHORIZED, "Sign in again");
    }

    // Wrong codes count per account and address across challenges, with the
    // limits of the password step: a new challenge (the password is known)
    // buys no fresh guesses.
    let (max_attempts, lockout_minutes) = super::auth::login_lockout_settings(&state).await;
    let email = match sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(email)) => email,
        Ok(None) => return err(StatusCode::UNAUTHORIZED, "Sign in again"),
        Err(e) => {
            tracing::error!(error = %e, "load user for totp login");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            );
        }
    };
    let subject = login_throttle::subject_hash(&email);
    let ip_hash_value = ip_hash.clone().unwrap_or_default();
    let held = match login_throttle::is_held(&state.db, &subject, &ip_hash_value).await {
        Ok(held) => held,
        Err(e) => {
            tracing::error!(error = %e, "read the sign-in throttle");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            );
        }
    };
    let attempt = if held {
        Ok(CodeAttempt::Locked)
    } else {
        begin_code_attempt(&state, user_id, max_attempts, lockout_minutes).await
    };
    let (code_attempt, lock_level) = match attempt {
        Ok(CodeAttempt::Allowed { count, lock_level }) => (count, lock_level),
        Ok(CodeAttempt::Locked) => {
            state.audit_sender.try_send(audit::auth_event(
                "login_blocked",
                Some(user_id),
                ip_hash,
                json!({
                    "reason": if held { "throttled" } else { "account_locked" },
                    "step": "totp",
                }),
            ));
            return err(StatusCode::UNAUTHORIZED, "Sign in again");
        }
        Err(e) => {
            tracing::error!(error = %e, "count authenticator code attempt");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            );
        }
    };

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
        let locked_until = record_code_mismatch(
            &state,
            user_id,
            code_attempt,
            lock_level,
            max_attempts,
            lockout_minutes,
        )
        .await;
        if let Err(e) = login_throttle::record_failure(
            &state.db,
            &subject,
            &ip_hash_value,
            max_attempts,
            lockout_minutes,
        )
        .await
        {
            tracing::error!(error = %e, "record a wrong authenticator code");
        }
        state.audit_sender.try_send(audit::auth_event(
            if locked_until.is_some() {
                "login_blocked"
            } else {
                "login_failure"
            },
            Some(user_id),
            ip_hash,
            json!({
                "reason": if locked_until.is_some() { "totp_auto_locked" } else { "totp_mismatch" },
                "attempt": attempts,
                "failed_codes": code_attempt,
                "locked_until": locked_until,
            }),
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
    // Password and code both proved: the failure counts kept since the
    // password step start over.
    clear_code_attempts(&state, user_id).await;
    if let Err(e) = login_throttle::clear_pair(&state.db, &subject, &ip_hash_value).await {
        tracing::warn!(error = %e, "clear the sign-in throttle");
    }

    let user = sqlx::query(
        "SELECT role, is_active, mfa_required, password_changed_at FROM users WHERE id = $1",
    )
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

    // The authenticator code does not replace the per-user admin approval:
    // an account flagged `mfa_required` still waits for an administrator after
    // the code (TOM "Zusätzlich weiterhin Anmeldefreigabe durch Administrator
    // je Benutzer"; owner decision 2026-09-28, Q12).
    if user.try_get::<bool, _>("mfa_required").unwrap_or(false) {
        // Only this client gets the secret that redeems the approved login.
        let (poll_secret, poll_secret_hash) = tokens::generate_pending_poll_secret();
        return match sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO pending_logins (user_id, ip_address, user_agent, device_info, poll_secret_hash)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id"#,
        )
        .bind(user_id)
        .bind(ip.as_deref())
        .bind(user_agent.as_deref())
        .bind(device_info)
        .bind(poll_secret_hash)
        .fetch_one(&state.db)
        .await
        {
            Ok(pending_id) => {
                state.audit_sender.try_send(audit::auth_event(
                    "login_mfa_requested",
                    Some(user_id),
                    ip_hash,
                    json!({ "pending_id": pending_id, "second_factor": "totp" }),
                ));
                Json(json!({
                    "status": "mfa_pending",
                    "pending_id": pending_id,
                    "poll_secret": poll_secret,
                    "message": "Login requires admin approval"
                }))
                .into_response()
            }
            Err(e) => {
                tracing::error!(error = %e, "create pending login after totp");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "An internal error occurred",
                )
            }
        };
    }

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
        "password_change_required": pair.password_change_required,
        "totp_enrolment_required": pair.totp_enrolment_required,
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

#[cfg(test)]
mod tests {
    use super::{code_attempts_exhausted, code_lock_minutes};

    #[test]
    fn wrong_codes_lock_the_account_at_the_password_limit() {
        assert!(!code_attempts_exhausted(4, 5));
        assert!(code_attempts_exhausted(5, 5));
        assert!(code_attempts_exhausted(6, 5));
        // A limit of zero or less still allows one attempt.
        assert!(!code_attempts_exhausted(0, 0));
        assert!(code_attempts_exhausted(1, 0));
    }

    #[test]
    fn every_further_code_lock_lasts_longer() {
        assert_eq!(code_lock_minutes(30, 0), 30);
        assert_eq!(code_lock_minutes(30, 1), 60);
        assert_eq!(code_lock_minutes(30, 2), 120);
        assert_eq!(code_lock_minutes(30, 40), 24 * 60);
        assert_eq!(code_lock_minutes(30, i32::MAX), 24 * 60);
    }
}
