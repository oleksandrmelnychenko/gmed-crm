//! HTTP surface of the sanctions screening (`crate::sanctions`).
//!
//! * `POST /sanctions/check` — live check of a name for wizard step 1; answers
//!   only clear / possible match and the list date, never list details.
//! * `GET /sanctions/leads/{id}/status`, `GET /sanctions/leads/flags` — banner
//!   and list badge for staff who see leads.
//! * Everything else is the CEO's (`sanctions.review`): hits and decisions,
//!   list versions, manual upload, refresh, blocked countries, country lifts.

use std::io::{Cursor, Read};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::sanctions::fsf::MAX_XML_BYTES;
use crate::sanctions::matching::Subject;
use crate::sanctions::normalize::country_code;
use crate::sanctions::store::{ImportError, ImportOutcome, ImportSource};
use crate::sanctions::{
    HIT_ENTITY_TYPE, download, gate, normalized_reason, policy, screening, store,
};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

/// Upload limit for the manual list file (XML or a ZIP with one XML).
const MAX_UPLOAD_BYTES: usize = 64 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    let upload = Router::new()
        .route("/sanctions/list/upload", post(upload_list))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES + 1024 * 1024));
    Router::new()
        .route("/sanctions/check", post(live_check))
        .route("/sanctions/leads/flags", get(lead_flags))
        .route("/sanctions/leads/{lead_id}/status", get(lead_status))
        .route(
            "/sanctions/leads/{lead_id}/country-override",
            post(lift_lead_country_block),
        )
        .route(
            "/sanctions/patients/{patient_id}/country-override",
            post(lift_patient_country_block),
        )
        .route(
            "/sanctions/country-overrides/{override_id}/revoke",
            post(revoke_country_lift),
        )
        .route("/sanctions/country-blocks", get(country_blocks))
        .route("/sanctions/hits", get(list_hits))
        .route("/sanctions/hits/{hit_id}", get(get_hit))
        .route("/sanctions/hits/{hit_id}/decision", post(decide_hit))
        .route("/sanctions/list", get(list_status))
        .route("/sanctions/list/refresh", post(refresh_list))
        .route(
            "/sanctions/settings/blocked-countries",
            put(update_blocked_countries),
        )
        .merge(upload)
}

fn err(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({ "error": code, "message": message }))).into_response()
}

fn db_err(error: sqlx::Error, context: &str) -> Response {
    tracing::error!(error = %error, context, "Sanctions screening database error");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "sanctions_database_error",
        "Failed",
    )
}

// ── Live check ─────────────────────────────────────────────

#[derive(Deserialize)]
struct LiveCheckRequest {
    first_name: String,
    last_name: String,
    middle_name: Option<String>,
    date_of_birth: Option<String>,
    #[serde(default)]
    citizenships: Vec<String>,
    /// The lead being edited: screened (from its stored data) right away so
    /// that a possible match reaches the CEO without waiting for the queue.
    lead_id: Option<Uuid>,
}

async fn live_check(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<LiveCheckRequest>,
) -> Response {
    if let Err(response) = auth.require_any_capability(&[
        Capability::LeadsEdit,
        Capability::PatientsEdit,
        Capability::SanctionsReview,
    ]) {
        return response;
    }
    if body.first_name.chars().count() > 200 || body.last_name.chars().count() > 200 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_name",
            "Name is too long",
        );
    }
    let date_of_birth = body
        .date_of_birth
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    let mut citizenships: Vec<String> = Vec::new();
    for value in body.citizenships.iter().take(20) {
        if let Some(code) = country_code(value)
            && !citizenships.contains(&code)
        {
            citizenships.push(code);
        }
    }
    let subject = Subject {
        first_name: body.first_name,
        middle_name: body.middle_name,
        last_name: body.last_name,
        date_of_birth,
        citizenships,
        organisation: false,
    };
    let result = match screening::live_check(&state, subject).await {
        Ok(result) => result,
        Err(error) => return db_err(error, "live check"),
    };
    if let Some(lead_id) = body.lead_id
        && auth.can(Capability::LeadsEdit)
        && let Err(error) = screening::screen_lead(&state, lead_id).await
    {
        tracing::warn!(error = %error, lead_id = %lead_id, "Screening the edited lead failed");
    }
    Json(result).into_response()
}

