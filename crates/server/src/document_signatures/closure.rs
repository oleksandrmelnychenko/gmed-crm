//! Closing signature requests outside the provider status (owner decision
//! 2026-09-28, Q9): an age cap for requests the poller cannot track, an
//! audited "abandon" for staff, and the resolution of `needs_review`.
//! Every closure notifies the requesting staff member and the CEO.

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::Response,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::{db_error, error};
use crate::{
    audit, auth::middleware::AuthUser, routes::documents::signature_document_access,
    state::AppState,
};
use gmed_domain::access::capabilities::Capability;

pub const STUCK_DAYS_SETTING: &str = "signature_stuck_request_days";
pub const DEFAULT_STUCK_DAYS: i64 = 3;
pub const MAX_STUCK_DAYS: i64 = 90;
const MIN_REASON_CHARS: usize = 10;
const MAX_REASON_CHARS: usize = 2000;

/// The poller can no longer resolve the request: an unknown submission without
/// a provider id, or the provider answers "not found". Healthy pending
/// requests (waiting for signers) are never closed by the age cap.
pub(crate) const UNTRACKABLE_CONDITION: &str =
    "((r.status = 'submission_unknown' AND r.provider_request_id IS NULL)
      OR (r.status IN ('pending', 'submission_unknown') AND r.last_error = 'provider_not_found'))";

pub(crate) fn normalize_stuck_days(value: i64) -> i64 {
    value.clamp(1, MAX_STUCK_DAYS)
}

async fn stuck_days(state: &AppState) -> i64 {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value #>> '{}' FROM system_settings WHERE key = $1")
            .bind(STUCK_DAYS_SETTING)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
    normalize_stuck_days(
        value
            .and_then(|raw| raw.trim().trim_matches('"').parse::<i64>().ok())
            .unwrap_or(DEFAULT_STUCK_DAYS),
    )
}

/// Tells the staff member who sent the request and every active CEO.
pub(crate) async fn notify_staff(
    state: &AppState,
    requested_by: Uuid,
    source_document_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
    let rows = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT u.id, $2, $3, $4, 'document', $5
           FROM users u
           WHERE u.is_active = true
             AND u.role <> 'patient'
             AND (u.id = $1 OR u.role = 'ceo')
           RETURNING id, user_id"#,
    )
    .bind(requested_by)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(source_document_id)
    .fetch_all(&state.db)
    .await;
    match rows {
        Ok(rows) => {
            for row in rows {
                crate::realtime::publish_notification_event(
                    state,
                    row.get::<Uuid, _>("user_id"),
                    "notification.created",
                    Some(row.get::<Uuid, _>("id")),
                    json!({ "entity_type": "document" }),
                )
                .await;
            }
        }
        Err(error) => tracing::warn!(%error, "notify signature staff"),
    }
}

/// Closes requests that stayed untrackable longer than
/// `signature_stuck_request_days` as `error`. Returns how many were closed.
pub async fn close_stuck_requests(state: &AppState) -> Result<u64, sqlx::Error> {
    let days = stuck_days(state).await;
    let mut tx = state.db.begin().await?;
    let rows = sqlx::query(&format!(
        r#"UPDATE document_signature_requests r
           SET status = 'error',
               closed_kind = 'auto_expired',
               closed_at = now(),
               close_reason = COALESCE(r.last_error, 'submission_unknown'),
               last_error = 'signature_request_untrackable',
               lease_until = NULL,
               lease_token = NULL,
               updated_at = now()
           WHERE {UNTRACKABLE_CONDITION}
             AND r.created_at < now() - ($1::bigint * interval '1 day')
             AND (r.lease_until IS NULL OR r.lease_until < now())
           RETURNING r.id, r.source_document_id, r.requested_by, r.close_reason"#
    ))
    .bind(days)
    .fetch_all(&mut *tx)
    .await?;
    for row in &rows {
        audit::write_in_transaction(
            &mut *tx,
            &audit::domain_event(
                "document_signature_closed_untrackable",
                None,
                "document",
                Some(row.get::<Uuid, _>("source_document_id")),
                json!({
                    "request_id": row.get::<Uuid, _>("id"),
                    "status": "error",
                    "cause": row.get::<Option<String>, _>("close_reason"),
                    "stuck_days": days,
                }),
            ),
        )
        .await?;
    }
    tx.commit().await?;
    for row in &rows {
        notify_staff(
            state,
            row.get("requested_by"),
            row.get("source_document_id"),
            "signature_request_failed",
            "Signature request could not be tracked",
            &format!(
                "The signature request stayed unconfirmed at the provider for {days} days and was closed as failed. Check the document and send a new request if needed."
            ),
        )
        .await;
    }
    Ok(rows.len() as u64)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReasonRequest {
    reason: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ResolveReviewRequest {
    /// `accept`: the signed content is accepted as valid (`completed`);
    /// `reject`: it is not (`error`), a new request can be sent.
    decision: String,
    reason: String,
}

#[allow(clippy::result_large_err)]
fn checked_reason(reason: &str) -> Result<String, Response> {
    let reason = reason.trim();
    let chars = reason.chars().count();
    if !(MIN_REASON_CHARS..=MAX_REASON_CHARS).contains(&chars) {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "signature_reason_required",
        ));
    }
    Ok(reason.to_string())
}

