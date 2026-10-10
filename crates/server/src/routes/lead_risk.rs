//! Staff API of the risk assessment (contract section 4; engine in
//! [`crate::risk`]).
//!
//! * `GET /leads/{id}/risk-assessment` (`leads.edit` or the CEO Assistant):
//!   reassesses, then shows points, level, triggers, blocks, status,
//!   decisions and history; before the start a live `preview`.
//! * Decisions of a reviewer (`risk.review` — the CEO — or a deputy named in
//!   the configuration): `request_more`, `release`, `reject` with a reason;
//!   at level 3 release and reject are proposals a second reviewer confirms
//!   (four eyes). `restart` starts a grandfathered or not started lead.
//! * Staff enter the identity document data the lead only uploads
//!   (`PUT …/identity-document-data`, also per representative).
//! * The configuration (`GET` reviewers, `PUT` CEO) and the review queue.
//!
//! The lead and the payer never reach any of this (P2).

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::risk::store::{self, Assessment, Cause, DecisionError};
use crate::risk::{self, RiskConfig, Sticky, cabinet};
use crate::routes::lead_payer;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/leads/{lead_id}/risk-assessment", get(get_assessment))
        .route(
            "/leads/{lead_id}/risk-assessment/decisions",
            post(post_decision),
        )
        .route(
            "/leads/{lead_id}/risk-assessment/decisions/{decision_id}/confirm",
            post(confirm_decision),
        )
        .route(
            "/leads/{lead_id}/risk-assessment/decisions/{decision_id}/withdraw",
            post(withdraw_decision),
        )
        .route(
            "/leads/{lead_id}/risk-assessment/restart",
            post(restart_assessment),
        )
        .route(
            "/leads/{lead_id}/identity-document-data",
            get(get_identity_data).put(put_identity_data),
        )
        .route(
            "/leads/{lead_id}/representatives/{representative_id}/identity-document-data",
            axum::routing::put(put_representative_identity_data),
        )
        .route("/compliance/risk-config", get(get_config).put(put_config))
        .route("/compliance/risk-reviews", get(review_queue))
        .merge(cabinet::router())
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "error": code, "code": code, "message": message })),
    )
        .into_response()
}

fn forbidden() -> Response {
    error(
        StatusCode::FORBIDDEN,
        "forbidden",
        "Insufficient permissions",
    )
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "not_found", "Lead not found")
}

fn database(error: impl std::fmt::Display, what: &str) -> Response {
    tracing::error!(%error, what, "lead risk assessment");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Internal Server Error", "message": "Failed" })),
    )
        .into_response()
}

async fn lead_exists(conn: &mut PgConnection, lead_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM leads WHERE id = $1)")
        .bind(lead_id)
        .fetch_one(&mut *conn)
        .await
}

// ----------------------------------------------------------------------------
// The assessment
// ----------------------------------------------------------------------------

fn trigger_json(trigger: &Sticky) -> Value {
    let blocks: Vec<&str> = risk::trigger_blocks(&trigger.key)
        .iter()
        .copied()
        .filter(|block| !(matches!(*block, "H" | "J") && trigger.subject != risk::SUBJECT_PATIENT))
        .collect();
    json!({
        "key": trigger.key,
        "subject": trigger.subject,
        "variant": trigger.variant,
        "points": trigger.points,
        "knockout": trigger.knockout,
        "active": trigger.active,
        "first_fired_at": trigger.first_fired_at,
        "last_fired_at": trigger.last_fired_at,
        "blocks": blocks,
    })
}

async fn decisions_json(conn: &mut PgConnection, lead_id: Uuid) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT d.id, d.decision, d.reason, d.blocks, d.level, d.fingerprint, d.decided_by,
                  u.name AS decided_by_name, d.decided_at, d.confirms_decision_id,
                  d.withdraws_decision_id,
                  EXISTS (SELECT 1 FROM lead_risk_decisions c WHERE c.confirms_decision_id = d.id)
                      AS confirmed,
                  EXISTS (SELECT 1 FROM lead_risk_decisions w WHERE w.withdraws_decision_id = d.id)
                      AS withdrawn
           FROM lead_risk_decisions d
           LEFT JOIN users u ON u.id = d.decided_by
           WHERE d.lead_id = $1
           ORDER BY d.decided_at, d.id"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .iter()
        .map(|row| {
            let decision: String = row.try_get("decision").unwrap_or_default();
            let level: i16 = row.try_get("level").unwrap_or(1);
            let confirms: Option<Uuid> = row.try_get("confirms_decision_id").ok().flatten();
            let withdraws: Option<Uuid> = row.try_get("withdraws_decision_id").ok().flatten();
            let proposal = confirms.is_none()
                && withdraws.is_none()
                && level >= 3
                && decision != "request_more";
            let kind = if confirms.is_some() {
                "confirmation"
            } else if withdraws.is_some() {
                "withdrawal"
            } else if proposal {
                "proposal"
            } else {
                "decision"
            };
            let proposal_state = proposal.then(|| {
                if row.try_get::<bool, _>("confirmed").unwrap_or(false) {
                    "confirmed"
                } else if row.try_get::<bool, _>("withdrawn").unwrap_or(false) {
                    "withdrawn"
                } else {
                    "pending"
                }
            });
            json!({
                "id": row.try_get::<Uuid, _>("id").ok(),
                "kind": kind,
                "decision": decision,
                "reason": row.try_get::<String, _>("reason").ok(),
                "blocks": row.try_get::<Vec<String>, _>("blocks").unwrap_or_default(),
                "level": level,
                "fingerprint": row.try_get::<String, _>("fingerprint").ok(),
                "decided_by": row.try_get::<Uuid, _>("decided_by").ok(),
                "decided_by_name": row.try_get::<Option<String>, _>("decided_by_name").ok().flatten(),
                "decided_at": row.try_get::<DateTime<Utc>, _>("decided_at").ok(),
                "confirms_decision_id": confirms,
                "withdraws_decision_id": withdraws,
                "proposal_state": proposal_state,
            })
        })
        .collect())
}

