use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sops", get(list_sops).post(create_sop))
        .route("/sops/eligible-users", get(list_eligible_users))
        .route("/sops/review-queue", get(review_queue))
        .route("/sops/{id}/update", post(update_sop))
        .route("/sops/{id}/review", post(review_sop))
        .route(
            "/sops/{id}/request-acknowledgement",
            post(request_acknowledgement),
        )
        .route("/sops/{id}/acknowledge", post(acknowledge_sop))
}

#[derive(Deserialize)]
struct UpsertSopRequest {
    title: String,
    category: String,
    summary: Option<String>,
    body_markdown: Option<String>,
    target_roles: Option<Vec<String>>,
    target_user_ids: Option<Vec<Uuid>>,
    requires_ack: Option<bool>,
}

#[derive(Deserialize)]
struct ReviewSopRequest {
    decision: String,
    note: Option<String>,
}

#[derive(Debug)]
struct SopRow {
    id: Uuid,
    title: String,
    category: String,
    summary: Option<String>,
    body_markdown: String,
    status: String,
    approval_required_role: Option<String>,
    target_roles: Vec<String>,
    requires_ack: bool,
    revision_no: i32,
    created_by: Uuid,
    created_by_role: String,
    approved_by: Option<Uuid>,
    approved_at: Option<DateTime<Utc>>,
    review_note: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    created_by_name: Option<String>,
    approved_by_name: Option<String>,
    directly_assigned: bool,
    assigned_user_count: i64,
    target_user_ids: Vec<Uuid>,
    my_ack_status: Option<String>,
    my_acknowledged_at: Option<DateTime<Utc>>,
    pending_ack_count: i64,
    acknowledged_count: i64,
}

#[derive(Debug)]
struct TargetUser {
    role: String,
}

async fn list_sops(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    match load_sop_rows(&state, auth.user_id).await {
        Ok(rows) => {
            let role_name = role_code(auth.role);
            let data: Vec<Value> = rows
                .into_iter()
                .filter(|row| can_view_sop(&auth, row, role_name))
                .map(|row| {
                    json!({
                        "id": row.id,
                        "title": row.title,
                        "category": row.category,
                        "summary": row.summary,
                        "body_markdown": row.body_markdown,
                        "status": row.status,
                        "approval_required_role": row.approval_required_role,
                        "target_roles": row.target_roles,
                        "requires_ack": row.requires_ack,
                        "revision_no": row.revision_no,
                        "created_by": row.created_by,
                        "created_by_name": row.created_by_name,
                        "created_by_role": row.created_by_role,
                        "approved_by": row.approved_by,
                        "approved_by_name": row.approved_by_name,
                        "approved_at": row.approved_at,
                        "review_note": row.review_note,
                        "created_at": row.created_at,
                        "updated_at": row.updated_at,
                        "assigned_user_count": row.assigned_user_count,
                        "target_user_ids": row.target_user_ids,
                        "my_ack_status": row.my_ack_status,
                        "my_acknowledged_at": row.my_acknowledged_at,
                        "pending_ack_count": row.pending_ack_count,
                        "acknowledged_count": row.acknowledged_count,
                        "can_edit": can_edit_sop(&auth, &row),
                        "can_review": can_review_sop(&auth, &row),
                        "can_request_ack": can_request_ack(&auth, &row),
                        "can_acknowledge": row.my_ack_status.as_deref() == Some("pending"),
                    })
                })
                .collect();

            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list sops");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load SOP workspace",
            )
        }
    }
}

async fn list_eligible_users(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    let Some(allowed_roles) = allowed_target_roles_for_creator(auth.role) else {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    };

    let allowed_roles_vec: Vec<String> = allowed_roles
        .iter()
        .map(|value| value.to_string())
        .collect();
    match sqlx::query(
        r#"SELECT id, name, role
           FROM users
           WHERE is_active = true
             AND role = ANY($1)
           ORDER BY role, name"#,
    )
    .bind(&allowed_roles_vec)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let users: Vec<Value> = rows
                .into_iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "name": row.try_get::<String, _>("name").unwrap_or_default(),
                        "role": row.try_get::<String, _>("role").unwrap_or_default(),
                    })
                })
                .collect();
            Json(json!({
                "allowed_target_roles": allowed_roles_vec,
                "eligible_users": users,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list sop eligible users");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load eligible team members",
            )
        }
    }
}