// ── Lead banner and list badge ─────────────────────────────

async fn screen_if_queued(state: &AppState, lead_id: Uuid) -> Result<(), sqlx::Error> {
    let queued: Option<Uuid> = sqlx::query_scalar(
        r#"DELETE FROM sanctions_screening_queue
           WHERE subject_type = 'lead' AND subject_id = $1
           RETURNING subject_id"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await?;
    if queued.is_some() {
        screening::screen_lead(state, lead_id).await?;
    }
    Ok(())
}

async fn lead_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsView) {
        return response;
    }
    let exists: Result<bool, sqlx::Error> =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM leads WHERE id = $1)")
            .bind(lead_id)
            .fetch_one(&state.db)
            .await;
    match exists {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::NOT_FOUND, "not_found", "Lead not found"),
        Err(error) => return db_err(error, "lead exists"),
    }
    if let Err(error) = screen_if_queued(&state, lead_id).await {
        tracing::warn!(error = %error, lead_id = %lead_id, "Screening a queued lead failed");
    }
    match gate::lead_status(&state, lead_id).await {
        Ok(status) => {
            let mut value = json!(status);
            value["can_lift_country_block"] = json!(auth.can(Capability::SanctionsReview));
            value["can_review"] = json!(auth.can(Capability::SanctionsReview));
            Json(value).into_response()
        }
        Err(error) => db_err(error, "lead status"),
    }
}

async fn lead_flags(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsView) {
        return response;
    }
    match gate::lead_flags(&state).await {
        Ok(flags) => Json(flags).into_response(),
        Err(error) => db_err(error, "lead flags"),
    }
}

// ── Country block lifts (CEO) ──────────────────────────────

#[derive(Deserialize)]
struct ReasonRequest {
    reason: String,
}

async fn lift_lead_country_block(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<ReasonRequest>,
) -> Response {
    lift_country_block(
        state,
        auth,
        gate::Scope::lead(lead_id),
        Some(lead_id),
        None,
        body,
    )
    .await
}

async fn lift_patient_country_block(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<ReasonRequest>,
) -> Response {
    lift_country_block(
        state,
        auth,
        gate::Scope::patient(patient_id),
        None,
        Some(patient_id),
        body,
    )
    .await
}

async fn lift_country_block(
    state: AppState,
    auth: AuthUser,
    scope: gate::Scope,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    body: ReasonRequest,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let Some(reason) = normalized_reason(&body.reason) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reason_required",
            "A reason of at least 10 characters is required",
        );
    };
    let found = async {
        let scope = scope.expand(&state.db).await?;
        let blocked = policy::blocked_countries(&state.db).await?;
        let mut countries: Vec<String> = Vec::new();
        for lead in screening::load_leads_subjects(&state.db, &scope.lead_ids).await? {
            for subject in lead.subjects {
                countries.extend(subject.countries());
            }
        }
        for patient in &scope.patient_ids {
            if let Some(subject) = screening::load_patient_subject(&state.db, *patient).await? {
                countries.extend(subject.countries());
            }
        }
        Ok::<_, sqlx::Error>(policy::evaluate_countries(&countries, &blocked, &[]).found)
    }
    .await;
    let found = match found {
        Ok(found) => found,
        Err(error) => return db_err(error, "country block lift"),
    };
    match policy::lift_block(&state, lead_id, patient_id, &found, &reason, auth.user_id).await {
        Ok(lift) => (StatusCode::CREATED, Json(json!(lift))).into_response(),
        Err(policy::OverrideError::NothingToLift) => err(
            StatusCode::CONFLICT,
            "no_blocked_country",
            "No blocked country applies; nothing to lift",
        ),
        Err(policy::OverrideError::Db(error)) => db_err(error, "country block lift"),
    }
}

