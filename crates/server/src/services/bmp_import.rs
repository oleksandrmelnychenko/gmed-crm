//! Conservative KBV BMP 2.8 carrier XML import.
//!
//! The module parses already decoded carrier XML only. It neither decodes a
//! DataMatrix image nor resolves PZN/product identity remotely.

use std::collections::{BTreeMap, HashSet};
use std::str;

use chrono::{NaiveDate, NaiveDateTime, Utc};
use gmed_db::DbPool;
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
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
    Ok(assemble_preview(
        parsed,
        patient,
        current_medications_replaced,
        &current_snapshot,
    )?)
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
    let plan = state
        .plan
        .ok_or_else(|| BmpImportError::InvalidCarrier("missing MP metadata".to_string()))?;
    let patient = state
        .patient
        .ok_or_else(|| BmpImportError::InvalidCarrier("missing patient element".to_string()))?;
    let issuer = state
        .issuer
        .ok_or_else(|| BmpImportError::InvalidCarrier("missing issuer element".to_string()))?;
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
