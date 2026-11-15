//! Patient labels («Печать наклейки» on the staff patient card, owner request
//! 2026-11-14), printed from a server PDF.
//!
//! The sheet is the HERMA 4360 stock the agency prints on (owner 2026-11-14):
//! A4, 3 × 8 labels of 70 × 36 mm, edge to edge horizontally, 4.5 mm from the
//! top. The label kinds and type sizes follow the agency's own Word sheet
//! (ADMIN-Etiketten), Arial. The sheet holds
//! five kinds of labels, row by row:
//!
//! 1. rows 1–2: the full patient label (ID, salutation, «Nachname, Vorname»,
//!    «geb. am», KT1, KT2, passport nationality), 9.5 pt;
//! 2. rows 3–4: the patient number alone, 12.5 pt, centred;
//! 3. row 5: salutation, name and date of birth, 12.5 pt;
//! 4. row 6: name and date of birth with the GMED postal address
//!    («c/o <contact person>», street, ZIP city), 8.5 pt;
//! 5. rows 7–8: the same plus the GMED phone and e-mail, 8 pt.
//!
//! The text sits 1.5 mm below the label grid: the agency's printer prints
//! the sheet a little high.
//!
//! The compact (90 × 48 mm) and standard (105 × 74 mm) formats print one full
//! patient label per page in the largest type that fits. Text never leaves
//! its label: the type shrinks first, then long words wrap.
//!
//! The texts are German on purpose (the labels go on German forms and
//! samples); dates are DD.MM.YYYY. Everything about the agency comes from the
//! agency settings, nothing is built in.

use printpdf::{Mm, Op, PdfDocument, PdfFontHandle, PdfPage, Point, Pt};

use crate::pdf_text::{
    add_unicode_pdf_fonts, pdf_text_save_options, unicode_pdf_font_face, unicode_show_text_op,
};

/// What a label says about the patient. Empty strings are left out, except
/// KT1 and KT2, whose captions are always printed (staff write on them).
#[derive(Debug, Clone, Default)]
pub struct PatientLabelData {
    pub patient_number: String,
    /// «Herr» / «Frau» / «Div» or empty.
    pub salutation: String,
    pub last_name: String,
    pub first_name: String,
    /// DD.MM.YYYY.
    pub birth_date: Option<String>,
    pub kt1: String,
    pub kt2: String,
    /// Passport nationality, ISO 3166-1 alpha-3 (FRA, UKR, DEU …).
    pub nationality_code: Option<String>,
}

/// The GMED postal block of the address and contact labels.
#[derive(Debug, Clone, Default)]
pub struct PatientLabelAgency {
    /// The contact person printed after «c/o».
    pub care_of: String,
    /// Street and «ZIP city», one entry per printed line.
    pub address_lines: Vec<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
}

const A4_WIDTH_MM: f32 = 210.0;
const A4_HEIGHT_MM: f32 = 297.0;
const SHEET_TOP_MM: f32 = 4.5;
const SHEET_LEFT_MM: f32 = 0.0;
const SHEET_COLUMNS_MM: [f32; 3] = [70.0, 70.0, 70.0];
const SHEET_ROW_HEIGHT_MM: f32 = 36.0;
const SHEET_ROWS: usize = 8;
/// Text inset inside a label: the Word sheet put its first column's text 3 mm
/// from the paper edge, which also keeps it clear of the printer's margin.
const SHEET_CELL_PADDING_MM: f32 = 3.0;
/// The agency's printer puts the sheet a little high (owner photo
/// 2026-11-15): every label's text moves this much down.
const SHEET_PRINT_SHIFT_MM: f32 = 1.5;
/// Word's single line spacing for Arial.
const LINE_SPACING: f32 = 1.15;
/// Arial's ascender, as a share of the font size.
const ASCENT: f32 = 0.905;
const MIN_FONT_PT: f32 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LabelKind {
    Full,
    NumberOnly,
    NameAndBirthDate,
    Address,
    AddressAndContact,
}

