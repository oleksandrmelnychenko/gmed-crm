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
            "/patients/{patient_id}/workflow-checklist/{item_id}/not-required",
            post(mark_patient_workflow_item_not_required),
        )
        .route(
            "/patients/{patient_id}/workflow-checklist/{item_id}/reopen",
            post(reopen_patient_workflow_item),
        )
        .route(
            "/orders/{order_id}/workflow-checklist",
            get(list_order_workflow_checklist).post(add_order_workflow_item),
        )
        .route(
            "/orders/{order_id}/workflow-checklist/{item_id}/complete",
            post(complete_order_workflow_item),
        )
        .route(
            "/orders/{order_id}/workflow-checklist/{item_id}/not-required",
            post(mark_order_workflow_item_not_required),
        )
        .route(
            "/orders/{order_id}/workflow-checklist/{item_id}/reopen",
            post(reopen_order_workflow_item),
        )
}

/// Why a checklist item was resolved as "not required" instead of completed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NotRequiredReason {
    /// Marked on the order or patient page.
    Manual,
    /// The order moved past the item's stage while it was still open.
    PhasePassed,
    /// Its linked task was cancelled in the work center.
    TaskCancelled,
    /// The order was cancelled while the item was still open.
    OrderCancelled,
}

impl NotRequiredReason {
    fn as_str(self) -> &'static str {
        match self {
            NotRequiredReason::Manual => "manual",
            NotRequiredReason::PhasePassed => "phase_passed",
            NotRequiredReason::TaskCancelled => "task_cancelled",
            NotRequiredReason::OrderCancelled => "order_cancelled",
        }
    }
}

/// How a checklist item changed together with its linked task.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChecklistItemChange {
    Completed,
    NotRequired(NotRequiredReason),
    Reopened,
}

impl ChecklistItemChange {
    fn audit_action(self) -> &'static str {
        match self {
            ChecklistItemChange::Completed => "workflow_checklist_item_completed",
            ChecklistItemChange::NotRequired(_) => "workflow_checklist_item_not_required",
            ChecklistItemChange::Reopened => "workflow_checklist_item_reopened",
        }
    }

    fn realtime_event(self) -> &'static str {
        match self {
            ChecklistItemChange::Completed => "workflow_checklist_item.completed",
            ChecklistItemChange::NotRequired(_) | ChecklistItemChange::Reopened => {
                "workflow_checklist_item.updated"
            }
        }
    }
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

pub(crate) async fn ensure_default_order_workflow(
    state: &AppState,
    order_id: Uuid,
    fallback_user_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let preparing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM orders WHERE id=$1 AND intake_state='draft')",
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order preparation",
        )
    })?;
    if preparing {
        return Ok(());
    }
    let context = load_order_scope_context(state, order_id).await?;
    let current_rank = order_phase_rank(context.phase.as_deref().unwrap_or("discovery"));
    for item in ORDER_WORKFLOW_TEMPLATE {
        let Some(phase) = item.phase else {
            continue;
        };
        let rank = order_phase_rank(phase);
        if rank > current_rank {
            continue;
        }
        // Items of stages the order has already passed are created closed as
        // "not required" and without a task, so a first look at an order in a
        // later stage does not open work nobody is meant to do any more.
        ensure_template_item(
            state,
            WorkflowScope::Order,
            order_id,
            &context,
            item,
            fallback_user_id,
            rank < current_rank,
        )
        .await?;
    }
    Ok(())
}

