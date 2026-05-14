use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use serde_json::json;

use crate::audit;
use crate::auth::{blacklist, middleware::AuthUser, password, tokens};
use crate::business_metrics::LOGIN_ATTEMPTS_TOTAL;
use crate::state::AppState;

/// Hash an optional string-form IP through the current audit sender.
/// Used by the auth handlers to attach a pseudonymised peer IP to every
/// login / refresh audit event.
fn ip_hash_opt(state: &AppState, ip: Option<&str>) -> Option<String> {
    ip.and_then(|raw| state.audit_sender.hash_ip_from_str(raw))
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/pending/{pending_id}", get(check_pending))
}

pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/auth/logout", post(logout))
        .route("/auth/logout-all", post(logout_all))
        .route("/auth/sessions", get(list_sessions))
        .route("/auth/sessions/{family_id}/revoke", post(revoke_session))
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
    device_info: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RefreshRequest {
    refresh_token: String,
}

#[derive(Serialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    token_type: &'static str,
    expires_in: i64,
}

#[derive(Serialize)]
struct SessionInfo {
    family_id: Uuid,
    device_fingerprint: Option<String>,
    ip_address: Option<String>,
    user_agent: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    last_activity_at: chrono::DateTime<chrono::Utc>,
}

fn validate_login(req: &LoginRequest) -> Result<(), &'static str> {
    if req.email.is_empty() || req.email.len() > 320 || !req.email.contains('@') {
        return Err("Invalid email");
    }
    if req.password.is_empty() || req.password.len() > 256 {
        return Err("Invalid password");
    }
    Ok(())
}

fn validate_refresh(req: &RefreshRequest) -> Result<(), &'static str> {
    if req.refresh_token.is_empty() || req.refresh_token.len() > 256 {
        return Err("Invalid refresh token");
    }
    Ok(())
}

