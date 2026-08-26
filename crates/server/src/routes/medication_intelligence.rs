use std::collections::BTreeMap;

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::Utc;
use gmed_domain::role::Role;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::bfarm_rote_hand::{BFARM_ROTE_HAND_SOURCE_ID, normalize_substance_key};
use crate::services::medication_identity::MedicationIdentityPermissions;
use crate::services::medication_intelligence_sources::{
    OfficialSourceStatus, load_source_statuses,
};
use crate::state::AppState;

// Keep this read gate aligned with the patient clinical master record. Future
// medical roles must be enabled deliberately in both workspaces.
const MEDICATION_INTELLIGENCE_ROLES: &[Role] = &[Role::Ceo];

const DISCLAIMER_RU: &str = "Текущая версия выполняет только ограниченный набор детерминированных проверок. Подключённые официальные сообщения BfArM сопоставляются только при точном совпадении явно указанного действующего вещества; источники со статусом planned или manual_reference не проверяются. Отсутствие предупреждения не подтверждает безопасность препарата, комбинации или дозировки. Решение принимает медицинский специалист.";
const DISCLAIMER_DE: &str = "Die aktuelle Version führt nur einen begrenzten Satz deterministischer Prüfungen aus. Angebundene amtliche BfArM-Mitteilungen werden nur bei exakter Übereinstimmung eines ausdrücklich genannten Wirkstoffs zugeordnet; Quellen mit dem Status planned oder manual_reference werden nicht geprüft. Das Fehlen eines Hinweises belegt nicht die Sicherheit eines Arzneimittels, einer Kombination oder Dosierung. Die Entscheidung trifft medizinisches Fachpersonal.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/medication-intelligence",
            get(get_patient_medication_intelligence),
        )
        .route(
            "/medication-intelligence/sources",
            get(get_medication_intelligence_sources),
        )
}

#[derive(Debug, Serialize)]
struct MedicationIntelligenceResponse {
    mode: &'static str,
    generated_at: String,
    disclaimer: LocalizedDisclaimer,
    summary: IntelligenceSummary,
    medications: Vec<MedicationView>,
    findings: Vec<Finding>,
    missing_data: Vec<MissingData>,
    sources: Vec<OfficialSourceStatus>,
    identity_permissions: MedicationIdentityPermissions,
}

#[derive(Debug, Serialize)]
struct LocalizedDisclaimer {
    ru: &'static str,
    de: &'static str,
}

#[derive(Debug, Serialize)]
struct IntelligenceSummary {
    active_medications: usize,
    identified_medications: usize,
    unresolved_medications: usize,
    findings_total: usize,
    high_priority_findings: usize,
    missing_data_total: usize,
}

#[derive(Debug, Clone, Serialize)]
struct MedicationView {
    id: Uuid,
    name: String,
    substance: Option<String>,
    status: String,
    atc_code: Option<String>,
    pzn: Option<String>,
    country_code: Option<String>,
    identity_status: &'static str,
    #[serde(skip)]
    normalized_substance: Option<String>,
    #[serde(skip)]
    is_active: bool,
}

#[derive(Debug, Serialize)]
struct Finding {
    id: String,
    severity: &'static str,
    category: &'static str,
    title_ru: String,
    title_de: String,
    detail_ru: String,
    detail_de: String,
    medication_ids: Vec<Uuid>,
    evidence_refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_at: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    substances: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
struct OfficialSafetyAlert {
    snapshot_id: Uuid,
    alert_id: String,
    official_title: String,
    official_url: String,
    published_at: Option<chrono::DateTime<Utc>>,
    substance_labels: Vec<String>,
    substance_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
struct MissingData {
    code: &'static str,
    label_ru: String,
    label_de: String,
    reason_ru: String,
    reason_de: String,
}

#[derive(Debug, Serialize)]
struct SourceStatusResponse {
    mode: &'static str,
    generated_at: String,
    sources: Vec<OfficialSourceStatus>,
}

async fn get_medication_intelligence_sources(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin]) {
        return response;
    }
    audit_context.set_action("read_medication_intelligence_source_status");
    audit_context.set_context(json!({ "mode": "open_sources_only" }));

