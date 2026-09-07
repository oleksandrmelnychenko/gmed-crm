use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

/// Staff-only payment notices. A durable snapshot deduplicates unchanged states;
/// no state in this tracker prevents conversion, booking, or execution.
pub async fn sync_notifications(
    state: &AppState,
    order_id: Option<Uuid>,
) -> Result<u64, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(20260907, 2050)")
        .fetch_one(&mut *tx)
        .await?;
    if !locked {
        return Ok(0);
    }
    let changes = sqlx::query(
        r#"SELECT tracking.*, previous.payment_status AS previous_status
           FROM order_payment_tracking tracking
           LEFT JOIN order_payment_notification_state previous ON previous.order_id=tracking.order_id
           WHERE ($1::uuid IS NULL OR tracking.order_id=$1)
             AND (tracking.signed OR tracking.received_amount > 0 OR previous.order_id IS NOT NULL)
             AND (previous.order_id IS NULL
               OR previous.payment_status IS DISTINCT FROM tracking.payment_status
               OR previous.required_amount IS DISTINCT FROM tracking.required_amount
               OR previous.received_amount IS DISTINCT FROM tracking.received_amount
               OR previous.due_at IS DISTINCT FROM tracking.prepayment_due_at
               OR previous.signed IS DISTINCT FROM tracking.signed)"#,
    ).bind(order_id).fetch_all(&mut *tx).await?;
    let mut deliveries = Vec::new();
    let mut changed_orders = Vec::new();
    for row in changes {
        let order: Uuid = row.try_get("order_id")?;
        let status: String = row.try_get("payment_status")?;
        let previous: Option<String> = row.try_get("previous_status")?;
        let required: Decimal = row.try_get("required_amount")?;
        let received: Decimal = row.try_get("received_amount")?;
        let remaining: Decimal = row.try_get("remaining_amount")?;
        let due: Option<chrono::DateTime<chrono::Utc>> = row.try_get("prepayment_due_at")?;
        let signed: bool = row.try_get("signed")?;
        changed_orders.push((order, row.try_get::<Option<Uuid>, _>("source_lead_id")?));
        // On first rollout, seed settled/unrequired orders silently. Pending
        // signed orders and subsequent changes are actionable for finance.
        if previous.is_some()
            || !matches!(status.as_str(), "paid" | "not_required")
            || (order_id.is_some() && received > Decimal::ZERO)
        {
            let body = serde_json::json!({
                "order_number": row.try_get::<String,_>("order_number")?,
                "payment_status": status,
                "required_amount": required.normalize().to_string(),
                "received_amount": received.normalize().to_string(),
                "remaining_amount": remaining.normalize().to_string(),
                "currency": row.try_get::<String,_>("currency")?,
                "due_at": due.map(|date| date.to_rfc3339()),
            })
            .to_string();
            let notifications = sqlx::query(
                r#"INSERT INTO user_notifications(user_id,kind,title,body,entity_type,entity_id)
                   SELECT recipient.id,'order_payment_status','Payment status updated',$2,'order',$1
                   FROM users recipient
                   WHERE recipient.is_active AND (
                     recipient.role IN ('ceo','billing')
                     OR (recipient.role='patient_manager' AND EXISTS (
                       SELECT 1 FROM patient_assignments assignment JOIN orders o ON o.patient_id=assignment.patient_id
                       WHERE o.id=$1 AND assignment.user_id=recipient.id AND assignment.revoked_at IS NULL))
                     OR (recipient.role='patient_manager' AND EXISTS (
                       SELECT 1 FROM orders o JOIN leads lead ON lead.id=o.source_lead_id
                       WHERE o.id=$1 AND lead.created_by=recipient.id))
                   ) RETURNING id,user_id"#,
            ).bind(order).bind(body).fetch_all(&mut *tx).await?;
            for notification in notifications {
                deliveries.push((
                    notification.try_get::<Uuid, _>("id")?,
                    notification.try_get::<Uuid, _>("user_id")?,
                    order,
                ));
            }
        }
        sqlx::query(
            r#"INSERT INTO order_payment_notification_state(order_id,payment_status,required_amount,received_amount,due_at,signed)
               VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id) DO UPDATE SET
               payment_status=EXCLUDED.payment_status,required_amount=EXCLUDED.required_amount,
               received_amount=EXCLUDED.received_amount,due_at=EXCLUDED.due_at,signed=EXCLUDED.signed,updated_at=now()"#,
        ).bind(order).bind(status).bind(required).bind(received).bind(due).bind(signed).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    for (order, lead) in changed_orders {
        crate::realtime::publish_order_event(
            state,
            None,
            "order.payment_status_changed",
            order,
            serde_json::json!({}),
        )
        .await;
        if let Some(lead) = lead {
            crate::realtime::publish_lead_event(
                state,
                None,
                "lead.payment_status_changed",
                lead,
                serde_json::json!({}),
            )
            .await;
        }
    }
    for (notification, user, order) in &deliveries {
        crate::realtime::publish_notification_event(
            state,
            *user,
            "notification.created",
            Some(*notification),
            serde_json::json!({"entity_type":"order","entity_id":order}),
        )
        .await;
    }
    Ok(deliveries.len() as u64)
}

pub fn spawn_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = sync_notifications(&state, None).await {
                tracing::error!(%error,"synchronize order payment notifications");
            }
        }
    });
}
