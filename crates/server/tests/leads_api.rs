//! Integration tests for the Leads API endpoints.
//!
//! These tests provision a temporary PostgreSQL database, run migrations,
//! execute the suite, and drop the database on teardown.

mod support;

use axum::body::Body;
use axum::http::Request;
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

struct TestApp {
    suite: support::TestSuiteContext,
    sales_id: Uuid,
    patient_manager_id: Uuid,
    billing_id: Uuid,
    interpreter_id: Uuid,
    ceo_id: Uuid,
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

    fn auth_header(&self, role: &str) -> String {
        let user_id = match role {
            "sales" => self.sales_id,
            "patient_manager" => self.patient_manager_id,
            "billing" => self.billing_id,
            "interpreter" => self.interpreter_id,
            "ceo" => self.ceo_id,
            other => panic!("unexpected test role: {other}"),
        };
        let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
        format!("Bearer {token}")
    }
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
    let sales_id = seed_user(&suite.pool, "leads-api", "sales").await;
    let patient_manager_id = seed_user(&suite.pool, "leads-api", "patient_manager").await;
    let billing_id = seed_user(&suite.pool, "leads-api", "billing").await;
    let interpreter_id = seed_user(&suite.pool, "leads-api", "interpreter").await;
    let ceo_id = seed_user(&suite.pool, "leads-api", "ceo").await;
    Some(TestApp {
        suite,
        sales_id,
        patient_manager_id,
        billing_id,
        interpreter_id,
        ceo_id,
    })
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

async fn public_multipart_request(
    app: &axum::Router,
    path: &str,
    token: &str,
    bundle: Value,
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-test-{}", Uuid::new_v4().simple());
    let body = format!(
        "--{boundary}\r\n\
Content-Disposition: form-data; name=\"bundle\"\r\n\
Content-Type: application/json\r\n\r\n\
{}\r\n\
--{boundary}--\r\n",
        serde_json::to_string(&bundle).unwrap(),
    );

    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header("x-intake-token", token)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

async fn make_lead_ready_for_qualification(
    app: &axum::Router,
    bearer: &str,
    lead_id: &str,
) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        bearer,
        Some(json!({
            "email": format!("ready-{lead_id}@example.com"),
            "phone": "+49123456789",
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
    body
}

#[tokio::test]
async fn public_lead_intake_stores_contact_form_submissions_as_leads() {
    let Some(app) = test_app().await else { return };
    let token = "test-lead-intake-token";
    // The public intake route reads the shared token from process env.
    // Integration tests in this crate do not otherwise mutate this key.
    unsafe {
        std::env::remove_var("LEAD_INTAKE_TOKEN");
        std::env::set_var("GMED_LEAD_INTAKE_TOKEN", token);
    }

    let (status, created) = public_multipart_request(
        &app,
        "/api/v1/public/lead-intake",
        token,
        json!({
            "version": 1,
            "source": "contact",
            "flow": "contact",
            "submittedAt": "2026-05-27T12:00:00Z",
            "patientType": "new",
            "locale": "de",
            "summary": {
                "fullName": "Ada Lovelace",
                "email": "ada.contact@example.com",
                "primaryPhone": "+49123456789",
                "locationDetailed": null,
                "canTravel": null,
                "hasMedicalRecords": null,
                "recordsInAcceptedLanguage": null
            },
            "payload": {
                "firstName": "Ada",
                "lastName": "Lovelace",
                "email": "ada.contact@example.com",
                "emailConsent": true,
                "phones": [{ "number": "+49123456789", "type": "mobile" }],
                "message": "I need a call about treatment coordination.",
                "services": [],
                "consentAutomatedContact": false,
                "consentHealthcare": false,
                "consentOptOut": false,
                "consentPrivacyPractices": false
            }
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    let lead_id = created["lead_id"]
        .as_str()
        .expect("public intake returns lead_id");

    let pm = app.auth_header("patient_manager");
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["source"], "Website Contact Form");
    assert_eq!(detail["intake_source"], "website_contact");
    assert_eq!(detail["flow"], "contact");
    assert_eq!(detail["email"], "ada.contact@example.com");
    assert_eq!(detail["phone"], "+49123456789");
    assert_eq!(
        detail["message"],
        "I need a call about treatment coordination."
    );
}

// ── Auth / RBAC tests ───────────────────────────────────────

#[tokio::test]
async fn leads_list_requires_auth() {
    let Some(app) = test_app().await else { return };

    let req = Request::builder()
        .uri("/api/v1/leads")
        .body(Body::empty())
        .unwrap();

    let resp = app.router().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn leads_list_forbidden_for_interpreter() {
    let Some(app) = test_app().await else { return };

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/leads",
        &app.auth_header("interpreter"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn leads_list_forbidden_for_billing() {
    let Some(app) = test_app().await else { return };

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/leads",
        &app.auth_header("billing"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn leads_list_ok_for_sales() {
    let Some(app) = test_app().await else { return };

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/leads",
        &app.auth_header("sales"),
        None,
    )
    .await;
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
        &app.auth_header("patient_manager"),
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
        json_request(&app, "GET", "/api/v1/leads", &app.auth_header("ceo"), None).await;
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
        &app.auth_header("sales"),
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
        &app.auth_header("sales"),
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
        &app.auth_header("sales"),
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
    let sales = app.auth_header("sales");

    // Create lead
    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &sales,
        Some(json!({ "first_name": "Qualify", "last_name": "Test" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    make_lead_ready_for_qualification(&app, &sales, lead_id).await;

    // Qualify
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &sales,
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify status changed
    let (_, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &sales,
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
        &app.auth_header("sales"),
        Some(json!({ "first_name": "Bad", "last_name": "Status" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &app.auth_header("sales"),
        Some(json!({ "status": "invalid_status" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn convert_lead_requires_qualified() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");

    // Create lead (status = new)
    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({ "first_name": "Convert", "last_name": "Fail" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    make_lead_ready_for_qualification(&app, &pm, lead_id).await;

    // Try to convert without qualifying first
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Lead is not conversion-ready");
    assert!(
        body["blocking_reasons"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|value| value == "Lead must be qualified before conversion"),
        "blocking reasons should mention missing qualification; body was {body}"
    );
}

#[tokio::test]
async fn convert_lead_requires_patient_manager() {
    let Some(app) = test_app().await else { return };

    // Create and qualify as sales
    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &app.auth_header("sales"),
        Some(json!({ "first_name": "Convert", "last_name": "Rbac" })),
    )
    .await;
    let lead_id = body["id"].as_str().unwrap();

    let _ = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &app.auth_header("sales"),
        Some(json!({ "status": "qualified" })),
    )
    .await;

    // Sales should NOT be able to convert
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &app.auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn full_lead_lifecycle() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");

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

    // 2.5. Make the lead qualification-ready
    make_lead_ready_for_qualification(&app, &pm, &lead_id).await;

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
        &app.auth_header("sales"),
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
        &app.auth_header("sales"),
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
        &app.auth_header("sales"),
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
        &app.auth_header("interpreter"),
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
        &app.auth_header("sales"),
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
    let pm = app.auth_header("patient_manager");

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
    let pm = app.auth_header("patient_manager");

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

    let (status, list) =
        json_request(&app, "GET", "/api/v1/leads?status=converted", &pm, None).await;
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
