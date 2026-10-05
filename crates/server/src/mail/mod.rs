//! Outgoing e-mail through Mittaro, a transactional e-mail API hosted in
//! Germany (Falkenstein / Nürnberg). Mittaro deletes the content after the
//! hand-off to the receiving server and keeps only metadata; it adds no
//! tracking pixels and rewrites no links.
//!
//! Every message is sent as HTML with a plain-text alternative. The HTML loads
//! nothing from outside (no images, fonts or styles), so opening it reveals
//! nothing to anyone. Messages never carry health data.
//!
//! Without `GMED_MITTARO_API_KEY`, `GMED_MAIL_FROM` and a console URL the
//! mailer reports `not_configured` and nothing is sent.

pub mod templates;

use std::time::Duration;

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::{MITTARO_DEFAULT_API_URL, MailConfig};

pub const PROVIDER_ID: &str = "mittaro";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
/// Attempts for a temporarily unavailable API or a short quota wait.
const MAX_ATTEMPTS: u32 = 3;
/// A `Retry-After` longer than this is reported instead of waited for: the
/// staff member who clicked "send" should not wait on a quota window.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MailCapability {
    pub provider: &'static str,
    pub available: bool,
    pub reason_code: &'static str,
}

/// One message ready for the provider.
#[derive(Debug, Clone)]
pub struct OutgoingEmail {
    pub to: String,
    pub subject: String,
    pub text: String,
    pub html: String,
    /// The same key never sends twice: Mittaro answers a repeat with the id
    /// of the first message.
    pub idempotency_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentEmail {
    pub message_id: String,
    /// The provider had already accepted this message (same idempotency key).
    pub replayed: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MailError {
    #[error("e-mail delivery is not configured")]
    NotConfigured,
    #[error("the provider rejected the key or the sender domain (HTTP {0})")]
    Rejected(u16),
    #[error("the provider rejected the message (HTTP {0})")]
    InvalidMessage(u16),
    #[error("the e-mail quota is used up")]
    QuotaReached,
    #[error("the provider is temporarily unavailable (HTTP {0})")]
    Unavailable(u16),
    #[error("the provider could not be reached")]
    Request,
    #[error("the provider answered with an unreadable response")]
    InvalidResponse,
}

impl MailError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "mail_not_configured",
            Self::Rejected(_) => "mail_rejected",
            Self::InvalidMessage(_) => "mail_invalid_message",
            Self::QuotaReached => "mail_quota_reached",
            Self::Unavailable(_) | Self::Request | Self::InvalidResponse => "mail_unavailable",
        }
    }
}

#[derive(Clone)]
pub struct Mailer {
    state: MailerState,
}

#[derive(Clone)]
enum MailerState {
    NotConfigured {
        reason_code: &'static str,
    },
    Ready {
        client: reqwest::Client,
        api_url: String,
        api_key: SecretString,
        from: String,
        reply_to: Option<String>,
        console_url: String,
    },
}

#[derive(Deserialize)]
struct AcceptedResponse {
    id: String,
}

