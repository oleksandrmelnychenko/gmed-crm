use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::collections::HashSet;
use uuid::Uuid;

const MAX_METADATA_BYTES: usize = 256 * 1024;
const MAX_SOURCE_PAYLOAD_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct OfficialSourceStatus {
    pub id: String,
    pub label: String,
    pub authority: String,
    pub kind: String,
    pub url: String,
    pub machine_readable: bool,
    pub ingestion_status: String,
    pub health: String,
    pub freshness_ttl_hours: Option<i32>,
    pub last_attempt_at: Option<String>,
    pub last_error: Option<String>,
    pub last_successful_snapshot: Option<SuccessfulSnapshotStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SuccessfulSnapshotStatus {
    pub id: Uuid,
    pub fetched_at: String,
    pub published_at: Option<String>,
    pub version: Option<String>,
    pub checksum_sha256: String,
    pub item_count: Option<i64>,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnqueueResult {
    pub job_id: Uuid,
    pub idempotent_replay: bool,
}

#[derive(Debug, Clone)]
pub struct ClaimedIngestionJob {
    pub id: Uuid,
    pub source_id: String,
    pub source_url: String,
}

#[derive(Debug, Clone)]
pub struct SuccessfulSnapshotInput {
    pub fetched_at: DateTime<Utc>,
    pub published_at: Option<DateTime<Utc>>,
    pub source_url: String,
    pub checksum_sha256: String,
    pub version: Option<String>,
    pub item_count: Option<i64>,
    pub content_type: Option<String>,
    pub byte_length: i64,
    pub payload_storage_key: Option<String>,
    pub metadata: Value,
}

#[derive(Debug, Clone)]
pub struct StoredSourcePayloadInput {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct SafetyAlertItemInput {
    pub alert_id: String,
    pub official_title: String,
    pub official_url: String,
    pub published_at: Option<DateTime<Utc>>,
    pub explicit_substance_labels: Vec<String>,
    pub explicit_substance_keys: Vec<String>,
    pub item_checksum_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompleteAttemptResult {
    pub snapshot_id: Uuid,
    pub job_status: String,
    pub idempotent_replay: bool,
    pub duplicate_snapshot: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum SourceIngestionError {
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
    #[error("source not found")]
    SourceNotFound,
    #[error("source connector is not active")]
    SourceNotActive,
    #[error("ingestion job is not running")]
    JobNotRunning,
    #[error("invalid ingestion input: {0}")]
    InvalidInput(&'static str),
}

pub async fn load_source_statuses(pool: &PgPool) -> Result<Vec<OfficialSourceStatus>, sqlx::Error> {
    load_source_statuses_at(pool, Utc::now()).await
}

pub async fn load_source_statuses_at(
    pool: &PgPool,
    now: DateTime<Utc>,
) -> Result<Vec<OfficialSourceStatus>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT source.id, source.label, source.authority, source.kind,
                  source.source_url, source.machine_readable,
                  source.connector_status, source.freshness_ttl_hours,
                  attempt.status AS last_attempt_status,
                  attempt.attempted_at AS last_attempt_at,
                  attempt.error_code AS last_error,
                  observation.verified_at AS last_verified_at,
                  snapshot.id AS snapshot_id,
                  snapshot.fetched_at AS snapshot_fetched_at,
                  snapshot.published_at AS snapshot_published_at,
                  snapshot.source_version AS snapshot_version,
                  snapshot.checksum_sha256 AS snapshot_checksum_sha256,
                  snapshot.item_count AS snapshot_item_count,
                  snapshot.source_url AS snapshot_source_url
           FROM medication_intelligence_sources source
           LEFT JOIN LATERAL (
               SELECT job.status,
                      COALESCE(job.completed_at, job.started_at) AS attempted_at,
                      job.error_code
               FROM medication_intelligence_ingestion_jobs job
               WHERE job.source_id = source.id
                 AND job.status IN ('running', 'succeeded', 'failed', 'skipped')
               ORDER BY COALESCE(job.completed_at, job.started_at) DESC, job.id DESC
               LIMIT 1
           ) attempt ON TRUE
           LEFT JOIN LATERAL (
               SELECT job.completed_at AS verified_at
               FROM medication_intelligence_ingestion_jobs job
               WHERE job.source_id = source.id
                 AND job.status IN ('succeeded', 'skipped')
               ORDER BY job.completed_at DESC, job.id DESC
               LIMIT 1
           ) observation ON TRUE
           LEFT JOIN LATERAL (
               SELECT stored.id, stored.fetched_at, stored.published_at,
                      stored.source_version, stored.checksum_sha256,
                      stored.item_count, stored.source_url
               FROM medication_intelligence_source_snapshots stored
               WHERE stored.source_id = source.id
                 AND stored.attempt_status = 'success'
               ORDER BY stored.fetched_at DESC, stored.id DESC
               LIMIT 1
           ) snapshot ON TRUE
           ORDER BY source.id"#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let configured_status = row.get::<String, _>("connector_status");
            let ttl_hours = row.get::<Option<i32>, _>("freshness_ttl_hours");
            let last_attempt_status = row.get::<Option<String>, _>("last_attempt_status");
            let last_attempt_at = row.get::<Option<DateTime<Utc>>, _>("last_attempt_at");
            let snapshot_id = row.get::<Option<Uuid>, _>("snapshot_id");
            let snapshot_fetched_at = row.get::<Option<DateTime<Utc>>, _>("snapshot_fetched_at");
            let last_verified_at = row.get::<Option<DateTime<Utc>>, _>("last_verified_at");
            let last_successful_snapshot =
                snapshot_id
                    .zip(snapshot_fetched_at)
                    .map(|(id, fetched_at)| SuccessfulSnapshotStatus {
                        id,
                        fetched_at: fetched_at.to_rfc3339(),
                        published_at: row
                            .get::<Option<DateTime<Utc>>, _>("snapshot_published_at")
                            .map(|value| value.to_rfc3339()),
                        version: row.get("snapshot_version"),
                        checksum_sha256: row
                            .get::<Option<String>, _>("snapshot_checksum_sha256")
                            .unwrap_or_default(),
                        item_count: row.get("snapshot_item_count"),
                        source_url: row
                            .get::<Option<String>, _>("snapshot_source_url")
                            .unwrap_or_default(),
                    });
            let latest_failed = last_attempt_status.as_deref() == Some("failed");
            let health = if latest_failed {
                "error"
            } else if let Some(snapshot) = snapshot_fetched_at {
                let freshness_observed_at = last_verified_at.unwrap_or(snapshot);
                match ttl_hours {
                    Some(hours)
                        if freshness_observed_at + Duration::hours(i64::from(hours)) < now =>
                    {
                        "stale"
                    }
                    _ => "fresh",
                }
            } else {
                "never"
            };
            let ingestion_status = if last_successful_snapshot.is_some() {
                "available"
            } else if latest_failed {
                "error"
            } else if configured_status == "manual_reference" {
                "manual_reference"
            } else {
                "planned"
            };

            OfficialSourceStatus {
                id: row.get("id"),
                label: row.get("label"),
                authority: row.get("authority"),
                kind: row.get("kind"),
                url: row.get("source_url"),
                machine_readable: row.get("machine_readable"),
                ingestion_status: ingestion_status.to_string(),
                health: health.to_string(),
                freshness_ttl_hours: ttl_hours,
                last_attempt_at: last_attempt_at.map(|value| value.to_rfc3339()),
                last_error: if latest_failed {
                    row.get("last_error")
                } else {
                    None
                },
                last_successful_snapshot,
            }
        })
        .collect())
}

pub async fn enqueue_source_ingestion(
    pool: &PgPool,
    source_id: &str,
    idempotency_key: &str,
    requested_by: Option<Uuid>,
    metadata: Value,
) -> Result<EnqueueResult, SourceIngestionError> {
    let source_id = source_id.trim();
    let idempotency_key = idempotency_key.trim();
    if source_id.is_empty() {
        return Err(SourceIngestionError::InvalidInput("source_id is required"));
    }
    if idempotency_key.is_empty() || idempotency_key.len() > 200 {
        return Err(SourceIngestionError::InvalidInput(
            "idempotency_key must contain 1..=200 characters",
        ));
    }
    validate_metadata(&metadata)?;

    if let Some(job_id) = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id
           FROM medication_intelligence_ingestion_jobs
           WHERE source_id = $1 AND idempotency_key = $2"#,
    )
    .bind(source_id)
    .bind(idempotency_key)
    .fetch_optional(pool)
    .await?
    {
        return Ok(EnqueueResult {
            job_id,
            idempotent_replay: true,
        });
    }

    let source = sqlx::query(
        r#"SELECT source_url, connector_status
           FROM medication_intelligence_sources
           WHERE id = $1"#,
    )
    .bind(source_id)
    .fetch_optional(pool)
    .await?
    .ok_or(SourceIngestionError::SourceNotFound)?;
    if source.get::<String, _>("connector_status") != "active" {
        return Err(SourceIngestionError::SourceNotActive);
    }
    let source_url = source.get::<String, _>("source_url");

    let inserted = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO medication_intelligence_ingestion_jobs (
                source_id, idempotency_key, requested_by, source_url, metadata
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_id, idempotency_key) DO NOTHING
           RETURNING id"#,
    )
    .bind(source_id)
    .bind(idempotency_key)
    .bind(requested_by)
    .bind(source_url)
    .bind(metadata)
    .fetch_optional(pool)
    .await?;

    match inserted {
        Some(job_id) => Ok(EnqueueResult {
            job_id,
            idempotent_replay: false,
        }),
        None => {
            let job_id = sqlx::query_scalar::<_, Uuid>(
                r#"SELECT id
                   FROM medication_intelligence_ingestion_jobs
                   WHERE source_id = $1 AND idempotency_key = $2"#,
            )
            .bind(source_id)
            .bind(idempotency_key)
            .fetch_one(pool)
            .await?;
            Ok(EnqueueResult {
                job_id,
                idempotent_replay: true,
            })
        }
    }
}

