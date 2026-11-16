//! `POST /quotes/{quote_id}/final-preview`: what a final invoice with the
//! given lines would bill and how the order's advances would be set off at
//! its release (owner 2026-11-17), before anything is created.
//!
//! The lines are built by the code that creates the invoice
//! (`build_selected_invoice_snapshot` and the services outside the quote).
//! The set-off follows `advance_application::apply_available_advances_tx`:
//! the issued advances of the order the final invoice settles, oldest first,
//! each per VAT category within what its payments hold
//! (`advance_rows::advance_available_rows`) and what the final invoice still
//! bills in the category (`advance_rows::plan_allocation_rows`). An unpaid
//! advance deducts nothing. Interim invoices of the quote are listed: their
//! quantities are not billed again. The recipient check of the release
//! (another recipient needs a confirmation by number) is not previewed.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::advance_rows;
use super::document::{VatBreakdownRow, advance_vat_rows};
use super::{
    CreateInvoiceLineSelection, build_selected_invoice_snapshot, can_create_invoices,
    closed_quote_invoice_message, decimal_to_string, ensure_patient_access, err, final_delivery,
    load_quote_invoice_context,
};
use crate::auth::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize)]
pub(super) struct FinalPreviewRequest {
    line_items: Option<Vec<CreateInvoiceLineSelection>>,
    #[serde(default)]
    order_services: Vec<final_delivery::OrderServiceSelection>,
}

fn rows_json(rows: &[VatBreakdownRow]) -> Value {
    Value::Array(
        rows.iter()
            .map(|row| {
                json!({
                    "kind": advance_rows::kind_key(row.kind),
                    "vat_rate": decimal_to_string(row.rate),
                    "net": decimal_to_string(row.net),
                    "vat": decimal_to_string(row.vat),
                    "gross": decimal_to_string(row.gross),
                })
            })
            .collect(),
    )
}