async fn review_queue(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    match load_sop_rows(&state, auth.user_id).await {
        Ok(rows) => {
            let data: Vec<Value> = rows
                .into_iter()
                .filter(|row| can_review_sop(&auth, row))
                .map(|row| {
                    json!({
                        "id": row.id,
                        "title": row.title,
                        "category": row.category,
                        "summary": row.summary,
                        "body_markdown": row.body_markdown,
                        "status": row.status,
                        "approval_required_role": row.approval_required_role,
                        "target_roles": row.target_roles,
                        "requires_ack": row.requires_ack,
                        "revision_no": row.revision_no,
                        "created_by": row.created_by,
                        "created_by_name": row.created_by_name,
                        "created_by_role": row.created_by_role,
                        "review_note": row.review_note,
                        "created_at": row.created_at,
                        "updated_at": row.updated_at,
                        "assigned_user_count": row.assigned_user_count,
                        "target_user_ids": row.target_user_ids,
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "load sop review queue");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load SOP review queue",
            )
        }
    }
}

async fn create_sop(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertSopRequest>,
) -> axum::response::Response {
    let Some(allowed_target_roles) = allowed_target_roles_for_creator(auth.role) else {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    };

    let normalized = match normalize_sop_input(&body, allowed_target_roles) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };

    let target_users = match load_target_users(&state, &normalized.target_user_ids).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load sop target users");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate target users",
            );
        }
    };

    if target_users.len() != normalized.target_user_ids.len() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Some selected team members are missing or inactive",
        );
    }

    if let Err(message) = validate_target_users(auth.role, &target_users) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }

    let sop_id = Uuid::new_v4();
    let approval_required_role = required_approval_role_for_creator(auth.role);
    let status = if approval_required_role.is_none() {
        "approved"
    } else {
        "pending_approval"
    };
    let approved_by = if approval_required_role.is_none() {
        Some(auth.user_id)
    } else {
        None
    };
    let approved_at = if approval_required_role.is_none() {
        Some(Utc::now())
    } else {
        None
    };

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "begin create sop");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create SOP");
        }
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO sop_documents (
                id, title, category, summary, body_markdown, status, target_roles,
                requires_ack, revision_no, created_by, created_by_role,
                approval_required_role, approved_by, approved_at, effective_from
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, 1, $9, $10,
                $11, $12, $13, now()
           )"#,
    )
    .bind(sop_id)
    .bind(&normalized.title)
    .bind(&normalized.category)
    .bind(&normalized.summary)
    .bind(&normalized.body_markdown)
    .bind(status)
    .bind(&normalized.target_roles)
    .bind(normalized.requires_ack)
    .bind(auth.user_id)
    .bind(role_code(auth.role))
    .bind(approval_required_role)
    .bind(approved_by)
    .bind(approved_at)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "insert sop document");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create SOP");
    }

    if let Err(e) =
        replace_assignments(&mut tx, sop_id, auth.user_id, &normalized.target_user_ids).await
    {
        tracing::error!(error = %e, "insert sop assignments");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create SOP");
    }

    // TODO(audit-migrate): transactional — coupled to create_sop rollback via
    // `.execute(&mut *tx)`. AuditContext fires after the response outside the
    // handler's transaction, so migrating here would drop rollback coupling
    // and claim the SOP was created on an aborted transaction. Leave as-is.
    if let Err(e) = sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
           VALUES ($1, 'create_sop', 'sop', $2, $3)"#,
    )
    .bind(auth.user_id)
    .bind(sop_id)
    .bind(json!({
        "status": status,
        "category": normalized.category,
        "target_roles": normalized.target_roles,
        "target_user_ids": normalized.target_user_ids,
        "requires_ack": normalized.requires_ack,
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "audit create sop");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create SOP");
    }

    if status == "pending_approval"
        && let Some(target_roles) = review_request_notification_roles(auth.role)
        && let Err(e) = notify_role_users_tx(
            &mut tx,
            target_roles,
            "sop_review_request",
            format!("SOP review requested: {}", normalized.title),
            review_request_notification_body(auth.role, false),
            "sop",
            sop_id,
        )
        .await
    {
        tracing::error!(error = %e, "notify sop review request");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create SOP");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "commit create sop");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create SOP");
    }

    Json(json!({
        "ok": true,
        "id": sop_id,
        "status": status,
    }))
    .into_response()
}

