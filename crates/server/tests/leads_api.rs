//! Integration tests for the Leads API endpoints.
//!
//! These tests require a running PostgreSQL database.
//! Set DATABASE_URL environment variable before running.
//! Skipped in CI (SQLX_OFFLINE=true) — run locally with:
//!   DATABASE_URL=postgres://... cargo test -p gmed-server --test leads_api

use axum::body::Body;
use axum::http::Request;
use axum::http::StatusCode;
use serde_json::{Value, json};
use tower::ServiceExt;

use gmed_server::auth::jwt;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

/// Build a test app connected to a real database.
/// Returns None if DATABASE_URL is not set (CI).
async fn test_app() -> Option<axum::Router> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return None,
    };

    let pool = gmed_db::create_pool(&db_url).await.ok()?;
    gmed_db::run_migrations(&pool).await.ok()?;

    let settings_cache = SettingsCache::new(TokenSettings::default());
    let state = AppState::new(pool, TEST_SECRET, settings_cache);
    Some(gmed_server::build_app(state))
}

fn auth_header(role: &str) -> String {
    let token = jwt::issue_access_token(
        TEST_SECRET,
        uuid::Uuid::new_v4(),
        role,
        uuid::Uuid::new_v4(),
    )
    .unwrap();
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

// ── Auth / RBAC tests ───────────────────────────────────────

#[tokio::test]
async fn leads_list_requires_auth() {
    let Some(app) = test_app().await else { return };

    let req = Request::builder()
        .uri("/api/v1/leads")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn leads_list_forbidden_for_interpreter() {
    let Some(app) = test_app().await else { return };

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/leads",
        &auth_header("interpreter"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn leads_list_forbidden_for_billing() {
    let Some(app) = test_app().await else { return };

    let (status, _) =
        json_request(&app, "GET", "/api/v1/leads", &auth_header("billing"), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn leads_list_ok_for_sales() {
    let Some(app) = test_app().await else { return };

    let (status, body) =
        json_request(&app, "GET", "/api/v1/leads", &auth_header("sales"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

#[tokio::test]
async fn leads_list_ok_for_patient_manager() {
    let Some(app) = test_app().await else { return };

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/leads",
        &auth_header("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

#[tokio::test]
async fn leads_list_ok_for_ceo() {
    let Some(app) = test_app().await else { return };

    let (status, body) =
        json_request(&app, "GET", "/api/v1/leads", &auth_header("ceo"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

// ── CRUD tests ──────────────────────────────────────────────

#[tokio::test]
async fn create_lead_requires_name() {
    let Some(app) = test_app().await else { return };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &auth_header("sales"),
        Some(json!({ "first_name": "", "last_name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(body["message"].as_str().unwrap().contains("Name"));
}

#[tokio::test]
async fn create_and_get_lead() {
    let Some(app) = test_app().await else { return };

    // Create
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &auth_header("sales"),
        Some(json!({
            "first_name": "Test",
            "last_name": "Lead",
            "email": "test@example.com",
            "phone": "+49123456789",
            "source": "Website",
            "country": "DE"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let lead_id = body["id"].as_str().expect("should have id");

    // Get
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["first_name"], "Test");
    assert_eq!(body["last_name"], "Lead");
    assert_eq!(body["email"], "test@example.com");
    assert_eq!(body["qualification_status"], "new");
}

#[tokio::test]
async fn qualify_lead_flow() {
    let Some(app) = test_app().await else { return };

    // Create lead
    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &auth_header("sales"),
        Some(json!({ "first_name": "Qualify", "last_name": "Test" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    // Qualify
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &auth_header("sales"),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify status changed
    let (_, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(body["qualification_status"], "qualified");
}

#[tokio::test]
async fn qualify_lead_invalid_status_rejected() {
    let Some(app) = test_app().await else { return };

    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &auth_header("sales"),
        Some(json!({ "first_name": "Bad", "last_name": "Status" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &auth_header("sales"),
        Some(json!({ "status": "invalid_status" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn convert_lead_requires_qualified() {
    let Some(app) = test_app().await else { return };

    // Create lead (status = new)
    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &auth_header("patient_manager"),
        Some(json!({ "first_name": "Convert", "last_name": "Fail" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    // Try to convert without qualifying first
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &auth_header("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(body["message"].as_str().unwrap().contains("qualified"));
}

#[tokio::test]
async fn convert_lead_requires_patient_manager() {
    let Some(app) = test_app().await else { return };

    // Create and qualify as sales
    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &auth_header("sales"),
        Some(json!({ "first_name": "Convert", "last_name": "Rbac" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    let _ = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &auth_header("sales"),
        Some(json!({ "status": "qualified" })),
    )
    .await;

    // Sales should NOT be able to convert
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn full_lead_lifecycle() {
    let Some(app) = test_app().await else { return };
    let pm = auth_header("patient_manager");

    // 1. Create
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Lifecycle",
            "last_name": "Test",
            "email": "lifecycle@test.com",
            "phone": "+49111222333",
            "source": "Referral",
            "country": "UA"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let lead_id = body["id"].as_str().unwrap().to_string();

    // 2. Appears in list
    let (_, list) = json_request(&app, "GET", "/api/v1/leads", &pm, None).await;
    assert!(list.as_array().unwrap().iter().any(|l| l["id"] == lead_id));

    // 3. Qualify
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm,
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 4. Convert to patient
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["patient_id"].is_string());
    assert!(body["patient_pid"].as_str().unwrap().starts_with("P-"));

    // 5. Cannot convert again
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body["message"].as_str().unwrap().contains("already"));
}

// ── Stats tests ─────────────────────────────────────────────

#[tokio::test]
async fn stats_leads_returns_data() {
    let Some(app) = test_app().await else { return };

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/leads",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["total_this_month"].is_number());
    assert!(body["growth_pct"].is_number());
    assert!(body["qualified_this_month"].is_number());
    assert!(body["converted_this_month"].is_number());
    assert!(body["total_all"].is_number());
}

#[tokio::test]
async fn stats_leads_monthly_returns_array() {
    let Some(app) = test_app().await else { return };

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/leads/monthly",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

#[tokio::test]
async fn stats_leads_by_status_returns_array() {
    let Some(app) = test_app().await else { return };

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/leads/by-status",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

#[tokio::test]
async fn stats_forbidden_for_interpreter() {
    let Some(app) = test_app().await else { return };

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/stats/leads",
        &auth_header("interpreter"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ── Get non-existent lead ───────────────────────────────────

#[tokio::test]
async fn get_nonexistent_lead_returns_404() {
    let Some(app) = test_app().await else { return };

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{fake_id}"),
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── conversion_ready exposed on list payload ───────────────────

#[tokio::test]
async fn list_leads_exposes_conversion_ready_field() {
    // The leads card uses this field to disable its Convert button
    // without waiting for a 422 round-trip. A regression that drops
    // the field from the list serializer would silently re-enable
    // the button on incomplete leads, so pin the contract here.
    let Some(app) = test_app().await else { return };
    let pm = auth_header("patient_manager");

    // Create a bare-minimum lead — no DOB, no legal_sex, no consents.
    // This lead can never pass the conversion_ready gate, so the list
    // entry must carry `conversion_ready: false`.
    let tag = format!("{:x}", uuid::Uuid::new_v4().as_u128() & 0xffff_ffff);
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": format!("Conv{tag}"),
            "last_name": "Ready",
            "email": format!("conv-{tag}@test.local"),
            "phone": "+49000000000",
            "source": "Test",
            "country": "DE"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let lead_id = created["id"].as_str().unwrap().to_string();

    let (status, list) = json_request(&app, "GET", "/api/v1/leads", &pm, None).await;
    assert_eq!(status, StatusCode::OK);

    let entry = list
        .as_array()
        .expect("leads list returns an array")
        .iter()
        .find(|l| l["id"] == lead_id)
        .expect("newly created lead appears in its own list");

    // The field must be present …
    assert!(
        entry.get("conversion_ready").is_some(),
        "list payload must carry conversion_ready; entry was {entry}"
    );
    // … and it must be a boolean, not some other JSON shape.
    let ready = entry["conversion_ready"]
        .as_bool()
        .expect("conversion_ready must serialize as a boolean");
    // … and for a minimal lead, the full readiness gate cannot pass:
    // DOB, legal_sex, consent_privacy_practices, consent_healthcare,
    // and compliance_completed are all missing on a fresh row.
    assert!(
        !ready,
        "a lead created with only contact fields must not be conversion_ready; entry was {entry}"
    );
}

#[tokio::test]
async fn list_leads_conversion_ready_is_false_for_converted_lead() {
    // After conversion the lead row carries converted_patient_id, which
    // the readiness builder treats as "already converted" and reports
    // as not-ready. The UI uses this to hide the Convert button
    // entirely on the `converted` stage card.
    let Some(app) = test_app().await else { return };
    let pm = auth_header("patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Already",
            "last_name": "Converted",
            "email": "already-converted@test.local",
            "phone": "+49111000000",
            "source": "Test",
            "country": "DE"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let lead_id = created["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({
            "primary_language": "de",
            "date_of_birth": "1990-01-01",
            "legal_sex": "female",
            "compliance_status": "signed",
            "consent_healthcare": true,
            "consent_privacy_practices": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm,
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, convert_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(convert_body["patient_id"].is_string());

    let (status, list) = json_request(&app, "GET", "/api/v1/leads?status=converted", &pm, None).await;
    assert_eq!(status, StatusCode::OK);

    let entry = list
        .as_array()
        .expect("converted leads list returns an array")
        .iter()
        .find(|l| l["id"] == lead_id)
        .expect("converted lead must appear in converted list");

    assert_eq!(entry["qualification_status"], "converted");
    assert_eq!(
        entry["conversion_ready"].as_bool(),
        Some(false),
        "converted leads must report conversion_ready=false; entry was {entry}"
    );
}
