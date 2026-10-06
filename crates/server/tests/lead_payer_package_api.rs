//! Integration tests for the payer's signature package (owner decisions
//! 2026-10-06, phase 3b): the gate (every blocked reason, the patient's
//! consent to pass the cost estimate on), preparing the four documents
//! (self-disclosure, Kostenübernahmeerklärung, statement about the payer, the
//! payer's copy of the cost estimate without any line text), sending them as
//! one QES request signed by the payer and GMED only, the outdated reasons,
//! completion (live and DEMO), what the payer and the paying parent see, the
//! roles, conversion and purge. A local stand-in for the Mittaro API carries
//! the payer link's e-mails and a mock Skribble server on loopback stands in
//! for the signature provider; the real APIs are never called. Synthetic data
//! only (Viktor Zahler, Mia/Anna/Ben Muster, Beispiel GmbH, example.com).

mod support;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::{ConnectInfo, Request as AxumRequest, State};
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use secrecy::SecretString;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::config::MailConfig;
use gmed_server::document_signatures::{poll_request_now, provider::Provider};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const PDF: &[u8] = b"%PDF-1.4\n% synthetic payer upload\n%%EOF\n";
const OPEN: &str = "/api/v1/public/payer-link";
const CODE: &str = "/api/v1/public/payer-link/code";
const VERIFY: &str = "/api/v1/public/payer-link/verify";
const QUESTIONNAIRE: &str = "/api/v1/public/payer-link/questionnaire";
const CONSENT: &str = "/api/v1/public/payer-link/consent";
const IDENTITY: &str = "/api/v1/public/payer-link/identity-document";
const SUBMIT: &str = "/api/v1/public/payer-link/submit";
/// What the client's cost estimate says and the payer must never read.
const SECRET_LINES: [&str; 3] = [
    "Organisation der Kardiologie-Termine bei Dr. Beispiel",
    "Zweitmeinung Onkologie Beispielklinikum",
    "Begleitung zur Herzkatheteruntersuchung in der Beispielklinik",
];

static NEXT_PEER: AtomicU32 = AtomicU32::new(1);

/// A peer address of its own for every request (the payer link's limiter).
fn peer() -> ConnectInfo<SocketAddr> {
    let n = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
    ConnectInfo(SocketAddr::from((
        [10, 200, (n >> 8) as u8, n as u8],
        40000,
    )))
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

// ---------------------------------------------------------------- Mittaro

#[derive(Clone, Default)]
struct FakeMittaro {
    received: Arc<Mutex<Vec<Value>>>,
}

async fn fake_send(State(fake): State<FakeMittaro>, body: axum::body::Bytes) -> Response {
    let mut received = fake.received.lock().unwrap();
    received.push(serde_json::from_slice(&body).unwrap());
    let id = format!("email_{}", received.len());
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

// ---------------------------------------------------------------- Skribble

#[derive(Clone, Default)]
struct Mock {
    owner: String,
    requests: Arc<Mutex<HashMap<String, Value>>>,
    payloads: Arc<Mutex<Vec<Value>>>,
}

impl Mock {
    fn remote(&self, request_id: Uuid) -> Option<String> {
        let prefix = format!("gmed:{request_id}:");
        self.requests
            .lock()
            .unwrap()
            .iter()
            .find(|(_, value)| {
                value["custom"]
                    .as_str()
                    .is_some_and(|c| c.starts_with(&prefix))
            })
            .map(|(id, _)| id.clone())
    }

    fn payload(&self, request_id: Uuid) -> Value {
        let prefix = format!("gmed:{request_id}:");
        self.payloads
            .lock()
            .unwrap()
            .iter()
            .find(|value| {
                value["custom"]
                    .as_str()
                    .is_some_and(|c| c.starts_with(&prefix))
            })
            .cloned()
            .expect("create payload")
    }

    /// Everybody signed, now.
    fn sign(&self, request_id: Uuid) {
        let remote = self.remote(request_id).expect("remote request");
        let mut requests = self.requests.lock().unwrap();
        let value = requests.get_mut(&remote).unwrap();
        value["status_overall"] = json!("SIGNED");
        let quality = value["quality"].clone();
        value["document_id"] = json!(Uuid::new_v4());
        for signature in value["signatures"].as_array_mut().unwrap() {
            signature["status_code"] = json!("SIGNED");
            signature["signed_quality"] = quality.clone();
            signature["signed_legislation"] = json!("EIDAS");
            signature["signed_at"] = json!(chrono::Utc::now().to_rfc3339());
        }
    }
}

fn signatures_of(entries: &Value) -> Value {
    Value::Array(
        entries
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .map(|entry| {
                        json!({"sid":Uuid::new_v4(),"status_code":"OPEN",
                            "signer_identity_data":entry["signer_identity_data"]})
                    })
                    .collect()
            })
            .unwrap_or_default(),
    )
}

