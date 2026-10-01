//! GMED API client: sign-in (password plus authenticator code or admin
//! approval), refresh-token rotation and uploads into the document intake
//! queue or the personnel-file intake.

use std::fmt;
use std::io::Cursor;
use std::sync::{Arc, OnceLock};
use std::thread::sleep;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use chrono::Utc;
use reqwest::blocking::{Client, Response, multipart};
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::config::{Paths, Session};

/// The server's `MAX_FILE_SIZE` for document uploads.
pub const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;
/// Refresh the access token this long before it expires.
const REFRESH_MARGIN_SECONDS: i64 = 60;
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const TOTP_ATTEMPTS: usize = 3;

/// `https://gmed.example.de` (or `.../api/v1`) to the API root with a
/// trailing slash. Plain HTTP is only accepted for a local development host.
pub fn api_base(server: &str) -> Result<Url> {
    let trimmed = server.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        bail!("no GMED server configured; run `gmed-scan login --server https://...`");
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut url =
        Url::parse(&with_scheme).with_context(|| format!("invalid GMED address {server:?}"))?;
    match url.scheme() {
        "https" => {}
        "http" if is_local_host(url.host_str().unwrap_or_default()) => {}
        "http" => bail!("the GMED address must use https (plain http only for localhost)"),
        _ => bail!("the GMED address must use https"),
    }
    let path = url.path().trim_end_matches('/').to_string();
    let path = if path.ends_with("/api/v1") {
        format!("{path}/")
    } else {
        format!("{path}/api/v1/")
    };
    url.set_path(&path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

/// Loopback only: `*.localhost` names resolve to the local machine, while
/// other names (even reserved ones like `.test`) may point into a network.
fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1") || host.ends_with(".localhost")
}

/// The local refusal for a document above GMED's upload limit.
pub fn too_large(file_name: &str, size: u64) -> ApiError {
    ApiError {
        status: StatusCode::PAYLOAD_TOO_LARGE,
        message: format!(
            "{file_name} is {:.1} MB; GMED accepts at most 25 MB per document (scan in gray or at a lower dpi, or split it)",
            size as f64 / 1_048_576.0
        ),
    }
}

/// Upload bytes shared between request attempts (a retry after a token
/// refresh) without copying them.
#[derive(Clone)]
struct SharedBytes(Arc<Vec<u8>>);

impl AsRef<[u8]> for SharedBytes {
    fn as_ref(&self) -> &[u8] {
        self.0.as_slice()
    }
}

/// An answer from GMED other than success.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} (HTTP {})",
            self.message,
            self.status.as_u16()
        )
    }
}

impl std::error::Error for ApiError {}

impl ApiError {
    /// GMED refused the file itself (type, size, content): sending the same
    /// file again cannot succeed.
    pub fn rejects_file(&self) -> bool {
        matches!(self.status.as_u16(), 400 | 413 | 415 | 422)
    }

    fn from_response(response: Response) -> Self {
        let status = response.status();
        let body: Value = response.json().unwrap_or(Value::Null);
        let message = ["message", "error"]
            .iter()
            .find_map(|key| body.get(key).and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| {
                status
                    .canonical_reason()
                    .unwrap_or("request failed")
                    .to_string()
            });
        Self { status, message }
    }
}

fn check(response: Response) -> Result<Response> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(ApiError::from_response(response).into())
    }
}

#[derive(Debug, Deserialize)]
struct TokenReply {
    status: Option<String>,
    challenge_id: Option<String>,
    pending_id: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    #[serde(default)]
    password_change_required: bool,
}

impl TokenReply {
    fn into_session(self, server: &str, email: &str) -> Result<Session> {
        let (Some(access_token), Some(refresh_token)) = (self.access_token, self.refresh_token)
        else {
            bail!("GMED did not return a session");
        };
        let expires_in = self.expires_in.unwrap_or(15 * 60).max(0);
        Ok(Session {
            server: server.to_string(),
            email: email.to_string(),
            access_token,
            refresh_token,
            access_expires_at: Utc::now().timestamp() + expires_in,
        })
    }
}

