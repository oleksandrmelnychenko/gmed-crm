use axum::{
    Json, Router,
    body::Body,
    extract::{Extension, Multipart, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;

const MAX_FILE_SIZE: usize = 20 * 1024 * 1024; // 20 MB
const UPLOAD_DIR: &str = "uploads/chat";

pub fn router() -> Router<AppState> {
    Router::new()
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

async fn list_conversations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    match sqlx::query!(
        r#"WITH latest AS (
            SELECT DISTINCT ON (peer)
                CASE WHEN from_user = $1 THEN to_user ELSE from_user END AS peer,
                message, created_at, is_read,
                CASE WHEN from_user = $1 THEN true ELSE false END AS is_mine,
                attachment_filename
            FROM direct_messages
            WHERE from_user = $1 OR to_user = $1
            ORDER BY peer, created_at DESC
        )
        SELECT l.peer AS "peer!", u.name AS "name!", u.email AS "email!", u.role AS "role!",
               COALESCE(l.message, '') AS "last_message!",
               l.created_at AS "last_at!",
               l.is_read AS "is_read!", l.is_mine AS "is_mine!",
               l.attachment_filename AS "attachment_filename?",
               (SELECT count(*) FROM direct_messages WHERE from_user = l.peer AND to_user = $1 AND NOT is_read) AS "unread!"
        FROM latest l
        JOIN users u ON u.id = l.peer
        ORDER BY l.created_at DESC"#,
        auth.user_id
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    let last_msg = if r.last_message.is_empty() {
                        r.attachment_filename
                            .as_deref()
                            .map(|f| format!("[{}]", f))
                            .unwrap_or_default()
                    } else {
                        r.last_message.clone()
                    };
                    serde_json::json!({
                        "user_id": r.peer, "name": r.name, "email": r.email, "role": r.role,
                        "last_message": last_msg, "last_at": r.last_at,
                        "is_read": r.is_read, "is_mine": r.is_mine, "unread": r.unread,
                    })
                })
                .collect();
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

    match sqlx::query!(
        r#"SELECT id, from_user, to_user, message, is_read, created_at,
                  attachment_filename, attachment_mime, attachment_size, attachment_key
           FROM direct_messages
           WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)
           ORDER BY created_at DESC LIMIT $3"#,
        auth.user_id,
        user_id,
        limit
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.id, "from_user": r.from_user, "to_user": r.to_user,
                        "message": r.message, "is_read": r.is_read, "created_at": r.created_at,
                        "attachment_filename": r.attachment_filename,
                        "attachment_mime": r.attachment_mime,
                        "attachment_size": r.attachment_size,
                        "attachment_key": r.attachment_key,
                    })
                })
                .collect();
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
    message: String,
}

async fn send_message(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<SendReq>,
) -> axum::response::Response {
    if body.message.trim().is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Message is empty");
    }

    match sqlx::query!(
        "INSERT INTO direct_messages (from_user, to_user, message) VALUES ($1, $2, $3) RETURNING id, created_at",
        auth.user_id, user_id, body.message.trim()
    ).fetch_one(&state.db).await {
        Ok(r) => Json(serde_json::json!({"ok": true, "id": r.id, "created_at": r.created_at})).into_response(),
        Err(e) => { tracing::error!(error = %e, "send message"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
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

    let file_size = data.len() as i64;
    let file_key = format!("{}_{}", Uuid::new_v4(), sanitize_filename(&file_name));

    // Ensure upload directory exists
    let dir = std::path::Path::new(UPLOAD_DIR);
    if let Err(e) = tokio::fs::create_dir_all(dir).await {
        tracing::error!(error = %e, "create upload dir");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
    }

    // Write file
    let path = dir.join(&file_key);
    if let Err(e) = tokio::fs::write(&path, &data).await {
        tracing::error!(error = %e, "write file");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error");
    }

    // Insert message row with attachment
    match sqlx::query!(
        r#"INSERT INTO direct_messages (from_user, to_user, message, attachment_filename, attachment_mime, attachment_size, attachment_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at"#,
        auth.user_id,
        user_id,
        message_text.as_deref(),
        file_name,
        mime_type,
        file_size,
        file_key
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => Json(serde_json::json!({
            "ok": true, "id": r.id, "created_at": r.created_at,
            "attachment_key": file_key, "attachment_filename": file_name,
            "attachment_mime": mime_type, "attachment_size": file_size,
        }))
        .into_response(),
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
    // Verify the user is a participant of this conversation
    let row = sqlx::query!(
        r#"SELECT attachment_filename, attachment_mime
           FROM direct_messages
           WHERE attachment_key = $1 AND (from_user = $2 OR to_user = $2)
           LIMIT 1"#,
        file_key,
        auth.user_id
    )
    .fetch_optional(&state.db)
    .await;

    let (filename, mime) = match row {
        Ok(Some(r)) => (
            r.attachment_filename.unwrap_or_else(|| "file".to_string()),
            r.attachment_mime
                .unwrap_or_else(|| "application/octet-stream".to_string()),
        ),
        _ => return err(StatusCode::NOT_FOUND, "File not found"),
    };

    let path = std::path::Path::new(UPLOAD_DIR).join(&file_key);
    let data = match tokio::fs::read(&path).await {
        Ok(d) => d,
        Err(_) => return err(StatusCode::NOT_FOUND, "File not found on disk"),
    };

    let body = Body::from(data);
    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));

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
    let _ = sqlx::query!(
        "UPDATE direct_messages SET is_read = true WHERE from_user = $2 AND to_user = $1 AND NOT is_read",
        auth.user_id, user_id
    )
    .execute(&state.db)
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
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