/// The kinds of the eight sheet rows, top to bottom (the Word sheet).
const SHEET_ROW_KINDS: [LabelKind; SHEET_ROWS] = [
    LabelKind::Full,
    LabelKind::Full,
    LabelKind::NumberOnly,
    LabelKind::NumberOnly,
    LabelKind::NameAndBirthDate,
    LabelKind::Address,
    LabelKind::AddressAndContact,
    LabelKind::AddressAndContact,
];

impl LabelKind {
    fn font_pt(self) -> f32 {
        match self {
            LabelKind::Full => 9.5,
            LabelKind::NumberOnly | LabelKind::NameAndBirthDate => 12.5,
            LabelKind::Address => 8.5,
            // Nine lines: 8 pt keeps them clear of the label edges.
            LabelKind::AddressAndContact => 8.0,
        }
    }

    fn centred(self) -> bool {
        self == LabelKind::NumberOnly
    }
}

#[derive(Debug, Clone, PartialEq)]
struct Line {
    text: String,
    bold: bool,
}

fn line(text: impl Into<String>, bold: bool) -> Line {
    Line {
        text: text.into(),
        bold,
    }
}

fn name_line(data: &PatientLabelData) -> String {
    let last = data.last_name.trim();
    let first = data.first_name.trim();
    match (last.is_empty(), first.is_empty()) {
        (false, false) => format!("{last}, {first}"),
        (false, true) => last.to_string(),
        (true, false) => first.to_string(),
        (true, true) => String::new(),
    }
}

fn person_lines(data: &PatientLabelData) -> Vec<Line> {
    let mut lines = Vec::new();
    if !data.salutation.trim().is_empty() {
        lines.push(line(data.salutation.trim(), false));
    }
    let name = name_line(data);
    if !name.is_empty() {
        lines.push(line(name, true));
    }
    if let Some(date) = data.birth_date.as_deref().map(str::trim)
        && !date.is_empty()
    {
        lines.push(line(format!("geb. am {date}"), true));
    }
    lines
}

fn number_line(data: &PatientLabelData) -> Line {
    line(format!("ID: {}", data.patient_number.trim()), true)
}

fn label_lines(kind: LabelKind, data: &PatientLabelData, agency: &PatientLabelAgency) -> Vec<Line> {
    match kind {
        LabelKind::Full => {
            let mut lines = vec![number_line(data)];
            lines.extend(person_lines(data));
            lines.push(line(format!("KT1: {}", data.kt1.trim()).trim_end(), true));
            lines.push(line(format!("KT2: {}", data.kt2.trim()).trim_end(), true));
            if let Some(code) = data.nationality_code.as_deref().map(str::trim)
                && !code.is_empty()
            {
                lines.push(line(code, true));
            }
            lines
        }
        LabelKind::NumberOnly => vec![number_line(data)],
        LabelKind::NameAndBirthDate => person_lines(data),
        LabelKind::Address | LabelKind::AddressAndContact => {
            let mut lines = person_lines(data);
            let mut postal = Vec::new();
            let care_of = care_of_person(&agency.care_of);
            if !care_of.is_empty() {
                postal.push(line(format!("c/o {care_of}"), false));
            }
            postal.extend(
                agency
                    .address_lines
                    .iter()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .map(|value| line(value, false)),
            );
            if !postal.is_empty() {
                lines.push(line("", false));
                lines.extend(postal);
            }
            if kind == LabelKind::AddressAndContact {
                let mut contact = Vec::new();
                if let Some(phone) = agency.phone.as_deref().map(str::trim)
                    && !phone.is_empty()
                {
                    contact.push(line(format!("Tel.: {phone}"), false));
                }
                if let Some(email) = agency.email.as_deref().map(str::trim)
                    && !email.is_empty()
                {
                    contact.push(line(format!("E-Mail: {email}"), false));
                }
                if !contact.is_empty() {
                    lines.push(line("", false));
                    lines.extend(contact);
                }
            }
            lines
        }
    }
}

