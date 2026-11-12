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

const ENTITY_TYPES: &[&str] = &["lead", "patient", "order", "provider"];
const FIELD_TYPES: &[&str] = &["text", "number", "date", "boolean", "select"];
const MAX_KEY_LEN: usize = 63;
const MAX_LABEL_LEN: usize = 120;
const MAX_OPTIONS: usize = 100;
const MAX_OPTION_LEN: usize = 200;

/// A refusal with a stable code the page translates (screens QA 2026-11-12,
/// E F8/F9: English text and a 500 "Failed" for an unknown type).
type FieldRefusal = (StatusCode, &'static str, &'static str);

/// `[a-z][a-z0-9_]*`, at most 63 characters (E F9: «Bad Key! ä» was saved).
fn valid_field_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase())
        && key.len() <= MAX_KEY_LEN
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
}

/// The checked definition: trimmed label, known type, and for a list the
/// trimmed, non-empty, unique options (other types keep no options).
fn validated_definition(
    body: &UpsertField,
) -> Result<(String, &'static str, Option<serde_json::Value>), FieldRefusal> {
    let label = body.field_label.trim().to_string();
    if label.is_empty() || label.chars().count() > MAX_LABEL_LEN {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "custom_field_label_invalid",
            "Field label is required (at most 120 characters)",
        ));
    }
    let requested = body.field_type.as_deref().unwrap_or("text").trim();
    let Some(field_type) = FIELD_TYPES.iter().copied().find(|ft| *ft == requested) else {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "custom_field_type_invalid",
            "Unknown field type",
        ));
    };
    if field_type != "select" {
        return Ok((label, field_type, None));
    }
    let mut options: Vec<String> = Vec::new();
    if let Some(serde_json::Value::Array(items)) = &body.options {
        for item in items {
            let Some(text) = item.as_str().map(str::trim) else {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "custom_field_options_invalid",
                    "List options must be texts",
                ));
            };
            if text.is_empty() {
                continue;
            }
            if text.chars().count() > MAX_OPTION_LEN {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "custom_field_options_invalid",
                    "List option is too long",
                ));
            }
            if !options.iter().any(|known| known == text) {
                options.push(text.to_string());
            }
        }
    }
    if options.is_empty() || options.len() > MAX_OPTIONS {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "custom_field_options_required",
            "A list field needs 1 to 100 options",
        ));
    }
    Ok((label, field_type, Some(serde_json::json!(options))))
}

async fn create_field(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertField>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminCustomFields) {
        return e;
    }

    let entity_type = body.entity_type.trim().to_string();
    if !ENTITY_TYPES.contains(&entity_type.as_str()) {
        return coded_err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "custom_field_entity_invalid",
            "Unknown entity type",
        );
    }
    let field_key = body.field_key.trim().to_string();
    if !valid_field_key(&field_key) {
        return coded_err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "custom_field_key_invalid",
            "Field key: lowercase latin letters, digits and _, starting with a letter",
        );
    }
    let (label, field_type, options) = match validated_definition(&body) {
        Ok(value) => value,
        Err((status, code, message)) => return coded_err(status, code, message),
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin create custom field");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    // A deleted field keeps its row (and the values stored under it); its
    // key is renamed so the key can be used again (E F7). The new field
    // starts empty, nothing of the old one comes back.
    if let Err(e) = sqlx::query(
        "UPDATE custom_fields
            SET field_key = field_key || '~deleted~' || left(id::text, 8)
          WHERE entity_type = $1 AND field_key = $2 AND is_active = false",
    )
    .bind(&entity_type)
    .bind(&field_key)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "free deleted custom field key");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO custom_fields (entity_type, field_key, field_label, field_type, options, is_required, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    )
    .bind(&entity_type)
    .bind(&field_key)
    .bind(&label)
    .bind(field_type)
    .bind(&options)
    .bind(body.is_required.unwrap_or(false))
    .bind(body.sort_order.unwrap_or(0))
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await;
    let id = match inserted {
        Ok(id) => id,
        Err(e) => {
            if e.as_database_error()
                .is_some_and(|db| db.is_unique_violation())
            {
                return coded_err(
                    StatusCode::CONFLICT,
                    "custom_field_key_exists",
                    "Field key already exists for this entity type",
                );
            }
            tracing::error!(error = %e, "create custom field");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "commit create custom field");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "create_custom_field",
        Some(auth.user_id),
        "custom_field",
        Some(id),
        serde_json::json!({
            "entity_type": entity_type,
            "field_key": field_key,
        }),
    ));
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "custom_field.created",
        "custom_field",
        id,
        serde_json::json!({}),
    )
    .await;
    Json(serde_json::json!({"ok": true, "id": id})).into_response()
}

