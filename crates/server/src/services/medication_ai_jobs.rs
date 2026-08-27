use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::services::medication_ai_provider::{
    MEDICATION_AI_PROMPT_VERSION, MedicationAiCapability, MedicationAiDraft,
    MedicationAiProviderError, input_fingerprint,
};
use crate::services::medication_evidence_reviews::EvidenceSnapshot;
use crate::state::AppState;

const MAX_ATTEMPTS: i16 = 3;

#[derive(Debug, Clone, Serialize)]
pub struct MedicationAiAnalysisView {
    pub id: Uuid,
    pub review_id: Uuid,
    pub status: String,
    pub requested_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub provider: MedicationAiCapability,
    pub prompt_version: String,
    pub draft: Option<MedicationAiDraft>,
    pub error_code: Option<String>,
}

#[derive(Debug)]
pub struct CreateMedicationAiAnalysisResult {
    pub view: MedicationAiAnalysisView,
    pub created: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum MedicationAiJobError {
    #[error("AI provider is unavailable")]
    ProviderUnavailable,
    #[error("review not found")]
    ReviewNotFound,
    #[error("review is not ready")]
    ReviewNotReady,
    #[error("invalid request input")]
    InvalidInput,
    #[error("idempotency key belongs to another analysis")]
    IdempotencyConflict,
    #[error("stored analysis is invalid")]
    InvalidStoredData,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

struct ClaimedAnalysis {
    id: Uuid,
    lease_token: Uuid,
    patient_id: Uuid,
    review_id: Uuid,
    requested_by: Uuid,
    snapshot: EvidenceSnapshot,
    provider_model: String,
    prompt_version: String,
}

pub async fn create_analysis(
    state: &AppState,
    patient_id: Uuid,
    review_id: Uuid,
    actor_id: Uuid,
    idempotency_key: &str,
) -> Result<CreateMedicationAiAnalysisResult, MedicationAiJobError> {
    validate_idempotency_key(idempotency_key)?;
    let capability = state.medication_ai.capability();
    if !capability.external_calls_enabled {
        return Err(MedicationAiJobError::ProviderUnavailable);
    }
    if let Some(row) = load_by_idempotency(&state.db, actor_id, idempotency_key).await? {
        if row.get::<Uuid, _>("patient_id") != patient_id
            || row.get::<Uuid, _>("review_id") != review_id
        {
            return Err(MedicationAiJobError::IdempotencyConflict);
        }
        return Ok(CreateMedicationAiAnalysisResult {
            view: view_from_row(row, capability)?,
            created: false,
        });
    }

    let review = sqlx::query(
        r#"SELECT request.bundle_id, request.status, bundle.evidence_snapshot
           FROM medication_evidence_review_requests request
           JOIN medication_evidence_bundles bundle ON bundle.id = request.bundle_id
           WHERE request.patient_id = $1 AND request.id = $2"#,
    )
    .bind(patient_id)
    .bind(review_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(MedicationAiJobError::ReviewNotFound)?;
    if review.get::<String, _>("status") != "draft_ready" {
        return Err(MedicationAiJobError::ReviewNotReady);
    }
    let bundle_id: Uuid = review.get("bundle_id");
    let snapshot: EvidenceSnapshot =
        serde_json::from_value(review.get::<Value, _>("evidence_snapshot"))
            .map_err(|_| MedicationAiJobError::InvalidStoredData)?;
    let fingerprint =
        input_fingerprint(&snapshot).map_err(|_| MedicationAiJobError::InvalidStoredData)?;
    let model = capability
        .model
        .as_deref()
        .ok_or(MedicationAiJobError::ProviderUnavailable)?;

    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("medication-ai:{actor_id}:{idempotency_key}"))
        .execute(&mut *tx)
        .await?;
    if let Some(row) = load_by_idempotency_tx(&mut tx, actor_id, idempotency_key).await? {
        tx.commit().await?;
        if row.get::<Uuid, _>("patient_id") != patient_id
            || row.get::<Uuid, _>("review_id") != review_id
        {
            return Err(MedicationAiJobError::IdempotencyConflict);
        }
        return Ok(CreateMedicationAiAnalysisResult {
            view: view_from_row(row, capability)?,
            created: false,
        });
    }
    let analysis_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO medication_ai_analyses
               (patient_id, review_id, bundle_id, provider_kind, provider_model,
                prompt_version, input_fingerprint, idempotency_key, requested_by)
           VALUES ($1, $2, $3, 'openai', $4, $5, $6, $7, $8)
           ON CONFLICT (review_id, input_fingerprint, provider_model, prompt_version) DO NOTHING
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(review_id)
    .bind(bundle_id)
    .bind(model)
    .bind(MEDICATION_AI_PROMPT_VERSION)
    .bind(&fingerprint)
    .bind(idempotency_key)
    .bind(actor_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (analysis_id, created) = match analysis_id {
        Some(id) => (id, true),
        None => (
            sqlx::query_scalar::<_, Uuid>(
                r#"SELECT id FROM medication_ai_analyses
                   WHERE review_id = $1 AND input_fingerprint = $2
                     AND provider_model = $3 AND prompt_version = $4"#,
            )
            .bind(review_id)
            .bind(&fingerprint)
            .bind(model)
            .bind(MEDICATION_AI_PROMPT_VERSION)
            .fetch_one(&mut *tx)
            .await?,
            false,
        ),
    };
    if created {
        sqlx::query(
            r#"INSERT INTO medication_ai_analysis_events
                   (analysis_id, from_status, to_status, reason_code, actor_id)
               VALUES ($1, NULL, 'requested', 'analysis_requested', $2)"#,
        )
        .bind(analysis_id)
        .bind(actor_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    let view = load_analysis(&state.db, patient_id, review_id, capability).await?;
    Ok(CreateMedicationAiAnalysisResult { view, created })
}

pub async fn load_analysis(
    pool: &PgPool,
    patient_id: Uuid,
    review_id: Uuid,
    capability: MedicationAiCapability,
) -> Result<MedicationAiAnalysisView, MedicationAiJobError> {
    let row = sqlx::query(
        r#"SELECT id, patient_id, review_id, status, requested_at, started_at,
                  completed_at, provider_kind,
                  COALESCE(provider_response_model, provider_model) AS provider_model,
                  prompt_version,
                  output_json, error_code
           FROM medication_ai_analyses
           WHERE patient_id = $1 AND review_id = $2
           ORDER BY requested_at DESC, id DESC LIMIT 1"#,
    )
    .bind(patient_id)
    .bind(review_id)
    .fetch_optional(pool)
    .await?
    .ok_or(MedicationAiJobError::ReviewNotFound)?;
    view_from_row(row, capability)
}

pub async fn retry_analysis(
    state: &AppState,
    patient_id: Uuid,
    review_id: Uuid,
    actor_id: Uuid,
) -> Result<MedicationAiAnalysisView, MedicationAiJobError> {
    let capability = state.medication_ai.capability();
    if !capability.external_calls_enabled {
        return Err(MedicationAiJobError::ProviderUnavailable);
    }
    let model = capability
        .model
        .as_deref()
        .ok_or(MedicationAiJobError::ProviderUnavailable)?;
    let mut tx = state.db.begin().await?;
    let analysis_id = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE medication_ai_analyses
           SET status = 'requested', started_at = NULL, completed_at = NULL,
               lease_until = NULL, lease_token = NULL, attempts = 0, error_code = NULL,
               available_at = now(), updated_at = now()
           WHERE patient_id = $1 AND review_id = $2 AND status = 'failed'
             AND provider_model = $3 AND prompt_version = $4
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(review_id)
    .bind(model)
    .bind(MEDICATION_AI_PROMPT_VERSION)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(MedicationAiJobError::ReviewNotReady)?;
    insert_event(
        &mut tx,
        analysis_id,
        "failed",
        "requested",
        "manual_retry_requested",
        Some(actor_id),
    )
    .await?;
    tx.commit().await?;
    load_analysis(&state.db, patient_id, review_id, capability).await
}

fn view_from_row(
    row: sqlx::postgres::PgRow,
    mut capability: MedicationAiCapability,
) -> Result<MedicationAiAnalysisView, MedicationAiJobError> {
    let provider_model: String = row.get("provider_model");
    capability.kind = "openai";
    capability.model = Some(provider_model);
    let output = row.get::<Option<Value>, _>("output_json");
    let draft = output
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| MedicationAiJobError::InvalidStoredData)?;
    Ok(MedicationAiAnalysisView {
        id: row.get("id"),
        review_id: row.get("review_id"),
        status: row.get("status"),
        requested_at: row.get::<DateTime<Utc>, _>("requested_at").to_rfc3339(),
        started_at: row
            .get::<Option<DateTime<Utc>>, _>("started_at")
            .map(|value| value.to_rfc3339()),
        completed_at: row
            .get::<Option<DateTime<Utc>>, _>("completed_at")
            .map(|value| value.to_rfc3339()),
        provider: capability,
        prompt_version: row.get("prompt_version"),
        draft,
        error_code: row.get("error_code"),
    })
}

pub fn spawn_medication_ai_worker(state: AppState) {
    let capability = state.medication_ai.capability();
    if !capability.external_calls_enabled {
        tracing::info!(
            provider_status = capability.status,
            reason_code = capability.reason_code,
            "Medication AI worker disabled"
        );
        return;
    }
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(2));
        loop {
            ticker.tick().await;
            if let Err(error) = process_one(&state).await {
                tracing::error!(error = %error, "Medication AI worker iteration failed");
            }
        }
    });
}

async fn process_one(state: &AppState) -> Result<(), MedicationAiJobError> {
    recover_expired_jobs(state).await?;
    let Some(job) = claim_next(&state.db).await? else {
        return Ok(());
    };
    let current = state.medication_ai.capability();
    if current.model.as_deref() != Some(job.provider_model.as_str())
        || job.prompt_version != MEDICATION_AI_PROMPT_VERSION
    {
        fail_or_retry(
            state,
            &job,
            &MedicationAiProviderError::ConfigurationChanged,
        )
        .await?;
        return Ok(());
    }
    let provider_started_at = Instant::now();
    let generation_result = state.medication_ai.generate(&job.snapshot).await;
    metrics::histogram!(
        crate::business_metrics::MEDICATION_AI_PROVIDER_DURATION_SECONDS,
        "outcome" => if generation_result.is_ok() { "success" } else { "error" }
    )
    .record(provider_started_at.elapsed().as_secs_f64());
    match generation_result {
        Ok(generation) => {
            let output = serde_json::to_value(&generation.draft)?;
            let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(&output)?));
            let mut tx = state.db.begin().await?;
            let changed = sqlx::query(
                r#"UPDATE medication_ai_analyses
                   SET status = 'ready', completed_at = now(), lease_until = NULL,
                       lease_token = NULL, output_json = $3, output_fingerprint = $4,
                       provider_response_id = $5, provider_response_model = $6,
                       updated_at = now()
                   WHERE id = $1 AND status = 'processing'
                     AND lease_token = $2 AND lease_until > clock_timestamp()"#,
            )
            .bind(job.id)
            .bind(job.lease_token)
            .bind(output)
            .bind(fingerprint)
            .bind(&generation.response_id)
            .bind(&generation.model)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if changed == 1 {
                insert_event(
                    &mut tx,
                    job.id,
                    "processing",
                    "ready",
                    "analysis_ready",
                    None,
                )
                .await?;
            }
            tx.commit().await?;
            if changed == 1 {
                metrics::counter!(
                    crate::business_metrics::MEDICATION_AI_JOBS_TOTAL,
                    "outcome" => "ready",
                    "reason" => "accepted_output"
                )
                .increment(1);
                state.audit_sender.try_send(crate::audit::domain_event(
                    "medication_ai_analysis_ready",
                    None,
                    "patient",
                    Some(job.patient_id),
                    json!({
                        "analysis_id": job.id,
                        "review_id": job.review_id,
                        "provider_kind": "openai",
                        "provider_model": generation.model,
                        "provider_response_id": generation.response_id,
                    }),
                ));
                crate::realtime::publish_patient_event(
                    state,
                    None,
                    "patient.medication_ai_analysis_ready",
                    job.patient_id,
                    json!({"analysis_id": job.id, "review_id": job.review_id, "status": "ready"}),
                )
                .await;
                notify_requester(
                    state,
                    job.requested_by,
                    job.patient_id,
                    job.id,
                    "medication_ai_ready",
                    "AI-черновик готов · KI-Entwurf bereit",
                    "Обезличенный черновик доступен для проверки по источникам. · Der de-identifizierte Entwurf kann anhand der Quellen geprüft werden.",
                )
                .await;
            } else {
                tracing::warn!(
                    analysis_id = %job.id,
                    "Discarded medication AI result from stale or expired worker lease"
                );
            }
        }
        Err(error) => fail_or_retry(state, &job, &error).await?,
    }
    Ok(())
}

