//! One-off backfill of the contracting party of minors converted before
//! 2026-10-19 (owner decision of that day): `patients.custody` and
//! `patients.contracting_relation_ids` from the patient's converted lead, as
//! the conversion stores them since then — the custody of the lead's
//! declaration and the relations of rep1, plus rep2 only under joint custody,
//! with the lead's representation read as of its conversion day.
//!
//! Idempotent and never overwriting: only patients whose
//! `contracting_relation_ids` is empty are touched, each in its own
//! transaction with an append-only audit row (`backfill_contracting_party`).
//! A patient whose representatives cannot be mapped to exactly one relation
//! each is skipped and keeps the "every recorded parent" fallback of
//! [`super::contracting_party::load_representatives`]. Runs at startup.

use std::collections::HashSet;

use chrono::NaiveDate;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::audit;
use crate::routes::lead_representatives;

/// What one run did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BackfillReport {
    /// Patients that got their contracting party.
    pub stored: usize,
    /// Converted minors whose representatives could not be mapped
    /// unambiguously; they keep the fallback.
    pub unresolved: usize,
}

enum Outcome {
    Stored,
    Unresolved,
    NotApplicable,
}

/// Backfills every converted patient without stored contracting relations.
pub async fn run(pool: &PgPool) -> Result<BackfillReport, sqlx::Error> {
    // The latest conversion of each patient states its representation.
    let candidates: Vec<(Uuid, Uuid, NaiveDate)> = sqlx::query_as(
        r#"SELECT DISTINCT ON (p.id) p.id, l.id,
                  (COALESCE(l.status_changed_at, p.created_at) AT TIME ZONE 'Europe/Berlin')::date
           FROM patients p
           JOIN leads l ON l.converted_patient_id = p.id
           WHERE cardinality(p.contracting_relation_ids) = 0
             AND l.date_of_birth IS NOT NULL
           ORDER BY p.id, l.status_changed_at DESC, l.id DESC"#,
    )
    .fetch_all(pool)
    .await?;
    let mut report = BackfillReport::default();
    for (patient_id, lead_id, converted_on) in candidates {
        match backfill_one(pool, patient_id, lead_id, converted_on).await {
            Ok(Outcome::Stored) => report.stored += 1,
            Ok(Outcome::Unresolved) => {
                report.unresolved += 1;
                tracing::info!(%patient_id, %lead_id, "contracting party backfill: not unambiguous, fallback kept");
            }
            Ok(Outcome::NotApplicable) => {}
            Err(error) => {
                report.unresolved += 1;
                tracing::warn!(%error, %patient_id, %lead_id, "contracting party backfill failed");
            }
        }
    }
    Ok(report)
}

async fn backfill_one(
    pool: &PgPool,
    patient_id: Uuid,
    lead_id: Uuid,
    converted_on: NaiveDate,
) -> Result<Outcome, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let still_empty: Option<bool> = sqlx::query_scalar(
        "SELECT cardinality(contracting_relation_ids) = 0 FROM patients WHERE id = $1 FOR UPDATE",
    )
    .bind(patient_id)
    .fetch_optional(&mut *tx)
    .await?;
    if still_empty != Some(true) {
        return Ok(Outcome::NotApplicable);
    }
    let Some(loaded) = lead_representatives::load_on(&mut tx, lead_id, converted_on).await? else {
        return Ok(Outcome::NotApplicable);
    };
    let representation = &loaded.representation;
    if !representation.minor {
        return Ok(Outcome::NotApplicable);
    }
    let custody = representation.answers.custody().to_string();
    let slotted: Vec<Uuid> = representation
        .representatives
        .iter()
        .filter(|person| person.slot.is_some())
        .map(|person| person.id)
        .collect();
    if slotted.is_empty() {
        return Ok(Outcome::Unresolved);
    }
    let contacts: Value = sqlx::query_scalar(
        "SELECT COALESCE(trusted_contacts, '[]'::jsonb) FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await?;
    let mut relation_ids = Vec::new();
    for contact_id in &slotted {
        let Some(entry) = contacts
            .as_array()
            .into_iter()
            .flatten()
            .find(|entry| lead_representatives::entry_id(entry) == Some(*contact_id))
        else {
            return Ok(Outcome::Unresolved);
        };
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let related_patient_id = entry
            .get("related_patient_id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value.trim()).ok());
        // The relation the conversion made of the entry: by the linked
        // record, else by the name (a later link keeps the name).
        let matches: Vec<Uuid> = sqlx::query_scalar(
            r#"SELECT id FROM patient_relations
               WHERE patient_id = $1
                 AND relation_type IN ('parent', 'mother', 'father', 'guardian')
                 AND (($2::uuid IS NOT NULL AND related_patient_id = $2)
                      OR ($3 <> '' AND btrim(related_name) = $3))"#,
        )
        .bind(patient_id)
        .bind(related_patient_id)
        .bind(&name)
        .fetch_all(&mut *tx)
        .await?;
        let [relation_id] = matches.as_slice() else {
            return Ok(Outcome::Unresolved);
        };
        relation_ids.push(*relation_id);
    }
    if relation_ids.iter().collect::<HashSet<_>>().len() != relation_ids.len() {
        return Ok(Outcome::Unresolved);
    }
    let stored = sqlx::query(
        r#"UPDATE patients
           SET contracting_relation_ids = $2, custody = COALESCE(custody, $3)
           WHERE id = $1 AND cardinality(contracting_relation_ids) = 0"#,
    )
    .bind(patient_id)
    .bind(&relation_ids)
    .bind(&custody)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if stored == 0 {
        return Ok(Outcome::NotApplicable);
    }
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "backfill_contracting_party",
            None,
            "patient",
            Some(patient_id),
            json!({
                "lead_id": lead_id,
                "converted_on": converted_on,
                "custody": custody,
                "contracting_relation_ids": relation_ids,
                "reason": "owner_decision_2026_10_19",
            }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(Outcome::Stored)
}

/// Runs the backfill once, shortly after startup.
pub fn spawn_once(pool: PgPool) {
    tokio::spawn(async move {
        match run(&pool).await {
            Ok(report) if report.stored > 0 || report.unresolved > 0 => tracing::info!(
                stored = report.stored,
                unresolved = report.unresolved,
                "Contracting party backfill complete"
            ),
            Ok(_) => {}
            Err(error) => tracing::warn!(%error, "Contracting party backfill failed"),
        }
    });
}
