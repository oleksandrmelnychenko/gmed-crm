use axum::{
    Json, Router,
    extract::{Extension, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new().route("/me/next-actions", get(list_my_next_actions))
}

async fn list_my_next_actions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let mut items = Vec::new();

    match load_recommendation_actions(&state, patient_id).await {
        Ok(mut rows) => items.append(&mut rows),
        Err(resp) => return resp,
    }
    match load_appointment_actions(&state, patient_id).await {
        Ok(mut rows) => items.append(&mut rows),
        Err(resp) => return resp,
    }
    match load_document_actions(&state, patient_id, auth.user_id).await {
        Ok(mut rows) => items.append(&mut rows),
        Err(resp) => return resp,
    }
    match load_invoice_actions(&state, patient_id).await {
        Ok(mut rows) => items.append(&mut rows),
        Err(resp) => return resp,
    }
    match load_package_actions(&state, patient_id).await {
        Ok(mut rows) => items.append(&mut rows),
        Err(resp) => return resp,
    }

    Json(json!({
        "items": items,
        "total": items.len(),
    }))
    .into_response()
}

async fn load_recommendation_actions(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Vec<Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, title, description, recommendation_type, due_at, priority, status,
                  patient_decision
           FROM patient_recommendations
           WHERE patient_id = $1
             AND portal_visible = true
             AND status = 'active'
           ORDER BY due_at NULLS LAST, created_at DESC
           LIMIT 10"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load recommendation next actions");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load next actions",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
            json!({
                "id": format!("recommendation:{id}"),
                "kind": "recommendation",
                "entity_type": "recommendation",
                "entity_id": id,
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "priority": row.try_get::<String, _>("priority").unwrap_or_else(|_| "normal".to_string()),
                "due_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("due_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "action_label": "Review recommendation",
                "action_url": "/recommendations",
                "metadata": {
                    "recommendation_type": row.try_get::<String, _>("recommendation_type").unwrap_or_default(),
                    "patient_decision": row.try_get::<Option<String>, _>("patient_decision").unwrap_or_default(),
                },
            })
        })
        .collect())
}

async fn load_appointment_actions(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Vec<Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, title, date, time_start, time_end, status, location, category
           FROM appointments
           WHERE patient_id = $1
             AND appointment_type <> 'internal'
             AND status IN ('planned', 'confirmed', 'in_progress')
             AND date >= current_date
           ORDER BY date ASC, time_start ASC NULLS LAST
           LIMIT 5"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load appointment next actions");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load next actions",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
            let date = row
                .try_get::<chrono::NaiveDate, _>("date")
                .map(|value| value.to_string())
                .unwrap_or_default();
            let time_start = row
                .try_get::<Option<chrono::NaiveTime>, _>("time_start")
                .unwrap_or_default()
                .map(|value| value.format("%H:%M").to_string());
            json!({
                "id": format!("appointment:{id}"),
                "kind": "upcoming_appointment",
                "entity_type": "appointment",
                "entity_id": id,
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "description": row.try_get::<Option<String>, _>("location").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "priority": "normal",
                "due_at": match &time_start {
                    Some(time) => format!("{date}T{time}:00"),
                    None => date.clone(),
                },
                "action_label": "Open appointments",
                "action_url": "/appointments",
                "metadata": {
                    "date": date,
                    "time_start": time_start,
                    "time_end": row.try_get::<Option<chrono::NaiveTime>, _>("time_end").unwrap_or_default().map(|value| value.format("%H:%M").to_string()),
                    "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                },
            })
        })
        .collect())
}

async fn load_document_actions(
    state: &AppState,
    patient_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT d.id, d.auto_name, d.category, d.art, ds.shared_at
           FROM documents d
           JOIN document_shares ds
             ON ds.document_id = d.id
            AND ds.shared_with_user_id = $2
            AND ds.revoked_at IS NULL
           WHERE d.patient_id = $1
             AND d.visibility = 'patient_visible'
             AND ds.requires_confirmation = true
             AND ds.confirmed = false
           ORDER BY ds.shared_at ASC
           LIMIT 10"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load document next actions");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load next actions",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
            json!({
                "id": format!("document_confirmation:{id}"),
                "kind": "document_confirmation",
                "entity_type": "document",
                "entity_id": id,
                "title": row.try_get::<String, _>("auto_name").unwrap_or_default(),
                "description": "Please confirm receipt of this document.",
                "status": "pending",
                "priority": "normal",
                "due_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("shared_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "action_label": "Open documents",
                "action_url": "/documents",
                "metadata": {
                    "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                    "art": row.try_get::<String, _>("art").unwrap_or_default(),
                },
            })
        })
        .collect())
}

