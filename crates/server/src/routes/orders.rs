use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/followup-milestones", get(list_my_followup_milestones))
        .route("/orders", get(list_orders).post(create_order))
        .route("/orders/debt-management", get(list_debt_management_queue))
        .route("/orders/{order_id}", get(get_order))
        .route(
            "/orders/{order_id}/debt-management",
            post(update_debt_management),
        )
        .route("/orders/{order_id}/phase", post(update_phase))
        .route(
            "/orders/{order_id}/execution-flow",
            post(update_execution_flow),
        )
        .route(
            "/orders/{order_id}/followup-flow",
            post(update_followup_flow),
        )
        .route(
            "/orders/{order_id}/planning-preparation",
            post(update_planning_preparation),
        )
        .route(
            "/orders/{order_id}/process-gates",
            post(update_process_gates),
        )
        .route(
            "/orders/{order_id}/leistungen",
            get(list_leistungen).post(add_leistung),
        )
        .route(
            "/orders/{order_id}/external-invoices",
            get(list_external_invoices).post(create_external_invoice),
        )
        .route(
            "/orders/{order_id}/external-invoices/{external_invoice_id}/update",
            post(update_external_invoice),
        )
        .route(
            "/orders/{order_id}/leistungen/{leistung_id}/approve",
            post(approve_leistung),
        )
}

#[derive(Deserialize)]
struct CreateOrderRequest {
    patient_id: Uuid,
    contract_id: Option<Uuid>,
    needs_description: Option<String>,
}

#[derive(Deserialize)]
struct PhaseRequest {
    phase: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct UpdateOrderProcessGatesRequest {
    billing_release_status: Option<String>,
    billing_release_note: Option<String>,
    package_coverage_status: Option<String>,
    package_coverage_note: Option<String>,
}

#[derive(Deserialize)]
struct UpdateOrderDebtManagementRequest {
    status: Option<String>,
    note: Option<String>,
    owner_user_id: Option<Uuid>,
    next_review_at: Option<String>,
    last_contact_at: Option<String>,
    resolution_note: Option<String>,
}

#[derive(Deserialize)]
struct UpdateOrderPlanningPreparationRequest {
    treatment_plan_status: Option<String>,
    treatment_plan_note: Option<String>,
    non_medical_required: Option<bool>,
    interpreter_required: Option<bool>,
    preparation_documents_status: Option<String>,
    interpreter_briefing_status: Option<String>,
}

#[derive(Deserialize)]
struct UpdateOrderExecutionFlowRequest {
    arrival_status: Option<String>,
    medical_execution_status: Option<String>,
    non_medical_execution_status: Option<String>,
    interpreter_service_status: Option<String>,
    issue_status: Option<String>,
    deviation_note: Option<String>,
    execution_summary: Option<String>,
}

#[derive(Deserialize)]
struct UpdateOrderFollowupFlowRequest {
    doctor_followup_status: Option<String>,
    followup_1w_status: Option<String>,
    followup_1m_status: Option<String>,
    followup_6m_status: Option<String>,
    package_end_date: Option<String>,
    package_end_status: Option<String>,
    results_handoff_status: Option<String>,
    followup_summary: Option<String>,
}

#[derive(Deserialize)]
struct AddLeistungRequest {
    description: String,
    quantity: f64,
    unit_price: f64,
    vat_rate: Option<f64>,
    is_cost_passthrough: Option<bool>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    external_document_id: Option<Uuid>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct CreateExternalInvoiceRequest {
    provider_id: Option<Uuid>,
    external_invoice_number: String,
    invoice_date: Option<String>,
    due_date: Option<String>,
    amount_net: Option<f64>,
    amount_vat: Option<f64>,
    amount_gross: f64,
    currency: Option<String>,
    status: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdateExternalInvoiceRequest {
    provider_id: Option<Uuid>,
    invoice_date: Option<String>,
    due_date: Option<String>,
    amount_net: Option<f64>,
    amount_vat: Option<f64>,
    amount_gross: Option<f64>,
    currency: Option<String>,
    status: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct ListOrdersQuery {
    search: Option<String>,
    phase: Option<String>,
    status: Option<String>,
    patient_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    provider_taxonomy_node_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct ListDebtManagementQuery {
    status: Option<String>,
    owner_user_id: Option<Uuid>,
    open_only: Option<bool>,
    provider_taxonomy_node_id: Option<Uuid>,
}

const EXTERNAL_INVOICE_CHECK_INTERVAL_SECS: u64 = 60 * 60 * 6;

#[derive(Default, Clone, Copy, Debug)]
pub struct ExternalInvoiceDeadlineRunSummary {
    pub overdue_marked: u64,
    pub notifications_created: u64,
}

fn gen_order_number(seq: i64) -> String {
    format!("A-{}-{:04}", chrono::Utc::now().format("%Y%m%d"), seq)
}

fn is_valid_external_invoice_status(value: &str) -> bool {
    matches!(
        value,
        "expected" | "received" | "approved" | "paid" | "overdue" | "cancelled"
    )
}

#[allow(clippy::result_large_err)]
fn parse_optional_order_date(
    value: Option<&str>,
) -> Result<Option<chrono::NaiveDate>, axum::response::Response> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(raw) => chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| {
                err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid date (YYYY-MM-DD)",
                )
            }),
        None => Ok(None),
    }
}

async fn list_orders(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListOrdersQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }

    if let Some(ref phase) = query.phase
        && !is_valid_order_phase(phase)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid phase");
    }
    if let Some(ref status) = query.status
        && !is_valid_order_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());

    match sqlx::query(
        r#"SELECT o.id, o.order_number, o.patient_id, o.phase, o.status,
                  o.total_estimated, o.created_at,
                  p.first_name, p.last_name, p.patient_id AS p_pid
           FROM orders o
           JOIN patients p ON p.id = o.patient_id
           WHERE ($1::text = '%%'
                  OR de_normalize(concat_ws(' ',
                       o.order_number, o.needs_description,
                       p.first_name, p.last_name, p.patient_id,
                       p.email, p.phone_primary, p.phone_secondary
                     )) LIKE de_normalize($1)
                  OR EXISTS (
                        SELECT 1
                        FROM order_leistungen ol
                        LEFT JOIN providers pr ON pr.id = ol.provider_id
                        LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
                        WHERE ol.order_id = o.id
                          AND de_normalize(concat_ws(' ',
                                ol.description, ol.notes, pr.name, d.name
                              )) LIKE de_normalize($1)
                  )
           )
             AND ($2::text IS NULL OR o.phase = $2)
             AND ($3::text IS NULL OR o.status = $3)
             AND ($4::uuid IS NULL OR o.patient_id = $4)
             AND (
                $5::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    WHERE ol.order_id = o.id
                      AND ol.provider_id = $5
                )
             )
             AND (
                $6::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    WHERE ol.order_id = o.id
                      AND ol.doctor_id = $6
                )
             )
             AND (
                $7::uuid IS NULL
                OR EXISTS (
                    WITH RECURSIVE selected_taxonomy AS (
                        SELECT n.id
                        FROM provider_taxonomy_nodes n
                        WHERE n.id = $7
                        UNION ALL
                        SELECT child.id
                        FROM provider_taxonomy_nodes child
                        JOIN selected_taxonomy parent
                          ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM order_leistungen ol
                    JOIN provider_taxonomy_assignments pta_filter
                      ON pta_filter.provider_id = ol.provider_id
                    JOIN selected_taxonomy st
                      ON st.id = pta_filter.taxonomy_node_id
                    WHERE ol.order_id = o.id
                )
             )
           ORDER BY o.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.phase)
    .bind(query.status)
    .bind(query.patient_id)
    .bind(query.provider_id)
    .bind(query.doctor_id)
    .bind(query.provider_taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut orders = Vec::with_capacity(rows.len());
            for r in rows {
                let order_id = r.try_get::<Uuid, _>("id").unwrap_or_default();
                let patient_id = r.try_get::<Uuid, _>("patient_id").unwrap_or_default();

                match can_access_order(&state, &auth, order_id, Some(patient_id)).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                orders.push(serde_json::json!({
                    "id": order_id,
                    "order_number": r.try_get::<String, _>("order_number").unwrap_or_default(),
                    "patient_id": patient_id,
                    "patient_name": format!(
                        "{} {}",
                        r.try_get::<String, _>("first_name").unwrap_or_default(),
                        r.try_get::<String, _>("last_name").unwrap_or_default()
                    ),
                    "patient_pid": r.try_get::<String, _>("p_pid").unwrap_or_default(),
                    "phase": r.try_get::<String, _>("phase").unwrap_or_default(),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "total_estimated": r.try_get::<Option<rust_decimal::Decimal>, _>("total_estimated").unwrap_or_default(),
                    "created_at": r.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(orders).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list orders");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_debt_management_queue(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListDebtManagementQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo]) {
        return e;
    }

    let status_filter = query
        .status
        .as_ref()
        .map(|value| value.trim().to_lowercase());
    if let Some(ref value) = status_filter
        && !crate::routes::debt_management::is_valid_debt_management_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid debt-management status",
        );
    }

    let scope_user_id = if auth.role == Role::PatientManager {
        Some(auth.user_id)
    } else {
        None
    };
    let open_only = query.open_only.unwrap_or(true);

    match sqlx::query(
        r#"SELECT o.id AS order_id,
                  o.order_number,
                  o.phase,
                  o.status AS order_status,
                  p.id AS patient_id,
                  p.patient_id AS patient_code,
                  p.first_name,
                  p.last_name,
                  dm.status,
                  dm.note,
                  dm.owner_user_id,
                  owner_user.name AS owner_name,
                  dm.next_review_at,
                  dm.last_contact_at,
                  dm.resolution_note,
                  dm.resolved_at,
                  dm.updated_at,
                  COALESCE((
                    SELECT COUNT(*)
                    FROM invoices i
                    WHERE i.order_id = o.id
                      AND i.status = 'overdue'
                      AND i.total_gross > COALESCE(i.paid_amount, 0)
                  ), 0) AS overdue_invoice_count,
                  COALESCE((
                    SELECT SUM(
                        CASE
                            WHEN i.status NOT IN ('paid', 'cancelled')
                            THEN GREATEST(i.total_gross - COALESCE(i.paid_amount, 0), 0)
                            ELSE 0
                        END
                    )
                    FROM invoices i
                    WHERE i.order_id = o.id
                  ), 0) AS outstanding_balance
           FROM orders o
           JOIN patients p ON p.id = o.patient_id
           JOIN order_debt_management dm ON dm.order_id = o.id
           LEFT JOIN users owner_user ON owner_user.id = dm.owner_user_id
           WHERE o.status NOT IN ('completed', 'cancelled')
             AND ($1::text IS NULL OR dm.status = $1)
             AND ($2::uuid IS NULL OR dm.owner_user_id = $2)
             AND (
                    $3::bool = false
                    OR dm.status IN ('review_required', 'payment_plan', 'awaiting_payment', 'escalated')
                    OR EXISTS (
                        SELECT 1
                        FROM invoices i
                        WHERE i.order_id = o.id
                          AND i.status = 'overdue'
                          AND i.total_gross > COALESCE(i.paid_amount, 0)
                    )
                 )
             AND (
                    $4::uuid IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM patient_assignments pa
                        WHERE pa.patient_id = o.patient_id
                          AND pa.user_id = $4
                          AND pa.revoked_at IS NULL
                    )
                 )
             AND (
                    $5::uuid IS NULL
                    OR EXISTS (
                        WITH RECURSIVE selected_taxonomy AS (
                            SELECT n.id
                            FROM provider_taxonomy_nodes n
                            WHERE n.id = $5
                            UNION ALL
                            SELECT child.id
                            FROM provider_taxonomy_nodes child
                            JOIN selected_taxonomy parent
                              ON child.parent_id = parent.id
                        )
                        SELECT 1
                        FROM order_leistungen ol
                        JOIN provider_taxonomy_assignments pta_filter
                          ON pta_filter.provider_id = ol.provider_id
                        JOIN selected_taxonomy st
                          ON st.id = pta_filter.taxonomy_node_id
                        WHERE ol.order_id = o.id
                    )
                 )
           ORDER BY overdue_invoice_count DESC,
                    dm.next_review_at NULLS LAST,
                    dm.updated_at DESC,
                    o.created_at DESC
           LIMIT 200"#,
    )
    .bind(status_filter)
    .bind(query.owner_user_id)
    .bind(open_only)
    .bind(scope_user_id)
    .bind(query.provider_taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                let overdue_invoice_count = row
                    .try_get::<i64, _>("overdue_invoice_count")
                    .unwrap_or_default();
                let outstanding_balance = row
                    .try_get::<rust_decimal::Decimal, _>("outstanding_balance")
                    .unwrap_or(rust_decimal::Decimal::ZERO);
                let status: String = row
                    .try_get("status")
                    .unwrap_or_else(|_| "not_required".to_string());
                let effective_status =
                    crate::routes::debt_management::effective_status(&status, overdue_invoice_count);
                let next_review_at: Option<chrono::DateTime<chrono::Utc>> =
                    row.try_get("next_review_at").unwrap_or_default();
                let blocking_reason = crate::routes::debt_management::build_blocking_reason(
                    &effective_status,
                    overdue_invoice_count,
                    next_review_at,
                );

                items.push(serde_json::json!({
                    "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
                    "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                    "phase": row.try_get::<String, _>("phase").unwrap_or_default(),
                    "order_status": row.try_get::<String, _>("order_status").unwrap_or_default(),
                    "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
                    "patient_code": row.try_get::<String, _>("patient_code").unwrap_or_default(),
                    "patient_name": format!(
                        "{} {}",
                        row.try_get::<String, _>("first_name").unwrap_or_default(),
                        row.try_get::<String, _>("last_name").unwrap_or_default(),
                    ),
                    "status": status,
                    "effective_status": effective_status,
                    "blocking_reason": blocking_reason,
                    "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
                    "owner_user_id": row.try_get::<Option<Uuid>, _>("owner_user_id").unwrap_or_default(),
                    "owner_name": row.try_get::<Option<String>, _>("owner_name").unwrap_or_default(),
                    "next_review_at": next_review_at.map(|value| value.to_rfc3339()),
                    "last_contact_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_contact_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    "resolution_note": row.try_get::<Option<String>, _>("resolution_note").unwrap_or_default(),
                    "resolved_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("resolved_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    "updated_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("updated_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    "overdue_invoice_count": overdue_invoice_count,
                    "outstanding_balance": outstanding_balance.round_dp(2).normalize().to_string(),
                }));
            }

            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list debt-management queue");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load debt-management queue",
            )
        }
    }
}

fn is_valid_order_phase(value: &str) -> bool {
    matches!(
        value,
        "discovery" | "intake" | "execution" | "closure" | "followup"
    )
}

fn is_valid_order_status(value: &str) -> bool {
    matches!(value, "active" | "paused" | "completed" | "cancelled")
}

fn is_valid_billing_release_status(value: &str) -> bool {
    matches!(value, "pending" | "granted" | "denied")
}

fn is_valid_package_coverage_status(value: &str) -> bool {
    matches!(value, "unknown" | "covered" | "not_covered")
}

