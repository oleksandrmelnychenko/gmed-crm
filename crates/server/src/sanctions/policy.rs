//! Blocked-country policy (owner decision 2026-10-03).
//!
//! When any citizenship or the residence country of the patient, of a
//! guardian of a minor patient or of the third-party payer is in the system
//! setting [`BLOCKED_COUNTRIES_SETTING`] (default `["RU"]`), the lead cannot be
//! qualified or converted and the agency cannot countersign its order. The CEO
//! can lift the block for one lead (or patient) with a mandatory reason; the
//! lift covers the countries blocked at that moment.
//!
//! Legal caveat: EU sanctions list persons and sectors; they do not forbid
//! medical services to Russian citizens as such. Refusing by nationality is a
//! business decision (AGG § 19, DSGVO Art. 22 risk) for the lawyer to review.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::state::AppState;

pub const BLOCKED_COUNTRIES_SETTING: &str = "blocked_countries";
pub const DEFAULT_BLOCKED_COUNTRIES: &[&str] = &["RU"];
const MAX_BLOCKED_COUNTRIES: usize = 250;

/// Upper-case, unique, sorted ISO 3166-1 alpha-2 codes.
pub fn normalize_country_list(values: &[String]) -> Result<Vec<String>, &'static str> {
    if values.len() > MAX_BLOCKED_COUNTRIES {
        return Err("Too many countries");
    }
    let mut codes = Vec::with_capacity(values.len());
    for value in values {
        let code = value.trim().to_ascii_uppercase();
        if code.len() != 2 || !code.chars().all(|ch| ch.is_ascii_uppercase()) {
            return Err("Countries must be ISO 3166-1 alpha-2 codes");
        }
        if !codes.contains(&code) {
            codes.push(code);
        }
    }
    codes.sort();
    Ok(codes)
}

/// The blocked countries; the default when the setting is missing or broken.
pub async fn blocked_countries(db: &gmed_db::DbPool) -> Result<Vec<String>, sqlx::Error> {
    let value: Option<Value> =
        sqlx::query_scalar("SELECT value FROM system_settings WHERE key = $1")
            .bind(BLOCKED_COUNTRIES_SETTING)
            .fetch_optional(db)
            .await?;
    let parsed = value.and_then(|value| {
        let items: Vec<String> = value
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        normalize_country_list(&items).ok()
    });
    Ok(parsed.unwrap_or_else(|| {
        DEFAULT_BLOCKED_COUNTRIES
            .iter()
            .map(|code| code.to_string())
            .collect()
    }))
}

/// Replaces the blocked countries (CEO), audited in the same transaction.
pub async fn set_blocked_countries(
    state: &AppState,
    codes: &[String],
    actor: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    let previous = blocked_countries(&state.db).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"INSERT INTO system_settings (key, value, description, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()"#,
    )
    .bind(BLOCKED_COUNTRIES_SETTING)
    .bind(json!(codes))
    .bind("Blocked countries (ISO 3166-1 alpha-2): citizenship or residence blocks qualification and countersignature; CEO only")
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "sanctions_blocked_countries_updated",
            Some(actor),
            "system_settings",
            None,
            json!({
                "key": BLOCKED_COUNTRIES_SETTING,
                "previous": previous,
                "value": codes,
            }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(codes.to_vec())
}

/// A CEO's lift of the country block for one lead or patient.
#[derive(Debug, Clone, Serialize)]
pub struct CountryOverride {
    pub id: Uuid,
    pub lead_id: Option<Uuid>,
    pub patient_id: Option<Uuid>,
    pub countries: Vec<String>,
    pub reason: String,
    pub lifted_by: Uuid,
    pub lifted_by_name: Option<String>,
    pub lifted_at: DateTime<Utc>,
}

/// Active (not revoked) lifts for any of the leads or patients.
pub async fn active_overrides(
    db: &gmed_db::DbPool,
    lead_ids: &[Uuid],
    patient_ids: &[Uuid],
) -> Result<Vec<CountryOverride>, sqlx::Error> {
    if lead_ids.is_empty() && patient_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(
        r#"SELECT o.id, o.lead_id, o.patient_id, o.countries, o.reason, o.lifted_by,
                  o.lifted_at, u.name AS lifted_by_name
           FROM sanctions_country_overrides o
           LEFT JOIN users u ON u.id = o.lifted_by
           WHERE o.revoked_at IS NULL
             AND (o.lead_id = ANY($1) OR o.patient_id = ANY($2))
           ORDER BY o.lifted_at DESC"#,
    )
    .bind(lead_ids)
    .bind(patient_ids)
    .fetch_all(db)
    .await?;
    let mut overrides = Vec::with_capacity(rows.len());
    for row in rows {
        overrides.push(CountryOverride {
            id: row.try_get("id")?,
            lead_id: row.try_get("lead_id")?,
            patient_id: row.try_get("patient_id")?,
            countries: row.try_get("countries")?,
            reason: row.try_get("reason")?,
            lifted_by: row.try_get("lifted_by")?,
            lifted_by_name: row.try_get("lifted_by_name")?,
            lifted_at: row.try_get("lifted_at")?,
        });
    }
    Ok(overrides)
}

/// The blocked countries found among `countries`, and which of them a lift
/// covers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CountryEvaluation {
    /// Blocked codes present on the subjects.
    pub found: Vec<String>,
    /// Of those, the codes no active lift covers.
    pub blocking: Vec<String>,
}