async fn revoke_country_lift(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(override_id): Path<Uuid>,
    Json(body): Json<ReasonRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let Some(reason) = normalized_reason(&body.reason) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reason_required",
            "A reason of at least 10 characters is required",
        );
    };
    match policy::revoke_lift(&state, override_id, &reason, auth.user_id).await {
        Ok(true) => Json(json!({ "ok": true })).into_response(),
        Ok(false) => err(StatusCode::NOT_FOUND, "not_found", "No active lift"),
        Err(error) => db_err(error, "revoke country lift"),
    }
}

/// Leads and patients a blocked country currently affects (CEO).
async fn country_blocks(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let result = async {
        let flags = gate::lead_flags(&state).await?;
        let mut items = Vec::new();
        for flag in flags
            .iter()
            .filter(|flag| matches!(flag.flag, "blocked_country" | "country_lifted"))
        {
            let status = gate::lead_status(&state, flag.lead_id).await?;
            let name: Option<(String, String)> =
                sqlx::query_as("SELECT first_name, last_name FROM leads WHERE id = $1")
                    .bind(flag.lead_id)
                    .fetch_optional(&state.db)
                    .await?;
            items.push(json!({
                "lead_id": flag.lead_id,
                "name": name.map(|(first, last)| format!("{first} {last}")),
                "flag": flag.flag,
                "found": status.country.found,
                "blocking": status.country.blocking,
                "lift": status.country.lift,
            }));
        }
        Ok::<_, sqlx::Error>(items)
    }
    .await;
    match result {
        Ok(items) => Json(json!({ "leads": items })).into_response(),
        Err(error) => db_err(error, "country blocks"),
    }
}

// ── Hits (CEO) ─────────────────────────────────────────────

#[derive(Deserialize)]
struct HitsQuery {
    status: Option<String>,
}

const HIT_SELECT: &str = r#"
    SELECT h.id, h.subject_kind, h.lead_id, h.patient_id, h.subject_ref, h.subject_snapshot,
           h.list_logical_id, h.list_entry, h.score, h.match_details, h.status,
           h.still_matches, h.last_screened_at, h.decided_at, h.decision_reason,
           h.created_at, v.list_date AS list_version_date, u.name AS decided_by_name,
           COALESCE(l.first_name || ' ' || l.last_name,
                    p.first_name || ' ' || p.last_name) AS owner_name,
           p.patient_id AS patient_number,
           l.qualification_status AS lead_status
    FROM sanctions_hits h
    JOIN sanctions_list_versions v ON v.id = h.list_version_id
    LEFT JOIN users u ON u.id = h.decided_by
    LEFT JOIN leads l ON l.id = h.lead_id
    LEFT JOIN patients p ON p.id = h.patient_id
"#;

async fn hit_json(state: &AppState, row: &sqlx::postgres::PgRow) -> Result<Value, sqlx::Error> {
    let lead_id: Option<Uuid> = row.try_get("lead_id")?;
    let patient_id: Option<Uuid> = row.try_get("patient_id")?;
    let subject_kind: String = row.try_get("subject_kind")?;
    let subject_ref: String = row.try_get("subject_ref")?;
    // The person as recorded now, next to the snapshot taken at the match.
    let current = match (lead_id, patient_id) {
        (Some(lead_id), _) => screening::load_lead_subjects(&state.db, lead_id)
            .await?
            .and_then(|lead| {
                lead.subjects.into_iter().find(|subject| {
                    subject.kind.as_str() == subject_kind && subject.subject_ref == subject_ref
                })
            }),
        (None, Some(patient_id)) => screening::load_patient_subject(&state.db, patient_id).await?,
        (None, None) => None,
    };
    Ok(json!({
        "id": row.try_get::<Uuid, _>("id")?,
        "subject_kind": subject_kind,
        "lead_id": lead_id,
        "patient_id": patient_id,
        "patient_number": row.try_get::<Option<String>, _>("patient_number")?,
        "lead_status": row.try_get::<Option<String>, _>("lead_status")?,
        "owner_name": row.try_get::<Option<String>, _>("owner_name")?,
        "subject_snapshot": row.try_get::<Value, _>("subject_snapshot")?,
        "current_subject": current.map(|record| json!({
            "first_name": record.subject.first_name,
            "middle_name": record.subject.middle_name,
            "last_name": record.subject.last_name,
            "date_of_birth": record.subject.date_of_birth,
            "citizenships": record.subject.citizenships,
            "residence": record.residence,
            "organisation": record.subject.organisation,
            "relation": record.relation,
        })),
        "list_logical_id": row.try_get::<String, _>("list_logical_id")?,
        "list_entry": row.try_get::<Value, _>("list_entry")?,
        "list_version_date": row.try_get::<NaiveDate, _>("list_version_date")?,
        "score": row.try_get::<f64, _>("score")?,
        "match_details": row.try_get::<Value, _>("match_details")?,
        "status": row.try_get::<String, _>("status")?,
        "still_matches": row.try_get::<bool, _>("still_matches")?,
        "last_screened_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("last_screened_at")?,
        "decided_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("decided_at")?,
        "decided_by_name": row.try_get::<Option<String>, _>("decided_by_name")?,
        "decision_reason": row.try_get::<Option<String>, _>("decision_reason")?,
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")?,
    }))
}

