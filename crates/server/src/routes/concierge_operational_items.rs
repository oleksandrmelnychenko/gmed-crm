use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/concierge-operational-items",
            get(list_items).post(create_item),
        )
        .route(
            "/concierge-operational-items/{item_id}/update",
            post(update_item),
        )
        .route(
            "/concierge-operational-items/{item_id}",
            get(get_item_detail),
        )
        .route(
            "/concierge-operational-items/{item_id}/comments",
            post(add_comment),
        )
        .route(
            "/concierge-operational-items/{item_id}/checklist",
            post(add_checklist_item),
        )
        .route(
            "/concierge-operational-items/{item_id}/checklist/{checklist_id}/toggle",
            post(toggle_checklist_item),
        )
}

#[derive(Deserialize)]
struct ListItemsQuery {
    status: Option<String>,
    kind: Option<String>,
    assigned_to: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateItemRequest {
    request_id: Uuid,
    kind: String,
    title: String,
    note: Option<String>,
    assigned_to: Option<Uuid>,
    concierge_service_id: Option<Uuid>,
    due_at: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    location: Option<String>,
    priority: Option<String>,
    reminder_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateItemRequest {
    expected_updated_at: String,
    kind: String,
    title: String,
    note: Option<String>,
    assigned_to: Option<Uuid>,
    concierge_service_id: Option<Uuid>,
    due_at: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    location: Option<String>,
    priority: String,
    status: String,
    reminder_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddCommentRequest {
    request_id: Uuid,
    body: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddChecklistItemRequest {
    request_id: Uuid,
    label: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ToggleChecklistItemRequest {
    request_id: Uuid,
    completed: bool,
}

struct ValidatedItemFields {
    kind: String,
    title: String,
    note: Option<String>,
    concierge_service_id: Option<Uuid>,
    due_at: Option<DateTime<Utc>>,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    location: Option<String>,
    priority: String,
    reminder_at: Option<DateTime<Utc>>,
}

const OPERATIONAL_ITEM_RESPONSE_QUERY: &str = r#"SELECT t.id, t.title, t.description AS operational_note, t.assigned_to, t.assigned_by,
          CASE
              WHEN cs.assigned_concierge_id = t.assigned_to
               AND (cs.provider_id IS NULL OR linked_provider.provider_type = 'non_medical')
               AND (cs.appointment_id IS NULL OR linked_appointment.appointment_type = 'non_medical')
              THEN t.concierge_service_id
              ELSE NULL
          END AS concierge_service_id,
          t.task_kind, t.due_date, t.starts_at, t.ends_at,
          t.location, t.priority, t.status, t.reminder_at, t.reminder_sent_at,
          t.completed_at, t.created_at, t.updated_at,
          (SELECT COUNT(*) FROM concierge_operational_task_checklist_items ci WHERE ci.task_id = t.id) AS checklist_total,
          (SELECT COUNT(*) FROM concierge_operational_task_checklist_items ci WHERE ci.task_id = t.id AND ci.is_completed) AS checklist_completed,
          (SELECT COUNT(*) FROM concierge_operational_task_comments cc WHERE cc.task_id = t.id) AS comment_count,
          assignee.name AS assigned_to_name, assigner.name AS assigned_by_name
   FROM tasks t
   JOIN users assignee ON assignee.id = t.assigned_to
   JOIN users assigner ON assigner.id = t.assigned_by
   LEFT JOIN concierge_services cs ON cs.id = t.concierge_service_id
   LEFT JOIN providers linked_provider ON linked_provider.id = cs.provider_id
   LEFT JOIN appointments linked_appointment ON linked_appointment.id = cs.appointment_id
   WHERE t.id = $1 AND t.task_scope = 'concierge_operational'"#;

const COMMENT_RESPONSE_QUERY: &str = r#"SELECT comment.id, comment.body, comment.created_by,
          author.name AS created_by_name, comment.created_at
   FROM concierge_operational_task_comments comment
   JOIN users author ON author.id = comment.created_by
   WHERE comment.id = $1"#;

const CHECKLIST_ITEM_RESPONSE_QUERY: &str = r#"SELECT item.id, item.label, item.position, item.is_completed,
          item.completed_by, item.completed_at, item.created_by,
          creator.name AS created_by_name,
          completer.name AS completed_by_name,
          item.created_at, item.updated_at
   FROM concierge_operational_task_checklist_items item
   JOIN users creator ON creator.id = item.created_by
   LEFT JOIN users completer ON completer.id = item.completed_by
   WHERE item.id = $1"#;

async fn list_items(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListItemsQuery>,
) -> axum::response::Response {
    if let Err(response) = require_operational_role(&auth) {
        return response;
    }
    if let Some(status) = query.status.as_deref()
        && !is_valid_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }
    if let Some(kind) = query.kind.as_deref()
        && !is_valid_kind(kind)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid kind");
    }

    let assignee_filter = if is_operational_self_service_role(auth.role) {
        Some(auth.user_id)
    } else {
        query.assigned_to
    };

    let rows = match sqlx::query(
        r#"SELECT t.id, t.title, t.description AS operational_note, t.assigned_to, t.assigned_by,
                  CASE
                      WHEN cs.assigned_concierge_id = t.assigned_to
                       AND (cs.provider_id IS NULL OR linked_provider.provider_type = 'non_medical')
                       AND (cs.appointment_id IS NULL OR linked_appointment.appointment_type = 'non_medical')
                      THEN t.concierge_service_id
                      ELSE NULL
                  END AS concierge_service_id,
                  t.task_kind, t.due_date, t.starts_at, t.ends_at,
                  t.location, t.priority, t.status, t.reminder_at, t.reminder_sent_at,
                  t.completed_at, t.created_at, t.updated_at,
                  (SELECT COUNT(*) FROM concierge_operational_task_checklist_items ci WHERE ci.task_id = t.id) AS checklist_total,
                  (SELECT COUNT(*) FROM concierge_operational_task_checklist_items ci WHERE ci.task_id = t.id AND ci.is_completed) AS checklist_completed,
                  (SELECT COUNT(*) FROM concierge_operational_task_comments cc WHERE cc.task_id = t.id) AS comment_count,
                  assignee.name AS assigned_to_name, assigner.name AS assigned_by_name
           FROM tasks t
           JOIN users assignee ON assignee.id = t.assigned_to
           JOIN users assigner ON assigner.id = t.assigned_by
           LEFT JOIN concierge_services cs ON cs.id = t.concierge_service_id
           LEFT JOIN providers linked_provider ON linked_provider.id = cs.provider_id
           LEFT JOIN appointments linked_appointment ON linked_appointment.id = cs.appointment_id
           WHERE t.task_scope = 'concierge_operational'
             AND ($1::uuid IS NULL OR t.assigned_to = $1)
             AND ($2::text IS NULL OR t.status = $2)
             AND ($3::text IS NULL OR t.task_kind = $3)
           ORDER BY
               CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
               CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               COALESCE(t.starts_at, t.due_date) NULLS LAST,
               t.created_at DESC"#,
    )
    .bind(assignee_filter)
    .bind(query.status)
    .bind(query.kind)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "list concierge operational items");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    Json(rows.iter().filter_map(build_item_json).collect::<Vec<_>>()).into_response()
}

async fn create_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateItemRequest>,
) -> axum::response::Response {
    if let Err(response) = require_operational_role(&auth) {
        return response;
    }
    let assigned_to = match requested_assignee(&auth, body.assigned_to) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let fields = match validate_item_fields(
        &body.kind,
        &body.title,
        body.note.as_deref(),
        body.concierge_service_id,
        body.due_at.as_deref(),
        body.starts_at.as_deref(),
        body.ends_at.as_deref(),
        body.location.as_deref(),
        body.priority.as_deref().unwrap_or("normal"),
        body.reminder_at.as_deref(),
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let payload_fingerprint = create_item_payload_fingerprint(assigned_to, &fields);

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "begin concierge operational item transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(body.request_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, request_id = %body.request_id, "lock concierge operational create request");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let replay = match sqlx::query(
        r#"SELECT create_request.actor_id, create_request.task_id,
                  create_request.payload_fingerprint, task.assigned_to
           FROM concierge_operational_item_create_requests create_request
           JOIN tasks task ON task.id = create_request.task_id
           WHERE create_request.request_id = $1
           FOR SHARE OF task"#,
    )
    .bind(body.request_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, request_id = %body.request_id, "load concierge operational create replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Some(replay) = replay {
        if replay.try_get::<Uuid, _>("actor_id").ok() != Some(auth.user_id)
            || replay
                .try_get::<String, _>("payload_fingerprint")
                .ok()
                .as_deref()
                != Some(payload_fingerprint.as_str())
        {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        let replayed_item_id = replay
            .try_get::<Uuid, _>("task_id")
            .unwrap_or_else(|_| Uuid::nil());
        if is_operational_self_service_role(auth.role)
            && replay.try_get::<Uuid, _>("assigned_to").ok() != Some(auth.user_id)
        {
            return err(StatusCode::FORBIDDEN, "Insufficient permissions");
        }
        let replayed_item = match load_item_in_transaction(&mut tx, replayed_item_id).await {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Operational item not found"),
            Err(response) => return response,
        };
        if let Err(error) = tx.commit().await {
            tracing::error!(error = %error, request_id = %body.request_id, "commit concierge operational create replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        return Json(replayed_item).into_response();
    }
    if let Err(response) =
        validate_active_operational_assignee_in_transaction(&mut tx, assigned_to).await
    {
        return response;
    }
    if let Some(service_id) = fields.concierge_service_id
        && let Err(response) =
            validate_service_assignment_in_transaction(&mut tx, service_id, assigned_to).await
    {
        return response;
    }
    let item_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO tasks (
               title, description, assigned_to, assigned_by, due_date, priority,
               task_scope, task_kind, concierge_service_id, starts_at, ends_at, location,
               reminder_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'concierge_operational', $7, $8, $9, $10, $11, $12)
           RETURNING id"#,
    )
    .bind(&fields.title)
    .bind(fields.note.as_deref())
    .bind(assigned_to)
    .bind(auth.user_id)
    .bind(fields.due_at.as_ref())
    .bind(&fields.priority)
    .bind(&fields.kind)
    .bind(fields.concierge_service_id)
    .bind(fields.starts_at.as_ref())
    .bind(fields.ends_at.as_ref())
    .bind(fields.location.as_deref())
    .bind(fields.reminder_at.as_ref())
    .fetch_one(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "create concierge operational item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(error) = sqlx::query(
        r#"INSERT INTO concierge_operational_task_events (
               task_id, event_type, actor_id, request_id, payload
           ) VALUES ($1, 'created', $2, $3, $4)"#,
    )
    .bind(item_id)
    .bind(auth.user_id)
    .bind(body.request_id)
    .bind(serde_json::json!({
        "assigned_to": assigned_to,
        "kind": fields.kind.as_str(),
        "status": "open",
        "concierge_service_id": fields.concierge_service_id,
        "reminder_at": fields.reminder_at.as_ref().map(|value| value.to_rfc3339()),
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, item_id = %item_id, "record concierge task creation history");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = sqlx::query(
        r#"INSERT INTO concierge_operational_item_create_requests (
               request_id, actor_id, task_id, payload_fingerprint
           ) VALUES ($1, $2, $3, $4)"#,
    )
    .bind(body.request_id)
    .bind(auth.user_id)
    .bind(item_id)
    .bind(&payload_fingerprint)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, request_id = %body.request_id, item_id = %item_id, "persist concierge operational create request");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, item_id = %item_id, "commit concierge operational item");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "create_concierge_operational_item",
        Some(auth.user_id),
        "task",
        Some(item_id),
        serde_json::json!({
            "assigned_to": assigned_to,
            "kind": fields.kind.as_str(),
            "concierge_service_id": fields.concierge_service_id,
        }),
    ));
    publish_operational_event(
        &state,
        &auth,
        "concierge_operational_item.created",
        item_id,
        assigned_to,
        &fields,
        "open",
    )
    .await;

    match load_item(&state, item_id).await {
        Ok(Some(value)) => (StatusCode::CREATED, Json(value)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Operational item not found"),
        Err(response) => response,
    }
}