impl Mailer {
    pub fn new(config: MailConfig) -> Self {
        let state = match (config.mittaro_api_key, config.from, config.console_url) {
            (None, _, _) => MailerState::NotConfigured {
                reason_code: "mittaro_api_key_missing",
            },
            (Some(_), None, _) => MailerState::NotConfigured {
                reason_code: "mail_from_missing",
            },
            (Some(_), Some(_), None) => MailerState::NotConfigured {
                reason_code: "console_url_missing",
            },
            (Some(api_key), Some(from), Some(console_url)) => match reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(REQUEST_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()
            {
                Ok(client) => MailerState::Ready {
                    client,
                    api_url: config
                        .mittaro_api_url
                        .unwrap_or_else(|| MITTARO_DEFAULT_API_URL.to_string()),
                    api_key,
                    from,
                    reply_to: config.reply_to,
                    console_url: console_url.trim_end_matches('/').to_string(),
                },
                Err(_) => MailerState::NotConfigured {
                    reason_code: "client_initialization_failed",
                },
            },
        };
        Self { state }
    }

    pub fn capability(&self) -> MailCapability {
        match &self.state {
            MailerState::NotConfigured { reason_code } => MailCapability {
                provider: PROVIDER_ID,
                available: false,
                reason_code,
            },
            MailerState::Ready { .. } => MailCapability {
                provider: PROVIDER_ID,
                available: true,
                reason_code: "ready",
            },
        }
    }

    /// Origin of the console the e-mails link to, without a trailing slash.
    pub fn console_url(&self) -> Option<&str> {
        match &self.state {
            MailerState::Ready { console_url, .. } => Some(console_url),
            MailerState::NotConfigured { .. } => None,
        }
    }

    pub async fn send(&self, email: &OutgoingEmail) -> Result<SentEmail, MailError> {
        let MailerState::Ready {
            client,
            api_url,
            api_key,
            from,
            reply_to,
            ..
        } = &self.state
        else {
            return Err(MailError::NotConfigured);
        };
        let mut body = json!({
            "from": from,
            "to": email.to,
            "subject": email.subject,
            "text": email.text,
            "html": email.html,
        });
        if let Some(reply_to) = reply_to {
            body["reply_to"] = json!(reply_to);
        }
        let body = serde_json::to_vec(&body).map_err(|_| MailError::InvalidResponse)?;

        let mut attempt = 1;
        loop {
            let result = post_once(client, api_url, api_key, &email.idempotency_key, &body).await;
            let retry_in = match &result {
                Err(Attempt::Retry { wait, .. }) if attempt < MAX_ATTEMPTS => *wait,
                _ => None,
            };
            match (result, retry_in) {
                (Ok(sent), _) => return Ok(sent),
                (Err(Attempt::Retry { .. }), Some(wait)) => {
                    tokio::time::sleep(wait).await;
                    attempt += 1;
                }
                (Err(Attempt::Retry { error, .. }), None) | (Err(Attempt::Final(error)), _) => {
                    return Err(error);
                }
            }
        }
    }
}

enum Attempt {
    Retry {
        error: MailError,
        /// `None`: retrying would take too long.
        wait: Option<Duration>,
    },
    Final(MailError),
}

async fn post_once(
    client: &reqwest::Client,
    api_url: &str,
    api_key: &SecretString,
    idempotency_key: &str,
    body: &[u8],
) -> Result<SentEmail, Attempt> {
    let response = client
        .post(api_url)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", api_key.expose_secret()),
        )
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("Idempotency-Key", idempotency_key)
        .body(body.to_vec())
        .send()
        .await
        .map_err(|_| Attempt::Retry {
            error: MailError::Request,
            wait: Some(Duration::from_millis(500)),
        })?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(Duration::from_secs);
    match status {
        200 | 202 => {
            let bytes = response
                .bytes()
                .await
                .map_err(|_| Attempt::Final(MailError::InvalidResponse))?;
            if bytes.len() > MAX_RESPONSE_BYTES {
                return Err(Attempt::Final(MailError::InvalidResponse));
            }
            let accepted: AcceptedResponse = serde_json::from_slice(&bytes)
                .map_err(|_| Attempt::Final(MailError::InvalidResponse))?;
            Ok(SentEmail {
                message_id: accepted.id,
                replayed: status == 200,
            })
        }
        401 | 403 => Err(Attempt::Final(MailError::Rejected(status))),
        400 | 409 | 413 | 422 => Err(Attempt::Final(MailError::InvalidMessage(status))),
        429 => Err(Attempt::Retry {
            error: MailError::QuotaReached,
            wait: retry_after.filter(|wait| *wait <= MAX_RETRY_AFTER),
        }),
        500..=599 => Err(Attempt::Retry {
            error: MailError::Unavailable(status),
            wait: Some(
                retry_after
                    .unwrap_or(Duration::from_millis(500))
                    .min(MAX_RETRY_AFTER),
            ),
        }),
        _ => Err(Attempt::Final(MailError::InvalidMessage(status))),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{Router, extract::State, http::HeaderMap, response::IntoResponse, routing::post};

    use super::*;

    #[derive(Clone, Default)]
    struct Captured {
        requests: Arc<Mutex<Vec<(HeaderMap, serde_json::Value)>>>,
        statuses: Arc<Mutex<Vec<u16>>>,
    }

    async fn receive(
        State(captured): State<Captured>,
        headers: HeaderMap,
        body: axum::body::Bytes,
    ) -> axum::response::Response {
        let json = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
        captured.requests.lock().unwrap().push((headers, json));
        let status = {
            let mut statuses = captured.statuses.lock().unwrap();
            if statuses.is_empty() {
                202
            } else {
                statuses.remove(0)
            }
        };
        let status = axum::http::StatusCode::from_u16(status).unwrap();
        if status.is_success() {
            (
                status,
                axum::Json(json!({ "id": "email_01TEST", "status": "queued" })),
            )
                .into_response()
        } else {
            (status, [("Retry-After", "0")], "busy").into_response()
        }
    }

    async fn fake_mittaro(statuses: Vec<u16>) -> (String, Captured) {
        let captured = Captured::default();
        *captured.statuses.lock().unwrap() = statuses;
        let app = Router::new()
            .route("/v1/emails", post(receive))
            .with_state(captured.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/v1/emails"), captured)
    }

    fn mailer(api_url: String) -> Mailer {
        Mailer::new(MailConfig {
            mittaro_api_key: Some(SecretString::from("tx_live_test")),
            mittaro_api_url: Some(api_url),
            from: Some("zugang@gmed-health.com".into()),
            reply_to: Some("info@gmed-health.com".into()),
            console_url: Some("https://console.gmed-health.com/".into()),
        })
    }

    fn message() -> OutgoingEmail {
        OutgoingEmail {
            to: "anna@example.test".into(),
            subject: "Ihr Zugang".into(),
            text: "Text".into(),
            html: "<p>Text</p>".into(),
            idempotency_key: "key-1".into(),
        }
    }

    #[test]
    fn missing_settings_keep_the_mailer_off() {
        let off = Mailer::new(MailConfig::default());
        assert!(!off.capability().available);
        assert_eq!(off.capability().reason_code, "mittaro_api_key_missing");
        let no_sender = Mailer::new(MailConfig {
            mittaro_api_key: Some(SecretString::from("tx_live_test")),
            console_url: Some("https://console.gmed-health.com".into()),
            ..MailConfig::default()
        });
        assert_eq!(no_sender.capability().reason_code, "mail_from_missing");
        let ready = mailer("https://api.mittaro.de/v1/emails".into());
        assert!(ready.capability().available);
        assert_eq!(ready.console_url(), Some("https://console.gmed-health.com"));
    }

    #[tokio::test]
    async fn not_configured_sends_nothing() {
        let off = Mailer::new(MailConfig::default());
        assert_eq!(off.send(&message()).await, Err(MailError::NotConfigured));
    }

    #[tokio::test]
    async fn sends_html_and_text_with_bearer_key_and_idempotency_key() {
        let (url, captured) = fake_mittaro(vec![]).await;
        let sent = mailer(url).send(&message()).await.unwrap();
        assert_eq!(sent.message_id, "email_01TEST");
        assert!(!sent.replayed);
        let requests = captured.requests.lock().unwrap();
        let (headers, body) = &requests[0];
        assert_eq!(headers["authorization"], "Bearer tx_live_test");
        assert_eq!(headers["idempotency-key"], "key-1");
        assert_eq!(body["from"], "zugang@gmed-health.com");
        assert_eq!(body["to"], "anna@example.test");
        assert_eq!(body["reply_to"], "info@gmed-health.com");
        assert_eq!(body["text"], "Text");
        assert_eq!(body["html"], "<p>Text</p>");
        assert!(body.get("attachments").is_none());
    }

    #[tokio::test]
    async fn a_repeat_with_the_same_key_is_reported_as_replayed() {
        let (url, _) = fake_mittaro(vec![200]).await;
        assert!(mailer(url).send(&message()).await.unwrap().replayed);
    }

    #[tokio::test]
    async fn a_temporary_outage_is_retried() {
        let (url, captured) = fake_mittaro(vec![503, 202]).await;
        assert!(mailer(url).send(&message()).await.is_ok());
        assert_eq!(captured.requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_rejected_key_is_not_retried() {
        let (url, captured) = fake_mittaro(vec![401]).await;
        let error = mailer(url).send(&message()).await.unwrap_err();
        assert_eq!(error, MailError::Rejected(401));
        assert_eq!(error.code(), "mail_rejected");
        assert_eq!(captured.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_invalid_message_and_a_quota_are_reported() {
        let (url, _) = fake_mittaro(vec![422]).await;
        assert_eq!(
            mailer(url).send(&message()).await,
            Err(MailError::InvalidMessage(422))
        );
        let (url, captured) = fake_mittaro(vec![429, 429, 429]).await;
        assert_eq!(
            mailer(url).send(&message()).await,
            Err(MailError::QuotaReached)
        );
        assert_eq!(captured.requests.lock().unwrap().len(), 3);
    }
}