fn parse_optional_datetime(
    value: Option<&str>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => chrono::DateTime::parse_from_rfc3339(raw)
            .map(|value| Some(value.with_timezone(&chrono::Utc)))
            .map_err(|_| "Invalid datetime (RFC3339)"),
        _ => Ok(None),
    }
}

fn is_valid_treatment_plan_status(value: &str) -> bool {
    matches!(
        value,
        "draft" | "agreed" | "correction_requested" | "finalized"
    )
}

fn is_valid_preparation_documents_status(value: &str) -> bool {
    matches!(value, "pending" | "sent" | "not_required")
}

fn is_valid_interpreter_briefing_status(value: &str) -> bool {
    matches!(value, "not_needed" | "pending" | "completed")
}

fn is_valid_execution_arrival_status(value: &str) -> bool {
    matches!(value, "pending" | "arrived" | "not_required")
}

fn is_valid_execution_step_status(value: &str) -> bool {
    matches!(
        value,
        "pending" | "in_progress" | "completed" | "not_required"
    )
}

fn is_valid_execution_issue_status(value: &str) -> bool {
    matches!(
        value,
        "pending" | "monitoring" | "resolved" | "not_required"
    )
}

fn is_valid_followup_status(value: &str) -> bool {
    matches!(
        value,
        "pending" | "scheduled" | "completed" | "not_required"
    )
}

fn is_valid_results_handoff_status(value: &str) -> bool {
    matches!(value, "pending" | "completed" | "not_required")
}

struct OrderProcessReadiness {
    execution_ready: bool,
    blocking_reasons: Vec<String>,
    payload: serde_json::Value,
}

struct OrderPlanningReadiness {
    planning_ready: bool,
    blocking_reasons: Vec<String>,
    payload: serde_json::Value,
}

struct OrderExecutionReadiness {
    closure_ready: bool,
    blocking_reasons: Vec<String>,
    payload: serde_json::Value,
}

struct OrderFollowupReadiness {
    followup_ready: bool,
    blocking_reasons: Vec<String>,
    payload: serde_json::Value,
}

fn next_order_phase(current: &str) -> Option<&'static str> {
    match current {
        "discovery" => Some("intake"),
        "intake" => Some("execution"),
        "execution" => Some("closure"),
        "closure" => Some("followup"),
        _ => None,
    }
}

struct OrderLifecycleGate {
    blocked: bool,
    reasons: Vec<String>,
}

async fn load_order_transition_gate(
    state: &AppState,
    order_id: Uuid,
    current_phase: &str,
    process_gates: &OrderProcessReadiness,
) -> Result<OrderLifecycleGate, axum::response::Response> {
    let mut reasons = Vec::new();

    match next_order_phase(current_phase) {
        Some("execution") => {
            if !process_gates.execution_ready {
                reasons.extend(process_gates.blocking_reasons.clone());
            }
            let planning = load_order_planning_readiness(state, order_id).await?;
            if !planning.planning_ready {
                reasons.extend(planning.blocking_reasons);
            }
        }
        Some("closure") => {
            let execution = load_order_execution_readiness(state, order_id).await?;
            if !execution.closure_ready {
                reasons.extend(execution.blocking_reasons);
            }
        }
        Some("followup") => {
            let followup = load_order_followup_readiness(state, order_id).await?;
            if !followup.followup_ready {
                reasons.extend(followup.blocking_reasons);
            }
        }
        _ => {}
    }

    Ok(OrderLifecycleGate {
        blocked: !reasons.is_empty(),
        reasons,
    })
}

async fn load_order_lifecycle(
    state: &AppState,
    order_id: Uuid,
    current_phase: &str,
    created_at: chrono::DateTime<chrono::Utc>,
    process_gates: &OrderProcessReadiness,
) -> Result<serde_json::Value, axum::response::Response> {
    let mut history =
        crate::routes::workflow_lifecycle::load_history(state, "order", order_id).await?;
    if history.is_empty() {
        history.push(serde_json::json!({
            "from_stage": serde_json::Value::Null,
            "to_stage": current_phase,
            "transition_kind": "created",
            "note": serde_json::Value::Null,
            "metadata": {},
            "changed_by": serde_json::Value::Null,
            "created_at": created_at.to_rfc3339(),
        }));
    }

    let next_phase = next_order_phase(current_phase);
    let transition_gate =
        load_order_transition_gate(state, order_id, current_phase, process_gates).await?;

    let allowed_transitions = next_phase
        .map(|phase| {
            vec![serde_json::json!({
                "phase": phase,
                "blocked": transition_gate.blocked,
                "reasons": transition_gate.reasons,
            })]
        })
        .unwrap_or_default();

    Ok(serde_json::json!({
        "current_stage": current_phase,
        "stage_entered_at": crate::routes::workflow_lifecycle::stage_entered_at(&history, current_phase)
            .or_else(|| Some(created_at.to_rfc3339())),
        "next_stage": next_phase,
        "allowed_transitions": allowed_transitions,
        "history": history,
    }))
}

fn lifecycle_gate_err(phase: &str, reasons: &[String]) -> axum::response::Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(serde_json::json!({
            "error": StatusCode::UNPROCESSABLE_ENTITY
                .canonical_reason()
                .unwrap_or("error"),
            "message": format!("Order cannot move to {phase} yet"),
            "blocking_reasons": reasons,
        })),
    )
        .into_response()
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

async fn load_order_process_readiness(
    state: &AppState,
    order_id: Uuid,
    patient_id: Uuid,
) -> Result<OrderProcessReadiness, axum::response::Response> {
    let gate_row = sqlx::query(
        r#"SELECT billing_release_status,
                  billing_release_note,
                  billing_released_by,
                  billing_released_at,
                  package_coverage_status,
                  package_coverage_note,
                  package_coverage_decided_by,
                  package_coverage_decided_at,
                  signed_patient,
                  signed_agency
           FROM orders
           WHERE id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load order process gates");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order process gates",
        )
    })?;

    let Some(gate_row) = gate_row else {
        return Err(err(StatusCode::NOT_FOUND, "Order not found"));
    };

    let finance_row = sqlx::query(
        r#"SELECT COUNT(*) FILTER (
                    WHERE status = 'overdue'
                      AND total_gross > COALESCE(paid_amount, 0)
                ) AS overdue_invoice_count,
                  COALESCE(
                    SUM(
                        CASE
                            WHEN status NOT IN ('paid', 'cancelled')
                            THEN GREATEST(total_gross - COALESCE(paid_amount, 0), 0)
                            ELSE 0
                        END
                    ),
                    0
                ) AS outstanding_balance,
                  COUNT(*) FILTER (
                    WHERE order_id = $2
                      AND invoice_type = 'advance'
                      AND status <> 'cancelled'
                ) AS advance_invoice_count,
                  COUNT(*) FILTER (
                    WHERE order_id = $2
                      AND invoice_type = 'advance'
                      AND status = 'paid'
                ) AS paid_advance_invoice_count
           FROM invoices
           WHERE patient_id = $1"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, order_id = %order_id, "load order finance gates");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order process gates",
        )
    })?;

    let billing_release_status: String = gate_row
        .try_get("billing_release_status")
        .unwrap_or_else(|_| "pending".to_string());
    let billing_release_note: Option<String> =
        gate_row.try_get("billing_release_note").unwrap_or_default();
    let billing_released_by: Option<Uuid> =
        gate_row.try_get("billing_released_by").unwrap_or_default();
    let billing_released_at: Option<chrono::DateTime<chrono::Utc>> =
        gate_row.try_get("billing_released_at").unwrap_or_default();
    let package_coverage_status: String = gate_row
        .try_get("package_coverage_status")
        .unwrap_or_else(|_| "unknown".to_string());
    let package_coverage_note: Option<String> = gate_row
        .try_get("package_coverage_note")
        .unwrap_or_default();
    let package_coverage_decided_by: Option<Uuid> = gate_row
        .try_get("package_coverage_decided_by")
        .unwrap_or_default();
    let package_coverage_decided_at: Option<chrono::DateTime<chrono::Utc>> = gate_row
        .try_get("package_coverage_decided_at")
        .unwrap_or_default();
    let signed_patient: bool = gate_row.try_get("signed_patient").unwrap_or(false);
    let signed_agency: bool = gate_row.try_get("signed_agency").unwrap_or(false);
    let overdue_invoice_count: i64 = finance_row
        .try_get("overdue_invoice_count")
        .unwrap_or_default();
    let outstanding_balance: rust_decimal::Decimal = finance_row
        .try_get("outstanding_balance")
        .unwrap_or(rust_decimal::Decimal::ZERO);
    let advance_invoice_count: i64 = finance_row
        .try_get("advance_invoice_count")
        .unwrap_or_default();
    let paid_advance_invoice_count: i64 = finance_row
        .try_get("paid_advance_invoice_count")
        .unwrap_or_default();

    let debt_management = crate::routes::debt_management::load_order_debt_management_state(
        state,
        order_id,
        overdue_invoice_count,
        outstanding_balance,
    )
    .await?;
    let debt_hold = debt_management.blocking;
    let financial_gate_ready =
        billing_release_status == "granted" || package_coverage_status == "covered";
    let contract_gate_ready =
        package_coverage_status == "covered" || (signed_patient && signed_agency);
    let payment_gate_required = package_coverage_status != "covered" && advance_invoice_count > 0;
    let payment_gate_ready =
        !payment_gate_required || paid_advance_invoice_count == advance_invoice_count;

    let mut blocking_reasons = Vec::new();
    if let Some(reason) = debt_management.blocking_reason.clone() {
        blocking_reasons.push(reason);
    }
    if !financial_gate_ready {
        blocking_reasons.push(
            "Billing release is not granted and package coverage is not confirmed".to_string(),
        );
    }
    if !contract_gate_ready {
        blocking_reasons.push("Order signatures are still incomplete".to_string());
    }
    if payment_gate_required && !payment_gate_ready {
        blocking_reasons.push("Advance invoice exists but payment is still missing".to_string());
    }

    let execution_ready = blocking_reasons.is_empty();

    Ok(OrderProcessReadiness {
        execution_ready,
        blocking_reasons: blocking_reasons.clone(),
        payload: serde_json::json!({
            "execution_ready": execution_ready,
            "debt_hold": debt_hold,
            "overdue_invoice_count": overdue_invoice_count,
            "outstanding_balance": outstanding_balance.round_dp(2).normalize().to_string(),
            "debt_management": debt_management.payload,
            "billing_release_status": billing_release_status,
            "billing_release_note": billing_release_note,
            "billing_released_by": billing_released_by,
            "billing_released_at": billing_released_at.map(|value| value.to_rfc3339()),
            "package_coverage_status": package_coverage_status,
            "package_coverage_note": package_coverage_note,
            "package_coverage_decided_by": package_coverage_decided_by,
            "package_coverage_decided_at": package_coverage_decided_at.map(|value| value.to_rfc3339()),
            "financial_gate_ready": financial_gate_ready,
            "contract_gate_ready": contract_gate_ready,
            "signed_patient": signed_patient,
            "signed_agency": signed_agency,
            "payment_gate_required": payment_gate_required,
            "payment_gate_ready": payment_gate_ready,
            "advance_invoice_count": advance_invoice_count,
            "paid_advance_invoice_count": paid_advance_invoice_count,
            "blocking_reasons": blocking_reasons,
        }),
    })
}

async fn ensure_order_planning_preparation_state(
    state: &AppState,
    order_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO order_planning_preparation (order_id)
           VALUES ($1)
           ON CONFLICT (order_id) DO NOTHING"#,
    )
    .bind(order_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "ensure order planning state");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order planning state",
        )
    })?;

    Ok(())
}

