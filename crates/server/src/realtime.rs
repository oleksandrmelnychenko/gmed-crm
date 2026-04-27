use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RealtimeEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<i64>,
    pub id: Uuid,
    #[serde(rename = "type")]
    pub event_type: String,
    pub entity_type: String,
    pub entity_id: Uuid,
    pub patient_id: Option<Uuid>,
    pub actor_user_id: Option<Uuid>,
    pub target_user_ids: Vec<Uuid>,
    pub role_names: Vec<String>,
    pub payload: Value,
    pub occurred_at: String,
}

impl RealtimeEvent {
    pub fn new(
        event_type: impl Into<String>,
        entity_type: impl Into<String>,
        entity_id: Uuid,
    ) -> Self {
        Self {
            seq: None,
            id: Uuid::new_v4(),
            event_type: event_type.into(),
            entity_type: entity_type.into(),
            entity_id,
            patient_id: None,
            actor_user_id: None,
            target_user_ids: Vec::new(),
            role_names: Vec::new(),
            payload: json!({}),
            occurred_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn patient_id(mut self, patient_id: Uuid) -> Self {
        self.patient_id = Some(patient_id);
        self
    }

    pub fn actor(mut self, actor_user_id: Option<Uuid>) -> Self {
        self.actor_user_id = actor_user_id;
        self
    }

    pub fn target_users(mut self, target_user_ids: Vec<Uuid>) -> Self {
        self.target_user_ids = dedupe_uuids(target_user_ids);
        self
    }

    pub fn roles(mut self, role_names: &[&str]) -> Self {
        self.role_names = role_names.iter().map(|role| (*role).to_string()).collect();
        self
    }

    pub fn payload(mut self, payload: Value) -> Self {
        self.payload = payload;
        self
    }
}

pub async fn publish_event(state: &AppState, mut event: RealtimeEvent) {
    match persist_realtime_event(state, &event).await {
        Ok((seq, occurred_at)) => {
            event.seq = Some(seq);
            event.occurred_at = occurred_at.to_rfc3339();
        }
        Err(error) => {
            tracing::warn!(
                error = %error,
                event_id = %event.id,
                event_type = %event.event_type,
                "failed to persist realtime event"
            );
        }
    }

    let _ = state.realtime_events.send(event);
}

pub async fn load_realtime_events_after(
    state: &AppState,
    after_seq: i64,
    limit: i64,
) -> Result<Vec<RealtimeEvent>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT seq, id, event_type, entity_type, entity_id, patient_id, actor_user_id,
                  target_user_ids, role_names, payload, occurred_at
           FROM realtime_events
           WHERE seq > $1
           ORDER BY seq ASC
           LIMIT $2"#,
    )
    .bind(after_seq)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row_to_realtime_event(&row).ok())
        .collect())
}

pub async fn publish_patient_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    patient_id: Uuid,
    payload: Value,
) {
    publish_patient_event_with_targets(
        state,
        actor_user_id,
        event_type,
        patient_id,
        Vec::new(),
        payload,
    )
    .await;
}

