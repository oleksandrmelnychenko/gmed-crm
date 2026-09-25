//! Final settlement of orders stopped by framework contract termination.
//!
//! The patient may terminate the framework contract at any time (§ 6 of the
//! client template). Every order still open under the contract then stops:
//! planned services are cancelled and the order is billed for what actually
//! accrued up to the termination:
//!
//! * order services that were delivered, approved or already invoiced, at their
//!   own line prices;
//! * flat fees marked `due_in_full_on_termination` in the catalog (the
//!   treatment-organisation Pauschale), even if they were still planned;
//! * third-party costs (external/provider invoices of the order that are a
//!   patient receivable) unless a delivered pass-through order line already
//!   represents them.
//!
//! `paid` is patient cash on the order's invoices minus refunds and `invoiced`
//! is released non-advance invoices minus credit notes, so
//! `balance = accrued - paid` and `uninvoiced = accrued - invoiced`.
//! The settlement row keeps the snapshot taken at termination; every read also
//! returns the live values billing works against.

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Row, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

use super::{
    CreateInvoiceLineSelection, InvoiceCreationSnapshot, MoneyInput,
    build_selected_invoice_snapshot, can_access_patient, can_create_invoices,
    can_manage_invoice_finance, can_read_invoices, compute_invoice_line_parts, decimal_to_string,
    ensure_patient_access, err, gen_invoice_number, inherited_invoice_payer, invoice_json_decimal,
    load_allocated_quote_quantities, load_invoice_detail, load_quote_invoice_context,
    write_invoice_audit,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::money::CommercialRounding;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// `orders.cancellation_reason` of an order stopped by contract termination.
pub(crate) const CONTRACT_TERMINATED_REASON: &str = "contract_terminated";
/// Invoice line source for services billed directly from the order line
/// because no open quote line covers them.
const TERMINATION_ORDER_SERVICE_SOURCE: &str = "termination_order_service";
const FINAL_INVOICE_NOTE: &str = "Abrechnung der bis zur Kündigung des Rahmendienstleistungsvertrags angefallenen Leistungen und Aufwendungen (§ 6).";

pub fn router() -> axum::Router<AppState> {
    Router::new()
        .route(
            "/invoices/termination-settlements",
            get(list_termination_settlements),
        )
        .route(
            "/orders/{order_id}/termination-settlement",
            get(get_order_termination_settlement),
        )
        .route(
            "/orders/{order_id}/termination-settlement/final-invoice",
            post(create_termination_final_invoice),
        )
        .route(
            "/orders/{order_id}/termination-settlement/settle",
            post(settle_termination_settlement),
        )
        .route(
            "/patients/{patient_id}/termination-settlements",
            get(list_patient_termination_settlements),
        )
}

fn money_tolerance() -> Decimal {
    Decimal::new(1, 2)
}

fn is_zero_money(value: Decimal) -> bool {
    value.abs() < money_tolerance()
}

/// One accrued (or cancelled) position of the settlement breakdown.
#[derive(Clone)]
pub(crate) struct SettlementLine {
    source: &'static str,
    order_leistung_id: Option<Uuid>,
    external_invoice_id: Option<Uuid>,
    description: String,
    unit_label: Option<String>,
    quantity: Decimal,
    unit_price: Decimal,
    vat_rate: Decimal,
    net: Decimal,
    vat: Decimal,
    gross: Decimal,
    status: String,
    due_in_full: bool,
    is_cost_passthrough: bool,
    /// Service quantity not yet covered by an active invoice.
    uninvoiced_quantity: Decimal,
    /// Third-party cost still to be re-invoiced to the patient.
    remaining_receivable_gross: Decimal,
    /// Third-party cost can be put on a patient invoice now (agency paid it).
    billable_now: bool,
    source_document_id: Option<Uuid>,
    source_invoice_date: Option<NaiveDate>,
}

impl SettlementLine {
    fn to_json(&self) -> Value {
        json!({
            "source": self.source,
            "order_leistung_id": self.order_leistung_id,
            "external_invoice_id": self.external_invoice_id,
            "description": self.description,
            "quantity": decimal_to_string(self.quantity),
            "unit_price": decimal_to_string(self.unit_price),
            "vat_rate": decimal_to_string(self.vat_rate),
            "net": decimal_to_string(self.net),
            "vat": decimal_to_string(self.vat),
            "gross": decimal_to_string(self.gross),
            "status": self.status,
            "due_in_full": self.due_in_full,
            "is_cost_passthrough": self.is_cost_passthrough,
        })
    }
}

/// Settlement figures of one order, computed from the current database state.
pub(crate) struct OrderSettlement {
    pub order_id: Uuid,
    pub order_number: String,
    pub order_status: String,
    pub patient_id: Option<Uuid>,
    pub currency: String,
    pub accrued_net: Decimal,
    pub accrued_gross: Decimal,
    pub invoiced_gross: Decimal,
    pub paid_gross: Decimal,
    lines: Vec<SettlementLine>,
    cancelled_lines: Vec<SettlementLine>,
    warnings: Vec<&'static str>,
}

impl OrderSettlement {
    pub fn balance_gross(&self) -> Decimal {
        (self.accrued_gross - self.paid_gross).round_cents()
    }

    pub fn uninvoiced_gross(&self) -> Decimal {
        (self.accrued_gross - self.invoiced_gross).round_cents()
    }

    fn is_balanced(&self) -> bool {
        is_zero_money(self.balance_gross()) && is_zero_money(self.uninvoiced_gross())
    }

    fn lines_json(&self) -> Value {
        Value::Array(self.lines.iter().map(SettlementLine::to_json).collect())
    }

    fn amounts_json(&self) -> Value {
        json!({
            "accrued_net": decimal_to_string(self.accrued_net),
            "accrued_gross": decimal_to_string(self.accrued_gross),
            "invoiced_gross": decimal_to_string(self.invoiced_gross),
            "paid_gross": decimal_to_string(self.paid_gross),
            "balance_gross": decimal_to_string(self.balance_gross()),
            "uninvoiced_gross": decimal_to_string(self.uninvoiced_gross()),
        })
    }

    /// Preview/termination view of an open order.
    fn preview_json(&self) -> Value {
        json!({
            "id": self.order_id,
            "order_number": self.order_number,
            "status": self.order_status,
            "currency": self.currency,
            "accrued_net": decimal_to_string(self.accrued_net),
            "accrued_gross": decimal_to_string(self.accrued_gross),
            "invoiced_gross": decimal_to_string(self.invoiced_gross),
            "paid_gross": decimal_to_string(self.paid_gross),
            "balance_gross": decimal_to_string(self.balance_gross()),
            "uninvoiced_gross": decimal_to_string(self.uninvoiced_gross()),
            "lines": self.lines_json(),
            "cancelled_lines": self.cancelled_lines.iter().map(SettlementLine::to_json).collect::<Vec<_>>(),
            "warnings": self.warnings,
        })
    }
}

/// Compute the settlement of an order from the current state. Planned services
/// that are due in full count as accrued; other planned services are listed as
/// cancelled (termination cancels them).
pub(crate) async fn compute_order_settlement(
    conn: &mut PgConnection,
    order_id: Uuid,
) -> Result<Option<OrderSettlement>, sqlx::Error> {
    let Some(order) = sqlx::query(
        r#"SELECT o.id, o.order_number, o.status,
                  COALESCE(o.patient_id, source_lead.converted_patient_id) AS patient_id,
                  UPPER(o.currency) AS currency
           FROM orders o
           LEFT JOIN leads source_lead ON source_lead.id = o.source_lead_id
           WHERE o.id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let currency = order
        .try_get::<String, _>("currency")
        .unwrap_or_else(|_| "EUR".to_string());

    let service_rows = sqlx::query(
        r#"SELECT service.id,
                  COALESCE(NULLIF(BTRIM(service.agency_service_name_snapshot), ''), service.description)
                      AS description,
                  service.agency_service_unit_label_snapshot AS unit_label,
                  service.status, service.quantity,
                  service.unit_price_snapshot AS unit_price,
                  service.vat_rate_snapshot AS vat_rate,
                  service.is_cost_passthrough,
                  UPPER(service.currency) AS currency,
                  COALESCE(catalog.due_in_full_on_termination, false) AS due_in_full,
                  COALESCE((
                      SELECT SUM(allocation.quantity)
                      FROM invoice_order_line_allocations allocation
                      JOIN invoices invoice ON invoice.id = allocation.invoice_id
                      WHERE allocation.order_leistung_id = service.id
                        AND invoice.status <> 'cancelled'
                  ), 0) AS allocated_quantity
           FROM order_leistungen service
           LEFT JOIN agency_service_catalog catalog ON catalog.id = service.agency_service_id
           WHERE service.order_id = $1
           ORDER BY service.created_at, service.id"#,
    )
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await?;

    let mut lines = Vec::new();
    let mut cancelled_lines = Vec::new();
    let mut warnings = Vec::new();
    let mut accrued_net = Decimal::ZERO;
    let mut accrued_gross = Decimal::ZERO;

    for row in service_rows {
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let due_in_full = row.try_get::<bool, _>("due_in_full").unwrap_or(false);
        let accrued = matches!(status.as_str(), "delivered" | "approved" | "invoiced")
            || (status == "planned" && due_in_full);
        let cancelled = status == "cancelled" || (status == "planned" && !due_in_full);
        if !accrued && !cancelled {
            continue;
        }
        let quantity = row
            .try_get::<Decimal, _>("quantity")
            .unwrap_or(Decimal::ZERO);
        let unit_price = row
            .try_get::<Decimal, _>("unit_price")
            .unwrap_or(Decimal::ZERO);
        let is_cost_passthrough = row
            .try_get::<bool, _>("is_cost_passthrough")
            .unwrap_or(false);
        let vat_rate = if is_cost_passthrough {
            Decimal::ZERO
        } else {
            row.try_get::<Decimal, _>("vat_rate")
                .unwrap_or(Decimal::ZERO)
        };
        if quantity <= Decimal::ZERO
            || unit_price < Decimal::ZERO
            || vat_rate < Decimal::ZERO
            || vat_rate > Decimal::new(100, 0)
        {
            warnings.push("order_service_amount_invalid");
            continue;
        }
        if row.try_get::<String, _>("currency").unwrap_or_default() != currency {
            warnings.push("order_service_currency_mismatch");
            continue;
        }
        let (net, vat, gross) = compute_invoice_line_parts(quantity, unit_price, vat_rate);
        let allocated = row
            .try_get::<Decimal, _>("allocated_quantity")
            .unwrap_or(Decimal::ZERO);
        let line = SettlementLine {
            source: "order_service",
            order_leistung_id: row.try_get::<Uuid, _>("id").ok(),
            external_invoice_id: None,
            description: row.try_get::<String, _>("description").unwrap_or_default(),
            unit_label: row
                .try_get::<Option<String>, _>("unit_label")
                .unwrap_or_default(),
            quantity,
            unit_price,
            vat_rate,
            net,
            vat,
            gross,
            status: status.clone(),
            due_in_full,
            is_cost_passthrough,
            uninvoiced_quantity: if status == "invoiced" {
                Decimal::ZERO
            } else {
                (quantity - allocated).max(Decimal::ZERO)
            },
            remaining_receivable_gross: Decimal::ZERO,
            billable_now: false,
            source_document_id: None,
            source_invoice_date: None,
        };
        if accrued {
            accrued_net += net;
            accrued_gross += gross;
            lines.push(line);
        } else {
            cancelled_lines.push(line);
        }
    }

    // Supplier/clinic invoices that are a patient receivable. A delivered
    // pass-through order line already bills the same cost, so it wins.
    let external_rows = sqlx::query(
        r#"SELECT external.id, external.status, external.paid_by, external.external_invoice_number,
                  external.invoice_date, external.source_document_id,
                  UPPER(external.currency) AS currency,
                  external.patient_receivable_gross,
                  COALESCE(NULLIF(BTRIM(provider.name), ''), external.supplier_name, 'Provider')
                      AS provider_name,
                  settlement.remaining_provider_liability_gross,
                  receivable.remaining_receivable_gross
           FROM external_invoices external
           LEFT JOIN providers provider ON provider.id = external.provider_id
           LEFT JOIN order_leistungen linked_service ON linked_service.id = external.order_leistung_id
           JOIN external_invoice_provider_settlement_balances settlement
             ON settlement.external_invoice_id = external.id
           JOIN external_invoice_receivable_balances receivable
             ON receivable.external_invoice_id = external.id
           WHERE external.order_id = $1
             AND external.invoice_scope = 'patient_order'
             AND external.status <> 'cancelled'
             AND external.patient_receivable_gross > 0
             AND NOT (
                 COALESCE(linked_service.is_cost_passthrough, false)
                 AND linked_service.status IN ('delivered', 'approved', 'invoiced')
             )
           ORDER BY external.invoice_date NULLS LAST, external.created_at, external.id"#,
    )
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await?;
    for row in external_rows {
        if row.try_get::<String, _>("currency").unwrap_or_default() != currency {
            warnings.push("external_invoice_currency_mismatch");
            continue;
        }
        let gross = row
            .try_get::<Decimal, _>("patient_receivable_gross")
            .unwrap_or(Decimal::ZERO)
            .round_cents();
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let remaining_receivable = row
            .try_get::<Decimal, _>("remaining_receivable_gross")
            .unwrap_or(Decimal::ZERO)
            .round_cents();
        let billable_now = status == "paid"
            && row.try_get::<String, _>("paid_by").unwrap_or_default() == "agency"
            && row
                .try_get::<Decimal, _>("remaining_provider_liability_gross")
                .unwrap_or(Decimal::ZERO)
                == Decimal::ZERO
            && remaining_receivable > Decimal::ZERO;
        accrued_net += gross;
        accrued_gross += gross;
        lines.push(SettlementLine {
            source: "third_party_cost",
            order_leistung_id: None,
            external_invoice_id: row.try_get::<Uuid, _>("id").ok(),
            description: format!(
                "{} · {}",
                row.try_get::<String, _>("provider_name")
                    .unwrap_or_else(|_| "Provider".to_string()),
                row.try_get::<String, _>("external_invoice_number")
                    .unwrap_or_default()
            ),
            unit_label: Some("invoice".to_string()),
            quantity: Decimal::ONE,
            unit_price: gross,
            vat_rate: Decimal::ZERO,
            net: gross,
            vat: Decimal::ZERO,
            gross,
            status,
            due_in_full: false,
            is_cost_passthrough: true,
            uninvoiced_quantity: Decimal::ZERO,
            remaining_receivable_gross: remaining_receivable,
            billable_now,
            source_document_id: row
                .try_get::<Option<Uuid>, _>("source_document_id")
                .unwrap_or_default(),
            source_invoice_date: row
                .try_get::<Option<NaiveDate>, _>("invoice_date")
                .unwrap_or_default(),
        });
    }

    let invoiced_gross = sqlx::query_scalar::<_, Decimal>(
        r#"WITH credits AS (
               SELECT transaction.invoice_id,
                      COALESCE(SUM(CASE WHEN transaction.transaction_type = 'credit_note'
                                        THEN transaction.amount_gross ELSE -transaction.amount_gross END), 0)
                          AS amount_gross
               FROM invoice_credit_note_transactions transaction
               JOIN invoices invoice ON invoice.id = transaction.invoice_id
               WHERE invoice.order_id = $1
               GROUP BY transaction.invoice_id
           )
           SELECT COALESCE(SUM(GREATEST(invoice.total_gross - COALESCE(credits.amount_gross, 0), 0)), 0)
           FROM invoices invoice
           LEFT JOIN credits ON credits.invoice_id = invoice.id
           WHERE invoice.order_id = $1
             AND invoice.invoice_type <> 'advance'
             AND invoice.status IN ('sent', 'partially_paid', 'paid', 'overdue')"#,
    )
    .bind(order_id)
    .fetch_one(&mut *conn)
    .await?;

    let paid_gross = sqlx::query_scalar::<_, Decimal>(
        r#"WITH payments AS (
               SELECT COALESCE(SUM(CASE WHEN transaction.transaction_type = 'payment'
                                        THEN transaction.amount_gross ELSE -transaction.amount_gross END), 0)
                          AS amount
               FROM invoice_payment_transactions transaction
               JOIN invoices invoice ON invoice.id = transaction.invoice_id
               WHERE invoice.order_id = $1
                 AND invoice.status <> 'cancelled'
           ), refunds AS (
               SELECT COALESCE(SUM(CASE WHEN transaction.transaction_type = 'refund'
                                        THEN transaction.amount_gross ELSE -transaction.amount_gross END), 0)
                          AS amount
               FROM invoice_refund_transactions transaction
               JOIN invoices invoice ON invoice.id = transaction.invoice_id
               WHERE invoice.order_id = $1
                 AND invoice.status <> 'cancelled'
           )
           SELECT payments.amount - refunds.amount FROM payments CROSS JOIN refunds"#,
    )
    .bind(order_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(Some(OrderSettlement {
        order_id,
        order_number: order
            .try_get::<String, _>("order_number")
            .unwrap_or_default(),
        order_status: order.try_get::<String, _>("status").unwrap_or_default(),
        patient_id: order
            .try_get::<Option<Uuid>, _>("patient_id")
            .unwrap_or_default(),
        currency,
        accrued_net: accrued_net.round_cents(),
        accrued_gross: accrued_gross.round_cents(),
        invoiced_gross: invoiced_gross.round_cents(),
        paid_gross: paid_gross.round_cents(),
        lines,
        cancelled_lines,
        warnings,
    }))
}

/// Settlement preview of every order still open under a contract; nothing is
/// written.
pub(crate) async fn preview_open_orders(
    state: &AppState,
    contract_id: Uuid,
) -> Result<Vec<Value>, sqlx::Error> {
    let mut transaction = state.db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *transaction)
        .await?;
    let order_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM orders
           WHERE contract_id = $1 AND status IN ('active', 'paused')
           ORDER BY created_at, order_number"#,
    )
    .bind(contract_id)
    .fetch_all(&mut *transaction)
    .await?;
    let mut previews = Vec::with_capacity(order_ids.len());
    for order_id in order_ids {
        if let Some(settlement) = compute_order_settlement(&mut transaction, order_id).await? {
            previews.push(settlement.preview_json());
        }
    }
    transaction.commit().await?;
    Ok(previews)
}

