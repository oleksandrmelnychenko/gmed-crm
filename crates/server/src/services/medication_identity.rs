use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use gmed_db::DbPool;
use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;
use uuid::Uuid;

pub const IDENTITY_RULESET_VERSION: &str = "internal-curated-v1";
const INTERNAL_SOURCE_ID: &str = "internal-drug-catalog";
const INTERNAL_SOURCE_LABEL: &str = "GMED Drug Reference";
const MAX_CANDIDATES: i64 = 50;

#[derive(Debug, Error)]
pub enum MedicationIdentityError {
    #[error("patient medication not found")]
    MedicationNotFound,
    #[error("candidate set not found")]
    CandidateSetNotFound,
    #[error("candidate not found")]
    CandidateNotFound,
    #[error("candidate cannot be confirmed from its evidence")]
    CandidateNotConfirmable,
    #[error("medication identity review is stale")]
    StaleMedication,
    #[error("candidate catalogue evidence is stale")]
    StaleCandidate,
    #[error("source snapshot does not belong to this candidate")]
    SourceSnapshotMismatch,
    #[error("staff acknowledgement is required")]
    StaffAcknowledgementRequired,
    #[error("idempotency key was already used for another confirmation")]
    IdempotencyConflict,
    #[error("confirmation input is invalid")]
    InvalidInput,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentityPermissions {
    pub can_search_candidates: bool,
    pub can_confirm_identity: bool,
    pub reason_code: Option<String>,
}

impl MedicationIdentityPermissions {
    pub fn ceo() -> Self {
        Self {
            can_search_candidates: true,
            can_confirm_identity: true,
            reason_code: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentitySubject {
    pub id: Uuid,
    pub name: String,
    pub substance: Option<String>,
    pub strength: Option<String>,
    pub form: Option<String>,
    pub pzn: Option<String>,
    pub atc_code: Option<String>,
    pub version: String,
    pub identity_status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentityCandidateSetMeta {
    pub id: Uuid,
    pub generated_at: String,
    pub expires_at: Option<String>,
    pub query_basis: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentityCandidateProduct {
    pub id: Uuid,
    pub brand_name: String,
    pub substances: Vec<String>,
    pub strength: Option<String>,
    pub form: Option<String>,
    pub pzn: Option<String>,
    pub atc_code: Option<String>,
    pub country_code: Option<String>,
    pub manufacturer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentityCandidateProvenance {
    pub source_state: &'static str,
    pub source_id: &'static str,
    pub source_label: &'static str,
    pub authority: Option<String>,
    pub official_url: Option<String>,
    pub snapshot_id: Option<Uuid>,
    pub snapshot_version: Option<String>,
    pub snapshot_fetched_at: Option<String>,
    pub snapshot_published_at: Option<String>,
}

impl MedicationIdentityCandidateProvenance {
    fn internal_curated() -> Self {
        Self {
            source_state: "internal_curated",
            source_id: INTERNAL_SOURCE_ID,
            source_label: INTERNAL_SOURCE_LABEL,
            authority: None,
            official_url: None,
            snapshot_id: None,
            snapshot_version: None,
            snapshot_fetched_at: None,
            snapshot_published_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentityCandidateView {
    pub id: Uuid,
    pub product: MedicationIdentityCandidateProduct,
    pub match_basis: Vec<String>,
    pub confirmable: bool,
    pub blocking_reasons: Vec<String>,
    pub provenance: MedicationIdentityCandidateProvenance,
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentityCandidateSetResponse {
    pub medication: MedicationIdentitySubject,
    pub candidate_set: MedicationIdentityCandidateSetMeta,
    pub candidates: Vec<MedicationIdentityCandidateView>,
    pub permissions: MedicationIdentityPermissions,
}

#[derive(Debug, Clone)]
pub struct ConfirmMedicationIdentityInput {
    pub candidate_set_id: Uuid,
    pub candidate_id: Uuid,
    pub medication_version: String,
    pub source_snapshot_id: Option<Uuid>,
    pub staff_acknowledged: bool,
    pub note: Option<String>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MedicationIdentityAudit {
    pub confirmed_by: String,
    pub confirmed_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfirmMedicationIdentityResult {
    pub medication_id: Uuid,
    pub identity_status: &'static str,
    pub medication_version: String,
    pub refresh_token: Uuid,
    pub audit: MedicationIdentityAudit,
}

#[derive(Debug, Clone)]
struct MedicationRecord {
    id: Uuid,
    patient_id: Uuid,
    medication_series_id: Uuid,
    wirkstoff: String,
    handelsname: String,
    staerke: Option<String>,
    form: Option<String>,
    status: String,
    on_hold: bool,
    source_country: Option<String>,
    source_identifiers: Value,
    regimen_fingerprint: Option<String>,
    created_at: DateTime<Utc>,
    superseded_at: Option<DateTime<Utc>>,
    verified_match_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
struct ProductRecord {
    id: Uuid,
    brand_name: String,
    normalized_brand_name: String,
    country_code: String,
    atc_code: Option<String>,
    form: Option<String>,
    strength: Option<String>,
    manufacturer: Option<String>,
    verification_status: String,
    source_kind: String,
    is_active: bool,
    updated_at: DateTime<Utc>,
    substances: Vec<String>,
}

#[derive(Debug, Clone)]
struct EvaluatedCandidate {
    product: ProductRecord,
    match_basis: Vec<String>,
    confirmable: bool,
    blocking_reasons: Vec<String>,
    evidence: Value,
}

#[derive(Debug)]
struct StoredCandidateSet {
    id: Uuid,
    medication_version: String,
    generated_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
    medication_snapshot: Value,
    query_basis: Vec<String>,
}

#[derive(Debug)]
struct StoredDecision {
    patient_id: Uuid,
    patient_medication_id: Uuid,
    candidate_id: Uuid,
    medication_version: String,
    refresh_token: Uuid,
    decided_by: Option<Uuid>,
    decided_at: DateTime<Utc>,
}

pub async fn generate_candidate_set(
    pool: &DbPool,
    patient_id: Uuid,
    medication_id: Uuid,
    actor_id: Uuid,
) -> Result<MedicationIdentityCandidateSetResponse, MedicationIdentityError> {
    let mut tx = pool.begin().await?;
    let medication = load_medication(&mut tx, patient_id, medication_id, false).await?;
    if medication.superseded_at.is_some() {
        return Err(MedicationIdentityError::StaleMedication);
    }

    let medication_snapshot = medication_snapshot(&medication);
    let medication_version = medication_version(&medication);
    let query_basis = query_basis(&medication);
    let products = load_candidate_products(&mut tx, &medication).await?;
    let evaluated = products
        .into_iter()
        .map(|product| evaluate_candidate(&medication, product))
        .collect::<Vec<_>>();
    let catalog_version = candidate_catalog_version(&evaluated);

    let inserted = sqlx::query(
        r#"INSERT INTO medication_identity_candidate_sets (
                patient_id, patient_medication_id, medication_version,
                catalog_version, ruleset_version, medication_snapshot,
                query_basis, provenance_source_state, generated_by, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'internal_curated', $8, NULL)
           ON CONFLICT (
               patient_medication_id, medication_version, catalog_version, ruleset_version
           ) DO NOTHING
           RETURNING id, generated_at, expires_at"#,
    )
    .bind(patient_id)
    .bind(medication_id)
    .bind(&medication_version)
    .bind(&catalog_version)
    .bind(IDENTITY_RULESET_VERSION)
    .bind(&medication_snapshot)
    .bind(json!(query_basis))
    .bind(actor_id)
    .fetch_optional(&mut *tx)
    .await?;

    let candidate_set = if let Some(row) = inserted {
        let candidate_set_id = row.try_get::<Uuid, _>("id")?;
        for (index, candidate) in evaluated.iter().enumerate() {
            let product_snapshot = product_snapshot(&candidate.product);
            let provenance =
                serde_json::to_value(MedicationIdentityCandidateProvenance::internal_curated())
                    .expect("internal provenance serializes");
            sqlx::query(
                r#"INSERT INTO medication_identity_candidates (
                        candidate_set_id, drug_product_id, rank, product_snapshot,
                        match_basis, confirmable, blocking_reasons, evidence, provenance
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
            )
            .bind(candidate_set_id)
            .bind(candidate.product.id)
            .bind((index + 1) as i32)
            .bind(product_snapshot)
            .bind(&candidate.match_basis)
            .bind(candidate.confirmable)
            .bind(&candidate.blocking_reasons)
            .bind(&candidate.evidence)
            .bind(provenance)
            .execute(&mut *tx)
            .await?;
        }
        StoredCandidateSet {
            id: candidate_set_id,
            medication_version: medication_version.clone(),
            generated_at: row.try_get("generated_at")?,
            expires_at: row.try_get("expires_at")?,
            medication_snapshot: medication_snapshot.clone(),
            query_basis: query_basis.clone(),
        }
    } else {
        load_candidate_set_by_version(
            &mut tx,
            medication_id,
            &medication_version,
            &catalog_version,
        )
        .await?
        .ok_or(MedicationIdentityError::CandidateSetNotFound)?
    };

    let response = load_candidate_set_response(&mut tx, candidate_set, &medication).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn load_latest_candidate_set(
    pool: &DbPool,
    patient_id: Uuid,
    medication_id: Uuid,
) -> Result<Option<MedicationIdentityCandidateSetResponse>, MedicationIdentityError> {
    let mut tx = pool.begin().await?;
    let medication = load_medication(&mut tx, patient_id, medication_id, false).await?;
    let candidate_set =
        load_latest_stored_candidate_set(&mut tx, patient_id, medication_id).await?;
    let response = match candidate_set {
        Some(candidate_set) => {
            Some(load_candidate_set_response(&mut tx, candidate_set, &medication).await?)
        }
        None => None,
    };
    tx.commit().await?;
    Ok(response)
}

pub async fn confirm_identity(
    pool: &DbPool,
    patient_id: Uuid,
    medication_id: Uuid,
    actor_id: Uuid,
    input: ConfirmMedicationIdentityInput,
) -> Result<ConfirmMedicationIdentityResult, MedicationIdentityError> {
    if !input.staff_acknowledged {
        return Err(MedicationIdentityError::StaffAcknowledgementRequired);
    }
    // Phase 4 has no official snapshot connector. Never trust a client-supplied
    // snapshot id for an internal_curated candidate.
    if input.source_snapshot_id.is_some() {
        return Err(MedicationIdentityError::SourceSnapshotMismatch);
    }

    if input.medication_version.len() != 64
        || !input
            .medication_version
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || input
            .note
            .as_ref()
            .is_some_and(|value| value.chars().count() > 2000)
        || input
            .idempotency_key
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 128)
    {
        return Err(MedicationIdentityError::InvalidInput);
    }
    let normalized_note = normalize_optional(input.note.clone());
    let normalized_idempotency = normalize_optional(input.idempotency_key.clone());

    let mut tx = pool.begin().await?;

    if let Some(idempotency_key) = normalized_idempotency.as_deref()
        && let Some(existing) =
            load_decision_by_idempotency(&mut tx, actor_id, idempotency_key).await?
    {
        if existing.patient_id != patient_id
            || existing.patient_medication_id != medication_id
            || existing.candidate_id != input.candidate_id
            || existing.medication_version != input.medication_version
        {
            return Err(MedicationIdentityError::IdempotencyConflict);
        }
        tx.commit().await?;
        return Ok(decision_result(existing));
    }

    let medication = load_medication(&mut tx, patient_id, medication_id, true).await?;
    if medication.superseded_at.is_some() {
        return Err(MedicationIdentityError::StaleMedication);
    }
    let current_version = medication_version(&medication);
    if current_version != input.medication_version {
        return Err(MedicationIdentityError::StaleMedication);
    }

    let candidate_row = sqlx::query(
        r#"SELECT c.confirmable, c.product_snapshot, c.drug_product_id,
                  s.medication_version, s.provenance_source_state
           FROM medication_identity_candidates c
           JOIN medication_identity_candidate_sets s ON s.id = c.candidate_set_id
           WHERE c.id = $1
             AND c.candidate_set_id = $2
             AND s.patient_id = $3
             AND s.patient_medication_id = $4"#,
    )
    .bind(input.candidate_id)
    .bind(input.candidate_set_id)
    .bind(patient_id)
    .bind(medication_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(MedicationIdentityError::CandidateNotFound)?;

    let set_version = candidate_row.try_get::<String, _>("medication_version")?;
    if set_version != input.medication_version || set_version != current_version {
        return Err(MedicationIdentityError::StaleMedication);
    }
    if candidate_row.try_get::<String, _>("provenance_source_state")? != "internal_curated" {
        return Err(MedicationIdentityError::SourceSnapshotMismatch);
    }
    if !candidate_row.try_get::<bool, _>("confirmable")? {
        return Err(MedicationIdentityError::CandidateNotConfirmable);
    }

    if let Some(existing) = load_confirmed_decision(&mut tx, input.candidate_id).await? {
        tx.commit().await?;
        return Ok(decision_result(existing));
    }

    let stored_product_snapshot = candidate_row.try_get::<Value, _>("product_snapshot")?;
    let drug_product_id = candidate_row.try_get::<Uuid, _>("drug_product_id")?;
    // Catalog confirmations are rare and safety-sensitive. Share-lock the
    // complete local catalog relation set so neither a product edit nor a
    // substance-link/name mutation can race the snapshot comparison and
    // projection write below.
    sqlx::query("LOCK TABLE drug_products, drug_product_substances, drug_substances IN SHARE MODE")
        .execute(&mut *tx)
        .await?;
    let current_product = load_product_by_id(&mut tx, drug_product_id)
        .await?
        .ok_or(MedicationIdentityError::StaleCandidate)?;
    let current_product_snapshot = product_snapshot(&current_product);
    if !current_product.is_active
        || current_product.source_kind != "manual_curated"
        || !matches!(
            current_product.verification_status.as_str(),
            "curated" | "verified"
        )
        || fingerprint_json(&current_product_snapshot) != fingerprint_json(&stored_product_snapshot)
    {
        return Err(MedicationIdentityError::StaleCandidate);
    }
    let inserted = sqlx::query(
        r#"INSERT INTO medication_identity_decisions (
                patient_id, patient_medication_id, candidate_set_id, candidate_id,
                decision, medication_version, source_snapshot_id, product_snapshot,
                staff_acknowledged, note, idempotency_key, decided_by
           ) VALUES ($1, $2, $3, $4, 'confirmed', $5, NULL, $6, true, $7, $8, $9)
           ON CONFLICT DO NOTHING
           RETURNING patient_id, patient_medication_id, candidate_id,
                     medication_version, refresh_token, decided_by, decided_at"#,
    )
    .bind(patient_id)
    .bind(medication_id)
    .bind(input.candidate_set_id)
    .bind(input.candidate_id)
    .bind(&current_version)
    .bind(&current_product_snapshot)
    .bind(&normalized_note)
    .bind(&normalized_idempotency)
    .bind(actor_id)
    .fetch_optional(&mut *tx)
    .await?;

    let decision = if let Some(row) = inserted {
        stored_decision_from_row(&row)?
    } else if let Some(existing) = load_confirmed_decision(&mut tx, input.candidate_id).await? {
        existing
    } else if let Some(idempotency_key) = normalized_idempotency.as_deref()
        && let Some(existing) =
            load_decision_by_idempotency(&mut tx, actor_id, idempotency_key).await?
    {
        if existing.patient_id != patient_id
            || existing.patient_medication_id != medication_id
            || existing.candidate_id != input.candidate_id
            || existing.medication_version != current_version
        {
            return Err(MedicationIdentityError::IdempotencyConflict);
        }
        existing
    } else {
        return Err(MedicationIdentityError::IdempotencyConflict);
    };

    // medication_drug_matches is a mutable current projection. The immutable
    // candidate set and decision above retain the historical evidence.
    sqlx::query(
        r#"UPDATE medication_drug_matches
           SET verification_status = 'rejected', updated_at = now()
           WHERE patient_medication_id = $1
             AND drug_product_id <> $2
             AND verification_status = 'verified'"#,
    )
    .bind(medication_id)
    .bind(drug_product_id)
    .execute(&mut *tx)
    .await?;

    // Existing confidence is a legacy required projection field. It is not
    // model confidence and is intentionally absent from the new API.
    sqlx::query(
        r#"INSERT INTO medication_drug_matches (
                patient_medication_id, drug_product_id, match_kind, confidence,
                verification_status, note, created_by, verified_by, verified_at
           ) VALUES ($1, $2, 'staff_verified', $3, 'verified', $4, $5, $5, now())
           ON CONFLICT (patient_medication_id, drug_product_id)
               WHERE patient_medication_id IS NOT NULL
           DO UPDATE SET match_kind = 'staff_verified',
                         verification_status = 'verified',
                         note = COALESCE(EXCLUDED.note, medication_drug_matches.note),
                         verified_by = EXCLUDED.verified_by,
                         verified_at = EXCLUDED.verified_at,
                         updated_at = now()"#,
    )
    .bind(medication_id)
    .bind(drug_product_id)
    .bind(Decimal::ONE)
    .bind(normalized_note)
    .bind(actor_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(decision_result(decision))
}

async fn load_medication(
    tx: &mut Transaction<'_, Postgres>,
    patient_id: Uuid,
    medication_id: Uuid,
    for_update: bool,
) -> Result<MedicationRecord, MedicationIdentityError> {
    let lock = if for_update { " FOR UPDATE OF pm" } else { "" };
    let sql = format!(
        r#"SELECT pm.id, pm.patient_id, pm.medication_series_id, pm.wirkstoff,
                  pm.handelsname, pm.staerke, pm.form, pm.status, pm.on_hold,
                  pm.source_country, pm.source_identifiers, pm.regimen_fingerprint,
                  pm.created_at, pm.superseded_at,
                  verified.match_id AS verified_match_id
           FROM patient_medications pm
           LEFT JOIN LATERAL (
               SELECT mdm.id AS match_id
               FROM medication_drug_matches mdm
               JOIN drug_products dp ON dp.id = mdm.drug_product_id
               WHERE mdm.patient_medication_id = pm.id
                 AND mdm.verification_status = 'verified'
                 AND dp.is_active = true
               ORDER BY mdm.verified_at DESC NULLS LAST, mdm.created_at DESC, mdm.id
               LIMIT 1
           ) verified ON TRUE
           WHERE pm.id = $1 AND pm.patient_id = $2{lock}"#,
    );
    let row = sqlx::query(&sql)
        .bind(medication_id)
        .bind(patient_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(MedicationIdentityError::MedicationNotFound)?;
    Ok(MedicationRecord {
        id: row.try_get("id")?,
        patient_id: row.try_get("patient_id")?,
        medication_series_id: row.try_get("medication_series_id")?,
        wirkstoff: row.try_get("wirkstoff")?,
        handelsname: row.try_get("handelsname")?,
        staerke: row.try_get("staerke")?,
        form: row.try_get("form")?,
        status: row.try_get("status")?,
        on_hold: row.try_get("on_hold")?,
        source_country: row.try_get("source_country")?,
        source_identifiers: row.try_get("source_identifiers")?,
        regimen_fingerprint: row.try_get("regimen_fingerprint")?,
        created_at: row.try_get("created_at")?,
        superseded_at: row.try_get("superseded_at")?,
        verified_match_id: row.try_get("verified_match_id")?,
    })
}

async fn load_candidate_products(
    tx: &mut Transaction<'_, Postgres>,
    medication: &MedicationRecord,
) -> Result<Vec<ProductRecord>, sqlx::Error> {
    let normalized_brand = normalize_key(&medication.handelsname);
    let normalized_substance = usable_substance(&medication.wirkstoff).map(normalize_key);
    let atc = source_identifier(&medication.source_identifiers, &["atc_code", "atc"])
        .and_then(normalize_atc);
    let country = medication
        .source_country
        .as_deref()
        .and_then(normalize_country_code)
        .unwrap_or_else(|| "DE".to_string());

    let rows = sqlx::query(
        r#"SELECT dp.id, dp.brand_name, dp.normalized_brand_name, dp.country_code,
                  dp.atc_code, dp.form, dp.strength, dp.manufacturer,
                  dp.verification_status, dp.source_kind, dp.is_active, dp.updated_at,
                  COALESCE(
                      array_agg(ds.name ORDER BY ds.normalized_name)
                          FILTER (WHERE ds.id IS NOT NULL),
                      ARRAY[]::TEXT[]
                  ) AS substances
           FROM drug_products dp
           LEFT JOIN drug_product_substances dps ON dps.product_id = dp.id
           LEFT JOIN drug_substances ds ON ds.id = dps.substance_id
           WHERE dp.is_active = true
             AND dp.verification_status IN ('curated', 'verified')
             AND dp.source_kind = 'manual_curated'
             AND dp.country_code = $4
             AND (
                 (NULLIF($1, '') IS NOT NULL AND dp.normalized_brand_name = $1)
                 OR (
                     $2::TEXT IS NOT NULL
                     AND EXISTS (
                         SELECT 1
                         FROM drug_product_substances exact_dps
                         JOIN drug_substances exact_ds ON exact_ds.id = exact_dps.substance_id
                         WHERE exact_dps.product_id = dp.id
                           AND exact_ds.normalized_name = $2
                     )
                 )
                 OR (
                     $3::TEXT IS NOT NULL
                     AND upper(btrim(COALESCE(dp.atc_code, ''))) = $3
                 )
             )
           GROUP BY dp.id
           ORDER BY
             CASE WHEN dp.normalized_brand_name = $1 THEN 0 ELSE 1 END,
             dp.normalized_brand_name,
             dp.id
           LIMIT $5"#,
    )
    .bind(normalized_brand)
    .bind(normalized_substance)
    .bind(atc)
    .bind(country)
    .bind(MAX_CANDIDATES)
    .fetch_all(&mut **tx)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(ProductRecord {
                id: row.try_get("id")?,
                brand_name: row.try_get("brand_name")?,
                normalized_brand_name: row.try_get("normalized_brand_name")?,
                country_code: row.try_get("country_code")?,
                atc_code: row.try_get("atc_code")?,
                form: row.try_get("form")?,
                strength: row.try_get("strength")?,
                manufacturer: row.try_get("manufacturer")?,
                verification_status: row.try_get("verification_status")?,
                source_kind: row.try_get("source_kind")?,
                is_active: row.try_get("is_active")?,
                updated_at: row.try_get("updated_at")?,
                substances: row.try_get("substances")?,
            })
        })
        .collect()
}

async fn load_product_by_id(
    tx: &mut Transaction<'_, Postgres>,
    product_id: Uuid,
) -> Result<Option<ProductRecord>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT dp.id, dp.brand_name, dp.normalized_brand_name, dp.country_code,
                  dp.atc_code, dp.form, dp.strength, dp.manufacturer,
                  dp.verification_status, dp.source_kind, dp.is_active, dp.updated_at,
                  COALESCE(
                      array_agg(ds.name ORDER BY ds.normalized_name)
                          FILTER (WHERE ds.id IS NOT NULL),
                      ARRAY[]::TEXT[]
                  ) AS substances
           FROM drug_products dp
           LEFT JOIN drug_product_substances dps ON dps.product_id = dp.id
           LEFT JOIN drug_substances ds ON ds.id = dps.substance_id
           WHERE dp.id = $1
           GROUP BY dp.id"#,
    )
    .bind(product_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok(ProductRecord {
            id: row.try_get("id")?,
            brand_name: row.try_get("brand_name")?,
            normalized_brand_name: row.try_get("normalized_brand_name")?,
            country_code: row.try_get("country_code")?,
            atc_code: row.try_get("atc_code")?,
            form: row.try_get("form")?,
            strength: row.try_get("strength")?,
            manufacturer: row.try_get("manufacturer")?,
            verification_status: row.try_get("verification_status")?,
            source_kind: row.try_get("source_kind")?,
            is_active: row.try_get("is_active")?,
            updated_at: row.try_get("updated_at")?,
            substances: row.try_get("substances")?,
        })
    })
    .transpose()
}

fn evaluate_candidate(medication: &MedicationRecord, product: ProductRecord) -> EvaluatedCandidate {
    let medication_brand = normalize_key(&medication.handelsname);
    let product_brand = normalize_key(&product.normalized_brand_name);
    let exact_brand = !medication_brand.is_empty() && medication_brand == product_brand;
    let medication_substance = usable_substance(&medication.wirkstoff).map(normalize_key);
    let exact_substance = medication_substance.as_ref().is_some_and(|expected| {
        product
            .substances
            .iter()
            .map(|value| normalize_key(value))
            .any(|value| value == *expected)
    });
    let exact_strength = exact_optional(&medication.staerke, &product.strength);
    let exact_form = exact_optional(&medication.form, &product.form);
    let strength_contradiction = contradicts(&medication.staerke, &product.strength);
    let form_contradiction = contradicts(&medication.form, &product.form);
    let medication_atc = source_identifier(&medication.source_identifiers, &["atc_code", "atc"])
        .and_then(normalize_atc);
    let product_atc = product.atc_code.clone().and_then(normalize_atc);
    let exact_atc = medication_atc.is_some() && medication_atc == product_atc;

    let mut match_basis = Vec::new();
    if exact_substance {
        match_basis.push("exact_substance".to_string());
    }
    if exact_strength {
        match_basis.push("exact_strength".to_string());
    }
    if exact_form {
        match_basis.push("exact_form".to_string());
    }

    let sufficient_identity_evidence = if medication_substance.is_some() {
        exact_substance
    } else {
        exact_strength && exact_form
    };
    let source_is_internal_curated = product.source_kind == "manual_curated";
    let confirmable = exact_brand
        && sufficient_identity_evidence
        && !strength_contradiction
        && !form_contradiction
        && source_is_internal_curated;
    let mut blocking_reasons = Vec::new();
    if !exact_brand {
        blocking_reasons.push("exact_brand_required".to_string());
    }
    if medication_substance.is_some() && !exact_substance {
        blocking_reasons.push("substance_mismatch".to_string());
    }
    if strength_contradiction {
        blocking_reasons.push("strength_contradiction".to_string());
    }
    if form_contradiction {
        blocking_reasons.push("form_contradiction".to_string());
    }
    if exact_substance && !exact_brand {
        blocking_reasons.push("substance_only_not_identity".to_string());
    }
    if exact_atc && !exact_brand && !exact_substance {
        blocking_reasons.push("atc_only_not_identity".to_string());
    }
    if !sufficient_identity_evidence {
        blocking_reasons.push("insufficient_identity_evidence".to_string());
    }
    if !source_is_internal_curated {
        blocking_reasons.push("source_not_internal_curated".to_string());
    }

    let evidence = json!({
        "exact_brand": exact_brand,
        "exact_substance": exact_substance,
        "exact_strength": exact_strength,
        "exact_form": exact_form,
        "exact_atc": exact_atc,
        "strength_contradiction": strength_contradiction,
        "form_contradiction": form_contradiction,
        "ruleset_version": IDENTITY_RULESET_VERSION,
    });

    EvaluatedCandidate {
        product,
        match_basis,
        confirmable,
        blocking_reasons,
        evidence,
    }
}

async fn load_candidate_set_by_version(
    tx: &mut Transaction<'_, Postgres>,
    medication_id: Uuid,
    medication_version: &str,
    catalog_version: &str,
) -> Result<Option<StoredCandidateSet>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, medication_version, generated_at, expires_at,
                  medication_snapshot, query_basis
           FROM medication_identity_candidate_sets
           WHERE patient_medication_id = $1
             AND medication_version = $2
             AND catalog_version = $3
             AND ruleset_version = $4"#,
    )
    .bind(medication_id)
    .bind(medication_version)
    .bind(catalog_version)
    .bind(IDENTITY_RULESET_VERSION)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| stored_candidate_set_from_row(&row))
        .transpose()
}

async fn load_latest_stored_candidate_set(
    tx: &mut Transaction<'_, Postgres>,
    patient_id: Uuid,
    medication_id: Uuid,
) -> Result<Option<StoredCandidateSet>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, medication_version, generated_at, expires_at,
                  medication_snapshot, query_basis
           FROM medication_identity_candidate_sets
           WHERE patient_id = $1 AND patient_medication_id = $2
           ORDER BY generated_at DESC, id DESC
           LIMIT 1"#,
    )
    .bind(patient_id)
    .bind(medication_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| stored_candidate_set_from_row(&row))
        .transpose()
}

fn stored_candidate_set_from_row(
    row: &sqlx::postgres::PgRow,
) -> Result<StoredCandidateSet, sqlx::Error> {
    let query_basis_value = row.try_get::<Value, _>("query_basis")?;
    Ok(StoredCandidateSet {
        id: row.try_get("id")?,
        medication_version: row.try_get("medication_version")?,
        generated_at: row.try_get("generated_at")?,
        expires_at: row.try_get("expires_at")?,
        medication_snapshot: row.try_get("medication_snapshot")?,
        query_basis: query_basis_value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
    })
}

async fn load_candidate_set_response(
    tx: &mut Transaction<'_, Postgres>,
    candidate_set: StoredCandidateSet,
    current_medication: &MedicationRecord,
) -> Result<MedicationIdentityCandidateSetResponse, MedicationIdentityError> {
    let rows = sqlx::query(
        r#"SELECT id, product_snapshot, match_basis, confirmable,
                  blocking_reasons, provenance
           FROM medication_identity_candidates
           WHERE candidate_set_id = $1
           ORDER BY rank, id"#,
    )
    .bind(candidate_set.id)
    .fetch_all(&mut **tx)
    .await?;

    let mut candidates = Vec::with_capacity(rows.len());
    for row in rows {
        let product_snapshot = row.try_get::<Value, _>("product_snapshot")?;
        let provenance = row.try_get::<Value, _>("provenance")?;
        candidates.push(MedicationIdentityCandidateView {
            id: row.try_get("id")?,
            product: product_from_snapshot(&product_snapshot)?,
            match_basis: row.try_get("match_basis")?,
            confirmable: row.try_get("confirmable")?,
            blocking_reasons: row.try_get("blocking_reasons")?,
            provenance: provenance_from_snapshot(&provenance),
        });
    }

    let version_is_current =
        medication_version(current_medication) == candidate_set.medication_version;
    if !version_is_current {
        for candidate in &mut candidates {
            candidate.confirmable = false;
            if !candidate
                .blocking_reasons
                .iter()
                .any(|value| value == "medication_version_stale")
            {
                candidate
                    .blocking_reasons
                    .push("medication_version_stale".to_string());
            }
        }
    }

    let response_medication_snapshot = if version_is_current {
        medication_snapshot(current_medication)
    } else {
        candidate_set.medication_snapshot.clone()
    };

    Ok(MedicationIdentityCandidateSetResponse {
        medication: medication_subject_from_snapshot(
            &response_medication_snapshot,
            &candidate_set.medication_version,
        ),
        candidate_set: MedicationIdentityCandidateSetMeta {
            id: candidate_set.id,
            generated_at: candidate_set.generated_at.to_rfc3339(),
            expires_at: candidate_set.expires_at.map(|value| value.to_rfc3339()),
            query_basis: candidate_set.query_basis,
        },
        candidates,
        permissions: MedicationIdentityPermissions::ceo(),
    })
}

fn medication_subject_from_snapshot(snapshot: &Value, version: &str) -> MedicationIdentitySubject {
    MedicationIdentitySubject {
        id: snapshot
            .get("id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or_default(),
        name: snapshot
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("—")
            .to_string(),
        substance: json_optional_string(snapshot, "substance"),
        strength: json_optional_string(snapshot, "strength"),
        form: json_optional_string(snapshot, "form"),
        pzn: json_optional_string(snapshot, "pzn"),
        atc_code: json_optional_string(snapshot, "atc_code"),
        version: version.to_string(),
        identity_status: snapshot
            .get("identity_status")
            .and_then(Value::as_str)
            .unwrap_or("unresolved")
            .to_string(),
    }
}

fn product_from_snapshot(
    snapshot: &Value,
) -> Result<MedicationIdentityCandidateProduct, MedicationIdentityError> {
    let id = snapshot
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or(MedicationIdentityError::CandidateNotFound)?;
    Ok(MedicationIdentityCandidateProduct {
        id,
        brand_name: snapshot
            .get("brand_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        substances: snapshot
            .get("substances")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        strength: json_optional_string(snapshot, "strength"),
        form: json_optional_string(snapshot, "form"),
        pzn: json_optional_string(snapshot, "pzn"),
        atc_code: json_optional_string(snapshot, "atc_code"),
        country_code: json_optional_string(snapshot, "country_code"),
        manufacturer: json_optional_string(snapshot, "manufacturer"),
    })
}

fn provenance_from_snapshot(snapshot: &Value) -> MedicationIdentityCandidateProvenance {
    MedicationIdentityCandidateProvenance {
        source_state: "internal_curated",
        source_id: INTERNAL_SOURCE_ID,
        source_label: INTERNAL_SOURCE_LABEL,
        authority: json_optional_string(snapshot, "authority"),
        official_url: None,
        snapshot_id: None,
        snapshot_version: None,
        snapshot_fetched_at: None,
        snapshot_published_at: None,
    }
}

async fn load_confirmed_decision(
    tx: &mut Transaction<'_, Postgres>,
    candidate_id: Uuid,
) -> Result<Option<StoredDecision>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT patient_id, patient_medication_id, candidate_id,
                  medication_version, refresh_token, decided_by, decided_at
           FROM medication_identity_decisions
           WHERE candidate_id = $1 AND decision = 'confirmed'"#,
    )
    .bind(candidate_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| stored_decision_from_row(&row)).transpose()
}

async fn load_decision_by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    idempotency_key: &str,
) -> Result<Option<StoredDecision>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT patient_id, patient_medication_id, candidate_id,
                  medication_version, refresh_token, decided_by, decided_at
           FROM medication_identity_decisions
           WHERE decided_by = $1
             AND idempotency_key = $2
             AND decision = 'confirmed'"#,
    )
    .bind(actor_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| stored_decision_from_row(&row)).transpose()
}

fn stored_decision_from_row(row: &sqlx::postgres::PgRow) -> Result<StoredDecision, sqlx::Error> {
    Ok(StoredDecision {
        patient_id: row.try_get("patient_id")?,
        patient_medication_id: row.try_get("patient_medication_id")?,
        candidate_id: row.try_get("candidate_id")?,
        medication_version: row.try_get("medication_version")?,
        refresh_token: row.try_get("refresh_token")?,
        decided_by: row.try_get("decided_by")?,
        decided_at: row.try_get("decided_at")?,
    })
}

fn decision_result(decision: StoredDecision) -> ConfirmMedicationIdentityResult {
    ConfirmMedicationIdentityResult {
        medication_id: decision.patient_medication_id,
        identity_status: "verified",
        medication_version: decision.medication_version,
        refresh_token: decision.refresh_token,
        audit: MedicationIdentityAudit {
            confirmed_by: decision
                .decided_by
                .map(|value| value.to_string())
                .unwrap_or_else(|| "system".to_string()),
            confirmed_at: decision.decided_at.to_rfc3339(),
        },
    }
}

fn medication_snapshot(medication: &MedicationRecord) -> Value {
    let pzn = source_identifier(&medication.source_identifiers, &["pzn"]).and_then(normalize_pzn);
    let atc = source_identifier(&medication.source_identifiers, &["atc_code", "atc"])
        .and_then(normalize_atc);
    let substance = usable_substance(&medication.wirkstoff).map(str::to_string);
    let identity_status = if medication.verified_match_id.is_some() {
        "verified"
    } else if pzn.is_some() || atc.is_some() {
        "candidate"
    } else {
        "unresolved"
    };
    json!({
        "id": medication.id,
        "patient_id": medication.patient_id,
        "medication_series_id": medication.medication_series_id,
        "name": clean_string(&medication.handelsname)
            .filter(|value| !value.is_empty())
            .or_else(|| substance.clone())
            .unwrap_or_else(|| "—".to_string()),
        "substance": substance,
        "strength": clean_optional_ref(medication.staerke.as_deref()),
        "form": clean_optional_ref(medication.form.as_deref()),
        "pzn": pzn,
        "atc_code": atc,
        "status": medication.status,
        "on_hold": medication.on_hold,
        "source_country": medication.source_country,
        "source_identifiers": canonical_json(&medication.source_identifiers),
        "regimen_fingerprint": medication.regimen_fingerprint,
        "created_at": medication.created_at.to_rfc3339(),
        "identity_status": identity_status,
    })
}

// The optimistic-lock version covers only staff-entered medication identity
// inputs. Derived state such as a verified medication_drug_matches projection
// is deliberately excluded: a successful confirmation must not make an exact
// replay of that same confirmation look stale.
fn medication_version(medication: &MedicationRecord) -> String {
    fingerprint_json(&json!({
        "id": medication.id,
        "patient_id": medication.patient_id,
        "medication_series_id": medication.medication_series_id,
        "wirkstoff": normalize_key(&medication.wirkstoff),
        "handelsname": normalize_key(&medication.handelsname),
        "staerke": clean_optional_ref(medication.staerke.as_deref())
            .map(|value| normalize_key(&value)),
        "form": clean_optional_ref(medication.form.as_deref())
            .map(|value| normalize_key(&value)),
        "status": medication.status,
        "on_hold": medication.on_hold,
        "source_country": medication.source_country.as_deref()
            .and_then(normalize_country_code),
        "source_identifiers": canonical_json(&medication.source_identifiers),
        "regimen_fingerprint": medication.regimen_fingerprint,
        "created_at": medication.created_at.to_rfc3339(),
        "superseded_at": medication.superseded_at.map(|value| value.to_rfc3339()),
    }))
}

fn product_snapshot(product: &ProductRecord) -> Value {
    json!({
        "id": product.id,
        "brand_name": product.brand_name,
        "normalized_brand_name": product.normalized_brand_name,
        "substances": product.substances,
        "strength": product.strength,
        "form": product.form,
        "pzn": Value::Null,
        "atc_code": product.atc_code,
        "country_code": product.country_code,
        "manufacturer": product.manufacturer,
        "verification_status": product.verification_status,
        "source_kind": product.source_kind,
        "is_active": product.is_active,
        "updated_at": product.updated_at.to_rfc3339(),
    })
}

fn candidate_catalog_version(candidates: &[EvaluatedCandidate]) -> String {
    let values = candidates
        .iter()
        .map(|candidate| {
            json!({
                "product": product_snapshot(&candidate.product),
                "match_basis": candidate.match_basis,
                "confirmable": candidate.confirmable,
                "blocking_reasons": candidate.blocking_reasons,
                "evidence": candidate.evidence,
            })
        })
        .collect::<Vec<_>>();
    fingerprint_json(&json!({
        "ruleset_version": IDENTITY_RULESET_VERSION,
        "candidates": values,
    }))
}

fn query_basis(medication: &MedicationRecord) -> Vec<String> {
    let mut basis = Vec::new();
    if !normalize_key(&medication.handelsname).is_empty() {
        basis.push("brand_name".to_string());
    }
    if usable_substance(&medication.wirkstoff).is_some() {
        basis.push("substance".to_string());
    }
    if clean_optional_ref(medication.staerke.as_deref()).is_some() {
        basis.push("strength".to_string());
    }
    if clean_optional_ref(medication.form.as_deref()).is_some() {
        basis.push("form".to_string());
    }
    if source_identifier(&medication.source_identifiers, &["pzn"])
        .and_then(normalize_pzn)
        .is_some()
    {
        basis.push("pzn".to_string());
    }
    if source_identifier(&medication.source_identifiers, &["atc_code", "atc"])
        .and_then(normalize_atc)
        .is_some()
    {
        basis.push("atc_code".to_string());
    }
    basis
}

fn fingerprint_json(value: &Value) -> String {
    let canonical = canonical_json(value);
    let encoded = serde_json::to_vec(&canonical).expect("JSON values serialize");
    hex::encode(Sha256::digest(encoded))
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let sorted = map
                .iter()
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect::<Map<_, _>>())
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        _ => value.clone(),
    }
}

