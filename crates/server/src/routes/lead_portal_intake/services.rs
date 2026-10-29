//! The optional programme/service questionnaire, shared with the staff wizard.
use super::*;
use std::collections::BTreeMap;

const OPTIONS: &[&str] = &[
    "driver",
    "concierge",
    "interpreter_support",
    "document_translation",
    "visa_support",
    "medical-transport",
    "air-ambulance",
    "business-aviation",
    "none",
    "not-sure",
];

fn canonical(value: &str) -> &str {
    match value {
        "chauffeur" | "transfer" | "airport-transfer" | "airport_transfer" => "driver",
        "concierge-support" | "concierge_support" => "concierge",
        "medical_transport" => "medical-transport",
        "air_ambulance" => "air-ambulance",
        "business_aviation" => "business-aviation",
        "not_sure" => "not-sure",
        "document-translation" => "document_translation",
        "visa-support" => "visa_support",
        "interpreter" | "translator" | "dolmetscher" | "interpreter-support" => {
            "interpreter_support"
        }
        value => value,
    }
}

fn exclusive(value: &str) -> bool {
    matches!(value, "none" | "not-sure")
}

fn selection(row: &PgRow) -> Vec<String> {
    let mut values = row
        .try_get::<Vec<String>, _>("services")
        .unwrap_or_default();
    if row
        .try_get::<Option<bool>, _>("needs_interpreter")
        .ok()
        .flatten()
        == Some(true)
    {
        values.push("interpreter_support".into());
    }
    let mut result = Vec::new();
    for value in values {
        let value = canonical(&value).to_owned();
        if !result.contains(&value) {
            result.push(value);
        }
    }
    if result.iter().any(|value| !exclusive(value)) {
        result.retain(|value| !exclusive(value));
    } else {
        result.truncate(1);
    }
    result
}