async fn history_json(conn: &mut PgConnection, lead_id: Uuid) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT e.at, e.kind, e.level, e.points, e.patient_points, e.payer_points, e.triggers,
                  e.status, e.cause, e.actor, u.name AS actor_name
           FROM lead_risk_events e
           LEFT JOIN users u ON u.id = e.actor
           WHERE e.lead_id = $1
           ORDER BY e.at, e.id"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .iter()
        .map(|row| {
            json!({
                "at": row.try_get::<DateTime<Utc>, _>("at").ok(),
                "kind": row.try_get::<String, _>("kind").ok(),
                "level": row.try_get::<Option<i16>, _>("level").ok().flatten(),
                "points": row.try_get::<Option<i32>, _>("points").ok().flatten(),
                "patient_points": row.try_get::<Option<i32>, _>("patient_points").ok().flatten(),
                "payer_points": row.try_get::<Option<i32>, _>("payer_points").ok().flatten(),
                "triggers": row.try_get::<Value, _>("triggers").unwrap_or_else(|_| json!([])),
                "status": row.try_get::<Option<String>, _>("status").ok().flatten(),
                "cause": row.try_get::<String, _>("cause").ok(),
                "actor": row.try_get::<Option<Uuid>, _>("actor").ok().flatten(),
                "actor_name": row.try_get::<Option<String>, _>("actor_name").ok().flatten(),
            })
        })
        .collect())
}

/// The object of `GET /leads/{id}/risk-assessment` (contract 4.1).
async fn assessment_json(
    conn: &mut PgConnection,
    lead_id: Uuid,
    auth: &AuthUser,
) -> Result<Value, sqlx::Error> {
    let config = store::load_config(conn).await?;
    let stored = store::load(conn, lead_id).await?;
    let started = stored.as_ref().is_some_and(Assessment::started);
    let inputs = risk::inputs::load(conn, lead_id).await?.unwrap_or_default();
    let preview = if started {
        Value::Null
    } else {
        let fired = risk::evaluate(&inputs, &config);
        let score = risk::score_fired(&fired, &config);
        let triggers = risk::merge(&[], &fired, Utc::now(), false).triggers;
        json!({
            "level": score.level,
            "points": score.points,
            "patient_points": score.patient_points,
            "payer_points": score.payer_points,
            "knockout": score.knockout,
            "triggers": triggers.iter().map(trigger_json).collect::<Vec<_>>(),
        })
    };
    let answers = store::load_block_answers(conn, lead_id, &inputs, None).await?;
    let (triggers, level, requested) = match &stored {
        Some(assessment) if started => (
            assessment.triggers.clone(),
            assessment.score.level,
            assessment.requested_blocks.clone(),
        ),
        _ => (Vec::new(), 1, Vec::new()),
    };
    let states = store::block_states(&triggers, level, &requested, &config, &answers);
    let blocks: Map<String, Value> = states
        .iter()
        .map(|(block, state)| (block.to_string(), json!(state)))
        .collect();
    let decisions = decisions_json(conn, lead_id).await?;
    let pending = decisions
        .iter()
        .find(|decision| decision["proposal_state"] == "pending")
        .map(|decision| {
            json!({
                "id": decision["id"],
                "decision": decision["decision"],
                "reason": decision["reason"],
                "blocks": decision["blocks"],
                "decided_by": decision["decided_by"],
                "decided_by_name": decision["decided_by_name"],
                "decided_at": decision["decided_at"],
            })
        });
    let history = history_json(conn, lead_id).await?;
    let reviewers = store::reviewer_counts(conn, &config).await?;
    let reviewer = store::is_reviewer(auth, &config);
    let review_notice = store::review_notice(conn, lead_id).await?;
    let can_confirm = reviewer
        && pending
            .as_ref()
            .is_some_and(|pending| pending["decided_by"] != json!(auth.user_id));
    let score = stored
        .as_ref()
        .map(|assessment| assessment.score)
        .unwrap_or_default();
    Ok(json!({
        "lead_id": lead_id,
        "started_at": stored.as_ref().and_then(|assessment| assessment.started_at),
        "status": stored.as_ref().map(|assessment| assessment.status.clone()),
        "level": started.then_some(score.level),
        "points": started.then_some(score.points),
        "patient_points": started.then_some(score.patient_points),
        "payer_points": started.then_some(score.payer_points),
        "knockout": started && score.knockout,
        "triggers": triggers.iter().map(trigger_json).collect::<Vec<_>>(),
        "blocks": blocks,
        "requested_blocks": requested,
        "follow_up_answered_at": stored.as_ref().and_then(|assessment| assessment.follow_up_answered_at),
        "review_notice": review_notice,
        "preview": preview,
        "decisions": decisions,
        "history": history,
        "pending_proposal": pending,
        "config_version": stored
            .as_ref()
            .map(|assessment| assessment.config_version)
            .unwrap_or(config.version),
        "can_decide": reviewer && started,
        "can_confirm": can_confirm,
        "can_restart": reviewer && !started,
        "four_eyes_required": started && score.level >= 3,
        // Everybody who may decide, split into CEO accounts and named deputies.
        "reviewers_available": reviewers.total(),
        "reviewers_ceo": reviewers.ceo,
        "reviewers_deputies": reviewers.deputies,
    }))
}

