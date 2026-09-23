//! Offline machine-translation drafts for the document translation workspace.
//!
//! Drafts come from the internal `machine-translation` service (OPUS-MT
//! models run with CTranslate2 inside the clinical-document-parser image).
//! Document text never leaves the host. The draft is a starting point for a
//! human reviewer, never a completed translation.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::MachineTranslationConfig;

pub const LOCAL_PROVIDER_ID: &str = "local";
/// Upper bound for one workspace draft; larger documents stay manual.
pub const MAX_SOURCE_CHARS: usize = 100_000;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
/// CPU inference of a long document takes minutes, not seconds.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(170);

/// Languages the bundled models translate between.
const SUPPORTED_LANGUAGES: &[&str] = &["de", "en", "ru", "uk"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MachineTranslationCapability {
    pub provider: &'static str,
    pub status: &'static str,
    /// Kept under this name for the workspace client: true when drafts can
    /// be requested. No call ever leaves the host.
    pub external_calls_enabled: bool,
    pub reason_code: &'static str,
}

#[derive(Clone)]
pub struct MachineTranslator {
    state: TranslatorState,
}

#[derive(Clone)]
enum TranslatorState {
    NotConfigured,
    Blocked {
        reason_code: &'static str,
    },
    Ready {
        base_url: String,
        client: reqwest::Client,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MachineTranslation {
    pub text: String,
    pub detected_source_language: Option<String>,
    pub characters: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum MachineTranslationError {
    #[error("machine translation is not configured")]
    Unavailable,
    #[error("unsupported translation language")]
    UnsupportedLanguage,
    #[error("source text is empty")]
    EmptyText,
    #[error("source text exceeds the machine translation limit")]
    TooLarge,
    #[error("translation service request failed")]
    Request,
    #[error("translation service returned HTTP {0}")]
    UpstreamStatus(u16),
    #[error("translation service response exceeded the size limit")]
    ResponseTooLarge,
    #[error("translation service response could not be parsed")]
    InvalidOutput,
}

impl MachineTranslationError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unavailable => "provider_unavailable",
            Self::UnsupportedLanguage => "unsupported_language",
            Self::EmptyText => "empty_source_text",
            Self::TooLarge => "source_text_too_large",
            Self::Request => "provider_request_failed",
            Self::UpstreamStatus(_) => "provider_upstream_error",
            Self::ResponseTooLarge => "provider_response_too_large",
            Self::InvalidOutput => "provider_invalid_output",
        }
    }
}

#[derive(Deserialize)]
struct ServiceResponse {
    text: String,
    #[serde(default)]
    detected_source_language: Option<String>,
}

impl MachineTranslator {
    pub fn new(config: MachineTranslationConfig) -> Self {
        let state = match config.service_url {
            None => TranslatorState::NotConfigured,
            Some(url) => match reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(REQUEST_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()
            {
                Ok(client) => TranslatorState::Ready {
                    base_url: url.trim_end_matches('/').to_string(),
                    client,
                },
                Err(_) => TranslatorState::Blocked {
                    reason_code: "client_initialization_failed",
                },
            },
        };
        Self { state }
    }

    pub fn capability(&self) -> MachineTranslationCapability {
        match &self.state {
            TranslatorState::NotConfigured => MachineTranslationCapability {
                provider: LOCAL_PROVIDER_ID,
                status: "not_configured",
                external_calls_enabled: false,
                reason_code: "translation_service_not_configured",
            },
            TranslatorState::Blocked { reason_code } => MachineTranslationCapability {
                provider: LOCAL_PROVIDER_ID,
                status: "blocked",
                external_calls_enabled: false,
                reason_code,
            },
            TranslatorState::Ready { .. } => MachineTranslationCapability {
                provider: LOCAL_PROVIDER_ID,
                status: "ready",
                external_calls_enabled: true,
                reason_code: "ready",
            },
        }
    }

    /// Translate `text` from `source_language` (base code, or `None` for
    /// detection) into `target_language`. Line structure is preserved.
    pub async fn translate(
        &self,
        text: &str,
        source_language: Option<&str>,
        target_language: &str,
    ) -> Result<MachineTranslation, MachineTranslationError> {
        self.translate_protected(text, source_language, target_language, &[])
            .await
    }

    /// Like `translate`, but `protected` strings (names, addresses) come
    /// back exactly as written.
    pub async fn translate_protected(
        &self,
        text: &str,
        source_language: Option<&str>,
        target_language: &str,
        protected: &[String],
    ) -> Result<MachineTranslation, MachineTranslationError> {
        let TranslatorState::Ready { base_url, client } = &self.state else {
            return Err(MachineTranslationError::Unavailable);
        };
        let source = source_language.map(normalize_language).transpose()?;
        let target = normalize_language(target_language)?;
        let text = text.trim();
        if text.is_empty() {
            return Err(MachineTranslationError::EmptyText);
        }
        let characters = text.chars().count();
        if characters > MAX_SOURCE_CHARS {
            return Err(MachineTranslationError::TooLarge);
        }

        let body = json!({
            "text": text,
            "source_language": source,
            "target_language": target,
            "protected": protected,
        });
        let mut response = client
            .post(format!("{base_url}/v1/translate"))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(&body).map_err(|_| MachineTranslationError::InvalidOutput)?)
            .send()
            .await
            .map_err(|_| MachineTranslationError::Request)?;
        let status = response.status();
        if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
            return Err(MachineTranslationError::UnsupportedLanguage);
        }
        if !status.is_success() {
            return Err(MachineTranslationError::UpstreamStatus(status.as_u16()));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
        {
            return Err(MachineTranslationError::ResponseTooLarge);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| MachineTranslationError::Request)?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(MachineTranslationError::ResponseTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        let parsed = parse_response(&bytes)?;
        Ok(MachineTranslation {
            text: parsed.text,
            detected_source_language: parsed
                .detected_source_language
                .and_then(|value| normalize_language(&value).ok())
                .map(str::to_string),
            characters,
        })
    }
}

fn parse_response(bytes: &[u8]) -> Result<ServiceResponse, MachineTranslationError> {
    let parsed: ServiceResponse =
        serde_json::from_slice(bytes).map_err(|_| MachineTranslationError::InvalidOutput)?;
    if parsed.text.trim().is_empty() {
        return Err(MachineTranslationError::InvalidOutput);
    }
    Ok(parsed)
}

/// Normalise a workspace language value (`de`, `de-DE`, `ru_RU`) to a
/// supported base code. Bilingual markers such as `de-ru` are not a single
/// language and are rejected.
pub fn normalize_language(value: &str) -> Result<&'static str, MachineTranslationError> {
    let lowered = value.trim().to_ascii_lowercase();
    let mut parts = lowered.split(['-', '_']);
    let base = parts.next().unwrap_or_default();
    if parts
        .next()
        .is_some_and(|region| SUPPORTED_LANGUAGES.contains(&region) && region != base)
    {
        return Err(MachineTranslationError::UnsupportedLanguage);
    }
    SUPPORTED_LANGUAGES
        .iter()
        .copied()
        .find(|candidate| *candidate == base)
        .ok_or(MachineTranslationError::UnsupportedLanguage)
}

/// Longest first, so "Anna Beispiel" wins over "Anna"; very short or empty
/// strings are dropped because they would match inside ordinary words.
pub fn normalize_protected_terms(terms: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut terms: Vec<String> = terms
        .into_iter()
        .map(|term| term.trim().to_string())
        .filter(|term| term.chars().count() >= 3)
        .collect();
    terms.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    terms.dedup();
    terms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_terms_are_ordered_longest_first_without_short_fragments() {
        let terms = normalize_protected_terms(vec![
            "Anna".to_string(),
            " Anna Beispiel ".to_string(),
            "Al".to_string(),
            "Anna".to_string(),
        ]);
        assert_eq!(terms, vec!["Anna Beispiel".to_string(), "Anna".to_string()]);
    }

    #[test]
    fn only_bundled_languages_are_accepted() {
        assert_eq!(normalize_language("de-DE").unwrap(), "de");
        assert_eq!(normalize_language(" RU ").unwrap(), "ru");
        assert_eq!(normalize_language("uk_UA").unwrap(), "uk");
        assert!(normalize_language("de-ru").is_err());
        assert!(normalize_language("fr").is_err());
        assert!(normalize_language("").is_err());
    }

    #[test]
    fn service_response_must_carry_text() {
        let parsed =
            parse_response(br#"{"text":"Befund","detected_source_language":"ru"}"#).unwrap();
        assert_eq!(parsed.text, "Befund");
        assert!(matches!(
            parse_response(br#"{"text":"  "}"#),
            Err(MachineTranslationError::InvalidOutput)
        ));
        assert!(matches!(
            parse_response(b"not json"),
            Err(MachineTranslationError::InvalidOutput)
        ));
    }

    #[test]
    fn capability_follows_service_configuration() {
        let missing = MachineTranslator::new(MachineTranslationConfig::default());
        assert_eq!(missing.capability().status, "not_configured");
        assert!(!missing.capability().external_calls_enabled);
        let ready = MachineTranslator::new(MachineTranslationConfig {
            service_url: Some("http://machine-translation:8092/".to_string()),
        });
        assert_eq!(ready.capability().status, "ready");
        assert_eq!(ready.capability().provider, LOCAL_PROVIDER_ID);
        match &ready.state {
            TranslatorState::Ready { base_url, .. } => {
                assert_eq!(base_url, "http://machine-translation:8092");
            }
            _ => panic!("expected ready state"),
        }
    }

    #[tokio::test]
    async fn unavailable_translator_rejects_without_network() {
        let translator = MachineTranslator::new(MachineTranslationConfig::default());
        let error = translator
            .translate("Befund", Some("de"), "ru")
            .await
            .unwrap_err();
        assert!(matches!(error, MachineTranslationError::Unavailable));
    }
}
