//! The 2026-11-14 repair of legacy cancelled orders (QA F05/F10) and the
//! `orders_cancelled_at_consistent` constraint it adds.
//!
//! Migrations run before the suite, so the legacy shapes cannot exist any
//! more. The migration only touches inconsistent rows and re-adds its
//! constraint with `DROP CONSTRAINT IF EXISTS`, so it is re-runnable: this
//! suite drops the constraint in its own disposable database, writes the rows
//! the old code left behind, runs the very same migration file again and
//! checks the repaired rows, their audit rows and the validated constraint.
mod support;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const REPAIR: &str =
    include_str!("../../../migrations/20261114120001_cancelled_order_consistency.sql");
const REPAIR_KEY: &str = "20261114120001_cancelled_order_consistency";

fn at(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("cancel-repair-{role}-{tag}@example.test"))
    .bind(format!("Cancel repair {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// An order written directly, the way legacy code and manual edits left it.
#[allow(clippy::too_many_arguments)]
async fn legacy_order(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    number: String,
    status: &str,
    cancelled_at: Option<DateTime<Utc>>,
    cancelled_by: Option<Uuid>,
    cancellation_reason: Option<&str>,
    updated_at: DateTime<Utc>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, needs_description, created_by,
               cancelled_at, cancelled_by, cancellation_reason, updated_at
           ) VALUES ($1, $2, 'execution', $3, 'Synthetic needs', $4, $5, $6, $7, $8)
           RETURNING id"#,
    )
    .bind(number)
    .bind(patient_id)
    .bind(status)
    .bind(created_by)
    .bind(cancelled_at)
    .bind(cancelled_by)
    .bind(cancellation_reason)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_line(pool: &PgPool, order_id: Uuid, patient_id: Uuid, status: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (order_id, patient_id, description, quantity, unit_price,
                                        vat_rate, status)
           VALUES ($1, $2, 'Synthetic service', 1.0, 100.0, 19.0, $3)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(status)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// An order checklist item with its linked task.
async fn seed_item_with_task(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    owner: Uuid,
    item_key: &str,
    completed: bool,
) -> (Uuid, Uuid) {
    let task_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO tasks (title, assigned_to, assigned_by, patient_id, order_id, priority, status)
           VALUES ($1, $2, $2, $3, $4, 'normal', CASE WHEN $5 THEN 'completed' ELSE 'open' END)
           RETURNING id"#,
    )
    .bind(format!("Checklist task {item_key}"))
    .bind(owner)
    .bind(patient_id)
    .bind(order_id)
    .bind(completed)
    .fetch_one(pool)
    .await
    .unwrap();
    let item_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO workflow_checklist_items (
               scope_type, scope_id, patient_id, order_id, checklist_key, item_key, item_text,
               owner_role, owner_user_id, created_by, linked_task_id,
               is_completed, completed_by, completed_at, sort_order
           ) VALUES (
               'order', $1, $2, $1, 'order_execution', $3, $4,
               'patient_manager', $5, $5, $6,
               $7, CASE WHEN $7 THEN $5 ELSE NULL END, CASE WHEN $7 THEN now() ELSE NULL END, 1
           )
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(item_key)
    .bind(format!("Checklist item {item_key}"))
    .bind(owner)
    .bind(task_id)
    .bind(completed)
    .fetch_one(pool)
    .await
    .unwrap();
    (item_id, task_id)
}

async fn order_state(
    pool: &PgPool,
    order_id: Uuid,
) -> (String, Option<DateTime<Utc>>, Option<Uuid>, Option<String>) {
    sqlx::query_as(
        "SELECT status, cancelled_at, cancelled_by, cancellation_reason FROM orders WHERE id = $1",
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn repair_audit(pool: &PgPool, action: &str, entity_id: Uuid) -> Vec<(Option<Uuid>, Value)> {
    sqlx::query_as(
        r#"SELECT user_id, context FROM audit_log
           WHERE action = $1 AND entity_id = $2 AND context->>'repair' = $3
           ORDER BY id"#,
    )
    .bind(action)
    .bind(entity_id)
    .bind(REPAIR_KEY)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn line_status(pool: &PgPool, line_id: Uuid) -> (String, Option<DateTime<Utc>>) {
    sqlx::query_as("SELECT status, cancelled_at FROM order_leistungen WHERE id = $1")
        .bind(line_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn repairs_legacy_cancelled_orders_and_adds_the_consistency_constraint() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = &ctx.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let manager = seed_user(pool, "patient_manager", &tag).await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Repair', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("CANCEL-REPAIR-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();

    // The migrations already added the constraint, validated.
    let validated: bool = sqlx::query_scalar(
        "SELECT convalidated FROM pg_constraint WHERE conname = 'orders_cancelled_at_consistent'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(validated);
    sqlx::query("ALTER TABLE orders DROP CONSTRAINT orders_cancelled_at_consistent")
        .execute(pool)
        .await
        .unwrap();

    // (a1) Cancelled without cancelled_at, cancelled by the old status change.
    let audited = legacy_order(
        pool,
        patient_id,
        manager,
        format!("ORD-A1-{tag}"),
        "cancelled",
        None,
        None,
        None,
        at("2026-09-10T12:00:00Z"),
    )
    .await;
    let cancelling_audit_id: i64 = sqlx::query_scalar(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context, created_at)
           VALUES ($1, 'update_order_status', 'order', $2,
                   '{"from_status": "active", "status": "cancelled", "phase": "execution"}'::jsonb,
                   '2026-09-01T08:00:00Z')
           RETURNING id"#,
    )
    .bind(manager)
    .bind(audited)
    .fetch_one(pool)
    .await
    .unwrap();
    // (a2) Cancelled without cancelled_at and without an audit row (the
    // repeat-intake trigger): the last update is the best known time.
    let unaudited = legacy_order(
        pool,
        patient_id,
        manager,
        format!("ORD-A2-{tag}"),
        "cancelled",
        None,
        None,
        None,
        at("2026-09-05T10:00:00Z"),
    )
    .await;
    // (b) cancelled_at on an active order (manual database edit).
    let stale = legacy_order(
        pool,
        patient_id,
        manager,
        format!("ORD-B-{tag}"),
        "active",
        Some(at("2026-10-01T09:00:00Z")),
        Some(manager),
        Some("Synthetic manual edit"),
        at("2026-10-01T09:00:00Z"),
    )
    .await;
    // (c) Cancelled with a planned line, an open checklist item and its open
    // task, next to a delivered line and a completed item that stay as they are.
    let leftovers = legacy_order(
        pool,
        patient_id,
        manager,
        format!("ORD-C-{tag}"),
        "cancelled",
        Some(at("2026-09-20T15:00:00Z")),
        Some(manager),
        Some("Patient withdrew"),
        at("2026-09-20T15:00:00Z"),
    )
    .await;
    let planned_line = seed_line(pool, leftovers, patient_id, "planned").await;
    let delivered_line = seed_line(pool, leftovers, patient_id, "delivered").await;
    let (open_item, open_task) =
        seed_item_with_task(pool, leftovers, patient_id, manager, "open_item", false).await;
    let (done_item, done_task) =
        seed_item_with_task(pool, leftovers, patient_id, manager, "done_item", true).await;
    // A running order with the same leftovers is not touched.
    let running = legacy_order(
        pool,
        patient_id,
        manager,
        format!("ORD-RUN-{tag}"),
        "active",
        None,
        None,
        None,
        at("2026-09-20T15:00:00Z"),
    )
    .await;
    let running_line = seed_line(pool, running, patient_id, "planned").await;
    let (running_item, running_task) =
        seed_item_with_task(pool, running, patient_id, manager, "running_item", false).await;

    sqlx::raw_sql(REPAIR).execute(pool).await.unwrap();

    // (a1) from the cancelling audit row, which stays unchanged.
    assert_eq!(
        order_state(pool, audited).await,
        (
            "cancelled".to_string(),
            Some(at("2026-09-01T08:00:00Z")),
            None,
            None
        )
    );
    let audit = repair_audit(pool, "repair_order_cancelled_at", audited).await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].0, None, "system actor");
    assert_eq!(audit[0].1["cancelled_at_source"], "audit_log");
    assert_eq!(audit[0].1["source_audit_id"], cancelling_audit_id);
    let original: (String, Value, DateTime<Utc>) =
        sqlx::query_as("SELECT action, context, created_at FROM audit_log WHERE id = $1")
            .bind(cancelling_audit_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(original.0, "update_order_status");
    assert_eq!(original.1["status"], "cancelled");
    assert_eq!(original.2, at("2026-09-01T08:00:00Z"));

    // (a2) from the order's last update.
    assert_eq!(
        order_state(pool, unaudited).await.1,
        Some(at("2026-09-05T10:00:00Z"))
    );
    let audit = repair_audit(pool, "repair_order_cancelled_at", unaudited).await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].1["cancelled_at_source"], "order_updated_at");
    assert!(audit[0].1["source_audit_id"].is_null());

    // (b) the status wins; the old values are kept in the audit.
    assert_eq!(
        order_state(pool, stale).await,
        ("active".to_string(), None, None, None)
    );
    let audit = repair_audit(pool, "repair_order_clear_cancelled_at", stale).await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].0, None);
    assert_eq!(audit[0].1["status"], "active");
    assert_eq!(audit[0].1["previous_cancelled_by"], manager.to_string());
    assert_eq!(audit[0].1["previous_reason"], "Synthetic manual edit");
    let previous_at: DateTime<Utc> = audit[0].1["previous_cancelled_at"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(previous_at, at("2026-10-01T09:00:00Z"));

    // (c) the planned line is cancelled (columns empty, as for a termination),
    // the delivered one stays.
    assert_eq!(
        line_status(pool, planned_line).await,
        ("cancelled".to_string(), None)
    );
    assert_eq!(line_status(pool, delivered_line).await.0, "delivered");
    let audit = repair_audit(pool, "repair_cancel_planned_order_service", leftovers).await;
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].1["order_leistung_id"], planned_line.to_string());

    // The open item is resolved by the canceller at the cancellation time.
    let item: (
        bool,
        bool,
        Option<String>,
        Option<Uuid>,
        Option<DateTime<Utc>>,
    ) = sqlx::query_as(
        r#"SELECT is_completed, not_required, not_required_reason, completed_by, completed_at
           FROM workflow_checklist_items WHERE id = $1"#,
    )
    .bind(open_item)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        item,
        (
            true,
            true,
            Some("order_cancelled".to_string()),
            Some(manager),
            Some(at("2026-09-20T15:00:00Z"))
        )
    );
    let item_audit: Vec<Value> = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'workflow_checklist_item_not_required'
             AND entity_type = 'patient' AND entity_id = $1
             AND context->>'repair' = $2"#,
    )
    .bind(patient_id)
    .bind(REPAIR_KEY)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(item_audit.len(), 1, "{item_audit:?}");
    assert_eq!(item_audit[0]["checklist_item_id"], open_item.to_string());
    assert_eq!(item_audit[0]["task_id"], open_task.to_string());

    // Its open task is cancelled with a history entry and an audit row.
    let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = $1")
        .bind(open_task)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(task_status, "cancelled");
    let history: Vec<Value> = sqlx::query_scalar(
        "SELECT payload FROM concierge_operational_task_events WHERE task_id = $1",
    )
    .bind(open_task)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["previous_status"], "open");
    assert_eq!(history[0]["not_required_reason"], "order_cancelled");
    let task_audit =
        repair_audit(pool, "update_concierge_operational_item_status", open_task).await;
    assert_eq!(task_audit.len(), 1);
    assert_eq!(task_audit[0].1["previous_status"], "open");

    // Completed work of the cancelled order and the running order stay.
    let done: (bool, Option<String>) = sqlx::query_as(
        "SELECT not_required, not_required_reason FROM workflow_checklist_items WHERE id = $1",
    )
    .bind(done_item)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(done, (false, None));
    let running_item_open: bool =
        sqlx::query_scalar("SELECT NOT is_completed FROM workflow_checklist_items WHERE id = $1")
            .bind(running_item)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(running_item_open);
    let task_statuses: Vec<String> =
        sqlx::query_scalar("SELECT status FROM tasks WHERE id = ANY($1) ORDER BY status")
            .bind(vec![done_task, running_task])
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(task_statuses, vec!["completed", "open"]);
    assert_eq!(line_status(pool, running_line).await.0, "planned");
    assert_eq!(
        order_state(pool, running).await,
        ("active".to_string(), None, None, None)
    );

    // The constraint is back and validated; a status change without its
    // cancelled_at is refused.
    let validated: bool = sqlx::query_scalar(
        "SELECT convalidated FROM pg_constraint WHERE conname = 'orders_cancelled_at_consistent'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(validated);
    for sql in [
        "UPDATE orders SET status = 'cancelled' WHERE id = $1",
        "UPDATE orders SET cancelled_at = now() WHERE id = $1",
    ] {
        let error = sqlx::query(sql)
            .bind(running)
            .execute(pool)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23514"),
            "{sql}"
        );
    }

    // A second run changes nothing more.
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::raw_sql(REPAIR).execute(pool).await.unwrap();
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(before, after);
}
