//! Integration tests for the Chat / Direct Messages API.
//!
//! Covers: conversations, send/receive, mark-read, unread count,
//!         file upload, file download, RBAC, edge cases.
//!
//! Provisions a temporary PostgreSQL database per suite and drops it on teardown.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

struct TestApp {
    suite: support::TestSuiteContext,
    ceo_id: Uuid,
    ceo_assistant_id: Uuid,
    patient_manager_id: Uuid,
    interpreter_id: Uuid,
    billing_id: Uuid,
    concierge_id: Uuid,
    it_admin_id: Uuid,
    sales_id: Uuid,
}

impl std::ops::Deref for TestApp {
    type Target = axum::Router;

    fn deref(&self) -> &Self::Target {
        &self.suite.app
    }
}

impl TestApp {
    fn router(&self) -> axum::Router {
        self.suite.app.clone()
    }

    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }

    fn auth_header(&self, role: &str) -> String {
        let user_id = match role {
            "ceo" => self.ceo_id,
            "ceo_assistant" => self.ceo_assistant_id,
            "patient_manager" => self.patient_manager_id,
            "interpreter" => self.interpreter_id,
            "billing" => self.billing_id,
            "concierge" => self.concierge_id,
            "it_admin" => self.it_admin_id,
            "sales" => self.sales_id,
            other => panic!("unexpected test role: {other}"),
        };
        auth_header_with_id(role, user_id)
    }
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn test_app() -> Option<TestApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let ceo_id = seed_user(&suite.pool, "messages-api", "ceo").await;
    let ceo_assistant_id = seed_user(&suite.pool, "messages-api", "ceo_assistant").await;
    let patient_manager_id = seed_user(&suite.pool, "messages-api", "patient_manager").await;
    let interpreter_id = seed_user(&suite.pool, "messages-api", "interpreter").await;
    let billing_id = seed_user(&suite.pool, "messages-api", "billing").await;
    let concierge_id = seed_user(&suite.pool, "messages-api", "concierge").await;
    let it_admin_id = seed_user(&suite.pool, "messages-api", "it_admin").await;
    let sales_id = seed_user(&suite.pool, "messages-api", "sales").await;
    Some(TestApp {
        suite,
        ceo_id,
        ceo_assistant_id,
        patient_manager_id,
        interpreter_id,
        billing_id,
        concierge_id,
        it_admin_id,
        sales_id,
    })
}

fn auth_header_with_id(role: &str, user_id: uuid::Uuid) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, uuid::Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let body = match body {
        Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
        None => Body::empty(),
    };
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

