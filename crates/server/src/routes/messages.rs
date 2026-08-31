use axum::{
    Json, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, Extension, Multipart, Path, Query, State, WebSocketUpgrade,
        ws::{Message as WsMessage, WebSocket},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::access::has_active_patient_assignment;
use crate::audit;
use crate::auth::middleware::{
    AuthUser, authenticate_websocket, release_workspace_allows_path, revalidate_auth_user,
};
use crate::file_scan::{FileScanOutcome, scan_upload_bytes};
use crate::file_sniff::validate_upload_magic_bytes;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

const MAX_FILE_SIZE: usize = 20 * 1024 * 1024; // 20 MB
const MAX_ENCRYPTED_FILE_SIZE: usize = MAX_FILE_SIZE + 32;
const AES_GCM_TAG_SIZE: usize = 16;
const E2E_NONCE_SIZE: usize = 12;
const E2E_SALT_SIZE: usize = 16;
const MAX_MESSAGE_PUBLIC_KEY_SIZE: usize = 512;
const MAX_ATTACHMENT_FILENAME_BYTES: usize = 255;
const MAX_ATTACHMENT_MIME_BYTES: usize = 255;
const MAX_CHAT_ATTACHMENT_BYTES_PER_USER: i64 = 500 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_BYTES_GLOBAL: i64 = 20 * 1024 * 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 10_000;
const MAX_ENCRYPTED_MESSAGE_SIZE: usize = 64 * 1024;
const MIN_MESSAGE_EXPIRY_SECONDS: i64 = 60;
const MAX_MESSAGE_EXPIRY_SECONDS: i64 = 30 * 24 * 60 * 60;
const UPLOAD_DIR: &str = "uploads/chat";

/// Public alias exposed so other modules (e.g. key rotation) can locate
/// stored chat attachments without duplicating the constant.
pub const CHAT_UPLOAD_DIR: &str = UPLOAD_DIR;
const E2E_ALGORITHM: &str = "p256-hkdf-aes256gcm-v1";

pub fn public_router() -> Router<AppState> {
    Router::new().route("/messages/ws", get(messages_ws))
}

pub fn router() -> Router<AppState> {
    let upload_routes = Router::new()
        .route("/messages/{user_id}/upload", post(upload_file))
        .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024));

    Router::new()
        .merge(upload_routes)
        .route(
            "/messages/e2e-key",
            get(get_my_e2e_key).post(upsert_my_e2e_key),
        )
        .route("/messages/e2e-key/{user_id}", get(get_peer_e2e_key))
        .route("/messages/allowed-peers", get(list_allowed_peers))
        .route("/messages/conversations", get(list_conversations))
        .route("/messages/read-all", post(mark_all_conversations_read))
        .route(
            "/messages/{user_id}",
            get(get_conversation).post(send_message),
        )
        .route(
            "/messages/{user_id}/{message_id}",
            axum::routing::delete(delete_message),
        )
        .route("/messages/{user_id}/read", post(mark_conversation_read))
        .route("/messages/unread-total", get(unread_total))
        .route("/messages/file/{file_key}", get(download_file))
}

async fn messages_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> axum::response::Response {
    ws.on_upgrade(move |socket| handle_messages_ws(socket, state))
        .into_response()
}

async fn handle_messages_ws(mut socket: WebSocket, state: AppState) {
    let Some(mut connection_permit) = state.websocket_connections.try_acquire_handshake() else {
        tracing::warn!("chat websocket global handshake quota exceeded");
        return;
    };
    let mut auth = match authenticate_websocket(&mut socket, &state).await {
        Ok(auth) => auth,
        Err(_) => return,
    };
    if !release_workspace_allows_path(auth.role, "/messages/ws")
        || ensure_chat_workspace_role(&auth).is_err()
    {
        return;
    }
    if !connection_permit.try_bind_user(auth.user_id) {
        tracing::warn!(user_id = %auth.user_id, "chat websocket connection quota exceeded");
        return;
    }
    let _connection_permit = connection_permit;
    let mut receiver = state.message_events.subscribe();
    let mut authorization_check = tokio::time::interval(std::time::Duration::from_secs(15));
    authorization_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let expires_in = (auth.access_token_expires_at - chrono::Utc::now())
        .to_std()
        .unwrap_or_default();
    let expiry_check = tokio::time::sleep(expires_in);
    tokio::pin!(expiry_check);
    let user_id_string = auth.user_id.to_string();

    loop {
        let received = tokio::select! {
            _ = &mut expiry_check => break,
            _ = authorization_check.tick() => {
                match revalidate_auth_user(&state, &auth).await {
                    Ok(current)
                        if release_workspace_allows_path(current.role, "/messages/ws")
                            && ensure_chat_workspace_role(&current).is_ok() => {
                        auth = current;
                        continue;
                    }
                    _ => break,
                }
            }
            received = receiver.recv() => received,
        };
        let event = match received {
            Ok(event) => event,
            Err(_) => break,
        };
        let Some(target_user_id) = event.get("user_id").and_then(Value::as_str) else {
            continue;
        };
        if target_user_id != user_id_string {
            continue;
        }

        auth = match revalidate_auth_user(&state, &auth).await {
            Ok(current)
                if release_workspace_allows_path(current.role, "/messages/ws")
                    && ensure_chat_workspace_role(&current).is_ok() =>
            {
                current
            }
            _ => break,
        };

        if socket
            .send(WsMessage::Text(event.to_string().into()))
            .await
            .is_err()
        {
            break;
        }
    }
}

fn publish_message_event(
    state: &AppState,
    user_id: Uuid,
    peer_id: Uuid,
    event_type: &str,
    message_id: Option<Uuid>,
) {
    let _ = state.message_events.send(json!({
        "type": event_type,
        "user_id": user_id,
        "peer_id": peer_id,
        "message_id": message_id,
    }));
}

#[derive(Deserialize)]
struct AllowedPeersQuery {
    search: Option<String>,
}

#[derive(Deserialize)]
struct MessageKeyQuery {
    fingerprint: Option<String>,
}

#[derive(Deserialize)]
struct UpsertMessageKeyRequest {
    algorithm: String,
    public_key: String,
}

async fn create_message_notification(
    state: &AppState,
    source_message_id: Uuid,
    from_user: Uuid,
    to_user: Uuid,
    is_attachment: bool,
) {
    let sender_name = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(NULLIF(name, ''), email, 'Care team') FROM users WHERE id = $1",
    )
    .bind(from_user)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "Care team".to_string());

    let kind = if is_attachment {
        "direct_message_attachment"
    } else {
        "direct_message"
    };
    let title = if is_attachment {
        format!("New file from {sender_name}")
    } else {
        format!("New message from {sender_name}")
    };
    // Notification infrastructure is intentionally content-free. Message text,
    // captions, and filenames follow the message lifecycle and must not be
    // copied into a second plaintext store.
    let body = "Open chat";

    match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO user_notifications (
               user_id, kind, title, body, entity_type, entity_id, source_message_id
           )
           VALUES ($1, $2, $3, $4, 'message_peer', $5, $6)
           RETURNING id"#,
    )
    .bind(to_user)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(from_user)
    .bind(source_message_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(notification_id) => {
            crate::realtime::publish_notification_event(
                state,
                to_user,
                "notification.created",
                Some(notification_id),
                json!({ "entity_type": "message_peer", "entity_id": from_user }),
            )
            .await;
        }
        Err(e) => {
            tracing::warn!(error = %e, user_id = %to_user, "create message notification");
        }
    }
}

async fn delete_message_notifications(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    message_id: Uuid,
) -> Result<u64, sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM user_notifications
           WHERE source_message_id = $1
             AND entity_type = 'message_peer'
             AND kind IN ('direct_message', 'direct_message_attachment')"#,
    )
    .bind(message_id)
    .execute(&mut **tx)
    .await
    .map(|result| result.rows_affected())
}

async fn write_message_peer_audit(
    state: &AppState,
    actor_user_id: Uuid,
    action: &str,
    peer_id: Uuid,
    context: Value,
) {
    state.audit_sender.try_send(audit::domain_event(
        action.to_string(),
        Some(actor_user_id),
        "message_peer",
        Some(peer_id),
        context,
    ));
}

/// Deletes a bounded batch of expired chat payloads and their derivative
/// notifications/files. `user_id = None` is used by the scheduled global
/// sweeper; foreground reads pass a user id for low-latency cleanup.
pub async fn purge_expired_messages_batch(state: &AppState, user_id: Option<Uuid>) -> u64 {
    let rows = match sqlx::query(
        r#"SELECT id, from_user, to_user, attachment_key
             FROM direct_messages
            WHERE ($1::uuid IS NULL OR from_user = $1 OR to_user = $1)
              AND deleted_at IS NULL
              AND expires_at IS NOT NULL
              AND expires_at <= now()
            ORDER BY expires_at
            LIMIT 100"#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(error = %error, user_id = ?user_id, "load expired direct messages");
            return 0;
        }
    };

    let mut purged = 0_u64;
    for row in rows {
        let message_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
        let from_user = row
            .try_get::<Uuid, _>("from_user")
            .unwrap_or_else(|_| Uuid::nil());
        let to_user = row
            .try_get::<Uuid, _>("to_user")
            .unwrap_or_else(|_| Uuid::nil());
        let attachment_key = row
            .try_get::<Option<String>, _>("attachment_key")
            .ok()
            .flatten();

        let mut tx = match state.db.begin().await {
            Ok(tx) => tx,
            Err(error) => {
                tracing::warn!(error = %error, message_id = %message_id, "begin expired direct message purge");
                continue;
            }
        };
        let updated = sqlx::query(
            r#"UPDATE direct_messages
                  SET deleted_at = now(),
                      is_read = true,
                      read_at = COALESCE(read_at, now()),
                      message = NULL,
                      message_ciphertext = NULL,
                      message_nonce = NULL,
                      e2e_algorithm = NULL,
                      e2e_ciphertext = NULL,
                      e2e_nonce = NULL,
                      e2e_salt = NULL,
                      sender_key_fingerprint = NULL,
                      recipient_key_fingerprint = NULL,
                      attachment_filename = NULL,
                      attachment_mime = NULL,
                      attachment_size = NULL,
                      attachment_key = NULL,
                      attachment_nonce = NULL,
                      attachment_e2e_algorithm = NULL,
                      attachment_e2e_nonce = NULL,
                      attachment_e2e_salt = NULL
                WHERE id = $1
                  AND deleted_at IS NULL"#,
        )
        .bind(message_id)
        .execute(&mut *tx)
        .await;

        match updated {
            Ok(result) if result.rows_affected() > 0 => {
                if let Err(error) = delete_message_notifications(&mut tx, message_id).await {
                    tracing::warn!(error = %error, message_id = %message_id, "delete expired chat message notifications");
                    continue;
                }
                if let Err(error) = tx.commit().await {
                    tracing::warn!(error = %error, message_id = %message_id, "commit expired direct message purge");
                    continue;
                }
                purged += result.rows_affected();
                if let Some(file_key) =
                    attachment_key.filter(|value| sanitize_filename(value) == *value)
                {
                    let path = std::path::Path::new(UPLOAD_DIR).join(file_key);
                    if let Err(error) = tokio::fs::remove_file(path).await
                        && error.kind() != std::io::ErrorKind::NotFound
                    {
                        tracing::warn!(error = %error, message_id = %message_id, "remove expired chat attachment");
                    }
                }
                publish_message_event(
                    state,
                    from_user,
                    to_user,
                    "message_deleted",
                    Some(message_id),
                );
                publish_message_event(
                    state,
                    to_user,
                    from_user,
                    "message_deleted",
                    Some(message_id),
                );
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(error = %error, message_id = %message_id, "purge expired direct message");
            }
        }
    }
    if purged > 0 {
        metrics::counter!(crate::business_metrics::CHAT_LIFECYCLE_PURGED_TOTAL).increment(purged);
    }
    if user_id.is_none() {
        match sqlx::query_scalar::<_, f64>(
            r#"SELECT COALESCE(
                   EXTRACT(EPOCH FROM (now() - min(expires_at))),
                   0
               )::double precision
               FROM direct_messages
               WHERE expires_at <= now()
                 AND deleted_at IS NULL"#,
        )
        .fetch_one(&state.db)
        .await
        {
            Ok(lag_seconds) => {
                metrics::gauge!(crate::business_metrics::CHAT_PURGE_LAG_SECONDS)
                    .set(lag_seconds.max(0.0));
            }
            Err(error) => tracing::warn!(error = %error, "measure chat expiry purge lag"),
        }
    }
    purged
}