async fn update_sop(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertSopRequest>,
) -> axum::response::Response {
    let Some(allowed_target_roles) = allowed_target_roles_for_creator(auth.role) else {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    };

    let current = match load_single_sop_row(&state, id, auth.user_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "SOP not found"),
        Err(e) => {
            tracing::error!(error = %e, sop_id = %id, "load sop for update");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update SOP");
        }
    };

    if !can_edit_sop(&auth, &current) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let normalized = match normalize_sop_input(&body, allowed_target_roles) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };

    let target_users = match load_target_users(&state, &normalized.target_user_ids).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "load sop target users for update");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate target users",
            );
        }
    };

    if target_users.len() != normalized.target_user_ids.len() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Some selected team members are missing or inactive",
        );
    }

    if let Err(message) = validate_target_users(auth.role, &target_users) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }

    let approval_required_role = required_approval_role_for_creator(auth.role);
    let new_status = if approval_required_role.is_none() {
        if current.status == "archived" {
            "archived"
        } else {
            "approved"
        }
    } else {
        "pending_approval"
    };
    let new_revision = if approval_required_role.is_none() && current.status == "approved" {
        current.revision_no + 1
    } else {
        current.revision_no
    };
    let approved_by = if approval_required_role.is_none() {
        Some(auth.user_id)
    } else {
        None
    };
    let approved_at = if approval_required_role.is_none() {
        Some(Utc::now())
    } else {
        None
    };

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "begin update sop");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update SOP");
        }
    };

    if let Err(e) = sqlx::query(
        r#"UPDATE sop_documents
           SET title = $2,
               category = $3,
               summary = $4,
               body_markdown = $5,
               status = $6,
               target_roles = $7,
               requires_ack = $8,
               revision_no = $9,
               approval_required_role = $10,
               approved_by = $11,
               approved_at = $12,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(&normalized.title)
    .bind(&normalized.category)
    .bind(&normalized.summary)
    .bind(&normalized.body_markdown)
    .bind(new_status)
    .bind(&normalized.target_roles)
    .bind(normalized.requires_ack)
    .bind(new_revision)
    .bind(approval_required_role)
    .bind(approved_by)
    .bind(approved_at)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, sop_id = %id, "update sop document");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update SOP");
    }

    if let Err(e) =
        replace_assignments(&mut tx, id, auth.user_id, &normalized.target_user_ids).await
    {
        tracing::error!(error = %e, sop_id = %id, "replace sop assignments");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update SOP");
    }

    // TODO(audit-migrate): transactional — `.execute(&mut *tx)` keeps this
    // row rolled back with update_sop on failure. Do not migrate.
    if let Err(e) = sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
           VALUES ($1, 'update_sop', 'sop', $2, $3)"#,
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(json!({
        "status": new_status,
        "category": normalized.category,
        "target_roles": normalized.target_roles,
        "target_user_ids": normalized.target_user_ids,
        "revision_no": new_revision,
        "requires_ack": normalized.requires_ack,
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "audit update sop");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update SOP");
    }

    if new_status == "pending_approval"
        && let Some(target_roles) = review_request_notification_roles(auth.role)
        && let Err(e) = notify_role_users_tx(
            &mut tx,
            target_roles,
            "sop_review_request",
            format!("SOP review updated: {}", normalized.title),
            review_request_notification_body(auth.role, true),
            "sop",
            id,
        )
        .await
    {
        tracing::error!(error = %e, "notify sop update review");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update SOP");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, sop_id = %id, "commit update sop");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update SOP");
    }

    Json(json!({
        "ok": true,
        "id": id,
        "status": new_status,
        "revision_no": new_revision,
    }))
    .into_response()
}