async fn list_hits(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<HitsQuery>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let status = query.status.unwrap_or_else(|| "open".to_string());
    if !matches!(
        status.as_str(),
        "open" | "false_positive" | "confirmed" | "all"
    ) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_status",
            "Invalid status",
        );
    }
    let result = async {
        let rows = sqlx::query(&format!(
            "{HIT_SELECT} WHERE ($1 = 'all' OR h.status = $1) ORDER BY h.created_at DESC LIMIT 500"
        ))
        .bind(&status)
        .fetch_all(&state.db)
        .await?;
        let mut hits = Vec::with_capacity(rows.len());
        for row in &rows {
            hits.push(hit_json(&state, row).await?);
        }
        let counts = sqlx::query(
            r#"SELECT COUNT(*) FILTER (WHERE status = 'open') AS open,
                      COUNT(*) FILTER (WHERE status = 'false_positive') AS false_positive,
                      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed
               FROM sanctions_hits"#,
        )
        .fetch_one(&state.db)
        .await?;
        Ok::<_, sqlx::Error>(json!({
            "hits": hits,
            "counts": {
                "open": counts.try_get::<i64, _>("open")?,
                "false_positive": counts.try_get::<i64, _>("false_positive")?,
                "confirmed": counts.try_get::<i64, _>("confirmed")?,
            },
        }))
    }
    .await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => db_err(error, "list hits"),
    }
}

async fn get_hit(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(hit_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let row = match sqlx::query(&format!("{HIT_SELECT} WHERE h.id = $1"))
        .bind(hit_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "not_found", "Hit not found"),
        Err(error) => return db_err(error, "get hit"),
    };
    match hit_json(&state, &row).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => db_err(error, "get hit"),
    }
}

#[derive(Deserialize)]
struct DecisionRequest {
    decision: String,
    reason: String,
}

