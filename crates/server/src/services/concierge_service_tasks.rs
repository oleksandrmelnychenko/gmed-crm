//! A concierge service follows its work-center task (owner decision
//! 2026-09-28, care-tasks status reference Q1 / Q3 / Q4 / Q15).
//!
//! The task is the single source of truth. Whenever the task status changes,
//! the database derives the service's operational status and billing
//! readiness in the same transaction (triggers of migration
//! `20260928212000_concierge_service_follows_task`). The service surfaces
//! (service form, concierge workspace, appointment section, patient portal,
//! appointment cascades) therefore never write a closing or reopening
//! service status themselves: they move the task — under the work-center
//! rules when a person acts, as a system step with a history entry when an
//! appointment or the patient causes it — and the service follows.
//!
//! This module holds the rules that map a requested service status to task
//! steps, the manual billing moves, and the automatic flows of appointments.

use axum::{Json, http::StatusCode, response::IntoResponse};
use serde_json::json;
use sqlx::{PgConnection, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::routes::concierge_operational_items::{
    TaskScope, can_mutate_operational_item, is_allowed_status_transition,
};
use crate::routes::workflow_checklists::{ChecklistItemSync, sync_checklist_items_for_task_status};
use gmed_domain::role::Role;

pub(crate) const SERVICE_BILLED_CODE: &str = "concierge_service_billed";
pub(crate) const SERVICE_BILLED_MESSAGE: &str = "This service is already billed and cannot be cancelled; issue a credit note or reverse the invoice first";
pub(crate) const AMOUNTS_LOCKED_CODE: &str = "concierge_service_amounts_locked";
pub(crate) const AMOUNTS_LOCKED_MESSAGE: &str =
    "The amounts of a billed service are locked; issue a credit note or reverse the invoice first";

/// Status of the task a service gets when it has none yet.
pub(crate) fn task_status_for_service(service_status: &str) -> &'static str {
    match service_status {
        "completed" => "completed",
        "cancelled" => "cancelled",
        "planned" => "open",
        _ => "in_progress",
    }
}

/// What the rules need to know about a service and its task (or the task it
/// will get: its author is the service creator, for a portal request the
/// coordinating staff member).
#[derive(Clone, Copy, Debug)]
pub(crate) struct ServiceTaskFacts<'a> {
    pub(crate) service_status: &'a str,
    pub(crate) billing_status: &'a str,
    pub(crate) task_status: &'a str,
    pub(crate) task_archived: bool,
    pub(crate) task_assignee: Uuid,
    pub(crate) task_author: Uuid,
    pub(crate) task_author_role: &'a str,
}

/// Owned [`ServiceTaskFacts`] read from a service row that carries the
/// columns `linked_task_status`, `linked_task_archived`, `task_assignee_id`,
/// `task_author_id` and `task_author_role`.
#[derive(Clone, Debug, Default)]
pub(crate) struct ServiceTaskState {
    pub(crate) service_status: String,
    pub(crate) billing_status: String,
    pub(crate) linked_task_id: Option<Uuid>,
    pub(crate) task_status: String,
    pub(crate) task_archived: bool,
    pub(crate) task_assignee: Uuid,
    pub(crate) task_author: Uuid,
    pub(crate) task_author_role: String,
}

impl ServiceTaskState {
    pub(crate) fn from_row(row: &sqlx::postgres::PgRow) -> Self {
        let service_status = row.try_get::<String, _>("status").unwrap_or_default();
        let linked_task_status = row
            .try_get::<Option<String>, _>("linked_task_status")
            .unwrap_or_default();
        let task_status = linked_task_status
            .clone()
            .unwrap_or_else(|| task_status_for_service(&service_status).to_string());
        Self {
            billing_status: row
                .try_get::<String, _>("billing_status")
                .unwrap_or_default(),
            linked_task_id: row
                .try_get::<Option<Uuid>, _>("linked_task_id")
                .unwrap_or_default(),
            task_status,
            task_archived: row
                .try_get::<Option<bool>, _>("linked_task_archived")
                .unwrap_or_default()
                .unwrap_or(false),
            task_assignee: row
                .try_get::<Option<Uuid>, _>("task_assignee_id")
                .unwrap_or_default()
                .unwrap_or_else(Uuid::nil),
            task_author: row
                .try_get::<Option<Uuid>, _>("task_author_id")
                .unwrap_or_default()
                .unwrap_or_else(Uuid::nil),
            task_author_role: row
                .try_get::<Option<String>, _>("task_author_role")
                .unwrap_or_default()
                .unwrap_or_default(),
            service_status,
        }
    }

