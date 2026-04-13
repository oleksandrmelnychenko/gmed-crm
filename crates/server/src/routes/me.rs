use std::path::Path as FsPath;

use axum::{
    Json, Router,
    body::Body,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::routes::patients::{
    load_patient_document_alerts_summary, patient_document_alerts_payload,
};
use crate::state::AppState;
use gmed_domain::role::Role;

const DOCUMENT_UPLOAD_DIR: &str = "uploads/documents";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me", get(get_me))
        .route("/me/export", get(export_my_data))
        .route(
            "/me/privacy-requests",
            get(list_my_privacy_requests).post(create_my_privacy_request),
        )
        .route("/me/document-alerts", get(list_my_document_alerts))
        .route("/me/documents", get(list_my_documents))
        .route("/me/documents/{id}/download", get(download_my_document))
        .route(
            "/me/documents/{id}/confirm",
            post(confirm_my_document_release),
        )
}

async fn get_me(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> impl IntoResponse {
    match sqlx::query!(
        "SELECT id, email, name, role, created_at FROM users WHERE id = $1 AND is_active = true",
        auth.user_id
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(u)) => Json(serde_json::json!({
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "created_at": u.created_at,
        }))
        .into_response(),

        Ok(None) => {
            tracing::warn!(user_id = %auth.user_id, "JWT valid but user not found or deactivated");
            (
                StatusCode::UNAUTHORIZED,
                Json(
                    serde_json::json!({ "error": "unauthorized", "message": "Account not found" }),
                ),
            )
                .into_response()
        }

        Err(e) => {
            tracing::error!(error = %e, "DB error in /me");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "internal", "message": "An internal error occurred" })),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
struct CreateMyPrivacyRequestRequest {
    request_type: String,
    reason: Option<String>,
}

#[derive(Deserialize, Default)]
struct ExportMyDataQuery {
    format: Option<String>,
}

async fn list_my_privacy_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        r#"SELECT id, request_type, source, status, reason, due_at, retention_until,
                  requested_at, reviewed_at, executed_at
           FROM patient_privacy_requests
           WHERE patient_id = $1
           ORDER BY created_at DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "request_type": row.try_get::<String, _>("request_type").unwrap_or_default(),
                        "source": row.try_get::<String, _>("source").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "reason": row.try_get::<Option<String>, _>("reason").unwrap_or_default(),
                        "due_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("due_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "retention_until": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_until").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "requested_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("requested_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "reviewed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("reviewed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "executed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("executed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list my privacy requests");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load privacy requests",
            )
        }
    }
}

async fn create_my_privacy_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateMyPrivacyRequestRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let request_type = match normalize_privacy_request_type(&body.request_type) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let reason = normalize_optional(body.reason.as_deref());
    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let open_request_exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1
               FROM patient_privacy_requests
               WHERE patient_id = $1
                 AND request_type = $2
                 AND status IN ('requested', 'retention_hold', 'approved')
           )"#,
    )
    .bind(patient_id)
    .bind(&request_type)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if open_request_exists {
        return err(
            StatusCode::CONFLICT,
            "An open privacy request of this type already exists",
        );
    }

    let due_days = load_numeric_setting(&state, "patient_erasure_due_days", 30).await;
    let due_at = Utc::now() + Duration::days(due_days.max(1));

    let request_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_privacy_requests (
                patient_id, requested_by, request_type, source, status, reason, due_at, context
           ) VALUES (
                $1, $2, $3, 'patient_request', 'requested', $4, $5, $6
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(&request_type)
    .bind(reason.clone())
    .bind(due_at)
    .bind(serde_json::json!({
        "created_via": "patient_self_service",
    }))
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(sqlx::Error::Database(db_err)) if db_err.code().as_deref() == Some("23505") => {
            return err(
                StatusCode::CONFLICT,
                "An open privacy request of this type already exists",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, patient_id = %patient_id, "create self privacy request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create privacy request",
            );
        }
    };

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'privacy_request_created', 'patient', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(patient_id)
    .bind(serde_json::json!({
        "request_id": request_id,
        "request_type": request_type,
        "source": "patient_request",
        "reason": reason,
        "due_at": due_at.to_rfc3339(),
        "created_via": "patient_self_service",
    }))
    .execute(&state.db)
    .await;

    let patient_label = load_patient_label(&state, patient_id)
        .await
        .unwrap_or_else(|| "Patient".to_string());
    let notification_title = match request_type.as_str() {
        "restriction" => format!("Patient restriction request: {patient_label}"),
        "third_party_revoke" => {
            format!("Patient third-party revoke request: {patient_label}")
        }
        _ => format!("Patient GDPR request: {patient_label}"),
    };
    let notification_body = match request_type.as_str() {
        "restriction" => format!(
            "The patient submitted a processing restriction request. Due by {}.",
            due_at.format("%Y-%m-%d")
        ),
        "third_party_revoke" => format!(
            "The patient requested revocation of third-party sharing consents. Due by {}.",
            due_at.format("%Y-%m-%d")
        ),
        _ => format!(
            "The patient submitted an erasure request. Due by {}.",
            due_at.format("%Y-%m-%d")
        ),
    };

    let _ = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT pa.user_id, 'privacy_request', $2, $3, 'patient', $1
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role IN ('patient_manager', 'ceo')"#,
    )
    .bind(patient_id)
    .bind(notification_title)
    .bind(notification_body)
    .execute(&state.db)
    .await;

    let response = serde_json::json!({
        "id": request_id,
        "request_type": request_type,
        "source": "patient_request",
        "status": "requested",
        "reason": reason,
        "due_at": due_at.to_rfc3339(),
    });

    (StatusCode::CREATED, Json(response)).into_response()
}