pub async fn claim_next_ingestion_job(
    pool: &PgPool,
    worker_id: &str,
) -> Result<Option<ClaimedIngestionJob>, SourceIngestionError> {
    let worker_id = worker_id.trim();
    if worker_id.is_empty() || worker_id.len() > 200 {
        return Err(SourceIngestionError::InvalidInput(
            "worker_id must contain 1..=200 characters",
        ));
    }
    let row = sqlx::query(
        r#"WITH next_job AS (
               SELECT job.id
               FROM medication_intelligence_ingestion_jobs job
               JOIN medication_intelligence_sources source ON source.id = job.source_id
               WHERE job.status = 'queued'
                 AND source.connector_status = 'active'
               ORDER BY job.requested_at, job.id
               LIMIT 1
               FOR UPDATE OF job SKIP LOCKED
           )
           UPDATE medication_intelligence_ingestion_jobs job
           SET status = 'running', worker_id = $1, started_at = now(),
               error_code = NULL, error_message = NULL
           FROM next_job
           WHERE job.id = next_job.id
           RETURNING job.id, job.source_id, job.source_url"#,
    )
    .bind(worker_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| ClaimedIngestionJob {
        id: row.get("id"),
        source_id: row.get("source_id"),
        source_url: row.get("source_url"),
    }))
}