/// Resolves the still-open template items of the stages before `phase` as
/// "not required" and cancels their linked tasks, so a passed stage shows no
/// open work and no longer blocks the order. Custom items are not tied to a
/// stage and stay open. Reopening an item brings it (and its task) back.
pub(crate) async fn resolve_passed_phase_items(
    state: &AppState,
    order_id: Uuid,
    phase: &str,
    actor_id: Uuid,
) -> Result<(), axum::response::Response> {
    let current_rank = order_phase_rank(phase);
    let passed_keys = ORDER_WORKFLOW_TEMPLATE
        .iter()
        .filter(|item| {
            item.phase
                .is_some_and(|item_phase| order_phase_rank(item_phase) < current_rank)
        })
        .map(|item| item.checklist_key.to_string())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if passed_keys.is_empty() {
        return Ok(());
    }
    let failed = |error: sqlx::Error| {
        tracing::error!(error = %error, order_id = %order_id, "resolve passed-stage checklist items");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update the order checklist",
        )
    };
    let mut tx = state.db.begin().await.map_err(failed)?;
    let rows = sqlx::query(
        r#"UPDATE workflow_checklist_items
           SET is_completed = true,
               not_required = true,
               not_required_reason = 'phase_passed',
               completed_by = $3,
               completed_at = now(),
               updated_at = now()
           WHERE scope_type = 'order'
             AND order_id = $1
             AND checklist_key = ANY($2)
             AND metadata @> '{"template": true}'::jsonb
             AND NOT is_completed
           RETURNING id, patient_id, order_id, scope_type, scope_id, item_text, linked_task_id"#,
    )
    .bind(order_id)
    .bind(&passed_keys)
    .bind(actor_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(failed)?;
    let mut changed = Vec::with_capacity(rows.len());
    for row in &rows {
        let item = checklist_sync_from_row(
            row,
            ChecklistItemChange::NotRequired(NotRequiredReason::PhasePassed),
        )
        .map_err(failed)?;
        if let Some(task_id) = item.task_id {
            cancel_linked_task(&mut tx, task_id, actor_id, NotRequiredReason::PhasePassed)
                .await
                .map_err(failed)?;
        }
        changed.push(item);
    }
    tx.commit().await.map_err(failed)?;
    publish_checklist_item_changes(state, actor_id, &changed).await;
    Ok(())
}

/// Resolves every still-open checklist item of a cancelled order as "not
/// required" (reason `order_cancelled`) and cancels their linked tasks with a
/// task history entry, inside the order-cancellation transaction (owner
/// decision 2026-09-28). Returns the changed items; the caller publishes them
/// with [`publish_checklist_item_changes`] after commit.
pub(crate) async fn resolve_items_of_cancelled_order_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    order_id: Uuid,
    actor_id: Uuid,
) -> Result<Vec<ChecklistItemSync>, sqlx::Error> {
    let rows = sqlx::query(
        r#"UPDATE workflow_checklist_items
           SET is_completed = true,
               not_required = true,
               not_required_reason = 'order_cancelled',
               completed_by = $2,
               completed_at = now(),
               updated_at = now()
           WHERE scope_type = 'order'
             AND order_id = $1
             AND NOT is_completed
           RETURNING id, patient_id, order_id, scope_type, scope_id, item_text, linked_task_id"#,
    )
    .bind(order_id)
    .bind(actor_id)
    .fetch_all(&mut **tx)
    .await?;
    let mut changed = Vec::with_capacity(rows.len());
    for row in &rows {
        let item = checklist_sync_from_row(
            row,
            ChecklistItemChange::NotRequired(NotRequiredReason::OrderCancelled),
        )?;
        if let Some(task_id) = item.task_id {
            cancel_linked_task(tx, task_id, actor_id, NotRequiredReason::OrderCancelled).await?;
        }
        changed.push(item);
    }
    Ok(changed)
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
    if let Err(resp) = require_order_workflow_access(&auth) {
        return resp;
    }
    let patient_id = match sqlx::query_scalar::<_, Option<Uuid>>(
        r#"SELECT COALESCE(o.patient_id, l.converted_patient_id)
           FROM orders o
           LEFT JOIN leads l ON l.id = o.source_lead_id
           WHERE o.id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(patient_id)) => patient_id,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(error) => {
            tracing::error!(error = %error, order_id = %order_id, "Failed to load order workflow subject");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load workflow context",
            );
        }
    };
    if patient_id.is_none() {
        return Json(json!({
            "scope_type": WorkflowScope::Order.as_str(),
            "scope_id": order_id,
            "open_count": 0,
            "completed_count": 0,
            "not_required_count": 0,
            "blocked_reason": "patient_required",
            "items": [],
        }))
        .into_response();
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
    if let Err(resp) = require_order_workflow_access(&auth) {
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
    if let Err(resp) = require_order_workflow_access(&auth) {
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

async fn mark_patient_workflow_item_not_required(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, item_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_manage_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, patient_id).await {
        return resp;
    }
    change_workflow_item_resolution(
        &state,
        &auth,
        WorkflowScope::Patient,
        patient_id,
        item_id,
        ResolutionChange::NotRequired,
    )
    .await
}

async fn reopen_patient_workflow_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_id, item_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_manage_role(&auth) {
        return resp;
    }
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, patient_id).await {
        return resp;
    }
    change_workflow_item_resolution(
        &state,
        &auth,
        WorkflowScope::Patient,
        patient_id,
        item_id,
        ResolutionChange::Reopen,
    )
    .await
}

