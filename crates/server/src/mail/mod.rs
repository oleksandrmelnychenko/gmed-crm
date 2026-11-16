//! Outgoing e-mail through a Resend-compatible HTTP API. The service in use
//! is eusend (owner decision 2026-11-16): API in Nuremberg, mail servers in
//! Falkenstein, database in Frankfurt; no data leaves the EU. The client only
//! speaks the protocol (`POST {base}/emails`, `GET {base}/emails/{id}`,
//! `Authorization: Bearer`, `Idempotency-Key`), so another Resend-compatible
//! service needs a new base URL and [`PROVIDER_ID`], not a new client.
//!
//! Every message is sent as HTML with a plain-text alternative, with open and
//! click tracking switched off explicitly (links in sign-in and payer e-mails
//! must reach the recipient unchanged). The only remote resource of the HTML
//! is the GMED logo from the console's own server (one URL for everyone, no
//! tracking); no fonts or styles load from anywhere. Messages never carry
//! health data. eusend keeps the delivery record and the rendered message for
//! its log-retention window (30 days on the smaller plans).
//!
//! The delivery status of accepted messages is read back from the provider
//! (`GET /emails/{id}`, [`delivery`]); that needs a key with read access
//! (eusend `full_access`), a send-only key answers 403.
//!
//! Without an API key, a sender and a console URL the mailer reports
//! `not_configured` and nothing is sent.

pub mod connection;
pub mod delivery;
pub mod templates;

use std::time::Duration;

use axum::{http::StatusCode, response::IntoResponse};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::{MAIL_DEFAULT_API_URL, MailConfig};

/// The service the messages go through, stored with every message
/// (`portal_login_emails.provider`, …) and in audit events. The delivery
/// check asks only about messages of this provider.
pub const PROVIDER_ID: &str = "eusend";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
/// `GET /emails/{id}` returns the rendered HTML and text with the status.
const MAX_STATUS_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
/// Attempts for a temporarily unavailable API or a short rate-limit wait.
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
    /// The same key never sends twice: the provider answers a repeat with the
    /// id of the first message (at most 255 characters).
    pub idempotency_key: String,
}

/// What the provider reports about an accepted message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderStatus {
    /// The provider's status word, lower case (`queued`, `sent`, …).
    pub status: String,
    pub smtp_code: Option<String>,
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
    #[error("the provider does not know this message")]
    NotFound,
    #[error("the domain of the recipient address accepts no mail")]
    RecipientDomainNoMail,
    #[error("the provider blocks the recipient address after an earlier bounce or complaint")]
    RecipientBlocked,
}

impl MailError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "mail_not_configured",
            Self::Rejected(_) => "mail_rejected",
            Self::InvalidMessage(_) => "mail_invalid_message",
            Self::QuotaReached => "mail_quota_reached",
            Self::Unavailable(_) | Self::Request | Self::InvalidResponse => "mail_unavailable",
            Self::NotFound => "mail_message_not_found",
            Self::RecipientDomainNoMail => "mail_recipient_domain_no_mail",
            Self::RecipientBlocked => "mail_recipient_blocked",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MailerSummary {
    pub sender: String,
    pub reply_to: Option<String>,
    /// `…` and the last four characters of the API key.
    pub key_hint: String,
}

/// `…` and the last four characters: enough to recognise a key, useless to
/// anyone who reads it.
pub fn key_hint(key: &str) -> String {
    let tail: String = key
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("…{tail}")
}

/// JSON error with a code the console translates.
pub fn coded(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (
        status,
        axum::Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "code": code,
            "message": message,
        })),
    )
        .into_response()
}

/// HTTP answer for a delivery failure.
pub fn error_response(error: &MailError) -> axum::response::Response {
    let status = match error {
        MailError::NotConfigured => StatusCode::SERVICE_UNAVAILABLE,
        MailError::QuotaReached => StatusCode::TOO_MANY_REQUESTS,
        MailError::RecipientDomainNoMail | MailError::RecipientBlocked => {
            StatusCode::UNPROCESSABLE_ENTITY
        }
        MailError::Unavailable(_) | MailError::Request | MailError::InvalidResponse => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        MailError::Rejected(_) | MailError::InvalidMessage(_) | MailError::NotFound => {
            StatusCode::BAD_GATEWAY
        }
    };
    coded(status, error.code(), &error.to_string())
}

