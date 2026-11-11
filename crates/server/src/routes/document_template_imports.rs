//! Imported document templates of the agency (owner request 2026-11-10).
//!
//! Staff import a Word (.docx) or plain-text file on the documents page. The
//! server keeps the text only — the document is printed on the GMED
//! letterhead like "Freies Dokument" — checks its `{{variables}}`, shows a
//! preview with sample data and offers the template in "generate from
//! template" once it is activated. The built-in legal templates (contract,
//! consents, GwG sheets, cost estimates) are not replaceable here: their
//! texts stay in the code (owner decision 2026-11-10).
//!
//! One row is one version; the text of an activated version never changes,
//! so a generated document keeps naming exactly what it was made from.

#![allow(clippy::result_large_err)]

use std::collections::BTreeMap;
use std::io::{Cursor, Read};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, State},
    http::{HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{NaiveDate, NaiveTime};
use quick_xml::escape::resolve_xml_entity;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::file_scan::scan_upload_bytes;
use crate::file_sniff::validate_upload_magic_bytes;
use crate::state::AppState;
use gmed_domain::role::Role;

/// Who imports, checks, activates and disables templates: the CEO only
/// (owner decision 2026-11-10). Generating from an active template stays with
/// the roles of `generate_document`. Keep the frontend mirror
/// `canImportTemplates` (documents page) aligned.
const TEMPLATE_ROLES: &[Role] = &[Role::Ceo];

pub(crate) const PUBLIC_ID_PREFIX: &str = "agency_template:";
const MAX_TEMPLATE_FILE_BYTES: usize = 2 * 1024 * 1024;
/// The unpacked `word/document.xml`; a larger one is refused (zip bomb guard).
const MAX_DOCX_XML_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DOCX_XML_EVENTS: usize = 400_000;
/// Below the 30 000 characters of a generated manual text, with room for the
/// values that replace the variables.
const MAX_TEMPLATE_BODY_CHARS: usize = 20_000;
const MAX_LABEL_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 1_000;
const LANGUAGES: &[&str] = &["de", "en", "uk", "ru"];
const ENTITY_TYPE: &str = "agency_document_template";

/// The variables a template may use as `{{key}}`, with the sample value of
/// the preview. The frontend names them from its own catalog by key.
const VARIABLES: &[(&str, &str)] = &[
    ("patient_id", "P-0001"),
    // A lead has no patient number yet: its own number has its own field.
    ("lead_number", "LEAD-1A2B3C4D"),
    ("patient_name", "Max Mustermann"),
    ("patient_first_name", "Max"),
    ("patient_last_name", "Mustermann"),
    ("patient_title", "Dr."),
    ("birth_date", "01.02.1980"),
    ("patient_street", "Musterstraße 1"),
    ("patient_zip", "10115"),
    ("patient_city", "Berlin"),
    ("patient_country", "Deutschland"),
    ("patient_email", "max.mustermann@example.com"),
    ("patient_phone", "+49 30 0000000"),
    ("order_number", "A-2026-0001"),
    ("appointment_title", "Erstuntersuchung"),
    ("appointment_date", "15.01.2027"),
    ("appointment_time", "09:30"),
    ("appointment_location", "Musterklinik, Raum 3"),
    ("provider_name", "Musterklinik Berlin"),
    ("doctor_name", "Dr. Erika Beispiel"),
    ("today", "10.11.2026"),
];

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/documents/template-imports",
            get(list_templates).post(import_template),
        )
        .route(
            "/documents/template-imports/{id}/update",
            post(update_template),
        )
        .route(
            "/documents/template-imports/{id}/preview",
            get(preview_template),
        )
        .route(
            "/documents/template-imports/{id}/activate",
            post(activate_template),
        )
        .route(
            "/documents/template-imports/{id}/disable",
            post(disable_template),
        )
        .layer(DefaultBodyLimit::max(MAX_TEMPLATE_FILE_BYTES + 256 * 1024))
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

fn db_error(context: &'static str, error: sqlx::Error) -> axum::response::Response {
    tracing::error!(error = %error, "{context}");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to process the document template",
    )
}

pub(crate) fn public_id(id: Uuid) -> String {
    format!("{PUBLIC_ID_PREFIX}{id}")
}