fn normalize_key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn usable_substance(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("Unbekannter Wirkstoff"))
        .then_some(trimmed)
}

fn exact_optional(left: &Option<String>, right: &Option<String>) -> bool {
    match (
        clean_optional_ref(left.as_deref()),
        clean_optional_ref(right.as_deref()),
    ) {
        (Some(left), Some(right)) => normalize_key(&left) == normalize_key(&right),
        _ => false,
    }
}

fn contradicts(left: &Option<String>, right: &Option<String>) -> bool {
    match (
        clean_optional_ref(left.as_deref()),
        clean_optional_ref(right.as_deref()),
    ) {
        (Some(left), Some(right)) => normalize_key(&left) != normalize_key(&right),
        _ => false,
    }
}

fn source_identifier(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(key)
            .and_then(Value::as_str)
            .and_then(clean_string)
    })
}

fn normalize_atc(value: String) -> Option<String> {
    let normalized = value.trim().to_ascii_uppercase();
    let bytes = normalized.as_bytes();
    (bytes.len() == 7
        && bytes[0].is_ascii_uppercase()
        && bytes[1..3].iter().all(u8::is_ascii_digit)
        && bytes[3..5].iter().all(u8::is_ascii_uppercase)
        && bytes[5..7].iter().all(u8::is_ascii_digit))
    .then_some(normalized)
}

