//! Patient links that exist because an interpreter is booked on one of the
//! patient's appointments (`patient_assignments.source = 'interpreter_booking'`).
//!
//! Booking an interpreter links them to the patient: the basic patient card,
//! the documents released without an appointment and the patient chat. Such a
//! link lives only as long as the booking. It ends as soon as the interpreter
//! has no active booking on the patient's appointments (taken off the visit,
//! declined, the visit cancelled or deleted), or `interpreter_booking_access_days`
//! (default 14) after the date of the last booked appointment, whichever comes
//! first; a new booking grants it again. An ended link is revoked, so every
//! patient access check (`revoked_at IS NULL`) treats it as no access.
//!
//! A manual assignment by a manager (`source = 'manual'`) is never granted or
//! ended here. Neither is a link a manager revoked by hand
//! (`manually_revoked_at = revoked_at`): a booking or the interpreter's
//! response does not grant it back; a manager's new assignment does (owner
//! decision 2026-09-28). Appointment-level access that comes from the booking itself
//! (opening the booked visit, submitting its interpreter report) does not
//! depend on the link.
//!
//! Every grant and end is audited in the transaction that changes the link.
//! The changes lock the link row first and check the bookings in a later
//! statement, so a booking committed concurrently is either seen by the check
//! or re-grants the link after the end commits.

use std::collections::BTreeSet;

use chrono::NaiveDate;
use serde_json::json;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::audit;
use crate::state::AppState;

/// System setting: days after the last booked appointment that a booking
/// link lasts.
pub const ACCESS_DAYS_SETTING: &str = "interpreter_booking_access_days";
pub const DEFAULT_ACCESS_DAYS: i64 = 14;
pub const MAX_ACCESS_DAYS: i64 = 365;
const EXPIRY_SWEEP_INTERVAL_SECS: u64 = 15 * 60;

/// `(patient_id, interpreter_id)` of a booking.
pub type BookingPair = (Uuid, Uuid);

/// An appointment keeps the link alive while the interpreter is booked on it
/// (not declined, the visit not cancelled) and its date plus the access days
/// has not been reached. `$days` and `$today` are bound by the caller.
fn active_booking_sql(patient: &str, interpreter: &str, days: &str, today: &str) -> String {
    format!(
        r#"EXISTS (
               SELECT 1
               FROM appointments booking
               WHERE booking.patient_id = {patient}
                 AND booking.interpreter_id = {interpreter}
                 AND booking.status <> 'cancelled'
                 AND booking.interpreter_response IS DISTINCT FROM 'declined'
                 AND booking.date + {days}::int > {today}::date
           )"#
    )
}

fn normalize_access_days(raw: Option<&str>) -> i64 {
    raw.and_then(|value| value.trim().trim_matches('"').parse::<i64>().ok())
        .filter(|days| (1..=MAX_ACCESS_DAYS).contains(days))
        .unwrap_or(DEFAULT_ACCESS_DAYS)
}

/// The configured access days (default 14).
pub async fn access_days(conn: &mut PgConnection) -> Result<i64, sqlx::Error> {
    let raw =
        sqlx::query_scalar::<_, String>("SELECT value::text FROM system_settings WHERE key = $1")
            .bind(ACCESS_DAYS_SETTING)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(normalize_access_days(raw.as_deref()))
}

