//! Daily sweep for finished patient files whose retention period has run out.
//! It does not delete: it opens an erasure request in the compliance register
//! and tells CEO and IT, because retention holds (open invoices, pending
//! claims) are a human decision before the record is anonymised.

use chrono::{Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use crate::audit;
use crate::state::AppState;

const DEFAULT_RETENTION_DAYS: i64 = 1095;

#[derive(Debug, Default)]
pub struct RetentionSweepReport {
    pub retention_days: i64,
    pub flagged: u64,
}

async fn numeric_setting(state: &AppState, key: &str, fallback: i64) -> Result<i64, sqlx::Error> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value::text FROM system_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(&state.db)
            .await?
            .and_then(|raw| raw.trim_matches('"').parse::<i64>().ok())
            .filter(|days| *days > 0)
            .unwrap_or(fallback),
    )
}

pub async fn flag_expired_patient_files(
    state: &AppState,
) -> Result<RetentionSweepReport, sqlx::Error> {
    let retention_days =
        numeric_setting(state, "patient_file_retention_days", DEFAULT_RETENTION_DAYS).await?;
    let due_days = numeric_setting(state, "patient_erasure_due_days", 30).await?;

    // Requests need a requester; the longest-standing CEO account stands in
    // for the organisation.
    let Some(requester) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE role = 'ceo' AND is_active = true ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await?
    else {
        return Ok(RetentionSweepReport {
            retention_days,
            flagged: 0,
        });
    };

    let flagged: Vec<Uuid> = sqlx::query_scalar(
        r#"INSERT INTO patient_privacy_requests (
               patient_id, requested_by, request_type, source, status, reason, due_at, context
           )
           SELECT p.id, $1, 'erasure', 'admin_intake', 'requested',
                  'Retention period expired: file inactive for more than ' || $2::text || ' days',
                  $3, jsonb_build_object('origin', 'retention_sweep', 'inactive_since', p.inactive_since)
           FROM patients p
           WHERE p.lifecycle_status = 'inactive'
             AND p.inactive_since IS NOT NULL
             AND p.inactive_since < now() - make_interval(days => $2::int)
             AND (p.legal_status->>'anonymized_at') IS NULL
             AND NOT EXISTS (
                 SELECT 1 FROM patient_privacy_requests pr
                 WHERE pr.patient_id = p.id
                   AND pr.request_type = 'erasure'
                   AND pr.status IN ('requested', 'retention_hold', 'approved', 'completed')
             )
           LIMIT 200
           RETURNING patient_id"#,
    )
    .bind(requester)
    .bind(i32::try_from(retention_days).unwrap_or(i32::MAX))
    .bind(Utc::now() + Duration::days(due_days))
    .fetch_all(&state.db)
    .await?;

    for patient_id in &flagged {
        state.audit_sender.try_send(audit::domain_event(
            "privacy_request_created",
            Some(requester),
            "patient",
            Some(*patient_id),
            json!({
                "request_type": "erasure",
                "source": "admin_intake",
                "origin": "retention_sweep",
                "retention_days": retention_days,
            }),
        ));
    }

    if let Some(first) = flagged.first() {
        sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               SELECT u.id, 'privacy_request', $1, $2, 'patient', $3
               FROM users u
               WHERE u.role IN ('ceo', 'it_admin') AND u.is_active = true"#,
        )
        .bind(format!(
            "Retention: {} patient file(s) due for erasure",
            flagged.len()
        ))
        .bind(format!(
            "Files inactive for more than {retention_days} days were added to the DSGVO queue. Review holds, then approve and execute."
        ))
        .bind(first)
        .execute(&state.db)
        .await?;
    }

    Ok(RetentionSweepReport {
        retention_days,
        flagged: flagged.len() as u64,
    })
}
