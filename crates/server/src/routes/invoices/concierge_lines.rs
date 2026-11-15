//! Concierge services billed at their sale price (screens QA 2026-11-12,
//! F-C8; owner decisions 7 and 8 of the concierge QA).
//!
//! A concierge service whose task is completed is `ready` for billing. Billing
//! picks it in the patient's billing tab next to quote lines and receipts; the
//! draft gets one line per service (quantity × unit price net, VAT of GMED's
//! default tax profile like the agency's own concierge lines) and
//! `invoice_concierge_service_lines` names the service. A service is billed by
//! at most one non-cancelled invoice. The release moves the service to
//! `billed`; cancelling a released invoice moves it back to `ready`. A
//! cancelled draft never moved it, so the service is simply billable again.

use axum::http::StatusCode;
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::{coded_err, compute_invoice_line_parts, decimal_to_string, vat_source_explanation};
use crate::audit;
use crate::money::CommercialRounding;

/// The service is not (or no longer) ready for billing.
pub(super) const SERVICE_NOT_READY: &str = "concierge_service_not_ready";
/// The service has no sale price; it is set on the service first.
pub(super) const SERVICE_WITHOUT_PRICE: &str = "concierge_service_without_price";
/// Another non-cancelled invoice already bills the service.
pub(super) const SERVICE_ALREADY_INVOICED: &str = "concierge_service_already_invoiced";
/// The service belongs to another order than the invoice.
pub(super) const SERVICE_OTHER_ORDER: &str = "concierge_service_other_order";
/// The service is priced in another currency than the invoice.
pub(super) const SERVICE_OTHER_CURRENCY: &str = "concierge_service_other_currency";
/// No active default tax profile gives the VAT of the line.
pub(super) const NO_DEFAULT_TAX_PROFILE: &str = "concierge_service_no_tax_profile";
/// A live invoice already re-bills a receipt of the service at cost (QA D-02).
pub(super) const SERVICE_BILLED_BY_RECEIPT: &str = "concierge_service_billed_by_receipt";
/// The same draft would bill the service and re-bill its receipt (QA D-02).
pub(super) const SERVICE_WITH_ITS_RECEIPT: &str = "concierge_service_with_its_receipt";
/// A live invoice already bills the service of the receipt at its sale price.
pub(super) const RECEIPT_SERVICE_BILLED: &str = "concierge_receipt_service_billed";
/// The release is refused: the draft bills a concierge service both ways.
pub(super) const RELEASE_BILLED_TWICE: &str = "invoice_bills_concierge_service_twice";
/// Constraint name of the database guard (migration 20261115120000).
pub(super) const BILLED_ONCE_CONSTRAINT: &str = "concierge_service_billed_once";
/// The release is refused: a billed service changed after the draft was made.
pub(super) const RELEASE_BLOCKED: &str = "invoice_bills_changed_concierge_service";

/// One concierge line of a new draft, stored after the invoice row exists.
pub(super) struct ConciergeLink {
    pub service_id: Uuid,
    pub line_index: usize,
    pub quantity: Decimal,
    pub unit_price_net: Decimal,
    pub vat_rate: Decimal,
    pub net: Decimal,
    pub vat: Decimal,
    pub gross: Decimal,
}

/// The state of one service as the refusal check reads it.
pub(super) struct ServiceFacts<'a> {
    pub status: &'a str,
    pub billing_status: &'a str,
    pub quantity: Decimal,
    pub unit_price: Option<Decimal>,
    pub service_order_id: Option<Uuid>,
    pub service_currency: &'a str,
    pub already_invoiced: bool,
    /// A live invoice re-bills a receipt of the service at cost.
    pub receipt_rebilled: bool,
    /// A receipt of the service is chosen for the same draft.
    pub receipt_selected: bool,
}