async fn export_my_data(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ExportMyDataQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let format =
        match crate::routes::admin_compliance::parse_patient_export_format(query.format.as_deref())
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    match crate::routes::admin_compliance::export_patient_data_response(
        &state,
        patient_id,
        auth.user_id,
        format,
    )
    .await
    {
        Ok(response) => response,
        Err(resp) => resp,
    }
}

async fn list_my_document_alerts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match load_patient_document_alerts_summary(&state, patient_id).await {
        Ok(summary) => Json(patient_document_alerts_payload(&summary)).into_response(),
        Err(resp) => resp,
    }
}

async fn list_my_documents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        r#"SELECT d.id, d.patient_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.storage_key, d.klinik, d.ursprung,
                  d.notes, d.created_at, d.updated_at,
                  ds.id AS share_id, ds.channel, ds.requires_confirmation, ds.confirmed,
                  ds.confirmed_at, ds.shared_at,
                  sharer.name AS shared_by_name
           FROM documents d
           JOIN LATERAL (
                SELECT id, channel, requires_confirmation, confirmed, confirmed_at, shared_at, shared_by
                FROM document_shares
                WHERE document_id = d.id
                  AND shared_with_user_id = $1
                  AND revoked_at IS NULL
                ORDER BY shared_at DESC
                LIMIT 1
           ) ds ON TRUE
           LEFT JOIN users sharer ON sharer.id = ds.shared_by
           WHERE d.patient_id = $2
             AND d.visibility = 'patient_visible'
           ORDER BY COALESCE(ds.shared_at, d.updated_at) DESC"#,
    )
    .bind(auth.user_id)
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
                        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
                        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
                        "auto_name": row.try_get::<String, _>("auto_name").unwrap_or_default(),
                        "original_filename": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
                        "art": row.try_get::<String, _>("art").unwrap_or_default(),
                        "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "visibility": row.try_get::<String, _>("visibility").unwrap_or_default(),
                        "is_medical": row.try_get::<bool, _>("is_medical").unwrap_or(false),
                        "mime_type": row.try_get::<Option<String>, _>("mime_type").unwrap_or_default(),
                        "file_size": row.try_get::<Option<i64>, _>("file_size").unwrap_or_default(),
                        "klinik": row.try_get::<Option<String>, _>("klinik").unwrap_or_default(),
                        "ursprung": row.try_get::<Option<String>, _>("ursprung").unwrap_or_default(),
                        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                        "share_id": row.try_get::<Uuid, _>("share_id").unwrap_or_else(|_| Uuid::nil()),
                        "channel": row.try_get::<Option<String>, _>("channel").unwrap_or_default(),
                        "requires_confirmation": row.try_get::<bool, _>("requires_confirmation").unwrap_or(false),
                        "confirmed": row.try_get::<bool, _>("confirmed").unwrap_or(false),
                        "confirmed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("confirmed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "shared_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("shared_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "shared_by_name": row.try_get::<Option<String>, _>("shared_by_name").unwrap_or_default(),
                        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list my documents");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load documents")
        }
    }
}

