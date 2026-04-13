use axum::{Json, http::StatusCode, response::IntoResponse};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

pub(crate) struct OrderDebtManagementState {
    pub(crate) blocking: bool,
    pub(crate) blocking_reason: Option<String>,
    pub(crate) payload: Value,
}

pub(crate) struct PatientDebtManagementState {
    pub(crate) blocking: bool,
    pub(crate) blocking_reason: Option<String>,
    pub(crate) overdue_invoice_count: i64,
    pub(crate) outstanding_balance: Decimal,
    pub(crate) payload: Value,
}

pub(crate) fn is_valid_debt_management_status(value: &str) -> bool {
    matches!(
        value,
        "not_required"
            | "review_required"
            | "payment_plan"
            | "awaiting_payment"
            | "escalated"
            | "cleared"
    )
}

pub(crate) fn debt_status_is_open(value: &str) -> bool {
    matches!(
        value,
        "review_required" | "payment_plan" | "awaiting_payment" | "escalated"
    )
}

pub(crate) async fn ensure_order_debt_management_state(
    state: &AppState,
    order_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO order_debt_management (order_id)
           VALUES ($1)
           ON CONFLICT (order_id) DO NOTHING"#,
    )
    .bind(order_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "ensure order debt-management state");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load debt-management state",
        )
    })?;

    Ok(())
}

