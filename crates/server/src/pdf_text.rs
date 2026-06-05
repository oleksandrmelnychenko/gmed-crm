use printpdf::{DictItem, Op, PdfSaveOptions};

pub(crate) fn pdf_text_save_options() -> PdfSaveOptions {
    // The generated document builders emit pre-encoded Tj text operations so
    // German WinAnsi characters render correctly with PDF built-in fonts.
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
    use super::encode_win_ansi_text;

    #[test]
    fn win_ansi_encoder_supports_german_text() {
        assert_eq!(
            encode_win_ansi_text("Müller Köln Straße Ärzteteam €"),
            b"M\xFCller K\xF6ln Stra\xDFe \xC4rzteteam \x80"
        );
    }
}
