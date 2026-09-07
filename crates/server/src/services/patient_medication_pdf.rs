//! Printable snapshot of the current prescriptions. This is not a BMP carrier
//! generator: all recorded text, including Unicode and long instructions, is
//! kept in the visible PDF without a lossy machine-readable representation.
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
const COLS: [f32; 11] = [
    40.0, 36.0, 20.0, 22.0, 14.0, 14.0, 14.0, 14.0, 15.0, 48.0, 32.0,
];
const FONT_SIZE: f32 = 9.0;
const LINE_HEIGHT: f32 = 4.0;
const PAD: f32 = 1.8;

#[derive(Clone, Default)]
pub struct MedicationPlanEntry {
    pub category: String,
    /// Ingredient, trade name, strength, form/route, four doses, unit, notes, reason.
    pub cells: [String; 11],
}

#[derive(Default)]
pub struct MedicationPlanContext {
    pub russian: bool,
    pub patient_name: String,
    pub patient_identifier: String,
    pub birth_date: String,
    pub printed_by: String,
    pub printed_on: String,
    pub entries: Vec<MedicationPlanEntry>,
    pub brand: PatientPdfBrand,
}

impl MedicationPlanContext {
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
fn col_x(i: usize) -> f32 {
    LEFT + COLS[..i].iter().sum::<f32>()
}

struct Layout<'a> {
    context: &'a MedicationPlanContext,
    regular: PdfFontHandle,
    bold: PdfFontHandle,
    regular_metrics: ttf_parser::Face<'static>,
    bold_metrics: ttf_parser::Face<'static>,
    ops: Vec<Op>,
    pages: Vec<PdfPage>,
    y: f32,
    table_top: f32,
}

impl<'a> Layout<'a> {
    fn text_width(&self, value: &str, size: f32, bold: bool) -> f32 {
        let face = if bold {
            &self.bold_metrics
        } else {
            &self.regular_metrics
        };
        let units: u32 = value
            .chars()
            .map(|c| {
                face.glyph_index(c)
                    .and_then(|g| face.glyph_hor_advance(g))
                    .unwrap_or(face.units_per_em()) as u32
            })
            .sum();
        units as f32 / face.units_per_em() as f32 * size * 25.4 / 72.0
    }