async fn review_sop(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<ReviewSopRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let current = match load_single_sop_row(&state, id, auth.user_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "SOP not found"),
        Err(e) => {
            tracing::error!(error = %e, sop_id = %id, "load sop for review");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review SOP");
        }
    };

    if current.status != "pending_approval" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only pending SOPs can be reviewed",
        );
    }
    if !can_review_sop(&auth, &current) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let decision = body.decision.trim().to_lowercase();
    if decision != "approve" && decision != "reject" {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid review decision");
    }

    let new_status = if decision == "approve" {
        "approved"
    } else {
        "rejected"
    };

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "begin review sop");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review SOP");
        }
    };

    if let Err(e) = sqlx::query(
        r#"UPDATE sop_documents
           SET status = $2,
               approval_required_role = CASE WHEN $2 = 'approved' THEN NULL ELSE approval_required_role END,
               approved_by = CASE WHEN $2 = 'approved' THEN $3 ELSE NULL END,
               approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END,
               review_note = $4,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(new_status)
    .bind(auth.user_id)
    .bind(body.note.as_deref().unwrap_or_default())
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, sop_id = %id, "update sop review");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review SOP");
    }

    // TODO(audit-migrate): transactional — `.execute(&mut *tx)` keeps this
    // row rolled back with review_sop on failure. Do not migrate.
    if let Err(e) = sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
           VALUES ($1, 'review_sop', 'sop', $2, $3)"#,
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(json!({
        "decision": decision,
        "note": body.note,
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "audit sop review");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review SOP");
    }

    let notification_title = if decision == "approve" {
        format!("SOP approved: {}", current.title)
    } else {
        format!("SOP changes requested: {}", current.title)
    };
    let notification_body = if decision == "approve" {
        "The SOP is now visible within the approved target scope."
    } else {
        "The SOP was sent back and needs adjustments before approval."
    };

    if let Err(e) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           VALUES ($1, 'sop_review_update', $2, $3, 'sop', $4)"#,
    )
    .bind(current.created_by)
    .bind(notification_title)
    .bind(notification_body)
    .bind(id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "notify sop creator");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review SOP");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, sop_id = %id, "commit sop review");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to review SOP");
    }

    Json(json!({
        "ok": true,
        "id": id,
        "status": new_status,
    }))
    .into_response()
}

async fn request_acknowledgement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let current = match load_single_sop_row(&state, id, auth.user_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "SOP not found"),
        Err(e) => {
            tracing::error!(error = %e, sop_id = %id, "load sop for acknowledgement request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to request acknowledgement",
            );
        }
    };

    if !can_request_ack(&auth, &current) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if current.status != "approved" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only approved SOPs can request acknowledgement",
        );
    }

    let recipients = match load_sop_ack_recipients(&state, &current).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, sop_id = %id, "load sop ack recipients");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to request acknowledgement",
            );
        }
    };

    if recipients.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "No active recipients are targeted for acknowledgement",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "begin request sop acknowledgement");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to request acknowledgement",
            );
        }
    };

    if let Err(e) = sqlx::query(
        r#"UPDATE sop_documents
           SET requires_ack = true,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, sop_id = %id, "mark sop requires ack");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to request acknowledgement",
        );
    }

    let mut created_rows = 0_i64;
    for recipient_id in recipients {
        let result = sqlx::query(
            r#"INSERT INTO sop_acknowledgements (
                    sop_id, user_id, revision_no, status, requested_by
               ) VALUES (
                    $1, $2, $3, 'pending', $4
               )
               ON CONFLICT (sop_id, user_id, revision_no) DO NOTHING"#,
        )
        .bind(id)
        .bind(recipient_id)
        .bind(current.revision_no)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await;

        match result {
            Ok(outcome) => {
                if outcome.rows_affected() > 0 {
                    created_rows += 1;
                    let _ = sqlx::query(
                        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                           VALUES ($1, 'sop_ack_request', $2, $3, 'sop', $4)"#,
                    )
                    .bind(recipient_id)
                    .bind(format!("Acknowledge SOP: {}", current.title))
                    .bind("A new acknowledgement request is waiting in the SOP workspace.")
                    .bind(id)
                    .execute(&mut *tx)
                    .await;
                }
            }
            Err(e) => {
                tracing::error!(error = %e, sop_id = %id, "insert sop acknowledgement row");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to request acknowledgement",
                );
            }
        }
    }

    // TODO(audit-migrate): transactional — `.execute(&mut *tx)` keeps this
    // row rolled back with the acknowledgement request on failure. Do not
    // migrate.
    if let Err(e) = sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
           VALUES ($1, 'request_sop_acknowledgement', 'sop', $2, $3)"#,
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(json!({
        "revision_no": current.revision_no,
        "recipient_count": created_rows,
    }))
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "audit request sop acknowledgement");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to request acknowledgement",
        );
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, sop_id = %id, "commit request sop acknowledgement");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to request acknowledgement",
        );
    }

    Json(json!({
        "ok": true,
        "id": id,
        "recipient_count": created_rows,
        "revision_no": current.revision_no,
    }))
    .into_response()
}

