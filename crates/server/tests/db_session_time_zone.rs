mod support;

use chrono::NaiveDate;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

/// Triggers and queries compare dates with `CURRENT_DATE`, the server with
/// `app_time::today()`. Both must be the German calendar day, also between
/// midnight in Germany and midnight UTC.
#[tokio::test]
async fn database_sessions_run_in_german_time() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };

    let (zone, local_day): (String, NaiveDate) = sqlx::query_as(
        "SELECT current_setting('TimeZone'), (TIMESTAMPTZ '2026-10-01 22:30:00+00')::date",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    assert_eq!(zone, gmed_db::SESSION_TIME_ZONE);
    assert_eq!(local_day, NaiveDate::from_ymd_opt(2026, 10, 2).unwrap());
}
