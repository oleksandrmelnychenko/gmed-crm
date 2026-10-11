use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use gmed_domain::role::Role;
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list_notifications))
        .route("/notifications/unread-count", get(unread_count))
        .route("/notifications/{id}/read", post(mark_read))
        .route("/users/online", get(online_users))
        .route("/notifications/read-all", post(mark_all_read))
}

/// `kind` is the stable code of a notification and `params` its facts; the
/// staff and patient UI word it in the viewer's language from both
/// (`frontend/src/lib/notification-copy.ts`). `title`/`body` are the English
/// fallback for rows written before `params` existed.
async fn list_notifications(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    match sqlx::query(
        r#"SELECT id, kind, title, body, params, entity_type, entity_id, is_read, created_at
           FROM user_notifications
           WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 50"#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.try_get::<Uuid, _>("id").ok(),
                        "kind": r.try_get::<String, _>("kind").unwrap_or_default(),
                        "title": r.try_get::<String, _>("title").unwrap_or_default(),
                        "body": r.try_get::<Option<String>, _>("body").unwrap_or_default(),
                        "params": r
                            .try_get::<Option<serde_json::Value>, _>("params")
                            .unwrap_or_default(),
                        "entity_type": r
                            .try_get::<Option<String>, _>("entity_type")
                            .unwrap_or_default(),
                        "entity_id": r.try_get::<Option<Uuid>, _>("entity_id").unwrap_or_default(),
                        "is_read": r.try_get::<bool, _>("is_read").unwrap_or_default(),
                        "created_at": r
                            .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                            .ok(),
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list notifications");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn unread_count(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    let count = match sqlx::query_scalar!(
        r#"SELECT count(*) AS "c!" FROM user_notifications WHERE user_id = $1 AND NOT is_read"#,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!(%error, user_id = %auth.user_id, "count unread notifications");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to count notifications",
            );
        }
    };

    Json(serde_json::json!({ "count": count })).into_response()
}

async fn mark_read(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    let result = sqlx::query!(
        "UPDATE user_notifications SET is_read = true WHERE id = $1 AND user_id = $2",
        id,
        auth.user_id
    )
    .execute(&state.db)
    .await;
    let outcome = match result {
        Ok(outcome) => outcome,
        Err(error) => {
            tracing::error!(%error, notification_id = %id, user_id = %auth.user_id, "mark notification read");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update notification",
            );
        }
    };
    if outcome.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Notification not found");
    }
    crate::realtime::publish_notification_event(
        &state,
        auth.user_id,
        "notification.read",
        Some(id),
        serde_json::json!({}),
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn mark_all_read(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(error) = sqlx::query!(
        "UPDATE user_notifications SET is_read = true WHERE user_id = $1 AND NOT is_read",
        auth.user_id
    )
    .execute(&state.db)
    .await
    {
        tracing::error!(%error, user_id = %auth.user_id, "mark all notifications read");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update notifications",
        );
    }
    crate::realtime::publish_notification_event(
        &state,
        auth.user_id,
        "notifications.read_all",
        None,
        serde_json::json!({}),
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn online_users(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if auth.role == Role::Patient {
        return err(StatusCode::FORBIDDEN, "Staff access required");
    }
    // Staff presence only: patients' portal sessions (and their e-mail
    // addresses) are not shown to every member of staff.
    match sqlx::query(
        r#"SELECT DISTINCT ON (tf.user_id)
                  tf.user_id, u.name AS user_name, u.email AS user_email, u.role
           FROM token_families tf
           JOIN users u ON u.id = tf.user_id
           WHERE NOT tf.is_revoked
             AND tf.last_activity_at > now() - interval '15 minutes'
             AND u.role <> 'patient'
             AND u.is_active
           ORDER BY tf.user_id, tf.last_activity_at DESC"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "user_id": r.try_get::<Uuid, _>("user_id").ok(),
                        "user_name": r.try_get::<String, _>("user_name").unwrap_or_default(),
                        "user_email": r.try_get::<String, _>("user_email").unwrap_or_default(),
                        "role": r.try_get::<String, _>("role").unwrap_or_default(),
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "online users");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message})),
    )
        .into_response()
}