async fn update_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
    Json(body): Json<UpdateItemRequest>,
) -> axum::response::Response {
    if let Err(response) = require_operational_role(&auth) {
        return response;
    }
    if !is_valid_status(&body.status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }
    let expected_updated_at = match parse_datetime(
        Some(&body.expected_updated_at),
        "Invalid expected_updated_at (RFC3339)",
    ) {
        Ok(Some(value)) => value,
        Ok(None) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "expected_updated_at is required",
            );
        }
        Err(response) => return response,
    };

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "begin concierge task update");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let existing = match sqlx::query(
        r#"SELECT assigned_to, status, reminder_at, updated_at
           FROM tasks
           WHERE id = $1 AND task_scope = 'concierge_operational'
           FOR UPDATE"#,
    )
    .bind(item_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Operational item not found"),
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "load concierge operational item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let existing_assignee = existing
        .try_get::<Uuid, _>("assigned_to")
        .unwrap_or_else(|_| Uuid::nil());
    let existing_status = existing.try_get::<String, _>("status").unwrap_or_default();
    let existing_reminder_at = existing
        .try_get::<Option<DateTime<Utc>>, _>("reminder_at")
        .unwrap_or_default();
    if is_operational_self_service_role(auth.role) && existing_assignee != auth.user_id {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if existing.try_get::<DateTime<Utc>, _>("updated_at").ok() != Some(expected_updated_at) {
        return err(
            StatusCode::CONFLICT,
            "Operational item was changed by another user",
        );
    }
    let requested_assignee = body.assigned_to.or(Some(existing_assignee));
    let assigned_to = match resolve_assignee(&state, &auth, requested_assignee).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let fields = match validate_item_fields(
        &body.kind,
        &body.title,
        body.note.as_deref(),
        body.concierge_service_id,
        body.due_at.as_deref(),
        body.starts_at.as_deref(),
        body.ends_at.as_deref(),
        body.location.as_deref(),
        &body.priority,
        body.reminder_at.as_deref(),
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Some(service_id) = fields.concierge_service_id
        && let Err(response) = validate_service_assignment(&state, service_id, assigned_to).await
    {
        return response;
    }

    let result = sqlx::query(
        r#"UPDATE tasks
           SET title = $2,
               description = $3,
               assigned_to = $4,
               due_date = $5,
               priority = $6,
               status = $7,
               completed_at = CASE WHEN $7 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
               task_kind = $8,
               concierge_service_id = $9,
               starts_at = $10,
               ends_at = $11,
               location = $12,
               reminder_sent_at = CASE
                   WHEN reminder_at IS DISTINCT FROM $13 THEN NULL
                   ELSE reminder_sent_at
               END,
               reminder_at = $13,
               updated_at = now()
           WHERE id = $1
             AND task_scope = 'concierge_operational'
             AND ($14::bool = false OR assigned_to = $15)"#,
    )
    .bind(item_id)
    .bind(&fields.title)
    .bind(fields.note.as_deref())
    .bind(assigned_to)
    .bind(fields.due_at.as_ref())
    .bind(&fields.priority)
    .bind(&body.status)
    .bind(&fields.kind)
    .bind(fields.concierge_service_id)
    .bind(fields.starts_at.as_ref())
    .bind(fields.ends_at.as_ref())
    .bind(fields.location.as_deref())
    .bind(fields.reminder_at.as_ref())
    .bind(is_operational_self_service_role(auth.role))
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await;
    match result {
        Ok(result) if result.rows_affected() == 1 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Operational item not found"),
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "update concierge operational item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    let event_type = if existing_assignee != assigned_to {
        "reassigned"
    } else if existing_status != body.status {
        "status_changed"
    } else if existing_reminder_at != fields.reminder_at {
        "reminder_changed"
    } else {
        "updated"
    };
    if let Err(error) = sqlx::query(
        r#"INSERT INTO concierge_operational_task_events (
               task_id, event_type, actor_id, payload
           ) VALUES ($1, $2, $3, $4)"#,
    )
    .bind(item_id)
    .bind(event_type)
    .bind(auth.user_id)
    .bind(serde_json::json!({
        "assigned_to": assigned_to,
        "previous_assigned_to": existing_assignee,
        "kind": fields.kind.as_str(),
        "status": body.status.as_str(),
        "previous_status": existing_status,
        "concierge_service_id": fields.concierge_service_id,
        "reminder_at": fields.reminder_at.as_ref().map(|value| value.to_rfc3339()),
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, item_id = %item_id, "record concierge task update history");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, item_id = %item_id, "commit concierge task update");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "update_concierge_operational_item",
        Some(auth.user_id),
        "task",
        Some(item_id),
        serde_json::json!({
            "assigned_to": assigned_to,
            "kind": fields.kind.as_str(),
            "status": body.status.as_str(),
            "concierge_service_id": fields.concierge_service_id,
        }),
    ));
    publish_operational_event(
        &state,
        &auth,
        "concierge_operational_item.updated",
        item_id,
        assigned_to,
        &fields,
        &body.status,
    )
    .await;

    match load_item(&state, item_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Operational item not found"),
        Err(response) => response,
    }
}

