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

type ConvertedPatientRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Vec<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Value,
    Value,
);

type ConvertedMedicationRow = (
    String,
    Option<String>,
    String,
    bool,
    Option<String>,
    Option<String>,
    bool,
    Option<Uuid>,
    Option<Uuid>,
);

type ConvertedNarrativeRow = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

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

struct SeededOnboardingArtifacts {
    case_id: Uuid,
    document_ids: Vec<Uuid>,
    contract_id: Uuid,
    order_id: Uuid,
    service_id: Uuid,
    quote_id: Uuid,
}

async fn seed_complete_lead_onboarding(app: &TestApp, lead_id: Uuid) -> SeededOnboardingArtifacts {
    let pool = &app.suite.pool;
    let tag = lead_id.simple().to_string();

    sqlx::query(
        r#"UPDATE leads
           SET street_address = 'Hauptstr. 1',
               city = 'Berlin',
               zip_code = '10115',
               primary_concern_text = 'Chronic knee pain',
               requested_specialties = '["orthopedics"]'::jsonb,
               compliance_status = 'signed',
               consent_healthcare = true,
               consent_privacy_practices = true
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();

    let case_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO cases (
                case_id, lead_id, manager_id, status, hauptanfragegrund,
                aktuelle_anamnese, zuweiser, intake_completed_at, intake_completed_by
           ) VALUES (
                $1, $2, $3, 'open', 'Chronic knee pain',
                'Pain for six months', 'Self referral', now(), $3
           ) RETURNING id"#,
    )
    .bind(format!("C-ONBOARD-{tag}"))
    .bind(lead_id)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();

    let mut document_ids = Vec::new();
    for compliance_kind in ["identity", "dsgvo", "confidentiality_release"] {
        let document_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO documents (
                    id, lead_id, auto_name, original_filename, art, category,
                    status, visibility, is_medical, mime_type, file_size,
                    version_root_document_id, version_number, uploaded_by,
                    signed_at, signed_by, compliance_kind
               ) VALUES (
                    $1, $2, $3, $4, $5, 'administrative',
                    'active', 'internal', false, 'application/pdf', 128,
                    $1, 1, $6, now(), $6, $5
               )"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(format!("{compliance_kind} {tag}"))
        .bind(format!("{compliance_kind}-{tag}.pdf"))
        .bind(compliance_kind)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();
        document_ids.push(document_id);
    }

    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                lead_id, contract_number, signed_at, status, created_by, client_reference
           ) VALUES ($1, $2, now(), 'signed', $3, $4)
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(format!("FC-ONBOARD-{tag}"))
    .bind(app.patient_manager_id)
    .bind(format!("lead-onboarding:{lead_id}:framework"))
    .fetch_one(pool)
    .await
    .unwrap();

    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, contract_id, source_lead_id, needs_description,
                signed_patient, signed_agency, signed_patient_at, signed_agency_at,
                signed_at, prepayment_required, total_estimated, created_by
           ) VALUES (
                $1, $2, $3, 'Coordinate orthopedic treatment',
                true, true, now(), now(), now(), true, 119, $4
           ) RETURNING id"#,
    )
    .bind(format!("A-ONBOARD-{tag}"))
    .bind(contract_id)
    .bind(lead_id)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();

    let service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, client_reference
           ) VALUES ($1, 'Initial orthopedic coordination', 1, 100, 19, $2)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(format!("lead-onboarding:{lead_id}:service:1"))
    .fetch_one(pool)
    .await
    .unwrap();

    let quote_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                status, paid_amount, paid_at, line_items, created_by
           ) VALUES (
                $1, $2, 100, 19, 119,
                'accepted', 119, now(), '[]'::jsonb, $3
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(format!("KV-ONBOARD-{tag}"))
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();

    for (template_id, category) in [
        ("framework_contract", "contract"),
        ("single_order", "administrative_single_order"),
        ("order_cost_estimate", "finance_order_cost_estimate"),
        ("cost_estimate", "finance_cost_estimate"),
    ] {
        let document_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO documents (
                    id, lead_id, order_id, auto_name, original_filename, art, category,
                    status, visibility, is_medical, mime_type, file_size,
                    generated_template_id, version_root_document_id, version_number, uploaded_by
               ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    'active', 'patient_visible', false, 'application/pdf', 128,
                    $6, $1, 1, $8
               )"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(order_id)
        .bind(format!("{template_id} {tag}"))
        .bind(format!("{template_id}-{tag}.pdf"))
        .bind(template_id)
        .bind(category)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();
        document_ids.push(document_id);
    }

    SeededOnboardingArtifacts {
        case_id,
        document_ids,
        contract_id,
        order_id,
        service_id,
        quote_id,
    }
}

