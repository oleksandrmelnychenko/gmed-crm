//! Cancelling an order service whose billing is already in force (owner
//! decision 2026-09-29).
//!
//! * A planned, delivered or approved service that no released invoice bills
//!   is cancelled with a reason (`cancelled`, who, when, why).
//! * A service a released invoice bills cannot simply be cancelled: released
//!   invoices are final (GoBD). In the same transaction every such invoice
//!   gets a credit note for the service's line (gapless `CN-` number, VAT per
//!   rate, balances, archived PDF, audit) through the ordinary credit-note
//!   machinery, then the service is cancelled. Payments on the invoice follow
//!   the credit-note rules (an overpayment becomes a credit balance).
//! * A service on a draft invoice is refused: draft lines cannot be edited, so
//!   the draft is cancelled first (which frees the service) and the service
//!   is cancelled afterwards. The answer names the draft.
//!
//! Callers check order/patient access and commit the transaction; when the
//! commit fails they discard the archived documents
//! ([`ServiceReversal::discard_documents`]).

use axum::{Json, http::StatusCode, response::IntoResponse};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Row, Transaction};
use uuid::Uuid;

use super::credit_notes::{self, CreditSelection};
use super::{
    CreditNoteIssue, InvoicePaymentContext, IssuedCreditNote, decimal_to_string,
    issue_credit_note_locked, load_invoice_for_credit_note,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub(crate) const ALREADY_CANCELLED_CODE: &str = "order_service_already_cancelled";
pub(crate) const ON_DRAFT_INVOICE_CODE: &str = "order_service_on_draft_invoice";
pub(crate) const REQUIRES_CREDIT_NOTE_CODE: &str = "order_service_cancel_requires_credit_note";
pub(crate) const REQUIRES_FINANCE_CODE: &str = "order_service_reversal_requires_finance";
pub(crate) const INVOICE_LINE_UNKNOWN_CODE: &str = "order_service_invoice_line_unknown";

/// Reason bounds (trimmed, Unicode scalars), as for planned services.
pub(crate) fn is_valid_reason(reason: &str) -> bool {
    (3..=1000).contains(&reason.trim().chars().count())
}

/// Roles that may issue credit notes (CEO, Billing).
pub(crate) fn can_issue_credit_notes(auth: &AuthUser) -> bool {
    auth.role.can(Capability::InvoicesFinance)
}

/// The credit note one released invoice gets for the service.
#[derive(Debug, Clone)]
pub(crate) struct InvoiceCredit {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub line_indexes: Vec<usize>,
    pub amount_gross: Decimal,
    pub currency: String,
}

/// What cancelling a service involves, read without changing anything.
#[derive(Debug, Clone)]
pub(crate) struct ServiceReversalPreview {
    pub leistung_id: Uuid,
    pub order_id: Uuid,
    pub status: String,
    pub description: String,
    pub quantity: Decimal,
    pub line_gross: Decimal,
    pub currency: String,
    /// Draft invoices that reserve the service.
    pub draft_invoice_ids: Vec<Uuid>,
    /// Credit notes the cancellation issues (one per released invoice).
    pub credits: Vec<InvoiceCredit>,
    /// The service is `invoiced` but no invoice line names it.
    pub invoice_line_unknown: bool,
}

impl ServiceReversalPreview {
    pub fn credit_total(&self) -> Decimal {
        self.credits.iter().map(|credit| credit.amount_gross).sum()
    }

    pub fn needs_credit_note(&self) -> bool {
        !self.credits.is_empty()
    }

    pub fn to_json(&self) -> Value {
        let blocked_reason = if self.status == "cancelled" {
            Some(ALREADY_CANCELLED_CODE)
        } else if !self.draft_invoice_ids.is_empty() {
            Some(ON_DRAFT_INVOICE_CODE)
        } else if self.invoice_line_unknown {
            Some(INVOICE_LINE_UNKNOWN_CODE)
        } else {
            None
        };
        json!({
            "order_leistung_id": self.leistung_id,
            "order_id": self.order_id,
            "status": self.status,
            "description": self.description,
            "quantity": self.quantity.normalize().to_string(),
            "line_gross": decimal_to_string(self.line_gross),
            "currency": self.currency,
            "draft_invoice_ids": self.draft_invoice_ids,
            "requires_credit_note": self.needs_credit_note(),
            "credit_total_gross": decimal_to_string(self.credit_total()),
            "credit_notes": self
                .credits
                .iter()
                .map(|credit| json!({
                    "invoice_id": credit.invoice_id,
                    "invoice_number": credit.invoice_number,
                    "line_indexes": credit.line_indexes,
                    "amount_gross": decimal_to_string(credit.amount_gross),
                    "currency": credit.currency,
                }))
                .collect::<Vec<_>>(),
            "blocked_reason": blocked_reason,
        })
    }
}

struct Plan {
    preview: ServiceReversalPreview,
    contexts: Vec<InvoicePaymentContext>,
}

fn names_service(item: &Value, leistung_id: Uuid) -> bool {
    item.get("source_order_leistung_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
        == Some(leistung_id)
}

/// Reads (and with `lock` locks) the service and every non-cancelled
/// settlement invoice whose lines bill it.
async fn plan(
    conn: &mut PgConnection,
    leistung_id: Uuid,
    lock: bool,
) -> Result<Option<Plan>, sqlx::Error> {
    let sql = format!(
        r#"SELECT service.order_id, service.status, service.description, service.quantity,
                  round(service.quantity * service.unit_price * (1 + service.vat_rate / 100), 2)
                      AS line_gross,
                  service.currency, orders.patient_id
           FROM order_leistungen service
           JOIN orders ON orders.id = service.order_id
           WHERE service.id = $1
           {}"#,
        if lock { "FOR UPDATE OF service" } else { "" }
    );
    let Some(row) = sqlx::query(&sql)
        .bind(leistung_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };
    let status: String = row.try_get("status")?;
    // An order still being prepared from a lead may have no patient yet; it
    // has no invoices either.
    let patient_id: Option<Uuid> = row.try_get("patient_id")?;
    let mut preview = ServiceReversalPreview {
        leistung_id,
        order_id: row.try_get("order_id")?,
        status: status.clone(),
        description: row
            .try_get::<Option<String>, _>("description")?
            .unwrap_or_default(),
        quantity: row
            .try_get::<Option<Decimal>, _>("quantity")?
            .unwrap_or(Decimal::ZERO),
        line_gross: row
            .try_get::<Option<Decimal>, _>("line_gross")
            .unwrap_or_default()
            .unwrap_or(Decimal::ZERO),
        currency: row
            .try_get::<Option<String>, _>("currency")
            .unwrap_or_default()
            .unwrap_or_else(|| "EUR".to_string()),
        draft_invoice_ids: Vec::new(),
        credits: Vec::new(),
        invoice_line_unknown: false,
    };
    // Advance invoices bill a prepayment, not the service; cancelled
    // invoices bill nothing. Only the patient's invoices can bill the service.
    let invoice_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT DISTINCT invoice.id
           FROM invoices invoice
           CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(invoice.line_items) = 'array'
                    THEN invoice.line_items ELSE '[]'::jsonb END
           ) AS item(value)
           WHERE invoice.patient_id = $2
             AND invoice.status <> 'cancelled'
             AND invoice.invoice_type <> 'advance'
             AND lower(btrim(item.value ->> 'source_order_leistung_id')) = $1::text
           ORDER BY invoice.id"#,
    )
    .bind(leistung_id.to_string())
    .bind(patient_id)
    .fetch_all(&mut *conn)
    .await?;

    let mut contexts = Vec::new();
    for invoice_id in invoice_ids {
        let Some((context, _)) = load_invoice_for_credit_note(conn, invoice_id, lock).await? else {
            continue;
        };
        match context.invoice_status.as_str() {
            "cancelled" => continue,
            "draft" => {
                preview.draft_invoice_ids.push(invoice_id);
                continue;
            }
            _ => {}
        }
        let items = context.line_items.as_array().cloned().unwrap_or_default();
        let indexes = items
            .iter()
            .enumerate()
            .filter(|(_, item)| names_service(item, leistung_id))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if indexes.is_empty() {
            continue;
        }
        let existing = credit_notes::load_active_credits(conn, invoice_id).await?;
        let creditable = credit_notes::creditable_lines(&context.line_items, &existing);
        let open = indexes
            .into_iter()
            .filter(|index| {
                creditable
                    .get(*index)
                    .is_some_and(|line| line.remaining_gross() > Decimal::ZERO)
            })
            .collect::<Vec<_>>();
        if open.is_empty() {
            // Already credited in full by an earlier credit note.
            continue;
        }
        let amount_gross = open
            .iter()
            .filter_map(|index| creditable.get(*index))
            .map(|line| line.remaining_gross())
            .sum();
        preview.credits.push(InvoiceCredit {
            invoice_id,
            invoice_number: context.invoice_number.clone(),
            line_indexes: open,
            amount_gross,
            currency: context.currency.clone(),
        });
        contexts.push(context);
    }
    // A released invoice billed the service, but none of its lines names it
    // (hand-written invoice): the line to credit cannot be chosen here.
    preview.invoice_line_unknown = status == "invoiced"
        && preview.credits.is_empty()
        && preview.draft_invoice_ids.is_empty()
        && !fully_credited_line_exists(conn, leistung_id, patient_id).await?;
    Ok(Some(Plan { preview, contexts }))
}

