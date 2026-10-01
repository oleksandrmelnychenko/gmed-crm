//! Signature places read from the PDF itself.
//!
//! The document generators record where each party signs. A document generated
//! before they did has no record, so its signers would have to place their
//! signature by hand. For those documents the places are found in the page
//! text, in the two shapes the generators draw:
//!
//! * a caption `Unterschrift …` under a signature rule (contracts, orders, cost
//!   estimates): the frame sits on the rule;
//! * `Unterschrift: ______` on one line (consents, releases, the EDD sheet): the
//!   frame covers the underline.
//!
//! Any other mention of the word is ignored, so body text never gets a frame.
use pdf_extract::{MediaBox, OutputDev, OutputError, Path, PathOp, Transform};

use crate::routes::documents::SignatureAnchor;

const PT_PER_MM: f64 = 72.0 / 25.4;
/// Glyphs whose baselines differ by less than this are one line of text.
const SAME_LINE_PT: f64 = 1.5;
/// A filled bar thinner than this is a rule, not a box.
const RULE_MAX_HEIGHT_PT: f64 = 1.5;
const RULE_MIN_WIDTH_PT: f64 = 60.0;
/// How far above its caption a signature rule may be.
const RULE_ABOVE_CAPTION_MAX_MM: f64 = 25.0;
const RULE_CAPTION_X_TOLERANCE_MM: f64 = 3.0;
const FRAME_MAX_WIDTH_MM: f64 = 60.0;
const RULE_FRAME_HEIGHT_MM: f64 = 10.5;
const UNDERLINE_FRAME_MIN_WIDTH_MM: f64 = 30.0;
const UNDERLINE_FRAME_HEIGHT_MM: f64 = 8.0;
const KEYWORD: &str = "Unterschrift";

struct Glyph {
    x: f64,
    y: f64,
    end: f64,
    size: f64,
    text: String,
}

struct Rule {
    x: f64,
    y: f64,
    width: f64,
}

#[derive(Default)]
struct Page {
    glyphs: Vec<Glyph>,
    rules: Vec<Rule>,
}

#[derive(Default)]
struct Collector {
    pages: Vec<Page>,
}

impl Collector {
    fn page(&mut self) -> Option<&mut Page> {
        self.pages.last_mut()
    }
}

impl OutputDev for Collector {
    fn begin_page(
        &mut self,
        page_num: u32,
        _media_box: &MediaBox,
        _art_box: Option<(f64, f64, f64, f64)>,
    ) -> Result<(), OutputError> {
        // Pages arrive in order, numbered from 1; keep the index equal to the
        // zero-based page number even if one is skipped.
        while self.pages.len() < page_num.max(1) as usize {
            self.pages.push(Page::default());
        }
        Ok(())
    }

    fn end_page(&mut self) -> Result<(), OutputError> {
        Ok(())
    }

    fn output_character(
        &mut self,
        trm: &Transform,
        width: f64,
        _spacing: f64,
        font_size: f64,
        char: &str,
    ) -> Result<(), OutputError> {
        let scale = (trm.m11 * trm.m22 - trm.m12 * trm.m21).abs().sqrt();
        let size = font_size * scale;
        let glyph = Glyph {
            x: trm.m31,
            y: trm.m32,
            end: trm.m31 + width * size,
            size,
            text: char.to_string(),
        };
        if let Some(page) = self.page() {
            page.glyphs.push(glyph);
        }
        Ok(())
    }