/// The contact person without a «c/o» the setting may already carry.
fn care_of_person(value: &str) -> &str {
    let value = value.trim();
    match value.get(..3) {
        Some(prefix) if prefix.eq_ignore_ascii_case("c/o") => {
            value[3..].trim_start_matches(|c: char| c.is_whitespace() || matches!(c, '-' | ':'))
        }
        _ => value,
    }
}

/// Splits the agency address setting into printed lines: stored line breaks
/// first, else the « · » or «, » separators; a trailing «Deutschland» /
/// «Germany» is dropped (a German address label does not name the country).
pub fn agency_address_lines(address: Option<&str>) -> Vec<String> {
    let Some(address) = address.map(str::trim).filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    let mut parts: Vec<String> = if address.contains('\n') {
        address.lines().map(str::to_string).collect()
    } else if address.contains(" · ") {
        address.split(" · ").map(str::to_string).collect()
    } else {
        address.split(", ").map(str::to_string).collect()
    };
    parts.retain(|part| !part.trim().is_empty());
    if parts.len() > 1
        && parts.last().is_some_and(|last| {
            matches!(
                last.trim().to_lowercase().as_str(),
                "deutschland" | "germany" | "de"
            )
        })
    {
        parts.pop();
    }
    parts
        .into_iter()
        .map(|part| part.trim().to_string())
        .collect()
}

/// KT1 / KT2 (Kostenträger) from the patient's insurance answer: a self-payer
/// is «SZ»; an insured patient's KT1 is the insurer as stored, or GKV / PKV /
/// «Ausland» when no insurer is named. KT2 stays empty — the record has no
/// second cost bearer yet.
pub fn cost_bearer_codes(
    insurance_type: Option<&str>,
    insurance_provider: Option<&str>,
) -> (String, String) {
    let provider = insurance_provider
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let kt1 = match insurance_type.map(str::trim) {
        Some("self_pay") => "SZ".to_string(),
        Some("public") => provider.unwrap_or("GKV").to_string(),
        Some("private") => provider.unwrap_or("PKV").to_string(),
        Some("foreign") => provider.unwrap_or("Ausland").to_string(),
        _ => provider.unwrap_or_default().to_string(),
    };
    (kt1, String::new())
}

/// The nationality on the label, as the passport prints it (owner
/// 2026-11-14: «це національність по паспорту»): the patient's first
/// citizenship (ISO alpha-2, `patients.citizenships`) as ISO 3166-1 alpha-3
/// (FRA, UKR, DEU …); for an old record without citizenships, the free-text
/// nationality when it is already a two or three letter code.
pub fn label_nationality_code(
    citizenships: &[String],
    nationality: Option<&str>,
) -> Option<String> {
    let alpha3 = |value: &str| crate::services::mrz::country_alpha3(value).map(str::to_string);
    if let Some(code) = citizenships.iter().find_map(|value| alpha3(value)) {
        return Some(code);
    }
    let text = nationality
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    match text.len() {
        2 if text.chars().all(|c| c.is_ascii_alphabetic()) => alpha3(text),
        3 if text.chars().all(|c| c.is_ascii_alphabetic()) => Some(text.to_ascii_uppercase()),
        _ => None,
    }
}

struct Fonts {
    regular: PdfFontHandle,
    bold: PdfFontHandle,
    regular_metrics: ttf_parser::Face<'static>,
    bold_metrics: ttf_parser::Face<'static>,
}

impl Fonts {
    fn width_mm(&self, text: &str, size_pt: f32, bold: bool) -> f32 {
        let face = if bold {
            &self.bold_metrics
        } else {
            &self.regular_metrics
        };
        let units: u32 = text
            .chars()
            .map(|c| {
                face.glyph_index(c)
                    .and_then(|g| face.glyph_hor_advance(g))
                    .unwrap_or(face.units_per_em()) as u32
            })
            .sum();
        units as f32 / face.units_per_em() as f32 * size_pt * 25.4 / 72.0
    }