async fn get_assessment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if !lead_payer::may_view(&auth) {
        return forbidden();
    }
    let result = async {
        let mut tx = state.db.begin().await?;
        if !lead_exists(&mut tx, lead_id).await? {
            return Ok(None);
        }
        store::reassess(&mut tx, lead_id, Cause::Read, Some(auth.user_id)).await?;
        let value = assessment_json(&mut tx, lead_id, &auth).await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Some(value))
    }
    .await;
    match result {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => not_found(),
        Err(error) => database(error, "load assessment"),
    }
}

#[derive(Deserialize)]
struct DecisionRequest {
    decision: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    blocks: Vec<String>,
}

#[derive(Deserialize, Default)]
struct ReasonRequest {
    #[serde(default)]
    reason: Option<String>,
}

/// The optional `{ reason }` of a confirmation or withdrawal (an empty body
/// is fine).
fn optional_reason(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<ReasonRequest>(body)
        .ok()
        .and_then(|request| request.reason)
}

fn decision_error(refusal: DecisionError) -> Response {
    match refusal {
        DecisionError::NotStarted => error(
            StatusCode::CONFLICT,
            "assessment_not_started",
            "The assessment of this lead has not started",
        ),
        DecisionError::InvalidDecision => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_decision",
            "Decision must be release, request_more or reject",
        ),
        DecisionError::BlocksRequired => error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "blocks_required",
            "Name the blocks (A–J) to request",
        ),
        DecisionError::ProposalPending => error(
            StatusCode::CONFLICT,
            "proposal_pending",
            "A proposal waits for its second reviewer",
        ),
        DecisionError::ProposalNotPending => error(
            StatusCode::CONFLICT,
            "proposal_not_pending",
            "This proposal is no longer pending",
        ),
        DecisionError::SameUser => error(
            StatusCode::CONFLICT,
            "four_eyes_same_user",
            "A second reviewer must confirm the proposal",
        ),
        DecisionError::NotProposer => error(
            StatusCode::FORBIDDEN,
            "not_proposer",
            "Only the proposer withdraws a proposal",
        ),
        DecisionError::AssessmentChanged => error(
            StatusCode::CONFLICT,
            "assessment_changed",
            "The assessment changed since the proposal; propose again",
        ),
        DecisionError::Database(failure) => database(failure, "decide"),
    }
}

async fn reviewer_or_forbidden(state: &AppState, auth: &AuthUser) -> Result<RiskConfig, Response> {
    let mut conn = state
        .db
        .acquire()
        .await
        .map_err(|error| database(error, "acquire"))?;
    let config = store::load_config(&mut conn)
        .await
        .map_err(|error| database(error, "load config"))?;
    if store::is_reviewer(auth, &config) {
        Ok(config)
    } else {
        Err(forbidden())
    }
}

async fn respond_with_assessment(
    state: &AppState,
    auth: &AuthUser,
    lead_id: Uuid,
    status: StatusCode,
) -> Response {
    let result = async {
        let mut conn = state.db.acquire().await?;
        assessment_json(&mut conn, lead_id, auth).await
    }
    .await;
    match result {
        Ok(value) => (status, Json(value)).into_response(),
        Err(error) => database(error, "load assessment"),
    }
}

