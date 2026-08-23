use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    audit,
    auth::middleware::AuthUser,
    file_scan::{FileScanOutcome, scan_upload_bytes},
    file_sniff::validate_upload_magic_bytes,
    routes::documents::{
        read_document_storage_bytes, remove_document_blob, store_document_blob,
    },
    state::AppState,
};
use gmed_domain::role::Role;

const MAX_NOTE_FILE_SIZE: usize = 20 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/internal-notes", get(list_notes).post(create_note))
        .route("/internal-notes/{note_id}", get(get_note))
        .route("/internal-notes/{note_id}/update", post(update_note))
        .route("/internal-notes/{note_id}/archive", post(archive_note))
        .route(
            "/internal-notes/{note_id}/attachments",
            post(upload_attachment),
        )
        .route(
            "/internal-notes/{note_id}/attachments/{attachment_id}/download",
            get(download_attachment),
        )
        .route(
            "/internal-notes/{note_id}/attachments/{attachment_id}/delete",
            post(delete_attachment),
        )
        .layer(DefaultBodyLimit::max(MAX_NOTE_FILE_SIZE + 1024 * 1024))
}

#[derive(Deserialize)]
struct ListNotesQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateNoteRequest {
    title: String,
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateNoteRequest {
    title: String,
    body: Option<String>,
    expected_updated_at: String,
}

async fn list_notes(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListNotesQuery>,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));
    let rows = match sqlx::query(
        r#"SELECT note.id, note.title, note.body, note.created_by, note.updated_by,
                  note.created_at, note.updated_at,
                  creator.name AS created_by_name, editor.name AS updated_by_name,
                  COUNT(attachment.id) AS attachment_count
           FROM internal_notes note
           JOIN users creator ON creator.id = note.created_by
           JOIN users editor ON editor.id = note.updated_by
           LEFT JOIN internal_note_attachments attachment ON attachment.note_id = note.id
           WHERE note.archived_at IS NULL
             AND ($1::text IS NULL OR note.title ILIKE $1 OR COALESCE(note.body, '') ILIKE $1)
           GROUP BY note.id, creator.name, editor.name
           ORDER BY note.updated_at DESC
           LIMIT 500"#,
    )
    .bind(search)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "list internal notes");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load notes");
        }
    };
    Json(rows.iter().filter_map(note_summary_json).collect::<Vec<_>>()).into_response()
}

async fn create_note(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateNoteRequest>,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    let (title, body) = match validate_note_fields(&body.title, body.body.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let note_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO internal_notes (title, body, created_by, updated_by)
           VALUES ($1, $2, $3, $3)
           RETURNING id"#,
    )
    .bind(title)
    .bind(body)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "create internal note");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create note");
        }
    };
    state.audit_sender.try_send(audit::domain_event(
        "create_internal_note",
        Some(auth.user_id),
        "internal_note",
        Some(note_id),
        serde_json::json!({}),
    ));
    match load_note(&state, note_id).await {
        Ok(Some(value)) => (StatusCode::CREATED, Json(value)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => response,
    }
}

async fn get_note(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(note_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    match load_note(&state, note_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => response,
    }
}

async fn update_note(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(note_id): Path<Uuid>,
    Json(body): Json<UpdateNoteRequest>,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    let (title, body_text) = match validate_note_fields(&body.title, body.body.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let expected_updated_at = match chrono::DateTime::parse_from_rfc3339(body.expected_updated_at.trim()) {
        Ok(value) => value.with_timezone(&chrono::Utc),
        Err(_) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid expected_updated_at"),
    };
    let result = match sqlx::query(
        r#"UPDATE internal_notes
           SET title = $2, body = $3, updated_by = $4, updated_at = now()
           WHERE id = $1 AND archived_at IS NULL AND updated_at = $5"#,
    )
    .bind(note_id)
    .bind(title)
    .bind(body_text)
    .bind(auth.user_id)
    .bind(expected_updated_at)
    .execute(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, note_id = %note_id, "update internal note");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update note");
        }
    };
    if result.rows_affected() == 0 {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM internal_notes WHERE id = $1 AND archived_at IS NULL)",
        )
        .bind(note_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        return if exists {
            err(StatusCode::CONFLICT, "Note was changed by another user")
        } else {
            err(StatusCode::NOT_FOUND, "Note not found")
        };
    }
    match load_note(&state, note_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => response,
    }
}

