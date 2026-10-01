//! Personnel files (Personalakte / Entgeltunterlagen): archive file names.
//!
//! The payroll office requires every archived document to carry a name that
//! says what it is, for whom and for which period, at most 64 characters long
//! and without periods, commas, special characters, umlauts, `ß` or spaces.
//! The name is generated here from the category, the period and the
//! employee's name; nobody types it. The extension keeps its dot, the only
//! one in the name.
//!
//! See `docs/personnel-files-plan-2026-09-30_ua.md`, section 3.4.

use std::fmt;

use chrono::{Datelike, NaiveDate};

/// Longest archive file name, extension included.
pub const MAX_ARCHIVE_FILE_NAME_LEN: usize = 64;

/// File types accepted for personnel documents, as `(mime type, extension)`.
pub const ALLOWED_TYPES: &[(&str, &str)] = &[
    ("application/pdf", "pdf"),
    ("image/jpeg", "jpg"),
    ("image/png", "png"),
    ("image/bmp", "bmp"),
    ("image/tiff", "tif"),
];

/// The archive extension for an accepted MIME type.
pub fn extension_for_mime(mime_type: &str) -> Option<&'static str> {
    let mime_type = mime_type.trim().to_ascii_lowercase();
    let mime_type = match mime_type.as_str() {
        "image/jpg" | "image/pjpeg" => "image/jpeg",
        "image/x-ms-bmp" | "image/x-bmp" => "image/bmp",
        "image/tif" => "image/tiff",
        other => other,
    };
    ALLOWED_TYPES
        .iter()
        .find(|(mime, _)| *mime == mime_type)
        .map(|(_, extension)| *extension)
}

/// What period a document belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchivePeriod {
    /// A monthly document (timesheet, payslip): `2026_05`.
    Month { year: i32, month: u32 },
    /// A dated document (contract, sick note): `20260514`.
    Date(NaiveDate),
}

impl ArchivePeriod {
    fn render(self) -> String {
        match self {
            ArchivePeriod::Month { year, month } => format!("{year:04}_{month:02}"),
            ArchivePeriod::Date(date) => {
                format!("{:04}{:02}{:02}", date.year(), date.month(), date.day())
            }
        }
    }
}

/// Why no archive name could be built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchiveNameError {
    /// The category label has no usable characters.
    EmptyCategory,
    /// The last name has no usable characters.
    EmptyLastName,
    /// The extension is not one of [`ALLOWED_TYPES`].
    UnsupportedExtension,
    /// Even fully shortened, the name does not fit the limit.
    TooLong,
}

impl fmt::Display for ArchiveNameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ArchiveNameError::EmptyCategory => "category label has no usable characters",
            ArchiveNameError::EmptyLastName => "last name has no usable characters",
            ArchiveNameError::UnsupportedExtension => "file type is not allowed",
            ArchiveNameError::TooLong => "archive file name does not fit 64 characters",
        })
    }
}

impl std::error::Error for ArchiveNameError {}

