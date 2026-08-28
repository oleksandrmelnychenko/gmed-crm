use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::medication_ai_jobs::LEGACY_GOVERNANCE_REVIEW_ID;
use crate::services::medication_ai_provider::MedicationAiCapability;
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
        .route("/admin/audit-analytics", get(audit_analytics))
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
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "security.ip_whitelist_added",
                "security",
                r.id,
                serde_json::json!({ "cidr": body.cidr }),
            )
            .await;
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
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "security.ip_whitelist_deleted",
        "security",
        id,
        serde_json::json!({}),
    )
    .await;
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
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "user.unlocked",
        "user",
        user_id,
        serde_json::json!({}),
    )
    .await;
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

    let result = sqlx::query(
        "UPDATE users SET password_reset_required = true, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "User not found"),
        Err(error) => {
            tracing::error!(%error, target = %user_id, "Failed to force password reset");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    let _ = sqlx::query(
        "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
         WHERE user_id = $1 AND status IN ('pending', 'approved')",
    )
    .bind(user_id)
    .execute(&state.db)
    .await;
    crate::auth::tokens::revoke_all_families(&state.db, user_id, "password_reset_required").await;

    state.audit_sender.try_send(audit::domain_event(
        "force_password_reset",
        Some(auth.user_id),
        "user",
        Some(user_id),
        serde_json::json!({}),
    ));

    tracing::info!(admin = %auth.user_id, target = %user_id, "Forced password reset");
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "user.force_password_reset",
        "user",
        user_id,
        serde_json::json!({}),
    )
    .await;
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
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "system_setting.maintenance_toggled",
        "system_setting",
        auth.user_id,
        serde_json::json!({ "enabled": body.enabled }),
    )
    .await;
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
    let pending_logins = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM pending_logins WHERE status = 'pending' AND expires_at > now()",
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

    let ai_provider = state.medication_ai.capability();
    let ai_queue = load_medication_ai_queue_health(&state).await;
    let ai_governance_current = state
        .medication_ai
        .governance_review_id()
        .is_some_and(|review_id| review_id != LEGACY_GOVERNANCE_REVIEW_ID);
    let ai_operational_status =
        medication_ai_operational_status(&ai_provider, &ai_queue, ai_governance_current);

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
        },
        "medication_ai": {
            "provider": ai_provider,
            "operational_status": ai_operational_status,
            "queue": ai_queue.as_json(),
        }
    }))
    .into_response()
}

#[derive(Default)]
struct MedicationAiQueueHealth {
    available: bool,
    total: i64,
    requested: i64,
    processing: i64,
    ready: i64,
    failed: i64,
    stale_processing: i64,
    ready_last_24h: i64,
    failed_last_24h: i64,
    lease_recovered_last_24h: i64,
    lease_exhausted_last_24h: i64,
    oldest_requested_seconds: Option<i64>,
    last_ready_at: Option<String>,
    last_failed_at: Option<String>,
    last_lease_recovery_at: Option<String>,
    last_lease_exhausted_at: Option<String>,
}

impl MedicationAiQueueHealth {
    fn as_json(&self) -> serde_json::Value {
        serde_json::json!({
            "available": self.available,
            "total": self.total,
            "requested": self.requested,
            "processing": self.processing,
            "ready": self.ready,
            "failed": self.failed,
            "stale_processing": self.stale_processing,
            "ready_last_24h": self.ready_last_24h,
            "failed_last_24h": self.failed_last_24h,
            "lease_recovered_last_24h": self.lease_recovered_last_24h,
            "lease_exhausted_last_24h": self.lease_exhausted_last_24h,
            "oldest_requested_seconds": self.oldest_requested_seconds,
            "last_ready_at": self.last_ready_at,
            "last_failed_at": self.last_failed_at,
            "last_lease_recovery_at": self.last_lease_recovery_at,
            "last_lease_exhausted_at": self.last_lease_exhausted_at,
        })
    }
}

