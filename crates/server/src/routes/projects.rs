use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use gmed_domain::role::Role;
use serde::Deserialize;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{audit, auth::middleware::AuthUser, realtime::RealtimeEvent, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects", get(list_projects).post(create_project))
        .route("/projects/{project_id}", get(get_project))
        .route("/projects/{project_id}/update", post(update_project))
        .route(
            "/projects/{project_id}/workflow/dependencies",
            get(list_workflow_dependencies).post(create_workflow_dependency),
        )
        .route(
            "/projects/{project_id}/workflow/dependencies/{dependency_id}/delete",
            post(delete_workflow_dependency),
        )
}

#[derive(Deserialize)]
struct ListProjectsQuery {
    q: Option<String>,
    status: Option<String>,
    patient_id: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectRequest {
    name: String,
    description: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    owner_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    starts_on: Option<String>,
    due_on: Option<String>,
    member_ids: Option<Vec<Uuid>>,
    expected_updated_at: Option<String>,
}

struct ProjectFields {
    name: String,
    description: Option<String>,
    status: String,
    priority: String,
    owner_id: Uuid,
    patient_id: Option<Uuid>,
    starts_on: Option<NaiveDate>,
    due_on: Option<NaiveDate>,
    member_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkflowDependencyRequest {
    task_id: Uuid,
    depends_on_task_id: Uuid,
}

const PROJECT_SELECT: &str = r#"
    SELECT project.id, project.name, project.description, project.status, project.priority,
           project.owner_id, owner.name AS owner_name, project.patient_id,
           NULLIF(BTRIM(CONCAT_WS(' ', patient.first_name, patient.last_name)), '') AS patient_name,
           project.starts_on, project.due_on, project.created_by,
           creator.name AS created_by_name, project.created_at, project.updated_at,
           COUNT(DISTINCT task.id) FILTER (WHERE task.deleted_at IS NULL) AS task_total,
           COUNT(DISTINCT task.id) FILTER (WHERE task.deleted_at IS NULL AND task.status = 'completed') AS task_completed,
           COUNT(DISTINCT member.user_id) AS member_count
    FROM crm_projects project
    JOIN users owner ON owner.id = project.owner_id
    JOIN users creator ON creator.id = project.created_by
    LEFT JOIN patients patient ON patient.id = project.patient_id
    LEFT JOIN crm_project_members member ON member.project_id = project.id
    LEFT JOIN tasks task ON task.project_id = project.id
"#;

async fn list_projects(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListProjectsQuery>,
) -> axum::response::Response {
    if let Err(response) = require_project_staff(&auth) {
        return response;
    }
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| format!("%{v}%"));
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if status.is_some_and(|value| !valid_status(value)) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid project status");
    }
    let sql = format!(
        "{PROJECT_SELECT}
         WHERE project.archived_at IS NULL
           AND ($1::text IS NULL OR project.name ILIKE $1 OR COALESCE(project.description, '') ILIKE $1)
           AND ($2::text IS NULL OR project.status = $2)
           AND ($3::uuid IS NULL OR project.patient_id = $3)
           AND ($4::boolean OR project.owner_id = $5 OR EXISTS (
                SELECT 1 FROM crm_project_members access_member
                WHERE access_member.project_id = project.id AND access_member.user_id = $5
           ) OR EXISTS (
                SELECT 1 FROM tasks access_task
                WHERE access_task.project_id = project.id AND access_task.assigned_to = $5 AND access_task.deleted_at IS NULL
           ))
         GROUP BY project.id, owner.name, patient.first_name, patient.last_name, creator.name
         ORDER BY CASE project.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END,
                  project.updated_at DESC
         LIMIT 500"
    );
    let rows = match sqlx::query(&sql)
        .bind(search)
        .bind(status)
        .bind(query.patient_id)
        .bind(matches!(auth.role, Role::Ceo))
        .bind(auth.user_id)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "list CRM projects");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load projects");
        }
    };
    Json(
        rows.iter()
            .filter_map(project_summary_json)
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn create_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<ProjectRequest>,
) -> axum::response::Response {
    if let Err(response) = require_project_staff(&auth) {
        return response;
    }
    let mut fields = match validate_fields(&body, auth.user_id) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    // A non-CEO creator may immediately transfer ownership to another staff
    // member. Keep the creator in the project team so the successful create
    // response remains readable and the project does not disappear from their
    // workspace right after it is created.
    if fields.member_ids.binary_search(&auth.user_id).is_err() {
        if fields.member_ids.len() >= 100 {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Too many project members");
        }
        fields.member_ids.push(auth.user_id);
        fields.member_ids.sort_unstable();
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create project",
            );
        }
    };
    if let Err(response) = validate_references(&mut tx, &fields).await {
        return response;
    }
    let project_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO crm_projects
           (name, description, status, priority, owner_id, patient_id, starts_on, due_on, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
    )
    .bind(&fields.name)
    .bind(fields.description.as_deref())
    .bind(&fields.status)
    .bind(&fields.priority)
    .bind(fields.owner_id)
    .bind(fields.patient_id)
    .bind(fields.starts_on)
    .bind(fields.due_on)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(error) => {
            tracing::error!(error = %error, "create CRM project");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create project");
        }
    };
    if let Err(response) = replace_members(&mut tx, project_id, &fields, auth.user_id).await {
        return response;
    }
    if tx.commit().await.is_err() {
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create project",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "create_crm_project",
        Some(auth.user_id),
        "crm_project",
        Some(project_id),
        serde_json::json!({ "owner_id": fields.owner_id, "patient_id": fields.patient_id }),
    ));
    publish_project_event(
        &state,
        &auth,
        "crm_project.created",
        project_id,
        &fields,
        &[],
    )
    .await;
    match load_project(&state, &auth, project_id).await {
        Ok(Some(value)) => (StatusCode::CREATED, Json(value)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Project not found"),
        Err(response) => response,
    }
}