/// Only questionnaire fields are exposed, never the rest of wizard_state.
pub(super) fn payload(row: &PgRow) -> Value {
    let wizard = row
        .try_get::<Value, _>("wizard_state")
        .unwrap_or_else(|_| json!({}));
    let selected: Vec<String> = selection(row)
        .into_iter()
        .filter(|v| OPTIONS.contains(&v.as_str()))
        .collect();
    let comments: Map<String, Value> = wizard
        .get("service_comments")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| {
            let key = canonical(key);
            (selected.iter().any(|v| v == key) && value.is_string())
                .then(|| (key.to_owned(), value.clone()))
        })
        .collect();
    json!({
        "services": selected,
        "service_comments": comments,
        "notes": row.try_get::<Option<String>, _>("notes").ok().flatten().unwrap_or_default(),
        "program_date_from": wizard.get("program_date_from").and_then(Value::as_str).unwrap_or(""),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ServicePatch {
    services: Option<Vec<String>>,
    service_comments: Option<BTreeMap<String, String>>,
    notes: Option<String>,
    program_date_from: Option<String>,
}

fn comment(value: &str, field: &'static str) -> Result<String, FieldError> {
    if value.chars().count() > 4000
        || value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(field_error(field, "Invalid comment"));
    }
    Ok(value.trim().to_owned())
}

fn date(value: &str, field: &'static str) -> Result<String, FieldError> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| field_error(field, "Invalid date"))?;
    if parsed.format("%Y-%m-%d").to_string() != value || value.len() != 10 {
        return Err(field_error(field, "Invalid date"));
    }
    Ok(value.to_owned())
}

pub(super) async fn update(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(patch): Json<ServicePatch>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin service questionnaire"),
    };
    let kind = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock service questionnaire"),
    };
    if let Some(refusal) =
        after_send_refusal(&mut tx, lead_id, auth.user_id, AfterSend::Closed).await
    {
        return refusal;
    }
    let row = match sqlx::query(
        "SELECT services, needs_interpreter, notes, wizard_state FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => return internal(error, "load service questionnaire"),
    };
    let current = payload(&row);
    let mut selected = selection(&row);
    if let Some(values) = &patch.services {
        if values.len() > OPTIONS.len()
            || values.iter().any(|v| !OPTIONS.contains(&v.as_str()))
            || (values.len() > 1 && values.iter().any(|v| exclusive(v)))
        {
            return field_error("services", "Invalid service selection").into_response();
        }
        // Preserve older staff-only service codes; none/undecided deliberately clears the selection.
        selected.retain(|v| !OPTIONS.contains(&v.as_str()) && !values.iter().any(|v| exclusive(v)));
        for value in values {
            if !selected.contains(value) {
                selected.push(value.clone());
            }
        }
    }
    let mut wizard = row
        .try_get::<Value, _>("wizard_state")
        .unwrap_or_else(|_| json!({}));
    let mut comments: Map<String, Value> = wizard
        .get("service_comments")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(key, value)| (canonical(key).to_owned(), value.clone()))
        .collect();
    if let Some(changes) = &patch.service_comments {
        for (key, value) in changes {
            if !OPTIONS.contains(&key.as_str()) {
                return field_error("service_comments", "Unknown service").into_response();
            }
            let value = match comment(value, "service_comments") {
                Ok(value) => value,
                Err(error) => return error.into_response(),
            };
            if value.is_empty() {
                comments.remove(key);
            } else {
                comments.insert(key.clone(), json!(value));
            }
        }
    }
    comments.retain(|key, _| selected.iter().any(|v| v == canonical(key)));
    let mut from = current["program_date_from"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    if let Some(value) = &patch.program_date_from {
        let next = match date(value, "program_date_from") {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        };
        // The wished start lies ahead (owner 2026-10-29); a stored past date
        // stays until it is changed.
        if next != from
            && !next.is_empty()
            && next < crate::app_time::today().format("%Y-%m-%d").to_string()
        {
            return field_error("program_date_from", "The date lies in the past").into_response();
        }
        from = next;
    }
    let notes = match patch.notes.as_deref() {
        Some(value) => match comment(value, "notes") {
            Ok(value) => value,
            Err(error) => return error.into_response(),
        },
        None => current["notes"].as_str().unwrap_or("").to_owned(),
    };
    let next = json!({ "services": selected.iter().filter(|v| OPTIONS.contains(&v.as_str())).collect::<Vec<_>>(),
        "service_comments": comments.iter().filter(|(k, _)| OPTIONS.contains(&canonical(k)))
            .map(|(k, v)| (canonical(k).to_owned(), v.clone())).collect::<Map<String, Value>>(),
        "program_date_from": from, "notes": notes });
    let changed: Vec<&str> = ["services", "service_comments", "program_date_from", "notes"]
        .into_iter()
        .filter(|key| current[*key] != next[*key])
        .collect();
    if changed.is_empty() {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    }
    if !wizard.is_object() {
        wizard = json!({});
    }
    wizard["service_comments"] = json!(comments);
    wizard["program_date_from"] = json!(from);
    // The cabinet asks for the start only; preserve any end date set by staff.
    let now = match portal_update_time(&mut tx).await {
        Ok(now) => now,
        Err(error) => return internal(error, "service questionnaire time"),
    };
    let marker =
        json!({ "service_preferences": { "at": now, "by": auth.user_id, "kind": kind.as_str() } });
    if let Err(error) = sqlx::query(
        "UPDATE leads SET services = $2, needs_interpreter = $3, notes = $4, wizard_state = $5,
         portal_field_updates = portal_field_updates || $6::jsonb, updated_at = now() WHERE id = $1"
    ).bind(lead_id).bind(&selected).bind(selected.iter().any(|v| v == "interpreter_support"))
        .bind(&notes).bind(wizard).bind(marker).execute(&mut *tx).await {
        return internal(error, "save service questionnaire");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_update_services",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({ "fields": changed, "access_kind": kind.as_str() }),
        ),
    )
    .await
    {
        return internal(error, "audit service questionnaire");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit service questionnaire");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "service_preferences", "fields": changed, "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}
