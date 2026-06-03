use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct DrugProductSearchResult {
    pub id: Uuid,
    pub brand_name: String,
    pub country_code: String,
    pub atc_code: Option<String>,
    pub form: Option<String>,
    pub strength: Option<String>,
    pub manufacturer: Option<String>,
    pub verification_status: String,
    pub substances: Vec<String>,
    pub clinical_note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GermanEquivalentResult {
    pub equivalent_id: Uuid,
    pub relationship_id: Option<Uuid>,
    pub brand_name: String,
    pub country_code: String,
    pub atc_code: Option<String>,
    pub form: Option<String>,
    pub strength: Option<String>,
    pub manufacturer: Option<String>,
    pub confidence: String,
    pub verification_status: String,
    pub substances: Vec<String>,
    pub note: Option<String>,
    pub note_ru: Option<String>,
    pub note_de: Option<String>,
    pub staff_warning: String,
    pub staff_warning_ru: String,
    pub staff_warning_de: String,
}

const ACTIVE_SUBSTANCE_REFERENCE_NOTE_EN: &str =
    "Same active substance reference. Staff information only; not a prescription.";
const ACTIVE_SUBSTANCE_REFERENCE_NOTE_RU: &str =
    "Справочная связь по тому же действующему веществу. Только для команды, не назначение.";
const ACTIVE_SUBSTANCE_REFERENCE_NOTE_DE: &str =
    "Referenz zum gleichen Wirkstoff. Nur Team-Information, keine Verordnung.";

const ACTIVE_SUBSTANCE_MATCH_NOTE_EN: &str =
    "Matched by active substance. Staff information only; not a prescription.";
const ACTIVE_SUBSTANCE_MATCH_NOTE_RU: &str =
    "Совпадение по действующему веществу. Только для команды, не назначение.";
const ACTIVE_SUBSTANCE_MATCH_NOTE_DE: &str =
    "Abgleich über den Wirkstoff. Nur Team-Information, keine Verordnung.";

const STAFF_WARNING_RU: &str =
    "Немецкие эквиваленты являются только справочной информацией для команды, не назначением.";
const STAFF_WARNING_DE: &str =
    "Deutsche Äquivalente sind nur Team-Referenzinformationen, keine Verordnung.";

#[derive(Debug, Serialize)]
pub struct MedicationEquivalentResult {
    pub medication_id: Uuid,
    pub medication_name: String,
    pub medication_substance: Option<String>,
    pub candidates: Vec<GermanEquivalentResult>,
}

pub async fn search_drug_products(
    pool: &gmed_db::DbPool,
    query: &str,
    country_code: Option<&str>,
    include_candidates: bool,
) -> Result<Vec<DrugProductSearchResult>, sqlx::Error> {
    let search_term = normalize_search_term(query);
    if search_term.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!("%{search_term}%");
    let country = country_code
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_uppercase());

    let rows = sqlx::query(
        r#"SELECT p.id,
                  p.brand_name,
                  p.country_code,
                  p.atc_code,
                  p.form,
                  p.strength,
                  p.manufacturer,
                  p.verification_status,
                  p.clinical_note,
                  COALESCE(ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.id IS NOT NULL), ARRAY[]::text[]) AS substances
           FROM drug_products p
           LEFT JOIN drug_product_substances ps ON ps.product_id = p.id
           LEFT JOIN drug_substances s ON s.id = ps.substance_id
           WHERE p.is_active = true
             AND ($2::text IS NULL OR p.country_code = $2)
             AND ($3::bool = true OR p.verification_status IN ('curated', 'verified'))
             AND (
                    p.normalized_brand_name LIKE $1
                 OR lower(COALESCE(p.atc_code, '')) LIKE $1
                 OR lower(COALESCE(p.manufacturer, '')) LIKE $1
                 OR lower(COALESCE(p.strength, '')) LIKE $1
                 OR lower(COALESCE(p.form, '')) LIKE $1
                 OR EXISTS (
                        SELECT 1
                        FROM drug_product_substances ps2
                        JOIN drug_substances s2 ON s2.id = ps2.substance_id
                        WHERE ps2.product_id = p.id
                          AND s2.normalized_name LIKE $1
                    )
             )
           GROUP BY p.id
           ORDER BY CASE WHEN p.country_code = 'DE' THEN 0 ELSE 1 END,
                    p.brand_name
           LIMIT 50"#,
    )
    .bind(pattern)
    .bind(country)
    .bind(include_candidates)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(product_from_row).collect())
}