async fn claim_next(pool: &PgPool) -> Result<Option<ClaimedAnalysis>, MedicationAiJobError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        r#"WITH candidate AS (
               SELECT id FROM medication_ai_analyses
               WHERE status = 'requested' AND available_at <= now() AND attempts < $1
               ORDER BY available_at, requested_at, id
               FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE medication_ai_analyses analysis
           SET status = 'processing', started_at = now(),
               lease_until = clock_timestamp() + interval '75 seconds',
               lease_token = gen_random_uuid(), attempts = attempts + 1, updated_at = now()
           FROM candidate
           WHERE analysis.id = candidate.id
           RETURNING analysis.id, analysis.patient_id, analysis.review_id,
                     analysis.requested_by, analysis.bundle_id,
                     analysis.provider_model, analysis.prompt_version,
                     analysis.lease_token"#,
    )
    .bind(MAX_ATTEMPTS)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };
    let analysis_id: Uuid = row.get("id");
    insert_event(
        &mut tx,
        analysis_id,
        "requested",
        "processing",
        "worker_claimed",
        None,
    )
    .await?;
    let snapshot_value = sqlx::query_scalar::<_, Value>(
        "SELECT evidence_snapshot FROM medication_evidence_bundles WHERE id = $1",
    )
    .bind(row.get::<Uuid, _>("bundle_id"))
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    let snapshot = serde_json::from_value(snapshot_value)
        .map_err(|_| MedicationAiJobError::InvalidStoredData)?;
    Ok(Some(ClaimedAnalysis {
        id: analysis_id,
        lease_token: row.get("lease_token"),
        patient_id: row.get("patient_id"),
        review_id: row.get("review_id"),
        requested_by: row.get("requested_by"),
        snapshot,
        provider_model: row.get("provider_model"),
        prompt_version: row.get("prompt_version"),
    }))
}