async fn load_order_planning_readiness(
    state: &AppState,
    order_id: Uuid,
) -> Result<OrderPlanningReadiness, axum::response::Response> {
    ensure_order_planning_preparation_state(state, order_id).await?;

    let planning_row = sqlx::query(
        r#"SELECT opp.treatment_plan_status,
                  opp.treatment_plan_note,
                  opp.non_medical_required,
                  opp.interpreter_required,
                  opp.preparation_documents_status,
                  opp.interpreter_briefing_status,
                  opp.plan_finalized_at,
                  opp.plan_finalized_by,
                  finalized_by_user.name AS plan_finalized_by_name,
                  opp.preparation_documents_sent_at,
                  opp.preparation_documents_sent_by,
                  prep_docs_user.name AS preparation_documents_sent_by_name,
                  opp.interpreter_briefed_at,
                  opp.interpreter_briefed_by,
                  briefed_by_user.name AS interpreter_briefed_by_name
           FROM order_planning_preparation opp
           LEFT JOIN users finalized_by_user ON finalized_by_user.id = opp.plan_finalized_by
           LEFT JOIN users prep_docs_user ON prep_docs_user.id = opp.preparation_documents_sent_by
           LEFT JOIN users briefed_by_user ON briefed_by_user.id = opp.interpreter_briefed_by
           WHERE opp.order_id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load order planning state");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order planning state",
        )
    })?;

    let Some(planning_row) = planning_row else {
        return Err(err(StatusCode::NOT_FOUND, "Order not found"));
    };

    let appointment_counts = sqlx::query(
        r#"SELECT
                COUNT(*) FILTER (
                    WHERE appointment_type = 'medical'
                ) AS medical_total,
                COUNT(*) FILTER (
                    WHERE appointment_type = 'medical'
                      AND status IN ('confirmed', 'in_progress', 'completed')
                ) AS medical_confirmed,
                COUNT(*) FILTER (
                    WHERE appointment_type = 'non_medical'
                ) AS non_medical_total,
                COUNT(*) FILTER (
                    WHERE appointment_type = 'non_medical'
                      AND status IN ('confirmed', 'in_progress', 'completed')
                ) AS non_medical_confirmed,
                COUNT(*) FILTER (
                    WHERE interpreter_id IS NOT NULL
                      AND status <> 'cancelled'
                ) AS interpreter_assigned,
                COUNT(*) FILTER (
                    WHERE interpreter_id IS NOT NULL
                      AND interpreter_response = 'accepted'
                      AND status <> 'cancelled'
                ) AS interpreter_confirmed
           FROM appointments
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load order planning appointment counts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order planning state",
        )
    })?;

    let treatment_plan_status: String = planning_row
        .try_get("treatment_plan_status")
        .unwrap_or_else(|_| "draft".to_string());
    let treatment_plan_note: Option<String> = planning_row
        .try_get("treatment_plan_note")
        .unwrap_or_default();
    let non_medical_required: bool = planning_row
        .try_get("non_medical_required")
        .unwrap_or(false);
    let interpreter_required: bool = planning_row
        .try_get("interpreter_required")
        .unwrap_or(false);
    let preparation_documents_status: String = planning_row
        .try_get("preparation_documents_status")
        .unwrap_or_else(|_| "pending".to_string());
    let interpreter_briefing_status: String = planning_row
        .try_get("interpreter_briefing_status")
        .unwrap_or_else(|_| "not_needed".to_string());
    let plan_finalized_at: Option<chrono::DateTime<chrono::Utc>> = planning_row
        .try_get("plan_finalized_at")
        .unwrap_or_default();
    let plan_finalized_by: Option<Uuid> = planning_row
        .try_get("plan_finalized_by")
        .unwrap_or_default();
    let plan_finalized_by_name: Option<String> = planning_row
        .try_get("plan_finalized_by_name")
        .unwrap_or_default();
    let preparation_documents_sent_at: Option<chrono::DateTime<chrono::Utc>> = planning_row
        .try_get("preparation_documents_sent_at")
        .unwrap_or_default();
    let preparation_documents_sent_by: Option<Uuid> = planning_row
        .try_get("preparation_documents_sent_by")
        .unwrap_or_default();
    let preparation_documents_sent_by_name: Option<String> = planning_row
        .try_get("preparation_documents_sent_by_name")
        .unwrap_or_default();
    let interpreter_briefed_at: Option<chrono::DateTime<chrono::Utc>> = planning_row
        .try_get("interpreter_briefed_at")
        .unwrap_or_default();
    let interpreter_briefed_by: Option<Uuid> = planning_row
        .try_get("interpreter_briefed_by")
        .unwrap_or_default();
    let interpreter_briefed_by_name: Option<String> = planning_row
        .try_get("interpreter_briefed_by_name")
        .unwrap_or_default();

    let medical_total: i64 = appointment_counts
        .try_get("medical_total")
        .unwrap_or_default();
    let medical_confirmed: i64 = appointment_counts
        .try_get("medical_confirmed")
        .unwrap_or_default();
    let non_medical_total: i64 = appointment_counts
        .try_get("non_medical_total")
        .unwrap_or_default();
    let non_medical_confirmed: i64 = appointment_counts
        .try_get("non_medical_confirmed")
        .unwrap_or_default();
    let interpreter_assigned: i64 = appointment_counts
        .try_get("interpreter_assigned")
        .unwrap_or_default();
    let interpreter_confirmed: i64 = appointment_counts
        .try_get("interpreter_confirmed")
        .unwrap_or_default();

    let treatment_plan_ready = treatment_plan_status == "finalized";
    let medical_bookings_ready = medical_confirmed > 0;
    let non_medical_bookings_ready = !non_medical_required || non_medical_confirmed > 0;
    let interpreter_assignment_ready = !interpreter_required || interpreter_assigned > 0;
    let interpreter_confirmation_ready = !interpreter_required || interpreter_confirmed > 0;
    let interpreter_briefing_ready =
        !interpreter_required || interpreter_briefing_status == "completed";
    let preparation_documents_ready = preparation_documents_status != "pending";

    let mut blocking_reasons = Vec::new();
    if !treatment_plan_ready {
        blocking_reasons.push("Treatment plan must be finalized before execution".to_string());
    }
    if !medical_bookings_ready {
        blocking_reasons.push("At least one confirmed medical appointment is required".to_string());
    }
    if !non_medical_bookings_ready {
        blocking_reasons
            .push("Required non-medical services still need a confirmed booking".to_string());
    }
    if !interpreter_assignment_ready {
        blocking_reasons.push("Interpreter is required but not assigned yet".to_string());
    }
    if !interpreter_confirmation_ready {
        blocking_reasons.push("Assigned interpreter has not confirmed yet".to_string());
    }
    if !interpreter_briefing_ready {
        blocking_reasons.push("Interpreter briefing is still pending".to_string());
    }
    if !preparation_documents_ready {
        blocking_reasons.push("Preparation documents still need to be sent".to_string());
    }

    let planning_ready = blocking_reasons.is_empty();

    Ok(OrderPlanningReadiness {
        planning_ready,
        blocking_reasons: blocking_reasons.clone(),
        payload: serde_json::json!({
            "planning_ready": planning_ready,
            "treatment_plan_status": treatment_plan_status,
            "treatment_plan_note": treatment_plan_note,
            "non_medical_required": non_medical_required,
            "interpreter_required": interpreter_required,
            "preparation_documents_status": preparation_documents_status,
            "interpreter_briefing_status": interpreter_briefing_status,
            "treatment_plan_ready": treatment_plan_ready,
            "medical_bookings_ready": medical_bookings_ready,
            "medical_total": medical_total,
            "medical_confirmed": medical_confirmed,
            "non_medical_bookings_ready": non_medical_bookings_ready,
            "non_medical_total": non_medical_total,
            "non_medical_confirmed": non_medical_confirmed,
            "interpreter_assignment_ready": interpreter_assignment_ready,
            "interpreter_confirmation_ready": interpreter_confirmation_ready,
            "interpreter_assigned": interpreter_assigned,
            "interpreter_confirmed": interpreter_confirmed,
            "interpreter_briefing_ready": interpreter_briefing_ready,
            "preparation_documents_ready": preparation_documents_ready,
            "plan_finalized_at": plan_finalized_at.map(|value| value.to_rfc3339()),
            "plan_finalized_by": plan_finalized_by,
            "plan_finalized_by_name": plan_finalized_by_name,
            "preparation_documents_sent_at": preparation_documents_sent_at.map(|value| value.to_rfc3339()),
            "preparation_documents_sent_by": preparation_documents_sent_by,
            "preparation_documents_sent_by_name": preparation_documents_sent_by_name,
            "interpreter_briefed_at": interpreter_briefed_at.map(|value| value.to_rfc3339()),
            "interpreter_briefed_by": interpreter_briefed_by,
            "interpreter_briefed_by_name": interpreter_briefed_by_name,
            "blocking_reasons": blocking_reasons,
        }),
    })
}

async fn ensure_order_execution_flow_state(
    state: &AppState,
    order_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO order_execution_flows (order_id)
           VALUES ($1)
           ON CONFLICT (order_id) DO NOTHING"#,
    )
    .bind(order_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "ensure order execution flow");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order execution flow",
        )
    })?;

    Ok(())
}

async fn ensure_order_followup_flow_state(
    state: &AppState,
    order_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO order_followup_flows (order_id)
           VALUES ($1)
           ON CONFLICT (order_id) DO NOTHING"#,
    )
    .bind(order_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "ensure order follow-up flow");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order follow-up flow",
        )
    })?;

    Ok(())
}

async fn load_order_execution_readiness(
    state: &AppState,
    order_id: Uuid,
) -> Result<OrderExecutionReadiness, axum::response::Response> {
    ensure_order_execution_flow_state(state, order_id).await?;

    let execution_row = sqlx::query(
        r#"SELECT oef.arrival_status,
                  oef.medical_execution_status,
                  oef.non_medical_execution_status,
                  oef.interpreter_service_status,
                  oef.issue_status,
                  oef.deviation_note,
                  oef.execution_summary,
                  oef.arrival_recorded_at,
                  oef.medical_completed_at,
                  oef.non_medical_completed_at,
                  oef.interpreter_completed_at,
                  oef.issues_resolved_at,
                  COALESCE(opp.non_medical_required, false) AS non_medical_required,
                  COALESCE(opp.interpreter_required, false) AS interpreter_required
           FROM order_execution_flows oef
           LEFT JOIN order_planning_preparation opp ON opp.order_id = oef.order_id
           WHERE oef.order_id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load order execution flow");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order execution flow",
        )
    })?;

    let Some(execution_row) = execution_row else {
        return Err(err(StatusCode::NOT_FOUND, "Order not found"));
    };

    let evidence_row = sqlx::query(
        r#"SELECT
                COUNT(*) FILTER (
                    WHERE appointment_type = 'medical'
                      AND status = 'completed'
                ) AS medical_completed,
                COUNT(*) FILTER (
                    WHERE appointment_type = 'non_medical'
                      AND status = 'completed'
                ) AS non_medical_completed,
                COUNT(*) FILTER (
                    WHERE interpreter_id IS NOT NULL
                      AND status = 'completed'
                ) AS interpreter_completed,
                COUNT(*) FILTER (
                    WHERE interpreter_id IS NOT NULL
                      AND interpreter_response = 'accepted'
                      AND status = 'completed'
                ) AS interpreter_confirmed_completed
           FROM appointments
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load execution evidence");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order execution flow",
        )
    })?;

    let delivered_leistungen: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM order_leistungen
           WHERE order_id = $1
             AND status IN ('delivered', 'approved', 'invoiced')"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load delivered leistungen");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order execution flow",
        )
    })?;

    let concierge_completed: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM concierge_services cs
           JOIN appointments a ON a.id = cs.appointment_id
           WHERE a.order_id = $1
             AND cs.status = 'completed'"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_default();

    let approved_interpreter_reports: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM interpreter_reports ir
           JOIN appointments a ON a.id = ir.appointment_id
           WHERE a.order_id = $1
             AND ir.approval_status = 'approved'"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_default();

    let open_execution_checklist_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM workflow_checklist_items
           WHERE order_id = $1
             AND checklist_key = 'order_execution'
             AND NOT is_completed"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_default();

    let execution_documents: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM documents
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_default();

    let arrival_status: String = execution_row
        .try_get("arrival_status")
        .unwrap_or_else(|_| "pending".to_string());
    let medical_execution_status: String = execution_row
        .try_get("medical_execution_status")
        .unwrap_or_else(|_| "pending".to_string());
    let non_medical_execution_status: String = execution_row
        .try_get("non_medical_execution_status")
        .unwrap_or_else(|_| "not_required".to_string());
    let interpreter_service_status: String = execution_row
        .try_get("interpreter_service_status")
        .unwrap_or_else(|_| "not_required".to_string());
    let issue_status: String = execution_row
        .try_get("issue_status")
        .unwrap_or_else(|_| "pending".to_string());
    let deviation_note: Option<String> =
        execution_row.try_get("deviation_note").unwrap_or_default();
    let execution_summary: Option<String> = execution_row
        .try_get("execution_summary")
        .unwrap_or_default();
    let arrival_recorded_at: Option<chrono::DateTime<chrono::Utc>> = execution_row
        .try_get("arrival_recorded_at")
        .unwrap_or_default();
    let medical_completed_at: Option<chrono::DateTime<chrono::Utc>> = execution_row
        .try_get("medical_completed_at")
        .unwrap_or_default();
    let non_medical_completed_at: Option<chrono::DateTime<chrono::Utc>> = execution_row
        .try_get("non_medical_completed_at")
        .unwrap_or_default();
    let interpreter_completed_at: Option<chrono::DateTime<chrono::Utc>> = execution_row
        .try_get("interpreter_completed_at")
        .unwrap_or_default();
    let issues_resolved_at: Option<chrono::DateTime<chrono::Utc>> = execution_row
        .try_get("issues_resolved_at")
        .unwrap_or_default();
    let non_medical_required: bool = execution_row
        .try_get("non_medical_required")
        .unwrap_or(false);
    let interpreter_required: bool = execution_row
        .try_get("interpreter_required")
        .unwrap_or(false);

    let medical_completed: i64 = evidence_row
        .try_get("medical_completed")
        .unwrap_or_default();
    let non_medical_completed: i64 = evidence_row
        .try_get("non_medical_completed")
        .unwrap_or_default();
    let interpreter_completed: i64 = evidence_row
        .try_get("interpreter_completed")
        .unwrap_or_default();
    let interpreter_confirmed_completed: i64 = evidence_row
        .try_get("interpreter_confirmed_completed")
        .unwrap_or_default();

    let arrival_ready = arrival_status != "pending";
    let medical_execution_ready = medical_execution_status == "not_required"
        || (medical_execution_status == "completed"
            && (medical_completed > 0 || delivered_leistungen > 0));
    let non_medical_execution_ready = !non_medical_required
        || (non_medical_execution_status == "completed"
            && (non_medical_completed > 0 || concierge_completed > 0));
    let interpreter_execution_ready = !interpreter_required
        || (interpreter_service_status == "completed"
            && (approved_interpreter_reports > 0 || interpreter_confirmed_completed > 0));
    let issue_ready = matches!(issue_status.as_str(), "resolved" | "not_required");
    let execution_checklist_ready = open_execution_checklist_count == 0;

    let mut blocking_reasons = Vec::new();
    if !arrival_ready {
        blocking_reasons.push("Patient arrival or execution start is not recorded yet".to_string());
    }
    if !medical_execution_ready {
        blocking_reasons.push(
            "Medical execution must be completed and backed by delivered appointments or services"
                .to_string(),
        );
    }
    if !non_medical_execution_ready {
        blocking_reasons
            .push("Required non-medical services still need execution confirmation".to_string());
    }
    if !interpreter_execution_ready {
        blocking_reasons.push(
            "Interpreter-supported execution still needs completion or report confirmation"
                .to_string(),
        );
    }
    if !issue_ready {
        blocking_reasons.push(
            "Execution deviations or incidents must be resolved or marked as not required"
                .to_string(),
        );
    }
    if !execution_checklist_ready {
        blocking_reasons.push(format!(
            "{open_execution_checklist_count} execution checklist item(s) remain open"
        ));
    }

    let closure_ready = blocking_reasons.is_empty();

    Ok(OrderExecutionReadiness {
        closure_ready,
        blocking_reasons: blocking_reasons.clone(),
        payload: serde_json::json!({
            "closure_ready": closure_ready,
            "arrival_status": arrival_status,
            "medical_execution_status": medical_execution_status,
            "non_medical_execution_status": non_medical_execution_status,
            "interpreter_service_status": interpreter_service_status,
            "issue_status": issue_status,
            "deviation_note": deviation_note,
            "execution_summary": execution_summary,
            "non_medical_required": non_medical_required,
            "interpreter_required": interpreter_required,
            "arrival_ready": arrival_ready,
            "medical_execution_ready": medical_execution_ready,
            "non_medical_execution_ready": non_medical_execution_ready,
            "interpreter_execution_ready": interpreter_execution_ready,
            "issue_ready": issue_ready,
            "execution_checklist_ready": execution_checklist_ready,
            "medical_completed": medical_completed,
            "non_medical_completed": non_medical_completed,
            "interpreter_completed": interpreter_completed,
            "interpreter_confirmed_completed": interpreter_confirmed_completed,
            "approved_interpreter_reports": approved_interpreter_reports,
            "delivered_leistungen": delivered_leistungen,
            "concierge_completed": concierge_completed,
            "execution_documents": execution_documents,
            "open_execution_checklist_count": open_execution_checklist_count,
            "arrival_recorded_at": arrival_recorded_at.map(|value| value.to_rfc3339()),
            "medical_completed_at": medical_completed_at.map(|value| value.to_rfc3339()),
            "non_medical_completed_at": non_medical_completed_at.map(|value| value.to_rfc3339()),
            "interpreter_completed_at": interpreter_completed_at.map(|value| value.to_rfc3339()),
            "issues_resolved_at": issues_resolved_at.map(|value| value.to_rfc3339()),
            "blocking_reasons": blocking_reasons,
        }),
    })
}