/// Encrypts a bounded batch of pre-nonce attachment files in place by writing
/// a new object, atomically switching the database reference, and only then
/// removing the legacy object. Downloads fail closed while a row is still in
/// the legacy state.
pub async fn migrate_legacy_chat_attachments_batch(state: &AppState) -> (u64, u64) {
    let rows = match sqlx::query(
        r#"SELECT id, attachment_key
           FROM direct_messages
           WHERE attachment_key IS NOT NULL
             AND attachment_nonce IS NULL
             AND attachment_e2e_algorithm IS NULL
             AND deleted_at IS NULL
           ORDER BY created_at
           LIMIT 25"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(error = %error, "load legacy chat attachments for migration");
            return (0, 1);
        }
    };

    let mut migrated = 0_u64;
    let mut errors = 0_u64;
    let upload_dir = std::path::Path::new(UPLOAD_DIR);
    if let Err(error) = tokio::fs::create_dir_all(upload_dir).await {
        tracing::warn!(error = %error, "create legacy chat migration directory");
        return (0, 1);
    }
    for row in rows {
        let message_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
        let Some(old_key) = row
            .try_get::<Option<String>, _>("attachment_key")
            .ok()
            .flatten()
            .filter(|value| sanitize_filename(value) == *value)
        else {
            errors += 1;
            continue;
        };
        let old_path = upload_dir.join(&old_key);
        let plaintext = match tokio::fs::read(&old_path).await {
            Ok(value) => value,
            Err(error) => {
                errors += 1;
                tracing::warn!(error = %error, message_id = %message_id, "read legacy chat attachment");
                continue;
            }
        };
        let (ciphertext, nonce, key_id) = match state.message_keys.encrypt(&plaintext) {
            Ok(value) => value,
            Err(error) => {
                errors += 1;
                tracing::warn!(error = %error, message_id = %message_id, "encrypt legacy chat attachment");
                continue;
            }
        };
        let extension = std::path::Path::new(&old_key)
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| value.len() <= 16)
            .map(|value| format!(".{value}"))
            .unwrap_or_default();
        let new_key = format!("{}_migrated{extension}", Uuid::new_v4());
        let new_path = upload_dir.join(&new_key);
        if let Err(error) = tokio::fs::write(&new_path, ciphertext).await {
            errors += 1;
            tracing::warn!(error = %error, message_id = %message_id, "write migrated chat attachment");
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            if let Err(error) =
                tokio::fs::set_permissions(&new_path, std::fs::Permissions::from_mode(0o600)).await
            {
                errors += 1;
                tracing::warn!(error = %error, message_id = %message_id, "restrict migrated chat attachment permissions");
                let _ = tokio::fs::remove_file(&new_path).await;
                continue;
            }
        }

        let updated = sqlx::query(
            r#"UPDATE direct_messages
               SET attachment_key = $2,
                   attachment_nonce = $3,
                   encryption_key_id = $4
               WHERE id = $1
                 AND attachment_key = $5
                 AND attachment_nonce IS NULL
                 AND attachment_e2e_algorithm IS NULL"#,
        )
        .bind(message_id)
        .bind(&new_key)
        .bind(&nonce)
        .bind(&key_id)
        .bind(&old_key)
        .execute(&state.db)
        .await;
        match updated {
            Ok(result) if result.rows_affected() == 1 => {
                migrated += 1;
                if let Err(error) = tokio::fs::remove_file(&old_path).await
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    tracing::warn!(error = %error, message_id = %message_id, "remove migrated legacy chat attachment");
                }
            }
            Ok(_) => {
                let _ = tokio::fs::remove_file(&new_path).await;
            }
            Err(error) => {
                errors += 1;
                tracing::warn!(error = %error, message_id = %message_id, "persist migrated chat attachment");
                let _ = tokio::fs::remove_file(&new_path).await;
            }
        }
    }
    (migrated, errors)
}

/// Removes a bounded batch of old files that are no longer referenced by any
/// chat row. A one-hour grace period prevents racing an upload whose file has
/// been written but whose database transaction has not committed yet.
pub async fn reconcile_orphan_chat_attachments_batch(state: &AppState) -> (u64, u64) {
    const MAX_FILES_PER_SWEEP: usize = 100;
    const ORPHAN_GRACE_SECONDS: u64 = 60 * 60;

    let upload_dir = std::path::Path::new(UPLOAD_DIR);
    let mut entries = match tokio::fs::read_dir(upload_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (0, 0),
        Err(error) => {
            tracing::warn!(error = %error, "open chat attachment directory for reconciliation");
            return (0, 1);
        }
    };
    let mut scanned = 0_usize;
    let mut deleted = 0_u64;
    let mut errors = 0_u64;

    while scanned < MAX_FILES_PER_SWEEP {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(error) => {
                errors += 1;
                tracing::warn!(error = %error, "read chat attachment directory entry");
                break;
            }
        };
        let metadata = match entry.metadata().await {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => continue,
            Err(error) => {
                errors += 1;
                tracing::warn!(error = %error, path = %entry.path().display(), "read chat attachment metadata");
                continue;
            }
        };
        scanned += 1;
        let is_old_enough = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age.as_secs() >= ORPHAN_GRACE_SECONDS);
        if !is_old_enough {
            continue;
        }
        let Some(file_key) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if sanitize_filename(&file_key) != file_key {
            continue;
        }
        let referenced = match sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM direct_messages WHERE attachment_key = $1)",
        )
        .bind(&file_key)
        .fetch_one(&state.db)
        .await
        {
            Ok(value) => value,
            Err(error) => {
                errors += 1;
                tracing::warn!(error = %error, file_key = %file_key, "check orphan chat attachment reference");
                continue;
            }
        };
        if referenced {
            continue;
        }
        match tokio::fs::remove_file(entry.path()).await {
            Ok(()) => deleted += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                errors += 1;
                tracing::warn!(error = %error, file_key = %file_key, "remove orphan chat attachment");
            }
        }
    }

    match sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(sum(attachment_size), 0)::bigint
           FROM direct_messages
           WHERE attachment_key IS NOT NULL"#,
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(used_bytes) => {
            metrics::gauge!(crate::business_metrics::CHAT_ATTACHMENT_STORAGE_BYTES)
                .set(used_bytes as f64);
            if used_bytes >= MAX_CHAT_ATTACHMENT_BYTES_GLOBAL * 4 / 5 {
                tracing::warn!(
                    used_bytes,
                    capacity_bytes = MAX_CHAT_ATTACHMENT_BYTES_GLOBAL,
                    "chat attachment storage is above 80 percent capacity"
                );
            }
        }
        Err(error) => {
            errors += 1;
            tracing::warn!(error = %error, "measure reconciled chat attachment storage");
        }
    }

    (deleted, errors)
}

async fn list_allowed_peers(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<AllowedPeersQuery>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    let search_pattern = format!("%{}%", query.search.unwrap_or_default().trim());
    let rows = match load_allowed_peer_rows(&state, &auth, &search_pattern).await {
        Ok(rows) => rows,
        Err(resp) => return resp,
    };

    Json(rows_to_peer_json(rows)).into_response()
}

fn is_valid_message_key_algorithm(value: &str) -> bool {
    value.trim().eq_ignore_ascii_case(E2E_ALGORITHM)
}

fn compute_message_key_fingerprint(public_key: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(public_key);
    hex::encode(hasher.finalize())
}

#[allow(clippy::result_large_err)]
fn decode_base64_message_field(
    value: &str,
    field: &str,
) -> Result<Vec<u8>, axum::response::Response> {
    BASE64
        .decode(value.trim())
        .map_err(|_| err(StatusCode::UNPROCESSABLE_ENTITY, field))
}

#[allow(clippy::result_large_err)]
fn decode_fixed_base64_message_field(
    value: &str,
    field: &str,
    expected_size: usize,
) -> Result<Vec<u8>, axum::response::Response> {
    let value = value.trim();
    let max_encoded_size = expected_size.div_ceil(3) * 4;
    if value.len() > max_encoded_size {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, field));
    }
    let bytes = decode_base64_message_field(value, field)?;
    if bytes.len() != expected_size {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, field));
    }
    Ok(bytes)
}

fn is_valid_message_key_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

async fn load_message_key_row(
    state: &AppState,
    user_id: Uuid,
    fingerprint: Option<&str>,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    let row =
        if let Some(fingerprint) = fingerprint.map(str::trim).filter(|value| !value.is_empty()) {
            sqlx::query(
                r#"SELECT id, user_id, fingerprint, algorithm, public_key, is_active, created_at
               FROM user_message_keys
               WHERE user_id = $1
                 AND fingerprint = $2
                 AND revoked_at IS NULL
               LIMIT 1"#,
            )
            .bind(user_id)
            .bind(fingerprint)
            .fetch_optional(&state.db)
            .await
        } else {
            sqlx::query(
                r#"SELECT id, user_id, fingerprint, algorithm, public_key, is_active, created_at
               FROM user_message_keys
               WHERE user_id = $1
                 AND is_active = true
                 AND revoked_at IS NULL
               ORDER BY created_at DESC
               LIMIT 1"#,
            )
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
        };

    row.map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, fingerprint = ?fingerprint, "load message key");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load message key",
        )
    })
}

async fn load_active_message_key_row(
    state: &AppState,
    user_id: Uuid,
    fingerprint: &str,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(
        r#"SELECT id, user_id, fingerprint, algorithm, public_key, is_active, created_at
           FROM user_message_keys
           WHERE user_id = $1
             AND fingerprint = $2
             AND is_active = true
             AND revoked_at IS NULL
           LIMIT 1"#,
    )
    .bind(user_id)
    .bind(fingerprint)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, fingerprint = %fingerprint, "load active message key");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load message key",
        )
    })
}