    /// Preserve explicit line breaks and split even unbroken long tokens to fit
    /// the actual embedded font. The general clinical wrapper is too wide for
    /// dose cells and cannot safely be reused here.
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
                    let mut next = current.clone();
                    next.push(character);
                    if !current.is_empty() && self.text_width(&next, size, bold) > width {
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

    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Color) {
        self.ops.push(Op::SetFillColor { col: color });
        self.ops.push(Op::DrawPolygon {
            polygon: Rect {
                x: Mm(x).into(),
                y: Mm(y).into(),
                width: Mm(w).into(),
                height: Mm(h).into(),
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
            self.table_header();
            self.table_top = self.y;
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
        let title = self.context.tx("Медикаментозный план", "Medikationsplan");
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
        let count = left.len().max(right.len());
        let card_top = TOP - 15.0;
        let card_height = count as f32 * 4.0 + 7.0;
        self.rect(
            LEFT,
            card_top - card_height,
            WIDTH,
            card_height,
            rgb(0.975, 0.975, 0.978),
        );
        for (x, lines) in [(LEFT, left), (LEFT + 144.0, right)] {
            for (i, line) in lines.iter().enumerate() {
                self.text(
                    x + 4.0,
                    card_top - 5.0 - i as f32 * 4.0,
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
                "Актуальные препараты из карточки пациента",
                "Aktuelle Medikamente aus der Patientenakte",
            ),
            8.0,
            false,
            muted(),
        );
        self.y -= 4.0;
        let provenance_note = self.context.tx(
            "Сводная информация на основании имеющихся у нас данных и документов других лечащих врачей. Не является самостоятельным назначением. Необходимо проверить актуальность и полноту сведений.",
            "Zusammenstellung aus den uns vorliegenden Angaben und Unterlagen anderer behandelnder Ärztinnen und Ärzte. Keine eigene Verordnung; Aktualität und Vollständigkeit bitte prüfen.",
        );
        let note_lines = self.wrap(provenance_note, 7.5, WIDTH - 8.0, false);
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
                "Действующее вещество",
                "Торговое название",
                "Дозировка",
                "Форма / применение",
                "Утро",
                "День",
                "Вечер",
                "Ночь",
                "Ед.",
                "Указания / период приёма",
                "Показание",
            ]
        } else {
            [
                "Wirkstoff",
                "Handelsname",
                "Stärke",
                "Form / Anwendung",
                "Morgens",
                "Mittags",
                "Abends",
                "Zur Nacht",
                "Einheit",
                "Hinweise / Einnahmezeitraum",
                "Grund",
            ]
        };
        let lines: Vec<_> = labels
            .iter()
            .enumerate()
            .map(|(i, s)| self.wrap(s, 7.5, COLS[i] - 2.0, true))
            .collect();
        let height = lines.iter().map(Vec::len).max().unwrap_or(1) as f32 * 3.5 + PAD * 2.0;
        self.rect(LEFT, self.y - height, WIDTH, height, rgb(0.96, 0.96, 0.97));
        for (i, cell) in lines.iter().enumerate() {
            for (j, line) in cell.iter().enumerate() {
                self.text(
                    col_x(i) + 1.0,
                    self.y - PAD - 2.5 - j as f32 * 3.5,
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

    fn section(&mut self, title: &str) {
        self.rect(LEFT, self.y - 7.0, WIDTH, 7.0, rgb(1.0, 0.96, 0.92));
        self.text(LEFT + PAD, self.y - 4.8, title, 9.0, true, ink());
        self.y -= 7.0;
    }

    fn entry(&mut self, entry: &MedicationPlanEntry, row_index: usize, section: &str) {
        let wrapped: Vec<_> = entry
            .cells
            .iter()
            .enumerate()
            .map(|(i, s)| self.wrap(s, FONT_SIZE, COLS[i] - PAD * 2.0, false))
            .collect();
        let total = wrapped.iter().map(Vec::len).max().unwrap_or(1);
        let height = total as f32 * LINE_HEIGHT + 2.0 * PAD;
        if height > self.y - BOTTOM && self.y < self.table_top - 7.1 {
            self.new_page();
            self.section(section);
        }
        let mut offset = 0;
        while offset < total {
            let available = ((self.y - BOTTOM - 2.0 * PAD) / LINE_HEIGHT)
                .floor()
                .max(0.0) as usize;
            if available == 0 {
                self.new_page();
                self.section(section);
                continue;
            }
            let take = available.min(total - offset);
            let height = take as f32 * LINE_HEIGHT + 2.0 * PAD;
            if row_index.is_multiple_of(2) {
                self.rect(
                    LEFT,
                    self.y - height,
                    WIDTH,
                    height,
                    rgb(0.985, 0.985, 0.985),
                );
            }
            for (i, lines) in wrapped.iter().enumerate() {
                for (j, line) in lines.iter().skip(offset).take(take).enumerate() {
                    let x = if (4..8).contains(&i) {
                        col_x(i) + (COLS[i] - self.text_width(line, FONT_SIZE, false)) / 2.0
                    } else {
                        col_x(i) + PAD
                    };
                    self.text(
                        x,
                        self.y - PAD - 2.8 - j as f32 * LINE_HEIGHT,
                        line,
                        FONT_SIZE,
                        false,
                        ink(),
                    );
                }
                self.rect(
                    col_x(i),
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
            if offset < total {
                self.new_page();
                self.section(section);
                // Never leave a continued instruction detached from its entry.
                let name: String = entry.cells[1].chars().take(80).collect();
                let label = format!(
                    "{}: {name}",
                    self.context
                        .tx("Продолжение препарата", "Fortsetzung Eintrag")
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
        let count = self.pages.len();
        for index in 0..count {
            let page = format!(
                "{} {} / {}",
                self.context.tx("Страница", "Seite"),
                index + 1,
                count
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

pub fn build_medication_plan_pdf(context: &MedicationPlanContext) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(context.tx("Медикаментозный план", "Medikationsplan"));
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
    // A malformed oversized patient/issuer label must fail rather than cause
    // pagination to keep creating pages with no space for a single table line.
    if layout.table_top < BOTTOM + 14.0 + LINE_HEIGHT + PAD * 2.0 {
        return Err("Patient details exceed medication plan page capacity");
    }
    let sections = [
        ("dauer", context.tx("Постоянная терапия", "Dauermedikation")),
        (
            "besondere",
            context.tx("В особое время", "Zu besonderen Zeiten"),
        ),
        ("selbst", context.tx("Самолечение", "Selbstmedikation")),
        (
            "other",
            context.tx("Другие препараты", "Weitere Medikamente"),
        ),
    ];
    let mut row_index = 0;
    for (key, title) in sections {
        let entries: Vec<_> = context
            .entries
            .iter()
            .filter(|entry| {
                if key == "other" {
                    !["dauer", "besondere", "selbst"].contains(&entry.category.as_str())
                } else {
                    entry.category == key
                }
            })
            .collect();
        if entries.is_empty() {
            continue;
        }
        if layout.y - 7.0 - LINE_HEIGHT - PAD * 2.0 < BOTTOM {
            layout.new_page();
        }
        layout.section(title);
        for entry in entries {
            row_index += 1;
            layout.entry(entry, row_index, title);
        }
    }
    Ok(document
        .with_pages(layout.finish())
        .save(&pdf_text_save_options(), &mut Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> MedicationPlanContext {
        MedicationPlanContext {
            patient_name: "Anna Beispiel / Олена Приклад".into(),
            patient_identifier: "TEST-001".into(),
            birth_date: "02.03.1980".into(),
            printed_by: "GMED Test".into(),
            printed_on: "06.09.2026".into(),
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

    #[test]
    fn medication_pdf_preserves_every_entry_and_long_unicode_instructions() {
        let mut ctx = context();
        for index in 0..45 {
            ctx.entries.push(MedicationPlanEntry {
                category: if index == 44 { "legacy" } else { "dauer" }.into(),
                cells: [
                    format!("Wirkstoff-{index:02}"),
                    format!("Arzneimittel-{index:02}"),
                    "500 mg".into(),
                    "Tablette\noral".into(),
                    "1/2".into(),
                    "0".into(),
                    "1".into(),
                    String::new(),
                    "Stück".into(),
                    if index == 0 {
                        format!(
                            "{}\nVerordnender Arzt: Dr. Erika Beispiel\nEND-OF-LONG-NOTE",
                            "Записана в картці інструкція. ".repeat(160)
                        )
                    } else {
                        "Nach der Mahlzeit\nEinnahme bis: 30.09.2026".into()
                    },
                    "Dokumentierte Indikation".into(),
                ],
            });
        }
        for russian in [false, true] {
            ctx.russian = russian;
            let bytes = build_medication_plan_pdf(&ctx).unwrap();
            let pages = pdf_extract::extract_text_from_mem_by_pages(&bytes).unwrap();
            assert!(pages.len() > 1);
            for (index, page) in pages.iter().enumerate() {
                for label in [
                    ctx.tx("Медикаментозный план", "Medikationsplan"),
                    "TEST-001",
                    "Олена Приклад",
                    ctx.tx("Сформировал:", "Erstellt von:"),
                    ctx.tx("Сводная информация", "Zusammenstellung aus"),
                ] {
                    assert_eq!(page.contains(label), index == 0, "page {}: {label}", index + 1);
                }
                // Table labels, footer and numbering still belong on every page.
                assert!(page.contains(ctx.tx("Торговое название", "Handelsname")));
                assert!(page.contains("contact@gmed-health.com"));
                assert!(page.contains(&format!(
                    "{} {} / {}",
                    ctx.tx("Страница", "Seite"),
                    index + 1,
                    pages.len()
                )));
            }
            let text = pages.join("\n");
            for index in 0..45 {
                assert!(
                    text.contains(&format!("Arzneimittel-{index:02}")),
                    "missing entry {index}"
                );
            }
            assert!(text.contains("END-OF-LONG-NOTE"));
            let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
            assert!(normalized.contains("Verordnender Arzt: Dr. Erika Beispiel"));
            assert!(!text.contains("1. Wirkstoff-00"));
            assert!(text.contains("Олена Приклад"));
            assert!(text.contains("GMED - Agentur für Patientenbetreuung Heorhii Hudiiev"));
            assert!(text.contains("contact@gmed-health.com"));
            assert!(text.contains(if russian {
                "ID пациента: TEST-001"
            } else {
                "Patienten-ID: TEST-001"
            }));
            assert!(text.contains(if russian {
                "Сводная информация на основании имеющихся у нас данных и документов других лечащих врачей. Не является самостоятельным назначением. Необходимо проверить актуальность и полноту сведений."
            } else {
                "Zusammenstellung aus den uns vorliegenden Angaben und Unterlagen anderer behandelnder Ärztinnen und Ärzte. Keine eigene Verordnung; Aktualität und Vollständigkeit bitte prüfen."
            }));
            assert!(text.contains(if russian {
                "Страница 2 /"
            } else {
                "Seite 2 /"
            }));
            assert!(!text.contains("nicht dargestellt"));
            if let Ok(dir) = std::env::var("GMED_MEDICATION_PDF_QA_DIR") {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(
                    std::path::Path::new(&dir).join(if russian {
                        "medication-multipage-ru.pdf"
                    } else {
                        "medication-multipage-de.pdf"
                    }),
                    &bytes,
                )
                .unwrap();
                let sample = MedicationPlanContext {
                    russian,
                    entries: ctx
                        .entries
                        .iter()
                        .skip(1)
                        .take(3)
                        .cloned()
                        .enumerate()
                        .map(|(i, mut entry)| {
                            entry.category = ["dauer", "besondere", "selbst"][i].into();
                            if i == 0 {
                                entry.cells[9].push_str("\nVerordnender Arzt: Dr. Erika Beispiel");
                            }
                            entry
                        })
                        .collect(),
                    ..context()
                };
                std::fs::write(
                    std::path::Path::new(&dir).join(if russian {
                        "medication-plan-ru.pdf"
                    } else {
                        "medication-plan-de.pdf"
                    }),
                    build_medication_plan_pdf(&sample).unwrap(),
                )
                .unwrap();
            }
        }
    }

    #[test]
    fn medication_pdf_rejects_a_header_that_leaves_no_room_for_entries() {
        let mut ctx = context();
        ctx.patient_name = "Very long patient name ".repeat(400);
        ctx.entries.push(MedicationPlanEntry::default());
        assert!(build_medication_plan_pdf(&ctx).is_err());
    }

    #[test]
    fn medication_pdf_wraps_narrow_cells_using_font_metrics() {
        let ctx = context();
        let mut doc = PdfDocument::new("test");
        let (regular, bold) = add_unicode_pdf_fonts(&mut doc).unwrap();
        let layout = Layout {
            context: &ctx,
            regular,
            bold,
            regular_metrics: unicode_pdf_font_face(false).unwrap(),
            bold_metrics: unicode_pdf_font_face(true).unwrap(),
            ops: vec![],
            pages: vec![],
            y: 0.0,
            table_top: 0.0,
        };
        for value in [
            "WWWWWWWWWWWWWWW",
            "Действующее вещество",
            "Morgens",
            "1/2",
            "verylongunbrokendrugname",
        ] {
            let lines = layout.wrap(value, 9.0, 9.4, false);
            assert_eq!(lines.concat().replace(' ', ""), value.replace(' ', ""));
            for line in lines {
                assert!(layout.text_width(&line, 9.0, false) <= 9.4);
            }
        }
        assert_eq!(
            layout.wrap("Morgens", 7.5, COLS[4] - 2.0, true),
            ["Morgens"]
        );
        assert!((COLS.iter().sum::<f32>() - WIDTH).abs() < 0.01);
    }
}
