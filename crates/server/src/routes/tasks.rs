use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/{task_id}", get(get_task))
        .route("/tasks/{task_id}/status", post(update_status))
}

#[derive(Deserialize)]
struct ListTasksQuery {
    search: Option<String>,
    status: Option<String>,
    assigned_to: Option<Uuid>,
    patient_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    order_id: Option<Uuid>,
    mine_only: Option<bool>,
}

#[derive(Deserialize)]
struct CreateTaskRequest {
    title: String,
    description: Option<String>,
    assigned_to: Uuid,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    due_date: Option<String>,
    priority: Option<String>,
}

#[derive(Deserialize)]
struct UpdateTaskStatusRequest {
    status: String,
}

async fn list_tasks(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListTasksQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
    ]) {
        return e;
    }

    if let Some(ref status) = query.status
        && !is_valid_task_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let mine_only = query.mine_only.unwrap_or(false);

    match sqlx::query(
        r#"SELECT t.id, t.title, t.description, t.assigned_to, t.assigned_by, t.patient_id,
                  t.order_id, t.appointment_id, t.due_date, t.priority, t.status,
                  t.completed_at, t.created_at, t.updated_at,
                  assignee.name AS assigned_to_name, assignee.role AS assigned_to_role,
                  assigner.name AS assigned_by_name
           FROM tasks t
           JOIN users assignee ON assignee.id = t.assigned_to
           JOIN users assigner ON assigner.id = t.assigned_by
           WHERE ($1::text = '%%' OR t.title ILIKE $1 OR COALESCE(t.description, '') ILIKE $1)
             AND ($2::text IS NULL OR t.status = $2)
             AND ($3::uuid IS NULL OR t.assigned_to = $3)
             AND ($4::uuid IS NULL OR t.patient_id = $4)
             AND ($5::uuid IS NULL OR t.appointment_id = $5)
             AND ($6::uuid IS NULL OR t.order_id = $6)
             AND ($7::bool = false OR t.assigned_to = $8)
           ORDER BY
               CASE t.priority
                   WHEN 'urgent' THEN 0
                   WHEN 'high' THEN 1
                   WHEN 'normal' THEN 2
                   ELSE 3
               END,
               t.due_date NULLS LAST,
               t.created_at DESC"#,
    )
    .bind(search_pattern)
    .bind(query.status)
    .bind(query.assigned_to)
    .bind(query.patient_id)
    .bind(query.appointment_id)
    .bind(query.order_id)
    .bind(mine_only)
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                let task_id: Uuid = match row.try_get("id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                if !can_view_task(&state, &auth, &row).await {
                    continue;
                }
                items.push(build_task_json(task_id, &row));
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list tasks");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn get_task(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(task_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
    ]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT t.id, t.title, t.description, t.assigned_to, t.assigned_by, t.patient_id,
                  t.order_id, t.appointment_id, t.due_date, t.priority, t.status,
                  t.completed_at, t.created_at, t.updated_at,
                  assignee.name AS assigned_to_name, assignee.role AS assigned_to_role,
                  assigner.name AS assigned_by_name
           FROM tasks t
           JOIN users assignee ON assignee.id = t.assigned_to
           JOIN users assigner ON assigner.id = t.assigned_by
           WHERE t.id = $1"#,
    )
    .bind(task_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            if !can_view_task(&state, &auth, &row).await {
                return err(StatusCode::FORBIDDEN, "Insufficient permissions");
            }
            Json(build_task_json(task_id, &row)).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Task not found"),
        Err(e) => {
            tracing::error!(error = %e, task_id = %task_id, "get task");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn create_task(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateTaskRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if body.title.trim().is_empty() || body.title.len() > 255 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Task title is required (max 255)",
        );
    }

    let priority = body.priority.unwrap_or_else(|| "normal".to_string());
    if !is_valid_task_priority(&priority) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid priority");
    }
    let title = body.title.clone();
    let description = body.description.clone();

    let due_date = match body.due_date.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            match chrono::DateTime::parse_from_rfc3339(value) {
                Ok(value) => Some(value.with_timezone(&chrono::Utc)),
                Err(_) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid due_date (RFC3339)",
                    );
                }
            }
        }
        _ => None,
    };
    let due_date_payload = due_date.as_ref().map(|value| value.to_rfc3339());

    let target_role = match load_active_assignable_role(&state, body.assigned_to).await {
        Ok(Some(role)) => role,
        Ok(None) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Assigned user must be an active PM/teamlead/interpreter/concierge",
            );
        }
        Err(resp) => return resp,
    };

    let (patient_id, order_id, appointment_id) =
        match resolve_task_context(&state, body.patient_id, body.order_id, body.appointment_id)
            .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    if let Some(patient_id) = patient_id {
        if !can_access_patient_task_scope(&state, &auth, patient_id).await {
            return err(StatusCode::FORBIDDEN, "Insufficient permissions");
        }
        if let Err(resp) = ensure_assignee_has_patient_scope(
            &state,
            auth.role,
            patient_id,
            body.assigned_to,
            &target_role,
        )
        .await
        {
            return resp;
        }
    }

    match sqlx::query(
        r#"INSERT INTO tasks (
                title, description, assigned_to, assigned_by, patient_id, order_id, appointment_id,
                due_date, priority
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9
           )
           RETURNING id, created_at"#,
    )
    .bind(body.title.as_str())
    .bind(body.description.as_deref())
    .bind(body.assigned_to)
    .bind(auth.user_id)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(due_date)
    .bind(priority.as_str())
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let task_id: Uuid = match row.try_get("id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            state.audit_sender.try_send(audit::domain_event(
                "create_task",
                Some(auth.user_id),
                "task",
                Some(task_id),
                serde_json::json!({
                    "assigned_to": body.assigned_to,
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "order_id": order_id,
                }),
            ));

            crate::realtime::publish_task_event(
                &state,
                Some(auth.user_id),
                "task.created",
                task_id,
                serde_json::json!({
                    "assigned_to": body.assigned_to,
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "order_id": order_id,
                    "title": title,
                    "description": description,
                    "priority": priority,
                    "due_date": due_date_payload,
                }),
            )
            .await;

            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": task_id,
                    "created_at": row
                        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                        .map(|value| value.to_rfc3339())
                        .unwrap_or_default()
                })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "create task");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn update_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(task_id): Path<Uuid>,
    Json(body): Json<UpdateTaskStatusRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    if !is_valid_task_status(&body.status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let row = match sqlx::query(
        "SELECT assigned_to, patient_id, appointment_id, order_id FROM tasks WHERE id = $1",
    )
    .bind(task_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Task not found"),
        Err(e) => {
            tracing::error!(error = %e, task_id = %task_id, "load task status context");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if !can_update_task(&state, &auth, &row).await {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let status = body.status;

    match sqlx::query(
        r#"UPDATE tasks
           SET status = $2,
               completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(task_id)
    .bind(&status)
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            if status == "completed" {
                let checklist_row = sqlx::query(
                    r#"UPDATE workflow_checklist_items
                       SET is_completed = true,
                           completed_by = $2,
                           completed_at = COALESCE(completed_at, now()),
                           updated_at = now()
                       WHERE linked_task_id = $1
                         AND is_completed = false
                       RETURNING id, patient_id, order_id, scope_type, scope_id, item_text"#,
                )
                .bind(task_id)
                .bind(auth.user_id)
                .fetch_optional(&state.db)
                .await;

                match checklist_row {
                    Ok(Some(row)) => {
                        let checklist_item_id: Option<Uuid> = row.try_get("id").ok();
                        let patient_id: Option<Uuid> = row.try_get("patient_id").ok();
                        let order_id: Option<Uuid> = row.try_get("order_id").unwrap_or_default();
                        let scope_type: String = row.try_get("scope_type").unwrap_or_default();
                        let scope_id: Option<Uuid> = row.try_get("scope_id").ok();
                        let item_text: String = row.try_get("item_text").unwrap_or_default();
                        if let Some(patient_id) = patient_id {
                            state.audit_sender.try_send(audit::domain_event(
                                "workflow_checklist_item_completed",
                                Some(auth.user_id),
                                "patient",
                                Some(patient_id),
                                serde_json::json!({
                                    "scope_type": scope_type,
                                    "scope_id": scope_id,
                                    "order_id": order_id,
                                    "task_id": task_id,
                                    "item_text": item_text,
                                    "completed_via": "task",
                                }),
                            ));
                        }
                        if let Some(checklist_item_id) = checklist_item_id {
                            crate::realtime::publish_workflow_checklist_event(
                                &state,
                                Some(auth.user_id),
                                "workflow_checklist_item.completed",
                                checklist_item_id,
                                serde_json::json!({
                                    "scope_type": scope_type,
                                    "scope_id": scope_id,
                                    "order_id": order_id,
                                    "task_id": task_id,
                                    "item_text": item_text,
                                    "completed_via": "task",
                                }),
                            )
                            .await;
                        }
                    }
                    Ok(None) => {}
                    Err(e) => {
                        tracing::error!(error = %e, task_id = %task_id, "sync workflow checklist from task");
                    }
                }
            }

            crate::realtime::publish_task_event(
                &state,
                Some(auth.user_id),
                "task.status_changed",
                task_id,
                serde_json::json!({
                    "status": status,
                }),
            )
            .await;

            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Task not found"),
        Err(e) => {
            tracing::error!(error = %e, task_id = %task_id, "update task status");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn build_task_json(task_id: Uuid, row: &sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({
        "id": task_id,
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
        "assigned_to": row.try_get::<Uuid, _>("assigned_to").unwrap_or_else(|_| Uuid::nil()),
        "assigned_to_name": row.try_get::<String, _>("assigned_to_name").unwrap_or_default(),
        "assigned_to_role": row.try_get::<String, _>("assigned_to_role").unwrap_or_default(),
        "assigned_by": row.try_get::<Uuid, _>("assigned_by").unwrap_or_else(|_| Uuid::nil()),
        "assigned_by_name": row.try_get::<String, _>("assigned_by_name").unwrap_or_default(),
        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        "due_date": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("due_date").unwrap_or_default().map(|value| value.to_rfc3339()),
        "priority": row.try_get::<String, _>("priority").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "completed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn is_valid_task_status(value: &str) -> bool {
    matches!(value, "open" | "in_progress" | "completed" | "cancelled")
}

fn is_valid_task_priority(value: &str) -> bool {
    matches!(value, "low" | "normal" | "high" | "urgent")
}

async fn load_active_assignable_role(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<String>, axum::response::Response> {
    let row = sqlx::query("SELECT role FROM users WHERE id = $1 AND is_active = true")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %user_id, "load assignable role");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate assignee",
            )
        })?;

    let Some(row) = row else {
        return Ok(None);
    };
    let role: String = row.try_get("role").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate assignee",
        )
    })?;
    if matches!(
        role.as_str(),
        "patient_manager" | "teamlead_interpreter" | "interpreter" | "concierge" | "billing"
    ) {
        Ok(Some(role))
    } else {
        Ok(None)
    }
}

async fn resolve_task_context(
    state: &AppState,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
) -> Result<(Option<Uuid>, Option<Uuid>, Option<Uuid>), axum::response::Response> {
    if let Some(appointment_id) = appointment_id {
        let row = sqlx::query("SELECT patient_id, order_id FROM appointments WHERE id = $1")
            .bind(appointment_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, appointment_id = %appointment_id, "resolve appointment task context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate appointment")
            })?;
        let Some(row) = row else {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Appointment not found",
            ));
        };
        let derived_patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate appointment",
            )
        })?;
        let derived_order_id: Option<Uuid> = row.try_get("order_id").unwrap_or_default();

        if let Some(patient_id) = patient_id
            && patient_id != derived_patient_id
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "patient_id does not match appointment",
            ));
        }
        if let Some(order_id) = order_id
            && Some(order_id) != derived_order_id
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "order_id does not match appointment",
            ));
        }
        return Ok((
            Some(derived_patient_id),
            derived_order_id,
            Some(appointment_id),
        ));
    }

    if let Some(order_id) = order_id {
        let row = sqlx::query("SELECT patient_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, order_id = %order_id, "resolve order task context");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate order",
                )
            })?;
        let Some(row) = row else {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Order not found"));
        };
        let derived_patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate order",
            )
        })?;
        if let Some(patient_id) = patient_id
            && patient_id != derived_patient_id
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "patient_id does not match order",
            ));
        }
        return Ok((Some(derived_patient_id), Some(order_id), None));
    }

    Ok((patient_id, None, None))
}