async fn load_order_followup_readiness(
    state: &AppState,
    order_id: Uuid,
) -> Result<OrderFollowupReadiness, axum::response::Response> {
    ensure_order_followup_flow_state(state, order_id).await?;

    let followup_row = sqlx::query(
        r#"SELECT off.doctor_followup_status,
                  off.followup_1w_status,
                  off.followup_1m_status,
                  off.followup_6m_status,
                  off.package_end_date,
                  off.package_end_status,
                  off.results_handoff_status,
                  off.followup_summary,
                  o.patient_id
           FROM order_followup_flows off
           JOIN orders o ON o.id = off.order_id
           WHERE off.order_id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load order follow-up flow");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order follow-up flow",
        )
    })?;

    let Some(followup_row) = followup_row else {
        return Err(err(StatusCode::NOT_FOUND, "Order not found"));
    };

    let patient_id: Uuid = followup_row.try_get("patient_id").unwrap_or_default();

    let activity_row = sqlx::query(
        r#"SELECT
                COUNT(*) FILTER (
                    WHERE checklist_phase = 'followup'
                      AND status <> 'cancelled'
                ) AS followup_appointments_total,
                COUNT(*) FILTER (
                    WHERE checklist_phase = 'followup'
                      AND title ILIKE 'Doctor-directed:%'
                      AND status <> 'cancelled'
                ) AS doctor_followup_visits,
                COUNT(*) FILTER (
                    WHERE checklist_phase = 'followup'
                      AND title ILIKE '1-week follow-up check-in%'
                      AND status <> 'cancelled'
                ) AS followup_1w_visits,
                COUNT(*) FILTER (
                    WHERE checklist_phase = 'followup'
                      AND title ILIKE '1-month follow-up check-in%'
                      AND status <> 'cancelled'
                ) AS followup_1m_visits,
                COUNT(*) FILTER (
                    WHERE checklist_phase = 'followup'
                      AND title ILIKE '6-month follow-up check-in%'
                      AND status <> 'cancelled'
                ) AS followup_6m_visits
           FROM appointments
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load follow-up appointment activity");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order follow-up flow",
        )
    })?;

    let reminder_row = sqlx::query(
        r#"SELECT
                COUNT(*) FILTER (WHERE r.title = '1-week follow-up check-in' AND NOT r.is_completed) AS followup_1w_reminders,
                COUNT(*) FILTER (WHERE r.title = '1-month follow-up check-in' AND NOT r.is_completed) AS followup_1m_reminders,
                COUNT(*) FILTER (WHERE r.title = '6-month follow-up check-in' AND NOT r.is_completed) AS followup_6m_reminders,
                COUNT(*) FILTER (WHERE r.title ILIKE 'Package-end:%' AND NOT r.is_completed) AS package_end_reminders
           FROM reminders r
           JOIN appointments a ON a.id = r.appointment_id
           WHERE a.order_id = $1"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load follow-up reminder activity");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order follow-up flow",
        )
    })?;

    let task_row = sqlx::query(
        r#"SELECT
                COUNT(*) FILTER (
                    WHERE title ILIKE 'Doctor-directed:%'
                      AND status <> 'cancelled'
                ) AS doctor_followup_tasks,
                COUNT(*) FILTER (
                    WHERE title ILIKE 'Package-end:%'
                      AND status <> 'cancelled'
                ) AS package_end_tasks
           FROM tasks
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load follow-up task activity");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order follow-up flow",
        )
    })?;

    let results_portal_shares: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM document_shares ds
           JOIN documents d ON d.id = ds.document_id
           JOIN patient_assignments pa ON pa.user_id = ds.shared_with_user_id
           WHERE d.order_id = $1
             AND pa.patient_id = $2
             AND pa.revoked_at IS NULL
             AND ds.revoked_at IS NULL
             AND ds.channel = 'patient_portal'"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_default();

    let closure_anchor_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        r#"SELECT created_at
           FROM workflow_lifecycle_events
           WHERE entity_type = 'order'
             AND entity_id = $1
             AND to_stage = 'closure'
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or_default();

    let suggested_package_end_date: Option<chrono::NaiveDate> = sqlx::query_scalar(
        r#"SELECT COALESCE(contract.valid_to, latest.valid_to)
           FROM orders o
           LEFT JOIN framework_contracts contract ON contract.id = o.contract_id
           LEFT JOIN LATERAL (
               SELECT fc.valid_to
               FROM framework_contracts fc
               WHERE fc.patient_id = o.patient_id
                 AND fc.status = 'signed'
               ORDER BY COALESCE(fc.valid_to, fc.valid_from) DESC NULLS LAST
               LIMIT 1
           ) latest ON true
           WHERE o.id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or_default()
    .flatten();

    let doctor_followup_status: String = followup_row
        .try_get("doctor_followup_status")
        .unwrap_or_else(|_| "not_required".to_string());
    let followup_1w_status: String = followup_row
        .try_get("followup_1w_status")
        .unwrap_or_else(|_| "pending".to_string());
    let followup_1m_status: String = followup_row
        .try_get("followup_1m_status")
        .unwrap_or_else(|_| "pending".to_string());
    let followup_6m_status: String = followup_row
        .try_get("followup_6m_status")
        .unwrap_or_else(|_| "pending".to_string());
    let package_end_date: Option<chrono::NaiveDate> =
        followup_row.try_get("package_end_date").unwrap_or_default();
    let package_end_status: String = followup_row
        .try_get("package_end_status")
        .unwrap_or_else(|_| "not_required".to_string());
    let results_handoff_status: String = followup_row
        .try_get("results_handoff_status")
        .unwrap_or_else(|_| "pending".to_string());
    let followup_summary: Option<String> =
        followup_row.try_get("followup_summary").unwrap_or_default();

    let followup_appointments_total: i64 = activity_row
        .try_get("followup_appointments_total")
        .unwrap_or_default();
    let doctor_followup_visits: i64 = activity_row
        .try_get("doctor_followup_visits")
        .unwrap_or_default();
    let followup_1w_visits: i64 = activity_row
        .try_get("followup_1w_visits")
        .unwrap_or_default();
    let followup_1m_visits: i64 = activity_row
        .try_get("followup_1m_visits")
        .unwrap_or_default();
    let followup_6m_visits: i64 = activity_row
        .try_get("followup_6m_visits")
        .unwrap_or_default();

    let followup_1w_reminders: i64 = reminder_row
        .try_get("followup_1w_reminders")
        .unwrap_or_default();
    let followup_1m_reminders: i64 = reminder_row
        .try_get("followup_1m_reminders")
        .unwrap_or_default();
    let followup_6m_reminders: i64 = reminder_row
        .try_get("followup_6m_reminders")
        .unwrap_or_default();
    let package_end_reminders: i64 = reminder_row
        .try_get("package_end_reminders")
        .unwrap_or_default();

    let doctor_followup_tasks: i64 = task_row
        .try_get("doctor_followup_tasks")
        .unwrap_or_default();
    let package_end_tasks: i64 = task_row.try_get("package_end_tasks").unwrap_or_default();

    let doctor_followup_ready = match doctor_followup_status.as_str() {
        "not_required" | "completed" => true,
        "scheduled" => doctor_followup_visits + doctor_followup_tasks > 0,
        _ => false,
    };
    let followup_1w_ready = match followup_1w_status.as_str() {
        "not_required" | "completed" => true,
        "scheduled" => followup_1w_visits + followup_1w_reminders > 0,
        _ => false,
    };
    let followup_1m_ready = match followup_1m_status.as_str() {
        "not_required" | "completed" => true,
        "scheduled" => followup_1m_visits + followup_1m_reminders > 0,
        _ => false,
    };
    let followup_6m_ready = match followup_6m_status.as_str() {
        "not_required" | "completed" => true,
        "scheduled" => followup_6m_visits + followup_6m_reminders > 0,
        _ => false,
    };

    let effective_package_end_date = package_end_date.or(suggested_package_end_date);
    let package_end_required = effective_package_end_date.is_some();
    let package_end_ready = if !package_end_required {
        true
    } else {
        match package_end_status.as_str() {
            "completed" => true,
            "scheduled" => package_end_tasks + package_end_reminders > 0,
            _ => false,
        }
    };
    let results_handoff_ready = matches!(
        results_handoff_status.as_str(),
        "completed" | "not_required"
    );
    let followup_activity_ready = followup_appointments_total > 0
        || doctor_followup_tasks > 0
        || package_end_tasks > 0
        || followup_1w_reminders > 0
        || followup_1m_reminders > 0
        || followup_6m_reminders > 0
        || package_end_reminders > 0;

    let recommended_followup_1w_at =
        closure_anchor_at.map(|value| value + chrono::Duration::days(7));
    let recommended_followup_1m_at =
        closure_anchor_at.map(|value| value + chrono::Duration::days(30));
    let recommended_followup_6m_at =
        closure_anchor_at.map(|value| value + chrono::Duration::days(182));
    let recommended_package_end_followup_at = effective_package_end_date
        .and_then(|value| value.checked_sub_signed(chrono::Duration::days(30)));

    let mut blocking_reasons = Vec::new();
    if !results_handoff_ready {
        blocking_reasons.push(
            "Results, Arztbrief or final patient handoff still need to be released".to_string(),
        );
    }
    if !doctor_followup_ready {
        blocking_reasons
            .push("Doctor-directed follow-up is required but not scheduled yet".to_string());
    }
    if !followup_1w_ready {
        blocking_reasons.push("1-week follow-up is not scheduled yet".to_string());
    }
    if !followup_1m_ready {
        blocking_reasons.push("1-month follow-up is not scheduled yet".to_string());
    }
    if !followup_6m_ready {
        blocking_reasons.push("6-month follow-up is not scheduled yet".to_string());
    }
    if !package_end_ready {
        blocking_reasons
            .push("Package-end follow-up is required but not scheduled yet".to_string());
    }
    if !followup_activity_ready {
        blocking_reasons
            .push("No follow-up reminder, task or appointment has been launched yet".to_string());
    }

    let followup_ready = blocking_reasons.is_empty();

    Ok(OrderFollowupReadiness {
        followup_ready,
        blocking_reasons: blocking_reasons.clone(),
        payload: serde_json::json!({
            "followup_ready": followup_ready,
            "doctor_followup_status": doctor_followup_status,
            "followup_1w_status": followup_1w_status,
            "followup_1m_status": followup_1m_status,
            "followup_6m_status": followup_6m_status,
            "package_end_date": package_end_date.map(|value| value.to_string()),
            "suggested_package_end_date": suggested_package_end_date.map(|value| value.to_string()),
            "package_end_status": package_end_status,
            "results_handoff_status": results_handoff_status,
            "followup_summary": followup_summary,
            "doctor_followup_ready": doctor_followup_ready,
            "followup_1w_ready": followup_1w_ready,
            "followup_1m_ready": followup_1m_ready,
            "followup_6m_ready": followup_6m_ready,
            "package_end_required": package_end_required,
            "package_end_ready": package_end_ready,
            "results_handoff_ready": results_handoff_ready,
            "followup_activity_ready": followup_activity_ready,
            "closure_anchor_at": closure_anchor_at.map(|value| value.to_rfc3339()),
            "recommended_followup_1w_at": recommended_followup_1w_at.map(|value| value.to_rfc3339()),
            "recommended_followup_1m_at": recommended_followup_1m_at.map(|value| value.to_rfc3339()),
            "recommended_followup_6m_at": recommended_followup_6m_at.map(|value| value.to_rfc3339()),
            "recommended_package_end_followup_at": recommended_package_end_followup_at.map(|value| value.to_string()),
            "followup_appointments_total": followup_appointments_total,
            "doctor_followup_visits": doctor_followup_visits,
            "doctor_followup_tasks": doctor_followup_tasks,
            "followup_1w_visits": followup_1w_visits,
            "followup_1m_visits": followup_1m_visits,
            "followup_6m_visits": followup_6m_visits,
            "followup_1w_reminders": followup_1w_reminders,
            "followup_1m_reminders": followup_1m_reminders,
            "followup_6m_reminders": followup_6m_reminders,
            "package_end_tasks": package_end_tasks,
            "package_end_reminders": package_end_reminders,
            "results_portal_shares": results_portal_shares,
            "blocking_reasons": blocking_reasons,
        }),
    })
}

fn patient_recheck_err(
    readiness: &crate::routes::patients::PatientRecheckReadiness,
) -> axum::response::Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(serde_json::json!({
            "error": StatusCode::UNPROCESSABLE_ENTITY
                .canonical_reason()
                .unwrap_or("error"),
            "message": "Existing customer re-check is incomplete",
            "blocking_reasons": readiness.blocking_reasons,
            "recheck": readiness.payload,
        })),
    )
        .into_response()
}

