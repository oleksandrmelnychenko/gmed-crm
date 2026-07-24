#![allow(clippy::result_large_err, clippy::too_many_arguments)]

use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    path::{Path as FsPath, PathBuf},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Datelike, NaiveDate, NaiveTime, Weekday};
use printpdf::{
    BuiltinFont, Color, Mm, Op, PaintMode, PdfDocument, PdfFontHandle, PdfPage, PdfWarnMsg, Point,
    Pt, Rect, Rgb, WindingOrder,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    access, audit,
    auth::middleware::AuthUser,
    file_scan::{FileScanOutcome, scan_upload_bytes},
    file_sniff::validate_upload_magic_bytes,
    pdf_text::{pdf_text_save_options, win_ansi_show_text_op},
    routes::{
        me::resolve_self_patient_id,
        patients::{
            PATIENT_LABEL_FORMATS, PatientLabelAgencySettings, PatientLabelFormat,
            load_patient_label_agency_settings, patient_label_country_code,
            patient_label_salutation,
        },
    },
    state::AppState,
};
use gmed_domain::{
    access::{
        data_sensitivity::DataSensitivity,
        policy::{self, AccessContext},
        share_status::ShareStatus,
    },
    role::Role,
};

#[cfg(windows)]
use windows::{
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
};

pub(crate) const MAX_FILE_SIZE: usize = 25 * 1024 * 1024;
const UPLOAD_DIR: &str = "uploads/documents";

fn normalize_seed_demo_storage_key(storage_key: &str) -> String {
    storage_key
        .trim_start_matches(['/', '\\'])
        .replace('\\', "/")
}

fn pdf_escape_text(value: &str) -> String {
    let ascii_text = value
        .chars()
        .map(|ch| {
            if ch.is_ascii() && !ch.is_control() {
                ch
            } else if ch.is_whitespace() {
                ' '
            } else {
                '?'
            }
        })
        .collect::<String>();

    let mut escaped = String::with_capacity(ascii_text.len());
    for ch in ascii_text.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '(' => escaped.push_str("\\("),
            ')' => escaped.push_str("\\)"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn build_seed_demo_pdf_bytes(title: &str, filename: &str, storage_key: &str) -> Vec<u8> {
    let title = pdf_escape_text(title);
    let filename = pdf_escape_text(filename);
    let storage_key = pdf_escape_text(storage_key);
    let content = format!(
        "BT\n/F1 18 Tf\n72 740 Td\n({title}) Tj\n/F1 11 Tf\n0 -28 Td\n(Demo seed document placeholder) Tj\n0 -18 Td\n(File: {filename}) Tj\n0 -18 Td\n(Storage: {storage_key}) Tj\nET\n"
    );

    let objects = vec![
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_string(),
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n".to_string(),
        "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_string(),
        format!(
            "5 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
            content.len(),
            content
        ),
    ];

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objects.len());
    for object in objects {
        offsets.push(pdf.len());
        pdf.push_str(&object);
    }

    let xref_offset = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", offsets.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for offset in &offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
        offsets.len() + 1,
        xref_offset
    ));
    pdf.into_bytes()
}

fn build_seed_demo_text_bytes(title: &str, filename: &str, storage_key: &str) -> Vec<u8> {
    format!(
        "{title}\n\nThis is a generated placeholder for a seeded demo document.\nFile: {filename}\nStorage key: {storage_key}\n"
    )
    .into_bytes()
}

fn build_seed_demo_document_bytes(
    storage_key: &str,
    mime_type: Option<&str>,
    original_filename: Option<&str>,
    auto_name: Option<&str>,
) -> Option<Vec<u8>> {
    let normalized_key = normalize_seed_demo_storage_key(storage_key);
    if !normalized_key.starts_with("demo/") {
        return None;
    }

    let fallback_filename = normalized_key
        .rsplit('/')
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("document");
    let filename = original_filename
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_filename);
    let title = auto_name
        .filter(|value| !value.trim().is_empty())
        .or_else(|| original_filename.filter(|value| !value.trim().is_empty()))
        .unwrap_or(filename);

    let is_pdf_mime = mime_type
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or(value)
                .trim()
                .eq_ignore_ascii_case("application/pdf")
        })
        .unwrap_or(false);
    let is_pdf_name = filename.to_ascii_lowercase().ends_with(".pdf")
        || normalized_key.to_ascii_lowercase().ends_with(".pdf");

    Some(if is_pdf_mime || is_pdf_name {
        build_seed_demo_pdf_bytes(title, filename, &normalized_key)
    } else {
        build_seed_demo_text_bytes(title, filename, &normalized_key)
    })
}

pub(crate) async fn read_document_storage_bytes(
    document_id: Uuid,
    storage_key: &str,
    mime_type: Option<&str>,
    original_filename: Option<&str>,
    auto_name: Option<&str>,
) -> Result<Vec<u8>, std::io::Error> {
    let path = FsPath::new(UPLOAD_DIR).join(storage_key);
    match tokio::fs::read(&path).await {
        Ok(data) => Ok(data),
        Err(error) => {
            if let Some(data) =
                build_seed_demo_document_bytes(storage_key, mime_type, original_filename, auto_name)
            {
                let normalized_key = normalize_seed_demo_storage_key(storage_key);
                tracing::warn!(
                    document_id = %document_id,
                    storage_key = %normalized_key,
                    error = %error,
                    "using generated seeded demo document placeholder"
                );
                Ok(data)
            } else {
                Err(error)
            }
        }
    }
}
const PDF_PAGE_WIDTH_MM: f32 = 210.0;
const PDF_PAGE_HEIGHT_MM: f32 = 297.0;
// DIN-5008-style asymmetric margins matching the approved document design.
const PDF_LEFT_MARGIN_MM: f32 = 25.0;
const PDF_RIGHT_MARGIN_MM: f32 = 20.0;
const PDF_TOP_MARGIN_MM: f32 = 18.0;
// Legal pages follow the approved print mockup: keep the running header rule
// visually close to the document reference while preserving body whitespace.
const PDF_LEGAL_TOP_MARGIN_MM: f32 = 36.5;
const PDF_LEGAL_HEADER_REFERENCE_Y_MM: f32 = 278.0;
const PDF_LEGAL_HEADER_RULE_Y_MM: f32 = 274.5;
const PDF_LEGAL_CONTENT_BOTTOM_MM: f32 = 34.0;
const PDF_LEGAL_FOOTER_RULE_Y_MM: f32 = 21.5;
const PDF_LEGAL_FOOTER_CONTENT_TOP_MM: f32 = 18.5;
const PDF_BOTTOM_MARGIN_MM: f32 = 16.0;
const PDF_FOOTER_GAP_MM: f32 = 6.0;
const PDF_CONTENT_WIDTH_MM: f32 = PDF_PAGE_WIDTH_MM - PDF_LEFT_MARGIN_MM - PDF_RIGHT_MARGIN_MM;
const IMAGE_OCR_UNAVAILABLE_MESSAGE: &str = "Image OCR is not available in this environment. Enable Windows OCR support or install the tesseract CLI, otherwise manual transcription is required.";
const IMAGE_OCR_NO_TEXT_MESSAGE: &str = "OCR did not detect readable text in the image.";
const IMAGE_OCR_FAILED_MESSAGE: &str = "Image OCR failed.";
const PDF_TEXT_NO_TEXT_MESSAGE: &str =
    "The PDF does not expose extractable text. Manual transcription is required.";
const PDF_TEXT_FAILED_MESSAGE: &str = "PDF text extraction failed.";
const PROVIDER_TEMPLATE_ID_PREFIX: &str = "provider_template:";
const MAX_GENERATED_MANUAL_TEXT_LEN: usize = 30_000;

#[derive(Clone, Copy)]
struct DocumentTemplateDefinition {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    art: &'static str,
    category: &'static str,
    default_auto_name: &'static str,
    default_status: &'static str,
    default_visibility: &'static str,
    mime_type: &'static str,
    file_extension: &'static str,
    is_medical: bool,
    languages: &'static [&'static str],
    text_block_keys: &'static [&'static str],
}

#[derive(Clone)]
struct ProviderDocumentTemplate {
    id: Uuid,
    provider_id: Uuid,
    provider_name: String,
    doctor_id: Option<Uuid>,
    doctor_name: Option<String>,
    label: String,
    description: Option<String>,
    art: String,
    category: String,
    default_auto_name: String,
    default_status: String,
    default_visibility: String,
    is_medical: bool,
    supported_languages: Vec<String>,
    body_de: Option<String>,
}

#[derive(Clone, Copy)]
struct TextBlockDefinition {
    key: &'static str,
    label: &'static str,
    description: &'static str,
    de: &'static str,
    en: &'static str,
    uk: &'static str,
}

#[derive(Clone)]
struct GeneratedAppointmentLine {
    date: NaiveDate,
    time_start: Option<NaiveTime>,
    time_end: Option<NaiveTime>,
    title: String,
    provider_name: Option<String>,
    doctor_name: Option<String>,
    location: Option<String>,
    category: Option<String>,
    notes: Option<String>,
}

#[derive(Clone)]
struct GeneratedMedicationLine {
    trade_name: String,
    ingredient: Option<String>,
    dose: Option<String>,
    dose_unit: Option<String>,
    schedule: Option<String>,
    dosage_form: Option<String>,
    unit: Option<String>,
    note: Option<String>,
    reason: Option<String>,
    since: Option<String>,
    expiry_date: Option<NaiveDate>,
    prescribing_doctor: Option<String>,
    medication_type: String,
    source_case_id: String,
    source_case_reason: Option<String>,
}

#[derive(Clone)]
struct MedicationCaseScope {
    id: Uuid,
    case_id: String,
    status: String,
    reason: Option<String>,
}

struct GeneratedTreatmentPlanContext {
    patient_pid: String,
    patient_name: String,
    patient_title: Option<String>,
    birth_date: Option<NaiveDate>,
    order_number: Option<String>,
    language: String,
    auto_name: String,
    title_override: Option<String>,
    introduction: Option<String>,
    closing_note: Option<String>,
    treatment_plan_note: Option<String>,
    appointments: Vec<GeneratedAppointmentLine>,
    text_blocks: Vec<String>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

struct GeneratedMedicationSummaryContext {
    patient_pid: String,
    patient_name: String,
    patient_title: Option<String>,
    birth_date: Option<NaiveDate>,
    language: String,
    auto_name: String,
    title_override: Option<String>,
    introduction: Option<String>,
    closing_note: Option<String>,
    scope_note: String,
    medications: Vec<GeneratedMedicationLine>,
    text_blocks: Vec<String>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
struct GeneratedContractLineItem {
    description: String,
    quantity: String,
    unit_price: String,
    line_gross: String,
    vat_rate: Option<String>,
    notes: Option<String>,
}

#[allow(dead_code)]
struct GeneratedFrameworkContractContext {
    patient_pid: String,
    patient_name: String,
    patient_title: Option<String>,
    birth_date: Option<NaiveDate>,
    patient_address: Option<String>,
    patient_email: Option<String>,
    patient_phone: Option<String>,
    patient_salutation: Option<String>,
    language: String,
    auto_name: String,
    title_override: Option<String>,
    introduction: Option<String>,
    closing_note: Option<String>,
    // Full-contract reproduction: agency (Auftragnehmer), signature + §2/§6 sockets, Anlagen.
    agency: AgencyContractSettings,
    party_sign_place: Option<String>,
    party_sign_date: Option<NaiveDate>,
    agency_sign_place: Option<String>,
    agency_sign_date: Option<NaiveDate>,
    effective_date: Option<NaiveDate>,
    cost_threshold: Option<String>,
    order_sequence: i64,
    extra_release_recipients: Option<String>,
    contract_number: String,
    contract_status: String,
    valid_from: Option<NaiveDate>,
    valid_to: Option<NaiveDate>,
    signed_at: Option<chrono::DateTime<chrono::Utc>>,
    order_number: Option<String>,
    quote_number: Option<String>,
    quote_valid_until: Option<NaiveDate>,
    quote_total_net: Option<String>,
    quote_total_vat: Option<String>,
    quote_total_gross: Option<String>,
    quote_notes: Option<String>,
    conditions: Vec<(String, String)>,
    line_items: Vec<GeneratedContractLineItem>,
    text_blocks: Vec<String>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

struct GeneratedVisaInvitationContext {
    patient_pid: String,
    patient_name: String,
    patient_title: Option<String>,
    patient: DocPartyBlock,
    birth_date: Option<NaiveDate>,
    language: String,
    auto_name: String,
    title_override: Option<String>,
    introduction: Option<String>,
    closing_note: Option<String>,
    agency: AgencyContractSettings,
    nationality: Option<String>,
    residence_country: Option<String>,
    passport_number: Option<String>,
    passport_valid_until: Option<NaiveDate>,
    recipient_block: Option<String>,
    clinics: Vec<ClinicInput>,
    contact_phones: Option<String>,
    sign_place: Option<String>,
    sign_date: Option<NaiveDate>,
    provider_name: Option<String>,
    doctor_name: Option<String>,
    appointment_title: Option<String>,
    appointment_date: Option<NaiveDate>,
    appointment_time: Option<NaiveTime>,
    location: Option<String>,
    order_number: Option<String>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

#[allow(dead_code)]
struct GeneratedPatientStickerContext {
    patient_pid: String,
    patient_title: Option<String>,
    patient_salutation: String,
    patient_first_name: String,
    patient_last_name: String,
    birth_date: NaiveDate,
    country_code: Option<String>,
    insurance_provider: Option<String>,
    // Manual operator-entered cost-bearer codes (KT1/KT2) + branch/cost code (e.g. "FRA").
    kt1: Option<String>,
    kt2: Option<String>,
    cost_code: Option<String>,
    agency: PatientLabelAgencySettings,
    format: PatientLabelFormat,
    auto_name: String,
    language: String,
    generated_at: chrono::DateTime<chrono::Utc>,
}

struct GeneratedProviderTemplateContext {
    patient_pid: String,
    patient_name: String,
    patient_title: Option<String>,
    birth_date: Option<NaiveDate>,
    language: String,
    auto_name: String,
    title: String,
    description: Option<String>,
    provider_name: String,
    doctor_name: Option<String>,
    appointment_title: Option<String>,
    appointment_date: Option<NaiveDate>,
    appointment_time: Option<NaiveTime>,
    location: Option<String>,
    order_number: Option<String>,
    body_paragraphs: Vec<String>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Default)]
struct DocPartyBlock {
    name: String,
    /// Academic/honorific title from the patient record (e.g. "Dr."), NOT the salutation.
    title: Option<String>,
    /// Gendered salutation for legal documents ("Herr"/"Frau"), derived from gender
    /// or supplied via a binding override. Distinct from `title`.
    salutation: Option<String>,
    /// Structured given/family name, used for "LASTNAME, First" ordering. Falls back
    /// to `name` when absent.
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<NaiveDate>,
    street: Option<String>,
    zip: Option<String>,
    city: Option<String>,
    country: Option<String>,
    email: Option<String>,
    phone: Option<String>,
}

fn german_iso_country_name(code: &str) -> Option<&'static str> {
    match code {
        "AD" => Some("Andorra"),
        "AE" => Some("Vereinigte Arabische Emirate"),
        "AF" => Some("Afghanistan"),
        "AG" => Some("Antigua und Barbuda"),
        "AI" => Some("Anguilla"),
        "AL" => Some("Albanien"),
        "AM" => Some("Armenien"),
        "AO" => Some("Angola"),
        "AQ" => Some("Antarktis"),
        "AR" => Some("Argentinien"),
        "AS" => Some("Amerikanisch-Samoa"),
        "AT" => Some("Österreich"),
        "AU" => Some("Australien"),
        "AW" => Some("Aruba"),
        "AX" => Some("Ålandinseln"),
        "AZ" => Some("Aserbaidschan"),
        "BA" => Some("Bosnien und Herzegowina"),
        "BB" => Some("Barbados"),
        "BD" => Some("Bangladesch"),
        "BE" => Some("Belgien"),
        "BF" => Some("Burkina Faso"),
        "BG" => Some("Bulgarien"),
        "BH" => Some("Bahrain"),
        "BI" => Some("Burundi"),
        "BJ" => Some("Benin"),
        "BL" => Some("St. Barthélemy"),
        "BM" => Some("Bermuda"),
        "BN" => Some("Brunei Darussalam"),
        "BO" => Some("Bolivien"),
        "BQ" => Some("Karibische Niederlande"),
        "BR" => Some("Brasilien"),
        "BS" => Some("Bahamas"),
        "BT" => Some("Bhutan"),
        "BV" => Some("Bouvetinsel"),
        "BW" => Some("Botsuana"),
        "BY" => Some("Belarus"),
        "BZ" => Some("Belize"),
        "CA" => Some("Kanada"),
        "CC" => Some("Kokosinseln"),
        "CD" => Some("Kongo-Kinshasa"),
        "CF" => Some("Zentralafrikanische Republik"),
        "CG" => Some("Kongo-Brazzaville"),
        "CH" => Some("Schweiz"),
        "CI" => Some("Côte d’Ivoire"),
        "CK" => Some("Cookinseln"),
        "CL" => Some("Chile"),
        "CM" => Some("Kamerun"),
        "CN" => Some("China"),
        "CO" => Some("Kolumbien"),
        "CR" => Some("Costa Rica"),
        "CU" => Some("Kuba"),
        "CV" => Some("Cabo Verde"),
        "CW" => Some("Curaçao"),
        "CX" => Some("Weihnachtsinsel"),
        "CY" => Some("Zypern"),
        "CZ" => Some("Tschechien"),
        "DE" => Some("Deutschland"),
        "DJ" => Some("Dschibuti"),
        "DK" => Some("Dänemark"),
        "DM" => Some("Dominica"),
        "DO" => Some("Dominikanische Republik"),
        "DZ" => Some("Algerien"),
        "EC" => Some("Ecuador"),
        "EE" => Some("Estland"),
        "EG" => Some("Ägypten"),
        "EH" => Some("Westsahara"),
        "ER" => Some("Eritrea"),
        "ES" => Some("Spanien"),
        "ET" => Some("Äthiopien"),
        "FI" => Some("Finnland"),
        "FJ" => Some("Fidschi"),
        "FK" => Some("Falklandinseln"),
        "FM" => Some("Mikronesien"),
        "FO" => Some("Färöer"),
        "FR" => Some("Frankreich"),
        "GA" => Some("Gabun"),
        "GB" => Some("Vereinigtes Königreich"),
        "GD" => Some("Grenada"),
        "GE" => Some("Georgien"),
        "GF" => Some("Französisch-Guayana"),
        "GG" => Some("Guernsey"),
        "GH" => Some("Ghana"),
        "GI" => Some("Gibraltar"),
        "GL" => Some("Grönland"),
        "GM" => Some("Gambia"),
        "GN" => Some("Guinea"),
        "GP" => Some("Guadeloupe"),
        "GQ" => Some("Äquatorialguinea"),
        "GR" => Some("Griechenland"),
        "GS" => Some("Südgeorgien und die Südlichen Sandwichinseln"),
        "GT" => Some("Guatemala"),
        "GU" => Some("Guam"),
        "GW" => Some("Guinea-Bissau"),
        "GY" => Some("Guyana"),
        "HK" => Some("Sonderverwaltungsregion Hongkong"),
        "HM" => Some("Heard und McDonaldinseln"),
        "HN" => Some("Honduras"),
        "HR" => Some("Kroatien"),
        "HT" => Some("Haiti"),
        "HU" => Some("Ungarn"),
        "ID" => Some("Indonesien"),
        "IE" => Some("Irland"),
        "IL" => Some("Israel"),
        "IM" => Some("Isle of Man"),
        "IN" => Some("Indien"),
        "IO" => Some("Britisches Territorium im Indischen Ozean"),
        "IQ" => Some("Irak"),
        "IR" => Some("Iran"),
        "IS" => Some("Island"),
        "IT" => Some("Italien"),
        "JE" => Some("Jersey"),
        "JM" => Some("Jamaika"),
        "JO" => Some("Jordanien"),
        "JP" => Some("Japan"),
        "KE" => Some("Kenia"),
        "KG" => Some("Kirgisistan"),
        "KH" => Some("Kambodscha"),
        "KI" => Some("Kiribati"),
        "KM" => Some("Komoren"),
        "KN" => Some("St. Kitts und Nevis"),
        "KP" => Some("Nordkorea"),
        "KR" => Some("Südkorea"),
        "KW" => Some("Kuwait"),
        "KY" => Some("Kaimaninseln"),
        "KZ" => Some("Kasachstan"),
        "LA" => Some("Laos"),
        "LB" => Some("Libanon"),
        "LC" => Some("St. Lucia"),
        "LI" => Some("Liechtenstein"),
        "LK" => Some("Sri Lanka"),
        "LR" => Some("Liberia"),
        "LS" => Some("Lesotho"),
        "LT" => Some("Litauen"),
        "LU" => Some("Luxemburg"),
        "LV" => Some("Lettland"),
        "LY" => Some("Libyen"),
        "MA" => Some("Marokko"),
        "MC" => Some("Monaco"),
        "MD" => Some("Republik Moldau"),
        "ME" => Some("Montenegro"),
        "MF" => Some("St. Martin"),
        "MG" => Some("Madagaskar"),
        "MH" => Some("Marshallinseln"),
        "MK" => Some("Nordmazedonien"),
        "ML" => Some("Mali"),
        "MM" => Some("Myanmar"),
        "MN" => Some("Mongolei"),
        "MO" => Some("Sonderverwaltungsregion Macau"),
        "MP" => Some("Nördliche Marianen"),
        "MQ" => Some("Martinique"),
        "MR" => Some("Mauretanien"),
        "MS" => Some("Montserrat"),
        "MT" => Some("Malta"),
        "MU" => Some("Mauritius"),
        "MV" => Some("Malediven"),
        "MW" => Some("Malawi"),
        "MX" => Some("Mexiko"),
        "MY" => Some("Malaysia"),
        "MZ" => Some("Mosambik"),
        "NA" => Some("Namibia"),
        "NC" => Some("Neukaledonien"),
        "NE" => Some("Niger"),
        "NF" => Some("Norfolkinsel"),
        "NG" => Some("Nigeria"),
        "NI" => Some("Nicaragua"),
        "NL" => Some("Niederlande"),
        "NO" => Some("Norwegen"),
        "NP" => Some("Nepal"),
        "NR" => Some("Nauru"),
        "NU" => Some("Niue"),
        "NZ" => Some("Neuseeland"),
        "OM" => Some("Oman"),
        "PA" => Some("Panama"),
        "PE" => Some("Peru"),
        "PF" => Some("Französisch-Polynesien"),
        "PG" => Some("Papua-Neuguinea"),
        "PH" => Some("Philippinen"),
        "PK" => Some("Pakistan"),
        "PL" => Some("Polen"),
        "PM" => Some("St. Pierre und Miquelon"),
        "PN" => Some("Pitcairninseln"),
        "PR" => Some("Puerto Rico"),
        "PS" => Some("Palästinensische Autonomiegebiete"),
        "PT" => Some("Portugal"),
        "PW" => Some("Palau"),
        "PY" => Some("Paraguay"),
        "QA" => Some("Katar"),
        "RE" => Some("Réunion"),
        "RO" => Some("Rumänien"),
        "RS" => Some("Serbien"),
        "RU" => Some("Russland"),
        "RW" => Some("Ruanda"),
        "SA" => Some("Saudi-Arabien"),
        "SB" => Some("Salomonen"),
        "SC" => Some("Seychellen"),
        "SD" => Some("Sudan"),
        "SE" => Some("Schweden"),
        "SG" => Some("Singapur"),
        "SH" => Some("St. Helena"),
        "SI" => Some("Slowenien"),
        "SJ" => Some("Spitzbergen und Jan Mayen"),
        "SK" => Some("Slowakei"),
        "SL" => Some("Sierra Leone"),
        "SM" => Some("San Marino"),
        "SN" => Some("Senegal"),
        "SO" => Some("Somalia"),
        "SR" => Some("Suriname"),
        "SS" => Some("Südsudan"),
        "ST" => Some("São Tomé und Príncipe"),
        "SV" => Some("El Salvador"),
        "SX" => Some("Sint Maarten"),
        "SY" => Some("Syrien"),
        "SZ" => Some("Eswatini"),
        "TC" => Some("Turks- und Caicosinseln"),
        "TD" => Some("Tschad"),
        "TF" => Some("Französische Süd- und Antarktisgebiete"),
        "TG" => Some("Togo"),
        "TH" => Some("Thailand"),
        "TJ" => Some("Tadschikistan"),
        "TK" => Some("Tokelau"),
        "TL" => Some("Timor-Leste"),
        "TM" => Some("Turkmenistan"),
        "TN" => Some("Tunesien"),
        "TO" => Some("Tonga"),
        "TR" => Some("Türkei"),
        "TT" => Some("Trinidad und Tobago"),
        "TV" => Some("Tuvalu"),
        "TW" => Some("Taiwan"),
        "TZ" => Some("Tansania"),
        "UA" => Some("Ukraine"),
        "UG" => Some("Uganda"),
        "UM" => Some("Amerikanische Überseeinseln"),
        "US" => Some("Vereinigte Staaten"),
        "UY" => Some("Uruguay"),
        "UZ" => Some("Usbekistan"),
        "VA" => Some("Vatikanstadt"),
        "VC" => Some("St. Vincent und die Grenadinen"),
        "VE" => Some("Venezuela"),
        "VG" => Some("Britische Jungferninseln"),
        "VI" => Some("Amerikanische Jungferninseln"),
        "VN" => Some("Vietnam"),
        "VU" => Some("Vanuatu"),
        "WF" => Some("Wallis und Futuna"),
        "WS" => Some("Samoa"),
        "YE" => Some("Jemen"),
        "YT" => Some("Mayotte"),
        "ZA" => Some("Südafrika"),
        "ZM" => Some("Sambia"),
        "ZW" => Some("Simbabwe"),
        _ => None,
    }
}

fn german_document_country(value: &str) -> String {
    let value = value.trim();
    let normalized = value.to_ascii_uppercase();
    if let Some(german) = german_iso_country_name(&normalized) {
        return german.to_string();
    }
    let german = match normalized.as_str() {
        "DE" | "DEU" | "GERMANY" | "DEUTSCHLAND" => "Deutschland",
        "UA" | "UKR" | "UKRAINE" => "Ukraine",
        "AT" | "AUT" | "AUSTRIA" => "Österreich",
        "CH" | "CHE" | "SWITZERLAND" => "Schweiz",
        "PL" | "POL" | "POLAND" => "Polen",
        "CZ" | "CZE" | "CZECH REPUBLIC" | "CZECHIA" => "Tschechien",
        "DK" | "DNK" | "DENMARK" => "Dänemark",
        "LV" | "LVA" | "LATVIA" => "Lettland",
        "GR" | "GRC" | "GREECE" => "Griechenland",
        "TR" | "TUR" | "TURKEY" => "Türkei",
        "AE" | "ARE" | "UAE" | "UNITED ARAB EMIRATES" => "Vereinigte Arabische Emirate",
        "SA" | "SAU" | "SAUDI ARABIA" => "Saudi-Arabien",
        "EG" | "EGY" | "EGYPT" => "Ägypten",
        "NG" | "NGA" | "NIGERIA" => "Nigeria",
        "GH" | "GHA" | "GHANA" => "Ghana",
        "BR" | "BRA" | "BRAZIL" => "Brasilien",
        "CN" | "CHN" | "CHINA" => "China",
        "RU" | "RUS" | "RUSSIA" => "Russland",
        "PK" | "PAK" | "PAKISTAN" => "Pakistan",
        "GB" | "GBR" | "UK" | "UNITED KINGDOM" => "Vereinigtes Königreich",
        "US" | "USA" | "UNITED STATES" | "UNITED STATES OF AMERICA" => "Vereinigte Staaten",
        _ => value,
    };
    german.to_string()
}

#[allow(dead_code)]
impl DocPartyBlock {
    fn address_line(&self) -> Option<String> {
        let street = self
            .street
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let city = {
            let zip = self.zip.as_deref().map(str::trim).filter(|v| !v.is_empty());
            let city = self
                .city
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty());
            match (zip, city) {
                (Some(zip), Some(city)) => Some(format!("{zip} {city}")),
                (Some(zip), None) => Some(zip.to_string()),
                (None, Some(city)) => Some(city.to_string()),
                (None, None) => None,
            }
        };
        let country = self
            .country
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(german_document_country);
        let parts: Vec<String> = [street.map(ToOwned::to_owned), city, country]
            .into_iter()
            .flatten()
            .collect();
        if parts.is_empty() {
            None
        } else {
            Some(parts.join(" | "))
        }
    }

    fn name_with_title(&self) -> String {
        match self
            .title
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(title) => format!("{title} {}", self.name).trim().to_string(),
            None => self.name.clone(),
        }
    }

    fn clean_salutation(&self) -> Option<&str> {
        self.salutation
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
    }

    /// "Herr Max Musterman" — gendered salutation prefixed to the plain name.
    /// Falls back to the bare name when no salutation is known.
    fn name_with_salutation(&self) -> String {
        match self.clean_salutation() {
            Some(salutation) => format!("{salutation} {}", self.name).trim().to_string(),
            None => self.name.clone(),
        }
    }

    /// "Musterman, Max" — surname first, comma, given name. Falls back to the
    /// combined name (splitting on the last space) when first/last are not set.
    fn name_last_comma_first(&self) -> String {
        let first = self
            .first_name
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let last = self
            .last_name
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        match (last, first) {
            (Some(last), Some(first)) => format!("{last}, {first}"),
            (Some(last), None) => last.to_string(),
            _ => {
                let trimmed = self.name.trim();
                match trimmed.rsplit_once(' ') {
                    Some((first, last)) => format!("{}, {}", last.trim(), first.trim()),
                    None => trimmed.to_string(),
                }
            }
        }
    }
}

#[derive(Clone, Default)]
#[allow(dead_code)]
struct AgencyContractSettings {
    name: String,
    /// Responsible person ("Originator" / letterhead contact).
    care_of: Option<String>,
    principal_birth_date: Option<NaiveDate>,
    address: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    website: Option<String>,
    privacy_email: Option<String>,
    sign_place: String,
    data_system_name: String,
    data_controller_statement: String,
    data_processor_notice: Option<String>,
    bank_holder: Option<String>,
    bank_name: Option<String>,
    bank_swift: Option<String>,
    bank_iban: Option<String>,
}

#[allow(dead_code)]
struct GeneratedSingleOrderContext {
    language: String,
    auto_name: String,
    title_override: Option<String>,
    patient_pid: String,
    party: DocPartyBlock,
    agency: AgencyContractSettings,
    order_number: String,
    contract_number: Option<String>,
    order_sequence: i64,
    order_date: Option<NaiveDate>,
    contract_date: Option<NaiveDate>,
    specialties: Option<String>,
    examination_purpose: Option<String>,
    treatment_purpose: Option<String>,
    order_components: Option<String>,
    period_from: Option<NaiveDate>,
    period_to: Option<NaiveDate>,
    payer: Option<DocPartyBlock>,
    quote_number: Option<String>,
    line_items: Vec<GeneratedContractLineItem>,
    total_net: Option<String>,
    total_vat: Option<String>,
    total_gross: Option<String>,
    party_sign_place: Option<String>,
    party_sign_date: Option<NaiveDate>,
    agency_sign_place: Option<String>,
    agency_sign_date: Option<NaiveDate>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

#[allow(dead_code)]
struct GeneratedCostCoverageContext {
    language: String,
    auto_name: String,
    title_override: Option<String>,
    patient: DocPartyBlock,
    payer: DocPartyBlock,
    agency: AgencyContractSettings,
    order_number: String,
    order_sequence: i64,
    order_date: Option<NaiveDate>,
    contract_date: Option<NaiveDate>,
    quote_number: Option<String>,
    line_items: Vec<GeneratedContractLineItem>,
    total_net: Option<String>,
    total_vat: Option<String>,
    total_gross: Option<String>,
    payer_sign_place: Option<String>,
    payer_sign_date: Option<NaiveDate>,
    agency_sign_place: Option<String>,
    agency_sign_date: Option<NaiveDate>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

#[allow(dead_code)]
struct GeneratedCostEstimateContext {
    language: String,
    auto_name: String,
    title_override: Option<String>,
    patient: DocPartyBlock,
    patient_pid: String,
    quote_number: Option<String>,
    estimate_date: Option<NaiveDate>,
    line_items: Vec<GeneratedContractLineItem>,
    total_range: Option<String>,
    agency: AgencyContractSettings,
    generated_at: chrono::DateTime<chrono::Utc>,
}

struct GeneratedAppointmentConfirmationContext {
    language: String,
    auto_name: String,
    title_override: Option<String>,
    doc_id: Option<String>,
    patient: DocPartyBlock,
    passport_number: Option<String>,
    passport_valid_until: Option<NaiveDate>,
    recipient_block: Option<String>,
    clinics: Vec<ClinicInput>,
    first_examination: Option<NaiveDate>,
    examination_weeks: Option<String>,
    continuation_statement: Option<String>,
    contact_phones: Option<String>,
    agency: AgencyContractSettings,
    sign_place: Option<String>,
    sign_date: Option<NaiveDate>,
    generated_at: chrono::DateTime<chrono::Utc>,
}

#[allow(dead_code)]
struct GeneratedConsentContext {
    sole_guardian: bool,
    auto_name: String,
    document_reference: String,
    child_name: Option<String>,
    child_birth_date: Option<NaiveDate>,
    child_address: Option<String>,
    guardian_name: Option<String>,
    guardian_label: Option<String>,
    guardian_birth_date: Option<NaiveDate>,
    guardian_address: Option<String>,
    guardian2_name: Option<String>,
    guardian2_label: Option<String>,
    guardian2_birth_date: Option<NaiveDate>,
    extra_release_recipients: Option<String>,
    agency: AgencyContractSettings,
    generated_at: chrono::DateTime<chrono::Utc>,
}

struct StagedDocumentDelete {
    original_path: PathBuf,
    staged_path: PathBuf,
}

struct ReplacementDocumentVersion {
    document_id: Uuid,
    version_root_document_id: Uuid,
    version_number: i32,
}

struct DocumentShareInsert<'a> {
    document_id: Uuid,
    auth_user_id: Uuid,
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
    channel: &'a str,
    requires_confirmation: bool,
    message: Option<&'a str>,
}

pub(crate) struct NewStoredDocument<'a> {
    pub(crate) document_id: Option<Uuid>,
    pub(crate) document_number: Option<&'a str>,
    pub(crate) patient_id: Option<Uuid>,
    pub(crate) lead_id: Option<Uuid>,
    pub(crate) order_id: Option<Uuid>,
    pub(crate) appointment_id: Option<Uuid>,
    pub(crate) auto_name: &'a str,
    pub(crate) original_filename: &'a str,
    pub(crate) art: &'a str,
    pub(crate) category: Option<&'a str>,
    pub(crate) status: &'a str,
    pub(crate) visibility: &'a str,
    pub(crate) is_medical: bool,
    pub(crate) mime_type: &'a str,
    pub(crate) klinik: Option<&'a str>,
    pub(crate) ursprung: Option<&'a str>,
    pub(crate) notes: Option<&'a str>,
    pub(crate) document_direction: Option<&'a str>,
    pub(crate) document_variant: Option<&'a str>,
    pub(crate) document_language: Option<&'a str>,
    pub(crate) access_category: Option<&'a str>,
    pub(crate) document_date: Option<NaiveDate>,
    pub(crate) source_person: Option<&'a str>,
    pub(crate) source_institution: Option<&'a str>,
    pub(crate) addressee_person: Option<&'a str>,
    pub(crate) addressee_institution: Option<&'a str>,
    pub(crate) financial_status: Option<&'a str>,
    pub(crate) payment_due_date: Option<NaiveDate>,
    pub(crate) payment_date: Option<NaiveDate>,
    pub(crate) payment_method: Option<&'a str>,
    pub(crate) generated_template_id: Option<&'a str>,
    pub(crate) generated_bindings: Option<&'a Value>,
    pub(crate) generated_manual_text: Option<&'a str>,
    pub(crate) version_root_document_id: Option<Uuid>,
    pub(crate) replaces_document_id: Option<Uuid>,
    pub(crate) version_number: i32,
    pub(crate) uploaded_by: Uuid,
}

#[derive(Clone, Copy)]
struct PatientUploadPreset {
    kind: &'static str,
    art: &'static str,
    category: &'static str,
    default_title: &'static str,
    is_medical: bool,
}

const DOCUMENT_TEMPLATES: &[DocumentTemplateDefinition] = &[
    DocumentTemplateDefinition {
        id: "treatment_plan",
        label: "Behandlungsplan",
        description: "Druckfertiger Behandlungsplan nach Tagen mit wiederverwendbaren Hinweisblöcken.",
        art: "treatment_plan",
        category: "treatment_plan",
        default_auto_name: "Behandlungsplan",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: true,
        languages: &["de"],
        text_block_keys: &[
            "fasting",
            "bring_documents",
            "morning_medication",
            "payment_clearance",
            "interpreter_briefing",
        ],
    },
    DocumentTemplateDefinition {
        id: "medication_summary",
        label: "Medikamentenübersicht",
        description: "Konsolidierte Medikamentenübersicht für den ausgewählten Patientenkontext.",
        art: "medication_summary",
        category: "medication_summary",
        default_auto_name: "Medikamentenübersicht",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: true,
        languages: &["de"],
        text_block_keys: &[
            "doctor_changes_only",
            "carry_updated_list",
            "temporary_medication_review",
        ],
    },
    DocumentTemplateDefinition {
        id: "framework_contract",
        label: "Rahmendienstleistungsvertrag",
        description: "Patientenseitiger Rahmendienstleistungsvertrag aus Vertragsdaten und Klauseln.",
        art: "framework_contract",
        category: "contract",
        default_auto_name: "Rahmendienstleistungsvertrag",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[
            "contract_scope_clause",
            "quote_reference_clause",
            "cost_passthrough_clause",
            "privacy_contract_clause",
        ],
    },
    DocumentTemplateDefinition {
        id: "visa_invitation_letter",
        label: "Einladungsschreiben (Visum)",
        description: "Formelles Einladungsschreiben für Botschaft oder Konsulat aus Patient- und Terminkontext.",
        art: "visa_invitation",
        category: "visa_invitation_letter",
        default_auto_name: "Einladungsschreiben (Visum)",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "patient_sticker_compact",
        label: "Patientenetikett · Kompakt 90 x 48 mm",
        description: "Kompaktes Patientenetikett mit Kontaktblock der Agentur.",
        art: "patient_sticker",
        category: "administrative",
        default_auto_name: "Patientenetikett",
        default_status: "draft",
        default_visibility: "internal",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "patient_sticker_standard",
        label: "Patientenetikett · Standard 105 x 74 mm",
        description: "Standard-Patientenetikett mit Kontaktblock der Agentur.",
        art: "patient_sticker",
        category: "administrative",
        default_auto_name: "Patientenetikett",
        default_status: "draft",
        default_visibility: "internal",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "patient_sticker_sheet",
        label: "Patientenetikett · Bogen 70 x 37 mm",
        description: "Kleines Patientenetikett im Bogenformat mit Kontaktblock der Agentur.",
        art: "patient_sticker",
        category: "administrative",
        default_auto_name: "Patientenetikett",
        default_status: "draft",
        default_visibility: "internal",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "single_order",
        label: "Einzelauftrag",
        description: "Einzelauftrag zum Rahmendienstleistungsvertrag mit Leistungsumfang und optionaler Kostenübernahme durch Dritte.",
        art: "single_order",
        category: "administrative_single_order",
        default_auto_name: "Einzelauftrag",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "order_cost_estimate",
        label: "Kostenvoranschlag zum Einzelauftrag",
        description: "Separate Anlage 1 zum Einzelauftrag mit Leistungen, Preisen, Summen, Bankverbindung und Unterschriften.",
        art: "order_cost_estimate",
        category: "finance_order_cost_estimate",
        default_auto_name: "Kostenvoranschlag zum Einzelauftrag",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "cost_coverage_declaration",
        label: "Kostenübernahmeerklärung",
        description: "Kostenübernahmeerklärung durch Dritte mit Vergütung, Kostenvoranschlag und Bankdaten der Agentur.",
        art: "cost_coverage_declaration",
        category: "finance_cost_coverage",
        default_auto_name: "Kostenübernahmeerklärung",
        default_status: "draft",
        default_visibility: "internal",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "cost_estimate",
        label: "Vorläufige Kostenkalkulation",
        description: "Unverbindlicher vorläufiger Kostenrahmen für medizinische Untersuchungen und Leistungen.",
        art: "cost_estimate",
        category: "finance_cost_estimate",
        default_auto_name: "Vorläufige Kostenkalkulation",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "appointment_confirmation",
        label: "Terminbestätigung",
        description: "Formelle Terminbestätigung mit Kliniken, Untersuchungsdaten und Ansprechpartnern.",
        art: "appointment_confirmation",
        category: "administrative_appointment_confirmation",
        default_auto_name: "Terminbestätigung",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "confidentiality_release",
        label: "Schweigepflichtsentbindung",
        description: "Schweigepflichtsentbindung für volljährige Patientinnen und Patienten.",
        art: "confidentiality_release",
        category: "consent",
        default_auto_name: "Schweigepflichtsentbindung",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "privacy_consents",
        label: "Einverständniserklärung zur Datenübermittlung",
        description: "Einverständnis zur Verarbeitung und Übermittlung personenbezogener und medizinischer Daten.",
        art: "privacy_consents",
        category: "consent",
        default_auto_name: "Einverständniserklärung zur Datenübermittlung",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "privacy_information",
        label: "Informationsblatt zum Datenschutz",
        description: "Rechtlich festes Informationsblatt zur Verarbeitung personenbezogener Daten und zu Betroffenenrechten.",
        art: "privacy_information",
        category: "consent",
        default_auto_name: "Informationsblatt zum Datenschutz",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "consent_data_release_child",
        label: "Einverständniserklärung · Kind (zwei Sorgeberechtigte)",
        description: "DSGVO-Datenübermittlung und Schweigepflichtsentbindung für ein minderjähriges Kind mit zwei Sorgeberechtigten.",
        art: "consent_data_release",
        category: "consent",
        default_auto_name: "Einverständniserklärung (Kind)",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "consent_data_release_single",
        label: "Einverständniserklärung · Alleiniges Sorgerecht",
        description: "DSGVO-Datenübermittlung und Schweigepflichtsentbindung für ein minderjähriges Kind mit alleinigem Sorgerecht.",
        art: "consent_data_release",
        category: "consent",
        default_auto_name: "Einverständniserklärung (alleiniges Sorgerecht)",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de"],
        text_block_keys: &[],
    },
];

const DOCUMENT_TEXT_BLOCKS: &[TextBlockDefinition] = &[
    TextBlockDefinition {
        key: "fasting",
        label: "Fasting required",
        description: "Use when the patient must remain fasting before diagnostics or intervention.",
        de: "Hinweis: Bitte nüchtern bleiben und vor dem Termin weder essen noch trinken, falls die Klinik keine andere Anweisung gegeben hat.",
        en: "Note: Please remain fasting before the appointment and do not eat or drink unless the clinic instructed otherwise.",
        uk: "Увага: перед візитом залишайтеся натще та не їжте і не пийте, якщо клініка не надала інших вказівок.",
    },
    TextBlockDefinition {
        key: "bring_documents",
        label: "Bring original documents",
        description: "Reminder to carry passport, prior findings and insurance/payment proofs.",
        de: "Bitte bringen Sie Reisepass, vorhandene Befunde, Medikamentenliste sowie Kostenübernahme- oder Zahlungsnachweise im Original mit.",
        en: "Please bring your passport, previous findings, medication list and any insurance approval or payment proof in original form.",
        uk: "Будь ласка, візьміть із собою паспорт, попередні висновки, список ліків та оригінали підтвердження оплати або страхового покриття.",
    },
    TextBlockDefinition {
        key: "morning_medication",
        label: "Morning medication note",
        description: "Reminder to coordinate usual medication intake before the visit.",
        de: "Falls Sie morgens regelmäßig Medikamente einnehmen, stimmen Sie die Einnahme bitte vorab mit Ihrem behandelnden Arzt oder unserem Team ab.",
        en: "If you take regular morning medication, please coordinate the intake in advance with your treating physician or our team.",
        uk: "Якщо ви постійно приймаєте ранкові ліки, будь ласка, заздалегідь узгодьте їх прийом із вашим лікарем або нашою командою.",
    },
    TextBlockDefinition {
        key: "payment_clearance",
        label: "Payment or coverage clearance",
        description: "Reminder about prepayment, insurance approval or quote confirmation.",
        de: "Vor dem Termin prüfen wir nochmals die Freigabe der Kostenübernahme oder den Eingang einer erforderlichen Vorauszahlung.",
        en: "Before the appointment we will verify coverage approval or receipt of any required prepayment once again.",
        uk: "Перед візитом ми додатково перевіримо погодження покриття витрат або надходження необхідної передоплати.",
    },
    TextBlockDefinition {
        key: "interpreter_briefing",
        label: "Interpreter coordination",
        description: "Reminder that an interpreter or coordinator will brief the patient before the visit.",
        de: "Ein Dolmetscher oder Koordinator wird Sie vor dem Termin separat briefen, falls für den Termin eine sprachliche Begleitung vorgesehen ist.",
        en: "An interpreter or coordinator will brief you separately before the appointment if language support is planned.",
        uk: "Перекладач або координатор окремо проведе для вас брифінг перед візитом, якщо для нього заплановано мовний супровід.",
    },
    TextBlockDefinition {
        key: "contract_scope_clause",
        label: "Agency scope",
        description: "Defines the agency's coordination scope under the framework contract.",
        de: "Die Agentur koordiniert Organisation, Kommunikation und administrative Vorbereitung der vereinbarten Leistungen im dokumentierten Auftragskontext.",
        en: "The agency coordinates organization, communication and administrative preparation of the agreed services in the documented order context.",
        uk: "Агенція координує організацію, комунікацію та адміністративну підготовку погоджених послуг у задокументованому контексті замовлення.",
    },
    TextBlockDefinition {
        key: "quote_reference_clause",
        label: "Quote reference",
        description: "Clarifies that concrete commercial positions are governed by the linked quote.",
        de: "Konkrete kommerzielle Positionen, Preise und Gültigkeiten richten sich nach dem jeweils verknüpften Kostenvoranschlag beziehungsweise dessen aktualisierter Version.",
        en: "Concrete commercial positions, prices and validity periods are governed by the linked quote and its latest approved revision.",
        uk: "Конкретні комерційні позиції, ціни та строки дії визначаються прив’язаним кошторисом і його актуальною погодженою версією.",
    },
    TextBlockDefinition {
        key: "cost_passthrough_clause",
        label: "Cost passthrough",
        description: "Explains external pass-through costs and reimbursement logic.",
        de: "Externe Kostenübernahmen oder Fremdleistungen werden transparent, nachvollziehbar und entsprechend der zugrunde liegenden Belege weitergegeben.",
        en: "External pass-through costs and third-party services are passed on transparently and in line with the underlying supporting documents.",
        uk: "Зовнішні витрати, що передаються далі, та сторонні послуги відображаються прозоро й відповідно до підтвердних документів.",
    },
    TextBlockDefinition {
        key: "privacy_contract_clause",
        label: "Data processing notice",
        description: "Short contractual privacy and confidentiality notice.",
        de: "Personen- und Gesundheitsdaten werden nur im erforderlichen Umfang, zweckgebunden und gemäß den jeweils geltenden Datenschutz- und Vertraulichkeitsregeln verarbeitet.",
        en: "Personal and health data are processed only to the required extent, for a defined purpose and in line with applicable privacy and confidentiality rules.",
        uk: "Персональні та медичні дані обробляються лише в необхідному обсязі, для визначеної мети та відповідно до чинних правил конфіденційності й захисту даних.",
    },
    TextBlockDefinition {
        key: "doctor_changes_only",
        label: "Changes only by physician",
        description: "Reminds the patient that medication changes require medical confirmation.",
        de: "Bitte ändern oder beenden Sie Medikamente nur nach Rücksprache mit dem behandelnden Arzt oder der Klinik.",
        en: "Please change or stop medication only after confirming this with the treating physician or clinic.",
        uk: "Будь ласка, змінюйте або припиняйте прийом ліків лише після погодження з лікуючим лікарем або клінікою.",
    },
    TextBlockDefinition {
        key: "carry_updated_list",
        label: "Carry this list",
        description: "Reminder to keep the current medication list available during visits and travel.",
        de: "Bitte führen Sie diese aktuelle Medikamentenliste zu jedem Termin sowie bei Reisen und Krankenhausaufenthalten mit sich.",
        en: "Please keep this current medication list with you for every visit, trip and hospital stay.",
        uk: "Будь ласка, майте цей актуальний список ліків із собою на кожному візиті, під час подорожей і госпіталізацій.",
    },
    TextBlockDefinition {
        key: "temporary_medication_review",
        label: "Temporary medication review",
        description: "Reminder to re-check temporary prescriptions and stop dates.",
        de: "Zeitlich begrenzte Medikamente sollten mit Arzt oder Klinik regelmäßig auf Enddatum, Nutzen und Nebenwirkungen überprüft werden.",
        en: "Temporary medication should be reviewed with the physician or clinic for stop date, benefit and side effects.",
        uk: "Тимчасові препарати слід регулярно переглядати з лікарем або клінікою щодо дати завершення, користі та побічних ефектів.",
    },
];

pub fn router() -> Router<AppState> {
    // Multipart document uploads carry the file body itself. axum's default
    // request body limit is 2 MB (see `axum::extract::Multipart`), which would
    // reject larger uploads with 413 *before* the handler's own MAX_FILE_SIZE
    // (25 MB) check ever runs. Raise the limit on just the upload routes —
    // sized to MAX_FILE_SIZE plus headroom for the remaining multipart fields
    // and boundary overhead — so files up to MAX_FILE_SIZE are accepted; every
    // other document endpoint keeps axum's conservative default.
    let upload_routes = Router::new()
        .route("/me/documents/upload", post(upload_my_document))
        .route("/documents/upload", post(upload_document))
        .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024));

    Router::new()
        .merge(upload_routes)
        .route("/me/documents/uploads", get(list_my_uploaded_documents))
        .route(
            "/me/documents/uploads/{id}/download",
            get(download_my_uploaded_document),
        )
        .route("/documents", get(list_documents))
        .route("/documents/intake-queue", get(list_document_intake_queue))
        .route("/documents/templates", get(list_document_templates))
        .route("/documents/generate", post(generate_document))
        .route("/documents/meta/staff", get(list_document_staff))
        .route("/documents/meta/categories", get(list_document_categories))
        .route("/documents/shares/bulk", post(create_bulk_document_shares))
        .route(
            "/documents/translation-requests",
            get(list_document_translation_request_queue),
        )
        .route(
            "/documents/translation-requests/{request_id}/update",
            post(update_document_translation_request),
        )
        .route("/documents/{id}", get(get_document))
        .route(
            "/documents/{id}/text-extraction",
            get(get_document_text_extraction),
        )
        .route(
            "/documents/{id}/text-extraction/run",
            post(run_document_text_extraction),
        )
        .route("/documents/{id}/versions", get(list_document_versions))
        .route("/documents/{id}/update", post(update_document))
        .route("/documents/{id}/mark-signed", post(mark_document_signed))
        .route("/documents/{id}/delete", post(delete_document_file))
        .route("/documents/{id}/download", get(download_document))
        .route(
            "/documents/{id}/translation-requests",
            get(list_document_translation_requests).post(create_document_translation_request),
        )
        .route(
            "/documents/{id}/portal-release",
            post(release_document_to_patient_portal),
        )
        .route(
            "/documents/{id}/portal-release/revoke",
            post(revoke_document_from_patient_portal),
        )
        .route(
            "/documents/{id}/shares",
            get(list_document_shares).post(create_document_share),
        )
        .route(
            "/documents/{id}/shares/{share_id}/revoke",
            post(revoke_document_share),
        )
        .route(
            "/documents/{id}/shares/{share_id}/confirm",
            post(confirm_document_share),
        )
}

#[derive(Deserialize)]
struct MarkDocumentSignedRequest {
    compliance_kind: String,
    signed_at: Option<String>,
}

fn document_satisfies_compliance_kind(
    compliance_kind: &str,
    generated_template_id: Option<&str>,
    art: &str,
) -> bool {
    let document_kind = generated_template_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| art.trim());
    let matches_document_kind =
        |allowed: &[&str]| allowed.iter().any(|candidate| document_kind == *candidate);

    match compliance_kind {
        "dsgvo" => matches_document_kind(&[
            "consent",
            "privacy_consents",
            "consent_data_release",
            "consent_data_release_child",
            "consent_data_release_single",
        ]),
        "confidentiality_release" => matches_document_kind(&["confidentiality_release"]),
        "identity" => matches_document_kind(&["identity"]),
        "framework_contract" => matches_document_kind(&["framework_contract"]),
        "other" => true,
        _ => false,
    }
}

/// Record a document as the signed evidence for a compliance requirement, and
/// atomically flip the matching flag on the linked patient's `legal_status`
/// (#13). Replaces the previous two-step dance of "upload a scan" + "separately
/// tick a compliance checkbox" with one action that leaves an evidence trail.
async fn mark_document_signed(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(document_id): Path<Uuid>,
    Json(body): Json<MarkDocumentSignedRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::ItAdmin]) {
        return resp;
    }

    let kind = body.compliance_kind.trim();
    // Which `legal_status` key this signed document satisfies, and the value to
    // set. `other` records the signature without touching any compliance flag.
    let flag: Option<(&str, Value)> = match kind {
        "dsgvo" => Some(("dsgvo_signed", Value::Bool(true))),
        "confidentiality_release" => Some(("confidentiality_release_signed", Value::Bool(true))),
        "identity" => Some(("identity_verified", Value::Bool(true))),
        "framework_contract" => Some(("contract_status", Value::String("signed".to_string()))),
        "other" => None,
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid compliance_kind"),
    };

    let signed_at: chrono::DateTime<chrono::Utc> = match body.signed_at.as_deref() {
        Some(value) if !value.trim().is_empty() => {
            match chrono::DateTime::parse_from_rfc3339(value.trim()) {
                Ok(dt) => dt.with_timezone(&chrono::Utc),
                Err(_) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid signed_at (expected RFC 3339)",
                    );
                }
            }
        }
        _ => chrono::Utc::now(),
    };

    let document = match sqlx::query(
        r#"SELECT patient_id, lead_id, generated_template_id, art, status,
                  file_deleted_at IS NOT NULL AS file_deleted
           FROM documents
           WHERE id = $1"#,
    )
    .bind(document_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(e) => {
            tracing::error!(error = %e, "load document for mark-signed");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let patient_id: Option<Uuid> = document.try_get("patient_id").ok().flatten();
    let lead_id: Option<Uuid> = document.try_get("lead_id").ok().flatten();
    let generated_template_id = document
        .try_get::<Option<String>, _>("generated_template_id")
        .ok()
        .flatten();
    let document_art = document.try_get::<String, _>("art").unwrap_or_default();
    let document_status = document.try_get::<String, _>("status").unwrap_or_default();
    let file_deleted = document.try_get::<bool, _>("file_deleted").unwrap_or(false);
    if file_deleted {
        return err(
            StatusCode::GONE,
            "Deleted documents cannot be marked as signed evidence",
        );
    }
    if document_status == "archived" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Archived documents cannot be marked as signed evidence",
        );
    }
    if let Some(patient_id) = patient_id
        && access::requires_patient_assignment(auth.role)
    {
        let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_id, document_id = %document_id, "validate document signature patient assignment");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate document access",
                )
            });
        match assigned {
            Ok(true) => {}
            Ok(false) => {
                return err(
                    StatusCode::FORBIDDEN,
                    "Patient manager is not assigned to this patient.",
                );
            }
            Err(resp) => return resp,
        }
    }

    if !document_satisfies_compliance_kind(kind, generated_template_id.as_deref(), &document_art) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document type does not satisfy the selected compliance requirement",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin mark-signed tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query(
        r#"UPDATE documents
           SET signed_at = $2,
               signed_by = $3,
               compliance_kind = $4,
               status = CASE WHEN status = 'draft' THEN 'active' ELSE status END,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(document_id)
    .bind(signed_at)
    .bind(auth.user_id)
    .bind(kind)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "record document signature");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let mut compliance_updated = false;
    if let (Some(pid), Some((key, value))) = (patient_id, flag) {
        if let Err(e) = sqlx::query(
            r#"UPDATE patients
               SET legal_status = jsonb_set(COALESCE(legal_status, '{}'::jsonb), $2::text[], $3::jsonb, true),
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(pid)
        .bind(vec![key.to_string()])
        .bind(value.to_string())
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, "update patient legal_status from signed document");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        compliance_updated = true;
    }
    if let Some(lead_id) = lead_id
        && kind == "dsgvo"
    {
        let result = sqlx::query(
            r#"UPDATE leads
               SET compliance_status = 'signed', updated_at = now()
               WHERE id = $1 AND converted_patient_id IS NULL"#,
        )
        .bind(lead_id)
        .execute(&mut *tx)
        .await;
        match result {
            Ok(result) if result.rows_affected() == 1 => {
                compliance_updated = true;
            }
            Ok(_) => {
                return err(
                    StatusCode::CONFLICT,
                    "Converted lead must use its patient context",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, lead_id = %lead_id, "update lead compliance from signed document");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "commit mark-signed tx");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "mark_document_signed",
        Some(auth.user_id),
        "document",
        Some(document_id),
        json!({
            "compliance_kind": kind,
            "patient_id": patient_id,
            "lead_id": lead_id,
        }),
    ));

    Json(json!({
        "ok": true,
        "document_id": document_id,
        "signed_at": signed_at.to_rfc3339(),
        "compliance_kind": kind,
        "patient_id": patient_id,
        "lead_id": lead_id,
        "compliance_updated": compliance_updated,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct DocumentListQuery {
    search: Option<String>,
    patient_id: Option<String>,
    lead_id: Option<String>,
    order_id: Option<String>,
    appointment_id: Option<String>,
    status: Option<String>,
    visibility: Option<String>,
    art: Option<String>,
    category: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    klinik: Option<String>,
    ursprung: Option<String>,
    document_direction: Option<String>,
    document_variant: Option<String>,
    access_category: Option<String>,
    financial_status: Option<String>,
}

fn normalized_query_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_required_uuid_query_filter(
    value: Option<&str>,
    field: &str,
) -> Result<Option<Uuid>, axum::response::Response> {
    let Some(value) = normalized_query_value(value) else {
        return Ok(None);
    };
    Uuid::parse_str(&value).map(Some).map_err(|_| {
        let message = match field {
            "patient_id" => "Invalid patient_id filter",
            "lead_id" => "Invalid lead_id filter",
            "order_id" => "Invalid order_id filter",
            "appointment_id" => "Invalid appointment_id filter",
            _ => "Invalid document filter",
        };
        err(StatusCode::BAD_REQUEST, message)
    })
}

fn parse_uuid_or_text_query_filter(value: Option<&str>) -> (Option<Uuid>, Option<String>) {
    let Some(value) = normalized_query_value(value) else {
        return (None, None);
    };
    match Uuid::parse_str(&value) {
        Ok(uuid) => (Some(uuid), None),
        Err(_) => (None, Some(value)),
    }
}

#[derive(Deserialize, Default)]
struct UpdateDocumentRequest {
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    auto_name: Option<String>,
    art: Option<String>,
    category: Option<String>,
    status: Option<String>,
    visibility: Option<String>,
    is_medical: Option<bool>,
    klinik: Option<String>,
    ursprung: Option<String>,
    notes: Option<String>,
    #[serde(default)]
    document_direction: NullableJsonField,
    #[serde(default)]
    document_variant: NullableJsonField,
    #[serde(default)]
    document_language: NullableJsonField,
    #[serde(default)]
    access_category: NullableJsonField,
    #[serde(default)]
    document_date: NullableJsonField,
    #[serde(default)]
    source_person: NullableJsonField,
    #[serde(default)]
    source_institution: NullableJsonField,
    #[serde(default)]
    addressee_person: NullableJsonField,
    #[serde(default)]
    addressee_institution: NullableJsonField,
    #[serde(default)]
    financial_status: NullableJsonField,
    #[serde(default)]
    payment_due_date: NullableJsonField,
    #[serde(default)]
    payment_date: NullableJsonField,
    #[serde(default)]
    payment_method: NullableJsonField,
}

#[derive(Deserialize)]
struct DeleteDocumentFileRequest {
    reason: String,
}

#[derive(Deserialize)]
struct CreateShareRequest {
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
    channel: Option<String>,
    requires_confirmation: Option<bool>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct BulkCreateShareRequest {
    document_ids: Vec<Uuid>,
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
    channel: Option<String>,
    requires_confirmation: Option<bool>,
    message: Option<String>,
}

#[derive(Deserialize, Default)]
struct PortalReleaseRequest {
    channel: Option<String>,
    requires_confirmation: Option<bool>,
}

#[derive(Deserialize)]
struct CreateDocumentTranslationRequest {
    requested_language: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct UpdateDocumentTranslationRequest {
    status: String,
    #[serde(default)]
    assigned_to: NullableJsonField,
    #[serde(default)]
    note: NullableJsonField,
    #[serde(default)]
    source_language: NullableJsonField,
    #[serde(default)]
    source_text: NullableJsonField,
    #[serde(default)]
    translated_text: NullableJsonField,
    create_translated_document: Option<bool>,
    translated_document_auto_name: Option<String>,
}

#[derive(Default)]
enum NullableJsonField {
    #[default]
    Missing,
    Null,
    Value(serde_json::Value),
}

impl<'de> Deserialize<'de> for NullableJsonField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(match value {
            serde_json::Value::Null => Self::Null,
            value => Self::Value(value),
        })
    }
}

fn nullable_trimmed_text(
    field: &NullableJsonField,
    invalid_message: &'static str,
) -> Result<Option<Option<String>>, axum::response::Response> {
    match field {
        NullableJsonField::Missing => Ok(None),
        NullableJsonField::Null => Ok(Some(None)),
        NullableJsonField::Value(serde_json::Value::String(raw)) => {
            let value = raw.trim();
            Ok(Some(if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            }))
        }
        NullableJsonField::Value(_) => Err(err(StatusCode::UNPROCESSABLE_ENTITY, invalid_message)),
    }
}

fn nullable_translation_source_language(
    field: &NullableJsonField,
) -> Result<Option<Option<String>>, axum::response::Response> {
    let Some(value) = nullable_trimmed_text(field, "Unknown translation source language")? else {
        return Ok(None);
    };
    let Some(raw_language) = value else {
        return Ok(Some(None));
    };
    match normalize_translation_source_language(Some(raw_language.as_str())) {
        Some(language) => Ok(Some(Some(language.to_string()))),
        None => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown translation source language",
        )),
    }
}

fn nullable_document_enum(
    field: &NullableJsonField,
    allowed: &[&str],
    invalid_message: &'static str,
) -> Result<Option<Option<String>>, axum::response::Response> {
    let Some(value) = nullable_trimmed_text(field, invalid_message)? else {
        return Ok(None);
    };
    let Some(raw_value) = value else {
        return Ok(Some(None));
    };
    let normalized = raw_value.to_lowercase().replace('-', "_");
    if allowed.contains(&normalized.as_str()) {
        Ok(Some(Some(normalized)))
    } else {
        Err(err(StatusCode::UNPROCESSABLE_ENTITY, invalid_message))
    }
}

fn nullable_document_language(
    field: &NullableJsonField,
) -> Result<Option<Option<String>>, axum::response::Response> {
    let Some(value) = nullable_trimmed_text(field, "Unknown document language")? else {
        return Ok(None);
    };
    let Some(raw_language) = value else {
        return Ok(Some(None));
    };
    match normalize_document_language(Some(raw_language.as_str())) {
        Some(language) => Ok(Some(Some(language.to_string()))),
        None => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown document language",
        )),
    }
}

fn nullable_document_date(
    field: &NullableJsonField,
    invalid_message: &'static str,
) -> Result<Option<Option<NaiveDate>>, axum::response::Response> {
    let Some(value) = nullable_trimmed_text(field, invalid_message)? else {
        return Ok(None);
    };
    let Some(raw_date) = value else {
        return Ok(Some(None));
    };
    NaiveDate::parse_from_str(raw_date.as_str(), "%Y-%m-%d")
        .map(|value| Some(Some(value)))
        .map_err(|_| err(StatusCode::UNPROCESSABLE_ENTITY, invalid_message))
}

struct ShareableDocumentContext {
    document_id: Uuid,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    share_status: ShareStatus,
    sensitivity: DataSensitivity,
}

#[derive(Deserialize, Default, Clone)]
struct GenerateDocumentRequest {
    template_id: String,
    patient_id: Option<Uuid>,
    lead_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    replace_document_id: Option<Uuid>,
    auto_name: Option<String>,
    status: Option<String>,
    visibility: Option<String>,
    klinik: Option<String>,
    ursprung: Option<String>,
    notes: Option<String>,
    document_direction: Option<String>,
    document_variant: Option<String>,
    document_language: Option<String>,
    access_category: Option<String>,
    document_date: Option<NaiveDate>,
    source_person: Option<String>,
    source_institution: Option<String>,
    addressee_person: Option<String>,
    addressee_institution: Option<String>,
    financial_status: Option<String>,
    payment_due_date: Option<NaiveDate>,
    payment_date: Option<NaiveDate>,
    payment_method: Option<String>,
    language: Option<String>,
    title_override: Option<String>,
    introduction: Option<String>,
    closing_note: Option<String>,
    manual_text: Option<String>,
    text_block_keys: Option<Vec<String>>,
    #[serde(default)]
    bindings: Option<DocumentBindingOverrides>,
}

/// Optional manual binding fields ("yellow sockets") for the generated
/// agency/legal documents. Anything not provided here falls back to data
/// auto-bound from the CRM (patient, order, contract, quote, agency settings).
#[derive(Deserialize, Serialize, Default, Clone)]
struct DocumentBindingOverrides {
    // Patient / Auftraggeber party block (auto-bound from patient when omitted)
    party_street: Option<String>,
    party_zip: Option<String>,
    party_city: Option<String>,
    party_country: Option<String>,
    party_email: Option<String>,
    party_phone: Option<String>,
    // Third-party payer / Kostenübernehmer
    payer_name: Option<String>,
    payer_salutation: Option<String>,
    payer_birth_date: Option<NaiveDate>,
    payer_street: Option<String>,
    payer_zip: Option<String>,
    payer_city: Option<String>,
    payer_country: Option<String>,
    payer_email: Option<String>,
    // Agency bank details (override agency settings)
    bank_holder: Option<String>,
    bank_name: Option<String>,
    bank_swift: Option<String>,
    bank_iban: Option<String>,
    // Contract / order meta
    contract_date: Option<NaiveDate>,
    order_number: Option<String>,
    /// Ordinal of this single order within the framework contract (the highlighted
    /// "1." in "1. Einzelauftrag"). Defaults to 1 when omitted.
    order_sequence: Option<i64>,
    order_date: Option<NaiveDate>,
    quote_number: Option<String>,
    doc_id: Option<String>,
    sign_place: Option<String>,
    sign_date: Option<NaiveDate>,
    party_sign_place: Option<String>,
    party_sign_date: Option<NaiveDate>,
    agency_sign_place: Option<String>,
    agency_sign_date: Option<NaiveDate>,
    payer_sign_place: Option<String>,
    payer_sign_date: Option<NaiveDate>,
    /// §2 framework-contract cost threshold above which written approval is required.
    cost_threshold: Option<String>,
    /// Single-order "Bestandteile des Einzelauftrages und Rangfolge" value (default "Keine").
    order_components: Option<String>,
    /// Single-order Leistungsumfang scope phrases (examination / treatment type).
    examination_purpose: Option<String>,
    treatment_purpose: Option<String>,
    // Scope of services
    specialties: Option<String>,
    period_from: Option<NaiveDate>,
    period_to: Option<NaiveDate>,
    estimate_total: Option<String>,
    #[serde(default)]
    service_lines: Vec<ServiceLineInput>,
    // Appointment confirmation specifics
    passport_number: Option<String>,
    passport_valid_until: Option<NaiveDate>,
    #[serde(default)]
    clinics: Vec<ClinicInput>,
    examination_weeks: Option<String>,
    continuation_statement: Option<String>,
    recipient_block: Option<String>,
    contact_phones: Option<String>,
    // Patient sticker specifics (manual operator-entered codes: KT1/KT2 cost-bearer, FRA code)
    kt1: Option<String>,
    kt2: Option<String>,
    cost_code: Option<String>,
    // Consent (minor) specifics
    child_name: Option<String>,
    child_birth_date: Option<NaiveDate>,
    child_address: Option<String>,
    guardian_name: Option<String>,
    guardian_label: Option<String>,
    guardian_birth_date: Option<NaiveDate>,
    guardian_address: Option<String>,
    guardian2_name: Option<String>,
    guardian2_label: Option<String>,
    guardian2_birth_date: Option<NaiveDate>,
    extra_release_recipients: Option<String>,
    consent_email: Option<bool>,
    consent_messenger: Option<bool>,
    consent_threema: Option<bool>,
    consent_whatsapp: Option<bool>,
    consent_telegram: Option<bool>,
    consent_healthcare: Option<bool>,
    consent_provider_release: Option<bool>,
    consent_privacy: Option<bool>,
}

#[derive(Deserialize, Serialize, Default, Clone)]
struct ServiceLineInput {
    description: String,
    #[serde(default)]
    fee: Option<String>,
    #[serde(default)]
    quantity: Option<String>,
    #[serde(default)]
    line_total: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Deserialize, Serialize, Default, Clone)]
struct ClinicInput {
    name: String,
    #[serde(default)]
    address: Option<String>,
}

struct GeneratedProviderDocumentResult {
    id: Uuid,
    document_number: String,
    auto_name: String,
    original_filename: String,
    mime_type: &'static str,
    file_size: i64,
    language: String,
    generated_template_id: String,
    version_root_document_id: Uuid,
    replaces_document_id: Option<Uuid>,
    version_number: i32,
    preview_html: String,
}

struct PortalReleaseResult {
    document_id: Uuid,
    patient_id: Uuid,
    visibility: &'static str,
    recipient_count: usize,
    created_share_count: usize,
    requires_confirmation: bool,
}

#[derive(Default)]
pub(crate) struct AutoPreparationDocumentSendResult {
    pub(crate) template_count: usize,
    pub(crate) generated_document_count: usize,
    pub(crate) reused_document_count: usize,
    pub(crate) portal_release_count: usize,
    pub(crate) marked_sent: bool,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn compact_storage_filename(name: &str, max_len: usize) -> String {
    let sanitized = sanitize_filename(name);
    if sanitized.len() <= max_len {
        return sanitized;
    }

    let (stem, extension) = match sanitized.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            (stem, Some(extension))
        }
        _ => (sanitized.as_str(), None),
    };

    let reserved = extension.map(|value| value.len() + 1).unwrap_or(0);
    let stem_max_len = max_len.saturating_sub(reserved).max(1);
    let truncated_stem: String = stem.chars().take(stem_max_len).collect();

    match extension {
        Some(extension) => format!("{truncated_stem}.{extension}"),
        None => truncated_stem,
    }
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn normalized_document_hint_source(parts: &[Option<&str>]) -> String {
    parts
        .iter()
        .flatten()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn contains_any_keyword(haystack: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| haystack.contains(keyword))
}

fn build_document_classification_suggestion(
    art: &'static str,
    category: &'static str,
    is_medical: bool,
    confidence: &'static str,
    rationale: &'static str,
) -> serde_json::Value {
    json!({
        "art": art,
        "category": category,
        "is_medical": is_medical,
        "confidence": confidence,
        "rationale": rationale,
    })
}

fn suggest_document_classification(
    original_filename: Option<&str>,
    auto_name: Option<&str>,
    mime_type: Option<&str>,
    ursprung: Option<&str>,
    notes: Option<&str>,
) -> Option<serde_json::Value> {
    let hint_source = normalized_document_hint_source(&[
        original_filename,
        auto_name,
        mime_type,
        ursprung,
        notes,
    ]);

    if hint_source.is_empty() {
        return None;
    }

    if contains_any_keyword(
        &hint_source,
        &[
            "passport",
            "reisepass",
            "ausweis",
            "identity",
            "idcard",
            "id_card",
        ],
    ) {
        return Some(build_document_classification_suggestion(
            "passport_scan",
            "identity",
            false,
            "high",
            "Filename or notes indicate an identity or passport document.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &[
            "consent",
            "einverstaendnis",
            "einverständnis",
            "gdpr",
            "privacy release",
        ],
    ) {
        return Some(build_document_classification_suggestion(
            "consent_form",
            "consent",
            false,
            "high",
            "Filename or notes indicate a consent or release form.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &[
            "payment proof",
            "payment_proof",
            "zahlungsnachweis",
            "receipt",
            "quittung",
        ],
    ) {
        return Some(build_document_classification_suggestion(
            "payment_proof",
            "finance",
            false,
            "high",
            "Filename or notes indicate a payment receipt or proof.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &["invoice", "rechnung", "bill", "kostenvoranschlag", "quote"],
    ) {
        return Some(build_document_classification_suggestion(
            "invoice_document",
            "finance",
            false,
            "high",
            "Filename or notes indicate billing or quote paperwork.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &[
            "insurance",
            "versicherung",
            "aok",
            "tk",
            "allianz",
            "policy",
            "coverage",
        ],
    ) {
        return Some(build_document_classification_suggestion(
            "insurance_document",
            "insurance",
            false,
            "medium",
            "Filename or notes indicate insurance paperwork.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &[
            "arztbrief",
            "doctor letter",
            "discharge",
            "entlass",
            "epicrisis",
        ],
    ) {
        return Some(build_document_classification_suggestion(
            "arztbrief",
            "medical",
            true,
            "high",
            "Filename or notes indicate a doctor letter or discharge summary.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &[
            "mri",
            "ct",
            "radiology",
            "xray",
            "x-ray",
            "ultrasound",
            "sono",
        ],
    ) {
        return Some(build_document_classification_suggestion(
            "imaging_report",
            "medical",
            true,
            "medium",
            "Filename or notes indicate imaging or radiology findings.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &[
            "befund",
            "report",
            "lab",
            "labor",
            "pathology",
            "histology",
            "findings",
        ],
    ) {
        return Some(build_document_classification_suggestion(
            "medical_report",
            "medical",
            true,
            "medium",
            "Filename or notes indicate a medical report or findings sheet.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &["medication", "medikament", "prescription", "rx", "rezept"],
    ) {
        return Some(build_document_classification_suggestion(
            "medication_list",
            "medical",
            true,
            "medium",
            "Filename or notes indicate medication or prescription content.",
        ));
    }

    if contains_any_keyword(
        &hint_source,
        &["contract", "vertrag", "agreement", "consignment"],
    ) {
        return Some(build_document_classification_suggestion(
            "contract_document",
            "administrative",
            false,
            "medium",
            "Filename or notes indicate contractual paperwork.",
        ));
    }

    None
}

fn document_needs_categorization(
    art: Option<&str>,
    category: Option<&str>,
    ursprung: Option<&str>,
) -> bool {
    let art = art.unwrap_or_default().trim().to_lowercase();
    let category = category.unwrap_or_default().trim().to_lowercase();
    let ursprung = ursprung.unwrap_or_default().trim().to_lowercase();

    category.is_empty()
        || category == "portal_upload"
        || matches!(
            art.as_str(),
            "" | "document"
                | "uploaded_document"
                | "patient_general_upload"
                | "patient_medical_upload"
                | "patient_admin_upload"
        )
        || ursprung == "patient_portal"
}

fn is_interpreter_review_document(
    uploaded_by_role: Option<&str>,
    ursprung: Option<&str>,
    status: Option<&str>,
) -> bool {
    matches!(uploaded_by_role, Some("interpreter"))
        && matches!(ursprung, Some("interpreter_upload"))
        && matches!(status, Some("draft"))
}

fn is_document_intake_queue_candidate(row: &sqlx::postgres::PgRow) -> bool {
    let art = row.try_get::<Option<String>, _>("art").unwrap_or_default();
    let category = row
        .try_get::<Option<String>, _>("category")
        .unwrap_or_default();
    let ursprung = row
        .try_get::<Option<String>, _>("ursprung")
        .unwrap_or_default();
    let status = row
        .try_get::<Option<String>, _>("status")
        .unwrap_or_default();
    let uploaded_by_role = row
        .try_get::<Option<String>, _>("uploaded_by_role")
        .unwrap_or_default();

    document_needs_categorization(art.as_deref(), category.as_deref(), ursprung.as_deref())
        || is_interpreter_review_document(
            uploaded_by_role.as_deref(),
            ursprung.as_deref(),
            status.as_deref(),
        )
}

fn classification_suggestion_art(value: &Value) -> Option<&str> {
    value.get("art").and_then(Value::as_str)
}

fn classification_suggestion_category(value: &Value) -> Option<&str> {
    value.get("category").and_then(Value::as_str)
}

fn classification_suggestion_is_medical(value: &Value) -> Option<bool> {
    value.get("is_medical").and_then(Value::as_bool)
}

fn document_fields_imply_medical(art: &str, category: Option<&str>) -> bool {
    let searchable = format!(
        "{} {}",
        art.trim().to_lowercase(),
        category.unwrap_or_default().trim().to_lowercase()
    );

    searchable.contains("medical")
        || searchable.contains("arztbrief")
        || searchable.contains("befund")
        || searchable.contains("report")
        || searchable.contains("imaging")
        || searchable.contains("radiology")
        || searchable.contains("medication")
        || searchable.contains("prescription")
        || searchable.contains("discharge")
        || searchable.contains("epicrisis")
}

enum DocumentTextExtractionResult {
    Completed {
        method: &'static str,
        extracted_text: String,
    },
    Unsupported {
        method: &'static str,
        message: &'static str,
    },
    Failed {
        method: &'static str,
        message: &'static str,
    },
}

fn document_text_extraction_message(status: &str, method: Option<&str>) -> Option<&'static str> {
    match (status, method.unwrap_or_default()) {
        ("unsupported", "ocr_unavailable") => Some(IMAGE_OCR_UNAVAILABLE_MESSAGE),
        ("unsupported", "windows_ocr") => Some(IMAGE_OCR_NO_TEXT_MESSAGE),
        ("unsupported", "tesseract_cli") => Some(IMAGE_OCR_NO_TEXT_MESSAGE),
        ("unsupported", "html_text") => Some("No extractable text found in the HTML document."),
        ("unsupported", "text_utf8") => Some("No extractable text found in the uploaded document."),
        ("unsupported", "pdf_text") => Some(PDF_TEXT_NO_TEXT_MESSAGE),
        ("unsupported", "unsupported_binary") => {
            Some("Text extraction is not supported for this document type.")
        }
        ("failed", "windows_ocr") => Some(IMAGE_OCR_FAILED_MESSAGE),
        ("failed", "tesseract_cli") => Some(IMAGE_OCR_FAILED_MESSAGE),
        ("failed", "pdf_text") => Some(PDF_TEXT_FAILED_MESSAGE),
        ("failed", _) => Some("Document text extraction failed."),
        _ => None,
    }
}

fn document_text_extraction_message_key(
    status: &str,
    method: Option<&str>,
) -> Option<&'static str> {
    match (status, method.unwrap_or_default()) {
        ("unsupported", "ocr_unavailable") => Some("ocr_unavailable"),
        ("unsupported", "windows_ocr") | ("unsupported", "tesseract_cli") => Some("ocr_no_text"),
        ("unsupported", "html_text") => Some("html_no_text"),
        ("unsupported", "text_utf8") => Some("text_no_text"),
        ("unsupported", "pdf_text") => Some("pdf_no_text"),
        ("unsupported", "unsupported_binary") => Some("unsupported_binary"),
        ("failed", "windows_ocr") | ("failed", "tesseract_cli") => Some("ocr_failed"),
        ("failed", "pdf_text") => Some("pdf_failed"),
        ("failed", _) => Some("failed"),
        _ => None,
    }
}

fn document_file_extension(original_filename: Option<&str>) -> Option<String> {
    original_filename
        .and_then(|value| FsPath::new(value).extension())
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
}

fn normalize_extracted_text(value: &str) -> Option<String> {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_blank_line = false;

    for raw_line in value.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = raw_line.replace('\0', "").trim().to_string();
        if line.is_empty() {
            if !previous_blank_line && !normalized.is_empty() {
                normalized.push('\n');
            }
            previous_blank_line = true;
            continue;
        }

        if !normalized.is_empty() && !normalized.ends_with('\n') {
            normalized.push('\n');
        }
        normalized.push_str(&line);
        previous_blank_line = false;
    }

    let trimmed = normalized.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn strip_html_tags(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;
    let mut previous_was_space = false;

    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !previous_was_space && !output.ends_with('\n') {
                    output.push(' ');
                    previous_was_space = true;
                }
            }
            _ if in_tag => {}
            ch if ch.is_whitespace() => {
                if !previous_was_space {
                    output.push(if ch == '\n' { '\n' } else { ' ' });
                    previous_was_space = true;
                }
            }
            _ => {
                output.push(ch);
                previous_was_space = false;
            }
        }
    }

    output
}

#[cfg(windows)]
async fn extract_text_from_image_bytes_windows(
    bytes: &[u8],
) -> Result<Option<String>, &'static str> {
    let stream = InMemoryRandomAccessStream::new().map_err(|_| IMAGE_OCR_UNAVAILABLE_MESSAGE)?;
    let writer =
        DataWriter::CreateDataWriter(&stream).map_err(|_| IMAGE_OCR_UNAVAILABLE_MESSAGE)?;
    writer
        .WriteBytes(bytes)
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?;
    writer
        .StoreAsync()
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?
        .await
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?;
    stream.Seek(0).map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?
        .await
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?;
    let software_bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?
        .await
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| IMAGE_OCR_UNAVAILABLE_MESSAGE)?;
    let result: windows::Media::Ocr::OcrResult = engine
        .RecognizeAsync(&software_bitmap)
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?
        .await
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?;
    let text = result
        .Text()
        .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?
        .to_string();
    Ok(normalize_extracted_text(&text))
}

/// Upper bound for a single tesseract process. The child is run with
/// `kill_on_drop`, so a timeout tears it down instead of just abandoning
/// the waiter and leaving the OCR process running in the background.
const OCR_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

async fn extract_text_from_image_bytes_tesseract(
    bytes: &[u8],
    original_filename: Option<&str>,
) -> Result<Option<String>, &'static str> {
    let extension = document_file_extension(original_filename).unwrap_or_else(|| "png".to_string());
    let mut temp_path = std::env::temp_dir();
    temp_path.push(format!("gmed-doc-ocr-{}.{}", Uuid::new_v4(), extension));

    let result = async {
        tokio::fs::write(&temp_path, bytes)
            .await
            .map_err(|_| IMAGE_OCR_FAILED_MESSAGE)?;

        let executables: &[&str] = if cfg!(windows) {
            &["tesseract.exe", "tesseract"]
        } else {
            &["tesseract"]
        };

        for executable in executables {
            let mut command = tokio::process::Command::new(executable);
            command
                .arg(&temp_path)
                .arg("stdout")
                .arg("--psm")
                .arg("6")
                .kill_on_drop(true);

            match tokio::time::timeout(OCR_TIMEOUT, command.output()).await {
                Ok(Ok(output)) => {
                    if output.status.success() {
                        let text = String::from_utf8_lossy(&output.stdout);
                        return Ok(normalize_extracted_text(&text));
                    }

                    return Err(IMAGE_OCR_FAILED_MESSAGE);
                }
                Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Ok(Err(error)) => {
                    tracing::warn!(error = %error, executable, "tesseract OCR process failed");
                    return Err(IMAGE_OCR_FAILED_MESSAGE);
                }
                Err(_) => {
                    tracing::warn!(
                        timeout_secs = OCR_TIMEOUT.as_secs(),
                        executable,
                        "tesseract OCR timed out"
                    );
                    return Err(IMAGE_OCR_FAILED_MESSAGE);
                }
            }
        }

        Err(IMAGE_OCR_UNAVAILABLE_MESSAGE)
    }
    .await;

    let _ = tokio::fs::remove_file(&temp_path).await;
    result
}

async fn extract_text_from_image_bytes(
    bytes: &[u8],
    original_filename: Option<&str>,
) -> (&'static str, Result<Option<String>, &'static str>) {
    #[cfg(windows)]
    {
        match extract_text_from_image_bytes_windows(bytes).await {
            Ok(Some(extracted_text)) => ("windows_ocr", Ok(Some(extracted_text))),
            Ok(None) => {
                match extract_text_from_image_bytes_tesseract(bytes, original_filename).await {
                    Ok(Some(extracted_text)) => ("tesseract_cli", Ok(Some(extracted_text))),
                    Ok(None) => ("windows_ocr", Ok(None)),
                    Err(_) => ("windows_ocr", Ok(None)),
                }
            }
            Err(message) if message == IMAGE_OCR_UNAVAILABLE_MESSAGE => {
                match extract_text_from_image_bytes_tesseract(bytes, original_filename).await {
                    Ok(result) => ("tesseract_cli", Ok(result)),
                    Err(fallback_message) if fallback_message == IMAGE_OCR_UNAVAILABLE_MESSAGE => {
                        ("ocr_unavailable", Err(IMAGE_OCR_UNAVAILABLE_MESSAGE))
                    }
                    Err(fallback_message) => ("tesseract_cli", Err(fallback_message)),
                }
            }
            Err(message) => {
                match extract_text_from_image_bytes_tesseract(bytes, original_filename).await {
                    Ok(result) => ("tesseract_cli", Ok(result)),
                    Err(_) => ("windows_ocr", Err(message)),
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        match extract_text_from_image_bytes_tesseract(bytes, original_filename).await {
            Ok(result) => ("tesseract_cli", Ok(result)),
            Err(message) if message == IMAGE_OCR_UNAVAILABLE_MESSAGE => {
                ("ocr_unavailable", Err(IMAGE_OCR_UNAVAILABLE_MESSAGE))
            }
            Err(message) => ("tesseract_cli", Err(message)),
        }
    }
}

async fn extract_document_text_from_bytes(
    mime_type: Option<&str>,
    original_filename: Option<&str>,
    bytes: &[u8],
) -> DocumentTextExtractionResult {
    let mime = mime_type.unwrap_or_default().trim().to_lowercase();
    let extension = document_file_extension(original_filename);

    let is_html = mime.contains("html") || matches!(extension.as_deref(), Some("html" | "htm"));
    let is_pdf = mime == "application/pdf" || matches!(extension.as_deref(), Some("pdf"));
    let is_image = mime.starts_with("image/")
        || matches!(
            extension.as_deref(),
            Some("png" | "jpg" | "jpeg" | "bmp" | "tif" | "tiff" | "gif" | "webp")
        );
    let is_text_like = mime.starts_with("text/")
        || matches!(
            extension.as_deref(),
            Some("txt" | "md" | "csv" | "tsv" | "json" | "xml" | "yaml" | "yml" | "log")
        );

    if is_html {
        let text = strip_html_tags(&String::from_utf8_lossy(bytes));
        return match normalize_extracted_text(&text) {
            Some(extracted_text) => DocumentTextExtractionResult::Completed {
                method: "html_text",
                extracted_text,
            },
            None => DocumentTextExtractionResult::Unsupported {
                method: "html_text",
                message: "No extractable text found in the HTML document.",
            },
        };
    }

    if is_text_like {
        return match normalize_extracted_text(&String::from_utf8_lossy(bytes)) {
            Some(extracted_text) => DocumentTextExtractionResult::Completed {
                method: "text_utf8",
                extracted_text,
            },
            None => DocumentTextExtractionResult::Unsupported {
                method: "text_utf8",
                message: "No extractable text found in the uploaded document.",
            },
        };
    }

    if is_pdf {
        let extraction = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            pdf_extract::extract_text_from_mem(bytes)
        }));
        return match extraction {
            Ok(Ok(text)) => match normalize_extracted_text(&text) {
                Some(extracted_text) => DocumentTextExtractionResult::Completed {
                    method: "pdf_text",
                    extracted_text,
                },
                None => DocumentTextExtractionResult::Unsupported {
                    method: "pdf_text",
                    message: PDF_TEXT_NO_TEXT_MESSAGE,
                },
            },
            Ok(Err(_)) => DocumentTextExtractionResult::Failed {
                method: "pdf_text",
                message: PDF_TEXT_FAILED_MESSAGE,
            },
            Err(_) => {
                tracing::warn!("pdf text extraction panicked");
                DocumentTextExtractionResult::Failed {
                    method: "pdf_text",
                    message: PDF_TEXT_FAILED_MESSAGE,
                }
            }
        };
    }

    if is_image {
        let (method, extraction_result) =
            extract_text_from_image_bytes(bytes, original_filename).await;

        return match extraction_result {
            Ok(Some(extracted_text)) => DocumentTextExtractionResult::Completed {
                method,
                extracted_text,
            },
            Ok(None) => DocumentTextExtractionResult::Unsupported {
                method,
                message: IMAGE_OCR_NO_TEXT_MESSAGE,
            },
            Err(message) if method == "ocr_unavailable" => {
                DocumentTextExtractionResult::Unsupported { method, message }
            }
            Err(message) => DocumentTextExtractionResult::Failed { method, message },
        };
    }

    DocumentTextExtractionResult::Unsupported {
        method: "unsupported_binary",
        message: "Text extraction is not supported for this document type.",
    }
}

fn normalize_document_language(value: Option<&str>) -> Option<&'static str> {
    match value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("de") | Some("de-de") | Some("de_at") | Some("de-at") | Some("de_ch")
        | Some("de-ch") => Some("de"),
        Some("uk") | Some("uk-ua") | Some("ua") | Some("ukrainian") => Some("uk"),
        Some("en") | Some("en-gb") | Some("en-us") | Some("english") => Some("en"),
        Some("ru") | Some("ru-ru") | Some("russian") => Some("ru"),
        _ => None,
    }
}

/// Source language of an uploaded document for the translation workspace. Wider
/// than the document/template language: it accepts every language offered in the
/// UI source-language picker (LANGUAGE_OPTIONS), since a document can arrive in
/// any of them.
fn normalize_translation_source_language(value: Option<&str>) -> Option<&'static str> {
    if let Some(language) = normalize_document_language(value) {
        return Some(language);
    }
    let normalized = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)?;
    const EXTRA_SOURCE_LANGUAGES: &[&str] = &[
        "ar", "pt", "fr", "es", "it", "tr", "pl", "cs", "da", "el", "lv", "zh", "ur",
    ];
    EXTRA_SOURCE_LANGUAGES
        .iter()
        .copied()
        .find(|candidate| *candidate == normalized)
}

fn resolve_document_language(
    requested: Option<&str>,
    patient_languages: &[String],
    supported_languages: &[&'static str],
) -> &'static str {
    if let Some(language) = normalize_document_language(requested)
        && supported_languages.contains(&language)
    {
        return language;
    }

    for patient_language in patient_languages {
        if let Some(language) = normalize_document_language(Some(patient_language.as_str()))
            && supported_languages.contains(&language)
        {
            return language;
        }
    }

    supported_languages.first().copied().unwrap_or("de")
}

fn document_template_by_id(template_id: &str) -> Option<DocumentTemplateDefinition> {
    DOCUMENT_TEMPLATES
        .iter()
        .copied()
        .find(|template| template.id == template_id)
}

fn is_fixed_legal_document_template(template_id: &str) -> bool {
    matches!(
        template_id,
        "framework_contract"
            | "single_order"
            | "order_cost_estimate"
            | "cost_estimate"
            | "confidentiality_release"
            | "privacy_consents"
            | "privacy_information"
    )
}

fn is_lead_allowed_document_template(template_id: &str) -> bool {
    matches!(
        template_id,
        "framework_contract"
            | "single_order"
            | "order_cost_estimate"
            | "cost_estimate"
            | "confidentiality_release"
            | "privacy_consents"
            | "privacy_information"
            | "consent_data_release_child"
            | "consent_data_release_single"
    )
}

fn generated_template_id_from_source(value: Option<&str>) -> Option<String> {
    let value = value.map(str::trim).filter(|value| !value.is_empty())?;
    let value = value.strip_prefix("template:").unwrap_or(value).trim();
    if value.starts_with(PROVIDER_TEMPLATE_ID_PREFIX) || document_template_by_id(value).is_some() {
        Some(value.to_string())
    } else {
        None
    }
}

fn row_generated_template_id(row: &sqlx::postgres::PgRow) -> Option<String> {
    row.try_get::<Option<String>, _>("generated_template_id")
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            generated_template_id_from_source(
                row.try_get::<Option<String>, _>("ursprung")
                    .ok()
                    .flatten()
                    .as_deref(),
            )
        })
}

fn provider_template_public_id(template_id: Uuid) -> String {
    format!("{PROVIDER_TEMPLATE_ID_PREFIX}{template_id}")
}

fn parse_provider_template_public_id(template_id: &str) -> Option<Uuid> {
    template_id
        .trim()
        .strip_prefix(PROVIDER_TEMPLATE_ID_PREFIX)
        .and_then(|value| Uuid::parse_str(value).ok())
}

fn resolve_owned_document_language(
    requested: Option<&str>,
    patient_languages: &[String],
    supported_languages: &[String],
) -> String {
    if let Some(language) = normalize_document_language(requested)
        && supported_languages
            .iter()
            .any(|supported| supported == language)
    {
        return language.to_string();
    }

    for patient_language in patient_languages {
        if let Some(language) = normalize_document_language(Some(patient_language.as_str()))
            && supported_languages
                .iter()
                .any(|supported| supported == language)
        {
            return language.to_string();
        }
    }

    supported_languages
        .first()
        .cloned()
        .unwrap_or_else(|| "de".to_string())
}

fn document_text_block_by_key(key: &str) -> Option<TextBlockDefinition> {
    DOCUMENT_TEXT_BLOCKS
        .iter()
        .copied()
        .find(|block| block.key == key)
}

async fn load_active_provider_document_templates(
    state: &AppState,
) -> Result<Vec<ProviderDocumentTemplate>, axum::response::Response> {
    let rows = match sqlx::query(
        r#"SELECT pt.id, pt.provider_id, provider.name AS provider_name,
                  pt.doctor_id, doctor.name AS doctor_name,
                  pt.label, pt.description, pt.art, pt.category,
                  pt.default_auto_name, pt.default_status, pt.default_visibility,
                  pt.is_medical, pt.supported_languages, pt.body_de,
                  pt.auto_send_on_confirmed_appointment
           FROM provider_templates pt
           JOIN providers provider ON provider.id = pt.provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = pt.doctor_id
           WHERE pt.is_active = true
             AND COALESCE(btrim(pt.body_de), '') <> ''
           ORDER BY provider.name, pt.label"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(error = %error, "load provider document templates");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load provider templates",
            ));
        }
    };

    Ok(rows
        .into_iter()
        .map(provider_document_template_from_row)
        .collect())
}

fn provider_document_template_from_row(row: sqlx::postgres::PgRow) -> ProviderDocumentTemplate {
    ProviderDocumentTemplate {
        id: row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        provider_id: row
            .try_get::<Uuid, _>("provider_id")
            .unwrap_or_else(|_| Uuid::nil()),
        provider_name: row
            .try_get::<String, _>("provider_name")
            .unwrap_or_default(),
        doctor_id: row
            .try_get::<Option<Uuid>, _>("doctor_id")
            .unwrap_or_default(),
        doctor_name: row
            .try_get::<Option<String>, _>("doctor_name")
            .unwrap_or_default(),
        label: row.try_get::<String, _>("label").unwrap_or_default(),
        description: row
            .try_get::<Option<String>, _>("description")
            .unwrap_or_default(),
        art: row.try_get::<String, _>("art").unwrap_or_default(),
        category: row.try_get::<String, _>("category").unwrap_or_default(),
        default_auto_name: row
            .try_get::<String, _>("default_auto_name")
            .unwrap_or_default(),
        default_status: row
            .try_get::<String, _>("default_status")
            .unwrap_or_else(|_| "draft".to_string()),
        default_visibility: row
            .try_get::<String, _>("default_visibility")
            .unwrap_or_else(|_| "patient_visible".to_string()),
        is_medical: row.try_get::<bool, _>("is_medical").unwrap_or(true),
        supported_languages: vec!["de".to_string()],
        body_de: row
            .try_get::<Option<String>, _>("body_de")
            .unwrap_or_default(),
    }
}

async fn load_provider_document_templates_for_confirmed_appointment(
    state: &AppState,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
) -> Result<Vec<ProviderDocumentTemplate>, axum::response::Response> {
    let rows = match sqlx::query(
        r#"SELECT pt.id, pt.provider_id, provider.name AS provider_name,
                  pt.doctor_id, doctor.name AS doctor_name,
                  pt.label, pt.description, pt.art, pt.category,
                  pt.default_auto_name, pt.default_status, pt.default_visibility,
                  pt.is_medical, pt.supported_languages, pt.body_de,
                  pt.auto_send_on_confirmed_appointment
           FROM provider_templates pt
           JOIN providers provider ON provider.id = pt.provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = pt.doctor_id
           WHERE pt.is_active = true
             AND COALESCE(btrim(pt.body_de), '') <> ''
             AND pt.auto_send_on_confirmed_appointment = true
             AND pt.provider_id = $1
             AND (pt.doctor_id IS NULL OR pt.doctor_id = $2)
           ORDER BY pt.doctor_id NULLS LAST, pt.label, pt.created_at"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(
                error = %error,
                provider_id = %provider_id,
                doctor_id = ?doctor_id,
                "load provider auto-send templates"
            );
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load provider templates",
            ));
        }
    };

    Ok(rows
        .into_iter()
        .map(provider_document_template_from_row)
        .collect())
}

async fn load_provider_document_template(
    state: &AppState,
    template_id: Uuid,
) -> Result<Option<ProviderDocumentTemplate>, axum::response::Response> {
    let templates = load_active_provider_document_templates(state).await?;
    Ok(templates
        .into_iter()
        .find(|template| template.id == template_id))
}

struct ProviderTemplateDeliveryRecord<'a> {
    appointment_id: Uuid,
    template_id: Uuid,
    document_id: Option<Uuid>,
    triggered_by: Uuid,
    delivery_status: &'a str,
    error_message: Option<&'a str>,
    delivered_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn record_appointment_provider_template_delivery(
    state: &AppState,
    record: ProviderTemplateDeliveryRecord<'_>,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO appointment_provider_template_deliveries (
                appointment_id, template_id, document_id, triggered_by,
                delivery_status, error_message, delivered_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (appointment_id, template_id) DO UPDATE
           SET document_id = EXCLUDED.document_id,
               triggered_by = EXCLUDED.triggered_by,
               delivery_status = EXCLUDED.delivery_status,
               error_message = EXCLUDED.error_message,
               delivered_at = EXCLUDED.delivered_at,
               updated_at = now()"#,
    )
    .bind(record.appointment_id)
    .bind(record.template_id)
    .bind(record.document_id)
    .bind(record.triggered_by)
    .bind(record.delivery_status)
    .bind(record.error_message)
    .bind(record.delivered_at)
    .execute(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(
            error = %error,
            appointment_id = %record.appointment_id,
            template_id = %record.template_id,
            delivery_status = %record.delivery_status,
            "record appointment provider template delivery"
        );
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to record provider template delivery",
        )
    })?;

    Ok(())
}

async fn claim_appointment_provider_template_delivery(
    state: &AppState,
    record: ProviderTemplateDeliveryRecord<'_>,
) -> Result<bool, axum::response::Response> {
    let claimed = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO appointment_provider_template_deliveries (
                appointment_id, template_id, document_id, triggered_by,
                delivery_status, error_message, delivered_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (appointment_id, template_id) DO NOTHING
           RETURNING id"#,
    )
    .bind(record.appointment_id)
    .bind(record.template_id)
    .bind(record.document_id)
    .bind(record.triggered_by)
    .bind(record.delivery_status)
    .bind(record.error_message)
    .bind(record.delivered_at)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(
            error = %error,
            appointment_id = %record.appointment_id,
            template_id = %record.template_id,
            delivery_status = %record.delivery_status,
            "claim appointment provider template delivery"
        );
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to record provider template delivery",
        )
    })?;

    Ok(claimed.is_some())
}

async fn find_existing_auto_preparation_document(
    state: &AppState,
    appointment_id: Uuid,
    ursprung: &str,
) -> Result<Option<Uuid>, axum::response::Response> {
    sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id
           FROM documents
           WHERE appointment_id = $1
             AND ursprung = $2
             AND status <> 'archived'
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(appointment_id)
    .bind(ursprung)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, appointment_id = %appointment_id, ursprung = %ursprung, "load existing auto preparation document");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to auto-send preparation documents",
        )
    })
}

async fn find_delivered_auto_preparation_document(
    state: &AppState,
    appointment_id: Uuid,
    template_id: Uuid,
) -> Result<Option<Uuid>, axum::response::Response> {
    sqlx::query_scalar::<_, Uuid>(
        r#"SELECT document_id
           FROM appointment_provider_template_deliveries
           WHERE appointment_id = $1
             AND template_id = $2
             AND delivery_status = 'delivered'
             AND document_id IS NOT NULL
           LIMIT 1"#,
    )
    .bind(appointment_id)
    .bind(template_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, appointment_id = %appointment_id, template_id = %template_id, "load delivered auto preparation document");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to auto-send preparation documents",
        )
    })
}

async fn wait_for_delivered_auto_preparation_document(
    state: &AppState,
    appointment_id: Uuid,
    template_id: Uuid,
) -> Result<Option<Uuid>, axum::response::Response> {
    for attempt in 0..80 {
        if let Some(document_id) =
            find_delivered_auto_preparation_document(state, appointment_id, template_id).await?
        {
            return Ok(Some(document_id));
        }

        if attempt < 79 {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }

    Ok(None)
}

fn translated_text_block_body(block: TextBlockDefinition, language: &str) -> &'static str {
    match language {
        "uk" => block.uk,
        "en" => block.en,
        _ => block.de,
    }
}

fn translated_label(language: &str, key: &str) -> &'static str {
    match (language, key) {
        ("uk", "framework_contract_title") => "Рамковий договір для",
        ("uk", "visa_invitation_title") => "Лист-запрошення для візи для",
        ("uk", "contract_data_heading") => "Договірні реквізити",
        ("uk", "contract_terms_heading") => "Стандартні умови",
        ("uk", "contract_conditions_heading") => "Додаткові умови",
        ("uk", "quote_heading") => "Комерційний контекст",
        ("uk", "services_heading") => "Погоджені позиції",
        ("uk", "contract_number") => "Номер договору",
        ("uk", "contract_status") => "Статус договору",
        ("uk", "valid_from") => "Дійсний з",
        ("uk", "valid_to") => "Дійсний до",
        ("uk", "signed_at") => "Підписано",
        ("uk", "quote_number") => "Кошторис",
        ("uk", "quote_valid_until") => "Діє до",
        ("uk", "total_net") => "Нетто",
        ("uk", "total_vat") => "ПДВ",
        ("uk", "total_gross") => "Брутто",
        ("uk", "service_quantity") => "Кількість",
        ("uk", "service_unit_price") => "Ціна за одиницю",
        ("uk", "service_total") => "Разом",
        ("uk", "no_services") => "Для вибраного контексту ще немає комерційних позицій.",
        ("uk", "sticker_title") => "Пацієнтський стікер",
        ("uk", "sticker_dob") => "Дата народження",
        ("uk", "sticker_country") => "Країна",
        ("uk", "sticker_insurance") => "Страховик",
        ("uk", "sticker_generated") => "Згенеровано",
        ("uk", "medication_title") => "Зведений медикаментозний план для",
        ("uk", "medication_heading") => "Поточні медикаменти",
        ("uk", "medication_permanent") => "Постійні медикаменти",
        ("uk", "medication_temporary") => "Тимчасові медикаменти",
        ("uk", "medication_name") => "Препарат",
        ("uk", "ingredient") => "Діюча речовина",
        ("uk", "dose") => "Доза",
        ("uk", "schedule") => "Схема прийому",
        ("uk", "dosage_form") => "Форма",
        ("uk", "prescribed_by") => "Призначив",
        ("uk", "medication_reason") => "Показання",
        ("uk", "since") => "З",
        ("uk", "expiry_date") => "До",
        ("uk", "source_case") => "Джерело",
        ("uk", "medication_note") => "Примітка",
        ("uk", "medication_scope_active") => "Включено всі активні кейси пацієнта.",
        ("uk", "medication_scope_latest") => {
            "Активних кейсів не знайдено, використано останній кейс пацієнта."
        }
        ("uk", "document_title") => "План обстеження та лікування для",
        ("uk", "created_on") => "Дата створення",
        ("uk", "patient_id") => "ID пацієнта",
        ("uk", "birth_date") => "Дата народження",
        ("uk", "order_number") => "Замовлення",
        ("uk", "nationality") => "Громадянство",
        ("uk", "residence_country") => "Країна проживання",
        ("uk", "appointment") => "Візит",
        ("uk", "intro_heading") => "Короткий вступ",
        ("uk", "program_heading") => "Програма по днях",
        ("uk", "notes_heading") => "Важливі вказівки",
        ("uk", "appointment_notes") => "Коментар до візиту",
        ("uk", "treatment_plan_note") => "Нотатка планування",
        ("uk", "generated_footer") => "Згенеровано",
        ("uk", "provider") => "Провайдер",
        ("uk", "doctor") => "Лікар",
        ("uk", "location") => "Місце",
        ("uk", "category") => "Категорія",
        ("uk", "no_items") => "Для вибраного контексту ще немає термінів.",
        ("uk", "no_medications") => "У вибраному контексті ще немає медикаментів.",
        ("uk", "draft_badge") => "Робочий документ",
        ("en", "framework_contract_title") => "Framework contract for",
        ("en", "visa_invitation_title") => "Visa invitation letter for",
        ("en", "contract_data_heading") => "Contract details",
        ("en", "contract_terms_heading") => "Standard clauses",
        ("en", "contract_conditions_heading") => "Additional conditions",
        ("en", "quote_heading") => "Commercial context",
        ("en", "services_heading") => "Agreed positions",
        ("en", "contract_number") => "Contract number",
        ("en", "contract_status") => "Contract status",
        ("en", "valid_from") => "Valid from",
        ("en", "valid_to") => "Valid to",
        ("en", "signed_at") => "Signed at",
        ("en", "quote_number") => "Quote",
        ("en", "quote_valid_until") => "Valid until",
        ("en", "total_net") => "Net",
        ("en", "total_vat") => "VAT",
        ("en", "total_gross") => "Gross",
        ("en", "service_quantity") => "Quantity",
        ("en", "service_unit_price") => "Unit price",
        ("en", "service_total") => "Total",
        ("en", "no_services") => {
            "No commercial line items are available for the selected context yet."
        }
        ("en", "sticker_title") => "Patient sticker",
        ("en", "sticker_dob") => "DOB",
        ("en", "sticker_country") => "Country",
        ("en", "sticker_insurance") => "Insurance",
        ("en", "sticker_generated") => "Generated",
        ("en", "medication_title") => "Medication summary for",
        ("en", "medication_heading") => "Current medication",
        ("en", "medication_permanent") => "Permanent medication",
        ("en", "medication_temporary") => "Temporary medication",
        ("en", "medication_name") => "Medication",
        ("en", "ingredient") => "Ingredient",
        ("en", "dose") => "Dose",
        ("en", "schedule") => "Schedule",
        ("en", "dosage_form") => "Form",
        ("en", "prescribed_by") => "Prescribed by",
        ("en", "medication_reason") => "Reason",
        ("en", "since") => "Since",
        ("en", "expiry_date") => "Until",
        ("en", "source_case") => "Source",
        ("en", "medication_note") => "Note",
        ("en", "medication_scope_active") => "Includes all active patient cases.",
        ("en", "medication_scope_latest") => {
            "No active case was found, so the latest patient case was used."
        }
        ("en", "document_title") => "Treatment plan for",
        ("en", "created_on") => "Created on",
        ("en", "patient_id") => "Patient ID",
        ("en", "birth_date") => "Date of birth",
        ("en", "order_number") => "Order",
        ("en", "nationality") => "Nationality",
        ("en", "residence_country") => "Country of residence",
        ("en", "appointment") => "Appointment",
        ("en", "intro_heading") => "Introduction",
        ("en", "program_heading") => "Schedule by day",
        ("en", "notes_heading") => "Important notes",
        ("en", "appointment_notes") => "Visit note",
        ("en", "treatment_plan_note") => "Planning note",
        ("en", "generated_footer") => "Generated",
        ("en", "provider") => "Provider",
        ("en", "doctor") => "Doctor",
        ("en", "location") => "Location",
        ("en", "category") => "Category",
        ("en", "no_items") => "No appointments are available for the selected context yet.",
        ("en", "no_medications") => "No medication is available for the selected context yet.",
        ("en", "draft_badge") => "Working document",
        (_, "framework_contract_title") => "Rahmenvertrag für",
        (_, "visa_invitation_title") => "Einladungsschreiben (Visum) für",
        (_, "contract_data_heading") => "Vertragsdaten",
        (_, "contract_terms_heading") => "Standardklauseln",
        (_, "contract_conditions_heading") => "Zusätzliche Bedingungen",
        (_, "quote_heading") => "Kaufmännischer Kontext",
        (_, "services_heading") => "Vereinbarte Positionen",
        (_, "contract_number") => "Vertragsnummer",
        (_, "contract_status") => "Vertragsstatus",
        (_, "valid_from") => "Gültig ab",
        (_, "valid_to") => "Gültig bis",
        (_, "signed_at") => "Unterzeichnet am",
        (_, "quote_number") => "Kostenvoranschlag",
        (_, "quote_valid_until") => "Gültig bis",
        (_, "total_net") => "Netto",
        (_, "total_vat") => "MwSt.",
        (_, "total_gross") => "Brutto",
        (_, "service_quantity") => "Menge",
        (_, "service_unit_price") => "Einzelpreis",
        (_, "service_total") => "Gesamt",
        (_, "no_services") => {
            "Für den gewählten Kontext liegen noch keine kaufmännischen Positionen vor."
        }
        (_, "sticker_title") => "Patientenaufkleber",
        (_, "sticker_dob") => "Geburtsdatum",
        (_, "sticker_country") => "Land",
        (_, "sticker_insurance") => "Versicherer",
        (_, "sticker_generated") => "Erstellt",
        (_, "medication_title") => "Medikamentenübersicht für",
        (_, "medication_heading") => "Aktuelle Medikation",
        (_, "medication_permanent") => "Dauermedikation",
        (_, "medication_temporary") => "Temporäre Medikation",
        (_, "medication_name") => "Medikament",
        (_, "ingredient") => "Wirkstoff",
        (_, "dose") => "Dosis",
        (_, "schedule") => "Einnahmeschema",
        (_, "dosage_form") => "Darreichungsform",
        (_, "prescribed_by") => "Verordnet von",
        (_, "medication_reason") => "Indikation",
        (_, "since") => "Seit",
        (_, "expiry_date") => "Bis",
        (_, "source_case") => "Quelle",
        (_, "medication_note") => "Anmerkung",
        (_, "medication_scope_active") => {
            "Alle aktiven Patientencases sind in dieser Zusammenfassung enthalten."
        }
        (_, "medication_scope_latest") => {
            "Kein aktives Case gefunden, daher wurde das zuletzt erfasste Patientencase verwendet."
        }
        (_, "document_title") => "Behandlungsplan für",
        (_, "created_on") => "Datum",
        (_, "patient_id") => "Patienten-ID",
        (_, "birth_date") => "Geburtsdatum",
        (_, "order_number") => "Auftrag",
        (_, "nationality") => "Nationalität",
        (_, "residence_country") => "Wohnsitzland",
        (_, "appointment") => "Termin",
        (_, "intro_heading") => "Einleitung",
        (_, "program_heading") => "Programm nach Tagen",
        (_, "notes_heading") => "Wichtige Hinweise",
        (_, "appointment_notes") => "Terminnotiz",
        (_, "treatment_plan_note") => "Planungsnotiz",
        (_, "generated_footer") => "Erstellt",
        (_, "provider") => "Leistungserbringer",
        (_, "doctor") => "Arzt",
        (_, "location") => "Ort",
        (_, "category") => "Kategorie",
        (_, "no_items") => "Für den gewählten Kontext liegen noch keine Termine vor.",
        (_, "no_medications") => "Für den gewählten Kontext liegt noch keine Medikation vor.",
        _ => "Arbeitsdokument",
    }
}

fn patient_sticker_format_for_template(template_id: &str) -> Option<PatientLabelFormat> {
    let format_id = match template_id {
        "patient_sticker_compact" => "compact-90x48",
        "patient_sticker_standard" => "standard-105x74",
        "patient_sticker_sheet" => "sheet-70x37",
        _ => return None,
    };

    PATIENT_LABEL_FORMATS
        .iter()
        .copied()
        .find(|format| format.id == format_id)
}

fn humanize_contract_condition_key(key: &str) -> String {
    key.split('_')
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => {
                    let mut value = first.to_uppercase().collect::<String>();
                    value.push_str(chars.as_str());
                    value
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_contract_conditions(value: &Value) -> Vec<(String, String)> {
    let Some(object) = value.as_object() else {
        return Vec::new();
    };

    object
        .iter()
        .filter_map(|(key, value)| {
            let rendered = match value {
                Value::Null => None,
                Value::Bool(value) => Some(value.to_string()),
                Value::Number(value) => Some(value.to_string()),
                Value::String(value) => Some(value.trim().to_string()),
                Value::Array(items) => {
                    let joined = items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::trim))
                        .filter(|item| !item.is_empty())
                        .collect::<Vec<_>>()
                        .join(", ");
                    if joined.is_empty() {
                        None
                    } else {
                        Some(joined)
                    }
                }
                Value::Object(_) => Some(value.to_string()),
            }?;

            if rendered.is_empty() {
                None
            } else {
                Some((humanize_contract_condition_key(key), rendered))
            }
        })
        .collect()
}

fn parse_quote_line_items(value: &Value) -> Vec<GeneratedContractLineItem> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let object = item.as_object()?;
            let description = object
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();
            if description.is_empty() {
                return None;
            }
            Some(GeneratedContractLineItem {
                description,
                quantity: object
                    .get("quantity")
                    .and_then(Value::as_str)
                    .unwrap_or("1")
                    .to_string(),
                unit_price: object
                    .get("unit_price")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                line_gross: object
                    .get("line_gross")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                vat_rate: object
                    .get("vat_rate")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                notes: object
                    .get("notes")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            })
        })
        .collect()
}

fn localized_weekday(language: &str, weekday: Weekday) -> &'static str {
    match (language, weekday) {
        ("uk", Weekday::Mon) => "Понеділок",
        ("uk", Weekday::Tue) => "Вівторок",
        ("uk", Weekday::Wed) => "Середа",
        ("uk", Weekday::Thu) => "Четвер",
        ("uk", Weekday::Fri) => "П’ятниця",
        ("uk", Weekday::Sat) => "Субота",
        ("uk", Weekday::Sun) => "Неділя",
        ("en", Weekday::Mon) => "Monday",
        ("en", Weekday::Tue) => "Tuesday",
        ("en", Weekday::Wed) => "Wednesday",
        ("en", Weekday::Thu) => "Thursday",
        ("en", Weekday::Fri) => "Friday",
        ("en", Weekday::Sat) => "Saturday",
        ("en", Weekday::Sun) => "Sunday",
        (_, Weekday::Mon) => "Montag",
        (_, Weekday::Tue) => "Dienstag",
        (_, Weekday::Wed) => "Mittwoch",
        (_, Weekday::Thu) => "Donnerstag",
        (_, Weekday::Fri) => "Freitag",
        (_, Weekday::Sat) => "Samstag",
        (_, Weekday::Sun) => "Sonntag",
    }
}

fn format_localized_date(date: NaiveDate, language: &str) -> String {
    match language {
        "uk" | "en" => format!(
            "{}, {}",
            localized_weekday(language, date.weekday()),
            date.format("%d.%m.%Y")
        ),
        _ => format!(
            "{}, den {}",
            localized_weekday(language, date.weekday()),
            date.format("%d.%m.%Y")
        ),
    }
}

fn format_time_range(start: Option<NaiveTime>, end: Option<NaiveTime>) -> String {
    match (start, end) {
        (Some(start), Some(end)) => format!("{} - {}", start.format("%H:%M"), end.format("%H:%M")),
        (Some(start), None) => start.format("%H:%M").to_string(),
        (None, Some(end)) => format!("until {}", end.format("%H:%M")),
        (None, None) => "TBD".to_string(),
    }
}

fn format_medication_dose(item: &GeneratedMedicationLine) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(dose) = item
        .dose
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(dose.to_string());
    }
    if let Some(unit) = item
        .dose_unit
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(unit.to_string());
    }
    if let Some(extra_unit) = item
        .unit
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(extra_unit.to_string());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn normalized_medication_type(value: &str) -> &str {
    match value {
        "temporary" => "temporary",
        _ => "permanent",
    }
}

fn medication_type_rank(value: &str) -> i32 {
    match normalized_medication_type(value) {
        "permanent" => 0,
        _ => 1,
    }
}

fn medication_heading(language: &str, medication_type: &str) -> &'static str {
    match normalized_medication_type(medication_type) {
        "temporary" => translated_label(language, "medication_temporary"),
        _ => translated_label(language, "medication_permanent"),
    }
}

fn grouped_treatment_plan_appointments(
    context: &GeneratedTreatmentPlanContext,
) -> BTreeMap<NaiveDate, Vec<&GeneratedAppointmentLine>> {
    let mut appointments_by_day: BTreeMap<NaiveDate, Vec<&GeneratedAppointmentLine>> =
        BTreeMap::new();
    for appointment in &context.appointments {
        appointments_by_day
            .entry(appointment.date)
            .or_default()
            .push(appointment);
    }
    appointments_by_day
}

#[derive(Clone, Copy)]
enum TreatmentPlanPdfColor {
    Primary,
    Body,
    Muted,
}

fn treatment_plan_pdf_color(kind: TreatmentPlanPdfColor) -> Color {
    match kind {
        // Brand orange (#f97316) shared with the staff UI accent.
        TreatmentPlanPdfColor::Primary => Color::Rgb(Rgb::new(0.976, 0.451, 0.086, None)),
        TreatmentPlanPdfColor::Muted => Color::Rgb(Rgb::new(0.47, 0.44, 0.42, None)),
        TreatmentPlanPdfColor::Body => Color::Rgb(Rgb::new(0.11, 0.10, 0.09, None)),
    }
}

fn pt_to_mm(value: f32) -> f32 {
    value * 0.352_778
}

/// Character-class-aware width estimate for Helvetica: good enough to centre
/// titles and right-align numeric cells without embedding font metrics.
fn approx_text_width_mm(text: &str, font_size_pt: f32) -> f32 {
    let em_total: f32 = text
        .chars()
        .map(|ch| match ch {
            ' ' => 0.28,
            '.' | ',' | ':' | ';' | '!' | '|' | 'i' | 'j' | 'l' => 0.28,
            '-' | '/' | '(' | ')' | 'f' | 't' | 'r' | 'I' => 0.36,
            '0'..='9' => 0.556,
            'm' | 'w' | 'M' | 'W' => 0.86,
            'A'..='Z' | 'Ä' | 'Ö' | 'Ü' => 0.70,
            'a'..='z' | 'ä' | 'ö' | 'ü' | 'ß' => 0.52,
            _ => 0.58,
        })
        .sum();
    pt_to_mm(font_size_pt) * em_total
}

fn pdf_line_height_mm(size_pt: f32, multiplier: f32) -> f32 {
    pt_to_mm(size_pt * multiplier)
}

fn wrap_text_to_width(text: &str, font_size_pt: f32, available_width_mm: f32) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let average_char_width_mm = pt_to_mm(font_size_pt) * 0.54;
    let max_chars = ((available_width_mm / average_char_width_mm).floor() as usize).max(18);
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in normalized.split_whitespace() {
        let projected_len = if current.is_empty() {
            word.chars().count()
        } else {
            current.chars().count() + 1 + word.chars().count()
        };

        if projected_len <= max_chars {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
            continue;
        }

        if !current.is_empty() {
            lines.push(current);
            current = String::new();
        }

        if word.chars().count() <= max_chars {
            current.push_str(word);
            continue;
        }

        let mut chunk = String::new();
        for ch in word.chars() {
            chunk.push(ch);
            if chunk.chars().count() >= max_chars {
                lines.push(chunk.clone());
                chunk.clear();
            }
        }
        current = chunk;
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

fn wrap_text_to_width_precise(
    text: &str,
    font_size_pt: f32,
    available_width_mm: f32,
) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let mut lines = Vec::new();
    let mut current = String::new();

    for word in normalized.split_whitespace() {
        let candidate = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };
        if approx_text_width_mm(&candidate, font_size_pt) <= available_width_mm {
            current = candidate;
            continue;
        }

        if !current.is_empty() {
            lines.push(std::mem::take(&mut current));
        }

        if approx_text_width_mm(word, font_size_pt) <= available_width_mm {
            current.push_str(word);
            continue;
        }

        let mut chunk = String::new();
        for ch in word.chars() {
            let candidate = format!("{chunk}{ch}");
            if !chunk.is_empty()
                && approx_text_width_mm(&candidate, font_size_pt) > available_width_mm
            {
                lines.push(std::mem::take(&mut chunk));
            }
            chunk.push(ch);
        }
        current = chunk;
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

fn truncate_text_to_width(text: &str, font_size_pt: f32, available_width_mm: f32) -> String {
    let normalized = text.trim();
    let average_char_width_mm = pt_to_mm(font_size_pt) * 0.54;
    let max_chars = ((available_width_mm / average_char_width_mm).floor() as usize).max(18);
    if normalized.chars().count() <= max_chars {
        return normalized.to_string();
    }

    let visible_chars = max_chars.saturating_sub(3);
    format!(
        "{}...",
        normalized.chars().take(visible_chars).collect::<String>()
    )
}

fn append_pdf_text_line(
    ops: &mut Vec<Op>,
    text: &str,
    x_mm: f32,
    y_mm: f32,
    size_pt: f32,
    font: &PdfFontHandle,
    color: TreatmentPlanPdfColor,
) {
    ops.push(Op::SetFont {
        font: font.clone(),
        size: Pt(size_pt),
    });
    ops.push(Op::StartTextSection);
    ops.push(Op::SetTextCursor {
        pos: Point::new(Mm(x_mm), Mm(y_mm)),
    });
    ops.push(Op::SetFillColor {
        col: treatment_plan_pdf_color(color),
    });
    ops.push(win_ansi_show_text_op(text));
    ops.push(Op::EndTextSection);
}

fn append_pdf_justified_text_line(
    ops: &mut Vec<Op>,
    text: &str,
    x_mm: f32,
    y_mm: f32,
    size_pt: f32,
    target_width_mm: f32,
    font: &PdfFontHandle,
    color: TreatmentPlanPdfColor,
) {
    let word_gaps = text.split_whitespace().count().saturating_sub(1);
    let remaining_width_mm = (target_width_mm - approx_text_width_mm(text, size_pt)).max(0.0);
    if word_gaps == 0 || remaining_width_mm <= 0.1 {
        append_pdf_text_line(ops, text, x_mm, y_mm, size_pt, font, color);
        return;
    }

    let spacing_mm = remaining_width_mm / word_gaps as f32;
    if spacing_mm > 2.5 {
        append_pdf_text_line(ops, text, x_mm, y_mm, size_pt, font, color);
        return;
    }

    ops.push(Op::SetFont {
        font: font.clone(),
        size: Pt(size_pt),
    });
    ops.push(Op::StartTextSection);
    ops.push(Op::SetTextCursor {
        pos: Point::new(Mm(x_mm), Mm(y_mm)),
    });
    ops.push(Op::SetFillColor {
        col: treatment_plan_pdf_color(color),
    });
    ops.push(Op::SetWordSpacing {
        pt: pdf_mm_to_pt(spacing_mm),
    });
    ops.push(win_ansi_show_text_op(text));
    ops.push(Op::SetWordSpacing { pt: Pt(0.0) });
    ops.push(Op::EndTextSection);
}

fn pdf_text_font_handles() -> (PdfFontHandle, PdfFontHandle) {
    (
        PdfFontHandle::Builtin(BuiltinFont::Helvetica),
        PdfFontHandle::Builtin(BuiltinFont::HelveticaBold),
    )
}

fn pdf_mm_to_pt(value: f32) -> Pt {
    Pt(value * 2.834_646)
}

fn append_pdf_filled_rect(
    ops: &mut Vec<Op>,
    x_mm: f32,
    y_mm: f32,
    width_mm: f32,
    height_mm: f32,
    color: Color,
) {
    let rect = Rect {
        x: pdf_mm_to_pt(x_mm),
        y: pdf_mm_to_pt(y_mm),
        width: pdf_mm_to_pt(width_mm),
        height: pdf_mm_to_pt(height_mm),
        mode: Some(PaintMode::Fill),
        winding_order: Some(WindingOrder::NonZero),
    };
    ops.push(Op::SetFillColor { col: color });
    ops.push(Op::DrawPolygon {
        polygon: rect.to_polygon(),
    });
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PdfPageStyle {
    Standard,
    Legal,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PdfCellAlign {
    Left,
    Right,
}

struct TreatmentPlanPdfLayout {
    pages: Vec<PdfPage>,
    page_ops: Vec<Op>,
    page_number: usize,
    y_mm: f32,
    footer_text: String,
    legal_footer_lines: Vec<String>,
    document_reference: String,
    page_style: PdfPageStyle,
    regular_font: PdfFontHandle,
    bold_font: PdfFontHandle,
}

impl TreatmentPlanPdfLayout {
    fn new(footer_text: String, regular_font: PdfFontHandle, bold_font: PdfFontHandle) -> Self {
        Self {
            pages: Vec::new(),
            page_ops: Vec::new(),
            page_number: 1,
            y_mm: PDF_PAGE_HEIGHT_MM - PDF_TOP_MARGIN_MM,
            footer_text,
            legal_footer_lines: Vec::new(),
            document_reference: String::new(),
            page_style: PdfPageStyle::Standard,
            regular_font,
            bold_font,
        }
    }

    fn new_legal(
        footer_lines: Vec<String>,
        regular_font: PdfFontHandle,
        bold_font: PdfFontHandle,
    ) -> Self {
        Self {
            pages: Vec::new(),
            page_ops: Vec::new(),
            page_number: 1,
            y_mm: PDF_PAGE_HEIGHT_MM - PDF_LEGAL_TOP_MARGIN_MM,
            footer_text: String::new(),
            legal_footer_lines: footer_lines,
            document_reference: String::new(),
            page_style: PdfPageStyle::Legal,
            regular_font,
            bold_font,
        }
    }

    fn top_start_y_mm(&self) -> f32 {
        if self.page_style == PdfPageStyle::Legal {
            PDF_PAGE_HEIGHT_MM - PDF_LEGAL_TOP_MARGIN_MM
        } else {
            PDF_PAGE_HEIGHT_MM - PDF_TOP_MARGIN_MM
        }
    }

    fn available_width(&self, indent_mm: f32) -> f32 {
        (PDF_CONTENT_WIDTH_MM - indent_mm).max(50.0)
    }

    fn set_document_reference(&mut self, document_reference: &str) {
        self.document_reference = document_reference.trim().to_string();
    }

    fn finish_page(&mut self) {
        if self.page_ops.is_empty() {
            return;
        }

        if !self.document_reference.is_empty() {
            let header_text = format!("Dokument-Nr.: {}", self.document_reference);
            let font_size_pt = 8.5;
            let text_width_mm = approx_text_width_mm(&header_text, font_size_pt);
            let text_x_mm =
                (PDF_PAGE_WIDTH_MM - PDF_RIGHT_MARGIN_MM - text_width_mm).max(PDF_LEFT_MARGIN_MM);
            let reference_y_mm = if self.page_style == PdfPageStyle::Legal {
                PDF_LEGAL_HEADER_REFERENCE_Y_MM
            } else {
                288.0
            };
            append_pdf_text_line(
                &mut self.page_ops,
                &header_text,
                text_x_mm,
                reference_y_mm,
                font_size_pt,
                &self.regular_font,
                TreatmentPlanPdfColor::Body,
            );
        }

        if self.page_style == PdfPageStyle::Legal {
            // Brand chrome: thin orange rules top and bottom, wordmark in the footer.
            let accent = treatment_plan_pdf_color(TreatmentPlanPdfColor::Primary);
            append_pdf_filled_rect(
                &mut self.page_ops,
                PDF_LEFT_MARGIN_MM,
                PDF_LEGAL_HEADER_RULE_Y_MM,
                PDF_CONTENT_WIDTH_MM,
                0.25,
                accent.clone(),
            );
            append_pdf_filled_rect(
                &mut self.page_ops,
                PDF_LEFT_MARGIN_MM,
                PDF_LEGAL_FOOTER_RULE_Y_MM,
                PDF_CONTENT_WIDTH_MM,
                0.25,
                accent,
            );

            let logo_height_mm = 8.5;
            self.page_ops.extend(crate::pdf_logo::gmed_logo_ops(
                PDF_LEFT_MARGIN_MM,
                PDF_LEGAL_FOOTER_CONTENT_TOP_MM,
                logo_height_mm,
                Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)),
            ));
            let footer_text_x_mm =
                PDF_LEFT_MARGIN_MM + logo_height_mm * crate::pdf_logo::GMED_LOGO_ASPECT + 4.0;
            for (index, line) in self.legal_footer_lines.iter().take(3).enumerate() {
                let line = truncate_text_to_width(line, 6.3, 112.0);
                append_pdf_text_line(
                    &mut self.page_ops,
                    &line,
                    footer_text_x_mm,
                    16.8 - index as f32 * 3.35,
                    6.3,
                    &self.regular_font,
                    TreatmentPlanPdfColor::Muted,
                );
            }
        } else {
            append_pdf_text_line(
                &mut self.page_ops,
                &format!("{} · Page {}", self.footer_text, self.page_number),
                PDF_LEFT_MARGIN_MM,
                PDF_BOTTOM_MARGIN_MM,
                8.0,
                &self.regular_font,
                TreatmentPlanPdfColor::Muted,
            );
        }

        self.pages.push(PdfPage::new(
            Mm(PDF_PAGE_WIDTH_MM),
            Mm(PDF_PAGE_HEIGHT_MM),
            std::mem::take(&mut self.page_ops),
        ));
        self.page_number += 1;
        self.y_mm = self.top_start_y_mm();
    }

    fn ensure_space(&mut self, needed_mm: f32) {
        let content_bottom_mm = if self.page_style == PdfPageStyle::Legal {
            PDF_LEGAL_CONTENT_BOTTOM_MM
        } else {
            PDF_BOTTOM_MARGIN_MM + PDF_FOOTER_GAP_MM
        };
        if self.y_mm - needed_mm < content_bottom_mm {
            self.finish_page();
        }
    }

    fn page_break(&mut self) {
        self.finish_page();
    }

    fn spacer(&mut self, amount_mm: f32) {
        if amount_mm <= 0.0 {
            return;
        }
        self.ensure_space(amount_mm);
        self.y_mm -= amount_mm;
    }

    #[allow(clippy::too_many_arguments)]
    fn text_block(
        &mut self,
        text: &str,
        size_pt: f32,
        bold: bool,
        indent_mm: f32,
        color: TreatmentPlanPdfColor,
        before_mm: f32,
        after_mm: f32,
    ) {
        let lines = wrap_text_to_width(text, size_pt, self.available_width(indent_mm));
        if lines.is_empty() {
            return;
        }

        if before_mm > 0.0 {
            self.spacer(before_mm);
        }

        let line_height_mm = pdf_line_height_mm(size_pt, 1.45);
        let x_mm = PDF_LEFT_MARGIN_MM + indent_mm;
        let font = if bold {
            self.bold_font.clone()
        } else {
            self.regular_font.clone()
        };

        for line in lines {
            self.ensure_space(line_height_mm);
            append_pdf_text_line(
                &mut self.page_ops,
                &line,
                x_mm,
                self.y_mm,
                size_pt,
                &font,
                color,
            );
            self.y_mm -= line_height_mm;
        }

        if after_mm > 0.0 {
            self.spacer(after_mm);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn text_block_justified(
        &mut self,
        text: &str,
        size_pt: f32,
        bold: bool,
        indent_mm: f32,
        color: TreatmentPlanPdfColor,
        before_mm: f32,
        after_mm: f32,
    ) {
        let available_width_mm = self.available_width(indent_mm);
        let lines = wrap_text_to_width_precise(text, size_pt, available_width_mm);
        if lines.is_empty() {
            return;
        }

        if before_mm > 0.0 {
            self.spacer(before_mm);
        }

        let line_height_mm = pdf_line_height_mm(size_pt, 1.45);
        let x_mm = PDF_LEFT_MARGIN_MM + indent_mm;
        let font = if bold {
            self.bold_font.clone()
        } else {
            self.regular_font.clone()
        };
        let last_line_index = lines.len() - 1;

        for (line_index, line) in lines.into_iter().enumerate() {
            self.ensure_space(line_height_mm);
            if line_index == last_line_index {
                append_pdf_text_line(
                    &mut self.page_ops,
                    &line,
                    x_mm,
                    self.y_mm,
                    size_pt,
                    &font,
                    color,
                );
            } else {
                append_pdf_justified_text_line(
                    &mut self.page_ops,
                    &line,
                    x_mm,
                    self.y_mm,
                    size_pt,
                    available_width_mm,
                    &font,
                    color,
                );
            }
            self.y_mm -= line_height_mm;
        }

        if after_mm > 0.0 {
            self.spacer(after_mm);
        }
    }

    /// Header row in the approved table anatomy: uppercase micro-labels above a
    /// strong ink rule — no fill, no vertical separators.
    fn table_header_row(&mut self, cells: &[(&str, f32, PdfCellAlign)]) {
        let upper = cells
            .iter()
            .map(|(text, width_mm, align)| (text.to_uppercase(), *width_mm, *align))
            .collect::<Vec<_>>();
        let borrowed = upper
            .iter()
            .map(|(text, width_mm, align)| (text.as_str(), *width_mm, *align))
            .collect::<Vec<_>>();
        self.table_row_styled(&borrowed, true, false, true, true);
    }

    fn table_row_aligned(
        &mut self,
        cells: &[(&str, f32, PdfCellAlign)],
        bold: bool,
        emphasized: bool,
    ) {
        self.table_row_styled(cells, bold, emphasized, false, true);
    }

    fn table_row_aligned_without_rule(
        &mut self,
        cells: &[(&str, f32, PdfCellAlign)],
        bold: bool,
        emphasized: bool,
    ) {
        self.table_row_styled(cells, bold, emphasized, false, false);
    }

    fn table_row_styled(
        &mut self,
        cells: &[(&str, f32, PdfCellAlign)],
        bold: bool,
        emphasized: bool,
        header: bool,
        draw_body_rule: bool,
    ) {
        if cells.is_empty() {
            return;
        }

        // Column widths at the call sites are relative weights; normalise them
        // to the content width so tables always end exactly at the right margin.
        let total_width_mm: f32 = cells.iter().map(|(_, width_mm, _)| width_mm).sum();
        let width_scale = if total_width_mm > 0.0 {
            PDF_CONTENT_WIDTH_MM / total_width_mm
        } else {
            1.0
        };
        let cells = cells
            .iter()
            .map(|(text, width_mm, align)| (*text, width_mm * width_scale, *align))
            .collect::<Vec<_>>();

        let font_size_pt = if header {
            7.5
        } else if bold {
            9.0
        } else {
            9.5
        };
        let line_height_mm = pdf_line_height_mm(font_size_pt, 1.25);
        let wrapped_cells = cells
            .iter()
            .map(|(text, width_mm, _)| {
                wrap_text_to_width(text, font_size_pt, (width_mm - 4.0).max(12.0))
            })
            .collect::<Vec<_>>();
        let line_count = wrapped_cells.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let row_height_mm = line_count as f32 * line_height_mm + 4.0;
        self.ensure_space(row_height_mm + 0.4);

        let row_top_mm = self.y_mm;
        let row_bottom_mm = row_top_mm - row_height_mm;
        // Open table anatomy from the approved design: no vertical rules and no
        // outer box. Headers close with a strong ink rule, body rows with a warm
        // hairline; the totals row gets the brand-soft emphasis fill.
        if emphasized {
            append_pdf_filled_rect(
                &mut self.page_ops,
                PDF_LEFT_MARGIN_MM,
                row_bottom_mm,
                PDF_CONTENT_WIDTH_MM,
                row_height_mm,
                Color::Rgb(Rgb::new(1.0, 0.957, 0.929, None)),
            );
            append_pdf_filled_rect(
                &mut self.page_ops,
                PDF_LEFT_MARGIN_MM,
                row_top_mm - 0.4,
                PDF_CONTENT_WIDTH_MM,
                0.4,
                treatment_plan_pdf_color(TreatmentPlanPdfColor::Primary),
            );
        }
        if header {
            append_pdf_filled_rect(
                &mut self.page_ops,
                PDF_LEFT_MARGIN_MM,
                row_bottom_mm,
                PDF_CONTENT_WIDTH_MM,
                0.4,
                treatment_plan_pdf_color(TreatmentPlanPdfColor::Body),
            );
        } else if !emphasized && draw_body_rule {
            append_pdf_filled_rect(
                &mut self.page_ops,
                PDF_LEFT_MARGIN_MM,
                row_bottom_mm,
                PDF_CONTENT_WIDTH_MM,
                0.2,
                Color::Rgb(Rgb::new(0.84, 0.83, 0.82, None)),
            );
        }

        let font = if bold {
            self.bold_font.clone()
        } else {
            self.regular_font.clone()
        };
        let text_color = if header {
            TreatmentPlanPdfColor::Muted
        } else {
            TreatmentPlanPdfColor::Body
        };
        let mut x_mm = PDF_LEFT_MARGIN_MM;
        for ((_, width_mm, align), lines) in cells.iter().zip(wrapped_cells.iter()) {
            for (line_index, line) in lines.iter().enumerate() {
                let text_x_mm = match align {
                    PdfCellAlign::Left => x_mm + 2.0,
                    PdfCellAlign::Right => {
                        (x_mm + width_mm - 2.0 - approx_text_width_mm(line, font_size_pt))
                            .max(x_mm + 2.0)
                    }
                };
                append_pdf_text_line(
                    &mut self.page_ops,
                    line,
                    text_x_mm,
                    row_top_mm - 3.6 - line_index as f32 * line_height_mm,
                    font_size_pt,
                    &font,
                    text_color,
                );
            }
            x_mm += *width_mm;
        }
        self.y_mm = row_bottom_mm;
    }

    /// Centred variant of `text_block` for titles and letterhead lines.
    #[allow(clippy::too_many_arguments)]
    fn text_block_centered(
        &mut self,
        text: &str,
        size_pt: f32,
        bold: bool,
        color: TreatmentPlanPdfColor,
        before_mm: f32,
        after_mm: f32,
    ) {
        let lines = wrap_text_to_width(text, size_pt, self.available_width(0.0));
        if lines.is_empty() {
            return;
        }

        if before_mm > 0.0 {
            self.spacer(before_mm);
        }

        let line_height_mm = pdf_line_height_mm(size_pt, 1.45);
        let font = if bold {
            self.bold_font.clone()
        } else {
            self.regular_font.clone()
        };
        for line in lines {
            self.ensure_space(line_height_mm);
            let width_mm = approx_text_width_mm(&line, size_pt);
            let x_mm = PDF_LEFT_MARGIN_MM + ((PDF_CONTENT_WIDTH_MM - width_mm) / 2.0).max(0.0);
            append_pdf_text_line(
                &mut self.page_ops,
                &line,
                x_mm,
                self.y_mm,
                size_pt,
                &font,
                color,
            );
            self.y_mm -= line_height_mm;
        }

        if after_mm > 0.0 {
            self.spacer(after_mm);
        }
    }

    fn key_value_rows_centered(
        &mut self,
        rows: &[(&str, &str)],
        size_pt: f32,
        before_mm: f32,
        after_mm: f32,
    ) {
        if rows.is_empty() {
            return;
        }

        if before_mm > 0.0 {
            self.spacer(before_mm);
        }

        let label_width_mm = rows
            .iter()
            .map(|(label, _)| approx_text_width_mm(&format!("{label}:"), size_pt))
            .fold(0.0, f32::max);
        let value_width_mm = rows
            .iter()
            .map(|(_, value)| approx_text_width_mm(value, size_pt))
            .fold(0.0, f32::max);
        let column_gap_mm = 4.0;
        let group_width_mm =
            (label_width_mm + column_gap_mm + value_width_mm).min(PDF_CONTENT_WIDTH_MM);
        let group_x_mm =
            PDF_LEFT_MARGIN_MM + ((PDF_CONTENT_WIDTH_MM - group_width_mm) / 2.0).max(0.0);
        let value_x_mm = group_x_mm + label_width_mm + column_gap_mm;
        let line_height_mm = pdf_line_height_mm(size_pt, 1.45);
        let font = self.regular_font.clone();

        for (label, value) in rows {
            self.ensure_space(line_height_mm);
            let label = format!("{label}:");
            let label_x_mm = group_x_mm + label_width_mm - approx_text_width_mm(&label, size_pt);
            append_pdf_text_line(
                &mut self.page_ops,
                &label,
                label_x_mm,
                self.y_mm,
                size_pt,
                &font,
                TreatmentPlanPdfColor::Body,
            );
            append_pdf_text_line(
                &mut self.page_ops,
                value,
                value_x_mm,
                self.y_mm,
                size_pt,
                &font,
                TreatmentPlanPdfColor::Body,
            );
            self.y_mm -= line_height_mm;
        }

        if after_mm > 0.0 {
            self.spacer(after_mm);
        }
    }

    fn finish(mut self) -> Vec<PdfPage> {
        self.finish_page();
        if self.page_style == PdfPageStyle::Legal {
            let total_pages = self.pages.len();
            let regular_font = self.regular_font.clone();
            for (index, page) in self.pages.iter_mut().enumerate() {
                let label = format!("Seite: {}/{}", index + 1, total_pages);
                // Right-aligned inside the content column.
                let width_mm = label.chars().count() as f32 * pt_to_mm(7.0) * 0.54;
                let x_mm =
                    (PDF_PAGE_WIDTH_MM - PDF_RIGHT_MARGIN_MM - width_mm).max(PDF_LEFT_MARGIN_MM);
                append_pdf_text_line(
                    &mut page.ops,
                    &label,
                    x_mm,
                    16.8,
                    7.0,
                    &regular_font,
                    TreatmentPlanPdfColor::Muted,
                );
            }
        }
        self.pages
    }
}

fn default_generated_document_name(
    template: DocumentTemplateDefinition,
    patient_name: &str,
    generated_at: chrono::DateTime<chrono::Utc>,
    language: &str,
) -> String {
    let base = match (template.id, language) {
        ("framework_contract", "uk") => "Рамковий договір",
        ("framework_contract", "en") => "Framework contract",
        ("framework_contract", _) => "Rahmenvertrag",
        ("visa_invitation_letter", "uk") => "Візове запрошення",
        ("visa_invitation_letter", "en") => "Visa invitation letter",
        ("visa_invitation_letter", _) => "Einladungsschreiben (Visum)",
        (
            "patient_sticker_compact" | "patient_sticker_standard" | "patient_sticker_sheet",
            "uk",
        ) => "Пацієнтський стікер",
        (
            "patient_sticker_compact" | "patient_sticker_standard" | "patient_sticker_sheet",
            "en",
        ) => "Patient sticker",
        ("patient_sticker_compact" | "patient_sticker_standard" | "patient_sticker_sheet", _) => {
            "Patientenaufkleber"
        }
        ("medication_summary", "uk") => "Медикаментозний план",
        ("medication_summary", "en") => "Medication summary",
        ("medication_summary", _) => "Medikamentenübersicht",
        ("treatment_plan", "uk") => "План лікування",
        ("treatment_plan", "en") => "Treatment plan",
        ("treatment_plan", _) => "Behandlungsplan",
        ("single_order", "en") => "Single order",
        ("single_order", _) => "Einzelauftrag",
        ("order_cost_estimate", "en") => "Cost estimate for single order",
        ("order_cost_estimate", _) => "Kostenvoranschlag zum Einzelauftrag",
        ("cost_coverage_declaration", "en") => "Cost coverage declaration",
        ("cost_coverage_declaration", _) => "Kostenübernahmeerklärung",
        ("cost_estimate", "uk") => "Попередній розрахунок витрат",
        ("cost_estimate", "en") => "Preliminary cost calculation",
        ("cost_estimate", _) => "Vorläufige Kostenkalkulation",
        ("privacy_information", _) => "Informationsblatt zum Datenschutz",
        ("appointment_confirmation", "en") => "Appointment confirmation",
        ("appointment_confirmation", _) => "Terminbestätigung",
        ("consent_data_release_child" | "consent_data_release_single", "en") => {
            "Data release consent"
        }
        ("consent_data_release_child" | "consent_data_release_single", _) => {
            "Einverständniserklärung"
        }
        _ => template.default_auto_name,
    };
    format!(
        "{base} · {patient_name} · {}",
        generated_at.format("%Y-%m-%d")
    )
}

fn generated_document_public_id(document_id: Uuid) -> String {
    let simple = document_id.simple().to_string();
    let suffix = simple
        .get(..8)
        .unwrap_or(simple.as_str())
        .to_ascii_uppercase();
    format!("DOC-{suffix}")
}

fn generated_compliance_document_number(
    template_id: &str,
    document_id: Uuid,
    generated_at: chrono::DateTime<chrono::Utc>,
) -> Option<String> {
    let prefix = match template_id {
        "confidentiality_release" => "SE",
        "privacy_consents" | "consent_data_release_child" | "consent_data_release_single" => "EW",
        "privacy_information" => "DS",
        _ => return None,
    };
    let simple = document_id.simple().to_string();
    let suffix = simple
        .get(..12)
        .unwrap_or(simple.as_str())
        .to_ascii_uppercase();
    Some(format!(
        "{prefix}-{}-{suffix}",
        generated_at.format("%Y%m%d")
    ))
}

fn generated_document_number_for_template(
    template_id: &str,
    document_id: Uuid,
    generated_at: chrono::DateTime<chrono::Utc>,
) -> String {
    generated_compliance_document_number(template_id, document_id, generated_at)
        .unwrap_or_else(|| generated_document_public_id(document_id))
}

fn build_treatment_plan_html(context: &GeneratedTreatmentPlanContext) -> String {
    let appointments_by_day = grouped_treatment_plan_appointments(context);

    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "document_title"),
            context.patient_name
        )
    });
    let intro = context
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let closing = context
        .closing_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let treatment_plan_note = context
        .treatment_plan_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut schedule_markup = String::new();
    if appointments_by_day.is_empty() {
        schedule_markup.push_str(&format!(
            "<p class=\"empty\">{}</p>",
            escape_html(translated_label(&context.language, "no_items"))
        ));
    } else {
        for (date, items) in appointments_by_day {
            schedule_markup.push_str(&format!(
                "<section class=\"day\"><h3>{}</h3><div class=\"entries\">",
                escape_html(&format_localized_date(date, &context.language))
            ));
            for item in items {
                let mut meta = Vec::new();
                if let Some(provider_name) = item
                    .provider_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                {
                    meta.push(format!(
                        "{}: {}",
                        translated_label(&context.language, "provider"),
                        escape_html(provider_name)
                    ));
                }
                if let Some(doctor_name) = item
                    .doctor_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                {
                    meta.push(format!(
                        "{}: {}",
                        translated_label(&context.language, "doctor"),
                        escape_html(doctor_name)
                    ));
                }
                if let Some(location) = item.location.as_deref().filter(|value| !value.is_empty()) {
                    meta.push(format!(
                        "{}: {}",
                        translated_label(&context.language, "location"),
                        escape_html(location)
                    ));
                }
                if let Some(category) = item.category.as_deref().filter(|value| !value.is_empty()) {
                    meta.push(format!(
                        "{}: {}",
                        translated_label(&context.language, "category"),
                        escape_html(category)
                    ));
                }

                schedule_markup.push_str(&format!(
                    "<article class=\"entry\"><div class=\"time\">{}</div><div class=\"content\"><div class=\"headline\">{}</div>{}{}</div></article>",
                    escape_html(&format_time_range(item.time_start, item.time_end)),
                    escape_html(&item.title),
                    if meta.is_empty() {
                        String::new()
                    } else {
                        format!("<div class=\"meta\">{}</div>", meta.join(" · "))
                    },
                    item.notes
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| {
                            format!(
                                "<div class=\"note\"><span>{}:</span> {}</div>",
                                escape_html(translated_label(&context.language, "appointment_notes")),
                                escape_html(value)
                            )
                        })
                        .unwrap_or_default()
                ));
            }
            schedule_markup.push_str("</div></section>");
        }
    }

    let note_items =
        if context.text_blocks.is_empty() && closing.is_none() && treatment_plan_note.is_none() {
            String::new()
        } else {
            let mut markup = String::from("<section class=\"notes\"><h2>");
            markup.push_str(&escape_html(translated_label(
                &context.language,
                "notes_heading",
            )));
            markup.push_str("</h2><ul>");
            for block in &context.text_blocks {
                markup.push_str(&format!("<li>{}</li>", escape_html(block)));
            }
            if let Some(treatment_plan_note) = treatment_plan_note {
                markup.push_str(&format!(
                    "<li><strong>{}:</strong> {}</li>",
                    escape_html(translated_label(&context.language, "treatment_plan_note")),
                    escape_html(treatment_plan_note)
                ));
            }
            if let Some(closing) = closing {
                markup.push_str(&format!("<li>{}</li>", escape_html(closing)));
            }
            markup.push_str("</ul></section>");
            markup
        };

    let patient_title = context
        .patient_title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("{} ", escape_html(value.trim())))
        .unwrap_or_default();
    let birth_date = context
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let order_number = context
        .order_number
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(escape_html)
        .unwrap_or_else(|| "n/a".to_string());
    let intro_section = intro
        .map(|value| {
            format!(
                "<section class=\"intro\"><h2>{}</h2><p>{}</p></section>",
                escape_html(translated_label(&context.language, "intro_heading")),
                escape_html(value)
            )
        })
        .unwrap_or_default();

    format!(
        "<!DOCTYPE html><html lang=\"{lang}\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>{title}</title><style>
        :root {{ color-scheme: light; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; background: #e8eef5; color: #0f172a; font-family: Georgia, 'Times New Roman', serif; }}
        main {{ max-width: 960px; margin: 0 auto; padding: 28px; }}
        .sheet {{ background: #fff; border-radius: 24px; padding: 32px; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.12); }}
        .badge {{ display: inline-block; border-radius: 999px; background: #dbeafe; color: #1d4ed8; padding: 6px 12px; font: 600 12px/1.2 Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }}
        h1 {{ margin: 18px 0 10px; font-size: 34px; line-height: 1.15; }}
        h2 {{ margin: 0 0 10px; font-size: 18px; line-height: 1.3; }}
        h3 {{ margin: 0 0 14px; font-size: 22px; line-height: 1.25; }}
        p {{ margin: 0; line-height: 1.6; }}
        .meta-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 22px; }}
        .meta-card {{ border: 1px solid #d7dee7; border-radius: 18px; padding: 14px 16px; background: #f8fafc; }}
        .meta-card .label {{ display: block; margin-bottom: 6px; color: #475569; font: 600 11px/1.2 Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }}
        .intro, .notes {{ margin-top: 24px; padding: 20px 22px; border-radius: 20px; background: #f8fafc; border: 1px solid #d7dee7; }}
        .notes ul {{ margin: 0; padding-left: 22px; }}
        .notes li + li {{ margin-top: 10px; }}
        .day {{ margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; }}
        .entries {{ display: grid; gap: 14px; }}
        .entry {{ display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: 16px; align-items: start; padding: 16px 18px; border-radius: 18px; background: #f8fafc; border: 1px solid #d7dee7; }}
        .time {{ font: 700 16px/1.3 Arial, sans-serif; color: #0f172a; }}
        .headline {{ font-weight: 700; font-size: 18px; line-height: 1.35; }}
        .meta {{ margin-top: 8px; color: #475569; font: 500 13px/1.5 Arial, sans-serif; }}
        .note {{ margin-top: 10px; color: #334155; font: 400 14px/1.55 Arial, sans-serif; }}
        .note span {{ font-weight: 700; }}
        .footer {{ margin-top: 28px; color: #64748b; font: 500 12px/1.5 Arial, sans-serif; }}
        .empty {{ margin-top: 18px; color: #64748b; font: 500 15px/1.5 Arial, sans-serif; }}
        @media print {{
          body {{ background: #fff; }}
          main {{ max-width: none; padding: 0; }}
          .sheet {{ box-shadow: none; border-radius: 0; padding: 0; }}
        }}
        @media (max-width: 720px) {{
          main {{ padding: 0; }}
          .sheet {{ border-radius: 0; padding: 22px; }}
          .entry {{ grid-template-columns: 1fr; }}
        }}
        </style></head><body><main><div class=\"sheet\"><div class=\"badge\">{draft_badge}</div><h1>{title}</h1><div class=\"meta-grid\">
        <div class=\"meta-card\"><span class=\"label\">{created_on}</span><strong>{created_value}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{patient_id_label}</span><strong>{patient_pid}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{birth_date_label}</span><strong>{birth_date}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{order_number_label}</span><strong>{order_number}</strong></div>
        </div>
        <div class=\"meta-grid\">
        <div class=\"meta-card\"><span class=\"label\">Patient</span><strong>{patient_title}{patient_name}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">Template</span><strong>{auto_name}</strong></div>
        </div>
        {intro_section}
        <section class=\"day\"><h2>{program_heading}</h2></section>
        {schedule_markup}
        {note_items}
        <div class=\"footer\">{generated_footer}: {generated_at}</div>
        </div></main></body></html>",
        lang = escape_html(&context.language),
        title = escape_html(&title),
        draft_badge = escape_html(translated_label(&context.language, "draft_badge")),
        created_on = escape_html(translated_label(&context.language, "created_on")),
        created_value = escape_html(&context.generated_at.format("%d.%m.%Y").to_string()),
        patient_id_label = escape_html(translated_label(&context.language, "patient_id")),
        patient_pid = escape_html(&context.patient_pid),
        birth_date_label = escape_html(translated_label(&context.language, "birth_date")),
        birth_date = escape_html(&birth_date),
        order_number_label = escape_html(translated_label(&context.language, "order_number")),
        order_number = order_number,
        patient_title = patient_title,
        patient_name = escape_html(&context.patient_name),
        auto_name = escape_html(&context.auto_name),
        intro_section = intro_section,
        program_heading = escape_html(translated_label(&context.language, "program_heading")),
        schedule_markup = schedule_markup,
        note_items = note_items,
        generated_footer = escape_html(translated_label(&context.language, "generated_footer")),
        generated_at = escape_html(&context.generated_at.to_rfc3339()),
    )
}

fn build_treatment_plan_pdf(
    context: &GeneratedTreatmentPlanContext,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(&context.auto_name);
    let (regular_handle, bold_handle) = pdf_text_font_handles();

    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "document_title"),
            context.patient_name
        )
    });
    let birth_date = context
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let order_number = context
        .order_number
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "n/a".to_string());
    let patient_line = match context
        .patient_title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(title_prefix) => format!("{title_prefix} {}", context.patient_name),
        None => context.patient_name.clone(),
    };

    let footer_text = format!(
        "{}: {}",
        translated_label(&context.language, "generated_footer"),
        context.generated_at.format("%d.%m.%Y %H:%M UTC")
    );
    let mut layout = TreatmentPlanPdfLayout::new(footer_text, regular_handle, bold_handle);
    layout.set_document_reference(document_reference);

    layout.text_block(
        translated_label(&context.language, "draft_badge"),
        10.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Primary,
        0.0,
        4.0,
    );
    layout.text_block(
        &title,
        22.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        6.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "created_on"),
            context.generated_at.format("%d.%m.%Y")
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "patient_id"),
            context.patient_pid
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "birth_date"),
            birth_date
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "order_number"),
            order_number
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        4.0,
    );
    layout.text_block(
        &format!("Patient: {patient_line}"),
        12.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        6.0,
    );

    if let Some(introduction) = context
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            translated_label(&context.language, "intro_heading"),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Body,
            2.0,
            2.0,
        );
        layout.text_block(
            introduction,
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            4.0,
        );
    }

    layout.text_block(
        translated_label(&context.language, "program_heading"),
        14.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        2.0,
        4.0,
    );

    for (date, items) in grouped_treatment_plan_appointments(context) {
        layout.text_block(
            &format_localized_date(date, &context.language),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Primary,
            3.0,
            2.0,
        );

        for item in items {
            layout.text_block(
                &format!(
                    "{}  {}",
                    format_time_range(item.time_start, item.time_end),
                    item.title
                ),
                11.5,
                true,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );

            let mut meta = Vec::new();
            if let Some(provider_name) = item
                .provider_name
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "provider"),
                    provider_name
                ));
            }
            if let Some(doctor_name) = item
                .doctor_name
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "doctor"),
                    doctor_name
                ));
            }
            if let Some(location) = item.location.as_deref().filter(|value| !value.is_empty()) {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "location"),
                    location
                ));
            }
            if let Some(category) = item.category.as_deref().filter(|value| !value.is_empty()) {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "category"),
                    category
                ));
            }
            if !meta.is_empty() {
                layout.text_block(
                    &meta.join(" · "),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Muted,
                    0.0,
                    1.0,
                );
            }
            if let Some(notes) = item
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "appointment_notes"),
                        notes
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Body,
                    0.0,
                    1.0,
                );
            }
            layout.spacer(1.0);
        }
    }

    if !context.text_blocks.is_empty()
        || context
            .closing_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
        || context
            .treatment_plan_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
    {
        layout.text_block(
            translated_label(&context.language, "notes_heading"),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Body,
            4.0,
            2.0,
        );

        for block in &context.text_blocks {
            layout.text_block(
                &format!("- {block}"),
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );
        }
        if let Some(treatment_plan_note) = context
            .treatment_plan_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            layout.text_block(
                &format!(
                    "- {}: {}",
                    translated_label(&context.language, "treatment_plan_note"),
                    treatment_plan_note
                ),
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );
        }
        if let Some(closing) = context
            .closing_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            layout.text_block(
                &format!("- {closing}"),
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );
        }
    }

    let pages = layout.finish();
    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    let save_options = pdf_text_save_options();
    Ok(document
        .with_pages(pages)
        .save(&save_options, &mut save_warnings))
}

fn build_medication_summary_html(context: &GeneratedMedicationSummaryContext) -> String {
    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "medication_title"),
            context.patient_name
        )
    });
    let intro = context
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let closing = context
        .closing_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let render_section = |medication_type: &str| {
        let items = context
            .medications
            .iter()
            .filter(|item| normalized_medication_type(&item.medication_type) == medication_type)
            .collect::<Vec<_>>();
        if items.is_empty() {
            return String::new();
        }

        let mut markup = format!(
            "<section class=\"day\"><h2>{}</h2><div class=\"entries\">",
            escape_html(medication_heading(&context.language, medication_type))
        );
        for item in items {
            let has_trade_name = !item.trade_name.trim().is_empty();
            let ingredient = item
                .ingredient
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let dose = format_medication_dose(item);
            let schedule = item
                .schedule
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let dosage_form = item
                .dosage_form
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let reason = item
                .reason
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let prescribing_doctor = item
                .prescribing_doctor
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let since = item
                .since
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let expiry_date = item
                .expiry_date
                .map(|value| value.format("%d.%m.%Y").to_string());
            let note = item
                .note
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let source_label = item
                .source_case_reason
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("{} · {}", item.source_case_id, value))
                .unwrap_or_else(|| item.source_case_id.clone());

            let mut meta = Vec::new();
            if has_trade_name && let Some(ingredient) = ingredient {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "ingredient"),
                    escape_html(ingredient)
                ));
            }
            if let Some(dose) = dose.as_deref() {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "dose"),
                    escape_html(dose)
                ));
            }
            if let Some(schedule) = schedule {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "schedule"),
                    escape_html(schedule)
                ));
            }
            if let Some(dosage_form) = dosage_form {
                meta.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "dosage_form"),
                    escape_html(dosage_form)
                ));
            }

            let mut secondary = Vec::new();
            if let Some(reason) = reason {
                secondary.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "medication_reason"),
                    escape_html(reason)
                ));
            }
            if let Some(prescribing_doctor) = prescribing_doctor {
                secondary.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "prescribed_by"),
                    escape_html(prescribing_doctor)
                ));
            }
            if let Some(since) = since {
                secondary.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "since"),
                    escape_html(since)
                ));
            }
            if let Some(expiry_date) = expiry_date.as_deref() {
                secondary.push(format!(
                    "{}: {}",
                    translated_label(&context.language, "expiry_date"),
                    escape_html(expiry_date)
                ));
            }
            secondary.push(format!(
                "{}: {}",
                translated_label(&context.language, "source_case"),
                escape_html(&source_label)
            ));

            markup.push_str(&format!(
                "<article class=\"entry medication-entry\"><div class=\"content\"><div class=\"headline\">{}</div>{}{}{}</div></article>",
                escape_html(if has_trade_name {
                    item.trade_name.trim()
                } else {
                    ingredient.unwrap_or("—")
                }),
                if meta.is_empty() {
                    String::new()
                } else {
                    format!("<div class=\"meta\">{}</div>", meta.join(" · "))
                },
                if secondary.is_empty() {
                    String::new()
                } else {
                    format!("<div class=\"meta secondary\">{}</div>", secondary.join(" · "))
                },
                note
                    .map(|value| {
                        format!(
                            "<div class=\"note\"><span>{}:</span> {}</div>",
                            escape_html(translated_label(&context.language, "medication_note")),
                            escape_html(value)
                        )
                    })
                    .unwrap_or_default()
            ));
        }
        markup.push_str("</div></section>");
        markup
    };

    let medications_markup = {
        let permanent = render_section("permanent");
        let temporary = render_section("temporary");
        if permanent.is_empty() && temporary.is_empty() {
            format!(
                "<p class=\"empty\">{}</p>",
                escape_html(translated_label(&context.language, "no_medications"))
            )
        } else {
            format!("{permanent}{temporary}")
        }
    };

    let note_items = if context.text_blocks.is_empty() && closing.is_none() {
        String::new()
    } else {
        let mut markup = String::from("<section class=\"notes\"><h2>");
        markup.push_str(&escape_html(translated_label(
            &context.language,
            "notes_heading",
        )));
        markup.push_str("</h2><ul>");
        for block in &context.text_blocks {
            markup.push_str(&format!("<li>{}</li>", escape_html(block)));
        }
        if let Some(closing) = closing {
            markup.push_str(&format!("<li>{}</li>", escape_html(closing)));
        }
        markup.push_str("</ul></section>");
        markup
    };

    let patient_title = context
        .patient_title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("{} ", escape_html(value.trim())))
        .unwrap_or_default();
    let birth_date = context
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let intro_section = intro
        .map(|value| {
            format!(
                "<section class=\"intro\"><h2>{}</h2><p>{}</p></section>",
                escape_html(translated_label(&context.language, "intro_heading")),
                escape_html(value)
            )
        })
        .unwrap_or_default();

    format!(
        "<!DOCTYPE html><html lang=\"{lang}\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>{title}</title><style>
        :root {{ color-scheme: light; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; background: #e8eef5; color: #0f172a; font-family: Georgia, 'Times New Roman', serif; }}
        main {{ max-width: 960px; margin: 0 auto; padding: 28px; }}
        .sheet {{ background: #fff; border-radius: 24px; padding: 32px; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.12); }}
        .badge {{ display: inline-block; border-radius: 999px; background: #dbeafe; color: #1d4ed8; padding: 6px 12px; font: 600 12px/1.2 Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }}
        h1 {{ margin: 18px 0 10px; font-size: 34px; line-height: 1.15; }}
        h2 {{ margin: 0 0 10px; font-size: 18px; line-height: 1.3; }}
        p {{ margin: 0; line-height: 1.6; }}
        .meta-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 22px; }}
        .meta-card {{ border: 1px solid #d7dee7; border-radius: 18px; padding: 14px 16px; background: #f8fafc; }}
        .meta-card .label {{ display: block; margin-bottom: 6px; color: #475569; font: 600 11px/1.2 Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }}
        .intro, .notes {{ margin-top: 24px; padding: 20px 22px; border-radius: 20px; background: #f8fafc; border: 1px solid #d7dee7; }}
        .notes ul {{ margin: 0; padding-left: 22px; }}
        .notes li + li {{ margin-top: 10px; }}
        .day {{ margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; }}
        .entries {{ display: grid; gap: 14px; }}
        .entry {{ padding: 16px 18px; border-radius: 18px; background: #f8fafc; border: 1px solid #d7dee7; }}
        .headline {{ font-weight: 700; font-size: 18px; line-height: 1.35; }}
        .meta {{ margin-top: 8px; color: #475569; font: 500 13px/1.5 Arial, sans-serif; }}
        .meta.secondary {{ color: #334155; }}
        .note {{ margin-top: 10px; color: #334155; font: 400 14px/1.55 Arial, sans-serif; }}
        .note span {{ font-weight: 700; }}
        .footer {{ margin-top: 28px; color: #64748b; font: 500 12px/1.5 Arial, sans-serif; }}
        .empty {{ margin-top: 18px; color: #64748b; font: 500 15px/1.5 Arial, sans-serif; }}
        @media print {{
          body {{ background: #fff; }}
          main {{ max-width: none; padding: 0; }}
          .sheet {{ box-shadow: none; border-radius: 0; padding: 0; }}
        }}
        </style></head><body><main><div class=\"sheet\"><div class=\"badge\">{draft_badge}</div><h1>{title}</h1><div class=\"meta-grid\">
        <div class=\"meta-card\"><span class=\"label\">{created_on}</span><strong>{created_value}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{patient_id_label}</span><strong>{patient_pid}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{birth_date_label}</span><strong>{birth_date}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">Scope</span><strong>{scope_note}</strong></div>
        </div>
        <div class=\"meta-grid\">
        <div class=\"meta-card\"><span class=\"label\">Patient</span><strong>{patient_title}{patient_name}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">Template</span><strong>{auto_name}</strong></div>
        </div>
        {intro_section}
        <section class=\"day\"><h2>{medication_heading}</h2></section>
        {medications_markup}
        {note_items}
        <div class=\"footer\">{generated_footer}: {generated_at}</div>
        </div></main></body></html>",
        lang = escape_html(&context.language),
        title = escape_html(&title),
        draft_badge = escape_html(translated_label(&context.language, "draft_badge")),
        created_on = escape_html(translated_label(&context.language, "created_on")),
        created_value = escape_html(&context.generated_at.format("%d.%m.%Y").to_string()),
        patient_id_label = escape_html(translated_label(&context.language, "patient_id")),
        patient_pid = escape_html(&context.patient_pid),
        birth_date_label = escape_html(translated_label(&context.language, "birth_date")),
        birth_date = escape_html(&birth_date),
        scope_note = escape_html(&context.scope_note),
        patient_title = patient_title,
        patient_name = escape_html(&context.patient_name),
        auto_name = escape_html(&context.auto_name),
        intro_section = intro_section,
        medication_heading = escape_html(translated_label(&context.language, "medication_heading")),
        medications_markup = medications_markup,
        note_items = note_items,
        generated_footer = escape_html(translated_label(&context.language, "generated_footer")),
        generated_at = escape_html(&context.generated_at.to_rfc3339()),
    )
}

fn build_medication_summary_pdf(
    context: &GeneratedMedicationSummaryContext,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(&context.auto_name);
    let (regular_handle, bold_handle) = pdf_text_font_handles();

    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "medication_title"),
            context.patient_name
        )
    });
    let birth_date = context
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let patient_line = match context
        .patient_title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(title_prefix) => format!("{title_prefix} {}", context.patient_name),
        None => context.patient_name.clone(),
    };

    let footer_text = format!(
        "{}: {}",
        translated_label(&context.language, "generated_footer"),
        context.generated_at.format("%d.%m.%Y %H:%M UTC")
    );
    let mut layout = TreatmentPlanPdfLayout::new(footer_text, regular_handle, bold_handle);
    layout.set_document_reference(document_reference);

    layout.text_block(
        translated_label(&context.language, "draft_badge"),
        10.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Primary,
        0.0,
        4.0,
    );
    layout.text_block(
        &title,
        22.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        6.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "created_on"),
            context.generated_at.format("%d.%m.%Y")
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "patient_id"),
            context.patient_pid
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "birth_date"),
            birth_date
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    layout.text_block(
        &context.scope_note,
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        4.0,
    );
    layout.text_block(
        &format!("Patient: {patient_line}"),
        12.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        6.0,
    );

    if let Some(introduction) = context
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            translated_label(&context.language, "intro_heading"),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Body,
            2.0,
            2.0,
        );
        layout.text_block(
            introduction,
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            4.0,
        );
    }

    layout.text_block(
        translated_label(&context.language, "medication_heading"),
        14.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        2.0,
        4.0,
    );

    for medication_type in ["permanent", "temporary"] {
        let items = context
            .medications
            .iter()
            .filter(|item| normalized_medication_type(&item.medication_type) == medication_type)
            .collect::<Vec<_>>();
        if items.is_empty() {
            continue;
        }

        layout.text_block(
            medication_heading(&context.language, medication_type),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Primary,
            3.0,
            2.0,
        );

        for item in items {
            let has_trade_name = !item.trade_name.trim().is_empty();
            let ingredient = item
                .ingredient
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            layout.text_block(
                if has_trade_name {
                    item.trade_name.trim()
                } else {
                    ingredient.unwrap_or("—")
                },
                11.5,
                true,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );

            let schedule = item
                .schedule
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let dosage_form = item
                .dosage_form
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let reason = item
                .reason
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let prescribing_doctor = item
                .prescribing_doctor
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let since = item
                .since
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let expiry_date = item
                .expiry_date
                .map(|value| value.format("%d.%m.%Y").to_string());
            let note = item
                .note
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());

            if has_trade_name && let Some(ingredient) = ingredient {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "ingredient"),
                        ingredient
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Muted,
                    0.0,
                    0.8,
                );
            }
            if let Some(dose) = format_medication_dose(item) {
                layout.text_block(
                    &format!("{}: {}", translated_label(&context.language, "dose"), dose),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Muted,
                    0.0,
                    0.8,
                );
            }
            if let Some(schedule) = schedule {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "schedule"),
                        schedule
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Muted,
                    0.0,
                    0.8,
                );
            }
            if let Some(dosage_form) = dosage_form {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "dosage_form"),
                        dosage_form
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Muted,
                    0.0,
                    0.8,
                );
            }
            if let Some(reason) = reason {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "medication_reason"),
                        reason
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Body,
                    0.0,
                    0.8,
                );
            }
            if let Some(prescribing_doctor) = prescribing_doctor {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "prescribed_by"),
                        prescribing_doctor
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Body,
                    0.0,
                    0.8,
                );
            }
            if let Some(since) = since {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "since"),
                        since
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Body,
                    0.0,
                    0.8,
                );
            }
            if let Some(expiry_date) = expiry_date.as_deref() {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "expiry_date"),
                        expiry_date
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Body,
                    0.0,
                    0.8,
                );
            }
            let source_label = item
                .source_case_reason
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("{} · {}", item.source_case_id, value))
                .unwrap_or_else(|| item.source_case_id.clone());
            layout.text_block(
                &format!(
                    "{}: {}",
                    translated_label(&context.language, "source_case"),
                    source_label
                ),
                10.0,
                false,
                10.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                0.8,
            );
            if let Some(note) = note {
                layout.text_block(
                    &format!(
                        "{}: {}",
                        translated_label(&context.language, "medication_note"),
                        note
                    ),
                    10.0,
                    false,
                    10.0,
                    TreatmentPlanPdfColor::Body,
                    0.0,
                    1.0,
                );
            }
            layout.spacer(1.0);
        }
    }

    if !context.text_blocks.is_empty()
        || context
            .closing_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
    {
        layout.text_block(
            translated_label(&context.language, "notes_heading"),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Body,
            4.0,
            2.0,
        );

        for block in &context.text_blocks {
            layout.text_block(
                &format!("- {block}"),
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );
        }
        if let Some(closing) = context
            .closing_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            layout.text_block(
                &format!("- {closing}"),
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );
        }
    }

    let pages = layout.finish();
    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    let save_options = pdf_text_save_options();
    Ok(document
        .with_pages(pages)
        .save(&save_options, &mut save_warnings))
}

fn build_framework_contract_html(context: &GeneratedFrameworkContractContext) -> String {
    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "framework_contract_title"),
            context.patient_name
        )
    });
    let intro = context
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let closing = context
        .closing_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let birth_date = context
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let patient_title = context
        .patient_title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("{} ", escape_html(value.trim())))
        .unwrap_or_default();

    let intro_section = intro
        .map(|value| {
            format!(
                "<section class=\"intro\"><h2>{}</h2><p>{}</p></section>",
                escape_html(translated_label(&context.language, "intro_heading")),
                escape_html(value)
            )
        })
        .unwrap_or_default();

    let conditions_markup = if context.conditions.is_empty() {
        String::new()
    } else {
        let mut markup = format!(
            "<section class=\"notes\"><h2>{}</h2><ul>",
            escape_html(translated_label(
                &context.language,
                "contract_conditions_heading"
            ))
        );
        for (key, value) in &context.conditions {
            markup.push_str(&format!(
                "<li><strong>{}:</strong> {}</li>",
                escape_html(key),
                escape_html(value)
            ));
        }
        markup.push_str("</ul></section>");
        markup
    };

    let terms_markup = if context.text_blocks.is_empty() && closing.is_none() {
        String::new()
    } else {
        let mut markup = format!(
            "<section class=\"notes\"><h2>{}</h2><ul>",
            escape_html(translated_label(
                &context.language,
                "contract_terms_heading"
            ))
        );
        for block in &context.text_blocks {
            markup.push_str(&format!("<li>{}</li>", escape_html(block)));
        }
        if let Some(closing) = closing {
            markup.push_str(&format!("<li>{}</li>", escape_html(closing)));
        }
        markup.push_str("</ul></section>");
        markup
    };

    let quote_section = if context.quote_number.is_none()
        && context.quote_total_gross.is_none()
        && context.line_items.is_empty()
        && context
            .quote_notes
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        String::new()
    } else {
        let services = if context.line_items.is_empty() {
            format!(
                "<p class=\"empty\">{}</p>",
                escape_html(translated_label(&context.language, "no_services"))
            )
        } else {
            let mut rows = String::new();
            for item in &context.line_items {
                let detail_line = [
                    Some(format!(
                        "{}: {}",
                        translated_label(&context.language, "service_quantity"),
                        item.quantity
                    )),
                    (!item.unit_price.trim().is_empty()).then(|| {
                        format!(
                            "{}: {}",
                            translated_label(&context.language, "service_unit_price"),
                            item.unit_price
                        )
                    }),
                    (!item.line_gross.trim().is_empty()).then(|| {
                        format!(
                            "{}: {}",
                            translated_label(&context.language, "service_total"),
                            item.line_gross
                        )
                    }),
                    item.vat_rate.as_ref().map(|vat| {
                        format!(
                            "{}: {}%",
                            translated_label(&context.language, "total_vat"),
                            vat
                        )
                    }),
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
                rows.push_str(&format!(
                    "<article class=\"entry\"><div class=\"content\"><div class=\"headline\">{}</div>{}{}</div></article>",
                    escape_html(&item.description),
                    if detail_line.is_empty() {
                        String::new()
                    } else {
                        format!("<div class=\"meta\">{}</div>", escape_html(&detail_line))
                    },
                    item.notes
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| {
                            format!(
                                "<div class=\"note\"><span>{}:</span> {}</div>",
                                escape_html(translated_label(&context.language, "appointment_notes")),
                                escape_html(value)
                            )
                        })
                        .unwrap_or_default()
                ));
            }
            format!("<div class=\"entries\">{rows}</div>")
        };

        format!(
            "<section class=\"day\"><h2>{quote_heading}</h2><div class=\"meta-grid\">
              <div class=\"meta-card\"><span class=\"label\">{quote_number_label}</span><strong>{quote_number}</strong></div>
              <div class=\"meta-card\"><span class=\"label\">{quote_valid_until_label}</span><strong>{quote_valid_until}</strong></div>
              <div class=\"meta-card\"><span class=\"label\">{total_net_label}</span><strong>{total_net}</strong></div>
              <div class=\"meta-card\"><span class=\"label\">{total_vat_label}</span><strong>{total_vat}</strong></div>
              <div class=\"meta-card\"><span class=\"label\">{total_gross_label}</span><strong>{total_gross}</strong></div>
            </div>
            {quote_notes}
            <section class=\"day\"><h3>{services_heading}</h3>{services}</section></section>",
            quote_heading = escape_html(translated_label(&context.language, "quote_heading")),
            quote_number_label = escape_html(translated_label(&context.language, "quote_number")),
            quote_number = escape_html(context.quote_number.as_deref().unwrap_or("n/a")),
            quote_valid_until_label = escape_html(translated_label(&context.language, "quote_valid_until")),
            quote_valid_until = escape_html(
                &context
                    .quote_valid_until
                    .map(|value| value.format("%d.%m.%Y").to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
            ),
            total_net_label = escape_html(translated_label(&context.language, "total_net")),
            total_net = escape_html(context.quote_total_net.as_deref().unwrap_or("n/a")),
            total_vat_label = escape_html(translated_label(&context.language, "total_vat")),
            total_vat = escape_html(context.quote_total_vat.as_deref().unwrap_or("n/a")),
            total_gross_label = escape_html(translated_label(&context.language, "total_gross")),
            total_gross = escape_html(context.quote_total_gross.as_deref().unwrap_or("n/a")),
            quote_notes = context
                .quote_notes
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("<div class=\"note\">{}</div>", escape_html(value)))
                .unwrap_or_default(),
            services_heading = escape_html(translated_label(&context.language, "services_heading")),
            services = services,
        )
    };

    format!(
        "<!DOCTYPE html><html lang=\"{lang}\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>{title}</title><style>
        :root {{ color-scheme: light; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; background: #e8eef5; color: #0f172a; font-family: Georgia, 'Times New Roman', serif; }}
        main {{ max-width: 960px; margin: 0 auto; padding: 28px; }}
        .sheet {{ background: #fff; border-radius: 24px; padding: 32px; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.12); }}
        .badge {{ display: inline-block; border-radius: 999px; background: #dbeafe; color: #1d4ed8; padding: 6px 12px; font: 600 12px/1.2 Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }}
        h1 {{ margin: 18px 0 10px; font-size: 34px; line-height: 1.15; }}
        h2 {{ margin: 0 0 10px; font-size: 18px; line-height: 1.3; }}
        h3 {{ margin: 0 0 14px; font-size: 22px; line-height: 1.25; }}
        p {{ margin: 0; line-height: 1.6; }}
        .meta-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-top: 22px; }}
        .meta-card {{ border: 1px solid #d7dee7; border-radius: 18px; padding: 14px 16px; background: #f8fafc; }}
        .meta-card .label {{ display: block; margin-bottom: 6px; color: #475569; font: 600 11px/1.2 Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }}
        .intro, .notes {{ margin-top: 24px; padding: 20px 22px; border-radius: 20px; background: #f8fafc; border: 1px solid #d7dee7; }}
        .notes ul {{ margin: 0; padding-left: 22px; }}
        .notes li + li {{ margin-top: 10px; }}
        .day {{ margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; }}
        .entries {{ display: grid; gap: 14px; }}
        .entry {{ padding: 16px 18px; border-radius: 18px; background: #f8fafc; border: 1px solid #d7dee7; }}
        .headline {{ font-weight: 700; font-size: 18px; line-height: 1.35; }}
        .meta {{ margin-top: 8px; color: #475569; font: 500 13px/1.5 Arial, sans-serif; }}
        .note {{ margin-top: 10px; color: #334155; font: 400 14px/1.55 Arial, sans-serif; }}
        .note span {{ font-weight: 700; }}
        .footer {{ margin-top: 28px; color: #64748b; font: 500 12px/1.5 Arial, sans-serif; }}
        .empty {{ margin-top: 18px; color: #64748b; font: 500 15px/1.5 Arial, sans-serif; }}
        @media print {{
          body {{ background: #fff; }}
          main {{ max-width: none; padding: 0; }}
          .sheet {{ box-shadow: none; border-radius: 0; padding: 0; }}
        }}
        </style></head><body><main><div class=\"sheet\"><div class=\"badge\">{draft_badge}</div><h1>{title}</h1><div class=\"meta-grid\">
        <div class=\"meta-card\"><span class=\"label\">{created_on}</span><strong>{created_value}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{patient_id_label}</span><strong>{patient_pid}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{birth_date_label}</span><strong>{birth_date}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{contract_number_label}</span><strong>{contract_number}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{contract_status_label}</span><strong>{contract_status}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{valid_from_label}</span><strong>{valid_from}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{valid_to_label}</span><strong>{valid_to}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">{signed_at_label}</span><strong>{signed_at}</strong></div>
        </div>
        <div class=\"meta-grid\">
        <div class=\"meta-card\"><span class=\"label\">Patient</span><strong>{patient_title}{patient_name}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">Order</span><strong>{order_number}</strong></div>
        <div class=\"meta-card\"><span class=\"label\">Template</span><strong>{auto_name}</strong></div>
        </div>
        {intro_section}
        <section class=\"day\"><h2>{contract_data_heading}</h2></section>
        {quote_section}
        {conditions_markup}
        {terms_markup}
        <div class=\"footer\">{generated_footer}: {generated_at}</div>
        </div></main></body></html>",
        lang = escape_html(&context.language),
        title = escape_html(&title),
        draft_badge = escape_html(translated_label(&context.language, "draft_badge")),
        created_on = escape_html(translated_label(&context.language, "created_on")),
        created_value = escape_html(&context.generated_at.format("%d.%m.%Y").to_string()),
        patient_id_label = escape_html(translated_label(&context.language, "patient_id")),
        patient_pid = escape_html(&context.patient_pid),
        birth_date_label = escape_html(translated_label(&context.language, "birth_date")),
        birth_date = escape_html(&birth_date),
        contract_number_label = escape_html(translated_label(&context.language, "contract_number")),
        contract_number = escape_html(&context.contract_number),
        contract_status_label = escape_html(translated_label(&context.language, "contract_status")),
        contract_status = escape_html(&context.contract_status),
        valid_from_label = escape_html(translated_label(&context.language, "valid_from")),
        valid_from = escape_html(&context.valid_from.map(|value| value.format("%d.%m.%Y").to_string()).unwrap_or_else(|| "n/a".to_string())),
        valid_to_label = escape_html(translated_label(&context.language, "valid_to")),
        valid_to = escape_html(&context.valid_to.map(|value| value.format("%d.%m.%Y").to_string()).unwrap_or_else(|| "n/a".to_string())),
        signed_at_label = escape_html(translated_label(&context.language, "signed_at")),
        signed_at = escape_html(&context.signed_at.map(|value| value.format("%d.%m.%Y %H:%M UTC").to_string()).unwrap_or_else(|| "n/a".to_string())),
        patient_title = patient_title,
        patient_name = escape_html(&context.patient_name),
        order_number = escape_html(context.order_number.as_deref().unwrap_or("n/a")),
        auto_name = escape_html(&context.auto_name),
        intro_section = intro_section,
        contract_data_heading = escape_html(translated_label(&context.language, "contract_data_heading")),
        quote_section = quote_section,
        conditions_markup = conditions_markup,
        terms_markup = terms_markup,
        generated_footer = escape_html(translated_label(&context.language, "generated_footer")),
        generated_at = escape_html(&context.generated_at.to_rfc3339()),
    )
}

/// Heading for the numbered paragraphs (§ 1 … § 11) and Anlage sub-sections.
/// Slightly larger/bolder than body text, mirrors `admin_heading` styling.
fn fc_paragraph_heading(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block(text, 13.0, true, 0.0, TreatmentPlanPdfColor::Body, 4.0, 2.0);
}

/// A regular body paragraph for the contract text.
fn fc_body(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block_justified(
        text,
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        2.0,
    );
}

/// A bold inline sub-label inside § 1 (e.g. "Individuelle Beratung und ...").
fn fc_subhead(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block(text, 11.0, true, 4.0, TreatmentPlanPdfColor::Body, 1.5, 0.5);
}

/// An indented bullet point.
fn fc_bullet(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block_justified(
        &format!("•  {text}"),
        11.0,
        false,
        8.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        1.0,
    );
}

/// A blank handwritten fill-in run of underscores (never a placeholder string).
fn fc_underscores(len: usize) -> String {
    "_".repeat(len)
}

/// Patient designation "Herr Max Mustermann" / "Frau …" / bare name.
fn fc_patient_salutation_name(context: &GeneratedFrameworkContractContext) -> String {
    match context
        .patient_salutation
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        Some(salutation) => format!("{salutation} {}", context.patient_name)
            .trim()
            .to_string(),
        None => context.patient_name.clone(),
    }
}

/// The configured agency responsible person used in signatures and legal text.
fn fc_agency_person(agency: &AgencyContractSettings) -> String {
    agency_responsible_person(agency).to_string()
}

fn agency_legal_identity(agency: &AgencyContractSettings) -> String {
    let mut parts = vec![adult_legal_agency_identity(agency)];
    if let Some(birth_date) = agency.principal_birth_date {
        parts.push(format!("geb. am {}", birth_date.format("%d.%m.%Y")));
    }
    if let Some(address) = agency
        .address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(address.to_string());
    }
    parts.join(", ")
}

/// A tightly-spaced body line (no leading gap), used for stacked address/contact rows.
fn fc_body_tight(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block(
        text,
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        0.5,
    );
}

fn build_framework_contract_pdf(
    context: &GeneratedFrameworkContractContext,
    fallback_document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let document_reference = legal_document_reference(
        Some(context.contract_number.as_str()),
        fallback_document_reference,
    );
    let mut layout = legal_document_pdf_layout(&document_reference, &context.agency, regular, bold);

    let effective_date_str = fmt_de_date(context.effective_date);

    // --- Title ----------------------------------------------------------------
    layout.text_block_centered(
        "RAHMENDIENSTLEISTUNGSVERTRAG",
        20.0,
        true,
        TreatmentPlanPdfColor::Body,
        0.0,
        4.0,
    );

    // --- Party designation block ---------------------------------------------
    fc_body(&mut layout, "zwischen");
    layout.text_block(
        &fc_patient_salutation_name(context),
        11.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        0.5,
    );
    if let Some(birth) = context.birth_date {
        fc_body_tight(
            &mut layout,
            &format!("geb. am {}", birth.format("%d.%m.%Y")),
        );
    }
    if let Some(address) = context
        .patient_address
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        fc_body_tight(&mut layout, address);
    }
    if let Some(email) = context
        .patient_email
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        fc_body_tight(&mut layout, &format!("Email: {email}"));
    }
    if let Some(phone) = context
        .patient_phone
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        fc_body_tight(&mut layout, &format!("Tel.: {phone}"));
    }
    layout.text_block(
        "– nachfolgend „Auftraggeber“ genannt –",
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.5,
        2.0,
    );

    fc_body(&mut layout, "und");
    for (index, line) in agency_identity_profile_lines(&context.agency)
        .into_iter()
        .enumerate()
    {
        layout.text_block(
            &line,
            11.0,
            index == 0,
            0.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            0.5,
        );
    }
    if let Some(address) = agency_document_address(&context.agency) {
        for address_line in address
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            fc_body_tight(&mut layout, address_line);
        }
    }
    if let Some(email) = context
        .agency
        .email
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        fc_body_tight(&mut layout, &format!("Email: {email}"));
    }
    layout.text_block(
        "– nachfolgend „Auftragnehmer“ genannt –",
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.5,
        0.5,
    );
    layout.text_block(
        "– nachfolgend „Auftraggeber“ und „Auftragnehmer“ gemeinsam „Vertragsparteien“ genannt –",
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.5,
        3.0,
    );

    // --- Präambel -------------------------------------------------------------
    layout.page_break();
    fc_paragraph_heading(&mut layout, "Präambel");
    fc_body(
        &mut layout,
        "Der Auftragnehmer bietet als Vermittler umfassende Service-Dienstleistungen im Bereich der Gesundheitsfürsorge und des Gesundheitstourismus für Patienten aus dem Ausland an, die eine medizinische Behandlung in Deutschland wünschen.",
    );
    fc_body(
        &mut layout,
        "Die nachfolgenden Bestimmungen regeln die Zusammenarbeit zwischen den Parteien.",
    );
    fc_body(
        &mut layout,
        "Zur besseren Lesbarkeit dieses Vertrages wird in diesem Vertrag das generische Maskulinum verwendet. Sämtliche Personenbezeichnungen gelten gleichermaßen für alle Geschlechter.",
    );

    // --- § 1 Vertragsgegenstand ----------------------------------------------
    fc_paragraph_heading(&mut layout, "§ 1 Vertragsgegenstand");
    fc_body(
        &mut layout,
        "Der Auftraggeber beabsichtigt sich in Deutschland einer medizinischen Untersuchung und Behandlung zu unterziehen.",
    );
    fc_body(
        &mut layout,
        "Zu diesem Zweck schließen die Vertragsparteien diesen Vertrag. Dieser Vertrag gilt als Rahmendienstleistungsvertrag für alle künftigen Einzelaufträge.",
    );
    fc_body(
        &mut layout,
        "Die Beratungs- und Leistungspflichten im Rahmen dieses Dienstleistungsvertrags bestehen ausschließlich aufgrund und in den Grenzen der abgeschlossenen Einzelaufträge zu den jeweiligen Einzelsachverhalten. Die Einzelsachverhalte sind vom Auftraggeber, ausdrücklich mitzuteilen und fallweise inhaltlich – soweit erforderlich gemeinsam mit dem Auftragnehmer – zu definieren.",
    );
    fc_body(
        &mut layout,
        "Für das Zustandekommen eines Einzelauftrags ist die Annahme des Auftrags durch den Auftragnehmer erforderlich. Der Auftragnehmer behält sich vor, einen Einzelauftrag auch ohne Benennung des Grundes abzulehnen.",
    );
    layout.ensure_space(26.0);
    fc_body(
        &mut layout,
        "Die Erteilung und Annahme eines Einzelauftrags kann schriftlich unter Einbeziehung dieses Rahmendienstleistungsvertrags erfolgen. Die entsprechende Vorlage des Einzelauftrags wird separat als eigenes Dokument generiert und diesem Rahmendienstleistungsvertrag zugeordnet.",
    );
    fc_body(
        &mut layout,
        "Die Vertragsparteien sind darüber einig, dass die Beratungs- und Leistungspflichten von dem Auftragnehmer insbesondere wie folgt eingeschränkt sind:",
    );

    fc_subhead(
        &mut layout,
        "Individuelle Beratung und Informationsvermittlung:",
    );
    fc_bullet(
        &mut layout,
        "Ausführliche Beratungsgespräche zur Erfassung individueller Bedürfnisse und Wünsche",
    );
    fc_bullet(
        &mut layout,
        "Bereitstellung fundierter Informationen zu Behandlungsmöglichkeiten, Kliniken und Fachärzten",
    );

    fc_subhead(&mut layout, "Vermittlung und Koordination:");
    fc_bullet(
        &mut layout,
        "Herstellung von Kontakten zu führenden Kliniken, Laboren und spezialisierten Fachärzten",
    );
    fc_bullet(
        &mut layout,
        "Terminvereinbarungen und Koordination der Abläufe",
    );
    fc_bullet(
        &mut layout,
        "administrative Unterstützung bei der Zusammenstellung und Übermittlung medizinischer Unterlagen",
    );
    fc_bullet(
        &mut layout,
        "Koordination und Gewährleistung einer interdisziplinären Zusammenarbeit zwischen unterschiedlichen medizinischen Dienstleistern",
    );

    fc_subhead(&mut layout, "Concierge- und Lifestyle-Service");
    fc_bullet(&mut layout, "Reservierung in ausgewählten Restaurants");
    fc_bullet(&mut layout, "Organisation kultureller Aktivitäten");
    fc_bullet(&mut layout, "Stadtführungen und Freizeitangebote");
    fc_bullet(
        &mut layout,
        "Persönliche Betreuung rund um die Uhr, um individuelle Wünsche und Sonderanforderungen zu erfüllen",
    );

    fc_subhead(
        &mut layout,
        "Unterstützung bei der Einrichtung der digitalen Infrastruktur",
    );
    fc_bullet(
        &mut layout,
        "Unterstützung bei der Einrichtung der digitalen Infrastruktur, z.B. Mikrofon, Kamera, zur Teilnahme an einer Videosprechstunde",
    );
    fc_bullet(
        &mut layout,
        "Unterstützung beim Einwahlvorgang auf der Plattform der medizinischen Leistungserbringer",
    );

    fc_subhead(&mut layout, "Übersetzungs- und Dolmetscherdienste");
    fc_bullet(
        &mut layout,
        "Professionelle sprachliche Unterstützung zur Überwindung von Sprachbarrieren",
    );
    fc_bullet(
        &mut layout,
        "Bereitstellung von Übersetzern und Dolmetschern für den reibungslosen Informationsaustausch zwischen internationalen Patienten und medizinischem Fachpersonal",
    );
    fc_bullet(
        &mut layout,
        "Übersetzung von Arztbriefen, Befunden und anderen Unterlagen",
    );

    fc_subhead(&mut layout, "Nachbetreuung und Rehabilitationsmanagement");
    fc_bullet(
        &mut layout,
        "Koordination von Nachsorgeterminen und Rehabilitationsmaßnahmen",
    );
    fc_bullet(
        &mut layout,
        "Organisation von Follow-up-Beratungen zur nachhaltigen Unterstützung des Genesungsprozesses (auch bei unseren Kooperationspartnern im Heimatland)",
    );

    fc_subhead(&mut layout, "Kostenkontrolle");
    fc_bullet(&mut layout, "Überwachung der Abrechnungsrichtigkeit;");
    fc_bullet(
        &mut layout,
        "Kostenübernahmen und Zahlungsabwicklung bei unterschiedlichen medizinischen Anbietern",
    );
    fc_bullet(
        &mut layout,
        "Kalkulation und Planung von voraussichtlichen Behandlungskosten, Anfrage von Kostenvoranschlägen bei den medizinischen Leistungserbringern",
    );

    fc_subhead(
        &mut layout,
        "Zeit- und kosteneffiziente Organisation der Behandlung",
    );
    fc_bullet(
        &mut layout,
        "Optimierung der Prozesse, um Wartezeiten zu minimieren und den Untersuchungs- und Behandlungsablauf zeit- und kosteneffizient zu gestalten",
    );
    fc_bullet(&mut layout, "Effizientes Ressourcenmanagement");

    fc_subhead(&mut layout, "Logistik und Reiseorganisation");
    fc_bullet(
        &mut layout,
        "Planung und Buchung von Flügen, Unterkünften und Transfers vor Ort",
    );
    fc_bullet(
        &mut layout,
        "Organisation eines kompletten Reise- und Transferservices für einen reibungslosen Ablauf",
    );

    layout.spacer(2.0);
    fc_body(
        &mut layout,
        "Die Vertragsparteien können jederzeit die Erbringung weiterer Leistungen vereinbaren. Sofern hierdurch weitere Kosten entstehen, wird der Auftragnehmer dem Auftraggeber einen neuen Kostenvoranschlag übermitteln, der der schriftlichen Annahme durch den Auftraggeber bedarf.",
    );
    fc_body(
        &mut layout,
        "Vorbehaltlich der Regelungen gemäß § 4 Abs. 4 wird der Auftragnehmer im Falle unvorhergesehener Umstände oder Hindernisse bei der Umsetzung der geplanten Abläufe auch dabei unterstützen, bedarfs- und situationsgerecht umzuplanen.",
    );
    fc_body(
        &mut layout,
        "Es wird klargestellt, dass es sich bei den Leistungen des Auftragnehmers nicht um medizinische Beratung zum Zwecke der Befunderhebung oder um sonstige medizinische Behandlungsleistungen handelt.",
    );
    fc_body(
        &mut layout,
        "Die Beratungsleistungen des Auftragnehmers beschränken sich auf die Bedarfsermittlung und die Beratung hinsichtlich der Erreichung der gemäß § 1 Absatz 6 definierten Leistungen damit die medizinische Versorgung in Deutschland für den Auftraggeber bestmöglich in die Wege geleitet werden kann.",
    );
    fc_body(
        &mut layout,
        "Die Organisation- und Koordination von Terminen erfolgt in Abstimmung mit dem Auftragnehmer entsprechend der jeweiligen Verfügbarkeiten der medizinischen Leistungserbringer und Einrichtungen. Eine Gewähr für die Einhaltung von Wunschterminen kann nicht übernommen werden; auf die Dauer von Wartezeiten hat der Auftragnehmer keinen Einfluss.",
    );

    // --- § 2 Vergütung --------------------------------------------------------
    fc_paragraph_heading(&mut layout, "§ 2 Vergütung");
    fc_body(
        &mut layout,
        "Die Vergütung für die erbrachten Leistungen richtet sich nach den tatsächlich angefallenen Kosten nach Maßgabe des in jedem neuen Auftrag (Einzelauftrag) zur Verfügung gestellten Vergütungsvereinbarungs und Kostenvoranschlags.",
    );
    let threshold = context
        .cost_threshold
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(fmt_money_de)
        .unwrap_or_else(|| fc_underscores(14));
    fc_body(
        &mut layout,
        &format!(
            "Zusätzliche Kosten, die im Kostenvoranschlag nicht aufgeführt waren, und {threshold} der Gesamtsumme übersteigen, bedürfen der schriftlichen Zustimmung des Auftraggebers. Schriftliche Zustimmung bedeutet, schriftlich gem. §126 BGB und Textform gem. §126 b BGB, sofern in dieser Vereinbarung nichts Abweichendes geregelt ist."
        ),
    );
    fc_body(
        &mut layout,
        "Kosten für Leistungen Dritter sind entweder direkt gegenüber den Dritten oder -im Fall der Kostenübernahme durch den Auftragnehmer- in der Höhe der jeweiligen Rechnungsbeträge an den Auftraggeber zu zahlen.",
    );
    fc_body(
        &mut layout,
        "Nach Beendigung des Auftrags (Einzelauftrags) stellt der Auftragnehmer eine Rechnung über die fällige Vergütung. Der Auftraggeber ist mit der Erstellung der Rechnung in Textform und mit der Versendung der Rechnung auf digitalem Wege einverstanden.",
    );
    fc_body(
        &mut layout,
        "Die Vergütung und Auslagen sind nach Rechnungszugang binnen 14 Tagen zur Zahlung fällig. Eingehende Geldbeträge werden vorab zur Deckung der jeweils fälligen Vergütung und Auslagen verrechnet.",
    );
    fc_body(
        &mut layout,
        "Eine Aufrechnung mit Gegenansprüchen ist nur zulässig, wenn diese Ansprüche unstreitig oder rechtskräftig festgestellt sind. Das Recht des Auftraggebers zur Aufrechnung besteht uneingeschränkt, soweit die aufgerechnete Forderung mit der Hauptforderung synallagmatisch verknüpft ist.",
    );
    fc_body(
        &mut layout,
        "Macht der Auftraggeber von einem Leistungsverweigerungsrecht bzw. Zurückbehaltungsrecht Gebrauch, so ist der Auftragnehmer berechtigt, die Geltendmachung dieses Zurückbehaltungsrechts durch Sicherheitsleistung in Höhe des geforderten Betrags abzuwenden. Die Kosten der Sicherheit sind vom Auftragnehmer zu tragen, wenn die Ausübung des Zurückbehaltungsrechts nicht berechtigt war.",
    );

    // --- § 3 Vertraulichkeit --------------------------------------------------
    fc_paragraph_heading(&mut layout, "§ 3 Vertraulichkeit");
    fc_body(
        &mut layout,
        "Die Vertragsparteien verpflichten sich, sämtliche im Rahmen dieses Vertrages bekannt gewordenen vertraulichen Informationen streng vertraulich zu behandeln und nicht ohne ausdrückliche Zustimmung der informationsgebenden Vertragspartei an Dritte weiterzugeben. Mitarbeitende des Auftragnehmers sind keine Dritten im Sinne dieses Vertrags.",
    );
    fc_body(
        &mut layout,
        "Die Vertragsparteien sind sich einig, dass es im Rahmen der Leistungserbringung erforderlich sein kann, dass der Auftraggeber dem Auftragnehmer personenbezogene und medizinische Daten wie Personalausweiskopien, Reisepasskopien, Vorbefunde, Laborbefunde, Bilddaten, ärztliche und medizinische Dokumentation, Kostenvoranschläge, Rechnungen, Quittungen, Behandlungsverträge, Leistungsverträge, Arzt- und Krankenhausberichte zur Verfügung stellt und der Auftragnehmer diese Informationen im Rahmen und zum Zwecke des Vertrages bearbeitet, speichert, und insbesondere an behandelnde Ärzte, Krankenhäuser, Labore und andere medizinische Einrichtungen, Dolmetscher, Übersetzer oder Gutachter übermittelt. Die Vertragsparteien sind sich darüber bewusst, dass die vorgenannten Informationen Rückschlüsse auf Diagnosen, medizinische Untersuchungen, medizinische Zustände abgeschlossene oder noch andauernde Behandlungen zulassen oder solche Informationen enthalten können und daher besonders sensibel sind und der Umgang besonderer Sorgfalt bedarf.",
    );
    fc_body(
        &mut layout,
        "Der Auftraggeber erklärt gegenüber dem Auftragnehmer sein Einverständnis zur Übermittlung der erforderlichen Informationen an die Ärzte, Krankenhäuser, Labore, medizinische Einrichtungen, Apotheken sowie die beauftragten Dolmetscher, Übersetzer oder Gutachter.",
    );
    fc_body(
        &mut layout,
        "Der Auftraggeber wird die schweigepflichtigen Personen, insbesondere Ärzte, Angehörige anderer Heilberufe sowie andere Personen, die im Rahmen der Durchführung dieses Vertrags mit der Verarbeitung vertraulicher Informationen betraut sind, gegenüber dem Auftragnehmer von ihrer Schweigepflicht entbinden. Gleichzeitig wird er den Auftragnehmer gegenüber den Leistungserbringern und Einrichtungen von seiner Verschwiegenheitspflicht entbinden.",
    );
    fc_body(
        &mut layout,
        "Die in den vorherigen Absätzen genannten Erklärungen erfolgen schriftlich in einem separaten Dokument und sind jederzeit widerrufbar.",
    );

    // --- § 4 Gewährleistung & Haftung -----------------------------------------
    fc_paragraph_heading(&mut layout, "§ 4 Gewährleistung & Haftung");
    fc_body(
        &mut layout,
        "Der Auftragnehmer übernimmt keine Gewähr für die Qualität, Richtigkeit oder die Wirksamkeit der vermittelten Behandlungs- und Gesundheitsleistungen. Alle Informationen und Empfehlungen, die im Rahmen der Vermittlung gegeben werden, dienen ausschließlich Informationszwecken und stellen keine medizinische Beratung dar.",
    );
    fc_body(
        &mut layout,
        "Die Haftung des Auftragnehmers für Schäden, die aus oder im Zusammenhang mit den geschuldeten Leistungen entstehen, ist, außer in Fällen der Verletzung des Lebens und der Gesundheit sowie in sonstigen Fällen zwingender gesetzlicher Haftung, auf Vorsatz und grobe Fahrlässigkeit beschränkt. Eine weitergehende Haftung, insbesondere für mittelbare Schäden, Folgeschäden oder entgangenen Gewinn, ist ausgeschlossen.",
    );
    fc_body(
        &mut layout,
        "Der Auftragnehmer haftet nicht für Handlungen oder Unterlassungen der vermittelten Ärzte, Therapeuten und sonstiger Dritter, die an der medizinischen Behandlung und Betreuung des Auftraggebers beteiligt werden oder sonst im Rahmen der Vertragsdurchführung tätig werden. Der Auftraggeber stellt den Auftragnehmer ferner von allen Ansprüchen Dritter frei, die im Zusammenhang mit den vermittelten Behandlungsleistungen entstehen.",
    );
    fc_body(
        &mut layout,
        "Der Auftragnehmer haftet nicht für Ausfälle der medizinischen Leistungserbringer und Einrichtungen oder für Hindernisse in der Durchführung der vermittelten Leistungen gemäß § 1 Abs. 6 dieses Vertrags. Dies umfasst insbesondere, aber nicht ausschließlich, Schäden durch Verspätungen, Ausfälle, Änderungen der Reiseroute oder sonstige Unannehmlichkeiten, die durch Reiseveranstalter, Transportunternehmen oder andere Dritte verursacht werden. Der Auftragnehmer haftet nicht für Schäden oder Verluste, die durch Umstände verursacht werden, auf die der Auftragnehmer keinen Einfluss hat. Dazu gehören unter anderem höhere Gewalt, Naturkatastrophen, politische Unruhen, Streiks, Epidemien oder behördliche Maßnahmen.",
    );

    // --- § 5 Nutzung von Online-Diensten und Telemedien -----------------------
    fc_paragraph_heading(
        &mut layout,
        "§ 5 Nutzung von Online-Diensten und Telemedien",
    );
    fc_body(
        &mut layout,
        "Zur Durchführung einer störungsfreien Videosprechstunde hat der Auftraggeber sicherzustellen, dass er sich zu diesem Zweck in einem geschlossenen und ruhigen Raum mit guten Lichtverhältnissen befindet sowie über geeignete Technik, insbesondere über einen sicheren und schnellen Internetzugang verfügt. Sind die Bedingungen nicht geeignet, kann der Auftragnehmer oder die behandelnde Person die Videosprechstunde abbrechen. Die Kosten, die hierdurch und bei einem etwaigen erneuten Durchführungsversuch entstehen, hat der Auftraggeber zu tragen.",
    );
    fc_body(
        &mut layout,
        "Im Falle der Vermittlung von telemedizinischen Diensten wie Videosprechstunden, übernimmt der Auftragnehmer keine Gewähr dafür, dass die Nutzung des vermittelten Dienstes oder Teile davon immer und vollumfänglich von jedem Ort gleichermaßen verfügbar ist. Auf die Qualität der durch den Auftraggeber genutzten Internetverbindung oder dessen technische Ausstattung hat der Auftragnehmer keinen Einfluss. Für Hindernisse, die aus der Risikosphäre des Auftraggebers stammen, steht der Auftragnehmer nicht ein. Der Auftragnehmer wird sich im Bedarfsfalle bemühen, den Auftragnehmer bei der Problemanalyse und -behebung zu unterstützen.",
    );
    fc_body(
        &mut layout,
        "Die Entscheidung, ob die Behandlung im Rahmen einer Videosprechstunde oder mithilfe sonstiger Telemedien durchgeführt werden kann, obliegt ausschließlich dem medizinischen Leistungserbringer oder der Einrichtung.",
    );
    fc_body(
        &mut layout,
        "Ton- und Videoaufnahmen durch die an der Videosprechstunde Teilnehmenden dürfen nur mit vorheriger schriftlicher Genehmigung aller teilnehmenden Personen angefertigt werden. Es wird darauf hingewiesen, dass ein Zuwiderhandeln rechtliche Konsequenzen nach sich ziehen kann. Hierfür übernimmt der Auftragnehmer keine Verantwortung.",
    );
    fc_body(
        &mut layout,
        "Im Übrigen gelten die Nutzungsbedingungen des jeweiligen Plattformbetreibers ergänzend.",
    );

    // --- § 6 Vertragslaufzeit & Kündigung -------------------------------------
    fc_paragraph_heading(&mut layout, "§ 6 Vertragslaufzeit & Kündigung");
    fc_body(
        &mut layout,
        &format!(
            "Der Vertrag tritt zum {} mit Unterzeichnung der Vertragsparteien in Kraft und wird auf unbefristete Dauer geschlossen.",
            effective_date_str
        ),
    );
    fc_body(
        &mut layout,
        "Der Vertrag kann von beiden Seiten jederzeit fristlos gekündigt werden.",
    );
    fc_body(
        &mut layout,
        "Eine Kündigung bedarf zu ihrer Wirksamkeit der Schriftform i.S.d. § 126 BGB bzw. der elektronischen Form i.S.d. § 126a BGB Die Kündigung in Textform gem. § 126b BGB ist ausgeschlossen.",
    );
    fc_body(
        &mut layout,
        "Im Falle einer Kündigung erfolgt eine Abrechnung über die tatsächlich angefallenen Leistungen und Nebenkosten/Aufwendungen. Als Abrechnungsgrundlage dient hierbei der dem Vertrag bzw. Einzelauftrag zugrundeliegende Kostenvoranschlag sowie die Rechnungsunterlagen der zum Zwecke des Vertrags bzw. Einzelauftrags eingebundenen Dritten.",
    );

    // --- § 7 Sprache & anwendbares Recht --------------------------------------
    fc_paragraph_heading(&mut layout, "§ 7 Sprache & anwendbares Recht");
    fc_body(
        &mut layout,
        "Dieser Vertrag unterliegt ausschließlich deutschem Recht.",
    );
    fc_body(
        &mut layout,
        "Die deutsche Fassung dieses Vertrags ist die einzig verbindliche Version für die Auslegung und Anwendung dieses Vertrags. Übersetzungen in andere Sprachen dienen lediglich zu Informationszwecken und entfalten keine rechtliche Wirkung. Im Falle von Unstimmigkeiten oder Auslegungsfragen ist ausschließlich die deutsche Version maßgeblich.",
    );

    // --- § 8 Erfüllungsort ----------------------------------------------------
    fc_paragraph_heading(&mut layout, "§ 8 Erfüllungsort");
    fc_body(
        &mut layout,
        "Erfüllungsort für sämtliche Leistungen des Auftragsnehmers ist der Sitz des Auftragnehmers, München, sofern der Vertrag nichts Abweichendes vorsieht. Sofern die vereinbarten Leistungen ein Tätigwerden des Auftragnehmers außerhalb seiner Geschäftsräume erfordert, so ist der Erfüllungsort gleichwohl am Sitz des Auftragnehmers.",
    );

    // --- § 9 Änderungen & Ergänzungen -----------------------------------------
    fc_paragraph_heading(&mut layout, "§ 9 Änderungen & Ergänzungen");
    fc_body(
        &mut layout,
        "Änderungen und Ergänzungen dieses Vertrags bedürfen der Schriftform. Dies gilt auch für diese Schriftformvereinbarung.",
    );

    // --- § 10 Salvatorische Klausel -------------------------------------------
    fc_paragraph_heading(&mut layout, "§ 10 Salvatorische Klausel");
    fc_body(
        &mut layout,
        "Sollten einzelne Bestimmungen dieses Vertrages ganz oder teilweise unwirksam sein oder werden, so wird hierdurch die Wirksamkeit der übrigen Bestimmungen nicht berührt. Anstelle der unwirksamen Bestimmung gilt diejenige wirksame Bestimmung als vereinbart, die dem Sinn und Zweck der unwirksamen Bestimmung am nächsten kommt.",
    );

    // --- § 11 Bestandteile des Vertrages und Rangfolge ------------------------
    fc_paragraph_heading(&mut layout, "§ 11 Bestandteile des Vertrages und Rangfolge");
    fc_body(
        &mut layout,
        "Die nachfolgenden Anlagen sind integraler Bestandteil des Vertrags:",
    );
    for line in [
        "Anlage 1:  Einverständnis zur Datenübermittlung",
        "Anlage 2:  Schweigepflichtentbindung",
        "Anlage 3:  Informationsblatt zum Datenschutz",
    ] {
        layout.text_block(
            line,
            11.0,
            false,
            8.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            1.0,
        );
    }
    fc_body(
        &mut layout,
        "Im Falle von Widersprüchen gelten die Vertragsdokumente in oben genannter Rangfolge.",
    );

    // --- Signature blocks (both parties) --------------------------------------
    layout.spacer(4.0);
    let agency_signature_name = agency_legal_name(&context.agency);
    admin_signature_grid(
        &mut layout,
        AdminSignatureParty {
            place: context.party_sign_place.as_deref(),
            date: context.party_sign_date,
            name: &context.patient_name,
            role: "Auftraggeber",
        },
        AdminSignatureParty {
            place: context.agency_sign_place.as_deref(),
            date: context.agency_sign_date,
            name: &agency_signature_name,
            role: "Auftragnehmer",
        },
    );

    Ok(finalize_admin_pdf(document, layout))
}

fn visa_invitation_patient_reference(context: &GeneratedVisaInvitationContext) -> String {
    let name = context.patient.name_last_comma_first();
    let salutation = appointment_nominative_salutation(&context.patient);
    if salutation.is_empty() {
        name
    } else {
        format!("{salutation} {name}")
    }
}

fn visa_invitation_birth_clause(context: &GeneratedVisaInvitationContext) -> String {
    context
        .birth_date
        .map(|value| format!(", geb. am {}", value.format("%d.%m.%Y")))
        .unwrap_or_default()
}

fn visa_invitation_passport_clause(context: &GeneratedVisaInvitationContext) -> String {
    let passport_number = context
        .passport_number
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("____________");
    let passport_valid_until = context
        .passport_valid_until
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "____________".to_string());
    format!(", Reisepass Nr.: {passport_number}, gültig bis {passport_valid_until}")
}

fn visa_invitation_clinic_list(clinics: &[ClinicInput]) -> Option<String> {
    let items = clinics
        .iter()
        .filter_map(|clinic| {
            let name = clinic.name.trim();
            if name.is_empty() {
                return None;
            }
            let address = clinic
                .address
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            Some(match address {
                Some(address) => format!("{name} ({address})"),
                None => name.to_string(),
            })
        })
        .collect::<Vec<_>>();
    if items.is_empty() {
        None
    } else {
        Some(items.join(", "))
    }
}

fn visa_invitation_contact_line(context: &GeneratedVisaInvitationContext) -> String {
    let phones = context
        .contact_phones
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            context
                .agency
                .phone
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    match phones {
        Some(phones) => {
            format!("Für Rückfragen stehen wir Ihnen gerne zur Verfügung unter {phones}.")
        }
        None => "Für Rückfragen stehen wir Ihnen gerne zur Verfügung.".to_string(),
    }
}

fn visa_invitation_summary_lines(context: &GeneratedVisaInvitationContext) -> Vec<String> {
    let mut lines = Vec::new();
    let patient_line = match context.language.as_str() {
        "uk" | "en" => match context
            .patient_title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(title_prefix) => format!("{title_prefix} {}", context.patient_name),
            None => context.patient_name.clone(),
        },
        _ => visa_invitation_patient_reference(context),
    };

    match context.language.as_str() {
        "uk" => {
            lines.push(format!(
                "Цим листом підтверджується, що {patient_line} запрошено до медичної координації та консультації{}.",
                context
                    .provider_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .map(|value| format!(" з {}", value))
                    .unwrap_or_default()
            ));
            if let Some(appointment_date) = context.appointment_date {
                let mut appointment_line = format!(
                    "Запланований візит: {}",
                    format_localized_date(appointment_date, &context.language)
                );
                if let Some(appointment_time) = context.appointment_time {
                    appointment_line.push_str(&format!(" о {}", appointment_time.format("%H:%M")));
                }
                if let Some(location) = context
                    .location
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    appointment_line.push_str(&format!(" у {location}"));
                }
                lines.push(appointment_line);
            }
            if let Some(appointment_title) = context
                .appointment_title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lines.push(format!("Мета поїздки: {appointment_title}."));
            }
            if let Some(order_number) = context
                .order_number
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lines.push(format!("Внутрішній номер координації: {order_number}."));
            }
            lines.push(
                "Лист призначений для подання до посольства або консульства в межах візової заяви."
                    .to_string(),
            );
        }
        "en" => {
            lines.push(format!(
                "This letter confirms that {patient_line} is invited for medical coordination and consultation{}.",
                context
                    .provider_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .map(|value| format!(" with {}", value))
                    .unwrap_or_default()
            ));
            if let Some(appointment_date) = context.appointment_date {
                let mut appointment_line = format!(
                    "Planned appointment: {}",
                    format_localized_date(appointment_date, &context.language)
                );
                if let Some(appointment_time) = context.appointment_time {
                    appointment_line.push_str(&format!(" at {}", appointment_time.format("%H:%M")));
                }
                if let Some(location) = context
                    .location
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    appointment_line.push_str(&format!(" in {location}"));
                }
                lines.push(appointment_line);
            }
            if let Some(appointment_title) = context
                .appointment_title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lines.push(format!("Purpose of travel: {appointment_title}."));
            }
            if let Some(order_number) = context
                .order_number
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lines.push(format!("Internal coordination reference: {order_number}."));
            }
            lines.push(
                "This document is intended for submission to the embassy or consulate as part of the visa application."
                    .to_string(),
            );
        }
        _ => {
            lines.push(format!(
                "Hiermit bestätigen wir, dass {patient_line}{}{} zur medizinischen Koordination und Vorstellung{} eingeladen ist.",
                visa_invitation_birth_clause(context),
                visa_invitation_passport_clause(context),
                context
                    .provider_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .map(|value| format!(" bei {}", value))
                    .unwrap_or_default()
            ));
            if let Some(appointment_date) = context.appointment_date {
                let mut appointment_line = format!(
                    "Geplanter Termin: {}",
                    format_localized_date(appointment_date, &context.language)
                );
                if let Some(appointment_time) = context.appointment_time {
                    appointment_line.push_str(&format!(" um {}", appointment_time.format("%H:%M")));
                }
                if let Some(location) = context
                    .location
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    appointment_line.push_str(&format!(" in {location}"));
                }
                lines.push(appointment_line);
            }
            if let Some(appointment_title) = context
                .appointment_title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lines.push(format!("Zweck der Reise: {appointment_title}."));
            }
            if let Some(clinic_list) = visa_invitation_clinic_list(&context.clinics) {
                lines.push(format!("Vorgesehene Einrichtung(en): {clinic_list}."));
            }
            if let Some(order_number) = context
                .order_number
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                lines.push(format!("Interne Koordinationsnummer: {order_number}."));
            }
            lines.push(
                "Dieses Schreiben dient zur Vorlage bei Botschaft oder Konsulat im Rahmen des Visumantrags."
                    .to_string(),
            );
            lines.push(visa_invitation_contact_line(context));
        }
    }

    lines
}

fn build_visa_invitation_html(context: &GeneratedVisaInvitationContext) -> String {
    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "visa_invitation_title"),
            context.patient_name
        )
    });
    let birth_date = context
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let nationality = context
        .nationality
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "n/a".to_string());
    let residence_country = context
        .residence_country
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "n/a".to_string());
    let provider_name = context
        .provider_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "n/a".to_string());
    let doctor_name = context
        .doctor_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "n/a".to_string());

    let intro_section = context
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            format!(
                "<section class=\"intro\"><h2>{}</h2><p>{}</p></section>",
                escape_html(translated_label(&context.language, "intro_heading")),
                escape_html(value)
            )
        })
        .unwrap_or_default();

    let body_markup = visa_invitation_summary_lines(context)
        .into_iter()
        .map(|line| format!("<p>{}</p>", escape_html(&line)))
        .collect::<Vec<_>>()
        .join("");

    let closing_markup = context
        .closing_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("<p>{}</p>", escape_html(value)))
        .unwrap_or_default();

    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>{title}</title><style>
        :root {{ color-scheme: light; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%); color: #0f172a; font-family: Georgia, 'Times New Roman', serif; }}
        main {{ max-width: 900px; margin: 0 auto; padding: 28px; }}
        .sheet {{ background: white; border-radius: 26px; padding: 34px; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.1); }}
        .badge {{ display: inline-block; border-radius: 999px; background: #e0f2fe; color: #075985; padding: 6px 12px; font: 700 12px/1.2 Arial, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }}
        h1 {{ margin: 16px 0 10px; font-size: 34px; line-height: 1.15; }}
        h2 {{ margin: 0 0 10px; font-size: 18px; line-height: 1.25; }}
        p {{ margin: 0; line-height: 1.65; }}
        .meta-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 20px; }}
        .meta-card {{ border: 1px solid #dbe4ef; border-radius: 18px; background: #f8fafc; padding: 14px 16px; }}
        .meta-card .label {{ display: block; margin-bottom: 6px; color: #475569; font: 700 11px/1.2 Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }}
        .intro, .body, .closing {{ margin-top: 24px; padding: 20px 22px; border-radius: 20px; border: 1px solid #dbe4ef; background: #ffffff; }}
        .body {{ display: grid; gap: 12px; background: #f8fafc; }}
        .footer {{ margin-top: 28px; color: #64748b; font: 500 12px/1.5 Arial, sans-serif; }}
        @media print {{
          body {{ background: #fff; }}
          main {{ max-width: none; padding: 0; }}
          .sheet {{ box-shadow: none; border-radius: 0; padding: 0; }}
        }}
        </style></head><body><main><div class=\"sheet\"><div class=\"badge\">{draft_badge}</div><h1>{title}</h1>
        <div class=\"meta-grid\">
          <div class=\"meta-card\"><span class=\"label\">{created_on}</span><strong>{created_value}</strong></div>
          <div class=\"meta-card\"><span class=\"label\">{patient_id_label}</span><strong>{patient_pid}</strong></div>
          <div class=\"meta-card\"><span class=\"label\">{birth_date_label}</span><strong>{birth_date}</strong></div>
          <div class=\"meta-card\"><span class=\"label\">{nationality_label}</span><strong>{nationality}</strong></div>
          <div class=\"meta-card\"><span class=\"label\">{residence_country_label}</span><strong>{residence_country}</strong></div>
          <div class=\"meta-card\"><span class=\"label\">{provider_label}</span><strong>{provider_name}</strong></div>
          <div class=\"meta-card\"><span class=\"label\">{doctor_label}</span><strong>{doctor_name}</strong></div>
        </div>
        {intro_section}
        <section class=\"body\">{body_markup}</section>
        {closing_section}
        <div class=\"footer\">{generated_footer}: {generated_at}</div>
        </div></main></body></html>",
        lang = escape_html(&context.language),
        title = escape_html(&title),
        draft_badge = escape_html(translated_label(&context.language, "draft_badge")),
        created_on = escape_html(translated_label(&context.language, "created_on")),
        created_value = escape_html(&context.generated_at.format("%d.%m.%Y").to_string()),
        patient_id_label = escape_html(translated_label(&context.language, "patient_id")),
        patient_pid = escape_html(&context.patient_pid),
        birth_date_label = escape_html(translated_label(&context.language, "birth_date")),
        birth_date = escape_html(&birth_date),
        nationality_label = escape_html(translated_label(&context.language, "nationality")),
        nationality = escape_html(&nationality),
        residence_country_label =
            escape_html(translated_label(&context.language, "residence_country")),
        residence_country = escape_html(&residence_country),
        provider_label = escape_html(translated_label(&context.language, "provider")),
        provider_name = escape_html(&provider_name),
        doctor_label = escape_html(translated_label(&context.language, "doctor")),
        doctor_name = escape_html(&doctor_name),
        intro_section = intro_section,
        body_markup = body_markup,
        closing_section = if closing_markup.is_empty() {
            String::new()
        } else {
            format!("<section class=\"closing\">{closing_markup}</section>")
        },
        generated_footer = escape_html(translated_label(&context.language, "generated_footer")),
        generated_at = escape_html(&context.generated_at.to_rfc3339()),
    )
}

fn build_visa_invitation_pdf(
    context: &GeneratedVisaInvitationContext,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(&context.auto_name);
    let (regular_handle, bold_handle) = pdf_text_font_handles();

    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "visa_invitation_title"),
            context.patient_name
        )
    });
    let birth_date = context
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "n/a".to_string());
    let footer_text = format!(
        "{}: {}",
        translated_label(&context.language, "generated_footer"),
        context.generated_at.format("%d.%m.%Y %H:%M UTC")
    );
    let mut layout = TreatmentPlanPdfLayout::new(footer_text, regular_handle, bold_handle);
    layout.set_document_reference(document_reference);

    for line in agency_block_lines(&context.agency) {
        admin_block(&mut layout, &line, 0.0, 0.3);
    }
    layout.spacer(2.0);

    let recipient = context
        .recipient_block
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("An die Botschaft / das Konsulat");
    for line in recipient
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        admin_block(&mut layout, line, 0.0, 0.3);
    }
    layout.spacer(2.0);

    let sign_place = context
        .sign_place
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(context.agency.sign_place.as_str());
    admin_block(
        &mut layout,
        &format!("{sign_place}, {}", fmt_de_date(context.sign_date)),
        0.0,
        3.0,
    );

    layout.text_block(
        translated_label(&context.language, "draft_badge"),
        10.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Primary,
        0.0,
        4.0,
    );
    layout.text_block(
        &title,
        22.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        6.0,
    );

    for line in [
        format!(
            "{}: {}",
            translated_label(&context.language, "created_on"),
            context.generated_at.format("%d.%m.%Y")
        ),
        format!(
            "{}: {}",
            translated_label(&context.language, "patient_id"),
            context.patient_pid
        ),
        format!(
            "{}: {}",
            translated_label(&context.language, "birth_date"),
            birth_date
        ),
        format!(
            "{}: {}",
            translated_label(&context.language, "nationality"),
            context.nationality.as_deref().unwrap_or("n/a")
        ),
        format!(
            "{}: {}",
            translated_label(&context.language, "residence_country"),
            context.residence_country.as_deref().unwrap_or("n/a")
        ),
    ] {
        layout.text_block(
            &line,
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }

    if let Some(provider_name) = context
        .provider_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "provider"),
                provider_name
            ),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    if let Some(doctor_name) = context
        .doctor_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "doctor"),
                doctor_name
            ),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    if let Some(order_number) = context
        .order_number
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "order_number"),
                order_number
            ),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }

    if let Some(introduction) = context
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            translated_label(&context.language, "intro_heading"),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Body,
            4.0,
            2.0,
        );
        layout.text_block(
            introduction,
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            3.0,
        );
    }

    for paragraph in visa_invitation_summary_lines(context) {
        layout.text_block(
            &paragraph,
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            3.0,
        );
    }

    if let Some(closing) = context
        .closing_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            closing,
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Body,
            3.0,
            0.0,
        );
    }

    admin_block(&mut layout, "Mit freundlichen Grüßen,", 3.0, 8.0);
    let signer = agency_responsible_person(&context.agency);
    layout.text_block(
        signer,
        11.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        0.5,
    );

    let pages = layout.finish();
    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    let save_options = pdf_text_save_options();
    Ok(document
        .with_pages(pages)
        .save(&save_options, &mut save_warnings))
}

fn format_sticker_birth_date(value: NaiveDate) -> String {
    value.format("%d.%m.%Y").to_string()
}

/// Gendered salutation line (e.g. "Herr"), rendered on its own row above the name
/// to mirror the reference label. Empty when unknown.
fn patient_sticker_salutation_line(context: &GeneratedPatientStickerContext) -> String {
    context.patient_salutation.trim().to_string()
}

/// Patient name in the reference's "Lastname, Firstname" order (no salutation,
/// no academic title). Falls back to the patient ID when names are missing.
fn patient_sticker_title_line(context: &GeneratedPatientStickerContext) -> String {
    let last = context.patient_last_name.trim();
    let first = context.patient_first_name.trim();
    match (last.is_empty(), first.is_empty()) {
        (false, false) => format!("{last}, {first}"),
        (false, true) => last.to_string(),
        (true, false) => first.to_string(),
        (true, true) => context.patient_pid.clone(),
    }
}

/// Reference meta rows: "geb. am <date>", "KT1: <code>", "KT2: <code>" (cost-bearer
/// codes, labels always shown), and the standalone branch/cost code (e.g. "FRA").
fn patient_sticker_meta_lines(context: &GeneratedPatientStickerContext) -> Vec<String> {
    let mut lines = vec![format!(
        "geb. am {}",
        format_sticker_birth_date(context.birth_date)
    )];
    lines.push(format!(
        "KT1: {}",
        context.kt1.as_deref().map(str::trim).unwrap_or_default()
    ));
    lines.push(format!(
        "KT2: {}",
        context.kt2.as_deref().map(str::trim).unwrap_or_default()
    ));
    if let Some(code) = context
        .cost_code
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(code.to_string());
    }
    lines
}

fn patient_sticker_agency_line(context: &GeneratedPatientStickerContext) -> String {
    let name = context.agency.name.trim();
    let care_of = context.agency.care_of.trim();
    let comparable_care_of = normalized_agency_person(care_of).unwrap_or_default();
    let mut parts = Vec::new();
    if !name.is_empty() {
        parts.push(name.to_string());
    }
    if !care_of.is_empty()
        && !name
            .to_lowercase()
            .contains(&comparable_care_of.to_lowercase())
    {
        parts.push(comparable_care_of.to_string());
    }
    for value in [
        context.agency.address.as_deref(),
        context.agency.phone.as_deref(),
        context.agency.email.as_deref(),
    ] {
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            parts.push(value.to_string());
        }
    }
    parts.join("  ·  ")
}

fn build_patient_sticker_html(context: &GeneratedPatientStickerContext) -> String {
    let format = context.format;
    let label_width = (format.width_mm as f32 - 10.0).max(48.0);
    let label_height = (format.height_mm as f32 - 10.0).max(24.0);
    let salutation_line = patient_sticker_salutation_line(context);
    let title_line = patient_sticker_title_line(context);
    let meta_html = patient_sticker_meta_lines(context)
        .iter()
        .map(|line| format!("<div>{}</div>", escape_html(line)))
        .collect::<String>();
    let agency_line = patient_sticker_agency_line(context);
    let salutation_html = if salutation_line.is_empty() {
        String::new()
    } else {
        format!(
            "<div class=\"salutation\">{}</div>",
            escape_html(&salutation_line)
        )
    };

    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\" /><title>{title}</title><style>
        @page {{ size: {page_w}mm {page_h}mm; margin: 5mm; }}
        :root {{ color-scheme: light; }}
        * {{ box-sizing: border-box; }}
        html, body {{ margin: 0; padding: 0; width: 100%; min-height: 100%; background: #f3f4f6; font-family: Arial, sans-serif; color: #0f172a; }}
        body {{ display: grid; place-items: center; padding: 6mm; }}
        .label {{ width: {label_w}mm; min-height: {label_h}mm; border: 1px solid #cbd5e1; border-radius: 4mm; background: radial-gradient(circle at top right, rgba(15,23,42,0.06), transparent 42%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); padding: 4mm; display: grid; gap: 1.6mm; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }}
        .patient-id {{ font-size: 12pt; font-weight: 700; letter-spacing: 0.04em; }}
        .salutation {{ font-size: {small_size}; color: #334155; }}
        .name {{ font-size: {name_size}; font-weight: 700; line-height: 1.15; }}
        .meta, .agency {{ font-size: {small_size}; line-height: 1.3; color: #334155; }}
        </style></head><body><article class=\"label\"><div class=\"patient-id\">ID: {patient_id}</div>{salutation}<div class=\"name\">{name}</div><div class=\"meta\">{meta}</div><div class=\"agency\">{agency}</div></article></body></html>",
        lang = escape_html(&context.language),
        title = escape_html(&format!("{} {}", context.patient_pid, translated_label(&context.language, "sticker_title"))),
        page_w = format.width_mm,
        page_h = format.height_mm,
        label_w = label_width,
        label_h = label_height,
        name_size = if format.height_mm <= 40 { "11.5pt" } else { "14pt" },
        small_size = if format.height_mm <= 40 { "7.5pt" } else { "8.5pt" },
        patient_id = escape_html(&context.patient_pid),
        salutation = salutation_html,
        name = escape_html(if title_line.is_empty() { &context.patient_pid } else { &title_line }),
        meta = meta_html,
        agency = escape_html(if agency_line.is_empty() { &context.agency.name } else { &agency_line }),
    )
}

fn build_patient_sticker_pdf(
    context: &GeneratedPatientStickerContext,
) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(&context.auto_name);
    let (regular_handle, bold_handle) = pdf_text_font_handles();

    let width_mm = context.format.width_mm as f32;
    let height_mm = context.format.height_mm as f32;
    let left_margin_mm = 5.0;
    let right_margin_mm = 5.0;
    let top_margin_mm = 5.0;
    let _bottom_margin_mm = 5.0;
    let content_width_mm = (width_mm - left_margin_mm - right_margin_mm).max(30.0);
    let mut y_mm = height_mm - top_margin_mm;
    let compact = context.format.height_mm <= 40;
    let id_size = if compact { 10.0 } else { 11.5 };
    let name_size = if compact { 10.5 } else { 13.0 };
    let body_size = if compact { 6.5 } else { 7.8 };

    let salutation_line = patient_sticker_salutation_line(context);
    let title_line = patient_sticker_title_line(context);
    let meta_lines = patient_sticker_meta_lines(context);
    let agency_line = patient_sticker_agency_line(context);

    let mut ops = Vec::new();

    let push_wrapped = |ops: &mut Vec<Op>,
                        text: &str,
                        font: &PdfFontHandle,
                        size_pt: f32,
                        color: TreatmentPlanPdfColor,
                        y_mm_ref: &mut f32| {
        for line in wrap_text_to_width(text, size_pt, content_width_mm) {
            append_pdf_text_line(ops, &line, left_margin_mm, *y_mm_ref, size_pt, font, color);
            *y_mm_ref -= pdf_line_height_mm(size_pt, 1.18);
        }
    };

    // ID line ("ID: <pid>")
    push_wrapped(
        &mut ops,
        &format!("ID: {}", context.patient_pid),
        &bold_handle,
        id_size,
        TreatmentPlanPdfColor::Body,
        &mut y_mm,
    );
    y_mm -= 0.8;
    // Salutation on its own row (Herr/Frau), when known
    if !salutation_line.is_empty() {
        push_wrapped(
            &mut ops,
            &salutation_line,
            &regular_handle,
            body_size,
            TreatmentPlanPdfColor::Body,
            &mut y_mm,
        );
        // The name below is set in a much larger font; reserve the remainder of its line
        // height so its ascenders don't overlap the salutation row above it.
        y_mm -=
            (pdf_line_height_mm(name_size, 1.18) - pdf_line_height_mm(body_size, 1.18)).max(0.0);
    }
    // Name: "Lastname, Firstname"
    push_wrapped(
        &mut ops,
        if title_line.is_empty() {
            &context.patient_pid
        } else {
            &title_line
        },
        &bold_handle,
        name_size,
        TreatmentPlanPdfColor::Body,
        &mut y_mm,
    );
    y_mm -= 0.8;
    // Meta rows: geb. am / KT1 / KT2 / cost code
    for line in &meta_lines {
        push_wrapped(
            &mut ops,
            line,
            &regular_handle,
            body_size,
            TreatmentPlanPdfColor::Body,
            &mut y_mm,
        );
    }
    y_mm -= 1.0;
    // Agency contact block
    if !agency_line.is_empty() {
        push_wrapped(
            &mut ops,
            &agency_line,
            &regular_handle,
            body_size,
            TreatmentPlanPdfColor::Muted,
            &mut y_mm,
        );
    }

    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    let save_options = pdf_text_save_options();
    Ok(document
        .with_pages(vec![PdfPage::new(Mm(width_mm), Mm(height_mm), ops)])
        .save(&save_options, &mut save_warnings))
}

fn provider_template_body_for_language<'a>(
    template: &'a ProviderDocumentTemplate,
    language: &str,
) -> Option<&'a str> {
    match language {
        "de" => template.body_de.as_deref(),
        _ => None,
    }
}

fn translated_provider_template_label(language: &str, key: &str) -> &'static str {
    match (language, key) {
        ("uk", "provider_template_title") => "Шаблон партнера",
        ("uk", "appointment") => "Візит",
        ("uk", "generated_on") => "Згенеровано",
        ("uk", "template_body_missing") => "У шаблоні немає тексту для вибраної мови.",
        ("ru", "provider_template_title") => "Шаблон партнера",
        ("ru", "appointment") => "Визит",
        ("ru", "generated_on") => "Сформировано",
        ("ru", "template_body_missing") => "Для выбранного языка в шаблоне нет текста.",
        ("en", "provider_template_title") => "Partner template",
        ("en", "appointment") => "Appointment",
        ("en", "generated_on") => "Generated on",
        ("en", "template_body_missing") => {
            "This template does not contain text for the selected language."
        }
        (_, "provider_template_title") => "Partnervorlage",
        (_, "appointment") => "Termin",
        (_, "generated_on") => "Erstellt am",
        (_, "template_body_missing") => {
            "Für die ausgewählte Sprache ist kein Vorlagentext hinterlegt."
        }
        _ => "",
    }
}

fn apply_provider_template_placeholders(
    body: &str,
    replacements: &BTreeMap<&str, String>,
) -> String {
    let mut rendered = body.to_string();
    for (key, value) in replacements {
        rendered = rendered.replace(&format!("{{{{{key}}}}}"), value);
    }
    rendered
}

fn provider_template_paragraphs(text: &str) -> Vec<String> {
    let mut paragraphs = Vec::new();
    for chunk in text.replace("\r\n", "\n").split("\n\n") {
        let trimmed = chunk.trim();
        if !trimmed.is_empty() {
            paragraphs.push(trimmed.to_string());
        }
    }
    if paragraphs.is_empty() {
        for line in text.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                paragraphs.push(trimmed.to_string());
            }
        }
    }
    paragraphs
}

fn build_provider_template_html(context: &GeneratedProviderTemplateContext) -> String {
    let mut meta_items = vec![
        format!(
            "{}: {}",
            escape_html(translated_label(&context.language, "patient_id")),
            escape_html(&context.patient_pid)
        ),
        format!(
            "{}: {}",
            escape_html(translated_label(&context.language, "provider")),
            escape_html(&context.provider_name)
        ),
    ];
    if let Some(doctor_name) = context
        .doctor_name
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        meta_items.push(format!(
            "{}: {}",
            escape_html(translated_label(&context.language, "doctor")),
            escape_html(doctor_name)
        ));
    }
    if let Some(birth_date) = context.birth_date {
        meta_items.push(format!(
            "{}: {}",
            escape_html(translated_label(&context.language, "birth_date")),
            escape_html(&birth_date.to_string())
        ));
    }
    if let Some(order_number) = context
        .order_number
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        meta_items.push(format!(
            "{}: {}",
            escape_html(translated_label(&context.language, "order_number")),
            escape_html(order_number)
        ));
    }
    if let Some(appointment_title) = context
        .appointment_title
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let mut appointment_parts = Vec::new();
        appointment_parts.push(appointment_title.to_string());
        if let Some(appointment_date) = context.appointment_date {
            appointment_parts.push(appointment_date.to_string());
        }
        if let Some(appointment_time) = context.appointment_time {
            appointment_parts.push(appointment_time.format("%H:%M").to_string());
        }
        meta_items.push(format!(
            "{}: {}",
            escape_html(translated_provider_template_label(
                &context.language,
                "appointment"
            )),
            escape_html(&appointment_parts.join(" · "))
        ));
    }
    if let Some(location) = context
        .location
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        meta_items.push(format!(
            "{}: {}",
            escape_html(translated_label(&context.language, "location")),
            escape_html(location)
        ));
    }

    let body_markup = if context.body_paragraphs.is_empty() {
        format!(
            "<p class=\"empty\">{}</p>",
            escape_html(translated_provider_template_label(
                &context.language,
                "template_body_missing"
            ))
        )
    } else {
        context
            .body_paragraphs
            .iter()
            .map(|paragraph| format!("<p>{}</p>", escape_html(paragraph)))
            .collect::<Vec<_>>()
            .join("")
    };

    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\" /><title>{title}</title><style>
        :root {{ color-scheme: light; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; font-family: Arial, sans-serif; background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%); color: #0f172a; }}
        main {{ max-width: 820px; margin: 0 auto; padding: 28px; }}
        article {{ background: white; border: 1px solid #cbd5e1; border-radius: 24px; padding: 28px; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08); }}
        .eyebrow {{ font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #475569; }}
        h1 {{ margin: 8px 0 0; font-size: 30px; line-height: 1.1; }}
        .description {{ margin: 10px 0 0; font-size: 14px; color: #475569; }}
        .meta {{ display: grid; gap: 8px; margin: 20px 0 24px; padding: 16px; border-radius: 18px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 13px; color: #334155; }}
        .body {{ display: grid; gap: 14px; font-size: 15px; line-height: 1.68; color: #0f172a; }}
        .body p {{ margin: 0; white-space: pre-wrap; }}
        .empty {{ color: #64748b; font-style: italic; }}
        .footer {{ margin-top: 24px; font-size: 12px; color: #64748b; }}
        </style></head><body><main><article><div class=\"eyebrow\">{eyebrow}</div><h1>{title}</h1>{description}<div class=\"meta\">{meta}</div><div class=\"body\">{body}</div><div class=\"footer\">{footer}</div></article></main></body></html>",
        lang = escape_html(&context.language),
        title = escape_html(&context.title),
        eyebrow = escape_html(translated_provider_template_label(
            &context.language,
            "provider_template_title"
        )),
        description = context.description.as_deref().filter(|value| !value.is_empty()).map(|value| {
            format!("<p class=\"description\">{}</p>", escape_html(value))
        }).unwrap_or_default(),
        meta = meta_items
            .into_iter()
            .map(|value| format!("<div>{value}</div>"))
            .collect::<Vec<_>>()
            .join(""),
        body = body_markup,
        footer = escape_html(&format!(
            "{} {}",
            translated_provider_template_label(&context.language, "generated_on"),
            context.generated_at.format("%d.%m.%Y %H:%M")
        )),
    )
}

fn build_provider_template_pdf(
    context: &GeneratedProviderTemplateContext,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(&context.auto_name);
    let (regular_handle, bold_handle) = pdf_text_font_handles();

    let footer_text = format!(
        "{} · {}",
        context.provider_name,
        context.generated_at.format("%Y-%m-%d")
    );
    let mut layout = TreatmentPlanPdfLayout::new(footer_text, regular_handle, bold_handle);
    layout.set_document_reference(document_reference);

    layout.text_block(
        &context.title,
        21.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Primary,
        0.0,
        3.0,
    );
    if let Some(description) = context
        .description
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            description,
            10.5,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            5.0,
        );
    }

    let patient_line = match context
        .patient_title
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        Some(title) => format!("{title} {}", context.patient_name),
        None => context.patient_name.clone(),
    };
    layout.text_block(
        &patient_line,
        12.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        1.5,
    );
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "patient_id"),
            context.patient_pid
        ),
        10.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    if let Some(birth_date) = context.birth_date {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "birth_date"),
                birth_date
            ),
            10.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    layout.text_block(
        &format!(
            "{}: {}",
            translated_label(&context.language, "provider"),
            context.provider_name
        ),
        10.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
    if let Some(doctor_name) = context
        .doctor_name
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "doctor"),
                doctor_name
            ),
            10.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    if let Some(order_number) = context
        .order_number
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "order_number"),
                order_number
            ),
            10.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    if let Some(appointment_title) = context
        .appointment_title
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let mut parts = vec![appointment_title.to_string()];
        if let Some(appointment_date) = context.appointment_date {
            parts.push(appointment_date.to_string());
        }
        if let Some(appointment_time) = context.appointment_time {
            parts.push(appointment_time.format("%H:%M").to_string());
        }
        layout.text_block(
            &format!(
                "{}: {}",
                translated_provider_template_label(&context.language, "appointment"),
                parts.join(" · ")
            ),
            10.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    if let Some(location) = context
        .location
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "location"),
                location
            ),
            10.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            4.0,
        );
    } else {
        layout.spacer(3.0);
    }

    if context.body_paragraphs.is_empty() {
        layout.text_block(
            translated_provider_template_label(&context.language, "template_body_missing"),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            0.0,
        );
    } else {
        for paragraph in &context.body_paragraphs {
            layout.text_block(
                paragraph,
                11.0,
                false,
                0.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                3.2,
            );
        }
    }

    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    let save_options = pdf_text_save_options();
    Ok(document
        .with_pages(layout.finish())
        .save(&save_options, &mut save_warnings))
}

fn parse_share_status(value: &str) -> Option<ShareStatus> {
    match value {
        "internal" => Some(ShareStatus::InternalOnly),
        "released_internal" => Some(ShareStatus::ReleasedInternal),
        "released_external" => Some(ShareStatus::ReleasedExternal),
        "patient_visible" => Some(ShareStatus::PatientVisible),
        _ => None,
    }
}

fn parse_role_name(value: &str) -> Option<Role> {
    match value {
        "ceo" => Some(Role::Ceo),
        "ceo_assistant" => Some(Role::CeoAssistant),
        "patient_manager" => Some(Role::PatientManager),
        "teamlead_interpreter" => Some(Role::TeamleadInterpreter),
        "interpreter" => Some(Role::Interpreter),
        "concierge" => Some(Role::Concierge),
        "billing" => Some(Role::Billing),
        "sales" => Some(Role::Sales),
        "it_admin" => Some(Role::ItAdmin),
        "patient" => Some(Role::Patient),
        _ => None,
    }
}

#[allow(clippy::result_large_err)]
fn normalize_share_channel(value: Option<&str>) -> Result<String, axum::response::Response> {
    let normalized = value
        .unwrap_or_default()
        .trim()
        .to_lowercase()
        .replace([' ', '-'], "_");

    if normalized.is_empty() {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Share channel is required",
        ))
    } else {
        Ok(normalized)
    }
}

fn is_allowed_internal_share_channel(value: &str) -> bool {
    matches!(
        value,
        "email" | "phone" | "portal" | "fax" | "whatsapp" | "other" | "patient_portal"
    )
}

fn is_allowed_provider_share_channel(value: &str) -> bool {
    matches!(
        value,
        "email" | "phone" | "portal" | "postal_mail" | "secure_email"
    )
}

fn is_allowed_patient_share_channel(value: &str) -> bool {
    matches!(
        value,
        "patient_portal" | "email" | "phone" | "whatsapp" | "postal_mail"
    )
}

fn provider_has_registered_channel(
    channel: &str,
    email: Option<&str>,
    phone: Option<&str>,
    has_postal_address: bool,
) -> bool {
    match channel {
        "email" | "secure_email" => email.map(str::trim).is_some_and(|value| !value.is_empty()),
        "phone" => phone.map(str::trim).is_some_and(|value| !value.is_empty()),
        "postal_mail" => has_postal_address,
        "portal" => true,
        _ => false,
    }
}

fn patient_share_consent_type(channel: &str) -> Option<&'static str> {
    match channel {
        "email" => Some("document_share_email"),
        "phone" => Some("document_share_phone"),
        "whatsapp" => Some("document_share_whatsapp"),
        "postal_mail" => Some("document_share_postal_mail"),
        "patient_portal" => None,
        _ => None,
    }
}

#[allow(clippy::result_large_err)]
fn normalize_document_share_message(
    shared_with_provider_id: Option<Uuid>,
    value: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    let normalized = value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned);

    if shared_with_provider_id.is_some() && normalized.is_none() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provider shares require a cover message",
        ));
    }

    if normalized
        .as_ref()
        .is_some_and(|text| text.chars().count() > 4000)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Share message is too long",
        ));
    }

    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn validate_share_target_count(
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let target_count =
        usize::from(shared_with_provider_id.is_some()) + usize::from(shared_with_user_id.is_some());
    if target_count != 1 {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provide exactly one share target",
        ))
    } else {
        Ok(())
    }
}

#[allow(clippy::result_large_err)]
fn shareable_document_context_from_row(
    row: &sqlx::postgres::PgRow,
) -> Result<ShareableDocumentContext, axum::response::Response> {
    let visibility = row
        .try_get::<String, _>("visibility")
        .unwrap_or_else(|_| "internal".to_string());
    let Some(share_status) = parse_share_status(&visibility) else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document visibility is invalid",
        ));
    };

    Ok(ShareableDocumentContext {
        document_id: row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        patient_id: row
            .try_get::<Option<Uuid>, _>("patient_id")
            .unwrap_or_default(),
        order_id: row
            .try_get::<Option<Uuid>, _>("order_id")
            .unwrap_or_default(),
        appointment_id: row
            .try_get::<Option<Uuid>, _>("appointment_id")
            .unwrap_or_default(),
        sensitivity: infer_document_sensitivity(
            row.try_get::<bool, _>("is_medical").unwrap_or(false),
            row.try_get::<Option<String>, _>("art").unwrap_or_default(),
            row.try_get::<Option<String>, _>("category")
                .unwrap_or_default(),
            share_status,
        ),
        share_status,
    })
}

async fn has_active_patient_share_consent(
    state: &AppState,
    patient_id: Uuid,
    patient_user_id: Uuid,
    channel: &str,
) -> Result<bool, axum::response::Response> {
    let Some(consent_type) = patient_share_consent_type(channel) else {
        return Ok(false);
    };

    sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1
               FROM consent_records
               WHERE patient_id = $1
                 AND user_id = $2
                 AND consent_type = $3
                 AND granted = true
                 AND revoked_at IS NULL
                 AND (expires_at IS NULL OR expires_at > now())
           )"#,
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .bind(consent_type)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, patient_user_id = %patient_user_id, channel, "load patient channel consent");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate patient sharing consent",
        )
    })
}

async fn validate_document_share_target(
    state: &AppState,
    document: &ShareableDocumentContext,
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
    channel: &str,
) -> Result<(), axum::response::Response> {
    if let Some(provider_id) = shared_with_provider_id {
        if !is_allowed_provider_share_channel(channel) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Provider shares require an official registered channel",
            ));
        }

        let provider = sqlx::query(
            r#"SELECT provider_type, is_active, email, phone, address_street, address_city, address_country
               FROM providers
               WHERE id = $1"#,
        )
        .bind(provider_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "load provider for share");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate provider",
            )
        })?;

        let Some(provider) = provider else {
            return Err(err(StatusCode::NOT_FOUND, "Provider not found"));
        };

        let is_active = provider.try_get::<bool, _>("is_active").unwrap_or(false);
        if !is_active {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Target provider must be active",
            ));
        }

        let has_postal_address = provider
            .try_get::<Option<String>, _>("address_street")
            .unwrap_or_default()
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
            && provider
                .try_get::<Option<String>, _>("address_city")
                .unwrap_or_default()
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty())
            && provider
                .try_get::<Option<String>, _>("address_country")
                .unwrap_or_default()
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty());

        if !provider_has_registered_channel(
            channel,
            provider
                .try_get::<Option<String>, _>("email")
                .unwrap_or_default()
                .as_deref(),
            provider
                .try_get::<Option<String>, _>("phone")
                .unwrap_or_default()
                .as_deref(),
            has_postal_address,
        ) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Selected provider does not have this channel registered in the system",
            ));
        }

        let provider_type: String = provider.try_get("provider_type").unwrap_or_default();
        let is_provider_in_context = provider_in_order_or_appointment(
            state,
            provider_id,
            document.order_id,
            document.appointment_id,
        )
        .await?;
        let decision = policy::can_share_with_provider(
            document.share_status,
            document.sensitivity,
            provider_type == "medical",
            is_provider_in_context,
        );
        if !decision.allowed {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, decision.reason));
        }

        if document.sensitivity == DataSensitivity::Medical && provider_type == "medical" {
            let specialty_matches = provider_matches_medical_document_specialty(
                state,
                provider_id,
                document.appointment_id,
            )
            .await?;
            if !specialty_matches {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Selected provider specialty does not match the medical document context",
                ));
            }
        }
    }

    if let Some(user_id) = shared_with_user_id {
        let user_row = sqlx::query("SELECT role, is_active FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, user_id = %user_id, "load user for document share");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate share target",
                )
            })?;

        let Some(user_row) = user_row else {
            return Err(err(StatusCode::NOT_FOUND, "User not found"));
        };

        let role_name: String = user_row.try_get("role").unwrap_or_default();
        let is_active: bool = user_row.try_get("is_active").unwrap_or(false);
        if !is_active {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Target user must be active",
            ));
        }
        let Some(role) = parse_role_name(&role_name) else {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Unsupported share target role",
            ));
        };

        if role == Role::Patient {
            if !is_allowed_patient_share_channel(channel) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Patient shares require a contractually allowed channel",
                ));
            }
            if channel != "patient_portal" {
                let Some(patient_id) = document.patient_id else {
                    return Err(err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Only patient-linked documents can be shared to patients",
                    ));
                };
                let has_consent =
                    has_active_patient_share_consent(state, patient_id, user_id, channel).await?;
                if !has_consent {
                    return Err(err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Selected patient channel is not covered by an active consent record",
                    ));
                }
            }
        } else if !is_allowed_internal_share_channel(channel) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Unsupported internal share channel",
            ));
        }

        let decision = policy::check_access(&AccessContext {
            role,
            user_id,
            is_assigned: true,
            data_sensitivity: document.sensitivity,
            share_status: Some(document.share_status),
        });
        if !decision.allowed {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, decision.reason));
        }
    }

    Ok(())
}

async fn insert_document_share(
    state: &AppState,
    input: DocumentShareInsert<'_>,
) -> Result<Uuid, axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO document_shares (
                document_id, shared_with_provider_id, shared_with_user_id, shared_by,
                channel, requires_confirmation, message
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
    )
    .bind(input.document_id)
    .bind(input.shared_with_provider_id)
    .bind(input.shared_with_user_id)
    .bind(input.auth_user_id)
    .bind(input.channel)
    .bind(input.requires_confirmation)
    .bind(input.message)
    .fetch_one(&state.db)
    .await
    .map(|row| row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()))
    .map_err(|e| {
        tracing::error!(error = %e, document_id = %input.document_id, "create document share");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create share")
    })
}

fn parse_bool_flag(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[allow(clippy::result_large_err)]
fn parse_patient_upload_preset(
    value: &str,
) -> Result<PatientUploadPreset, axum::response::Response> {
    match value.trim().to_lowercase().as_str() {
        "" | "general" => Ok(PatientUploadPreset {
            kind: "general",
            art: "patient_upload",
            category: "portal_upload",
            default_title: "Patient portal upload",
            is_medical: false,
        }),
        "medical_record" => Ok(PatientUploadPreset {
            kind: "medical_record",
            art: "patient_medical_upload",
            category: "medical",
            default_title: "Patient medical document",
            is_medical: true,
        }),
        "correspondence" | "clinic_correspondence" => Ok(PatientUploadPreset {
            kind: "correspondence",
            art: "patient_correspondence_upload",
            category: "clinic_correspondence",
            default_title: "Patient correspondence upload",
            is_medical: false,
        }),
        "analysis" | "analyses" | "lab_analysis" => Ok(PatientUploadPreset {
            kind: "analyses",
            art: "patient_analysis_upload",
            category: "lab_analysis",
            default_title: "Patient analysis upload",
            is_medical: true,
        }),
        "conclusion" | "conclusions" | "medical_report" => Ok(PatientUploadPreset {
            kind: "conclusions",
            art: "patient_conclusion_upload",
            category: "medical_report",
            default_title: "Patient conclusion upload",
            is_medical: true,
        }),
        "invoice" | "invoices" => Ok(PatientUploadPreset {
            kind: "invoices",
            art: "patient_invoice_upload",
            category: "invoice",
            default_title: "Patient invoice upload",
            is_medical: false,
        }),
        "translation" | "translations" => Ok(PatientUploadPreset {
            kind: "translations",
            art: "patient_translation_upload",
            category: "translation",
            default_title: "Patient translation upload",
            is_medical: false,
        }),
        "insurance_document" => Ok(PatientUploadPreset {
            kind: "insurance_document",
            art: "insurance_document",
            category: "administrative",
            default_title: "Insurance document",
            is_medical: false,
        }),
        "payment_proof" => Ok(PatientUploadPreset {
            kind: "payment_proof",
            art: "payment_proof",
            category: "finance",
            default_title: "Payment proof",
            is_medical: false,
        }),
        _ => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Upload kind must be general, correspondence, analyses, conclusions, invoices, translations, medical_record, insurance_document or payment_proof",
        )),
    }
}

fn infer_document_sensitivity(
    is_medical: bool,
    art: Option<String>,
    category: Option<String>,
    share_status: ShareStatus,
) -> DataSensitivity {
    if is_medical {
        return DataSensitivity::Medical;
    }

    let searchable = format!(
        "{} {}",
        art.unwrap_or_default().to_lowercase(),
        category.unwrap_or_default().to_lowercase()
    );

    if searchable.contains("invoice")
        || searchable.contains("payment")
        || searchable.contains("cost")
        || searchable.contains("kosten")
        || searchable.contains("billing")
        || searchable.contains("insurance")
        || searchable.contains("quote")
        || searchable.contains("contract")
        || searchable.contains("single_order")
    {
        return DataSensitivity::Financial;
    }

    if searchable.contains("appointment_confirmation")
        || searchable.contains("consent")
        || searchable.contains("data_release")
        || searchable.contains("identity")
        || searchable.contains("passport")
        || searchable.contains("sticker")
        || searchable.contains("visa")
    {
        return DataSensitivity::PatientIdentity;
    }

    if searchable.contains("concierge")
        || searchable.contains("vip")
        || searchable.contains("transfer")
        || searchable.contains("hotel")
        || searchable.contains("flight")
        || searchable.contains("service")
    {
        return DataSensitivity::Service;
    }

    if share_status == ShareStatus::InternalOnly {
        DataSensitivity::Internal
    } else {
        DataSensitivity::General
    }
}

async fn parse_uuid_field(
    field: axum::extract::multipart::Field<'_>,
) -> Result<Option<Uuid>, axum::response::Response> {
    match field.text().await {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Uuid::parse_str(trimmed)
                    .map(Some)
                    .map_err(|_| err(StatusCode::BAD_REQUEST, "Invalid UUID field"))
            }
        }
        Err(_) => Err(err(StatusCode::BAD_REQUEST, "Invalid multipart field")),
    }
}

async fn parse_text_field(field: axum::extract::multipart::Field<'_>) -> Option<String> {
    field
        .text()
        .await
        .ok()
        .map(|value| value.trim().to_string())
}

async fn parse_optional_text_field(field: axum::extract::multipart::Field<'_>) -> Option<String> {
    parse_text_field(field)
        .await
        .filter(|value| !value.is_empty())
}

async fn parse_optional_date_field(
    field: axum::extract::multipart::Field<'_>,
) -> Result<Option<NaiveDate>, axum::response::Response> {
    let Some(value) = parse_optional_text_field(field).await else {
        return Ok(None);
    };
    NaiveDate::parse_from_str(value.as_str(), "%Y-%m-%d")
        .map(Some)
        .map_err(|_| err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid document date"))
}

fn normalized_optional_owned(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalized_document_enum(
    value: Option<&str>,
    allowed: &[&str],
    message: &'static str,
) -> Result<Option<String>, axum::response::Response> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = value.to_lowercase().replace('-', "_");
    if allowed.contains(&normalized.as_str()) {
        Ok(Some(normalized))
    } else {
        Err(err(StatusCode::UNPROCESSABLE_ENTITY, message))
    }
}

fn normalize_document_direction(
    value: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    normalized_document_enum(
        value,
        &["incoming", "outgoing"],
        "Invalid document direction",
    )
}

fn normalize_document_variant(
    value: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    normalized_document_enum(
        value,
        &["original", "translation"],
        "Invalid document variant",
    )
}

fn normalize_document_access_category(
    value: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    normalized_document_enum(
        value,
        &[
            "internal",
            "patient",
            "provider",
            "authority",
            "financial",
            "medical",
            "other",
        ],
        "Invalid document access category",
    )
}

fn normalize_document_financial_status(
    value: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    normalized_document_enum(
        value,
        &[
            "open",
            "in_progress",
            "paid",
            "overdue",
            "billed_to_patient",
            "reimbursed",
        ],
        "Invalid document financial status",
    )
}

fn normalize_document_payment_method(
    value: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    normalized_document_enum(
        value,
        &["cash", "bank_transfer", "card", "other"],
        "Invalid document payment method",
    )
}

fn infer_document_access_category(
    category: Option<&str>,
    art: &str,
    is_medical: bool,
    visibility: &str,
) -> &'static str {
    if is_medical {
        return "medical";
    }
    let haystack = format!(
        "{} {}",
        category.unwrap_or_default().to_lowercase(),
        art.to_lowercase()
    );
    if [
        "finance",
        "financial",
        "invoice",
        "rechnung",
        "kosten",
        "payment",
    ]
    .iter()
    .any(|needle| haystack.contains(needle))
    {
        return "financial";
    }
    if ["official", "agency", "authority"]
        .iter()
        .any(|needle| haystack.contains(needle))
    {
        return "authority";
    }
    if visibility == "patient_visible" {
        return "patient";
    }
    "internal"
}

fn infer_document_direction(
    generated_template_id: Option<&str>,
    ursprung: Option<&str>,
) -> &'static str {
    if generated_template_id.is_some()
        || ursprung
            .map(|value| value.starts_with("template:"))
            .unwrap_or(false)
    {
        "outgoing"
    } else {
        "incoming"
    }
}

#[derive(Default)]
struct NormalizedDocumentRequestMetadata {
    document_direction: Option<String>,
    document_variant: Option<String>,
    document_language: Option<String>,
    access_category: Option<String>,
    document_date: Option<NaiveDate>,
    source_person: Option<String>,
    source_institution: Option<String>,
    addressee_person: Option<String>,
    addressee_institution: Option<String>,
    financial_status: Option<String>,
    payment_due_date: Option<NaiveDate>,
    payment_date: Option<NaiveDate>,
    payment_method: Option<String>,
}

fn normalize_generate_document_metadata(
    body: &GenerateDocumentRequest,
) -> Result<NormalizedDocumentRequestMetadata, axum::response::Response> {
    let document_language = match body
        .document_language
        .as_deref()
        .or(body.language.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => match normalize_document_language(Some(value)) {
            Some(language) => Some(language.to_string()),
            None => {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Unknown document language",
                ));
            }
        },
        None => None,
    };

    Ok(NormalizedDocumentRequestMetadata {
        document_direction: normalize_document_direction(body.document_direction.as_deref())?,
        document_variant: normalize_document_variant(body.document_variant.as_deref())?,
        document_language,
        access_category: normalize_document_access_category(body.access_category.as_deref())?,
        document_date: body.document_date,
        source_person: normalized_optional_owned(body.source_person.clone()),
        source_institution: normalized_optional_owned(body.source_institution.clone()),
        addressee_person: normalized_optional_owned(body.addressee_person.clone()),
        addressee_institution: normalized_optional_owned(body.addressee_institution.clone()),
        financial_status: normalize_document_financial_status(body.financial_status.as_deref())?,
        payment_due_date: body.payment_due_date,
        payment_date: body.payment_date,
        payment_method: normalize_document_payment_method(body.payment_method.as_deref())?,
    })
}

fn document_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    let visibility = row
        .try_get::<String, _>("visibility")
        .unwrap_or_else(|_| "internal".to_string());
    let art = row.try_get::<Option<String>, _>("art").unwrap_or_default();
    let category = row
        .try_get::<Option<String>, _>("category")
        .unwrap_or_default();
    let ursprung = row
        .try_get::<Option<String>, _>("ursprung")
        .unwrap_or_default();
    let generated_template_id = row_generated_template_id(row);
    let share_status = parse_share_status(&visibility).unwrap_or(ShareStatus::InternalOnly);
    let sensitivity = infer_document_sensitivity(
        row.try_get::<bool, _>("is_medical").unwrap_or(false),
        art.clone(),
        category.clone(),
        share_status,
    );
    let classification_suggestion = suggest_document_classification(
        row.try_get::<Option<String>, _>("original_filename")
            .unwrap_or_default()
            .as_deref(),
        row.try_get::<Option<String>, _>("auto_name")
            .unwrap_or_default()
            .as_deref(),
        row.try_get::<Option<String>, _>("mime_type")
            .unwrap_or_default()
            .as_deref(),
        ursprung.as_deref(),
        row.try_get::<Option<String>, _>("notes")
            .unwrap_or_default()
            .as_deref(),
    );
    let needs_categorization =
        document_needs_categorization(art.as_deref(), category.as_deref(), ursprung.as_deref());

    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "document_number": row.try_get::<String, _>("document_number").unwrap_or_default(),
        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
        "lead_id": row.try_get::<Option<Uuid>, _>("lead_id").unwrap_or_default(),
        "has_active_patient_portal_user": row.try_get::<bool, _>("has_active_patient_portal_user").unwrap_or(false),
        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        "provider_context_ids": row.try_get::<Vec<Uuid>, _>("provider_context_ids").unwrap_or_default(),
        "patient_pid": row.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
        "patient_name": row.try_get::<Option<String>, _>("patient_name").unwrap_or_default(),
        "lead_name": row.try_get::<Option<String>, _>("lead_name").unwrap_or_default(),
        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
        "appointment_title": row.try_get::<Option<String>, _>("appointment_title").unwrap_or_default(),
        "auto_name": row.try_get::<String, _>("auto_name").unwrap_or_default(),
        "original_filename": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
        "art": art,
        "category": category,
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "visibility": visibility,
        "is_medical": row.try_get::<bool, _>("is_medical").unwrap_or(false),
        "mime_type": row.try_get::<Option<String>, _>("mime_type").unwrap_or_default(),
        "file_size": row.try_get::<Option<i64>, _>("file_size").unwrap_or_default(),
        "has_stored_file": row
            .try_get::<Option<String>, _>("storage_key")
            .unwrap_or_default()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        "klinik": row.try_get::<Option<String>, _>("klinik").unwrap_or_default(),
        "ursprung": ursprung,
        "document_direction": row.try_get::<Option<String>, _>("document_direction").unwrap_or_default(),
        "document_variant": row.try_get::<Option<String>, _>("document_variant").unwrap_or_default(),
        "document_language": row.try_get::<Option<String>, _>("document_language").unwrap_or_default(),
        "access_category": row.try_get::<Option<String>, _>("access_category").unwrap_or_default(),
        "document_date": row.try_get::<Option<NaiveDate>, _>("document_date").unwrap_or_default(),
        "source_person": row.try_get::<Option<String>, _>("source_person").unwrap_or_default(),
        "source_institution": row.try_get::<Option<String>, _>("source_institution").unwrap_or_default(),
        "addressee_person": row.try_get::<Option<String>, _>("addressee_person").unwrap_or_default(),
        "addressee_institution": row.try_get::<Option<String>, _>("addressee_institution").unwrap_or_default(),
        "financial_status": row.try_get::<Option<String>, _>("financial_status").unwrap_or_default(),
        "payment_due_date": row.try_get::<Option<NaiveDate>, _>("payment_due_date").unwrap_or_default(),
        "payment_date": row.try_get::<Option<NaiveDate>, _>("payment_date").unwrap_or_default(),
        "payment_method": row.try_get::<Option<String>, _>("payment_method").unwrap_or_default(),
        "signed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "signed_by": row.try_get::<Option<Uuid>, _>("signed_by").unwrap_or_default(),
        "compliance_kind": row.try_get::<Option<String>, _>("compliance_kind").unwrap_or_default(),
        "generated_template_id": generated_template_id,
        "generated_bindings": row.try_get::<Option<Value>, _>("generated_bindings").unwrap_or_default(),
        "generated_manual_text": row.try_get::<Option<String>, _>("generated_manual_text").unwrap_or_default(),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "uploaded_by": row.try_get::<Uuid, _>("uploaded_by").unwrap_or_else(|_| Uuid::nil()),
        "uploaded_by_name": row.try_get::<Option<String>, _>("uploaded_by_name").unwrap_or_default(),
        "version_root_document_id": row.try_get::<Uuid, _>("version_root_document_id").unwrap_or_else(|_| Uuid::nil()),
        "replaces_document_id": row.try_get::<Option<Uuid>, _>("replaces_document_id").unwrap_or_default(),
        "superseded_by_document_id": row.try_get::<Option<Uuid>, _>("superseded_by_document_id").unwrap_or_default(),
        "version_number": row.try_get::<i32, _>("version_number").unwrap_or(1),
        "version_count": row.try_get::<i64, _>("version_count").unwrap_or(1),
        "is_latest_version": row.try_get::<bool, _>("is_latest_version").unwrap_or(true),
        "file_deleted_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("file_deleted_at").unwrap_or_default(),
        "file_deleted_by": row.try_get::<Option<Uuid>, _>("file_deleted_by").unwrap_or_default(),
        "file_deleted_by_name": row.try_get::<Option<String>, _>("file_deleted_by_name").unwrap_or_default(),
        "file_delete_reason": row.try_get::<Option<String>, _>("file_delete_reason").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").unwrap_or_else(|_| chrono::Utc::now()),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").unwrap_or_else(|_| chrono::Utc::now()),
        "share_count": row.try_get::<i64, _>("share_count").unwrap_or(0),
        "shared_to_current": row.try_get::<bool, _>("shared_to_current").unwrap_or(false),
        "data_sensitivity": sensitivity.display_name(),
        "needs_categorization": needs_categorization,
        "classification_suggestion": classification_suggestion,
    })
}

fn document_share_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "document_id": row.try_get::<Uuid, _>("document_id").unwrap_or_else(|_| Uuid::nil()),
        "shared_with_provider_id": row.try_get::<Option<Uuid>, _>("shared_with_provider_id").unwrap_or_default(),
        "shared_with_user_id": row.try_get::<Option<Uuid>, _>("shared_with_user_id").unwrap_or_default(),
        "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
        "target_user_name": row.try_get::<Option<String>, _>("target_user_name").unwrap_or_default(),
        "target_user_role": row.try_get::<Option<String>, _>("target_user_role").unwrap_or_default(),
        "shared_by_name": row.try_get::<Option<String>, _>("shared_by_name").unwrap_or_default(),
        "channel": row.try_get::<Option<String>, _>("channel").unwrap_or_default(),
        "message": row.try_get::<Option<String>, _>("message").unwrap_or_default(),
        "requires_confirmation": row.try_get::<bool, _>("requires_confirmation").unwrap_or(false),
        "confirmed": row.try_get::<bool, _>("confirmed").unwrap_or(false),
        "confirmed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("confirmed_at").unwrap_or_default(),
        "shared_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("shared_at").unwrap_or_else(|_| chrono::Utc::now()),
        "revoked_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at").unwrap_or_default(),
    })
}

fn normalize_translation_request_status(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "pending" => Some("pending"),
        "in_progress" | "in-progress" => Some("in_progress"),
        "completed" => Some("completed"),
        "cancelled" | "canceled" => Some("cancelled"),
        _ => None,
    }
}

fn parse_translation_queue_statuses(
    value: Option<&str>,
) -> Result<Vec<&'static str>, axum::response::Response> {
    let raw = value.unwrap_or("pending,in_progress");
    let mut statuses = Vec::new();
    for part in raw.split(',') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(status) = normalize_translation_request_status(trimmed) else {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid translation request status",
            ));
        };
        if !statuses.contains(&status) {
            statuses.push(status);
        }
    }

    if statuses.is_empty() {
        statuses.push("pending");
        statuses.push("in_progress");
    }

    Ok(statuses)
}

fn document_translation_request_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "document_id": row.try_get::<Uuid, _>("document_id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
        "requested_language": row.try_get::<String, _>("requested_language").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "note": row.try_get::<Option<String>, _>("note").unwrap_or_default(),
        "source_language": row.try_get::<Option<String>, _>("source_language").unwrap_or_default(),
        "source_text": row.try_get::<Option<String>, _>("source_text").unwrap_or_default(),
        "translated_text": row.try_get::<Option<String>, _>("translated_text").unwrap_or_default(),
        "request_source": row.try_get::<String, _>("request_source").unwrap_or_else(|_| "staff".to_string()),
        "requested_by": row.try_get::<Uuid, _>("requested_by").unwrap_or_else(|_| Uuid::nil()),
        "requested_by_name": row.try_get::<Option<String>, _>("requested_by_name").unwrap_or_default(),
        "assigned_to": row.try_get::<Option<Uuid>, _>("assigned_to").unwrap_or_default(),
        "assigned_to_name": row.try_get::<Option<String>, _>("assigned_to_name").unwrap_or_default(),
        "assigned_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("assigned_at").unwrap_or_default(),
        "translated_by": row.try_get::<Option<Uuid>, _>("translated_by").unwrap_or_default(),
        "translated_by_name": row.try_get::<Option<String>, _>("translated_by_name").unwrap_or_default(),
        "translated_document_id": row.try_get::<Option<Uuid>, _>("translated_document_id").unwrap_or_default(),
        "translated_document_name": row.try_get::<Option<String>, _>("translated_document_name").unwrap_or_default(),
        "translated_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("translated_at").unwrap_or_default(),
        "requested_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("requested_at").unwrap_or_else(|_| chrono::Utc::now()),
        "completed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at").unwrap_or_default(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").unwrap_or_else(|_| chrono::Utc::now()),
        "document_name": row.try_get::<Option<String>, _>("document_name").unwrap_or_default(),
        "document_art": row.try_get::<Option<String>, _>("document_art").unwrap_or_default(),
        "document_category": row.try_get::<Option<String>, _>("document_category").unwrap_or_default(),
        "patient_pid": row.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
        "patient_name": row.try_get::<Option<String>, _>("patient_name").unwrap_or_default(),
    })
}

fn document_text_extraction_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    let status = row
        .try_get::<String, _>("text_extraction_status")
        .unwrap_or_else(|_| "not_started".to_string());
    let method = row
        .try_get::<Option<String>, _>("text_extraction_method")
        .unwrap_or_default();

    json!({
        "status": status,
        "method": method,
        "message_key": document_text_extraction_message_key(
            row.try_get::<String, _>("text_extraction_status")
                .unwrap_or_else(|_| "not_started".to_string())
                .as_str(),
            method.as_deref(),
        ),
        "message": document_text_extraction_message(
            row.try_get::<String, _>("text_extraction_status")
                .unwrap_or_else(|_| "not_started".to_string())
                .as_str(),
            method.as_deref(),
        ),
        "extracted_text": row.try_get::<Option<String>, _>("extracted_text").unwrap_or_default(),
        "has_text": row
            .try_get::<Option<String>, _>("extracted_text")
            .unwrap_or_default()
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        "extracted_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("text_extracted_at").unwrap_or_default(),
        "extracted_by": row.try_get::<Option<Uuid>, _>("text_extracted_by").unwrap_or_default(),
        "extracted_by_name": row.try_get::<Option<String>, _>("text_extracted_by_name").unwrap_or_default(),
    })
}

#[derive(Deserialize, Default)]
struct DocumentTranslationQueueQuery {
    status: Option<String>,
    source: Option<String>,
    patient_id: Option<Uuid>,
}

async fn fetch_document_row(
    state: &AppState,
    document_id: Uuid,
    current_user_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(
        r#"SELECT d.id, d.document_number, d.patient_id, d.lead_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.storage_key, d.klinik, d.ursprung,
                  d.document_direction, d.document_variant, d.document_language, d.access_category,
                  d.document_date, d.source_person, d.source_institution, d.addressee_person,
                  d.addressee_institution, d.financial_status, d.payment_due_date, d.payment_date,
                  d.payment_method, d.generated_template_id, d.generated_bindings,
                  d.generated_manual_text,
                  d.signed_at, d.signed_by, d.compliance_kind,
                  d.notes, d.extracted_text, d.text_extraction_status, d.text_extraction_method,
                  d.text_extracted_at, d.text_extracted_by, d.version_root_document_id, d.replaces_document_id,
                  d.version_number, d.uploaded_by, d.created_at, d.updated_at,
                  d.file_deleted_at, d.file_deleted_by, d.file_delete_reason,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  trim(concat_ws(' ', l.first_name, l.last_name)) AS lead_name,
                  o.order_number,
                  a.title AS appointment_title,
                  u.name AS uploaded_by_name,
                  u.role AS uploaded_by_role,
                  extractor.name AS text_extracted_by_name,
                  deleter.name AS file_deleted_by_name,
                  COALESCE((SELECT count(*)::bigint FROM document_shares ds WHERE ds.document_id = d.id AND ds.revoked_at IS NULL), 0) AS share_count,
                  COALESCE((SELECT count(*)::bigint FROM documents dv WHERE dv.version_root_document_id = d.version_root_document_id), 1) AS version_count,
                  (SELECT dv.id FROM documents dv WHERE dv.replaces_document_id = d.id ORDER BY dv.created_at DESC LIMIT 1) AS superseded_by_document_id,
                  NOT EXISTS(
                    SELECT 1 FROM documents dv WHERE dv.replaces_document_id = d.id
                  ) AS is_latest_version,
                  EXISTS(
                    SELECT 1
                    FROM document_shares ds
                    WHERE ds.document_id = d.id
                      AND ds.shared_with_user_id = $2
                      AND ds.revoked_at IS NULL
                  ) AS shared_to_current,
                  EXISTS(
                    SELECT 1
                    FROM patient_assignments pa
                    JOIN users portal_user ON portal_user.id = pa.user_id
                    WHERE pa.patient_id = d.patient_id
                      AND pa.revoked_at IS NULL
                      AND portal_user.is_active = true
                      AND portal_user.role = 'patient'
                  ) AS has_active_patient_portal_user,
                  provider_context.provider_context_ids
           FROM documents d
           LEFT JOIN patients p ON p.id = d.patient_id
           LEFT JOIN leads l ON l.id = d.lead_id
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN appointments a ON a.id = d.appointment_id
           LEFT JOIN users u ON u.id = d.uploaded_by
           LEFT JOIN users extractor ON extractor.id = d.text_extracted_by
           LEFT JOIN users deleter ON deleter.id = d.file_deleted_by
           LEFT JOIN LATERAL (
                SELECT COALESCE(
                    array_agg(DISTINCT provider_id) FILTER (WHERE provider_id IS NOT NULL),
                    ARRAY[]::uuid[]
                ) AS provider_context_ids
                FROM (
                    SELECT appointment.provider_id
                    FROM appointments appointment
                    WHERE d.appointment_id IS NOT NULL
                      AND appointment.id = d.appointment_id

                    UNION

                    SELECT leistung.provider_id
                    FROM order_leistungen leistung
                    WHERE d.order_id IS NOT NULL
                      AND leistung.order_id = d.order_id

                    UNION

                    SELECT order_appointment.provider_id
                    FROM appointments order_appointment
                    WHERE d.order_id IS NOT NULL
                      AND order_appointment.order_id = d.order_id
                ) provider_context_source
           ) provider_context ON TRUE
           WHERE d.id = $1"#,
    )
    .bind(document_id)
    .bind(current_user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, document_id = %document_id, "load document");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load document")
    })
}

async fn store_document_text_extraction_result(
    state: &AppState,
    document_id: Uuid,
    actor_id: Uuid,
    result: &DocumentTextExtractionResult,
) -> Result<(), axum::response::Response> {
    let (status, method, extracted_text) = match result {
        DocumentTextExtractionResult::Completed {
            method,
            extracted_text,
        } => ("completed", *method, Some(extracted_text.as_str())),
        DocumentTextExtractionResult::Unsupported { method, .. } => ("unsupported", *method, None),
        DocumentTextExtractionResult::Failed { method, .. } => ("failed", *method, None),
    };

    sqlx::query(
        r#"UPDATE documents
           SET extracted_text = $2,
               text_extraction_status = $3,
               text_extraction_method = $4,
               text_extracted_at = now(),
               text_extracted_by = $5
           WHERE id = $1"#,
    )
    .bind(document_id)
    .bind(extracted_text)
    .bind(status)
    .bind(method)
    .bind(actor_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, document_id = %document_id, "store document text extraction");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to store document text extraction",
        )
    })?;

    if let DocumentTextExtractionResult::Completed { extracted_text, .. } = result {
        let _ = sqlx::query(
            r#"UPDATE document_translation_requests
               SET source_text = $2
               WHERE document_id = $1
                 AND status IN ('pending', 'in_progress')
                 AND COALESCE(trim(source_text), '') = ''"#,
        )
        .bind(document_id)
        .bind(extracted_text)
        .execute(&state.db)
        .await;
    }

    Ok(())
}

async fn extract_document_text_and_store(
    state: &AppState,
    document_id: Uuid,
    original_filename: Option<&str>,
    mime_type: Option<&str>,
    storage_key: &str,
    actor_id: Uuid,
) -> Result<DocumentTextExtractionResult, axum::response::Response> {
    let bytes = read_document_storage_bytes(
        document_id,
        storage_key,
        mime_type,
        original_filename,
        original_filename,
    )
    .await
    .map_err(|e| {
        tracing::error!(error = %e, document_id = %document_id, storage_key = %storage_key, "read document file for text extraction");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read document file for text extraction",
        )
    })?;

    let result = extract_document_text_from_bytes(mime_type, original_filename, &bytes).await;
    store_document_text_extraction_result(state, document_id, actor_id, &result).await?;
    Ok(result)
}

async fn best_effort_extract_document_text_and_store(
    state: &AppState,
    document_id: Uuid,
    original_filename: Option<&str>,
    mime_type: Option<&str>,
    storage_key: &str,
    actor_id: Uuid,
) {
    if let Err(resp) = extract_document_text_and_store(
        state,
        document_id,
        original_filename,
        mime_type,
        storage_key,
        actor_id,
    )
    .await
    {
        tracing::warn!(
            document_id = %document_id,
            status = %resp.status(),
            "best-effort document text extraction failed"
        );
    }
}

async fn load_replacement_document_version(
    state: &AppState,
    document_id: Uuid,
    patient_id: Uuid,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    expected_template_id: &str,
    template_art: &str,
    template_category: &str,
    allow_legacy_generated_category: bool,
) -> Result<ReplacementDocumentVersion, axum::response::Response> {
    let row = match sqlx::query(
        r#"SELECT d.id, d.patient_id, d.order_id, d.appointment_id, d.art, d.category,
                  d.ursprung, d.generated_template_id,
                  d.status, d.version_root_document_id, d.version_number,
                  EXISTS(
                    SELECT 1 FROM documents dv WHERE dv.replaces_document_id = d.id
                  ) AS already_replaced
           FROM documents d
           WHERE d.id = $1"#,
    )
    .bind(document_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return Err(err(StatusCode::NOT_FOUND, "Replacement document not found")),
        Err(e) => {
            tracing::error!(error = %e, document_id = %document_id, "load replacement document");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load replacement document",
            ));
        }
    };

    if row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default()
        != Some(patient_id)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Replacement document must belong to the same patient",
        ));
    }
    if row
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default()
        != order_id
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Replacement document must keep the same order context",
        ));
    }
    if row
        .try_get::<Option<Uuid>, _>("appointment_id")
        .unwrap_or_default()
        != appointment_id
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Replacement document must keep the same appointment context",
        ));
    }
    let generated_template_id = row_generated_template_id(&row);
    let art = row.try_get::<String, _>("art").unwrap_or_default();
    let category = row
        .try_get::<Option<String>, _>("category")
        .unwrap_or_default();
    let legacy_template_match = art == template_art
        && (category.as_deref() == Some(template_category)
            || (allow_legacy_generated_category && category.as_deref() == Some("generated")));
    let template_matches = generated_template_id
        .as_deref()
        .map(|value| value == expected_template_id)
        .unwrap_or(legacy_template_match);

    if !template_matches {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Replacement document must be the same generated template type",
        ));
    }
    if row.try_get::<bool, _>("already_replaced").unwrap_or(false) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Replacement document already has a newer version",
        ));
    }
    if row.try_get::<String, _>("status").unwrap_or_default() == "archived" {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Archived documents cannot be replaced again",
        ));
    }

    Ok(ReplacementDocumentVersion {
        document_id,
        version_root_document_id: row
            .try_get::<Uuid, _>("version_root_document_id")
            .unwrap_or(document_id),
        version_number: row.try_get::<i32, _>("version_number").unwrap_or(1),
    })
}

async fn load_assignment_set(
    state: &AppState,
    auth: &AuthUser,
) -> Result<HashSet<Uuid>, axum::response::Response> {
    if !access::requires_patient_assignment(auth.role) {
        return Ok(HashSet::new());
    }

    let rows = sqlx::query(
        r#"SELECT patient_id
           FROM patient_assignments
           WHERE user_id = $1
             AND revoked_at IS NULL"#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %auth.user_id, "load patient assignments for documents");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate document access")
    })?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<Uuid, _>("patient_id").ok())
        .collect())
}

async fn require_generated_document_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if !access::requires_patient_assignment(auth.role) {
        return Ok(());
    }
    let assignment_set = load_assignment_set(state, auth).await?;
    if assignment_set.contains(&patient_id) {
        Ok(())
    } else {
        Err(err(
            StatusCode::FORBIDDEN,
            "You are not assigned to this patient",
        ))
    }
}

fn can_view_document_row(
    auth: &AuthUser,
    row: &sqlx::postgres::PgRow,
    assignment_set: &HashSet<Uuid>,
) -> bool {
    let visibility = row
        .try_get::<String, _>("visibility")
        .unwrap_or_else(|_| "internal".to_string());
    let Some(share_status) = parse_share_status(&visibility) else {
        return false;
    };

    let explicit_share = row.try_get::<bool, _>("shared_to_current").unwrap_or(false);
    let patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
    let lead_id: Option<Uuid> = row.try_get("lead_id").unwrap_or_default();
    let is_assigned = if explicit_share || (lead_id.is_some() && auth.role == Role::PatientManager)
    {
        true
    } else if access::requires_patient_assignment(auth.role) {
        patient_id
            .map(|id| assignment_set.contains(&id))
            .unwrap_or(false)
    } else {
        true
    };

    let sensitivity = infer_document_sensitivity(
        row.try_get::<bool, _>("is_medical").unwrap_or(false),
        row.try_get::<Option<String>, _>("art").unwrap_or_default(),
        row.try_get::<Option<String>, _>("category")
            .unwrap_or_default(),
        share_status,
    );

    policy::check_access(&AccessContext {
        role: auth.role,
        user_id: auth.user_id,
        is_assigned,
        data_sensitivity: sensitivity,
        share_status: Some(share_status),
    })
    .allowed
}

fn can_review_document_intake_row(
    auth: &AuthUser,
    row: &sqlx::postgres::PgRow,
    assignment_set: &HashSet<Uuid>,
) -> bool {
    if auth.role == Role::TeamleadInterpreter {
        let uploaded_by_role = row
            .try_get::<Option<String>, _>("uploaded_by_role")
            .unwrap_or_default();
        let ursprung = row
            .try_get::<Option<String>, _>("ursprung")
            .unwrap_or_default();
        let status = row
            .try_get::<Option<String>, _>("status")
            .unwrap_or_default();
        let patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
        let is_assigned = patient_id
            .map(|id| assignment_set.contains(&id))
            .unwrap_or(false);

        if is_assigned
            && is_interpreter_review_document(
                uploaded_by_role.as_deref(),
                ursprung.as_deref(),
                status.as_deref(),
            )
        {
            return true;
        }
    }

    if !can_view_document_row(auth, row, assignment_set) {
        return false;
    }

    match auth.role {
        role if role.has_full_access() => true,
        Role::PatientManager => true,
        Role::TeamleadInterpreter => {
            let uploaded_by_role = row
                .try_get::<Option<String>, _>("uploaded_by_role")
                .unwrap_or_default();
            let ursprung = row
                .try_get::<Option<String>, _>("ursprung")
                .unwrap_or_default();
            let status = row
                .try_get::<Option<String>, _>("status")
                .unwrap_or_default();
            is_interpreter_review_document(
                uploaded_by_role.as_deref(),
                ursprung.as_deref(),
                status.as_deref(),
            )
        }
        _ => false,
    }
}

#[allow(clippy::result_large_err)]
fn validate_teamlead_document_review_update(
    body: &UpdateDocumentRequest,
) -> Result<(), axum::response::Response> {
    if body.patient_id.is_some()
        || body.order_id.is_some()
        || body.appointment_id.is_some()
        || body.auto_name.is_some()
        || body.visibility.is_some()
        || body.klinik.is_some()
        || body.ursprung.is_some()
    {
        return Err(err(
            StatusCode::FORBIDDEN,
            "Teamlead review may update only document classification fields",
        ));
    }

    if let Some(status) = body.status.as_deref()
        && status != "active"
    {
        return Err(err(
            StatusCode::FORBIDDEN,
            "Teamlead review may only release the document into active status",
        ));
    }

    Ok(())
}

async fn validate_document_context(
    state: &AppState,
    mut patient_id: Option<Uuid>,
    mut lead_id: Option<Uuid>,
    mut order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
) -> Result<(Option<Uuid>, Option<Uuid>, Option<Uuid>, Option<Uuid>), axum::response::Response> {
    if let Some(appointment_id) = appointment_id {
        if lead_id.is_some() {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Appointment documents cannot use lead context",
            ));
        }
        let row = sqlx::query("SELECT patient_id, order_id FROM appointments WHERE id = $1")
            .bind(appointment_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, appointment_id = %appointment_id, "validate document appointment context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate appointment context")
            })?;

        let Some(row) = row else {
            return Err(err(StatusCode::NOT_FOUND, "Appointment not found"));
        };
        let appointment_patient_id: Uuid =
            row.try_get("patient_id").unwrap_or_else(|_| Uuid::nil());
        let appointment_order_id: Option<Uuid> = row.try_get("order_id").unwrap_or_default();

        if let Some(existing) = patient_id {
            if existing != appointment_patient_id {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Appointment and patient context do not match",
                ));
            }
        } else {
            patient_id = Some(appointment_patient_id);
        }

        if let Some(existing) = order_id {
            if appointment_order_id.is_some() && appointment_order_id != Some(existing) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Appointment and order context do not match",
                ));
            }
        } else if appointment_order_id.is_some() {
            order_id = appointment_order_id;
        }
    }

    if let Some(order_id_value) = order_id {
        let row = sqlx::query(
            "SELECT patient_id, source_lead_id FROM orders WHERE id = $1",
        )
            .bind(order_id_value)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, order_id = %order_id_value, "validate document order context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate order context")
            })?;

        let Some(row) = row else {
            return Err(err(StatusCode::NOT_FOUND, "Order not found"));
        };
        let order_patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
        let order_lead_id: Option<Uuid> = row.try_get("source_lead_id").unwrap_or_default();

        if let Some(existing) = patient_id {
            if Some(existing) != order_patient_id {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Order and patient context do not match",
                ));
            }
        } else if order_patient_id.is_some() {
            patient_id = order_patient_id;
            lead_id = None;
        } else if let Some(existing) = lead_id {
            if Some(existing) != order_lead_id {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Order and lead context do not match",
                ));
            }
        } else {
            lead_id = order_lead_id;
        }
    }

    if patient_id.is_some() && lead_id.is_some() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document cannot use patient and lead context at the same time",
        ));
    }

    if let Some(lead_id) = lead_id {
        let converted_patient_id = sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT converted_patient_id FROM leads WHERE id = $1",
        )
        .bind(lead_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, lead_id = %lead_id, "validate document lead context");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate lead context",
            )
        })?;
        match converted_patient_id {
            Some(None) => {}
            Some(Some(_)) => {
                return Err(err(
                    StatusCode::CONFLICT,
                    "Converted lead must use its patient context",
                ));
            }
            None => return Err(err(StatusCode::NOT_FOUND, "Lead not found")),
        }
    }

    Ok((patient_id, lead_id, order_id, appointment_id))
}

async fn provider_in_order_or_appointment(
    state: &AppState,
    provider_id: Uuid,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    if let Some(appointment_id) = appointment_id {
        let row = sqlx::query(
            r#"SELECT EXISTS(
                    SELECT 1 FROM appointments
                    WHERE id = $1 AND provider_id = $2
                )"#,
        )
        .bind(appointment_id)
        .bind(provider_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, appointment_id = %appointment_id, provider_id = %provider_id, "validate provider share appointment context");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate provider share context",
            )
        })?;
        return row.try_get(0).map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate provider share context",
            )
        });
    }

    if let Some(order_id) = order_id {
        let row = sqlx::query(
            r#"SELECT EXISTS(
                    SELECT 1 FROM order_leistungen
                    WHERE order_id = $1 AND provider_id = $2
                ) OR EXISTS(
                    SELECT 1 FROM appointments
                    WHERE order_id = $1 AND provider_id = $2
                )"#,
        )
        .bind(order_id)
        .bind(provider_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, order_id = %order_id, provider_id = %provider_id, "validate provider share context");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate provider share context",
            )
        })?;
        return row.try_get(0).map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate provider share context",
            )
        });
    }

    Ok(true)
}

async fn provider_matches_medical_document_specialty(
    state: &AppState,
    provider_id: Uuid,
    appointment_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    let Some(appointment_id) = appointment_id else {
        return Ok(true);
    };

    let appointment_specialty = sqlx::query(
        r#"SELECT COALESCE(
                    NULLIF(lower(trim(doctor.fachbereich)), ''),
                    NULLIF(lower(trim(provider.fachbereich)), '')
               ) AS appointment_specialty
           FROM appointments a
           LEFT JOIN provider_doctors doctor ON doctor.id = a.doctor_id
           LEFT JOIN providers provider ON provider.id = a.provider_id
           WHERE a.id = $1"#,
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, provider_id = %provider_id, "load appointment specialty context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate provider specialty context",
        )
    })?;

    let Some(appointment_specialty) = appointment_specialty.and_then(|row| {
        row.try_get::<Option<String>, _>("appointment_specialty")
            .ok()
            .flatten()
    }) else {
        return Ok(true);
    };

    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1
               FROM providers p
               WHERE p.id = $1
                 AND lower(trim(COALESCE(p.fachbereich, ''))) = $2
           ) OR EXISTS(
               SELECT 1
               FROM provider_doctor_links l
               JOIN provider_doctors d ON d.id = l.doctor_id
               WHERE l.provider_id = $1
                 AND lower(trim(COALESCE(d.fachbereich, ''))) = $2
           )"#,
    )
    .bind(provider_id)
    .bind(appointment_specialty)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, provider_id = %provider_id, "validate provider specialty match");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate provider specialty context",
        )
    })
}

pub(crate) async fn persist_document_file(
    state: &AppState,
    data: &[u8],
    input: &NewStoredDocument<'_>,
) -> Result<(Uuid, i64, String, String), axum::response::Response> {
    let document_id = input.document_id.unwrap_or_else(Uuid::new_v4);
    let original_filename = if input.original_filename.trim().is_empty() {
        "document.bin".to_string()
    } else {
        input.original_filename.trim().to_string()
    };
    let compact_filename = compact_storage_filename(&original_filename, 96);
    let storage_key = format!("{}_{}", Uuid::new_v4(), compact_filename);
    let file_size = data.len() as i64;

    if let Err(e) = tokio::fs::create_dir_all(FsPath::new(UPLOAD_DIR)).await {
        tracing::error!(error = %e, "create document upload directory");
        return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error"));
    }
    let path = FsPath::new(UPLOAD_DIR).join(&storage_key);
    if let Err(e) = tokio::fs::write(&path, data).await {
        tracing::error!(error = %e, "write document file");
        return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if let Err(e) =
            tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).await
        {
            tracing::error!(error = %e, path = %path.display(), "restrict document file permissions");
            let _ = tokio::fs::remove_file(&path).await;
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Storage error"));
        }
    }

    if let Err(e) = sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, lead_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, mime_type, file_size,
                storage_key, klinik, ursprung, notes, generated_template_id,
                generated_bindings, generated_manual_text,
                document_direction, document_variant, document_language, access_category,
                document_date, source_person, source_institution, addressee_person,
                addressee_institution, financial_status, payment_due_date, payment_date,
                payment_method, version_root_document_id, replaces_document_id,
                version_number, uploaded_by, document_number
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19,
                $20, $21,
                $22, $23, $24, $25,
                $26, $27, $28, $29,
                $30, $31, $32, $33,
                $34, $35, $36, $37, $38, $39
           )"#,
    )
    .bind(document_id)
    .bind(input.patient_id)
    .bind(input.lead_id)
    .bind(input.order_id)
    .bind(input.appointment_id)
    .bind(input.auto_name.trim())
    .bind(original_filename.clone())
    .bind(input.art.trim())
    .bind(input.category)
    .bind(input.status)
    .bind(input.visibility)
    .bind(input.is_medical)
    .bind(input.mime_type)
    .bind(file_size)
    .bind(storage_key.clone())
    .bind(input.klinik)
    .bind(input.ursprung)
    .bind(input.notes)
    .bind(input.generated_template_id)
    .bind(input.generated_bindings)
    .bind(input.generated_manual_text)
    .bind(input.document_direction)
    .bind(input.document_variant)
    .bind(input.document_language)
    .bind(input.access_category)
    .bind(input.document_date)
    .bind(input.source_person)
    .bind(input.source_institution)
    .bind(input.addressee_person)
    .bind(input.addressee_institution)
    .bind(input.financial_status)
    .bind(input.payment_due_date)
    .bind(input.payment_date)
    .bind(input.payment_method)
    .bind(input.version_root_document_id.unwrap_or(document_id))
    .bind(input.replaces_document_id)
    .bind(input.version_number)
    .bind(input.uploaded_by)
    .bind(input.document_number)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, "insert document row");
        let _ = tokio::fs::remove_file(&path).await;
        return Err(err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save document",
        ));
    }

    // A collected lead document advances compliance 'pending' -> 'documents_sent'
    // (see docs/lead-status-strategy-ua.md). Non-fatal; signing the DSGVO form
    // later advances it to 'signed'.
    if let Some(lead_id) = input.lead_id
        && let Err(error) = sqlx::query(
            r#"UPDATE leads
               SET compliance_status = 'documents_sent', updated_at = now()
               WHERE id = $1
                 AND compliance_status = 'pending'
                 AND converted_patient_id IS NULL"#,
        )
        .bind(lead_id)
        .execute(&state.db)
        .await
    {
        tracing::warn!(error = %error, lead_id = %lead_id, "advance lead compliance to documents_sent");
    }

    Ok((document_id, file_size, original_filename, storage_key))
}

async fn stage_document_file_delete(
    storage_key: Option<&str>,
) -> Result<Option<StagedDocumentDelete>, axum::response::Response> {
    let Some(storage_key) = storage_key.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let original_path = FsPath::new(UPLOAD_DIR).join(storage_key);
    let staged_path = FsPath::new(UPLOAD_DIR).join(format!(
        ".pending-delete-{}-{storage_key}",
        Uuid::new_v4().simple()
    ));

    match tokio::fs::rename(&original_path, &staged_path).await {
        Ok(_) => Ok(Some(StagedDocumentDelete {
            original_path,
            staged_path,
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => {
            tracing::error!(
                error = %error,
                path = %original_path.display(),
                "stage document file delete"
            );
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to prepare document file deletion",
            ))
        }
    }
}

async fn rollback_staged_document_delete(staged: &StagedDocumentDelete) {
    if let Err(error) = tokio::fs::rename(&staged.staged_path, &staged.original_path).await {
        tracing::error!(
            error = %error,
            staged_path = %staged.staged_path.display(),
            original_path = %staged.original_path.display(),
            "rollback staged document delete"
        );
    }
}

async fn finalize_staged_document_delete(staged: &StagedDocumentDelete) {
    if let Err(error) = tokio::fs::remove_file(&staged.staged_path).await {
        tracing::warn!(
            error = %error,
            staged_path = %staged.staged_path.display(),
            "finalize staged document delete"
        );
    }
}

async fn list_document_templates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let provider_templates = match load_active_provider_document_templates(&state).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let mut templates = DOCUMENT_TEMPLATES
        .iter()
        .map(|template| {
            json!({
                "id": template.id,
                "template_kind": "builtin",
                "label": template.label,
                "description": template.description,
                "art": template.art,
                "category": template.category,
                "default_auto_name": template.default_auto_name,
                "default_status": template.default_status,
                "default_visibility": template.default_visibility,
                "is_medical": template.is_medical,
                "supported_languages": template.languages,
                "text_block_keys": template.text_block_keys,
            })
        })
        .collect::<Vec<_>>();
    templates.extend(provider_templates.into_iter().map(|template| {
        json!({
            "id": provider_template_public_id(template.id),
            "template_kind": "provider",
            "provider_id": template.provider_id,
            "provider_name": template.provider_name,
            "doctor_id": template.doctor_id,
            "doctor_name": template.doctor_name,
            "label": template.label,
            "description": template.description,
            "art": template.art,
            "category": template.category,
            "default_auto_name": template.default_auto_name,
            "default_status": template.default_status,
            "default_visibility": template.default_visibility,
            "is_medical": template.is_medical,
            "supported_languages": template.supported_languages,
            "text_block_keys": Vec::<String>::new(),
        })
    }));

    Json(json!({
        "templates": templates,
        "text_blocks": DOCUMENT_TEXT_BLOCKS.iter().map(|block| {
            json!({
                "key": block.key,
                "label": block.label,
                "description": block.description,
            })
        }).collect::<Vec<_>>(),
    }))
    .into_response()
}

async fn generate_provider_document_from_template_internal(
    state: &AppState,
    actor_user_id: Uuid,
    body: &GenerateDocumentRequest,
    template: ProviderDocumentTemplate,
) -> Result<GeneratedProviderDocumentResult, axum::response::Response> {
    let status = body
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(template.default_status.as_str());
    let visibility = body
        .visibility
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(template.default_visibility.as_str());
    if !matches!(status, "draft" | "active" | "archived") {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid document status",
        ));
    }
    if parse_share_status(visibility).is_none() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid document visibility",
        ));
    }
    if body.language.as_deref().is_some()
        && normalize_document_language(body.language.as_deref()).is_none()
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown document language",
        ));
    }

    let (patient_id, _lead_id, order_id, appointment_id) = match validate_document_context(
        state,
        body.patient_id,
        None,
        body.order_id,
        body.appointment_id,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return Err(resp),
    };
    let Some(patient_uuid) = patient_id else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Generated documents must be linked to a patient",
        ));
    };

    let patient_row = match sqlx::query(
        r#"SELECT patient_id, title, first_name, last_name, birth_date, languages
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return Err(err(StatusCode::NOT_FOUND, "Patient not found")),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, "load provider template patient context");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient context",
            ));
        }
    };

    let patient_pid = patient_row
        .try_get::<String, _>("patient_id")
        .unwrap_or_else(|_| "PID".to_string());
    let patient_first_name = patient_row
        .try_get::<String, _>("first_name")
        .unwrap_or_default();
    let patient_last_name = patient_row
        .try_get::<String, _>("last_name")
        .unwrap_or_default();
    let patient_name = format!("{patient_first_name} {patient_last_name}")
        .trim()
        .to_string();
    let patient_title = patient_row
        .try_get::<Option<String>, _>("title")
        .unwrap_or_default();
    let patient_languages = patient_row
        .try_get::<Vec<String>, _>("languages")
        .unwrap_or_default();
    let birth_date = patient_row
        .try_get::<Option<NaiveDate>, _>("birth_date")
        .unwrap_or_default();

    if let Some(requested_language) = normalize_document_language(body.language.as_deref())
        && !template
            .supported_languages
            .iter()
            .any(|supported| supported == requested_language)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Language is not supported by the selected template",
        ));
    }

    let language = resolve_owned_document_language(
        body.language.as_deref(),
        &patient_languages,
        &template.supported_languages,
    );
    let Some(template_body) = provider_template_body_for_language(&template, &language) else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Language is not supported by the selected template",
        ));
    };
    let generated_template_id = provider_template_public_id(template.id);

    let order_number = if let Some(order_uuid) = order_id {
        match sqlx::query_scalar::<_, String>("SELECT order_number FROM orders WHERE id = $1")
            .bind(order_uuid)
            .fetch_optional(&state.db)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error = %error, order_id = %order_uuid, "load provider template order context");
                return Err(err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load order context",
                ));
            }
        }
    } else {
        None
    };

    let appointment_context = if let Some(appointment_uuid) = appointment_id {
        match sqlx::query(
            r#"SELECT a.provider_id, a.doctor_id, a.title, a.date, a.time_start, a.location
               FROM appointments a
               WHERE a.id = $1"#,
        )
        .bind(appointment_uuid)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(row)) => Some(row),
            Ok(None) => return Err(err(StatusCode::NOT_FOUND, "Appointment not found")),
            Err(error) => {
                tracing::error!(error = %error, appointment_id = %appointment_uuid, "load provider template appointment context");
                return Err(err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load appointment context",
                ));
            }
        }
    } else {
        None
    };

    if let Some(appointment_row) = appointment_context.as_ref() {
        let appointment_provider_id = appointment_row
            .try_get::<Option<Uuid>, _>("provider_id")
            .unwrap_or_default();
        if appointment_provider_id != Some(template.provider_id) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Provider template must match the appointment provider context",
            ));
        }
        if let Some(template_doctor_id) = template.doctor_id {
            let appointment_doctor_id = appointment_row
                .try_get::<Option<Uuid>, _>("doctor_id")
                .unwrap_or_default();
            if appointment_doctor_id.is_some() && appointment_doctor_id != Some(template_doctor_id)
            {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Provider template doctor must match the appointment doctor context",
                ));
            }
        }
    }

    let appointment_title = appointment_context
        .as_ref()
        .and_then(|row| row.try_get::<Option<String>, _>("title").ok().flatten());
    let appointment_date = appointment_context
        .as_ref()
        .and_then(|row| row.try_get::<Option<NaiveDate>, _>("date").ok().flatten());
    let appointment_time = appointment_context.as_ref().and_then(|row| {
        row.try_get::<Option<NaiveTime>, _>("time_start")
            .ok()
            .flatten()
    });
    let appointment_location = appointment_context
        .as_ref()
        .and_then(|row| row.try_get::<Option<String>, _>("location").ok().flatten());

    let mut replacements = BTreeMap::new();
    replacements.insert("patient_id", patient_pid.clone());
    replacements.insert("patient_name", patient_name.clone());
    replacements.insert("patient_first_name", patient_first_name.clone());
    replacements.insert("patient_last_name", patient_last_name.clone());
    replacements.insert("patient_title", patient_title.clone().unwrap_or_default());
    replacements.insert(
        "birth_date",
        birth_date
            .map(|value| value.to_string())
            .unwrap_or_default(),
    );
    replacements.insert("provider_name", template.provider_name.clone());
    replacements.insert("clinic_name", template.provider_name.clone());
    replacements.insert(
        "doctor_name",
        template.doctor_name.clone().unwrap_or_default(),
    );
    replacements.insert(
        "appointment_title",
        appointment_title.clone().unwrap_or_default(),
    );
    replacements.insert(
        "appointment_date",
        appointment_date
            .map(|value| value.to_string())
            .unwrap_or_default(),
    );
    replacements.insert(
        "appointment_time",
        appointment_time
            .map(|value| value.format("%H:%M").to_string())
            .unwrap_or_default(),
    );
    replacements.insert("location", appointment_location.clone().unwrap_or_default());
    replacements.insert("order_number", order_number.clone().unwrap_or_default());
    replacements.insert("today", chrono::Utc::now().date_naive().to_string());

    let rendered_body = apply_provider_template_placeholders(template_body, &replacements);
    let generated_at = chrono::Utc::now();
    let generated_document_id = Uuid::new_v4();
    let generated_document_number = generated_document_public_id(generated_document_id);
    let auto_name = body
        .auto_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "{} · {} · {}",
                template.default_auto_name,
                patient_name,
                generated_at.format("%Y-%m-%d")
            )
        });
    let manual_text = normalize_generated_manual_text(body.manual_text.as_deref())?;

    let mut body_paragraphs = Vec::new();
    if let Some(manual_text) = manual_text.as_deref() {
        body_paragraphs.extend(generated_manual_text_paragraphs(manual_text));
    } else {
        if let Some(introduction) = body
            .introduction
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            body_paragraphs.push(introduction.to_string());
        }
        body_paragraphs.extend(provider_template_paragraphs(&rendered_body));
        if let Some(closing_note) = body
            .closing_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            body_paragraphs.push(closing_note.to_string());
        }
    }

    let context = GeneratedProviderTemplateContext {
        patient_pid: patient_pid.clone(),
        patient_name: patient_name.clone(),
        patient_title: patient_title.clone(),
        birth_date,
        language: language.clone(),
        auto_name: auto_name.clone(),
        title: body
            .title_override
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| template.label.clone()),
        description: template.description.clone(),
        provider_name: template.provider_name.clone(),
        doctor_name: template.doctor_name.clone(),
        appointment_title,
        appointment_date,
        appointment_time,
        location: appointment_location,
        order_number: order_number.clone(),
        body_paragraphs,
        generated_at,
    };

    let preview_html = build_provider_template_html(&context);
    let pdf_bytes = match build_provider_template_pdf(&context, &generated_document_number) {
        Ok(bytes) => bytes,
        Err(message) => return Err(err(StatusCode::INTERNAL_SERVER_ERROR, message)),
    };

    let original_filename = format!(
        "{}.pdf",
        sanitize_filename(&auto_name.replace([' ', '/', '\\'], "_"))
    );
    let ursprung = body
        .ursprung
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("template:{generated_template_id}"));
    let klinik = body
        .klinik
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| template.provider_name.clone());
    let metadata = normalize_generate_document_metadata(body)?;

    let replacement = if let Some(replace_document_id) = body.replace_document_id {
        match load_replacement_document_version(
            state,
            replace_document_id,
            patient_uuid,
            order_id,
            appointment_id,
            &generated_template_id,
            &template.art,
            &template.category,
            false,
        )
        .await
        {
            Ok(value) => Some(value),
            Err(resp) => return Err(resp),
        }
    } else {
        None
    };

    let persist_input = NewStoredDocument {
        document_id: Some(generated_document_id),
        document_number: Some(generated_document_number.as_str()),
        patient_id,
        lead_id: None,
        order_id,
        appointment_id,
        auto_name: &auto_name,
        original_filename: &original_filename,
        art: &template.art,
        category: Some(template.category.as_str()),
        status,
        visibility,
        is_medical: template.is_medical,
        mime_type: "application/pdf",
        klinik: Some(klinik.as_str()),
        ursprung: Some(ursprung.as_str()),
        notes: body
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        document_direction: metadata.document_direction.as_deref().or(Some(
            infer_document_direction(
                Some(generated_template_id.as_str()),
                Some(ursprung.as_str()),
            ),
        )),
        document_variant: metadata.document_variant.as_deref().or(Some("original")),
        document_language: metadata
            .document_language
            .as_deref()
            .or(Some(language.as_str())),
        access_category: metadata.access_category.as_deref().or(Some(
            infer_document_access_category(
                Some(template.category.as_str()),
                template.art.as_str(),
                template.is_medical,
                visibility,
            ),
        )),
        document_date: metadata
            .document_date
            .or_else(|| Some(chrono::Utc::now().date_naive())),
        source_person: metadata.source_person.as_deref(),
        source_institution: metadata
            .source_institution
            .as_deref()
            .or(Some(klinik.as_str())),
        addressee_person: metadata
            .addressee_person
            .as_deref()
            .or(Some(patient_name.as_str())),
        addressee_institution: metadata.addressee_institution.as_deref(),
        financial_status: metadata.financial_status.as_deref(),
        payment_due_date: metadata.payment_due_date,
        payment_date: metadata.payment_date,
        payment_method: metadata.payment_method.as_deref(),
        generated_template_id: Some(generated_template_id.as_str()),
        generated_bindings: None,
        generated_manual_text: manual_text.as_deref(),
        version_root_document_id: replacement
            .as_ref()
            .map(|value| value.version_root_document_id),
        replaces_document_id: replacement.as_ref().map(|value| value.document_id),
        version_number: replacement
            .as_ref()
            .map(|value| value.version_number + 1)
            .unwrap_or(1),
        uploaded_by: actor_user_id,
    };

    let (document_id, file_size, original_filename, storage_key) =
        match persist_document_file(state, &pdf_bytes, &persist_input).await {
            Ok(value) => value,
            Err(resp) => return Err(resp),
        };
    best_effort_extract_document_text_and_store(
        state,
        document_id,
        Some(original_filename.as_str()),
        Some("application/pdf"),
        storage_key.as_str(),
        actor_user_id,
    )
    .await;

    if let Some(replaced) = replacement.as_ref() {
        if let Err(e) = sqlx::query(
            r#"UPDATE documents
               SET status = 'archived'
               WHERE id = $1"#,
        )
        .bind(replaced.document_id)
        .execute(&state.db)
        .await
        {
            tracing::error!(error = %e, replaced_document_id = %replaced.document_id, "archive replaced provider template document");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to archive replaced document",
            ));
        }

        if let Err(e) = sqlx::query(
            r#"UPDATE document_shares
               SET revoked_at = now()
               WHERE document_id = $1
                 AND channel = 'patient_portal'
                 AND revoked_at IS NULL"#,
        )
        .bind(replaced.document_id)
        .execute(&state.db)
        .await
        {
            tracing::error!(error = %e, replaced_document_id = %replaced.document_id, "revoke superseded provider template portal releases");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to finalize replaced document version",
            ));
        }
    }

    state.audit_sender.try_send(audit::domain_event(
        "generate_document_from_template",
        Some(actor_user_id),
        "document",
        Some(document_id),
        json!({
            "template_id": generated_template_id.as_str(),
            "patient_id": patient_uuid,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": language,
            "replace_document_id": replacement.as_ref().map(|value| value.document_id),
            "version_number": persist_input.version_number,
        }),
    ));

    Ok(GeneratedProviderDocumentResult {
        id: document_id,
        document_number: generated_document_number.clone(),
        auto_name: auto_name.clone(),
        original_filename,
        mime_type: "application/pdf",
        file_size,
        language: context.language,
        generated_template_id: generated_template_id.clone(),
        version_root_document_id: replacement
            .as_ref()
            .map(|value| value.version_root_document_id)
            .unwrap_or(document_id),
        replaces_document_id: replacement.as_ref().map(|value| value.document_id),
        version_number: persist_input.version_number,
        preview_html,
    })
}

async fn generate_provider_document_from_template(
    state: &AppState,
    auth: &AuthUser,
    body: &GenerateDocumentRequest,
    template: ProviderDocumentTemplate,
) -> axum::response::Response {
    match generate_provider_document_from_template_internal(state, auth.user_id, body, template)
        .await
    {
        Ok(result) => Json(json!({
            "ok": true,
            "id": result.id,
            "document_number": result.document_number,
            "auto_name": result.auto_name,
            "original_filename": result.original_filename,
            "mime_type": result.mime_type,
            "file_size": result.file_size,
            "language": result.language,
            "generated_template_id": result.generated_template_id,
            "version_number": result.version_number,
            "version_root_document_id": result.version_root_document_id,
            "replaces_document_id": result.replaces_document_id,
            "preview_html": result.preview_html,
        }))
        .into_response(),
        Err(resp) => resp,
    }
}

async fn generate_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<GenerateDocumentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::ItAdmin]) {
        return resp;
    }

    if let Some(provider_template_id) = parse_provider_template_public_id(body.template_id.trim()) {
        if body.lead_id.is_some() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Provider templates require a patient context",
            );
        }
        if access::requires_patient_assignment(auth.role) {
            let (resolved_patient_id, _, _, _) = match validate_document_context(
                &state,
                body.patient_id,
                None,
                body.order_id,
                body.appointment_id,
            )
            .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let Some(resolved_patient_id) = resolved_patient_id else {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Generated documents must be linked to a patient",
                );
            };
            if let Err(resp) =
                require_generated_document_patient_access(&state, &auth, resolved_patient_id).await
            {
                return resp;
            }
        }
        let template = match load_provider_document_template(&state, provider_template_id).await {
            Ok(Some(value)) => value,
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Unknown document template",
                );
            }
            Err(resp) => return resp,
        };
        return generate_provider_document_from_template(&state, &auth, &body, template).await;
    }

    let Some(template) = document_template_by_id(body.template_id.trim()) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown document template",
        );
    };

    let has_free_form_override = body
        .manual_text
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || body
            .title_override
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        || body
            .introduction
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        || body
            .closing_note
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    if is_fixed_legal_document_template(template.id) && has_free_form_override {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Fixed legal templates do not support free-form text overrides",
        );
    }

    let status = body
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(template.default_status);
    let visibility = body
        .visibility
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(template.default_visibility);
    if !matches!(status, "draft" | "active" | "archived") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid document status");
    }
    if parse_share_status(visibility).is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid document visibility",
        );
    }

    if body.language.as_deref().is_some()
        && normalize_document_language(body.language.as_deref()).is_none()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown document language",
        );
    }

    let (patient_id, lead_id, order_id, appointment_id) = match validate_document_context(
        &state,
        body.patient_id,
        body.lead_id,
        body.order_id,
        body.appointment_id,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if patient_id.is_none() && lead_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Generated documents must be linked to a patient or lead",
        );
    }
    if let Some(patient_uuid) = patient_id
        && let Err(resp) =
            require_generated_document_patient_access(&state, &auth, patient_uuid).await
    {
        return resp;
    }

    if lead_id.is_some() && !is_lead_allowed_document_template(template.id) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "This template is only available after patient conversion",
        );
    }
    if lead_id.is_some() && body.replace_document_id.is_some() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Lead document versions must be generated as a new document",
        );
    }

    let patient_uuid = patient_id.unwrap_or_else(Uuid::nil);

    let patient_row = if let Some(patient_uuid) = patient_id {
        match sqlx::query(
            r#"SELECT patient_id, title, first_name, last_name, birth_date, gender,
                      languages, nationality, residence_country, insurance_provider,
                      email, phone_primary, address_street, address_city, address_zip, address_country
               FROM patients
               WHERE id = $1"#,
        )
        .bind(patient_uuid)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(row)) => row,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
            Err(e) => {
                tracing::error!(error = %e, patient_id = %patient_uuid, "load template patient context");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load patient context",
                );
            }
        }
    } else {
        let lead_uuid = lead_id.unwrap_or_else(Uuid::nil);
        match sqlx::query(
            r#"SELECT
                      'LEAD-' || upper(left(replace(id::text, '-', ''), 8)) AS patient_id,
                      NULL::text AS title,
                      first_name,
                      last_name,
                      date_of_birth AS birth_date,
                      CASE legal_sex
                          WHEN 'female' THEN 'female'
                          WHEN 'male' THEN 'male'
                          ELSE 'diverse'
                      END AS gender,
                      CASE
                          WHEN NULLIF(btrim(primary_language), '') IS NULL THEN ARRAY[]::text[]
                          ELSE ARRAY[primary_language]
                      END AS languages,
                      NULL::text AS nationality,
                      country AS residence_country,
                      insurance_provider,
                      email,
                      phone AS phone_primary,
                      street_address AS address_street,
                      city AS address_city,
                      zip_code AS address_zip,
                      country AS address_country
               FROM leads
               WHERE id = $1 AND converted_patient_id IS NULL"#,
        )
        .bind(lead_uuid)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(row)) => row,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
            Err(e) => {
                tracing::error!(error = %e, lead_id = %lead_uuid, "load template lead context");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load lead context",
                );
            }
        }
    };

    let patient_pid = patient_row
        .try_get::<String, _>("patient_id")
        .unwrap_or_else(|_| "PID".to_string());
    let patient_name = format!(
        "{} {}",
        patient_row
            .try_get::<String, _>("first_name")
            .unwrap_or_default()
            .trim(),
        patient_row
            .try_get::<String, _>("last_name")
            .unwrap_or_default()
            .trim()
    )
    .trim()
    .to_string();
    let patient_title = patient_row
        .try_get::<Option<String>, _>("title")
        .unwrap_or_default();
    let patient_languages = patient_row
        .try_get::<Vec<String>, _>("languages")
        .unwrap_or_default();
    let birth_date = patient_row
        .try_get::<Option<NaiveDate>, _>("birth_date")
        .unwrap_or_default();
    let patient_gender = patient_row
        .try_get::<String, _>("gender")
        .unwrap_or_else(|_| "diverse".to_string());
    let nationality = patient_row
        .try_get::<Option<String>, _>("nationality")
        .unwrap_or_default();
    let residence_country = patient_row
        .try_get::<Option<String>, _>("residence_country")
        .unwrap_or_default();
    let insurance_provider = patient_row
        .try_get::<Option<String>, _>("insurance_provider")
        .unwrap_or_default();
    if let Some(requested_language) = normalize_document_language(body.language.as_deref())
        && !template.languages.contains(&requested_language)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Language is not supported by the selected template",
        );
    }
    let language = resolve_document_language(
        body.language.as_deref(),
        &patient_languages,
        template.languages,
    );

    let order_number = if let Some(order_uuid) = order_id {
        match sqlx::query_scalar::<_, String>("SELECT order_number FROM orders WHERE id = $1")
            .bind(order_uuid)
            .fetch_optional(&state.db)
            .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, order_id = %order_uuid, "load template order context");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load order context",
                );
            }
        }
    } else {
        None
    };

    let replacement = if let Some(replace_document_id) = body.replace_document_id {
        match load_replacement_document_version(
            &state,
            replace_document_id,
            patient_uuid,
            order_id,
            appointment_id,
            template.id,
            template.art,
            template.category,
            template.id == "framework_contract",
        )
        .await
        {
            Ok(value) => Some(value),
            Err(resp) => return resp,
        }
    } else {
        None
    };

    let requested_block_keys = body.text_block_keys.clone().unwrap_or_default();
    let mut text_blocks = Vec::new();
    for key in requested_block_keys {
        if !template
            .text_block_keys
            .iter()
            .any(|allowed| *allowed == key)
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Template contains an unsupported text block key",
            );
        }
        let Some(block) = document_text_block_by_key(&key) else {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown text block key");
        };
        text_blocks.push(translated_text_block_body(block, language).to_string());
    }

    let generated_at = chrono::Utc::now();
    let generated_document_id = Uuid::new_v4();
    let generated_document_number =
        generated_document_number_for_template(template.id, generated_document_id, generated_at);
    let generated_doc_id = generated_document_number.clone();
    let auto_name = body
        .auto_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            default_generated_document_name(template, &patient_name, generated_at, language)
        });
    let title_override = body
        .title_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let introduction = body
        .introduction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let closing_note = body
        .closing_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let mut bindings = body.bindings.clone().unwrap_or_default();
    if template.id == "privacy_consents"
        && bindings
            .extra_release_recipients
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        let stored_contacts = if let Some(lead_uuid) = lead_id {
            sqlx::query_scalar::<_, Value>("SELECT trusted_contacts FROM leads WHERE id = $1")
                .bind(lead_uuid)
                .fetch_optional(&state.db)
                .await
        } else if let Some(patient_uuid) = patient_id {
            sqlx::query_scalar::<_, Value>(
                "SELECT COALESCE(intake_profile -> 'trusted_contacts', '[]'::jsonb) FROM patients WHERE id = $1",
            )
            .bind(patient_uuid)
            .fetch_optional(&state.db)
            .await
        } else {
            Ok(None)
        };
        match stored_contacts {
            Ok(Some(contacts)) => {
                bindings.extra_release_recipients = trusted_contact_recipients_binding(&contacts);
            }
            Ok(None) => {}
            Err(error) => {
                tracing::error!(error = %error, ?patient_id, ?lead_id, "load trusted contacts for generated document");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load trusted contacts",
                );
            }
        }
    }
    let generated_bindings_snapshot = generated_binding_snapshot(&bindings);
    let manual_text = match normalize_generated_manual_text(body.manual_text.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let patient_party = DocPartyBlock {
        name: patient_name.clone(),
        title: patient_title.clone(),
        salutation: doc_salutation(&patient_gender),
        first_name: patient_row
            .try_get::<String, _>("first_name")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        last_name: patient_row
            .try_get::<String, _>("last_name")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        birth_date,
        street: bindings.party_street.clone().or_else(|| {
            patient_row
                .try_get::<Option<String>, _>("address_street")
                .ok()
                .flatten()
        }),
        zip: bindings.party_zip.clone().or_else(|| {
            patient_row
                .try_get::<Option<String>, _>("address_zip")
                .ok()
                .flatten()
        }),
        city: bindings.party_city.clone().or_else(|| {
            patient_row
                .try_get::<Option<String>, _>("address_city")
                .ok()
                .flatten()
        }),
        country: bindings.party_country.clone().or_else(|| {
            patient_row
                .try_get::<Option<String>, _>("address_country")
                .ok()
                .flatten()
        }),
        email: bindings.party_email.clone().or_else(|| {
            patient_row
                .try_get::<Option<String>, _>("email")
                .ok()
                .flatten()
        }),
        phone: bindings.party_phone.clone().or_else(|| {
            patient_row
                .try_get::<Option<String>, _>("phone_primary")
                .ok()
                .flatten()
        }),
    };

    let template_match_id = if manual_text.is_some() {
        "__manual_generated_text"
    } else {
        template.id
    };
    let (preview_html, pdf_bytes) = match template_match_id {
        "__manual_generated_text" => {
            let manual_text = manual_text
                .as_deref()
                .expect("manual text exists for manual document branch");
            let title = title_override
                .clone()
                .unwrap_or_else(|| template.label.to_string());
            let preview = manual_generated_text_preview_html(&title, manual_text);
            let pdf_bytes = match build_manual_generated_text_pdf(
                &auto_name,
                &title,
                manual_text,
                &generated_doc_id,
            ) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build manual generated document PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "treatment_plan" => {
            let appointment_rows = match sqlx::query(
                r#"SELECT a.id, a.date, a.time_start, a.time_end, a.title, a.location, a.category, a.notes,
                          provider.name AS provider_name,
                          doctor.name AS doctor_name
                   FROM appointments a
                   LEFT JOIN providers provider ON provider.id = a.provider_id
                   LEFT JOIN provider_doctors doctor ON doctor.id = a.doctor_id
                   WHERE a.patient_id = $1
                     AND ($2::uuid IS NULL OR a.order_id = $2)
                     AND ($3::uuid IS NULL OR a.id = $3)
                     AND a.status != 'cancelled'
                   ORDER BY a.date ASC, a.time_start ASC NULLS LAST, a.created_at ASC"#,
            )
            .bind(patient_uuid)
            .bind(order_id)
            .bind(appointment_id)
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::error!(error = %e, patient_id = %patient_uuid, "load template appointments");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to load appointment context",
                    );
                }
            };

            let appointments = appointment_rows
                .into_iter()
                .map(|row| GeneratedAppointmentLine {
                    date: row
                        .try_get::<NaiveDate, _>("date")
                        .unwrap_or_else(|_| chrono::Utc::now().date_naive()),
                    time_start: row
                        .try_get::<Option<NaiveTime>, _>("time_start")
                        .unwrap_or_default(),
                    time_end: row
                        .try_get::<Option<NaiveTime>, _>("time_end")
                        .unwrap_or_default(),
                    title: row.try_get::<String, _>("title").unwrap_or_default(),
                    provider_name: row
                        .try_get::<Option<String>, _>("provider_name")
                        .unwrap_or_default(),
                    doctor_name: row
                        .try_get::<Option<String>, _>("doctor_name")
                        .unwrap_or_default(),
                    location: row
                        .try_get::<Option<String>, _>("location")
                        .unwrap_or_default(),
                    category: row
                        .try_get::<Option<String>, _>("category")
                        .unwrap_or_default(),
                    notes: row
                        .try_get::<Option<String>, _>("notes")
                        .unwrap_or_default(),
                })
                .collect::<Vec<_>>();

            if appointments.is_empty() {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Treatment plan template requires at least one appointment in scope",
                );
            }

            let treatment_plan_note = if let Some(order_uuid) = order_id {
                match sqlx::query_scalar::<_, Option<String>>(
                    r#"SELECT treatment_plan_note
                       FROM order_planning_preparation
                       WHERE order_id = $1"#,
                )
                .bind(order_uuid)
                .fetch_optional(&state.db)
                .await
                {
                    Ok(value) => value.flatten(),
                    Err(e) => {
                        tracing::error!(error = %e, order_id = %order_uuid, "load treatment plan planning note");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to load treatment plan context",
                        );
                    }
                }
            } else {
                None
            };

            let context = GeneratedTreatmentPlanContext {
                patient_pid: patient_pid.clone(),
                patient_name: patient_name.clone(),
                patient_title: patient_title.clone(),
                birth_date,
                order_number,
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override,
                introduction,
                closing_note,
                treatment_plan_note,
                appointments,
                text_blocks,
                generated_at,
            };

            let preview_html = build_treatment_plan_html(&context);
            let pdf_bytes = match build_treatment_plan_pdf(&context, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build generated PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview_html, pdf_bytes)
        }
        "medication_summary" => {
            let case_rows = match sqlx::query(
                r#"SELECT id, case_id, status, hauptanfragegrund
                   FROM cases
                   WHERE patient_id = $1
                   ORDER BY
                     CASE WHEN status IN ('open', 'in_progress') THEN 0 ELSE 1 END,
                     created_at DESC"#,
            )
            .bind(patient_uuid)
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::error!(error = %e, patient_id = %patient_uuid, "load medication template cases");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to load medication case context",
                    );
                }
            };

            let case_scopes = case_rows
                .into_iter()
                .map(|row| MedicationCaseScope {
                    id: row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                    case_id: row.try_get::<String, _>("case_id").unwrap_or_default(),
                    status: row.try_get::<String, _>("status").unwrap_or_default(),
                    reason: row
                        .try_get::<Option<String>, _>("hauptanfragegrund")
                        .unwrap_or_default(),
                })
                .collect::<Vec<_>>();

            if case_scopes.is_empty() {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Medication summary template requires at least one case in scope",
                );
            }

            let active_cases = case_scopes
                .iter()
                .filter(|case_scope| matches!(case_scope.status.as_str(), "open" | "in_progress"))
                .cloned()
                .collect::<Vec<_>>();
            let (relevant_cases, scope_note) = if active_cases.is_empty() {
                (
                    vec![case_scopes[0].clone()],
                    translated_label(language, "medication_scope_latest").to_string(),
                )
            } else {
                (
                    active_cases,
                    translated_label(language, "medication_scope_active").to_string(),
                )
            };
            let relevant_case_ids = relevant_cases
                .iter()
                .map(|case_scope| case_scope.id)
                .collect::<Vec<_>>();
            let relevant_case_map = relevant_cases
                .iter()
                .cloned()
                .map(|case_scope| (case_scope.id, case_scope))
                .collect::<BTreeMap<_, _>>();

            let medication_rows = match sqlx::query(
                r#"SELECT case_id, handelsname, wirkstoff, dosis, dosis_einheit, einnahmeschema,
                          darreichungsform, einheit, anmerkung, grund, seit, verordnender_arzt,
                          expiry_date, med_typ
                   FROM medikamente
                   WHERE case_id = ANY($1::uuid[])
                   ORDER BY sort_order ASC, created_at ASC"#,
            )
            .bind(&relevant_case_ids)
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::error!(error = %e, patient_id = %patient_uuid, "load medication template medications");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to load medication context",
                    );
                }
            };

            let mut medications = medication_rows
                .into_iter()
                .filter_map(|row| {
                    let case_id = row
                        .try_get::<Uuid, _>("case_id")
                        .unwrap_or_else(|_| Uuid::nil());
                    let case_scope = relevant_case_map.get(&case_id)?;
                    Some(GeneratedMedicationLine {
                        trade_name: row.try_get::<String, _>("handelsname").unwrap_or_default(),
                        ingredient: row
                            .try_get::<Option<String>, _>("wirkstoff")
                            .unwrap_or_default(),
                        dose: row
                            .try_get::<Option<String>, _>("dosis")
                            .unwrap_or_default(),
                        dose_unit: row
                            .try_get::<Option<String>, _>("dosis_einheit")
                            .unwrap_or_default(),
                        schedule: row
                            .try_get::<Option<String>, _>("einnahmeschema")
                            .unwrap_or_default(),
                        dosage_form: row
                            .try_get::<Option<String>, _>("darreichungsform")
                            .unwrap_or_default(),
                        unit: row
                            .try_get::<Option<String>, _>("einheit")
                            .unwrap_or_default(),
                        note: row
                            .try_get::<Option<String>, _>("anmerkung")
                            .unwrap_or_default(),
                        reason: row
                            .try_get::<Option<String>, _>("grund")
                            .unwrap_or_default(),
                        since: row.try_get::<Option<String>, _>("seit").unwrap_or_default(),
                        expiry_date: row
                            .try_get::<Option<NaiveDate>, _>("expiry_date")
                            .unwrap_or_default(),
                        prescribing_doctor: row
                            .try_get::<Option<String>, _>("verordnender_arzt")
                            .unwrap_or_default(),
                        medication_type: row
                            .try_get::<String, _>("med_typ")
                            .unwrap_or_else(|_| "permanent".to_string()),
                        source_case_id: case_scope.case_id.clone(),
                        source_case_reason: case_scope.reason.clone(),
                    })
                })
                .collect::<Vec<_>>();

            if medications.is_empty() {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Medication summary template requires recorded medication in scope",
                );
            }

            medications.sort_by(|left, right| {
                medication_type_rank(&left.medication_type)
                    .cmp(&medication_type_rank(&right.medication_type))
                    .then_with(|| {
                        left.trade_name
                            .to_lowercase()
                            .cmp(&right.trade_name.to_lowercase())
                    })
                    .then_with(|| {
                        left.source_case_id
                            .to_lowercase()
                            .cmp(&right.source_case_id.to_lowercase())
                    })
            });

            let context = GeneratedMedicationSummaryContext {
                patient_pid: patient_pid.clone(),
                patient_name: patient_name.clone(),
                patient_title: patient_title.clone(),
                birth_date,
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override,
                introduction,
                closing_note,
                scope_note,
                medications,
                text_blocks,
                generated_at,
            };

            let preview_html = build_medication_summary_html(&context);
            let pdf_bytes = match build_medication_summary_pdf(&context, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build generated PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview_html, pdf_bytes)
        }
        "framework_contract" => {
            let contract_row = if let Some(order_uuid) = order_id {
                match sqlx::query(
                    r#"SELECT fc.contract_number, fc.status, fc.signed_at, fc.valid_from, fc.valid_to, fc.conditions
                       FROM orders o
                       LEFT JOIN framework_contracts fc ON fc.id = o.contract_id
                       WHERE o.id = $1"#,
                )
                .bind(order_uuid)
                .fetch_optional(&state.db)
                .await
                {
                    Ok(Some(row))
                        if row
                            .try_get::<Option<String>, _>("contract_number")
                            .unwrap_or_default()
                            .is_some() =>
                    {
                        Some(row)
                    }
                    Ok(Some(_)) | Ok(None) => match sqlx::query(
                        r#"SELECT contract_number, status, signed_at, valid_from, valid_to, conditions
                           FROM framework_contracts
                           WHERE patient_id = $1
                           ORDER BY created_at DESC
                           LIMIT 1"#,
                    )
                    .bind(patient_uuid)
                    .fetch_optional(&state.db)
                    .await
                    {
                        Ok(row) => row,
                        Err(e) => {
                            tracing::error!(error = %e, patient_id = %patient_uuid, "load fallback framework contract context");
                            return err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to load framework contract context",
                            );
                        }
                    },
                    Err(e) => {
                        tracing::error!(error = %e, order_id = %order_uuid, "load framework contract context from order");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to load framework contract context",
                        );
                    }
                }
            } else {
                match sqlx::query(
                    r#"SELECT contract_number, status, signed_at, valid_from, valid_to, conditions
                       FROM framework_contracts
                       WHERE patient_id = $1
                       ORDER BY created_at DESC, id DESC
                       LIMIT 1"#,
                )
                .bind(patient_uuid)
                .fetch_optional(&state.db)
                .await
                {
                    Ok(row) => row,
                    Err(e) => {
                        tracing::error!(error = %e, patient_id = %patient_uuid, "load framework contract context");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to load framework contract context",
                        );
                    }
                }
            };

            let Some(contract_row) = contract_row else {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Framework contract template requires an existing framework contract in scope",
                );
            };

            let quote_row = if let Some(order_uuid) = order_id {
                match sqlx::query(
                    r#"SELECT quote_number, valid_until, total_net::TEXT AS total_net,
                              total_vat::TEXT AS total_vat, total_gross::TEXT AS total_gross,
                              line_items, notes
                       FROM quotes
                       WHERE order_id = $1
                       ORDER BY created_at DESC, id DESC
                       LIMIT 1"#,
                )
                .bind(order_uuid)
                .fetch_optional(&state.db)
                .await
                {
                    Ok(row) => row,
                    Err(e) => {
                        tracing::error!(error = %e, order_id = %order_uuid, "load framework contract quote context");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to load framework contract quote context",
                        );
                    }
                }
            } else {
                None
            };

            let conditions = contract_row
                .try_get::<Option<Value>, _>("conditions")
                .unwrap_or_default()
                .as_ref()
                .map(parse_contract_conditions)
                .unwrap_or_default();

            let line_items = quote_row
                .as_ref()
                .and_then(|row| row.try_get::<Option<Value>, _>("line_items").ok().flatten())
                .map(|value| parse_quote_line_items(&value))
                .unwrap_or_default();
            let order_metadata = match load_generated_order_metadata(&state, order_id).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };

            let mut agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            apply_bank_overrides(&mut agency, &bindings);
            let agency_sign_place = bindings
                .agency_sign_place
                .clone()
                .or_else(|| Some(agency.sign_place.clone()));
            let contract_valid_from = contract_row
                .try_get::<Option<NaiveDate>, _>("valid_from")
                .unwrap_or_default();

            let context = GeneratedFrameworkContractContext {
                patient_pid: patient_pid.clone(),
                patient_name: patient_name.clone(),
                patient_title: patient_title.clone(),
                birth_date,
                patient_address: patient_party.address_line(),
                patient_email: patient_party.email.clone(),
                patient_phone: patient_party.phone.clone(),
                patient_salutation: patient_party.salutation.clone(),
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override,
                introduction,
                closing_note,
                agency,
                party_sign_place: bindings
                    .party_sign_place
                    .clone()
                    .or_else(|| bindings.sign_place.clone())
                    .or_else(|| patient_party.city.clone()),
                party_sign_date: bindings.party_sign_date.or(bindings.sign_date),
                agency_sign_place,
                agency_sign_date: bindings.agency_sign_date.or(bindings.sign_date),
                effective_date: bindings.contract_date.or(contract_valid_from),
                cost_threshold: bindings.cost_threshold.clone(),
                order_sequence: bindings
                    .order_sequence
                    .unwrap_or(order_metadata.order_sequence),
                extra_release_recipients: bindings.extra_release_recipients.clone(),
                contract_number: contract_row
                    .try_get::<String, _>("contract_number")
                    .unwrap_or_default(),
                contract_status: contract_row
                    .try_get::<String, _>("status")
                    .unwrap_or_default(),
                valid_from: contract_row
                    .try_get::<Option<NaiveDate>, _>("valid_from")
                    .unwrap_or_default(),
                valid_to: contract_row
                    .try_get::<Option<NaiveDate>, _>("valid_to")
                    .unwrap_or_default(),
                signed_at: contract_row
                    .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at")
                    .unwrap_or_default(),
                order_number,
                quote_number: quote_row.as_ref().and_then(|row| {
                    row.try_get::<Option<String>, _>("quote_number")
                        .ok()
                        .flatten()
                }),
                quote_valid_until: quote_row.as_ref().and_then(|row| {
                    row.try_get::<Option<NaiveDate>, _>("valid_until")
                        .ok()
                        .flatten()
                }),
                quote_total_net: quote_row
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<String>, _>("total_net").ok().flatten())
                    .map(|v| fmt_money_de(&v)),
                quote_total_vat: quote_row
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<String>, _>("total_vat").ok().flatten())
                    .map(|v| fmt_money_de(&v)),
                quote_total_gross: quote_row
                    .as_ref()
                    .and_then(|row| {
                        row.try_get::<Option<String>, _>("total_gross")
                            .ok()
                            .flatten()
                    })
                    .map(|v| fmt_money_de(&v)),
                quote_notes: quote_row
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<String>, _>("notes").ok().flatten()),
                conditions,
                line_items,
                text_blocks,
                generated_at,
            };

            let preview_html = build_framework_contract_html(&context);
            let pdf_bytes = match build_framework_contract_pdf(&context, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build generated framework contract PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview_html, pdf_bytes)
        }
        "visa_invitation_letter" => {
            let appointment_context = if let Some(appointment_uuid) = appointment_id {
                match sqlx::query(
                    r#"SELECT a.title, a.date, a.time_start, a.location,
                              provider.name AS provider_name,
                              doctor.name AS doctor_name
                       FROM appointments a
                       LEFT JOIN providers provider ON provider.id = a.provider_id
                       LEFT JOIN provider_doctors doctor ON doctor.id = a.doctor_id
                       WHERE a.id = $1"#,
                )
                .bind(appointment_uuid)
                .fetch_optional(&state.db)
                .await
                {
                    Ok(row) => row,
                    Err(e) => {
                        tracing::error!(error = %e, appointment_id = %appointment_uuid, "load visa invitation appointment context");
                        return err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to load visa invitation context",
                        );
                    }
                }
            } else {
                None
            };
            let mut agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            apply_bank_overrides(&mut agency, &bindings);
            let sign_place = bindings
                .sign_place
                .clone()
                .or_else(|| Some(agency.sign_place.clone()));

            let context = GeneratedVisaInvitationContext {
                patient_pid: patient_pid.clone(),
                patient_name: patient_name.clone(),
                patient_title: patient_title.clone(),
                patient: patient_party.clone(),
                birth_date,
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override,
                introduction,
                closing_note,
                agency,
                nationality,
                residence_country,
                passport_number: bindings.passport_number.clone(),
                passport_valid_until: bindings.passport_valid_until,
                recipient_block: bindings.recipient_block.clone(),
                clinics: bindings.clinics.clone(),
                contact_phones: bindings.contact_phones.clone(),
                sign_place,
                sign_date: bindings
                    .sign_date
                    .or(body.document_date)
                    .or_else(|| Some(generated_at.date_naive())),
                provider_name: appointment_context.as_ref().and_then(|row| {
                    row.try_get::<Option<String>, _>("provider_name")
                        .ok()
                        .flatten()
                }),
                doctor_name: appointment_context.as_ref().and_then(|row| {
                    row.try_get::<Option<String>, _>("doctor_name")
                        .ok()
                        .flatten()
                }),
                appointment_title: appointment_context
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<String>, _>("title").ok().flatten()),
                appointment_date: appointment_context
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<NaiveDate>, _>("date").ok().flatten()),
                appointment_time: appointment_context.as_ref().and_then(|row| {
                    row.try_get::<Option<NaiveTime>, _>("time_start")
                        .ok()
                        .flatten()
                }),
                location: appointment_context
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<String>, _>("location").ok().flatten()),
                order_number,
                generated_at,
            };

            let preview_html = build_visa_invitation_html(&context);
            let pdf_bytes = match build_visa_invitation_pdf(&context, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build generated visa invitation PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview_html, pdf_bytes)
        }
        "patient_sticker_compact" | "patient_sticker_standard" | "patient_sticker_sheet" => {
            let Some(format) = patient_sticker_format_for_template(template.id) else {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Unknown patient sticker format",
                );
            };
            let agency = match load_patient_label_agency_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let Some(sticker_birth_date) = birth_date else {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Patient birth date is required for a patient sticker",
                );
            };
            let context = GeneratedPatientStickerContext {
                patient_pid: patient_pid.clone(),
                patient_title: patient_title.clone(),
                patient_salutation: patient_label_salutation(&patient_gender).to_string(),
                patient_first_name: patient_row
                    .try_get::<String, _>("first_name")
                    .unwrap_or_default(),
                patient_last_name: patient_row
                    .try_get::<String, _>("last_name")
                    .unwrap_or_default(),
                birth_date: sticker_birth_date,
                country_code: patient_label_country_code(
                    nationality.as_deref(),
                    residence_country.as_deref(),
                ),
                insurance_provider,
                kt1: bindings.kt1.clone(),
                kt2: bindings.kt2.clone(),
                cost_code: bindings.cost_code.clone(),
                agency,
                format,
                auto_name: auto_name.clone(),
                language: language.to_string(),
                generated_at,
            };

            let preview_html = build_patient_sticker_html(&context);
            let pdf_bytes = match build_patient_sticker_pdf(&context) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build generated patient sticker PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview_html, pdf_bytes)
        }
        "single_order" | "order_cost_estimate" => {
            let is_order_cost_estimate = template.id == "order_cost_estimate";
            let mut agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            apply_bank_overrides(&mut agency, &bindings);
            let agency_sign_place = bindings
                .agency_sign_place
                .clone()
                .or_else(|| Some(agency.sign_place.clone()));
            let order_metadata = match load_generated_order_metadata(&state, order_id).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let appointment_scope = match load_generated_appointment_scope(
                &state,
                patient_uuid,
                order_id,
                appointment_id,
            )
            .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let invoice_payer = match load_invoice_payer(&state, order_id, patient_uuid).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let payer = merge_payer(payer_block_from_bindings(&bindings), invoice_payer);
            let quote = if let Some(order_uuid) = order_id {
                match load_order_quote_summary(&state, order_uuid).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            } else {
                None
            };
            let uses_quote_lines = bindings.service_lines.is_empty();
            let line_items = if uses_quote_lines {
                quote
                    .as_ref()
                    .map(|value| value.line_items.clone())
                    .unwrap_or_default()
            } else {
                service_lines_to_items(&bindings.service_lines)
            };
            let manual_totals = if uses_quote_lines {
                None
            } else {
                compute_line_item_totals(&line_items)
            };
            let quote_number = quote
                .as_ref()
                .and_then(|value| value.quote_number.clone())
                .filter(|value| !value.trim().is_empty())
                .or_else(|| {
                    bindings
                        .quote_number
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                });
            let payer = if payer.name.trim().is_empty() {
                None
            } else {
                Some(payer)
            };
            let resolved_order_number = order_number
                .clone()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| {
                    bindings
                        .order_number
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                })
                .unwrap_or_default();
            let order_sequence = bindings
                .order_sequence
                .unwrap_or(order_metadata.order_sequence);
            let quote_annex_reference = quote_number.as_ref().map(|number| {
                format!(
                    "Anlage 1 zum {order_sequence}. Einzelauftrag: Kostenvoranschlag Nr.: {number} (separates Dokument)"
                )
            });
            let configured_order_components = bindings
                .order_components
                .clone()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let order_components = match (configured_order_components, quote_annex_reference) {
                (Some(configured), Some(reference))
                    if !configured.to_ascii_lowercase().contains("anlage 1") =>
                {
                    Some(format!("{configured}\n{reference}"))
                }
                (Some(configured), _) => Some(configured),
                (None, reference) => reference,
            };
            let context = GeneratedSingleOrderContext {
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override: title_override.clone(),
                patient_pid: patient_pid.clone(),
                party: patient_party.clone(),
                agency,
                order_number: resolved_order_number,
                contract_number: order_metadata.contract_number.clone(),
                order_sequence,
                order_date: bindings.order_date.or(order_metadata.order_date),
                contract_date: bindings.contract_date.or(order_metadata.contract_date),
                specialties: bindings
                    .specialties
                    .clone()
                    .or(appointment_scope.specialties),
                examination_purpose: bindings.examination_purpose.clone(),
                treatment_purpose: bindings.treatment_purpose.clone(),
                order_components,
                period_from: bindings.period_from.or(appointment_scope.first_date),
                period_to: bindings.period_to.or(appointment_scope.last_date),
                payer,
                quote_number,
                line_items,
                total_net: if uses_quote_lines {
                    quote.as_ref().and_then(|value| value.total_net.clone())
                } else {
                    manual_totals.as_ref().map(|totals| totals.0.clone())
                },
                total_vat: if uses_quote_lines {
                    quote.as_ref().and_then(|value| value.total_vat.clone())
                } else {
                    manual_totals.as_ref().map(|totals| totals.1.clone())
                },
                total_gross: if uses_quote_lines {
                    quote.as_ref().and_then(|value| value.total_gross.clone())
                } else {
                    manual_totals.as_ref().map(|totals| totals.2.clone())
                },
                party_sign_place: bindings
                    .party_sign_place
                    .clone()
                    .or_else(|| bindings.sign_place.clone())
                    .or_else(|| patient_party.city.clone()),
                party_sign_date: bindings.party_sign_date.or(bindings.sign_date),
                agency_sign_place,
                agency_sign_date: bindings.agency_sign_date.or(bindings.sign_date),
                generated_at,
            };
            let preview = admin_preview_html(
                &context.title_override.clone().unwrap_or_else(|| {
                    admin_doc_label(
                        &context.language,
                        if is_order_cost_estimate {
                            "order_cost_estimate_title"
                        } else {
                            "single_order_title"
                        },
                    )
                    .to_string()
                }),
                &party_block_lines(&context.party),
            );
            let pdf_result = if is_order_cost_estimate {
                build_order_cost_estimate_pdf(&context, &generated_doc_id)
            } else {
                build_single_order_pdf(&context, &generated_doc_id)
            };
            let pdf_bytes = match pdf_result {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build order document PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "cost_coverage_declaration" => {
            let mut agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            apply_bank_overrides(&mut agency, &bindings);
            let agency_sign_place = bindings
                .agency_sign_place
                .clone()
                .or_else(|| Some(agency.sign_place.clone()));
            let order_metadata = match load_generated_order_metadata(&state, order_id).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let invoice_payer = match load_invoice_payer(&state, order_id, patient_uuid).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let payer = merge_payer(payer_block_from_bindings(&bindings), invoice_payer);
            let payer_sign_place = bindings
                .payer_sign_place
                .clone()
                .or_else(|| bindings.sign_place.clone())
                .or_else(|| payer.city.clone());

            let quote = if let Some(order_uuid) = order_id {
                match load_order_quote_summary(&state, order_uuid).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            } else {
                None
            };
            let uses_quote_lines = bindings.service_lines.is_empty();
            let line_items = if uses_quote_lines {
                quote
                    .as_ref()
                    .map(|q| q.line_items.clone())
                    .unwrap_or_default()
            } else {
                service_lines_to_items(&bindings.service_lines)
            };
            // Manual rows form a self-contained calculation and must never be
            // paired with totals from a different stored quote.
            let manual_totals = if uses_quote_lines {
                None
            } else {
                compute_line_item_totals(&line_items)
            };
            let resolved_order_number = order_number
                .clone()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| {
                    bindings
                        .order_number
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                })
                .unwrap_or_default();
            let context = GeneratedCostCoverageContext {
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override: title_override.clone(),
                patient: patient_party.clone(),
                payer,
                agency,
                order_number: resolved_order_number,
                order_sequence: bindings
                    .order_sequence
                    .unwrap_or(order_metadata.order_sequence),
                order_date: bindings.order_date.or(order_metadata.order_date),
                contract_date: bindings.contract_date.or(order_metadata.contract_date),
                quote_number: quote
                    .as_ref()
                    .and_then(|value| value.quote_number.clone())
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| {
                        bindings
                            .quote_number
                            .clone()
                            .filter(|value| !value.trim().is_empty())
                    }),
                line_items,
                total_net: if uses_quote_lines {
                    quote.as_ref().and_then(|q| q.total_net.clone())
                } else {
                    manual_totals.as_ref().map(|t| t.0.clone())
                },
                total_vat: if uses_quote_lines {
                    quote.as_ref().and_then(|q| q.total_vat.clone())
                } else {
                    manual_totals.as_ref().map(|t| t.1.clone())
                },
                total_gross: if uses_quote_lines {
                    quote.as_ref().and_then(|q| q.total_gross.clone())
                } else {
                    manual_totals.as_ref().map(|t| t.2.clone())
                },
                payer_sign_place,
                payer_sign_date: bindings.payer_sign_date.or(bindings.sign_date),
                agency_sign_place,
                agency_sign_date: bindings.agency_sign_date.or(bindings.sign_date),
                generated_at,
            };
            let preview = admin_preview_html(
                &context.title_override.clone().unwrap_or_else(|| {
                    admin_doc_label(&context.language, "cost_coverage_title").to_string()
                }),
                &cost_coverage_summary_lines(&context),
            );
            let pdf_bytes = match build_cost_coverage_pdf(&context, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build cost coverage PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "cost_estimate" => {
            let cost_estimate_agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let quote = if let Some(order_uuid) = order_id {
                match load_order_quote_summary(&state, order_uuid).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            } else {
                None
            };
            let uses_quote_lines = bindings.service_lines.is_empty();
            let line_items = if uses_quote_lines {
                quote
                    .as_ref()
                    .map(|q| q.line_items.clone())
                    .unwrap_or_default()
            } else {
                service_lines_to_items(&bindings.service_lines)
            };
            let total_range = if uses_quote_lines {
                bindings
                    .estimate_total
                    .clone()
                    .or_else(|| quote.as_ref().and_then(|q| q.total_gross.clone()))
            } else {
                bindings.estimate_total.clone()
            };
            let context = GeneratedCostEstimateContext {
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override: title_override.clone(),
                patient: patient_party.clone(),
                patient_pid: patient_pid.clone(),
                quote_number: quote
                    .as_ref()
                    .and_then(|value| value.quote_number.clone())
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| {
                        bindings
                            .quote_number
                            .clone()
                            .filter(|value| !value.trim().is_empty())
                    }),
                estimate_date: bindings
                    .sign_date
                    .or(bindings.order_date)
                    .or(body.document_date)
                    .or_else(|| Some(generated_at.date_naive())),
                line_items,
                total_range,
                agency: cost_estimate_agency,
                generated_at,
            };
            let preview = admin_preview_html(
                admin_doc_label(&context.language, "cost_estimate_title"),
                &cost_estimate_summary_lines(&context),
            );
            let pdf_bytes = match build_cost_estimate_pdf(&context, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build cost estimate PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "appointment_confirmation" => {
            let mut agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            apply_bank_overrides(&mut agency, &bindings);
            let sign_place = bindings
                .sign_place
                .clone()
                .or_else(|| Some(agency.sign_place.clone()));
            let appointment_scope = match load_generated_appointment_scope(
                &state,
                patient_uuid,
                order_id,
                appointment_id,
            )
            .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let context = GeneratedAppointmentConfirmationContext {
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override: title_override.clone(),
                doc_id: bindings
                    .doc_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .or_else(|| Some(generated_doc_id.clone())),
                patient: patient_party.clone(),
                passport_number: bindings.passport_number.clone(),
                passport_valid_until: bindings.passport_valid_until,
                recipient_block: bindings.recipient_block.clone(),
                clinics: if bindings.clinics.is_empty() {
                    appointment_scope.clinics
                } else {
                    bindings.clinics.clone()
                },
                first_examination: bindings.period_from.or(appointment_scope.first_date),
                examination_weeks: bindings
                    .examination_weeks
                    .clone()
                    .or(appointment_scope.examination_weeks),
                continuation_statement: bindings.continuation_statement.clone(),
                contact_phones: bindings.contact_phones.clone(),
                agency,
                sign_place,
                sign_date: bindings
                    .sign_date
                    .or(body.document_date)
                    .or_else(|| Some(generated_at.date_naive())),
                generated_at,
            };
            let preview = admin_preview_html(
                admin_doc_label(&context.language, "appointment_confirmation_title"),
                &party_block_lines(&context.patient),
            );
            let pdf_bytes = match build_appointment_confirmation_pdf(&context, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build appointment confirmation PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "confidentiality_release" => {
            let agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let preview = admin_preview_html(
                "Schweigepflichtsentbindung",
                &[patient_party.name.clone(), generated_doc_id.clone()],
            );
            let pdf_bytes = match build_adult_confidentiality_release_pdf(
                &patient_party,
                &agency,
                &bindings,
                &generated_doc_id,
            ) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(
                        template_id = template.id,
                        ?patient_id,
                        ?lead_id,
                        "build confidentiality release PDF"
                    );
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "privacy_consents" => {
            let agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let preview = admin_preview_html(
                "Einverständniserklärung zur Datenübermittlung",
                &[patient_party.name.clone(), generated_doc_id.clone()],
            );
            let pdf_bytes = match build_adult_privacy_consents_pdf(
                &patient_party,
                &agency,
                &bindings,
                &generated_doc_id,
            ) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(
                        template_id = template.id,
                        ?patient_id,
                        ?lead_id,
                        "build privacy consents PDF"
                    );
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "privacy_information" => {
            let agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let preview = admin_preview_html(
                "Informationsblatt zum Datenschutz",
                std::slice::from_ref(&generated_doc_id),
            );
            let pdf_bytes = match build_adult_privacy_information_pdf(&agency, &generated_doc_id) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(
                        template_id = template.id,
                        ?patient_id,
                        ?lead_id,
                        "build privacy information PDF"
                    );
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        "consent_data_release_child" | "consent_data_release_single" => {
            let sole_guardian = template.id == "consent_data_release_single";
            let guardian_relations = sqlx::query(
                r#"SELECT pr.related_name, rp.birth_date
                   FROM patient_relations pr
                   LEFT JOIN patients rp ON rp.id = pr.related_patient_id
                   WHERE pr.patient_id = $1
                     AND pr.relation_type IN ('parent', 'guardian')
                   ORDER BY pr.created_at"#,
            )
            .bind(patient_uuid)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            let guardian_at = |idx: usize| -> (Option<String>, Option<NaiveDate>) {
                match guardian_relations.get(idx) {
                    Some(row) => (
                        row.try_get::<String, _>("related_name")
                            .ok()
                            .map(|name| name.trim().to_string())
                            .filter(|name| !name.is_empty()),
                        row.try_get::<Option<NaiveDate>, _>("birth_date")
                            .ok()
                            .flatten(),
                    ),
                    None => (None, None),
                }
            };
            let (guardian1_name, guardian1_birth) = guardian_at(0);
            let (guardian2_name_derived, guardian2_birth_derived) = guardian_at(1);
            let agency = match load_agency_contract_settings(&state).await {
                Ok(value) => value,
                Err(resp) => return resp,
            };
            let context = GeneratedConsentContext {
                sole_guardian,
                auto_name: auto_name.clone(),
                document_reference: generated_doc_id.clone(),
                child_name: bindings.child_name.clone().or_else(|| {
                    if patient_name.is_empty() {
                        None
                    } else {
                        Some(patient_name.clone())
                    }
                }),
                child_birth_date: bindings.child_birth_date.or(birth_date),
                child_address: bindings
                    .child_address
                    .clone()
                    .or_else(|| patient_party.address_line()),
                guardian_name: bindings.guardian_name.clone().or(guardian1_name),
                guardian_label: bindings.guardian_label.clone(),
                guardian_birth_date: bindings.guardian_birth_date.or(guardian1_birth),
                guardian_address: bindings.guardian_address.clone(),
                guardian2_name: bindings.guardian2_name.clone().or(guardian2_name_derived),
                guardian2_label: bindings.guardian2_label.clone(),
                guardian2_birth_date: bindings.guardian2_birth_date.or(guardian2_birth_derived),
                extra_release_recipients: bindings.extra_release_recipients.clone(),
                agency,
                generated_at,
            };
            let preview = admin_preview_html(
                admin_doc_label("de", "consent_title"),
                &[context
                    .child_name
                    .clone()
                    .map(|name| format!("Kind: {name}"))
                    .unwrap_or_default()],
            );
            let pdf_bytes = match build_consent_pdf(&context) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build consent PDF");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, message);
                }
            };
            (preview, pdf_bytes)
        }
        _ => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Unknown document template",
            );
        }
    };
    let original_filename = format!(
        "{}.{}",
        sanitize_filename(&auto_name.replace([' ', '/', '\\'], "_")),
        template.file_extension
    );
    let ursprung = body
        .ursprung
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("template:{}", template.id));
    let metadata = match normalize_generate_document_metadata(&body) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let uses_business_document_number = matches!(
        template.id,
        "framework_contract" | "single_order" | "order_cost_estimate" | "cost_estimate"
    );
    let persist_input = NewStoredDocument {
        document_id: Some(generated_document_id),
        document_number: (!uses_business_document_number)
            .then_some(generated_document_number.as_str()),
        patient_id,
        lead_id,
        order_id,
        appointment_id,
        auto_name: &auto_name,
        original_filename: &original_filename,
        art: template.art,
        category: Some(template.category),
        status,
        visibility,
        is_medical: template.is_medical,
        mime_type: template.mime_type,
        klinik: body
            .klinik
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        ursprung: Some(ursprung.as_str()),
        notes: body
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        document_direction: metadata.document_direction.as_deref().or(Some(
            infer_document_direction(Some(template.id), Some(ursprung.as_str())),
        )),
        document_variant: metadata.document_variant.as_deref().or(Some("original")),
        document_language: metadata.document_language.as_deref().or(Some(language)),
        access_category: metadata.access_category.as_deref().or(Some(
            infer_document_access_category(
                Some(template.category),
                template.art,
                template.is_medical,
                visibility,
            ),
        )),
        document_date: metadata
            .document_date
            .or_else(|| Some(chrono::Utc::now().date_naive())),
        source_person: metadata.source_person.as_deref(),
        source_institution: metadata.source_institution.as_deref().or(body
            .klinik
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())),
        addressee_person: metadata
            .addressee_person
            .as_deref()
            .or(Some(patient_name.as_str())),
        addressee_institution: metadata.addressee_institution.as_deref(),
        financial_status: metadata.financial_status.as_deref(),
        payment_due_date: metadata.payment_due_date,
        payment_date: metadata.payment_date,
        payment_method: metadata.payment_method.as_deref(),
        generated_template_id: Some(template.id),
        generated_bindings: generated_bindings_snapshot.as_ref(),
        generated_manual_text: manual_text.as_deref(),
        version_root_document_id: replacement
            .as_ref()
            .map(|value| value.version_root_document_id),
        replaces_document_id: replacement.as_ref().map(|value| value.document_id),
        version_number: replacement
            .as_ref()
            .map(|value| value.version_number + 1)
            .unwrap_or(1),
        uploaded_by: auth.user_id,
    };

    let (document_id, file_size, original_filename, storage_key) =
        match persist_document_file(&state, &pdf_bytes, &persist_input).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let stored_document_number = match sqlx::query_scalar::<_, String>(
        "SELECT document_number FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error, document_id = %document_id, "load generated document number");
            generated_document_number.clone()
        }
    };
    best_effort_extract_document_text_and_store(
        &state,
        document_id,
        Some(original_filename.as_str()),
        Some(template.mime_type),
        storage_key.as_str(),
        auth.user_id,
    )
    .await;

    if let Some(replaced) = replacement.as_ref() {
        if let Err(e) = sqlx::query(
            r#"UPDATE documents
               SET status = 'archived'
               WHERE id = $1"#,
        )
        .bind(replaced.document_id)
        .execute(&state.db)
        .await
        {
            tracing::error!(error = %e, replaced_document_id = %replaced.document_id, "archive replaced document");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to archive replaced document",
            );
        }

        if let Err(e) = sqlx::query(
            r#"UPDATE document_shares
               SET revoked_at = now()
               WHERE document_id = $1
                 AND channel = 'patient_portal'
                 AND revoked_at IS NULL"#,
        )
        .bind(replaced.document_id)
        .execute(&state.db)
        .await
        {
            tracing::error!(error = %e, replaced_document_id = %replaced.document_id, "revoke superseded portal releases");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to finalize replaced document version",
            );
        }
    }

    state.audit_sender.try_send(audit::domain_event(
        "generate_document_from_template",
        Some(auth.user_id),
        "document",
        Some(document_id),
        json!({
            "template_id": template.id,
            "patient_id": patient_uuid,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": language,
            "replace_document_id": replacement.as_ref().map(|value| value.document_id),
            "version_number": persist_input.version_number,
        }),
    ));

    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        "document.generated",
        document_id,
        json!({
            "template_id": template.id,
            "patient_id": patient_uuid,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": language,
            "replace_document_id": replacement.as_ref().map(|value| value.document_id),
            "version_number": persist_input.version_number,
        }),
    )
    .await;

    Json(json!({
        "ok": true,
        "id": document_id,
        "document_number": stored_document_number,
        "auto_name": auto_name,
        "original_filename": original_filename,
        "mime_type": template.mime_type,
        "file_size": file_size,
        "language": language,
        "generated_template_id": template.id,
        "version_number": persist_input.version_number,
        "version_root_document_id": replacement
            .as_ref()
            .map(|value| value.version_root_document_id)
            .unwrap_or(document_id),
        "replaces_document_id": replacement.as_ref().map(|value| value.document_id),
        "preview_html": preview_html,
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// Generated agency/legal documents (single order, cost coverage, cost estimate,
// appointment confirmation, data-release consent). These reuse the shared A4
// PDF layout (`TreatmentPlanPdfLayout`) and bundled Arial fonts.
// ---------------------------------------------------------------------------

fn fmt_de_date(date: Option<NaiveDate>) -> String {
    date.map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "____________".to_string())
}

fn admin_doc_label(language: &str, key: &str) -> &'static str {
    match (language, key) {
        ("uk", "single_order_title") => "Окреме замовлення",
        ("uk", "order_cost_estimate_title") => "Кошторис до окремого замовлення",
        ("uk", "cost_coverage_title") => "Декларація про прийняття витрат",
        ("uk", "cost_estimate_title") => "Орієнтовний кошторис витрат",
        ("uk", "appointment_confirmation_title") => "Підтвердження запису",
        ("uk", "consent_title") => "Згода на передачу даних та звільнення від таємниці",
        ("en", "single_order_title") => "Single order",
        ("en", "order_cost_estimate_title") => "Cost estimate for single order",
        ("en", "cost_coverage_title") => "Cost coverage declaration",
        ("en", "cost_estimate_title") => "Non-binding cost estimate",
        ("en", "appointment_confirmation_title") => "Appointment confirmation",
        ("en", "consent_title") => "Data transfer and confidentiality release",
        (_, "single_order_title") => "Einzelauftrag",
        (_, "order_cost_estimate_title") => "Kostenvoranschlag zum Einzelauftrag",
        (_, "cost_coverage_title") => "Kostenübernahmeerklärung",
        (_, "cost_estimate_title") => cost_estimate_default_title(),
        (_, "appointment_confirmation_title") => "Terminbestätigung",
        (_, "consent_title") => {
            "Einverständniserklärung zur Datenübermittlung und Schweigepflichtsentbindung"
        }
        _ => "",
    }
}

async fn load_agency_contract_settings(
    state: &AppState,
) -> Result<AgencyContractSettings, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT key, value #>> '{}' AS value_text
           FROM system_settings
           WHERE key IN (
               'agency_name', 'agency_care_of', 'agency_address', 'agency_phone', 'agency_email',
               'agency_website',
               'agency_principal_birth_date', 'agency_privacy_email',
               'agency_sign_place', 'agency_data_system_name',
               'agency_data_controller_statement', 'agency_data_processor_notice',
               'agency_bank_holder', 'agency_bank_name', 'agency_bank_swift', 'agency_bank_iban'
           )"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "load agency contract settings");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load agency settings",
        )
    })?;

    let mut values: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for row in rows {
        let key: String = row.try_get("key").unwrap_or_default();
        let value: Option<String> = row.try_get("value_text").unwrap_or_default();
        if let Some(value) = value {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                values.insert(key, trimmed);
            }
        }
    }

    let required_value = |key: &'static str| {
        values.get(key).cloned().ok_or_else(|| {
            tracing::error!(
                setting_key = key,
                "required agency document setting is missing"
            );
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Agency document profile is incomplete",
            )
        })
    };
    let name = required_value("agency_name")?;
    let responsible_person = required_value("agency_care_of")?;
    let sign_place = required_value("agency_sign_place")?;
    let data_system_name = required_value("agency_data_system_name")?;
    let data_controller_statement = required_value("agency_data_controller_statement")?;
    Ok(AgencyContractSettings {
        name,
        care_of: Some(responsible_person),
        principal_birth_date: values
            .get("agency_principal_birth_date")
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()),
        address: values.get("agency_address").cloned(),
        phone: values.get("agency_phone").cloned(),
        email: values.get("agency_email").cloned(),
        website: values.get("agency_website").cloned(),
        privacy_email: values
            .get("agency_privacy_email")
            .cloned()
            .or_else(|| values.get("agency_email").cloned()),
        sign_place,
        data_system_name,
        data_controller_statement,
        data_processor_notice: values.get("agency_data_processor_notice").cloned(),
        bank_holder: values.get("agency_bank_holder").cloned(),
        bank_name: values.get("agency_bank_name").cloned(),
        bank_swift: values.get("agency_bank_swift").cloned(),
        bank_iban: values.get("agency_bank_iban").cloned(),
    })
}

fn party_block_lines(party: &DocPartyBlock) -> Vec<String> {
    let mut lines = vec![party.name_with_title()];
    if let Some(birth) = party.birth_date {
        lines.push(format!("geb. am {}", birth.format("%d.%m.%Y")));
    }
    if let Some(address) = party.address_line() {
        lines.push(address);
    }
    if let Some(email) = party
        .email
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Email: {email}"));
    }
    if let Some(phone) = party
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Tel.: {phone}"));
    }
    lines
}

fn agency_block_lines(agency: &AgencyContractSettings) -> Vec<String> {
    let mut lines = agency_identity_profile_lines(agency);
    if let Some(address) = agency
        .address
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(address.to_string());
    }
    if let Some(email) = agency
        .email
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Email: {email}"));
    }
    if let Some(phone) = agency
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Tel.: {phone}"));
    }
    lines
}

fn legal_agency_block_lines(agency: &AgencyContractSettings) -> Vec<String> {
    let mut lines = agency_identity_profile_lines(agency);
    if let Some(address) = agency
        .address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(address.to_string());
    }
    if let Some(email) = agency
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Email: {email}"));
    }
    if let Some(phone) = agency
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Tel.: {phone}"));
    }
    lines
}

fn admin_preview_html(title: &str, lines: &[String]) -> String {
    let body = lines
        .iter()
        .map(|line| format!("<p>{}</p>", escape_html(line)))
        .collect::<String>();
    format!(
        "<section class=\"generated-document\"><h2>{}</h2>{}</section>",
        escape_html(title),
        body
    )
}

fn normalize_generated_manual_text(
    value: Option<&str>,
) -> Result<Option<String>, axum::response::Response> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > MAX_GENERATED_MANUAL_TEXT_LEN {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Generated document text is too long",
        ));
    }
    Ok(Some(value.to_string()))
}

fn compact_generated_binding_value(value: Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::String(value) if value.trim().is_empty() => None,
        Value::Array(values) => {
            let values = values
                .into_iter()
                .filter_map(compact_generated_binding_value)
                .collect::<Vec<_>>();
            (!values.is_empty()).then_some(Value::Array(values))
        }
        Value::Object(values) => {
            let values = values
                .into_iter()
                .filter_map(|(key, value)| {
                    compact_generated_binding_value(value).map(|value| (key, value))
                })
                .collect::<serde_json::Map<_, _>>();
            (!values.is_empty()).then_some(Value::Object(values))
        }
        value => Some(value),
    }
}

fn generated_binding_snapshot(bindings: &DocumentBindingOverrides) -> Option<Value> {
    serde_json::to_value(bindings)
        .ok()
        .and_then(compact_generated_binding_value)
}

fn trusted_contact_recipients_binding(contacts: &Value) -> Option<String> {
    let lines = contacts
        .as_array()?
        .iter()
        .filter_map(|contact| {
            let contact = contact.as_object()?;
            let value = |key: &str| {
                contact
                    .get(key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            };
            let name = value("name")?;
            let mut parts = vec![name.to_string()];
            if let Some(birth_date) = value("birth_date") {
                let formatted = NaiveDate::parse_from_str(birth_date, "%Y-%m-%d")
                    .ok()
                    .map(|date| fmt_de_date(Some(date)))
                    .unwrap_or_else(|| birth_date.to_string());
                parts.push(format!("geb. am {formatted}"));
            }
            if let Some(address) = value("address") {
                parts.push(format!("Adresse: {address}"));
            }
            if let Some(email) = value("email") {
                parts.push(format!("E-Mail: {email}"));
            }
            if let Some(phone) = value("phone") {
                parts.push(format!("Tel.: {phone}"));
            }
            Some(parts.join(", "))
        })
        .collect::<Vec<_>>();

    (!lines.is_empty()).then(|| lines.join("\n"))
}

fn generated_manual_text_paragraphs(value: &str) -> Vec<String> {
    value
        .lines()
        .map(str::trim_end)
        .map(ToOwned::to_owned)
        .collect()
}

fn manual_generated_text_preview_html(title: &str, text: &str) -> String {
    let body = generated_manual_text_paragraphs(text)
        .into_iter()
        .map(|line| {
            if line.trim().is_empty() {
                "<p>&nbsp;</p>".to_string()
            } else {
                format!("<p>{}</p>", escape_html(line.trim()))
            }
        })
        .collect::<String>();
    format!(
        "<section class=\"generated-document\"><h2>{}</h2>{}</section>",
        escape_html(title),
        body
    )
}

fn new_admin_pdf() -> Result<(PdfDocument, PdfFontHandle, PdfFontHandle), &'static str> {
    let document = PdfDocument::new("Generated document");
    let (regular, bold) = pdf_text_font_handles();
    Ok((document, regular, bold))
}

fn finalize_admin_pdf(mut document: PdfDocument, layout: TreatmentPlanPdfLayout) -> Vec<u8> {
    let pages = layout.finish();
    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    let save_options = pdf_text_save_options();
    document
        .with_pages(pages)
        .save(&save_options, &mut save_warnings)
}

fn admin_block(layout: &mut TreatmentPlanPdfLayout, text: &str, before: f32, after: f32) {
    layout.text_block_justified(
        text,
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Body,
        before,
        after,
    );
}

fn admin_heading(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block(text, 13.0, true, 0.0, TreatmentPlanPdfColor::Body, 3.0, 2.0);
}

fn legal_meta_grid(layout: &mut TreatmentPlanPdfLayout, cells: &[(&str, String)]) {
    if cells.is_empty() {
        return;
    }

    const COLUMN_GAP_MM: f32 = 10.0;
    const CARD_PADDING_X_MM: f32 = 5.0;
    const CARD_PADDING_Y_MM: f32 = 4.0;
    const ROW_HEIGHT_MM: f32 = 8.5;

    // The title helper already leaves 3 mm below the subtitle. Together these
    // 4 mm reproduce the 7 mm title-to-metadata gap from the approved mockup.
    layout.spacer(4.0);
    let row_count = (cells.len() + 1) / 2;
    let card_height_mm = CARD_PADDING_Y_MM * 2.0 + row_count as f32 * ROW_HEIGHT_MM;
    layout.ensure_space(card_height_mm);

    let card_top_mm = layout.y_mm;
    let card_bottom_mm = card_top_mm - card_height_mm;
    let background = Color::Rgb(Rgb::new(0.98, 0.976, 0.973, None));
    let border = Color::Rgb(Rgb::new(0.91, 0.90, 0.89, None));
    append_pdf_filled_rect(
        &mut layout.page_ops,
        PDF_LEFT_MARGIN_MM,
        card_bottom_mm,
        PDF_CONTENT_WIDTH_MM,
        card_height_mm,
        background,
    );
    for (x, y, width, height) in [
        (
            PDF_LEFT_MARGIN_MM,
            card_top_mm - 0.2,
            PDF_CONTENT_WIDTH_MM,
            0.2,
        ),
        (
            PDF_LEFT_MARGIN_MM,
            card_bottom_mm,
            PDF_CONTENT_WIDTH_MM,
            0.2,
        ),
        (PDF_LEFT_MARGIN_MM, card_bottom_mm, 0.2, card_height_mm),
        (
            PDF_LEFT_MARGIN_MM + PDF_CONTENT_WIDTH_MM - 0.2,
            card_bottom_mm,
            0.2,
            card_height_mm,
        ),
    ] {
        append_pdf_filled_rect(&mut layout.page_ops, x, y, width, height, border.clone());
    }

    let column_width_mm = (PDF_CONTENT_WIDTH_MM - COLUMN_GAP_MM) / 2.0;
    let regular_font = layout.regular_font.clone();
    let bold_font = layout.bold_font.clone();
    for (index, (label, value)) in cells.iter().enumerate() {
        let row = index / 2;
        let column = index % 2;
        let column_left_mm = PDF_LEFT_MARGIN_MM + column as f32 * (column_width_mm + COLUMN_GAP_MM);
        let text_x_mm = column_left_mm + CARD_PADDING_X_MM;
        let column_right_mm = column_left_mm + column_width_mm - CARD_PADDING_X_MM;
        let baseline_y_mm = card_top_mm - CARD_PADDING_Y_MM - 3.2 - row as f32 * ROW_HEIGHT_MM;
        let value = truncate_text_to_width(value, 9.5, column_width_mm * 0.58);
        let value_width_mm = approx_text_width_mm(&value, 9.5);
        let value_x_mm = (column_right_mm - value_width_mm).max(text_x_mm + 24.0);
        let label = truncate_text_to_width(label, 7.0, (value_x_mm - text_x_mm - 3.0).max(15.0));

        append_pdf_text_line(
            &mut layout.page_ops,
            &label,
            text_x_mm,
            baseline_y_mm,
            7.0,
            &regular_font,
            TreatmentPlanPdfColor::Muted,
        );
        append_pdf_text_line(
            &mut layout.page_ops,
            &value,
            value_x_mm,
            baseline_y_mm,
            9.5,
            &bold_font,
            TreatmentPlanPdfColor::Body,
        );
    }

    layout.y_mm = card_bottom_mm;
    layout.spacer(6.0);
}

fn build_manual_generated_text_pdf(
    auto_name: &str,
    title: &str,
    text: &str,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let footer = auto_name.trim();
    let footer = if footer.is_empty() {
        "Generated document"
    } else {
        footer
    };
    let mut layout = TreatmentPlanPdfLayout::new(footer.to_string(), regular, bold);
    layout.set_document_reference(document_reference);
    layout.text_block_centered(title, 13.0, true, TreatmentPlanPdfColor::Body, 3.0, 2.0);
    for line in generated_manual_text_paragraphs(text) {
        if line.trim().is_empty() {
            layout.spacer(3.0);
        } else {
            admin_block(&mut layout, line.trim(), 0.0, 1.0);
        }
    }
    Ok(finalize_admin_pdf(document, layout))
}

struct AdminSignatureParty<'a> {
    place: Option<&'a str>,
    date: Option<NaiveDate>,
    name: &'a str,
    role: &'a str,
}

fn admin_signature_grid(
    layout: &mut TreatmentPlanPdfLayout,
    left: AdminSignatureParty<'_>,
    right: AdminSignatureParty<'_>,
) {
    const COLUMN_GAP_MM: f32 = 14.0;
    const BLOCK_HEIGHT_MM: f32 = 27.0;
    const SIGNATURE_LINE_OFFSET_MM: f32 = 12.0;

    if layout.page_style == PdfPageStyle::Legal {
        let anchored_top_mm = PDF_LEGAL_CONTENT_BOTTOM_MM + BLOCK_HEIGHT_MM;
        if layout.y_mm < anchored_top_mm + 12.0 {
            layout.page_break();
        }
        layout.y_mm = anchored_top_mm;
    } else {
        layout.ensure_space(BLOCK_HEIGHT_MM);
    }

    let top_y_mm = layout.y_mm;
    let column_width_mm = (PDF_CONTENT_WIDTH_MM - COLUMN_GAP_MM) / 2.0;
    let right_x_mm = PDF_LEFT_MARGIN_MM + column_width_mm + COLUMN_GAP_MM;
    let regular_font = layout.regular_font.clone();
    let bold_font = layout.bold_font.clone();

    for (party, x_mm) in [(left, PDF_LEFT_MARGIN_MM), (right, right_x_mm)] {
        let place = party
            .place
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("____________________");
        let place_and_date = truncate_text_to_width(
            &format!("{place}, den {}", fmt_de_date(party.date)),
            8.5,
            column_width_mm,
        );
        let signature_line_y_mm = top_y_mm - SIGNATURE_LINE_OFFSET_MM;
        append_pdf_filled_rect(
            &mut layout.page_ops,
            x_mm,
            signature_line_y_mm,
            column_width_mm,
            0.25,
            treatment_plan_pdf_color(TreatmentPlanPdfColor::Body),
        );
        let (headline, caption) = if party.role == "Auftragnehmer" {
            (
                truncate_text_to_width(party.name, 8.5, column_width_mm),
                format!("{place_and_date} · Unterschrift, Stempel"),
            )
        } else {
            (
                place_and_date,
                format!("Ort, Datum · Unterschrift {}", party.role),
            )
        };
        append_pdf_text_line(
            &mut layout.page_ops,
            &headline,
            x_mm,
            signature_line_y_mm - 4.0,
            8.5,
            &bold_font,
            TreatmentPlanPdfColor::Body,
        );
        append_pdf_text_line(
            &mut layout.page_ops,
            &truncate_text_to_width(&caption, 7.5, column_width_mm),
            x_mm,
            signature_line_y_mm - 8.0,
            7.5,
            &regular_font,
            TreatmentPlanPdfColor::Muted,
        );
    }

    layout.y_mm = top_y_mm - BLOCK_HEIGHT_MM;
}

/// Party block lines for the contract letterhead, using the gendered
/// salutation on the first line (e.g. "Herr Max Musterman") where the
/// reference .docx shows one, otherwise the bare name. The Einzelauftrag
/// intentionally omits the customer's birth date from this header block.
fn legal_party_block(layout: &mut TreatmentPlanPdfLayout, lines: &[String], role_line: &str) {
    for (index, line) in lines.iter().enumerate() {
        if index == 0 {
            layout.text_block(line, 11.0, true, 0.0, TreatmentPlanPdfColor::Body, 0.0, 0.6);
        } else {
            layout.text_block(
                line,
                9.5,
                false,
                0.0,
                TreatmentPlanPdfColor::Muted,
                0.0,
                0.4,
            );
        }
    }
    layout.text_block(
        role_line,
        8.5,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.8,
        0.0,
    );
}

fn single_order_party_lines(party: &DocPartyBlock) -> Vec<String> {
    let mut lines = vec![party.name_with_salutation()];
    if let Some(address) = party.address_line() {
        lines.push(address);
    }
    if let Some(email) = party
        .email
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Email: {email}"));
    }
    if let Some(phone) = party
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Tel.: {phone}"));
    }
    lines
}

fn build_single_order_pdf(
    context: &GeneratedSingleOrderContext,
    fallback_document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let document_reference = legal_document_reference(
        Some(context.order_number.as_str()),
        fallback_document_reference,
    );
    let mut layout = legal_document_pdf_layout(&document_reference, &context.agency, regular, bold);

    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{}. {} VOM {} ZUM RAHMENDIENSTLEISTUNGSVERTRAG VOM {}",
            context.order_sequence,
            admin_doc_label(&context.language, "single_order_title").to_uppercase(),
            fmt_de_date(context.order_date),
            fmt_de_date(context.contract_date)
        )
    });
    layout.text_block_centered(&title, 16.0, true, TreatmentPlanPdfColor::Body, 0.0, 3.5);
    let contract_number = context
        .contract_number
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut meta_lines = Vec::new();
    if !context.order_number.trim().is_empty() {
        meta_lines.push(format!("Auftragsnummer: {}", context.order_number));
    }
    if let Some(contract_number) = contract_number {
        meta_lines.push(format!(
            "Rahmendienstleistungsvertrag Nr.: {contract_number}"
        ));
    }
    if !meta_lines.is_empty() {
        let last_index = meta_lines.len() - 1;
        for (index, line) in meta_lines.iter().enumerate() {
            layout.text_block_centered(
                line,
                10.0,
                false,
                TreatmentPlanPdfColor::Muted,
                0.0,
                if index == last_index { 4.0 } else { 0.0 },
            );
        }
    }

    layout.text_block(
        "zwischen",
        9.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.2,
    );
    legal_party_block(
        &mut layout,
        &single_order_party_lines(&context.party),
        "– nachfolgend „Auftraggeber“ genannt –",
    );
    layout.text_block(
        "und",
        9.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        2.0,
        1.2,
    );
    legal_party_block(
        &mut layout,
        &legal_agency_block_lines(&context.agency),
        "– nachfolgend „Auftragnehmer“ genannt –",
    );
    layout.text_block(
        "– nachfolgend „Auftraggeber“ und „Auftragnehmer“ gemeinsam „Vertragsparteien“ genannt –",
        8.5,
        false,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.8,
        4.0,
    );

    layout.page_break();
    admin_heading(&mut layout, "Präambel");
    admin_block(
        &mut layout,
        &format!(
            "Zwischen dem Auftraggeber und Auftragnehmer wurde am {} ein Rahmendienstleistungsvertrag (im Folgenden „Rahmendienstleistungsvertrag“ genannt) geschlossen.",
            fmt_de_date(context.contract_date)
        ),
        0.0,
        1.0,
    );
    admin_block(
        &mut layout,
        "Die in diesem Rahmendienstleistungsvertrag vereinbarten Beratungs- und Dienstleistungen werden auf Basis von Einzelaufträgen durch den Auftragnehmer erbracht. Vor diesem Hintergrund vereinbaren die Vertragspartner folgenden Einzelauftrag:",
        0.0,
        2.0,
    );

    admin_heading(&mut layout, "I. Leistungsumfang");
    admin_block(
        &mut layout,
        "Im Zuge der vorliegenden Beauftragung sind durch den Auftragnehmer folgende Leistungen zu erbringen:",
        0.0,
        1.0,
    );
    admin_block(
        &mut layout,
        "Der konkrete Leistungsumfang beschränkt sich auf die in Abschnitt II aufgeführten, vom Auftraggeber ausgewählten Leistungen und den zugehörigen Kostenvoranschlag.",
        0.0,
        2.0,
    );

    admin_heading(
        &mut layout,
        if context.payer.is_some() {
            "II. Vergütungsvereinbarung, Kostenübernahme durch Dritte und aufschiebende Bedingung für die Wirksamkeit des Einzelauftrags"
        } else {
            "II. Vergütungsvereinbarung"
        },
    );
    admin_block(
        &mut layout,
        if context.payer.is_some() {
            "Für diese Auftragserfüllung wird folgendes vereinbart:"
        } else {
            "1. Für diese Auftragserfüllung wird folgende Vergütung vereinbart:"
        },
        0.0,
        1.0,
    );
    if let Some(payer) = context.payer.as_ref() {
        let payer_birth = payer
            .birth_date
            .map(|value| format!(", geb. am {}", value.format("%d.%m.%Y")))
            .unwrap_or_default();
        admin_block(
            &mut layout,
            &format!(
                "Die im Rahmen dieses Einzelauftrags gemäß Rahmendienstleistungsvertrag vom {} anfallenden Kosten werden nicht vom Auftraggeber, sondern vollständig von einer dritten Person – {}{} – (nachfolgend „Kostenübernehmer“) übernommen. Der Kostenübernehmer verpflichtet sich, sämtliche Zahlungsverpflichtungen, die aus diesem Einzelauftrag entstehen, vollständig zu tragen.",
                fmt_de_date(context.contract_date),
                payer.name_with_salutation(),
                payer_birth
            ),
            0.0,
            1.5,
        );
        admin_block(
            &mut layout,
            &format!(
                "Alle Vertragspflichten des Auftraggebers gemäß § 2 des Rahmendienstleistungsvertrages vom {}, soweit sie diesen Einzelauftrag betreffen, gehen mit Unterzeichnung der Kostenübernahmeerklärung durch den Kostenübernehmer auf diesen über.",
                fmt_de_date(context.contract_date)
            ),
            0.0,
            1.5,
        );
        admin_block(
            &mut layout,
            "Dieser Einzelauftrag tritt erst dann in Kraft und entfaltet keine Rechtswirkung, solange dem Auftragnehmer keine schriftliche und rechtsverbindlich unterzeichnete Kostenübernahmeerklärung durch den benannten Kostenübernehmer vorliegt. Erst mit Zugang dieser Erklärung beim Auftragnehmer gilt der Einzelauftrag als wirksam zustande gekommen.",
            0.0,
            1.5,
        );
        admin_block(
            &mut layout,
            "Der Auftraggeber erklärt sich ausdrücklich damit einverstanden, dass der Auftragnehmer dem benannten Kostenübernehmer die für die Durchführung und Abrechnung des Einzelauftrags erforderlichen personenbezogenen Daten des Auftraggebers (insbesondere Name, Anschrift, Kontaktdaten sowie Informationen zur beauftragten Leistung) übermittelt. Die Datenweitergabe erfolgt ausschließlich zweckgebunden im Rahmen dieses Vertragsverhältnisses und auf Grundlage der Einwilligung des Auftraggebers gemäß Art. 6 Abs. 1 lit. a DSGVO.",
            0.0,
            2.0,
        );
    } else {
        if context.line_items.is_empty() {
            admin_block(
                &mut layout,
                "Die Vergütung richtet sich nach den Regelungen des Rahmendienstleistungsvertrages und dem zugehörigen Kostenvoranschlag.",
                0.0,
                2.0,
            );
        } else {
            layout.ensure_space(45.0);
            layout.table_header_row(&[
                ("Leistungen", 88.0, PdfCellAlign::Left),
                ("Honorar*", 30.0, PdfCellAlign::Right),
                ("Anmerkung", 56.0, PdfCellAlign::Left),
            ]);
            for item in &context.line_items {
                let fee = cost_coverage_money_cell(&item.unit_price)
                    .unwrap_or_else(|| "____________".to_string());
                layout.table_row_aligned(
                    &[
                        (item.description.trim(), 88.0, PdfCellAlign::Left),
                        (&fee, 30.0, PdfCellAlign::Right),
                        ("", 56.0, PdfCellAlign::Left),
                    ],
                    false,
                    false,
                );
            }
            admin_block(
                &mut layout,
                "*Alle angegebenen Preise zzgl. MwSt. 19 %. Der konkrete Aufwand wird im Kostenvoranschlag zu diesem Einzelauftrag ausgewiesen.",
                4.5,
                1.5,
            );
            admin_block(
                &mut layout,
                "2. Die Pauschale für die Kommunikation mit den Ärzten und die Koordination der Behandlungen ist in voller Höhe zu zahlen, unabhängig davon, wie viele Ärzte tatsächlich konsultiert worden sind.",
                0.0,
                1.0,
            );
            admin_block(
                &mut layout,
                "3. Die Parteien sind sich einig, dass sich die Vergütung auf die unter § 1 genannten Leistungen bezieht. Den Parteien steht es frei, jederzeit Folgeaufträge unter Geltung der Regelungen des Dienstleistungsvertrages abzuschließen.",
                0.0,
                1.0,
            );
            admin_block(
                &mut layout,
                "4. Im Übrigen gelten die Regelungen des § 2 des Rahmendienstleistungsvertrages.",
                0.0,
                1.5,
            );
        }
    }

    for (heading, body) in [
        (
            "III. Fortgeltung",
            "Im Übrigen gelten die Regelungen des Rahmendienstleistungsvertrag mit allen enthaltenden Regelungen und Bestandteilen unverändert fort.",
        ),
        (
            "IV. Anwendbares Recht",
            "Auf diesen Vertrag ist ausschließlich das deutsche Recht anzuwenden.",
        ),
        (
            "V. Erfüllungsort",
            "Erfüllungsort für sämtliche Leistungen ist München.",
        ),
        (
            "VI. Gerichtstand",
            "Ausschließlicher Gerichtstand für alle, sich aus dem Vertragsverhältnis ergebenden Streitigkeiten, ist München, Deutschland.",
        ),
        (
            "VII. Änderungen und Ergänzungen",
            "Die Parteien vereinbaren, dass das Schriftformerfordernis für diesen Einzelauftrag als gewahrt gilt, sofern beide Parteien diesen mittels eines anerkannten elektronischen Signaturtools, wie beispielsweise DocuSign, unterzeichnen. Kurzfristige Änderungen oder Ergänzungen des festgelegten Leistungsumfangs dieses Einzelauftrags können hingegen per E-Mail vereinbart werden.",
        ),
        (
            "VIII. Salvatorische Klausel",
            "Sollten einzelne Bestimmungen dieses Vertrages ganz oder teilweise unwirksam sein oder werden, so wird hierdurch die Wirksamkeit der übrigen Bestimmungen nicht berührt. Anstelle der unwirksamen Bestimmung gilt diejenige wirksame Bestimmung als vereinbart, die dem Sinn und Zweck der unwirksamen Bestimmung am nächsten kommt.",
        ),
    ] {
        admin_heading(&mut layout, heading);
        admin_block(&mut layout, body, 0.0, 1.0);
    }

    admin_heading(
        &mut layout,
        "IX. Bestandteile des Einzelauftrages und Rangfolge",
    );
    let order_components = context
        .order_components
        .as_deref()
        .into_iter()
        .flat_map(str::lines)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if order_components.is_empty() {
        admin_block(&mut layout, "Keine", 0.0, 2.0);
    } else {
        let last_index = order_components.len() - 1;
        for (index, component) in order_components.into_iter().enumerate() {
            admin_block(
                &mut layout,
                component,
                0.0,
                if index == last_index { 2.0 } else { 0.5 },
            );
        }
    }

    let party_name = context.party.name_with_salutation();
    let agency_signature_name = agency_legal_name(&context.agency);
    admin_signature_grid(
        &mut layout,
        AdminSignatureParty {
            place: context.party_sign_place.as_deref(),
            date: context.party_sign_date,
            name: &party_name,
            role: "Auftraggeber",
        },
        AdminSignatureParty {
            place: context.agency_sign_place.as_deref(),
            date: context.agency_sign_date,
            name: &agency_signature_name,
            role: "Auftragnehmer",
        },
    );

    let _ = &context.patient_pid;
    Ok(finalize_admin_pdf(document, layout))
}

fn build_order_cost_estimate_pdf(
    context: &GeneratedSingleOrderContext,
    fallback_document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let document_reference =
        legal_document_reference(context.quote_number.as_deref(), fallback_document_reference);
    let mut layout = legal_document_pdf_layout(&document_reference, &context.agency, regular, bold);

    layout.text_block_centered(
        "Anlage 1 zum Einzelauftrag",
        11.0,
        true,
        TreatmentPlanPdfColor::Primary,
        0.0,
        1.0,
    );
    layout.text_block_centered(
        "KOSTENVORANSCHLAG",
        18.0,
        true,
        TreatmentPlanPdfColor::Body,
        0.0,
        0.5,
    );
    layout.text_block_centered(
        &format!("ZUM {}. EINZELAUFTRAG", context.order_sequence),
        13.0,
        true,
        TreatmentPlanPdfColor::Body,
        0.0,
        3.0,
    );

    let quote_number = context
        .quote_number
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("____________________");
    legal_meta_grid(
        &mut layout,
        &[
            ("Kostenvoranschlag Nr. :", quote_number.to_string()),
            ("Datum:", fmt_de_date(context.order_date)),
            ("Auftraggeber:", context.party.name_with_salutation()),
            (
                "Geburtsdatum des Auftraggebers:",
                fmt_de_date(context.party.birth_date),
            ),
            (
                "Rahmendienstleistungsvertrag vom:",
                fmt_de_date(context.contract_date),
            ),
            ("Einzelauftrag vom:", fmt_de_date(context.order_date)),
        ],
    );
    admin_block(&mut layout, "Sehr geehrte Damen und Herren,", 0.0, 3.0);
    admin_block(
        &mut layout,
        "hiermit erhalten Sie eine Übersicht über die zu erwartenden Kosten die im Zusammenhang mit der Erbringung von unseren Leistungen anfallen können.",
        0.0,
        3.0,
    );
    admin_block(
        &mut layout,
        "Bitte beachten Sie, dass es sich lediglich um eine vorläufige Berechnung handelt, die auf den vorliegenden Daten beruht. Eine endgültige Berechnung der anfallenden Kosten für von uns erbrachte Leistungen ist erst mit Abschluss des Einzelauftrags möglich.",
        0.0,
        3.0,
    );
    admin_block(
        &mut layout,
        "Höhere Kosten können sich z.B. bei Komplikationen oder bei zusätzlichem organisatorischen Aufwand entstehen.",
        0.0,
        0.0,
    );
    const SERVICE_WIDTH_MM: f32 = 70.0;
    const UNIT_PRICE_WIDTH_MM: f32 = 34.0;
    const QUANTITY_WIDTH_MM: f32 = 40.0;
    const TOTAL_WIDTH_MM: f32 = 30.0;

    layout.spacer(6.0);
    layout.table_header_row(&[
        ("Leistungen", SERVICE_WIDTH_MM, PdfCellAlign::Left),
        (
            "Honorar pro Einheit",
            UNIT_PRICE_WIDTH_MM,
            PdfCellAlign::Right,
        ),
        (
            "Voraussichtlicher Aufwand (in Einheiten)",
            QUANTITY_WIDTH_MM,
            PdfCellAlign::Right,
        ),
        ("Summe", TOTAL_WIDTH_MM, PdfCellAlign::Right),
    ]);
    for item in &context.line_items {
        let unit_price = cost_coverage_money_cell(&item.unit_price)
            .unwrap_or_else(|| "____________".to_string());
        let quantity = if item.quantity.trim().is_empty() {
            "1"
        } else {
            item.quantity.trim()
        };
        let line_gross = cost_coverage_money_cell(&item.line_gross)
            .unwrap_or_else(|| "____________".to_string());
        layout.table_row_aligned(
            &[
                (
                    item.description.trim(),
                    SERVICE_WIDTH_MM,
                    PdfCellAlign::Left,
                ),
                (&unit_price, UNIT_PRICE_WIDTH_MM, PdfCellAlign::Right),
                (quantity, QUANTITY_WIDTH_MM, PdfCellAlign::Right),
                (&line_gross, TOTAL_WIDTH_MM, PdfCellAlign::Right),
            ],
            false,
            false,
        );
    }
    layout.spacer(4.0);
    let totals = [
        ("Nettowert:", context.total_net.as_deref(), false, false),
        ("MWSt. 19%:", context.total_vat.as_deref(), false, false),
        ("Gesamtsumme:", context.total_gross.as_deref(), true, true),
    ]
    .into_iter()
    .filter_map(|(label, value, bold, shaded)| {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| (label, value, bold, shaded))
    })
    .collect::<Vec<_>>();
    for (index, (label, value, bold, shaded)) in totals.iter().copied().enumerate() {
        if shaded {
            layout.spacer(1.5);
        }
        let cells = [
            ("", SERVICE_WIDTH_MM, PdfCellAlign::Left),
            ("", UNIT_PRICE_WIDTH_MM, PdfCellAlign::Left),
            (label, QUANTITY_WIDTH_MM, PdfCellAlign::Right),
            (value, TOTAL_WIDTH_MM, PdfCellAlign::Right),
        ];
        if totals
            .get(index + 1)
            .is_some_and(|(_, _, _, next_shaded)| *next_shaded)
        {
            layout.table_row_aligned_without_rule(&cells, bold, shaded);
        } else {
            layout.table_row_aligned(&cells, bold, shaded);
        }
    }
    let bank_lines = [
        ("Kontoinhaber", context.agency.bank_holder.as_deref()),
        ("Bank", context.agency.bank_name.as_deref()),
        ("SWIFT-Code", context.agency.bank_swift.as_deref()),
        ("IBAN", context.agency.bank_iban.as_deref()),
    ];
    let bank_rows = bank_lines
        .iter()
        .filter_map(|(label, value)| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| (*label, value))
        })
        .collect::<Vec<_>>();
    if !bank_rows.is_empty() {
        // Keep the payment lead-in together with the bank details instead of
        // leaving a single introductory line at the bottom of the table page.
        layout.ensure_space(42.0);
        layout.spacer(6.0);
        admin_block(
            &mut layout,
            "Der angegebene Gesamtbetrag ist vor Behandlungs-/Auftragsbeginn zu überweisen an:",
            0.0,
            0.8,
        );
        layout.spacer(2.5);
        layout.key_value_rows_centered(&bank_rows, 10.0, 0.0, 0.4);
        layout.spacer(2.5);
        admin_block(
            &mut layout,
            "Ggf. fordern wir während der Durchführung des Auftrages zu weiteren Vorauszahlungen auf. Überschreiten die Vorauszahlungen die endgültigen Gesamtauftragskosten, erstatten wir den Restbetrag selbstverständlich zurück.",
            1.0,
            1.0,
        );
        admin_block(
            &mut layout,
            "Die in der Endabrechnung angegebenen, angefallenen Kosten für von uns erbrachte Leistungen und Auslagen sind nach Zugang der Rechnung binnen 14 Tagen auf das oben genannte Konto zur Zahlung fällig.",
            0.0,
            1.0,
        );
    }
    let party_name = context.party.name_with_salutation();
    let agency_signature_name = agency_legal_name(&context.agency);
    admin_signature_grid(
        &mut layout,
        AdminSignatureParty {
            place: context.party_sign_place.as_deref(),
            date: context.party_sign_date,
            name: &party_name,
            role: "Auftraggeber",
        },
        AdminSignatureParty {
            place: context.agency_sign_place.as_deref(),
            date: context.agency_sign_date,
            name: &agency_signature_name,
            role: "Auftragnehmer",
        },
    );

    let _ = &context.patient_pid;
    Ok(finalize_admin_pdf(document, layout))
}

fn cost_coverage_summary_lines(context: &GeneratedCostCoverageContext) -> Vec<String> {
    let mut lines = vec![
        format!("Auftraggeber: {}", context.patient.name_with_title()),
        format!("Kostenübernehmer: {}", context.payer.name_with_title()),
        format!("Einzelauftrag vom: {}", fmt_de_date(context.order_date)),
    ];
    if let Some(total) = context.total_gross.as_deref() {
        lines.push(format!("Gesamtsumme: {total}"));
    }
    let _ = &context.order_number;
    lines
}

fn cost_estimate_summary_lines(context: &GeneratedCostEstimateContext) -> Vec<String> {
    let mut lines = party_block_lines(&context.patient);
    if let Some(item) = context.line_items.first() {
        lines.push(format!("Erste Leistung: {}", item.description));
    }
    if let Some(total) = context
        .total_range
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Gesamt: {total}"));
    }
    lines
}

/// German accusative rendering of the Auftraggeber for the intro sentence
/// ("zwischen … und dem Auftraggeber – Herrn Max Musterman –"). Declines the
/// gendered salutation ("Herr" -> "Herrn", "Frau" -> "Frau") and prefixes it to
/// the plain name. Falls back to the bare name when no salutation is known.
fn cost_coverage_party_accusative(party: &DocPartyBlock) -> String {
    match party.clean_salutation() {
        Some(salutation) => {
            let declined = match salutation {
                "Herr" => "Herrn",
                other => other,
            };
            format!("{declined} {}", party.name).trim().to_string()
        }
        None => party.name.clone(),
    }
}

/// Letterhead/party lines for the Kostenübernehmer using the gendered
/// salutation form of the name (reference renders "Justus Geldgeber" plainly
/// when no salutation is present). Mirrors `party_block_lines` otherwise.
fn cost_coverage_payer_lines(party: &DocPartyBlock) -> Vec<String> {
    let mut lines = vec![party.name_with_salutation()];
    if let Some(birth) = party.birth_date {
        lines.push(format!("geb. am {}", birth.format("%d.%m.%Y")));
    }
    if let Some(address) = party.address_line() {
        lines.push(address);
    }
    if let Some(email) = party
        .email
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Email: {email}"));
    }
    if let Some(phone) = party
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("Tel.: {phone}"));
    }
    lines
}

/// Format a raw line-item monetary cell. Numeric values ("999.00"/"999,00") are
/// normalised to "999,00 EUR" via `fmt_money_de`; operator free-text such as
/// "100,00 EUR/1 Stunde" is preserved verbatim.
fn cost_coverage_money_cell(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(
            parse_single_eur_amount(trimmed)
                .map(format_eur)
                .unwrap_or_else(|| trimmed.to_string()),
        )
    }
}

fn build_cost_coverage_pdf(
    context: &GeneratedCostCoverageContext,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let footer = format!(
        "{} · {}",
        context.auto_name,
        context.generated_at.format("%d.%m.%Y %H:%M UTC")
    );
    let mut layout = TreatmentPlanPdfLayout::new(footer, regular, bold);
    layout.set_document_reference(document_reference);

    // Ordinal used throughout the intro / headings ("1." in the reference).
    let ordinal = context.order_sequence.max(1);

    let title = context
        .title_override
        .clone()
        .unwrap_or_else(|| admin_doc_label(&context.language, "cost_coverage_title").to_string());
    layout.text_block_centered(
        &title.to_uppercase(),
        18.0,
        true,
        TreatmentPlanPdfColor::Body,
        0.0,
        3.0,
    );
    admin_block(
        &mut layout,
        &format!(
            "bezüglich des {ordinal}. Einzelauftrags vom {} zwischen dem Auftragnehmer und dem Auftraggeber – {} – im Rahmen des bestehenden Rahmendienstleistungsvertrags vom {}.",
            fmt_de_date(context.order_date),
            cost_coverage_party_accusative(&context.patient),
            fmt_de_date(context.contract_date)
        ),
        0.0,
        3.0,
    );

    admin_block(&mut layout, "zwischen", 0.0, 1.0);
    for line in cost_coverage_payer_lines(&context.payer) {
        admin_block(&mut layout, &line, 0.0, 0.5);
    }
    admin_block(
        &mut layout,
        "– nachfolgend „Kostenübernehmer“ genannt –",
        0.5,
        2.0,
    );
    admin_block(&mut layout, "und", 0.0, 1.0);
    for line in agency_block_lines(&context.agency) {
        admin_block(&mut layout, &line, 0.0, 0.5);
    }
    admin_block(
        &mut layout,
        "– nachfolgend „Auftragnehmer“ genannt –",
        0.5,
        3.0,
    );

    admin_heading(&mut layout, "1. Übernahme der Kosten");
    admin_block(
        &mut layout,
        "Der Kostenübernehmer erklärt sich ausdrücklich bereit, sämtliche im Zusammenhang mit dem genannten Einzelauftrag entstehenden Kosten gegenüber dem Auftragnehmer zu übernehmen. Dies umfasst insbesondere alle Vergütungen, Auslagen, Spesen sowie sonstige vertraglich vereinbarte Leistungen.",
        0.0,
        2.0,
    );

    admin_heading(&mut layout, "2. Übernahme der Vertragspflichten");
    admin_block(
        &mut layout,
        &format!(
            "Der Kostenübernehmer übernimmt im Umfang dieses Einzelauftrags sämtliche Pflichten \
             des Auftraggebers gemäß § 2 des Rahmendienstleistungsvertrages vom {} und des \
             {ordinal}. Einzelauftrags vom {} zwischen dem Auftragnehmer und dem Auftraggeber, \
             einschließlich etwaiger Mitwirkungs- oder Informationspflichten, soweit diese in \
             Zusammenhang mit der Durchführung der beauftragten Dienstleistung stehen.",
            fmt_de_date(context.contract_date),
            fmt_de_date(context.order_date)
        ),
        0.0,
        2.0,
    );

    admin_heading(&mut layout, "3. Vergütungsvereinbarung");
    admin_block(
        &mut layout,
        "Für diese Auftragserfüllung wird folgende Vergütung vereinbart:",
        0.0,
        1.5,
    );
    if context.line_items.is_empty() {
        admin_block(
            &mut layout,
            translated_label(&context.language, "no_services"),
            0.0,
            1.0,
        );
    } else {
        // Column header row (Leistungen / Honorar* / Anmerkung).
        layout.text_block(
            "Leistungen — Honorar* — Anmerkung",
            10.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
        for item in &context.line_items {
            // Description (Leistungen).
            layout.text_block(
                &format!("•  {}", item.description.trim()),
                11.0,
                true,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.5,
                0.3,
            );
            // Honorar* — quantity (Aufwand) — Summe.
            let mut figures: Vec<String> = Vec::new();
            if let Some(honorar) = cost_coverage_money_cell(&item.unit_price) {
                figures.push(format!("Honorar: {honorar}"));
            }
            if let Some(quantity) = item
                .quantity
                .trim()
                .is_empty()
                .then_some(())
                .map_or_else(|| Some(item.quantity.trim().to_string()), |_| None)
            {
                figures.push(format!("Aufwand: {quantity}"));
            }
            if let Some(summe) = cost_coverage_money_cell(&item.line_gross) {
                figures.push(format!("Summe: {summe}"));
            }
            if !figures.is_empty() {
                layout.text_block(
                    &figures.join("   ·   "),
                    11.0,
                    false,
                    8.0,
                    TreatmentPlanPdfColor::Primary,
                    0.0,
                    0.3,
                );
            }
            // Anmerkung.
            if let Some(note) = item
                .notes
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                layout.text_block(
                    note,
                    10.0,
                    false,
                    8.0,
                    TreatmentPlanPdfColor::Muted,
                    0.0,
                    0.6,
                );
            }
        }
        admin_block(
            &mut layout,
            "*Alle angegebenen Preise zzgl. MwSt. 19 %.",
            4.5,
            2.0,
        );
    }

    for (heading, body) in [
        (
            "4. Rechtsverbindlichkeit",
            "Diese Erklärung wird mit ihrer Unterzeichnung rechtsverbindlich. Der Einzelauftrag entfaltet seine Rechtswirkung gegenüber dem Auftragnehmer erst mit Zugang dieser Kostenübernahmeerklärung.",
        ),
        (
            "5. Anwendbares Recht",
            "Auf diesen Vertrag ist ausschließlich das deutsche Recht anzuwenden.",
        ),
        (
            "6. Erfüllungsort",
            "Erfüllungsort für sämtliche Leistungen ist München.",
        ),
        (
            "7. Gerichtsstand",
            "Ausschließlicher Gerichtsstand für alle aus dem Vertragsverhältnis entstehenden Streitigkeiten ist München, Deutschland.",
        ),
    ] {
        admin_heading(&mut layout, heading);
        admin_block(&mut layout, body, 0.0, 1.0);
    }

    admin_heading(&mut layout, "8. Salvatorische Klausel");
    admin_block(
        &mut layout,
        "Sollten einzelne Bestimmungen dieser Erklärung ganz oder teilweise unwirksam sein oder \
         werden, so wird hierdurch die Wirksamkeit der übrigen Bestimmungen nicht berührt. \
         Anstelle der unwirksamen Bestimmung gilt diejenige wirksame Bestimmung als vereinbart, \
         die dem Sinn und Zweck der unwirksamen Bestimmung am nächsten kommt.",
        0.0,
        1.0,
    );

    admin_heading(
        &mut layout,
        "9. Bestandteile der Kostenübernahmeerklärung und Rangfolge",
    );
    let quote_label = context
        .quote_number
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("________");
    for line in [
        format!("Anlage 1: Kostenvoranschlag zum {ordinal}. Einzelauftrag Nr. {quote_label};"),
        format!(
            "Anlage 2: {ordinal}. Einzelauftrag vom {} zum Rahmendienstleistungsvertrag vom {} - Auftraggeber: {};",
            fmt_de_date(context.order_date),
            fmt_de_date(context.contract_date),
            context.patient.name_with_salutation()
        ),
        format!(
            "Anlage 3: Unverbindliche voraussichtliche Kostenschätzung für medizinische Untersuchungen für {}.",
            context.patient.name_with_salutation()
        ),
    ] {
        admin_block(&mut layout, &line, 0.0, 0.5);
    }
    layout.spacer(1.0);

    // Anlage: Kostenvoranschlag zum {n}. Einzelauftrag
    admin_heading(
        &mut layout,
        &format!("Anlage: Kostenvoranschlag zum {ordinal}. Einzelauftrag"),
    );
    if let Some(quote) = context
        .quote_number
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        admin_block(
            &mut layout,
            &format!("Kostenvoranschlag Nr.: {quote}"),
            0.0,
            0.5,
        );
    }
    admin_block(
        &mut layout,
        &format!("Datum: {}", fmt_de_date(context.order_date)),
        0.0,
        0.5,
    );
    admin_block(
        &mut layout,
        &format!("Auftraggeber: {}", context.patient.name_with_salutation()),
        0.0,
        0.5,
    );
    if let Some(birth) = context.patient.birth_date {
        admin_block(
            &mut layout,
            &format!(
                "Geburtsdatum des Auftraggebers: {}",
                birth.format("%d.%m.%Y")
            ),
            0.0,
            0.5,
        );
    }
    admin_block(
        &mut layout,
        &format!(
            "Kostenträger/Kostenübernehmer: {}",
            context.payer.name_with_salutation()
        ),
        0.0,
        1.0,
    );

    // Totals — already German-formatted "2.698,00 EUR" in the context.
    for (label, value) in [
        ("Nettowert", context.total_net.as_deref()),
        ("MWSt. 19%", context.total_vat.as_deref()),
        ("Gesamtsumme", context.total_gross.as_deref()),
    ] {
        if let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) {
            let is_gross = label == "Gesamtsumme";
            layout.text_block(
                &format!("{label}: {value}"),
                if is_gross { 12.0 } else { 11.0 },
                is_gross,
                0.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                0.5,
            );
        }
    }

    let bank_lines: Vec<(&str, Option<&str>)> = vec![
        ("Kontoinhaber", context.agency.bank_holder.as_deref()),
        ("Bank", context.agency.bank_name.as_deref()),
        ("SWIFT-Code", context.agency.bank_swift.as_deref()),
        ("IBAN", context.agency.bank_iban.as_deref()),
    ];
    let bank_rows = bank_lines
        .iter()
        .filter_map(|(label, value)| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| (*label, value))
        })
        .collect::<Vec<_>>();
    if !bank_rows.is_empty() {
        admin_block(
            &mut layout,
            "Die in der Endabrechnung angegebenen, angefallenen Kosten für von uns erbrachte Leistungen und Auslagen sind nach Zugang der Rechnung binnen 14 Tagen auf das folgende Konto zur Zahlung fällig:",
            1.5,
            1.0,
        );
        layout.spacer(2.5);
        layout.key_value_rows_centered(&bank_rows, 10.0, 0.0, 0.5);
        layout.spacer(2.5);
    }

    let agency_signature_name = agency_legal_name(&context.agency);
    admin_signature_grid(
        &mut layout,
        AdminSignatureParty {
            place: context.payer_sign_place.as_deref(),
            date: context.payer_sign_date,
            name: &context.payer.name,
            role: "Kostenübernehmer",
        },
        AdminSignatureParty {
            place: context.agency_sign_place.as_deref(),
            date: context.agency_sign_date,
            name: &agency_signature_name,
            role: "Auftragnehmer",
        },
    );

    let _ = &context.order_number;
    Ok(finalize_admin_pdf(document, layout))
}

/// Format a single service line-item price for the cost estimate.
///
/// This is a RANGE estimate: operators enter free-text ranges such as
/// "100,00 -1000,00 €" which must render verbatim. Only when the value parses
/// as a single numeric amount (a quote fallback) do we normalise it via
/// `fmt_money_de`. Empty input yields an underscore fill-in line.
fn cost_estimate_price_text(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "____________".to_string();
    }
    match parse_single_eur_amount(trimmed) {
        Some(amount) => format_eur(amount),
        None => trimmed.to_string(),
    }
}

fn cost_estimate_default_title() -> &'static str {
    "Unverbindliche voraussichtliche Kostenschätzung für medizinische Untersuchungen"
}

fn cost_estimate_total_label() -> &'static str {
    "Unverbindliche voraussichtliche Kostenschätzung für medizinische Untersuchungen \
     (gesamt):"
}

fn cost_estimate_legal_notice() -> &'static str {
    "Rechtliche Hinweise: Die Kosten für medizinische Diagnostik und/oder Behandlung können von \
     angegebenen Preisen/Kosten abweichen und dienen ausschließlich Informationszwecken. \
     Dementsprechend geben wir keine Gewährleistungen oder Zusicherungen hinsichtlich der \
     Genauigkeit, Vollständigkeit oder Richtigkeit der hierin enthaltenen Informationen oder \
     Meinungen ab. Wir übernehmen keine Haftung für unmittelbare oder mittelbare Schäden, die \
     durch die Verteilung und/oder Verwendung dieses Dokuments verursacht und/oder mit der \
     Verteilung und/oder Verwendung dieses Dokuments im Zusammenhang stehen. Die Aussagen \
     entsprechen dem Stand zum Zeitpunkt der Erstellung des Dokuments und entspricht den \
     Medianpreisen für aufgeführte medizinische Leistungen aufgrund unserer Erfahrung. Sie können \
     aufgrund künftiger Entwicklungen überholt sein, ohne dass das Dokument geändert wurde."
}

fn build_cost_estimate_pdf(
    context: &GeneratedCostEstimateContext,
    fallback_document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let document_reference =
        legal_document_reference(context.quote_number.as_deref(), fallback_document_reference);
    let mut layout = legal_document_pdf_layout(&document_reference, &context.agency, regular, bold);

    let title = context
        .title_override
        .clone()
        .unwrap_or_else(|| cost_estimate_default_title().to_string());
    layout.text_block_centered(&title, 15.0, true, TreatmentPlanPdfColor::Body, 0.0, 4.0);

    // Datum: estimate_date now falls back to the generated date upstream, so it
    // is never a blank placeholder here.
    admin_block(
        &mut layout,
        &format!("Datum: {}", fmt_de_date(context.estimate_date)),
        0.0,
        0.5,
    );
    // Patient line uses the gendered salutation ("Herr Max Musterman").
    admin_block(
        &mut layout,
        &format!("Patient: {}", context.patient.name_with_salutation()),
        0.0,
        0.5,
    );
    if let Some(birth) = context.patient.birth_date {
        admin_block(
            &mut layout,
            &format!("Geburtsdatum: {}", birth.format("%d.%m.%Y")),
            0.0,
            2.0,
        );
    }

    layout.text_block(
        "Medizinische Leistungen",
        12.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        2.0,
        0.0,
    );
    layout.text_block(
        "Unverbindliche Kostenschätzung",
        11.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        2.0,
    );

    if context.line_items.is_empty() {
        admin_block(
            &mut layout,
            translated_label(&context.language, "no_services"),
            0.0,
            1.0,
        );
    } else {
        for item in &context.line_items {
            admin_block(&mut layout, &item.description, 1.0, 0.5);
            // Range estimate: prefer the operator's free-text line total, fall
            // back to the unit price. Verbatim ranges are preserved; only single
            // numeric quote-fallback values are normalised via fmt_money_de.
            let raw_price = {
                let line_gross = item.line_gross.trim();
                if line_gross.is_empty() {
                    item.unit_price.trim()
                } else {
                    line_gross
                }
            };
            layout.text_block(
                &cost_estimate_price_text(raw_price),
                11.0,
                true,
                4.0,
                TreatmentPlanPdfColor::Primary,
                0.0,
                1.0,
            );
        }
    }

    admin_block(&mut layout, cost_estimate_total_label(), 2.0, 0.5);
    let total_text = context
        .total_range
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(cost_estimate_price_text)
        .unwrap_or_else(|| "____________".to_string());
    layout.text_block(
        &total_text,
        12.0,
        true,
        4.0,
        TreatmentPlanPdfColor::Primary,
        0.0,
        3.0,
    );

    admin_block(&mut layout, cost_estimate_legal_notice(), 2.0, 3.0);

    let _ = &context.patient_pid;

    Ok(finalize_admin_pdf(document, layout))
}

/// German dative salutation for the heading address ("Herr" → "Herrn", "Frau" → "Frau").
/// Falls back to an empty string (so the bare name is used) when no salutation is known.
fn appointment_dative_salutation(party: &DocPartyBlock) -> &'static str {
    match party.clean_salutation() {
        Some(value) if value.eq_ignore_ascii_case("herr") => "Herrn",
        Some(value) if value.eq_ignore_ascii_case("frau") => "Frau",
        _ => "",
    }
}

/// German nominative salutation for the running body sentence ("Herr"/"Frau").
/// Falls back to an empty string when no salutation is known.
fn appointment_nominative_salutation(party: &DocPartyBlock) -> &'static str {
    match party.clean_salutation() {
        Some(value) if value.eq_ignore_ascii_case("herr") => "Herr",
        Some(value) if value.eq_ignore_ascii_case("frau") => "Frau",
        _ => "",
    }
}

fn build_appointment_confirmation_pdf(
    context: &GeneratedAppointmentConfirmationContext,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let footer = format!(
        "{} · {}",
        context.auto_name,
        context.generated_at.format("%d.%m.%Y %H:%M UTC")
    );
    let mut layout = TreatmentPlanPdfLayout::new(footer, regular, bold);
    layout.set_document_reference(document_reference);

    // --- Header meta table (Datum / Seiten / Doc.-ID / Ersteller / Für / Project) ---
    let meta_date = if context.sign_date.is_some() {
        fmt_de_date(context.sign_date)
    } else {
        context.generated_at.format("%d.%m.%Y").to_string()
    };
    let meta_doc_id = context
        .doc_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("____________")
        .to_string();
    let meta_originator = agency_responsible_person(&context.agency).to_string();
    let meta_for = {
        let name = context.patient.name.trim();
        if name.is_empty() {
            "____________".to_string()
        } else {
            name.to_string()
        }
    };
    for (label, value) in [
        ("Datum:", meta_date.as_str()),
        ("Seiten:", "1"),
        ("Doc.-ID:", meta_doc_id.as_str()),
        ("Ersteller:", meta_originator.as_str()),
        ("Für:", meta_for.as_str()),
        ("Project:", "TB-V2"),
    ] {
        layout.text_block(
            &format!("{label} {value}"),
            9.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            0.6,
        );
    }
    layout.spacer(2.5);

    // --- Agency letterhead ---
    for line in agency_block_lines(&context.agency) {
        admin_block(&mut layout, &line, 0.0, 0.3);
    }
    layout.spacer(2.0);

    // --- Recipient ---
    let recipient = context
        .recipient_block
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("An die Bundespolizei / Grenzschutz");
    for line in recipient.lines() {
        admin_block(&mut layout, line, 0.0, 0.3);
    }
    layout.spacer(2.0);

    // --- Place / date line ---
    let sign_place = context
        .sign_place
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(context.agency.sign_place.as_str());
    admin_block(
        &mut layout,
        &format!("{sign_place}, {}", fmt_de_date(context.sign_date)),
        0.0,
        3.0,
    );

    // --- Heading: dative salutation + UPPERCASE "LAST, FIRST" ---
    let heading = context.title_override.clone().unwrap_or_else(|| {
        let birth = context
            .patient
            .birth_date
            .map(|value| format!(", geb. am {}", value.format("%d.%m.%Y")))
            .unwrap_or_default();
        let address = context.patient.name_last_comma_first().to_uppercase();
        let salutation = appointment_dative_salutation(&context.patient);
        let addressee = if salutation.is_empty() {
            address
        } else {
            format!("{salutation} {address}")
        };
        format!("Terminbestätigung für {addressee}{birth}")
    });
    layout.text_block_centered(&heading, 13.0, true, TreatmentPlanPdfColor::Body, 0.0, 2.0);
    admin_block(&mut layout, "Sehr geehrte Damen und Herren,", 0.0, 1.5);

    // --- Confirmation body sentence ---
    let body_birth = context
        .patient
        .birth_date
        .map(|value| format!(", geb. am {}", value.format("%d.%m.%Y")))
        .unwrap_or_default();
    let passport_number = context
        .passport_number
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("____________");
    let passport_valid_until = context
        .passport_valid_until
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "____________".to_string());
    let passport = format!(", Reisepass Nr.: {passport_number}, gültig bis {passport_valid_until}");
    let clinics = if context.clinics.is_empty() {
        "den vereinbarten Kliniken".to_string()
    } else {
        context
            .clinics
            .iter()
            .map(|clinic| {
                match clinic
                    .address
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                {
                    Some(address) => format!("{} ({address})", clinic.name),
                    None => clinic.name.clone(),
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    let nominative = appointment_nominative_salutation(&context.patient);
    let body_addressee = if nominative.is_empty() {
        context.patient.name_last_comma_first()
    } else {
        format!("{nominative} {}", context.patient.name_last_comma_first())
    };
    admin_block(
        &mut layout,
        &format!(
            "hiermit bestätigen wir, dass {body_addressee}{body_birth}{passport} sämtliche Termine für Diagnostik und Behandlung in {clinics} hat.",
        ),
        0.0,
        1.5,
    );

    // --- Examination scheduling ---
    let first = context
        .first_examination
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "in Kürze".to_string());
    let weeks = context
        .examination_weeks
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|value| {
            format!(" Weitere Untersuchungen sind für die Kalenderwochen {value} geplant.")
        })
        .unwrap_or_default();
    admin_block(
        &mut layout,
        &format!("Die ersten Untersuchungen finden am {first} statt.{weeks}"),
        0.0,
        1.5,
    );
    let continuation_statement = context
        .continuation_statement
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Die Behandlung wurde in Deutschland begonnen und soll nun fortgesetzt werden.");
    admin_block(
        &mut layout,
        &format!(
            "{continuation_statement} In München wird der Patient von unserer Agentur betreut und begleitet. Dolmetscher und Transfer sind organisiert."
        ),
        0.0,
        1.5,
    );
    admin_block(
        &mut layout,
        "Die Kostenfrage wurde mit dem Patienten geklärt. Es fallen keine Kosten für die Bundesrepublik Deutschland an.",
        0.0,
        1.5,
    );

    // --- Closing "Für Rückfragen" — ALWAYS rendered, fall back to agency phone. ---
    let phones = context
        .contact_phones
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .or_else(|| {
            context
                .agency
                .phone
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
        });
    let closing = match phones {
        Some(phones) => {
            format!("Für Rückfragen stehen wir Ihnen gerne zur Verfügung unter {phones}.")
        }
        None => "Für Rückfragen stehen wir Ihnen gerne zur Verfügung.".to_string(),
    };
    admin_block(&mut layout, &closing, 0.0, 2.0);

    admin_block(&mut layout, "Mit freundlichen Grüßen,", 2.0, 8.0);
    let signer = agency_responsible_person(&context.agency);
    layout.text_block(
        signer,
        11.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        0.5,
    );
    admin_block(&mut layout, "Geschäftsführer", 0.0, 1.0);

    Ok(finalize_admin_pdf(document, layout))
}

/// Default underscore fill-in for a blank handwritten line.
fn consent_blank_long() -> &'static str {
    "________________________________________________________________________________"
}

/// Renders a small muted caption line (the parenthetical hints in the reference form).
fn consent_caption(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block(
        text,
        9.0,
        false,
        4.0,
        TreatmentPlanPdfColor::Muted,
        0.0,
        1.0,
    );
}

/// Returns the trimmed, non-empty value or the long underscore blank for handwritten fill-ins.
fn consent_value_or_blank(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| consent_blank_long().to_string())
}

fn adult_consent_subject_line(party: &DocPartyBlock) -> String {
    let birth_date = party
        .birth_date
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "________________".to_string());
    format!(
        "{}, geb. am {}",
        consent_value_or_blank(Some(party.name.as_str())),
        birth_date
    )
}

fn normalized_agency_person(value: &str) -> Option<&str> {
    let mut value = value.trim();
    if value
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("c/o"))
    {
        value = value
            .get(3..)
            .unwrap_or_default()
            .trim_start_matches(|character: char| {
                character.is_whitespace() || matches!(character, '-' | '/' | ':' | '·')
            });
    }
    (!value.is_empty()).then_some(value)
}

fn strip_trailing_agency_person<'a>(name: &'a str, responsible_person: &str) -> &'a str {
    let Some(start) = name.len().checked_sub(responsible_person.len()) else {
        return name;
    };
    let Some(suffix) = name.get(start..) else {
        return name;
    };
    if !suffix.eq_ignore_ascii_case(responsible_person) {
        return name;
    }
    name.get(..start)
        .unwrap_or(name)
        .trim_end_matches(|character: char| {
            character.is_whitespace() || matches!(character, '-' | '/' | '·' | ',')
        })
}

fn agency_legal_name(agency: &AgencyContractSettings) -> String {
    let configured_name = agency.name.trim();
    let name = configured_agency_responsible_person(agency)
        .map(|responsible_person| strip_trailing_agency_person(configured_name, responsible_person))
        .filter(|value| !value.is_empty())
        .unwrap_or(configured_name);
    name.to_string()
}

fn configured_agency_responsible_person(agency: &AgencyContractSettings) -> Option<&str> {
    agency.care_of.as_deref().and_then(normalized_agency_person)
}

fn agency_responsible_person(agency: &AgencyContractSettings) -> &str {
    configured_agency_responsible_person(agency).unwrap_or_default()
}

fn agency_identity_profile_lines(agency: &AgencyContractSettings) -> Vec<String> {
    let legal_name = agency_legal_name(agency);
    let mut lines = vec![legal_name.clone()];
    if let Some(responsible_person) = configured_agency_responsible_person(agency)
        && !legal_name
            .to_lowercase()
            .contains(&responsible_person.to_lowercase())
    {
        lines.push(responsible_person.to_string());
    }
    lines
}

fn adult_legal_agency_identity(agency: &AgencyContractSettings) -> String {
    agency_identity_profile_lines(agency).join(" ")
}

fn agency_document_address(agency: &AgencyContractSettings) -> Option<&str> {
    agency
        .address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn agency_document_phone(agency: &AgencyContractSettings) -> Option<&str> {
    agency
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn agency_document_email(agency: &AgencyContractSettings) -> Option<&str> {
    agency
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn agency_document_website(agency: &AgencyContractSettings) -> Option<&str> {
    agency
        .website
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn footer_website_display(value: &str) -> &str {
    value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .unwrap_or(value)
        .trim_end_matches('/')
}

fn adult_legal_footer_lines(agency: &AgencyContractSettings) -> Vec<String> {
    let mut lines = vec![adult_legal_agency_identity(agency)];
    if let Some(address) = agency_document_address(agency) {
        lines.push(
            address
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(" · "),
        );
    }
    let mut contacts = Vec::new();
    if let Some(phone) = agency_document_phone(agency) {
        contacts.push(format!("Tel.: {phone}"));
    }
    if let Some(email) = agency_document_email(agency) {
        contacts.push(format!("E-Mail: {email}"));
    }
    if let Some(website) = agency_document_website(agency) {
        contacts.push(format!("Web: {}", footer_website_display(website)));
    }
    if !contacts.is_empty() {
        lines.push(contacts.join(" · "));
    }
    lines
}

fn legal_document_reference(business_number: Option<&str>, fallback: &str) -> String {
    let reference = business_number
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback.trim());
    let Some((base, version)) = reference.rsplit_once("-V") else {
        return reference.to_string();
    };
    if !base.is_empty()
        && !version.is_empty()
        && version.chars().all(|character| character.is_ascii_digit())
    {
        base.to_string()
    } else {
        reference.to_string()
    }
}

fn legal_document_pdf_layout(
    document_reference: &str,
    agency: &AgencyContractSettings,
    regular: PdfFontHandle,
    bold: PdfFontHandle,
) -> TreatmentPlanPdfLayout {
    let mut layout =
        TreatmentPlanPdfLayout::new_legal(adult_legal_footer_lines(agency), regular, bold);
    layout.set_document_reference(document_reference);
    layout
}

fn adult_legal_document_header(layout: &mut TreatmentPlanPdfLayout, annex: &str, title: &str) {
    // Centred orange kicker above a centred ink title, as in the Word originals.
    layout.text_block_centered(annex, 11.0, true, TreatmentPlanPdfColor::Primary, 0.0, 1.0);
    layout.text_block_centered(title, 16.0, true, TreatmentPlanPdfColor::Body, 0.0, 4.0);
}

fn adult_legal_identity_block(
    layout: &mut TreatmentPlanPdfLayout,
    party: &DocPartyBlock,
    include_contacts: bool,
) {
    layout.text_block(
        &format!("Ich, {},", adult_consent_subject_line(party)),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        1.0,
    );
    layout.text_block(
        &format!(
            "Adresse: {}",
            consent_value_or_blank(party.address_line().as_deref())
        ),
        11.0,
        false,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        1.0,
    );
    if include_contacts {
        let phone = consent_value_or_blank(party.phone.as_deref());
        let email = consent_value_or_blank(party.email.as_deref());
        layout.text_block(
            &format!("Telefonnummer: {phone}.   E-mail: {email}"),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            2.0,
        );
    }
}

fn adult_legal_signature_line(
    layout: &mut TreatmentPlanPdfLayout,
    party: &DocPartyBlock,
    bindings: &DocumentBindingOverrides,
) {
    let place = bindings
        .party_sign_place
        .as_deref()
        .or(bindings.sign_place.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("____________________");
    let date = bindings
        .party_sign_date
        .or(bindings.sign_date)
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "______________".to_string());
    layout.spacer(5.0);
    layout.ensure_space(14.0);
    let signature_y = layout.y_mm;
    append_pdf_text_line(
        &mut layout.page_ops,
        &format!("Ort, Datum: {place}, {date}"),
        PDF_LEFT_MARGIN_MM,
        signature_y,
        10.0,
        &layout.regular_font,
        TreatmentPlanPdfColor::Body,
    );
    append_pdf_text_line(
        &mut layout.page_ops,
        "Unterschrift: ____________________",
        122.0,
        signature_y,
        10.0,
        &layout.regular_font,
        TreatmentPlanPdfColor::Body,
    );
    append_pdf_text_line(
        &mut layout.page_ops,
        party.name.trim(),
        147.0,
        signature_y - 6.0,
        9.0,
        &layout.bold_font,
        TreatmentPlanPdfColor::Body,
    );
    layout.y_mm -= 14.0;
}

fn agency_data_controller_statement(agency: &AgencyContractSettings) -> &str {
    agency.data_controller_statement.trim()
}

fn adult_legal_checkbox(layout: &mut TreatmentPlanPdfLayout, text: &str) {
    layout.text_block_justified(
        &format!("[ ]  {text}"),
        10.5,
        false,
        4.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        1.5,
    );
}

fn adult_legal_channel(layout: &mut TreatmentPlanPdfLayout, label: &str) {
    layout.text_block(
        &format!("[ ]  {label}"),
        10.5,
        false,
        12.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        0.8,
    );
}

fn agency_privacy_email(agency: &AgencyContractSettings) -> Option<&str> {
    agency
        .privacy_email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            agency
                .email
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
}

fn build_adult_confidentiality_release_pdf(
    party: &DocPartyBlock,
    agency: &AgencyContractSettings,
    bindings: &DocumentBindingOverrides,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let mut layout = legal_document_pdf_layout(document_reference, agency, regular, bold);
    let agency_identity = adult_legal_agency_identity(agency);

    adult_legal_document_header(&mut layout, "Anlage 2", "Schweigepflichtentbindung");
    adult_legal_identity_block(&mut layout, party, false);
    fc_body(
        &mut layout,
        "bin mir bewusst, dass ärztliche und medizinische Dokumentation, Arztberichte, Rezepte, Kostenvoranschläge, Rechnungen und Quittungen Informationen im Sinne von § 203 StGB enthalten können, die insbesondere Rückschlüsse auf meine Diagnosen, medizinischen Untersuchungen, medizinischen Zustände sowie geplante, abgeschlossene oder noch andauernde Behandlungen zulassen oder solche Informationen enthalten können.",
    );
    fc_body(
        &mut layout,
        &format!(
            "Daher entbinde ich alle meine behandelnden Ärzte und medizinischen Einrichtungen von ihrer Schweigepflicht gegenüber {agency_identity} und den von ihm beauftragten Mitarbeitenden."
        ),
    );

    layout.text_block_justified(
        "Mir ist bekannt, dass ich diese Erklärung über die Entbindung von der Schweigepflicht jederzeit mit Wirkung für die Zukunft widerrufen kann.",
        11.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        1.0,
        1.0,
    );
    adult_legal_signature_line(&mut layout, party, bindings);

    Ok(finalize_admin_pdf(document, layout))
}

fn render_adult_privacy_information(
    layout: &mut TreatmentPlanPdfLayout,
    agency: &AgencyContractSettings,
) {
    let agency_identity = adult_legal_agency_identity(agency);
    let privacy_contact = agency_privacy_email(agency)
        .map(|value| format!("Per E-mail erreichen Sie den Datenschutzkontakt unter {value}."))
        .unwrap_or_else(|| {
            "Den Datenschutzkontakt erreichen Sie über die oben genannten Kontaktdaten der Agentur."
                .to_string()
        });
    let privacy_email = agency_privacy_email(agency);

    adult_legal_document_header(layout, "Anlage 3", "Informationsblatt zum Datenschutz");
    fc_body(
        layout,
        &format!(
            "Im Rahmen der Vermittlung von Gesundheitsdienstleistungen werden personenbezogene Daten sowohl des Auftraggebers als auch durch den vorliegenden Vertrag begünstigter Dritter durch {agency_identity} verarbeitet. Dabei werden die Anforderungen der Datenschutzgesetze (insbesondere DS-GVO und BDSG) umgesetzt. Hierzu werden technische und organisatorische Maßnahmen eingesetzt, um Ihre Daten zu schützen. Dieses Informationsblatt beschreibt die Verarbeitung personenbezogener Daten im Rahmen der allgemeinen geschäftlichen Tätigkeit und in der Vermittlungstätigkeit sowie die Rechte der durch die Verarbeitung betroffenen Personen."
        ),
    );
    fc_subhead(layout, "Name des Verantwortlichen");
    fc_body(layout, agency_data_controller_statement(agency));
    fc_subhead(layout, "Kontaktdaten des Datenschutzbeauftragten");
    fc_body(
        layout,
        "Postalisch können Sie unseren Datenschutzbeauftragten unter der oben genannten Adresse erreichen (Vertraulich, zu Händen des Datenschutzbeauftragten).",
    );
    fc_body(layout, &privacy_contact);
    fc_subhead(
        layout,
        "Kategorien der verarbeiteten personenbezogenen Daten",
    );
    fc_body(
        layout,
        "Personenbezogene Daten im Sinne dieses Schreibens sind alle Informationen, welche sich direkt oder indirekt auf eine Einzelperson beziehen (Art. 4 Nr. 1 DS-GVO).",
    );
    fc_body(
        layout,
        "Im Rahmen unserer allgemeinen Geschäftstätigkeit und bei den Vermittlungsmaßnahmen verarbeiten wir üblicherweise folgende Daten:",
    );
    fc_bullet(
        layout,
        "Persönliche Daten: Name, Kontaktdaten (E-mail, Handynummer, Anschrift, Geburtsdatum)",
    );
    fc_bullet(
        layout,
        "Gesundheitsdaten und behandlungsspezifische Daten: Vorbefunde, Laborbefunde, Bilddaten, ärztliche und medizinische Dokumentation, Rezepte",
    );
    fc_bullet(layout, "Zahlungsdaten: IBAN, BIC");
    fc_subhead(
        layout,
        "Zweckbestimmung und Rechtsgründe der Datenerhebung, -verarbeitung oder -nutzung",
    );
    fc_body(
        layout,
        "Wir verarbeiten personenbezogene Daten einerseits im Rahmen unserer allgemeinen Geschäftstätigkeit, andererseits im Rahmen der Vermittlungs- und Koordinationstätigkeit sowie im Kontakt zu den vermittelten Ärzten, Therapeuten und sonstigen Dritten, die an der vermittelten medizinischen Behandlung und Betreuung beteiligt sind.",
    );
    fc_subhead(
        layout,
        "Erfüllung vertraglicher Pflichten (Art. 6 Abs. 1 S. 1 lit. b DS-GVO)",
    );
    fc_body(
        layout,
        "Wir verarbeiten personenbezogene Daten zur Durchführung oder Anbahnung von Verträgen, deren Vertragspartei der Betroffene ist. Art und Umfang der Verarbeitung ergeben sich in diesem Falle aus dem jeweiligen Vertrag.",
    );
    fc_subhead(
        layout,
        "Wahrung berechtigter Interessen (Art. 6 Abs. 1 S. 1 lit. f DS-GVO)",
    );
    fc_body(
        layout,
        "Wir verarbeiten im Rahmen unseres allgemeinen Geschäftsbetriebes und unserer Vermittlungs- und Koordinationstätigkeit personenbezogene Daten auf Grundlage einer Interessenabwägung, sofern schutzwürdige entgegenstehende Interessen der betroffenen Person nicht überwiegen.",
    );
    fc_body(
        layout,
        "Die zu Grunde liegenden berechtigten Interessen sind dabei insbesondere die Aufrechterhaltung des Geschäftsbetriebes sowie die Erbringung der vertraglich vereinbarten Leistung gegenüber unseren Auftraggebern. Dabei verarbeiten wir die personenbezogenen Daten nur soweit, wie dies für die Erbringung unserer Leistung erforderlich ist.",
    );
    fc_subhead(
        layout,
        "Übersenden interessanter Informationen und Werbung (Art. 6 Abs. 1 S. 1 lit. f DS-GVO)",
    );
    let marketing_contact = privacy_email
        .map(|email| {
            format!(
                "Wir informieren unsere Auftraggeber gerne per E-mail oder Post über interessante Veranstaltungen, Ereignisse oder Neuigkeiten. Sollte dies von Ihnen nicht gewünscht sein, können Sie dieser Verwendung jederzeit widersprechen. Sie können den Widerspruch per E-mail an {email}, per Post oder an Ihren Ansprechpartner senden."
            )
        })
        .unwrap_or_else(|| {
            "Wir informieren unsere Auftraggeber gerne per E-mail oder Post über interessante Veranstaltungen, Ereignisse oder Neuigkeiten. Sollte dies von Ihnen nicht gewünscht sein, können Sie dieser Verwendung jederzeit per Post oder gegenüber Ihrem Ansprechpartner widersprechen."
                .to_string()
        });
    fc_body(layout, &marketing_contact);
    fc_body(
        layout,
        "Selbstverständlich können Sie Ihren Widerspruch zur Zusendung dieser Informationen auch bereits als Anlage an den Rahmenvertrag sowie Einzelauftrag erklären.",
    );
    fc_body(
        layout,
        "Sofern keine der vorgenannten Rechtsgrundlagen vorliegt, holen wir für die Durchführung einer Verarbeitung eine Einwilligung des Betroffenen ein, den wir über die geplante Verarbeitung umfassend informieren.",
    );
    fc_subhead(
        layout,
        "Empfänger oder Kategorien von Empfängern, denen Ihre Daten mitgeteilt werden können",
    );
    fc_subhead(layout, "Technische Dienstleistungen");
    fc_body(
        layout,
        "Für einzelne technische Aufgaben nehmen wir die Unterstützung von Spezialisten in Anspruch. Dabei kann nicht ausgeschlossen werden, dass Daten im Rahmen von Wartungs- und Reparaturarbeiten sowie Dienstleistungen zur Sicherstellung der Richtigkeit, Sicherheit und Verfügbarkeit von Daten auch an Subunternehmer weitergegeben werden. Durch vertragliche Regelungen und sorgfältige Auswahl stellen wir sicher, dass unsere Sicherheitsstandards auch bei den Dienstleistern umgesetzt werden.",
    );
    fc_subhead(layout, "Dauer der Datenspeicherung");
    fc_body(
        layout,
        "Wir speichern personenbezogene Daten so lange, wie wir sie für die Durchführung der jeweiligen Aufgabe benötigen. Soweit die Daten gesetzlichen Aufbewahrungspflichten unterliegen, speichern wir sie für die Dauer der Aufbewahrungsfrist. Darüber hinaus speichern wir personenbezogene Daten, wenn ein weiteres berechtigtes Interesse nach Art. 6 Abs. 1 S. 1 lit. f DS-GVO vorliegt.",
    );
    fc_body(
        layout,
        "Soweit personenbezogene Daten mehreren Aufbewahrungsfristen unterliegen, ist die jeweils längste Frist maßgeblich.",
    );
    fc_subhead(layout, "Betroffenenrechte");
    let rights_contact = privacy_email
        .map(|email| {
            format!(
                "Bei Fragen, Beschwerden und Anregungen zum Datenschutz dürfen Sie sich jederzeit an den Datenschutzbeauftragten unter {email} wenden."
            )
        })
        .unwrap_or_else(|| {
            "Bei Fragen, Beschwerden und Anregungen zum Datenschutz dürfen Sie sich jederzeit über die Kontaktdaten der Agentur an den Datenschutzbeauftragten wenden."
                .to_string()
        });
    fc_body(layout, &rights_contact);
    fc_body(
        layout,
        "Allen Betroffenen stehen von Gesetzes wegen Auskunftsrechte zu, etwa zum Zweck der Verarbeitung, zu Empfängern der Daten und geltenden Speicherfristen. Daneben bestehen Rechte auf Berichtigung unrichtiger Daten, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit sowie Widerspruch.",
    );
    fc_body(
        layout,
        "Erteilte Einwilligungen können jederzeit mit Wirkung für die Zukunft widerrufen werden, wobei der Widerruf ebenso einfach zu erklären ist wie die Einwilligung.",
    );
    let complaint_contact = privacy_email
        .map(|email| {
            format!(
                "Bevor Sie von Ihrem Beschwerderecht bei einer Datenschutzaufsichtsbehörde Gebrauch machen, möchten wir Sie bitten, zunächst noch einmal auf uns zuzukommen, beispielsweise über {email} oder durch Anschreiben an Ihren Ansprechpartner."
            )
        })
        .unwrap_or_else(|| {
            "Bevor Sie von Ihrem Beschwerderecht bei einer Datenschutzaufsichtsbehörde Gebrauch machen, möchten wir Sie bitten, zunächst noch einmal über die Kontaktdaten der Agentur auf uns zuzukommen."
                .to_string()
        });
    fc_body(layout, &complaint_contact);
}

fn build_adult_privacy_information_pdf(
    agency: &AgencyContractSettings,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let mut layout = legal_document_pdf_layout(document_reference, agency, regular, bold);
    render_adult_privacy_information(&mut layout, agency);
    Ok(finalize_admin_pdf(document, layout))
}

fn build_adult_privacy_consents_pdf(
    party: &DocPartyBlock,
    agency: &AgencyContractSettings,
    bindings: &DocumentBindingOverrides,
    document_reference: &str,
) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let mut layout = legal_document_pdf_layout(document_reference, agency, regular, bold);
    let agency_identity = adult_legal_agency_identity(agency);
    let data_system_name = agency.data_system_name.trim();
    let recipients = bindings
        .extra_release_recipients
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    adult_legal_document_header(
        &mut layout,
        "Anlage 1",
        "Einverständniserklärung zur Datenübermittlung",
    );
    adult_legal_identity_block(&mut layout, party, true);
    fc_body(&mut layout, "bin damit einverstanden (bitte ankreuzen):");
    adult_legal_checkbox(
        &mut layout,
        &format!(
            "dass {agency_identity} und von der verantwortlichen Person beauftragte Mitarbeitende meine personenbezogenen und medizinischen Daten, Personalausweis- und Reisepasskopien, Vorbefunde, Laborbefunde, Bilddaten, ärztliche und medizinische Dokumentation, Rezepte, Kostenvoranschläge, Rechnungen, Quittungen, Behandlungs- und Leistungsverträge sowie Arzt- und Krankenhausberichte einholen, bearbeiten, speichern und erforderlichenfalls an behandelnde Ärzte, Krankenhäuser, Labore, andere medizinische Einrichtungen, Dolmetscher, Übersetzer, Gutachter oder Kostenträger übermitteln;"
        ),
    );
    adult_legal_checkbox(
        &mut layout,
        &format!(
            "dass alle meine behandelnden Ärzte und medizinischen Einrichtungen meine Behandlungsunterlagen und medizinischen Informationen an {agency_identity} übermitteln dürfen;"
        ),
    );
    adult_legal_checkbox(
        &mut layout,
        &format!(
            "dass meine erforderlichen personenbezogenen und medizinischen Unterlagen im {data_system_name} gespeichert und verarbeitet werden;"
        ),
    );
    adult_legal_checkbox(
        &mut layout,
        "dass meine personenbezogenen und medizinischen Daten an folgende Personen oder Institutionen übermittelt werden:",
    );
    if let Some(recipients) = recipients {
        for line in recipients.lines().filter(|line| !line.trim().is_empty()) {
            layout.text_block(
                line.trim(),
                10.5,
                false,
                12.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                0.8,
            );
        }
    } else {
        layout.text_block(
            consent_blank_long(),
            10.5,
            false,
            12.0,
            TreatmentPlanPdfColor::Body,
            0.0,
            0.8,
        );
    }
    adult_legal_checkbox(
        &mut layout,
        "dass meine personenbezogenen und medizinischen Daten sowie erforderliche Unterlagen über folgende Kommunikationsmedien eingeholt und/oder übermittelt werden:",
    );
    adult_legal_channel(&mut layout, "E-mail");
    adult_legal_channel(&mut layout, "Threema-Messenger");
    adult_legal_channel(&mut layout, "WhatsApp-Messenger");
    adult_legal_channel(&mut layout, "Telegram-Messenger");
    fc_body(
        &mut layout,
        "Ich bin mir der möglichen Risiken bei der Übermittlung sensibler Daten per E-mail, WhatsApp-, Telegram- oder Threema-Messenger bewusst.",
    );
    if let Some(processor_notice) = agency
        .data_processor_notice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fc_body(&mut layout, "Mir ist bekannt:");
        fc_body(&mut layout, processor_notice);
    }
    layout.text_block_justified(
        "Die Einwilligung in die Verarbeitung meiner Daten ist freiwillig und kann jederzeit ohne Angabe von Gründen schriftlich mit Wirkung für die Zukunft widerrufen werden. Der Widerruf berührt die Rechtmäßigkeit der bisherigen Verarbeitung nicht.",
        11.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        0.0,
        2.0,
    );
    fc_body(
        &mut layout,
        "Die Verarbeitung von personenbezogenen und Gesundheitsdaten bleibt bis zum Zeitpunkt des Widerrufs oder solange gesetzliche Aufbewahrungsfristen bestehen rechtmäßig.",
    );
    fc_body(
        &mut layout,
        "Die Aufklärung gemäß EU-Datenschutz-Grundverordnung (DS-GVO) ist erfolgt. Ich wurde darüber aufgeklärt, dass ich ein Recht auf Auskunft, Berichtigung, Löschung oder Einschränkung der Verarbeitung meiner personenbezogenen Daten habe und diese Rechte jederzeit geltend machen kann.",
    );
    adult_legal_signature_line(&mut layout, party, bindings);

    Ok(finalize_admin_pdf(document, layout))
}

fn build_consent_pdf(context: &GeneratedConsentContext) -> Result<Vec<u8>, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let mut layout =
        legal_document_pdf_layout(&context.document_reference, &context.agency, regular, bold);
    let agency_person = fc_agency_person(&context.agency);
    let agency_identity = agency_legal_identity(&context.agency);
    let data_system_name = context.agency.data_system_name.trim();

    // Grammar tokens differ between the sole-guardian and the two-guardian (child) variants.
    let we = if context.sole_guardian { "Ich" } else { "Wir" };
    let we_lower = if context.sole_guardian { "ich" } else { "wir" };
    // Main subject verb: "bin" (sole) vs "sind" (child).
    let verb = if context.sole_guardian { "bin" } else { "sind" };
    // Release-clause verb: "entbinde" (sole) vs "entbinden" (child).
    let release_verb = if context.sole_guardian {
        "entbinde"
    } else {
        "entbinden"
    };
    // "Ebenso entbinde ich" vs "Ebenso entbinden wir" – subject ordering also differs.
    let our = if context.sole_guardian {
        "meinem"
    } else {
        "unserem"
    };
    let our_gen = if context.sole_guardian {
        "meines"
    } else {
        "unseres"
    };
    // "Mir ist bekannt" (sole) vs "Uns ist bekannt" (child).
    let us_dat = if context.sole_guardian { "Mir" } else { "Uns" };

    layout.text_block_centered(
        "Einverständniserklärung zur Datenübermittlung und Schweigepflichtsentbindung",
        15.0,
        true,
        TreatmentPlanPdfColor::Body,
        0.0,
        2.0,
    );
    admin_block(&mut layout, "Gültig bis: bis auf Widerruf", 0.0, 2.5);

    // ---- Guardian identification block ----
    if context.sole_guardian {
        admin_block(
            &mut layout,
            "Ich (alleinige/r Personensorgeberechtigte/r):",
            0.0,
            0.5,
        );
        admin_block(
            &mut layout,
            &consent_person_line(
                context.guardian_name.as_deref(),
                context.guardian_birth_date,
            ),
            0.0,
            0.5,
        );
        consent_caption(
            &mut layout,
            "(Vorname, Name)                        (TT.MM.JJJJ)",
        );
        // Guardian address block (sole variant only).
        admin_block(
            &mut layout,
            &format!(
                "Adresse: {}",
                consent_value_or_blank(context.guardian_address.as_deref())
            ),
            0.0,
            0.5,
        );
        consent_caption(
            &mut layout,
            "(Straße und Hausnummer, Adressenzusatz, Ort, PLZ, Land)",
        );
        admin_block(&mut layout, "– nachfolgend „Ich“ –", 0.5, 1.5);
    } else {
        admin_block(&mut layout, "Wir (Erziehungsberechtigte):", 0.0, 0.5);
        admin_block(
            &mut layout,
            &consent_person_line(
                context.guardian_name.as_deref(),
                context.guardian_birth_date,
            ),
            0.0,
            0.5,
        );
        admin_block(&mut layout, "und", 0.0, 0.5);
        admin_block(
            &mut layout,
            &consent_person_line(
                context.guardian2_name.as_deref(),
                context.guardian2_birth_date,
            ),
            0.0,
            0.5,
        );
        admin_block(&mut layout, "nachfolgend „Wir“,", 0.5, 1.5);
    }

    // ---- Child identification + address ----
    admin_block(
        &mut layout,
        &format!(
            "von {our} Kind: {}",
            consent_person_line(context.child_name.as_deref(), context.child_birth_date)
        ),
        0.0,
        0.5,
    );
    consent_caption(
        &mut layout,
        "(Vorname, Name)                        (TT.MM.JJJJ)",
    );
    admin_block(
        &mut layout,
        &format!(
            "Adresse{}: {}",
            if context.sole_guardian { "" } else { "(n)" },
            consent_value_or_blank(context.child_address.as_deref())
        ),
        0.0,
        0.5,
    );
    if context.sole_guardian {
        consent_caption(
            &mut layout,
            "(Straße und Hausnummer, Adressenzusatz, Ort, PLZ, Land)",
        );
    }
    layout.spacer(1.5);

    // ---- Main consent paragraph ----
    admin_block(
        &mut layout,
        &format!(
            "{verb} damit einverstanden, dass {agency_identity} und von der verantwortlichen Person beauftragte Mitarbeitende personenbezogene und medizinische Daten von {our} Kind, Personalausweiskopien, Reisepasskopien, Vorbefunde, Laborbefunde, Bilddaten, ärztliche und medizinische Dokumentation, Kostenvoranschläge, Rechnungen, Quittungen, Behandlungsverträge, Leistungsverträge, Arzt- und Krankenhausberichte über eine abgeschlossene oder noch andauernde Behandlung von {our} Kind einholen, bearbeiten, speichern und/oder übermitteln, insbesondere an behandelnde Ärzte, Krankenhäuser, Labore oder andere medizinische Einrichtungen, Dolmetscher, Übersetzer oder Gutachter. {we} {verb} damit einverstanden, dass notwendige Personalausweiskopien, Reisepasskopien, Vorbefunde, Laborbefunde, Bilddaten, ärztliche und medizinische Dokumentation, Rechnungen und Quittungen, Arzt- und Krankenhausberichte über eine abgeschlossene oder noch andauernde Behandlung von {our} Kind im {data_system_name} gespeichert und verarbeitet werden.",
            verb = verb,
            we = we,
            our = our,
            agency_identity = agency_identity,
            data_system_name = data_system_name
        ),
        0.0,
        1.5,
    );
    if let Some(processor_notice) = context
        .agency
        .data_processor_notice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        admin_block(
            &mut layout,
            &format!("{us_dat} ist bekannt: {processor_notice}"),
            0.0,
            1.5,
        );
    }

    // ---- Schweigepflichtsentbindung (release from confidentiality) ----
    admin_block(
        &mut layout,
        &format!(
            "{we} {release_verb} alle nach § 203 StGB schweigepflichtigen Personen (insbesondere Ärzte, Angehörige anderer Heilberufe) sowie andere Personen, die im Rahmen der Verarbeitung von Daten {our_gen} Kindes tätig sind (Mitarbeitende von {agency_person}, Dolmetscher, Übersetzer, Gutachter, Kostenträger sowie Angehörige von Krankenhäusern, Privatpraxen und anderen medizinischen Einrichtungen), von ihrer Schweigepflicht gegenüber {agency_person}.",
            we = we,
            release_verb = release_verb,
            our_gen = our_gen,
            agency_person = agency_person
        ),
        0.0,
        1.5,
    );
    admin_block(
        &mut layout,
        &format!(
            "Ebenso {release_verb} {we_lower} {agency_person} und beauftragte Mitarbeitende von der Schweigepflicht nach § 203 StGB gegenüber allen Ärzten, Angehörigen anderer Heilberufe, Dolmetschern, Übersetzern, Gutachtern sowie Angehörigen von Krankenhäusern, Privatpraxen und anderen medizinischen Einrichtungen.",
            release_verb = release_verb,
            we_lower = we_lower,
            agency_person = agency_person
        ),
        0.0,
        1.5,
    );

    // ---- Extra-release recipients: ALWAYS rendered (value or underscore blank + caption) ----
    admin_block(
        &mut layout,
        &format!(
            "Außerdem {release_verb} {we_lower} {agency_person} von der Schweigepflicht gegenüber folgenden Personen und/oder Institutionen/Einrichtungen:",
            release_verb = release_verb,
            we_lower = we_lower,
            agency_person = agency_person
        ),
        0.0,
        0.5,
    );
    admin_block(
        &mut layout,
        &consent_value_or_blank(context.extra_release_recipients.as_deref()),
        0.0,
        0.5,
    );
    consent_caption(
        &mut layout,
        "(Vollständige Name der Institution / Name, Vorname und Geburtsdatum der Person; Adresse)",
    );
    layout.spacer(1.5);

    // ---- Consent to transmission via Email/WhatsApp/Telegram/Threema (incl. risk acknowledgement) ----
    admin_block(
        &mut layout,
        &format!(
            "{we} {verb} damit einverstanden, dass personenbezogene und medizinische Daten von {our} Kind, Personalausweiskopien, Reisepasskopien, Vorbefunde, Laborbefunde, Bilddaten, ärztliche und medizinische Dokumentation und Information, Kostenvoranschläge, Rechnungen und Quittungen, Behandlungsverträge, Leistungsverträge, Arzt- und Krankenhausberichte über eine abgeschlossene oder noch andauernde Behandlung von {our} Kind per Email, WhatsApp-, Telegram- oder Threema-Messenger eingeholt und/oder übermittelt werden. {we} {verb} {us_refl} der möglichen Risiken bei der Übermittlung sensibler Daten per Email, WhatsApp-, Telegram- oder Threema-Messenger bewusst.",
            we = we,
            verb = verb,
            our = our,
            us_refl = if context.sole_guardian { "mir" } else { "uns" }
        ),
        0.0,
        1.5,
    );
    admin_block(
        &mut layout,
        &format!(
            "{we} {verb} mit der Speicherung und Verarbeitung von personenbezogenen und Gesundheitsdaten von {our} Kind im {data_system_name} einverstanden.",
            we = we,
            verb = verb,
            our = our,
            data_system_name = data_system_name
        ),
        0.0,
        1.5,
    );

    // ---- Revocation + retention ----
    admin_block(
        &mut layout,
        "Die Einwilligung ist freiwillig und kann jederzeit ohne Angaben von Gründen schriftlich widerrufen werden, was keine Auswirkungen auf die Rechtmäßigkeit der bisherigen Verarbeitung hat. Die Verarbeitung von Personenbezogenen- und Gesundheitsdaten bleibt bis zum Zeitpunkt des Wiederrufs oder solange gesetzliche Aufbewahrungsfristen bestehen rechtmäßig.",
        0.0,
        1.5,
    );

    // ---- DSGVO information ----
    admin_block(
        &mut layout,
        &format!(
            "Die Aufklärung gemäß EU-Datenschutz-Grundverordnung (DSGVO) ist erfolgt. {we} {wurden} darüber aufgeklärt, dass {we_lower} gemäß der DSGVO ein Recht auf Auskunft, Berichtigung, Löschung oder Einschränkung der Verarbeitung von personenbezogenen Daten {our_gen} Kindes {haben}. Diese Rechte {koennen} {we_lower}{einzeln} ebenfalls jederzeit geltend machen.",
            we = we,
            wurden = if context.sole_guardian {
                "wurde"
            } else {
                "wurden"
            },
            we_lower = we_lower,
            our_gen = our_gen,
            haben = if context.sole_guardian {
                "habe"
            } else {
                "haben"
            },
            koennen = if context.sole_guardian {
                "kann"
            } else {
                "können"
            },
            einzeln = if context.sole_guardian {
                ""
            } else {
                " (zusammen oder jeder einzeln)"
            }
        ),
        0.0,
        1.5,
    );

    // ---- Electronic signature clause ----
    admin_block(
        &mut layout,
        &format!(
            "{we} {verb} damit einverstanden, dass diese Einverständniserklärung und Schweigepflichtsentbindung auch durch eine elektronische Unterschrift erteilt werden kann, die die gleiche rechtliche Gültigkeit wie eine handschriftliche Unterschrift hat. Die elektronische Unterschrift erfolgt unter der Voraussetzung, dass sie den geltenden rechtlichen Anforderungen entspricht.",
            we = we,
            verb = verb
        ),
        0.0,
        4.0,
    );

    // ---- Signature block(s) ----
    if context.sole_guardian {
        admin_block(
            &mut layout,
            "Ort, Datum: __________________________   Unterschrift: __________________________________________",
            4.0,
            0.5,
        );
        consent_caption(&mut layout, "(Personensorgeberechtigte/r / ges. Vertreter)");
    } else {
        admin_block(
            &mut layout,
            "Ort, Datum: _________________   Unterschrift: ____________________ (Personensorgeberechtigte/r 1)",
            4.0,
            2.0,
        );
        admin_block(
            &mut layout,
            "Ort, Datum: _________________   Unterschrift: ____________________ (Personensorgeberechtigte/r 2)",
            0.0,
            2.0,
        );
    }

    Ok(finalize_admin_pdf(document, layout))
}

fn consent_person_line(name: Option<&str>, birth: Option<NaiveDate>) -> String {
    let name = name
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("___________________________________");
    let birth = birth
        .map(|value| value.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|| "________________".to_string());
    format!("{name}, geb. am {birth}")
}

fn apply_bank_overrides(agency: &mut AgencyContractSettings, bindings: &DocumentBindingOverrides) {
    for (slot, value) in [
        (&mut agency.bank_holder, &bindings.bank_holder),
        (&mut agency.bank_name, &bindings.bank_name),
        (&mut agency.bank_swift, &bindings.bank_swift),
        (&mut agency.bank_iban, &bindings.bank_iban),
    ] {
        if let Some(value) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            *slot = Some(value.to_string());
        }
    }
}

fn payer_block_from_bindings(bindings: &DocumentBindingOverrides) -> DocPartyBlock {
    DocPartyBlock {
        name: bindings.payer_name.clone().unwrap_or_default(),
        title: None,
        salutation: bindings.payer_salutation.clone(),
        first_name: None,
        last_name: None,
        birth_date: bindings.payer_birth_date,
        street: bindings.payer_street.clone(),
        zip: bindings.payer_zip.clone(),
        city: bindings.payer_city.clone(),
        country: bindings.payer_country.clone(),
        email: bindings.payer_email.clone(),
        phone: None,
    }
}

/// Parse the first monetary amount from a free-text value, accepting German
/// formatting ("1.234,56 EUR", "999,00 €", "100,00 EUR/Stunde").
fn parse_eur_amount(value: &str) -> Option<f64> {
    let mut cleaned = String::new();
    for ch in value.chars() {
        if ch.is_ascii_digit() || ch == ',' || ch == '.' {
            cleaned.push(ch);
        } else if !cleaned.is_empty() {
            break;
        }
    }
    let cleaned = cleaned.trim_matches(|c| c == ',' || c == '.');
    if cleaned.is_empty() {
        return None;
    }
    let normalized = if cleaned.contains(',') {
        cleaned.replace('.', "").replace(',', ".")
    } else {
        cleaned.to_string()
    };
    normalized.parse::<f64>().ok()
}

/// Parse a value only when the complete input is one monetary amount. Free text
/// rates and ranges ("100 EUR/Stunde", "100 - 1000 EUR") intentionally fail so
/// the document renderer can preserve them verbatim.
fn parse_single_eur_amount(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    let mut numeric_end = 0;
    for (index, ch) in trimmed.char_indices() {
        if ch.is_ascii_digit() || ch == ',' || ch == '.' {
            numeric_end = index + ch.len_utf8();
        } else {
            break;
        }
    }
    if numeric_end == 0 {
        return None;
    }
    let suffix = trimmed[numeric_end..].trim();
    if !matches!(suffix, "" | "EUR" | "€") {
        return None;
    }
    parse_eur_amount(&trimmed[..numeric_end])
}

/// Gendered salutation ("Herr"/"Frau") for legal documents. Returns None for
/// diverse/unknown gender so callers can omit it rather than print a placeholder.
fn doc_salutation(gender: &str) -> Option<String> {
    match gender {
        "male" => Some("Herr".to_string()),
        "female" => Some("Frau".to_string()),
        _ => None,
    }
}

/// German currency formatting with thousands grouping: 1234.5 -> "1.234,50 EUR".
fn format_eur(value: f64) -> String {
    let cents = (value.abs() * 100.0).round() as u64;
    let euros = cents / 100;
    let frac = cents % 100;
    let mut grouped = String::new();
    let digits = euros.to_string();
    let len = digits.len();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (len - i).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    let sign = if value < 0.0 { "-" } else { "" };
    format!("{sign}{grouped},{frac:02} EUR")
}

/// Format a raw monetary string (e.g. a Postgres NUMERIC ::TEXT "2698.00" or a
/// German "2.698,00") into "2.698,00 EUR". Returns the trimmed input unchanged
/// when it cannot be parsed (so already-formatted free text is preserved).
fn fmt_money_de(raw: &str) -> String {
    match parse_eur_amount(raw) {
        Some(amount) => format_eur(amount),
        None => raw.trim().to_string(),
    }
}

/// Best-effort net/VAT(19%)/gross totals summed from manual service lines.
fn compute_line_item_totals(
    items: &[GeneratedContractLineItem],
) -> Option<(String, String, String)> {
    let mut net = 0.0_f64;
    for item in items {
        if let Some(amount) = parse_eur_amount(&item.line_gross) {
            net += amount;
        } else if let Some(unit_price) = parse_eur_amount(&item.unit_price) {
            let quantity = parse_eur_amount(&item.quantity)
                .filter(|value| *value > 0.0)
                .unwrap_or(1.0);
            net += unit_price * quantity;
        }
    }
    if net <= 0.0 {
        return None;
    }
    let vat = net * 0.19;
    Some((format_eur(net), format_eur(vat), format_eur(net + vat)))
}

fn service_lines_to_items(lines: &[ServiceLineInput]) -> Vec<GeneratedContractLineItem> {
    lines
        .iter()
        .filter(|line| !line.description.trim().is_empty())
        .map(|line| GeneratedContractLineItem {
            description: line.description.trim().to_string(),
            quantity: line.quantity.clone().unwrap_or_default(),
            unit_price: line.fee.clone().unwrap_or_default(),
            line_gross: line.line_total.clone().unwrap_or_default(),
            vat_rate: None,
            notes: line
                .note
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToOwned::to_owned),
        })
        .collect()
}

struct OrderQuoteSummary {
    quote_number: Option<String>,
    total_net: Option<String>,
    total_vat: Option<String>,
    total_gross: Option<String>,
    line_items: Vec<GeneratedContractLineItem>,
}

#[derive(Default)]
struct GeneratedOrderMetadata {
    order_date: Option<NaiveDate>,
    contract_date: Option<NaiveDate>,
    contract_number: Option<String>,
    order_sequence: i64,
}

#[derive(Default)]
struct GeneratedAppointmentScope {
    clinics: Vec<ClinicInput>,
    first_date: Option<NaiveDate>,
    last_date: Option<NaiveDate>,
    specialties: Option<String>,
    examination_weeks: Option<String>,
}

async fn load_generated_order_metadata(
    state: &AppState,
    order_id: Option<Uuid>,
) -> Result<GeneratedOrderMetadata, axum::response::Response> {
    let Some(order_id) = order_id else {
        return Ok(GeneratedOrderMetadata {
            order_sequence: 1,
            ..Default::default()
        });
    };
    let row = sqlx::query(
        r#"SELECT COALESCE(o.signed_at::date, o.created_at::date) AS order_date,
                  COALESCE(fc.signed_at::date, fc.valid_from) AS contract_date,
                  NULLIF(BTRIM(fc.contract_number), '') AS contract_number,
                  COALESCE((
                      SELECT COUNT(*)::BIGINT
                      FROM orders sibling
                      WHERE sibling.contract_id = o.contract_id
                        AND (
                            sibling.created_at < o.created_at
                            OR (sibling.created_at = o.created_at AND sibling.id <= o.id)
                        )
                  ), 1) AS order_sequence
           FROM orders o
           LEFT JOIN framework_contracts fc ON fc.id = o.contract_id
           WHERE o.id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, order_id = %order_id, "load generated order metadata");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load order document context",
        )
    })?;

    Ok(row
        .map(|row| GeneratedOrderMetadata {
            order_date: row
                .try_get::<Option<NaiveDate>, _>("order_date")
                .ok()
                .flatten(),
            contract_date: row
                .try_get::<Option<NaiveDate>, _>("contract_date")
                .ok()
                .flatten(),
            contract_number: row
                .try_get::<Option<String>, _>("contract_number")
                .ok()
                .flatten(),
            order_sequence: row.try_get::<i64, _>("order_sequence").unwrap_or(1).max(1),
        })
        .unwrap_or(GeneratedOrderMetadata {
            order_sequence: 1,
            ..Default::default()
        }))
}

async fn load_generated_appointment_scope(
    state: &AppState,
    patient_id: Uuid,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
) -> Result<GeneratedAppointmentScope, axum::response::Response> {
    if order_id.is_none() && appointment_id.is_none() {
        return Ok(GeneratedAppointmentScope::default());
    }

    let rows = sqlx::query(
        r#"SELECT a.date, a.title, a.location,
                  p.name AS provider_name,
                  p.address_street, p.address_zip, p.address_city, p.address_country,
                  COALESCE(NULLIF(trim(pd.fachbereich), ''),
                           NULLIF(trim(p.fachbereich), ''),
                           NULLIF(trim(a.category), '')) AS specialty
           FROM appointments a
           LEFT JOIN providers p ON p.id = a.provider_id
           LEFT JOIN provider_doctors pd ON pd.id = a.doctor_id
           WHERE a.patient_id = $1
             AND a.status <> 'cancelled'
             AND (
                 ($2::UUID IS NOT NULL AND a.order_id = $2)
                 OR ($2::UUID IS NULL AND $3::UUID IS NOT NULL AND a.id = $3)
             )
           ORDER BY a.date, a.time_start NULLS LAST, a.created_at"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, patient_id = %patient_id, ?order_id, ?appointment_id, "load generated appointment scope");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load appointment document context",
        )
    })?;

    let mut dates = BTreeSet::new();
    let mut specialties = BTreeSet::new();
    let mut clinics = BTreeMap::<String, Option<String>>::new();
    for row in rows {
        if let Ok(date) = row.try_get::<NaiveDate, _>("date") {
            dates.insert(date);
        }
        if let Some(specialty) = row
            .try_get::<Option<String>, _>("specialty")
            .ok()
            .flatten()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            specialties.insert(specialty);
        }

        let provider_name = row
            .try_get::<Option<String>, _>("provider_name")
            .ok()
            .flatten()
            .or_else(|| row.try_get::<String, _>("title").ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if let Some(provider_name) = provider_name {
            let street = row
                .try_get::<Option<String>, _>("address_street")
                .ok()
                .flatten()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let zip = row
                .try_get::<Option<String>, _>("address_zip")
                .ok()
                .flatten()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let city = row
                .try_get::<Option<String>, _>("address_city")
                .ok()
                .flatten()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let country = row
                .try_get::<Option<String>, _>("address_country")
                .ok()
                .flatten()
                .map(|value| german_document_country(&value))
                .filter(|value| !value.is_empty());
            let zip_city = match (zip, city) {
                (Some(zip), Some(city)) => Some(format!("{zip} {city}")),
                (Some(zip), None) => Some(zip),
                (None, Some(city)) => Some(city),
                (None, None) => None,
            };
            let address_parts = [street, zip_city, country]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>();
            let address = if address_parts.is_empty() {
                row.try_get::<Option<String>, _>("location")
                    .ok()
                    .flatten()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            } else {
                Some(address_parts.join(", "))
            };
            clinics.entry(provider_name).or_insert(address);
        }
    }

    let first_date = dates.first().copied();
    let last_date = dates.last().copied();
    let weeks = dates
        .iter()
        .skip(1)
        .map(|date| {
            let week = date.iso_week();
            format!("{}/{}", week.week(), week.year())
        })
        .collect::<BTreeSet<_>>();
    Ok(GeneratedAppointmentScope {
        clinics: clinics
            .into_iter()
            .map(|(name, address)| ClinicInput { name, address })
            .collect(),
        first_date,
        last_date,
        specialties: (!specialties.is_empty())
            .then(|| specialties.into_iter().collect::<Vec<_>>().join(", ")),
        examination_weeks: (!weeks.is_empty())
            .then(|| weeks.into_iter().collect::<Vec<_>>().join(", ")),
    })
}

async fn load_order_quote_summary(
    state: &AppState,
    order_id: Uuid,
) -> Result<Option<OrderQuoteSummary>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT quote_number, total_net::TEXT AS total_net,
                  total_vat::TEXT AS total_vat, total_gross::TEXT AS total_gross,
                  line_items
           FROM quotes
           WHERE order_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, order_id = %order_id, "load order quote summary");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load quote context",
        )
    })?;

    Ok(row.map(|row| {
        let line_items = row
            .try_get::<Option<Value>, _>("line_items")
            .ok()
            .flatten()
            .map(|value| parse_quote_line_items(&value))
            .unwrap_or_default();
        OrderQuoteSummary {
            quote_number: row
                .try_get::<Option<String>, _>("quote_number")
                .ok()
                .flatten(),
            total_net: row
                .try_get::<Option<String>, _>("total_net")
                .ok()
                .flatten()
                .map(|v| fmt_money_de(&v)),
            total_vat: row
                .try_get::<Option<String>, _>("total_vat")
                .ok()
                .flatten()
                .map(|v| fmt_money_de(&v)),
            total_gross: row
                .try_get::<Option<String>, _>("total_gross")
                .ok()
                .flatten()
                .map(|v| fmt_money_de(&v)),
            line_items,
        }
    }))
}

/// Auto-bind the third-party payer ("Kostenübernehmer") from the most recent
/// invoice payer contact for the order (preferred) or the patient.
async fn load_invoice_payer(
    state: &AppState,
    order_id: Option<Uuid>,
    patient_id: Uuid,
) -> Result<Option<DocPartyBlock>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT payer_contact_name, payer_contact_email, payer_contact_phone
           FROM invoices
           WHERE patient_id = $2
             AND payer_contact_name IS NOT NULL
             AND length(trim(payer_contact_name)) > 0
           ORDER BY ($1::uuid IS NOT NULL AND order_id = $1) DESC, created_at DESC
           LIMIT 1"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load invoice payer");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load payer context",
        )
    })?;

    Ok(row.and_then(|row| {
        let name = row
            .try_get::<Option<String>, _>("payer_contact_name")
            .ok()
            .flatten()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())?;
        Some(DocPartyBlock {
            name,
            email: row
                .try_get::<Option<String>, _>("payer_contact_email")
                .ok()
                .flatten(),
            phone: row
                .try_get::<Option<String>, _>("payer_contact_phone")
                .ok()
                .flatten(),
            ..DocPartyBlock::default()
        })
    }))
}

/// Merge a manually entered payer with an auto-bound invoice payer: manual
/// fields win, invoice fills the rest. Returns the manual block unchanged when
/// no invoice payer exists.
fn merge_payer(manual: DocPartyBlock, invoice: Option<DocPartyBlock>) -> DocPartyBlock {
    let Some(invoice) = invoice else {
        return manual;
    };
    DocPartyBlock {
        name: if manual.name.trim().is_empty() {
            invoice.name
        } else {
            manual.name
        },
        title: manual.title,
        salutation: manual.salutation,
        first_name: manual.first_name.or(invoice.first_name),
        last_name: manual.last_name.or(invoice.last_name),
        birth_date: manual.birth_date,
        street: manual.street,
        zip: manual.zip,
        city: manual.city,
        country: manual.country,
        email: manual.email.or(invoice.email),
        phone: manual.phone.or(invoice.phone),
    }
}

async fn list_documents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<DocumentListQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let search = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let patient_id =
        match parse_required_uuid_query_filter(query.patient_id.as_deref(), "patient_id") {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let lead_id = match parse_required_uuid_query_filter(query.lead_id.as_deref(), "lead_id") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let (order_id, order_lookup) = parse_uuid_or_text_query_filter(query.order_id.as_deref());
    let (appointment_id, appointment_lookup) =
        parse_uuid_or_text_query_filter(query.appointment_id.as_deref());
    let date_from = match query
        .date_from
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => match NaiveDate::parse_from_str(value, "%Y-%m-%d") {
            Ok(value) => Some(value),
            Err(_) => return err(StatusCode::BAD_REQUEST, "Invalid date_from filter"),
        },
        None => None,
    };
    let date_to = match query
        .date_to
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => match NaiveDate::parse_from_str(value, "%Y-%m-%d") {
            Ok(value) => Some(value),
            Err(_) => return err(StatusCode::BAD_REQUEST, "Invalid date_to filter"),
        },
        None => None,
    };
    let klinik = query
        .klinik
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let ursprung = query
        .ursprung
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let document_direction = match normalize_document_direction(query.document_direction.as_deref())
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let document_variant = match normalize_document_variant(query.document_variant.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let access_category = match normalize_document_access_category(query.access_category.as_deref())
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let financial_status =
        match normalize_document_financial_status(query.financial_status.as_deref()) {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    let rows = match sqlx::query(
        r#"SELECT d.id, d.document_number, d.patient_id, d.lead_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.storage_key, d.klinik, d.ursprung,
                  d.document_direction, d.document_variant, d.document_language, d.access_category,
                  d.document_date, d.source_person, d.source_institution, d.addressee_person,
                  d.addressee_institution, d.financial_status, d.payment_due_date, d.payment_date,
                  d.payment_method, d.generated_template_id, d.generated_bindings,
                  d.generated_manual_text,
                  d.signed_at, d.signed_by, d.compliance_kind,
                  d.notes, d.version_root_document_id, d.replaces_document_id,
                  d.version_number, d.uploaded_by, d.created_at, d.updated_at,
                  d.file_deleted_at, d.file_deleted_by, d.file_delete_reason,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  trim(concat_ws(' ', l.first_name, l.last_name)) AS lead_name,
                  o.order_number,
                  a.title AS appointment_title,
                  u.name AS uploaded_by_name,
                  deleter.name AS file_deleted_by_name,
                  COALESCE((SELECT count(*)::bigint FROM document_shares ds WHERE ds.document_id = d.id AND ds.revoked_at IS NULL), 0) AS share_count,
                  COALESCE((SELECT count(*)::bigint FROM documents dv WHERE dv.version_root_document_id = d.version_root_document_id), 1) AS version_count,
                  (SELECT dv.id FROM documents dv WHERE dv.replaces_document_id = d.id ORDER BY dv.created_at DESC LIMIT 1) AS superseded_by_document_id,
                  NOT EXISTS(
                    SELECT 1 FROM documents dv WHERE dv.replaces_document_id = d.id
                  ) AS is_latest_version,
                  EXISTS(
                    SELECT 1 FROM document_shares ds
                    WHERE ds.document_id = d.id
                      AND ds.shared_with_user_id = $13
                      AND ds.revoked_at IS NULL
                  ) AS shared_to_current,
                  EXISTS(
                    SELECT 1
                    FROM patient_assignments pa
                    JOIN users portal_user ON portal_user.id = pa.user_id
                    WHERE pa.patient_id = d.patient_id
                      AND pa.revoked_at IS NULL
                      AND portal_user.is_active = true
                      AND portal_user.role = 'patient'
                  ) AS has_active_patient_portal_user,
                  provider_context.provider_context_ids
           FROM documents d
           LEFT JOIN patients p ON p.id = d.patient_id
           LEFT JOIN leads l ON l.id = d.lead_id
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN appointments a ON a.id = d.appointment_id
           LEFT JOIN users u ON u.id = d.uploaded_by
           LEFT JOIN users deleter ON deleter.id = d.file_deleted_by
           LEFT JOIN LATERAL (
                SELECT COALESCE(
                    array_agg(DISTINCT provider_id) FILTER (WHERE provider_id IS NOT NULL),
                    ARRAY[]::uuid[]
                ) AS provider_context_ids
                FROM (
                    SELECT appointment.provider_id
                    FROM appointments appointment
                    WHERE d.appointment_id IS NOT NULL
                      AND appointment.id = d.appointment_id

                    UNION

                    SELECT leistung.provider_id
                    FROM order_leistungen leistung
                    WHERE d.order_id IS NOT NULL
                      AND leistung.order_id = d.order_id

                    UNION

                    SELECT order_appointment.provider_id
                    FROM appointments order_appointment
                    WHERE d.order_id IS NOT NULL
                      AND order_appointment.order_id = d.order_id
                ) provider_context_source
           ) provider_context ON TRUE
           WHERE ($1::text IS NULL
                  OR de_normalize(concat_ws(' ',
                       d.document_number, d.auto_name, d.original_filename, d.category, d.art,
                       d.generated_template_id, d.notes, d.klinik, d.mime_type,
                       d.document_direction, d.document_variant, d.document_language,
                       d.access_category, d.source_person, d.source_institution,
                       d.addressee_person, d.addressee_institution, d.financial_status,
                       p.patient_id, p.first_name, p.last_name,
                       l.first_name, l.last_name, l.email, l.phone,
                       o.order_number, a.title,
                       u.name, deleter.name
                     )) LIKE '%' || de_normalize($1) || '%')
             AND ($2::uuid IS NULL OR d.patient_id = $2)
             AND ($3::uuid IS NULL OR d.order_id = $3)
             AND ($4::uuid IS NULL OR d.appointment_id = $4)
             AND ($5::text IS NULL OR d.status = $5)
             AND ($6::text IS NULL OR d.visibility = $6)
             AND ($7::text IS NULL OR d.art = $7)
             AND ($8::text IS NULL OR d.category = $8)
             AND ($9::date IS NULL OR d.created_at::date >= $9)
             AND ($10::date IS NULL OR d.created_at::date <= $10)
             AND ($11::text IS NULL OR COALESCE(d.klinik, '') ILIKE '%' || $11 || '%')
             AND ($12::text IS NULL OR COALESCE(d.ursprung, '') ILIKE '%' || $12 || '%')
             AND ($14::text IS NULL OR COALESCE(o.order_number, '') ILIKE '%' || $14 || '%')
             AND ($15::text IS NULL OR COALESCE(a.title, '') ILIKE '%' || $15 || '%')
             AND ($16::text IS NULL OR d.document_direction = $16)
             AND ($17::text IS NULL OR d.document_variant = $17)
             AND ($18::text IS NULL OR d.access_category = $18)
             AND ($19::text IS NULL OR d.financial_status = $19)
             AND ($20::uuid IS NULL OR d.lead_id = $20)
           ORDER BY d.created_at DESC
           LIMIT 300"#,
    )
    .bind(search)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(query.status.as_deref())
    .bind(query.visibility.as_deref())
    .bind(query.art.as_deref())
    .bind(query.category.as_deref())
    .bind(date_from)
    .bind(date_to)
    .bind(klinik)
    .bind(ursprung)
    .bind(auth.user_id)
    .bind(order_lookup)
    .bind(appointment_lookup)
    .bind(document_direction.as_deref())
    .bind(document_variant.as_deref())
    .bind(access_category.as_deref())
    .bind(financial_status.as_deref())
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "list documents");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load documents");
        }
    };

    let items: Vec<_> = rows
        .iter()
        .filter(|row| can_view_document_row(&auth, row, &assignment_set))
        .map(document_json)
        .collect();

    Json(items).into_response()
}

async fn list_document_intake_queue(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let rows = match sqlx::query(
        r#"SELECT d.id, d.document_number, d.patient_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.storage_key, d.klinik, d.ursprung,
                  d.document_direction, d.document_variant, d.document_language, d.access_category,
                  d.document_date, d.source_person, d.source_institution, d.addressee_person,
                  d.addressee_institution, d.financial_status, d.payment_due_date, d.payment_date,
                  d.payment_method, d.generated_template_id, d.generated_bindings,
                  d.generated_manual_text,
                  d.notes, d.version_root_document_id, d.replaces_document_id,
                  d.version_number, d.uploaded_by, d.created_at, d.updated_at,
                  d.file_deleted_at, d.file_deleted_by, d.file_delete_reason,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  o.order_number,
                  a.title AS appointment_title,
                  u.name AS uploaded_by_name,
                  u.role AS uploaded_by_role,
                  deleter.name AS file_deleted_by_name,
                  COALESCE((SELECT count(*)::bigint FROM document_shares ds WHERE ds.document_id = d.id AND ds.revoked_at IS NULL), 0) AS share_count,
                  COALESCE((SELECT count(*)::bigint FROM documents dv WHERE dv.version_root_document_id = d.version_root_document_id), 1) AS version_count,
                  (SELECT dv.id FROM documents dv WHERE dv.replaces_document_id = d.id ORDER BY dv.created_at DESC LIMIT 1) AS superseded_by_document_id,
                  NOT EXISTS(
                    SELECT 1 FROM documents dv WHERE dv.replaces_document_id = d.id
                  ) AS is_latest_version,
                  EXISTS(
                    SELECT 1 FROM document_shares ds
                    WHERE ds.document_id = d.id
                      AND ds.shared_with_user_id = $1
                      AND ds.revoked_at IS NULL
                  ) AS shared_to_current,
                  EXISTS(
                    SELECT 1
                    FROM patient_assignments pa
                    JOIN users portal_user ON portal_user.id = pa.user_id
                    WHERE pa.patient_id = d.patient_id
                      AND pa.revoked_at IS NULL
                      AND portal_user.is_active = true
                      AND portal_user.role = 'patient'
                  ) AS has_active_patient_portal_user
           FROM documents d
           LEFT JOIN patients p ON p.id = d.patient_id
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN appointments a ON a.id = d.appointment_id
           LEFT JOIN users u ON u.id = d.uploaded_by
           LEFT JOIN users deleter ON deleter.id = d.file_deleted_by
           WHERE d.status <> 'archived'
             AND (
                COALESCE(d.category, '') = ''
                OR d.category = 'portal_upload'
                OR (d.ursprung = 'interpreter_upload' AND d.status = 'draft')
                OR d.art IN (
                    'document',
                    'uploaded_document',
                    'patient_general_upload',
                    'patient_medical_upload',
                    'patient_admin_upload'
                )
                OR d.ursprung = 'patient_portal'
             )
           ORDER BY d.created_at DESC
           LIMIT 200"#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "list document intake queue");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load document intake queue",
            );
        }
    };

    let items: Vec<_> = rows
        .iter()
        .filter(|row| can_review_document_intake_row(&auth, row, &assignment_set))
        .filter(|row| is_document_intake_queue_candidate(row))
        .map(document_json)
        .collect();

    Json(items).into_response()
}

async fn get_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    Json(document_json(&row)).into_response()
}

async fn get_document_text_extraction(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    Json(document_text_extraction_json(&row)).into_response()
}

async fn run_document_text_extraction(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let Some(storage_key) = row
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default()
    else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document file is not available for text extraction",
        );
    };

    let result = match extract_document_text_and_store(
        &state,
        id,
        row.try_get::<Option<String>, _>("original_filename")
            .unwrap_or_default()
            .as_deref(),
        row.try_get::<Option<String>, _>("mime_type")
            .unwrap_or_default()
            .as_deref(),
        storage_key.as_str(),
        auth.user_id,
    )
    .await
    {
        Ok(result) => result,
        Err(resp) => return resp,
    };

    state.audit_sender.try_send(audit::domain_event(
        "run_document_text_extraction",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({
            "result": match result {
                DocumentTextExtractionResult::Completed { method, .. } => json!({ "status": "completed", "method": method }),
                DocumentTextExtractionResult::Unsupported { method, message } => json!({ "status": "unsupported", "method": method, "message": message }),
                DocumentTextExtractionResult::Failed { method, message } => json!({ "status": "failed", "method": method, "message": message }),
            }
        }),
    ));

    let fresh_row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    Json(document_text_extraction_json(&fresh_row)).into_response()
}

async fn list_document_versions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let version_root_document_id = row
        .try_get::<Uuid, _>("version_root_document_id")
        .unwrap_or(id);

    let rows = match sqlx::query(
        r#"SELECT d.id, d.document_number, d.patient_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.storage_key, d.klinik, d.ursprung,
                  d.document_direction, d.document_variant, d.document_language, d.access_category,
                  d.document_date, d.source_person, d.source_institution, d.addressee_person,
                  d.addressee_institution, d.financial_status, d.payment_due_date, d.payment_date,
                  d.payment_method, d.generated_template_id, d.generated_bindings,
                  d.generated_manual_text,
                  d.notes, d.version_root_document_id, d.replaces_document_id,
                  d.version_number, d.uploaded_by, d.created_at, d.updated_at,
                  d.file_deleted_at, d.file_deleted_by, d.file_delete_reason,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  o.order_number,
                  a.title AS appointment_title,
                  u.name AS uploaded_by_name,
                  deleter.name AS file_deleted_by_name,
                  COALESCE((SELECT count(*)::bigint FROM document_shares ds WHERE ds.document_id = d.id AND ds.revoked_at IS NULL), 0) AS share_count,
                  COALESCE((SELECT count(*)::bigint FROM documents dv WHERE dv.version_root_document_id = d.version_root_document_id), 1) AS version_count,
                  (SELECT dv.id FROM documents dv WHERE dv.replaces_document_id = d.id ORDER BY dv.created_at DESC LIMIT 1) AS superseded_by_document_id,
                  NOT EXISTS(
                    SELECT 1 FROM documents dv WHERE dv.replaces_document_id = d.id
                  ) AS is_latest_version,
                  EXISTS(
                    SELECT 1 FROM document_shares ds
                    WHERE ds.document_id = d.id
                      AND ds.shared_with_user_id = $2
                      AND ds.revoked_at IS NULL
                  ) AS shared_to_current,
                  EXISTS(
                    SELECT 1
                    FROM patient_assignments pa
                    JOIN users portal_user ON portal_user.id = pa.user_id
                    WHERE pa.patient_id = d.patient_id
                      AND pa.revoked_at IS NULL
                      AND portal_user.is_active = true
                      AND portal_user.role = 'patient'
                  ) AS has_active_patient_portal_user
           FROM documents d
           LEFT JOIN patients p ON p.id = d.patient_id
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN appointments a ON a.id = d.appointment_id
           LEFT JOIN users u ON u.id = d.uploaded_by
           LEFT JOIN users deleter ON deleter.id = d.file_deleted_by
           WHERE d.version_root_document_id = $1
           ORDER BY d.version_number DESC, d.created_at DESC"#,
    )
    .bind(version_root_document_id)
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, "list document versions");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load document versions",
            );
        }
    };

    let items: Vec<_> = rows
        .iter()
        .filter(|version_row| can_view_document_row(&auth, version_row, &assignment_set))
        .map(document_json)
        .collect();

    Json(items).into_response()
}

async fn list_document_translation_request_queue(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<DocumentTranslationQueueQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let statuses = match parse_translation_queue_statuses(query.status.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let source = match query
        .source
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        Some("staff") => Some("staff"),
        Some("patient_portal") => Some("patient_portal"),
        Some(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid translation request source",
            );
        }
        None => None,
    };
    let can_view_all = matches!(auth.role, Role::Ceo | Role::CeoAssistant | Role::Billing);
    let status_sql = statuses
        .iter()
        .map(|status| format!("'{status}'"))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        r#"SELECT dtr.id, dtr.document_id, dtr.patient_id, dtr.requested_language,
                  dtr.status, dtr.note, dtr.source_language, dtr.source_text,
                  dtr.translated_text, dtr.requested_by, dtr.translated_by,
                  dtr.assigned_to, dtr.assigned_at, dtr.translated_document_id,
                  dtr.request_source, dtr.requested_at, dtr.completed_at,
                  dtr.translated_at, dtr.updated_at,
                  requester.name AS requested_by_name,
                  assignee.name AS assigned_to_name,
                  translator.name AS translated_by_name,
                  translated_document.auto_name AS translated_document_name,
                  d.auto_name AS document_name,
                  d.art AS document_art,
                  d.category AS document_category,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name
           FROM document_translation_requests dtr
           JOIN documents d ON d.id = dtr.document_id
           LEFT JOIN patients p ON p.id = dtr.patient_id
           LEFT JOIN users requester ON requester.id = dtr.requested_by
           LEFT JOIN users assignee ON assignee.id = dtr.assigned_to
           LEFT JOIN users translator ON translator.id = dtr.translated_by
           LEFT JOIN documents translated_document ON translated_document.id = dtr.translated_document_id
           WHERE dtr.status IN ({status_sql})
             AND ($1::text IS NULL OR dtr.request_source = $1)
             AND ($2::uuid IS NULL OR dtr.patient_id = $2)
             AND (
                $3::boolean = true
                OR EXISTS (
                    SELECT 1
                    FROM patient_assignments pa
                    WHERE pa.patient_id = dtr.patient_id
                      AND pa.user_id = $4
                      AND pa.revoked_at IS NULL
                )
             )
           ORDER BY dtr.requested_at DESC, dtr.created_at DESC
           LIMIT 100"#
    );

    match sqlx::query(&sql)
        .bind(source)
        .bind(query.patient_id)
        .bind(can_view_all)
        .bind(auth.user_id)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(document_translation_request_json)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list document translation queue");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load translation queue",
            )
        }
    }
}

async fn list_document_translation_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let rows = match sqlx::query(
        r#"SELECT dtr.id, dtr.document_id, dtr.patient_id, dtr.requested_language,
                  dtr.status, dtr.note, dtr.source_language, dtr.source_text,
                  dtr.translated_text, dtr.requested_by, dtr.translated_by,
                  dtr.assigned_to, dtr.assigned_at, dtr.translated_document_id,
                  dtr.request_source, dtr.requested_at, dtr.completed_at, dtr.translated_at, dtr.updated_at,
                  requester.name AS requested_by_name,
                  assignee.name AS assigned_to_name,
                  translator.name AS translated_by_name,
                  translated_document.auto_name AS translated_document_name
           FROM document_translation_requests dtr
           LEFT JOIN users requester ON requester.id = dtr.requested_by
           LEFT JOIN users assignee ON assignee.id = dtr.assigned_to
           LEFT JOIN users translator ON translator.id = dtr.translated_by
           LEFT JOIN documents translated_document ON translated_document.id = dtr.translated_document_id
           WHERE dtr.document_id = $1
           ORDER BY dtr.requested_at DESC, dtr.created_at DESC"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, "list document translation requests");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load translation requests",
            );
        }
    };

    Json(
        rows.into_iter()
            .map(|request_row| document_translation_request_json(&request_row))
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn create_document_translation_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateDocumentTranslationRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let Some(patient_id) = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default()
    else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Translation requests require a patient-linked document",
        );
    };

    let Some(requested_language) = normalize_document_language(Some(&body.requested_language))
    else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown translation target language",
        );
    };
    if requested_language != "de" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only German translation target language is supported",
        );
    }
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let prefilled_source_text = row
        .try_get::<Option<String>, _>("extracted_text")
        .unwrap_or_default();

    let request_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO document_translation_requests (
                document_id, patient_id, requested_language, status, requested_by, note, source_text
           ) VALUES (
                $1, $2, $3, 'pending', $4, $5, $6
           )
           RETURNING id"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(requested_language)
    .bind(auth.user_id)
    .bind(note)
    .bind(prefilled_source_text.as_deref())
    .fetch_one(&state.db)
    .await
    {
        Ok(request_id) => request_id,
        Err(sqlx::Error::Database(db_error))
            if db_error.constraint() == Some("idx_document_translation_requests_active") =>
        {
            return err(
                StatusCode::CONFLICT,
                "An active translation request already exists for this language",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, "create document translation request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create translation request",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "create_document_translation_request",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({
            "request_id": request_id,
            "requested_language": requested_language,
            "patient_id": patient_id,
        }),
    ));

    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        "document.translation_requested",
        id,
        json!({
            "request_id": request_id,
            "requested_language": requested_language,
            "patient_id": patient_id,
        }),
    )
    .await;

    let response_row = match sqlx::query(
        r#"SELECT dtr.id, dtr.document_id, dtr.patient_id, dtr.requested_language,
                  dtr.status, dtr.note, dtr.source_language, dtr.source_text,
                  dtr.translated_text, dtr.requested_by, dtr.translated_by,
                  dtr.assigned_to, dtr.assigned_at, dtr.translated_document_id,
                  dtr.request_source, dtr.requested_at, dtr.completed_at, dtr.translated_at, dtr.updated_at,
                  requester.name AS requested_by_name,
                  assignee.name AS assigned_to_name,
                  translator.name AS translated_by_name,
                  translated_document.auto_name AS translated_document_name
           FROM document_translation_requests dtr
           LEFT JOIN users requester ON requester.id = dtr.requested_by
           LEFT JOIN users assignee ON assignee.id = dtr.assigned_to
           LEFT JOIN users translator ON translator.id = dtr.translated_by
           LEFT JOIN documents translated_document ON translated_document.id = dtr.translated_document_id
           WHERE dtr.id = $1"#,
    )
    .bind(request_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, request_id = %request_id, "reload document translation request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load translation request",
            );
        }
    };

    Json(document_translation_request_json(&response_row)).into_response()
}

async fn update_document_translation_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(request_id): Path<Uuid>,
    Json(body): Json<UpdateDocumentTranslationRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return resp;
    }

    let Some(next_status) = normalize_translation_request_status(&body.status) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid translation request status",
        );
    };

    let request_row = match sqlx::query(
        r#"SELECT dtr.id, dtr.document_id, dtr.patient_id, dtr.status, dtr.requested_language,
                  dtr.source_text, dtr.translated_text, dtr.assigned_to,
                  dtr.translated_document_id, dtr.request_source
           FROM document_translation_requests dtr
           WHERE dtr.id = $1"#,
    )
    .bind(request_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Translation request not found"),
        Err(e) => {
            tracing::error!(error = %e, request_id = %request_id, "load document translation request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load translation request",
            );
        }
    };

    let document_id = request_row
        .try_get::<Uuid, _>("document_id")
        .unwrap_or_else(|_| Uuid::nil());
    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let document_row = match fetch_document_row(&state, document_id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &document_row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let note_update = match nullable_trimmed_text(&body.note, "Invalid translation note") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let source_language_update = match nullable_translation_source_language(&body.source_language) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let source_text_update =
        match nullable_trimmed_text(&body.source_text, "Invalid translation source text") {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let translated_text_update =
        match nullable_trimmed_text(&body.translated_text, "Invalid translation translated text") {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let note = note_update.clone().flatten();
    let source_language = source_language_update.clone().flatten();
    let source_text = source_text_update.clone().flatten();
    let translated_text = translated_text_update.clone().flatten();
    let current_translated_text = request_row
        .try_get::<Option<String>, _>("translated_text")
        .unwrap_or_default();
    let next_translated_text = translated_text_update
        .clone()
        .unwrap_or_else(|| current_translated_text.clone());
    let current_status = request_row
        .try_get::<String, _>("status")
        .unwrap_or_else(|_| "pending".to_string());
    if next_status == "completed"
        && next_translated_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Completed translation requests require translated text",
        );
    }

    let assigned_to_update = match &body.assigned_to {
        NullableJsonField::Null => Some(None),
        NullableJsonField::Value(serde_json::Value::String(raw_user_id))
            if raw_user_id.trim().is_empty() =>
        {
            Some(None)
        }
        NullableJsonField::Value(serde_json::Value::String(raw_user_id)) => {
            let Ok(user_id) = Uuid::parse_str(raw_user_id.trim()) else {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid translation assignee",
                );
            };
            if user_id == Uuid::nil() {
                Some(None)
            } else {
                if let Err(resp) = validate_translation_assignee(&state, user_id).await {
                    return resp;
                }
                Some(Some(user_id))
            }
        }
        NullableJsonField::Value(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid translation assignee",
            );
        }
        NullableJsonField::Missing
            if next_status == "in_progress" && current_status != "in_progress" =>
        {
            Some(Some(auth.user_id))
        }
        NullableJsonField::Missing => None,
    };
    let assigned_to_provided = assigned_to_update.is_some();
    let assigned_to = assigned_to_update.flatten();

    let requested_language = request_row
        .try_get::<String, _>("requested_language")
        .unwrap_or_else(|_| "en".to_string());
    let request_source = request_row
        .try_get::<String, _>("request_source")
        .unwrap_or_else(|_| "staff".to_string());
    let current_translated_document_id = request_row
        .try_get::<Option<Uuid>, _>("translated_document_id")
        .unwrap_or_default();
    let translated_document_id =
        if body.create_translated_document.unwrap_or(false) && next_status == "completed" {
            match current_translated_document_id {
                Some(id) => Some(id),
                None => {
                    let translated_body = next_translated_text.clone().unwrap_or_default();
                    match create_translated_document_from_request(
                        &state,
                        auth.user_id,
                        request_id,
                        &document_row,
                        requested_language.as_str(),
                        translated_body.as_str(),
                        body.translated_document_auto_name.as_deref(),
                        request_source.as_str(),
                    )
                    .await
                    {
                        Ok(id) => Some(id),
                        Err(resp) => return resp,
                    }
                }
            }
        } else {
            None
        };

    if let Err(e) = sqlx::query(
        r#"UPDATE document_translation_requests
           SET status = $2,
               note = CASE WHEN $11 THEN $3 ELSE note END,
               source_language = CASE WHEN $12 THEN $4 ELSE source_language END,
               source_text = CASE WHEN $13 THEN $5 ELSE source_text END,
               translated_text = CASE WHEN $14 THEN $6 ELSE translated_text END,
               translated_document_id = COALESCE($8, translated_document_id),
               assigned_to = CASE WHEN $10 THEN $9 ELSE assigned_to END,
               assigned_at = CASE
                   WHEN $10 AND $9 IS NULL THEN NULL
                   WHEN $10 AND $9 IS NOT NULL AND assigned_to IS DISTINCT FROM $9 THEN now()
                   ELSE assigned_at
               END,
               translated_by = CASE
                   WHEN $12 OR $13 OR $14 OR $2 = 'completed'
                       THEN $7
                   ELSE translated_by
               END,
               translated_at = CASE
                   WHEN $12 OR $13 OR $14 OR $2 = 'completed'
                       THEN now()
                   ELSE translated_at
               END,
               completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END
           WHERE id = $1"#,
    )
    .bind(request_id)
    .bind(next_status)
    .bind(note)
    .bind(source_language)
    .bind(source_text)
    .bind(translated_text)
    .bind(auth.user_id)
    .bind(translated_document_id)
    .bind(assigned_to)
    .bind(assigned_to_provided)
    .bind(note_update.is_some())
    .bind(source_language_update.is_some())
    .bind(source_text_update.is_some())
    .bind(translated_text_update.is_some())
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, request_id = %request_id, "update document translation request");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update translation request",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "update_document_translation_request",
        Some(auth.user_id),
        "document",
        Some(document_id),
        json!({
            "request_id": request_id,
            "status": next_status,
            "assigned_to": assigned_to,
            "translated_document_id": translated_document_id,
        }),
    ));

    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        "document.translation_updated",
        document_id,
        json!({
            "request_id": request_id,
            "status": next_status,
            "assigned_to": assigned_to,
            "translated_document_id": translated_document_id,
        }),
    )
    .await;

    let response_row = match sqlx::query(
        r#"SELECT dtr.id, dtr.document_id, dtr.patient_id, dtr.requested_language,
                  dtr.status, dtr.note, dtr.source_language, dtr.source_text,
                  dtr.translated_text, dtr.requested_by, dtr.translated_by,
                  dtr.assigned_to, dtr.assigned_at, dtr.translated_document_id,
                  dtr.request_source, dtr.requested_at, dtr.completed_at, dtr.translated_at, dtr.updated_at,
                  requester.name AS requested_by_name,
                  assignee.name AS assigned_to_name,
                  translator.name AS translated_by_name,
                  translated_document.auto_name AS translated_document_name
           FROM document_translation_requests dtr
           LEFT JOIN users requester ON requester.id = dtr.requested_by
           LEFT JOIN users assignee ON assignee.id = dtr.assigned_to
           LEFT JOIN users translator ON translator.id = dtr.translated_by
           LEFT JOIN documents translated_document ON translated_document.id = dtr.translated_document_id
           WHERE dtr.id = $1"#,
    )
    .bind(request_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, request_id = %request_id, "reload updated translation request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load translation request",
            );
        }
    };

    Json(document_translation_request_json(&response_row)).into_response()
}

async fn validate_translation_assignee(
    state: &AppState,
    user_id: Uuid,
) -> Result<(), axum::response::Response> {
    let allowed = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
              SELECT 1
              FROM users
              WHERE id = $1
                AND is_active = true
                AND role IN ('ceo', 'patient_manager', 'teamlead_interpreter', 'interpreter', 'concierge')
           )"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, "validate translation assignee");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate translation assignee",
        )
    })?;

    if allowed {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Translation assignee must be an active document staff member",
        ))
    }
}

async fn create_translated_document_from_request(
    state: &AppState,
    actor_user_id: Uuid,
    request_id: Uuid,
    source_document_row: &sqlx::postgres::PgRow,
    requested_language: &str,
    translated_text: &str,
    auto_name_override: Option<&str>,
    request_source: &str,
) -> Result<Uuid, axum::response::Response> {
    let translated_text = translated_text.trim();
    if translated_text.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Translated document creation requires translated text",
        ));
    }

    let source_document_id = source_document_row
        .try_get::<Uuid, _>("id")
        .unwrap_or_else(|_| Uuid::nil());
    let patient_id = source_document_row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default();
    let order_id = source_document_row
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default();
    let appointment_id = source_document_row
        .try_get::<Option<Uuid>, _>("appointment_id")
        .unwrap_or_default();
    let source_auto_name = source_document_row
        .try_get::<String, _>("auto_name")
        .unwrap_or_else(|_| "Document".to_string());
    let is_medical = source_document_row
        .try_get::<bool, _>("is_medical")
        .unwrap_or(false);
    let auto_name = auto_name_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "Translation {} - {}",
                requested_language.to_uppercase(),
                source_auto_name
            )
        });
    let original_filename = format!(
        "translation-{}-{}.txt",
        request_id.simple(),
        requested_language.trim().to_lowercase()
    );
    let data = translated_text.as_bytes().to_vec();
    let notes = format!("Generated from translation request {request_id}");
    let persist_input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id,
        lead_id: None,
        order_id,
        appointment_id,
        auto_name: auto_name.as_str(),
        original_filename: original_filename.as_str(),
        art: "translated_document",
        category: Some("translation"),
        status: "active",
        visibility: "internal",
        is_medical,
        mime_type: "text/plain",
        klinik: None,
        ursprung: Some("translation_request"),
        notes: Some(notes.as_str()),
        document_direction: Some("outgoing"),
        document_variant: Some("translation"),
        document_language: Some(requested_language),
        access_category: Some(infer_document_access_category(
            Some("translation"),
            "translated_document",
            is_medical,
            "internal",
        )),
        document_date: Some(chrono::Utc::now().date_naive()),
        source_person: Some("translation_request"),
        source_institution: None,
        addressee_person: None,
        addressee_institution: None,
        financial_status: None,
        payment_due_date: None,
        payment_date: None,
        payment_method: None,
        generated_template_id: None,
        generated_bindings: None,
        generated_manual_text: None,
        version_root_document_id: None,
        replaces_document_id: None,
        version_number: 1,
        uploaded_by: actor_user_id,
    };

    let (document_id, _file_size, stored_filename, storage_key) =
        persist_document_file(state, &data, &persist_input).await?;
    best_effort_extract_document_text_and_store(
        state,
        document_id,
        Some(stored_filename.as_str()),
        Some("text/plain"),
        storage_key.as_str(),
        actor_user_id,
    )
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "create_translated_document_from_request",
        Some(actor_user_id),
        "document",
        Some(document_id),
        json!({
            "request_id": request_id,
            "source_document_id": source_document_id,
            "requested_language": requested_language,
            "request_source": request_source,
        }),
    ));

    crate::realtime::publish_document_event(
        state,
        Some(actor_user_id),
        "document.translation_document_created",
        document_id,
        json!({
            "request_id": request_id,
            "source_document_id": source_document_id,
            "patient_id": patient_id,
            "category": "translation",
        }),
    )
    .await;

    if request_source == "patient_portal" {
        let _ =
            release_document_to_patient_portal_internal(state, actor_user_id, document_id, false)
                .await;
    }

    Ok(document_id)
}

/// Build a file-download response without panicking on the request path. Header
/// construction can in principle fail (invalid header value); surface a 500
/// instead of unwrapping.
fn document_attachment_response(
    mime_type: &str,
    disposition: String,
    data: Vec<u8>,
) -> axum::response::Response {
    match axum::response::Response::builder()
        .header("content-type", mime_type)
        .header("content-disposition", disposition)
        .body(Body::from(data))
    {
        Ok(response) => response.into_response(),
        Err(error) => {
            tracing::error!(%error, "build document download response");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build download response",
            )
        }
    }
}

async fn download_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let Some(storage_key) = row
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default()
    else {
        if row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("file_deleted_at")
            .unwrap_or_default()
            .is_some()
        {
            return err(StatusCode::GONE, "Document file was deleted");
        }
        return err(StatusCode::NOT_FOUND, "Document file is not stored");
    };
    let mime_type = row
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let auto_name = row
        .try_get::<String, _>("auto_name")
        .unwrap_or_else(|_| "document".to_string());
    let filename = row
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default()
        .unwrap_or_else(|| auto_name.clone());

    let data = match read_document_storage_bytes(
        id,
        storage_key.as_str(),
        Some(mime_type.as_str()),
        Some(filename.as_str()),
        Some(auto_name.as_str()),
    )
    .await
    {
        Ok(data) => data,
        Err(_) => return err(StatusCode::NOT_FOUND, "Document file not found on disk"),
    };

    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));

    document_attachment_response(&mime_type, disposition, data)
}

async fn list_my_uploaded_documents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        r#"SELECT d.id, d.document_number, d.patient_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.klinik, d.ursprung, d.notes,
                  d.created_at, d.updated_at,
                  o.order_number, a.title AS appointment_title
           FROM documents d
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN appointments a ON a.id = d.appointment_id
           WHERE d.patient_id = $1
             AND d.uploaded_by = $2
             AND d.ursprung = 'patient_portal'
           ORDER BY d.created_at DESC"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
                        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
                        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
                        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                        "appointment_title": row.try_get::<Option<String>, _>("appointment_title").unwrap_or_default(),
                        "auto_name": row.try_get::<String, _>("auto_name").unwrap_or_default(),
                        "original_filename": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
                        "art": row.try_get::<String, _>("art").unwrap_or_default(),
                        "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "visibility": row.try_get::<String, _>("visibility").unwrap_or_default(),
                        "is_medical": row.try_get::<bool, _>("is_medical").unwrap_or(false),
                        "mime_type": row.try_get::<Option<String>, _>("mime_type").unwrap_or_default(),
                        "file_size": row.try_get::<Option<i64>, _>("file_size").unwrap_or_default(),
                        "klinik": row.try_get::<Option<String>, _>("klinik").unwrap_or_default(),
                        "ursprung": row.try_get::<Option<String>, _>("ursprung").unwrap_or_default(),
                        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list my uploaded documents");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient uploads",
            )
        }
    }
}

async fn download_my_uploaded_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let row = match sqlx::query(
        r#"SELECT auto_name, original_filename, mime_type, storage_key, file_deleted_at
           FROM documents
           WHERE id = $1
             AND patient_id = $2
             AND uploaded_by = $3
             AND ursprung = 'patient_portal'"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Uploaded document not found"),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, document_id = %id, "load my uploaded document");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load uploaded document",
            );
        }
    };

    let Some(storage_key) = row
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default()
    else {
        if row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("file_deleted_at")
            .unwrap_or_default()
            .is_some()
        {
            return err(StatusCode::GONE, "Document file was deleted");
        }
        return err(StatusCode::NOT_FOUND, "Document file is not stored");
    };

    let mime_type = row
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let auto_name = row
        .try_get::<String, _>("auto_name")
        .unwrap_or_else(|_| "document".to_string());
    let filename = row
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default()
        .unwrap_or_else(|| auto_name.clone());

    let data = match read_document_storage_bytes(
        id,
        storage_key.as_str(),
        Some(mime_type.as_str()),
        Some(filename.as_str()),
        Some(auto_name.as_str()),
    )
    .await
    {
        Ok(data) => data,
        Err(_) => return err(StatusCode::NOT_FOUND, "Document file not found on disk"),
    };

    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));

    document_attachment_response(&mime_type, disposition, data)
}

async fn upload_my_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut mime_type = String::from("application/octet-stream");
    let mut order_id: Option<Uuid> = None;
    let mut appointment_id: Option<Uuid> = None;
    let mut auto_name = String::new();
    let mut upload_kind = String::from("general");
    let mut notes: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                file_name = field.file_name().map(ToOwned::to_owned);
                if let Some(content_type) = field.content_type() {
                    mime_type = content_type.to_string();
                }
                match field.bytes().await {
                    Ok(bytes) => {
                        if bytes.len() > MAX_FILE_SIZE {
                            return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 25MB)");
                        }
                        file_data = Some(bytes.to_vec());
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "read patient portal multipart file");
                        return err(StatusCode::BAD_REQUEST, "Failed to read uploaded file");
                    }
                }
            }
            "order_id" => {
                order_id = match parse_uuid_field(field).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "appointment_id" => {
                appointment_id = match parse_uuid_field(field).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "auto_name" => auto_name = parse_text_field(field).await.unwrap_or_default(),
            "upload_kind" => {
                upload_kind = parse_text_field(field)
                    .await
                    .unwrap_or_else(|| "general".to_string())
            }
            "notes" => notes = parse_optional_text_field(field).await,
            _ => {}
        }
    }

    let data = match file_data {
        Some(data) if !data.is_empty() => data,
        _ => return err(StatusCode::BAD_REQUEST, "No file uploaded"),
    };
    match validate_upload_magic_bytes(file_name.as_deref(), Some(mime_type.as_str()), &data) {
        Ok(Some(validated_mime)) => mime_type = validated_mime,
        Ok(None) => {}
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    }
    match scan_upload_bytes(file_name.as_deref(), &data).await {
        Ok(FileScanOutcome::Clean) => {}
        Ok(FileScanOutcome::Skipped) => {
            tracing::warn!(filename = ?file_name, "virus scanner unavailable; patient portal document scan skipped");
        }
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    }
    let preset = match parse_patient_upload_preset(&upload_kind) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let (patient_id, _lead_id, order_id, appointment_id) =
        match validate_document_context(&state, Some(patient_id), None, order_id, appointment_id)
            .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    if preset.kind == "payment_proof" && order_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Payment proof must be linked to an order",
        );
    }

    if auto_name.trim().is_empty() {
        auto_name = file_name
            .clone()
            .unwrap_or_else(|| preset.default_title.to_string());
    }

    let original_filename = file_name.unwrap_or_else(|| "document".to_string());
    let persist_input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id,
        lead_id: None,
        order_id,
        appointment_id,
        auto_name: auto_name.trim(),
        original_filename: &original_filename,
        art: preset.art,
        category: Some(preset.category),
        status: "active",
        visibility: "internal",
        is_medical: preset.is_medical,
        mime_type: &mime_type,
        klinik: None,
        ursprung: Some("patient_portal"),
        notes: notes.as_deref(),
        document_direction: Some("incoming"),
        document_variant: Some("original"),
        document_language: None,
        access_category: Some(if preset.kind == "payment_proof" {
            "financial"
        } else {
            infer_document_access_category(
                Some(preset.category),
                preset.art,
                preset.is_medical,
                "internal",
            )
        }),
        document_date: Some(chrono::Utc::now().date_naive()),
        source_person: Some("patient_portal"),
        source_institution: None,
        addressee_person: None,
        addressee_institution: Some("GMED"),
        financial_status: if preset.kind == "payment_proof" {
            Some("open")
        } else {
            None
        },
        payment_due_date: None,
        payment_date: None,
        payment_method: None,
        generated_template_id: None,
        generated_bindings: None,
        generated_manual_text: None,
        version_root_document_id: None,
        replaces_document_id: None,
        version_number: 1,
        uploaded_by: auth.user_id,
    };
    let (document_id, file_size, original_filename, storage_key) =
        match persist_document_file(&state, &data, &persist_input).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    best_effort_extract_document_text_and_store(
        &state,
        document_id,
        Some(original_filename.as_str()),
        Some(mime_type.as_str()),
        storage_key.as_str(),
        auth.user_id,
    )
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "patient_portal_upload_document",
        Some(auth.user_id),
        "document",
        Some(document_id),
        json!({
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "upload_kind": preset.kind,
            "art": preset.art,
            "category": preset.category,
            "visibility": "internal",
        }),
    ));

    let patient_label = sqlx::query(
        r#"SELECT patient_id, trim(concat_ws(' ', first_name, last_name)) AS patient_name
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| {
        let pid = row.try_get::<String, _>("patient_id").unwrap_or_default();
        let name = row.try_get::<String, _>("patient_name").unwrap_or_default();
        if pid.is_empty() {
            name
        } else if name.is_empty() {
            pid
        } else {
            format!("{pid} · {name}")
        }
    })
    .unwrap_or_else(|| "Patient".to_string());

    let notification_body = if preset.kind == "payment_proof" {
        format!(
            "{patient_label} uploaded a payment proof: {}.",
            auto_name.trim()
        )
    } else {
        format!(
            "{patient_label} uploaded a portal document: {}.",
            auto_name.trim()
        )
    };

    let notification_rows = if preset.kind == "payment_proof" {
        sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               SELECT DISTINCT target.user_id, 'patient_upload', $2, $3, 'document', $1
               FROM (
                    SELECT pa.user_id
                    FROM patient_assignments pa
                    JOIN users u ON u.id = pa.user_id
                    WHERE pa.patient_id = $4
                      AND pa.revoked_at IS NULL
                      AND u.is_active = true
                      AND u.role IN ('patient_manager', 'ceo')
                    UNION
                    SELECT u.id AS user_id
                    FROM users u
                    WHERE u.is_active = true
                      AND u.role = 'billing'
               ) AS target
               RETURNING id, user_id"#,
        )
        .bind(document_id)
        .bind("Patient payment proof uploaded")
        .bind(notification_body)
        .bind(patient_id)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               SELECT pa.user_id, 'patient_upload', $2, $3, 'document', $1
               FROM patient_assignments pa
               JOIN users u ON u.id = pa.user_id
               WHERE pa.patient_id = $4
                 AND pa.revoked_at IS NULL
                 AND u.is_active = true
                 AND u.role IN ('patient_manager', 'ceo')
               RETURNING id, user_id"#,
        )
        .bind(document_id)
        .bind("Patient portal upload received")
        .bind(notification_body)
        .bind(patient_id)
        .fetch_all(&state.db)
        .await
    };

    if let Ok(notification_rows) = notification_rows {
        for notification_row in notification_rows {
            let notification_id = notification_row
                .try_get::<Uuid, _>("id")
                .unwrap_or_else(|_| Uuid::nil());
            let user_id = notification_row
                .try_get::<Uuid, _>("user_id")
                .unwrap_or_else(|_| Uuid::nil());
            if notification_id != Uuid::nil() && user_id != Uuid::nil() {
                crate::realtime::publish_notification_event(
                    &state,
                    user_id,
                    "notification.created",
                    Some(notification_id),
                    json!({
                        "entity_type": "document",
                        "entity_id": document_id,
                    }),
                )
                .await;
            }
        }
    }

    let event_type = if preset.kind == "payment_proof" {
        "document.payment_proof_uploaded"
    } else {
        "document.uploaded"
    };
    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        event_type,
        document_id,
        json!({
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "upload_kind": preset.kind,
            "art": preset.art,
            "category": preset.category,
            "visibility": "internal",
            "status": "active",
        }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "ok": true,
            "id": document_id,
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "upload_kind": preset.kind,
            "original_filename": original_filename,
            "mime_type": mime_type,
            "file_size": file_size,
        })),
    )
        .into_response()
}

async fn upload_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut mime_type = String::from("application/octet-stream");
    let mut patient_id: Option<Uuid> = None;
    let mut lead_id: Option<Uuid> = None;
    let mut order_id: Option<Uuid> = None;
    let mut appointment_id: Option<Uuid> = None;
    let mut auto_name = String::new();
    let mut art = String::new();
    let mut category: Option<String> = None;
    let mut status = String::from("active");
    let mut visibility = String::from("internal");
    let mut is_medical_override: Option<bool> = None;
    let mut klinik: Option<String> = None;
    let mut ursprung: Option<String> = None;
    let mut notes: Option<String> = None;
    let mut document_direction: Option<String> = None;
    let mut document_variant: Option<String> = None;
    let mut document_language: Option<String> = None;
    let mut access_category: Option<String> = None;
    let mut document_date: Option<NaiveDate> = None;
    let mut source_person: Option<String> = None;
    let mut source_institution: Option<String> = None;
    let mut addressee_person: Option<String> = None;
    let mut addressee_institution: Option<String> = None;
    let mut financial_status: Option<String> = None;
    let mut payment_due_date: Option<NaiveDate> = None;
    let mut payment_date: Option<NaiveDate> = None;
    let mut payment_method: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                file_name = field.file_name().map(ToOwned::to_owned);
                if let Some(content_type) = field.content_type() {
                    mime_type = content_type.to_string();
                }
                match field.bytes().await {
                    Ok(bytes) => {
                        if bytes.len() > MAX_FILE_SIZE {
                            return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 25MB)");
                        }
                        file_data = Some(bytes.to_vec());
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "read document multipart file");
                        return err(StatusCode::BAD_REQUEST, "Failed to read uploaded file");
                    }
                }
            }
            "patient_id" => {
                patient_id = match parse_uuid_field(field).await {
                    Ok(v) => v,
                    Err(resp) => return resp,
                }
            }
            "lead_id" => {
                lead_id = match parse_uuid_field(field).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "order_id" => {
                order_id = match parse_uuid_field(field).await {
                    Ok(v) => v,
                    Err(resp) => return resp,
                }
            }
            "appointment_id" => {
                appointment_id = match parse_uuid_field(field).await {
                    Ok(v) => v,
                    Err(resp) => return resp,
                }
            }
            "auto_name" => auto_name = parse_text_field(field).await.unwrap_or_default(),
            "art" => art = parse_text_field(field).await.unwrap_or_default(),
            "category" => category = parse_optional_text_field(field).await,
            "status" => {
                status = parse_text_field(field)
                    .await
                    .unwrap_or_else(|| "active".to_string())
            }
            "visibility" => {
                visibility = parse_text_field(field)
                    .await
                    .unwrap_or_else(|| "internal".to_string())
            }
            "is_medical" => {
                is_medical_override = parse_optional_text_field(field)
                    .await
                    .as_deref()
                    .map(parse_bool_flag)
            }
            "klinik" => klinik = parse_optional_text_field(field).await,
            "ursprung" => ursprung = parse_optional_text_field(field).await,
            "notes" => notes = parse_optional_text_field(field).await,
            "document_direction" => {
                document_direction = match normalize_document_direction(
                    parse_optional_text_field(field).await.as_deref(),
                ) {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "document_variant" => {
                document_variant = match normalize_document_variant(
                    parse_optional_text_field(field).await.as_deref(),
                ) {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "document_language" => {
                document_language = match parse_optional_text_field(field).await {
                    Some(value) => match normalize_document_language(Some(value.as_str())) {
                        Some(language) => Some(language.to_string()),
                        None => {
                            return err(
                                StatusCode::UNPROCESSABLE_ENTITY,
                                "Unknown document language",
                            );
                        }
                    },
                    None => None,
                }
            }
            "access_category" => {
                access_category = match normalize_document_access_category(
                    parse_optional_text_field(field).await.as_deref(),
                ) {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "document_date" => {
                document_date = match parse_optional_date_field(field).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "source_person" => source_person = parse_optional_text_field(field).await,
            "source_institution" => source_institution = parse_optional_text_field(field).await,
            "addressee_person" => addressee_person = parse_optional_text_field(field).await,
            "addressee_institution" => {
                addressee_institution = parse_optional_text_field(field).await
            }
            "financial_status" => {
                financial_status = match normalize_document_financial_status(
                    parse_optional_text_field(field).await.as_deref(),
                ) {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "payment_due_date" => {
                payment_due_date = match parse_optional_date_field(field).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "payment_date" => {
                payment_date = match parse_optional_date_field(field).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            "payment_method" => {
                payment_method = match normalize_document_payment_method(
                    parse_optional_text_field(field).await.as_deref(),
                ) {
                    Ok(value) => value,
                    Err(resp) => return resp,
                }
            }
            _ => {}
        }
    }

    let data = match file_data {
        Some(data) if !data.is_empty() => data,
        _ => return err(StatusCode::BAD_REQUEST, "No file uploaded"),
    };
    match validate_upload_magic_bytes(file_name.as_deref(), Some(mime_type.as_str()), &data) {
        Ok(Some(validated_mime)) => mime_type = validated_mime,
        Ok(None) => {}
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    }
    match scan_upload_bytes(file_name.as_deref(), &data).await {
        Ok(FileScanOutcome::Clean) => {}
        Ok(FileScanOutcome::Skipped) => {
            tracing::warn!(filename = ?file_name, "virus scanner unavailable; document scan skipped");
        }
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    }
    if auto_name.trim().is_empty() {
        auto_name = file_name
            .clone()
            .unwrap_or_else(|| "Uploaded document".to_string());
    }
    if !matches!(status.as_str(), "draft" | "active" | "archived") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid document status");
    }
    if parse_share_status(&visibility).is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid document visibility",
        );
    }

    let (patient_id, lead_id, order_id, appointment_id) = match validate_document_context(
        &state,
        patient_id,
        lead_id,
        order_id,
        appointment_id,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if patient_id.is_none() && lead_id.is_none() && order_id.is_none() && appointment_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document must be linked to lead, patient, order or appointment",
        );
    }

    if lead_id.is_some() && !matches!(auth.role, Role::PatientManager | Role::Ceo | Role::ItAdmin) {
        return err(
            StatusCode::FORBIDDEN,
            "Insufficient permissions for lead documents",
        );
    }

    if matches!(auth.role, Role::Interpreter | Role::TeamleadInterpreter) {
        let assignment_set = match load_assignment_set(&state, &auth).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        let Some(document_patient_id) = patient_id else {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Interpreter document upload requires patient-linked context",
            );
        };
        if !assignment_set.contains(&document_patient_id) {
            return err(
                StatusCode::FORBIDDEN,
                "Interpreter document upload is limited to assigned patients",
            );
        }

        visibility = "internal".to_string();
        if auth.role == Role::Interpreter {
            status = "draft".to_string();
            ursprung = Some("interpreter_upload".to_string());
        } else if ursprung.as_deref().unwrap_or_default().trim().is_empty() {
            ursprung = Some("teamlead_upload".to_string());
        }
    }

    let original_filename = file_name.unwrap_or_else(|| "document".to_string());
    let classification_suggestion = suggest_document_classification(
        Some(original_filename.as_str()),
        Some(auto_name.trim()),
        Some(mime_type.as_str()),
        ursprung.as_deref(),
        notes.as_deref(),
    );
    let resolved_art = if art.trim().is_empty() {
        classification_suggestion
            .as_ref()
            .and_then(classification_suggestion_art)
            .unwrap_or("uploaded_document")
            .to_string()
    } else {
        art.trim().to_string()
    };
    let resolved_category = category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            classification_suggestion
                .as_ref()
                .and_then(classification_suggestion_category)
                .map(ToOwned::to_owned)
        });
    let resolved_is_medical = is_medical_override.unwrap_or_else(|| {
        classification_suggestion
            .as_ref()
            .and_then(classification_suggestion_is_medical)
            .unwrap_or_else(|| {
                document_fields_imply_medical(&resolved_art, resolved_category.as_deref())
            })
    });
    let needs_categorization = document_needs_categorization(
        Some(resolved_art.as_str()),
        resolved_category.as_deref(),
        ursprung.as_deref(),
    );
    let persist_input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id,
        lead_id,
        order_id,
        appointment_id,
        auto_name: auto_name.trim(),
        original_filename: &original_filename,
        art: resolved_art.as_str(),
        category: resolved_category.as_deref(),
        status: status.as_str(),
        visibility: visibility.as_str(),
        is_medical: resolved_is_medical,
        mime_type: &mime_type,
        klinik: klinik.as_deref(),
        ursprung: ursprung.as_deref(),
        notes: notes.as_deref(),
        document_direction: document_direction
            .as_deref()
            .or(Some(infer_document_direction(None, ursprung.as_deref()))),
        document_variant: document_variant.as_deref().or(Some("original")),
        document_language: document_language.as_deref(),
        access_category: access_category
            .as_deref()
            .or(Some(infer_document_access_category(
                resolved_category.as_deref(),
                resolved_art.as_str(),
                resolved_is_medical,
                visibility.as_str(),
            ))),
        document_date: document_date.or_else(|| Some(chrono::Utc::now().date_naive())),
        source_person: source_person.as_deref().or(ursprung.as_deref()),
        source_institution: source_institution.as_deref().or(klinik.as_deref()),
        addressee_person: addressee_person.as_deref(),
        addressee_institution: addressee_institution.as_deref(),
        financial_status: financial_status.as_deref(),
        payment_due_date,
        payment_date,
        payment_method: payment_method.as_deref(),
        generated_template_id: None,
        generated_bindings: None,
        generated_manual_text: None,
        version_root_document_id: None,
        replaces_document_id: None,
        version_number: 1,
        uploaded_by: auth.user_id,
    };
    let (document_id, file_size, original_filename, storage_key) =
        match persist_document_file(&state, &data, &persist_input).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    best_effort_extract_document_text_and_store(
        &state,
        document_id,
        Some(original_filename.as_str()),
        Some(mime_type.as_str()),
        storage_key.as_str(),
        auth.user_id,
    )
    .await;

    state.audit_sender.try_send(audit::domain_event(
        "upload_document",
        Some(auth.user_id),
        "document",
        Some(document_id),
        json!({
            "patient_id": patient_id,
            "lead_id": lead_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "art": persist_input.art,
            "category": resolved_category.as_deref(),
            "visibility": visibility,
            "status": status,
            "is_medical": resolved_is_medical,
            "ursprung": ursprung.as_deref(),
            "classification_suggestion": classification_suggestion.clone(),
        }),
    ));

    if auth.role == Role::Interpreter
        && let Some(document_patient_id) = patient_id
    {
        let patient_label = sqlx::query(
            r#"SELECT patient_id, trim(concat_ws(' ', first_name, last_name)) AS patient_name
               FROM patients
               WHERE id = $1"#,
        )
        .bind(document_patient_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .map(|row| {
            let pid = row.try_get::<String, _>("patient_id").unwrap_or_default();
            let name = row.try_get::<String, _>("patient_name").unwrap_or_default();
            if pid.is_empty() {
                name
            } else if name.is_empty() {
                pid
            } else {
                format!("{pid} · {name}")
            }
        })
        .unwrap_or_else(|| document_patient_id.to_string());

        if let Ok(notification_rows) = sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               SELECT pa.user_id, 'interpreter_upload', $2, $3, 'document', $1
               FROM patient_assignments pa
               JOIN users u ON u.id = pa.user_id
               WHERE pa.patient_id = $4
                 AND pa.revoked_at IS NULL
                 AND u.is_active = true
                 AND u.role IN ('patient_manager', 'teamlead_interpreter', 'ceo')
               RETURNING id, user_id"#,
        )
        .bind(document_id)
        .bind("Interpreter document uploaded")
        .bind(format!(
            "{patient_label} has a new interpreter document awaiting review: {}.",
            auto_name.trim()
        ))
        .bind(document_patient_id)
        .fetch_all(&state.db)
        .await
        {
            for notification_row in notification_rows {
                let notification_id = notification_row
                    .try_get::<Uuid, _>("id")
                    .unwrap_or_else(|_| Uuid::nil());
                let user_id = notification_row
                    .try_get::<Uuid, _>("user_id")
                    .unwrap_or_else(|_| Uuid::nil());
                if notification_id != Uuid::nil() && user_id != Uuid::nil() {
                    crate::realtime::publish_notification_event(
                        &state,
                        user_id,
                        "notification.created",
                        Some(notification_id),
                        json!({
                            "entity_type": "document",
                            "entity_id": document_id,
                        }),
                    )
                    .await;
                }
            }
        }
    }

    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        "document.uploaded",
        document_id,
        json!({
            "patient_id": patient_id,
            "lead_id": lead_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "art": persist_input.art,
            "category": resolved_category.as_deref(),
            "visibility": persist_input.visibility,
            "status": persist_input.status,
            "is_medical": resolved_is_medical,
            "ursprung": ursprung.as_deref(),
            "needs_categorization": needs_categorization,
        }),
    )
    .await;

    Json(json!({
        "ok": true,
        "id": document_id,
        "patient_id": patient_id,
        "lead_id": lead_id,
        "order_id": order_id,
        "appointment_id": appointment_id,
        "original_filename": original_filename,
        "mime_type": mime_type,
        "file_size": file_size,
        "art": persist_input.art,
        "category": resolved_category,
        "is_medical": resolved_is_medical,
        "needs_categorization": needs_categorization,
        "classification_suggestion": classification_suggestion,
    }))
    .into_response()
}

async fn update_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDocumentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let current = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };
    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if auth.role == Role::TeamleadInterpreter {
        if !can_review_document_intake_row(&auth, &current, &assignment_set) {
            return err(
                StatusCode::FORBIDDEN,
                "Teamlead may review only interpreter-origin intake documents for assigned patients",
            );
        }
        if let Err(resp) = validate_teamlead_document_review_update(&body) {
            return resp;
        }
    }

    let current_patient_id: Option<Uuid> = current.try_get("patient_id").unwrap_or_default();
    let current_lead_id: Option<Uuid> = current.try_get("lead_id").unwrap_or_default();
    let current_order_id: Option<Uuid> = current.try_get("order_id").unwrap_or_default();
    let current_appointment_id: Option<Uuid> =
        current.try_get("appointment_id").unwrap_or_default();

    let (patient_id, _lead_id, order_id, appointment_id) = match validate_document_context(
        &state,
        body.patient_id.or(current_patient_id),
        current_lead_id,
        body.order_id.or(current_order_id),
        body.appointment_id.or(current_appointment_id),
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let auto_name = body.auto_name.clone().unwrap_or_else(|| {
        current
            .try_get::<String, _>("auto_name")
            .unwrap_or_default()
    });
    let art = body
        .art
        .clone()
        .unwrap_or_else(|| current.try_get::<String, _>("art").unwrap_or_default());
    let category = body.category.clone().or_else(|| {
        current
            .try_get::<Option<String>, _>("category")
            .unwrap_or_default()
    });
    let status = body
        .status
        .clone()
        .unwrap_or_else(|| current.try_get::<String, _>("status").unwrap_or_default());
    let visibility = body.visibility.clone().unwrap_or_else(|| {
        current
            .try_get::<String, _>("visibility")
            .unwrap_or_default()
    });
    let is_medical = body
        .is_medical
        .unwrap_or_else(|| current.try_get::<bool, _>("is_medical").unwrap_or(false));
    let klinik = body.klinik.clone().or_else(|| {
        current
            .try_get::<Option<String>, _>("klinik")
            .unwrap_or_default()
    });
    let ursprung = body.ursprung.clone().or_else(|| {
        current
            .try_get::<Option<String>, _>("ursprung")
            .unwrap_or_default()
    });
    let notes = body.notes.clone().or_else(|| {
        current
            .try_get::<Option<String>, _>("notes")
            .unwrap_or_default()
    });
    let document_direction = match nullable_document_enum(
        &body.document_direction,
        &["incoming", "outgoing"],
        "Invalid document direction",
    ) {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<String>, _>("document_direction")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let document_variant = match nullable_document_enum(
        &body.document_variant,
        &["original", "translation"],
        "Invalid document variant",
    ) {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<String>, _>("document_variant")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let document_language = match nullable_document_language(&body.document_language) {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<String>, _>("document_language")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let access_category = match nullable_document_enum(
        &body.access_category,
        &[
            "internal",
            "patient",
            "provider",
            "authority",
            "financial",
            "medical",
            "other",
        ],
        "Invalid document access category",
    ) {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<String>, _>("access_category")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let document_date = match nullable_document_date(&body.document_date, "Invalid document date") {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<NaiveDate>, _>("document_date")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let source_person = match nullable_trimmed_text(&body.source_person, "Invalid source person") {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<String>, _>("source_person")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let source_institution =
        match nullable_trimmed_text(&body.source_institution, "Invalid source institution") {
            Ok(Some(value)) => value,
            Ok(None) => current
                .try_get::<Option<String>, _>("source_institution")
                .unwrap_or_default(),
            Err(resp) => return resp,
        };
    let addressee_person =
        match nullable_trimmed_text(&body.addressee_person, "Invalid addressee person") {
            Ok(Some(value)) => value,
            Ok(None) => current
                .try_get::<Option<String>, _>("addressee_person")
                .unwrap_or_default(),
            Err(resp) => return resp,
        };
    let addressee_institution =
        match nullable_trimmed_text(&body.addressee_institution, "Invalid addressee institution") {
            Ok(Some(value)) => value,
            Ok(None) => current
                .try_get::<Option<String>, _>("addressee_institution")
                .unwrap_or_default(),
            Err(resp) => return resp,
        };
    let financial_status = match nullable_document_enum(
        &body.financial_status,
        &[
            "open",
            "in_progress",
            "paid",
            "overdue",
            "billed_to_patient",
            "reimbursed",
        ],
        "Invalid document financial status",
    ) {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<String>, _>("financial_status")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let payment_due_date =
        match nullable_document_date(&body.payment_due_date, "Invalid payment due date") {
            Ok(Some(value)) => value,
            Ok(None) => current
                .try_get::<Option<NaiveDate>, _>("payment_due_date")
                .unwrap_or_default(),
            Err(resp) => return resp,
        };
    let payment_date = match nullable_document_date(&body.payment_date, "Invalid payment date") {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<NaiveDate>, _>("payment_date")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };
    let payment_method = match nullable_document_enum(
        &body.payment_method,
        &["cash", "bank_transfer", "card", "other"],
        "Invalid document payment method",
    ) {
        Ok(Some(value)) => value,
        Ok(None) => current
            .try_get::<Option<String>, _>("payment_method")
            .unwrap_or_default(),
        Err(resp) => return resp,
    };

    if auth.role == Role::TeamleadInterpreter && visibility != "internal" {
        return err(
            StatusCode::FORBIDDEN,
            "Teamlead review cannot change document visibility",
        );
    }

    if auth.role == Role::TeamleadInterpreter
        && status == "active"
        && document_needs_categorization(Some(art.trim()), category.as_deref(), ursprung.as_deref())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Teamlead release requires document classification fields",
        );
    }

    if auto_name.trim().is_empty() || art.trim().is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document auto name and art are required",
        );
    }
    if !matches!(status.as_str(), "draft" | "active" | "archived") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid document status");
    }
    if parse_share_status(&visibility).is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid document visibility",
        );
    }

    let next_status = status.clone();
    let next_visibility = visibility.clone();

    match sqlx::query(
        r#"UPDATE documents
           SET patient_id = $2,
               order_id = $3,
               appointment_id = $4,
               auto_name = $5,
               art = $6,
               category = $7,
               status = $8,
               visibility = $9,
               is_medical = $10,
               klinik = $11,
               ursprung = $12,
               notes = $13,
               document_direction = $14,
               document_variant = $15,
               document_language = $16,
               access_category = $17,
               document_date = $18,
               source_person = $19,
               source_institution = $20,
               addressee_person = $21,
               addressee_institution = $22,
               financial_status = $23,
               payment_due_date = $24,
               payment_date = $25,
               payment_method = $26
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(auto_name.trim())
    .bind(art.trim())
    .bind(category.as_deref())
    .bind(status)
    .bind(visibility)
    .bind(is_medical)
    .bind(klinik.as_deref())
    .bind(ursprung.as_deref())
    .bind(notes.as_deref())
    .bind(document_direction.as_deref())
    .bind(document_variant.as_deref())
    .bind(document_language.as_deref())
    .bind(access_category.as_deref())
    .bind(document_date)
    .bind(source_person.as_deref())
    .bind(source_institution.as_deref())
    .bind(addressee_person.as_deref())
    .bind(addressee_institution.as_deref())
    .bind(financial_status.as_deref())
    .bind(payment_due_date)
    .bind(payment_date)
    .bind(payment_method.as_deref())
    .execute(&state.db)
    .await
    {
        Ok(_) => {
            state.audit_sender.try_send(audit::domain_event(
                "update_document",
                Some(auth.user_id),
                "document",
                Some(id),
                json!({
                    "patient_id": patient_id,
                    "order_id": order_id,
                    "appointment_id": appointment_id,
                    "status": body.status,
                    "visibility": body.visibility,
                    "is_medical": body.is_medical,
                }),
            ));
            crate::realtime::publish_document_event(
                &state,
                Some(auth.user_id),
                "document.updated",
                id,
                json!({
                    "patient_id": patient_id,
                    "order_id": order_id,
                    "appointment_id": appointment_id,
                    "status": next_status,
                    "visibility": next_visibility,
                    "is_medical": is_medical,
                }),
            )
            .await;
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, "update document");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update document",
            )
        }
    }
}

async fn delete_document_file(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<DeleteDocumentFileRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let reason = body.reason.trim();
    if reason.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document deletion reason is required",
        );
    }

    let current = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    let previous_status = current
        .try_get::<String, _>("status")
        .unwrap_or_else(|_| "active".to_string());
    let previous_visibility = current
        .try_get::<String, _>("visibility")
        .unwrap_or_else(|_| "internal".to_string());
    let patient_id = current
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default();
    let had_storage_key = current
        .try_get::<Option<String>, _>("storage_key")
        .unwrap_or_default();
    let already_deleted_at = current
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("file_deleted_at")
        .unwrap_or_default();

    if already_deleted_at.is_some() {
        return err(StatusCode::CONFLICT, "Document file was already deleted");
    }

    let staged_delete = match stage_document_file_delete(had_storage_key.as_deref()).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            if let Some(staged) = staged_delete.as_ref() {
                rollback_staged_document_delete(staged).await;
            }
            tracing::error!(error = %error, document_id = %id, "begin document delete transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete document file",
            );
        }
    };

    let revoked_rows = match sqlx::query(
        r#"UPDATE document_shares
           SET revoked_at = now()
           WHERE document_id = $1
             AND revoked_at IS NULL
           RETURNING id"#,
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            if let Some(staged) = staged_delete.as_ref() {
                rollback_staged_document_delete(staged).await;
            }
            tracing::error!(error = %error, document_id = %id, "revoke document shares for delete");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete document file",
            );
        }
    };

    let questionnaire_source_bytes_removed = match sqlx::query(
        r#"UPDATE lead_attachments
           SET data = ''::bytea,
               size_bytes = 0
           WHERE imported_document_id = $1
             AND octet_length(data) > 0"#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result.rows_affected() > 0,
        Err(error) => {
            if let Some(staged) = staged_delete.as_ref() {
                rollback_staged_document_delete(staged).await;
            }
            tracing::error!(error = %error, document_id = %id, "remove questionnaire source bytes");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete document file",
            );
        }
    };

    match sqlx::query(
        r#"UPDATE documents
           SET status = 'archived',
               visibility = 'internal',
               storage_key = NULL,
               file_deleted_at = now(),
               file_deleted_by = $2,
               file_delete_reason = $3
           WHERE id = $1 AND file_deleted_at IS NULL"#,
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(reason)
    .execute(&mut *tx)
    .await
    {
        // A concurrent request deleted the file between our pre-check and this
        // UPDATE; the guarded WHERE matches no rows. Roll back and report the
        // conflict instead of silently re-archiving the same record.
        Ok(result) if result.rows_affected() == 0 => {
            if let Some(staged) = staged_delete.as_ref() {
                rollback_staged_document_delete(staged).await;
            }
            return err(StatusCode::CONFLICT, "Document file was already deleted");
        }
        Ok(_) => {}
        Err(error) => {
            if let Some(staged) = staged_delete.as_ref() {
                rollback_staged_document_delete(staged).await;
            }
            tracing::error!(error = %error, document_id = %id, "mark document file deleted");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete document file",
            );
        }
    }

    if let Err(error) = tx.commit().await {
        if let Some(staged) = staged_delete.as_ref() {
            rollback_staged_document_delete(staged).await;
        }
        tracing::error!(error = %error, document_id = %id, "commit document delete transaction");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete document file",
        );
    }

    if let Some(staged) = staged_delete.as_ref() {
        finalize_staged_document_delete(staged).await;
    }

    let revoked_share_ids: Vec<_> = revoked_rows
        .iter()
        .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
        .collect();

    state.audit_sender.try_send(audit::domain_event(
        "delete_document_file",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({
            "patient_id": patient_id,
            "reason": reason,
            "previous_status": previous_status,
            "previous_visibility": previous_visibility,
            "had_stored_file": had_storage_key.is_some(),
            "file_removed_from_disk": staged_delete.is_some(),
            "questionnaire_source_bytes_removed": questionnaire_source_bytes_removed,
            "revoked_share_ids": revoked_share_ids,
        }),
    ));

    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        "document.deleted",
        id,
        json!({
            "patient_id": patient_id,
            "previous_status": previous_status,
            "previous_visibility": previous_visibility,
            "revoked_share_count": revoked_share_ids.len(),
            "file_removed_from_disk": staged_delete.is_some(),
            "questionnaire_source_bytes_removed": questionnaire_source_bytes_removed,
        }),
    )
    .await;

    let fresh_row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    Json(json!({
        "ok": true,
        "document": document_json(&fresh_row),
        "revoked_share_count": revoked_share_ids.len(),
        "file_removed_from_disk": staged_delete.is_some(),
    }))
    .into_response()
}

async fn release_document_to_patient_portal_internal(
    state: &AppState,
    actor_user_id: Uuid,
    id: Uuid,
    requires_confirmation: bool,
) -> Result<PortalReleaseResult, axum::response::Response> {
    let row = match sqlx::query(
        r#"SELECT id, patient_id, visibility, status, auto_name
           FROM documents
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return Err(err(StatusCode::NOT_FOUND, "Document not found")),
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, "load document for portal release");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to release document to the portal",
            ));
        }
    };

    let Some(patient_id) = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default()
    else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only patient-linked documents can be released to the portal",
        ));
    };

    let current_visibility = row
        .try_get::<String, _>("visibility")
        .unwrap_or_else(|_| "internal".to_string());
    if row.try_get::<String, _>("status").unwrap_or_default() == "archived" {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Archived document versions cannot be released to the portal",
        ));
    }
    let auto_name = row.try_get::<String, _>("auto_name").unwrap_or_default();
    let channel = "patient_portal".to_string();
    let recipients = match sqlx::query(
        r#"SELECT DISTINCT u.id
           FROM users u
           JOIN patient_assignments pa ON pa.user_id = u.id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = 'patient'
           ORDER BY u.id"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|recipient| recipient.try_get::<Uuid, _>("id").ok())
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, document_id = %id, "load patient portal recipients");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient portal recipients",
            ));
        }
    };

    if recipients.is_empty() {
        return Err(err(
            StatusCode::CONFLICT,
            "No active patient portal user is linked to this patient",
        ));
    }

    if current_visibility != "patient_visible"
        && let Err(e) =
            sqlx::query("UPDATE documents SET visibility = 'patient_visible' WHERE id = $1")
                .bind(id)
                .execute(&state.db)
                .await
    {
        tracing::error!(error = %e, document_id = %id, "set patient portal visibility");
        return Err(err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to release document to the portal",
        ));
    }

    let existing_rows = match sqlx::query(
        r#"SELECT ds.id, ds.shared_with_user_id
           FROM document_shares ds
           JOIN users u ON u.id = ds.shared_with_user_id
           JOIN patient_assignments pa ON pa.user_id = u.id
           WHERE ds.document_id = $1
             AND pa.patient_id = $2
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = 'patient'
             AND ds.revoked_at IS NULL"#,
    )
    .bind(id)
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, patient_id = %patient_id, "load existing patient portal shares");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load existing portal releases",
            ));
        }
    };

    let existing_recipients: HashSet<_> = existing_rows
        .iter()
        .filter_map(|share| share.try_get::<Uuid, _>("shared_with_user_id").ok())
        .collect();
    let mut created_share_ids = Vec::new();

    for recipient_id in recipients.iter().copied() {
        if existing_recipients.contains(&recipient_id) {
            continue;
        }

        let inserted = match sqlx::query(
            r#"INSERT INTO document_shares (
                    document_id, shared_with_user_id, shared_by, channel, requires_confirmation
               ) VALUES ($1, $2, $3, $4, $5)
               RETURNING id"#,
        )
        .bind(id)
        .bind(recipient_id)
        .bind(actor_user_id)
        .bind(channel.as_str())
        .bind(requires_confirmation)
        .fetch_one(&state.db)
        .await
        {
            Ok(row) => row,
            Err(e) => {
                tracing::error!(error = %e, document_id = %id, recipient_id = %recipient_id, "create patient portal share");
                return Err(err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to create patient portal release",
                ));
            }
        };

        let share_id = inserted
            .try_get::<Uuid, _>("id")
            .unwrap_or_else(|_| Uuid::nil());
        created_share_ids.push(share_id);

        if let Ok(notification_id) = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               VALUES ($1, 'document_release', $2, $3, 'document', $4)
               RETURNING id"#,
        )
        .bind(recipient_id)
        .bind(format!("New document released: {auto_name}"))
        .bind("A new document is available in your patient portal.")
        .bind(id)
        .fetch_one(&state.db)
        .await
        {
            crate::realtime::publish_notification_event(
                state,
                recipient_id,
                "notification.created",
                Some(notification_id),
                json!({
                    "entity_type": "document",
                    "entity_id": id,
                }),
            )
            .await;
        }
    }

    state.audit_sender.try_send(audit::domain_event(
        "release_document_to_patient_portal",
        Some(actor_user_id),
        "document",
        Some(id),
        json!({
            "patient_id": patient_id,
            "previous_visibility": current_visibility,
            "new_visibility": "patient_visible",
            "channel": channel,
            "requires_confirmation": requires_confirmation,
            "recipient_count": recipients.len(),
            "created_share_ids": created_share_ids,
        }),
    ));

    crate::realtime::publish_document_event(
        state,
        Some(actor_user_id),
        "document.portal_released",
        id,
        json!({
            "patient_id": patient_id,
            "visibility": "patient_visible",
            "requires_confirmation": requires_confirmation,
            "recipient_count": recipients.len(),
            "created_share_count": created_share_ids.len(),
        }),
    )
    .await;

    Ok(PortalReleaseResult {
        document_id: id,
        patient_id,
        visibility: "patient_visible",
        recipient_count: recipients.len(),
        created_share_count: created_share_ids.len(),
        requires_confirmation,
    })
}

pub(crate) async fn auto_send_provider_preparation_documents_for_confirmed_appointment(
    state: &AppState,
    actor_user_id: Uuid,
    appointment_id: Uuid,
) -> Result<AutoPreparationDocumentSendResult, axum::response::Response> {
    let appointment = match sqlx::query(
        r#"SELECT patient_id, order_id, provider_id, doctor_id, appointment_type, status
           FROM appointments
           WHERE id = $1"#,
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return Ok(AutoPreparationDocumentSendResult::default()),
        Err(error) => {
            tracing::error!(error = %error, appointment_id = %appointment_id, "load appointment for auto preparation documents");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to auto-send preparation documents",
            ));
        }
    };

    if appointment
        .try_get::<String, _>("appointment_type")
        .unwrap_or_default()
        != "medical"
        || appointment
            .try_get::<String, _>("status")
            .unwrap_or_default()
            != "confirmed"
    {
        return Ok(AutoPreparationDocumentSendResult::default());
    }

    let Some(patient_id) = appointment
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default()
    else {
        return Ok(AutoPreparationDocumentSendResult::default());
    };
    let Some(order_id) = appointment
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default()
    else {
        return Ok(AutoPreparationDocumentSendResult::default());
    };
    let Some(provider_id) = appointment
        .try_get::<Option<Uuid>, _>("provider_id")
        .unwrap_or_default()
    else {
        return Ok(AutoPreparationDocumentSendResult::default());
    };
    let doctor_id = appointment
        .try_get::<Option<Uuid>, _>("doctor_id")
        .unwrap_or_default();

    let templates =
        load_provider_document_templates_for_confirmed_appointment(state, provider_id, doctor_id)
            .await?;
    if templates.is_empty() {
        return Ok(AutoPreparationDocumentSendResult::default());
    }

    let mut result = AutoPreparationDocumentSendResult {
        template_count: templates.len(),
        ..Default::default()
    };

    for template in templates {
        let template_id = template.id;
        let ursprung = format!(
            "auto_preparation:{}:{}",
            appointment_id,
            provider_template_public_id(template.id)
        );

        let claimed_delivery = claim_appointment_provider_template_delivery(
            state,
            ProviderTemplateDeliveryRecord {
                appointment_id,
                template_id,
                document_id: None,
                triggered_by: actor_user_id,
                delivery_status: "processing",
                error_message: None,
                delivered_at: None,
            },
        )
        .await?;

        let existing_document_id = if claimed_delivery {
            find_existing_auto_preparation_document(state, appointment_id, &ursprung).await?
        } else {
            wait_for_delivered_auto_preparation_document(state, appointment_id, template_id)
                .await?
                .or(
                    find_existing_auto_preparation_document(state, appointment_id, &ursprung)
                        .await?,
                )
        };

        let document_id = if let Some(value) = existing_document_id {
            result.reused_document_count += 1;
            value
        } else {
            if !claimed_delivery {
                record_appointment_provider_template_delivery(
                    state,
                    ProviderTemplateDeliveryRecord {
                        appointment_id,
                        template_id,
                        document_id: None,
                        triggered_by: actor_user_id,
                        delivery_status: "processing",
                        error_message: None,
                        delivered_at: None,
                    },
                )
                .await?;
            }

            let generated = match generate_provider_document_from_template_internal(
                state,
                actor_user_id,
                &GenerateDocumentRequest {
                    template_id: provider_template_public_id(template.id),
                    patient_id: Some(patient_id),
                    order_id: Some(order_id),
                    appointment_id: Some(appointment_id),
                    auto_name: None,
                    status: Some("active".to_string()),
                    visibility: Some("released_internal".to_string()),
                    ursprung: Some(ursprung),
                    ..GenerateDocumentRequest::default()
                },
                template,
            )
            .await
            {
                Ok(value) => value,
                Err(resp) => {
                    let _ = record_appointment_provider_template_delivery(
                        state,
                        ProviderTemplateDeliveryRecord {
                            appointment_id,
                            template_id,
                            document_id: None,
                            triggered_by: actor_user_id,
                            delivery_status: "failed",
                            error_message: Some("document_generation_failed"),
                            delivered_at: None,
                        },
                    )
                    .await;
                    return Err(resp);
                }
            };
            result.generated_document_count += 1;
            generated.id
        };

        let release = match release_document_to_patient_portal_internal(
            state,
            actor_user_id,
            document_id,
            true,
        )
        .await
        {
            Ok(value) => value,
            Err(resp) => {
                let _ = record_appointment_provider_template_delivery(
                    state,
                    ProviderTemplateDeliveryRecord {
                        appointment_id,
                        template_id,
                        document_id: Some(document_id),
                        triggered_by: actor_user_id,
                        delivery_status: "failed",
                        error_message: Some("patient_portal_release_failed"),
                        delivered_at: None,
                    },
                )
                .await;
                return Err(resp);
            }
        };
        result.portal_release_count += release.created_share_count;

        record_appointment_provider_template_delivery(
            state,
            ProviderTemplateDeliveryRecord {
                appointment_id,
                template_id,
                document_id: Some(document_id),
                triggered_by: actor_user_id,
                delivery_status: "delivered",
                error_message: None,
                delivered_at: Some(chrono::Utc::now()),
            },
        )
        .await?;
    }

    if result.generated_document_count > 0
        || result.reused_document_count > 0
        || result.portal_release_count > 0
    {
        if let Err(error) = sqlx::query(
            r#"INSERT INTO order_planning_preparation (
                    order_id, preparation_documents_status, preparation_documents_sent_at, preparation_documents_sent_by
               ) VALUES ($1, 'sent', now(), $2)
               ON CONFLICT (order_id) DO UPDATE
               SET preparation_documents_status = 'sent',
                   preparation_documents_sent_at = COALESCE(order_planning_preparation.preparation_documents_sent_at, now()),
                   preparation_documents_sent_by = COALESCE(order_planning_preparation.preparation_documents_sent_by, $2)"#,
        )
        .bind(order_id)
        .bind(actor_user_id)
        .execute(&state.db)
        .await
        {
            tracing::error!(error = %error, order_id = %order_id, appointment_id = %appointment_id, "mark preparation documents sent after auto portal release");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update preparation document status",
            ));
        }

        state.audit_sender.try_send(audit::domain_event(
            "auto_send_partner_preparation_documents",
            Some(actor_user_id),
            "appointment",
            Some(appointment_id),
            json!({
                "order_id": order_id,
                "patient_id": patient_id,
                "template_count": result.template_count,
                "generated_document_count": result.generated_document_count,
                "reused_document_count": result.reused_document_count,
                "portal_release_count": result.portal_release_count,
            }),
        ));
        result.marked_sent = true;
    }

    Ok(result)
}

async fn release_document_to_patient_portal(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<PortalReleaseRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }
    let channel =
        match normalize_share_channel(Some(body.channel.as_deref().unwrap_or("patient_portal"))) {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    if channel != "patient_portal" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Patient portal release channel must be patient_portal",
        );
    }

    match release_document_to_patient_portal_internal(
        &state,
        auth.user_id,
        id,
        body.requires_confirmation.unwrap_or(true),
    )
    .await
    {
        Ok(result) => Json(json!({
            "ok": true,
            "document_id": result.document_id,
            "patient_id": result.patient_id,
            "visibility": result.visibility,
            "recipient_count": result.recipient_count,
            "created_share_count": result.created_share_count,
            "requires_confirmation": result.requires_confirmation,
        }))
        .into_response(),
        Err(resp) => resp,
    }
}

async fn revoke_document_from_patient_portal(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    let Some(patient_id) = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default()
    else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only patient-linked documents can be revoked from the portal",
        );
    };

    let revoked_rows = match sqlx::query(
        r#"UPDATE document_shares ds
           SET revoked_at = now()
           FROM users u, patient_assignments pa
           WHERE ds.shared_with_user_id = u.id
             AND pa.user_id = u.id
             AND ds.document_id = $1
             AND pa.patient_id = $2
             AND pa.revoked_at IS NULL
             AND u.role = 'patient'
             AND ds.revoked_at IS NULL
           RETURNING ds.id, ds.shared_with_user_id"#,
    )
    .bind(id)
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, patient_id = %patient_id, "revoke patient portal release");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to revoke patient portal release",
            );
        }
    };

    if revoked_rows.is_empty() {
        return err(StatusCode::NOT_FOUND, "Patient portal release not found");
    }

    let revoked_share_ids: Vec<_> = revoked_rows
        .iter()
        .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
        .collect();

    state.audit_sender.try_send(audit::domain_event(
        "revoke_document_from_patient_portal",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({
            "patient_id": patient_id,
            "revoked_share_ids": revoked_share_ids,
        }),
    ));

    crate::realtime::publish_document_event(
        &state,
        Some(auth.user_id),
        "document.portal_revoked",
        id,
        json!({
            "patient_id": patient_id,
            "revoked_share_count": revoked_share_ids.len(),
        }),
    )
    .await;

    Json(json!({
        "ok": true,
        "document_id": id,
        "patient_id": patient_id,
        "revoked_share_count": revoked_share_ids.len(),
    }))
    .into_response()
}

async fn list_document_shares(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::CeoAssistant, Role::PatientManager])
    {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match sqlx::query(
        r#"SELECT ds.id, ds.document_id, ds.shared_with_provider_id, ds.shared_with_user_id,
                  ds.shared_by, ds.channel, ds.message, ds.requires_confirmation, ds.confirmed,
                  ds.confirmed_at, ds.shared_at, ds.revoked_at,
                  provider.name AS provider_name,
                  target_user.name AS target_user_name,
                  target_user.role AS target_user_role,
                  sharer.name AS shared_by_name
           FROM document_shares ds
           LEFT JOIN providers provider ON provider.id = ds.shared_with_provider_id
           LEFT JOIN users target_user ON target_user.id = ds.shared_with_user_id
           LEFT JOIN users sharer ON sharer.id = ds.shared_by
           WHERE ds.document_id = $1
           ORDER BY ds.shared_at DESC"#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items: Vec<_> = rows.iter().map(document_share_json).collect();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, "list document shares");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load shares")
        }
    }
}

async fn create_bulk_document_shares(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<BulkCreateShareRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    if body.document_ids.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provide at least one document to share",
        );
    }
    if body.document_ids.len() > 50 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Bulk share supports up to 50 documents per request",
        );
    }
    if let Err(resp) =
        validate_share_target_count(body.shared_with_provider_id, body.shared_with_user_id)
    {
        return resp;
    }

    let channel = match normalize_share_channel(body.channel.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let requires_confirmation = body.requires_confirmation.unwrap_or(false);
    let share_message = match normalize_document_share_message(
        body.shared_with_provider_id,
        body.message.as_deref(),
    ) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let mut unique_document_ids = Vec::new();
    let mut seen = HashSet::new();
    for document_id in body.document_ids {
        if seen.insert(document_id) {
            unique_document_ids.push(document_id);
        }
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let mut contexts = Vec::with_capacity(unique_document_ids.len());
    for document_id in unique_document_ids.iter().copied() {
        let row = match fetch_document_row(&state, document_id, auth.user_id).await {
            Ok(Some(row)) => row,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
            Err(resp) => return resp,
        };
        if !can_view_document_row(&auth, &row, &assignment_set) {
            return err(StatusCode::FORBIDDEN, "Insufficient permissions");
        }
        let context = match shareable_document_context_from_row(&row) {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        if let Err(resp) = validate_document_share_target(
            &state,
            &context,
            body.shared_with_provider_id,
            body.shared_with_user_id,
            &channel,
        )
        .await
        {
            return resp;
        }
        contexts.push(context);
    }

    let mut share_ids = Vec::with_capacity(contexts.len());
    for context in &contexts {
        let share_id = match insert_document_share(
            &state,
            DocumentShareInsert {
                document_id: context.document_id,
                auth_user_id: auth.user_id,
                shared_with_provider_id: body.shared_with_provider_id,
                shared_with_user_id: body.shared_with_user_id,
                channel: &channel,
                requires_confirmation,
                message: share_message.as_deref(),
            },
        )
        .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        share_ids.push(share_id);
    }

    state.audit_sender.try_send(audit::domain_event(
        "bulk_share_documents",
        Some(auth.user_id),
        "document",
        Some(
            contexts
                .first()
                .map(|context| context.document_id)
                .unwrap_or_else(Uuid::nil),
        ),
        json!({
            "document_ids": contexts.iter().map(|context| context.document_id).collect::<Vec<_>>(),
            "share_ids": share_ids,
            "shared_with_provider_id": body.shared_with_provider_id,
            "shared_with_user_id": body.shared_with_user_id,
            "channel": channel,
            "message": share_message,
            "requires_confirmation": requires_confirmation,
        }),
    ));

    Json(json!({
        "ok": true,
        "document_count": contexts.len(),
        "share_count": share_ids.len(),
        "document_ids": contexts.into_iter().map(|context| context.document_id).collect::<Vec<_>>(),
        "share_ids": share_ids,
    }))
    .into_response()
}

async fn create_document_share(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateShareRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    if let Err(resp) =
        validate_share_target_count(body.shared_with_provider_id, body.shared_with_user_id)
    {
        return resp;
    }

    let channel = match normalize_share_channel(body.channel.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let requires_confirmation = body.requires_confirmation.unwrap_or(false);
    let share_message = match normalize_document_share_message(
        body.shared_with_provider_id,
        body.message.as_deref(),
    ) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };
    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let document = match shareable_document_context_from_row(&row) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if let Err(resp) = validate_document_share_target(
        &state,
        &document,
        body.shared_with_provider_id,
        body.shared_with_user_id,
        &channel,
    )
    .await
    {
        return resp;
    }

    let share_id = match insert_document_share(
        &state,
        DocumentShareInsert {
            document_id: id,
            auth_user_id: auth.user_id,
            shared_with_provider_id: body.shared_with_provider_id,
            shared_with_user_id: body.shared_with_user_id,
            channel: &channel,
            requires_confirmation,
            message: share_message.as_deref(),
        },
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    state.audit_sender.try_send(audit::domain_event(
        "share_document",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({
            "share_id": share_id,
            "shared_with_provider_id": body.shared_with_provider_id,
            "shared_with_user_id": body.shared_with_user_id,
            "channel": channel,
            "message": share_message,
            "requires_confirmation": requires_confirmation,
        }),
    ));

    Json(json!({ "ok": true, "id": share_id })).into_response()
}

async fn revoke_document_share(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((id, share_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let assignment_set = match load_assignment_set(&state, &auth).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };
    if !can_view_document_row(&auth, &row, &assignment_set) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let result = match sqlx::query(
        r#"UPDATE document_shares
           SET revoked_at = now()
           WHERE id = $1 AND document_id = $2 AND revoked_at IS NULL"#,
    )
    .bind(share_id)
    .bind(id)
    .execute(&state.db)
    .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, share_id = %share_id, "revoke share");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to revoke share");
        }
    };
    if result.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Share not found");
    }

    state.audit_sender.try_send(audit::domain_event(
        "revoke_document_share",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({ "share_id": share_id }),
    ));

    Json(json!({ "ok": true })).into_response()
}

async fn confirm_document_share(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((id, share_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    let share = match sqlx::query(
        r#"SELECT shared_with_user_id
           FROM document_shares
           WHERE id = $1 AND document_id = $2 AND revoked_at IS NULL"#,
    )
    .bind(share_id)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Share not found"),
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, share_id = %share_id, "load share");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load share");
        }
    };

    let shared_with_user_id: Option<Uuid> =
        share.try_get("shared_with_user_id").unwrap_or_default();
    let can_confirm = matches!(auth.role, Role::Ceo | Role::PatientManager)
        || shared_with_user_id == Some(auth.user_id);
    if !can_confirm {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match sqlx::query(
        r#"UPDATE document_shares
           SET confirmed = true, confirmed_at = now()
           WHERE id = $1 AND document_id = $2"#,
    )
    .bind(share_id)
    .bind(id)
    .execute(&state.db)
    .await
    {
        Ok(_) => {
            state.audit_sender.try_send(audit::domain_event(
                "confirm_document_share",
                Some(auth.user_id),
                "document",
                Some(id),
                json!({ "share_id": share_id }),
            ));
            crate::realtime::publish_document_event(
                &state,
                Some(auth.user_id),
                "document.confirmed",
                id,
                json!({
                    "share_id": share_id,
                }),
            )
            .await;
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, document_id = %id, share_id = %share_id, "confirm share");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to confirm share")
        }
    }
}

async fn list_document_staff(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    match sqlx::query(
        r#"SELECT id, name, role
           FROM users
           WHERE is_active = true
             AND role IN ('ceo', 'patient_manager', 'teamlead_interpreter', 'interpreter', 'concierge', 'billing', 'it_admin')
           ORDER BY role, name"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items: Vec<_> = rows
                .into_iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "name": row.try_get::<String, _>("name").unwrap_or_default(),
                        "role": row.try_get::<String, _>("role").unwrap_or_default(),
                    })
                })
                .collect();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list document staff");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load document staff")
        }
    }
}

async fn list_document_categories(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::Billing,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let categories = match sqlx::query(
        r#"SELECT c.id,
                  c.name_de,
                  c.name_en,
                  c.is_medical,
                  c.description,
                  c.portal_group,
                  c.sort_order,
                  c.patient_visible,
                  c.parent_id,
                  c.level,
                  c.short_code,
                  c.access_category,
                  c.aliases,
                  parent.name_de AS parent_name_de,
                  parent.name_en AS parent_name_en
           FROM ref_document_categories c
           LEFT JOIN ref_document_categories parent ON parent.id = c.parent_id
           ORDER BY c.sort_order, c.name_en"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| {
                json!({
                    "key": row.try_get::<String, _>("id").unwrap_or_default(),
                    "label": row.try_get::<String, _>("name_en").unwrap_or_default(),
                    "label_de": row.try_get::<String, _>("name_de").unwrap_or_default(),
                    "label_en": row.try_get::<String, _>("name_en").unwrap_or_default(),
                    "is_medical": row.try_get::<bool, _>("is_medical").unwrap_or(false),
                    "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                    "portal_group": row.try_get::<String, _>("portal_group").unwrap_or_else(|_| "other".to_string()),
                    "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or(100),
                    "patient_visible": row.try_get::<bool, _>("patient_visible").unwrap_or(true),
                    "parent_key": row.try_get::<Option<String>, _>("parent_id").unwrap_or_default(),
                    "level": row.try_get::<String, _>("level").unwrap_or_else(|_| "type".to_string()),
                    "short_code": row.try_get::<Option<String>, _>("short_code").unwrap_or_default(),
                    "access_category": row.try_get::<Option<String>, _>("access_category").unwrap_or_default(),
                    "aliases": row.try_get::<Vec<String>, _>("aliases").unwrap_or_default(),
                    "breadcrumb_label": match row.try_get::<Option<String>, _>("parent_name_en").unwrap_or_default() {
                        Some(parent) if !parent.is_empty() => format!("{} / {}", parent, row.try_get::<String, _>("name_en").unwrap_or_default()),
                        _ => row.try_get::<String, _>("name_en").unwrap_or_default(),
                    },
                    "breadcrumb_label_de": match row.try_get::<Option<String>, _>("parent_name_de").unwrap_or_default() {
                        Some(parent) if !parent.is_empty() => format!("{} / {}", parent, row.try_get::<String, _>("name_de").unwrap_or_default()),
                        _ => row.try_get::<String, _>("name_de").unwrap_or_default(),
                    },
                })
            })
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };

    let arts = match sqlx::query(
        r#"SELECT DISTINCT art
           FROM documents
           WHERE art IS NOT NULL AND art <> ''
           ORDER BY art"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| row.try_get::<String, _>("art").unwrap_or_default())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };

    Json(json!({ "categories": categories, "arts": arts })).into_response()
}

#[cfg(test)]
mod tests {
    use super::{
        AdminSignatureParty, AgencyContractSettings, DocPartyBlock, DocumentBindingOverrides,
        GeneratedConsentContext, GeneratedContractLineItem, GeneratedCostEstimateContext,
        GeneratedFrameworkContractContext, GeneratedPatientStickerContext,
        GeneratedSingleOrderContext, PDF_PAGE_WIDTH_MM, ServiceLineInput, TreatmentPlanPdfLayout,
        admin_signature_grid, adult_legal_agency_identity, agency_block_lines,
        agency_identity_profile_lines, build_adult_confidentiality_release_pdf,
        build_adult_privacy_consents_pdf, build_adult_privacy_information_pdf, build_consent_pdf,
        build_cost_estimate_pdf, build_framework_contract_pdf, build_manual_generated_text_pdf,
        build_order_cost_estimate_pdf, build_patient_sticker_pdf, build_single_order_pdf,
        compute_line_item_totals, cost_coverage_money_cell, cost_estimate_price_text,
        document_satisfies_compliance_kind, document_template_by_id, finalize_admin_pdf,
        generated_binding_snapshot, generated_compliance_document_number,
        generated_document_number_for_template, german_document_country,
        is_fixed_legal_document_template, is_lead_allowed_document_template,
        legal_document_reference, new_admin_pdf, patient_sticker_agency_line, pdf_mm_to_pt,
        pdf_text_font_handles, trusted_contact_recipients_binding,
    };
    use crate::routes::patients::{PATIENT_LABEL_FORMATS, PatientLabelAgencySettings};
    use chrono::{NaiveDate, TimeZone, Utc};
    use printpdf::{BuiltinFont, Op, PdfFontHandle};
    use serde_json::json;
    use uuid::Uuid;

    const LEGAL_COMPANY_IDENTITY: &str = "Test Agentur - Agentur für Patientenbetreuung";
    const LEGAL_OWNER: &str = "Configured Owner";
    const LEGAL_FULL_IDENTITY: &str =
        "Test Agentur - Agentur für Patientenbetreuung Configured Owner";
    const LEGAL_ADDRESS_STREET: &str = "Albert-Schweitzer-Straße 56";
    const LEGAL_ADDRESS_CITY: &str = "81735 München";
    const LEGAL_PHONE: &str = "+49 176 22570962";
    const LEGAL_EMAIL: &str = "office@gmed-health.com";
    const LEGAL_WEBSITE: &str = "gmed-health.com";
    const LEGAL_DATA_CONTROLLER_STATEMENT: &str = "Verantwortlich für die Verarbeitung Ihrer Daten ist Configured Owner, Teststraße 1, Deutschland";

    fn legal_test_agency() -> AgencyContractSettings {
        AgencyContractSettings {
            name: LEGAL_COMPANY_IDENTITY.to_string(),
            care_of: Some("Configured Owner".to_string()),
            principal_birth_date: NaiveDate::from_ymd_opt(1975, 6, 3),
            address: Some(format!("{LEGAL_ADDRESS_STREET}\n{LEGAL_ADDRESS_CITY}")),
            phone: Some(LEGAL_PHONE.to_string()),
            email: Some(LEGAL_EMAIL.to_string()),
            website: Some(LEGAL_WEBSITE.to_string()),
            privacy_email: Some("datenschutz@example.test".to_string()),
            sign_place: "Köln".to_string(),
            data_system_name: "GMED-EDV-System".to_string(),
            data_controller_statement: LEGAL_DATA_CONTROLLER_STATEMENT.to_string(),
            data_processor_notice: Some(
                "Ein beauftragter Auftragsverarbeiter kann technisch beteiligt sein.".to_string(),
            ),
            ..Default::default()
        }
    }

    fn legal_test_party(country: &str) -> DocPartyBlock {
        DocPartyBlock {
            name: "Anna Beispiel".to_string(),
            salutation: Some("Frau".to_string()),
            first_name: Some("Anna".to_string()),
            last_name: Some("Beispiel".to_string()),
            birth_date: NaiveDate::from_ymd_opt(1988, 4, 12),
            street: Some("Musterstr. 1".to_string()),
            zip: Some("10115".to_string()),
            city: Some("Berlin".to_string()),
            country: Some(country.to_string()),
            email: Some("anna@example.test".to_string()),
            phone: Some("+49 30 123456".to_string()),
            ..Default::default()
        }
    }

    fn normalized_pdf_text(bytes: &[u8]) -> String {
        pdf_extract::extract_text_from_mem(bytes)
            .unwrap()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn normalized_pdf_pages(bytes: &[u8]) -> Vec<String> {
        pdf_extract::extract_text_from_mem_by_pages(bytes)
            .unwrap()
            .into_iter()
            .map(|page| page.split_whitespace().collect::<Vec<_>>().join(" "))
            .collect()
    }

    fn assert_legal_pdf_chrome(bytes: &[u8], document_reference: &str) -> String {
        let text = normalized_pdf_text(bytes);
        let pages = normalized_pdf_pages(bytes);
        let page_count = pages.len();
        assert!(page_count > 0);
        for page in &pages {
            assert!(page.contains("Dokument-Nr."));
            assert!(page.contains(document_reference));
        }
        for page_number in 1..=page_count {
            assert!(
                text.contains(&format!("Seite: {page_number}/{page_count}")),
                "missing total-aware legal page number {page_number}/{page_count}"
            );
        }
        assert!(text.matches(LEGAL_FULL_IDENTITY).count() >= page_count);
        assert!(text.matches(LEGAL_ADDRESS_STREET).count() >= page_count);
        assert!(text.matches(LEGAL_ADDRESS_CITY).count() >= page_count);
        assert!(text.matches(LEGAL_PHONE).count() >= page_count);
        assert!(text.matches(LEGAL_EMAIL).count() >= page_count);
        assert!(text.matches(LEGAL_WEBSITE).count() >= page_count);
        assert!(!text.contains("Patientenbetreuung /"));
        assert!(!text.to_ascii_lowercase().contains("c/o"));
        assert!(!text.contains("UTC"));
        text
    }

    #[test]
    fn compliance_document_numbers_encode_type_date_and_stable_id() {
        let document_id = Uuid::parse_str("01234567-89ab-cdef-0123-456789abcdef").unwrap();
        let generated_at = Utc.with_ymd_and_hms(2026, 7, 13, 9, 30, 0).unwrap();

        assert_eq!(
            generated_compliance_document_number(
                "confidentiality_release",
                document_id,
                generated_at,
            )
            .as_deref(),
            Some("SE-20260713-0123456789AB")
        );
        assert_eq!(
            generated_compliance_document_number("privacy_consents", document_id, generated_at)
                .as_deref(),
            Some("EW-20260713-0123456789AB")
        );
        assert_eq!(
            generated_compliance_document_number("privacy_information", document_id, generated_at,)
                .as_deref(),
            Some("DS-20260713-0123456789AB")
        );
        for template_id in [
            "framework_contract",
            "single_order",
            "order_cost_estimate",
            "cost_estimate",
        ] {
            assert!(
                generated_compliance_document_number(template_id, document_id, generated_at)
                    .is_none()
            );
        }
        assert_eq!(
            generated_document_number_for_template("framework_contract", document_id, generated_at,),
            "DOC-01234567"
        );
    }

    #[test]
    fn privacy_information_template_is_fixed_legal_but_not_consent_evidence() {
        let template = document_template_by_id("privacy_information").unwrap();
        assert_eq!(template.art, "privacy_information");
        assert_eq!(template.label, "Informationsblatt zum Datenschutz");
        assert_eq!(
            template.default_auto_name,
            "Informationsblatt zum Datenschutz"
        );
        assert_eq!(template.default_visibility, "patient_visible");
        assert!(is_fixed_legal_document_template(template.id));
        assert!(is_lead_allowed_document_template(template.id));

        assert!(!document_satisfies_compliance_kind(
            "dsgvo",
            Some("privacy_information"),
            "privacy_information"
        ));
        assert!(!document_satisfies_compliance_kind(
            "dsgvo",
            Some("privacy_information"),
            "consent"
        ));
        assert!(document_satisfies_compliance_kind("dsgvo", None, "consent"));
        assert!(document_satisfies_compliance_kind(
            "dsgvo",
            Some("privacy_consents"),
            "privacy_consents"
        ));
        assert!(document_satisfies_compliance_kind(
            "dsgvo",
            Some("consent_data_release_child"),
            "consent_data_release"
        ));
        assert!(document_satisfies_compliance_kind(
            "confidentiality_release",
            Some("confidentiality_release"),
            "confidentiality_release"
        ));
        assert!(!document_satisfies_compliance_kind(
            "confidentiality_release",
            Some("privacy_consents"),
            "privacy_consents"
        ));
    }

    #[test]
    fn canonical_lead_documents_keep_the_designed_pdf_renderer() {
        for template_id in [
            "framework_contract",
            "single_order",
            "order_cost_estimate",
            "cost_estimate",
            "confidentiality_release",
            "privacy_consents",
            "privacy_information",
        ] {
            assert!(is_fixed_legal_document_template(template_id));
        }
        assert!(!is_fixed_legal_document_template(
            "appointment_confirmation"
        ));
    }

    #[test]
    fn german_document_addresses_translate_known_countries_and_keep_free_text() {
        assert_eq!(german_document_country("DE"), "Deutschland");
        assert_eq!(german_document_country("Germany"), "Deutschland");
        assert_eq!(german_document_country("Austria"), "Österreich");
        assert_eq!(german_document_country("FR"), "Frankreich");
        assert_eq!(german_document_country("NL"), "Niederlande");
        assert_eq!(german_document_country("ES"), "Spanien");
        assert_eq!(german_document_country("IT"), "Italien");
        assert_eq!(german_document_country("US"), "Vereinigte Staaten");
        assert_eq!(german_document_country("Freitextland"), "Freitextland");
        assert_eq!(
            legal_test_party("Germany").address_line().as_deref(),
            Some("Musterstr. 1 | 10115 Berlin | Deutschland")
        );
    }

    #[test]
    fn agency_identity_profile_keeps_company_and_owner_separate() {
        let agency = legal_test_agency();
        let lines = agency_identity_profile_lines(&agency);

        assert_eq!(
            lines,
            vec![LEGAL_COMPANY_IDENTITY.to_string(), LEGAL_OWNER.to_string()]
        );
        assert_eq!(
            lines
                .iter()
                .filter(|line| line.as_str() == LEGAL_OWNER)
                .count(),
            1
        );
        let block_lines = agency_block_lines(&agency);
        assert_eq!(&block_lines[..2], lines.as_slice());
        assert_eq!(
            block_lines
                .iter()
                .filter(|line| line.as_str() == LEGAL_OWNER)
                .count(),
            1
        );
        assert!(
            !block_lines.iter().any(|line| {
                line.contains(LEGAL_COMPANY_IDENTITY) && line.contains(LEGAL_OWNER)
            })
        );
        assert_eq!(adult_legal_agency_identity(&agency), LEGAL_FULL_IDENTITY);
        assert_eq!(
            adult_legal_agency_identity(&agency)
                .matches(LEGAL_OWNER)
                .count(),
            1
        );

        let mut duplicated_profile = agency.clone();
        duplicated_profile.name = LEGAL_FULL_IDENTITY.to_string();
        assert_eq!(
            agency_identity_profile_lines(&duplicated_profile),
            vec![LEGAL_COMPANY_IDENTITY.to_string(), LEGAL_OWNER.to_string()]
        );
        assert_eq!(
            adult_legal_agency_identity(&duplicated_profile),
            LEGAL_FULL_IDENTITY
        );
        assert_eq!(
            adult_legal_agency_identity(&duplicated_profile)
                .matches(LEGAL_OWNER)
                .count(),
            1
        );

        let mut legacy_profile = agency;
        legacy_profile.care_of = Some("c/o Test Agentur".to_string());
        assert_eq!(
            agency_identity_profile_lines(&legacy_profile),
            vec![LEGAL_COMPANY_IDENTITY.to_string()]
        );
    }

    #[test]
    fn trusted_contact_pdf_binding_keeps_people_but_omits_relationships() {
        let binding = trusted_contact_recipients_binding(&json!([
            {
                "name": "Alex Beispiel",
                "birth_date": "1989-02-03",
                "email": "alex@example.test",
                "phone": "+49 30 123",
                "relation": "Vater"
            },
            {
                "name": "Maria Beispiel",
                "address": "Hauptstr. 2, Berlin",
                "relation": "Hut"
            }
        ]))
        .unwrap();

        assert_eq!(binding.lines().count(), 2);
        assert!(binding.contains("Alex Beispiel, geb. am 03.02.1989"));
        assert!(binding.contains("E-Mail: alex@example.test"));
        assert!(binding.contains("Tel.: +49 30 123"));
        assert!(binding.contains("Maria Beispiel, Adresse: Hauptstr. 2, Berlin"));
        assert!(!binding.contains("Vater"));
        assert!(!binding.contains("Hut"));
        assert!(!binding.contains("Beziehung:"));
    }

    #[test]
    fn child_consent_uses_legal_chrome_without_relationship_labels() {
        let context = GeneratedConsentContext {
            sole_guardian: false,
            auto_name: "Einverständniserklärung".to_string(),
            document_reference: "EW-20260721-UNITTEST0001".to_string(),
            child_name: Some("Kind Beispiel".to_string()),
            child_birth_date: NaiveDate::from_ymd_opt(2014, 5, 6),
            child_address: Some("Musterstr. 1 | 10115 Berlin | Deutschland".to_string()),
            guardian_name: Some("Alex Beispiel".to_string()),
            guardian_label: Some("Vater".to_string()),
            guardian_birth_date: NaiveDate::from_ymd_opt(1989, 2, 3),
            guardian_address: Some("Musterstr. 1, Berlin".to_string()),
            guardian2_name: Some("Maria Beispiel".to_string()),
            guardian2_label: Some("Hut".to_string()),
            guardian2_birth_date: NaiveDate::from_ymd_opt(1990, 4, 5),
            extra_release_recipients: None,
            agency: legal_test_agency(),
            generated_at: Utc.with_ymd_and_hms(2026, 7, 21, 12, 0, 0).unwrap(),
        };

        let bytes = build_consent_pdf(&context).unwrap();
        let text = assert_legal_pdf_chrome(&bytes, &context.document_reference);
        assert!(text.contains("Alex Beispiel, geb. am 03.02.1989"));
        assert!(text.contains("Maria Beispiel, geb. am 05.04.1990"));
        assert!(!text.contains("Vater"));
        assert!(!text.contains("Hut"));
        assert!(!text.to_ascii_lowercase().contains("c/o"));
    }

    #[test]
    fn patient_sticker_pdf_uses_renderable_builtin_font_text() {
        let mut context = GeneratedPatientStickerContext {
            patient_pid: "PT-UNIT-1".to_string(),
            patient_title: Some("Dr.".to_string()),
            patient_salutation: "Herr".to_string(),
            patient_first_name: "Max".to_string(),
            patient_last_name: "Müller".to_string(),
            birth_date: NaiveDate::from_ymd_opt(1990, 1, 1).unwrap(),
            country_code: Some("DE".to_string()),
            insurance_provider: Some("AOK Rheinland".to_string()),
            kt1: Some("KT1-UNIT".to_string()),
            kt2: Some("KT2-UNIT".to_string()),
            cost_code: Some("FRA".to_string()),
            agency: PatientLabelAgencySettings {
                name: "GMED Köln".to_string(),
                care_of: "c/o Ärzteteam".to_string(),
                address: Some("Agency Street 1, 50667 Cologne".to_string()),
                phone: Some("+49 221 123456".to_string()),
                email: Some("label@example.test".to_string()),
            },
            format: PATIENT_LABEL_FORMATS[1],
            auto_name: "Patientenetikett".to_string(),
            language: "de".to_string(),
            generated_at: chrono::Utc::now(),
        };

        let bytes = build_patient_sticker_pdf(&context).unwrap();
        let raw_pdf = String::from_utf8_lossy(&bytes);

        assert!(raw_pdf.contains("/F5"));
        assert!(raw_pdf.contains("/F6"));
        assert!(raw_pdf.contains("ID: PT-UNIT-1"));
        assert!(raw_pdf.contains("4DFC6C6C65722"));
        assert!(!raw_pdf.contains("4DC3BC6C6C65722"));
        assert!(!raw_pdf.contains("[] TJ"));

        let extracted_text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(extracted_text.contains("ID: PT-UNIT-1"));
        assert!(extracted_text.contains("Müller"));
        assert!(extracted_text.contains("Agency Street 1"));

        context.agency.name = "GMED - Agentur für Patientenbetreuung Heorhii Hudiiev".to_string();
        context.agency.care_of = "Heorhii Hudiiev".to_string();
        let agency_line = patient_sticker_agency_line(&context);
        assert_eq!(agency_line.matches("Heorhii Hudiiev").count(), 1);
    }

    #[test]
    fn document_pdf_font_handles_are_builtin_helvetica() {
        let (regular, bold) = pdf_text_font_handles();

        assert_eq!(regular, PdfFontHandle::Builtin(BuiltinFont::Helvetica));
        assert_eq!(bold, PdfFontHandle::Builtin(BuiltinFont::HelveticaBold));
    }

    #[test]
    fn manual_generated_document_pdf_preserves_editable_text() {
        let bytes = build_manual_generated_text_pdf(
            "Terminbestätigung",
            "Terminbestätigung",
            "Sehr geehrte Damen und Herren,\n\nIndividueller Text für den Patienten.",
            "DOC-MANUAL-1",
        )
        .unwrap();

        let raw_pdf = String::from_utf8_lossy(&bytes);
        assert!(raw_pdf.contains("/F5"));
        assert!(raw_pdf.contains("/F6"));

        let extracted_text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(extracted_text.contains("Dokument-Nr."));
        assert!(extracted_text.contains("DOC-MANUAL-1"));
        assert!(extracted_text.contains("Sehr geehrte Damen und Herren"));
        assert!(extracted_text.contains("Individueller Text für den Patienten"));
    }

    #[test]
    fn adult_legal_documents_follow_reference_structure_and_bind_dynamic_data() {
        let party = legal_test_party("Germany");
        let agency = legal_test_agency();
        let bindings = DocumentBindingOverrides {
            party_sign_place: Some("Berlin".to_string()),
            party_sign_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            extra_release_recipients: Some("Maria Beispiel, Vertrauenskontakt".to_string()),
            consent_privacy: Some(true),
            consent_healthcare: Some(true),
            consent_provider_release: Some(false),
            consent_email: Some(true),
            consent_threema: Some(true),
            consent_whatsapp: Some(false),
            consent_telegram: Some(true),
            ..Default::default()
        };

        let release = build_adult_confidentiality_release_pdf(
            &party,
            &agency,
            &bindings,
            "SE-20260716-UNITTEST0001",
        )
        .unwrap();
        let release_text = assert_legal_pdf_chrome(&release, "SE-20260716-UNITTEST0001");
        assert!(release_text.contains("Schweigepflichtentbindung"));
        assert!(release_text.contains("203 StGB"));
        assert!(release_text.contains("Anlage 2"));
        assert!(!release_text.contains("Anlage 1"));
        assert!(!release_text.contains("Anlage 3"));
        assert!(!release_text.contains("Anlage 4"));
        assert!(release_text.contains("Deutschland"));
        assert!(release_text.contains("den von ihm beauftragten Mitarbeitenden"));
        assert!(!release_text.contains("Maria Beispiel, Vertrauenskontakt"));
        assert!(!release_text.contains('?'));

        let consent = build_adult_privacy_consents_pdf(
            &party,
            &agency,
            &bindings,
            "EW-20260716-UNITTEST0001",
        )
        .unwrap();
        let consent_text = assert_legal_pdf_chrome(&consent, "EW-20260716-UNITTEST0001");
        assert!(consent_text.contains("Anlage 1"));
        assert!(consent_text.contains("Einverständniserklärung zur Datenübermittlung"));
        assert!(!consent_text.contains("Anlage 3"));
        assert!(!consent_text.contains("Informationsblatt zum Datenschutz"));
        assert!(!consent_text.contains("Kategorien der verarbeiteten personenbezogenen Daten"));
        assert!(!consent_text.contains("datenschutz@example.test"));
        assert!(consent_text.contains("Deutschland"));
        assert!(consent_text.contains("anna@example.test"));
        assert!(consent_text.contains("GMED-EDV-System"));
        assert!(consent_text.contains("Maria Beispiel, Vertrauenskontakt"));
        assert!(!consent_text.contains("[x]"));
        assert!(consent_text.contains("[ ]"));
        assert!(consent_text.contains("[ ] Threema-Messenger"));
        assert!(consent_text.contains("[ ] WhatsApp-Messenger"));
        assert!(consent_text.contains("[ ] Telegram-Messenger"));
        assert!(!consent_text.contains('?'));

        let privacy_information =
            build_adult_privacy_information_pdf(&agency, "DS-20260716-UNITTEST0001").unwrap();
        let privacy_information_text =
            assert_legal_pdf_chrome(&privacy_information, "DS-20260716-UNITTEST0001");
        assert!(privacy_information_text.contains("Anlage 3"));
        assert!(privacy_information_text.contains("Informationsblatt zum Datenschutz"));
        assert!(
            privacy_information_text
                .contains("Kategorien der verarbeiteten personenbezogenen Daten")
        );
        assert!(privacy_information_text.contains("Betroffenenrechte"));
        assert!(privacy_information_text.contains("datenschutz@example.test"));
        assert!(privacy_information_text.contains("Name des Verantwortlichen"));
        assert!(privacy_information_text.contains(LEGAL_DATA_CONTROLLER_STATEMENT));
        assert!(!privacy_information_text.contains("Heorhii Hudiiev, geb. am 12.12.1994"));
        assert!(!privacy_information_text.contains("Anna Beispiel"));
        assert!(!privacy_information_text.contains('?'));
    }

    #[test]
    fn framework_contract_pdf_keeps_main_contract_and_annex_index_only() {
        let party = legal_test_party("Germany");
        let agency = legal_test_agency();
        let context = GeneratedFrameworkContractContext {
            patient_pid: "PT-LEGAL-1".to_string(),
            patient_name: party.name.clone(),
            patient_title: party.title.clone(),
            birth_date: party.birth_date,
            patient_address: party.address_line(),
            patient_email: party.email.clone(),
            patient_phone: party.phone.clone(),
            patient_salutation: party.salutation.clone(),
            language: "de".to_string(),
            auto_name: "Rahmenvertrag".to_string(),
            title_override: None,
            introduction: None,
            closing_note: None,
            agency,
            party_sign_place: Some("Potsdam".to_string()),
            party_sign_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            agency_sign_place: Some("Köln".to_string()),
            agency_sign_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            effective_date: NaiveDate::from_ymd_opt(2026, 7, 1),
            cost_threshold: Some("500".to_string()),
            order_sequence: 1,
            extra_release_recipients: None,
            contract_number: "RV-2026-0042".to_string(),
            contract_status: "draft".to_string(),
            valid_from: NaiveDate::from_ymd_opt(2026, 7, 1),
            valid_to: None,
            signed_at: None,
            order_number: None,
            quote_number: None,
            quote_valid_until: None,
            quote_total_net: None,
            quote_total_vat: None,
            quote_total_gross: None,
            quote_notes: None,
            conditions: Vec::new(),
            line_items: Vec::new(),
            text_blocks: Vec::new(),
            generated_at: Utc.with_ymd_and_hms(2026, 7, 16, 9, 30, 0).unwrap(),
        };

        let bytes = build_framework_contract_pdf(&context, "DOC-FRAMEWORK-FALLBACK").unwrap();
        let pages = normalized_pdf_pages(&bytes);
        assert!(
            pages.len() >= 2,
            "framework contract must have a second page"
        );
        assert!(pages[0].contains("RAHMENDIENSTLEISTUNGSVERTRAG"));
        assert!(!pages[0].contains("Präambel"));
        assert!(pages[1].contains("Präambel"));
        let text = assert_legal_pdf_chrome(&bytes, "RV-2026-0042");
        assert!(!text.contains("DOC-FRAMEWORK-FALLBACK"));
        assert!(text.contains("Deutschland"));
        assert!(text.contains(LEGAL_ADDRESS_STREET));
        assert!(text.contains(LEGAL_ADDRESS_CITY));
        assert!(text.contains("500,00 EUR der Gesamtsumme"));
        assert!(text.contains("Der Vertrag tritt zum 01.07.2026"));
        assert!(text.contains("Köln, den 16.07.2026"));
        assert!(text.contains("Potsdam, den 16.07.2026"));
        assert!(text.contains("nachfolgend „Auftraggeber“ genannt"));
        assert!(text.contains("nachfolgend „Auftragnehmer“ genannt"));
        assert!(text.contains("gemeinsam „Vertragsparteien“ genannt"));
        for heading in [
            "§ 1 Vertragsgegenstand",
            "§ 2 Vergütung",
            "§ 3 Vertraulichkeit",
            "§ 4 Gewährleistung & Haftung",
            "§ 5 Nutzung von Online-Diensten und Telemedien",
            "§ 6 Vertragslaufzeit & Kündigung",
            "§ 7 Sprache & anwendbares Recht",
            "§ 8 Erfüllungsort",
            "§ 9 Änderungen & Ergänzungen",
            "§ 10 Salvatorische Klausel",
            "§ 11 Bestandteile des Vertrages und Rangfolge",
        ] {
            assert!(
                text.contains(heading),
                "missing framework heading: {heading}"
            );
        }
        for annex in [
            "Anlage 1: Einverständnis zur Datenübermittlung",
            "Anlage 2: Schweigepflichtentbindung",
            "Anlage 3: Informationsblatt zum Datenschutz",
        ] {
            assert!(text.contains(annex), "missing annex index entry: {annex}");
        }
        assert!(text.contains(
            "Die entsprechende Vorlage des Einzelauftrags wird separat als eigenes Dokument generiert"
        ));
        assert!(!text.contains("Anlage 4"));
        assert!(!text.contains("beigefügt"));
        for annex_body_marker in [
            "bitte ankreuzen",
            "Daher entbinde ich alle meine behandelnden Ärzte",
            "Kategorien der verarbeiteten personenbezogenen Daten",
            "EINZELAUFTRAG ZUM RAHMENDIENSTLEISTUNGSVERTRAG",
        ] {
            assert!(
                !text.contains(annex_body_marker),
                "embedded annex body marker: {annex_body_marker}"
            );
        }
    }

    #[test]
    fn admin_signature_grid_places_client_left_and_agency_right() {
        let (document, regular, bold) = new_admin_pdf().unwrap();
        let mut layout = TreatmentPlanPdfLayout::new("Signatures".to_string(), regular, bold);

        admin_signature_grid(
            &mut layout,
            AdminSignatureParty {
                place: Some("Berlin"),
                date: NaiveDate::from_ymd_opt(2026, 7, 17),
                name: "Anna Beispiel",
                role: "Auftraggeber",
            },
            AdminSignatureParty {
                place: Some("Köln"),
                date: NaiveDate::from_ymd_opt(2026, 7, 16),
                name: "GMED - Agentur für Patientenbetreuung",
                role: "Auftragnehmer",
            },
        );

        let cursor_x_positions = layout
            .page_ops
            .iter()
            .filter_map(|op| match op {
                Op::SetTextCursor { pos } => Some(pos.x.0),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(cursor_x_positions.len(), 4);
        let page_midpoint_pt = pdf_mm_to_pt(PDF_PAGE_WIDTH_MM / 2.0).0;
        assert!(
            cursor_x_positions[..2]
                .iter()
                .all(|x| *x < page_midpoint_pt)
        );
        assert!(
            cursor_x_positions[2..]
                .iter()
                .all(|x| *x > page_midpoint_pt)
        );

        let text = normalized_pdf_text(&finalize_admin_pdf(document, layout));
        for expected in [
            "Berlin, den 17.07.2026",
            "Auftraggeber",
            "GMED - Agentur für Patientenbetreuung",
            "Köln, den 16.07.2026",
            "Unterschrift, Stempel",
        ] {
            assert!(
                text.contains(expected),
                "missing signature text: {expected}"
            );
        }
    }

    #[test]
    fn single_order_and_order_cost_estimate_are_separate_legal_documents() {
        let context = GeneratedSingleOrderContext {
            language: "de".to_string(),
            auto_name: "Einzelauftrag".to_string(),
            title_override: None,
            patient_pid: "PT-LEGAL-2".to_string(),
            party: legal_test_party("Germany"),
            agency: AgencyContractSettings {
                bank_holder: Some("GMED Testkonto".to_string()),
                bank_name: Some("Testbank".to_string()),
                bank_swift: Some("TESTDEFF".to_string()),
                bank_iban: Some("DE00 0000 0000 0000 0000 00".to_string()),
                ..legal_test_agency()
            },
            order_number: "EA-2026-0017".to_string(),
            contract_number: Some("RV-2026-0042".to_string()),
            order_sequence: 2,
            order_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            contract_date: NaiveDate::from_ymd_opt(2026, 7, 1),
            specialties: Some("Kardiologie".to_string()),
            examination_purpose: Some("kardiologischen Untersuchung".to_string()),
            treatment_purpose: Some("kardiologische Behandlung".to_string()),
            order_components: Some(
                "Anlage 1 zum 2. Einzelauftrag: Kostenvoranschlag Nr.: KV-2026-0042 (separates Dokument)"
                    .to_string(),
            ),
            period_from: NaiveDate::from_ymd_opt(2026, 8, 3),
            period_to: NaiveDate::from_ymd_opt(2026, 8, 7),
            payer: None,
            quote_number: Some("KV-2026-0042".to_string()),
            line_items: vec![
                GeneratedContractLineItem {
                    description: "Organisation der Behandlung (pro 1 Ärzte) (im Zeitraum 17.12.2025 bis 19.12.2025)".to_string(),
                    quantity: "5".to_string(),
                    unit_price: "100,00 EUR".to_string(),
                    line_gross: "500,00 EUR".to_string(),
                    vat_rate: Some("19".to_string()),
                    notes: Some("Leistungsumfang 10, 11".to_string()),
                },
                GeneratedContractLineItem {
                    description: "Beratungsleistungen (auch telefonisch) und Datenmanagement"
                        .to_string(),
                    quantity: "1".to_string(),
                    unit_price: "999,00 EUR".to_string(),
                    line_gross: "999,00 EUR".to_string(),
                    vat_rate: Some("19".to_string()),
                    notes: None,
                },
                GeneratedContractLineItem {
                    description: "Dolmetscher-/Betreuungsleistung".to_string(),
                    quantity: "8".to_string(),
                    unit_price: "100,00 EUR/1 Stunde".to_string(),
                    line_gross: "800,00 EUR".to_string(),
                    vat_rate: Some("19".to_string()),
                    notes: None,
                },
            ],
            total_net: Some("2.299,00 EUR".to_string()),
            total_vat: Some("436,81 EUR".to_string()),
            total_gross: Some("2.735,81 EUR".to_string()),
            party_sign_place: Some("Berlin".to_string()),
            party_sign_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            agency_sign_place: Some("Köln".to_string()),
            agency_sign_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            generated_at: Utc.with_ymd_and_hms(2026, 7, 16, 10, 0, 0).unwrap(),
        };

        let bytes = build_single_order_pdf(&context, "DOC-ORDER-FALLBACK").unwrap();
        let pages = normalized_pdf_pages(&bytes);
        assert!(pages.len() >= 2, "single order must have a second page");
        assert!(pages[0].contains("Auftragsnummer: EA-2026-0017"));
        assert!(!pages[0].contains("Präambel"));
        assert!(pages[1].contains("Präambel"));
        let text = assert_legal_pdf_chrome(&bytes, "EA-2026-0017");
        assert!(!text.contains("DOC-ORDER-FALLBACK"));
        assert!(!text.contains("Anlage 4"));
        assert!(text.contains("Auftragsnummer: EA-2026-0017"));
        assert!(text.contains("Rahmendienstleistungsvertrag Nr.: RV-2026-0042"));
        assert!(!text.contains("geb. am 12.04.1988"));
        assert!(text.contains("Deutschland"));
        assert!(text.contains("Köln, den 16.07.2026"));
        assert!(text.contains("Berlin, den 16.07.2026"));
        assert!(text.contains("I. Leistungsumfang"));
        assert!(!text.contains("1. Individuelle Beratung"));
        assert!(text.contains("II. Vergütungsvereinbarung"));
        assert!(text.contains("IX. Bestandteile des Einzelauftrages und Rangfolge"));
        assert!(text.contains("Kostenvoranschlag Nr.: KV-2026-0042"));
        assert!(!text.contains("Kontoinhaber: GMED Testkonto"));
        assert!(!text.contains("Bank: Testbank"));
        assert!(!text.contains("SWIFT-Code: TESTDEFF"));
        assert!(!text.contains("IBAN: DE00 0000 0000 0000 0000 00"));
        assert!(!text.contains("Zahlungen aus diesem Einzelauftrag sind auf das folgende Konto"));
        assert!(!text.contains(
            "Der angegebene Gesamtbetrag ist vor Behandlungs-/Auftragsbeginn zu überweisen an"
        ));
        assert!(!text.contains("Ggf. fordern wir während der Durchführung des Auftrages"));
        assert!(text.contains("Organisation der Behandlung"));
        assert!(text.contains("Beratungsleistungen (auch telefonisch) und Datenmanagement"));
        assert!(text.contains("Dolmetscher-/Betreuungsleistung"));
        assert!(text.contains("HONORAR*"));
        assert!(text.contains("ANMERKUNG"));
        assert!(!text.contains("Leistungsumfang 10, 11"));
        assert!(!text.contains("Leistung — Einzelpreis — Menge — Summe"));
        assert!(!text.contains("Gesamtsumme: 476,00 EUR"));

        let estimate_bytes = build_order_cost_estimate_pdf(&context, "DOC-QUOTE-FALLBACK").unwrap();
        let estimate_text = assert_legal_pdf_chrome(&estimate_bytes, "KV-2026-0042");
        assert!(!estimate_text.contains("DOC-QUOTE-FALLBACK"));
        assert!(estimate_text.contains("Anlage 1 zum Einzelauftrag"));
        assert!(estimate_text.contains("KOSTENVORANSCHLAG"));
        assert!(estimate_text.contains("ZUM 2. EINZELAUFTRAG"));
        assert!(estimate_text.contains("Kostenvoranschlag Nr. :"));
        assert!(estimate_text.contains("KV-2026-0042"));
        assert!(estimate_text.contains("Geburtsdatum des Auftraggebers:"));
        assert!(estimate_text.contains("12.04.1988"));
        assert!(estimate_text.contains("Rahmendienstleistungsvertrag vom:"));
        assert!(!estimate_text.contains("Auftragsnummer: EA-2026-0017"));
        assert!(estimate_text.contains("HONORAR PRO EINHEIT"));
        assert!(estimate_text.contains("VORAUSSICHTLICHER AUFWAND (IN EINHEITEN)"));
        assert!(estimate_text.contains("Nettowert:"));
        assert!(estimate_text.contains("MWSt. 19%:"));
        assert!(estimate_text.contains("Gesamtsumme:"));
        assert!(estimate_text.contains("Organisation der Behandlung"));
        assert!(
            estimate_text.contains("Beratungsleistungen (auch telefonisch) und Datenmanagement")
        );
        assert!(estimate_text.contains("Dolmetscher-/Betreuungsleistung"));
        assert!(estimate_text.contains("100,00 EUR/1 Stunde"));
        assert!(estimate_text.contains("2.299,00 EUR"));
        assert!(estimate_text.contains("436,81 EUR"));
        assert!(estimate_text.contains("2.735,81 EUR"));
        let intro_block = [
            "Sehr geehrte Damen und Herren",
            "hiermit erhalten Sie eine Übersicht über die zu erwartenden Kosten",
            "Bitte beachten Sie, dass es sich lediglich um eine vorläufige Berechnung handelt",
            "Höhere Kosten können sich z.B. bei Komplikationen",
        ];
        let table_position = estimate_text
            .find("HONORAR PRO EINHEIT")
            .expect("missing estimate table header");
        let mut previous_intro_position = 0;
        for line in intro_block {
            let position = estimate_text
                .find(line)
                .unwrap_or_else(|| panic!("missing estimate intro line: {line}"));
            assert!(
                position >= previous_intro_position && position < table_position,
                "estimate intro line is not before the table: {line}"
            );
            previous_intro_position = position;
        }
        assert!(estimate_text.contains("Kontoinhaber: GMED Testkonto"));
        assert!(estimate_text.contains("Bank: Testbank"));
        assert!(estimate_text.contains("SWIFT-Code: TESTDEFF"));
        assert!(estimate_text.contains("IBAN: DE00 0000 0000 0000 0000 00"));
        assert!(estimate_text.contains(
            "Der angegebene Gesamtbetrag ist vor Behandlungs-/Auftragsbeginn zu überweisen an"
        ));
        assert!(estimate_text.contains("Ggf. fordern wir während der Durchführung des Auftrages"));
        assert!(estimate_text.contains(
            "Die in der Endabrechnung angegebenen, angefallenen Kosten für von uns erbrachte Leistungen und Auslagen sind nach Zugang der Rechnung binnen 14 Tagen"
        ));
        let payment_block = [
            "Der angegebene Gesamtbetrag ist vor Behandlungs-/Auftragsbeginn zu überweisen an",
            "Kontoinhaber: GMED Testkonto",
            "Bank: Testbank",
            "SWIFT-Code: TESTDEFF",
            "IBAN: DE00 0000 0000 0000 0000 00",
            "Ggf. fordern wir während der Durchführung des Auftrages zu weiteren Vorauszahlungen auf",
            "Die in der Endabrechnung angegebenen, angefallenen Kosten",
        ];
        let mut previous_position = estimate_text
            .find("Gesamtsumme:")
            .expect("missing total row before payment block");
        for line in payment_block {
            let position = estimate_text
                .find(line)
                .unwrap_or_else(|| panic!("missing payment block line: {line}"));
            assert!(
                position >= previous_position,
                "payment block line is out of order: {line}"
            );
            previous_position = position;
        }
        assert!(estimate_text.contains("Berlin, den 16.07.2026"));
    }

    #[test]
    fn cost_estimate_pdf_uses_quote_number_and_shared_legal_chrome() {
        let context = GeneratedCostEstimateContext {
            language: "de".to_string(),
            auto_name: "Kostenschätzung".to_string(),
            title_override: None,
            patient: legal_test_party("Germany"),
            patient_pid: "PT-LEGAL-3".to_string(),
            quote_number: Some("KV-2026-0099".to_string()),
            estimate_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            line_items: vec![GeneratedContractLineItem {
                description: "Kardiologische Untersuchung".to_string(),
                quantity: "1".to_string(),
                unit_price: "100,00 - 1000,00 EUR".to_string(),
                line_gross: "100,00 - 1000,00 EUR".to_string(),
                vat_rate: None,
                notes: None,
            }],
            total_range: Some("100,00 - 1000,00 EUR".to_string()),
            agency: legal_test_agency(),
            generated_at: Utc.with_ymd_and_hms(2026, 7, 16, 10, 30, 0).unwrap(),
        };

        let bytes = build_cost_estimate_pdf(&context, "DOC-COST-FALLBACK").unwrap();
        let text = assert_legal_pdf_chrome(&bytes, "KV-2026-0099");
        assert!(!text.contains("DOC-COST-FALLBACK"));
        assert!(text.contains("Unverbindliche voraussichtliche Kostenschätzung"));
        assert!(text.contains("Patient: Frau Anna Beispiel"));
        assert!(text.contains("Kardiologische Untersuchung"));
        assert!(text.contains("100,00 - 1000,00 EUR"));
    }

    #[test]
    fn legal_document_reference_hides_technical_version_suffix() {
        assert_eq!(
            legal_document_reference(Some(" FC-20260714-0010-V18 "), "DOC-FALLBACK"),
            "FC-20260714-0010"
        );
        assert_eq!(
            legal_document_reference(Some("KV-20260721-0019-V01"), "DOC-FALLBACK"),
            "KV-20260721-0019"
        );
        assert_eq!(
            legal_document_reference(Some("KV-20260721-0019-VX"), "DOC-FALLBACK"),
            "KV-20260721-0019-VX"
        );
        assert_eq!(
            legal_document_reference(Some("  "), "DOC-FALLBACK"),
            "DOC-FALLBACK"
        );
    }

    #[test]
    fn cost_estimate_price_preserves_operator_ranges() {
        assert_eq!(
            cost_estimate_price_text("100,00 - 1000,00 €"),
            "100,00 - 1000,00 €"
        );
        assert_eq!(cost_estimate_price_text("1428.00"), "1.428,00 EUR");
    }

    #[test]
    fn cost_coverage_price_preserves_rate_units() {
        assert_eq!(
            cost_coverage_money_cell("100,00 EUR/1 Stunde").as_deref(),
            Some("100,00 EUR/1 Stunde")
        );
        assert_eq!(
            cost_coverage_money_cell("999.00").as_deref(),
            Some("999,00 EUR")
        );
        assert_eq!(
            cost_coverage_money_cell("2735.81").as_deref(),
            Some("2.735,81 EUR")
        );
    }

    #[test]
    fn manual_line_totals_multiply_unit_price_by_quantity() {
        let totals = compute_line_item_totals(&[GeneratedContractLineItem {
            description: "Dolmetscher".to_string(),
            quantity: "4".to_string(),
            unit_price: "100,00 EUR/1 Stunde".to_string(),
            line_gross: String::new(),
            vat_rate: None,
            notes: None,
        }])
        .unwrap();

        assert_eq!(totals.0, "400,00 EUR");
        assert_eq!(totals.1, "76,00 EUR");
        assert_eq!(totals.2, "476,00 EUR");
    }

    #[test]
    fn generated_binding_snapshot_omits_unsubmitted_null_and_empty_fields() {
        let snapshot = generated_binding_snapshot(&DocumentBindingOverrides {
            party_sign_place: Some("Paris".to_string()),
            service_lines: vec![ServiceLineInput {
                description: "Dolmetscher".to_string(),
                fee: Some("100,00 EUR/1 Stunde".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        });

        assert_eq!(
            snapshot,
            Some(json!({
                "party_sign_place": "Paris",
                "service_lines": [{
                    "description": "Dolmetscher",
                    "fee": "100,00 EUR/1 Stunde"
                }]
            }))
        );
    }

    /// Dev utility: set `GMED_SAMPLE_PDF_DIR` to write branded sample PDFs for
    /// visual review of the document design. Skipped otherwise (CI-safe).
    #[test]
    fn writes_branded_sample_pdfs_when_requested() {
        let Ok(dir) = std::env::var("GMED_SAMPLE_PDF_DIR") else {
            return;
        };
        let context = GeneratedSingleOrderContext {
            language: "de".to_string(),
            auto_name: "Einzelauftrag".to_string(),
            title_override: None,
            patient_pid: "PT-SAMPLE-1".to_string(),
            party: legal_test_party("Germany"),
            agency: AgencyContractSettings {
                bank_holder: Some("GMED Testkonto".to_string()),
                bank_name: Some("Testbank".to_string()),
                bank_swift: Some("TESTDEFF".to_string()),
                bank_iban: Some("DE00 0000 0000 0000 0000 00".to_string()),
                ..legal_test_agency()
            },
            order_number: "EA-2026-0017".to_string(),
            contract_number: Some("RV-2026-0042".to_string()),
            order_sequence: 2,
            order_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            contract_date: NaiveDate::from_ymd_opt(2026, 7, 1),
            specialties: Some("Kardiologie".to_string()),
            examination_purpose: Some("kardiologischen Untersuchung".to_string()),
            treatment_purpose: Some("kardiologische Behandlung".to_string()),
            order_components: Some(
                "Anlage 1 zum 2. Einzelauftrag: Kostenvoranschlag Nr.: KV-2026-0042 (separates Dokument)"
                    .to_string(),
            ),
            period_from: NaiveDate::from_ymd_opt(2026, 8, 3),
            period_to: NaiveDate::from_ymd_opt(2026, 8, 7),
            payer: None,
            quote_number: Some("KV-2026-0042".to_string()),
            line_items: vec![
                GeneratedContractLineItem {
                    description: "Organisation der Behandlung (pro 1 Ärzte)".to_string(),
                    quantity: "5".to_string(),
                    unit_price: "100,00 EUR".to_string(),
                    line_gross: "500,00 EUR".to_string(),
                    vat_rate: Some("19".to_string()),
                    notes: Some("Leistungsumfang 10, 11".to_string()),
                },
                GeneratedContractLineItem {
                    description: "Beratungsleistungen (auch telefonisch) und Datenmanagement"
                        .to_string(),
                    quantity: "1".to_string(),
                    unit_price: "999,00 EUR".to_string(),
                    line_gross: "999,00 EUR".to_string(),
                    vat_rate: Some("19".to_string()),
                    notes: None,
                },
                GeneratedContractLineItem {
                    description: "Dolmetscher-/Betreuungsleistung".to_string(),
                    quantity: "8".to_string(),
                    unit_price: "100,00 EUR/1 Stunde".to_string(),
                    line_gross: "800,00 EUR".to_string(),
                    vat_rate: Some("19".to_string()),
                    notes: None,
                },
            ],
            total_net: Some("2.299,00 EUR".to_string()),
            total_vat: Some("436,81 EUR".to_string()),
            total_gross: Some("2.735,81 EUR".to_string()),
            party_sign_place: Some("Berlin".to_string()),
            party_sign_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            agency_sign_place: Some("Köln".to_string()),
            agency_sign_date: NaiveDate::from_ymd_opt(2026, 7, 16),
            generated_at: Utc.with_ymd_and_hms(2026, 7, 16, 10, 0, 0).unwrap(),
        };

        let bytes = build_single_order_pdf(&context, "DOC-ORDER-SAMPLE").unwrap();
        let target = std::path::Path::new(&dir).join("gmed-sample-einzelauftrag.pdf");
        std::fs::write(&target, bytes).unwrap();

        let estimate_bytes = build_order_cost_estimate_pdf(&context, "DOC-QUOTE-SAMPLE").unwrap();
        let estimate_target = std::path::Path::new(&dir).join("gmed-sample-kostenvoranschlag.pdf");
        std::fs::write(&estimate_target, estimate_bytes).unwrap();
    }
}