pub fn evaluate_countries(
    countries: &[String],
    blocked: &[String],
    overrides: &[CountryOverride],
) -> CountryEvaluation {
    let mut found: Vec<String> = Vec::new();
    for code in countries {
        if blocked.contains(code) && !found.contains(code) {
            found.push(code.clone());
        }
    }
    found.sort();
    let blocking = found
        .iter()
        .filter(|code| {
            !overrides
                .iter()
                .any(|lift| lift.countries.iter().any(|covered| covered == *code))
        })
        .cloned()
        .collect();
    CountryEvaluation { found, blocking }
}

#[derive(Debug, thiserror::Error)]
pub enum OverrideError {
    #[error("nothing to lift")]
    NothingToLift,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Lifts the country block for a lead or a patient (CEO), audited in the
/// same transaction. An earlier active lift is replaced.
pub async fn lift_block(
    state: &AppState,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    countries: &[String],
    reason: &str,
    actor: Uuid,
) -> Result<CountryOverride, OverrideError> {
    if countries.is_empty() || lead_id.is_some() == patient_id.is_some() {
        return Err(OverrideError::NothingToLift);
    }
    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"UPDATE sanctions_country_overrides
           SET revoked_at = now(), revoked_by = $3, revoke_reason = 'Replaced by a new lift'
           WHERE revoked_at IS NULL
             AND (lead_id = $1 OR patient_id = $2)"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    let row = sqlx::query(
        r#"INSERT INTO sanctions_country_overrides
               (lead_id, patient_id, countries, reason, lifted_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, lifted_at"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(countries)
    .bind(reason)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    let id: Uuid = row.try_get("id")?;
    let lifted_at: DateTime<Utc> = row.try_get("lifted_at")?;
    let (entity_type, entity_id) = match (lead_id, patient_id) {
        (Some(lead), _) => ("lead", lead),
        (None, Some(patient)) => ("patient", patient),
        (None, None) => return Err(OverrideError::NothingToLift),
    };
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "sanctions_country_block_lifted",
            Some(actor),
            entity_type,
            Some(entity_id),
            json!({
                "override_id": id,
                "countries": countries,
                "reason": reason,
            }),
        ),
    )
    .await?;
    tx.commit().await?;
    let lifted_by_name: Option<String> = sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
        .bind(actor)
        .fetch_optional(&state.db)
        .await?;
    Ok(CountryOverride {
        id,
        lead_id,
        patient_id,
        countries: countries.to_vec(),
        reason: reason.to_string(),
        lifted_by: actor,
        lifted_by_name,
        lifted_at,
    })
}

/// Withdraws a lift (CEO); the block applies again.
pub async fn revoke_lift(
    state: &AppState,
    override_id: Uuid,
    reason: &str,
    actor: Uuid,
) -> Result<bool, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        r#"UPDATE sanctions_country_overrides
           SET revoked_at = now(), revoked_by = $2, revoke_reason = $3
           WHERE id = $1 AND revoked_at IS NULL
           RETURNING lead_id, patient_id"#,
    )
    .bind(override_id)
    .bind(actor)
    .bind(reason)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    let lead_id: Option<Uuid> = row.try_get("lead_id")?;
    let patient_id: Option<Uuid> = row.try_get("patient_id")?;
    let (entity_type, entity_id) = match (lead_id, patient_id) {
        (Some(lead), _) => ("lead", Some(lead)),
        (None, patient) => ("patient", patient),
    };
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "sanctions_country_block_lift_revoked",
            Some(actor),
            entity_type,
            entity_id,
            json!({ "override_id": override_id, "reason": reason }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lift(countries: &[&str]) -> CountryOverride {
        CountryOverride {
            id: Uuid::nil(),
            lead_id: Some(Uuid::nil()),
            patient_id: None,
            countries: countries.iter().map(|code| code.to_string()).collect(),
            reason: "Approved by the CEO after review".into(),
            lifted_by: Uuid::nil(),
            lifted_by_name: None,
            lifted_at: Utc::now(),
        }
    }

    fn codes(values: &[&str]) -> Vec<String> {
        values.iter().map(|code| code.to_string()).collect()
    }

    #[test]
    fn country_lists_are_normalised_and_validated() {
        assert_eq!(
            normalize_country_list(&codes(&[" ru", "BY", "RU"])).unwrap(),
            codes(&["BY", "RU"])
        );
        assert!(normalize_country_list(&codes(&["Russia"])).is_err());
        assert!(normalize_country_list(&codes(&["R1"])).is_err());
        assert!(normalize_country_list(&[]).unwrap().is_empty());
    }

    #[test]
    fn any_citizenship_or_residence_in_the_list_blocks() {
        let blocked = codes(&["BY", "RU"]);
        let evaluation = evaluate_countries(&codes(&["DE", "RU"]), &blocked, &[]);
        assert_eq!(evaluation.found, codes(&["RU"]));
        assert_eq!(evaluation.blocking, codes(&["RU"]));
        assert_eq!(
            evaluate_countries(&codes(&["DE", "UA"]), &blocked, &[]),
            CountryEvaluation::default()
        );
    }

    #[test]
    fn a_lift_covers_only_the_countries_it_names() {
        let blocked = codes(&["BY", "RU"]);
        let lifted = evaluate_countries(&codes(&["RU"]), &blocked, &[lift(&["RU"])]);
        assert_eq!(lifted.found, codes(&["RU"]));
        assert!(lifted.blocking.is_empty());
        // A citizenship added after the lift blocks again.
        let later = evaluate_countries(&codes(&["RU", "BY"]), &blocked, &[lift(&["RU"])]);
        assert_eq!(later.blocking, codes(&["BY"]));
    }
}