async fn recover_expired_jobs(state: &AppState) -> Result<(), MedicationAiJobError> {
    let mut tx = state.db.begin().await?;
    let retry_ids = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE medication_ai_analyses
           SET status = 'requested', started_at = NULL, lease_until = NULL, lease_token = NULL,
               available_at = now() + interval '10 seconds', updated_at = now()
           WHERE status = 'processing' AND lease_until <= clock_timestamp() AND attempts < $1
           RETURNING id"#,
    )
    .bind(MAX_ATTEMPTS)
    .fetch_all(&mut *tx)
    .await?;
    let recovered_count = retry_ids.len() as u64;
    for id in retry_ids {
        insert_event(
            &mut tx,
            id,
            "processing",
            "requested",
            "worker_lease_expired",
            None,
        )
        .await?;
    }
    let failed_rows = sqlx::query(
        r#"UPDATE medication_ai_analyses
           SET status = 'failed', completed_at = now(), lease_until = NULL, lease_token = NULL,
               error_code = 'worker_lease_exhausted', updated_at = now()
           WHERE status = 'processing' AND lease_until <= clock_timestamp() AND attempts >= $1
           RETURNING id, patient_id, review_id, requested_by"#,
    )
    .bind(MAX_ATTEMPTS)
    .fetch_all(&mut *tx)
    .await?;
    let exhausted_count = failed_rows.len() as u64;
    for row in &failed_rows {
        insert_event(
            &mut tx,
            row.get("id"),
            "processing",
            "failed",
            "worker_lease_exhausted",
            None,
        )
        .await?;
    }
    tx.commit().await?;
    if recovered_count > 0 {
        metrics::counter!(
            crate::business_metrics::MEDICATION_AI_JOBS_TOTAL,
            "outcome" => "retry_scheduled",
            "reason" => "worker_lease_expired"
        )
        .increment(recovered_count);
    }
    if exhausted_count > 0 {
        metrics::counter!(
            crate::business_metrics::MEDICATION_AI_JOBS_TOTAL,
            "outcome" => "failed",
            "reason" => "worker_lease_exhausted"
        )
        .increment(exhausted_count);
    }
    for row in failed_rows {
        publish_terminal_failure(
            state,
            row.get("id"),
            row.get("patient_id"),
            row.get("review_id"),
            row.get("requested_by"),
            "worker_lease_exhausted",
        )
        .await;
    }
    Ok(())
}