async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> impl IntoResponse {
    if let Err(msg) = validate_login(&body) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "validation_error", msg);
    }

    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string());

    let ip_whitelist_enabled = sqlx::query_scalar!(
        r#"SELECT value::TEXT AS "v!" FROM system_settings WHERE key = 'ip_whitelist_enabled'"#
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default()
        == "true";

    if ip_whitelist_enabled {
        let client_ip = ip.as_deref().unwrap_or("0.0.0.0");
        let allowed = sqlx::query(
            r#"SELECT EXISTS(
                    SELECT 1
                    FROM ip_whitelist
                    WHERE is_active = true
                      AND $1::inet <<= cidr::inet
                ) AS allowed"#,
        )
        .bind(client_ip)
        .fetch_one(&state.db)
        .await
        .ok()
        .and_then(|row| row.try_get::<bool, _>("allowed").ok())
        .unwrap_or(false);

        if !allowed {
            tracing::warn!(ip = client_ip, "Login blocked by IP whitelist");
            state.audit_sender.try_send(audit::auth_event(
                "login_blocked",
                None,
                ip_hash_opt(&state, ip.as_deref()),
                json!({ "reason": "ip_whitelist" }),
            ));
            metrics::counter!(
                LOGIN_ATTEMPTS_TOTAL,
                "outcome" => "blocked",
                "reason" => "ip_whitelist",
            )
            .increment(1);
            return err(
                StatusCode::FORBIDDEN,
                "ip_blocked",
                "Access denied from this IP address",
            );
        }
    }

    let user = match sqlx::query!(
        "SELECT id, password_hash, role, is_active, mfa_required, failed_login_attempts, locked_until FROM users WHERE email = $1",
        body.email
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(u) => u,
        Err(e) => {
            tracing::error!(error = %e, "DB error during login");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "An internal error occurred",
            );
        }
    };

    let user = match user {
        Some(u) => u,
        None => {
            let _ = password::hash_password("dummy-for-timing");
            state.audit_sender.try_send(audit::auth_event(
                "login_failure",
                None,
                ip_hash_opt(&state, ip.as_deref()),
                json!({ "reason": "unknown_email" }),
            ));
            metrics::counter!(
                LOGIN_ATTEMPTS_TOTAL,
                "outcome" => "failure",
                "reason" => "unknown_email",
            )
            .increment(1);
            return err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Invalid email or password",
            );
        }
    };

    if !user.is_active {
        state.audit_sender.try_send(audit::auth_event(
            "login_blocked",
            Some(user.id),
            ip_hash_opt(&state, ip.as_deref()),
            json!({ "reason": "account_inactive" }),
        ));
        metrics::counter!(
            LOGIN_ATTEMPTS_TOTAL,
            "outcome" => "blocked",
            "reason" => "account_inactive",
        )
        .increment(1);
        return err(StatusCode::FORBIDDEN, "forbidden", "Account is deactivated");
    }

    if let Some(locked_until) = user.locked_until
        && locked_until > chrono::Utc::now()
    {
        state.audit_sender.try_send(audit::auth_event(
            "login_blocked",
            Some(user.id),
            ip_hash_opt(&state, ip.as_deref()),
            json!({ "reason": "account_locked", "locked_until": locked_until }),
        ));
        metrics::counter!(
            LOGIN_ATTEMPTS_TOTAL,
            "outcome" => "blocked",
            "reason" => "account_locked",
        )
        .increment(1);
        return err(
            StatusCode::FORBIDDEN,
            "account_locked",
            "Account is temporarily locked due to too many failed attempts",
        );
    }

    let password_valid = if user.password_hash.starts_with("$argon2") {
        password::verify_password(&body.password, &user.password_hash).unwrap_or(false)
    } else {
        sqlx::query_scalar!(
            "SELECT ($1::text = crypt($2::text, $1::text)) AS \"valid!\"",
            user.password_hash,
            body.password
        )
        .fetch_one(&state.db)
        .await
        .unwrap_or(false)
    };

    if !password_valid {
        let new_attempts = user.failed_login_attempts + 1;
        let max_attempts: i32 = sqlx::query_scalar!(
            r#"SELECT value::TEXT AS "v!" FROM system_settings WHERE key = 'max_failed_login_attempts'"#
        ).fetch_optional(&state.db).await.ok().flatten()
            .and_then(|v| v.trim_matches('"').parse().ok()).unwrap_or(5);
        let lockout_min: i64 = sqlx::query_scalar!(
            r#"SELECT value::TEXT AS "v!" FROM system_settings WHERE key = 'lockout_duration_minutes'"#
        ).fetch_optional(&state.db).await.ok().flatten()
            .and_then(|v| v.trim_matches('"').parse().ok()).unwrap_or(30);

        if new_attempts >= max_attempts {
            let lock_until = chrono::Utc::now() + chrono::Duration::minutes(lockout_min);
            let _ = sqlx::query!(
                "UPDATE users SET failed_login_attempts = $2, locked_until = $3 WHERE id = $1",
                user.id,
                new_attempts,
                lock_until
            )
            .execute(&state.db)
            .await;
            tracing::warn!(user_id = %user.id, attempts = new_attempts, "Account locked");
            state.audit_sender.try_send(audit::auth_event(
                "login_blocked",
                Some(user.id),
                ip_hash_opt(&state, ip.as_deref()),
                json!({
                    "reason": "auto_locked",
                    "failed_attempts": new_attempts,
                    "locked_until": lock_until,
                }),
            ));
            metrics::counter!(
                LOGIN_ATTEMPTS_TOTAL,
                "outcome" => "blocked",
                "reason" => "auto_locked",
            )
            .increment(1);
            return err(
                StatusCode::FORBIDDEN,
                "account_locked",
                "Account locked due to too many failed attempts",
            );
        } else {
            let _ = sqlx::query!(
                "UPDATE users SET failed_login_attempts = $2 WHERE id = $1",
                user.id,
                new_attempts
            )
            .execute(&state.db)
            .await;
        }

        state.audit_sender.try_send(audit::auth_event(
            "login_failure",
            Some(user.id),
            ip_hash_opt(&state, ip.as_deref()),
            json!({ "reason": "wrong_password", "failed_attempts": new_attempts }),
        ));
        metrics::counter!(
            LOGIN_ATTEMPTS_TOTAL,
            "outcome" => "failure",
            "reason" => "wrong_password",
        )
        .increment(1);
        return err(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid email or password",
        );
    }

    let _ = sqlx::query!(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1",
        user.id
    )
    .execute(&state.db)
    .await;

    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(512).collect::<String>());

    if user.mfa_required {
        let pending = sqlx::query!(
            "INSERT INTO pending_logins (user_id, ip_address, user_agent, device_info)
             VALUES ($1, $2, $3, $4) RETURNING id",
            user.id,
            ip.as_deref(),
            ua.as_deref(),
            body.device_info
        )
        .fetch_one(&state.db)
        .await;

        match pending {
            Ok(row) => {
                tracing::info!(user_id = %user.id, pending = %row.id, "MFA pending login created");
                state.audit_sender.try_send(audit::auth_event(
                    "login_mfa_requested",
                    Some(user.id),
                    ip_hash_opt(&state, ip.as_deref()),
                    json!({ "pending_id": row.id }),
                ));
                metrics::counter!(
                    LOGIN_ATTEMPTS_TOTAL,
                    "outcome" => "mfa_pending",
                    "reason" => "mfa_required",
                )
                .increment(1);
                return Json(serde_json::json!({
                    "status": "mfa_pending",
                    "pending_id": row.id,
                    "message": "Login requires admin approval"
                }))
                .into_response();
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to create pending login");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "An internal error occurred",
                );
            }
        }
    }

    let settings = state.settings.get().await;
    let pair = match tokens::create_session(
        &state.db,
        state.jwt_secret(),
        user.id,
        &user.role,
        None,
        ip.as_deref(),
        ua.as_deref(),
        &settings,
    )
    .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "Failed to create session");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "An internal error occurred",
            );
        }
    };

    tracing::info!(user_id = %user.id, role = %user.role, "User logged in");
    state.audit_sender.try_send(audit::auth_event(
        "login_success",
        Some(user.id),
        ip_hash_opt(&state, ip.as_deref()),
        json!({ "role": user.role }),
    ));
    metrics::counter!(
        LOGIN_ATTEMPTS_TOTAL,
        "outcome" => "success",
        "reason" => "ok",
    )
    .increment(1);

    Json(AuthResponse {
        access_token: pair.access_token,
        refresh_token: pair.refresh_token,
        token_type: "Bearer",
        expires_in: pair.expires_in,
    })
    .into_response()
}

