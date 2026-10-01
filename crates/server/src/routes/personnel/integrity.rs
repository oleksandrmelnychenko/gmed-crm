//! Integrity of the personnel archive.
//!
//! * Every employee's documents form a hash chain (computed by the database
//!   on insert, `personnel_chain_hash`); the verifier recomputes each link
//!   and reads every blob against its SHA-256.
//! * Once a day the heads of all chains are hashed into an anchor and, when
//!   a time-stamping authority is configured, time-stamped (RFC 3161). An
//!   anchor proves which documents existed on that day, so removing the
//!   newest rows of a chain is detected as well.
//! * A failed check notifies every CEO and is written to the journal.

use std::collections::{BTreeMap, HashMap};

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::documents::read_verified;
use super::{err, internal, record_event_logged, tsa, tsa_url};
use crate::{auth::middleware::AuthUser, state::AppState};
use gmed_domain::access::capabilities::Capability;

pub(crate) const GENESIS_HASH: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

/// One chain link; the same string as `personnel_chain_hash` in SQL.
#[allow(clippy::too_many_arguments)]
pub(crate) fn chain_link(
    prev: &str,
    id: Uuid,
    employee_id: Uuid,
    seq: i64,
    sha256: &str,
    category: &str,
    archive_file_name: &str,
    archived_at: DateTime<Utc>,
) -> String {
    let material = format!(
        "{prev}|{id}|{employee_id}|{seq}|{sha256}|{category}|{archive_file_name}|{}",
        archived_at.format("%Y-%m-%dT%H:%M:%S%.6fZ")
    );
    hex::encode(Sha256::digest(material.as_bytes()))
}

/// What the verifier needs of one archived document.
#[derive(Debug, Clone)]
pub(crate) struct ChainRow {
    pub id: Uuid,
    pub employee_id: Uuid,
    pub chain_seq: i64,
    pub prev_chain_hash: String,
    pub chain_hash: String,
    pub sha256: String,
    pub category: String,
    pub archive_file_name: String,
    pub archived_at: DateTime<Utc>,
    pub storage_key: String,
    pub mime_type: String,
    pub deleted: bool,
}

pub(crate) async fn load_chain_rows(
    state: &AppState,
    employee_ids: Option<&[Uuid]>,
) -> Result<Vec<ChainRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT id, employee_id, chain_seq, prev_chain_hash, chain_hash, sha256, category,
                  archive_file_name, archived_at, storage_key, mime_type,
                  deleted_at IS NOT NULL AS deleted
           FROM personnel_documents
           WHERE $1::uuid[] IS NULL OR employee_id = ANY($1)
           ORDER BY employee_id, chain_seq"#,
    )
    .bind(employee_ids)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .map(|row| ChainRow {
            id: row.try_get("id").unwrap_or_default(),
            employee_id: row.try_get("employee_id").unwrap_or_default(),
            chain_seq: row.try_get("chain_seq").unwrap_or_default(),
            prev_chain_hash: row.try_get("prev_chain_hash").unwrap_or_default(),
            chain_hash: row.try_get("chain_hash").unwrap_or_default(),
            sha256: row.try_get("sha256").unwrap_or_default(),
            category: row.try_get("category").unwrap_or_default(),
            archive_file_name: row.try_get("archive_file_name").unwrap_or_default(),
            archived_at: row.try_get("archived_at").unwrap_or_else(|_| Utc::now()),
            storage_key: row.try_get("storage_key").unwrap_or_default(),
            mime_type: row.try_get("mime_type").unwrap_or_default(),
            deleted: row.try_get("deleted").unwrap_or(false),
        })
        .collect())
}

/// A problem found by the verifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Failure {
    pub employee_id: Option<Uuid>,
    pub document_id: Option<Uuid>,
    pub problem: String,
}

impl Failure {
    fn to_json(&self) -> Value {
        json!({
            "employee_id": self.employee_id,
            "document_id": self.document_id,
            "problem": self.problem,
        })
    }
}