async fn get_item_detail(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_operational_role(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "begin concierge task detail");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(response) = lock_item_access(&mut tx, &auth, item_id, false).await {
        return response;
    }
    let item = match load_item_in_transaction(&mut tx, item_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Operational item not found"),
        Err(response) => return response,
    };
    let checklist_rows = match sqlx::query(
        r#"SELECT item.id, item.label, item.position, item.is_completed,
                  item.completed_by, item.completed_at, item.created_by,
                  creator.name AS created_by_name,
                  completer.name AS completed_by_name,
                  item.created_at, item.updated_at
           FROM concierge_operational_task_checklist_items item
           JOIN users creator ON creator.id = item.created_by
           LEFT JOIN users completer ON completer.id = item.completed_by
           WHERE item.task_id = $1
           ORDER BY item.position, item.created_at, item.id"#,
    )
    .bind(item_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "load concierge task checklist");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let comment_rows = match sqlx::query(
        r#"SELECT comment.id, comment.body, comment.created_by,
                  author.name AS created_by_name, comment.created_at
           FROM concierge_operational_task_comments comment
           JOIN users author ON author.id = comment.created_by
           WHERE comment.task_id = $1
           ORDER BY comment.created_at, comment.id"#,
    )
    .bind(item_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "load concierge task comments");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let event_rows = match sqlx::query(
        r#"SELECT event.id, event.event_type, event.actor_id,
                  actor.name AS actor_name, event.payload, event.created_at
           FROM concierge_operational_task_events event
           LEFT JOIN users actor ON actor.id = event.actor_id
           WHERE event.task_id = $1
           ORDER BY event.created_at DESC, event.id DESC
           LIMIT 200"#,
    )
    .bind(item_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "load concierge task history");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, item_id = %item_id, "commit concierge task detail read");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    Json(serde_json::json!({
        "item": item,
        "checklist": checklist_rows.iter().filter_map(build_checklist_json).collect::<Vec<_>>(),
        "comments": comment_rows.iter().filter_map(build_comment_json).collect::<Vec<_>>(),
        "history": event_rows.iter().filter_map(build_history_json).collect::<Vec<_>>(),
    }))
    .into_response()
}

