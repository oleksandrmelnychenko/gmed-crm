//! Reads the date of issue and the issuing authority from the printed part
//! of an identity document (the "visual zone"). The machine readable zone
//! holds neither, so they are looked for in the words `tesseract` finds on
//! the page, with their positions.
//!
//! No check digit covers these values. The date of issue counts as
//! confirmed only when it fits the date of expiry the zone gives (documents
//! are valid for whole years, to the same day or the day before); the
//! authority only when the words under its label were read with high
//! confidence. Everything else is offered unticked, for the person to
//! compare with the scan.

use std::sync::LazyLock;

use chrono::{Datelike, Months, NaiveDate};
use regex::Regex;
use serde::Serialize;

/// What the printed part of the document says.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub(crate) struct VisualData {
    pub issued_on: Option<NaiveDate>,
    /// The date fits the date of expiry of the zone (whole years apart).
    pub issued_on_confirmed: bool,
    pub issuing_authority: Option<String>,
    /// Found under the label «Authority» and read with high confidence.
    pub issuing_authority_confident: bool,
}

impl VisualData {
    pub(crate) fn complete(&self) -> bool {
        self.issued_on.is_some() && self.issuing_authority.is_some()
    }

    /// Takes from `other` what this reading lacks or holds less surely.
    pub(crate) fn merge(&mut self, other: VisualData) {
        if other.issued_on.is_some()
            && (self.issued_on.is_none()
                || (other.issued_on_confirmed && !self.issued_on_confirmed))
        {
            self.issued_on = other.issued_on;
            self.issued_on_confirmed = other.issued_on_confirmed;
        }
        if other.issuing_authority.is_some()
            && (self.issuing_authority.is_none()
                || (other.issuing_authority_confident && !self.issuing_authority_confident))
        {
            self.issuing_authority = other.issuing_authority;
            self.issuing_authority_confident = other.issuing_authority_confident;
        }
    }
}

/// One word of the page with its box, as `tesseract … tsv` lists it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Word {
    pub text: String,
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub conf: f32,
}

impl Word {
    fn right(&self) -> i32 {
        self.left + self.width
    }

    fn centre(&self) -> i32 {
        self.top + self.height / 2
    }
}

/// The words of a `tesseract` TSV output (rows of level 5).
pub(crate) fn words_of_tsv(tsv: &str) -> Vec<Word> {
    tsv.lines()
        .filter_map(|line| {
            let cells: Vec<&str> = line.split('\t').collect();
            if cells.len() < 12 || cells[0] != "5" {
                return None;
            }
            let text = cells[11..].join(" ").trim().to_string();
            if text.is_empty() {
                return None;
            }
            Some(Word {
                text,
                left: cells[6].parse().ok()?,
                top: cells[7].parse().ok()?,
                width: cells[8].parse().ok()?,
                height: cells[9].parse().ok()?,
                conf: cells[10].parse().unwrap_or(0.0),
            })
        })
        .filter(|word| word.height > 0 && word.width > 0)
        .collect()
}

/// The words in reading lines: top to bottom, each line left to right.
fn lines(words: &[Word]) -> Vec<Vec<Word>> {
    let mut sorted: Vec<&Word> = words.iter().collect();
    sorted.sort_by_key(|word| word.centre());
    let mut lines: Vec<Vec<Word>> = Vec::new();
    for word in sorted {
        let found = lines.iter_mut().rev().take(4).find(|line| {
            let centre = line.iter().map(Word::centre).sum::<i32>() / line.len() as i32;
            let height = line
                .iter()
                .map(|other| other.height)
                .max()
                .unwrap_or(0)
                .max(word.height);
            (word.centre() - centre).abs() * 10 <= height * 6
        });
        match found {
            Some(line) => line.push(word.clone()),
            None => lines.push(vec![word.clone()]),
        }
    }
    for line in &mut lines {
        line.sort_by_key(|word| word.left);
    }
    lines
}

