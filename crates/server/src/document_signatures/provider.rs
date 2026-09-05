//! Skribble Sign API v2, Germany only. No redirects or caller-supplied network targets.
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use reqwest::{Client, Method};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use uuid::Uuid;

pub const MAX_PDF: usize = 25 * 1024 * 1024;
const MAX_JSON: usize = 2 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signer {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub role: String,
}

pub fn normalize_signers(mut signers: Vec<Signer>) -> Result<Vec<Signer>, &'static str> {
    if !(1..=6).contains(&signers.len()) {
        return Err("signers_count");
    }
    let mut emails = HashSet::new();
    for signer in &mut signers {
        signer.first_name = signer.first_name.trim().to_string();
        signer.last_name = signer.last_name.trim().to_string();
        signer.email = signer.email.trim().to_ascii_lowercase();
        if [&signer.first_name, &signer.last_name]
            .iter()
            .any(|s| s.is_empty() || s.len() > 120 || s.chars().any(char::is_control))
        {
            return Err("signer_name");
        }
        let parts = signer.email.split('@').collect::<Vec<_>>();
        if parts.len() != 2
            || parts[0].is_empty()
            || !parts[1].contains('.')
            || parts[1].starts_with('.')
            || parts[1].ends_with('.')
            || signer.email.len() > 254
            || !signer.email.is_ascii()
            || signer
                .email
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("signer_email");
        }
        if !emails.insert(signer.email.clone()) {
            return Err("duplicate_signer");
        }
        if !matches!(signer.role.as_str(), "client" | "agency" | "other") {
            return Err("signer_role");
        }
    }
    Ok(signers)
}

pub fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
pub fn custom(id: Uuid, hash: &str) -> String {
    format!("gmed:{id}:{hash}")
}

pub struct Provider {
    client: Client,
    base: String,
    username: String,
    key: SecretString,
    pub account: String,
    pub test_mode: bool,
    token: Mutex<Option<(Instant, SecretString)>>,
}

