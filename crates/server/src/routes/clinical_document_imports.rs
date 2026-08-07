#![allow(clippy::result_large_err)]

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::{
        HeaderValue, StatusCode,
        header::{CACHE_CONTROL, PRAGMA},
    },
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use tower_http::set_header::SetResponseHeaderLayer;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::file_sniff::validate_upload_magic_bytes;
use crate::routes::documents::read_document_storage_bytes;
use crate::state::AppState;
use gmed_domain::role::Role;

const IMPORT_ROLES: &[Role] = &[Role::Ceo, Role::PatientManager, Role::ItAdmin];
const UNSUPPORTED_IMPORT_FILE: &str =
    "Clinical import supports only PDF, PNG, and JPEG documents";
const MAX_IMPORT_FILE_BYTES: usize = 25 * 1024 * 1024;

fn validate_clinical_import_file(
    original_filename: Option<&str>,
    mime_type: Option<&str>,
    data: &[u8],
) -> Result<(), &'static str> {
    let mime_type = mime_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        mime_type.as_str(),
        "application/pdf" | "image/png" | "image/jpeg"
    ) {
        return Err(UNSUPPORTED_IMPORT_FILE);
    }

    let validated_mime =
        validate_upload_magic_bytes(original_filename, Some(mime_type.as_str()), data)?
            .ok_or(UNSUPPORTED_IMPORT_FILE)?;
    if matches!(
        validated_mime.as_str(),
        "application/pdf" | "image/png" | "image/jpeg"
    ) {
        Ok(())
    } else {
        Err(UNSUPPORTED_IMPORT_FILE)
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/clinical-document-imports",
            get(list_imports).post(create_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}",
            get(get_import).delete(delete_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}/retry",
            post(retry_import),
        )
        .route(
            "/patients/{patient_id}/clinical-document-imports/{import_id}/complete",
            post(complete_import),
        )
        .layer(SetResponseHeaderLayer::overriding(
            PRAGMA,
            HeaderValue::from_static("no-cache"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("private, no-store, max-age=0"),
        ))
}

#[derive(Deserialize)]
struct CreateImportRequest {
    document_id: Uuid,
}

#[derive(Deserialize)]
struct CompleteImportRequest {
    reviewed_draft: Value,
}

#[derive(Deserialize)]
struct ReviewedCandidate {
    id: String,
    target: String,
    value: String,
    #[serde(default = "default_selected")]
    selected: bool,
}

fn default_selected() -> bool {
    true
}

fn is_manual_candidate_id(value: &str) -> bool {
    value
        .strip_prefix("manual:")
        .and_then(|id| Uuid::parse_str(id).ok())
        .is_some()
}

async fn ensure_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    auth.require_any_role(IMPORT_ROLES)?;
    if auth.role.has_full_access() || !access::requires_patient_assignment(auth.role) {
        return Ok(());
    }
    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "validate clinical document import access");
            Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate patient access"))
        }
    }
}

