//! Planning grid drafts (owner 2026-11-13): a lead's order has no patient
//! yet, so its visits cannot be created; the planner saves the doctors laid
//! out on days and hours as a draft. Once the order has its patient, the grid
//! loads the draft and «Создать все приёмы» creates the visits and removes
//! the draft (`POST /orders/{id}/appointments/batch`).
//!
//! `GET /orders/{order_id}/visit-drafts` reads the draft; `POST` with
//! `{ items: [...] }` replaces it (an empty list clears it), with one audit row.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use super::{can_access_order_preparation, err};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

const PLANNER_ROLES: &[Role] = &[Role::Ceo, Role::PatientManager];
const MAX_DRAFT_ITEMS: usize = 60;

pub(super) fn router() -> Router<AppState> {
    Router::new().route(
        "/orders/{order_id}/visit-drafts",
        get(list_visit_drafts).post(replace_visit_drafts),
    )
}

#[derive(Deserialize)]
struct DraftItem {
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    title: String,
    date: String,
    time_start: String,
    time_end: String,
    #[serde(default)]
    interpreter_needed: bool,
    interpreter_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct ReplaceDrafts {
    items: Vec<DraftItem>,
}

/// A checked draft line: day, start and end as the database stores them.
#[derive(Debug, PartialEq)]
pub(super) struct DraftSlot {
    pub(super) date: chrono::NaiveDate,
    pub(super) time_start: chrono::NaiveTime,
    pub(super) time_end: chrono::NaiveTime,
}

pub(super) fn parse_draft_slot(
    title: &str,
    date: &str,
    time_start: &str,
    time_end: &str,
) -> Result<DraftSlot, &'static str> {
    if title.trim().is_empty() {
        return Err("title is required");
    }
    let date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| "Invalid date (YYYY-MM-DD)")?;
    let time_start = chrono::NaiveTime::parse_from_str(time_start, "%H:%M")
        .map_err(|_| "Invalid time (HH:MM)")?;
    let time_end =
        chrono::NaiveTime::parse_from_str(time_end, "%H:%M").map_err(|_| "Invalid time (HH:MM)")?;
    if time_end <= time_start {
        return Err("time_end must be later than time_start");
    }
    Ok(DraftSlot {
        date,
        time_start,
        time_end,
    })
}

async fn ensure_planner(
    state: &AppState,
    auth: &AuthUser,
    order_id: Uuid,
) -> Result<(), axum::response::Response> {
    auth.require_any_role(PLANNER_ROLES)?;
    match can_access_order_preparation(state, auth, order_id, None).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(resp) => Err(resp),
    }
}

async fn list_visit_drafts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = ensure_planner(&state, &auth, order_id).await {
        return resp;
    }
    let rows = match sqlx::query(
        r#"SELECT draft.id, draft.provider_id, provider.name AS provider_name,
                  draft.doctor_id, doctor.name AS doctor_name, draft.title, draft.date,
                  draft.time_start, draft.time_end, draft.interpreter_needed, draft.interpreter_id
           FROM order_visit_drafts draft
           JOIN providers provider ON provider.id = draft.provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = draft.doctor_id
           WHERE draft.order_id = $1
           ORDER BY draft.position, draft.date, draft.time_start"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "visit drafts: load");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let time = |row: &sqlx::postgres::PgRow, name: &str| {
        row.try_get::<chrono::NaiveTime, _>(name)
            .map(|value| value.format("%H:%M").to_string())
            .unwrap_or_default()
    };
    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or_default(),
                "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
                "doctor_id": row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
                "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "date": row.try_get::<chrono::NaiveDate, _>("date").map(|value| value.to_string()).unwrap_or_default(),
                "time_start": time(row, "time_start"),
                "time_end": time(row, "time_end"),
                "interpreter_needed": row.try_get::<bool, _>("interpreter_needed").unwrap_or(false),
                "interpreter_id": row.try_get::<Option<Uuid>, _>("interpreter_id").unwrap_or_default(),
            })
        })
        .collect();
    (StatusCode::OK, Json(serde_json::json!({ "items": items }))).into_response()
}

async fn replace_visit_drafts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<ReplaceDrafts>,
) -> axum::response::Response {
    if let Err(resp) = ensure_planner(&state, &auth, order_id).await {
        return resp;
    }
    if body.items.len() > MAX_DRAFT_ITEMS {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many visits in one draft",
        );
    }
    let mut slots = Vec::with_capacity(body.items.len());
    for item in &body.items {
        match parse_draft_slot(&item.title, &item.date, &item.time_start, &item.time_end) {
            Ok(slot) => slots.push(slot),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        }
    }
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "visit drafts: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM order_visit_drafts WHERE order_id = $1")
        .bind(order_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, %order_id, "visit drafts: clear");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (position, (item, slot)) in body.items.iter().zip(&slots).enumerate() {
        let inserted = sqlx::query(
            r#"INSERT INTO order_visit_drafts (order_id, provider_id, doctor_id, title, date,
                    time_start, time_end, interpreter_needed, interpreter_id, position, created_by)
               SELECT $1, $2, doctor.id, $4, $5, $6, $7, $8, $9, $10, $11
               FROM providers provider
               LEFT JOIN provider_doctors doctor
                 ON doctor.id = $3 AND doctor.provider_id = provider.id
               WHERE provider.id = $2
                 AND ($3::uuid IS NULL OR doctor.id IS NOT NULL)"#,
        )
        .bind(order_id)
        .bind(item.provider_id)
        .bind(item.doctor_id)
        .bind(item.title.trim())
        .bind(slot.date)
        .bind(slot.time_start)
        .bind(slot.time_end)
        .bind(item.interpreter_needed || item.interpreter_id.is_some())
        .bind(item.interpreter_id)
        .bind(position as i32)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await;
        match inserted {
            Ok(result) if result.rows_affected() == 1 => {}
            Ok(_) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Unknown provider, or the doctor does not belong to it",
                );
            }
            Err(e) => {
                tracing::error!(error = %e, %order_id, "visit drafts: insert");
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid draft visit");
            }
        }
    }
    if let Err(e) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "save_order_visit_drafts",
            Some(auth.user_id),
            "order",
            Some(order_id),
            serde_json::json!({ "draft_count": slots.len() }),
        ),
    )
    .await
    {
        tracing::error!(error = %e, %order_id, "visit drafts: audit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, %order_id, "visit drafts: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({ "saved": slots.len() })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draft_line_needs_a_title_a_day_and_a_forward_time_range() {
        assert!(parse_draft_slot("Echo", "2026-11-16", "09:00", "10:00").is_ok());
        assert_eq!(
            parse_draft_slot(" ", "2026-11-16", "09:00", "10:00"),
            Err("title is required")
        );
        assert_eq!(
            parse_draft_slot("Echo", "16.11.2026", "09:00", "10:00"),
            Err("Invalid date (YYYY-MM-DD)")
        );
        assert_eq!(
            parse_draft_slot("Echo", "2026-11-16", "10:00", "10:00"),
            Err("time_end must be later than time_start")
        );
    }
}
