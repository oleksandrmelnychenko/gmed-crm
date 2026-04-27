#![allow(clippy::result_large_err)]

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/workflow-checklist",
            get(list_patient_workflow_checklist).post(add_patient_workflow_item),
        )
        .route(
            "/patients/{patient_id}/workflow-checklist/{item_id}/complete",
            post(complete_patient_workflow_item),
        )
        .route(
            "/orders/{order_id}/workflow-checklist",
            get(list_order_workflow_checklist).post(add_order_workflow_item),
        )
        .route(
            "/orders/{order_id}/workflow-checklist/{item_id}/complete",
            post(complete_order_workflow_item),
        )
}

#[derive(Clone, Copy)]
struct WorkflowTemplateItem {
    checklist_key: &'static str,
    item_key: &'static str,
    item_text: &'static str,
    owner_role: &'static str,
    priority: &'static str,
    due_days: i64,
    sort_order: i32,
    phase: Option<&'static str>,
}

const PATIENT_WORKFLOW_TEMPLATE: [WorkflowTemplateItem; 4] = [
    WorkflowTemplateItem {
        checklist_key: "patient_intake",
        item_key: "profile_verification",
        item_text: "Verify contact, insurance and emergency data",
        owner_role: "patient_manager",
        priority: "high",
        due_days: 2,
        sort_order: 1,
        phase: None,
    },
    WorkflowTemplateItem {
        checklist_key: "patient_intake",
        item_key: "compliance_readiness",
        item_text: "Review DSGVO, contract readiness and legal status",
        owner_role: "patient_manager",
        priority: "high",
        due_days: 2,
        sort_order: 2,
        phase: None,
    },
    WorkflowTemplateItem {
        checklist_key: "patient_intake",
        item_key: "document_pack_review",
        item_text: "Audit required patient documents and current upload gaps",
        owner_role: "patient_manager",
        priority: "normal",
        due_days: 3,
        sort_order: 3,
        phase: None,
    },
    WorkflowTemplateItem {
        checklist_key: "patient_intake",
        item_key: "language_support_needs",
        item_text: "Confirm language, travel and concierge support needs",
        owner_role: "concierge",
        priority: "normal",
        due_days: 4,
        sort_order: 4,
        phase: None,
    },
];