async fn fail_or_retry(
    state: &AppState,
    job: &ClaimedAnalysis,
    error: &MedicationAiProviderError,
) -> Result<(), MedicationAiJobError> {
    let mut tx = state.db.begin().await?;
    let attempts = sqlx::query_scalar::<_, i16>(
        r#"SELECT attempts FROM medication_ai_analyses
           WHERE id = $1 AND status = 'processing'
             AND lease_token = $2 AND lease_until > clock_timestamp()
           FOR UPDATE"#,
    )
    .bind(job.id)
    .bind(job.lease_token)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(attempts) = attempts else {
        tx.rollback().await?;
        tracing::warn!(
            analysis_id = %job.id,
            error_code = error.code(),
            "Discarded medication AI failure from stale or expired worker lease"
        );
        return Ok(());
    };
    let retryable = error.is_retryable();
    let terminal_failure = !(retryable && attempts < MAX_ATTEMPTS);
    let metric_outcome = if !terminal_failure {
        let changed = sqlx::query(
            r#"UPDATE medication_ai_analyses
               SET status = 'requested', started_at = NULL, lease_until = NULL,
                   lease_token = NULL,
                   available_at = now() + ($3 * interval '10 seconds'), updated_at = now()
               WHERE id = $1 AND status = 'processing'
                 AND lease_token = $2 AND lease_until > clock_timestamp()"#,
        )
        .bind(job.id)
        .bind(job.lease_token)
        .bind(i32::from(attempts))
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if changed != 1 {
            tx.rollback().await?;
            tracing::warn!(
                analysis_id = %job.id,
                error_code = error.code(),
                "Discarded medication AI retry from expired worker lease"
            );
            return Ok(());
        }
        insert_event(
            &mut tx,
            job.id,
            "processing",
            "requested",
            "provider_retry_scheduled",
            None,
        )
        .await?;
        "retry_scheduled"
    } else {
        let changed = sqlx::query(
            r#"UPDATE medication_ai_analyses
               SET status = 'failed', completed_at = now(), lease_until = NULL,
                   lease_token = NULL, error_code = $3, updated_at = now()
               WHERE id = $1 AND status = 'processing'
                 AND lease_token = $2 AND lease_until > clock_timestamp()"#,
        )
        .bind(job.id)
        .bind(job.lease_token)
        .bind(error.code())
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if changed != 1 {
            tx.rollback().await?;
            tracing::warn!(
                analysis_id = %job.id,
                error_code = error.code(),
                "Discarded medication AI terminal failure from expired worker lease"
            );
            return Ok(());
        }
        insert_event(&mut tx, job.id, "processing", "failed", error.code(), None).await?;
        "failed"
    };
    tx.commit().await?;
    metrics::counter!(
        crate::business_metrics::MEDICATION_AI_JOBS_TOTAL,
        "outcome" => metric_outcome,
        "reason" => error.code()
    )
    .increment(1);
    if terminal_failure {
        publish_terminal_failure(
            state,
            job.id,
            job.patient_id,
            job.review_id,
            job.requested_by,
            error.code(),
        )
        .await;
    }
    Ok(())
}