/// Why a service cannot go on this draft, `None` when it can.
pub(super) fn refusal(
    facts: &ServiceFacts<'_>,
    invoice_order_id: Option<Uuid>,
    invoice_currency: Option<&str>,
) -> Option<&'static str> {
    if facts.status == "cancelled" || facts.billing_status != "ready" {
        return Some(SERVICE_NOT_READY);
    }
    if facts.already_invoiced {
        return Some(SERVICE_ALREADY_INVOICED);
    }
    // One billing path per concierge cost (owner 2026-11-12, QA D-02).
    if facts.receipt_rebilled {
        return Some(SERVICE_BILLED_BY_RECEIPT);
    }
    if facts.receipt_selected {
        return Some(SERVICE_WITH_ITS_RECEIPT);
    }
    if facts.quantity <= Decimal::ZERO
        || facts.unit_price.is_none_or(|price| price <= Decimal::ZERO)
    {
        return Some(SERVICE_WITHOUT_PRICE);
    }
    // The sale price lands in the economics of the service's own order.
    if facts
        .service_order_id
        .is_some_and(|order| invoice_order_id != Some(order))
    {
        return Some(SERVICE_OTHER_ORDER);
    }
    if invoice_currency.is_some_and(|currency| currency != facts.service_currency) {
        return Some(SERVICE_OTHER_CURRENCY);
    }
    None
}

fn refusal_message(code: &str) -> &'static str {
    match code {
        SERVICE_NOT_READY => "The concierge service is not ready for billing",
        SERVICE_ALREADY_INVOICED => "The concierge service is already billed by another invoice",
        SERVICE_BILLED_BY_RECEIPT => "The concierge service is already billed through its receipt",
        SERVICE_WITH_ITS_RECEIPT => "Choose the concierge service or its receipt, not both",
        SERVICE_WITHOUT_PRICE => {
            "The concierge service has no sale price; set it on the service first"
        }
        SERVICE_OTHER_ORDER => "The concierge service belongs to another order; choose its order",
        SERVICE_OTHER_CURRENCY => "The concierge service is priced in another currency",
        NO_DEFAULT_TAX_PROFILE => {
            "No active default tax profile gives the VAT of a concierge service"
        }
        _ => "The concierge service cannot be billed",
    }
}

fn refused(code: &'static str, title: &str) -> axum::response::Response {
    let status = match code {
        SERVICE_WITHOUT_PRICE | NO_DEFAULT_TAX_PROFILE => StatusCode::UNPROCESSABLE_ENTITY,
        _ => StatusCode::CONFLICT,
    };
    coded_err(
        status,
        code,
        refusal_message(code),
        json!({ "service_label": title }),
    )
}

/// The receipt is not re-billed: a live invoice bills its concierge service
/// at the sale price (QA D-02).
pub(super) fn receipt_refused(title: &str) -> axum::response::Response {
    coded_err(
        StatusCode::CONFLICT,
        RECEIPT_SERVICE_BILLED,
        "The concierge service of this receipt is already billed at its sale price",
        json!({ "service_label": title }),
    )
}

/// The database guard refused a second billing path of a concierge service.
pub(super) fn is_billed_once_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database| database.constraint())
        == Some(BILLED_ONCE_CONSTRAINT)
}

/// A concierge service would be billed at its sale price and through its
/// receipt; `services` names them when known.
pub(super) fn billed_twice(services: &[String]) -> axum::response::Response {
    coded_err(
        StatusCode::CONFLICT,
        RELEASE_BILLED_TWICE,
        "A concierge service is already billed the other way (sale price or receipt)",
        json!({ "services_label": services.join(", ") }),
    )
}

fn failed(error: sqlx::Error, context: &str) -> axum::response::Response {
    tracing::error!(%error, context, "bill concierge services");
    super::err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to create invoice",
    )
}

/// GMED's default tax profile valid today: the VAT of a concierge sale price,
/// as of the agency's own concierge catalogue lines (standard VAT).
async fn default_tax_profile(
    conn: &mut PgConnection,
) -> Result<Option<(Uuid, String, String, Decimal)>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, profile_key, name, vat_rate
           FROM tax_profiles
           WHERE is_default AND is_active
             AND valid_from <= CURRENT_DATE
             AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
           ORDER BY valid_from DESC
           LIMIT 1"#,
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|row| {
        (
            row.try_get::<Uuid, _>("id").unwrap_or_default(),
            row.try_get::<String, _>("profile_key").unwrap_or_default(),
            row.try_get::<String, _>("name").unwrap_or_default(),
            row.try_get::<Decimal, _>("vat_rate")
                .unwrap_or(Decimal::ZERO),
        )
    }))
}