async fn create_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateOrderRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match ensure_patient_access(&state, &auth, body.patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    if let Some(contract_id) = body.contract_id {
        let contract_patient_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
            "SELECT patient_id FROM framework_contracts WHERE id = $1",
        )
        .bind(contract_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(patient_id)) => patient_id,
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Framework contract not found",
                );
            }
            Err(e) => {
                tracing::error!(error = %e, contract_id = %contract_id, "validate contract");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };

        if contract_patient_id != body.patient_id {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Framework contract does not belong to patient",
            );
        }
    }

    let patient_recheck = match crate::routes::patients::load_patient_recheck_readiness(
        &state,
        body.patient_id,
    )
    .await
    {
        Ok(Some(readiness)) => readiness,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(resp) => return resp,
    };

    if !patient_recheck.can_create_order {
        state.audit_sender.try_send(audit::domain_event(
            "create_order_blocked_recheck",
            Some(auth.user_id),
            "patient",
            Some(body.patient_id),
            serde_json::json!({
                "blocking_reasons": patient_recheck.blocking_reasons.clone(),
                "recheck": patient_recheck.payload.clone(),
            }),
        ));
        return patient_recheck_err(&patient_recheck);
    }

    let seq: i64 = match sqlx::query_scalar!("SELECT nextval('order_number_seq') AS \"v!\"")
        .fetch_one(&state.db)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "seq");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let num = gen_order_number(seq);

    match sqlx::query!(
        "INSERT INTO orders (order_number, patient_id, contract_id, needs_description, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, order_number, created_at",
        num,
        body.patient_id,
        body.contract_id,
        body.needs_description,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            let order_number = r.order_number.clone();
            if let Err(resp) = ensure_order_planning_preparation_state(&state, r.id).await {
                return resp;
            }
            if let Err(resp) = ensure_order_execution_flow_state(&state, r.id).await {
                return resp;
            }
            if let Err(resp) = ensure_order_followup_flow_state(&state, r.id).await {
                return resp;
            }
            if let Err(resp) =
                crate::routes::debt_management::ensure_order_debt_management_state(&state, r.id)
                    .await
            {
                return resp;
            }
            if let Err(resp) = crate::routes::workflow_checklists::ensure_default_order_workflow(
                &state,
                r.id,
                Some(auth.user_id),
            )
            .await
            {
                return resp;
            }
            state.audit_sender.try_send(audit::domain_event(
                "create_order",
                Some(auth.user_id),
                "order",
                Some(r.id),
                serde_json::json!({
                    "order_number": order_number.clone(),
                    "patient_id": body.patient_id,
                }),
            ));
            if let Err(resp) = crate::routes::workflow_lifecycle::record_event(
                &state,
                crate::routes::workflow_lifecycle::RecordEvent {
                    entity_type: "order",
                    entity_id: r.id,
                    from_stage: None,
                    to_stage: "discovery",
                    transition_kind: "created",
                    changed_by: Some(auth.user_id),
                    note: None,
                    metadata: serde_json::json!({
                        "order_number": order_number.clone(),
                        "patient_id": body.patient_id,
                    }),
                },
            )
            .await
            {
                return resp;
            }
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.created",
                r.id,
                serde_json::json!({
                    "order_number": order_number.clone(),
                    "patient_id": body.patient_id,
                    "phase": "discovery",
                }),
            )
            .await;
            tracing::info!(by = %auth.user_id, order = %order_number, "Order created");
            (StatusCode::CREATED, Json(serde_json::json!({"id": r.id, "order_number": order_number, "created_at": r.created_at}))).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "create order");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn get_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }

    let order = match sqlx::query!(
        r#"SELECT o.*, p.first_name, p.last_name, p.patient_id AS p_pid
           FROM orders o JOIN patients p ON p.id = o.patient_id WHERE o.id = $1"#,
        order_id
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(o)) => o,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, "get order");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    match can_access_order(&state, &auth, order.id, Some(order.patient_id)).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let leistungen = sqlx::query(
        r#"SELECT ol.id, ol.description, ol.quantity, ol.unit_price, ol.currency, ol.vat_rate,
                  ol.is_cost_passthrough, ol.status, ol.delivered_at, ol.approved_at, ol.notes,
                  ol.provider_id, ol.doctor_id, ol.source_interpreter_report_id,
                  ol.source_medical_appointment_id, ol.agency_service_id,
                  ol.external_document_id,
                  pr.name AS provider_name, d.name AS doctor_name,
                  provider_taxonomy.id AS provider_taxonomy_node_id,
                  provider_taxonomy.code AS provider_taxonomy_node_code,
                  provider_taxonomy.name_de AS provider_taxonomy_node_name_de,
                  provider_taxonomy.name_ru AS provider_taxonomy_node_name_ru,
                  catalog.service_key AS agency_service_key, catalog.service_name AS agency_service_name,
                  doc.auto_name AS external_document_auto_name,
                  doc.original_filename AS external_document_filename
           FROM order_leistungen ol
           LEFT JOIN providers pr ON pr.id = ol.provider_id
           LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
           LEFT JOIN LATERAL (
               SELECT ptn.id, ptn.code, ptn.name_de, ptn.name_ru
               FROM provider_taxonomy_assignments pta
               JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
               WHERE pta.provider_id = pr.id
               ORDER BY pta.is_primary DESC, ptn.sort_order, ptn.name_de
               LIMIT 1
           ) provider_taxonomy ON true
           LEFT JOIN agency_service_catalog catalog ON catalog.id = ol.agency_service_id
           LEFT JOIN documents doc ON doc.id = ol.external_document_id
           WHERE ol.order_id = $1
           ORDER BY ol.created_at"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut leist_json = Vec::new();
    for l in leistungen {
        leist_json.push(serde_json::json!({
            "id": l.try_get::<Uuid, _>("id").unwrap_or_default(),
            "description": l.try_get::<String, _>("description").unwrap_or_default(),
            "quantity": l.try_get::<rust_decimal::Decimal, _>("quantity").unwrap_or(rust_decimal::Decimal::ZERO),
            "unit_price": l.try_get::<rust_decimal::Decimal, _>("unit_price").unwrap_or(rust_decimal::Decimal::ZERO),
            "currency": l.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "vat_rate": l.try_get::<rust_decimal::Decimal, _>("vat_rate").unwrap_or(rust_decimal::Decimal::ZERO),
            "is_cost_passthrough": l.try_get::<bool, _>("is_cost_passthrough").unwrap_or(false),
            "status": l.try_get::<String, _>("status").unwrap_or_default(),
            "delivered_at": l.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("delivered_at").unwrap_or_default().map(|v| v.to_rfc3339()),
            "approved_at": l.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("approved_at").unwrap_or_default().map(|v| v.to_rfc3339()),
            "notes": l.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "provider_id": l.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
            "provider_name": l.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
            "provider_taxonomy_node_id": l.try_get::<Option<Uuid>, _>("provider_taxonomy_node_id").unwrap_or_default(),
            "provider_taxonomy_node_code": l.try_get::<Option<String>, _>("provider_taxonomy_node_code").unwrap_or_default(),
            "provider_taxonomy_node_name_de": l.try_get::<Option<String>, _>("provider_taxonomy_node_name_de").unwrap_or_default(),
            "provider_taxonomy_node_name_ru": l.try_get::<Option<String>, _>("provider_taxonomy_node_name_ru").unwrap_or_default(),
            "doctor_id": l.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
            "doctor_name": l.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
            "source_interpreter_report_id": l.try_get::<Option<Uuid>, _>("source_interpreter_report_id").unwrap_or_default(),
            "source_medical_appointment_id": l.try_get::<Option<Uuid>, _>("source_medical_appointment_id").unwrap_or_default(),
            "agency_service_id": l.try_get::<Option<Uuid>, _>("agency_service_id").unwrap_or_default(),
            "agency_service_key": l.try_get::<Option<String>, _>("agency_service_key").unwrap_or_default(),
            "agency_service_name": l.try_get::<Option<String>, _>("agency_service_name").unwrap_or_default(),
            "external_document_id": l.try_get::<Option<Uuid>, _>("external_document_id").unwrap_or_default(),
            "external_document_auto_name": l.try_get::<Option<String>, _>("external_document_auto_name").unwrap_or_default(),
            "external_document_filename": l.try_get::<Option<String>, _>("external_document_filename").unwrap_or_default(),
        }));
    }

    let external_invoice_rows = sqlx::query(
        r#"SELECT ei.id, ei.provider_id, ei.external_invoice_number, ei.invoice_date,
                  ei.due_date, ei.amount_net, ei.amount_vat, ei.amount_gross, ei.currency,
                  ei.status, ei.received_at, ei.paid_at, ei.notes, ei.created_at, ei.updated_at,
                  pr.name AS provider_name,
                  provider_taxonomy.id AS provider_taxonomy_node_id,
                  provider_taxonomy.code AS provider_taxonomy_node_code,
                  provider_taxonomy.name_de AS provider_taxonomy_node_name_de,
                  provider_taxonomy.name_ru AS provider_taxonomy_node_name_ru
           FROM external_invoices ei
           LEFT JOIN providers pr ON pr.id = ei.provider_id
           LEFT JOIN LATERAL (
               SELECT ptn.id, ptn.code, ptn.name_de, ptn.name_ru
               FROM provider_taxonomy_assignments pta
               JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
               WHERE pta.provider_id = pr.id
               ORDER BY pta.is_primary DESC, ptn.sort_order, ptn.name_de
               LIMIT 1
           ) provider_taxonomy ON true
           WHERE ei.order_id = $1
           ORDER BY ei.created_at DESC"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut external_invoices_json = Vec::new();
    for row in external_invoice_rows {
        external_invoices_json.push(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
            "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
            "provider_taxonomy_node_id": row.try_get::<Option<Uuid>, _>("provider_taxonomy_node_id").unwrap_or_default(),
            "provider_taxonomy_node_code": row.try_get::<Option<String>, _>("provider_taxonomy_node_code").unwrap_or_default(),
            "provider_taxonomy_node_name_de": row.try_get::<Option<String>, _>("provider_taxonomy_node_name_de").unwrap_or_default(),
            "provider_taxonomy_node_name_ru": row.try_get::<Option<String>, _>("provider_taxonomy_node_name_ru").unwrap_or_default(),
            "external_invoice_number": row.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
            "invoice_date": row.try_get::<Option<chrono::NaiveDate>, _>("invoice_date").unwrap_or_default().map(|value| value.to_string()),
            "due_date": row.try_get::<Option<chrono::NaiveDate>, _>("due_date").unwrap_or_default().map(|value| value.to_string()),
            "amount_net": row.try_get::<rust_decimal::Decimal, _>("amount_net").unwrap_or(rust_decimal::Decimal::ZERO),
            "amount_vat": row.try_get::<rust_decimal::Decimal, _>("amount_vat").unwrap_or(rust_decimal::Decimal::ZERO),
            "amount_gross": row.try_get::<rust_decimal::Decimal, _>("amount_gross").unwrap_or(rust_decimal::Decimal::ZERO),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "received_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("received_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "paid_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("paid_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").unwrap_or_else(|_| chrono::Utc::now()).to_rfc3339(),
            "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").unwrap_or_else(|_| chrono::Utc::now()).to_rfc3339(),
        }));
    }

    let process_gate_readiness =
        match load_order_process_readiness(&state, order_id, order.patient_id).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let process_gates = process_gate_readiness.payload.clone();
    let planning_preparation = match load_order_planning_readiness(&state, order_id).await {
        Ok(value) => value.payload,
        Err(resp) => return resp,
    };
    let execution_flow = match load_order_execution_readiness(&state, order_id).await {
        Ok(value) => value.payload,
        Err(resp) => return resp,
    };
    let followup_flow = match load_order_followup_readiness(&state, order_id).await {
        Ok(value) => value.payload,
        Err(resp) => return resp,
    };
    let lifecycle = match load_order_lifecycle(
        &state,
        order_id,
        &order.phase,
        order.created_at,
        &process_gate_readiness,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    Json(serde_json::json!({
        "id": order.id, "order_number": order.order_number,
        "patient_id": order.patient_id,
        "patient_name": format!("{} {}", order.first_name, order.last_name),
        "patient_pid": order.p_pid,
        "phase": order.phase, "status": order.status,
        "needs_description": order.needs_description,
        "signed_patient": order.signed_patient, "signed_agency": order.signed_agency,
        "total_estimated": order.total_estimated, "total_actual": order.total_actual,
        "leistungen": leist_json,
        "external_invoices": external_invoices_json,
        "process_gates": process_gates,
        "planning_preparation": planning_preparation,
        "execution_flow": execution_flow,
        "followup_flow": followup_flow,
        "lifecycle": lifecycle,
        "created_at": order.created_at, "updated_at": order.updated_at,
    }))
    .into_response()
}

async fn update_phase(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<PhaseRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match body.phase.as_str() {
        "discovery" => {}
        "intake" => {}
        "execution" => {}
        "closure" => {}
        "followup" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid phase"),
    }

    let order_context = match sqlx::query(
        r#"SELECT patient_id, phase, created_at
           FROM orders
           WHERE id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "load order lifecycle context");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let patient_id: Uuid = order_context.try_get("patient_id").unwrap_or_default();
    let current_phase: String = order_context.try_get("phase").unwrap_or_default();
    let created_at: chrono::DateTime<chrono::Utc> = order_context
        .try_get("created_at")
        .unwrap_or_else(|_| chrono::Utc::now());
    let phase_note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if current_phase == body.phase {
        return Json(serde_json::json!({"ok": true})).into_response();
    }

    match next_order_phase(&current_phase) {
        Some(next_phase) if next_phase == body.phase => {}
        Some(next_phase) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("Only the next lifecycle phase is allowed: {next_phase}"),
            );
        }
        None => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order already reached the final lifecycle phase",
            );
        }
    }

    let readiness = match load_order_process_readiness(&state, order_id, patient_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let lifecycle_gate =
        match load_order_transition_gate(&state, order_id, &current_phase, &readiness).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    if lifecycle_gate.blocked {
        return lifecycle_gate_err(&body.phase, &lifecycle_gate.reasons);
    }

    match sqlx::query!(
        "UPDATE orders SET phase = $2 WHERE id = $1",
        order_id,
        body.phase
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            if let Err(resp) = crate::routes::workflow_checklists::ensure_default_order_workflow(
                &state,
                order_id,
                Some(auth.user_id),
            )
            .await
            {
                return resp;
            }
            state.audit_sender.try_send(audit::domain_event(
                "update_phase",
                Some(auth.user_id),
                "order",
                Some(order_id),
                serde_json::json!({
                    "phase": body.phase.clone(),
                    "from_phase": current_phase.clone(),
                    "note": phase_note.clone(),
                }),
            ));
            if let Err(resp) = crate::routes::workflow_lifecycle::record_event(
                &state,
                crate::routes::workflow_lifecycle::RecordEvent {
                    entity_type: "order",
                    entity_id: order_id,
                    from_stage: Some(current_phase.as_str()),
                    to_stage: &body.phase,
                    transition_kind: "phase_change",
                    changed_by: Some(auth.user_id),
                    note: phase_note.as_deref(),
                    metadata: serde_json::json!({
                        "from_phase": current_phase.clone(),
                        "to_phase": body.phase.clone(),
                        "created_at": created_at.to_rfc3339(),
                    }),
                },
            )
            .await
            {
                return resp;
            }
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.phase_changed",
                order_id,
                serde_json::json!({
                    "from_phase": current_phase,
                    "phase": body.phase,
                    "note": phase_note,
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, "update phase");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn update_process_gates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<UpdateOrderProcessGatesRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let billing_release_status = body
        .billing_release_status
        .map(|value| value.to_lowercase());
    let package_coverage_status = body
        .package_coverage_status
        .map(|value| value.to_lowercase());

    if billing_release_status.is_none() && package_coverage_status.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "No process gate changes supplied",
        );
    }
    if billing_release_status.is_some() && !matches!(auth.role, Role::Billing | Role::Ceo) {
        return err(
            StatusCode::FORBIDDEN,
            "Only billing or CEO may decide billing release",
        );
    }
    if package_coverage_status.is_some() && !matches!(auth.role, Role::PatientManager | Role::Ceo) {
        return err(
            StatusCode::FORBIDDEN,
            "Only patient managers or CEO may decide package coverage",
        );
    }

    if let Some(ref value) = billing_release_status
        && !is_valid_billing_release_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid billing_release_status",
        );
    }
    if let Some(ref value) = package_coverage_status
        && !is_valid_package_coverage_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid package_coverage_status",
        );
    }

    let patient_id = match sqlx::query_scalar::<_, Uuid>(
        "SELECT patient_id FROM orders WHERE id = $1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "load process gate patient context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update order process gates",
            );
        }
    };

    match sqlx::query(
        r#"UPDATE orders
           SET billing_release_status = COALESCE($2, billing_release_status),
               billing_release_note = CASE WHEN $2 IS NOT NULL THEN $3 ELSE billing_release_note END,
               billing_released_by = CASE WHEN $2 IS NOT NULL THEN $4 ELSE billing_released_by END,
               billing_released_at = CASE WHEN $2 IS NOT NULL THEN now() ELSE billing_released_at END,
               package_coverage_status = COALESCE($5, package_coverage_status),
               package_coverage_note = CASE WHEN $5 IS NOT NULL THEN $6 ELSE package_coverage_note END,
               package_coverage_decided_by = CASE WHEN $5 IS NOT NULL THEN $4 ELSE package_coverage_decided_by END,
               package_coverage_decided_at = CASE WHEN $5 IS NOT NULL THEN now() ELSE package_coverage_decided_at END
           WHERE id = $1"#,
    )
    .bind(order_id)
    .bind(billing_release_status.clone())
    .bind(body.billing_release_note.clone())
    .bind(auth.user_id)
    .bind(package_coverage_status.clone())
    .bind(body.package_coverage_note.clone())
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            let realtime_payload = serde_json::json!({
                "billing_release_status": billing_release_status,
                "billing_release_note": body.billing_release_note,
                "package_coverage_status": package_coverage_status,
                "package_coverage_note": body.package_coverage_note,
            });
            state.audit_sender.try_send(audit::domain_event(
                "update_order_process_gates",
                Some(auth.user_id),
                "order",
                Some(order_id),
                realtime_payload.clone(),
            ));
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.process_gates_updated",
                order_id,
                realtime_payload,
            )
            .await;

            match load_order_process_readiness(&state, order_id, patient_id).await {
                Ok(readiness) => Json(readiness.payload).into_response(),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "update process gates");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update order process gates",
            )
        }
    }
}

