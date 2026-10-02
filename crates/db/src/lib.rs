use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::str::FromStr;
use std::time::Duration;

pub type DbPool = sqlx::PgPool;

/// GMed works in German time only. Every session uses this zone so that
/// `CURRENT_DATE`, `timestamptz::date`, `date_trunc` and naive appointment
/// times compared with `now()` follow the German calendar day, not the
/// server's UTC day. Stored `timestamptz` values are unaffected.
pub const SESSION_TIME_ZONE: &str = "Europe/Berlin";

/// Pool options that apply the GMed session settings to every connection.
///
/// The zone is set after connecting: sqlx sends `TimeZone=UTC` in the startup
/// packet and PostgreSQL applies it after the `options` string, so a
/// `-c TimeZone=…` connect option never takes effect.
pub fn pool_options() -> PgPoolOptions {
    PgPoolOptions::new().after_connect(|connection, _meta| {
        Box::pin(async move {
            sqlx::query("SELECT set_config('TimeZone', $1, false)")
                .bind(SESSION_TIME_ZONE)
                .execute(&mut *connection)
                .await?;
            Ok(())
        })
    })
}

pub async fn create_pool(database_url: &str) -> Result<DbPool, sqlx::Error> {
    pool_options()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(600))
        .connect_with(PgConnectOptions::from_str(database_url)?)
        .await
}

pub async fn run_migrations(pool: &DbPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../migrations").run(pool).await
}
