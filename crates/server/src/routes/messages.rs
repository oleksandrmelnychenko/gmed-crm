use axum::{
    Json, Router,
    body::Body,
    extract::{
        Extension, Multipart, Path, Query, State, WebSocketUpgrade,
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
use crate::auth::middleware::AuthUser;
use crate::auth::{blacklist, jwt};
use crate::file_scan::{FileScanOutcome, scan_upload_bytes};
use crate::file_sniff::validate_upload_magic_bytes;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

const MAX_FILE_SIZE: usize = 20 * 1024 * 1024; // 20 MB
const UPLOAD_DIR: &str = "uploads/chat";

/// Public alias exposed so other modules (e.g. key rotation) can locate
/// stored chat attachments without duplicating the constant.
pub const CHAT_UPLOAD_DIR: &str = UPLOAD_DIR;
const E2E_ALGORITHM: &str = "p256-hkdf-aes256gcm-v1";

pub fn public_router() -> Router<AppState> {
    Router::new().route("/messages/ws", get(messages_ws))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/messages/e2e-key",
            get(get_my_e2e_key).post(upsert_my_e2e_key),
        )
        .route("/messages/e2e-key/{user_id}", get(get_peer_e2e_key))
        .route("/messages/allowed-peers", get(list_allowed_peers))
        .route("/messages/conversations", get(list_conversations))
        .route(
            "/messages/{user_id}",
            get(get_conversation).post(send_message),
        )
        .route("/messages/{user_id}/upload", post(upload_file))
        .route("/messages/{user_id}/read", post(mark_conversation_read))
        .route("/messages/unread-total", get(unread_total))
        .route("/messages/file/{file_key}", get(download_file))
}

#[derive(Deserialize)]
struct MessageSocketQuery {
    token: String,
}

#[allow(clippy::result_large_err)]
async fn auth_user_from_socket_token(
    state: &AppState,
    token: &str,
) -> Result<AuthUser, axum::response::Response> {
    let Ok(data) = jwt::verify_access_token(state.jwt_secret(), token) else {
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid or expired token"));
    };

    let role = match data.claims.role.as_str() {
        "ceo" => Role::Ceo,
        "ceo_assistant" => Role::CeoAssistant,
        "patient_manager" => Role::PatientManager,
        "teamlead_interpreter" => Role::TeamleadInterpreter,
        "interpreter" => Role::Interpreter,
        "concierge" => Role::Concierge,
        "billing" => Role::Billing,
        "sales" => Role::Sales,
        "it_admin" => Role::ItAdmin,
        "patient" => Role::Patient,
        _ => {
            return Err(err(StatusCode::UNAUTHORIZED, "Invalid or expired token"));
        }
    };

    match blacklist::is_revoked(&state.db, data.claims.jti).await {
        Ok(true) => return Err(err(StatusCode::UNAUTHORIZED, "Invalid or expired token")),
        Err(e) => {
            tracing::error!(error = %e, jti = %data.claims.jti, "check websocket token revocation");
            return Err(err(StatusCode::UNAUTHORIZED, "Invalid or expired token"));
        }
        Ok(false) => {}
    }
    match blacklist::is_family_revoked(&state.db, data.claims.fam).await {
        Ok(true) => return Err(err(StatusCode::UNAUTHORIZED, "Invalid or expired token")),
        Err(e) => {
            tracing::error!(error = %e, family_id = %data.claims.fam, "check websocket token family revocation");
            return Err(err(StatusCode::UNAUTHORIZED, "Invalid or expired token"));
        }
        Ok(false) => {}
    }

    Ok(AuthUser {
        user_id: data.claims.sub,
        role,
        family_id: data.claims.fam,
        access_token_jti: data.claims.jti,
        access_token_expires_at: chrono::DateTime::<chrono::Utc>::from_timestamp(
            data.claims.exp,
            0,
        )
        .unwrap_or_else(chrono::Utc::now),
    })
}

async fn messages_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<MessageSocketQuery>,
) -> axum::response::Response {
    let auth = match auth_user_from_socket_token(&state, query.token.trim()).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    ws.on_upgrade(move |socket| handle_messages_ws(socket, state, auth.user_id))
        .into_response()
}