/// Claims one known job id. Scheduled connectors use this instead of the
/// generic queue claim so one connector can never consume another connector's
/// work when more official sources are activated later. A running claim has a
/// ten-minute lease (well above the connector's 15-second HTTP timeout), so a
/// process crash cannot strand the hourly idempotency key forever.
pub async fn claim_ingestion_job(
    pool: &PgPool,
    job_id: Uuid,
    worker_id: &str,
) -> Result<Option<ClaimedIngestionJob>, SourceIngestionError> {
    let worker_id = worker_id.trim();
    if worker_id.is_empty() || worker_id.len() > 200 {
        return Err(SourceIngestionError::InvalidInput(
            "worker_id must contain 1..=200 characters",
        ));
    }
    let row = sqlx::query(
        r#"UPDATE medication_intelligence_ingestion_jobs job
           SET status = 'running', worker_id = $2, started_at = now(),
               error_code = NULL, error_message = NULL
           FROM medication_intelligence_sources source
           WHERE job.id = $1
             AND job.source_id = source.id
             AND (
                 job.status = 'queued'
                 OR (
                     job.status = 'running'
                     AND job.started_at < now() - interval '10 minutes'
                 )
             )
             AND source.connector_status = 'active'
           RETURNING job.id, job.source_id, job.source_url"#,
    )
    .bind(job_id)
    .bind(worker_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| ClaimedIngestionJob {
        id: row.get("id"),
        source_id: row.get("source_id"),
        source_url: row.get("source_url"),
    }))
}

