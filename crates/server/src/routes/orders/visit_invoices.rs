//! Clinic invoices sorted under the order's visits («После приёмов», planning
//! stage 7, owner 2026-11-13): «рахунки до рахунків», kept apart from the
//! documents; linking an invoice to a visit is optional and one invoice may
//! cover several visits.
//!
//! `GET /orders/{order_id}/visit-invoices` lists the order's clinic invoices
//! with the visits each covers; `POST /orders/{order_id}/external-invoices/
//! {external_invoice_id}/appointments` replaces that set (an empty list leaves
//! the invoice with the order alone). Every added or removed link gets an
//! audit row in the same transaction.

use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use super::{can_access_order, err};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/orders/{order_id}/visit-invoices",
            get(list_visit_invoices),
        )
        .route(
            "/orders/{order_id}/external-invoices/{external_invoice_id}/appointments",
            post(set_invoice_appointments),
        )
}

/// Who reads the order's clinic invoices (as `GET /orders/{id}/external-invoices`).
const READ_ROLES: &[Role] = &[
    Role::Ceo,
    Role::PatientManager,
    Role::Billing,
    Role::CeoAssistant,
];
/// Who sorts them under visits: the planners and Billing, who records them.
const WRITE_ROLES: &[Role] = &[Role::Ceo, Role::PatientManager, Role::Billing];

/// The links to add and to remove when `wanted` replaces `current`.
pub(super) fn link_changes(current: &[Uuid], wanted: &[Uuid]) -> (Vec<Uuid>, Vec<Uuid>) {
    let current_set: HashSet<Uuid> = current.iter().copied().collect();
    let wanted_set: HashSet<Uuid> = wanted.iter().copied().collect();
    let mut added: Vec<Uuid> = wanted_set.difference(&current_set).copied().collect();
    let mut removed: Vec<Uuid> = current_set.difference(&wanted_set).copied().collect();
    added.sort();
    removed.sort();
    (added, removed)
}

async fn ensure_order_readable(
    state: &AppState,
    auth: &AuthUser,
    order_id: Uuid,
    roles: &[Role],
) -> Result<(), axum::response::Response> {
    auth.require_any_role(roles)?;
    match can_access_order(state, auth, order_id, None).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(resp) => Err(resp),
    }
}

async fn list_visit_invoices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = ensure_order_readable(&state, &auth, order_id, READ_ROLES).await {
        return resp;
    }
    let rows = match sqlx::query(
        r#"SELECT ei.id, ei.external_invoice_number, ei.invoice_date, ei.amount_gross,
                  ei.currency, ei.status, ei.source_document_id,
                  COALESCE(pr.name, NULLIF(BTRIM(ei.supplier_name), '')) AS provider_name,
                  COALESCE(
                      ARRAY(SELECT link.appointment_id
                            FROM external_invoice_appointments link
                            WHERE link.external_invoice_id = ei.id
                            ORDER BY link.appointment_id),
                      '{}'::uuid[]
                  ) AS appointment_ids
           FROM external_invoices ei
           LEFT JOIN providers pr ON pr.id = ei.provider_id
           WHERE ei.order_id = $1
           ORDER BY ei.invoice_date NULLS LAST, ei.created_at"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "visit invoices: load");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "external_invoice_number": row.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
                "invoice_date": row.try_get::<Option<chrono::NaiveDate>, _>("invoice_date").unwrap_or_default().map(|value| value.to_string()),
                "amount_gross": row.try_get::<rust_decimal::Decimal, _>("amount_gross").unwrap_or(rust_decimal::Decimal::ZERO),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "source_document_id": row.try_get::<Option<Uuid>, _>("source_document_id").unwrap_or_default(),
                "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                "appointment_ids": row.try_get::<Vec<Uuid>, _>("appointment_ids").unwrap_or_default(),
            })
        })
        .collect();
    (StatusCode::OK, Json(serde_json::json!({ "items": items }))).into_response()
}

#[derive(Deserialize)]
struct SetInvoiceAppointments {
    appointment_ids: Vec<Uuid>,
}

async fn set_invoice_appointments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, external_invoice_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<SetInvoiceAppointments>,
) -> axum::response::Response {
    if let Err(resp) = ensure_order_readable(&state, &auth, order_id, WRITE_ROLES).await {
        return resp;
    }
    if body.appointment_ids.len() > 200 {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Too many visits");
    }
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "visit invoices: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    // Lock the invoice so two planners do not interleave their link sets.
    match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM external_invoices WHERE id = $1 AND order_id = $2 FOR UPDATE",
    )
    .bind(external_invoice_id)
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found in this order"),
        Err(e) => {
            tracing::error!(error = %e, %external_invoice_id, "visit invoices: lock invoice");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }
    let wanted: Vec<Uuid> = {
        let mut seen = HashSet::new();
        body.appointment_ids
            .iter()
            .copied()
            .filter(|id| seen.insert(*id))
            .collect()
    };
    let in_order: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT id FROM appointments WHERE id = ANY($1) AND order_id = $2",
    )
    .bind(&wanted)
    .bind(order_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "visit invoices: check visits");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if in_order.len() != wanted.len() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Every visit must belong to this order",
        );
    }
    let current: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT appointment_id FROM external_invoice_appointments WHERE external_invoice_id = $1",
    )
    .bind(external_invoice_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, %external_invoice_id, "visit invoices: load links");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let (added, removed) = link_changes(&current, &wanted);
    if !removed.is_empty()
        && let Err(e) = sqlx::query(
            "DELETE FROM external_invoice_appointments
              WHERE external_invoice_id = $1 AND appointment_id = ANY($2)",
        )
        .bind(external_invoice_id)
        .bind(&removed)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, %external_invoice_id, "visit invoices: unlink");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if !added.is_empty()
        && let Err(e) = sqlx::query(
            "INSERT INTO external_invoice_appointments (external_invoice_id, appointment_id, created_by)
             SELECT $1, unnest($2::uuid[]), $3",
        )
        .bind(external_invoice_id)
        .bind(&added)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, %external_invoice_id, "visit invoices: link");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    for (action, appointment_ids) in [
        ("link_external_invoice_appointment", &added),
        ("unlink_external_invoice_appointment", &removed),
    ] {
        for appointment_id in appointment_ids {
            if let Err(e) = audit::write_in_transaction(
                &mut tx,
                &audit::domain_event(
                    action,
                    Some(auth.user_id),
                    "external_invoice",
                    Some(external_invoice_id),
                    serde_json::json!({
                        "order_id": order_id,
                        "appointment_id": appointment_id,
                    }),
                ),
            )
            .await
            {
                tracing::error!(error = %e, %external_invoice_id, "visit invoices: audit");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, %external_invoice_id, "visit invoices: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let mut appointment_ids = wanted;
    appointment_ids.sort();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "id": external_invoice_id,
            "appointment_ids": appointment_ids,
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_changes_add_and_remove_only_the_difference() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let c = Uuid::from_u128(3);
        assert_eq!(link_changes(&[a, b], &[b, c]), (vec![c], vec![a]));
        assert_eq!(link_changes(&[a], &[a, a]), (vec![], vec![]));
        assert_eq!(link_changes(&[a, b], &[]), (vec![], vec![a, b]));
    }
}