/// `POST /leads/{id}/risk-assessment/decisions`.
async fn post_decision(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<DecisionRequest>,
) -> Response {
    if let Err(response) = reviewer_or_forbidden(&state, &auth).await {
        return response;
    }
    let reason = body.reason.trim().to_string();
    let length = reason.chars().count();
    if !(cabinet::MIN_REASON_CHARS..=cabinet::MAX_REASON_CHARS).contains(&length) {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reason_required",
            "A reason of at least 10 characters is required",
        );
    }
    let result = async {
        let mut tx = state.db.begin().await?;
        if !lead_exists(&mut tx, lead_id).await? {
            return Ok(Err(not_found()));
        }
        let outcome = match store::decide(
            &mut tx,
            lead_id,
            body.decision.trim(),
            &reason,
            &body.blocks,
            auth.user_id,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(DecisionError::Database(error)) => return Err(error),
            Err(other) => return Ok(Err(decision_error(other))),
        };
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Ok(outcome))
    }
    .await;
    match result {
        Ok(Ok(outcome)) => {
            crate::realtime::publish_lead_event(
                &state,
                Some(auth.user_id),
                "lead.updated",
                lead_id,
                json!({ "risk_assessment": true }),
            )
            .await;
            tracing::info!(decision_id = %outcome.id, %lead_id, "lead risk decision");
            let status = if outcome.proposed {
                StatusCode::ACCEPTED
            } else {
                StatusCode::CREATED
            };
            respond_with_assessment(&state, &auth, lead_id, status).await
        }
        Ok(Err(response)) => response,
        Err(error) => database(error, "decide"),
    }
}

async fn proposal_action(
    state: &AppState,
    auth: &AuthUser,
    lead_id: Uuid,
    decision_id: Uuid,
    reason: Option<String>,
    confirm: bool,
) -> Response {
    if let Err(response) = reviewer_or_forbidden(state, auth).await {
        return response;
    }
    let result = async {
        let mut tx = state.db.begin().await?;
        let outcome = if confirm {
            store::confirm(
                &mut tx,
                lead_id,
                decision_id,
                reason.as_deref(),
                auth.user_id,
            )
            .await
        } else {
            store::withdraw(
                &mut tx,
                lead_id,
                decision_id,
                reason.as_deref(),
                auth.user_id,
            )
            .await
        };
        match outcome {
            Ok(_) => {}
            Err(DecisionError::Database(error)) => {
                // The database's four-eyes trigger answers like the server check.
                if error.to_string().contains("four_eyes_same_user") {
                    return Ok(Err(decision_error(DecisionError::SameUser)));
                }
                return Err(error);
            }
            Err(other) => return Ok(Err(decision_error(other))),
        }
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Ok(()))
    }
    .await;
    match result {
        Ok(Ok(())) => {
            crate::realtime::publish_lead_event(
                state,
                Some(auth.user_id),
                "lead.updated",
                lead_id,
                json!({ "risk_assessment": true }),
            )
            .await;
            respond_with_assessment(state, auth, lead_id, StatusCode::OK).await
        }
        Ok(Err(response)) => response,
        Err(error) => database(error, "proposal"),
    }
}

/// `POST /leads/{id}/risk-assessment/decisions/{decision_id}/confirm`.
async fn confirm_decision(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, decision_id)): Path<(Uuid, Uuid)>,
    body: axum::body::Bytes,
) -> Response {
    proposal_action(
        &state,
        &auth,
        lead_id,
        decision_id,
        optional_reason(&body),
        true,
    )
    .await
}

/// `POST /leads/{id}/risk-assessment/decisions/{decision_id}/withdraw`.
async fn withdraw_decision(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, decision_id)): Path<(Uuid, Uuid)>,
    body: axum::body::Bytes,
) -> Response {
    proposal_action(
        &state,
        &auth,
        lead_id,
        decision_id,
        optional_reason(&body),
        false,
    )
    .await
}

/// `POST /leads/{id}/risk-assessment/restart` (reviewer): starts a
/// grandfathered or not started assessment.
async fn restart_assessment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if let Err(response) = reviewer_or_forbidden(&state, &auth).await {
        return response;
    }
    let result = async {
        let mut tx = state.db.begin().await?;
        let started =
            store::start(&mut tx, lead_id, Cause::Staff, Some(auth.user_id), true).await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(started.is_some())
    }
    .await;
    match result {
        Ok(true) => respond_with_assessment(&state, &auth, lead_id, StatusCode::OK).await,
        Ok(false) => not_found(),
        Err(error) => database(error, "restart"),
    }
}

// ----------------------------------------------------------------------------
// Identity document data (staff)
// ----------------------------------------------------------------------------

/// The validated identity data of a staff body (only the sent keys).
#[derive(Debug, Default, Clone, PartialEq)]
struct IdentityData {
    document_type: Option<Option<String>>,
    document_number: Option<Option<String>>,
    issuing_authority: Option<Option<String>>,
    issuing_country: Option<Option<String>>,
    issued_on: Option<Option<NaiveDate>>,
    valid_until: Option<Option<NaiveDate>>,
    unreadable: Option<bool>,
}

const IDENTITY_KEYS: [&str; 7] = [
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_issued_on",
    "id_valid_until",
    "id_document_unreadable",
];

fn invalid(field: &str, message: &str) -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({ "error": "invalid_field", "code": "invalid_field", "field": field, "message": message })),
    )
        .into_response()
}

