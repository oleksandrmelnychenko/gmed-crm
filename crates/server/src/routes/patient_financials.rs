use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/financial-summary",
            get(get_patient_financial_summary),
        )
        .route(
            "/patients/{patient_id}/financial-ledger",
            get(get_patient_financial_ledger),
        )
}

#[derive(Deserialize)]
struct PatientFinancialQuery {
    from: Option<String>,
    to: Option<String>,
    order_id: Option<Uuid>,
    include_pass_through: Option<bool>,
    currency: Option<String>,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error").to_lowercase(),
            "message": message,
        })),
    )
        .into_response()
}

fn can_read_patient_financials(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    )
}

fn can_read_profit_margin(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::CeoAssistant | Role::Billing) {
        return Ok(());
    }

    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "validate patient financial access");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

fn parse_query_date(value: Option<&str>, field: &'static str) -> Result<Option<NaiveDate>, String> {
    match value {
        Some(raw) if !raw.trim().is_empty() => NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map(Some)
            .map_err(|_| format!("Invalid {field} (YYYY-MM-DD)")),
        _ => Ok(None),
    }
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn value_to_decimal(value: &Value) -> Decimal {
    match value {
        Value::String(text) => text.parse().unwrap_or(Decimal::ZERO),
        Value::Number(number) => number.to_string().parse().unwrap_or(Decimal::ZERO),
        _ => Decimal::ZERO,
    }
}

fn line_service_type(item: &Value) -> String {
    item.get("service_type")
        .and_then(Value::as_str)
        .or_else(|| item.get("service_key").and_then(Value::as_str))
        .unwrap_or("other")
        .to_string()
}

async fn get_patient_financial_summary(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if !can_read_patient_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let from = match parse_query_date(query.from.as_deref(), "from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let to = match parse_query_date(query.to.as_deref(), "to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let currency = query.currency.unwrap_or_else(|| "EUR".to_string());
    let include_pass_through = query.include_pass_through.unwrap_or(true);

    let invoice_rows = match sqlx::query(
        r#"SELECT id, order_id, invoice_number, status, issued_at, due_date,
                  total_net, total_vat, total_gross, paid_amount, line_items
           FROM invoices
           WHERE patient_id = $1
             AND status <> 'cancelled'
             AND ($2::date IS NULL OR issued_at::date >= $2)
             AND ($3::date IS NULL OR issued_at::date <= $3)
             AND ($4::uuid IS NULL OR order_id = $4)
           ORDER BY issued_at DESC, created_at DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient invoice financials");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient financial summary",
            );
        }
    };

    let expense_row = match sqlx::query(
        r#"SELECT COALESCE(SUM(amount_net), 0) AS expenses_net,
                  COALESCE(SUM(amount_vat), 0) AS expenses_vat,
                  COALESCE(SUM(amount_gross), 0) AS expenses_gross
           FROM accounting_entries
           WHERE patient_id = $1
             AND direction = 'expense'
             AND ($2::date IS NULL OR entry_date >= $2)
             AND ($3::date IS NULL OR entry_date <= $3)
             AND ($4::uuid IS NULL OR order_id = $4)
             AND ($5::boolean = true OR category <> 'cost_passthrough_revenue')"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .bind(include_pass_through)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient expense financials");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient financial summary",
            );
        }
    };

    let mut revenue_net = Decimal::ZERO;
    let mut revenue_vat = Decimal::ZERO;
    let mut revenue_gross = Decimal::ZERO;
    let mut paid_amount = Decimal::ZERO;
    let mut open_balance = Decimal::ZERO;
    let mut overdue_amount = Decimal::ZERO;
    let mut order_breakdown = Vec::new();
    let mut service_breakdown = std::collections::BTreeMap::<String, (Decimal, Decimal)>::new();
    let today = Utc::now().date_naive();

    for row in invoice_rows {
        let total_net = row
            .try_get::<Decimal, _>("total_net")
            .unwrap_or(Decimal::ZERO);
        let total_vat = row
            .try_get::<Decimal, _>("total_vat")
            .unwrap_or(Decimal::ZERO);
        let total_gross = row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO);
        let paid = row
            .try_get::<Decimal, _>("paid_amount")
            .unwrap_or(Decimal::ZERO);
        let balance = (total_gross - paid).max(Decimal::ZERO);
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let due_date = row
            .try_get::<Option<NaiveDate>, _>("due_date")
            .unwrap_or_default();
        let line_items = row
            .try_get::<Value, _>("line_items")
            .unwrap_or_else(|_| serde_json::json!([]));

        revenue_net += total_net;
        revenue_vat += total_vat;
        revenue_gross += total_gross;
        paid_amount += paid;
        open_balance += balance;
        if status == "overdue"
            || due_date.is_some_and(|value| value < today && balance > Decimal::ZERO)
        {
            overdue_amount += balance;
        }

        if let Some(items) = line_items.as_array() {
            for item in items {
                let gross = value_to_decimal(item.get("line_gross").unwrap_or(&Value::Null));
                let net = value_to_decimal(item.get("line_net").unwrap_or(&Value::Null));
                let entry = service_breakdown
                    .entry(line_service_type(item))
                    .or_insert((Decimal::ZERO, Decimal::ZERO));
                entry.0 += net;
                entry.1 += gross;
            }
        }

        order_breakdown.push(serde_json::json!({
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "invoice_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
            "status": status,
            "revenue_net": decimal_to_string(total_net),
            "revenue_vat": decimal_to_string(total_vat),
            "revenue_gross": decimal_to_string(total_gross),
            "paid_amount": decimal_to_string(paid),
            "open_balance": decimal_to_string(balance),
        }));
    }

    let expenses_net = expense_row
        .try_get::<Decimal, _>("expenses_net")
        .unwrap_or(Decimal::ZERO);
    let expenses_vat = expense_row
        .try_get::<Decimal, _>("expenses_vat")
        .unwrap_or(Decimal::ZERO);
    let expenses_gross = expense_row
        .try_get::<Decimal, _>("expenses_gross")
        .unwrap_or(Decimal::ZERO);
    let margin_net = revenue_net - expenses_net;
    let margin_percent = if revenue_net > Decimal::ZERO {
        (margin_net / revenue_net * Decimal::new(100, 0)).round_dp(2)
    } else {
        Decimal::ZERO
    };
    let margin_allowed = can_read_profit_margin(auth.role);

    let service_breakdown = service_breakdown
        .into_iter()
        .map(|(service_type, (net, gross))| {
            serde_json::json!({
                "service_type": service_type,
                "revenue_net": decimal_to_string(net),
                "revenue_gross": decimal_to_string(gross),
            })
        })
        .collect::<Vec<_>>();

    Json(serde_json::json!({
        "patient_id": patient_id,
        "currency": currency,
        "filters": {
            "from": from.map(|value| value.to_string()),
            "to": to.map(|value| value.to_string()),
            "order_id": query.order_id,
            "include_pass_through": include_pass_through,
        },
        "revenue_net": decimal_to_string(revenue_net),
        "revenue_vat": decimal_to_string(revenue_vat),
        "revenue_gross": decimal_to_string(revenue_gross),
        "paid_amount": decimal_to_string(paid_amount),
        "open_balance": decimal_to_string(open_balance),
        "overdue_amount": decimal_to_string(overdue_amount),
        "expenses_net": if margin_allowed { serde_json::json!(decimal_to_string(expenses_net)) } else { Value::Null },
        "expenses_vat": if margin_allowed { serde_json::json!(decimal_to_string(expenses_vat)) } else { Value::Null },
        "expenses_gross": if margin_allowed { serde_json::json!(decimal_to_string(expenses_gross)) } else { Value::Null },
        "margin_net": if margin_allowed { serde_json::json!(decimal_to_string(margin_net)) } else { Value::Null },
        "margin_percent": if margin_allowed { serde_json::json!(decimal_to_string(margin_percent)) } else { Value::Null },
        "margin_visible": margin_allowed,
        "breakdown_by_order": order_breakdown,
        "breakdown_by_service_type": service_breakdown,
        "issues": [],
    }))
    .into_response()
}