async fn archive_note(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(note_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    let result = match sqlx::query(
        r#"UPDATE internal_notes
           SET archived_at = now(), updated_by = $2, updated_at = now()
           WHERE id = $1 AND archived_at IS NULL"#,
    )
    .bind(note_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, note_id = %note_id, "archive internal note");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to archive note");
        }
    };
    if result.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Note not found");
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn upload_attachment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(note_id): Path<Uuid>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM internal_notes WHERE id = $1 AND archived_at IS NULL)",
    )
    .bind(note_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);
    if !exists {
        return err(StatusCode::NOT_FOUND, "Note not found");
    }

    let mut upload: Option<(String, String, Vec<u8>)> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        let file_name = field.file_name().unwrap_or("file").trim().to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = match field.bytes().await {
            Ok(value) => value,
            Err(_) => return err(StatusCode::BAD_REQUEST, "Failed to read file"),
        };
        if bytes.is_empty() {
            return err(StatusCode::BAD_REQUEST, "File is empty");
        }
        if bytes.len() > MAX_NOTE_FILE_SIZE {
            return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 20MB)");
        }
        upload = Some((file_name, content_type, bytes.to_vec()));
        break;
    }
    let Some((file_name, claimed_mime, data)) = upload else {
        return err(StatusCode::BAD_REQUEST, "No file uploaded");
    };
    if !is_allowed_note_extension(&file_name) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only PDF, images and Word documents are allowed",
        );
    }
    let mime_type = match validate_upload_magic_bytes(
        Some(file_name.as_str()),
        Some(claimed_mime.as_str()),
        &data,
    ) {
        Ok(Some(value)) => value,
        Ok(None) => claimed_mime,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if !is_allowed_note_mime(&mime_type) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only PDF, images and Word documents are allowed",
        );
    }
    match scan_upload_bytes(Some(file_name.as_str()), &data).await {
        Ok(FileScanOutcome::Clean) => {}
        Ok(FileScanOutcome::Skipped) => {
            tracing::warn!(file_name = %file_name, "virus scanner unavailable; note attachment scan skipped");
        }
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    }
    let (encrypted, nonce, key_id) = match state.message_keys.encrypt(&data) {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "encrypt internal note attachment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to encrypt file");
        }
    };
    let (file_size, storage_key, stored_name) = match store_document_blob(&encrypted, &file_name).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let attachment_id = Uuid::new_v4();
    if let Err(error) = sqlx::query(
        r#"INSERT INTO internal_note_attachments (
               id, note_id, file_name, mime_type, file_size, storage_key,
               file_nonce, encryption_key_id, uploaded_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
    )
    .bind(attachment_id)
    .bind(note_id)
    .bind(stored_name)
    .bind(mime_type)
    .bind(data.len() as i64)
    .bind(&storage_key)
    .bind(nonce)
    .bind(key_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %error, note_id = %note_id, "store internal note attachment metadata");
        remove_document_blob(&storage_key).await;
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to attach file");
    }
    let _ = file_size;
    let _ = sqlx::query("UPDATE internal_notes SET updated_at = now(), updated_by = $2 WHERE id = $1")
        .bind(note_id)
        .bind(auth.user_id)
        .execute(&state.db)
        .await;
    match load_note(&state, note_id).await {
        Ok(Some(value)) => (StatusCode::CREATED, Json(value)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => response,
    }
}

async fn download_attachment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((note_id, attachment_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    let row = match sqlx::query(
        r#"SELECT attachment.file_name, attachment.mime_type, attachment.storage_key,
                  attachment.file_nonce, attachment.encryption_key_id
           FROM internal_note_attachments attachment
           JOIN internal_notes note ON note.id = attachment.note_id
           WHERE attachment.id = $1 AND attachment.note_id = $2 AND note.archived_at IS NULL"#,
    )
    .bind(attachment_id)
    .bind(note_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Attachment not found"),
        Err(error) => {
            tracing::error!(error = %error, attachment_id = %attachment_id, "load internal note attachment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to download file");
        }
    };
    let file_name = row.try_get::<String, _>("file_name").unwrap_or_else(|_| "file".to_string());
    let mime_type = row.try_get::<String, _>("mime_type").unwrap_or_else(|_| "application/octet-stream".to_string());
    let storage_key = row.try_get::<String, _>("storage_key").unwrap_or_default();
    let nonce = row.try_get::<Vec<u8>, _>("file_nonce").unwrap_or_default();
    let key_id = row.try_get::<String, _>("encryption_key_id").unwrap_or_default();
    let encrypted = match read_document_storage_bytes(
        note_id,
        &storage_key,
        Some(&mime_type),
        Some(&file_name),
        None,
    )
    .await
    {
        Ok(value) => value,
        Err(_) => return err(StatusCode::NOT_FOUND, "File not found"),
    };
    let decrypted = match state.message_keys.decrypt(&key_id, &encrypted, &nonce) {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, attachment_id = %attachment_id, "decrypt internal note attachment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to decrypt file");
        }
    };
    let disposition = format!("attachment; filename=\"{}\"", file_name.replace('"', ""));
    axum::response::Response::builder()
        .header("content-type", mime_type)
        .header("content-disposition", disposition)
        .body(Body::from(decrypted))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn delete_attachment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((note_id, attachment_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = require_internal_staff(&auth) {
        return response;
    }
    let storage_key = match sqlx::query_scalar::<_, String>(
        r#"DELETE FROM internal_note_attachments
           WHERE id = $1 AND note_id = $2
           RETURNING storage_key"#,
    )
    .bind(attachment_id)
    .bind(note_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Attachment not found"),
        Err(error) => {
            tracing::error!(error = %error, attachment_id = %attachment_id, "delete internal note attachment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete file");
        }
    };
    remove_document_blob(&storage_key).await;
    let _ = sqlx::query("UPDATE internal_notes SET updated_at = now(), updated_by = $2 WHERE id = $1")
        .bind(note_id)
        .bind(auth.user_id)
        .execute(&state.db)
        .await;
    StatusCode::NO_CONTENT.into_response()
}

fn validate_note_fields(
    title: &str,
    body: Option<&str>,
) -> Result<(String, Option<String>), axum::response::Response> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 255 {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Title is required (max 255)"));
    }
    let body = body.map(str::trim).filter(|value| !value.is_empty());
    if body.is_some_and(|value| value.chars().count() > 20_000) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Note is too long"));
    }
    Ok((title.to_string(), body.map(str::to_string)))
}