pub async fn publish_patient_event_with_targets(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    patient_id: Uuid,
    extra_target_user_ids: Vec<Uuid>,
    payload: Value,
) {
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend(extra_target_user_ids);
    if let Some(actor_user_id) = actor_user_id {
        target_user_ids.push(actor_user_id);
    }

    publish_event(
        state,
        RealtimeEvent::new(event_type, "patient", patient_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "ceo_assistant", "billing"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_appointment_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    appointment_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        "SELECT patient_id, owner_user_id, interpreter_id FROM appointments WHERE id = $1",
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let owner_user_id: Option<Uuid> = row.try_get("owner_user_id").unwrap_or_default();
    let interpreter_id: Option<Uuid> = row.try_get("interpreter_id").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend(
        [actor_user_id, owner_user_id, interpreter_id]
            .into_iter()
            .flatten(),
    );

    publish_event(
        state,
        RealtimeEvent::new(event_type, "appointment", appointment_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_appointment_request_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    request_id: Uuid,
    patient_id: Uuid,
    requested_by: Option<Uuid>,
    payload: Value,
) {
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend([actor_user_id, requested_by].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "appointment_request", request_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_concierge_service_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    service_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        "SELECT patient_id, assigned_concierge_id FROM concierge_services WHERE id = $1",
    )
    .bind(service_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let assigned_concierge_id: Option<Uuid> =
        row.try_get("assigned_concierge_id").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend([actor_user_id, assigned_concierge_id].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "concierge_service", service_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "billing"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_document_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    document_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query("SELECT patient_id, uploaded_by FROM documents WHERE id = $1")
        .bind(document_id)
        .fetch_optional(&state.db)
        .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let Some(patient_id) = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default()
    else {
        return;
    };
    let uploaded_by: Option<Uuid> = row.try_get("uploaded_by").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend([actor_user_id, uploaded_by].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "document", document_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "billing"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_invoice_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    invoice_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query("SELECT patient_id, created_by FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_optional(&state.db)
        .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let created_by: Option<Uuid> = row.try_get("created_by").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend([actor_user_id, created_by].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "invoice", invoice_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "ceo_assistant", "billing"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_privacy_request_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    request_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        r#"SELECT patient_id, requested_by, reviewed_by, executed_by
           FROM patient_privacy_requests
           WHERE id = $1"#,
    )
    .bind(request_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let requested_by: Option<Uuid> = row.try_get("requested_by").unwrap_or_default();
    let reviewed_by: Option<Uuid> = row.try_get("reviewed_by").unwrap_or_default();
    let executed_by: Option<Uuid> = row.try_get("executed_by").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend(
        [actor_user_id, requested_by, reviewed_by, executed_by]
            .into_iter()
            .flatten(),
    );

    publish_event(
        state,
        RealtimeEvent::new(event_type, "privacy_request", request_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "it_admin"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_feedback_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    feedback_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        r#"SELECT patient_id, submitted_by, patient_manager_id, interpreter_id, concierge_id
           FROM patient_feedback_forms
           WHERE id = $1"#,
    )
    .bind(feedback_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let submitted_by: Option<Uuid> = row.try_get("submitted_by").unwrap_or_default();
    let patient_manager_id: Option<Uuid> = row.try_get("patient_manager_id").unwrap_or_default();
    let interpreter_id: Option<Uuid> = row.try_get("interpreter_id").unwrap_or_default();
    let concierge_id: Option<Uuid> = row.try_get("concierge_id").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend(
        [
            actor_user_id,
            submitted_by,
            patient_manager_id,
            interpreter_id,
            concierge_id,
        ]
        .into_iter()
        .flatten(),
    );

    publish_event(
        state,
        RealtimeEvent::new(event_type, "feedback", feedback_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "ceo_assistant"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_order_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    order_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query("SELECT patient_id, created_by FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let created_by: Option<Uuid> = row.try_get("created_by").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids_for_roles(
        state,
        patient_id,
        &[
            "patient_manager",
            "teamlead_interpreter",
            "interpreter",
            "concierge",
            "patient",
        ],
    )
    .await
    .unwrap_or_default();
    target_user_ids.extend([actor_user_id, created_by].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "order", order_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "billing"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_contract_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    contract_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query("SELECT patient_id, created_by FROM framework_contracts WHERE id = $1")
        .bind(contract_id)
        .fetch_optional(&state.db)
        .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let created_by: Option<Uuid> = row.try_get("created_by").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids_for_roles(
        state,
        patient_id,
        &["patient_manager", "patient"],
    )
    .await
    .unwrap_or_default();
    target_user_ids.extend([actor_user_id, created_by].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "framework_contract", contract_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "ceo_assistant", "billing"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_quote_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    quote_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        r#"SELECT q.order_id, q.created_by, o.patient_id
           FROM quotes q
           JOIN orders o ON o.id = q.order_id
           WHERE q.id = $1"#,
    )
    .bind(quote_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let created_by: Option<Uuid> = row.try_get("created_by").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids_for_roles(
        state,
        patient_id,
        &["patient_manager", "patient"],
    )
    .await
    .unwrap_or_default();
    target_user_ids.extend([actor_user_id, created_by].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "quote", quote_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo", "ceo_assistant", "billing"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_case_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    case_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query("SELECT patient_id, manager_id FROM cases WHERE id = $1")
        .bind(case_id)
        .fetch_optional(&state.db)
        .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let manager_id: Option<Uuid> = row.try_get("manager_id").unwrap_or_default();
    let mut target_user_ids =
        load_active_patient_assignment_user_ids_for_roles(state, patient_id, &["patient_manager"])
            .await
            .unwrap_or_default();
    target_user_ids.extend([actor_user_id, manager_id].into_iter().flatten());

    publish_event(
        state,
        RealtimeEvent::new(event_type, "case", case_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_task_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    task_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        r#"SELECT assigned_to, assigned_by, patient_id, order_id, appointment_id
           FROM tasks
           WHERE id = $1"#,
    )
    .bind(task_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let assigned_to: Option<Uuid> = row.try_get("assigned_to").ok();
    let assigned_by: Option<Uuid> = row.try_get("assigned_by").ok();
    let patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
    let mut target_user_ids = if let Some(patient_id) = patient_id {
        load_active_patient_assignment_user_ids(state, patient_id)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    target_user_ids.extend(
        [actor_user_id, assigned_to, assigned_by]
            .into_iter()
            .flatten(),
    );

    let mut event = RealtimeEvent::new(event_type, "task", task_id)
        .actor(actor_user_id)
        .target_users(target_user_ids)
        .roles(&["ceo"])
        .payload(payload);
    if let Some(patient_id) = patient_id {
        event = event.patient_id(patient_id);
    }

    publish_event(state, event).await;
}

pub async fn publish_workflow_checklist_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    item_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        r#"SELECT patient_id, order_id, scope_type, scope_id, owner_user_id, created_by
           FROM workflow_checklist_items
           WHERE id = $1"#,
    )
    .bind(item_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let owner_user_id: Option<Uuid> = row.try_get("owner_user_id").unwrap_or_default();
    let created_by: Option<Uuid> = row.try_get("created_by").ok();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend(
        [actor_user_id, owner_user_id, created_by]
            .into_iter()
            .flatten(),
    );

    publish_event(
        state,
        RealtimeEvent::new(event_type, "workflow_checklist_item", item_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_appointment_checklist_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    item_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        r#"SELECT ac.appointment_id, a.patient_id, a.owner_user_id, a.interpreter_id
           FROM appointment_checklists ac
           JOIN appointments a ON a.id = ac.appointment_id
           WHERE ac.id = $1"#,
    )
    .bind(item_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let patient_id: Uuid = match row.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return,
    };
    let owner_user_id: Option<Uuid> = row.try_get("owner_user_id").unwrap_or_default();
    let interpreter_id: Option<Uuid> = row.try_get("interpreter_id").unwrap_or_default();
    let mut target_user_ids = load_active_patient_assignment_user_ids(state, patient_id)
        .await
        .unwrap_or_default();
    target_user_ids.extend(
        [actor_user_id, owner_user_id, interpreter_id]
            .into_iter()
            .flatten(),
    );

    publish_event(
        state,
        RealtimeEvent::new(event_type, "appointment_checklist", item_id)
            .patient_id(patient_id)
            .actor(actor_user_id)
            .target_users(target_user_ids)
            .roles(&["ceo"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_reminder_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    reminder_id: Uuid,
    payload: Value,
) {
    let row = sqlx::query(
        r#"SELECT r.appointment_id, r.user_id, a.patient_id, a.owner_user_id, a.interpreter_id
           FROM reminders r
           LEFT JOIN appointments a ON a.id = r.appointment_id
           WHERE r.id = $1"#,
    )
    .bind(reminder_id)
    .fetch_optional(&state.db)
    .await;

    let Some(row) = row.ok().flatten() else {
        return;
    };

    let reminder_user_id: Option<Uuid> = row.try_get("user_id").ok();
    let patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
    let owner_user_id: Option<Uuid> = row.try_get("owner_user_id").unwrap_or_default();
    let interpreter_id: Option<Uuid> = row.try_get("interpreter_id").unwrap_or_default();
    let mut target_user_ids = if let Some(patient_id) = patient_id {
        load_active_patient_assignment_user_ids(state, patient_id)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    target_user_ids.extend(
        [
            actor_user_id,
            reminder_user_id,
            owner_user_id,
            interpreter_id,
        ]
        .into_iter()
        .flatten(),
    );

    let mut event = RealtimeEvent::new(event_type, "reminder", reminder_id)
        .actor(actor_user_id)
        .target_users(target_user_ids)
        .roles(&["ceo"])
        .payload(payload);
    if let Some(patient_id) = patient_id {
        event = event.patient_id(patient_id);
    }

    publish_event(state, event).await;
}

pub async fn publish_provider_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    provider_id: Uuid,
    payload: Value,
) {
    publish_event(
        state,
        RealtimeEvent::new(event_type, "provider", provider_id)
            .actor(actor_user_id)
            .target_users(actor_user_id.into_iter().collect())
            .roles(&["ceo", "patient_manager", "concierge", "billing", "sales"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_lead_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    lead_id: Uuid,
    payload: Value,
) {
    let created_by =
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT created_by FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten();

    publish_event(
        state,
        RealtimeEvent::new(event_type, "lead", lead_id)
            .actor(actor_user_id)
            .target_users([actor_user_id, created_by].into_iter().flatten().collect())
            .roles(&["ceo", "patient_manager", "sales"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_message_peer_event(
    state: &AppState,
    target_user_id: Uuid,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    peer_id: Uuid,
    payload: Value,
) {
    publish_event(
        state,
        RealtimeEvent::new(event_type, "message_peer", peer_id)
            .actor(actor_user_id)
            .target_users(vec![target_user_id])
            .payload(payload),
    )
    .await;
}

pub async fn publish_admin_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    entity_type: &str,
    entity_id: Uuid,
    payload: Value,
) {
    publish_event(
        state,
        RealtimeEvent::new(event_type, entity_type, entity_id)
            .actor(actor_user_id)
            .target_users(actor_user_id.into_iter().collect())
            .roles(&["ceo", "it_admin"])
            .payload(payload),
    )
    .await;
}

pub async fn publish_announcement_event(
    state: &AppState,
    actor_user_id: Option<Uuid>,
    event_type: &str,
    announcement_id: Uuid,
    payload: Value,
) {
    publish_event(
        state,
        RealtimeEvent::new(event_type, "announcement", announcement_id)
            .actor(actor_user_id)
            .target_users(actor_user_id.into_iter().collect())
            .roles(&[
                "ceo",
                "ceo_assistant",
                "patient_manager",
                "teamlead_interpreter",
                "interpreter",
                "concierge",
                "billing",
                "sales",
                "it_admin",
                "patient",
            ])
            .payload(payload),
    )
    .await;
}

pub async fn publish_notification_event(
    state: &AppState,
    user_id: Uuid,
    event_type: &str,
    notification_id: Option<Uuid>,
    payload: Value,
) {
    publish_event(
        state,
        RealtimeEvent::new(
            event_type,
            "notification",
            notification_id.unwrap_or(user_id),
        )
        .actor(None)
        .target_users(vec![user_id])
        .payload(payload),
    )
    .await;
}

async fn persist_realtime_event(
    state: &AppState,
    event: &RealtimeEvent,
) -> Result<(i64, chrono::DateTime<Utc>), sqlx::Error> {
    let row = sqlx::query(
        r#"INSERT INTO realtime_events (
                id, event_type, entity_type, entity_id, patient_id, actor_user_id,
                target_user_ids, role_names, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING seq, occurred_at"#,
    )
    .bind(event.id)
    .bind(&event.event_type)
    .bind(&event.entity_type)
    .bind(event.entity_id)
    .bind(event.patient_id)
    .bind(event.actor_user_id)
    .bind(&event.target_user_ids)
    .bind(&event.role_names)
    .bind(&event.payload)
    .fetch_one(&state.db)
    .await?;

    Ok((
        row.try_get::<i64, _>("seq")?,
        row.try_get::<chrono::DateTime<Utc>, _>("occurred_at")?,
    ))
}

fn row_to_realtime_event(row: &sqlx::postgres::PgRow) -> Result<RealtimeEvent, sqlx::Error> {
    let occurred_at = row
        .try_get::<chrono::DateTime<Utc>, _>("occurred_at")?
        .to_rfc3339();

    Ok(RealtimeEvent {
        seq: Some(row.try_get("seq")?),
        id: row.try_get("id")?,
        event_type: row.try_get("event_type")?,
        entity_type: row.try_get("entity_type")?,
        entity_id: row.try_get("entity_id")?,
        patient_id: row.try_get("patient_id")?,
        actor_user_id: row.try_get("actor_user_id")?,
        target_user_ids: row.try_get("target_user_ids")?,
        role_names: row.try_get("role_names")?,
        payload: row.try_get("payload")?,
        occurred_at,
    })
}

async fn load_active_patient_assignment_user_ids(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT user_id
           FROM patient_assignments
           WHERE patient_id = $1
             AND revoked_at IS NULL"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Uuid, _>("user_id").ok())
        .collect())
}

async fn load_active_patient_assignment_user_ids_for_roles(
    state: &AppState,
    patient_id: Uuid,
    role_names: &[&str],
) -> Result<Vec<Uuid>, sqlx::Error> {
    if role_names.is_empty() {
        return Ok(Vec::new());
    }

    let role_names: Vec<String> = role_names.iter().map(|role| (*role).to_string()).collect();
    let rows = sqlx::query(
        r#"SELECT pa.user_id
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = ANY($2)"#,
    )
    .bind(patient_id)
    .bind(&role_names)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Uuid, _>("user_id").ok())
        .collect())
}

fn dedupe_uuids(values: Vec<Uuid>) -> Vec<Uuid> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        if seen.insert(value) {
            out.push(value);
        }
    }
    out
}