async fn acknowledge_sop(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let current = match load_single_sop_row(&state, id, auth.user_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "SOP not found"),
        Err(e) => {
            tracing::error!(error = %e, sop_id = %id, "load sop for acknowledgement");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to acknowledge SOP",
            );
        }
    };

    if !can_view_sop(&auth, &current, role_code(auth.role)) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if current.my_ack_status.as_deref() != Some("pending") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "There is no pending acknowledgement for the current SOP revision",
        );
    }

    match sqlx::query(
        r#"UPDATE sop_acknowledgements
           SET status = 'acknowledged',
               acknowledged_at = now()
           WHERE sop_id = $1
             AND user_id = $2
             AND revision_no = $3
             AND status = 'pending'"#,
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(current.revision_no)
    .execute(&state.db)
    .await
    {
        Ok(outcome) if outcome.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "acknowledge_sop",
                Some(auth.user_id),
                "sop",
                Some(id),
                json!({ "revision_no": current.revision_no }),
            ));

            Json(json!({
                "ok": true,
                "id": id,
                "revision_no": current.revision_no,
            }))
            .into_response()
        }
        Ok(_) => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "There is no pending acknowledgement for the current SOP revision",
        ),
        Err(e) => {
            tracing::error!(error = %e, sop_id = %id, "acknowledge sop");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to acknowledge SOP",
            )
        }
    }
}

async fn load_sop_rows(state: &AppState, user_id: Uuid) -> Result<Vec<SopRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
                s.id,
                s.title,
                s.category,
                s.summary,
                s.body_markdown,
                s.status,
                s.approval_required_role,
                s.target_roles,
                s.requires_ack,
                s.revision_no,
                s.created_by,
                s.created_by_role,
                s.approved_by,
                s.approved_at,
                s.review_note,
                s.created_at,
                s.updated_at,
                creator.name AS created_by_name,
                approver.name AS approved_by_name,
                EXISTS(
                    SELECT 1
                    FROM sop_assignments sa
                    WHERE sa.sop_id = s.id
                      AND sa.target_user_id = $1
                ) AS directly_assigned,
                COALESCE((
                    SELECT COUNT(*)::bigint
                    FROM sop_assignments sa
                    WHERE sa.sop_id = s.id
                ), 0) AS assigned_user_count,
                COALESCE((
                    SELECT array_agg(sa.target_user_id)
                    FROM sop_assignments sa
                    WHERE sa.sop_id = s.id
                ), ARRAY[]::uuid[]) AS target_user_ids,
                (
                    SELECT a.status
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.user_id = $1
                      AND a.revision_no = s.revision_no
                    ORDER BY a.requested_at DESC
                    LIMIT 1
                ) AS my_ack_status,
                (
                    SELECT a.acknowledged_at
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.user_id = $1
                      AND a.revision_no = s.revision_no
                    ORDER BY a.requested_at DESC
                    LIMIT 1
                ) AS my_acknowledged_at,
                COALESCE((
                    SELECT COUNT(*)::bigint
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.revision_no = s.revision_no
                      AND a.status = 'pending'
                ), 0) AS pending_ack_count,
                COALESCE((
                    SELECT COUNT(*)::bigint
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.revision_no = s.revision_no
                      AND a.status = 'acknowledged'
                ), 0) AS acknowledged_count
           FROM sop_documents s
           LEFT JOIN users creator ON creator.id = s.created_by
           LEFT JOIN users approver ON approver.id = s.approved_by
           ORDER BY
                CASE s.status
                    WHEN 'pending_approval' THEN 0
                    WHEN 'approved' THEN 1
                    WHEN 'rejected' THEN 2
                    WHEN 'draft' THEN 3
                    ELSE 4
                END,
                s.updated_at DESC"#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    Ok(rows.into_iter().map(map_sop_row).collect())
}

