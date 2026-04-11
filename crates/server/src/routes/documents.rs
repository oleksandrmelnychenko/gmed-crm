use std::{
    collections::{BTreeMap, HashSet},
    path::Path as FsPath,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Extension, Multipart, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Datelike, NaiveDate, NaiveTime, Weekday};
use printpdf::{
    Color, Mm, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, PdfWarnMsg,
    Point, Pt, Rgb, TextItem,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    access,
    auth::middleware::AuthUser,
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

const MAX_FILE_SIZE: usize = 25 * 1024 * 1024;
const UPLOAD_DIR: &str = "uploads/documents";
const PDF_PAGE_WIDTH_MM: f32 = 210.0;
const PDF_PAGE_HEIGHT_MM: f32 = 297.0;
const PDF_LEFT_MARGIN_MM: f32 = 18.0;
const PDF_RIGHT_MARGIN_MM: f32 = 18.0;
const PDF_TOP_MARGIN_MM: f32 = 18.0;
const PDF_BOTTOM_MARGIN_MM: f32 = 16.0;
const PDF_FOOTER_GAP_MM: f32 = 10.0;
const PDF_CONTENT_WIDTH_MM: f32 = PDF_PAGE_WIDTH_MM - PDF_LEFT_MARGIN_MM - PDF_RIGHT_MARGIN_MM;
const TREATMENT_PLAN_ARIAL_TTF: &[u8] =
    include_bytes!("../../../../docs/comparison/fonts/arial.ttf");
const TREATMENT_PLAN_ARIAL_BOLD_TTF: &[u8] =
    include_bytes!("../../../../docs/comparison/fonts/arialbd.ttf");

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

struct GeneratedFrameworkContractContext {
    patient_pid: String,
    patient_name: String,
    patient_title: Option<String>,
    birth_date: Option<NaiveDate>,
    language: String,
    auto_name: String,
    title_override: Option<String>,
    introduction: Option<String>,
    closing_note: Option<String>,
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

struct GeneratedPatientStickerContext {
    patient_pid: String,
    patient_title: Option<String>,
    patient_salutation: String,
    patient_first_name: String,
    patient_last_name: String,
    birth_date: NaiveDate,
    country_code: Option<String>,
    insurance_provider: Option<String>,
    agency: PatientLabelAgencySettings,
    format: PatientLabelFormat,
    auto_name: String,
    language: String,
    generated_at: chrono::DateTime<chrono::Utc>,
}

struct NewStoredDocument<'a> {
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    auto_name: &'a str,
    original_filename: &'a str,
    art: &'a str,
    category: Option<&'a str>,
    status: &'a str,
    visibility: &'a str,
    is_medical: bool,
    mime_type: &'a str,
    klinik: Option<&'a str>,
    ursprung: Option<&'a str>,
    notes: Option<&'a str>,
    uploaded_by: Uuid,
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
        label: "Patient Treatment Plan",
        description: "Print-ready multilingual treatment schedule grouped by day with reusable hint blocks.",
        art: "treatment_plan",
        category: "generated",
        default_auto_name: "Treatment plan",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: true,
        languages: &["de", "en", "uk"],
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
        label: "Patient Medication Summary",
        description: "Consolidated multilingual medication overview across the current patient case scope.",
        art: "medication_summary",
        category: "generated",
        default_auto_name: "Medication summary",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: true,
        languages: &["de", "en", "uk"],
        text_block_keys: &[
            "doctor_changes_only",
            "carry_updated_list",
            "temporary_medication_review",
        ],
    },
    DocumentTemplateDefinition {
        id: "framework_contract",
        label: "Framework Contract",
        description: "Patient-facing framework contract generated from contract data and reusable clauses.",
        art: "framework_contract",
        category: "generated",
        default_auto_name: "Framework contract",
        default_status: "draft",
        default_visibility: "patient_visible",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de", "en", "uk"],
        text_block_keys: &[
            "contract_scope_clause",
            "quote_reference_clause",
            "cost_passthrough_clause",
            "privacy_contract_clause",
        ],
    },
    DocumentTemplateDefinition {
        id: "patient_sticker_compact",
        label: "Patient Sticker · Compact 90 x 48 mm",
        description: "Compact patient sticker including agency contact block.",
        art: "patient_sticker",
        category: "generated",
        default_auto_name: "Patient sticker",
        default_status: "draft",
        default_visibility: "internal",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de", "en", "uk"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "patient_sticker_standard",
        label: "Patient Sticker · Standard 105 x 74 mm",
        description: "Standard patient sticker including agency contact block.",
        art: "patient_sticker",
        category: "generated",
        default_auto_name: "Patient sticker",
        default_status: "draft",
        default_visibility: "internal",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de", "en", "uk"],
        text_block_keys: &[],
    },
    DocumentTemplateDefinition {
        id: "patient_sticker_sheet",
        label: "Patient Sticker · Sheet 70 x 37 mm",
        description: "Small sheet-style patient sticker including agency contact block.",
        art: "patient_sticker",
        category: "generated",
        default_auto_name: "Patient sticker",
        default_status: "draft",
        default_visibility: "internal",
        mime_type: "application/pdf",
        file_extension: "pdf",
        is_medical: false,
        languages: &["de", "en", "uk"],
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
    Router::new()
        .route("/me/documents/upload", post(upload_my_document))
        .route("/me/documents/uploads", get(list_my_uploaded_documents))
        .route(
            "/me/documents/uploads/{id}/download",
            get(download_my_uploaded_document),
        )
        .route("/documents", get(list_documents))
        .route("/documents/upload", post(upload_document))
        .route("/documents/templates", get(list_document_templates))
        .route("/documents/generate", post(generate_document))
        .route("/documents/meta/staff", get(list_document_staff))
        .route("/documents/meta/categories", get(list_document_categories))
        .route("/documents/shares/bulk", post(create_bulk_document_shares))
        .route("/documents/{id}", get(get_document))
        .route("/documents/{id}/update", post(update_document))
        .route("/documents/{id}/download", get(download_document))
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
struct DocumentListQuery {
    search: Option<String>,
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    status: Option<String>,
    visibility: Option<String>,
    art: Option<String>,
    category: Option<String>,
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
}

#[derive(Deserialize)]
struct CreateShareRequest {
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
    channel: Option<String>,
    requires_confirmation: Option<bool>,
}

#[derive(Deserialize)]
struct BulkCreateShareRequest {
    document_ids: Vec<Uuid>,
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
    channel: Option<String>,
    requires_confirmation: Option<bool>,
}

#[derive(Deserialize, Default)]
struct PortalReleaseRequest {
    channel: Option<String>,
    requires_confirmation: Option<bool>,
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
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    auto_name: Option<String>,
    status: Option<String>,
    visibility: Option<String>,
    klinik: Option<String>,
    ursprung: Option<String>,
    notes: Option<String>,
    language: Option<String>,
    title_override: Option<String>,
    introduction: Option<String>,
    closing_note: Option<String>,
    text_block_keys: Option<Vec<String>>,
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

fn normalize_document_language(value: Option<&str>) -> &'static str {
    match value.unwrap_or("de").trim().to_lowercase().as_str() {
        "de" | "de-de" | "de_at" | "de-at" | "de_ch" | "de-ch" => "de",
        "uk" | "uk-ua" | "ua" | "ukrainian" => "uk",
        "en" | "en-gb" | "en-us" | "english" => "en",
        _ => "de",
    }
}

fn document_template_by_id(template_id: &str) -> Option<DocumentTemplateDefinition> {
    DOCUMENT_TEMPLATES
        .iter()
        .copied()
        .find(|template| template.id == template_id)
}

fn document_text_block_by_key(key: &str) -> Option<TextBlockDefinition> {
    DOCUMENT_TEXT_BLOCKS
        .iter()
        .copied()
        .find(|block| block.key == key)
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
        ("uk", "intro_heading") => "Короткий вступ",
        ("uk", "program_heading") => "Програма по днях",
        ("uk", "notes_heading") => "Важливі вказівки",
        ("uk", "appointment_notes") => "Коментар до візиту",
        ("uk", "generated_footer") => "Згенеровано",
        ("uk", "provider") => "Провайдер",
        ("uk", "doctor") => "Лікар",
        ("uk", "location") => "Місце",
        ("uk", "category") => "Категорія",
        ("uk", "no_items") => "Для вибраного контексту ще немає термінів.",
        ("uk", "no_medications") => "У вибраному контексті ще немає медикаментів.",
        ("uk", "draft_badge") => "Робочий документ",
        ("en", "framework_contract_title") => "Framework contract for",
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
        ("en", "intro_heading") => "Introduction",
        ("en", "program_heading") => "Schedule by day",
        ("en", "notes_heading") => "Important notes",
        ("en", "appointment_notes") => "Visit note",
        ("en", "generated_footer") => "Generated",
        ("en", "provider") => "Provider",
        ("en", "doctor") => "Doctor",
        ("en", "location") => "Location",
        ("en", "category") => "Category",
        ("en", "no_items") => "No appointments are available for the selected context yet.",
        ("en", "no_medications") => "No medication is available for the selected context yet.",
        ("en", "draft_badge") => "Working document",
        (_, "framework_contract_title") => "Rahmenvertrag für",
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
        (_, "medication_title") => "Medikamentenplan für",
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
        (_, "source_case") => "Quelle",
        (_, "medication_note") => "Anmerkung",
        (_, "medication_scope_active") => {
            "Alle aktiven Patientencases sind in dieser Zusammenfassung enthalten."
        }
        (_, "medication_scope_latest") => {
            "Kein aktives Case gefunden, daher wurde das zuletzt erfasste Patientencase verwendet."
        }
        (_, "document_title") => "Untersuchungs-/Behandlungsplan für",
        (_, "created_on") => "Datum",
        (_, "patient_id") => "Patienten-ID",
        (_, "birth_date") => "Geburtsdatum",
        (_, "order_number") => "Auftrag",
        (_, "intro_heading") => "Einleitung",
        (_, "program_heading") => "Programm nach Tagen",
        (_, "notes_heading") => "Wichtige Hinweise",
        (_, "appointment_notes") => "Terminnotiz",
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
        TreatmentPlanPdfColor::Primary => Color::Rgb(Rgb::new(0.11, 0.30, 0.84, None)),
        TreatmentPlanPdfColor::Muted => Color::Rgb(Rgb::new(0.40, 0.46, 0.54, None)),
        TreatmentPlanPdfColor::Body => Color::Rgb(Rgb::new(0.07, 0.13, 0.22, None)),
    }
}

fn pt_to_mm(value: f32) -> f32 {
    value * 0.352_778
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
    ops.push(Op::ShowText {
        items: vec![TextItem::Text(text.to_string())],
    });
    ops.push(Op::EndTextSection);
}

struct TreatmentPlanPdfLayout {
    pages: Vec<PdfPage>,
    page_ops: Vec<Op>,
    page_number: usize,
    y_mm: f32,
    footer_text: String,
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
            regular_font,
            bold_font,
        }
    }

    fn available_width(&self, indent_mm: f32) -> f32 {
        (PDF_CONTENT_WIDTH_MM - indent_mm).max(50.0)
    }

    fn finish_page(&mut self) {
        if self.page_ops.is_empty() {
            return;
        }

        append_pdf_text_line(
            &mut self.page_ops,
            &format!("{} · Page {}", self.footer_text, self.page_number),
            PDF_LEFT_MARGIN_MM,
            PDF_BOTTOM_MARGIN_MM,
            8.0,
            &self.regular_font,
            TreatmentPlanPdfColor::Muted,
        );

        self.pages.push(PdfPage::new(
            Mm(PDF_PAGE_WIDTH_MM),
            Mm(PDF_PAGE_HEIGHT_MM),
            std::mem::take(&mut self.page_ops),
        ));
        self.page_number += 1;
        self.y_mm = PDF_PAGE_HEIGHT_MM - PDF_TOP_MARGIN_MM;
    }

    fn ensure_space(&mut self, needed_mm: f32) {
        if self.y_mm - needed_mm < PDF_BOTTOM_MARGIN_MM + PDF_FOOTER_GAP_MM {
            self.finish_page();
        }
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

        let line_height_mm = pdf_line_height_mm(size_pt, 1.35);
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

    fn finish(mut self) -> Vec<PdfPage> {
        self.finish_page();
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
        ("medication_summary", _) => "Medikamentenplan",
        ("treatment_plan", "uk") => "План лікування",
        ("treatment_plan", "en") => "Treatment plan",
        ("treatment_plan", _) => "Behandlungsplan",
        _ => template.default_auto_name,
    };
    format!(
        "{base} · {patient_name} · {}",
        generated_at.format("%Y-%m-%d")
    )
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
) -> Result<Vec<u8>, &'static str> {
    let mut font_warnings: Vec<String> = Vec::new();
    let regular_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;
    let bold_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_BOLD_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;

    let mut document = PdfDocument::new(&context.auto_name);
    let regular_font_id = document.add_font(&regular_font);
    let bold_font_id = document.add_font(&bold_font);
    let regular_handle = PdfFontHandle::External(regular_font_id);
    let bold_handle = PdfFontHandle::External(bold_font_id);

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
    Ok(document
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut save_warnings))
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
            if let Some(ingredient) = ingredient {
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
            secondary.push(format!(
                "{}: {}",
                translated_label(&context.language, "source_case"),
                escape_html(&source_label)
            ));

            markup.push_str(&format!(
                "<article class=\"entry medication-entry\"><div class=\"content\"><div class=\"headline\">{}</div>{}{}{}</div></article>",
                escape_html(&item.trade_name),
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
) -> Result<Vec<u8>, &'static str> {
    let mut font_warnings: Vec<String> = Vec::new();
    let regular_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;
    let bold_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_BOLD_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;

    let mut document = PdfDocument::new(&context.auto_name);
    let regular_font_id = document.add_font(&regular_font);
    let bold_font_id = document.add_font(&bold_font);
    let regular_handle = PdfFontHandle::External(regular_font_id);
    let bold_handle = PdfFontHandle::External(bold_font_id);

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
            layout.text_block(
                &item.trade_name,
                11.5,
                true,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );

            let ingredient = item
                .ingredient
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
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
            let note = item
                .note
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());

            if let Some(ingredient) = ingredient {
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
    Ok(document
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut save_warnings))
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

fn build_framework_contract_pdf(
    context: &GeneratedFrameworkContractContext,
) -> Result<Vec<u8>, &'static str> {
    let mut font_warnings: Vec<String> = Vec::new();
    let regular_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;
    let bold_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_BOLD_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;

    let mut document = PdfDocument::new(&context.auto_name);
    let regular_font_id = document.add_font(&regular_font);
    let bold_font_id = document.add_font(&bold_font);
    let regular_handle = PdfFontHandle::External(regular_font_id);
    let bold_handle = PdfFontHandle::External(bold_font_id);

    let title = context.title_override.clone().unwrap_or_else(|| {
        format!(
            "{} {}",
            translated_label(&context.language, "framework_contract_title"),
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
            translated_label(&context.language, "contract_number"),
            context.contract_number
        ),
        format!(
            "{}: {}",
            translated_label(&context.language, "contract_status"),
            context.contract_status
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
    if let Some(valid_from) = context.valid_from {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "valid_from"),
                valid_from.format("%d.%m.%Y")
            ),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    if let Some(valid_to) = context.valid_to {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "valid_to"),
                valid_to.format("%d.%m.%Y")
            ),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    if let Some(signed_at) = context.signed_at {
        layout.text_block(
            &format!(
                "{}: {}",
                translated_label(&context.language, "signed_at"),
                signed_at.format("%d.%m.%Y %H:%M UTC")
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
        .filter(|value| !value.is_empty())
    {
        layout.text_block(
            &format!("Order: {order_number}"),
            11.0,
            false,
            0.0,
            TreatmentPlanPdfColor::Muted,
            0.0,
            1.0,
        );
    }
    layout.text_block(
        &format!("Patient: {patient_line}"),
        12.0,
        true,
        0.0,
        TreatmentPlanPdfColor::Body,
        1.0,
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

    if context.quote_number.is_some()
        || !context.line_items.is_empty()
        || context.quote_total_gross.is_some()
    {
        layout.text_block(
            translated_label(&context.language, "quote_heading"),
            14.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Body,
            2.0,
            3.0,
        );
        for line in [
            context.quote_number.as_ref().map(|value| {
                format!(
                    "{}: {}",
                    translated_label(&context.language, "quote_number"),
                    value
                )
            }),
            context.quote_valid_until.map(|value| {
                format!(
                    "{}: {}",
                    translated_label(&context.language, "quote_valid_until"),
                    value.format("%d.%m.%Y")
                )
            }),
            context.quote_total_net.as_ref().map(|value| {
                format!(
                    "{}: {}",
                    translated_label(&context.language, "total_net"),
                    value
                )
            }),
            context.quote_total_vat.as_ref().map(|value| {
                format!(
                    "{}: {}",
                    translated_label(&context.language, "total_vat"),
                    value
                )
            }),
            context.quote_total_gross.as_ref().map(|value| {
                format!(
                    "{}: {}",
                    translated_label(&context.language, "total_gross"),
                    value
                )
            }),
        ]
        .into_iter()
        .flatten()
        {
            layout.text_block(
                &line,
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Muted,
                0.0,
                1.0,
            );
        }
        if let Some(notes) = context
            .quote_notes
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            layout.text_block(
                notes,
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                2.0,
            );
        }
        if context.line_items.is_empty() {
            layout.text_block(
                translated_label(&context.language, "no_services"),
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Muted,
                0.0,
                2.0,
            );
        } else {
            layout.text_block(
                translated_label(&context.language, "services_heading"),
                12.0,
                true,
                0.0,
                TreatmentPlanPdfColor::Primary,
                2.0,
                2.0,
            );
            for item in &context.line_items {
                layout.text_block(
                    &item.description,
                    11.0,
                    true,
                    4.0,
                    TreatmentPlanPdfColor::Body,
                    0.0,
                    1.0,
                );
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
                    item.vat_rate.as_ref().map(|value| {
                        format!(
                            "{}: {}%",
                            translated_label(&context.language, "total_vat"),
                            value
                        )
                    }),
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
                if !detail_line.is_empty() {
                    layout.text_block(
                        &detail_line,
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
                        notes,
                        10.0,
                        false,
                        10.0,
                        TreatmentPlanPdfColor::Body,
                        0.0,
                        1.0,
                    );
                }
            }
        }
    }

    if !context.conditions.is_empty() {
        layout.text_block(
            translated_label(&context.language, "contract_conditions_heading"),
            13.0,
            true,
            0.0,
            TreatmentPlanPdfColor::Body,
            4.0,
            2.0,
        );
        for (key, value) in &context.conditions {
            layout.text_block(
                &format!("{key}: {value}"),
                10.5,
                false,
                4.0,
                TreatmentPlanPdfColor::Body,
                0.0,
                1.0,
            );
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
            translated_label(&context.language, "contract_terms_heading"),
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
    Ok(document
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut save_warnings))
}

fn format_sticker_birth_date(value: NaiveDate) -> String {
    value.format("%d.%m.%Y").to_string()
}

fn patient_sticker_title_line(context: &GeneratedPatientStickerContext) -> String {
    [
        Some(context.patient_salutation.as_str()),
        context.patient_title.as_deref(),
        Some(context.patient_first_name.as_str()),
        Some(context.patient_last_name.as_str()),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
}

fn patient_sticker_meta_line(context: &GeneratedPatientStickerContext) -> String {
    [
        Some(format!(
            "{} {}",
            translated_label(&context.language, "sticker_dob"),
            format_sticker_birth_date(context.birth_date)
        )),
        context.country_code.as_ref().map(|value| {
            format!(
                "{} {}",
                translated_label(&context.language, "sticker_country"),
                value
            )
        }),
        context.insurance_provider.as_ref().map(|value| {
            format!(
                "{} {}",
                translated_label(&context.language, "sticker_insurance"),
                value
            )
        }),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("  ·  ")
}

fn patient_sticker_agency_line(context: &GeneratedPatientStickerContext) -> String {
    [
        Some(
            context
                .agency
                .care_of
                .trim()
                .to_string()
                .if_empty_then(|| context.agency.name.clone()),
        ),
        context.agency.address.clone(),
        context.agency.phone.clone(),
        context.agency.email.clone(),
    ]
    .into_iter()
    .flatten()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("  ·  ")
}

trait IfEmptyString {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl IfEmptyString for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn build_patient_sticker_html(context: &GeneratedPatientStickerContext) -> String {
    let format = context.format;
    let label_width = (format.width_mm as f32 - 10.0).max(48.0);
    let label_height = (format.height_mm as f32 - 10.0).max(24.0);
    let title_line = patient_sticker_title_line(context);
    let meta_line = patient_sticker_meta_line(context);
    let agency_line = patient_sticker_agency_line(context);
    let footer_line = format!(
        "{} {}",
        translated_label(&context.language, "sticker_generated"),
        context.generated_at.to_rfc3339()
    );

    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\" /><title>{title}</title><style>
        @page {{ size: {page_w}mm {page_h}mm; margin: 5mm; }}
        :root {{ color-scheme: light; }}
        * {{ box-sizing: border-box; }}
        html, body {{ margin: 0; padding: 0; width: 100%; min-height: 100%; background: #f3f4f6; font-family: Arial, sans-serif; color: #0f172a; }}
        body {{ display: grid; place-items: center; padding: 6mm; }}
        .label {{ width: {label_w}mm; min-height: {label_h}mm; border: 1px solid #cbd5e1; border-radius: 4mm; background: radial-gradient(circle at top right, rgba(15,23,42,0.06), transparent 42%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); padding: 4mm; display: grid; gap: 2.2mm; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }}
        .eyebrow {{ font-size: 8pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #475569; }}
        .patient-id {{ font-size: 12pt; font-weight: 700; letter-spacing: 0.04em; }}
        .name {{ font-size: {name_size}; font-weight: 700; line-height: 1.15; }}
        .meta, .agency, .footer {{ font-size: {small_size}; line-height: 1.35; color: #334155; }}
        .footer {{ color: #64748b; }}
        </style></head><body><article class=\"label\"><div class=\"eyebrow\">{format_label}</div><div class=\"patient-id\">{patient_id}</div><div class=\"name\">{name}</div><div class=\"meta\">{meta}</div><div class=\"agency\">{agency}</div><div class=\"footer\">{footer}</div></article></body></html>",
        lang = escape_html(&context.language),
        title = escape_html(&format!("{} {}", context.patient_pid, translated_label(&context.language, "sticker_title"))),
        page_w = format.width_mm,
        page_h = format.height_mm,
        label_w = label_width,
        label_h = label_height,
        name_size = if format.height_mm <= 40 { "11.5pt" } else { "14pt" },
        small_size = if format.height_mm <= 40 { "7.5pt" } else { "8.5pt" },
        format_label = escape_html(format.label),
        patient_id = escape_html(&context.patient_pid),
        name = escape_html(if title_line.is_empty() { &context.patient_pid } else { &title_line }),
        meta = escape_html(if meta_line.is_empty() { translated_label(&context.language, "sticker_dob") } else { &meta_line }),
        agency = escape_html(if agency_line.is_empty() { &context.agency.name } else { &agency_line }),
        footer = escape_html(&footer_line),
    )
}

fn build_patient_sticker_pdf(
    context: &GeneratedPatientStickerContext,
) -> Result<Vec<u8>, &'static str> {
    let mut font_warnings: Vec<String> = Vec::new();
    let regular_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;
    let bold_font = ParsedFont::from_bytes(TREATMENT_PLAN_ARIAL_BOLD_TTF, 0, &mut font_warnings)
        .ok_or("Failed to load PDF font")?;

    let mut document = PdfDocument::new(&context.auto_name);
    let regular_font_id = document.add_font(&regular_font);
    let bold_font_id = document.add_font(&bold_font);
    let regular_handle = PdfFontHandle::External(regular_font_id);
    let bold_handle = PdfFontHandle::External(bold_font_id);

    let width_mm = context.format.width_mm as f32;
    let height_mm = context.format.height_mm as f32;
    let left_margin_mm = 5.0;
    let right_margin_mm = 5.0;
    let top_margin_mm = 5.0;
    let bottom_margin_mm = 5.0;
    let content_width_mm = (width_mm - left_margin_mm - right_margin_mm).max(30.0);
    let mut y_mm = height_mm - top_margin_mm;
    let compact = context.format.height_mm <= 40;
    let eyebrow_size = if compact { 6.5 } else { 7.5 };
    let id_size = if compact { 10.0 } else { 11.5 };
    let name_size = if compact { 10.5 } else { 13.0 };
    let body_size = if compact { 6.5 } else { 7.8 };
    let footer_size = if compact { 5.6 } else { 6.4 };

    let title_line = patient_sticker_title_line(context);
    let meta_line = patient_sticker_meta_line(context);
    let agency_line = patient_sticker_agency_line(context);
    let footer_line = format!(
        "{} {}",
        translated_label(&context.language, "sticker_generated"),
        context.generated_at.format("%d.%m.%Y %H:%M")
    );

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

    push_wrapped(
        &mut ops,
        context.format.label,
        &regular_handle,
        eyebrow_size,
        TreatmentPlanPdfColor::Muted,
        &mut y_mm,
    );
    y_mm -= 1.0;
    push_wrapped(
        &mut ops,
        &context.patient_pid,
        &bold_handle,
        id_size,
        TreatmentPlanPdfColor::Body,
        &mut y_mm,
    );
    y_mm -= 1.0;
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
    y_mm -= 1.0;
    push_wrapped(
        &mut ops,
        if meta_line.is_empty() {
            translated_label(&context.language, "sticker_dob")
        } else {
            &meta_line
        },
        &regular_handle,
        body_size,
        TreatmentPlanPdfColor::Body,
        &mut y_mm,
    );
    y_mm -= 1.0;
    push_wrapped(
        &mut ops,
        if agency_line.is_empty() {
            &context.agency.name
        } else {
            &agency_line
        },
        &regular_handle,
        body_size,
        TreatmentPlanPdfColor::Body,
        &mut y_mm,
    );

    let footer_lines = wrap_text_to_width(&footer_line, footer_size, content_width_mm);
    let footer_height = footer_lines.len() as f32 * pdf_line_height_mm(footer_size, 1.15);
    let mut footer_y = (bottom_margin_mm + footer_height).max(bottom_margin_mm + 2.5);
    for line in footer_lines.into_iter().rev() {
        append_pdf_text_line(
            &mut ops,
            &line,
            left_margin_mm,
            footer_y,
            footer_size,
            &regular_handle,
            TreatmentPlanPdfColor::Muted,
        );
        footer_y += pdf_line_height_mm(footer_size, 1.15);
    }

    let mut save_warnings: Vec<PdfWarnMsg> = Vec::new();
    Ok(document
        .with_pages(vec![PdfPage::new(Mm(width_mm), Mm(height_mm), ops)])
        .save(&PdfSaveOptions::default(), &mut save_warnings))
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
    document_id: Uuid,
    auth_user_id: Uuid,
    shared_with_provider_id: Option<Uuid>,
    shared_with_user_id: Option<Uuid>,
    channel: &str,
    requires_confirmation: bool,
) -> Result<Uuid, axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO document_shares (
                document_id, shared_with_provider_id, shared_with_user_id, shared_by,
                channel, requires_confirmation
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id"#,
    )
    .bind(document_id)
    .bind(shared_with_provider_id)
    .bind(shared_with_user_id)
    .bind(auth_user_id)
    .bind(channel)
    .bind(requires_confirmation)
    .fetch_one(&state.db)
    .await
    .map(|row| row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()))
    .map_err(|e| {
        tracing::error!(error = %e, document_id = %document_id, "create document share");
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
            "Upload kind must be general, medical_record, insurance_document or payment_proof",
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
    {
        return DataSensitivity::Financial;
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

fn document_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    let visibility = row
        .try_get::<String, _>("visibility")
        .unwrap_or_else(|_| "internal".to_string());
    let share_status = parse_share_status(&visibility).unwrap_or(ShareStatus::InternalOnly);
    let sensitivity = infer_document_sensitivity(
        row.try_get::<bool, _>("is_medical").unwrap_or(false),
        row.try_get::<Option<String>, _>("art").unwrap_or_default(),
        row.try_get::<Option<String>, _>("category")
            .unwrap_or_default(),
        share_status,
    );

    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        "patient_pid": row.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
        "patient_name": row.try_get::<Option<String>, _>("patient_name").unwrap_or_default(),
        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
        "appointment_title": row.try_get::<Option<String>, _>("appointment_title").unwrap_or_default(),
        "auto_name": row.try_get::<String, _>("auto_name").unwrap_or_default(),
        "original_filename": row.try_get::<Option<String>, _>("original_filename").unwrap_or_default(),
        "art": row.try_get::<String, _>("art").unwrap_or_default(),
        "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "visibility": visibility,
        "is_medical": row.try_get::<bool, _>("is_medical").unwrap_or(false),
        "mime_type": row.try_get::<Option<String>, _>("mime_type").unwrap_or_default(),
        "file_size": row.try_get::<Option<i64>, _>("file_size").unwrap_or_default(),
        "klinik": row.try_get::<Option<String>, _>("klinik").unwrap_or_default(),
        "ursprung": row.try_get::<Option<String>, _>("ursprung").unwrap_or_default(),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "uploaded_by": row.try_get::<Uuid, _>("uploaded_by").unwrap_or_else(|_| Uuid::nil()),
        "uploaded_by_name": row.try_get::<Option<String>, _>("uploaded_by_name").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").unwrap_or_else(|_| chrono::Utc::now()),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").unwrap_or_else(|_| chrono::Utc::now()),
        "share_count": row.try_get::<i64, _>("share_count").unwrap_or(0),
        "shared_to_current": row.try_get::<bool, _>("shared_to_current").unwrap_or(false),
        "data_sensitivity": sensitivity.display_name(),
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
        "requires_confirmation": row.try_get::<bool, _>("requires_confirmation").unwrap_or(false),
        "confirmed": row.try_get::<bool, _>("confirmed").unwrap_or(false),
        "confirmed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("confirmed_at").unwrap_or_default(),
        "shared_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("shared_at").unwrap_or_else(|_| chrono::Utc::now()),
        "revoked_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at").unwrap_or_default(),
    })
}

async fn fetch_document_row(
    state: &AppState,
    document_id: Uuid,
    current_user_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(
        r#"SELECT d.id, d.patient_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.storage_key, d.klinik, d.ursprung,
                  d.notes, d.uploaded_by, d.created_at, d.updated_at,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  o.order_number,
                  a.title AS appointment_title,
                  u.name AS uploaded_by_name,
                  COALESCE((SELECT count(*)::bigint FROM document_shares ds WHERE ds.document_id = d.id AND ds.revoked_at IS NULL), 0) AS share_count,
                  EXISTS(
                    SELECT 1
                    FROM document_shares ds
                    WHERE ds.document_id = d.id
                      AND ds.shared_with_user_id = $2
                      AND ds.revoked_at IS NULL
                  ) AS shared_to_current
           FROM documents d
           LEFT JOIN patients p ON p.id = d.patient_id
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN appointments a ON a.id = d.appointment_id
           LEFT JOIN users u ON u.id = d.uploaded_by
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
    let is_assigned = if explicit_share {
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

async fn validate_document_context(
    state: &AppState,
    mut patient_id: Option<Uuid>,
    mut order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
) -> Result<(Option<Uuid>, Option<Uuid>, Option<Uuid>), axum::response::Response> {
    if let Some(appointment_id) = appointment_id {
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
        let row = sqlx::query("SELECT patient_id FROM orders WHERE id = $1")
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
        let order_patient_id: Uuid = row.try_get("patient_id").unwrap_or_else(|_| Uuid::nil());

        if let Some(existing) = patient_id {
            if existing != order_patient_id {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Order and patient context do not match",
                ));
            }
        } else {
            patient_id = Some(order_patient_id);
        }
    }

    Ok((patient_id, order_id, appointment_id))
}

async fn provider_in_order_or_appointment(
    state: &AppState,
    provider_id: Uuid,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
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

    Ok(true)
}

async fn persist_document_file(
    state: &AppState,
    data: &[u8],
    input: &NewStoredDocument<'_>,
) -> Result<(Uuid, i64, String), axum::response::Response> {
    let original_filename = if input.original_filename.trim().is_empty() {
        "document.bin".to_string()
    } else {
        input.original_filename.trim().to_string()
    };
    let storage_key = format!(
        "{}_{}",
        Uuid::new_v4(),
        sanitize_filename(&original_filename)
    );
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

    let inserted = match sqlx::query(
        r#"INSERT INTO documents (
                patient_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, mime_type, file_size,
                storage_key, klinik, ursprung, notes, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17
           )
           RETURNING id"#,
    )
    .bind(input.patient_id)
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
    .bind(input.uploaded_by)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, "insert document row");
            let _ = tokio::fs::remove_file(&path).await;
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save document",
            ));
        }
    };

    let document_id: Uuid = inserted.try_get("id").unwrap_or_else(|_| Uuid::nil());
    Ok((document_id, file_size, original_filename))
}

async fn list_document_templates(Extension(auth): Extension<AuthUser>) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    Json(json!({
        "templates": DOCUMENT_TEMPLATES.iter().map(|template| {
            json!({
                "id": template.id,
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
        }).collect::<Vec<_>>(),
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

async fn generate_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<GenerateDocumentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let Some(template) = document_template_by_id(body.template_id.trim()) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown document template",
        );
    };

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

    let language = normalize_document_language(body.language.as_deref());
    if !template.languages.contains(&language) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Language is not supported by the selected template",
        );
    }

    let (patient_id, order_id, appointment_id) = match validate_document_context(
        &state,
        body.patient_id,
        body.order_id,
        body.appointment_id,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let Some(patient_uuid) = patient_id else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Generated documents must be linked to a patient",
        );
    };

    let patient_row = match sqlx::query(
        r#"SELECT patient_id, title, first_name, last_name, birth_date, gender,
                  nationality, residence_country, insurance_provider
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

    let (preview_html, pdf_bytes) = match template.id {
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
                appointments,
                text_blocks,
                generated_at,
            };

            let preview_html = build_treatment_plan_html(&context);
            let pdf_bytes = match build_treatment_plan_pdf(&context) {
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
                          med_typ
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
            let pdf_bytes = match build_medication_summary_pdf(&context) {
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
                       ORDER BY created_at DESC
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
                       ORDER BY created_at DESC
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

            let context = GeneratedFrameworkContractContext {
                patient_pid: patient_pid.clone(),
                patient_name: patient_name.clone(),
                patient_title: patient_title.clone(),
                birth_date,
                language: language.to_string(),
                auto_name: auto_name.clone(),
                title_override,
                introduction,
                closing_note,
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
                    .and_then(|row| row.try_get::<Option<String>, _>("total_net").ok().flatten()),
                quote_total_vat: quote_row
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<String>, _>("total_vat").ok().flatten()),
                quote_total_gross: quote_row.as_ref().and_then(|row| {
                    row.try_get::<Option<String>, _>("total_gross")
                        .ok()
                        .flatten()
                }),
                quote_notes: quote_row
                    .as_ref()
                    .and_then(|row| row.try_get::<Option<String>, _>("notes").ok().flatten()),
                conditions,
                line_items,
                text_blocks,
                generated_at,
            };

            let preview_html = build_framework_contract_html(&context);
            let pdf_bytes = match build_framework_contract_pdf(&context) {
                Ok(bytes) => bytes,
                Err(message) => {
                    tracing::error!(template_id = template.id, patient_id = %patient_uuid, "build generated framework contract PDF");
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
                birth_date: birth_date.unwrap_or_else(|| chrono::Utc::now().date_naive()),
                country_code: patient_label_country_code(
                    nationality.as_deref(),
                    residence_country.as_deref(),
                ),
                insurance_provider,
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

    let persist_input = NewStoredDocument {
        patient_id,
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
        uploaded_by: auth.user_id,
    };

    let (document_id, file_size, original_filename) =
        match persist_document_file(&state, &pdf_bytes, &persist_input).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'generate_document_from_template', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(document_id)
    .bind(json!({
        "template_id": template.id,
        "patient_id": patient_uuid,
        "order_id": order_id,
        "appointment_id": appointment_id,
        "language": language,
    }))
    .execute(&state.db)
    .await;

    Json(json!({
        "ok": true,
        "id": document_id,
        "auto_name": auto_name,
        "original_filename": original_filename,
        "mime_type": template.mime_type,
        "file_size": file_size,
        "preview_html": preview_html,
    }))
    .into_response()
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

    let rows = match sqlx::query(
        r#"SELECT d.id, d.patient_id, d.order_id, d.appointment_id,
                  d.auto_name, d.original_filename, d.art, d.category, d.status, d.visibility,
                  d.is_medical, d.mime_type, d.file_size, d.storage_key, d.klinik, d.ursprung,
                  d.notes, d.uploaded_by, d.created_at, d.updated_at,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  o.order_number,
                  a.title AS appointment_title,
                  u.name AS uploaded_by_name,
                  COALESCE((SELECT count(*)::bigint FROM document_shares ds WHERE ds.document_id = d.id AND ds.revoked_at IS NULL), 0) AS share_count,
                  EXISTS(
                    SELECT 1 FROM document_shares ds
                    WHERE ds.document_id = d.id
                      AND ds.shared_with_user_id = $9
                      AND ds.revoked_at IS NULL
                  ) AS shared_to_current
           FROM documents d
           LEFT JOIN patients p ON p.id = d.patient_id
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN appointments a ON a.id = d.appointment_id
           LEFT JOIN users u ON u.id = d.uploaded_by
           WHERE ($1::text IS NULL
                  OR d.auto_name ILIKE '%' || $1 || '%'
                  OR COALESCE(d.original_filename, '') ILIKE '%' || $1 || '%'
                  OR COALESCE(d.category, '') ILIKE '%' || $1 || '%'
                  OR COALESCE(d.art, '') ILIKE '%' || $1 || '%'
                  OR COALESCE(d.notes, '') ILIKE '%' || $1 || '%')
             AND ($2::uuid IS NULL OR d.patient_id = $2)
             AND ($3::uuid IS NULL OR d.order_id = $3)
             AND ($4::uuid IS NULL OR d.appointment_id = $4)
             AND ($5::text IS NULL OR d.status = $5)
             AND ($6::text IS NULL OR d.visibility = $6)
             AND ($7::text IS NULL OR d.art = $7)
             AND ($8::text IS NULL OR d.category = $8)
           ORDER BY d.created_at DESC
           LIMIT 300"#,
    )
    .bind(search)
    .bind(query.patient_id)
    .bind(query.order_id)
    .bind(query.appointment_id)
    .bind(query.status.as_deref())
    .bind(query.visibility.as_deref())
    .bind(query.art.as_deref())
    .bind(query.category.as_deref())
    .bind(auth.user_id)
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
        return err(StatusCode::NOT_FOUND, "Document file is not stored");
    };
    let mime_type = row
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let filename = row
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default()
        .unwrap_or_else(|| {
            row.try_get::<String, _>("auto_name")
                .unwrap_or_else(|_| "document".to_string())
        });

    let path = FsPath::new(UPLOAD_DIR).join(storage_key);
    let data = match tokio::fs::read(&path).await {
        Ok(data) => data,
        Err(_) => return err(StatusCode::NOT_FOUND, "Document file not found on disk"),
    };

    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));

    axum::response::Response::builder()
        .header("content-type", mime_type)
        .header("content-disposition", disposition)
        .body(Body::from(data))
        .unwrap()
        .into_response()
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
        r#"SELECT d.id, d.patient_id, d.order_id, d.appointment_id,
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
        r#"SELECT auto_name, original_filename, mime_type, storage_key
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
        return err(StatusCode::NOT_FOUND, "Document file is not stored");
    };

    let mime_type = row
        .try_get::<Option<String>, _>("mime_type")
        .unwrap_or_default()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let filename = row
        .try_get::<Option<String>, _>("original_filename")
        .unwrap_or_default()
        .unwrap_or_else(|| {
            row.try_get::<String, _>("auto_name")
                .unwrap_or_else(|_| "document".to_string())
        });

    let path = FsPath::new(UPLOAD_DIR).join(storage_key);
    let data = match tokio::fs::read(&path).await {
        Ok(data) => data,
        Err(_) => return err(StatusCode::NOT_FOUND, "Document file not found on disk"),
    };

    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));

    axum::response::Response::builder()
        .header("content-type", mime_type)
        .header("content-disposition", disposition)
        .body(Body::from(data))
        .unwrap()
        .into_response()
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
    let preset = match parse_patient_upload_preset(&upload_kind) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let (patient_id, order_id, appointment_id) =
        match validate_document_context(&state, Some(patient_id), order_id, appointment_id).await {
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
        patient_id,
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
        uploaded_by: auth.user_id,
    };
    let (document_id, file_size, original_filename) =
        match persist_document_file(&state, &data, &persist_input).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'patient_portal_upload_document', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(document_id)
    .bind(json!({
        "patient_id": patient_id,
        "order_id": order_id,
        "appointment_id": appointment_id,
        "upload_kind": preset.kind,
        "art": preset.art,
        "category": preset.category,
        "visibility": "internal",
    }))
    .execute(&state.db)
    .await;

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

    let _ = if preset.kind == "payment_proof" {
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
               ) AS target"#,
        )
        .bind(document_id)
        .bind("Patient payment proof uploaded")
        .bind(notification_body)
        .bind(patient_id)
        .execute(&state.db)
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
                 AND u.role IN ('patient_manager', 'ceo')"#,
        )
        .bind(document_id)
        .bind("Patient portal upload received")
        .bind(notification_body)
        .bind(patient_id)
        .execute(&state.db)
        .await
    };

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
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut mime_type = String::from("application/octet-stream");
    let mut patient_id: Option<Uuid> = None;
    let mut order_id: Option<Uuid> = None;
    let mut appointment_id: Option<Uuid> = None;
    let mut auto_name = String::new();
    let mut art = String::new();
    let mut category: Option<String> = None;
    let mut status = String::from("active");
    let mut visibility = String::from("internal");
    let mut is_medical = false;
    let mut klinik: Option<String> = None;
    let mut ursprung: Option<String> = None;
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
                is_medical = parse_optional_text_field(field)
                    .await
                    .as_deref()
                    .map(parse_bool_flag)
                    .unwrap_or(false)
            }
            "klinik" => klinik = parse_optional_text_field(field).await,
            "ursprung" => ursprung = parse_optional_text_field(field).await,
            "notes" => notes = parse_optional_text_field(field).await,
            _ => {}
        }
    }

    let data = match file_data {
        Some(data) if !data.is_empty() => data,
        _ => return err(StatusCode::BAD_REQUEST, "No file uploaded"),
    };
    if auto_name.trim().is_empty() {
        auto_name = file_name
            .clone()
            .unwrap_or_else(|| "Uploaded document".to_string());
    }
    if art.trim().is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Document art is required");
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

    let (patient_id, order_id, appointment_id) =
        match validate_document_context(&state, patient_id, order_id, appointment_id).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };

    if patient_id.is_none() && order_id.is_none() && appointment_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Document must be linked to patient, order or appointment",
        );
    }

    let original_filename = file_name.unwrap_or_else(|| "document".to_string());
    let persist_input = NewStoredDocument {
        patient_id,
        order_id,
        appointment_id,
        auto_name: auto_name.trim(),
        original_filename: &original_filename,
        art: art.trim(),
        category: category.as_deref(),
        status: status.as_str(),
        visibility: visibility.as_str(),
        is_medical,
        mime_type: &mime_type,
        klinik: klinik.as_deref(),
        ursprung: ursprung.as_deref(),
        notes: notes.as_deref(),
        uploaded_by: auth.user_id,
    };
    let (document_id, file_size, original_filename) =
        match persist_document_file(&state, &data, &persist_input).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'upload_document', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(document_id)
    .bind(json!({
        "patient_id": patient_id,
        "order_id": order_id,
        "appointment_id": appointment_id,
        "art": art,
        "visibility": visibility,
        "is_medical": is_medical,
    }))
    .execute(&state.db)
    .await;

    Json(json!({
        "ok": true,
        "id": document_id,
        "original_filename": original_filename,
        "mime_type": mime_type,
        "file_size": file_size,
    }))
    .into_response()
}