/// An order stopped by a contract termination inside the termination
/// transaction; used for the response, audit and realtime events after commit.
pub(crate) struct TerminatedOrder {
    order_id: Uuid,
    order_number: String,
    previous_status: String,
    settlement_id: Option<Uuid>,
    settlement_status: Option<&'static str>,
    accrued_gross: Decimal,
    invoiced_gross: Decimal,
    paid_gross: Decimal,
    balance_gross: Decimal,
    uninvoiced_gross: Decimal,
    cancelled_services: u64,
    flat_fees_due: u64,
}

impl TerminatedOrder {
    pub fn summary_json(&self) -> Value {
        json!({
            "order_id": self.order_id,
            "order_number": self.order_number,
            "settlement_id": self.settlement_id,
            "settlement_status": self.settlement_status,
            "accrued_gross": decimal_to_string(self.accrued_gross),
            "invoiced_gross": decimal_to_string(self.invoiced_gross),
            "paid_gross": decimal_to_string(self.paid_gross),
            "balance_gross": decimal_to_string(self.balance_gross),
            "uninvoiced_gross": decimal_to_string(self.uninvoiced_gross),
            "cancelled_services": self.cancelled_services,
            "flat_fees_due": self.flat_fees_due,
        })
    }
}

/// Stop every active/paused order under the contract and snapshot its final
/// settlement. Runs inside the caller's termination transaction.
pub(crate) async fn terminate_open_orders_tx(
    transaction: &mut Transaction<'_, Postgres>,
    contract_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Vec<TerminatedOrder>, sqlx::Error> {
    let orders = sqlx::query(
        r#"SELECT id, order_number, status
           FROM orders
           WHERE contract_id = $1 AND status IN ('active', 'paused')
           ORDER BY created_at, order_number
           FOR UPDATE"#,
    )
    .bind(contract_id)
    .fetch_all(&mut **transaction)
    .await?;

    let mut terminated = Vec::with_capacity(orders.len());
    for order in orders {
        let order_id = order.try_get::<Uuid, _>("id")?;
        let previous_status = order.try_get::<String, _>("status").unwrap_or_default();

        // Flat fees are owed in full on termination (§ 6): they count as
        // delivered now. Everything else still planned is cancelled.
        let flat_fees_due = sqlx::query(
            r#"UPDATE order_leistungen service
               SET status = 'delivered',
                   delivered_at = COALESCE(service.delivered_at, now())
               FROM agency_service_catalog catalog
               WHERE service.order_id = $1
                 AND service.status = 'planned'
                 AND catalog.id = service.agency_service_id
                 AND catalog.due_in_full_on_termination"#,
        )
        .bind(order_id)
        .execute(&mut **transaction)
        .await?
        .rows_affected();
        let cancelled_services = sqlx::query(
            "UPDATE order_leistungen SET status = 'cancelled' WHERE order_id = $1 AND status = 'planned'",
        )
        .bind(order_id)
        .execute(&mut **transaction)
        .await?
        .rows_affected();

        let settlement = compute_order_settlement(transaction, order_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        sqlx::query(
            r#"UPDATE orders
               SET status = 'cancelled',
                   cancellation_reason = $2,
                   cancelled_at = now()
               WHERE id = $1"#,
        )
        .bind(order_id)
        .bind(CONTRACT_TERMINATED_REASON)
        .execute(&mut **transaction)
        .await?;

        // Nothing accrued, invoiced or paid: there is nothing for billing to
        // settle, so the settlement is closed right away.
        let nothing_to_settle = settlement.accrued_gross.is_zero()
            && settlement.invoiced_gross.is_zero()
            && settlement.paid_gross.is_zero();
        let (settlement_id, settlement_status) = match settlement.patient_id {
            Some(patient_id) => {
                let status = if nothing_to_settle { "settled" } else { "open" };
                let settlement_id = sqlx::query_scalar::<_, Uuid>(
                    r#"INSERT INTO order_termination_settlements (
                           order_id, patient_id, contract_id, terminated_at, currency,
                           accrued_net, accrued_gross, invoiced_gross, paid_gross,
                           balance_gross, uninvoiced_gross, lines, status,
                           settled_at, settled_by, settlement_note, settled_balance_gross,
                           created_by
                       ) VALUES (
                           $1, $2, $3, now(), $4,
                           $5, $6, $7, $8,
                           $9, $10, $11, $12,
                           CASE WHEN $12 = 'settled' THEN now() END,
                           CASE WHEN $12 = 'settled' THEN $13::uuid END,
                           CASE WHEN $12 = 'settled' THEN 'Nothing accrued, invoiced or paid' END,
                           CASE WHEN $12 = 'settled' THEN 0::numeric END,
                           $13
                       )
                       RETURNING id"#,
                )
                .bind(order_id)
                .bind(patient_id)
                .bind(contract_id)
                .bind(&settlement.currency)
                .bind(settlement.accrued_net)
                .bind(settlement.accrued_gross)
                .bind(settlement.invoiced_gross)
                .bind(settlement.paid_gross)
                .bind(settlement.balance_gross())
                .bind(settlement.uninvoiced_gross())
                .bind(settlement.lines_json())
                .bind(status)
                .bind(actor_user_id)
                .fetch_one(&mut **transaction)
                .await?;
                (Some(settlement_id), Some(status))
            }
            // A lead-only order has no patient to bill; it is only stopped.
            None => (None, None),
        };

        terminated.push(TerminatedOrder {
            order_id,
            order_number: settlement.order_number.clone(),
            previous_status,
            settlement_id,
            settlement_status,
            accrued_gross: settlement.accrued_gross,
            invoiced_gross: settlement.invoiced_gross,
            paid_gross: settlement.paid_gross,
            balance_gross: settlement.balance_gross(),
            uninvoiced_gross: settlement.uninvoiced_gross(),
            cancelled_services,
            flat_fees_due,
        });
    }
    Ok(terminated)
}

/// Audit and realtime events for orders stopped by a committed termination.
pub(crate) async fn publish_terminated_orders(
    state: &AppState,
    actor_user_id: Uuid,
    contract_id: Uuid,
    orders: &[TerminatedOrder],
) {
    for order in orders {
        let mut payload = order.summary_json();
        payload["contract_id"] = json!(contract_id);
        payload["from_status"] = json!(order.previous_status);
        payload["status"] = json!("cancelled");
        payload["cancellation_reason"] = json!(CONTRACT_TERMINATED_REASON);
        state.audit_sender.try_send(audit::domain_event(
            "terminate_order_for_contract",
            Some(actor_user_id),
            "order",
            Some(order.order_id),
            payload.clone(),
        ));
        crate::realtime::publish_order_event(
            state,
            Some(actor_user_id),
            "order.status_changed",
            order.order_id,
            payload,
        )
        .await;
    }
}

#[derive(Default)]
struct SettlementFilter {
    order_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    status: Option<String>,
}

async fn load_settlement_payloads(
    state: &AppState,
    filter: SettlementFilter,
) -> Result<Vec<(Uuid, Value)>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT settlement.id, settlement.order_id, settlement.patient_id, settlement.contract_id,
                  settlement.terminated_at, settlement.currency, settlement.status,
                  settlement.accrued_net, settlement.accrued_gross, settlement.invoiced_gross,
                  settlement.paid_gross, settlement.balance_gross, settlement.uninvoiced_gross,
                  settlement.lines, settlement.final_invoice_id, settlement.settled_at,
                  settlement.settlement_note, settlement.settlement_forced,
                  settlement.settled_balance_gross, settlement.created_at,
                  patient_order.order_number, patient_order.status AS order_status,
                  patient.patient_id AS patient_pid,
                  CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
                  contract.contract_number,
                  settler.name AS settled_by_name,
                  creator.name AS created_by_name,
                  final_invoice.invoice_number AS final_invoice_number,
                  final_invoice.status AS final_invoice_status,
                  final_invoice.total_gross AS final_invoice_total_gross
           FROM order_termination_settlements settlement
           JOIN orders patient_order ON patient_order.id = settlement.order_id
           JOIN patients patient ON patient.id = settlement.patient_id
           LEFT JOIN framework_contracts contract ON contract.id = settlement.contract_id
           LEFT JOIN users settler ON settler.id = settlement.settled_by
           LEFT JOIN users creator ON creator.id = settlement.created_by
           LEFT JOIN invoices final_invoice ON final_invoice.id = settlement.final_invoice_id
           WHERE ($1::uuid IS NULL OR settlement.order_id = $1)
             AND ($2::uuid IS NULL OR settlement.patient_id = $2)
             AND ($3::text IS NULL OR settlement.status = $3)
           ORDER BY settlement.terminated_at DESC, settlement.id DESC
           LIMIT 500"#,
    )
    .bind(filter.order_id)
    .bind(filter.patient_id)
    .bind(filter.status)
    .fetch_all(&state.db)
    .await?;

    let mut connection = state.db.acquire().await?;
    let mut payloads = Vec::with_capacity(rows.len());
    for row in rows {
        let order_id = row.try_get::<Uuid, _>("order_id")?;
        let patient_id = row.try_get::<Uuid, _>("patient_id")?;
        let current = compute_order_settlement(&mut connection, order_id).await?;
        let decimal = |column: &str| {
            decimal_to_string(row.try_get::<Decimal, _>(column).unwrap_or(Decimal::ZERO))
        };
        let final_invoice_id = row
            .try_get::<Option<Uuid>, _>("final_invoice_id")
            .unwrap_or_default();
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let (current_json, can_settle) = match current.as_ref() {
            Some(current) => {
                let mut amounts = current.amounts_json();
                amounts["warnings"] = json!(current.warnings);
                (amounts, status == "open" && current.is_balanced())
            }
            None => (Value::Null, false),
        };
        payloads.push((
            patient_id,
            json!({
                "id": row.try_get::<Uuid, _>("id")?,
                "order_id": order_id,
                "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                "order_status": row.try_get::<String, _>("order_status").unwrap_or_default(),
                "patient_id": patient_id,
                "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
                "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
                "contract_id": row.try_get::<Uuid, _>("contract_id").ok(),
                "contract_number": row.try_get::<Option<String>, _>("contract_number").unwrap_or_default(),
                "terminated_at": row.try_get::<DateTime<Utc>, _>("terminated_at").ok().map(|value| value.to_rfc3339()),
                "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
                "status": status,
                "snapshot": {
                    "accrued_net": decimal("accrued_net"),
                    "accrued_gross": decimal("accrued_gross"),
                    "invoiced_gross": decimal("invoiced_gross"),
                    "paid_gross": decimal("paid_gross"),
                    "balance_gross": decimal("balance_gross"),
                    "uninvoiced_gross": decimal("uninvoiced_gross"),
                },
                "current": current_json,
                "can_settle": can_settle,
                "lines": row.try_get::<Value, _>("lines").unwrap_or_else(|_| json!([])),
                "final_invoice": final_invoice_id.map(|id| json!({
                    "id": id,
                    "invoice_number": row.try_get::<Option<String>, _>("final_invoice_number").unwrap_or_default(),
                    "status": row.try_get::<Option<String>, _>("final_invoice_status").unwrap_or_default(),
                    "total_gross": row.try_get::<Option<Decimal>, _>("final_invoice_total_gross").unwrap_or_default().map(decimal_to_string),
                })),
                "settled_at": row.try_get::<Option<DateTime<Utc>>, _>("settled_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "settled_by_name": row.try_get::<Option<String>, _>("settled_by_name").unwrap_or_default(),
                "settlement_note": row.try_get::<Option<String>, _>("settlement_note").unwrap_or_default(),
                "settlement_forced": row.try_get::<bool, _>("settlement_forced").unwrap_or(false),
                "settled_balance_gross": row.try_get::<Option<Decimal>, _>("settled_balance_gross").unwrap_or_default().map(decimal_to_string),
                "created_at": row.try_get::<DateTime<Utc>, _>("created_at").ok().map(|value| value.to_rfc3339()),
                "created_by_name": row.try_get::<Option<String>, _>("created_by_name").unwrap_or_default(),
            }),
        ));
    }
    Ok(payloads)
}