async fn load_medication_ai_queue_health(state: &AppState) -> MedicationAiQueueHealth {
    let result = sqlx::query(
        r#"WITH queue AS (
               SELECT count(*)::bigint AS total,
                  count(*) FILTER (WHERE status = 'requested')::bigint AS requested,
                  count(*) FILTER (WHERE status = 'processing')::bigint AS processing,
                  count(*) FILTER (WHERE status = 'ready')::bigint AS ready,
                  count(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                  count(*) FILTER (
                      WHERE status = 'processing' AND lease_until <= clock_timestamp()
                  )::bigint AS stale_processing,
                  count(*) FILTER (
                      WHERE status = 'ready' AND completed_at >= now() - interval '24 hours'
                  )::bigint AS ready_last_24h,
                  count(*) FILTER (
                      WHERE status = 'failed' AND completed_at >= now() - interval '24 hours'
                  )::bigint AS failed_last_24h,
                  extract(epoch FROM (
                      clock_timestamp() - min(available_at) FILTER (
                          WHERE status = 'requested' AND available_at <= clock_timestamp()
                      )
                  ))::bigint AS oldest_requested_seconds,
                  max(completed_at) FILTER (WHERE status = 'ready') AS last_ready_at,
                  max(completed_at) FILTER (WHERE status = 'failed') AS last_failed_at
               FROM medication_ai_analyses
           ), lease_events AS (
               SELECT count(*) FILTER (
                          WHERE reason_code = 'worker_lease_expired'
                            AND created_at >= now() - interval '24 hours'
                      )::bigint AS lease_recovered_last_24h,
                      count(*) FILTER (
                          WHERE reason_code = 'worker_lease_exhausted'
                            AND created_at >= now() - interval '24 hours'
                      )::bigint AS lease_exhausted_last_24h,
                      max(created_at) FILTER (
                          WHERE reason_code = 'worker_lease_expired'
                      ) AS last_lease_recovery_at,
                      max(created_at) FILTER (
                          WHERE reason_code = 'worker_lease_exhausted'
                      ) AS last_lease_exhausted_at
               FROM medication_ai_analysis_events
               WHERE reason_code IN ('worker_lease_expired', 'worker_lease_exhausted')
           )
           SELECT queue.*, lease_events.*
           FROM queue CROSS JOIN lease_events"#,
    )
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(row) => MedicationAiQueueHealth {
            available: true,
            total: row.get("total"),
            requested: row.get("requested"),
            processing: row.get("processing"),
            ready: row.get("ready"),
            failed: row.get("failed"),
            stale_processing: row.get("stale_processing"),
            ready_last_24h: row.get("ready_last_24h"),
            failed_last_24h: row.get("failed_last_24h"),
            lease_recovered_last_24h: row.get("lease_recovered_last_24h"),
            lease_exhausted_last_24h: row.get("lease_exhausted_last_24h"),
            oldest_requested_seconds: row.get("oldest_requested_seconds"),
            last_ready_at: row
                .get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_ready_at")
                .map(|value| value.to_rfc3339()),
            last_failed_at: row
                .get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_failed_at")
                .map(|value| value.to_rfc3339()),
            last_lease_recovery_at: row
                .get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_lease_recovery_at")
                .map(|value| value.to_rfc3339()),
            last_lease_exhausted_at: row
                .get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_lease_exhausted_at")
                .map(|value| value.to_rfc3339()),
        },
        Err(error) => {
            tracing::error!(error = %error, "load medication AI queue health");
            MedicationAiQueueHealth::default()
        }
    }
}

fn medication_ai_operational_status(
    provider: &MedicationAiCapability,
    queue: &MedicationAiQueueHealth,
    governance_review_current: bool,
) -> &'static str {
    if !queue.available {
        return "unavailable";
    }
    if !provider.external_calls_enabled {
        return provider.status;
    }
    if !governance_review_current {
        return "blocked";
    }
    if queue.stale_processing > 0
        || queue.lease_recovered_last_24h > 0
        || queue.failed_last_24h > 0
        || queue
            .oldest_requested_seconds
            .is_some_and(|seconds| seconds > 120)
    {
        return "attention";
    }
    "healthy"
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

