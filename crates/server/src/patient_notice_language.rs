//! The one rule for the language of a notification stored for a patient's
//! portal login (verification 2026-11-10: one patient had visit notices in
//! Russian, money notices in German and the rest in English — the portal
//! rewords every kind, an e-mail or a push would not).
//!
//! The stored `title` and `body` are worded in
//!
//! 1. the language of the login itself (`users.preferred_language`), else
//! 2. the first language of the patient (`patients.languages`) the notices
//!    exist in, else
//! 3. English — what the oldest kinds (`recommendation`, …) always store.
//!
//! The notices exist in German, Russian, Ukrainian and English. A caller
//! binds its wordings as one JSONB value ([`Texts::to_json`]) and lets the
//! `INSERT … SELECT` pick per login with [`text_sql`]; `kind` and `params`
//! still carry the facts for a portal that words the notice itself.

use serde_json::{Value, json};

/// The languages a stored patient notification is worded in.
#[cfg(test)]
pub(crate) const LANGUAGES: [&str; 4] = ["de", "ru", "uk", "en"];

/// The language of a login without a language whose patient has none either.
pub(crate) const FALLBACK_LANGUAGE: &str = "en";

/// One wording (a title or a text) in every language of [`LANGUAGES`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Texts {
    pub(crate) de: String,
    pub(crate) ru: String,
    pub(crate) uk: String,
    pub(crate) en: String,
}

impl Texts {
    pub(crate) fn new(
        de: impl Into<String>,
        ru: impl Into<String>,
        uk: impl Into<String>,
        en: impl Into<String>,
    ) -> Self {
        Self {
            de: de.into(),
            ru: ru.into(),
            uk: uk.into(),
            en: en.into(),
        }
    }

    /// One wording for every language: a kind that is stored in one language
    /// only (the oldest kinds, in English) or a text without words.
    pub(crate) fn same(value: &str) -> Self {
        Self::new(value, value, value, value)
    }

    /// `{"de": …, "ru": …, "uk": …, "en": …}`: the value [`text_sql`] reads.
    pub(crate) fn to_json(&self) -> Value {
        json!({ "de": self.de, "ru": self.ru, "uk": self.uk, "en": self.en })
    }

    /// The wording in `language`; English for a language without one.
    #[cfg(test)]
    pub(crate) fn in_language(&self, language: &str) -> &str {
        match language {
            "de" => &self.de,
            "ru" => &self.ru,
            "uk" => &self.uk,
            _ => &self.en,
        }
    }
}

/// A language tag as the notices know it: `de-DE` → `de`, `ua` → `uk`.
#[cfg(test)]
fn normalize(value: &str) -> Option<&'static str> {
    let value = value.trim().to_ascii_lowercase();
    let primary = value.split(['-', '_']).next().unwrap_or_default();
    match primary {
        "de" => Some("de"),
        "ru" => Some("ru"),
        "uk" | "ua" => Some("uk"),
        "en" => Some("en"),
        _ => None,
    }
}

/// The rule in Rust (the twin of [`language_sql`]): the login's language,
/// else the patient's first known language, else English. Tests state the
/// rule with it; the notices themselves are picked in SQL.
#[cfg(test)]
pub(crate) fn resolve(
    preferred_language: Option<&str>,
    patient_languages: &[String],
) -> &'static str {
    preferred_language
        .and_then(normalize)
        .or_else(|| patient_languages.iter().find_map(|value| normalize(value)))
        .unwrap_or(FALLBACK_LANGUAGE)
}

/// SQL expression (text): the language of a notification for the login
/// `user_alias` (an alias of `users`) of the patient `patient_id_sql` (an
/// SQL expression of type uuid, a column or a typed parameter).
pub(crate) fn language_sql(user_alias: &str, patient_id_sql: &str) -> String {
    format!(
        r#"COALESCE(
               (SELECT CASE split_part(translate(lower(btrim({user_alias}.preferred_language)), '_', '-'), '-', 1)
                           WHEN 'ua' THEN 'uk'
                           ELSE split_part(translate(lower(btrim({user_alias}.preferred_language)), '_', '-'), '-', 1)
                       END
                WHERE split_part(translate(lower(btrim({user_alias}.preferred_language)), '_', '-'), '-', 1)
                      IN ('de', 'ru', 'uk', 'ua', 'en')),
               (SELECT CASE split_part(translate(lower(btrim(spoken.code)), '_', '-'), '-', 1)
                           WHEN 'ua' THEN 'uk'
                           ELSE split_part(translate(lower(btrim(spoken.code)), '_', '-'), '-', 1)
                       END
                FROM patients notice_patient
                CROSS JOIN LATERAL unnest(notice_patient.languages)
                     WITH ORDINALITY AS spoken(code, position)
                WHERE notice_patient.id = {patient_id_sql}
                  AND split_part(translate(lower(btrim(spoken.code)), '_', '-'), '-', 1)
                      IN ('de', 'ru', 'uk', 'ua', 'en')
                ORDER BY spoken.position
                LIMIT 1),
               '{FALLBACK_LANGUAGE}'
           )"#
    )
}

/// SQL expression (text): the wording out of the JSONB parameter
/// `texts_param` (`"$3"`, bound with [`Texts::to_json`]) for the login
/// `user_alias` of the patient `patient_id_sql`.
pub(crate) fn text_sql(texts_param: &str, user_alias: &str, patient_id_sql: &str) -> String {
    format!(
        "COALESCE({texts_param}::jsonb ->> ({language}), {texts_param}::jsonb ->> '{FALLBACK_LANGUAGE}')",
        language = language_sql(user_alias, patient_id_sql),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_login_language_wins_then_the_patients_then_english() {
        let languages = |values: &[&str]| {
            values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(resolve(Some("ru"), &languages(&["de", "en"])), "ru");
        assert_eq!(resolve(Some(" DE-de "), &languages(&["ru"])), "de");
        // No language on the login: the patient's first known language.
        assert_eq!(resolve(None, &languages(&["de", "en"])), "de");
        assert_eq!(resolve(Some(""), &languages(&["fr", "UA", "ru"])), "uk");
        assert_eq!(resolve(Some("fr"), &languages(&["en_GB"])), "en");
        // Nothing known: English, as the oldest kinds store it.
        assert_eq!(resolve(None, &[]), "en");
        assert_eq!(resolve(Some("fr"), &languages(&["es"])), "en");
    }

    #[test]
    fn every_language_has_its_wording() {
        let texts = Texts::new(
            "Termin bestätigt",
            "Визит подтверждён",
            "Візит підтверджено",
            "Visit confirmed",
        );
        for language in LANGUAGES {
            assert_eq!(texts.to_json()[language], texts.in_language(language));
        }
        assert_eq!(texts.in_language("fr"), "Visit confirmed");
        let sql = text_sql("$3", "u", "pa.patient_id");
        assert!(sql.contains("$3::jsonb ->> 'en'"), "{sql}");
        assert!(sql.contains("u.preferred_language"), "{sql}");
        assert!(sql.contains("notice_patient.id = pa.patient_id"), "{sql}");
    }
}
