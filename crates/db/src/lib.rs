use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::str::FromStr;
use std::time::Duration;

pub type DbPool = sqlx::PgPool;

/// GMed works in German time only. Every session uses this zone so that
/// `CURRENT_DATE`, `timestamptz::date`, `date_trunc` and naive appointment
/// times compared with `now()` follow the German calendar day, not the
/// server's UTC day. Stored `timestamptz` values are unaffected.
pub const SESSION_TIME_ZONE: &str = "Europe/Berlin";

/// Applies the GMed session settings to connection options.
pub fn with_session_settings(options: PgConnectOptions) -> PgConnectOptions {
    options.options([("TimeZone", SESSION_TIME_ZONE)])
}

pub async fn create_pool(database_url: &str) -> Result<DbPool, sqlx::Error> {
    let options = with_session_settings(PgConnectOptions::from_str(database_url)?);
    PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(600))
        .connect_with(options)
        .await
}

pub async fn run_migrations(pool: &DbPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../migrations").run(pool).await
}