pub async fn load_german_equivalents(
    pool: &gmed_db::DbPool,
    product_id: Uuid,
    include_candidates: bool,
) -> Result<Vec<GermanEquivalentResult>, sqlx::Error> {
    let rows = sqlx::query(
        r#"WITH source_substances AS (
                SELECT substance_id
                FROM drug_product_substances
                WHERE product_id = $1
           ),
           explicit_equivalents AS (
                SELECT e.equivalent_product_id AS product_id,
                       e.id AS relationship_id,
                       e.confidence,
                       e.verification_status,
                       e.note,
                       0 AS rank
                FROM drug_equivalents e
                WHERE e.source_product_id = $1
                  AND ($2::bool = true OR e.verification_status = 'verified')
           ),
           substance_equivalents AS (
                SELECT p.id AS product_id,
                       NULL::uuid AS relationship_id,
                       0.70::numeric AS confidence,
                       CASE
                            WHEN p.verification_status = 'verified' THEN 'verified'
                            ELSE 'candidate'
                       END AS verification_status,
                       'Matched by active substance. Staff information only; not a prescription.'::text AS note,
                       1 AS rank
                FROM drug_products p
                JOIN drug_product_substances ps ON ps.product_id = p.id
                WHERE p.country_code = 'DE'
                  AND p.is_active = true
                  AND ps.substance_id IN (SELECT substance_id FROM source_substances)
                  AND p.id <> $1
                  AND (
                        $2::bool = true
                        OR p.verification_status = 'verified'
                  )
           ),
           candidates AS (
                SELECT * FROM explicit_equivalents
                UNION ALL
                SELECT * FROM substance_equivalents
           )
           SELECT DISTINCT ON (p.id)
                  p.id,
                  candidates.relationship_id,
                  p.brand_name,
                  p.country_code,
                  p.atc_code,
                  p.form,
                  p.strength,
                  p.manufacturer,
                  candidates.confidence,
                  candidates.verification_status,
                  candidates.note,
                  COALESCE(ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.id IS NOT NULL), ARRAY[]::text[]) AS substances,
                  candidates.rank
           FROM candidates
           JOIN drug_products p ON p.id = candidates.product_id
           LEFT JOIN drug_product_substances ps ON ps.product_id = p.id
           LEFT JOIN drug_substances s ON s.id = ps.substance_id
           WHERE p.country_code = 'DE'
             AND p.is_active = true
             AND ($2::bool = true OR candidates.verification_status = 'verified')
           GROUP BY p.id, candidates.confidence, candidates.verification_status, candidates.note, candidates.rank
                  , candidates.relationship_id
           ORDER BY p.id, candidates.rank, candidates.confidence DESC"#,
    )
    .bind(product_id)
    .bind(include_candidates)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(equivalent_from_row).collect())
}

pub async fn load_medication_german_equivalents(
    pool: &gmed_db::DbPool,
    case_id: Uuid,
    medication_id: Uuid,
    include_candidates: bool,
) -> Result<Option<MedicationEquivalentResult>, sqlx::Error> {
    let medication_row = sqlx::query(
        r#"SELECT id, handelsname, wirkstoff
           FROM medikamente
           WHERE id = $1
             AND case_id = $2"#,
    )
    .bind(medication_id)
    .bind(case_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = medication_row else {
        return Ok(None);
    };
    let medication_name = row.try_get::<String, _>("handelsname").unwrap_or_default();
    let medication_substance = row
        .try_get::<Option<String>, _>("wirkstoff")
        .unwrap_or_default();

    let mut candidates = Vec::new();
    let matched_products = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT drug_product_id
           FROM medication_drug_matches
           WHERE case_id = $1
             AND medication_id = $2
             AND ($3::bool = true OR verification_status = 'verified')
           ORDER BY CASE verification_status WHEN 'verified' THEN 0 ELSE 1 END,
                    confidence DESC"#,
    )
    .bind(case_id)
    .bind(medication_id)
    .bind(include_candidates)
    .fetch_all(pool)
    .await?;

    for product_id in matched_products {
        candidates.extend(load_german_equivalents(pool, product_id, include_candidates).await?);
    }

    if candidates.is_empty() {
        let query = medication_substance
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(medication_name.trim());
        for product in search_drug_products(pool, query, None, include_candidates).await? {
            candidates.extend(load_german_equivalents(pool, product.id, include_candidates).await?);
        }
    }

    dedupe_equivalents(&mut candidates);

    Ok(Some(MedicationEquivalentResult {
        medication_id,
        medication_name,
        medication_substance,
        candidates,
    }))
}