/// Locks the chosen services, checks each, and appends one invoice line per
/// service. Fills the invoice currency from the first service when nothing
/// else set it.
#[allow(clippy::too_many_arguments)]
pub(super) async fn append_lines(
    conn: &mut PgConnection,
    patient_id: Uuid,
    invoice_order_id: Option<Uuid>,
    currency: &mut Option<String>,
    service_ids: &[Uuid],
    selected_external_ids: &[Uuid],
    line_items: &mut Vec<Value>,
    totals: &mut (Decimal, Decimal, Decimal),
) -> Result<Vec<ConciergeLink>, axum::response::Response> {
    let mut links = Vec::new();
    if service_ids.is_empty() {
        return Ok(links);
    }
    let Some((tax_profile_id, tax_profile_key, tax_profile_name, vat_rate)) =
        default_tax_profile(conn)
            .await
            .map_err(|error| failed(error, "load default tax profile"))?
    else {
        return Err(refused(NO_DEFAULT_TAX_PROFILE, ""));
    };
    let vat_rate = vat_rate.round_commercial(2);
    for service_id in service_ids {
        let row = sqlx::query(
            r#"SELECT service.patient_id, service.status, service.billing_status,
                      service.title, service.quantity, service.unit_price,
                      UPPER(service.currency) AS currency,
                      COALESCE(service.order_id, appointment.order_id) AS order_id,
                      COALESCE(service.starts_at, service.completed_at) AS service_date
               FROM concierge_services service
               LEFT JOIN appointments appointment ON appointment.id = service.appointment_id
               WHERE service.id = $1
               FOR UPDATE OF service"#,
        )
        .bind(*service_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|error| failed(error, "lock concierge service"))?;
        let Some(row) = row else {
            return Err(super::err(
                StatusCode::NOT_FOUND,
                "Selected concierge service not found",
            ));
        };
        if row.try_get::<Uuid, _>("patient_id").ok() != Some(patient_id) {
            return Err(super::err(
                StatusCode::NOT_FOUND,
                "Selected concierge service not found",
            ));
        }
        // Read after the row lock: a draft made meanwhile is committed.
        let already_invoiced = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS (
                   SELECT 1
                   FROM invoice_concierge_service_lines link
                   JOIN invoices invoice ON invoice.id = link.invoice_id
                   WHERE link.concierge_service_id = $1
                     AND invoice.status <> 'cancelled'
               )"#,
        )
        .bind(*service_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|error| failed(error, "check concierge service invoices"))?;
        // The other billing path of the same cost: a receipt of the service
        // re-billed by a live invoice, or chosen for this draft (QA D-02).
        let (receipt_rebilled, receipt_selected) = sqlx::query_as::<_, (bool, bool)>(
            r#"SELECT COALESCE(BOOL_OR(EXISTS (
                       SELECT 1
                       FROM external_invoice_patient_invoice_allocations allocation
                       JOIN invoices rebilling ON rebilling.id = allocation.patient_invoice_id
                       WHERE allocation.external_invoice_id = receipt_service.external_invoice_id
                         AND allocation.reversed_at IS NULL
                         AND rebilling.status <> 'cancelled'
                   )), false),
                   COALESCE(BOOL_OR(receipt_service.external_invoice_id = ANY($2)), false)
               FROM concierge_receipt_services receipt_service
               JOIN external_invoices external ON external.id = receipt_service.external_invoice_id
               WHERE receipt_service.concierge_service_id = $1
                 AND external.status <> 'cancelled'"#,
        )
        .bind(*service_id)
        .bind(selected_external_ids)
        .fetch_one(&mut *conn)
        .await
        .map_err(|error| failed(error, "check concierge service receipts"))?;
        let title = row.try_get::<String, _>("title").unwrap_or_default();
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let billing_status = row
            .try_get::<String, _>("billing_status")
            .unwrap_or_default();
        let service_currency = row
            .try_get::<String, _>("currency")
            .unwrap_or_else(|_| "EUR".to_string());
        let quantity = row
            .try_get::<Decimal, _>("quantity")
            .unwrap_or(Decimal::ZERO);
        let unit_price = row
            .try_get::<Option<Decimal>, _>("unit_price")
            .unwrap_or_default();
        let service_order_id = row
            .try_get::<Option<Uuid>, _>("order_id")
            .unwrap_or_default();
        let facts = ServiceFacts {
            status: &status,
            billing_status: &billing_status,
            quantity,
            unit_price,
            service_order_id,
            service_currency: &service_currency,
            already_invoiced,
            receipt_rebilled,
            receipt_selected,
        };
        if let Some(code) = refusal(&facts, invoice_order_id, currency.as_deref()) {
            return Err(refused(code, &title));
        }
        if currency.is_none() {
            *currency = Some(service_currency.clone());
        }
        let unit_price = unit_price.unwrap_or(Decimal::ZERO).round_cents();
        let quantity = quantity.round_commercial(2);
        let (net, vat, gross) = compute_invoice_line_parts(quantity, unit_price, vat_rate);
        let vat_rate_label = decimal_to_string(vat_rate);
        let line_index = line_items.len();
        line_items.push(json!({
            "description": title,
            "quantity": decimal_to_string(quantity),
            "unit": "service",
            "unit_price": decimal_to_string(unit_price),
            "vat_rate": vat_rate_label,
            "line_net": decimal_to_string(net),
            "line_vat": decimal_to_string(vat),
            "line_gross": decimal_to_string(gross),
            "is_cost_passthrough": false,
            "source": "concierge_service",
            "source_concierge_service_id": service_id,
            "source_order_id": service_order_id,
            "source_service_date": row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("service_date")
                .unwrap_or_default()
                .map(|value| value.to_rfc3339()),
            "vat_source": "tax_profile",
            "tax_profile_id": tax_profile_id,
            "tax_profile_key": tax_profile_key,
            "tax_profile_name": tax_profile_name,
            "tax_profile_vat_rate": vat_rate_label,
            "vat_source_explanation": vat_source_explanation(
                "tax_profile",
                Some(&tax_profile_name),
                Some(&tax_profile_key),
                Some(&vat_rate_label),
            ),
        }));
        totals.0 = (totals.0 + net).round_cents();
        totals.1 = (totals.1 + vat).round_cents();
        totals.2 = (totals.2 + gross).round_cents();
        links.push(ConciergeLink {
            service_id: *service_id,
            line_index,
            quantity,
            unit_price_net: unit_price,
            vat_rate,
            net,
            vat,
            gross,
        });
    }
    Ok(links)
}

