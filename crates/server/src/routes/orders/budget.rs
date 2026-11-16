//! Contract budget of an order (owner decision 2026-11-17).
//!
//! The order the client signed states a sum for GMED's own services. While
//! staff keep adding services the order must not silently run over it: the
//! order workspace, the service forms, the planning grid, the concierge form
//! and the new-invoice dialog show the contract sum, what is planned and what
//! is left. Nothing is ever blocked — the figures only warn.
//!
//! Only GMED's own services count (agency services, interpreter and
//! organisation fees, concierge sale prices: every line that is not a
//! pass-through). Provider, doctor and clinic costs re-billed at cost
//! (`is_cost_passthrough`, receipts, external invoices) never do.
//!
//! The contract sum is built from what the client signed, oldest first:
//!
//! * the signed single order (`orders.client_signed_terms`, the order's whole
//!   not-cancelled service list at the last client signature; it stays after a
//!   staff change reset the signature, as the last version the client signed)
//!   replaces everything signed before it;
//! * an accepted quote (Kostenvoranschlag signed by the client, or accepted by
//!   staff) signed later adds its lines by order line: a follow-up quote
//!   covers only the services not invoiced yet, so the lines signed before
//!   stay; a line it prices again takes the new price (a line already billed
//!   in part keeps the larger amount, the quote prices only its rest);
//! * approved order amendments (the agreed extra amount, `order_amendments`)
//!   whose order line is not in a signed version add their own-service amount.
//!
//! Without a client signature and without an accepted quote the order has no
//! contract sum.

use std::collections::{BTreeMap, HashMap};

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::{DateTime, Utc};
use gmed_domain::access::capabilities::Capability;
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::money::{self, CommercialRounding, LineAmounts};
use crate::state::AppState;

pub(super) fn router() -> Router<AppState> {
    Router::new().route("/orders/{order_id}/budget", get(get_order_budget))
}

/// Net and gross of an amount of own services.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Amounts {
    pub net: Decimal,
    pub gross: Decimal,
}

impl Amounts {
    fn of(line: LineAmounts) -> Self {
        Self {
            net: line.net,
            gross: line.gross,
        }
    }

    fn add(&mut self, other: Amounts) {
        self.net += other.net;
        self.gross += other.gross;
    }
}

/// One own-service line of a signed version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignedLine {
    /// The order line it names; `None` for a legacy quote line without one.
    pub order_line_id: Option<Uuid>,
    pub amounts: Amounts,
}

/// What the client signed, in the order it was signed.
#[derive(Debug, Clone)]
pub(crate) enum SignedVersion {
    /// The signed single order: the whole service list at that signature.
    Order {
        signed_at: Option<DateTime<Utc>>,
        document_id: Option<Uuid>,
        lines: Vec<SignedLine>,
    },
    /// An accepted quote: the services it priced.
    Quote {
        quote_id: Uuid,
        quote_number: String,
        signed_at: Option<DateTime<Utc>>,
        lines: Vec<SignedLine>,
    },
}

impl SignedVersion {
    fn signed_at(&self) -> Option<DateTime<Utc>> {
        match self {
            Self::Order { signed_at, .. } | Self::Quote { signed_at, .. } => *signed_at,
        }
    }
}

/// An approved amendment of the order amount.
#[derive(Debug, Clone)]
pub(crate) struct ApprovedAmendment {
    /// The order line its approval created (if any and not cancelled).
    pub order_line_id: Option<Uuid>,
    /// Own-service amount: of its order line, or of the approved delta.
    pub amounts: Amounts,
    /// A pass-through amendment re-bills a cost and never counts.
    pub is_cost_passthrough: bool,
    pub decided_at: Option<DateTime<Utc>>,
}

/// The contract sum and the version it comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Contract {
    pub amounts: Amounts,
    /// `order_signature` or `quote`: the latest signed version used.
    pub source: &'static str,
    pub signed_at: Option<DateTime<Utc>>,
    pub document_id: Option<Uuid>,
    pub quote_number: Option<String>,
    /// Signed quotes overlaid on the basis.
    pub quotes: usize,
    /// Approved amendments added on top.
    pub amendments: usize,
}