async fn load_invoice_actions(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Vec<Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, invoice_number, status, due_date, total_gross, paid_amount,
                  portal_visible, hide_amounts_from_patient, pdf_visible_to_patient
           FROM invoices
           WHERE patient_id = $1
             AND portal_visible = true
             AND hide_amounts_from_patient = false
             AND status IN ('sent', 'partially_paid', 'overdue')
             AND (total_gross - paid_amount) > 0
           ORDER BY due_date ASC NULLS LAST, issued_at DESC
           LIMIT 10"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load invoice next actions");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load next actions",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let id = row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil());
            let total = row
                .try_get::<Decimal, _>("total_gross")
                .unwrap_or(Decimal::ZERO);
            let paid = row
                .try_get::<Decimal, _>("paid_amount")
                .unwrap_or(Decimal::ZERO);
            let balance = (total - paid).max(Decimal::ZERO);
            let due_date = row
                .try_get::<Option<chrono::NaiveDate>, _>("due_date")
                .unwrap_or_default()
                .map(|value| value.to_string());
            let pdf_visible = row
                .try_get::<bool, _>("portal_visible")
                .unwrap_or(false)
                && !row
                    .try_get::<bool, _>("hide_amounts_from_patient")
                    .unwrap_or(true)
                && row
                    .try_get::<bool, _>("pdf_visible_to_patient")
                    .unwrap_or(false);
            json!({
                "id": format!("invoice:{id}"),
                "kind": "invoice_payment",
                "entity_type": "invoice",
                "entity_id": id,
                "title": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                "description": "Outstanding invoice balance.",
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "priority": if row.try_get::<String, _>("status").unwrap_or_default() == "overdue" { "high" } else { "normal" },
                "due_at": due_date,
                "action_label": "Open invoices",
                "action_url": "/invoices",
                "amount": balance.round_dp(2).normalize().to_string(),
                "currency": "EUR",
                "metadata": {
                    "pdf_action_visible": pdf_visible,
                },
            })
        })
        .collect())
}

async fn load_package_actions(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Vec<Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT psp.id AS patient_service_package_id,
                  psp.package_id,
                  sp.name AS package_name,
                  spi.id AS package_item_id,
                  spi.description,
                  spi.included_quantity,
                  COALESCE(spi.requires_patient_approval, false) AS requires_patient_approval,
                  COALESCE(SUM(spc.quantity), 0) AS used_quantity,
                  COALESCE(SUM(spc.overage_quantity), 0) AS overage_quantity,
                  COALESCE(bool_or(spc.approval_status = 'pending'), false) AS pending_approval
           FROM patient_service_packages psp
           JOIN service_packages sp ON sp.id = psp.package_id
           LEFT JOIN service_package_items spi ON spi.package_id = sp.id
           LEFT JOIN service_package_consumptions spc
                  ON spc.patient_service_package_id = psp.id
                 AND (spc.package_item_id = spi.id OR (spc.package_item_id IS NULL AND spi.id IS NULL))
           WHERE psp.patient_id = $1
             AND psp.status = 'active'
           GROUP BY psp.id, psp.package_id, sp.name, spi.id, spi.description,
                    spi.included_quantity, spi.requires_patient_approval
           HAVING COALESCE(bool_or(spc.approval_status = 'pending'), false)
              OR (
                   COALESCE(spi.requires_patient_approval, false) = true
                   AND COALESCE(SUM(spc.overage_quantity), 0) > 0
                 )
           ORDER BY psp.assigned_at DESC
           LIMIT 10"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load package next actions");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load next actions")
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let package_id = row
                .try_get::<Uuid, _>("package_id")
                .unwrap_or_else(|_| Uuid::nil());
            let patient_service_package_id = row
                .try_get::<Uuid, _>("patient_service_package_id")
                .unwrap_or_else(|_| Uuid::nil());
            let included = row
                .try_get::<Decimal, _>("included_quantity")
                .unwrap_or(Decimal::ZERO);
            let used = row
                .try_get::<Decimal, _>("used_quantity")
                .unwrap_or(Decimal::ZERO);
            let remaining = (included - used).max(Decimal::ZERO);
            let overage = row
                .try_get::<Decimal, _>("overage_quantity")
                .unwrap_or(Decimal::ZERO);
            json!({
                "id": format!("package_approval:{patient_service_package_id}:{package_id}"),
                "kind": "package_approval",
                "entity_type": "service_package",
                "entity_id": package_id,
                "title": row.try_get::<String, _>("package_name").unwrap_or_default(),
                "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                "status": "pending",
                "priority": "normal",
                "due_at": null,
                "action_label": "Contact care team",
                "action_url": "/chat",
                "metadata": {
                    "patient_service_package_id": patient_service_package_id,
                    "package_id": package_id,
                    "package_item_id": row.try_get::<Option<Uuid>, _>("package_item_id").unwrap_or_default(),
                    "package_name": row.try_get::<String, _>("package_name").unwrap_or_default(),
                    "included_quantity": included.round_dp(2).normalize().to_string(),
                    "used_quantity": used.round_dp(2).normalize().to_string(),
                    "remaining_quantity": remaining.round_dp(2).normalize().to_string(),
                    "overage_quantity": overage.round_dp(2).normalize().to_string(),
                    "requires_patient_approval": row.try_get::<bool, _>("requires_patient_approval").unwrap_or(false),
                    "pending_approval": row.try_get::<bool, _>("pending_approval").unwrap_or(false),
                },
            })
        })
        .collect())
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error").to_lowercase(),
            "message": message,
        })),
    )
        .into_response()
}