const ORDER_WORKFLOW_TEMPLATE: [WorkflowTemplateItem; 10] = [
    WorkflowTemplateItem {
        checklist_key: "order_discovery",
        item_key: "scope_review",
        item_text: "Review order scope and convert needs into service blocks",
        owner_role: "patient_manager",
        priority: "high",
        due_days: 2,
        sort_order: 1,
        phase: Some("discovery"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_discovery",
        item_key: "provider_shortlist",
        item_text: "Prepare provider and doctor shortlist for execution",
        owner_role: "patient_manager",
        priority: "normal",
        due_days: 3,
        sort_order: 2,
        phase: Some("discovery"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_intake",
        item_key: "intake_prerequisites",
        item_text: "Confirm intake prerequisites and appointment dependencies",
        owner_role: "patient_manager",
        priority: "high",
        due_days: 2,
        sort_order: 1,
        phase: Some("intake"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_intake",
        item_key: "supporting_documents",
        item_text: "Check supporting documents for linked clinics or doctors",
        owner_role: "patient_manager",
        priority: "normal",
        due_days: 3,
        sort_order: 2,
        phase: Some("intake"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_execution",
        item_key: "leistungen_tracking",
        item_text: "Track delivered Leistungen and pending approvals",
        owner_role: "patient_manager",
        priority: "high",
        due_days: 5,
        sort_order: 1,
        phase: Some("execution"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_execution",
        item_key: "concierge_handoff",
        item_text: "Coordinate travel, accommodation or external support handoff",
        owner_role: "concierge",
        priority: "normal",
        due_days: 5,
        sort_order: 2,
        phase: Some("execution"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_closure",
        item_key: "closure_readiness",
        item_text: "Validate order closure and billing handoff readiness",
        owner_role: "patient_manager",
        priority: "high",
        due_days: 3,
        sort_order: 1,
        phase: Some("closure"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_closure",
        item_key: "closure_notes",
        item_text: "Capture medical and operational closure notes",
        owner_role: "patient_manager",
        priority: "normal",
        due_days: 4,
        sort_order: 2,
        phase: Some("closure"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_followup",
        item_key: "followup_plan",
        item_text: "Plan follow-up visits and post-treatment outreach",
        owner_role: "patient_manager",
        priority: "high",
        due_days: 7,
        sort_order: 1,
        phase: Some("followup"),
    },
    WorkflowTemplateItem {
        checklist_key: "order_followup",
        item_key: "final_release",
        item_text: "Confirm final document release and patient communication",
        owner_role: "patient_manager",
        priority: "normal",
        due_days: 7,
        sort_order: 2,
        phase: Some("followup"),
    },
];

#[derive(Deserialize)]
struct AddWorkflowChecklistItemRequest {
    item_text: String,
    owner_user_id: Option<Uuid>,
    priority: Option<String>,
    due_date: Option<String>,
}

#[derive(Clone, Copy)]
enum WorkflowScope {
    Patient,
    Order,
}

impl WorkflowScope {
    fn as_str(self) -> &'static str {
        match self {
            WorkflowScope::Patient => "patient",
            WorkflowScope::Order => "order",
        }
    }
}

struct ScopeContext {
    patient_id: Uuid,
    order_id: Option<Uuid>,
    created_by: Uuid,
    phase: Option<String>,
}

struct WorkflowTaskDraft<'a> {
    item_text: &'a str,
    assigned_to: Uuid,
    assigned_by: Uuid,
    priority: &'a str,
    due_date: Option<chrono::DateTime<Utc>>,
}

pub(crate) async fn ensure_default_patient_workflow(
    state: &AppState,
    patient_id: Uuid,
    fallback_user_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let context = load_patient_scope_context(state, patient_id).await?;
    for item in PATIENT_WORKFLOW_TEMPLATE {
        ensure_template_item(
            state,
            WorkflowScope::Patient,
            patient_id,
            &context,
            item,
            fallback_user_id,
        )
        .await?;
    }
    Ok(())
}

pub(crate) async fn ensure_default_order_workflow(
    state: &AppState,
    order_id: Uuid,
    fallback_user_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let context = load_order_scope_context(state, order_id).await?;
    for item in ORDER_WORKFLOW_TEMPLATE {
        let Some(phase) = item.phase else {
            continue;
        };
        if order_phase_rank(phase)
            > order_phase_rank(context.phase.as_deref().unwrap_or("discovery"))
        {
            continue;
        }
        ensure_template_item(
            state,
            WorkflowScope::Order,
            order_id,
            &context,
            item,
            fallback_user_id,
        )
        .await?;
    }
    Ok(())
}

async fn list_patient_workflow_checklist(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_view_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, patient_id).await {
        return resp;
    }
    if let Err(resp) = ensure_default_patient_workflow(&state, patient_id, Some(auth.user_id)).await
    {
        return resp;
    }
    list_workflow_scope(&state, WorkflowScope::Patient, patient_id).await
}

async fn add_patient_workflow_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<AddWorkflowChecklistItemRequest>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_manage_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, patient_id).await {
        return resp;
    }
    let context = match load_patient_scope_context(&state, patient_id).await {
        Ok(context) => context,
        Err(resp) => return resp,
    };
    create_custom_workflow_item(
        &state,
        &auth,
        WorkflowScope::Patient,
        patient_id,
        context,
        body,
    )
    .await
}

async fn complete_patient_workflow_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, item_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_view_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, patient_id).await {
        return resp;
    }
    complete_workflow_item(&state, &auth, WorkflowScope::Patient, patient_id, item_id).await
}

async fn list_order_workflow_checklist(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_view_role(&auth) {
        return resp;
    }
    let context = match load_order_scope_context(&state, order_id).await {
        Ok(context) => context,
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, context.patient_id).await {
        return resp;
    }
    if let Err(resp) = ensure_default_order_workflow(&state, order_id, Some(auth.user_id)).await {
        return resp;
    }
    list_workflow_scope(&state, WorkflowScope::Order, order_id).await
}

async fn add_order_workflow_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<AddWorkflowChecklistItemRequest>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_manage_role(&auth) {
        return resp;
    }
    let context = match load_order_scope_context(&state, order_id).await {
        Ok(context) => context,
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, context.patient_id).await {
        return resp;
    }
    create_custom_workflow_item(&state, &auth, WorkflowScope::Order, order_id, context, body).await
}

