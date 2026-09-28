//! Daily compliance deadline digest for CEO and IT admin.
//!
//! Once per German calendar day (from 07:00 Europe/Berlin) one user
//! notification lists what is due:
//! - data subject requests awaiting a decision or execution whose one-month
//!   deadline (Art. 12 Abs. 3 DSGVO) has passed or ends within
//!   [`PRIVACY_DUE_SOON_DAYS`] days (`requested`, `approved`; a retention
//!   hold is a decision already taken);
//! - personal data breaches without a documented authority decision, inside
//!   or past the 72-hour deadline (Art. 33 Abs. 1 DSGVO);
//! - consents that expire within [`CONSENT_EXPIRY_DAYS`] days.
//!
//! The facts are stored as JSON in the notification body; the web client words
//! them in Russian or German. `compliance_digest_runs` claims the day, so
//! restarts and several server instances send it once. A day with nothing due
//! is recorded without a notification.

use chrono::{DateTime, Duration, NaiveDate, Timelike, Utc};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

pub const DIGEST_KIND: &str = "compliance_deadline_digest";
pub const PRIVACY_DUE_SOON_DAYS: i64 = 7;
pub const CONSENT_EXPIRY_DAYS: i64 = 30;
const AUTHORITY_DEADLINE_HOURS: i64 = 72;
/// German wall-clock hour from which the day's digest goes out.
const SEND_FROM_HOUR: u32 = 7;
const CHECK_INTERVAL_SECS: u64 = 15 * 60;
/// Items listed per section; the counts cover everything.
const LIST_LIMIT: i64 = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DigestOutcome {
    /// Before the send hour of the German day.
    NotYet,
    /// The digest of this German day was already evaluated.
    AlreadySent,
    /// Evaluated now; `recipients` is 0 when nothing was due.
    Sent {
        digest_date: NaiveDate,
        recipients: u64,
    },
}

/// Evaluates and, once per German day, sends the digest as of `now`.
pub async fn run_compliance_digest_at(
    state: &AppState,
    now: DateTime<Utc>,
) -> Result<DigestOutcome, sqlx::Error> {
    if crate::app_time::local(now).hour() < SEND_FROM_HOUR {
        return Ok(DigestOutcome::NotYet);
    }
    let digest_date = crate::app_time::date_of(now);
    let already = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM compliance_digest_runs WHERE digest_date = $1)",
    )
    .bind(digest_date)
    .fetch_one(&state.db)
    .await?;
    if already {
        return Ok(DigestOutcome::AlreadySent);
    }

    let summary = collect_digest(state, now, digest_date).await?;
    let nothing_due = summary["total"].as_i64().unwrap_or(0) == 0;

    let mut tx = state.db.begin().await?;
    let claimed = sqlx::query_scalar::<_, NaiveDate>(
        r#"INSERT INTO compliance_digest_runs (digest_date, sent_at, summary)
           VALUES ($1, $2, $3)
           ON CONFLICT (digest_date) DO NOTHING
           RETURNING digest_date"#,
    )
    .bind(digest_date)
    .bind(now)
    .bind(&summary)
    .fetch_optional(&mut *tx)
    .await?;
    if claimed.is_none() {
        tx.rollback().await?;
        return Ok(DigestOutcome::AlreadySent);
    }
    if nothing_due {
        tx.commit().await?;
        return Ok(DigestOutcome::Sent {
            digest_date,
            recipients: 0,
        });
    }

    let delivered = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT u.id, $1, $2, $3, 'compliance_digest', NULL
           FROM users u
           WHERE u.role IN ('ceo', 'it_admin') AND u.is_active = true
           RETURNING id, user_id"#,
    )
    .bind(DIGEST_KIND)
    .bind(format!(
        "Compliance deadlines {}",
        digest_date.format("%d.%m.%Y")
    ))
    .bind(summary.to_string())
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query("UPDATE compliance_digest_runs SET recipients = $2 WHERE digest_date = $1")
        .bind(digest_date)
        .bind(i32::try_from(delivered.len()).unwrap_or(i32::MAX))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    for row in &delivered {
        let notification_id: Uuid = row.try_get("id")?;
        let user_id: Uuid = row.try_get("user_id")?;
        crate::realtime::publish_notification_event(
            state,
            user_id,
            "notification.created",
            Some(notification_id),
            json!({ "entity_type": "compliance_digest", "kind": DIGEST_KIND }),
        )
        .await;
    }

    Ok(DigestOutcome::Sent {
        digest_date,
        recipients: delivered.len() as u64,
    })
}

