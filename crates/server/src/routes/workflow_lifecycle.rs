use axum::{Json, http::StatusCode, response::IntoResponse};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}

pub(crate) struct RecordEvent<'a> {
    pub entity_type: &'a str,
    pub entity_id: Uuid,
    pub from_stage: Option<&'a str>,
    pub to_stage: &'a str,
    pub transition_kind: &'a str,
    pub changed_by: Option<Uuid>,
    pub note: Option<&'a str>,
    pub metadata: Value,
}

pub(crate) async fn record_event(
    state: &AppState,
    event: RecordEvent<'_>,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO workflow_lifecycle_events (
                entity_type, entity_id, from_stage, to_stage, transition_kind,
                note, metadata, changed_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
           )"#,
    )
    .bind(event.entity_type)
    .bind(event.entity_id)
    .bind(event.from_stage)
    .bind(event.to_stage)
    .bind(event.transition_kind)
    .bind(event.note)
    .bind(event.metadata)
    .bind(event.changed_by)
    .execute(&state.db)
    .await
    .map(|_| ())
    .map_err(|e| {
        tracing::error!(
            error = %e,
            entity_type = event.entity_type,
            entity_id = %event.entity_id,
            to_stage = event.to_stage,
            transition_kind = event.transition_kind,
            "record workflow lifecycle event"
        );
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to record workflow lifecycle event",
        )
    })
}

pub(crate) async fn load_history(
    state: &AppState,
    entity_type: &str,
    entity_id: Uuid,
) -> Result<Vec<Value>, axum::response::Response> {
    sqlx::query(
        r#"SELECT from_stage,
                  to_stage,
                  transition_kind,
                  note,
                  metadata,
                  changed_by,
                  created_at
           FROM workflow_lifecycle_events
           WHERE entity_type = $1
             AND entity_id = $2
           ORDER BY created_at DESC"#,
    )
    .bind(entity_type)
    .bind(entity_id)
    .fetch_all(&state.db)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| {
                json!({
                    "from_stage": row.try_get::<Option<String>, _>("from_stage").unwrap_or_default(),
                    "to_stage": row.try_get::<String, _>("to_stage").unwrap_or_default(),
                    "transition_kind": row.try_get::<String, _>("transition_kind").unwrap_or_default(),
                    "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
                    "metadata": row.try_get::<Value, _>("metadata").unwrap_or_else(|_| json!({})),
                    "changed_by": row.try_get::<Option<Uuid>, _>("changed_by").unwrap_or_default(),
                    "created_at": row
                        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                        .map(|value| value.to_rfc3339())
                        .unwrap_or_default(),
                })
            })
            .collect()
    })
    .map_err(|e| {
        tracing::error!(
            error = %e,
            entity_type,
            entity_id = %entity_id,
            "load workflow lifecycle history"
        );
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load workflow lifecycle history",
        )
    })
}

pub(crate) fn stage_entered_at(history: &[Value], stage: &str) -> Option<String> {
    history.iter().find_map(|item| {
        if item["to_stage"].as_str() == Some(stage) {
            item["created_at"].as_str().map(str::to_string)
        } else {
            None
        }
    })
}