async fn decide_hit(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(hit_id): Path<Uuid>,
    Json(body): Json<DecisionRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    if !matches!(body.decision.as_str(), "false_positive" | "confirmed") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_decision",
            "Decision must be false_positive or confirmed",
        );
    }
    let Some(reason) = normalized_reason(&body.reason) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "reason_required",
            "A reason of at least 10 characters is required",
        );
    };
    let result = async {
        let mut tx = state.db.begin().await?;
        let Some(row) = sqlx::query(
            r#"SELECT status, subject_kind, lead_id, patient_id, list_logical_id,
                      list_entry->>'eu_reference' AS eu_reference, score
               FROM sanctions_hits WHERE id = $1 FOR UPDATE"#,
        )
        .bind(hit_id)
        .fetch_optional(&mut *tx)
        .await?
        else {
            return Ok(Err(err(StatusCode::NOT_FOUND, "not_found", "Hit not found")));
        };
        let status: String = row.try_get("status")?;
        if status != "open" {
            return Ok(Err(err(
                StatusCode::CONFLICT,
                "sanctions_hit_decided",
                "This possible match is already decided; the decision is final",
            )));
        }
        let lead_id: Option<Uuid> = row.try_get("lead_id")?;
        let patient_id: Option<Uuid> = row.try_get("patient_id")?;
        sqlx::query(
            r#"UPDATE sanctions_hits
               SET status = $2, decided_by = $3, decided_at = now(), decision_reason = $4,
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(hit_id)
        .bind(&body.decision)
        .bind(auth.user_id)
        .bind(&reason)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE user_notifications SET is_read = true WHERE entity_type = $1 AND entity_id = $2",
        )
        .bind(HIT_ENTITY_TYPE)
        .bind(hit_id)
        .execute(&mut *tx)
        .await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "sanctions_hit_decided",
                Some(auth.user_id),
                HIT_ENTITY_TYPE,
                Some(hit_id),
                json!({
                    "decision": body.decision,
                    "reason": reason,
                    "subject_kind": row.try_get::<String, _>("subject_kind")?,
                    "lead_id": lead_id,
                    "patient_id": patient_id,
                    "list_logical_id": row.try_get::<String, _>("list_logical_id")?,
                    "eu_reference": row.try_get::<Option<String>, _>("eu_reference")?,
                    "score": row.try_get::<f64, _>("score")?,
                }),
            ),
        )
        .await?;
        // The risk assessment of the leads concerned: a false positive that
        // leaves no open or confirmed hit withdraws T16 (the only way down, P3).
        let affected: Vec<Uuid> = sqlx::query_scalar(
            r#"SELECT id FROM leads
               WHERE id = $1
                  OR ($2::uuid IS NOT NULL
                      AND (prospect_patient_id = $2 OR converted_patient_id = $2))"#,
        )
        .bind(lead_id)
        .bind(patient_id)
        .fetch_all(&mut *tx)
        .await?;
        for affected_lead in affected {
            crate::risk::store::after_hit_decision(&mut tx, affected_lead, auth.user_id).await?;
        }
        tx.commit().await?;
        Ok::<_, sqlx::Error>(Ok(lead_id))
    }
    .await;
    match result {
        Ok(Ok(lead_id)) => {
            if let Some(lead_id) = lead_id {
                crate::realtime::publish_lead_event(
                    &state,
                    Some(auth.user_id),
                    "lead.updated",
                    lead_id,
                    json!({ "sanctions": body.decision }),
                )
                .await;
            }
            match sqlx::query(&format!("{HIT_SELECT} WHERE h.id = $1"))
                .bind(hit_id)
                .fetch_one(&state.db)
                .await
            {
                Ok(row) => match hit_json(&state, &row).await {
                    Ok(value) => Json(value).into_response(),
                    Err(error) => db_err(error, "decided hit"),
                },
                Err(error) => db_err(error, "decided hit"),
            }
        }
        Ok(Err(response)) => response,
        Err(error) => db_err(error, "decide hit"),
    }
}

// ── List versions, upload, refresh, settings (CEO) ─────────

async fn list_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let result = async {
        let status = store::list_status(&state.db).await?;
        let blocked = policy::blocked_countries(&state.db).await?;
        Ok::<_, sqlx::Error>(json!({ "list": status, "blocked_countries": blocked }))
    }
    .await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => db_err(error, "list status"),
    }
}

async fn refresh_list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    state.audit_sender.try_send(audit::domain_event(
        "sanctions_list_refresh_requested",
        Some(auth.user_id),
        "sanctions_list_version",
        None,
        json!({ "source_url": download::source_url() }),
    ));
    let background = state.clone();
    tokio::spawn(async move {
        match download::run_once(&background, true).await {
            Ok(outcome) => tracing::info!(?outcome, "Manual EU sanctions list refresh finished"),
            Err(error) => {
                tracing::error!(error = %error, "Manual EU sanctions list refresh failed")
            }
        }
    });
    (StatusCode::ACCEPTED, Json(json!({ "ok": true }))).into_response()
}

