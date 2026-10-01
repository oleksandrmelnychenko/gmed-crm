//! Scan intake for personnel files.
//!
//! The scan station (or anyone handling incoming paper) drops scanned files
//! here; the CEO then assigns each to an employee, a category and a period,
//! which archives it under its generated name. The intake is a write-only
//! drop box for scan accounts: they can submit files but never list or open
//! them. The time a file arrived is kept as the document's `received_at`.

use axum::{
    Json,
    extract::{Extension, Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::documents::{
    Blob, TargetFields, accept_file, archive, file_response, read_multipart, read_verified,
    resolve_target, sha256_hex,
};
use super::{err, internal, load_employee, record_event};
use crate::{
    auth::middleware::AuthUser,
    routes::documents::{remove_document_blob, store_document_blob},
    state::AppState,
};
use gmed_domain::access::capabilities::Capability;

/// Who may drop files into the intake: the CEO, and the accounts that run
/// the scan station (document intake).
fn may_submit(auth: &AuthUser) -> bool {
    auth.can_any(&[Capability::PersonnelUpload, Capability::DocumentsIntake])
}

pub(crate) async fn upload_intake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    mut multipart: Multipart,
) -> Response {
    if !may_submit(&auth) {
        return err(StatusCode::FORBIDDEN, "Forbidden");
    }
    let (file, fields) = match read_multipart(&mut multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some((file_name, claimed_mime, data)) = file else {
        return err(StatusCode::BAD_REQUEST, "No file uploaded");
    };
    let source = match fields.get("source").map(|value| value.trim()) {
        Some("scan") => "scan",
        _ => "upload",
    };
    let mime_type = match accept_file(&file_name, &claimed_mime, &data).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (file_size, storage_key, original_file_name) =
        match store_document_blob(&data, &file_name).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    let sha256 = sha256_hex(&data);
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            remove_document_blob(&storage_key).await;
            return internal(error, "begin intake");
        }
    };
    let inserted = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO personnel_intake_items
               (storage_key, original_file_name, mime_type, file_size, sha256, source, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
    )
    .bind(&storage_key)
    .bind(&original_file_name)
    .bind(&mime_type)
    .bind(file_size)
    .bind(&sha256)
    .bind(source)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await;
    let item_id = match inserted {
        Ok(id) => id,
        Err(error) => {
            remove_document_blob(&storage_key).await;
            return internal(error, "insert intake item");
        }
    };
    if let Err(error) = record_event(
        &mut tx,
        None,
        None,
        Some(auth.user_id),
        "intake_received",
        json!({ "intake_item_id": item_id, "source": source, "original_file_name": original_file_name }),
    )
    .await
    {
        remove_document_blob(&storage_key).await;
        return internal(error, "record intake");
    }
    if let Err(error) = tx.commit().await {
        remove_document_blob(&storage_key).await;
        return internal(error, "commit intake");
    }
    notify_ceos_of_intake(&state).await;
    // The submitter learns only that the file arrived.
    (
        StatusCode::CREATED,
        Json(json!({ "id": item_id, "status": "pending" })),
    )
        .into_response()
}

/// One notification per CEO while unread intake notifications exist.
async fn notify_ceos_of_intake(state: &AppState) {
    let rows = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type)
           SELECT u.id, 'personnel_intake', 'Personnel file: new scan to file',
                  'A scanned document is waiting to be assigned to a personnel file.', 'personnel'
           FROM users u
           WHERE u.is_active = true AND u.role = 'ceo'
             AND NOT EXISTS (
                 SELECT 1 FROM user_notifications n
                 WHERE n.user_id = u.id AND n.kind = 'personnel_intake' AND n.is_read = false
             )
           RETURNING id, user_id"#,
    )
    .fetch_all(&state.db)
    .await;
    match rows {
        Ok(rows) => {
            for row in rows {
                crate::realtime::publish_notification_event(
                    state,
                    row.get::<Uuid, _>("user_id"),
                    "notification.created",
                    Some(row.get::<Uuid, _>("id")),
                    json!({ "entity_type": "personnel" }),
                )
                .await;
            }
        }
        Err(error) => tracing::warn!(%error, "notify personnel intake"),
    }
}