/// Stores the links of a new draft.
pub(super) async fn insert_links(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    links: &[ConciergeLink],
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    for link in links {
        sqlx::query(
            r#"INSERT INTO invoice_concierge_service_lines (
                   invoice_id, concierge_service_id, invoice_line_index, quantity,
                   unit_price_net, vat_rate, amount_net, amount_vat, amount_gross, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
        )
        .bind(invoice_id)
        .bind(link.service_id)
        .bind(link.line_index as i32)
        .bind(link.quantity)
        .bind(link.unit_price_net)
        .bind(link.vat_rate)
        .bind(link.net)
        .bind(link.vat)
        .bind(link.gross)
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// The concierge services the draft bills one way while a live invoice (this
/// one or another) bills them the other way: the sale price next to a
/// re-billed receipt of the same service (QA D-02). Data from before the
/// database guard of 2026-11-15 can hold both; the release refuses it.
pub(super) async fn billed_twice_on_draft(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH draft_services AS (
               SELECT link.concierge_service_id AS service_id, 'sale'::text AS path
               FROM invoice_concierge_service_lines link
               WHERE link.invoice_id = $1
               UNION
               SELECT receipt_service.concierge_service_id, 'receipt'::text
               FROM external_invoice_patient_invoice_allocations allocation
               JOIN concierge_receipt_services receipt_service
                 ON receipt_service.external_invoice_id = allocation.external_invoice_id
               JOIN external_invoices external
                 ON external.id = allocation.external_invoice_id
                AND external.status <> 'cancelled'
               WHERE allocation.patient_invoice_id = $1
                 AND allocation.reversed_at IS NULL
           ), live_sales AS (
               SELECT link.concierge_service_id AS service_id
               FROM invoice_concierge_service_lines link
               JOIN invoices invoice ON invoice.id = link.invoice_id
               WHERE invoice.status <> 'cancelled'
           ), live_receipts AS (
               SELECT receipt_service.concierge_service_id AS service_id
               FROM external_invoice_patient_invoice_allocations allocation
               JOIN invoices invoice ON invoice.id = allocation.patient_invoice_id
               JOIN concierge_receipt_services receipt_service
                 ON receipt_service.external_invoice_id = allocation.external_invoice_id
               JOIN external_invoices external
                 ON external.id = allocation.external_invoice_id
                AND external.status <> 'cancelled'
               WHERE allocation.reversed_at IS NULL
                 AND invoice.status <> 'cancelled'
           )
           SELECT DISTINCT service.title
           FROM draft_services draft
           JOIN concierge_services service ON service.id = draft.service_id
           WHERE (draft.path = 'sale'
                  AND EXISTS (SELECT 1 FROM live_receipts r WHERE r.service_id = draft.service_id))
              OR (draft.path = 'receipt'
                  AND EXISTS (SELECT 1 FROM live_sales s WHERE s.service_id = draft.service_id))
           ORDER BY service.title"#,
    )
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await
}

/// The services a draft bills that changed since it was made: no longer
/// `ready` (reopened, waived, billed by hand, cancelled) or another quantity,
/// unit price or currency. The rows are locked until the release commits.
pub(super) async fn changed_services_on_draft(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String, bool)> = sqlx::query_as(
        r#"SELECT service.title,
                  service.status = 'cancelled'
                  OR service.billing_status <> 'ready'
                  OR service.quantity IS DISTINCT FROM link.quantity
                  OR service.unit_price IS DISTINCT FROM link.unit_price_net
                  OR UPPER(service.currency) IS DISTINCT FROM UPPER(invoice.currency) AS changed
           FROM invoice_concierge_service_lines link
           JOIN invoices invoice ON invoice.id = link.invoice_id
           JOIN concierge_services service ON service.id = link.concierge_service_id
           WHERE link.invoice_id = $1
           ORDER BY link.invoice_line_index
           FOR UPDATE OF service"#,
    )
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .filter(|(_, changed)| *changed)
        .map(|(title, _)| title)
        .collect())
}

