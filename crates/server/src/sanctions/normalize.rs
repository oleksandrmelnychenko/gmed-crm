//! Name and country normalisation for sanctions screening.
//!
//! Names from the EU list and from our records are reduced to the same
//! canonical Latin form so that spelling variants of one name compare equal or
//! nearly equal: case, diacritics and punctuation are dropped, Cyrillic is
//! transliterated, and the usual transliteration differences between English,
//! German and French spellings of Slavic names are folded
//! (`Ivanov` / `Iwanow` / `Ivanoff`, `Yuri` / `Juri` / `Iouri`, `Zhukov` /
//! `Schukow`). See `docs/architecture/sanctions-screening_ua.md`.

use unicode_normalization::UnicodeNormalization;

/// One canonical name token with the derived forms the matcher compares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameToken {
    /// Canonical Latin form (`ivanov`).
    pub canon: String,
    /// Consonant skeleton of the canonical form (`vnv`), used for vowel
    /// variants such as `Mohammed` / `Muhammad`.
    pub skeleton: String,
    /// Whether the token looks like an East Slavic patronymic (`Ivanovich`).
    pub patronymic: bool,
}

impl NameToken {
    fn from_canon(canon: String) -> Self {
        let skeleton = consonant_skeleton(&canon);
        let patronymic = is_patronymic(&canon);
        Self {
            canon,
            skeleton,
            patronymic,
        }
    }
}

/// Splits a free-text name into canonical tokens. Tokens written in a script
/// other than Latin or Cyrillic (Arabic, Chinese, ...) are dropped: the list
/// carries Latin aliases for such names, and a half-transliterated token would
/// only produce noise.
pub fn name_tokens(value: &str) -> Vec<NameToken> {
    let mut tokens = Vec::new();
    for raw in split_raw_tokens(value) {
        let Some(latin) = latinize_token(&raw) else {
            continue;
        };
        let canon = canonical_token(&latin);
        if canon.is_empty() {
            continue;
        }
        tokens.push(NameToken::from_canon(canon));
    }
    tokens
}