async fn complete_order_workflow_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, item_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_view_role(&auth) {
        return resp;
    }
    let context = match load_order_scope_context(&state, order_id).await {
        Ok(context) => context,
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, context.patient_id).await {
        return resp;
    }
    complete_workflow_item(&state, &auth, WorkflowScope::Order, order_id, item_id).await
}

fn require_workflow_view_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])
}

fn require_workflow_manage_role(auth: &AuthUser) -> Result<(), axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Concierge])
}

async fn ensure_patient_scope_visible(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }
    if !access::requires_patient_assignment(auth.role) {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate workflow patient assignment");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate workflow access",
            )
        })?;

    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn load_patient_scope_context(
    state: &AppState,
    patient_id: Uuid,
) -> Result<ScopeContext, axum::response::Response> {
    let row = sqlx::query("SELECT created_by FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to load patient workflow context");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load workflow context",
            )
        })?;
    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    };

    let created_by: Uuid = row.try_get("created_by").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to decode workflow context",
        )
    })?;

    Ok(ScopeContext {
        patient_id,
        order_id: None,
        created_by,
        phase: None,
    })
}

async fn load_order_scope_context(
    state: &AppState,
    order_id: Uuid,
) -> Result<ScopeContext, axum::response::Response> {
    let row = sqlx::query("SELECT patient_id, created_by, phase FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, order_id = %order_id, "Failed to load order workflow context");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load workflow context",
            )
        })?;
    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "Order not found"));
    };

    Ok(ScopeContext {
        patient_id: row.try_get("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode workflow context",
            )
        })?,
        order_id: Some(order_id),
        created_by: row.try_get("created_by").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode workflow context",
            )
        })?,
        phase: Some(row.try_get::<String, _>("phase").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode workflow context",
            )
        })?),
    })
}

fn order_phase_rank(phase: &str) -> i32 {
    match phase {
        "discovery" => 1,
        "intake" => 2,
        "execution" => 3,
        "closure" => 4,
        "followup" => 5,
        _ => 0,
    }
}

async fn ensure_template_item(
    state: &AppState,
    scope: WorkflowScope,
    scope_id: Uuid,
    context: &ScopeContext,
    template: WorkflowTemplateItem,
    fallback_user_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let preferred_owner = fallback_user_id.or(Some(context.created_by));
    let owner_user_id = resolve_default_assignee(
        state,
        context.patient_id,
        template.owner_role,
        preferred_owner,
    )
    .await?;
    let due_date = Utc::now() + Duration::days(template.due_days);

    let row = sqlx::query(
        r#"INSERT INTO workflow_checklist_items (
                scope_type, scope_id, patient_id, order_id, checklist_key, item_key, item_text,
                owner_role, owner_user_id, created_by, priority, due_date, sort_order, metadata
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14::jsonb
           )
           ON CONFLICT (scope_type, scope_id, checklist_key, item_key)
           DO UPDATE SET updated_at = workflow_checklist_items.updated_at
           RETURNING id, linked_task_id, is_completed, owner_user_id"#,
    )
    .bind(scope.as_str())
    .bind(scope_id)
    .bind(context.patient_id)
    .bind(context.order_id)
    .bind(template.checklist_key)
    .bind(template.item_key)
    .bind(template.item_text)
    .bind(template.owner_role)
    .bind(owner_user_id)
    .bind(context.created_by)
    .bind(template.priority)
    .bind(due_date)
    .bind(template.sort_order)
    .bind(json!({
        "template": true,
        "phase": template.phase,
    }))
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, scope = scope.as_str(), scope_id = %scope_id, "Failed to upsert workflow template item");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to seed workflow checklist",
        )
    })?;

    let checklist_item_id: Uuid = row.try_get("id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to seed workflow checklist",
        )
    })?;
    let linked_task_id: Option<Uuid> = row.try_get("linked_task_id").unwrap_or_default();
    let is_completed: bool = row.try_get("is_completed").unwrap_or(false);

    if linked_task_id.is_none() && !is_completed {
        let assignee = row
            .try_get::<Option<Uuid>, _>("owner_user_id")
            .unwrap_or_default()
            .or(owner_user_id)
            .unwrap_or(context.created_by);
        let task_id = insert_workflow_task(
            state,
            scope,
            context,
            WorkflowTaskDraft {
                item_text: template.item_text,
                assigned_to: assignee,
                assigned_by: context.created_by,
                priority: template.priority,
                due_date: Some(due_date),
            },
        )
        .await?;

        sqlx::query("UPDATE workflow_checklist_items SET linked_task_id = $2 WHERE id = $1")
            .bind(checklist_item_id)
            .bind(task_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, checklist_item_id = %checklist_item_id, "Failed to link workflow task");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to seed workflow checklist",
                )
            })?;
    }

    Ok(())
}