/// Build a multipart body for file upload tests.
fn multipart_body(
    file_content: &[u8],
    filename: &str,
    mime: &str,
    message: Option<&str>,
) -> (String, Vec<u8>) {
    let boundary = "----TestBoundary7890";
    let mut body = Vec::new();

    // File field
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {mime}\r\n\r\n").as_bytes());
    body.extend_from_slice(file_content);
    body.extend_from_slice(b"\r\n");

    // Optional message field
    if let Some(msg) = message {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"message\"\r\n\r\n");
        body.extend_from_slice(msg.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let content_type = format!("multipart/form-data; boundary={boundary}");
    (content_type, body)
}

async fn multipart_request(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    file_content: &[u8],
    filename: &str,
    mime: &str,
    message: Option<&str>,
) -> (StatusCode, Value) {
    let (content_type, body) = multipart_body(file_content, filename, mime, message);
    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", &content_type)
        .body(Body::from(body))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

// ════════════════════════════════════════════════════════════════
// AUTH TESTS
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn conversations_requires_auth() {
    let Some(app) = test_app().await else { return };
    let req = Request::builder()
        .uri("/api/v1/messages/conversations")
        .body(Body::empty())
        .unwrap();
    let resp = app.router().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn send_message_requires_auth() {
    let Some(app) = test_app().await else { return };
    let peer = uuid::Uuid::new_v4();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/messages/{peer}"))
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"message":"hello"}"#))
        .unwrap();
    let resp = app.router().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unread_total_requires_auth() {
    let Some(app) = test_app().await else { return };
    let req = Request::builder()
        .uri("/api/v1/messages/unread-total")
        .body(Body::empty())
        .unwrap();
    let resp = app.router().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn upload_requires_auth() {
    let Some(app) = test_app().await else { return };
    let peer = uuid::Uuid::new_v4();
    let (content_type, body) = multipart_body(b"test", "test.txt", "text/plain", None);
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/messages/{peer}/upload"))
        .header("Content-Type", &content_type)
        .body(Body::from(body))
        .unwrap();
    let resp = app.router().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ════════════════════════════════════════════════════════════════
// RBAC — any authenticated role can chat
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn any_role_can_list_conversations() {
    let Some(app) = test_app().await else { return };
    for role in &[
        "ceo",
        "ceo_assistant",
        "patient_manager",
        "interpreter",
        "billing",
        "concierge",
        "it_admin",
    ] {
        let (status, body) = json_request(
            &app,
            "GET",
            "/api/v1/messages/conversations",
            &app.auth_header(role),
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "role {role} should access conversations"
        );
        assert!(body.is_array(), "role {role} should get array");
    }
}

#[tokio::test]
async fn any_role_can_check_unread() {
    let Some(app) = test_app().await else { return };
    for role in &["ceo", "interpreter", "billing", "concierge"] {
        let (status, body) = json_request(
            &app,
            "GET",
            "/api/v1/messages/unread-total",
            &app.auth_header(role),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "role {role} should access unread");
        assert!(body["count"].is_number());
    }
}

// ════════════════════════════════════════════════════════════════
// SEND & RECEIVE MESSAGES
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn send_and_receive_text_message() {
    let Some(app) = test_app().await else { return };

    let user_a = seed_user(app.pool(), &unique_tag("messages-send-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-send-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);
    let auth_b = auth_header_with_id("billing", user_b);

    // A sends message to B
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        Some(json!({"message": "Hello from A"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert!(body["id"].is_string());
    assert!(body["created_at"].is_string());

    // B reads conversation with A
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{user_a}"),
        &auth_b,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert!(!msgs.is_empty());
    assert_eq!(msgs[0]["message"], "Hello from A");
    assert_eq!(msgs[0]["from_user"], user_a.to_string());
    assert_eq!(msgs[0]["to_user"], user_b.to_string());
    assert_eq!(msgs[0]["is_read"], false);
}

#[tokio::test]
async fn send_empty_message_rejected() {
    let Some(app) = test_app().await else { return };
    let peer = seed_user(app.pool(), &unique_tag("messages-empty-peer"), "billing").await;
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{peer}"),
        &app.auth_header("ceo"),
        Some(json!({"message": ""})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn send_whitespace_only_message_rejected() {
    let Some(app) = test_app().await else { return };
    let peer = seed_user(app.pool(), &unique_tag("messages-empty-peer"), "billing").await;
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{peer}"),
        &app.auth_header("ceo"),
        Some(json!({"message": "   \n\t  "})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn bidirectional_conversation() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-bi-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-bi-b"), "interpreter").await;
    let auth_a = auth_header_with_id("ceo", user_a);
    let auth_b = auth_header_with_id("interpreter", user_b);

    // A -> B
    json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        Some(json!({"message": "ping"})),
    )
    .await;

    // B -> A
    json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_a}"),
        &auth_b,
        Some(json!({"message": "pong"})),
    )
    .await;

    // A sees both messages
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert!(msgs.len() >= 2);
    let texts: Vec<&str> = msgs.iter().filter_map(|m| m["message"].as_str()).collect();
    assert!(texts.contains(&"ping"));
    assert!(texts.contains(&"pong"));
}

#[tokio::test]
async fn conversation_limit_works() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-limit-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-limit-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    // Send 5 messages
    for i in 0..5 {
        json_request(
            &app,
            "POST",
            &format!("/api/v1/messages/{user_b}"),
            &auth_a,
            Some(json!({"message": format!("msg-{i}")})),
        )
        .await;
    }

    // Fetch with limit=2
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{user_b}?limit=2"),
        &auth_a,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 2);
}

// ════════════════════════════════════════════════════════════════
// MARK READ & UNREAD COUNT
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn mark_read_and_unread_count() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-read-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-read-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);
    let auth_b = auth_header_with_id("billing", user_b);

    // A sends 3 messages to B
    for i in 0..3 {
        json_request(
            &app,
            "POST",
            &format!("/api/v1/messages/{user_b}"),
            &auth_a,
            Some(json!({"message": format!("unread-{i}")})),
        )
        .await;
    }

    // B has unread > 0
    let (_, body) = json_request(&app, "GET", "/api/v1/messages/unread-total", &auth_b, None).await;
    assert!(body["count"].as_i64().unwrap() >= 3);

    // B marks conversation with A as read
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_a}/read"),
        &auth_b,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    // Messages from A should now be read
    let (_, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{user_a}"),
        &auth_b,
        None,
    )
    .await;
    let all_read = body
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["from_user"] == user_a.to_string())
        .all(|m| m["is_read"] == true);
    assert!(all_read, "all messages from A should be marked read");
}

// ════════════════════════════════════════════════════════════════
// CONVERSATIONS LIST
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn conversations_list_shows_peers() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-convos-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-convos-b"), "billing").await;
    let user_c = seed_user(app.pool(), &unique_tag("messages-convos-c"), "interpreter").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    // A -> B and A -> C
    json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        Some(json!({"message": "hi B"})),
    )
    .await;
    json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_c}"),
        &auth_a,
        Some(json!({"message": "hi C"})),
    )
    .await;

    let (status, body) =
        json_request(&app, "GET", "/api/v1/messages/conversations", &auth_a, None).await;
    assert_eq!(status, StatusCode::OK);
    // Should have at least 2 conversations
    let convos = body.as_array().unwrap();
    assert!(convos.len() >= 2);
    // Each conversation has required fields
    for c in convos {
        assert!(c["user_id"].is_string());
        assert!(c["last_message"].is_string());
        assert!(c["last_at"].is_string());
    }
}

