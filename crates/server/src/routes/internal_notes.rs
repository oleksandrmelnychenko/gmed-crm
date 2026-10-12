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
    routes::documents::{read_document_storage_bytes, remove_document_blob, store_document_blob},
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
        .route("/internal-notes/{note_id}/restore", post(restore_note))
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
    /// `true` lists the archived notes the reader may restore (own notes;
    /// the CEO: every note) instead of the live ones.
    #[serde(default)]
    archived: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateNoteRequest {
    title: String,
    body: Option<String>,
    /// `private` (default), `role` or `staff`.
    #[serde(default)]
    visibility: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateNoteRequest {
    title: String,
    body: Option<String>,
    expected_updated_at: String,
    /// Omitted keeps the current visibility; only the author (or the CEO)
    /// changes it.
    #[serde(default)]
    visibility: Option<String>,
}

/// Who reads a note, chosen by its author (owner decision 2026-10-12, QA
/// E-23): only the author, the author's role or all staff. The CEO reads
/// every note.
///
/// The choice is always relative to the AUTHOR, whoever saves it (QA E3-02):
/// `private` = the author alone, `role` = everyone holding the author's role
/// (stored in `visible_role` when the note is shared that way), `staff` = all
/// staff. When the CEO changes the visibility of someone else's note, `role`
/// therefore opens it to the author's colleagues, never to the CEO's role,
/// and `private` gives it back to the author alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NoteVisibility {
    Private,
    Role,
    Staff,
}

impl NoteVisibility {
    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "private" => Some(Self::Private),
            "role" => Some(Self::Role),
            "staff" => Some(Self::Staff),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Role => "role",
            Self::Staff => "staff",
        }
    }
}

/// The visibility of a stored note, as the read checks need it.
struct NoteAccess {
    created_by: Uuid,
    visibility: NoteVisibility,
    visible_role: Option<String>,
}

/// SQL condition "the reader may see `note`" — binds: viewer id, viewer role
/// code, full access.
fn visible_note_condition(viewer: usize, role: usize, full: usize) -> String {
    format!(
        "(${full}::bool OR note.visibility = 'staff' OR note.created_by = ${viewer} \
          OR (note.visibility = 'role' AND note.visible_role = ${role}::text))"
    )
}

fn can_read_note(auth: &AuthUser, note: &NoteAccess) -> bool {
    auth.role.has_full_access()
        || note.created_by == auth.user_id
        || match note.visibility {
            NoteVisibility::Staff => true,
            NoteVisibility::Role => note.visible_role.as_deref() == Some(role_code(auth.role)),
            NoteVisibility::Private => false,
        }
}

/// The author or the CEO: decides who reads a note, archives and restores
/// it. Other readers may only edit the text and the files (QA E3-03).
fn can_manage_note(auth: &AuthUser, created_by: Uuid) -> bool {
    auth.role.has_full_access() || created_by == auth.user_id
}

fn can_change_visibility(auth: &AuthUser, note: &NoteAccess) -> bool {
    can_manage_note(auth, note.created_by)
}

/// The CEO Assistant reads every note it may see but writes none (owner
/// rule: the assistant is read-only outside the task manager and the CEO's
/// appointments, QA E3-03).
fn can_write_notes(role: Role) -> bool {
    role != Role::CeoAssistant
}

#[allow(clippy::result_large_err)]
fn require_note_writer(auth: &AuthUser) -> Result<(), axum::response::Response> {
    require_internal_staff(auth)?;
    if can_write_notes(auth.role) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "note_read_only_role"))
    }
}

#[allow(clippy::result_large_err)]
fn parse_visibility(
    value: Option<&str>,
) -> Result<Option<NoteVisibility>, axum::response::Response> {
    match value {
        None => Ok(None),
        Some(value) => NoteVisibility::parse(value)
            .map(Some)
            .ok_or_else(|| err(StatusCode::UNPROCESSABLE_ENTITY, "note_visibility_invalid")),
    }
}

