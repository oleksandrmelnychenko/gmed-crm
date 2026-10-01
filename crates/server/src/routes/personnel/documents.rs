//! The personnel archive: upload, versions, download, legal hold and
//! deletion after the retention period.
//!
//! The database stamps the archive time and links every document into the
//! employee's hash chain (`personnel_documents_before_insert`); its triggers
//! refuse any change to an archived document. This module only decides who
//! may archive what under which name.

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Extension, Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use super::{
    Category, Employee, audit_event, deletion_enabled, employee_for_user, err, format_month,
    internal, late_days, load_category, load_employee, parse_date, parse_month, record_event,
    record_event_logged,
};
use crate::{
    auth::middleware::AuthUser,
    file_scan::{FileScanOutcome, scan_upload_bytes},
    file_sniff::validate_upload_magic_bytes,
    routes::documents::{
        MAX_FILE_SIZE, read_document_storage_bytes, remove_document_blob,
        remove_document_blob_checked, store_document_blob,
    },
    state::AppState,
};
use gmed_domain::access::capabilities::Capability;
use gmed_domain::personnel::{ArchivePeriod, archive_file_name, archived_late, extension_for_mime};

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

// ---------------------------------------------------------------------------
// Target resolution and archiving (shared with the scan intake)
// ---------------------------------------------------------------------------

/// What a new document is filed as.
pub(crate) struct Target {
    pub category: Category,
    pub period_month: Option<NaiveDate>,
    pub document_date: Option<NaiveDate>,
    /// `(id, version_number)` of the document this one corrects.
    pub supersedes: Option<(Uuid, i32)>,
    pub correction_reason: Option<String>,
}

impl Target {
    fn period(&self) -> ArchivePeriod {
        match (self.period_month, self.document_date) {
            (Some(month), _) => ArchivePeriod::Month {
                year: month.year(),
                month: month.month(),
            },
            (None, Some(date)) => ArchivePeriod::Date(date),
            (None, None) => ArchivePeriod::Date(crate::app_time::today()),
        }
    }

    fn version_number(&self) -> i32 {
        self.supersedes.map(|(_, version)| version + 1).unwrap_or(1)
    }
}

/// The raw target fields of an upload, intake assignment or name preview.
#[derive(Default, Deserialize)]
pub(crate) struct TargetFields {
    pub category: Option<String>,
    pub period: Option<String>,
    pub document_date: Option<String>,
    pub supersedes_id: Option<String>,
    pub correction_reason: Option<String>,
}

/// Checks the category, the period or date, and a superseded document.
/// A new version inherits category and period from the document it corrects.
pub(crate) async fn resolve_target(
    state: &AppState,
    auth: &AuthUser,
    employee: &Employee,
    fields: &TargetFields,
) -> Result<Target, Response> {
    let unprocessable = |message: &str| err(StatusCode::UNPROCESSABLE_ENTITY, message);
    let supersedes_id = match fields.supersedes_id.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(value) => {
            Some(Uuid::parse_str(value).map_err(|_| unprocessable("Unknown document to correct"))?)
        }
    };
    if let Some(supersedes_id) = supersedes_id {
        let row = sqlx::query(
            r#"SELECT d.category, d.period_month, d.document_date, d.version_number, d.deleted_at,
                      d.employee_id,
                      EXISTS (SELECT 1 FROM personnel_documents n WHERE n.supersedes_id = d.id) AS superseded
               FROM personnel_documents d WHERE d.id = $1"#,
        )
        .bind(supersedes_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| internal(error, "load superseded document"))?
        .ok_or_else(|| unprocessable("Unknown document to correct"))?;
        if row.try_get::<Uuid, _>("employee_id").ok() != Some(employee.id) {
            return Err(unprocessable(
                "The document belongs to another personnel file",
            ));
        }
        if row
            .try_get::<Option<DateTime<Utc>>, _>("deleted_at")
            .ok()
            .flatten()
            .is_some()
        {
            return Err(err(
                StatusCode::CONFLICT,
                "A deleted document cannot be corrected",
            ));
        }
        if row.try_get::<bool, _>("superseded").unwrap_or(false) {
            return Err(err(
                StatusCode::CONFLICT,
                "Only the newest version of a document can be corrected",
            ));
        }
        let reason = fields
            .correction_reason
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(2_000).collect::<String>())
            .ok_or_else(|| unprocessable("A correction needs a reason"))?;
        let code: String = row.try_get("category").unwrap_or_default();
        let category = load_category(state, &code)
            .await
            .map_err(|error| internal(error, "load category"))?
            .ok_or_else(|| unprocessable("Unknown category"))?;
        if category.is_health && !auth.can(Capability::PersonnelHealthView) {
            return Err(err(StatusCode::FORBIDDEN, "Forbidden"));
        }
        return Ok(Target {
            category,
            period_month: row.try_get("period_month").unwrap_or_default(),
            document_date: row.try_get("document_date").unwrap_or_default(),
            supersedes: Some((supersedes_id, row.try_get("version_number").unwrap_or(1))),
            correction_reason: Some(reason),
        });
    }

    let code = fields
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| unprocessable("Choose a category"))?;
    let category = load_category(state, code)
        .await
        .map_err(|error| internal(error, "load category"))?
        .ok_or_else(|| unprocessable("Unknown category"))?;
    if category.is_health && !auth.can(Capability::PersonnelHealthView) {
        return Err(err(StatusCode::FORBIDDEN, "Forbidden"));
    }
    let (period_month, document_date) = if category.monthly {
        let month = fields
            .period
            .as_deref()
            .and_then(parse_month)
            .ok_or_else(|| unprocessable("Choose the month (YYYY-MM) of the document"))?;
        (Some(month), None)
    } else {
        let date = fields
            .document_date
            .as_deref()
            .and_then(parse_date)
            .ok_or_else(|| unprocessable("Enter the document date (YYYY-MM-DD)"))?;
        (None, Some(date))
    };
    let horizon = crate::app_time::today() + chrono::Duration::days(366);
    if period_month
        .or(document_date)
        .is_some_and(|date| date > horizon)
    {
        return Err(unprocessable(
            "The document date lies too far in the future",
        ));
    }
    Ok(Target {
        category,
        period_month,
        document_date,
        supersedes: None,
        correction_reason: None,
    })
}