pub(crate) async fn list_intake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    match sqlx::query(
        r#"SELECT i.id, i.original_file_name, i.mime_type, i.file_size, i.source, i.received_at,
                  u.name AS uploaded_by_name
           FROM personnel_intake_items i
           LEFT JOIN users u ON u.id = i.uploaded_by
           WHERE i.status = 'pending'
           ORDER BY i.received_at"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<Uuid, _>("id").ok(),
                        "original_file_name": row.try_get::<String, _>("original_file_name").unwrap_or_default(),
                        "mime_type": row.try_get::<String, _>("mime_type").unwrap_or_default(),
                        "file_size": row.try_get::<i64, _>("file_size").unwrap_or_default(),
                        "source": row.try_get::<String, _>("source").unwrap_or_default(),
                        "received_at": row
                            .try_get::<DateTime<Utc>, _>("received_at")
                            .map(|value| value.to_rfc3339())
                            .ok(),
                        "uploaded_by_name": row.try_get::<Option<String>, _>("uploaded_by_name").unwrap_or_default(),
                    })
                })
                .collect::<Vec<Value>>(),
        )
        .into_response(),
        Err(error) => internal(error, "list personnel intake"),
    }
}

struct IntakeItem {
    storage_key: String,
    original_file_name: String,
    mime_type: String,
    file_size: i64,
    sha256: String,
    source: String,
    received_at: DateTime<Utc>,
}

async fn load_pending_item(state: &AppState, item_id: Uuid) -> Result<IntakeItem, Response> {
    let row = sqlx::query(
        r#"SELECT storage_key, original_file_name, mime_type, file_size, sha256, source, received_at
           FROM personnel_intake_items WHERE id = $1 AND status = 'pending'"#,
    )
    .bind(item_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| internal(error, "load intake item"))?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Scan not found or already handled"))?;
    Ok(IntakeItem {
        storage_key: row.try_get("storage_key").unwrap_or_default(),
        original_file_name: row.try_get("original_file_name").unwrap_or_default(),
        mime_type: row.try_get("mime_type").unwrap_or_default(),
        file_size: row.try_get("file_size").unwrap_or_default(),
        sha256: row.try_get("sha256").unwrap_or_default(),
        source: row.try_get("source").unwrap_or_default(),
        received_at: row.try_get("received_at").unwrap_or_else(|_| Utc::now()),
    })
}

