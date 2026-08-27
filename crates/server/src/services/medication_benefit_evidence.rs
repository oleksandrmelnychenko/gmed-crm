use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::gba_ais::GBA_AIS_SOURCE_ID;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceIdentifierKind {
    Pzn,
    Atc,
    Ask,
}

impl EvidenceIdentifierKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pzn => "pzn",
            Self::Atc => "atc",
            Self::Ask => "ask",
        }
    }

    fn array_column(self) -> &'static str {
        match self {
            Self::Pzn => "pzns",
            Self::Atc => "atc_codes",
            Self::Ask => "ask_numbers",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExactEvidenceSelector {
    pub kind: EvidenceIdentifierKind,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EvidenceSelectorError {
    #[error("one of pzn, atc or ask is required")]
    Missing,
    #[error("pzn must contain exactly 8 ASCII digits")]
    InvalidPzn,
    #[error("atc must match the official 7-character format A00AA00")]
    InvalidAtc,
    #[error("ask must contain exactly 5 ASCII digits")]
    InvalidAsk,
}

/// Selects exactly one identifier using the safety precedence PZN -> ATC ->
/// ASK. A present but invalid stronger identifier is rejected; it never falls
/// through to a broader identifier.
pub fn select_exact_identifier(
    pzn: Option<&str>,
    atc: Option<&str>,
    ask: Option<&str>,
) -> Result<ExactEvidenceSelector, EvidenceSelectorError> {
    if let Some(value) = pzn {
        let value = value.trim();
        if value.len() != 8 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(EvidenceSelectorError::InvalidPzn);
        }
        return Ok(ExactEvidenceSelector {
            kind: EvidenceIdentifierKind::Pzn,
            value: value.to_string(),
        });
    }
    if let Some(value) = atc {
        let value = value.trim().to_ascii_uppercase();
        let bytes = value.as_bytes();
        if bytes.len() != 7
            || !bytes[0].is_ascii_uppercase()
            || !bytes[1..3].iter().all(u8::is_ascii_digit)
            || !bytes[3..5].iter().all(u8::is_ascii_uppercase)
            || !bytes[5..7].iter().all(u8::is_ascii_digit)
        {
            return Err(EvidenceSelectorError::InvalidAtc);
        }
        return Ok(ExactEvidenceSelector {
            kind: EvidenceIdentifierKind::Atc,
            value,
        });
    }
    if let Some(value) = ask {
        let value = value.trim();
        if value.len() != 5 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(EvidenceSelectorError::InvalidAsk);
        }
        return Ok(ExactEvidenceSelector {
            kind: EvidenceIdentifierKind::Ask,
            value: value.to_string(),
        });
    }
    Err(EvidenceSelectorError::Missing)
}

#[derive(Debug, Clone, Serialize)]
pub struct BenefitAssessmentEvidenceItem {
    pub evidence_ref: String,
    pub snapshot_id: Uuid,
    pub source_id: String,
    pub patient_group_id: String,
    pub decision_id: String,
    pub dossier_reference: String,
    pub official_url: String,
    pub assessment_type: String,
    pub assessed_substances: Vec<String>,
    pub atc_codes: Vec<String>,
    pub ask_numbers: Vec<String>,
    pub pzns: Vec<String>,
    pub trade_names: Vec<String>,
    pub decision_date: String,
    pub valid_until: Option<String>,
    pub indication_short: String,
    pub patient_group: String,
    pub benefit_extent: String,
    pub benefit_probability: Option<String>,
    pub item_checksum_sha256: String,
}

#[derive(Debug, Clone)]
pub struct ExactEvidencePage {
    pub total_count: i64,
    pub items: Vec<BenefitAssessmentEvidenceItem>,
}

impl ExactEvidencePage {
    pub fn empty() -> Self {
        Self {
            total_count: 0,
            items: Vec::new(),
        }
    }
}