fn unique_pairs(pairs: &[BookingPair]) -> Vec<BookingPair> {
    pairs
        .iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// Links each interpreter to the patient of a booking that still counts. An
/// active link stays as it is (a manual one stays manual); a missing or
/// revoked one becomes a booking link. `cause` names the booking action for
/// the audit trail.
pub async fn grant_in_tx(
    conn: &mut PgConnection,
    pairs: &[BookingPair],
    actor: Uuid,
    cause: &str,
) -> Result<(), sqlx::Error> {
    let pairs = unique_pairs(pairs);
    if pairs.is_empty() {
        return Ok(());
    }
    let days = access_days(conn).await?;
    let today = crate::app_time::today();
    let counts_sql = format!("SELECT {}", active_booking_sql("$1", "$2", "$3", "$4"));
    for (patient_id, interpreter_id) in pairs {
        let counts = sqlx::query_scalar::<_, bool>(&counts_sql)
            .bind(patient_id)
            .bind(interpreter_id)
            .bind(days as i32)
            .bind(today)
            .fetch_one(&mut *conn)
            .await?;
        if !counts {
            continue;
        }
        // ON CONFLICT locks an existing row even when it is left unchanged.
        // A link a manager revoked by hand stays revoked (its current
        // revocation is the manual one) until a manager assigns it again.
        let granted = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by, source)
               VALUES ($1, $2, $3, 'interpreter_booking')
               ON CONFLICT (patient_id, user_id) DO UPDATE
               SET revoked_at = NULL,
                   assigned_by = EXCLUDED.assigned_by,
                   assigned_at = now(),
                   source = 'interpreter_booking',
                   revoked_by = NULL
               WHERE patient_assignments.revoked_at IS NOT NULL
                 AND patient_assignments.manually_revoked_at IS DISTINCT FROM
                     patient_assignments.revoked_at
               RETURNING id"#,
        )
        .bind(patient_id)
        .bind(interpreter_id)
        .bind(actor)
        .fetch_optional(&mut *conn)
        .await?;
        if granted.is_some() {
            audit::write_in_transaction(
                conn,
                &audit::domain_event(
                    "grant_booking_patient_access",
                    Some(actor),
                    "patient",
                    Some(patient_id),
                    json!({
                        "user_id": interpreter_id,
                        "source": "interpreter_booking",
                        "cause": cause,
                    }),
                ),
            )
            .await?;
        }
    }
    Ok(())
}

/// The booked `(patient, interpreter)` pairs of these appointments.
pub async fn booked_pairs_in_tx(
    conn: &mut PgConnection,
    appointment_ids: &[Uuid],
) -> Result<Vec<BookingPair>, sqlx::Error> {
    if appointment_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(
        r#"SELECT DISTINCT patient_id, interpreter_id
           FROM appointments
           WHERE id = ANY($1) AND interpreter_id IS NOT NULL"#,
    )
    .bind(appointment_ids)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| Ok((row.try_get("patient_id")?, row.try_get("interpreter_id")?)))
        .collect()
}

/// Ends the booking links of these pairs that no booking keeps alive any
/// more; call it after the booking change, in the same transaction.
pub async fn end_unbooked_in_tx(
    conn: &mut PgConnection,
    pairs: &[BookingPair],
    actor: Option<Uuid>,
    cause: &str,
) -> Result<u64, sqlx::Error> {
    let pairs = unique_pairs(pairs);
    if pairs.is_empty() {
        return Ok(0);
    }
    let (patients, interpreters): (Vec<Uuid>, Vec<Uuid>) = pairs.into_iter().unzip();
    let link_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT link.id
           FROM patient_assignments link
           JOIN UNNEST($1::uuid[], $2::uuid[]) AS pair(patient_id, user_id)
             ON pair.patient_id = link.patient_id AND pair.user_id = link.user_id
           WHERE link.source = 'interpreter_booking'
             AND link.revoked_at IS NULL
           ORDER BY link.id
           FOR UPDATE OF link"#,
    )
    .bind(&patients)
    .bind(&interpreters)
    .fetch_all(&mut *conn)
    .await?;
    end_links_without_booking(conn, &link_ids, actor, cause, crate::app_time::today()).await
}