async fn load_order_settlement_payload(
    state: &AppState,
    order_id: Uuid,
) -> Result<Option<Value>, axum::response::Response> {
    load_settlement_payloads(
        state,
        SettlementFilter {
            order_id: Some(order_id),
            ..SettlementFilter::default()
        },
    )
    .await
    .map(|mut payloads| payloads.pop().map(|(_, payload)| payload))
    .map_err(|error| {
        tracing::error!(%error, %order_id, "load termination settlement");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load termination settlement",
        )
    })
}

/// Patient of the order's settlement, or 404.
async fn load_settlement_patient(
    state: &AppState,
    order_id: Uuid,
) -> Result<Uuid, axum::response::Response> {
    match sqlx::query_scalar::<_, Uuid>(
        "SELECT patient_id FROM order_termination_settlements WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(patient_id)) => Ok(patient_id),
        Ok(None) => Err(err(
            StatusCode::NOT_FOUND,
            "Order has no termination settlement",
        )),
        Err(error) => {
            tracing::error!(%error, %order_id, "load termination settlement patient");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load termination settlement",
            ))
        }
    }
}

async fn get_order_termination_settlement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if !auth
        .role
        .can_any(&[Capability::OrdersView, Capability::InvoicesView])
    {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let patient_id = match load_settlement_patient(&state, order_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    match load_order_settlement_payload(&state, order_id).await {
        Ok(Some(payload)) => Json(payload).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Order has no termination settlement"),
        Err(response) => response,
    }
}

async fn list_patient_termination_settlements(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    match load_settlement_payloads(
        &state,
        SettlementFilter {
            patient_id: Some(patient_id),
            ..SettlementFilter::default()
        },
    )
    .await
    {
        Ok(payloads) => Json(
            payloads
                .into_iter()
                .map(|(_, payload)| payload)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(%error, %patient_id, "list patient termination settlements");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load termination settlements",
            )
        }
    }
}