async fn publish_terminal_failure(
    state: &AppState,
    analysis_id: Uuid,
    patient_id: Uuid,
    review_id: Uuid,
    requested_by: Uuid,
    error_code: &str,
) {
    state.audit_sender.try_send(crate::audit::domain_event(
        "medication_ai_analysis_failed",
        None,
        "patient",
        Some(patient_id),
        json!({
            "analysis_id": analysis_id,
            "review_id": review_id,
            "provider_kind": "openai",
            "error_code": error_code,
        }),
    ));
    crate::realtime::publish_patient_event(
        state,
        None,
        "patient.medication_ai_analysis_failed",
        patient_id,
        json!({"analysis_id": analysis_id, "review_id": review_id, "status": "failed"}),
    )
    .await;
    notify_requester(
        state,
        requested_by,
        patient_id,
        analysis_id,
        "medication_ai_failed",
        "AI-черновик не сформирован · KI-Entwurf fehlgeschlagen",
        "Безопасная обработка завершилась ошибкой; локальный пакет не изменён. · Die sichere Verarbeitung ist fehlgeschlagen; das lokale Paket blieb unverändert.",
    )
    .await;
}

async fn notify_requester(
    state: &AppState,
    requested_by: Uuid,
    patient_id: Uuid,
    analysis_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
    let result = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO user_notifications
               (user_id, kind, title, body, entity_type, entity_id)
           VALUES ($1, $2, $3, $4, 'patient', $5)
           RETURNING id"#,
    )
    .bind(requested_by)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(patient_id)
    .fetch_one(&state.db)
    .await;
    match result {
        Ok(notification_id) => {
            crate::realtime::publish_notification_event(
                state,
                requested_by,
                "notification.created",
                Some(notification_id),
                json!({"entity_type": "patient", "entity_id": patient_id}),
            )
            .await;
        }
        Err(error) => {
            tracing::warn!(
                error = %error,
                analysis_id = %analysis_id,
                "create medication AI operator notification"
            );
        }
    }
}