/// Whether staff may give up a request: untrackable, still unconfirmed, or
/// failing to poll. A healthy pending request is withdrawn instead.
pub(crate) fn can_abandon(
    status: &str,
    provider_request_id: Option<Uuid>,
    last_error: Option<&str>,
) -> bool {
    match status {
        "submission_unknown" => true,
        "pending" => provider_request_id.is_none() || last_error.is_some(),
        _ => false,
    }
}

/// `POST /document-signature-requests/{id}/abandon` — CEO/PM with edit access
/// to the document, or the signature administrator.
pub(crate) async fn abandon(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<ReasonRequest>,
) -> Result<Json<Value>, Response> {
    let reason = checked_reason(&body.reason)?;
    let source_id: Uuid = sqlx::query_scalar(
        "SELECT source_document_id FROM document_signature_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "signature_not_found"))?;
    if !auth.can(Capability::AdminSignatures) {
        signature_document_access(&state, &auth, source_id, true).await?;
    }

    let mut tx = state.db.begin().await.map_err(db_error)?;
    let row = sqlx::query(
        r#"SELECT status, provider_request_id, last_error, requested_by,
                  (lease_until IS NOT NULL AND lease_until > now()) AS leased
           FROM document_signature_requests WHERE id = $1 FOR UPDATE"#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    let status: String = row.get("status");
    if !can_abandon(
        &status,
        row.get("provider_request_id"),
        row.get::<Option<String>, _>("last_error").as_deref(),
    ) {
        return Err(error(StatusCode::CONFLICT, "signature_not_abandonable"));
    }
    if row.get::<bool, _>("leased") {
        return Err(error(StatusCode::CONFLICT, "signature_request_busy"));
    }
    sqlx::query(
        r#"UPDATE document_signature_requests
           SET status = 'error', closed_kind = 'abandoned', closed_by = $2, closed_at = now(),
               close_reason = $3, last_error = 'signature_request_abandoned',
               lease_until = NULL, lease_token = NULL, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(&reason)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    audit::write_in_transaction(
        &mut *tx,
        &audit::domain_event(
            "document_signature_abandoned",
            Some(auth.user_id),
            "document",
            Some(source_id),
            json!({ "request_id": id, "previous_status": status, "reason": reason }),
        ),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    let requested_by: Uuid = row.get("requested_by");
    if requested_by != auth.user_id {
        notify_staff(
            &state,
            requested_by,
            source_id,
            "signature_request_failed",
            "Signature request abandoned",
            &format!("The signature request was given up: {reason}"),
        )
        .await;
    }
    Ok(Json(json!({ "ok": true, "status": "error" })))
}

/// `POST /document-signature-requests/{id}/resolve-review` — CEO/PM with edit
/// access to the document decide on a request signed while its source changed.
pub(crate) async fn resolve_review(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<ResolveReviewRequest>,
) -> Result<Json<Value>, Response> {
    let reason = checked_reason(&body.reason)?;
    let (next_status, kind) = match body.decision.as_str() {
        "accept" => ("completed", "review_accepted"),
        "reject" => ("error", "review_rejected"),
        _ => {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "signature_review_decision_invalid",
            ));
        }
    };
    let source_id: Uuid = sqlx::query_scalar(
        "SELECT source_document_id FROM document_signature_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "signature_not_found"))?;
    signature_document_access(&state, &auth, source_id, true).await?;

    let mut tx = state.db.begin().await.map_err(db_error)?;
    let updated = sqlx::query(
        r#"UPDATE document_signature_requests
           SET status = $2, closed_kind = $3, closed_by = $4, closed_at = now(), close_reason = $5,
               last_error = CASE WHEN $2 = 'error' THEN 'signature_review_rejected' ELSE NULL END,
               updated_at = now()
           WHERE id = $1 AND status = 'needs_review'
           RETURNING result_document_id, requested_by"#,
    )
    .bind(id)
    .bind(next_status)
    .bind(kind)
    .bind(auth.user_id)
    .bind(&reason)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or_else(|| error(StatusCode::CONFLICT, "signature_not_in_review"))?;
    audit::write_in_transaction(
        &mut *tx,
        &audit::domain_event(
            "document_signature_review_resolved",
            Some(auth.user_id),
            "document",
            Some(source_id),
            json!({
                "request_id": id,
                "decision": body.decision,
                "status": next_status,
                "result_document_id": updated.get::<Option<Uuid>, _>("result_document_id"),
                "reason": reason,
            }),
        ),
    )
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(json!({ "ok": true, "status": next_status })))
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn only_untracked_or_failing_requests_can_be_abandoned() {
        assert!(can_abandon("submission_unknown", None, None));
        assert!(can_abandon(
            "pending",
            Some(Uuid::nil()),
            Some("provider_not_found")
        ));
        assert!(!can_abandon("pending", Some(Uuid::nil()), None));
        for status in [
            "completed",
            "needs_review",
            "declined",
            "withdrawn",
            "expired",
            "error",
        ] {
            assert!(!can_abandon(status, None, Some("x")));
        }
    }

    #[test]
    fn stuck_days_stay_within_bounds() {
        assert_eq!(normalize_stuck_days(0), 1);
        assert_eq!(normalize_stuck_days(3), 3);
        assert_eq!(normalize_stuck_days(1000), MAX_STUCK_DAYS);
    }
}