pub async fn load_exact_benefit_evidence(
    pool: &PgPool,
    snapshot_id: Uuid,
    selector: &ExactEvidenceSelector,
    limit: i64,
    offset: i64,
) -> Result<ExactEvidencePage, sqlx::Error> {
    // The interpolated column is selected exclusively from a closed enum. The
    // lookup value and pagination remain bound parameters.
    let statement = format!(
        r#"WITH matched AS (
               SELECT item.*
               FROM medication_intelligence_benefit_assessment_items item
               WHERE item.snapshot_id = $1
                 AND item.source_id = $2
                 AND item.{} @> ARRAY[$3]::TEXT[]
           ), page AS (
               SELECT *
               FROM matched
               ORDER BY decision_date DESC, decision_id, patient_group_id
               LIMIT $4 OFFSET $5
           ), total AS (
               SELECT count(*) AS total_count FROM matched
           )
           SELECT total.total_count,
                  page.snapshot_id, page.source_id, page.patient_group_id,
                  page.decision_id, page.dossier_reference, page.official_url,
                  page.assessment_type, page.assessed_substances,
                  page.atc_codes, page.ask_numbers, page.pzns, page.trade_names,
                  page.decision_date, page.valid_until, page.indication_short,
                  page.patient_group, page.benefit_extent,
                  page.benefit_probability, page.item_checksum_sha256
           FROM total
           LEFT JOIN page ON TRUE
           ORDER BY page.decision_date DESC, page.decision_id,
                    page.patient_group_id"#,
        selector.kind.array_column()
    );
    let rows = sqlx::query(&statement)
        .bind(snapshot_id)
        .bind(GBA_AIS_SOURCE_ID)
        .bind(&selector.value)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
    let total_count = rows
        .first()
        .map(|row| row.get::<i64, _>("total_count"))
        .unwrap_or(0);
    let items = rows
        .into_iter()
        .filter_map(|row| {
            let snapshot_id = row.get::<Option<Uuid>, _>("snapshot_id")?;
            let patient_group_id = row.get::<String, _>("patient_group_id");
            let decision_date = row.get::<NaiveDate, _>("decision_date");
            let valid_until = row.get::<Option<NaiveDate>, _>("valid_until");
            Some(BenefitAssessmentEvidenceItem {
                evidence_ref: format!(
                    "official_source_item:{GBA_AIS_SOURCE_ID}:{snapshot_id}:{patient_group_id}"
                ),
                snapshot_id,
                source_id: row.get("source_id"),
                patient_group_id,
                decision_id: row.get("decision_id"),
                dossier_reference: row.get("dossier_reference"),
                official_url: row.get("official_url"),
                assessment_type: row.get("assessment_type"),
                assessed_substances: row.get("assessed_substances"),
                atc_codes: row.get("atc_codes"),
                ask_numbers: row.get("ask_numbers"),
                pzns: row.get("pzns"),
                trade_names: row.get("trade_names"),
                decision_date: decision_date.format("%Y-%m-%d").to_string(),
                valid_until: valid_until.map(|value| value.format("%Y-%m-%d").to_string()),
                indication_short: row.get("indication_short"),
                patient_group: row.get("patient_group"),
                benefit_extent: row.get("benefit_extent"),
                benefit_probability: row.get("benefit_probability"),
                item_checksum_sha256: row.get("item_checksum_sha256"),
            })
        })
        .collect();
    Ok(ExactEvidencePage { total_count, items })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selector_uses_strict_precedence_without_match_broadening() {
        let selected = select_exact_identifier(Some("12345678"), Some("a01aa01"), Some("12345"))
            .expect("valid PZN");
        assert_eq!(selected.kind, EvidenceIdentifierKind::Pzn);
        assert_eq!(selected.value, "12345678");

        let selected =
            select_exact_identifier(None, Some(" a01aa01 "), Some("12345")).expect("valid ATC");
        assert_eq!(selected.kind, EvidenceIdentifierKind::Atc);
        assert_eq!(selected.value, "A01AA01");

        let selected =
            select_exact_identifier(None, None, Some("12345")).expect("valid ASK number");
        assert_eq!(selected.kind, EvidenceIdentifierKind::Ask);
    }

    #[test]
    fn invalid_stronger_identifier_never_falls_through() {
        assert_eq!(
            select_exact_identifier(Some("123"), Some("A01AA01"), Some("12345")),
            Err(EvidenceSelectorError::InvalidPzn)
        );
        assert_eq!(
            select_exact_identifier(None, Some("A01"), Some("12345")),
            Err(EvidenceSelectorError::InvalidAtc)
        );
        assert_eq!(
            select_exact_identifier(None, None, Some("1234")),
            Err(EvidenceSelectorError::InvalidAsk)
        );
        assert_eq!(
            select_exact_identifier(None, None, None),
            Err(EvidenceSelectorError::Missing)
        );
    }
}