fn build_message_key_json(row: &sqlx::postgres::PgRow) -> Value {
    let public_key = row.try_get::<Vec<u8>, _>("public_key").unwrap_or_default();
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "user_id": row.try_get::<Uuid, _>("user_id").unwrap_or_else(|_| Uuid::nil()),
        "fingerprint": row.try_get::<String, _>("fingerprint").unwrap_or_default(),
        "algorithm": row.try_get::<String, _>("algorithm").unwrap_or_default(),
        "public_key": BASE64.encode(public_key),
        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

async fn get_my_e2e_key(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    match load_message_key_row(&state, auth.user_id, None).await {
        Ok(Some(row)) => Json(build_message_key_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Message key not found"),
        Err(resp) => resp,
    }
}

async fn get_peer_e2e_key(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Query(query): Query<MessageKeyQuery>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    if user_id != auth.user_id
        && let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await
    {
        return resp;
    }

    match load_message_key_row(&state, user_id, query.fingerprint.as_deref()).await {
        Ok(Some(row)) => Json(build_message_key_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Message key not found"),
        Err(resp) => resp,
    }
}

async fn upsert_my_e2e_key(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertMessageKeyRequest>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    if !is_valid_message_key_algorithm(&body.algorithm) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid message key algorithm",
        );
    }
    let encoded_public_key = body.public_key.trim();
    if encoded_public_key.len() > MAX_MESSAGE_PUBLIC_KEY_SIZE.div_ceil(3) * 4 {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid public_key");
    }
    let public_key = match decode_base64_message_field(encoded_public_key, "Invalid public_key") {
        Ok(value) if !value.is_empty() && value.len() <= MAX_MESSAGE_PUBLIC_KEY_SIZE => value,
        Ok(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid public_key"),
        Err(resp) => return resp,
    };
    let fingerprint = compute_message_key_fingerprint(&public_key);

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "begin message key upsert tx");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save message key",
            );
        }
    };

    if let Err(e) = sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, user_id = %auth.user_id, "lock message key upsert");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save message key",
        );
    }

    // Fingerprints remain globally unique so one public key cannot silently
    // represent two accounts. Lock the fingerprint across users, then reject a
    // cross-owner collision before changing either account's active-key state.
    if let Err(e) = sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))")
        .bind(&fingerprint)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, user_id = %auth.user_id, fingerprint = %fingerprint, "lock message key fingerprint");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save message key",
        );
    }

    let existing_owner = match sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM user_message_keys WHERE fingerprint = $1",
    )
    .bind(&fingerprint)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, fingerprint = %fingerprint, "load message key fingerprint owner");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save message key",
            );
        }
    };
    if existing_owner.is_some_and(|owner| owner != auth.user_id) {
        return err(
            StatusCode::CONFLICT,
            "Message key is already registered to another account",
        );
    }

    if let Err(e) = sqlx::query(
        "UPDATE user_message_keys
         SET is_active = false
         WHERE user_id = $1
           AND revoked_at IS NULL
           AND fingerprint <> $2",
    )
    .bind(auth.user_id)
    .bind(&fingerprint)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, user_id = %auth.user_id, "deactivate older message keys");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save message key",
        );
    }

    let row = match sqlx::query(
        r#"INSERT INTO user_message_keys (user_id, fingerprint, algorithm, public_key, is_active, revoked_at)
           VALUES ($1, $2, $3, $4, true, NULL)
           ON CONFLICT (fingerprint)
           DO UPDATE SET
               algorithm = EXCLUDED.algorithm,
               public_key = EXCLUDED.public_key,
               is_active = true,
               revoked_at = NULL
           WHERE user_message_keys.user_id = EXCLUDED.user_id
           RETURNING id, user_id, fingerprint, algorithm, public_key, is_active, created_at"#,
    )
    .bind(auth.user_id)
    .bind(&fingerprint)
    .bind(E2E_ALGORITHM)
    .bind(&public_key)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "insert message key");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save message key");
        }
    };

    let row_owner = row
        .try_get::<Uuid, _>("user_id")
        .unwrap_or_else(|_| Uuid::nil());
    if row_owner != auth.user_id {
        tracing::error!(user_id = %auth.user_id, row_owner = %row_owner, fingerprint = %fingerprint, "message key owner mismatch after upsert");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save message key",
        );
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, user_id = %auth.user_id, "commit message key upsert");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save message key",
        );
    }

    Json(build_message_key_json(&row)).into_response()
}

async fn list_conversations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    purge_expired_messages_batch(&state, Some(auth.user_id)).await;
    match sqlx::query(
        r#"WITH latest AS (
            SELECT DISTINCT ON (peer)
                CASE WHEN from_user = $1 THEN to_user ELSE from_user END AS peer,
                message, message_ciphertext, message_nonce, encryption_key_id,
                e2e_algorithm, e2e_ciphertext, e2e_nonce, e2e_salt,
                sender_key_fingerprint, recipient_key_fingerprint,
                created_at, is_read, read_at,
                CASE WHEN from_user = $1 THEN true ELSE false END AS is_mine,
                attachment_filename
            FROM direct_messages
            WHERE (from_user = $1 OR to_user = $1)
              AND deleted_at IS NULL
              AND (expires_at IS NULL OR expires_at > now())
           ORDER BY peer, created_at DESC
        )
        SELECT l.peer AS peer, u.name AS name, u.email AS email, u.role AS role, u.is_active AS is_active,
               l.message AS legacy_message,
               l.message_ciphertext AS message_ciphertext,
               l.message_nonce AS message_nonce,
               l.encryption_key_id AS encryption_key_id,
               l.e2e_algorithm AS e2e_algorithm,
               l.e2e_ciphertext AS e2e_ciphertext,
               l.e2e_nonce AS e2e_nonce,
               l.e2e_salt AS e2e_salt,
               l.sender_key_fingerprint AS sender_key_fingerprint,
               l.recipient_key_fingerprint AS recipient_key_fingerprint,
               l.created_at AS last_at,
               l.is_read AS is_read, l.read_at AS last_read_at, l.is_mine AS is_mine,
               l.attachment_filename AS attachment_filename,
               (SELECT count(*)
                  FROM direct_messages
                 WHERE from_user = l.peer
                   AND to_user = $1
                   AND NOT is_read
                   AND deleted_at IS NULL
                   AND (expires_at IS NULL OR expires_at > now())) AS unread
        FROM latest l
        JOIN users u ON u.id = l.peer
        ORDER BY l.created_at DESC"#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut data = Vec::with_capacity(rows.len());
            for r in rows {
                if !r.try_get::<bool, _>("is_active").unwrap_or(false) {
                    continue;
                }
                let peer_id = r.try_get::<Uuid, _>("peer").unwrap_or_else(|_| Uuid::nil());
                let role_name = r.try_get::<String, _>("role").unwrap_or_default();
                let Some(peer_role) = parse_role_name(&role_name) else {
                    continue;
                };
                let allowed = match can_message_known_peer(&state, &auth, peer_id, peer_role).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                };
                if !allowed {
                    continue;
                }

                let is_e2e = r
                    .try_get::<Option<Vec<u8>>, _>("e2e_ciphertext")
                    .ok()
                    .flatten()
                    .is_some();
                let ciphertext = r
                    .try_get::<Option<Vec<u8>>, _>("message_ciphertext")
                    .ok()
                    .flatten();
                let nonce = r
                    .try_get::<Option<Vec<u8>>, _>("message_nonce")
                    .ok()
                    .flatten();
                let key_id = r
                    .try_get::<Option<String>, _>("encryption_key_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| crate::crypto::LEGACY_KEY_ID.to_string());
                let last_message = if is_e2e {
                    "[Encrypted message]".to_string()
                } else {
                    match (ciphertext, nonce) {
                        (Some(ct), Some(n)) => state
                            .message_keys
                            .decrypt_to_string(&key_id, &ct, &n)
                            .unwrap_or_default(),
                        _ => r
                            .try_get::<Option<String>, _>("legacy_message")
                            .unwrap_or_default()
                            .unwrap_or_default(),
                    }
                };
                let last_msg = if last_message.is_empty() {
                    r.try_get::<Option<String>, _>("attachment_filename")
                        .unwrap_or_default()
                        .map(|filename| format!("[{filename}]"))
                        .unwrap_or_default()
                } else {
                    last_message
                };
                data.push(serde_json::json!({
                    "user_id": peer_id,
                    "name": r.try_get::<String, _>("name").unwrap_or_default(),
                    "email": r.try_get::<String, _>("email").unwrap_or_default(),
                    "role": role_name,
                    "last_message": last_msg,
                    "is_e2e": is_e2e,
                    "last_at": r.try_get::<chrono::DateTime<chrono::Utc>, _>("last_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    "is_read": r.try_get::<bool, _>("is_read").unwrap_or(false),
                    "last_read_at": r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_read_at").ok().flatten().map(|value| value.to_rfc3339()),
                    "is_mine": r.try_get::<bool, _>("is_mine").unwrap_or(false),
                    "unread": r.try_get::<i64, _>("unread").unwrap_or(0),
                }));
            }
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list conversations");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

#[derive(Deserialize)]
struct PaginationQuery {
    limit: Option<i64>,
    before_created_at: Option<chrono::DateTime<chrono::Utc>>,
    before_id: Option<Uuid>,
}

async fn get_conversation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<PaginationQuery>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    if q.before_created_at.is_some() != q.before_id.is_some() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Both before_created_at and before_id are required",
        );
    }
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }
    purge_expired_messages_batch(&state, Some(auth.user_id)).await;

    match sqlx::query(
        r#"SELECT id, from_user, to_user, message, message_ciphertext, message_nonce, encryption_key_id,
                  e2e_algorithm, e2e_ciphertext, e2e_nonce, e2e_salt,
                  sender_key_fingerprint, recipient_key_fingerprint,
                  is_read, read_at, created_at, expires_at, client_message_id,
                  attachment_filename, attachment_mime, attachment_size, attachment_key,
                  attachment_e2e_algorithm, attachment_e2e_nonce, attachment_e2e_salt
           FROM direct_messages
           WHERE ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))
             AND deleted_at IS NULL
             AND redacted_at IS NULL
             AND (expires_at IS NULL OR expires_at > now())
             AND (
                 $3::timestamptz IS NULL
                 OR (created_at, id) < ($3, $4)
             )
           ORDER BY created_at DESC, id DESC LIMIT $5"#,
    )
    .bind(auth.user_id)
    .bind(user_id)
    .bind(q.before_created_at)
    .bind(q.before_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let attachment_count = rows
                .iter()
                .filter(|row| {
                    row.try_get::<Option<String>, _>("attachment_key")
                        .unwrap_or_default()
                        .is_some()
                })
                .count();
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    let e2e_ciphertext =
                        r.try_get::<Option<Vec<u8>>, _>("e2e_ciphertext").ok().flatten();
                    let e2e_nonce = r.try_get::<Option<Vec<u8>>, _>("e2e_nonce").ok().flatten();
                    let e2e_salt = r.try_get::<Option<Vec<u8>>, _>("e2e_salt").ok().flatten();
                    let attachment_e2e_nonce = r
                        .try_get::<Option<Vec<u8>>, _>("attachment_e2e_nonce")
                        .ok()
                        .flatten();
                    let attachment_e2e_salt = r
                        .try_get::<Option<Vec<u8>>, _>("attachment_e2e_salt")
                        .ok()
                        .flatten();
                    let ciphertext = r.try_get::<Option<Vec<u8>>, _>("message_ciphertext").ok().flatten();
                    let nonce = r.try_get::<Option<Vec<u8>>, _>("message_nonce").ok().flatten();
                    let key_id = r.try_get::<Option<String>, _>("encryption_key_id").ok().flatten()
                        .unwrap_or_else(|| crate::crypto::LEGACY_KEY_ID.to_string());
                    let legacy_plain = r.try_get::<Option<String>, _>("message").unwrap_or_default();
                    let is_e2e = e2e_ciphertext.is_some();
                    let message_text = if is_e2e {
                        None::<String>
                    } else {
                        Some(match (ciphertext, nonce) {
                            (Some(ct), Some(n)) => state
                                .message_keys
                                .decrypt_to_string(&key_id, &ct, &n)
                                .unwrap_or_else(|_| "[decryption failed]".to_string()),
                            _ => legacy_plain.unwrap_or_default(),
                        })
                    };
                    serde_json::json!({
                        "id": r.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "from_user": r.try_get::<Uuid, _>("from_user").unwrap_or_else(|_| Uuid::nil()),
                        "to_user": r.try_get::<Uuid, _>("to_user").unwrap_or_else(|_| Uuid::nil()),
                        "message": message_text,
                        "is_e2e": is_e2e,
                        "e2e_algorithm": r.try_get::<Option<String>, _>("e2e_algorithm").unwrap_or_default(),
                        "e2e_ciphertext": e2e_ciphertext.map(|value| BASE64.encode(value)),
                        "e2e_nonce": e2e_nonce.map(|value| BASE64.encode(value)),
                        "e2e_salt": e2e_salt.map(|value| BASE64.encode(value)),
                        "sender_key_fingerprint": r.try_get::<Option<String>, _>("sender_key_fingerprint").unwrap_or_default(),
                        "recipient_key_fingerprint": r.try_get::<Option<String>, _>("recipient_key_fingerprint").unwrap_or_default(),
                        "is_read": r.try_get::<bool, _>("is_read").unwrap_or(false),
                        "read_at": r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("read_at").ok().flatten().map(|value| value.to_rfc3339()),
                        "created_at": r.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "expires_at": r.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at").ok().flatten().map(|value| value.to_rfc3339()),
                        "client_message_id": r.try_get::<Option<Uuid>, _>("client_message_id").ok().flatten(),
                        "attachment_filename": r.try_get::<Option<String>, _>("attachment_filename").unwrap_or_default(),
                        "attachment_mime": r.try_get::<Option<String>, _>("attachment_mime").unwrap_or_default(),
                        "attachment_size": r.try_get::<Option<i64>, _>("attachment_size").unwrap_or_default(),
                        "attachment_key": r.try_get::<Option<String>, _>("attachment_key").unwrap_or_default(),
                        "attachment_is_e2e": r.try_get::<Option<String>, _>("attachment_e2e_algorithm").unwrap_or_default().is_some(),
                        "attachment_e2e_algorithm": r.try_get::<Option<String>, _>("attachment_e2e_algorithm").unwrap_or_default(),
                        "attachment_e2e_nonce": attachment_e2e_nonce.map(|value| BASE64.encode(value)),
                        "attachment_e2e_salt": attachment_e2e_salt.map(|value| BASE64.encode(value)),
                    })
                })
                .collect();
            write_message_peer_audit(
                &state,
                auth.user_id,
                "view_message_conversation",
                user_id,
                json!({
                    "limit": limit,
                    "before_created_at": q.before_created_at,
                    "before_id": q.before_id,
                    "returned_count": data.len(),
                    "attachment_count": attachment_count,
                    "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
                }),
            )
            .await;
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "get conversation");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