    pub(crate) fn facts(&self) -> ServiceTaskFacts<'_> {
        ServiceTaskFacts {
            service_status: &self.service_status,
            billing_status: &self.billing_status,
            task_status: &self.task_status,
            task_archived: self.task_archived,
            task_assignee: self.task_assignee,
            task_author: self.task_author,
            task_author_role: &self.task_author_role,
        }
    }
}

/// Why a requested service status cannot be set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ServiceStatusRefusal {
    /// Not a move of the service lifecycle.
    Transition,
    /// Booked and confirmed come only from the provider booking.
    BookingFlow,
    /// A billed service is cancelled only through a credit note.
    Billed,
    /// The task is archived.
    Archived,
    /// The actor is neither the task's assignee, nor its author, nor a higher role.
    NotParticipant,
    /// The step (complete, cancel, reopen) belongs to the author or a higher role.
    AuthorOnly,
}

impl ServiceStatusRefusal {
    pub(crate) fn status_code(self) -> StatusCode {
        match self {
            Self::NotParticipant | Self::AuthorOnly => StatusCode::FORBIDDEN,
            _ => StatusCode::CONFLICT,
        }
    }

    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Transition => "concierge_service_transition",
            Self::BookingFlow => "concierge_service_booking_flow",
            Self::Billed => SERVICE_BILLED_CODE,
            Self::Archived => "concierge_service_task_archived",
            Self::NotParticipant => "concierge_service_task_participant",
            Self::AuthorOnly => "concierge_service_task_author",
        }
    }

    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Transition => "Concierge service status transition is not allowed",
            Self::BookingFlow => "Use the provider booking endpoint for booked or confirmed status",
            Self::Billed => SERVICE_BILLED_MESSAGE,
            Self::Archived => {
                "The service task is archived; restore it before changing the service status"
            }
            Self::NotParticipant => {
                "Only the service task's assignee, its author or a higher role can change the service status"
            }
            Self::AuthorOnly => {
                "Only the service task's author or a higher role can complete, cancel or reopen this service; hand the task over for review instead"
            }
        }
    }

    pub(crate) fn response(self) -> axum::response::Response {
        let status = self.status_code();
        (
            status,
            Json(json!({
                "error": status.canonical_reason().unwrap_or("error"),
                "code": self.code(),
                "message": self.message(),
            })),
        )
            .into_response()
    }
}

/// The service lifecycle moves a person may request on a service surface.
fn service_move_exists(current: &str, target: &str) -> bool {
    matches!(
        (current, target),
        ("planned", "in_service" | "cancelled")
            | ("booked", "cancelled")
            | ("confirmed", "in_service" | "cancelled")
            | ("in_service", "completed" | "cancelled")
            | ("completed", "in_service")
            | ("cancelled", "planned")
    )
}

/// Task steps that give a service the requested status.
fn task_steps(task_status: &str, target: &str) -> Option<Vec<&'static str>> {
    match (target, task_status) {
        ("in_service", "open" | "on_hold" | "completed") => Some(vec!["in_progress"]),
        ("in_service", "in_progress" | "review") => Some(Vec::new()),
        ("completed", "in_progress" | "review") => Some(vec!["completed"]),
        ("completed", "open" | "on_hold") => Some(vec!["in_progress", "completed"]),
        ("cancelled", "open" | "in_progress" | "on_hold" | "review") => Some(vec!["cancelled"]),
        ("planned", "cancelled") => Some(vec!["open"]),
        _ => None,
    }
}