async fn update_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDocumentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let current = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };

    let current_patient_id: Option<Uuid> = current.try_get("patient_id").unwrap_or_default();
    let current_order_id: Option<Uuid> = current.try_get("order_id").unwrap_or_default();
    let current_appointment_id: Option<Uuid> =
        current.try_get("appointment_id").unwrap_or_default();

    let (patient_id, order_id, appointment_id) = match validate_document_context(
        &state,
        body.patient_id.or(current_patient_id),
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
               notes = $13
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
    .execute(&state.db)
    .await
    {
        Ok(_) => {
            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'update_document', 'document', $2, $3)",
            )
            .bind(auth.user_id)
            .bind(id)
            .bind(json!({
                "patient_id": patient_id,
                "order_id": order_id,
                "appointment_id": appointment_id,
                "status": body.status,
                "visibility": body.visibility,
                "is_medical": body.is_medical,
            }))
            .execute(&state.db)
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

async fn release_document_to_patient_portal(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<PortalReleaseRequest>,
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
            "Only patient-linked documents can be released to the portal",
        );
    };

    let current_visibility = row
        .try_get::<String, _>("visibility")
        .unwrap_or_else(|_| "internal".to_string());
    let auto_name = row.try_get::<String, _>("auto_name").unwrap_or_default();
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
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient portal recipients",
            );
        }
    };

    if recipients.is_empty() {
        return err(
            StatusCode::CONFLICT,
            "No active patient portal user is linked to this patient",
        );
    }

    let requires_confirmation = body.requires_confirmation.unwrap_or(true);

    if current_visibility != "patient_visible"
        && let Err(e) =
            sqlx::query("UPDATE documents SET visibility = 'patient_visible' WHERE id = $1")
                .bind(id)
                .execute(&state.db)
                .await
    {
        tracing::error!(error = %e, document_id = %id, "set patient portal visibility");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to release document to the portal",
        );
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
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load existing portal releases",
            );
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
        .bind(auth.user_id)
        .bind(channel.as_str())
        .bind(requires_confirmation)
        .fetch_one(&state.db)
        .await
        {
            Ok(row) => row,
            Err(e) => {
                tracing::error!(error = %e, document_id = %id, recipient_id = %recipient_id, "create patient portal share");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to create patient portal release",
                );
            }
        };

        let share_id = inserted
            .try_get::<Uuid, _>("id")
            .unwrap_or_else(|_| Uuid::nil());
        created_share_ids.push(share_id);

        let _ = sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               VALUES ($1, 'document_release', $2, $3, 'document', $4)"#,
        )
        .bind(recipient_id)
        .bind(format!("New document released: {auto_name}"))
        .bind("A new document is available in your patient portal.")
        .bind(id)
        .execute(&state.db)
        .await;
    }

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'release_document_to_patient_portal', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(json!({
        "patient_id": patient_id,
        "previous_visibility": current_visibility,
        "new_visibility": "patient_visible",
        "channel": channel,
        "requires_confirmation": requires_confirmation,
        "recipient_count": recipients.len(),
        "created_share_ids": created_share_ids,
    }))
    .execute(&state.db)
    .await;

    Json(json!({
        "ok": true,
        "document_id": id,
        "patient_id": patient_id,
        "visibility": "patient_visible",
        "recipient_count": recipients.len(),
        "created_share_count": created_share_ids.len(),
        "requires_confirmation": requires_confirmation,
    }))
    .into_response()
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

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'revoke_document_from_patient_portal', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(json!({
        "patient_id": patient_id,
        "revoked_share_ids": revoked_share_ids,
    }))
    .execute(&state.db)
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
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    }

    match sqlx::query(
        r#"SELECT ds.id, ds.document_id, ds.shared_with_provider_id, ds.shared_with_user_id,
                  ds.shared_by, ds.channel, ds.requires_confirmation, ds.confirmed,
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

    let mut unique_document_ids = Vec::new();
    let mut seen = HashSet::new();
    for document_id in body.document_ids {
        if seen.insert(document_id) {
            unique_document_ids.push(document_id);
        }
    }

    let mut contexts = Vec::with_capacity(unique_document_ids.len());
    for document_id in unique_document_ids.iter().copied() {
        let row = match fetch_document_row(&state, document_id, auth.user_id).await {
            Ok(Some(row)) => row,
            Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
            Err(resp) => return resp,
        };
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
            context.document_id,
            auth.user_id,
            body.shared_with_provider_id,
            body.shared_with_user_id,
            &channel,
            requires_confirmation,
        )
        .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        share_ids.push(share_id);
    }

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'bulk_share_documents', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(contexts.first().map(|context| context.document_id).unwrap_or_else(Uuid::nil))
    .bind(json!({
        "document_ids": contexts.iter().map(|context| context.document_id).collect::<Vec<_>>(),
        "share_ids": share_ids,
        "shared_with_provider_id": body.shared_with_provider_id,
        "shared_with_user_id": body.shared_with_user_id,
        "channel": channel,
        "requires_confirmation": requires_confirmation,
    }))
    .execute(&state.db)
    .await;

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

    let row = match fetch_document_row(&state, id, auth.user_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(resp) => return resp,
    };
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
        id,
        auth.user_id,
        body.shared_with_provider_id,
        body.shared_with_user_id,
        &channel,
        requires_confirmation,
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'share_document', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(json!({
        "share_id": share_id,
        "shared_with_provider_id": body.shared_with_provider_id,
        "shared_with_user_id": body.shared_with_user_id,
        "channel": channel,
        "requires_confirmation": requires_confirmation,
    }))
    .execute(&state.db)
    .await;

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

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'revoke_document_share', 'document', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(id)
    .bind(json!({ "share_id": share_id }))
    .execute(&state.db)
    .await;

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
            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'confirm_document_share', 'document', $2, $3)",
            )
            .bind(auth.user_id)
            .bind(id)
            .bind(json!({ "share_id": share_id }))
            .execute(&state.db)
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
    ]) {
        return resp;
    }

    match sqlx::query(
        r#"SELECT id, name, role
           FROM users
           WHERE is_active = true
             AND role IN ('ceo', 'patient_manager', 'teamlead_interpreter', 'interpreter', 'concierge', 'billing')
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
    ]) {
        return resp;
    }

    let categories = match sqlx::query(
        r#"SELECT id, name_en
           FROM ref_document_categories
           ORDER BY name_en"#,
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