#[derive(Deserialize)]
struct SendReq {
    message: Option<String>,
    client_message_id: Option<Uuid>,
    expires_in_seconds: Option<i64>,
    e2e_algorithm: Option<String>,
    e2e_ciphertext: Option<String>,
    e2e_nonce: Option<String>,
    e2e_salt: Option<String>,
    sender_key_fingerprint: Option<String>,
    recipient_key_fingerprint: Option<String>,
}

#[allow(clippy::result_large_err)]
fn message_expires_at(
    expires_in_seconds: Option<i64>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, axum::response::Response> {
    let Some(seconds) = expires_in_seconds else {
        return Ok(None);
    };
    if !(MIN_MESSAGE_EXPIRY_SECONDS..=MAX_MESSAGE_EXPIRY_SECONDS).contains(&seconds) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid message expiration timer",
        ));
    }
    Ok(Some(
        chrono::Utc::now() + chrono::Duration::seconds(seconds),
    ))
}

fn has_any_e2e_fields(body: &SendReq) -> bool {
    body.e2e_algorithm
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        || body
            .e2e_ciphertext
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        || body
            .e2e_nonce
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        || body
            .e2e_salt
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        || body
            .sender_key_fingerprint
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        || body
            .recipient_key_fingerprint
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
}

async fn send_message(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<SendReq>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    let trimmed_message = body
        .message
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    let expires_at = match message_expires_at(body.expires_in_seconds) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let client_message_id = body.client_message_id;
    let has_e2e_payload = has_any_e2e_fields(&body);

    if has_e2e_payload {
        if !trimmed_message.is_empty() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Mixed plaintext and E2E payloads are not allowed",
            );
        }

        let Some(algorithm) = body
            .e2e_algorithm
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_algorithm");
        };
        if !is_valid_message_key_algorithm(algorithm) {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_algorithm");
        }

        let Some(sender_key_fingerprint) = body
            .sender_key_fingerprint
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid sender_key_fingerprint",
            );
        };
        let Some(recipient_key_fingerprint) = body
            .recipient_key_fingerprint
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid recipient_key_fingerprint",
            );
        };
        if !is_valid_message_key_fingerprint(sender_key_fingerprint)
            || !is_valid_message_key_fingerprint(recipient_key_fingerprint)
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid message key fingerprint",
            );
        }

        let ciphertext = match body.e2e_ciphertext.as_deref() {
            Some(value) => match decode_base64_message_field(value, "Invalid e2e_ciphertext") {
                Ok(bytes) if !bytes.is_empty() && bytes.len() <= MAX_ENCRYPTED_MESSAGE_SIZE => {
                    bytes
                }
                Ok(bytes) if bytes.len() > MAX_ENCRYPTED_MESSAGE_SIZE => {
                    return err(StatusCode::PAYLOAD_TOO_LARGE, "Message is too long");
                }
                Ok(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_ciphertext"),
                Err(resp) => return resp,
            },
            None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_ciphertext"),
        };
        let nonce = match body.e2e_nonce.as_deref() {
            Some(value) => {
                match decode_fixed_base64_message_field(value, "Invalid e2e_nonce", E2E_NONCE_SIZE)
                {
                    Ok(bytes) => bytes,
                    Err(resp) => return resp,
                }
            }
            None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_nonce"),
        };
        let salt = match body.e2e_salt.as_deref() {
            Some(value) => {
                match decode_fixed_base64_message_field(value, "Invalid e2e_salt", E2E_SALT_SIZE) {
                    Ok(bytes) => bytes,
                    Err(resp) => return resp,
                }
            }
            None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_salt"),
        };

        match load_active_message_key_row(&state, auth.user_id, sender_key_fingerprint).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Sender message key is not active",
                );
            }
            Err(resp) => return resp,
        }
        match load_active_message_key_row(&state, user_id, recipient_key_fingerprint).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Recipient message key is not active",
                );
            }
            Err(resp) => return resp,
        }

        match sqlx::query(
            r#"INSERT INTO direct_messages (
                   from_user,
                   to_user,
                   e2e_algorithm,
                   e2e_ciphertext,
                   e2e_nonce,
                   e2e_salt,
                   sender_key_fingerprint,
                   recipient_key_fingerprint,
                   client_message_id,
                   expires_at
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (from_user, to_user, client_message_id)
                   WHERE client_message_id IS NOT NULL
               DO UPDATE SET client_message_id = EXCLUDED.client_message_id
               RETURNING id, created_at, (xmax = 0) AS inserted"#,
        )
        .bind(auth.user_id)
        .bind(user_id)
        .bind(E2E_ALGORITHM)
        .bind(&ciphertext)
        .bind(&nonce)
        .bind(&salt)
        .bind(sender_key_fingerprint)
        .bind(recipient_key_fingerprint)
        .bind(client_message_id)
        .bind(expires_at)
        .fetch_one(&state.db)
        .await
        {
            Ok(row) => {
                let id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
                let created_at: chrono::DateTime<chrono::Utc> = row
                    .try_get("created_at")
                    .unwrap_or_else(|_| chrono::Utc::now());
                let inserted = row.try_get::<bool, _>("inserted").unwrap_or(true);
                write_message_peer_audit(
                    &state,
                    auth.user_id,
                    "send_message",
                    user_id,
                    json!({
                        "message_id": id,
                        "ciphertext_size": ciphertext.len(),
                        "is_e2e": true,
                        "sender_key_fingerprint": sender_key_fingerprint,
                        "recipient_key_fingerprint": recipient_key_fingerprint,
                        "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
                    }),
                )
                .await;
                if inserted {
                    metrics::counter!(
                        crate::business_metrics::CHAT_MESSAGES_ACCEPTED_TOTAL,
                        "kind" => "text",
                        "e2e" => "true"
                    )
                    .increment(1);
                    create_message_notification(&state, id, auth.user_id, user_id, false).await;
                    publish_message_event(
                        &state,
                        auth.user_id,
                        user_id,
                        "message_created",
                        Some(id),
                    );
                    publish_message_event(
                        &state,
                        user_id,
                        auth.user_id,
                        "message_created",
                        Some(id),
                    );
                }
                Json(serde_json::json!({
                    "ok": true,
                    "id": id,
                    "created_at": created_at.to_rfc3339(),
                    "expires_at": expires_at.map(|value| value.to_rfc3339()),
                    "client_message_id": client_message_id,
                    "duplicate": !inserted,
                    "is_e2e": true,
                }))
                .into_response()
            }
            Err(e) => {
                tracing::error!(error = %e, "send e2e message");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
            }
        }
    } else {
        if trimmed_message.is_empty() {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Message is empty");
        }
        if trimmed_message.chars().count() > MAX_MESSAGE_CHARS {
            return err(StatusCode::PAYLOAD_TOO_LARGE, "Message is too long");
        }

        for participant_id in [auth.user_id, user_id] {
            match load_message_key_row(&state, participant_id, None).await {
                Ok(Some(_)) => {
                    return err(
                        StatusCode::CONFLICT,
                        "End-to-end encryption is required for this conversation",
                    );
                }
                Ok(None) => {}
                Err(resp) => return resp,
            }
        }

        let (ciphertext, nonce, key_id) = match state.message_keys.encrypt_str(&trimmed_message) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = %e, "encrypt outgoing message");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to encrypt message",
                );
            }
        };

        match sqlx::query(
            "INSERT INTO direct_messages (
                 from_user, to_user, message_ciphertext, message_nonce, encryption_key_id,
                 client_message_id, expires_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (from_user, to_user, client_message_id)
                 WHERE client_message_id IS NOT NULL
             DO UPDATE SET client_message_id = EXCLUDED.client_message_id
             RETURNING id, created_at, (xmax = 0) AS inserted",
        )
        .bind(auth.user_id)
        .bind(user_id)
        .bind(&ciphertext)
        .bind(&nonce)
        .bind(&key_id)
        .bind(client_message_id)
        .bind(expires_at)
        .fetch_one(&state.db)
        .await
        {
            Ok(row) => {
                let id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
                let created_at: chrono::DateTime<chrono::Utc> = row
                    .try_get("created_at")
                    .unwrap_or_else(|_| chrono::Utc::now());
                let inserted = row.try_get::<bool, _>("inserted").unwrap_or(true);
                write_message_peer_audit(
                    &state,
                    auth.user_id,
                    "send_message",
                    user_id,
                    json!({
                        "message_id": id,
                        "message_length": trimmed_message.chars().count(),
                        "is_e2e": false,
                        "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
                    }),
                )
                .await;
                if inserted {
                    metrics::counter!(
                        crate::business_metrics::CHAT_MESSAGES_ACCEPTED_TOTAL,
                        "kind" => "text",
                        "e2e" => "false"
                    )
                    .increment(1);
                    create_message_notification(&state, id, auth.user_id, user_id, false).await;
                    publish_message_event(
                        &state,
                        auth.user_id,
                        user_id,
                        "message_created",
                        Some(id),
                    );
                    publish_message_event(
                        &state,
                        user_id,
                        auth.user_id,
                        "message_created",
                        Some(id),
                    );
                }
                Json(serde_json::json!({
                    "ok": true,
                    "id": id,
                    "created_at": created_at.to_rfc3339(),
                    "expires_at": expires_at.map(|value| value.to_rfc3339()),
                    "client_message_id": client_message_id,
                    "duplicate": !inserted,
                    "is_e2e": false,
                }))
                .into_response()
            }
            Err(e) => {
                tracing::error!(error = %e, "send message");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
            }
        }
    }
}