async fn audit_analytics(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let summary = match sqlx::query(
        r#"SELECT
                count(*) FILTER (
                    WHERE action = 'login_failure'
                      AND created_at >= now() - interval '24 hours'
                ) AS failed_logins_24h,
                count(*) FILTER (
                    WHERE action = 'login_blocked'
                      AND created_at >= now() - interval '24 hours'
                ) AS blocked_logins_24h,
                count(*) FILTER (
                    WHERE action = 'refresh_token_theft'
                      AND created_at >= now() - interval '30 days'
                ) AS token_theft_30d,
                count(*) FILTER (
                    WHERE created_at >= now() - interval '7 days'
                      AND COALESCE(context->>'is_ceo_access', 'false') = 'true'
                ) AS executive_sensitive_access_7d,
                count(*) FILTER (
                    WHERE created_at >= now() - interval '7 days'
                      AND entity_type IN ('patient', 'document', 'message_conversation', 'message_attachment')
                      AND action <> 'http_request'
                      AND (
                            EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') >= 22
                         OR EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') < 6
                      )
                ) AS off_hours_sensitive_access_7d
           FROM audit_log"#,
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => serde_json::json!({
            "failed_logins_24h": row.try_get::<i64, _>("failed_logins_24h").unwrap_or(0),
            "blocked_logins_24h": row.try_get::<i64, _>("blocked_logins_24h").unwrap_or(0),
            "token_theft_30d": row.try_get::<i64, _>("token_theft_30d").unwrap_or(0),
            "executive_sensitive_access_7d": row.try_get::<i64, _>("executive_sensitive_access_7d").unwrap_or(0),
            "off_hours_sensitive_access_7d": row.try_get::<i64, _>("off_hours_sensitive_access_7d").unwrap_or(0),
        }),
        Err(e) => {
            tracing::error!(error = %e, "load audit analytics summary");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load audit analytics",
            );
        }
    };

    let recent_events = match sqlx::query(
        r#"SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.context,
                  al.ip_address, al.created_at,
                  u.name AS user_name, u.role AS user_role
           FROM audit_log al
           LEFT JOIN users u ON u.id = al.user_id
           WHERE al.action IN ('login_failure', 'login_blocked', 'refresh_token_theft', 'refresh_family_revoked')
              OR COALESCE(al.context->>'is_ceo_access', 'false') = 'true'
              OR (
                    al.entity_type IN ('patient', 'document', 'message_conversation', 'message_attachment')
                AND al.action <> 'http_request'
                AND (
                        EXTRACT(HOUR FROM al.created_at AT TIME ZONE 'UTC') >= 22
                     OR EXTRACT(HOUR FROM al.created_at AT TIME ZONE 'UTC') < 6
                )
              )
           ORDER BY al.created_at DESC
           LIMIT 25"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| {
                let action = row.try_get::<String, _>("action").unwrap_or_default();
                let context = row
                    .try_get::<Option<serde_json::Value>, _>("context")
                    .unwrap_or_default()
                    .unwrap_or_else(|| serde_json::json!({}));
                let reason = if action == "refresh_token_theft" {
                    "Refresh token theft detected"
                } else if action == "login_blocked" {
                    "Blocked login attempt"
                } else if action == "login_failure" {
                    "Failed login attempt"
                } else if action == "refresh_family_revoked" {
                    "Refresh attempted on revoked session family"
                } else if context
                    .get("is_ceo_access")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
                {
                    "Executive access to sensitive communication surface"
                } else {
                    "Off-hours sensitive read"
                };

                serde_json::json!({
                    "id": row.try_get::<i64, _>("id").unwrap_or_default(),
                    "user_id": row.try_get::<Option<Uuid>, _>("user_id").unwrap_or_default(),
                    "user_name": row.try_get::<Option<String>, _>("user_name").unwrap_or_default(),
                    "user_role": row.try_get::<Option<String>, _>("user_role").unwrap_or_default(),
                    "action": action,
                    "entity_type": row.try_get::<String, _>("entity_type").unwrap_or_default(),
                    "entity_id": row.try_get::<Option<Uuid>, _>("entity_id").unwrap_or_default(),
                    "reason": reason,
                    "route": context.get("route").and_then(serde_json::Value::as_str),
                    "status": context.get("status").and_then(serde_json::Value::as_i64),
                    "ip_hash": row.try_get::<Option<String>, _>("ip_address").unwrap_or_default(),
                    "created_at": row
                        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                        .map(|value| value.to_rfc3339())
                        .unwrap_or_default(),
                    "context": context,
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::error!(error = %e, "load audit analytics suspicious events");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load audit analytics",
            );
        }
    };

    let top_sensitive_readers = match sqlx::query(
        r#"SELECT al.user_id, u.name AS user_name, u.role AS user_role,
                  count(*) AS event_count,
                  count(DISTINCT al.entity_id) AS distinct_entities
           FROM audit_log al
           JOIN users u ON u.id = al.user_id
           WHERE al.user_id IS NOT NULL
             AND al.created_at >= now() - interval '24 hours'
             AND (
                    COALESCE(al.context->>'is_ceo_access', 'false') = 'true'
                 OR (
                        al.entity_type IN ('patient', 'document', 'message_conversation', 'message_attachment')
                    AND al.action <> 'http_request'
                 )
             )
           GROUP BY al.user_id, u.name, u.role
           ORDER BY event_count DESC, distinct_entities DESC, u.name
           LIMIT 10"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "user_id": row.try_get::<Uuid, _>("user_id").unwrap_or_default(),
                    "user_name": row.try_get::<String, _>("user_name").unwrap_or_default(),
                    "user_role": row.try_get::<String, _>("user_role").unwrap_or_default(),
                    "event_count": row.try_get::<i64, _>("event_count").unwrap_or(0),
                    "distinct_entities": row.try_get::<i64, _>("distinct_entities").unwrap_or(0),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::error!(error = %e, "load audit analytics top readers");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load audit analytics",
            );
        }
    };

    Json(serde_json::json!({
        "summary": summary,
        "recent_suspicious_events": recent_events,
        "top_sensitive_readers": top_sensitive_readers,
    }))
    .into_response()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