/// The live note's visibility, or `None` when it does not exist, is
/// archived or is hidden from the reader (answered like a missing note).
async fn readable_note(
    state: &AppState,
    auth: &AuthUser,
    note_id: Uuid,
) -> Result<Option<NoteAccess>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT created_by, visibility, visible_role
           FROM internal_notes
           WHERE id = $1 AND archived_at IS NULL"#,
    )
    .bind(note_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, note_id = %note_id, "load internal note visibility");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load note")
    })?;
    let Some(row) = row else {
        return Ok(None);
    };
    let note = NoteAccess {
        created_by: row.try_get("created_by").unwrap_or_else(|_| Uuid::nil()),
        visibility: row
            .try_get::<String, _>("visibility")
            .ok()
            .and_then(|value| NoteVisibility::parse(&value))
            .unwrap_or(NoteVisibility::Private),
        visible_role: row.try_get("visible_role").unwrap_or_default(),
    };
    Ok(can_read_note(auth, &note).then_some(note))
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
    // Hidden notes are filtered in SQL, so the search never finds them. The
    // archive lists what the reader may restore: own notes, the CEO all.
    let archived = query.archived.unwrap_or(false);
    let (state_filter, order) = if archived {
        (
            "note.archived_at IS NOT NULL AND ($4::bool OR note.created_by = $2) AND $3::text IS NOT NULL"
                .to_string(),
            "note.archived_at DESC",
        )
    } else {
        (
            format!(
                "note.archived_at IS NULL AND {}",
                visible_note_condition(2, 3, 4)
            ),
            "note.updated_at DESC",
        )
    };
    let sql = format!(
        r#"SELECT note.id, note.title, note.body, note.created_by, note.updated_by,
                  note.created_at, note.updated_at, note.archived_at,
                  note.visibility, note.visible_role,
                  creator.name AS created_by_name, creator.role::text AS created_by_role,
                  editor.name AS updated_by_name,
                  COUNT(attachment.id) AS attachment_count
           FROM internal_notes note
           JOIN users creator ON creator.id = note.created_by
           JOIN users editor ON editor.id = note.updated_by
           LEFT JOIN internal_note_attachments attachment ON attachment.note_id = note.id
           WHERE {state_filter}
             AND ($1::text IS NULL OR note.title ILIKE $1 OR COALESCE(note.body, '') ILIKE $1)
           GROUP BY note.id, creator.name, creator.role, editor.name
           ORDER BY {order}
           LIMIT 500"#,
    );
    let rows = match sqlx::query(&sql)
        .bind(search)
        .bind(auth.user_id)
        .bind(role_code(auth.role))
        .bind(auth.role.has_full_access())
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "list internal notes");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load notes");
        }
    };
    Json(
        rows.iter()
            .filter_map(note_summary_json)
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn create_note(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateNoteRequest>,
) -> axum::response::Response {
    if let Err(response) = require_note_writer(&auth) {
        return response;
    }
    let visibility = match parse_visibility(body.visibility.as_deref()) {
        Ok(value) => value.unwrap_or(NoteVisibility::Private),
        Err(response) => return response,
    };
    let (title, body) = match validate_note_fields(&body.title, body.body.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let note_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO internal_notes (title, body, created_by, updated_by, visibility, visible_role)
           VALUES ($1, $2, $3, $3, $4, CASE WHEN $4 = 'role' THEN $5 END)
           RETURNING id"#,
    )
    .bind(title)
    .bind(body)
    .bind(auth.user_id)
    .bind(visibility.as_str())
    .bind(role_code(auth.role))
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
        serde_json::json!({ "visibility": visibility.as_str() }),
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
    match readable_note(&state, &auth, note_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => return response,
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
    if let Err(response) = require_note_writer(&auth) {
        return response;
    }
    let requested_visibility = match parse_visibility(body.visibility.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let current = match readable_note(&state, &auth, note_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => return response,
    };
    // Only the author (or the CEO) decides who reads the note.
    let visibility = match requested_visibility {
        Some(value) if value != current.visibility => {
            if !can_change_visibility(&auth, &current) {
                return err(StatusCode::FORBIDDEN, "note_visibility_author_only");
            }
            value
        }
        _ => current.visibility,
    };
    let (title, body_text) = match validate_note_fields(&body.title, body.body.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let expected_updated_at =
        match chrono::DateTime::parse_from_rfc3339(body.expected_updated_at.trim()) {
            Ok(value) => value.with_timezone(&chrono::Utc),
            Err(_) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid expected_updated_at",
                );
            }
        };
    // "My role" is the author's role; it stays as shared until the
    // visibility changes again.
    let result = match sqlx::query(
        r#"UPDATE internal_notes
           SET title = $2, body = $3, updated_by = $4, updated_at = now(),
               visibility = $6,
               visible_role = CASE
                   WHEN $6 <> 'role' THEN NULL
                   WHEN visibility = 'role' THEN visible_role
                   ELSE (SELECT author.role FROM users author WHERE author.id = internal_notes.created_by)
               END
           WHERE id = $1 AND archived_at IS NULL AND updated_at = $5"#,
    )
    .bind(note_id)
    .bind(title)
    .bind(body_text)
    .bind(auth.user_id)
    .bind(expected_updated_at)
    .bind(visibility.as_str())
    .execute(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, note_id = %note_id, "update internal note");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update note");
        }
    };
    if result.rows_affected() > 0 && visibility != current.visibility {
        state.audit_sender.try_send(audit::domain_event(
            "update_internal_note_visibility",
            Some(auth.user_id),
            "internal_note",
            Some(note_id),
            serde_json::json!({
                "from": current.visibility.as_str(),
                "to": visibility.as_str(),
            }),
        ));
    }
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
    if let Err(response) = require_note_writer(&auth) {
        return response;
    }
    let current = match readable_note(&state, &auth, note_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => return response,
    };
    // A colleague who reads a shared note does not take it away from the
    // others; only the author or the CEO archives it (QA E3-03).
    if !can_manage_note(&auth, current.created_by) {
        return err(StatusCode::FORBIDDEN, "note_archive_author_only");
    }
    match set_note_archived(&state, &auth, note_id, true).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => response,
    }
}