/// The archive name for `target`, unique within the employee's file.
pub(crate) fn unique_archive_name(
    employee: &Employee,
    target: &Target,
    extension: &str,
    taken: &HashSet<String>,
) -> Result<String, Response> {
    let version = target.version_number();
    let base_suffix = (version > 1).then(|| format!("V{version}"));
    for duplicate in 1..=99 {
        let suffix = match (&base_suffix, duplicate) {
            (None, 1) => None,
            (Some(base), 1) => Some(base.clone()),
            (None, n) => Some(n.to_string()),
            (Some(base), n) => Some(format!("{base}_{n}")),
        };
        let name = archive_file_name(
            &target.category.file_label,
            target.period(),
            &employee.last_name,
            &employee.first_name,
            extension,
            suffix.as_deref(),
        )
        .map_err(|error| err(StatusCode::UNPROCESSABLE_ENTITY, &error.to_string()))?;
        if !taken.contains(&name) {
            return Ok(name);
        }
    }
    Err(err(
        StatusCode::CONFLICT,
        "Too many documents with the same name in this file",
    ))
}

pub(crate) async fn taken_names(
    state: &AppState,
    employee_id: Uuid,
) -> Result<HashSet<String>, Response> {
    sqlx::query_scalar::<_, String>(
        "SELECT archive_file_name FROM personnel_documents WHERE employee_id = $1",
    )
    .bind(employee_id)
    .fetch_all(&state.db)
    .await
    .map(|names| names.into_iter().collect())
    .map_err(|error| internal(error, "load archive names"))
}

/// A sealed blob that is about to be archived.
pub(crate) struct Blob {
    pub storage_key: String,
    pub original_file_name: String,
    pub mime_type: String,
    pub file_size: i64,
    pub sha256: String,
    /// The interpreter profile document an import was copied from.
    pub source_document_id: Option<Uuid>,
}