/// Company identity for e-mail footers; a missing setting drops its line.
pub async fn agency_identity(db: &gmed_db::DbPool) -> templates::AgencyIdentity {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT key, value #>> '{}'
           FROM system_settings
           WHERE key IN ('agency_name', 'agency_address', 'agency_phone',
                         'agency_email', 'agency_website')"#,
    )
    .fetch_all(db)
    .await
    .unwrap_or_else(|error| {
        tracing::warn!(%error, "agency identity for e-mail footer");
        Vec::new()
    });
    let mut agency = templates::AgencyIdentity::default();
    for (key, value) in rows {
        let value = value.map(|value| value.trim().to_string());
        match key.as_str() {
            "agency_name" => agency.name = value,
            "agency_address" => agency.address = value,
            "agency_phone" => agency.phone = value,
            "agency_email" => agency.email = value,
            "agency_website" => agency.website = value,
            _ => {}
        }
    }
    agency
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
        /// Base URL without a trailing slash, e.g. `https://api.eusend.dev`.
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

#[derive(Deserialize)]
struct StatusResponse {
    /// eusend: the current status of the message.
    #[serde(default)]
    status: Option<String>,
    /// Resend: the last event of the message (`delivered`, `bounced`, …).
    #[serde(default)]
    last_event: Option<String>,
    /// Not part of the eusend answer; read when a compatible service adds it.
    #[serde(default)]
    smtp_code: Option<serde_json::Value>,
}

/// The `code` of an error answer (`{"error": "…", "code": "DAILY_LIMIT_EXCEEDED"}`).
#[derive(Deserialize)]
struct ErrorResponse {
    #[serde(default)]
    code: Option<String>,
}