async fn create_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<CreateImportRequest>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }

    let document = match sqlx::query(
        r#"SELECT id, patient_id, is_medical, storage_key, mime_type,
                  original_filename, auto_name
           FROM documents
           WHERE id = $1 AND file_deleted_at IS NULL"#,
    )
    .bind(body.document_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(error) => {
            tracing::error!(error = %error, document_id = %body.document_id, "load import source document");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load document");
        }
    };
    let document_patient_id: Option<Uuid> = document.try_get("patient_id").unwrap_or_default();
    if document_patient_id != Some(patient_id) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document does not belong to this patient",
        );
    }
    if !document.try_get::<bool, _>("is_medical").unwrap_or(false) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Clinical import requires a medical document",
        );
    }
    let Some(storage_key) = document
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default()
    else {
        return err(StatusCode::CONFLICT, "Document file is unavailable");
    };
    let mime_type = document
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default();
    let original_filename = document
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default();
    let auto_name = document
        .try_get::<Option<String>, _>("auto_name")
        .unwrap_or_default();
    let data = match read_document_storage_bytes(
        body.document_id,
        storage_key.as_str(),
        mime_type.as_deref(),
        original_filename.as_deref(),
        auto_name.as_deref(),
    )
    .await
    {
        Ok(data) => data,
        Err(error) => {
            tracing::error!(error = %error, document_id = %body.document_id, "read clinical import source document");
            return err(StatusCode::CONFLICT, "Document file is unavailable");
        }
    };
    if data.len() > MAX_IMPORT_FILE_BYTES {
        return err(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Document exceeds the clinical import size limit",
        );
    }
    if let Err(message) = validate_clinical_import_file(
        original_filename.as_deref(),
        mime_type.as_deref(),
        &data,
    ) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }

    let row = match sqlx::query(
        r#"INSERT INTO clinical_document_imports
               (patient_id, document_id, requested_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (document_id) WHERE status IN ('queued', 'processing', 'review_required')
                                             AND deleted_at IS NULL
           DO UPDATE SET updated_at = clinical_document_imports.updated_at
           RETURNING id, patient_id, document_id, status, document_type, source_language,
                     parser_version, draft, reviewed_draft, applied_counts, error_message, worker_id,
                     requested_by, reviewed_by, applied_by, locked_at, completed_at,
                     applied_at, created_at, updated_at"#,
    )
    .bind(patient_id)
    .bind(body.document_id)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, document_id = %body.document_id, "create clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create import");
        }
    };

    let import_id: Uuid = row.get("id");
    state.audit_sender.try_send(audit::domain_event(
        "clinical_document_import_requested",
        Some(auth.user_id),
        "clinical_document_import",
        Some(import_id),
        json!({ "patient_id": patient_id, "document_id": body.document_id }),
    ));

    (StatusCode::CREATED, Json(import_json(&row))).into_response()
}

async fn list_imports(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    match sqlx::query(&format!(
        "{} WHERE i.patient_id = $1 AND i.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 50",
        import_list_select()
    ))
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(json!({
            "items": rows.iter().map(import_summary_json).collect::<Vec<_>>()
        }))
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_id, "list clinical document imports");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load imports")
        }
    }
}

async fn get_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    match fetch_import(&state, patient_id, import_id).await {
        Ok(Some(row)) => Json(import_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Import not found"),
        Err(response) => response,
    }
}

async fn delete_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }

    let row = match sqlx::query(
        r#"UPDATE clinical_document_imports
           SET deleted_at = now(), worker_id = NULL, locked_at = NULL, updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
           RETURNING document_id, status"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Import not found"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, patient_id = %patient_id, "delete clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete import");
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "clinical_document_import_deleted",
        Some(auth.user_id),
        "clinical_document_import",
        Some(import_id),
        json!({
            "patient_id": patient_id,
            "document_id": row.get::<Uuid, _>("document_id"),
            "previous_status": row.get::<String, _>("status"),
        }),
    ));

    StatusCode::NO_CONTENT.into_response()
}

async fn retry_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    let row = match sqlx::query(
        r#"UPDATE clinical_document_imports
           SET status = 'queued', error_message = NULL, worker_id = NULL,
               locked_at = NULL, completed_at = NULL, updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND status = 'failed' AND deleted_at IS NULL
           RETURNING id, patient_id, document_id, status, document_type, source_language,
                     parser_version, draft, reviewed_draft, applied_counts, error_message, worker_id,
                     requested_by, reviewed_by, applied_by, locked_at, completed_at,
                     applied_at, created_at, updated_at"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Only failed imports can be retried"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "retry clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to retry import");
        }
    };
    Json(import_json(&row)).into_response()
}