async fn handle_messages_ws(mut socket: WebSocket, state: AppState, user_id: Uuid) {
    let mut receiver = state.message_events.subscribe();
    let user_id_string = user_id.to_string();

    while let Ok(event) = receiver.recv().await {
        let Some(target_user_id) = event.get("user_id").and_then(Value::as_str) else {
            continue;
        };
        if target_user_id != user_id_string {
            continue;
        }

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

fn truncate_notification_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut out = String::new();
    for (idx, ch) in trimmed.chars().enumerate() {
        if idx >= max_chars {
            out.push_str("...");
            return out;
        }
        out.push(ch);
    }
    out
}

async fn create_message_notification(
    state: &AppState,
    from_user: Uuid,
    to_user: Uuid,
    message: Option<&str>,
    attachment_filename: Option<&str>,
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

    let kind = if attachment_filename.is_some() {
        "direct_message_attachment"
    } else {
        "direct_message"
    };
    let title = if attachment_filename.is_some() {
        format!("New file from {sender_name}")
    } else {
        format!("New message from {sender_name}")
    };
    let body = match (
        message.map(str::trim).filter(|value| !value.is_empty()),
        attachment_filename,
    ) {
        (Some(message), Some(filename)) => {
            format!("{} [{filename}]", truncate_notification_text(message, 120))
        }
        (Some(message), None) => truncate_notification_text(message, 140),
        (None, Some(filename)) => format!("Attachment: {filename}"),
        (None, None) => "Open chat".to_string(),
    };

    let _ = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           VALUES ($1, $2, $3, $4, 'message_peer', $5)"#,
    )
    .bind(to_user)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(from_user)
    .execute(&state.db)
    .await;
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

async fn list_allowed_peers(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<AllowedPeersQuery>,
) -> axum::response::Response {
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
    if !is_valid_message_key_algorithm(&body.algorithm) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid message key algorithm",
        );
    }
    let public_key = match decode_base64_message_field(&body.public_key, "Invalid public_key") {
        Ok(value) if !value.is_empty() => value,
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
            WHERE from_user = $1 OR to_user = $1
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
               (SELECT count(*) FROM direct_messages WHERE from_user = l.peer AND to_user = $1 AND NOT is_read) AS unread
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
}