fn is_allowed_note_extension(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn is_allowed_note_mime(mime: &str) -> bool {
    matches!(
        mime.split(';').next().unwrap_or(mime).trim(),
        "application/pdf"
            | "image/png"
            | "image/jpeg"
            | "image/webp"
            | "application/msword"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/zip"
            | "application/octet-stream"
    )
}

fn note_summary_json(row: &sqlx::postgres::PgRow) -> Option<serde_json::Value> {
    Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok()?,
        "title": row.try_get::<String, _>("title").ok()?,
        "body": row.try_get::<Option<String>, _>("body").unwrap_or_default(),
        "created_by": row.try_get::<Uuid, _>("created_by").ok()?,
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "updated_by": row.try_get::<Uuid, _>("updated_by").ok()?,
        "updated_by_name": row.try_get::<String, _>("updated_by_name").unwrap_or_default(),
        "attachment_count": row.try_get::<i64, _>("attachment_count").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").ok()?.to_rfc3339(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").ok()?.to_rfc3339(),
    }))
}

async fn load_note(
    state: &AppState,
    note_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT note.id, note.title, note.body, note.created_by, note.updated_by,
                  note.created_at, note.updated_at,
                  creator.name AS created_by_name, editor.name AS updated_by_name
           FROM internal_notes note
           JOIN users creator ON creator.id = note.created_by
           JOIN users editor ON editor.id = note.updated_by
           WHERE note.id = $1 AND note.archived_at IS NULL"#,
    )
    .bind(note_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, note_id = %note_id, "load internal note");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load note")
    })?;
    let Some(row) = row else {
        return Ok(None);
    };
    let attachments = sqlx::query(
        r#"SELECT attachment.id, attachment.file_name, attachment.mime_type,
                  attachment.file_size, attachment.uploaded_by, uploader.name AS uploaded_by_name,
                  attachment.created_at
           FROM internal_note_attachments attachment
           JOIN users uploader ON uploader.id = attachment.uploaded_by
           WHERE attachment.note_id = $1
           ORDER BY attachment.created_at"#,
    )
    .bind(note_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, note_id = %note_id, "load internal note attachments");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load note")
    })?;
    Ok(Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok(),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "body": row.try_get::<Option<String>, _>("body").unwrap_or_default(),
        "created_by": row.try_get::<Uuid, _>("created_by").ok(),
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "updated_by": row.try_get::<Uuid, _>("updated_by").ok(),
        "updated_by_name": row.try_get::<String, _>("updated_by_name").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").ok().map(|value| value.to_rfc3339()),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").ok().map(|value| value.to_rfc3339()),
        "attachments": attachments.iter().filter_map(|attachment| Some(serde_json::json!({
            "id": attachment.try_get::<Uuid, _>("id").ok()?,
            "file_name": attachment.try_get::<String, _>("file_name").ok()?,
            "mime_type": attachment.try_get::<String, _>("mime_type").unwrap_or_default(),
            "file_size": attachment.try_get::<i64, _>("file_size").unwrap_or_default(),
            "uploaded_by": attachment.try_get::<Uuid, _>("uploaded_by").ok()?,
            "uploaded_by_name": attachment.try_get::<String, _>("uploaded_by_name").unwrap_or_default(),
            "created_at": attachment.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").ok()?.to_rfc3339(),
        }))).collect::<Vec<_>>(),
    })))
}

#[allow(clippy::result_large_err)]
fn require_internal_staff(auth: &AuthUser) -> Result<(), axum::response::Response> {
    if matches!(
        auth.role,
        Role::Ceo
            | Role::CeoAssistant
            | Role::PatientManager
            | Role::TeamleadInterpreter
            | Role::Interpreter
            | Role::Concierge
            | Role::Billing
            | Role::Sales
            | Role::ItAdmin
    ) {
        return Ok(());
    }
    Err(err(StatusCode::FORBIDDEN, "Internal notes are available to staff only"))
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_supported_note_files() {
        assert!(is_allowed_note_extension("report.PDF"));
        assert!(is_allowed_note_extension("photo.jpeg"));
        assert!(is_allowed_note_extension("brief.docx"));
        assert!(!is_allowed_note_extension("script.exe"));
    }

    #[test]
    fn validates_note_fields() {
        assert!(validate_note_fields("  Übergabe ", Some("Details")).is_ok());
        assert!(validate_note_fields("  ", None).is_err());
    }
}