    /// Word-wraps, splitting a word that is longer than the line itself.
    fn wrap(&self, text: &str, size_pt: f32, width_mm: f32, bold: bool) -> Vec<String> {
        if text.trim().is_empty() {
            return vec![String::new()];
        }
        let mut lines = Vec::new();
        let mut current = String::new();
        for word in text.split_whitespace() {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };
            if self.width_mm(&candidate, size_pt, bold) <= width_mm {
                current = candidate;
                continue;
            }
            if !current.is_empty() {
                lines.push(std::mem::take(&mut current));
            }
            for character in word.chars() {
                let mut next = current.clone();
                next.push(character);
                if !current.is_empty() && self.width_mm(&next, size_pt, bold) > width_mm {
                    lines.push(std::mem::take(&mut current));
                }
                current.push(character);
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
        lines
    }
}

fn pt_to_mm(value: f32) -> f32 {
    value * 25.4 / 72.0
}

/// One label laid out in its box: the font size and the wrapped lines.
#[derive(Debug)]
struct FittedLabel {
    size_pt: f32,
    lines: Vec<Line>,
}

impl FittedLabel {
    fn height_mm(&self) -> f32 {
        self.lines.len() as f32 * pt_to_mm(self.size_pt) * LINE_SPACING
    }
}

/// The largest size up to `max_pt` at which every line fits the width
/// unwrapped and the block fits the height; below that, the smallest size
/// with wrapped lines. `None` when even that does not fit.
fn fit_label(
    fonts: &Fonts,
    lines: &[Line],
    width_mm: f32,
    height_mm: f32,
    max_pt: f32,
) -> Option<FittedLabel> {
    let block_height = |count: usize, size_pt: f32| count as f32 * pt_to_mm(size_pt) * LINE_SPACING;
    let mut size = max_pt;
    while size >= MIN_FONT_PT {
        let fits_width = lines
            .iter()
            .all(|line| fonts.width_mm(&line.text, size, line.bold) <= width_mm);
        if fits_width && block_height(lines.len(), size) <= height_mm {
            return Some(FittedLabel {
                size_pt: size,
                lines: lines.to_vec(),
            });
        }
        size -= 0.25;
    }
    let mut size = max_pt;
    while size >= MIN_FONT_PT {
        let wrapped: Vec<Line> = lines
            .iter()
            .flat_map(|source| {
                fonts
                    .wrap(&source.text, size, width_mm, source.bold)
                    .into_iter()
                    .map(|text| line(text, source.bold))
            })
            .collect();
        if block_height(wrapped.len(), size) <= height_mm {
            return Some(FittedLabel {
                size_pt: size,
                lines: wrapped,
            });
        }
        size -= 0.25;
    }
    None
}

/// Draws a fitted label vertically centred in the box whose top-left corner
/// is (`x_mm`, `top_mm`) in PDF coordinates (origin bottom-left).
#[allow(clippy::too_many_arguments)]
fn draw_label(
    ops: &mut Vec<Op>,
    fonts: &Fonts,
    label: &FittedLabel,
    x_mm: f32,
    top_mm: f32,
    width_mm: f32,
    height_mm: f32,
    centred: bool,
) {
    let line_height = pt_to_mm(label.size_pt) * LINE_SPACING;
    let block_top = top_mm - (height_mm - label.height_mm()).max(0.0) / 2.0;
    for (index, line) in label.lines.iter().enumerate() {
        if line.text.is_empty() {
            continue;
        }
        let baseline = block_top
            - index as f32 * line_height
            - (line_height - pt_to_mm(label.size_pt)) / 2.0
            - pt_to_mm(label.size_pt) * ASCENT;
        let x = if centred {
            x_mm + (width_mm - fonts.width_mm(&line.text, label.size_pt, line.bold)).max(0.0) / 2.0
        } else {
            x_mm
        };
        ops.extend([
            Op::StartTextSection,
            Op::SetFont {
                font: if line.bold {
                    fonts.bold.clone()
                } else {
                    fonts.regular.clone()
                },
                size: Pt(label.size_pt),
            },
            Op::SetTextCursor {
                pos: Point::new(Mm(x), Mm(baseline)),
            },
            unicode_show_text_op(&line.text),
            Op::EndTextSection,
        ]);
    }
}

fn new_document(data: &PatientLabelData) -> Result<(PdfDocument, Fonts), &'static str> {
    let mut document =
        PdfDocument::new(&format!("Patientenetikett {}", data.patient_number.trim()));
    let (regular, bold) = add_unicode_pdf_fonts(&mut document)?;
    let fonts = Fonts {
        regular,
        bold,
        regular_metrics: unicode_pdf_font_face(false)?,
        bold_metrics: unicode_pdf_font_face(true)?,
    };
    Ok((document, fonts))
}