async fn get_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(project_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_project_staff(&auth) {
        return response;
    }
    match load_project(&state, &auth, project_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Project not found"),
        Err(response) => response,
    }
}

async fn list_workflow_dependencies(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(project_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_project_staff(&auth) {
        return response;
    }
    if !has_project_access(&state, &auth, project_id).await {
        return err(StatusCode::NOT_FOUND, "Project not found");
    }

    let rows = match sqlx::query(
        r#"SELECT dependency.id, dependency.task_id, dependency.depends_on_task_id,
                  dependency.created_by, creator.name AS created_by_name,
                  dependency.created_at
             FROM crm_project_task_dependencies dependency
             JOIN users creator ON creator.id = dependency.created_by
            WHERE dependency.project_id = $1
            ORDER BY dependency.created_at, dependency.id"#,
    )
    .bind(project_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, project_id = %project_id, "list project workflow dependencies");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load workflow dependencies",
            );
        }
    };

    Json(
        rows.iter()
            .filter_map(|row| {
                Some(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").ok()?,
                    "task_id": row.try_get::<Uuid, _>("task_id").ok()?,
                    "depends_on_task_id": row.try_get::<Uuid, _>("depends_on_task_id").ok()?,
                    "created_by": row.try_get::<Uuid, _>("created_by").ok()?,
                    "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
                    "created_at": row.try_get::<DateTime<Utc>, _>("created_at").ok()?.to_rfc3339(),
                }))
            })
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn create_workflow_dependency(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<WorkflowDependencyRequest>,
) -> axum::response::Response {
    if let Err(response) = require_project_staff(&auth) {
        return response;
    }
    if !can_manage_project(&state, &auth, project_id).await {
        return err(
            StatusCode::FORBIDDEN,
            "Only the owner or a project manager can edit the workflow",
        );
    }
    if body.task_id == body.depends_on_task_id {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A task cannot depend on itself",
        );
    }

    let row = match sqlx::query(
        r#"INSERT INTO crm_project_task_dependencies
              (project_id, task_id, depends_on_task_id, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, task_id, depends_on_task_id)
           DO UPDATE SET project_id = EXCLUDED.project_id
           RETURNING id, task_id, depends_on_task_id, created_by, created_at"#,
    )
    .bind(project_id)
    .bind(body.task_id)
    .bind(body.depends_on_task_id)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            let message = error.to_string();
            if message.contains("selected project") {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Both workflow tasks must belong to the selected project",
                );
            }
            if message.contains("create a cycle") {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Workflow dependency would create a cycle",
                );
            }
            tracing::error!(error = %error, project_id = %project_id, "create project workflow dependency");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create workflow dependency",
            );
        }
    };

    let dependency_id = match row.try_get::<Uuid, _>("id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create workflow dependency",
            );
        }
    };
    state.audit_sender.try_send(audit::domain_event(
        "create_crm_project_workflow_dependency",
        Some(auth.user_id),
        "crm_project_task_dependency",
        Some(dependency_id),
        serde_json::json!({
            "project_id": project_id,
            "task_id": body.task_id,
            "depends_on_task_id": body.depends_on_task_id,
        }),
    ));
    publish_workflow_event(
        &state,
        &auth,
        project_id,
        "crm_project.workflow_updated",
        serde_json::json!({
            "dependency_id": dependency_id,
            "task_id": body.task_id,
            "depends_on_task_id": body.depends_on_task_id,
            "action": "created",
        }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": dependency_id,
            "task_id": row.try_get::<Uuid, _>("task_id").unwrap_or(body.task_id),
            "depends_on_task_id": row
                .try_get::<Uuid, _>("depends_on_task_id")
                .unwrap_or(body.depends_on_task_id),
            "created_by": row.try_get::<Uuid, _>("created_by").unwrap_or(auth.user_id),
            "created_by_name": "",
            "created_at": row
                .try_get::<DateTime<Utc>, _>("created_at")
                .map(|value| value.to_rfc3339())
                .unwrap_or_else(|_| Utc::now().to_rfc3339()),
        })),
    )
        .into_response()
}