/// The release bills the draft's concierge services: `ready` → `billed`.
pub(super) async fn mark_billed(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let services: Vec<Uuid> = sqlx::query_scalar(
        r#"UPDATE concierge_services service
           SET billing_status = 'billed',
               billed_at = COALESCE(service.billed_at, now())
           FROM invoice_concierge_service_lines link
           WHERE link.invoice_id = $1
             AND link.concierge_service_id = service.id
             AND service.billing_status = 'ready'
           RETURNING service.id"#,
    )
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await?;
    for service_id in services {
        audit::write_in_transaction(
            &mut *conn,
            &audit::domain_event(
                "concierge_service_billed_by_invoice",
                Some(user_id),
                "concierge_service",
                Some(service_id),
                json!({
                    "invoice_id": invoice_id,
                    "billing_status_before": "ready",
                    "billing_status": "billed",
                }),
            ),
        )
        .await?;
    }
    Ok(())
}

/// A cancelled invoice no longer bills its concierge services: a service it
/// had billed is `ready` again unless another live invoice bills it. A
/// cancelled draft never moved its services, so nothing changes for it.
pub(super) async fn reopen_after_cancellation(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let services: Vec<Uuid> = sqlx::query_scalar(
        r#"UPDATE concierge_services service
           SET billing_status = 'ready',
               -- No longer billed: the date of the cancelled invoice goes too
               -- (QA D-03).
               billed_at = NULL
           FROM invoice_concierge_service_lines link
           JOIN invoices cancelled_invoice ON cancelled_invoice.id = link.invoice_id
           WHERE link.invoice_id = $1
             AND link.concierge_service_id = service.id
             AND cancelled_invoice.released_at IS NOT NULL
             AND service.billing_status = 'billed'
             AND NOT EXISTS (
                 SELECT 1
                 FROM invoice_concierge_service_lines other_link
                 JOIN invoices other_invoice ON other_invoice.id = other_link.invoice_id
                 WHERE other_link.concierge_service_id = service.id
                   AND other_link.invoice_id <> $1
                   AND other_invoice.status <> 'cancelled'
             )
           RETURNING service.id"#,
    )
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await?;
    for service_id in services {
        audit::write_in_transaction(
            &mut *conn,
            &audit::domain_event(
                "concierge_service_unbilled_by_invoice_cancellation",
                Some(user_id),
                "concierge_service",
                Some(service_id),
                json!({
                    "invoice_id": invoice_id,
                    "billing_status_before": "billed",
                    "billing_status": "ready",
                }),
            ),
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready(order: Option<Uuid>) -> ServiceFacts<'static> {
        ServiceFacts {
            status: "completed",
            billing_status: "ready",
            quantity: Decimal::ONE,
            unit_price: Some(Decimal::new(12000, 2)),
            service_order_id: order,
            service_currency: "EUR",
            already_invoiced: false,
            receipt_rebilled: false,
            receipt_selected: false,
        }
    }

    #[test]
    fn a_ready_priced_service_goes_on_the_draft_of_its_order() {
        let order = Uuid::new_v4();
        assert_eq!(refusal(&ready(Some(order)), Some(order), Some("EUR")), None);
        assert_eq!(refusal(&ready(None), None, None), None);
        assert_eq!(refusal(&ready(None), Some(order), Some("EUR")), None);
    }

    #[test]
    fn a_service_is_refused_when_not_ready_unpriced_billed_or_elsewhere() {
        let order = Uuid::new_v4();
        let mut facts = ready(Some(order));
        facts.billing_status = "billed";
        assert_eq!(refusal(&facts, Some(order), None), Some(SERVICE_NOT_READY));

        let mut facts = ready(Some(order));
        facts.status = "cancelled";
        assert_eq!(refusal(&facts, Some(order), None), Some(SERVICE_NOT_READY));

        let mut facts = ready(Some(order));
        facts.already_invoiced = true;
        assert_eq!(
            refusal(&facts, Some(order), None),
            Some(SERVICE_ALREADY_INVOICED)
        );

        let mut facts = ready(Some(order));
        facts.unit_price = None;
        assert_eq!(
            refusal(&facts, Some(order), None),
            Some(SERVICE_WITHOUT_PRICE)
        );
        facts.unit_price = Some(Decimal::ZERO);
        assert_eq!(
            refusal(&facts, Some(order), None),
            Some(SERVICE_WITHOUT_PRICE)
        );

        assert_eq!(
            refusal(&ready(Some(order)), None, None),
            Some(SERVICE_OTHER_ORDER)
        );
        assert_eq!(
            refusal(&ready(Some(order)), Some(Uuid::new_v4()), None),
            Some(SERVICE_OTHER_ORDER)
        );
        assert_eq!(
            refusal(&ready(Some(order)), Some(order), Some("USD")),
            Some(SERVICE_OTHER_CURRENCY)
        );
    }

    #[test]
    fn a_service_is_refused_when_its_receipt_is_billed_or_chosen_too() {
        let order = Uuid::new_v4();
        let mut facts = ready(Some(order));
        facts.receipt_rebilled = true;
        assert_eq!(
            refusal(&facts, Some(order), Some("EUR")),
            Some(SERVICE_BILLED_BY_RECEIPT)
        );

        let mut facts = ready(Some(order));
        facts.receipt_selected = true;
        assert_eq!(
            refusal(&facts, Some(order), Some("EUR")),
            Some(SERVICE_WITH_ITS_RECEIPT)
        );
        assert_eq!(
            refusal_message(SERVICE_WITH_ITS_RECEIPT),
            "Choose the concierge service or its receipt, not both"
        );
    }
}
