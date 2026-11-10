//! Word (.docx) → PDF with the GMED letterhead, for imported agency
//! templates (owner decision 2026-11-10: "I write it in Word, upload it and
//! it looks like that, plus the frames at the top and the bottom").
//!
//! Three steps, each a function of this module:
//! 1. [`prepare_docx`] makes the file fit the letterhead: A4, the top and
//!    bottom margins of the letterhead, no header or footer of its own, no
//!    macros, no external links, and — for a generated document — the
//!    `{{variables}}` filled in.
//! 2. [`docx_to_pdf`] converts it with LibreOffice running inside the server
//!    (no cloud service). Fonts, tables, images, lists and page breaks come
//!    out as LibreOffice lays them out — close to Word, not pixel-identical.
//! 3. [`stamp_letterhead`] draws the letterhead page of the same number over
//!    every converted page.

use std::io::{Cursor, Read, Write};
use std::path::PathBuf;
use std::time::Duration;

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use quick_xml::events::{BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer, XmlVersion};
use uuid::Uuid;

const MAX_DOCX_ENTRIES: usize = 2_000;
const MAX_DOCX_UNPACKED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_EVENTS: usize = 1_500_000;
const CONVERSION_TIMEOUT: Duration = Duration::from_secs(120);
const INVALID_DOCX: &str = "The Word file could not be read";
const INVALID_PDF: &str = "The converted document could not be read";
const LETTERHEAD_XOBJECT: &str = "GmedLetterhead";

/// A4 in twentieths of a point, the unit of Word page settings.
const A4_WIDTH_TWIPS: u32 = 11_906;
const A4_HEIGHT_TWIPS: u32 = 16_838;
/// The room the letterhead leaves on a page, in millimetres: the top and
/// bottom margins a Word file gets, and the least its side margins may be
/// (wider ones of the file stay), so that the text never runs past the
/// letterhead's rules.
#[derive(Clone, Copy)]
pub(crate) struct PageFrame {
    pub(crate) top_mm: f32,
    pub(crate) bottom_mm: f32,
    pub(crate) left_mm: f32,
    pub(crate) right_mm: f32,
}

pub(crate) fn mm_to_twips(mm: f32) -> u32 {
    (mm * 1440.0 / 25.4).round() as u32
}

// ---------------------------------------------------------------------------
// 1. The Word file
// ---------------------------------------------------------------------------

fn attribute_value(event: &BytesStart<'_>, name: &str) -> Option<String> {
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

/// The element with some attributes replaced or added; the others stay.
/// `changes` are (local name, qualified name, value); `None` drops it.
fn with_attributes(
    event: &BytesStart<'_>,
    changes: &[(&str, &str, Option<String>)],
) -> BytesStart<'static> {
    let mut element = BytesStart::new(event.name().as_ref().to_string());
    let mut seen = Vec::new();
    for attribute in event.attributes().flatten() {
        let local = attribute.key.local_name();
        match changes.iter().find(|(name, _, _)| *name == local.as_ref()) {
            Some((name, qualified, value)) => {
                seen.push(*name);
                if let Some(value) = value {
                    element.push_attribute((*qualified, value.as_str()));
                }
            }
            None => {
                let value = attribute
                    .normalized_value(XmlVersion::Implicit1_0)
                    .map(|value| value.into_owned())
                    .unwrap_or_default();
                element.push_attribute((attribute.key.as_ref(), value.as_str()));
            }
        }
    }
    for (name, qualified, value) in changes {
        if let (false, Some(value)) = (seen.contains(name), value) {
            element.push_attribute((*qualified, value.as_str()));
        }
    }
    element
}

/// The page settings a section gets: A4 upright, the letterhead's top and
/// bottom margins, the file's own side margins.
fn letterhead_page_element(
    event: &BytesStart<'_>,
    frame: PageFrame,
) -> Option<BytesStart<'static>> {
    match event.local_name().as_ref() {
        "pgSz" => Some(with_attributes(
            event,
            &[
                ("w", "w:w", Some(A4_WIDTH_TWIPS.to_string())),
                ("h", "w:h", Some(A4_HEIGHT_TWIPS.to_string())),
                ("orient", "w:orient", None),
            ],
        )),
        "pgMar" => {
            let side = |name: &str, least_mm: f32| {
                let least = mm_to_twips(least_mm);
                attribute_value(event, name)
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(least)
                    .clamp(least, (A4_WIDTH_TWIPS / 3).max(least))
                    .to_string()
            };
            Some(with_attributes(
                event,
                &[
                    ("top", "w:top", Some(mm_to_twips(frame.top_mm).to_string())),
                    (
                        "bottom",
                        "w:bottom",
                        Some(mm_to_twips(frame.bottom_mm).to_string()),
                    ),
                    ("left", "w:left", Some(side("left", frame.left_mm))),
                    ("right", "w:right", Some(side("right", frame.right_mm))),
                    ("header", "w:header", Some("0".to_string())),
                    ("footer", "w:footer", Some("0".to_string())),
                    ("gutter", "w:gutter", Some("0".to_string())),
                ],
            ))
        }
        _ => None,
    }
}

