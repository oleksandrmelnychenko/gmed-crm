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

type DefaultPatientPolicy = (
    &'static str,
    &'static str,
    &'static str,
    Option<&'static str>,
    bool,
);

const DEFAULT_PATIENT_POLICIES: &[DefaultPatientPolicy] = &[
    ("patient_manager", "name", "full", None, false),
    ("patient_manager", "birth_date", "full", None, false),
    ("patient_manager", "phone", "full", None, false),
    ("patient_manager", "email", "full", None, false),
    ("patient_manager", "nationality", "full", None, false),
    ("patient_manager", "languages", "full", None, false),
    ("patient_manager", "insurance", "full", None, false),
    ("patient_manager", "diagnosis", "full", None, false),
    ("patient_manager", "medications", "full", None, false),
    ("patient_manager", "allergies", "full", None, false),
    ("patient_manager", "vitals", "full", None, false),
    ("patient_manager", "internal_notes", "full", None, false),
    ("patient_manager", "travel_data", "full", None, false),
    ("patient_manager", "functional_labels", "full", None, false),
    ("teamlead_interpreter", "name", "full", None, false),
    ("teamlead_interpreter", "birth_date", "full", None, false),
    ("teamlead_interpreter", "phone", "full", None, false),
    ("teamlead_interpreter", "email", "full", None, false),
    ("teamlead_interpreter", "nationality", "full", None, false),
    ("teamlead_interpreter", "languages", "full", None, false),
    ("teamlead_interpreter", "insurance", "hidden", None, false),
    ("teamlead_interpreter", "diagnosis", "hidden", None, false),
    ("teamlead_interpreter", "medications", "hidden", None, false),
    ("teamlead_interpreter", "allergies", "hidden", None, false),
    ("teamlead_interpreter", "vitals", "hidden", None, false),
    (
        "teamlead_interpreter",
        "internal_notes",
        "hidden",
        None,
        false,
    ),
    ("teamlead_interpreter", "travel_data", "full", None, false),
    (
        "teamlead_interpreter",
        "functional_labels",
        "full",
        None,
        false,
    ),
    ("interpreter", "name", "full", None, false),
    ("interpreter", "birth_date", "full", None, false),
    ("interpreter", "phone", "full", None, false),
    ("interpreter", "email", "masked", None, false),
    ("interpreter", "nationality", "full", None, false),
    ("interpreter", "languages", "full", None, false),
    ("interpreter", "insurance", "hidden", None, false),
    (
        "interpreter",
        "diagnosis",
        "conditional",
        Some("assigned_appointment"),
        false,
    ),
    (
        "interpreter",
        "medications",
        "conditional",
        Some("assigned_appointment"),
        false,
    ),
    (
        "interpreter",
        "allergies",
        "conditional",
        Some("assigned_appointment"),
        false,
    ),
    ("interpreter", "vitals", "hidden", None, false),
    ("interpreter", "internal_notes", "hidden", None, false),
    ("interpreter", "travel_data", "hidden", None, false),
    ("interpreter", "functional_labels", "full", None, false),
    ("concierge", "name", "full", None, false),
    ("concierge", "birth_date", "full", None, false),
    ("concierge", "phone", "full", None, false),
    ("concierge", "email", "full", None, false),
    ("concierge", "nationality", "full", None, false),
    ("concierge", "languages", "full", None, false),
    ("concierge", "insurance", "hidden", None, false),
    ("concierge", "diagnosis", "hidden", None, true),
    ("concierge", "medications", "hidden", None, true),
    ("concierge", "allergies", "hidden", None, true),
    ("concierge", "vitals", "hidden", None, true),
    ("concierge", "internal_notes", "hidden", None, false),
    ("concierge", "travel_data", "full", None, false),
    ("concierge", "functional_labels", "full", None, false),
    ("billing", "name", "full", None, false),
    ("billing", "birth_date", "full", None, false),
    ("billing", "phone", "full", None, false),
    ("billing", "email", "full", None, false),
    ("billing", "nationality", "full", None, false),
    ("billing", "languages", "hidden", None, false),
    ("billing", "insurance", "full", None, false),
    ("billing", "diagnosis", "hidden", None, true),
    ("billing", "medications", "hidden", None, true),
    ("billing", "allergies", "hidden", None, true),
    ("billing", "vitals", "hidden", None, true),
    ("billing", "internal_notes", "hidden", None, false),
    ("billing", "travel_data", "hidden", None, false),
    ("billing", "functional_labels", "hidden", None, false),
    ("sales", "name", "hidden", None, false),
    ("sales", "birth_date", "hidden", None, false),
    ("sales", "phone", "hidden", None, false),
    ("sales", "email", "hidden", None, false),
    ("sales", "nationality", "hidden", None, false),
    ("sales", "languages", "hidden", None, false),
    ("sales", "insurance", "hidden", None, false),
    ("sales", "diagnosis", "hidden", None, true),
    ("sales", "medications", "hidden", None, true),
    ("sales", "allergies", "hidden", None, true),
    ("sales", "vitals", "hidden", None, true),
    ("sales", "internal_notes", "hidden", None, false),
    ("sales", "travel_data", "hidden", None, false),
    ("sales", "functional_labels", "hidden", None, false),
    ("patient", "name", "conditional", Some("freigegeben"), false),
    (
        "patient",
        "birth_date",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "phone",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "email",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "nationality",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "languages",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "insurance",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "diagnosis",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "medications",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "allergies",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    (
        "patient",
        "vitals",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    ("patient", "internal_notes", "hidden", None, true),
    (
        "patient",
        "travel_data",
        "conditional",
        Some("freigegeben"),
        false,
    ),
    ("patient", "functional_labels", "hidden", None, false),
    ("ceo_assistant", "name", "full", None, false),
    ("ceo_assistant", "birth_date", "full", None, false),
    ("ceo_assistant", "phone", "full", None, false),
    ("ceo_assistant", "email", "full", None, false),
    ("ceo_assistant", "nationality", "full", None, false),
    ("ceo_assistant", "languages", "full", None, false),
    ("ceo_assistant", "insurance", "hidden", None, false),
    ("ceo_assistant", "diagnosis", "hidden", None, true),
    ("ceo_assistant", "medications", "hidden", None, true),
    ("ceo_assistant", "allergies", "hidden", None, true),
    ("ceo_assistant", "vitals", "hidden", None, true),
    ("ceo_assistant", "internal_notes", "hidden", None, false),
    ("ceo_assistant", "travel_data", "full", None, false),
    ("ceo_assistant", "functional_labels", "hidden", None, false),
];

async fn ensure_patient_policy_defaults(
    state: &AppState,
    updated_by: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut restored = 0;
    for &(role, field_name, access_level, condition_type, is_system_locked) in
        DEFAULT_PATIENT_POLICIES
    {
        let result = sqlx::query(
            r#"
            INSERT INTO field_access_policies (
                role,
                entity_type,
                field_name,
                access_level,
                condition_type,
                is_system_locked,
                updated_by,
                updated_at
            )
            VALUES ($1, 'patient', $2, $3, $4, $5, $6, now())
            ON CONFLICT (role, entity_type, field_name) DO NOTHING
            "#,
        )
        .bind(role)
        .bind(field_name)
        .bind(access_level)
        .bind(condition_type)
        .bind(is_system_locked)
        .bind(updated_by)
        .execute(&state.db)
        .await?;
        restored += result.rows_affected();
    }
    Ok(restored)
}

async fn list_policies(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::ItAdmin])?;

    let entity_filter = query.entity_type.as_deref();
    let role_filter = query.role.as_deref();

    if entity_filter == Some("patient") {
        match ensure_patient_policy_defaults(&state, auth.user_id).await {
            Ok(restored) if restored > 0 => {
                tracing::warn!(restored, "Repaired missing patient access policy defaults");
            }
            Ok(_) => {}
            Err(e) => {
                tracing::error!(error = %e, "Failed to repair patient access policy defaults");
                return Err(err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to repair patient access policy defaults",
                ));
            }
        }
    }

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
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "access_policy.updated",
        "access_policy",
        row.id,
        serde_json::json!({
            "role": body.role,
            "entity_type": body.entity_type,
            "field_name": body.field_name,
        }),
    )
    .await;

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

    if body.entity_type != "patient" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only patient access policies can be reset",
        );
    }

    let result = sqlx::query(
        r#"
        WITH deleted AS (
            DELETE FROM field_access_policies
            WHERE entity_type = $1 AND NOT is_system_locked
            RETURNING 1
        ),
        defaults(role, entity_type, field_name, access_level, condition_type, is_system_locked) AS (
            VALUES
                ('patient_manager', 'patient', 'name', 'full', NULL, false),
                ('patient_manager', 'patient', 'birth_date', 'full', NULL, false),
                ('patient_manager', 'patient', 'phone', 'full', NULL, false),
                ('patient_manager', 'patient', 'email', 'full', NULL, false),
                ('patient_manager', 'patient', 'nationality', 'full', NULL, false),
                ('patient_manager', 'patient', 'languages', 'full', NULL, false),
                ('patient_manager', 'patient', 'insurance', 'full', NULL, false),
                ('patient_manager', 'patient', 'diagnosis', 'full', NULL, false),
                ('patient_manager', 'patient', 'medications', 'full', NULL, false),
                ('patient_manager', 'patient', 'allergies', 'full', NULL, false),
                ('patient_manager', 'patient', 'vitals', 'full', NULL, false),
                ('patient_manager', 'patient', 'internal_notes', 'full', NULL, false),
                ('patient_manager', 'patient', 'travel_data', 'full', NULL, false),
                ('patient_manager', 'patient', 'functional_labels', 'full', NULL, false),

                ('teamlead_interpreter', 'patient', 'name', 'full', NULL, false),
                ('teamlead_interpreter', 'patient', 'birth_date', 'full', NULL, false),
                ('teamlead_interpreter', 'patient', 'phone', 'full', NULL, false),
                ('teamlead_interpreter', 'patient', 'email', 'full', NULL, false),
                ('teamlead_interpreter', 'patient', 'nationality', 'full', NULL, false),
                ('teamlead_interpreter', 'patient', 'languages', 'full', NULL, false),
                ('teamlead_interpreter', 'patient', 'insurance', 'hidden', NULL, false),
                ('teamlead_interpreter', 'patient', 'diagnosis', 'hidden', NULL, false),
                ('teamlead_interpreter', 'patient', 'medications', 'hidden', NULL, false),
                ('teamlead_interpreter', 'patient', 'allergies', 'hidden', NULL, false),
                ('teamlead_interpreter', 'patient', 'vitals', 'hidden', NULL, false),
                ('teamlead_interpreter', 'patient', 'internal_notes', 'hidden', NULL, false),
                ('teamlead_interpreter', 'patient', 'travel_data', 'full', NULL, false),
                ('teamlead_interpreter', 'patient', 'functional_labels', 'full', NULL, false),

                ('interpreter', 'patient', 'name', 'full', NULL, false),
                ('interpreter', 'patient', 'birth_date', 'full', NULL, false),
                ('interpreter', 'patient', 'phone', 'full', NULL, false),
                ('interpreter', 'patient', 'email', 'masked', NULL, false),
                ('interpreter', 'patient', 'nationality', 'full', NULL, false),
                ('interpreter', 'patient', 'languages', 'full', NULL, false),
                ('interpreter', 'patient', 'insurance', 'hidden', NULL, false),
                ('interpreter', 'patient', 'diagnosis', 'conditional', 'assigned_appointment', false),
                ('interpreter', 'patient', 'medications', 'conditional', 'assigned_appointment', false),
                ('interpreter', 'patient', 'allergies', 'conditional', 'assigned_appointment', false),
                ('interpreter', 'patient', 'vitals', 'hidden', NULL, false),
                ('interpreter', 'patient', 'internal_notes', 'hidden', NULL, false),
                ('interpreter', 'patient', 'travel_data', 'hidden', NULL, false),
                ('interpreter', 'patient', 'functional_labels', 'full', NULL, false),

                ('concierge', 'patient', 'name', 'full', NULL, false),
                ('concierge', 'patient', 'birth_date', 'full', NULL, false),
                ('concierge', 'patient', 'phone', 'full', NULL, false),
                ('concierge', 'patient', 'email', 'full', NULL, false),
                ('concierge', 'patient', 'nationality', 'full', NULL, false),
                ('concierge', 'patient', 'languages', 'full', NULL, false),
                ('concierge', 'patient', 'insurance', 'hidden', NULL, false),
                ('concierge', 'patient', 'diagnosis', 'hidden', NULL, true),
                ('concierge', 'patient', 'medications', 'hidden', NULL, true),
                ('concierge', 'patient', 'allergies', 'hidden', NULL, true),
                ('concierge', 'patient', 'vitals', 'hidden', NULL, true),
                ('concierge', 'patient', 'internal_notes', 'hidden', NULL, false),
                ('concierge', 'patient', 'travel_data', 'full', NULL, false),
                ('concierge', 'patient', 'functional_labels', 'full', NULL, false),

                ('billing', 'patient', 'name', 'full', NULL, false),
                ('billing', 'patient', 'birth_date', 'full', NULL, false),
                ('billing', 'patient', 'phone', 'full', NULL, false),
                ('billing', 'patient', 'email', 'full', NULL, false),
                ('billing', 'patient', 'nationality', 'full', NULL, false),
                ('billing', 'patient', 'languages', 'hidden', NULL, false),
                ('billing', 'patient', 'insurance', 'full', NULL, false),
                ('billing', 'patient', 'diagnosis', 'hidden', NULL, true),
                ('billing', 'patient', 'medications', 'hidden', NULL, true),
                ('billing', 'patient', 'allergies', 'hidden', NULL, true),
                ('billing', 'patient', 'vitals', 'hidden', NULL, true),
                ('billing', 'patient', 'internal_notes', 'hidden', NULL, false),
                ('billing', 'patient', 'travel_data', 'hidden', NULL, false),
                ('billing', 'patient', 'functional_labels', 'hidden', NULL, false),

                ('sales', 'patient', 'name', 'hidden', NULL, false),
                ('sales', 'patient', 'birth_date', 'hidden', NULL, false),
                ('sales', 'patient', 'phone', 'hidden', NULL, false),
                ('sales', 'patient', 'email', 'hidden', NULL, false),
                ('sales', 'patient', 'nationality', 'hidden', NULL, false),
                ('sales', 'patient', 'languages', 'hidden', NULL, false),
                ('sales', 'patient', 'insurance', 'hidden', NULL, false),
                ('sales', 'patient', 'diagnosis', 'hidden', NULL, true),
                ('sales', 'patient', 'medications', 'hidden', NULL, true),
                ('sales', 'patient', 'allergies', 'hidden', NULL, true),
                ('sales', 'patient', 'vitals', 'hidden', NULL, true),
                ('sales', 'patient', 'internal_notes', 'hidden', NULL, false),
                ('sales', 'patient', 'travel_data', 'hidden', NULL, false),
                ('sales', 'patient', 'functional_labels', 'hidden', NULL, false),

                ('patient', 'patient', 'name', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'birth_date', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'phone', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'email', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'nationality', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'languages', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'insurance', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'diagnosis', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'medications', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'allergies', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'vitals', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'internal_notes', 'hidden', NULL, true),
                ('patient', 'patient', 'travel_data', 'conditional', 'freigegeben', false),
                ('patient', 'patient', 'functional_labels', 'hidden', NULL, false),

                ('ceo_assistant', 'patient', 'name', 'full', NULL, false),
                ('ceo_assistant', 'patient', 'birth_date', 'full', NULL, false),
                ('ceo_assistant', 'patient', 'phone', 'full', NULL, false),
                ('ceo_assistant', 'patient', 'email', 'full', NULL, false),
                ('ceo_assistant', 'patient', 'nationality', 'full', NULL, false),
                ('ceo_assistant', 'patient', 'languages', 'full', NULL, false),
                ('ceo_assistant', 'patient', 'insurance', 'hidden', NULL, false),
                ('ceo_assistant', 'patient', 'diagnosis', 'hidden', NULL, true),
                ('ceo_assistant', 'patient', 'medications', 'hidden', NULL, true),
                ('ceo_assistant', 'patient', 'allergies', 'hidden', NULL, true),
                ('ceo_assistant', 'patient', 'vitals', 'hidden', NULL, true),
                ('ceo_assistant', 'patient', 'internal_notes', 'hidden', NULL, false),
                ('ceo_assistant', 'patient', 'travel_data', 'full', NULL, false),
                ('ceo_assistant', 'patient', 'functional_labels', 'hidden', NULL, false)
        )
        INSERT INTO field_access_policies (
            role,
            entity_type,
            field_name,
            access_level,
            condition_type,
            is_system_locked,
            updated_by,
            updated_at
        )
        SELECT role, entity_type, field_name, access_level, condition_type, is_system_locked, $2, now()
        FROM defaults
        WHERE entity_type = $1
        ON CONFLICT (role, entity_type, field_name) DO UPDATE
        SET access_level = EXCLUDED.access_level,
            condition_type = EXCLUDED.condition_type,
            is_system_locked = EXCLUDED.is_system_locked,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
        "#,
    )
    .bind(&body.entity_type)
    .bind(auth.user_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) => {
            tracing::info!(by = %auth.user_id, entity = %body.entity_type, restored = r.rows_affected(), "Access policies reset to defaults");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "access_policy.reset",
                "access_policy",
                auth.user_id,
                serde_json::json!({
                    "entity_type": body.entity_type,
                    "restored": r.rows_affected(),
                }),
            )
            .await;
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
