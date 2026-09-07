//! Branded, printable table of laboratory results saved in the patient record.

use std::collections::{BTreeMap, BTreeSet};

use chrono::NaiveDate;
use printpdf::{
    Color, Mm, Op, PaintMode, PdfDocument, PdfFontHandle, PdfPage, Point, Pt, Rect, Rgb,
    WindingOrder,
};

use crate::pdf_text::{
    add_unicode_pdf_fonts, pdf_text_save_options, unicode_pdf_font_face, unicode_show_text_op,
};
use crate::services::patient_pdf_brand::{
    PatientPdfBrand, append_company_chrome, append_company_footer,
};

const LEFT: f32 = 14.0;
const RIGHT: f32 = 283.0;
const TOP: f32 = 195.0;
const BOTTOM: f32 = 29.0;
const WIDTH: f32 = RIGHT - LEFT;
const FIXED_COLS: [f32; 3] = [66.0, 35.0, 18.0];
const MAX_DATES: usize = 6;
const FONT_SIZE: f32 = 8.3;
const LINE_HEIGHT: f32 = 3.7;
const PAD: f32 = 1.3;

#[derive(Clone, Default)]
pub struct LabResultEntry {
    /// Calendar day in the same timezone as the displayed measurement timestamp.
    pub measured_date: NaiveDate,
    pub source_document_id: Option<uuid::Uuid>,
    pub source_document_name: String,
    /// Date/time, panel, laboratory (not printed), analyte, result, unit, reference,
    /// flag, original comment. Source documents are kept separate from comments.
    pub cells: [String; 9],
    pub flag: LabResultFlag,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum LabResultFlag {
    Normal,
    Abnormal,
    #[default]
    Unknown,
}

#[derive(Default)]
pub struct LabResultsContext {
    pub russian: bool,
    pub patient_name: String,
    pub patient_identifier: String,
    pub birth_date: String,
    pub printed_by: String,
    pub printed_on: String,
    pub entries: Vec<LabResultEntry>,
    pub brand: PatientPdfBrand,
}

impl LabResultsContext {
    fn tx<'a>(&self, ru: &'a str, de: &'a str) -> &'a str {
        if self.russian { ru } else { de }
    }
}

fn rgb(r: f32, g: f32, b: f32) -> Color {
    Color::Rgb(Rgb::new(r, g, b, None))
}

fn ink() -> Color {
    rgb(0.08, 0.09, 0.11)
}

fn muted() -> Color {
    rgb(0.36, 0.38, 0.41)
}

fn orange() -> Color {
    rgb(1.0, 0.43, 0.06)
}

#[derive(Default)]
struct MatrixRow {
    panel: String,
    analyte: String,
    reference: String,
    unit: String,
    /// Keep every measurement, including repeated tests on the same day.
    values: BTreeMap<NaiveDate, Vec<usize>>,
}

fn matrix_rows(entries: &[LabResultEntry]) -> Vec<MatrixRow> {
    let mut rows = BTreeMap::new();
    for (index, entry) in entries.iter().enumerate() {
        // Do not equate different units, ranges or analyte names by inference.
        let key = [1, 3, 6, 5].map(|column| entry.cells[column].trim().to_owned());
        let row = rows.entry(key.clone()).or_insert_with(|| MatrixRow {
            panel: key[0].clone(),
            analyte: key[1].clone(),
            reference: key[2].clone(),
            unit: key[3].clone(),
            ..Default::default()
        });
        row.values
            .entry(entry.measured_date)
            .or_insert_with(Vec::new)
            .push(index);
    }
    for row in rows.values_mut() {
        for indices in row.values.values_mut() {
            indices.sort_by(|a, b| {
                entries[*a].cells[0]
                    .cmp(&entries[*b].cells[0])
                    .then(a.cmp(b))
            });
        }
    }
    rows.into_values().collect()
}

fn column_widths(date_count: usize) -> Vec<f32> {
    let mut widths = FIXED_COLS.to_vec();
    widths.extend(std::iter::repeat_n(
        (WIDTH - FIXED_COLS.iter().sum::<f32>()) / date_count as f32,
        date_count,
    ));
    widths
}

pub fn format_reference_bounds(low: &str, high: &str) -> String {
    match (low.is_empty(), high.is_empty()) {
        (false, false) => format!("{low} - {high}"),
        (false, true) => format!(">= {low}"),
        (true, false) => format!("<= {high}"),
        (true, true) => String::new(),
    }
}

fn flag_marker(entry: &LabResultEntry) -> &'static str {
    match entry.flag {
        LabResultFlag::Normal => "",
        LabResultFlag::Unknown => " ?",
        LabResultFlag::Abnormal => match entry.cells[7].as_str() {
            "Выше нормы" | "Erhöht" => " ↑",
            "Ниже нормы" | "Erniedrigt" => " ↓",
            _ => " !",
        },
    }
}