/// Checks the chain links of rows ordered by employee and sequence.
pub(crate) fn verify_links(rows: &[ChainRow]) -> Vec<Failure> {
    let mut failures = Vec::new();
    let mut current: Option<Uuid> = None;
    let mut expected_seq = 1i64;
    let mut prev = GENESIS_HASH.to_string();
    for row in rows {
        if current != Some(row.employee_id) {
            current = Some(row.employee_id);
            expected_seq = 1;
            prev = GENESIS_HASH.to_string();
        }
        let fail = |problem: String| Failure {
            employee_id: Some(row.employee_id),
            document_id: Some(row.id),
            problem,
        };
        if row.chain_seq != expected_seq {
            failures.push(fail(format!(
                "chain position {} found where {expected_seq} was expected (a document is missing)",
                row.chain_seq
            )));
        }
        if row.prev_chain_hash != prev {
            failures.push(fail("link to the previous document does not match".into()));
        }
        let recomputed = chain_link(
            &row.prev_chain_hash,
            row.id,
            row.employee_id,
            row.chain_seq,
            &row.sha256,
            &row.category,
            &row.archive_file_name,
            row.archived_at,
        );
        if recomputed != row.chain_hash {
            failures.push(fail("document record was changed after archiving".into()));
        }
        expected_seq = row.chain_seq + 1;
        prev = row.chain_hash.clone();
    }
    failures
}

/// Reads every blob that has not been deleted and checks its SHA-256.
pub(crate) async fn verify_blobs(rows: &[ChainRow]) -> Vec<Failure> {
    let mut failures = Vec::new();
    for row in rows.iter().filter(|row| !row.deleted) {
        if let Err(problem) = read_verified(
            row.id,
            &row.storage_key,
            &row.mime_type,
            &row.archive_file_name,
            &row.sha256,
        )
        .await
        {
            failures.push(Failure {
                employee_id: Some(row.employee_id),
                document_id: Some(row.id),
                problem: format!("stored file: {problem}"),
            });
        }
    }
    failures
}

/// The chain heads (newest link per employee) as sorted lines
/// `employee_id:chain_seq:chain_hash`.
pub(crate) fn head_lines(rows: &[ChainRow]) -> Vec<String> {
    let mut heads: BTreeMap<Uuid, &ChainRow> = BTreeMap::new();
    for row in rows {
        let entry = heads.entry(row.employee_id).or_insert(row);
        if row.chain_seq > entry.chain_seq {
            *entry = row;
        }
    }
    let mut lines: Vec<String> = heads
        .values()
        .map(|row| format!("{}:{}:{}", row.employee_id, row.chain_seq, row.chain_hash))
        .collect();
    lines.sort();
    lines
}

pub(crate) fn anchor_hash(lines: &[String]) -> String {
    hex::encode(Sha256::digest(lines.join("\n").as_bytes()))
}

/// Checks that every anchored head still exists unchanged and that each
/// anchor hash matches its lines.
fn verify_anchors(
    rows: &[ChainRow],
    anchors: &[(Uuid, NaiveDate, String, Vec<String>)],
) -> Vec<Failure> {
    let links: HashMap<(Uuid, i64), &str> = rows
        .iter()
        .map(|row| ((row.employee_id, row.chain_seq), row.chain_hash.as_str()))
        .collect();
    let mut failures = Vec::new();
    for (_, date, hash, lines) in anchors {
        if anchor_hash(lines) != *hash {
            failures.push(Failure {
                employee_id: None,
                document_id: None,
                problem: format!("anchor of {date} does not match its recorded heads"),
            });
            continue;
        }
        for line in lines {
            let mut parts = line.splitn(3, ':');
            let (Some(employee), Some(seq), Some(head)) =
                (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            let (Ok(employee), Ok(seq)) = (Uuid::parse_str(employee), seq.parse::<i64>()) else {
                continue;
            };
            if links.get(&(employee, seq)).copied() != Some(head) {
                failures.push(Failure {
                    employee_id: Some(employee),
                    document_id: None,
                    problem: format!("document {seq} anchored on {date} is missing or was changed"),
                });
            }
        }
    }
    failures
}

async fn load_anchor_heads(
    state: &AppState,
) -> Result<Vec<(Uuid, NaiveDate, String, Vec<String>)>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, anchor_date, anchor_hash, heads FROM personnel_chain_anchors ORDER BY anchor_date",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .map(|row| {
            let heads: Value = row.try_get("heads").unwrap_or(Value::Null);
            let lines = heads
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            (
                row.try_get("id").unwrap_or_default(),
                row.try_get("anchor_date").unwrap_or_default(),
                row.try_get("anchor_hash").unwrap_or_default(),
                lines,
            )
        })
        .collect())
}