/// Operator interaction during sign-in.
pub trait LoginPrompt {
    /// The current code of the user's authenticator app.
    fn totp_code(&mut self, retry: bool) -> Result<String>;
    /// Called once when the account needs an administrator's approval.
    fn waiting_for_approval(&mut self);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Profile {
    pub email: String,
    pub name: Option<String>,
    pub role: String,
}

impl Profile {
    /// Roles the server lets add documents to the intake queue.
    pub fn can_use_intake(&self) -> bool {
        matches!(self.role.as_str(), "ceo" | "patient_manager")
    }
}

/// Which GMED intake receives the uploads.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Destination {
    /// The document intake queue (`documents/upload`, `manual_intake`).
    #[default]
    Documents,
    /// The personnel-file intake (`personnel/intake`): payroll and HR papers
    /// that the CEO files into an employee's Personalakte. The scan account
    /// can submit but not read them back.
    Personnel,
}

impl Destination {
    /// How the destination is named in messages.
    pub fn label(self) -> &'static str {
        match self {
            Destination::Documents => "the GMED intake queue",
            Destination::Personnel => "the GMED personnel-file intake",
        }
    }
}

static DEFAULT_DESTINATION: OnceLock<Destination> = OnceLock::new();

/// Sets the destination every [`Gmed`] client of this process uses (the
/// `--personnel` switch). Only the first call counts.
pub fn set_default_destination(destination: Destination) {
    let _ = DEFAULT_DESTINATION.set(destination);
}

