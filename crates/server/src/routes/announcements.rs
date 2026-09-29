use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/announcements/active", get(active_announcements))
        .route("/announcements/{id}/dismiss", post(dismiss_announcement))
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

const VARIANTS: &[&str] = &["info", "warning", "error", "success"];
const AUDIENCES: &[&str] = &["staff", "patients", "all"];

/// The audiences an account belongs to: portal accounts see `patients` and
/// `all`, staff accounts `staff` and `all` (owner decision 2026-09-28).
fn audiences_for(role: Role) -> [&'static str; 2] {
    if role == Role::Patient {
        ["patients", "all"]
    } else {
        ["staff", "all"]
    }
}

/// An error-level announcement stays visible while it is active: it cannot be
/// dismissed (owner decision 2026-09-28).
fn is_dismissible(variant: &str) -> bool {
    variant != "error"
}

async fn active_announcements(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    match sqlx::query(
        r#"SELECT a.id, a.title, a.message, a.variant, a.audience, a.starts_at, a.ends_at
           FROM announcements a
           WHERE a.is_active = true
             AND a.starts_at <= now()
             AND (a.ends_at IS NULL OR a.ends_at > now())
             AND a.audience = ANY($2)
             AND (
                 a.variant = 'error'
                 OR NOT EXISTS (
                     SELECT 1
                     FROM announcement_dismissals dismissed
                     WHERE dismissed.announcement_id = a.id
                       AND dismissed.user_id = $1
                 )
             )
           ORDER BY (a.variant = 'error') DESC, a.created_at DESC"#,
    )
    .bind(auth.user_id)
    .bind(audiences_for(auth.role).to_vec())
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    let variant = r.get::<String, _>("variant");
                    serde_json::json!({
                        "id": r.get::<Uuid, _>("id"),
                        "title": r.get::<String, _>("title"),
                        "message": r.get::<String, _>("message"),
                        "dismissible": is_dismissible(&variant),
                        "variant": variant,
                        "audience": r.get::<String, _>("audience"),
                        "starts_at": r.get::<chrono::DateTime<chrono::Utc>, _>("starts_at"),
                        "ends_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("ends_at"),
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

async fn dismiss_announcement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    let announcement = match sqlx::query(
        r#"SELECT variant, audience,
                  (is_active = true AND starts_at <= now()
                   AND (ends_at IS NULL OR ends_at > now())) AS is_current
           FROM announcements
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Announcement not found"),
        Err(error) => {
            tracing::error!(%error, announcement_id = %id, "load announcement for dismissal");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to dismiss announcement",
            );
        }
    };
    let audience = announcement.get::<String, _>("audience");
    if !audiences_for(auth.role).contains(&audience.as_str()) {
        return err(StatusCode::NOT_FOUND, "Announcement not found");
    }
    let variant = announcement.get::<String, _>("variant");
    if !is_dismissible(&variant) && announcement.get::<bool, _>("is_current") {
        return err(
            StatusCode::CONFLICT,
            "An error announcement cannot be dismissed while it is active",
        );
    }

    let dismissed = sqlx::query(
        r#"INSERT INTO announcement_dismissals (announcement_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (announcement_id, user_id)
           DO UPDATE SET dismissed_at = now()
           RETURNING announcement_id"#,
    )
    .bind(id)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await;

    match dismissed {
        Ok(Some(_)) => {
            state.audit_sender.try_send(audit::domain_event(
                "dismiss_announcement",
                Some(auth.user_id),
                "announcement",
                Some(id),
                serde_json::json!({}),
            ));
            crate::realtime::publish_announcement_user_event(
                &state,
                auth.user_id,
                "announcement.dismissed",
                id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Announcement not found"),
        Err(error) => {
            tracing::error!(%error, announcement_id = %id, user_id = %auth.user_id, "dismiss announcement");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to dismiss announcement",
            )
        }
    }
}

async fn list_all(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminAnnouncements) {
        return e;
    }

    match sqlx::query(
        r#"SELECT a.id, a.title, a.message, a.variant, a.audience, a.is_active,
                  a.starts_at, a.ends_at, a.created_at,
                  COALESCE(u.name, '') AS creator
           FROM announcements a
           LEFT JOIN users u ON u.id = a.created_by
           ORDER BY a.created_at DESC LIMIT 50"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.get::<Uuid, _>("id"),
                        "title": r.get::<String, _>("title"),
                        "message": r.get::<String, _>("message"),
                        "variant": r.get::<String, _>("variant"),
                        "audience": r.get::<String, _>("audience"),
                        "is_active": r.get::<bool, _>("is_active"),
                        "starts_at": r.get::<chrono::DateTime<chrono::Utc>, _>("starts_at"),
                        "ends_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("ends_at"),
                        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                        "creator": r.get::<String, _>("creator"),
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
    audience: Option<String>,
    is_active: Option<bool>,
    starts_at: Option<String>,
    ends_at: Option<String>,
}

/// Parses a datetime from the admin UI, accepting both RFC3339 and the naive
/// `datetime-local` format ("YYYY-MM-DDTHH:MM" / with seconds) sent by the form.
fn parse_admin_datetime(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(dt.with_timezone(&chrono::Utc));
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(value, fmt) {
            return Some(crate::app_time::from_local(naive));
        }
    }
    None
}

/// Validated announcement fields shared by create and update.
struct AnnouncementInput {
    title: String,
    message: String,
    variant: String,
    audience: String,
    is_active: bool,
}

#[allow(clippy::result_large_err)]
fn validate_announcement(
    body: &UpsertAnnouncement,
) -> Result<AnnouncementInput, axum::response::Response> {
    let title = body.title.trim().to_string();
    let message = body.message.trim().to_string();
    if title.is_empty() || message.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Title and message are required",
        ));
    }
    let variant = body
        .variant
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("info")
        .to_string();
    if !VARIANTS.contains(&variant.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Variant must be info, warning, error or success",
        ));
    }
    let audience = body
        .audience
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("all")
        .to_string();
    if !AUDIENCES.contains(&audience.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Audience must be staff, patients or all",
        ));
    }
    Ok(AnnouncementInput {
        title,
        message,
        variant,
        audience,
        is_active: body.is_active.unwrap_or(true),
    })
}

