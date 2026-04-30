use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/documents/{document_id}/translation-requests",
            post(create_my_document_translation_request),
        )
        .route(
            "/me/translation-requests",
            get(list_my_translation_requests),
        )
}

#[derive(Deserialize)]
struct CreatePortalTranslationRequest {
    requested_language: String,
    note: Option<String>,
}

async fn list_my_translation_requests(
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
        r#"SELECT dtr.id, dtr.document_id, dtr.patient_id, dtr.requested_language,
                  dtr.status, dtr.note, dtr.source_language, dtr.source_text,
                  dtr.translated_text, dtr.requested_by, dtr.translated_by,
                  dtr.request_source, dtr.requested_at, dtr.completed_at,
                  dtr.translated_at, dtr.updated_at,
                  requester.name AS requested_by_name,
                  translator.name AS translated_by_name,
                  d.auto_name AS document_name,
                  d.original_filename,
                  d.art AS document_art,
                  d.category AS document_category
           FROM document_translation_requests dtr
           JOIN documents d ON d.id = dtr.document_id
           LEFT JOIN users requester ON requester.id = dtr.requested_by
           LEFT JOIN users translator ON translator.id = dtr.translated_by
           WHERE dtr.patient_id = $1
             AND dtr.requested_by = $2
             AND dtr.request_source = 'patient_portal'
             AND d.visibility = 'patient_visible'
             AND EXISTS (
                SELECT 1
                FROM document_shares ds
                WHERE ds.document_id = d.id
                  AND ds.shared_with_user_id = $2
                  AND ds.revoked_at IS NULL
             )
           ORDER BY dtr.requested_at DESC"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(translation_request_json)
                .collect::<Vec<serde_json::Value>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient translation requests");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load translation requests",
            )
        }
    }
}

async fn create_my_document_translation_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(document_id): Path<Uuid>,
    Json(body): Json<CreatePortalTranslationRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let requested_language = match normalize_language(&body.requested_language) {
        Some(value) => value,
        None => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Unknown translation target language",
            );
        }
    };
    let note = normalize_optional_text(body.note.as_deref());

    let document =
        match load_visible_patient_document(&state, patient_id, auth.user_id, document_id).await {
            Ok(Some(row)) => row,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
            Err(resp) => return resp,
        };
    let prefilled_source_text = document
        .try_get::<Option<String>, _>("extracted_text")
        .unwrap_or_default();

    let request_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO document_translation_requests (
                document_id, patient_id, requested_language, status, requested_by,
                note, source_text, request_source
           ) VALUES (
                $1, $2, $3, 'pending', $4,
                $5, $6, 'patient_portal'
           )
           RETURNING id"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(requested_language)
    .bind(auth.user_id)
    .bind(note.as_deref())
    .bind(prefilled_source_text.as_deref())
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(sqlx::Error::Database(db_error))
            if db_error.constraint() == Some("idx_document_translation_requests_active") =>
        {
            return err(
                StatusCode::CONFLICT,
                "An active translation request already exists for this language",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, document_id = %document_id, patient_id = %patient_id, "create patient translation request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create translation request",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "translation_requested_by_patient",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "request_id": request_id,
            "document_id": document_id,
            "requested_language": requested_language,
        }),
    ));

    notify_assigned_staff(
        &state,
        patient_id,
        request_id,
        "translation_request",
        "Patient requested document translation",
        "A patient submitted a translation request through the portal.",
    )
    .await;

    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        "document.translation_requested",
        document_id,
        json!({
            "request_id": request_id,
            "patient_id": patient_id,
            "requested_language": requested_language,
            "request_source": "patient_portal",
        }),
    )
    .await;
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "translation_request.created",
        patient_id,
        json!({
            "request_id": request_id,
            "document_id": document_id,
        }),
    )
    .await;

    match load_translation_request(&state, request_id, auth.user_id).await {
        Ok(Some(row)) => {
            (StatusCode::CREATED, Json(translation_request_json(&row))).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Translation request not found"),
        Err(resp) => resp,
    }
}