/// Message ids as the provider issues them (UUIDs at eusend); anything else
/// is not put into a request path.
fn is_message_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// At most `max` characters of a provider value.
fn bounded(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

impl Mailer {
    pub fn new(config: MailConfig) -> Self {
        let state = match (config.api_key, config.from, config.console_url) {
            (None, _, _) => MailerState::NotConfigured {
                reason_code: "mail_api_key_missing",
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
                        .api_url
                        .unwrap_or_else(|| MAIL_DEFAULT_API_URL.to_string())
                        .trim_end_matches('/')
                        .to_string(),
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

    /// A mailer that sends nothing, e.g. after "disconnect" on the API
    /// connections page.
    pub fn off(reason_code: &'static str) -> Self {
        Self {
            state: MailerState::NotConfigured { reason_code },
        }
    }

    /// Origin of the console the e-mails link to, without a trailing slash.
    pub fn console_url(&self) -> Option<&str> {
        match &self.state {
            MailerState::Ready { console_url, .. } => Some(console_url),
            MailerState::NotConfigured { .. } => None,
        }
    }

    /// Sender, reply-to and the last four characters of the key, for the
    /// API connections page. The key itself never leaves the server.
    pub fn summary(&self) -> Option<MailerSummary> {
        match &self.state {
            MailerState::Ready {
                from,
                reply_to,
                api_key,
                ..
            } => Some(MailerSummary {
                sender: from.clone(),
                reply_to: reply_to.clone(),
                key_hint: key_hint(api_key.expose_secret()),
            }),
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
        if crate::email_domain::check_email(&email.to).await
            == crate::email_domain::DomainStatus::NoMail
        {
            return Err(MailError::RecipientDomainNoMail);
        }
        let mut body = json!({
            "from": from,
            "to": email.to,
            "subject": email.subject,
            "text": email.text,
            "html": email.html,
            // Sign-in, payer and reminder links must not be rewritten, and no
            // pixel is added, whatever the dashboard default says.
            "track_opens": false,
            "track_clicks": false,
        });
        if let Some(reply_to) = reply_to {
            body["reply_to"] = json!(reply_to);
        }
        let body = serde_json::to_vec(&body).map_err(|_| MailError::InvalidResponse)?;
        let endpoint = format!("{api_url}/emails");

        let mut attempt = 1;
        loop {
            let result = post_once(client, &endpoint, api_key, &email.idempotency_key, &body).await;
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

impl Mailer {
    /// The provider's status of an accepted message (`GET /emails/{id}`).
    /// One attempt: the delivery sync asks again on its next run.
    pub async fn status(&self, message_id: &str) -> Result<ProviderStatus, MailError> {
        let MailerState::Ready {
            client,
            api_url,
            api_key,
            ..
        } = &self.state
        else {
            return Err(MailError::NotConfigured);
        };
        if !is_message_id(message_id) {
            return Err(MailError::NotFound);
        }
        let response = client
            .get(format!("{api_url}/emails/{message_id}"))
            .header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", api_key.expose_secret()),
            )
            .send()
            .await
            .map_err(|_| MailError::Request)?;
        let status = response.status().as_u16();
        match status {
            200 => {
                let bytes = response
                    .bytes()
                    .await
                    .map_err(|_| MailError::InvalidResponse)?;
                if bytes.len() > MAX_STATUS_RESPONSE_BYTES {
                    return Err(MailError::InvalidResponse);
                }
                let found: StatusResponse =
                    serde_json::from_slice(&bytes).map_err(|_| MailError::InvalidResponse)?;
                let word = found
                    .status
                    .or(found.last_event)
                    .ok_or(MailError::InvalidResponse)?;
                let smtp_code = match found.smtp_code {
                    Some(serde_json::Value::String(code)) => Some(code),
                    Some(serde_json::Value::Number(code)) => Some(code.to_string()),
                    _ => None,
                }
                .map(|code| bounded(&code, 16))
                .filter(|code| !code.is_empty());
                Ok(ProviderStatus {
                    status: bounded(&word, 64).to_ascii_lowercase(),
                    smtp_code,
                })
            }
            404 => Err(MailError::NotFound),
            401 | 403 => Err(MailError::Rejected(status)),
            429 => Err(MailError::QuotaReached),
            500..=599 => Err(MailError::Unavailable(status)),
            _ => Err(MailError::InvalidResponse),
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

/// What an error answer means, by its documented `code` first and the HTTP
/// status second (eusend error codes, docs/reference/error-codes).
fn classify_error(status: u16, code: Option<&str>, retry_after: Option<Duration>) -> Attempt {
    match code {
        Some("RECIPIENT_DOMAIN_UNDELIVERABLE") => {
            return Attempt::Final(MailError::RecipientDomainNoMail);
        }
        Some("ALL_SUPPRESSED") => return Attempt::Final(MailError::RecipientBlocked),
        // Daily or monthly volume, plan limits: waiting seconds does not help.
        Some("DAILY_LIMIT_EXCEEDED" | "MONTHLY_LIMIT_EXCEEDED" | "PLAN_LIMIT_EXCEEDED") => {
            return Attempt::Final(MailError::QuotaReached);
        }
        // Key, sender domain or account state: the administrator has to act.
        Some(
            "UNAUTHORIZED"
            | "FORBIDDEN"
            | "DOMAIN_NOT_VERIFIED"
            | "SENDING_SUSPENDED"
            | "ACCOUNT_RESTRICTED"
            | "WORKSPACE_INACTIVE"
            | "SENDER_NOT_PERMITTED"
            | "LIST_SEND_HELD",
        ) => return Attempt::Final(MailError::Rejected(status)),
        Some("SERVICE_PAUSED" | "INTERNAL_ERROR" | "ATTACHMENT_STORAGE_ERROR") => {
            return Attempt::Retry {
                error: MailError::Unavailable(status),
                wait: Some(
                    retry_after
                        .unwrap_or(Duration::from_millis(500))
                        .min(MAX_RETRY_AFTER),
                ),
            };
        }
        _ => {}
    }
    match status {
        401 | 403 => Attempt::Final(MailError::Rejected(status)),
        400 | 409 | 413 | 422 => Attempt::Final(MailError::InvalidMessage(status)),
        // `RATE_LIMITED` (100 requests per 10 s) or an unknown 429.
        429 => Attempt::Retry {
            error: MailError::QuotaReached,
            wait: match retry_after {
                Some(wait) if wait <= MAX_RETRY_AFTER => Some(wait),
                Some(_) => None,
                None => Some(Duration::from_secs(1)),
            },
        },
        500..=599 => Attempt::Retry {
            error: MailError::Unavailable(status),
            wait: Some(
                retry_after
                    .unwrap_or(Duration::from_millis(500))
                    .min(MAX_RETRY_AFTER),
            ),
        },
        _ => Attempt::Final(MailError::InvalidMessage(status)),
    }
}

async fn post_once(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &SecretString,
    idempotency_key: &str,
    body: &[u8],
) -> Result<SentEmail, Attempt> {
    let response = client
        .post(endpoint)
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
    let bytes = response.bytes().await.ok();
    let bytes = bytes.filter(|bytes| bytes.len() <= MAX_RESPONSE_BYTES);
    match status {
        // eusend: 201 for a new message, 200 for a repeat of an idempotency
        // key (the id of the first message).
        200..=202 => {
            let bytes = bytes.ok_or(Attempt::Final(MailError::InvalidResponse))?;
            let accepted: AcceptedResponse = serde_json::from_slice(&bytes)
                .map_err(|_| Attempt::Final(MailError::InvalidResponse))?;
            if !is_message_id(&accepted.id) {
                return Err(Attempt::Final(MailError::InvalidResponse));
            }
            Ok(SentEmail {
                message_id: accepted.id,
                replayed: status == 200,
            })
        }
        _ => {
            let code = bytes
                .as_deref()
                .and_then(|bytes| serde_json::from_slice::<ErrorResponse>(bytes).ok())
                .and_then(|error| error.code);
            Err(classify_error(status, code.as_deref(), retry_after))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{
        Router,
        extract::{Path, State},
        http::HeaderMap,
        response::IntoResponse,
        routing::{get, post},
    };

    use super::*;

    const MESSAGE_ID: &str = "9a8b7c6d-5e4f-4a3b-8c1d-0e9f8a7b6c5d";

    /// HTTP status and optional error `code` of a stand-in answer.
    type Answer = (u16, Option<&'static str>);

    #[derive(Clone, Default)]
    struct Captured {
        requests: Arc<Mutex<Vec<(HeaderMap, serde_json::Value)>>>,
        /// HTTP status and optional error `code` of the next answers.
        answers: Arc<Mutex<Vec<Answer>>>,
    }

    async fn receive(
        State(captured): State<Captured>,
        headers: HeaderMap,
        body: axum::body::Bytes,
    ) -> axum::response::Response {
        let json = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
        captured.requests.lock().unwrap().push((headers, json));
        let (status, code) = {
            let mut answers = captured.answers.lock().unwrap();
            if answers.is_empty() {
                (201, None)
            } else {
                answers.remove(0)
            }
        };
        let status = axum::http::StatusCode::from_u16(status).unwrap();
        if status.is_success() {
            (status, axum::Json(json!({ "id": MESSAGE_ID }))).into_response()
        } else {
            (
                status,
                [("Retry-After", "0")],
                axum::Json(json!({ "error": "refused", "code": code.unwrap_or("INTERNAL_ERROR") })),
            )
                .into_response()
        }
    }

    async fn report(
        State(captured): State<Captured>,
        headers: HeaderMap,
        Path(id): Path<String>,
    ) -> axum::response::Response {
        captured
            .requests
            .lock()
            .unwrap()
            .push((headers, json!({ "get": id })));
        match id.as_str() {
            // The eusend shape: camelCase, rendered body, events, no SMTP code.
            "sent-1" => axum::Json(json!({
                "id": id,
                "from": "zugang@gmed-health.com",
                "to": ["anna@example.test"],
                "subject": "Ihr Zugang",
                "html": "<p>x</p>".repeat(20_000),
                "text": "x",
                "status": "Sent",
                "tags": {},
                "testMode": false,
                "createdAt": "2026-11-16T09:14:07.000Z",
                "events": [{ "type": "sent", "createdAt": "2026-11-16T09:14:09.000Z" }],
            }))
            .into_response(),
            // The Resend shape: `last_event` instead of `status`.
            "resend-1" => {
                axum::Json(json!({ "id": id, "last_event": "delivered" })).into_response()
            }
            "number-1" => axum::Json(json!({ "id": id, "status": "bounced", "smtp_code": 550 }))
                .into_response(),
            "empty-1" => axum::Json(json!({ "id": id })).into_response(),
            "denied-1" => (
                axum::http::StatusCode::FORBIDDEN,
                axum::Json(json!({ "error": "Forbidden", "code": "FORBIDDEN" })),
            )
                .into_response(),
            _ => axum::http::StatusCode::NOT_FOUND.into_response(),
        }
    }

    /// A local stand-in for the eusend API; nothing leaves the machine.
    async fn fake_api(answers: Vec<Answer>) -> (String, Captured) {
        let captured = Captured::default();
        *captured.answers.lock().unwrap() = answers;
        let app = Router::new()
            .route("/emails", post(receive))
            .route("/emails/{id}", get(report))
            .with_state(captured.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/"), captured)
    }

    fn mailer(api_url: String) -> Mailer {
        Mailer::new(MailConfig {
            api_key: Some(SecretString::from("eu_test_key")),
            api_url: Some(api_url),
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
        assert_eq!(off.capability().reason_code, "mail_api_key_missing");
        assert_eq!(off.capability().provider, "eusend");
        let no_sender = Mailer::new(MailConfig {
            api_key: Some(SecretString::from("eu_test_key")),
            console_url: Some("https://console.gmed-health.com".into()),
            ..MailConfig::default()
        });
        assert_eq!(no_sender.capability().reason_code, "mail_from_missing");
        let ready = mailer(MAIL_DEFAULT_API_URL.into());
        assert!(ready.capability().available);
        assert_eq!(ready.console_url(), Some("https://console.gmed-health.com"));
    }

    #[test]
    fn the_default_api_is_eusend() {
        assert_eq!(MAIL_DEFAULT_API_URL, "https://api.eusend.dev");
        let MailerState::Ready { api_url, .. } = Mailer::new(MailConfig {
            api_key: Some(SecretString::from("eu_test_key")),
            from: Some("zugang@gmed-health.com".into()),
            console_url: Some("https://console.gmed-health.com".into()),
            ..MailConfig::default()
        })
        .state
        else {
            panic!("ready");
        };
        assert_eq!(api_url, "https://api.eusend.dev");
    }

    #[tokio::test]
    async fn not_configured_sends_nothing() {
        let off = Mailer::new(MailConfig::default());
        assert_eq!(off.send(&message()).await, Err(MailError::NotConfigured));
    }

    #[tokio::test]
    async fn sends_html_and_text_with_bearer_key_and_idempotency_key() {
        let (url, captured) = fake_api(vec![]).await;
        let sent = mailer(url).send(&message()).await.unwrap();
        assert_eq!(sent.message_id, MESSAGE_ID);
        assert!(!sent.replayed);
        let requests = captured.requests.lock().unwrap();
        let (headers, body) = &requests[0];
        assert_eq!(headers["authorization"], "Bearer eu_test_key");
        assert_eq!(headers["idempotency-key"], "key-1");
        assert_eq!(body["from"], "zugang@gmed-health.com");
        assert_eq!(body["to"], "anna@example.test");
        assert_eq!(body["reply_to"], "info@gmed-health.com");
        assert_eq!(body["text"], "Text");
        assert_eq!(body["html"], "<p>Text</p>");
        assert_eq!(body["track_opens"], false);
        assert_eq!(body["track_clicks"], false);
        assert!(body.get("attachments").is_none());
    }

    #[tokio::test]
    async fn a_repeat_with_the_same_key_is_reported_as_replayed() {
        let (url, _) = fake_api(vec![(200, None)]).await;
        assert!(mailer(url).send(&message()).await.unwrap().replayed);
    }

    #[tokio::test]
    async fn a_temporary_outage_is_retried() {
        let (url, captured) = fake_api(vec![(503, Some("SERVICE_PAUSED")), (201, None)]).await;
        assert!(mailer(url).send(&message()).await.is_ok());
        assert_eq!(captured.requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_rejected_key_or_domain_is_not_retried() {
        for (status, code) in [
            (401, "UNAUTHORIZED"),
            (403, "DOMAIN_NOT_VERIFIED"),
            (403, "SENDING_SUSPENDED"),
        ] {
            let (url, captured) = fake_api(vec![(status, Some(code))]).await;
            let error = mailer(url).send(&message()).await.unwrap_err();
            assert_eq!(error, MailError::Rejected(status), "{code}");
            assert_eq!(error.code(), "mail_rejected");
            assert_eq!(captured.requests.lock().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn provider_error_codes_map_to_our_codes() {
        for (status, code, expected) in [
            (422, "VALIDATION_ERROR", MailError::InvalidMessage(422)),
            (400, "VALIDATION_ERROR", MailError::InvalidMessage(400)),
            (
                422,
                "RECIPIENT_DOMAIN_UNDELIVERABLE",
                MailError::RecipientDomainNoMail,
            ),
            (422, "ALL_SUPPRESSED", MailError::RecipientBlocked),
            (429, "DAILY_LIMIT_EXCEEDED", MailError::QuotaReached),
            (429, "MONTHLY_LIMIT_EXCEEDED", MailError::QuotaReached),
        ] {
            let (url, captured) = fake_api(vec![(status, Some(code))]).await;
            assert_eq!(mailer(url).send(&message()).await, Err(expected), "{code}");
            // None of these is retried.
            assert_eq!(captured.requests.lock().unwrap().len(), 1, "{code}");
        }
        assert_eq!(MailError::RecipientBlocked.code(), "mail_recipient_blocked");
        let (url, captured) = fake_api(vec![
            (429, Some("RATE_LIMITED")),
            (429, Some("RATE_LIMITED")),
            (429, Some("RATE_LIMITED")),
        ])
        .await;
        assert_eq!(
            mailer(url).send(&message()).await,
            Err(MailError::QuotaReached)
        );
        assert_eq!(captured.requests.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn reads_the_status_of_an_accepted_message() {
        let (url, captured) = fake_api(vec![]).await;
        let mailer = mailer(url);
        assert_eq!(
            mailer.status("sent-1").await,
            Ok(ProviderStatus {
                status: "sent".into(),
                smtp_code: None,
            })
        );
        assert_eq!(mailer.status("resend-1").await.unwrap().status, "delivered");
        assert_eq!(
            mailer.status("number-1").await.unwrap().smtp_code,
            Some("550".into())
        );
        assert_eq!(
            mailer.status("empty-1").await,
            Err(MailError::InvalidResponse)
        );
        assert_eq!(
            mailer.status("denied-1").await,
            Err(MailError::Rejected(403))
        );
        assert_eq!(mailer.status("other-1").await, Err(MailError::NotFound));
        let requests = captured.requests.lock().unwrap();
        assert_eq!(requests[0].0["authorization"], "Bearer eu_test_key");
        assert_eq!(requests[0].1["get"], "sent-1");
    }

    #[tokio::test]
    async fn an_odd_message_id_never_reaches_the_request_path() {
        let (url, captured) = fake_api(vec![]).await;
        let mailer = mailer(url);
        for id in ["", "../keys", "email_01?x=1", "email 01"] {
            assert_eq!(mailer.status(id).await, Err(MailError::NotFound), "{id}");
        }
        assert!(captured.requests.lock().unwrap().is_empty());
        assert_eq!(
            Mailer::new(MailConfig::default()).status(MESSAGE_ID).await,
            Err(MailError::NotConfigured)
        );
    }
}