/// The task steps a requested service status takes, checked against the
/// work-center rules for this actor: the assignee starts and pauses, the
/// author or a higher role completes, cancels and reopens.
pub(crate) fn plan_service_status_change(
    auth: &AuthUser,
    facts: &ServiceTaskFacts<'_>,
    target: &str,
) -> Result<Vec<&'static str>, ServiceStatusRefusal> {
    if target == facts.service_status {
        return Ok(Vec::new());
    }
    if matches!(target, "booked" | "confirmed") {
        return Err(ServiceStatusRefusal::BookingFlow);
    }
    if !service_move_exists(facts.service_status, target) {
        return Err(ServiceStatusRefusal::Transition);
    }
    if target == "cancelled" && is_financially_locked(facts.billing_status) {
        return Err(ServiceStatusRefusal::Billed);
    }
    if facts.task_archived {
        return Err(ServiceStatusRefusal::Archived);
    }
    let steps = task_steps(facts.task_status, target).ok_or(ServiceStatusRefusal::Transition)?;
    // The service surface is opened by patient access, so a manager's rank
    // reaches the task of the service (see `rank_reaches_task`).
    let can_review = can_mutate_operational_item(
        auth,
        facts.task_author,
        facts.task_author_role,
        TaskScope::PATIENT_OPENED,
    );
    if auth.user_id != facts.task_assignee && !can_review {
        return Err(ServiceStatusRefusal::NotParticipant);
    }
    let mut from = facts.task_status;
    for step in &steps {
        if !is_allowed_status_transition(from, step, can_review) {
            return Err(ServiceStatusRefusal::AuthorOnly);
        }
        from = *step;
    }
    Ok(steps)
}

/// The service statuses this actor can pick now: the current one and every
/// move the task rules allow. The UI offers only these.
pub(crate) fn allowed_service_statuses(
    auth: &AuthUser,
    facts: &ServiceTaskFacts<'_>,
) -> Vec<String> {
    let mut allowed = vec![facts.service_status.to_string()];
    if !matches!(
        auth.role,
        Role::Ceo | Role::PatientManager | Role::Concierge
    ) {
        return allowed;
    }
    for target in ["planned", "in_service", "completed", "cancelled"] {
        if target != facts.service_status && plan_service_status_change(auth, facts, target).is_ok()
        {
            allowed.push(target.to_string());
        }
    }
    allowed
}

pub(crate) fn is_financially_locked(billing_status: &str) -> bool {
    matches!(billing_status, "billed" | "settled")
}

/// Billing moves a person may make (CEO, patient manager, billing):
/// draft -> ready (only for a completed service; completing the task does it
/// anyway), ready -> billed -> settled, waived only from draft or ready. Back
/// to draft only through a reopened task.
pub(crate) fn manual_billing_move_allowed(from: &str, to: &str, service_status: &str) -> bool {
    from == to
        || matches!(
            (from, to),
            ("draft" | "ready", "waived") | ("ready", "billed") | ("billed", "settled")
        )
        || (from == "draft" && to == "ready" && service_status == "completed")
}

pub(crate) fn manual_billing_refusal_message(from: &str, to: &str) -> String {
    if from == "draft" && to == "ready" {
        return "Billing readiness follows the service task: the service becomes ready for billing when its task is completed".to_string();
    }
    if is_financially_locked(from) {
        return format!(
            "A {from} service cannot move to {to}; issue a credit note or reverse the invoice"
        );
    }
    format!("Billing status cannot move from {from} to {to}")
}

pub(crate) fn allowed_billing_statuses(
    role: Role,
    service_status: &str,
    billing: &str,
) -> Vec<String> {
    let mut allowed = vec![billing.to_string()];
    if !matches!(role, Role::Ceo | Role::PatientManager | Role::Billing) {
        return allowed;
    }
    for target in ["draft", "ready", "billed", "settled", "waived"] {
        if target != billing && manual_billing_move_allowed(billing, target, service_status) {
            allowed.push(target.to_string());
        }
    }
    allowed
}

