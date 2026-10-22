//! `leads.citizenships` is the one source of a lead's citizenships
//! (2026-10-23): the migration moves a valid ISO code still standing only in
//! the legacy `wizard_state.registration_country` into the list and leaves
//! names, unknown codes and filled lists alone. It is re-runnable; this suite
//! writes the rows the way an older client left them and runs it again.
mod support;

use sqlx::PgPool;
use uuid::Uuid;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const BACKFILL: &str =
    include_str!("../../../migrations/20261023120500_lead_citizenships_single_source.sql");

async fn legacy_lead(
    pool: &PgPool,
    created_by: Uuid,
    citizenships: &[&str],
    registration_country: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, created_by, citizenships, wizard_state)
           VALUES ('Legacy', 'Citizen', $1, $2, $3, jsonb_build_object('registration_country', $4::text))
           RETURNING id"#,
    )
    .bind(format!("legacy-{}@example.test", Uuid::new_v4().simple()))
    .bind(created_by)
    .bind(
        citizenships
            .iter()
            .map(|code| code.to_string())
            .collect::<Vec<_>>(),
    )
    .bind(registration_country)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn citizenships(pool: &PgPool, lead_id: Uuid) -> Vec<String> {
    sqlx::query_scalar("SELECT citizenships FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn backfills_valid_legacy_codes_into_empty_citizenships() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = &ctx.pool;
    let code_only = legacy_lead(pool, ctx.admin_id, &[], " ua ").await;
    let name_only = legacy_lead(pool, ctx.admin_id, &[], "Ukraine").await;
    let unknown = legacy_lead(pool, ctx.admin_id, &[], "XX").await;
    let filled = legacy_lead(pool, ctx.admin_id, &["DE", "AT"], "PL").await;

    for _ in 0..2 {
        sqlx::raw_sql(BACKFILL).execute(pool).await.unwrap();
    }

    assert_eq!(citizenships(pool, code_only).await, ["UA"]);
    assert!(citizenships(pool, name_only).await.is_empty());
    assert!(citizenships(pool, unknown).await.is_empty());
    assert_eq!(citizenships(pool, filled).await, ["DE", "AT"]);
}