async fn create_announcement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertAnnouncement>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminAnnouncements) {
        return e;
    }
    let input = match validate_announcement(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let starts: chrono::DateTime<chrono::Utc> = body
        .starts_at
        .as_deref()
        .and_then(parse_admin_datetime)
        .unwrap_or_else(chrono::Utc::now);
    let ends: Option<chrono::DateTime<chrono::Utc>> =
        body.ends_at.as_deref().and_then(parse_admin_datetime);

    match sqlx::query(
        r#"INSERT INTO announcements (
                title, message, variant, audience, is_active, starts_at, ends_at, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
    )
    .bind(&input.title)
    .bind(&input.message)
    .bind(&input.variant)
    .bind(&input.audience)
    .bind(input.is_active)
    .bind(starts)
    .bind(ends)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let id = row.get::<Uuid, _>("id");
            state.audit_sender.try_send(audit::domain_event(
                "create_announcement",
                Some(auth.user_id),
                "announcement",
                Some(id),
                serde_json::json!({
                    "title": input.title,
                    "variant": input.variant,
                    "audience": input.audience,
                }),
            ));
            crate::realtime::publish_announcement_event(
                &state,
                Some(auth.user_id),
                "announcement.created",
                id,
                serde_json::json!({
                    "is_active": input.is_active,
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true, "id": id})).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "create announcement");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn update_announcement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertAnnouncement>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminAnnouncements) {
        return e;
    }
    let input = match validate_announcement(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let ends: Option<chrono::DateTime<chrono::Utc>> =
        body.ends_at.as_deref().and_then(parse_admin_datetime);

    match sqlx::query(
        r#"UPDATE announcements
           SET title = $2, message = $3, variant = $4, audience = $5, is_active = $6, ends_at = $7
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(&input.title)
    .bind(&input.message)
    .bind(&input.variant)
    .bind(&input.audience)
    .bind(input.is_active)
    .bind(ends)
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "update_announcement",
                Some(auth.user_id),
                "announcement",
                Some(id),
                serde_json::json!({
                    "title": input.title,
                    "variant": input.variant,
                    "audience": input.audience,
                    "is_active": input.is_active,
                    "ends_at": ends,
                }),
            ));
            crate::realtime::publish_announcement_event(
                &state,
                Some(auth.user_id),
                "announcement.updated",
                id,
                serde_json::json!({
                    "is_active": input.is_active,
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Announcement not found"),
        Err(e) => {
            tracing::error!(error = %e, "update announcement");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn delete_announcement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminAnnouncements) {
        return e;
    }

    let deleted = sqlx::query!("DELETE FROM announcements WHERE id = $1", id)
        .execute(&state.db)
        .await;
    match deleted {
        Ok(result) if result.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "delete_announcement",
                Some(auth.user_id),
                "announcement",
                Some(id),
                serde_json::json!({}),
            ));
        }
        Ok(_) => {}
        Err(e) => {
            tracing::error!(error = %e, "delete announcement");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    crate::realtime::publish_announcement_event(
        &state,
        Some(auth.user_id),
        "announcement.deleted",
        id,
        serde_json::json!({}),
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_accounts_and_staff_see_their_own_audience() {
        assert_eq!(audiences_for(Role::Patient), ["patients", "all"]);
        assert_eq!(audiences_for(Role::ItAdmin), ["staff", "all"]);
        assert_eq!(audiences_for(Role::Ceo), ["staff", "all"]);
    }

    #[test]
    fn only_error_announcements_are_not_dismissible() {
        assert!(!is_dismissible("error"));
        for variant in ["info", "warning", "success"] {
            assert!(is_dismissible(variant));
        }
    }
}