pub(crate) fn parse_public_id(value: &str) -> Option<Uuid> {
    value
        .trim()
        .strip_prefix(PUBLIC_ID_PREFIX)
        .and_then(|raw| Uuid::parse_str(raw.trim()).ok())
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

fn is_known_variable(key: &str) -> bool {
    VARIABLES.iter().any(|(known, _)| *known == key)
}

#[derive(Debug, Default, PartialEq, Eq)]
struct VariableCheck {
    /// Known variables the text uses, in the order of the catalog.
    used: Vec<String>,
    /// `{{...}}` whose name is not in the catalog, as written.
    unknown: Vec<String>,
    /// A `{{` without its `}}`.
    unclosed: bool,
}

impl VariableCheck {
    fn is_clean(&self) -> bool {
        self.unknown.is_empty() && !self.unclosed
    }
}

/// Walks the `{{name}}` marks of a text: `on_variable` gets the trimmed name
/// and returns the replacement, or `None` to keep the mark as written.
/// Returns the new text and whether a `{{` stayed open.
fn walk_variables(
    body: &str,
    mut on_variable: impl FnMut(&str) -> Option<String>,
) -> (String, bool) {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    let mut unclosed = false;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        // A mark never spans lines: an unclosed `{{` must not swallow the
        // rest of the document.
        let line_end = after.find('\n').unwrap_or(after.len());
        match after[..line_end].find("}}") {
            Some(end) => {
                let name = after[..end].trim();
                match on_variable(name) {
                    Some(value) => out.push_str(&value),
                    None => out.push_str(&rest[start..start + 2 + end + 2]),
                }
                rest = &after[end + 2..];
            }
            None => {
                unclosed = true;
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    (out, unclosed)
}

fn check_variables(body: &str) -> VariableCheck {
    let mut used = Vec::<String>::new();
    let mut unknown = Vec::<String>::new();
    let (_, unclosed) = walk_variables(body, |name| {
        if is_known_variable(name) {
            if !used.iter().any(|known| known == name) {
                used.push(name.to_string());
            }
        } else {
            let shown = format!("{{{{{name}}}}}");
            if !unknown.contains(&shown) {
                unknown.push(shown);
            }
        }
        None
    });
    used.sort_by_key(|name| VARIABLES.iter().position(|(known, _)| known == name));
    VariableCheck {
        used,
        unknown,
        unclosed,
    }
}

/// Replaces the known variables; anything else stays as written.
fn render_body(body: &str, values: &BTreeMap<&str, String>) -> String {
    walk_variables(body, |name| values.get(name).cloned()).0
}

fn sample_values() -> BTreeMap<&'static str, String> {
    VARIABLES
        .iter()
        .map(|(key, sample)| (*key, (*sample).to_string()))
        .collect()
}

// ---------------------------------------------------------------------------
// File → text
// ---------------------------------------------------------------------------

fn extension_of(file_name: Option<&str>) -> Option<String> {
    let name = file_name?.trim();
    let (_, extension) = name.rsplit_once('.')?;
    Some(extension.to_ascii_lowercase())
}

/// Line endings, trailing blanks and runs of empty lines of an imported text.
fn normalize_template_text(text: &str) -> String {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = Vec::<String>::new();
    for line in text.lines() {
        let line = line.replace(['\u{00a0}', '\t'], " ").trim_end().to_string();
        if line.is_empty() && lines.last().is_none_or(|last| last.is_empty()) {
            continue;
        }
        lines.push(line);
    }
    while lines.last().is_some_and(|last| last.is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}

// ---------------------------------------------------------------------------
// Line marks: the little formatting a template keeps
// ---------------------------------------------------------------------------

/// How a line of a template is printed. The marks are plain text at the
/// start of a line, so the CEO sees and corrects them in the draft:
/// `# ` a heading (centred, bold, large), `>< ` centred, `>> ` right-aligned;
/// a line wrapped in `**` is bold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TemplateLineKind {
    Heading,
    Center,
    Right,
    Plain,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TemplateLine<'a> {
    pub(crate) kind: TemplateLineKind,
    pub(crate) bold: bool,
    pub(crate) text: &'a str,
}

const HEADING_MARK: &str = "# ";
const CENTER_MARK: &str = ">< ";
const RIGHT_MARK: &str = ">> ";
const BOLD_MARK: &str = "**";

pub(crate) fn parse_template_line(line: &str) -> TemplateLine<'_> {
    let line = line.trim();
    let (kind, rest) = if let Some(rest) = line.strip_prefix(HEADING_MARK) {
        (TemplateLineKind::Heading, rest)
    } else if let Some(rest) = line.strip_prefix(CENTER_MARK) {
        (TemplateLineKind::Center, rest)
    } else if let Some(rest) = line.strip_prefix(RIGHT_MARK) {
        (TemplateLineKind::Right, rest)
    } else {
        (TemplateLineKind::Plain, line)
    };
    let rest = rest.trim();
    let bold_text = rest
        .strip_prefix(BOLD_MARK)
        .and_then(|inner| inner.strip_suffix(BOLD_MARK))
        .map(str::trim)
        .filter(|inner| !inner.is_empty());
    TemplateLine {
        kind,
        bold: bold_text.is_some() || kind == TemplateLineKind::Heading,
        text: bold_text.unwrap_or(rest),
    }
}

/// Whether the text opens with its own heading, so the template name is not
/// printed above it a second time.
pub(crate) fn template_text_starts_with_heading(text: &str) -> bool {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .is_some_and(|line| parse_template_line(line).kind == TemplateLineKind::Heading)
}

/// What a Word paragraph carries over: its alignment and whether all of its
/// text is bold or large.
#[derive(Default)]
struct DocxParagraph {
    text: String,
    align: Option<TemplateLineKind>,
    heading_style: bool,
    /// Runs with visible text: (bold, size in half-points).
    runs: Vec<(bool, Option<u32>)>,
}

impl DocxParagraph {
    fn marked_lines(&self) -> String {
        let all_bold = !self.runs.is_empty() && self.runs.iter().all(|(bold, _)| *bold);
        let size = self.runs.iter().filter_map(|(_, size)| *size).max();
        // 14 pt and larger in bold, or a heading style, is a heading.
        let heading = self.heading_style || (all_bold && size.is_some_and(|size| size >= 28));
        let prefix = if heading {
            HEADING_MARK
        } else {
            match self.align {
                Some(TemplateLineKind::Center) => CENTER_MARK,
                Some(TemplateLineKind::Right) => RIGHT_MARK,
                _ => "",
            }
        };
        self.text
            .split('\n')
            .map(|line| {
                let line = line.trim();
                if line.is_empty() {
                    String::new()
                } else if all_bold && !heading {
                    format!("{prefix}{BOLD_MARK}{line}{BOLD_MARK}")
                } else {
                    format!("{prefix}{line}")
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn docx_attribute(event: &BytesStart<'_>, name: &str) -> Option<String> {
    event.attributes().flatten().find_map(|attribute| {
        if attribute.key.local_name().as_ref() != name {
            return None;
        }
        attribute
            .normalized_value(XmlVersion::Implicit1_0)
            .ok()
            .map(|value| value.into_owned())
    })
}

/// `<w:b/>` switches on; `<w:b w:val="0"/>` (or "false") switches off.
fn docx_toggle_on(event: &BytesStart<'_>) -> bool {
    !matches!(
        docx_attribute(event, "val").as_deref(),
        Some("0" | "false" | "off")
    )
}

/// The run being read: whether it is bold, its size and whether it has text.
#[derive(Default)]
struct DocxRun {
    open: bool,
    bold: bool,
    size: Option<u32>,
    has_text: bool,
}

/// The paragraph and run properties the import keeps.
fn docx_property(
    event: &BytesStart<'_>,
    paragraph: &mut DocxParagraph,
    in_paragraph_properties: bool,
    run: &mut DocxRun,
) {
    match event.local_name().as_ref() {
        "jc" if in_paragraph_properties => {
            paragraph.align = match docx_attribute(event, "val").as_deref() {
                Some("center") => Some(TemplateLineKind::Center),
                Some("right" | "end") => Some(TemplateLineKind::Right),
                _ => None,
            };
        }
        "pStyle" if in_paragraph_properties => {
            let style = docx_attribute(event, "val")
                .unwrap_or_default()
                .to_ascii_lowercase();
            paragraph.heading_style = style == "title" || style.starts_with("heading");
        }
        // The paragraph mark has run properties of its own: only a run counts.
        "b" if run.open && !in_paragraph_properties => run.bold = docx_toggle_on(event),
        "sz" if run.open && !in_paragraph_properties => {
            run.size = docx_attribute(event, "val").and_then(|value| value.parse().ok());
        }
        _ => {}
    }
}

/// The text of `word/document.xml`: one line per paragraph, in reading
/// order. Of the formatting only headings, bold paragraphs and the centred
/// or right alignment are kept (as line marks); tables' borders, fonts,
/// images, headers and footers are not carried over, and a table cell is a
/// line of its own.
fn docx_xml_to_text(xml: &str) -> Result<String, &'static str> {
    const INVALID: &str = "The Word file could not be read";
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out = String::new();
    let mut paragraph = DocxParagraph::default();
    let mut run = DocxRun::default();
    let mut in_text = false;
    let mut in_paragraph_properties = false;
    let mut events = 0usize;
    loop {
        events += 1;
        if events > MAX_DOCX_XML_EVENTS {
            return Err("The Word file is too large");
        }
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                match event.local_name().as_ref() {
                    "p" => paragraph = DocxParagraph::default(),
                    "pPr" => in_paragraph_properties = true,
                    "r" => {
                        run = DocxRun {
                            open: true,
                            ..DocxRun::default()
                        }
                    }
                    "t" => in_text = true,
                    _ => {}
                }
                docx_property(&event, &mut paragraph, in_paragraph_properties, &mut run);
            }
            Ok(Event::Empty(event)) => {
                match event.local_name().as_ref() {
                    "tab" => paragraph.text.push(' '),
                    "br" | "cr" => paragraph.text.push('\n'),
                    // An empty paragraph is an empty line.
                    "p" => out.push('\n'),
                    _ => {}
                }
                docx_property(&event, &mut paragraph, in_paragraph_properties, &mut run);
            }
            Ok(Event::End(event)) => match event.local_name().as_ref() {
                "t" => in_text = false,
                "pPr" => in_paragraph_properties = false,
                "r" => {
                    if run.has_text {
                        paragraph.runs.push((run.bold, run.size));
                    }
                    run = DocxRun::default();
                }
                "p" => {
                    out.push_str(&paragraph.marked_lines());
                    out.push('\n');
                    paragraph = DocxParagraph::default();
                }
                _ => {}
            },
            Ok(Event::Text(text)) => {
                if in_text {
                    let text = text.xml10_content();
                    run.has_text |= !text.trim().is_empty();
                    paragraph.text.push_str(&text);
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if in_text {
                    run.has_text = true;
                    if reference.is_char_ref() {
                        if let Ok(Some(character)) = reference.resolve_char_ref() {
                            paragraph.text.push(character);
                        }
                    } else {
                        paragraph
                            .text
                            .push_str(resolve_xml_entity(&reference).ok_or(INVALID)?);
                    }
                }
            }
            Ok(Event::DocType(_)) => return Err(INVALID),
            Ok(Event::CData(_)) | Ok(Event::Decl(_)) | Ok(Event::Comment(_)) | Ok(Event::PI(_)) => {
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(INVALID),
        }
    }
    Ok(out)
}

fn docx_to_text(bytes: &[u8]) -> Result<String, &'static str> {
    const INVALID: &str = "The Word file could not be read";
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| INVALID)?;
    let file = archive
        .by_name("word/document.xml")
        .map_err(|_| "The file is not a Word document (.docx)")?;
    let mut xml = String::new();
    file.take(MAX_DOCX_XML_BYTES + 1)
        .read_to_string(&mut xml)
        .map_err(|_| INVALID)?;
    if xml.len() as u64 > MAX_DOCX_XML_BYTES {
        return Err("The Word file is too large");
    }
    docx_xml_to_text(&xml)
}

fn plain_text_to_text(bytes: &[u8]) -> Result<String, &'static str> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    if bytes.contains(&0) {
        return Err("The text file must be saved as UTF-8");
    }
    std::str::from_utf8(bytes)
        .map(ToOwned::to_owned)
        .map_err(|_| "The text file must be saved as UTF-8")
}

/// The template text of an uploaded file. Only .docx and .txt are accepted,
/// and the content has to be what the name says.
fn template_text_from_file(
    file_name: Option<&str>,
    declared_mime: Option<&str>,
    bytes: &[u8],
) -> Result<String, (StatusCode, &'static str)> {
    const UNSUPPORTED: &str = "A template is imported from a Word (.docx) or text (.txt) file";
    let unsupported = (StatusCode::UNSUPPORTED_MEDIA_TYPE, UNSUPPORTED);
    let text = match extension_of(file_name).as_deref() {
        Some("docx") => {
            validate_upload_magic_bytes(file_name, declared_mime, bytes)
                .map_err(|message| (StatusCode::UNSUPPORTED_MEDIA_TYPE, message))?;
            if !bytes.starts_with(b"PK") {
                return Err(unsupported);
            }
            docx_to_text(bytes).map_err(|message| (StatusCode::UNPROCESSABLE_ENTITY, message))?
        }
        Some("txt") => {
            // A renamed binary (PDF, image, archive) is not a text file.
            if bytes.starts_with(b"PK") || bytes.starts_with(b"%PDF") {
                return Err(unsupported);
            }
            validate_upload_magic_bytes(file_name, Some("text/plain"), bytes)
                .map_err(|message| (StatusCode::UNSUPPORTED_MEDIA_TYPE, message))?;
            plain_text_to_text(bytes)
                .map_err(|message| (StatusCode::UNPROCESSABLE_ENTITY, message))?
        }
        _ => return Err(unsupported),
    };
    let text = normalize_template_text(&text);
    validate_body(&text).map_err(|message| (StatusCode::UNPROCESSABLE_ENTITY, message))?;
    Ok(text)
}

fn validate_body(body: &str) -> Result<(), &'static str> {
    if body.trim().is_empty() {
        return Err("The template has no text");
    }
    if body.chars().count() > MAX_TEMPLATE_BODY_CHARS {
        return Err("The template text is too long");
    }
    Ok(())
}