/// Runs a full verification and records it. Returns the run as JSON.
pub(crate) async fn run_verification(
    state: &AppState,
    run_trigger: &str,
    actor: Option<Uuid>,
) -> Result<Value, sqlx::Error> {
    let run_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO personnel_integrity_runs (run_trigger, started_by) VALUES ($1, $2) RETURNING id",
    )
    .bind(run_trigger)
    .bind(actor)
    .fetch_one(&state.db)
    .await?;
    let outcome: Result<(Vec<ChainRow>, Vec<Failure>), sqlx::Error> = async {
        let rows = load_chain_rows(state, None).await?;
        let anchors = load_anchor_heads(state).await?;
        let mut failures = verify_links(&rows);
        failures.extend(verify_blobs(&rows).await);
        failures.extend(verify_anchors(&rows, &anchors));
        Ok((rows, failures))
    }
    .await;
    let (rows, failures, status) = match outcome {
        Ok((rows, failures)) => {
            let status = if failures.is_empty() {
                "passed"
            } else {
                "failed"
            };
            (rows, failures, status)
        }
        Err(error) => {
            tracing::error!(%error, "personnel integrity check");
            (
                Vec::new(),
                vec![Failure {
                    employee_id: None,
                    document_id: None,
                    problem: "the check could not read the archive".into(),
                }],
                "error",
            )
        }
    };
    let employees: std::collections::HashSet<Uuid> =
        rows.iter().map(|row| row.employee_id).collect();
    let failures_json: Vec<Value> = failures.iter().map(Failure::to_json).collect();
    sqlx::query(
        r#"UPDATE personnel_integrity_runs
           SET finished_at = now(), employees_checked = $2, documents_checked = $3,
               failures = $4, status = $5
           WHERE id = $1"#,
    )
    .bind(run_id)
    .bind(i32::try_from(employees.len()).unwrap_or(i32::MAX))
    .bind(rows.len() as i64)
    .bind(Value::Array(failures_json))
    .bind(status)
    .execute(&state.db)
    .await?;
    if status != "passed" {
        report_failures(state, run_id, &failures, actor).await;
    }
    load_run(state, run_id).await
}

async fn report_failures(
    state: &AppState,
    run_id: Uuid,
    failures: &[Failure],
    actor: Option<Uuid>,
) {
    let mut per_employee: BTreeMap<Option<Uuid>, Vec<&Failure>> = BTreeMap::new();
    for failure in failures {
        per_employee
            .entry(failure.employee_id)
            .or_default()
            .push(failure);
    }
    for (employee_id, items) in &per_employee {
        record_event_logged(
            state,
            *employee_id,
            None,
            actor,
            "integrity_failed",
            json!({
                "run_id": run_id,
                "problems": items.iter().map(|item| item.to_json()).collect::<Vec<_>>(),
            }),
        )
        .await;
    }
    tracing::error!(%run_id, failures = failures.len(), "personnel archive integrity check failed");
    let rows = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT u.id, 'personnel_integrity_failed',
                  'Personnel files: integrity check failed',
                  $1, 'personnel_integrity_run', $2
           FROM users u
           WHERE u.is_active = true AND u.role = 'ceo'
           RETURNING id, user_id"#,
    )
    .bind(format!(
        "{} problems found in the personnel archive. Open Personnel files → Integrity.",
        failures.len()
    ))
    .bind(run_id)
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
                    json!({ "entity_type": "personnel_integrity_run" }),
                )
                .await;
            }
        }
        Err(error) => tracing::warn!(%error, "notify personnel integrity failure"),
    }
}

fn run_json(row: &sqlx::postgres::PgRow) -> Value {
    let timestamp = |column: &str| {
        row.try_get::<Option<DateTime<Utc>>, _>(column)
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339())
    };
    json!({
        "id": row.try_get::<Uuid, _>("id").ok(),
        "trigger": row.try_get::<String, _>("run_trigger").unwrap_or_default(),
        "started_by_name": row.try_get::<Option<String>, _>("started_by_name").unwrap_or_default(),
        "started_at": timestamp("started_at"),
        "finished_at": timestamp("finished_at"),
        "employees_checked": row.try_get::<i32, _>("employees_checked").unwrap_or_default(),
        "documents_checked": row.try_get::<i64, _>("documents_checked").unwrap_or_default(),
        "failures": row.try_get::<Value, _>("failures").unwrap_or(Value::Null),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
    })
}

const RUN_SELECT: &str = "SELECT r.id, r.run_trigger, r.started_at, r.finished_at, \
     r.employees_checked, r.documents_checked, r.failures, r.status, u.name AS started_by_name \
     FROM personnel_integrity_runs r LEFT JOIN users u ON u.id = r.started_by";