async fn complete_import(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, import_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CompleteImportRequest>,
) -> axum::response::Response {
    if let Err(response) = ensure_access(&state, &auth, patient_id).await {
        return response;
    }
    let candidates = match body
        .reviewed_draft
        .get("candidates")
        .and_then(Value::as_array)
    {
        Some(candidates) if candidates.len() <= 500 => candidates,
        Some(_) => {
            return err(
                StatusCode::PAYLOAD_TOO_LARGE,
                "A maximum of 500 reviewed candidates is allowed",
            );
        }
        None => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "reviewed_draft.candidates must be an array",
            );
        }
    };
    let mut reviewed = Vec::with_capacity(candidates.len());
    let mut reviewed_ids = HashSet::with_capacity(candidates.len());
    for candidate in candidates {
        let candidate = match serde_json::from_value::<ReviewedCandidate>(candidate.clone()) {
            Ok(candidate) => candidate,
            Err(_) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Each reviewed candidate requires id, target, value and selected",
                );
            }
        };
        if candidate.id.len() > 128
            || candidate.value.trim().is_empty()
            || candidate.value.len() > 20_000
            || !matches!(
                candidate.target.as_str(),
                "diagnosis" | "anamnesis" | "medication" | "examination" | "recommendation"
            )
            || !reviewed_ids.insert(candidate.id.clone())
        {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid reviewed candidate");
        }
        reviewed.push(candidate);
    }
    let selected = reviewed
        .iter()
        .filter(|candidate| candidate.selected)
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Select at least one clinical candidate",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "begin clinical document import completion");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to complete import");
        }
    };
    let import_row = match sqlx::query(
        r#"SELECT document_id, draft
           FROM clinical_document_imports
           WHERE id = $1 AND patient_id = $2 AND status = 'review_required'
             AND deleted_at IS NULL
           FOR UPDATE"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Import is not ready for review"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "lock clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to complete import");
        }
    };
    let document_id: Uuid = import_row.get("document_id");
    let stored_draft: Value = import_row.get("draft");
    let stored_candidates = stored_draft
        .get("candidates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let stored_targets = stored_candidates
        .iter()
        .filter_map(|candidate| {
            Some((
                candidate.get("id")?.as_str()?.to_string(),
                candidate.get("target")?.as_str()?.to_string(),
            ))
        })
        .collect::<HashMap<_, _>>();
    if reviewed.iter().any(|candidate| {
        stored_targets.get(&candidate.id) != Some(&candidate.target)
            && !is_manual_candidate_id(&candidate.id)
    }) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reviewed candidates do not match the parser draft",
        );
    }

    let mut applied_counts = serde_json::Map::new();
    for candidate in selected {
        let marker = format!("[clinical-import:{import_id}:{}]", candidate.id);
        let result = match candidate.target.as_str() {
            "diagnosis" => {
                sqlx::query(
                    r#"UPDATE patient_diagnoses
                       SET source_document_id = $1, source_import_id = $2, source_candidate_id = $3
                       WHERE id = (
                           SELECT id FROM patient_diagnoses
                           WHERE patient_id = $4 AND note LIKE '%' || $5 || '%'
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(&marker)
                .execute(&mut *tx)
                .await
            }
            "medication" => {
                sqlx::query(
                    r#"UPDATE patient_medications
                       SET source_document_id = $1, source_import_id = $2, source_candidate_id = $3
                       WHERE id = (
                           SELECT id FROM patient_medications
                           WHERE patient_id = $4 AND hinweis LIKE '%' || $5 || '%'
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(&marker)
                .execute(&mut *tx)
                .await
            }
            "examination" => {
                sqlx::query(
                    r#"UPDATE patient_examinations
                       SET source_document_id = $1, source_import_id = $2, source_candidate_id = $3
                       WHERE id = (
                           SELECT id FROM patient_examinations
                           WHERE patient_id = $4 AND note LIKE '%' || $5 || '%'
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(&marker)
                .execute(&mut *tx)
                .await
            }
            "anamnesis" => {
                sqlx::query(
                    r#"UPDATE patient_clinical_narrative
                       SET source_document_id = $1, source_import_id = $2
                       WHERE id = (
                           SELECT id FROM patient_clinical_narrative
                           WHERE patient_id = $3 AND is_active
                             AND position($4 in COALESCE(anamnese_aktuelle, '')) > 0
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(document_id)
                .bind(import_id)
                .bind(patient_id)
                .bind(candidate.value.trim())
                .execute(&mut *tx)
                .await
            }
            "recommendation" => {
                sqlx::query(
                    r#"UPDATE patient_recommendations
                       SET source_import_id = $1, source_candidate_id = $2
                       WHERE id = (
                           SELECT id FROM patient_recommendations
                           WHERE patient_id = $3 AND source_document_id = $4
                             AND description = $5
                           ORDER BY created_at DESC LIMIT 1
                       )"#,
                )
                .bind(import_id)
                .bind(&candidate.id)
                .bind(patient_id)
                .bind(document_id)
                .bind(candidate.value.trim())
                .execute(&mut *tx)
                .await
            }
            _ => unreachable!(),
        };
        match result {
            Ok(result) if result.rows_affected() == 1 => {
                let key = match candidate.target.as_str() {
                    "diagnosis" => "diagnoses",
                    "anamnesis" => "anamnesis",
                    "medication" => "medications",
                    "examination" => "examinations",
                    "recommendation" => "recommendations",
                    _ => unreachable!(),
                };
                let count = applied_counts.get(key).and_then(Value::as_u64).unwrap_or(0) + 1;
                applied_counts.insert(key.to_string(), json!(count));
            }
            Ok(_) => {
                return err(
                    StatusCode::CONFLICT,
                    "Not all reviewed candidates were persisted; retry the apply step",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, import_id = %import_id, candidate_id = %candidate.id, "attach clinical import provenance");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to complete import");
            }
        }
    }
    let applied_counts = Value::Object(applied_counts);
    let row = match sqlx::query(
        r#"UPDATE clinical_document_imports
           SET status = 'applied', reviewed_draft = $3, reviewed_by = $4,
               applied_by = $4, applied_counts = $5, applied_at = now(), updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND status = 'review_required'
             AND deleted_at IS NULL
           RETURNING id, patient_id, document_id, status, document_type, source_language,
                     parser_version, draft, reviewed_draft, applied_counts, error_message, worker_id,
                     requested_by, reviewed_by, applied_by, locked_at, completed_at,
                     applied_at, created_at, updated_at"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .bind(&body.reviewed_draft)
    .bind(auth.user_id)
    .bind(&applied_counts)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Import is not ready for review"),
        Err(error) => {
            tracing::error!(error = %error, import_id = %import_id, "complete clinical document import");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to complete import");
        }
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, import_id = %import_id, "commit clinical document import completion");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to complete import");
    }

    state.audit_sender.try_send(audit::domain_event(
        "clinical_document_import_applied",
        Some(auth.user_id),
        "clinical_document_import",
        Some(import_id),
        json!({
            "patient_id": patient_id,
            "document_id": row.get::<Uuid, _>("document_id"),
            "applied_counts": applied_counts,
        }),
    ));
    Json(import_json(&row)).into_response()
}

async fn fetch_import(
    state: &AppState,
    patient_id: Uuid,
    import_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(&format!(
        "{} WHERE i.id = $1 AND i.patient_id = $2 AND i.deleted_at IS NULL",
        import_select()
    ))
        .bind(import_id)
        .bind(patient_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, import_id = %import_id, "load clinical document import");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load import")
        })
}

fn import_select() -> &'static str {
    r#"SELECT i.id, i.patient_id, i.document_id, i.status, i.document_type,
              i.source_language, i.parser_version, i.draft, i.reviewed_draft,
              i.applied_counts, i.error_message, i.worker_id, i.requested_by, i.reviewed_by,
              i.applied_by, i.locked_at, i.completed_at, i.applied_at,
              i.created_at, i.updated_at,
              d.original_filename AS document_name, d.mime_type
       FROM clinical_document_imports i
       JOIN documents d ON d.id = i.document_id"#
}

fn import_list_select() -> &'static str {
    r#"SELECT i.id, i.patient_id, i.document_id, i.status, i.document_type,
              i.source_language, i.parser_version, i.applied_counts, i.error_message,
              i.completed_at, i.applied_at, i.created_at, i.updated_at,
              COALESCE(jsonb_array_length(i.draft->'candidates'), 0)::bigint AS candidate_count,
              d.original_filename AS document_name, d.mime_type
       FROM clinical_document_imports i
       JOIN documents d ON d.id = i.document_id"#
}

fn import_summary_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<Uuid, _>("id"),
        "patient_id": row.get::<Uuid, _>("patient_id"),
        "document_id": row.get::<Uuid, _>("document_id"),
        "document_name": row.try_get::<String, _>("document_name").ok(),
        "mime_type": row.try_get::<String, _>("mime_type").ok(),
        "status": row.get::<String, _>("status"),
        "document_type": row.get::<Option<String>, _>("document_type"),
        "source_language": row.get::<Option<String>, _>("source_language"),
        "parser_version": row.get::<Option<String>, _>("parser_version"),
        "candidate_count": row.get::<i64, _>("candidate_count"),
        "applied_counts": row.get::<Value, _>("applied_counts"),
        "error_message": row.get::<Option<String>, _>("error_message"),
        "completed_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at"),
        "applied_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("applied_at"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
    })
}