    match load_source_statuses(&state.db).await {
        Ok(sources) => Json(SourceStatusResponse {
            mode: "open_sources_only",
            generated_at: Utc::now().to_rfc3339(),
            sources,
        })
        .into_response(),
        Err(error_value) => {
            tracing::error!(error = %error_value, "load medication intelligence source status");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication intelligence source status",
            )
        }
    }
}

async fn get_patient_medication_intelligence(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(MEDICATION_INTELLIGENCE_ROLES) {
        return response;
    }

    match has_patient_access(&state, &auth, patient_id).await {
        Ok(true) => {}
        Ok(false) => return error(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(response) => return response,
    }

    audit_context.set_entity("patient", patient_id);
    audit_context.set_action("read_patient_medication_intelligence");
    audit_context.set_context(json!({ "mode": "open_sources_only" }));

    let rows = match sqlx::query(
        r#"SELECT pm.id, pm.wirkstoff, pm.handelsname, pm.status, pm.on_hold,
                  pm.source_country, pm.source_identifiers,
                  verified.atc_code AS verified_atc_code,
                  verified.country_code AS verified_country_code,
                  verified.match_id AS verified_match_id
           FROM patient_medications pm
           LEFT JOIN LATERAL (
               SELECT mdm.id AS match_id, dp.atc_code, dp.country_code
               FROM medication_drug_matches mdm
               JOIN drug_products dp ON dp.id = mdm.drug_product_id
               WHERE mdm.patient_medication_id = pm.id
                 AND mdm.verification_status = 'verified'
                 AND dp.is_active = true
               ORDER BY mdm.confidence DESC, mdm.created_at DESC, mdm.id
               LIMIT 1
           ) verified ON TRUE
           WHERE pm.patient_id = $1
             AND pm.superseded_at IS NULL
           ORDER BY pm.sort_order, pm.created_at, pm.id"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error_value) => {
            tracing::error!(
                error = %error_value,
                patient_id = %patient_id,
                "load medication intelligence inputs"
            );
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication intelligence",
            );
        }
    };

    let medications = rows
        .into_iter()
        .map(|row| {
            let id = row.get::<Uuid, _>("id");
            let trade_name = clean_optional(row.get::<String, _>("handelsname"));
            let substance = clean_optional(row.get::<Option<String>, _>("wirkstoff"));
            let status = row.get::<String, _>("status");
            let on_hold = row.get::<bool, _>("on_hold");
            let source_identifiers = row.get::<Value, _>("source_identifiers");
            let source_atc =
                identifier(&source_identifiers, &["atc_code", "atc"]).and_then(normalize_atc);
            let pzn = identifier(&source_identifiers, &["pzn"]).and_then(normalize_pzn);
            let verified_match_id = row.get::<Option<Uuid>, _>("verified_match_id");
            let verified_atc = row
                .get::<Option<String>, _>("verified_atc_code")
                .and_then(normalize_atc);
            let source_country = row
                .get::<Option<String>, _>("source_country")
                .and_then(|value| normalize_country_code(&value));
            let verified_country = row
                .get::<Option<String>, _>("verified_country_code")
                .and_then(|value| normalize_country_code(&value));
            let has_source_identifier = source_atc.is_some() || pzn.is_some();
            let identity_status = if verified_match_id.is_some() {
                "verified"
            } else if has_source_identifier {
                "candidate"
            } else {
                "unresolved"
            };

            MedicationView {
                id,
                name: trade_name
                    .clone()
                    .or_else(|| substance.clone())
                    .unwrap_or_else(|| "—".to_string()),
                normalized_substance: substance.as_deref().and_then(normalize_substance),
                substance,
                status: status.clone(),
                atc_code: verified_atc.or(source_atc),
                pzn,
                country_code: verified_country.or(source_country),
                identity_status,
                is_active: status == "aktiv" && !on_hold,
            }
        })
        .collect::<Vec<_>>();

    let sources = match load_source_statuses(&state.db).await {
        Ok(sources) => sources,
        Err(error_value) => {
            tracing::error!(
                error = %error_value,
                patient_id = %patient_id,
                "load medication intelligence source status for patient review"
            );
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication intelligence source status",
            );
        }
    };

    let official_alerts = match load_latest_official_safety_alerts(&state.db).await {
        Ok(alerts) => alerts,
        Err(error_value) => {
            tracing::error!(
                error = %error_value,
                patient_id = %patient_id,
                "load normalized official safety alerts"
            );
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load medication intelligence source findings",
            );
        }
    };

    Json(analyze(medications, sources, official_alerts)).into_response()
}

