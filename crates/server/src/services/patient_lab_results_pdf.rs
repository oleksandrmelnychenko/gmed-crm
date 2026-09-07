//! Branded, printable table of laboratory results saved in the patient record.

use printpdf::{
    Color, Mm, Op, PaintMode, PdfDocument, PdfFontHandle, PdfPage, Point, Pt, Rect, Rgb,
    WindingOrder,
};

use crate::pdf_text::{
    add_unicode_pdf_fonts, pdf_text_save_options, unicode_pdf_font_face, unicode_show_text_op,
};
use crate::services::patient_pdf_brand::{PatientPdfBrand, append_company_chrome};

const LEFT: f32 = 14.0;
const RIGHT: f32 = 283.0;
const TOP: f32 = 195.0;
const BOTTOM: f32 = 29.0;
const WIDTH: f32 = RIGHT - LEFT;
const COLS: [f32; 9] = [22.0, 26.0, 30.0, 38.0, 24.0, 15.0, 30.0, 25.0, 59.0];
const FONT_SIZE: f32 = 8.3;
const LINE_HEIGHT: f32 = 3.7;
const PAD: f32 = 1.7;

#[derive(Clone, Default)]
pub struct LabResultEntry {
    /// Date, panel, laboratory, analyte, result, unit, reference, flag, notes/source.
    pub cells: [String; 9],
    pub abnormal: bool,
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

fn col_x(index: usize) -> f32 {
    LEFT + COLS[..index].iter().sum::<f32>()
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
        let card_top = TOP - 15.0;
        let card_height = line_count as f32 * 4.0 + 7.0;
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
        self.text(
            LEFT,
            self.y,
            self.context.tx(
                "Результаты из карточки пациента",
                "Ergebnisse aus der Patientenakte",
            ),
            8.0,
            false,
            muted(),
        );
        self.y -= 4.0;
        let note = self.context.tx(
            "Сводная таблица сохранённых результатов. Для медицинской интерпретации сверяйте значения с оригинальными лабораторными документами.",
            "Zusammenstellung der gespeicherten Ergebnisse. Zur medizinischen Einordnung die Werte mit den ursprünglichen Laborunterlagen abgleichen.",
        );
        let note_lines = self.wrap(note, 7.5, WIDTH - 8.0, false);
        let note_height = note_lines.len() as f32 * 3.5 + 5.0;
        self.rect(
            LEFT,
            self.y - note_height,
            WIDTH,
            note_height,
            rgb(0.965, 0.966, 0.97),
        );
        for (index, line) in note_lines.iter().enumerate() {
            self.text(
                LEFT + 4.0,
                self.y - 3.5 - index as f32 * 3.5,
                line,
                7.5,
                false,
                muted(),
            );
        }
        self.y -= note_height + 4.0;
        self.table_header();
        self.table_top = self.y;
    }

