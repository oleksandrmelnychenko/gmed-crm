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

/// Every active field of the entity's type with its stored value (`null`
/// when none), for the «Дополнительные поля» section of the staff lead card
/// and patient card (owner decision 2026-11-12, screens QA item 3).
/// «Обязательное» is only reported, never enforced. `can_edit` tells the card
/// whether this user may change the values now (the rule of the write).
async fn get_values(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(entity_id): Path<Uuid>,
) -> axum::response::Response {
    let scope = match authorize_values_access(&state, &auth, entity_id, false).await {
        Ok(scope) => scope,
        Err(e) => return e,
    };
    let can_edit = match scope.entity_type {
        "patient" => {
            auth.can(Capability::PatientsEdit)
                && matches!(
                    crate::routes::patients::has_patient_edit_access(&state, &auth, entity_id)
                        .await,
                    Ok(true)
                )
        }
        _ => auth.can(Capability::LeadsEdit) && scope.converted_patient_id.is_none(),
    };

    type FieldRow = (
        Uuid,
        String,
        String,
        String,
        Option<serde_json::Value>,
        bool,
        i32,
        Option<String>,
    );
    match sqlx::query_as::<_, FieldRow>(
        r#"SELECT cf.id, cf.field_key, cf.field_label, cf.field_type, cf.options,
                  cf.is_required, cf.sort_order, cfv.value
           FROM custom_fields cf
           LEFT JOIN custom_field_values cfv
                  ON cfv.field_id = cf.id AND cfv.entity_id = $1
           WHERE cf.entity_type = $2 AND cf.is_active = true
           ORDER BY cf.sort_order, cf.field_label, cf.id"#,
    )
    .bind(entity_id)
    .bind(scope.entity_type)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let fields: Vec<serde_json::Value> = rows
                .into_iter()
                .map(
                    |(id, key, label, field_type, options, is_required, sort_order, value)| {
                        serde_json::json!({
                            "field_id": id, "field_key": key, "field_label": label,
                            "field_type": field_type, "options": options,
                            "is_required": is_required, "sort_order": sort_order,
                            "value": value,
                        })
                    },
                )
                .collect();
            Json(serde_json::json!({
                "entity_type": scope.entity_type,
                "can_edit": can_edit,
                "fields": fields,
            }))
            .into_response()
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

const MAX_VALUE_LEN: usize = 2000;

/// The stored form of one value, checked against its field. Empty (or only
/// spaces) clears the value. A date is stored as `YYYY-MM-DD` (the card shows
/// DD.MM.YYYY, which is accepted too), a checkbox as `true`/`false`, a number
/// with a decimal point (a decimal comma is accepted), a list value must be
/// one of the field's options. «Обязательное» is not checked here.
fn normalized_value(
    field_type: &str,
    options: Option<&serde_json::Value>,
    raw: Option<&str>,
) -> Result<Option<String>, &'static str> {
    let Some(text) = raw.map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    if text.chars().count() > MAX_VALUE_LEN {
        return Err("custom_field_value_too_long");
    }
    match field_type {
        "number" => {
            let candidate = text.replace(',', ".");
            let plain = candidate
                .chars()
                .all(|ch| ch.is_ascii_digit() || matches!(ch, '.' | '-' | '+'));
            match candidate.parse::<f64>() {
                Ok(number) if plain && number.is_finite() => Ok(Some(candidate)),
                _ => Err("custom_field_value_number_invalid"),
            }
        }
        "date" => chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
            .or_else(|_| chrono::NaiveDate::parse_from_str(text, "%d.%m.%Y"))
            .map(|date| Some(date.format("%Y-%m-%d").to_string()))
            .map_err(|_| "custom_field_value_date_invalid"),
        "boolean" => match text {
            "true" | "false" => Ok(Some(text.to_string())),
            _ => Err("custom_field_value_boolean_invalid"),
        },
        "select" => {
            let known = options
                .and_then(serde_json::Value::as_array)
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(text)));
            if known {
                Ok(Some(text.to_string()))
            } else {
                Err("custom_field_value_option_invalid")
            }
        }
        _ => Ok(Some(text.to_string())),
    }
}

/// A refused value with its code and the field it belongs to.
fn value_refusal(code: &str, field_id: Uuid) -> axum::response::Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(serde_json::json!({
            "error": code,
            "code": code,
            "message": "Invalid custom field value",
            "field_id": field_id,
        })),
    )
        .into_response()
}

