//! The machine readable zone of an identity document (ICAO Doc 9303): the
//! three sizes TD1 (ID card, 3 × 30), TD2 (2 × 36) and TD3 (passport,
//! 2 × 44), read from OCR text with every check digit verified.
//!
//! The zone is the only part of a document a machine reads reliably, and the
//! check digits say whether it was read right. So a value is offered to staff
//! as a proposal, with what was verified; nothing here stores anything. The
//! zone holds no place of birth, no issuing authority and no date of issue.
//!
//! Names and the two country codes are not covered by any check digit; they
//! are Latin transliterations without diacritics or hyphens.

use chrono::{Datelike, NaiveDate};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum MrzFormat {
    #[serde(rename = "TD1")]
    Td1,
    #[serde(rename = "TD2")]
    Td2,
    #[serde(rename = "TD3")]
    Td3,
}

/// Which check digits of the zone hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct MrzChecks {
    pub document_number: bool,
    pub birth_date: bool,
    pub valid_until: bool,
    /// The digit over the whole lower part (number, dates, optional data).
    pub composite: bool,
}

impl MrzChecks {
    pub(crate) fn all(&self) -> bool {
        self.document_number && self.birth_date && self.valid_until && self.composite
    }

    /// How many of the four check digits hold.
    pub(crate) fn passed(&self) -> u8 {
        u8::from(self.document_number)
            + u8::from(self.birth_date)
            + u8::from(self.valid_until)
            + u8::from(self.composite)
    }
}

/// What one zone says. A field the zone leaves open or that names no known
/// value is `None`; it is never guessed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct MrzData {
    pub format: MrzFormat,
    /// `passport`, `id_card` or `residence_permit` (the form's values).
    pub document_type: Option<&'static str>,
    pub document_number: Option<String>,
    /// ISO 3166-1 alpha-2.
    pub issuing_country: Option<String>,
    /// ISO 3166-1 alpha-2.
    pub nationality: Option<String>,
    pub surname: Option<String>,
    pub given_names: Option<String>,
    pub birth_date: Option<NaiveDate>,
    /// `female` or `male`; the zone's "unspecified" is `None`.
    pub sex: Option<&'static str>,
    pub valid_until: Option<NaiveDate>,
    pub checks: MrzChecks,
    /// The name field is full to its last character: a long name was cut.
    pub names_truncated: bool,
}

const WEIGHTS: [u32; 3] = [7, 3, 1];

fn char_value(ch: char) -> Option<u32> {
    match ch {
        '0'..='9' => Some(ch as u32 - '0' as u32),
        'A'..='Z' => Some(ch as u32 - 'A' as u32 + 10),
        '<' => Some(0),
        _ => None,
    }
}

/// The check digit of a field (weights 7, 3, 1; modulo 10).
pub(crate) fn check_digit(field: &str) -> Option<u32> {
    let mut sum = 0;
    for (index, ch) in field.chars().enumerate() {
        sum += char_value(ch)? * WEIGHTS[index % 3];
    }
    Some(sum % 10)
}

fn check_holds(field: &str, digit: char) -> bool {
    as_digit(digit)
        .to_digit(10)
        .is_some_and(|expected| check_digit(field) == Some(expected))
}

/// A character of a numeric field as OCR may have read it.
fn as_digit(ch: char) -> char {
    match ch {
        'O' | 'Q' | 'D' => '0',
        'I' | 'L' => '1',
        'Z' => '2',
        'S' => '5',
        'G' => '6',
        'B' => '8',
        other => other,
    }
}

/// A character of an alphabetic field as OCR may have read it.
fn as_letter(ch: char) -> char {
    match ch {
        '0' => 'O',
        '1' => 'I',
        '2' => 'Z',
        '5' => 'S',
        '6' => 'G',
        '8' => 'B',
        other => other,
    }
}

fn digits(field: &str) -> String {
    field.chars().map(as_digit).collect()
}

fn letters(field: &str) -> String {
    field.chars().map(as_letter).collect()
}

/// The other reading of a character a document number may hold either way.
fn twin(ch: char) -> Option<char> {
    let other = as_digit(ch);
    if other != ch {
        return Some(other);
    }
    let other = as_letter(ch);
    (other != ch).then_some(other)
}

/// A document number mixes letters and digits, so `O`/`0` cannot be told
/// apart by position. When the check digit fails and exactly one single
/// character read the other way makes it hold, that reading is taken.
fn repaired_number(number: &str, digit: char) -> Option<String> {
    if check_holds(number, digit) {
        return Some(number.to_string());
    }
    let chars: Vec<char> = number.chars().collect();
    let mut found: Option<String> = None;
    for (index, ch) in chars.iter().enumerate() {
        let Some(other) = twin(*ch) else { continue };
        let mut candidate = chars.clone();
        candidate[index] = other;
        let candidate: String = candidate.into_iter().collect();
        if check_holds(&candidate, digit) {
            if found.is_some() {
                return None;
            }
            found = Some(candidate);
        }
    }
    found
}