async fn load_visible_patient_document(
    state: &AppState,
    patient_id: Uuid,
    user_id: Uuid,
    document_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(
        r#"SELECT d.id, d.patient_id, d.auto_name, d.original_filename, d.art, d.category,
                  d.visibility, d.extracted_text
           FROM documents d
           WHERE d.id = $1
             AND d.patient_id = $2
             AND d.visibility = 'patient_visible'
             AND EXISTS (
                SELECT 1
                FROM document_shares ds
                WHERE ds.document_id = d.id
                  AND ds.shared_with_user_id = $3
                  AND ds.revoked_at IS NULL
             )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, document_id = %document_id, patient_id = %patient_id, "load patient-visible document");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load document")
    })
}

async fn load_translation_request(
    state: &AppState,
    request_id: Uuid,
    user_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(
        r#"SELECT dtr.id, dtr.document_id, dtr.patient_id, dtr.requested_language,
                  dtr.status, dtr.note, dtr.source_language, dtr.source_text,
                  dtr.translated_text, dtr.requested_by, dtr.translated_by,
                  dtr.request_source, dtr.requested_at, dtr.completed_at,
                  dtr.translated_at, dtr.updated_at,
                  requester.name AS requested_by_name,
                  translator.name AS translated_by_name,
                  d.auto_name AS document_name,
                  d.original_filename,
                  d.art AS document_art,
                  d.category AS document_category
           FROM document_translation_requests dtr
           JOIN documents d ON d.id = dtr.document_id
           LEFT JOIN users requester ON requester.id = dtr.requested_by
           LEFT JOIN users translator ON translator.id = dtr.translated_by
           WHERE dtr.id = $1
             AND dtr.requested_by = $2
             AND dtr.request_source = 'patient_portal'"#,
    )
    .bind(request_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, request_id = %request_id, "load patient translation request");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load translation request",
        )
    })
}

fn translation_request_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "document_id": row.try_get::<Uuid, _>("document_id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
        "requested_language": row.try_get::<String, _>("requested_language").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
        "source_language": row.try_get::<Option<String>, _>("source_language").unwrap_or_default(),
        "source_text": row.try_get::<Option<String>, _>("source_text").unwrap_or_default(),
        "translated_text": row.try_get::<Option<String>, _>("translated_text").unwrap_or_default(),
        "request_source": row.try_get::<String, _>("request_source").unwrap_or_else(|_| "patient_portal".to_string()),
        "requested_by": row.try_get::<Uuid, _>("requested_by").unwrap_or_else(|_| Uuid::nil()),
        "requested_by_name": row.try_get::<Option<String>, _>("requested_by_name").unwrap_or_default(),
        "translated_by": row.try_get::<Option<Uuid>, _>("translated_by").unwrap_or_default(),
        "translated_by_name": row.try_get::<Option<String>, _>("translated_by_name").unwrap_or_default(),
        "requested_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("requested_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "completed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "translated_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("translated_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "document_name": row.try_get::<Option<String>, _>("document_name").unwrap_or_default(),
        "original_filename": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
        "document_art": row.try_get::<Option<String>, _>("document_art").unwrap_or_default(),
        "document_category": row.try_get::<Option<String>, _>("document_category").unwrap_or_default(),
    })
}

fn normalize_language(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "de" | "deu" | "ger" | "german" | "deutsch" => Some("de"),
        "en" | "eng" | "english" => Some("en"),
        "uk" | "ua" | "ukr" | "ukrainian" => Some("uk"),
        "ru" | "rus" | "russian" => Some("ru"),
        _ => None,
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

async fn notify_assigned_staff(
    state: &AppState,
    patient_id: Uuid,
    request_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
    if let Ok(rows) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT pa.user_id, $2, $3, $4, 'translation_request', $5
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role IN ('patient_manager', 'ceo')
           RETURNING id, user_id"#,
    )
    .bind(patient_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(request_id)
    .fetch_all(&state.db)
    .await
    {
        for row in rows {
            let notification_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
            let user_id = row
                .try_get::<Uuid, _>("user_id")
                .unwrap_or_else(|_| Uuid::nil());
            if notification_id != Uuid::nil() && user_id != Uuid::nil() {
                crate::realtime::publish_notification_event(
                    state,
                    user_id,
                    "notification.created",
                    Some(notification_id),
                    json!({ "entity_type": "translation_request" }),
                )
                .await;
            }
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error").to_lowercase(),
            "message": message,
        })),
    )
        .into_response()
}