async fn add_comment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
    Json(body): Json<AddCommentRequest>,
) -> axum::response::Response {
    if let Err(response) = require_operational_role(&auth) {
        return response;
    }
    let comment_body = body.body.trim();
    if comment_body.is_empty() || comment_body.chars().count() > 4_000 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Comment is required (max 4000)",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "begin concierge task comment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let assigned_to = match lock_item_access(&mut tx, &auth, item_id, true).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let inserted_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO concierge_operational_task_comments (
               task_id, body, created_by, request_id
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (task_id, request_id) DO NOTHING
           RETURNING id"#,
    )
    .bind(item_id)
    .bind(comment_body)
    .bind(auth.user_id)
    .bind(body.request_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "insert concierge task comment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let inserted = inserted_id.is_some();
    let comment_id = if let Some(value) = inserted_id {
        if let Err(error) = sqlx::query(
            r#"INSERT INTO concierge_operational_task_events (
                   task_id, event_type, actor_id, request_id, payload
               ) VALUES ($1, 'comment_added', $2, $3, $4)"#,
        )
        .bind(item_id)
        .bind(auth.user_id)
        .bind(body.request_id)
        .bind(serde_json::json!({ "comment_id": value }))
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, item_id = %item_id, "record concierge task comment history");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        value
    } else {
        let existing = match sqlx::query(
            r#"SELECT id, body, created_by
               FROM concierge_operational_task_comments
               WHERE task_id = $1 AND request_id = $2"#,
        )
        .bind(item_id)
        .bind(body.request_id)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::CONFLICT, "Request replay could not be resolved"),
            Err(error) => {
                tracing::error!(error = %error, item_id = %item_id, "load replayed concierge task comment");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if existing.try_get::<String, _>("body").ok().as_deref() != Some(comment_body)
            || existing.try_get::<Uuid, _>("created_by").ok() != Some(auth.user_id)
        {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        existing
            .try_get::<Uuid, _>("id")
            .unwrap_or_else(|_| Uuid::nil())
    };
    let comment = match load_comment_in_transaction(&mut tx, comment_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Comment not found"),
        Err(response) => return response,
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, item_id = %item_id, "commit concierge task comment");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if inserted {
        publish_operational_child_event(
            &state,
            &auth,
            "concierge_operational_item.comment_added",
            item_id,
            assigned_to,
            serde_json::json!({ "comment_id": comment_id }),
        )
        .await;
    }
    Json(comment).into_response()
}