async fn set_values(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(entity_id): Path<Uuid>,
    Json(body): Json<SetValuesReq>,
) -> axum::response::Response {
    let scope = match authorize_values_access(&state, &auth, entity_id, true).await {
        Ok(scope) => scope,
        Err(e) => return e,
    };
    let entity_type = scope.entity_type;
    if body.values.is_empty() {
        return Json(serde_json::json!({"ok": true})).into_response();
    }

    // Only active fields defined for this entity type may carry its values.
    let field_ids: Vec<Uuid> = body
        .values
        .iter()
        .map(|fv| fv.field_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    if field_ids.len() != body.values.len() {
        return coded_err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "custom_field_value_duplicate",
            "A field is named twice",
        );
    }
    type Definition = (Uuid, String, String, Option<serde_json::Value>);
    let definitions = match sqlx::query_as::<_, Definition>(
        "SELECT id, field_key, field_type, options FROM custom_fields
         WHERE id = ANY($1) AND entity_type = $2 AND is_active = true",
    )
    .bind(&field_ids)
    .bind(entity_type)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) if rows.len() == field_ids.len() => rows,
        Ok(_) => {
            return coded_err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "custom_field_not_found",
                "Unknown custom field for this entity",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, entity_id = %entity_id, "validate custom field ids");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let mut checked: Vec<(Uuid, &str, Option<String>)> = Vec::with_capacity(body.values.len());
    for fv in &body.values {
        let Some((_, field_key, field_type, options)) =
            definitions.iter().find(|(id, _, _, _)| *id == fv.field_id)
        else {
            return value_refusal("custom_field_not_found", fv.field_id);
        };
        match normalized_value(field_type, options.as_ref(), fv.value.as_deref()) {
            Ok(value) => checked.push((fv.field_id, field_key.as_str(), value)),
            Err(code) => return value_refusal(code, fv.field_id),
        }
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin set custom field values");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    for (field_id, _, value) in &checked {
        let written = match value {
            Some(value) => {
                sqlx::query(
                    "INSERT INTO custom_field_values (field_id, entity_id, value) VALUES ($1, $2, $3)
                     ON CONFLICT (field_id, entity_id) DO UPDATE SET value = $3, updated_at = now()",
                )
                .bind(*field_id)
                .bind(entity_id)
                .bind(value)
                .execute(&mut *tx)
                .await
            }
            None => {
                sqlx::query(
                    "DELETE FROM custom_field_values WHERE field_id = $1 AND entity_id = $2",
                )
                .bind(*field_id)
                .bind(entity_id)
                .execute(&mut *tx)
                .await
            }
        };
        if let Err(e) = written {
            tracing::error!(error = %e, field_id = %field_id, entity_id = %entity_id, "set custom field value");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "commit set custom field values");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    // Field ids and keys only: the values may be personal data.
    let field_keys: Vec<&str> = checked.iter().map(|(_, key, _)| *key).collect();
    state.audit_sender.try_send(audit::domain_event(
        "set_custom_field_values",
        Some(auth.user_id),
        entity_type,
        Some(entity_id),
        serde_json::json!({ "field_ids": field_ids, "field_keys": field_keys }),
    ));

    Json(serde_json::json!({"ok": true})).into_response()
}

/// The entity a value request names, as resolved by [`authorize_values_access`].
struct ValuesScope {
    entity_type: &'static str,
    /// Set for a lead that became a patient (its values are frozen).
    converted_patient_id: Option<Uuid>,
}

/// Object scope of custom field VALUES: the rule of the card they sit on.
/// A patient is read with `patients.view` and the canonical patient access
/// rule (as `GET /patients/{id}`), written with `patients.edit` and the edit
/// rule with the Art. 18 / Art. 17 DSGVO lock. A lead is read with
/// `leads.view` (as `GET /leads/{id}`), written with `leads.edit`; a converted
/// lead is frozen (409 `lead_converted`). `admin.custom_fields` manages field
/// definitions only and opens no values; client accounts hold none of these
/// capabilities. Any other entity is refused with 404.
async fn authorize_values_access(
    state: &AppState,
    auth: &AuthUser,
    entity_id: Uuid,
    write: bool,
) -> Result<ValuesScope, axum::response::Response> {
    let (patient_capability, lead_capability) = values_capabilities(write);
    auth.require_any_capability(&[patient_capability, lead_capability])?;

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
        auth.require_capability(patient_capability)?;
        if !crate::routes::patients::has_patient_access(state, auth, entity_id).await? {
            return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
        }
        if write
            && !crate::routes::patients::has_patient_edit_access(state, auth, entity_id).await?
        {
            return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
        }
        return Ok(ValuesScope {
            entity_type: "patient",
            converted_patient_id: None,
        });
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
            auth.require_capability(lead_capability)?;
            if write && let Some(patient_id) = converted_patient_id {
                return Err(crate::routes::leads::lead_converted_response(patient_id));
            }
            Ok(ValuesScope {
                entity_type: "lead",
                converted_patient_id,
            })
        }
    }
}