/// Revokes the locked booking links that no active booking within the access
/// days keeps alive, auditing each one.
async fn end_links_without_booking(
    conn: &mut PgConnection,
    link_ids: &[Uuid],
    actor: Option<Uuid>,
    cause: &str,
    today: NaiveDate,
) -> Result<u64, sqlx::Error> {
    if link_ids.is_empty() {
        return Ok(0);
    }
    let days = access_days(conn).await?;
    let ended = sqlx::query(&format!(
        r#"UPDATE patient_assignments link
           SET revoked_at = now()
           WHERE link.id = ANY($1)
             AND link.source = 'interpreter_booking'
             AND link.revoked_at IS NULL
             AND NOT {}
           RETURNING link.patient_id, link.user_id,
                     (SELECT max(booking.date)
                      FROM appointments booking
                      WHERE booking.patient_id = link.patient_id
                        AND booking.interpreter_id = link.user_id
                        AND booking.status <> 'cancelled'
                        AND booking.interpreter_response IS DISTINCT FROM 'declined')
                         AS last_booking_date"#,
        active_booking_sql("link.patient_id", "link.user_id", "$2", "$3")
    ))
    .bind(link_ids)
    .bind(days as i32)
    .bind(today)
    .fetch_all(&mut *conn)
    .await?;
    for row in &ended {
        let patient_id: Uuid = row.try_get("patient_id")?;
        let interpreter_id: Uuid = row.try_get("user_id")?;
        let last_booking_date: Option<NaiveDate> = row.try_get("last_booking_date")?;
        audit::write_in_transaction(
            conn,
            &audit::domain_event(
                "end_booking_patient_access",
                actor,
                "patient",
                Some(patient_id),
                json!({
                    "user_id": interpreter_id,
                    "source": "interpreter_booking",
                    "reason": if last_booking_date.is_some() { "expired" } else { "no_active_booking" },
                    "last_booking_date": last_booking_date,
                    "access_days": days,
                    "cause": cause,
                }),
            ),
        )
        .await?;
    }
    Ok(ended.len() as u64)
}

/// Ends every booking link whose interpreter has no active booking on the
/// patient any more or whose last booking lies `access_days` or more before
/// `today` (the German date). Links locked by a running booking change are
/// left to the next sweep.
pub async fn end_expired_links(
    pool: &gmed_db::DbPool,
    today: NaiveDate,
) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let days = access_days(&mut tx).await?;
    let candidates = sqlx::query_scalar::<_, Uuid>(&format!(
        r#"SELECT link.id
           FROM patient_assignments link
           WHERE link.source = 'interpreter_booking'
             AND link.revoked_at IS NULL
             AND NOT {}
           ORDER BY link.id
           FOR UPDATE OF link SKIP LOCKED"#,
        active_booking_sql("link.patient_id", "link.user_id", "$1", "$2")
    ))
    .bind(days as i32)
    .bind(today)
    .fetch_all(&mut *tx)
    .await?;
    let ended =
        end_links_without_booking(&mut tx, &candidates, None, "expiry_sweep", today).await?;
    tx.commit().await?;
    Ok(ended)
}

pub fn spawn_expiry_sweeper(state: AppState) {
    tokio::spawn(async move {
        // The first tick runs at startup, so links a migration or downtime
        // left behind end right away.
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(EXPIRY_SWEEP_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            match end_expired_links(&state.db, crate::app_time::today()).await {
                Ok(0) => {}
                Ok(ended) => tracing::info!(ended, "Interpreter booking patient links ended"),
                Err(error) => {
                    tracing::warn!(%error, "Interpreter booking patient link sweep failed")
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_days_default_to_fourteen_and_stay_in_range() {
        assert_eq!(normalize_access_days(None), 14);
        assert_eq!(normalize_access_days(Some("21")), 21);
        assert_eq!(normalize_access_days(Some("\"7\"")), 7);
        assert_eq!(normalize_access_days(Some("0")), 14);
        assert_eq!(normalize_access_days(Some("366")), 14);
        assert_eq!(normalize_access_days(Some("soon")), 14);
    }

    #[test]
    fn pairs_are_deduplicated() {
        let patient = Uuid::new_v4();
        let interpreter = Uuid::new_v4();
        assert_eq!(
            unique_pairs(&[(patient, interpreter), (patient, interpreter)]),
            vec![(patient, interpreter)]
        );
    }
}