/// `YYMMDD` as numbers.
fn date_parts(field: &str) -> Option<(i32, u32, u32)> {
    let field = digits(field);
    if field.len() != 6 || !field.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some((
        field[0..2].parse().ok()?,
        field[2..4].parse().ok()?,
        field[4..6].parse().ok()?,
    ))
}

/// A date of birth: the latest year of that number that is not in the future.
fn birth_date(field: &str, today: NaiveDate) -> Option<NaiveDate> {
    let (year, month, day) = date_parts(field)?;
    let recent = NaiveDate::from_ymd_opt(2000 + year, month, day);
    match recent {
        Some(date) if date <= today => Some(date),
        _ => NaiveDate::from_ymd_opt(1900 + year, month, day),
    }
}

/// A date of expiry: this century, unless that lies more than 50 years ahead.
fn expiry_date(field: &str, today: NaiveDate) -> Option<NaiveDate> {
    let (year, month, day) = date_parts(field)?;
    let date = NaiveDate::from_ymd_opt(2000 + year, month, day)?;
    if date.year() > today.year() + 50 {
        return NaiveDate::from_ymd_opt(1900 + year, month, day);
    }
    Some(date)
}

fn sex(ch: char) -> Option<&'static str> {
    match ch {
        'F' => Some("female"),
        'M' => Some("male"),
        _ => None,
    }
}

/// The form's document type of a document code (the first two characters).
fn document_type(code: &str) -> Option<&'static str> {
    let code = letters(code);
    let mut chars = code.chars();
    let first = chars.next()?;
    let second = chars.next().unwrap_or('<');
    match (first, second) {
        ('P', _) => Some("passport"),
        // Residence permits of the EU's uniform format and the German titles.
        ('A', 'R' | 'S' | 'F') | ('I', 'R') | ('R', _) | ('C', 'R') => Some("residence_permit"),
        ('I' | 'A' | 'C', _) => Some("id_card"),
        _ => None,
    }
}

fn title_case(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first
            .to_uppercase()
            .chain(chars.flat_map(char::to_lowercase))
            .collect(),
        None => String::new(),
    }
}

fn words(part: &str) -> Option<String> {
    let text = part
        .split('<')
        .filter(|word| !word.is_empty())
        .map(title_case)
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

/// Surname and given names of a name field (`SURNAME<<GIVEN<NAMES<<<`).
/// The surname ends at the first `<<`, the given names at the next one;
/// whatever follows is filler, also where OCR read some of it as letters.
fn names(field: &str) -> (Option<String>, Option<String>, bool) {
    let truncated = !field.ends_with('<');
    let field = letters(field);
    let mut parts = field.split("<<");
    let surname = parts.next().unwrap_or("");
    let given = parts.next().unwrap_or("");
    (words(surname), words(given), truncated)
}

/// The alpha-2 code of a three letter code of the zone; `None` for codes
/// that name no state (stateless, refugee, organisations, specimens).
pub(crate) fn country_alpha2(field: &str) -> Option<String> {
    let code = letters(field.trim_end_matches('<'));
    let alpha2 = match code.as_str() {
        // Germany is the one state with a single letter.
        "D" => "DE",
        // British nationals of the other classes carry their own codes.
        "GBD" | "GBN" | "GBO" | "GBP" | "GBS" => "GB",
        "RKS" | "UNK" => "XK",
        other => ISO_ALPHA3
            .iter()
            .find(|(alpha3, _)| *alpha3 == other)
            .map(|(_, alpha2)| *alpha2)?,
    };
    crate::services::citizenships::is_country_code(alpha2).then(|| alpha2.to_string())
}

/// The lower line of TD2 and TD3 (same layout up to the optional data).
struct LowerLine<'a> {
    number: &'a str,
    number_digit: char,
    nationality: &'a str,
    birth: &'a str,
    birth_digit: char,
    sex: char,
    expiry: &'a str,
    expiry_digit: char,
}

fn lower_line(line: &str) -> LowerLine<'_> {
    let at = |index: usize| line[index..].chars().next().unwrap_or('<');
    LowerLine {
        number: &line[0..9],
        number_digit: at(9),
        nationality: &line[10..13],
        birth: &line[13..19],
        birth_digit: at(19),
        sex: at(20),
        expiry: &line[21..27],
        expiry_digit: at(27),
    }
}

