//! Register of personal data breaches (Art. 33 DSGVO).
//!
//! Anyone on staff can report; only CEO and IT admin read the register and
//! decide. The supervisory authority must be told within 72 hours of becoming
//! aware unless the breach is unlikely to result in a risk, and then that
//! reasoning is what gets recorded. Minor incidents are kept here as well.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

const AUTHORITY_DEADLINE_HOURS: i64 = 72;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/compliance/incidents",
            get(list_incidents).post(report_incident),
        )
        .route(
            "/admin/compliance/incidents/{incident_id}",
            post(update_incident),
        )
}

#[derive(Deserialize)]
struct ReportIncidentRequest {
    title: String,
    description: String,
    category: String,
    severity: String,
    occurred_at: Option<DateTime<Utc>>,
    became_aware_at: Option<DateTime<Utc>>,
    affected_subjects_count: Option<i32>,
    #[serde(default)]
    data_categories: Vec<String>,
}

#[derive(Deserialize)]
struct UpdateIncidentRequest {
    status: Option<String>,
    severity: Option<String>,
    risk_assessment: Option<String>,
    affected_subjects_count: Option<i32>,
    authority_notified_at: Option<DateTime<Utc>>,
    authority_reference: Option<String>,
    no_notification_reason: Option<String>,
    subjects_notified_at: Option<DateTime<Utc>>,
    /// Art. 34 Abs. 3: why the data subjects of a high-risk breach are not told.
    subjects_no_notification_reason: Option<String>,
    /// Required to move a closed case back to an open status.
    reopen_reason: Option<String>,
    root_cause: Option<String>,
    measures_taken: Option<String>,
}

/// Length of the reason for reopening a closed case.
const MIN_REOPEN_REASON_CHARS: usize = 10;

/// The decision facts of an incident that the closing and reopening rules read.
struct IncidentDecisionState {
    status: String,
    risk_assessment: String,
    authority_documented: bool,
    subjects_notified: bool,
    subjects_reason: bool,
}

/// Why an incident cannot take the requested update, or `None` when it can.
/// `current` is the stored state; the request supplies what changes.
fn incident_update_conflict(
    current: &IncidentDecisionState,
    body: &UpdateIncidentRequest,
) -> Option<(StatusCode, &'static str)> {
    let supplied =
        |value: &Option<String>| value.as_deref().is_some_and(|text| !text.trim().is_empty());
    let next_status = body.status.as_deref().unwrap_or(current.status.as_str());
    let next_risk = body
        .risk_assessment
        .as_deref()
        .unwrap_or(current.risk_assessment.as_str());

    // A closed case reopens only with a reason (kept and audited).
    if current.status == "closed" && next_status != "closed" {
        let reason_ok = body
            .reopen_reason
            .as_deref()
            .map(str::trim)
            .is_some_and(|text| text.chars().count() >= MIN_REOPEN_REASON_CHARS);
        if !reason_ok {
            return Some((
                StatusCode::UNPROCESSABLE_ENTITY,
                "Reopening a closed incident needs a reason of at least 10 characters",
            ));
        }
    }

    let closes = body.status.as_deref() == Some("closed")
        || (current.status == "closed" && body.risk_assessment.is_some());
    if !closes {
        return None;
    }
    // A closed case must show either the report or why none was needed.
    let authority_documented = current.authority_documented
        || body.authority_notified_at.is_some()
        || supplied(&body.no_notification_reason);
    if !authority_documented {
        return Some((
            StatusCode::CONFLICT,
            "Record the authority notification or the reason for not notifying before closing",
        ));
    }
    // Art. 34: a high-risk breach is communicated to the data subjects, or the
    // reason for not doing so is on record.
    if next_risk == "high_risk" {
        let subjects_documented = current.subjects_notified
            || current.subjects_reason
            || body.subjects_notified_at.is_some()
            || supplied(&body.subjects_no_notification_reason);
        if !subjects_documented {
            return Some((
                StatusCode::CONFLICT,
                "A high-risk breach needs the notification of the data subjects or the reason for not notifying them before closing",
            ));
        }
    }
    None
}