/// Fills the `{{variables}}` of one buffered paragraph. Word splits a text
/// into runs at will, so a variable may be spread over several `<w:t>`: such
/// a paragraph gets its whole filled text in the first run (keeping that
/// run's formatting); otherwise every run is filled in place.
fn fill_paragraph(
    events: Vec<Event<'static>>,
    fill: &dyn Fn(&str) -> String,
) -> Vec<Event<'static>> {
    // (index of the opening `t`, index of its closing tag, its text)
    let mut segments: Vec<(usize, usize, String)> = Vec::new();
    let mut open: Option<(usize, String)> = None;
    for (index, event) in events.iter().enumerate() {
        match event {
            Event::Start(element) if element.local_name().as_ref() == "t" => {
                open = Some((index, String::new()));
            }
            Event::End(element) if element.local_name().as_ref() == "t" => {
                if let Some((start, text)) = open.take() {
                    segments.push((start, index, text));
                }
            }
            Event::Text(text) => {
                if let Some((_, buffer)) = open.as_mut() {
                    buffer.push_str(&text.xml10_content());
                }
            }
            Event::CData(data) => {
                if let Some((_, buffer)) = open.as_mut() {
                    buffer.push_str(data);
                }
            }
            Event::GeneralRef(reference) => {
                if let Some((_, buffer)) = open.as_mut() {
                    if reference.is_char_ref() {
                        if let Ok(Some(character)) = reference.resolve_char_ref() {
                            buffer.push(character);
                        }
                    } else if let Some(resolved) = quick_xml::escape::resolve_xml_entity(reference)
                    {
                        buffer.push_str(resolved);
                    }
                }
            }
            _ => {}
        }
    }
    let full: String = segments.iter().map(|(_, _, text)| text.as_str()).collect();
    if !full.contains("{{") {
        return events;
    }
    let filled_full = fill(&full);
    let mut filled: Vec<String> = segments.iter().map(|(_, _, text)| fill(text)).collect();
    if filled.concat() != filled_full {
        // A variable is spread over runs.
        filled = vec![String::new(); segments.len()];
        filled[0] = filled_full;
    }

    let mut out = Vec::with_capacity(events.len());
    let mut segment = 0usize;
    for (index, event) in events.into_iter().enumerate() {
        let Some((start, end, _)) = segments.get(segment) else {
            out.push(event);
            continue;
        };
        if index == *start {
            if let Event::Start(element) = &event {
                // Leading and trailing blanks of a filled value must survive.
                out.push(Event::Start(with_attributes(
                    element,
                    &[("space", "xml:space", Some("preserve".to_string()))],
                )));
            }
            out.push(Event::Text(BytesText::new(&filled[segment]).into_owned()));
        } else if index == *end {
            out.push(event);
            segment += 1;
        } else if index < *start {
            out.push(event);
        }
        // Between the tags: the old text, replaced above.
    }
    out
}