fn fold(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|ch| match ch {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'á' | 'à' | 'â' | 'ä' => 'a',
            'ó' | 'ò' | 'ô' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

fn month(name: &str) -> Option<u32> {
    let name = fold(name);
    let name = name.trim_matches(|ch: char| !ch.is_alphabetic());
    const MONTHS: &[(&str, u32)] = &[
        ("juil", 7),
        ("juin", 6),
        ("jan", 1),
        ("gen", 1),
        ("ene", 1),
        ("feb", 2),
        ("fev", 2),
        ("mar", 3),
        ("mrz", 3),
        ("apr", 4),
        ("avr", 4),
        ("abr", 4),
        ("may", 5),
        ("mai", 5),
        ("mag", 5),
        ("jun", 6),
        ("giu", 6),
        ("jul", 7),
        ("lug", 7),
        ("aug", 8),
        ("aou", 8),
        ("ago", 8),
        ("sep", 9),
        ("set", 9),
        ("oct", 10),
        ("okt", 10),
        ("ott", 10),
        ("nov", 11),
        ("dec", 12),
        ("dez", 12),
        ("dic", 12),
    ];
    MONTHS
        .iter()
        .find(|(prefix, _)| name.starts_with(prefix))
        .map(|(_, number)| *number)
}

static DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
        \b(?P<d>\d{1,2})
        \s*[.\-/\x20]\s*
        (?P<m>\d{1,2}|[^\s\d./]{3,}\.?(?:\s*/\s*[^\s\d./]{3,}\.?)?)
        \s*[.\-/\x20]\s*
        (?P<y>\d{4}|\d{2})\b",
    )
    .expect("date pattern")
});

/// A date found in a line, with the words it is made of.
#[derive(Debug, Clone)]
struct FoundDate {
    date: NaiveDate,
    line: usize,
    first: usize,
    last: usize,
}

fn dates(lines: &[Vec<Word>], today: NaiveDate) -> Vec<FoundDate> {
    let mut found = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let mut text = String::new();
        let mut starts = Vec::with_capacity(line.len());
        for word in line {
            if !text.is_empty() {
                text.push(' ');
            }
            starts.push(text.len());
            text.push_str(&word.text);
        }
        let word_at = |offset: usize| starts.iter().rposition(|start| *start <= offset);
        for captures in DATE.captures_iter(&text) {
            let whole = captures.get(0).expect("match");
            let Ok(day) = captures["d"].parse::<u32>() else {
                continue;
            };
            let month_text = &captures["m"];
            let month_number = match month_text.parse::<u32>() {
                Ok(number) => Some(number),
                Err(_) => month_text.split('/').find_map(month),
            };
            let Some(month_number) = month_number else {
                continue;
            };
            let Ok(mut year) = captures["y"].parse::<i32>() else {
                continue;
            };
            if captures["y"].len() == 2 {
                year += if 2000 + year <= today.year() {
                    2000
                } else {
                    1900
                };
            }
            let Some(date) = NaiveDate::from_ymd_opt(year, month_number, day) else {
                continue;
            };
            let (Some(first), Some(last)) = (word_at(whole.start()), word_at(whole.end() - 1))
            else {
                continue;
            };
            found.push(FoundDate {
                date,
                line: index,
                first,
                last,
            });
        }
    }
    found
}

/// Whether a document issued on `issued` may run to `valid_until`: whole
/// years, to the same day or to the day before.
fn fits_expiry(issued: NaiveDate, valid_until: NaiveDate) -> bool {
    (1..=15u32).any(|years| {
        issued
            .checked_add_months(Months::new(12 * years))
            .is_some_and(|end| end == valid_until || end.pred_opt() == Some(valid_until))
    })
}

const ISSUE_LABELS: &[&str] = &[
    "issue",
    "deliv",
    "ausstell",
    "ausgestellt",
    "rilascio",
    "expedic",
    "выдачи",
    "видачі",
];
const AUTHORITY_LABELS: &[&str] = &[
    "authority",
    "autorit",
    "behorde",
    "beherde",
    "autoridad",
    "орган",
];
/// Words of the labels of a data page: a line made of them is no value.
const LABEL_WORDS: &[&str] = &[
    "date",
    "datum",
    "issue",
    "expiry",
    "expiration",
    "birth",
    "naissance",
    "signature",
    "holder",
    "titulaire",
    "inhaber",
    "unterschrift",
    "nationality",
    "nationalite",
    "staatsangehorigkeit",
    "surname",
    "given",
    "names",
    "prenoms",
    "vornamen",
    "place",
    "lieu",
    "geburt",
    "gultig",
    "passport",
    "passeport",
    "authority",
    "autorit",
    "behorde",
    "sex",
];

fn has_any(word: &Word, needles: &[&str]) -> bool {
    let text = fold(&word.text);
    needles.iter().any(|needle| text.contains(needle))
}

fn label_like(word: &Word) -> bool {
    let text = fold(&word.text);
    (text.contains('/') && word.text.chars().any(char::is_lowercase))
        || LABEL_WORDS.iter().any(|label| {
            text.split(|ch: char| !ch.is_alphabetic())
                .any(|part| part == *label)
        })
}