/// One legend entry per original document, not per laboratory, flag or page.
fn source_references(entries: &[LabResultEntry]) -> (Vec<usize>, Vec<Option<usize>>) {
    let mut keys = BTreeMap::new();
    let mut sources = Vec::new();
    let mut numbers = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let key = if let Some(id) = entry.source_document_id {
            ("id", id.to_string())
        } else if !entry.source_document_name.trim().is_empty() {
            ("name", entry.source_document_name.trim().to_owned())
        } else {
            numbers.push(None);
            continue;
        };
        let number = *keys.entry(key).or_insert_with(|| {
            sources.push(index);
            sources.len()
        });
        numbers.push(Some(number));
    }
    (sources, numbers)
}

struct CellLine {
    text: String,
    bold: bool,
    color: Color,
}

struct Layout<'a> {
    context: &'a LabResultsContext,
    regular: PdfFontHandle,
    bold: PdfFontHandle,
    regular_metrics: ttf_parser::Face<'static>,
    bold_metrics: ttf_parser::Face<'static>,
    ops: Vec<Op>,
    pages: Vec<PdfPage>,
    y: f32,
    table_top: f32,
    dates: Vec<NaiveDate>,
    active_panel: Option<String>,
    source_numbers: Vec<Option<usize>>,
}

impl Layout<'_> {
    fn text_width(&self, value: &str, size: f32, bold: bool) -> f32 {
        let face = if bold {
            &self.bold_metrics
        } else {
            &self.regular_metrics
        };
        let units: u32 = value
            .chars()
            .map(|character| {
                face.glyph_index(character)
                    .and_then(|glyph| face.glyph_hor_advance(glyph))
                    .unwrap_or(face.units_per_em()) as u32
            })
            .sum();
        units as f32 / face.units_per_em() as f32 * size * 25.4 / 72.0
    }

    fn wrap(&self, value: &str, size: f32, width: f32, bold: bool) -> Vec<String> {
        let mut lines = Vec::new();
        for paragraph in value.trim().lines() {
            let mut current = String::new();
            for word in paragraph.split_whitespace() {
                let candidate = if current.is_empty() {
                    word.to_owned()
                } else {
                    format!("{current} {word}")
                };
                if self.text_width(&candidate, size, bold) <= width {
                    current = candidate;
                    continue;
                }
                if !current.is_empty() {
                    lines.push(std::mem::take(&mut current));
                }
                for character in word.chars() {
                    let mut candidate = current.clone();
                    candidate.push(character);
                    if !current.is_empty() && self.text_width(&candidate, size, bold) > width {
                        lines.push(std::mem::take(&mut current));
                    }
                    current.push(character);
                }
            }
            lines.push(current);
        }
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    fn text(&mut self, x: f32, y: f32, value: &str, size: f32, bold: bool, color: Color) {
        if value.is_empty() {
            return;
        }
        self.ops.extend([
            Op::StartTextSection,
            Op::SetFont {
                font: if bold {
                    self.bold.clone()
                } else {
                    self.regular.clone()
                },
                size: Pt(size),
            },
            Op::SetTextCursor {
                pos: Point::new(Mm(x), Mm(y)),
            },
            Op::SetFillColor { col: color },
            unicode_show_text_op(value),
            Op::EndTextSection,
        ]);
    }

    fn rect(&mut self, x: f32, y: f32, width: f32, height: f32, color: Color) {
        self.ops.push(Op::SetFillColor { col: color });
        self.ops.push(Op::DrawPolygon {
            polygon: Rect {
                x: Mm(x).into(),
                y: Mm(y).into(),
                width: Mm(width).into(),
                height: Mm(height).into(),
                mode: Some(PaintMode::Fill),
                winding_order: Some(WindingOrder::NonZero),
            }
            .to_polygon(),
        });
    }

    fn page_header(&mut self) {
        if !self.pages.is_empty() {
            append_company_footer(
                &mut self.ops,
                &self.context.brand,
                &self.regular,
                LEFT,
                RIGHT,
                17.0,
                14.0,
            );
            self.y = TOP;
            self.content_header();
            return;
        }
        append_company_chrome(
            &mut self.ops,
            &self.context.brand,
            &self.regular,
            LEFT,
            RIGHT,
            TOP + 3.0,
            17.0,
            14.0,
        );
        if !self.context.patient_identifier.is_empty() {
            let reference = format!(
                "{}: {}",
                self.context.tx("ID пациента", "Patienten-ID"),
                self.context.patient_identifier
            );
            self.text(
                RIGHT - self.text_width(&reference, 8.5, false),
                201.5,
                &reference,
                8.5,
                false,
                ink(),
            );
        }

        let title = self
            .context
            .tx("Лабораторные результаты", "Laborergebnisse");
        self.text(
            (297.0 - self.text_width(title, 17.0, true)) / 2.0,
            TOP - 7.0,
            title,
            17.0,
            true,
            ink(),
        );

        let patient = format!(
            "{}: {}\n{}: {}  |  ID: {}",
            self.context.tx("Пациент", "Patient"),
            self.context.patient_name,
            self.context.tx("Дата рождения", "Geburtsdatum"),
            self.context.birth_date,
            self.context.patient_identifier
        );
        let issue = format!(
            "{}: {}\n{}: {}",
            self.context.tx("Сформировал", "Erstellt von"),
            self.context.printed_by,
            self.context.tx("Дата", "Stand"),
            self.context.printed_on
        );
        let left = self.wrap(&patient, 9.0, 130.0, false);
        let right = self.wrap(&issue, 9.0, 125.0, false);
        let line_count = left.len().max(right.len());
        let card_top = TOP - 13.0;
        let card_height = line_count as f32 * 4.0 + 6.0;
        self.rect(
            LEFT,
            card_top - card_height,
            WIDTH,
            card_height,
            rgb(0.975, 0.975, 0.978),
        );
        for (x, lines) in [(LEFT, left), (LEFT + 144.0, right)] {
            for (index, line) in lines.iter().enumerate() {
                self.text(
                    x + 4.0,
                    card_top - 5.0 - index as f32 * 4.0,
                    line,
                    9.0,
                    false,
                    ink(),
                );
            }
        }

        self.y = card_top - card_height - 5.0;
        let note = self.context.tx(
            "Сводная таблица сохранённых результатов. Для медицинской интерпретации сверяйте значения с оригинальными лабораторными документами.",
            "Zusammenstellung der gespeicherten Ergebnisse. Zur medizinischen Einordnung die Werte mit den ursprünglichen Laborunterlagen abgleichen.",
        );
        let note_lines = self.wrap(note, 7.5, WIDTH - 8.0, false);
        let note_height = note_lines.len() as f32 * 3.5;
        for (index, line) in note_lines.iter().enumerate() {
            self.text(LEFT, self.y - index as f32 * 3.5, line, 7.5, false, muted());
        }
        self.y -= note_height + 2.0;
        self.content_header();
    }

    fn content_header(&mut self) {
        if self.dates.is_empty() {
            self.text(
                LEFT,
                self.y - 3.0,
                self.context
                    .tx("Источники и примечания", "Quellen und Anmerkungen"),
                10.0,
                true,
                ink(),
            );
            self.y -= 8.0;
        } else {
            let legend = self.context.tx(
                "↑ Выше нормы   ↓ Ниже нормы   ! Отклонение   ? Не определено   Без отметки: Норма   [№] документ-источник. Пустая ячейка: результата нет.",
                "↑ Erhöht   ↓ Erniedrigt   ! Auffällig   ? Nicht bestimmt   Ohne Markierung: Normal   [Nr.] Quelldokument. Leere Zelle: kein Ergebnis."
            );
            for line in self.wrap(legend, 7.0, WIDTH, false) {
                self.text(LEFT, self.y - 2.5, &line, 7.0, false, muted());
                self.y -= 3.5;
            }
            self.y -= 2.5;
            self.table_header();
        }
        self.table_top = self.y;
    }

    fn table_header(&mut self) {
        let mut labels: Vec<String> = [
            self.context.tx("Показатель", "Parameter"),
            self.context.tx("Референс", "Referenzbereich"),
            self.context.tx("Ед.", "Einheit"),
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        labels.extend(
            self.dates
                .iter()
                .map(|date| date.format("%d.%m.%Y").to_string()),
        );
        let widths = column_widths(self.dates.len());
        let lines: Vec<_> = labels
            .iter()
            .enumerate()
            .map(|(index, label)| self.wrap(label, 7.5, widths[index] - PAD * 2.0, true))
            .collect();
        let height = lines.iter().map(Vec::len).max().unwrap_or(1) as f32 * 3.5 + PAD * 2.0;
        self.rect(LEFT, self.y - height, WIDTH, height, rgb(0.96, 0.96, 0.97));
        let mut x = LEFT;
        for (index, cell) in lines.iter().enumerate() {
            for (line_index, line) in cell.iter().enumerate() {
                self.text(
                    if index < 3 {
                        x + PAD
                    } else {
                        x + (widths[index] - self.text_width(line, 7.5, true)) / 2.0
                    },
                    self.y - PAD - 2.5 - line_index as f32 * 3.5,
                    line,
                    7.5,
                    true,
                    muted(),
                );
            }
            x += widths[index];
        }
        self.y -= height;
        self.rect(LEFT, self.y, WIDTH, 0.3, orange());
    }

    fn new_page(&mut self) {
        if !self.ops.is_empty() {
            self.pages.push(PdfPage::new(
                Mm(297.0),
                Mm(210.0),
                std::mem::take(&mut self.ops),
            ));
        }
        self.page_header();
        if let Some(panel) = self.active_panel.clone() {
            self.panel_header(&panel);
        }
    }

    fn panel_header(&mut self, panel: &str) {
        let label = if panel.is_empty() {
            self.context.tx("Прочие показатели", "Weitere Parameter")
        } else {
            panel
        };
        let lines = self.wrap(label, 8.5, WIDTH - PAD * 2.0 - 2.0, true);
        let height = lines.len() as f32 * LINE_HEIGHT + PAD * 2.0;
        self.rect(
            LEFT,
            self.y - height,
            WIDTH,
            height,
            rgb(0.965, 0.965, 0.965),
        );
        self.rect(LEFT, self.y - height, 0.7, height, orange());
        for (index, line) in lines.iter().enumerate() {
            self.text(
                LEFT + PAD + 1.0,
                self.y - PAD - 2.7 - index as f32 * LINE_HEIGHT,
                line,
                8.5,
                true,
                ink(),
            );
        }
        self.y -= height;
    }

    fn row(&mut self, row: &MatrixRow, number: usize) {
        let widths = column_widths(self.dates.len());
        let mut wrapped: Vec<Vec<CellLine>> = [&row.analyte, &row.reference, &row.unit]
            .iter()
            .enumerate()
            .map(|(index, text)| {
                self.wrap(text, FONT_SIZE, widths[index] - PAD * 2.0, index == 0)
                    .into_iter()
                    .map(|text| CellLine {
                        text,
                        bold: index == 0,
                        color: ink(),
                    })
                    .collect()
            })
            .collect();
        for (index, date) in self.dates.iter().enumerate() {
            let mut lines = Vec::new();
            if let Some(values) = row.values.get(date) {
                for source_index in values {
                    let entry = &self.context.entries[*source_index];
                    let time = entry.cells[0]
                        .split_once(' ')
                        .map(|(_, time)| format!("{time}: "))
                        .unwrap_or_default();
                    let source = self.source_numbers[*source_index]
                        .map(|number| format!(" [{number}]"))
                        .unwrap_or_default();
                    let value = format!("{time}{}{}{source}", entry.cells[4], flag_marker(entry));
                    let bold = entry.flag == LabResultFlag::Abnormal;
                    let color = if bold { rgb(0.75, 0.08, 0.18) } else { ink() };
                    lines.extend(
                        self.wrap(&value, FONT_SIZE, widths[index + 3] - PAD * 2.0, bold)
                            .into_iter()
                            .map(|text| CellLine {
                                text,
                                bold,
                                color: color.clone(),
                            }),
                    );
                }
            }
            wrapped.push(lines);
        }
        let total_lines = wrapped.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let row_height = total_lines as f32 * LINE_HEIGHT + 2.0 * PAD;
        if self.active_panel.as_deref() != Some(&row.panel) {
            // Keep each panel heading with at least the start of its first row.
            let panel_height = self
                .wrap(&row.panel, 8.5, WIDTH - PAD * 2.0 - 2.0, true)
                .len() as f32
                * LINE_HEIGHT
                + PAD * 2.0;
            if self.y - BOTTOM < panel_height + row_height.min(20.0) {
                self.active_panel = None;
                self.new_page();
            }
            self.active_panel = Some(row.panel.clone());
            self.panel_header(&row.panel);
        } else if row_height > self.y - BOTTOM && self.y < self.table_top - 20.0 {
            self.new_page();
        }

        let mut offset = 0;
        while offset < total_lines {
            let available = ((self.y - BOTTOM - 2.0 * PAD) / LINE_HEIGHT)
                .floor()
                .max(0.0) as usize;
            if available == 0 {
                self.new_page();
                continue;
            }
            let take = available.min(total_lines - offset);
            let height = take as f32 * LINE_HEIGHT + 2.0 * PAD;
            let background = if number.is_multiple_of(2) {
                rgb(0.985, 0.985, 0.985)
            } else {
                rgb(1.0, 1.0, 1.0)
            };
            self.rect(LEFT, self.y - height, WIDTH, height, background);
            let mut x = LEFT;
            for (index, lines) in wrapped.iter().enumerate() {
                for (line_index, line) in lines.iter().skip(offset).take(take).enumerate() {
                    self.text(
                        x + PAD,
                        self.y - PAD - 2.7 - line_index as f32 * LINE_HEIGHT,
                        &line.text,
                        FONT_SIZE,
                        line.bold,
                        line.color.clone(),
                    );
                }
                self.rect(x, self.y - height, 0.15, height, rgb(0.88, 0.89, 0.90));
                x += widths[index];
            }
            self.y -= height;
            self.rect(RIGHT, self.y, 0.15, height, rgb(0.88, 0.89, 0.90));
            self.rect(LEFT, self.y, WIDTH, 0.2, rgb(0.88, 0.89, 0.90));
            offset += take;
            if offset < total_lines {
                self.new_page();
                let label = format!(
                    "{}: {}",
                    self.context.tx("Продолжение", "Fortsetzung"),
                    row.analyte.chars().take(80).collect::<String>()
                );
                let lines = self.wrap(&label, 8.0, WIDTH - PAD * 2.0, true);
                for line in lines {
                    self.text(LEFT + PAD, self.y - 4.5, &line, 8.0, true, muted());
                    self.y -= LINE_HEIGHT;
                }
                self.y -= PAD * 2.0;
            }
        }
    }

    fn note(&mut self, header: &str, comment: Option<&str>) {
        let mut details = vec![header];
        if let Some(comment) = comment {
            details.push(comment);
        }
        let wrapped: Vec<_> = details
            .iter()
            .enumerate()
            .flat_map(|(index, value)| {
                self.wrap(value, FONT_SIZE, WIDTH - PAD * 2.0, index == 0)
                    .into_iter()
                    .map(move |text| (text, index == 0))
            })
            .collect();
        if self.y - BOTTOM < (wrapped.len().min(4) as f32 * LINE_HEIGHT + PAD * 2.0) {
            self.new_page();
        }
        for (text, bold) in wrapped {
            if self.y - BOTTOM < LINE_HEIGHT + PAD * 2.0 {
                self.new_page();
                self.text(
                    LEFT + PAD,
                    self.y - 3.0,
                    self.context
                        .tx("Продолжение примечания", "Fortsetzung der Anmerkung"),
                    FONT_SIZE,
                    true,
                    muted(),
                );
                self.y -= 6.0;
            }
            self.text(
                LEFT + PAD,
                self.y - PAD - 2.7,
                &text,
                FONT_SIZE,
                bold,
                if bold { ink() } else { muted() },
            );
            self.y -= LINE_HEIGHT;
        }
        self.y -= PAD * 2.0;
        self.rect(LEFT, self.y, WIDTH, 0.2, rgb(0.88, 0.89, 0.90));
        self.y -= PAD;
    }

    fn finish(mut self) -> Vec<PdfPage> {
        self.pages.push(PdfPage::new(
            Mm(297.0),
            Mm(210.0),
            std::mem::take(&mut self.ops),
        ));
        let page_count = self.pages.len();
        for index in 0..page_count {
            let page = format!(
                "{} {} / {}",
                self.context.tx("Страница", "Seite"),
                index + 1,
                page_count
            );
            self.text(
                RIGHT - self.text_width(&page, 8.0, false),
                12.3,
                &page,
                8.0,
                false,
                muted(),
            );
            self.pages[index].ops.append(&mut self.ops);
        }
        self.pages
    }
}

pub fn build_lab_results_pdf(context: &LabResultsContext) -> Result<Vec<u8>, &'static str> {
    if context.entries.is_empty() {
        return Err("Lab results are empty");
    }
    let mut document = PdfDocument::new(context.tx("Лабораторные результаты", "Laborergebnisse"));
    let (regular, bold) = add_unicode_pdf_fonts(&mut document)?;
    let (sources, source_numbers) = source_references(&context.entries);
    let mut layout = Layout {
        context,
        regular,
        bold,
        regular_metrics: unicode_pdf_font_face(false)?,
        bold_metrics: unicode_pdf_font_face(true)?,
        ops: Vec::new(),
        pages: Vec::new(),
        y: 0.0,
        table_top: 0.0,
        dates: Vec::new(),
        active_panel: None,
        source_numbers,
    };
    let rows = matrix_rows(&context.entries);
    let dates: Vec<_> = context
        .entries
        .iter()
        .map(|entry| entry.measured_date)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    for dates in dates.chunks(MAX_DATES) {
        layout.dates = dates.to_vec();
        layout.active_panel = None;
        layout.new_page();
        if layout.table_top < BOTTOM + 30.0 {
            return Err("Patient details exceed lab results page capacity");
        }
        for (index, row) in rows
            .iter()
            .filter(|row| dates.iter().any(|date| row.values.contains_key(date)))
            .enumerate()
        {
            let panel_height = layout
                .wrap(&row.panel, 8.5, WIDTH - PAD * 2.0 - 2.0, true)
                .len() as f32
                * LINE_HEIGHT
                + PAD * 2.0;
            if panel_height + 20.0 > layout.table_top - BOTTOM {
                return Err("Panel title exceeds lab results page capacity");
            }
            layout.row(row, index + 1);
        }
    }
    layout.dates.clear();
    layout.active_panel = None;
    if !sources.is_empty()
        || context
            .entries
            .iter()
            .any(|entry| !entry.cells[8].trim().is_empty())
    {
        if layout.y - BOTTOM < 25.0 {
            layout.new_page();
        } else {
            layout.y -= 7.0;
            layout.text(
                LEFT,
                layout.y,
                context.tx("Источники и примечания", "Quellen und Anmerkungen"),
                10.0,
                true,
                ink(),
            );
            layout.y -= 5.0;
        }
    }
    for (index, source) in sources.iter().enumerate() {
        let entry = &context.entries[*source];
        let name = if entry.source_document_name.trim().is_empty() {
            context.tx("Документ без названия", "Dokument ohne Dateiname")
        } else {
            entry.source_document_name.trim()
        };
        for line in layout.wrap(
            &format!("[{}] {name}", index + 1),
            FONT_SIZE,
            WIDTH - PAD * 2.0,
            false,
        ) {
            if layout.y - BOTTOM < LINE_HEIGHT + PAD * 2.0 {
                layout.new_page();
            }
            layout.text(
                LEFT + PAD,
                layout.y - PAD - 2.7,
                &line,
                FONT_SIZE,
                false,
                ink(),
            );
            layout.y -= LINE_HEIGHT;
        }
        layout.y -= PAD;
    }
    for (index, entry) in context
        .entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| !entry.cells[8].trim().is_empty())
    {
        let source = layout.source_numbers[index]
            .map(|number| format!(" [{number}]"))
            .unwrap_or_default();
        let header = format!(
            "{} | {} | {}{source}",
            entry.cells[0], entry.cells[3], entry.cells[4]
        );
        layout.note(&header, Some(&entry.cells[8]));
    }
    Ok(document
        .with_pages(layout.finish())
        .save(&pdf_text_save_options(), &mut Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(russian: bool) -> LabResultsContext {
        LabResultsContext {
            russian,
            patient_name: "Anna Beispiel / Олена Приклад".into(),
            patient_identifier: "TEST-001".into(),
            birth_date: "02.03.1980".into(),
            printed_by: "GMED Test".into(),
            printed_on: "07.09.2026".into(),
            brand: PatientPdfBrand {
                name: "GMED - Agentur für Patientenbetreuung".into(),
                responsible_person: "Heorhii Hudiiev".into(),
                address: Some("Albert-Schweitzer-Straße 56 · 81735 München · Deutschland".into()),
                phone: Some("+49 151 20943768".into()),
                email: Some("contact@gmed-health.com".into()),
                website: Some("https://gmed-health.com".into()),
            },
            ..Default::default()
        }
    }

    fn entry(index: usize, russian: bool) -> LabResultEntry {
        let (flag, label) = match index % 4 {
            0 => (
                LabResultFlag::Abnormal,
                if russian {
                    "Выше нормы"
                } else {
                    "Erhöht"
                },
            ),
            1 => (
                LabResultFlag::Abnormal,
                if russian {
                    "Ниже нормы"
                } else {
                    "Erniedrigt"
                },
            ),
            2 => (
                LabResultFlag::Normal,
                if russian { "Норма" } else { "Normal" },
            ),
            _ => (
                LabResultFlag::Unknown,
                if russian {
                    "Не определено"
                } else {
                    "Nicht bestimmt"
                },
            ),
        };
        LabResultEntry {
            measured_date: NaiveDate::from_ymd_opt(2026, 9, (index % 28 + 1) as u32).unwrap(),
            source_document_id: Some(uuid::Uuid::from_u128(1)),
            source_document_name: "Laborbericht-ÄÖÜ.pdf".into(),
            cells: [
                format!("{:02}.09.2026", index % 28 + 1),
                "Blutbild".into(),
                "Labor München".into(),
                format!("C-reaktives Protein {index:02}"),
                "<0,5".into(),
                "mg/l".into(),
                "0 - 5".into(),
                label.into(),
                if index == 0 {
                    format!(
                        "Kommentar: {} END-OF-LAB-NOTE",
                        "Клінічний коментар із документа. ".repeat(80)
                    )
                } else {
                    String::new()
                },
            ],
            flag,
        }
    }

    fn comparison_sample(russian: bool) -> LabResultsContext {
        let mut sample = context(russian);
        sample.printed_on = "10.09.2026".into();
        let parameters = [
            ("Blutbild", "Hämoglobin", "13,9 - 17,5", "g/dl", "15,1"),
            ("Blutbild", "Hämatokrit", "38,0 - 51,0", "%", "45,3"),
            ("Blutbild", "Erythrozyten", "4,50 - 6,00", "T/l", "5,15"),
            ("Blutbild", "Leukozyten", "3,9 - 11,0", "G/l", "6,4"),
            ("Blutbild", "Thrombozyten", "150 - 400", "G/l", "262"),
            (
                "Blutbild",
                "Neutrophile masch. (absolut)",
                "1,80 - 6,20",
                "G/l",
                "4,15",
            ),
            (
                "Blutbild",
                "Mittleres Thrombozytenvolumen (MPV)",
                "7,6 - 10,7",
                "fl",
                "8,4",
            ),
            (
                "Niere / Harntrakt",
                "Kreatinin Jaffé",
                "0,70 - 1,20",
                "mg/dl",
                "0,96",
            ),
            ("Niere / Harntrakt", "GFR / MDRD", ">= 60", "ml/min", ">60"),
            ("Leber / Galle", "GGT", "<= 60", "U/l", "11"),
            (
                "Leber / Galle",
                "Bilirubin, gesamt",
                "<= 1,2",
                "mg/dl",
                "0,94",
            ),
        ];
        for day in 1..=8 {
            for (index, (panel, analyte, reference, unit, result)) in parameters.iter().enumerate()
            {
                if (day + index) % 7 == 0 {
                    continue;
                }
                let mut value = entry(2, russian);
                if day > 3 {
                    value.source_document_id = Some(uuid::Uuid::from_u128(2));
                    value.source_document_name = "Laborbericht-Kontrolle.pdf".into();
                }
                value.measured_date = NaiveDate::from_ymd_opt(2026, 9, day as u32).unwrap();
                value.cells[0] = value.measured_date.format("%d.%m.%Y").to_string();
                value.cells[1] = (*panel).into();
                value.cells[3] = (*analyte).into();
                value.cells[4] = (*result).into();
                value.cells[5] = (*unit).into();
                value.cells[6] = (*reference).into();
                if index == 9 && day == 2 {
                    value.cells[4] = "76".into();
                    value.flag = LabResultFlag::Abnormal;
                    value.cells[7] = if russian {
                        "Выше нормы"
                    } else {
                        "Erhöht"
                    }
                    .into();
                }
                if index == 0 && day == 1 {
                    let mut repeated = value.clone();
                    repeated.cells[0].push_str(" 16:30");
                    repeated.cells[4] = "15,0".into();
                    sample.entries.push(repeated);
                    value.cells[0].push_str(" 08:00");
                }
                sample.entries.push(value);
            }
        }
        sample
    }

    #[test]
    fn lab_matrix_groups_only_matching_analytes_references_and_units() {
        let base = entry(2, false);
        let mut entries = vec![base.clone(); 6];
        entries[1].measured_date = base.measured_date.succ_opt().unwrap();
        entries[1].cells[0] = "04.09.2026".into();
        entries[2].cells[0].push_str(" 16:00");
        entries[2].cells[4] = "0,7".into();
        entries[3].cells[6] = "0 - 10".into();
        entries[4].cells[5] = "mg/dl".into();
        entries[5].cells[1] = "Other panel".into();
        let rows = matrix_rows(&entries);
        assert_eq!(rows.len(), 4);
        let grouped = rows.iter().find(|row| row.values.len() == 2).unwrap();
        assert_eq!(grouped.values[&base.measured_date], vec![0, 2]);
        assert_eq!(
            grouped.values[&base.measured_date.succ_opt().unwrap()],
            vec![1]
        );
        assert_eq!(
            rows.iter()
                .flat_map(|row| row.values.values())
                .map(Vec::len)
                .sum::<usize>(),
            entries.len()
        );
        assert_eq!(
            grouped.values.keys().copied().collect::<Vec<_>>(),
            vec![base.measured_date, base.measured_date.succ_opt().unwrap()]
        );
    }

    #[test]
    fn lab_sources_reference_documents_not_laboratories_flags_or_comments() {
        let mut entries = vec![entry(2, false); 3];
        entries[1].cells[4] = "0,8".into();
        entries[1].cells[0].push_str(" 12:45");
        entries[1].cells[2] = "Different laboratory".into();
        entries[1].cells[7] = "Erhöht".into();
        entries[1].cells[8] = "Additional comment".into();
        // Same filename does not merge two different original documents.
        entries[2].source_document_id = Some(uuid::Uuid::from_u128(2));
        let (sources, numbers) = source_references(&entries);
        assert_eq!(sources, vec![0, 2]);
        assert_eq!(numbers, vec![Some(1), Some(1), Some(2)]);
        assert_eq!(
            matrix_rows(&entries)[0].values[&entries[0].measured_date].len(),
            3
        );
    }

    #[test]
    fn lab_sources_do_not_invent_documents_for_manual_results() {
        let mut entries = vec![entry(2, false); 3];
        for entry in &mut entries {
            entry.source_document_id = None;
        }
        entries[0].source_document_name.clear();
        assert_eq!(
            source_references(&entries),
            (vec![1], vec![None, Some(1), Some(1)])
        );
    }

    #[test]
    fn lab_reference_bounds_keep_one_sided_limits_distinct() {
        assert_eq!(format_reference_bounds("", "5"), "<= 5");
        assert_eq!(format_reference_bounds("5", ""), ">= 5");
        assert_eq!(format_reference_bounds("0", "5"), "0 - 5");
        assert_eq!(format_reference_bounds("", ""), "");
    }

    #[test]
    fn lab_results_pdf_preserves_table_rows_and_localized_title() {
        for russian in [false, true] {
            let mut report = context(russian);
            report.entries = (0..42).map(|index| entry(index, russian)).collect();
            let bytes = build_lab_results_pdf(&report).unwrap();
            let pages = pdf_extract::extract_text_from_mem_by_pages(&bytes).unwrap();
            assert!(pages.len() > 1);
            for (index, page) in pages.iter().enumerate() {
                for label in [
                    report.tx("Лабораторные результаты", "Laborergebnisse"),
                    "TEST-001",
                    "Олена Приклад",
                    report.tx("Сформировал:", "Erstellt von:"),
                    report.tx("Сводная таблица сохранённых", "Zusammenstellung der gespeicherten"),
                ] {
                    assert_eq!(page.contains(label), index == 0, "page {}: {label}", index + 1);
                }
                assert!(page.contains("contact@gmed-health.com"));
                assert!(page.contains(&format!(
                    "{} {} / {}",
                    report.tx("Страница", "Seite"),
                    index + 1,
                    pages.len()
                )));
            }
            let text = pages.join("\n");
            for index in 0..42 {
                assert!(
                    text.contains(&format!("C-reaktives Protein {index:02}")),
                    "missing lab result {index}"
                );
            }
            assert!(text.contains("END-OF-LAB-NOTE"));
            assert!(!text.contains("1. C-reaktives Protein"));
            assert!(!text.contains("2. C-reaktives Protein"));
            for label in if russian {
                ["Выше нормы", "Ниже нормы", "Норма", "Не определено"]
            } else {
                ["Erhöht", "Erniedrigt", "Normal", "Nicht bestimmt"]
            } {
                assert!(text.contains(label), "missing lab flag {label}");
            }
            assert!(text.contains("Олена Приклад"));
            assert!(text.contains(if russian {
                "Лабораторные результаты"
            } else {
                "Laborergebnisse"
            }));
            assert!(text.contains(if russian {
                "Страница 2 /"
            } else {
                "Seite 2 /"
            }));
            if let Ok(dir) = std::env::var("GMED_LAB_RESULTS_PDF_QA_DIR") {
                std::fs::create_dir_all(&dir).unwrap();
                let sample = comparison_sample(russian);
                std::fs::write(
                    std::path::Path::new(&dir).join(if russian {
                        "lab-results-ru.pdf"
                    } else {
                        "lab-results-de.pdf"
                    }),
                    build_lab_results_pdf(&sample).unwrap(),
                )
                .unwrap();
            }
        }
    }

    #[test]
    fn lab_comparison_pdf_preserves_date_bands_repeated_times_and_blank_cells() {
        let report = comparison_sample(false);
        let rows = matrix_rows(&report.entries);
        let gfr = rows.iter().find(|row| row.analyte == "GFR / MDRD").unwrap();
        assert!(
            !gfr.values
                .contains_key(&NaiveDate::from_ymd_opt(2026, 9, 6).unwrap())
        );
        let bytes = build_lab_results_pdf(&report).unwrap();
        let pages = pdf_extract::extract_text_from_mem_by_pages(&bytes).unwrap();
        assert!(pages.len() > 1);
        assert!(pages[0].contains("Laborergebnisse"));
        for page in pages.iter().skip(1) {
            assert!(!page.contains("Laborergebnisse"));
            assert!(!page.contains("TEST-001"));
        }
        for page in &pages {
            assert!(page.contains("Parameter"));
            assert!(page.contains("Referenzbereich"));
        }
        let text = pages.join("\n");
        assert!(text.contains("08:00: 15,1"));
        assert!(text.contains("16:30: 15,0"));
        for day in 1..=8 {
            assert!(text.contains(&format!("{day:02}.09.2026")));
        }
        assert!(text.find("06.09.2026").unwrap() < text.find("07.09.2026").unwrap());
        assert_eq!(
            text.matches("Hämoglobin").count(),
            2,
            "one row per date band, not one per measurement"
        );
        assert_eq!(text.matches("Laborbericht-ÄÖÜ.pdf").count(), 1);
        assert_eq!(text.matches("Laborbericht-Kontrolle.pdf").count(), 1);
        assert!(
            !text.contains("Labor München"),
            "do not print laboratory names in the document legend"
        );
        assert!(
            !text.contains("Seite:"),
            "source page numbers are not included"
        );
    }

    #[test]
    fn lab_results_pdf_rejects_empty_rows_and_oversized_header() {
        assert!(build_lab_results_pdf(&context(false)).is_err());
        let mut oversized = context(false);
        oversized.patient_name = "Very long patient name ".repeat(400);
        oversized.entries.push(entry(0, false));
        assert!(build_lab_results_pdf(&oversized).is_err());
    }

    #[test]
    fn lab_results_columns_match_printable_width() {
        for count in 1..=MAX_DATES {
            let widths = column_widths(count);
            assert!((widths.iter().sum::<f32>() - WIDTH).abs() < 0.01);
            assert!(widths.iter().all(|width| *width >= 18.0));
        }
    }
}