async fn download_my_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let row = match sqlx::query(
        r#"SELECT d.id, d.auto_name, d.original_filename, d.mime_type, d.storage_key
           FROM documents d
           JOIN document_shares ds
             ON ds.document_id = d.id
            AND ds.shared_with_user_id = $1
            AND ds.revoked_at IS NULL
           WHERE d.id = $2
             AND d.patient_id = $3
             AND d.visibility = 'patient_visible'
           ORDER BY ds.shared_at DESC
           LIMIT 1"#,
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, document_id = %id, "load my document");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load document");
        }
    };

    let Some(storage_key) = row
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default()
    else {
        return err(StatusCode::NOT_FOUND, "Document file is not stored");
    };

    let mime_type = row
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let filename = row
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default()
        .unwrap_or_else(|| {
            row.try_get::<String, _>("auto_name")
                .unwrap_or_else(|_| "document".to_string())
        });

    let path = FsPath::new(DOCUMENT_UPLOAD_DIR).join(storage_key);
    let data = match tokio::fs::read(&path).await {
        Ok(data) => data,
        Err(_) => return err(StatusCode::NOT_FOUND, "Document file not found on disk"),
    };

    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));

    axum::response::Response::builder()
        .header("content-type", mime_type)
        .header("content-disposition", disposition)
        .body(Body::from(data))
        .unwrap()
        .into_response()
}

async fn confirm_my_document_release(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let updated = match sqlx::query(
        r#"UPDATE document_shares ds
           SET confirmed = true,
               confirmed_at = COALESCE(ds.confirmed_at, now())
           FROM documents d
           WHERE ds.document_id = d.id
             AND ds.document_id = $1
             AND ds.shared_with_user_id = $2
             AND ds.revoked_at IS NULL
             AND d.patient_id = $3
             AND d.visibility = 'patient_visible'
           RETURNING ds.id, ds.confirmed_at"#,
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document release not found"),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, document_id = %id, "confirm my document release");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to confirm document release",
            );
        }
    };

    let share_id = updated
        .try_get::<Uuid, _>("id")
        .unwrap_or_else(|_| Uuid::nil());
    let confirmed_at = updated
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("confirmed_at")
        .unwrap_or_default()
        .map(|value| value.to_rfc3339());

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'confirm_document_share', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(serde_json::json!({
        "share_id": share_id,
        "source": "patient_portal",
    }))
    .execute(&state.db)
    .await;

    Json(serde_json::json!({
        "ok": true,
        "document_id": id,
        "share_id": share_id,
        "confirmed": true,
        "confirmed_at": confirmed_at,
    }))
    .into_response()
}

pub(crate) async fn resolve_self_patient_id(
    state: &AppState,
    user_id: Uuid,
) -> Result<Uuid, axum::response::Response> {
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
        tracing::error!(error = %e, user_id = %user_id, "resolve self patient id");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate linked patient",
        )
    })?;

    if rows.is_empty() {
        return Err(err(
            StatusCode::NOT_FOUND,
            "Linked patient record not found",
        ));
    }

    if rows.len() > 1 {
        return Err(err(
            StatusCode::CONFLICT,
            "Patient account is linked to multiple patient records",
        ));
    }

    Ok(rows[0]
        .try_get::<Uuid, _>("patient_id")
        .unwrap_or_else(|_| Uuid::nil()))
}

async fn load_numeric_setting(state: &AppState, key: &str, default: i64) -> i64 {
    match sqlx::query(r#"SELECT value::TEXT AS value_text FROM system_settings WHERE key = $1"#)
        .bind(key)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row
            .try_get::<String, _>("value_text")
            .ok()
            .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
            .unwrap_or(default),
        _ => default,
    }
}

async fn load_patient_label(state: &AppState, patient_id: Uuid) -> Option<String> {
    sqlx::query(
        r#"SELECT patient_id, trim(concat_ws(' ', first_name, last_name)) AS patient_name
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| {
        let pid = row.try_get::<String, _>("patient_id").unwrap_or_default();
        let name = row.try_get::<String, _>("patient_name").unwrap_or_default();
        if pid.is_empty() {
            name
        } else if name.is_empty() {
            pid
        } else {
            format!("{pid} · {name}")
        }
    })
}

#[allow(clippy::result_large_err)]
fn normalize_privacy_request_type(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();

    if matches!(
        normalized.as_str(),
        "erasure" | "restriction" | "third_party_revoke"
    ) {
        Ok(normalized)
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Privacy request type must be erasure, restriction or third_party_revoke",
        ))
    }
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error").to_lowercase(),
            "message": message,
        })),
    )
        .into_response()
}