/// Whether some released invoice line names the service (even if an earlier
/// credit note already credited it in full).
async fn fully_credited_line_exists(
    conn: &mut PgConnection,
    leistung_id: Uuid,
    patient_id: Option<Uuid>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM invoices invoice
               CROSS JOIN LATERAL jsonb_array_elements(
                   CASE WHEN jsonb_typeof(invoice.line_items) = 'array'
                        THEN invoice.line_items ELSE '[]'::jsonb END
               ) AS item(value)
               WHERE invoice.patient_id = $2
                 AND invoice.status NOT IN ('cancelled', 'draft')
                 AND invoice.invoice_type <> 'advance'
                 AND lower(btrim(item.value ->> 'source_order_leistung_id')) = $1::text
           )"#,
    )
    .bind(leistung_id.to_string())
    .bind(patient_id)
    .fetch_one(conn)
    .await
}

/// What cancelling the service would do (for the confirm dialogs).
pub(crate) async fn preview_order_service_reversal(
    conn: &mut PgConnection,
    leistung_id: Uuid,
) -> Result<Option<ServiceReversalPreview>, sqlx::Error> {
    Ok(plan(conn, leistung_id, false)
        .await?
        .map(|plan| plan.preview))
}

fn refusal(
    status: StatusCode,
    code: &str,
    message: &str,
    details: Value,
) -> axum::response::Response {
    let mut body = json!({
        "error": status.canonical_reason().unwrap_or("error"),
        "code": code,
        "message": message,
    });
    if let (Some(body), Some(details)) = (body.as_object_mut(), details.as_object()) {
        for (key, value) in details {
            body.insert(key.clone(), value.clone());
        }
    }
    (status, Json(body)).into_response()
}