struct Parts<'a> {
    format: MrzFormat,
    code: &'a str,
    issuing: &'a str,
    names: &'a str,
    number: String,
    number_holds: bool,
    nationality: &'a str,
    birth: &'a str,
    birth_digit: char,
    sex: char,
    expiry: &'a str,
    expiry_digit: char,
    composite: bool,
}

fn build(parts: Parts<'_>, today: NaiveDate) -> MrzData {
    let (surname, given_names, names_truncated) = names(parts.names);
    let number = parts.number.trim_end_matches('<').replace('<', " ");
    let checks = MrzChecks {
        document_number: parts.number_holds,
        birth_date: check_holds(&digits(parts.birth), parts.birth_digit),
        valid_until: check_holds(&digits(parts.expiry), parts.expiry_digit),
        composite: parts.composite,
    };
    MrzData {
        format: parts.format,
        document_type: document_type(parts.code),
        document_number: (!number.trim().is_empty()).then(|| number.trim().to_string()),
        issuing_country: country_alpha2(parts.issuing),
        nationality: country_alpha2(parts.nationality),
        surname,
        given_names,
        birth_date: birth_date(parts.birth, today),
        sex: sex(as_letter(parts.sex)),
        valid_until: expiry_date(parts.expiry, today),
        checks,
        names_truncated,
    }
}

/// The number of a lower line with its check, repaired when one reading fits.
fn number_of(number: &str, digit: char) -> (String, bool) {
    match repaired_number(number, digit) {
        Some(repaired) => (repaired, true),
        None => (number.to_string(), false),
    }
}

fn composite_holds(parts: &[&str], digit: char) -> bool {
    check_holds(&parts.concat(), digit)
}

fn td3(upper: &str, lower: &str, today: NaiveDate) -> Option<MrzData> {
    if !upper.starts_with('P') {
        return None;
    }
    let line = lower_line(lower);
    let (number, number_holds) = number_of(line.number, line.number_digit);
    let composite_digit = lower[43..].chars().next()?;
    // The composite digit covers the number as printed and the digit fields.
    let composite = composite_holds(
        &[
            &number,
            &digits(&lower[9..10]),
            &digits(&lower[13..20]),
            &digits(&lower[21..28]),
            &lower[28..43],
        ],
        composite_digit,
    );
    Some(build(
        Parts {
            format: MrzFormat::Td3,
            code: &upper[0..2],
            issuing: &upper[2..5],
            names: &upper[5..44],
            number,
            number_holds,
            nationality: line.nationality,
            birth: line.birth,
            birth_digit: line.birth_digit,
            sex: line.sex,
            expiry: line.expiry,
            expiry_digit: line.expiry_digit,
            composite,
        },
        today,
    ))
}

fn td2(upper: &str, lower: &str, today: NaiveDate) -> Option<MrzData> {
    if !matches!(upper.chars().next()?, 'I' | 'A' | 'C' | 'P' | 'R') {
        return None;
    }
    let line = lower_line(lower);
    let (number, number_holds) = number_of(line.number, line.number_digit);
    let composite_digit = lower[35..].chars().next()?;
    let composite = composite_holds(
        &[
            &number,
            &digits(&lower[9..10]),
            &digits(&lower[13..20]),
            &digits(&lower[21..28]),
            &lower[28..35],
        ],
        composite_digit,
    );
    Some(build(
        Parts {
            format: MrzFormat::Td2,
            code: &upper[0..2],
            issuing: &upper[2..5],
            names: &upper[5..36],
            number,
            number_holds,
            nationality: line.nationality,
            birth: line.birth,
            birth_digit: line.birth_digit,
            sex: line.sex,
            expiry: line.expiry,
            expiry_digit: line.expiry_digit,
            composite,
        },
        today,
    ))
}

fn td1(first: &str, second: &str, third: &str, today: NaiveDate) -> Option<MrzData> {
    if !matches!(first.chars().next()?, 'I' | 'A' | 'C' | 'R') {
        return None;
    }
    let at = |line: &str, index: usize| line[index..].chars().next().unwrap_or('<');
    let optional = &first[15..30];
    // A number longer than nine characters goes on in the optional data,
    // closed by its check digit; the place of the digit then holds `<`.
    let (number, number_holds) = if at(first, 14) == '<' && !optional.starts_with('<') {
        let rest: String = optional.chars().take_while(|ch| *ch != '<').collect();
        let (body, digit) = rest.split_at(rest.len() - 1);
        let long = format!("{}{}", &first[5..14], body);
        let digit = digit.chars().next().unwrap_or('<');
        let holds = check_holds(&long, digit);
        (long, holds)
    } else {
        number_of(&first[5..14], at(first, 14))
    };
    let composite_digit = at(second, 29);
    let printed_number = if number.len() == 9 {
        number.as_str()
    } else {
        &first[5..14]
    };
    let composite = composite_holds(
        &[
            printed_number,
            &digits(&first[14..15]),
            optional,
            &digits(&second[0..7]),
            &digits(&second[8..15]),
            &second[18..29],
        ],
        composite_digit,
    );
    Some(build(
        Parts {
            format: MrzFormat::Td1,
            code: &first[0..2],
            issuing: &first[2..5],
            names: third,
            number,
            number_holds,
            nationality: &second[15..18],
            birth: &second[0..6],
            birth_digit: at(second, 6),
            sex: at(second, 7),
            expiry: &second[8..14],
            expiry_digit: at(second, 14),
            composite,
        },
        today,
    ))
}