/// Inserts the archive row and its journal entry. The caller owns the blob:
/// it is removed by the caller when this fails.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn archive(
    state: &AppState,
    auth: &AuthUser,
    employee: &Employee,
    target: &Target,
    blob: &Blob,
    title: Option<&str>,
    source: &str,
    received_at: Option<DateTime<Utc>>,
    intake_item_id: Option<Uuid>,
) -> Result<Value, Response> {
    let extension = extension_for_mime(&blob.mime_type).ok_or_else(|| {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only PDF, JPEG, PNG, BMP and TIFF files are accepted",
        )
    })?;
    let taken = taken_names(state, employee.id).await?;
    let name = unique_archive_name(employee, target, extension, &taken)?;
    let document_id = Uuid::new_v4();
    let late = late_days(state).await;

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| internal(error, "begin archive"))?;
    let inserted = sqlx::query(
        r#"INSERT INTO personnel_documents (
               id, employee_id, category, period_month, document_date, title,
               archive_file_name, original_file_name, mime_type, file_size, sha256,
               storage_key, source, received_at, version_root_id, supersedes_id,
               version_number, correction_reason, archived_at, archived_by,
               chain_seq, prev_chain_hash, chain_hash, source_document_id
           ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $1, $15, 1, $16, now(), $17, 0, repeat('0', 64), repeat('0', 64), $18
           )"#,
    )
    .bind(document_id)
    .bind(employee.id)
    .bind(&target.category.code)
    .bind(target.period_month)
    .bind(target.document_date)
    .bind(title)
    .bind(&name)
    .bind(&blob.original_file_name)
    .bind(&blob.mime_type)
    .bind(blob.file_size)
    .bind(&blob.sha256)
    .bind(&blob.storage_key)
    .bind(source)
    .bind(received_at)
    .bind(target.supersedes.map(|(id, _)| id))
    .bind(target.correction_reason.as_deref())
    .bind(auth.user_id)
    .bind(blob.source_document_id)
    .execute(&mut *tx)
    .await;
    if let Err(error) = inserted {
        if let sqlx::Error::Database(db_error) = &error {
            match db_error.constraint() {
                Some("personnel_documents_supersedes_id_key") => {
                    return Err(err(
                        StatusCode::CONFLICT,
                        "This document has already been corrected",
                    ));
                }
                Some("uq_personnel_documents_source") => {
                    return Err(err(
                        StatusCode::CONFLICT,
                        "This profile document is already in the personnel file",
                    ));
                }
                Some("uq_personnel_documents_name") => {
                    return Err(err(
                        StatusCode::CONFLICT,
                        "A document with this name was archived at the same time; try again",
                    ));
                }
                _ => {}
            }
            if db_error.code().as_deref() == Some("P0001") {
                return Err(err(StatusCode::CONFLICT, db_error.message()));
            }
        }
        return Err(internal(error, "insert personnel document"));
    }
    if let Some(item_id) = intake_item_id {
        let updated = sqlx::query(
            r#"UPDATE personnel_intake_items
               SET status = 'archived', document_id = $2, resolved_by = $3, resolved_at = now()
               WHERE id = $1 AND status = 'pending'"#,
        )
        .bind(item_id)
        .bind(document_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| internal(error, "resolve intake item"))?;
        if updated.rows_affected() != 1 {
            return Err(err(
                StatusCode::CONFLICT,
                "The scan has already been handled",
            ));
        }
    }
    let action = if target.supersedes.is_some() {
        "document_version"
    } else {
        "document_archived"
    };
    record_event(
        &mut tx,
        Some(employee.id),
        Some(document_id),
        Some(auth.user_id),
        action,
        json!({
            "archive_file_name": name,
            "category": target.category.code,
            "source": source,
            "supersedes_id": target.supersedes.map(|(id, _)| id),
            "correction_reason": target.correction_reason,
            "intake_item_id": intake_item_id,
        }),
    )
    .await
    .map_err(|error| internal(error, "record archive"))?;
    // Read the response inside the transaction: once it commits, the caller
    // must not treat a failure as a rollback and remove the blob.
    let row = sqlx::query(&document_select("d.id = $1"))
        .bind(document_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| internal(error, "reload personnel document"))?;
    tx.commit()
        .await
        .map_err(|error| internal(error, "commit archive"))?;

    audit_event(
        state,
        "personnel_document_archived",
        auth.user_id,
        Some(document_id),
        json!({ "employee_id": employee.id, "category": target.category.code }),
    );
    Ok(document_json(&row, late))
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/// `filter` is a fixed SQL predicate; its parameters are bound by the caller.
fn document_select(filter: &str) -> String {
    format!(
        r#"SELECT d.id, d.employee_id, d.category, d.period_month, d.document_date, d.title,
                  d.archive_file_name, d.original_file_name, d.mime_type, d.file_size, d.sha256,
                  d.source, d.source_document_id, d.received_at, d.version_root_id, d.supersedes_id, d.version_number,
                  d.correction_reason, d.archived_at, d.chain_seq, d.chain_hash, d.legal_hold,
                  d.deleted_at, d.delete_reason,
                  c.file_label, c.is_health, c.monthly,
                  archiver.name AS archived_by_name,
                  deleter.name AS deleted_by_name,
                  personnel_retention_until(d.category, d.period_month, d.document_date, emp.employment_end)
                      AS retention_until,
                  NOT EXISTS (SELECT 1 FROM personnel_documents n WHERE n.supersedes_id = d.id)
                      AS is_current
           FROM personnel_documents d
           JOIN personnel_document_categories c ON c.code = d.category
           JOIN employees emp ON emp.id = d.employee_id
           LEFT JOIN users archiver ON archiver.id = d.archived_by
           LEFT JOIN users deleter ON deleter.id = d.deleted_by
           WHERE {filter}"#
    )
}

