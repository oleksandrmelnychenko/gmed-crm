use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/custom-fields", get(list_fields).post(create_field))
        .route("/admin/custom-fields/{id}/update", post(update_field))
        .route("/admin/custom-fields/{id}/delete", post(delete_field))
        .route(
            "/custom-fields/values/{entity_id}",
            get(get_values).post(set_values),
        )
}

#[derive(Deserialize)]
struct ListQuery {
    entity_type: Option<String>,
}

async fn list_fields(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<ListQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_capability(&[
        Capability::AdminCustomFields,
        Capability::PatientsEdit,
        Capability::LeadsEdit,
    ]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT id, entity_type, field_key, field_label, field_type, options, is_required, sort_order, is_active
           FROM custom_fields
           WHERE ($1::TEXT IS NULL OR entity_type = $1)
           ORDER BY entity_type, sort_order, field_label"#,
        q.entity_type
    ).fetch_all(&state.db).await {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
                "id": r.id, "entity_type": r.entity_type, "field_key": r.field_key,
                "field_label": r.field_label, "field_type": r.field_type,
                "options": r.options, "is_required": r.is_required,
                "sort_order": r.sort_order, "is_active": r.is_active,
            })).collect();
            Json(data).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "list custom fields"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

#[derive(Deserialize)]
struct UpsertField {
    entity_type: String,
    field_key: String,
    field_label: String,
    field_type: Option<String>,
    options: Option<serde_json::Value>,
    is_required: Option<bool>,
    sort_order: Option<i32>,
}

async fn create_field(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertField>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminCustomFields) {
        return e;
    }

    let ft = body.field_type.as_deref().unwrap_or("text");

    match sqlx::query!(
        "INSERT INTO custom_fields (entity_type, field_key, field_label, field_type, options, is_required, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        body.entity_type, body.field_key, body.field_label, ft,
        body.options, body.is_required.unwrap_or(false),
        body.sort_order.unwrap_or(0), auth.user_id
    ).fetch_one(&state.db).await {
        Ok(r) => {
            state.audit_sender.try_send(audit::domain_event(
                "create_custom_field",
                Some(auth.user_id),
                "custom_field",
                Some(r.id),
                serde_json::json!({
                    "entity_type": body.entity_type,
                    "field_key": body.field_key,
                }),
            ));
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "custom_field.created",
                "custom_field",
                r.id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true, "id": r.id})).into_response()
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("duplicate") || msg.contains("unique") {
                err(StatusCode::CONFLICT, "Field key already exists for this entity type")
            } else {
                tracing::error!(error = %e, "create custom field");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
            }
        }
    }
}