async fn add_checklist_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
    Json(body): Json<AddChecklistItemRequest>,
) -> axum::response::Response {
    if let Err(response) = require_operational_role(&auth) {
        return response;
    }
    let label = body.label.trim();
    if label.is_empty() || label.chars().count() > 500 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Checklist label is required (max 500)",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "begin concierge checklist item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let assigned_to = match lock_item_access(&mut tx, &auth, item_id, true).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let inserted_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO concierge_operational_task_checklist_items (
               task_id, label, position, created_by, request_id
           ) VALUES (
               $1, $2,
               COALESCE((SELECT MAX(position) + 1 FROM concierge_operational_task_checklist_items WHERE task_id = $1), 0),
               $3, $4
           )
           ON CONFLICT (task_id, request_id) DO NOTHING
           RETURNING id"#,
    )
    .bind(item_id)
    .bind(label)
    .bind(auth.user_id)
    .bind(body.request_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "insert concierge checklist item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let inserted = inserted_id.is_some();
    let checklist_id = if let Some(value) = inserted_id {
        if let Err(error) = sqlx::query(
            r#"INSERT INTO concierge_operational_task_events (
                   task_id, event_type, actor_id, request_id, payload
               ) VALUES ($1, 'checklist_item_added', $2, $3, $4)"#,
        )
        .bind(item_id)
        .bind(auth.user_id)
        .bind(body.request_id)
        .bind(serde_json::json!({ "checklist_id": value }))
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, item_id = %item_id, "record concierge checklist history");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        value
    } else {
        let existing = match sqlx::query(
            r#"SELECT id, label, created_by
               FROM concierge_operational_task_checklist_items
               WHERE task_id = $1 AND request_id = $2"#,
        )
        .bind(item_id)
        .bind(body.request_id)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::CONFLICT, "Request replay could not be resolved"),
            Err(error) => {
                tracing::error!(error = %error, item_id = %item_id, "load replayed concierge checklist item");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if existing.try_get::<String, _>("label").ok().as_deref() != Some(label)
            || existing.try_get::<Uuid, _>("created_by").ok() != Some(auth.user_id)
        {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        existing
            .try_get::<Uuid, _>("id")
            .unwrap_or_else(|_| Uuid::nil())
    };
    let checklist_item = match load_checklist_item_in_transaction(&mut tx, checklist_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Checklist item not found"),
        Err(response) => return response,
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, item_id = %item_id, "commit concierge checklist item");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if inserted {
        publish_operational_child_event(
            &state,
            &auth,
            "concierge_operational_item.checklist_item_added",
            item_id,
            assigned_to,
            serde_json::json!({ "checklist_id": checklist_id }),
        )
        .await;
    }
    Json(checklist_item).into_response()
}

async fn toggle_checklist_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((item_id, checklist_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ToggleChecklistItemRequest>,
) -> axum::response::Response {
    if let Err(response) = require_operational_role(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "begin concierge checklist toggle");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let assigned_to = match lock_item_access(&mut tx, &auth, item_id, true).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let replay = match sqlx::query(
        r#"SELECT event_type, payload
           FROM concierge_operational_task_events
           WHERE task_id = $1 AND request_id = $2"#,
    )
    .bind(item_id)
    .bind(body.request_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "load concierge checklist replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Some(replay) = replay {
        let event_type = replay
            .try_get::<String, _>("event_type")
            .unwrap_or_default();
        let checklist_id_text = checklist_id.to_string();
        let payload = replay
            .try_get::<serde_json::Value, _>("payload")
            .unwrap_or_else(|_| serde_json::json!({}));
        if event_type != "checklist_item_toggled"
            || payload.get("checklist_id").and_then(|value| value.as_str())
                != Some(checklist_id_text.as_str())
            || payload.get("completed").and_then(|value| value.as_bool()) != Some(body.completed)
        {
            return err(
                StatusCode::CONFLICT,
                "request_id was already used with different data",
            );
        }
        let checklist_item = match load_checklist_item_in_transaction(&mut tx, checklist_id).await {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Checklist item not found"),
            Err(response) => return response,
        };
        if let Err(error) = tx.commit().await {
            tracing::error!(error = %error, item_id = %item_id, "commit concierge checklist toggle replay");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        return Json(checklist_item).into_response();
    }
    let updated = match sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE concierge_operational_task_checklist_items
           SET is_completed = $3,
               completed_by = CASE WHEN $3 THEN $4 ELSE NULL END,
               completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
               updated_at = now()
           WHERE id = $2 AND task_id = $1
           RETURNING id"#,
    )
    .bind(item_id)
    .bind(checklist_id)
    .bind(body.completed)
    .bind(auth.user_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Checklist item not found"),
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, checklist_id = %checklist_id, "toggle concierge checklist item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = sqlx::query(
        r#"INSERT INTO concierge_operational_task_events (
               task_id, event_type, actor_id, request_id, payload
           ) VALUES ($1, 'checklist_item_toggled', $2, $3, $4)"#,
    )
    .bind(item_id)
    .bind(auth.user_id)
    .bind(body.request_id)
    .bind(serde_json::json!({
        "checklist_id": checklist_id,
        "completed": body.completed,
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, item_id = %item_id, "record concierge checklist toggle history");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let checklist_item = match load_checklist_item_in_transaction(&mut tx, updated).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Checklist item not found"),
        Err(response) => return response,
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, item_id = %item_id, "commit concierge checklist toggle");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    publish_operational_child_event(
        &state,
        &auth,
        "concierge_operational_item.checklist_item_toggled",
        item_id,
        assigned_to,
        serde_json::json!({
            "checklist_id": checklist_id,
            "completed": body.completed,
        }),
    )
    .await;
    Json(checklist_item).into_response()
}

async fn lock_item_access(
    tx: &mut Transaction<'_, Postgres>,
    auth: &AuthUser,
    item_id: Uuid,
    for_update: bool,
) -> Result<Uuid, axum::response::Response> {
    let query = if for_update {
        r#"SELECT assigned_to
           FROM tasks
           WHERE id = $1 AND task_scope = 'concierge_operational'
           FOR UPDATE"#
    } else {
        r#"SELECT assigned_to
           FROM tasks
           WHERE id = $1 AND task_scope = 'concierge_operational'
           FOR SHARE"#
    };
    let assigned_to = sqlx::query_scalar::<_, Uuid>(query)
        .bind(item_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, item_id = %item_id, "authorize concierge task access");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Operational item not found"))?;
    if is_operational_self_service_role(auth.role) && assigned_to != auth.user_id {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }
    Ok(assigned_to)
}

async fn load_comment_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    comment_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let row = sqlx::query(COMMENT_RESPONSE_QUERY)
        .bind(comment_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, comment_id = %comment_id, "load concierge task comment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?;
    Ok(row.as_ref().and_then(build_comment_json))
}

async fn load_checklist_item_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    checklist_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let row = sqlx::query(CHECKLIST_ITEM_RESPONSE_QUERY)
        .bind(checklist_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, checklist_id = %checklist_id, "load concierge checklist item");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?;
    Ok(row.as_ref().and_then(build_checklist_json))
}