async fn delete_message(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((user_id, message_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, message_id = %message_id, "begin direct message deletion");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete message",
            );
        }
    };
    let row = match sqlx::query(
        r#"WITH target AS (
               SELECT id, attachment_key
                 FROM direct_messages
                WHERE id = $3
                  AND from_user = $1
                  AND to_user = $2
                  AND deleted_at IS NULL
                FOR UPDATE
           ), updated AS (
               UPDATE direct_messages AS dm
                  SET deleted_at = now(),
                      deleted_by = $1,
                      is_read = true,
                      read_at = COALESCE(read_at, now()),
                      message = NULL,
                      message_ciphertext = NULL,
                      message_nonce = NULL,
                      e2e_algorithm = NULL,
                      e2e_ciphertext = NULL,
                      e2e_nonce = NULL,
                      e2e_salt = NULL,
                      sender_key_fingerprint = NULL,
                      recipient_key_fingerprint = NULL,
                      attachment_filename = NULL,
                      attachment_mime = NULL,
                      attachment_size = NULL,
                      attachment_key = NULL,
                      attachment_nonce = NULL,
                      attachment_e2e_algorithm = NULL,
                      attachment_e2e_nonce = NULL,
                      attachment_e2e_salt = NULL
                 FROM target
                WHERE dm.id = target.id
               RETURNING dm.id
           )
           SELECT updated.id, target.attachment_key
             FROM updated
             JOIN target ON true"#,
    )
    .bind(auth.user_id)
    .bind(user_id)
    .bind(message_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(
                StatusCode::NOT_FOUND,
                "Message not found or cannot be deleted",
            );
        }
        Err(error) => {
            tracing::error!(error = %error, message_id = %message_id, "delete direct message");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete message",
            );
        }
    };

    if let Err(error) = delete_message_notifications(&mut tx, message_id).await {
        tracing::error!(error = %error, message_id = %message_id, "delete direct message notifications");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete message",
        );
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, message_id = %message_id, "commit direct message deletion");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete message",
        );
    }

    if let Some(file_key) = row
        .try_get::<Option<String>, _>("attachment_key")
        .ok()
        .flatten()
        .filter(|value| sanitize_filename(value) == *value)
    {
        let path = std::path::Path::new(UPLOAD_DIR).join(file_key);
        if let Err(error) = tokio::fs::remove_file(path).await
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(error = %error, message_id = %message_id, "remove deleted chat attachment");
        }
    }

    write_message_peer_audit(
        &state,
        auth.user_id,
        "delete_message",
        user_id,
        json!({ "message_id": message_id }),
    )
    .await;
    publish_message_event(
        &state,
        auth.user_id,
        user_id,
        "message_deleted",
        Some(message_id),
    );
    publish_message_event(
        &state,
        user_id,
        auth.user_id,
        "message_deleted",
        Some(message_id),
    );

    Json(json!({ "ok": true, "id": message_id })).into_response()
}

