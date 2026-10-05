//! Integration tests for the login row of the patients table (owner request
//! 2026-10-05): the patient's portal login with a generated password, its
//! sign-in e-mail through Mittaro, and the order tariff that becomes the
//! patient's account type. Synthetic data only.

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

async fn seed_package(pool: &PgPool, key: &str, name: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO service_packages (package_key, name, base_price_net, base_price_gross)
           VALUES ($1, $2, 1000, 1190)
           RETURNING id"#,
    )
    .bind(key)
    .bind(name)
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

#[derive(Clone, Default)]
struct FakeMittaro {
    received: Arc<Mutex<Vec<Value>>>,
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
        .push(serde_json::from_slice(&body).unwrap());
    let mut accepted = fake.accepted.lock().unwrap();
    let id = format!("email_{}", accepted.len() + 1);
    accepted.entry(key).or_insert(id.clone());
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

fn listed(list: &Value, patient_id: Uuid) -> Value {
    list.as_array()
        .unwrap()
        .iter()
        .find(|patient| patient["id"] == patient_id.to_string())
        .cloned()
        .unwrap_or_else(|| panic!("patient {patient_id} not listed: {list}"))
}

#[tokio::test]
async fn the_patients_table_issues_and_emails_the_login_and_shows_the_order_tariff() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let manager_id = seed_user(pool, &tag, "patient_manager").await;
    let sales_id = seed_user(pool, &tag, "sales").await;
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
        SocketAddr::from(([127, 0, 0, 1], 41002)),
    )));

    let email = format!("pat-{tag}@example.com");
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &manager,
        Some(json!({
            "first_name": "Petra",
            "last_name": "Portal",
            "birth_date": "1980-05-01",
            "gender": "female",
            "phone_primary": "+49 221 123456",
            "email": email,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let patient_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();

    let (status, list) = json_request(&app, "GET", "/api/v1/patients", &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let row = listed(&list, patient_id);
    assert_eq!(row["portal_account"], Value::Null);
    assert_eq!(row["subscription"], Value::Null);

    // Only the CEO and patient managers issue a login.
    let path = format!("/api/v1/patients/{patient_id}/portal-account");
    let (status, _) = json_request(&app, "POST", &path, &sales, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, issued) = json_request(&app, "POST", &path, &manager, None).await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    assert_eq!(issued["created"], true);
    assert_eq!(issued["email"], email);
    let user_id = issued["user_id"].as_str().unwrap().to_string();
    let first_password = issued["one_time_password"].as_str().unwrap().to_string();

    let (_, list) = json_request(&app, "GET", "/api/v1/patients", &manager, None).await;
    let row = listed(&list, patient_id);
    assert_eq!(row["portal_account"]["user_id"], user_id);
    assert_eq!(row["portal_account"]["is_active"], true);
    assert_eq!(row["portal_account"]["last_login_at"], Value::Null);

    // The sign-in e-mail speaks of the patient portal, not of a request.
    let mail_path = format!("/api/v1/patients/{patient_id}/portal-login-email");
    let (status, info) = json_request(&app, "GET", &mail_path, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert_eq!(info["available"], true);
    let (status, sent) = json_request(
        &app,
        "POST",
        &mail_path,
        &manager,
        Some(json!({ "user_id": user_id, "password": first_password, "language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["sent_to"], email);
    {
        let received = fake.received.lock().unwrap();
        let text = received.last().unwrap()["text"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(text.contains("Termine, Dokumente und Rechnungen"), "{text}");
        assert!(text.contains(&first_password));
    }
    let (_, list) = json_request(&app, "GET", "/api/v1/patients", &manager, None).await;
    assert!(listed(&list, patient_id)["portal_account"]["login_emailed_at"].is_string());

    // A new password replaces the old one; the old one is not sent any more.
    let (status, renewed) = json_request(&app, "POST", &path, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{renewed}");
    assert_eq!(renewed["created"], false);
    assert_eq!(renewed["user_id"], user_id);
    let (status, body) = json_request(
        &app,
        "POST",
        &mail_path,
        &manager,
        Some(json!({ "user_id": user_id, "password": first_password })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "portal_password_outdated");

    // The order's tariff becomes the patient's account type.
    let one = seed_package(pool, &format!("gmed_one_{tag}"), "GMED One Programm").await;
    let reserve = seed_package(
        pool,
        &format!("gmed_reserve_programm_35to49_{tag}"),
        "GMED Reserve Membership Programm (35 to 49 y.o.)",
    )
    .await;
    let other = seed_package(pool, &format!("vip_extra_{tag}"), "VIP extra").await;
    let (status, order) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &manager,
        Some(json!({ "patient_id": patient_id, "needs_description": "Membership" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{order}");
    let order_id = order["id"].as_str().unwrap().to_string();
    let tariff_path = format!("/api/v1/orders/{order_id}/subscription");
    let (status, tariff) = json_request(&app, "GET", &tariff_path, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{tariff}");
    assert_eq!(tariff["current"], Value::Null);
    let offered: Vec<&str> = tariff["options"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|option| option["id"].as_str())
        .collect();
    assert!(offered.contains(&one.to_string().as_str()));
    assert!(!offered.contains(&other.to_string().as_str()));

    let (status, _) = json_request(
        &app,
        "POST",
        &tariff_path,
        &manager,
        Some(json!({ "package_id": other })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, tariff) = json_request(
        &app,
        "POST",
        &tariff_path,
        &manager,
        Some(json!({ "package_id": one })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{tariff}");
    assert_eq!(tariff["current"]["kind"], "gmed_one");
    let (_, list) = json_request(&app, "GET", "/api/v1/patients", &manager, None).await;
    let row = listed(&list, patient_id);
    assert_eq!(row["subscription"]["kind"], "gmed_one");
    assert_eq!(row["subscription"]["name"], "GMED One Programm");

    // Another tariff replaces it; none removes it.
    let (status, tariff) = json_request(
        &app,
        "POST",
        &tariff_path,
        &manager,
        Some(json!({ "package_id": reserve })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{tariff}");
    assert_eq!(tariff["current"]["kind"], "gmed_reserve");
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_service_packages WHERE order_id = $1::uuid AND status = 'active'",
    )
    .bind(&order_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(active, 1);
    let (status, tariff) = json_request(
        &app,
        "POST",
        &tariff_path,
        &manager,
        Some(json!({ "package_id": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{tariff}");
    assert_eq!(tariff["current"], Value::Null);
    let (_, list) = json_request(&app, "GET", "/api/v1/patients", &manager, None).await;
    assert_eq!(listed(&list, patient_id)["subscription"], Value::Null);
}