/// Billing status after the derivation of a service status change (the
/// database trigger does the same).
pub(crate) fn billing_after_service_status(
    current_status: &str,
    target: &str,
    billing: &str,
) -> String {
    match (current_status, target, billing) {
        (_, "completed", "draft") => "ready",
        (_, "cancelled", "draft" | "ready") => "waived",
        ("completed", "in_service", "ready") => "draft",
        ("cancelled", "planned", "waived") => "draft",
        _ => billing,
    }
    .to_string()
}

/// Names the acting user for the audit rows the service derivation writes in
/// this transaction.
pub(crate) async fn set_audit_actor(
    conn: &mut PgConnection,
    actor_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT set_config('gmed.audit_actor_id', $1, true)")
        .bind(actor_id.to_string())
        .execute(conn)
        .await
        .map(|_| ())
}

/// One task step with its history entry and the workflow checklist sync; the
/// database derives the service.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn move_service_task_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    task_id: Uuid,
    assigned_to: Uuid,
    from: &str,
    to: &str,
    actor_id: Uuid,
    reason: &str,
    service_id: Option<Uuid>,
) -> Result<Vec<ChecklistItemSync>, sqlx::Error> {
    sqlx::query(
        r#"UPDATE tasks
           SET status = $2,
               completed_at = CASE
                   WHEN $2 = 'completed' THEN COALESCE(completed_at, now())
                   ELSE NULL
               END,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(task_id)
    .bind(to)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
           VALUES ($1, 'status_changed', $2, $3)"#,
    )
    .bind(task_id)
    .bind(actor_id)
    .bind(json!({
        "assigned_to": assigned_to,
        "status": to,
        "previous_status": from,
        "reason": reason,
        "concierge_service_id": service_id,
    }))
    .execute(&mut **tx)
    .await?;
    sync_checklist_items_for_task_status(tx, task_id, from, to, actor_id).await
}

fn conflict(code: &str, message: &str) -> axum::response::Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": "Conflict",
            "code": code,
            "message": message,
        })),
    )
        .into_response()
}

/// Before a work-center status change: names the actor for the derived
/// service audit and refuses to cancel the task of a billed service.
pub(crate) async fn prepare_task_status_change(
    conn: &mut PgConnection,
    task_id: Uuid,
    next_status: &str,
    actor_id: Uuid,
) -> Result<(), axum::response::Response> {
    let failed = |error: sqlx::Error| {
        tracing::error!(error = %error, task_id = %task_id, "prepare service task status change");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal Server Error", "message": "Failed" })),
        )
            .into_response()
    };
    set_audit_actor(conn, actor_id).await.map_err(failed)?;
    if next_status != "cancelled" {
        return Ok(());
    }
    let billing = sqlx::query_scalar::<_, String>(
        r#"SELECT COALESCE(service.billing_status, task.billing_status)
           FROM tasks task
           LEFT JOIN concierge_services service ON service.id = task.concierge_service_id
           WHERE task.id = $1
             AND task.status <> 'cancelled'
             AND (task.concierge_service_id IS NOT NULL OR task.service_status IS NOT NULL)"#,
    )
    .bind(task_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(failed)?;
    if billing.as_deref().is_some_and(is_financially_locked) {
        return Err(conflict(SERVICE_BILLED_CODE, SERVICE_BILLED_MESSAGE));
    }
    Ok(())
}

/// Clear responses for the refusals of the service triggers.
pub(crate) fn service_state_error_response(
    error: &sqlx::Error,
) -> Option<axum::response::Response> {
    let message = error.as_database_error()?.message().to_string();
    if message.starts_with("concierge_service_billed") {
        Some(conflict(SERVICE_BILLED_CODE, SERVICE_BILLED_MESSAGE))
    } else if message.starts_with("concierge_service_amounts_locked") {
        Some(conflict(AMOUNTS_LOCKED_CODE, AMOUNTS_LOCKED_MESSAGE))
    } else if message.starts_with("concierge_service_billing_transition") {
        Some(conflict(
            "concierge_service_billing_transition",
            "This billing status change is not allowed",
        ))
    } else if message.starts_with("concierge_service_follows_task") {
        Some(conflict(
            "concierge_service_follows_task",
            "The service status follows its task; change the task instead",
        ))
    } else {
        None
    }
}