async fn update_debt_management(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<UpdateOrderDebtManagementRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    if body.status.is_none()
        && body.note.is_none()
        && body.owner_user_id.is_none()
        && body.next_review_at.is_none()
        && body.last_contact_at.is_none()
        && body.resolution_note.is_none()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "No debt-management changes supplied",
        );
    }

    let status = body
        .status
        .as_ref()
        .map(|value| value.trim().to_lowercase());
    if let Some(ref value) = status
        && !crate::routes::debt_management::is_valid_debt_management_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid debt-management status",
        );
    }

    let next_review_at = match parse_optional_datetime(body.next_review_at.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let last_contact_at = match parse_optional_datetime(body.last_contact_at.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let note_supplied = body.note.is_some();
    let resolution_note_supplied = body.resolution_note.is_some();
    let next_review_supplied = body.next_review_at.is_some();
    let last_contact_supplied = body.last_contact_at.is_some();
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let resolution_note = body
        .resolution_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if let Some(owner_user_id) = body.owner_user_id {
        let exists = match sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)",
        )
        .bind(owner_user_id)
        .fetch_one(&state.db)
        .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, user_id = %owner_user_id, "validate debt owner");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update debt-management state",
                );
            }
        };
        if !exists {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Debt owner not found");
        }
    }

    let patient_id = match sqlx::query_scalar::<_, Uuid>(
        "SELECT patient_id FROM orders WHERE id = $1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "load debt-management patient context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update debt-management state",
            );
        }
    };

    if let Err(resp) =
        crate::routes::debt_management::ensure_order_debt_management_state(&state, order_id).await
    {
        return resp;
    }

    match sqlx::query(
        r#"UPDATE order_debt_management
           SET status = COALESCE($2, status),
               note = CASE WHEN $3::bool THEN $4 ELSE note END,
               owner_user_id = COALESCE($5, owner_user_id),
               next_review_at = CASE WHEN $6::bool THEN $7 ELSE next_review_at END,
               last_contact_at = CASE WHEN $8::bool THEN $9 ELSE last_contact_at END,
               resolution_note = CASE WHEN $10::bool THEN $11 ELSE resolution_note END,
               resolved_at = CASE
                   WHEN $2 = 'cleared' THEN now()
                   WHEN $2 IS NOT NULL THEN NULL
                   ELSE resolved_at
               END,
               resolved_by = CASE
                   WHEN $2 = 'cleared' THEN $12
                   WHEN $2 IS NOT NULL THEN NULL
                   ELSE resolved_by
               END
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .bind(status.clone())
    .bind(note_supplied)
    .bind(note.clone())
    .bind(body.owner_user_id)
    .bind(next_review_supplied)
    .bind(next_review_at)
    .bind(last_contact_supplied)
    .bind(last_contact_at)
    .bind(resolution_note_supplied)
    .bind(resolution_note.clone())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            let realtime_payload = serde_json::json!({
                "status": status,
                "note": note,
                "owner_user_id": body.owner_user_id,
                "next_review_at": next_review_at.map(|value| value.to_rfc3339()),
                "last_contact_at": last_contact_at.map(|value| value.to_rfc3339()),
                "resolution_note": resolution_note,
            });
            state.audit_sender.try_send(audit::domain_event(
                "update_order_debt_management",
                Some(auth.user_id),
                "order",
                Some(order_id),
                realtime_payload.clone(),
            ));
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.debt_management_updated",
                order_id,
                realtime_payload,
            )
            .await;

            match load_order_process_readiness(&state, order_id, patient_id).await {
                Ok(readiness) => Json(readiness.payload).into_response(),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "update debt-management");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update debt-management state",
            )
        }
    }
}

async fn update_planning_preparation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<UpdateOrderPlanningPreparationRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    if body.treatment_plan_status.is_none()
        && body.treatment_plan_note.is_none()
        && body.non_medical_required.is_none()
        && body.interpreter_required.is_none()
        && body.preparation_documents_status.is_none()
        && body.interpreter_briefing_status.is_none()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "No planning/preparation changes supplied",
        );
    }

    let treatment_plan_status = body.treatment_plan_status.map(|value| value.to_lowercase());
    let preparation_documents_status = body
        .preparation_documents_status
        .map(|value| value.to_lowercase());
    let interpreter_briefing_status = body
        .interpreter_briefing_status
        .map(|value| value.to_lowercase());

    if let Some(ref value) = treatment_plan_status
        && !is_valid_treatment_plan_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid treatment_plan_status",
        );
    }
    if let Some(ref value) = preparation_documents_status
        && !is_valid_preparation_documents_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid preparation_documents_status",
        );
    }
    if let Some(ref value) = interpreter_briefing_status
        && !is_valid_interpreter_briefing_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid interpreter_briefing_status",
        );
    }

    if let Err(resp) = ensure_order_planning_preparation_state(&state, order_id).await {
        return resp;
    }

    let current = match sqlx::query(
        r#"SELECT non_medical_required, interpreter_required,
                  treatment_plan_status, preparation_documents_status, interpreter_briefing_status
           FROM order_planning_preparation
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "load planning state before update");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update order planning/preparation",
            );
        }
    };

    let effective_interpreter_required = body
        .interpreter_required
        .unwrap_or_else(|| current.try_get("interpreter_required").unwrap_or(false));
    let effective_interpreter_briefing_status = if !effective_interpreter_required {
        "not_needed".to_string()
    } else {
        interpreter_briefing_status.clone().unwrap_or_else(|| {
            current
                .try_get("interpreter_briefing_status")
                .unwrap_or_else(|_| "pending".to_string())
        })
    };

    match sqlx::query(
        r#"UPDATE order_planning_preparation
           SET treatment_plan_status = COALESCE($2, treatment_plan_status),
               treatment_plan_note = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE treatment_plan_note END,
               non_medical_required = COALESCE($4, non_medical_required),
               interpreter_required = COALESCE($5, interpreter_required),
               preparation_documents_status = COALESCE($6, preparation_documents_status),
               interpreter_briefing_status = $7,
               plan_finalized_at = CASE
                    WHEN $2 = 'finalized' THEN COALESCE(plan_finalized_at, now())
                    WHEN $2 IS NOT NULL AND $2 <> 'finalized' THEN NULL
                    ELSE plan_finalized_at
               END,
               plan_finalized_by = CASE
                    WHEN $2 = 'finalized' THEN COALESCE(plan_finalized_by, $8)
                    WHEN $2 IS NOT NULL AND $2 <> 'finalized' THEN NULL
                    ELSE plan_finalized_by
               END,
               preparation_documents_sent_at = CASE
                    WHEN $6 = 'sent' THEN COALESCE(preparation_documents_sent_at, now())
                    WHEN $6 IS NOT NULL AND $6 <> 'sent' THEN NULL
                    ELSE preparation_documents_sent_at
               END,
               preparation_documents_sent_by = CASE
                    WHEN $6 = 'sent' THEN COALESCE(preparation_documents_sent_by, $8)
                    WHEN $6 IS NOT NULL AND $6 <> 'sent' THEN NULL
                    ELSE preparation_documents_sent_by
               END,
               interpreter_briefed_at = CASE
                    WHEN $7 = 'completed' THEN COALESCE(interpreter_briefed_at, now())
                    WHEN $7 <> 'completed' THEN NULL
                    ELSE interpreter_briefed_at
               END,
               interpreter_briefed_by = CASE
                    WHEN $7 = 'completed' THEN COALESCE(interpreter_briefed_by, $8)
                    WHEN $7 <> 'completed' THEN NULL
                    ELSE interpreter_briefed_by
               END
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .bind(treatment_plan_status.clone())
    .bind(body.treatment_plan_note.clone())
    .bind(body.non_medical_required)
    .bind(body.interpreter_required)
    .bind(preparation_documents_status.clone())
    .bind(effective_interpreter_briefing_status.clone())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            let realtime_payload = serde_json::json!({
                "treatment_plan_status": treatment_plan_status,
                "treatment_plan_note": body.treatment_plan_note,
                "non_medical_required": body.non_medical_required,
                "interpreter_required": body.interpreter_required,
                "preparation_documents_status": preparation_documents_status,
                "interpreter_briefing_status": effective_interpreter_briefing_status,
            });
            state.audit_sender.try_send(audit::domain_event(
                "update_order_planning_preparation",
                Some(auth.user_id),
                "order",
                Some(order_id),
                realtime_payload.clone(),
            ));
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.planning_preparation_updated",
                order_id,
                realtime_payload,
            )
            .await;

            match load_order_planning_readiness(&state, order_id).await {
                Ok(readiness) => Json(readiness.payload).into_response(),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "update planning/preparation");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update order planning/preparation",
            )
        }
    }
}

async fn update_execution_flow(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<UpdateOrderExecutionFlowRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    if body.arrival_status.is_none()
        && body.medical_execution_status.is_none()
        && body.non_medical_execution_status.is_none()
        && body.interpreter_service_status.is_none()
        && body.issue_status.is_none()
        && body.deviation_note.is_none()
        && body.execution_summary.is_none()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "No execution-flow changes supplied",
        );
    }

    let arrival_status = body.arrival_status.map(|value| value.to_lowercase());
    let medical_execution_status = body
        .medical_execution_status
        .map(|value| value.to_lowercase());
    let non_medical_execution_status = body
        .non_medical_execution_status
        .map(|value| value.to_lowercase());
    let interpreter_service_status = body
        .interpreter_service_status
        .map(|value| value.to_lowercase());
    let issue_status = body.issue_status.map(|value| value.to_lowercase());
    let deviation_note_supplied = body.deviation_note.is_some();
    let deviation_note = normalize_optional_text(body.deviation_note);
    let execution_summary_supplied = body.execution_summary.is_some();
    let execution_summary = normalize_optional_text(body.execution_summary);

    if let Some(ref value) = arrival_status
        && !is_valid_execution_arrival_status(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid arrival_status");
    }
    if let Some(ref value) = medical_execution_status
        && !is_valid_execution_step_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid medical_execution_status",
        );
    }
    if let Some(ref value) = non_medical_execution_status
        && !is_valid_execution_step_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid non_medical_execution_status",
        );
    }
    if let Some(ref value) = interpreter_service_status
        && !is_valid_execution_step_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid interpreter_service_status",
        );
    }
    if let Some(ref value) = issue_status
        && !is_valid_execution_issue_status(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid issue_status");
    }

    if let Err(resp) = ensure_order_execution_flow_state(&state, order_id).await {
        return resp;
    }

    match sqlx::query(
        r#"UPDATE order_execution_flows
           SET arrival_status = COALESCE($2, arrival_status),
               medical_execution_status = COALESCE($3, medical_execution_status),
               non_medical_execution_status = COALESCE($4, non_medical_execution_status),
               interpreter_service_status = COALESCE($5, interpreter_service_status),
               issue_status = COALESCE($6, issue_status),
               deviation_note = CASE WHEN $7::bool THEN $8 ELSE deviation_note END,
               execution_summary = CASE WHEN $9::bool THEN $10 ELSE execution_summary END,
               arrival_recorded_at = CASE
                   WHEN $2 = 'arrived' THEN COALESCE(arrival_recorded_at, now())
                   WHEN $2 IS NOT NULL AND $2 <> 'arrived' THEN NULL
                   ELSE arrival_recorded_at
               END,
               arrival_recorded_by = CASE
                   WHEN $2 = 'arrived' THEN COALESCE(arrival_recorded_by, $11)
                   WHEN $2 IS NOT NULL AND $2 <> 'arrived' THEN NULL
                   ELSE arrival_recorded_by
               END,
               medical_completed_at = CASE
                   WHEN $3 = 'completed' THEN COALESCE(medical_completed_at, now())
                   WHEN $3 IS NOT NULL AND $3 <> 'completed' THEN NULL
                   ELSE medical_completed_at
               END,
               medical_completed_by = CASE
                   WHEN $3 = 'completed' THEN COALESCE(medical_completed_by, $11)
                   WHEN $3 IS NOT NULL AND $3 <> 'completed' THEN NULL
                   ELSE medical_completed_by
               END,
               non_medical_completed_at = CASE
                   WHEN $4 = 'completed' THEN COALESCE(non_medical_completed_at, now())
                   WHEN $4 IS NOT NULL AND $4 <> 'completed' THEN NULL
                   ELSE non_medical_completed_at
               END,
               non_medical_completed_by = CASE
                   WHEN $4 = 'completed' THEN COALESCE(non_medical_completed_by, $11)
                   WHEN $4 IS NOT NULL AND $4 <> 'completed' THEN NULL
                   ELSE non_medical_completed_by
               END,
               interpreter_completed_at = CASE
                   WHEN $5 = 'completed' THEN COALESCE(interpreter_completed_at, now())
                   WHEN $5 IS NOT NULL AND $5 <> 'completed' THEN NULL
                   ELSE interpreter_completed_at
               END,
               interpreter_completed_by = CASE
                   WHEN $5 = 'completed' THEN COALESCE(interpreter_completed_by, $11)
                   WHEN $5 IS NOT NULL AND $5 <> 'completed' THEN NULL
                   ELSE interpreter_completed_by
               END,
               issues_resolved_at = CASE
                   WHEN $6 = 'resolved' THEN COALESCE(issues_resolved_at, now())
                   WHEN $6 IS NOT NULL AND $6 <> 'resolved' THEN NULL
                   ELSE issues_resolved_at
               END,
               issues_resolved_by = CASE
                   WHEN $6 = 'resolved' THEN COALESCE(issues_resolved_by, $11)
                   WHEN $6 IS NOT NULL AND $6 <> 'resolved' THEN NULL
                   ELSE issues_resolved_by
               END
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .bind(arrival_status.clone())
    .bind(medical_execution_status.clone())
    .bind(non_medical_execution_status.clone())
    .bind(interpreter_service_status.clone())
    .bind(issue_status.clone())
    .bind(deviation_note_supplied)
    .bind(deviation_note.clone())
    .bind(execution_summary_supplied)
    .bind(execution_summary.clone())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            let realtime_payload = serde_json::json!({
                "arrival_status": arrival_status,
                "medical_execution_status": medical_execution_status,
                "non_medical_execution_status": non_medical_execution_status,
                "interpreter_service_status": interpreter_service_status,
                "issue_status": issue_status,
                "deviation_note": deviation_note,
                "execution_summary": execution_summary,
            });
            state.audit_sender.try_send(audit::domain_event(
                "update_order_execution_flow",
                Some(auth.user_id),
                "order",
                Some(order_id),
                realtime_payload.clone(),
            ));
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.execution_flow_updated",
                order_id,
                realtime_payload,
            )
            .await;

            match load_order_execution_readiness(&state, order_id).await {
                Ok(readiness) => Json(readiness.payload).into_response(),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "update execution flow");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update order execution flow",
            )
        }
    }
}