async fn delete_workflow_dependency(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((project_id, dependency_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = require_project_staff(&auth) {
        return response;
    }
    if !can_manage_project(&state, &auth, project_id).await {
        return err(
            StatusCode::FORBIDDEN,
            "Only the owner or a project manager can edit the workflow",
        );
    }

    let deleted = match sqlx::query(
        r#"DELETE FROM crm_project_task_dependencies
            WHERE id = $1 AND project_id = $2
            RETURNING task_id, depends_on_task_id"#,
    )
    .bind(dependency_id)
    .bind(project_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, project_id = %project_id, dependency_id = %dependency_id, "delete project workflow dependency");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete workflow dependency",
            );
        }
    };
    let Some(deleted) = deleted else {
        return err(StatusCode::NOT_FOUND, "Workflow dependency not found");
    };
    let task_id = deleted.try_get::<Uuid, _>("task_id").ok();
    let depends_on_task_id = deleted.try_get::<Uuid, _>("depends_on_task_id").ok();

    state.audit_sender.try_send(audit::domain_event(
        "delete_crm_project_workflow_dependency",
        Some(auth.user_id),
        "crm_project_task_dependency",
        Some(dependency_id),
        serde_json::json!({
            "project_id": project_id,
            "task_id": task_id,
            "depends_on_task_id": depends_on_task_id,
        }),
    ));
    publish_workflow_event(
        &state,
        &auth,
        project_id,
        "crm_project.workflow_updated",
        serde_json::json!({
            "dependency_id": dependency_id,
            "task_id": task_id,
            "depends_on_task_id": depends_on_task_id,
            "action": "deleted",
        }),
    )
    .await;

    StatusCode::NO_CONTENT.into_response()
}

