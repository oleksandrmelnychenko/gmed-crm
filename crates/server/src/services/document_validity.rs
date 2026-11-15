//! Optional validity date of a document, «Действует до» / «Gültig bis»
//! (owner decision 2026-11-15).
//!
//! `documents.valid_until` is never required: a document without it is not
//! tracked at all — no status, no warning, no notice. With a date the status
//! follows the German calendar day ([`crate::app_time::today`]):
//!
//! - `valid`: more than [`EXPIRING_DAYS`] days left,
//! - `expiring`: [`EXPIRING_DAYS`] days or fewer left (0 = the last day),
//! - `expired`: the date has passed.
//!
//! It is independent of «Устарел» (`document_terms_current`); a document can
//! be both. Identity documents and cost estimates get the date the records
//! already know when they are stored (trigger `documents_prefill_valid_until`,
//! migration 20261115120006).
//!
//! Once a day ([`spawn_scheduler`], hourly ticks, idempotent) the patient's
//! managers get an in-app notice [`EXPIRING_DAYS`] days before and on the last
//! day — once per document, stage and date (`document_validity_notices`), so a
//! changed date is told again and a repeated run sends nothing.

use chrono::NaiveDate;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::state::AppState;

/// Days before the date from which a document counts as expiring.
pub const EXPIRING_DAYS: i64 = 30;
/// `user_notifications.kind` of the notice.
pub const NOTIFICATION_KIND: &str = "document_validity";
/// Audit action of a notice the job sent.
pub const NOTIFIED_ACTION: &str = "notify_document_validity";

/// Status codes the API returns (`validity_status`).
pub const STATUS_VALID: &str = "valid";
pub const STATUS_EXPIRING: &str = "expiring";
pub const STATUS_EXPIRED: &str = "expired";

/// Status code and days left (negative once passed); `None` without a date.
pub fn validity(valid_until: Option<NaiveDate>, today: NaiveDate) -> Option<(&'static str, i64)> {
    let valid_until = valid_until?;
    let days_left = (valid_until - today).num_days();
    let status = if days_left < 0 {
        STATUS_EXPIRED
    } else if days_left <= EXPIRING_DAYS {
        STATUS_EXPIRING
    } else {
        STATUS_VALID
    };
    Some((status, days_left))
}

/// `validity_status` and `validity_days_left` of a document for the API:
/// both `null` without a date.
pub fn validity_fields(valid_until: Option<NaiveDate>) -> (Value, Value) {
    match validity(valid_until, crate::app_time::today()) {
        Some((status, days)) => (json!(status), json!(days)),
        None => (Value::Null, Value::Null),
    }
}

/// The filter of the document lists: `expired`, `expiring` or `attention`
/// (both). `Err` for an unknown value, `Ok(None)` for none.
#[allow(clippy::result_unit_err)]
pub fn parse_filter(value: Option<&str>) -> Result<Option<&'static str>, ()> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some("expired") => Ok(Some("expired")),
        Some("expiring") => Ok(Some("expiring")),
        Some("attention") => Ok(Some("attention")),
        Some(_) => Err(()),
    }
}

/// The notice stage due for a date on `today`: `expired` from the last day
/// on, `expiring` within the window before it.
pub fn due_stage(valid_until: NaiveDate, today: NaiveDate) -> Option<&'static str> {
    let days_left = (valid_until - today).num_days();
    if days_left <= 0 {
        Some(STATUS_EXPIRED)
    } else if days_left <= EXPIRING_DAYS {
        Some(STATUS_EXPIRING)
    } else {
        None
    }
}

/// What one run did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ValidityNoticeReport {
    pub documents: usize,
    pub notifications: usize,
}

/// Staff told about a document of a patient: the patient managers assigned
/// to the patient, else every patient manager, else the CEO (the recipients
/// of the other patient notices, [`crate::services::coming_of_age`]).
const RECIPIENTS_SQL: &str = r#"
    WITH assigned AS (
        SELECT u.id FROM patient_assignments pa
        JOIN users u ON u.id = pa.user_id
        WHERE pa.patient_id = $1 AND pa.revoked_at IS NULL
          AND u.is_active AND u.role = 'patient_manager'
    ), managers AS (
        SELECT id FROM users
        WHERE is_active AND role = 'patient_manager'
          AND NOT EXISTS (SELECT 1 FROM assigned)
    ), fallback AS (
        SELECT id FROM users
        WHERE is_active AND role = 'ceo'
          AND NOT EXISTS (SELECT 1 FROM assigned)
          AND NOT EXISTS (SELECT 1 FROM managers)
    )
    SELECT id FROM assigned
    UNION SELECT id FROM managers
    UNION SELECT id FROM fallback"#;

