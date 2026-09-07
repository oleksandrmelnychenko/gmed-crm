//! A printable clinical summary of saved patient records. Formatting only:
//! no generated diagnoses, medication changes, or implied physician signature.
use crate::pdf_text::{
    add_unicode_pdf_fonts, pdf_text_save_options, unicode_pdf_font_face, unicode_show_text_op,
};
use printpdf::{
    Color, Mm, Op, PaintMode, PdfDocument, PdfFontHandle, PdfPage, Point, Pt, Rect, Rgb,
    WindingOrder,
};
use serde_json::Value;

const LEFT: f32 = 16.0;
const WIDTH: f32 = 178.0;
const BOTTOM: f32 = 22.0;

pub struct ClinicalReportContext {
    pub russian: bool,
    pub data: Value,
    pub printed_on: String,
    pub printed_by: String,
}

impl ClinicalReportContext {
    fn tx<'a>(&self, ru: &'a str, de: &'a str) -> &'a str {
        if self.russian { ru } else { de }
    }
}

#[derive(Default)]
struct Entry {
    title: String,
    lines: Vec<String>,
    source: Vec<String>,
}
struct Section {
    title: String,
    entries: Vec<Entry>,
}

fn value(row: &Value, key: &str) -> String {
    match &row[key] {
        Value::String(s) => s.trim().to_owned(),
        Value::Number(n) => n.to_string(),
        Value::Array(values) => values
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("; "),
        _ => String::new(),
    }
}
fn records<'a>(data: &'a Value, key: &str) -> &'a [Value] {
    data[key].as_array().map(Vec::as_slice).unwrap_or_default()
}
fn clean_note(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let line = line.trim();
            !(line.starts_with("[clinical-import:") && line.ends_with(']'))
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}
fn date(raw: &str) -> String {
    chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map(|d| d.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|_| raw.to_owned())
}
fn recorded_time(row: &Value, key: &str, precision: &str) -> String {
    let raw = value(row, key);
    if value(row, precision) == "date" {
        return date(raw.split('T').next().unwrap_or(&raw));
    }
    chrono::DateTime::parse_from_rfc3339(&raw)
        .map(|d| {
            d.with_timezone(&chrono_tz::Europe::Berlin)
                .format("%d.%m.%Y %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| date(&raw))
}
fn code(context: &ClinicalReportContext, raw: &str) -> String {
    let (ru, de) = match raw {
        "main" => ("Основной диагноз", "Hauptdiagnose"),
        "secondary" => ("Сопутствующий диагноз", "Nebendiagnose"),
        "prozedur" => ("Процедура", "Prozedur"),
        "verdacht" => ("Подозрение", "Verdacht"),
        "bestaetigt" => ("Подтверждено", "Bestätigt"),
        "zustand_nach" => ("Состояние после", "Zustand nach"),
        "akut" => ("Острый", "Akut"),
        "chronisch" | "chronic" => ("Хронический", "Chronisch"),
        "rezidivierend" => ("Рецидивирующий", "Rezidivierend"),
        "active" | "aktiv" => ("Активно", "Aktiv"),
        "resolved" => ("Завершён", "Abgeklungen"),
        "inactive" => ("Неактивно", "Inaktiv"),
        "historical" => ("В анамнезе", "Anamnestisch"),
        "completed" | "erfolg" => ("Выполнено", "Abgeschlossen"),
        "declined" => ("Отклонено", "Abgelehnt"),
        "cancelled" => ("Отменено", "Abgebrochen"),
        "superseded" => ("Заменено", "Ersetzt"),
        "nicht_erfolgt" => ("Не выполнено", "Nicht erfolgt"),
        "unbekannt" | "unknown" => ("Неизвестно", "Unbekannt"),
        "pending" => ("Ожидается результат", "Befund ausstehend"),
        "planned" => ("Запланировано", "Geplant"),
        "allergie" => ("Аллергия", "Allergie"),
        "cave" => ("CAVE", "CAVE"),
        "mild" => ("Лёгкая", "Leicht"),
        "moderate" => ("Умеренная", "Mittel"),
        "severe" => ("Тяжёлая", "Schwer"),
        "low" => ("Низкий", "Niedrig"),
        "normal" => ("Норма", "Normal"),
        "high" => ("Высокий", "Hoch"),
        "critical" => ("Критический", "Kritisch"),
        "abnormal" => ("Отклонение", "Auffällig"),
        "left" => ("Слева", "Links"),
        "right" => ("Справа", "Rechts"),
        "bilateral" => ("С обеих сторон", "Beidseits"),
        "dauer" => ("Постоянный приём", "Dauermedikation"),
        "besondere" => ("В особое время", "Zu besonderen Zeiten"),
        "selbst" => ("Самостоятельный приём", "Selbstmedikation"),
        _ => return raw.to_owned(),
    };
    context.tx(ru, de).to_owned()
}
fn field(lines: &mut Vec<String>, label: &str, raw: impl AsRef<str>) {
    let text = clean_note(raw.as_ref());
    if !text.is_empty() {
        lines.push(format!("{label}: {text}"));
    }
}
fn fields(
    context: &ClinicalReportContext,
    row: &Value,
    labels: &[(&str, &str, &str)],
) -> Vec<String> {
    let mut lines = Vec::new();
    for (key, ru, de) in labels {
        field(&mut lines, context.tx(ru, de), value(row, key));
    }
    lines
}
fn source(context: &ClinicalReportContext, row: &Value) -> Vec<String> {
    let mut result = Vec::new();
    let doctor = [value(row, "doctor_title"), value(row, "doctor_name")]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let attribution = [
        doctor,
        value(row, "doctor_fachbereich"),
        value(row, "provider_name"),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join(" | ");
    field(
        &mut result,
        context.tx("Врач / учреждение", "Arzt / Einrichtung"),
        attribution,
    );
    let external = [
        value(row, "external_doctor"),
        value(row, "external_clinic"),
        value(row, "external_country"),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join(" | ");
    field(
        &mut result,
        context.tx("Внешний источник", "Externe Quelle"),
        external,
    );
    let mut document = value(row, "source_document_name");
    let page = value(row, "source_page");
    if !document.is_empty() && !page.is_empty() {
        document.push_str(&format!(" · {} {page}", context.tx("стр.", "S.")));
    }
    field(&mut result, context.tx("Документ", "Dokument"), document);
    field(
        &mut result,
        context.tx("Дата анамнеза", "Anamnesedatum"),
        recorded_time(row, "anamnese_at", ""),
    );
    result
}
fn section(
    context: &ClinicalReportContext,
    sections: &mut Vec<Section>,
    ru: &str,
    de: &str,
    entries: Vec<Entry>,
) {
    if !entries.is_empty() {
        sections.push(Section {
            title: context.tx(ru, de).to_owned(),
            entries,
        });
    }
}

fn report_sections(context: &ClinicalReportContext) -> Vec<Section> {
    let data = &context.data;
    let mut sections = Vec::new();
    let mut warnings: Vec<_> = records(data, "warnings")
        .iter()
        .map(|row| Entry {
            title: format!(
                "{}: {}",
                code(context, &value(row, "kind")),
                value(row, "label")
            ),
            lines: {
                let mut lines = fields(
                    context,
                    row,
                    &[
                        ("reaction", "Реакция", "Reaktion"),
                        ("note", "Примечание", "Hinweis"),
                    ],
                );
                field(
                    &mut lines,
                    context.tx("Тяжесть", "Schweregrad"),
                    code(context, &value(row, "severity")),
                );
                lines
            },
            ..Entry::default()
        })
        .collect();
    let legacy_warning = value(&data["patient"], "clinical_warnings");
    if !legacy_warning.is_empty()
        && !records(data, "warnings")
            .iter()
            .any(|row| value(row, "kind") == "allergie")
    {
        warnings.push(Entry {
            lines: vec![legacy_warning],
            ..Entry::default()
        });
    }
    if warnings.is_empty() {
        warnings.push(Entry {
            lines: vec![
                context
                    .tx(
                        "Сведения не указаны в карточке.",
                        "Keine Angaben in der Patientenakte.",
                    )
                    .into(),
            ],
            ..Entry::default()
        });
    }
    section(
        context,
        &mut sections,
        "Аллергии и CAVE",
        "Allergien und CAVE",
        warnings,
    );

    let diagnoses = records(data, "diagnoses");
    section(
        context,
        &mut sections,
        "Диагнозы и связанные процедуры",
        "Diagnosen und zugehörige Prozeduren",
        diagnoses
            .iter()
            .map(|row| {
                let mut lines = fields(
                    context,
                    row,
                    &[
                        ("icd_code", "ICD", "ICD"),
                        ("ops_code", "OPS", "OPS"),
                        ("grade", "Степень / стадия", "Grad / Stadium"),
                        ("note", "Примечание", "Hinweis"),
                        ("red_flags", "Важные признаки", "Warnhinweise"),
                    ],
                );
                for (key, ru, de) in [
                    ("certainty", "Достоверность", "Diagnosesicherheit"),
                    ("status", "Статус", "Status"),
                    ("chronifizierung", "Течение", "Verlaufstyp"),
                    ("laterality", "Сторона", "Seite"),
                ] {
                    field(
                        &mut lines,
                        context.tx(ru, de),
                        code(context, &value(row, key)),
                    );
                }
                field(
                    &mut lines,
                    context.tx("Дата установления", "Diagnosedatum"),
                    date(&value(row, "diagnosed_on")),
                );
                let parent = value(row, "parent_id");
                if !parent.is_empty() {
                    if let Some(parent_row) =
                        diagnoses.iter().find(|item| value(item, "id") == parent)
                    {
                        field(
                            &mut lines,
                            context.tx("Связано с", "Zugeordnet zu"),
                            value(parent_row, "label"),
                        );
                    }
                }
                Entry {
                    title: format!(
                        "{}: {}",
                        code(context, &value(row, "kind")),
                        value(row, "label")
                    ),
                    lines,
                    source: source(context, row),
                }
            })
            .collect(),
    );

    let narrative = &data["narrative"];
    let mut history = Vec::new();
    for (key, ru, de) in [
        (
            "anamnese_aktuelle",
            "Актуальный анамнез",
            "Aktuelle Anamnese",
        ),
        (
            "anamnese_vorgeschichte",
            "Предшествующий анамнез",
            "Vorgeschichte",
        ),
        (
            "anamnese_vegetative",
            "Вегетативный анамнез",
            "Vegetative Anamnese",
        ),
        ("anamnese_sozial", "Социальный анамнез", "Sozialanamnese"),
        (
            "untersuchungsbefund",
            "Данные осмотра",
            "Untersuchungsbefund",
        ),
        ("red_flags", "Важные признаки", "Warnhinweise"),
    ] {
        let text = clean_note(&value(narrative, key));
        if !text.is_empty() {
            history.push(Entry {
                title: context.tx(ru, de).into(),
                lines: vec![text],
                source: source(context, narrative),
            });
        }
    }
    for row in records(narrative, "specializations") {
        let text = clean_note(&value(row, "narrative_text"));
        if !text.is_empty() {
            history.push(Entry {
                title: specialization_name(context, row),
                lines: vec![text],
                source: source(context, narrative),
            });
        }
    }
    section(
        context,
        &mut sections,
        "Анамнез и осмотр",
        "Anamnese und Untersuchung",
        history,
    );

    section(
        context,
        &mut sections,
        "Обследования и результаты",
        "Untersuchungen und Befunde",
        records(data, "examinations")
            .iter()
            .map(|row| {
                let mut lines = fields(
                    context,
                    row,
                    &[
                        ("result", "Результат", "Befund"),
                        ("note", "Примечание", "Hinweis"),
                        ("red_flags", "Важные признаки", "Warnhinweise"),
                    ],
                );
                field(
                    &mut lines,
                    context.tx("Дата", "Datum"),
                    date(&value(row, "performed_on")),
                );
                field(
                    &mut lines,
                    context.tx("Статус", "Status"),
                    code(context, &value(row, "status")),
                );
                Entry {
                    title: value(row, "title"),
                    lines,
                    source: source(context, row),
                }
            })
            .collect(),
    );

    section(
        context,
        &mut sections,
        "Проведённое лечение",
        "Durchgeführte Behandlung",
        records(data, "procedures")
            .iter()
            .map(|row| {
                let mut lines = fields(
                    context,
                    row,
                    &[
                        ("ops_code", "OPS", "OPS"),
                        ("note", "Примечание", "Hinweis"),
                    ],
                );
                field(
                    &mut lines,
                    context.tx("Дата", "Datum"),
                    date(&value(row, "performed_on")),
                );
                Entry {
                    title: value(row, "label"),
                    lines,
                    source: source(context, row),
                }
            })
            .collect(),
    );

    let mut follow_up: Vec<_> = records(data, "verlauf")
        .iter()
        .map(|row| Entry {
            title: date(&value(row, "occurred_on")),
            lines: vec![clean_note(&value(row, "note"))],
            source: source(context, row),
        })
        .collect();
    let legacy_follow_up = clean_note(&value(narrative, "verlauf"));
    if !legacy_follow_up.is_empty()
        && !follow_up
            .iter()
            .any(|entry| entry.lines.contains(&legacy_follow_up))
    {
        follow_up.push(Entry {
            lines: vec![legacy_follow_up],
            source: source(context, narrative),
            ..Entry::default()
        });
    }
    section(
        context,
        &mut sections,
        "Динамика и наблюдение",
        "Verlauf",
        follow_up,
    );

    let mut assessment = Vec::new();
    let text = clean_note(&value(narrative, "beurteilung"));
    if !text.is_empty() {
        assessment.push(Entry {
            lines: vec![text],
            source: source(context, narrative),
            ..Entry::default()
        });
    }
    for row in records(narrative, "specializations") {
        let text = clean_note(&value(row, "assessment_text"));
        if !text.is_empty() {
            assessment.push(Entry {
                title: specialization_name(context, row),
                lines: vec![text],
                source: source(context, narrative),
            });
        }
    }
    if assessment.is_empty() {
        assessment.push(Entry {
            lines: vec![
                context
                    .tx(
                        "Оценка врача не внесена в карточку.",
                        "Keine ärztliche Beurteilung in der Patientenakte hinterlegt.",
                    )
                    .into(),
            ],
            ..Entry::default()
        });
    }
    section(
        context,
        &mut sections,
        "Оценка и заключение врача",
        "Ärztliche Beurteilung",
        assessment,
    );

    section(
        context,
        &mut sections,
        "Рекомендации",
        "Empfehlungen",
        records(data, "recommendations")
            .iter()
            .map(|row| {
                let mut lines = fields(
                    context,
                    row,
                    &[
                        ("description", "Рекомендация", "Empfehlung"),
                        ("outcome_note", "Результат", "Ergebnis"),
                    ],
                );
                for (key, ru, de) in [
                    ("recommended_on", "Рекомендовано", "Empfohlen am"),
                    ("valid_from", "Действует с", "Gültig ab"),
                    ("valid_to", "Действует до", "Gültig bis"),
                    ("outcome_at", "Дата результата", "Ergebnisdatum"),
                ] {
                    field(&mut lines, context.tx(ru, de), date(&value(row, key)));
                }
                field(
                    &mut lines,
                    context.tx("Срок", "Termin"),
                    recorded_time(row, "due_at", ""),
                );
                field(
                    &mut lines,
                    context.tx("Выполнение", "Umsetzung"),
                    code(context, &value(row, "lifecycle_status")),
                );
                field(
                    &mut lines,
                    context.tx("Статус", "Status"),
                    code(context, &value(row, "status")),
                );
                Entry {
                    title: value(row, "title"),
                    lines,
                    source: source(context, row),
                }
            })
            .collect(),
    );

    let mut medications = records(data, "medications")
        .iter()
        .map(|row| {
            let mut lines = fields(
                context,
                row,
                &[
                    ("wirkstoff", "Действующее вещество", "Wirkstoff"),
                    ("staerke", "Дозировка", "Stärke"),
                    ("form", "Форма", "Darreichungsform"),
                    ("einnahmeform", "Способ применения", "Anwendung"),
                    ("einheit", "Единица", "Einheit"),
                    ("hinweis", "Указания", "Hinweise"),
                    ("grund", "Показание", "Grund"),
                    ("sonstige_vermerke", "Примечание", "Weitere Hinweise"),
                ],
            );
            let doses = [
                ("dose_morgens", "Утро", "Morgens"),
                ("dose_mittags", "День", "Mittags"),
                ("dose_abends", "Вечер", "Abends"),
                ("dose_nachts", "Ночь", "Zur Nacht"),
            ]
            .into_iter()
            .map(|(key, ru, de)| {
                let dose = value(row, key);
                format!(
                    "{}: {}",
                    context.tx(ru, de),
                    if dose.is_empty() { "-" } else { &dose }
                )
            })
            .collect::<Vec<_>>()
            .join(" | ");
            lines.insert(0, doses);
            for (key, ru, de) in [
                ("einnahme_von", "Приём с", "Einnahme ab"),
                ("einnahme_bis", "Приём до", "Einnahme bis"),
            ] {
                field(&mut lines, context.tx(ru, de), date(&value(row, key)));
            }
            field(
                &mut lines,
                context.tx("Категория", "Kategorie"),
                code(context, &value(row, "category")),
            );
            let name = value(row, "handelsname");
            Entry {
                title: if name.is_empty() {
                    value(row, "wirkstoff")
                } else {
                    name
                },
                lines,
                source: source(context, row),
            }
        })
        .collect::<Vec<_>>();
    if medications.is_empty() {
        medications.push(Entry {
            lines: vec![
                context
                    .tx(
                        "Актуальные назначения не указаны.",
                        "Keine aktuellen Verordnungen hinterlegt.",
                    )
                    .into(),
            ],
            ..Entry::default()
        });
    }
    section(
        context,
        &mut sections,
        "Актуальная медикация",
        "Aktuelle Medikation",
        medications,
    );

    section(
        context,
        &mut sections,
        "Последние витальные показатели",
        "Letzte Vitalparameter",
        records(data, "vitals")
            .iter()
            .map(|row| Entry {
                title: recorded_time(row, "measured_at", "measured_at_precision"),
                lines: fields(
                    context,
                    row,
                    &[
                        (
                            "bp_systolic",
                            "Систолическое АД, мм рт. ст.",
                            "Systolischer Blutdruck, mmHg",
                        ),
                        (
                            "bp_diastolic",
                            "Диастолическое АД, мм рт. ст.",
                            "Diastolischer Blutdruck, mmHg",
                        ),
                        ("heart_rate", "Пульс, /мин", "Puls, /min"),
                        ("temperature_c", "Температура, °C", "Temperatur, °C"),
                        ("oxygen_saturation", "SpO2, %", "SpO2, %"),
                        (
                            "respiratory_rate",
                            "Частота дыхания, /мин",
                            "Atemfrequenz, /min",
                        ),
                        ("weight_kg", "Масса, кг", "Gewicht, kg"),
                        ("height_cm", "Рост, см", "Größe, cm"),
                        ("bmi", "ИМТ, кг/м²", "BMI, kg/m²"),
                        ("notes", "Примечание", "Hinweis"),
                    ],
                ),
                source: source(context, row),
            })
            .collect(),
    );

    section(
        context,
        &mut sections,
        "Лабораторные результаты",
        "Laborbefunde",
        records(data, "labs")
            .iter()
            .map(|row| {
                let mut lines = fields(
                    context,
                    row,
                    &[
                        ("result_text", "Результат", "Ergebnis"),
                        ("unit", "Единица", "Einheit"),
                        ("reference_text", "Референсный интервал", "Referenzbereich"),
                        ("panel", "Панель", "Panel"),
                        ("laboratory_name", "Лаборатория", "Labor"),
                        ("interpretation_note", "Комментарий", "Kommentar"),
                    ],
                );
                if value(row, "result_text").is_empty() {
                    field(
                        &mut lines,
                        context.tx("Результат", "Ergebnis"),
                        format!(
                            "{} {}",
                            value(row, "comparator"),
                            value(row, "numeric_result")
                        )
                        .trim(),
                    );
                }
                if value(row, "reference_text").is_empty() {
                    field(
                        &mut lines,
                        context.tx("Нижняя граница", "Untere Grenze"),
                        value(row, "reference_low"),
                    );
                    field(
                        &mut lines,
                        context.tx("Верхняя граница", "Obere Grenze"),
                        value(row, "reference_high"),
                    );
                }
                field(
                    &mut lines,
                    context.tx("Дата", "Datum"),
                    recorded_time(row, "measured_at", "measured_at_precision"),
                );
                field(
                    &mut lines,
                    context.tx("Отметка лаборатории", "Laborkennzeichnung"),
                    code(context, &value(row, "abnormal_flag")),
                );
                Entry {
                    title: value(row, "analyte_name"),
                    lines,
                    source: source(context, row),
                }
            })
            .collect(),
    );
    let vaccination = value(&data["impfstatus"], "status_text");
    if !vaccination.is_empty() {
        section(
            context,
            &mut sections,
            "Прививочный статус",
            "Impfstatus",
            vec![Entry {
                lines: vec![vaccination],
                ..Entry::default()
            }],
        );
    }
    sections
}

fn specialization_name(context: &ClinicalReportContext, row: &Value) -> String {
    [
        if context.russian {
            "name_ru"
        } else {
            "name_de"
        },
        "name_de",
        "code",
    ]
    .iter()
    .map(|key| value(row, key))
    .find(|s| !s.is_empty())
    .unwrap_or_default()
}

fn color(r: f32, g: f32, b: f32) -> Color {
    Color::Rgb(Rgb::new(r, g, b, None))
}
struct Layout<'a> {
    context: &'a ClinicalReportContext,
    regular: PdfFontHandle,
    bold: PdfFontHandle,
    metrics: [ttf_parser::Face<'static>; 2],
    ops: Vec<Op>,
    pages: Vec<PdfPage>,
    y: f32,
    current_section: String,
}

impl Layout<'_> {
    fn width(&self, text: &str, size: f32, bold: bool) -> f32 {
        let face = &self.metrics[usize::from(bold)];
        let units: f32 = text
            .chars()
            .map(|c| {
                face.glyph_index(c)
                    .and_then(|g| face.glyph_hor_advance(g))
                    .unwrap_or(face.units_per_em()) as f32
            })
            .sum();
        units / face.units_per_em() as f32 * size * 25.4 / 72.0
    }
    fn wrap(&self, text: &str, size: f32, width: f32, bold: bool) -> Vec<String> {
        let mut lines = Vec::new();
        for paragraph in text.trim().lines() {
            let mut current = String::new();
            for word in paragraph.split_whitespace() {
                let candidate = if current.is_empty() {
                    word.to_owned()
                } else {
                    format!("{current} {word}")
                };
                if self.width(&candidate, size, bold) <= width {
                    current = candidate;
                    continue;
                }
                if !current.is_empty() {
                    lines.push(std::mem::take(&mut current));
                }
                for c in word.chars() {
                    let next = format!("{current}{c}");
                    if !current.is_empty() && self.width(&next, size, bold) > width {
                        lines.push(std::mem::take(&mut current));
                    }
                    current.push(c);
                }
            }
            lines.push(current);
        }
        lines
    }
    fn text(&mut self, x: f32, y: f32, text: &str, size: f32, bold: bool, muted: bool) {
        if text.is_empty() {
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
            Op::SetFillColor {
                col: if muted {
                    color(0.38, 0.39, 0.41)
                } else {
                    color(0.08, 0.09, 0.10)
                },
            },
            unicode_show_text_op(text),
            Op::EndTextSection,
        ]);
    }
    fn rect(&mut self, x: f32, y: f32, width: f32, height: f32, col: Color) {
        self.ops.push(Op::SetFillColor { col });
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
    fn header(&mut self) -> Result<(), &'static str> {
        self.rect(LEFT, 282.0, WIDTH, 0.8, color(1.0, 0.43, 0.06));
        self.text(
            LEFT,
            274.0,
            self.context.tx("Врачебное заключение", "Arztbrief"),
            17.0,
            true,
            false,
        );
        self.text(180.0, 274.0, "GMED", 10.0, true, false);
        let patient = &self.context.data["patient"];
        let name = format!(
            "{} {}",
            value(patient, "first_name"),
            value(patient, "last_name")
        )
        .trim()
        .to_owned();
        let identifier = value(patient, "patient_id");
        let birth = date(&value(patient, "birth_date"));
        let meta = format!(
            "{}: {}\n{}: {} | ID: {}\n{}: {} | {}: {}",
            self.context.tx("Пациент", "Patient"),
            if name.is_empty() { "-" } else { &name },
            self.context.tx("Дата рождения", "Geburtsdatum"),
            if birth.is_empty() { "-" } else { &birth },
            if identifier.is_empty() {
                "-"
            } else {
                &identifier
            },
            self.context.tx("Сформировано", "Stand"),
            self.context.printed_on,
            self.context.tx("Сформировал", "Erstellt von"),
            self.context.printed_by
        );
        self.y = 266.0;
        let lines = self.wrap(&meta, 9.0, WIDTH, false);
        if lines.len() > 25 {
            return Err("Clinical PDF patient header is too large");
        }
        for line in lines {
            self.text(LEFT, self.y, &line, 9.0, false, false);
            self.y -= 4.3;
        }
        self.y -= 3.0;
        Ok(())
    }
    fn new_page(&mut self) -> Result<(), &'static str> {
        self.pages.push(PdfPage::new(
            Mm(210.0),
            Mm(297.0),
            std::mem::take(&mut self.ops),
        ));
        self.header()?;
        if !self.current_section.is_empty() {
            let title = format!(
                "{} ({})",
                self.current_section,
                self.context.tx("продолжение", "Fortsetzung")
            );
            self.section_heading(&title);
        }
        Ok(())
    }
    fn ensure(&mut self, height: f32) -> Result<(), &'static str> {
        if self.y - height < BOTTOM {
            self.new_page()?;
        }
        Ok(())
    }
    fn section_heading(&mut self, title: &str) {
        self.rect(LEFT, self.y - 6.0, WIDTH, 8.0, color(0.97, 0.97, 0.97));
        self.rect(LEFT, self.y - 6.0, 0.8, 8.0, color(1.0, 0.43, 0.06));
        self.text(LEFT + 3.0, self.y - 3.0, title, 10.5, true, false);
        self.y -= 12.0;
    }
    fn paragraph(
        &mut self,
        text: &str,
        size: f32,
        bold: bool,
        muted: bool,
    ) -> Result<(), &'static str> {
        for line in self.wrap(text, size, WIDTH - 6.0, bold) {
            self.ensure(5.0)?;
            self.text(LEFT + 3.0, self.y, &line, size, bold, muted);
            self.y -= if muted { 4.1 } else { 4.8 };
        }
        Ok(())
    }
    fn section(&mut self, section: Section) -> Result<(), &'static str> {
        self.current_section.clear();
        self.ensure(30.0)?;
        self.current_section = section.title.clone();
        self.section_heading(&section.title);
        for entry in section.entries {
            let title_height = self.wrap(&entry.title, 10.5, WIDTH - 6.0, true).len() as f32 * 4.8;
            self.ensure((title_height + 5.0).clamp(14.0, 50.0))?;
            if !entry.title.is_empty() {
                self.paragraph(&entry.title, 10.5, true, false)?;
            }
            for line in entry.lines {
                self.paragraph(&line, 10.0, false, false)?;
            }
            for line in entry.source {
                self.paragraph(&line, 8.3, false, true)?;
            }
            self.y -= 3.0;
        }
        self.y -= 2.0;
        Ok(())
    }
    fn finish(mut self) -> Vec<PdfPage> {
        self.pages.push(PdfPage::new(
            Mm(210.0),
            Mm(297.0),
            std::mem::take(&mut self.ops),
        ));
        let count = self.pages.len();
        for index in 0..count {
            self.rect(LEFT, 17.0, WIDTH, 0.2, color(0.86, 0.87, 0.88));
            self.text(
                LEFT,
                12.0,
                self.context.tx(
                    "Сводка сохранённых данных пациента",
                    "Zusammenfassung der gespeicherten Patientendaten",
                ),
                7.5,
                false,
                true,
            );
            let page = format!(
                "{} {} / {count}",
                self.context.tx("Страница", "Seite"),
                index + 1
            );
            self.text(
                194.0 - self.width(&page, 8.0, false),
                12.0,
                &page,
                8.0,
                false,
                true,
            );
            self.pages[index].ops.append(&mut self.ops);
        }
        self.pages
    }
}

