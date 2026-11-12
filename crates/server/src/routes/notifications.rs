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
use gmed_domain::access::capabilities::Capability;

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

/// What the API shows instead of a stored secret (screens QA 2026-11-12,
/// E F3: the SMTP password came back in clear in the table and the detail).
/// Sent back unchanged on an update, it keeps the stored secret.
const SECRET_MASK: &str = "********";

/// Config keys whose value is a credential: passwords, tokens, API keys,
/// authorization headers. Matched on the lowercase name, also nested
/// (`headers.Authorization`).
fn is_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "pass",
        "secret",
        "token",
        "api_key",
        "apikey",
        "auth",
        "bearer",
        "credential",
        "private_key",
        "signing_key",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

/// The config as the API returns it: every non-empty secret replaced by
/// [`SECRET_MASK`].
fn masked_config(config: &serde_json::Value) -> serde_json::Value {
    match config {
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .map(|(key, value)| {
                    let shown = if is_secret_key(key) && !is_empty_value(value) {
                        serde_json::Value::String(SECRET_MASK.to_string())
                    } else {
                        masked_config(value)
                    };
                    (key.clone(), shown)
                })
                .collect(),
        ),
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(masked_config).collect())
        }
        other => other.clone(),
    }
}

fn is_empty_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => true,
        serde_json::Value::String(text) => text.is_empty(),
        _ => false,
    }
}

/// An edited config: a secret sent back as [`SECRET_MASK`] keeps the stored
/// value (or is dropped when nothing is stored); a new value replaces it.
fn merge_masked_secrets(
    incoming: serde_json::Value,
    stored: Option<&serde_json::Value>,
) -> serde_json::Value {
    match incoming {
        serde_json::Value::Object(map) => {
            let mut merged = serde_json::Map::new();
            for (key, value) in map {
                let stored_value = stored.and_then(|stored| stored.get(&key));
                if is_secret_key(&key) && value.as_str() == Some(SECRET_MASK) {
                    if let Some(previous) = stored_value {
                        merged.insert(key, previous.clone());
                    }
                    continue;
                }
                let value = merge_masked_secrets(value, stored_value);
                merged.insert(key, value);
            }
            serde_json::Value::Object(merged)
        }
        other => other,
    }
}

async fn list_channels(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminNotifications) {
        return e;
    }

    match sqlx::query!(
        "SELECT id, channel_type, name, config, is_active, created_at FROM notification_channels ORDER BY created_at DESC"
    ).fetch_all(&state.db).await {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
                "id": r.id, "channel_type": r.channel_type, "name": r.name,
                "config": masked_config(&r.config), "is_active": r.is_active, "created_at": r.created_at,
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

/// Known type, a name, an object as config — a refusal the page can
/// translate instead of the database's 500.
fn validate_channel(body: &UpsertChannel) -> Result<(), axum::response::Response> {
    if !matches!(body.channel_type.as_str(), "smtp" | "webhook") {
        return Err(coded_err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "notification_channel_type_invalid",
            "Unknown channel type",
        ));
    }
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(coded_err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "notification_channel_name_invalid",
            "Channel name is required (at most 200 characters)",
        ));
    }
    if !body.config.is_object() {
        return Err(coded_err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "notification_channel_config_invalid",
            "Channel configuration must be a JSON object",
        ));
    }
    Ok(())
}