async fn create_custom_workflow_item(
    state: &AppState,
    auth: &AuthUser,
    scope: WorkflowScope,
    scope_id: Uuid,
    context: ScopeContext,
    body: AddWorkflowChecklistItemRequest,
) -> axum::response::Response {
    let item_text = body.item_text.trim();
    if item_text.is_empty() || item_text.len() > 255 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Checklist item text is required (max 255)",
        );
    }

    let priority = body.priority.unwrap_or_else(|| "normal".to_string());
    if !matches!(priority.as_str(), "low" | "normal" | "high" | "urgent") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid priority");
    }

    let due_date = match body.due_date.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            match chrono::DateTime::parse_from_rfc3339(value) {
                Ok(value) => Some(value.with_timezone(&Utc)),
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

    let owner_user_id = match resolve_requested_assignee(
        state,
        context.patient_id,
        body.owner_user_id,
        auth.user_id,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let owner_role = match owner_user_role(state, owner_user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let checklist_key = match scope {
        WorkflowScope::Patient => "patient_custom",
        WorkflowScope::Order => "order_custom",
    };
    let sort_order = match next_sort_order(state, scope, scope_id, checklist_key).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let item_key = format!("custom-{}", Uuid::new_v4().simple());

    let row = match sqlx::query(
        r#"INSERT INTO workflow_checklist_items (
                scope_type, scope_id, patient_id, order_id, checklist_key, item_key, item_text,
                owner_role, owner_user_id, created_by, priority, due_date, sort_order, metadata
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14::jsonb
           )
           RETURNING id"#,
    )
    .bind(scope.as_str())
    .bind(scope_id)
    .bind(context.patient_id)
    .bind(context.order_id)
    .bind(checklist_key)
    .bind(item_key)
    .bind(item_text)
    .bind(owner_role)
    .bind(owner_user_id)
    .bind(auth.user_id)
    .bind(priority.as_str())
    .bind(due_date)
    .bind(sort_order)
    .bind(json!({
        "custom": true,
    }))
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, scope = scope.as_str(), scope_id = %scope_id, "Failed to create custom workflow item");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create checklist item",
            );
        }
    };

    let checklist_item_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create checklist item",
            );
        }
    };
    let task_id = match insert_workflow_task(
        state,
        scope,
        &context,
        WorkflowTaskDraft {
            item_text,
            assigned_to: owner_user_id,
            assigned_by: auth.user_id,
            priority: &priority,
            due_date,
        },
    )
    .await
    {
        Ok(task_id) => task_id,
        Err(resp) => return resp,
    };

    if let Err(e) =
        sqlx::query("UPDATE workflow_checklist_items SET linked_task_id = $2 WHERE id = $1")
            .bind(checklist_item_id)
            .bind(task_id)
            .execute(&state.db)
            .await
    {
        tracing::error!(error = %e, checklist_item_id = %checklist_item_id, "Failed to link custom workflow task");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create checklist item",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "workflow_checklist_item_created",
        Some(auth.user_id),
        "patient",
        Some(context.patient_id),
        json!({
            "scope_type": scope.as_str(),
            "scope_id": scope_id,
            "order_id": context.order_id,
            "checklist_item_id": checklist_item_id,
            "task_id": task_id,
            "item_text": item_text,
        }),
    ));

    crate::realtime::publish_workflow_checklist_event(
        state,
        Some(auth.user_id),
        "workflow_checklist_item.created",
        checklist_item_id,
        json!({
            "scope_type": scope.as_str(),
            "scope_id": scope_id,
            "order_id": context.order_id,
            "checklist_item_id": checklist_item_id,
            "task_id": task_id,
            "item_text": item_text,
        }),
    )
    .await;
    crate::realtime::publish_task_event(
        state,
        Some(auth.user_id),
        "task.created",
        task_id,
        json!({
            "source": "workflow_checklist",
            "scope_type": scope.as_str(),
            "scope_id": scope_id,
            "order_id": context.order_id,
            "checklist_item_id": checklist_item_id,
            "item_text": item_text,
        }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": checklist_item_id,
            "task_id": task_id,
        })),
    )
        .into_response()
}