async fn get_conversation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<PaginationQuery>,
) -> axum::response::Response {
    let limit = q.limit.unwrap_or(50).min(200);
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    match sqlx::query(
        r#"SELECT id, from_user, to_user, message, message_ciphertext, message_nonce, encryption_key_id,
                  e2e_algorithm, e2e_ciphertext, e2e_nonce, e2e_salt,
                  sender_key_fingerprint, recipient_key_fingerprint,
                  is_read, read_at, created_at,
                  attachment_filename, attachment_mime, attachment_size, attachment_key
           FROM direct_messages
           WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)
           ORDER BY created_at DESC LIMIT $3"#,
    )
    .bind(auth.user_id)
    .bind(user_id)
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
                        "attachment_filename": r.try_get::<Option<String>, _>("attachment_filename").unwrap_or_default(),
                        "attachment_mime": r.try_get::<Option<String>, _>("attachment_mime").unwrap_or_default(),
                        "attachment_size": r.try_get::<Option<i64>, _>("attachment_size").unwrap_or_default(),
                        "attachment_key": r.try_get::<Option<String>, _>("attachment_key").unwrap_or_default(),
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
    e2e_algorithm: Option<String>,
    e2e_ciphertext: Option<String>,
    e2e_nonce: Option<String>,
    e2e_salt: Option<String>,
    sender_key_fingerprint: Option<String>,
    recipient_key_fingerprint: Option<String>,
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
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    let trimmed_message = body
        .message
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
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

        let ciphertext = match body.e2e_ciphertext.as_deref() {
            Some(value) => match decode_base64_message_field(value, "Invalid e2e_ciphertext") {
                Ok(bytes) if !bytes.is_empty() => bytes,
                Ok(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_ciphertext"),
                Err(resp) => return resp,
            },
            None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_ciphertext"),
        };
        let nonce = match body.e2e_nonce.as_deref() {
            Some(value) => match decode_base64_message_field(value, "Invalid e2e_nonce") {
                Ok(bytes) if bytes.len() == 12 => bytes,
                Ok(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_nonce"),
                Err(resp) => return resp,
            },
            None => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_nonce"),
        };
        let salt = match body.e2e_salt.as_deref() {
            Some(value) => match decode_base64_message_field(value, "Invalid e2e_salt") {
                Ok(bytes) if !bytes.is_empty() => bytes,
                Ok(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid e2e_salt"),
                Err(resp) => return resp,
            },
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
        match load_message_key_row(&state, user_id, Some(recipient_key_fingerprint)).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Recipient message key not found",
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
                   recipient_key_fingerprint
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id, created_at"#,
        )
        .bind(auth.user_id)
        .bind(user_id)
        .bind(E2E_ALGORITHM)
        .bind(&ciphertext)
        .bind(&nonce)
        .bind(&salt)
        .bind(sender_key_fingerprint)
        .bind(recipient_key_fingerprint)
        .fetch_one(&state.db)
        .await
        {
            Ok(row) => {
                let id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
                let created_at: chrono::DateTime<chrono::Utc> = row
                    .try_get("created_at")
                    .unwrap_or_else(|_| chrono::Utc::now());
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
                create_message_notification(
                    &state,
                    auth.user_id,
                    user_id,
                    Some("[Encrypted message]"),
                    None,
                )
                .await;
                publish_message_event(&state, auth.user_id, user_id, "message_created", Some(id));
                publish_message_event(&state, user_id, auth.user_id, "message_created", Some(id));
                Json(serde_json::json!({
                    "ok": true,
                    "id": id,
                    "created_at": created_at.to_rfc3339(),
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
            "INSERT INTO direct_messages (from_user, to_user, message_ciphertext, message_nonce, encryption_key_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, created_at",
        )
        .bind(auth.user_id)
        .bind(user_id)
        .bind(&ciphertext)
        .bind(&nonce)
        .bind(&key_id)
        .fetch_one(&state.db)
        .await
        {
            Ok(row) => {
                let id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
                let created_at: chrono::DateTime<chrono::Utc> = row
                    .try_get("created_at")
                    .unwrap_or_else(|_| chrono::Utc::now());
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
                create_message_notification(
                    &state,
                    auth.user_id,
                    user_id,
                    Some(trimmed_message.as_str()),
                    None,
                )
                .await;
                publish_message_event(&state, auth.user_id, user_id, "message_created", Some(id));
                publish_message_event(&state, user_id, auth.user_id, "message_created", Some(id));
                Json(serde_json::json!({
                    "ok": true,
                    "id": id,
                    "created_at": created_at.to_rfc3339(),
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

/// Upload a file attachment (multipart/form-data).
/// Fields: `file` (required), `message` (optional text).
async fn upload_file(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name = String::new();
    let mut mime_type = String::from("application/octet-stream");
    let mut message_text: Option<String> = None;

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
                        if bytes.len() > MAX_FILE_SIZE {
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
            _ => {}
        }
    }

    let data = match file_data {
        Some(d) if !d.is_empty() => d,
        _ => return err(StatusCode::BAD_REQUEST, "No file uploaded"),
    };

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

    let file_size = data.len() as i64;
    let file_key = format!("{}_{}", Uuid::new_v4(), sanitize_filename(&file_name));

    // Encrypt file body before writing to disk. The same active key id is
    // reused for the optional caption below.
    let (file_ciphertext, file_nonce, encryption_key_id) = match state.message_keys.encrypt(&data) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "encrypt attachment");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to encrypt attachment",
            );
        }
    };

    // Ensure upload directory exists
    let dir = std::path::Path::new(UPLOAD_DIR);
    if let Err(e) = tokio::fs::create_dir_all(dir).await {
        tracing::error!(error = %e, "create upload dir");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
    }

    // Write encrypted file
    let path = dir.join(&file_key);
    if let Err(e) = tokio::fs::write(&path, &file_ciphertext).await {
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

    // Encrypt optional message text. Note the caption uses whatever the
    // active key is at that instant — that is always equal to the file's key
    // because both run under the same registry inside one request.
    let (msg_ciphertext, msg_nonce) = match message_text.as_deref() {
        Some(text) if !text.is_empty() => match state.message_keys.encrypt_str(text) {
            Ok((ct, n, _)) => (Some(ct), Some(n)),
            Err(e) => {
                tracing::error!(error = %e, "encrypt message caption");
                let _ = tokio::fs::remove_file(&path).await;
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to encrypt caption",
                );
            }
        },
        _ => (None, None),
    };

    // Insert message row with encrypted attachment metadata.
    // `attachment_nonce` stores the nonce for file body decryption.
    match sqlx::query(
        r#"INSERT INTO direct_messages (
               from_user, to_user,
               message_ciphertext, message_nonce,
               attachment_filename, attachment_mime, attachment_size, attachment_key, attachment_nonce,
               encryption_key_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at"#,
    )
    .bind(auth.user_id)
    .bind(user_id)
    .bind(msg_ciphertext.as_deref())
    .bind(msg_nonce.as_deref())
    .bind(file_name.as_str())
    .bind(mime_type.as_str())
    .bind(file_size)
    .bind(&file_key)
    .bind(&file_nonce)
    .bind(&encryption_key_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
            let created_at: chrono::DateTime<chrono::Utc> =
                row.try_get("created_at").unwrap_or_else(|_| chrono::Utc::now());
            write_message_peer_audit(
                &state,
                auth.user_id,
                "upload_message_attachment",
                user_id,
                json!({
                    "message_id": id,
                    "attachment_filename": file_name.as_str(),
                    "attachment_mime": mime_type.as_str(),
                    "attachment_size": file_size,
                    "has_message_text": message_text.is_some(),
                    "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
                }),
            )
            .await;
            create_message_notification(
                &state,
                auth.user_id,
                user_id,
                message_text.as_deref(),
                Some(&file_name),
            )
            .await;
            publish_message_event(&state, auth.user_id, user_id, "message_created", Some(id));
            publish_message_event(&state, user_id, auth.user_id, "message_created", Some(id));
            Json(serde_json::json!({
                "ok": true, "id": id, "created_at": created_at.to_rfc3339(),
                "attachment_key": file_key, "attachment_filename": file_name,
                "attachment_mime": mime_type, "attachment_size": file_size,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "insert message with attachment");
            // Clean up file on DB failure
            let _ = tokio::fs::remove_file(&path).await;
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

/// Download a chat file attachment.
async fn download_file(
    Extension(auth): Extension<AuthUser>,
    Path(file_key): Path<String>,
    State(state): State<AppState>,
) -> axum::response::Response {
    // Verify the user is a participant of this conversation.
    let row = sqlx::query(
        r#"SELECT id, from_user, to_user, attachment_filename, attachment_mime, attachment_size, attachment_nonce, encryption_key_id
           FROM direct_messages
           WHERE attachment_key = $1 AND (from_user = $2 OR to_user = $2)
           LIMIT 1"#,
    )
    .bind(&file_key)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await;

    let (message_id, peer_id, filename, mime, attachment_size, attachment_nonce, key_id) = match row
    {
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

    // Decrypt if the file was stored with a nonce (new attachments).
    // Legacy plaintext attachments fall through unchanged.
    let decrypted = match attachment_nonce.as_deref() {
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
        None => raw_bytes,
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
            "attachment_filename": filename.as_str(),
            "attachment_mime": mime.as_str(),
            "attachment_size": attachment_size,
            "is_ceo_access": matches!(auth.role, Role::Ceo | Role::CeoAssistant),
        }),
    )
    .await;

    axum::response::Response::builder()
        .header("content-type", &mime)
        .header("content-disposition", &disposition)
        .body(body)
        .unwrap()
        .into_response()
}

async fn mark_conversation_read(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = ensure_message_peer_access(&state, &auth, user_id).await {
        return resp;
    }

    let (marked_read_count, last_read_at) = match sqlx::query(
        "UPDATE direct_messages
         SET is_read = true,
             read_at = COALESCE(read_at, now())
         WHERE from_user = $2
           AND to_user = $1
           AND NOT is_read
         RETURNING read_at",
    )
    .bind(auth.user_id)
    .bind(user_id)
    .fetch_all(&state.db)
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
            (0, None)
        }
    };
    let _ = sqlx::query(
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
    .execute(&state.db)
    .await;
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

async fn unread_total(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    let count = sqlx::query_scalar!(
        r#"SELECT count(*) AS "c!" FROM direct_messages WHERE to_user = $1 AND NOT is_read"#,
        auth.user_id
    )
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

    Ok(true)
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
            r#"SELECT DISTINCT u.id, u.name, u.email, u.role
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
               ORDER BY
                 CASE WHEN u.role IN ('ceo', 'ceo_assistant') THEN 0 ELSE 1 END,
                 u.name"#,
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
             AND role <> 'patient'
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
