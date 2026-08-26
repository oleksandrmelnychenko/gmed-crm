//! Conservative KBV BMP 2.8 carrier XML import.
//!
//! The module parses already decoded carrier XML only. It neither decodes a
//! DataMatrix image nor resolves PZN/product identity remotely.

use std::collections::BTreeMap;
use std::str;

use chrono::{NaiveDate, NaiveDateTime, Utc};
use gmed_db::DbPool;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub const MODE: &str = "kbv_bmp_carrier_xml";
pub const SUPPORTED_VERSION: &str = "028";
pub const SUPPORTED_LOCALE: &str = "de-DE";
pub const PARSER_VERSION: &str = "gmed-bmp-import-v1";
pub const MAX_CARRIER_XML_BYTES: usize = 128 * 1024;
const MAX_XML_EVENTS: usize = 2_048;
const MAX_IDEMPOTENCY_KEY_CHARS: usize = 200;

#[derive(Debug, Error)]
pub enum BmpImportError {
    #[error("patient not found")]
    PatientNotFound,
    #[error("invalid BMP carrier: {0}")]
    InvalidCarrier(String),
    #[error("unsupported BMP carrier: {0}")]
    UnsupportedCarrier(String),
    #[error("BMP patient identity does not match")]
    IdentityMismatch,
    #[error("BMP carrier contains non-importable content")]
    BlockingContent,
    #[error("BMP preview is stale")]
    StalePreview,
    #[error("staff acknowledgement is required")]
    StaffAcknowledgementRequired,
    #[error("idempotency key belongs to another BMP import")]
    IdempotencyConflict,
    #[error("invalid request input")]
    InvalidInput,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpParserDescriptor {
    pub spec_version: &'static str,
    pub locale: &'static str,
    pub implementation_version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpPlanView {
    pub instance_id: String,
    pub version: String,
    pub locale: String,
    pub page_number: Option<u8>,
    pub total_pages: Option<u8>,
    pub printed_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpPatientView {
    pub given_name: String,
    pub family_name: String,
    pub birth_date: String,
    pub gender: Option<String>,
    pub insurance_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpIssuerIdentifier {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpIssuerView {
    pub name: String,
    pub street: Option<String>,
    pub postal_code: Option<String>,
    pub city: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub printed_at: String,
    pub identifier: Option<BmpIssuerIdentifier>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpSubstanceView {
    pub name: String,
    pub strength: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpCodeOrTextView {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpDoseView {
    pub morning: Option<String>,
    pub noon: Option<String>,
    pub evening: Option<String>,
    pub night: Option<String>,
    pub free_text: Option<String>,
    pub weekly_day: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpIssue {
    pub code: String,
    pub path: String,
    pub message_ru: String,
    pub message_de: String,
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpMedicationView {
    pub index: usize,
    pub pzn: Option<String>,
    pub trade_name: Option<String>,
    pub substances: Vec<BmpSubstanceView>,
    pub form: Option<BmpCodeOrTextView>,
    pub dose: BmpDoseView,
    pub unit: Option<BmpCodeOrTextView>,
    pub instructions: Option<String>,
    pub reason: Option<String>,
    pub additional_text: Option<String>,
    pub importable: bool,
    pub blocking_reasons: Vec<BmpIssue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpSectionView {
    pub index: usize,
    pub code: Option<String>,
    pub title: Option<String>,
    pub category: Option<String>,
    pub medications: Vec<BmpMedicationView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpPreviewSummary {
    pub sections_total: usize,
    pub medications_total: usize,
    pub importable_medications: usize,
    pub blocked_medications: usize,
    pub current_medications_replaced: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpIdentityField {
    pub field: String,
    pub carrier_value: Option<String>,
    pub patient_value: Option<String>,
    pub matches: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpIdentityMatch {
    pub status: String,
    pub fields: Vec<BmpIdentityField>,
    pub blocking_reasons: Vec<BmpIssue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpPermissions {
    pub can_preview: bool,
    pub can_confirm: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpImportPreview {
    pub mode: &'static str,
    pub generated_at: String,
    pub parser: BmpParserDescriptor,
    pub preview_fingerprint: String,
    pub plan: BmpPlanView,
    pub patient: BmpPatientView,
    pub issuer: BmpIssuerView,
    pub sections: Vec<BmpSectionView>,
    pub summary: BmpPreviewSummary,
    pub identity_match: BmpIdentityMatch,
    pub warnings: Vec<BmpIssue>,
    pub permissions: BmpPermissions,
}

#[derive(Debug, Clone, Serialize)]
pub struct BmpImportConfirmResponse {
    pub mode: &'static str,
    pub import_id: Uuid,
    pub status: &'static str,
    pub strategy: &'static str,
    pub plan_instance_id: String,
    pub preview_fingerprint: String,
    pub medication_ids: Vec<Uuid>,
    pub imported_medications: usize,
    pub superseded_medications: usize,
    pub idempotent_replay: bool,
    pub confirmed_at: String,
    pub permissions: BmpPermissions,
}

#[derive(Debug, Clone)]
pub struct ConfirmBmpImportInput<'a> {
    pub carrier_xml: &'a str,
    pub preview_fingerprint: &'a str,
    pub idempotency_key: &'a str,
    pub staff_acknowledged: bool,
}

#[derive(Debug, Clone)]
pub struct ConfirmBmpImportResult {
    pub response: BmpImportConfirmResponse,
    pub created: bool,
}

#[derive(Debug, Clone)]
struct ParsedBmp {
    plan: BmpPlanView,
    patient: BmpPatientView,
    issuer: BmpIssuerView,
    sections: Vec<BmpSectionView>,
    warnings: Vec<BmpIssue>,
    carrier_sha256: String,
    printed_at: NaiveDateTime,
}

#[derive(Debug, Clone)]
struct PatientIdentity {
    given_name: String,
    family_name: String,
    birth_date: NaiveDate,
}

#[derive(Debug, Default)]
struct ParserState {
    root_seen: bool,
    root_closed: bool,
    patient_seen: bool,
    issuer_seen: bool,
    parameters_seen: bool,
    phase: u8,
    stack: Vec<String>,
    ignored_depth: usize,
    plan: Option<BmpPlanView>,
    patient: Option<BmpPatientView>,
    issuer: Option<BmpIssuerView>,
    sections: Vec<BmpSectionView>,
    current_section: Option<BmpSectionView>,
    current_medication: Option<BmpMedicationView>,
    warnings: Vec<BmpIssue>,
}

pub async fn build_preview(
    pool: &DbPool,
    patient_id: Uuid,
    carrier_xml: &str,
) -> Result<BmpImportPreview, BmpImportError> {
    let parsed = parse_carrier_xml(carrier_xml)?;
    let patient = load_patient_identity(pool, patient_id).await?;
    let (current_medications_replaced, current_snapshot) =
        load_current_medication_snapshot(pool, patient_id).await?;
    assemble_preview(
        parsed,
        patient,
        current_medications_replaced,
        &current_snapshot,
    )
}

fn assemble_preview(
    parsed: ParsedBmp,
    patient_identity: PatientIdentity,
    current_medications_replaced: usize,
    current_snapshot: &Value,
) -> Result<BmpImportPreview, BmpImportError> {
    let identity_match = compare_patient_identity(&parsed.patient, &patient_identity);
    let medications_total = parsed
        .sections
        .iter()
        .map(|section| section.medications.len())
        .sum::<usize>();
    let sections_total = parsed.sections.len();
    let importable_medications = parsed
        .sections
        .iter()
        .flat_map(|section| &section.medications)
        .filter(|medication| medication.importable)
        .count();
    let blocked_medications = medications_total.saturating_sub(importable_medications);
    let has_blocking_warning = parsed.warnings.iter().any(|warning| warning.blocking);
    let can_confirm = identity_match.status == "matched"
        && medications_total > 0
        && blocked_medications == 0
        && !has_blocking_warning;
    let preview_fingerprint = hash_json(&json!({
        "parser_version": PARSER_VERSION,
        "plan": &parsed.plan,
        "patient": &parsed.patient,
        "issuer": &parsed.issuer,
        "sections": &parsed.sections,
        "warnings": &parsed.warnings,
        "target_patient": {
            "given_name": patient_identity.given_name,
            "family_name": patient_identity.family_name,
            "birth_date": patient_identity.birth_date,
        },
        "current_medications": current_snapshot,
    }))?;
    Ok(BmpImportPreview {
        mode: MODE,
        generated_at: Utc::now().to_rfc3339(),
        parser: BmpParserDescriptor {
            spec_version: SUPPORTED_VERSION,
            locale: SUPPORTED_LOCALE,
            implementation_version: PARSER_VERSION,
        },
        preview_fingerprint,
        plan: parsed.plan,
        patient: parsed.patient,
        issuer: parsed.issuer,
        sections: parsed.sections,
        summary: BmpPreviewSummary {
            sections_total,
            medications_total,
            importable_medications,
            blocked_medications,
            current_medications_replaced,
        },
        identity_match,
        warnings: parsed.warnings,
        permissions: BmpPermissions {
            can_preview: true,
            can_confirm,
        },
    })
}

fn parse_carrier_xml(carrier_xml: &str) -> Result<ParsedBmp, BmpImportError> {
    if carrier_xml.is_empty() || carrier_xml.len() > MAX_CARRIER_XML_BYTES {
        return Err(BmpImportError::InvalidCarrier(
            "carrier XML is empty or exceeds 128 KiB".to_string(),
        ));
    }
    if carrier_xml.starts_with('\u{feff}') {
        return Err(BmpImportError::InvalidCarrier(
            "byte-order marks are not accepted".to_string(),
        ));
    }
    let mut reader = Reader::from_str(carrier_xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = true;
    let mut state = ParserState::default();
    let mut events = 0usize;
    loop {
        events += 1;
        if events > MAX_XML_EVENTS {
            return Err(BmpImportError::InvalidCarrier(
                "carrier XML has too many nodes".to_string(),
            ));
        }
        match reader.read_event() {
            Ok(Event::Start(event)) => handle_open(&reader, &mut state, &event, false)?,
            Ok(Event::Empty(event)) => handle_open(&reader, &mut state, &event, true)?,
            Ok(Event::End(event)) => {
                let name = xml_name(event.name().as_ref())?;
                handle_end(&mut state, &name)?;
            }
            Ok(Event::Text(text)) => {
                let value = text
                    .decode()
                    .map_err(|error| BmpImportError::InvalidCarrier(error.to_string()))?;
                if !value.trim().is_empty() {
                    return Err(BmpImportError::InvalidCarrier(
                        "BMP elements may not contain text nodes".to_string(),
                    ));
                }
            }
            Ok(Event::Comment(_)) => state.warnings.push(issue(
                "xml_comment_unsupported",
                "/",
                "XML-комментарии не входят в поддерживаемый профиль носителя.",
                "XML-Kommentare gehören nicht zum unterstützten Trägerprofil.",
                true,
            )),
            Ok(Event::Decl(_)) | Ok(Event::PI(_)) | Ok(Event::DocType(_)) => {
                return Err(BmpImportError::InvalidCarrier(
                    "XML declarations, processing instructions and DTDs are forbidden".to_string(),
                ));
            }
            Ok(Event::CData(_)) | Ok(Event::GeneralRef(_)) => {
                return Err(BmpImportError::InvalidCarrier(
                    "CDATA and entity references are forbidden".to_string(),
                ));
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(BmpImportError::InvalidCarrier(error.to_string())),
        }
    }
    if !state.root_seen || !state.root_closed || !state.stack.is_empty() {
        return Err(BmpImportError::InvalidCarrier(
            "carrier XML does not contain one complete MP root".to_string(),
        ));
    }
    if !state.patient_seen || !state.issuer_seen {
        return Err(BmpImportError::InvalidCarrier(
            "carrier XML must contain P and A elements".to_string(),
        ));
    }
    let mut plan = state
        .plan
        .ok_or_else(|| BmpImportError::InvalidCarrier("missing MP metadata".to_string()))?;
    let patient = state
        .patient
        .ok_or_else(|| BmpImportError::InvalidCarrier("missing patient element".to_string()))?;
    let issuer = state
        .issuer
        .ok_or_else(|| BmpImportError::InvalidCarrier("missing issuer element".to_string()))?;
    plan.printed_at = issuer.printed_at.clone();
    let printed_at = NaiveDateTime::parse_from_str(&issuer.printed_at, "%Y-%m-%dT%H:%M:%S")
        .map_err(|_| BmpImportError::InvalidCarrier("invalid issuer timestamp".to_string()))?;
    Ok(ParsedBmp {
        plan,
        patient,
        issuer,
        sections: state.sections,
        warnings: state.warnings,
        carrier_sha256: hash_bytes(carrier_xml.as_bytes()),
        printed_at,
    })
}

fn handle_open(
    reader: &Reader<&[u8]>,
    state: &mut ParserState,
    event: &BytesStart<'_>,
    empty: bool,
) -> Result<(), BmpImportError> {
    let name = xml_name(event.name().as_ref())?;
    let attrs = xml_attributes(reader, event)?;
    if state.root_closed {
        return Err(BmpImportError::InvalidCarrier(
            "content after MP root is not allowed".to_string(),
        ));
    }
    if state.ignored_depth > 0 {
        if !empty {
            state.ignored_depth += 1;
            state.stack.push(name);
        }
        return Ok(());
    }
    let known = matches!(
        name.as_str(),
        "MP" | "P" | "A" | "O" | "S" | "M" | "W" | "X" | "R"
    );
    if !known {
        let path = current_path(state, &name);
        state.warnings.push(issue(
            "unknown_element",
            &path,
            "Неизвестный элемент BMP сохранён как блокирующее предупреждение; импорт не выполнен.",
            "Ein unbekanntes BMP-Element wurde als blockierende Warnung erfasst; kein Import erfolgt.",
            true,
        ));
        if !empty {
            state.ignored_depth = 1;
            state.stack.push(name);
        }
        return Ok(());
    }
    process_element(state, &name, attrs, empty)?;
    if !empty {
        state.stack.push(name);
    }
    Ok(())
}

fn handle_end(state: &mut ParserState, name: &str) -> Result<(), BmpImportError> {
    let Some(opened) = state.stack.pop() else {
        return Err(BmpImportError::InvalidCarrier(
            "unexpected closing element".to_string(),
        ));
    };
    if opened != name {
        return Err(BmpImportError::InvalidCarrier(
            "mismatched closing element".to_string(),
        ));
    }
    if state.ignored_depth > 0 {
        state.ignored_depth -= 1;
        return Ok(());
    }
    match name {
        "M" => finalize_medication(state)?,
        "S" => finalize_section(state)?,
        "MP" => state.root_closed = true,
        _ => {}
    }
    Ok(())
}

fn process_element(
    state: &mut ParserState,
    name: &str,
    attrs: BTreeMap<String, String>,
    empty: bool,
) -> Result<(), BmpImportError> {
    match name {
        "MP" => {
            if empty || state.root_seen || !state.stack.is_empty() {
                return Err(BmpImportError::InvalidCarrier(
                    "MP must be the single non-empty root".to_string(),
                ));
            }
            state.root_seen = true;
            state.plan = Some(parse_plan(attrs, &mut state.warnings)?);
        }
        "P" => {
            require_root_child(state, "P")?;
            if state.patient_seen || state.phase != 0 {
                return Err(BmpImportError::InvalidCarrier(
                    "P must occur exactly once before A".to_string(),
                ));
            }
            state.patient_seen = true;
            state.phase = 1;
            state.patient = Some(parse_patient(attrs, &mut state.warnings)?);
        }
        "A" => {
            require_root_child(state, "A")?;
            if state.issuer_seen || state.phase != 1 {
                return Err(BmpImportError::InvalidCarrier(
                    "A must occur exactly once after P".to_string(),
                ));
            }
            state.issuer_seen = true;
            state.phase = 2;
            state.issuer = Some(parse_issuer(attrs, &mut state.warnings)?);
        }
        "O" => {
            require_root_child(state, "O")?;
            if state.phase != 2 || state.parameters_seen {
                return Err(BmpImportError::InvalidCarrier(
                    "O must occur at most once after A and before S".to_string(),
                ));
            }
            state.parameters_seen = true;
            warn_unknown_attributes(
                &attrs,
                &["ai", "aii", "xs", "r"],
                "/MP/O",
                &mut state.warnings,
            );
            state.warnings.push(issue(
                "bmp_parameters_not_imported",
                "/MP/O",
                "Параметры BMP не относятся к импорту лекарств и не изменялись.",
                "BMP-Parameter gehören nicht zum Medikamentenimport und wurden nicht geändert.",
                false,
            ));
        }
        "S" => {
            require_root_child(state, "S")?;
            if empty || state.phase < 2 || state.current_section.is_some() {
                return Err(BmpImportError::InvalidCarrier(
                    "S must be a non-empty root section after A".to_string(),
                ));
            }
            if state.sections.len() >= 23 {
                return Err(BmpImportError::InvalidCarrier(
                    "BMP may contain at most 23 sections".to_string(),
                ));
            }
            state.phase = 3;
            let section_index = state.sections.len();
            state.current_section = Some(parse_section(attrs, section_index, &mut state.warnings));
        }
        "M" => {
            if state.current_section.is_none()
                || state.current_medication.is_some()
                || state.stack.last().map(String::as_str) != Some("S")
            {
                return Err(BmpImportError::InvalidCarrier(
                    "M must be directly inside S".to_string(),
                ));
            }
            if state
                .current_section
                .as_ref()
                .is_some_and(|section| section.medications.len() >= 45)
            {
                return Err(BmpImportError::InvalidCarrier(
                    "BMP section may contain at most 45 entries".to_string(),
                ));
            }
            let index = state
                .sections
                .iter()
                .map(|section| section.medications.len())
                .sum::<usize>()
                + state
                    .current_section
                    .as_ref()
                    .map(|section| section.medications.len())
                    .unwrap_or(0);
            state.current_medication = Some(parse_medication(attrs, index));
            if empty {
                finalize_medication(state)?;
            }
        }
        "W" => {
            if !empty
                || state.current_medication.is_none()
                || state.stack.last().map(String::as_str) != Some("M")
            {
                return Err(BmpImportError::InvalidCarrier(
                    "W must be an empty element inside M".to_string(),
                ));
            }
            if state
                .current_medication
                .as_ref()
                .is_some_and(|medication| medication.substances.len() >= 3)
            {
                return Err(BmpImportError::InvalidCarrier(
                    "BMP medication may contain at most three W elements".to_string(),
                ));
            }
            parse_substance(
                attrs,
                state.current_medication.as_mut().expect("checked above"),
            );
        }
        "X" | "R" => {
            if state.current_section.is_none()
                || state.current_medication.is_some()
                || state.stack.last().map(String::as_str) != Some("S")
            {
                return Err(BmpImportError::InvalidCarrier(format!(
                    "{name} must be directly inside S"
                )));
            }
            state.warnings.push(issue(
                "unsupported_section_entry",
                &format!("/MP/S/{name}"),
                "Запись раздела не является лекарством и не может быть импортирована без потерь.",
                "Der Abschnittseintrag ist kein Medikament und kann nicht verlustfrei importiert werden.",
                true,
            ));
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn require_root_child(state: &ParserState, name: &str) -> Result<(), BmpImportError> {
    if !state.root_seen || state.root_closed || state.stack.last().map(String::as_str) != Some("MP")
    {
        return Err(BmpImportError::InvalidCarrier(format!(
            "{name} must be directly inside MP"
        )));
    }
    Ok(())
}

fn parse_plan(
    attrs: BTreeMap<String, String>,
    warnings: &mut Vec<BmpIssue>,
) -> Result<BmpPlanView, BmpImportError> {
    warn_unknown_attributes(&attrs, &["v", "U", "l", "a", "z", "p"], "/MP", warnings);
    let version = required_attr(&attrs, "v", "/MP")?;
    let locale = required_attr(&attrs, "l", "/MP")?;
    let instance_id = required_attr(&attrs, "U", "/MP")?;
    if version != SUPPORTED_VERSION {
        return Err(BmpImportError::UnsupportedCarrier(format!(
            "BMP version {version} is unsupported; expected 028"
        )));
    }
    if locale != SUPPORTED_LOCALE {
        return Err(BmpImportError::UnsupportedCarrier(format!(
            "BMP locale {locale} is unsupported; expected de-DE"
        )));
    }
    if instance_id.len() != 32
        || !instance_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
    {
        return Err(BmpImportError::InvalidCarrier(
            "MP.U must be 32 uppercase hexadecimal characters".to_string(),
        ));
    }
    if attrs.contains_key("p") {
        warnings.push(issue(
            "patch_plan_unsupported",
            "/MP/@p",
            "Patch-носители BMP не поддерживаются.",
            "BMP-Patch-Träger werden nicht unterstützt.",
            true,
        ));
    }
    let page_number = optional_u8(&attrs, "a", 1, 5, "/MP")?;
    let total_pages = optional_u8(&attrs, "z", 2, 5, "/MP")?;
    if page_number.is_some() || total_pages.is_some() {
        warnings.push(issue(
            "multipage_plan_incomplete",
            "/MP",
            "Для импорта требуется полный план; отдельная страница многостраничного BMP заблокирована.",
            "Für den Import ist der vollständige Plan erforderlich; eine einzelne Seite eines mehrseitigen BMP ist blockiert.",
            true,
        ));
    }
    Ok(BmpPlanView {
        instance_id,
        version,
        locale,
        page_number,
        total_pages,
        printed_at: String::new(),
    })
}

fn parse_patient(
    attrs: BTreeMap<String, String>,
    warnings: &mut Vec<BmpIssue>,
) -> Result<BmpPatientView, BmpImportError> {
    warn_unknown_attributes(
        &attrs,
        &["g", "f", "b", "egk", "s", "t", "v", "z"],
        "/MP/P",
        warnings,
    );
    let given_name = bounded_required(&attrs, "g", 45, "/MP/P")?;
    let family_name = bounded_required(&attrs, "f", 45, "/MP/P")?;
    let birth_raw = required_attr(&attrs, "b", "/MP/P")?;
    if birth_raw.len() != 8 || !birth_raw.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(BmpImportError::InvalidCarrier(
            "P.b must use compact YYYYMMDD format".to_string(),
        ));
    }
    let gender = bounded_optional(&attrs, "s", 1, "/MP/P")?;
    if gender
        .as_deref()
        .is_some_and(|value| !matches!(value, "M" | "W" | "X" | "D"))
    {
        return Err(BmpImportError::InvalidCarrier(
            "P.s contains an unsupported gender code".to_string(),
        ));
    }
    if ["t", "v", "z"].iter().any(|key| attrs.contains_key(*key)) {
        warnings.push(issue(
            "patient_name_extensions_not_imported",
            "/MP/P",
            "Титул, приставка или суффикс имени показаны предупреждением и не изменяют профиль пациента.",
            "Titel, Vorsatzwort oder Namenszusatz werden als Hinweis erfasst und ändern das Patientenprofil nicht.",
            false,
        ));
    }
    Ok(BmpPatientView {
        given_name,
        family_name,
        birth_date: compact_birth_date_display(&birth_raw),
        gender,
        insurance_id: bounded_optional(&attrs, "egk", 10, "/MP/P")?,
    })
}

fn parse_issuer(
    attrs: BTreeMap<String, String>,
    warnings: &mut Vec<BmpIssue>,
) -> Result<BmpIssuerView, BmpImportError> {
    warn_unknown_attributes(
        &attrs,
        &["n", "t", "s", "z", "c", "p", "e", "lanr", "idf", "kik"],
        "/MP/A",
        warnings,
    );
    let name = bounded_required(&attrs, "n", 80, "/MP/A")?;
    let printed_at = required_attr(&attrs, "t", "/MP/A")?;
    NaiveDateTime::parse_from_str(&printed_at, "%Y-%m-%dT%H:%M:%S").map_err(|_| {
        BmpImportError::InvalidCarrier("A.t must use YYYY-MM-DDThh:mm:ss".to_string())
    })?;
    let identifiers = ["lanr", "idf", "kik"]
        .iter()
        .filter_map(|key| {
            attrs
                .get(*key)
                .map(|value| ((*key).to_string(), value.clone()))
        })
        .collect::<Vec<_>>();
    if identifiers.len() > 1 {
        return Err(BmpImportError::InvalidCarrier(
            "A may contain only one of lanr, idf and kik".to_string(),
        ));
    }
    Ok(BmpIssuerView {
        name,
        street: bounded_optional(&attrs, "s", 80, "/MP/A")?,
        postal_code: bounded_optional(&attrs, "z", 10, "/MP/A")?,
        city: bounded_optional(&attrs, "c", 45, "/MP/A")?,
        phone: bounded_optional(&attrs, "p", 20, "/MP/A")?,
        email: bounded_optional(&attrs, "e", 80, "/MP/A")?,
        printed_at,
        identifier: identifiers
            .into_iter()
            .next()
            .map(|(kind, value)| BmpIssuerIdentifier { kind, value }),
    })
}

fn parse_section(
    attrs: BTreeMap<String, String>,
    index: usize,
    warnings: &mut Vec<BmpIssue>,
) -> BmpSectionView {
    warn_unknown_attributes(&attrs, &["c", "t"], &format!("/MP/S[{index}]"), warnings);
    let code = attrs
        .get("c")
        .cloned()
        .filter(|value| !value.trim().is_empty());
    let title = attrs
        .get("t")
        .cloned()
        .filter(|value| !value.trim().is_empty());
    if code.is_some() && title.is_some() {
        warnings.push(issue(
            "section_heading_conflict",
            &format!("/MP/S[{index}]"),
            "Раздел содержит одновременно код и свободный заголовок.",
            "Der Abschnitt enthält gleichzeitig Code und Freitextüberschrift.",
            true,
        ));
    }
    let category = section_category(code.as_deref(), title.as_deref());
    if category.is_none() {
        warnings.push(issue(
            "unsupported_section_category",
            &format!("/MP/S[{index}]"),
            "Раздел BMP нельзя без потерь сопоставить с одной из трёх категорий GMED.",
            "Der BMP-Abschnitt kann keiner der drei GMED-Kategorien verlustfrei zugeordnet werden.",
            true,
        ));
    }
    BmpSectionView {
        index,
        code,
        title,
        category: category.map(str::to_string),
        medications: Vec::new(),
    }
}

fn parse_medication(attrs: BTreeMap<String, String>, index: usize) -> BmpMedicationView {
    let path = format!("/MP/S/M[{index}]");
    let mut blocks = Vec::new();
    let allowed = [
        "p", "a", "f", "fd", "m", "d", "v", "h", "t", "wo", "du", "dud", "i", "r", "x",
    ];
    for key in attrs.keys().filter(|key| !allowed.contains(&key.as_str())) {
        blocks.push(issue(
            "unknown_attribute",
            &format!("{path}/@{key}"),
            "Неизвестный атрибут лекарства нельзя отбросить без подтверждения.",
            "Ein unbekanntes Medikamentenattribut darf nicht unbeachtet verworfen werden.",
            true,
        ));
    }
    let pzn_raw = attrs.get("p").cloned().filter(|value| !value.is_empty());
    let pzn_number = pzn_raw
        .as_deref()
        .and_then(|value| value.parse::<u32>().ok());
    if pzn_raw.is_some() && pzn_number.is_none_or(|number| number == 0 || number > 99_999_999) {
        blocks.push(issue(
            "invalid_pzn",
            &format!("{path}/@p"),
            "PZN должен быть числом от 1 до 99999999.",
            "Die PZN muss eine Zahl von 1 bis 99999999 sein.",
            true,
        ));
    }
    let pzn = pzn_number
        .filter(|number| (1..=99_999_999).contains(number))
        .map(|number| format!("{number:08}"))
        .or(pzn_raw);
    let form = code_or_free(&attrs, "f", "fd", "form", &path, &mut blocks);
    let unit = code_or_free(&attrs, "du", "dud", "unit", &path, &mut blocks);
    let structured = ["m", "d", "v", "h"]
        .iter()
        .any(|key| attrs.contains_key(*key));
    if attrs.contains_key("t") {
        blocks.push(issue(
            "free_text_dose_not_supported",
            &format!("{path}/@t"),
            "Свободная схема дозирования пока не имеет точного поля хранения.",
            "Für die freie Dosieranweisung gibt es noch kein verlustfreies Speicherfeld.",
            true,
        ));
    }
    if attrs.contains_key("t") && structured {
        blocks.push(issue(
            "dose_conflict",
            &path,
            "Свободная и структурированная дозировка взаимоисключающие.",
            "Freie und strukturierte Dosierung schließen einander aus.",
            true,
        ));
    }
    let weekly_day = attrs.get("wo").and_then(|value| value.parse::<u8>().ok());
    if attrs.contains_key("wo") {
        blocks.push(issue(
            "weekly_dose_not_supported",
            &format!("{path}/@wo"),
            "Еженедельная схема BMP 2.8 пока не имеет точного поля хранения.",
            "Für die wöchentliche BMP-2.8-Dosierung gibt es noch kein verlustfreies Speicherfeld.",
            true,
        ));
        if weekly_day.is_none_or(|day| !(1..=7).contains(&day)) || !structured {
            blocks.push(issue(
                "invalid_weekly_dose",
                &path,
                "День недели требует значение 1–7 и структурированную дозу.",
                "Der Wochentag erfordert einen Wert von 1–7 und eine strukturierte Dosis.",
                true,
            ));
        }
    }
    if attrs.contains_key("wo") && attrs.contains_key("x") {
        blocks.push(issue(
            "weekly_additional_text_conflict",
            &path,
            "Еженедельная доза и дополнительный текст взаимоисключающие в BMP 2.8.",
            "Wöchentliche Dosierung und Zusatztext schließen einander in BMP 2.8 aus.",
            true,
        ));
    }
    for key in ["m", "d", "v", "h"] {
        if attrs.get(key).is_some_and(|value| !valid_dose_slot(value)) {
            blocks.push(issue(
                "invalid_dose_slot",
                &format!("{path}/@{key}"),
                "Значение дозы не соответствует профилю BMP 2.8.",
                "Der Dosiswert entspricht nicht dem BMP-2.8-Profil.",
                true,
            ));
        }
    }
    BmpMedicationView {
        index,
        pzn,
        trade_name: attrs
            .get("a")
            .cloned()
            .filter(|value| !value.trim().is_empty()),
        substances: Vec::new(),
        form,
        dose: BmpDoseView {
            morning: attrs.get("m").cloned(),
            noon: attrs.get("d").cloned(),
            evening: attrs.get("v").cloned(),
            night: attrs.get("h").cloned(),
            free_text: attrs.get("t").cloned(),
            weekly_day,
        },
        unit,
        instructions: attrs.get("i").cloned(),
        reason: attrs.get("r").cloned(),
        additional_text: attrs.get("x").cloned(),
        importable: false,
        blocking_reasons: blocks,
    }
}

fn code_or_free(
    attrs: &BTreeMap<String, String>,
    code_key: &str,
    free_key: &str,
    kind: &str,
    path: &str,
    blocks: &mut Vec<BmpIssue>,
) -> Option<BmpCodeOrTextView> {
    match (attrs.get(code_key), attrs.get(free_key)) {
        (Some(_), Some(_)) => {
            blocks.push(issue(
                &format!("{kind}_conflict"),
                path,
                "Код и свободное значение взаимоисключающие.",
                "Code und Freitextwert schließen einander aus.",
                true,
            ));
            None
        }
        (Some(value), None) => {
            blocks.push(issue(
                &format!("coded_{kind}_not_resolved"),
                &format!("{path}/@{code_key}"),
                "Код не импортируется без актуального официального справочника.",
                "Der Code wird ohne aktuelles offizielles Verzeichnis nicht importiert.",
                true,
            ));
            Some(BmpCodeOrTextView {
                kind: "code".to_string(),
                value: value.clone(),
            })
        }
        (None, Some(value)) => Some(BmpCodeOrTextView {
            kind: "free_text".to_string(),
            value: value.clone(),
        }),
        (None, None) => None,
    }
}

fn parse_substance(attrs: BTreeMap<String, String>, medication: &mut BmpMedicationView) {
    let path = format!(
        "/MP/S/M[{}]/W[{}]",
        medication.index,
        medication.substances.len()
    );
    for key in attrs
        .keys()
        .filter(|key| !matches!(key.as_str(), "w" | "s"))
    {
        medication.blocking_reasons.push(issue(
            "unknown_attribute",
            &format!("{path}/@{key}"),
            "Неизвестный атрибут действующего вещества блокирует импорт.",
            "Ein unbekanntes Wirkstoffattribut blockiert den Import.",
            true,
        ));
    }
    let Some(name) = attrs
        .get("w")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        medication.blocking_reasons.push(issue(
            "missing_substance",
            &path,
            "Wirkstoff отсутствует; Handelsname не используется как замена.",
            "Der Wirkstoff fehlt; der Handelsname wird nicht als Ersatz verwendet.",
            true,
        ));
        return;
    };
    medication.substances.push(BmpSubstanceView {
        name: name.to_string(),
        strength: attrs
            .get("s")
            .cloned()
            .filter(|value| !value.trim().is_empty()),
    });
}

fn finalize_medication(state: &mut ParserState) -> Result<(), BmpImportError> {
    let mut medication = state.current_medication.take().ok_or_else(|| {
        BmpImportError::InvalidCarrier("closing M without an open medication".to_string())
    })?;
    if medication.substances.is_empty() {
        medication.blocking_reasons.push(issue(
            "unresolved_substance",
            &format!("/MP/S/M[{}]", medication.index),
            "В BMP нет явного Wirkstoff; PZN/Handelsname не разрешаются и не подменяют его.",
            "Im BMP fehlt ein expliziter Wirkstoff; PZN/Handelsname werden nicht aufgelöst und ersetzen ihn nicht.",
            true,
        ));
    } else if medication.substances.len() > 1 {
        medication.blocking_reasons.push(issue(
            "multiple_substances_not_lossless",
            &format!("/MP/S/M[{}]", medication.index),
            "Несколько Wirkstoff нельзя без потерь сохранить в текущей одиночной модели.",
            "Mehrere Wirkstoffe können im aktuellen Einzelwirkstoffmodell nicht verlustfrei gespeichert werden.",
            true,
        ));
    }
    if state
        .current_section
        .as_ref()
        .and_then(|section| section.category.as_ref())
        .is_none()
    {
        medication.blocking_reasons.push(issue(
            "unsupported_section_category",
            &format!("/MP/S/M[{}]", medication.index),
            "Категория раздела не поддерживается моделью GMED.",
            "Die Abschnittskategorie wird vom GMED-Modell nicht unterstützt.",
            true,
        ));
    }
    medication.importable = !medication
        .blocking_reasons
        .iter()
        .any(|reason| reason.blocking);
    state
        .current_section
        .as_mut()
        .ok_or_else(|| BmpImportError::InvalidCarrier("M outside S".to_string()))?
        .medications
        .push(medication);
    Ok(())
}

fn finalize_section(state: &mut ParserState) -> Result<(), BmpImportError> {
    if state.current_medication.is_some() {
        return Err(BmpImportError::InvalidCarrier(
            "section closed before medication".to_string(),
        ));
    }
    let section = state
        .current_section
        .take()
        .ok_or_else(|| BmpImportError::InvalidCarrier("closing S without section".to_string()))?;
    state.sections.push(section);
    Ok(())
}

fn xml_name(raw: &[u8]) -> Result<String, BmpImportError> {
    let name = str::from_utf8(raw)
        .map_err(|_| BmpImportError::InvalidCarrier("non-UTF-8 element name".to_string()))?;
    if name.contains(':') || name.is_empty() {
        return Err(BmpImportError::InvalidCarrier(
            "namespaced or empty element names are not accepted".to_string(),
        ));
    }
    Ok(name.to_string())
}

fn xml_attributes(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> Result<BTreeMap<String, String>, BmpImportError> {
    let mut result = BTreeMap::new();
    for attribute in event.attributes().with_checks(true) {
        let attribute =
            attribute.map_err(|error| BmpImportError::InvalidCarrier(error.to_string()))?;
        let key = xml_name(attribute.key.as_ref())?;
        let value = attribute
            .decoded_and_normalized_value(XmlVersion::default(), reader.decoder())
            .map_err(|error| BmpImportError::InvalidCarrier(error.to_string()))?
            .into_owned();
        if value.chars().count() > 256 {
            return Err(BmpImportError::InvalidCarrier(format!(
                "attribute {key} exceeds 256 characters"
            )));
        }
        if result.insert(key.clone(), value).is_some() {
            return Err(BmpImportError::InvalidCarrier(format!(
                "duplicate attribute {key}"
            )));
        }
    }
    Ok(result)
}

fn current_path(state: &ParserState, name: &str) -> String {
    let mut parts = state.stack.clone();
    parts.push(name.to_string());
    format!("/{}", parts.join("/"))
}

fn warn_unknown_attributes(
    attrs: &BTreeMap<String, String>,
    allowed: &[&str],
    path: &str,
    warnings: &mut Vec<BmpIssue>,
) {
    for key in attrs.keys().filter(|key| !allowed.contains(&key.as_str())) {
        warnings.push(issue(
            "unknown_attribute",
            &format!("{path}/@{key}"),
            "Неизвестный атрибут BMP нельзя отбросить без подтверждения.",
            "Ein unbekanntes BMP-Attribut darf nicht unbeachtet verworfen werden.",
            true,
        ));
    }
}

fn required_attr(
    attrs: &BTreeMap<String, String>,
    key: &str,
    path: &str,
) -> Result<String, BmpImportError> {
    attrs
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| BmpImportError::InvalidCarrier(format!("missing {path}/@{key}")))
}

fn bounded_required(
    attrs: &BTreeMap<String, String>,
    key: &str,
    max_chars: usize,
    path: &str,
) -> Result<String, BmpImportError> {
    let value = required_attr(attrs, key, path)?;
    if value.chars().count() > max_chars {
        return Err(BmpImportError::InvalidCarrier(format!(
            "{path}/@{key} exceeds {max_chars} characters"
        )));
    }
    Ok(value)
}

fn bounded_optional(
    attrs: &BTreeMap<String, String>,
    key: &str,
    max_chars: usize,
    path: &str,
) -> Result<Option<String>, BmpImportError> {
    let Some(value) = attrs
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if value.chars().count() > max_chars {
        return Err(BmpImportError::InvalidCarrier(format!(
            "{path}/@{key} exceeds {max_chars} characters"
        )));
    }
    Ok(Some(value))
}

fn optional_u8(
    attrs: &BTreeMap<String, String>,
    key: &str,
    min: u8,
    max: u8,
    path: &str,
) -> Result<Option<u8>, BmpImportError> {
    let Some(value) = attrs.get(key) else {
        return Ok(None);
    };
    let number = value
        .parse::<u8>()
        .map_err(|_| BmpImportError::InvalidCarrier(format!("invalid {path}/@{key} number")))?;
    if !(min..=max).contains(&number) {
        return Err(BmpImportError::InvalidCarrier(format!(
            "{path}/@{key} is out of range"
        )));
    }
    Ok(Some(number))
}

fn compact_birth_date_display(raw: &str) -> String {
    format!("{}-{}-{}", &raw[0..4], &raw[4..6], &raw[6..8])
}

fn valid_dose_slot(value: &str) -> bool {
    if matches!(value, "1/8" | "1/2" | "2/3" | "1/3" | "1/4" | "3/4") {
        return true;
    }
    if value.bytes().all(|byte| byte.is_ascii_digit()) {
        return !value.starts_with('0')
            && value
                .parse::<u16>()
                .is_ok_and(|number| (1..=9_999).contains(&number));
    }
    let Some((integer, fraction)) = value.split_once(',') else {
        return false;
    };
    !integer.is_empty()
        && integer.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.len() <= 2
        && !fraction.is_empty()
        && fraction.bytes().all(|byte| byte.is_ascii_digit())
        && integer.parse::<u16>().is_ok_and(|number| number <= 9_999)
}

fn section_category(code: Option<&str>, title: Option<&str>) -> Option<&'static str> {
    match code {
        Some("411" | "423") => return Some("besondere"),
        Some("412") => return Some("dauer"),
        Some("418") => return Some("selbst"),
        Some(_) => return None,
        None => {}
    }
    let normalized = title.map(normalize_text);
    match normalized.as_deref() {
        None | Some("") | Some("dauermedikation") => Some("dauer"),
        Some("bedarfsmedikation") | Some("zu besonderen zeiten anzuwendende medikamente") => {
            Some("besondere")
        }
        Some("selbstmedikation") => Some("selbst"),
        Some(_) => None,
    }
}

fn issue(code: &str, path: &str, message_ru: &str, message_de: &str, blocking: bool) -> BmpIssue {
    BmpIssue {
        code: code.to_string(),
        path: path.to_string(),
        message_ru: message_ru.to_string(),
        message_de: message_de.to_string(),
        blocking,
    }
}

async fn load_patient_identity(
    pool: &DbPool,
    patient_id: Uuid,
) -> Result<PatientIdentity, BmpImportError> {
    let row = sqlx::query("SELECT first_name, last_name, birth_date FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_optional(pool)
        .await?
        .ok_or(BmpImportError::PatientNotFound)?;
    Ok(PatientIdentity {
        given_name: row.try_get("first_name")?,
        family_name: row.try_get("last_name")?,
        birth_date: row.try_get("birth_date")?,
    })
}

async fn load_current_medication_snapshot(
    pool: &DbPool,
    patient_id: Uuid,
) -> Result<(usize, Value), BmpImportError> {
    let row = sqlx::query(
        r#"SELECT COUNT(*)::BIGINT AS count,
                  COALESCE(jsonb_agg(
                    to_jsonb(pm) - 'patient_id' - 'source_raw_text'
                    ORDER BY pm.sort_order, pm.created_at, pm.id
                  ), '[]'::jsonb) AS snapshot
           FROM patient_medications pm
           WHERE pm.patient_id = $1 AND pm.superseded_at IS NULL"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await?;
    let count: i64 = row.try_get("count")?;
    Ok((count.max(0) as usize, row.try_get("snapshot")?))
}

async fn load_current_medication_snapshot_tx(
    tx: &mut Transaction<'_, Postgres>,
    patient_id: Uuid,
) -> Result<(usize, Value), BmpImportError> {
    let rows = sqlx::query(
        r#"SELECT to_jsonb(pm) - 'patient_id' - 'source_raw_text' AS snapshot
           FROM patient_medications pm
           WHERE pm.patient_id = $1 AND pm.superseded_at IS NULL
           ORDER BY pm.sort_order, pm.created_at, pm.id
           FOR UPDATE"#,
    )
    .bind(patient_id)
    .fetch_all(&mut **tx)
    .await?;
    let values = rows
        .into_iter()
        .map(|row| row.try_get::<Value, _>("snapshot"))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((values.len(), Value::Array(values)))
}

async fn load_patient_identity_tx(
    tx: &mut Transaction<'_, Postgres>,
    patient_id: Uuid,
) -> Result<PatientIdentity, BmpImportError> {
    let row = sqlx::query(
        "SELECT first_name, last_name, birth_date FROM patients WHERE id = $1 FOR SHARE",
    )
    .bind(patient_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(BmpImportError::PatientNotFound)?;
    Ok(PatientIdentity {
        given_name: row.try_get("first_name")?,
        family_name: row.try_get("last_name")?,
        birth_date: row.try_get("birth_date")?,
    })
}

fn compare_patient_identity(
    carrier: &BmpPatientView,
    patient: &PatientIdentity,
) -> BmpIdentityMatch {
    let carrier_birth = NaiveDate::parse_from_str(&carrier.birth_date, "%Y-%m-%d").ok();
    let fields = vec![
        BmpIdentityField {
            field: "given_name".to_string(),
            carrier_value: nonblank(&carrier.given_name),
            patient_value: nonblank(&patient.given_name),
            matches: normalize_text(&carrier.given_name) == normalize_text(&patient.given_name),
        },
        BmpIdentityField {
            field: "family_name".to_string(),
            carrier_value: nonblank(&carrier.family_name),
            patient_value: nonblank(&patient.family_name),
            matches: normalize_text(&carrier.family_name) == normalize_text(&patient.family_name),
        },
        BmpIdentityField {
            field: "birth_date".to_string(),
            carrier_value: Some(carrier.birth_date.clone()),
            patient_value: Some(patient.birth_date.to_string()),
            matches: carrier_birth == Some(patient.birth_date),
        },
    ];
    let profile_incomplete = fields.iter().any(|field| field.patient_value.is_none());
    let carrier_incomplete = carrier_birth.is_none()
        || fields
            .iter()
            .any(|field| field.carrier_value.as_deref().is_none_or(str::is_empty));
    let mismatch = fields.iter().any(|field| !field.matches);
    let status = if profile_incomplete {
        "profile_incomplete"
    } else if carrier_incomplete {
        "carrier_incomplete"
    } else if mismatch {
        "mismatch"
    } else {
        "matched"
    };
    let blocking_reasons = if status == "matched" {
        Vec::new()
    } else {
        vec![issue(
            "patient_identity_mismatch",
            "/MP/P",
            "Имя, фамилия и дата рождения должны точно совпадать с выбранным пациентом.",
            "Vorname, Nachname und Geburtsdatum müssen exakt mit dem gewählten Patienten übereinstimmen.",
            true,
        )]
    };
    BmpIdentityMatch {
        status: status.to_string(),
        fields,
        blocking_reasons,
    }
}

fn nonblank(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn normalize_text(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn hash_bytes(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    hex::encode(hasher.finalize())
}

fn hash_json(value: &Value) -> Result<String, BmpImportError> {
    Ok(hash_bytes(&serde_json::to_vec(value)?))
}

pub async fn confirm_import(
    pool: &DbPool,
    patient_id: Uuid,
    actor_id: Uuid,
    input: ConfirmBmpImportInput<'_>,
) -> Result<ConfirmBmpImportResult, BmpImportError> {
    if !input.staff_acknowledged {
        return Err(BmpImportError::StaffAcknowledgementRequired);
    }
    let idempotency_key = input.idempotency_key.trim();
    if !(8..=MAX_IDEMPOTENCY_KEY_CHARS).contains(&idempotency_key.chars().count())
        || !valid_sha256(input.preview_fingerprint)
    {
        return Err(BmpImportError::InvalidInput);
    }
    let parsed = parse_carrier_xml(input.carrier_xml)?;
    let idempotency_key_hash = hash_bytes(idempotency_key.as_bytes());
    let import_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *tx)
        .await?;
    advisory_lock(
        &mut tx,
        &format!("bmp-idempotency:{actor_id}:{idempotency_key_hash}"),
    )
    .await?;
    advisory_lock(&mut tx, &format!("bmp-patient:{patient_id}")).await?;

    if let Some(existing) = load_existing_import(&mut tx, actor_id, &idempotency_key_hash).await? {
        if existing.patient_id != patient_id
            || existing.carrier_sha256 != parsed.carrier_sha256
            || existing.preview_fingerprint != input.preview_fingerprint
        {
            return Err(BmpImportError::IdempotencyConflict);
        }
        tx.rollback().await?;
        return Ok(ConfirmBmpImportResult {
            response: existing.into_response(true),
            created: false,
        });
    }

    let retention_years = load_clinical_retention_years_tx(&mut tx).await?;
    let patient = load_patient_identity_tx(&mut tx, patient_id).await?;
    let (superseded_count, old_snapshot) =
        load_current_medication_snapshot_tx(&mut tx, patient_id).await?;
    let preview = assemble_preview(parsed.clone(), patient, superseded_count, &old_snapshot)?;
    if preview.preview_fingerprint != input.preview_fingerprint {
        return Err(BmpImportError::StalePreview);
    }
    if preview.identity_match.status != "matched" {
        return Err(BmpImportError::IdentityMismatch);
    }
    if !preview.permissions.can_confirm {
        return Err(BmpImportError::BlockingContent);
    }

    sqlx::query(
        "UPDATE patient_medications SET superseded_at = now() WHERE patient_id = $1 AND superseded_at IS NULL",
    )
    .bind(patient_id)
    .execute(&mut *tx)
    .await?;

    let mut medication_ids = Vec::with_capacity(preview.summary.medications_total);
    for section in &preview.sections {
        let category = section
            .category
            .as_deref()
            .ok_or(BmpImportError::BlockingContent)?;
        for medication in &section.medications {
            if !medication.importable || medication.substances.len() != 1 {
                return Err(BmpImportError::BlockingContent);
            }
            let substance = &medication.substances[0];
            let medication_id = Uuid::new_v4();
            let source_identifiers = json!({
                "source": "kbv_bmp_carrier",
                "bmp_import_id": import_id,
                "bmp_plan_id": preview.plan.instance_id,
                "bmp_version": preview.plan.version,
                "bmp_locale": preview.plan.locale,
                "bmp_section_index": section.index,
                "bmp_section_code": section.code,
                "bmp_section_title": section.title,
                "bmp_medication_index": medication.index,
                "pzn": medication.pzn,
            });
            let regimen_fingerprint = hash_json(&json!({
                "category": category,
                "wirkstoff": substance.name,
                "handelsname": medication.trade_name,
                "staerke": substance.strength,
                "form": medication.form,
                "dose": medication.dose,
                "unit": medication.unit,
                "instructions": medication.instructions,
                "reason": medication.reason,
                "additional_text": medication.additional_text,
            }))?;
            sqlx::query(
                r#"INSERT INTO patient_medications (
                       id, patient_id, category, wirkstoff, handelsname, staerke, form,
                       dose_morgens, dose_mittags, dose_abends, dose_nachts, einheit,
                       hinweis, grund, status, sonstige_vermerke, on_hold, sort_order,
                       regimen_fingerprint, source_country, source_date, source_page,
                       source_identifiers, source_field_confidence
                   ) VALUES (
                       $1, $2, $3, $4, $5, $6, $7,
                       $8, $9, $10, $11, $12,
                       $13, $14, 'aktiv', $15, false, $16,
                       $17, 'DE', $18, $19,
                       $20, '{}'::jsonb
                   )"#,
            )
            .bind(medication_id)
            .bind(patient_id)
            .bind(category)
            .bind(substance.name.trim())
            .bind(medication.trade_name.as_deref().unwrap_or(""))
            .bind(substance.strength.as_deref())
            .bind(free_value(&medication.form))
            .bind(medication.dose.morning.as_deref())
            .bind(medication.dose.noon.as_deref())
            .bind(medication.dose.evening.as_deref())
            .bind(medication.dose.night.as_deref())
            .bind(free_value(&medication.unit))
            .bind(medication.instructions.as_deref())
            .bind(medication.reason.as_deref())
            .bind(medication.additional_text.as_deref())
            .bind(medication.index as i32)
            .bind(regimen_fingerprint)
            .bind(parsed.printed_at.date())
            .bind(preview.plan.page_number.map(i32::from))
            .bind(source_identifiers)
            .execute(&mut *tx)
            .await?;
            medication_ids.push(medication_id);
        }
    }

    let (_, new_snapshot) = load_current_medication_snapshot_tx(&mut tx, patient_id).await?;
    sqlx::query(
        r#"INSERT INTO patient_clinical_versions
              (patient_id, changed_by, section, old_value, new_value)
           VALUES ($1, $2, 'medications', $3, $4)"#,
    )
    .bind(patient_id)
    .bind(actor_id)
    .bind(old_snapshot)
    .bind(new_snapshot)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE patients
           SET last_clinical_update_at = now(),
               clinical_retention_until = GREATEST(
                   COALESCE(clinical_retention_until, now()),
                   now() + ($2 * interval '1 year')
               )
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .bind(retention_years)
    .execute(&mut *tx)
    .await?;

    let identity_snapshot = json!({
        "status": preview.identity_match.status,
        "fields": preview.identity_match.fields,
    });
    let plan_snapshot = json!({
        "plan": preview.plan,
        "patient": preview.patient,
        "issuer": preview.issuer,
        "sections": preview.sections,
        "warnings": preview.warnings,
    });
    let confirmed_at: chrono::DateTime<Utc> = sqlx::query_scalar(
        r#"INSERT INTO patient_bmp_imports (
               id, patient_id, plan_instance_id, bmp_version, locale, parser_version,
               carrier_sha256, preview_fingerprint, strategy, status, source_printed_at,
               identity_snapshot, plan_snapshot, medication_ids, imported_count,
               superseded_count, idempotency_key_hash, confirmed_by
           ) VALUES (
               $1, $2, $3, '028', 'de-DE', 'gmed-bmp-import-v1',
               $4, $5, 'replace_current', 'confirmed', $6,
               $7, $8, $9, $10, $11, $12, $13
           ) RETURNING confirmed_at"#,
    )
    .bind(import_id)
    .bind(patient_id)
    .bind(&parsed.plan.instance_id)
    .bind(&parsed.carrier_sha256)
    .bind(input.preview_fingerprint)
    .bind(parsed.printed_at)
    .bind(identity_snapshot)
    .bind(plan_snapshot)
    .bind(&medication_ids)
    .bind(medication_ids.len() as i32)
    .bind(superseded_count as i32)
    .bind(idempotency_key_hash)
    .bind(actor_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(ConfirmBmpImportResult {
        response: BmpImportConfirmResponse {
            mode: MODE,
            import_id,
            status: "confirmed",
            strategy: "replace_current",
            plan_instance_id: parsed.plan.instance_id,
            preview_fingerprint: input.preview_fingerprint.to_string(),
            medication_ids,
            imported_medications: preview.summary.medications_total,
            superseded_medications: superseded_count,
            idempotent_replay: false,
            confirmed_at: confirmed_at.to_rfc3339(),
            permissions: BmpPermissions {
                can_preview: true,
                can_confirm: true,
            },
        },
        created: true,
    })
}

#[derive(Debug)]
struct ExistingImport {
    id: Uuid,
    patient_id: Uuid,
    plan_instance_id: String,
    carrier_sha256: String,
    preview_fingerprint: String,
    medication_ids: Vec<Uuid>,
    imported_count: i32,
    superseded_count: i32,
    confirmed_at: chrono::DateTime<Utc>,
}

impl ExistingImport {
    fn into_response(self, idempotent_replay: bool) -> BmpImportConfirmResponse {
        BmpImportConfirmResponse {
            mode: MODE,
            import_id: self.id,
            status: "confirmed",
            strategy: "replace_current",
            plan_instance_id: self.plan_instance_id,
            preview_fingerprint: self.preview_fingerprint,
            medication_ids: self.medication_ids,
            imported_medications: self.imported_count.max(0) as usize,
            superseded_medications: self.superseded_count.max(0) as usize,
            idempotent_replay,
            confirmed_at: self.confirmed_at.to_rfc3339(),
            permissions: BmpPermissions {
                can_preview: true,
                can_confirm: true,
            },
        }
    }
}

async fn load_existing_import(
    tx: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    idempotency_key_hash: &str,
) -> Result<Option<ExistingImport>, BmpImportError> {
    let row = sqlx::query(
        r#"SELECT id, patient_id, plan_instance_id, carrier_sha256, preview_fingerprint,
                  medication_ids, imported_count, superseded_count, confirmed_at
           FROM patient_bmp_imports
           WHERE confirmed_by = $1 AND idempotency_key_hash = $2"#,
    )
    .bind(actor_id)
    .bind(idempotency_key_hash)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok(ExistingImport {
            id: row.try_get("id")?,
            patient_id: row.try_get("patient_id")?,
            plan_instance_id: row.try_get("plan_instance_id")?,
            carrier_sha256: row.try_get("carrier_sha256")?,
            preview_fingerprint: row.try_get("preview_fingerprint")?,
            medication_ids: row.try_get("medication_ids")?,
            imported_count: row.try_get("imported_count")?,
            superseded_count: row.try_get("superseded_count")?,
            confirmed_at: row.try_get("confirmed_at")?,
        })
    })
    .transpose()
}

async fn advisory_lock(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
) -> Result<(), BmpImportError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn load_clinical_retention_years_tx(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<i64, BmpImportError> {
    let value = sqlx::query_scalar::<_, String>(
        "SELECT value::TEXT FROM system_settings WHERE key = 'clinical_case_retention_years'",
    )
    .fetch_optional(&mut **tx)
    .await?;
    Ok(value
        .as_deref()
        .map(|value| value.trim_matches('"'))
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(30)
        .max(1))
}

fn free_value(value: &Option<BmpCodeOrTextView>) -> Option<&str> {
    value
        .as_ref()
        .filter(|value| value.kind == "free_text")
        .map(|value| value.value.as_str())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    const INSTANCE_ID: &str = "0123456789ABCDEF0123456789ABCDEF";

    fn carrier(patient_birth: &str, medication: &str) -> String {
        format!(
            r#"<MP v="028" U="{INSTANCE_ID}" l="de-DE"><P g="Erika" f="Mustermann" b="{patient_birth}" s="W"/><A n="Praxis Beispiel" t="2026-08-26T10:15:30"/><S c="412">{medication}</S></MP>"#
        )
    }

    fn valid_medication() -> &'static str {
        r#"<M p="12345678" a="Ibu Beispiel" fd="Tablette" m="1" d="1/2" dud="Stück" i="mit Wasser" r="Dokumentierter Grund"><W w="Ibuprofen" s="400 mg"/></M>"#
    }

    fn patient() -> PatientIdentity {
        PatientIdentity {
            given_name: "Erika".to_string(),
            family_name: "Mustermann".to_string(),
            birth_date: NaiveDate::from_ymd_opt(1980, 1, 2).expect("date"),
        }
    }

    #[test]
    fn parses_supported_v28_carrier_without_inference() {
        let parsed = parse_carrier_xml(&carrier("19800102", valid_medication())).expect("parse");
        assert_eq!(parsed.plan.version, "028");
        assert_eq!(parsed.plan.locale, "de-DE");
        assert_eq!(parsed.plan.printed_at, "2026-08-26T10:15:30");
        assert_eq!(parsed.sections.len(), 1);
        let medication = &parsed.sections[0].medications[0];
        assert!(medication.importable);
        assert_eq!(medication.substances[0].name, "Ibuprofen");
        assert_eq!(medication.trade_name.as_deref(), Some("Ibu Beispiel"));
    }

    #[test]
    fn partial_birth_date_is_carrier_incomplete_and_never_panics() {
        let parsed = parse_carrier_xml(&carrier("19800000", valid_medication())).expect("parse");
        let preview = assemble_preview(parsed, patient(), 0, &json!([])).expect("preview");
        assert_eq!(preview.identity_match.status, "carrier_incomplete");
        assert!(!preview.permissions.can_confirm);
    }

    #[test]
    fn lowercase_plan_instance_id_is_rejected() {
        let xml = carrier("19800102", valid_medication())
            .replace(INSTANCE_ID, "0123456789abcdef0123456789abcdef");
        assert!(matches!(
            parse_carrier_xml(&xml),
            Err(BmpImportError::InvalidCarrier(_))
        ));
    }

    #[test]
    fn pzn_or_trade_name_without_explicit_substance_is_blocked() {
        let parsed = parse_carrier_xml(&carrier(
            "19800102",
            r#"<M p="12345678" a="Unknown Product" fd="Tablette" m="1"/>"#,
        ))
        .expect("parse");
        let medication = &parsed.sections[0].medications[0];
        assert!(!medication.importable);
        assert!(
            medication
                .blocking_reasons
                .iter()
                .any(|reason| reason.code == "unresolved_substance")
        );
        assert!(medication.substances.is_empty());
    }

    #[test]
    fn weekly_and_free_text_dose_are_blocked_until_lossless_storage_exists() {
        let weekly = parse_carrier_xml(&carrier(
            "19800102",
            r#"<M a="Weekly" fd="Tablette" m="1" wo="1"><W w="Methotrexat" s="10 mg"/></M>"#,
        ))
        .expect("parse");
        assert!(
            weekly.sections[0].medications[0]
                .blocking_reasons
                .iter()
                .any(|reason| reason.code == "weekly_dose_not_supported")
        );
        let free = parse_carrier_xml(&carrier(
            "19800102",
            r#"<M a="Free" fd="Tablette" t="nach ärztlicher Anweisung"><W w="Beispielstoff"/></M>"#,
        ))
        .expect("parse");
        assert!(
            free.sections[0].medications[0]
                .blocking_reasons
                .iter()
                .any(|reason| reason.code == "free_text_dose_not_supported")
        );
    }

    #[test]
    fn dtd_declaration_and_entities_are_rejected() {
        let xml = format!(
            r#"<!DOCTYPE MP [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><MP v="028" U="{INSTANCE_ID}" l="de-DE"><P g="&xxe;" f="Mustermann" b="19800102"/><A n="Praxis" t="2026-08-26T10:15:30"/></MP>"#
        );
        assert!(matches!(
            parse_carrier_xml(&xml),
            Err(BmpImportError::InvalidCarrier(_))
        ));
    }

    #[test]
    fn unknown_attributes_are_visible_and_block_confirmation() {
        let xml = carrier("19800102", valid_medication())
            .replace("<S c=\"412\">", "<S c=\"412\" future=\"preserve-me\">");
        let parsed = parse_carrier_xml(&xml).expect("parse");
        assert!(
            parsed
                .warnings
                .iter()
                .any(|warning| warning.code == "unknown_attribute" && warning.blocking)
        );
        let preview = assemble_preview(parsed, patient(), 0, &json!([])).expect("preview");
        assert!(!preview.permissions.can_confirm);
    }

    #[test]
    fn only_lossless_three_category_section_mappings_are_accepted() {
        assert_eq!(section_category(Some("411"), None), Some("besondere"));
        assert_eq!(section_category(Some("412"), None), Some("dauer"));
        assert_eq!(section_category(Some("418"), None), Some("selbst"));
        assert_eq!(section_category(Some("423"), None), Some("besondere"));
        assert_eq!(section_category(Some("425"), None), None);
        assert_eq!(
            section_category(None, Some("Dauermedikation")),
            Some("dauer")
        );
        assert_eq!(section_category(None, Some("custom heading")), None);
    }

    #[test]
    fn identity_requires_exact_normalized_name_and_birth_date() {
        let parsed = parse_carrier_xml(&carrier("19800102", valid_medication())).expect("parse");
        let preview = assemble_preview(
            parsed,
            PatientIdentity {
                given_name: "Different".to_string(),
                ..patient()
            },
            0,
            &json!([]),
        )
        .expect("preview");
        assert_eq!(preview.identity_match.status, "mismatch");
        assert!(!preview.permissions.can_confirm);
    }
}