/// Whether the document was archived (or, for scans, received) later than
/// the threshold after its month or date.
fn row_archived_late(row: &PgRow, late_days: i64) -> bool {
    let reference: DateTime<Utc> = row
        .try_get::<Option<DateTime<Utc>>, _>("received_at")
        .ok()
        .flatten()
        .or_else(|| row.try_get::<DateTime<Utc>, _>("archived_at").ok())
        .unwrap_or_else(Utc::now);
    let period_month: Option<NaiveDate> = row.try_get("period_month").unwrap_or_default();
    let document_date: Option<NaiveDate> = row.try_get("document_date").unwrap_or_default();
    let period = match (period_month, document_date) {
        (Some(month), _) => ArchivePeriod::Month {
            year: month.year(),
            month: month.month(),
        },
        (None, Some(date)) => ArchivePeriod::Date(date),
        (None, None) => return false,
    };
    archived_late(
        period,
        crate::app_time::date_of(reference),
        u32::try_from(late_days).unwrap_or(0),
    )
}

pub(crate) fn document_json(row: &PgRow, late_days: i64) -> Value {
    let timestamp = |column: &str| {
        row.try_get::<Option<DateTime<Utc>>, _>(column)
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339())
    };
    let deleted = row
        .try_get::<Option<DateTime<Utc>>, _>("deleted_at")
        .ok()
        .flatten()
        .is_some();
    json!({
        "id": row.try_get::<Uuid, _>("id").ok(),
        "employee_id": row.try_get::<Uuid, _>("employee_id").ok(),
        "category": row.try_get::<String, _>("category").unwrap_or_default(),
        "category_label": row.try_get::<String, _>("file_label").unwrap_or_default(),
        "is_health": row.try_get::<bool, _>("is_health").unwrap_or(false),
        "period": row
            .try_get::<Option<NaiveDate>, _>("period_month")
            .ok()
            .flatten()
            .map(format_month),
        "document_date": row.try_get::<Option<NaiveDate>, _>("document_date").ok().flatten(),
        "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
        "archive_file_name": row.try_get::<String, _>("archive_file_name").unwrap_or_default(),
        "original_file_name": row.try_get::<String, _>("original_file_name").unwrap_or_default(),
        "mime_type": row.try_get::<String, _>("mime_type").unwrap_or_default(),
        "file_size": row.try_get::<i64, _>("file_size").unwrap_or_default(),
        "sha256": row.try_get::<String, _>("sha256").unwrap_or_default(),
        "source": row.try_get::<String, _>("source").unwrap_or_default(),
        "source_document_id": row.try_get::<Option<Uuid>, _>("source_document_id").unwrap_or_default(),
        "received_at": timestamp("received_at"),
        "version_root_id": row.try_get::<Uuid, _>("version_root_id").ok(),
        "supersedes_id": row.try_get::<Option<Uuid>, _>("supersedes_id").unwrap_or_default(),
        "version_number": row.try_get::<i32, _>("version_number").unwrap_or(1),
        "correction_reason": row.try_get::<Option<String>, _>("correction_reason").unwrap_or_default(),
        "archived_at": timestamp("archived_at"),
        "archived_by_name": row.try_get::<Option<String>, _>("archived_by_name").unwrap_or_default(),
        "chain_seq": row.try_get::<i64, _>("chain_seq").unwrap_or_default(),
        "chain_hash": row.try_get::<String, _>("chain_hash").unwrap_or_default(),
        "legal_hold": row.try_get::<bool, _>("legal_hold").unwrap_or(false),
        "deleted_at": timestamp("deleted_at"),
        "deleted_by_name": row.try_get::<Option<String>, _>("deleted_by_name").unwrap_or_default(),
        "delete_reason": row.try_get::<Option<String>, _>("delete_reason").unwrap_or_default(),
        "retention_until": row.try_get::<Option<NaiveDate>, _>("retention_until").ok().flatten(),
        "is_current": row.try_get::<bool, _>("is_current").unwrap_or(true) && !deleted,
        "archived_late": row_archived_late(row, late_days),
    })
}