#[derive(Deserialize)]
struct ListTerminationSettlementsQuery {
    status: Option<String>,
}

/// Billing queue of termination settlements (default: open ones).
async fn list_termination_settlements(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListTerminationSettlementsQuery>,
) -> axum::response::Response {
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let status = match query.status.as_deref().map(str::trim) {
        None | Some("") | Some("open") => Some("open".to_string()),
        Some("settled") => Some("settled".to_string()),
        Some("all") => None,
        Some(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "status must be open, settled or all",
            );
        }
    };
    let payloads = match load_settlement_payloads(
        &state,
        SettlementFilter {
            status,
            ..SettlementFilter::default()
        },
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "list termination settlements");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load termination settlements",
            );
        }
    };
    let mut visible = Vec::with_capacity(payloads.len());
    for (patient_id, payload) in payloads {
        match can_access_patient(&state, &auth, patient_id).await {
            Ok(true) => visible.push(payload),
            Ok(false) => {}
            Err(response) => return response,
        }
    }
    Json(visible).into_response()
}

/// Create the draft final invoice for what accrued but is not invoiced yet.
///
/// Services covered by an open quote line are billed through that quote (the
/// normal allocation path, with the "every remaining line" rule relaxed for
/// terminated orders); services outside any quote are billed from the order
/// line itself; agency-paid third-party costs are re-invoiced like in the
/// patient billing constructor. Paid advances are applied after release through
/// the regular prepayment allocation endpoint (the draft lists them under
/// `available_prepayments`).
async fn create_termination_final_invoice(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_create_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let patient_id = match load_settlement_patient(&state, order_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %order_id, "create termination final invoice");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create final invoice",
        )
    };

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => return failed(error),
    };
    let locked = match sqlx::query(
        r#"SELECT settlement.id, settlement.status, settlement.final_invoice_id,
                  final_invoice.status AS final_invoice_status
           FROM order_termination_settlements settlement
           LEFT JOIN invoices final_invoice ON final_invoice.id = settlement.final_invoice_id
           WHERE settlement.order_id = $1
           FOR UPDATE OF settlement"#,
    )
    .bind(order_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(StatusCode::NOT_FOUND, "Order has no termination settlement");
        }
        Err(error) => return failed(error),
    };
    let settlement_id = locked.try_get::<Uuid, _>("id").unwrap_or_default();
    if locked.try_get::<String, _>("status").unwrap_or_default() == "settled" {
        return err(
            StatusCode::CONFLICT,
            "The termination settlement is already closed",
        );
    }
    if let Some(existing_invoice_id) = locked
        .try_get::<Option<Uuid>, _>("final_invoice_id")
        .unwrap_or_default()
        && locked
            .try_get::<Option<String>, _>("final_invoice_status")
            .unwrap_or_default()
            .as_deref()
            == Some("draft")
    {
        drop(transaction);
        return match load_invoice_detail(&state, existing_invoice_id, &auth).await {
            Ok(Some(mut invoice)) => {
                invoice["idempotent_replay"] = json!(true);
                invoice["termination_settlement_id"] = json!(settlement_id);
                Json(invoice).into_response()
            }
            Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
            Err(response) => response,
        };
    }

    let settlement = match compute_order_settlement(&mut transaction, order_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(error) => return failed(error),
    };

    // Uninvoiced quantity per accrued service.
    let mut remaining = settlement
        .lines
        .iter()
        .filter(|line| line.source == "order_service" && line.uninvoiced_quantity > Decimal::ZERO)
        .filter_map(|line| {
            line.order_leistung_id
                .map(|service_id| (service_id, line.uninvoiced_quantity))
        })
        .collect::<BTreeMap<_, _>>();

    // Bill through the latest quote that can still take a final invoice.
    let anchor_quote_id = match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT quote.id
           FROM quotes quote
           WHERE quote.order_id = $1
             AND quote.status NOT IN ('rejected', 'expired')
             AND NOT EXISTS (
                 SELECT 1 FROM invoices invoice
                 WHERE invoice.quote_id = quote.id
                   AND invoice.invoice_type = 'final'
                   AND invoice.status <> 'cancelled'
             )
           ORDER BY quote.created_at DESC, quote.id DESC
           LIMIT 1"#,
    )
    .bind(order_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(error) => return failed(error),
    };

    let mut snapshot = InvoiceCreationSnapshot {
        total_net: Decimal::ZERO,
        total_vat: Decimal::ZERO,
        total_gross: Decimal::ZERO,
        line_items: Value::Array(Vec::new()),
        allocations: Vec::new(),
    };
    let mut invoice_quote_id = None;
    if let Some(quote_id) = anchor_quote_id {
        let context = match load_quote_invoice_context(&state, quote_id).await {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::CONFLICT, "Quote changed; reload and try again"),
            Err(response) => return response,
        };
        let allocated = match load_allocated_quote_quantities(&state, quote_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
        let mut selections = Vec::new();
        for (line_index, item) in context
            .line_items
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let Some(service_id) = item
                .get("source_order_leistung_id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            let Some(service_remaining) = remaining.get_mut(&service_id) else {
                continue;
            };
            let quoted = invoice_json_decimal(item, "quantity")
                .unwrap_or(Decimal::ZERO)
                .round_commercial(2);
            let quote_remaining = (quoted
                - allocated
                    .get(&line_index)
                    .copied()
                    .unwrap_or(Decimal::ZERO)
                    .round_commercial(2))
            .max(Decimal::ZERO);
            let quantity = service_remaining.round_commercial(2).min(quote_remaining);
            if quantity <= Decimal::ZERO {
                continue;
            }
            *service_remaining = (*service_remaining - quantity).max(Decimal::ZERO);
            selections.push(CreateInvoiceLineSelection {
                line_index,
                quantity: MoneyInput::String(decimal_to_string(quantity)),
            });
        }
        if !selections.is_empty() {
            snapshot = match build_selected_invoice_snapshot(
                &state,
                &context,
                "final",
                Some(selections.as_slice()),
            )
            .await
            {
                Ok(value) => value,
                Err(response) => return response,
            };
            invoice_quote_id = Some(quote_id);
        }
    }

    let mut invoiced_service_ids = snapshot
        .allocations
        .iter()
        .filter_map(|allocation| allocation.order_leistung_id)
        .collect::<Vec<_>>();
    let mut external_allocations = Vec::new();
    {
        let Some(line_items) = snapshot.line_items.as_array_mut() else {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create final invoice",
            );
        };
        for line in &settlement.lines {
            match line.source {
                "order_service" => {
                    let Some(service_id) = line.order_leistung_id else {
                        continue;
                    };
                    let quantity = remaining.get(&service_id).copied().unwrap_or_default();
                    if quantity <= Decimal::ZERO {
                        continue;
                    }
                    let (line_net, line_vat, line_gross) =
                        compute_invoice_line_parts(quantity, line.unit_price, line.vat_rate);
                    line_items.push(json!({
                        "description": line.description,
                        "quantity": decimal_to_string(quantity),
                        "unit": line.unit_label.clone().unwrap_or_else(|| "unit".to_string()),
                        "unit_price": decimal_to_string(line.unit_price),
                        "vat_rate": decimal_to_string(line.vat_rate),
                        "line_net": decimal_to_string(line_net),
                        "line_vat": decimal_to_string(line_vat),
                        "line_gross": decimal_to_string(line_gross),
                        "is_cost_passthrough": line.is_cost_passthrough,
                        "source": TERMINATION_ORDER_SERVICE_SOURCE,
                        "source_order_leistung_id": service_id,
                    }));
                    snapshot.total_net = (snapshot.total_net + line_net).round_cents();
                    snapshot.total_vat = (snapshot.total_vat + line_vat).round_cents();
                    snapshot.total_gross = (snapshot.total_gross + line_gross).round_cents();
                    invoiced_service_ids.push(service_id);
                }
                "third_party_cost" => {
                    let Some(external_id) = line.external_invoice_id else {
                        continue;
                    };
                    if !line.billable_now || line.remaining_receivable_gross <= Decimal::ZERO {
                        continue;
                    }
                    let amount = line.remaining_receivable_gross;
                    line_items.push(json!({
                        "description": line.description,
                        "quantity": "1",
                        "unit": "invoice",
                        "unit_price": decimal_to_string(amount),
                        "vat_rate": "0",
                        "line_net": decimal_to_string(amount),
                        "line_vat": "0",
                        "line_gross": decimal_to_string(amount),
                        "is_cost_passthrough": true,
                        "source": "external_invoice",
                        "source_external_invoice_id": external_id,
                        "source_document_id": line.source_document_id,
                        "source_order_id": order_id,
                        "source_invoice_date": line.source_invoice_date,
                    }));
                    snapshot.total_net = (snapshot.total_net + amount).round_cents();
                    snapshot.total_gross = (snapshot.total_gross + amount).round_cents();
                    external_allocations.push((external_id, amount));
                }
                _ => {}
            }
        }
        if line_items.is_empty() {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({
                    "error": "nothing_to_invoice",
                    "message": "Everything that accrued is already invoiced or not yet billable",
                })),
            )
                .into_response();
        }
    }
    invoiced_service_ids.sort();
    invoiced_service_ids.dedup();

    let seq: i64 = match sqlx::query_scalar("SELECT nextval('invoice_number_seq')")
        .fetch_one(&mut *transaction)
        .await
    {
        Ok(value) => value,
        Err(error) => return failed(error),
    };
    let invoice_number = gen_invoice_number(seq);
    let payer = inherited_invoice_payer(&state.db, order_id, patient_id).await;
    let invoice_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoices (
                quote_id, order_id, patient_id, invoice_number, invoice_type, status,
                total_net, total_vat, total_gross, line_items, notes, created_by,
                payer_patient_relation_id, payer_contact_name, payer_contact_email,
                payer_contact_phone, payer_contact_relationship, payer_notes
           ) VALUES ($1, $2, $3, $4, 'final', 'draft', $5, $6, $7, $8, $9, $10,
                     $11, $12, $13, $14, $15, $16)
           RETURNING id"#,
    )
    .bind(invoice_quote_id)
    .bind(order_id)
    .bind(patient_id)
    .bind(&invoice_number)
    .bind(snapshot.total_net)
    .bind(snapshot.total_vat)
    .bind(snapshot.total_gross)
    .bind(snapshot.line_items.clone())
    .bind(FINAL_INVOICE_NOTE)
    .bind(auth.user_id)
    .bind(payer.payer_patient_relation_id)
    .bind(payer.payer_contact_name)
    .bind(payer.payer_contact_email)
    .bind(payer.payer_contact_phone)
    .bind(payer.payer_contact_relationship)
    .bind(payer.payer_notes)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(value) => value,
        Err(sqlx::Error::Database(db_error))
            if matches!(
                db_error.code().as_deref(),
                Some("23505" | "23514" | "P0001")
            ) =>
        {
            return err(
                StatusCode::CONFLICT,
                "Invoices of this order changed; reload and try again",
            );
        }
        Err(error) => return failed(error),
    };

    if let Some(quote_id) = invoice_quote_id {
        for allocation in &snapshot.allocations {
            if let Err(error) = sqlx::query(
                r#"INSERT INTO invoice_order_line_allocations (
                       invoice_id, quote_id, quote_line_index, order_leistung_id, quantity,
                       description_snapshot, unit_price_net_snapshot, vat_rate_snapshot,
                       amount_net_snapshot, amount_vat_snapshot, amount_gross_snapshot)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
            )
            .bind(invoice_id)
            .bind(quote_id)
            .bind(allocation.quote_line_index)
            .bind(allocation.order_leistung_id)
            .bind(allocation.quantity)
            .bind(&allocation.description)
            .bind(allocation.unit_price_net)
            .bind(allocation.vat_rate)
            .bind(allocation.amount_net)
            .bind(allocation.amount_vat)
            .bind(allocation.amount_gross)
            .execute(&mut *transaction)
            .await
            {
                tracing::error!(%error, %invoice_id, "insert termination final invoice allocation");
                return err(
                    StatusCode::CONFLICT,
                    "Invoice quantities changed; reload and try again",
                );
            }
        }
    }
    for (external_id, amount) in &external_allocations {
        if let Err(error) = sqlx::query(
            r#"INSERT INTO external_invoice_patient_invoice_allocations
                  (external_invoice_id, patient_invoice_id, amount_gross, created_by, request_id)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(external_id)
        .bind(invoice_id)
        .bind(amount)
        .bind(auth.user_id)
        .bind(Uuid::new_v4())
        .execute(&mut *transaction)
        .await
        {
            tracing::error!(%error, %invoice_id, %external_id, "reserve termination third-party cost");
            return err(
                StatusCode::CONFLICT,
                "A third-party invoice was billed by another draft; reload and try again",
            );
        }
    }
    if !invoiced_service_ids.is_empty()
        && let Err(error) = sqlx::query(
            "UPDATE order_leistungen SET status = 'invoiced'
             WHERE order_id = $1 AND id = ANY($2) AND status <> 'invoiced'",
        )
        .bind(order_id)
        .bind(&invoiced_service_ids)
        .execute(&mut *transaction)
        .await
    {
        return failed(error);
    }
    if let Err(error) =
        sqlx::query("UPDATE order_termination_settlements SET final_invoice_id = $2 WHERE id = $1")
            .bind(settlement_id)
            .bind(invoice_id)
            .execute(&mut *transaction)
            .await
    {
        return failed(error);
    }

    if let Err(error) = transaction.commit().await {
        return failed(error);
    }

    write_invoice_audit(
        &state,
        auth.user_id,
        "create_termination_final_invoice",
        invoice_id,
        json!({
            "order_id": order_id,
            "patient_id": patient_id,
            "quote_id": invoice_quote_id,
            "termination_settlement_id": settlement_id,
            "service_line_count": invoiced_service_ids.len(),
            "external_invoice_count": external_allocations.len(),
            "total_gross": decimal_to_string(snapshot.total_gross),
        }),
    )
    .await;
    crate::realtime::publish_invoice_event(
        &state,
        Some(auth.user_id),
        "invoice.created",
        invoice_id,
        json!({
            "invoice_number": invoice_number,
            "invoice_type": "final",
            "order_id": order_id,
            "patient_id": patient_id,
            "status": "draft",
            "termination_settlement_id": settlement_id,
        }),
    )
    .await;
    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(mut invoice)) => {
            invoice["idempotent_replay"] = json!(false);
            invoice["termination_settlement_id"] = json!(settlement_id);
            (StatusCode::CREATED, Json(invoice)).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

#[derive(Deserialize)]
struct SettleTerminationSettlementRequest {
    note: Option<String>,
    force: Option<bool>,
}

/// Close a termination settlement. Allowed when the live balance and the
/// uninvoiced amount are zero; `force` (with a note) records a write-off.
async fn settle_termination_settlement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<SettleTerminationSettlementRequest>,
) -> axum::response::Response {
    if !can_manage_invoice_finance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let patient_id = match load_settlement_patient(&state, order_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    let force = body.force.unwrap_or(false);
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if note
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1000)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The settlement note cannot exceed 1000 characters",
        );
    }
    if force && note.as_ref().is_none_or(|value| value.chars().count() < 3) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A note of at least 3 characters is required to settle with an open balance",
        );
    }
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %order_id, "settle termination settlement");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to settle termination settlement",
        )
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => return failed(error),
    };
    let (settlement_id, status) = match sqlx::query(
        "SELECT id, status FROM order_termination_settlements WHERE order_id = $1 FOR UPDATE",
    )
    .bind(order_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => (
            row.try_get::<Uuid, _>("id").unwrap_or_default(),
            row.try_get::<String, _>("status").unwrap_or_default(),
        ),
        Ok(None) => {
            return err(StatusCode::NOT_FOUND, "Order has no termination settlement");
        }
        Err(error) => return failed(error),
    };
    if status == "settled" {
        return err(
            StatusCode::CONFLICT,
            "The termination settlement is already closed",
        );
    }
    let current = match compute_order_settlement(&mut transaction, order_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(error) => return failed(error),
    };
    let balanced = current.is_balanced();
    if !balanced && !force {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": "termination_settlement_not_balanced",
                "message": "Balance and uninvoiced amount must be zero; settle with force and a note to write off the difference",
                "current": current.amounts_json(),
            })),
        )
            .into_response();
    }
    let forced = !balanced;
    if let Err(error) = sqlx::query(
        r#"UPDATE order_termination_settlements
           SET status = 'settled',
               settled_at = now(),
               settled_by = $2,
               settlement_note = $3,
               settlement_forced = $4,
               settled_balance_gross = $5
           WHERE id = $1"#,
    )
    .bind(settlement_id)
    .bind(auth.user_id)
    .bind(&note)
    .bind(forced)
    .bind(current.balance_gross())
    .execute(&mut *transaction)
    .await
    {
        return failed(error);
    }
    if let Err(error) = transaction.commit().await {
        return failed(error);
    }

    let payload = json!({
        "termination_settlement_id": settlement_id,
        "forced": forced,
        "balance_gross": decimal_to_string(current.balance_gross()),
        "uninvoiced_gross": decimal_to_string(current.uninvoiced_gross()),
        "has_note": note.is_some(),
    });
    state.audit_sender.try_send(audit::domain_event(
        "settle_order_termination_settlement",
        Some(auth.user_id),
        "order",
        Some(order_id),
        payload.clone(),
    ));
    crate::realtime::publish_order_event(
        &state,
        Some(auth.user_id),
        "order.termination_settlement_settled",
        order_id,
        payload,
    )
    .await;

    match load_order_settlement_payload(&state, order_id).await {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Order has no termination settlement"),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gmed_domain::role::Role;

    #[test]
    fn money_tolerance_treats_sub_cent_differences_as_zero() {
        assert!(is_zero_money(Decimal::new(4, 3)));
        assert!(is_zero_money(Decimal::new(-9, 3)));
        assert!(!is_zero_money(Decimal::new(1, 2)));
        assert!(!is_zero_money(Decimal::new(-1, 2)));
    }

    #[test]
    fn settlement_role_matrix_matches_invoice_capabilities() {
        assert!(Role::Billing.can(Capability::InvoicesFinance));
        assert!(!Role::PatientManager.can(Capability::InvoicesFinance));
        assert!(!Role::Interpreter.can_any(&[Capability::OrdersView, Capability::InvoicesView]));
    }
}
