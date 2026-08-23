use axum::{
    Json, Router,
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
        MAX_FILE_SIZE, NewStoredDocument, persist_document_file, remove_document_blob,
    },
    state::AppState,
};
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/providers/{provider_id}/documents",
            get(list_provider_documents).post(upload_provider_document),
        )
        .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024))
}

#[derive(Deserialize)]
struct ProviderDocumentQuery {
    patient_id: Option<Uuid>,
    q: Option<String>,
}

async fn list_provider_documents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    Query(query): Query<ProviderDocumentQuery>,
) -> axum::response::Response {
    if let Err(response) = require_provider_document_view_role(&auth) {
        return response;
    }
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));
    let rows = match sqlx::query(
        r#"SELECT document.id, document.patient_id, document.auto_name,
                  document.original_filename, document.art, document.category,
                  document.status, document.visibility, document.is_medical,
                  document.mime_type, document.file_size, document.document_date,
                  document.notes, document.created_at, document.updated_at,
                  uploader.name AS uploaded_by_name,
                  NULLIF(BTRIM(CONCAT_WS(' ', patient.first_name, patient.last_name)), '') AS patient_name,
                  patient.patient_id AS patient_number
           FROM provider_document_links link
           JOIN documents document ON document.id = link.document_id
           JOIN users uploader ON uploader.id = document.uploaded_by
           LEFT JOIN patients patient ON patient.id = document.patient_id
           WHERE link.provider_id = $1
             AND document.file_deleted_at IS NULL
             AND ($2::uuid IS NULL OR document.patient_id = $2)
             AND ($3::text IS NULL
                  OR document.auto_name ILIKE $3
                  OR COALESCE(document.original_filename, '') ILIKE $3
                  OR COALESCE(patient.patient_id, '') ILIKE $3
                  OR CONCAT_WS(' ', patient.first_name, patient.last_name) ILIKE $3)
           ORDER BY document.created_at DESC"#,
    )
    .bind(provider_id)
    .bind(query.patient_id)
    .bind(search)
    .fetch_all(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, provider_id = %provider_id, "list provider documents");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load provider documents");
        }
    };
    Json(rows.iter().filter_map(|row| Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok()?,
        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
        "patient_name": row.try_get::<Option<String>, _>("patient_name").unwrap_or_default(),
        "patient_number": row.try_get::<Option<String>, _>("patient_number").unwrap_or_default(),
        "auto_name": row.try_get::<String, _>("auto_name").ok()?,
        "original_filename": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
        "art": row.try_get::<String, _>("art").unwrap_or_default(),
        "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "visibility": row.try_get::<String, _>("visibility").unwrap_or_default(),
        "is_medical": row.try_get::<bool, _>("is_medical").unwrap_or(false),
        "mime_type": row.try_get::<Option<String>, _>("mime_type").unwrap_or_default(),
        "file_size": row.try_get::<Option<i64>, _>("file_size").unwrap_or_default(),
        "document_date": row.try_get::<Option<chrono::NaiveDate>, _>("document_date").unwrap_or_default().map(|value| value.to_string()),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "uploaded_by_name": row.try_get::<String, _>("uploaded_by_name").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").ok()?.to_rfc3339(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").ok()?.to_rfc3339(),
    }))).collect::<Vec<_>>()).into_response()
}