#[cfg(test)]
mod medication_ai_health_tests {
    use super::*;

    fn provider(status: &'static str, enabled: bool) -> MedicationAiCapability {
        MedicationAiCapability {
            kind: if enabled { "openai" } else { "none" },
            status,
            external_calls_enabled: enabled,
            reason_code: status,
            model: enabled.then(|| "gpt-test".to_string()),
        }
    }

    #[test]
    fn disabled_provider_is_not_reported_as_an_incident() {
        let queue = MedicationAiQueueHealth {
            available: true,
            ..Default::default()
        };
        assert_eq!(
            medication_ai_operational_status(&provider("disabled", false), &queue, false),
            "disabled"
        );
    }

    #[test]
    fn ready_provider_reports_queue_failures_and_expired_leases() {
        let failed = MedicationAiQueueHealth {
            available: true,
            failed_last_24h: 1,
            ..Default::default()
        };
        assert_eq!(
            medication_ai_operational_status(&provider("ready", true), &failed, true),
            "attention"
        );
        let stale = MedicationAiQueueHealth {
            available: true,
            stale_processing: 1,
            ..Default::default()
        };
        assert_eq!(
            medication_ai_operational_status(&provider("ready", true), &stale, true),
            "attention"
        );
        let recovered = MedicationAiQueueHealth {
            available: true,
            lease_recovered_last_24h: 1,
            ..Default::default()
        };
        assert_eq!(
            medication_ai_operational_status(&provider("ready", true), &recovered, true),
            "attention"
        );
        let delayed = MedicationAiQueueHealth {
            available: true,
            oldest_requested_seconds: Some(121),
            ..Default::default()
        };
        assert_eq!(
            medication_ai_operational_status(&provider("ready", true), &delayed, true),
            "attention"
        );
    }

    #[test]
    fn clean_ready_provider_is_healthy_and_database_failure_is_visible() {
        let clean = MedicationAiQueueHealth {
            available: true,
            ..Default::default()
        };
        assert_eq!(
            medication_ai_operational_status(&provider("ready", true), &clean, true),
            "healthy"
        );
        assert_eq!(
            medication_ai_operational_status(
                &provider("ready", true),
                &MedicationAiQueueHealth::default(),
                true,
            ),
            "unavailable"
        );
        assert_eq!(
            medication_ai_operational_status(&provider("ready", true), &clean, false),
            "blocked"
        );
    }
}