async fn update_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<ProjectRequest>,
) -> axum::response::Response {
    if let Err(response) = require_project_staff(&auth) {
        return response;
    }
    let expected_updated_at = match body
        .expected_updated_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value.trim()).ok())
    {
        Some(value) => value.with_timezone(&Utc),
        None => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "expected_updated_at is required",
            );
        }
    };
    let fields = match validate_fields(&body, auth.user_id) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let can_manage = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM crm_projects project
             LEFT JOIN crm_project_members member
               ON member.project_id = project.id AND member.user_id = $2 AND member.member_role = 'manager'
             WHERE project.id = $1 AND project.archived_at IS NULL
               AND ($3::boolean OR project.owner_id = $2 OR member.user_id IS NOT NULL)
           )"#,
    )
    .bind(project_id)
    .bind(auth.user_id)
    .bind(matches!(auth.role, Role::Ceo))
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);
    if !can_manage {
        return err(
            StatusCode::FORBIDDEN,
            "Only the owner or a project manager can edit this project",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update project",
            );
        }
    };
    if let Err(response) = validate_references(&mut tx, &fields).await {
        return response;
    }
    let previous_member_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM crm_project_members WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_all(&mut *tx)
    .await
    .unwrap_or_default();
    let result = sqlx::query(
        r#"UPDATE crm_projects
           SET name = $2, description = $3, status = $4, priority = $5,
               owner_id = $6, patient_id = $7, starts_on = $8, due_on = $9, updated_at = now()
           WHERE id = $1 AND archived_at IS NULL AND updated_at = $10"#,
    )
    .bind(project_id)
    .bind(&fields.name)
    .bind(fields.description.as_deref())
    .bind(&fields.status)
    .bind(&fields.priority)
    .bind(fields.owner_id)
    .bind(fields.patient_id)
    .bind(fields.starts_on)
    .bind(fields.due_on)
    .bind(expected_updated_at)
    .execute(&mut *tx)
    .await;
    match result {
        Ok(result) if result.rows_affected() == 1 => {}
        Ok(_) => return err(StatusCode::CONFLICT, "Project was changed by another user"),
        Err(error) => {
            tracing::error!(error = %error, project_id = %project_id, "update CRM project");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update project",
            );
        }
    }
    if let Err(response) = replace_members(&mut tx, project_id, &fields, auth.user_id).await {
        return response;
    }
    if tx.commit().await.is_err() {
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update project",
        );
    }
    state.audit_sender.try_send(audit::domain_event(
        "update_crm_project",
        Some(auth.user_id),
        "crm_project",
        Some(project_id),
        serde_json::json!({ "status": fields.status, "owner_id": fields.owner_id }),
    ));
    publish_project_event(
        &state,
        &auth,
        "crm_project.updated",
        project_id,
        &fields,
        &previous_member_ids,
    )
    .await;
    match load_project(&state, &auth, project_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Project not found"),
        Err(response) => response,
    }
}

fn validate_fields(
    body: &ProjectRequest,
    current_user_id: Uuid,
) -> Result<ProjectFields, axum::response::Response> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 255 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Project name is required (max 255)",
        ));
    }
    let description = body
        .description
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned);
    if description
        .as_ref()
        .is_some_and(|value| value.chars().count() > 8_000)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Project description is too long",
        ));
    }
    let status = body.status.as_deref().unwrap_or("planned");
    let priority = body.priority.as_deref().unwrap_or("normal");
    if !valid_status(status) || !valid_priority(priority) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid project status or priority",
        ));
    }
    let starts_on = parse_date(body.starts_on.as_deref(), "Invalid starts_on")?;
    let due_on = parse_date(body.due_on.as_deref(), "Invalid due_on")?;
    if starts_on
        .zip(due_on)
        .is_some_and(|(start, due)| due < start)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "due_on must not be before starts_on",
        ));
    }
    let owner_id = body.owner_id.unwrap_or(current_user_id);
    let mut member_ids = body.member_ids.clone().unwrap_or_default();
    member_ids.push(owner_id);
    member_ids.sort_unstable();
    member_ids.dedup();
    if member_ids.len() > 100 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many project members",
        ));
    }
    Ok(ProjectFields {
        name: name.to_owned(),
        description,
        status: status.to_owned(),
        priority: priority.to_owned(),
        owner_id,
        patient_id: body.patient_id,
        starts_on,
        due_on,
        member_ids,
    })
}

fn parse_date(
    value: Option<&str>,
    message: &'static str,
) -> Result<Option<NaiveDate>, axum::response::Response> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| {
            NaiveDate::parse_from_str(v, "%Y-%m-%d")
                .map_err(|_| err(StatusCode::UNPROCESSABLE_ENTITY, message))
        })
        .transpose()
}

async fn validate_references(
    tx: &mut Transaction<'_, Postgres>,
    fields: &ProjectFields,
) -> Result<(), axum::response::Response> {
    let valid_users = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM users
           WHERE id = ANY($1) AND is_active
             AND role IN ('ceo', 'ceo_assistant', 'patient_manager', 'teamlead_interpreter',
                          'interpreter', 'concierge', 'billing', 'sales')"#,
    )
    .bind(&fields.member_ids)
    .fetch_one(&mut **tx)
    .await
    .unwrap_or(-1);
    if valid_users != fields.member_ids.len() as i64 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Project members must be active staff users",
        ));
    }
    if let Some(patient_id) = fields.patient_id {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
                .bind(patient_id)
                .fetch_one(&mut **tx)
                .await
                .unwrap_or(false);
        if !exists {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "patient_id must reference a patient",
            ));
        }
    }
    Ok(())
}

