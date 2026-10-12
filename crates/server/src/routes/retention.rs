//! Daily sweep for finished patient files whose retention period has run out.
//! It does not delete: it opens an erasure request in the compliance register
//! and tells CEO and IT, because retention holds (open invoices, pending
//! claims) are a human decision before the record is anonymised.
//!
//! A file is left alone while the clinical documentation still has to be kept
//! (`clinical_retention_until` in the future), and once a sweep-raised request
//! was rejected for the current inactive period: the decision stands until the
//! file is reactivated and closed again (a later `inactive_since`).
//!
//! A privacy request put on hold until a date (`retention_hold`,
//! `retention_until`; an erasure also only once the medical documentation's
//! retention ended) returns to the queue on that date:
//! [`requeue_expired_retention_holds`] runs with the sweep and, so that it
//! happens on the date itself, every hour in between.

use chrono::{Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use crate::audit;
use crate::state::AppState;

const DEFAULT_RETENTION_DAYS: i64 = 1095;
const DEFAULT_ERASURE_DUE_DAYS: i64 = 30;

#[derive(Debug, Default)]
pub struct RetentionSweepReport {
    pub retention_days: i64,
    pub flagged: u64,
    /// Privacy requests whose hold ended and that are back in the queue.
    pub requeued: u64,
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
    // Holds that ended first: such a file has an open request again and is
    // not flagged a second time below.
    let requeued = requeue_expired_retention_holds(state).await?;
    let retention_days =
        numeric_setting(state, "patient_file_retention_days", DEFAULT_RETENTION_DAYS).await?;
    let due_days =
        numeric_setting(state, "patient_erasure_due_days", DEFAULT_ERASURE_DUE_DAYS).await?;

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
            requeued,
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
             AND (p.clinical_retention_until IS NULL OR p.clinical_retention_until <= now())
             AND NOT EXISTS (
                 SELECT 1 FROM patient_privacy_requests pr
                 WHERE pr.patient_id = p.id
                   AND pr.request_type = 'erasure'
                   AND pr.status IN ('requested', 'retention_hold', 'approved', 'completed')
             )
             AND NOT EXISTS (
                 SELECT 1 FROM patient_privacy_requests rejected
                 WHERE rejected.patient_id = p.id
                   AND rejected.request_type = 'erasure'
                   AND rejected.status = 'rejected'
                   AND rejected.context->>'origin' = 'retention_sweep'
                   AND COALESCE(rejected.reviewed_at, rejected.updated_at) >= p.inactive_since
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
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id, params)
               SELECT u.id, 'privacy_request', $1, $2, 'patient', $3, $4
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
        .bind(json!({
            "origin": "retention_sweep",
            "count": flagged.len(),
            "retention_days": retention_days,
        }))
        .execute(&state.db)
        .await?;
    }

    Ok(RetentionSweepReport {
        retention_days,
        flagged: flagged.len() as u64,
        requeued,
    })
}

/// A request [`requeue_expired_retention_holds`] returned to the queue.
#[derive(sqlx::FromRow)]
struct RequeuedRequest {
    id: Uuid,
    patient_id: Uuid,
    request_type: String,
    retention_until: Option<chrono::DateTime<Utc>>,
    patient_label: String,
}