pub async fn record_ingestion_success(
    pool: &PgPool,
    job_id: Uuid,
    input: SuccessfulSnapshotInput,
) -> Result<CompleteAttemptResult, SourceIngestionError> {
    record_ingestion_success_inner(pool, job_id, input, None).await
}

/// Atomically records the immutable BfArM RSS payload, its source snapshot,
/// and the minimal normalized alert rows. Keeping these writes in one
/// transaction prevents a patient request from observing a successful
/// snapshot before its provenance rows exist.
pub async fn record_bfarm_ingestion_success(
    pool: &PgPool,
    job_id: Uuid,
    input: SuccessfulSnapshotInput,
    payload: StoredSourcePayloadInput,
    alerts: Vec<SafetyAlertItemInput>,
) -> Result<CompleteAttemptResult, SourceIngestionError> {
    validate_bfarm_bundle(&input, &payload, &alerts)?;
    record_ingestion_success_inner(pool, job_id, input, Some((payload, alerts))).await
}

async fn record_ingestion_success_inner(
    pool: &PgPool,
    job_id: Uuid,
    input: SuccessfulSnapshotInput,
    bfarm_bundle: Option<(StoredSourcePayloadInput, Vec<SafetyAlertItemInput>)>,
) -> Result<CompleteAttemptResult, SourceIngestionError> {
    validate_success_input(&input)?;
    let mut transaction = pool.begin().await?;
    let job = sqlx::query(
        r#"SELECT source_id, source_url, status
           FROM medication_intelligence_ingestion_jobs
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(job_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(SourceIngestionError::SourceNotFound)?;
    let source_id = job.get::<String, _>("source_id");
    let registered_source_url = job.get::<String, _>("source_url");
    let status = job.get::<String, _>("status");
    if status != "running" {
        if let Some(snapshot_id) = terminal_snapshot_id(&mut transaction, job_id).await? {
            transaction.commit().await?;
            return Ok(CompleteAttemptResult {
                snapshot_id,
                duplicate_snapshot: status == "skipped",
                job_status: status,
                idempotent_replay: true,
            });
        }
        return Err(SourceIngestionError::JobNotRunning);
    }
    if input.source_url != registered_source_url {
        return Err(SourceIngestionError::InvalidInput(
            "snapshot source_url must equal the registered public source URL",
        ));
    }
    if bfarm_bundle.is_some() && source_id != "bfarm_rote_hand" {
        return Err(SourceIngestionError::InvalidInput(
            "safety alert bundle is only valid for bfarm_rote_hand",
        ));
    }

    let snapshot_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO medication_intelligence_source_snapshots (
                source_id, ingestion_job_id, attempt_status, fetched_at,
                published_at, source_url, checksum_sha256, source_version,
                item_count, content_type, byte_length, payload_storage_key, metadata
           ) VALUES (
                $1, $2, 'success', $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12
           )
           ON CONFLICT (source_id, checksum_sha256)
               WHERE attempt_status = 'success'
               DO NOTHING
           RETURNING id"#,
    )
    .bind(&source_id)
    .bind(job_id)
    .bind(input.fetched_at)
    .bind(input.published_at)
    .bind(&registered_source_url)
    .bind(&input.checksum_sha256)
    .bind(input.version.as_deref())
    .bind(input.item_count)
    .bind(input.content_type.as_deref())
    .bind(input.byte_length)
    .bind(input.payload_storage_key.as_deref())
    .bind(input.metadata)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(snapshot_id) = snapshot_id else {
        let snapshot_id = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id
               FROM medication_intelligence_source_snapshots
               WHERE source_id = $1
                 AND checksum_sha256 = $2
                 AND attempt_status = 'success'"#,
        )
        .bind(&source_id)
        .bind(&input.checksum_sha256)
        .fetch_one(&mut *transaction)
        .await?;
        if let Some((payload, alerts)) = bfarm_bundle.as_ref() {
            ensure_bfarm_snapshot_bundle(
                &mut transaction,
                snapshot_id,
                &source_id,
                &input.checksum_sha256,
                payload,
                alerts,
            )
            .await?;
        }
        sqlx::query(
            r#"UPDATE medication_intelligence_ingestion_jobs
                   SET status = 'skipped', completed_at = now(),
                       result_snapshot_id = $2,
                   metadata = metadata || jsonb_build_object(
                       'duplicate_snapshot_id', $2::uuid,
                       'duplicate_checksum', $3::text
                   )
               WHERE id = $1"#,
        )
        .bind(job_id)
        .bind(snapshot_id)
        .bind(&input.checksum_sha256)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        return Ok(CompleteAttemptResult {
            snapshot_id,
            job_status: "skipped".to_string(),
            idempotent_replay: false,
            duplicate_snapshot: true,
        });
    };

    if let Some((payload, alerts)) = bfarm_bundle.as_ref() {
        ensure_bfarm_snapshot_bundle(
            &mut transaction,
            snapshot_id,
            &source_id,
            &input.checksum_sha256,
            payload,
            alerts,
        )
        .await?;
    }

    sqlx::query(
        r#"UPDATE medication_intelligence_ingestion_jobs
           SET status = 'succeeded', completed_at = now(),
               result_snapshot_id = $2,
               error_code = NULL, error_message = NULL
           WHERE id = $1"#,
    )
    .bind(job_id)
    .bind(snapshot_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(CompleteAttemptResult {
        snapshot_id,
        job_status: "succeeded".to_string(),
        idempotent_replay: false,
        duplicate_snapshot: false,
    })
}

async fn ensure_bfarm_snapshot_bundle(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    snapshot_id: Uuid,
    source_id: &str,
    checksum_sha256: &str,
    payload: &StoredSourcePayloadInput,
    alerts: &[SafetyAlertItemInput],
) -> Result<(), SourceIngestionError> {
    let payload_exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1 FROM medication_intelligence_source_payloads
               WHERE snapshot_id = $1
           )"#,
    )
    .bind(snapshot_id)
    .fetch_one(&mut **transaction)
    .await?;
    let alert_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT count(*)
           FROM medication_intelligence_safety_alert_items
           WHERE snapshot_id = $1"#,
    )
    .bind(snapshot_id)
    .fetch_one(&mut **transaction)
    .await?;
    let expected_alert_count = i64::try_from(alerts.len()).map_err(|_| {
        SourceIngestionError::InvalidInput("source snapshot contains too many alert items")
    })?;
    if payload_exists && alert_count == expected_alert_count {
        return Ok(());
    }
    if payload_exists || alert_count != 0 {
        return Err(SourceIngestionError::InvalidInput(
            "existing BfArM snapshot has an incomplete normalized bundle",
        ));
    }

    sqlx::query(
        r#"INSERT INTO medication_intelligence_source_payloads (
               snapshot_id, source_id, content_type, checksum_sha256, payload
           ) VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(snapshot_id)
    .bind(source_id)
    .bind(&payload.content_type)
    .bind(checksum_sha256)
    .bind(payload.bytes.as_slice())
    .execute(&mut **transaction)
    .await?;

    for alert in alerts {
        sqlx::query(
            r#"INSERT INTO medication_intelligence_safety_alert_items (
                   snapshot_id, source_id, alert_id, official_title,
                   official_url, published_at, explicit_substance_labels,
                   explicit_substance_keys, item_checksum_sha256
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        )
        .bind(snapshot_id)
        .bind(source_id)
        .bind(&alert.alert_id)
        .bind(&alert.official_title)
        .bind(&alert.official_url)
        .bind(alert.published_at.to_owned())
        .bind(&alert.explicit_substance_labels)
        .bind(&alert.explicit_substance_keys)
        .bind(&alert.item_checksum_sha256)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

pub async fn record_ingestion_failure(
    pool: &PgPool,
    job_id: Uuid,
    fetched_at: DateTime<Utc>,
    error_code: Option<&str>,
    error_message: &str,
    metadata: Value,
) -> Result<CompleteAttemptResult, SourceIngestionError> {
    let error_message = error_message.trim();
    if error_message.is_empty() || error_message.len() > 4_000 {
        return Err(SourceIngestionError::InvalidInput(
            "error_message must contain 1..=4000 characters",
        ));
    }
    let error_code = error_code.unwrap_or("ingestion_failed").trim();
    if error_code.is_empty()
        || error_code.len() > 64
        || !error_code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(SourceIngestionError::InvalidInput(
            "error_code must use 1..=64 lowercase ASCII letters, digits or underscores",
        ));
    }
    validate_metadata(&metadata)?;
    let mut transaction = pool.begin().await?;
    let job = sqlx::query(
        r#"SELECT source_id, source_url, status
           FROM medication_intelligence_ingestion_jobs
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(job_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(SourceIngestionError::SourceNotFound)?;
    let status = job.get::<String, _>("status");
    if status != "running" {
        if let Some(snapshot_id) = terminal_snapshot_id(&mut transaction, job_id).await? {
            transaction.commit().await?;
            return Ok(CompleteAttemptResult {
                snapshot_id,
                duplicate_snapshot: status == "skipped",
                job_status: status,
                idempotent_replay: true,
            });
        }
        return Err(SourceIngestionError::JobNotRunning);
    }
    let source_id = job.get::<String, _>("source_id");
    let source_url = job.get::<String, _>("source_url");
    let snapshot_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO medication_intelligence_source_snapshots (
                source_id, ingestion_job_id, attempt_status, fetched_at,
                source_url, error_code, error_message, metadata
           ) VALUES ($1, $2, 'failed', $3, $4, $5, $6, $7)
           RETURNING id"#,
    )
    .bind(&source_id)
    .bind(job_id)
    .bind(fetched_at)
    .bind(&source_url)
    .bind(error_code)
    .bind(error_message)
    .bind(metadata)
    .fetch_one(&mut *transaction)
    .await?;
    sqlx::query(
        r#"UPDATE medication_intelligence_ingestion_jobs
           SET status = 'failed', completed_at = now(),
               result_snapshot_id = $2,
               error_code = $3, error_message = $4
           WHERE id = $1"#,
    )
    .bind(job_id)
    .bind(snapshot_id)
    .bind(error_code)
    .bind(error_message)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(CompleteAttemptResult {
        snapshot_id,
        job_status: "failed".to_string(),
        idempotent_replay: false,
        duplicate_snapshot: false,
    })
}

async fn terminal_snapshot_id(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    job_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT result_snapshot_id
           FROM medication_intelligence_ingestion_jobs
           WHERE id = $1
             AND result_snapshot_id IS NOT NULL"#,
    )
    .bind(job_id)
    .fetch_optional(&mut **transaction)
    .await
}