async fn load_run(state: &AppState, run_id: Uuid) -> Result<Value, sqlx::Error> {
    let row = sqlx::query(&format!("{RUN_SELECT} WHERE r.id = $1"))
        .bind(run_id)
        .fetch_one(&state.db)
        .await?;
    Ok(run_json(&row))
}

/// Creates today's anchor unless it exists or the archive is empty.
pub(crate) async fn create_anchor(
    state: &AppState,
    date: NaiveDate,
) -> Result<Option<Uuid>, sqlx::Error> {
    let rows = load_chain_rows(state, None).await?;
    if rows.is_empty() {
        return Ok(None);
    }
    let lines = head_lines(&rows);
    let hash = anchor_hash(&lines);
    let url = tsa_url(state).await;
    sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO personnel_chain_anchors
               (anchor_date, anchor_hash, heads, employee_count, document_count, tsa_status, tsa_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (anchor_date) DO NOTHING
           RETURNING id"#,
    )
    .bind(date)
    .bind(&hash)
    .bind(json!(lines))
    .bind(i32::try_from(lines.len()).unwrap_or(i32::MAX))
    .bind(rows.len() as i64)
    .bind(if url.is_some() { "pending" } else { "disabled" })
    .bind(url)
    .fetch_optional(&state.db)
    .await
}

const MAX_TSA_ATTEMPTS: i32 = 10;

/// Time-stamps anchors that are still pending, failed and may retry, or were
/// made before a TSA was configured (their stamp then attests a later time,
/// which still proves the documents existed by then).
pub(crate) async fn stamp_pending(state: &AppState) -> Result<u64, sqlx::Error> {
    let Some(url) = tsa_url(state).await else {
        return Ok(0);
    };
    let rows = sqlx::query(
        r#"SELECT id, anchor_hash FROM personnel_chain_anchors
           WHERE tsa_status IN ('pending', 'failed', 'disabled') AND tsa_attempts < $1
           ORDER BY anchor_date
           LIMIT 20"#,
    )
    .bind(MAX_TSA_ATTEMPTS)
    .fetch_all(&state.db)
    .await?;
    let mut stamped = 0;
    for row in rows {
        let id: Uuid = row.try_get("id").unwrap_or_default();
        let hash: String = row.try_get("anchor_hash").unwrap_or_default();
        let Some(digest) = hex::decode(&hash)
            .ok()
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        else {
            continue;
        };
        match tsa::request_time_stamp(&url, &digest).await {
            Ok(stamp) => {
                sqlx::query(
                    r#"UPDATE personnel_chain_anchors
                       SET tsa_status = 'stamped', tsa_url = $2, tsa_token = $3, tsa_gen_time = $4,
                           tsa_attempts = tsa_attempts + 1, tsa_last_error = NULL
                       WHERE id = $1"#,
                )
                .bind(id)
                .bind(&url)
                .bind(&stamp.response)
                .bind(stamp.gen_time)
                .execute(&state.db)
                .await?;
                stamped += 1;
            }
            Err(problem) => {
                tracing::warn!(anchor_id = %id, problem, "personnel anchor time stamp failed");
                sqlx::query(
                    r#"UPDATE personnel_chain_anchors
                       SET tsa_status = 'failed', tsa_url = $2, tsa_attempts = tsa_attempts + 1,
                           tsa_last_error = $3
                       WHERE id = $1"#,
                )
                .bind(id)
                .bind(&url)
                .bind(problem.chars().take(500).collect::<String>())
                .execute(&state.db)
                .await?;
            }
        }
    }
    Ok(stamped)
}

fn anchor_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").ok(),
        "anchor_date": row.try_get::<NaiveDate, _>("anchor_date").ok(),
        "anchor_hash": row.try_get::<String, _>("anchor_hash").unwrap_or_default(),
        "employee_count": row.try_get::<i32, _>("employee_count").unwrap_or_default(),
        "document_count": row.try_get::<i64, _>("document_count").unwrap_or_default(),
        "tsa_status": row.try_get::<String, _>("tsa_status").unwrap_or_default(),
        "tsa_url": row.try_get::<Option<String>, _>("tsa_url").unwrap_or_default(),
        "tsa_gen_time": row
            .try_get::<Option<DateTime<Utc>>, _>("tsa_gen_time")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339()),
        "tsa_attempts": row.try_get::<i32, _>("tsa_attempts").unwrap_or_default(),
        "tsa_last_error": row.try_get::<Option<String>, _>("tsa_last_error").unwrap_or_default(),
        "has_token": row.try_get::<bool, _>("has_token").unwrap_or(false),
    })
}

