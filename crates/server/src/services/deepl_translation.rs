//! DeepL machine-translation drafts for the document translation workspace.
//!
//! The draft is a starting point for a human interpreter, never a completed
//! translation. Calls leave the host only when a server-only key and an
//! explicit data-transfer approval are configured for the environment.

use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue, USER_AGENT};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::DeeplConfig;

pub const DEEPL_PROVIDER_ID: &str = "deepl";
const DEEPL_PRO_API_URL: &str = "https://api.deepl.com";
const DEEPL_FREE_API_URL: &str = "https://api-free.deepl.com";
/// Upper bound for one workspace draft; larger documents stay manual.
pub const MAX_SOURCE_CHARS: usize = 100_000;
/// DeepL accepts up to 128 KiB per request and 50 text items; stay well below.
const MAX_REQUEST_CHARS: usize = 30_000;
const MAX_TEXTS_PER_REQUEST: usize = 50;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

/// Language codes DeepL accepts as both source and target (base codes).
const SUPPORTED_LANGUAGES: &[&str] = &[
    "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hu", "id", "it", "ja", "ko",
    "lt", "lv", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "zh",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeeplCapability {
    pub provider: &'static str,
    pub status: &'static str,
    pub external_calls_enabled: bool,
    pub reason_code: &'static str,
}

#[derive(Clone)]
pub struct DeeplTranslator {
    state: TranslatorState,
}

#[derive(Clone)]
enum TranslatorState {
    NotConfigured,
    Blocked {
        reason_code: &'static str,
    },
    Ready {
        api_key: SecretString,
        base_url: String,
        client: reqwest::Client,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeeplTranslation {
    pub text: String,
    pub detected_source_language: Option<String>,
    pub characters: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum DeeplError {
    #[error("machine translation is not configured")]
    Unavailable,
    #[error("unsupported translation language")]
    UnsupportedLanguage,
    #[error("source text is empty")]
    EmptyText,
    #[error("source text exceeds the machine translation limit")]
    TooLarge,
    #[error("provider request failed")]
    Request,
    #[error("provider returned HTTP {0}")]
    UpstreamStatus(u16),
    #[error("provider response exceeded the size limit")]
    ResponseTooLarge,
    #[error("provider response could not be parsed")]
    InvalidOutput,
}

impl DeeplError {
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

impl DeeplTranslator {
    pub fn new(config: DeeplConfig) -> Self {
        let state = match config.api_key {
            None => TranslatorState::NotConfigured,
            Some(_) if !config.patient_data_transfer_approved => TranslatorState::Blocked {
                reason_code: "data_transfer_not_approved",
            },
            Some(api_key) => {
                let base_url = config
                    .api_url
                    .map(|url| url.trim_end_matches('/').to_string())
                    .unwrap_or_else(|| {
                        if api_key.expose_secret().ends_with(":fx") {
                            DEEPL_FREE_API_URL.to_string()
                        } else {
                            DEEPL_PRO_API_URL.to_string()
                        }
                    });
                match reqwest::Client::builder()
                    .connect_timeout(Duration::from_secs(5))
                    .timeout(Duration::from_secs(60))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                {
                    Ok(client) => TranslatorState::Ready {
                        api_key,
                        base_url,
                        client,
                    },
                    Err(_) => TranslatorState::Blocked {
                        reason_code: "client_initialization_failed",
                    },
                }
            }
        };
        Self { state }
    }

    pub fn capability(&self) -> DeeplCapability {
        match &self.state {
            TranslatorState::NotConfigured => DeeplCapability {
                provider: DEEPL_PROVIDER_ID,
                status: "not_configured",
                external_calls_enabled: false,
                reason_code: "external_provider_not_configured",
            },
            TranslatorState::Blocked { reason_code } => DeeplCapability {
                provider: DEEPL_PROVIDER_ID,
                status: "blocked",
                external_calls_enabled: false,
                reason_code,
            },
            TranslatorState::Ready { .. } => DeeplCapability {
                provider: DEEPL_PROVIDER_ID,
                status: "ready",
                external_calls_enabled: true,
                reason_code: "ready",
            },
        }
    }

    /// Translate `text` from `source_language` (base code, or `None` for
    /// DeepL auto-detection) into `target_language`. Paragraph structure is
    /// preserved; the draft is returned, never persisted here.
    pub async fn translate(
        &self,
        text: &str,
        source_language: Option<&str>,
        target_language: &str,
    ) -> Result<DeeplTranslation, DeeplError> {
        self.translate_protected(text, source_language, target_language, &[])
            .await
    }

    /// Like `translate`, but `protected` strings (names, addresses) are sent
    /// as XML ignore tags and come back exactly as written.
    pub async fn translate_protected(
        &self,
        text: &str,
        source_language: Option<&str>,
        target_language: &str,
        protected: &[String],
    ) -> Result<DeeplTranslation, DeeplError> {
        let TranslatorState::Ready {
            api_key,
            base_url,
            client,
        } = &self.state
        else {
            return Err(DeeplError::Unavailable);
        };
        let source = source_language.map(deepl_source_code).transpose()?;
        let target = deepl_target_code(target_language)?;
        let text = text.trim();
        if text.is_empty() {
            return Err(DeeplError::EmptyText);
        }
        if text.chars().count() > MAX_SOURCE_CHARS {
            return Err(DeeplError::TooLarge);
        }

        let mut headers = HeaderMap::new();
        let authorization =
            HeaderValue::from_str(&format!("DeepL-Auth-Key {}", api_key.expose_secret()))
                .map_err(|_| DeeplError::Unavailable)?;
        headers.insert(AUTHORIZATION, authorization);
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static("gmed-document-translation/1"),
        );
        let url = format!("{base_url}/v2/translate");

        let mut translated_paragraphs = Vec::new();
        let mut detected_source_language = None;
        let use_tags = !protected.is_empty();
        for batch in batch_paragraphs(text) {
            let batch: Vec<String> = if use_tags {
                batch
                    .iter()
                    .map(|item| protect_terms(item, protected))
                    .collect()
            } else {
                batch
            };
            let mut body = json!({
                "text": batch,
                "target_lang": target,
                "preserve_formatting": true,
                "split_sentences": "1",
            });
            if let Some(source) = &source {
                body["source_lang"] = json!(source);
            }
            if use_tags {
                body["tag_handling"] = json!("xml");
                body["ignore_tags"] = json!(["keep"]);
                // Tag handling v2 puts a line break after every kept name, and
                // non_splitting_tags would switch the ignore tag off; v1 keeps the
                // names inside the sentence and the original line breaks.
                body["tag_handling_version"] = json!("v1");
            }
            let mut response = client
                .post(&url)
                .headers(headers.clone())
                .body(serde_json::to_vec(&body).map_err(|_| DeeplError::InvalidOutput)?)
                .send()
                .await
                .map_err(|_| DeeplError::Request)?;
            if !response.status().is_success() {
                return Err(DeeplError::UpstreamStatus(response.status().as_u16()));
            }
            if response
                .content_length()
                .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
            {
                return Err(DeeplError::ResponseTooLarge);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| DeeplError::Request)? {
                if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                    return Err(DeeplError::ResponseTooLarge);
                }
                bytes.extend_from_slice(&chunk);
            }
            let parsed = parse_response(&bytes, batch.len())?;
            if detected_source_language.is_none() {
                detected_source_language = parsed.detected_source_language;
            }
            if use_tags {
                translated_paragraphs.extend(parsed.texts.iter().map(|item| unprotect_terms(item)));
            } else {
                translated_paragraphs.extend(parsed.texts);
            }
        }

        Ok(DeeplTranslation {
            text: translated_paragraphs.join("\n\n"),
            detected_source_language,
            characters: text.chars().count(),
        })
    }
}

/// Upper bound for a PDF sent to the DeepL document API.
pub const MAX_DOCUMENT_BYTES: usize = 10 * 1024 * 1024;
const DOCUMENT_POLL_INTERVAL: Duration = Duration::from_secs(3);
const DOCUMENT_POLL_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Deserialize)]
struct DeeplDocumentHandle {
    document_id: String,
    document_key: String,
}

#[derive(Deserialize)]
struct DeeplDocumentStatus {
    status: String,
    #[serde(default)]
    billed_characters: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeeplDocumentTranslation {
    pub bytes: Vec<u8>,
    pub billed_characters: Option<u64>,
}

impl DeeplTranslator {
    /// Layout-preserving translation of a PDF through the DeepL document API:
    /// upload, poll until done, download the translated file.
    pub async fn translate_document(
        &self,
        bytes: &[u8],
        filename: &str,
        source_language: Option<&str>,
        target_language: &str,
    ) -> Result<DeeplDocumentTranslation, DeeplError> {
        let TranslatorState::Ready {
            api_key,
            base_url,
            client,
        } = &self.state
        else {
            return Err(DeeplError::Unavailable);
        };
        if bytes.is_empty() {
            return Err(DeeplError::EmptyText);
        }
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(DeeplError::TooLarge);
        }
        let source = source_language.map(deepl_source_code).transpose()?;
        let target = deepl_target_code(target_language)?;
        let authorization =
            HeaderValue::from_str(&format!("DeepL-Auth-Key {}", api_key.expose_secret()))
                .map_err(|_| DeeplError::Unavailable)?;

        // reqwest's multipart feature is not enabled for the server build, so
        // the body is assembled by hand; the format is small and fixed.
        let boundary = format!("----gmed-deepl-{}", uuid::Uuid::new_v4().simple());
        let mut body: Vec<u8> = Vec::with_capacity(bytes.len() + 1024);
        let mut push_field = |name: &str, value: &str| {
            body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
            body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                    .as_bytes(),
            );
        };
        push_field("target_lang", &target);
        if let Some(source) = &source {
            push_field("source_lang", source);
        }
        let safe_filename: String = filename
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{safe_filename}\"\r\nContent-Type: application/pdf\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let upload = client
            .post(format!("{base_url}/v2/document"))
            .header(AUTHORIZATION, authorization.clone())
            .header(
                CONTENT_TYPE,
                format!("multipart/form-data; boundary={boundary}"),
            )
            .header(USER_AGENT, "gmed-document-translation/1")
            .body(body)
            .send()
            .await
            .map_err(|_| DeeplError::Request)?;
        if !upload.status().is_success() {
            return Err(DeeplError::UpstreamStatus(upload.status().as_u16()));
        }
        let handle: DeeplDocumentHandle =
            serde_json::from_slice(&upload.bytes().await.map_err(|_| DeeplError::Request)?)
                .map_err(|_| DeeplError::InvalidOutput)?;
        if handle.document_id.is_empty()
            || !handle
                .document_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric())
        {
            return Err(DeeplError::InvalidOutput);
        }
        let key_body = serde_json::to_vec(&json!({ "document_key": handle.document_key }))
            .map_err(|_| DeeplError::InvalidOutput)?;

        let started = std::time::Instant::now();
        let mut billed_characters = None;
        loop {
            let status_response = client
                .post(format!("{base_url}/v2/document/{}", handle.document_id))
                .header(AUTHORIZATION, authorization.clone())
                .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
                .body(key_body.clone())
                .send()
                .await
                .map_err(|_| DeeplError::Request)?;
            if !status_response.status().is_success() {
                return Err(DeeplError::UpstreamStatus(
                    status_response.status().as_u16(),
                ));
            }
            let status: DeeplDocumentStatus = serde_json::from_slice(
                &status_response
                    .bytes()
                    .await
                    .map_err(|_| DeeplError::Request)?,
            )
            .map_err(|_| DeeplError::InvalidOutput)?;
            billed_characters = status.billed_characters.or(billed_characters);
            match status.status.as_str() {
                "done" => break,
                "queued" | "translating" => {}
                _ => return Err(DeeplError::InvalidOutput),
            }
            if started.elapsed() > DOCUMENT_POLL_TIMEOUT {
                return Err(DeeplError::Request);
            }
            tokio::time::sleep(DOCUMENT_POLL_INTERVAL).await;
        }

        let mut result = client
            .post(format!(
                "{base_url}/v2/document/{}/result",
                handle.document_id
            ))
            .header(AUTHORIZATION, authorization)
            .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
            .body(key_body)
            .send()
            .await
            .map_err(|_| DeeplError::Request)?;
        if !result.status().is_success() {
            return Err(DeeplError::UpstreamStatus(result.status().as_u16()));
        }
        let mut translated = Vec::new();
        while let Some(chunk) = result.chunk().await.map_err(|_| DeeplError::Request)? {
            if translated.len() + chunk.len() > MAX_DOCUMENT_BYTES * 3 {
                return Err(DeeplError::ResponseTooLarge);
            }
            translated.extend_from_slice(&chunk);
        }
        if !translated.starts_with(b"%PDF") {
            return Err(DeeplError::InvalidOutput);
        }
        Ok(DeeplDocumentTranslation {
            bytes: translated,
            billed_characters,
        })
    }
}