fn normalize_label(value: &str) -> Result<String, &'static str> {
    let label = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.is_empty() {
        return Err("The template needs a name");
    }
    if label.chars().count() > MAX_LABEL_CHARS {
        return Err("The template name is too long");
    }
    Ok(label)
}

fn normalize_description(value: Option<&str>) -> Result<Option<String>, &'static str> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err("The template description is too long");
    }
    Ok(Some(value.to_string()))
}

fn normalize_language(value: Option<&str>) -> Result<&'static str, &'static str> {
    let value = value
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    LANGUAGES
        .iter()
        .copied()
        .find(|language| *language == value)
        .ok_or("Unknown template language")
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const TEMPLATE_SELECT: &str = r#"
    SELECT t.id, t.family_id, t.version_number, t.label, t.description, t.language,
           t.body, t.status, t.source_filename, t.created_at, t.updated_at,
           t.activated_at, t.disabled_at,
           (t.source_docx IS NOT NULL) AS exact_layout,
           creator.name AS created_by_name,
           activator.name AS activated_by_name
    FROM agency_document_templates t
    LEFT JOIN users creator ON creator.id = t.created_by
    LEFT JOIN users activator ON activator.id = t.activated_by
"#;

fn template_json(row: &sqlx::postgres::PgRow) -> Value {
    let id: Uuid = row.get("id");
    let body: String = row.get("body");
    let check = check_variables(&body);
    let timestamp = |column: &str| {
        row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(column)
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339())
    };
    json!({
        "id": id,
        "public_id": public_id(id),
        "family_id": row.get::<Uuid, _>("family_id"),
        "version_number": row.get::<i32, _>("version_number"),
        "label": row.get::<String, _>("label"),
        "description": row.get::<Option<String>, _>("description"),
        "language": row.get::<String, _>("language"),
        "status": row.get::<String, _>("status"),
        "source_filename": row.get::<Option<String>, _>("source_filename"),
        "created_at": timestamp("created_at"),
        "updated_at": timestamp("updated_at"),
        "activated_at": timestamp("activated_at"),
        "disabled_at": timestamp("disabled_at"),
        "created_by_name": row.get::<Option<String>, _>("created_by_name"),
        "activated_by_name": row.get::<Option<String>, _>("activated_by_name"),
        "preview_text": render_body(&body, &sample_values()),
        "used_variables": check.used,
        "unknown_variables": check.unknown,
        "unclosed_variable": check.unclosed,
        "can_activate": check.is_clean(),
        // A Word template is printed from its file, as it looks in Word.
        "exact_layout": row.try_get::<bool, _>("exact_layout").unwrap_or(false),
        "body": body,
    })
}