/// Upload a file attachment (multipart/form-data).
/// Fields: `file` (required), `message` (optional text).
async fn upload_file(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name = String::new();
    let mut mime_type = String::from("application/octet-stream");
    let mut message_text: Option<String> = None;
    let mut e2e_algorithm: Option<String> = None;
    let mut e2e_ciphertext: Option<String> = None;
    let mut e2e_nonce: Option<String> = None;
    let mut e2e_salt: Option<String> = None;
    let mut attachment_e2e_algorithm: Option<String> = None;
    let mut attachment_e2e_nonce: Option<String> = None;
    let mut attachment_e2e_salt: Option<String> = None;
    let mut sender_key_fingerprint: Option<String> = None;
    let mut recipient_key_fingerprint: Option<String> = None;
    let mut attachment_plaintext_size: Option<i64> = None;
    let mut client_message_id: Option<Uuid> = None;
    let mut expires_in_seconds: Option<i64> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                file_name = field.file_name().unwrap_or("unnamed").to_string();
                if let Some(ct) = field.content_type() {
                    mime_type = ct.to_string();
                }
                match field.bytes().await {
                    Ok(bytes) => {
                        if bytes.len() > MAX_ENCRYPTED_FILE_SIZE {
                            return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 20MB)");
                        }
                        file_data = Some(bytes.to_vec());
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "read file field");
                        return err(StatusCode::BAD_REQUEST, "Failed to read file");
                    }
                }
            }
            "message" => {
                if let Ok(text) = field.text().await {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        message_text = Some(trimmed);
                    }
                }
            }
            "e2e_algorithm" => {
                e2e_algorithm = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "e2e_ciphertext" => {
                e2e_ciphertext = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "e2e_nonce" => {
                e2e_nonce = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "e2e_salt" => {
                e2e_salt = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "attachment_e2e_algorithm" => {
                attachment_e2e_algorithm = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "attachment_e2e_nonce" => {
                attachment_e2e_nonce = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "attachment_e2e_salt" => {
                attachment_e2e_salt = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "sender_key_fingerprint" => {
                sender_key_fingerprint = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "recipient_key_fingerprint" => {
                recipient_key_fingerprint = field
                    .text()
                    .await
                    .ok()
                    .map(|value| value.trim().to_string())
            }
            "attachment_plaintext_size" => {
                attachment_plaintext_size = field
                    .text()
                    .await
                    .ok()
                    .and_then(|value| value.trim().parse::<i64>().ok())
                    .filter(|value| *value > 0);
            }
            "client_message_id" => {
                client_message_id = field
                    .text()
                    .await
                    .ok()
                    .and_then(|value| Uuid::parse_str(value.trim()).ok());
            }
            "expires_in_seconds" => {
                expires_in_seconds = field
                    .text()
                    .await
                    .ok()
                    .and_then(|value| value.trim().parse::<i64>().ok());
            }
            _ => {}
        }
    }

    let data = match file_data {
        Some(d) if !d.is_empty() => d,
        _ => return err(StatusCode::BAD_REQUEST, "No file uploaded"),
    };
    if file_name.len() > MAX_ATTACHMENT_FILENAME_BYTES {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Attachment filename is too long",
        );
    }
    if mime_type.len() > MAX_ATTACHMENT_MIME_BYTES {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Attachment MIME type is too long",
        );
    }
    if message_text
        .as_deref()
        .is_some_and(|value| value.chars().count() > MAX_MESSAGE_CHARS)
    {
        return err(StatusCode::PAYLOAD_TOO_LARGE, "Message is too long");
    }
    let expires_at = match message_expires_at(expires_in_seconds) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if let Some(client_id) = client_message_id {
        match sqlx::query(
            r#"SELECT id, created_at, expires_at,
                      attachment_key, attachment_filename, attachment_mime, attachment_size,
                      attachment_e2e_algorithm
                 FROM direct_messages
                WHERE from_user = $1
                  AND to_user = $2
                  AND client_message_id = $3
                LIMIT 1"#,
        )
        .bind(auth.user_id)
        .bind(user_id)
        .bind(client_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(row)) => {
                return Json(json!({
                    "ok": true,
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                    "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    "expires_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at").ok().flatten().map(|value| value.to_rfc3339()),
                    "client_message_id": client_id,
                    "duplicate": true,
                    "attachment_key": row.try_get::<Option<String>, _>("attachment_key").ok().flatten(),
                    "attachment_filename": row.try_get::<Option<String>, _>("attachment_filename").ok().flatten(),
                    "attachment_mime": row.try_get::<Option<String>, _>("attachment_mime").ok().flatten(),
                    "attachment_size": row.try_get::<Option<i64>, _>("attachment_size").ok().flatten(),
                    "attachment_is_e2e": row.try_get::<Option<String>, _>("attachment_e2e_algorithm").ok().flatten().is_some(),
                }))
                .into_response();
            }
            Ok(None) => {}
            Err(error) => {
                tracing::error!(error = %error, "check duplicate attachment message");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }
    let has_attachment_e2e = attachment_e2e_algorithm
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        || attachment_e2e_nonce
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        || attachment_e2e_salt
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
    let has_caption_e2e = e2e_algorithm
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        || e2e_ciphertext
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        || e2e_nonce
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        || e2e_salt
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
    let mut stored_file_bytes = data.clone();
    let mut stored_attachment_nonce: Option<Vec<u8>> = None;
    let mut stored_attachment_e2e_algorithm: Option<String> = None;
    let mut stored_attachment_e2e_nonce: Option<Vec<u8>> = None;
    let mut stored_attachment_e2e_salt: Option<Vec<u8>> = None;
    let mut stored_encryption_key_id: Option<String> = None;
    let mut msg_ciphertext: Option<Vec<u8>> = None;
    let mut msg_nonce: Option<Vec<u8>> = None;
    let mut msg_e2e_algorithm: Option<String> = None;
    let mut msg_e2e_ciphertext: Option<Vec<u8>> = None;
    let mut msg_e2e_nonce: Option<Vec<u8>> = None;
    let mut msg_e2e_salt: Option<Vec<u8>> = None;
    let mut stored_sender_key_fingerprint: Option<String> = None;
    let mut stored_recipient_key_fingerprint: Option<String> = None;

    if has_attachment_e2e {
        if message_text.is_some() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Mixed plaintext and E2E payloads are not allowed",
            );
        }
        let Some(plaintext_mime_type) = e2e_attachment_mime_type(&file_name) else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Encrypted attachment type is not allowed",
            );
        };
        // The uploaded multipart body is ciphertext and therefore correctly
        // uses application/octet-stream. Derive the post-decryption MIME from
        // the already allowlisted filename instead of trusting client input.
        mime_type = plaintext_mime_type.to_string();

        let Some(attachment_algorithm) = attachment_e2e_algorithm
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid attachment_e2e_algorithm",
            );
        };
        if !is_valid_message_key_algorithm(attachment_algorithm) {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid attachment_e2e_algorithm",
            );
        }
        let Some(sender_fingerprint) = sender_key_fingerprint
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid sender_key_fingerprint",
            );
        };
        let Some(recipient_fingerprint) = recipient_key_fingerprint
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid recipient_key_fingerprint",
            );
        };
        if !is_valid_message_key_fingerprint(sender_fingerprint)
            || !is_valid_message_key_fingerprint(recipient_fingerprint)
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid message key fingerprint",
            );
        }
        let attachment_nonce_bytes = match attachment_e2e_nonce.as_deref() {
            Some(value) => match decode_fixed_base64_message_field(
                value,
                "Invalid attachment_e2e_nonce",
                E2E_NONCE_SIZE,
            ) {
                Ok(bytes) => bytes,
                Err(resp) => return resp,
            },
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid attachment_e2e_nonce",
                );
            }
        };
        let attachment_salt_bytes = match attachment_e2e_salt.as_deref() {
            Some(value) => match decode_fixed_base64_message_field(
                value,
                "Invalid attachment_e2e_salt",
                E2E_SALT_SIZE,
            ) {
                Ok(bytes) => bytes,
                Err(resp) => return resp,
            },
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid attachment_e2e_salt",
                );
            }
        };

        match load_active_message_key_row(&state, auth.user_id, sender_fingerprint).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Sender message key is not active",
                );
            }
            Err(resp) => return resp,
        }
        match load_active_message_key_row(&state, user_id, recipient_fingerprint).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Recipient message key is not active",
                );
            }
            Err(resp) => return resp,
        }

        if has_caption_e2e {
            let Some(caption_algorithm) = e2e_algorithm
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_algorithm");
            };
            if !is_valid_message_key_algorithm(caption_algorithm) {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_algorithm");
            }
            let caption_ciphertext = match e2e_ciphertext.as_deref() {
                Some(value) => match decode_base64_message_field(value, "Invalid e2e_ciphertext") {
                    Ok(bytes) if !bytes.is_empty() && bytes.len() <= MAX_ENCRYPTED_MESSAGE_SIZE => {
                        bytes
                    }
                    Ok(bytes) if bytes.len() > MAX_ENCRYPTED_MESSAGE_SIZE => {
                        return err(StatusCode::PAYLOAD_TOO_LARGE, "Message is too long");
                    }
                    Ok(_) => {
                        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_ciphertext");
                    }
                    Err(resp) => return resp,
                },
                None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_ciphertext"),
            };
            let caption_nonce = match e2e_nonce.as_deref() {
                Some(value) => match decode_fixed_base64_message_field(
                    value,
                    "Invalid e2e_nonce",
                    E2E_NONCE_SIZE,
                ) {
                    Ok(bytes) => bytes,
                    Err(resp) => return resp,
                },
                None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_nonce"),
            };
            let caption_salt = match e2e_salt.as_deref() {
                Some(value) => match decode_fixed_base64_message_field(
                    value,
                    "Invalid e2e_salt",
                    E2E_SALT_SIZE,
                ) {
                    Ok(bytes) => bytes,
                    Err(resp) => return resp,
                },
                None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_salt"),
            };
            msg_e2e_algorithm = Some(E2E_ALGORITHM.to_string());
            msg_e2e_ciphertext = Some(caption_ciphertext);
            msg_e2e_nonce = Some(caption_nonce);
            msg_e2e_salt = Some(caption_salt);
        }

        stored_attachment_e2e_algorithm = Some(E2E_ALGORITHM.to_string());
        stored_attachment_e2e_nonce = Some(attachment_nonce_bytes);
        stored_attachment_e2e_salt = Some(attachment_salt_bytes);
        stored_sender_key_fingerprint = Some(sender_fingerprint.to_string());
        stored_recipient_key_fingerprint = Some(recipient_fingerprint.to_string());
    } else {
        if has_caption_e2e {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "E2E caption requires an E2E attachment envelope",
            );
        }

        for participant_id in [auth.user_id, user_id] {
            match load_message_key_row(&state, participant_id, None).await {
                Ok(Some(_)) => {
                    return err(
                        StatusCode::CONFLICT,
                        "End-to-end encryption is required for this conversation",
                    );
                }
                Ok(None) => {}
                Err(resp) => return resp,
            }
        }

        match validate_upload_magic_bytes(Some(&file_name), Some(mime_type.as_str()), &data) {
            Ok(Some(validated_mime)) => mime_type = validated_mime,
            Ok(None) => {}
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        }
        match scan_upload_bytes(Some(&file_name), &data).await {
            Ok(FileScanOutcome::Clean) => {}
            Ok(FileScanOutcome::Skipped) => {
                tracing::warn!(file_name = %file_name, "virus scanner unavailable; chat attachment scan skipped");
            }
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
        }

        let (file_ciphertext, file_nonce, encryption_key_id) =
            match state.message_keys.encrypt(&data) {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!(error = %e, "encrypt attachment");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to encrypt attachment",
                    );
                }
            };
        stored_file_bytes = file_ciphertext;
        stored_attachment_nonce = Some(file_nonce);
        stored_encryption_key_id = Some(encryption_key_id);

        if let Some(text) = message_text.as_deref().filter(|text| !text.is_empty()) {
            let (caption_ciphertext, caption_nonce, key_id) =
                match state.message_keys.encrypt_str(text) {
                    Ok(value) => value,
                    Err(e) => {
                        tracing::error!(error = %e, "encrypt message caption");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to encrypt caption",
                        );
                    }
                };
            msg_ciphertext = Some(caption_ciphertext);
            msg_nonce = Some(caption_nonce);
            stored_encryption_key_id.get_or_insert(key_id);
        }
    }

    let file_size = if has_attachment_e2e {
        let Some(plaintext_size) = attachment_plaintext_size else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Missing attachment_plaintext_size",
            );
        };
        let expected_ciphertext_size = match usize::try_from(plaintext_size)
            .ok()
            .and_then(|value| value.checked_add(AES_GCM_TAG_SIZE))
        {
            Some(value) => value,
            None => return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 20MB)"),
        };
        if expected_ciphertext_size != data.len() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Encrypted attachment size does not match plaintext size",
            );
        }
        plaintext_size
    } else {
        data.len() as i64
    };
    if file_size > MAX_FILE_SIZE as i64 || data.len() > MAX_ENCRYPTED_FILE_SIZE {
        return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 20MB)");
    }
    let file_key = format!("{}_{}", Uuid::new_v4(), sanitize_filename(&file_name));

    // Serialize quota decisions globally and per uploader so concurrent
    // multipart requests cannot all observe the same remaining capacity.
    let mut storage_tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin chat attachment storage transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
        }
    };
    if let Err(error) = sqlx::query("SELECT pg_advisory_xact_lock(824_202_608_31)")
        .execute(&mut *storage_tx)
        .await
    {
        tracing::error!(error = %error, "lock global chat attachment quota");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
    }
    if let Err(error) = sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 2))")
        .bind(auth.user_id)
        .execute(&mut *storage_tx)
        .await
    {
        tracing::error!(error = %error, user_id = %auth.user_id, "lock user chat attachment quota");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
    }
    let user_used = sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(sum(attachment_size), 0)::bigint
           FROM direct_messages
           WHERE from_user = $1
             AND attachment_key IS NOT NULL"#,
    )
    .bind(auth.user_id)
    .fetch_one(&mut *storage_tx)
    .await;
    let global_used = sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(sum(attachment_size), 0)::bigint
           FROM direct_messages
           WHERE attachment_key IS NOT NULL"#,
    )
    .fetch_one(&mut *storage_tx)
    .await;
    let (user_used, global_used) = match (user_used, global_used) {
        (Ok(user_used), Ok(global_used)) => (user_used, global_used),
        (user_result, global_result) => {
            tracing::error!(user_error = ?user_result.err(), global_error = ?global_result.err(), "measure chat attachment quota");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
        }
    };
    metrics::gauge!(crate::business_metrics::CHAT_ATTACHMENT_STORAGE_BYTES).set(global_used as f64);
    if user_used.saturating_add(file_size) > MAX_CHAT_ATTACHMENT_BYTES_PER_USER {
        return err(
            StatusCode::INSUFFICIENT_STORAGE,
            "Chat attachment quota exceeded",
        );
    }
    if global_used.saturating_add(file_size) > MAX_CHAT_ATTACHMENT_BYTES_GLOBAL {
        return err(
            StatusCode::INSUFFICIENT_STORAGE,
            "Chat storage capacity exceeded",
        );
    }
    let projected_global_used = global_used.saturating_add(file_size);
    if projected_global_used >= MAX_CHAT_ATTACHMENT_BYTES_GLOBAL * 4 / 5 {
        tracing::warn!(
            used_bytes = projected_global_used,
            capacity_bytes = MAX_CHAT_ATTACHMENT_BYTES_GLOBAL,
            "chat attachment storage is above 80 percent capacity"
        );
    }

    // Ensure upload directory exists
    let dir = std::path::Path::new(UPLOAD_DIR);
    if let Err(e) = tokio::fs::create_dir_all(dir).await {
        tracing::error!(error = %e, "create upload dir");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
    }

    // Write encrypted file
    let path = dir.join(&file_key);
    if let Err(e) = tokio::fs::write(&path, &stored_file_bytes).await {
        tracing::error!(error = %e, "write file");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if let Err(e) =
            tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).await
        {
            tracing::error!(error = %e, path = %path.display(), "restrict chat attachment permissions");
            let _ = tokio::fs::remove_file(&path).await;
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
        }
    }

    // Insert message row with encrypted attachment metadata. Legacy
    // attachments use `attachment_nonce`; E2E attachments keep the encrypted
    // payload opaque and store only the client envelope metadata.
    let inserted_row = sqlx::query(
        r#"INSERT INTO direct_messages (
               from_user, to_user,
               message_ciphertext, message_nonce,
               e2e_algorithm, e2e_ciphertext, e2e_nonce, e2e_salt,
               sender_key_fingerprint, recipient_key_fingerprint,
               attachment_filename, attachment_mime, attachment_size, attachment_key,
               attachment_nonce, attachment_e2e_algorithm, attachment_e2e_nonce, attachment_e2e_salt,
               encryption_key_id, client_message_id, expires_at
           )
           VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
           ) RETURNING id, created_at"#,
    )
    .bind(auth.user_id)
    .bind(user_id)
    .bind(msg_ciphertext.as_deref())
    .bind(msg_nonce.as_deref())
    .bind(msg_e2e_algorithm.as_deref())
    .bind(msg_e2e_ciphertext.as_deref())
    .bind(msg_e2e_nonce.as_deref())
    .bind(msg_e2e_salt.as_deref())
    .bind(stored_sender_key_fingerprint.as_deref())
    .bind(stored_recipient_key_fingerprint.as_deref())
    .bind(file_name.as_str())
    .bind(mime_type.as_str())
    .bind(file_size)
    .bind(&file_key)
    .bind(stored_attachment_nonce.as_deref())
    .bind(stored_attachment_e2e_algorithm.as_deref())
    .bind(stored_attachment_e2e_nonce.as_deref())
    .bind(stored_attachment_e2e_salt.as_deref())
    .bind(stored_encryption_key_id.as_deref())
    .bind(client_message_id)
    .bind(expires_at)
    .fetch_one(&mut *storage_tx)
    .await;
    let row = match inserted_row {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, "insert message with attachment");
            let _ = tokio::fs::remove_file(&path).await;
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = storage_tx.commit().await {
        tracing::error!(error = %error, "commit message with attachment");
        let _ = tokio::fs::remove_file(&path).await;
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    metrics::gauge!(crate::business_metrics::CHAT_ATTACHMENT_STORAGE_BYTES)
        .set(projected_global_used as f64);
    metrics::counter!(
        crate::business_metrics::CHAT_MESSAGES_ACCEPTED_TOTAL,
        "kind" => "attachment",
        "e2e" => if has_attachment_e2e { "true" } else { "false" }
    )
    .increment(1);

    {
        let id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
        let created_at: chrono::DateTime<chrono::Utc> = row
            .try_get("created_at")
            .unwrap_or_else(|_| chrono::Utc::now());
        write_message_peer_audit(
            &state,
            auth.user_id,
            "upload_message_attachment",
            user_id,
            json!({
                "message_id": id,
                "attachment_mime": mime_type.as_str(),
                "attachment_size": file_size,
                "has_message_text": message_text.is_some() || msg_e2e_ciphertext.is_some(),
                "is_e2e_attachment": has_attachment_e2e,
                "has_e2e_caption": msg_e2e_ciphertext.is_some(),
                "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
            }),
        )
        .await;
        create_message_notification(&state, id, auth.user_id, user_id, true).await;
        publish_message_event(&state, auth.user_id, user_id, "message_created", Some(id));
        publish_message_event(&state, user_id, auth.user_id, "message_created", Some(id));
        Json(serde_json::json!({
            "ok": true, "id": id, "created_at": created_at.to_rfc3339(),
            "expires_at": expires_at.map(|value| value.to_rfc3339()),
            "client_message_id": client_message_id,
            "duplicate": false,
            "attachment_key": file_key, "attachment_filename": file_name,
            "attachment_mime": mime_type, "attachment_size": file_size,
            "attachment_is_e2e": has_attachment_e2e,
        }))
        .into_response()
    }
}

