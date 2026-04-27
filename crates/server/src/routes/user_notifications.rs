use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
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

async fn list_notifications(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    match sqlx::query!(
        r#"SELECT id, kind, title, body, entity_type, entity_id, is_read, created_at
           FROM user_notifications
           WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 50"#,
        auth.user_id
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.id, "kind": r.kind, "title": r.title, "body": r.body,
                        "entity_type": r.entity_type, "entity_id": r.entity_id,
                        "is_read": r.is_read, "created_at": r.created_at,
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
    let count = sqlx::query_scalar!(
        r#"SELECT count(*) AS "c!" FROM user_notifications WHERE user_id = $1 AND NOT is_read"#,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Json(serde_json::json!({ "count": count })).into_response()
}

async fn mark_read(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    let _ = sqlx::query!(
        "UPDATE user_notifications SET is_read = true WHERE id = $1 AND user_id = $2",
        id,
        auth.user_id
    )
    .execute(&state.db)
    .await;
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
    let _ = sqlx::query!(
        "UPDATE user_notifications SET is_read = true WHERE user_id = $1 AND NOT is_read",
        auth.user_id
    )
    .execute(&state.db)
    .await;
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
    Extension(_auth): Extension<AuthUser>,
) -> axum::response::Response {
    match sqlx::query!(
        r#"SELECT DISTINCT ON (tf.user_id)
                  tf.user_id, u.name AS "user_name!", u.email AS "user_email!", u.role AS "role!"
           FROM token_families tf
           JOIN users u ON u.id = tf.user_id
           WHERE NOT tf.is_revoked
             AND tf.last_activity_at > now() - interval '15 minutes'
           ORDER BY tf.user_id, tf.last_activity_at DESC"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "user_id": r.user_id,
                        "user_name": r.user_name,
                        "user_email": r.user_email,
                        "role": r.role,
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
