use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/ip-whitelist", get(list_ips).post(add_ip))
        .route("/admin/ip-whitelist/{id}/delete", post(delete_ip))
        .route("/admin/users/{user_id}/unlock", post(unlock_user))
        .route(
            "/admin/users/{user_id}/force-password-reset",
            post(force_password_reset),
        )
        .route("/admin/maintenance", post(toggle_maintenance))
        .route("/admin/health", get(system_health))
        .route("/admin/login-geo", get(login_geo_history))
}

async fn list_ips(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "SELECT id, cidr, description, is_active, created_at FROM ip_whitelist ORDER BY created_at DESC"
    ).fetch_all(&state.db).await {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
                "id": r.id, "cidr": r.cidr, "description": r.description,
                "is_active": r.is_active, "created_at": r.created_at,
            })).collect();
            Json(data).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "list ips"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

#[derive(Deserialize)]
struct AddIpReq {
    cidr: String,
    description: Option<String>,
}

async fn add_ip(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<AddIpReq>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    if body.cidr.trim().is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "CIDR is required");
    }

    match sqlx::query!(
        "INSERT INTO ip_whitelist (cidr, description, created_by) VALUES ($1, $2, $3) RETURNING id",
        body.cidr.trim(),
        body.description,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            state.audit_sender.try_send(audit::domain_event(
                "add_ip_whitelist",
                Some(auth.user_id),
                "ip_whitelist",
                Some(r.id),
                serde_json::json!({ "cidr": body.cidr }),
            ));
            Json(serde_json::json!({"ok": true, "id": r.id})).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "add ip");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn delete_ip(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let _ = sqlx::query!("DELETE FROM ip_whitelist WHERE id = $1", id)
        .execute(&state.db)
        .await;
    state.audit_sender.try_send(audit::domain_event(
        "delete_ip_whitelist",
        Some(auth.user_id),
        "ip_whitelist",
        Some(id),
        serde_json::json!({}),
    ));
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn unlock_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let _ = sqlx::query!(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1",
        user_id
    )
    .execute(&state.db)
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "unlock_user",
        Some(auth.user_id),
        "user",
        Some(user_id),
        serde_json::json!({}),
    ));

    tracing::info!(admin = %auth.user_id, target = %user_id, "User unlocked");
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn force_password_reset(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let _ = sqlx::query!(
        "UPDATE users SET password_changed_at = '2000-01-01'::timestamptz WHERE id = $1",
        user_id
    )
    .execute(&state.db)
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "force_password_reset",
        Some(auth.user_id),
        "user",
        Some(user_id),
        serde_json::json!({}),
    ));

    tracing::info!(admin = %auth.user_id, target = %user_id, "Forced password reset");
    Json(serde_json::json!({"ok": true})).into_response()
}

#[derive(Deserialize)]
struct MaintenanceReq {
    enabled: bool,
    message: Option<String>,
}

async fn toggle_maintenance(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<MaintenanceReq>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let val = serde_json::Value::from(body.enabled);
    let _ = sqlx::query!(
        "UPDATE system_settings SET value = $1::JSONB, updated_by = $2, updated_at = now() WHERE key = 'maintenance_mode'",
        val, auth.user_id
    ).execute(&state.db).await;

    if let Some(msg) = &body.message {
        let msg_val = serde_json::Value::String(msg.clone());
        let _ = sqlx::query!(
            "UPDATE system_settings SET value = $1::JSONB, updated_by = $2, updated_at = now() WHERE key = 'maintenance_message'",
            msg_val, auth.user_id
        ).execute(&state.db).await;
    }

    state.settings.reload(&state.db).await;

    state.audit_sender.try_send(audit::domain_event(
        "toggle_maintenance",
        Some(auth.user_id),
        "system",
        None,
        serde_json::json!({ "enabled": body.enabled, "message": body.message }),
    ));

    tracing::warn!(admin = %auth.user_id, maintenance = body.enabled, "Maintenance mode toggled");
    Json(serde_json::json!({"ok": true, "maintenance_mode": body.enabled})).into_response()
}

async fn system_health(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let db_size = sqlx::query_scalar!(
        r#"SELECT pg_size_pretty(pg_database_size(current_database())) AS "s!""#
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or_else(|_| "?".into());

    let active_connections = sqlx::query_scalar!(
        r#"SELECT count(*) AS "c!" FROM pg_stat_activity WHERE datname = current_database()"#
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_users = sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM users"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let active_users =
        sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM users WHERE is_active = true"#)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
    let locked_users =
        sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM users WHERE locked_until > now()"#)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

    let active_sessions =
        sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM token_families WHERE NOT is_revoked"#)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
    let pending_logins = sqlx::query_scalar!(
        r#"SELECT count(*) AS "c!" FROM pending_logins WHERE status = 'pending'"#
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_patients = sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM patients"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let total_leads = sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM leads"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let total_orders = sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM orders"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let total_audit = sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM audit_log"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let table_sizes = sqlx::query!(
        r#"SELECT relname AS "table!", pg_size_pretty(pg_total_relation_size(relid)) AS "size!"
           FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10"#
    ).fetch_all(&state.db).await.unwrap_or_default();

    let tables: Vec<serde_json::Value> = table_sizes
        .into_iter()
        .map(|r| serde_json::json!({"table": r.table, "size": r.size}))
        .collect();

    Json(serde_json::json!({
        "database": {
            "size": db_size,
            "active_connections": active_connections,
            "tables": tables,
        },
        "users": {
            "total": total_users,
            "active": active_users,
            "locked": locked_users,
        },
        "sessions": {
            "active": active_sessions,
            "pending_mfa": pending_logins,
        },
        "data": {
            "patients": total_patients,
            "leads": total_leads,
            "orders": total_orders,
            "audit_entries": total_audit,
        }
    }))
    .into_response()
}

async fn login_geo_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT tf.id, tf.user_id, u.name AS "user_name!", u.email AS "user_email!",
                  tf.ip_address, tf.user_agent, tf.geo_data,
                  tf.created_at, tf.last_activity_at, tf.is_revoked
           FROM token_families tf
           JOIN users u ON u.id = tf.user_id
           ORDER BY tf.created_at DESC LIMIT 100"#
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
                        "ip_address": r.ip_address,
                        "user_agent": r.user_agent,
                        "geo_data": r.geo_data,
                        "created_at": r.created_at,
                        "last_activity_at": r.last_activity_at,
                        "is_revoked": r.is_revoked,
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "login geo");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