async fn mock_handler(State(mock): State<Mock>, request: AxumRequest) -> Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();
    let body = axum::body::to_bytes(request.into_body(), 64 * 1024 * 1024)
        .await
        .unwrap();
    let parsed: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let parts: Vec<&str> = path.trim_start_matches("/v2/").split('/').collect();
    match (method.as_str(), parts.as_slice()) {
        ("POST", ["access", "login"]) => "fixture-jwt".into_response(),
        ("POST", ["signature-requests"]) => {
            mock.payloads.lock().unwrap().push(parsed.clone());
            let id = Uuid::new_v4().to_string();
            let value = json!({"id":id,"document_id":Uuid::new_v4(),"owner":mock.owner,
                "custom":parsed["custom"],"quality":parsed["quality"],"legislation":"EIDAS",
                "status_overall":"OPEN","signatures":signatures_of(&parsed["signatures"]),"attachments":[]});
            mock.requests.lock().unwrap().insert(id, value.clone());
            axum::Json(value).into_response()
        }
        ("GET", ["signature-requests"]) => axum::Json(json!(
            mock.requests
                .lock()
                .unwrap()
                .values()
                .cloned()
                .collect::<Vec<_>>()
        ))
        .into_response(),
        ("GET", ["signature-requests", id]) => match mock.requests.lock().unwrap().get(*id) {
            Some(value) => axum::Json(value.clone()).into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
        ("POST", ["signature-requests", id, "withdraw"]) => {
            if let Some(value) = mock.requests.lock().unwrap().get_mut(*id) {
                value["status_overall"] = json!("WITHDRAWN");
            }
            StatusCode::NO_CONTENT.into_response()
        }
        ("GET", ["signature-requests", id, "report"]) => {
            format!("%PDF-1.7\nsignature report {id}\n%%EOF").into_response()
        }
        ("GET", ["documents", id, "content"]) => {
            format!("%PDF-1.7\nsigned bundle {id}\n%%EOF").into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

// ---------------------------------------------------------------- app

struct App {
    suite: support::TestSuiteContext,
    /// The state with the mock provider; the worker polls through it.
    state: AppState,
    app: Router,
    fake: FakeMittaro,
    mock: Mock,
    users: Vec<(&'static str, Uuid)>,
}

impl App {
    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }

    fn ceo(&self) -> String {
        bearer(self.suite.admin_id, "ceo")
    }

    fn staff(&self, role: &str) -> String {
        let (_, id) = self
            .users
            .iter()
            .find(|(name, _)| *name == role)
            .unwrap_or_else(|| panic!("unexpected role {role}"));
        bearer(*id, role)
    }

    fn texts(&self) -> Vec<String> {
        self.fake
            .received
            .lock()
            .unwrap()
            .iter()
            .map(|message| message["text"].as_str().unwrap_or_default().to_string())
            .collect()
    }

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

/// `demo`: the provider's demo account (signatures without legal effect).
async fn app(demo: bool) -> Option<App> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let mut users = Vec::new();
    for role in ["patient_manager", "sales", "ceo_assistant", "billing"] {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
        )
        .bind(format!("payer-package-{role}-{}@example.com", Uuid::new_v4().simple()))
        .bind(format!("{role} payer package"))
        .bind(role)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
        users.push((role, id));
    }
    let (api_url, fake) = start_fake_mittaro().await;
    let owner = if demo {
        "api_demo_test"
    } else {
        "api_prod_test"
    };
    let mock = Mock {
        owner: owner.to_string(),
        ..Mock::default()
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v2", listener.local_addr().unwrap());
    let server_mock = mock.clone();
    tokio::spawn(async move {
        let app = Router::new().fallback(mock_handler).with_state(server_mock);
        axum::serve(listener, app).await.unwrap();
    });
    let provider = Provider::new(
        owner.into(),
        "test-only".into(),
        if demo { "demo" } else { "live" },
    )
    .unwrap()
    .with_test_endpoint(endpoint);
    let state = suite
        .state
        .clone()
        .with_mailer(MailConfig {
            mittaro_api_key: Some(SecretString::from("tx_live_test")),
            mittaro_api_url: Some(api_url),
            from: Some("zugang@gmed-health.test".into()),
            reply_to: None,
            console_url: Some("https://console.gmed-health.test".into()),
        })
        .with_document_signatures(Some(provider));
    let app = gmed_server::build_app_for_role_contract_tests(state.clone());
    Some(App {
        suite,
        state,
        app,
        fake,
        mock,
        users,
    })
}

async fn call(app: &App, request: Request<Body>) -> (StatusCode, Vec<u8>) {
    let mut request = request;
    request.extensions_mut().insert(peer());
    let response = app.app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    (status, bytes.to_vec())
}

async fn with_login(
    app: &App,
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
    let (status, bytes) = call(app, request).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn as_payer(
    app: &App,
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
    let (status, bytes) = call(app, request).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

/// The text of a stored PDF, whitespace collapsed.
async fn pdf_text(app: &App, document_id: &Value) -> String {
    let request = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/documents/{}/download",
            document_id.as_str().unwrap()
        ))
        .header("Authorization", app.ceo())
        .body(Body::empty())
        .unwrap();
    let (status, bytes) = call(app, request).await;
    assert_eq!(status, StatusCode::OK, "download {document_id}");
    pdf_extract::extract_text_from_mem(&bytes)
        .unwrap()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------- fixtures

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

/// A lead (Mia Muster) with its own login; the lead and the login's bearer.
async fn lead(app: &App, tag: &str) -> (Uuid, String) {
    let (status, created) = with_login(
        app,
        "POST",
        "/api/v1/leads",
        &app.staff("patient_manager"),
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

async fn request_sent(app: &App, lead_id: Uuid) {
    sqlx::query("UPDATE leads SET portal_submitted_at = now() WHERE id = $1")
        .bind(lead_id)
        .execute(app.pool())
        .await
        .unwrap();
}

async fn name_payer(app: &App, lead_id: Uuid, patient: &str, payer: Value) -> Value {
    let (status, body) = with_login(
        app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/payer"),
        patient,
        Some(payer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn cost_estimate_consent(app: &App, lead_id: Uuid, login: &str, consent: bool) -> Value {
    let (status, body) = with_login(
        app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/payer/cost-estimate-consent"),
        login,
        Some(json!({ "consent": consent })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

/// Viktor answers through his link and sends his answers; the link token.
async fn payer_submits(app: &App, lead_id: Uuid) -> String {
    let (status, sent) = with_login(
        app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-link"),
        &app.staff("patient_manager"),
        Some(json!({ "language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    let token = app.last_token();
    let (status, body) =
        as_payer(app, "POST", CODE, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let code = app.last_code();
    let (status, verified) = as_payer(
        app,
        "POST",
        VERIFY,
        &[("X-Payer-Link", token.as_str())],
        Some(json!({ "code": code })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{verified}");
    let session = verified["session"].as_str().unwrap().to_string();
    let headers = [
        ("X-Payer-Link", token.as_str()),
        ("X-Payer-Session", session.as_str()),
    ];
    let (status, body) = as_payer(
        app,
        "POST",
        CONSENT,
        &headers,
        Some(json!({ "acknowledged": true, "contact_channels": ["email"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) =
        as_payer(app, "POST", QUESTIONNAIRE, &headers, Some(person_answers())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut upload = Vec::new();
    upload.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"pass.pdf\"\r\nContent-Type: application/pdf\r\n\r\n").as_bytes());
    upload.extend_from_slice(PDF);
    upload.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(IDENTITY)
        .header("X-Payer-Link", &token)
        .header("X-Payer-Session", &session)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(upload))
        .unwrap();
    let (status, bytes) = call(app, request).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    let (status, body) = as_payer(
        app,
        "POST",
        SUBMIT,
        &headers,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    token
}

/// A framework contract and the lead's order; the order and its number.
async fn lead_order(app: &App, lead_id: Uuid) -> (Uuid, String) {
    let tag = Uuid::new_v4().simple().to_string();
    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (lead_id, contract_number, status, created_by)
           VALUES ($1, $2, 'sent', $3) RETURNING id"#,
    )
    .bind(lead_id)
    .bind(format!("FC-PKG-{tag}"))
    .bind(app.suite.admin_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let number = format!("A-PKG-{tag}");
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, contract_id, source_lead_id, total_estimated, created_by)
           VALUES ($1, $2, $3, 1785, $4) RETURNING id"#,
    )
    .bind(&number)
    .bind(contract_id)
    .bind(lead_id)
    .bind(app.suite.admin_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    (order_id, number)
}

/// The client's Kostenvoranschlag of the order, with lines the payer must
/// never read; `replace` makes a new version of an earlier one.
async fn client_estimate(
    app: &App,
    lead_id: Uuid,
    order_id: Uuid,
    replace: Option<&Value>,
) -> Value {
    let mut body = json!({
        "template_id": "order_cost_estimate",
        "lead_id": lead_id,
        "order_id": order_id,
        "language": "de",
        "document_language": "de",
        "status": "active",
        "access_category": "financial",
        "bindings": {
            "service_lines": [
                {
                    "description": SECRET_LINES[0],
                    "quantity": "1",
                    "fee": "1000.00 EUR",
                    "line_total": "1000.00 EUR",
                    "vat_rate": "19",
                    "is_cost_passthrough": false,
                    "note": SECRET_LINES[2]
                },
                {
                    "description": SECRET_LINES[1],
                    "quantity": "1",
                    "fee": "500.00 EUR",
                    "line_total": "500.00 EUR",
                    "vat_rate": "19",
                    "is_cost_passthrough": false
                }
            ]
        }
    });
    if let Some(replace) = replace {
        body["replace_document_id"] = replace.clone();
    }
    let (status, generated) = with_login(
        app,
        "POST",
        "/api/v1/documents/generate",
        &app.ceo(),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    generated["id"].clone()
}

async fn agency_signer(app: &App) {
    sqlx::query(
        r#"INSERT INTO signature_signer_defaults (singleton, signers, updated_by)
           VALUES (true, $1, $2)
           ON CONFLICT (singleton) DO UPDATE SET signers = EXCLUDED.signers"#,
    )
    .bind(json!([{
        "first_name": "Max", "last_name": "Beispiel",
        "email": "max.beispiel@example.com", "role": "agency"
    }]))
    .bind(app.suite.admin_id)
    .execute(app.pool())
    .await
    .unwrap();
}

fn package_path(lead_id: Uuid) -> String {
    format!("/api/v1/leads/{lead_id}/payer-signature-package")
}

async fn package(app: &App, lead_id: Uuid) -> Value {
    let (status, body) = with_login(app, "GET", &package_path(lead_id), &app.ceo(), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn prepare(app: &App, lead_id: Uuid) -> Value {
    let (status, body) = with_login(
        app,
        "POST",
        &format!("{}/prepare", package_path(lead_id)),
        &app.ceo(),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn send(app: &App, lead_id: Uuid, body: Value) -> (StatusCode, Value) {
    with_login(
        app,
        "POST",
        &format!("{}/send", package_path(lead_id)),
        &app.ceo(),
        Some(body),
    )
    .await
}

async fn request_status(pool: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Waits for the background creation of the request until it is pending.
async fn until_pending(app: &App, id: Uuid) {
    for _ in 0..200 {
        match request_status(app.pool(), id).await.as_str() {
            "pending" => return,
            "submission_unknown" => {
                poll_request_now(&app.state, id).await.unwrap();
            }
            "submitting" => {}
            other => panic!("request {id} reached {other}"),
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("request {id} did not become pending");
}

/// Polls the provider until the request is completed.
async fn until_completed(app: &App, id: Uuid) {
    for _ in 0..100 {
        if request_status(app.pool(), id).await == "completed" {
            return;
        }
        let _ = poll_request_now(&app.state, id).await;
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let last_error: Option<String> =
        sqlx::query_scalar("SELECT last_error FROM document_signature_requests WHERE id = $1")
            .bind(id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    panic!(
        "request {id} reached {} ({last_error:?})",
        request_status(app.pool(), id).await
    );
}

/// A lead whose payer Viktor sent his answers, with the patient's consents,
/// an order and the client's cost estimate: ready to prepare.
struct Ready {
    lead_id: Uuid,
    patient: String,
    token: String,
    order_id: Uuid,
    order_number: String,
    estimate: Value,
}

async fn ready_lead(app: &App, tag: &str) -> Ready {
    let (lead_id, patient) = lead(app, tag).await;
    name_payer(app, lead_id, &patient, viktor()).await;
    request_sent(app, lead_id).await;
    let token = payer_submits(app, lead_id).await;
    cost_estimate_consent(app, lead_id, &patient, true).await;
    let (order_id, order_number) = lead_order(app, lead_id).await;
    let estimate = client_estimate(app, lead_id, order_id, None).await;
    Ready {
        lead_id,
        patient,
        token,
        order_id,
        order_number,
        estimate,
    }
}

fn slot<'a>(package: &'a Value, slot: &str) -> &'a Value {
    package["package"]["documents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|document| document["slot"] == slot)
        .unwrap()
}

// ---------------------------------------------------------------- tests

#[tokio::test]
async fn the_payer_signs_four_documents_with_one_qes() {
    let Some(app) = app(false).await else { return };
    let pool = app.pool();
    let ceo = app.ceo();
    let (lead_id, patient) = lead(&app, "main").await;
    let path = package_path(lead_id);

    // Nobody else pays: no package.
    let body = package(&app, lead_id).await;
    assert!(body["mode"].is_null(), "{body}");
    assert_eq!(body["blocked_reason"], "no_third_party");
    assert_eq!(body["can_prepare"], false);
    assert!(body["package"].is_null());
    assert_eq!(body["signature_enabled"], true);
    assert_eq!(body["languages"], json!(["de", "en", "fr", "it"]));

    // Viktor is named: the cabinet asks for both consents of the lead, the
    // consent to pass the cost estimate on right after the contact consent.
    let mut without_consent = viktor();
    without_consent["contact_consent"] = json!(false);
    let request = name_payer(&app, lead_id, &patient, without_consent).await;
    let missing = request["progress"]["missing_for_submit"]
        .as_array()
        .unwrap()
        .iter()
        .map(|key| key.as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    let contact = missing
        .iter()
        .position(|key| key == "payer_contact_consent")
        .expect("the contact consent is missing");
    assert_eq!(
        missing[contact + 1],
        "payer_cost_estimate_consent",
        "{request}"
    );
    let request = name_payer(&app, lead_id, &patient, viktor()).await;
    let missing = request["progress"]["missing_for_submit"]
        .as_array()
        .unwrap();
    assert!(
        !missing.contains(&json!("payer_contact_consent")),
        "{request}"
    );
    assert!(
        missing.contains(&json!("payer_cost_estimate_consent")),
        "{request}"
    );
    assert!(request["payer"]["cost_estimate_consent_at"].is_null());
    request_sent(&app, lead_id).await;
    let body = package(&app, lead_id).await;
    assert_eq!(body["mode"], "link", "{body}");
    assert_eq!(body["blocked_reason"], "payer_not_submitted");
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{path}/prepare"),
        &ceo,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_not_submitted");
    assert_eq!(refused["error"], "payer_not_submitted");

    // Viktor answers through his link.
    let token = payer_submits(&app, lead_id).await;
    let body = package(&app, lead_id).await;
    assert_eq!(
        body["blocked_reason"], "cost_estimate_consent_missing",
        "{body}"
    );
    assert_eq!(body["missing"], json!([]), "{body}");
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(
        declaration["declaration"]["cost_estimate_consent_required"],
        true
    );
    assert_eq!(
        declaration["status"]["cost_estimate_consent_required"],
        true
    );
    assert!(declaration["declaration"]["cost_estimate_consent_at"].is_null());
    assert!(declaration["status"]["payer_package"].is_null());

    // The patient agrees (while the payer's identity is the payer's own
    // answer, the consent stays the patient's).
    let request = cost_estimate_consent(&app, lead_id, &patient, true).await;
    assert_eq!(request["payer"]["answered_by_payer"], true, "{request}");
    let consent_at = request["payer"]["cost_estimate_consent_at"].clone();
    assert!(consent_at.is_string(), "{request}");
    assert!(
        !request["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("payer_cost_estimate_consent")),
        "{request}"
    );
    // Recorded once.
    let again = cost_estimate_consent(&app, lead_id, &patient, true).await;
    assert_eq!(again["payer"]["cost_estimate_consent_at"], consent_at);
    let audited: Vec<Value> = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'lead_portal_payer_cost_estimate_consent' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(audited.len(), 1);
    assert_eq!(audited[0]["consent"], true);
    let body = package(&app, lead_id).await;
    assert_eq!(body["blocked_reason"], "order_missing", "{body}");

    let (order_id, order_number) = lead_order(&app, lead_id).await;
    let body = package(&app, lead_id).await;
    assert_eq!(body["blocked_reason"], "cost_estimate_missing", "{body}");
    assert_eq!(body["order"]["id"], order_id.to_string());
    assert_eq!(body["order"]["number"], order_number);
    let estimate = client_estimate(&app, lead_id, order_id, None).await;
    let body = package(&app, lead_id).await;
    assert!(body["blocked_reason"].is_null(), "{body}");
    assert_eq!(body["can_prepare"], true);
    assert_eq!(body["can_send"], false);
    assert_eq!(body["cost_estimate_document_id"], estimate);
    assert_eq!(body["suggested_language"], "de");
    assert_eq!(
        body["signer"],
        json!({
            "first_name": "Viktor",
            "last_name": "Zahler",
            "email": "viktor.zahler@example.com",
            "acting_for": null
        })
    );
    assert!(body["payer_identification"]["qes_signed_at"].is_null());

    // Prepare: four fresh documents in slot order.
    let prepared = prepare(&app, lead_id).await;
    let package_id = prepared["package"]["id"].clone();
    assert_eq!(prepared["package"]["status"], "prepared", "{prepared}");
    assert_eq!(prepared["package"]["outdated_reasons"], json!([]));
    assert_eq!(prepared["package"]["attachments"], json!([]));
    assert_eq!(prepared["can_prepare"], true);
    assert_eq!(prepared["can_send"], true);
    let slots = prepared["package"]["documents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|document| document["slot"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        slots,
        [
            "self_disclosure",
            "cost_coverage",
            "patient_statement",
            "cost_estimate"
        ]
    );
    for (slot_name, template) in [
        ("self_disclosure", "payer_self_disclosure"),
        ("cost_coverage", "cost_coverage_declaration"),
        ("patient_statement", "patient_payer_statement"),
        ("cost_estimate", "payer_cost_estimate"),
    ] {
        let document = slot(&prepared, slot_name);
        assert_eq!(document["version"], 1, "{document}");
        assert!(document["signed_at"].is_null());
        let (stored, visibility, medical): (Option<String>, String, bool) = sqlx::query_as(
            "SELECT generated_template_id, visibility, is_medical FROM documents WHERE id = $1",
        )
        .bind(Uuid::parse_str(document["document_id"].as_str().unwrap()).unwrap())
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(stored.as_deref(), Some(template));
        assert_eq!(visibility, "internal", "{template}");
        assert!(!medical);
    }
    let audited: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'payer_package_prepared' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audited["package_id"], package_id);
    assert_eq!(audited["mode"], "link");
    assert_eq!(audited["document_ids"].as_array().unwrap().len(), 4);
    // The Kostenübernahmeerklärung names the payer of now.
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(declaration["status"]["cost_assumption"]["current"], true);
    assert_eq!(declaration["status"]["cost_assumption"]["signed"], false);
    assert_eq!(
        declaration["status"]["payer_package"]["status"], "prepared",
        "{declaration}"
    );
    assert_eq!(declaration["status"]["payer_package"]["outdated"], false);

    // The payer's copy of the cost estimate: service types and amounts, the
    // totals of the client's estimate, nothing of its lines.
    let text = pdf_text(&app, &slot(&prepared, "cost_estimate")["document_id"]).await;
    assert!(
        text.contains("Anlage zur Kostenübernahmeerklärung"),
        "{text}"
    );
    assert!(
        text.contains(
            "Diese Aufstellung enthält bewusst keine Angaben zu Diagnosen oder Behandlungen."
        ),
        "{text}"
    );
    assert!(
        text.contains("Kostenübernehmer/in: Viktor Zahler"),
        "{text}"
    );
    assert!(text.contains("1.500,00 EUR"), "{text}");
    assert!(text.contains("Gesamtsumme: 1.785,00 EUR"), "{text}");
    for secret in SECRET_LINES {
        assert!(!text.contains(secret), "{secret} in {text}");
    }
    for word in [
        "Kardiologie",
        "Onkologie",
        "Herzkatheter",
        "Beispielklinik",
        "Dr. Beispiel",
    ] {
        assert!(!text.contains(word), "{word} in {text}");
    }
    let text = pdf_text(&app, &slot(&prepared, "self_disclosure")["document_id"]).await;
    for expected in [
        "Selbstauskunft",
        "Viktor Zahler",
        "P1234567",
        "Graz (Österreich)",
    ] {
        assert!(text.contains(expected), "{expected} missing in {text}");
    }
    for word in ["Prüfstufe", "Bearbeiter", "Diagnose"] {
        assert!(!text.contains(word), "{word} in {text}");
    }
    let text = pdf_text(&app, &slot(&prepared, "patient_statement")["document_id"]).await;
    assert!(
        text.contains("Erklärung zur Kostenübernahme durch Dritte"),
        "{text}"
    );
    assert!(text.contains("Onkel"), "{text}");

    // Without a GMED signer the package cannot be sent.
    let (status, refused) = send(&app, lead_id, json!({ "package_id": package_id })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["error"], "agency_signer_missing");
    agency_signer(&app).await;
    let (status, refused) = send(&app, lead_id, json!({ "package_id": Uuid::new_v4() })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_package_stale");
    let (status, refused) = send(
        &app,
        lead_id,
        json!({ "package_id": package_id, "unknown": true }),
    )
    .await;
    assert!(status.is_client_error(), "{refused}");

    // Send: one request, the payer and GMED only, QES.
    let (status, sent) = send(
        &app,
        lead_id,
        json!({ "package_id": package_id, "language": "en", "message": null, "expires_at": null }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{sent}");
    assert_eq!(sent["package"]["language"], "en");
    assert!(sent["package"]["sent_at"].is_string());
    let request_id = Uuid::parse_str(sent["package"]["request_id"].as_str().unwrap()).unwrap();
    until_pending(&app, request_id).await;
    let (level, members): (String, i64) = sqlx::query_as(
        r#"SELECT r.level, (SELECT count(*) FROM document_signature_members m WHERE m.request_id = r.id)
           FROM document_signature_requests r WHERE r.id = $1"#,
    )
    .bind(request_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(level, "QES");
    assert_eq!(
        members, 3,
        "the self-disclosure is the source, three members follow"
    );
    let payload = app.mock.payload(request_id);
    assert_eq!(payload["quality"], "QES");
    let emails = payload["signatures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            entry["signer_identity_data"]["email_address"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        emails,
        ["viktor.zahler@example.com", "max.beispiel@example.com"],
        "never the patient side"
    );
    let attachments: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM document_signature_attachments WHERE request_id = $1",
    )
    .bind(request_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(attachments, 0, "no medical cost calculation for the payer");
    let sent_audit: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'payer_package_sent' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(sent_audit["request_id"], request_id.to_string());
    assert!(!sent_audit.to_string().contains('@'), "{sent_audit}");

    let body = package(&app, lead_id).await;
    assert_eq!(body["package"]["status"], "pending", "{body}");
    assert_eq!(body["can_send"], false);
    assert_eq!(body["can_prepare"], false);
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(declaration["status"]["payer_package"]["status"], "pending");
    assert!(declaration["status"]["payer_package"]["sent_at"].is_string());
    // The payer sees one line: no titles, ids or request data.
    let (status, opened) =
        as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(status, StatusCode::OK, "{opened}");
    assert_eq!(opened["signature_package"]["status"], "sent", "{opened}");
    assert!(opened["signature_package"]["sent_at"].is_string());
    assert!(opened["signature_package"]["signed_at"].is_null());
    let mut keys = opened["signature_package"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    keys.sort();
    assert_eq!(keys, ["sent_at", "signed_at", "status"]);
    // Only for the address the payer confirmed.
    sqlx::query("UPDATE lead_payer_signature_packages SET signer_email = 'someone@example.com' WHERE lead_id = $1 AND superseded_at IS NULL")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();
    let (_, opened) = as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert!(opened["signature_package"].is_null(), "{opened}");
    sqlx::query("UPDATE lead_payer_signature_packages SET signer_email = 'viktor.zahler@example.com' WHERE lead_id = $1 AND superseded_at IS NULL")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();

    // Out for signature: neither a second send nor a new preparation.
    let (status, refused) = send(&app, lead_id, json!({ "package_id": package_id })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_package_pending");
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{path}/prepare"),
        &ceo,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_package_pending");

    // Signed: every document signed, the Kostenübernahmeerklärung counts,
    // the QES identifies the payer.
    app.mock.sign(request_id);
    until_completed(&app, request_id).await;
    let body = package(&app, lead_id).await;
    assert_eq!(body["package"]["status"], "signed", "{body}");
    assert_eq!(body["package"]["test_mode"], false);
    assert!(body["package"]["signed_at"].is_string());
    for document in body["package"]["documents"].as_array().unwrap() {
        assert!(document["signed_at"].is_string(), "{document}");
    }
    assert!(
        body["payer_identification"]["qes_signed_at"].is_string(),
        "{body}"
    );
    assert_eq!(body["payer_identification"]["qes_test_mode"], false);
    assert_eq!(body["can_prepare"], false);
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(declaration["status"]["cost_assumption"]["signed"], true);
    assert_eq!(declaration["status"]["payer_package"]["status"], "signed");
    assert!(declaration["status"]["payer_package"]["signed_at"].is_string());
    let (_, opened) = as_payer(&app, "GET", OPEN, &[("X-Payer-Link", token.as_str())], None).await;
    assert_eq!(opened["signature_package"]["status"], "signed", "{opened}");
    assert!(opened["signature_package"]["signed_at"].is_string());
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{path}/prepare"),
        &ceo,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_package_signed");
}

#[tokio::test]
async fn a_change_makes_the_package_outdated_and_it_is_prepared_again() {
    let Some(app) = app(false).await else { return };
    let pool = app.pool();
    let ready = ready_lead(&app, "outdated").await;
    let lead_id = ready.lead_id;
    agency_signer(&app).await;

    // Every change of what the documents were made from is named; sending is
    // refused with the reasons until the documents are prepared again.
    let assert_outdated = |reason: &'static str| {
        let app = &app;
        async move {
            let body = package(app, lead_id).await;
            let reasons = body["package"]["outdated_reasons"].as_array().unwrap();
            assert!(reasons.contains(&json!(reason)), "{reason}: {body}");
            assert_eq!(body["can_send"], false, "{body}");
            let (status, refused) =
                send(app, lead_id, json!({ "package_id": body["package"]["id"] })).await;
            assert_eq!(status, StatusCode::CONFLICT, "{refused}");
            assert_eq!(refused["code"], "payer_package_outdated");
            assert!(
                refused["reasons"]
                    .as_array()
                    .unwrap()
                    .contains(&json!(reason)),
                "{refused}"
            );
            let (_, declaration) = with_login(
                app,
                "GET",
                &format!("/api/v1/leads/{lead_id}/payer-declaration"),
                &app.ceo(),
                None,
            )
            .await;
            assert_eq!(declaration["status"]["payer_package"]["outdated"], true);
            let prepared = prepare(app, lead_id).await;
            assert_eq!(
                prepared["package"]["outdated_reasons"],
                json!([]),
                "{prepared}"
            );
            assert_eq!(prepared["can_send"], true, "{prepared}");
            prepared
        }
    };

    let first = prepare(&app, lead_id).await;
    // A new version of the client's estimate.
    client_estimate(&app, lead_id, ready.order_id, Some(&ready.estimate)).await;
    let second = assert_outdated("cost_estimate_changed").await;
    assert_ne!(first["package"]["id"], second["package"]["id"]);
    // The earlier documents got new versions; the earlier row is superseded.
    assert_eq!(slot(&second, "self_disclosure")["version"], 2, "{second}");
    let current: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_payer_signature_packages WHERE lead_id = $1 AND superseded_at IS NULL",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(current, 1);

    // Why the payer pays, as the patient states it.
    let (status, body) = with_login(
        &app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/identification"),
        &ready.patient,
        Some(json!({ "payment_background": "Mein Onkel übernimmt die Kosten." })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_outdated("patient_statement_changed").await;

    // Staff correct the payer's address: another version of the payer.
    let (_, stored) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.ceo(),
        None,
    )
    .await;
    let current = &stored["declaration"];
    let mut form = serde_json::Map::new();
    for key in [
        "payer_kind",
        "acts_on_own_account",
        "source_of_funds",
        "payer_type",
        "first_name",
        "last_name",
        "date_of_birth",
        "place_of_birth",
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
    form.insert("street".into(), json!("Ringstraße 11"));
    let (status, saved) = with_login(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.ceo(),
        Some(Value::Object(form)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_outdated("payer_changed").await;

    // A document of the package lost its file.
    let body = package(&app, lead_id).await;
    let document = Uuid::parse_str(
        slot(&body, "patient_statement")["document_id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    sqlx::query("UPDATE documents SET file_deleted_at = now() WHERE id = $1")
        .bind(document)
        .execute(pool)
        .await
        .unwrap();
    assert_outdated("document_replaced").await;

    // The payer's answers were sent again.
    sqlx::query("UPDATE lead_payer_statements SET submitted_at = now() WHERE lead_id = $1")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();
    let last = assert_outdated("payer_answers_changed").await;

    // A withdrawn request: sent again from the same documents.
    let (status, sent) = send(
        &app,
        lead_id,
        json!({ "package_id": last["package"]["id"] }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{sent}");
    let request_id = Uuid::parse_str(sent["package"]["request_id"].as_str().unwrap()).unwrap();
    until_pending(&app, request_id).await;
    let (status, body) = with_login(
        &app,
        "POST",
        &format!("/api/v1/document-signature-requests/{request_id}/withdraw"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for _ in 0..100 {
        if request_status(pool, request_id).await == "withdrawn" {
            break;
        }
        let _ = poll_request_now(&app.state, request_id).await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let body = package(&app, lead_id).await;
    assert_eq!(body["package"]["status"], "withdrawn", "{body}");
    assert_eq!(body["can_send"], true);
    assert_eq!(body["can_prepare"], true);
    let (status, resent) = send(
        &app,
        lead_id,
        json!({ "package_id": last["package"]["id"] }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{resent}");
    assert_ne!(resent["package"]["request_id"], request_id.to_string());

    // The client's own estimate can be out for the client's signature while
    // the payer's package is: two documents, two requests.
    let (status, client) = with_login(
        &app,
        "POST",
        "/api/v1/signature-packages",
        &app.ceo(),
        Some(json!({
            "document_ids": [package(&app, lead_id).await["cost_estimate_document_id"]],
            "signers": [
                { "first_name": "Mia", "last_name": "Muster", "email": "mia.client@example.com", "role": "client" },
                { "first_name": "Max", "last_name": "Beispiel", "email": "max.beispiel@example.com", "role": "agency" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{client}");
    let _ = (&ready.token, &ready.order_number);
}

#[tokio::test]
async fn roles_conversion_and_purge() {
    let Some(app) = app(false).await else { return };
    let pool = app.pool();
    let ready = ready_lead(&app, "roles").await;
    let lead_id = ready.lead_id;
    let path = package_path(lead_id);

    // Sales and the CEO assistant read, the patient manager prepares,
    // billing does not even read.
    for role in ["sales", "ceo_assistant"] {
        let (status, body) = with_login(&app, "GET", &path, &app.staff(role), None).await;
        assert_eq!(status, StatusCode::OK, "{role}: {body}");
        assert_eq!(body["can_prepare"], false, "{role}");
        for action in ["prepare", "send"] {
            let (status, _) = with_login(
                &app,
                "POST",
                &format!("{path}/{action}"),
                &app.staff(role),
                Some(if action == "send" {
                    json!({ "package_id": Uuid::new_v4() })
                } else {
                    json!({})
                }),
            )
            .await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{role} {action}");
        }
    }
    let (status, _) = with_login(&app, "GET", &path, &app.staff("billing"), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = with_login(&app, "GET", &path, &app.staff("patient_manager"), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["can_prepare"], true);
    let (status, _) =
        with_login(&app, "GET", &package_path(Uuid::new_v4()), &app.ceo(), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, refused) = send(&app, lead_id, json!({ "package_id": Uuid::new_v4() })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_package_not_prepared");
    prepare(&app, lead_id).await;

    // The consent endpoint: only the lead's own login, only with a third
    // party.
    let consent = format!("/api/v1/me/lead-requests/{lead_id}/payer/cost-estimate-consent");
    let (status, _) = with_login(
        &app,
        "POST",
        &consent,
        &app.ceo(),
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (other_lead, other_patient) = lead(&app, "other").await;
    let (status, _) = with_login(
        &app,
        "POST",
        &consent,
        &other_patient,
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("/api/v1/me/lead-requests/{other_lead}/payer/cost-estimate-consent"),
        &other_patient,
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "no_third_party_payer");
    // Withdrawn, the package is blocked again; given anew, it is open.
    let request = cost_estimate_consent(&app, lead_id, &ready.patient, false).await;
    assert!(request["payer"]["cost_estimate_consent_at"].is_null());
    let body = package(&app, lead_id).await;
    assert_eq!(body["blocked_reason"], "cost_estimate_consent_missing");
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{path}/prepare"),
        &app.ceo(),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "cost_estimate_consent_missing");
    cost_estimate_consent(&app, lead_id, &ready.patient, true).await;
    assert!(package(&app, lead_id).await["blocked_reason"].is_null());

    // Another payer named in the cabinet: the consents go with the old one.
    let request = name_payer(&app, other_lead, &other_patient, viktor()).await;
    assert!(request["payer"]["contact_consent_at"].is_string());
    let request = cost_estimate_consent(&app, other_lead, &other_patient, true).await;
    assert!(request["payer"]["cost_estimate_consent_at"].is_string());
    let mut another = viktor();
    another["first_name"] = json!("Vera");
    let request = name_payer(&app, other_lead, &other_patient, another).await;
    assert!(
        request["payer"]["cost_estimate_consent_at"].is_null(),
        "{request}"
    );

    // Converted: readable, never prepared again; the package stays (GwG
    // evidence).
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Mia', 'Muster', DATE '1990-01-01', 'female', $2) RETURNING id"#,
    )
    .bind(format!("PT-PKG-{}", Uuid::new_v4().simple()))
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
    let body = package(&app, lead_id).await;
    assert_eq!(body["blocked_reason"], "lead_converted", "{body}");
    assert!(body["package"].is_object());
    let (status, refused) = with_login(
        &app,
        "POST",
        &format!("{path}/prepare"),
        &app.ceo(),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "lead_converted");
}

#[tokio::test]
async fn the_purge_of_an_unconverted_lead_deletes_its_packages() {
    let Some(app) = app(false).await else { return };
    let pool = app.pool();
    let ready = ready_lead(&app, "purge").await;
    prepare(&app, ready.lead_id).await;
    let count = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM lead_payer_signature_packages WHERE lead_id = $1",
        )
        .bind(ready.lead_id)
        .fetch_one(pool)
        .await
        .unwrap()
    };
    assert_eq!(count().await, 1);
    let (status, body) = with_login(
        &app,
        "POST",
        &format!("/api/v1/leads/{}/failed-flow", ready.lead_id),
        &app.staff("patient_manager"),
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(count().await, 0);
}

#[tokio::test]
async fn a_demo_signature_identifies_nobody_and_signs_nothing() {
    let Some(app) = app(true).await else { return };
    let ready = ready_lead(&app, "demo").await;
    let lead_id = ready.lead_id;
    agency_signer(&app).await;
    let prepared = prepare(&app, lead_id).await;
    let (status, sent) = send(
        &app,
        lead_id,
        json!({ "package_id": prepared["package"]["id"] }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{sent}");
    let request_id = Uuid::parse_str(sent["package"]["request_id"].as_str().unwrap()).unwrap();
    until_pending(&app, request_id).await;
    assert_eq!(app.mock.payload(request_id)["quality"], "DEMO");
    app.mock.sign(request_id);
    until_completed(&app, request_id).await;
    let body = package(&app, lead_id).await;
    assert_eq!(body["package"]["status"], "signed", "{body}");
    assert_eq!(body["package"]["test_mode"], true);
    // No legal effect: the documents stay unsigned, the QES is a test one.
    for document in body["package"]["documents"].as_array().unwrap() {
        assert!(document["signed_at"].is_null(), "{document}");
    }
    assert!(
        body["payer_identification"]["qes_signed_at"].is_string(),
        "{body}"
    );
    assert_eq!(body["payer_identification"]["qes_test_mode"], true);
    let (_, declaration) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(declaration["status"]["cost_assumption"]["signed"], false);
    let _ = &ready.token;
}

#[tokio::test]
async fn an_organisation_signs_through_its_representative() {
    let Some(app) = app(false).await else { return };
    let pool = app.pool();
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
            "email": "kosten@example.com",
            "contact_consent": true
        }),
    )
    .await;
    cost_estimate_consent(&app, lead_id, &patient, true).await;
    // The company's answers, as its link would have stored them.
    sqlx::query(
        r#"INSERT INTO lead_payer_statements (
               lead_id, source, payer_key, privacy_ack_at, privacy_text_version, contact_channels,
               confirmed_email, email_confirmed_at, organisation_name, street, zip, city, country,
               register_court, register_number, representative_first_name,
               representative_last_name, representative_role, beneficial_owners_none,
               relationship_kind, industry, funds_sources, pep_self, pep_related,
               high_risk_country, sanctions_links, declared_correct_at, submitted_at, adopted_at)
           VALUES ($1, 'link', jsonb_build_array('company', 'Beispiel GmbH', NULL, NULL, NULL),
                   now(), 'payer-privacy-2026-10-06', '{email}', 'kosten@example.com', now(),
                   'Beispiel GmbH', 'Domstraße 1', '50667', 'Köln', 'DE', 'Amtsgericht Köln',
                   'HRB 12345', 'Max', 'Muster', 'Geschäftsführer', true, 'employer', 'Handel',
                   '{other}', false, false, false, false, now(), now(), now())"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, saved) = with_login(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.ceo(),
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "company",
            "organisation_name": "Beispiel GmbH",
            "acts_on_own_account": true,
            "source_of_funds": "business_income",
            "street": "Domstraße 1",
            "zip": "50667",
            "city": "Köln",
            "country": "DE",
            "relationship_kind": "employer",
            "email": "kosten@example.com",
            "payer_informed": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert!(
        saved["declaration"]["cost_estimate_consent_at"].is_string(),
        "{saved}"
    );
    let (order_id, _) = lead_order(&app, lead_id).await;
    client_estimate(&app, lead_id, order_id, None).await;
    let body = package(&app, lead_id).await;
    assert!(body["blocked_reason"].is_null(), "{body}");
    assert_eq!(
        body["signer"],
        json!({
            "first_name": "Max",
            "last_name": "Muster",
            "email": "kosten@example.com",
            "acting_for": "Beispiel GmbH"
        })
    );
    let prepared = prepare(&app, lead_id).await;
    let text = pdf_text(&app, &slot(&prepared, "self_disclosure")["document_id"]).await;
    assert!(
        text.contains("Für Beispiel GmbH: Max Muster, Geschäftsführer"),
        "{text}"
    );
    assert!(text.contains("Wir versichern"), "{text}");
    let text = pdf_text(&app, &slot(&prepared, "patient_statement")["document_id"]).await;
    assert!(text.contains("Wir übernehmen die Kosten"), "{text}");
}

#[tokio::test]
async fn a_paying_parent_signs_the_same_package_and_is_identified_on_the_own_line() {
    let Some(app) = app(false).await else { return };
    let pool = app.pool();
    let pm = app.staff("patient_manager");
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    let (status, created) = with_login(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Mia",
            "last_name": "Muster",
            "date_of_birth": "2016-04-05",
            "email": format!("mia.parent.{}@example.com", Uuid::new_v4().simple()),
            "trusted_contacts": [
                { "id": mother, "name": "Anna Muster", "relation": "mother",
                  "email": "anna.package@example.com", "birth_date": "1985-03-02" },
                { "id": father, "name": "Ben Muster", "relation": "father",
                  "email": "ben.package@example.com", "birth_date": "1983-01-02" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let child: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let mut logins = Vec::new();
    for contact in [mother, father] {
        let (status, issued) = with_login(
            &app,
            "POST",
            &format!("/api/v1/leads/{child}/portal-guardians"),
            &pm,
            Some(json!({ "trusted_contact_id": contact })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{issued}");
        let user: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
        logins.push(bearer(user, "patient"));
    }
    let (anna, ben) = (&logins[0], &logins[1]);
    let request = name_payer(
        &app,
        child,
        anna,
        json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "relationship_kind": "parent",
            "first_name": "Anna",
            "last_name": "Muster",
            "date_of_birth": "1985-03-02",
            "email": "anna.package@example.com",
            "citizenships": ["DE"],
            "contact_consent": true
        }),
    )
    .await;
    // The paying parent is the payer: neither consent is asked of her.
    let missing = request["progress"]["missing_for_submit"]
        .as_array()
        .unwrap();
    assert!(
        !missing.contains(&json!("payer_cost_estimate_consent")),
        "{request}"
    );
    // Her answers, as her cabinet section would have stored them.
    sqlx::query(
        r#"INSERT INTO lead_payer_statements (
               lead_id, source, payer_key, privacy_ack_at, privacy_text_version, contact_channels,
               confirmed_email, email_confirmed_at, salutation, occupation, funds_sources,
               pep_self, pep_related, high_risk_country, sanctions_links, declared_correct_at,
               submitted_at, adopted_at)
           VALUES ($1, 'cabinet', jsonb_build_array('person', NULL, 'Anna', 'Muster', '1985-03-02'),
                   now(), 'payer-privacy-2026-10-06', '{email}', 'anna.package@example.com', now(),
                   'ms', 'Lehrerin', '{employment}', false, false, false, false, now(), now(), now())"#,
    )
    .bind(child)
    .execute(pool)
    .await
    .unwrap();
    let (status, saved) = with_login(
        &app,
        "POST",
        &format!("/api/v1/leads/{child}/payer-declaration"),
        &app.ceo(),
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "acts_on_own_account": true,
            "source_of_funds": "employment",
            "first_name": "Anna",
            "last_name": "Muster",
            "date_of_birth": "1985-03-02",
            "street": "Musterweg 1",
            "zip": "10115",
            "city": "Berlin",
            "country": "DE",
            "citizenships": ["DE"],
            "relationship_kind": "parent",
            "email": "anna.package@example.com",
            "payer_informed": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["declaration"]["cost_estimate_consent_required"], false,
        "{saved}"
    );
    let (order_id, _) = lead_order(&app, child).await;
    client_estimate(&app, child, order_id, None).await;
    let body = package(&app, child).await;
    assert_eq!(body["mode"], "cabinet", "{body}");
    assert!(body["blocked_reason"].is_null(), "{body}");
    assert_eq!(body["signer"]["first_name"], "Anna");
    assert_eq!(body["signer"]["email"], "anna.package@example.com");
    agency_signer(&app).await;
    let prepared = prepare(&app, child).await;
    let text = pdf_text(&app, &slot(&prepared, "self_disclosure")["document_id"]).await;
    assert!(text.contains("über das Patientenportal"), "{text}");
    let (status, sent) = send(
        &app,
        child,
        json!({ "package_id": prepared["package"]["id"] }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{sent}");
    let request_id = Uuid::parse_str(sent["package"]["request_id"].as_str().unwrap()).unwrap();
    until_pending(&app, request_id).await;
    let request_path = format!("/api/v1/me/lead-requests/{child}");
    let (_, request) = with_login(&app, "GET", &request_path, anna, None).await;
    assert_eq!(
        request["payer_questionnaire"]["signature_package"]["status"], "sent",
        "{request}"
    );
    let (_, request) = with_login(&app, "GET", &request_path, ben, None).await;
    assert!(request["payer_questionnaire"].is_null(), "{request}");
    app.mock.sign(request_id);
    until_completed(&app, request_id).await;
    let (_, request) = with_login(&app, "GET", &request_path, anna, None).await;
    assert_eq!(
        request["payer_questionnaire"]["signature_package"]["status"], "signed",
        "{request}"
    );
    let (_, section) = with_login(
        &app,
        "GET",
        &format!("{request_path}/payer-questionnaire"),
        anna,
        None,
    )
    .await;
    assert_eq!(
        section["signature_package"]["status"], "signed",
        "{section}"
    );
    // Her QES identifies her on her own line, the payer line shows it too.
    let (_, identification) = with_login(
        &app,
        "GET",
        &format!("/api/v1/leads/{child}/identification-status"),
        &app.ceo(),
        None,
    )
    .await;
    let anna_line = identification["representatives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["name"] == "Anna Muster")
        .unwrap();
    assert!(
        anna_line["qes"]["signed_at"].is_string(),
        "{identification}"
    );
    assert!(
        identification["payer"]["qes"]["signed_at"].is_string(),
        "{identification}"
    );
    let body = package(&app, child).await;
    assert!(
        body["payer_identification"]["qes_signed_at"].is_string(),
        "{body}"
    );
}