/// Download a chat file attachment.
async fn download_file(
    Extension(auth): Extension<AuthUser>,
    Path(file_key): Path<String>,
    State(state): State<AppState>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    // Verify the user is a participant of this conversation.
    let row = sqlx::query(
        r#"SELECT id, from_user, to_user, attachment_filename, attachment_mime, attachment_size,
                  attachment_nonce, attachment_e2e_algorithm, encryption_key_id
           FROM direct_messages
           WHERE attachment_key = $1
             AND (from_user = $2 OR to_user = $2)
             AND deleted_at IS NULL
             AND (expires_at IS NULL OR expires_at > now())
           LIMIT 1"#,
    )
    .bind(&file_key)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await;

    let (
        message_id,
        peer_id,
        filename,
        mime,
        attachment_size,
        attachment_nonce,
        attachment_e2e_algorithm,
        key_id,
    ) = match row {
        Ok(Some(r)) => (
            r.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            if r.try_get::<Uuid, _>("from_user")
                .unwrap_or_else(|_| Uuid::nil())
                == auth.user_id
            {
                r.try_get::<Uuid, _>("to_user")
                    .unwrap_or_else(|_| Uuid::nil())
            } else {
                r.try_get::<Uuid, _>("from_user")
                    .unwrap_or_else(|_| Uuid::nil())
            },
            r.try_get::<Option<String>, _>("attachment_filename")
                .unwrap_or_default()
                .unwrap_or_else(|| "file".to_string()),
            r.try_get::<Option<String>, _>("attachment_mime")
                .unwrap_or_default()
                .unwrap_or_else(|| "application/octet-stream".to_string()),
            r.try_get::<Option<i64>, _>("attachment_size")
                .unwrap_or_default()
                .unwrap_or_default(),
            r.try_get::<Option<Vec<u8>>, _>("attachment_nonce")
                .ok()
                .flatten(),
            r.try_get::<Option<String>, _>("attachment_e2e_algorithm")
                .ok()
                .flatten(),
            r.try_get::<Option<String>, _>("encryption_key_id")
                .ok()
                .flatten()
                .unwrap_or_else(|| crate::crypto::LEGACY_KEY_ID.to_string()),
        ),
        _ => return err(StatusCode::NOT_FOUND, "File not found"),
    };

    if let Err(resp) = ensure_message_peer_access(&state, &auth, peer_id).await {
        return resp;
    }

    let path = std::path::Path::new(UPLOAD_DIR).join(&file_key);
    let raw_bytes = match tokio::fs::read(&path).await {
        Ok(d) => d,
        Err(_) => return err(StatusCode::NOT_FOUND, "File not found on disk"),
    };

    // Attachment E2E payloads stay opaque to the backend and are returned as
    // stored. Legacy attachments are decrypted server-side with the at-rest
    // key registry before download.
    let decrypted = if attachment_e2e_algorithm.is_some() {
        raw_bytes
    } else {
        match attachment_nonce.as_deref() {
            Some(nonce) => match state.message_keys.decrypt(&key_id, &raw_bytes, nonce) {
                Ok(bytes) => bytes,
                Err(e) => {
                    tracing::error!(error = %e, file_key = %file_key, key_id = %key_id, "decrypt attachment");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to decrypt attachment",
                    );
                }
            },
            None => {
                tracing::warn!(message_id = %message_id, file_key = %file_key, "blocked legacy plaintext chat attachment download");
                return err(
                    StatusCode::GONE,
                    "Attachment is being migrated to secure storage",
                );
            }
        }
    };

    let body = Body::from(decrypted);
    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));
    write_message_peer_audit(
        &state,
        auth.user_id,
        "download_message_attachment",
        peer_id,
        json!({
            "message_id": message_id,
            "attachment_mime": mime.as_str(),
            "attachment_size": attachment_size,
            "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
        }),
    )
    .await;

    match axum::response::Response::builder()
        .header("content-type", &mime)
        .header("content-disposition", &disposition)
        .body(body)
    {
        Ok(response) => response.into_response(),
        Err(error) => {
            tracing::error!(
                error = %error,
                message_id = %message_id,
                attachment_filename = filename.as_str(),
                "build message attachment download response"
            );
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build attachment download",
            )
        }
    }
}

async fn mark_conversation_read(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, user_id = %auth.user_id, peer_id = %user_id, "begin mark conversation read");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let (marked_read_count, last_read_at) = match sqlx::query(
        "UPDATE direct_messages
         SET is_read = true,
             read_at = COALESCE(read_at, now())
         WHERE from_user = $2
           AND to_user = $1
           AND NOT is_read
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         RETURNING read_at",
    )
    .bind(auth.user_id)
    .bind(user_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => {
            let last_read_at = rows
                .iter()
                .filter_map(|row| {
                    row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("read_at")
                        .ok()
                        .flatten()
                })
                .max()
                .map(|value| value.to_rfc3339());
            (rows.len() as u64, last_read_at)
        }
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, peer_id = %user_id, "mark conversation read");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let notifications_marked_read = match sqlx::query(
        "UPDATE user_notifications
         SET is_read = true
         WHERE user_id = $1
           AND entity_type = 'message_peer'
           AND entity_id = $2
           AND kind IN ('direct_message', 'direct_message_attachment')
           AND NOT is_read",
    )
    .bind(auth.user_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(error) => {
            tracing::error!(error = %error, user_id = %auth.user_id, peer_id = %user_id, "mark message notifications read");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, user_id = %auth.user_id, peer_id = %user_id, "commit mark conversation read");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if marked_read_count > 0 || notifications_marked_read > 0 {
        crate::realtime::publish_notification_event(
            &state,
            auth.user_id,
            "notification.read",
            None,
            json!({
                "entity_type": "message_peer",
                "entity_id": user_id,
                "marked_read_count": notifications_marked_read,
            }),
        )
        .await;
    }
    publish_message_event(&state, auth.user_id, user_id, "conversation_read", None);
    publish_message_event(&state, user_id, auth.user_id, "conversation_read", None);
    write_message_peer_audit(
        &state,
        auth.user_id,
        "read_message_conversation",
        user_id,
        json!({
            "marked_read_count": marked_read_count,
            "last_read_at": last_read_at,
            "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
        }),
    )
    .await;
    Json(serde_json::json!({"ok": true, "marked_read_count": marked_read_count, "last_read_at": last_read_at})).into_response()
}

async fn mark_all_conversations_read(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, user_id = %auth.user_id, "begin mark all conversations read");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let marked_read_count = match sqlx::query(
        r#"UPDATE direct_messages
           SET is_read = true,
               read_at = COALESCE(read_at, now())
           WHERE to_user = $1
             AND NOT is_read
             AND deleted_at IS NULL
             AND (expires_at IS NULL OR expires_at > now())"#,
    )
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(error) => {
            tracing::error!(error = %error, user_id = %auth.user_id, "mark all direct messages read");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let notifications_marked_read = match sqlx::query(
        r#"UPDATE user_notifications
           SET is_read = true
           WHERE user_id = $1
             AND entity_type = 'message_peer'
             AND kind IN ('direct_message', 'direct_message_attachment')
             AND NOT is_read"#,
    )
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(error) => {
            tracing::error!(error = %error, user_id = %auth.user_id, "mark all message notifications read");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, user_id = %auth.user_id, "commit mark all conversations read");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    crate::realtime::publish_notification_event(
        &state,
        auth.user_id,
        "notification.read",
        None,
        json!({
            "entity_type": "message_peer",
            "all_conversations": true,
            "marked_read_count": notifications_marked_read,
        }),
    )
    .await;
    write_message_peer_audit(
        &state,
        auth.user_id,
        "read_all_message_conversations",
        auth.user_id,
        json!({
            "marked_read_count": marked_read_count,
            "notifications_marked_read": notifications_marked_read,
        }),
    )
    .await;

    Json(json!({
        "ok": true,
        "marked_read_count": marked_read_count,
        "notifications_marked_read": notifications_marked_read,
    }))
    .into_response()
}