fn rewrite_document_xml(
    xml: &str,
    frame: PageFrame,
    fill: Option<&dyn Fn(&str) -> String>,
) -> Result<Vec<u8>, &'static str> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::new());
    // The paragraph being buffered and how deep in nested paragraphs it is.
    let mut paragraph: Option<(usize, Vec<Event<'static>>)> = None;
    let mut events = 0usize;
    loop {
        events += 1;
        if events > MAX_XML_EVENTS {
            return Err("The Word file is too large");
        }
        let event = match reader.read_event().map_err(|_| INVALID_DOCX)? {
            Event::Eof => break,
            Event::DocType(_) => return Err(INVALID_DOCX),
            // The letterhead is the only header and footer.
            Event::Empty(element)
                if matches!(
                    element.local_name().as_ref(),
                    "headerReference" | "footerReference" | "titlePg"
                ) =>
            {
                continue;
            }
            Event::Empty(element) => match letterhead_page_element(&element, frame) {
                Some(replaced) => Event::Empty(replaced),
                None => Event::Empty(element),
            },
            Event::Start(element) => match letterhead_page_element(&element, frame) {
                Some(replaced) => Event::Start(replaced),
                None => Event::Start(element),
            },
            other => other,
        };

        let opens_paragraph =
            matches!(&event, Event::Start(element) if element.local_name().as_ref() == "p");
        let closes_paragraph =
            matches!(&event, Event::End(element) if element.local_name().as_ref() == "p");
        match (paragraph.as_mut(), fill) {
            (Some((depth, buffered)), Some(fill)) => {
                if opens_paragraph {
                    *depth += 1;
                } else if closes_paragraph {
                    *depth -= 1;
                }
                buffered.push(event.into_owned());
                if *depth == 0 {
                    let (_, buffered) = paragraph.take().unwrap_or_default();
                    for event in fill_paragraph(buffered, fill) {
                        writer.write_event(event).map_err(|_| INVALID_DOCX)?;
                    }
                }
            }
            (None, Some(_)) if opens_paragraph => {
                paragraph = Some((1, vec![event.into_owned()]));
            }
            _ => writer.write_event(event).map_err(|_| INVALID_DOCX)?,
        }
    }
    if paragraph.is_some() {
        return Err(INVALID_DOCX);
    }
    Ok(writer.into_inner())
}

/// A relationship part without the links that would make the converter
/// fetch something from outside (images, templates, embedded objects);
/// ordinary hyperlinks in the text stay.
fn strip_external_relationships(xml: &str) -> Result<Vec<u8>, &'static str> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::new());
    let mut events = 0usize;
    loop {
        events += 1;
        if events > MAX_XML_EVENTS {
            return Err("The Word file is too large");
        }
        match reader.read_event().map_err(|_| INVALID_DOCX)? {
            Event::Eof => break,
            Event::DocType(_) => return Err(INVALID_DOCX),
            Event::Empty(element)
                if element.local_name().as_ref() == "Relationship"
                    && attribute_value(&element, "TargetMode")
                        .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
                    && !attribute_value(&element, "Type")
                        .is_some_and(|kind| kind.ends_with("/hyperlink")) => {}
            event => writer.write_event(event).map_err(|_| INVALID_DOCX)?,
        }
    }
    Ok(writer.into_inner())
}

/// The Word file made to fit the letterhead (see the module comment). With
/// `fill` the `{{variables}}` of the text are replaced by what it returns
/// for a piece of text.
pub(crate) fn prepare_docx(
    docx: &[u8],
    frame: PageFrame,
    fill: Option<&dyn Fn(&str) -> String>,
) -> Result<Vec<u8>, &'static str> {
    let mut archive = zip::ZipArchive::new(Cursor::new(docx)).map_err(|_| INVALID_DOCX)?;
    if archive.len() > MAX_DOCX_ENTRIES {
        return Err("The Word file is too large");
    }
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut out = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let mut unpacked = 0u64;
    let mut has_document = false;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|_| INVALID_DOCX)?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().map_err(|_| INVALID_DOCX)?.to_string();
        if name.starts_with('/') || name.contains("..") || name.contains('\\') {
            return Err(INVALID_DOCX);
        }
        let mut data = Vec::new();
        (&mut file)
            .take(MAX_DOCX_UNPACKED_BYTES - unpacked + 1)
            .read_to_end(&mut data)
            .map_err(|_| INVALID_DOCX)?;
        unpacked += data.len() as u64;
        if unpacked > MAX_DOCX_UNPACKED_BYTES {
            return Err("The Word file is too large");
        }
        let lower = name.to_ascii_lowercase();
        // Macros are never carried along.
        if lower.ends_with("vbaproject.bin") || lower.ends_with("vbadata.xml") {
            continue;
        }
        let data = if name == "word/document.xml" {
            has_document = true;
            let xml = std::str::from_utf8(&data).map_err(|_| INVALID_DOCX)?;
            rewrite_document_xml(xml, frame, fill)?
        } else if lower.ends_with(".rels") {
            let xml = std::str::from_utf8(&data).map_err(|_| INVALID_DOCX)?;
            strip_external_relationships(xml)?
        } else {
            data
        };
        out.start_file(name, options).map_err(|_| INVALID_DOCX)?;
        out.write_all(&data).map_err(|_| INVALID_DOCX)?;
    }
    if !has_document {
        return Err("The file is not a Word document (.docx)");
    }
    Ok(out.finish().map_err(|_| INVALID_DOCX)?.into_inner())
}