async fn can_access_patient_task_scope(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> bool {
    if auth.role == Role::Ceo {
        return true;
    }
    if auth.role != Role::PatientManager {
        return false;
    }
    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .unwrap_or(false)
}

async fn ensure_assignee_has_patient_scope(
    state: &AppState,
    assigner_role: Role,
    patient_id: Uuid,
    assignee_id: Uuid,
    assignee_role: &str,
) -> Result<(), axum::response::Response> {
    if matches!(
        assignee_role,
        "interpreter" | "concierge" | "teamlead_interpreter"
    ) && assigner_role == Role::PatientManager
    {
        let has_assignment = access::has_active_patient_assignment(&state.db, patient_id, assignee_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_id, assignee_id = %assignee_id, "validate assignee patient scope");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate assignee scope")
            })?;
        if !has_assignment {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Assignee must be linked to patient before task assignment",
            ));
        }
    }
    Ok(())
}

async fn can_view_task(state: &AppState, auth: &AuthUser, row: &sqlx::postgres::PgRow) -> bool {
    if auth.role == Role::Ceo {
        return true;
    }

    let assigned_to: Uuid = match row.try_get("assigned_to") {
        Ok(value) => value,
        Err(_) => return false,
    };
    if assigned_to == auth.user_id {
        return true;
    }

    if auth.role == Role::PatientManager {
        let assigned_by: Uuid = match row.try_get("assigned_by") {
            Ok(value) => value,
            Err(_) => return false,
        };
        if assigned_by == auth.user_id {
            return true;
        }
        let patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
        if let Some(patient_id) = patient_id {
            return access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
                .await
                .unwrap_or(false);
        }
    }

    false
}

async fn can_update_task(state: &AppState, auth: &AuthUser, row: &sqlx::postgres::PgRow) -> bool {
    if auth.role == Role::Ceo {
        return true;
    }
    let assigned_to: Uuid = match row.try_get("assigned_to") {
        Ok(value) => value,
        Err(_) => return false,
    };
    if assigned_to == auth.user_id {
        return true;
    }
    if auth.role == Role::PatientManager {
        let patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
        if let Some(patient_id) = patient_id {
            return access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
                .await
                .unwrap_or(false);
        }
    }
    false
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