/// The contract sum of an order from its signed versions and approved
/// amendments (see the module docs). `partly_billed` names order lines that
/// an invoice already billed (a later quote prices only their rest).
pub(crate) fn contract_sum(
    mut versions: Vec<SignedVersion>,
    amendments: &[ApprovedAmendment],
    partly_billed: &dyn Fn(Uuid) -> bool,
) -> Option<Contract> {
    if versions.is_empty() {
        return None;
    }
    // Oldest first; an unknown time sorts first. At the same instant the
    // order signature comes first and the quote is laid over it.
    versions.sort_by_key(|version| {
        (
            version.signed_at(),
            matches!(version, SignedVersion::Quote { .. }),
        )
    });
    let mut lines: BTreeMap<String, Amounts> = BTreeMap::new();
    let mut source = "order_signature";
    let mut signed_at = None;
    let mut document_id = None;
    let mut quote_number = None;
    let mut quotes = 0;
    let mut first_signed_at = None;
    for version in versions {
        if first_signed_at.is_none() {
            first_signed_at = version.signed_at();
        }
        match version {
            SignedVersion::Order {
                signed_at: at,
                document_id: document,
                lines: signed,
            } => {
                lines.clear();
                quotes = 0;
                for (index, line) in signed.into_iter().enumerate() {
                    let key = line
                        .order_line_id
                        .map_or_else(|| format!("order:{index}"), |id| id.to_string());
                    lines.insert(key, line.amounts);
                }
                source = "order_signature";
                signed_at = at;
                document_id = document;
                quote_number = None;
            }
            SignedVersion::Quote {
                quote_id,
                quote_number: number,
                signed_at: at,
                lines: signed,
            } => {
                for (index, line) in signed.into_iter().enumerate() {
                    match line.order_line_id {
                        Some(id) => {
                            let key = id.to_string();
                            let amounts = match lines.get(&key) {
                                Some(previous)
                                    if partly_billed(id) && previous.gross > line.amounts.gross =>
                                {
                                    *previous
                                }
                                _ => line.amounts,
                            };
                            lines.insert(key, amounts);
                        }
                        None => {
                            lines.insert(format!("quote:{quote_id}:{index}"), line.amounts);
                        }
                    }
                }
                quotes += 1;
                source = "quote";
                signed_at = at;
                document_id = None;
                quote_number = Some(number);
            }
        }
    }
    let mut total = Amounts::default();
    for amounts in lines.values() {
        total.add(*amounts);
    }
    let mut counted_amendments = 0;
    for amendment in amendments {
        if amendment.is_cost_passthrough {
            continue;
        }
        match amendment.order_line_id {
            // Signed with its line already.
            Some(id) if lines.contains_key(&id.to_string()) => continue,
            Some(_) => {}
            // A legacy amendment without a line: counted when decided after
            // the first signature (before it, the signed total had it).
            None => {
                let after_signature = match (amendment.decided_at, first_signed_at) {
                    (Some(decided), Some(signed)) => decided > signed,
                    _ => false,
                };
                if !after_signature {
                    continue;
                }
            }
        }
        total.add(amendment.amounts);
        counted_amendments += 1;
    }
    Some(Contract {
        amounts: Amounts {
            net: total.net.round_cents(),
            gross: total.gross.round_cents(),
        },
        source,
        signed_at,
        document_id,
        quote_number,
        quotes,
        amendments: counted_amendments,
    })
}

/// Visits that will add a treatment-organisation line when completed: the
/// pending medical visits beyond the units the order's lines still have.
/// Returns (visits not covered, units still free after the pending visits).
pub(crate) fn visit_coverage(
    organisation_units: Decimal,
    completed_visits: i64,
    pending_visits: i64,
) -> (i64, i64) {
    use rust_decimal::prelude::ToPrimitive;
    let unconsumed = (organisation_units.floor() - Decimal::from(completed_visits.max(0)))
        .max(Decimal::ZERO)
        .to_i64()
        .unwrap_or(i64::MAX);
    let pending = pending_visits.max(0);
    ((pending - unconsumed).max(0), (unconsumed - pending).max(0))
}