async fn mark_order_workflow_item_not_required(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, item_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    order_workflow_item_resolution(
        state,
        auth,
        order_id,
        item_id,
        ResolutionChange::NotRequired,
    )
    .await
}

async fn reopen_order_workflow_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, item_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    order_workflow_item_resolution(state, auth, order_id, item_id, ResolutionChange::Reopen).await
}

async fn order_workflow_item_resolution(
    state: AppState,
    auth: AuthUser,
    order_id: Uuid,
    item_id: Uuid,
    change: ResolutionChange,
) -> axum::response::Response {
    if let Err(resp) = require_workflow_manage_role(&auth) {
        return resp;
    }
    if let Err(resp) = require_order_workflow_access(&auth) {
        return resp;
    }
    let context = match load_order_scope_context(&state, order_id).await {
        Ok(context) => context,
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_patient_scope_visible(&state, &auth, context.patient_id).await {
        return resp;
    }
    change_workflow_item_resolution(
        &state,
        &auth,
        WorkflowScope::Order,
        order_id,
        item_id,
        change,
    )
    .await
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ResolutionChange {
    NotRequired,
    Reopen,
}

/// Marks an open checklist item "not required" (cancelling its linked task)
/// or reopens a not-required item (reopening a cancelled linked task).
async fn change_workflow_item_resolution(
    state: &AppState,
    auth: &AuthUser,
    scope: WorkflowScope,
    scope_id: Uuid,
    item_id: Uuid,
    change: ResolutionChange,
) -> axum::response::Response {
    let failed = |error: sqlx::Error| {
        tracing::error!(error = %error, item_id = %item_id, "change workflow checklist item resolution");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update checklist item",
        )
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return failed(error),
    };
    let row = match sqlx::query(
        r#"SELECT owner_user_id, owner_role, is_completed, not_required, not_required_reason
           FROM workflow_checklist_items
           WHERE id = $1
             AND scope_type = $2
             AND scope_id = $3
           FOR UPDATE"#,
    )
    .bind(item_id)
    .bind(scope.as_str())
    .bind(scope_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Checklist item not found"),
        Err(error) => return failed(error),
    };
    let owner_user_id: Option<Uuid> = row.try_get("owner_user_id").unwrap_or_default();
    let owner_role: String = row.try_get("owner_role").unwrap_or_default();
    if !can_complete_workflow_item(auth, owner_user_id, owner_role.as_str()) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let is_completed: bool = row.try_get("is_completed").unwrap_or(false);
    let not_required: bool = row.try_get("not_required").unwrap_or(false);

    let updated = match change {
        ResolutionChange::NotRequired => {
            if not_required {
                None
            } else if is_completed {
                return err(
                    StatusCode::CONFLICT,
                    "A completed checklist item cannot be marked as not required",
                );
            } else {
                let row = sqlx::query(
                    r#"UPDATE workflow_checklist_items
                       SET is_completed = true,
                           not_required = true,
                           not_required_reason = 'manual',
                           completed_by = $2,
                           completed_at = now(),
                           updated_at = now()
                       WHERE id = $1
                       RETURNING id, patient_id, order_id, scope_type, scope_id, item_text, linked_task_id"#,
                )
                .bind(item_id)
                .bind(auth.user_id)
                .fetch_one(&mut *tx)
                .await;
                let row = match row {
                    Ok(row) => row,
                    Err(error) => return failed(error),
                };
                let item = match checklist_sync_from_row(
                    &row,
                    ChecklistItemChange::NotRequired(NotRequiredReason::Manual),
                ) {
                    Ok(item) => item,
                    Err(error) => return failed(error),
                };
                if let Some(task_id) = item.task_id
                    && let Err(error) = cancel_linked_task(
                        &mut tx,
                        task_id,
                        auth.user_id,
                        NotRequiredReason::Manual,
                    )
                    .await
                {
                    return failed(error);
                }
                Some(item)
            }
        }
        ResolutionChange::Reopen => {
            let reason: Option<String> = row.try_get("not_required_reason").unwrap_or_default();
            if !is_completed {
                None
            } else if reason.as_deref() == Some("order_cancelled") {
                return err(
                    StatusCode::CONFLICT,
                    "A checklist item of a cancelled order cannot be reopened",
                );
            } else if !not_required {
                return err(
                    StatusCode::CONFLICT,
                    "Only a checklist item marked as not required can be reopened",
                );
            } else {
                let row = sqlx::query(
                    r#"UPDATE workflow_checklist_items
                       SET is_completed = false,
                           not_required = false,
                           not_required_reason = NULL,
                           completed_by = NULL,
                           completed_at = NULL,
                           updated_at = now()
                       WHERE id = $1
                       RETURNING id, patient_id, order_id, scope_type, scope_id, item_text, linked_task_id"#,
                )
                .bind(item_id)
                .fetch_one(&mut *tx)
                .await;
                let row = match row {
                    Ok(row) => row,
                    Err(error) => return failed(error),
                };
                let item = match checklist_sync_from_row(&row, ChecklistItemChange::Reopened) {
                    Ok(item) => item,
                    Err(error) => return failed(error),
                };
                if let Some(task_id) = item.task_id
                    && let Err(error) = reopen_linked_task(&mut tx, task_id, auth.user_id).await
                {
                    return failed(error);
                }
                Some(item)
            }
        }
    };
    if let Err(error) = tx.commit().await {
        return failed(error);
    }
    if let Some(item) = updated {
        publish_checklist_item_changes(state, auth.user_id, std::slice::from_ref(&item)).await;
    }
    Json(json!({ "ok": true })).into_response()
}

/// Cancels the open task behind a checklist item that is no longer required
/// and records why in the task history. Deleted and finished tasks are left
/// alone.
async fn cancel_linked_task(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    task_id: Uuid,
    actor_id: Uuid,
    reason: NotRequiredReason,
) -> Result<(), sqlx::Error> {
    let previous_status: Option<String> = sqlx::query_scalar(
        r#"WITH previous AS (
               SELECT id, status FROM tasks
               WHERE id = $1
                 AND deleted_at IS NULL
                 AND status NOT IN ('completed', 'cancelled')
               FOR UPDATE
           )
           UPDATE tasks task
           SET status = 'cancelled', completed_at = NULL, updated_at = now()
           FROM previous
           WHERE task.id = previous.id
           RETURNING previous.status"#,
    )
    .bind(task_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(previous_status) = previous_status {
        sqlx::query(
            r#"INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
               VALUES ($1, 'status_changed', $2, $3)"#,
        )
        .bind(task_id)
        .bind(actor_id)
        .bind(json!({
            "status": "cancelled",
            "previous_status": previous_status,
            "reason": "checklist_item_not_required",
            "not_required_reason": reason.as_str(),
        }))
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Reopens the cancelled task of a checklist item that is required again.
async fn reopen_linked_task(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    task_id: Uuid,
    actor_id: Uuid,
) -> Result<(), sqlx::Error> {
    // An archived cancelled task leaves the archive: open work must be visible.
    let was_archived: Option<bool> = sqlx::query_scalar(
        r#"WITH previous AS (
               SELECT id, archived_at IS NOT NULL AS was_archived FROM tasks
               WHERE id = $1
                 AND deleted_at IS NULL
                 AND status = 'cancelled'
               FOR UPDATE
           )
           UPDATE tasks task
           SET status = 'open', completed_at = NULL, archived_at = NULL, archived_by = NULL,
               updated_at = now()
           FROM previous
           WHERE task.id = previous.id
           RETURNING previous.was_archived"#,
    )
    .bind(task_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(was_archived) = was_archived {
        sqlx::query(
            r#"INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
               VALUES ($1, 'status_changed', $2, $3)"#,
        )
        .bind(task_id)
        .bind(actor_id)
        .bind(json!({
            "status": "open",
            "previous_status": "cancelled",
            "reason": "checklist_item_reopened",
            "restored_from_archive": was_archived,
        }))
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
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

/// The order checklist is the order pipeline. The concierge and the
/// interpreter team lead read only their projection of an order, and roles
/// without `orders.view` read no order at all, so every order checklist read
/// and write answers 403 for them (RBAC matrix, `/orders`). A concierge still
/// closes its order work through the linked task.
fn require_order_workflow_access(auth: &AuthUser) -> Result<(), axum::response::Response> {
    if crate::routes::orders::reads_full_orders(auth) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
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
    let row = sqlx::query(
        r#"SELECT COALESCE(o.patient_id, l.converted_patient_id) AS patient_id,
                  o.created_by, o.phase
           FROM orders o
           LEFT JOIN leads l ON l.id = o.source_lead_id
           WHERE o.id = $1"#,
    )
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
    let patient_id = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode workflow context",
            )
        })?
        .ok_or_else(|| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order must be linked to a patient before using its workflow checklist",
            )
        })?;

    Ok(ScopeContext {
        patient_id,
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

#[allow(clippy::too_many_arguments)]
async fn ensure_template_item(
    state: &AppState,
    scope: WorkflowScope,
    scope_id: Uuid,
    context: &ScopeContext,
    template: WorkflowTemplateItem,
    fallback_user_id: Option<Uuid>,
    stage_passed: bool,
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
                owner_role, owner_user_id, created_by, priority, due_date, sort_order, metadata,
                is_completed, not_required, not_required_reason, completed_at
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14::jsonb,
                $15, $15, CASE WHEN $15 THEN 'phase_passed' END, CASE WHEN $15 THEN now() END
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
    .bind(stage_passed)
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
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, item_id = %item_id, "Failed to begin checklist completion");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update checklist item",
            );
        }
    };
    let row = match sqlx::query(
        r#"SELECT patient_id, order_id, owner_user_id, owner_role, linked_task_id, is_completed,
                  not_required, item_text
           FROM workflow_checklist_items
           WHERE id = $1
             AND scope_type = $2
             AND scope_id = $3
           FOR UPDATE"#,
    )
    .bind(item_id)
    .bind(scope.as_str())
    .bind(scope_id)
    .fetch_optional(&mut *tx)
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
    // A "not required" item is closed already; completing it would also
    // complete its cancelled task. It is reopened first.
    if row.try_get::<bool, _>("not_required").unwrap_or(false) {
        return err(
            StatusCode::CONFLICT,
            "The checklist item is marked as not required; reopen it first",
        );
    }
    if is_completed {
        return Json(json!({ "ok": true })).into_response();
    }

    if let Err(e) = sqlx::query(
        r#"UPDATE workflow_checklist_items
           SET is_completed = true, completed_by = $2, completed_at = now(), updated_at = now()
           WHERE id = $1"#,
    )
    .bind(item_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, item_id = %item_id, "Failed to complete workflow checklist item");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update checklist item",
        );
    }

    // The linked task follows in the same transaction, with a history entry
    // and a notice to its author like any work-center status change. A
    // cancelled or archived task stays as it is.
    let linked_task_id: Option<Uuid> = row.try_get("linked_task_id").unwrap_or_default();
    let mut completed_task: Option<(Uuid, Option<Uuid>)> = None;
    if let Some(linked_task_id) = linked_task_id {
        let task = match sqlx::query_as::<_, (String, Uuid, Uuid, String)>(
            r#"SELECT status, assigned_to, assigned_by, title
               FROM tasks
               WHERE id = $1
                 AND deleted_at IS NULL
                 AND archived_at IS NULL
               FOR UPDATE"#,
        )
        .bind(linked_task_id)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, item_id = %item_id, task_id = %linked_task_id, "Failed to lock checklist task");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update checklist item",
                );
            }
        };
        if let Some((previous_status, assigned_to, assigned_by, title)) = task
            && !matches!(previous_status.as_str(), "completed" | "cancelled")
        {
            let failed = |e: sqlx::Error| {
                tracing::error!(error = %e, item_id = %item_id, task_id = %linked_task_id, "Failed to complete checklist task");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update checklist item",
                )
            };
            if let Err(e) = sqlx::query(
                r#"UPDATE tasks
                   SET status = 'completed',
                       completed_at = COALESCE(completed_at, now()),
                       updated_at = now()
                   WHERE id = $1"#,
            )
            .bind(linked_task_id)
            .execute(&mut *tx)
            .await
            {
                return failed(e);
            }
            if let Err(e) = sqlx::query(
                r#"INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
                   VALUES ($1, 'status_changed', $2, $3)"#,
            )
            .bind(linked_task_id)
            .bind(auth.user_id)
            .bind(json!({
                "assigned_to": assigned_to,
                "status": "completed",
                "previous_status": previous_status,
                "reason": "checklist_item_completed",
                "checklist_item_id": item_id,
            }))
            .execute(&mut *tx)
            .await
            {
                return failed(e);
            }
            let notification_id = if assigned_by != auth.user_id {
                match sqlx::query_scalar::<_, Uuid>(
                    r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                       VALUES ($1, 'operational_task_updated', 'Task status changed', $2, 'concierge_task', $3)
                       RETURNING id"#,
                )
                .bind(assigned_by)
                .bind(&title)
                .bind(linked_task_id)
                .fetch_one(&mut *tx)
                .await
                {
                    Ok(id) => Some(id),
                    Err(e) => return failed(e),
                }
            } else {
                None
            };
            completed_task = Some((assigned_by, notification_id));
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, item_id = %item_id, "Failed to commit checklist completion");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update checklist item",
        );
    }
    if let (Some(task_id), Some((author_id, Some(notification_id)))) =
        (linked_task_id, completed_task)
    {
        crate::realtime::publish_notification_event(
            state,
            author_id,
            "notification.created",
            Some(notification_id),
            json!({ "entity_type": "concierge_task", "entity_id": task_id }),
        )
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
    if let (Some(linked_task_id), Some(_)) = (linked_task_id, completed_task) {
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
                  (t.deleted_at IS NOT NULL) AS linked_task_deleted,
                  w.is_completed, w.not_required, w.not_required_reason, w.completed_at,
                  completer.name AS completed_by_name,
                  w.sort_order, w.metadata, w.created_at
           FROM workflow_checklist_items w
           LEFT JOIN users owner ON owner.id = w.owner_user_id
           LEFT JOIN users completer ON completer.id = w.completed_by
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
    let not_required_count = rows
        .iter()
        .filter(|row| row.try_get::<bool, _>("not_required").unwrap_or(false))
        .count();
    let completed_count = rows
        .len()
        .saturating_sub(open_count)
        .saturating_sub(not_required_count);
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
                "linked_task_deleted": row.try_get::<Option<bool>, _>("linked_task_deleted").unwrap_or_default().unwrap_or(false),
                "is_completed": row.try_get::<bool, _>("is_completed").unwrap_or(false),
                "not_required": row.try_get::<bool, _>("not_required").unwrap_or(false),
                "not_required_reason": row.try_get::<Option<String>, _>("not_required_reason").unwrap_or_default(),
                "completed_at": row.try_get::<Option<chrono::DateTime<Utc>>, _>("completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "completed_by_name": row.try_get::<Option<String>, _>("completed_by_name").unwrap_or_default(),
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
        "not_required_count": not_required_count,
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

/// A workflow checklist item that changed together with its linked task.
pub(crate) struct ChecklistItemSync {
    id: Uuid,
    patient_id: Uuid,
    order_id: Option<Uuid>,
    scope_type: String,
    scope_id: Uuid,
    item_text: String,
    task_id: Option<Uuid>,
    change: ChecklistItemChange,
}

/// A workflow checklist item closed because its linked task was completed.
pub(crate) type TaskCompletedChecklistItem = ChecklistItemSync;

fn checklist_sync_from_row(
    row: &sqlx::postgres::PgRow,
    change: ChecklistItemChange,
) -> Result<ChecklistItemSync, sqlx::Error> {
    Ok(ChecklistItemSync {
        id: row.try_get("id")?,
        patient_id: row.try_get("patient_id")?,
        order_id: row.try_get("order_id")?,
        scope_type: row.try_get("scope_type")?,
        scope_id: row.try_get("scope_id")?,
        item_text: row.try_get("item_text")?,
        task_id: row.try_get("linked_task_id")?,
        change,
    })
}

/// Completes the open workflow checklist items linked to `task_id`.
///
/// Every task surface (work center, patient card, appointment tasks) must keep
/// the order/patient checklist in step with its linked task; otherwise the
/// checklist keeps counting a finished task as open and blocks order
/// completion. Run it in the same transaction as the task status change and
/// pass the result to [`publish_checklist_item_changes`] after commit.
pub(crate) async fn complete_checklist_items_for_task<'e, E>(
    executor: E,
    task_id: Uuid,
    actor_id: Uuid,
) -> Result<Vec<TaskCompletedChecklistItem>, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    let rows = sqlx::query(
        r#"UPDATE workflow_checklist_items
           SET is_completed = true,
               completed_by = $2,
               completed_at = COALESCE(completed_at, now()),
               updated_at = now()
           WHERE linked_task_id = $1
             AND is_completed = false
           RETURNING id, patient_id, order_id, scope_type, scope_id, item_text, linked_task_id"#,
    )
    .bind(task_id)
    .bind(actor_id)
    .fetch_all(executor)
    .await?;
    rows.iter()
        .map(|row| checklist_sync_from_row(row, ChecklistItemChange::Completed))
        .collect()
}

/// Keeps the checklist items linked to a work-center task in step with a
/// status change of that task: completing the task completes them, cancelling
/// it resolves them as "not required", and reopening a finished or cancelled
/// task reopens them. Run it in the transaction of the status change and pass
/// the result to [`publish_checklist_item_changes`] after commit.
pub(crate) async fn sync_checklist_items_for_task_status(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    task_id: Uuid,
    previous_status: &str,
    status: &str,
    actor_id: Uuid,
) -> Result<Vec<ChecklistItemSync>, sqlx::Error> {
    if previous_status == status {
        return Ok(Vec::new());
    }
    match status {
        "completed" => complete_checklist_items_for_task(&mut **tx, task_id, actor_id).await,
        "cancelled" => {
            let rows = sqlx::query(
                r#"UPDATE workflow_checklist_items
                   SET is_completed = true,
                       not_required = true,
                       not_required_reason = 'task_cancelled',
                       completed_by = $2,
                       completed_at = now(),
                       updated_at = now()
                   WHERE linked_task_id = $1
                     AND NOT is_completed
                   RETURNING id, patient_id, order_id, scope_type, scope_id, item_text, linked_task_id"#,
            )
            .bind(task_id)
            .bind(actor_id)
            .fetch_all(&mut **tx)
            .await?;
            rows.iter()
                .map(|row| {
                    checklist_sync_from_row(
                        row,
                        ChecklistItemChange::NotRequired(NotRequiredReason::TaskCancelled),
                    )
                })
                .collect()
        }
        _ if matches!(previous_status, "completed" | "cancelled") => {
            let rows = sqlx::query(
                r#"UPDATE workflow_checklist_items
                   SET is_completed = false,
                       not_required = false,
                       not_required_reason = NULL,
                       completed_by = NULL,
                       completed_at = NULL,
                       updated_at = now()
                   WHERE linked_task_id = $1
                     AND is_completed
                   RETURNING id, patient_id, order_id, scope_type, scope_id, item_text, linked_task_id"#,
            )
            .bind(task_id)
            .fetch_all(&mut **tx)
            .await?;
            rows.iter()
                .map(|row| checklist_sync_from_row(row, ChecklistItemChange::Reopened))
                .collect()
        }
        _ => Ok(Vec::new()),
    }
}

/// Audits and broadcasts checklist items that changed with their task.
pub(crate) async fn publish_checklist_item_changes(
    state: &AppState,
    actor_id: Uuid,
    items: &[ChecklistItemSync],
) {
    for item in items {
        let mut payload = json!({
            "scope_type": item.scope_type,
            "scope_id": item.scope_id,
            "order_id": item.order_id,
            "checklist_item_id": item.id,
            "task_id": item.task_id,
            "item_text": item.item_text,
        });
        match item.change {
            ChecklistItemChange::Completed => {
                payload["completed_via"] = json!("task");
            }
            ChecklistItemChange::NotRequired(reason) => {
                payload["change"] = json!("not_required");
                payload["not_required_reason"] = json!(reason.as_str());
            }
            ChecklistItemChange::Reopened => {
                payload["change"] = json!("reopened");
            }
        }
        state.audit_sender.try_send(audit::domain_event(
            item.change.audit_action(),
            Some(actor_id),
            "patient",
            Some(item.patient_id),
            payload.clone(),
        ));
        crate::realtime::publish_workflow_checklist_event(
            state,
            Some(actor_id),
            item.change.realtime_event(),
            item.id,
            payload,
        )
        .await;
        if let Some(task_id) = item.task_id
            && item.change != ChecklistItemChange::Completed
        {
            crate::realtime::publish_task_event(
                state,
                Some(actor_id),
                "task.status_changed",
                task_id,
                json!({
                    "source": "workflow_checklist",
                    "scope_type": item.scope_type,
                    "scope_id": item.scope_id,
                    "order_id": item.order_id,
                    "checklist_item_id": item.id,
                }),
            )
            .await;
        }
    }
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