async fn update_followup_flow(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<UpdateOrderFollowupFlowRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    if body.doctor_followup_status.is_none()
        && body.followup_1w_status.is_none()
        && body.followup_1m_status.is_none()
        && body.followup_6m_status.is_none()
        && body.package_end_date.is_none()
        && body.package_end_status.is_none()
        && body.results_handoff_status.is_none()
        && body.followup_summary.is_none()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "No follow-up changes supplied",
        );
    }

    let doctor_followup_status = body
        .doctor_followup_status
        .map(|value| value.to_lowercase());
    let followup_1w_status = body.followup_1w_status.map(|value| value.to_lowercase());
    let followup_1m_status = body.followup_1m_status.map(|value| value.to_lowercase());
    let followup_6m_status = body.followup_6m_status.map(|value| value.to_lowercase());
    let package_end_status = body.package_end_status.map(|value| value.to_lowercase());
    let results_handoff_status = body
        .results_handoff_status
        .map(|value| value.to_lowercase());
    let followup_summary_supplied = body.followup_summary.is_some();
    let followup_summary = normalize_optional_text(body.followup_summary);

    if let Some(ref value) = doctor_followup_status
        && !is_valid_followup_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid doctor_followup_status",
        );
    }
    if let Some(ref value) = followup_1w_status
        && !is_valid_followup_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid followup_1w_status",
        );
    }
    if let Some(ref value) = followup_1m_status
        && !is_valid_followup_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid followup_1m_status",
        );
    }
    if let Some(ref value) = followup_6m_status
        && !is_valid_followup_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid followup_6m_status",
        );
    }
    if let Some(ref value) = package_end_status
        && !is_valid_followup_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid package_end_status",
        );
    }
    if let Some(ref value) = results_handoff_status
        && !is_valid_results_handoff_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid results_handoff_status",
        );
    }

    let package_end_date_supplied = body.package_end_date.is_some();
    let package_end_date = match body.package_end_date.as_deref() {
        Some(raw) if raw.trim().is_empty() => None,
        Some(raw) => match chrono::NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d") {
            Ok(value) => Some(value),
            Err(_) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid package_end_date (YYYY-MM-DD)",
                );
            }
        },
        None => None,
    };

    if let Err(resp) = ensure_order_followup_flow_state(&state, order_id).await {
        return resp;
    }

    match sqlx::query(
        r#"UPDATE order_followup_flows
           SET doctor_followup_status = COALESCE($2, doctor_followup_status),
               followup_1w_status = COALESCE($3, followup_1w_status),
               followup_1m_status = COALESCE($4, followup_1m_status),
               followup_6m_status = COALESCE($5, followup_6m_status),
               package_end_date = CASE WHEN $6::bool THEN $7 ELSE package_end_date END,
               package_end_status = COALESCE($8, package_end_status),
               results_handoff_status = COALESCE($9, results_handoff_status),
               followup_summary = CASE WHEN $10::bool THEN $11 ELSE followup_summary END
           WHERE order_id = $1"#,
    )
    .bind(order_id)
    .bind(doctor_followup_status.clone())
    .bind(followup_1w_status.clone())
    .bind(followup_1m_status.clone())
    .bind(followup_6m_status.clone())
    .bind(package_end_date_supplied)
    .bind(package_end_date)
    .bind(package_end_status.clone())
    .bind(results_handoff_status.clone())
    .bind(followup_summary_supplied)
    .bind(followup_summary.clone())
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            let realtime_payload = serde_json::json!({
                "doctor_followup_status": doctor_followup_status,
                "followup_1w_status": followup_1w_status,
                "followup_1m_status": followup_1m_status,
                "followup_6m_status": followup_6m_status,
                "package_end_date": package_end_date.map(|value| value.to_string()),
                "package_end_status": package_end_status,
                "results_handoff_status": results_handoff_status,
                "followup_summary": followup_summary,
            });
            state.audit_sender.try_send(audit::domain_event(
                "update_order_followup_flow",
                Some(auth.user_id),
                "order",
                Some(order_id),
                realtime_payload.clone(),
            ));
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.followup_flow_updated",
                order_id,
                realtime_payload,
            )
            .await;

            match load_order_followup_readiness(&state, order_id).await {
                Ok(readiness) => Json(readiness.payload).into_response(),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, order_id = %order_id, "update follow-up flow");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update order follow-up flow",
            )
        }
    }
}

async fn list_my_followup_milestones(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Patient]) {
        return e;
    }

    let patient_id = match crate::routes::me::resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let rows = match sqlx::query(
        r#"SELECT id, order_number, phase, status
           FROM orders
           WHERE patient_id = $1
             AND status <> 'cancelled'
             AND phase IN ('closure', 'followup')
           ORDER BY updated_at DESC
           LIMIT 50"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list my follow-up milestones");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load follow-up milestones",
            );
        }
    };

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let order_id: Uuid = row.try_get("id").unwrap_or_default();
        let followup = match load_order_followup_readiness(&state, order_id).await {
            Ok(value) => value.payload,
            Err(resp) => return resp,
        };
        let mut item = followup.as_object().cloned().unwrap_or_default();
        item.insert("order_id".to_string(), serde_json::json!(order_id));
        item.insert(
            "order_number".to_string(),
            serde_json::json!(row.try_get::<String, _>("order_number").unwrap_or_default()),
        );
        item.insert(
            "phase".to_string(),
            serde_json::json!(row.try_get::<String, _>("phase").unwrap_or_default()),
        );
        item.insert(
            "status".to_string(),
            serde_json::json!(row.try_get::<String, _>("status").unwrap_or_default()),
        );
        items.push(serde_json::Value::Object(item));
    }

    Json(items).into_response()
}

async fn list_external_invoices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match sqlx::query(
        r#"SELECT ei.id, ei.provider_id, ei.external_invoice_number, ei.invoice_date,
                  ei.due_date, ei.amount_net, ei.amount_vat, ei.amount_gross, ei.currency,
                  ei.status, ei.received_at, ei.paid_at, ei.notes, ei.created_at, ei.updated_at,
                  pr.name AS provider_name,
                  provider_taxonomy.id AS provider_taxonomy_node_id,
                  provider_taxonomy.code AS provider_taxonomy_node_code,
                  provider_taxonomy.name_de AS provider_taxonomy_node_name_de,
                  provider_taxonomy.name_ru AS provider_taxonomy_node_name_ru
           FROM external_invoices ei
           LEFT JOIN providers pr ON pr.id = ei.provider_id
           LEFT JOIN LATERAL (
               SELECT ptn.id, ptn.code, ptn.name_de, ptn.name_ru
               FROM provider_taxonomy_assignments pta
               JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
               WHERE pta.provider_id = pr.id
               ORDER BY pta.is_primary DESC, ptn.sort_order, ptn.name_de
               LIMIT 1
           ) provider_taxonomy ON true
           WHERE ei.order_id = $1
           ORDER BY ei.created_at DESC"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                items.push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
                    "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                    "provider_taxonomy_node_id": row.try_get::<Option<Uuid>, _>("provider_taxonomy_node_id").unwrap_or_default(),
                    "provider_taxonomy_node_code": row.try_get::<Option<String>, _>("provider_taxonomy_node_code").unwrap_or_default(),
                    "provider_taxonomy_node_name_de": row.try_get::<Option<String>, _>("provider_taxonomy_node_name_de").unwrap_or_default(),
                    "provider_taxonomy_node_name_ru": row.try_get::<Option<String>, _>("provider_taxonomy_node_name_ru").unwrap_or_default(),
                    "external_invoice_number": row.try_get::<String, _>("external_invoice_number").unwrap_or_default(),
                    "invoice_date": row.try_get::<Option<chrono::NaiveDate>, _>("invoice_date").unwrap_or_default().map(|value| value.to_string()),
                    "due_date": row.try_get::<Option<chrono::NaiveDate>, _>("due_date").unwrap_or_default().map(|value| value.to_string()),
                    "amount_net": row.try_get::<rust_decimal::Decimal, _>("amount_net").unwrap_or(rust_decimal::Decimal::ZERO),
                    "amount_vat": row.try_get::<rust_decimal::Decimal, _>("amount_vat").unwrap_or(rust_decimal::Decimal::ZERO),
                    "amount_gross": row.try_get::<rust_decimal::Decimal, _>("amount_gross").unwrap_or(rust_decimal::Decimal::ZERO),
                    "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "received_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("received_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    "paid_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("paid_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                    "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").unwrap_or_else(|_| chrono::Utc::now()).to_rfc3339(),
                    "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").unwrap_or_else(|_| chrono::Utc::now()).to_rfc3339(),
                }));
            }
            Json(items).into_response()
        }
        Err(error) => {
            tracing::error!(error = %error, order_id = %order_id, "list external invoices");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load external invoices",
            )
        }
    }
}

async fn create_external_invoice(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<CreateExternalInvoiceRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let external_invoice_number = body.external_invoice_number.trim();
    if external_invoice_number.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "External invoice number is required",
        );
    }
    let status = body.status.as_deref().unwrap_or("expected");
    if !is_valid_external_invoice_status(status) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid external invoice status",
        );
    }
    if let Err(resp) = validate_provider_doctor_context(&state, body.provider_id, None).await {
        return resp;
    }
    let invoice_date = match parse_optional_order_date(body.invoice_date.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let due_date = match parse_optional_order_date(body.due_date.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let amount_net =
        rust_decimal::Decimal::try_from(body.amount_net.unwrap_or(0.0)).unwrap_or_default();
    let amount_vat =
        rust_decimal::Decimal::try_from(body.amount_vat.unwrap_or(0.0)).unwrap_or_default();
    let amount_gross =
        rust_decimal::Decimal::try_from(body.amount_gross).unwrap_or(rust_decimal::Decimal::ZERO);
    let currency = body
        .currency
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("EUR")
        .to_uppercase();
    let notes = body
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let patient_id: Uuid = match sqlx::query_scalar("SELECT patient_id FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(error) => {
            tracing::error!(error = %error, order_id = %order_id, "load order patient");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create external invoice",
            );
        }
    };

    match sqlx::query(
        r#"INSERT INTO external_invoices (
                order_id, patient_id, provider_id, external_invoice_number, invoice_date,
                due_date, amount_net, amount_vat, amount_gross, currency, status, notes,
                received_at, paid_at, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12,
                CASE WHEN $11 IN ('received', 'approved', 'paid', 'overdue') THEN now() ELSE NULL END,
                CASE WHEN $11 = 'paid' THEN now() ELSE NULL END,
                $13
           )
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(body.provider_id)
    .bind(external_invoice_number)
    .bind(invoice_date)
    .bind(due_date)
    .bind(amount_net)
    .bind(amount_vat)
    .bind(amount_gross)
    .bind(currency)
    .bind(status)
    .bind(notes)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let id: Uuid = row.try_get("id").unwrap_or_default();
            if let Err(error) =
                crate::routes::invoices::sync_external_invoice_accounting_entries_from_current_state(
                    &state,
                    id,
                    Some(auth.user_id),
                )
                .await
            {
                tracing::error!(error = %error, order_id = %order_id, external_invoice_id = %id, "sync external invoice accounting entries on create");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to create external invoice accounting ledger",
                );
            }
            state.audit_sender.try_send(audit::domain_event(
                "create_external_invoice".to_string(),
                Some(auth.user_id),
                "order",
                Some(order_id),
                serde_json::json!({
                    "external_invoice_id": id,
                    "external_invoice_number": external_invoice_number,
                    "status": status,
                    "amount_gross": amount_gross.to_string(),
                }),
            ));
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.external_invoice_created",
                order_id,
                serde_json::json!({
                    "external_invoice_id": id,
                    "external_invoice_number": external_invoice_number,
                    "status": status,
                    "amount_gross": amount_gross.to_string(),
                }),
            )
            .await;
            (StatusCode::CREATED, Json(serde_json::json!({ "id": id }))).into_response()
        }
        Err(error) => {
            tracing::error!(error = %error, order_id = %order_id, "create external invoice");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create external invoice",
            )
        }
    }
}

async fn update_external_invoice(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, external_invoice_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateExternalInvoiceRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let status = body
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(value) = status
        && !is_valid_external_invoice_status(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid external invoice status",
        );
    }
    if let Err(resp) = validate_provider_doctor_context(&state, body.provider_id, None).await {
        return resp;
    }
    let invoice_date = match parse_optional_order_date(body.invoice_date.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let due_date = match parse_optional_order_date(body.due_date.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let amount_net = body
        .amount_net
        .map(|value| rust_decimal::Decimal::try_from(value).unwrap_or_default());
    let amount_vat = body
        .amount_vat
        .map(|value| rust_decimal::Decimal::try_from(value).unwrap_or_default());
    let amount_gross = body
        .amount_gross
        .map(|value| rust_decimal::Decimal::try_from(value).unwrap_or_default());
    let currency = body
        .currency
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_uppercase());
    let notes = body.notes.as_deref().map(str::trim).map(str::to_string);

    match sqlx::query(
        r#"UPDATE external_invoices
           SET provider_id = COALESCE($3, provider_id),
               invoice_date = COALESCE($4, invoice_date),
               due_date = COALESCE($5, due_date),
               amount_net = COALESCE($6, amount_net),
               amount_vat = COALESCE($7, amount_vat),
               amount_gross = COALESCE($8, amount_gross),
               currency = COALESCE($9, currency),
               status = COALESCE($10, status),
               notes = CASE
                   WHEN $11 IS NULL THEN notes
                   ELSE NULLIF($11, '')
               END,
               received_at = CASE
                   WHEN COALESCE($10, status) IN ('received', 'approved', 'paid', 'overdue')
                        AND received_at IS NULL THEN now()
                   ELSE received_at
               END,
               paid_at = CASE
                   WHEN COALESCE($10, status) = 'paid' AND paid_at IS NULL THEN now()
                   WHEN COALESCE($10, status) <> 'paid' THEN NULL
                   ELSE paid_at
               END
           WHERE id = $1
             AND order_id = $2
           RETURNING id"#,
    )
    .bind(external_invoice_id)
    .bind(order_id)
    .bind(body.provider_id)
    .bind(invoice_date)
    .bind(due_date)
    .bind(amount_net)
    .bind(amount_vat)
    .bind(amount_gross)
    .bind(currency)
    .bind(status)
    .bind(notes)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(_)) => {
            if let Err(error) =
                crate::routes::invoices::sync_external_invoice_accounting_entries_from_current_state(
                    &state,
                    external_invoice_id,
                    Some(auth.user_id),
                )
                .await
            {
                tracing::error!(error = %error, order_id = %order_id, external_invoice_id = %external_invoice_id, "sync external invoice accounting entries on update");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update external invoice accounting ledger",
                );
            }
            state.audit_sender.try_send(audit::domain_event(
                "update_external_invoice".to_string(),
                Some(auth.user_id),
                "order",
                Some(order_id),
                serde_json::json!({
                    "external_invoice_id": external_invoice_id,
                    "status": status,
                }),
            ));
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.external_invoice_updated",
                order_id,
                serde_json::json!({
                    "external_invoice_id": external_invoice_id,
                    "status": status,
                }),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "External invoice not found"),
        Err(error) => {
            tracing::error!(error = %error, order_id = %order_id, external_invoice_id = %external_invoice_id, "update external invoice");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update external invoice",
            )
        }
    }
}