pub(crate) async fn list_employee_documents(
    state: &AppState,
    employee: &Employee,
    include_health: bool,
    include_deleted: bool,
    late_days: i64,
) -> Result<Vec<Value>, sqlx::Error> {
    let sql = format!(
        "{} ORDER BY COALESCE(d.period_month, d.document_date) DESC, c.sort_order, \
         d.version_root_id, d.version_number DESC",
        document_select(
            "d.employee_id = $1 AND ($2 OR NOT c.is_health) AND ($3 OR d.deleted_at IS NULL)"
        )
    );
    let rows = sqlx::query(&sql)
        .bind(employee.id)
        .bind(include_health)
        .bind(include_deleted)
        .fetch_all(&state.db)
        .await?;
    Ok(rows
        .iter()
        .map(|row| document_json(row, late_days))
        .collect())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn load_employee_or_404(state: &AppState, employee_id: Uuid) -> Result<Employee, Response> {
    let mut conn = state
        .db
        .acquire()
        .await
        .map_err(|error| internal(error, "acquire connection"))?;
    match load_employee(&mut conn, employee_id).await {
        Ok(Some(value)) => Ok(value),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Employee not found")),
        Err(error) => Err(internal(error, "load employee")),
    }
}

/// Checks the content type and scans the bytes; returns the canonical MIME
/// type of an accepted personnel document.
pub(crate) async fn accept_file(
    file_name: &str,
    claimed_mime: &str,
    data: &[u8],
) -> Result<String, Response> {
    let refused = || {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only PDF, JPEG, PNG, BMP and TIFF files are accepted",
        )
    };
    let mime_type = match validate_upload_magic_bytes(Some(file_name), Some(claimed_mime), data) {
        Ok(Some(value)) => value,
        Ok(None) => return Err(refused()),
        Err(message) => return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message)),
    };
    if extension_for_mime(&mime_type).is_none() {
        return Err(refused());
    }
    match scan_upload_bytes(Some(file_name), data).await {
        Ok(FileScanOutcome::Clean) => {}
        Ok(FileScanOutcome::Skipped) => {
            tracing::warn!(file_name = %file_name, "virus scanner unavailable; personnel document scan skipped");
        }
        Err(message) => return Err(err(StatusCode::UNPROCESSABLE_ENTITY, &message)),
    }
    Ok(mime_type)
}

/// Reads the `file` part of a multipart upload and the text fields.
pub(crate) async fn read_multipart(
    multipart: &mut Multipart,
) -> Result<
    (
        Option<(String, String, Vec<u8>)>,
        std::collections::HashMap<String, String>,
    ),
    Response,
> {
    let mut file = None;
    let mut fields = std::collections::HashMap::new();
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            let file_name = field.file_name().unwrap_or("document").trim().to_string();
            let mime = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_string();
            let bytes = match field.bytes().await {
                Ok(value) if value.len() > MAX_FILE_SIZE => {
                    return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "File too large"));
                }
                Ok(value) if !value.is_empty() => value.to_vec(),
                _ => return Err(err(StatusCode::BAD_REQUEST, "Failed to read file")),
            };
            file = Some((file_name, mime, bytes));
        } else if let Ok(text) = field.text().await {
            fields.insert(name, text);
        }
    }
    Ok((file, fields))
}