/// One OCR line as the zone's alphabet: upper case, no spaces, nothing else.
fn clean(line: &str) -> String {
    line.chars()
        .filter_map(|ch| match ch {
            '«' | '‹' => Some('<'),
            ch if ch.is_ascii_alphanumeric() => Some(ch.to_ascii_uppercase()),
            '<' => Some('<'),
            _ => None,
        })
        .collect()
}

/// A line brought to the zone's width. OCR miscounts a long run of `<`, so a
/// line up to three characters off has its longest run stretched or cut; a
/// short line without a run is padded. The check digits judge the result.
fn fit(line: &str, width: usize) -> Option<String> {
    let length = line.len();
    if length == width {
        return Some(line.to_string());
    }
    if length.abs_diff(width) > 3 {
        return None;
    }
    let chars: Vec<char> = line.chars().collect();
    let mut best: Option<(usize, usize)> = None;
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '<' {
            index += 1;
            continue;
        }
        let start = index;
        while index < chars.len() && chars[index] == '<' {
            index += 1;
        }
        let run = index - start;
        if run >= 2 && best.is_none_or(|(_, longest)| run >= longest) {
            best = Some((start, run));
        }
    }
    match best {
        Some((start, run)) if length < width || run > length - width => {
            let target = run + width - length;
            let mut fitted: String = chars[..start].iter().collect();
            fitted.extend(std::iter::repeat_n('<', target));
            fitted.extend(chars[start + run..].iter());
            Some(fitted)
        }
        None if length < width => {
            let mut fitted = line.to_string();
            fitted.extend(std::iter::repeat_n('<', width - length));
            Some(fitted)
        }
        _ => None,
    }
}

/// The zone found in OCR text: the reading with the most check digits that
/// hold. `None` when no lines of a zone's shape are there.
pub(crate) fn read(text: &str, today: NaiveDate) -> Option<MrzData> {
    let lines: Vec<String> = text
        .lines()
        .map(clean)
        .filter(|line| line.len() >= 27)
        .collect();
    let mut best: Option<MrzData> = None;
    let mut offer = |candidate: Option<MrzData>| {
        // A reading none of whose check digits holds is not a zone.
        if let Some(candidate) = candidate
            && candidate.checks.passed() > 0
            && best
                .as_ref()
                .is_none_or(|current| candidate.checks.passed() > current.checks.passed())
        {
            best = Some(candidate);
        }
    };
    for index in 0..lines.len() {
        let pair = |width: usize| {
            let upper = fit(&lines[index], width)?;
            let lower = fit(lines.get(index + 1)?, width)?;
            Some((upper, lower))
        };
        if let Some((upper, lower)) = pair(44) {
            offer(td3(&upper, &lower, today));
        }
        if let Some((upper, lower)) = pair(36) {
            offer(td2(&upper, &lower, today));
        }
        if let (Some(first), Some(second), Some(third)) = (
            fit(&lines[index], 30),
            lines.get(index + 1).and_then(|line| fit(line, 30)),
            lines.get(index + 2).and_then(|line| fit(line, 30)),
        ) {
            offer(td1(&first, &second, &third, today));
        }
    }
    best
}