/// The first word of a label in the page, with its line.
fn label(lines: &[Vec<Word>], needles: &[&str]) -> Option<(usize, Word)> {
    lines.iter().enumerate().find_map(|(index, line)| {
        line.iter()
            .find(|word| has_any(word, needles))
            .map(|word| (index, word.clone()))
    })
}

fn issued_on(
    lines: &[Vec<Word>],
    found: &[FoundDate],
    birth: Option<NaiveDate>,
    valid_until: Option<NaiveDate>,
    today: NaiveDate,
) -> Option<(FoundDate, bool)> {
    let candidates: Vec<&FoundDate> = found
        .iter()
        .filter(|item| {
            item.date <= today
                && birth.is_none_or(|birth| item.date > birth)
                && valid_until.is_none_or(|end| item.date < end)
        })
        .collect();
    if let Some(end) = valid_until {
        let mut fitting = candidates.iter().filter(|item| fits_expiry(item.date, end));
        if let Some(first) = fitting.next() {
            // Two different dates that both fit: neither is taken for sure.
            let alone = fitting.all(|other| other.date == first.date);
            return Some(((*first).clone(), alone));
        }
    }
    // Under or next to the label «Date of issue».
    if let Some((label_line, label_word)) = label(lines, ISSUE_LABELS) {
        let reach = label_word.height.max(8);
        let near = candidates
            .iter()
            .filter(|item| {
                let word = &lines[item.line][item.first];
                item.line >= label_line
                    && word.top - label_word.top <= reach * 6
                    && word.right() >= label_word.left - reach * 10
                    && word.left <= label_word.left + reach * 14
            })
            .min_by_key(|item| {
                let word = &lines[item.line][item.first];
                (word.top - label_word.top).abs() * 2 + (word.left - label_word.left).abs()
            });
        if let Some(item) = near {
            return Some(((*item).clone(), false));
        }
    }
    // The only date of the page that is neither the birth nor the expiry.
    let first = candidates.first()?;
    candidates
        .iter()
        .all(|item| item.date == first.date)
        .then(|| ((*first).clone(), false))
}

fn clean_authority(words: &[&Word]) -> Option<String> {
    if words.is_empty() || words.len() > 10 {
        return None;
    }
    let text = words
        .iter()
        .map(|word| word.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let text = text
        .trim_matches(|ch: char| !(ch.is_alphanumeric() || ch == '.' || ch == ')' || ch == '('))
        .trim_start_matches('.')
        .trim();
    let letters = text.chars().filter(|ch| ch.is_alphabetic()).count();
    let digits = text.chars().filter(char::is_ascii_digit).count();
    // A name of an office, or the number some states print instead (4 digits).
    if (letters < 2 && digits < 3) || text.chars().count() > 120 {
        return None;
    }
    Some(text.to_string())
}

/// The words of one column of a line, from `from` on: until a wide gap.
fn column<'a>(line: &'a [Word], from: usize, taken: &[(usize, usize)]) -> Vec<&'a Word> {
    let mut result: Vec<&Word> = Vec::new();
    for (index, word) in line.iter().enumerate().skip(from) {
        if taken
            .iter()
            .any(|(first, last)| (*first..=*last).contains(&index))
        {
            if result.is_empty() {
                continue;
            }
            break;
        }
        if let Some(previous) = result.last()
            && word.left - previous.right() > previous.height.max(word.height) * 3
        {
            break;
        }
        result.push(word);
    }
    result
}

fn authority(
    lines: &[Vec<Word>],
    found: &[FoundDate],
    issued: Option<&FoundDate>,
) -> Option<(String, bool)> {
    let taken = |line: usize| -> Vec<(usize, usize)> {
        found
            .iter()
            .filter(|item| item.line == line)
            .map(|item| (item.first, item.last))
            .collect()
    };
    let confident = |words: &[&Word]| {
        let mean = words.iter().map(|word| word.conf).sum::<f32>() / words.len() as f32;
        mean >= 80.0 && words.iter().all(|word| word.conf >= 60.0)
    };
    if let Some((label_line, label_word)) = label(lines, AUTHORITY_LABELS) {
        let reach = label_word.height.max(8);
        // The value stands under the label, in the label's column.
        for (index, line) in lines.iter().enumerate().skip(label_line + 1).take(2) {
            let Some(from) = line
                .iter()
                .position(|word| word.right() > label_word.left - reach)
            else {
                continue;
            };
            if line[from].top - label_word.top > reach * 7
                || line[from].left > label_word.left + reach * 4
            {
                continue;
            }
            let words = column(line, from, &taken(index));
            if words.iter().any(|word| label_like(word)) {
                continue;
            }
            if let Some(text) = clean_authority(&words) {
                return Some((text, confident(&words)));
            }
        }
        // Or after the label, on its line.
        let line = &lines[label_line];
        let after: Vec<&Word> = line
            .iter()
            .filter(|word| word.left > label_word.left && !label_like(word) && word.text != "/")
            .collect();
        if let Some(text) = clean_authority(&after) {
            return Some((text, false));
        }
    }
    // The labels are too small to read on a photo: on many passports the
    // authority stands next to the date of issue.
    let issued = issued?;
    let line = &lines[issued.line];
    let words = column(line, issued.last + 1, &taken(issued.line));
    if words.iter().any(|word| label_like(word)) {
        return None;
    }
    clean_authority(&words).map(|text| (text, false))
}