/// Normalise a workspace language value (`de`, `de-DE`, `ru_RU`) to a
/// DeepL-supported base code. Bilingual markers such as `de-ru` are not a
/// single language and are rejected.
pub fn normalize_language(value: &str) -> Result<&'static str, DeeplError> {
    let lowered = value.trim().to_ascii_lowercase();
    let mut parts = lowered.split(['-', '_']);
    let base = parts.next().unwrap_or_default();
    if parts
        .next()
        .is_some_and(|region| SUPPORTED_LANGUAGES.contains(&region) && region != base)
    {
        return Err(DeeplError::UnsupportedLanguage);
    }
    SUPPORTED_LANGUAGES
        .iter()
        .copied()
        .find(|candidate| *candidate == base)
        .ok_or(DeeplError::UnsupportedLanguage)
}

fn deepl_source_code(value: &str) -> Result<String, DeeplError> {
    Ok(normalize_language(value)?.to_ascii_uppercase())
}

fn deepl_target_code(value: &str) -> Result<String, DeeplError> {
    Ok(match normalize_language(value)? {
        // DeepL requires a regional variant for these targets.
        "en" => "EN-GB".to_string(),
        "pt" => "PT-PT".to_string(),
        "zh" => "ZH-HANS".to_string(),
        code => code.to_ascii_uppercase(),
    })
}

