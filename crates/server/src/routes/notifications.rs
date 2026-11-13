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
        "api-key",
        "auth",
        "bearer",
        "credential",
        "private_key",
        "signing_key",
        "cookie",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

/// Keys holding HTTP headers (`headers`, `http_headers`, `extra_header` …):
/// every header value is masked, whatever the header's name, since custom
/// headers (`X-Api-Token`, `X-Webhook-Key` …) carry credentials just as often
/// as `Authorization` (security review 2026-11-13, final-D S3-2).
fn is_header_key(key: &str) -> bool {
    key.to_ascii_lowercase().contains("header")
}

/// An `http(s)://` (or any `scheme://`) address that may carry a credential:
/// user info, a path (Slack and Teams hooks put the secret there) or a query
/// (`?token=`). Shown as `scheme://host/********`; a bare `scheme://host/`
/// stays as it is.
fn masked_url(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let (scheme, rest) = trimmed.split_once("://")?;
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
    {
        return None;
    }
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let has_user_info = authority.contains('@');
    if !has_user_info && (tail.is_empty() || tail == "/") {
        return None;
    }
    Some(format!("{scheme}://{host}/{SECRET_MASK}"))
}

/// The config as the API returns it: every non-empty secret replaced by
/// [`SECRET_MASK`] — values of secret-like keys at any depth, every header
/// value (object form `{"Authorization": …}` and list form
/// `[{"name": "Authorization", "value": …}]`), and the credential part of
/// every URL (final-D S3-2: the hook URL and list-form headers came back in
/// clear).
fn masked_config(config: &serde_json::Value) -> serde_json::Value {
    masked_value(config, false)
}

fn mask_scalar(value: &serde_json::Value) -> serde_json::Value {
    if is_empty_value(value) {
        value.clone()
    } else {
        serde_json::Value::String(SECRET_MASK.to_string())
    }
}

/// `in_headers`: the value sits under a header key, so every value in it is
/// a header value.
fn masked_value(value: &serde_json::Value, in_headers: bool) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            // A header entry of the list form: `{name|key|header, value}`.
            let entry_name = ["name", "key", "header"]
                .iter()
                .find_map(|field| map.get(*field).and_then(serde_json::Value::as_str));
            let secret_entry = map.contains_key("value")
                && (in_headers || entry_name.is_some_and(is_secret_header_name));
            serde_json::Value::Object(
                map.iter()
                    .map(|(key, item)| {
                        let shown = if secret_entry && key == "value" {
                            mask_scalar(item)
                        } else if secret_entry
                            && matches!(key.as_str(), "name" | "key" | "header")
                            && item.is_string()
                        {
                            // The header's name stays readable.
                            item.clone()
                        } else if is_secret_key(key) {
                            mask_scalar(item)
                        } else if in_headers && !item.is_object() && !item.is_array() {
                            mask_scalar(item)
                        } else {
                            masked_value(item, in_headers || is_header_key(key))
                        };
                        (key.clone(), shown)
                    })
                    .collect(),
            )
        }
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items
                .iter()
                .map(|item| {
                    if in_headers && !item.is_object() && !item.is_array() {
                        // `["Authorization: Bearer …"]`
                        mask_scalar(item)
                    } else {
                        masked_value(item, in_headers)
                    }
                })
                .collect(),
        ),
        serde_json::Value::String(text) => match masked_url(text) {
            Some(masked) => serde_json::Value::String(masked),
            None => value.clone(),
        },
        other => other.clone(),
    }
}

/// A header name of the list form that carries a credential outside a
/// header key: a secret-like name or any custom `X-…` header.
fn is_secret_header_name(name: &str) -> bool {
    is_secret_key(name) || name.trim().to_ascii_lowercase().starts_with("x-")
}

fn is_empty_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => true,
        serde_json::Value::String(text) => text.is_empty(),
        _ => false,
    }
}

/// An edited config: every value sent back exactly as the API showed it
/// masked keeps the stored value at that place; a new value replaces it. A
/// masked value that cannot be matched to a stored one (copied from another
/// channel, moved, or nothing stored) is dropped — it is no secret of its own.
/// Symmetric with [`masked_config`] by construction: the stored config is
/// masked the same way and compared place by place.
fn merge_masked_secrets(
    incoming: serde_json::Value,
    stored: Option<&serde_json::Value>,
) -> serde_json::Value {
    let shown = stored.map(masked_config);
    merge_at(incoming, stored, shown.as_ref()).unwrap_or(serde_json::Value::Null)
}