async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RefreshRequest>,
) -> impl IntoResponse {
    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string());
    if let Err(msg) = validate_refresh(&body) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "validation_error", msg);
    }

    let settings = state.settings.get().await;
    match tokens::rotate_refresh_token(
        &state.db,
        state.jwt_secret(),
        &body.refresh_token,
        &settings,
    )
    .await
    {
        Ok(pair) => Json(AuthResponse {
            access_token: pair.access_token,
            refresh_token: pair.refresh_token,
            token_type: "Bearer",
            expires_in: pair.expires_in,
        })
        .into_response(),

        Err(tokens::TokenError::TheftDetected) => {
            state.audit_sender.try_send(audit::auth_event(
                "refresh_token_theft",
                None,
                ip_hash_opt(&state, ip.as_deref()),
                json!({ "severity": "critical" }),
            ));
            err(
                StatusCode::UNAUTHORIZED,
                "token_theft_detected",
                "Suspicious token reuse detected. All sessions have been revoked.",
            )
        }
        Err(tokens::TokenError::InvalidToken | tokens::TokenError::Expired) => err(
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "Refresh token is invalid or expired",
        ),
        Err(tokens::TokenError::FamilyRevoked) => {
            state.audit_sender.try_send(audit::auth_event(
                "refresh_family_revoked",
                None,
                ip_hash_opt(&state, ip.as_deref()),
                json!({}),
            ));
            err(
                StatusCode::UNAUTHORIZED,
                "session_revoked",
                "This session has been revoked",
            )
        }
        Err(tokens::TokenError::Internal) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "An internal error occurred",
        ),
    }
}

async fn logout(State(state): State<AppState>, Extension(auth): Extension<AuthUser>) -> StatusCode {
    if let Err(e) = blacklist::revoke_token(
        &state.db,
        auth.access_token_jti,
        auth.user_id,
        auth.family_id,
        auth.access_token_expires_at,
        "user_logout",
    )
    .await
    {
        tracing::error!(error = %e, jti = %auth.access_token_jti, "Failed to blacklist current access token on logout");
    }
    tokens::revoke_family(&state.db, auth.family_id, "user_logout").await;
    tracing::info!(user_id = %auth.user_id, family_id = %auth.family_id, "User logged out");
    StatusCode::NO_CONTENT
}