const ANCHOR_SELECT: &str = "SELECT id, anchor_date, anchor_hash, employee_count, document_count, \
     tsa_status, tsa_url, tsa_gen_time, tsa_attempts, tsa_last_error, \
     tsa_token IS NOT NULL AS has_token FROM personnel_chain_anchors";

pub(crate) async fn get_integrity(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    let runs = match sqlx::query(&format!("{RUN_SELECT} ORDER BY r.started_at DESC LIMIT 20"))
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows.iter().map(run_json).collect::<Vec<_>>(),
        Err(error) => return internal(error, "list integrity runs"),
    };
    let anchors = match sqlx::query(&format!(
        "{ANCHOR_SELECT} ORDER BY anchor_date DESC LIMIT 60"
    ))
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows.iter().map(anchor_json).collect::<Vec<_>>(),
        Err(error) => return internal(error, "list chain anchors"),
    };
    Json(json!({
        "runs": runs,
        "anchors": anchors,
        "tsa_configured": tsa_url(&state).await.is_some(),
    }))
    .into_response()
}

pub(crate) async fn run_integrity_check(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelManage) {
        return response;
    }
    match run_verification(&state, "manual", Some(auth.user_id)).await {
        Ok(run) => Json(run).into_response(),
        Err(error) => internal(error, "run integrity check"),
    }
}

/// Creates today's anchor if missing and time-stamps pending anchors now.
pub(crate) async fn anchor_now(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelManage) {
        return response;
    }
    if let Err(error) = create_anchor(&state, crate::app_time::today()).await {
        return internal(error, "create chain anchor");
    }
    if let Err(error) = stamp_pending(&state).await {
        return internal(error, "time-stamp chain anchors");
    }
    match sqlx::query(&format!("{ANCHOR_SELECT} WHERE anchor_date = $1"))
        .bind(crate::app_time::today())
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => Json(anchor_json(&row)).into_response(),
        Ok(None) => err(
            StatusCode::CONFLICT,
            "The archive is empty; nothing to anchor",
        ),
        Err(error) => internal(error, "load chain anchor"),
    }
}

pub(crate) async fn download_anchor_token(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(anchor_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    match sqlx::query("SELECT anchor_date, tsa_token FROM personnel_chain_anchors WHERE id = $1")
        .bind(anchor_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => {
            let Some(token) = row
                .try_get::<Option<Vec<u8>>, _>("tsa_token")
                .ok()
                .flatten()
            else {
                return err(StatusCode::NOT_FOUND, "This anchor has no time stamp yet");
            };
            let date: NaiveDate = row.try_get("anchor_date").unwrap_or_default();
            super::documents::file_response(
                token,
                "application/timestamp-reply",
                &format!("Zeitstempel_{}.tsr", date.format("%Y%m%d")),
                false,
            )
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Anchor not found"),
        Err(error) => internal(error, "load anchor token"),
    }
}

/// Hourly: today's anchor, pending time stamps, the weekly verification and
/// the monthly reminder about missing documents.
pub fn spawn_scheduler(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3_600));
        loop {
            ticker.tick().await;
            run_scheduled(&state).await;
        }
    });
}