/// Reads a staff body. A past validity date is accepted (that is T12); a
/// date of issue in the future is not.
fn parse_identity_data(body: &Value, today: NaiveDate) -> Result<IdentityData, Response> {
    let Some(object) = body.as_object() else {
        return Err(invalid("body", "A JSON object is expected"));
    };
    if let Some(unknown) = object
        .keys()
        .find(|key| !IDENTITY_KEYS.contains(&key.as_str()))
    {
        return Err(invalid(unknown, "Unknown field"));
    }
    let text = |key: &'static str, max: usize| -> Result<Option<Option<String>>, Response> {
        match object.get(key) {
            None => Ok(None),
            Some(Value::Null) => Ok(Some(None)),
            Some(Value::String(value)) => {
                let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
                if value.chars().count() > max {
                    return Err(invalid(key, "Too long"));
                }
                Ok(Some((!value.is_empty()).then_some(value)))
            }
            Some(_) => Err(invalid(key, "A text is expected")),
        }
    };
    let date = |key: &'static str| -> Result<Option<Option<NaiveDate>>, Response> {
        match text(key, 10)? {
            None => Ok(None),
            Some(None) => Ok(Some(None)),
            Some(Some(value)) => NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                .map(|date| Some(Some(date)))
                .map_err(|_| invalid(key, "Use YYYY-MM-DD")),
        }
    };
    let document_type = text("id_document_type", 40)?;
    if let Some(Some(kind)) = &document_type
        && !crate::routes::lead_portal_intake::ID_DOCUMENT_TYPE_VALUES.contains(&kind.as_str())
    {
        return Err(invalid("id_document_type", "Not one of the document types"));
    }
    let issuing_country = match text("id_issuing_country", 2)? {
        Some(Some(code)) => {
            let code = code.to_ascii_uppercase();
            if code.len() != 2 || !code.chars().all(|ch| ch.is_ascii_uppercase()) {
                return Err(invalid("id_issuing_country", "Use an ISO country code"));
            }
            Some(Some(code))
        }
        other => other,
    };
    let issued_on = date("id_issued_on")?;
    if let Some(Some(issued)) = issued_on
        && issued > today
    {
        return Err(invalid("id_issued_on", "Date of issue is in the future"));
    }
    let unreadable = match object.get("id_document_unreadable") {
        None => None,
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::Null) => Some(false),
        Some(_) => {
            return Err(invalid(
                "id_document_unreadable",
                "true or false is expected",
            ));
        }
    };
    Ok(IdentityData {
        document_type,
        document_number: text("id_document_number", 60)?,
        issuing_authority: text("id_issuing_authority", 200)?,
        issuing_country,
        issued_on,
        valid_until: date("id_valid_until")?,
        unreadable,
    })
}

const IDENTITY_SELECT: &str = r#"x.id_document_type, x.id_document_number, x.id_issuing_authority,
     x.id_issuing_country, x.id_issued_on, x.id_valid_until, x.id_document_unreadable,
     x.id_data_entered_by, u.name AS id_data_entered_by_name, x.id_data_entered_at"#;

fn identity_json(row: &sqlx::postgres::PgRow) -> Value {
    let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
    let date = |column: &str| {
        row.try_get::<Option<NaiveDate>, _>(column)
            .ok()
            .flatten()
            .map(|date| date.format("%Y-%m-%d").to_string())
    };
    json!({
        "id_document_type": text("id_document_type"),
        "id_document_number": text("id_document_number"),
        "id_issuing_authority": text("id_issuing_authority"),
        "id_issuing_country": text("id_issuing_country"),
        "id_issued_on": date("id_issued_on"),
        "id_valid_until": date("id_valid_until"),
        "id_document_unreadable": row.try_get::<bool, _>("id_document_unreadable").unwrap_or(false),
        "id_data_entered_by": row.try_get::<Option<Uuid>, _>("id_data_entered_by").ok().flatten(),
        "id_data_entered_by_name": text("id_data_entered_by_name"),
        "id_data_entered_at": row.try_get::<Option<DateTime<Utc>>, _>("id_data_entered_at").ok().flatten(),
    })
}

