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

    let existing_case_id: Option<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM cases
           WHERE lead_id = $1 OR source_lead_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1"#,
    )
    .bind(lead_id)
    .fetch_optional(pool)
    .await
    .unwrap();
    let case_id = if let Some(case_id) = existing_case_id {
        sqlx::query(
            r#"UPDATE cases
               SET hauptanfragegrund = 'Chronic knee pain',
                   zuweiser = 'Self referral',
                   intake_completed_at = now(),
                   intake_completed_by = $2
               WHERE id = $1"#,
        )
        .bind(case_id)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();
        case_id
    } else {
        sqlx::query_scalar(
            r#"INSERT INTO cases (
                    case_id, lead_id, manager_id, status, hauptanfragegrund,
                    zuweiser, intake_completed_at, intake_completed_by
               ) VALUES (
                    $1, $2, $3, 'open', 'Chronic knee pain',
                    'Self referral', now(), $3
               ) RETURNING id"#,
        )
        .bind(format!("C-ONBOARD-{tag}"))
        .bind(lead_id)
        .bind(app.patient_manager_id)
        .fetch_one(pool)
        .await
        .unwrap()
    };

    sqlx::query(
        r#"INSERT INTO patient_clinical_narrative (
                patient_id, case_id, anamnese_aktuelle
           ) SELECT patient_id, id, 'Pain for six months'
             FROM cases WHERE id = $1 AND patient_id IS NOT NULL"#,
    )
    .bind(case_id)
    .execute(pool)
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
           ) ON CONFLICT(source_lead_id) WHERE source_lead_id IS NOT NULL DO UPDATE
             SET contract_id=EXCLUDED.contract_id,needs_description=EXCLUDED.needs_description,
                 prepayment_required=true,total_estimated=119
           RETURNING id"#,
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
                'accepted', 119, now(),
                '[{"description":"Initial orthopedic coordination","quantity":1,"unit_price":100,"vat_rate":19}]'::jsonb,
                $3
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

    sqlx::query("UPDATE orders SET signed_patient=true,signed_agency=true,signed_at=now(),signed_patient_at=now(),signed_agency_at=now() WHERE id=$1").bind(order_id).execute(pool).await.unwrap();
    sqlx::query("UPDATE documents SET order_intake_context=repeat_order_document_context(order_id) WHERE order_id=$1")
        .bind(order_id).execute(pool).await.unwrap();
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
async fn lead_contacts_are_unique_except_for_a_minor_and_linked_guardian() {
    let Some(app) = test_app().await else { return };
    let sales = app.auth_header("sales");
    let guardian_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO patients (
              id, patient_id, first_name, last_name, birth_date, gender,
              email, phone_primary, created_by
           ) VALUES ($1, $2, 'Anna', 'Beispiel', '1985-01-01', 'female',
                     'family@example.org', '+49 170 123 45 67', $3)"#,
    )
    .bind(guardian_id)
    .bind(format!("GUARDIAN-{guardian_id}"))
    .bind(app.patient_manager_id)
    .execute(&app.suite.pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &sales,
        Some(json!({
            "first_name": "Other",
            "last_name": "Adult",
            "date_of_birth": "1990-02-03",
            "email": " FAMILY@example.org "
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Email is already used by another person");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &sales,
        Some(json!({
            "first_name": "Another",
            "last_name": "Adult",
            "date_of_birth": "1991-02-03",
            "phone": "0049 (170) 123-45-67"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Phone is already used by another person");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &sales,
        Some(json!({
            "first_name": "Mia",
            "last_name": "Beispiel",
            "date_of_birth": "2015-02-03",
            "email": "family@example.org",
            "phone": "+49 170 123 45 67",
            "trusted_contacts": [{
                "id": Uuid::new_v4(),
                "related_patient_id": guardian_id,
                "name": "Anna Beispiel",
                "email": "family@example.org",
                "phone": "+49 170 123 45 67",
                "relation": "parent"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");

    let lead_id = created["id"].as_str().unwrap();
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &sales,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(
        detail["trusted_contacts"][0]["related_patient_id"],
        guardian_id.to_string()
    );
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

    let (status, prospect) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({
            "hauptanfragegrund": "Chronic knee pain",
            "zuweiser": "Self referral"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prospect}");

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
async fn converted_lead_is_absent_from_registry_but_detail_remains_auditable() {
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
    sqlx::query("UPDATE leads SET intake_model = 'legacy' WHERE id = $1")
        .bind(Uuid::parse_str(&lead_id).unwrap())
        .execute(&app.suite.pool)
        .await
        .unwrap();

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

    let (status, list) = json_request(&app, "GET", "/api/v1/leads", &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !list
            .as_array()
            .unwrap()
            .iter()
            .any(|lead| lead["id"] == lead_id),
        "converted lead must leave the operational lead registry"
    );

    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["qualification_status"], "converted");
    assert_eq!(
        detail["readiness"]["conversion_ready"].as_bool(),
        Some(false),
        "converted lead detail must remain non-convertible and auditable: {detail}"
    );
}

#[tokio::test]
async fn lead_can_convert_with_the_newest_accepted_quote_while_awaiting_prepayment() {
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

    let (status, prospect) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({"hauptanfragegrund":"Chronic knee pain","zuweiser":"Self referral"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prospect}");
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
    assert!(!readiness_check_passed(
        &initially_ready,
        "prepayment_ready"
    ));

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

    let (status, manual_payment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{newest_quote_id}/status"),
        &billing,
        Some(json!({"status":"accepted", "paid_amount":50})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{manual_payment}");
    let (status, accepted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{newest_quote_id}/status"),
        &billing,
        Some(json!({"status":"accepted"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    assert_eq!(accepted["paid_amount"], "0");
    let (status, unpaid_readiness) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{unpaid_readiness}");
    assert!(readiness_check_passed(&unpaid_readiness, "quote_accepted"));
    assert!(!readiness_check_passed(
        &unpaid_readiness,
        "prepayment_ready"
    ));
    assert_eq!(
        unpaid_readiness["readiness"]["conversion_ready"], true,
        "{unpaid_readiness}"
    );
    let payment_check = unpaid_readiness["readiness"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["key"] == "prepayment_ready")
        .unwrap();
    assert!(payment_check["blocking_for"].is_null());

    sqlx::query("UPDATE order_leistungen SET unit_price = 110 WHERE id = $1")
        .bind(artifacts.service_id)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET total_estimated = 130.90 WHERE id = $1")
        .bind(artifacts.order_id)
        .execute(&app.suite.pool)
        .await
        .unwrap();

    let (status, drifted_readiness) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{drifted_readiness}");
    assert!(!readiness_check_passed(
        &drifted_readiness,
        "quote_accepted"
    ));
    assert!(!readiness_check_passed(
        &drifted_readiness,
        "prepayment_ready"
    ));
    assert_eq!(drifted_readiness["readiness"]["conversion_ready"], false);
    // Restore the signed commercial scope, then actually convert with zero cash.
    sqlx::query("UPDATE order_leistungen SET unit_price=100 WHERE id=$1")
        .bind(artifacts.service_id)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET total_estimated=119,prepayment_due_at=now()+interval '3 days' WHERE id=$1")
        .bind(artifacts.order_id).execute(&app.suite.pool).await.unwrap();
    let (status, converted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &pm,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    let preserved: bool = sqlx::query_scalar("SELECT patient_id IS NOT NULL AND prepayment_required AND prepayment_due_at IS NOT NULL AND order_recorded_cash_paid(id)=0 FROM orders WHERE id=$1")
        .bind(artifacts.order_id).fetch_one(&app.suite.pool).await.unwrap();
    assert!(
        preserved,
        "conversion must preserve the pending payment and deadline"
    );
}

#[tokio::test]
async fn lead_readiness_normalizes_cost_passthrough_vat() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Passthrough",
            "last_name": "Quote",
            "email": format!("passthrough-quote-{tag}@test.local"),
            "phone": "+49111000002",
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
    sqlx::query("UPDATE order_leistungen SET is_cost_passthrough = true WHERE id = $1")
        .bind(artifacts.service_id)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    sqlx::query(
        r#"UPDATE quotes
           SET total_vat = 0,
               total_gross = 100,
               line_items = '[{"description":"Initial orthopedic coordination","quantity":1,"unit_price":100,"vat_rate":0,"is_cost_passthrough":true}]'::jsonb
           WHERE id = $1"#,
    )
    .bind(artifacts.quote_id)
    .execute(&app.suite.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, status, client_reference
           ) VALUES ($1, 'Already invoiced legacy line', 1, 999, 19, 'invoiced', $2)"#,
    )
    .bind(artifacts.order_id)
    .bind(format!("lead-onboarding:{lead_id}:service:invoiced"))
    .execute(&app.suite.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE orders SET total_estimated = 100, prepayment_amount = 100 WHERE id = $1")
        .bind(artifacts.order_id)
        .execute(&app.suite.pool)
        .await
        .unwrap();

    let (status, lead) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    let check_passed = |key: &str| {
        lead["readiness"]["checks"]
            .as_array()
            .and_then(|checks| checks.iter().find(|check| check["key"] == key))
            .and_then(|check| check["passed"].as_bool())
            .unwrap_or(false)
    };
    assert!(check_passed("quote_accepted"), "{lead}");
    assert!(!check_passed("prepayment_ready"), "{lead}");
    assert_eq!(lead["readiness"]["conversion_ready"], true, "{lead}");
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
        Some(json!({ "confirmed": true })),
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
async fn patient_first_conversion_activates_the_prospect_and_keeps_case_provenance() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let email = format!("patient-first-{}@example.com", Uuid::new_v4().simple());
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, street_address, city, zip_code,
                primary_concern_text, requested_specialties,
                qualification_status, compliance_status,
                consent_healthcare, consent_privacy_practices,
                intake_source, intake_model, created_by, wizard_state
           ) VALUES (
                'Identity', 'First', $1, '+4915112345678', 'DE', 'de',
                DATE '1990-05-01', 'female', 'Hauptstr. 1', 'Berlin', '10115',
                'Chronic knee pain', '["orthopedics"]'::jsonb,
                'qualified', 'signed', true, true,
                'staff_wizard', 'patient_first', $2,
                '{"registration_country":"UA","passport_expiry":"2034-05-31"}'::jsonb
           ) RETURNING id"#,
    )
    .bind(&email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let pm = app.auth_header("patient_manager");

    let (status, prospect) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({
            "hauptanfragegrund": "Chronic knee pain",
            "zuweiser": "Self referral"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prospect}");
    assert_eq!(prospect["lifecycle_status"], "prospective");
    let patient_id = Uuid::parse_str(prospect["patient_id"].as_str().unwrap()).unwrap();
    let case_id = Uuid::parse_str(prospect["case_id"].as_str().unwrap()).unwrap();

    let lifecycle: (String, bool) =
        sqlx::query_as("SELECT lifecycle_status, is_active FROM patients WHERE id = $1")
            .bind(patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(lifecycle, ("prospective".to_string(), false));
    let prospect_passport: (Option<String>, Option<chrono::NaiveDate>) =
        sqlx::query_as("SELECT nationality, passport_expiry FROM patients WHERE id = $1")
            .bind(patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(prospect_passport.0.as_deref(), Some("UA"));
    assert_eq!(
        prospect_passport
            .1
            .map(|value| value.to_string())
            .as_deref(),
        Some("2034-05-31")
    );
    let case_subject: (Option<Uuid>, Option<Uuid>, Option<Uuid>) =
        sqlx::query_as("SELECT patient_id, lead_id, source_lead_id FROM cases WHERE id = $1")
            .bind(case_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(case_subject, (Some(patient_id), None, Some(lead_id)));
    let assignment_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_assignments WHERE patient_id = $1 AND revoked_at IS NULL",
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(assignment_count >= 1);

    sqlx::query(
        r#"UPDATE leads
           SET wizard_state = wizard_state || '{"registration_country":"AT","passport_expiry":"2035-06-30"}'::jsonb
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();

    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    assert_eq!(artifacts.case_id, case_id);
    let (status, lead) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert_eq!(lead["readiness"]["conversion_ready"], true, "{lead}");

    let (status, converted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/wizard-convert"),
        &pm,
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    assert_eq!(converted["patient_id"], patient_id.to_string());

    let activated: (String, bool, Option<String>, Option<chrono::NaiveDate>) =
        sqlx::query_as("SELECT lifecycle_status, is_active, nationality, passport_expiry FROM patients WHERE id = $1")
            .bind(patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(activated.0, "active");
    assert!(activated.1);
    assert_eq!(activated.2.as_deref(), Some("AT"));
    assert_eq!(
        activated.3.map(|value| value.to_string()).as_deref(),
        Some("2035-06-30")
    );
    let patient_count: i64 = sqlx::query_scalar("SELECT count(*) FROM patients WHERE email = $1")
        .bind(&email)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        patient_count, 1,
        "conversion must activate, not duplicate, the prospect"
    );
    let converted_case: (Option<Uuid>, Option<Uuid>, Option<Uuid>) =
        sqlx::query_as("SELECT patient_id, lead_id, source_lead_id FROM cases WHERE id = $1")
            .bind(case_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(converted_case, (Some(patient_id), None, Some(lead_id)));
    let order_case_id: Option<Uuid> =
        sqlx::query_scalar("SELECT case_id FROM orders WHERE id = $1")
            .bind(artifacts.order_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(order_case_id, Some(case_id));

    for path in [
        format!("/api/v1/cases?lead_id={lead_id}"),
        format!("/api/v1/cases?patient_id={patient_id}"),
    ] {
        let (status, cases) = json_request(&app, "GET", &path, &pm, None).await;
        assert_eq!(status, StatusCode::OK, "{path}: {cases}");
        assert!(
            cases.as_array().unwrap().iter().any(|case| {
                case["id"] == case_id.to_string()
                    && case["source_lead_id"] == lead_id.to_string()
                    && case["patient_id"] == patient_id.to_string()
            }),
            "converted case must remain discoverable by lead provenance and patient: {cases}"
        );
    }

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=case"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{timeline}");
    assert!(
        timeline["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["entity_id"] == case_id.to_string()),
        "converted case must remain visible in the patient timeline: {timeline}"
    );
}

#[tokio::test]
async fn returning_patient_attach_reuses_identity_without_overwriting_master_data() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let existing_email = format!("existing-{tag}@example.com");
    let incoming_email = format!("incoming-{tag}@example.com");
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender,
                email, notes, lifecycle_status, is_active, created_by, languages
           ) VALUES (
                $1, 'Returning', 'Patient', DATE '1982-04-03', 'female',
                $2, 'Existing longitudinal note', 'active', true, $3, ARRAY['de']::text[]
           ) RETURNING id"#,
    )
    .bind(format!("P-RETURNING-{tag}"))
    .bind(&existing_email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$2)")
        .bind(patient_id)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, street_address, city, zip_code,
                primary_concern_text, requested_specialties,
                qualification_status, compliance_status,
                consent_healthcare, consent_privacy_practices,
                intake_source, intake_model, created_by
           ) VALUES (
                'Returning', 'Patient', $1, '+4915776543210', 'DE', 'de',
                DATE '1982-04-03', 'female', 'Neue Str. 2', 'Berlin', '10115',
                'New episode concern', '["orthopedics"]'::jsonb,
                'qualified', 'signed', true, true,
                'staff_wizard', 'patient_first', $2
           ) RETURNING id"#,
    )
    .bind(&incoming_email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let pm = app.auth_header("patient_manager");

    let (status, duplicate_response) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({ "hauptanfragegrund": "New episode concern" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{duplicate_response}");
    let candidates = duplicate_response["duplicate_candidates"]
        .as_array()
        .unwrap();
    assert!(
        candidates
            .iter()
            .any(|candidate| candidate["id"] == patient_id.to_string())
    );
    let patient_count_before: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patients WHERE first_name = 'Returning' AND last_name = 'Patient'",
    )
    .fetch_one(pool)
    .await
    .unwrap();

    let (status, attached) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({
            "attach_patient_id": patient_id,
            "hauptanfragegrund": "New episode concern"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{attached}");
    assert_eq!(attached["patient_id"], patient_id.to_string());
    assert_eq!(attached["attached"], true);
    assert_eq!(attached["lifecycle_status"], "active");
    let case_id = Uuid::parse_str(attached["case_id"].as_str().unwrap()).unwrap();

    let replay_body = json!({ "attach_patient_id": patient_id });
    let replay_path = format!("/api/v1/leads/{lead_id}/prospect");
    let (first_replay, second_replay) = tokio::join!(
        json_request(&app, "POST", &replay_path, &pm, Some(replay_body.clone())),
        json_request(&app, "POST", &replay_path, &pm, Some(replay_body)),
    );
    for (status, replay) in [first_replay, second_replay] {
        assert_eq!(status, StatusCode::OK, "{replay}");
        assert_eq!(replay["patient_id"], patient_id.to_string());
        assert_eq!(replay["case_id"], case_id.to_string());
    }
    let case_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM cases WHERE source_lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(case_count, 1, "repeated attachment must reuse the episode");

    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    assert_eq!(artifacts.case_id, case_id);
    // Reuse previous patient confirmations and the signed framework for the whole new visit.
    sqlx::query("UPDATE patients SET legal_status = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(json!({"identity_verified": true, "dsgvo_signed": true,
            "confidentiality_release_signed": true, "compliance_completed": true}))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE documents SET patient_id = $2, lead_id = NULL WHERE lead_id = $1 AND compliance_kind IN ('identity', 'dsgvo', 'confidentiality_release')")
        .bind(lead_id).bind(patient_id).execute(pool).await.unwrap();
    sqlx::query("UPDATE framework_contracts SET patient_id = $2, lead_id = NULL, valid_from = DATE '2030-01-01', valid_to = DATE '2030-12-31' WHERE id = $1")
        .bind(artifacts.contract_id).bind(patient_id).execute(pool).await.unwrap();
    let contract_path = format!("/api/v1/orders/{}/commercial-basis", artifacts.order_id);
    let (status, response) = json_request(&app, "POST", &contract_path, &pm,
        Some(json!({"contract_id": artifacts.contract_id, "date_from": "2030-09-01", "date_to": "2030-09-15"}))).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    sqlx::query("UPDATE documents SET order_intake_context=repeat_order_document_context(order_id) WHERE order_id=$1")
        .bind(artifacts.order_id).execute(pool).await.unwrap();
    let other_patient: Uuid = sqlx::query_scalar("INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, lifecycle_status, created_by) VALUES ($1, 'Other', 'Patient', DATE '1985-01-01', 'female', 'active', $2) RETURNING id")
        .bind(format!("P-OTHER-{tag}")).bind(app.patient_manager_id).fetch_one(pool).await.unwrap();
    let other_contract: Uuid = sqlx::query_scalar("INSERT INTO framework_contracts (patient_id, contract_number, signed_at, status, created_by) VALUES ($1, $2, now(), 'signed', $3) RETURNING id")
        .bind(other_patient).bind(format!("FC-OTHER-{tag}")).bind(app.patient_manager_id).fetch_one(pool).await.unwrap();
    let (status, response) = json_request(
        &app,
        "POST",
        &contract_path,
        &pm,
        Some(json!({"contract_id": other_contract})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{response}");
    // Expiry during the visit fails even if the stored status still says signed.
    for (contract_status, end) in [("signed", "2030-09-14"), ("expired", "2030-12-31")] {
        sqlx::query(
            "UPDATE framework_contracts SET status = $2, valid_to = $3::text::date WHERE id = $1",
        )
        .bind(artifacts.contract_id)
        .bind(contract_status)
        .bind(end)
        .execute(pool)
        .await
        .unwrap();
        let (status, checked) =
            json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
        assert_eq!(status, StatusCode::OK, "{checked}");
        assert_eq!(checked["readiness"]["conversion_ready"], false, "{checked}");
        let contract_check = checked["readiness"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "contract_signed")
            .unwrap();
        assert_eq!(contract_check["passed"], false, "{contract_check}");
    }
    sqlx::query("UPDATE framework_contracts SET status = 'signed', valid_to = DATE '2030-12-31' WHERE id = $1")
        .bind(artifacts.contract_id).execute(pool).await.unwrap();

    let (status, lead) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert_eq!(lead["readiness"]["conversion_ready"], true, "{lead}");

    let (status, converted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/wizard-convert"),
        &pm,
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    assert_eq!(converted["patient_id"], patient_id.to_string());

    let preserved: (Option<String>, Option<String>, Option<Uuid>, String, bool) = sqlx::query_as(
        r#"SELECT email, notes, source_lead_id, lifecycle_status, is_active
           FROM patients WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(preserved.0.as_deref(), Some(existing_email.as_str()));
    assert_eq!(preserved.1.as_deref(), Some("Existing longitudinal note"));
    assert_eq!(preserved.2, None);
    assert_eq!(preserved.3, "active");
    assert!(preserved.4);
    let patient_count_after: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patients WHERE first_name = 'Returning' AND last_name = 'Patient'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(patient_count_after, patient_count_before);
}

#[tokio::test]
async fn failed_lead_purges_only_unconverted_prospect_and_preserves_attached_patient() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let ceo = app.auth_header("ceo");
    let tag = Uuid::new_v4().simple().to_string();

    let prospect_lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, qualification_status, intake_source,
                intake_model, created_by
           ) VALUES (
                'Purge', 'Prospect', $1, '+4915111111111', 'DE', 'de',
                DATE '1991-01-01', 'female', 'in_progress', 'staff_wizard',
                'patient_first', $2
           ) RETURNING id"#,
    )
    .bind(format!("purge-{tag}@example.com"))
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let (status, prospect) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{prospect_lead_id}/prospect"),
        &pm,
        Some(json!({ "hauptanfragegrund": "Temporary concern" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prospect}");
    let prospect_patient_id = Uuid::parse_str(prospect["patient_id"].as_str().unwrap()).unwrap();
    let (status, saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{prospect_patient_id}/diagnoses"),
        &ceo,
        Some(json!({ "items": [{ "kind": "main", "label": "Temporary diagnosis" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let version_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_clinical_versions WHERE patient_id = $1")
            .bind(prospect_patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(version_count > 0);

    let (status, deleted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{prospect_lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{deleted}");
    let prospect_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(prospect_patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!prospect_exists);
    let version_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM patient_clinical_versions WHERE patient_id = $1)",
    )
    .bind(prospect_patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(!version_exists);

    let active_patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender,
                lifecycle_status, is_active, created_by, languages
           ) VALUES (
                $1, 'Keep', 'Patient', DATE '1985-05-05', 'male',
                'active', true, $2, ARRAY['de']::text[]
           ) RETURNING id"#,
    )
    .bind(format!("P-KEEP-{tag}"))
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let attached_lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, qualification_status, intake_source,
                intake_model, created_by
           ) VALUES (
                'Keep', 'Patient', $1, '+4915222222222', 'DE', 'de',
                DATE '1985-05-05', 'male', 'in_progress', 'staff_wizard',
                'patient_first', $2
           ) RETURNING id"#,
    )
    .bind(format!("keep-{tag}@example.com"))
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)")
        .bind(active_patient_id)
        .bind(app.patient_manager_id)
        .bind(app.ceo_id)
        .execute(pool)
        .await
        .unwrap();
    let (status, attached) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{attached_lead_id}/prospect"),
        &pm,
        Some(json!({ "attach_patient_id": active_patient_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{attached}");
    let (status, deleted_lead) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{attached_lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{deleted_lead}");
    let active_patient_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(active_patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(
        active_patient_exists,
        "attached active patient must never be purged with a lead"
    );
}

#[tokio::test]
async fn ready_lead_conversion_atomically_transfers_onboarding_artifacts() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let email = format!("atomic-{}@example.com", Uuid::new_v4().simple());
    // Historical wizard snapshots can still contain the removed clinical_draft
    // shape. Conversion preserves the snapshot but must not recreate clinical
    // rows; clinical data now belongs to the prospect patient before conversion.
    let clinical_provider_id = Uuid::new_v4();
    let clinical_doctor_id = Uuid::new_v4();
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
                consent_healthcare, consent_privacy_practices, intake_source, intake_model, created_by,
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
                'qualified', 'signed', true, true, 'staff_wizard', 'legacy', $2,
                $3::jsonb
           ) RETURNING id"#,
    )
    .bind(&email)
    .bind(app.patient_manager_id)
    .bind(
        json!({
            "discovery_source": "customer_referral",
            "referrer": "Dr. Referral",
            "registration_country": "UA",
            "passport_expiry": "2034-05-31",
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
        Some(json!({ "confirmed": true })),
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
    assert_eq!(
        patient.2.as_deref(),
        Some("UA"),
        "citizenship must come from the dedicated wizard field"
    );
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
    assert_eq!(patient.13["nationality"], "UA");
    assert_eq!(patient.13["passport_expiry"], "2034-05-31");
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
    assert_eq!(patient_detail["nationality"], "UA");
    assert_eq!(patient_detail["passport_expiry"], "2034-05-31");
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

    let trusted_contacts: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT related_name, relation_type, phone, notes
               FROM patient_relations
               WHERE patient_id = $1 AND is_emergency_contact = true
               ORDER BY related_name"#,
    )
    .bind(patient_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(trusted_contacts.len(), 2);
    assert!(trusted_contacts.iter().any(|contact| {
        contact.0 == "Olena Onboarding"
            && contact.1 == "sibling"
            && contact.2.as_deref() == Some("+380 44 555 0101")
            && contact.3.as_deref().is_some_and(|notes| {
                notes.contains("olena@example.test")
                    && notes.contains("1985-02-03")
                    && notes.contains("Khreshchatyk 1, Kyiv")
            })
    }));
    assert!(trusted_contacts.iter().any(|contact| {
        contact.0 == "Petro Onboarding"
            && contact.1 == "sibling"
            && contact.2.as_deref() == Some("+380 44 555 0102")
            && contact.3.as_deref().is_some_and(|notes| {
                notes.contains("petro@example.test")
                    && notes.contains("1987-04-05")
                    && notes.contains("Volodymyrska 2, Kyiv")
            })
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
    assert!(
        patient_documents
            .as_array()
            .expect("patient documents")
            .iter()
            .any(|document| document["art"] == "identity"
                && document["compliance_kind"] == "identity")
    );

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

    let legacy_clinical_rows: i64 = sqlx::query_scalar(
        r#"SELECT
               (SELECT count(*) FROM patient_clinical_warnings WHERE patient_id = $1)
             + (SELECT count(*) FROM patient_diagnoses WHERE patient_id = $1)
             + (SELECT count(*) FROM patient_medications WHERE patient_id = $1)
             + (SELECT count(*) FROM patient_clinical_narrative WHERE patient_id = $1)"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(legacy_clinical_rows, 0);

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
    // Catalog-backed lines retain their resolved price/VAT on retry. Editable
    // description, quantity and notes update without accepting a client price override.
    assert_eq!(matching_lines[0]["unit_price"], "100");
    assert_eq!(matching_lines[0]["vat_rate"], "19");
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
        Some(json!({ "confirmed": true })),
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

async fn seed_repeat_patient(app: &TestApp, assigned: bool) -> Uuid {
    let patient: Uuid=sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,lifecycle_status,created_by,languages) VALUES($1,'Repeat','Regression',DATE '1982-04-03','female','active',$2,ARRAY['de']) RETURNING id")
        .bind(format!("P-REPEAT-{}",Uuid::new_v4())).bind(app.ceo_id).fetch_one(&app.suite.pool).await.unwrap();
    if assigned {
        sqlx::query(
            "INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)",
        )
        .bind(patient)
        .bind(app.patient_manager_id)
        .bind(app.ceo_id)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    }
    patient
}
#[tokio::test]
async fn repeat_intake_creation_is_atomic_replayable_visible_and_archivable() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let patient = seed_repeat_patient(&app, true).await;
    let key = Uuid::new_v4();
    let body = json!({"first_name":"Repeat","last_name":"Regression","repeat_patient_id":patient,"creation_key":key});
    let (a, b) = tokio::join!(
        json_request(&app, "POST", "/api/v1/leads", &pm, Some(body.clone())),
        json_request(&app, "POST", "/api/v1/leads", &pm, Some(body.clone()))
    );
    assert!(a.0.is_success(), "{:?}", a);
    assert!(b.0.is_success(), "{:?}", b);
    assert_eq!(a.1["id"], b.1["id"]);
    let lead = Uuid::parse_str(a.1["id"].as_str().unwrap()).unwrap();
    let (second_status, second) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name":"Repeat",
            "last_name":"Regression",
            "repeat_patient_id":patient,
            "creation_key":Uuid::new_v4()
        })),
    )
    .await;
    assert!(second_status.is_success(), "{second}");
    assert_eq!(
        second["id"],
        lead.to_string(),
        "a patient reuses its active draft"
    );
    let (cases,orders):(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM cases WHERE source_lead_id=$1),(SELECT count(*) FROM orders WHERE source_lead_id=$1)").bind(lead).fetch_one(&app.suite.pool).await.unwrap();
    assert_eq!((cases, orders), (1, 1));
    let (order, state): (Uuid, String) =
        sqlx::query_as("SELECT id,intake_state FROM orders WHERE source_lead_id=$1")
            .bind(lead)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(state, "draft");
    for path in [
        format!("/api/v1/orders/{order}"),
        format!("/api/v1/orders?lead_id={lead}"),
    ] {
        let (s, b) = json_request(&app, "GET", &path, &pm, None).await;
        assert_eq!(s, StatusCode::OK, "{b}");
    }
    let (s, b) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm,
        Some(json!({"source_lead_id":lead})),
    )
    .await;
    assert!(s.is_success(), "{b}");
    assert_eq!(b["id"], order.to_string());
    let (s, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order}"),
        &app.auth_header("billing"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order}/phase"),
        &pm,
        Some(json!({"phase":"planning"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let tracking: i64 =
        sqlx::query_scalar("SELECT count(*) FROM order_payment_tracking WHERE order_id=$1")
            .bind(order)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(tracking, 0);
    let planning: i64 =
        sqlx::query_scalar("SELECT count(*) FROM order_planning_preparation WHERE order_id=$1")
            .bind(order)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(planning, 0);
    for path in [
        format!("/api/v1/patients/{patient}/orders"),
        format!("/api/v1/patients/{patient}/repeat-intakes"),
    ] {
        let (s, b) = json_request(&app, "GET", &path, &pm, None).await;
        assert_eq!(s, StatusCode::OK, "{b}");
        assert_eq!(b.as_array().unwrap().len(), 1);
    }
    let (s, b) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead}/failed-flow"),
        &pm,
        Some(json!({"resolution":"archive","reason":"not_our_lead"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(status, "cancelled");
    let (_, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/repeat-intakes"),
        &pm,
        None,
    )
    .await;
    assert!(list.as_array().unwrap().is_empty());
    let (_, patient_orders) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/orders"),
        &pm,
        None,
    )
    .await;
    assert!(
        patient_orders.as_array().unwrap().is_empty(),
        "discarded drafts must leave the active patient order list"
    );
    let (s, b) = json_request(&app, "POST", "/api/v1/leads", &pm, Some(body)).await;
    assert!(s.is_success());
    assert_eq!(b["id"], lead.to_string());
    let (s, fresh) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name":"Repeat",
            "last_name":"Regression",
            "repeat_patient_id":patient,
            "creation_key":Uuid::new_v4()
        })),
    )
    .await;
    assert!(s.is_success(), "{fresh}");
    assert_ne!(
        fresh["id"],
        lead.to_string(),
        "discarding allows a fresh intake"
    );
}
#[tokio::test]
async fn repeat_intake_requires_existing_patient_access_before_assignment() {
    let Some(app) = test_app().await else { return };
    let patient = seed_repeat_patient(&app, false).await;
    let pm = app.auth_header("patient_manager");
    let (s,_)=json_request(&app,"POST","/api/v1/leads",&pm,Some(json!({"first_name":"Repeat","last_name":"Regression","repeat_patient_id":patient,"creation_key":Uuid::new_v4()}))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let lead:Uuid=sqlx::query_scalar("INSERT INTO leads(first_name,last_name,date_of_birth,legal_sex,intake_model,created_by) VALUES('Repeat','Regression',DATE '1982-04-03','female','patient_first',$1) RETURNING id").bind(app.patient_manager_id).fetch_one(&app.suite.pool).await.unwrap();
    for existing in [false, true] {
        if existing {
            sqlx::query("UPDATE leads SET prospect_patient_id=$2 WHERE id=$1")
                .bind(lead)
                .bind(patient)
                .execute(&app.suite.pool)
                .await
                .unwrap();
        }
        let (s, _) = json_request(
            &app,
            "POST",
            &format!("/api/v1/leads/{lead}/prospect"),
            &pm,
            Some(json!({"attach_patient_id":patient})),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);
    }
    let grants: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_assignments WHERE patient_id=$1 AND user_id=$2",
    )
    .bind(patient)
    .bind(app.patient_manager_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(grants, 0);
}
#[tokio::test]
async fn repeat_clinical_retry_conflict_and_explicit_removal_preserve_integrity() {
    let Some(app) = test_app().await else { return };
    let patient = seed_repeat_patient(&app, true).await;
    let ceo = app.auth_header("ceo");
    let (_, initial) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/clinical"),
        &ceo,
        None,
    )
    .await;
    let revision = initial["revision"].as_i64().unwrap();
    let key = Uuid::new_v4();
    let path = format!(
        "/api/v1/patients/{patient}/clinical-warnings?mode=merge&expected_revision={revision}&operation_id={key}"
    );
    let body =
        json!({"kind":"allergie","items":[{"label":"Synthetic allergy","reaction":"Initial"}]});
    for _ in 0..2 {
        let (s, b) = json_request(&app, "POST", &path, &ceo, Some(body.clone())).await;
        assert_eq!(s, StatusCode::OK, "{b}");
    }
    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &ceo,
        Some(json!({"kind":"allergie","items":[{"label":"Different content"}]})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "A replay key cannot acknowledge another payload"
    );
    let (_, current) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/clinical"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(current["allergien"].as_array().unwrap().len(), 1);
    let stale = format!(
        "/api/v1/patients/{patient}/clinical-warnings?mode=merge&expected_revision={revision}&operation_id={}",
        Uuid::new_v4()
    );
    let (s, _) = json_request(&app, "POST", &stale, &ceo, Some(body)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let id = current["allergien"][0]["id"].as_str().unwrap();
    let rev = current["revision"].as_i64().unwrap();
    let remove = format!(
        "/api/v1/patients/{patient}/clinical-warnings?mode=merge&expected_revision={rev}&operation_id={}&remove_ids={id}",
        Uuid::new_v4()
    );
    for _ in 0..2 {
        let (s, b) = json_request(
            &app,
            "POST",
            &remove,
            &ceo,
            Some(json!({"kind":"allergie","items":[]})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{b}");
    }
    let (_, current) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/clinical"),
        &ceo,
        None,
    )
    .await;
    assert!(current["allergien"].as_array().unwrap().is_empty());
    let rev = current["revision"].as_i64().unwrap();
    let path = format!(
        "/api/v1/patients/{patient}/diagnoses?mode=merge&expected_revision={rev}&operation_id={}",
        Uuid::new_v4()
    );
    for _ in 0..2 {
        let (s, b) = json_request(
            &app,
            "POST",
            &path,
            &ceo,
            Some(json!({"items":[{"kind":"main","label":"Synthetic diagnosis"}]})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{b}");
    }
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_diagnoses WHERE patient_id=$1")
            .bind(patient)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn repeat_order_document_changes_require_current_documents_before_confirmation() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let ceo = app.auth_header("ceo");
    let pool = &app.suite.pool;
    let patient = seed_repeat_patient(&app, true).await;
    sqlx::query("UPDATE patients SET email='repeat@example.test',phone_primary='+4915111111111',address_country='DE',passport_expiry=DATE '2035-01-01',legal_status=$2 WHERE id=$1")
        .bind(patient).bind(json!({"identity_verified":true,"dsgvo_signed":true,"confidentiality_release_signed":true,"compliance_completed":true})).execute(pool).await.unwrap();
    let (s,created)=json_request(&app,"POST","/api/v1/leads",&pm,Some(json!({"first_name":"Repeat","last_name":"Regression","repeat_patient_id":patient,"creation_key":Uuid::new_v4()}))).await;
    assert_eq!(s, StatusCode::CREATED, "{created}");
    let lead = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let seeded = seed_complete_lead_onboarding(&app, lead).await;
    let order = seeded.order_id;
    let path = format!("/api/v1/orders/{order}/commercial-basis");
    let (s,b)=json_request(&app,"POST",&path,&pm,Some(json!({"contract_id":seeded.contract_id,"date_from":"2030-09-01","date_to":"2030-09-15"}))).await;
    assert_eq!(
        s,
        StatusCode::OK,
        "New lead-owned contract must bind to this patient's repeat draft: {b}"
    );
    assert_eq!(
        b["signed_patient"], false,
        "A changed period must invalidate existing signatures"
    );
    let (_, checked) = json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
    assert_eq!(checked["readiness"]["conversion_ready"], false, "{checked}");
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead}/wizard-convert"),
        &pm,
        Some(json!({"confirmed":true})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({"signed_patient":true})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "Old documents cannot be signed as the current order"
    );
    for template in ["single_order", "order_cost_estimate"] {
        let payload = json!({"template_id":template,"lead_id":lead,"order_id":order,"language":"de","status":"active","bindings":{"period_from":"1999-01-01","estimate_total":"1 EUR"}});
        let (s, generated) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &ceo,
            Some(payload.clone()),
        )
        .await;
        assert!(s.is_success(), "{generated}");
        let id = Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap();
        let (owner, bindings): (Option<Uuid>, Value) =
            sqlx::query_as("SELECT lead_id,generated_bindings FROM documents WHERE id=$1")
                .bind(id)
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(
            owner,
            Some(lead),
            "The document must stay visible in the repeat lead wizard"
        );
        assert_eq!(bindings["period_from"], "2030-09-01");
        assert_ne!(bindings["estimate_total"], "1 EUR");
        let (s, replayed) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &ceo,
            Some(payload),
        )
        .await;
        assert!(s.is_success(), "{replayed}");
        assert_eq!(generated["id"], replayed["id"]);
    }
    let (s, b) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({"signed_patient":true,"signed_agency":true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    let(s,b)=json_request(&app,"POST",&format!("/api/v1/orders/{order}/leistungen"),&pm,Some(json!({
        "description":"Initial orthopedic coordination","quantity":1,"unit_price":100,"vat_rate":19,
        "client_reference":format!("lead-onboarding:{lead}:service:1")
    }))).await;
    assert!(s.is_success(), "{b}");
    assert_eq!(b["id"], seeded.service_id.to_string());
    let signed: bool = sqlx::query_scalar("SELECT signed_patient FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(
        signed,
        "Saving unchanged service facts must preserve signatures"
    );
    // A service edit with the same price also invalidates old confirmations.
    sqlx::query(
        "UPDATE order_leistungen SET description='Updated synthetic coordination' WHERE id=$1",
    )
    .bind(seeded.service_id)
    .execute(pool)
    .await
    .unwrap();
    let signed: bool = sqlx::query_scalar("SELECT signed_patient FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!signed);
    for template in ["single_order", "order_cost_estimate"] {
        let(s,b)=json_request(&app,"POST","/api/v1/documents/generate",&ceo,Some(json!({"template_id":template,"lead_id":lead,"order_id":order,"language":"de","status":"active"}))).await;
        assert!(s.is_success(), "{b}");
    }
    // Concurrent retries of the same prepared estimate produce one current quote.
    let quote_path = format!("/api/v1/orders/{order}/quotes");
    let (first, retry) = tokio::join!(
        json_request(&app, "POST", &quote_path, &pm, Some(json!({}))),
        json_request(&app, "POST", &quote_path, &pm, Some(json!({})))
    );
    assert!(first.0.is_success(), "{:?}", first);
    assert!(retry.0.is_success(), "{:?}", retry);
    assert_eq!(first.1["id"], retry.1["id"]);
    let quote_id = first.1["id"].as_str().unwrap();
    let (status, accepted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/status"),
        &pm,
        Some(json!({"status":"accepted"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    let (s, b) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({"signed_patient":true,"signed_agency":true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    let (status, qualified) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead}/qualify"),
        &pm,
        Some(json!({"status":"qualified"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{qualified}");
    let (_, ready) = json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
    assert_eq!(ready["readiness"]["conversion_ready"], true, "{ready}");
    let (s, b) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead}/wizard-convert"),
        &pm,
        Some(json!({"confirmed":true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["patient_id"], patient.to_string());
    let (state,count):(String,i64)=sqlx::query_as("SELECT intake_state,(SELECT count(*) FROM orders WHERE source_lead_id=$2) FROM orders WHERE id=$1").bind(order).bind(lead).fetch_one(pool).await.unwrap();
    assert_eq!(state, "confirmed");
    assert_eq!(count, 1);
    let (s, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead}/failed-flow"),
        &pm,
        Some(json!({"resolution":"archive","reason":"not_our_lead"})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "A converted repeat must not archive an operational order"
    );
}

#[tokio::test]
async fn repeat_intake_shows_overdue_debt_and_is_marked_in_the_list() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let patient = seed_repeat_patient(&app, true).await;
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Repeat",
            "last_name": "Regression",
            "repeat_patient_id": patient,
            "creation_key": Uuid::new_v4()
        })),
    )
    .await;
    assert!(status.is_success(), "{created}");
    let lead = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    // Phase 1 classification: the list tells an existing customer from a new lead.
    let (status, list) = json_request(&app, "GET", "/api/v1/leads", &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let listed = list["items"]
        .as_array()
        .or_else(|| list.as_array())
        .expect("lead list")
        .iter()
        .find(|item| item["id"] == lead.to_string())
        .expect("repeat lead is listed")
        .clone();
    assert_eq!(listed["repeat_patient_id"], patient.to_string());

    // An overdue invoice on an earlier order puts the patient into debt management.
    let earlier_order: Uuid = sqlx::query_scalar(
        "INSERT INTO orders(order_number,patient_id,phase,status,created_by) VALUES($1,$2,'closure','active',$3) RETURNING id",
    )
    .bind(format!("ORD-DEBT-{}", Uuid::new_v4().simple()))
    .bind(patient)
    .bind(app.ceo_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status, due_date,
               total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES ($1, $2, $3, 'final', 'overdue', CURRENT_DATE - 30,
                     100, 19, 119, 0, '[]'::jsonb, $4)"#,
    )
    .bind(earlier_order)
    .bind(patient)
    .bind(format!("INV-DEBT-{}", Uuid::new_v4().simple()))
    .bind(app.ceo_id)
    .execute(&app.suite.pool)
    .await
    .unwrap();

    let (status, recheck) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/recheck"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{recheck}");
    assert_eq!(recheck["overdue_invoice_count"], 1, "{recheck}");

    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    // Debt is surfaced for attention; since 2026-09 it never blocks by itself.
    let reasons = detail["readiness"]["blocking_reasons"]
        .as_array()
        .expect("blocking reasons");
    assert!(
        !reasons
            .iter()
            .any(|reason| reason.as_str().unwrap_or_default().contains("debt")),
        "{reasons:?}"
    );
    let debt_check = detail["readiness"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["key"] == "debt_clear")
        .expect("debt check");
    assert_eq!(debt_check["passed"], false);
}

#[tokio::test]
async fn returning_patient_is_found_by_email_when_the_lead_has_another_spelling() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let email = format!("same-{tag}@example.com");
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender,
                email, lifecycle_status, is_active, created_by, languages
           ) VALUES (
                $1, 'Olena', 'Kovalenko', DATE '1979-11-20', 'female',
                $2, 'active', true, $3, ARRAY['de']::text[]
           ) RETURNING id"#,
    )
    .bind(format!("P-EMAIL-{tag}"))
    .bind(&email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$2)")
        .bind(patient_id)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();
    // Married name and a mistyped birth date: only the e-mail still matches.
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, country, primary_language,
                date_of_birth, legal_sex, primary_concern_text, requested_specialties,
                qualification_status, compliance_status,
                consent_healthcare, consent_privacy_practices,
                intake_source, intake_model, created_by
           ) VALUES (
                'Olena', 'Schmidt', $1, 'DE', 'de',
                DATE '1979-11-21', 'female', 'Follow-up concern', '["orthopedics"]'::jsonb,
                'qualified', 'signed', true, true,
                'staff_wizard', 'patient_first', $2
           ) RETURNING id"#,
    )
    .bind(&email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let pm = app.auth_header("patient_manager");
    let (status, response) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({ "hauptanfragegrund": "Follow-up concern" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let candidates = response["duplicate_candidates"]
        .as_array()
        .expect("duplicate candidates");
    assert!(
        candidates
            .iter()
            .any(|candidate| candidate["id"] == patient_id.to_string()),
        "{response}"
    );
}
