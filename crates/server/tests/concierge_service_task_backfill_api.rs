//! The 2026-09-28 repairs of concierge services and their tasks: services
//! follow their tasks (Q1) and patient-portal tasks get a staff author (Q15).
//! The migrations are re-runnable; this suite writes inconsistent rows the
//! way the old code left them (triggers off) and runs them again.
mod support;

use sqlx::PgPool;
use uuid::Uuid;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const FOLLOWS_TASK: &str =
    include_str!("../../../migrations/20260928212000_concierge_service_follows_task.sql");
const AUTHOR_NOT_PATIENT: &str =
    include_str!("../../../migrations/20260928212100_concierge_task_author_not_patient.sql");

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("backfill-{role}-{tag}@example.test"))
    .bind(format!("Backfill {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A service and its task written without the derivation triggers.
async fn legacy_pair(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    assignee: Uuid,
    service_status: &str,
    task_status: &str,
) -> (Uuid, Uuid) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL session_replication_role = replica")
        .execute(&mut *tx)
        .await
        .unwrap();
    let service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO concierge_services (
               patient_id, service_kind, title, status, billing_status, created_by
           ) VALUES ($1, 'transfer', 'Legacy transfer', $2, 'draft', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(service_status)
    .bind(created_by)
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    let task_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO tasks (
               title, assigned_to, assigned_by, patient_id, task_scope, task_kind,
               status, concierge_service_id, service_status, billing_status
           ) VALUES ('Legacy transfer', $1, $2, $3, 'general', 'task', $4, $5, $6, 'draft')
           RETURNING id"#,
    )
    .bind(assignee)
    .bind(created_by)
    .bind(patient_id)
    .bind(task_status)
    .bind(service_id)
    .bind(service_status)
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
    (service_id, task_id)
}

#[tokio::test]
async fn repairs_services_from_tasks_and_patient_authored_tasks() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &tag).await;
    let patient_user = seed_user(&ctx.pool, "patient", &tag).await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Backfill', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("BACKFILL-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(concierge_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    // Task done, service left planned: the service follows the task.
    let (stale_service, _) = legacy_pair(
        &ctx.pool,
        patient_id,
        concierge_id,
        concierge_id,
        "planned",
        "completed",
    )
    .await;
    // Service closed on its surface, task left open: the task follows.
    let (closed_service, open_task) = legacy_pair(
        &ctx.pool,
        patient_id,
        concierge_id,
        concierge_id,
        "cancelled",
        "open",
    )
    .await;
    // A portal request whose task the patient authored and is assigned.
    let (_, patient_task) = legacy_pair(
        &ctx.pool,
        patient_id,
        patient_user,
        patient_user,
        "planned",
        "open",
    )
    .await;

    sqlx::raw_sql(FOLLOWS_TASK)
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::raw_sql(AUTHOR_NOT_PATIENT)
        .execute(&ctx.pool)
        .await
        .unwrap();

    let stale: (String, String, bool) = sqlx::query_as(
        "SELECT status, billing_status, completed_at IS NOT NULL FROM concierge_services WHERE id = $1",
    )
    .bind(stale_service)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(stale, ("completed".to_string(), "ready".to_string(), true));

    let task_status: String = sqlx::query_scalar("SELECT status FROM tasks WHERE id = $1")
        .bind(open_task)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(task_status, "cancelled");
    let closed: (String, String) =
        sqlx::query_as("SELECT status, billing_status FROM concierge_services WHERE id = $1")
            .bind(closed_service)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(closed, ("cancelled".to_string(), "waived".to_string()));

    let author: (Uuid, Uuid) =
        sqlx::query_as("SELECT assigned_by, assigned_to FROM tasks WHERE id = $1")
            .bind(patient_task)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(author, (concierge_id, concierge_id));

    let audit: Vec<String> = sqlx::query_scalar(
        r#"SELECT action FROM audit_log
           WHERE entity_id = ANY($1)
           ORDER BY action"#,
    )
    .bind(vec![stale_service, open_task, patient_task])
    .fetch_all(&ctx.pool)
    .await
    .unwrap();
    assert!(audit.contains(&"derive_concierge_service_from_task".to_string()));
    assert!(audit.contains(&"close_concierge_task_of_closed_service".to_string()));
    assert!(audit.contains(&"replace_patient_task_author".to_string()));
    let history: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM concierge_operational_task_events WHERE task_id = ANY($1)",
    )
    .bind(vec![open_task, patient_task])
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(history, 2);

    // A second run changes nothing more.
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    sqlx::raw_sql(FOLLOWS_TASK)
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::raw_sql(AUTHOR_NOT_PATIENT)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(before, after);
}
