//! Integration tests for the payer's own link (owner spec "Patientenformular",
//! section 10, phase 3a): sending, resending and revoking the link, the
//! e-mail code and the session, the questionnaire with its validation, the
//! payer's uploads, the check level, the submit with the adoption into the
//! declaration, the resets and the purge. A local stand-in for the Mittaro
//! API records what would have been sent. Every request carries a peer
//! address of its own, so the tight limiter of the link never interferes.
//! Synthetic data only.

mod support;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use secrecy::SecretString;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::config::MailConfig;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const PDF: &[u8] = b"%PDF-1.4\n% synthetic payer upload\n%%EOF\n";
const OPEN: &str = "/api/v1/public/payer-link";
const CODE: &str = "/api/v1/public/payer-link/code";
const VERIFY: &str = "/api/v1/public/payer-link/verify";
const QUESTIONNAIRE: &str = "/api/v1/public/payer-link/questionnaire";
const CONSENT: &str = "/api/v1/public/payer-link/consent";
const IDENTITY: &str = "/api/v1/public/payer-link/identity-document";
const FUNDS: &str = "/api/v1/public/payer-link/funds-proof";
const SUBMIT: &str = "/api/v1/public/payer-link/submit";

static NEXT_PEER: AtomicU32 = AtomicU32::new(1);

/// A peer address of its own for every request.
fn peer() -> ConnectInfo<SocketAddr> {
    let n = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
    ConnectInfo(SocketAddr::from((
        [10, (n >> 16) as u8, (n >> 8) as u8, n as u8],
        40000,
    )))
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

/// What the stand-in Mittaro API received; `fail` answers 503.
#[derive(Clone, Default)]
struct FakeMittaro {
    received: Arc<Mutex<Vec<Value>>>,
    accepted: Arc<Mutex<HashMap<String, String>>>,
    fail: Arc<AtomicBool>,
}

async fn fake_send(
    State(fake): State<FakeMittaro>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    if fake.fail.load(Ordering::SeqCst) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [("Retry-After", "0")],
            "busy",
        )
            .into_response();
    }
    let key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    fake.received
        .lock()
        .unwrap()
        .push(serde_json::from_slice(&body).unwrap());
    let mut accepted = fake.accepted.lock().unwrap();
    let id = format!("email_{}", accepted.len() + 1);
    accepted.insert(key, id.clone());
    (
        StatusCode::ACCEPTED,
        axum::Json(json!({ "id": id, "status": "queued" })),
    )
        .into_response()
}

async fn start_fake_mittaro() -> (String, FakeMittaro) {
    let fake = FakeMittaro::default();
    let router = Router::new()
        .route("/v1/emails", post(fake_send))
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("http://{address}/v1/emails"), fake)
}

struct PayerApp {
    suite: support::TestSuiteContext,
    app: Router,
    fake: FakeMittaro,
    users: Vec<(&'static str, Uuid)>,
}

impl PayerApp {
    fn staff(&self, role: &str) -> String {
        let (_, id) = self
            .users
            .iter()
            .find(|(name, _)| *name == role)
            .unwrap_or_else(|| panic!("unexpected role {role}"));
        bearer(*id, role)
    }

    fn manager(&self) -> String {
        self.staff("patient_manager")
    }

    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }

    /// The text parts the stand-in received, oldest first.
    fn texts(&self) -> Vec<String> {
        self.fake
            .received
            .lock()
            .unwrap()
            .iter()
            .map(|message| message["text"].as_str().unwrap_or_default().to_string())
            .collect()
    }

    /// The token of the newest invitation.
    fn last_token(&self) -> String {
        let text = self
            .texts()
            .into_iter()
            .rev()
            .find(|text| text.contains("/payer#"))
            .expect("an invitation");
        let start = text.find("/payer#").unwrap() + "/payer#".len();
        text[start..start + 64].to_string()
    }

    /// The newest code.
    fn last_code(&self) -> String {
        self.texts()
            .into_iter()
            .rev()
            .find_map(|text| {
                text.lines().find_map(|line| {
                    let (_, code) = line.rsplit_once(": ")?;
                    (code.len() == 6 && code.bytes().all(|byte| byte.is_ascii_digit()))
                        .then(|| code.to_string())
                })
            })
            .expect("a code e-mail")
    }
}

async fn payer_app() -> Option<PayerApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let mut users = Vec::new();
    for role in [
        "patient_manager",
        "sales",
        "ceo_assistant",
        "billing",
        "concierge",
        "ceo",
    ] {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
        )
        .bind(format!("payer-link-{role}-{}@example.com", Uuid::new_v4().simple()))
        .bind(format!("{role} payer link"))
        .bind(role)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
        users.push((role, id));
    }
    let (api_url, fake) = start_fake_mittaro().await;
    let state = suite.state.clone().with_mailer(MailConfig {
        mittaro_api_key: Some(SecretString::from("tx_live_test")),
        mittaro_api_url: Some(api_url),
        from: Some("zugang@gmed-health.test".into()),
        reply_to: None,
        console_url: Some("https://console.gmed-health.test".into()),
    });
    let app = gmed_server::build_app_for_role_contract_tests(state);
    Some(PayerApp {
        suite,
        app,
        fake,
        users,
    })
}