    fn table_header(&mut self) {
        let labels = if self.context.russian {
            [
                "Дата",
                "Панель",
                "Лаборатория",
                "Показатель",
                "Результат",
                "Ед.",
                "Референс",
                "Отметка",
                "Комментарий / источник",
            ]
        } else {
            [
                "Datum",
                "Panel",
                "Labor",
                "Parameter",
                "Ergebnis",
                "Einheit",
                "Referenzbereich",
                "Kennzeichnung",
                "Kommentar / Quelle",
            ]
        };
        let lines: Vec<_> = labels
            .iter()
            .enumerate()
            .map(|(index, label)| self.wrap(label, 7.5, COLS[index] - 2.0, true))
            .collect();
        let height = lines.iter().map(Vec::len).max().unwrap_or(1) as f32 * 3.5 + PAD * 2.0;
        self.rect(LEFT, self.y - height, WIDTH, height, rgb(0.96, 0.96, 0.97));
        for (index, cell) in lines.iter().enumerate() {
            for (line_index, line) in cell.iter().enumerate() {
                self.text(
                    col_x(index) + 1.0,
                    self.y - PAD - 2.5 - line_index as f32 * 3.5,
                    line,
                    7.5,
                    true,
                    muted(),
                );
            }
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
    }

    fn entry(&mut self, entry: &LabResultEntry, number: usize) {
        let mut cells = entry.cells.clone();
        cells[3] = format!("{number}. {}", cells[3]);
        let wrapped: Vec<_> = cells
            .iter()
            .enumerate()
            .map(|(index, value)| self.wrap(value, FONT_SIZE, COLS[index] - PAD * 2.0, false))
            .collect();
        let total_lines = wrapped.iter().map(Vec::len).max().unwrap_or(1);
        let row_height = total_lines as f32 * LINE_HEIGHT + 2.0 * PAD;
        if row_height > self.y - BOTTOM && self.y < self.table_top - 0.1 {
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
            let background = if entry.abnormal {
                rgb(1.0, 0.975, 0.955)
            } else if number.is_multiple_of(2) {
                rgb(0.985, 0.985, 0.985)
            } else {
                rgb(1.0, 1.0, 1.0)
            };
            self.rect(LEFT, self.y - height, WIDTH, height, background);
            for (index, lines) in wrapped.iter().enumerate() {
                for (line_index, line) in lines.iter().skip(offset).take(take).enumerate() {
                    self.text(
                        col_x(index) + PAD,
                        self.y - PAD - 2.7 - line_index as f32 * LINE_HEIGHT,
                        line,
                        FONT_SIZE,
                        false,
                        ink(),
                    );
                }
                self.rect(
                    col_x(index),
                    self.y - height,
                    0.15,
                    height,
                    rgb(0.88, 0.89, 0.90),
                );
            }
            self.y -= height;
            self.rect(RIGHT, self.y, 0.15, height, rgb(0.88, 0.89, 0.90));
            self.rect(LEFT, self.y, WIDTH, 0.2, rgb(0.88, 0.89, 0.90));
            offset += take;
            if offset < total_lines {
                self.new_page();
                let label = format!(
                    "{} {number}: {}",
                    self.context.tx("Продолжение", "Fortsetzung"),
                    entry.cells[3].chars().take(80).collect::<String>()
                );
                self.text(LEFT + PAD, self.y - 4.5, &label, 8.0, true, muted());
                self.y -= 7.0;
            }
        }
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
    };
    layout.new_page();
    if layout.table_top < BOTTOM + LINE_HEIGHT + PAD * 2.0 {
        return Err("Patient details exceed lab results page capacity");
    }
    for (index, entry) in context.entries.iter().enumerate() {
        layout.entry(entry, index + 1);
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

    fn entry(index: usize) -> LabResultEntry {
        LabResultEntry {
            cells: [
                format!("{:02}.09.2026", index % 28 + 1),
                "Blutbild".into(),
                "Labor München".into(),
                format!("C-reaktives Protein {index:02}"),
                "<0,5".into(),
                "mg/l".into(),
                "0 - 5".into(),
                if index.is_multiple_of(3) {
                    "Erhöht"
                } else {
                    "Normal"
                }
                .into(),
                if index == 0 {
                    format!(
                        "Kommentar: {} END-OF-LAB-NOTE\nDokument: Laborbericht-ÄÖÜ.pdf",
                        "Клінічний коментар із документа. ".repeat(80)
                    )
                } else {
                    "Dokument: Laborbericht-ÄÖÜ.pdf".into()
                },
            ],
            abnormal: index.is_multiple_of(3),
        }
    }

    #[test]
    fn lab_results_pdf_preserves_table_rows_and_localized_title() {
        for russian in [false, true] {
            let mut report = context(russian);
            report.entries = (0..42).map(entry).collect();
            let bytes = build_lab_results_pdf(&report).unwrap();
            let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
            for index in 0..42 {
                assert!(
                    text.contains(&format!("C-reaktives Protein {index:02}")),
                    "missing lab result {index}"
                );
            }
            assert!(text.contains("END-OF-LAB-NOTE"));
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
                let mut sample = context(russian);
                sample.entries = (1..=8).map(entry).collect();
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
    fn lab_results_pdf_rejects_empty_rows_and_oversized_header() {
        assert!(build_lab_results_pdf(&context(false)).is_err());
        let mut oversized = context(false);
        oversized.patient_name = "Very long patient name ".repeat(400);
        oversized.entries.push(entry(0));
        assert!(build_lab_results_pdf(&oversized).is_err());
    }

    #[test]
    fn lab_results_columns_match_printable_width() {
        assert!((COLS.iter().sum::<f32>() - WIDTH).abs() < 0.01);
    }
}