    fn begin_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }

    fn end_word(&mut self) -> Result<(), OutputError> {
        Ok(())
    }

    fn end_line(&mut self) -> Result<(), OutputError> {
        Ok(())
    }

    fn fill(
        &mut self,
        ctm: &Transform,
        _colorspace: &pdf_extract::ColorSpace,
        _color: &[f64],
        path: &Path,
    ) -> Result<(), OutputError> {
        let mut points = Vec::new();
        for op in &path.ops {
            match *op {
                PathOp::MoveTo(x, y) | PathOp::LineTo(x, y) => points.push((x, y)),
                PathOp::Rect(x, y, width, height) => {
                    points.push((x, y));
                    points.push((x + width, y + height));
                }
                // A rule has no curves.
                PathOp::CurveTo(..) => return Ok(()),
                PathOp::Close => {}
            }
        }
        let (mut left, mut bottom) = (f64::MAX, f64::MAX);
        let (mut right, mut top) = (f64::MIN, f64::MIN);
        for (x, y) in points {
            let px = x * ctm.m11 + y * ctm.m21 + ctm.m31;
            let py = x * ctm.m12 + y * ctm.m22 + ctm.m32;
            left = left.min(px);
            right = right.max(px);
            bottom = bottom.min(py);
            top = top.max(py);
        }
        if right - left >= RULE_MIN_WIDTH_PT
            && top - bottom <= RULE_MAX_HEIGHT_PT
            && let Some(page) = self.page()
        {
            page.rules.push(Rule {
                x: left,
                y: top,
                width: right - left,
            });
        }
        Ok(())
    }
}

/// One line of page text with the glyph each character came from.
struct Line<'a> {
    text: String,
    /// Glyph of every byte of `text`; `None` for a space added between words.
    owners: Vec<Option<&'a Glyph>>,
    y: f64,
}

impl<'a> Line<'a> {
    fn glyph_at(&self, byte: usize) -> Option<&'a Glyph> {
        self.owners.get(byte).copied().flatten()
    }
}

fn lines(page: &Page) -> Vec<Line<'_>> {
    let mut glyphs: Vec<&Glyph> = page.glyphs.iter().collect();
    glyphs.sort_by(|a, b| b.y.total_cmp(&a.y).then(a.x.total_cmp(&b.x)));
    let mut rows: Vec<Vec<&Glyph>> = Vec::new();
    for glyph in glyphs {
        match rows.last_mut() {
            Some(row) if (row[0].y - glyph.y).abs() <= SAME_LINE_PT => row.push(glyph),
            _ => rows.push(vec![glyph]),
        }
    }
    rows.into_iter()
        .map(|mut row| {
            row.sort_by(|a, b| a.x.total_cmp(&b.x));
            let mut line = Line {
                text: String::new(),
                owners: Vec::new(),
                y: row[0].y,
            };
            let mut last_end = None::<f64>;
            for glyph in row {
                if let Some(end) = last_end
                    && glyph.x - end > glyph.size * 0.2
                    && !line.text.ends_with(' ')
                {
                    line.text.push(' ');
                    line.owners.push(None);
                }
                line.text.push_str(&glyph.text);
                line.owners
                    .extend(std::iter::repeat_n(Some(glyph), glyph.text.len()));
                last_end = Some(glyph.end);
            }
            line
        })
        .collect()
}

fn mm(points: f64) -> f32 {
    (points / PT_PER_MM) as f32
}

/// How far below a line its wrapped rest or the signer's caption may stand.
const NEXT_LINE_MAX_MM: f64 = 9.0;