async fn replace_members(
    tx: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
    fields: &ProjectFields,
    actor_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query("DELETE FROM crm_project_members WHERE project_id = $1")
        .bind(project_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update project members",
            )
        })?;
    for member_id in &fields.member_ids {
        sqlx::query(
            "INSERT INTO crm_project_members (project_id, user_id, member_role, added_by) VALUES ($1, $2, $3, $4)",
        )
        .bind(project_id)
        .bind(member_id)
        .bind(if *member_id == fields.owner_id { "manager" } else { "member" })
        .bind(actor_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update project members"))?;
    }
    Ok(())
}

async fn load_project(
    state: &AppState,
    auth: &AuthUser,
    project_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let sql = format!(
        "{PROJECT_SELECT}
         WHERE project.id = $1 AND project.archived_at IS NULL
           AND ($2::boolean OR project.owner_id = $3 OR EXISTS (
             SELECT 1 FROM crm_project_members access_member
             WHERE access_member.project_id = project.id AND access_member.user_id = $3
           ) OR EXISTS (
             SELECT 1 FROM tasks access_task
             WHERE access_task.project_id = project.id AND access_task.assigned_to = $3 AND access_task.deleted_at IS NULL
           ))
         GROUP BY project.id, owner.name, patient.first_name, patient.last_name, creator.name"
    );
    let row = sqlx::query(&sql)
        .bind(project_id)
        .bind(matches!(auth.role, Role::Ceo))
        .bind(auth.user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, project_id = %project_id, "load CRM project");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load project")
        })?;
    let Some(row) = row else {
        return Ok(None);
    };
    let mut value = project_summary_json(&row)
        .ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load project"))?;
    let members = sqlx::query(
        r#"SELECT member.user_id, user_row.name, user_row.role, member.member_role
           FROM crm_project_members member JOIN users user_row ON user_row.id = member.user_id
           WHERE member.project_id = $1 ORDER BY (member.member_role = 'manager') DESC, user_row.name"#,
    )
    .bind(project_id).fetch_all(&state.db).await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load project members"))?;
    value["members"] = serde_json::Value::Array(
        members
            .iter()
            .filter_map(|member| {
                Some(serde_json::json!({
                    "id": member.try_get::<Uuid, _>("user_id").ok()?,
                    "name": member.try_get::<String, _>("name").ok()?,
                    "role": member.try_get::<String, _>("role").ok()?,
                    "member_role": member.try_get::<String, _>("member_role").ok()?,
                }))
            })
            .collect(),
    );
    Ok(Some(value))
}

fn project_summary_json(row: &sqlx::postgres::PgRow) -> Option<serde_json::Value> {
    Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").ok()?,
        "name": row.try_get::<String, _>("name").ok()?,
        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").ok()?,
        "priority": row.try_get::<String, _>("priority").ok()?,
        "owner_id": row.try_get::<Uuid, _>("owner_id").ok()?,
        "owner_name": row.try_get::<String, _>("owner_name").unwrap_or_default(),
        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
        "patient_name": row.try_get::<Option<String>, _>("patient_name").unwrap_or_default(),
        "starts_on": row.try_get::<Option<NaiveDate>, _>("starts_on").unwrap_or_default().map(|v| v.to_string()),
        "due_on": row.try_get::<Option<NaiveDate>, _>("due_on").unwrap_or_default().map(|v| v.to_string()),
        "created_by": row.try_get::<Uuid, _>("created_by").ok()?,
        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").ok()?.to_rfc3339(),
        "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").ok()?.to_rfc3339(),
        "task_total": row.try_get::<i64, _>("task_total").unwrap_or_default(),
        "task_completed": row.try_get::<i64, _>("task_completed").unwrap_or_default(),
        "member_count": row.try_get::<i64, _>("member_count").unwrap_or_default(),
    }))
}

async fn has_project_access(state: &AppState, auth: &AuthUser, project_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1
               FROM crm_projects project
              WHERE project.id = $1
                AND project.archived_at IS NULL
                AND ($2::boolean OR project.owner_id = $3 OR EXISTS (
                    SELECT 1
                      FROM crm_project_members member
                     WHERE member.project_id = project.id
                       AND member.user_id = $3
                ) OR EXISTS (
                    SELECT 1
                      FROM tasks task
                     WHERE task.project_id = project.id
                       AND task.assigned_to = $3
                       AND task.deleted_at IS NULL
                ))
           )"#,
    )
    .bind(project_id)
    .bind(matches!(auth.role, Role::Ceo))
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