async fn report_incident(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<ReportIncidentRequest>,
) -> axum::response::Response {
    if auth.role == Role::Patient {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let title = body.title.trim();
    let description = body.description.trim();
    if title.is_empty() || title.len() > 200 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "title must be 1 to 200 characters",
        );
    }
    if description.len() < 10 || description.len() > 8000 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "description must be 10 to 8000 characters",
        );
    }
    if !matches!(
        body.category.as_str(),
        "confidentiality" | "integrity" | "availability"
    ) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown category");
    }
    if !is_severity(&body.severity) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown severity");
    }
    if body.affected_subjects_count.is_some_and(|count| count < 0) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "affected_subjects_count must not be negative",
        );
    }
    let now = Utc::now();
    let became_aware_at = body.became_aware_at.unwrap_or(now);
    if became_aware_at > now + Duration::minutes(5) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "became_aware_at cannot lie in the future",
        );
    }
    let data_categories: Vec<String> = body
        .data_categories
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value.len() <= 100)
        .take(20)
        .collect();

    let row = sqlx::query(
        r#"INSERT INTO security_incidents (
                reference, title, description, category, severity, occurred_at,
                became_aware_at, affected_subjects_count, data_categories, reported_by
           ) VALUES (
                'INC-' || to_char(now(), 'YYYY') || '-' ||
                    lpad(nextval('security_incident_reference_seq')::text, 4, '0'),
                $1, $2, $3, $4, $5, $6, $7, $8, $9
           )
           RETURNING id, reference"#,
    )
    .bind(title)
    .bind(description)
    .bind(&body.category)
    .bind(&body.severity)
    .bind(body.occurred_at)
    .bind(became_aware_at)
    .bind(body.affected_subjects_count)
    .bind(&data_categories)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await;

    let row = match row {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, "report security incident");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to report incident",
            );
        }
    };
    let incident_id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
    let reference: String = row.try_get("reference").unwrap_or_default();

    state.audit_sender.try_send(audit::domain_event(
        "security_incident_reported",
        Some(auth.user_id),
        "security_incident",
        Some(incident_id),
        json!({
            "reference": reference,
            "category": body.category,
            "severity": body.severity,
            "became_aware_at": became_aware_at.to_rfc3339(),
        }),
    ));

    // The clock is already running: tell the people who have to decide.
    if let Err(e) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT u.id, 'security_incident', $1, $2, 'security_incident', $3
           FROM users u
           WHERE u.role IN ('ceo', 'it_admin') AND u.is_active = true AND u.id <> $4"#,
    )
    .bind(format!("Security incident {reference}: {title}"))
    .bind(format!(
        "Assess the risk. A report to the supervisory authority is due by {}.",
        authority_deadline_label(became_aware_at)
    ))
    .bind(incident_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        tracing::warn!(error = %e, incident_id = %incident_id, "notify about security incident");
    }

    (
        StatusCode::CREATED,
        Json(json!({ "id": incident_id, "reference": reference })),
    )
        .into_response()
}

async fn list_incidents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::IncidentsManage) {
        return e;
    }

    match sqlx::query(
        r#"SELECT i.*, reporter.name AS reported_by_name
           FROM security_incidents i
           JOIN users reporter ON reporter.id = i.reported_by
           ORDER BY i.became_aware_at DESC
           LIMIT 500"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(rows.iter().map(map_incident_row).collect::<Vec<_>>()).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list security incidents");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load incidents",
            )
        }
    }
}