/// The underline that follows `Unterschrift:`: on the same line, or at the
/// start of the next one when the line was wrapped. Returns the line that
/// holds the underline, where it starts and how long it is.
fn underline_after(
    lines: &[Line<'_>],
    line_index: usize,
    after_keyword: usize,
) -> Option<(usize, usize, usize)> {
    let line = &lines[line_index];
    let after_colon = line.text[after_keyword..]
        .trim_start()
        .strip_prefix(':')?
        .trim_start();
    let run = |text: &str| text.len() - text.trim_start_matches('_').len();
    if after_colon.is_empty() {
        let next = lines.get(line_index + 1)?;
        let length = run(&next.text);
        return (line.y - next.y <= NEXT_LINE_MAX_MM * PT_PER_MM && length >= 3).then_some((
            line_index + 1,
            0,
            length,
        ));
    }
    let length = run(after_colon);
    (length >= 3).then_some((line_index, line.text.len() - after_colon.len(), length))
}

/// Who signs on an underline: named in brackets after it or in the caption
/// below it; the reviewer of the EDD sheet signs for the agency.
fn underline_role(lines: &[Line<'_>], holder: usize, tail: &str, before: &str) -> &'static str {
    let named = |text: &str| {
        if text.contains("Personensorgeberechtigte/r 2") {
            Some("guardian_2")
        } else if text.contains("Personensorgeberechtigte") || text.contains("ges. Vertreter") {
            Some("guardian_1")
        } else {
            None
        }
    };
    if before.contains("Bearbeiter") {
        return "agency";
    }
    let below = lines[holder + 1..]
        .iter()
        .take_while(|line| {
            lines[holder].y - line.y <= NEXT_LINE_MAX_MM * PT_PER_MM && !line.text.contains(KEYWORD)
        })
        .find_map(|line| named(&line.text));
    named(tail).or(below).unwrap_or("client")
}

/// The signature places of a generated PDF, read from its text. Empty when the
/// PDF has none or cannot be read.
pub(crate) fn detect_signature_anchors(pdf: &[u8]) -> Vec<SignatureAnchor> {
    let collected = std::panic::catch_unwind(|| {
        let document = pdf_extract::Document::load_mem(pdf).ok()?;
        let mut collector = Collector::default();
        pdf_extract::output_doc(&document, &mut collector).ok()?;
        Some(collector)
    });
    let Ok(Some(collector)) = collected else {
        return Vec::new();
    };

    let mut anchors: Vec<SignatureAnchor> = Vec::new();
    for (page_index, page) in collector.pages.iter().enumerate() {
        let lines = lines(page);
        for (line_index, line) in lines.iter().enumerate() {
            for (at, _) in line.text.match_indices(KEYWORD) {
                let Some(first) = line.glyph_at(at) else {
                    continue;
                };
                let after_keyword = at + KEYWORD.len();
                let (role, x, y, width, height) = if let Some((holder, start, length)) =
                    underline_after(&lines, line_index, after_keyword)
                {
                    let underline = &lines[holder];
                    let (Some(first), Some(last)) = (
                        underline.glyph_at(start),
                        underline.glyph_at(start + length - 1),
                    ) else {
                        continue;
                    };
                    (
                        underline_role(
                            &lines,
                            holder,
                            &underline.text[start + length..],
                            &line.text[..at],
                        ),
                        first.x,
                        underline.y - PT_PER_MM,
                        (last.end - first.x).clamp(
                            UNDERLINE_FRAME_MIN_WIDTH_MM * PT_PER_MM,
                            FRAME_MAX_WIDTH_MM * PT_PER_MM,
                        ),
                        UNDERLINE_FRAME_HEIGHT_MM * PT_PER_MM,
                    )
                } else {
                    // A caption under a signature rule.
                    let Some(rule) = page
                        .rules
                        .iter()
                        .filter(|rule| {
                            rule.y > line.y
                                && rule.y - line.y <= RULE_ABOVE_CAPTION_MAX_MM * PT_PER_MM
                                && (rule.x - first.x).abs()
                                    <= RULE_CAPTION_X_TOLERANCE_MM * PT_PER_MM
                        })
                        .min_by(|a, b| a.y.total_cmp(&b.y))
                    else {
                        continue;
                    };
                    let caption = &line.text[after_keyword..];
                    let end = caption.find(KEYWORD).unwrap_or(caption.len());
                    let role = if caption[..end].contains("Stempel")
                        || caption[..end].contains("Auftragnehmer")
                    {
                        "agency"
                    } else {
                        "client"
                    };
                    (
                        role,
                        rule.x,
                        rule.y + 0.5 * PT_PER_MM,
                        rule.width.min(FRAME_MAX_WIDTH_MM * PT_PER_MM),
                        RULE_FRAME_HEIGHT_MM * PT_PER_MM,
                    )
                };
                let anchor = SignatureAnchor {
                    role: role.to_string(),
                    page: page_index,
                    x_mm: mm(x),
                    y_mm: mm(y),
                    width_mm: mm(width),
                    height_mm: mm(height),
                };
                let duplicate = anchors.iter().any(|known| {
                    known.page == anchor.page
                        && (known.x_mm - anchor.x_mm).abs() < 1.0
                        && (known.y_mm - anchor.y_mm).abs() < 1.0
                });
                if !duplicate {
                    anchors.push(anchor);
                }
            }
        }
    }
    anchors
}
