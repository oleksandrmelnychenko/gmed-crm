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
    root_cause: Option<String>,
    measures_taken: Option<String>,
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
        (became_aware_at + Duration::hours(AUTHORITY_DEADLINE_HOURS)).format("%Y-%m-%d %H:%M UTC")
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
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin]) {
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
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin]) {
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
        &body.root_cause,
        &body.measures_taken,
    ];
    if texts
        .iter()
        .any(|value| value.as_deref().is_some_and(|text| text.len() > 8000))
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "text too long");
    }

    // A closed case must show either the report or why none was needed.
    if body.status.as_deref() == Some("closed") {
        let supplied = body.authority_notified_at.is_some()
            || body
                .no_notification_reason
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty());
        let documented = match sqlx::query_scalar::<_, bool>(
            r#"SELECT authority_notified_at IS NOT NULL OR no_notification_reason IS NOT NULL
               FROM security_incidents
               WHERE id = $1"#,
        )
        .bind(incident_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(value)) => value,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Incident not found"),
            Err(e) => {
                tracing::error!(error = %e, incident_id = %incident_id, "load security incident");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update incident",
                );
            }
        };
        if !supplied && !documented {
            return err(
                StatusCode::CONFLICT,
                "Record the authority notification or the reason for not notifying before closing",
            );
        }
    }

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
    .fetch_optional(&state.db)
    .await;

    let row = match row {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Incident not found"),
        Err(e) => {
            tracing::error!(error = %e, incident_id = %incident_id, "update security incident");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update incident",
            );
        }
    };
    let payload = map_incident_row(&row);

    state.audit_sender.try_send(audit::domain_event(
        "security_incident_updated",
        Some(auth.user_id),
        "security_incident",
        Some(incident_id),
        json!({
            "status": payload["status"],
            "risk_assessment": payload["risk_assessment"],
            "authority_notified_at": payload["authority_notified_at"],
            "subjects_notified_at": payload["subjects_notified_at"],
        }),
    ));

    Json(payload).into_response()
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

    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "reference": row.try_get::<String, _>("reference").unwrap_or_default(),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "description": row.try_get::<String, _>("description").unwrap_or_default(),
        "category": row.try_get::<String, _>("category").unwrap_or_default(),
        "severity": row.try_get::<String, _>("severity").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "risk_assessment": row.try_get::<String, _>("risk_assessment").unwrap_or_default(),
        "occurred_at": timestamp("occurred_at").map(|value| value.to_rfc3339()),
        "became_aware_at": became_aware_at.to_rfc3339(),
        "authority_deadline": authority_deadline.to_rfc3339(),
        "authority_notified_at": authority_notified_at.map(|value| value.to_rfc3339()),
        "authority_reference": text("authority_reference"),
        "no_notification_reason": no_notification_reason,
        "notification_decision_documented": documented,
        "authority_deadline_missed": !documented && authority_deadline < Utc::now(),
        "subjects_notified_at": timestamp("subjects_notified_at").map(|value| value.to_rfc3339()),
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
