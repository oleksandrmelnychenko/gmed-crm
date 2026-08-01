use std::collections::BTreeMap;

use printpdf::{
    DictItem, FontMetrics, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfSaveOptions, TextItem,
};

const PDF_ARIAL_REGULAR_BYTES: &[u8] = include_bytes!("../../../docs/comparison/fonts/arial.ttf");
const PDF_ARIAL_BOLD_BYTES: &[u8] = include_bytes!("../../../docs/comparison/fonts/arialbd.ttf");

pub(crate) fn pdf_text_save_options() -> PdfSaveOptions {
    // Some legacy builders emit pre-encoded Tj operations for built-in fonts;
    // Unicode builders use embedded fonts and regular ShowText operations.
    PdfSaveOptions {
        secure: false,
        ..Default::default()
    }
}

pub(crate) fn win_ansi_show_text_op(text: &str) -> Op {
    let data = encode_win_ansi_text(text);
    Op::Unknown {
        key: "Tj".to_string(),
        value: vec![DictItem::String {
            literal: !needs_hex_encoding(&data),
            data,
        }],
    }
}

pub(crate) fn unicode_show_text_op(text: &str) -> Op {
    Op::ShowText {
        items: vec![TextItem::Text(text.to_string())],
    }
}

pub(crate) fn add_unicode_pdf_fonts(
    document: &mut PdfDocument,
) -> Result<(PdfFontHandle, PdfFontHandle), &'static str> {
    let regular_font = parsed_unicode_pdf_font(PDF_ARIAL_REGULAR_BYTES, "Arial")
        .ok_or("Failed to load PDF regular font")?;
    let bold_font = parsed_unicode_pdf_font(PDF_ARIAL_BOLD_BYTES, "Arial Bold")
        .ok_or("Failed to load PDF bold font")?;
    let regular = PdfFontHandle::External(document.add_font(&regular_font));
    let bold = PdfFontHandle::External(document.add_font(&bold_font));
    Ok((regular, bold))
}

fn parsed_unicode_pdf_font(bytes: &[u8], font_name: &str) -> Option<ParsedFont> {
    let face = ttf_parser::Face::parse(bytes, 0).ok()?;
    let cmap = face.tables().cmap?;
    let mut codepoint_to_glyph = BTreeMap::new();
    let mut glyph_widths = BTreeMap::new();

    for subtable in cmap.subtables {
        if !subtable.is_unicode() {
            continue;
        }
        subtable.codepoints(|codepoint| {
            let Some(character) = char::from_u32(codepoint) else {
                return;
            };
            let Some(glyph) = face.glyph_index(character) else {
                return;
            };
            codepoint_to_glyph.entry(codepoint).or_insert(glyph.0);
            glyph_widths.entry(glyph.0).or_insert_with(|| {
                face.glyph_hor_advance(glyph)
                    .unwrap_or(face.units_per_em() / 2)
            });
        });
    }

    Some(ParsedFont::with_glyph_data(
        bytes.to_vec(),
        0,
        Some(font_name.to_string()),
        codepoint_to_glyph,
        glyph_widths,
        face.units_per_em(),
        FontMetrics {
            ascent: face.ascender(),
            descent: face.descender(),
        },
    ))
}

fn needs_hex_encoding(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .any(|&byte| !(32..=126).contains(&byte) || matches!(byte, b'(' | b')' | b'\\' | b'%'))
}

fn encode_win_ansi_text(text: &str) -> Vec<u8> {
    text.chars().map(win_ansi_byte).collect()
}

fn win_ansi_byte(ch: char) -> u8 {
    match ch {
        '\t' | '\n' | '\r' => b' ',
        '\u{20AC}' => 0x80,
        '\u{201A}' => 0x82,
        '\u{0192}' => 0x83,
        '\u{201E}' => 0x84,
        '\u{2026}' => 0x85,
        '\u{2020}' => 0x86,
        '\u{2021}' => 0x87,
        '\u{02C6}' => 0x88,
        '\u{2030}' => 0x89,
        '\u{0160}' => 0x8A,
        '\u{2039}' => 0x8B,
        '\u{0152}' => 0x8C,
        '\u{017D}' => 0x8E,
        '\u{2018}' => 0x91,
        '\u{2019}' => 0x92,
        '\u{201C}' => 0x93,
        '\u{201D}' => 0x94,
        '\u{2022}' => 0x95,
        '\u{2013}' => 0x96,
        '\u{2014}' => 0x97,
        '\u{02DC}' => 0x98,
        '\u{2122}' => 0x99,
        '\u{0161}' => 0x9A,
        '\u{203A}' => 0x9B,
        '\u{0153}' => 0x9C,
        '\u{017E}' => 0x9E,
        '\u{0178}' => 0x9F,
        ' '..='~' | '\u{00A0}'..='\u{00FF}' => ch as u32 as u8,
        _ => b'?',
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PDF_ARIAL_BOLD_BYTES, PDF_ARIAL_REGULAR_BYTES, encode_win_ansi_text,
        parsed_unicode_pdf_font,
    };

    #[test]
    fn win_ansi_encoder_supports_german_text() {
        assert_eq!(
            encode_win_ansi_text("Müller Köln Straße Ärzteteam €"),
            b"M\xFCller K\xF6ln Stra\xDFe \xC4rzteteam \x80"
        );
    }

    #[test]
    fn bundled_arial_fonts_include_cyrillic_glyphs() {
        for (bytes, name) in [
            (PDF_ARIAL_REGULAR_BYTES, "Arial"),
            (PDF_ARIAL_BOLD_BYTES, "Arial Bold"),
        ] {
            let font = parsed_unicode_pdf_font(bytes, name).expect("bundled Arial should parse");
            assert!(font.codepoint_to_glyph.contains_key(&('Ж' as u32)));
            assert!(font.codepoint_to_glyph.contains_key(&('ї' as u32)));
        }
    }
}