fn validate_success_input(input: &SuccessfulSnapshotInput) -> Result<(), SourceIngestionError> {
    if !is_https_url(&input.source_url) {
        return Err(SourceIngestionError::InvalidInput(
            "source_url must use https",
        ));
    }
    if input.checksum_sha256.len() != 64
        || !input
            .checksum_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(SourceIngestionError::InvalidInput(
            "checksum_sha256 must be 64 lowercase hexadecimal characters",
        ));
    }
    if input.item_count.is_some_and(|count| count < 0) || input.byte_length < 0 {
        return Err(SourceIngestionError::InvalidInput(
            "counts must not be negative",
        ));
    }
    validate_metadata(&input.metadata)
}

fn validate_bfarm_bundle(
    input: &SuccessfulSnapshotInput,
    payload: &StoredSourcePayloadInput,
    alerts: &[SafetyAlertItemInput],
) -> Result<(), SourceIngestionError> {
    if payload.bytes.is_empty() || payload.bytes.len() > MAX_SOURCE_PAYLOAD_BYTES {
        return Err(SourceIngestionError::InvalidInput(
            "source payload must contain 1..=262144 bytes",
        ));
    }
    if payload.content_type.trim().is_empty() || payload.content_type.len() > 200 {
        return Err(SourceIngestionError::InvalidInput(
            "source payload content_type must contain 1..=200 characters",
        ));
    }
    if i64::try_from(payload.bytes.len()).ok() != Some(input.byte_length) {
        return Err(SourceIngestionError::InvalidInput(
            "source payload byte length does not match snapshot",
        ));
    }
    let payload_checksum = hex::encode(Sha256::digest(&payload.bytes));
    if payload_checksum != input.checksum_sha256 {
        return Err(SourceIngestionError::InvalidInput(
            "source payload checksum does not match snapshot",
        ));
    }
    if alerts.len() > 500 {
        return Err(SourceIngestionError::InvalidInput(
            "source snapshot contains too many alert items",
        ));
    }

    let mut alert_ids = HashSet::with_capacity(alerts.len());
    for alert in alerts {
        if !valid_bfarm_alert_id(&alert.alert_id)
            || !alert_ids.insert(alert.alert_id.as_str())
            || alert.official_title.trim().is_empty()
            || alert.official_title.len() > 1_000
            || !alert.official_url.starts_with(
                "https://www.bfarm.de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/",
            )
            || alert.explicit_substance_labels.len() != alert.explicit_substance_keys.len()
            || alert.explicit_substance_keys.iter().any(|value| {
                value.is_empty() || value.trim() != value || value.chars().any(char::is_uppercase)
            })
            || alert.item_checksum_sha256.len() != 64
            || !alert
                .item_checksum_sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(SourceIngestionError::InvalidInput(
                "invalid normalized BfArM alert item",
            ));
        }
    }
    Ok(())
}