/// `GET /leads/{id}/identity-document-data`.
async fn get_identity_data(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if !lead_payer::may_view(&auth) {
        return forbidden();
    }
    let row = sqlx::query(&format!(
        r#"SELECT {IDENTITY_SELECT}
           FROM leads l
           LEFT JOIN lead_gwg_declarations x ON x.lead_id = l.id
           LEFT JOIN users u ON u.id = x.id_data_entered_by
           WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await;
    match row {
        Ok(Some(row)) => Json(identity_json(&row)).into_response(),
        Ok(None) => not_found(),
        Err(error) => database(error, "load identity data"),
    }
}

fn changed_identity_keys(data: &IdentityData) -> Vec<&'static str> {
    [
        ("id_document_type", data.document_type.is_some()),
        ("id_document_number", data.document_number.is_some()),
        ("id_issuing_authority", data.issuing_authority.is_some()),
        ("id_issuing_country", data.issuing_country.is_some()),
        ("id_issued_on", data.issued_on.is_some()),
        ("id_valid_until", data.valid_until.is_some()),
        ("id_document_unreadable", data.unreadable.is_some()),
    ]
    .into_iter()
    .filter_map(|(key, sent)| sent.then_some(key))
    .collect()
}

/// `PUT /leads/{id}/identity-document-data` (`leads.edit`): staff enter the
/// patient's identity document data (the one source the GwG sheet, the
/// portal intake and the conversion read). Reassesses (T12).
async fn put_identity_data(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let data = match parse_identity_data(&body, crate::app_time::today()) {
        Ok(data) => data,
        Err(response) => return response,
    };
    let fields = changed_identity_keys(&data);
    let result = async {
        let mut tx = state.db.begin().await?;
        if !lead_exists(&mut tx, lead_id).await? {
            return Ok(None);
        }
        sqlx::query(
            r#"INSERT INTO lead_gwg_declarations (lead_id) VALUES ($1)
               ON CONFLICT (lead_id) DO NOTHING"#,
        )
        .bind(lead_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"UPDATE lead_gwg_declarations SET
                   id_document_type = CASE WHEN $2 THEN $3 ELSE id_document_type END,
                   id_document_number = CASE WHEN $4 THEN $5 ELSE id_document_number END,
                   id_issuing_authority = CASE WHEN $6 THEN $7 ELSE id_issuing_authority END,
                   id_issuing_country = CASE WHEN $8 THEN $9 ELSE id_issuing_country END,
                   id_issued_on = CASE WHEN $10 THEN $11 ELSE id_issued_on END,
                   id_valid_until = CASE WHEN $12 THEN $13 ELSE id_valid_until END,
                   id_document_unreadable = COALESCE($14, id_document_unreadable),
                   id_data_entered_by = $15,
                   id_data_entered_at = now()
               WHERE lead_id = $1"#,
        )
        .bind(lead_id)
        .bind(data.document_type.is_some())
        .bind(data.document_type.clone().flatten())
        .bind(data.document_number.is_some())
        .bind(data.document_number.clone().flatten())
        .bind(data.issuing_authority.is_some())
        .bind(data.issuing_authority.clone().flatten())
        .bind(data.issuing_country.is_some())
        .bind(data.issuing_country.clone().flatten())
        .bind(data.issued_on.is_some())
        .bind(data.issued_on.flatten())
        .bind(data.valid_until.is_some())
        .bind(data.valid_until.flatten())
        .bind(data.unreadable)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "lead_identity_document_data_updated",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({ "fields": fields }),
            ),
        )
        .await?;
        store::reassess(&mut tx, lead_id, Cause::Staff, Some(auth.user_id)).await?;
        let row = sqlx::query(&format!(
            r#"SELECT {IDENTITY_SELECT}
               FROM lead_gwg_declarations x
               LEFT JOIN users u ON u.id = x.id_data_entered_by
               WHERE x.lead_id = $1"#
        ))
        .bind(lead_id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Some(identity_json(&row)))
    }
    .await;
    match result {
        Ok(Some(value)) => {
            crate::realtime::publish_lead_event(
                &state,
                Some(auth.user_id),
                "lead.updated",
                lead_id,
                json!({ "identity_document_data": true }),
            )
            .await;
            Json(value).into_response()
        }
        Ok(None) => not_found(),
        Err(error) => database(error, "store identity data"),
    }
}

/// `PUT /leads/{id}/representatives/{rid}/identity-document-data`
/// (`leads.edit`): the same for a representative of the lead.
async fn put_representative_identity_data(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let data = match parse_identity_data(&body, crate::app_time::today()) {
        Ok(data) => data,
        Err(response) => return response,
    };
    let fields = changed_identity_keys(&data);
    let result = async {
        let mut tx = state.db.begin().await?;
        let updated = sqlx::query(
            r#"UPDATE lead_representatives SET
                   id_document_type = CASE WHEN $3 THEN $4 ELSE id_document_type END,
                   id_document_number = CASE WHEN $5 THEN $6 ELSE id_document_number END,
                   id_issuing_authority = CASE WHEN $7 THEN $8 ELSE id_issuing_authority END,
                   id_issuing_country = CASE WHEN $9 THEN $10 ELSE id_issuing_country END,
                   id_issued_on = CASE WHEN $11 THEN $12 ELSE id_issued_on END,
                   id_valid_until = CASE WHEN $13 THEN $14 ELSE id_valid_until END,
                   id_document_unreadable = COALESCE($15, id_document_unreadable),
                   id_data_entered_by = $16,
                   id_data_entered_at = now()
               WHERE lead_id = $1 AND contact_id = $2"#,
        )
        .bind(lead_id)
        .bind(representative_id)
        .bind(data.document_type.is_some())
        .bind(data.document_type.clone().flatten())
        .bind(data.document_number.is_some())
        .bind(data.document_number.clone().flatten())
        .bind(data.issuing_authority.is_some())
        .bind(data.issuing_authority.clone().flatten())
        .bind(data.issuing_country.is_some())
        .bind(data.issuing_country.clone().flatten())
        .bind(data.issued_on.is_some())
        .bind(data.issued_on.flatten())
        .bind(data.valid_until.is_some())
        .bind(data.valid_until.flatten())
        .bind(data.unreadable)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if updated == 0 {
            return Ok(None);
        }
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "lead_representative_identity_document_data_updated",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({ "representative_id": representative_id, "fields": fields }),
            ),
        )
        .await?;
        store::reassess(&mut tx, lead_id, Cause::Staff, Some(auth.user_id)).await?;
        let row = sqlx::query(&format!(
            r#"SELECT {IDENTITY_SELECT}
               FROM lead_representatives x
               LEFT JOIN users u ON u.id = x.id_data_entered_by
               WHERE x.lead_id = $1 AND x.contact_id = $2"#
        ))
        .bind(lead_id)
        .bind(representative_id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Some(identity_json(&row)))
    }
    .await;
    match result {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => error(
            StatusCode::NOT_FOUND,
            "not_found",
            "Representative not found",
        ),
        Err(error) => database(error, "store representative identity data"),
    }
}