#[tokio::test]
async fn empty_conversations_for_new_user() {
    let Some(app) = test_app().await else { return };
    let new_user = seed_user(app.pool(), &unique_tag("messages-empty-user"), "concierge").await;
    let auth = auth_header_with_id("concierge", new_user);
    let (status, body) =
        json_request(&app, "GET", "/api/v1/messages/conversations", &auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());
}

// ════════════════════════════════════════════════════════════════
// FILE UPLOAD
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn upload_file_with_message() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-upload-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-upload-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    let (status, body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{user_b}/upload"),
        &auth_a,
        b"%PDF-1.4\nHello PDF content",
        "report.pdf",
        "application/pdf",
        Some("Check this report"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert!(body["id"].is_string());
    assert!(body["attachment_key"].is_string());
    assert_eq!(body["attachment_filename"], "report.pdf");
    assert_eq!(body["attachment_mime"], "application/pdf");
    assert_eq!(body["attachment_size"], 26);
}

#[tokio::test]
async fn upload_file_without_message() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-upload-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-upload-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    let (status, body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{user_b}/upload"),
        &auth_a,
        &[0xFF, 0xD8, 0xFF, 0xE0, b'J', b'F', b'I', b'F'],
        "photo.jpg",
        "image/jpeg",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["attachment_filename"], "photo.jpg");
    assert_eq!(body["attachment_mime"], "image/jpeg");
}

#[tokio::test]
async fn uploaded_file_appears_in_conversation() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-uploaded-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-uploaded-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);
    let auth_b = auth_header_with_id("billing", user_b);

    // Upload file from A to B
    multipart_request(
        &app,
        &format!("/api/v1/messages/{user_b}/upload"),
        &auth_a,
        b"test content",
        "notes.txt",
        "text/plain",
        Some("See attached"),
    )
    .await;

    // B fetches conversation
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{user_a}"),
        &auth_b,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    let file_msg = msgs
        .iter()
        .find(|m| m["attachment_filename"] == "notes.txt")
        .expect("should find file message");
    assert_eq!(file_msg["message"], "See attached");
    assert_eq!(file_msg["attachment_mime"], "text/plain");
    assert!(file_msg["attachment_key"].is_string());
    assert!(file_msg["attachment_size"].as_i64().unwrap() > 0);
}

// ════════════════════════════════════════════════════════════════
// FILE DOWNLOAD
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn download_uploaded_file() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-download-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-download-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    let file_content = b"PK\x03\x04download-test-content-12345";

    // Upload
    let (_, upload_body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{user_b}/upload"),
        &auth_a,
        file_content,
        "download-test.zip",
        "application/zip",
        None,
    )
    .await;
    let file_key = upload_body["attachment_key"].as_str().unwrap();

    // Download by sender (A)
    let req = Request::builder()
        .uri(format!("/api/v1/messages/file/{file_key}"))
        .header("Authorization", &auth_a)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let ct = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(ct, "application/zip");

    let cd = resp
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cd.contains("download-test.zip"));

    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(bytes.as_ref(), file_content);
}