/// The date of issue and the authority among the words of a page. `birth`
/// and `valid_until` are the zone's dates: they are never the date of issue.
pub(crate) fn read(
    words: &[Word],
    birth: Option<NaiveDate>,
    valid_until: Option<NaiveDate>,
    today: NaiveDate,
) -> VisualData {
    let lines = lines(words);
    let found = dates(&lines, today);
    let issued = issued_on(&lines, &found, birth, valid_until, today);
    let authority = authority(&lines, &found, issued.as_ref().map(|(item, _)| item));
    VisualData {
        issued_on: issued.as_ref().map(|(item, _)| item.date),
        issued_on_confirmed: issued.as_ref().is_some_and(|(_, confirmed)| *confirmed),
        issuing_authority: authority.as_ref().map(|(text, _)| text.clone()),
        issuing_authority_confident: authority.is_some_and(|(_, confident)| confident),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
        NaiveDate::from_ymd_opt(year, month, day)
    }

    /// `left,top,width,height conf text` per word, `|` between words: what
    /// tesseract listed for a synthetic page of the state "Utopia".
    fn words(listing: &str) -> Vec<Word> {
        let tsv = listing
            .split('|')
            .filter(|item| !item.trim().is_empty())
            .map(|item| {
                let (boxes, rest) = item.trim().split_once(' ').unwrap();
                let (conf, text) = rest.split_once(' ').unwrap();
                let cells: Vec<&str> = boxes.split(',').collect();
                format!(
                    "5\t1\t1\t1\t1\t1\t{}\t{}\t{}\t{}\t{}\t{}",
                    cells[0],
                    cells[1],
                    cells[2],
                    cells[3],
                    conf.trim_start_matches('c'),
                    text
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        words_of_tsv(&tsv)
    }

    const TODAY: (i32, u32, u32) = (2026, 11, 14);
    const PASSPORT: &str = "902,444,37,12 c96 Date|947,443,15,13 c93 of|970,443,83,15 c93 birth/Date|1061,443,18,13 c92 de|1088,447,81,9 c91 naissance|453,470,146,22 c96 UTOPIAN|903,470,36,22 c90 12|952,470,176,25 c90 AUG/AOUT|1141,470,80,22 c94 1974|452,624,37,12 c96 Date|497,623,15,13 c93 of|520,624,86,14 c93 issue/Date|614,623,19,13 c93 de|641,622,86,14 c92 délivrance|900,622,151,18 c90 Authority/Autorité|453,650,33,22 c92 15|500,650,142,28 c89 JUN/JUIN|658,650,80,22 c97 2020|901,650,132,22 c89 C.R.M.D|452,714,37,12 c96 Date|497,713,15,13 c93 of|519,714,97,16 c92 expiry/Date|623,713,99,17 c89 d'expiration|902,713,67,13 c93 Holder's|976,714,165,16 c92 signature/Signature|1149,713,19,13 c93 du|1176,713,64,13 c93 titulaire|453,740,33,22 c92 15|500,740,142,28 c90 JUN/JUIN|658,740,80,22 c96 2030|64,868,1053,30 c90 P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
    const GERMAN: &str = "451,443,140,17 c91 Geburtstag/Date|598,443,16,13 c93 of|621,443,83,15 c93 birth/Date|453,470,186,22 c95 12.08.1974|903,470,15,22 c88 F|450,623,208,17 c90 Ausstellungsdatum/Date|666,623,15,13 c93 of|689,624,86,14 c92 issue/Date|783,623,19,13 c93 de|810,622,84,14 c88 délivrance|902,623,47,17 c92 Gültig|958,623,68,15 c92 bis/Date|1033,623,16,13 c92 of|1055,624,97,16 c86 expiry/Date|1160,623,98,17 c76 d'expiration|453,650,185,22 c95 16.06.2020|903,650,185,22 c95 15.06.2030|452,712,226,18 c76 Behérde/Authority/Autorité|452,740,106,22 c90 STADT|570,740,120,22 c96 ZENITH";
    const PHOTO: &str = "317,329,103,16 c95 UTOPIAN|632,329,26,16 c92 12|667,329,123,18 c92 AUG/AOUT|799,329,56,16 c96 1974|317,455,25,16 c93 15|350,455,100,20 c92 JUN/JUIN|461,455,56,16 c96 2020|632,455,112,16 c96 MINISTRY|752,455,29,16 c96 OF|792,455,110,16 c96 INTERIOR|317,518,22,16 c92 15|350,518,100,20 c92 JUN/JUIN|461,518,56,16 c96 2030";

    fn today() -> NaiveDate {
        date(TODAY.0, TODAY.1, TODAY.2).unwrap()
    }

    #[test]
    fn reads_the_date_of_issue_and_the_authority_under_their_labels() {
        let data = read(
            &words(PASSPORT),
            date(1974, 8, 12),
            date(2030, 6, 15),
            today(),
        );
        assert_eq!(data.issued_on, date(2020, 6, 15));
        assert!(data.issued_on_confirmed);
        assert_eq!(data.issuing_authority.as_deref(), Some("C.R.M.D"));
        assert!(data.issuing_authority_confident);
    }

    #[test]
    fn a_numeric_date_one_day_after_the_anniversary_fits_the_expiry() {
        let data = read(
            &words(GERMAN),
            date(1974, 8, 12),
            date(2030, 6, 15),
            today(),
        );
        assert_eq!(data.issued_on, date(2020, 6, 16));
        assert!(data.issued_on_confirmed);
        assert_eq!(data.issuing_authority.as_deref(), Some("STADT ZENITH"));
        assert!(data.issuing_authority_confident);
    }

    #[test]
    fn a_photo_without_readable_labels_offers_the_authority_next_to_the_date_unconfirmed() {
        let data = read(&words(PHOTO), date(1974, 8, 12), date(2030, 6, 15), today());
        assert_eq!(data.issued_on, date(2020, 6, 15));
        assert!(data.issued_on_confirmed);
        assert_eq!(
            data.issuing_authority.as_deref(),
            Some("MINISTRY OF INTERIOR")
        );
        assert!(!data.issuing_authority_confident);
    }

    #[test]
    fn a_date_that_does_not_fit_the_expiry_is_offered_unconfirmed_and_never_the_birth_date() {
        // The zone's expiry was read as another year: the label still finds the date.
        let data = read(
            &words(PASSPORT),
            date(1974, 8, 12),
            date(2031, 3, 1),
            today(),
        );
        assert_eq!(data.issued_on, date(2020, 6, 15));
        assert!(!data.issued_on_confirmed);
        // Only the birth date on the page: nothing is offered.
        let only_birth = "903,470,36,22 c90 12|952,470,176,25 c90 AUG/AOUT|1141,470,80,22 c94 1974";
        let data = read(
            &words(only_birth),
            date(1974, 8, 12),
            date(2030, 6, 15),
            today(),
        );
        assert_eq!(data, VisualData::default());
    }

    #[test]
    fn month_names_and_short_years_are_read() {
        assert_eq!(month("JUIN"), Some(6));
        assert_eq!(month("juil."), Some(7));
        assert_eq!(month("DÉC"), Some(12));
        assert_eq!(month("XYZ"), None);
        let lines = lines(&words(
            "10,10,30,20 c90 03|50,10,90,20 c90 OKT/OCT|150,10,30,20 c90 19",
        ));
        let found = dates(&lines, today());
        assert_eq!(found.len(), 1);
        assert_eq!(Some(found[0].date), date(2019, 10, 3));
        assert!(fits_expiry(
            date(2020, 2, 29).unwrap(),
            date(2030, 2, 28).unwrap()
        ));
        assert!(!fits_expiry(
            date(2020, 6, 15).unwrap(),
            date(2030, 7, 15).unwrap()
        ));
    }

    #[test]
    fn a_better_reading_replaces_a_weaker_one() {
        let mut data = VisualData {
            issued_on: date(2020, 6, 15),
            issued_on_confirmed: false,
            issuing_authority: None,
            issuing_authority_confident: false,
        };
        assert!(!data.complete());
        data.merge(VisualData {
            issued_on: date(2020, 6, 16),
            issued_on_confirmed: true,
            issuing_authority: Some("STADT ZENITH".into()),
            issuing_authority_confident: true,
        });
        assert_eq!(data.issued_on, date(2020, 6, 16));
        assert!(data.complete() && data.issued_on_confirmed);
    }
}