async fn unread_total(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = ensure_chat_workspace_role(&auth) {
        return resp;
    }
    purge_expired_messages_batch(&state, Some(auth.user_id)).await;
    let count = sqlx::query_scalar::<_, i64>(
        r#"SELECT count(*) AS "c!"
             FROM direct_messages
            WHERE to_user = $1
              AND NOT is_read
              AND deleted_at IS NULL
              AND (expires_at IS NULL OR expires_at > now())"#,
    )
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    Json(serde_json::json!({"count": count})).into_response()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message})),
    )
        .into_response()
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn e2e_attachment_mime_type(name: &str) -> Option<&'static str> {
    let extension = std::path::Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("pdf") => Some("application/pdf"),
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("heic") => Some("image/heic"),
        Some("heif") => Some("image/heif"),
        Some("txt") => Some("text/plain"),
        Some("csv") => Some("text/csv"),
        Some("doc") => Some("application/msword"),
        Some("docx") => {
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        }
        Some("xls") => Some("application/vnd.ms-excel"),
        Some("xlsx") => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Some("dcm") => Some("application/dicom"),
        _ => None,
    }
}

fn parse_role_name(value: &str) -> Option<Role> {
    match value {
        "ceo" => Some(Role::Ceo),
        "ceo_assistant" => Some(Role::CeoAssistant),
        "patient_manager" => Some(Role::PatientManager),
        "teamlead_interpreter" => Some(Role::TeamleadInterpreter),
        "interpreter" => Some(Role::Interpreter),
        "concierge" => Some(Role::Concierge),
        "billing" => Some(Role::Billing),
        "sales" => Some(Role::Sales),
        "it_admin" => Some(Role::ItAdmin),
        "patient" => Some(Role::Patient),
        _ => None,
    }
}

fn can_have_patient_chat(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo
            | Role::CeoAssistant
            | Role::PatientManager
            | Role::TeamleadInterpreter
            | Role::Interpreter
            | Role::Concierge
    )
}

fn can_access_chat_workspace(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo
            | Role::CeoAssistant
            | Role::PatientManager
            | Role::TeamleadInterpreter
            | Role::Interpreter
            | Role::Concierge
            | Role::Billing
            | Role::ItAdmin
            | Role::Patient
    )
}

fn can_message_internal_staff(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo
            | Role::CeoAssistant
            | Role::PatientManager
            | Role::TeamleadInterpreter
            | Role::Interpreter
            | Role::Concierge
            | Role::Billing
            | Role::ItAdmin
    )
}

#[allow(clippy::result_large_err)]
fn ensure_chat_workspace_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    if can_access_chat_workspace(auth.role) {
        return Ok(());
    }
    Err(err(
        StatusCode::FORBIDDEN,
        "Your role cannot access the chat workspace",
    ))
}

async fn resolve_linked_patient_id_for_user(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<Uuid>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT patient_id
           FROM patient_assignments
           WHERE user_id = $1
             AND revoked_at IS NULL
           ORDER BY assigned_at DESC
           LIMIT 2"#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, "resolve linked patient for chat");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate linked patient",
        )
    })?;

    if rows.is_empty() {
        return Ok(None);
    }

    if rows.len() > 1 {
        return Err(err(
            StatusCode::CONFLICT,
            "Patient account is linked to multiple patient records",
        ));
    }

    Ok(Some(
        rows[0]
            .try_get::<Uuid, _>("patient_id")
            .unwrap_or_else(|_| Uuid::nil()),
    ))
}

async fn load_active_peer(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<(String, Role)>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT role
           FROM users
           WHERE id = $1
             AND is_active = true"#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, peer_id = %user_id, "load message peer");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate chat peer",
        )
    })?;

    let Some(row) = row else {
        return Ok(None);
    };
    let role_name = row.try_get::<String, _>("role").unwrap_or_default();
    let Some(role) = parse_role_name(&role_name) else {
        return Ok(None);
    };

    Ok(Some((role_name, role)))
}

async fn can_message_known_peer(
    state: &AppState,
    auth: &AuthUser,
    peer_id: Uuid,
    peer_role: Role,
) -> Result<bool, axum::response::Response> {
    if peer_id == auth.user_id {
        return Ok(false);
    }

    if auth.role == Role::Patient && peer_role == Role::Patient {
        return Ok(false);
    }

    if auth.role == Role::Patient || peer_role == Role::Patient {
        let patient_id = if auth.role == Role::Patient {
            resolve_self_patient_id(state, auth.user_id).await?
        } else if peer_role == Role::Patient {
            match resolve_linked_patient_id_for_user(state, peer_id).await? {
                Some(value) => value,
                None => return Ok(false),
            }
        } else {
            return Ok(false);
        };

        let staff_user_id = if auth.role == Role::Patient {
            if !can_have_patient_chat(peer_role) {
                return Ok(false);
            }
            peer_id
        } else {
            if !can_have_patient_chat(auth.role) {
                return Ok(false);
            }
            auth.user_id
        };

        return has_active_patient_assignment(&state.db, patient_id, staff_user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_id, user_id = %staff_user_id, "check chat assignment");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate chat permissions",
                )
            });
    }

    Ok(can_message_internal_staff(auth.role) && can_message_internal_staff(peer_role))
}

async fn ensure_message_peer_access(
    state: &AppState,
    auth: &AuthUser,
    peer_id: Uuid,
) -> Result<(), axum::response::Response> {
    let Some((_, peer_role)) = load_active_peer(state, peer_id).await? else {
        return Err(err(StatusCode::NOT_FOUND, "Chat peer not found"));
    };

    if !can_message_known_peer(state, auth, peer_id, peer_role).await? {
        return Err(err(
            StatusCode::FORBIDDEN,
            "You cannot exchange messages with this user",
        ));
    }

    Ok(())
}

async fn load_allowed_peer_rows(
    state: &AppState,
    auth: &AuthUser,
    search_pattern: &str,
) -> Result<Vec<sqlx::postgres::PgRow>, axum::response::Response> {
    if auth.role == Role::Patient {
        return sqlx::query(
            r#"SELECT DISTINCT
                    u.id, u.name, u.email, u.role,
                    CASE WHEN u.role IN ('ceo', 'ceo_assistant') THEN 0 ELSE 1 END AS role_sort
               FROM users u
               LEFT JOIN patient_assignments pa
                 ON pa.user_id = u.id
                AND pa.patient_id = $1
                AND pa.revoked_at IS NULL
               WHERE u.is_active = true
                 AND u.id <> $2
                 AND u.role <> 'patient'
                 AND u.role IN (
                    'ceo',
                    'ceo_assistant',
                    'patient_manager',
                    'teamlead_interpreter',
                    'interpreter',
                    'concierge'
                 )
                 AND pa.id IS NOT NULL
                 AND ($3::text = '%%' OR u.name ILIKE $3 OR u.email ILIKE $3)
               ORDER BY role_sort, u.name"#,
        )
        .bind(resolve_self_patient_id(state, auth.user_id).await?)
        .bind(auth.user_id)
        .bind(search_pattern)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %auth.user_id, "load patient chat peers");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load allowed chat peers",
            )
        });
    }

    let mut rows = sqlx::query(
        r#"SELECT id, name, email, role
           FROM users
           WHERE is_active = true
             AND id <> $1
             AND role IN (
                'ceo',
                'ceo_assistant',
                'patient_manager',
                'teamlead_interpreter',
                'interpreter',
                'concierge',
                'billing',
                'it_admin'
             )
             AND ($2::text = '%%' OR name ILIKE $2 OR email ILIKE $2)
            ORDER BY role, name"#,
    )
    .bind(auth.user_id)
    .bind(search_pattern)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %auth.user_id, "load internal chat peers");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load allowed chat peers",
        )
    })?;

    if can_have_patient_chat(auth.role) {
        let patient_rows = sqlx::query(
            r#"SELECT DISTINCT u.id, u.name, u.email, u.role
               FROM patient_assignments pa_staff
               JOIN patient_assignments pa_patient
                 ON pa_patient.patient_id = pa_staff.patient_id
                AND pa_patient.revoked_at IS NULL
               JOIN users u
                 ON u.id = pa_patient.user_id
               WHERE pa_staff.user_id = $1
                 AND pa_staff.revoked_at IS NULL
                 AND u.is_active = true
                 AND u.role = 'patient'
                 AND u.id <> $1
                 AND ($2::text = '%%' OR u.name ILIKE $2 OR u.email ILIKE $2)
               ORDER BY u.name"#,
        )
        .bind(auth.user_id)
        .bind(search_pattern)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %auth.user_id, "load patient chat peers");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load allowed chat peers",
            )
        })?;

        rows.extend(patient_rows);
    }

    Ok(rows)
}

fn rows_to_peer_json(rows: Vec<sqlx::postgres::PgRow>) -> Vec<serde_json::Value> {
    let mut seen = std::collections::HashSet::new();
    let mut peers = Vec::new();

    for row in rows {
        let id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
        if id.is_nil() || !seen.insert(id) {
            continue;
        }
        peers.push(serde_json::json!({
            "id": id,
            "name": row.try_get::<String, _>("name").unwrap_or_default(),
            "email": row.try_get::<String, _>("email").unwrap_or_default(),
            "role": row.try_get::<String, _>("role").unwrap_or_default(),
            "is_active": true,
        }));
    }

    peers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_base64_fields_require_the_exact_decoded_size() {
        let exact_nonce = BASE64.encode([0_u8; E2E_NONCE_SIZE]);
        let short_nonce = BASE64.encode([0_u8; E2E_NONCE_SIZE - 1]);
        let oversized_nonce = BASE64.encode([0_u8; E2E_NONCE_SIZE + 1]);

        assert!(
            decode_fixed_base64_message_field(&exact_nonce, "Invalid e2e_nonce", E2E_NONCE_SIZE,)
                .is_ok()
        );
        assert!(
            decode_fixed_base64_message_field(&short_nonce, "Invalid e2e_nonce", E2E_NONCE_SIZE,)
                .is_err()
        );
        assert!(
            decode_fixed_base64_message_field(
                &oversized_nonce,
                "Invalid e2e_nonce",
                E2E_NONCE_SIZE,
            )
            .is_err()
        );
    }

    #[test]
    fn message_key_fingerprints_are_canonical_sha256_hex() {
        assert!(is_valid_message_key_fingerprint(&"a".repeat(64)));
        assert!(is_valid_message_key_fingerprint(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        ));
        assert!(!is_valid_message_key_fingerprint(&"A".repeat(64)));
        assert!(!is_valid_message_key_fingerprint(&"a".repeat(63)));
        assert!(!is_valid_message_key_fingerprint(&"g".repeat(64)));
    }

    #[test]
    fn encrypted_attachment_mime_is_derived_from_allowlisted_extension() {
        assert_eq!(
            e2e_attachment_mime_type("patient-note.PDF"),
            Some("application/pdf")
        );
        assert_eq!(e2e_attachment_mime_type("scan.jpeg"), Some("image/jpeg"));
        assert_eq!(e2e_attachment_mime_type("payload.html"), None);
        assert_eq!(e2e_attachment_mime_type("no-extension"), None);
    }
}