pub fn build_clinical_report_pdf(context: &ClinicalReportContext) -> Result<Vec<u8>, &'static str> {
    let mut document = PdfDocument::new(context.tx("Врачебное заключение", "Arztbrief"));
    let (regular, bold) = add_unicode_pdf_fonts(&mut document)?;
    let mut layout = Layout {
        context,
        regular,
        bold,
        metrics: [unicode_pdf_font_face(false)?, unicode_pdf_font_face(true)?],
        ops: Vec::new(),
        pages: Vec::new(),
        y: 0.0,
        current_section: String::new(),
    };
    layout.header()?;
    for section in report_sections(context) {
        layout.section(section)?;
    }
    Ok(document
        .with_pages(layout.finish())
        .save(&pdf_text_save_options(), &mut Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn example(russian: bool) -> ClinicalReportContext {
        ClinicalReportContext {
            russian,
            printed_on: "06.09.2026 15:00".into(),
            printed_by: "GMED DEMO".into(),
            data: json!({
                "patient": {"first_name":"Anna / Анна", "last_name":"Beispiel", "birth_date":"1974-03-12", "patient_id":"P-DEMO-0042"},
                "warnings":[{"kind":"allergie", "label":"Penicillin - DEMO", "reaction":"Hautausschlag / Висип", "severity":"moderate"}],
                "diagnoses":[
                    {"id":"main-1", "kind":"main", "label":"Klinischer Befund - DEMO", "certainty":"verdacht", "status":"active", "diagnosed_on":"2026-09-01", "note":"Опис збережений лікарем.\nДругий абзац.", "source_document_name":"Befund-DEMO.pdf", "doctor_name":"Erika Beispiel", "doctor_title":"Dr. med."},
                    {"id":"child-1", "parent_id":"main-1", "kind":"prozedur", "label":"Kontrolluntersuchung - DEMO", "ops_code":"DEMO-OPS", "status":"completed"},
                    {"id":"unknown-1", "kind":"custom", "label":"Zusätzlicher Eintrag", "status":"resolved"}
                ],
                "narrative":{"anamnese_aktuelle":"Gespeicherte Angaben zum aktuellen Anlass.\nЗбережений опис скарг.", "specializations":[{"name_ru":"Кардиология", "name_de":"Kardiologie", "narrative_text":"Fachspezifische Anamnese - DEMO", "assessment_text":"Fachspezifische Beurteilung - DEMO"}], "source_document_name":"Anamnese-DEMO.pdf"},
                "examinations":[{"title":"Befundbesprechung - DEMO", "performed_on":"2026-09", "status":"pending", "result":"Ergebnistext aus der Akte."}],
                "procedures":[{"label":"Dokumentierte Behandlung - DEMO", "performed_on":"2026", "note":"Vollständige gespeicherte Therapienotiz."}],
                "recommendations":[{"title":"Gespeicherte Empfehlung - DEMO", "description":"Beschreibung aus der Akte.", "lifecycle_status":"erfolg", "status":"completed", "note_intern":"PRIVATE_INTERNAL_NOTE_NEVER_EXPORT"}],
                "medications":[{"category":"besondere", "handelsname":"Präparat - DEMO", "wirkstoff":"Wirkstoff - DEMO", "staerke":"5 mg", "dose_morgens":"1/2", "einheit":"Tablette", "hinweis":"Nur die gespeicherte Einnahmeanweisung.", "grund":"Dokumentierter Grund"}],
                "vitals":[{"measured_at":"2026-09-05T22:00:00Z", "measured_at_precision":"date", "heart_rate":72}],
                "labs":[{"analyte_name":"Laborwert - DEMO", "result_text":"<0,5", "unit":"mg/l", "reference_text":"0-5", "abnormal_flag":"normal", "measured_at":"2026-09-01T10:30:00Z", "source_document_name":"Labor-DEMO.pdf"}],
                "impfstatus":{"status_text":"Impfstatus gemäß Akte - DEMO"}
            }),
        }
    }

    #[test]
    fn clinical_report_preserves_records_and_localizes_labels() {
        for russian in [false, true] {
            let context = example(russian);
            let bytes = build_clinical_report_pdf(&context).unwrap();
            let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
            for expected in [
                "Анна",
                "P-DEMO-0042",
                "Hautausschlag / Висип",
                "Другий абзац.",
                "DEMO-OPS",
                "Zusätzlicher Eintrag",
                "Fachspezifische Anamnese - DEMO",
                "Fachspezifische Beurteilung - DEMO",
                "Vollständige gespeicherte Therapienotiz.",
                "Befund-DEMO.pdf",
                "Erika Beispiel",
                "Nur die gespeicherte Einnahmeanweisung.",
                "<0,5",
                "Impfstatus gemäß Akte - DEMO",
            ] {
                assert!(text.contains(expected), "Missing {expected}");
            }
            assert!(text.contains(context.tx("Врачебное заключение", "Arztbrief")));
            assert!(text.contains(context.tx("Подозрение", "Verdacht")));
            assert!(text.contains(context.tx("День: -", "Mittags: -")));
            assert!(!text.contains("PRIVATE_INTERNAL_NOTE_NEVER_EXPORT"));
            assert!(!text.contains("1/2-0-0-0"));
            if let Ok(dir) = std::env::var("GMED_CLINICAL_PDF_QA_DIR") {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(
                    std::path::Path::new(&dir).join(if russian {
                        "clinical-report-ru.pdf"
                    } else {
                        "clinical-report-de.pdf"
                    }),
                    &bytes,
                )
                .unwrap();
            }
        }
    }

    #[test]
    fn clinical_report_retains_legacy_follow_up_once() {
        let mut context = example(false);
        context.data["patient"]["clinical_warnings"] = json!("Penicillin - DEMO");
        context.data["narrative"]["verlauf"] = json!("LEGACY_FOLLOW_UP");
        context.data["narrative"]["anamnese_at"] = json!("2026-09-01T12:00:00Z");
        for rows in [
            json!([]),
            json!([{"note":"LEGACY_FOLLOW_UP", "occurred_on":"2026-09-01"}]),
        ] {
            context.data["verlauf"] = rows;
            let bytes = build_clinical_report_pdf(&context).unwrap();
            let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
            assert_eq!(text.matches("LEGACY_FOLLOW_UP").count(), 1);
            assert_eq!(text.matches("Penicillin - DEMO").count(), 1);
            assert!(text.contains("Anamnesedatum: 01.09.2026 14:00"));
        }
    }

    #[test]
    fn clinical_report_paginates_long_unicode_records_without_loss() {
        let mut context = example(true);
        let unbroken = "Ж".repeat(700);
        context.data["narrative"]["beurteilung"] = json!(format!(
            "{}\n{}\nEND_OF_LONG_ASSESSMENT",
            "Довгий текст висновку без скорочень. ".repeat(750),
            unbroken
        ));
        let bytes = build_clinical_report_pdf(&context).unwrap();
        let pages = pdf_extract::extract_text_from_mem_by_pages(&bytes).unwrap();
        assert!(pages.len() > 4);
        for page in &pages {
            assert!(page.contains("P-DEMO-0042"));
            assert!(page.contains("Страница"));
        }
        let text = pages.join("\n");
        // Headers interrupt sentences at page breaks, so count individual
        // words as well as the unbroken Unicode token after PDF extraction.
        for word in ["Довгий", "текст", "висновку", "без", "скорочень."]
        {
            assert_eq!(
                text.split_whitespace()
                    .filter(|token| *token == word)
                    .count(),
                750
            );
        }
        assert_eq!(text.chars().filter(|ch| *ch == 'Ж').count(), 700);
        assert!(text.contains("END_OF_LONG_ASSESSMENT"));
        assert!(text.contains("Laborwert - DEMO"));
        if let Ok(path) = std::env::var("GMED_CLINICAL_PDF_STRESS_PATH") {
            std::fs::write(path, bytes).unwrap();
        }
    }

    #[test]
    fn clinical_report_wraps_exact_font_width_and_rejects_unbounded_header() {
        let mut context = example(true);
        let mut doc = PdfDocument::new("test");
        let (regular, bold) = add_unicode_pdf_fonts(&mut doc).unwrap();
        {
            let layout = Layout {
                context: &context,
                regular,
                bold,
                metrics: [
                    unicode_pdf_font_face(false).unwrap(),
                    unicode_pdf_font_face(true).unwrap(),
                ],
                ops: Vec::new(),
                pages: Vec::new(),
                y: 0.0,
                current_section: String::new(),
            };
            for line in layout.wrap(
                &format!("{}\n\nSecond paragraph", "ШирокийТекст".repeat(100)),
                10.5,
                172.0,
                false,
            ) {
                assert!(layout.width(&line, 10.5, false) <= 172.01);
            }
        }
        context.data["patient"]["first_name"] = json!("Дуже довге ім'я ".repeat(700));
        assert!(build_clinical_report_pdf(&context).is_err());
    }
}
