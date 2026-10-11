//! Throttling of failed sign-ins (QA E-19, 2026-10-11).
//!
//! Failures count per account and client address (`login_attempt_throttle`):
//! after `max_failed_login_attempts` failures that pair is held for
//! `lockout_duration_minutes`, doubling with every further lock up to a day.
//! Another address keeps signing in, so nobody can lock out the CEO (or anyone
//! else) with a handful of anonymous requests. The account-wide lock
//! (`users.locked_until`) only follows [`ACCOUNT_LOCK_FACTOR`] times as many
//! failures without a success — guessing spread over many addresses — and
//! expires on its own; the CEO and the IT admin can lift both.
//!
//! The sign-in answer is the same for an unknown e-mail, a wrong password and
//! a held account (401 `unauthorized`), so the answer reveals neither which
//! addresses exist nor which are held.

use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

/// The account-wide lock needs this many times `max_failed_login_attempts`
/// failures in a row (from any address).
pub const ACCOUNT_LOCK_FACTOR: i32 = 10;

/// Longest hold of one account and address.
const MAX_LOCK_MINUTES: i64 = 24 * 60;

/// A hold level older than this starts over at the base duration.
const LOCK_LEVEL_DECAY_HOURS: i64 = 24;

/// Pseudonymous key of the e-mail address as typed (also for unknown ones).
pub fn subject_hash(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    hex::encode(Sha256::digest(
        format!("gmed-login-throttle:{normalized}").as_bytes(),
    ))
}

/// Duration of the `lock_level`-th hold (1 = first): the base doubled for
/// every further hold, at most a day.
pub fn lock_minutes(base_minutes: i64, lock_level: i32) -> i64 {
    let base = base_minutes.clamp(1, MAX_LOCK_MINUTES);
    let doublings = u32::try_from(lock_level.saturating_sub(1).clamp(0, 16)).unwrap_or(0);
    base.saturating_mul(1_i64 << doublings)
        .min(MAX_LOCK_MINUTES)
}

/// Whether the account and address are held right now.
pub async fn is_held(pool: &PgPool, subject: &str, ip_hash: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM login_attempt_throttle
             WHERE subject_hash = $1 AND ip_hash = $2 AND locked_until > now()
         )",
    )
    .bind(subject)
    .bind(ip_hash)
    .fetch_one(pool)
    .await
}

/// Counts one failed sign-in of the account and address. Returns the end of
/// the hold when this failure started one.
pub async fn record_failure(
    pool: &PgPool,
    subject: &str,
    ip_hash: &str,
    max_attempts: i32,
    base_minutes: i64,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    let max_attempts = max_attempts.max(1);
    let row = sqlx::query(
        r#"INSERT INTO login_attempt_throttle (subject_hash, ip_hash, failed_attempts, last_failed_at)
           VALUES ($1, $2, 1, now())
           ON CONFLICT (subject_hash, ip_hash) DO UPDATE
           SET failed_attempts = CASE
                   WHEN login_attempt_throttle.locked_until IS NOT NULL
                        AND login_attempt_throttle.locked_until <= now()
                       THEN 1
                   ELSE login_attempt_throttle.failed_attempts + 1
               END,
               lock_level = CASE
                   WHEN login_attempt_throttle.last_failed_at < now() - ($3::bigint * interval '1 hour')
                       THEN 0
                   ELSE login_attempt_throttle.lock_level
               END,
               locked_until = CASE
                   WHEN login_attempt_throttle.locked_until IS NOT NULL
                        AND login_attempt_throttle.locked_until <= now()
                       THEN NULL
                   ELSE login_attempt_throttle.locked_until
               END,
               last_failed_at = now()
           RETURNING failed_attempts, lock_level"#,
    )
    .bind(subject)
    .bind(ip_hash)
    .bind(LOCK_LEVEL_DECAY_HOURS)
    .fetch_one(pool)
    .await?;
    let failed: i32 = row.try_get("failed_attempts").unwrap_or(1);
    let level: i32 = row.try_get("lock_level").unwrap_or(0);
    if failed < max_attempts {
        return Ok(None);
    }
    let next_level = level.saturating_add(1);
    let until = Utc::now() + Duration::minutes(lock_minutes(base_minutes, next_level));
    sqlx::query(
        "UPDATE login_attempt_throttle
         SET failed_attempts = 0, lock_level = $3, locked_until = $4
         WHERE subject_hash = $1 AND ip_hash = $2",
    )
    .bind(subject)
    .bind(ip_hash)
    .bind(next_level)
    .bind(until)
    .execute(pool)
    .await?;
    Ok(Some(until))
}

/// A successful sign-in clears the account's count for this address.
pub async fn clear_pair(pool: &PgPool, subject: &str, ip_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM login_attempt_throttle WHERE subject_hash = $1 AND ip_hash = $2")
        .bind(subject)
        .bind(ip_hash)
        .execute(pool)
        .await
        .map(|_| ())
}

/// An administrator's unlock lifts every hold of the account.
pub async fn clear_account(pool: &PgPool, email: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM login_attempt_throttle WHERE subject_hash = $1")
        .bind(subject_hash(email))
        .execute(pool)
        .await
        .map(|_| ())
}

/// Forgets counts and holds that ended long ago (session sweeper).
pub async fn purge_stale(pool: &PgPool) -> Result<u64, sqlx::Error> {
    sqlx::query(
        "DELETE FROM login_attempt_throttle
         WHERE last_failed_at < now() - interval '2 days'
           AND (locked_until IS NULL OR locked_until < now())",
    )
    .execute(pool)
    .await
    .map(|result| result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_double_and_stop_at_a_day() {
        assert_eq!(lock_minutes(30, 1), 30);
        assert_eq!(lock_minutes(30, 2), 60);
        assert_eq!(lock_minutes(30, 3), 120);
        assert_eq!(lock_minutes(30, 6), 960);
        assert_eq!(lock_minutes(30, 7), 1440);
        assert_eq!(lock_minutes(30, 40), 1440);
        assert_eq!(lock_minutes(0, 1), 1);
    }

    #[test]
    fn the_subject_ignores_case_and_spaces() {
        assert_eq!(
            subject_hash(" Anna.Muster@Example.com "),
            subject_hash("anna.muster@example.com")
        );
        assert_ne!(
            subject_hash("anna.muster@example.com"),
            subject_hash("ben.muster@example.com")
        );
    }
}