/// Documents of patients whose date is within the window or passed and
/// that were not told at the stage due. Only the newest version of an active
/// document with its file; not for anonymised or restricted records.
const CANDIDATES_SQL: &str = r#"
    SELECT d.id
    FROM documents d
    JOIN patients p ON p.id = d.patient_id
    WHERE d.valid_until IS NOT NULL
      AND d.valid_until <= $1::date + $2::int
      AND d.status <> 'archived'
      AND d.file_deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id)
      AND (p.legal_status->>'anonymized_at') IS NULL
      AND NOT COALESCE((p.legal_status->>'processing_restricted')::boolean, false)
      AND NOT EXISTS (
          SELECT 1 FROM document_validity_notices n
          WHERE n.document_id = d.id
            AND n.valid_until = d.valid_until
            AND (n.stage = 'expired' OR (n.stage = 'expiring' AND d.valid_until > $1::date))
      )
    ORDER BY d.valid_until, d.id"#;

/// Runs the notices for the German calendar day `today`.
pub async fn run_on(
    state: &AppState,
    today: NaiveDate,
) -> Result<ValidityNoticeReport, sqlx::Error> {
    let candidates: Vec<Uuid> = sqlx::query_scalar(CANDIDATES_SQL)
        .bind(today)
        .bind(EXPIRING_DAYS as i32)
        .fetch_all(&state.db)
        .await?;
    let mut report = ValidityNoticeReport::default();
    for document_id in candidates {
        match notify_document(state, document_id, today).await {
            Ok(notices) if !notices.is_empty() => {
                report.documents += 1;
                report.notifications += notices.len();
                for (recipient, notification_id) in notices {
                    crate::realtime::publish_notification_event(
                        state,
                        recipient,
                        "notification.created",
                        Some(notification_id),
                        json!({ "entity_type": "document", "entity_id": document_id }),
                    )
                    .await;
                }
            }
            Ok(_) => {}
            // One document's failure never blocks the others; the next run
            // picks it up again.
            Err(error) => tracing::warn!(%error, %document_id, "document validity notice"),
        }
    }
    Ok(report)
}