/// A service surface's reason for a system task step.
pub(crate) struct SystemStep<'a> {
    pub(crate) actor_id: Uuid,
    pub(crate) reason: &'a str,
}

/// Closes (completes or cancels) a service through its task when it has one,
/// otherwise directly with the same derivation. Returns the checklist
/// changes of the task.
pub(crate) async fn close_service_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    service_id: Uuid,
    target: &str,
    step: &SystemStep<'_>,
) -> Result<Vec<ChecklistItemSync>, sqlx::Error> {
    set_audit_actor(tx, step.actor_id).await?;
    let task = sqlx::query_as::<_, (Uuid, String, Uuid)>(
        r#"SELECT task.id, task.status, task.assigned_to
           FROM tasks task
           WHERE task.id = concierge_service_canonical_task_id($1)
           FOR UPDATE"#,
    )
    .bind(service_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some((task_id, task_status, assigned_to)) = task {
        if matches!(task_status.as_str(), "completed" | "cancelled") {
            return Ok(Vec::new());
        }
        return move_service_task_in_tx(
            tx,
            task_id,
            assigned_to,
            &task_status,
            target,
            step.actor_id,
            step.reason,
            Some(service_id),
        )
        .await;
    }
    let previous = sqlx::query_as::<_, (String, String)>(
        r#"UPDATE concierge_services service
           SET status = $2,
               billing_status = CASE
                   WHEN $2 = 'completed' AND service.billing_status = 'draft' THEN 'ready'
                   WHEN $2 = 'cancelled' AND service.billing_status IN ('draft', 'ready') THEN 'waived'
                   ELSE service.billing_status
               END,
               completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(service.completed_at, now()) ELSE NULL END,
               booking_decision_required_at = NULL
           FROM (SELECT status, billing_status FROM concierge_services WHERE id = $1 FOR UPDATE) previous
           WHERE service.id = $1
             AND service.status NOT IN ('completed', 'cancelled')
           RETURNING previous.status, previous.billing_status"#,
    )
    .bind(service_id)
    .bind(target)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some((previous_status, previous_billing)) = previous {
        let billing = billing_after_service_status(&previous_status, target, &previous_billing);
        crate::audit::write_in_transaction(
            tx,
            &crate::audit::domain_diff_event(
                "derive_concierge_service_from_task",
                Some(step.actor_id),
                "concierge_service",
                Some(service_id),
                json!({ "status": previous_status, "billing_status": previous_billing }),
                json!({ "status": target, "billing_status": billing, "reason": step.reason }),
            ),
        )
        .await?;
    }
    Ok(Vec::new())
}

/// A service whose appointment was cancelled or stopped being non-medical
/// (Q4): staff and portal services survive; an automatic service without a
/// partner booking is cancelled; a service with a partner booking (or a
/// billed one) is never cancelled automatically — it is flagged for a
/// decision and its concierge is notified. Returns the checklist changes of
/// cancelled tasks.
pub(crate) async fn close_services_of_closed_appointments_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    appointment_ids: &[Uuid],
    actor_id: Uuid,
) -> Result<Vec<ChecklistItemSync>, sqlx::Error> {
    let services = sqlx::query(
        r#"SELECT service.id, service.patient_id, service.title, service.request_source,
                  service.billing_status, service.starts_at, service.vendor_name,
                  service.assigned_concierge_id,
                  CASE WHEN appointment.status = 'cancelled' THEN 'appointment_cancelled'
                       ELSE 'appointment_type_changed' END AS close_reason,
                  (service.status IN ('booked', 'confirmed', 'in_service')
                   OR service.booking_reference IS NOT NULL
                   OR EXISTS (
                       SELECT 1 FROM concierge_service_partner_interactions interaction
                       WHERE (interaction.concierge_service_id = service.id
                              OR interaction.task_id = concierge_service_canonical_task_id(service.id))
                         AND interaction.outcome IN ('booking_requested', 'booking_confirmed')
                   )) AS has_partner_booking,
                  (SELECT task.assigned_to FROM tasks task
                   WHERE task.id = concierge_service_canonical_task_id(service.id)) AS task_assignee
           FROM concierge_services service
           JOIN appointments appointment ON appointment.id = service.appointment_id
           WHERE service.appointment_id = ANY($1)
             AND service.status NOT IN ('completed', 'cancelled')
           ORDER BY service.created_at, service.id
           FOR UPDATE OF service"#,
    )
    .bind(appointment_ids)
    .fetch_all(&mut **tx)
    .await?;

    let mut checklist_changes = Vec::new();
    for service in services {
        let service_id: Uuid = service.try_get("id")?;
        let billing: String = service.try_get("billing_status")?;
        let has_partner_booking: bool = service.try_get("has_partner_booking")?;
        let request_source: String = service.try_get("request_source")?;
        let reason: String = service.try_get("close_reason")?;
        let reason = reason.as_str();
        if has_partner_booking || is_financially_locked(&billing) {
            flag_booking_decision_in_tx(tx, &service, actor_id, reason).await?;
            continue;
        }
        if request_source != "appointment_bootstrap" {
            continue;
        }
        sqlx::query(
            r#"UPDATE concierge_services
               SET service_notes = concat_ws(
                       E'\n',
                       NULLIF(service_notes, ''),
                       'Automatically closed because the linked appointment no longer requires an active concierge workflow'
                   )
               WHERE id = $1"#,
        )
        .bind(service_id)
        .execute(&mut **tx)
        .await?;
        checklist_changes.extend(
            close_service_in_tx(
                tx,
                service_id,
                "cancelled",
                &SystemStep { actor_id, reason },
            )
            .await?,
        );
    }
    Ok(checklist_changes)
}