fn import_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<Uuid, _>("id"),
        "patient_id": row.get::<Uuid, _>("patient_id"),
        "document_id": row.get::<Uuid, _>("document_id"),
        "document_name": row.try_get::<String, _>("document_name").ok(),
        "mime_type": row.try_get::<String, _>("mime_type").ok(),
        "status": row.get::<String, _>("status"),
        "document_type": row.get::<Option<String>, _>("document_type"),
        "source_language": row.get::<Option<String>, _>("source_language"),
        "parser_version": row.get::<Option<String>, _>("parser_version"),
        "draft": row.get::<Value, _>("draft"),
        "reviewed_draft": row.get::<Option<Value>, _>("reviewed_draft"),
        "applied_counts": row.get::<Value, _>("applied_counts"),
        "error_message": row.get::<Option<String>, _>("error_message"),
        "requested_by": row.get::<Uuid, _>("requested_by"),
        "reviewed_by": row.get::<Option<Uuid>, _>("reviewed_by"),
        "applied_by": row.get::<Option<Uuid>, _>("applied_by"),
        "locked_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("locked_at"),
        "completed_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at"),
        "applied_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("applied_at"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
    })
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{is_manual_candidate_id, validate_clinical_import_file};

    #[test]
    fn accepts_only_namespaced_uuid_manual_candidate_ids() {
        assert!(is_manual_candidate_id(
            "manual:63f71b6c-b947-4ef3-87ef-c0e6eed6ceeb"
        ));
        assert!(!is_manual_candidate_id(
            "63f71b6c-b947-4ef3-87ef-c0e6eed6ceeb"
        ));
        assert!(!is_manual_candidate_id("manual:not-a-uuid"));
    }

    #[test]
    fn accepts_supported_import_magic_bytes() {
        assert!(
            validate_clinical_import_file(
                Some("report.pdf"),
                Some("application/pdf"),
                b"%PDF-1.7\n",
            )
            .is_ok()
        );
        assert!(
            validate_clinical_import_file(
                Some("scan.png"),
                Some("image/png"),
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
            )
            .is_ok()
        );
        assert!(
            validate_clinical_import_file(
                Some("scan.jpg"),
                Some("image/jpeg"),
                &[0xFF, 0xD8, 0xFF],
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_unsupported_or_mismatched_imports() {
        assert!(
            validate_clinical_import_file(
                Some("report.html"),
                Some("text/html"),
                b"<html></html>",
            )
            .is_err()
        );
        assert!(
            validate_clinical_import_file(
                Some("report.pdf"),
                Some("application/pdf"),
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
            )
            .is_err()
        );
    }
}