/// The (patient, lead) capabilities a read or a write of values needs: the
/// capabilities of reading or editing the card itself.
fn values_capabilities(write: bool) -> (Capability, Capability) {
    if write {
        (Capability::PatientsEdit, Capability::LeadsEdit)
    } else {
        (Capability::PatientsView, Capability::LeadsView)
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
    use super::{
        UpsertField, normalized_value, valid_field_key, validated_definition, values_capabilities,
    };
    use gmed_domain::access::capabilities::Capability;
    use gmed_domain::role::Role;
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

    #[test]
    fn values_are_checked_against_their_field_type() {
        let options = json!(["Charité", "Vivantes"]);
        let check =
            |field_type: &str, raw: Option<&str>| normalized_value(field_type, Some(&options), raw);
        // Empty clears; «Обязательное» never blocks.
        assert_eq!(check("text", None), Ok(None));
        assert_eq!(check("number", Some("   ")), Ok(None));
        assert_eq!(
            check("text", Some("  frei  ")),
            Ok(Some("frei".to_string()))
        );
        assert_eq!(
            check("text", Some(&"x".repeat(2001))),
            Err("custom_field_value_too_long")
        );

        assert_eq!(check("number", Some("12,5")), Ok(Some("12.5".to_string())));
        assert_eq!(check("number", Some("-3")), Ok(Some("-3".to_string())));
        for bad in ["abc", "1e5", "inf", "NaN", "1.2.3"] {
            assert_eq!(
                check("number", Some(bad)),
                Err("custom_field_value_number_invalid"),
                "{bad}"
            );
        }

        assert_eq!(
            check("date", Some("2026-11-12")),
            Ok(Some("2026-11-12".to_string()))
        );
        assert_eq!(
            check("date", Some("12.11.2026")),
            Ok(Some("2026-11-12".to_string()))
        );
        assert_eq!(
            check("date", Some("2026-02-30")),
            Err("custom_field_value_date_invalid")
        );

        assert_eq!(check("boolean", Some("true")), Ok(Some("true".to_string())));
        assert_eq!(
            check("boolean", Some("false")),
            Ok(Some("false".to_string()))
        );
        assert_eq!(
            check("boolean", Some("ja")),
            Err("custom_field_value_boolean_invalid")
        );

        assert_eq!(
            check("select", Some("Charité")),
            Ok(Some("Charité".to_string()))
        );
        assert_eq!(
            check("select", Some("Helios")),
            Err("custom_field_value_option_invalid")
        );
        assert_eq!(
            normalized_value("select", None, Some("Charité")),
            Err("custom_field_value_option_invalid")
        );
    }

    #[test]
    fn values_follow_the_card_capabilities() {
        assert_eq!(
            values_capabilities(false),
            (Capability::PatientsView, Capability::LeadsView)
        );
        assert_eq!(
            values_capabilities(true),
            (Capability::PatientsEdit, Capability::LeadsEdit)
        );
        // Read-only roles read the values of the cards they open, and only
        // those; a client account opens none.
        let reads = |role: Role| {
            let (patient, lead) = values_capabilities(false);
            (role.can(patient), role.can(lead))
        };
        assert_eq!(reads(Role::CeoAssistant), (true, true));
        assert_eq!(reads(Role::Sales), (false, true));
        assert_eq!(reads(Role::Billing), (true, false));
        assert_eq!(reads(Role::Patient), (false, false));
        let writes = |role: Role| {
            let (patient, lead) = values_capabilities(true);
            (role.can(patient), role.can(lead))
        };
        assert_eq!(writes(Role::CeoAssistant), (false, false));
        assert_eq!(writes(Role::Sales), (false, true));
        assert_eq!(writes(Role::PatientManager), (true, true));
    }
}