async fn can_manage_project(state: &AppState, auth: &AuthUser, project_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1
               FROM crm_projects project
               LEFT JOIN crm_project_members member
                 ON member.project_id = project.id
                AND member.user_id = $2
                AND member.member_role = 'manager'
              WHERE project.id = $1
                AND project.archived_at IS NULL
                AND ($3::boolean OR project.owner_id = $2 OR member.user_id IS NOT NULL)
           )"#,
    )
    .bind(project_id)
    .bind(auth.user_id)
    .bind(matches!(auth.role, Role::Ceo))
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

async fn publish_workflow_event(
    state: &AppState,
    auth: &AuthUser,
    project_id: Uuid,
    event_type: &str,
    payload: serde_json::Value,
) {
    let target_user_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT project.owner_id
             FROM crm_projects project
            WHERE project.id = $1
           UNION
           SELECT member.user_id
             FROM crm_project_members member
            WHERE member.project_id = $1"#,
    )
    .bind(project_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    crate::realtime::publish_event(
        state,
        RealtimeEvent::new(event_type, "crm_project", project_id)
            .actor(Some(auth.user_id))
            .target_users(target_user_ids)
            .roles(&["ceo"])
            .payload(payload),
    )
    .await;
}

fn valid_status(value: &str) -> bool {
    matches!(
        value,
        "planned" | "active" | "on_hold" | "completed" | "cancelled"
    )
}
fn valid_priority(value: &str) -> bool {
    matches!(value, "low" | "normal" | "high" | "urgent")
}

async fn publish_project_event(
    state: &AppState,
    auth: &AuthUser,
    event_type: &str,
    project_id: Uuid,
    fields: &ProjectFields,
    previous_member_ids: &[Uuid],
) {
    let mut target_user_ids = fields.member_ids.clone();
    target_user_ids.extend_from_slice(previous_member_ids);
    target_user_ids.sort_unstable();
    target_user_ids.dedup();
    crate::realtime::publish_event(
        state,
        RealtimeEvent::new(event_type, "crm_project", project_id)
            .actor(Some(auth.user_id))
            .target_users(target_user_ids)
            .roles(&["ceo"])
            .payload(serde_json::json!({
                "status": fields.status,
                "owner_id": fields.owner_id,
                "patient_id": fields.patient_id,
            })),
    )
    .await;
}

#[allow(clippy::result_large_err)]
fn require_project_staff(auth: &AuthUser) -> Result<(), axum::response::Response> {
    if matches!(
        auth.role,
        Role::Ceo
            | Role::CeoAssistant
            | Role::PatientManager
            | Role::TeamleadInterpreter
            | Role::Interpreter
            | Role::Concierge
            | Role::Billing
            | Role::Sales
    ) {
        Ok(())
    } else {
        Err(err(
            StatusCode::FORBIDDEN,
            "Projects are available to operational staff only",
        ))
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ProjectRequest {
        ProjectRequest {
            name: "  Neues Projekt  ".to_owned(),
            description: Some("  Ziel und Ergebnis  ".to_owned()),
            status: Some("active".to_owned()),
            priority: Some("high".to_owned()),
            owner_id: None,
            patient_id: None,
            starts_on: Some("2026-09-01".to_owned()),
            due_on: Some("2026-09-30".to_owned()),
            member_ids: Some(Vec::new()),
            expected_updated_at: None,
        }
    }

    #[test]
    fn validates_and_normalizes_project_fields() {
        let actor_id = Uuid::new_v4();
        let fields = validate_fields(&request(), actor_id).expect("valid project");
        assert_eq!(fields.name, "Neues Projekt");
        assert_eq!(fields.owner_id, actor_id);
        assert_eq!(fields.member_ids, vec![actor_id]);
        assert_eq!(fields.status, "active");
    }

    #[test]
    fn rejects_inverted_project_dates() {
        let mut body = request();
        body.due_on = Some("2026-08-31".to_owned());
        assert!(validate_fields(&body, Uuid::new_v4()).is_err());
    }

    #[test]
    fn rejects_unknown_project_status() {
        let mut body = request();
        body.status = Some("almost_done".to_owned());
        assert!(validate_fields(&body, Uuid::new_v4()).is_err());
    }
}