fn analyze(
    medications: Vec<MedicationView>,
    sources: Vec<OfficialSourceStatus>,
    official_alerts: Vec<OfficialSafetyAlert>,
) -> MedicationIntelligenceResponse {
    let active_medications = medications
        .iter()
        .filter(|medication| medication.is_active)
        .count();
    let unresolved = medications
        .iter()
        .filter(|medication| medication.is_active && medication.identity_status == "unresolved")
        .collect::<Vec<_>>();

    let mut findings = Vec::new();
    let mut missing_data = Vec::new();
    let mut duplicate_groups: BTreeMap<&str, Vec<&MedicationView>> = BTreeMap::new();

    for medication in medications.iter().filter(|medication| medication.is_active) {
        if let Some(normalized_substance) = medication.normalized_substance.as_deref() {
            duplicate_groups
                .entry(normalized_substance)
                .or_default()
                .push(medication);
        }
    }

    for (normalized_substance, group) in duplicate_groups {
        if group.len() < 2 {
            continue;
        }
        let medication_ids = group
            .iter()
            .map(|medication| medication.id)
            .collect::<Vec<_>>();
        let display_substance = group
            .iter()
            .find_map(|medication| medication.substance.as_deref())
            .unwrap_or(normalized_substance);
        findings.push(Finding {
            id: stable_finding_id("duplicate-active-ingredient", normalized_substance),
            severity: "warning",
            category: "duplicate_active_ingredient",
            title_ru: "Возможное дублирование действующего вещества".to_string(),
            title_de: "Mögliche Wirkstoff-Duplikation".to_string(),
            detail_ru: format!(
                "В нескольких активных позициях указано одно действующее вещество: {display_substance}. Требуется проверка медицинским специалистом; это не вывод о взаимодействии или дозировке."
            ),
            detail_de: format!(
                "Mehrere aktive Einträge enthalten denselben Wirkstoff: {display_substance}. Eine Prüfung durch medizinisches Fachpersonal ist erforderlich; dies ist keine Aussage zu Wechselwirkungen oder Dosierung."
            ),
            evidence_refs: medication_ids
                .iter()
                .map(|id| format!("patient_medication:{id}"))
                .collect(),
            medication_ids,
            source_id: None,
            published_at: None,
            source_url: None,
            substances: None,
        });
    }

    for medication in &unresolved {
        findings.push(Finding {
            id: format!("unresolved-medication-identity-{}", medication.id),
            severity: "info",
            category: "unresolved_medication_identity",
            title_ru: "Идентичность препарата не подтверждена".to_string(),
            title_de: "Arzneimittelidentität nicht bestätigt".to_string(),
            detail_ru: format!(
                "Для активной позиции «{}» нет подтверждённого сопоставления с каталогом и пригодного ATC/PZN. Автоматические клинические выводы не выполнялись.",
                medication.name
            ),
            detail_de: format!(
                "Für den aktiven Eintrag „{}“ liegt weder eine bestätigte Katalogzuordnung noch ein verwendbarer ATC/PZN vor. Es wurden keine automatischen klinischen Schlussfolgerungen gezogen.",
                medication.name
            ),
            medication_ids: vec![medication.id],
            evidence_refs: vec![format!("patient_medication:{}", medication.id)],
            source_id: None,
            published_at: None,
            source_url: None,
            substances: None,
        });
        missing_data.push(MissingData {
            code: "medication_identity",
            label_ru: format!("Идентификация: {}", medication.name),
            label_de: format!("Identifikation: {}", medication.name),
            reason_ru: "Нужен подтверждённый medication_drug_match либо проверенный ATC/PZN."
                .to_string(),
            reason_de:
                "Erforderlich ist ein bestätigter medication_drug_match oder ein geprüfter ATC/PZN."
                    .to_string(),
        });
    }

    for alert in official_alerts {
        let medication_ids = medications
            .iter()
            .filter(|medication| medication.is_active)
            .filter(|medication| {
                medication.normalized_substance.as_ref().is_some_and(|key| {
                    alert
                        .substance_keys
                        .iter()
                        .any(|explicit_key| explicit_key == key)
                })
            })
            .map(|medication| medication.id)
            .collect::<Vec<_>>();
        if medication_ids.is_empty() {
            continue;
        }
        let substances = alert.substance_labels.clone();
        let substance_display = substances.join(", ");
        findings.push(Finding {
            id: format!("official-safety-alert-{}", alert.alert_id),
            severity: "warning",
            category: "official_safety_alert",
            title_ru: "Официальное сообщение BfArM по безопасности".to_string(),
            title_de: alert.official_title.clone(),
            detail_ru: format!(
                "Явно указанное в сообщении действующее вещество ({substance_display}) точно совпало с активной позицией пациента. Проверьте оригинал BfArM; это не автоматический вывод о взаимодействии, дозировке или лечении."
            ),
            detail_de: format!(
                "Der in der Mitteilung ausdrücklich genannte Wirkstoff ({substance_display}) stimmt exakt mit einem aktiven Patienteneintrag überein. Bitte prüfen Sie das BfArM-Original; dies ist keine automatische Aussage zu Wechselwirkung, Dosierung oder Behandlung."
            ),
            medication_ids,
            evidence_refs: vec![
                format!("official_source_item:{}", alert.alert_id),
                format!("official_source_snapshot:{}", alert.snapshot_id),
            ],
            source_id: Some(BFARM_ROTE_HAND_SOURCE_ID.to_string()),
            published_at: Some(alert.published_at.map(|value| value.to_rfc3339())),
            source_url: Some(alert.official_url),
            substances: Some(substances),
        });
    }

    findings.sort_by(|left, right| left.id.cmp(&right.id));
    let high_priority_findings = findings
        .iter()
        .filter(|finding| finding.severity == "high")
        .count();
    let unresolved_medications = unresolved.len();

    MedicationIntelligenceResponse {
        mode: "open_sources_only",
        generated_at: Utc::now().to_rfc3339(),
        disclaimer: LocalizedDisclaimer {
            ru: DISCLAIMER_RU,
            de: DISCLAIMER_DE,
        },
        summary: IntelligenceSummary {
            active_medications,
            identified_medications: active_medications.saturating_sub(unresolved_medications),
            unresolved_medications,
            findings_total: findings.len(),
            high_priority_findings,
            missing_data_total: missing_data.len(),
        },
        medications,
        findings,
        missing_data,
        sources,
        identity_permissions: MedicationIdentityPermissions::ceo(),
    }
}