async fn update_field(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertField>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminCustomFields) {
        return e;
    }

    let ft = body.field_type.as_deref().unwrap_or("text");

    match sqlx::query!(
        "UPDATE custom_fields SET field_label=$2, field_type=$3, options=$4, is_required=$5, sort_order=$6, is_active=true WHERE id=$1",
        id, body.field_label, ft, body.options, body.is_required.unwrap_or(false), body.sort_order.unwrap_or(0)
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "custom_field.updated",
                "custom_field",
                id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Field not found"),
        Err(e) => { tracing::error!(error = %e, "update custom field"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn delete_field(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminCustomFields) {
        return e;
    }

    match sqlx::query(
        "UPDATE custom_fields SET is_active = false WHERE id = $1 AND is_active = true",
    )
    .bind(id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Field not found"),
        Err(e) => {
            tracing::error!(error = %e, "delete custom field");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    state.audit_sender.try_send(audit::domain_event(
        "delete_custom_field",
        Some(auth.user_id),
        "custom_field",
        Some(id),
        serde_json::json!({}),
    ));
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "custom_field.deleted",
        "custom_field",
        id,
        serde_json::json!({}),
    )
    .await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn get_values(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(entity_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = authorize_values_access(&state, &auth, entity_id, false).await {
        return e;
    }

    match sqlx::query!(
        r#"SELECT cfv.field_id, cf.field_key, cf.field_label, cf.field_type, cfv.value
           FROM custom_field_values cfv
           JOIN custom_fields cf ON cf.id = cfv.field_id
           WHERE cfv.entity_id = $1 AND cf.is_active = true
           ORDER BY cf.sort_order"#,
        entity_id
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "field_id": r.field_id, "field_key": r.field_key,
                        "field_label": r.field_label, "field_type": r.field_type, "value": r.value,
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "get custom field values");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

#[derive(Deserialize)]
struct SetValuesReq {
    values: Vec<FieldValue>,
}
#[derive(Deserialize)]
struct FieldValue {
    field_id: Uuid,
    value: Option<String>,
}

async fn set_values(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(entity_id): Path<Uuid>,
    Json(body): Json<SetValuesReq>,
) -> axum::response::Response {
    let entity_type = match authorize_values_access(&state, &auth, entity_id, true).await {
        Ok(value) => value,
        Err(e) => return e,
    };

    // Only active fields defined for this entity type may carry its values.
    let field_ids: Vec<Uuid> = body
        .values
        .iter()
        .map(|fv| fv.field_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM custom_fields
         WHERE id = ANY($1) AND entity_type = $2 AND is_active = true",
    )
    .bind(&field_ids)
    .bind(entity_type)
    .fetch_one(&state.db)
    .await
    {
        Ok(known) if known == field_ids.len() as i64 => {}
        Ok(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Unknown custom field for this entity",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, entity_id = %entity_id, "validate custom field ids");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    for fv in &body.values {
        if let Err(e) = sqlx::query!(
            "INSERT INTO custom_field_values (field_id, entity_id, value) VALUES ($1, $2, $3)
             ON CONFLICT (field_id, entity_id) DO UPDATE SET value = $3, updated_at = now()",
            fv.field_id,
            entity_id,
            fv.value
        )
        .execute(&state.db)
        .await
        {
            tracing::error!(error = %e, field_id = %fv.field_id, entity_id = %entity_id, "set custom field value");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    // Field ids only: the values may be personal data.
    state.audit_sender.try_send(audit::domain_event(
        "set_custom_field_values",
        Some(auth.user_id),
        entity_type,
        Some(entity_id),
        serde_json::json!({ "field_ids": field_ids }),
    ));

    Json(serde_json::json!({"ok": true})).into_response()
}

/// Object scope of custom field VALUES. The entity is resolved as a patient
/// (`patients.edit` plus the canonical patient access rule; writes also need
/// the edit rule with the Art. 18 / Art. 17 DSGVO lock) or as a lead
/// (`leads.edit`, the rule of the lead routes; a converted lead is frozen).
/// `admin.custom_fields` manages field definitions only and opens no values.
/// Any other entity is refused with 404. Returns the entity type.
async fn authorize_values_access(
    state: &AppState,
    auth: &AuthUser,
    entity_id: Uuid,
    write: bool,
) -> Result<&'static str, axum::response::Response> {
    auth.require_any_capability(&[Capability::PatientsEdit, Capability::LeadsEdit])?;

    let is_patient =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(entity_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, entity_id = %entity_id, "resolve custom field entity");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
            })?;
    if is_patient {
        auth.require_capability(Capability::PatientsEdit)?;
        if !crate::routes::patients::has_patient_access(state, auth, entity_id).await? {
            return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
        }
        if write
            && !crate::routes::patients::has_patient_edit_access(state, auth, entity_id).await?
        {
            return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
        }
        return Ok("patient");
    }

    let lead = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT converted_patient_id FROM leads WHERE id = $1",
    )
    .bind(entity_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, entity_id = %entity_id, "resolve custom field entity");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    match lead {
        None => Err(err(StatusCode::NOT_FOUND, "Entity not found")),
        Some(converted_patient_id) => {
            auth.require_capability(Capability::LeadsEdit)?;
            if write && converted_patient_id.is_some() {
                return Err(err(
                    StatusCode::CONFLICT,
                    "Converted lead must use its patient context",
                ));
            }
            Ok("lead")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message}))).into_response()
}