pub const LABEL_DOES_NOT_FIT: &str = "Patient label content does not fit the label";

/// One full patient label on a page of the label's own size (the compact
/// 90 × 48 and standard 105 × 74 mm rolls).
pub fn build_single_label_pdf(
    data: &PatientLabelData,
    width_mm: f32,
    height_mm: f32,
) -> Result<Vec<u8>, &'static str> {
    let (mut document, fonts) = new_document(data)?;
    let margin = if height_mm <= 50.0 { 3.0 } else { 5.0 };
    let max_pt = if height_mm <= 50.0 { 14.0 } else { 18.0 };
    let lines = label_lines(LabelKind::Full, data, &PatientLabelAgency::default());
    let box_width = width_mm - 2.0 * margin;
    let box_height = height_mm - 2.0 * margin;
    let label =
        fit_label(&fonts, &lines, box_width, box_height, max_pt).ok_or(LABEL_DOES_NOT_FIT)?;
    let mut ops = Vec::new();
    draw_label(
        &mut ops,
        &fonts,
        &label,
        margin,
        height_mm - margin,
        box_width,
        box_height,
        false,
    );
    Ok(document
        .with_pages(vec![PdfPage::new(Mm(width_mm), Mm(height_mm), ops)])
        .save(&pdf_text_save_options(), &mut Vec::new()))
}

