//! Integration tests for e-mailing a lead's sign-in data through Mittaro
//! (owner decision 2026-10-05). A local stand-in for the Mittaro API records
//! what would have been sent. Synthetic data only.

mod support;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::routing::post;
use axum::{Extension, Router};
use secrecy::SecretString;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::config::MailConfig;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn json_request(
    app: &Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let body = match body {
        Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
        None => Body::empty(),
    };
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

/// What the stand-in Mittaro API received, and the idempotency keys it knows.
#[derive(Clone, Default)]
struct FakeMittaro {
    received: Arc<Mutex<Vec<(HeaderMap, Value)>>>,
    accepted: Arc<Mutex<HashMap<String, String>>>,
}

async fn fake_send(
    State(fake): State<FakeMittaro>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> (StatusCode, axum::Json<Value>) {
    let key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    fake.received
        .lock()
        .unwrap()
        .push((headers, serde_json::from_slice(&body).unwrap()));
    let mut accepted = fake.accepted.lock().unwrap();
    if let Some(id) = accepted.get(&key) {
        return (
            StatusCode::OK,
            axum::Json(json!({ "id": id, "status": "queued" })),
        );
    }
    let id = format!("email_{}", accepted.len() + 1);
    accepted.insert(key, id.clone());
    (
        StatusCode::ACCEPTED,
        axum::Json(json!({ "id": id, "status": "queued" })),
    )
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

#[tokio::test]
async fn managers_email_the_current_sign_in_data_once_and_the_log_goes_with_the_lead() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let manager_id = seed_user(pool, "login-email", "patient_manager").await;
    let sales_id = seed_user(pool, "login-email", "sales").await;
    let manager = bearer(manager_id, "patient_manager");
    let sales = bearer(sales_id, "sales");

    let (api_url, fake) = start_fake_mittaro().await;
    let state = suite.state.clone().with_mailer(MailConfig {
        mittaro_api_key: Some(SecretString::from("tx_live_test")),
        mittaro_api_url: Some(api_url),
        from: Some("zugang@gmed-health.test".into()),
        reply_to: None,
        console_url: Some("https://console.gmed-health.test".into()),
    });
    let app = gmed_server::build_app_for_role_contract_tests(state).layer(Extension(ConnectInfo(
        SocketAddr::from(([127, 0, 0, 1], 41000)),
    )));

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &manager,
        Some(json!({
            "first_name": "Olena",
            "last_name": "Mailtest",
            "email": "olena.mailtest@example.com",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let user_id = created["portal_account"]["user_id"]
        .as_str()
        .unwrap()
        .to_string();
    let password = created["portal_account"]["one_time_password"]
        .as_str()
        .unwrap()
        .to_string();
    // The wizard stores the language after creation.
    sqlx::query("UPDATE leads SET primary_language = 'uk' WHERE id = $1")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();
    let path = format!("/api/v1/leads/{lead_id}/portal-login-email");

    let (status, info) = json_request(&app, "GET", &path, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert_eq!(info["available"], true);
    assert_eq!(info["can_send"], true);
    assert_eq!(info["lead_language"], "uk");
    assert_eq!(info["sent"], json!([]));

    // Sales creates leads but never handles the password.
    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(json!({ "user_id": user_id, "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // A password that is not the login's current one is not sent.
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "user_id": user_id, "password": "Wrong-123-pass" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "portal_password_outdated");

    // A login of another lead is not reachable through this lead.
    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "user_id": sales_id, "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(fake.received.lock().unwrap().is_empty());

    // The lead's language (Ukrainian) is used when the dialog sends none.
    let (status, sent) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "user_id": user_id, "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["sent_to"], "olena.mailtest@example.com");
    assert_eq!(sent["language"], "uk");
    assert_eq!(sent["replayed"], false);
    {
        let received = fake.received.lock().unwrap();
        assert_eq!(received.len(), 1);
        let (headers, message) = &received[0];
        assert_eq!(headers["authorization"], "Bearer tx_live_test");
        assert!(
            headers["idempotency-key"]
                .to_str()
                .unwrap()
                .starts_with("gmed-portal-login-")
        );
        assert_eq!(message["from"], "zugang@gmed-health.test");
        assert_eq!(message["to"], "olena.mailtest@example.com");
        assert_eq!(message["subject"], "Ваш доступ до порталу пацієнта GMED");
        for part in ["text", "html"] {
            let content = message[part].as_str().unwrap();
            assert!(content.contains(&password), "{part}");
            assert!(content.contains("https://console.gmed-health.test/login"));
            assert!(content.contains("Olena Mailtest"));
        }
    }

    // A second click with the same password and language sends nothing new.
    let (status, again) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "user_id": user_id, "password": password, "language": "uk" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["replayed"], true);
    assert_eq!(again["message_id"], sent["message_id"]);

    // In another language it is a new message.
    let (status, german) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "user_id": user_id, "password": password, "language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(german["language"], "de");
    assert_eq!(
        fake.received.lock().unwrap()[2].1["subject"],
        "Ihr Zugang zum GMED-Patientenportal"
    );

    let (_, info) = json_request(&app, "GET", &path, &manager, None).await;
    let log = info["sent"].as_array().unwrap();
    assert_eq!(log.len(), 2, "{info}");
    assert!(log.iter().all(|row| row["status"] == "sent"));
    assert_eq!(log[0]["language"], "de");
    let (_, list) = json_request(&app, "GET", "/api/v1/leads", &manager, None).await;
    let listed = list
        .as_array()
        .or_else(|| list["items"].as_array())
        .or_else(|| list["data"].as_array())
        .unwrap()
        .iter()
        .find(|lead| lead["id"] == lead_id.to_string())
        .unwrap()
        .clone();
    assert!(
        listed["portal_account"]["login_emailed_at"].is_string(),
        "{listed}"
    );
    // Three sends (the first, its repeat, the German one), three audit rows.
    support::wait_until("audit rows", || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM audit_log WHERE action = 'send_lead_portal_login_email' AND entity_id = $1",
            )
            .bind(lead_id)
            .fetch_one(&pool)
            .await
            .unwrap()
                == 3
        }
    })
    .await;

    // Without the Mittaro settings nothing is sent.
    let (status, body) = json_request(
        &suite.app,
        "POST",
        &path,
        &manager,
        Some(json!({ "user_id": user_id, "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["code"], "mail_not_configured");

    // The log names addresses, so it goes with the purged lead.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &manager,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM portal_login_emails WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn the_api_connections_page_saves_the_key_encrypted_over_the_environment() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let ceo_id = seed_user(pool, "mail-connection", "ceo").await;
    let manager_id = seed_user(pool, "mail-connection", "patient_manager").await;
    let ceo = bearer(ceo_id, "ceo");
    let manager = bearer(manager_id, "patient_manager");

    let (api_url, fake) = start_fake_mittaro().await;
    let state = suite.state.clone().with_mailer(MailConfig {
        mittaro_api_key: Some(SecretString::from("tx_live_envkey0000")),
        mittaro_api_url: Some(api_url),
        from: Some("env@gmed-health.test".into()),
        reply_to: None,
        console_url: Some("https://console.gmed-health.test".into()),
    });
    let app = gmed_server::build_app_for_role_contract_tests(state).layer(Extension(ConnectInfo(
        SocketAddr::from(([127, 0, 0, 1], 41001)),
    )));

    // Only the roles of the API connections page.
    let (status, _) = json_request(&app, "GET", "/api/v1/mail/connection", &manager, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, info) = json_request(&app, "GET", "/api/v1/mail/connection", &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert_eq!(info["source"], "environment");
    assert_eq!(info["configured"], true);
    assert_eq!(info["sender"], "env@gmed-health.test");
    assert_eq!(info["key_hint"], "…0000");

    // Without a saved key the key is required; a wrong key shape is refused.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection",
        &ceo,
        Some(json!({ "sender": "zugang@gmed-health.test" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "mail_api_key_required");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection",
        &ceo,
        Some(json!({ "api_key": "sk_live_wrong", "sender": "zugang@gmed-health.test" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "mail_api_key_invalid");

    let (status, info) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection",
        &ceo,
        Some(json!({
            "api_key": "tx_live_dbkeyAB12",
            "sender": " Zugang@GMED-health.test ",
            "reply_to": "info@gmed-health.test",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert_eq!(info["source"], "database");
    assert_eq!(info["sender"], "zugang@gmed-health.test");
    assert_eq!(info["reply_to"], "info@gmed-health.test");
    assert_eq!(info["key_hint"], "…AB12");
    assert!(!info.to_string().contains("tx_live_dbkeyAB12"));
    let ciphertext: Vec<u8> = sqlx::query_scalar("SELECT ciphertext FROM mail_provider_connection")
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(
        !String::from_utf8_lossy(&ciphertext).contains("dbkeyAB12"),
        "the key is stored encrypted"
    );

    // The test letter goes out with the saved key, to the signed-in user.
    let (status, sent) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection/test",
        &ceo,
        Some(json!({ "language": "ru" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["sent_to"], "mail-connection-ceo@example.com");
    {
        let received = fake.received.lock().unwrap();
        let (headers, message) = received.last().unwrap();
        assert_eq!(headers["authorization"], "Bearer tx_live_dbkeyAB12");
        assert_eq!(message["from"], "zugang@gmed-health.test");
        assert_eq!(message["reply_to"], "info@gmed-health.test");
        assert_eq!(message["subject"], "GMED: тестовое письмо");
    }

    // Changing only the sender keeps the saved key.
    let (status, info) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection",
        &ceo,
        Some(json!({ "sender": "portal@gmed-health.test" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert_eq!(info["key_hint"], "…AB12");
    assert_eq!(info["reply_to"], Value::Null);
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection/test",
        &ceo,
        Some(json!({ "to": "someone@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    {
        let received = fake.received.lock().unwrap();
        let (headers, message) = received.last().unwrap();
        assert_eq!(headers["authorization"], "Bearer tx_live_dbkeyAB12");
        assert_eq!(message["from"], "portal@gmed-health.test");
        assert_eq!(message["to"], "someone@example.com");
    }

    // Disconnecting switches e-mail off, also over the key in the environment.
    let (status, info) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection/disconnect",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert_eq!(info["source"], "disconnected");
    assert_eq!(info["configured"], false);
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/mail/connection/test",
        &ceo,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["code"], "mail_not_configured");
}