async fn list_leistungen(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match sqlx::query(
        r#"SELECT ol.id, ol.description, ol.quantity, ol.unit_price, ol.currency, ol.vat_rate,
                  ol.is_cost_passthrough, ol.status, ol.notes, ol.provider_id, ol.doctor_id,
                  ol.source_interpreter_report_id, ol.source_medical_appointment_id,
                  ol.agency_service_id, ol.external_document_id,
                  pr.name AS provider_name, d.name AS doctor_name,
                  provider_taxonomy.id AS provider_taxonomy_node_id,
                  provider_taxonomy.code AS provider_taxonomy_node_code,
                  provider_taxonomy.name_de AS provider_taxonomy_node_name_de,
                  provider_taxonomy.name_ru AS provider_taxonomy_node_name_ru,
                  catalog.service_key AS agency_service_key, catalog.service_name AS agency_service_name,
                  doc.auto_name AS external_document_auto_name,
                  doc.original_filename AS external_document_filename
           FROM order_leistungen ol
           LEFT JOIN providers pr ON pr.id = ol.provider_id
           LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
           LEFT JOIN LATERAL (
               SELECT ptn.id, ptn.code, ptn.name_de, ptn.name_ru
               FROM provider_taxonomy_assignments pta
               JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
               WHERE pta.provider_id = pr.id
               ORDER BY pta.is_primary DESC, ptn.sort_order, ptn.name_de
               LIMIT 1
           ) provider_taxonomy ON true
           LEFT JOIN agency_service_catalog catalog ON catalog.id = ol.agency_service_id
           LEFT JOIN documents doc ON doc.id = ol.external_document_id
           WHERE ol.order_id = $1
           ORDER BY ol.created_at"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for r in rows {
                items.push(serde_json::json!({
                    "id": r.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "description": r.try_get::<String, _>("description").unwrap_or_default(),
                    "quantity": r.try_get::<rust_decimal::Decimal, _>("quantity").unwrap_or(rust_decimal::Decimal::ZERO),
                    "unit_price": r.try_get::<rust_decimal::Decimal, _>("unit_price").unwrap_or(rust_decimal::Decimal::ZERO),
                    "currency": r.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                    "vat_rate": r.try_get::<rust_decimal::Decimal, _>("vat_rate").unwrap_or(rust_decimal::Decimal::ZERO),
                    "is_cost_passthrough": r.try_get::<bool, _>("is_cost_passthrough").unwrap_or(false),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "notes": r.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                    "provider_id": r.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
                    "provider_name": r.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                    "provider_taxonomy_node_id": r.try_get::<Option<Uuid>, _>("provider_taxonomy_node_id").unwrap_or_default(),
                    "provider_taxonomy_node_code": r.try_get::<Option<String>, _>("provider_taxonomy_node_code").unwrap_or_default(),
                    "provider_taxonomy_node_name_de": r.try_get::<Option<String>, _>("provider_taxonomy_node_name_de").unwrap_or_default(),
                    "provider_taxonomy_node_name_ru": r.try_get::<Option<String>, _>("provider_taxonomy_node_name_ru").unwrap_or_default(),
                    "doctor_id": r.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
                    "doctor_name": r.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
                    "source_interpreter_report_id": r.try_get::<Option<Uuid>, _>("source_interpreter_report_id").unwrap_or_default(),
                    "source_medical_appointment_id": r.try_get::<Option<Uuid>, _>("source_medical_appointment_id").unwrap_or_default(),
                    "agency_service_id": r.try_get::<Option<Uuid>, _>("agency_service_id").unwrap_or_default(),
                    "agency_service_key": r.try_get::<Option<String>, _>("agency_service_key").unwrap_or_default(),
                    "agency_service_name": r.try_get::<Option<String>, _>("agency_service_name").unwrap_or_default(),
                    "external_document_id": r.try_get::<Option<Uuid>, _>("external_document_id").unwrap_or_default(),
                    "external_document_auto_name": r.try_get::<Option<String>, _>("external_document_auto_name").unwrap_or_default(),
                    "external_document_filename": r.try_get::<Option<String>, _>("external_document_filename").unwrap_or_default(),
                }));
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list leistungen");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn add_leistung(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<AddLeistungRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let vat = rust_decimal::Decimal::try_from(body.vat_rate.unwrap_or(19.0))
        .unwrap_or(rust_decimal::Decimal::new(19, 0));
    let qty = rust_decimal::Decimal::try_from(body.quantity).unwrap_or(rust_decimal::Decimal::ONE);
    let price =
        rust_decimal::Decimal::try_from(body.unit_price).unwrap_or(rust_decimal::Decimal::ZERO);
    let passthrough = body.is_cost_passthrough.unwrap_or(false);
    let description = body.description.clone();
    if let Err(resp) =
        validate_provider_doctor_context(&state, body.provider_id, body.doctor_id).await
    {
        return resp;
    }
    let external_document_id = match resolve_external_document_id_for_leistung(
        &state,
        order_id,
        passthrough,
        body.external_document_id,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        "INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate, is_cost_passthrough, provider_id, doctor_id, external_document_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id",
    )
    .bind(order_id)
    .bind(body.description)
    .bind(qty)
    .bind(price)
    .bind(vat)
    .bind(passthrough)
    .bind(body.provider_id)
    .bind(body.doctor_id)
    .bind(external_document_id)
    .bind(body.notes)
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            let id: Uuid = r.try_get("id").unwrap_or_default();
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.leistung_added",
                order_id,
                serde_json::json!({
                    "leistung_id": id,
                    "description": description,
                    "is_cost_passthrough": passthrough,
                }),
            )
            .await;
            (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "add leistung"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn approve_leistung(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, leistung_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match sqlx::query!(
        "UPDATE order_leistungen SET status = 'approved', approved_by = $3, approved_at = now()
         WHERE id = $2 AND order_id = $1 AND status = 'delivered'",
        order_id,
        leistung_id,
        auth.user_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            crate::realtime::publish_order_event(
                &state,
                Some(auth.user_id),
                "order.leistung_approved",
                order_id,
                serde_json::json!({
                    "leistung_id": leistung_id,
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(
            StatusCode::NOT_FOUND,
            "Leistung not found or not in delivered status",
        ),
        Err(e) => {
            tracing::error!(error = %e, "approve leistung");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn validate_provider_doctor_context(
    state: &AppState,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    match (provider_id, doctor_id) {
        (None, Some(_)) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "doctor_id requires provider_id",
        )),
        (Some(provider_id), Some(doctor_id)) => {
            let row = sqlx::query(
                r#"SELECT doctor_id
                   FROM provider_doctor_links
                   WHERE provider_id = $1 AND doctor_id = $2"#,
            )
                .bind(provider_id)
                .bind(doctor_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to validate provider doctor");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate provider doctor")
                })?;

            if row.is_some() {
                Ok(())
            } else {
                Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor does not belong to provider",
                ))
            }
        }
        (Some(provider_id), None) => {
            let row = sqlx::query("SELECT id FROM providers WHERE id = $1")
                .bind(provider_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, provider_id = %provider_id, "Failed to validate provider");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate provider")
                })?;

            if row.is_some() {
                Ok(())
            } else {
                Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Provider not found"))
            }
        }
        (None, None) => Ok(()),
    }
}

async fn resolve_external_document_id_for_leistung(
    state: &AppState,
    order_id: Uuid,
    is_cost_passthrough: bool,
    requested_document_id: Option<Uuid>,
) -> Result<Option<Uuid>, axum::response::Response> {
    if let Some(document_id) = requested_document_id {
        let exists = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                    SELECT 1
                    FROM documents
                    WHERE id = $1
                      AND order_id = $2
                      AND status <> 'archived'
                      AND file_deleted_at IS NULL
               )"#,
        )
        .bind(document_id)
        .bind(order_id)
        .fetch_one(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, order_id = %order_id, document_id = %document_id, "validate order supporting document");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate supporting document",
            )
        })?;

        if !exists {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Supporting document must belong to the same order and stay active",
            ));
        }

        return Ok(Some(document_id));
    }

    if !is_cost_passthrough {
        return Ok(None);
    }

    let candidates = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT d.id
           FROM documents d
           WHERE d.order_id = $1
             AND d.status <> 'archived'
             AND d.file_deleted_at IS NULL
             AND (
                    lower(COALESCE(d.art, '')) IN ('receipt', 'payment_proof', 'invoice')
                 OR lower(COALESCE(d.category, '')) IN ('receipt', 'payment', 'invoice')
                 OR lower(COALESCE(d.auto_name, '')) LIKE ANY($2)
                 OR lower(COALESCE(d.original_filename, '')) LIKE ANY($2)
             )
           ORDER BY d.created_at DESC
           LIMIT 2"#,
    )
    .bind(order_id)
    .bind(vec![
        "%receipt%".to_string(),
        "%payment proof%".to_string(),
        "%invoice%".to_string(),
        "%beleg%".to_string(),
        "%rechnung%".to_string(),
        "%quittung%".to_string(),
    ])
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, order_id = %order_id, "load supporting document candidates");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to resolve supporting document",
        )
    })?;

    if candidates.len() == 1 {
        Ok(candidates.into_iter().next())
    } else {
        Ok(None)
    }
}

async fn resolve_external_invoice_notification_recipients(
    state: &AppState,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let billing_users = sqlx::query_scalar(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role = 'billing'
           ORDER BY created_at"#,
    )
    .fetch_all(&state.db)
    .await?;

    if !billing_users.is_empty() {
        return Ok(billing_users);
    }

    let fallback = sqlx::query_scalar(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role IN ('ceo', 'ceo_assistant')
           ORDER BY CASE role
               WHEN 'ceo' THEN 0
               ELSE 1
           END,
           created_at
           LIMIT 1"#,
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(fallback.into_iter().collect())
}

pub async fn run_external_invoice_deadline_scheduler_once(
    state: &AppState,
) -> Result<ExternalInvoiceDeadlineRunSummary, sqlx::Error> {
    let today = chrono::Utc::now().date_naive();
    let mut summary = ExternalInvoiceDeadlineRunSummary::default();
    let recipients = resolve_external_invoice_notification_recipients(state).await?;

    let candidates = sqlx::query(
        r#"SELECT ei.id, ei.order_id, ei.patient_id, ei.external_invoice_number, ei.due_date,
                  ei.amount_gross, ei.currency, o.order_number
           FROM external_invoices ei
           JOIN orders o ON o.id = ei.order_id
           WHERE ei.due_date IS NOT NULL
             AND ei.due_date < $1
             AND ei.status NOT IN ('paid', 'cancelled', 'overdue')
           ORDER BY ei.due_date, ei.created_at"#,
    )
    .bind(today)
    .fetch_all(&state.db)
    .await?;

    for row in candidates {
        let external_invoice_id: Uuid = row.try_get("id").unwrap_or_default();
        let order_id: Uuid = row.try_get("order_id").unwrap_or_default();
        let patient_id: Uuid = row.try_get("patient_id").unwrap_or_default();
        let external_invoice_number: String =
            row.try_get("external_invoice_number").unwrap_or_default();
        let due_date: chrono::NaiveDate = row.try_get("due_date").unwrap_or(today);
        let amount_gross: rust_decimal::Decimal = row
            .try_get("amount_gross")
            .unwrap_or(rust_decimal::Decimal::ZERO);
        let currency: String = row
            .try_get("currency")
            .unwrap_or_else(|_| "EUR".to_string());
        let order_number: String = row.try_get("order_number").unwrap_or_default();

        let result = sqlx::query(
            r#"UPDATE external_invoices
               SET status = 'overdue'
               WHERE id = $1
                 AND status NOT IN ('paid', 'cancelled', 'overdue')"#,
        )
        .bind(external_invoice_id)
        .execute(&state.db)
        .await?;

        if result.rows_affected() == 0 {
            continue;
        }

        summary.overdue_marked += result.rows_affected();

        for recipient_id in &recipients {
            let notification_row = sqlx::query(
                r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                   VALUES ($1, $2, $3, $4, 'order', $5)
                   RETURNING id, user_id"#,
            )
            .bind(recipient_id)
            .bind("external_invoice_overdue")
            .bind(format!("External invoice overdue for {order_number}"))
            .bind(format!(
                "External invoice {} became overdue on {} ({} {}).",
                external_invoice_number,
                due_date,
                amount_gross,
                currency
            ))
            .bind(order_id)
            .fetch_one(&state.db)
            .await?;
            let notification_id: Uuid = notification_row.try_get("id").unwrap_or_default();
            let user_id: Uuid = notification_row.try_get("user_id").unwrap_or_default();
            if !notification_id.is_nil() && !user_id.is_nil() {
                crate::realtime::publish_notification_event(
                    state,
                    user_id,
                    "notification.created",
                    Some(notification_id),
                    serde_json::json!({
                        "entity_type": "order",
                        "entity_id": order_id,
                    }),
                )
                .await;
            }
            summary.notifications_created += 1;
        }

        state.audit_sender.try_send(audit::domain_event(
            "auto_mark_external_invoice_overdue".to_string(),
            None,
            "order",
            Some(order_id),
            serde_json::json!({
                "external_invoice_id": external_invoice_id,
                "external_invoice_number": external_invoice_number,
                "patient_id": patient_id,
                "due_date": due_date.to_string(),
            }),
        ));
        crate::realtime::publish_order_event(
            state,
            None,
            "order.external_invoice_overdue",
            order_id,
            serde_json::json!({
                "external_invoice_id": external_invoice_id,
                "external_invoice_number": external_invoice_number,
                "patient_id": patient_id,
                "due_date": due_date.to_string(),
            }),
        )
        .await;
    }

    Ok(summary)
}

pub fn spawn_external_invoice_deadline_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            EXTERNAL_INVOICE_CHECK_INTERVAL_SECS,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;

        loop {
            interval.tick().await;
            match run_external_invoice_deadline_scheduler_once(&state).await {
                Ok(summary) => {
                    if summary.overdue_marked > 0 || summary.notifications_created > 0 {
                        tracing::info!(
                            overdue_marked = summary.overdue_marked,
                            notifications_created = summary.notifications_created,
                            "External invoice deadline scheduler applied updates"
                        );
                    }
                }
                Err(error) => {
                    tracing::error!(error = %error, "External invoice deadline scheduler failed");
                }
            }
        }
    });
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate patient access")
        })?;

    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn can_access_order(
    state: &AppState,
    auth: &AuthUser,
    order_id: Uuid,
    patient_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::Billing) {
        return Ok(true);
    }

    let Some(patient_id) = patient_id else {
        let row = sqlx::query("SELECT patient_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, order_id = %order_id, "Failed to load order access context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate order access")
            })?;

        let Some(row) = row else {
            return Ok(false);
        };

        let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode order access context",
            )
        })?;

        return access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, order_id = %order_id, "Failed to validate order assignment");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate order access")
            });
    };

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate order assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate order access")
        })
}