async fn load_template_json<'e, E>(executor: E, id: Uuid) -> Result<Option<Value>, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    let row = sqlx::query(&format!("{TEMPLATE_SELECT} WHERE t.id = $1"))
        .bind(id)
        .fetch_optional(executor)
        .await?;
    Ok(row.as_ref().map(template_json))
}

fn variables_json() -> Value {
    VARIABLES
        .iter()
        .map(|(key, sample)| json!({ "key": key, "sample": sample }))
        .collect()
}

/// The active templates as entries of the "generate from template" catalog
/// (`GET /documents/templates`). They print like "Freies Dokument".
pub(crate) async fn catalog_entries(state: &AppState) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT id, label, description, language
           FROM agency_document_templates
           WHERE status = 'active'
           ORDER BY lower(label), version_number"#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .iter()
        .map(|row| {
            let label: String = row.get("label");
            json!({
                "id": public_id(row.get::<Uuid, _>("id")),
                "template_kind": "agency",
                "lead_only": false,
                "label": label,
                "description": row.get::<Option<String>, _>("description"),
                "art": "free_text_document",
                "category": "administrative",
                "default_auto_name": label,
                "default_status": "draft",
                "default_visibility": "internal",
                "is_medical": false,
                "supported_languages": [row.get::<String, _>("language")],
                "text_block_keys": Vec::<String>::new(),
            })
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/// Whom a document is generated for: a patient, or a lead that is not a
/// patient yet.
#[derive(Clone, Copy)]
pub(crate) enum TemplateSubject {
    Patient(Uuid),
    Lead(Uuid),
}

/// An active template filled with the data of the patient, order and
/// appointment a document is generated for.
pub(crate) struct RenderedAgencyTemplate {
    pub(crate) public_id: String,
    pub(crate) label: String,
    pub(crate) language: String,
    pub(crate) text: String,
    pub(crate) patient_name: String,
    /// The template's Word file with the data filled in and the page set
    /// for the letterhead; `None` for a text template.
    pub(crate) docx: Option<Vec<u8>>,
}

/// The Word file of a template made ready for printing: the letterhead's
/// page and the variables replaced by `values`.
fn prepared_docx(
    source: &[u8],
    values: &BTreeMap<&str, String>,
) -> Result<Vec<u8>, axum::response::Response> {
    crate::docx_render::prepare_docx(
        source,
        super::documents::AGENCY_TEMPLATE_PAGE_FRAME,
        Some(&|text: &str| render_body(text, values)),
    )
    .map_err(|message| err(StatusCode::UNPROCESSABLE_ENTITY, message))
}

fn format_date(value: Option<NaiveDate>) -> String {
    value
        .map(|date| date.format("%d.%m.%Y").to_string())
        .unwrap_or_default()
}

fn text_column(row: &sqlx::postgres::PgRow, column: &str) -> String {
    row.try_get::<Option<String>, _>(column)
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

/// Fills an active template for `generate_document`. The caller has already
/// checked the role and the access to the patient.
pub(crate) async fn render_for_generation(
    state: &AppState,
    template_id: Uuid,
    subject: TemplateSubject,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
) -> Result<RenderedAgencyTemplate, axum::response::Response> {
    let template = sqlx::query(
        r#"SELECT id, label, language, body, source_docx
           FROM agency_document_templates
           WHERE id = $1 AND status = 'active'"#,
    )
    .bind(template_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| db_error("load agency document template", error))?
    .ok_or_else(|| {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown document template",
        )
    })?;

    // A lead answers under the same field names as a patient (owner request
    // 2026-11-11). Its request number is no patient number: it fills
    // `{{lead_number}}` and leaves `{{patient_id}}` empty (release QA C S3-4).
    let patient = match subject {
        TemplateSubject::Patient(patient_id) => sqlx::query(
            r#"SELECT patient_id, NULL::text AS lead_number,
                      title, first_name, last_name, birth_date,
                      address_street, address_zip, address_city, address_country,
                      email, phone_primary
               FROM patients
               WHERE id = $1"#,
        )
        .bind(patient_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| db_error("load agency template patient", error))?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Patient not found"))?,
        TemplateSubject::Lead(lead_id) => sqlx::query(
            r#"SELECT NULL::text AS patient_id,
                      'LEAD-' || upper(left(replace(id::text, '-', ''), 8)) AS lead_number,
                      NULL::text AS title, first_name, last_name,
                      date_of_birth AS birth_date,
                      street_address AS address_street, zip_code AS address_zip,
                      city AS address_city, country AS address_country,
                      email, phone AS phone_primary
               FROM leads
               WHERE id = $1 AND converted_patient_id IS NULL"#,
        )
        .bind(lead_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| db_error("load agency template lead", error))?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Lead not found"))?,
    };

    let first_name = text_column(&patient, "first_name");
    let last_name = text_column(&patient, "last_name");
    let patient_name = format!("{first_name} {last_name}").trim().to_string();

    let mut values = BTreeMap::<&str, String>::new();
    values.insert("patient_id", text_column(&patient, "patient_id"));
    values.insert("lead_number", text_column(&patient, "lead_number"));
    values.insert("patient_name", patient_name.clone());
    values.insert("patient_first_name", first_name);
    values.insert("patient_last_name", last_name);
    values.insert("patient_title", text_column(&patient, "title"));
    values.insert(
        "birth_date",
        format_date(
            patient
                .try_get::<Option<NaiveDate>, _>("birth_date")
                .ok()
                .flatten(),
        ),
    );
    values.insert("patient_street", text_column(&patient, "address_street"));
    values.insert("patient_zip", text_column(&patient, "address_zip"));
    values.insert("patient_city", text_column(&patient, "address_city"));
    values.insert("patient_country", text_column(&patient, "address_country"));
    values.insert("patient_email", text_column(&patient, "email"));
    values.insert("patient_phone", text_column(&patient, "phone_primary"));

    let order_number = match order_id {
        Some(order_id) => {
            sqlx::query_scalar::<_, String>("SELECT order_number FROM orders WHERE id = $1")
                .bind(order_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|error| db_error("load agency template order", error))?
        }
        // A document made on the lead card names no order: the lead's own
        // order (the newest one that is not cancelled) is its order.
        None => match subject {
            TemplateSubject::Lead(lead_id) => sqlx::query_scalar::<_, String>(
                r#"SELECT order_number FROM orders
                   WHERE source_lead_id = $1 AND status <> 'cancelled'
                   ORDER BY created_at DESC
                   LIMIT 1"#,
            )
            .bind(lead_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|error| db_error("load agency template lead order", error))?,
            TemplateSubject::Patient(_) => None,
        },
    };
    values.insert("order_number", order_number.unwrap_or_default());

    let appointment = match appointment_id {
        Some(appointment_id) => sqlx::query(
            r#"SELECT a.title, a.date, a.time_start, a.location,
                      provider.name AS provider_name, doctor.name AS doctor_name
               FROM appointments a
               LEFT JOIN providers provider ON provider.id = a.provider_id
               LEFT JOIN provider_doctors doctor ON doctor.id = a.doctor_id
               WHERE a.id = $1"#,
        )
        .bind(appointment_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| db_error("load agency template appointment", error))?,
        None => None,
    };
    let appointment_text = |column: &str| {
        appointment
            .as_ref()
            .map(|row| text_column(row, column))
            .unwrap_or_default()
    };
    values.insert("appointment_title", appointment_text("title"));
    values.insert("appointment_location", appointment_text("location"));
    values.insert("provider_name", appointment_text("provider_name"));
    values.insert("doctor_name", appointment_text("doctor_name"));
    values.insert(
        "appointment_date",
        format_date(
            appointment
                .as_ref()
                .and_then(|row| row.try_get::<Option<NaiveDate>, _>("date").ok().flatten()),
        ),
    );
    values.insert(
        "appointment_time",
        appointment
            .as_ref()
            .and_then(|row| {
                row.try_get::<Option<NaiveTime>, _>("time_start")
                    .ok()
                    .flatten()
            })
            .map(|time| time.format("%H:%M").to_string())
            .unwrap_or_default(),
    );
    values.insert("today", format_date(Some(crate::app_time::today())));

    let body: String = template.get("body");
    let docx = match template.get::<Option<Vec<u8>>, _>("source_docx") {
        Some(source) => Some(prepared_docx(&source, &values)?),
        None => None,
    };
    Ok(RenderedAgencyTemplate {
        public_id: public_id(template.get::<Uuid, _>("id")),
        label: template.get("label"),
        language: template.get("language"),
        text: render_body(&body, &values),
        patient_name,
        docx,
    })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn list_templates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(TEMPLATE_ROLES) {
        return resp;
    }
    let rows = match sqlx::query(&format!(
        r#"{TEMPLATE_SELECT}
           ORDER BY CASE t.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
                    lower(t.label), t.version_number DESC"#
    ))
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return db_error("list agency document templates", error),
    };
    Json(json!({
        "templates": rows.iter().map(template_json).collect::<Vec<_>>(),
        "variables": variables_json(),
        "max_file_bytes": MAX_TEMPLATE_FILE_BYTES,
        "max_body_chars": MAX_TEMPLATE_BODY_CHARS,
        // Without LibreOffice (a developer's stack) a Word template prints
        // as text on the letterhead instead of looking as in Word.
        "exact_layout_available": crate::docx_render::converter_available().await,
    }))
    .into_response()
}

async fn import_template(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(TEMPLATE_ROLES) {
        return resp;
    }

    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut declared_mime: Option<String> = None;
    let mut label: Option<String> = None;
    let mut description: Option<String> = None;
    let mut language: Option<String> = None;
    let mut family_id: Option<Uuid> = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => {
                return err(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "The template file is too large",
                );
            }
        };
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                file_name = field.file_name().map(ToOwned::to_owned);
                declared_mime = field.content_type().map(ToOwned::to_owned);
                match field.bytes().await {
                    Ok(bytes) if bytes.len() <= MAX_TEMPLATE_FILE_BYTES => {
                        file_data = Some(bytes.to_vec());
                    }
                    _ => {
                        return err(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "The template file is too large",
                        );
                    }
                }
            }
            "label" => label = field.text().await.ok(),
            "description" => description = field.text().await.ok(),
            "language" => language = field.text().await.ok(),
            "family_id" => {
                let raw = field.text().await.unwrap_or_default();
                let raw = raw.trim();
                if !raw.is_empty() {
                    match Uuid::parse_str(raw) {
                        Ok(value) => family_id = Some(value),
                        Err(_) => {
                            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid template");
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let Some(bytes) = file_data.filter(|bytes| !bytes.is_empty()) else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "No template file");
    };
    let language = match normalize_language(language.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let description = match normalize_description(description.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let body = match template_text_from_file(file_name.as_deref(), declared_mime.as_deref(), &bytes)
    {
        Ok(value) => value,
        Err((status, message)) => return err(status, message),
    };
    // A Word file is kept: the document is printed from it, as it looks in
    // Word. It has to survive the preparation every print repeats.
    let source_docx = if extension_of(file_name.as_deref()).as_deref() == Some("docx") {
        if let Err(response) = prepared_docx(&bytes, &sample_values()) {
            return response;
        }
        Some(bytes.clone())
    } else {
        None
    };
    match scan_upload_bytes(file_name.as_deref(), &bytes).await {
        Ok(_) => {}
        Err(message) if message == crate::file_scan::MALWARE_FOUND => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, &message);
        }
        Err(message) => {
            tracing::error!(error = %message, "scan imported document template");
            return err(
                StatusCode::SERVICE_UNAVAILABLE,
                "The file could not be checked for malware",
            );
        }
    }

    // A file name is shown to staff only: keep its last path segment.
    let source_filename = file_name
        .as_deref()
        .map(|name| name.rsplit(['/', '\\']).next().unwrap_or(name).trim())
        .filter(|name| !name.is_empty())
        .map(|name| name.chars().take(255).collect::<String>());
    let default_label = source_filename
        .as_deref()
        .map(|name| name.rsplit_once('.').map_or(name, |(stem, _)| stem))
        .unwrap_or("Vorlage")
        .to_string();
    let source_sha256 = hex::encode(Sha256::digest(&bytes));

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return db_error("begin agency template import", error),
    };

    // A new version of a known template keeps its name unless one is given.
    let (family_id, version_number, family_label) = match family_id {
        Some(family_id) => {
            let latest = match sqlx::query(
                r#"SELECT version_number, label
                   FROM agency_document_templates
                   WHERE family_id = $1
                   ORDER BY version_number DESC
                   LIMIT 1
                   FOR UPDATE"#,
            )
            .bind(family_id)
            .fetch_optional(&mut *tx)
            .await
            {
                Ok(Some(row)) => row,
                Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
                Err(error) => return db_error("load agency template family", error),
            };
            (
                family_id,
                latest.get::<i32, _>("version_number") + 1,
                Some(latest.get::<String, _>("label")),
            )
        }
        None => (Uuid::new_v4(), 1, None),
    };
    let label = label
        .filter(|value| !value.trim().is_empty())
        .or(family_label)
        .unwrap_or(default_label);
    let label = match normalize_label(&label) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let template_id = Uuid::new_v4();
    if let Err(error) = sqlx::query(
        r#"INSERT INTO agency_document_templates (
                id, family_id, version_number, label, description, language, body,
                status, source_filename, source_sha256, created_by, updated_by, source_docx
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $10, $11)"#,
    )
    .bind(template_id)
    .bind(family_id)
    .bind(version_number)
    .bind(&label)
    .bind(&description)
    .bind(language)
    .bind(&body)
    .bind(&source_filename)
    .bind(&source_sha256)
    .bind(auth.user_id)
    .bind(&source_docx)
    .execute(&mut *tx)
    .await
    {
        if error
            .as_database_error()
            .is_some_and(|db| db.is_unique_violation())
        {
            return err(
                StatusCode::CONFLICT,
                "The template was changed meanwhile. Reload and try again.",
            );
        }
        return db_error("insert agency document template", error);
    }

    let check = check_variables(&body);
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "document_template_imported",
            Some(auth.user_id),
            ENTITY_TYPE,
            Some(template_id),
            json!({
                "family_id": family_id,
                "version_number": version_number,
                "label": label,
                "language": language,
                "source_filename": source_filename,
                "source_sha256": source_sha256,
                "body_chars": body.chars().count(),
                "unknown_variables": check.unknown,
                "unclosed_variable": check.unclosed,
            }),
        ),
    )
    .await
    {
        return db_error("audit agency template import", error);
    }
    let template = match load_template_json(&mut *tx, template_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("reload imported agency template", error),
    };
    if let Err(error) = tx.commit().await {
        return db_error("commit agency template import", error);
    }

    (StatusCode::CREATED, Json(json!({ "template": template }))).into_response()
}