async fn complete_workflow_item(
    state: &AppState,
    auth: &AuthUser,
    scope: WorkflowScope,
    scope_id: Uuid,
    item_id: Uuid,
) -> axum::response::Response {
    let row = match sqlx::query(
        r#"SELECT patient_id, order_id, owner_user_id, owner_role, linked_task_id, is_completed, item_text
           FROM workflow_checklist_items
           WHERE id = $1
             AND scope_type = $2
             AND scope_id = $3"#,
    )
    .bind(item_id)
    .bind(scope.as_str())
    .bind(scope_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Checklist item not found"),
        Err(e) => {
            tracing::error!(error = %e, item_id = %item_id, "Failed to load workflow checklist item");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update checklist item",
            );
        }
    };

    let owner_user_id: Option<Uuid> = row.try_get("owner_user_id").unwrap_or_default();
    let owner_role: String = row.try_get("owner_role").unwrap_or_default();
    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update checklist item",
            );
        }
    };
    let order_id: Option<Uuid> = row.try_get("order_id").unwrap_or_default();
    let is_completed: bool = row.try_get("is_completed").unwrap_or(false);

    if !can_complete_workflow_item(auth, owner_user_id, owner_role.as_str()) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    if !is_completed
        && let Err(e) = sqlx::query(
            r#"UPDATE workflow_checklist_items
               SET is_completed = true, completed_by = $2, completed_at = now(), updated_at = now()
               WHERE id = $1"#,
        )
        .bind(item_id)
        .bind(auth.user_id)
        .execute(&state.db)
        .await
    {
        tracing::error!(error = %e, item_id = %item_id, "Failed to complete workflow checklist item");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update checklist item",
        );
    }

    let linked_task_id: Option<Uuid> = row.try_get("linked_task_id").unwrap_or_default();
    if let Some(linked_task_id) = linked_task_id {
        let _ = sqlx::query(
            r#"UPDATE tasks
               SET status = 'completed',
                   completed_at = COALESCE(completed_at, now()),
                   updated_at = now()
               WHERE id = $1
                 AND status != 'completed'"#,
        )
        .bind(linked_task_id)
        .execute(&state.db)
        .await;
    }

    state.audit_sender.try_send(audit::domain_event(
        "workflow_checklist_item_completed",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "scope_type": scope.as_str(),
            "scope_id": scope_id,
            "order_id": order_id,
            "checklist_item_id": item_id,
            "task_id": linked_task_id,
            "item_text": row.try_get::<String, _>("item_text").unwrap_or_default(),
        }),
    ));

    crate::realtime::publish_workflow_checklist_event(
        state,
        Some(auth.user_id),
        "workflow_checklist_item.completed",
        item_id,
        json!({
            "scope_type": scope.as_str(),
            "scope_id": scope_id,
            "order_id": order_id,
            "checklist_item_id": item_id,
            "task_id": linked_task_id,
            "item_text": row.try_get::<String, _>("item_text").unwrap_or_default(),
        }),
    )
    .await;
    if let Some(linked_task_id) = linked_task_id {
        crate::realtime::publish_task_event(
            state,
            Some(auth.user_id),
            "task.status_changed",
            linked_task_id,
            json!({
                "status": "completed",
                "source": "workflow_checklist",
                "scope_type": scope.as_str(),
                "scope_id": scope_id,
                "order_id": order_id,
                "checklist_item_id": item_id,
            }),
        )
        .await;
    }

    Json(json!({ "ok": true })).into_response()
}

