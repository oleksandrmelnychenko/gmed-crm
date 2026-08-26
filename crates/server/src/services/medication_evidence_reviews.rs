use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::routes::medication_intelligence::MedicationIntelligenceResponse;
use crate::services::medication_intelligence_sources::{
    OfficialSourceStatus, SuccessfulSnapshotStatus,
};

pub const EVIDENCE_MODE: &str = "local_evidence_only";
pub const EVIDENCE_BUNDLE_VERSION: &str = "medication-evidence-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceSummary {
    pub active_medications: usize,
    pub identified_medications: usize,
    pub unresolved_medications: usize,
    pub findings_total: usize,
    pub high_priority_findings: usize,
    pub missing_data_total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceFinding {
    pub id: String,
    pub severity: String,
    pub category: String,
    pub title_ru: String,
    pub title_de: String,
    pub medication_ids: Vec<Uuid>,
    pub evidence_refs: Vec<String>,
    pub source_id: Option<String>,
    pub published_at: Option<String>,
    pub source_url: Option<String>,
    pub substances: Vec<String>,
    pub citation_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceMissingData {
    pub code: String,
    pub reason_ru: String,
    pub reason_de: String,
    pub citation_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceSourceSnapshot {
    pub id: Uuid,
    pub fetched_at: String,
    pub published_at: Option<String>,
    pub version: Option<String>,
    pub checksum_sha256: String,
    pub item_count: Option<i64>,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceSource {
    pub id: String,
    pub label: String,
    pub authority: String,
    pub kind: String,
    pub url: String,
    pub machine_readable: bool,
    pub ingestion_status: String,
    pub health: String,
    pub last_successful_snapshot: Option<EvidenceSourceSnapshot>,
    pub citation_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceCitation {
    pub id: String,
    pub kind: String,
    pub source_id: Option<String>,
    pub source_url: Option<String>,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceSnapshot {
    pub summary: EvidenceSummary,
    pub medication_ids: Vec<Uuid>,
    pub findings: Vec<EvidenceFinding>,
    pub missing_data: Vec<EvidenceMissingData>,
    pub sources: Vec<EvidenceSource>,
    pub citations: Vec<EvidenceCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DraftItem {
    pub text_ru: String,
    pub text_de: String,
    pub citation_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EvidenceProvider {
    pub kind: &'static str,
    pub status: &'static str,
    pub external_calls_enabled: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ClinicalReviewCapability {
    pub status: &'static str,
    pub can_approve: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EvidenceReviewPermissions {
    pub can_create_review: bool,
    pub can_read_review: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LatestReviewSummary {
    pub id: Uuid,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidencePreviewResponse {
    pub mode: &'static str,
    pub generated_at: String,
    pub intelligence_fingerprint: String,
    pub summary: EvidenceSummary,
    pub medication_ids: Vec<Uuid>,
    pub provider: EvidenceProvider,
    pub clinical_review: ClinicalReviewCapability,
    pub permissions: EvidenceReviewPermissions,
    pub latest_review: Option<LatestReviewSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceReviewMeta {
    pub id: Uuid,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub bundle_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceBundleView {
    pub id: Uuid,
    pub version: String,
    pub fingerprint: String,
    pub created_at: String,
    pub summary: EvidenceSummary,
    pub medication_ids: Vec<Uuid>,
    pub findings: Vec<EvidenceFinding>,
    pub missing_data: Vec<EvidenceMissingData>,
    pub sources: Vec<EvidenceSource>,
    pub citations: Vec<EvidenceCitation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceDraftView {
    pub id: Uuid,
    pub status: String,
    pub created_at: String,
    pub evidence_summary: Vec<DraftItem>,
    pub verification_questions: Vec<DraftItem>,
    pub limitations: Vec<DraftItem>,
    pub citation_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceReviewResponse {
    pub mode: &'static str,
    pub review: EvidenceReviewMeta,
    pub bundle: EvidenceBundleView,
    pub draft: EvidenceDraftView,
    pub provider: EvidenceProvider,
    pub clinical_review: ClinicalReviewCapability,
    pub permissions: EvidenceReviewPermissions,
}

#[derive(Debug)]
pub struct CreateReviewResult {
    pub response: EvidenceReviewResponse,
    pub created: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum MedicationEvidenceReviewError {
    #[error("review not found")]
    NotFound,
    #[error("medication intelligence changed")]
    StaleFingerprint,
    #[error("idempotency key belongs to another request")]
    IdempotencyConflict,
    #[error("invalid request input")]
    InvalidInput,
    #[error("draft contains a citation outside the evidence bundle")]
    InvalidCitation,
    #[error("stored evidence review is invalid")]
    InvalidStoredData,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub fn provider() -> EvidenceProvider {
    EvidenceProvider {
        kind: "none",
        status: "not_configured",
        external_calls_enabled: false,
        reason_code: "external_provider_not_configured",
    }
}

pub fn clinical_review() -> ClinicalReviewCapability {
    ClinicalReviewCapability {
        status: "not_configured",
        can_approve: false,
    }
}

pub fn permissions() -> EvidenceReviewPermissions {
    EvidenceReviewPermissions {
        can_create_review: true,
        can_read_review: true,
    }
}

pub async fn build_preview(
    pool: &PgPool,
    patient_id: Uuid,
    intelligence: &MedicationIntelligenceResponse,
) -> Result<EvidencePreviewResponse, MedicationEvidenceReviewError> {
    let prepared = prepare_snapshot(intelligence)?;
    let latest = sqlx::query(
        r#"SELECT id, status, requested_at
           FROM medication_evidence_review_requests
           WHERE patient_id = $1
           ORDER BY requested_at DESC, id DESC
           LIMIT 1"#,
    )
    .bind(patient_id)
    .fetch_optional(pool)
    .await?
    .map(|row| LatestReviewSummary {
        id: row.get("id"),
        status: row.get("status"),
        created_at: row.get::<DateTime<Utc>, _>("requested_at").to_rfc3339(),
    });

    Ok(EvidencePreviewResponse {
        mode: EVIDENCE_MODE,
        generated_at: Utc::now().to_rfc3339(),
        intelligence_fingerprint: prepared.fingerprint,
        summary: prepared.snapshot.summary.clone(),
        medication_ids: prepared.snapshot.medication_ids.clone(),
        provider: provider(),
        clinical_review: clinical_review(),
        permissions: permissions(),
        latest_review: latest,
    })
}

pub async fn create_review(
    pool: &PgPool,
    patient_id: Uuid,
    actor_id: Uuid,
    expected_fingerprint: &str,
    idempotency_key: &str,
    intelligence: &MedicationIntelligenceResponse,
) -> Result<CreateReviewResult, MedicationEvidenceReviewError> {
    validate_create_input(expected_fingerprint, idempotency_key)?;
    let prepared = prepare_snapshot(intelligence)?;

    if let Some(existing) = load_idempotent_request(pool, actor_id, idempotency_key).await? {
        return replay_or_conflict(pool, existing, patient_id, expected_fingerprint).await;
    }
    if expected_fingerprint != prepared.fingerprint {
        return Err(MedicationEvidenceReviewError::StaleFingerprint);
    }

    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("medication-evidence:{actor_id}:{idempotency_key}"))
        .execute(&mut *tx)
        .await?;
    if let Some(existing) = load_idempotent_request_tx(&mut tx, actor_id, idempotency_key).await? {
        tx.commit().await?;
        return replay_or_conflict(pool, existing, patient_id, expected_fingerprint).await;
    }

    let snapshot_value = serde_json::to_value(&prepared.snapshot)?;
    let inserted_bundle_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO medication_evidence_bundles
               (patient_id, bundle_version, intelligence_fingerprint,
                evidence_snapshot, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (patient_id, bundle_version, intelligence_fingerprint)
           DO NOTHING
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(EVIDENCE_BUNDLE_VERSION)
    .bind(&prepared.fingerprint)
    .bind(snapshot_value)
    .bind(actor_id)
    .fetch_optional(&mut *tx)
    .await?;
    let bundle_id = match inserted_bundle_id {
        Some(id) => id,
        None => {
            sqlx::query_scalar::<_, Uuid>(
                r#"SELECT id
               FROM medication_evidence_bundles
               WHERE patient_id = $1
                 AND bundle_version = $2
                 AND intelligence_fingerprint = $3"#,
            )
            .bind(patient_id)
            .bind(EVIDENCE_BUNDLE_VERSION)
            .bind(&prepared.fingerprint)
            .fetch_one(&mut *tx)
            .await?
        }
    };

    let request_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO medication_evidence_review_requests
               (patient_id, bundle_id, requested_fingerprint, idempotency_key,
                provider_kind, provider_status, external_calls_enabled, requested_by)
           VALUES ($1, $2, $3, $4, 'none', 'not_configured', false, $5)
           ON CONFLICT (requested_by, idempotency_key) DO NOTHING
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(bundle_id)
    .bind(&prepared.fingerprint)
    .bind(idempotency_key)
    .bind(actor_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        Some(id) => id,
        None => {
            let existing = load_idempotent_request_tx(&mut tx, actor_id, idempotency_key)
                .await?
                .ok_or(MedicationEvidenceReviewError::IdempotencyConflict)?;
            tx.commit().await?;
            return replay_or_conflict(pool, existing, patient_id, expected_fingerprint).await;
        }
    };

    sqlx::query(
        r#"INSERT INTO medication_evidence_review_state_events
               (request_id, from_status, to_status, reason_code, actor_id)
           VALUES ($1, NULL, 'requested', 'local_bundle_requested', $2)"#,
    )
    .bind(request_id)
    .bind(actor_id)
    .execute(&mut *tx)
    .await?;

    let draft = build_draft(&prepared.snapshot)?;
    let draft_value = serde_json::to_value(&draft)?;
    let content_fingerprint = sha256_json(&draft_value)?;
    sqlx::query(
        r#"INSERT INTO medication_evidence_review_drafts
               (request_id, bundle_id, status, evidence_summary,
                verification_questions, limitations, citation_refs,
                content_fingerprint, created_by)
           VALUES ($1, $2, 'ready', $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(request_id)
    .bind(bundle_id)
    .bind(serde_json::to_value(&draft.evidence_summary)?)
    .bind(serde_json::to_value(&draft.verification_questions)?)
    .bind(serde_json::to_value(&draft.limitations)?)
    .bind(serde_json::to_value(&draft.citation_refs)?)
    .bind(content_fingerprint)
    .bind(actor_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"UPDATE medication_evidence_review_requests
           SET status = 'draft_ready', completed_at = now(), updated_at = now()
           WHERE id = $1 AND status = 'requested'"#,
    )
    .bind(request_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO medication_evidence_review_state_events
               (request_id, from_status, to_status, reason_code, actor_id)
           VALUES ($1, 'requested', 'draft_ready', 'local_draft_generated', $2)"#,
    )
    .bind(request_id)
    .bind(actor_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(CreateReviewResult {
        response: load_review(pool, patient_id, request_id).await?,
        created: true,
    })
}

pub async fn load_review(
    pool: &PgPool,
    patient_id: Uuid,
    review_id: Uuid,
) -> Result<EvidenceReviewResponse, MedicationEvidenceReviewError> {
    let row = sqlx::query(
        r#"SELECT request.id AS request_id, request.status AS request_status,
                  request.requested_at, request.completed_at,
                  bundle.id AS bundle_id, bundle.bundle_version,
                  bundle.intelligence_fingerprint, bundle.evidence_snapshot,
                  bundle.created_at AS bundle_created_at,
                  draft.id AS draft_id, draft.status AS draft_status,
                  draft.created_at AS draft_created_at,
                  draft.evidence_summary, draft.verification_questions,
                  draft.limitations, draft.citation_refs
           FROM medication_evidence_review_requests request
           JOIN medication_evidence_bundles bundle ON bundle.id = request.bundle_id
           LEFT JOIN medication_evidence_review_drafts draft ON draft.request_id = request.id
           WHERE request.patient_id = $1 AND request.id = $2"#,
    )
    .bind(patient_id)
    .bind(review_id)
    .fetch_optional(pool)
    .await?
    .ok_or(MedicationEvidenceReviewError::NotFound)?;

    let snapshot: EvidenceSnapshot =
        serde_json::from_value(row.get::<Value, _>("evidence_snapshot"))?;
    validate_snapshot(&snapshot)?;
    let draft_id = row
        .get::<Option<Uuid>, _>("draft_id")
        .ok_or(MedicationEvidenceReviewError::InvalidStoredData)?;
    let draft = EvidenceDraftView {
        id: draft_id,
        status: row
            .get::<Option<String>, _>("draft_status")
            .ok_or(MedicationEvidenceReviewError::InvalidStoredData)?,
        created_at: row
            .get::<Option<DateTime<Utc>>, _>("draft_created_at")
            .ok_or(MedicationEvidenceReviewError::InvalidStoredData)?
            .to_rfc3339(),
        evidence_summary: deserialize_column(&row, "evidence_summary")?,
        verification_questions: deserialize_column(&row, "verification_questions")?,
        limitations: deserialize_column(&row, "limitations")?,
        citation_refs: deserialize_column(&row, "citation_refs")?,
    };
    validate_draft(&snapshot, &draft)?;

    Ok(EvidenceReviewResponse {
        mode: EVIDENCE_MODE,
        review: EvidenceReviewMeta {
            id: row.get("request_id"),
            status: row.get("request_status"),
            created_at: row.get::<DateTime<Utc>, _>("requested_at").to_rfc3339(),
            completed_at: row
                .get::<Option<DateTime<Utc>>, _>("completed_at")
                .map(|value| value.to_rfc3339()),
            bundle_id: row.get("bundle_id"),
        },
        bundle: EvidenceBundleView {
            id: row.get("bundle_id"),
            version: row.get("bundle_version"),
            fingerprint: row.get("intelligence_fingerprint"),
            created_at: row
                .get::<DateTime<Utc>, _>("bundle_created_at")
                .to_rfc3339(),
            summary: snapshot.summary,
            medication_ids: snapshot.medication_ids,
            findings: snapshot.findings,
            missing_data: snapshot.missing_data,
            sources: snapshot.sources,
            citations: snapshot.citations,
        },
        draft,
        provider: provider(),
        clinical_review: clinical_review(),
        permissions: permissions(),
    })
}

struct PreparedSnapshot {
    snapshot: EvidenceSnapshot,
    fingerprint: String,
}

fn prepare_snapshot(
    intelligence: &MedicationIntelligenceResponse,
) -> Result<PreparedSnapshot, MedicationEvidenceReviewError> {
    let summary = EvidenceSummary {
        active_medications: intelligence.summary.active_medications,
        identified_medications: intelligence.summary.identified_medications,
        unresolved_medications: intelligence.summary.unresolved_medications,
        findings_total: intelligence.summary.findings_total,
        high_priority_findings: intelligence.summary.high_priority_findings,
        missing_data_total: intelligence.summary.missing_data_total,
    };
    let mut medication_ids = intelligence
        .medications
        .iter()
        .map(|medication| medication.id)
        .collect::<Vec<_>>();
    medication_ids.sort_unstable();
    medication_ids.dedup();

    let mut findings = intelligence
        .findings
        .iter()
        .map(|finding| EvidenceFinding {
            id: finding.id.clone(),
            severity: finding.severity.to_string(),
            category: finding.category.to_string(),
            title_ru: finding.title_ru.clone(),
            title_de: finding.title_de.clone(),
            medication_ids: {
                let mut ids = finding.medication_ids.clone();
                ids.sort_unstable();
                ids.dedup();
                ids
            },
            evidence_refs: sorted_unique(finding.evidence_refs.clone()),
            source_id: finding.source_id.clone(),
            published_at: finding.published_at.clone().flatten(),
            source_url: finding.source_url.clone(),
            substances: sorted_unique(finding.substances.clone().unwrap_or_default()),
            citation_ref: format!("finding:{}", finding.id),
        })
        .collect::<Vec<_>>();
    findings.sort_by(|left, right| left.id.cmp(&right.id));

    let mut missing_data = intelligence
        .missing_data
        .iter()
        .map(|entry| {
            let identity = json!({
                "code": entry.code,
                "reason_ru": entry.reason_ru,
                "reason_de": entry.reason_de,
            });
            Ok(EvidenceMissingData {
                code: entry.code.to_string(),
                reason_ru: entry.reason_ru.clone(),
                reason_de: entry.reason_de.clone(),
                citation_ref: format!("missing-data:{}", sha256_json(&identity)?),
            })
        })
        .collect::<Result<Vec<_>, MedicationEvidenceReviewError>>()?;
    missing_data.sort_by(|left, right| left.citation_ref.cmp(&right.citation_ref));

    let mut sources = intelligence
        .sources
        .iter()
        .map(source_projection)
        .collect::<Vec<_>>();
    sources.sort_by(|left, right| left.id.cmp(&right.id));

    let mut citations = Vec::with_capacity(findings.len() + missing_data.len() + sources.len());
    citations.extend(findings.iter().map(|finding| EvidenceCitation {
        id: finding.citation_ref.clone(),
        kind: "finding".to_string(),
        source_id: finding.source_id.clone(),
        source_url: finding.source_url.clone(),
        evidence_refs: finding.evidence_refs.clone(),
    }));
    citations.extend(missing_data.iter().map(|entry| EvidenceCitation {
        id: entry.citation_ref.clone(),
        kind: "missing_data".to_string(),
        source_id: None,
        source_url: None,
        evidence_refs: Vec::new(),
    }));
    citations.extend(sources.iter().map(|source| {
        EvidenceCitation {
            id: source.citation_ref.clone(),
            kind: "source".to_string(),
            source_id: Some(source.id.clone()),
            source_url: Some(
                source
                    .last_successful_snapshot
                    .as_ref()
                    .map(|snapshot| snapshot.source_url.clone())
                    .unwrap_or_else(|| source.url.clone()),
            ),
            evidence_refs: source
                .last_successful_snapshot
                .as_ref()
                .map(|snapshot| vec![format!("snapshot:{}", snapshot.id)])
                .unwrap_or_default(),
        }
    }));
    citations.sort_by(|left, right| left.id.cmp(&right.id));

    let snapshot = EvidenceSnapshot {
        summary,
        medication_ids,
        findings,
        missing_data,
        sources,
        citations,
    };
    validate_snapshot(&snapshot)?;
    let fingerprint = sha256_json(&serde_json::to_value(&snapshot)?)?;
    Ok(PreparedSnapshot {
        snapshot,
        fingerprint,
    })
}

fn source_projection(source: &OfficialSourceStatus) -> EvidenceSource {
    EvidenceSource {
        id: source.id.clone(),
        label: source.label.clone(),
        authority: source.authority.clone(),
        kind: source.kind.clone(),
        url: source.url.clone(),
        machine_readable: source.machine_readable,
        ingestion_status: source.ingestion_status.clone(),
        health: source.health.clone(),
        last_successful_snapshot: source
            .last_successful_snapshot
            .as_ref()
            .map(|snapshot| snapshot_projection(snapshot, &source.url)),
        citation_ref: format!("source:{}", source.id),
    }
}

fn snapshot_projection(
    snapshot: &SuccessfulSnapshotStatus,
    public_source_url: &str,
) -> EvidenceSourceSnapshot {
    EvidenceSourceSnapshot {
        id: snapshot.id,
        fetched_at: snapshot.fetched_at.clone(),
        published_at: snapshot.published_at.clone(),
        version: snapshot.version.clone(),
        checksum_sha256: snapshot.checksum_sha256.clone(),
        item_count: snapshot.item_count,
        // The fetch URL may be a server-side permanent link (for example G-BA
        // AIS). Evidence responses expose the source registry's public official
        // reference URL, never a worker fetch URL or query credential.
        source_url: public_source_url.to_string(),
    }
}

#[derive(Serialize)]
struct LocalDraft {
    evidence_summary: Vec<DraftItem>,
    verification_questions: Vec<DraftItem>,
    limitations: Vec<DraftItem>,
    citation_refs: Vec<String>,
}

fn build_draft(snapshot: &EvidenceSnapshot) -> Result<LocalDraft, MedicationEvidenceReviewError> {
    let evidence_summary = snapshot
        .findings
        .iter()
        .map(|finding| DraftItem {
            text_ru: finding.title_ru.clone(),
            text_de: finding.title_de.clone(),
            citation_refs: vec![finding.citation_ref.clone()],
        })
        .collect::<Vec<_>>();
    let mut verification_questions = snapshot
        .missing_data
        .iter()
        .map(|entry| DraftItem {
            text_ru: format!("Требуется проверить: {}", entry.reason_ru),
            text_de: format!("Zu prüfen: {}", entry.reason_de),
            citation_refs: vec![entry.citation_ref.clone()],
        })
        .collect::<Vec<_>>();
    verification_questions.extend(snapshot.findings.iter().filter_map(|finding| {
        let substance = finding.substances.join(", ");
        match finding.category.as_str() {
            "duplicate_active_ingredient" => Some(DraftItem {
                text_ru: if substance.is_empty() {
                    "Проверьте, являются ли несколько активных записей с одинаковым действующим веществом актуальными и намеренными.".to_string()
                } else {
                    format!(
                        "Проверьте, являются ли несколько активных записей с действующим веществом {substance} актуальными и намеренными."
                    )
                },
                text_de: if substance.is_empty() {
                    "Prüfen Sie, ob mehrere aktive Einträge mit demselben Wirkstoff aktuell und beabsichtigt sind.".to_string()
                } else {
                    format!(
                        "Prüfen Sie, ob mehrere aktive Einträge mit dem Wirkstoff {substance} aktuell und beabsichtigt sind."
                    )
                },
                citation_refs: vec![finding.citation_ref.clone()],
            }),
            "official_safety_alert" => Some(DraftItem {
                text_ru: "Проверьте связанный оригинал сообщения BfArM и документируйте его применимость к записи пациента.".to_string(),
                text_de: "Prüfen Sie die verknüpfte BfArM-Originalmitteilung und dokumentieren Sie ihre Relevanz für den Patienteneintrag.".to_string(),
                citation_refs: vec![finding.citation_ref.clone()],
            }),
            _ => None,
        }
    }));
    let limitations = vec![
        DraftItem {
            text_ru: "Это техническая сводка доказательств, а не рекомендация по лечению или дозировке.".to_string(),
            text_de: "Dies ist eine technische Evidenzübersicht, keine Therapie- oder Dosierungsempfehlung.".to_string(),
            citation_refs: Vec::new(),
        },
        DraftItem {
            text_ru: "Отсутствие предупреждения не подтверждает безопасность препарата, комбинации или дозировки.".to_string(),
            text_de: "Das Fehlen eines Hinweises belegt nicht die Sicherheit eines Arzneimittels, einer Kombination oder Dosierung.".to_string(),
            citation_refs: Vec::new(),
        },
        DraftItem {
            text_ru: "Клиническое рассмотрение в системе не настроено; эта черновая сводка не может быть медицински одобрена.".to_string(),
            text_de: "Eine klinische Prüfung ist im System nicht konfiguriert; dieser Entwurf kann nicht medizinisch freigegeben werden.".to_string(),
            citation_refs: Vec::new(),
        },
    ];
    let citation_refs = evidence_summary
        .iter()
        .chain(&verification_questions)
        .chain(&limitations)
        .flat_map(|item| item.citation_refs.iter().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let draft = LocalDraft {
        evidence_summary,
        verification_questions,
        limitations,
        citation_refs,
    };
    validate_local_draft(snapshot, &draft)?;
    Ok(draft)
}

fn validate_snapshot(snapshot: &EvidenceSnapshot) -> Result<(), MedicationEvidenceReviewError> {
    let citation_ids = snapshot
        .citations
        .iter()
        .map(|citation| citation.id.as_str())
        .collect::<BTreeSet<_>>();
    if citation_ids.len() != snapshot.citations.len()
        || snapshot
            .findings
            .iter()
            .any(|finding| !citation_ids.contains(finding.citation_ref.as_str()))
        || snapshot
            .missing_data
            .iter()
            .any(|entry| !citation_ids.contains(entry.citation_ref.as_str()))
        || snapshot
            .sources
            .iter()
            .any(|source| !citation_ids.contains(source.citation_ref.as_str()))
    {
        return Err(MedicationEvidenceReviewError::InvalidCitation);
    }
    Ok(())
}

fn validate_local_draft(
    snapshot: &EvidenceSnapshot,
    draft: &LocalDraft,
) -> Result<(), MedicationEvidenceReviewError> {
    let allowed = snapshot
        .citations
        .iter()
        .map(|citation| citation.id.as_str())
        .collect::<BTreeSet<_>>();
    let used = draft
        .evidence_summary
        .iter()
        .chain(&draft.verification_questions)
        .chain(&draft.limitations)
        .flat_map(|item| item.citation_refs.iter().map(String::as_str))
        .collect::<BTreeSet<_>>();
    if used.iter().any(|reference| !allowed.contains(reference))
        || draft
            .citation_refs
            .iter()
            .any(|reference| !allowed.contains(reference.as_str()))
        || draft
            .citation_refs
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>()
            != used
    {
        return Err(MedicationEvidenceReviewError::InvalidCitation);
    }
    Ok(())
}

fn validate_draft(
    snapshot: &EvidenceSnapshot,
    draft: &EvidenceDraftView,
) -> Result<(), MedicationEvidenceReviewError> {
    let local = LocalDraft {
        evidence_summary: draft.evidence_summary.clone(),
        verification_questions: draft.verification_questions.clone(),
        limitations: draft.limitations.clone(),
        citation_refs: draft.citation_refs.clone(),
    };
    validate_local_draft(snapshot, &local)
}

fn validate_create_input(
    fingerprint: &str,
    idempotency_key: &str,
) -> Result<(), MedicationEvidenceReviewError> {
    if fingerprint.len() != 64
        || !fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || idempotency_key.trim().is_empty()
        || idempotency_key != idempotency_key.trim()
        || idempotency_key.chars().count() > 128
        || idempotency_key.chars().any(char::is_control)
    {
        return Err(MedicationEvidenceReviewError::InvalidInput);
    }
    Ok(())
}

#[derive(Debug)]
struct IdempotentRequest {
    id: Uuid,
    patient_id: Uuid,
    fingerprint: String,
}

async fn load_idempotent_request(
    pool: &PgPool,
    actor_id: Uuid,
    idempotency_key: &str,
) -> Result<Option<IdempotentRequest>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, patient_id, requested_fingerprint
           FROM medication_evidence_review_requests
           WHERE requested_by = $1 AND idempotency_key = $2"#,
    )
    .bind(actor_id)
    .bind(idempotency_key)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(idempotent_from_row))
}

async fn load_idempotent_request_tx(
    tx: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    idempotency_key: &str,
) -> Result<Option<IdempotentRequest>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, patient_id, requested_fingerprint
           FROM medication_evidence_review_requests
           WHERE requested_by = $1 AND idempotency_key = $2"#,
    )
    .bind(actor_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.map(idempotent_from_row))
}

fn idempotent_from_row(row: sqlx::postgres::PgRow) -> IdempotentRequest {
    IdempotentRequest {
        id: row.get("id"),
        patient_id: row.get("patient_id"),
        fingerprint: row.get("requested_fingerprint"),
    }
}

async fn replay_or_conflict(
    pool: &PgPool,
    existing: IdempotentRequest,
    patient_id: Uuid,
    expected_fingerprint: &str,
) -> Result<CreateReviewResult, MedicationEvidenceReviewError> {
    if existing.patient_id != patient_id || existing.fingerprint != expected_fingerprint {
        return Err(MedicationEvidenceReviewError::IdempotencyConflict);
    }
    Ok(CreateReviewResult {
        response: load_review(pool, patient_id, existing.id).await?,
        created: false,
    })
}

fn deserialize_column<T: for<'de> Deserialize<'de>>(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<T, MedicationEvidenceReviewError> {
    Ok(serde_json::from_value(row.get::<Value, _>(column))?)
}

fn sorted_unique(mut values: Vec<String>) -> Vec<String> {
    values.sort();
    values.dedup();
    values
}

fn sha256_json(value: &Value) -> Result<String, serde_json::Error> {
    let bytes = serde_json::to_vec(value)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_and_clinical_capabilities_are_explicitly_disabled() {
        assert_eq!(provider().kind, "none");
        assert_eq!(provider().status, "not_configured");
        assert!(!provider().external_calls_enabled);
        assert_eq!(clinical_review().status, "not_configured");
        assert!(!clinical_review().can_approve);
    }

    #[test]
    fn invalid_create_input_is_rejected() {
        assert!(validate_create_input(&"a".repeat(64), "review-1").is_ok());
        assert!(validate_create_input(&"A".repeat(64), "review-1").is_err());
        assert!(validate_create_input(&"a".repeat(63), "review-1").is_err());
        assert!(validate_create_input(&"a".repeat(64), " ").is_err());
        assert!(validate_create_input(&"a".repeat(64), " review-1").is_err());
    }

    #[test]
    fn draft_rejects_citations_outside_bundle() {
        let snapshot = EvidenceSnapshot {
            summary: EvidenceSummary {
                active_medications: 0,
                identified_medications: 0,
                unresolved_medications: 0,
                findings_total: 0,
                high_priority_findings: 0,
                missing_data_total: 0,
            },
            medication_ids: Vec::new(),
            findings: Vec::new(),
            missing_data: Vec::new(),
            sources: Vec::new(),
            citations: Vec::new(),
        };
        let draft = LocalDraft {
            evidence_summary: vec![DraftItem {
                text_ru: "x".to_string(),
                text_de: "x".to_string(),
                citation_refs: vec!["outside".to_string()],
            }],
            verification_questions: Vec::new(),
            limitations: Vec::new(),
            citation_refs: vec!["outside".to_string()],
        };
        assert!(matches!(
            validate_local_draft(&snapshot, &draft),
            Err(MedicationEvidenceReviewError::InvalidCitation)
        ));
    }

    #[test]
    fn snapshot_projection_never_exposes_worker_fetch_url() {
        let snapshot = SuccessfulSnapshotStatus {
            id: Uuid::new_v4(),
            fetched_at: Utc::now().to_rfc3339(),
            published_at: None,
            version: None,
            checksum_sha256: "a".repeat(64),
            item_count: None,
            source_url: "https://worker.example/fetch?token=do-not-expose".to_string(),
        };
        let projected = snapshot_projection(&snapshot, "https://official.example/reference");
        assert_eq!(projected.source_url, "https://official.example/reference");
        assert!(!projected.source_url.contains("do-not-expose"));
    }
}