// ----------------------------------------------------------------------------
// Configuration and review queue
// ----------------------------------------------------------------------------

async fn eligible_reviewers(conn: &mut PgConnection) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, name, role FROM users WHERE is_active ORDER BY name, id")
        .fetch_all(&mut *conn)
        .await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let role_text: String = row.try_get("role").ok()?;
            let role: gmed_domain::role::Role =
                serde_json::from_value(json!(role_text.clone())).ok()?;
            (store::reviewer_role_eligible(role) && !role.can(Capability::RiskReview)).then(|| {
                json!({
                    "id": row.try_get::<Uuid, _>("id").ok(),
                    "name": row.try_get::<String, _>("name").ok(),
                    "role": role_text,
                })
            })
        })
        .collect())
}

async fn config_json(conn: &mut PgConnection) -> Result<Value, sqlx::Error> {
    let config = store::load_config(conn).await?;
    let mut value = serde_json::to_value(&config).unwrap_or_else(|_| json!({}));
    value["eligible_reviewers"] = json!(eligible_reviewers(conn).await?);
    // CEO accounts decide by role, deputies by name: both counted apart so the
    // page does not present CEO accounts as deputies (QA 2026-10-10).
    let reviewers = store::reviewer_counts(conn, &config).await?;
    value["reviewers_available"] = json!(reviewers.total());
    value["reviewers_ceo"] = json!(reviewers.ceo);
    value["reviewers_deputies"] = json!(reviewers.deputies);
    Ok(value)
}

/// `GET /compliance/risk-config` (reviewers).
async fn get_config(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = reviewer_or_forbidden(&state, &auth).await {
        return response;
    }
    let result = async {
        let mut conn = state.db.acquire().await?;
        config_json(&mut conn).await
    }
    .await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => database(error, "load config"),
    }
}

/// `PUT /compliance/risk-config` (`sanctions.review` = CEO): validates and
/// stores the configuration with the next version, audited in the same
/// transaction. Stored assessments are never lowered; raises apply at the
/// next reassessment.
async fn put_config(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let mut body = body;
    if let Some(object) = body.as_object_mut() {
        object.remove("eligible_reviewers");
        object.remove("reviewers_available");
        object.remove("reviewers_ceo");
        object.remove("reviewers_deputies");
        object.entry("version").or_insert(json!(1));
    }
    let config: RiskConfig = match serde_json::from_value(body) {
        Ok(config) => config,
        Err(_) => return invalid("body", "The configuration could not be read"),
    };
    let mut config = match config.validated() {
        Ok(config) => config,
        Err(error) => return invalid(error.field, error.message),
    };
    let result = async {
        let mut tx = state.db.begin().await?;
        // Reviewers: active staff of an eligible role.
        if !config.reviewers.is_empty() {
            let rows = sqlx::query("SELECT id, role FROM users WHERE id = ANY($1) AND is_active")
                .bind(&config.reviewers)
                .fetch_all(&mut *tx)
                .await?;
            let eligible = rows
                .iter()
                .filter(|row| {
                    row.try_get::<String, _>("role")
                        .ok()
                        .and_then(|role| serde_json::from_value::<gmed_domain::role::Role>(json!(role)).ok())
                        .is_some_and(store::reviewer_role_eligible)
                })
                .count();
            if eligible != config.reviewers.len() {
                return Ok(Err(invalid(
                    "reviewers",
                    "Reviewers must be active staff with lead access (not Sales, CEO Assistant or interpreters)",
                )));
            }
        }
        let previous = store::load_config(&mut tx).await?;
        config.version = previous.version + 1;
        sqlx::query(
            r#"INSERT INTO system_settings (key, value, description, updated_by, updated_at)
               VALUES ($1, $2, $3, $4, now())
               ON CONFLICT (key) DO UPDATE
               SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()"#,
        )
        .bind(risk::CONFIG_SETTING)
        .bind(serde_json::to_value(&config).unwrap_or_else(|_| json!({})))
        .bind("Risk assessment of leads: country lists, points, thresholds, level bounds, reviewers; CEO only")
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "risk_config_updated",
                Some(auth.user_id),
                "system_settings",
                None,
                json!({
                    "key": risk::CONFIG_SETTING,
                    "previous_version": previous.version,
                    "version": config.version,
                    "previous": serde_json::to_value(&previous).unwrap_or(Value::Null),
                    "value": serde_json::to_value(&config).unwrap_or(Value::Null),
                }),
            ),
        )
        .await?;
        let value = config_json(&mut tx).await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Ok(value))
    }
    .await;
    match result {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(response)) => response,
        Err(error) => database(error, "store config"),
    }
}