pub(crate) async fn upload_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(employee_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let employee = match load_employee_or_404(&state, employee_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (file, mut fields) = match read_multipart(&mut multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some((file_name, claimed_mime, data)) = file else {
        return err(StatusCode::BAD_REQUEST, "No file uploaded");
    };
    let target_fields = TargetFields {
        category: fields.remove("category"),
        period: fields.remove("period"),
        document_date: fields.remove("document_date"),
        supersedes_id: fields.remove("supersedes_id"),
        correction_reason: fields.remove("correction_reason"),
    };
    let target = match resolve_target(&state, &auth, &employee, &target_fields).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mime_type = match accept_file(&file_name, &claimed_mime, &data).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let title = fields
        .remove("title")
        .map(|value| value.trim().chars().take(255).collect::<String>())
        .filter(|value| !value.is_empty());
    let (file_size, storage_key, original_file_name) =
        match store_document_blob(&data, &file_name).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    let blob = Blob {
        storage_key,
        original_file_name,
        mime_type,
        file_size,
        sha256: sha256_hex(&data),
        source_document_id: None,
    };
    match archive(
        &state,
        &auth,
        &employee,
        &target,
        &blob,
        title.as_deref(),
        "upload",
        None,
        None,
    )
    .await
    {
        Ok(document) => (StatusCode::CREATED, Json(document)).into_response(),
        Err(response) => {
            remove_document_blob(&blob.storage_key).await;
            response
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct FileNameQuery {
    category: Option<String>,
    period: Option<String>,
    document_date: Option<String>,
    supersedes_id: Option<String>,
    mime_type: Option<String>,
}

/// The name a document would be archived under, for the upload dialog.
pub(crate) async fn preview_file_name(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(employee_id): Path<Uuid>,
    Query(query): Query<FileNameQuery>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let employee = match load_employee_or_404(&state, employee_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let fields = TargetFields {
        category: query.category,
        period: query.period,
        document_date: query.document_date,
        supersedes_id: query.supersedes_id,
        // The preview does not need the reason; any text satisfies the check.
        correction_reason: Some("preview".to_string()),
    };
    let target = match resolve_target(&state, &auth, &employee, &fields).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mime_type = query
        .mime_type
        .unwrap_or_else(|| "application/pdf".to_string());
    let Some(extension) = extension_for_mime(&mime_type) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only PDF, JPEG, PNG, BMP and TIFF files are accepted",
        );
    };
    let taken = match taken_names(&state, employee.id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    match unique_archive_name(&employee, &target, extension, &taken) {
        Ok(name) => Json(json!({
            "file_name": name,
            "version_number": target.version_number(),
            "category": target.category.code,
            "period": target.period_month.map(format_month),
            "document_date": target.document_date,
        }))
        .into_response(),
        Err(response) => response,
    }
}

#[derive(Deserialize)]
pub(crate) struct DownloadQuery {
    inline: Option<bool>,
}

pub(crate) fn file_response(
    bytes: Vec<u8>,
    mime_type: &str,
    file_name: &str,
    inline: bool,
) -> Response {
    let disposition = if inline { "inline" } else { "attachment" };
    // Archive names are ASCII without quotes by construction; anything else
    // (intake originals) is reduced to a safe ASCII form.
    let safe_name: String = file_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    (
        [
            (header::CONTENT_TYPE, mime_type.to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("{disposition}; filename=\"{safe_name}\""),
            ),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        bytes,
    )
        .into_response()
}

/// Reads a blob and checks it against its recorded SHA-256.
pub(crate) async fn read_verified(
    id: Uuid,
    storage_key: &str,
    mime_type: &str,
    file_name: &str,
    sha256: &str,
) -> Result<Vec<u8>, String> {
    let bytes =
        read_document_storage_bytes(id, storage_key, Some(mime_type), Some(file_name), None)
            .await
            .map_err(|error| format!("blob unreadable: {error}"))?;
    if sha256_hex(&bytes) != sha256 {
        return Err("checksum mismatch".to_string());
    }
    Ok(bytes)
}

pub(crate) async fn download_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(document_id): Path<Uuid>,
    Query(query): Query<DownloadQuery>,
) -> Response {
    let row = match sqlx::query(
        r#"SELECT d.employee_id, d.storage_key, d.mime_type, d.archive_file_name, d.sha256,
                  d.deleted_at, c.is_health, e.user_id
           FROM personnel_documents d
           JOIN personnel_document_categories c ON c.code = d.category
           JOIN employees e ON e.id = d.employee_id
           WHERE d.id = $1"#,
    )
    .bind(document_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(error) => return internal(error, "load personnel document"),
    };
    let is_health: bool = row.try_get("is_health").unwrap_or(true);
    let staff_access = auth.can(Capability::PersonnelView)
        && (!is_health || auth.can(Capability::PersonnelHealthView));
    let own = row.try_get::<Option<Uuid>, _>("user_id").ok().flatten() == Some(auth.user_id);
    if !staff_access && !own {
        return err(StatusCode::NOT_FOUND, "Document not found");
    }
    if row
        .try_get::<Option<DateTime<Utc>>, _>("deleted_at")
        .ok()
        .flatten()
        .is_some()
    {
        return err(
            StatusCode::GONE,
            "The document was deleted after its retention period",
        );
    }
    let employee_id: Uuid = row.try_get("employee_id").unwrap_or_default();
    let storage_key: String = row.try_get("storage_key").unwrap_or_default();
    let mime_type: String = row.try_get("mime_type").unwrap_or_default();
    let file_name: String = row.try_get("archive_file_name").unwrap_or_default();
    let sha256: String = row.try_get("sha256").unwrap_or_default();
    let bytes = match read_verified(document_id, &storage_key, &mime_type, &file_name, &sha256)
        .await
    {
        Ok(bytes) => bytes,
        Err(problem) => {
            tracing::error!(%document_id, problem, "personnel document fails its integrity check");
            record_event_logged(
                &state,
                Some(employee_id),
                Some(document_id),
                Some(auth.user_id),
                "integrity_failed",
                json!({ "problem": problem, "during": "download" }),
            )
            .await;
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The stored document fails its integrity check",
            );
        }
    };
    let action = if staff_access {
        "document_downloaded"
    } else {
        "own_document_downloaded"
    };
    record_event_logged(
        &state,
        Some(employee_id),
        Some(document_id),
        Some(auth.user_id),
        action,
        json!({ "inline": query.inline.unwrap_or(false) }),
    )
    .await;
    file_response(bytes, &mime_type, &file_name, query.inline.unwrap_or(false))
}

#[derive(Deserialize)]
pub(crate) struct LegalHoldRequest {
    legal_hold: bool,
    reason: Option<String>,
}

pub(crate) async fn set_legal_hold(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(document_id): Path<Uuid>,
    Json(body): Json<LegalHoldRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelManage) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin legal hold"),
    };
    let employee_id = match sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE personnel_documents SET legal_hold = $2
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING employee_id"#,
    )
    .bind(document_id)
    .bind(body.legal_hold)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(error) => return internal(error, "set legal hold"),
    };
    let reason = body
        .reason
        .map(|value| value.trim().chars().take(2_000).collect::<String>())
        .filter(|value| !value.is_empty());
    let action = if body.legal_hold {
        "legal_hold_set"
    } else {
        "legal_hold_released"
    };
    if let Err(error) = record_event(
        &mut tx,
        Some(employee_id),
        Some(document_id),
        Some(auth.user_id),
        action,
        json!({ "reason": reason }),
    )
    .await
    {
        return internal(error, "record legal hold");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit legal hold");
    }
    Json(json!({ "id": document_id, "legal_hold": body.legal_hold })).into_response()
}