#[tokio::test]
async fn download_by_recipient_works() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-download-a"), "ceo").await;
    let user_b = seed_user(
        app.pool(),
        &unique_tag("messages-download-b"),
        "interpreter",
    )
    .await;
    let auth_a = auth_header_with_id("ceo", user_a);
    let auth_b = auth_header_with_id("interpreter", user_b);

    // A uploads to B
    let (_, upload_body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{user_b}/upload"),
        &auth_a,
        b"%PDF-1.4\nrecipient-can-download",
        "shared.pdf",
        "application/pdf",
        None,
    )
    .await;
    let file_key = upload_body["attachment_key"].as_str().unwrap();

    // B downloads
    let req = Request::builder()
        .uri(format!("/api/v1/messages/file/{file_key}"))
        .header("Authorization", &auth_b)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn download_by_non_participant_denied() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-download-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-download-b"), "billing").await;
    let user_c = seed_user(app.pool(), &unique_tag("messages-download-c"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);
    let auth_c = auth_header_with_id("billing", user_c);

    // A uploads to B
    let (_, upload_body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{user_b}/upload"),
        &auth_a,
        b"secret-data",
        "secret.doc",
        "application/msword",
        None,
    )
    .await;
    let file_key = upload_body["attachment_key"].as_str().unwrap();

    // C (not a participant) tries to download — should fail
    let req = Request::builder()
        .uri(format!("/api/v1/messages/file/{file_key}"))
        .header("Authorization", &auth_c)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn download_nonexistent_file_returns_404() {
    let Some(app) = test_app().await else { return };
    let req = Request::builder()
        .uri("/api/v1/messages/file/nonexistent-key-12345")
        .header("Authorization", &app.auth_header("ceo"))
        .body(Body::empty())
        .unwrap();
    let resp = app.router().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ════════════════════════════════════════════════════════════════
// EDGE CASES
// ════════════════════════════════════════════════════════════════

#[tokio::test]
async fn get_conversation_with_no_messages() {
    let Some(app) = test_app().await else { return };
    let me = seed_user(app.pool(), &unique_tag("messages-empty-me"), "ceo").await;
    let stranger = seed_user(app.pool(), &unique_tag("messages-empty-peer"), "billing").await;
    let auth = auth_header_with_id("ceo", me);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{stranger}"),
        &auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn mark_read_on_empty_conversation_ok() {
    let Some(app) = test_app().await else { return };
    let stranger = seed_user(app.pool(), &unique_tag("messages-empty-peer"), "billing").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{stranger}/read"),
        &app.auth_header("ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn send_long_message() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-long-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-long-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    let long_msg = "A".repeat(5000);
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        Some(json!({"message": long_msg})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn send_unicode_message() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-unicode-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-unicode-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    let unicode_msg = "Привет! 你好 مرحبا 🎉🇺🇦";
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        Some(json!({"message": unicode_msg})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify it round-trips correctly
    let (_, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        None,
    )
    .await;
    let msgs = body.as_array().unwrap();
    let found = msgs.iter().any(|m| m["message"] == unicode_msg);
    assert!(found, "unicode message should round-trip");
}

#[tokio::test]
async fn upload_various_file_types() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-types-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-types-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    let cases = vec![
        (
            "test.png",
            "image/png",
            vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
        ),
        (
            "document.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            vec![b'P', b'K', 0x03, 0x04],
        ),
        ("data.csv", "text/csv", b"col1,col2\n1,2\n".to_vec()),
        ("scan.pdf", "application/pdf", b"%PDF-1.4\nscan".to_vec()),
        (
            "archive.zip",
            "application/zip",
            vec![b'P', b'K', 0x03, 0x04],
        ),
    ];

    for (filename, mime, bytes) in cases {
        let (status, body) = multipart_request(
            &app,
            &format!("/api/v1/messages/{user_b}/upload"),
            &auth_a,
            &bytes,
            filename,
            mime,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "upload {filename} should succeed");
        assert_eq!(body["attachment_filename"], filename);
        assert_eq!(body["attachment_mime"], mime);
    }
}

#[tokio::test]
async fn messages_ordered_by_time_desc() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-order-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-order-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    for i in 0..5 {
        json_request(
            &app,
            "POST",
            &format!("/api/v1/messages/{user_b}"),
            &auth_a,
            Some(json!({"message": format!("order-{i}")})),
        )
        .await;
    }

    let (_, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        None,
    )
    .await;
    let msgs = body.as_array().unwrap();
    // API returns DESC — first message should be the newest
    assert_eq!(msgs[0]["message"], "order-4");
    assert_eq!(msgs[4]["message"], "order-0");
}

#[tokio::test]
async fn unread_count_zero_for_sender() {
    let Some(app) = test_app().await else { return };
    let user_a = seed_user(app.pool(), &unique_tag("messages-unread-a"), "ceo").await;
    let user_b = seed_user(app.pool(), &unique_tag("messages-unread-b"), "billing").await;
    let auth_a = auth_header_with_id("ceo", user_a);

    // A sends to B — A's unread should not increase
    let (_, before) =
        json_request(&app, "GET", "/api/v1/messages/unread-total", &auth_a, None).await;
    let before_count = before["count"].as_i64().unwrap();

    json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{user_b}"),
        &auth_a,
        Some(json!({"message": "self-unread-test"})),
    )
    .await;

    let (_, after) =
        json_request(&app, "GET", "/api/v1/messages/unread-total", &auth_a, None).await;
    assert_eq!(
        after["count"].as_i64().unwrap(),
        before_count,
        "sender's unread count should not change"
    );
}