#[derive(Deserialize)]
struct UpdateTemplateRequest {
    label: Option<String>,
    description: Option<String>,
    language: Option<String>,
    body: Option<String>,
}

/// Corrects a draft: its name, description, language and text. An activated
/// or disabled version is never edited — a changed text is a new version.
async fn update_template(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(template_id): Path<Uuid>,
    Json(request): Json<UpdateTemplateRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(TEMPLATE_ROLES) {
        return resp;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return db_error("begin agency template update", error),
    };
    let current = match sqlx::query(
        r#"SELECT label, description, language, body, status,
                  (source_docx IS NOT NULL) AS exact_layout
           FROM agency_document_templates
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(template_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("load agency template for update", error),
    };
    if current.get::<String, _>("status") != "draft" {
        return err(
            StatusCode::CONFLICT,
            "Only a draft can be edited. Import a new version instead.",
        );
    }

    let label = match request.label.as_deref() {
        Some(value) => match normalize_label(value) {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => current.get("label"),
    };
    let description = match request.description.as_deref() {
        Some(value) => match normalize_description(Some(value)) {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => current.get("description"),
    };
    let language = match request.language.as_deref() {
        Some(value) => match normalize_language(Some(value)) {
            Ok(value) => value.to_string(),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => current.get("language"),
    };
    let old_body: String = current.get("body");
    let body = match request.body.as_deref() {
        Some(value) => {
            let value = normalize_template_text(value);
            if let Err(message) = validate_body(&value) {
                return err(StatusCode::UNPROCESSABLE_ENTITY, message);
            }
            // The text of a Word template is its file: it is changed in
            // Word and uploaded again, not typed over here.
            if value != old_body && current.get::<bool, _>("exact_layout") {
                return err(
                    StatusCode::CONFLICT,
                    "Change the Word file and upload it again",
                );
            }
            value
        }
        None => old_body.clone(),
    };

    if let Err(error) = sqlx::query(
        r#"UPDATE agency_document_templates
           SET label = $2, description = $3, language = $4, body = $5,
               updated_by = $6, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(template_id)
    .bind(&label)
    .bind(&description)
    .bind(&language)
    .bind(&body)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return db_error("update agency document template", error);
    }
    let check = check_variables(&body);
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "document_template_updated",
            Some(auth.user_id),
            ENTITY_TYPE,
            Some(template_id),
            json!({
                "label": label,
                "language": language,
                "body_changed": body != old_body,
                "body_chars": body.chars().count(),
                "unknown_variables": check.unknown,
                "unclosed_variable": check.unclosed,
            }),
        ),
    )
    .await
    {
        return db_error("audit agency template update", error);
    }
    let template = match load_template_json(&mut *tx, template_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("reload agency template", error),
    };
    if let Err(error) = tx.commit().await {
        return db_error("commit agency template update", error);
    }
    Json(json!({ "template": template })).into_response()
}

/// The template as a PDF on the GMED letterhead, filled with sample data.
async fn preview_template(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(template_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(TEMPLATE_ROLES) {
        return resp;
    }
    let row = match sqlx::query(
        "SELECT label, body, source_docx FROM agency_document_templates WHERE id = $1",
    )
    .bind(template_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("load agency template preview", error),
    };
    let label: String = row.get("label");
    let body: String = row.get("body");
    let samples = sample_values();
    let text = render_body(&body, &samples);
    let docx = match row.get::<Option<Vec<u8>>, _>("source_docx") {
        Some(source) => match prepared_docx(&source, &samples) {
            Ok(prepared) => Some(prepared),
            Err(response) => return response,
        },
        None => None,
    };
    let pdf =
        match super::documents::agency_template_preview_pdf(&state, &label, &text, docx.as_deref())
            .await
        {
            Ok(bytes) => bytes,
            Err(resp) => return resp,
        };
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/pdf"),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_static("inline; filename=\"vorschau.pdf\""),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        pdf,
    )
        .into_response()
}

/// Offers a checked draft (or a disabled version again) in "generate from
/// template"; the version of the same template that was active steps back.
async fn activate_template(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(template_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(TEMPLATE_ROLES) {
        return resp;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return db_error("begin agency template activation", error),
    };
    let current = match sqlx::query(
        r#"SELECT family_id, version_number, label, body, status
           FROM agency_document_templates
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(template_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("load agency template for activation", error),
    };
    let family_id: Uuid = current.get("family_id");
    if current.get::<String, _>("status") == "active" {
        return err(StatusCode::CONFLICT, "The template is already active");
    }
    let check = check_variables(&current.get::<String, _>("body"));
    if !check.is_clean() {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": "template_variables_invalid",
                "message": "The template has unknown or unfinished variables",
                "unknown_variables": check.unknown,
                "unclosed_variable": check.unclosed,
            })),
        )
            .into_response();
    }

    let replaced = match sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE agency_document_templates
           SET status = 'disabled', disabled_by = $2, disabled_at = now(),
               updated_by = $2, updated_at = now()
           WHERE family_id = $1 AND status = 'active'
           RETURNING id"#,
    )
    .bind(family_id)
    .bind(auth.user_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => return db_error("retire active agency template", error),
    };
    if let Err(error) = sqlx::query(
        r#"UPDATE agency_document_templates
           SET status = 'active', activated_by = $2, activated_at = now(),
               disabled_by = NULL, disabled_at = NULL,
               updated_by = $2, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(template_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return db_error("activate agency document template", error);
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "document_template_activated",
            Some(auth.user_id),
            ENTITY_TYPE,
            Some(template_id),
            json!({
                "family_id": family_id,
                "version_number": current.get::<i32, _>("version_number"),
                "label": current.get::<String, _>("label"),
                "replaced_template_ids": replaced,
            }),
        ),
    )
    .await
    {
        return db_error("audit agency template activation", error);
    }
    let template = match load_template_json(&mut *tx, template_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("reload agency template", error),
    };
    if let Err(error) = tx.commit().await {
        return db_error("commit agency template activation", error);
    }
    Json(json!({ "template": template, "replaced_template_ids": replaced })).into_response()
}