async fn update_incident(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(incident_id): Path<Uuid>,
    Json(body): Json<UpdateIncidentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::IncidentsManage) {
        return e;
    }

    if body
        .status
        .as_deref()
        .is_some_and(|value| !matches!(value, "open" | "contained" | "resolved" | "closed"))
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown status");
    }
    if body
        .severity
        .as_deref()
        .is_some_and(|value| !is_severity(value))
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown severity");
    }
    if body
        .risk_assessment
        .as_deref()
        .is_some_and(|value| !matches!(value, "pending" | "no_risk" | "risk" | "high_risk"))
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown risk assessment");
    }
    if body.affected_subjects_count.is_some_and(|count| count < 0) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "affected_subjects_count must not be negative",
        );
    }
    let texts = [
        &body.authority_reference,
        &body.no_notification_reason,
        &body.subjects_no_notification_reason,
        &body.reopen_reason,
        &body.root_cause,
        &body.measures_taken,
    ];
    if texts
        .iter()
        .any(|value| value.as_deref().is_some_and(|text| text.len() > 8000))
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "text too long");
    }

    let failed = || {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update incident",
        )
    };
    // The rules read the stored decision, so it is locked until the update
    // commits: a parallel close or reopen waits instead of slipping past them.
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, incident_id = %incident_id, "begin security incident update");
            return failed();
        }
    };
    let current = match sqlx::query(
        r#"SELECT status, risk_assessment,
                  authority_notified_at IS NOT NULL OR no_notification_reason IS NOT NULL
                      AS authority_documented,
                  subjects_notified_at IS NOT NULL AS subjects_notified,
                  subjects_no_notification_reason IS NOT NULL AS subjects_reason
           FROM security_incidents
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(incident_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => IncidentDecisionState {
            status: row.try_get("status").unwrap_or_default(),
            risk_assessment: row.try_get("risk_assessment").unwrap_or_default(),
            authority_documented: row.try_get("authority_documented").unwrap_or(false),
            subjects_notified: row.try_get("subjects_notified").unwrap_or(false),
            subjects_reason: row.try_get("subjects_reason").unwrap_or(false),
        },
        Ok(None) => return err(StatusCode::NOT_FOUND, "Incident not found"),
        Err(e) => {
            tracing::error!(error = %e, incident_id = %incident_id, "load security incident");
            return failed();
        }
    };
    if let Some((status, message)) = incident_update_conflict(&current, &body) {
        return err(status, message);
    }
    let reopens = current.status == "closed"
        && body
            .status
            .as_deref()
            .is_some_and(|status| status != "closed");
    let reopen_reason = reopens
        .then(|| body.reopen_reason.as_deref().map(str::trim))
        .flatten();

    let row = sqlx::query(
        r#"UPDATE security_incidents SET
                status = COALESCE($2, status),
                severity = COALESCE($3, severity),
                risk_assessment = COALESCE($4, risk_assessment),
                affected_subjects_count = COALESCE($5, affected_subjects_count),
                authority_notified_at = COALESCE($6, authority_notified_at),
                authority_reference = COALESCE(NULLIF(btrim($7), ''), authority_reference),
                no_notification_reason = COALESCE(NULLIF(btrim($8), ''), no_notification_reason),
                subjects_notified_at = COALESCE($9, subjects_notified_at),
                root_cause = COALESCE(NULLIF(btrim($10), ''), root_cause),
                measures_taken = COALESCE(NULLIF(btrim($11), ''), measures_taken),
                updated_by = $12,
                subjects_no_notification_reason =
                    COALESCE(NULLIF(btrim($13), ''), subjects_no_notification_reason),
                reopened_at = CASE WHEN $14::text IS NOT NULL THEN now() ELSE reopened_at END,
                reopened_by = CASE WHEN $14::text IS NOT NULL THEN $12 ELSE reopened_by END,
                reopen_reason = COALESCE($14, reopen_reason),
                updated_at = now()
           WHERE id = $1
           RETURNING *, (SELECT name FROM users WHERE id = reported_by) AS reported_by_name"#,
    )
    .bind(incident_id)
    .bind(&body.status)
    .bind(&body.severity)
    .bind(&body.risk_assessment)
    .bind(body.affected_subjects_count)
    .bind(body.authority_notified_at)
    .bind(&body.authority_reference)
    .bind(&body.no_notification_reason)
    .bind(body.subjects_notified_at)
    .bind(&body.root_cause)
    .bind(&body.measures_taken)
    .bind(auth.user_id)
    .bind(&body.subjects_no_notification_reason)
    .bind(reopen_reason)
    .fetch_optional(&mut *tx)
    .await;

    let row = match row {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Incident not found"),
        Err(e) => {
            tracing::error!(error = %e, incident_id = %incident_id, "update security incident");
            return failed();
        }
    };
    let payload = map_incident_row(&row);
    if reopens {
        // The reopening is part of the evidence: it commits with the change.
        if let Err(e) = audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "security_incident_reopened",
                Some(auth.user_id),
                "security_incident",
                Some(incident_id),
                json!({
                    "previous_status": current.status,
                    "status": payload["status"],
                    "reason": reopen_reason,
                }),
            ),
        )
        .await
        {
            tracing::error!(error = %e, incident_id = %incident_id, "audit security incident reopening");
            return failed();
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, incident_id = %incident_id, "commit security incident update");
        return failed();
    }

    state.audit_sender.try_send(audit::domain_event(
        "security_incident_updated",
        Some(auth.user_id),
        "security_incident",
        Some(incident_id),
        json!({
            "status": payload["status"],
            "risk_assessment": payload["risk_assessment"],
            "authority_notified_at": payload["authority_notified_at"],
            "authority_notified_late": payload["authority_notified_late"],
            "subjects_notified_at": payload["subjects_notified_at"],
            "subjects_no_notification_reason": payload["subjects_no_notification_reason"],
        }),
    ));

    Json(payload).into_response()
}