pub struct IntakeUpload {
    pub file_name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
    /// Document title; GMED uses the file name when absent.
    pub title: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadedDocument {
    pub id: String,
}

pub struct Gmed {
    http: Client,
    paths: Paths,
    destination: Destination,
}

fn user_agent() -> String {
    format!(
        "gmed-scan/{} ({})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    )
}

impl Gmed {
    pub fn new(paths: Paths) -> Result<Self> {
        let http = Client::builder()
            .user_agent(user_agent())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .build()
            .context("create the GMED HTTP client")?;
        Ok(Self {
            http,
            paths,
            destination: DEFAULT_DESTINATION.get().copied().unwrap_or_default(),
        })
    }

    /// The same client filing into another intake.
    pub fn with_destination(mut self, destination: Destination) -> Self {
        self.destination = destination;
        self
    }

    pub fn destination(&self) -> Destination {
        self.destination
    }

    pub fn paths(&self) -> &Paths {
        &self.paths
    }

    /// Sign in and store the session. A session that must change its
    /// password first is closed again: it could not upload anything.
    pub fn login(
        &self,
        server: &str,
        email: &str,
        password: &str,
        prompt: &mut dyn LoginPrompt,
    ) -> Result<Session> {
        let base = api_base(server)?;
        let response = self
            .http
            .post(base.join("auth/login")?)
            .json(&json!({
                "email": email,
                "password": password,
                "device_info": {
                    "client": "gmed-scan",
                    "version": env!("CARGO_PKG_VERSION"),
                    "os": std::env::consts::OS,
                },
            }))
            .send()
            .with_context(|| format!("cannot reach GMED at {base}"))?;
        let mut reply: TokenReply = check(response)?
            .json()
            .context("unexpected sign-in answer")?;

        match reply.status.as_deref() {
            Some("totp_required") => {
                let challenge_id = reply
                    .challenge_id
                    .clone()
                    .ok_or_else(|| anyhow!("GMED asked for a code without a challenge"))?;
                reply = self.complete_totp(&base, &challenge_id, prompt)?;
            }
            Some("mfa_pending") => {
                let pending_id = reply
                    .pending_id
                    .clone()
                    .ok_or_else(|| anyhow!("GMED asked for approval without a request id"))?;
                prompt.waiting_for_approval();
                reply = self.wait_for_approval(&base, &pending_id)?;
            }
            _ => {}
        }

        let password_change_required = reply.password_change_required;
        let session = reply.into_session(server.trim(), email)?;
        if password_change_required {
            let _ = self
                .http
                .post(base.join("auth/logout")?)
                .bearer_auth(&session.access_token)
                .send();
            bail!(
                "this account must change its password first; sign in to GMED in the browser, change it, then run `gmed-scan login` again"
            );
        }
        self.paths.save_session(&session)?;
        Ok(session)
    }

    fn complete_totp(
        &self,
        base: &Url,
        challenge_id: &str,
        prompt: &mut dyn LoginPrompt,
    ) -> Result<TokenReply> {
        for attempt in 0..TOTP_ATTEMPTS {
            let code = prompt.totp_code(attempt > 0)?;
            let response = self
                .http
                .post(base.join("auth/totp")?)
                .json(&json!({ "challenge_id": challenge_id, "code": code.trim() }))
                .send()
                .context("cannot reach GMED")?;
            if response.status().is_success() {
                return response.json().context("unexpected sign-in answer");
            }
            let error = ApiError::from_response(response);
            let retryable = error.status == StatusCode::UNAUTHORIZED
                && error.message.contains("does not match")
                && attempt + 1 < TOTP_ATTEMPTS;
            if !retryable {
                return Err(error.into());
            }
        }
        unreachable!("the last attempt returns")
    }

    fn wait_for_approval(&self, base: &Url, pending_id: &str) -> Result<TokenReply> {
        let url = base.join(&format!("auth/pending/{pending_id}"))?;
        let deadline = Instant::now() + APPROVAL_TIMEOUT;
        loop {
            let reply: TokenReply = check(
                self.http
                    .get(url.clone())
                    .send()
                    .context("cannot reach GMED")?,
            )?
            .json()
            .context("unexpected approval answer")?;
            match reply.status.as_deref() {
                Some("approved") => return Ok(reply),
                Some("rejected") => bail!("the sign-in was rejected or has expired"),
                _ if Instant::now() >= deadline => {
                    bail!("no administrator approved the sign-in in time")
                }
                _ => sleep(Duration::from_secs(3)),
            }
        }
    }

    /// End the stored session on the server and forget it locally.
    pub fn logout(&self) -> Result<bool> {
        if self.paths.load_session()?.is_none() {
            return Ok(false);
        }
        // Best effort: the local session is forgotten even when GMED is
        // unreachable or the session has already ended there.
        let _ = self.authorized(|http, base, token| {
            http.post(base.join("auth/logout")?)
                .bearer_auth(token)
                .send()
                .map_err(Into::into)
        });
        self.paths.clear_session()?;
        Ok(true)
    }

    pub fn profile(&self) -> Result<Profile> {
        let response = self.authorized(|http, base, token| {
            http.get(base.join("me")?)
                .bearer_auth(token)
                .send()
                .map_err(Into::into)
        })?;
        let body: Value = check(response)?
            .json()
            .context("unexpected profile answer")?;
        let text = |key: &str| body.get(key).and_then(Value::as_str).map(str::to_string);
        Ok(Profile {
            email: text("email").unwrap_or_default(),
            name: text("name"),
            role: text("role").unwrap_or_default(),
        })
    }

    /// File a document into the intake queue: status `draft`, no patient,
    /// origin `manual_intake`; staff link and classify it during review.
    /// With [`Destination::Personnel`] the file goes to the personnel-file
    /// intake instead (title and notes are not sent there).
    pub fn upload_intake(&self, upload: IntakeUpload) -> Result<UploadedDocument> {
        if upload.bytes.len() > MAX_UPLOAD_BYTES {
            return Err(too_large(&upload.file_name, upload.bytes.len() as u64).into());
        }
        let length = upload.bytes.len() as u64;
        let bytes = SharedBytes(Arc::new(upload.bytes));
        let destination = self.destination;
        let response = self.authorized(|http, base, token| {
            let file = multipart::Part::reader_with_length(Cursor::new(bytes.clone()), length)
                .file_name(upload.file_name.clone())
                .mime_str(&upload.mime)?;
            if destination == Destination::Personnel {
                let form = multipart::Form::new()
                    .part("file", file)
                    .text("source", "scan");
                return http
                    .post(base.join("personnel/intake")?)
                    .bearer_auth(token)
                    .multipart(form)
                    .send()
                    .map_err(Into::into);
            }
            let mut form = multipart::Form::new()
                .part("file", file)
                .text("manual_intake", "true");
            if let Some(title) = upload
                .title
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                form = form.text("auto_name", title.trim().to_string());
            }
            if let Some(notes) = upload
                .notes
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                form = form.text("notes", notes.trim().to_string());
            }
            http.post(base.join("documents/upload")?)
                .bearer_auth(token)
                .multipart(form)
                .send()
                .map_err(Into::into)
        })?;
        let body: Value = check(response)?
            .json()
            .context("unexpected upload answer")?;
        let id = body
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("GMED did not return the document id"))?;
        Ok(UploadedDocument { id: id.to_string() })
    }

    /// Run a request with a valid access token, refreshing it before it
    /// expires and once more if GMED answers 401.
    fn authorized(
        &self,
        send: impl Fn(&Client, &Url, &str) -> Result<Response>,
    ) -> Result<Response> {
        let mut session = self
            .paths
            .load_session()?
            .ok_or_else(|| anyhow!("not signed in; run `gmed-scan login`"))?;
        if session.access_expires_at - Utc::now().timestamp() < REFRESH_MARGIN_SECONDS {
            session = self.refresh(&session.access_token)?;
        }
        let base = api_base(&session.server)?;
        let response = send(&self.http, &base, &session.access_token)
            .with_context(|| format!("cannot reach GMED at {base}"))?;
        if response.status() != StatusCode::UNAUTHORIZED {
            return Ok(response);
        }
        session = self.refresh(&session.access_token)?;
        send(&self.http, &base, &session.access_token)
            .with_context(|| format!("cannot reach GMED at {base}"))
    }

    /// Exchange the refresh token under the session lock. Another process
    /// may have refreshed meanwhile; its fresh token is reused instead of
    /// spending the (already rotated) refresh token a second time.
    fn refresh(&self, stale_access_token: &str) -> Result<Session> {
        let _lock = self.paths.lock_session()?;
        let session = self
            .paths
            .load_session()?
            .ok_or_else(|| anyhow!("not signed in; run `gmed-scan login`"))?;
        let now = Utc::now().timestamp();
        if session.access_token != stale_access_token
            && session.access_expires_at - now >= REFRESH_MARGIN_SECONDS
        {
            return Ok(session);
        }
        let base = api_base(&session.server)?;
        let response = self
            .http
            .post(base.join("auth/refresh")?)
            .json(&json!({ "refresh_token": session.refresh_token }))
            .send()
            .with_context(|| format!("cannot reach GMED at {base}"))?;
        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            let error = ApiError::from_response(response);
            self.paths.clear_session()?;
            return Err(ApiError {
                status: StatusCode::UNAUTHORIZED,
                message: format!(
                    "the GMED session has ended ({}); run `gmed-scan login`",
                    error.message
                ),
            }
            .into());
        }
        let reply: TokenReply = check(response)?
            .json()
            .context("unexpected refresh answer")?;
        let refreshed = reply.into_session(&session.server, &session.email)?;
        self.paths.save_session(&refreshed)?;
        Ok(refreshed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{MockReply, MockServer, temp_dir};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct ScriptedPrompt {
        codes: Vec<&'static str>,
        approvals: usize,
    }

    impl LoginPrompt for ScriptedPrompt {
        fn totp_code(&mut self, _retry: bool) -> Result<String> {
            Ok(self.codes.remove(0).to_string())
        }
        fn waiting_for_approval(&mut self) {
            self.approvals += 1;
        }
    }

    fn tokens(access: &str, refresh: &str) -> MockReply {
        MockReply::json(json!({
            "access_token": access,
            "refresh_token": refresh,
            "token_type": "Bearer",
            "expires_in": 900,
            "password_change_required": false,
        }))
    }

    #[test]
    fn builds_the_api_root() {
        for (input, expected) in [
            ("https://gmed.example.de", "https://gmed.example.de/api/v1/"),
            ("gmed.example.de/", "https://gmed.example.de/api/v1/"),
            (
                "https://gmed.example.de/api/v1",
                "https://gmed.example.de/api/v1/",
            ),
            ("http://127.0.0.1:3300", "http://127.0.0.1:3300/api/v1/"),
            (
                "http://scan.localhost:4174",
                "http://scan.localhost:4174/api/v1/",
            ),
        ] {
            assert_eq!(api_base(input).unwrap().as_str(), expected);
        }
        assert!(api_base("http://gmed.example.de").is_err());
        assert!(
            api_base("http://gmed.test").is_err(),
            "only loopback may use plain http"
        );
        assert!(api_base("").is_err());
    }

    #[test]
    fn signs_in_with_an_authenticator_code_and_retries_a_typo() {
        let server = MockServer::start(|request| match request.path.as_str() {
            "/api/v1/auth/login" => {
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                assert_eq!(body["email"], "pm@example.test");
                assert_eq!(body["device_info"]["client"], "gmed-scan");
                MockReply::json(json!({ "status": "totp_required", "challenge_id": "c-1" }))
            }
            "/api/v1/auth/totp" => {
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                assert_eq!(body["challenge_id"], "c-1");
                if body["code"] == "123456" {
                    tokens("access-1", "refresh-1")
                } else {
                    MockReply::json(
                        json!({ "error": "Unauthorized", "message": "The code does not match" }),
                    )
                    .with_status(401)
                }
            }
            _ => MockReply::status(404),
        });
        let paths = Paths::at(temp_dir("login-totp"));
        let gmed = Gmed::new(paths.clone()).unwrap();
        let mut prompt = ScriptedPrompt {
            codes: vec!["000000", "123456"],
            approvals: 0,
        };
        let session = gmed
            .login(
                &server.url(),
                "pm@example.test",
                "correct horse",
                &mut prompt,
            )
            .unwrap();
        assert_eq!(session.refresh_token, "refresh-1");
        assert_eq!(paths.load_session().unwrap(), Some(session));
    }

    #[test]
    fn waits_for_an_administrator_to_approve_the_sign_in() {
        let server = MockServer::start(|request| match request.path.as_str() {
            "/api/v1/auth/login" => {
                MockReply::json(json!({ "status": "mfa_pending", "pending_id": "p-1" }))
            }
            "/api/v1/auth/pending/p-1" if request.seen == 0 => {
                MockReply::json(json!({ "status": "pending" }))
            }
            "/api/v1/auth/pending/p-1" => MockReply::json(json!({
                "status": "approved",
                "access_token": "access-2",
                "refresh_token": "refresh-2",
                "expires_in": 900,
            })),
            _ => MockReply::status(404),
        });
        let gmed = Gmed::new(Paths::at(temp_dir("login-approval"))).unwrap();
        let mut prompt = ScriptedPrompt {
            codes: vec![],
            approvals: 0,
        };
        let session = gmed
            .login(
                &server.url(),
                "pm@example.test",
                "correct horse",
                &mut prompt,
            )
            .unwrap();
        assert_eq!(session.access_token, "access-2");
        assert_eq!(prompt.approvals, 1);
    }

    #[test]
    fn refuses_to_keep_a_session_that_must_change_its_password() {
        let server = MockServer::start(|request| match request.path.as_str() {
            "/api/v1/auth/login" => MockReply::json(json!({
                "access_token": "a", "refresh_token": "r", "expires_in": 900,
                "password_change_required": true,
            })),
            _ => MockReply::status(204),
        });
        let paths = Paths::at(temp_dir("login-password-change"));
        let gmed = Gmed::new(paths.clone()).unwrap();
        let mut prompt = ScriptedPrompt {
            codes: vec![],
            approvals: 0,
        };
        let error = gmed
            .login(
                &server.url(),
                "pm@example.test",
                "correct horse",
                &mut prompt,
            )
            .unwrap_err();
        assert!(error.to_string().contains("change its password"), "{error}");
        assert_eq!(paths.load_session().unwrap(), None);
        assert!(
            server
                .requests()
                .iter()
                .any(|request| request.path == "/api/v1/auth/logout")
        );
    }

    #[test]
    fn uploads_into_the_intake_queue_after_refreshing_an_expired_token() {
        let refreshes = Arc::new(AtomicUsize::new(0));
        let counter = refreshes.clone();
        let server = MockServer::start(move |request| match request.path.as_str() {
            "/api/v1/auth/refresh" => {
                counter.fetch_add(1, Ordering::SeqCst);
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                assert_eq!(body["refresh_token"], "refresh-old");
                tokens("access-new", "refresh-new")
            }
            "/api/v1/documents/upload" => {
                assert_eq!(
                    request.header("authorization").as_deref(),
                    Some("Bearer access-new")
                );
                let body = String::from_utf8_lossy(&request.body);
                assert!(
                    body.contains("name=\"manual_intake\"\r\n\r\ntrue"),
                    "{body}"
                );
                assert!(body.contains("filename=\"scan.pdf\""), "{body}");
                assert!(
                    body.contains("name=\"notes\"\r\n\r\nScanner: EPSON DS-790WN"),
                    "{body}"
                );
                assert!(body.contains("%PDF-1.7 test"), "{body}");
                assert!(
                    !body.contains("auto_name"),
                    "no title means GMED keeps the file name"
                );
                MockReply::json(json!({ "ok": true, "id": "doc-1" }))
            }
            _ => MockReply::status(404),
        });
        let paths = Paths::at(temp_dir("upload"));
        paths
            .save_session(&Session {
                server: server.url(),
                email: "pm@example.test".into(),
                access_token: "access-old".into(),
                refresh_token: "refresh-old".into(),
                access_expires_at: Utc::now().timestamp() - 5,
            })
            .unwrap();
        let gmed = Gmed::new(paths.clone()).unwrap();
        let upload = IntakeUpload {
            file_name: "scan.pdf".into(),
            mime: "application/pdf".into(),
            bytes: b"%PDF-1.7 test".to_vec(),
            title: None,
            notes: Some("Scanner: EPSON DS-790WN".into()),
        };
        assert_eq!(gmed.upload_intake(upload).unwrap().id, "doc-1");
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        let stored = paths.load_session().unwrap().unwrap();
        assert_eq!(
            stored.refresh_token, "refresh-new",
            "the rotated token is persisted"
        );
    }

    #[test]
    fn personnel_destination_uploads_into_the_personnel_intake() {
        let server = MockServer::start(|request| match request.path.as_str() {
            "/api/v1/personnel/intake" => {
                let body = String::from_utf8_lossy(&request.body);
                assert!(body.contains("name=\"source\"\r\n\r\nscan"), "{body}");
                assert!(body.contains("filename=\"Scan_1.pdf\""), "{body}");
                assert!(
                    !body.contains("manual_intake") && !body.contains("notes"),
                    "personnel scans carry no document-intake fields: {body}"
                );
                MockReply::json(json!({ "id": "intake-1", "status": "pending" })).with_status(201)
            }
            _ => MockReply::status(404),
        });
        let paths = Paths::at(temp_dir("personnel-upload"));
        paths
            .save_session(&Session {
                server: server.url(),
                email: "ceo@example.test".into(),
                access_token: "access".into(),
                refresh_token: "refresh".into(),
                access_expires_at: Utc::now().timestamp() + 600,
            })
            .unwrap();
        let gmed = Gmed::new(paths)
            .unwrap()
            .with_destination(Destination::Personnel);
        assert_eq!(gmed.destination(), Destination::Personnel);
        let upload = IntakeUpload {
            file_name: "Scan_1.pdf".into(),
            mime: "application/pdf".into(),
            bytes: b"%PDF-1.7 payslip".to_vec(),
            title: Some("ignored".into()),
            notes: Some("ignored".into()),
        };
        assert_eq!(gmed.upload_intake(upload).unwrap().id, "intake-1");
        assert_eq!(server.requests().len(), 1);
    }

    #[test]
    fn a_refresh_done_by_another_process_is_reused() {
        // Any request (a second spend of the rotated refresh token) fails.
        let server = MockServer::start(|_| MockReply::status(500));
        let paths = Paths::at(temp_dir("refresh-race"));
        // Another gmed-scan process already rotated the tokens.
        paths
            .save_session(&Session {
                server: server.url(),
                email: "pm@example.test".into(),
                access_token: "access-from-other-process".into(),
                refresh_token: "refresh-rotated".into(),
                access_expires_at: Utc::now().timestamp() + 600,
            })
            .unwrap();
        let gmed = Gmed::new(paths).unwrap();
        let session = gmed.refresh("access-we-had").unwrap();
        assert_eq!(session.access_token, "access-from-other-process");
        assert!(server.requests().is_empty());
    }

    #[test]
    fn an_ended_session_is_forgotten() {
        let server = MockServer::start(|request| match request.path.as_str() {
            "/api/v1/auth/refresh" => MockReply::json(json!({
                "error": "session_revoked", "message": "This session has been revoked",
            }))
            .with_status(401),
            _ => MockReply::status(401),
        });
        let paths = Paths::at(temp_dir("refresh-revoked"));
        paths
            .save_session(&Session {
                server: server.url(),
                email: "pm@example.test".into(),
                access_token: "access".into(),
                refresh_token: "refresh".into(),
                access_expires_at: Utc::now().timestamp() + 600,
            })
            .unwrap();
        let gmed = Gmed::new(paths.clone()).unwrap();
        let error = gmed.profile().unwrap_err();
        assert!(error.to_string().contains("gmed-scan login"), "{error}");
        assert_eq!(paths.load_session().unwrap(), None);
    }

    #[test]
    fn oversized_documents_are_refused_locally() {
        let gmed = Gmed::new(Paths::at(temp_dir("oversized"))).unwrap();
        let upload = IntakeUpload {
            file_name: "big.pdf".into(),
            mime: "application/pdf".into(),
            bytes: vec![0; MAX_UPLOAD_BYTES + 1],
            title: None,
            notes: None,
        };
        let error = gmed.upload_intake(upload).unwrap_err();
        let api_error = error.downcast_ref::<ApiError>().unwrap();
        assert!(api_error.rejects_file());
    }
}