fn product_from_row(row: sqlx::postgres::PgRow) -> DrugProductSearchResult {
    DrugProductSearchResult {
        id: row.try_get("id").unwrap_or_default(),
        brand_name: row.try_get("brand_name").unwrap_or_default(),
        country_code: row.try_get("country_code").unwrap_or_default(),
        atc_code: row.try_get("atc_code").unwrap_or_default(),
        form: row.try_get("form").unwrap_or_default(),
        strength: row.try_get("strength").unwrap_or_default(),
        manufacturer: row.try_get("manufacturer").unwrap_or_default(),
        verification_status: row
            .try_get("verification_status")
            .unwrap_or_else(|_| "candidate".to_string()),
        substances: row.try_get("substances").unwrap_or_default(),
        clinical_note: row.try_get("clinical_note").unwrap_or_default(),
    }
}

fn equivalent_from_row(row: sqlx::postgres::PgRow) -> GermanEquivalentResult {
    let confidence = row
        .try_get::<Decimal, _>("confidence")
        .unwrap_or(Decimal::ZERO);
    let source_note: Option<String> = row.try_get("note").unwrap_or_default();
    let (note_ru, note_de) = localized_equivalent_note(source_note.as_deref());
    let note = note_ru.clone().or(source_note);
    GermanEquivalentResult {
        equivalent_id: row.try_get("id").unwrap_or_default(),
        relationship_id: row.try_get("relationship_id").unwrap_or_default(),
        brand_name: row.try_get("brand_name").unwrap_or_default(),
        country_code: row.try_get("country_code").unwrap_or_default(),
        atc_code: row.try_get("atc_code").unwrap_or_default(),
        form: row.try_get("form").unwrap_or_default(),
        strength: row.try_get("strength").unwrap_or_default(),
        manufacturer: row.try_get("manufacturer").unwrap_or_default(),
        confidence: confidence.round_dp(2).normalize().to_string(),
        verification_status: row
            .try_get("verification_status")
            .unwrap_or_else(|_| "candidate".to_string()),
        substances: row.try_get("substances").unwrap_or_default(),
        note,
        note_ru,
        note_de,
        staff_warning: STAFF_WARNING_RU.to_string(),
        staff_warning_ru: STAFF_WARNING_RU.to_string(),
        staff_warning_de: STAFF_WARNING_DE.to_string(),
    }
}

fn localized_equivalent_note(note: Option<&str>) -> (Option<String>, Option<String>) {
    match note {
        Some(ACTIVE_SUBSTANCE_REFERENCE_NOTE_EN) => (
            Some(ACTIVE_SUBSTANCE_REFERENCE_NOTE_RU.to_string()),
            Some(ACTIVE_SUBSTANCE_REFERENCE_NOTE_DE.to_string()),
        ),
        Some(ACTIVE_SUBSTANCE_MATCH_NOTE_EN) => (
            Some(ACTIVE_SUBSTANCE_MATCH_NOTE_RU.to_string()),
            Some(ACTIVE_SUBSTANCE_MATCH_NOTE_DE.to_string()),
        ),
        Some(value) => (Some(value.to_string()), Some(value.to_string())),
        None => (None, None),
    }
}

fn dedupe_equivalents(candidates: &mut Vec<GermanEquivalentResult>) {
    candidates.sort_by(|left, right| {
        left.equivalent_id
            .cmp(&right.equivalent_id)
            .then_with(|| right.confidence.cmp(&left.confidence))
    });
    candidates.dedup_by_key(|candidate| candidate.equivalent_id);
}

fn normalize_search_term(value: &str) -> String {
    value.trim().to_lowercase()
}

#[cfg(test)]
fn drug_record_visible(verification_status: &str, include_candidates: bool) -> bool {
    include_candidates || matches!(verification_status, "curated" | "verified")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_search_term_trims_and_lowercases() {
        assert_eq!(normalize_search_term("  Atorvastatin "), "atorvastatin");
    }

    #[test]
    fn drug_record_visible_hides_unverified_candidates_by_default() {
        assert!(drug_record_visible("verified", false));
        assert!(drug_record_visible("curated", false));
        assert!(!drug_record_visible("candidate", false));
        assert!(!drug_record_visible("rejected", false));
        assert!(drug_record_visible("candidate", true));
    }
}
