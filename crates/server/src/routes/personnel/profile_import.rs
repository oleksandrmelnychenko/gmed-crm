//! Import of documents already kept on an employee's interpreter profile
//! (employment contract / AVV, work permit, confidentiality, credentials)
//! into the personnel file.
//!
//! The file is copied into its own sealed blob, so the archive does not
//! depend on the profile document's lifecycle; `source_document_id` records
//! where it came from and keeps a profile document from being imported twice.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::documents::{Blob, TargetFields, accept_file, archive, resolve_target, sha256_hex};
use super::{Employee, err, internal, load_employee};
use crate::{
    auth::middleware::AuthUser,
    routes::documents::{read_document_storage_bytes, remove_document_blob, store_document_blob},
    state::AppState,
};
use gmed_domain::access::capabilities::Capability;

/// The personnel category a profile document most likely belongs to; the
/// CEO confirms or changes it when importing.
pub(crate) fn suggested_category(kind: &str) -> &'static str {
    match kind {
        // The profile labels this kind "AVV / Arbeitsvertrag".
        "avv" => "arbeitsvertrag",
        _ => "sonstiges",
    }
}

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

const PROFILE_DOCUMENTS: &str = r#"SELECT d.id, d.auto_name, d.original_filename, d.mime_type,
              d.storage_key, d.file_size, d.document_date, d.created_at, ipd.document_kind,
              EXISTS (
                  SELECT 1 FROM personnel_documents p
                  WHERE p.employee_id = $2 AND p.source_document_id = d.id
              ) AS imported
       FROM interpreter_profile_documents ipd
       JOIN documents d ON d.id = ipd.document_id
       WHERE ipd.interpreter_id = $1
         AND d.file_deleted_at IS NULL"#;

/// Profile documents of the employee's linked account.
pub(crate) async fn list_importable(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(employee_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let employee = match load_employee_or_404(&state, employee_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(user_id) = employee.user_id else {
        return Json(json!([])).into_response();
    };
    let rows = match sqlx::query(&format!("{PROFILE_DOCUMENTS} ORDER BY d.created_at DESC"))
        .bind(user_id)
        .bind(employee.id)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows,
        Err(error) => return internal(error, "list profile documents"),
    };
    Json(
        rows.iter()
            .map(|row| {
                let kind: String = row.try_get("document_kind").unwrap_or_default();
                json!({
                    "document_id": row.try_get::<Uuid, _>("id").ok(),
                    "document_kind": kind,
                    "suggested_category": suggested_category(&kind),
                    "title": row.try_get::<String, _>("auto_name").unwrap_or_default(),
                    "original_file_name": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
                    "mime_type": row.try_get::<Option<String>, _>("mime_type").unwrap_or_default(),
                    "file_size": row.try_get::<Option<i64>, _>("file_size").unwrap_or_default(),
                    "document_date": row.try_get::<Option<NaiveDate>, _>("document_date").unwrap_or_default(),
                    "uploaded_at": row
                        .try_get::<DateTime<Utc>, _>("created_at")
                        .map(|value| value.to_rfc3339())
                        .ok(),
                    "imported": row.try_get::<bool, _>("imported").unwrap_or(false),
                })
            })
            .collect::<Vec<Value>>(),
    )
    .into_response()
}

#[derive(Deserialize)]
pub(crate) struct ImportRequest {
    document_id: Uuid,
    category: Option<String>,
    period: Option<String>,
    document_date: Option<String>,
    title: Option<String>,
}

pub(crate) async fn import_profile_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(employee_id): Path<Uuid>,
    Json(body): Json<ImportRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let employee = match load_employee_or_404(&state, employee_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(user_id) = employee.user_id else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The personnel file is not linked to an account with a profile",
        );
    };
    let row = match sqlx::query(&format!("{PROFILE_DOCUMENTS} AND d.id = $3"))
        .bind(user_id)
        .bind(employee.id)
        .bind(body.document_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Profile document not found"),
        Err(error) => return internal(error, "load profile document"),
    };
    if row.try_get::<bool, _>("imported").unwrap_or(false) {
        return err(
            StatusCode::CONFLICT,
            "This profile document is already in the personnel file",
        );
    }
    let fields = TargetFields {
        category: body.category,
        period: body.period,
        document_date: body.document_date,
        supersedes_id: None,
        correction_reason: None,
    };
    let target = match resolve_target(&state, &auth, &employee, &fields).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let storage_key: String = row.try_get("storage_key").unwrap_or_default();
    let original: String = row
        .try_get::<Option<String>, _>("original_filename")
        .ok()
        .flatten()
        .unwrap_or_else(|| row.try_get("auto_name").unwrap_or_default());
    let claimed_mime: String = row
        .try_get::<Option<String>, _>("mime_type")
        .ok()
        .flatten()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let bytes = match read_document_storage_bytes(
        body.document_id,
        &storage_key,
        Some(&claimed_mime),
        Some(&original),
        None,
    )
    .await
    {
        Ok(bytes) => bytes,
        Err(error) => return internal(error, "read profile document"),
    };
    let mime_type = match accept_file(&original, &claimed_mime, &bytes).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (file_size, new_key, original_file_name) =
        match store_document_blob(&bytes, &original).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    let blob = Blob {
        storage_key: new_key,
        original_file_name,
        mime_type,
        file_size,
        sha256: sha256_hex(&bytes),
        source_document_id: Some(body.document_id),
    };
    let title = body
        .title
        .map(|value| value.trim().chars().take(255).collect::<String>())
        .filter(|value| !value.is_empty());
    match archive(
        &state,
        &auth,
        &employee,
        &target,
        &blob,
        title.as_deref(),
        "import",
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

#[cfg(test)]
mod tests {
    use super::suggested_category;

    #[test]
    fn contracts_are_suggested_as_employment_contracts() {
        assert_eq!(suggested_category("avv"), "arbeitsvertrag");
        for kind in [
            "work_permit",
            "confidentiality",
            "credential",
            "gdpr_training",
            "other",
        ] {
            assert_eq!(suggested_category(kind), "sonstiges", "{kind}");
        }
    }
}