fn normalize_substance(value: &str) -> Option<String> {
    normalize_substance_key(value)
}

async fn load_latest_official_safety_alerts(
    pool: &sqlx::PgPool,
) -> Result<Vec<OfficialSafetyAlert>, sqlx::Error> {
    let rows = sqlx::query(
        r#"WITH latest_snapshot AS (
               SELECT id
               FROM medication_intelligence_source_snapshots
               WHERE source_id = $1
                 AND attempt_status = 'success'
               ORDER BY fetched_at DESC, id DESC
               LIMIT 1
           )
           SELECT item.snapshot_id, item.alert_id, item.official_title,
                  item.official_url, item.published_at,
                  item.explicit_substance_labels, item.explicit_substance_keys
           FROM medication_intelligence_safety_alert_items item
           JOIN latest_snapshot latest ON latest.id = item.snapshot_id
           WHERE item.source_id = $1
           ORDER BY item.published_at DESC NULLS LAST, item.alert_id"#,
    )
    .bind(BFARM_ROTE_HAND_SOURCE_ID)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| OfficialSafetyAlert {
            snapshot_id: row.get("snapshot_id"),
            alert_id: row.get("alert_id"),
            official_title: row.get("official_title"),
            official_url: row.get("official_url"),
            published_at: row.get("published_at"),
            substance_labels: row.get("explicit_substance_labels"),
            substance_keys: row.get("explicit_substance_keys"),
        })
        .collect())
}