/// `GET /compliance/risk-reviews` (reviewers): leads waiting for a review, a
/// second reviewer or the lead's answers, oldest first.
async fn review_queue(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = reviewer_or_forbidden(&state, &auth).await {
        return response;
    }
    let rows = sqlx::query(
        r#"SELECT a.lead_id, a.status, a.level, a.points, a.knockout, a.updated_at,
                  l.first_name, l.last_name,
                  COALESCE(
                      (SELECT max(e.at) FROM lead_risk_events e
                       WHERE e.lead_id = a.lead_id AND e.status = a.status
                         AND e.kind IN ('status', 'started')),
                      a.updated_at
                  ) AS since,
                  p.id AS proposal_id, p.decision AS proposal_decision,
                  p.decided_at AS proposal_at, pu.name AS proposal_by_name
           FROM lead_risk_assessments a
           JOIN leads l ON l.id = a.lead_id
           LEFT JOIN LATERAL (
               SELECT d.id, d.decision, d.decided_at, d.decided_by
               FROM lead_risk_decisions d
               WHERE d.lead_id = a.lead_id AND d.level = 3
                 AND d.decision IN ('release', 'reject')
                 AND d.confirms_decision_id IS NULL AND d.withdraws_decision_id IS NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM lead_risk_decisions r
                     WHERE r.confirms_decision_id = d.id OR r.withdraws_decision_id = d.id
                 )
               ORDER BY d.decided_at DESC
               LIMIT 1
           ) p ON true
           LEFT JOIN users pu ON pu.id = p.decided_by
           WHERE a.status IN ('review_required', 'proposed', 'awaiting_answers')
             AND l.qualification_status <> 'deleted'
           ORDER BY since, a.lead_id"#,
    )
    .fetch_all(&state.db)
    .await;
    match rows {
        Ok(rows) => {
            let items: Vec<Value> = rows
                .iter()
                .map(|row| {
                    let name = [
                        row.try_get::<Option<String>, _>("first_name").ok().flatten(),
                        row.try_get::<Option<String>, _>("last_name").ok().flatten(),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ");
                    let proposal_id: Option<Uuid> = row.try_get("proposal_id").ok().flatten();
                    json!({
                        "lead_id": row.try_get::<Uuid, _>("lead_id").ok(),
                        "name": name,
                        "status": row.try_get::<String, _>("status").ok(),
                        "level": row.try_get::<i16, _>("level").ok(),
                        "points": row.try_get::<i32, _>("points").ok(),
                        "knockout": row.try_get::<bool, _>("knockout").unwrap_or(false),
                        "since": row.try_get::<DateTime<Utc>, _>("since").ok(),
                        "pending_proposal": proposal_id.map(|id| json!({
                            "id": id,
                            "decision": row.try_get::<Option<String>, _>("proposal_decision").ok().flatten(),
                            "decided_at": row.try_get::<Option<DateTime<Utc>>, _>("proposal_at").ok().flatten(),
                            "decided_by_name": row.try_get::<Option<String>, _>("proposal_by_name").ok().flatten(),
                        })),
                    })
                })
                .collect();
            Json(json!({ "items": items })).into_response()
        }
        Err(error) => database(error, "load review queue"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 7).unwrap()
    }

    #[test]
    fn staff_identity_data_accept_past_validity_but_not_future_issue() {
        let data = parse_identity_data(
            &json!({
                "id_document_type": "passport",
                "id_document_number": " AB 123 ",
                "id_issuing_country": "ua",
                "id_valid_until": "2020-01-31",
                "id_document_unreadable": true,
            }),
            today(),
        )
        .unwrap();
        assert_eq!(data.document_number, Some(Some("AB 123".into())));
        assert_eq!(data.issuing_country, Some(Some("UA".into())));
        assert_eq!(data.valid_until, Some(NaiveDate::from_ymd_opt(2020, 1, 31)));
        assert_eq!(data.unreadable, Some(true));
        assert_eq!(data.issued_on, None);
        assert_eq!(
            changed_identity_keys(&data),
            [
                "id_document_type",
                "id_document_number",
                "id_issuing_country",
                "id_valid_until",
                "id_document_unreadable"
            ]
        );
        assert!(parse_identity_data(&json!({ "id_issued_on": "2026-10-08" }), today()).is_err());
        assert!(parse_identity_data(&json!({ "id_document_type": "visa" }), today()).is_err());
        assert!(parse_identity_data(&json!({ "first_name": "Anna" }), today()).is_err());
        assert!(parse_identity_data(&json!({ "id_valid_until": "31.01.2020" }), today()).is_err());
    }
}