#[tokio::test]
async fn public_lead_intake_stores_contact_form_submissions_as_leads() {
    let Some(app) = test_app().await else { return };
    let token = "test-lead-intake-token";
    // The public intake route reads the shared token from process env.
    // Integration tests in this crate do not otherwise mutate this key.
    unsafe {
        std::env::set_var("LEAD_INTAKE_TOKEN", token);
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
    assert_eq!(detail["lead_type"], "form");
    assert_eq!(detail["flow"], "contact");
    assert_eq!(detail["email"], "ada.contact@example.com");
    assert_eq!(detail["phone"], "+49123456789");
    assert_eq!(
        detail["message"],
        "I need a call about treatment coordination."
    );

    let (status, list) = json_request(&app, "GET", "/api/v1/leads?lead_type=form", &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = list.as_array().expect("leads list array");
    assert!(items.iter().any(|item| item["id"] == lead_id));

    let (status, promoted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/promote-console"),
        &pm,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(promoted["lead_type"], "console");

    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["lead_type"], "console");
    assert_eq!(detail["intake_source"], "website_contact");
    assert!(detail["console_promoted_at"].as_str().is_some());

    let (status, list) =
        json_request(&app, "GET", "/api/v1/leads?lead_type=console", &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = list.as_array().expect("leads list array");
    assert!(items.iter().any(|item| item["id"] == lead_id));
}

#[tokio::test]
async fn public_lead_intake_stores_wizard_submissions_as_questionnaire_leads() {
    let Some(app) = test_app().await else { return };
    let token = "test-lead-intake-token";
    unsafe {
        std::env::set_var("LEAD_INTAKE_TOKEN", token);
        std::env::set_var("GMED_LEAD_INTAKE_TOKEN", token);
    }

    let (status, created) = public_multipart_request(
        &app,
        "/api/v1/public/lead-intake",
        token,
        json!({
            "version": 1,
            "source": "website_wizard",
            "flow": "medical",
            "submittedAt": "2026-05-27T12:00:00Z",
            "locale": "ru-RU",
            "payload": {
                "firstName": "Grace",
                "lastName": "Hopper",
                "email": "grace.questionnaire@example.com",
                "primaryLanguage": "broken@example.com",
                "phones": [{ "number": "+49111222333", "type": "mobile" }],
                "services": ["medical_treatment"],
                "primaryConcernText": "Full medical intake questionnaire.",
                "consentAutomatedContact": true,
                "consentHealthcare": true,
                "consentOptOut": false,
                "consentPrivacyPractices": true
            }
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    let lead_id = created["lead_id"].as_str().expect("lead_id");

    let pm = app.auth_header("patient_manager");
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["source"], "Website Wizard");
    assert_eq!(detail["intake_source"], "visitor_facade");
    assert_eq!(detail["lead_type"], "questionnaire");
    assert_eq!(detail["primary_language"], "ru");

    let (status, list) = json_request(
        &app,
        "GET",
        "/api/v1/leads?lead_type=questionnaire",
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list.as_array().expect("leads list array");
    assert!(items.iter().any(|item| item["id"] == lead_id));

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/promote-console"),
        &pm,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["lead_type"], "console");
    assert_eq!(detail["intake_source"], "visitor_facade");
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
    assert_eq!(body["lead_type"], "console");

    let (status, list) = json_request(
        &app,
        "GET",
        "/api/v1/leads?lead_type=console",
        &app.auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list.as_array().expect("leads list array");
    assert!(items.iter().any(|item| item["id"] == lead_id));
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

    seed_complete_lead_onboarding(&app, Uuid::parse_str(&lead_id).unwrap()).await;

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

    seed_complete_lead_onboarding(&app, Uuid::parse_str(&lead_id).unwrap()).await;

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

#[tokio::test]
async fn lead_readiness_uses_the_newest_quote_for_acceptance_and_prepayment() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let billing = app.auth_header("billing");
    let tag = Uuid::new_v4().simple().to_string();

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Newest",
            "last_name": "Quote",
            "email": format!("newest-quote-{tag}@test.local"),
            "phone": "+49111000001",
            "source": "Test",
            "country": "DE"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    make_lead_ready_for_qualification(&app, &pm, &lead_id.to_string()).await;
    let (status, qualified) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm,
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{qualified}");

    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    let readiness_check_passed = |lead: &Value, key: &str| {
        lead["readiness"]["checks"]
            .as_array()
            .and_then(|checks| {
                checks
                    .iter()
                    .find(|check| check["key"].as_str() == Some(key))
            })
            .and_then(|check| check["passed"].as_bool())
            .unwrap_or_else(|| panic!("missing boolean readiness check {key}: {lead}"))
    };

    let (status, initially_ready) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{initially_ready}");
    assert_eq!(
        initially_ready["readiness"]["conversion_ready"], true,
        "{initially_ready}"
    );
    assert!(readiness_check_passed(&initially_ready, "quote_accepted"));
    assert!(readiness_check_passed(&initially_ready, "prepayment_ready"));

    let newest_quote_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                status, paid_amount, line_items, created_by, created_at
           )
           SELECT q.order_id, $1, q.total_net, q.total_vat, q.total_gross,
                  'draft', 0, q.line_items, $2, q.created_at + interval '1 second'
           FROM quotes q
           WHERE q.id = $3
           RETURNING id"#,
    )
    .bind(format!("KV-NEWEST-{tag}"))
    .bind(app.patient_manager_id)
    .bind(artifacts.quote_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();

    let (status, draft_readiness) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{draft_readiness}");
    assert!(!readiness_check_passed(&draft_readiness, "quote_accepted"));
    assert!(!readiness_check_passed(
        &draft_readiness,
        "prepayment_ready"
    ));

    let (status, partially_paid_quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{newest_quote_id}/status"),
        &billing,
        Some(json!({
            "status": "accepted",
            "paid_amount": 50.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{partially_paid_quote}");

    let (status, partial_readiness) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{partial_readiness}");
    assert!(readiness_check_passed(&partial_readiness, "quote_accepted"));
    assert!(!readiness_check_passed(
        &partial_readiness,
        "prepayment_ready"
    ));

    let (status, fully_paid_quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{newest_quote_id}/status"),
        &billing,
        Some(json!({
            "status": "accepted",
            "paid_amount": 119.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{fully_paid_quote}");

    let (status, full_readiness) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{full_readiness}");
    assert!(readiness_check_passed(&full_readiness, "quote_accepted"));
    assert!(readiness_check_passed(&full_readiness, "prepayment_ready"));
    assert_eq!(
        full_readiness["readiness"]["conversion_ready"], true,
        "{full_readiness}"
    );
}

#[tokio::test]
async fn wizard_convert_uses_the_full_readiness_gate() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;

    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads
               (first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, street_address, city, zip_code,
                primary_concern_text, requested_specialties,
                qualification_status, compliance_status, intake_source)
           VALUES ('Anna','Muster','anna@example.com','+49150','DE','de',
                   DATE '1990-05-01','female','Hauptstr. 1','Berlin','10115',
                   'Knee pain','["orthopedics"]'::jsonb,
                   'new','pending','staff_wizard')
           RETURNING id"#,
    )
    .fetch_one(pool)
    .await
    .unwrap();

    let pm = app.auth_header("patient_manager");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/wizard-convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Lead is not conversion-ready");
    assert!(
        body["blocking_reasons"]
            .as_array()
            .is_some_and(|reasons| reasons
                .iter()
                .any(|reason| reason == "Signed DSGVO document is missing")),
        "{body}"
    );

    let converted_patient_id: Option<Uuid> =
        sqlx::query_scalar("SELECT converted_patient_id FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(converted_patient_id.is_none());
    let patient_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patients WHERE email = 'anna@example.com'")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(patient_count, 0);
}

#[tokio::test]
async fn ready_lead_conversion_atomically_transfers_onboarding_artifacts() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let email = format!("atomic-{}@example.com", Uuid::new_v4().simple());
    let clinical_provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type)
           VALUES ($1, 'medical') RETURNING id"#,
    )
    .bind(format!("Lead conversion clinic {email}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let clinical_doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, title, fachbereich)
           VALUES ($1, 'Lead Conversion Doctor', 'Dr. med.', 'Orthopädie')
           RETURNING id"#,
    )
    .bind(clinical_provider_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, middle_name, last_name, suffix, email, email_consent,
                phone, phones, whatsapp_number, whatsapp_consent,
                country, primary_language, locale, has_insurance,
                insurance_covers_germany, insurance_provider, insurance_number, insurance_type,
                trusted_contact_name, trusted_contact_phone, trusted_contact_email,
                trusted_contact_relation,
                trusted_contact_birth_date, trusted_contact_address, trusted_contacts,
                source, flow, services, needs_interpreter, location, preferred_location,
                visit_timing, selected_program, message, notes,
                date_of_birth, legal_sex, street_address, city, zip_code,
                primary_concern_text, requested_specialties,
                qualification_status, compliance_status,
                consent_healthcare, consent_privacy_practices, intake_source, created_by,
                wizard_state
           ) VALUES (
                'Atomic', 'Marie', 'Onboarding', 'Jr.', $1, true, '+4915112345678',
                '[{"number":"+4915112345678","type":"mobile"},{"number":"+49 30 4444","type":"work"}]'::jsonb,
                '+49 (151) 123-45-678', false, 'UA', 'broken@example.com', 'uk-UA', true,
                'yes', 'Global Shield', 'POL-4242', 'foreign',
                'Olena Onboarding', '+380 44 555 0101', 'olena@example.test',
                'Sister', DATE '1985-02-03',
                'Khreshchatyk 1, Kyiv',
                '[
                    {"id":"00000000-0000-0000-0000-000000000101","name":"Olena Onboarding","phone":"+380 44 555 0101","email":"olena@example.test","relation":"Sister","birth_date":"1985-02-03","address":"Khreshchatyk 1, Kyiv"},
                    {"id":"00000000-0000-0000-0000-000000000102","name":"Petro Onboarding","phone":"+380 44 555 0102","email":"petro@example.test","relation":"Brother","birth_date":"1987-04-05","address":"Volodymyrska 2, Kyiv"}
                ]'::jsonb,
                'website_questionnaire', 'medical',
                ARRAY['medical_treatment', 'interpreter_support']::text[], true,
                'outside_eu', 'berlin', 'within_4_weeks', 'orthopedics',
                'Please coordinate an interpreter for every appointment',
                'Manager service note from the lead',
                DATE '1990-05-01', 'female', 'Hauptstr. 1', 'Berlin', '10115',
                'Chronic knee pain', '["orthopedics"]'::jsonb,
                'qualified', 'signed', true, true, 'staff_wizard', $2,
                $3::jsonb
           ) RETURNING id"#,
    )
    .bind(&email)
    .bind(app.patient_manager_id)
    .bind(
        json!({
            "discovery_source": "customer_referral",
            "referrer": "Dr. Referral",
            "program_date_from": "2026-09-01",
            "program_date_to": "2026-09-30",
            "service_comments": {
                "medical_treatment": "Orthopedic assessment and treatment plan",
                "interpreter_support": "Ukrainian interpreter for every appointment"
            },
            "clinical_draft": {
                "narrative": {
                    "anamnese_aktuelle": "Belastungsabhängige Knieschmerzen",
                    "anamnese_vorgeschichte": "Arthroskopie 2018",
                    "anamnese_vegetative": "Unauffällig",
                    "anamnese_sozial": "Lebt selbstständig",
                    "beurteilung": "Orthopädische Abklärung empfohlen",
                    "is_active": true
                },
                "diagnoses": [
                    {
                        "id": "diagnosis-1",
                        "kind": "main",
                        "label": "Gonarthrose",
                        "icdCode": "M17.9",
                        "certainty": "bestaetigt",
                        "chronification": "chronisch",
                        "diagnosedOn": "2024-03-01",
                        "note": "Rechtes Knie",
                        "provider_id": clinical_provider_id,
                        "doctor_id": clinical_doctor_id
                    },
                    {
                        "cid": "procedure-1",
                        "parent_cid": "diagnosis-1",
                        "kind": "prozedur",
                        "label": "Kniearthroskopie",
                        "ops_code": "5-810.0h",
                        "diagnosed_on": "2018-05-14",
                        "source_mode": "intern"
                    },
                    {
                        "cid": "external-diagnosis-1",
                        "kind": "secondary",
                        "label": "Hypertonie",
                        "icd_code": "I10",
                        "certainty": "bestaetigt",
                        "chronifizierung": "chronisch",
                        "source_mode": "extern",
                        "external_clinic": "Kyiv Heart Center",
                        "external_doctor": "Dr. Kovalenko",
                        "external_country": "UA"
                    }
                ],
                "medications": [
                    {
                        "id": "medication-1",
                        "name": "Ibuprofen",
                        "activeIngredient": "Ibuprofen",
                        "dose": "400",
                        "doseUnit": "mg",
                        "schedule": "1-0-1",
                        "form": "FTBL",
                        "route": "Oral",
                        "unit": "Stück",
                        "category": "besondere",
                        "status": "aktiv",
                        "doseMorning": "1",
                        "doseNoon": "0",
                        "doseEvening": "1",
                        "doseNight": "0",
                        "prescribedOn": "2026-06-30",
                        "pharmacyOnly": true,
                        "prescriptionOnly": false,
                        "btm": false,
                        "autIdemBlocked": true,
                        "dispensingRestricted": false,
                        "reason": "Schmerzen",
                        "since": "2026-07-01",
                        "expiryDate": "2026-07-31",
                        "medicationType": "temporary",
                        "note": "Nach dem Essen"
                    },
                    {
                        "id": "medication-2",
                        "category": "dauer",
                        "wirkstoff": "Bisoprolol",
                        "handelsname": "Bisoprolol-ratiopharm",
                        "staerke": "5 mg",
                        "form": "TABL",
                        "einnahmeform": "Oral",
                        "dose_morgens": "1",
                        "dose_mittags": "0",
                        "dose_abends": "0",
                        "dose_nachts": "0",
                        "einheit": "Stück",
                        "hinweis": "Vor dem Frühstück",
                        "grund": "Hypertonie",
                        "verordnet_am": "2026-06-01",
                        "einnahme_von": "2026-06-02",
                        "status": "pausiert",
                        "rezeptpflichtig": true,
                        "sonstige_vermerke": "Blutdruck kontrollieren",
                        "on_hold": true,
                        "hold_until": "2026-08-01",
                        "hold_note": "Vor Eingriff pausieren",
                        "provider_id": clinical_provider_id,
                        "doctor_id": clinical_doctor_id
                    }
                ],
                "allergies": [{
                    "id": "allergy-1",
                    "label": "Penicillin",
                    "reaction": "Exanthem",
                    "severity": "mittel",
                    "note": "Seit Kindheit"
                }],
                "caves": [{
                    "id": "cave-1",
                    "label": "Antikoagulation",
                    "note": "Vor Eingriff prüfen"
                }]
            }
        })
        .to_string(),
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    let source_attachment_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO lead_attachments
               (id, lead_id, file_name, content_type, size_bytes, data)
           VALUES ($1, $2, 'medical-history.txt', 'text/plain', 22, $3)"#,
    )
    .bind(source_attachment_id)
    .bind(lead_id)
    .bind(b"Questionnaire document".as_slice())
    .execute(pool)
    .await
    .unwrap();

    let pm = app.auth_header("patient_manager");
    let (status, lead) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert_eq!(lead["readiness"]["conversion_ready"], true, "{lead}");
    assert_eq!(
        lead["readiness"]["steps"]
            .as_array()
            .expect("readiness steps")
            .len(),
        6
    );

    let patient_before: i64 = sqlx::query_scalar("SELECT count(*) FROM patients WHERE email = $1")
        .bind(&email)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(patient_before, 0);

    let (status, converted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/wizard-convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    let patient_id = Uuid::parse_str(converted["patient_id"].as_str().unwrap()).unwrap();

    let patient: ConvertedPatientRow = sqlx::query_as(
        r#"SELECT first_name, last_name, nationality, residence_country, languages,
                  phone_secondary, address_country, insurance_type, insurance_provider,
                  insurance_number, emergency_contact_name, emergency_contact_phone,
                  emergency_contact_relation, intake_profile, legal_status
           FROM patients WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(patient.0, "Atomic Marie");
    assert_eq!(patient.1, "Onboarding Jr.");
    assert_eq!(patient.2, None, "country must not be stored as nationality");
    assert_eq!(patient.3.as_deref(), Some("Ukraine"));
    assert_eq!(patient.4, vec!["uk".to_string()]);
    assert_eq!(patient.5.as_deref(), Some("+49 30 4444"));
    assert_eq!(patient.6.as_deref(), Some("Ukraine"));
    assert_eq!(patient.7.as_deref(), Some("foreign"));
    assert_eq!(patient.8.as_deref(), Some("Global Shield"));
    assert_eq!(patient.9.as_deref(), Some("POL-4242"));
    assert_eq!(patient.10.as_deref(), Some("Olena Onboarding"));
    assert_eq!(patient.11.as_deref(), Some("+380 44 555 0101"));
    assert_eq!(patient.12.as_deref(), Some("Sister"));
    assert_eq!(patient.13["source"], "website_questionnaire");
    assert_eq!(patient.13["flow"], "medical");
    assert_eq!(patient.13["needs_interpreter"], true);
    assert_eq!(patient.13["services"][0], "medical_treatment");
    assert_eq!(patient.13["services"][1], "interpreter_support");
    assert_eq!(patient.13["preferred_location"], "berlin");
    assert_eq!(patient.13["visit_timing"], "within_4_weeks");
    assert_eq!(
        patient.13["message"],
        "Please coordinate an interpreter for every appointment"
    );
    assert_eq!(patient.13["discovery_source"], "customer_referral");
    assert_eq!(patient.13["lead_type"], "questionnaire");
    assert_eq!(patient.13["primary_concern_text"], "Chronic knee pain");
    assert_eq!(patient.13["requested_specialties"][0], "orthopedics");
    assert_eq!(patient.13["email_consent"], true);
    assert_eq!(patient.13["whatsapp_consent"], false);
    assert_eq!(patient.13["program_date_from"], "2026-09-01");
    assert_eq!(patient.13["program_date_to"], "2026-09-30");
    assert_eq!(
        patient.13["service_comments"]["interpreter_support"],
        "Ukrainian interpreter for every appointment"
    );
    assert_eq!(patient.13["trusted_contact"]["birth_date"], "1985-02-03");
    assert_eq!(patient.13["trusted_contact"]["email"], "olena@example.test");
    assert_eq!(
        patient.13["trusted_contact"]["address"],
        "Khreshchatyk 1, Kyiv"
    );
    assert_eq!(patient.13["trusted_contacts"].as_array().unwrap().len(), 2);
    assert_eq!(
        patient.13["trusted_contacts"][0]["name"],
        "Olena Onboarding"
    );
    assert_eq!(
        patient.13["trusted_contacts"][1]["name"],
        "Petro Onboarding"
    );
    assert!(patient.13.get("raw_payload").is_none());
    assert_eq!(patient.14["dsgvo_signed"], true);
    assert_eq!(patient.14["confidentiality_release_signed"], true);
    assert_eq!(patient.14["identity_verified"], true);
    assert_eq!(patient.14["document_pack_complete"], true);
    assert_eq!(patient.14["compliance_completed"], true);
    assert_eq!(patient.14["contract_status"], "signed");

    let (source_lead_id, lead_snapshot, patient_notes): (Option<Uuid>, Value, Option<String>) =
        sqlx::query_as("SELECT source_lead_id, lead_snapshot, notes FROM patients WHERE id = $1")
            .bind(patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(source_lead_id, Some(lead_id));
    assert_eq!(lead_snapshot["id"], lead_id.to_string());
    assert_eq!(lead_snapshot["whatsapp_number"], "+49 (151) 123-45-678");
    assert_eq!(lead_snapshot["primary_concern_text"], "Chronic knee pain");
    assert_eq!(
        lead_snapshot["wizard_state"]["service_comments"]["medical_treatment"],
        "Orthopedic assessment and treatment plan"
    );
    assert_eq!(
        patient_notes.as_deref(),
        Some("Manager service note from the lead")
    );

    let (patient_status, patient_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(patient_status, StatusCode::OK, "{patient_detail}");
    assert_eq!(patient_detail["source_lead_id"], lead_id.to_string());
    assert_eq!(patient_detail["lead_snapshot"]["id"], lead_id.to_string());
    assert_eq!(
        patient_detail["intake_profile"]["service_comments"]["medical_treatment"],
        "Orthopedic assessment and treatment plan"
    );

    let contacts: Vec<(String, String, String, bool, Option<String>)> = sqlx::query_as(
        r#"SELECT contact_kind, contact_type, value, is_primary, notes
           FROM patient_contacts WHERE patient_id = $1
           ORDER BY contact_kind, is_primary DESC, value"#,
    )
    .bind(patient_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(contacts.len(), 3);
    assert!(contacts.iter().any(|contact| {
        contact.0 == "email"
            && contact.2 == email
            && contact.3
            && contact
                .4
                .as_deref()
                .is_some_and(|notes| notes.contains("granted"))
    }));
    assert!(contacts.iter().any(|contact| {
        contact.0 == "phone"
            && contact.2 == "+4915112345678"
            && contact.3
            && contact
                .4
                .as_deref()
                .is_some_and(|notes| notes.contains("WhatsApp") && notes.contains("declined"))
    }));
    assert!(contacts.iter().any(|contact| {
        contact.0 == "phone" && contact.1 == "work" && contact.2 == "+49 30 4444"
    }));

    let imported_document: (
        Option<Uuid>,
        Option<Uuid>,
        Option<String>,
        bool,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT patient_id, lead_id, ursprung, is_medical, category FROM documents WHERE id = $1",
    )
    .bind(source_attachment_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(imported_document.0, Some(patient_id));
    assert_eq!(imported_document.1, None);
    assert_eq!(imported_document.2.as_deref(), Some("questionnaire"));
    assert!(imported_document.3);
    assert_eq!(imported_document.4.as_deref(), Some("medical"));
    let imported_at_exists: bool =
        sqlx::query_scalar("SELECT imported_at IS NOT NULL FROM lead_attachments WHERE id = $1")
            .bind(source_attachment_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(imported_at_exists);

    let (case_patient_id, case_lead_id, case_notes): (Option<Uuid>, Option<Uuid>, Option<String>) =
        sqlx::query_as("SELECT patient_id, lead_id, notes FROM cases WHERE id = $1")
            .bind(artifacts.case_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(case_patient_id, Some(patient_id));
    assert!(case_lead_id.is_none());
    assert_eq!(
        case_notes.as_deref(),
        Some("Manager service note from the lead")
    );

    let moved_document_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM documents WHERE id = ANY($1) AND patient_id = $2 AND lead_id IS NULL",
    )
    .bind(&artifacts.document_ids)
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(moved_document_count, artifacts.document_ids.len() as i64);

    let (documents_status, patient_documents) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &pm,
        None,
    )
    .await;
    assert_eq!(documents_status, StatusCode::OK, "{patient_documents}");
    let patient_document_ids = patient_documents
        .as_array()
        .expect("patient documents")
        .iter()
        .filter_map(|document| document["id"].as_str().map(str::to_string))
        .collect::<Vec<_>>();
    assert!(patient_document_ids.contains(&source_attachment_id.to_string()));
    for document_id in &artifacts.document_ids {
        assert!(patient_document_ids.contains(&document_id.to_string()));
    }

    let (contract_patient_id, contract_lead_id): (Option<Uuid>, Option<Uuid>) =
        sqlx::query_as("SELECT patient_id, lead_id FROM framework_contracts WHERE id = $1")
            .bind(artifacts.contract_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(contract_patient_id, Some(patient_id));
    assert!(contract_lead_id.is_none());

    let (order_patient_id, source_lead_id): (Option<Uuid>, Option<Uuid>) =
        sqlx::query_as("SELECT patient_id, source_lead_id FROM orders WHERE id = $1")
            .bind(artifacts.order_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(order_patient_id, Some(patient_id));
    assert_eq!(source_lead_id, Some(lead_id));

    let service_patient_id: Option<Uuid> =
        sqlx::query_scalar("SELECT patient_id FROM order_leistungen WHERE id = $1")
            .bind(artifacts.service_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(service_patient_id, Some(patient_id));
    let quote_order_id: Uuid = sqlx::query_scalar("SELECT order_id FROM quotes WHERE id = $1")
        .bind(artifacts.quote_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(quote_order_id, artifacts.order_id);

    let assignment_exists: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM patient_assignments
               WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL
           )"#,
    )
    .bind(patient_id)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(assignment_exists);

    let converted_patient_id: Option<Uuid> =
        sqlx::query_scalar("SELECT converted_patient_id FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(converted_patient_id, Some(patient_id));

    let cave: (String, Option<String>) = sqlx::query_as(
        "SELECT label, note FROM patient_clinical_warnings WHERE patient_id = $1 AND kind = 'cave'",
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(cave.0, "Antikoagulation");
    assert_eq!(cave.1.as_deref(), Some("Vor Eingriff prüfen"));

    let allergy: (String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT label, reaction, severity FROM patient_clinical_warnings WHERE patient_id = $1 AND kind = 'allergie'",
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(allergy.0, "Penicillin");
    assert_eq!(allergy.1.as_deref(), Some("Exanthem"));
    assert_eq!(allergy.2.as_deref(), Some("mittel"));

    let diagnosis: (String, Option<String>, Option<String>, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "SELECT label, icd_code, chronifizierung, provider_id, doctor_id FROM patient_diagnoses WHERE patient_id = $1 AND label = 'Gonarthrose'",
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(diagnosis.0, "Gonarthrose");
    assert_eq!(diagnosis.1.as_deref(), Some("M17.9"));
    assert_eq!(diagnosis.2.as_deref(), Some("chronisch"));
    assert_eq!(diagnosis.3, Some(clinical_provider_id));
    assert_eq!(diagnosis.4, Some(clinical_doctor_id));

    let procedure: (String, Option<String>, Option<String>) = sqlx::query_as(
        r#"SELECT procedure.label, procedure.ops_code, parent.label
           FROM patient_diagnoses procedure
           LEFT JOIN patient_diagnoses parent ON parent.id = procedure.parent_id
           WHERE procedure.patient_id = $1 AND procedure.kind = 'prozedur'"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(procedure.0, "Kniearthroskopie");
    assert_eq!(procedure.1.as_deref(), Some("5-810.0h"));
    assert_eq!(procedure.2.as_deref(), Some("Gonarthrose"));

    let external_diagnosis: (String, Option<String>, Option<String>, Option<String>) =
        sqlx::query_as(
            r#"SELECT source_mode, external_clinic, external_doctor, external_country
               FROM patient_diagnoses
               WHERE patient_id = $1 AND label = 'Hypertonie'"#,
        )
        .bind(patient_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(external_diagnosis.0, "extern");
    assert_eq!(external_diagnosis.1.as_deref(), Some("Kyiv Heart Center"));
    assert_eq!(external_diagnosis.2.as_deref(), Some("Dr. Kovalenko"));
    assert_eq!(external_diagnosis.3.as_deref(), Some("UA"));

    let medication: (String, Option<String>, Option<String>, Option<String>, bool, bool) = sqlx::query_as(
        "SELECT handelsname, einnahmeform, hinweis, dose_morgens, apothekenpflichtig, aut_idem_sperre FROM patient_medications WHERE patient_id = $1 AND handelsname = 'Ibuprofen'",
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(medication.0, "Ibuprofen");
    assert_eq!(medication.1.as_deref(), Some("Oral"));
    assert_eq!(medication.2.as_deref(), Some("1-0-1"));
    assert_eq!(medication.3.as_deref(), Some("1"));
    assert!(medication.4);
    assert!(medication.5);

    let held_medication: ConvertedMedicationRow = sqlx::query_as(
        r#"SELECT handelsname, staerke, status, on_hold, hold_until, hold_note,
                  rezeptpflichtig, provider_id, doctor_id
               FROM patient_medications
               WHERE patient_id = $1 AND handelsname = 'Bisoprolol-ratiopharm'"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(held_medication.0, "Bisoprolol-ratiopharm");
    assert_eq!(held_medication.1.as_deref(), Some("5 mg"));
    assert_eq!(held_medication.2, "pausiert");
    assert!(held_medication.3);
    assert_eq!(held_medication.4.as_deref(), Some("2026-08-01"));
    assert_eq!(held_medication.5.as_deref(), Some("Vor Eingriff pausieren"));
    assert!(held_medication.6);
    assert_eq!(held_medication.7, Some(clinical_provider_id));
    assert_eq!(held_medication.8, Some(clinical_doctor_id));

    let narrative: ConvertedNarrativeRow = sqlx::query_as(
        r#"SELECT anamnese_aktuelle, anamnese_vorgeschichte, anamnese_vegetative,
                  anamnese_sozial, beurteilung
           FROM patient_clinical_narrative
           WHERE patient_id = $1 AND is_active"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        narrative.0.as_deref(),
        Some("Belastungsabhängige Knieschmerzen")
    );
    assert_eq!(narrative.1.as_deref(), Some("Arthroskopie 2018"));
    assert_eq!(narrative.2.as_deref(), Some("Unauffällig"));
    assert_eq!(narrative.3.as_deref(), Some("Lebt selbstständig"));
    assert_eq!(
        narrative.4.as_deref(),
        Some("Orthopädische Abklärung empfohlen")
    );

    let (delete_status, delete_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{source_attachment_id}/delete"),
        &pm,
        Some(json!({ "reason": "Questionnaire source file is no longer required" })),
    )
    .await;
    assert_eq!(delete_status, StatusCode::OK, "{delete_body}");
    let source_storage: (i32, i64) =
        sqlx::query_as("SELECT octet_length(data), size_bytes FROM lead_attachments WHERE id = $1")
            .bind(source_attachment_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(source_storage, (0, 0));
}

#[tokio::test]
async fn lead_order_draft_is_idempotent_before_patient_conversion() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads
               (first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, qualification_status, compliance_status,
                intake_source, needs_interpreter, services)
           VALUES ('Retry','Wizard','retry@example.com','+49151','DE','de',
                   DATE '1990-05-01','female','new','pending','staff_wizard',
                   true, ARRAY['driver', 'concierge'])
           RETURNING id"#,
    )
    .fetch_one(pool)
    .await
    .unwrap();

    let pm = app.auth_header("patient_manager");
    let payload = json!({
        "source_lead_id": lead_id,
        "needs_description": "Retry-safe draft"
    });

    let (first_status, first) =
        json_request(&app, "POST", "/api/v1/orders", &pm, Some(payload.clone())).await;
    assert_eq!(first_status, StatusCode::CREATED, "{first}");
    let order_id = first["id"].as_str().unwrap();
    let order_uuid = Uuid::parse_str(order_id).unwrap();
    let planning: (bool, bool, String) = sqlx::query_as(
        r#"SELECT interpreter_required, non_medical_required, interpreter_briefing_status
           FROM order_planning_preparation WHERE order_id = $1"#,
    )
    .bind(order_uuid)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(planning.0);
    assert!(planning.1);
    assert_eq!(planning.2, "pending");

    sqlx::query("DELETE FROM order_execution_flows WHERE order_id = $1")
        .bind(order_uuid)
        .execute(pool)
        .await
        .unwrap();

    let (retry_status, retry) =
        json_request(&app, "POST", "/api/v1/orders", &pm, Some(payload)).await;
    assert_eq!(retry_status, StatusCode::OK, "{retry}");
    assert_eq!(retry["id"], first["id"]);
    assert_eq!(retry["order_number"], first["order_number"]);
    let execution_state_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM order_execution_flows WHERE order_id = $1")
            .bind(order_uuid)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(execution_state_count, 1);

    let patient_manager_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE role = 'patient_manager' ORDER BY created_at LIMIT 1",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let agency_service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO agency_service_catalog (
               service_key, service_name, unit_label, unit_price, currency,
               vat_rate, is_active, valid_from, created_by
           ) VALUES ($1, 'Initial consultation', 'case', 100, 'EUR', 19, true, CURRENT_DATE, $2)
           RETURNING id"#,
    )
    .bind(format!("lead-wizard-test-{lead_id}"))
    .bind(patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();

    let line_path = format!("/api/v1/orders/{order_id}/leistungen");
    let client_reference = format!("lead-wizard:{lead_id}:line-1");
    let (line_status, line) = json_request(
        &app,
        "POST",
        &line_path,
        &pm,
        Some(json!({
            "agency_service_id": agency_service_id,
            "description": "Initial consultation",
            "quantity": 1.0,
            "unit_price": 100.0,
            "vat_rate": 19.0,
            "notes": "Initial values",
            "client_reference": client_reference,
        })),
    )
    .await;
    assert_eq!(line_status, StatusCode::CREATED, "{line}");

    let (line_retry_status, line_retry) = json_request(
        &app,
        "POST",
        &line_path,
        &pm,
        Some(json!({
            "agency_service_id": agency_service_id,
            "description": "Updated specialist consultation",
            "quantity": 2.0,
            "unit_price": 175.0,
            "vat_rate": 7.0,
            "notes": "Latest wizard values",
            "client_reference": client_reference,
        })),
    )
    .await;
    assert_eq!(line_retry_status, StatusCode::OK, "{line_retry}");
    assert_eq!(line_retry["id"], line["id"]);

    let (lines_status, lines) = json_request(&app, "GET", &line_path, &pm, None).await;
    assert_eq!(lines_status, StatusCode::OK, "{lines}");
    let matching_lines = lines
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["client_reference"] == client_reference)
        .collect::<Vec<_>>();
    assert_eq!(matching_lines.len(), 1, "{lines}");
    assert_eq!(
        matching_lines[0]["description"],
        "Updated specialist consultation"
    );
    assert_eq!(matching_lines[0]["quantity"], "2");
    assert_eq!(matching_lines[0]["unit_price"], "175");
    assert_eq!(matching_lines[0]["vat_rate"], "7");
    assert_eq!(matching_lines[0]["notes"], "Latest wizard values");
    assert_eq!(
        matching_lines[0]["agency_service_id"],
        agency_service_id.to_string()
    );

    for (suffix, invalid_fields) in [
        ("description", json!({ "description": " " })),
        ("quantity", json!({ "quantity": 0.0 })),
        ("price", json!({ "unit_price": -1.0 })),
        ("vat", json!({ "vat_rate": 101.0 })),
    ] {
        let mut invalid_payload = json!({
            "description": "Invalid service",
            "quantity": 1.0,
            "unit_price": 10.0,
            "vat_rate": 19.0,
            "client_reference": format!("lead-wizard:{lead_id}:invalid-{suffix}"),
        });
        invalid_payload
            .as_object_mut()
            .unwrap()
            .extend(invalid_fields.as_object().unwrap().clone());
        let (invalid_status, invalid_body) =
            json_request(&app, "POST", &line_path, &pm, Some(invalid_payload)).await;
        assert_eq!(
            invalid_status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{suffix}: {invalid_body}"
        );
    }
}

#[tokio::test]
async fn wizard_convert_requires_identity_basics() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;

    // Missing date_of_birth and legal_sex.
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, qualification_status, compliance_status, intake_source)
           VALUES ('No','Dob','nodob@example.com','new','pending','staff_wizard') RETURNING id"#,
    )
    .fetch_one(pool)
    .await
    .unwrap();

    let pm = app.auth_header("patient_manager");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/wizard-convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn wizard_lead_fields_round_trip_through_update() {
    let Some(app) = test_app().await else {
        return;
    };
    let pm = app.auth_header("patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({ "first_name": "Test", "last_name": "Wizard", "email": "wiz@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = created["id"].as_str().unwrap().to_string();
    let primary_trusted_contact_id = Uuid::new_v4();
    let secondary_trusted_contact_id = Uuid::new_v4();

    // Edit wizard fields (Steps 1-3 + resume state).
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({
            "primary_concern_text": "Chronic knee pain",
            "services": ["surgery", "rehab"],
            "middle_name": "Marie",
            "suffix": "Jr.",
            "street_address": "Hauptstr. 1",
            "state": "Berlin",
            "whatsapp_number": "+49 151 1234567",
            "primary_language": "Spanish",
            "has_insurance": true,
            "insurance_covers_germany": "yes",
            "insurance_provider": "Test Versicherung",
            "insurance_number": "POL-123",
            "insurance_type": "private",
            "trusted_contacts": [
                {
                    "id": primary_trusted_contact_id,
                    "name": "Alex Wizard",
                    "phone": "+49 30 123456",
                    "email": "alex.wizard@example.test",
                    "relation": "Partner",
                    "birth_date": "1989-02-03",
                    "address": "Nebenstr. 2, Berlin"
                },
                {
                    "id": secondary_trusted_contact_id,
                    "name": "Maria Wizard",
                    "phone": "+49 30 654321",
                    "email": "maria.wizard@example.test",
                    "relation": "Sister",
                    "birth_date": "1992-04-05",
                    "address": "Seitenstr. 4, Berlin"
                }
            ],
            "requested_specialties": ["orthopedics", "surgery"],
            "wizard_state": { "step": 3, "completed": ["identity", "eligibility"] }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Read them back through get_lead.
    let (status, lead) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(lead["primary_concern_text"], "Chronic knee pain");
    assert_eq!(lead["middle_name"], "Marie");
    assert_eq!(lead["suffix"], "Jr.");
    assert_eq!(lead["street_address"], "Hauptstr. 1");
    assert_eq!(lead["state"], "Berlin");
    assert_eq!(lead["whatsapp_number"], "+49 151 1234567");
    assert_eq!(lead["primary_language"], "es");
    assert_eq!(lead["has_insurance"], true);
    assert_eq!(lead["insurance_covers_germany"], "yes");
    assert_eq!(lead["insurance_provider"], "Test Versicherung");
    assert_eq!(lead["insurance_number"], "POL-123");
    assert_eq!(lead["insurance_type"], "private");
    assert_eq!(lead["trusted_contact_name"], "Alex Wizard");
    assert_eq!(lead["trusted_contact_phone"], "+49 30 123456");
    assert_eq!(lead["trusted_contact_email"], "alex.wizard@example.test");
    assert_eq!(lead["trusted_contact_relation"], "Partner");
    assert_eq!(lead["trusted_contact_birth_date"], "1989-02-03");
    assert_eq!(lead["trusted_contact_address"], "Nebenstr. 2, Berlin");
    assert_eq!(lead["trusted_contacts"].as_array().unwrap().len(), 2);
    assert_eq!(
        lead["trusted_contacts"][0]["id"],
        primary_trusted_contact_id.to_string()
    );
    assert_eq!(lead["trusted_contacts"][0]["name"], "Alex Wizard");
    assert_eq!(
        lead["trusted_contacts"][1]["id"],
        secondary_trusted_contact_id.to_string()
    );
    assert_eq!(lead["trusted_contacts"][1]["name"], "Maria Wizard");
    assert_eq!(lead["trusted_contacts"][1]["birth_date"], "1992-04-05");
    assert_eq!(
        lead["requested_specialties"],
        json!(["orthopedics", "surgery"])
    );
    assert_eq!(lead["wizard_state"]["step"], 3);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({
            "insurance_covers_germany": "",
            "trusted_contacts": []
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, cleared_lead) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(cleared_lead["insurance_covers_germany"].is_null());
    assert!(cleared_lead["trusted_contact_name"].is_null());
    assert!(cleared_lead["trusted_contact_birth_date"].is_null());
    assert_eq!(cleared_lead["trusted_contacts"], json!([]));

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "trusted_contacts": [{ "name": "" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A non-array requested_specialties is rejected.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "requested_specialties": { "not": "an array" } })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
