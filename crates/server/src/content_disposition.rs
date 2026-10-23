//! `Content-Disposition` header values built from a stored file name.
//!
//! RFC 6266 / RFC 8187: the header carries an ASCII fallback
//! `filename="..."` (quotes, backslashes and control characters removed,
//! non-ASCII replaced by `_`) plus `filename*=UTF-8''<percent-encoded>`
//! so umlauts and Cyrillic names survive the download, and a name with a
//! quote, CR or LF can never break out of the header.

/// `attachment; filename="..."; filename*=UTF-8''...`
pub fn attachment(file_name: &str) -> String {
    build("attachment", file_name)
}

/// `inline; filename="..."; filename*=UTF-8''...`
pub fn inline(file_name: &str) -> String {
    build("inline", file_name)
}

fn build(disposition: &str, file_name: &str) -> String {
    let cleaned: String = file_name
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    let cleaned = if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned
    };
    let fallback = ascii_fallback(&cleaned);
    let encoded = percent_encode(&cleaned);
    format!("{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
}

/// The plain `filename` parameter: printable ASCII only, no quote or
/// backslash (they would end or escape the quoted string).
fn ascii_fallback(name: &str) -> String {
    let fallback: String = name
        .chars()
        .map(|c| match c {
            '"' | '\\' => '_',
            c if c.is_ascii_graphic() || c == ' ' => c,
            _ => '_',
        })
        .collect();
    if fallback.trim().is_empty() {
        "download".to_string()
    } else {
        fallback
    }
}

/// RFC 8187 `value-chars`: `attr-char` stays, every other byte is `%XX`.
fn percent_encode(name: &str) -> String {
    let mut out = String::with_capacity(name.len() * 3);
    for byte in name.bytes() {
        let keep = byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'!' | b'#' | b'$' | b'&' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
            );
        if keep {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_ascii_name_keeps_both_parameters() {
        assert_eq!(
            attachment("report.pdf"),
            "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf"
        );
    }

    #[test]
    fn non_ascii_name_is_percent_encoded_with_an_ascii_fallback() {
        assert_eq!(
            inline("Befund Müller.pdf"),
            "inline; filename=\"Befund M_ller.pdf\"; filename*=UTF-8''Befund%20M%C3%BCller.pdf"
        );
    }

    #[test]
    fn quotes_and_line_breaks_cannot_break_the_header() {
        let value = attachment("a\"b\r\nX-Evil: 1\\.pdf");
        assert!(!value.contains('\r'));
        assert!(!value.contains('\n'));
        assert_eq!(
            value,
            "attachment; filename=\"a_bX-Evil: 1_.pdf\"; filename*=UTF-8''a%22bX-Evil%3A%201%5C.pdf"
        );
        assert!(axum::http::HeaderValue::from_str(&value).is_ok());
    }

    #[test]
    fn empty_name_falls_back_to_download() {
        assert_eq!(
            attachment(" \r\n"),
            "attachment; filename=\"download\"; filename*=UTF-8''download"
        );
    }
}
