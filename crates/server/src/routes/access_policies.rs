use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/access-policies", get(list_policies))
        .route("/access-policies/update", post(update_policy))
        .route("/access-policies/reset", post(reset_entity))
}

#[derive(Serialize)]
struct PolicyResponse {
    id: Uuid,
    role: String,
    entity_type: String,
    field_name: String,
    access_level: String,
    condition_type: Option<String>,
    is_system_locked: bool,
}

#[derive(Deserialize)]
struct ListQuery {
    entity_type: Option<String>,
    role: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePolicyRequest {
    role: String,
    entity_type: String,
    field_name: String,
    access_level: String,
    condition_type: Option<String>,
}

#[derive(Deserialize)]
struct ResetRequest {
    entity_type: String,
}

const VALID_ACCESS_LEVELS: &[&str] = &["full", "masked", "hidden", "conditional"];
const VALID_CONDITIONS: &[&str] = &["assigned_appointment", "freigegeben", "own_data"];

async fn list_policies(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::ItAdmin])?;

    let entity_filter = query.entity_type.as_deref();
    let role_filter = query.role.as_deref();

    let rows = sqlx::query!(
        "SELECT id, role, entity_type, field_name, access_level, condition_type, is_system_locked
         FROM field_access_policies
         WHERE ($1::text IS NULL OR entity_type = $1)
           AND ($2::text IS NULL OR role = $2)
         ORDER BY entity_type, role, field_name",
        entity_filter,
        role_filter
    )
    .fetch_all(&state.db)
    .await;

    match rows {
        Ok(rows) => {
            let mut policies = Vec::with_capacity(rows.len());
            for r in rows {
                policies.push(PolicyResponse {
                    id: r.id,
                    role: r.role,
                    entity_type: r.entity_type,
                    field_name: r.field_name,
                    access_level: r.access_level,
                    condition_type: r.condition_type,
                    is_system_locked: r.is_system_locked,
                });
            }
            Ok(Json(policies))
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to list access policies");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list policies",
            ))
        }
    }
}

async fn update_policy(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpdatePolicyRequest>,
) -> impl IntoResponse {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;

    if !VALID_ACCESS_LEVELS.contains(&body.access_level.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid access level",
        ));
    }

    if let Some(ref cond) = body.condition_type
        && !VALID_CONDITIONS.contains(&cond.as_str())
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid condition type",
        ));
    }

    if body.access_level == "conditional" && body.condition_type.is_none() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Conditional access requires condition_type",
        ));
    }

    let locked = sqlx::query_scalar!(
        r#"SELECT is_system_locked AS "locked!" FROM field_access_policies
         WHERE role = $1 AND entity_type = $2 AND field_name = $3"#,
        body.role,
        body.entity_type,
        body.field_name
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "DB error");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
    })?;

    match locked {
        Some(true) => {
            return Err(err(
                StatusCode::FORBIDDEN,
                "This field is locked by a system rule and cannot be changed",
            ));
        }
        None => {
            return Err(err(StatusCode::NOT_FOUND, "Policy not found"));
        }
        Some(false) => {}
    }

    let result = sqlx::query!(
        "UPDATE field_access_policies
         SET access_level = $4, condition_type = $5, updated_by = $6, updated_at = now()
         WHERE role = $1 AND entity_type = $2 AND field_name = $3 AND NOT is_system_locked
         RETURNING id",
        body.role,
        body.entity_type,
        body.field_name,
        body.access_level,
        body.condition_type,
        auth.user_id
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to update policy");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update policy")
    })?;

    let Some(row) = result else {
        return Err(err(
            StatusCode::NOT_FOUND,
            "Policy not found or system locked",
        ));
    };

    // Policy update captures an after-state only, so the new state is
    // surfaced on the context blob rather than the dedicated new_value
    // column. Equivalent information, same SQL row count.
    state.audit_sender.try_send(audit::domain_event(
        "update_access_policy",
        Some(auth.user_id),
        "field_access_policy",
        Some(row.id),
        serde_json::json!({
            "new_value": {
                "role": body.role,
                "entity_type": body.entity_type,
                "field_name": body.field_name,
                "access_level": body.access_level,
                "condition_type": body.condition_type,
            }
        }),
    ));

    tracing::info!(
        by = %auth.user_id,
        role = %body.role,
        entity = %body.entity_type,
        field = %body.field_name,
        level = %body.access_level,
        "Access policy updated"
    );

    Ok(Json(serde_json::json!({"ok": true})))
}

async fn reset_entity(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<ResetRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_exact_role(&[Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    let result = sqlx::query!(
        "DELETE FROM field_access_policies WHERE entity_type = $1 AND NOT is_system_locked",
        body.entity_type
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(r) => {
            tracing::info!(by = %auth.user_id, entity = %body.entity_type, deleted = r.rows_affected(), "Access policies reset");
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to reset policies");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reset policies",
            )
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