pub(crate) async fn load_order_debt_management_state(
    state: &AppState,
    order_id: Uuid,
    overdue_invoice_count: i64,
    outstanding_balance: Decimal,
) -> Result<OrderDebtManagementState, axum::response::Response> {
    ensure_order_debt_management_state(state, order_id).await?;

    let row = sqlx::query(
        r#"SELECT dm.status,
                  dm.note,
                  dm.owner_user_id,
                  owner_user.name AS owner_name,
                  dm.next_review_at,
                  dm.last_contact_at,
                  dm.resolution_note,
                  dm.resolved_at,
                  dm.resolved_by,
                  resolved_by_user.name AS resolved_by_name,
                  dm.created_at,
                  dm.updated_at
           FROM order_debt_management dm
           LEFT JOIN users owner_user ON owner_user.id = dm.owner_user_id
           LEFT JOIN users resolved_by_user ON resolved_by_user.id = dm.resolved_by
           WHERE dm.order_id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load order debt-management state");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load debt-management state",
        )
    })?;

    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "Order not found"));
    };

    let status: String = row
        .try_get("status")
        .unwrap_or_else(|_| "not_required".to_string());
    let effective_status = effective_status(&status, overdue_invoice_count);
    let blocking = overdue_invoice_count > 0 || debt_status_is_open(&effective_status);
    let blocking_reason = build_blocking_reason(
        &effective_status,
        overdue_invoice_count,
        row.try_get("next_review_at").ok().flatten(),
    );

    Ok(OrderDebtManagementState {
        blocking,
        blocking_reason: blocking_reason.clone(),
        payload: json!({
            "status": status,
            "effective_status": effective_status,
            "workflow_required": overdue_invoice_count > 0 || debt_status_is_open(&status),
            "blocking": blocking,
            "blocking_reason": blocking_reason,
            "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
            "owner_user_id": row.try_get::<Option<Uuid>, _>("owner_user_id").unwrap_or_default(),
            "owner_name": row.try_get::<Option<String>, _>("owner_name").unwrap_or_default(),
            "next_review_at": row.try_get::<Option<DateTime<Utc>>, _>("next_review_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "last_contact_at": row.try_get::<Option<DateTime<Utc>>, _>("last_contact_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "resolution_note": row.try_get::<Option<String>, _>("resolution_note").unwrap_or_default(),
            "resolved_at": row.try_get::<Option<DateTime<Utc>>, _>("resolved_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "resolved_by": row.try_get::<Option<Uuid>, _>("resolved_by").unwrap_or_default(),
            "resolved_by_name": row.try_get::<Option<String>, _>("resolved_by_name").unwrap_or_default(),
            "overdue_invoice_count": overdue_invoice_count,
            "outstanding_balance": decimal_to_string(outstanding_balance),
            "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        }),
    })
}

pub(crate) async fn load_patient_debt_management_state(
    state: &AppState,
    patient_id: Uuid,
) -> Result<PatientDebtManagementState, axum::response::Response> {
    let finance = sqlx::query(
        r#"SELECT
                COUNT(*) FILTER (
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
                ) AS outstanding_balance
           FROM invoices
           WHERE patient_id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load patient debt-management finance");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load debt-management state",
        )
    })?;

    let overdue_invoice_count = finance
        .try_get::<i64, _>("overdue_invoice_count")
        .unwrap_or_default();
    let outstanding_balance = finance
        .try_get::<Decimal, _>("outstanding_balance")
        .unwrap_or(Decimal::ZERO);

    let latest = sqlx::query(
        r#"SELECT dm.order_id,
                  o.order_number,
                  dm.status,
                  dm.note,
                  dm.owner_user_id,
                  owner_user.name AS owner_name,
                  dm.next_review_at,
                  dm.last_contact_at,
                  dm.resolution_note,
                  dm.resolved_at,
                  dm.resolved_by,
                  resolved_by_user.name AS resolved_by_name,
                  dm.updated_at,
                  (
                    SELECT COUNT(*)
                    FROM invoices i
                    WHERE i.order_id = dm.order_id
                      AND i.status = 'overdue'
                      AND i.total_gross > COALESCE(i.paid_amount, 0)
                  ) AS order_overdue_invoice_count,
                  (
                    SELECT COALESCE(
                        SUM(
                            CASE
                                WHEN i.status NOT IN ('paid', 'cancelled')
                                THEN GREATEST(i.total_gross - COALESCE(i.paid_amount, 0), 0)
                                ELSE 0
                            END
                        ),
                        0
                    )
                    FROM invoices i
                    WHERE i.order_id = dm.order_id
                  ) AS order_outstanding_balance
           FROM order_debt_management dm
           JOIN orders o ON o.id = dm.order_id
           LEFT JOIN users owner_user ON owner_user.id = dm.owner_user_id
           LEFT JOIN users resolved_by_user ON resolved_by_user.id = dm.resolved_by
           WHERE o.patient_id = $1
             AND (
                    dm.status <> 'not_required'
                    OR EXISTS (
                        SELECT 1
                        FROM invoices i
                        WHERE i.order_id = dm.order_id
                          AND i.status = 'overdue'
                          AND i.total_gross > COALESCE(i.paid_amount, 0)
                    )
                 )
           ORDER BY dm.updated_at DESC, o.created_at DESC
           LIMIT 1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load patient debt-management latest workflow");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load debt-management state",
        )
    })?;

    let latest_payload = latest.as_ref().map(|row| {
        let status: String = row
            .try_get("status")
            .unwrap_or_else(|_| "not_required".to_string());
        let order_overdue_invoice_count = row
            .try_get::<i64, _>("order_overdue_invoice_count")
            .unwrap_or_default();
        let order_outstanding_balance = row
            .try_get::<Decimal, _>("order_outstanding_balance")
            .unwrap_or(Decimal::ZERO);
        let effective_status = effective_status(&status, order_overdue_invoice_count);

        json!({
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
            "status": status,
            "effective_status": effective_status,
            "blocking": order_overdue_invoice_count > 0 || debt_status_is_open(&effective_status),
            "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
            "owner_user_id": row.try_get::<Option<Uuid>, _>("owner_user_id").unwrap_or_default(),
            "owner_name": row.try_get::<Option<String>, _>("owner_name").unwrap_or_default(),
            "next_review_at": row.try_get::<Option<DateTime<Utc>>, _>("next_review_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "last_contact_at": row.try_get::<Option<DateTime<Utc>>, _>("last_contact_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "resolution_note": row.try_get::<Option<String>, _>("resolution_note").unwrap_or_default(),
            "resolved_at": row.try_get::<Option<DateTime<Utc>>, _>("resolved_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "resolved_by": row.try_get::<Option<Uuid>, _>("resolved_by").unwrap_or_default(),
            "resolved_by_name": row.try_get::<Option<String>, _>("resolved_by_name").unwrap_or_default(),
            "updated_at": row.try_get::<Option<DateTime<Utc>>, _>("updated_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "overdue_invoice_count": order_overdue_invoice_count,
            "outstanding_balance": decimal_to_string(order_outstanding_balance),
        })
    });

    let latest_effective_status = latest.as_ref().map(|row| {
        let status: String = row
            .try_get("status")
            .unwrap_or_else(|_| "not_required".to_string());
        let order_overdue_invoice_count = row
            .try_get::<i64, _>("order_overdue_invoice_count")
            .unwrap_or_default();
        effective_status(&status, order_overdue_invoice_count)
    });

    let blocking = overdue_invoice_count > 0
        || latest_effective_status
            .as_deref()
            .map(debt_status_is_open)
            .unwrap_or(false);
    let blocking_reason = if overdue_invoice_count > 0 {
        Some(format!(
            "{overdue_invoice_count} overdue invoice(s) keep the patient in debt-management hold"
        ))
    } else if let Some(status) = latest_effective_status {
        build_blocking_reason(&status, 0, None)
    } else {
        None
    };

    Ok(PatientDebtManagementState {
        blocking,
        blocking_reason: blocking_reason.clone(),
        overdue_invoice_count,
        outstanding_balance,
        payload: json!({
            "blocking": blocking,
            "blocking_reason": blocking_reason,
            "overdue_invoice_count": overdue_invoice_count,
            "outstanding_balance": decimal_to_string(outstanding_balance),
            "latest_workflow": latest_payload,
        }),
    })
}

pub(crate) fn effective_status(status: &str, overdue_invoice_count: i64) -> String {
    if overdue_invoice_count > 0 && matches!(status, "not_required" | "cleared") {
        "review_required".to_string()
    } else {
        status.to_string()
    }
}

pub(crate) fn build_blocking_reason(
    status: &str,
    overdue_invoice_count: i64,
    next_review_at: Option<DateTime<Utc>>,
) -> Option<String> {
    if overdue_invoice_count == 0 && !debt_status_is_open(status) {
        return None;
    }

    let base = match status {
        "payment_plan" => {
            if overdue_invoice_count > 0 {
                format!("{overdue_invoice_count} overdue invoice(s) are in payment-plan handling")
            } else {
                "Debt-management payment plan is still open".to_string()
            }
        }
        "awaiting_payment" => {
            if overdue_invoice_count > 0 {
                format!(
                    "{overdue_invoice_count} overdue invoice(s) are awaiting payment confirmation"
                )
            } else {
                "Debt-management is still awaiting payment confirmation".to_string()
            }
        }
        "escalated" => {
            if overdue_invoice_count > 0 {
                format!(
                    "{overdue_invoice_count} overdue invoice(s) are in escalated debt-management"
                )
            } else {
                "Debt-management escalation is still open".to_string()
            }
        }
        _ => {
            if overdue_invoice_count > 0 {
                format!("{overdue_invoice_count} overdue invoice(s) require debt-management review")
            } else {
                "Debt-management review is still open".to_string()
            }
        }
    };

    Some(match next_review_at {
        Some(value) => format!("{base}; next review {}", value.to_rfc3339()),
        None => base,
    })
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}