async fn collect_digest(
    state: &AppState,
    now: DateTime<Utc>,
    digest_date: NaiveDate,
) -> Result<Value, sqlx::Error> {
    let due_limit = now + Duration::days(PRIVACY_DUE_SOON_DAYS);
    let privacy_counts = sqlx::query(
        r#"SELECT count(*) FILTER (WHERE due_at < $1) AS overdue,
                  count(*) FILTER (WHERE due_at >= $1) AS due_soon
           FROM patient_privacy_requests
           WHERE status IN ('requested', 'approved')
             AND due_at IS NOT NULL
             AND due_at <= $2"#,
    )
    .bind(now)
    .bind(due_limit)
    .fetch_one(&state.db)
    .await?;
    let privacy_items = sqlx::query(
        r#"SELECT pr.request_type, pr.status, pr.due_at, p.patient_id AS patient_pid
           FROM patient_privacy_requests pr
           JOIN patients p ON p.id = pr.patient_id
           WHERE pr.status IN ('requested', 'approved')
             AND pr.due_at IS NOT NULL
             AND pr.due_at <= $1
           ORDER BY pr.due_at
           LIMIT $2"#,
    )
    .bind(due_limit)
    .bind(LIST_LIMIT)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|row| {
        let due_at: Option<DateTime<Utc>> = row.try_get("due_at").unwrap_or_default();
        json!({
            "request_type": row.try_get::<String, _>("request_type").unwrap_or_default(),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
            "due_at": due_at.map(|value| value.to_rfc3339()),
            "overdue": due_at.is_some_and(|value| value < now),
        })
    })
    .collect::<Vec<_>>();

    let deadline_start = now - Duration::hours(AUTHORITY_DEADLINE_HOURS);
    let incident_counts = sqlx::query(
        r#"SELECT count(*) FILTER (WHERE became_aware_at > $1) AS within_deadline,
                  count(*) FILTER (WHERE became_aware_at <= $1) AS deadline_missed
           FROM security_incidents
           WHERE status <> 'closed'
             AND authority_notified_at IS NULL
             AND no_notification_reason IS NULL"#,
    )
    .bind(deadline_start)
    .fetch_one(&state.db)
    .await?;
    let incident_items = sqlx::query(
        r#"SELECT reference, severity, became_aware_at
           FROM security_incidents
           WHERE status <> 'closed'
             AND authority_notified_at IS NULL
             AND no_notification_reason IS NULL
           ORDER BY became_aware_at
           LIMIT $1"#,
    )
    .bind(LIST_LIMIT)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|row| {
        let became_aware_at: DateTime<Utc> = row.try_get("became_aware_at").unwrap_or(now);
        let deadline = became_aware_at + Duration::hours(AUTHORITY_DEADLINE_HOURS);
        json!({
            "reference": row.try_get::<String, _>("reference").unwrap_or_default(),
            "severity": row.try_get::<String, _>("severity").unwrap_or_default(),
            "deadline": deadline.to_rfc3339(),
            "missed": deadline <= now,
        })
    })
    .collect::<Vec<_>>();

    let consent_limit = now + Duration::days(CONSENT_EXPIRY_DAYS);
    let consent_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT count(*)
           FROM consent_records cr
           JOIN patients p ON p.id = cr.patient_id
           WHERE cr.granted = true
             AND cr.revoked_at IS NULL
             AND cr.expires_at > $1
             AND cr.expires_at <= $2
             AND (p.legal_status->>'anonymized_at') IS NULL"#,
    )
    .bind(now)
    .bind(consent_limit)
    .fetch_one(&state.db)
    .await?;
    let consent_items = sqlx::query(
        r#"SELECT cr.consent_type, cr.expires_at, p.patient_id AS patient_pid
           FROM consent_records cr
           JOIN patients p ON p.id = cr.patient_id
           WHERE cr.granted = true
             AND cr.revoked_at IS NULL
             AND cr.expires_at > $1
             AND cr.expires_at <= $2
             AND (p.legal_status->>'anonymized_at') IS NULL
           ORDER BY cr.expires_at
           LIMIT $3"#,
    )
    .bind(now)
    .bind(consent_limit)
    .bind(LIST_LIMIT)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|row| {
        json!({
            "consent_type": row.try_get::<String, _>("consent_type").unwrap_or_default(),
            "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
            "expires_at": row
                .try_get::<Option<DateTime<Utc>>, _>("expires_at")
                .unwrap_or_default()
                .map(|value| value.to_rfc3339()),
        })
    })
    .collect::<Vec<_>>();

    let privacy_overdue: i64 = privacy_counts.try_get("overdue").unwrap_or_default();
    let privacy_due_soon: i64 = privacy_counts.try_get("due_soon").unwrap_or_default();
    let incidents_within: i64 = incident_counts
        .try_get("within_deadline")
        .unwrap_or_default();
    let incidents_missed: i64 = incident_counts
        .try_get("deadline_missed")
        .unwrap_or_default();

    Ok(json!({
        "digest_date": digest_date.to_string(),
        "total": privacy_overdue + privacy_due_soon + incidents_within + incidents_missed + consent_count,
        "privacy": {
            "overdue": privacy_overdue,
            "due_soon": privacy_due_soon,
            "due_soon_days": PRIVACY_DUE_SOON_DAYS,
            "items": privacy_items,
        },
        "incidents": {
            "within_deadline": incidents_within,
            "deadline_missed": incidents_missed,
            "items": incident_items,
        },
        "consents": {
            "expiring": consent_count,
            "within_days": CONSENT_EXPIRY_DAYS,
            "items": consent_items,
        },
    }))
}

pub fn spawn_compliance_digest_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(CHECK_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            match run_compliance_digest_at(&state, Utc::now()).await {
                Ok(DigestOutcome::Sent {
                    digest_date,
                    recipients,
                }) => tracing::info!(
                    %digest_date,
                    recipients,
                    "Compliance deadline digest evaluated"
                ),
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "Compliance deadline digest failed"),
            }
        }
    });
}
