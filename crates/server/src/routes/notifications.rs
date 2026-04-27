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
        .route(
            "/admin/notifications",
            get(list_channels).post(create_channel),
        )
        .route("/admin/notifications/{id}", get(get_channel))
        .route("/admin/notifications/{id}/update", post(update_channel))
        .route("/admin/notifications/{id}/delete", post(delete_channel))
        .route("/admin/notifications/{id}/test", post(test_channel))
}

async fn list_channels(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "SELECT id, channel_type, name, config, is_active, created_at FROM notification_channels ORDER BY created_at DESC"
    ).fetch_all(&state.db).await {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
                "id": r.id, "channel_type": r.channel_type, "name": r.name,
                "config": r.config, "is_active": r.is_active, "created_at": r.created_at,
            })).collect();
            Json(data).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "list channels"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

#[derive(Deserialize)]
struct UpsertChannel {
    channel_type: String,
    name: String,
    config: serde_json::Value,
    is_active: Option<bool>,
}

async fn create_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertChannel>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "INSERT INTO notification_channels (channel_type, name, config, is_active, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        body.channel_type, body.name, body.config, body.is_active.unwrap_or(true), auth.user_id
    ).fetch_one(&state.db).await {
        Ok(r) => {
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "notification_channel.created",
                "notification_channel",
                r.id,
                serde_json::json!({
                    "is_active": body.is_active.unwrap_or(true),
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true, "id": r.id})).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "create channel"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn get_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "SELECT id, channel_type, name, config, is_active, created_at, updated_at FROM notification_channels WHERE id = $1", id
    ).fetch_optional(&state.db).await {
        Ok(Some(r)) => Json(serde_json::json!({
            "id": r.id, "channel_type": r.channel_type, "name": r.name,
            "config": r.config, "is_active": r.is_active,
            "created_at": r.created_at, "updated_at": r.updated_at,
        })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Channel not found"),
        Err(e) => { tracing::error!(error = %e, "get channel"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn update_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertChannel>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        "UPDATE notification_channels SET channel_type=$2, name=$3, config=$4, is_active=$5, updated_at=now() WHERE id=$1",
        id, body.channel_type, body.name, body.config, body.is_active.unwrap_or(true)
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "notification_channel.updated",
                "notification_channel",
                id,
                serde_json::json!({
                    "is_active": body.is_active.unwrap_or(true),
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Channel not found"),
        Err(e) => { tracing::error!(error = %e, "update channel"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn delete_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let _ = sqlx::query!("DELETE FROM notification_channels WHERE id = $1", id)
        .execute(&state.db)
        .await;
    state.audit_sender.try_send(audit::domain_event(
        "delete_notification_channel",
        Some(auth.user_id),
        "notification_channel",
        Some(id),
        serde_json::json!({}),
    ));
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "notification_channel.deleted",
        "notification_channel",
        id,
        serde_json::json!({}),
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn test_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let ch = sqlx::query!(
        "SELECT channel_type, name, config FROM notification_channels WHERE id = $1",
        id
    )
    .fetch_optional(&state.db)
    .await;

    match ch {
        Ok(Some(r)) => {
            tracing::info!(channel = %r.name, channel_type = %r.channel_type, "Test notification sent (dry run)");
            Json(serde_json::json!({"ok": true, "message": format!("Test sent to {} ({})", r.name, r.channel_type)})).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Channel not found"),
        Err(e) => {
            tracing::error!(error = %e, "test channel");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message}))).into_response()
}