async fn list_workflow_scope(
    state: &AppState,
    scope: WorkflowScope,
    scope_id: Uuid,
) -> axum::response::Response {
    let rows = match sqlx::query(
        r#"SELECT w.id, w.checklist_key, w.item_key, w.item_text, w.owner_role, w.owner_user_id,
                  owner.name AS owner_name, owner.role AS owner_user_role,
                  w.priority, w.due_date, w.linked_task_id, t.status AS linked_task_status,
                  w.is_completed, w.completed_at, w.sort_order, w.metadata, w.created_at
           FROM workflow_checklist_items w
           LEFT JOIN users owner ON owner.id = w.owner_user_id
           LEFT JOIN tasks t ON t.id = w.linked_task_id
           WHERE w.scope_type = $1
             AND w.scope_id = $2
           ORDER BY
             CASE w.checklist_key
               WHEN 'patient_intake' THEN 1
               WHEN 'patient_custom' THEN 2
               WHEN 'order_discovery' THEN 10
               WHEN 'order_intake' THEN 20
               WHEN 'order_execution' THEN 30
               WHEN 'order_closure' THEN 40
               WHEN 'order_followup' THEN 50
               WHEN 'order_custom' THEN 60
               ELSE 99
             END,
             w.sort_order,
             w.created_at"#,
    )
    .bind(scope.as_str())
    .bind(scope_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, scope = scope.as_str(), scope_id = %scope_id, "Failed to list workflow checklist");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load workflow checklist",
            );
        }
    };

    let open_count = rows
        .iter()
        .filter(|row| !row.try_get::<bool, _>("is_completed").unwrap_or(false))
        .count();
    let completed_count = rows.len().saturating_sub(open_count);
    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "checklist_key": row.try_get::<String, _>("checklist_key").unwrap_or_default(),
                "item_key": row.try_get::<String, _>("item_key").unwrap_or_default(),
                "item_text": row.try_get::<String, _>("item_text").unwrap_or_default(),
                "owner_role": row.try_get::<String, _>("owner_role").unwrap_or_default(),
                "owner_user_id": row.try_get::<Option<Uuid>, _>("owner_user_id").unwrap_or_default(),
                "owner_name": row.try_get::<Option<String>, _>("owner_name").unwrap_or_default(),
                "owner_user_role": row.try_get::<Option<String>, _>("owner_user_role").unwrap_or_default(),
                "priority": row.try_get::<String, _>("priority").unwrap_or_else(|_| "normal".to_string()),
                "due_date": row.try_get::<Option<chrono::DateTime<Utc>>, _>("due_date").unwrap_or_default().map(|value| value.to_rfc3339()),
                "linked_task_id": row.try_get::<Option<Uuid>, _>("linked_task_id").unwrap_or_default(),
                "linked_task_status": row.try_get::<Option<String>, _>("linked_task_status").unwrap_or_default(),
                "is_completed": row.try_get::<bool, _>("is_completed").unwrap_or(false),
                "completed_at": row.try_get::<Option<chrono::DateTime<Utc>>, _>("completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or_default(),
                "metadata": row.try_get::<Value, _>("metadata").unwrap_or_else(|_| json!({})),
                "created_at": row.try_get::<chrono::DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Json(json!({
        "scope_type": scope.as_str(),
        "scope_id": scope_id,
        "open_count": open_count,
        "completed_count": completed_count,
        "items": items,
    }))
    .into_response()
}