/// Replaces German and other Latin letters by plain ASCII (`ä` → `ae`,
/// `ß` → `ss`, `é` → `e`) and drops every character that is not an ASCII
/// letter or digit. Word boundaries are kept as single spaces so callers can
/// join the words.
pub fn transliterate(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        let replacement: &str = match ch {
            'ä' => "ae",
            'ö' => "oe",
            'ü' => "ue",
            'Ä' => "Ae",
            'Ö' => "Oe",
            'Ü' => "Ue",
            'ß' => "ss",
            'ẞ' => "SS",
            'à' | 'á' | 'â' | 'ã' | 'å' | 'ā' | 'ă' | 'ą' => "a",
            'À' | 'Á' | 'Â' | 'Ã' | 'Å' | 'Ā' | 'Ă' | 'Ą' => "A",
            'æ' => "ae",
            'Æ' => "Ae",
            'ç' | 'ć' | 'č' | 'ĉ' | 'ċ' => "c",
            'Ç' | 'Ć' | 'Č' | 'Ĉ' | 'Ċ' => "C",
            'ď' | 'đ' => "d",
            'Ď' | 'Đ' => "D",
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => "e",
            'È' | 'É' | 'Ê' | 'Ë' | 'Ē' | 'Ė' | 'Ę' | 'Ě' => "E",
            'ğ' | 'ģ' => "g",
            'Ğ' | 'Ģ' => "G",
            'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'ı' => "i",
            'Ì' | 'Í' | 'Î' | 'Ï' | 'Ī' | 'Į' | 'İ' => "I",
            'ķ' => "k",
            'Ķ' => "K",
            'ł' | 'ľ' | 'ĺ' | 'ļ' => "l",
            'Ł' | 'Ľ' | 'Ĺ' | 'Ļ' => "L",
            'ñ' | 'ń' | 'ň' | 'ņ' => "n",
            'Ñ' | 'Ń' | 'Ň' | 'Ņ' => "N",
            'ò' | 'ó' | 'ô' | 'õ' | 'ø' | 'ō' | 'ő' => "o",
            'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ø' | 'Ō' | 'Ő' => "O",
            'œ' => "oe",
            'Œ' => "Oe",
            'ř' | 'ŕ' => "r",
            'Ř' | 'Ŕ' => "R",
            'ś' | 'š' | 'ş' | 'ș' => "s",
            'Ś' | 'Š' | 'Ş' | 'Ș' => "S",
            'ť' | 'ţ' | 'ț' => "t",
            'Ť' | 'Ţ' | 'Ț' => "T",
            'ù' | 'ú' | 'û' | 'ū' | 'ů' | 'ű' | 'ų' => "u",
            'Ù' | 'Ú' | 'Û' | 'Ū' | 'Ů' | 'Ű' | 'Ų' => "U",
            'ý' | 'ÿ' => "y",
            'Ý' | 'Ÿ' => "Y",
            'ź' | 'ž' | 'ż' => "z",
            'Ź' | 'Ž' | 'Ż' => "Z",
            c if c.is_ascii_alphanumeric() => {
                out.push(c);
                continue;
            }
            _ => " ",
        };
        out.push_str(replacement);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// One name part without separators: `Müller-Lüdenscheidt` →
/// `MuellerLuedenscheidt`, `anna maria` → `AnnaMaria`.
pub fn name_token(input: &str) -> String {
    transliterate(input)
        .split(' ')
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn normalized_extension(extension: &str) -> Option<&'static str> {
    match extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => Some("pdf"),
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "bmp" => Some("bmp"),
        "tif" | "tiff" => Some("tif"),
        _ => None,
    }
}

/// Builds the archive file name, for example
/// `Stundenzettel_2026_05_Mustermann_Gabriele.pdf`.
///
/// `suffix` tells versions and duplicates apart (`V2`, `2`, `V2_2`); only
/// ASCII letters and digits are kept, other characters separate parts. When the result
/// is longer than [`MAX_ARCHIVE_FILE_NAME_LEN`], the first name is shortened
/// first, then the category; the period, the suffix and the last name are
/// kept as long as possible (the last name is cut only as a last resort).
pub fn archive_file_name(
    category_label: &str,
    period: ArchivePeriod,
    last_name: &str,
    first_name: &str,
    extension: &str,
    suffix: Option<&str>,
) -> Result<String, ArchiveNameError> {
    let extension =
        normalized_extension(extension).ok_or(ArchiveNameError::UnsupportedExtension)?;
    let mut category = name_token(category_label);
    if category.is_empty() {
        return Err(ArchiveNameError::EmptyCategory);
    }
    let mut last = name_token(last_name);
    if last.is_empty() {
        return Err(ArchiveNameError::EmptyLastName);
    }
    let mut first = name_token(first_name);
    let period = period.render();
    let suffix = suffix
        .map(|value| {
            value
                .split(|ch: char| !ch.is_ascii_alphanumeric())
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("_")
        })
        .filter(|value| !value.is_empty());

    let assemble = |category: &str, last: &str, first: &str| {
        let mut parts = vec![category.to_string(), period.clone(), last.to_string()];
        if !first.is_empty() {
            parts.push(first.to_string());
        }
        if let Some(suffix) = &suffix {
            parts.push(suffix.clone());
        }
        format!("{}.{extension}", parts.join("_"))
    };

    let mut name = assemble(&category, &last, &first);
    // ASCII only from here on, so byte length is character length.
    while name.len() > MAX_ARCHIVE_FILE_NAME_LEN {
        if first.len() > 1 {
            let overflow = name.len() - MAX_ARCHIVE_FILE_NAME_LEN;
            first.truncate(first.len().saturating_sub(overflow).max(1));
        } else if category.len() > 4 {
            let overflow = name.len() - MAX_ARCHIVE_FILE_NAME_LEN;
            category.truncate(category.len().saturating_sub(overflow).max(4));
        } else if last.len() > 1 {
            let overflow = name.len() - MAX_ARCHIVE_FILE_NAME_LEN;
            last.truncate(last.len().saturating_sub(overflow).max(1));
        } else {
            return Err(ArchiveNameError::TooLong);
        }
        name = assemble(&category, &last, &first);
    }
    debug_assert!(is_valid_archive_file_name(&name));
    Ok(name)
}