// ---------------------------------------------------------------------------
// 2. LibreOffice
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) enum ConvertError {
    /// LibreOffice is not installed on this machine (a developer's stack).
    Unavailable,
    Failed(String),
}

fn soffice_binary() -> String {
    std::env::var("GMED_SOFFICE_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "soffice".to_string())
}

fn conversion_root() -> PathBuf {
    std::env::temp_dir().join("gmed-docx")
}

/// One conversion at a time: LibreOffice is heavy, and its profile directory
/// is shared between the runs.
static CONVERSION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Whether a LibreOffice binary answers on this machine.
pub(crate) async fn converter_available() -> bool {
    tokio::process::Command::new(soffice_binary())
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .status()
        .await
        .is_ok_and(|status| status.success())
}

/// The Word file as a PDF, laid out by LibreOffice.
pub(crate) async fn docx_to_pdf(docx: &[u8]) -> Result<Vec<u8>, ConvertError> {
    let _guard = CONVERSION.lock().await;
    let root = conversion_root();
    let work = root.join(Uuid::new_v4().to_string());
    let failed =
        |context: &str, error: std::io::Error| ConvertError::Failed(format!("{context}: {error}"));
    tokio::fs::create_dir_all(work.join("out"))
        .await
        .map_err(|error| failed("prepare conversion directory", error))?;
    let input = work.join("document.docx");
    let result = async {
        tokio::fs::write(&input, docx)
            .await
            .map_err(|error| failed("write conversion input", error))?;
        let mut command = tokio::process::Command::new(soffice_binary());
        command
            .args([
                "--headless",
                "--norestore",
                "--nolockcheck",
                "--nodefault",
                "--nofirststartwizard",
            ])
            .arg(format!(
                "-env:UserInstallation=file://{}",
                root.join("profile").display()
            ))
            .args(["--convert-to", "pdf", "--outdir"])
            .arg(work.join("out"))
            .arg(&input)
            .env("HOME", &root)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let output = match tokio::time::timeout(CONVERSION_TIMEOUT, command.output()).await {
            Err(_) => return Err(ConvertError::Failed("conversion timed out".to_string())),
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(ConvertError::Unavailable);
            }
            Ok(Err(error)) => return Err(failed("start LibreOffice", error)),
            Ok(Ok(output)) => output,
        };
        match tokio::fs::read(work.join("out").join("document.pdf")).await {
            Ok(pdf) if pdf.starts_with(b"%PDF-") => Ok(pdf),
            _ => Err(ConvertError::Failed(format!(
                "LibreOffice produced no PDF (exit {:?}): {}",
                output.status.code(),
                String::from_utf8_lossy(&output.stderr)
                    .chars()
                    .take(400)
                    .collect::<String>()
            ))),
        }
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&work).await;
    result
}

// ---------------------------------------------------------------------------
// 3. The letterhead
// ---------------------------------------------------------------------------

pub(crate) fn pdf_page_count(pdf: &[u8]) -> Result<usize, &'static str> {
    let document = Document::load_mem(pdf).map_err(|_| INVALID_PDF)?;
    match document.get_pages().len() {
        0 => Err(INVALID_PDF),
        pages => Ok(pages),
    }
}

/// A page attribute, its own or inherited from the page tree.
fn inherited_page_attribute(document: &Document, page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut node = document.get_dictionary(page_id).ok()?;
    for _ in 0..32 {
        if let Ok(value) = node.get(key) {
            return Some(value.clone());
        }
        let parent = node.get(b"Parent").and_then(Object::as_reference).ok()?;
        node = document.get_dictionary(parent).ok()?;
    }
    None
}