/// Split the text into paragraph batches that respect the DeepL request
/// limits. Paragraph breaks are restored on join, so page structure survives.
fn batch_paragraphs(text: &str) -> Vec<Vec<String>> {
    let normalized = text.replace("\r\n", "\n").replace('\u{c}', "\n\n");
    let mut batches: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut current_chars = 0usize;
    for paragraph in normalized.split("\n\n") {
        let paragraph = paragraph.trim_matches('\n');
        if paragraph.trim().is_empty() {
            continue;
        }
        for piece in split_oversized(paragraph) {
            let piece_chars = piece.chars().count();
            if !current.is_empty()
                && (current.len() >= MAX_TEXTS_PER_REQUEST
                    || current_chars + piece_chars > MAX_REQUEST_CHARS)
            {
                batches.push(std::mem::take(&mut current));
                current_chars = 0;
            }
            current_chars += piece_chars;
            current.push(piece);
        }
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

fn split_oversized(paragraph: &str) -> Vec<String> {
    if paragraph.chars().count() <= MAX_REQUEST_CHARS {
        return vec![paragraph.to_string()];
    }
    let mut pieces = Vec::new();
    let mut current = String::new();
    for line in paragraph.split_inclusive('\n') {
        let line_chars = line.chars().count();
        if !current.is_empty() && current.chars().count() + line_chars > MAX_REQUEST_CHARS {
            pieces.push(std::mem::take(&mut current));
        }
        if line_chars > MAX_REQUEST_CHARS {
            let chars: Vec<char> = line.chars().collect();
            for chunk in chars.chunks(MAX_REQUEST_CHARS) {
                pieces.push(chunk.iter().collect());
            }
            continue;
        }
        current.push_str(line);
    }
    if !current.is_empty() {
        pieces.push(current);
    }
    pieces
}

struct ParsedResponse {
    texts: Vec<String>,
    detected_source_language: Option<String>,
}

#[derive(Deserialize)]
struct DeeplResponse {
    translations: Vec<DeeplTranslationItem>,
}

#[derive(Deserialize)]
struct DeeplTranslationItem {
    text: String,
    #[serde(default)]
    detected_source_language: Option<String>,
}

fn parse_response(bytes: &[u8], expected: usize) -> Result<ParsedResponse, DeeplError> {
    let response: DeeplResponse =
        serde_json::from_slice(bytes).map_err(|_| DeeplError::InvalidOutput)?;
    if response.translations.len() != expected {
        return Err(DeeplError::InvalidOutput);
    }
    let detected_source_language = response
        .translations
        .first()
        .and_then(|item| item.detected_source_language.clone())
        .map(|code| code.to_ascii_lowercase());
    Ok(ParsedResponse {
        texts: response
            .translations
            .into_iter()
            .map(|item| item.text)
            .collect(),
        detected_source_language,
    })
}

/// Marks names, addresses and similar fixed strings so DeepL leaves them
/// untouched (`<keep>` is sent as an ignore tag). Line breaks stay plain
/// newlines: with `split_sentences=1` DeepL keeps them as boundaries, while a
/// break tag would be moved around inside the sentence.
fn protect_terms(text: &str, terms: &[String]) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut index = 0;
    while index < text.len() {
        let rest = &text[index..];
        let at_boundary = text[..index]
            .chars()
            .next_back()
            .is_none_or(|previous| !previous.is_alphanumeric());
        let matched = at_boundary
            .then(|| {
                terms.iter().find(|term| {
                    rest.starts_with(term.as_str())
                        && rest[term.len()..]
                            .chars()
                            .next()
                            .is_none_or(|next| !next.is_alphanumeric())
                })
            })
            .flatten();
        if let Some(term) = matched {
            out.push_str("<keep>");
            push_escaped(&mut out, term);
            out.push_str("</keep>");
            index += term.len();
            continue;
        }
        let Some(ch) = rest.chars().next() else { break };
        push_escaped(&mut out, ch.encode_utf8(&mut [0u8; 4]));
        index += ch.len_utf8();
    }
    out
}

fn push_escaped(out: &mut String, value: &str) {
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            other => out.push(other),
        }
    }
}