pub(crate) async fn download_intake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let item = match load_pending_item(&state, item_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    match read_verified(
        item_id,
        &item.storage_key,
        &item.mime_type,
        &item.original_file_name,
        &item.sha256,
    )
    .await
    {
        Ok(bytes) => file_response(bytes, &item.mime_type, &item.original_file_name, true),
        Err(problem) => {
            tracing::error!(%item_id, problem, "personnel intake file fails its integrity check");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The scanned file fails its integrity check",
            )
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct ArchiveIntakeRequest {
    employee_id: Uuid,
    category: Option<String>,
    period: Option<String>,
    document_date: Option<String>,
    title: Option<String>,
    supersedes_id: Option<String>,
    correction_reason: Option<String>,
}

pub(crate) async fn archive_intake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
    Json(body): Json<ArchiveIntakeRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let item = match load_pending_item(&state, item_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let employee = {
        let mut conn = match state.db.acquire().await {
            Ok(conn) => conn,
            Err(error) => return internal(error, "acquire connection"),
        };
        match load_employee(&mut conn, body.employee_id).await {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::UNPROCESSABLE_ENTITY, "Employee not found"),
            Err(error) => return internal(error, "load employee"),
        }
    };
    let fields = TargetFields {
        category: body.category,
        period: body.period,
        document_date: body.document_date,
        supersedes_id: body.supersedes_id,
        correction_reason: body.correction_reason,
    };
    let target = match resolve_target(&state, &auth, &employee, &fields).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    // The blob must still be what arrived.
    if let Err(problem) = read_verified(
        item_id,
        &item.storage_key,
        &item.mime_type,
        &item.original_file_name,
        &item.sha256,
    )
    .await
    {
        tracing::error!(%item_id, problem, "personnel intake file fails its integrity check");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The scanned file fails its integrity check",
        );
    }
    let blob = Blob {
        storage_key: item.storage_key,
        original_file_name: item.original_file_name,
        mime_type: item.mime_type,
        file_size: item.file_size,
        sha256: item.sha256,
        source_document_id: None,
    };
    let title = body
        .title
        .map(|value| value.trim().chars().take(255).collect::<String>())
        .filter(|value| !value.is_empty());
    let source = if item.source == "scan" {
        "scan"
    } else {
        "upload"
    };
    match archive(
        &state,
        &auth,
        &employee,
        &target,
        &blob,
        title.as_deref(),
        source,
        Some(item.received_at),
        Some(item_id),
    )
    .await
    {
        // The blob now belongs to the archived document; it is not removed
        // on failure because the intake item still points at it.
        Ok(document) => (StatusCode::CREATED, Json(document)).into_response(),
        Err(response) => response,
    }
}

#[derive(Deserialize)]
pub(crate) struct DiscardIntakeRequest {
    reason: String,
}

/// Drops a scan that does not belong in any personnel file (wrong page,
/// duplicate). It was never archived, so its blob is removed.
pub(crate) async fn discard_intake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
    Json(body): Json<DiscardIntakeRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let reason: String = body.reason.trim().chars().take(2_000).collect();
    if reason.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Discarding a scan needs a reason",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin intake discard"),
    };
    let row = match sqlx::query(
        r#"UPDATE personnel_intake_items
           SET status = 'discarded', resolved_by = $2, resolved_at = now()
           WHERE id = $1 AND status = 'pending'
           RETURNING storage_key, original_file_name"#,
    )
    .bind(item_id)
    .bind(auth.user_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Scan not found or already handled"),
        Err(error) => return internal(error, "discard intake item"),
    };
    let storage_key: String = row.try_get("storage_key").unwrap_or_default();
    let original_file_name: String = row.try_get("original_file_name").unwrap_or_default();
    if let Err(error) = record_event(
        &mut tx,
        None,
        None,
        Some(auth.user_id),
        "intake_discarded",
        json!({ "intake_item_id": item_id, "reason": reason, "original_file_name": original_file_name }),
    )
    .await
    {
        return internal(error, "record intake discard");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit intake discard");
    }
    remove_document_blob(&storage_key).await;
    Json(json!({ "id": item_id, "status": "discarded" })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gmed_domain::role::Role;

    fn auth(role: Role) -> AuthUser {
        AuthUser {
            user_id: Uuid::nil(),
            role,
            family_id: Uuid::nil(),
            access_token_jti: Uuid::nil(),
            access_token_expires_at: Utc::now(),
        }
    }

    #[test]
    fn scan_accounts_may_submit_but_only_the_ceo_files() {
        assert!(may_submit(&auth(Role::Ceo)));
        assert!(may_submit(&auth(Role::PatientManager)));
        for role in [
            Role::CeoAssistant,
            Role::Billing,
            Role::Sales,
            Role::ItAdmin,
            Role::Interpreter,
            Role::Concierge,
            Role::Patient,
        ] {
            assert!(!may_submit(&auth(role)), "{role:?}");
        }
        for role in [Role::PatientManager, Role::ItAdmin, Role::Billing] {
            assert!(!auth(role).can(Capability::PersonnelUpload), "{role:?}");
        }
    }
}