/// Own-service amounts of a stored line (`quantity`, `unit_price`,
/// `vat_rate`, `is_cost_passthrough`, optional `line_net` / `line_gross`);
/// `None` for a pass-through or unreadable line.
fn own_line_amounts(item: &Value) -> Option<Amounts> {
    if item
        .get("is_cost_passthrough")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    let decimal = |key: &str| -> Option<Decimal> {
        match item.get(key)? {
            Value::String(value) => value.trim().parse::<Decimal>().ok(),
            Value::Number(value) => value.to_string().parse::<Decimal>().ok(),
            _ => None,
        }
    };
    if let (Some(net), Some(gross)) = (decimal("line_net"), decimal("line_gross")) {
        return Some(Amounts { net, gross });
    }
    let quantity = decimal("quantity")?;
    let unit_price = decimal("unit_price")?;
    let vat_rate = decimal("vat_rate").unwrap_or(Decimal::ZERO);
    Some(Amounts::of(money::line_amounts(
        quantity, unit_price, vat_rate,
    )))
}

fn line_id(item: &Value, key: &str) -> Option<Uuid> {
    item.get(key)
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<Uuid>().ok())
}

fn own_lines(items: &Value, id_key: &str) -> Vec<SignedLine> {
    items
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(SignedLine {
                        order_line_id: line_id(item, id_key),
                        amounts: own_line_amounts(item)?,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn money_value(value: Decimal) -> String {
    money::money_string(value)
}

fn fail(error: sqlx::Error, order_id: Uuid, what: &str) -> axum::response::Response {
    tracing::error!(error = %error, order_id = %order_id, what, "load order budget");
    super::err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to load order budget",
    )
}

/// `GET /orders/{order_id}/budget`
async fn get_order_budget(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::OrdersView) {
        return response;
    }
    // Order sums belong to the full order view (the concierge and the
    // interpreter team lead read only their part of the order).
    if let Err(response) = super::require_full_order_read(&auth) {
        return response;
    }
    if let Err(response) =
        super::ensure_order_access(&state, &auth, order_id, "Order not found").await
    {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return fail(error, order_id, "begin"),
    };
    if let Err(error) = sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await
    {
        return fail(error, order_id, "snapshot");
    }

    let order = match sqlx::query(
        r#"SELECT UPPER(currency) AS currency, client_signed_terms
           FROM orders WHERE id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return super::err(StatusCode::NOT_FOUND, "Order not found"),
        Err(error) => return fail(error, order_id, "order"),
    };
    let currency = order
        .try_get::<String, _>("currency")
        .unwrap_or_else(|_| "EUR".to_string());

    let mut versions = Vec::new();
    if let Some(terms) = order
        .try_get::<Option<Value>, _>("client_signed_terms")
        .unwrap_or_default()
    {
        let lines = own_lines(terms.get("lines").unwrap_or(&Value::Null), "id");
        // A snapshot without readable lines is no contract sum.
        let has_lines = terms
            .get("lines")
            .and_then(Value::as_array)
            .is_some_and(|lines| !lines.is_empty());
        if has_lines {
            versions.push(SignedVersion::Order {
                signed_at: terms
                    .get("signed_at")
                    .and_then(Value::as_str)
                    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                    .map(|value| value.with_timezone(&Utc)),
                document_id: line_id(&terms, "document_id"),
                lines,
            });
        }
    }

    // Accepted quotes, also those a later quote closed after acceptance (their
    // accepted version is kept in `quote_versions`).
    let quotes = match sqlx::query(
        r#"SELECT q.id, q.quote_number,
                  COALESCE(accepted.line_items, q.line_items) AS line_items,
                  COALESCE(accepted.created_at, q.updated_at) AS signed_at
           FROM quotes q
           LEFT JOIN LATERAL (
               SELECT version.line_items, version.created_at
               FROM quote_versions version
               WHERE version.quote_id = q.id AND version.status = 'accepted'
               ORDER BY version.created_at DESC, version.version_number DESC
               LIMIT 1
           ) accepted ON true
           WHERE q.order_id = $1
             AND (q.status = 'accepted'
                  OR (q.status = 'superseded' AND accepted.created_at IS NOT NULL))"#,
    )
    .bind(order_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return fail(error, order_id, "quotes"),
    };
    for row in &quotes {
        versions.push(SignedVersion::Quote {
            quote_id: row.try_get("id").unwrap_or_default(),
            quote_number: row.try_get("quote_number").unwrap_or_default(),
            signed_at: row.try_get("signed_at").ok(),
            lines: own_lines(
                &row.try_get::<Value, _>("line_items").unwrap_or(Value::Null),
                "source_order_leistung_id",
            ),
        });
    }

    // The order lines: the plan, and which are billed already.
    let services = match sqlx::query(
        r#"SELECT service.id, service.status, service.is_cost_passthrough,
                  UPPER(service.currency) AS currency,
                  service.quantity, service.unit_price_snapshot, service.vat_rate_snapshot,
                  COALESCE(
                      service.quantity > 0
                      AND service.quantity <= 1000000
                      AND service.unit_price_snapshot >= 0
                      AND service.unit_price_snapshot <= 9999999999.99
                      AND service.vat_rate_snapshot BETWEEN 0 AND 100
                      AND service.quantity * service.unit_price_snapshot <= 9999999999.99,
                      false
                  ) AS calculation_valid,
                  (service.status = 'invoiced' OR EXISTS (
                      SELECT 1 FROM invoice_order_line_allocations allocation
                      JOIN invoices invoice ON invoice.id = allocation.invoice_id
                      WHERE allocation.order_leistung_id = service.id
                        AND invoice.status NOT IN ('draft', 'cancelled')
                  )) AS billed
           FROM order_leistungen service
           WHERE service.order_id = $1"#,
    )
    .bind(order_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return fail(error, order_id, "services"),
    };
    let mut line_amounts_by_id: HashMap<Uuid, (bool, Amounts)> = HashMap::new();
    let mut billed_lines = std::collections::HashSet::new();
    let mut planned_services = Amounts::default();
    for row in &services {
        let id: Uuid = row.try_get("id").unwrap_or_default();
        let cancelled = row
            .try_get::<String, _>("status")
            .is_ok_and(|status| status == "cancelled");
        let passthrough = row
            .try_get::<bool, _>("is_cost_passthrough")
            .unwrap_or(false);
        let valid = row.try_get::<bool, _>("calculation_valid").unwrap_or(false)
            && row
                .try_get::<String, _>("currency")
                .is_ok_and(|value| value == currency);
        if row.try_get::<bool, _>("billed").unwrap_or(false) {
            billed_lines.insert(id);
        }
        if cancelled || !valid {
            continue;
        }
        let amounts = Amounts::of(money::line_amounts(
            row.try_get("quantity").unwrap_or(Decimal::ZERO),
            row.try_get("unit_price_snapshot").unwrap_or(Decimal::ZERO),
            if passthrough {
                Decimal::ZERO
            } else {
                row.try_get("vat_rate_snapshot").unwrap_or(Decimal::ZERO)
            },
        ));
        line_amounts_by_id.insert(id, (passthrough, amounts));
        if !passthrough {
            planned_services.add(amounts);
        }
    }

    let amendment_rows = match sqlx::query(
        r#"SELECT amendment.delta_amount, amendment.vat_rate, amendment.is_cost_passthrough,
                  amendment.decided_at, UPPER(amendment.currency) AS currency,
                  line.id AS line_id
           FROM order_amendments amendment
           LEFT JOIN order_leistungen line
                  ON line.source_order_amendment_id = amendment.id
                 AND line.status <> 'cancelled'
           WHERE amendment.order_id = $1 AND amendment.status = 'approved'"#,
    )
    .bind(order_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return fail(error, order_id, "amendments"),
    };
    let amendments = amendment_rows
        .iter()
        .filter(|row| {
            row.try_get::<String, _>("currency")
                .is_ok_and(|value| value == currency)
        })
        .map(|row| {
            let line = row
                .try_get::<Option<Uuid>, _>("line_id")
                .unwrap_or_default();
            let delta = row
                .try_get::<Decimal, _>("delta_amount")
                .unwrap_or(Decimal::ZERO);
            let rate = row
                .try_get::<Option<Decimal>, _>("vat_rate")
                .unwrap_or_default()
                .unwrap_or(Decimal::ZERO);
            let (line_passthrough, amounts) = line
                .and_then(|id| line_amounts_by_id.get(&id).copied())
                .unwrap_or((
                    false,
                    Amounts {
                        net: money::net_for_gross(delta, rate),
                        gross: delta.round_cents(),
                    },
                ));
            ApprovedAmendment {
                order_line_id: line,
                amounts,
                is_cost_passthrough: line_passthrough
                    || row
                        .try_get::<bool, _>("is_cost_passthrough")
                        .unwrap_or(false),
                decided_at: row.try_get("decided_at").unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();

    // Concierge services at their sale price, VAT of GMED's default tax
    // profile like their invoice lines (`invoices/concierge_lines.rs`).
    let concierge = match sqlx::query(
        r#"SELECT
               COALESCE(SUM(ROUND(service.quantity * service.unit_price, 2)), 0) AS net,
               (SELECT vat_rate FROM tax_profiles
                 WHERE is_default AND is_active
                   AND valid_from <= CURRENT_DATE
                   AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
                 ORDER BY valid_from DESC LIMIT 1) AS vat_rate
           FROM concierge_services service
           LEFT JOIN appointments appointment ON appointment.id = service.appointment_id
           WHERE COALESCE(service.order_id, appointment.order_id) = $1
             AND service.status <> 'cancelled'
             AND service.billing_status NOT IN ('waived', 'reversed')
             AND service.unit_price IS NOT NULL
             AND service.unit_price > 0
             AND service.quantity > 0
             AND UPPER(service.currency) = $2"#,
    )
    .bind(order_id)
    .bind(&currency)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => return fail(error, order_id, "concierge"),
    };
    let concierge_vat_rate = concierge
        .try_get::<Option<Decimal>, _>("vat_rate")
        .unwrap_or_default()
        .unwrap_or(Decimal::ZERO);
    let concierge_net = concierge
        .try_get::<Decimal, _>("net")
        .unwrap_or(Decimal::ZERO);
    let concierge_amounts = Amounts {
        net: concierge_net,
        gross: concierge_net + money::vat_amount(concierge_net, concierge_vat_rate),
    };

    // Medical visits add a treatment-organisation line when completed, unless
    // a line of the order already has a unit for them (`appointments.rs`).
    let visits = match sqlx::query(
        r#"SELECT
               (SELECT COALESCE(SUM(line.quantity), 0)
                FROM order_leistungen line
                LEFT JOIN agency_service_catalog catalog ON catalog.id = line.agency_service_id
                WHERE line.order_id = $1
                  AND line.status <> 'cancelled'
                  AND line.source_service_group_id IS NULL
                  AND COALESCE(line.agency_service_key_snapshot, catalog.service_key)
                      = 'treatment_organization') AS units,
               (SELECT COUNT(*) FROM appointments appointment
                WHERE appointment.order_id = $1
                  AND appointment.appointment_type = 'medical'
                  AND appointment.status = 'completed') AS completed,
               (SELECT COUNT(*) FROM appointments appointment
                WHERE appointment.order_id = $1
                  AND appointment.appointment_type = 'medical'
                  AND appointment.status NOT IN ('completed', 'cancelled')) AS pending,
               fee.unit_price, fee.vat_rate, UPPER(fee.currency) AS currency
           FROM (SELECT 1) one
           LEFT JOIN LATERAL (
               SELECT COALESCE(price.unit_price, catalog.unit_price) AS unit_price,
                      COALESCE(price.currency, catalog.currency) AS currency,
                      COALESCE(price.vat_rate, catalog.vat_rate) AS vat_rate
               FROM agency_service_catalog catalog
               LEFT JOIN LATERAL (
                   SELECT version.unit_price, version.currency, version.vat_rate
                   FROM agency_service_price_versions version
                   WHERE version.agency_service_id = catalog.id
                     AND version.valid_from <= CURRENT_DATE
                     AND (version.valid_to IS NULL OR version.valid_to >= CURRENT_DATE)
                   ORDER BY version.valid_from DESC, version.created_at DESC
                   LIMIT 1
               ) price ON true
               WHERE catalog.service_key = 'treatment_organization'
                 AND catalog.is_active = true
               ORDER BY catalog.created_at DESC
               LIMIT 1
           ) fee ON true"#,
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => return fail(error, order_id, "visits"),
    };
    let visit_fee = match (
        visits
            .try_get::<Option<Decimal>, _>("unit_price")
            .unwrap_or_default(),
        visits
            .try_get::<Option<String>, _>("currency")
            .unwrap_or_default(),
    ) {
        (Some(price), Some(fee_currency)) if fee_currency == currency && price > Decimal::ZERO => {
            Some(Amounts::of(money::line_amounts(
                Decimal::ONE,
                price,
                visits
                    .try_get::<Option<Decimal>, _>("vat_rate")
                    .unwrap_or_default()
                    .unwrap_or(Decimal::ZERO),
            )))
        }
        _ => None,
    };
    let (uncovered_visits, free_visit_units) = visit_coverage(
        visits.try_get("units").unwrap_or(Decimal::ZERO),
        visits.try_get("completed").unwrap_or(0),
        visits.try_get("pending").unwrap_or(0),
    );
    let mut planned_visits = Amounts::default();
    if let Some(fee) = visit_fee {
        planned_visits = Amounts {
            net: fee.net * Decimal::from(uncovered_visits),
            gross: fee.gross * Decimal::from(uncovered_visits),
        };
    }

    // Own services billed by issued invoices (advances are payments on
    // account; pass-through and re-billed lines are costs), less the credit
    // notes pro rata.
    let invoiced = match sqlx::query(
        r#"WITH own AS (
               SELECT invoice.id, invoice.total_gross, invoice.credited_amount,
                      COALESCE(SUM(COALESCE(NULLIF(line.value ->> 'line_net', '')::NUMERIC, 0)), 0) AS net,
                      COALESCE(SUM(COALESCE(NULLIF(line.value ->> 'line_gross', '')::NUMERIC, 0)), 0) AS gross
               FROM invoices invoice
               CROSS JOIN LATERAL jsonb_array_elements(
                   CASE WHEN jsonb_typeof(invoice.line_items) = 'array'
                        THEN invoice.line_items ELSE '[]'::jsonb END
               ) AS line(value)
               WHERE invoice.order_id = $1
                 AND invoice.invoice_type <> 'advance'
                 AND invoice.status IN ('sent', 'partially_paid', 'paid', 'overdue')
                 AND NOT COALESCE((line.value ->> 'is_cost_passthrough')::BOOLEAN, false)
                 AND COALESCE(line.value ->> 'source', '') <> 'external_invoice'
               GROUP BY invoice.id, invoice.total_gross, invoice.credited_amount
           )
           SELECT
               COALESCE(SUM(CASE WHEN total_gross > 0
                                 THEN net * GREATEST(total_gross - credited_amount, 0) / total_gross
                                 ELSE net END), 0) AS net,
               COALESCE(SUM(CASE WHEN total_gross > 0
                                 THEN gross * GREATEST(total_gross - credited_amount, 0) / total_gross
                                 ELSE gross END), 0) AS gross
           FROM own"#,
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => return fail(error, order_id, "invoiced"),
    };
    if let Err(error) = tx.commit().await {
        return fail(error, order_id, "commit");
    }

    let contract = contract_sum(versions, &amendments, &|id| billed_lines.contains(&id));
    let mut planned = planned_services;
    planned.add(concierge_amounts);
    planned.add(planned_visits);
    let invoiced = Amounts {
        net: invoiced
            .try_get::<Decimal, _>("net")
            .unwrap_or(Decimal::ZERO)
            .round_cents(),
        gross: invoiced
            .try_get::<Decimal, _>("gross")
            .unwrap_or(Decimal::ZERO)
            .round_cents(),
    };
    Json(budget_payload(
        order_id,
        &currency,
        contract.as_ref(),
        planned,
        invoiced,
        BudgetParts {
            services: planned_services,
            concierge: concierge_amounts,
            visits: planned_visits,
            uncovered_visits,
            free_visit_units,
            visit_fee,
            concierge_vat_rate,
        },
    ))
    .into_response()
}

/// How the planned own-service amount is made up.
pub(crate) struct BudgetParts {
    pub services: Amounts,
    pub concierge: Amounts,
    pub visits: Amounts,
    pub uncovered_visits: i64,
    pub free_visit_units: i64,
    pub visit_fee: Option<Amounts>,
    pub concierge_vat_rate: Decimal,
}

pub(crate) fn budget_payload(
    order_id: Uuid,
    currency: &str,
    contract: Option<&Contract>,
    planned: Amounts,
    invoiced: Amounts,
    parts: BudgetParts,
) -> Value {
    let remaining = contract.map(|contract| Amounts {
        net: contract.amounts.net - planned.net,
        gross: contract.amounts.gross - planned.gross,
    });
    let over_by = remaining
        .filter(|remaining| remaining.gross < Decimal::ZERO)
        .map(|remaining| Amounts {
            net: (-remaining.net).max(Decimal::ZERO),
            gross: -remaining.gross,
        });
    json!({
        "order_id": order_id,
        "currency": currency,
        "contract": contract.map(|contract| json!({
            "source": contract.source,
            "signed_at": contract.signed_at.map(|value| value.to_rfc3339()),
            "document_id": contract.document_id,
            "quote_number": contract.quote_number,
            "quotes": contract.quotes,
            "amendments": contract.amendments,
        })),
        "contract_own_services_net": contract.map(|contract| money_value(contract.amounts.net)),
        "contract_own_services_gross": contract.map(|contract| money_value(contract.amounts.gross)),
        "planned_own_services_net": money_value(planned.net),
        "planned_own_services_gross": money_value(planned.gross),
        "invoiced_own_services_net": money_value(invoiced.net),
        "invoiced_own_services_gross": money_value(invoiced.gross),
        "remaining_net": remaining.map(|value| money_value(value.net)),
        "remaining_gross": remaining.map(|value| money_value(value.gross)),
        "over_by_net": over_by.map(|value| money_value(value.net)),
        "over_by_gross": over_by.map(|value| money_value(value.gross)),
        "planned_parts": {
            "services_gross": money_value(parts.services.gross),
            "concierge_gross": money_value(parts.concierge.gross),
            "visits_gross": money_value(parts.visits.gross),
            "uncovered_visits": parts.uncovered_visits,
        },
        // For projections of an action before it is saved.
        "free_visit_units": parts.free_visit_units,
        "visit_fee_net": parts.visit_fee.map(|fee| money_value(fee.net)),
        "visit_fee_gross": parts.visit_fee.map(|fee| money_value(fee.gross)),
        "concierge_vat_rate": money_value(parts.concierge_vat_rate),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn amounts(net: i64, gross: i64) -> Amounts {
        Amounts {
            net: Decimal::from(net),
            gross: Decimal::from(gross),
        }
    }

    fn at(seconds: i64) -> Option<DateTime<Utc>> {
        DateTime::from_timestamp(1_800_000_000 + seconds, 0)
    }

    fn line(id: Uuid, net: i64, gross: i64) -> SignedLine {
        SignedLine {
            order_line_id: Some(id),
            amounts: amounts(net, gross),
        }
    }

    #[test]
    fn no_signed_version_has_no_contract() {
        assert_eq!(contract_sum(Vec::new(), &[], &|_| false), None);
    }

    #[test]
    fn signed_order_counts_its_own_lines() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let contract = contract_sum(
            vec![SignedVersion::Order {
                signed_at: at(0),
                document_id: None,
                lines: vec![line(a, 1000, 1190), line(b, 500, 595)],
            }],
            &[],
            &|_| false,
        )
        .unwrap();
        assert_eq!(contract.amounts, amounts(1500, 1785));
        assert_eq!(contract.source, "order_signature");
    }

    #[test]
    fn own_line_amounts_skip_passthrough() {
        let own = json!({"quantity": "2", "unit_price": "100", "vat_rate": "19",
                         "is_cost_passthrough": false});
        let passthrough = json!({"quantity": "1", "unit_price": "900", "vat_rate": "0",
                                 "is_cost_passthrough": true});
        assert_eq!(own_line_amounts(&own), Some(amounts(200, 238)));
        assert_eq!(own_line_amounts(&passthrough), None);
        let lines = own_lines(&json!([own, passthrough]), "id");
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn follow_up_quote_adds_to_the_signed_order() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let contract = contract_sum(
            vec![
                SignedVersion::Quote {
                    quote_id: Uuid::new_v4(),
                    quote_number: "KV-2".into(),
                    signed_at: at(100),
                    lines: vec![line(b, 300, 357)],
                },
                SignedVersion::Order {
                    signed_at: at(0),
                    document_id: None,
                    lines: vec![line(a, 1000, 1190)],
                },
            ],
            &[],
            &|_| false,
        )
        .unwrap();
        assert_eq!(contract.amounts, amounts(1300, 1547));
        assert_eq!(contract.source, "quote");
        assert_eq!(contract.quote_number.as_deref(), Some("KV-2"));
    }

    #[test]
    fn later_order_signature_replaces_earlier_quotes() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let contract = contract_sum(
            vec![
                SignedVersion::Quote {
                    quote_id: Uuid::new_v4(),
                    quote_number: "KV-1".into(),
                    signed_at: at(0),
                    lines: vec![line(a, 1000, 1190), line(b, 300, 357)],
                },
                SignedVersion::Order {
                    signed_at: at(50),
                    document_id: None,
                    lines: vec![line(a, 800, 952)],
                },
            ],
            &[],
            &|_| false,
        )
        .unwrap();
        assert_eq!(contract.amounts, amounts(800, 952));
    }

    #[test]
    fn requote_of_a_partly_billed_line_keeps_the_larger_amount() {
        let a = Uuid::new_v4();
        let versions = vec![
            SignedVersion::Order {
                signed_at: at(0),
                document_id: None,
                lines: vec![line(a, 1000, 1190)],
            },
            SignedVersion::Quote {
                quote_id: Uuid::new_v4(),
                quote_number: "KV-3".into(),
                signed_at: at(10),
                lines: vec![line(a, 400, 476)],
            },
        ];
        let billed = contract_sum(versions.clone(), &[], &|_| true).unwrap();
        assert_eq!(billed.amounts, amounts(1000, 1190));
        let repriced = contract_sum(versions, &[], &|_| false).unwrap();
        assert_eq!(repriced.amounts, amounts(400, 476));
    }

    #[test]
    fn approved_amendments_add_unless_signed_or_passthrough() {
        let (a, extra, signed_extra) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let contract = contract_sum(
            vec![SignedVersion::Order {
                signed_at: at(0),
                document_id: None,
                lines: vec![line(a, 1000, 1190), line(signed_extra, 100, 119)],
            }],
            &[
                ApprovedAmendment {
                    order_line_id: Some(extra),
                    amounts: amounts(200, 238),
                    is_cost_passthrough: false,
                    decided_at: at(5),
                },
                ApprovedAmendment {
                    order_line_id: Some(signed_extra),
                    amounts: amounts(100, 119),
                    is_cost_passthrough: false,
                    decided_at: at(-5),
                },
                ApprovedAmendment {
                    order_line_id: Some(Uuid::new_v4()),
                    amounts: amounts(700, 700),
                    is_cost_passthrough: true,
                    decided_at: at(5),
                },
                // Legacy amendment without a line, decided before signing.
                ApprovedAmendment {
                    order_line_id: None,
                    amounts: amounts(50, 50),
                    is_cost_passthrough: false,
                    decided_at: at(-10),
                },
                // ... and one decided after.
                ApprovedAmendment {
                    order_line_id: None,
                    amounts: amounts(60, 60),
                    is_cost_passthrough: false,
                    decided_at: at(10),
                },
            ],
            &|_| false,
        )
        .unwrap();
        assert_eq!(contract.amounts, amounts(1360, 1607));
        assert_eq!(contract.amendments, 2);
    }

    #[test]
    fn visit_coverage_counts_pending_visits_beyond_free_units() {
        // 3 units, 1 visit done, 4 pending: 2 units free, 2 visits uncovered.
        assert_eq!(visit_coverage(Decimal::from(3), 1, 4), (2, 0));
        // 5 units, 1 done, 2 pending: 2 still free afterwards.
        assert_eq!(visit_coverage(Decimal::from(5), 1, 2), (0, 2));
        assert_eq!(visit_coverage(Decimal::ZERO, 3, 0), (0, 0));
    }

    #[test]
    fn payload_reports_remaining_and_overrun() {
        let contract = Contract {
            amounts: amounts(1700, 2000),
            source: "order_signature",
            signed_at: None,
            document_id: None,
            quote_number: None,
            quotes: 0,
            amendments: 0,
        };
        let parts = || BudgetParts {
            services: Amounts::default(),
            concierge: Amounts::default(),
            visits: Amounts::default(),
            uncovered_visits: 0,
            free_visit_units: 0,
            visit_fee: None,
            concierge_vat_rate: Decimal::from(19),
        };
        let within = budget_payload(
            Uuid::nil(),
            "EUR",
            Some(&contract),
            amounts(1550, 1850),
            Amounts::default(),
            parts(),
        );
        assert_eq!(within["remaining_gross"], "150");
        assert_eq!(within["over_by_gross"], Value::Null);
        let over = budget_payload(
            Uuid::nil(),
            "EUR",
            Some(&contract),
            amounts(1800, 2100),
            Amounts::default(),
            parts(),
        );
        assert_eq!(over["remaining_gross"], "-100");
        assert_eq!(over["over_by_gross"], "100");
        assert_eq!(over["over_by_net"], "100");
        let none = budget_payload(
            Uuid::nil(),
            "EUR",
            None,
            amounts(1800, 2100),
            Amounts::default(),
            parts(),
        );
        assert_eq!(none["contract_own_services_gross"], Value::Null);
        assert_eq!(none["remaining_gross"], Value::Null);
    }
}
