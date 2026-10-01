//! Electronic signature packages (owner decisions 2026-10-01): several
//! documents of one patient or lead are signed once as one PDF. A mock
//! Skribble server on loopback stands in for the provider; the real API is
//! never called. Synthetic data only.

mod support;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{ConnectInfo, Request as AxumRequest, State},
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
};
use base64::Engine;
use lopdf::{Document, Object, Stream, dictionary};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::document_signatures::{poll_request_now, provider::Provider, retention};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const PEER: std::net::SocketAddr = std::net::SocketAddr::V4(std::net::SocketAddrV4::new(
    std::net::Ipv4Addr::LOCALHOST,
    40124,
));

// ---------------------------------------------------------------- mock

#[derive(Clone, Default)]
struct Mock {
    requests: Arc<Mutex<HashMap<String, Value>>>,
    attachments: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    payloads: Arc<Mutex<Vec<Value>>>,
    withdrawals: Arc<Mutex<Vec<String>>>,
    deletions: Arc<Mutex<Vec<String>>>,
}

impl Mock {
    /// The provider's request for a GMED request ID.
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

    fn set_status(&self, request_id: Uuid, status: &str) {
        let remote = self.remote(request_id).expect("remote request");
        let mut requests = self.requests.lock().unwrap();
        let value = requests.get_mut(&remote).unwrap();
        value["status_overall"] = json!(status);
        if status == "SIGNED" {
            let quality = value["quality"].clone();
            value["document_id"] = json!(Uuid::new_v4());
            for signature in value["signatures"].as_array_mut().unwrap() {
                signature["status_code"] = json!("SIGNED");
                signature["signed_quality"] = quality.clone();
                signature["signed_legislation"] = json!("EIDAS");
                signature["signed_at"] =
                    json!((chrono::Utc::now() - chrono::Duration::minutes(1)).to_rfc3339());
            }
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
            let value = json!({"id":id,"document_id":Uuid::new_v4(),"owner":"api_prod_test",
                "custom":parsed["custom"],"quality":parsed["quality"],"legislation":"EIDAS",
                "status_overall":"OPEN","signatures":signatures_of(&parsed["signatures"]),"attachments":[]});
            mock.requests.lock().unwrap().insert(id, value.clone());
            Json(value).into_response()
        }
        ("PUT", ["signature-requests"]) => {
            let id = parsed["id"].as_str().unwrap().to_string();
            let mut requests = mock.requests.lock().unwrap();
            let value = requests.get_mut(&id).unwrap();
            value["signatures"] = signatures_of(&parsed["signatures"]);
            Json(value.clone()).into_response()
        }
        ("GET", ["signature-requests"]) => Json(json!(
            mock.requests
                .lock()
                .unwrap()
                .values()
                .cloned()
                .collect::<Vec<_>>()
        ))
        .into_response(),
        ("GET", ["signature-requests", id]) => match mock.requests.lock().unwrap().get(*id) {
            Some(value) => Json(value.clone()).into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
        ("POST", ["signature-requests", id, "attachments"]) => {
            let attachment_id = Uuid::new_v4().to_string();
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(parsed["content"].as_str().unwrap())
                .unwrap();
            mock.attachments
                .lock()
                .unwrap()
                .insert(attachment_id.clone(), bytes);
            let mut requests = mock.requests.lock().unwrap();
            let value = requests.get_mut(*id).unwrap();
            value["attachments"]
                .as_array_mut()
                .unwrap()
                .push(json!({"filename":parsed["filename"],"attachment_id":attachment_id}));
            Json(value.clone()).into_response()
        }
        (
            "GET",
            [
                "signature-requests",
                _,
                "attachments",
                attachment,
                "content",
            ],
        ) => mock
            .attachments
            .lock()
            .unwrap()
            .get(*attachment)
            .cloned()
            .unwrap_or_default()
            .into_response(),
        ("POST", ["signature-requests", id, "withdraw"]) => {
            mock.withdrawals.lock().unwrap().push(id.to_string());
            if let Some(value) = mock.requests.lock().unwrap().get_mut(*id) {
                value["status_overall"] = json!("WITHDRAWN");
            }
            StatusCode::NO_CONTENT.into_response()
        }
        ("DELETE", ["signature-requests", id]) => {
            mock.deletions.lock().unwrap().push(id.to_string());
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

struct Env {
    app: Router,
    state: AppState,
    pool: PgPool,
    mock: Mock,
    ceo: String,
    admin_id: Uuid,
    _ctx: support::TestSuiteContext,
    _server: tokio::task::JoinHandle<()>,
}

async fn env() -> Option<Env> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let mock = Mock::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v2", listener.local_addr().unwrap());
    let server_mock = mock.clone();
    let server = tokio::spawn(async move {
        let app = Router::new().fallback(mock_handler).with_state(server_mock);
        axum::serve(listener, app).await.unwrap();
    });
    let provider = Provider::new("api_prod_test".into(), "test-only".into(), "live")
        .unwrap()
        .with_test_endpoint(endpoint);
    let state = ctx.state.clone().with_document_signatures(Some(provider));
    let app = gmed_server::build_app_for_role_contract_tests(state.clone())
        .layer(Extension(ConnectInfo(PEER)));
    Some(Env {
        ceo: bearer(ctx.admin_id, "ceo"),
        admin_id: ctx.admin_id,
        pool: ctx.pool.clone(),
        app,
        state,
        mock,
        _ctx: ctx,
        _server: server,
    })
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    auth: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .body(body.map_or_else(Body::empty, |v| Body::from(v.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// ---------------------------------------------------------------- fixtures

/// A valid PDF with `pages` pages and optional filler bytes.
fn pdf(pages: usize, filler: usize, signed: bool) -> Vec<u8> {
    let mut document = Document::with_version("1.5");
    let pages_id = document.new_object_id();
    let mut kids = Vec::new();
    for _ in 0..pages {
        let content = document.add_object(Stream::new(dictionary! {}, b"BT ET".to_vec()));
        kids.push(Object::Reference(document.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        })));
    }
    if filler > 0 {
        // Incompressible synthetic bytes.
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let bytes = (0..filler)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state as u8
            })
            .collect::<Vec<_>>();
        document.add_object(Stream::new(dictionary! {}, bytes));
    }
    if signed {
        document.add_object(dictionary! {
            "Type" => "Sig", "ByteRange" => vec![0.into(), 10.into(), 20.into(), 30.into()],
            "Contents" => Object::string_literal("00"),
        });
    }
    document.objects.insert(
        pages_id,
        Object::Dictionary(
            dictionary! {"Type" => "Pages", "Kids" => kids, "Count" => pages as i64},
        ),
    );
    let catalog = document.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages_id});
    document.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).unwrap();
    bytes
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, birth_date: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email, created_by)
           VALUES ($1, 'Erika', 'Beispiel', $2::date, 'diverse', $3, $4) RETURNING id"#,
    )
    .bind(format!("PT-SIG-{}", Uuid::new_v4().simple()))
    .bind(birth_date)
    .bind(format!("erika-{}@example.org", Uuid::new_v4().simple()))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("sigpkg-{}@example.com", Uuid::new_v4().simple()))
    .bind(format!("Signature {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

struct Doc<'a> {
    template: &'a str,
    pages: usize,
    visibility: &'a str,
    anchors: Value,
}

impl<'a> Doc<'a> {
    fn new(template: &'a str, pages: usize) -> Self {
        Self {
            template,
            pages,
            visibility: "patient_visible",
            anchors: json!([]),
        }
    }
    fn anchors(mut self, anchors: Value) -> Self {
        self.anchors = anchors;
        self
    }
    fn visibility(mut self, visibility: &'a str) -> Self {
        self.visibility = visibility;
        self
    }
}

fn anchor(role: &str, page: usize) -> Value {
    json!({"role":role,"page":page,"x_mm":25.0,"y_mm":40.0,"width_mm":60.0,"height_mm":10.5})
}

/// Uploads a PDF for the patient and marks it as a generated document.
async fn upload(env: &Env, patient_id: Uuid, doc: Doc<'_>) -> Uuid {
    upload_bytes(
        env,
        patient_id,
        doc.template,
        &pdf(doc.pages, 0, false),
        doc.visibility,
        doc.anchors,
    )
    .await
}

async fn upload_bytes(
    env: &Env,
    patient_id: Uuid,
    template: &str,
    bytes: &[u8],
    visibility: &str,
    anchors: Value,
) -> Uuid {
    let boundary = format!("----gmed-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    for (name, value) in [
        ("patient_id", patient_id.to_string()),
        ("auto_name", format!("Fixture {template}")),
        ("art", "uploaded_document".to_string()),
        ("category", "contract".to_string()),
        ("status", "active".to_string()),
        ("visibility", "internal".to_string()),
        ("is_medical", "false".to_string()),
    ] {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{template}.pdf\"\r\nContent-Type: application/pdf\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/documents/upload")
        .header("Authorization", &env.ceo)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = env.app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    assert_eq!(status, StatusCode::OK, "upload {template}: {value}");
    let id = Uuid::parse_str(value["id"].as_str().unwrap()).unwrap();
    sqlx::query(
        "UPDATE documents SET generated_template_id=$2, art=$3, visibility=$4, is_medical=false,
                generated_bindings=jsonb_build_object('_signature_anchors', $5::jsonb)
         WHERE id=$1",
    )
    .bind(id)
    .bind(template)
    .bind(match template {
        "privacy_consents" => "consent",
        "consent_data_release_child" => "consent_data_release",
        other => other,
    })
    .bind(visibility)
    .bind(anchors)
    .execute(&env.pool)
    .await
    .unwrap();
    id
}

fn signer(first: &str, email: &str, role: &str) -> Value {
    json!({"first_name":first,"last_name":"Beispiel","email":email,"role":role})
}

fn both_parties() -> Value {
    json!([
        signer("Erika", "erika@example.org", "client"),
        signer("Max", "max@example.org", "agency")
    ])
}

async fn status_of(pool: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Waits for the background creation, reconciles attachments, until pending.
async fn until_pending(env: &Env, id: Uuid) {
    for _ in 0..200 {
        match status_of(&env.pool, id).await.as_str() {
            "pending" => return,
            "submission_unknown" => {
                poll_request_now(&env.state, id).await.unwrap();
            }
            "submitting" => {}
            other => panic!("request {id} reached {other}"),
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("request {id} did not become pending");
}

async fn send_package(env: &Env, body: Value) -> Uuid {
    let (status, value) = call(
        &env.app,
        "POST",
        "/api/v1/signature-packages",
        &env.ceo,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{value}");
    Uuid::parse_str(value["id"].as_str().unwrap()).unwrap()
}

/// Notifications of one kind for the requesting staff member (every CEO gets one too).
async fn notified(env: &Env, kind: &str, entity: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE kind=$1 AND entity_id=$2 AND user_id=$3",
    )
    .bind(kind)
    .bind(entity)
    .bind(env.admin_id)
    .fetch_one(&env.pool)
    .await
    .unwrap()
}

async fn count(pool: &PgPool, sql: &str, id: Uuid) -> i64 {
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ---------------------------------------------------------------- tests

#[tokio::test]
async fn package_is_signed_once_and_members_link_to_the_canonical_bundle() {
    let Some(env) = env().await else { return };
    let patient = seed_patient(&env.pool, env.admin_id, "1980-05-01").await;
    let contract_id: Uuid = sqlx::query_scalar(
        "INSERT INTO framework_contracts (patient_id, contract_number, status, created_by)
         VALUES ($1, $2, 'sent', $3) RETURNING id",
    )
    .bind(patient)
    .bind(format!("RV-SIG-{}", Uuid::new_v4().simple()))
    .bind(env.admin_id)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        "INSERT INTO orders (order_number, patient_id, phase, status, created_by, contract_id)
         VALUES ($1, $2, 'execution', 'active', $3, $4) RETURNING id",
    )
    .bind(format!("ORD-SIG-{}", Uuid::new_v4().simple()))
    .bind(patient)
    .bind(env.admin_id)
    .bind(contract_id)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let contract = upload(
        &env,
        patient,
        Doc::new("framework_contract", 2)
            .anchors(json!([anchor("client", 1), anchor("agency", 1)])),
    )
    .await;
    let order = upload(
        &env,
        patient,
        Doc::new("single_order", 3)
            .anchors(json!([anchor("client", 2), anchor("agency", 2)]))
            .visibility("internal"),
    )
    .await;
    sqlx::query("UPDATE documents SET order_id=$2 WHERE id=$1")
        .bind(order)
        .bind(order_id)
        .execute(&env.pool)
        .await
        .unwrap();
    let release = upload(
        &env,
        patient,
        Doc::new("confidentiality_release", 1).anchors(json!([anchor("client", 0)])),
    )
    .await;
    let consents = upload(&env, patient, Doc::new("privacy_consents", 1)).await;
    let information = upload(&env, patient, Doc::new("privacy_information", 1)).await;
    // A patient manager whose access to one member is denied must not see the bundle.
    let manager = seed_user(&env.pool, "patient_manager").await;
    sqlx::query("INSERT INTO staff_user_access_rules(user_id,granted_for_role,resource_type,scope_type,resource_id,capability,effect,reason,granted_by) VALUES ($1,'patient_manager','document','record',$2,'view','deny','package ACL test',$3)")
        .bind(manager).bind(order).bind(env.admin_id).execute(&env.pool).await.unwrap();

    let (status, candidates) = call(
        &env.app,
        "GET",
        &format!("/api/v1/signature-packages/candidates?document_id={contract}"),
        &env.ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{candidates}");
    let ids: Vec<&str> = candidates["documents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_str().unwrap())
        .collect();
    for id in [contract, order, release, consents] {
        assert!(
            ids.contains(&id.to_string().as_str()),
            "candidate {id} missing"
        );
    }
    assert!(
        !ids.contains(&information.to_string().as_str()),
        "informational documents are attachments"
    );
    assert_eq!(candidates["attachments"][0]["id"], information.to_string());
    let consent_candidate = candidates["documents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == consents.to_string())
        .unwrap();
    assert_eq!(consent_candidate["has_frames"], false);
    assert_eq!(consent_candidate["minimum_level"], "AES");

    let id = send_package(
        &env,
        json!({
            "document_ids": [contract, order, release, consents],
            "attachment_ids": [information],
            "signers": both_parties(),
            "message": "Bitte bis Freitag unterschreiben.",
        }),
    )
    .await;
    until_pending(&env, id).await;

    // One invitation for the whole package with a generic subject and index.
    let payload = env.mock.payload(id);
    assert_eq!(
        payload["title"],
        format!("Dokumente zur Unterschrift – GMED · {id}")
    );
    assert_eq!(payload["quality"], "QES");
    let message = payload["message"].as_str().unwrap();
    assert!(
        message.contains("1. Rahmenvertrag (Seiten 1–2)"),
        "{message}"
    );
    assert!(
        message.contains("2. Einzelauftrag (Seiten 3–5)"),
        "{message}"
    );
    assert!(
        message.contains("4. Einwilligungserklärung (Seite 7)"),
        "{message}"
    );
    assert!(message.contains("– Datenschutzinformation"), "{message}");
    assert!(
        !message.contains("Erika"),
        "no personal data in the invitation text"
    );
    let members: Vec<(i32, i32)> = sqlx::query("SELECT page_start, page_count FROM document_signature_members WHERE request_id=$1 ORDER BY position")
        .bind(id).fetch_all(&env.pool).await.unwrap().iter().map(|r| (r.get(0), r.get(1))).collect();
    assert_eq!(members, vec![(3, 3), (6, 1), (7, 1)]);

    // While out for signature, no member may be versioned or archived, nor sent again.
    let (status, body) = call(
        &env.app,
        "POST",
        &format!("/api/v1/documents/{release}/update"),
        &env.ceo,
        Some(json!({"status":"archived"})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "signature_pending");
    let (status, body) = call(
        &env.app,
        "POST",
        "/api/v1/signature-packages",
        &env.ceo,
        Some(json!({
            "document_ids": [consents], "signers": [signer("Erika", "erika@example.org", "client")],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "signature_already_pending");
    assert_eq!(body["document_ids"][0], consents.to_string());

    // The panel of any member shows the whole package.
    let (status, state) = call(
        &env.app,
        "GET",
        &format!("/api/v1/documents/{consents}/signature-requests"),
        &env.ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let request = &state["requests"][0];
    assert_eq!(request["members"].as_array().unwrap().len(), 4);
    assert_eq!(request["members"][3]["page_start"], 7);
    assert_eq!(
        request["attachments"][0]["document_id"],
        information.to_string()
    );

    env.mock.set_status(id, "SIGNED");
    assert!(poll_request_now(&env.state, id).await.unwrap());
    assert_eq!(status_of(&env.pool, id).await, "completed");

    // One canonical bundle; no per-member copies, no new versions.
    let result: Uuid = sqlx::query_scalar(
        "SELECT result_document_id FROM document_signature_requests WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let bundle = sqlx::query("SELECT * FROM documents WHERE id=$1")
        .bind(result)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(
        bundle.get::<String, _>("ursprung"),
        "electronic_signature_package"
    );
    assert_eq!(bundle.get::<String, _>("art"), "signed_document_package");
    assert_eq!(
        bundle.get::<String, _>("visibility"),
        "internal",
        "one member is internal"
    );
    assert_eq!(bundle.get::<Option<Uuid>, _>("patient_id"), Some(patient));
    assert_eq!(count(&env.pool, "SELECT count(*) FROM documents WHERE patient_id=$1 AND ursprung LIKE 'electronic_signature%'", patient).await, 1);
    for member in [contract, order, release, consents] {
        assert_eq!(
            count(
                &env.pool,
                "SELECT count(*) FROM documents WHERE replaces_document_id=$1",
                member
            )
            .await,
            0
        );
        let signed: Option<chrono::DateTime<chrono::Utc>> =
            sqlx::query_scalar("SELECT signed_at FROM documents WHERE id=$1")
                .bind(member)
                .fetch_one(&env.pool)
                .await
                .unwrap();
        assert!(signed.is_some(), "member {member} is marked signed");
    }
    assert_eq!(count(&env.pool, "SELECT count(*) FROM document_signature_members WHERE request_id=$1 AND result_document_id IS NOT NULL", id).await, 3);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT effect FROM staff_user_access_rules WHERE resource_id=$1 AND user_id=$2 AND capability='view'")
            .bind(result).bind(manager).fetch_one(&env.pool).await.unwrap(),
        "deny"
    );

    // Business effects in the same transaction.
    let contract_row = sqlx::query("SELECT status, signed_at FROM framework_contracts WHERE id=$1")
        .bind(contract_id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(contract_row.get::<String, _>("status"), "signed");
    let order_row =
        sqlx::query("SELECT signed_patient, signed_agency, signed_at FROM orders WHERE id=$1")
            .bind(order_id)
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert!(
        order_row.get::<bool, _>("signed_patient") && order_row.get::<bool, _>("signed_agency")
    );
    let consent_types: Vec<String> = sqlx::query_scalar("SELECT consent_type FROM consent_records WHERE patient_id=$1 AND context->>'source'='electronic_signature' ORDER BY consent_type")
        .bind(patient).fetch_all(&env.pool).await.unwrap();
    assert_eq!(
        consent_types,
        [
            "dsgvo_data_transfer",
            "schweigepflicht_release",
            "treatment_contract"
        ]
    );
    let evidence: Value = sqlx::query_scalar("SELECT context FROM consent_records WHERE patient_id=$1 AND consent_type='dsgvo_data_transfer'")
        .bind(patient).fetch_one(&env.pool).await.unwrap();
    assert_eq!(evidence["level"], "QES");
    assert_eq!(evidence["signature_request_id"], id.to_string());
    assert_eq!(evidence["signers"][0]["email"], "erika@example.org");
    let kinds: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT compliance_kind FROM documents WHERE id = ANY($1) ORDER BY compliance_kind",
    )
    .bind(vec![contract, release, consents])
    .fetch_all(&env.pool)
    .await
    .unwrap();
    assert_eq!(
        kinds,
        [
            Some("confidentiality_release".into()),
            Some("dsgvo".into()),
            Some("framework_contract".into())
        ]
    );

    // Audit: one row per document, written with the business change.
    assert_eq!(count(&env.pool, "SELECT count(*) FROM audit_log WHERE action='document_signature_requested' AND context->>'request_id'=$1::text", id).await, 5);
    assert_eq!(count(&env.pool, "SELECT count(*) FROM audit_log WHERE action='document_signature_effects_applied' AND context->>'request_id'=$1::text", id).await, 4);
    assert_eq!(notified(&env, "signature_completed", result).await, 1);

    // The signed bundle and its evidence are immutable.
    assert!(
        sqlx::query("UPDATE documents SET storage_key='tampered' WHERE id=$1")
            .bind(result)
            .execute(&env.pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE documents SET file_deleted_at=now() WHERE id=$1")
            .bind(result)
            .execute(&env.pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM documents WHERE id=$1")
            .bind(result)
            .execute(&env.pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query(
            "UPDATE document_signature_requests SET report_storage_key='tampered' WHERE id=$1"
        )
        .bind(id)
        .execute(&env.pool)
        .await
        .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM document_signature_requests WHERE id=$1")
            .bind(id)
            .execute(&env.pool)
            .await
            .is_err()
    );
    sqlx::query("UPDATE documents SET auto_name='Renamed package' WHERE id=$1")
        .bind(result)
        .execute(&env.pool)
        .await
        .expect("metadata stays editable");
    // Test (DEMO) evidence has no legal value and stays erasable.
    let demo_result = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,patient_id,auto_name,art,mime_type,storage_key,version_root_document_id,uploaded_by,ursprung) VALUES ($1,$2,'TEST – Evidence','signature_evidence','application/pdf','demo-key',$1,$3,'electronic_signature')")
        .bind(demo_result).bind(patient).bind(env.admin_id).execute(&env.pool).await.unwrap();
    sqlx::query("INSERT INTO document_signature_requests(id,source_document_id,requested_by,source_sha256,source_context,signers,provider_account,test_mode,status,result_document_id,report_storage_key,report_sha256,signed_sha256) VALUES ($1,$2,$3,'h','{}','[]','demo',true,'completed',$4,'r','r','s')")
        .bind(Uuid::new_v4()).bind(contract).bind(env.admin_id).bind(demo_result).execute(&env.pool).await.unwrap();
    sqlx::query("UPDATE documents SET storage_key=NULL, file_deleted_at=now() WHERE id=$1")
        .bind(demo_result)
        .execute(&env.pool)
        .await
        .expect("test evidence can be erased");

    // § 312f BGB: staff record how the signers got their copy.
    let (status, body) = call(
        &env.app,
        "POST",
        &format!("/api/v1/document-signature-requests/{id}/delivered"),
        &env.ceo,
        Some(json!({"channel":"skribble"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _) = call(
        &env.app,
        "POST",
        &format!("/api/v1/document-signature-requests/{id}/delivered"),
        &env.ceo,
        Some(json!({"channel":"email"})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "recorded once");

    // Retention at the provider stays off by default, then deletes archived requests.
    assert_eq!(
        retention::delete_archived_at_provider(&env.state)
            .await
            .unwrap(),
        0
    );
    sqlx::query("UPDATE system_settings SET value='true'::jsonb WHERE key='signature_provider_deletion_enabled'").execute(&env.pool).await.unwrap();
    sqlx::query(
        "UPDATE document_signature_requests SET updated_at=now()-interval '40 days' WHERE id=$1",
    )
    .bind(id)
    .execute(&env.pool)
    .await
    .unwrap();
    assert_eq!(
        retention::delete_archived_at_provider(&env.state)
            .await
            .unwrap(),
        1
    );
    assert_eq!(env.mock.deletions.lock().unwrap().len(), 1);
    assert_eq!(count(&env.pool, "SELECT count(*) FROM document_signature_requests WHERE id=$1 AND provider_deleted_at IS NOT NULL", id).await, 1);
}

#[tokio::test]
async fn review_accept_promotes_and_storage_errors_are_retried() {
    let Some(env) = env().await else { return };
    let patient = seed_patient(&env.pool, env.admin_id, "1975-02-03").await;
    let release = upload(
        &env,
        patient,
        Doc::new("confidentiality_release", 1).anchors(json!([anchor("client", 0)])),
    )
    .await;
    let consents = upload(&env, patient, Doc::new("privacy_consents", 2)).await;
    let information = upload(&env, patient, Doc::new("privacy_information", 1)).await;
    let client = json!([signer("Erika", "erika@example.org", "client")]);

    // AES is allowed for consents.
    let id = send_package(&env, json!({"document_ids":[release, consents],"attachment_ids":[information],"signers":client,"level":"AES"})).await;
    until_pending(&env, id).await;
    assert_eq!(env.mock.payload(id)["quality"], "AES");
    env.mock.set_status(id, "SIGNED");

    // A storage read error while archiving is transient: retried, not review.
    let key: String = sqlx::query_scalar("SELECT storage_key FROM documents WHERE id=$1")
        .bind(consents)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    let path = std::path::Path::new("uploads/documents").join(&key);
    let hidden = path.with_extension("hidden");
    std::fs::rename(&path, &hidden).unwrap();
    poll_request_now(&env.state, id).await.unwrap();
    let row = sqlx::query("SELECT status, last_error, result_document_id FROM document_signature_requests WHERE id=$1").bind(id).fetch_one(&env.pool).await.unwrap();
    std::fs::rename(&hidden, &path).unwrap();
    assert_eq!(row.get::<String, _>("status"), "pending");
    assert_eq!(
        row.get::<Option<String>, _>("last_error").as_deref(),
        Some("signature_storage_read_error")
    );
    assert!(row.get::<Option<Uuid>, _>("result_document_id").is_none());
    poll_request_now(&env.state, id).await.unwrap();
    assert_eq!(status_of(&env.pool, id).await, "completed");
    let consent: Value = sqlx::query_scalar("SELECT context FROM consent_records WHERE patient_id=$1 AND consent_type='dsgvo_data_transfer' AND revoked_at IS NULL")
        .bind(patient).fetch_one(&env.pool).await.unwrap();
    assert_eq!(consent["level"], "AES");

    // A member that changed during signing parks the result in review.
    let second = seed_patient(&env.pool, env.admin_id, "1975-02-03").await;
    let release = upload(&env, second, Doc::new("confidentiality_release", 1)).await;
    let consents = upload(&env, second, Doc::new("privacy_consents", 1)).await;
    let information = upload(&env, second, Doc::new("privacy_information", 1)).await;
    let id = send_package(
        &env,
        json!({"document_ids":[release, consents],"attachment_ids":[information],"signers":client}),
    )
    .await;
    until_pending(&env, id).await;
    // Simulates a change that bypassed the guard (e.g. a direct correction).
    sqlx::query("INSERT INTO documents(id,patient_id,auto_name,art,mime_type,storage_key,version_root_document_id,replaces_document_id,version_number,uploaded_by) SELECT gen_random_uuid(),patient_id,'Replacement',art,mime_type,storage_key,version_root_document_id,id,2,uploaded_by FROM documents WHERE id=$1")
        .bind(consents).execute(&env.pool).await.unwrap();
    env.mock.set_status(id, "SIGNED");
    poll_request_now(&env.state, id).await.unwrap();
    assert_eq!(status_of(&env.pool, id).await, "needs_review");
    let result: Uuid = sqlx::query_scalar(
        "SELECT result_document_id FROM document_signature_requests WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT art FROM documents WHERE id=$1")
            .bind(result)
            .fetch_one(&env.pool)
            .await
            .unwrap(),
        "signature_evidence"
    );
    assert_eq!(
        count(
            &env.pool,
            "SELECT count(*) FROM consent_records WHERE patient_id=$1",
            second
        )
        .await,
        0,
        "no effects while in review"
    );
    assert_eq!(notified(&env, "signature_review_required", result).await, 1);

    let (status, body) = call(
        &env.app,
        "POST",
        &format!("/api/v1/document-signature-requests/{id}/resolve-review"),
        &env.ceo,
        Some(json!({"decision":"accept","reason":"Only the file name of the copy changed"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let bundle = sqlx::query("SELECT art, auto_name FROM documents WHERE id=$1")
        .bind(result)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(bundle.get::<String, _>("art"), "signed_document_package");
    assert!(!bundle.get::<String, _>("auto_name").starts_with("Prüfung"));
    assert_eq!(count(&env.pool, "SELECT count(*) FROM consent_records WHERE patient_id=$1 AND context->>'source'='electronic_signature'", second).await, 2);
    assert_eq!(count(&env.pool, "SELECT count(*) FROM documents WHERE id IN (SELECT document_id FROM document_signature_members WHERE request_id=$1) AND signed_at IS NOT NULL", id).await, 1);
    assert_eq!(count(&env.pool, "SELECT count(*) FROM audit_log WHERE action='document_signature_review_resolved' AND context->>'request_id'=$1::text", id).await, 2);
}

#[tokio::test]
async fn withdrawal_creates_no_consent_and_staff_are_notified() {
    let Some(env) = env().await else { return };
    let patient = seed_patient(&env.pool, env.admin_id, "1970-01-01").await;
    let release = upload(&env, patient, Doc::new("confidentiality_release", 1)).await;
    let consents = upload(&env, patient, Doc::new("privacy_consents", 1)).await;
    let information = upload(&env, patient, Doc::new("privacy_information", 1)).await;
    let id = send_package(&env, json!({"document_ids":[release, consents],"attachment_ids":[information],"signers":[signer("Erika", "erika@example.org", "client")]})).await;
    until_pending(&env, id).await;
    let (status, body) = call(
        &env.app,
        "POST",
        &format!("/api/v1/document-signature-requests/{id}/withdraw"),
        &env.ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for _ in 0..100 {
        if status_of(&env.pool, id).await == "withdrawn" {
            break;
        }
        poll_request_now(&env.state, id).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(status_of(&env.pool, id).await, "withdrawn");
    assert_eq!(
        count(
            &env.pool,
            "SELECT count(*) FROM consent_records WHERE patient_id=$1",
            patient
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &env.pool,
            "SELECT count(*) FROM documents WHERE patient_id=$1 AND signed_at IS NOT NULL",
            patient
        )
        .await,
        0
    );
    assert_eq!(count(&env.pool, "SELECT count(*) FROM audit_log WHERE action='document_signature_withdrawn' AND context->>'request_id'=$1::text", id).await, 2);
    assert_eq!(count(&env.pool, "SELECT count(*) FROM audit_log WHERE action='document_signature_status_changed' AND context->>'request_id'=$1::text", id).await, 2);
    assert_eq!(notified(&env, "signature_request_closed", release).await, 1);

    // Abandoning a request the provider knows withdraws it there first.
    let id = send_package(&env, json!({"document_ids":[release, consents],"attachment_ids":[information],"signers":[signer("Erika", "erika@example.org", "client")]})).await;
    until_pending(&env, id).await;
    sqlx::query(
        "UPDATE document_signature_requests SET last_error='provider_unavailable' WHERE id=$1",
    )
    .bind(id)
    .execute(&env.pool)
    .await
    .unwrap();
    let before = env.mock.withdrawals.lock().unwrap().len();
    let (status, body) = call(
        &env.app,
        "POST",
        &format!("/api/v1/document-signature-requests/{id}/abandon"),
        &env.ceo,
        Some(json!({"reason":"Provider kept failing for days"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["withdrawn_at_provider"], true);
    assert_eq!(env.mock.withdrawals.lock().unwrap().len(), before + 1);
    assert_eq!(status_of(&env.pool, id).await, "error");
    assert_eq!(
        count(
            &env.pool,
            "SELECT count(*) FROM consent_records WHERE patient_id=$1",
            patient
        )
        .await,
        0
    );
}

#[tokio::test]
async fn package_validation_matrix_and_rbac() {
    let Some(env) = env().await else { return };
    let patient = seed_patient(&env.pool, env.admin_id, "1985-07-07").await;
    let other = seed_patient(&env.pool, env.admin_id, "1985-07-07").await;
    let contract = upload(&env, patient, Doc::new("framework_contract", 1)).await;
    let consents = upload(&env, patient, Doc::new("privacy_consents", 1)).await;
    let information = upload(&env, patient, Doc::new("privacy_information", 1)).await;
    let foreign = upload(&env, other, Doc::new("privacy_consents", 1)).await;
    let aml = upload(&env, patient, Doc::new("enhanced_due_diligence", 1)).await;
    let surety = upload(&env, patient, Doc::new("buergschaft", 1)).await;
    let signed = upload_bytes(
        &env,
        patient,
        "privacy_consents",
        &pdf(1, 0, true),
        "patient_visible",
        json!([]),
    )
    .await;
    let client = json!([signer("Erika", "erika@example.org", "client")]);
    let post = |body: Value| {
        call(
            &env.app,
            "POST",
            "/api/v1/signature-packages",
            &env.ceo,
            Some(body),
        )
    };

    for (body, code) in [
        (
            json!({"document_ids":[consents, foreign],"signers":client}),
            "signature_package_scope_mismatch",
        ),
        (
            json!({"document_ids":[consents, consents],"signers":client}),
            "duplicate_signing_document",
        ),
        (
            json!({"document_ids":[consents, information],"signers":client}),
            "informational_document_not_signable",
        ),
        (
            json!({"document_ids":[surety],"signers":both_parties()}),
            "electronic_form_excluded",
        ),
        (
            json!({"document_ids":[contract, consents],"attachment_ids":[information],"signers":both_parties(),"level":"AES"}),
            "signature_level_too_low",
        ),
        (
            json!({"document_ids":[consents],"signers":both_parties()}),
            "patient_signature_only",
        ),
        (
            json!({"document_ids":[contract],"attachment_ids":[information],"signers":client}),
            "both_contract_parties_required",
        ),
        (
            json!({"document_ids":[aml, consents],"signers":client}),
            "signature_policy_conflict",
        ),
        (
            json!({"document_ids":[contract],"signers":both_parties()}),
            "review_attachment_required",
        ),
        (
            json!({"document_ids":[signed],"signers":client}),
            "signature_pdf_already_signed",
        ),
        (
            json!({"document_ids":[consents],"signers":[signer("Kid", "kid@example.org", "minor")]}),
            "minor_needs_representative",
        ),
        (
            json!({"document_ids":[consents],"signers":client,"expires_at":"2020-01-01T00:00:00Z"}),
            "signature_expiry_invalid",
        ),
        (
            json!({"document_ids":[consents],"signers":client,"language":"ru"}),
            "signature_language_invalid",
        ),
        (
            json!({"document_ids":(0..11).map(|_| Uuid::new_v4()).collect::<Vec<_>>(),"signers":client}),
            "signature_package_size",
        ),
    ] {
        let (status, value) = post(body).await;
        assert!(status.is_client_error(), "{code}: {status} {value}");
        assert_eq!(value["error"], code, "{value}");
    }
    let (_, value) = post(json!({"document_ids":[surety],"signers":both_parties()})).await;
    assert_eq!(value["statute"], "§ 766 S. 2 BGB");

    // The Kostenübernehmer signs the cost coverage declaration in its own frame.
    let coverage = upload(
        &env,
        patient,
        Doc::new("cost_coverage_declaration", 1)
            .anchors(json!([anchor("payer", 0), anchor("agency", 0)])),
    )
    .await;
    let (status, value) = post(json!({"document_ids":[coverage],"signers":both_parties()})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(value["error"], "payer_and_agency_required");
    let (status, value) = post(json!({"document_ids":[coverage],"level":"AES","signers":[
        signer("Paul", "payer@example.org", "payer"), signer("Max", "max@example.org", "agency")]}))
    .await;
    assert_eq!(value["error"], "signature_level_too_low", "{status}");
    let id = send_package(
        &env,
        json!({"document_ids":[coverage],"signers":[
            signer("Paul", "payer@example.org", "payer"), signer("Max", "max@example.org", "agency")]}),
    )
    .await;
    until_pending(&env, id).await;
    let payload = env.mock.payload(id);
    let payer_entry = payload["signatures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["signer_identity_data"]["email_address"] == "payer@example.org")
        .unwrap()
        .clone();
    assert_eq!(payer_entry["sequence"], 1);
    assert_eq!(
        payer_entry["visual_signature"]["positions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // Total size: the merged PDF may not exceed 18 MB.
    let big_a = upload_bytes(
        &env,
        patient,
        "privacy_consents",
        &pdf(1, 9_800_000, false),
        "internal",
        json!([]),
    )
    .await;
    let big_b = upload_bytes(
        &env,
        patient,
        "confidentiality_release",
        &pdf(1, 9_800_000, false),
        "internal",
        json!([]),
    )
    .await;
    let (status, value) = post(
        json!({"document_ids":[big_a, big_b],"attachment_ids":[information],"signers":client}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{value}");
    assert_eq!(value["error"], "signature_bundle_too_large");

    // RBAC: other roles never send; a patient manager needs the patient assignment.
    let billing = seed_user(&env.pool, "billing").await;
    let (status, _) = call(
        &env.app,
        "POST",
        "/api/v1/signature-packages",
        &bearer(billing, "billing"),
        Some(json!({"document_ids":[consents],"signers":client})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &env.app,
        "GET",
        &format!("/api/v1/signature-packages/candidates?patient_id={patient}"),
        &bearer(billing, "billing"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let manager = seed_user(&env.pool, "patient_manager").await;
    let manager_auth = bearer(manager, "patient_manager");
    let (status, _) = call(
        &env.app,
        "POST",
        "/api/v1/signature-packages",
        &manager_auth,
        Some(json!({"document_ids":[consents],"signers":client})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient)
    .bind(manager)
    .bind(env.admin_id)
    .execute(&env.pool)
    .await
    .unwrap();
    let (status, value) = call(
        &env.app,
        "POST",
        "/api/v1/signature-packages",
        &manager_auth,
        Some(json!({"document_ids":[consents],"signers":client})),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{value}");
}

#[tokio::test]
async fn minor_lead_package_uses_the_guardians_declaration_and_both_guardians() {
    let Some(env) = env().await else { return };
    let holder = seed_patient(&env.pool, env.admin_id, "1990-01-01").await;
    let lead: Uuid = sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, date_of_birth, email, trusted_contacts, created_by)
         VALUES ('Kind', 'Beispiel', (current_date - interval '10 years')::date, 'kind@example.org', $1, $2) RETURNING id",
    )
    .bind(json!([
        {"name":"Anna Beispiel","email":"anna@example.org","relation":"Mutter"},
        {"name":"Bernd Beispiel","email":"bernd@example.org","relation":"Vater"}
    ]))
    .bind(env.admin_id)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let mut ids = Vec::new();
    for doc in [
        Doc::new("framework_contract", 1)
            .anchors(json!([anchor("client", 0), anchor("agency", 0)])),
        Doc::new("single_order", 1),
        Doc::new("consent_data_release_child", 1)
            .anchors(json!([anchor("guardian_1", 0), anchor("guardian_2", 0)])),
        Doc::new("privacy_information", 1),
    ] {
        ids.push(upload(&env, holder, doc).await);
    }
    sqlx::query("UPDATE documents SET patient_id=NULL, lead_id=$2 WHERE id = ANY($1)")
        .bind(&ids)
        .bind(lead)
        .execute(&env.pool)
        .await
        .unwrap();
    let (contract, order, child, information) = (ids[0], ids[1], ids[2], ids[3]);

    let (status, candidates) = call(
        &env.app,
        "GET",
        &format!("/api/v1/signature-packages/candidates?document_id={contract}"),
        &env.ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{candidates}");
    assert_eq!(candidates["preset_document_ids"], json!([order, child]));
    let guardians: Vec<&str> = candidates["suggested_signers"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["role"] == "client")
        .map(|s| s["email"].as_str().unwrap())
        .collect();
    assert_eq!(guardians, ["anna@example.org", "bernd@example.org"]);

    // The legacy endpoint accepts the minors' preset.
    let signers = json!([
        signer("Anna", "anna@example.org", "client"),
        signer("Bernd", "bernd@example.org", "client"),
        signer("Kind", "kind@example.org", "minor"),
        signer("Max", "max@example.org", "agency"),
    ]);
    let (status, value) = call(&env.app, "POST", &format!("/api/v1/documents/{contract}/signature-requests"), &env.ceo, Some(json!({
        "signers": signers, "attachment_document_id": information, "signing_document_ids": [child, order],
    }))).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{value}");
    let id = Uuid::parse_str(value["id"].as_str().unwrap()).unwrap();
    until_pending(&env, id).await;
    // No two signers share a frame: the second guardian signs guardian_2 only.
    let put: Vec<Value> = env
        .mock
        .requests
        .lock()
        .unwrap()
        .values()
        .filter(|v| v["custom"].as_str().unwrap().contains(&id.to_string()))
        .cloned()
        .collect();
    assert_eq!(put.len(), 1);
    let created = sqlx::query_scalar::<_, Value>(
        "SELECT signers FROM document_signature_requests WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let frames = |index: usize| created[index]["positions"].as_array().map_or(0, Vec::len);
    assert_eq!(
        frames(0),
        2,
        "first guardian: contract client frame and guardian_1"
    );
    assert_eq!(frames(1), 1, "second guardian: guardian_2 only");
    assert_eq!(frames(2), 0, "the minor has no generated frame");
    assert_eq!(frames(3), 1, "agency frame");
    env.mock.set_status(id, "SIGNED");
    poll_request_now(&env.state, id).await.unwrap();
    assert_eq!(status_of(&env.pool, id).await, "completed");
    let compliance: String = sqlx::query_scalar("SELECT compliance_status FROM leads WHERE id=$1")
        .bind(lead)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(compliance, "signed");
}