pub(super) async fn preview_final_invoice(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(quote_id): Path<Uuid>,
    Json(body): Json<FinalPreviewRequest>,
) -> axum::response::Response {
    const FAILED: &str = "Failed to preview the final invoice";
    if !can_create_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let ctx = match load_quote_invoice_context(&state, quote_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Quote not found"),
        Err(response) => return response,
    };
    if let Err(response) = ensure_patient_access(&state, &auth, ctx.patient_id).await {
        return response;
    }
    if let Some(message) = closed_quote_invoice_message(&ctx.quote_status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let mut snapshot =
        match build_selected_invoice_snapshot(&state, &ctx, "final", body.line_items.as_deref())
            .await
        {
            Ok(value) => value,
            Err(response) => return response,
        };
    if let Err(response) = final_delivery::append_order_service_lines(
        &mut snapshot,
        &ctx,
        "final",
        &body.order_services,
    ) {
        return response;
    }

    let mut conn = match state.db.acquire().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %quote_id, "preview final invoice");
            return err(StatusCode::INTERNAL_SERVER_ERROR, FAILED);
        }
    };
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %quote_id, "preview final invoice");
        err(StatusCode::INTERNAL_SERVER_ERROR, FAILED)
    };
    let advances = match sqlx::query(
        r#"SELECT advance.id, advance.invoice_number, advance.total_gross,
                  advance.credited_amount, advance.paid_amount,
                  GREATEST(
                      LEAST(advance.paid_amount, advance.total_gross - advance.credited_amount)
                      - COALESCE((
                          SELECT SUM(allocation.amount_gross)
                          FROM invoice_prepayment_allocations allocation
                          WHERE allocation.advance_invoice_id = advance.id
                      ), 0),
                      0
                  ) AS available_amount
           FROM invoices advance
           WHERE advance.order_id = $1
             AND advance.patient_id = $2
             AND advance.invoice_type = 'advance'
             AND advance.status NOT IN ('draft', 'cancelled')
             AND (
                 advance.quote_id IS NULL
                 OR advance.quote_id = $3
                 OR EXISTS (
                     SELECT 1 FROM orders settled_order
                     WHERE settled_order.id = advance.order_id
                       AND settled_order.status = 'cancelled'
                 )
                 OR EXISTS (
                     SELECT 1 FROM quotes advance_quote
                     WHERE advance_quote.id = advance.quote_id
                       AND advance_quote.status IN ('superseded', 'rejected', 'expired')
                 )
             )
           ORDER BY advance.release_sequence NULLS FIRST, advance.issued_at, advance.id"#,
    )
    .bind(ctx.order_id)
    .bind(ctx.patient_id)
    .bind(ctx.quote_id)
    .fetch_all(&mut *conn)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return failed(error),
    };

    let mut target_open = advance_vat_rows(&snapshot.line_items, &[]);
    let mut left = snapshot.total_gross;
    let mut deducted_total = Decimal::ZERO;
    let mut advance_items = Vec::with_capacity(advances.len());
    for advance in &advances {
        let advance_id = advance.try_get::<Uuid, _>("id").unwrap_or_default();
        let paid = advance
            .try_get::<Decimal, _>("paid_amount")
            .unwrap_or(Decimal::ZERO);
        let available = advance
            .try_get::<Decimal, _>("available_amount")
            .unwrap_or(Decimal::ZERO);
        let max = available.min(left).max(Decimal::ZERO);
        let mut rows = Vec::new();
        let mut amount = Decimal::ZERO;
        if max > Decimal::ZERO {
            let categorised = match advance_rows::settlement_rows(&mut conn, advance_id).await {
                Ok(value) => value.is_some(),
                Err(error) => return failed(error),
            };
            if categorised {
                let available_rows =
                    match advance_rows::advance_available_rows(&mut conn, advance_id).await {
                        Ok(value) => value,
                        Err(error) => return failed(error),
                    };
                rows = advance_rows::plan_allocation_rows(&available_rows, &target_open, max);
                amount = rows.iter().map(|row| row.gross).sum();
                target_open = advance_rows::subtract_rows(&target_open, &rows);
            } else {
                amount = max;
            }
        }
        left -= amount;
        deducted_total += amount;
        advance_items.push(json!({
            "invoice_id": advance_id,
            "invoice_number": advance.try_get::<Option<String>, _>("invoice_number").unwrap_or_default(),
            "total_gross": decimal_to_string(
                advance.try_get::<Decimal, _>("total_gross").unwrap_or(Decimal::ZERO)
                    - advance.try_get::<Decimal, _>("credited_amount").unwrap_or(Decimal::ZERO),
            ),
            "paid_gross": decimal_to_string(paid),
            "available_gross": decimal_to_string(available),
            "deduction_gross": decimal_to_string(amount),
            "deduction_rows": rows_json(&rows),
        }));
    }

    let interims = match sqlx::query(
        r#"SELECT id, invoice_number, total_gross - credited_amount AS total_gross,
                  status::text AS status
           FROM invoices
           WHERE quote_id = $1
             AND invoice_type = 'interim'
             AND status NOT IN ('draft', 'cancelled')
           ORDER BY release_sequence NULLS FIRST, issued_at, id"#,
    )
    .bind(ctx.quote_id)
    .fetch_all(&mut *conn)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return failed(error),
    };

    Json(json!({
        "total_net": decimal_to_string(snapshot.total_net),
        "total_vat": decimal_to_string(snapshot.total_vat),
        "total_gross": decimal_to_string(snapshot.total_gross),
        "rows": rows_json(&advance_vat_rows(&snapshot.line_items, &[])),
        "advances": advance_items,
        "deducted_gross": decimal_to_string(deducted_total),
        "due_gross": decimal_to_string(snapshot.total_gross - deducted_total),
        "interim_invoices": interims.iter().map(|row| json!({
            "invoice_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "invoice_number": row.try_get::<Option<String>, _>("invoice_number").unwrap_or_default(),
            "total_gross": decimal_to_string(row.try_get::<Decimal, _>("total_gross").unwrap_or(Decimal::ZERO)),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
        })).collect::<Vec<_>>(),
    }))
    .into_response()
}
