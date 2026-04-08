use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

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
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin, Role::PatientManager, Role::Sales]) {
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
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
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
            let _ = sqlx::query!(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'create_custom_field', 'custom_field', $2, $3)",
                auth.user_id, r.id, serde_json::json!({"entity_type": body.entity_type, "field_key": body.field_key})
            ).execute(&state.db).await;
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
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let ft = body.field_type.as_deref().unwrap_or("text");

    match sqlx::query!(
        "UPDATE custom_fields SET field_label=$2, field_type=$3, options=$4, is_required=$5, sort_order=$6, is_active=true WHERE id=$1",
        id, body.field_label, ft, body.options, body.is_required.unwrap_or(false), body.sort_order.unwrap_or(0)
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => Json(serde_json::json!({"ok": true})).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "Field not found"),
        Err(e) => { tracing::error!(error = %e, "update custom field"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn delete_field(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let _ = sqlx::query!(
        "UPDATE custom_fields SET is_active = false WHERE id = $1",
        id
    )
    .execute(&state.db)
    .await;
    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1, 'delete_custom_field', 'custom_field', $2)",
        auth.user_id, id
    ).execute(&state.db).await;
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn get_values(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(entity_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::ItAdmin]) {
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
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::ItAdmin]) {
        return e;
    }

    for fv in &body.values {
        let _ = sqlx::query!(
            "INSERT INTO custom_field_values (field_id, entity_id, value) VALUES ($1, $2, $3)
             ON CONFLICT (field_id, entity_id) DO UPDATE SET value = $3, updated_at = now()",
            fv.field_id,
            entity_id,
            fv.value
        )
        .execute(&state.db)
        .await;
    }

    Json(serde_json::json!({"ok": true})).into_response()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"error": status.canonical_reason().unwrap_or("error"), "message": message}))).into_response()
}