async fn flag_booking_decision_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    service: &sqlx::postgres::PgRow,
    actor_id: Uuid,
    reason: &str,
) -> Result<(), sqlx::Error> {
    let service_id: Uuid = service.try_get("id")?;
    let patient_id: Uuid = service.try_get("patient_id")?;
    let flagged = sqlx::query(
        r#"UPDATE concierge_services
           SET booking_decision_required_at = now()
           WHERE id = $1 AND booking_decision_required_at IS NULL"#,
    )
    .bind(service_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if flagged == 0 {
        return Ok(());
    }
    crate::audit::write_in_transaction(
        tx,
        &crate::audit::domain_event(
            "flag_concierge_booking_decision",
            Some(actor_id),
            "concierge_service",
            Some(service_id),
            json!({ "reason": reason, "patient_id": patient_id }),
        ),
    )
    .await?;

    // The concierge of the service (its task's assignee and the assigned
    // concierge); without one, the patient's coordinating staff member.
    let candidates: Vec<Uuid> = [
        service
            .try_get::<Option<Uuid>, _>("task_assignee")
            .unwrap_or_default(),
        service
            .try_get::<Option<Uuid>, _>("assigned_concierge_id")
            .unwrap_or_default(),
    ]
    .into_iter()
    .flatten()
    .collect();
    let mut recipients = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM users
           WHERE id = ANY($1) AND is_active AND role <> 'patient'
           ORDER BY id"#,
    )
    .bind(&candidates)
    .fetch_all(&mut **tx)
    .await?;
    if recipients.is_empty()
        && let Some(coordinator) =
            sqlx::query_scalar::<_, Option<Uuid>>("SELECT concierge_service_coordinator_id($1)")
                .bind(patient_id)
                .fetch_one(&mut **tx)
                .await?
    {
        recipients.push(coordinator);
    }
    // The staff UI words the notice in its language from these facts.
    let body = json!({
        "title": service.try_get::<String, _>("title").unwrap_or_default(),
        "vendor_name": service.try_get::<Option<String>, _>("vendor_name").unwrap_or_default(),
        "starts_at": service
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("starts_at")
            .unwrap_or_default()
            .map(|value| value.to_rfc3339()),
        "reason": reason,
    })
    .to_string();
    for user_id in recipients {
        sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               VALUES ($1, 'concierge_booking_decision', $2, $3, 'concierge_service', $4)"#,
        )
        .bind(user_id)
        .bind("Appointment cancelled: decide on the concierge booking")
        .bind(&body)
        .bind(service_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// The automatic service of an appointment that becomes non-medical again
/// is reopened through its task (a system step); without a task directly.
pub(crate) async fn reactivate_automatic_services_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    appointment_id: Uuid,
    actor_id: Uuid,
) -> Result<Vec<ChecklistItemSync>, sqlx::Error> {
    set_audit_actor(tx, actor_id).await?;
    let services = sqlx::query_as::<_, (Uuid, Option<Uuid>, Option<String>, Option<Uuid>, bool)>(
        r#"SELECT service.id, task.id, task.status, task.assigned_to,
                  COALESCE(task.archived_at IS NOT NULL, false)
           FROM concierge_services service
           LEFT JOIN tasks task ON task.id = concierge_service_canonical_task_id(service.id)
           WHERE service.appointment_id = $1
             AND service.request_source = 'appointment_bootstrap'
             AND service.status = 'cancelled'
           FOR UPDATE OF service"#,
    )
    .bind(appointment_id)
    .fetch_all(&mut **tx)
    .await?;
    let mut checklist_changes = Vec::new();
    for (service_id, task_id, task_status, assigned_to, archived) in services {
        if archived {
            continue;
        }
        sqlx::query(
            r#"UPDATE concierge_services
               SET service_notes = concat_ws(
                       E'\n',
                       NULLIF(service_notes, ''),
                       'Automatically reactivated after appointment type changed to non-medical'
                   )
               WHERE id = $1"#,
        )
        .bind(service_id)
        .execute(&mut **tx)
        .await?;
        match (task_id, task_status.as_deref(), assigned_to) {
            (Some(task_id), Some("cancelled"), Some(assigned_to)) => {
                checklist_changes.extend(
                    move_service_task_in_tx(
                        tx,
                        task_id,
                        assigned_to,
                        "cancelled",
                        "open",
                        actor_id,
                        "appointment_reactivated",
                        Some(service_id),
                    )
                    .await?,
                );
            }
            (Some(_), _, _) => {}
            (None, _, _) => {
                sqlx::query(
                    r#"UPDATE concierge_services
                       SET status = 'planned',
                           billing_status = CASE WHEN billing_status = 'waived' THEN 'draft' ELSE billing_status END
                       WHERE id = $1"#,
                )
                .bind(service_id)
                .execute(&mut **tx)
                .await?;
            }
        }
    }
    Ok(checklist_changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor(user_id: Uuid, role: Role) -> AuthUser {
        AuthUser {
            user_id,
            role,
            family_id: Uuid::nil(),
            access_token_jti: Uuid::nil(),
            access_token_expires_at: chrono::Utc::now(),
        }
    }

    fn facts<'a>(
        service_status: &'a str,
        task_status: &'a str,
        assignee: Uuid,
        author: Uuid,
        author_role: &'a str,
    ) -> ServiceTaskFacts<'a> {
        ServiceTaskFacts {
            service_status,
            billing_status: "draft",
            task_status,
            task_archived: false,
            task_assignee: assignee,
            task_author: author,
            task_author_role: author_role,
        }
    }

    #[test]
    fn assignee_starts_but_only_the_author_completes_or_cancels() {
        let concierge = Uuid::new_v4();
        let manager = Uuid::new_v4();
        let assignee = actor(concierge, Role::Concierge);
        let author = actor(manager, Role::PatientManager);
        let planned = facts("planned", "open", concierge, manager, "patient_manager");
        assert_eq!(
            plan_service_status_change(&assignee, &planned, "in_service"),
            Ok(vec!["in_progress"])
        );
        assert_eq!(
            plan_service_status_change(&assignee, &planned, "cancelled"),
            Err(ServiceStatusRefusal::AuthorOnly)
        );
        let running = facts(
            "in_service",
            "in_progress",
            concierge,
            manager,
            "patient_manager",
        );
        assert_eq!(
            plan_service_status_change(&assignee, &running, "completed"),
            Err(ServiceStatusRefusal::AuthorOnly)
        );
        assert_eq!(
            plan_service_status_change(&author, &running, "completed"),
            Ok(vec!["completed"])
        );
        let other = actor(Uuid::new_v4(), Role::Concierge);
        assert_eq!(
            plan_service_status_change(&other, &planned, "in_service"),
            Err(ServiceStatusRefusal::NotParticipant)
        );
    }

    #[test]
    fn an_open_task_is_started_before_it_is_completed_and_reopening_follows_the_task() {
        let manager = Uuid::new_v4();
        let author = actor(manager, Role::PatientManager);
        let stale = facts("in_service", "open", manager, manager, "patient_manager");
        assert_eq!(
            plan_service_status_change(&author, &stale, "completed"),
            Ok(vec!["in_progress", "completed"])
        );
        let done = facts(
            "completed",
            "completed",
            manager,
            manager,
            "patient_manager",
        );
        assert_eq!(
            plan_service_status_change(&author, &done, "in_service"),
            Ok(vec!["in_progress"])
        );
        let cancelled = facts(
            "cancelled",
            "cancelled",
            manager,
            manager,
            "patient_manager",
        );
        assert_eq!(
            plan_service_status_change(&author, &cancelled, "planned"),
            Ok(vec!["open"])
        );
        assert_eq!(
            plan_service_status_change(&author, &done, "planned"),
            Err(ServiceStatusRefusal::Transition)
        );
        assert_eq!(
            plan_service_status_change(&author, &stale, "booked"),
            Err(ServiceStatusRefusal::BookingFlow)
        );
    }

    #[test]
    fn a_billed_service_is_not_cancelled_and_billing_moves_forward_only() {
        let ceo = actor(Uuid::new_v4(), Role::Ceo);
        let mut billed = facts("in_service", "in_progress", ceo.user_id, ceo.user_id, "ceo");
        billed.billing_status = "billed";
        assert_eq!(
            plan_service_status_change(&ceo, &billed, "cancelled"),
            Err(ServiceStatusRefusal::Billed)
        );
        assert!(manual_billing_move_allowed("ready", "billed", "completed"));
        assert!(manual_billing_move_allowed(
            "billed",
            "settled",
            "completed"
        ));
        assert!(manual_billing_move_allowed("draft", "waived", "planned"));
        assert!(!manual_billing_move_allowed("draft", "ready", "planned"));
        assert!(manual_billing_move_allowed("draft", "ready", "completed"));
        assert!(!manual_billing_move_allowed("draft", "billed", "completed"));
        assert!(!manual_billing_move_allowed(
            "billed",
            "waived",
            "completed"
        ));
        assert!(!manual_billing_move_allowed(
            "settled",
            "billed",
            "completed"
        ));
        assert!(!manual_billing_move_allowed("waived", "draft", "planned"));
        assert_eq!(
            allowed_billing_statuses(Role::Billing, "completed", "ready"),
            vec!["ready", "billed", "waived"]
        );
        assert_eq!(
            allowed_billing_statuses(Role::Concierge, "completed", "ready"),
            vec!["ready"]
        );
    }

    #[test]
    fn billing_derivation_matches_the_database_rule() {
        assert_eq!(
            billing_after_service_status("in_service", "completed", "draft"),
            "ready"
        );
        assert_eq!(
            billing_after_service_status("planned", "cancelled", "ready"),
            "waived"
        );
        assert_eq!(
            billing_after_service_status("planned", "cancelled", "billed"),
            "billed"
        );
        assert_eq!(
            billing_after_service_status("completed", "in_service", "ready"),
            "draft"
        );
        assert_eq!(
            billing_after_service_status("cancelled", "planned", "waived"),
            "draft"
        );
        assert_eq!(task_status_for_service("booked"), "in_progress");
        assert_eq!(task_status_for_service("planned"), "open");
    }
}