fn normalize_pzn(value: String) -> Option<String> {
    let normalized = value.trim().to_string();
    (normalized.len() == 8 && normalized.bytes().all(|byte| byte.is_ascii_digit()))
        .then_some(normalized)
}

fn normalize_country_code(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_uppercase();
    (normalized.len() == 2 && normalized.bytes().all(|byte| byte.is_ascii_uppercase()))
        .then_some(normalized)
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| clean_string(&value))
}

fn clean_optional_ref(value: Option<&str>) -> Option<String> {
    value.and_then(clean_string)
}

fn clean_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn json_optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .and_then(clean_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn medication() -> MedicationRecord {
        MedicationRecord {
            id: Uuid::new_v4(),
            patient_id: Uuid::new_v4(),
            medication_series_id: Uuid::new_v4(),
            wirkstoff: " Apixaban ".to_string(),
            handelsname: "Eliquis 5 mg".to_string(),
            staerke: Some("5 mg".to_string()),
            form: Some("Filmtablette".to_string()),
            status: "aktiv".to_string(),
            on_hold: false,
            source_country: Some("DE".to_string()),
            source_identifiers: json!({"atc_code":"B01AF02"}),
            regimen_fingerprint: None,
            created_at: Utc::now(),
            superseded_at: None,
            verified_match_id: None,
        }
    }

    fn product(brand: &str, substance: &str, strength: &str, form: &str) -> ProductRecord {
        ProductRecord {
            id: Uuid::new_v4(),
            brand_name: brand.to_string(),
            normalized_brand_name: normalize_key(brand),
            country_code: "DE".to_string(),
            atc_code: Some("B01AF02".to_string()),
            form: Some(form.to_string()),
            strength: Some(strength.to_string()),
            manufacturer: None,
            verification_status: "curated".to_string(),
            source_kind: "manual_curated".to_string(),
            is_active: true,
            updated_at: Utc::now(),
            substances: vec![substance.to_string()],
        }
    }

    #[test]
    fn exact_brand_and_substance_without_strength_or_form_contradiction_is_confirmable() {
        let candidate = evaluate_candidate(
            &medication(),
            product("Eliquis 5 mg", "Apixaban", "5 mg", "Filmtablette"),
        );
        assert!(candidate.confirmable);
        assert_eq!(
            candidate.match_basis,
            ["exact_substance", "exact_strength", "exact_form"]
        );
        assert!(candidate.blocking_reasons.is_empty());
    }

    #[test]
    fn substance_only_and_atc_only_evidence_never_becomes_confirmable() {
        let candidate = evaluate_candidate(
            &medication(),
            product("Different Brand", "Apixaban", "5 mg", "Filmtablette"),
        );
        assert!(!candidate.confirmable);
        assert!(
            candidate
                .blocking_reasons
                .iter()
                .any(|reason| reason == "substance_only_not_identity")
        );

        let mut no_substance = medication();
        no_substance.wirkstoff = "Unbekannter Wirkstoff".to_string();
        let candidate = evaluate_candidate(
            &no_substance,
            product("Different Brand", "Other", "1 mg", "Kapsel"),
        );
        assert!(!candidate.confirmable);
        assert!(
            candidate
                .blocking_reasons
                .iter()
                .any(|reason| reason == "atc_only_not_identity")
        );
    }

    #[test]
    fn brand_only_without_substance_strength_and_form_is_not_confirmable() {
        let mut brand_only = medication();
        brand_only.wirkstoff = "Unbekannter Wirkstoff".to_string();
        brand_only.staerke = None;
        brand_only.form = None;
        brand_only.source_identifiers = json!({});
        let candidate = evaluate_candidate(
            &brand_only,
            product("Eliquis 5 mg", "Apixaban", "5 mg", "Filmtablette"),
        );
        assert!(!candidate.confirmable);
        assert!(
            candidate
                .blocking_reasons
                .iter()
                .any(|reason| reason == "insufficient_identity_evidence")
        );
    }

    #[test]
    fn manual_candidate_source_is_never_confirmable() {
        let mut manual_candidate = product("Eliquis 5 mg", "Apixaban", "5 mg", "Filmtablette");
        manual_candidate.source_kind = "manual_candidate".to_string();
        manual_candidate.verification_status = "verified".to_string();
        let candidate = evaluate_candidate(&medication(), manual_candidate);
        assert!(!candidate.confirmable);
        assert!(
            candidate
                .blocking_reasons
                .iter()
                .any(|reason| reason == "source_not_internal_curated")
        );
    }

    #[test]
    fn medication_fingerprint_changes_when_confirmation_inputs_change() {
        let original = medication();
        let original_version = medication_version(&original);
        let mut edited = original.clone();
        edited.staerke = Some("2.5 mg".to_string());
        let edited_version = medication_version(&edited);
        assert_ne!(original_version, edited_version);
    }

    #[test]
    fn medication_fingerprint_does_not_change_after_identity_projection() {
        let original = medication();
        let original_version = medication_version(&original);
        let mut verified = original.clone();
        verified.verified_match_id = Some(Uuid::new_v4());
        assert_eq!(original_version, medication_version(&verified));
        assert_eq!(
            medication_snapshot(&verified)["identity_status"],
            "verified"
        );
    }
}
