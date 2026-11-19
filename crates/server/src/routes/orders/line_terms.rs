//! Discount and tax profile of an existing order position (owner
//! 2026-11-19): services added during a running order — by the service form,
//! the planning grid, a completed appointment or an interpreter report — get
//! their discount and VAT (tax profile) set or changed afterwards in the
//! order positions. A position an active invoice already bills keeps the
//! terms it was billed on (409); a change of a position not billed yet flows
//! into the next interim or final invoice.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use super::{client_terms, err, line_tax};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::money;
use crate::state::AppState;
use gmed_domain::role::Role;

#[derive(Deserialize)]
pub(super) struct UpdateLeistungTermsRequest {
    /// Discount in percent (0–100, two decimals); left out keeps it.
    #[serde(default)]
    discount_percent: Option<serde_json::Value>,
    /// The position's tax profile; left out keeps it.
    #[serde(default)]
    tax_profile_id: Option<Uuid>,
    #[serde(default)]
    confirm_signature_reset: bool,
}

/// Error code: an active invoice bills the position.
pub(crate) const LINE_ALREADY_INVOICED: &str = "order_line_already_invoiced";

pub(super) async fn update_leistung_terms(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, leistung_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateLeistungTermsRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::PatientManager]) {
        return response;
    }
    match super::can_access_order_preparation(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(response) => return response,
    }
    let requested_discount = match body.discount_percent.as_ref() {
        Some(value) => match money::discount_percent_input(Some(value)) {
            Ok(value) => Some(value),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => None,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(%error, %order_id, %leistung_id, "begin order line terms");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let terms_before = match client_terms::lock_before(&mut tx, order_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(error) => {
            tracing::error!(%error, %order_id, "lock order terms for a line change");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let line = match sqlx::query(
        r#"SELECT line.status, line.is_cost_passthrough, line.discount_percent,
                  line.tax_profile_id, line.vat_rate,
                  catalog.tax_profile_id AS catalog_profile_id,
                  EXISTS (
                      SELECT 1 FROM invoice_order_line_allocations allocation
                      JOIN invoices invoice ON invoice.id = allocation.invoice_id
                      WHERE allocation.order_leistung_id = line.id
                        AND invoice.status <> 'cancelled'
                  ) OR EXISTS (
                      SELECT 1 FROM invoices invoice
                      WHERE invoice.order_id = line.order_id
                        AND invoice.status <> 'cancelled'
                        AND invoice.line_items @> jsonb_build_array(
                            jsonb_build_object('source_order_leistung_id', line.id::text))
                  ) AS billed
           FROM order_leistungen line
           LEFT JOIN agency_service_catalog catalog ON catalog.id = line.agency_service_id
           WHERE line.id = $1 AND line.order_id = $2
           FOR UPDATE OF line"#,
    )
    .bind(leistung_id)
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order service not found"),
        Err(error) => {
            tracing::error!(%error, %leistung_id, "load order line for a terms change");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let status = line.try_get::<String, _>("status").unwrap_or_default();
    let billed = line.try_get::<bool, _>("billed").unwrap_or(false);
    if status == "cancelled" {
        return err(StatusCode::CONFLICT, "A cancelled service cannot change");
    }
    if status == "invoiced" || billed {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": LINE_ALREADY_INVOICED,
                "message": "An invoice already bills this service: its discount and VAT stay as billed",
            })),
        )
            .into_response();
    }
    let passthrough = line
        .try_get::<bool, _>("is_cost_passthrough")
        .unwrap_or(false);
    let current_discount = line
        .try_get::<Decimal, _>("discount_percent")
        .unwrap_or(Decimal::ZERO);
    let discount = requested_discount.unwrap_or(current_discount);
    if passthrough && discount > Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A pass-through cost cannot have a discount",
        );
    }
    let current_profile = line
        .try_get::<Option<Uuid>, _>("tax_profile_id")
        .unwrap_or_default();
    let vat_rate = line
        .try_get::<Decimal, _>("vat_rate")
        .unwrap_or(Decimal::ZERO);
    let chosen = body.tax_profile_id.or(current_profile);
    let catalog_profile = line
        .try_get::<Option<Uuid>, _>("catalog_profile_id")
        .unwrap_or_default();
    let profile =
        match line_tax::resolve(&mut tx, chosen, passthrough, catalog_profile, vat_rate).await {
            Ok(Ok(profile)) => profile,
            Ok(Err(message)) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
            Err(error) => {
                tracing::error!(%error, %leistung_id, "resolve the tax profile of a line change");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
    let (profile_id, new_rate) = match profile {
        Some(profile) => (Some(profile.id), profile.vat_rate),
        None => (current_profile, vat_rate),
    };
    if let Err(error) = sqlx::query(
        r#"UPDATE order_leistungen
           SET discount_percent = $2,
               tax_profile_id = $3,
               vat_rate = $4,
               vat_source = CASE WHEN $3::uuid IS NULL THEN vat_source ELSE 'tax_profile' END
           WHERE id = $1"#,
    )
    .bind(leistung_id)
    .bind(discount)
    .bind(profile_id)
    .bind(new_rate)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(%error, %leistung_id, "store order line terms");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = super::sync_order_total_estimated(&mut tx, order_id).await {
        tracing::error!(%error, %order_id, "sync order total after a line change");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let change = match client_terms::settle(
        &mut tx,
        order_id,
        &terms_before,
        body.confirm_signature_reset,
        Some(auth.user_id),
        "order_service_terms",
    )
    .await
    {
        Ok(change) => change,
        Err(client_terms::TermsError::Refused(response)) => return response,
        Err(client_terms::TermsError::Database(error)) => {
            tracing::error!(%error, %order_id, "check signed order terms for a line change");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "update_order_line_terms",
            Some(auth.user_id),
            "order",
            Some(order_id),
            serde_json::json!({
                "leistung_id": leistung_id,
                "discount_percent": discount.to_string(),
                "previous_discount_percent": current_discount.to_string(),
                "tax_profile_id": profile_id,
                "previous_tax_profile_id": current_profile,
                "vat_rate": new_rate.to_string(),
            }),
        ),
    )
    .await
    {
        tracing::error!(%error, %order_id, "audit order line terms");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(%error, %order_id, "commit order line terms");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    Json(serde_json::json!({
        "id": leistung_id,
        "discount_percent": money::money_string(discount),
        "tax_profile_id": profile_id,
        "vat_rate": money::money_string(new_rate),
        "signature_reset": change.signature_reset(),
    }))
    .into_response()
}