fn valid_bfarm_alert_id(value: &str) -> bool {
    value.len() == "bfarm-rhb-".len() + 24
        && value.starts_with("bfarm-rhb-")
        && value["bfarm-rhb-".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_metadata(metadata: &Value) -> Result<(), SourceIngestionError> {
    if !metadata.is_object() {
        return Err(SourceIngestionError::InvalidInput(
            "metadata must be a JSON object",
        ));
    }
    if serde_json::to_vec(metadata)
        .map(|bytes| bytes.len() > MAX_METADATA_BYTES)
        .unwrap_or(true)
    {
        return Err(SourceIngestionError::InvalidInput(
            "metadata exceeds 256 KiB",
        ));
    }
    Ok(())
}

fn is_https_url(value: &str) -> bool {
    value.starts_with("https://") && value.len() > "https://".len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_https_snapshot_and_invalid_checksum() {
        let mut input = SuccessfulSnapshotInput {
            fetched_at: Utc::now(),
            published_at: None,
            source_url: "http://example.invalid/feed".to_string(),
            checksum_sha256: "x".repeat(64),
            version: None,
            item_count: None,
            content_type: None,
            byte_length: 0,
            payload_storage_key: None,
            metadata: serde_json::json!({}),
        };
        assert!(validate_success_input(&input).is_err());
        input.source_url = "https://example.invalid/feed".to_string();
        assert!(validate_success_input(&input).is_err());
        input.checksum_sha256 = "a".repeat(64);
        assert!(validate_success_input(&input).is_ok());
    }
}