async fn create_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(mut body): Json<UpsertChannel>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminNotifications) {
        return e;
    }
    if let Err(response) = validate_channel(&body) {
        return response;
    }
    body.name = body.name.trim().to_string();
    // A mask copied from another channel is no secret of its own.
    body.config = merge_masked_secrets(body.config, None);

    match sqlx::query!(
        "INSERT INTO notification_channels (channel_type, name, config, is_active, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        body.channel_type, body.name, body.config, body.is_active.unwrap_or(true), auth.user_id
    ).fetch_one(&state.db).await {
        Ok(r) => {
            // Type, name and state only: the config may hold credentials.
            state.audit_sender.try_send(audit::domain_event(
                "create_notification_channel",
                Some(auth.user_id),
                "notification_channel",
                Some(r.id),
                serde_json::json!({
                    "channel_type": body.channel_type,
                    "name": body.name,
                    "is_active": body.is_active.unwrap_or(true),
                }),
            ));
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
    if let Err(e) = auth.require_capability(Capability::AdminNotifications) {
        return e;
    }

    match sqlx::query!(
        "SELECT id, channel_type, name, config, is_active, created_at, updated_at FROM notification_channels WHERE id = $1", id
    ).fetch_optional(&state.db).await {
        Ok(Some(r)) => Json(serde_json::json!({
            "id": r.id, "channel_type": r.channel_type, "name": r.name,
            "config": masked_config(&r.config), "is_active": r.is_active,
            "created_at": r.created_at, "updated_at": r.updated_at,
        })).into_response(),
        Ok(None) => coded_err(StatusCode::NOT_FOUND, "notification_channel_not_found", "Channel not found"),
        Err(e) => { tracing::error!(error = %e, "get channel"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn update_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(mut body): Json<UpsertChannel>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminNotifications) {
        return e;
    }
    if let Err(response) = validate_channel(&body) {
        return response;
    }

    let stored = match sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT config FROM notification_channels WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(config)) => config,
        Ok(None) => {
            return coded_err(
                StatusCode::NOT_FOUND,
                "notification_channel_not_found",
                "Channel not found",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, "load channel config");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    body.name = body.name.trim().to_string();
    body.config = merge_masked_secrets(body.config, Some(&stored));

    match sqlx::query!(
        "UPDATE notification_channels SET channel_type=$2, name=$3, config=$4, is_active=$5, updated_at=now() WHERE id=$1",
        id, body.channel_type, body.name, body.config, body.is_active.unwrap_or(true)
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "update_notification_channel",
                Some(auth.user_id),
                "notification_channel",
                Some(id),
                serde_json::json!({
                    "channel_type": body.channel_type,
                    "name": body.name,
                    "is_active": body.is_active.unwrap_or(true),
                }),
            ));
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
        Ok(_) => coded_err(StatusCode::NOT_FOUND, "notification_channel_not_found", "Channel not found"),
        Err(e) => { tracing::error!(error = %e, "update channel"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn delete_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminNotifications) {
        return e;
    }

    match sqlx::query!("DELETE FROM notification_channels WHERE id = $1", id)
        .execute(&state.db)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => {
            return coded_err(
                StatusCode::NOT_FOUND,
                "notification_channel_not_found",
                "Channel not found",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, "delete channel");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
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

/// Checks that the channel exists. GMED does not deliver through these
/// channels yet, so nothing is sent and nothing is connected: the answer
/// says so (`dry_run`, `sent: false`) instead of a bare "OK" (E F3).
async fn test_channel(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminNotifications) {
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
            tracing::info!(channel = %r.name, channel_type = %r.channel_type, "Notification channel test: dry run, nothing sent");
            Json(serde_json::json!({
                "ok": true,
                "dry_run": true,
                "sent": false,
                "message": "Dry run: nothing was sent and no connection was made",
            }))
            .into_response()
        }
        Ok(None) => coded_err(
            StatusCode::NOT_FOUND,
            "notification_channel_not_found",
            "Channel not found",
        ),
        Err(e) => {
            tracing::error!(error = %e, "test channel");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message}))).into_response()
}

fn coded_err(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::{SECRET_MASK, masked_config, merge_masked_secrets};
    use serde_json::json;

    #[test]
    fn secrets_are_masked_also_nested() {
        let stored = json!({
            "host": "smtp.qa-e.invalid",
            "port": 587,
            "password": "not-a-real-secret-qa",
            "user": "qa",
            "empty_token": "",
            "headers": { "Authorization": "Bearer abc", "X-Trace": "1" },
        });
        assert_eq!(
            masked_config(&stored),
            json!({
                "host": "smtp.qa-e.invalid",
                "port": 587,
                "password": SECRET_MASK,
                "user": "qa",
                "empty_token": "",
                "headers": { "Authorization": SECRET_MASK, "X-Trace": "1" },
            })
        );
    }

    #[test]
    fn a_mask_sent_back_keeps_the_stored_secret() {
        let stored = json!({ "password": "old", "headers": { "Authorization": "Bearer abc" } });
        let edited = json!({
            "host": "smtp.new.invalid",
            "password": SECRET_MASK,
            "headers": { "Authorization": SECRET_MASK },
        });
        assert_eq!(
            merge_masked_secrets(edited, Some(&stored)),
            json!({
                "host": "smtp.new.invalid",
                "password": "old",
                "headers": { "Authorization": "Bearer abc" },
            })
        );
        // A new value replaces the secret; a mask without a stored value is dropped.
        assert_eq!(
            merge_masked_secrets(json!({ "password": "new" }), Some(&stored)),
            json!({ "password": "new" })
        );
        assert_eq!(
            merge_masked_secrets(json!({ "api_key": SECRET_MASK }), None),
            json!({})
        );
    }
}
