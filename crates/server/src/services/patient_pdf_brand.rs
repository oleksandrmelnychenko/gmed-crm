//! Shared company letterhead used by PDFs exported from the patient workspace.
//!
//! Lead documents use the same orange rules, vector GMED wordmark and agency
//! identity footer. Keeping the chrome here prevents the portrait clinical
//! report and landscape medication plan from drifting apart again.

use printpdf::{Color, Mm, Op, PaintMode, PdfFontHandle, Point, Pt, Rect, Rgb, WindingOrder};

use crate::pdf_text::unicode_show_text_op;

#[derive(Clone, Debug, Default)]
pub struct PatientPdfBrand {
    pub name: String,
    pub responsible_person: String,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub website: Option<String>,
}

fn normalized_responsible_person(value: &str) -> &str {
    let value = value.trim();
    value
        .strip_prefix("c/o")
        .or_else(|| value.strip_prefix("C/O"))
        .unwrap_or(value)
        .trim_start_matches(|character: char| {
            character.is_whitespace() || matches!(character, '-' | '/' | ':' | '·')
        })
}

fn normalize_single_line(value: &str) -> String {
    value
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" — ")
}

fn website_display(value: &str) -> &str {
    value
        .trim()
        .strip_prefix("https://")
        .or_else(|| value.trim().strip_prefix("http://"))
        .unwrap_or(value.trim())
        .trim_end_matches('/')
}

impl PatientPdfBrand {
    fn identity_line(&self) -> String {
        let name = self.name.trim();
        let person = normalized_responsible_person(&self.responsible_person);
        if person.is_empty() || name.to_lowercase().contains(&person.to_lowercase()) {
            name.to_string()
        } else {
            format!("{name} {person}")
        }
    }

    fn footer_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();
        let identity = self.identity_line();
        if !identity.is_empty() {
            lines.push(identity);
        }
        if let Some(address) = self.address.as_deref() {
            let address = normalize_single_line(address);
            if !address.is_empty() {
                lines.push(address);
            }
        }
        let mut contacts = Vec::new();
        if let Some(phone) = self
            .phone
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            contacts.push(format!("Tel.: {phone}"));
        }
        if let Some(email) = self
            .email
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            contacts.push(format!("E-Mail: {email}"));
        }
        if let Some(website) = self
            .website
            .as_deref()
            .map(website_display)
            .filter(|v| !v.is_empty())
        {
            contacts.push(format!("Web: {website}"));
        }
        if !contacts.is_empty() {
            lines.push(contacts.join(" · "));
        }
        lines
    }
}

fn rgb(r: f32, g: f32, b: f32) -> Color {
    Color::Rgb(Rgb::new(r, g, b, None))
}

fn rect(ops: &mut Vec<Op>, x: f32, y: f32, width: f32, height: f32, color: Color) {
    ops.push(Op::SetFillColor { col: color });
    ops.push(Op::DrawPolygon {
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

fn text(ops: &mut Vec<Op>, font: &PdfFontHandle, x: f32, y: f32, value: &str) {
    if value.is_empty() {
        return;
    }
    ops.extend([
        Op::StartTextSection,
        Op::SetFont {
            font: font.clone(),
            size: Pt(6.3),
        },
        Op::SetTextCursor {
            pos: Point::new(Mm(x), Mm(y)),
        },
        Op::SetFillColor {
            col: rgb(0.38, 0.39, 0.41),
        },
        unicode_show_text_op(value),
        Op::EndTextSection,
    ]);
}

fn truncate_to_approx_width(value: &str, max_width_mm: f32) -> String {
    // Footer copy is small (6.3 pt). This conservative approximation keeps
    // configured company data away from the page counter without needing a
    // second font-metrics dependency in the shared chrome.
    let max_chars = (max_width_mm / 1.2).floor().max(8.0) as usize;
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut result = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    result.push('…');
    result
}

#[allow(clippy::too_many_arguments)]
pub fn append_company_chrome(
    ops: &mut Vec<Op>,
    brand: &PatientPdfBrand,
    font: &PdfFontHandle,
    left_mm: f32,
    right_mm: f32,
    header_rule_y_mm: f32,
    footer_rule_y_mm: f32,
    footer_content_top_mm: f32,
) {
    rect(
        ops,
        left_mm,
        header_rule_y_mm,
        right_mm - left_mm,
        0.25,
        rgb(1.0, 0.43, 0.06),
    );
    append_company_footer(
        ops,
        brand,
        font,
        left_mm,
        right_mm,
        footer_rule_y_mm,
        footer_content_top_mm,
    );
}

/// Continuation pages retain the company footer without repeating the letterhead.
pub fn append_company_footer(
    ops: &mut Vec<Op>,
    brand: &PatientPdfBrand,
    font: &PdfFontHandle,
    left_mm: f32,
    right_mm: f32,
    footer_rule_y_mm: f32,
    footer_content_top_mm: f32,
) {
    rect(
        ops,
        left_mm,
        footer_rule_y_mm,
        right_mm - left_mm,
        0.25,
        rgb(1.0, 0.43, 0.06),
    );

    let logo_height_mm = 8.5;
    ops.extend(crate::pdf_logo::gmed_logo_ops(
        left_mm,
        footer_content_top_mm,
        logo_height_mm,
        rgb(0.0, 0.0, 0.0),
    ));
    let text_x_mm = left_mm + logo_height_mm * crate::pdf_logo::GMED_LOGO_ASPECT + 4.0;
    let max_text_width_mm = (right_mm - text_x_mm - 24.0).max(40.0);
    for (index, line) in brand.footer_lines().iter().take(3).enumerate() {
        text(
            ops,
            font,
            text_x_mm,
            footer_content_top_mm - 1.7 - index as f32 * 3.35,
            &truncate_to_approx_width(line, max_text_width_mm),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_does_not_repeat_the_responsible_person() {
        let brand = PatientPdfBrand {
            name: "GMED - Agentur für Patientenbetreuung Heorhii Hudiiev".into(),
            responsible_person: "c/o Heorhii Hudiiev".into(),
            ..Default::default()
        };
        assert_eq!(brand.identity_line().matches("Heorhii Hudiiev").count(), 1);
    }

    #[test]
    fn footer_uses_the_same_company_contact_labels_as_lead_pdfs() {
        for address in [
            "Albert-Schweitzer-Straße 56\n81735 München\nDeutschland",
            r"Albert-Schweitzer-Straße 56\n81735 München\nDeutschland",
            r"Albert-Schweitzer-Straße 56\r\n81735 München\r\nDeutschland",
            " Albert-Schweitzer-Straße 56 \r\n\r\n81735 München\rDeutschland\n",
        ] {
            let brand = PatientPdfBrand {
                name: "GMED".into(),
                responsible_person: "Heorhii Hudiiev".into(),
                address: Some(address.into()),
                phone: Some("+49 1".into()),
                email: Some("mail@example.test".into()),
                website: Some("https://gmed-health.com/".into()),
            };
            assert_eq!(
                brand.footer_lines(),
                [
                    "GMED Heorhii Hudiiev",
                    "Albert-Schweitzer-Straße 56 — 81735 München — Deutschland",
                    "Tel.: +49 1 · E-Mail: mail@example.test · Web: gmed-health.com",
                ]
            );
        }
    }
}