/// `None`: drop this value.
fn merge_at(
    incoming: serde_json::Value,
    stored: Option<&serde_json::Value>,
    shown: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    match incoming {
        serde_json::Value::Object(map) => {
            let mut merged = serde_json::Map::new();
            for (key, value) in map {
                let stored_value = stored.and_then(|stored| stored.get(&key));
                let shown_value = shown.and_then(|shown| shown.get(&key));
                if let Some(value) = merge_at(value, stored_value, shown_value) {
                    merged.insert(key, value);
                }
            }
            Some(serde_json::Value::Object(merged))
        }
        serde_json::Value::Array(items) => Some(serde_json::Value::Array(
            items
                .into_iter()
                .enumerate()
                .map(|(index, item)| {
                    merge_at(
                        item,
                        stored.and_then(|stored| stored.get(index)),
                        shown.and_then(|shown| shown.get(index)),
                    )
                    .unwrap_or(serde_json::Value::Null)
                })
                .collect(),
        )),
        serde_json::Value::String(text) if text.contains(SECRET_MASK) => match (stored, shown) {
            (Some(previous), Some(serde_json::Value::String(masked))) if *masked == text => {
                Some(previous.clone())
            }
            _ => None,
        },
        other => Some(other),
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
    use super::{SECRET_MASK, masked_config, masked_url, merge_masked_secrets};
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
                // Every header value: custom headers carry keys too.
                "headers": { "Authorization": SECRET_MASK, "X-Trace": SECRET_MASK },
            })
        );
    }

    /// final-D S3-2: the hook URL with its secret path, list-form headers and
    /// secrets deep in nested objects came back in clear.
    #[test]
    fn urls_header_lists_and_deep_secrets_are_masked() {
        let stored = json!({
            "url": "https://hooks.slack.invalid/services/T000/B000/QADSECRETPATH",
            "fallback_url": "https://qa:pw@hooks.qa.invalid",
            "query_url": "https://hooks.qa.invalid/?token=abc",
            "plain_url": "https://hooks.qa.invalid/",
            "headers": [
                { "name": "Authorization", "value": "Bearer qa-d-not-real" },
                { "name": "Content-Type", "value": "application/json" },
            ],
            "extra": [
                { "name": "X-Api-Token", "value": "qa-token" },
                { "name": "retries", "value": 3 },
            ],
            "options": { "nested": { "client_secret": "s", "api-key": "k", "level": 2 } },
            "http_headers": ["Authorization: Bearer abc"],
        });
        assert_eq!(
            masked_config(&stored),
            json!({
                "url": format!("https://hooks.slack.invalid/{SECRET_MASK}"),
                "fallback_url": format!("https://hooks.qa.invalid/{SECRET_MASK}"),
                "query_url": format!("https://hooks.qa.invalid/{SECRET_MASK}"),
                "plain_url": "https://hooks.qa.invalid/",
                "headers": [
                    { "name": "Authorization", "value": SECRET_MASK },
                    { "name": "Content-Type", "value": SECRET_MASK },
                ],
                "extra": [
                    { "name": "X-Api-Token", "value": SECRET_MASK },
                    { "name": "retries", "value": 3 },
                ],
                "options": { "nested": { "client_secret": SECRET_MASK, "api-key": SECRET_MASK, "level": 2 } },
                "http_headers": [SECRET_MASK],
            })
        );
        assert_eq!(masked_url("smtp.qa.invalid"), None);
        assert_eq!(masked_url("https://qa.invalid"), None);
        assert_eq!(
            masked_url("http://qa.invalid:8080/hook#x"),
            Some(format!("http://qa.invalid:8080/{SECRET_MASK}"))
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

    #[test]
    fn masked_urls_and_header_lists_round_trip() {
        let stored = json!({
            "url": "https://hooks.slack.invalid/services/T000/B000/QADSECRETPATH",
            "headers": [{ "name": "Authorization", "value": "Bearer qa-d-not-real" }],
            "auth": { "user": "qa", "pass": "pw" },
        });
        // The page sends back what it was shown: everything stays stored.
        let shown = masked_config(&stored);
        assert_eq!(merge_masked_secrets(shown.clone(), Some(&stored)), stored);

        // A new URL and a new header value replace the stored ones.
        let mut edited = shown.clone();
        edited["url"] = json!("https://hooks.slack.invalid/services/NEW");
        edited["headers"][0]["value"] = json!("Bearer new");
        let merged = merge_masked_secrets(edited, Some(&stored));
        assert_eq!(merged["url"], "https://hooks.slack.invalid/services/NEW");
        assert_eq!(merged["headers"][0]["value"], "Bearer new");
        assert_eq!(merged["auth"], stored["auth"]);

        // A masked URL pointing elsewhere is not a stored value: dropped.
        let moved = json!({ "url": format!("https://other.invalid/{SECRET_MASK}") });
        assert_eq!(merge_masked_secrets(moved, Some(&stored)), json!({}));
        // Masks copied into a new channel are dropped as well.
        assert_eq!(merge_masked_secrets(shown, None)["url"], json!(null));
    }
}