impl Provider {
    #[cfg(test)]
    pub(super) fn with_test_endpoint(mut self, base: String) -> Self {
        assert!(base.starts_with("http://127.0.0.1:"));
        self.base = base;
        self
    }
    pub fn from_env() -> Result<Option<Self>, &'static str> {
        if std::env::var("DOCUMENT_SIGNATURES_ENABLED").unwrap_or_default() != "true" {
            return Ok(None);
        }
        let username =
            std::env::var("SKRIBBLE_USERNAME").map_err(|_| "SKRIBBLE_USERNAME missing")?;
        let key = std::env::var("SKRIBBLE_API_KEY").map_err(|_| "SKRIBBLE_API_KEY missing")?;
        let mode = std::env::var("DOCUMENT_SIGNATURES_MODE").unwrap_or_else(|_| "demo".into());
        Self::new(username, key, &mode).map(Some)
    }

    pub fn new(username: String, key: String, mode: &str) -> Result<Self, &'static str> {
        let test_mode = match mode {
            "demo" if username.starts_with("api_demo") => true,
            "live" if username.starts_with("api_prod") => false,
            _ => return Err("Signature mode and API account do not match"),
        };
        if key.trim().is_empty() {
            return Err("Empty signature API key");
        }
        Ok(Self {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(45))
                .build()
                .map_err(|_| "Signature HTTP client")?,
            base: "https://api.skribble.de/v2".into(),
            account: sha256(format!("DE:{username}").as_bytes()),
            username,
            key: key.into(),
            test_mode,
            token: Mutex::new(None),
        })
    }

    pub fn quality(&self) -> &'static str {
        if self.test_mode { "DEMO" } else { "QES" }
    }

    pub fn username(&self) -> &str {
        &self.username
    }

    pub async fn check_connection(&self) -> Result<(), &'static str> {
        *self.token.lock().await = None;
        self.token().await.map(|_| ())
    }

    async fn bounded(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, &'static str> {
        if !response.status().is_success() {
            return Err("provider_http_error");
        }
        if response.content_length().is_some_and(|n| n > max as u64) {
            return Err("provider_response_too_large");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "provider_read_error")? {
            if bytes.len() + chunk.len() > max {
                return Err("provider_response_too_large");
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    async fn token(&self) -> Result<SecretString, &'static str> {
        let mut cached = self.token.lock().await;
        if let Some((time, token)) = cached.as_ref()
            && time.elapsed() < Duration::from_secs(900)
        {
            return Ok(token.clone());
        }
        let body = json!({"username":self.username,"api-key":self.key.expose_secret()});
        let response = self
            .client
            .post(format!("{}/access/login", self.base))
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|_| "provider_login_unavailable")?;
        let bytes = Self::bounded(response, 16 * 1024).await?;
        let token: SecretString = String::from_utf8(bytes)
            .map_err(|_| "provider_login_invalid")?
            .trim()
            .to_string()
            .into();
        if token.expose_secret().is_empty() {
            return Err("provider_login_invalid");
        }
        *cached = Some((Instant::now(), token.clone()));
        Ok(token)
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        max: usize,
    ) -> Result<Vec<u8>, &'static str> {
        let token = self.token().await?;
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(token.expose_secret());
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(body.to_string());
        }
        let response = request.send().await.map_err(|_| "provider_unavailable")?;
        // Skribble also reports expired/invalid JWTs as HTTP 403. Drop the
        // cached token so the next reconciliation authenticates again.
        // Do not replay this request: POST may dispatch signature invitations.
        if matches!(response.status().as_u16(), 401 | 403) {
            *self.token.lock().await = None;
        }
        if matches!(
            response.status().as_u16(),
            400 | 401 | 403 | 413 | 415 | 422
        ) {
            return Err("provider_request_rejected");
        }
        Self::bounded(response, max).await
    }

    pub async fn create(
        &self,
        id: Uuid,
        hash: &str,
        bytes: &[u8],
        signers: &[Signer],
    ) -> Result<Value, &'static str> {
        self.token().await.map_err(|_| "provider_login_failed")?;
        // Opaque title: no patient name or diagnosis in email subjects. No email attachments.
        let body = json!({"title":format!("GMED – Dokument {id}"),"content":STANDARD.encode(bytes),
            "content_type":"application/pdf","legislation":"EIDAS","quality":self.quality(),
            "custom":custom(id,hash),"attach_on_success":[],
            "signatures":signers.iter().map(|s| json!({"account_email":s.email,"notify":true,
                "language":"de","signer_identity_data":{"email_address":s.email,
                "first_name":s.first_name,"last_name":s.last_name,"language":"de"}})).collect::<Vec<_>>()});
        // Never retry POST: an HTTP timeout may have occurred after invitations were sent.
        let bytes = self
            .request(Method::POST, "/signature-requests", Some(body), MAX_JSON)
            .await?;
        serde_json::from_slice(&bytes).map_err(|_| "provider_invalid_json")
    }

    pub async fn get(&self, id: Uuid) -> Result<Value, &'static str> {
        let bytes = self
            .request(
                Method::GET,
                &format!("/signature-requests/{id}"),
                None,
                MAX_JSON,
            )
            .await?;
        serde_json::from_slice(&bytes).map_err(|_| "provider_invalid_json")
    }
    pub async fn find(&self, id: Uuid) -> Result<Vec<Value>, &'static str> {
        let bytes = self
            .request(
                Method::GET,
                &format!("/signature-requests?search={id}&page_size=100"),
                None,
                MAX_JSON,
            )
            .await?;
        serde_json::from_slice(&bytes).map_err(|_| "provider_invalid_json")
    }
    pub async fn withdraw(&self, id: Uuid) -> Result<(), &'static str> {
        self.request(
            Method::POST,
            &format!("/signature-requests/{id}/withdraw"),
            Some(json!({})),
            MAX_JSON,
        )
        .await
        .map(|_| ())
    }
    pub async fn pdf(&self, id: Uuid, report: bool) -> Result<Vec<u8>, &'static str> {
        let path = if report {
            format!("/signature-requests/{id}/report")
        } else {
            format!("/documents/{id}/content")
        };
        let bytes = self.request(Method::GET, &path, None, MAX_PDF).await?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("provider_invalid_pdf");
        }
        Ok(bytes)
    }

    /// Keep only evidence fields, never bearer signing links or unrestricted provider payloads.
    pub fn validate(
        &self,
        value: &Value,
        id: Uuid,
        hash: &str,
        remote_id: Option<Uuid>,
        signers: &[Signer],
    ) -> Result<VerifiedRequest, &'static str> {
        let provider_id = value["id"]
            .as_str()
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or("provider_invalid_id")?;
        let document_id = value["document_id"]
            .as_str()
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or("provider_invalid_document")?;
        if remote_id.is_some_and(|id| id != provider_id)
            || value["custom"] != custom(id, hash)
            || value["owner"] != self.username
            || value["quality"] != self.quality()
            || (!self.test_mode && value["legislation"] != "EIDAS")
        {
            return Err("provider_request_mismatch");
        }
        let status = value["status_overall"]
            .as_str()
            .ok_or("provider_invalid_status")?;
        if !matches!(
            status,
            "OPEN" | "SIGNED" | "DECLINED" | "WITHDRAWN" | "EXPIRED" | "ERROR"
        ) {
            return Err("provider_invalid_status");
        }
        let recipients = value["signatures"]
            .as_array()
            .ok_or("provider_invalid_signers")?;
        if recipients.len() != signers.len() {
            return Err("provider_signers_mismatch");
        }
        let mut evidence = Vec::new();
        let mut seen = HashSet::new();
        let mut signed_at = None;
        for recipient in recipients {
            let email = recipient["account_email"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or_else(|| recipient["signer_identity_data"]["email_address"].as_str())
                .ok_or("provider_invalid_signer")?
                .to_ascii_lowercase();
            let expected = signers
                .iter()
                .find(|s| s.email == email)
                .ok_or("provider_signers_mismatch")?;
            if !seen.insert(email.clone()) {
                return Err("provider_signers_mismatch");
            }
            if status == "SIGNED" {
                if recipient["status_code"] != "SIGNED"
                    || recipient["signed_quality"] != self.quality()
                    || (!self.test_mode && recipient["signed_legislation"] != "EIDAS")
                {
                    return Err("provider_signature_incomplete");
                }
                let time = recipient["signed_at"]
                    .as_str()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|t| t.with_timezone(&Utc))
                    .ok_or("provider_signature_time")?;
                if time > Utc::now() + chrono::Duration::minutes(5) {
                    return Err("provider_signature_time");
                }
                signed_at =
                    Some(signed_at.map_or(time, |previous: DateTime<Utc>| previous.max(time)));
            }
            evidence.push(json!({"email":email,"role":expected.role,"signature_id":recipient["sid"],
                "status":recipient["status_code"],"signed_at":recipient["signed_at"],
                "quality":recipient["signed_quality"],"legislation":recipient["signed_legislation"]}));
        }
        Ok(VerifiedRequest {
            id: provider_id,
            document_id,
            status: status.to_string(),
            signed_at,
            evidence: json!({"provider":"skribble","region":"DE","request_id":provider_id,
                "document_id":document_id,"quality":self.quality(),"signatures":evidence}),
        })
    }
}

pub struct VerifiedRequest {
    pub id: Uuid,
    pub document_id: Uuid,
    pub status: String,
    pub signed_at: Option<DateTime<Utc>>,
    pub evidence: Value,
}