async fn run_scheduled(state: &AppState) {
    match create_anchor(state, crate::app_time::today()).await {
        Ok(Some(id)) => tracing::info!(anchor_id = %id, "personnel archive anchored"),
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, "personnel anchor"),
    }
    if let Err(error) = stamp_pending(state).await {
        tracing::warn!(%error, "personnel anchor time stamps");
    }
    let due = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (SELECT 1 FROM personnel_documents)
              AND NOT EXISTS (
                  SELECT 1 FROM personnel_integrity_runs
                  WHERE run_trigger = 'scheduled' AND started_at > now() - interval '7 days'
              )"#,
    )
    .fetch_one(&state.db)
    .await;
    match due {
        Ok(true) => match run_verification(state, "scheduled", None).await {
            Ok(run) => tracing::info!(status = %run["status"], "personnel archive verified"),
            Err(error) => tracing::warn!(%error, "personnel integrity check"),
        },
        Ok(false) => {}
        Err(error) => tracing::warn!(%error, "personnel integrity schedule"),
    }
    match super::completeness::send_monthly_reminder(state).await {
        Ok(sent) if sent > 0 => tracing::info!(sent, "personnel missing-document reminder sent"),
        Ok(_) => {}
        Err(error) => tracing::warn!(%error, "personnel missing-document reminder"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn row(employee: Uuid, seq: i64, prev: &str) -> ChainRow {
        let id = Uuid::from_u128(seq as u128 + employee.as_u128() % 1_000);
        let archived_at = Utc.with_ymd_and_hms(2026, 10, 1, 8, 30, 0).unwrap()
            + chrono::Duration::microseconds(123_456 + seq);
        let sha = format!("{seq:064x}");
        let hash = chain_link(
            prev,
            id,
            employee,
            seq,
            &sha,
            "stundenzettel",
            "A_2026_05_B.pdf",
            archived_at,
        );
        ChainRow {
            id,
            employee_id: employee,
            chain_seq: seq,
            prev_chain_hash: prev.to_string(),
            chain_hash: hash,
            sha256: sha,
            category: "stundenzettel".into(),
            archive_file_name: "A_2026_05_B.pdf".into(),
            archived_at,
            storage_key: String::new(),
            mime_type: "application/pdf".into(),
            deleted: false,
        }
    }

    fn chain(employee: Uuid, len: i64) -> Vec<ChainRow> {
        let mut rows = Vec::new();
        let mut prev = GENESIS_HASH.to_string();
        for seq in 1..=len {
            let next = row(employee, seq, &prev);
            prev = next.chain_hash.clone();
            rows.push(next);
        }
        rows
    }

    #[test]
    fn link_matches_the_sql_definition() {
        // personnel_chain_hash('000…0', id, employee, 1, sha, 'stundenzettel',
        // 'A_2026_05_B.pdf', '2026-10-01T08:30:00.123457Z') in PostgreSQL.
        let link = chain_link(
            GENESIS_HASH,
            Uuid::from_u128(1),
            Uuid::from_u128(2),
            1,
            &"a".repeat(64),
            "stundenzettel",
            "A_2026_05_B.pdf",
            Utc.with_ymd_and_hms(2026, 10, 1, 8, 30, 0).unwrap()
                + chrono::Duration::microseconds(123_457),
        );
        let material = format!(
            "{GENESIS_HASH}|00000000-0000-0000-0000-000000000001|00000000-0000-0000-0000-000000000002|1|{}|stundenzettel|A_2026_05_B.pdf|2026-10-01T08:30:00.123457Z",
            "a".repeat(64)
        );
        assert_eq!(link, hex::encode(Sha256::digest(material.as_bytes())));
    }

    #[test]
    fn intact_chains_verify() {
        let mut rows = chain(Uuid::from_u128(10), 3);
        rows.extend(chain(Uuid::from_u128(20), 2));
        assert!(verify_links(&rows).is_empty());
    }

    #[test]
    fn changed_removed_or_reordered_rows_are_detected() {
        let rows = chain(Uuid::from_u128(10), 3);

        let mut changed = rows.clone();
        changed[1].sha256 = "f".repeat(64);
        assert!(
            verify_links(&changed)
                .iter()
                .any(|failure| failure.problem.contains("changed"))
        );

        let mut removed = rows.clone();
        removed.remove(1);
        let failures = verify_links(&removed);
        assert!(
            failures
                .iter()
                .any(|failure| failure.problem.contains("missing"))
        );
        assert!(
            failures
                .iter()
                .any(|failure| failure.problem.contains("previous"))
        );

        let mut renamed = rows;
        renamed[2].archive_file_name = "Other.pdf".into();
        assert_eq!(verify_links(&renamed).len(), 1);
    }

    #[test]
    fn anchors_detect_truncated_chains() {
        let employee = Uuid::from_u128(10);
        let rows = chain(employee, 3);
        let lines = head_lines(&rows);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with(&format!("{employee}:3:")));
        let anchors = vec![(
            Uuid::nil(),
            NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            anchor_hash(&lines),
            lines.clone(),
        )];
        assert!(verify_anchors(&rows, &anchors).is_empty());
        // Dropping the newest document keeps the remaining chain valid but
        // breaks the anchor.
        let truncated = rows[..2].to_vec();
        assert!(verify_links(&truncated).is_empty());
        assert_eq!(verify_anchors(&truncated, &anchors).len(), 1);
        // A tampered anchor is reported as such.
        let tampered = vec![(Uuid::nil(), anchors[0].1, "0".repeat(64), lines)];
        assert!(
            verify_anchors(&rows, &tampered)[0]
                .problem
                .contains("anchor")
        );
    }
}