/// ISO 3166-1 alpha-3 to alpha-2.
const ISO_ALPHA3: &[(&str, &str)] = &[
    ("ABW", "AW"),
    ("AFG", "AF"),
    ("AGO", "AO"),
    ("AIA", "AI"),
    ("ALA", "AX"),
    ("ALB", "AL"),
    ("AND", "AD"),
    ("ARE", "AE"),
    ("ARG", "AR"),
    ("ARM", "AM"),
    ("ASM", "AS"),
    ("ATA", "AQ"),
    ("ATF", "TF"),
    ("ATG", "AG"),
    ("AUS", "AU"),
    ("AUT", "AT"),
    ("AZE", "AZ"),
    ("BDI", "BI"),
    ("BEL", "BE"),
    ("BEN", "BJ"),
    ("BES", "BQ"),
    ("BFA", "BF"),
    ("BGD", "BD"),
    ("BGR", "BG"),
    ("BHR", "BH"),
    ("BHS", "BS"),
    ("BIH", "BA"),
    ("BLM", "BL"),
    ("BLR", "BY"),
    ("BLZ", "BZ"),
    ("BMU", "BM"),
    ("BOL", "BO"),
    ("BRA", "BR"),
    ("BRB", "BB"),
    ("BRN", "BN"),
    ("BTN", "BT"),
    ("BVT", "BV"),
    ("BWA", "BW"),
    ("CAF", "CF"),
    ("CAN", "CA"),
    ("CCK", "CC"),
    ("CHE", "CH"),
    ("CHL", "CL"),
    ("CHN", "CN"),
    ("CIV", "CI"),
    ("CMR", "CM"),
    ("COD", "CD"),
    ("COG", "CG"),
    ("COK", "CK"),
    ("COL", "CO"),
    ("COM", "KM"),
    ("CPV", "CV"),
    ("CRI", "CR"),
    ("CUB", "CU"),
    ("CUW", "CW"),
    ("CXR", "CX"),
    ("CYM", "KY"),
    ("CYP", "CY"),
    ("CZE", "CZ"),
    ("DEU", "DE"),
    ("DJI", "DJ"),
    ("DMA", "DM"),
    ("DNK", "DK"),
    ("DOM", "DO"),
    ("DZA", "DZ"),
    ("ECU", "EC"),
    ("EGY", "EG"),
    ("ERI", "ER"),
    ("ESH", "EH"),
    ("ESP", "ES"),
    ("EST", "EE"),
    ("ETH", "ET"),
    ("FIN", "FI"),
    ("FJI", "FJ"),
    ("FLK", "FK"),
    ("FRA", "FR"),
    ("FRO", "FO"),
    ("FSM", "FM"),
    ("GAB", "GA"),
    ("GBR", "GB"),
    ("GEO", "GE"),
    ("GGY", "GG"),
    ("GHA", "GH"),
    ("GIB", "GI"),
    ("GIN", "GN"),
    ("GLP", "GP"),
    ("GMB", "GM"),
    ("GNB", "GW"),
    ("GNQ", "GQ"),
    ("GRC", "GR"),
    ("GRD", "GD"),
    ("GRL", "GL"),
    ("GTM", "GT"),
    ("GUF", "GF"),
    ("GUM", "GU"),
    ("GUY", "GY"),
    ("HKG", "HK"),
    ("HMD", "HM"),
    ("HND", "HN"),
    ("HRV", "HR"),
    ("HTI", "HT"),
    ("HUN", "HU"),
    ("IDN", "ID"),
    ("IMN", "IM"),
    ("IND", "IN"),
    ("IOT", "IO"),
    ("IRL", "IE"),
    ("IRN", "IR"),
    ("IRQ", "IQ"),
    ("ISL", "IS"),
    ("ISR", "IL"),
    ("ITA", "IT"),
    ("JAM", "JM"),
    ("JEY", "JE"),
    ("JOR", "JO"),
    ("JPN", "JP"),
    ("KAZ", "KZ"),
    ("KEN", "KE"),
    ("KGZ", "KG"),
    ("KHM", "KH"),
    ("KIR", "KI"),
    ("KNA", "KN"),
    ("KOR", "KR"),
    ("KWT", "KW"),
    ("LAO", "LA"),
    ("LBN", "LB"),
    ("LBR", "LR"),
    ("LBY", "LY"),
    ("LCA", "LC"),
    ("LIE", "LI"),
    ("LKA", "LK"),
    ("LSO", "LS"),
    ("LTU", "LT"),
    ("LUX", "LU"),
    ("LVA", "LV"),
    ("MAC", "MO"),
    ("MAF", "MF"),
    ("MAR", "MA"),
    ("MCO", "MC"),
    ("MDA", "MD"),
    ("MDG", "MG"),
    ("MDV", "MV"),
    ("MEX", "MX"),
    ("MHL", "MH"),
    ("MKD", "MK"),
    ("MLI", "ML"),
    ("MLT", "MT"),
    ("MMR", "MM"),
    ("MNE", "ME"),
    ("MNG", "MN"),
    ("MNP", "MP"),
    ("MOZ", "MZ"),
    ("MRT", "MR"),
    ("MSR", "MS"),
    ("MTQ", "MQ"),
    ("MUS", "MU"),
    ("MWI", "MW"),
    ("MYS", "MY"),
    ("MYT", "YT"),
    ("NAM", "NA"),
    ("NCL", "NC"),
    ("NER", "NE"),
    ("NFK", "NF"),
    ("NGA", "NG"),
    ("NIC", "NI"),
    ("NIU", "NU"),
    ("NLD", "NL"),
    ("NOR", "NO"),
    ("NPL", "NP"),
    ("NRU", "NR"),
    ("NZL", "NZ"),
    ("OMN", "OM"),
    ("PAK", "PK"),
    ("PAN", "PA"),
    ("PCN", "PN"),
    ("PER", "PE"),
    ("PHL", "PH"),
    ("PLW", "PW"),
    ("PNG", "PG"),
    ("POL", "PL"),
    ("PRI", "PR"),
    ("PRK", "KP"),
    ("PRT", "PT"),
    ("PRY", "PY"),
    ("PSE", "PS"),
    ("PYF", "PF"),
    ("QAT", "QA"),
    ("REU", "RE"),
    ("ROU", "RO"),
    ("RUS", "RU"),
    ("RWA", "RW"),
    ("SAU", "SA"),
    ("SDN", "SD"),
    ("SEN", "SN"),
    ("SGP", "SG"),
    ("SGS", "GS"),
    ("SHN", "SH"),
    ("SJM", "SJ"),
    ("SLB", "SB"),
    ("SLE", "SL"),
    ("SLV", "SV"),
    ("SMR", "SM"),
    ("SOM", "SO"),
    ("SPM", "PM"),
    ("SRB", "RS"),
    ("SSD", "SS"),
    ("STP", "ST"),
    ("SUR", "SR"),
    ("SVK", "SK"),
    ("SVN", "SI"),
    ("SWE", "SE"),
    ("SWZ", "SZ"),
    ("SXM", "SX"),
    ("SYC", "SC"),
    ("SYR", "SY"),
    ("TCA", "TC"),
    ("TCD", "TD"),
    ("TGO", "TG"),
    ("THA", "TH"),
    ("TJK", "TJ"),
    ("TKL", "TK"),
    ("TKM", "TM"),
    ("TLS", "TL"),
    ("TON", "TO"),
    ("TTO", "TT"),
    ("TUN", "TN"),
    ("TUR", "TR"),
    ("TUV", "TV"),
    ("TWN", "TW"),
    ("TZA", "TZ"),
    ("UGA", "UG"),
    ("UKR", "UA"),
    ("UMI", "UM"),
    ("URY", "UY"),
    ("USA", "US"),
    ("UZB", "UZ"),
    ("VAT", "VA"),
    ("VCT", "VC"),
    ("VEN", "VE"),
    ("VGB", "VG"),
    ("VIR", "VI"),
    ("VNM", "VN"),
    ("VUT", "VU"),
    ("WLF", "WF"),
    ("WSM", "WS"),
    ("YEM", "YE"),
    ("ZAF", "ZA"),
    ("ZMB", "ZM"),
    ("ZWE", "ZW"),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 10).unwrap()
    }

    fn date(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
        NaiveDate::from_ymd_opt(year, month, day)
    }

    fn with_digit(field: &str) -> String {
        format!("{field}{}", check_digit(field).unwrap())
    }

    /// A synthetic passport zone with correct check digits.
    fn passport(
        state: &str,
        names: &str,
        number: &str,
        birth: &str,
        sex: char,
        expiry: &str,
    ) -> String {
        let upper = format!("{:<<44}", format!("P<{state}{names}"));
        let number = with_digit(&format!("{number:<<9}"));
        let birth = with_digit(birth);
        let expiry = with_digit(expiry);
        let personal = format!("{:<<14}", "");
        let personal = format!("{personal}{}", check_digit(&personal).unwrap());
        let body = format!("{number}{state}{birth}{sex}{expiry}{personal}");
        let composite = check_digit(&format!("{number}{birth}{expiry}{personal}")).unwrap();
        format!("{upper}\n{body}{composite}")
    }

    // The specimens of ICAO Doc 9303 (parts 4, 5 and 6): the state "Utopia".
    const ICAO_TD3: &str = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
    const ICAO_TD1: &str = "I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<";
    const ICAO_TD2: &str =
        "I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<\nD231458907UTO7408122F1204159<<<<<<<6";

    #[test]
    fn check_digit_follows_the_icao_example() {
        assert_eq!(check_digit("520727"), Some(3));
        assert_eq!(check_digit("AB2134<<<"), Some(5));
        assert_eq!(check_digit("L898902C3"), Some(6));
    }

    #[test]
    fn reads_the_icao_passport_specimen() {
        let data = read(ICAO_TD3, today()).unwrap();
        assert_eq!(data.format, MrzFormat::Td3);
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.document_type, Some("passport"));
        assert_eq!(data.document_number.as_deref(), Some("L898902C3"));
        assert_eq!(data.surname.as_deref(), Some("Eriksson"));
        assert_eq!(data.given_names.as_deref(), Some("Anna Maria"));
        assert_eq!(data.birth_date, date(1974, 8, 12));
        assert_eq!(data.valid_until, date(2012, 4, 15));
        assert_eq!(data.sex, Some("female"));
        // Utopia is no state: the country is left open, never guessed.
        assert_eq!(data.issuing_country, None);
        assert_eq!(data.nationality, None);
        assert!(!data.names_truncated);
    }

    #[test]
    fn reads_the_icao_card_specimens() {
        let td1 = read(ICAO_TD1, today()).unwrap();
        assert_eq!(td1.format, MrzFormat::Td1);
        assert!(td1.checks.all(), "{:?}", td1.checks);
        assert_eq!(td1.document_type, Some("id_card"));
        assert_eq!(td1.document_number.as_deref(), Some("D23145890"));
        assert_eq!(td1.surname.as_deref(), Some("Eriksson"));
        assert_eq!(td1.birth_date, date(1974, 8, 12));
        assert_eq!(td1.valid_until, date(2012, 4, 15));

        let td2 = read(ICAO_TD2, today()).unwrap();
        assert_eq!(td2.format, MrzFormat::Td2);
        assert!(td2.checks.all(), "{:?}", td2.checks);
        assert_eq!(td2.document_number.as_deref(), Some("D23145890"));
        assert_eq!(td2.given_names.as_deref(), Some("Anna Maria"));
    }

    #[test]
    fn reads_countries_as_alpha2_codes() {
        let zone = passport(
            "UKR",
            "MUSTERENKO<<OLENA",
            "FA123456",
            "900215",
            'F',
            "310214",
        );
        let data = read(&zone, today()).unwrap();
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.issuing_country.as_deref(), Some("UA"));
        assert_eq!(data.nationality.as_deref(), Some("UA"));
        assert_eq!(data.document_number.as_deref(), Some("FA123456"));
        assert_eq!(data.birth_date, date(1990, 2, 15));
        assert_eq!(data.valid_until, date(2031, 2, 14));

        // Germany is "D" with filler.
        let zone = passport(
            "D<<",
            "MUSTERMANN<<ERIKA",
            "C01X00T47",
            "640812",
            'F',
            "270228",
        );
        let data = read(&zone, today()).unwrap();
        assert!(data.checks.all());
        assert_eq!(data.issuing_country.as_deref(), Some("DE"));
        assert_eq!(data.nationality.as_deref(), Some("DE"));
    }

    #[test]
    fn a_child_born_this_century_is_not_a_hundred_years_old() {
        let zone = passport(
            "UKR",
            "MUSTERENKO<<MARKO",
            "FB765432",
            "190503",
            'M',
            "290502",
        );
        let data = read(&zone, today()).unwrap();
        assert_eq!(data.birth_date, date(2019, 5, 3));
        assert_eq!(data.sex, Some("male"));
    }

    #[test]
    fn finds_the_zone_in_noisy_text_with_spaces() {
        let spaced: String = ICAO_TD3.chars().flat_map(|ch| [ch, ' ']).collect();
        let text = format!("UTOPIA\nPASSPORT / PASSEPORT\nEriksson\n12 AUG/AOUT 74\n{spaced}\n");
        let data = read(&text, today()).unwrap();
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.document_number.as_deref(), Some("L898902C3"));
    }

    #[test]
    fn a_misread_digit_fails_its_check_and_is_reported() {
        // The year of expiry read as 13 instead of 12.
        let zone = ICAO_TD3.replace("1204159", "1304159");
        let data = read(&zone, today()).unwrap();
        assert!(!data.checks.valid_until);
        assert!(!data.checks.composite);
        assert!(data.checks.document_number);
        assert!(data.checks.birth_date);
        assert!(!data.checks.all());
    }

    #[test]
    fn letters_read_for_digits_in_dates_are_set_right() {
        // "O" for "0" and "I" for "1" in the dates and their check digits.
        let zone = ICAO_TD3.replace("7408122F1204159", "74O8I22FI2O4I59");
        let data = read(&zone, today()).unwrap();
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.birth_date, date(1974, 8, 12));
        assert_eq!(data.valid_until, date(2012, 4, 15));
    }

    #[test]
    fn one_ambiguous_character_of_the_number_is_repaired_by_its_check_digit() {
        // "0" read as "O" in the number: only "0" satisfies the check digit.
        let zone = ICAO_TD3.replace("L898902C3", "L8989O2C3");
        let data = read(&zone, today()).unwrap();
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.document_number.as_deref(), Some("L898902C3"));
    }

    #[test]
    fn a_miscounted_filler_run_is_fitted_to_the_width() {
        // One "<" too few in the upper line, one too many in the lower one.
        let zone = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<<10";
        let data = read(zone, today()).unwrap();
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.given_names.as_deref(), Some("Anna Maria"));
    }

    #[test]
    fn filler_read_as_letters_does_not_become_a_name() {
        let zone = ICAO_TD3.replace(
            "ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
            "ANNA<MARIA<<<<K<<<<<L<<<<<<<<",
        );
        let data = read(&zone, today()).unwrap();
        assert_eq!(data.given_names.as_deref(), Some("Anna Maria"));
        // A slanted scan: the end of the filler read as letters and a digit.
        let zone = ICAO_TD3.replace(
            "ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
            "ANNA<MARIA<<<<<<<<<<<<<<<<SS5",
        );
        let data = read(&zone, today()).unwrap();
        assert_eq!(data.surname.as_deref(), Some("Eriksson"));
        assert_eq!(data.given_names.as_deref(), Some("Anna Maria"));
        // A surname that ends in such letters stays whole.
        let zone = passport("DEU", "BECK<<LUCK", "C01X00T47", "640812", 'M', "270228");
        let data = read(&zone, today()).unwrap();
        assert_eq!(data.surname.as_deref(), Some("Beck"));
        assert_eq!(data.given_names.as_deref(), Some("Luck"));
    }

    #[test]
    fn a_name_that_fills_the_field_is_marked_as_cut() {
        let zone = passport(
            "UKR",
            "MUSTERENKO<MUSTERMANNIVSKA<<OLEKSANDRAS",
            "FA123456",
            "900215",
            'F',
            "310214",
        );
        let data = read(&zone, today()).unwrap();
        assert!(data.names_truncated);
        assert_eq!(data.surname.as_deref(), Some("Musterenko Mustermannivska"));
    }

    #[test]
    fn a_long_card_number_continues_in_the_optional_data() {
        // Nine characters, "<" in place of the digit, then the rest and its digit.
        let number = "D23145890734";
        let digit = check_digit(number).unwrap();
        let first = format!(
            "{:<<30}",
            format!("IDBEL{}<{}{digit}", &number[..9], &number[9..])
        );
        let birth = with_digit("740812");
        let expiry = with_digit("301231");
        let second_body = format!("{birth}F{expiry}BEL{:<<11}", "");
        let composite = check_digit(&format!(
            "{}{}{}{}",
            &first[5..],
            birth,
            expiry,
            &second_body[18..]
        ))
        .unwrap();
        let zone = format!("{first}\n{second_body}{composite}\n{:<<30}", "MUSTER<<ANNA");
        let data = read(&zone, today()).unwrap();
        assert_eq!(data.format, MrzFormat::Td1);
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.document_number.as_deref(), Some(number));
        assert_eq!(data.issuing_country.as_deref(), Some("BE"));
    }

    #[test]
    fn residence_permits_and_cards_are_told_apart() {
        assert_eq!(document_type("P<"), Some("passport"));
        assert_eq!(document_type("PD"), Some("passport"));
        assert_eq!(document_type("ID"), Some("id_card"));
        assert_eq!(document_type("I<"), Some("id_card"));
        assert_eq!(document_type("AR"), Some("residence_permit"));
        assert_eq!(document_type("V<"), None);
    }

    #[test]
    fn reads_what_the_ocr_of_this_server_gives() {
        // tesseract 5.3 on synthetic scans of the ICAO specimens: "UTO" read
        // as "UT0", spaces inside a line of a slanted scan.
        let text = "15APR2012
P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<SS5
L898902C36UT07 408122F1204 159ZE184226B<<<<< 10
";
        let data = read(text, today()).unwrap();
        assert!(data.checks.all(), "{:?}", data.checks);
        assert_eq!(data.document_number.as_deref(), Some("L898902C3"));
        assert_eq!(data.given_names.as_deref(), Some("Anna Maria"));

        // A digit of the card number misread: the zone is found, its number is not confirmed.
        let text = "I<UT0D231458904<<<<<<<<<<<<<<<
7408122F1204159UT0<<<<<<<<<<<6
ERIKSSON<<ANNA<MARIA<<<<<<<<<<";
        let data = read(text, today()).unwrap();
        assert_eq!(data.format, MrzFormat::Td1);
        assert!(!data.checks.document_number);
        assert!(data.checks.birth_date && data.checks.valid_until);
        assert!(!data.checks.all());

        // An upside-down page read without orientation detection: letters, no zone.
        let text = "OTSE9CCVSTAZOSTVOCTACZL8OVLOLNIEDTO68681
SPSSSSSS5SSS555555SVLYVWEVNNVSSNOSSMIYSOLNS";
        assert_eq!(read(text, today()), None);
    }

    #[test]
    fn text_without_a_zone_reads_nothing() {
        assert_eq!(read("", today()), None);
        assert_eq!(
            read(
                "Bundesrepublik Deutschland\nReisepass\nMustermann, Erika",
                today()
            ),
            None
        );
        assert_eq!(
            read(
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                today()
            ),
            None
        );
    }
}
