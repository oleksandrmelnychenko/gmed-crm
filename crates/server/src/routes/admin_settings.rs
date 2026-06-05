use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::tokens;
use crate::settings;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/settings", get(list_settings))
        .route("/admin/settings/{key}", post(update_setting))
        .route("/admin/sessions", get(list_all_sessions))
        .route(
            "/admin/sessions/user/{user_id}/revoke",
            post(revoke_user_sessions),
        )
        .route("/admin/sessions/revoke-all", post(revoke_all_sessions))
        .route("/admin/activity", get(list_activity))
        .route("/admin/mfa/pending", get(list_pending_logins))
        .route(
            "/admin/mfa/pending/{pending_id}/approve",
            post(approve_pending),
        )
        .route(
            "/admin/mfa/pending/{pending_id}/reject",
            post(reject_pending),
        )
        .route("/admin/mfa/user/{user_id}/toggle", post(toggle_mfa))
}

// ── Settings ────────────────────────────────────────────────

async fn list_settings(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match settings::list_all(&state.db).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list settings");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list settings")
        }
    }
}

#[derive(Deserialize)]
struct UpdateSettingRequest {
    value: String,
}

async fn update_setting(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(key): Path<String>,
    Json(body): Json<UpdateSettingRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match settings::update_setting(&state.db, &key, &body.value, auth.user_id).await {
        Ok(()) => {
            // Reload cached settings
            state.settings.reload(&state.db).await;
            tracing::info!(by = %auth.user_id, key = %key, value = %body.value, "Setting updated");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "system_setting.updated",
                "system_setting",
                auth.user_id,
                serde_json::json!({ "key": key }),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(settings::UpdateError::InvalidValue(msg)) => {
            err(StatusCode::UNPROCESSABLE_ENTITY, &msg)
        }
        Err(settings::UpdateError::NotFound) => err(StatusCode::NOT_FOUND, "Setting not found"),
        Err(settings::UpdateError::Db(msg)) => {
            tracing::error!(error = %msg, "update setting");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update setting",
            )
        }
    }
}

// ── Session management (admin force-logout) ─────────────────

async fn list_all_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT tf.id AS family_id, tf.user_id, u.name AS user_name, u.email AS user_email, u.role,
                  tf.device_fingerprint, tf.ip_address, tf.user_agent,
                  tf.created_at, tf.last_activity_at
           FROM token_families tf
           JOIN users u ON u.id = tf.user_id
           WHERE NOT tf.is_revoked
           ORDER BY tf.last_activity_at DESC
           LIMIT 200"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let sessions: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "family_id": r.family_id,
                        "user_id": r.user_id,
                        "user_name": r.user_name,
                        "user_email": r.user_email,
                        "role": r.role,
                        "device_fingerprint": r.device_fingerprint,
                        "ip_address": r.ip_address,
                        "user_agent": r.user_agent,
                        "created_at": r.created_at,
                        "last_activity_at": r.last_activity_at,
                    })
                })
                .collect();
            Json(sessions).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list all sessions");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn revoke_user_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    tokens::revoke_all_families(
        &state.db,
        user_id,
        &format!("admin_force_logout_by_{}", auth.user_id),
    )
    .await;

    tracing::info!(admin = %auth.user_id, target = %user_id, "Admin force-logout user");

    state.audit_sender.try_send(audit::domain_event(
        "admin_force_logout_user",
        Some(auth.user_id),
        "user",
        Some(user_id),
        serde_json::json!({ "target_user_id": user_id }),
    ));
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "session.revoked",
        "session",
        user_id,
        serde_json::json!({ "target_user_id": user_id }),
    )
    .await;

    Json(serde_json::json!({ "ok": true, "user_id": user_id })).into_response()
}

async fn revoke_all_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    tokens::revoke_all_users(
        &state.db,
        auth.user_id,
        &format!("admin_global_logout_by_{}", auth.user_id),
    )
    .await;

    tracing::warn!(admin = %auth.user_id, "Admin force-logout ALL users");
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "session.revoked_all",
        "session",
        auth.user_id,
        serde_json::json!({}),
    )
    .await;

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ── Activity / audit log ─────────────────────────────────────

#[derive(Deserialize)]
struct ActivityQuery {
    user_id: Option<Uuid>,
    action: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    date_from: Option<String>,
    date_to: Option<String>,
}

fn parse_activity_date_start(
    value: Option<String>,
    field_name: &'static str,
) -> Result<Option<DateTime<Utc>>, &'static str> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let date = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").map_err(|_| match field_name {
        "date_from" => "Invalid date_from (YYYY-MM-DD)",
        _ => "Invalid date_to (YYYY-MM-DD)",
    })?;
    let Some(naive) = date.and_hms_opt(0, 0, 0) else {
        return Err("Invalid activity date");
    };
    Ok(Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)))
}

fn parse_activity_date_to_exclusive(
    value: Option<String>,
) -> Result<Option<DateTime<Utc>>, &'static str> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let date = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| "Invalid date_to (YYYY-MM-DD)")?;
    let Some(next_day) = date.succ_opt() else {
        return Err("Invalid date_to (YYYY-MM-DD)");
    };
    let Some(naive) = next_day.and_hms_opt(0, 0, 0) else {
        return Err("Invalid activity date");
    };
    Ok(Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)))
}