/// Lower-case, punctuation-free raw tokens (still in their original script).
fn split_raw_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in value.chars() {
        // Apostrophes inside a name (O'Neill, Kur'yanov) join the parts.
        if ch == '\'' || ch == '’' || ch == 'ʼ' || ch == '`' {
            continue;
        }
        if ch.is_alphabetic() || ch.is_ascii_digit() || is_combining_mark(ch) {
            current.extend(ch.to_lowercase());
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens.retain(|token| !token.chars().all(|ch| ch.is_ascii_digit()));
    tokens
}

fn is_combining_mark(ch: char) -> bool {
    matches!(ch as u32, 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

/// Latin or Cyrillic token → plain `a-z`. Returns `None` for other scripts.
fn latinize_token(token: &str) -> Option<String> {
    let mut out = String::with_capacity(token.len() + 4);
    for ch in token.chars() {
        if let Some(mapped) = cyrillic_to_latin(ch) {
            out.push_str(mapped);
            continue;
        }
        if let Some(mapped) = special_latin(ch) {
            out.push_str(mapped);
            continue;
        }
        // Decompose accented Latin letters and keep the base letter.
        let mut kept_any = false;
        for decomposed in ch.nfkd() {
            if decomposed.is_ascii_lowercase() {
                out.push(decomposed);
                kept_any = true;
            } else if decomposed.is_ascii_uppercase() {
                out.push(decomposed.to_ascii_lowercase());
                kept_any = true;
            } else if is_combining_mark(decomposed) {
                continue;
            } else if decomposed.is_alphabetic() {
                return None;
            }
        }
        if !kept_any && ch.is_alphabetic() && !is_combining_mark(ch) {
            return None;
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

fn special_latin(ch: char) -> Option<&'static str> {
    Some(match ch {
        'ß' => "ss",
        'æ' => "ae",
        'œ' => "oe",
        'ø' => "o",
        'ł' => "l",
        'đ' | 'ð' => "d",
        'þ' => "th",
        'ı' => "i",
        'ħ' => "h",
        _ => return None,
    })
}

/// Cyrillic letters (Russian, Ukrainian, Belarusian) in a simple
/// BGN/PCGN-like scheme; the canonical folding below absorbs the rest.
fn cyrillic_to_latin(ch: char) -> Option<&'static str> {
    Some(match ch {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' => "g",
        'ґ' => "g",
        'д' => "d",
        'е' => "e",
        'ё' => "e",
        'є' => "ye",
        'ж' => "zh",
        'з' => "z",
        'и' => "i",
        'і' => "i",
        'ї' => "yi",
        'й' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ў' => "u",
        'ф' => "f",
        'х' => "kh",
        'ц' => "ts",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "shch",
        'ъ' | 'ь' => "",
        'ы' => "y",
        'э' => "e",
        'ю' => "yu",
        'я' => "ya",
        _ => return None,
    })
}

/// Folds transliteration variants of one `a-z` token into one spelling.
///
/// The rules are deliberately few and symmetric: they run on both the list
/// and our records, so a rule only has to map variants onto the same string,
/// not onto the "correct" spelling.
pub fn canonical_token(latin: &str) -> String {
    let mut value = latin.to_string();
    // German spellings of Russian sibilants.
    value = value.replace("schtsch", "shch");
    value = value.replace("tsch", "ch");
    value = value.replace("sch", "sh");
    value = value.replace("zh", "sh");
    value = value.replace("kh", "h");
    value = value.replace("ph", "f");
    value = value.replace("th", "t");
    value = value.replace("tz", "ts");
    value = value.replace('x', "ks");
    value = value.replace('q', "k");
    value = value.replace("ck", "k");
    // `c` outside `ch` is a `k` (Viktor / Victor); `ch` stays a digraph.
    let chars: Vec<char> = value.chars().collect();
    let mut folded = String::with_capacity(value.len());
    for (index, ch) in chars.iter().enumerate() {
        if *ch == 'c' && chars.get(index + 1) != Some(&'h') {
            folded.push('k');
        } else {
            folded.push(*ch);
        }
    }
    value = folded;
    value = value.replace('w', "v");
    // French `ou` for `u` (Iouri), `j`/`y` for the `й`/`ы`/`и` sounds.
    value = value.replace("ou", "u");
    value = value.replace(['j', 'y'], "i");
    // Final -off / -eff (Ivanoff, Prokofieff).
    if let Some(stem) = value.strip_suffix("off") {
        value = format!("{stem}ov");
    } else if let Some(stem) = value.strip_suffix("eff") {
        value = format!("{stem}ev");
    }
    collapse_repeats(&value)
}

fn collapse_repeats(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut previous = None;
    for ch in value.chars() {
        if Some(ch) != previous {
            out.push(ch);
        }
        previous = Some(ch);
    }
    out
}

fn consonant_skeleton(canon: &str) -> String {
    collapse_repeats(
        &canon
            .chars()
            .filter(|ch| !matches!(ch, 'a' | 'e' | 'i' | 'o' | 'u'))
            .collect::<String>(),
    )
}

fn is_patronymic(canon: &str) -> bool {
    canon.len() > 6
        && ["ovich", "evich", "ovna", "evna", "ichna", "ovitch"]
            .iter()
            .any(|suffix| canon.ends_with(suffix))
}

/// Legal-form words that do not identify an organisation.
const LEGAL_FORM_TOKENS: &[&str] = &[
    "ltd",
    "llc",
    "lc",
    "gmbh",
    "ag",
    "kg",
    "ug",
    "sa",
    "sarl",
    "spa",
    "srl",
    "bv",
    "nv",
    "oo",
    "ooo",
    "oao",
    "zao",
    "pao",
    "ao",
    "iao",
    "jsc",
    "pjsc",
    "ojsc",
    "zjsc",
    "ik",
    "inc",
    "korp",
    "korporation",
    "korporatsia",
    "ko",
    "kompani",
    "kompania",
    "limited",
    "pli",
    "plc",
    "fze",
    "fzk",
    "fzko",
    "tov",
    "pat",
    "llp",
    "lp",
    "the",
    "of",
    "and",
];

/// Organisation tokens without legal forms and connectors.
pub fn organisation_tokens(value: &str) -> Vec<NameToken> {
    name_tokens(value)
        .into_iter()
        .filter(|token| {
            !LEGAL_FORM_TOKENS
                .iter()
                .any(|legal| canonical_token(legal) == token.canon)
        })
        .collect()
}

/// Normalises a stored country value to an ISO 3166-1 alpha-2 code. Accepts
/// codes and the country names and demonyms older records hold (English,
/// German, Russian, Ukrainian). Returns `None` when the value is unknown.
pub fn country_code(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.len() == 2 && trimmed.chars().all(|ch| ch.is_ascii_alphabetic()) {
        let code = trimmed.to_ascii_uppercase();
        // FSF uses `00` for "unknown"; it never reaches here (digits).
        return Some(code);
    }
    let key = trimmed.to_lowercase();
    let code = match key.as_str() {
        "russia"
        | "russian federation"
        | "russland"
        | "russische föderation"
        | "russian"
        | "russisch"
        | "россия"
        | "российская федерация"
        | "русский"
        | "русская"
        | "росія"
        | "російська федерація" => "RU",
        "belarus"
        | "weißrussland"
        | "weissrussland"
        | "belarusian"
        | "belarussisch"
        | "беларусь"
        | "белоруссия"
        | "білорусь" => "BY",
        "ukraine" | "ukrainian" | "ukrainisch" | "украина" | "україна" => "UA",
        "germany" | "deutschland" | "german" | "deutsch" | "германия" | "німеччина" => {
            "DE"
        }
        "iran" | "islamic republic of iran" | "иран" | "іран" => "IR",
        "north korea"
        | "nordkorea"
        | "democratic people's republic of korea"
        | "кндр"
        | "северная корея" => "KP",
        "syria" | "syrien" | "syrian arab republic" | "сирия" => "SY",
        "cuba" | "kuba" | "куба" => "CU",
        "venezuela" | "венесуэла" => "VE",
        "afghanistan" | "афганистан" => "AF",
        "myanmar" | "burma" | "мьянма" => "MM",
        "kazakhstan" | "kasachstan" | "казахстан" => "KZ",
        "georgia" | "georgien" | "грузия" => "GE",
        "armenia" | "armenien" | "армения" => "AM",
        "azerbaijan" | "aserbaidschan" | "азербайджан" => "AZ",
        "moldova" | "moldawien" | "молдова" | "молдавия" => "MD",
        "uzbekistan" | "usbekistan" | "узбекистан" => "UZ",
        "kyrgyzstan" | "kirgisistan" | "киргизия" | "кыргызстан" => "KG",
        "tajikistan" | "tadschikistan" | "таджикистан" => "TJ",
        "turkmenistan" | "туркменистан" => "TM",
        "turkey" | "türkei" | "turkiye" | "türkiye" | "турция" => "TR",
        "austria" | "österreich" | "австрия" => "AT",
        "switzerland" | "schweiz" | "швейцария" => "CH",
        "poland" | "polen" | "польша" => "PL",
        "united kingdom" | "großbritannien" | "vereinigtes königreich" => "GB",
        "united states" | "usa" | "vereinigte staaten" | "сша" => "US",
        "united arab emirates" | "vereinigte arabische emirate" | "оаэ" => "AE",
        "china" | "китай" => "CN",
        "israel" | "израиль" => "IL",
        "czech republic" | "czechia" | "tschechien" => "CZ",
        "latvia" | "lettland" | "латвия" => "LV",
        "lithuania" | "litauen" | "литва" => "LT",
        "estonia" | "estland" | "эстония" => "EE",
        _ => return None,
    };
    Some(code.to_string())
}

/// Unique ISO codes from several stored values.
pub fn country_codes<'a>(values: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut codes: Vec<String> = Vec::new();
    for value in values {
        if let Some(code) = country_code(value)
            && !codes.contains(&code)
        {
            codes.push(code);
        }
    }
    codes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canon(value: &str) -> Vec<String> {
        name_tokens(value)
            .into_iter()
            .map(|token| token.canon)
            .collect()
    }

    #[test]
    fn transliteration_variants_share_one_canonical_form() {
        assert_eq!(canon("Ivanov"), canon("Iwanow"));
        assert_eq!(canon("Ivanov"), canon("Ivanoff"));
        assert_eq!(canon("Ivanov"), canon("ИВАНОВ"));
        assert_eq!(canon("Yuri"), canon("Juri"));
        assert_eq!(canon("Yuri"), canon("Iouri"));
        assert_eq!(canon("Юрий"), canon("Yuriy"));
        assert_eq!(canon("Zhukov"), canon("Schukow"));
        assert_eq!(canon("Aleksandr"), canon("Alexandr"));
        assert_eq!(canon("Dmitriy"), canon("Dmitrij"));
        assert_eq!(canon("Sergey"), canon("Sergej"));
        assert_eq!(canon("Viktor"), canon("Victor"));
        assert_eq!(canon("Mikhail"), canon("Михаил"));
    }

    #[test]
    fn case_diacritics_and_punctuation_are_ignored() {
        assert_eq!(canon("MÜLLER-Lüdenscheidt"), vec!["muler", "ludensheidt"]);
        assert_eq!(canon("  o'Brien,  Seán "), vec!["obrien", "sean"]);
        assert_eq!(canon("Łukasz Żółć"), vec!["lukasz", "zolk"]);
        assert_eq!(canon("Straße"), vec!["strase"]);
    }

    #[test]
    fn other_scripts_and_numbers_are_dropped() {
        assert_eq!(canon("محمد Ivan 1975"), vec!["ivan"]);
        assert!(canon("王伟").is_empty());
    }

    #[test]
    fn patronymics_and_skeletons_are_derived() {
        let tokens = name_tokens("Ivan Ivanovich Mohammed");
        assert!(!tokens[0].patronymic);
        assert!(tokens[1].patronymic);
        assert_eq!(tokens[2].skeleton, name_tokens("Muhammad")[0].skeleton);
    }

    #[test]
    fn organisation_tokens_drop_legal_forms() {
        let tokens: Vec<String> = organisation_tokens("OOO Romashka Trading Ltd")
            .into_iter()
            .map(|token| token.canon)
            .collect();
        assert_eq!(tokens, vec!["romashka", "trading"]);
    }

    #[test]
    fn country_values_become_iso_codes() {
        assert_eq!(country_code("ru").as_deref(), Some("RU"));
        assert_eq!(country_code("Russland").as_deref(), Some("RU"));
        assert_eq!(country_code("Российская Федерация").as_deref(), Some("RU"));
        assert_eq!(country_code("Belarus").as_deref(), Some("BY"));
        assert_eq!(country_code("Atlantis"), None);
        assert_eq!(country_code(" "), None);
        assert_eq!(country_codes(["DE", "Germany", "RU"]), vec!["DE", "RU"]);
    }
}
