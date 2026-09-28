//! Dunning block (Mahnsperre) of an invoice.
//!
//! Billing or the CEO (`invoices.finance`) stops the automatic reminders and
//! the automatic overdue escalation of one invoice, with a reason; clearing
//! the block needs a reason too. Blocks are kept as history and audited in the
//! same transaction. While a block is active, manual reminders are refused as
//! well. Moving an overdue invoice back to `sent` sets a block, so the hourly
//! scheduler does not mark it overdue again.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::{
    can_manage_invoice_finance, ensure_patient_access, err, load_invoice_detail,
    write_invoice_audit_tx,
};
use crate::auth::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize)]
pub(super) struct DunningBlockRequest {
    reason: String,
}

/// A block or clearing reason: 3 to 1000 characters.
pub(super) fn normalize_block_reason(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    (3..=1000)
        .contains(&value.chars().count())
        .then(|| value.to_string())
}

/// Whether the invoice has an active dunning block.
pub(super) async fn is_blocked(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM invoice_dunning_blocks WHERE invoice_id = $1 AND cleared_at IS NULL)",
    )
    .bind(invoice_id)
    .fetch_one(conn)
    .await
}

/// Sets a block inside the caller's transaction; `None` when the invoice is
/// already blocked.
pub(super) async fn set_block_tx(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    reason: &str,
    actor: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"INSERT INTO invoice_dunning_blocks (invoice_id, reason, blocked_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (invoice_id) WHERE cleared_at IS NULL DO NOTHING
           RETURNING id"#,
    )
    .bind(invoice_id)
    .bind(reason)
    .bind(actor)
    .fetch_optional(conn)
    .await
}

/// The active block and the history of an invoice, for the invoice detail.
pub(super) async fn load_dunning_block_state(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Value, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT block.id, block.reason, block.blocked_at, block.cleared_at, block.clear_reason,
                  blocker.name AS blocked_by_name, clearer.name AS cleared_by_name
           FROM invoice_dunning_blocks block
           LEFT JOIN users blocker ON blocker.id = block.blocked_by
           LEFT JOIN users clearer ON clearer.id = block.cleared_by
           WHERE block.invoice_id = $1
           ORDER BY block.blocked_at DESC, block.id"#,
    )
    .bind(invoice_id)
    .fetch_all(conn)
    .await?;
    let items = rows
        .iter()
        .map(|row| {
            let time = |column: &str| {
                row.try_get::<Option<DateTime<Utc>>, _>(column)
                    .unwrap_or_default()
                    .map(|value| value.to_rfc3339())
            };
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "reason": row.try_get::<String, _>("reason").unwrap_or_default(),
                "blocked_at": time("blocked_at"),
                "blocked_by_name": row.try_get::<Option<String>, _>("blocked_by_name").unwrap_or_default(),
                "cleared_at": time("cleared_at"),
                "cleared_by_name": row.try_get::<Option<String>, _>("cleared_by_name").unwrap_or_default(),
                "clear_reason": row.try_get::<Option<String>, _>("clear_reason").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    let active = items
        .iter()
        .find(|item| item["cleared_at"].is_null())
        .cloned();
    Ok(json!({ "active": active, "history": items }))
}

async fn locked_invoice(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<(Uuid, String, bool)>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT patient_id, status, released_at IS NOT NULL AS released FROM invoices WHERE id = $1 FOR UPDATE",
    )
    .bind(invoice_id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| {
        (
            row.try_get("patient_id").unwrap_or_default(),
            row.try_get("status").unwrap_or_default(),
            row.try_get("released").unwrap_or(false),
        )
    }))
}

async fn change_block(
    state: AppState,
    auth: AuthUser,
    invoice_id: Uuid,
    body: DunningBlockRequest,
    set: bool,
) -> axum::response::Response {
    if !can_manage_invoice_finance(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let Some(reason) = normalize_block_reason(Some(&body.reason)) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A reason of 3 to 1000 characters is required",
        );
    };
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %invoice_id, set, "change dunning block");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to change the dunning block",
        )
    };
    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => return failed(error),
    };
    let (patient_id, status, released) = match locked_invoice(&mut transaction, invoice_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => return failed(error),
    };
    if let Err(response) = ensure_patient_access(&state, &auth, patient_id).await {
        return response;
    }
    let (action, block_id) = if set {
        if !released || status == "cancelled" {
            return err(
                StatusCode::CONFLICT,
                "Only an issued, active invoice can be blocked for dunning",
            );
        }
        match set_block_tx(&mut transaction, invoice_id, &reason, auth.user_id).await {
            Ok(Some(id)) => ("set_invoice_dunning_block", id),
            Ok(None) => return err(StatusCode::CONFLICT, "Dunning is already blocked"),
            Err(error) => return failed(error),
        }
    } else {
        match sqlx::query_scalar::<_, Uuid>(
            r#"UPDATE invoice_dunning_blocks
               SET cleared_at = now(), cleared_by = $2, clear_reason = $3
               WHERE invoice_id = $1 AND cleared_at IS NULL
               RETURNING id"#,
        )
        .bind(invoice_id)
        .bind(auth.user_id)
        .bind(&reason)
        .fetch_optional(&mut *transaction)
        .await
        {
            Ok(Some(id)) => ("clear_invoice_dunning_block", id),
            Ok(None) => return err(StatusCode::CONFLICT, "Dunning is not blocked"),
            Err(error) => return failed(error),
        }
    };
    let payload = json!({
        "dunning_block_id": block_id,
        "reason": reason,
        "patient_id": patient_id,
        "invoice_status": status,
    });
    if let Err(error) =
        write_invoice_audit_tx(&mut transaction, auth.user_id, action, invoice_id, payload).await
    {
        return failed(error);
    }
    if let Err(error) = transaction.commit().await {
        return failed(error);
    }
    crate::realtime::publish_invoice_event(
        &state,
        Some(auth.user_id),
        if set {
            "invoice.dunning_blocked"
        } else {
            "invoice.dunning_unblocked"
        },
        invoice_id,
        // The reason is staff working context; the event only says what changed.
        json!({ "dunning_block_id": block_id, "patient_id": patient_id }),
    )
    .await;
    match load_invoice_detail(&state, invoice_id, &auth).await {
        Ok(Some(invoice)) => Json(invoice).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(response) => response,
    }
}

pub(super) async fn set_dunning_block(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<DunningBlockRequest>,
) -> axum::response::Response {
    change_block(state, auth, invoice_id, body, true).await
}

pub(super) async fn clear_dunning_block(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<DunningBlockRequest>,
) -> axum::response::Response {
    change_block(state, auth, invoice_id, body, false).await
}

#[cfg(test)]
mod tests {
    use super::normalize_block_reason;

    #[test]
    fn block_reasons_need_three_to_thousand_characters() {
        assert_eq!(normalize_block_reason(Some("  ok ")), None);
        assert_eq!(
            normalize_block_reason(Some(" Ratenzahlung ")),
            Some("Ratenzahlung".to_string())
        );
        assert_eq!(normalize_block_reason(Some(&"x".repeat(1001))), None);
        assert_eq!(normalize_block_reason(None), None);
    }
}