/// Label, type, options, «Обязательное» and order of an active field. Entity
/// and key stay as created; a deleted field is not brought back by an edit.
async fn update_field(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertField>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminCustomFields) {
        return e;
    }

    let (label, field_type, options) = match validated_definition(&body) {
        Ok(value) => value,
        Err((status, code, message)) => return coded_err(status, code, message),
    };

    match sqlx::query(
        "UPDATE custom_fields
            SET field_label = $2, field_type = $3, options = $4, is_required = $5, sort_order = $6
          WHERE id = $1 AND is_active = true",
    )
    .bind(id)
    .bind(&label)
    .bind(field_type)
    .bind(&options)
    .bind(body.is_required.unwrap_or(false))
    .bind(body.sort_order.unwrap_or(0))
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "update_custom_field",
                Some(auth.user_id),
                "custom_field",
                Some(id),
                serde_json::json!({ "field_type": field_type }),
            ));
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
        Ok(_) => coded_err(
            StatusCode::NOT_FOUND,
            "custom_field_not_found",
            "Field not found",
        ),
        Err(e) => {
            tracing::error!(error = %e, "update custom field");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
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
        Ok(_) => {
            return coded_err(
                StatusCode::NOT_FOUND,
                "custom_field_not_found",
                "Field not found",
            );
        }
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

fn coded_err(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::{UpsertField, valid_field_key, validated_definition};
    use serde_json::json;

    fn field(field_type: &str, options: Option<serde_json::Value>) -> UpsertField {
        UpsertField {
            entity_type: "lead".to_string(),
            field_key: "preferred_clinic".to_string(),
            field_label: "  Bevorzugte Klinik ".to_string(),
            field_type: Some(field_type.to_string()),
            options,
            is_required: Some(true),
            sort_order: Some(1),
        }
    }

    #[test]
    fn field_keys_are_lowercase_latin_with_digits_and_underscores() {
        assert!(valid_field_key("qa_e_preferred_clinic"));
        assert!(valid_field_key("clinic2"));
        for bad in [
            "",
            "Bad Key! ä",
            "2clinic",
            "_clinic",
            "clinic-name",
            "Clinic",
            "ä",
        ] {
            assert!(!valid_field_key(bad), "{bad}");
        }
        assert!(!valid_field_key(&"a".repeat(64)));
    }

    #[test]
    fn definitions_are_checked_and_trimmed() {
        let (label, field_type, options) = validated_definition(&field(
            "select",
            Some(json!([" Charité ", "Vivantes", "", "Vivantes"])),
        ))
        .expect("valid list");
        assert_eq!(label, "Bevorzugte Klinik");
        assert_eq!(field_type, "select");
        assert_eq!(options, Some(json!(["Charité", "Vivantes"])));

        let (_, _, options) =
            validated_definition(&field("text", Some(json!(["x"])))).expect("valid text");
        assert_eq!(options, None);

        let refused = |body: UpsertField| validated_definition(&body).err().map(|r| r.1);
        assert_eq!(
            refused(field("color", None)),
            Some("custom_field_type_invalid")
        );
        assert_eq!(
            refused(field("select", None)),
            Some("custom_field_options_required")
        );
        assert_eq!(
            refused(field("select", Some(json!([1, 2])))),
            Some("custom_field_options_invalid")
        );
        let mut empty_label = field("text", None);
        empty_label.field_label = "   ".to_string();
        assert_eq!(refused(empty_label), Some("custom_field_label_invalid"));
    }
}