#[derive(Deserialize)]
pub(crate) struct DeleteRequest {
    reason: String,
}

/// Turns a document past its retention period into a tombstone and removes
/// its blob. The database refuses it while deletion is disabled, under a
/// legal hold or before the retention end.
pub(crate) async fn delete_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(document_id): Path<Uuid>,
    Json(body): Json<DeleteRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelRetention) {
        return response;
    }
    let reason: String = body.reason.trim().chars().take(2_000).collect();
    if reason.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A deletion needs a reason",
        );
    }
    if !deletion_enabled(&state).await {
        return err(
            StatusCode::CONFLICT,
            "Deleting personnel documents is disabled until the retention periods are confirmed",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin personnel delete"),
    };
    let updated = sqlx::query(
        r#"UPDATE personnel_documents
           SET deleted_at = now(), deleted_by = $2, delete_reason = $3
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING employee_id, storage_key, archive_file_name"#,
    )
    .bind(document_id)
    .bind(auth.user_id)
    .bind(&reason)
    .fetch_optional(&mut *tx)
    .await;
    let row = match updated {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("P0001") => {
            return err(StatusCode::CONFLICT, db_error.message());
        }
        Err(error) => return internal(error, "delete personnel document"),
    };
    let employee_id: Uuid = row.try_get("employee_id").unwrap_or_default();
    let storage_key: String = row.try_get("storage_key").unwrap_or_default();
    let file_name: String = row.try_get("archive_file_name").unwrap_or_default();
    if let Err(error) = record_event(
        &mut tx,
        Some(employee_id),
        Some(document_id),
        Some(auth.user_id),
        "document_deleted",
        json!({ "reason": reason, "archive_file_name": file_name }),
    )
    .await
    {
        return internal(error, "record personnel delete");
    }
    // The file goes first: a deletion is recorded only once the data is gone.
    // If the commit then fails, the row stays live without its file; the
    // integrity check reports it and the deletion can simply be repeated.
    if let Err(error) = remove_document_blob_checked(&storage_key).await {
        tracing::error!(%error, %document_id, "remove personnel document blob");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The stored file could not be removed; nothing was deleted, try again",
        );
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit personnel delete");
    }
    audit_event(
        &state,
        "personnel_document_deleted",
        auth.user_id,
        Some(document_id),
        json!({ "employee_id": employee_id }),
    );
    Json(json!({ "id": document_id, "deleted": true })).into_response()
}