fn failed(error: sqlx::Error, leistung_id: Uuid, step: &str) -> axum::response::Response {
    tracing::error!(error = %error, %leistung_id, step, "reverse order service billing");
    refusal(
        StatusCode::INTERNAL_SERVER_ERROR,
        "order_service_reversal_failed",
        "Failed to cancel order service",
        json!({}),
    )
}

/// Why and by whom a service is cancelled.
pub(crate) struct ReverseServiceRequest<'a> {
    pub leistung_id: Uuid,
    pub reason: &'a str,
    /// The person confirmed that credit notes are issued for invoiced lines.
    pub allow_credit_note: bool,
    pub actor: &'a AuthUser,
    /// `order_service`, `appointment_cancellation` or
    /// `concierge_service_cancellation`, with the record that caused it.
    pub origin: &'a str,
    pub origin_id: Option<Uuid>,
}

/// A service cancelled in a transaction that has not committed yet.
pub(crate) struct ServiceReversal {
    pub leistung_id: Uuid,
    pub order_id: Uuid,
    pub previous_status: String,
    pub cancelled_at: chrono::DateTime<chrono::Utc>,
    pub reason: String,
    credit_notes: Vec<IssuedCreditNote>,
}

impl ServiceReversal {
    pub async fn discard_documents(&mut self) {
        for credit in &mut self.credit_notes {
            credit.discard_document().await;
        }
    }

    /// Realtime events after the commit.
    pub async fn publish(&self, state: &AppState, user_id: Uuid) {
        for credit in &self.credit_notes {
            credit.publish(state, user_id).await;
        }
        crate::realtime::publish_order_event(
            state,
            Some(user_id),
            "order.leistung_cancelled",
            self.order_id,
            json!({ "leistung_id": self.leistung_id }),
        )
        .await;
    }

    pub fn credit_notes_json(&self) -> Vec<Value> {
        self.credit_notes
            .iter()
            .map(|credit| {
                json!({
                    "credit_note_transaction_id": credit.id,
                    "document_number": credit.document_number,
                    "invoice_id": credit.invoice_id,
                    "invoice_number": credit.invoice_number,
                    "amount_net": decimal_to_string(credit.net),
                    "amount_vat": decimal_to_string(credit.vat),
                    "amount_gross": decimal_to_string(credit.gross),
                    "currency": credit.currency,
                })
            })
            .collect()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "id": self.leistung_id,
            "order_id": self.order_id,
            "status": "cancelled",
            "previous_status": self.previous_status,
            "cancelled_at": self.cancelled_at.to_rfc3339(),
            "cancellation_reason": self.reason,
            "credit_notes": self.credit_notes_json(),
        })
    }
}