/// Brings an archived note back (QA E3-03): the author or the CEO; for
/// everyone else an archived note does not exist.
async fn restore_note(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(note_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_note_writer(&auth) {
        return response;
    }
    let author = match sqlx::query_scalar::<_, Uuid>(
        "SELECT created_by FROM internal_notes WHERE id = $1 AND archived_at IS NOT NULL",
    )
    .bind(note_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, note_id = %note_id, "load archived internal note");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load note");
        }
    };
    match author {
        Some(author) if can_manage_note(&auth, author) => {}
        _ => return err(StatusCode::NOT_FOUND, "Note not found"),
    }
    match set_note_archived(&state, &auth, note_id, false).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => return response,
    }
    match load_note(&state, note_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => response,
    }
}

/// Archives (`archive = true`) or restores a note together with its audit
/// row (`archive_internal_note` / `restore_internal_note`) in one
/// transaction. `Ok(false)` when the note was not in the expected state.
async fn set_note_archived(
    state: &AppState,
    auth: &AuthUser,
    note_id: Uuid,
    archive: bool,
) -> Result<bool, axum::response::Response> {
    let failed = move |error: sqlx::Error| {
        tracing::error!(error = %error, note_id = %note_id, archive, "archive or restore internal note");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            if archive {
                "Failed to archive note"
            } else {
                "Failed to restore note"
            },
        )
    };
    let mut tx = state.db.begin().await.map_err(failed)?;
    let row = sqlx::query(
        r#"UPDATE internal_notes
           SET archived_at = CASE WHEN $3 THEN now() END,
               updated_by = $2, updated_at = now()
           WHERE id = $1 AND (archived_at IS NULL) = $3
           RETURNING created_by, visibility"#,
    )
    .bind(note_id)
    .bind(auth.user_id)
    .bind(archive)
    .fetch_optional(&mut *tx)
    .await
    .map_err(failed)?;
    let Some(row) = row else {
        return Ok(false);
    };
    let created_by: Uuid = row.try_get("created_by").map_err(failed)?;
    let visibility: String = row.try_get("visibility").map_err(failed)?;
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            if archive {
                "archive_internal_note"
            } else {
                "restore_internal_note"
            },
            Some(auth.user_id),
            "internal_note",
            Some(note_id),
            serde_json::json!({
                "visibility": visibility,
                "by_author": created_by == auth.user_id,
            }),
        ),
    )
    .await
    .map_err(failed)?;
    tx.commit().await.map_err(failed)?;
    Ok(true)
}

async fn upload_attachment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(note_id): Path<Uuid>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(response) = require_note_writer(&auth) {
        return response;
    }
    match readable_note(&state, &auth, note_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Note not found"),
        Err(response) => return response,
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
    let (file_size, storage_key, stored_name) =
        match store_document_blob(&encrypted, &file_name).await {
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
    let _ =
        sqlx::query("UPDATE internal_notes SET updated_at = now(), updated_by = $2 WHERE id = $1")
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
    match readable_note(&state, &auth, note_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Attachment not found"),
        Err(response) => return response,
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
    let file_name = row
        .try_get::<String, _>("file_name")
        .unwrap_or_else(|_| "file".to_string());
    let mime_type = row
        .try_get::<String, _>("mime_type")
        .unwrap_or_else(|_| "application/octet-stream".to_string());
    let storage_key = row.try_get::<String, _>("storage_key").unwrap_or_default();
    let nonce = row.try_get::<Vec<u8>, _>("file_nonce").unwrap_or_default();
    let key_id = row
        .try_get::<String, _>("encryption_key_id")
        .unwrap_or_default();
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
    if let Err(response) = require_note_writer(&auth) {
        return response;
    }
    match readable_note(&state, &auth, note_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Attachment not found"),
        Err(response) => return response,
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
    let _ =
        sqlx::query("UPDATE internal_notes SET updated_at = now(), updated_by = $2 WHERE id = $1")
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
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Title is required (max 255)",
        ));
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
        "created_by_role": row.try_get::<Option<String>, _>("created_by_role").unwrap_or_default(),
        "updated_by": row.try_get::<Uuid, _>("updated_by").ok()?,
        "updated_by_name": row.try_get::<String, _>("updated_by_name").unwrap_or_default(),
        "attachment_count": row.try_get::<i64, _>("attachment_count").unwrap_or_default(),
        "visibility": row.try_get::<String, _>("visibility").unwrap_or_else(|_| "private".to_string()),
        "visible_role": row.try_get::<Option<String>, _>("visible_role").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").ok()?.to_rfc3339(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").ok()?.to_rfc3339(),
        "archived_at": row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("archived_at")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339()),
    }))
}