fn unprotect_terms(text: &str) -> String {
    text.replace("<keep>", "")
        .replace("</keep>", "")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
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
    fn protected_terms_are_tagged_escaped_and_restored() {
        let terms = normalize_protected_terms(vec![
            "Anna".to_string(),
            "Anna Beispiel".to_string(),
            "Main & Co".to_string(),
            "ab".to_string(),
        ]);
        assert_eq!(terms, vec!["Anna Beispiel", "Main & Co", "Anna"]);
        let protected = protect_terms("Ich, Anna Beispiel, bei Main & Co\nAnnahme <1>", &terms);
        assert_eq!(
            protected,
            "Ich, <keep>Anna Beispiel</keep>, bei <keep>Main &amp; Co</keep>
Annahme &lt;1&gt;"
        );
        assert_eq!(
            unprotect_terms(&protected),
            "Ich, Anna Beispiel, bei Main & Co\nAnnahme <1>"
        );
    }

    #[test]
    fn language_codes_follow_deepl_conventions() {
        assert_eq!(deepl_source_code("de-DE").unwrap(), "DE");
        assert_eq!(deepl_source_code("ru_RU").unwrap(), "RU");
        assert_eq!(deepl_target_code("ru").unwrap(), "RU");
        assert_eq!(deepl_target_code("en").unwrap(), "EN-GB");
        assert_eq!(deepl_target_code("uk").unwrap(), "UK");
        assert!(matches!(
            deepl_target_code("de-ru"),
            Err(DeeplError::UnsupportedLanguage)
        ));
        assert!(matches!(
            deepl_target_code("ur"),
            Err(DeeplError::UnsupportedLanguage)
        ));
        assert!(matches!(
            deepl_target_code(""),
            Err(DeeplError::UnsupportedLanguage)
        ));
    }

    #[test]
    fn paragraphs_are_batched_and_page_breaks_become_paragraphs() {
        let text = "Diagnosen\nArterielle Hypertonie\n\nAnamnese\u{c}Empfehlungen";
        let batches = batch_paragraphs(text);
        assert_eq!(
            batches,
            vec![vec![
                "Diagnosen\nArterielle Hypertonie".to_string(),
                "Anamnese".to_string(),
                "Empfehlungen".to_string(),
            ]]
        );
        let many = (0..120)
            .map(|i| format!("Absatz {i}"))
            .collect::<Vec<_>>()
            .join("\n\n");
        let batches = batch_paragraphs(&many);
        assert_eq!(batches.len(), 3);
        assert!(
            batches
                .iter()
                .all(|batch| batch.len() <= MAX_TEXTS_PER_REQUEST)
        );
        let long = "x".repeat(MAX_REQUEST_CHARS * 2 + 10);
        let batches = batch_paragraphs(&long);
        assert!(
            batches
                .iter()
                .flatten()
                .all(|piece| piece.chars().count() <= MAX_REQUEST_CHARS)
        );
        assert_eq!(
            batches
                .iter()
                .flatten()
                .map(|piece| piece.chars().count())
                .sum::<usize>(),
            long.len()
        );
    }

    #[test]
    fn response_must_match_request_item_count() {
        let body =
            r#"{"translations":[{"detected_source_language":"DE","text":"Диагнозы"}]}"#.as_bytes();
        let parsed = parse_response(body, 1).unwrap();
        assert_eq!(parsed.texts, vec!["Диагнозы".to_string()]);
        assert_eq!(parsed.detected_source_language.as_deref(), Some("de"));
        assert!(matches!(
            parse_response(body, 2),
            Err(DeeplError::InvalidOutput)
        ));
        assert!(matches!(
            parse_response(b"not json", 1),
            Err(DeeplError::InvalidOutput)
        ));
    }

    #[test]
    fn key_without_approval_never_enables_external_calls() {
        let blocked = DeeplTranslator::new(DeeplConfig {
            api_key: Some(SecretString::from("secret:fx".to_string())),
            api_url: None,
            patient_data_transfer_approved: false,
        });
        assert_eq!(blocked.capability().status, "blocked");
        assert!(!blocked.capability().external_calls_enabled);
        let missing = DeeplTranslator::new(DeeplConfig::default());
        assert_eq!(missing.capability().status, "not_configured");
        let ready = DeeplTranslator::new(DeeplConfig {
            api_key: Some(SecretString::from("secret:fx".to_string())),
            api_url: None,
            patient_data_transfer_approved: true,
        });
        assert_eq!(ready.capability().status, "ready");
        match &ready.state {
            TranslatorState::Ready { base_url, .. } => assert_eq!(base_url, DEEPL_FREE_API_URL),
            _ => panic!("expected ready state"),
        }
    }

    #[tokio::test]
    async fn unavailable_translator_rejects_without_network() {
        let translator = DeeplTranslator::new(DeeplConfig::default());
        let error = translator
            .translate("Befund", Some("de"), "ru")
            .await
            .unwrap_err();
        assert!(matches!(error, DeeplError::Unavailable));
    }
}