fn clean_optional<T>(value: T) -> Option<String>
where
    T: Into<Option<String>>,
{
    value
        .into()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn identifier(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
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

fn stable_finding_id(prefix: &str, value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    format!("{prefix}-{}", &hex::encode(digest)[..16])
}

async fn has_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<bool, axum::response::Response> {
    if auth.role.has_full_access() || !access::requires_patient_assignment(auth.role) {
        return Ok(true);
    }
    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error_value| {
            tracing::error!(
                error = %error_value,
                patient_id = %patient_id,
                "validate medication intelligence patient access"
            );
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            )
        })
}

fn error(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("request_failed"),
            "message": message,
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn medication(
        id: Uuid,
        substance: Option<&str>,
        status: &str,
        identity_status: &'static str,
        is_active: bool,
    ) -> MedicationView {
        MedicationView {
            id,
            name: substance.unwrap_or("Unknown").to_string(),
            substance: substance.map(str::to_string),
            normalized_substance: substance.and_then(normalize_substance),
            status: status.to_string(),
            atc_code: None,
            pzn: None,
            country_code: None,
            identity_status,
            is_active,
        }
    }

    #[test]
    fn duplicate_check_normalizes_active_substance_but_ignores_inactive_rows() {
        let first_id = Uuid::new_v4();
        let second_id = Uuid::new_v4();
        let inactive_id = Uuid::new_v4();
        let response = analyze(
            vec![
                medication(first_id, Some(" Ibuprofen "), "aktiv", "candidate", true),
                medication(second_id, Some("IBUPROFEN"), "aktiv", "candidate", true),
                medication(
                    inactive_id,
                    Some("ibuprofen"),
                    "abgesetzt",
                    "candidate",
                    false,
                ),
            ],
            Vec::new(),
            Vec::new(),
        );

        let duplicate = response
            .findings
            .iter()
            .find(|finding| finding.category == "duplicate_active_ingredient")
            .expect("duplicate finding");
        assert_eq!(duplicate.severity, "warning");
        assert_eq!(duplicate.medication_ids.len(), 2);
        assert!(duplicate.medication_ids.contains(&first_id));
        assert!(duplicate.medication_ids.contains(&second_id));
        assert!(!duplicate.medication_ids.contains(&inactive_id));
    }

    #[test]
    fn unresolved_active_identity_becomes_finding_and_missing_data() {
        let medication_id = Uuid::new_v4();
        let response = analyze(
            vec![medication(
                medication_id,
                Some("Unbekannter Wirkstoff"),
                "aktiv",
                "unresolved",
                true,
            )],
            Vec::new(),
            Vec::new(),
        );

        assert_eq!(response.summary.unresolved_medications, 1);
        assert_eq!(response.summary.missing_data_total, 1);
        assert!(response.findings.iter().any(|finding| {
            finding.category == "unresolved_medication_identity"
                && finding.medication_ids == [medication_id]
        }));
        assert_eq!(response.missing_data[0].code, "medication_identity");
    }

    #[test]
    fn response_never_claims_that_absence_of_findings_proves_safety() {
        let response = analyze(Vec::new(), Vec::new(), Vec::new());
        let payload = serde_json::to_value(response).expect("serialize response");

        assert!(payload.get("safe").is_none());
        assert!(
            payload["disclaimer"]["ru"]
                .as_str()
                .is_some_and(|value| value.contains("не подтверждает безопасность"))
        );
        assert!(
            payload["disclaimer"]["de"]
                .as_str()
                .is_some_and(|value| value.contains("belegt nicht die Sicherheit"))
        );
    }
}