fn build_checklist_json(row: &sqlx::postgres::PgRow) -> Option<serde_json::Value> {
    Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok()?,
        "label": row.try_get::<String, _>("label").ok()?,
        "position": row.try_get::<i32, _>("position").unwrap_or_default(),
        "is_completed": row.try_get::<bool, _>("is_completed").unwrap_or_default(),
        "completed_by": row.try_get::<Option<Uuid>, _>("completed_by").unwrap_or_default(),
        "completed_by_name": row.try_get::<Option<String>, _>("completed_by_name").unwrap_or_default(),
        "completed_at": format_datetime(row, "completed_at"),
        "created_by": row.try_get::<Uuid, _>("created_by").ok()?,
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "created_at": format_datetime(row, "created_at"),
        "updated_at": format_datetime(row, "updated_at"),
    }))
}

fn build_comment_json(row: &sqlx::postgres::PgRow) -> Option<serde_json::Value> {
    Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok()?,
        "body": row.try_get::<String, _>("body").ok()?,
        "created_by": row.try_get::<Uuid, _>("created_by").ok()?,
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "created_at": format_datetime(row, "created_at"),
    }))
}

fn build_history_json(row: &sqlx::postgres::PgRow) -> Option<serde_json::Value> {
    Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok()?,
        "event_type": row.try_get::<String, _>("event_type").ok()?,
        "actor_id": row.try_get::<Option<Uuid>, _>("actor_id").unwrap_or_default(),
        "actor_name": row.try_get::<Option<String>, _>("actor_name").unwrap_or_default(),
        "payload": row.try_get::<serde_json::Value, _>("payload").unwrap_or_else(|_| serde_json::json!({})),
        "created_at": format_datetime(row, "created_at"),
    }))
}

async fn resolve_assignee(
    state: &AppState,
    auth: &AuthUser,
    requested: Option<Uuid>,
) -> Result<Uuid, axum::response::Response> {
    let assigned_to = requested_assignee(auth, requested)?;

    let is_active_assignee = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND is_active = true AND role IN ('concierge', 'ceo', 'billing'))",
    )
    .bind(assigned_to)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, assigned_to = %assigned_to, "validate operational item assignee");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if !is_active_assignee {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "assigned_to must reference an active Concierge, CEO, or Billing user",
        ));
    }
    Ok(assigned_to)
}

#[allow(clippy::result_large_err)]
fn requested_assignee(
    auth: &AuthUser,
    requested: Option<Uuid>,
) -> Result<Uuid, axum::response::Response> {
    let assigned_to = if is_operational_self_service_role(auth.role) {
        if requested.is_some_and(|value| value != auth.user_id) {
            return Err(err(
                StatusCode::FORBIDDEN,
                "This role can only manage own operational items",
            ));
        }
        auth.user_id
    } else {
        requested.ok_or_else(|| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "assigned_to is required for this role",
            )
        })?
    };
    Ok(assigned_to)
}

async fn validate_active_operational_assignee_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    assigned_to: Uuid,
) -> Result<(), axum::response::Response> {
    let is_active_assignee = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND is_active = true AND role IN ('concierge', 'ceo', 'billing'))",
    )
    .bind(assigned_to)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, assigned_to = %assigned_to, "validate operational item assignee");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if !is_active_assignee {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "assigned_to must reference an active Concierge, CEO, or Billing user",
        ));
    }
    Ok(())
}

async fn validate_service_assignment_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    service_id: Uuid,
    assigned_to: Uuid,
) -> Result<(), axum::response::Response> {
    let is_safe_assignment = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM concierge_services cs
               LEFT JOIN providers p ON p.id = cs.provider_id
               LEFT JOIN appointments a ON a.id = cs.appointment_id
               WHERE cs.id = $1
                 AND cs.assigned_concierge_id = $2
                 AND (cs.provider_id IS NULL OR p.provider_type = 'non_medical')
                 AND (cs.appointment_id IS NULL OR a.appointment_type = 'non_medical')
           )"#,
    )
    .bind(service_id)
    .bind(assigned_to)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, service_id = %service_id, "validate operational service link");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if !is_safe_assignment {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "concierge_service_id must reference an assigned non-medical service",
        ));
    }
    Ok(())
}

async fn validate_service_assignment(
    state: &AppState,
    service_id: Uuid,
    assigned_to: Uuid,
) -> Result<(), axum::response::Response> {
    let is_safe_assignment = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM concierge_services cs
               LEFT JOIN providers p ON p.id = cs.provider_id
               LEFT JOIN appointments a ON a.id = cs.appointment_id
               WHERE cs.id = $1
                 AND cs.assigned_concierge_id = $2
                 AND (cs.provider_id IS NULL OR p.provider_type = 'non_medical')
                 AND (cs.appointment_id IS NULL OR a.appointment_type = 'non_medical')
           )"#,
    )
    .bind(service_id)
    .bind(assigned_to)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, service_id = %service_id, "validate operational service link");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if !is_safe_assignment {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "concierge_service_id must reference an assigned non-medical service",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::result_large_err)]