/// Draws page `n` of `letterhead` over page `n` of `content` (the last
/// letterhead page for any further one). Both are A4; the content keeps its
/// own drawing state, the letterhead is added as one self-contained form.
pub(crate) fn stamp_letterhead(content: &[u8], letterhead: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut document = Document::load_mem(content).map_err(|_| INVALID_PDF)?;
    let mut head = Document::load_mem(letterhead).map_err(|_| INVALID_PDF)?;
    if document.is_encrypted() || head.is_encrypted() {
        return Err(INVALID_PDF);
    }
    let first_free = document
        .objects
        .keys()
        .map(|id| id.0)
        .max()
        .unwrap_or(0)
        .max(document.max_id)
        + 1;
    head.renumber_objects_with(first_free);

    let mut forms = Vec::new();
    for page_id in head.get_pages().values() {
        let mut form = Dictionary::new();
        form.set("Type", Object::Name(b"XObject".to_vec()));
        form.set("Subtype", Object::Name(b"Form".to_vec()));
        form.set(
            "BBox",
            inherited_page_attribute(&head, *page_id, b"MediaBox").ok_or(INVALID_PDF)?,
        );
        form.set(
            "Resources",
            inherited_page_attribute(&head, *page_id, b"Resources")
                .unwrap_or_else(|| Object::Dictionary(Dictionary::new())),
        );
        forms.push(Stream::new(form, head.get_page_content(*page_id)));
    }
    if forms.is_empty() {
        return Err(INVALID_PDF);
    }

    // Everything the letterhead pages refer to (fonts, the logo) moves over;
    // its own page tree does not.
    let mut max_id = first_free;
    for (id, object) in std::mem::take(&mut head.objects) {
        let node_type = object
            .as_dict()
            .ok()
            .and_then(|dict| dict.get(b"Type").ok())
            .and_then(|value| value.as_name().ok());
        if matches!(
            node_type,
            Some(b"Catalog") | Some(b"Pages") | Some(b"Page") | Some(b"Outlines")
        ) {
            continue;
        }
        max_id = max_id.max(id.0);
        document.objects.insert(id, object);
    }
    document.max_id = document.max_id.max(max_id);
    let form_ids: Vec<ObjectId> = forms
        .into_iter()
        .map(|form| document.add_object(form))
        .collect();

    let pages: Vec<ObjectId> = document.get_pages().values().copied().collect();
    if pages.is_empty() {
        return Err(INVALID_PDF);
    }
    for (index, page_id) in pages.iter().enumerate() {
        let form_id = form_ids[index.min(form_ids.len() - 1)];
        // Resources inherited from the page tree would be hidden by a fresh
        // dictionary on the page: pin them on the page first.
        let own_resources = document
            .get_dictionary(*page_id)
            .map_err(|_| INVALID_PDF)?
            .has(b"Resources");
        if !own_resources
            && let Some(resources) = inherited_page_attribute(&document, *page_id, b"Resources")
        {
            let resources = match resources {
                Object::Reference(id) => document.get_object(id).map_err(|_| INVALID_PDF)?.clone(),
                other => other,
            };
            document
                .get_dictionary_mut(*page_id)
                .map_err(|_| INVALID_PDF)?
                .set("Resources", resources);
        }
        document
            .add_xobject(*page_id, LETTERHEAD_XOBJECT, form_id)
            .map_err(|_| INVALID_PDF)?;

        // `q … Q` around the page's own content, then the letterhead.
        let existing = match document
            .get_dictionary(*page_id)
            .map_err(|_| INVALID_PDF)?
            .get(b"Contents")
        {
            Ok(Object::Reference(id)) => match document.get_object(*id) {
                Ok(Object::Array(items)) => items.clone(),
                _ => vec![Object::Reference(*id)],
            },
            Ok(Object::Array(items)) => items.clone(),
            _ => Vec::new(),
        };
        let open = document.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
        let close = document.add_object(Stream::new(
            Dictionary::new(),
            format!("\nQ\nq /{LETTERHEAD_XOBJECT} Do Q\n").into_bytes(),
        ));
        let mut contents = Vec::with_capacity(existing.len() + 2);
        contents.push(Object::Reference(open));
        contents.extend(existing);
        contents.push(Object::Reference(close));
        document
            .get_dictionary_mut(*page_id)
            .map_err(|_| INVALID_PDF)?
            .set("Contents", contents);
    }

    let mut bytes = Vec::new();
    document.save_to(&mut bytes).map_err(|_| INVALID_PDF)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn docx_with(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in parts {
            archive.start_file(*name, options).unwrap();
            archive.write_all(content.as_bytes()).unwrap();
        }
        archive.finish().unwrap().into_inner()
    }

    fn part(docx: &[u8], name: &str) -> Option<String> {
        let mut archive = zip::ZipArchive::new(Cursor::new(docx)).unwrap();
        let mut file = archive.by_name(name).ok()?;
        let mut text = String::new();
        file.read_to_string(&mut text).unwrap();
        Some(text)
    }

    const DOCUMENT: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Sehr geehrte Frau {{patient_last_name}},</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">geboren am {{birth_</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>date}} &amp; mehr</w:t></w:r></w:p>
    <w:p><w:r><w:t>Ohne Variable</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId7"/>
      <w:footerReference w:type="default" r:id="rId8"/>
      <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
      <w:pgMar w:top="720" w:right="200" w:bottom="720" w:left="1700" w:header="708" w:footer="708" w:gutter="0"/>
      <w:titlePg/>
    </w:sectPr>
  </w:body>
</w:document>"#;

    const RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/track.png" TargetMode="External"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/" TargetMode="External"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:/x.dotm" TargetMode="External"/>
</Relationships>"#;

    const FRAME: PageFrame = PageFrame {
        top_mm: 36.5,
        bottom_mm: 34.0,
        left_mm: 25.0,
        right_mm: 20.0,
    };

    fn fill(text: &str) -> String {
        text.replace("{{patient_last_name}}", "Muster & Söhne <GmbH>")
            .replace("{{birth_date}}", "07.03.1990")
    }

    #[test]
    fn docx_gets_the_letterhead_page_and_loses_its_own_header_and_footer() {
        let docx = docx_with(&[
            ("[Content_Types].xml", "<Types/>"),
            ("word/document.xml", DOCUMENT),
            ("word/_rels/document.xml.rels", RELS),
            ("word/vbaProject.bin", "macro"),
            ("word/media/image1.png", "png"),
        ]);
        let prepared = prepare_docx(&docx, FRAME, None).unwrap();
        let document = part(&prepared, "word/document.xml").unwrap();
        assert!(!document.contains("headerReference"));
        assert!(!document.contains("footerReference"));
        assert!(!document.contains("titlePg"));
        assert!(
            document.contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#),
            "{document}"
        );
        // 36.5 mm and 34 mm; the narrow right margin is widened to the
        // letterhead's 20 mm, the wider left one stays.
        assert!(
            document.contains(
                r#"<w:pgMar w:top="2069" w:right="1134" w:bottom="1928" w:left="1700" w:header="0" w:footer="0" w:gutter="0"/>"#
            ),
            "{document}"
        );
        // Without values the text is untouched.
        assert!(document.contains("{{patient_last_name}}"));

        let rels = part(&prepared, "word/_rels/document.xml.rels").unwrap();
        assert!(rels.contains("rId1") && rels.contains("rId3"));
        assert!(!rels.contains("rId2") && !rels.contains("rId4"), "{rels}");
        assert!(part(&prepared, "word/vbaProject.bin").is_none());
        assert_eq!(
            part(&prepared, "word/media/image1.png").as_deref(),
            Some("png")
        );
    }

    #[test]
    fn variables_are_filled_even_when_word_split_them_over_runs() {
        let docx = docx_with(&[("word/document.xml", DOCUMENT)]);
        let prepared = prepare_docx(&docx, FRAME, Some(&fill)).unwrap();
        let document = part(&prepared, "word/document.xml").unwrap();
        // In place, with the run's formatting, escaped.
        assert!(
            document.contains(
                r#"<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Sehr geehrte Frau Muster &amp; Söhne &lt;GmbH&gt;,</w:t>"#
            ),
            "{document}"
        );
        // Spread over two runs: the whole text moves to the first one.
        assert!(
            document.contains(
                r#"<w:t xml:space="preserve">geboren am 07.03.1990 &amp; mehr</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"></w:t>"#
            ),
            "{document}"
        );
        assert!(document.contains("<w:t>Ohne Variable</w:t>"));
        assert!(!document.contains("{{"));
    }

    #[test]
    fn broken_or_foreign_archives_are_refused() {
        assert!(prepare_docx(b"not a zip", FRAME, None).is_err());
        let other = docx_with(&[("other.txt", "x")]);
        assert_eq!(
            prepare_docx(&other, FRAME, None).unwrap_err(),
            "The file is not a Word document (.docx)"
        );
        let unsafe_name = docx_with(&[("../word/document.xml", DOCUMENT)]);
        assert!(prepare_docx(&unsafe_name, FRAME, None).is_err());
    }

    #[test]
    fn twips_follow_millimetres() {
        assert_eq!(mm_to_twips(25.4), 1440);
        assert_eq!(mm_to_twips(36.5), 2069);
    }
}