async fn logout_all(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> StatusCode {
    if let Err(e) = blacklist::revoke_token(
        &state.db,
        auth.access_token_jti,
        auth.user_id,
        auth.family_id,
        auth.access_token_expires_at,
        "user_logout_all",
    )
    .await
    {
        tracing::error!(error = %e, jti = %auth.access_token_jti, "Failed to blacklist current access token on logout-all");
    }
    tokens::revoke_all_families(&state.db, auth.user_id, "user_logout_all").await;
    tracing::info!(user_id = %auth.user_id, "User logged out from all devices");
    StatusCode::NO_CONTENT
}

async fn list_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> impl IntoResponse {
    match sqlx::query!(
        "SELECT id, device_fingerprint, ip_address, user_agent, created_at, last_activity_at
         FROM token_families
         WHERE user_id = $1 AND NOT is_revoked
         ORDER BY last_activity_at DESC",
        auth.user_id
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut sessions = Vec::with_capacity(rows.len());
            for r in rows {
                sessions.push(SessionInfo {
                    family_id: r.id,
                    device_fingerprint: r.device_fingerprint,
                    ip_address: r.ip_address,
                    user_agent: r.user_agent,
                    created_at: r.created_at,
                    last_activity_at: r.last_activity_at,
                });
            }
            Json(sessions).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to list sessions");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "An internal error occurred",
            )
        }
    }
}

async fn revoke_session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(family_id): Path<Uuid>,
) -> impl IntoResponse {
    let belongs = sqlx::query_scalar!(
        r#"SELECT EXISTS(
            SELECT 1 FROM token_families WHERE id = $1 AND user_id = $2 AND NOT is_revoked
        ) AS "exists!""#,
        family_id,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if !belongs {
        return StatusCode::NOT_FOUND.into_response();
    }

    if family_id == auth.family_id
        && let Err(e) = blacklist::revoke_token(
            &state.db,
            auth.access_token_jti,
            auth.user_id,
            auth.family_id,
            auth.access_token_expires_at,
            "user_revoked_session",
        )
        .await
    {
        tracing::error!(error = %e, jti = %auth.access_token_jti, "Failed to blacklist current access token on session revoke");
    }
    tokens::revoke_family(&state.db, family_id, "user_revoked_session").await;
    tracing::info!(user_id = %auth.user_id, family_id = %family_id, "Session revoked");
    StatusCode::NO_CONTENT.into_response()
}

async fn check_pending(
    State(state): State<AppState>,
    Path(pending_id): Path<Uuid>,
) -> impl IntoResponse {
    let row = sqlx::query!(
        r#"SELECT pl.status AS "status!", pl.user_id, u.role
           FROM pending_logins pl
           JOIN users u ON u.id = pl.user_id
           WHERE pl.id = $1"#,
        pending_id
    )
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(r)) if r.status == "approved" => {
            let settings = state.settings.get().await;
            match tokens::create_session(
                &state.db,
                state.jwt_secret(),
                r.user_id,
                &r.role,
                None,
                None,
                None,
                &settings,
            )
            .await
            {
                Ok(pair) => Json(serde_json::json!({
                    "status": "approved",
                    "access_token": pair.access_token,
                    "refresh_token": pair.refresh_token,
                    "token_type": "Bearer",
                    "expires_in": pair.expires_in,
                }))
                .into_response(),
                Err(e) => {
                    tracing::error!(error = %e, "Failed to create session after MFA approval");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Failed")
                }
            }
        }
        Ok(Some(r)) if r.status == "rejected" => {
            Json(serde_json::json!({ "status": "rejected" })).into_response()
        }
        Ok(Some(_)) => Json(serde_json::json!({ "status": "pending" })).into_response(),
        Ok(None) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            "Pending login not found",
        ),
        Err(e) => {
            tracing::error!(error = %e, "check pending");
            err(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Failed")
        }
    }
}

fn err(status: StatusCode, error: &str, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({ "error": error, "message": message })),
    )
        .into_response()
}