async fn load_single_sop_row(
    state: &AppState,
    sop_id: Uuid,
    user_id: Uuid,
) -> Result<Option<SopRow>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT
                s.id,
                s.title,
                s.category,
                s.summary,
                s.body_markdown,
                s.status,
                s.approval_required_role,
                s.target_roles,
                s.requires_ack,
                s.revision_no,
                s.created_by,
                s.created_by_role,
                s.approved_by,
                s.approved_at,
                s.review_note,
                s.created_at,
                s.updated_at,
                creator.name AS created_by_name,
                approver.name AS approved_by_name,
                EXISTS(
                    SELECT 1
                    FROM sop_assignments sa
                    WHERE sa.sop_id = s.id
                      AND sa.target_user_id = $2
                ) AS directly_assigned,
                COALESCE((
                    SELECT COUNT(*)::bigint
                    FROM sop_assignments sa
                    WHERE sa.sop_id = s.id
                ), 0) AS assigned_user_count,
                COALESCE((
                    SELECT array_agg(sa.target_user_id)
                    FROM sop_assignments sa
                    WHERE sa.sop_id = s.id
                ), ARRAY[]::uuid[]) AS target_user_ids,
                (
                    SELECT a.status
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.user_id = $2
                      AND a.revision_no = s.revision_no
                    ORDER BY a.requested_at DESC
                    LIMIT 1
                ) AS my_ack_status,
                (
                    SELECT a.acknowledged_at
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.user_id = $2
                      AND a.revision_no = s.revision_no
                    ORDER BY a.requested_at DESC
                    LIMIT 1
                ) AS my_acknowledged_at,
                COALESCE((
                    SELECT COUNT(*)::bigint
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.revision_no = s.revision_no
                      AND a.status = 'pending'
                ), 0) AS pending_ack_count,
                COALESCE((
                    SELECT COUNT(*)::bigint
                    FROM sop_acknowledgements a
                    WHERE a.sop_id = s.id
                      AND a.revision_no = s.revision_no
                      AND a.status = 'acknowledged'
                ), 0) AS acknowledged_count
           FROM sop_documents s
           LEFT JOIN users creator ON creator.id = s.created_by
           LEFT JOIN users approver ON approver.id = s.approved_by
           WHERE s.id = $1"#,
    )
    .bind(sop_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(row.map(map_sop_row))
}

fn map_sop_row(row: PgRow) -> SopRow {
    SopRow {
        id: row.try_get("id").unwrap_or_else(|_| Uuid::nil()),
        title: row.try_get("title").unwrap_or_default(),
        category: row.try_get("category").unwrap_or_default(),
        summary: row.try_get("summary").ok(),
        body_markdown: row.try_get("body_markdown").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        approval_required_role: row.try_get("approval_required_role").ok(),
        target_roles: row.try_get("target_roles").unwrap_or_default(),
        requires_ack: row.try_get("requires_ack").unwrap_or(false),
        revision_no: row.try_get("revision_no").unwrap_or(1),
        created_by: row.try_get("created_by").unwrap_or_else(|_| Uuid::nil()),
        created_by_role: row.try_get("created_by_role").unwrap_or_default(),
        approved_by: row.try_get("approved_by").ok(),
        approved_at: row.try_get("approved_at").ok(),
        review_note: row.try_get("review_note").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
        created_by_name: row.try_get("created_by_name").ok(),
        approved_by_name: row.try_get("approved_by_name").ok(),
        directly_assigned: row.try_get("directly_assigned").unwrap_or(false),
        assigned_user_count: row.try_get("assigned_user_count").unwrap_or(0),
        target_user_ids: row.try_get("target_user_ids").unwrap_or_default(),
        my_ack_status: row.try_get("my_ack_status").ok(),
        my_acknowledged_at: row.try_get("my_acknowledged_at").ok(),
        pending_ack_count: row.try_get("pending_ack_count").unwrap_or(0),
        acknowledged_count: row.try_get("acknowledged_count").unwrap_or(0),
    }
}