/// The 72-hour deadline as staff read it: German wall-clock time, DD.MM.YYYY.
fn authority_deadline_label(became_aware_at: DateTime<Utc>) -> String {
    crate::app_time::local(became_aware_at + Duration::hours(AUTHORITY_DEADLINE_HOURS))
        .format("%d.%m.%Y %H:%M")
        .to_string()
}

fn is_severity(value: &str) -> bool {
    matches!(value, "low" | "medium" | "high" | "critical")
}

fn map_incident_row(row: &PgRow) -> Value {
    let timestamp = |column: &str| {
        row.try_get::<Option<DateTime<Utc>>, _>(column)
            .unwrap_or_default()
    };
    let text = |column: &str| row.try_get::<Option<String>, _>(column).unwrap_or_default();
    let became_aware_at = row
        .try_get::<DateTime<Utc>, _>("became_aware_at")
        .unwrap_or_else(|_| Utc::now());
    let authority_deadline = became_aware_at + Duration::hours(AUTHORITY_DEADLINE_HOURS);
    let authority_notified_at = timestamp("authority_notified_at");
    let no_notification_reason = text("no_notification_reason");
    let documented = authority_notified_at.is_some() || no_notification_reason.is_some();
    // Art. 33 Abs. 1: a report after 72 hours is late and must say why.
    let authority_notified_late =
        authority_notified_at.is_some_and(|notified_at| notified_at > authority_deadline);
    let risk_assessment = row
        .try_get::<String, _>("risk_assessment")
        .unwrap_or_default();
    let subjects_notified_at = timestamp("subjects_notified_at");
    let subjects_no_notification_reason = text("subjects_no_notification_reason");

    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "reference": row.try_get::<String, _>("reference").unwrap_or_default(),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "description": row.try_get::<String, _>("description").unwrap_or_default(),
        "category": row.try_get::<String, _>("category").unwrap_or_default(),
        "severity": row.try_get::<String, _>("severity").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "occurred_at": timestamp("occurred_at").map(|value| value.to_rfc3339()),
        "became_aware_at": became_aware_at.to_rfc3339(),
        "authority_deadline": authority_deadline.to_rfc3339(),
        "authority_notified_at": authority_notified_at.map(|value| value.to_rfc3339()),
        "authority_notified_late": authority_notified_late,
        "authority_reference": text("authority_reference"),
        "no_notification_reason": no_notification_reason,
        "notification_decision_documented": documented,
        "authority_deadline_missed": !documented && authority_deadline < Utc::now(),
        "subjects_notification_required": risk_assessment == "high_risk",
        "subjects_notified_at": subjects_notified_at.map(|value| value.to_rfc3339()),
        "subjects_no_notification_reason": subjects_no_notification_reason,
        "reopened_at": timestamp("reopened_at").map(|value| value.to_rfc3339()),
        "reopen_reason": text("reopen_reason"),
        "risk_assessment": risk_assessment,
        "affected_subjects_count": row.try_get::<Option<i32>, _>("affected_subjects_count").unwrap_or_default(),
        "data_categories": row.try_get::<Vec<String>, _>("data_categories").unwrap_or_default(),
        "root_cause": text("root_cause"),
        "measures_taken": text("measures_taken"),
        "reported_by_name": row.try_get::<String, _>("reported_by_name").unwrap_or_default(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authority_deadline_is_shown_in_german_time_and_date_format() {
        let summer = DateTime::parse_from_rfc3339("2026-09-28T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(authority_deadline_label(summer), "01.10.2026 10:00");

        let winter = DateTime::parse_from_rfc3339("2026-12-01T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(authority_deadline_label(winter), "04.12.2026 09:00");
    }

    fn update(value: serde_json::Value) -> UpdateIncidentRequest {
        serde_json::from_value(value).expect("update request")
    }

    fn stored(status: &str, risk: &str) -> IncidentDecisionState {
        IncidentDecisionState {
            status: status.to_string(),
            risk_assessment: risk.to_string(),
            authority_documented: true,
            subjects_notified: false,
            subjects_reason: false,
        }
    }

    #[test]
    fn a_closed_incident_reopens_only_with_a_reason() {
        let closed = stored("closed", "no_risk");
        assert!(incident_update_conflict(&closed, &update(json!({ "status": "open" }))).is_some());
        assert!(
            incident_update_conflict(
                &closed,
                &update(json!({ "status": "open", "reopen_reason": "too short" }))
            )
            .is_some()
        );
        assert!(
            incident_update_conflict(
                &closed,
                &update(
                    json!({ "status": "open", "reopen_reason": "New evidence from the clinic" })
                )
            )
            .is_none()
        );
        // Editing the notes of a closed case is not a reopening.
        assert!(
            incident_update_conflict(&closed, &update(json!({ "measures_taken": "Training" })))
                .is_none()
        );
    }

    #[test]
    fn a_high_risk_incident_closes_only_with_the_subjects_told_or_a_reason() {
        let open = stored("open", "high_risk");
        let close = update(json!({ "status": "closed" }));
        assert_eq!(
            incident_update_conflict(&open, &close).map(|(status, _)| status),
            Some(StatusCode::CONFLICT)
        );
        assert!(
            incident_update_conflict(
                &open,
                &update(
                    json!({ "status": "closed", "subjects_notified_at": "2026-09-28T10:00:00Z" })
                )
            )
            .is_none()
        );
        assert!(
            incident_update_conflict(
                &open,
                &update(json!({
                    "status": "closed",
                    "subjects_no_notification_reason": "Data was encrypted (Art. 34 Abs. 3 lit. a)"
                }))
            )
            .is_none()
        );
        // Raising the risk of a closed case applies the same rule.
        let closed = stored("closed", "risk");
        assert!(
            incident_update_conflict(&closed, &update(json!({ "risk_assessment": "high_risk" })))
                .is_some()
        );
        // Any other risk closes with the authority decision alone.
        assert!(incident_update_conflict(&stored("open", "risk"), &close).is_none());
    }
}