async fn list_activity(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    axum::extract::Query(q): axum::extract::Query<ActivityQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let ActivityQuery {
        user_id,
        action,
        limit,
        offset,
        date_from,
        date_to,
    } = q;
    let action = action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);
    let date_from = match parse_activity_date_start(date_from, "date_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let date_to_exclusive = match parse_activity_date_to_exclusive(date_to) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let (Some(from), Some(to_exclusive)) = (date_from.as_ref(), date_to_exclusive.as_ref())
        && to_exclusive <= from
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "date_to must be on or after date_from",
        );
    }

    let total = match sqlx::query(
        r#"SELECT COUNT(*) AS count
           FROM audit_log al
           JOIN users u ON u.id = al.user_id
           WHERE ($1::UUID IS NULL OR al.user_id = $1)
             AND ($2::TEXT IS NULL OR al.action = $2)
             AND ($3::TIMESTAMPTZ IS NULL OR al.created_at >= $3)
             AND ($4::TIMESTAMPTZ IS NULL OR al.created_at < $4)"#,
    )
    .bind(user_id)
    .bind(action)
    .bind(date_from)
    .bind(date_to_exclusive)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row.try_get::<i64, _>("count").unwrap_or_default(),
        Err(e) => {
            tracing::error!(error = %e, "count activity");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    match sqlx::query(
        r#"SELECT al.id, al.user_id, u.name AS user_name, u.email AS user_email,
                  al.action, al.entity_type, al.entity_id, al.context, al.created_at
           FROM audit_log al
           JOIN users u ON u.id = al.user_id
           WHERE ($1::UUID IS NULL OR al.user_id = $1)
             AND ($2::TEXT IS NULL OR al.action = $2)
             AND ($3::TIMESTAMPTZ IS NULL OR al.created_at >= $3)
             AND ($4::TIMESTAMPTZ IS NULL OR al.created_at < $4)
           ORDER BY al.created_at DESC LIMIT $5 OFFSET $6"#,
    )
    .bind(user_id)
    .bind(action)
    .bind(date_from)
    .bind(date_to_exclusive)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.try_get::<i64, _>("id").unwrap_or_default().to_string(),
                        "user_id": r.try_get::<Uuid, _>("user_id").unwrap_or_default(),
                        "user_name": r.try_get::<String, _>("user_name").unwrap_or_default(),
                        "user_email": r.try_get::<String, _>("user_email").unwrap_or_default(),
                        "action": r.try_get::<String, _>("action").unwrap_or_default(),
                        "entity_type": r.try_get::<Option<String>, _>("entity_type").unwrap_or_default(),
                        "entity_id": r.try_get::<Option<Uuid>, _>("entity_id").unwrap_or_default(),
                        "context": r.try_get::<Option<serde_json::Value>, _>("context").unwrap_or_default(),
                        "created_at": r.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    })
                })
                .collect();
            let count = data.len() as i64;
            Json(serde_json::json!({
                "items": data,
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": offset + count < total,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list activity");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_pending_logins(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT pl.id, pl.user_id, u.name AS "user_name!", u.email AS "user_email!", u.role AS "role!",
                  pl.ip_address, pl.user_agent, pl.device_info, pl.created_at
           FROM pending_logins pl
           JOIN users u ON u.id = pl.user_id
           WHERE pl.status = 'pending'
           ORDER BY pl.created_at DESC"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.id,
                        "user_id": r.user_id,
                        "user_name": r.user_name,
                        "user_email": r.user_email,
                        "role": r.role,
                        "ip_address": r.ip_address,
                        "user_agent": r.user_agent,
                        "device_info": r.device_info,
                        "created_at": r.created_at,
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list pending logins");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn approve_pending(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(pending_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "UPDATE pending_logins SET status = 'approved', approved_by = $2, resolved_at = now() WHERE id = $1 AND status = 'pending'",
        pending_id, auth.user_id
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "mfa_approve",
                Some(auth.user_id),
                "pending_login",
                Some(pending_id),
                serde_json::json!({ "pending_id": pending_id }),
            ));
            tracing::info!(admin = %auth.user_id, pending = %pending_id, "MFA login approved");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "pending_login.approved",
                "pending_login",
                pending_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Pending login not found or already resolved"),
        Err(e) => {
            tracing::error!(error = %e, "approve pending");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn reject_pending(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(pending_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "UPDATE pending_logins SET status = 'rejected', approved_by = $2, resolved_at = now() WHERE id = $1 AND status = 'pending'",
        pending_id, auth.user_id
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "mfa_reject",
                Some(auth.user_id),
                "pending_login",
                Some(pending_id),
                serde_json::json!({ "pending_id": pending_id }),
            ));
            tracing::info!(admin = %auth.user_id, pending = %pending_id, "MFA login rejected");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "pending_login.rejected",
                "pending_login",
                pending_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Pending login not found or already resolved"),
        Err(e) => {
            tracing::error!(error = %e, "reject pending");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

#[derive(Deserialize)]
struct ToggleMfaReq {
    enabled: bool,
}

async fn toggle_mfa(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<ToggleMfaReq>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "UPDATE users SET mfa_required = $2 WHERE id = $1",
        user_id,
        body.enabled
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "toggle_mfa",
                Some(auth.user_id),
                "user",
                Some(user_id),
                serde_json::json!({ "enabled": body.enabled, "target_user": user_id }),
            ));
            tracing::info!(admin = %auth.user_id, target = %user_id, mfa = body.enabled, "MFA toggled");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.mfa_toggled",
                "user",
                user_id,
                serde_json::json!({ "enabled": body.enabled }),
            )
            .await;
            Json(serde_json::json!({"ok": true, "mfa_required": body.enabled})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "User not found"),
        Err(e) => {
            tracing::error!(error = %e, "toggle mfa");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message })),
    )
        .into_response()
}