fn validate_item_fields(
    kind: &str,
    title: &str,
    note: Option<&str>,
    concierge_service_id: Option<Uuid>,
    due_at: Option<&str>,
    starts_at: Option<&str>,
    ends_at: Option<&str>,
    location: Option<&str>,
    priority: &str,
    reminder_at: Option<&str>,
) -> Result<ValidatedItemFields, axum::response::Response> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 255 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Title is required (max 255)",
        ));
    }
    if !is_valid_kind(kind) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid kind"));
    }
    if !is_valid_priority(priority) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid priority"));
    }
    let note = normalize_text(note, 4_000, "Note is too long")?;
    let location = normalize_text(location, 500, "Location is too long")?;
    let due_at = parse_datetime(due_at, "Invalid due_at (RFC3339)")?;
    let starts_at = parse_datetime(starts_at, "Invalid starts_at (RFC3339)")?;
    let ends_at = parse_datetime(ends_at, "Invalid ends_at (RFC3339)")?;
    let reminder_at = parse_datetime(reminder_at, "Invalid reminder_at (RFC3339)")?;

    if kind == "event" {
        if starts_at.is_none() {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "starts_at is required for an event",
            ));
        }
        if due_at.is_some() {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "due_at is only allowed for a task",
            ));
        }
    } else if starts_at.is_some() || ends_at.is_some() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "starts_at and ends_at are only allowed for an event",
        ));
    }
    if let (Some(start), Some(end)) = (starts_at.as_ref(), ends_at.as_ref())
        && end <= start
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ends_at must be after starts_at",
        ));
    }

    Ok(ValidatedItemFields {
        kind: kind.to_string(),
        title: title.to_string(),
        note,
        concierge_service_id,
        due_at,
        starts_at,
        ends_at,
        location,
        priority: priority.to_string(),
        reminder_at,
    })
}

fn create_item_payload_fingerprint(assigned_to: Uuid, fields: &ValidatedItemFields) -> String {
    let payload = serde_json::json!({
        "assigned_to": assigned_to,
        "kind": fields.kind,
        "title": fields.title,
        "note": fields.note,
        "concierge_service_id": fields.concierge_service_id,
        "due_at": fields.due_at.as_ref().map(DateTime::to_rfc3339),
        "starts_at": fields.starts_at.as_ref().map(DateTime::to_rfc3339),
        "ends_at": fields.ends_at.as_ref().map(DateTime::to_rfc3339),
        "location": fields.location,
        "priority": fields.priority,
        "reminder_at": fields.reminder_at.as_ref().map(DateTime::to_rfc3339),
    });
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(payload.to_string().as_bytes())),
    )
}

#[allow(clippy::result_large_err)]
fn normalize_text(
    value: Option<&str>,
    max_len: usize,
    message: &'static str,
) -> Result<Option<String>, axum::response::Response> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.chars().count() > max_len) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message));
    }
    Ok(value.map(str::to_string))
}

#[allow(clippy::result_large_err)]
fn parse_datetime(
    value: Option<&str>,
    message: &'static str,
) -> Result<Option<DateTime<Utc>>, axum::response::Response> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => DateTime::parse_from_rfc3339(value)
            .map(|value| Some(value.with_timezone(&Utc)))
            .map_err(|_| err(StatusCode::UNPROCESSABLE_ENTITY, message)),
        None => Ok(None),
    }
}

async fn load_item(
    state: &AppState,
    item_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let row = sqlx::query(OPERATIONAL_ITEM_RESPONSE_QUERY)
        .bind(item_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, item_id = %item_id, "load concierge operational item response");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?;
    Ok(row.as_ref().and_then(build_item_json))
}

async fn load_item_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    item_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let row = sqlx::query(OPERATIONAL_ITEM_RESPONSE_QUERY)
        .bind(item_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, item_id = %item_id, "load locked concierge operational item response");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?;
    Ok(row.as_ref().and_then(build_item_json))
}

fn build_item_json(row: &sqlx::postgres::PgRow) -> Option<serde_json::Value> {
    Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok()?,
        "kind": row.try_get::<String, _>("task_kind").ok()?,
        "title": row.try_get::<String, _>("title").ok()?,
        "note": row.try_get::<Option<String>, _>("operational_note").unwrap_or_default(),
        "assigned_to": row.try_get::<Uuid, _>("assigned_to").ok()?,
        "assigned_to_name": row.try_get::<String, _>("assigned_to_name").unwrap_or_default(),
        "assigned_by": row.try_get::<Uuid, _>("assigned_by").ok()?,
        "assigned_by_name": row.try_get::<String, _>("assigned_by_name").unwrap_or_default(),
        "concierge_service_id": row.try_get::<Option<Uuid>, _>("concierge_service_id").unwrap_or_default(),
        "due_at": format_datetime(row, "due_date"),
        "starts_at": format_datetime(row, "starts_at"),
        "ends_at": format_datetime(row, "ends_at"),
        "location": row.try_get::<Option<String>, _>("location").unwrap_or_default(),
        "priority": row.try_get::<String, _>("priority").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "reminder_at": format_datetime(row, "reminder_at"),
        "reminder_sent_at": format_datetime(row, "reminder_sent_at"),
        "checklist_total": row.try_get::<i64, _>("checklist_total").unwrap_or_default(),
        "checklist_completed": row.try_get::<i64, _>("checklist_completed").unwrap_or_default(),
        "comment_count": row.try_get::<i64, _>("comment_count").unwrap_or_default(),
        "completed_at": format_datetime(row, "completed_at"),
        "created_at": format_datetime(row, "created_at"),
        "updated_at": format_datetime(row, "updated_at"),
    }))
}

