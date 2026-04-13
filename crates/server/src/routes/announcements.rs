use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/announcements/active", get(active_announcements))
        .route(
            "/admin/announcements",
            get(list_all).post(create_announcement),
        )
        .route(
            "/admin/announcements/{id}/update",
            post(update_announcement),
        )
        .route(
            "/admin/announcements/{id}/delete",
            post(delete_announcement),
        )
}

async fn active_announcements(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthUser>,
) -> axum::response::Response {
    match sqlx::query!(
        "SELECT id, title, message, variant, starts_at, ends_at
         FROM announcements
         WHERE is_active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
         ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.id, "title": r.title, "message": r.message, "variant": r.variant,
                        "starts_at": r.starts_at, "ends_at": r.ends_at,
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "active announcements");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_all(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT a.id, a.title, a.message, a.variant, a.is_active,
                  a.starts_at, a.ends_at, a.created_at,
                  u.name AS "creator!"
           FROM announcements a
           JOIN users u ON u.id = a.created_by
           ORDER BY a.created_at DESC LIMIT 50"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.id, "title": r.title, "message": r.message,
                        "variant": r.variant, "is_active": r.is_active,
                        "starts_at": r.starts_at, "ends_at": r.ends_at,
                        "created_at": r.created_at, "creator": r.creator,
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list announcements");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

#[derive(Deserialize)]
struct UpsertAnnouncement {
    title: String,
    message: String,
    variant: Option<String>,
    is_active: Option<bool>,
    starts_at: Option<String>,
    ends_at: Option<String>,
}

async fn create_announcement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertAnnouncement>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let variant = body.variant.as_deref().unwrap_or("info");
    let starts: chrono::DateTime<chrono::Utc> = body
        .starts_at
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(chrono::Utc::now);
    let ends: Option<chrono::DateTime<chrono::Utc>> = body.ends_at.and_then(|s| s.parse().ok());

    match sqlx::query!(
        "INSERT INTO announcements (title, message, variant, is_active, starts_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        body.title, body.message, variant, body.is_active.unwrap_or(true),
        starts, ends, auth.user_id
    ).fetch_one(&state.db).await {
        Ok(r) => {
            state.audit_sender.try_send(audit::domain_event(
                "create_announcement",
                Some(auth.user_id),
                "announcement",
                Some(r.id),
                serde_json::json!({ "title": body.title }),
            ));
            Json(serde_json::json!({"ok": true, "id": r.id})).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "create announcement"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn update_announcement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertAnnouncement>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let variant = body.variant.as_deref().unwrap_or("info");
    let ends: Option<chrono::DateTime<chrono::Utc>> = body.ends_at.and_then(|s| s.parse().ok());

    match sqlx::query!(
        "UPDATE announcements SET title=$2, message=$3, variant=$4, is_active=$5, ends_at=$6 WHERE id=$1",
        id, body.title, body.message, variant, body.is_active.unwrap_or(true), ends
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => Json(serde_json::json!({"ok": true})).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "Announcement not found"),
        Err(e) => { tracing::error!(error = %e, "update announcement"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn delete_announcement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let _ = sqlx::query!("DELETE FROM announcements WHERE id = $1", id)
        .execute(&state.db)
        .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message}))).into_response()
}