/// Whether `name` satisfies the archive naming rules: at most 64
/// characters, ASCII letters, digits and `_` only, and one dot before an
/// allowed extension.
pub fn is_valid_archive_file_name(name: &str) -> bool {
    if name.len() > MAX_ARCHIVE_FILE_NAME_LEN || !name.is_ascii() {
        return false;
    }
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        && !stem.starts_with('_')
        && !stem.ends_with('_')
        && ALLOWED_TYPES
            .iter()
            .any(|(_, allowed)| *allowed == extension)
}

/// Whether a monthly document was archived later than `late_days` after the
/// end of its month (or a dated document later than `late_days` after its
/// date).
pub fn archived_late(period: ArchivePeriod, archived_on: NaiveDate, late_days: u32) -> bool {
    let reference = match period {
        ArchivePeriod::Month { year, month } => {
            let next = if month == 12 {
                NaiveDate::from_ymd_opt(year + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(year, month + 1, 1)
            };
            match next.and_then(|date| date.pred_opt()) {
                Some(last_day) => last_day,
                None => return false,
            }
        }
        ArchivePeriod::Date(date) => date,
    };
    (archived_on - reference).num_days() > i64::from(late_days)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn month(year: i32, month: u32) -> ArchivePeriod {
        ArchivePeriod::Month { year, month }
    }

    #[test]
    fn letter_example_becomes_a_valid_name() {
        let name = archive_file_name(
            "Stundenzettel",
            month(2026, 5),
            "Mustermann",
            "Gabriele",
            "pdf",
            None,
        )
        .unwrap();
        assert_eq!(name, "Stundenzettel_2026_05_Mustermann_Gabriele.pdf");
        assert!(is_valid_archive_file_name(&name));
    }

    #[test]
    fn umlauts_sharp_s_and_separators_are_transliterated() {
        let name = archive_file_name(
            "Arbeitsunfähigkeit",
            ArchivePeriod::Date(NaiveDate::from_ymd_opt(2026, 3, 9).unwrap()),
            "Müller-Lüdenscheidt",
            "Jörg Strauß",
            "JPEG",
            None,
        )
        .unwrap();
        // 66 characters in full, so the first name loses two.
        assert_eq!(
            name,
            "Arbeitsunfaehigkeit_20260309_MuellerLuedenscheidt_JoergStrau.jpg"
        );
        assert!(is_valid_archive_file_name(&name));
    }

    #[test]
    fn transliteration_covers_common_latin_letters() {
        assert_eq!(transliterate("Çelik Ñúñez Øster"), "Celik Nunez Oster");
        assert_eq!(transliterate("ẞ ß Ä"), "SS ss Ae");
        assert_eq!(transliterate("a, b. c! d"), "a b c d");
        assert_eq!(name_token("anna  maria"), "AnnaMaria");
        assert_eq!(name_token("O'Neill"), "ONeill");
    }

    #[test]
    fn long_names_shorten_first_name_then_category_and_keep_period() {
        let name = archive_file_name(
            "Sozialversicherungsmeldung",
            month(2026, 11),
            "Schwarzenberg-Hohenlohe",
            "Maximiliane Theodora",
            "pdf",
            Some("V2"),
        )
        .unwrap();
        assert_eq!(name.len(), MAX_ARCHIVE_FILE_NAME_LEN);
        assert!(is_valid_archive_file_name(&name));
        assert!(name.contains("_2026_11_SchwarzenbergHohenlohe_"));
        assert!(name.ends_with("_V2.pdf"));
    }

    #[test]
    fn last_name_is_cut_only_as_last_resort() {
        let last = "A".repeat(80);
        let name = archive_file_name("Urlaub", month(2026, 1), &last, "Eva", "pdf", None).unwrap();
        assert_eq!(name.len(), MAX_ARCHIVE_FILE_NAME_LEN);
        assert!(name.starts_with("Urla_2026_01_AAAA"));
        assert!(is_valid_archive_file_name(&name));
    }

    #[test]
    fn exactly_64_characters_is_kept_as_is() {
        // 13 + 8 + (1 + 34) + 4 + 4 = 64
        let last = "B".repeat(34);
        let name =
            archive_file_name("Stundenzettel", month(2026, 5), &last, "Eva", "pdf", None).unwrap();
        assert_eq!(name.len(), 64);
        assert!(name.ends_with("_Eva.pdf"));
    }

    #[test]
    fn missing_first_name_and_suffixes() {
        let name =
            archive_file_name("Zeugnis", month(2026, 2), "Doe", "", "tiff", Some("2")).unwrap();
        assert_eq!(name, "Zeugnis_2026_02_Doe_2.tif");
        let name =
            archive_file_name("Zeugnis", month(2026, 2), "Doe", "Jo", "pdf", Some("V2_3")).unwrap();
        assert_eq!(name, "Zeugnis_2026_02_Doe_Jo_V2_3.pdf");
    }

    #[test]
    fn rejects_unusable_input() {
        let period = month(2026, 5);
        assert_eq!(
            archive_file_name("", period, "Doe", "Jane", "pdf", None),
            Err(ArchiveNameError::EmptyCategory)
        );
        assert_eq!(
            archive_file_name("Urlaub", period, "---", "Jane", "pdf", None),
            Err(ArchiveNameError::EmptyLastName)
        );
        assert_eq!(
            archive_file_name("Urlaub", period, "Doe", "Jane", "docx", None),
            Err(ArchiveNameError::UnsupportedExtension)
        );
    }

    #[test]
    fn validator_rejects_forbidden_characters() {
        for bad in [
            "Scan 100.pdf",
            "Stundenzettel_Mai.2026.pdf",
            "Müller.pdf",
            "Strauß.pdf",
            "a,b.pdf",
            "a-b.pdf",
            "file.docx",
            "_lead.pdf",
            "noextension",
            ".pdf",
        ] {
            assert!(!is_valid_archive_file_name(bad), "{bad}");
        }
        assert!(!is_valid_archive_file_name(&format!(
            "{}.pdf",
            "a".repeat(61)
        )));
        assert!(is_valid_archive_file_name(&format!(
            "{}.pdf",
            "a".repeat(60)
        )));
    }

    #[test]
    fn mime_types_map_to_archive_extensions() {
        assert_eq!(extension_for_mime("application/pdf"), Some("pdf"));
        assert_eq!(extension_for_mime("image/JPEG"), Some("jpg"));
        assert_eq!(extension_for_mime("image/x-ms-bmp"), Some("bmp"));
        assert_eq!(extension_for_mime("image/tiff"), Some("tif"));
        assert_eq!(extension_for_mime("image/gif"), None);
        assert_eq!(extension_for_mime("application/zip"), None);
    }

    #[test]
    fn lateness_counts_days_after_month_end() {
        let may = month(2026, 5);
        let on = |d: u32, m: u32| NaiveDate::from_ymd_opt(2026, m, d).unwrap();
        assert!(!archived_late(may, on(7, 6), 7));
        assert!(archived_late(may, on(8, 6), 7));
        assert!(!archived_late(
            month(2026, 12),
            NaiveDate::from_ymd_opt(2027, 1, 7).unwrap(),
            7
        ));
        assert!(archived_late(
            month(2026, 12),
            NaiveDate::from_ymd_opt(2027, 1, 8).unwrap(),
            7
        ));
        let dated = ArchivePeriod::Date(on(10, 3));
        assert!(!archived_late(dated, on(17, 3), 7));
        assert!(archived_late(dated, on(18, 3), 7));
    }
}