fn format_datetime(row: &sqlx::postgres::PgRow, column: &str) -> Option<String> {
    row.try_get::<Option<DateTime<Utc>>, _>(column)
        .unwrap_or_default()
        .map(|value| value.to_rfc3339())
}

async fn publish_operational_child_event(
    state: &AppState,
    auth: &AuthUser,
    event_type: &str,
    item_id: Uuid,
    assigned_to: Uuid,
    mut payload: serde_json::Value,
) {
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "assigned_to".to_owned(),
            serde_json::Value::String(assigned_to.to_string()),
        );
    }
    crate::realtime::publish_concierge_operational_task_event(
        state,
        Some(auth.user_id),
        event_type,
        item_id,
        assigned_to,
        payload,
    )
    .await;
}

async fn publish_operational_event(
    state: &AppState,
    auth: &AuthUser,
    event_type: &str,
    item_id: Uuid,
    assigned_to: Uuid,
    fields: &ValidatedItemFields,
    status: &str,
) {
    crate::realtime::publish_concierge_operational_task_event(
        state,
        Some(auth.user_id),
        event_type,
        item_id,
        assigned_to,
        serde_json::json!({
            "assigned_to": assigned_to,
            "kind": fields.kind.as_str(),
            "status": status,
            "concierge_service_id": fields.concierge_service_id,
            "due_at": fields.due_at.as_ref().map(|value| value.to_rfc3339()),
            "starts_at": fields.starts_at.as_ref().map(|value| value.to_rfc3339()),
            "ends_at": fields.ends_at.as_ref().map(|value| value.to_rfc3339()),
        }),
    )
    .await;
}

const CONCIERGE_TASK_REMINDER_INTERVAL_SECS: u64 = 60;

pub async fn run_concierge_task_reminder_scheduler_once(state: &AppState) -> i64 {
    let candidates = match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT task.id
           FROM tasks task
           JOIN users assignee ON assignee.id = task.assigned_to
           WHERE task.task_scope = 'concierge_operational'
             AND task.status IN ('open', 'in_progress')
             AND task.reminder_at IS NOT NULL
             AND task.reminder_at <= now()
             AND task.reminder_sent_at IS NULL
             AND assignee.is_active = true
             AND assignee.role = 'concierge'
           ORDER BY task.reminder_at, task.id
           LIMIT 100"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "scan due concierge task reminders");
            return 0;
        }
    };

    let mut delivered = 0_i64;
    for task_id in candidates {
        let rows = match sqlx::query(
            r#"WITH claimed AS (
                   UPDATE tasks task
                   SET reminder_sent_at = now(), updated_at = now()
                   WHERE task.id = $1
                     AND task.task_scope = 'concierge_operational'
                     AND task.status IN ('open', 'in_progress')
                     AND task.reminder_at IS NOT NULL
                     AND task.reminder_at <= now()
                     AND task.reminder_sent_at IS NULL
                     AND EXISTS (
                         SELECT 1 FROM users assignee
                         WHERE assignee.id = task.assigned_to
                           AND assignee.is_active = true
                           AND assignee.role = 'concierge'
                     )
                   RETURNING task.id, task.assigned_to, task.title, task.reminder_at
               ), history AS (
                   INSERT INTO concierge_operational_task_events (
                       task_id, event_type, actor_id, payload
                   )
                   SELECT id, 'reminder_sent', NULL,
                          jsonb_build_object('reminder_at', reminder_at)
                   FROM claimed
                   RETURNING task_id
               )
               INSERT INTO user_notifications (
                   user_id, kind, title, body, entity_type, entity_id
               )
               SELECT claimed.assigned_to,
                      'concierge_task_reminder',
                      'Task reminder',
                      claimed.title,
                      'concierge_task',
                      claimed.id
               FROM claimed
               JOIN history ON history.task_id = claimed.id
               RETURNING id, user_id"#,
        )
        .bind(task_id)
        .fetch_all(&state.db)
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, task_id = %task_id, "deliver concierge task reminder");
                continue;
            }
        };
        for row in rows {
            let notification_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
            let user_id = row
                .try_get::<Uuid, _>("user_id")
                .unwrap_or_else(|_| Uuid::nil());
            if notification_id == Uuid::nil() || user_id == Uuid::nil() {
                continue;
            }
            delivered += 1;
            crate::realtime::publish_notification_event(
                state,
                user_id,
                "notification.created",
                Some(notification_id),
                serde_json::json!({
                    "entity_type": "concierge_task",
                    "entity_id": task_id,
                }),
            )
            .await;
            crate::realtime::publish_concierge_operational_task_event(
                state,
                None,
                "concierge_operational_item.reminder_sent",
                task_id,
                user_id,
                serde_json::json!({
                    "assigned_to": user_id,
                }),
            )
            .await;
        }
    }
    delivered
}

pub fn spawn_concierge_task_reminder_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            CONCIERGE_TASK_REMINDER_INTERVAL_SECS,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let delivered = run_concierge_task_reminder_scheduler_once(&state).await;
            if delivered > 0 {
                tracing::info!(delivered, "Concierge task reminders delivered");
            }
        }
    });
}

#[allow(clippy::result_large_err)]
fn require_operational_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::Concierge, Role::Billing])
}

fn is_operational_self_service_role(role: Role) -> bool {
    matches!(role, Role::Concierge | Role::Billing)
}

fn is_valid_kind(value: &str) -> bool {
    matches!(value, "task" | "event")
}

fn is_valid_priority(value: &str) -> bool {
    matches!(value, "low" | "normal" | "high" | "urgent")
}

fn is_valid_status(value: &str) -> bool {
    matches!(value, "open" | "in_progress" | "completed" | "cancelled")
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}