fn can_view_sop(auth: &AuthUser, row: &SopRow, role_name: &str) -> bool {
    if auth.role == Role::Ceo {
        return true;
    }

    if can_review_sop(auth, row) {
        return true;
    }

    if row.created_by == auth.user_id {
        return true;
    }

    if row.approved_by == Some(auth.user_id) {
        return true;
    }

    if row.status != "approved" {
        return false;
    }

    if auth.role == Role::PatientManager && row.created_by_role == "teamlead_interpreter" {
        return true;
    }

    row.directly_assigned || row.target_roles.iter().any(|role| role == role_name)
}

fn can_edit_sop(auth: &AuthUser, row: &SopRow) -> bool {
    if auth.role == Role::Ceo {
        return true;
    }

    row.created_by == auth.user_id && row.status != "approved" && row.status != "archived"
}

fn can_review_sop(auth: &AuthUser, row: &SopRow) -> bool {
    if row.status != "pending_approval" {
        return false;
    }

    matches!(
        (auth.role, row.approval_required_role.as_deref()),
        (Role::Ceo, Some("ceo")) | (Role::PatientManager, Some("patient_manager"))
    )
}

fn can_request_ack(auth: &AuthUser, row: &SopRow) -> bool {
    if row.status != "approved" {
        return false;
    }

    if auth.role == Role::Ceo {
        return true;
    }

    auth.role == Role::PatientManager
        && (row.created_by == auth.user_id || row.approved_by == Some(auth.user_id))
}

fn role_code(role: Role) -> &'static str {
    match role {
        Role::Ceo => "ceo",
        Role::CeoAssistant => "ceo_assistant",
        Role::PatientManager => "patient_manager",
        Role::TeamleadInterpreter => "teamlead_interpreter",
        Role::Interpreter => "interpreter",
        Role::Concierge => "concierge",
        Role::Billing => "billing",
        Role::Sales => "sales",
        Role::ItAdmin => "it_admin",
        Role::Patient => "patient",
        _ => "unknown",
    }
}

fn allowed_target_roles_for_creator(role: Role) -> Option<&'static [&'static str]> {
    match role {
        Role::Ceo => Some(&[
            "ceo_assistant",
            "patient_manager",
            "teamlead_interpreter",
            "interpreter",
            "concierge",
            "billing",
            "sales",
            "it_admin",
        ]),
        Role::PatientManager => Some(&["teamlead_interpreter", "interpreter", "concierge"]),
        Role::TeamleadInterpreter => Some(&["interpreter"]),
        _ => None,
    }
}

fn required_approval_role_for_creator(role: Role) -> Option<&'static str> {
    match role {
        Role::Ceo => None,
        Role::PatientManager => Some("ceo"),
        Role::TeamleadInterpreter => Some("patient_manager"),
        _ => None,
    }
}

fn review_request_notification_roles(role: Role) -> Option<&'static [&'static str]> {
    match role {
        Role::PatientManager => Some(&["ceo"]),
        Role::TeamleadInterpreter => Some(&["patient_manager"]),
        _ => None,
    }
}

fn review_request_notification_body(role: Role, is_update: bool) -> &'static str {
    match (role, is_update) {
        (Role::PatientManager, false) => "A patient manager submitted a team SOP for CEO approval.",
        (Role::PatientManager, true) => {
            "A patient manager resubmitted a team SOP for CEO approval."
        }
        (Role::TeamleadInterpreter, false) => {
            "A teamlead interpreter submitted an interpreter SOP for patient-manager approval."
        }
        (Role::TeamleadInterpreter, true) => {
            "A teamlead interpreter resubmitted an interpreter SOP for patient-manager approval."
        }
        _ => "A new SOP is waiting for review.",
    }
}

struct NormalizedSopInput {
    title: String,
    category: String,
    summary: Option<String>,
    body_markdown: String,
    target_roles: Vec<String>,
    target_user_ids: Vec<Uuid>,
    requires_ack: bool,
}