/// Documents whose retention period has ended and that are not on hold.
pub(crate) async fn list_due_for_deletion(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelRetention) {
        return response;
    }
    let late = late_days(&state).await;
    let sql = format!(
        r#"WITH due AS ({}) SELECT due.*, e.first_name, e.last_name
           FROM due JOIN employees e ON e.id = due.employee_id
           WHERE due.retention_until < current_date
           ORDER BY due.retention_until, e.last_name"#,
        document_select("d.deleted_at IS NULL AND NOT d.legal_hold")
    );
    let rows = match sqlx::query(&sql).fetch_all(&state.db).await {
        Ok(rows) => rows,
        Err(error) => return internal(error, "list personnel retention"),
    };
    let documents: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut value = document_json(row, late);
            let first: String = row.try_get("first_name").unwrap_or_default();
            let last: String = row.try_get("last_name").unwrap_or_default();
            value["employee_name"] = json!(format!("{first} {last}").trim().to_string());
            value
        })
        .collect();
    Json(json!({
        "deletion_enabled": deletion_enabled(&state).await,
        "documents": documents,
    }))
    .into_response()
}

/// The signed-in employee's own file: every archived document, health
/// documents included, without the CEO's internal notes.
pub(crate) async fn get_own_file(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    let employee = match employee_for_user(&state, auth.user_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "No personnel file"),
        Err(error) => return internal(error, "load own personnel file"),
    };
    let late = late_days(&state).await;
    let documents = match list_employee_documents(&state, &employee, true, false, late).await {
        Ok(value) => value,
        Err(error) => return internal(error, "list own personnel documents"),
    };
    record_event_logged(
        &state,
        Some(employee.id),
        None,
        Some(auth.user_id),
        "own_file_viewed",
        json!({}),
    )
    .await;
    Json(json!({
        "employee": {
            "id": employee.id,
            "salutation": employee.salutation,
            "first_name": employee.first_name,
            "last_name": employee.last_name,
            "display_name": employee.display_name(),
            "personnel_number": employee.personnel_number,
            "employment_start": employee.employment_start,
            "employment_end": employee.employment_end,
        },
        "documents": documents,
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn employee(last: &str, first: &str) -> Employee {
        Employee {
            id: Uuid::nil(),
            user_id: None,
            salutation: "frau".into(),
            first_name: first.into(),
            last_name: last.into(),
            personnel_number: None,
            employment_start: None,
            employment_end: None,
            notes: None,
            user_name: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn target(monthly: bool, supersedes: Option<i32>) -> Target {
        Target {
            category: Category {
                code: "stundenzettel".into(),
                file_label: "Stundenzettel".into(),
                monthly,
                is_health: false,
                expected_monthly: monthly,
                retention_years: 6,
                retention_from: "document".into(),
                legal_basis: String::new(),
            },
            period_month: monthly.then(|| NaiveDate::from_ymd_opt(2026, 5, 1).unwrap()),
            document_date: (!monthly).then(|| NaiveDate::from_ymd_opt(2026, 5, 14).unwrap()),
            supersedes: supersedes.map(|version| (Uuid::nil(), version)),
            correction_reason: supersedes.map(|_| "typo".into()),
        }
    }

    #[test]
    fn names_follow_the_letter_and_avoid_duplicates() {
        let person = employee("Mustermann", "Gabriele");
        let mut taken = HashSet::new();
        let first = unique_archive_name(&person, &target(true, None), "pdf", &taken).unwrap();
        assert_eq!(first, "Stundenzettel_2026_05_Mustermann_Gabriele.pdf");
        taken.insert(first);
        let second = unique_archive_name(&person, &target(true, None), "pdf", &taken).unwrap();
        assert_eq!(second, "Stundenzettel_2026_05_Mustermann_Gabriele_2.pdf");
        let dated = unique_archive_name(&person, &target(false, None), "jpg", &taken).unwrap();
        assert_eq!(dated, "Stundenzettel_20260514_Mustermann_Gabriele.jpg");
    }

    #[test]
    fn versions_carry_their_number() {
        let person = employee("Mustermann", "Gabriele");
        let mut taken = HashSet::new();
        let v2 = unique_archive_name(&person, &target(true, Some(1)), "pdf", &taken).unwrap();
        assert_eq!(v2, "Stundenzettel_2026_05_Mustermann_Gabriele_V2.pdf");
        taken.insert(v2);
        let again = unique_archive_name(&person, &target(true, Some(1)), "pdf", &taken).unwrap();
        assert_eq!(again, "Stundenzettel_2026_05_Mustermann_Gabriele_V2_2.pdf");
    }

    #[test]
    fn download_names_are_ascii_safe() {
        let response = file_response(vec![1], "application/pdf", "Scan \"100\".pdf", false);
        let disposition = response
            .headers()
            .get(header::CONTENT_DISPOSITION)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(disposition, "attachment; filename=\"Scan__100_.pdf\"");
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
    }
}
