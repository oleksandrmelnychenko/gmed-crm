//! Billing work list of concierge services ready to bill (owner 2026-11-12,
//! decision 8).
//!
//! A concierge service whose task is completed moves to the billing status
//! `ready` («готово к выставлению счёта»). Until now nothing read that state.
//! `GET /concierge-billing-queue` lists those services with patient, order,
//! service, date and sale price so Billing can bill them from the patient's
//! billing tab. Read only: Billing, CEO and CEO assistant see every patient,
//! a patient manager only the patients assigned to them. The list never
//! changes a service; billing happens on the patient card.

use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::{auth::middleware::AuthUser, money::CommercialRounding, state::AppState};
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

/// Most rows one answer carries; `truncated` says when there are more.
const QUEUE_LIMIT: i64 = 500;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/concierge-billing-queue",
        get(list_ready_concierge_services),
    )
}

#[derive(Deserialize)]
struct ConciergeBillingQueueQuery {
    patient_id: Option<Uuid>,
}

fn err(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}

/// Which rows a role reads: `Some(false)` every patient, `Some(true)` only
/// patients assigned to the caller, `None` no access.
fn assigned_patients_only(role: Role) -> Option<bool> {
    match role {
        Role::Ceo | Role::CeoAssistant | Role::Billing => Some(false),
        Role::PatientManager => Some(true),
        _ => None,
    }
}

fn money_text(value: Decimal) -> String {
    crate::money::money_string(value)
}

async fn list_ready_concierge_services(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ConciergeBillingQueueQuery>,
) -> Response {
    let Some(assigned_only) = assigned_patients_only(auth.role) else {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    };
    if let Err(response) = auth.require_capability(Capability::InvoicesView) {
        return response;
    }

    let rows = match sqlx::query(
        r#"SELECT service.id,
                  service.patient_id,
                  patient.patient_id AS patient_pid,
                  trim(concat_ws(' ', patient.first_name, patient.last_name)) AS patient_name,
                  linked_order.id AS order_id,
                  linked_order.order_number,
                  service.title,
                  service.service_kind,
                  service.status,
                  COALESCE(service.starts_at, service.completed_at) AS service_date,
                  service.completed_at,
                  service.quantity,
                  service.unit_price,
                  UPPER(service.currency) AS currency,
                  reservation.invoice_id AS draft_invoice_id
           FROM concierge_services service
           JOIN patients patient ON patient.id = service.patient_id
           LEFT JOIN appointments appointment ON appointment.id = service.appointment_id
           LEFT JOIN orders linked_order
             ON linked_order.id = COALESCE(service.order_id, appointment.order_id)
           -- A live draft that already bills the service (F-C8).
           LEFT JOIN LATERAL (
               SELECT link.invoice_id
               FROM invoice_concierge_service_lines link
               JOIN invoices invoice ON invoice.id = link.invoice_id
               WHERE link.concierge_service_id = service.id
                 AND invoice.status <> 'cancelled'
               ORDER BY link.created_at DESC
               LIMIT 1
           ) reservation ON true
           WHERE service.billing_status = 'ready'
             AND service.status <> 'cancelled'
             AND ($1::uuid IS NULL OR service.patient_id = $1::uuid)
             AND (NOT $2 OR EXISTS (
                 SELECT 1
                 FROM patient_assignments assignment
                 WHERE assignment.patient_id = service.patient_id
                   AND assignment.user_id = $3
                   AND assignment.revoked_at IS NULL
             ))
           ORDER BY COALESCE(service.starts_at, service.completed_at, service.created_at),
                    service.id
           LIMIT $4"#,
    )
    .bind(query.patient_id)
    .bind(assigned_only)
    .bind(auth.user_id)
    .bind(QUEUE_LIMIT + 1)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "load concierge billing queue");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load concierge billing queue",
            );
        }
    };

    let truncated = rows.len() as i64 > QUEUE_LIMIT;
    let items = rows
        .iter()
        .take(QUEUE_LIMIT as usize)
        .map(|row| {
            let quantity = row
                .try_get::<Decimal, _>("quantity")
                .unwrap_or(Decimal::ZERO);
            let unit_price = row
                .try_get::<Option<Decimal>, _>("unit_price")
                .unwrap_or_default();
            // No sale price: Billing still sees the service (its receipts may
            // be what is billed), with an empty price.
            let sale_price = unit_price
                .filter(|price| *price > Decimal::ZERO)
                .map(|price| money_text((quantity * price).round_commercial(2)));
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
                "patient_pid": row.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
                "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
                "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
                "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "service_kind": row.try_get::<String, _>("service_kind").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "service_date": row
                    .try_get::<Option<DateTime<Utc>>, _>("service_date")
                    .unwrap_or_default()
                    .map(|value| value.to_rfc3339()),
                "completed_at": row
                    .try_get::<Option<DateTime<Utc>>, _>("completed_at")
                    .unwrap_or_default()
                    .map(|value| value.to_rfc3339()),
                "quantity": money_text(quantity),
                "unit_price": unit_price.map(money_text),
                "sale_price": sale_price,
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                // Already on a live draft of the patient's billing tab.
                "draft_invoice_id": row.try_get::<Option<Uuid>, _>("draft_invoice_id").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    let total = items.len();
    Json(json!({
        "items": items,
        "total": total,
        "truncated": truncated,
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn billing_ceo_and_assistant_read_all_and_pm_only_assigned_patients() {
        assert_eq!(assigned_patients_only(Role::Billing), Some(false));
        assert_eq!(assigned_patients_only(Role::Ceo), Some(false));
        assert_eq!(assigned_patients_only(Role::CeoAssistant), Some(false));
        assert_eq!(assigned_patients_only(Role::PatientManager), Some(true));
        assert_eq!(assigned_patients_only(Role::Concierge), None);
        assert_eq!(assigned_patients_only(Role::Sales), None);
        assert_eq!(assigned_patients_only(Role::Interpreter), None);
    }
}