/// Takes a template out of "generate from template" (or drops a draft). The
/// documents already generated from it stay as they are.
async fn disable_template(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(template_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(TEMPLATE_ROLES) {
        return resp;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return db_error("begin agency template disabling", error),
    };
    let previous = match sqlx::query(
        r#"SELECT status, label, family_id, version_number
           FROM agency_document_templates
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(template_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("load agency template for disabling", error),
    };
    let previous_status: String = previous.get("status");
    if previous_status == "disabled" {
        return err(StatusCode::CONFLICT, "The template is already disabled");
    }
    if let Err(error) = sqlx::query(
        r#"UPDATE agency_document_templates
           SET status = 'disabled', disabled_by = $2, disabled_at = now(),
               updated_by = $2, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(template_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return db_error("disable agency document template", error);
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "document_template_disabled",
            Some(auth.user_id),
            ENTITY_TYPE,
            Some(template_id),
            json!({
                "family_id": previous.get::<Uuid, _>("family_id"),
                "version_number": previous.get::<i32, _>("version_number"),
                "label": previous.get::<String, _>("label"),
                "previous_status": previous_status,
            }),
        ),
    )
    .await
    {
        return db_error("audit agency template disabling", error);
    }
    let template = match load_template_json(&mut *tx, template_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Template not found"),
        Err(error) => return db_error("reload agency template", error),
    };
    if let Err(error) = tx.commit().await {
        return db_error("commit agency template disabling", error);
    }
    Json(json!({ "template": template })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn docx_with(document_xml: &str) -> Vec<u8> {
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("[Content_Types].xml", options).unwrap();
        archive.write_all(b"<Types/>").unwrap();
        archive.start_file("word/document.xml", options).unwrap();
        archive.write_all(document_xml.as_bytes()).unwrap();
        archive.finish().unwrap().into_inner()
    }

    const SAMPLE_DOCUMENT_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Bescheinigung</w:t></w:r></w:p>
    <w:p/>
    <w:p>
      <w:r><w:t xml:space="preserve">Hiermit bestätigen wir, dass {{patient_</w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>name}}</w:t></w:r>
      <w:r><w:t xml:space="preserve">, geboren am {{ birth_date }}, M&amp;M </w:t></w:r>
      <w:r><w:tab/><w:t>betreut wird.</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Zeile 1</w:t><w:br/><w:t>Zeile 2</w:t></w:r></w:p>
    <w:p><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>
  </w:body>
</w:document>"#;

    #[test]
    fn docx_text_keeps_paragraphs_and_joins_split_runs() {
        let text = template_text_from_file(
            Some("Bescheinigung.docx"),
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            &docx_with(SAMPLE_DOCUMENT_XML),
        )
        .unwrap();
        assert_eq!(
            text,
            "Bescheinigung\n\nHiermit bestätigen wir, dass {{patient_name}}, geboren am \
             {{ birth_date }}, M&M  betreut wird.\nZeile 1\nZeile 2"
        );
        // A variable Word split into two runs is still one variable.
        let check = check_variables(&text);
        assert_eq!(check.used, vec!["patient_name", "birth_date"]);
        assert!(check.is_clean());
    }

    /// The owner's sample of 2026-11-10: a centred bold 18 pt title, a date
    /// against the right margin, body paragraphs, one bold and one centred.
    #[test]
    fn docx_keeps_heading_bold_and_alignment_as_line_marks() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="36"/></w:rPr><w:t>Lorem</w:t></w:r>
      <w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve"> ipsum</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Date: 00.00.0000</w:t></w:r></w:p>
    <w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr></w:p>
    <w:p><w:r><w:t>Plain text</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>All bold</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Bold switched off</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Half</w:t></w:r><w:r><w:t xml:space="preserve"> bold</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Centred bold</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Styled heading</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let text = template_text_from_file(Some("sample.docx"), None, &docx_with(xml)).unwrap();
        assert_eq!(
            text,
            "# Lorem ipsum\n>> Date: 00.00.0000\n\nPlain text\n**All bold**\nBold switched off\n\
             Half bold\n>< **Centred bold**\n# Styled heading"
        );
        assert!(template_text_starts_with_heading(&text));
        assert!(!template_text_starts_with_heading("Text\n# Later heading"));
    }

    #[test]
    fn line_marks_are_parsed() {
        let line = |kind, bold, text| TemplateLine { kind, bold, text };
        assert_eq!(
            parse_template_line("# Titel"),
            line(TemplateLineKind::Heading, true, "Titel")
        );
        assert_eq!(
            parse_template_line(">> Datum: {{today}}"),
            line(TemplateLineKind::Right, false, "Datum: {{today}}")
        );
        assert_eq!(
            parse_template_line(">< **Mitte**"),
            line(TemplateLineKind::Center, true, "Mitte")
        );
        assert_eq!(
            parse_template_line("**Fett**"),
            line(TemplateLineKind::Plain, true, "Fett")
        );
        // Not marks: no space after the sign, bold only inside the line, an
        // empty bold pair.
        assert_eq!(
            parse_template_line("#1 Nummer"),
            line(TemplateLineKind::Plain, false, "#1 Nummer")
        );
        assert_eq!(
            parse_template_line("Ein **Wort** fett"),
            line(TemplateLineKind::Plain, false, "Ein **Wort** fett")
        );
        assert_eq!(
            parse_template_line("****"),
            line(TemplateLineKind::Plain, false, "****")
        );
    }

    #[test]
    fn only_word_and_text_files_are_templates() {
        let pdf = b"%PDF-1.7 not a template";
        for (name, bytes) in [
            ("vorlage.pdf", &pdf[..]),
            ("vorlage.txt", &pdf[..]),
            ("vorlage.docx", &pdf[..]),
            ("vorlage.docx", &b"plain text in a docx name"[..]),
            ("vorlage.html", &b"<html></html>"[..]),
            ("vorlage", &b"text"[..]),
        ] {
            let (status, _) = template_text_from_file(Some(name), None, bytes).unwrap_err();
            assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE, "{name}");
        }
        // A zip that is not a Word document.
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        archive
            .start_file("other.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"x").unwrap();
        let zip_bytes = archive.finish().unwrap().into_inner();
        let (status, _) =
            template_text_from_file(Some("vorlage.docx"), None, &zip_bytes).unwrap_err();
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn text_file_is_normalized_and_must_be_utf8() {
        let text = template_text_from_file(
            Some("brief.txt"),
            Some("text/plain"),
            "\u{feff}Sehr geehrte Frau {{patient_last_name}},\r\n\r\n\r\n\r\nGruß  \r\n\r\n"
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(text, "Sehr geehrte Frau {{patient_last_name}},\n\nGruß");

        let (status, _) =
            template_text_from_file(Some("brief.txt"), Some("text/plain"), &[0xC4, 0xD6, 0xDC])
                .unwrap_err();
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        let (status, _) =
            template_text_from_file(Some("leer.txt"), Some("text/plain"), b"  \n ").unwrap_err();
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn unknown_and_unfinished_variables_block_activation() {
        let check = check_variables(
            "{{today}} {{patient_name}} {{ Patient }} {{patient_nmae}} {{Patient}} {{today}}",
        );
        assert_eq!(check.used, vec!["patient_name", "today"]);
        assert_eq!(check.unknown, vec!["{{Patient}}", "{{patient_nmae}}"]);
        assert!(!check.unclosed);
        assert!(!check.is_clean());

        let check = check_variables("Datum: {{today\nName: {{patient_name}}");
        assert!(check.unclosed);
        assert_eq!(check.used, vec!["patient_name"]);
        assert!(!check.is_clean());

        assert!(check_variables("Ohne Variablen, mit { einer } Klammer.").is_clean());
    }

    #[test]
    fn rendering_fills_known_variables_only() {
        let mut values = BTreeMap::new();
        values.insert("patient_name", "Erika {{today}} Muster".to_string());
        values.insert("today", "10.11.2026".to_string());
        assert_eq!(
            render_body(
                "{{patient_name}} / {{ today }} / {{unknown}} / {{offen",
                &values
            ),
            // A value is never expanded a second time.
            "Erika {{today}} Muster / 10.11.2026 / {{unknown}} / {{offen"
        );
    }

    #[test]
    fn every_variable_has_a_sample_and_a_unique_key() {
        let samples = sample_values();
        assert_eq!(samples.len(), VARIABLES.len());
        let all = VARIABLES
            .iter()
            .map(|(key, _)| format!("{{{{{key}}}}}"))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(!render_body(&all, &samples).contains("{{"));
    }

    #[test]
    fn public_id_round_trips() {
        let id = Uuid::new_v4();
        assert_eq!(parse_public_id(&public_id(id)), Some(id));
        assert_eq!(parse_public_id("provider_template:x"), None);
        assert_eq!(parse_public_id("free_text_document"), None);
    }
}