/// One document, in its own transaction: re-checks under the lock, stores
/// the notices with the marker row and the audit event. Returns
/// `(recipient, notification id)` for the realtime events after the commit.
async fn notify_document(
    state: &AppState,
    document_id: Uuid,
    today: NaiveDate,
) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    let Some(row) = sqlx::query(
        r#"SELECT d.valid_until, d.patient_id, d.auto_name, d.document_number,
                  d.art, d.generated_template_id,
                  p.patient_id AS code,
                  btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) AS name
           FROM documents d
           JOIN patients p ON p.id = d.patient_id
           WHERE d.id = $1
             AND d.status <> 'archived'
             AND d.file_deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id)
           FOR UPDATE OF d"#,
    )
    .bind(document_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        tx.rollback().await?;
        return Ok(Vec::new());
    };
    let Some(valid_until) = row.try_get::<Option<NaiveDate>, _>("valid_until")? else {
        tx.rollback().await?;
        return Ok(Vec::new());
    };
    let Some(stage) = due_stage(valid_until, today) else {
        tx.rollback().await?;
        return Ok(Vec::new());
    };
    // The marker first: a second instance or a repeated run stops here.
    let marked = sqlx::query(
        r#"INSERT INTO document_validity_notices (document_id, stage, valid_until)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(document_id)
    .bind(stage)
    .bind(valid_until)
    .execute(&mut *tx)
    .await?;
    if marked.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(Vec::new());
    }
    let patient_id: Uuid = row.try_get("patient_id")?;
    let code: Option<String> = row.try_get("code")?;
    let name: String = row.try_get("name")?;
    let label = match code.filter(|code| !code.trim().is_empty()) {
        Some(code) if !name.is_empty() => format!("{code} · {name}"),
        Some(code) => code,
        None => name,
    };
    let document_name: String = row.try_get("auto_name")?;
    let days_left = (valid_until - today).num_days();
    let recipients: Vec<Uuid> = sqlx::query_scalar(RECIPIENTS_SQL)
        .bind(patient_id)
        .fetch_all(&mut *tx)
        .await?;
    let (title, body) = if stage == STATUS_EXPIRED {
        (
            format!("Document of {label} expires"),
            format!("{document_name}: valid until {valid_until}."),
        )
    } else {
        (
            format!("Document of {label} expires in {days_left} days"),
            format!("{document_name}: valid until {valid_until}."),
        )
    };
    let mut notices = Vec::with_capacity(recipients.len());
    for recipient in &recipients {
        let notification_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO user_notifications
                   (user_id, kind, title, body, entity_type, entity_id, params)
               VALUES ($1, $2, $3, $4, 'document', $5, $6)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(NOTIFICATION_KIND)
        .bind(&title)
        .bind(&body)
        .bind(document_id)
        .bind(json!({
            "stage": stage,
            "patient_label": label,
            "document_name": document_name,
            "valid_until": valid_until.to_string(),
            "days_left": days_left,
        }))
        .fetch_one(&mut *tx)
        .await?;
        notices.push((*recipient, notification_id));
    }
    sqlx::query(
        r#"UPDATE document_validity_notices SET recipients = $4
           WHERE document_id = $1 AND stage = $2 AND valid_until = $3"#,
    )
    .bind(document_id)
    .bind(stage)
    .bind(valid_until)
    .bind(&recipients)
    .execute(&mut *tx)
    .await?;
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            NOTIFIED_ACTION,
            None,
            "document",
            Some(document_id),
            json!({
                "stage": stage,
                "valid_until": valid_until.to_string(),
                "recipients": recipients,
                "as_of": today.to_string(),
            }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(notices)
}

/// Hourly ticks, the first five minutes after boot; the run is idempotent,
/// so a restart or a failed run is caught up on the next tick (a daily
/// interval restarted with every deploy, see `spawn_lead_purger`).
pub fn spawn_scheduler(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3_600));
        loop {
            ticker.tick().await;
            match run_on(&state, crate::app_time::today()).await {
                Ok(report) if report != ValidityNoticeReport::default() => tracing::info!(
                    documents = report.documents,
                    notifications = report.notifications,
                    "Staff told of expiring or expired documents"
                ),
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "Document validity sweep failed"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn no_date_means_no_status() {
        assert_eq!(validity(None, day("2026-11-15")), None);
    }

    #[test]
    fn status_follows_the_berlin_day() {
        let today = day("2026-11-15");
        assert_eq!(
            validity(Some(day("2026-12-16")), today),
            Some(("valid", 31))
        );
        assert_eq!(
            validity(Some(day("2026-12-15")), today),
            Some(("expiring", 30))
        );
        assert_eq!(
            validity(Some(day("2026-11-15")), today),
            Some(("expiring", 0))
        );
        assert_eq!(
            validity(Some(day("2026-11-14")), today),
            Some(("expired", -1))
        );
    }

    #[test]
    fn notices_thirty_days_before_and_on_the_last_day() {
        let today = day("2026-11-15");
        assert_eq!(due_stage(day("2026-12-16"), today), None);
        assert_eq!(due_stage(day("2026-12-15"), today), Some("expiring"));
        assert_eq!(due_stage(day("2026-11-16"), today), Some("expiring"));
        assert_eq!(due_stage(day("2026-11-15"), today), Some("expired"));
        assert_eq!(due_stage(day("2026-10-01"), today), Some("expired"));
    }

    #[test]
    fn filter_values() {
        assert_eq!(parse_filter(None), Ok(None));
        assert_eq!(parse_filter(Some(" ")), Ok(None));
        assert_eq!(parse_filter(Some("expired")), Ok(Some("expired")));
        assert_eq!(parse_filter(Some("attention")), Ok(Some("attention")));
        assert!(parse_filter(Some("soon")).is_err());
    }
}