fn normalize_sop_input(
    body: &UpsertSopRequest,
    allowed_target_roles: &[&str],
) -> Result<NormalizedSopInput, String> {
    let title = body.title.trim();
    if title.is_empty() || title.len() > 200 {
        return Err("Title must be between 1 and 200 characters".to_string());
    }

    let category = body.category.trim().to_lowercase();
    if !matches!(category.as_str(), "sop" | "handbook" | "training") {
        return Err("Invalid learning content category".to_string());
    }

    let summary = body
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if let Some(ref value) = summary
        && value.len() > 400
    {
        return Err("Summary must be 400 characters or fewer".to_string());
    }

    let body_markdown = body
        .body_markdown
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    if body_markdown.is_empty() {
        return Err("Content body is required".to_string());
    }

    let mut role_set = HashSet::new();
    let mut target_roles = Vec::new();
    for role in body.target_roles.clone().unwrap_or_default() {
        let normalized = role.trim().to_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if !allowed_target_roles.contains(&normalized.as_str()) {
            return Err("One or more target roles are not allowed".to_string());
        }
        if role_set.insert(normalized.clone()) {
            target_roles.push(normalized);
        }
    }

    let mut user_set = HashSet::new();
    let mut target_user_ids = Vec::new();
    for user_id in body.target_user_ids.clone().unwrap_or_default() {
        if user_set.insert(user_id) {
            target_user_ids.push(user_id);
        }
    }

    if target_roles.is_empty() && target_user_ids.is_empty() {
        return Err("Select at least one target role or team member".to_string());
    }

    Ok(NormalizedSopInput {
        title: title.to_string(),
        category,
        summary,
        body_markdown,
        target_roles,
        target_user_ids,
        requires_ack: body.requires_ack.unwrap_or(false),
    })
}

async fn load_target_users(state: &AppState, ids: &[Uuid]) -> Result<Vec<TargetUser>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        r#"SELECT id, name, role
           FROM users
           WHERE is_active = true
             AND id = ANY($1)"#,
    )
    .bind(ids)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| TargetUser {
            role: row.try_get("role").unwrap_or_default(),
        })
        .collect())
}

fn validate_target_users(role: Role, users: &[TargetUser]) -> Result<(), String> {
    let Some(allowed_roles) = allowed_target_roles_for_creator(role) else {
        return Err("Insufficient permissions".to_string());
    };

    if users
        .iter()
        .any(|user| !allowed_roles.contains(&user.role.as_str()))
    {
        return Err("One or more team members are not allowed for this SOP scope".to_string());
    }

    Ok(())
}

async fn replace_assignments(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    sop_id: Uuid,
    assigned_by: Uuid,
    target_user_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sop_assignments WHERE sop_id = $1")
        .bind(sop_id)
        .execute(&mut **tx)
        .await?;

    for user_id in target_user_ids {
        sqlx::query(
            r#"INSERT INTO sop_assignments (sop_id, target_user_id, assigned_by)
               VALUES ($1, $2, $3)"#,
        )
        .bind(sop_id)
        .bind(user_id)
        .bind(assigned_by)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn notify_role_users_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    roles: &[&str],
    kind: &str,
    title: String,
    body: &str,
    entity_type: &str,
    entity_id: Uuid,
) -> Result<(), sqlx::Error> {
    let role_values: Vec<String> = roles.iter().map(|value| value.to_string()).collect();
    let rows = sqlx::query(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role = ANY($1)"#,
    )
    .bind(&role_values)
    .fetch_all(&mut **tx)
    .await?;

    for row in rows {
        let user_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
        if user_id.is_nil() {
            continue;
        }
        sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               VALUES ($1, $2, $3, $4, $5, $6)"#,
        )
        .bind(user_id)
        .bind(kind)
        .bind(&title)
        .bind(body)
        .bind(entity_type)
        .bind(entity_id)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn load_sop_ack_recipients(
    state: &AppState,
    current: &SopRow,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let mut recipients = HashSet::new();

    if !current.target_roles.is_empty() {
        let rows = sqlx::query(
            r#"SELECT id
               FROM users
               WHERE is_active = true
                 AND role = ANY($1)"#,
        )
        .bind(&current.target_roles)
        .fetch_all(&state.db)
        .await?;
        for row in rows {
            let user_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
            if !user_id.is_nil() {
                recipients.insert(user_id);
            }
        }
    }

    let rows = sqlx::query(
        r#"SELECT u.id
           FROM sop_assignments sa
           JOIN users u ON u.id = sa.target_user_id
           WHERE sa.sop_id = $1
             AND u.is_active = true"#,
    )
    .bind(current.id)
    .fetch_all(&state.db)
    .await?;
    for row in rows {
        let user_id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
        if !user_id.is_nil() {
            recipients.insert(user_id);
        }
    }

    Ok(recipients.into_iter().collect())
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