async fn get_patient_financial_ledger(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<PatientFinancialQuery>,
) -> axum::response::Response {
    if !can_read_patient_financials(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let from = match parse_query_date(query.from.as_deref(), "from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let to = match parse_query_date(query.to.as_deref(), "to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let margin_allowed = can_read_profit_margin(auth.role);

    match sqlx::query(
        r#"SELECT ae.id, ae.entry_date, ae.direction, ae.category, ae.description,
                  ae.amount_net, ae.amount_vat, ae.amount_gross, ae.currency,
                  i.invoice_number, ei.external_invoice_number, o.order_number
           FROM accounting_entries ae
           LEFT JOIN invoices i ON i.id = ae.source_invoice_id
           LEFT JOIN external_invoices ei ON ei.id = ae.source_external_invoice_id
           LEFT JOIN orders o ON o.id = ae.order_id
           WHERE ae.patient_id = $1
             AND ($2::date IS NULL OR ae.entry_date >= $2)
             AND ($3::date IS NULL OR ae.entry_date <= $3)
             AND ($4::uuid IS NULL OR ae.order_id = $4)
           ORDER BY ae.entry_date DESC, ae.created_at DESC"#,
    )
    .bind(patient_id)
    .bind(from)
    .bind(to)
    .bind(query.order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let entries = rows
                .into_iter()
                .filter_map(|row| {
                    let direction = row.try_get::<String, _>("direction").unwrap_or_default();
                    if direction == "expense" && !margin_allowed {
                        return None;
                    }
                    Some(serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "entry_date": row.try_get::<NaiveDate, _>("entry_date").map(|value| value.to_string()).unwrap_or_default(),
                        "direction": direction,
                        "category": row.try_get::<String, _>("category").unwrap_or_default(),
                        "description": row.try_get::<String, _>("description").unwrap_or_default(),
                        "amount_net": decimal_to_string(row.try_get::<Decimal, _>("amount_net").unwrap_or(Decimal::ZERO)),
                        "amount_vat": decimal_to_string(row.try_get::<Decimal, _>("amount_vat").unwrap_or(Decimal::ZERO)),
                        "amount_gross": decimal_to_string(row.try_get::<Decimal, _>("amount_gross").unwrap_or(Decimal::ZERO)),
                        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                        "invoice_number": row.try_get::<Option<String>, _>("invoice_number").unwrap_or_default(),
                        "external_invoice_number": row.try_get::<Option<String>, _>("external_invoice_number").unwrap_or_default(),
                        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                    }))
                })
                .collect::<Vec<_>>();
            Json(serde_json::json!({
                "patient_id": patient_id,
                "margin_visible": margin_allowed,
                "entries": entries,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient financial ledger");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient financial ledger",
            )
        }
    }
}