async fn load_note(
    state: &AppState,
    note_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT note.id, note.title, note.body, note.created_by, note.updated_by,
                  note.created_at, note.updated_at, note.visibility, note.visible_role,
                  creator.name AS created_by_name, creator.role::text AS created_by_role,
                  editor.name AS updated_by_name
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
        "created_by_role": row.try_get::<Option<String>, _>("created_by_role").unwrap_or_default(),
        "updated_by": row.try_get::<Uuid, _>("updated_by").ok(),
        "updated_by_name": row.try_get::<String, _>("updated_by_name").unwrap_or_default(),
        "visibility": row.try_get::<String, _>("visibility").unwrap_or_else(|_| "private".to_string()),
        "visible_role": row.try_get::<Option<String>, _>("visible_role").unwrap_or_default(),
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
    Err(err(
        StatusCode::FORBIDDEN,
        "Internal notes are available to staff only",
    ))
}

fn role_code(role: Role) -> &'static str {
    match role {
        Role::Ceo => "ceo",
        Role::CeoAssistant => "ceo_assistant",
        Role::PatientManager => "patient_manager",
        Role::TeamleadInterpreter => "teamlead_interpreter",
        Role::Interpreter => "interpreter",
        Role::Concierge => "concierge",
        Role::Billing => "billing",
        Role::Sales => "sales",
        Role::ItAdmin => "it_admin",
        Role::Patient => "patient",
        _ => "unknown",
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reader(role: Role) -> AuthUser {
        AuthUser {
            user_id: Uuid::new_v4(),
            role,
            family_id: Uuid::new_v4(),
            access_token_jti: Uuid::new_v4(),
            access_token_expires_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn note_visibility_follows_author_role_and_ceo() {
        let author = reader(Role::PatientManager);
        let note = |visibility, visible_role: Option<&str>| NoteAccess {
            created_by: author.user_id,
            visibility,
            visible_role: visible_role.map(str::to_string),
        };
        let colleague = reader(Role::PatientManager);
        let interpreter = reader(Role::Interpreter);
        let ceo = reader(Role::Ceo);

        let private = note(NoteVisibility::Private, None);
        assert!(can_read_note(&author, &private));
        assert!(!can_read_note(&colleague, &private));
        assert!(can_read_note(&ceo, &private));

        let role = note(NoteVisibility::Role, Some("patient_manager"));
        assert!(can_read_note(&colleague, &role));
        assert!(!can_read_note(&interpreter, &role));

        let staff = note(NoteVisibility::Staff, None);
        assert!(can_read_note(&interpreter, &staff));

        assert!(can_change_visibility(&author, &staff));
        assert!(can_change_visibility(&ceo, &staff));
        assert!(!can_change_visibility(&colleague, &staff));
    }

    #[test]
    fn only_author_or_ceo_manage_and_the_assistant_writes_nothing() {
        let author = reader(Role::Sales);
        let colleague = reader(Role::Sales);
        let ceo = reader(Role::Ceo);
        let assistant = reader(Role::CeoAssistant);
        assert!(can_manage_note(&author, author.user_id));
        assert!(can_manage_note(&ceo, author.user_id));
        assert!(!can_manage_note(&colleague, author.user_id));
        assert!(!can_manage_note(&assistant, author.user_id));
        assert!(!can_write_notes(Role::CeoAssistant));
        for role in [
            Role::Ceo,
            Role::PatientManager,
            Role::Sales,
            Role::Billing,
            Role::Interpreter,
            Role::ItAdmin,
        ] {
            assert!(can_write_notes(role), "{role:?}");
        }
        assert!(require_note_writer(&assistant).is_err());
        assert!(require_note_writer(&colleague).is_ok());
    }

    #[test]
    fn note_visibility_codes_round_trip() {
        for value in ["private", "role", "staff"] {
            assert_eq!(
                NoteVisibility::parse(value).map(NoteVisibility::as_str),
                Some(value)
            );
        }
        assert_eq!(NoteVisibility::parse("everyone"), None);
    }

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
