use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::Row;
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
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateItemRequest {
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
}

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

    let assignee_filter = if auth.role == Role::Concierge {
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
                  t.location, t.priority, t.status, t.completed_at, t.created_at, t.updated_at,
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
    let assigned_to = match resolve_assignee(&state, &auth, body.assigned_to).await {
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
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Some(service_id) = fields.concierge_service_id
        && let Err(response) = validate_service_assignment(&state, service_id, assigned_to).await
    {
        return response;
    }

    let item_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO tasks (
               title, description, assigned_to, assigned_by, due_date, priority,
               task_scope, task_kind, concierge_service_id, starts_at, ends_at, location
           ) VALUES ($1, $2, $3, $4, $5, $6, 'concierge_operational', $7, $8, $9, $10, $11)
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
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, "create concierge operational item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

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

    let existing_assignee = match sqlx::query_scalar::<_, Uuid>(
        "SELECT assigned_to FROM tasks WHERE id = $1 AND task_scope = 'concierge_operational'",
    )
    .bind(item_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Operational item not found"),
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "load concierge operational item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if auth.role == Role::Concierge && existing_assignee != auth.user_id {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
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
               updated_at = now()
           WHERE id = $1
             AND task_scope = 'concierge_operational'
             AND ($13::bool = false OR assigned_to = $14)"#,
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
    .bind(auth.role == Role::Concierge)
    .bind(auth.user_id)
    .execute(&state.db)
    .await;
    match result {
        Ok(result) if result.rows_affected() == 1 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Operational item not found"),
        Err(error) => {
            tracing::error!(error = %error, item_id = %item_id, "update concierge operational item");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
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

async fn resolve_assignee(
    state: &AppState,
    auth: &AuthUser,
    requested: Option<Uuid>,
) -> Result<Uuid, axum::response::Response> {
    let assigned_to = if auth.role == Role::Concierge {
        if requested.is_some_and(|value| value != auth.user_id) {
            return Err(err(
                StatusCode::FORBIDDEN,
                "Concierge can only manage own items",
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

    let is_active_concierge = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND is_active = true AND role = 'concierge')",
    )
    .bind(assigned_to)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, assigned_to = %assigned_to, "validate operational item assignee");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if !is_active_concierge {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "assigned_to must reference an active Concierge",
        ));
    }
    Ok(assigned_to)
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
    })
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
    let row = sqlx::query(
        r#"SELECT t.id, t.title, t.description AS operational_note, t.assigned_to, t.assigned_by,
                  CASE
                      WHEN cs.assigned_concierge_id = t.assigned_to
                       AND (cs.provider_id IS NULL OR linked_provider.provider_type = 'non_medical')
                       AND (cs.appointment_id IS NULL OR linked_appointment.appointment_type = 'non_medical')
                      THEN t.concierge_service_id
                      ELSE NULL
                  END AS concierge_service_id,
                  t.task_kind, t.due_date, t.starts_at, t.ends_at,
                  t.location, t.priority, t.status, t.completed_at, t.created_at, t.updated_at,
                  assignee.name AS assigned_to_name, assigner.name AS assigned_by_name
           FROM tasks t
           JOIN users assignee ON assignee.id = t.assigned_to
           JOIN users assigner ON assigner.id = t.assigned_by
           LEFT JOIN concierge_services cs ON cs.id = t.concierge_service_id
           LEFT JOIN providers linked_provider ON linked_provider.id = cs.provider_id
           LEFT JOIN appointments linked_appointment ON linked_appointment.id = cs.appointment_id
           WHERE t.id = $1 AND t.task_scope = 'concierge_operational'"#,
    )
    .bind(item_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, item_id = %item_id, "load concierge operational item response");
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

async fn publish_operational_event(
    state: &AppState,
    auth: &AuthUser,
    event_type: &str,
    item_id: Uuid,
    assigned_to: Uuid,
    fields: &ValidatedItemFields,
    status: &str,
) {
    crate::realtime::publish_task_event(
        state,
        Some(auth.user_id),
        event_type,
        item_id,
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

#[allow(clippy::result_large_err)]
fn require_operational_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::Concierge])
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