async fn insert_event(
    tx: &mut Transaction<'_, Postgres>,
    analysis_id: Uuid,
    from_status: &str,
    to_status: &str,
    reason_code: &str,
    actor_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO medication_ai_analysis_events
               (analysis_id, from_status, to_status, reason_code, actor_id)
           VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(analysis_id)
    .bind(from_status)
    .bind(to_status)
    .bind(reason_code)
    .bind(actor_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn load_by_idempotency(
    pool: &PgPool,
    actor_id: Uuid,
    key: &str,
) -> Result<Option<sqlx::postgres::PgRow>, sqlx::Error> {
    sqlx::query(
        r#"SELECT id, patient_id, review_id, status, requested_at, started_at,
                  completed_at, provider_kind,
                  COALESCE(provider_response_model, provider_model) AS provider_model,
                  prompt_version,
                  output_json, error_code
           FROM medication_ai_analyses WHERE requested_by = $1 AND idempotency_key = $2"#,
    )
    .bind(actor_id)
    .bind(key)
    .fetch_optional(pool)
    .await
}

async fn load_by_idempotency_tx(
    tx: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    key: &str,
) -> Result<Option<sqlx::postgres::PgRow>, sqlx::Error> {
    sqlx::query(
        r#"SELECT id, patient_id, review_id, status, requested_at, started_at,
                  completed_at, provider_kind,
                  COALESCE(provider_response_model, provider_model) AS provider_model,
                  prompt_version,
                  output_json, error_code
           FROM medication_ai_analyses WHERE requested_by = $1 AND idempotency_key = $2"#,
    )
    .bind(actor_id)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await
}

fn validate_idempotency_key(value: &str) -> Result<(), MedicationAiJobError> {
    if value.trim().is_empty()
        || value != value.trim()
        || value.chars().count() > 128
        || value.chars().any(char::is_control)
    {
        return Err(MedicationAiJobError::InvalidInput);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idempotency_key_is_strictly_bounded() {
        assert!(validate_idempotency_key("ai-review-1").is_ok());
        assert!(validate_idempotency_key(" ").is_err());
        assert!(validate_idempotency_key(" ai-review-1").is_err());
        assert!(validate_idempotency_key(&"a".repeat(129)).is_err());
    }
}