async fn resolve_default_assignee(
    state: &AppState,
    patient_id: Uuid,
    owner_role: &str,
    fallback_user_id: Option<Uuid>,
) -> Result<Option<Uuid>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT pa.user_id
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = $2
           ORDER BY pa.assigned_at
           LIMIT 1"#,
    )
    .bind(patient_id)
    .bind(owner_role)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, owner_role = owner_role, "Failed to resolve workflow assignee");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to resolve workflow assignee",
        )
    })?;

    if let Some(row) = row {
        let user_id: Uuid = row.try_get("user_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to resolve workflow assignee",
            )
        })?;
        return Ok(Some(user_id));
    }

    Ok(fallback_user_id)
}

async fn resolve_requested_assignee(
    state: &AppState,
    patient_id: Uuid,
    requested_user_id: Option<Uuid>,
    fallback_user_id: Uuid,
) -> Result<Uuid, axum::response::Response> {
    let Some(requested_user_id) = requested_user_id else {
        return Ok(fallback_user_id);
    };

    let row = sqlx::query(
        r#"SELECT pa.user_id
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.user_id = $2
             AND pa.revoked_at IS NULL
             AND u.is_active = true"#,
    )
    .bind(patient_id)
    .bind(requested_user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, requested_user_id = %requested_user_id, "Failed to validate workflow assignee");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate workflow assignee",
        )
    })?;

    if row.is_some() {
        Ok(requested_user_id)
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Workflow assignee must be actively linked to the patient",
        ))
    }
}

async fn owner_user_role(
    state: &AppState,
    user_id: Uuid,
) -> Result<String, axum::response::Response> {
    let row = sqlx::query("SELECT role FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %user_id, "Failed to resolve workflow owner role");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to resolve workflow assignee",
            )
        })?;

    Ok(row
        .and_then(|row| row.try_get::<String, _>("role").ok())
        .unwrap_or_else(|| "patient_manager".to_string()))
}

async fn next_sort_order(
    state: &AppState,
    scope: WorkflowScope,
    scope_id: Uuid,
    checklist_key: &str,
) -> Result<i32, axum::response::Response> {
    let value = sqlx::query_scalar::<_, Option<i32>>(
        r#"SELECT MAX(sort_order)
           FROM workflow_checklist_items
           WHERE scope_type = $1
             AND scope_id = $2
             AND checklist_key = $3"#,
    )
    .bind(scope.as_str())
    .bind(scope_id)
    .bind(checklist_key)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, scope = scope.as_str(), scope_id = %scope_id, "Failed to load next workflow sort order");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create checklist item",
        )
    })?;

    Ok(value.unwrap_or(0) + 1)
}

async fn insert_workflow_task(
    state: &AppState,
    scope: WorkflowScope,
    context: &ScopeContext,
    draft: WorkflowTaskDraft<'_>,
) -> Result<Uuid, axum::response::Response> {
    let title = match scope {
        WorkflowScope::Patient => format!("Patient checklist: {}", draft.item_text),
        WorkflowScope::Order => format!("Order checklist: {}", draft.item_text),
    };
    let description = match scope {
        WorkflowScope::Patient => {
            Some("Auto-generated from patient workflow checklist".to_string())
        }
        WorkflowScope::Order => Some("Auto-generated from order workflow checklist".to_string()),
    };

    sqlx::query_scalar(
        r#"INSERT INTO tasks (
                title, description, assigned_to, assigned_by, patient_id, order_id, due_date, priority
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
           ) RETURNING id"#,
    )
    .bind(title)
    .bind(description)
    .bind(draft.assigned_to)
    .bind(draft.assigned_by)
    .bind(context.patient_id)
    .bind(context.order_id)
    .bind(draft.due_date)
    .bind(draft.priority)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %context.patient_id, order_id = ?context.order_id, "Failed to create linked workflow task");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create linked workflow task",
        )
    })
}

fn can_complete_workflow_item(
    auth: &AuthUser,
    owner_user_id: Option<Uuid>,
    owner_role: &str,
) -> bool {
    if auth.role == Role::Ceo {
        return true;
    }
    if owner_user_id == Some(auth.user_id) {
        return true;
    }
    if auth.role == Role::PatientManager {
        return true;
    }
    auth.role == Role::Concierge && owner_role == "concierge"
}

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