/// Brings requests held until a date (`retention_hold`, `retention_until`)
/// back to the queue once that date has passed: the reason to wait is gone,
/// so the request is due again (for an erasure Art. 17 Abs. 1 DSGVO). Every
/// request type can be held with a date (the review sets `retention_until`
/// for each hold: the end of the medical documentation's retention, an
/// explicit number of days or the configured default), so every held request
/// comes back. It becomes `requested` with a new deadline
/// (`patient_erasure_due_days`), the step is added to its decision history
/// and audited, and the compliance handlers (CEO, IT admin) are told per
/// request. For an erasure the patient's processing stays restricted until it
/// is executed or decided otherwise.
///
/// An erasure hold whose date passed while the medical documentation must
/// still be kept (a clinical entry made since moved
/// `clinical_retention_until`) follows that date instead and stays on hold,
/// with the restriction's end moved along.
pub async fn requeue_expired_retention_holds(state: &AppState) -> Result<u64, sqlx::Error> {
    // Still kept: the hold follows the current end of the retention.
    let extended: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"UPDATE patient_privacy_requests pr
           SET retention_until = p.clinical_retention_until,
               updated_at = now()
           FROM patients p
           WHERE p.id = pr.patient_id
             AND pr.request_type = 'erasure'
             AND pr.status = 'retention_hold'
             AND pr.retention_until IS NOT NULL
             AND pr.retention_until <= now()
             AND p.clinical_retention_until > now()
           RETURNING pr.id, pr.patient_id"#,
    )
    .fetch_all(&state.db)
    .await?;
    for (request_id, patient_id) in &extended {
        sqlx::query(
            r#"UPDATE patients
               SET legal_status = legal_status || jsonb_build_object(
                       'processing_restricted_until', to_jsonb(clinical_retention_until))
               WHERE id = $1
                 AND legal_status->>'processing_restriction_request_id' = $2::text"#,
        )
        .bind(patient_id)
        .bind(request_id.to_string())
        .execute(&state.db)
        .await?;
    }

    let due_days =
        numeric_setting(state, "patient_erasure_due_days", DEFAULT_ERASURE_DUE_DAYS).await?;
    let due_at = Utc::now() + Duration::days(due_days.max(1));
    let requeued: Vec<RequeuedRequest> = sqlx::query_as(
        r#"WITH due AS (
               SELECT pr.id, pr.retention_until
               FROM patient_privacy_requests pr
               JOIN patients p ON p.id = pr.patient_id
               WHERE pr.status = 'retention_hold'
                 AND pr.retention_until IS NOT NULL
                 AND pr.retention_until <= now()
                 AND (pr.request_type <> 'erasure'
                      OR p.clinical_retention_until IS NULL
                      OR p.clinical_retention_until <= now())
                 AND (p.legal_status->>'anonymized_at') IS NULL
               ORDER BY pr.retention_until
               LIMIT 200
               FOR UPDATE OF pr SKIP LOCKED
           )
           UPDATE patient_privacy_requests pr
           SET status = 'requested',
               due_at = $1,
               decision_reason = NULL,
               updated_at = now(),
               context = COALESCE(pr.context, '{}'::jsonb)
                         || jsonb_build_object(
                                'requeued_at', now(),
                                'requeued_after_retention_until', due.retention_until,
                                'decision_history',
                                COALESCE(pr.context->'decision_history', '[]'::jsonb)
                                    || jsonb_build_array(jsonb_build_object(
                                        'action', 'requeue',
                                        'from_status', 'retention_hold',
                                        'to_status', 'requested',
                                        'reason', 'retention_ended',
                                        'by', NULL::uuid,
                                        'at', now(),
                                        'retention_until', due.retention_until)))
           FROM due
           WHERE pr.id = due.id
           RETURNING pr.id, pr.patient_id, pr.request_type, due.retention_until,
                     (SELECT trim(concat_ws(' · ', NULLIF(p.patient_id, ''),
                                 NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')))
                      FROM patients p WHERE p.id = pr.patient_id) AS patient_label"#,
    )
    .bind(due_at)
    .fetch_all(&state.db)
    .await?;

    let due_date = crate::app_time::local(due_at)
        .format("%Y-%m-%d")
        .to_string();
    for request in &requeued {
        let RequeuedRequest {
            id: request_id,
            patient_id,
            request_type,
            retention_until,
            patient_label,
        } = request;
        let retention_date = retention_until
            .map(|value| crate::app_time::local(value).format("%Y-%m-%d").to_string());
        state.audit_sender.try_send(audit::domain_event(
            "privacy_request_requeued",
            None,
            "patient",
            Some(*patient_id),
            json!({
                "request_id": request_id,
                "request_type": request_type,
                "previous_status": "retention_hold",
                "status": "requested",
                "retention_until": retention_until.map(|value| value.to_rfc3339()),
                "due_at": due_at.to_rfc3339(),
                "origin": "retention_hold_ended",
            }),
        ));
        sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id, params)
               SELECT u.id, 'privacy_request', $1, $2, 'patient', $3, $4
               FROM users u
               WHERE u.role IN ('ceo', 'it_admin') AND u.is_active = true"#,
        )
        .bind(format!(
            "Hold ended: {request_type} request of {patient_label} is due"
        ))
        .bind(format!(
            "The request was on hold until {}. It is back in the DSGVO queue. Due by {due_date}.",
            retention_date.as_deref().unwrap_or("-")
        ))
        .bind(patient_id)
        .bind(json!({
            "origin": "retention_hold_ended",
            "request_type": request_type,
            "patient_label": patient_label,
            "retention_until": retention_date,
            "due_date": due_date,
        }))
        .execute(&state.db)
        .await?;
        crate::realtime::publish_privacy_request_event(
            state,
            None,
            "privacy_request.reviewed",
            *request_id,
            json!({
                "patient_id": patient_id,
                "request_type": request_type,
                "review_action": "requeue",
                "previous_status": "retention_hold",
                "status": "requested",
                "due_at": due_at.to_rfc3339(),
            }),
        )
        .await;
    }
    Ok(requeued.len() as u64)
}