async fn call(app: &PayerApp, request: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    let mut request = request;
    request.extensions_mut().insert(peer());
    let response = app.app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

/// A request with a bearer (staff or a cabinet login).
async fn with_login(
    app: &PayerApp,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let (status, _, body) = call(app, request).await;
    (status, body)
}

/// A request of the payer: token and session in their headers, never in
/// the URL.
async fn as_payer(
    app: &PayerApp,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("Content-Type", "application/json");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let request = request
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let (status, _, body) = call(app, request).await;
    (status, body)
}

async fn payer_upload(
    app: &PayerApp,
    path: &str,
    token: &str,
    session: &str,
    file_name: &str,
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: application/pdf\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(PDF);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("X-Payer-Link", token)
        .header("X-Payer-Session", session)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let (status, _, body) = call(app, request).await;
    (status, body)
}

fn viktor() -> Value {
    json!({
        "payer_kind": "third_party",
        "payer_type": "person",
        "first_name": "Viktor",
        "last_name": "Zahler",
        "date_of_birth": "1970-05-01",
        "citizenships": ["AT"],
        "relationship_kind": "friend",
        "email": "viktor.zahler@example.com",
        "contact_consent": true
    })
}

/// A lead whose request was sent, with its own login; returns the lead and
/// the login's bearer.
async fn lead(app: &PayerApp, tag: &str) -> (Uuid, String) {
    let (status, created) = with_login(
        app,
        "POST",
        "/api/v1/leads",
        &app.manager(),
        Some(json!({
            "first_name": "Mia",
            "last_name": "Muster",
            "email": format!("mia.{tag}.{}@example.com", Uuid::new_v4().simple()),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let user_id: Uuid = created["portal_account"]["user_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    (lead_id, bearer(user_id, "patient"))
}

async fn submit_request(app: &PayerApp, lead_id: Uuid) {
    sqlx::query("UPDATE leads SET portal_submitted_at = now() WHERE id = $1")
        .bind(lead_id)
        .execute(app.pool())
        .await
        .unwrap();
}

async fn name_payer(app: &PayerApp, lead_id: Uuid, patient: &str, payer: Value) {
    let (status, body) = with_login(
        app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/payer"),
        patient,
        Some(payer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

/// A sent request whose third party is Viktor Zahler.
async fn lead_with_payer(app: &PayerApp, tag: &str) -> (Uuid, String) {
    let (lead_id, patient) = lead(app, tag).await;
    name_payer(app, lead_id, &patient, viktor()).await;
    submit_request(app, lead_id).await;
    (lead_id, patient)
}

async fn send_link(app: &PayerApp, lead_id: Uuid, body: Value) -> (String, Value) {
    let (status, sent) = with_login(
        app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-link"),
        &app.manager(),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    (app.last_token(), sent)
}

/// Code and verification: the session secret.
async fn open_session(app: &PayerApp, token: &str) -> String {
    let (status, body) = as_payer(app, "POST", CODE, &[("X-Payer-Link", token)], None).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let code = app.last_code();
    let (status, verified) = as_payer(
        app,
        "POST",
        VERIFY,
        &[("X-Payer-Link", token)],
        Some(json!({ "code": code })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{verified}");
    verified["session"].as_str().unwrap().to_string()
}

async fn consent(app: &PayerApp, token: &str, session: &str) {
    let (status, body) = as_payer(
        app,
        "POST",
        CONSENT,
        &[("X-Payer-Link", token), ("X-Payer-Session", session)],
        Some(json!({ "acknowledged": true, "contact_channels": ["email"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn patch(app: &PayerApp, token: &str, session: &str, body: Value) -> (StatusCode, Value) {
    as_payer(
        app,
        "POST",
        QUESTIONNAIRE,
        &[("X-Payer-Link", token), ("X-Payer-Session", session)],
        Some(body),
    )
    .await
}

/// Everything a person states for the submit except the files. The link
/// prefills what the lead entered about the payer (owner 2026-10-10); what
/// the payer states here replaces it.
fn person_answers() -> Value {
    json!({
        "salutation": "mr",
        "date_of_birth": "1970-05-01",
        "citizenships": ["AT"],
        "birth_place": "Graz",
        "birth_country": "AT",
        "street": "Ringstraße 9",
        "zip": "1010",
        "city": "Wien",
        "country": "AT",
        "habitual_residence_country": "AT",
        "id_document_type": "passport",
        "id_document_number": "P1234567",
        "id_issuing_authority": "BH Wien",
        "id_issuing_country": "AT",
        "id_valid_until": "2099-12-31",
        "relationship_kind": "other",
        "relationship": "Onkel",
        "occupation": "Kaufmann",
        "funds_sources": ["savings"],
        "pep_self": false,
        "pep_related": false,
        "high_risk_country": false,
        "sanctions_links": false,
        "payment_method": "bank_transfer",
        "account_country": "AT",
        "account_holder": "Viktor Zahler",
        "bank_name": "Beispielbank",
        "via_third_party": false
    })
}

async fn active_links(pool: &PgPool, lead_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM lead_payer_links WHERE lead_id = $1 AND revoked_at IS NULL",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn audit_contexts(pool: &PgPool, action: &str, lead_id: Uuid) -> Vec<(Option<Uuid>, Value)> {
    sqlx::query_as(
        r#"SELECT user_id, context FROM audit_log
           WHERE action = $1 AND (entity_id = $2 OR context->>'lead_id' = $2::text)
           ORDER BY created_at"#,
    )
    .bind(action)
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn staff_send_the_link_only_through_the_gate_and_resend_or_revoke_it() {
    let Some(app) = payer_app().await else { return };
    let pool = app.pool();
    let (lead_id, patient) = lead(&app, "gate").await;
    let path = format!("/api/v1/leads/{lead_id}/payer-link");

    // Nobody named yet, nothing sent.
    let (status, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert!(info["mode"].is_null(), "{info}");
    assert_eq!(info["blocked_reason"], "request_not_submitted", "{info}");
    assert_eq!(info["can_send"], false);
    assert_eq!(info["mail_available"], true);
    assert!(info["link"].is_null());
    assert!(info["questionnaire"].is_null());
    // No amount asks for the proof of funds any more (owner rule 2026-10-07).
    assert!(info.get("funds_proof_threshold_eur").is_none(), "{info}");
    let (status, refused) = with_login(&app, "POST", &path, &app.manager(), Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "request_not_submitted");

    // The gate, reason by reason.
    submit_request(&app, lead_id).await;
    name_payer(
        &app,
        lead_id,
        &patient,
        json!({ "payer_kind": "self", "acts_on_own_account": true }),
    )
    .await;
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["blocked_reason"], "no_third_party", "{info}");
    let mut without_consent = viktor();
    without_consent["contact_consent"] = json!(false);
    name_payer(&app, lead_id, &patient, without_consent).await;
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["mode"], "link", "{info}");
    assert_eq!(info["blocked_reason"], "contact_consent_missing", "{info}");
    let mut without_email = viktor();
    without_email["email"] = Value::Null;
    name_payer(&app, lead_id, &patient, without_email).await;
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["blocked_reason"], "payer_email_missing", "{info}");
    name_payer(&app, lead_id, &patient, viktor()).await;
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert!(info["blocked_reason"].is_null(), "{info}");
    assert_eq!(info["can_send"], true, "{info}");

    // Who may: everybody who works leads reads and sends; the CEO Assistant
    // only reads; Billing and the concierge neither.
    for role in ["billing", "concierge"] {
        let (status, _) = with_login(&app, "GET", &path, &app.staff(role), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role}");
    }
    let (status, assistant) =
        with_login(&app, "GET", &path, &app.staff("ceo_assistant"), None).await;
    assert_eq!(status, StatusCode::OK, "{assistant}");
    assert_eq!(assistant["can_send"], false, "{assistant}");
    for write in [
        path.clone(),
        format!("{path}/revoke"),
        format!("{path}/estimated-total"),
    ] {
        let (status, _) = with_login(
            &app,
            "POST",
            &write,
            &app.staff("ceo_assistant"),
            Some(json!({ "estimated_total_eur": null })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{write}");
    }
    let (status, _) = with_login(&app, "GET", &path, &app.staff("sales"), None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{}/payer-link", Uuid::new_v4()),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, refused) = with_login(
        &app,
        "POST",
        &path,
        &app.manager(),
        Some(json!({ "language": "fr" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["field"], "language");

    // Sent in English: the invitation names the patient, carries the link
    // with the token in the fragment and the privacy notice, and records
    // that the payer was informed.
    let (token, sent) = send_link(&app, lead_id, json!({ "language": "en" })).await;
    assert_eq!(sent["link"]["status"], "sent", "{sent}");
    assert_eq!(sent["link"]["email"], "viktor.zahler@example.com");
    assert_eq!(sent["link"]["language"], "en");
    assert_eq!(sent["link"]["last_email_status"], "sent");
    assert_eq!(sent["link"]["sent_by_name"], "patient_manager payer link");
    assert!(sent["link"]["expires_at"].is_string());
    {
        let received = app.fake.received.lock().unwrap();
        let invitation = received.last().unwrap();
        assert_eq!(invitation["to"], "viktor.zahler@example.com");
        assert_eq!(
            invitation["subject"],
            "Details for the cost coverage – GMED"
        );
        let text = invitation["text"].as_str().unwrap();
        assert!(text.contains("Mia Muster"), "{text}");
        assert!(text.contains(&format!("https://console.gmed-health.test/payer#{token}")));
        assert!(text.contains("https://console.gmed-health.test/legal#privacy"));
    }
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.manager(),
        None,
    )
    .await;
    assert!(
        declaration["declaration"]["payer_informed_at"].is_string(),
        "{declaration}"
    );
    // The token is in no audit row and no log table.
    let audited: Vec<String> = sqlx::query_scalar(
        "SELECT context::text FROM audit_log WHERE action LIKE 'payer_link%' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(!audited.is_empty());
    assert!(audited.iter().all(|context| !context.contains(&token)));
    let stored: (String, i64) = sqlx::query_as(
        r#"SELECT token_hash,
                  (SELECT count(*) FROM lead_payer_link_emails e WHERE e.lead_id = $1)
           FROM lead_payer_links WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_ne!(stored.0, token, "only the hash is stored");
    assert_eq!(stored.0, gmed_server::auth::tokens::hash_token(&token));
    assert_eq!(stored.1, 1);

    // The payer opens it: the patient's name and the masked address only.
    let (status, opened) =
        as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::OK, "{opened}");
    assert_eq!(opened["state"], "code_required");
    assert_eq!(opened["patient_name"], "Mia Muster");
    assert_eq!(opened["payer_type"], "person");
    assert_eq!(opened["email_masked"], "v***r@example.com");
    assert_eq!(opened["language"], "en");
    assert_eq!(opened["session_valid"], false);
    assert!(opened["code_sent_at"].is_null());
    assert!(!opened.to_string().contains(&lead_id.to_string()));
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["link"]["status"], "opened", "{info}");

    // The token never works in the URL; a wrong or missing one is unknown.
    let (status, _) = as_payer(&app, "GET", &format!("{OPEN}/{token}"), &[], None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = as_payer(
        &app,
        "GET",
        &format!("{OPEN}?token={token}"),
        &[("X-Payer-Link", token.as_str())],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for headers in [vec![], vec![("X-Payer-Link", "not-a-token")]] {
        let (status, body) = as_payer(&app, "GET", OPEN, &headers, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
        assert_eq!(body["code"], "link_invalid");
    }
    let unknown = "ab".repeat(32);
    let (status, body) = as_payer(
        &app,
        "GET",
        OPEN,
        &[("X-Payer-Link", unknown.as_str())],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");

    // A resend revokes the first link.
    let (second, resent) = send_link(&app, lead_id, json!({ "language": "de" })).await;
    assert_ne!(second, token);
    assert_eq!(resent["link"]["language"], "de", "{resent}");
    assert_eq!(active_links(pool, lead_id).await, 1);
    let (status, body) =
        as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::GONE, "{body}");
    assert_eq!(body["code"], "link_revoked");
    let reasons: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT revoked_reason FROM lead_payer_links WHERE lead_id = $1 ORDER BY created_at",
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(reasons, [Some("resent".to_string()), None]);
    let (status, _) = as_payer(
        &app,
        "GET",
        OPEN,
        &[("X-Payer-Link", second.as_str())],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Staff revoke it.
    let (status, revoked) = with_login(
        &app,
        "POST",
        &format!("{path}/revoke"),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{revoked}");
    assert_eq!(revoked["link"]["status"], "revoked");
    assert_eq!(revoked["link"]["revoked_reason"], "staff_revoked");
    let (status, _) = as_payer(
        &app,
        "GET",
        OPEN,
        &[("X-Payer-Link", second.as_str())],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::GONE);

    // A failed invitation leaves no live link.
    app.fake.fail.store(true, Ordering::SeqCst);
    let (status, failed) = with_login(&app, "POST", &path, &app.manager(), Some(json!({}))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{failed}");
    assert_eq!(failed["code"], "mail_unavailable");
    app.fake.fail.store(false, Ordering::SeqCst);
    assert_eq!(active_links(pool, lead_id).await, 0);
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["link"]["status"], "revoked", "{info}");
    assert_eq!(info["link"]["revoked_reason"], "email_failed");
    assert_eq!(info["link"]["last_email_status"], "failed");
    assert_eq!(
        audit_contexts(pool, "payer_link_send_failed", lead_id)
            .await
            .len(),
        1
    );

    // An expired link.
    let (third, _) = send_link(&app, lead_id, json!({})).await;
    sqlx::query(
        "UPDATE lead_payer_links SET expires_at = now() - interval '1 minute' WHERE lead_id = $1 AND revoked_at IS NULL",
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, body) =
        as_payer(&app, "GET", OPEN, &[("X-Payer-Link", third.as_str())], None).await;
    assert_eq!(status, StatusCode::GONE, "{body}");
    assert_eq!(body["code"], "link_expired");
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["link"]["status"], "expired", "{info}");
}

#[tokio::test]
async fn the_code_yields_a_session_and_wrong_codes_lock_the_link() {
    let Some(app) = payer_app().await else { return };
    let pool = app.pool();
    let (lead_id, _) = lead_with_payer(&app, "code").await;
    let path = format!("/api/v1/leads/{lead_id}/payer-link");
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    let link = [("X-Payer-Link", token.as_str())];

    // No code yet.
    let (status, body) = as_payer(
        &app,
        "POST",
        VERIFY,
        &link,
        Some(json!({ "code": "123456" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "code_expired");
    assert_eq!(body["reason"], "expired", "{body}");

    let (status, sent) = as_payer(&app, "POST", CODE, &link, None).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{sent}");
    assert_eq!(sent["resend_after_seconds"], 60);
    assert!(sent["sent_at"].is_string());
    let code = app.last_code();
    {
        let received = app.fake.received.lock().unwrap();
        let message = received.last().unwrap();
        assert_eq!(message["subject"], "Ihr Bestätigungscode – GMED");
        assert_eq!(message["to"], "viktor.zahler@example.com");
    }
    let (status, limited) = as_payer(&app, "POST", CODE, &link, None).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{limited}");
    assert_eq!(limited["code"], "code_rate_limited");
    assert!(limited["retry_after_seconds"].as_i64().unwrap() > 0);
    let (_, opened) = as_payer(&app, "GET", OPEN, &link, None).await;
    assert!(opened["code_sent_at"].is_string(), "{opened}");

    // Five wrong tries void the code.
    let wrong = if code == "000000" { "111111" } else { "000000" };
    for left in [4, 3, 2, 1] {
        let (status, body) =
            as_payer(&app, "POST", VERIFY, &link, Some(json!({ "code": wrong }))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "code_invalid");
        assert_eq!(body["attempts_left"], left);
    }
    let (status, body) =
        as_payer(&app, "POST", VERIFY, &link, Some(json!({ "code": wrong }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "code_expired");
    assert_eq!(body["reason"], "too_many_attempts", "{body}");
    let (_, body) = as_payer(&app, "POST", VERIFY, &link, Some(json!({ "code": code }))).await;
    assert_eq!(body["code"], "code_expired", "the right code is void too");
    assert_eq!(body["reason"], "too_many_attempts", "{body}");

    // A new code; five more wrong tries make ten and lock the link.
    sqlx::query(
        "UPDATE lead_payer_links SET code_sent_at = now() - interval '2 minutes' WHERE lead_id = $1",
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, _) = as_payer(&app, "POST", CODE, &link, None).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let code = app.last_code();
    let wrong = if code == "000000" { "111111" } else { "000000" };
    for _ in 0..4 {
        let (status, _) =
            as_payer(&app, "POST", VERIFY, &link, Some(json!({ "code": wrong }))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
    let (status, body) =
        as_payer(&app, "POST", VERIFY, &link, Some(json!({ "code": wrong }))).await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");
    assert_eq!(body["code"], "link_locked");
    let (status, _) = as_payer(&app, "GET", OPEN, &link, None).await;
    assert_eq!(status, StatusCode::LOCKED);
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["link"]["status"], "locked", "{info}");
    let locked = audit_contexts(pool, "payer_link_locked", lead_id).await;
    assert_eq!(locked.len(), 1);
    assert_eq!(locked[0].0, None, "the payer has no login");

    // A new link: the right code yields the session.
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    let link = [("X-Payer-Link", token.as_str())];
    let (status, _) = as_payer(&app, "POST", CODE, &link, None).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let code = app.last_code();
    let (status, verified) =
        as_payer(&app, "POST", VERIFY, &link, Some(json!({ "code": code }))).await;
    assert_eq!(status, StatusCode::OK, "{verified}");
    let session = verified["session"].as_str().unwrap().to_string();
    assert_eq!(session.len(), 64);
    assert!(verified["session_expires_at"].is_string());
    let questionnaire = &verified["questionnaire"];
    assert_eq!(questionnaire["state"], "draft", "{verified}");
    assert_eq!(questionnaire["source"], "link");
    assert_eq!(questionnaire["patient_name"], "Mia Muster");
    assert_eq!(questionnaire["email"], "viktor.zahler@example.com");
    assert!(questionnaire["email_confirmed_at"].is_string());
    assert!(questionnaire["privacy"]["acknowledged_at"].is_null());
    assert_eq!(
        questionnaire["privacy"]["text_version"],
        "payer-privacy-2026-10-06"
    );
    assert_eq!(questionnaire["answers"]["first_name"], "Viktor");
    assert!(questionnaire["answers"]["organisation_name"].is_null());
    // A person chooses from the declaration's sources of funds.
    assert_eq!(
        questionnaire["funds_source_options"],
        json!([
            "employment",
            "business_income",
            "savings",
            "asset_sale",
            "inheritance_gift",
            "other"
        ]),
        "{verified}"
    );
    assert_eq!(questionnaire["payment_route"]["asked"], true);
    assert_eq!(
        questionnaire["payment_route"]["account_holder_suggestion"],
        "Viktor Zahler"
    );
    assert_eq!(questionnaire["missing_for_submit"][0], "privacy_ack");
    for hidden in [
        "check_level",
        "check_reasons",
        "estimated_total_eur",
        "lead_id",
    ] {
        assert!(!questionnaire.to_string().contains(hidden), "{hidden}");
    }
    // The code is used up.
    let (_, body) = as_payer(&app, "POST", VERIFY, &link, Some(json!({ "code": code }))).await;
    assert_eq!(body["code"], "code_expired");
    assert_eq!(body["reason"], "expired", "{body}");

    let with_session = [
        ("X-Payer-Link", token.as_str()),
        ("X-Payer-Session", session.as_str()),
    ];
    let (_, opened) = as_payer(&app, "GET", OPEN, &with_session, None).await;
    assert_eq!(opened["state"], "active", "{opened}");
    assert_eq!(opened["session_valid"], true);
    let (status, body) = as_payer(&app, "GET", QUESTIONNAIRE, &link, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], "session_required");
    let other = "cd".repeat(32);
    let (status, body) = as_payer(
        &app,
        "GET",
        QUESTIONNAIRE,
        &[
            ("X-Payer-Link", token.as_str()),
            ("X-Payer-Session", other.as_str()),
        ],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], "session_expired");
    let (status, _) = as_payer(&app, "GET", QUESTIONNAIRE, &with_session, None).await;
    assert_eq!(status, StatusCode::OK);
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["link"]["status"], "verified", "{info}");

    // Five codes an hour at most.
    sqlx::query(
        r#"INSERT INTO lead_payer_link_emails
               (lead_id, link_id, kind, recipient, language, status, provider_message_id)
           SELECT lead_id, id, 'code', email, 'de', 'sent', 'email_seeded'
           FROM lead_payer_links, generate_series(1, 4)
           WHERE lead_id = $1 AND revoked_at IS NULL"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE lead_payer_links SET code_sent_at = now() - interval '2 minutes' WHERE lead_id = $1",
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, body) = as_payer(&app, "POST", CODE, &link, None).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");

    // The session ends after an hour without a call.
    sqlx::query(
        "UPDATE lead_payer_links SET session_expires_at = now() - interval '1 minute' WHERE lead_id = $1",
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, body) = as_payer(&app, "GET", QUESTIONNAIRE, &with_session, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    assert_eq!(body["code"], "session_expired");
}

#[tokio::test]
async fn the_payer_answers_uploads_and_submits_and_the_identity_is_adopted() {
    let Some(app) = payer_app().await else { return };
    let pool = app.pool();
    let (lead_id, patient) = lead_with_payer(&app, "submit").await;
    let path = format!("/api/v1/leads/{lead_id}/payer-link");
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    let session = open_session(&app, &token).await;
    let headers = [
        ("X-Payer-Link", token.as_str()),
        ("X-Payer-Session", session.as_str()),
    ];

    // Nothing is writable before the privacy notice is acknowledged.
    let (status, body) = patch(&app, &token, &session, json!({ "occupation": "Kaufmann" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "payer_consent_required");
    let (status, body) = payer_upload(&app, IDENTITY, &token, &session, "pass.pdf").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = as_payer(
        &app,
        "POST",
        CONSENT,
        &headers,
        Some(json!({ "acknowledged": false })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["field"], "acknowledged");
    let (status, body) = as_payer(
        &app,
        "POST",
        CONSENT,
        &[
            ("X-Payer-Link", token.as_str()),
            ("X-Payer-Session", session.as_str()),
            ("X-Forwarded-For", "203.0.113.7"),
        ],
        Some(json!({ "acknowledged": true, "contact_channels": ["phone", "email", "phone"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["privacy"]["acknowledged_at"].is_string());
    assert_eq!(
        body["privacy"]["contact_channels"],
        json!(["email", "phone"])
    );
    assert!(body["privacy"].get("ip").is_none(), "the payer sees no IP");
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(
        info["questionnaire"]["privacy"]["ip"], "203.0.113.7",
        "{info}"
    );
    assert_eq!(info["questionnaire"]["check_level"], 1);

    // Validation per key and per payer type.
    for (body, field, code) in [
        (json!({ "nickname": "Vik" }), "nickname", "invalid_field"),
        (
            json!({ "organisation_name": "Beispiel GmbH" }),
            "organisation_name",
            "invalid_field",
        ),
        (
            json!({ "beneficial_owners": [] }),
            "beneficial_owners",
            "invalid_field",
        ),
        (
            json!({ "invoice_to": "payer" }),
            "invoice_to",
            "invalid_field",
        ),
        (json!({ "country": "Austria" }), "country", "invalid_field"),
        (
            json!({ "payment_method": "cheque" }),
            "payment_method",
            "invalid_field",
        ),
        (json!({ "pep_self": "no" }), "pep_self", "invalid_field"),
        (
            json!({ "id_valid_until": "2020-01-01" }),
            "id_valid_until",
            "id_document_expired",
        ),
    ] {
        let (status, refused) = patch(&app, &token, &session, body).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert_eq!(refused["code"], code, "{refused}");
        assert_eq!(refused["field"], field, "{refused}");
    }

    // The answers, with section 8 on the declaration; the server clears what
    // does not apply.
    let (status, body) = patch(&app, &token, &session, person_answers()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["answers"]["habitual_residence_country"].is_null(),
        "equal to the residence: {body}"
    );
    assert_eq!(body["answers"]["relationship"], "Onkel");
    assert_eq!(body["payment_route"]["payment_method"], "bank_transfer");
    assert_eq!(
        body["missing_for_submit"],
        json!(["id_document_upload"]),
        "{body}"
    );
    let updates = audit_contexts(pool, "payer_questionnaire_update", lead_id).await;
    assert_eq!(updates.len(), 1);
    let (user, context) = &updates[0];
    assert!(user.is_none());
    assert!(
        context["fields"]
            .as_array()
            .unwrap()
            .contains(&json!("payment_method"))
    );
    assert!(!context.to_string().contains("Graz"), "{context}");
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(
        declaration["declaration"]["payment_method"],
        "bank_transfer"
    );
    assert!(
        declaration["declaration"]["place_of_birth"].is_null(),
        "the declaration waits for the submit: {declaration}"
    );
    // The same values again change nothing.
    let (status, _) = patch(&app, &token, &session, json!({ "occupation": "Kaufmann" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        audit_contexts(pool, "payer_questionnaire_update", lead_id)
            .await
            .len(),
        1
    );

    // The identity document; staff's expected total is information only, a
    // second citizenship on the black list asks for the proof of funds (the
    // enhanced check of the owner's rule 2026-10-07: check level 2).
    let (status, body) = payer_upload(&app, IDENTITY, &token, &session, "pass.pdf").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["identity_documents"][0]["can_delete"], true);
    assert_eq!(body["missing_for_submit"], json!([]), "{body}");
    let identity_document = body["identity_documents"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{path}/estimated-total"),
        &app.manager(),
        Some(json!({ "estimated_total_eur": "12000.123" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    let (status, estimated) = with_login(
        &app,
        "POST",
        &format!("{path}/estimated-total"),
        &app.manager(),
        Some(json!({ "estimated_total_eur": "12000" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{estimated}");
    assert_eq!(estimated["estimated_total_eur"], "12000.00");
    // Since the trigger flow (2026-10-07) the lead's value counts: a friend
    // (T4 + T5) paying more than 10 000 EUR (T10) is level 2 of the risk
    // assessment, which requires the enhanced check and the proof of funds.
    assert_eq!(estimated["questionnaire"]["check_level"], 2, "{estimated}");
    assert_eq!(
        estimated["questionnaire"]["check_reasons"],
        json!(["risk_assessment"])
    );
    assert_eq!(estimated["questionnaire"]["funds_proof_required"], true);
    // A public office of the payer (a knock-out) keeps it so.
    let (status, body) = patch(
        &app,
        &token,
        &session,
        json!({
            "citizenships": ["AT", "RU"],
            "pep_self": true,
            "pep_self_details": "Gemeinderat 2015–2020"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["funds_proof_required"], true, "{body}");
    assert_eq!(
        body["missing_for_submit"],
        json!(["funds_proof_upload"]),
        "{body}"
    );
    let (status, body) = patch(
        &app,
        &token,
        &session,
        json!({ "citizenships": ["AT", "IR"], "pep_self": false }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, staff) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(staff["questionnaire"]["check_level"], 2, "{staff}");
    assert_eq!(
        staff["questionnaire"]["check_reasons"],
        json!(["payer_citizenship_blacklist"])
    );
    let (_, body) = as_payer(&app, "GET", QUESTIONNAIRE, &headers, None).await;
    assert_eq!(body["funds_proof_required"], true, "{body}");
    assert_eq!(body["missing_for_submit"], json!(["funds_proof_upload"]));
    // The payer never sees the estimate or why the proof is asked for.
    assert!(body.get("estimated_total_eur").is_none(), "{body}");
    assert!(body.get("check_reasons").is_none(), "{body}");
    assert!(!body.to_string().contains("blacklist"), "{body}");
    let (status, body) = as_payer(
        &app,
        "POST",
        SUBMIT,
        &headers,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "questionnaire_incomplete");
    assert_eq!(body["missing"], json!(["funds_proof_upload"]));

    // A proof, withdrawn and uploaded again.
    let (status, body) = payer_upload(&app, FUNDS, &token, &session, "konto.pdf").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let first_proof = body["funds_proof_documents"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (status, body) = as_payer(
        &app,
        "DELETE",
        &format!("/api/v1/public/payer-link/documents/{first_proof}"),
        &headers,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["funds_proof_documents"], json!([]));
    let (status, _) = as_payer(
        &app,
        "DELETE",
        &format!("/api/v1/public/payer-link/documents/{}", Uuid::new_v4()),
        &headers,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, body) = payer_upload(&app, FUNDS, &token, &session, "konto.pdf").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let proof: Uuid = body["funds_proof_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    // The payer's files: no uploader, not the lead's, invisible to the lead.
    let rows: Vec<(Option<Uuid>, String, Option<Uuid>)> = sqlx::query_as(
        r#"SELECT uploaded_by, access_kind, payer_link_id FROM lead_portal_uploads
           WHERE lead_id = $1 AND withdrawn_at IS NULL ORDER BY created_at"#,
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert!(
        rows.iter()
            .all(|(by, kind, link)| by.is_none() && kind == "payer" && link.is_some())
    );
    let (status, request) = with_login(
        &app,
        "GET",
        &format!("/api/v1/me/lead-requests/{lead_id}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{request}");
    assert_eq!(request["documents"], json!([]));
    assert_eq!(request["identity_documents"], json!([]));
    assert!(!request.to_string().contains(&identity_document));
    assert!(request["billing"]["payment_method"].is_null(), "{request}");
    assert!(request["payer_questionnaire"].is_null());
    let (status, intake) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["identity_documents"], json!([]), "{intake}");
    assert_eq!(intake["payer_link"]["mode"], "link", "{intake}");
    assert_eq!(intake["payer_link"]["status"], "verified");
    assert_eq!(intake["payer_link"]["check_level"], 2);
    let (status, _) = with_login(
        &app,
        "DELETE",
        &format!("/api/v1/me/lead-requests/{lead_id}/documents/{proof}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "the lead cannot remove it");

    // Submit: the confirmation first, then the adoption.
    let (status, body) = as_payer(&app, "POST", SUBMIT, &headers, Some(json!({}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "declaration_required");
    let (status, body) = as_payer(
        &app,
        "POST",
        SUBMIT,
        &headers,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["state"], "submitted");
    assert!(body["submitted_at"].is_string());
    assert!(body["declared_correct_at"].is_string());
    assert_eq!(body["identity_documents"][0]["can_delete"], false);
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.manager(),
        None,
    )
    .await;
    let adopted = &declaration["declaration"];
    assert_eq!(adopted["place_of_birth"], "Graz", "{declaration}");
    assert_eq!(adopted["street"], "Ringstraße 9");
    assert_eq!(adopted["country"], "AT");
    assert_eq!(adopted["relationship_kind"], "other");
    assert_eq!(adopted["relationship"], "Onkel");
    assert_eq!(adopted["source_of_funds"], "savings");
    assert_eq!(adopted["source_of_funds_document_id"], proof.to_string());
    assert_eq!(adopted["email"], "viktor.zahler@example.com");
    assert_eq!(
        adopted["payment_method"], "bank_transfer",
        "section 8 stays"
    );
    assert!(adopted["identity_adopted_at"].is_string(), "{declaration}");
    let keys: (Value, Value, Value, Option<Value>) = sqlx::query_as(
        r#"SELECT k.payer_key, s.payer_key,
                  jsonb_build_array(d.payer_type, d.organisation_name, d.first_name,
                                    d.last_name, d.date_of_birth),
                  d.identity_adopted_key
           FROM lead_payer_links k
           JOIN lead_payer_statements s ON s.lead_id = k.lead_id
           JOIN lead_payer_declarations d ON d.lead_id = k.lead_id
           WHERE k.lead_id = $1 AND k.revoked_at IS NULL"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(keys.0, keys.2);
    assert_eq!(keys.1, keys.2);
    assert_eq!(keys.3.as_ref(), Some(&keys.2), "the adopted payer key");
    let submitted = audit_contexts(pool, "payer_questionnaire_submitted", lead_id).await;
    assert_eq!(submitted[0].1["check_level"], 2);
    assert_eq!(
        audit_contexts(pool, "payer_link_adopt_payer_declaration", lead_id)
            .await
            .len(),
        1
    );
    let notifications: Vec<(String, String)> = sqlx::query_as(
        "SELECT title, body FROM user_notifications WHERE kind = 'lead_payer_submitted' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(!notifications.is_empty());
    assert!(
        notifications
            .iter()
            .all(|(title, body)| !title.contains("Zahler") && !body.contains("Viktor"))
    );
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["link"]["status"], "submitted", "{info}");
    assert!(info["questionnaire"]["adopted_at"].is_string());

    // The old token still opens, read-only. No signature package yet (phase
    // 3b): the key is there and empty.
    let (status, opened) = as_payer(&app, "GET", OPEN, &headers, None).await;
    assert_eq!(status, StatusCode::OK, "{opened}");
    assert_eq!(opened["state"], "submitted");
    assert!(
        opened
            .get("signature_package")
            .is_some_and(serde_json::Value::is_null),
        "{opened}"
    );
    let (status, body) = patch(&app, &token, &session, json!({ "occupation": "Händler" })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payer_submitted");
    let (status, _) = as_payer(
        &app,
        "DELETE",
        &format!("/api/v1/public/payer-link/documents/{proof}"),
        &headers,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The lead's cabinet (QA 2026-10-06): the payer's own answers are not
    // shown — name, type, relationship and the consent only — and the lead
    // no longer changes the payer; the missing list stays as it was.
    let request_path = format!("/api/v1/me/lead-requests/{lead_id}");
    let (_, before) = with_login(&app, "GET", &request_path, &patient, None).await;
    let shown = &before["payer"];
    assert_eq!(shown["answered_by_payer"], true, "{before}");
    assert_eq!(shown["payer_kind"], "third_party");
    assert_eq!(shown["payer_type"], "person");
    assert_eq!(shown["first_name"], "Viktor");
    assert_eq!(shown["last_name"], "Zahler");
    assert_eq!(shown["relationship_kind"], "other");
    assert_eq!(shown["relationship"], "Onkel");
    assert!(shown["contact_consent_at"].is_string(), "{before}");
    for hidden in [
        "date_of_birth",
        "street",
        "zip",
        "city",
        "country",
        "citizenships",
        "email",
        "phone",
    ] {
        assert!(shown[hidden].is_null(), "{hidden}: {before}");
    }
    for value in [
        "1970-05-01",
        "Ringstraße",
        "Graz",
        "viktor.zahler@example.com",
    ] {
        assert!(!before.to_string().contains(value), "{value}: {before}");
    }
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{request_path}/payer"),
        &patient,
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "street": "Zahlerstraße 7",
            "citizenships": ["AT"],
            "relationship_kind": "other",
            "relationship": "Onkel",
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_answered_by_payer");
    let (_, after) = with_login(&app, "GET", &request_path, &patient, None).await;
    assert_eq!(
        after["progress"]["missing_for_submit"], before["progress"]["missing_for_submit"],
        "{after}"
    );
    // The consent to pass the cost estimate on to the payer stays the
    // patient's own (phase 3b): given also while the payer's identity is the
    // payer's answer, and it reveals nothing of that identity.
    assert!(
        after["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("payer_cost_estimate_consent")),
        "{after}"
    );
    let (status, consented) = with_login(
        &app,
        "POST",
        &format!("{request_path}/payer/cost-estimate-consent"),
        &patient,
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{consented}");
    assert_eq!(consented["payer"]["answered_by_payer"], true, "{consented}");
    assert!(
        consented["payer"]["cost_estimate_consent_at"].is_string(),
        "{consented}"
    );
    assert!(consented["payer"]["street"].is_null(), "{consented}");
    assert!(
        !consented["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("payer_cost_estimate_consent")),
        "{consented}"
    );
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(
        declaration["declaration"]["street"], "Ringstraße 9",
        "nothing saved: {declaration}"
    );
    assert_eq!(active_links(pool, lead_id).await, 1);
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["link"]["status"], "submitted", "{info}");

    // The payer's public office was a knock-out (level 3 of the risk
    // assessment, trigger flow 2026-10-07): the link waits for staff until
    // they ask for the payer's answers again (block D).
    let (status, held) = with_login(&app, "POST", &path, &app.manager(), Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{held}");
    assert_eq!(held["code"], "risk_review_required", "{held}");
    // The panel says so before staff press "send" (QA 2026-10-10).
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert_eq!(info["risk_hold"], "review", "{info}");
    let (status, requested) = with_login(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/risk-assessment/decisions"),
        &app.staff("ceo"),
        Some(json!({
            "decision": "request_more",
            "reason": "The payer states the public office",
            "blocks": ["D"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{requested}");
    let (_, info) = with_login(&app, "GET", &path, &app.manager(), None).await;
    assert!(info["risk_hold"].is_null(), "block D requested: {info}");
    // A resend needs "reopen", which keeps the answers; the payer corrects
    // them, so the lead still sees nothing of them.
    let (status, refused) = with_login(&app, "POST", &path, &app.manager(), Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_already_submitted");
    let (_, reopened) = send_link(&app, lead_id, json!({ "reopen": true })).await;
    assert!(
        reopened["questionnaire"]["submitted_at"].is_null(),
        "{reopened}"
    );
    assert_eq!(
        reopened["questionnaire"]["answers"]["occupation"],
        "Kaufmann"
    );
    let (_, request) = with_login(&app, "GET", &request_path, &patient, None).await;
    assert_eq!(request["payer"]["answered_by_payer"], true, "{request}");
    assert!(request["payer"]["street"].is_null(), "{request}");
}

#[tokio::test]
async fn an_organisation_states_its_representative_and_beneficial_owners() {
    let Some(app) = payer_app().await else { return };
    let (lead_id, patient) = lead(&app, "company").await;
    name_payer(
        &app,
        lead_id,
        &patient,
        json!({
            "payer_kind": "third_party",
            "payer_type": "company",
            "organisation_name": "Beispiel GmbH",
            "country": "DE",
            "relationship_kind": "employer",
            "email": "kasse@example.com",
            "contact_consent": true
        }),
    )
    .await;
    submit_request(&app, lead_id).await;
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    // The invitation greets the company neutrally and names "your
    // organisation" as the paying party (QA 2026-10-06, C7-b).
    let invitation = app
        .texts()
        .into_iter()
        .rev()
        .find(|text| text.contains("/payer#"))
        .expect("an invitation");
    assert!(invitation.starts_with("Guten Tag,\n"), "{invitation}");
    assert!(
        invitation.contains("hat Ihre Organisation als zahlende Partei"),
        "{invitation}"
    );
    assert!(!invitation.contains("Beispiel GmbH"), "{invitation}");
    let (_, opened) = as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(opened["payer_type"], "company");
    let session = open_session(&app, &token).await;
    consent(&app, &token, &session).await;
    let (status, body) = patch(&app, &token, &session, json!({ "first_name": "Viktor" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["field"], "first_name");
    // An organisation chooses from its own sources of funds; a person's
    // source is refused.
    let (status, body) = patch(
        &app,
        &token,
        &session,
        json!({ "funds_sources": ["employment"] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "invalid_field", "{body}");
    assert_eq!(body["field"], "funds_sources", "{body}");
    let (status, body) = patch(
        &app,
        &token,
        &session,
        json!({ "funds_sources": ["loan", "business_revenue"] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["answers"]["funds_sources"],
        json!(["business_revenue", "loan"]),
        "{body}"
    );
    assert_eq!(
        body["funds_source_options"],
        json!([
            "business_revenue",
            "equity",
            "loan",
            "insurance_benefit",
            "donation",
            "other"
        ]),
        "{body}"
    );
    let owner = |first: &str, share: Value| {
        json!({ "first_name": first, "last_name": "Muster", "date_of_birth": "1980-02-03",
                "country": "de", "share_percent": share })
    };
    for owners in [
        json!([owner("Anna", json!(60)), owner("Ben", json!(41))]),
        json!([owner("Anna", json!(0))]),
        json!([{ "first_name": "Anna", "share_percent": 30 }]),
    ] {
        let (status, body) = patch(
            &app,
            &token,
            &session,
            json!({ "beneficial_owners": owners }),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["field"], "beneficial_owners");
    }
    let (status, body) = patch(
        &app,
        &token,
        &session,
        json!({
            "beneficial_owners": [owner("Anna", json!(60)), owner("Ben", json!("40"))],
            "representative_first_name": "Viktor",
            "representative_last_name": "Zahler",
            "representative_role": "Geschäftsführer",
            "industry": "Handel",
            "country": "IR"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let answers = &body["answers"];
    assert!(answers["first_name"].is_null());
    assert!(answers["citizenships"].is_null());
    assert_eq!(answers["organisation_name"], "Beispiel GmbH");
    assert_eq!(answers["beneficial_owners"][0]["country"], "DE");
    assert_eq!(
        answers["beneficial_owners"][1]["share_percent"],
        json!(40.0)
    );
    let missing = body["missing_for_submit"].as_array().unwrap();
    // The seat in a black-list country opens block E of the risk
    // assessment: the legal form and why the organisation pays are asked.
    assert_eq!(missing[0], "legal_form", "{body}");
    assert_eq!(missing[1], "street", "{body}");
    assert!(missing.contains(&json!("payment_reason")));
    assert!(missing.contains(&json!("register_court")));
    assert!(!missing.contains(&json!("beneficial_owners")));
    assert!(!missing.contains(&json!("first_name")));
    // A seat in a black-list country requires the enhanced check: level 2.
    let (_, info) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-link"),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(info["questionnaire"]["check_level"], 2, "{info}");
    assert_eq!(
        info["questionnaire"]["check_reasons"],
        json!(["payer_residence_blacklist"])
    );
    assert_eq!(info["questionnaire"]["funds_proof_required"], true);
    let (_, check) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/enhanced-check"),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(check["reasons"], json!(["payer_residence_blacklist"]));
    assert_eq!(check["countries"], json!(["IR"]));
    // "Nobody over 25 %" clears the list.
    let (status, body) = patch(
        &app,
        &token,
        &session,
        json!({ "beneficial_owners_none": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["answers"]["beneficial_owners"], json!([]));
}

#[tokio::test]
async fn another_payer_or_address_ends_the_link_and_the_purge_removes_it() {
    let Some(app) = payer_app().await else { return };
    let pool = app.pool();
    let (lead_id, patient) = lead_with_payer(&app, "reset").await;
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    let session = open_session(&app, &token).await;
    consent(&app, &token, &session).await;
    let (status, _) = patch(&app, &token, &session, json!({ "occupation": "Kaufmann" })).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = payer_upload(&app, IDENTITY, &token, &session, "pass.pdf").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let document: Uuid = body["identity_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    // The same payer at another address: the link ends and — the holder of
    // the new address may be somebody else (QA 2026-10-06) — the answers go
    // and the files are withdrawn as for another payer.
    let mut moved = viktor();
    moved["email"] = json!("viktor.neu@example.com");
    name_payer(&app, lead_id, &patient, moved).await;
    let reason: Option<String> =
        sqlx::query_scalar("SELECT revoked_reason FROM lead_payer_links WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(reason.as_deref(), Some("email_changed"));
    let (status, _) = as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::GONE);
    let (occupation, withdrawn): (Option<String>, bool) = sqlx::query_as(
        r#"SELECT s.occupation,
                  (SELECT u.withdrawn_at IS NOT NULL FROM lead_portal_uploads u
                   WHERE u.document_id = $2)
           FROM lead_payer_statements s WHERE s.lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(document)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!((occupation, withdrawn), (None, true));
    let resets = audit_contexts(pool, "payer_questionnaire_reset", lead_id).await;
    assert_eq!(resets.len(), 1);
    assert_eq!(resets[0].1["reason"], "email_changed", "{:?}", resets[0]);

    // Another payer: the link ends, the answers go, the files are withdrawn
    // (the documents stay with the lead for staff).
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    let mut other = viktor();
    other["first_name"] = json!("Ben");
    other["email"] = json!("ben.zahler@example.com");
    name_payer(&app, lead_id, &patient, other).await;
    let (status, body) =
        as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::GONE, "{body}");
    let reasons: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT revoked_reason FROM lead_payer_links WHERE lead_id = $1 ORDER BY created_at",
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(reasons.last().unwrap().as_deref(), Some("payer_changed"));
    let cleared: (
        Option<String>,
        Option<chrono::DateTime<chrono::Utc>>,
        bool,
        bool,
    ) = sqlx::query_as(
        r#"SELECT s.occupation, s.privacy_ack_at,
                      (SELECT u.withdrawn_at IS NOT NULL FROM lead_portal_uploads u
                       WHERE u.document_id = $2),
                      (SELECT d.storage_key IS NOT NULL FROM documents d WHERE d.id = $2)
               FROM lead_payer_statements s WHERE s.lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(document)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(cleared, (None, None, true, true));
    let resets = audit_contexts(pool, "payer_questionnaire_reset", lead_id).await;
    assert_eq!(resets.len(), 2);
    assert_eq!(resets[1].1["reason"], "payer_changed", "{:?}", resets[1]);

    // A converted lead's link stops working.
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    let (status, _) = as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::OK);
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Mia', 'Muster', '1990-01-01', 'female', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-PAYER-{}", Uuid::new_v4().simple()))
    .bind(app.suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE leads SET converted_patient_id = $2 WHERE id = $1")
        .bind(lead_id)
        .bind(patient_id)
        .execute(pool)
        .await
        .unwrap();
    let (status, body) =
        as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::GONE, "{body}");
    assert_eq!(body["code"], "link_revoked");
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-link"),
        &app.manager(),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "lead_converted");
    let (status, _) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-link"),
        &app.manager(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "staff still read it");

    // The purge of an unconverted lead takes statement, links and e-mails.
    let (purged, _) = lead_with_payer(&app, "purge").await;
    let (token, _) = send_link(&app, purged, json!({})).await;
    let session = open_session(&app, &token).await;
    consent(&app, &token, &session).await;
    let (status, body) = payer_upload(&app, IDENTITY, &token, &session, "pass.pdf").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (status, body) = with_login(
        &app,
        "POST",
        &format!("/api/v1/leads/{purged}/failed-flow"),
        &app.manager(),
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let left: (i64, i64, i64, i64) = sqlx::query_as(
        r#"SELECT (SELECT count(*) FROM lead_payer_statements WHERE lead_id = $1),
                  (SELECT count(*) FROM lead_payer_links WHERE lead_id = $1),
                  (SELECT count(*) FROM lead_payer_link_emails WHERE lead_id = $1),
                  (SELECT count(*) FROM lead_portal_uploads WHERE lead_id = $1)"#,
    )
    .bind(purged)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(left, (0, 0, 0, 0));
    let (status, _) = as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// The answers of a payer that sent them through the link: everything of
/// them the page could show, as text.
const OLD_ANSWERS: [&str; 7] = [
    "P1234567",
    "Graz",
    "Ringstraße",
    "Kaufmann",
    "Beispielbank",
    "BH Wien",
    "pass.pdf",
];

/// The staff form of the declaration as the wizard sends it back: every key it
/// edits, as stored.
fn staff_form(current: &Value) -> serde_json::Map<String, Value> {
    let mut form = serde_json::Map::new();
    for key in [
        "payer_kind",
        "acts_on_own_account",
        "beneficial_owner_name",
        "beneficial_owner_note",
        "source_of_funds",
        "source_of_funds_description",
        "source_of_funds_document_id",
        "payer_type",
        "organisation_name",
        "first_name",
        "last_name",
        "date_of_birth",
        "place_of_birth",
        "street",
        "zip",
        "city",
        "country",
        "citizenships",
        "relationship_kind",
        "relationship",
        "email",
        "phone",
    ] {
        form.insert(key.to_string(), current[key].clone());
    }
    form.insert("payer_informed".into(), json!(true));
    form
}

/// Staff save the declaration with `change` applied to the stored form;
/// returns the saved declaration.
async fn staff_save(
    app: &PayerApp,
    lead_id: Uuid,
    change: impl FnOnce(&mut serde_json::Map<String, Value>),
) -> Value {
    let path = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let (_, stored) = with_login(app, "GET", &path, &app.manager(), None).await;
    let mut form = staff_form(&stored["declaration"]);
    change(&mut form);
    let (status, saved) = with_login(
        app,
        "POST",
        &path,
        &app.manager(),
        Some(Value::Object(form)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    saved["declaration"].clone()
}

/// QA 2026-10-06 (S1): the payer's address changes after the payer sent the
/// answers. Whoever holds the new address opens a new link: it shows none of
/// the old answers, no payment route, no files and no acknowledgement — and
/// a link to a payer nobody answered for yet prefills what the lead entered
/// about the payer (owner 2026-10-10), while a link after a payer's answers
/// shows the name and the relationship only.
///
/// QA retest 2026-10-06 (R2-a): the declaration still holds the identity the
/// old address's payer stated, so the lead's cabinet keeps hiding it and does
/// not change the payer until staff name another payer.
#[tokio::test]
async fn a_new_address_gets_a_link_without_the_previous_answers() {
    let Some(app) = payer_app().await else { return };
    let pool = app.pool();
    let (lead_id, patient) = lead(&app, "address").await;
    let mut named = viktor();
    named["street"] = json!("Leadweg 3");
    named["zip"] = json!("10115");
    named["city"] = json!("Berlin");
    named["country"] = json!("DE");
    named["phone"] = json!("+49 30 5550100");
    name_payer(&app, lead_id, &patient, named).await;
    submit_request(&app, lead_id).await;
    let path = format!("/api/v1/leads/{lead_id}/payer-link");
    let (status, estimated) = with_login(
        &app,
        "POST",
        &format!("{path}/estimated-total"),
        &app.manager(),
        Some(json!({ "estimated_total_eur": "500" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{estimated}");

    // A fresh link: what the lead entered about the payer, as editable
    // defaults (owner 2026-10-10, QA C4-f); never an identity document.
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    let session = open_session(&app, &token).await;
    let headers = [
        ("X-Payer-Link", token.as_str()),
        ("X-Payer-Session", session.as_str()),
    ];
    let (status, fresh) = as_payer(&app, "GET", QUESTIONNAIRE, &headers, None).await;
    assert_eq!(status, StatusCode::OK, "{fresh}");
    let answers = &fresh["answers"];
    assert_eq!(answers["first_name"], "Viktor", "{fresh}");
    assert_eq!(answers["last_name"], "Zahler");
    assert_eq!(answers["relationship_kind"], "friend");
    for (key, value) in [
        ("date_of_birth", json!("1970-05-01")),
        ("citizenships", json!(["AT"])),
        ("street", json!("Leadweg 3")),
        ("zip", json!("10115")),
        ("city", json!("Berlin")),
        ("country", json!("DE")),
        ("phone", json!("+49 30 5550100")),
    ] {
        assert_eq!(answers[key], value, "{key}: {fresh}");
    }
    for key in [
        "birth_place",
        "id_document_type",
        "id_document_number",
        "id_issuing_country",
        "id_valid_until",
    ] {
        assert!(answers[key].is_null(), "{key}: {fresh}");
    }
    let missing = fresh["missing_for_submit"].as_array().unwrap();
    for key in ["date_of_birth", "citizenships", "street", "country"] {
        assert!(!missing.contains(&json!(key)), "{key}: {fresh}");
    }
    assert!(missing.contains(&json!("birth_place")), "{fresh}");

    // The payer answers, uploads the identity document and sends.
    consent(&app, &token, &session).await;
    let (status, body) = patch(&app, &token, &session, person_answers()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = payer_upload(&app, IDENTITY, &token, &session, "pass.pdf").await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let document: Uuid = body["identity_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let (status, body) = as_payer(
        &app,
        "POST",
        SUBMIT,
        &headers,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["state"], "submitted");

    // Staff change the payer's address: the same payer, another e-mail.
    let declaration_path = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let (_, stored) = with_login(&app, "GET", &declaration_path, &app.manager(), None).await;
    let current = &stored["declaration"];
    assert_eq!(current["payment_method"], "bank_transfer", "{stored}");
    let adopted_at = current["identity_adopted_at"].clone();
    assert!(adopted_at.is_string(), "the adoption is recorded: {stored}");
    let saved = staff_save(&app, lead_id, |form| {
        form.insert("email".into(), json!("viktor.neu@example.com"));
    })
    .await;
    let saved = &saved;
    assert_eq!(saved["email"], "viktor.neu@example.com", "{saved}");
    assert_eq!(
        saved["identity_adopted_at"], adopted_at,
        "a staff save for the same payer keeps the record: {saved}"
    );
    for key in [
        "payment_method",
        "account_country",
        "account_holder",
        "bank_name",
        "via_third_party",
    ] {
        assert!(saved[key].is_null(), "section 8 goes: {key}: {saved}");
    }
    let reason: Option<String> = sqlx::query_scalar(
        "SELECT revoked_reason FROM lead_payer_links WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(reason.as_deref(), Some("email_changed"));
    let row: (
        Option<String>,
        Option<String>,
        bool,
        Option<String>,
        Option<String>,
        bool,
    ) = sqlx::query_as(
        r#"SELECT s.id_document_number, s.occupation,
                      s.privacy_ack_at IS NULL AND s.submitted_at IS NULL
                          AND s.declared_correct_at IS NULL AND s.adopted_at IS NULL,
                      s.confirmed_email, s.estimated_total_eur::text,
                      (SELECT u.withdrawn_at IS NOT NULL FROM lead_portal_uploads u
                       WHERE u.document_id = $2)
               FROM lead_payer_statements s WHERE s.lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(document)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        row,
        (None, None, true, None, Some("500.00".to_string()), true),
        "only staff's expected total stays"
    );
    let resets = audit_contexts(pool, "payer_questionnaire_reset", lead_id).await;
    assert_eq!(resets.len(), 1, "{resets:?}");
    let context = &resets[0].1;
    assert_eq!(context["reason"], "email_changed", "{context}");
    assert_eq!(context["withdrawn_uploads"], 1, "{context}");
    assert!(
        context["payment_route_cleared"]
            .as_array()
            .unwrap()
            .contains(&json!("bank_name")),
        "{context}"
    );
    for value in OLD_ANSWERS {
        assert!(!context.to_string().contains(value), "{value}: {context}");
    }
    // The statement is reset, but the declaration still holds the identity
    // the payer stated (QA retest R2-a): the lead's cabinet shows the name,
    // the type, the relationship and the own consent only, and does not
    // change the payer.
    let request_path = format!("/api/v1/me/lead-requests/{lead_id}");
    let (_, request) = with_login(&app, "GET", &request_path, &patient, None).await;
    let shown = &request["payer"];
    assert_eq!(shown["answered_by_payer"], true, "{request}");
    assert_eq!(shown["payer_type"], "person");
    assert_eq!(shown["first_name"], "Viktor");
    assert_eq!(shown["last_name"], "Zahler");
    assert_eq!(shown["relationship_kind"], "other");
    assert!(shown["contact_consent_at"].is_string(), "{request}");
    for hidden in [
        "date_of_birth",
        "street",
        "zip",
        "city",
        "country",
        "citizenships",
        "email",
        "phone",
    ] {
        assert!(shown[hidden].is_null(), "{hidden}: {request}");
    }
    for value in [
        "1970-05-01",
        "Ringstraße",
        "Wien",
        "Graz",
        "viktor.neu@example.com",
    ] {
        assert!(!request.to_string().contains(value), "{value}: {request}");
    }
    let mut renamed_by_lead = viktor();
    renamed_by_lead["street"] = json!("Leadweg 5");
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{request_path}/payer"),
        &patient,
        Some(renamed_by_lead),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_answered_by_payer");
    // Another staff save for the same payer keeps the record.
    let saved = staff_save(&app, lead_id, |form| {
        form.insert("phone".into(), json!("+43 1 5550199"));
    })
    .await;
    assert_eq!(saved["phone"], "+43 1 5550199", "{saved}");
    assert_eq!(saved["identity_adopted_at"], adopted_at, "{saved}");
    let (_, request) = with_login(&app, "GET", &request_path, &patient, None).await;
    assert_eq!(request["payer"]["answered_by_payer"], true, "{request}");
    assert!(request["payer"]["phone"].is_null(), "{request}");

    // The new address opens a new link: nothing of the old answers.
    let (token, _) = send_link(&app, lead_id, json!({})).await;
    {
        let received = app.fake.received.lock().unwrap();
        assert_eq!(received.last().unwrap()["to"], "viktor.neu@example.com");
    }
    let session = open_session(&app, &token).await;
    let headers = [
        ("X-Payer-Link", token.as_str()),
        ("X-Payer-Session", session.as_str()),
    ];
    let (status, opened) = as_payer(&app, "GET", OPEN, &headers, None).await;
    assert_eq!(status, StatusCode::OK, "{opened}");
    assert_eq!(opened["state"], "active", "{opened}");
    let (status, shown) = as_payer(&app, "GET", QUESTIONNAIRE, &headers, None).await;
    assert_eq!(status, StatusCode::OK, "{shown}");
    assert_eq!(shown["state"], "draft", "{shown}");
    assert_eq!(shown["email"], "viktor.neu@example.com");
    assert!(shown["privacy"]["acknowledged_at"].is_null(), "{shown}");
    assert!(shown["submitted_at"].is_null());
    assert!(shown["declared_correct_at"].is_null());
    assert_eq!(shown["identity_documents"], json!([]), "{shown}");
    assert_eq!(shown["funds_proof_documents"], json!([]), "{shown}");
    for key in [
        "payment_method",
        "account_country",
        "account_holder",
        "bank_name",
        "via_third_party",
    ] {
        assert!(shown["payment_route"][key].is_null(), "{key}: {shown}");
    }
    let answers = &shown["answers"];
    assert_eq!(answers["first_name"], "Viktor", "{shown}");
    assert_eq!(answers["last_name"], "Zahler");
    for key in [
        "salutation",
        "date_of_birth",
        "birth_place",
        "birth_country",
        "street",
        "zip",
        "city",
        "country",
        "phone",
        "id_document_type",
        "id_document_number",
        "id_issuing_authority",
        "id_issuing_country",
        "id_valid_until",
        "occupation",
        "pep_self",
        "pep_related",
        "high_risk_country",
        "sanctions_links",
    ] {
        assert!(answers[key].is_null(), "{key}: {shown}");
    }
    assert_eq!(answers["citizenships"], json!([]), "{shown}");
    assert_eq!(answers["funds_sources"], json!([]), "{shown}");
    for value in OLD_ANSWERS.iter().chain(["1970-05-01", "Leadweg"].iter()) {
        assert!(!shown.to_string().contains(value), "{value}: {shown}");
    }
    assert_eq!(shown["missing_for_submit"][0], "privacy_ack", "{shown}");
    let (status, refused) = patch(&app, &token, &session, json!({ "occupation": "Händler" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(refused["code"], "payer_consent_required");

    // Staff name another payer (another last name): the record goes, the
    // lead's cabinet may name the payer again.
    let saved = staff_save(&app, lead_id, |form| {
        form.insert("last_name".into(), json!("Zahler-Neu"));
    })
    .await;
    assert_eq!(saved["last_name"], "Zahler-Neu", "{saved}");
    assert!(saved["identity_adopted_at"].is_null(), "{saved}");
    let adopted: (Option<String>, Option<Value>) = sqlx::query_as(
        "SELECT identity_adopted_at::text, identity_adopted_key FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(adopted, (None, None));
    let (_, request) = with_login(&app, "GET", &request_path, &patient, None).await;
    assert_eq!(request["payer"]["answered_by_payer"], false, "{request}");
    assert_eq!(request["payer"]["last_name"], "Zahler-Neu", "{request}");
    let (status, body) = with_login(
        &app,
        "POST",
        &format!("{request_path}/payer"),
        &patient,
        Some(viktor()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}