/// Cancels the service in the caller's transaction: credit notes for every
/// released invoice that bills it (only with `allow_credit_note` and a
/// finance role), then `cancelled` with the reason, audited in the same
/// transaction (`cancel_order_service`).
pub(crate) async fn reverse_order_service_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    request: &ReverseServiceRequest<'_>,
) -> Result<ServiceReversal, axum::response::Response> {
    let leistung_id = request.leistung_id;
    let reason = request.reason.trim();
    if !is_valid_reason(reason) {
        return Err(refusal(
            StatusCode::UNPROCESSABLE_ENTITY,
            "order_service_cancel_reason",
            "A cancellation reason of 3 to 1000 characters is required",
            json!({}),
        ));
    }
    let Some(Plan { preview, contexts }) = plan(tx, leistung_id, true)
        .await
        .map_err(|error| failed(error, leistung_id, "plan"))?
    else {
        return Err(refusal(
            StatusCode::NOT_FOUND,
            "order_service_not_found",
            "Order service not found",
            json!({ "order_leistung_id": leistung_id }),
        ));
    };
    if preview.status == "cancelled" {
        return Err(refusal(
            StatusCode::CONFLICT,
            ALREADY_CANCELLED_CODE,
            "The order service is already cancelled",
            json!({ "order_leistung_id": leistung_id }),
        ));
    }
    if !preview.draft_invoice_ids.is_empty() {
        return Err(refusal(
            StatusCode::CONFLICT,
            ON_DRAFT_INVOICE_CODE,
            "The order service is on a draft invoice; cancel the draft invoice first (draft lines cannot be edited), then cancel the service",
            json!({
                "order_leistung_id": leistung_id,
                "draft_invoice_ids": preview.draft_invoice_ids,
            }),
        ));
    }
    if preview.invoice_line_unknown {
        return Err(refusal(
            StatusCode::CONFLICT,
            INVOICE_LINE_UNKNOWN_CODE,
            "The order service is invoiced, but no invoice line names it; correct the invoice with a credit note on the invoice page",
            json!({ "order_leistung_id": leistung_id }),
        ));
    }
    if preview.needs_credit_note() {
        if !can_issue_credit_notes(request.actor) {
            return Err(refusal(
                StatusCode::FORBIDDEN,
                REQUIRES_FINANCE_CODE,
                "The order service is on a released invoice; only the CEO or billing can cancel it with a credit note",
                json!({ "reversal": preview.to_json() }),
            ));
        }
        if !request.allow_credit_note {
            return Err(refusal(
                StatusCode::CONFLICT,
                REQUIRES_CREDIT_NOTE_CODE,
                "The order service is on a released invoice; cancelling it issues a credit note — confirm to proceed",
                json!({ "reversal": preview.to_json() }),
            ));
        }
    }

    let today = crate::app_time::today();
    let credit_reason = format!(
        "Stornierung der Leistung „{}“: {}",
        preview.description.trim(),
        reason
    );
    let mut issued = Vec::new();
    for (credit, context) in preview.credits.iter().zip(contexts.iter()) {
        let selection = CreditSelection::Lines(
            credit
                .line_indexes
                .iter()
                .map(|index| (*index, None))
                .collect(),
        );
        let request_selection = selection.to_json();
        let result = issue_credit_note_locked(
            tx,
            context,
            &CreditNoteIssue {
                selection: &selection,
                request_selection: &request_selection,
                reason: &credit_reason,
                issued_on: today,
                portal_visible: true,
                request_id: Uuid::new_v4(),
                user_id: request.actor.user_id,
                source_order_leistung_id: Some(leistung_id),
            },
        )
        .await;
        match result {
            Ok(value) => issued.push(value),
            Err(response) => {
                for mut done in issued {
                    done.discard_document().await;
                }
                return Err(response);
            }
        }
    }

    let mut reversal = ServiceReversal {
        leistung_id,
        order_id: preview.order_id,
        previous_status: preview.status.clone(),
        cancelled_at: chrono::Utc::now(),
        reason: reason.to_string(),
        credit_notes: issued,
    };
    let cancelled_at = match sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
        r#"UPDATE order_leistungen
           SET status = 'cancelled',
               cancelled_at = now(),
               cancelled_by = $2,
               cancellation_reason = $3
           WHERE id = $1 AND status = $4
           RETURNING cancelled_at"#,
    )
    .bind(leistung_id)
    .bind(request.actor.user_id)
    .bind(reason)
    .bind(&preview.status)
    .fetch_one(&mut **tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            reversal.discard_documents().await;
            return Err(failed(error, leistung_id, "update"));
        }
    };
    reversal.cancelled_at = cancelled_at;
    let audited = audit::write_in_transaction(
        tx,
        &audit::domain_event(
            "cancel_order_service",
            Some(request.actor.user_id),
            "order_leistung",
            Some(leistung_id),
            json!({
                "order_id": preview.order_id,
                "previous_status": preview.status,
                "description": preview.description,
                "quantity": preview.quantity.normalize().to_string(),
                "reason": reason,
                "origin": request.origin,
                "origin_id": request.origin_id,
                "credit_notes": reversal.credit_notes_json(),
            }),
        ),
    )
    .await;
    if let Err(error) = audited {
        reversal.discard_documents().await;
        return Err(failed(error, leistung_id, "audit"));
    }
    Ok(reversal)
}