/// The A4 sheet of 24 labels in the layout of the agency's Word sheet.
pub fn build_label_sheet_pdf(
    data: &PatientLabelData,
    agency: &PatientLabelAgency,
) -> Result<Vec<u8>, &'static str> {
    let (mut document, fonts) = new_document(data)?;
    let mut ops = Vec::new();
    for (row, kind) in SHEET_ROW_KINDS.iter().copied().enumerate() {
        let lines = label_lines(kind, data, agency);
        let row_top = A4_HEIGHT_MM - SHEET_TOP_MM - row as f32 * SHEET_ROW_HEIGHT_MM;
        let mut column_left = SHEET_LEFT_MM;
        for column_width in SHEET_COLUMNS_MM {
            let box_width = column_width - 2.0 * SHEET_CELL_PADDING_MM;
            let box_height = SHEET_ROW_HEIGHT_MM - 1.0;
            let label = fit_label(&fonts, &lines, box_width, box_height, kind.font_pt())
                .ok_or(LABEL_DOES_NOT_FIT)?;
            draw_label(
                &mut ops,
                &fonts,
                &label,
                column_left + SHEET_CELL_PADDING_MM,
                row_top - 0.5 - SHEET_PRINT_SHIFT_MM,
                box_width,
                box_height,
                kind.centred(),
            );
            column_left += column_width;
        }
    }
    Ok(document
        .with_pages(vec![PdfPage::new(Mm(A4_WIDTH_MM), Mm(A4_HEIGHT_MM), ops)])
        .save(&pdf_text_save_options(), &mut Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> PatientLabelData {
        PatientLabelData {
            patient_number: "P-20261114-0001".into(),
            salutation: "Frau".into(),
            last_name: "Beispiel".into(),
            first_name: "Erika".into(),
            birth_date: Some("02.03.1951".into()),
            kt1: "SZ".into(),
            kt2: String::new(),
            nationality_code: Some("UKR".into()),
        }
    }

    fn agency() -> PatientLabelAgency {
        PatientLabelAgency {
            care_of: "c/o Kontakt Person".into(),
            address_lines: vec!["Teststraße 1".into(), "12345 Musterstadt".into()],
            phone: Some("+49 30 1234567".into()),
            email: Some("office@example.test".into()),
        }
    }

    fn text_of(bytes: &[u8]) -> String {
        pdf_extract::extract_text_from_mem(bytes).unwrap()
    }

    fn page_size_mm(bytes: &[u8]) -> (f32, f32) {
        let document = lopdf::Document::load_mem(bytes).unwrap();
        let page = document.get_pages().values().next().copied().unwrap();
        let dictionary = document.get_dictionary(page).unwrap();
        let media = dictionary.get(b"MediaBox").unwrap().as_array().unwrap();
        let number = |value: &lopdf::Object| match value {
            lopdf::Object::Integer(v) => *v as f32,
            lopdf::Object::Real(v) => *v,
            _ => panic!("MediaBox entry"),
        };
        (
            number(&media[2]) * 25.4 / 72.0,
            number(&media[3]) * 25.4 / 72.0,
        )
    }

    #[test]
    fn sheet_prints_every_label_kind_of_the_word_sheet() {
        let bytes = build_label_sheet_pdf(&data(), &agency()).unwrap();
        let (width, height) = page_size_mm(&bytes);
        assert!((width - 210.0).abs() < 0.5 && (height - 297.0).abs() < 0.5);
        let text = text_of(&bytes);
        // 6 full + 6 number-only labels carry the ID.
        assert_eq!(text.matches("ID: P-20261114-0001").count(), 12, "{text}");
        // 6 full + 3 + 3 + 6 labels carry the name and the date of birth.
        assert_eq!(text.matches("Beispiel, Erika").count(), 18, "{text}");
        assert_eq!(text.matches("geb. am 02.03.1951").count(), 18, "{text}");
        assert_eq!(text.matches("KT1: SZ").count(), 6, "{text}");
        assert_eq!(text.matches("KT2:").count(), 6, "{text}");
        assert_eq!(text.matches("UKR").count(), 6, "{text}");
        assert_eq!(text.matches("c/o Kontakt Person").count(), 9, "{text}");
        assert_eq!(text.matches("12345 Musterstadt").count(), 9, "{text}");
        assert_eq!(text.matches("Tel.: +49 30 1234567").count(), 6, "{text}");
        assert_eq!(
            text.matches("E-Mail: office@example.test").count(),
            6,
            "{text}"
        );
    }

    #[test]
    fn single_labels_have_the_label_size_and_the_full_label() {
        for (width, height) in [(90.0, 48.0), (105.0, 74.0)] {
            let bytes = build_single_label_pdf(&data(), width, height).unwrap();
            let (w, h) = page_size_mm(&bytes);
            assert!(
                (w - width).abs() < 0.5 && (h - height).abs() < 0.5,
                "{w}x{h}"
            );
            let text = text_of(&bytes);
            for expected in [
                "ID: P-20261114-0001",
                "Frau",
                "Beispiel, Erika",
                "geb. am 02.03.1951",
                "KT1: SZ",
                "KT2:",
                "UKR",
            ] {
                assert!(text.contains(expected), "{expected} missing in {text}");
            }
            assert!(!text.contains("c/o"), "{text}");
        }
    }

    #[test]
    fn single_labels_use_larger_type_than_the_sheet() {
        let (_, fonts) = new_document(&data()).unwrap();
        let lines = label_lines(LabelKind::Full, &data(), &PatientLabelAgency::default());
        let compact = fit_label(&fonts, &lines, 84.0, 42.0, 14.0).unwrap();
        let standard = fit_label(&fonts, &lines, 95.0, 64.0, 18.0).unwrap();
        assert!(
            compact.size_pt > LabelKind::Full.font_pt(),
            "{}",
            compact.size_pt
        );
        assert!(standard.size_pt > compact.size_pt, "{}", standard.size_pt);
    }

    #[test]
    fn long_names_shrink_or_wrap_but_stay_on_the_label() {
        let mut long = data();
        long.last_name = "Oberstaatsanwaltschaftsassistentinnenvertreterin-Wolkenkratzer".into();
        long.first_name = "Maximiliane Anna-Katharina Josefine".into();
        let bytes = build_label_sheet_pdf(&long, &agency()).unwrap();
        let text = text_of(&bytes);
        assert!(text.contains("Maximiliane"), "{text}");
        for (width, height) in [(90.0, 48.0), (105.0, 74.0)] {
            build_single_label_pdf(&long, width, height).unwrap();
        }
    }

    #[test]
    fn missing_values_leave_their_lines_out() {
        let mut sparse = data();
        sparse.salutation.clear();
        sparse.birth_date = None;
        sparse.nationality_code = None;
        sparse.kt1.clear();
        let lines = label_lines(LabelKind::Full, &sparse, &PatientLabelAgency::default());
        let texts: Vec<_> = lines.iter().map(|line| line.text.as_str()).collect();
        assert_eq!(
            texts,
            vec!["ID: P-20261114-0001", "Beispiel, Erika", "KT1:", "KT2:"]
        );
        let contact = label_lines(
            LabelKind::AddressAndContact,
            &sparse,
            &PatientLabelAgency::default(),
        );
        assert_eq!(contact.len(), 1, "{contact:?}");
    }

    #[test]
    fn cost_bearers_follow_the_insurance_answer() {
        assert_eq!(cost_bearer_codes(Some("self_pay"), Some("AOK")).0, "SZ");
        assert_eq!(
            cost_bearer_codes(Some("public"), Some(" AOK Bayern ")).0,
            "AOK Bayern"
        );
        assert_eq!(cost_bearer_codes(Some("public"), None).0, "GKV");
        assert_eq!(cost_bearer_codes(Some("private"), Some("")).0, "PKV");
        assert_eq!(cost_bearer_codes(Some("foreign"), None).0, "Ausland");
        assert_eq!(cost_bearer_codes(None, Some("AXA")).0, "AXA");
        assert_eq!(
            cost_bearer_codes(None, None),
            (String::new(), String::new())
        );
    }

    #[test]
    fn nationality_code_is_the_passport_country() {
        let codes = |values: &[&str]| values.iter().map(|v| v.to_string()).collect::<Vec<_>>();
        assert_eq!(
            label_nationality_code(&codes(&["FR"]), None).as_deref(),
            Some("FRA")
        );
        assert_eq!(
            label_nationality_code(&codes(&["UA", "DE"]), Some("Deutschland")).as_deref(),
            Some("UKR")
        );
        assert_eq!(
            label_nationality_code(&[], Some("de")).as_deref(),
            Some("DEU")
        );
        assert_eq!(
            label_nationality_code(&[], Some("rus")).as_deref(),
            Some("RUS")
        );
        assert_eq!(label_nationality_code(&[], Some("Ukraine")), None);
        assert_eq!(label_nationality_code(&[], None), None);
    }

    #[test]
    fn agency_address_is_split_into_label_lines() {
        assert_eq!(
            agency_address_lines(Some("Teststraße 1 · 12345 Musterstadt · Deutschland")),
            vec!["Teststraße 1", "12345 Musterstadt"]
        );
        assert_eq!(
            agency_address_lines(Some("Main Street 1\n10115 Berlin")),
            vec!["Main Street 1", "10115 Berlin"]
        );
        assert_eq!(
            agency_address_lines(Some("Teststraße 1, 12345 Musterstadt")),
            vec!["Teststraße 1", "12345 Musterstadt"]
        );
        assert!(agency_address_lines(None).is_empty());
    }
}