async fn upload_provider_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(response) = require_provider_document_upload_role(&auth) {
        return response;
    }
    let provider_name = match sqlx::query_scalar::<_, String>(
        "SELECT name FROM providers WHERE id = $1",
    )
    .bind(provider_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Provider not found"),
        Err(error) => {
            tracing::error!(error = %error, provider_id = %provider_id, "load provider for document upload");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let mut file: Option<(String, String, Vec<u8>)> = None;
    let mut patient_id: Option<Uuid> = None;
    let mut title: Option<String> = None;
    let mut notes: Option<String> = None;
    let mut is_medical = false;
    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or("") {
            "file" => {
                let name = field.file_name().unwrap_or("document").trim().to_string();
                let mime = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let bytes = match field.bytes().await {
                    Ok(value) if !value.is_empty() && value.len() <= MAX_FILE_SIZE => {
                        value.to_vec()
                    }
                    Ok(value) if value.len() > MAX_FILE_SIZE => {
                        return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large");
                    }
                    _ => return err(StatusCode::BAD_REQUEST, "Failed to read file"),
                };
                file = Some((name, mime, bytes));
            }
            "patient_id" => {
                patient_id = field
                    .text()
                    .await
                    .ok()
                    .and_then(|value| Uuid::parse_str(value.trim()).ok());
            }
            "title" => title = normalized(field.text().await.ok(), 255),
            "notes" => notes = normalized(field.text().await.ok(), 4_000),
            "is_medical" => {
                is_medical = field
                    .text()
                    .await
                    .ok()
                    .is_some_and(|value| matches!(value.trim(), "true" | "1"));
            }
            _ => {}
        }
    }
    let Some((file_name, claimed_mime, data)) = file else {
        return err(StatusCode::BAD_REQUEST, "No file uploaded");
    };
    if is_medical && patient_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "patient_id is required for a medical document",
        );
    }
    if let Some(patient_id) = patient_id {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
                .bind(patient_id)
                .fetch_one(&state.db)
                .await
                .unwrap_or(false);
        if !exists {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Patient not found");
        }
    }
    let mime_type = match validate_upload_magic_bytes(Some(&file_name), Some(&claimed_mime), &data)
    {
        Ok(Some(value)) => value,
        Ok(None) => claimed_mime,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    match scan_upload_bytes(Some(&file_name), &data).await {
        Ok(FileScanOutcome::Clean) => {}
        Ok(FileScanOutcome::Skipped) => {
            tracing::warn!(file_name = %file_name, "virus scanner unavailable; provider document scan skipped")
        }
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    }
    let auto_name = title.unwrap_or_else(|| file_name.clone());
    let input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id,
        lead_id: None,
        order_id: None,
        appointment_id: None,
        auto_name: &auto_name,
        original_filename: &file_name,
        art: if is_medical {
            "medical_document"
        } else {
            "provider_document"
        },
        category: Some(if is_medical { "medical" } else { "provider" }),
        status: "active",
        visibility: "internal",
        is_medical,
        mime_type: &mime_type,
        klinik: Some(&provider_name),
        ursprung: Some("provider_upload"),
        notes: notes.as_deref(),
        document_direction: Some("incoming"),
        document_variant: Some("original"),
        document_language: None,
        access_category: Some(if is_medical { "medical" } else { "provider" }),
        document_date: None,
        source_person: None,
        source_institution: Some(&provider_name),
        addressee_person: None,
        addressee_institution: Some("GMED"),
        financial_status: None,
        payment_due_date: None,
        payment_date: None,
        payment_method: None,
        generated_template_id: None,
        generated_bindings: None,
        generated_manual_text: None,
        version_root_document_id: None,
        replaces_document_id: None,
        version_number: 1,
        uploaded_by: auth.user_id,
    };
    let (document_id, _, _, storage_key) = match persist_document_file(&state, &data, &input).await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(error) = sqlx::query(
        "INSERT INTO provider_document_links (provider_id, document_id, linked_by) VALUES ($1, $2, $3)",
    )
    .bind(provider_id)
    .bind(document_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %error, provider_id = %provider_id, document_id = %document_id, "link provider document");
        let _ = sqlx::query("DELETE FROM documents WHERE id = $1").bind(document_id).execute(&state.db).await;
        remove_document_blob(&storage_key).await;
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to link document");
    }
    state.audit_sender.try_send(audit::domain_event(
        "upload_provider_document",
        Some(auth.user_id),
        "document",
        Some(document_id),
        serde_json::json!({
            "provider_id": provider_id,
            "patient_id": patient_id,
            "is_medical": is_medical,
        }),
    ));
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": document_id, "provider_id": provider_id, "patient_id": patient_id })),
    )
        .into_response()
}

fn normalized(value: Option<String>, max: usize) -> Option<String> {
    value
        .map(|value| value.trim().chars().take(max).collect::<String>())
        .filter(|value| !value.is_empty())
}

#[allow(clippy::result_large_err)]
fn require_provider_document_view_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::Concierge,
        Role::Billing,
        Role::PatientManager,
        Role::Sales,
        Role::ItAdmin,
    ])
}

#[allow(clippy::result_large_err)]
fn require_provider_document_upload_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::ItAdmin])
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}