/// The XML of an upload: the file itself or the one XML inside a ZIP.
fn uploaded_xml(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if !bytes.starts_with(b"PK\x03\x04") {
        return Ok(bytes.to_vec());
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "The ZIP file cannot be read")?;
    let index = (0..archive.len())
        .find(|index| {
            archive.by_index(*index).is_ok_and(|entry| {
                entry.is_file() && entry.name().to_ascii_lowercase().ends_with(".xml")
            })
        })
        .ok_or("The ZIP file contains no XML file")?;
    let entry = archive
        .by_index(index)
        .map_err(|_| "The ZIP file cannot be read")?;
    if entry.size() > MAX_XML_BYTES as u64 {
        return Err("The XML file in the ZIP is too large");
    }
    let mut xml = Vec::new();
    entry
        .take(MAX_XML_BYTES as u64 + 1)
        .read_to_end(&mut xml)
        .map_err(|_| "The ZIP file cannot be read")?;
    if xml.len() > MAX_XML_BYTES {
        return Err("The XML file in the ZIP is too large");
    }
    Ok(xml)
}

async fn upload_list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    mut multipart: Multipart,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let mut file: Option<Vec<u8>> = None;
    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                if field.name() != Some("file") {
                    continue;
                }
                match field.bytes().await {
                    Ok(bytes) => file = Some(bytes.to_vec()),
                    Err(error) => {
                        return err(
                            error.status(),
                            "invalid_upload",
                            "The file could not be read",
                        );
                    }
                }
            }
            Ok(None) => break,
            Err(error) => {
                return err(
                    error.status(),
                    "invalid_upload",
                    "Invalid multipart request",
                );
            }
        }
    }
    let Some(file) = file else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "file_required",
            "Attach the list file",
        );
    };
    let xml = match uploaded_xml(&file) {
        Ok(xml) => xml,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, "list_format", message),
    };
    match store::import_list(&state, xml, ImportSource::Upload, Some(auth.user_id)).await {
        Ok(outcome) => {
            let rescreen = if matches!(outcome, ImportOutcome::Imported { .. }) {
                match screening::rescreen_all(&state).await {
                    Ok(report) => Some(report),
                    Err(error) => {
                        tracing::error!(error = %error, "Re-screening after an uploaded list failed");
                        None
                    }
                }
            } else {
                None
            };
            Json(json!({ "outcome": outcome, "rescreen": rescreen })).into_response()
        }
        Err(ImportError::Db(error)) => db_err(error, "list upload"),
        Err(error) => err(
            StatusCode::UNPROCESSABLE_ENTITY,
            error.public_code(),
            &error.to_string(),
        ),
    }
}

#[derive(Deserialize)]
struct BlockedCountriesRequest {
    countries: Vec<String>,
}

async fn update_blocked_countries(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<BlockedCountriesRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::SanctionsReview) {
        return response;
    }
    let codes = match policy::normalize_country_list(&body.countries) {
        Ok(codes) => codes,
        Err(message) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_countries",
                message,
            );
        }
    };
    match policy::set_blocked_countries(&state, &codes, auth.user_id).await {
        Ok(codes) => Json(json!({ "blocked_countries": codes })).into_response(),
        Err(error) => db_err(error, "blocked countries"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn uploads_accept_xml_and_a_zip_with_one_xml() {
        let xml = b"<export/>".to_vec();
        assert_eq!(uploaded_xml(&xml).unwrap(), xml);

        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("readme.txt", options).unwrap();
            writer.write_all(b"not the list").unwrap();
            writer.start_file("20260930-FULL-1_1.xml", options).unwrap();
            writer.write_all(&xml).unwrap();
            writer.finish().unwrap();
        }
        assert_eq!(uploaded_xml(buffer.get_ref()).unwrap(), xml);

        let mut empty = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut empty);
            writer
                .start_file("readme.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.finish().unwrap();
        }
        assert!(uploaded_xml(empty.get_ref()).is_err());
    }
}
