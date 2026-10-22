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
    concierge_id: Uuid,
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
            "concierge" => self.concierge_id,
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
    let concierge_id = seed_user(&suite.pool, "leads-api", "concierge").await;
    Some(TestApp {
        suite,
        sales_id,
        patient_manager_id,
        billing_id,
        interpreter_id,
        ceo_id,
        concierge_id,
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

/// Stands for the DSGVO signature flow: only a document marked as signed DSGVO
/// evidence sets a lead's compliance to `signed` (staff cannot set it by hand).
async fn record_dsgvo_signature(pool: &PgPool, lead_id: &str) {
    sqlx::query("UPDATE leads SET compliance_status = 'signed' WHERE id = $1")
        .bind(Uuid::parse_str(lead_id).unwrap())
        .execute(pool)
        .await
        .unwrap();
}

async fn make_lead_ready_for_qualification(app: &TestApp, bearer: &str, lead_id: &str) -> Value {
    record_dsgvo_signature(&app.suite.pool, lead_id).await;
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
            "consent_healthcare": true,
            "consent_privacy_practices": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    body
}

/// A synthetic medical work type chosen for the seeded VKS (readiness only checks the choice).
const ONBOARDING_WORK_TYPE_ID: &str = "7a3c9e21-5b64-4f0d-9c2e-1d8b6a4f3e70";

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
               consent_privacy_practices = true,
               wizard_state = COALESCE(wizard_state, '{}'::jsonb)
                   || jsonb_build_object('selected_specialization_work_type_ids', jsonb_build_array($2::text))
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(ONBOARDING_WORK_TYPE_ID)
    .execute(pool)
    .await
    .unwrap();
    // "Кто платит": the patient pays from their salary (synthetic).
    sqlx::query(
        r#"INSERT INTO lead_payer_declarations (lead_id, payer_kind, source_of_funds)
           VALUES ($1, 'self', 'employment')
           ON CONFLICT (lead_id) DO NOTHING"#,
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
        // A VKS records the medical work types it lists.
        let generated_bindings = (template_id == "cost_estimate")
            .then(|| json!({ "_cost_estimate_work_type_ids": [ONBOARDING_WORK_TYPE_ID] }));
        sqlx::query(
            r#"INSERT INTO documents (
                    id, lead_id, order_id, auto_name, original_filename, art, category,
                    status, visibility, is_medical, mime_type, file_size,
                    generated_template_id, version_root_document_id, version_number, uploaded_by,
                    generated_bindings
               ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    'active', 'patient_visible', false, 'application/pdf', 128,
                    $6, $1, 1, $8, $9
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
        .bind(generated_bindings)
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
    // A first intake is not a repeat intake of an existing patient.
    assert!(body["repeat_patient_id"].is_null(), "{body}");

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

/// Owner decision 2026-10-11: Concierge and Billing never open a consent
/// document, also not through the lead screens — the lead's document list,
/// the document, its download, and the questionnaire upload it was imported
/// from. The patient manager keeps them.
#[tokio::test]
async fn concierge_and_billing_never_open_a_leads_consent_documents() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, qualification_status,
                              compliance_status, intake_source, created_by)
           VALUES ('Anna', 'Muster', $1, 'new', 'signed', 'staff_wizard', $2)
           RETURNING id"#,
    )
    .bind(format!("consent-{tag}@example.com"))
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let consent_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, lead_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, generated_template_id,
                version_root_document_id, version_number, uploaded_by,
                signed_at, signed_by, compliance_kind
           ) VALUES (
                $1, $2, 'Schweigepflichtsentbindung Anna Muster', 'schweigepflicht.pdf',
                'confidentiality_release', 'consent', 'active', 'internal', false,
                'application/pdf', 4, 'confidentiality_release', $1, 1, $3,
                now(), $3, 'confidentiality_release'
           )"#,
    )
    .bind(consent_id)
    .bind(lead_id)
    .bind(app.patient_manager_id)
    .execute(pool)
    .await
    .unwrap();
    let attachment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lead_attachments (
                lead_id, file_name, content_type, size_bytes, data, imported_document_id,
                imported_at
           ) VALUES ($1, 'schweigepflicht-scan.pdf', 'application/pdf', 4,
                     '\x25504446'::bytea, $2, now())
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(consent_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let listed = |body: &Value| {
        body.as_array().is_some_and(|items| {
            items
                .iter()
                .any(|item| item["id"] == consent_id.to_string())
        })
    };
    let lead_path = format!("/api/v1/leads/{lead_id}");
    let attachment_path = format!("/api/v1/leads/{lead_id}/attachments/{attachment_id}");

    for role in ["concierge", "billing"] {
        let bearer = app.auth_header(role);
        let (status, body) = json_request(
            &app,
            "GET",
            &format!("/api/v1/documents?lead_id={lead_id}"),
            &bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{role}: {body}");
        assert!(!listed(&body), "{role} lists the consent: {body}");
        for path in [
            format!("/api/v1/documents/{consent_id}"),
            format!("/api/v1/documents/{consent_id}/download"),
            format!("/api/v1/documents/{consent_id}/text-extraction"),
            attachment_path.clone(),
        ] {
            let (status, _) = json_request(&app, "GET", &path, &bearer, None).await;
            assert!(
                matches!(status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
                "{role} {path}: {status}"
            );
        }
        let (status, lead) = json_request(&app, "GET", &lead_path, &bearer, None).await;
        if status == StatusCode::OK {
            let attachments = lead["attachments"].as_array().cloned().unwrap_or_default();
            assert!(
                !attachments
                    .iter()
                    .any(|item| item["id"] == attachment_id.to_string()),
                "{role} sees the consent upload: {lead}"
            );
        } else {
            assert_eq!(status, StatusCode::FORBIDDEN, "{role}: {lead}");
        }
    }

    // The patient manager keeps the consent in the lead screens.
    let pm = app.auth_header("patient_manager");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?lead_id={lead_id}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(listed(&body), "{body}");
    let (status, lead) = json_request(&app, "GET", &lead_path, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert!(
        lead["attachments"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == attachment_id.to_string()),
        "{lead}"
    );
    let (status, _) = json_request(&app, "GET", &attachment_path, &pm, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn sales_sees_leads_without_their_medical_content() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let sales = app.auth_header("sales");
    let tag = Uuid::new_v4().simple().to_string();
    let concern = format!("Pathology slides {tag}");
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, source, country, primary_language,
                primary_concern_text, additional_concerns, message, notes, selected_program,
                currently_in_treatment, has_health_risk_for_travel, has_medical_records,
                has_insurance, insurance_provider, insurance_number, insurance_type,
                requested_specialties, raw_payload, wizard_state, created_by
           ) VALUES (
                'Medical', 'Privacy', $1, '+4915144444444', 'Website', 'UA', 'uk',
                $2, 'Second opinion', 'Please review my scans',
                'Needs fertility documentation checklist', 'Oncology check-up',
                true, true, 'yes',
                true, 'Allianz', 'A123456', 'private',
                '["oncology"]'::jsonb, '{"answers":{"diagnosis":"C50"}}'::jsonb,
                '{"clinical_draft":{"narrative":"Pain"}}'::jsonb, $3
           ) RETURNING id"#,
    )
    .bind(format!("medical-{tag}@example.com"))
    .bind(&concern)
    .bind(app.sales_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let attachment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lead_attachments (lead_id, file_name, content_type, size_bytes, data)
           VALUES ($1, 'mri-report.pdf', 'application/pdf', 4, '\x25504446'::bytea)
           RETURNING id"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let detail_path = format!("/api/v1/leads/{lead_id}");

    let (status, detail) = json_request(&app, "GET", &detail_path, &sales, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    for field in [
        "primary_concern_text",
        "additional_concerns",
        "message",
        "notes",
        "selected_program",
        "currently_in_treatment",
        "has_health_risk_for_travel",
        "has_medical_records",
        "has_insurance",
        "insurance_provider",
        "insurance_number",
        "insurance_type",
        "raw_payload",
    ] {
        assert!(
            detail[field].is_null(),
            "{field} must be hidden from sales: {detail}"
        );
    }
    assert_eq!(detail["requested_specialties"], json!([]));
    assert_eq!(detail["wizard_state"], json!({}));
    assert_eq!(detail["attachments"], json!([]));
    assert_eq!(detail["attachment_count"], 1);
    assert_eq!(detail["medical_fields_hidden"], true);
    // Contact, source, status, country and language stay visible.
    assert_eq!(detail["email"], format!("medical-{tag}@example.com"));
    assert_eq!(detail["phone"], "+4915144444444");
    assert_eq!(detail["source"], "Website");
    assert_eq!(detail["country"], "UA");
    assert_eq!(detail["primary_language"], "uk");
    assert_eq!(detail["qualification_status"], "new");

    // The list neither shows nor searches the medical content.
    let search_path = format!("/api/v1/leads?search={}", tag);
    let (status, list) = json_request(&app, "GET", &search_path, &sales, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let found = |list: &Value| {
        list.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == lead_id.to_string())
    };
    assert!(found(&list), "the e-mail matches for sales too: {list}");
    let concern_search = "/api/v1/leads?search=Pathology%20slides";
    let (status, list) = json_request(&app, "GET", concern_search, &sales, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(
        !found(&list),
        "sales must not find a lead by its medical text"
    );

    // Sales cannot download questionnaire uploads or overwrite medical fields.
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/attachments/{attachment_id}"),
        &sales,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let update_path = format!("/api/v1/leads/{lead_id}/update");
    for payload in [
        json!({ "notes": "Overwritten" }),
        json!({ "primary_concern_text": "Overwritten" }),
        json!({ "wizard_state": {} }),
    ] {
        let (status, body) =
            json_request(&app, "POST", &update_path, &sales, Some(payload.clone())).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{payload}: {body}");
    }
    let (status, body) = json_request(
        &app,
        "POST",
        &update_path,
        &sales,
        Some(json!({ "country": "DE" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let stored_notes: Option<String> = sqlx::query_scalar("SELECT notes FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        stored_notes.as_deref(),
        Some("Needs fertility documentation checklist")
    );

    // Roles with medical access keep the full lead.
    for role in ["patient_manager", "ceo"] {
        let bearer = app.auth_header(role);
        let (status, detail) = json_request(&app, "GET", &detail_path, &bearer, None).await;
        assert_eq!(status, StatusCode::OK, "{role}: {detail}");
        assert_eq!(detail["primary_concern_text"], concern, "{role}");
        assert_eq!(
            detail["notes"], "Needs fertility documentation checklist",
            "{role}"
        );
        assert_eq!(detail["insurance_number"], "A123456", "{role}");
        assert_eq!(
            detail["requested_specialties"],
            json!(["oncology"]),
            "{role}"
        );
        assert_eq!(
            detail["attachments"].as_array().map(Vec::len),
            Some(1),
            "{role}"
        );
        assert!(detail.get("medical_fields_hidden").is_none(), "{role}");
        let (status, list) = json_request(&app, "GET", concern_search, &bearer, None).await;
        assert_eq!(status, StatusCode::OK, "{role}: {list}");
        assert!(found(&list), "{role} finds the lead by its request text");
    }
}

#[tokio::test]
async fn staff_lead_personal_data_is_refused_at_the_field() {
    // QA 2026-10-22: the wizard shows a refusal at its field, so a 422 names it.
    let Some(app) = test_app().await else { return };
    let sales = app.auth_header("sales");
    for (body, field, message) in [
        (
            json!({ "first_name": "Future", "last_name": "Born", "date_of_birth": "2999-01-01", "email": "future.born@example.com" }),
            "date_of_birth",
            "date_of_birth cannot be in the future",
        ),
        (
            json!({ "first_name": "Too", "last_name": "Early", "date_of_birth": "1850-01-01", "email": "too.early@example.com" }),
            "date_of_birth",
            "date_of_birth is too early",
        ),
        (
            json!({ "first_name": "Bad", "last_name": "Phone", "date_of_birth": "1990-01-01", "email": "bad.phone@example.com", "phone": "12" }),
            "phone",
            "Invalid phone",
        ),
    ] {
        let (status, response) =
            json_request(&app, "POST", "/api/v1/leads", &sales, Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{response}");
        assert_eq!(response["field"], field, "{response}");
        assert_eq!(response["message"], message, "{response}");
    }

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &sales,
        Some(json!({ "first_name": "Valid", "last_name": "Person", "date_of_birth": "1990-01-01", "email": "valid.person.fields@example.com" })),
    )
    .await;
    assert!(status.is_success(), "{created}");
    let update = format!("/api/v1/leads/{}/update", created["id"].as_str().unwrap());
    for (body, field) in [
        (json!({ "date_of_birth": "2999-01-01" }), "date_of_birth"),
        (json!({ "email": "not-an-address" }), "email"),
        (json!({ "phone": "abc" }), "phone"),
        (json!({ "first_name": " " }), "first_name"),
    ] {
        let (status, response) = json_request(&app, "POST", &update, &sales, Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{response}");
        assert_eq!(response["field"], field, "{response}");
    }
    let (status, response) = json_request(
        &app,
        "POST",
        &update,
        &sales,
        Some(json!({ "trusted_contacts": [{ "name": "Anna Muster", "relation": "mother", "birth_date": "2999-01-01" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{response}");
    assert_eq!(
        response["message"],
        "Trusted contact birth_date is not plausible"
    );
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
            "email": "another.adult@example.com",
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

/// Leads that already share a phone or email (e.g. imported before the
/// uniqueness rule) stay editable: only a contact the request changes to a new
/// value is checked against other people.
#[tokio::test]
async fn lead_update_checks_uniqueness_only_for_changed_contacts() {
    let Some(app) = test_app().await else { return };
    let ceo = app.auth_header("ceo");
    let mut lead_ids = Vec::new();
    for (first_name, birth_date) in [("First", "1980-01-01"), ("Second", "1981-02-02")] {
        let lead_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO leads (first_name, last_name, date_of_birth, email, phone, created_by)
               VALUES ($1, 'Duplicate', $2::date, 'shared-contact@example.org', '+49 30 5550100', $3)
               RETURNING id"#,
        )
        .bind(first_name)
        .bind(birth_date)
        .bind(app.ceo_id)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
        lead_ids.push(lead_id);
    }
    let other_phone_owner: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, date_of_birth, phone, created_by)
           VALUES ('Third', 'Person', DATE '1979-03-03', '+49 30 5550199', $1)
           RETURNING id"#,
    )
    .bind(app.ceo_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    let lead_id = lead_ids[0];
    let path = format!("/api/v1/leads/{lead_id}/update");

    // Editing only trusted contacts no longer trips over the stored duplicate.
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &ceo,
        Some(json!({
            "trusted_contacts": [{
                "id": Uuid::new_v4(),
                "name": "Maria Duplicate",
                "phone": "+49 151 0000001",
                "relation": "spouse"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Re-sending the stored values (another format of the same number) is not a change.
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &ceo,
        Some(json!({
            "phone": "0049 30 5550100",
            "email": " Shared-Contact@example.org ",
            "notes": "Unchanged contacts"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // A change to another person's number is still rejected.
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &ceo,
        Some(json!({ "phone": "+49 30 5550199" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Phone is already used by another person");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{}/update", lead_ids[1]),
        &ceo,
        Some(json!({ "email": "shared-contact-new@example.org" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &ceo,
        Some(json!({ "email": "shared-contact-new@example.org" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Email is already used by another person");

    let stored_phone: Option<String> = sqlx::query_scalar("SELECT phone FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(stored_phone.as_deref(), Some("0049 30 5550100"));
    assert_ne!(other_phone_owner, lead_id);
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
        Some(json!({ "first_name": "Qualify", "last_name": "Test", "email": "qualify.test@example.com" })),
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
async fn not_qualified_keeps_the_reason_for_the_failed_lead_workflow() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let lead_id = insert_status_lead(&app, &tag, "in_progress").await;

    // QA 2026-10-11 (A-39a): "not suitable" asks for a reason; it is stored
    // as the failure reason, also before the lead is archived.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm,
        Some(json!({ "status": "not_qualified", "reason": "  no_response " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(detail["qualification_status"], "not_qualified", "{detail}");
    assert_eq!(detail["failed_outcome"]["status"], "none", "{detail}");
    assert_eq!(
        detail["failed_outcome"]["reason"], "no_response",
        "{detail}"
    );
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'qualify_lead' AND entity_id = $1 AND context->>'reason' = 'no_response'",
    )
    .bind(lead_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // Archiving takes it over; a too long reason is refused.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "archive", "reason": "no_response" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let other = insert_status_lead(&app, &format!("{tag}-x"), "in_progress").await;
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{other}/qualify"),
        &pm,
        Some(json!({ "status": "not_qualified", "reason": "x".repeat(501) })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn qualify_lead_invalid_status_rejected() {
    let Some(app) = test_app().await else { return };

    let (_, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &app.auth_header("sales"),
        Some(json!({ "first_name": "Bad", "last_name": "Status", "email": "bad.status@example.com" })),
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
        Some(json!({ "first_name": "Convert", "last_name": "Fail", "email": "convert.fail@example.com" })),
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
        Some(json!({ "first_name": "Convert", "last_name": "Rbac", "email": "convert.rbac@example.com" })),
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

#[tokio::test]
async fn completed_demo_allows_dev_conversion_without_creating_legal_signature_proof() {
    demo_conversion(false).await;
}

#[tokio::test]
async fn demo_repeat_conversion_preserves_revoked_consents() {
    demo_conversion(true).await;
}

async fn demo_conversion(repeat: bool) {
    use sha2::{Digest, Sha256};
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let lead = insert_patient_first_wizard_lead(&app, "demo-conversion").await;
    sqlx::query("UPDATE leads SET intake_model='legacy' WHERE id=$1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    let artifacts = seed_complete_lead_onboarding(&app, lead).await;
    let repeat_patient = if repeat {
        let patient = seed_repeat_patient(&app, true).await;
        sqlx::query("UPDATE patients SET legal_status=jsonb_build_object('dsgvo_revoked_at',now(),'confidentiality_release_revoked_at',now()) WHERE id=$1")
            .bind(patient).execute(pool).await.unwrap();
        sqlx::query(
            "UPDATE leads SET intake_model='patient_first',prospect_patient_id=$2 WHERE id=$1",
        )
        .bind(lead)
        .bind(patient)
        .execute(pool)
        .await
        .unwrap();
        Some(patient)
    } else {
        None
    };
    sqlx::query("UPDATE leads SET compliance_status='documents_sent' WHERE id=$1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE framework_contracts SET status='sent',signed_at=NULL WHERE id=$1")
        .bind(artifacts.contract_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET signed_patient=false,signed_agency=false,signed_patient_at=NULL,signed_agency_at=NULL,signed_at=NULL,client_terms_changed_at=NULL WHERE id=$1").bind(artifacts.order_id).execute(pool).await.unwrap();
    sqlx::query("UPDATE documents SET signed_at=NULL,signed_by=NULL,generated_template_id=CASE compliance_kind WHEN 'dsgvo' THEN 'privacy_consents' WHEN 'confidentiality_release' THEN 'confidentiality_release' ELSE generated_template_id END WHERE lead_id=$1 AND compliance_kind IS DISTINCT FROM 'identity'")
        .bind(lead).execute(pool).await.unwrap();

    let source_ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM documents WHERE lead_id=$1 AND compliance_kind IS DISTINCT FROM 'identity' AND generated_template_id IS DISTINCT FROM 'cost_estimate' ORDER BY generated_template_id")
        .bind(lead).fetch_all(pool).await.unwrap();
    let bytes = b"%PDF-1.7\nSynthetic DEV test document\n%%EOF";
    let hash = hex::encode(Sha256::digest(bytes));
    let own_choice = json!({"_own_consent_choice": {
        "id":Uuid::new_v4(), "choices":{"agency_processing":true,"doctors_to_agency":true,"data_system":true},
        "recipients":[], "chosen_at":chrono::Utc::now(), "source":"lead_portal", "access_kind":"self"
    }});
    sqlx::query("INSERT INTO consent_form_choices(id,template_id,lead_id,choices,access_kind,source,language,text_version,chosen_at) VALUES($1,'privacy_consents',$2,$3,'self','lead_portal','de','synthetic-dev-test',$4)")
        .bind(Uuid::parse_str(own_choice["_own_consent_choice"]["id"].as_str().unwrap()).unwrap())
        .bind(lead).bind(&own_choice["_own_consent_choice"]["choices"])
        .bind(chrono::DateTime::parse_from_rfc3339(own_choice["_own_consent_choice"]["chosen_at"].as_str().unwrap()).unwrap())
        .execute(pool).await.unwrap();
    let mut blob_paths = Vec::new();
    tokio::fs::create_dir_all("uploads/documents")
        .await
        .unwrap();
    for id in &source_ids {
        let key = format!("dev-onboarding-{id}.pdf");
        let path = std::path::Path::new("uploads/documents").join(&key);
        tokio::fs::write(
            &path,
            gmed_server::crypto::shared_registry()
                .unwrap()
                .seal_blob(bytes)
                .unwrap(),
        )
        .await
        .unwrap();
        blob_paths.push(path);
        sqlx::query("UPDATE documents SET storage_key=$2,generated_bindings=COALESCE(generated_bindings,'{}'::jsonb) || $3::jsonb WHERE id=$1")
            .bind(id)
            .bind(key)
            .bind(&own_choice)
            .execute(pool)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE documents SET order_intake_context=repeat_order_document_context(order_id) WHERE lead_id=$1 AND order_id IS NOT NULL")
        .bind(lead).execute(pool).await.unwrap();
    let result = Uuid::new_v4();
    let request = Uuid::new_v4();
    let result_key = format!("dev-onboarding-result-{result}.pdf");
    let report_key = format!("dev-onboarding-report-{request}.pdf");
    sqlx::query("INSERT INTO documents(id,lead_id,auto_name,art,category,mime_type,storage_key,version_root_document_id,uploaded_by,ursprung) VALUES($1,$2,'TEST synthetic result','signature_evidence','signature','application/pdf',$4,$1,$3,'electronic_signature_package')")
        .bind(result).bind(lead).bind(app.patient_manager_id).bind(&result_key).execute(pool).await.unwrap();
    // The immutable snapshot mirrors the context the provider verified.
    let context_sql = "jsonb_build_object('patient_id',d.patient_id,'lead_id',d.lead_id,'order_id',d.order_id,'appointment_id',d.appointment_id,'art',d.art,'template',d.generated_template_id,'bindings',d.generated_bindings,'storage_key',d.storage_key,'version_root',d.version_root_document_id,'version',d.version_number)";
    sqlx::query(&format!("INSERT INTO document_signature_requests(id,source_document_id,requested_by,source_sha256,source_context,signers,provider_account,test_mode,status,result_document_id,report_storage_key,report_sha256,signed_sha256,is_package) SELECT $1,d.id,$3,$4,{context_sql},'[]','synthetic-demo',true,'pending',$5,$6,$4,$4,true FROM documents d WHERE d.id=$2"))
        .bind(request).bind(source_ids[0]).bind(app.patient_manager_id).bind(&hash).bind(result).bind(&report_key).execute(pool).await.unwrap();
    for (position, id) in source_ids.iter().enumerate() {
        sqlx::query(&format!("INSERT INTO document_signature_members(request_id,document_id,position,sha256,source_context) SELECT $1,d.id,$3,$4,{context_sql} FROM documents d WHERE d.id=$2"))
            .bind(request).bind(id).bind((position+1) as i16).bind(&hash).execute(pool).await.unwrap();
    }
    for key in [&result_key, &report_key] {
        let path = std::path::Path::new("uploads/documents").join(key);
        tokio::fs::write(
            &path,
            gmed_server::crypto::shared_registry()
                .unwrap()
                .seal_blob(bytes)
                .unwrap(),
        )
        .await
        .unwrap();
        blob_paths.push(path);
    }
    let all_document_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM documents WHERE lead_id=$1")
            .bind(lead)
            .fetch_all(pool)
            .await
            .unwrap();
    let dev_state = app
        .suite
        .state
        .clone()
        .with_mailer(gmed_server::config::MailConfig {
            console_url: Some("https://console-dev.gmed-health.com".into()),
            ..Default::default()
        })
        .with_dev_demo_onboarding(true);
    assert!(dev_state.dev_demo_onboarding);
    let production_state = app
        .suite
        .state
        .clone()
        .with_mailer(gmed_server::config::MailConfig {
            console_url: Some("https://console.gmed-health.com".into()),
            ..Default::default()
        })
        .with_dev_demo_onboarding(true);
    assert!(!production_state.dev_demo_onboarding);
    let peer = axum::Extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
        [127, 0, 0, 1],
        40123,
    ))));
    let dev = gmed_server::build_app_for_role_contract_tests(dev_state).layer(peer);
    let production = gmed_server::build_app_for_role_contract_tests(production_state).layer(peer);
    let pm = app.auth_header("patient_manager");
    let path = format!("/api/v1/leads/{lead}");
    let (status, pending) = json_request(&dev, "GET", &path, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{pending}");
    assert_eq!(pending["readiness"]["conversion_ready"], false, "{pending}");
    sqlx::query(
        "UPDATE document_signature_requests SET status='completed',signed_at=now() WHERE id=$1",
    )
    .bind(request)
    .execute(pool)
    .await
    .unwrap();
    let (_, live) = json_request(&production, "GET", &path, &pm, None).await;
    assert_eq!(live["readiness"]["conversion_ready"], false, "{live}");
    let (_, ready) = json_request(&dev, "GET", &path, &pm, None).await;
    assert_eq!(ready["readiness"]["conversion_ready"], true, "{ready}");
    assert_eq!(ready["readiness"]["demo_onboarding"]["applied"], true);

    // Changing the terms or the source file invalidates the archived test proof.
    sqlx::query("UPDATE orders SET client_terms_changed_at=now() WHERE id=$1")
        .bind(artifacts.order_id)
        .execute(pool)
        .await
        .unwrap();
    let (_, changed) = json_request(&dev, "GET", &path, &pm, None).await;
    assert_eq!(changed["readiness"]["conversion_ready"], false, "{changed}");
    sqlx::query("UPDATE orders SET client_terms_changed_at=NULL WHERE id=$1")
        .bind(artifacts.order_id)
        .execute(pool)
        .await
        .unwrap();
    tokio::fs::write(&blob_paths[0], b"%PDF-1.7\nchanged source\n%%EOF")
        .await
        .unwrap();
    let (_, changed) = json_request(&dev, "GET", &path, &pm, None).await;
    assert_eq!(changed["readiness"]["conversion_ready"], false, "{changed}");
    tokio::fs::write(
        &blob_paths[0],
        gmed_server::crypto::shared_registry()
            .unwrap()
            .seal_blob(bytes)
            .unwrap(),
    )
    .await
    .unwrap();

    let (status, converted) = json_request(
        &dev,
        "POST",
        &format!("{path}/wizard-convert"),
        &pm,
        Some(json!({"confirmed":true})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    let patient = Uuid::parse_str(converted["patient_id"].as_str().unwrap()).unwrap();
    if let Some(existing) = repeat_patient {
        assert_eq!(patient, existing);
    }
    let legal: Value = sqlx::query_scalar("SELECT legal_status FROM patients WHERE id=$1")
        .bind(patient)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(legal["dsgvo_signed"], false, "{legal}");
    assert_eq!(legal["confidentiality_release_signed"], false);
    assert_eq!(legal["contract_status"], "unsigned");
    assert_eq!(legal["demo_onboarding"]["applied"], true);
    if repeat {
        assert!(legal["dsgvo_revoked_at"].is_string(), "{legal}");
        assert!(
            legal["confidentiality_release_revoked_at"].is_string(),
            "{legal}"
        );
    }
    let signed: bool =
        sqlx::query_scalar("SELECT signed_patient OR signed_agency FROM orders WHERE id=$1")
            .bind(artifacts.order_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!signed);
    let effects: bool = sqlx::query_scalar(
        "SELECT effects_applied_at IS NOT NULL FROM document_signature_requests WHERE id=$1",
    )
    .bind(request)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(!effects);
    // The card retains every original and the complete DEMO bundle. The
    // signatures keep their request IDs after the document owner changes.
    let (status, card) = json_request(
        &dev,
        "GET",
        &format!("/api/v1/patients/{patient}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{card}");
    assert_eq!(card["legal_status"]["demo_onboarding"]["applied"], true);
    assert_eq!(card["legal_status"]["dsgvo_signed"], false);
    let (status, documents) = json_request(
        &dev,
        "GET",
        &format!("/api/v1/patients/{patient}/documents"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{documents}");
    for id in &all_document_ids {
        assert!(
            documents
                .as_array()
                .unwrap()
                .iter()
                .any(|doc| doc["id"] == id.to_string()),
            "document {id} missing from patient card: {documents}"
        );
    }
    let mut signed_ids = source_ids.clone();
    signed_ids.push(result);
    let ids = signed_ids
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let (status, summaries) = json_request(
        &dev,
        "GET",
        &format!("/api/v1/document-signatures/statuses?ids={ids}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{summaries}");
    for id in &signed_ids {
        let summary = summaries
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["document_id"] == id.to_string())
            .unwrap();
        assert_eq!(summary["status"], "completed");
        assert_eq!(summary["test_mode"], true);
        assert_eq!(summary["result_document_id"], result.to_string());
        let (status, history) = json_request(
            &dev,
            "GET",
            &format!("/api/v1/documents/{id}/signature-requests"),
            &pm,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{history}");
        assert_eq!(history["scope"]["patient_id"], patient.to_string());
        assert_eq!(history["requests"][0]["id"], request.to_string());
        assert_eq!(history["requests"][0]["has_report"], true);
    }
    for path in signed_ids
        .iter()
        .map(|id| format!("/api/v1/documents/{id}/download"))
        .chain(std::iter::once(format!(
            "/api/v1/document-signature-requests/{request}/report"
        )))
    {
        let response = dev
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&path)
                    .header("Authorization", &pm)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let downloaded = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        assert_eq!(&downloaded[..], bytes, "{path}");
    }
    let audit:Value = sqlx::query_scalar("SELECT context FROM audit_log WHERE action='convert_lead' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1").bind(lead).fetch_one(pool).await.unwrap();
    assert_eq!(audit["demo_onboarding"]["applied"], true);
    for path in blob_paths {
        tokio::fs::remove_file(path).await.unwrap();
    }
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
async fn staff_cannot_mark_lead_compliance_signed_by_hand() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Manual",
            "last_name": "Compliance",
            "email": format!("manual-compliance-{tag}@test.local"),
            "phone": "+49111000001",
            "source": "Test",
            "country": "DE"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = created["id"].as_str().unwrap().to_string();
    let lead_uuid = Uuid::parse_str(&lead_id).unwrap();
    let stored = |pool: PgPool| async move {
        sqlx::query_scalar::<_, String>("SELECT compliance_status FROM leads WHERE id = $1")
            .bind(lead_uuid)
            .fetch_one(&pool)
            .await
            .unwrap()
    };

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "compliance_status": "signed" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["message"],
        "Compliance becomes signed only through a signed DSGVO document"
    );
    assert_eq!(stored(app.suite.pool.clone()).await, "pending");

    // Sending documents is still recorded by hand, audited with the change.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "compliance_status": "documents_sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(stored(app.suite.pool.clone()).await, "documents_sent");
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'update_lead' AND entity_id = $1
             AND context->>'compliance_status' = 'documents_sent'
             AND context->>'previous_compliance_status' = 'pending'"#,
    )
    .bind(lead_uuid)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // Once the DSGVO signature set it, the form may send `signed` back.
    record_dsgvo_signature(&app.suite.pool, &lead_id).await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "compliance_status": "signed", "notes": "checked" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(stored(app.suite.pool.clone()).await, "signed");
}

#[tokio::test]
async fn the_pep_status_check_is_audited_as_its_own_action() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Anna",
            "last_name": "Muster",
            "email": format!("anna-pep-{tag}@example.com"),
            "source": "Test",
            "country": "DE"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = created["id"].as_str().unwrap().to_string();
    let lead_uuid = Uuid::parse_str(&lead_id).unwrap();
    let path = format!("/api/v1/leads/{lead_id}/update");
    let wizard = |checked: bool| json!({ "wizard_state": { "aml_enhanced_due_diligence": { "pepStatusChecked": checked, "isPep": false } } });
    let actions = |pool: PgPool| async move {
        sqlx::query_as::<_, (String, Option<Uuid>, Value)>(
            r#"SELECT action, user_id, context FROM audit_log
               WHERE entity_id = $1 AND action LIKE 'lead_pep_status_%'
               ORDER BY created_at, id"#,
        )
        .bind(lead_uuid)
        .fetch_all(&pool)
        .await
        .unwrap()
    };

    // Ticked: one row of its own, with the user and without personal data.
    let (status, body) = json_request(&app, "POST", &path, &pm, Some(wizard(true))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = actions(app.suite.pool.clone()).await;
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0].0, "lead_pep_status_checked");
    assert_eq!(rows[0].1, Some(app.patient_manager_id));
    assert_eq!(
        rows[0].2,
        json!({ "lead_id": lead_id, "pep_status_checked": true })
    );

    // Saved again unchanged, or another field: nothing new.
    let (status, body) = json_request(&app, "POST", &path, &pm, Some(wizard(true))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) =
        json_request(&app, "POST", &path, &pm, Some(json!({ "notes": "x" }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(actions(app.suite.pool.clone()).await.len(), 1);

    // Unticked: the second row.
    let (status, body) = json_request(&app, "POST", &path, &pm, Some(wizard(false))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = actions(app.suite.pool.clone()).await;
    assert_eq!(
        rows.iter().map(|row| row.0.as_str()).collect::<Vec<_>>(),
        ["lead_pep_status_checked", "lead_pep_status_unchecked"]
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
    record_dsgvo_signature(&app.suite.pool, &lead_id).await;

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

    // The citizenships win over a stale legacy registration country.
    sqlx::query(
        r#"UPDATE leads
           SET wizard_state = wizard_state || '{"registration_country":"PL","passport_expiry":"2035-06-30"}'::jsonb,
               citizenships = '{AT,UA}'::text[]
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
    // Several citizenships and the payer declaration go to the patient.
    let (citizenships, payer_kind): (Vec<String>, Option<String>) = sqlx::query_as(
        "SELECT citizenships, legal_status #>> '{payer_declaration,payer_kind}' FROM patients WHERE id = $1",
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(citizenships, ["AT", "UA"]);
    assert_eq!(payer_kind.as_deref(), Some("self"));
    let declaration_patient: Option<Uuid> =
        sqlx::query_scalar("SELECT patient_id FROM lead_payer_declarations WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(declaration_patient, Some(patient_id));
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

async fn insert_patient_first_wizard_lead(app: &TestApp, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, street_address, city, zip_code,
                primary_concern_text, requested_specialties,
                qualification_status, compliance_status,
                consent_healthcare, consent_privacy_practices,
                intake_source, intake_model, created_by
           ) VALUES (
                'Case', $1, $2, '+4915112345679', 'DE', 'de',
                DATE '1988-03-14', 'male', 'Hauptstr. 2', 'Berlin', '10115',
                'Chronic knee pain', '["orthopedics"]'::jsonb,
                'qualified', 'signed', true, true,
                'staff_wizard', 'patient_first', $3
           ) RETURNING id"#,
    )
    .bind(format!("Link-{tag}"))
    .bind(format!(
        "case-link-{tag}-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind(app.patient_manager_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap()
}

async fn lead_cases(pool: &PgPool, lead_id: Uuid) -> Vec<(Uuid, Option<Uuid>, Option<Uuid>)> {
    sqlx::query_as(
        r#"SELECT id, patient_id, source_lead_id
           FROM cases
           WHERE lead_id = $1 OR source_lead_id = $1
           ORDER BY created_at, id"#,
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn wizard_prospect(app: &TestApp, lead_id: Uuid) -> (Uuid, Uuid) {
    let (status, prospect) = json_request(
        app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &app.auth_header("patient_manager"),
        Some(json!({
            "hauptanfragegrund": "Chronic knee pain",
            "zuweiser": "Self referral"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prospect}");
    (
        Uuid::parse_str(prospect["patient_id"].as_str().unwrap()).unwrap(),
        Uuid::parse_str(prospect["case_id"].as_str().unwrap()).unwrap(),
    )
}

async fn wizard_convert(app: &TestApp, lead_id: Uuid) -> Value {
    let (status, converted) = json_request(
        app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/wizard-convert"),
        &app.auth_header("patient_manager"),
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    converted
}

#[tokio::test]
async fn wizard_reuses_the_lead_case_opened_through_the_cases_api() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let lead_id = insert_patient_first_wizard_lead(&app, "cases-api").await;

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &app.auth_header("patient_manager"),
        Some(json!({ "lead_id": lead_id, "hauptanfragegrund": "Chronic knee pain" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let case_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let link: (Option<Uuid>, Option<Uuid>) =
        sqlx::query_as("SELECT lead_id, source_lead_id FROM cases WHERE id = $1")
            .bind(case_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(link, (Some(lead_id), Some(lead_id)));

    let (patient_id, prospect_case_id) = wizard_prospect(&app, lead_id).await;
    assert_eq!(
        prospect_case_id, case_id,
        "the prospect step must reuse the lead's case"
    );
    assert_eq!(
        lead_cases(pool, lead_id).await,
        vec![(case_id, Some(patient_id), Some(lead_id))]
    );

    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    assert_eq!(artifacts.case_id, case_id);
    let converted = wizard_convert(&app, lead_id).await;
    assert_eq!(converted["patient_id"], patient_id.to_string());
    assert_eq!(
        lead_cases(pool, lead_id).await,
        vec![(case_id, Some(patient_id), Some(lead_id))],
        "conversion must keep exactly one case for the lead"
    );
}

#[tokio::test]
async fn wizard_adopts_a_lead_case_linked_only_through_lead_id() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let lead_id = insert_patient_first_wizard_lead(&app, "legacy-link").await;
    // Cases opened on a lead before POST /cases recorded the provenance.
    let case_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO cases (case_id, lead_id, manager_id, hauptanfragegrund)
           VALUES ($1, $2, $3, 'Chronic knee pain')
           RETURNING id"#,
    )
    .bind(format!("C-LEGACY-{}", lead_id.simple()))
    .bind(lead_id)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();

    let (patient_id, prospect_case_id) = wizard_prospect(&app, lead_id).await;
    assert_eq!(prospect_case_id, case_id);
    assert_eq!(
        lead_cases(pool, lead_id).await,
        vec![(case_id, Some(patient_id), Some(lead_id))]
    );

    seed_complete_lead_onboarding(&app, lead_id).await;
    wizard_convert(&app, lead_id).await;
    assert_eq!(
        lead_cases(pool, lead_id).await,
        vec![(case_id, Some(patient_id), Some(lead_id))]
    );
}

#[tokio::test]
async fn conversion_tolerates_a_legacy_duplicate_lead_case() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let lead_id = insert_patient_first_wizard_lead(&app, "legacy-duplicate").await;
    let (patient_id, prospect_case_id) = wizard_prospect(&app, lead_id).await;
    // Data left by the old prospect step: a second, lead_id-only case beside the
    // prospect case that already holds the lead provenance.
    let duplicate_case_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO cases (case_id, lead_id, manager_id, hauptanfragegrund)
           VALUES ($1, $2, $3, 'Chronic knee pain')
           RETURNING id"#,
    )
    .bind(format!("C-DUP-{}", lead_id.simple()))
    .bind(lead_id)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();

    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    wizard_convert(&app, lead_id).await;

    for (case_id, expected_source) in [(prospect_case_id, Some(lead_id)), (duplicate_case_id, None)]
    {
        let link: (Option<Uuid>, Option<Uuid>, Option<Uuid>) =
            sqlx::query_as("SELECT patient_id, lead_id, source_lead_id FROM cases WHERE id = $1")
                .bind(case_id)
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(
            link,
            (Some(patient_id), None, expected_source),
            "the provenance stays on the prospect case and the duplicate moves to the patient"
        );
    }
    let order_case_id: Option<Uuid> =
        sqlx::query_scalar("SELECT case_id FROM orders WHERE id = $1")
            .bind(artifacts.order_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(order_case_id, Some(prospect_case_id));
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
    // Moving the period of the signed order resets its signatures (QA C3-01);
    // the client signs the new version again (what its scan leaves behind).
    let (status, response) = json_request(&app, "POST", &contract_path, &pm,
        Some(json!({"contract_id": artifacts.contract_id, "date_from": "2030-09-01", "date_to": "2030-09-15", "confirm_signature_reset": true}))).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["signature_reset"], true, "{response}");
    sqlx::query("UPDATE orders SET signed_patient=true,signed_agency=true,signed_at=now(),signed_patient_at=now(),signed_agency_at=now() WHERE id=$1")
        .bind(artifacts.order_id).execute(pool).await.unwrap();
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
    // The contract has no validity period: legacy dates that do not cover the
    // visit are ignored, and only a terminated contract blocks the repeat order.
    for (contract_status, passes) in [("signed", true), ("terminated", false)] {
        sqlx::query(
            "UPDATE framework_contracts SET status = $2, valid_to = DATE '2030-09-14' WHERE id = $1",
        )
        .bind(artifacts.contract_id)
        .bind(contract_status)
        .execute(pool)
        .await
        .unwrap();
        let (status, checked) =
            json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
        assert_eq!(status, StatusCode::OK, "{checked}");
        let contract_check = checked["readiness"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "contract_signed")
            .unwrap();
        assert_eq!(contract_check["passed"], passes, "{contract_check}");
        if !passes {
            assert_eq!(checked["readiness"]["conversion_ready"], false, "{checked}");
            assert!(
                checked
                    .to_string()
                    .contains("Framework contract was terminated"),
                "{checked}"
            );
        }
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

async fn insert_status_lead(app: &TestApp, tag: &str, status: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, qualification_status, created_by
           ) VALUES ('Status', $1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("Lead {tag}"))
    .bind(format!("status-{status}-{tag}@example.com"))
    .bind(status)
    .bind(app.patient_manager_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn deleted_lead_is_read_only_and_leaves_the_active_list() {
    let Some(app) = test_app().await else {
        return;
    };
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let lead_id = insert_status_lead(&app, &tag, "new").await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "duplicate" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["lifecycle"]["can_resolve_failed"], false, "{detail}");

    // The erasure is not undone by an edit.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "first_name": "Restored", "email": format!("restored-{tag}@example.com") })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let first_name: String = sqlx::query_scalar("SELECT first_name FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(first_name, "Deleted");

    let listed = |body: &Value| {
        body.as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == lead_id.to_string())
    };
    let (status, active) = json_request(&app, "GET", "/api/v1/leads", &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{active}");
    assert!(!listed(&active), "a deleted lead left the active list");
    let (status, deleted) =
        json_request(&app, "GET", "/api/v1/leads?status=deleted", &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{deleted}");
    assert!(listed(&deleted), "the deleted filter finds it: {deleted}");
}

/// QA 2026-10-12: what staff typed as the reason («Другое») and the internal
/// note do not survive deleting and anonymising the lead — neither on the row
/// nor in its audit and history rows. Archiving keeps them.
#[tokio::test]
async fn deleting_a_lead_scrubs_the_typed_reason_and_note() {
    let Some(app) = test_app().await else {
        return;
    };
    let pm = app.auth_header("patient_manager");
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let typed_reason = "Anna Muster: Diagnose passt nicht, Bruder Ben Muster ruft an";
    let typed_note = "Interne Notiz: Telefon +49 30 1234567";

    let archived = insert_status_lead(&app, &format!("{tag}a"), "new").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{archived}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "archive", "reason": typed_reason, "note": typed_note })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (reason, note): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT failed_reason, failed_note FROM leads WHERE id = $1")
            .bind(archived)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(reason.as_deref(), Some(typed_reason));
    assert_eq!(note.as_deref(), Some(typed_note));

    let deleted = insert_status_lead(&app, &format!("{tag}d"), "new").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{deleted}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": typed_reason, "note": typed_note })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!body.to_string().contains("Anna Muster"), "{body}");
    let (reason, note): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT failed_reason, failed_note FROM leads WHERE id = $1")
            .bind(deleted)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(reason.as_deref(), Some("other"));
    assert_eq!(note, None);
    let audit: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE entity_id = $1 AND action = 'resolve_failed_lead'",
    )
    .bind(deleted)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0]["reason"], "other", "{:?}", audit[0]);
    assert!(audit[0]["note"].is_null(), "{:?}", audit[0]);
    let history: Vec<String> = sqlx::query_scalar(
        "SELECT concat_ws(' ', note, metadata::text) FROM workflow_lifecycle_events WHERE entity_id = $1",
    )
    .bind(deleted)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(
        history
            .iter()
            .all(|row| !row.contains("Anna Muster") && !row.contains("Notiz")),
        "{history:?}"
    );
    // A listed reason stays as it is.
    let listed = insert_status_lead(&app, &format!("{tag}l"), "new").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{listed}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "duplicate" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let reason: Option<String> =
        sqlx::query_scalar("SELECT failed_reason FROM leads WHERE id = $1")
            .bind(listed)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(reason.as_deref(), Some("duplicate"));
}

/// QA 2026-10-12, A3-02 (owner decision 2026-10-12): the text of «Не подходит»
/// → «Другое» goes to the append-only audit as its code only; the lead history
/// keeps it until the lead is deleted and anonymised, which scrubs the history
/// and — through the narrow erasure exception of `audit_log` — the free text of
/// audit rows written before the rule. Every other change of the audit log is
/// still refused.
#[tokio::test]
async fn deleting_a_lead_scrubs_the_not_qualified_text_from_history_and_audit() {
    let Some(app) = test_app().await else {
        return;
    };
    let pm = app.auth_header("patient_manager");
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let typed =
        format!("Ben Muster {tag}: Diagnose Prostatakarzinom, will nicht zahlen (synthetisch)");
    let typed_note = format!("Interne Notiz {tag}: Rückruf bei Anna Muster");
    let lead_id = insert_status_lead(&app, &tag, "in_progress").await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm,
        Some(json!({ "status": "not_qualified", "reason": typed })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // (1) The audit keeps the code and that a text was typed, never the text.
    let audit: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'qualify_lead' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audit["reason"], "other", "{audit}");
    assert_eq!(audit["reason_free_text"], true, "{audit}");
    // The lead and its history keep the text while the lead lives.
    let (_, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(detail["failed_outcome"]["reason"], json!(typed), "{detail}");
    assert!(detail["lifecycle"].to_string().contains(&tag), "{detail}");

    // Rows written before the rule carry the text: the scrub reaches them.
    let order_id = Uuid::new_v4();
    let legacy: Vec<i64> = {
        let mut ids = Vec::new();
        for (action, entity_type, entity_id, context) in [
            (
                "qualify_lead",
                "lead",
                lead_id,
                json!({ "status": "not_qualified", "previous_status": "new", "reason": typed }),
            ),
            (
                "resolve_failed_lead",
                "lead",
                lead_id,
                json!({ "resolution": "archive", "reason": typed, "note": typed_note,
                        "failed_from_status": "not_qualified" }),
            ),
            (
                "cancel_order",
                "order",
                order_id,
                json!({ "status": "cancelled", "source_lead_id": lead_id, "lead_reason": typed,
                        "cancelled_service_ids": [] }),
            ),
        ] {
            let id: i64 = sqlx::query_scalar(
                r#"INSERT INTO audit_log (action, entity_type, entity_id, context, created_at)
                   VALUES ($1, $2, $3, $4, now() - interval '1 day')
                   RETURNING id"#,
            )
            .bind(action)
            .bind(entity_type)
            .bind(entity_id)
            .bind(context)
            .fetch_one(pool)
            .await
            .unwrap();
            ids.push(id);
        }
        ids
    };
    // An unrelated lead's row stays untouched.
    let other_lead = insert_status_lead(&app, &format!("{tag}o"), "new").await;
    let untouched: i64 = sqlx::query_scalar(
        r#"INSERT INTO audit_log (action, entity_type, entity_id, context)
           VALUES ('qualify_lead', 'lead', $1, $2) RETURNING id"#,
    )
    .bind(other_lead)
    .bind(json!({ "status": "not_qualified", "reason": typed }))
    .fetch_one(pool)
    .await
    .unwrap();

    // The audit log stays append-only outside the erasure.
    for statement in [
        "UPDATE audit_log SET context = jsonb_set(context, '{reason}', '\"x\"') WHERE id = $1",
        "DELETE FROM audit_log WHERE id = $1",
    ] {
        let refused = sqlx::query(statement).bind(legacy[0]).execute(pool).await;
        assert!(refused.is_err(), "{statement} must be refused");
    }
    // Inside it, only text values of `context` may change: no other column,
    // no key, no flag, no delete.
    for statement in [
        "UPDATE audit_log SET action = 'other_action' WHERE id = $1",
        "UPDATE audit_log SET created_at = now() WHERE id = $1",
        "UPDATE audit_log SET context = context - 'reason' WHERE id = $1",
        "UPDATE audit_log SET context = jsonb_set(context, '{reason}', 'true') WHERE id = $1",
        "DELETE FROM audit_log WHERE id = $1",
    ] {
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("SELECT set_config('gmed.dsgvo_erasure', 'on', true)")
            .execute(&mut *tx)
            .await
            .unwrap();
        let refused = sqlx::query(statement)
            .bind(legacy[0])
            .execute(&mut *tx)
            .await;
        assert!(
            refused.is_err(),
            "{statement} must be refused in the erasure"
        );
        tx.rollback().await.unwrap();
    }

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": typed, "note": typed_note })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!body.to_string().contains(&tag), "{body}");

    // (2) The lead history keeps the code only.
    let history: Vec<(String, Option<String>, Value)> = sqlx::query_as(
        r#"SELECT transition_kind, note, metadata FROM workflow_lifecycle_events
           WHERE entity_type = 'lead' AND entity_id = $1"#,
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(
        history
            .iter()
            .any(|(kind, note, _)| kind == "status_change" && note.as_deref() == Some("other")),
        "{history:?}"
    );
    for (_, note, metadata) in &history {
        let row = format!("{note:?} {metadata}");
        assert!(!row.contains(&tag), "{row}");
    }
    let (_, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert!(!detail.to_string().contains(&tag), "{detail}");

    // (3) No audit row of the lead holds the text any more; the rows, their
    // actions, times and codes stay.
    let leaking: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE (entity_id = $1 OR context ->> 'source_lead_id' = $1::text)
             AND context::text LIKE '%' || $2 || '%'"#,
    )
    .bind(lead_id)
    .bind(&tag)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(leaking, 0);
    for id in &legacy {
        let (context, created_at_old): (Value, bool) = sqlx::query_as(
            "SELECT context, created_at < now() - interval '12 hours' FROM audit_log WHERE id = $1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(created_at_old, "the time stays");
        for key in ["reason", "lead_reason", "note"] {
            if context.get(key).is_some() {
                assert_eq!(context[key], "[erased]", "{key}: {context}");
            }
        }
    }
    let cancel: Value = sqlx::query_scalar("SELECT context FROM audit_log WHERE id = $1")
        .bind(legacy[2])
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(cancel["status"], "cancelled", "{cancel}");
    assert_eq!(cancel["cancelled_service_ids"], json!([]), "{cancel}");
    // The deletion's own row says what it scrubbed.
    let resolution: Value = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'resolve_failed_lead' AND entity_id = $1
             AND context ->> 'resolution' = 'delete'"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(resolution["reason"], "other", "{resolution}");
    assert_eq!(resolution["reason_free_text"], true, "{resolution}");
    assert_eq!(resolution["note_present"], true, "{resolution}");
    assert!(
        resolution["scrubbed_free_text"]["audit_rows"]
            .as_u64()
            .is_some_and(|rows| rows >= 3),
        "{resolution}"
    );
    assert!(
        resolution["scrubbed_free_text"]["lifecycle_events"]
            .as_u64()
            .is_some_and(|rows| rows >= 1),
        "{resolution}"
    );
    // Another lead's row is not touched.
    let other: Value = sqlx::query_scalar("SELECT context FROM audit_log WHERE id = $1")
        .bind(untouched)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(other["reason"], json!(typed), "{other}");
    // The setting is off again after the scrub.
    let setting: Option<String> =
        sqlx::query_scalar("SELECT current_setting('gmed.dsgvo_erasure', true)")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_ne!(setting.as_deref(), Some("on"));

    // The database's own rule for free text matches the server's.
    for (reason, free) in [
        ("costs", false),
        ("other", false),
        ("auto_purge_storage_limitation", false),
        ("  duplicate ", false),
        ("", false),
        ("Umzug ins Ausland", true),
        ("[erased]", true),
    ] {
        let sql: bool = sqlx::query_scalar("SELECT gmed_lead_failure_reason_is_free_text($1)")
            .bind(reason)
            .fetch_one(pool)
            .await
            .unwrap();
        assert_eq!(sql, free, "{reason:?}");
    }
}

/// A document row with a stored file, as the upload would leave it.
async fn insert_stored_document(
    app: &TestApp,
    lead_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    name: &str,
) -> (Uuid, std::path::PathBuf) {
    let document_id = Uuid::new_v4();
    let storage_key = format!("{document_id}_{name}.pdf");
    std::fs::create_dir_all("uploads/documents").unwrap();
    let path = std::path::Path::new("uploads/documents").join(&storage_key);
    std::fs::write(&path, b"%PDF-1.4 synthetic").unwrap();
    sqlx::query(
        r#"INSERT INTO documents (
                id, lead_id, patient_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, mime_type, file_size, storage_key,
                extracted_text, version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, 'medical_report', 'medical_report',
                'active', 'internal', true, 'application/pdf', 18, $6,
                'Synthetic finding text', $1, 1, $7
           )"#,
    )
    .bind(document_id)
    .bind(lead_id)
    .bind(patient_id)
    .bind(format!("Befund {name}"))
    .bind(format!("{name}.pdf"))
    .bind(&storage_key)
    .bind(app.patient_manager_id)
    .execute(&app.suite.pool)
    .await
    .unwrap();
    (document_id, path)
}

async fn insert_unqualified_lead(app: &TestApp, tag: &str, age_days: i32) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, qualification_status, intake_source,
                intake_model, created_by, created_at, wizard_state
           ) VALUES (
                'Retention', $1, $2, '+4915100000000', 'DE', 'de',
                DATE '1980-05-05', 'female', 'in_progress', 'staff_wizard',
                'patient_first', $3, now() - make_interval(days => $4),
                '{"referrer": "Dr. Beispiel", "passport_expiry": "2030-01-01"}'::jsonb
           ) RETURNING id"#,
    )
    .bind(format!("Lead {tag}"))
    .bind(format!("retention-{tag}@example.com"))
    .bind(app.patient_manager_id)
    .bind(age_days)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn an_unqualified_lead_without_consent_is_purged_with_everything_it_owns() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let ceo = app.auth_header("ceo");
    let tag = Uuid::new_v4().simple().to_string();
    // The rule started long ago, so only the age of a lead decides.
    let policy = gmed_server::routes::leads::UnqualifiedLeadRetention {
        days: 14,
        effective_at: chrono::Utc::now() - chrono::Duration::days(90),
    };

    // Due: a patient-first lead with a prospect, a clinical record, an open
    // preparation order and documents on the lead and on the prospect.
    let due = insert_unqualified_lead(&app, &format!("{tag}-due"), 15).await;
    let (status, prospect) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{due}/prospect"),
        &pm,
        Some(json!({ "hauptanfragegrund": "Temporary concern" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prospect}");
    let prospect_id = Uuid::parse_str(prospect["patient_id"].as_str().unwrap()).unwrap();
    let (status, saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{prospect_id}/diagnoses"),
        &ceo,
        Some(json!({ "items": [{ "kind": "main", "label": "Temporary diagnosis" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, source_lead_id, patient_id, needs_description,
                phase, intake_state, created_by
           ) VALUES ($1, $2, $3, 'Prepare the visit', 'discovery', 'draft', $4)
           ON CONFLICT(source_lead_id) WHERE source_lead_id IS NOT NULL DO UPDATE
             SET needs_description = EXCLUDED.needs_description
           RETURNING id"#,
    )
    .bind(format!("A-RET-{tag}"))
    .bind(due)
    .bind(prospect_id)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let (lead_document, lead_file) =
        insert_stored_document(&app, Some(due), None, &format!("lead-{tag}")).await;
    let (prospect_document, prospect_file) =
        insert_stored_document(&app, None, Some(prospect_id), &format!("prospect-{tag}")).await;

    // Not due: signed consent, a qualified lead, a young lead, and one whose
    // deadline is close.
    let signed = insert_unqualified_lead(&app, &format!("{tag}-signed"), 15).await;
    let qualified = insert_unqualified_lead(&app, &format!("{tag}-qualified"), 15).await;
    let young = insert_unqualified_lead(&app, &format!("{tag}-young"), 2).await;
    let soon = insert_unqualified_lead(&app, &format!("{tag}-soon"), 12).await;
    sqlx::query("UPDATE leads SET compliance_status = 'signed' WHERE id = $1")
        .bind(signed)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE leads SET qualification_status = 'qualified' WHERE id = $1")
        .bind(qualified)
        .execute(pool)
        .await
        .unwrap();

    // Due, but an order of the lead has an invoice: left for a manual decision.
    let invoiced = insert_unqualified_lead(&app, &format!("{tag}-invoiced"), 15).await;
    let invoiced_order: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, source_lead_id, needs_description, created_by)
           VALUES ($1, $2, 'Invoiced preparation', $3)
           ON CONFLICT(source_lead_id) WHERE source_lead_id IS NOT NULL DO UPDATE
             SET needs_description = EXCLUDED.needs_description
           RETURNING id"#,
    )
    .bind(format!("A-RET-INV-{tag}"))
    .bind(invoiced)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    seed_supplier_invoice(&app, invoiced_order, &format!("ret-{tag}")).await;

    // The API shows the deadline: creation plus the window.
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{signed}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert!(detail["retention_deadline_at"].is_null(), "{detail}");

    let all = [due, signed, qualified, young, soon, invoiced];
    let report = gmed_server::routes::leads::purge_unqualified_leads(
        &app.suite.state,
        policy,
        chrono::Utc::now(),
        Some(&all),
    )
    .await
    .unwrap();
    assert_eq!(
        (report.purged, report.blocked, report.warned, report.errors),
        (1, 1, 1, 0),
        "{report:?}"
    );

    // The due lead is an anonymous tombstone.
    let (status, first_name, wizard_state, email): (String, String, Value, Option<String>) =
        sqlx::query_as(
            "SELECT qualification_status, first_name, wizard_state, email FROM leads WHERE id = $1",
        )
        .bind(due)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        (status.as_str(), first_name.as_str()),
        ("deleted", "Deleted")
    );
    assert_eq!(wizard_state, json!({}));
    assert_eq!(email, None);
    // Its documents, their files, the prospect and the clinical record are gone.
    let documents_left: i64 =
        sqlx::query_scalar("SELECT count(*) FROM documents WHERE id = ANY($1)")
            .bind(vec![lead_document, prospect_document])
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(documents_left, 0);
    assert!(!lead_file.exists(), "the lead's file is removed from disk");
    assert!(
        !prospect_file.exists(),
        "the prospect's file is removed from disk"
    );
    let prospect_left: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(prospect_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!prospect_left, "the prospect patient is deleted");
    // The preparation order is cancelled and stays with the tombstone.
    let (order_status, reason, order_patient): (String, Option<String>, Option<Uuid>) =
        sqlx::query_as("SELECT status, cancellation_reason, patient_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(order_status, "cancelled");
    assert_eq!(reason.as_deref(), Some("lead_deleted"));
    assert_eq!(order_patient, None);
    // Nothing names the lead any more, and the deletion is on record.
    let notifications: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE entity_type = 'lead' AND entity_id = $1",
    )
    .bind(due)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(notifications, 0);
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE action = 'auto_purge_lead' AND entity_id = $1
             AND context->>'reason' = 'unqualified_lead_retention'"#,
    )
    .bind(due)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // The others are untouched.
    let statuses: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, qualification_status FROM leads WHERE id = ANY($1)")
            .bind(vec![signed, qualified, young, soon, invoiced])
            .fetch_all(pool)
            .await
            .unwrap();
    for (lead_id, status) in statuses {
        assert_ne!(status, "deleted", "lead {lead_id} must stay");
    }
    // The close deadline was announced once, without the person's name.
    let warnings: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT title, body FROM user_notifications
           WHERE kind = 'lead_retention_warning' AND entity_id = $1"#,
    )
    .bind(soon)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(!warnings.is_empty(), "the creator is warned");
    assert!(
        warnings.iter().all(|(title, body)| !format!(
            "{title} {}",
            body.clone().unwrap_or_default()
        )
        .contains("Retention")),
        "{warnings:?}"
    );
    let blocked: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE kind = 'lead_retention_blocked' AND entity_id = $1"#,
    )
    .bind(invoiced)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(
        blocked > 0,
        "the blocked lead is reported for a manual decision"
    );

    // A second sweep neither warns nor reports again.
    let again = gmed_server::routes::leads::purge_unqualified_leads(
        &app.suite.state,
        policy,
        chrono::Utc::now(),
        Some(&all),
    )
    .await
    .unwrap();
    assert_eq!((again.purged, again.warned), (0, 0), "{again:?}");

    // The young lead shows its deadline in the API.
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{young}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert!(detail["retention_deadline_at"].is_string(), "{detail}");
}

/// QA B-18 a (decision 2026-10-11): a repeat intake of an existing patient
/// with a valid signed DSGVO consent is not purged after 14 days and shows no
/// deadline; without such a consent (never signed, or withdrawn) the rule
/// applies as to any lead. The patient record itself is never touched.
#[tokio::test]
async fn a_repeat_intake_of_a_consented_patient_is_kept_past_the_unqualified_window() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let policy = gmed_server::routes::leads::UnqualifiedLeadRetention {
        days: 14,
        effective_at: chrono::Utc::now() - chrono::Duration::days(90),
    };

    let pm_id = app.patient_manager_id;
    let insert_patient = |suffix: &'static str, legal_status: Value| {
        let tag = tag.clone();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                r#"INSERT INTO patients (
                        patient_id, first_name, last_name, birth_date, gender, created_by,
                        lifecycle_status, legal_status
                   ) VALUES ($1, 'Anna', $2, DATE '1980-05-05', 'female', $3, 'active', $4)
                   RETURNING id"#,
            )
            .bind(format!("PT-REP-{suffix}-{tag}"))
            .bind(format!("Muster {suffix}"))
            .bind(pm_id)
            .bind(legal_status)
            .fetch_one(pool)
            .await
            .unwrap()
        }
    };
    let consented = insert_patient("consented", json!({ "dsgvo_signed": true })).await;
    let withdrawn = insert_patient("withdrawn", json!({ "dsgvo_signed": true })).await;
    let unconsented = insert_patient("unconsented", json!({})).await;
    // The consent of one patient is on record and in force, the other's was
    // withdrawn after it was given.
    sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, expires_at, context
           ) VALUES ($1, $2, 'dsgvo_data_transfer', true, now() - interval '400 days',
                     now() - interval '35 days', '{}'::jsonb)"#,
    )
    .bind(consented)
    .bind(app.patient_manager_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, revoked_at, context,
                created_at
           ) VALUES
                ($1, $2, 'dsgvo_data_transfer', true, now() - interval '30 days',
                 now() - interval '1 day', '{}'::jsonb, now() - interval '30 days'),
                ($1, $2, 'dsgvo_data_transfer', false, NULL, now() - interval '1 day',
                 '{"action": "revoke"}'::jsonb, now() - interval '1 day')"#,
    )
    .bind(withdrawn)
    .bind(app.patient_manager_id)
    .execute(pool)
    .await
    .unwrap();

    let repeat_intake = |patient: Uuid, suffix: &'static str| {
        let tag = tag.clone();
        let app = &app;
        async move {
            let lead = insert_unqualified_lead(app, &format!("{tag}-{suffix}"), 20).await;
            sqlx::query(
                "UPDATE leads SET repeat_patient_id = $2, prospect_patient_id = $2 WHERE id = $1",
            )
            .bind(lead)
            .bind(patient)
            .execute(pool)
            .await
            .unwrap();
            lead
        }
    };
    let kept = repeat_intake(consented, "kept").await;
    let withdrawn_lead = repeat_intake(withdrawn, "withdrawn").await;
    let unconsented_lead = repeat_intake(unconsented, "unconsented").await;

    // No deadline and no badge for the consented patient's repeat intake.
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{kept}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert!(detail["retention_deadline_at"].is_null(), "{detail}");
    for lead in [withdrawn_lead, unconsented_lead] {
        let (status, detail) =
            json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
        assert_eq!(status, StatusCode::OK, "{detail}");
        assert!(detail["retention_deadline_at"].is_string(), "{detail}");
    }

    let report = gmed_server::routes::leads::purge_unqualified_leads(
        &app.suite.state,
        policy,
        chrono::Utc::now(),
        Some(&[kept, withdrawn_lead, unconsented_lead]),
    )
    .await
    .unwrap();
    assert_eq!((report.purged, report.errors), (2, 0), "{report:?}");

    let first_name = |lead: Uuid| async move {
        sqlx::query_scalar::<_, String>("SELECT first_name FROM leads WHERE id = $1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap()
    };
    assert_ne!(
        first_name(kept).await,
        "Deleted",
        "the consented repeat intake stays"
    );
    assert_eq!(first_name(withdrawn_lead).await, "Deleted");
    assert_eq!(first_name(unconsented_lead).await, "Deleted");
    // The existing patients keep their records.
    let patients_intact: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM patients
           WHERE id = ANY($1) AND first_name = 'Anna' AND lifecycle_status = 'active'"#,
    )
    .bind(vec![consented, withdrawn, unconsented])
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(patients_intact, 3);
}

#[tokio::test]
async fn staff_can_record_whether_the_client_has_medical_documents() {
    let Some(app) = test_app().await else {
        return;
    };
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let lead_id = insert_status_lead(&app, &tag, "in_progress").await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "has_medical_records": "yes" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["has_medical_records"], "yes", "{detail}");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "has_medical_records": "maybe" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
}

#[tokio::test]
async fn retention_sweep_counts_from_the_last_status_change() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    // Archived 200 days ago, reopened and rejected today.
    let reopened = insert_status_lead(&app, &format!("{tag}-r"), "not_qualified").await;
    // Archived 200 days ago and never touched again.
    let stale = insert_status_lead(&app, &format!("{tag}-s"), "archived").await;
    sqlx::query(
        r#"UPDATE leads
           SET failed_outcome_status = CASE WHEN id = $2 THEN 'archived' ELSE 'none' END,
               failed_from_status = 'in_progress',
               failed_reason = 'no_budget',
               failed_processed_at = now() - interval '200 days',
               status_changed_at = CASE WHEN id = $2 THEN now() - interval '200 days' ELSE now() END
           WHERE id IN ($1, $2)"#,
    )
    .bind(reopened)
    .bind(stale)
    .execute(pool)
    .await
    .unwrap();

    gmed_server::routes::leads::auto_purge_stale_archived(&app.suite.state)
        .await
        .unwrap();

    let state = |lead_id: Uuid| async move {
        sqlx::query_as::<_, (String, String, Option<String>)>(
            "SELECT qualification_status, first_name, failed_from_status FROM leads WHERE id = $1",
        )
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap()
    };
    let (status, first_name, _) = state(reopened).await;
    assert_eq!(status, "not_qualified");
    assert_eq!(first_name, "Status");
    let (status, first_name, from_status) = state(stale).await;
    assert_eq!(status, "deleted");
    assert_eq!(first_name, "Deleted");
    assert_eq!(from_status.as_deref(), Some("archived"));
    let history: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM workflow_lifecycle_events
           WHERE entity_type = 'lead' AND entity_id = $1
             AND transition_kind = 'deleted' AND to_stage = 'deleted'"#,
    )
    .bind(stale)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(history, 1, "the automatic deletion is in the lead history");
}

async fn insert_first_intake_lead(app: &TestApp, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, qualification_status, intake_source, created_by
           ) VALUES (
                'Failed', 'Lead', $1, '+4915133333333', 'DE', 'de',
                DATE '1990-01-01', 'female', 'in_progress', 'manual', $2
           ) RETURNING id"#,
    )
    .bind(format!("failed-{tag}@example.com"))
    .bind(app.patient_manager_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn archiving_a_failed_lead_withdraws_its_order_and_restoring_reopens_it() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let lead_id = insert_first_intake_lead(&app, &tag).await;
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    let order_id = artifacts.order_id;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "archive", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The lead's order is cancelled with it, like any order cancellation.
    let (order_status, reason, cancelled_by): (String, Option<String>, Option<Uuid>) =
        sqlx::query_as(
            "SELECT status, cancellation_reason, cancelled_by FROM orders WHERE id = $1",
        )
        .bind(order_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(order_status, "cancelled");
    assert_eq!(reason.as_deref(), Some("lead_archived"));
    assert_eq!(cancelled_by, Some(app.patient_manager_id));
    let service_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(artifacts.service_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(service_status, "cancelled");
    let quote_status: String = sqlx::query_scalar("SELECT status FROM quotes WHERE id = $1")
        .bind(artifacts.quote_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(quote_status, "rejected");
    let (order_audits, quote_audits): (i64, i64) = sqlx::query_as(
        r#"SELECT
               (SELECT count(*) FROM audit_log
                WHERE action = 'cancel_order' AND entity_id = $1
                  AND context->>'source_lead_id' = $3::text
                  AND context->>'reason' = 'lead_archived'),
               (SELECT count(*) FROM audit_log
                WHERE action = 'close_quote_for_cancelled_order' AND entity_id = $2)"#,
    )
    .bind(order_id)
    .bind(artifacts.quote_id)
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!((order_audits, quote_audits), (1, 1));
    let (status, orders) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders?lead_id={lead_id}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{orders}");
    let listed = orders
        .as_array()
        .or_else(|| orders["items"].as_array())
        .expect("orders list")
        .iter()
        .find(|item| item["id"] == order_id.to_string())
        .expect("lead order is listed")
        .clone();
    assert_eq!(listed["status"], "cancelled", "{listed}");

    // Returning the lead to work reopens the order with its planned service;
    // the closed quote stays closed until the intake confirms a quote again.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm,
        Some(json!({ "status": "in_progress" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (order_status, reason, cancelled_at): (
        String,
        Option<String>,
        Option<chrono::DateTime<chrono::Utc>>,
    ) = sqlx::query_as(
        "SELECT status, cancellation_reason, cancelled_at FROM orders WHERE id = $1",
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(order_status, "active");
    assert_eq!(reason, None);
    assert_eq!(cancelled_at, None);
    let service_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(artifacts.service_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(service_status, "planned");
    let quote_status: String = sqlx::query_scalar("SELECT status FROM quotes WHERE id = $1")
        .bind(artifacts.quote_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(quote_status, "rejected");
    let reopen_audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'reopen_lead_order' AND entity_id = $1",
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(reopen_audits, 1);

    // The reserved reasons mark only the failed-lead withdrawal.
    for reserved in ["lead_archived", "lead_deleted"] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/orders/{order_id}/status"),
            &pm,
            Some(json!({ "status": "cancelled", "reason": reserved })),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
}

#[tokio::test]
async fn deleting_a_failed_lead_cancels_its_order_for_good() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let lead_id = insert_first_intake_lead(&app, &tag).await;
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (order_status, reason): (String, Option<String>) =
        sqlx::query_as("SELECT status, cancellation_reason FROM orders WHERE id = $1")
            .bind(artifacts.order_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(order_status, "cancelled");
    assert_eq!(reason.as_deref(), Some("lead_deleted"));

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm,
        Some(json!({ "status": "in_progress" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let order_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
        .bind(artifacts.order_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(order_status, "cancelled");
}

/// The repair of the migration, re-run on synthetic leads.
const FAILED_LEAD_ORDERS_REPAIR: &str =
    include_str!("../../../migrations/20260928172437_withdraw_orders_of_failed_leads.sql");

#[tokio::test]
async fn failed_lead_orders_repair_withdraws_active_orders_without_invoices() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();

    // Leads that failed before the fix, their orders still active.
    let archived_lead = insert_first_intake_lead(&app, &format!("{tag}-a")).await;
    let archived = seed_complete_lead_onboarding(&app, archived_lead).await;
    let deleted_lead = insert_first_intake_lead(&app, &format!("{tag}-d")).await;
    let deleted = seed_complete_lead_onboarding(&app, deleted_lead).await;
    let invoiced_lead = insert_first_intake_lead(&app, &format!("{tag}-i")).await;
    let invoiced = seed_complete_lead_onboarding(&app, invoiced_lead).await;
    for (lead_id, outcome, processed_by) in [
        (archived_lead, "archived", Some(app.patient_manager_id)),
        (deleted_lead, "delete_anonymized", None),
        (invoiced_lead, "archived", Some(app.patient_manager_id)),
    ] {
        sqlx::query(
            r#"UPDATE leads
               SET qualification_status = CASE WHEN $2 = 'archived' THEN 'archived' ELSE 'deleted' END,
                   failed_outcome_status = $2,
                   failed_from_status = 'in_progress',
                   failed_reason = 'not_our_lead',
                   failed_processed_at = now() - interval '1 day',
                   failed_processed_by = $3
               WHERE id = $1"#,
        )
        .bind(lead_id)
        .bind(outcome)
        .bind(processed_by)
        .execute(pool)
        .await
        .unwrap();
    }
    seed_supplier_invoice(&app, invoiced.order_id, &tag).await;

    let mut tx = pool.begin().await.unwrap();
    sqlx::raw_sql(FAILED_LEAD_ORDERS_REPAIR)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let order_state = |order_id: Uuid| async move {
        sqlx::query_as::<_, (String, Option<String>, Option<Uuid>)>(
            "SELECT status, cancellation_reason, cancelled_by FROM orders WHERE id = $1",
        )
        .bind(order_id)
        .fetch_one(pool)
        .await
        .unwrap()
    };
    assert_eq!(
        order_state(archived.order_id).await,
        (
            "cancelled".to_string(),
            Some("lead_archived".to_string()),
            Some(app.patient_manager_id)
        )
    );
    assert_eq!(
        order_state(deleted.order_id).await,
        (
            "cancelled".to_string(),
            Some("lead_deleted".to_string()),
            None
        )
    );
    assert_eq!(order_state(invoiced.order_id).await.0, "active");
    let statuses: (String, String, String, String) = sqlx::query_as(
        r#"SELECT (SELECT status FROM order_leistungen WHERE id = $1),
                  (SELECT status FROM quotes WHERE id = $2),
                  (SELECT status FROM order_leistungen WHERE id = $3),
                  (SELECT status FROM quotes WHERE id = $4)"#,
    )
    .bind(archived.service_id)
    .bind(archived.quote_id)
    .bind(invoiced.service_id)
    .bind(invoiced.quote_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        statuses,
        (
            "cancelled".to_string(),
            "rejected".to_string(),
            "planned".to_string(),
            "accepted".to_string()
        )
    );
    let audits: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE user_id IS NULL
             AND context->>'repair' = '20260928172437_withdraw_orders_of_failed_leads'
             AND entity_id = ANY($1)"#,
    )
    .bind(vec![
        archived.order_id,
        deleted.order_id,
        invoiced.order_id,
        archived.quote_id,
        deleted.quote_id,
    ])
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audits, 4, "two orders and their two quotes");

    // A repaired archived lead returns to work like a current one.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{archived_lead}/qualify"),
        &pm,
        Some(json!({ "status": "in_progress" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(order_state(archived.order_id).await.0, "active");
    let service_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(archived.service_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(service_status, "planned");
}

/// An expected supplier invoice booked on a lead's order. A patient invoice
/// cannot reference an order without a patient (validate_patient_invoice_context),
/// so a supplier invoice is the invoice a lead's order can already carry.
async fn seed_supplier_invoice(app: &TestApp, order_id: Uuid, tag: &str) {
    let patient = seed_repeat_patient(app, true).await;
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number, invoice_date,
               amount_net, amount_vat, amount_gross, currency, status,
               paid_by, service_delivered, created_by
           ) VALUES (
               $1, $2, $3, CURRENT_DATE, 100, 19, 119, 'EUR', 'expected',
               'unpaid', false, $4
           )"#,
    )
    .bind(order_id)
    .bind(patient)
    .bind(format!("EXT-{tag}"))
    .bind(app.ceo_id)
    .execute(&app.suite.pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn a_failed_lead_is_refused_while_its_order_has_an_invoice() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let lead_id = insert_first_intake_lead(&app, &tag).await;
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    seed_supplier_invoice(&app, artifacts.order_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "archive", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("already has invoices"),
        "{body}"
    );
    let (lead_status, outcome): (String, String) = sqlx::query_as(
        "SELECT qualification_status, failed_outcome_status FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (lead_status.as_str(), outcome.as_str()),
        ("in_progress", "none")
    );
    let order_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
        .bind(artifacts.order_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(order_status, "active");
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

    // Trusted contacts become relations, but not emergency contacts by
    // themselves (owner decision 2026-10-19).
    let trusted_contacts: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT related_name, relation_type, phone, notes
               FROM patient_relations
               WHERE patient_id = $1 AND is_emergency_contact = false
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
    let (status, reason): (String, Option<String>) =
        sqlx::query_as("SELECT status, cancellation_reason FROM orders WHERE id=$1")
            .bind(order)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(status, "cancelled");
    assert_eq!(reason.as_deref(), Some("lead_archived"));
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
async fn insert_patient_framework_contract(
    app: &TestApp,
    patient: Uuid,
    status: &str,
    signed_days_ago: Option<i32>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, status, signed_at, terminated_at, created_by
           ) VALUES (
                $1, $2, $3,
                CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(days => $4) END,
                CASE WHEN $3 = 'terminated' THEN now() END,
                $5
           ) RETURNING id"#,
    )
    .bind(patient)
    .bind(format!("FC-REPEAT-{}", Uuid::new_v4().simple()))
    .bind(status)
    .bind(signed_days_ago)
    .bind(app.ceo_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap()
}

fn readiness_check_passed(lead: &Value, key: &str) -> bool {
    lead["readiness"]["checks"]
        .as_array()
        .expect("readiness checks")
        .iter()
        .find(|check| check["key"] == key)
        .unwrap_or_else(|| panic!("readiness check {key} missing: {lead}"))["passed"]
        == true
}

/// The repeat draft inherits the patient's latest signed framework contract on
/// the server. The contract is open-ended, so no new contract or PDF is needed;
/// terminated, unsigned and superseded contracts are never picked.
#[tokio::test]
async fn repeat_intake_inherits_the_latest_signed_framework_contract() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");

    let patient = seed_repeat_patient(&app, true).await;
    insert_patient_framework_contract(&app, patient, "signed", Some(30)).await;
    let latest_signed = insert_patient_framework_contract(&app, patient, "signed", Some(10)).await;
    insert_patient_framework_contract(&app, patient, "terminated", Some(1)).await;
    insert_patient_framework_contract(&app, patient, "sent", None).await;

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
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let (order_contract, intake_state): (Option<Uuid>, String) =
        sqlx::query_as("SELECT contract_id, intake_state FROM orders WHERE source_lead_id = $1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(intake_state, "draft");
    assert_eq!(order_contract, Some(latest_signed));

    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert!(
        readiness_check_passed(&detail, "contract_signed"),
        "{detail}"
    );
    assert!(
        readiness_check_passed(&detail, "framework_document_generated"),
        "an inherited signed contract needs no new PDF: {detail}"
    );

    // Only a terminated contract: the draft starts without one and needs a new contract.
    let terminated_only = seed_repeat_patient(&app, true).await;
    insert_patient_framework_contract(&app, terminated_only, "terminated", Some(5)).await;
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Repeat",
            "last_name": "Regression",
            "repeat_patient_id": terminated_only,
            "creation_key": Uuid::new_v4()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let order_contract: Option<Uuid> =
        sqlx::query_scalar("SELECT contract_id FROM orders WHERE source_lead_id = $1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(order_contract, None);
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert!(
        !readiness_check_passed(&detail, "contract_signed"),
        "{detail}"
    );
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
    // QA C3-01: moving the period of the signed draft needs the confirmed reset.
    let (s,b)=json_request(&app,"POST",&path,&pm,Some(json!({"contract_id":seeded.contract_id,"date_from":"2030-09-01","date_to":"2030-09-15"}))).await;
    assert_eq!(s, StatusCode::CONFLICT, "{b}");
    assert_eq!(b["error"], "order_signed_terms_change");
    let (s,b)=json_request(&app,"POST",&path,&pm,Some(json!({"contract_id":seeded.contract_id,"date_from":"2030-09-01","date_to":"2030-09-15","confirm_signature_reset":true}))).await;
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
    let mut order_document = String::new();
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
        if template == "single_order" {
            order_document = id.to_string();
        }
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
    // Owner decision 2026-10-12 (QA C2-14): the client's signature is recorded
    // only by the signed order document — here the scan of the paper copy,
    // which carries both signatures — never by the flag.
    let (s, b) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({"signed_patient":true})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{b}");
    assert_eq!(b["error"], "order_signature_evidence_required");
    let (s, b) = support::paper_signature(&app, &pm, &order_document).await;
    assert_eq!(s, StatusCode::OK, "{b}");
    let flags: (bool, bool) =
        sqlx::query_as("SELECT signed_patient, signed_agency FROM orders WHERE id=$1")
            .bind(order)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(flags, (true, true));
    // The signed scan stays the current document of the same order facts.
    let (_, checked) = json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
    let order_document_check = checked["readiness"]["checks"]
        .as_array()
        .and_then(|checks| {
            checks
                .iter()
                .find(|check| check["key"] == "order_document_generated")
        })
        .cloned();
    if let Some(check) = order_document_check {
        assert_eq!(check["passed"], true, "{checked}");
    }
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
        if template == "single_order" {
            order_document = b["id"].as_str().unwrap().to_string();
        }
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
    let (s, b) = support::paper_signature(&app, &pm, &order_document).await;
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

    // The detail carries the same marker, so the wizard opened from the leads
    // list runs in repeat mode just like the one opened from the patient.
    let patient_pid: String = sqlx::query_scalar("SELECT patient_id FROM patients WHERE id = $1")
        .bind(patient)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    let (status, detail) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["repeat_patient_id"], patient.to_string());
    assert_eq!(detail["repeat_patient_pid"], patient_pid);

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

#[tokio::test]
async fn concierge_sees_only_the_service_grid_and_cannot_mutate_leads() {
    let Some(app) = test_app().await else {
        return;
    };
    let pm = app.auth_header("patient_manager");
    let concierge = app.auth_header("concierge");

    // A lead carrying medical, financial and wizard data.
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Grid",
            "last_name": "Projection",
            "email": "grid-projection@example.com",
            "phone": "+49 151 7654321",
            "source": "Website",
            "country": "DE",
            "notes": "internal note about the case"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = created["id"].as_str().unwrap().to_string();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({
            "primary_concern_text": "Oncology second opinion",
            "additional_concerns": "Diabetes",
            "services": ["driver", "concierge"],
            "needs_interpreter": true,
            "has_insurance": true,
            "insurance_covers_germany": "yes",
            "insurance_provider": "Test Versicherung",
            "insurance_number": "POL-999",
            "street_address": "Hauptstr. 1",
            "zip_code": "10115",
            "wizard_state": { "step": 3, "quote_total": "1200.00" }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let excluded = [
        "notes",
        "message",
        "primary_concern_text",
        "additional_concerns",
        "has_insurance",
        "insurance_covers_germany",
        "insurance_provider",
        "insurance_number",
        "street_address",
        "zip_code",
        "compliance_status",
        "raw_payload",
        "lifecycle",
        "failed_outcome",
        "console_promoted_by",
        "prospect_patient_id",
    ];
    let assert_projected = |lead: &Value, context: &str| {
        assert_eq!(lead["id"], lead_id, "{context}");
        assert_eq!(lead["first_name"], "Grid", "{context}");
        assert_eq!(lead["last_name"], "Projection", "{context}");
        assert_eq!(lead["qualification_status"], "new", "{context}");
        assert_eq!(lead["lead_type"], "console", "{context}");
        assert_eq!(lead["country"], "DE", "{context}");
        assert_eq!(lead["email"], "grid-projection@example.com", "{context}");
        assert!(lead["created_at"].is_string(), "{context}");
        for key in excluded {
            let value = &lead[key];
            assert!(
                value.is_null(),
                "{context}: {key} leaked to the concierge grid: {value}"
            );
        }
        assert_eq!(lead["wizard_state"], json!({}), "{context}");
        assert_eq!(lead["attachments"], json!([]), "{context}");
        assert_eq!(lead["readiness"]["checks"], json!([]), "{context}");
    };

    // The full payload still reaches an editor.
    let (status, full) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(full["primary_concern_text"], "Oncology second opinion");
    assert_eq!(full["insurance_provider"], "Test Versicherung");
    assert_eq!(full["wizard_state"]["quote_total"], "1200.00");

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &concierge,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_projected(&detail, "detail");
    assert_eq!(detail["services"], json!(["driver", "concierge"]));
    assert_eq!(detail["needs_interpreter"], true);

    let (status, list) = json_request(&app, "GET", "/api/v1/leads", &concierge, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let row = list
        .as_array()
        .and_then(|items| items.iter().find(|item| item["id"] == lead_id))
        .cloned()
        .expect("concierge grid lists the lead");
    assert_projected(&row, "list");

    // Searching medical notes must not work for the grid either.
    let (status, hits) = json_request(
        &app,
        "GET",
        "/api/v1/leads?search=Oncology%20second",
        &concierge,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        hits.as_array()
            .is_some_and(|items| items.iter().all(|item| item["id"] != lead_id)),
        "notes text must not be searchable from the service grid"
    );

    // Read-only: every mutation is refused before it is validated.
    for (method, path, body) in [
        (
            "POST",
            "/api/v1/leads".to_string(),
            Some(json!({ "first_name": "No", "last_name": "Way" })),
        ),
        (
            "POST",
            format!("/api/v1/leads/{lead_id}/update"),
            Some(json!({ "notes": "concierge edit" })),
        ),
        (
            "POST",
            format!("/api/v1/leads/{lead_id}/qualify"),
            Some(json!({ "status": "in_progress" })),
        ),
        (
            "POST",
            format!("/api/v1/leads/{lead_id}/prospect"),
            Some(json!({})),
        ),
        (
            "POST",
            format!("/api/v1/leads/{lead_id}/convert"),
            Some(json!({})),
        ),
        (
            "POST",
            format!("/api/v1/leads/{lead_id}/failed-flow"),
            Some(json!({ "resolution": "archive", "reason": "not_our_lead" })),
        ),
    ] {
        let (status, body) = json_request(&app, method, &path, &concierge, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}: {body}");
    }

    // Nothing changed under the concierge's requests.
    let (_, after) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(after["notes"], "internal note about the case");
    assert_eq!(after["qualification_status"], "new");
}

async fn insert_previous_request_patient(
    pool: &PgPool,
    patient_number: String,
    created_by: Uuid,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, lifecycle_status, created_by)
         VALUES ($1, 'Previous', 'Requests', DATE '1980-02-01', 'male', 'active', $2) RETURNING id",
    )
    .bind(patient_number)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn insert_previous_request_lead(
    pool: &PgPool,
    status: &str,
    concern: &str,
    converted_patient: Option<Uuid>,
    repeat_patient: Option<Uuid>,
    created_by: Uuid,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, primary_concern_text, requested_specialties,
                            qualification_status, converted_patient_id, repeat_patient_id,
                            intake_source, created_by)
         VALUES ('Previous', 'Requests', $1, '[\"radiologie\"]'::jsonb, $2, $3, $4, 'staff_wizard', $5)
         RETURNING id",
    )
    .bind(concern)
    .bind(status)
    .bind(converted_patient)
    .bind(repeat_patient)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn previous_requests_list_only_completed_requests_of_the_patient() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let pm_id = app.patient_manager_id;
    let tag = Uuid::new_v4().simple().to_string();
    let patient = insert_previous_request_patient(pool, format!("P-PREV-{tag}"), pm_id).await;
    let other_patient =
        insert_previous_request_patient(pool, format!("P-OTHER-{tag}"), pm_id).await;
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$2)")
        .bind(patient)
        .bind(pm_id)
        .execute(pool)
        .await
        .unwrap();
    let first = insert_previous_request_lead(
        pool,
        "converted",
        "Knee pain after sports injury",
        Some(patient),
        None,
        pm_id,
    )
    .await;
    insert_previous_request_lead(pool, "converted", "   ", Some(patient), None, pm_id).await;
    insert_previous_request_lead(
        pool,
        "archived",
        "Dropped enquiry",
        None,
        Some(patient),
        pm_id,
    )
    .await;
    insert_previous_request_lead(
        pool,
        "converted",
        "Other patient",
        Some(other_patient),
        None,
        pm_id,
    )
    .await;
    let current = insert_previous_request_lead(
        pool,
        "in_progress",
        "Current repeat request",
        None,
        Some(patient),
        pm_id,
    )
    .await;
    sqlx::query(
        "INSERT INTO orders(order_number, patient_id, source_lead_id, phase, status, date_from, date_to, created_by)
         VALUES ($1, $2, $3, 'followup', 'completed', DATE '2026-03-02', DATE '2026-03-06', $4)",
    )
    .bind(format!("A-PREV-{tag}"))
    .bind(patient)
    .bind(first)
    .bind(pm_id)
    .execute(pool)
    .await
    .unwrap();

    let path = format!("/api/v1/patients/{patient}/previous-requests?exclude_lead_id={current}");
    let (status, body) = json_request(
        &app,
        "GET",
        &path,
        &app.auth_header("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = body.as_array().unwrap();
    assert_eq!(rows.len(), 1, "{body}");
    assert_eq!(rows[0]["id"], first.to_string());
    assert_eq!(rows[0]["concern"], "Knee pain after sports injury");
    assert_eq!(rows[0]["specialties"], json!(["radiologie"]));
    assert_eq!(rows[0]["order_number"], format!("A-PREV-{tag}"));
    assert_eq!(rows[0]["date_from"], "2026-03-02");
    assert_eq!(rows[0]["date_to"], "2026-03-06");

    let (status, _) = json_request(&app, "GET", &path, &app.auth_header("interpreter"), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// TASK-A164: the patient's signed data-protection consent counts for a repeat
/// request, also when the patient was not created through the wizard and so
/// never got the `compliance_completed` flag.
#[tokio::test]
async fn repeat_intake_counts_the_patients_signed_consent_as_compliance() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let create = |patient: Uuid| {
        let pm = pm.clone();
        let app = &app;
        async move {
            let (status, created) = json_request(
                app,
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
            assert_eq!(status, StatusCode::CREATED, "{created}");
            let lead = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
            let (status, detail) =
                json_request(app, "GET", &format!("/api/v1/leads/{lead}"), &pm, None).await;
            assert_eq!(status, StatusCode::OK, "{detail}");
            detail
        }
    };

    // No consent on file: compliance is still open.
    let without = seed_repeat_patient(&app, true).await;
    let detail = create(without).await;
    assert!(
        !readiness_check_passed(&detail, "compliance_completed"),
        "{detail}"
    );

    // The consent was signed on the patient card; the wizard flag was never set.
    let with_consent = seed_repeat_patient(&app, true).await;
    sqlx::query(
        r#"UPDATE patients
           SET legal_status = '{"dsgvo_signed": true, "compliance_completed": false}'::jsonb
           WHERE id = $1"#,
    )
    .bind(with_consent)
    .execute(pool)
    .await
    .unwrap();
    let detail = create(with_consent).await;
    assert!(
        readiness_check_passed(&detail, "compliance_completed"),
        "{detail}"
    );
}

/// Every manual lead gets a patient login in the same transaction; only the
/// CEO and patient managers see the one-time password (owner decision
/// 2026-10-03).
#[tokio::test]
async fn manual_lead_gets_a_patient_login() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let sales = app.auth_header("sales");
    let pm = app.auth_header("patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &sales,
        Some(json!({ "first_name": "No", "last_name": "Email" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "A valid email is required");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Anna",
            "last_name": "Portal",
            "email": " Anna.Portal@Example.com "
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let account = &created["portal_account"];
    assert_eq!(account["email"], "anna.portal@example.com", "{created}");
    assert_eq!(account["created"], true);
    let first_password = account["one_time_password"].as_str().unwrap().to_string();
    assert!(!first_password.is_empty());

    let (role, name, is_active, reset_required): (String, String, bool, bool) = sqlx::query_as(
        r#"SELECT u.role, u.name, u.is_active, u.password_reset_required
           FROM leads l JOIN users u ON u.id = l.portal_user_id
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (role.as_str(), name.as_str(), is_active, reset_required),
        // No forced password change: the lead keeps the issued password.
        ("patient", "Anna Portal", true, false)
    );
    let audited: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM audit_log WHERE action = 'create_lead_portal_account' AND entity_id = $1)",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(audited);

    // The list row carries the login state for the expandable row.
    let (status, list) = json_request(&app, "GET", "/api/v1/leads", &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == lead_id.to_string())
        .expect("lead in list");
    assert_eq!(row["portal_account"]["is_active"], true, "{row}");
    assert_eq!(row["portal_account"]["password_change_pending"], false);
    assert!(row["portal_account"]["last_login_at"].is_null());

    // Sales creates leads too, but does not get the password.
    let (status, by_sales) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &sales,
        Some(json!({
            "first_name": "Bert",
            "last_name": "Portal",
            "email": "bert.portal@example.com"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{by_sales}");
    assert!(
        by_sales["portal_account"]["user_id"].is_string(),
        "{by_sales}"
    );
    assert!(
        by_sales["portal_account"]["one_time_password"].is_null(),
        "{by_sales}"
    );
    let sales_lead = by_sales["id"].as_str().unwrap();

    let (status, state) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{sales_lead}/portal-account"),
        &sales,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{state}");
    assert_eq!(state["account"]["email"], "bert.portal@example.com");
    assert_eq!(state["account"]["password_change_pending"], false);
    assert_eq!(state["can_issue_password"], false);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{sales_lead}/portal-account"),
        &sales,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // A patient manager hands over a fresh one-time password.
    let (status, issued) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-account"),
        &pm,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["created"], false);
    let second_password = issued["one_time_password"].as_str().unwrap();
    assert_ne!(second_password, first_password);
    let forced: bool = sqlx::query_scalar(
        "SELECT u.password_reset_required FROM leads l JOIN users u ON u.id = l.portal_user_id WHERE l.id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(!forced, "a new password is not forced to change either");
}

/// Login addresses are unique: a lead may not take the address of any
/// account, and the error names the owner.
#[tokio::test]
async fn lead_email_of_an_existing_account_is_rejected_with_its_owner() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &app.auth_header("patient_manager"),
        Some(json!({
            "first_name": "Taken",
            "last_name": "Address",
            "email": "LEADS-API-SALES@example.com"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "portal_email_taken");
    assert_eq!(body["owner"]["role"], "sales");
    assert_eq!(body["owner"]["name"], "sales leads-api");
    let leads: i64 = sqlx::query_scalar("SELECT count(*) FROM leads WHERE last_name = 'Address'")
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(leads, 0, "nothing is created on a conflict");
}

/// A corrected lead e-mail moves the login with it; an address of another
/// account is refused.
#[tokio::test]
async fn lead_email_change_moves_the_patient_login() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Clara",
            "last_name": "Portal",
            "email": "clara.typo@example.com"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = created["id"].as_str().unwrap();
    let user_id: Uuid = created["portal_account"]["user_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "email": "leads-api-ceo@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["owner"]["role"], "ceo");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "email": "Clara.Portal@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(email, "clara.portal@example.com");
}

/// The login lives as long as the lead: deleting the lead deactivates and
/// anonymises it and revokes its sessions.
#[tokio::test]
async fn deleting_a_lead_disables_its_patient_login() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Dora",
            "last_name": "Portal",
            "email": "dora.portal@example.com"
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
    sqlx::query("INSERT INTO token_families (user_id) VALUES ($1)")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();

    let (status, deleted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{deleted}");

    let (email, name, is_active): (String, String, bool) =
        sqlx::query_as("SELECT email, name, is_active FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!is_active);
    assert!(!email.contains("dora"), "{email}");
    assert_eq!(name, "Deleted lead");
    let open_sessions: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM token_families WHERE user_id = $1 AND NOT is_revoked",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(open_sessions, 0);
    let linked: Option<Uuid> = sqlx::query_scalar("SELECT portal_user_id FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(linked.is_none());

    // The address is free again for a new lead.
    let (status, again) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Dora",
            "last_name": "Portal",
            "email": "dora.portal@example.com"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
}

/// A minor gets no login of their own: the address may be a parent's address
/// that already has an account (owner decision 2026-10-03).
#[tokio::test]
async fn a_minor_lead_gets_no_patient_login() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Kid",
            "last_name": "Portal",
            "date_of_birth": "2016-04-05",
            "email": "leads-api-ceo@example.com"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert!(created["portal_account"].is_null(), "{created}");
    let lead_id = created["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-account"),
        &pm,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // The child's own address is optional then: the parents get their own
    // logins (QA 2026-10-06, B1-a). One that is given must be valid; an adult
    // still needs one.
    for email in [None, Some(""), Some("  ")] {
        let mut lead = json!({
            "first_name": "Kid",
            "last_name": "Without-Mail",
            "date_of_birth": "2016-04-05"
        });
        if let Some(email) = email {
            lead["email"] = json!(email);
        }
        let (status, created) = json_request(&app, "POST", "/api/v1/leads", &pm, Some(lead)).await;
        assert_eq!(status, StatusCode::CREATED, "{email:?}: {created}");
        assert!(created["portal_account"].is_null(), "{created}");
        let lead_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
        let stored: Option<String> = sqlx::query_scalar("SELECT email FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
        assert_eq!(stored, None, "{email:?}");
    }
    for (date_of_birth, email) in [("2016-04-05", "not-an-address"), ("1980-04-05", "")] {
        let (status, body) = json_request(
            &app,
            "POST",
            "/api/v1/leads",
            &pm,
            Some(json!({
                "first_name": "Kid",
                "last_name": "Invalid-Mail",
                "date_of_birth": date_of_birth,
                "email": email
            })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{date_of_birth}: {body}"
        );
        assert_eq!(body["message"], "A valid email is required");
    }
}

/// The wizard saves the whole list of trusted contacts. A list it loaded
/// before the parent entered the second parent in the cabinet must not drop
/// that person.
#[tokio::test]
async fn a_wizard_save_with_an_older_contact_list_keeps_the_representative_from_the_cabinet() {
    let Some(app) = test_app().await else {
        return;
    };
    let pm = app.auth_header("patient_manager");
    let tag = Uuid::new_v4().simple().to_string();
    let mother = Uuid::new_v4();
    let mother_contact = json!({
        "id": mother,
        "name": "Anna Muster",
        "relation": "mother",
        "email": format!("anna.muster.{tag}@example.com")
    });
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Mia",
            "last_name": "Muster",
            "date_of_birth": "2016-04-05",
            "email": format!("mia.muster.{tag}@example.com"),
            "trusted_contacts": [mother_contact.clone()]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = created["id"].as_str().unwrap().to_string();
    let contacts_of = |lead: &Value| {
        lead["trusted_contacts"]
            .as_array()
            .unwrap_or_else(|| panic!("no contacts: {lead}"))
            .iter()
            .map(|contact| {
                (
                    contact["id"].as_str().unwrap_or_default().to_string(),
                    contact["name"].as_str().unwrap_or_default().to_string(),
                )
            })
            .collect::<Vec<_>>()
    };

    // The mother gets the login and names the father in the cabinet.
    let (status, issued) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": mother })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let guardian: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let parent = format!(
        "Bearer {}",
        jwt::issue_access_token(TEST_SECRET, guardian, "patient", Uuid::new_v4()).unwrap()
    );
    let father = Uuid::new_v4();
    let (status, request) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/representatives/{father}"),
        &parent,
        Some(json!({
            "role": "legal_representative",
            "first_name": "Ben",
            "last_name": "Muster",
            "phone": "+49 30 000000"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{request}");

    // The wizard still has the list with the mother alone and saves it — also
    // together with other fields, and also as an empty list.
    for stale in [json!([mother_contact.clone()]), json!([])] {
        let keeps_mother = stale.as_array().is_some_and(|list| !list.is_empty());
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/leads/{lead_id}/update"),
            &pm,
            Some(json!({ "city": "Berlin", "trusted_contacts": stale })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let (status, lead) =
            json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
        assert_eq!(status, StatusCode::OK, "{lead}");
        let contacts = contacts_of(&lead);
        assert!(
            contacts.contains(&(father.to_string(), "Ben Muster".to_string())),
            "the father entered in the cabinet is still a trusted contact: {lead}"
        );
        // The mother has no row: the wizard removes her as before.
        assert_eq!(
            contacts.iter().any(|(id, _)| *id == mother.to_string()),
            keeps_mother,
            "{lead}"
        );
        if !keeps_mother {
            // The kept contact is the first one now, like after any save.
            assert_eq!(lead["trusted_contact_name"], "Ben Muster", "{lead}");
            assert_eq!(lead["trusted_contact_phone"], "+49 30 000000", "{lead}");
        }
    }
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_representatives WHERE lead_id = $1::uuid AND contact_id = $2",
    )
    .bind(&lead_id)
    .bind(father)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(rows, 1);

    // Only staff who work the lead remove what the cabinet entered; then the
    // wizard removes the contact as usual.
    let remove = format!("/api/v1/leads/{lead_id}/representatives/{father}");
    let (status, _) =
        json_request(&app, "DELETE", &remove, &app.auth_header("concierge"), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, removed) = json_request(&app, "DELETE", &remove, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{removed}");
    assert_eq!(
        removed["representation"]["representatives"][0]["has_data"], false,
        "{removed}"
    );
    let (status, gone) = json_request(&app, "DELETE", &remove, &pm, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{gone}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "trusted_contacts": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(lead["trusted_contacts"], json!([]), "{lead}");
}

/// A minor lead (Mia Muster) whose parents Anna and Ben are trusted contacts
/// with the given ids; the mother has a structured address from the cabinet.
/// Qualified and compliant like a lead right before conversion; with
/// `prospect_patient_id` a repeat request of that patient (which, like the
/// repeat intake, carries the patient's e-mail).
async fn seed_minor_lead_with_parents(
    app: &TestApp,
    email: &str,
    anna: Uuid,
    ben: Uuid,
    prospect_patient_id: Option<Uuid>,
) -> Uuid {
    let pool = &app.suite.pool;
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, phone, date_of_birth, legal_sex,
                              country, primary_language, street_address, city, zip_code,
                              qualification_status, compliance_status, intake_source,
                              consent_healthcare, consent_privacy_practices, trusted_contacts,
                              intake_model, prospect_patient_id, created_by)
           VALUES ('Mia', 'Muster', $1, '+49 30 555 0101', DATE '2016-04-05', 'female', 'DE',
                   'de', 'Hauptstr. 1', 'Berlin', '10115', 'qualified', 'signed',
                   'staff_wizard', true, true, $2,
                   CASE WHEN $3::uuid IS NULL THEN 'legacy' ELSE 'patient_first' END, $3, $4)
           RETURNING id"#,
    )
    .bind(email)
    .bind(json!([
        { "id": anna, "name": "Anna Muster", "relation": "mother",
          "email": "anna.muster@example.com", "phone": "+49 30 000000",
          "birth_date": "1985-03-02" },
        { "id": ben, "name": "Ben Muster", "relation": "father",
          "email": "ben.muster@example.com" },
    ]))
    .bind(prospect_patient_id)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO lead_representatives (lead_id, contact_id, role, contact_origin, first_name,
                                             last_name, street, zip, city, country)
           VALUES ($1, $2, 'legal_representative', 'portal', 'Anna', 'Muster', 'Musterweg 1',
                   '10115', 'Berlin', 'DE')"#,
    )
    .bind(lead_id)
    .bind(anna)
    .execute(pool)
    .await
    .unwrap();
    lead_id
}

/// Successful conversion fixtures need complete identity for both parents,
/// including their own upload. These are synthetic metadata-only files, like
/// seed_complete_lead_onboarding; no identity or signature gate is bypassed.
async fn seed_minor_contract_identity(app: &TestApp, lead_id: Uuid) {
    let pool = &app.suite.pool;
    sqlx::query("INSERT INTO lead_gwg_declarations(lead_id,custody) VALUES($1,'joint') ON CONFLICT(lead_id) DO UPDATE SET custody='joint'")
        .bind(lead_id).execute(pool).await.unwrap();
    let contacts: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id=$1")
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap();
    for (index, contact) in contacts.as_array().unwrap().iter().enumerate() {
        let contact_id = Uuid::parse_str(contact["id"].as_str().unwrap()).unwrap();
        let (first, street, birth, phone) = if index == 0 {
            ("Anna", "Musterweg 1", "1985-03-02", "+49 30 000000")
        } else {
            ("Ben", "Vaterweg 2", "1983-04-06", "+49 30 000001")
        };
        sqlx::query(
            "UPDATE leads SET trusted_contacts=(SELECT jsonb_agg(CASE WHEN c->>'id'=$2::text
                 THEN c || jsonb_build_object('birth_date',$3::text,'phone',$4::text) ELSE c END ORDER BY n)
             FROM jsonb_array_elements(trusted_contacts) WITH ORDINALITY entries(c,n)) WHERE id=$1",
        ).bind(lead_id).bind(contact_id).bind(birth).bind(phone).execute(pool).await.unwrap();
        sqlx::query(
            "INSERT INTO lead_representatives(lead_id,contact_id,role,contact_origin,first_name,last_name,
                 birth_place,citizenships,street,zip,city,country,id_document_type,id_document_number,
                 id_issuing_authority,id_issuing_country,id_valid_until)
             VALUES($1,$2,'legal_representative','portal',$3,'Muster','Berlin',ARRAY['DE'],$4,'10115','Berlin','DE',
                 'passport',$5,'Synthetic authority','DE','2099-01-01')
             ON CONFLICT(lead_id,contact_id) DO UPDATE SET birth_place=EXCLUDED.birth_place,
                 citizenships=EXCLUDED.citizenships,street=EXCLUDED.street,zip=EXCLUDED.zip,
                 city=EXCLUDED.city,country=EXCLUDED.country,id_document_type=EXCLUDED.id_document_type,
                 id_document_number=EXCLUDED.id_document_number,id_issuing_authority=EXCLUDED.id_issuing_authority,
                 id_issuing_country=EXCLUDED.id_issuing_country,id_valid_until=EXCLUDED.id_valid_until",
        ).bind(lead_id).bind(contact_id).bind(first).bind(street)
            .bind(format!("SYNTHETIC-{contact_id}")).execute(pool).await.unwrap();
        let document = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO documents(id,lead_id,auto_name,original_filename,art,category,status,
                 visibility,is_medical,mime_type,version_root_document_id,version_number,uploaded_by)
             VALUES($1,$2,'Synthetic parent identity','synthetic-parent.pdf','representative_identity',
                 'identity','active','internal',false,'application/pdf',$1,1,$3)",
        ).bind(document).bind(lead_id).bind(app.patient_manager_id).execute(pool).await.unwrap();
        sqlx::query(
            "INSERT INTO lead_portal_uploads(document_id,lead_id,uploaded_by,access_kind,kind,representative_id)
             VALUES($1,$2,$3,'guardian','representative_identity',$4)",
        ).bind(document).bind(lead_id).bind(app.patient_manager_id).bind(contact_id).execute(pool).await.unwrap();
    }
}

/// The mother declares herself as the payer (as the cabinet does); the
/// mother is recorded as the paying representative, so no
/// Kostenübernahmeerklärung is made (owner decision 2026-10-19).
async fn declare_mother_as_payer_and_sign(app: &TestApp, lead_id: Uuid, order_id: Uuid) {
    seed_minor_contract_identity(app, lead_id).await;
    let pm = app.auth_header("patient_manager");
    let (status, saved) = json_request(
        app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &pm,
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
            "email": "anna.muster@example.com",
            "phone": "+49 30 000000",
            "payer_informed": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    // The mother is the paying representative — the contracting party, not
    // a third party (owner decision 2026-10-19): no Kostenübernahmeerklärung
    // is asked or made for her.
    assert_eq!(
        saved["declaration"]["payer_kind"], "representative",
        "{saved}"
    );
    assert_eq!(
        saved["status"]["cost_assumption"]["required"], false,
        "{saved}"
    );
    let (status, refused) = json_request(
        app,
        "POST",
        "/api/v1/documents/generate",
        &app.auth_header("ceo"),
        Some(json!({
            "template_id": "cost_coverage_declaration",
            "lead_id": lead_id,
            "order_id": order_id,
            "language": "de",
            "status": "active"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["error"], "payer_is_representative", "{refused}");
}

async fn convert_ready_lead(app: &TestApp, lead_id: Uuid) -> Uuid {
    let pm = app.auth_header("patient_manager");
    let (status, lead) =
        json_request(app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert_eq!(lead["readiness"]["conversion_ready"], true, "{lead}");
    let (status, converted) = json_request(
        app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    Uuid::parse_str(converted["patient_id"].as_str().unwrap()).unwrap()
}

type RelationRow = (
    Uuid,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
);

async fn parent_relations(pool: &PgPool, patient_id: Uuid) -> Vec<RelationRow> {
    sqlx::query_as(
        r#"SELECT id, related_name, relation_type, email, address_street, address_zip,
                  address_city, address_country, is_default_payer
           FROM patient_relations WHERE patient_id = $1 ORDER BY related_name"#,
    )
    .bind(patient_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Conversion of a minor whose mother pays: the relation carries her e-mail
/// and the structured address from the cabinet, she is the patient's default
/// payer (audited), and a second conversion into the same patient changes
/// none of it.
#[tokio::test]
async fn converting_a_minor_makes_the_paying_parent_the_default_payer_with_her_address() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let lead_email = format!("mia-{}@example.com", Uuid::new_v4().simple());
    let lead_id = seed_minor_lead_with_parents(&app, &lead_email, anna, ben, None).await;
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    declare_mother_as_payer_and_sign(&app, lead_id, artifacts.order_id).await;
    let patient_id = convert_ready_lead(&app, lead_id).await;

    let relations = parent_relations(pool, patient_id).await;
    assert_eq!(relations.len(), 2, "{relations:?}");
    let (anna_relation, name, relation_type, email, street, zip, city, country, default_payer) =
        relations[0].clone();
    assert_eq!(name, "Anna Muster");
    assert_eq!(relation_type, "mother");
    assert_eq!(email.as_deref(), Some("anna.muster@example.com"));
    assert_eq!(street.as_deref(), Some("Musterweg 1"));
    assert_eq!(zip.as_deref(), Some("10115"));
    assert_eq!(city.as_deref(), Some("Berlin"));
    assert_eq!(country.as_deref(), Some("DE"));
    assert!(default_payer, "the paying parent is the default payer");
    // Her date of birth stays with the relation: the contracting parents'
    // documents name it after the conversion as before (owner 2026-10-19).
    let anna_birth: Option<chrono::NaiveDate> =
        sqlx::query_scalar("SELECT birth_date FROM patient_relations WHERE id = $1")
            .bind(anna_relation)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        anna_birth,
        chrono::NaiveDate::from_ymd_opt(1985, 3, 2),
        "the contact's birth date is the relation's"
    );
    let mut conn = pool.acquire().await.unwrap();
    let representatives = gmed_server::services::contracting_party::load_representatives(
        &mut conn,
        patient_id,
        &[anna_relation],
        gmed_server::app_time::today(),
    )
    .await
    .unwrap();
    assert_eq!(
        representatives[0].birth_date,
        chrono::NaiveDate::from_ymd_opt(1985, 3, 2)
    );
    drop(conn);
    let (_, name, relation_type, email, street, _, _, _, default_payer) = relations[1].clone();
    assert_eq!(name, "Ben Muster");
    assert_eq!(relation_type, "father");
    assert_eq!(email.as_deref(), Some("ben.muster@example.com"));
    assert_eq!(
        street.as_deref(),
        Some("Vaterweg 2"),
        "the father keeps his independently completed address"
    );
    assert!(!default_payer);
    let audits: Vec<Value> = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'set_default_payer_on_conversion'
             AND entity_type = 'patient' AND entity_id = $1"#,
    )
    .bind(patient_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(audits.len(), 1, "{audits:?}");
    assert_eq!(audits[0]["lead_id"], lead_id.to_string());
    assert_eq!(audits[0]["relation_id"], anna_relation.to_string());
    // The lead-stage order keeps the free-text payer the declaration wrote:
    // the mother as contracting party, never as Kostenübernehmer.
    let order_payer: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT payer_contact_name, payer_role FROM orders WHERE id = $1")
            .bind(artifacts.order_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        order_payer,
        (Some("Anna Muster".into()), Some("contracting_party".into()))
    );

    // The patient card: the invoice goes to the mother as contracting party
    // through the default-payer rule; the identification of the converted
    // lead names her on the payer line.
    let (status, summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/payer-summary"),
        &app.auth_header("ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(summary["patient_is_minor"], true, "{summary}");
    assert_eq!(summary["source"]["lead_id"], lead_id.to_string());
    assert_eq!(summary["declaration"]["name"], "Anna Muster");
    assert_eq!(summary["invoice_recipient"]["source"], "default_payer");
    assert_eq!(summary["invoice_recipient"]["role"], "contracting_party");
    assert_eq!(summary["invoice_recipient"]["kind"], "relation");
    assert_eq!(summary["invoice_recipient"]["name"], "Anna Muster");
    assert_eq!(summary["invoice_recipient"]["street"], "Musterweg 1");
    assert_eq!(summary["invoice_recipient"]["missing"], json!([]));
    assert_eq!(
        summary["invoice_recipient"]["payer_patient_relation_id"],
        anna_relation.to_string()
    );
    assert_eq!(
        summary["contracting_party"]["representatives"][0]["is_default_payer"], true,
        "{summary}"
    );
    assert_eq!(
        summary["identification"]["payer"]["same_person_as"],
        format!("representative:{anna}"),
        "{summary}"
    );

    // A second request of the same patient (repeat intake), converted into
    // the same record: no second default payer, no error, the mark as it was.
    let second_lead =
        seed_minor_lead_with_parents(&app, &lead_email, anna, ben, Some(patient_id)).await;
    let artifacts = seed_complete_lead_onboarding(&app, second_lead).await;
    declare_mother_as_payer_and_sign(&app, second_lead, artifacts.order_id).await;
    let same_patient = convert_ready_lead(&app, second_lead).await;
    assert_eq!(same_patient, patient_id);
    let relations = parent_relations(pool, patient_id).await;
    assert_eq!(relations.len(), 2, "{relations:?}");
    assert_eq!(relations[0].0, anna_relation);
    assert!(relations[0].8);
    assert!(!relations[1].8);
    let audits: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE action = 'set_default_payer_on_conversion'
             AND entity_type = 'patient' AND entity_id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);
    let (status, summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/payer-summary"),
        &app.auth_header("ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(
        summary["source"]["lead_id"],
        second_lead.to_string(),
        "{summary}"
    );
    assert_eq!(summary["invoice_recipient"]["source"], "default_payer");
}

/// A repeat intake of a converted minor starts with the parents the patient
/// record knows (contracting parents first), their birth dates, the address
/// of a parent without a record of their own and the custody stated at the
/// conversion; without them the new request had no legal representatives
/// and its documents were refused.
#[tokio::test]
async fn a_minor_patients_repeat_intake_starts_with_the_parents_on_record() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let pm = app.auth_header("patient_manager");
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let lead_email = format!("mia-{}@example.com", Uuid::new_v4().simple());
    let lead_id = seed_minor_lead_with_parents(&app, &lead_email, anna, ben, None).await;
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    declare_mother_as_payer_and_sign(&app, lead_id, artifacts.order_id).await;
    let patient_id = convert_ready_lead(&app, lead_id).await;
    let (custody, contracting): (Option<String>, Vec<Uuid>) =
        sqlx::query_as("SELECT custody, contracting_relation_ids FROM patients WHERE id=$1")
            .bind(patient_id)
            .fetch_one(pool)
            .await
            .unwrap();
    let relations = parent_relations(pool, patient_id).await;
    let anna_relation = relations[0].0;

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Mia",
            "last_name": "Muster",
            "repeat_patient_id": patient_id,
            "creation_key": Uuid::new_v4(),
        })),
    )
    .await;
    assert!(status.is_success(), "{created}");
    let repeat = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    let contacts: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id=$1")
        .bind(repeat)
        .fetch_one(pool)
        .await
        .unwrap();
    let contacts = contacts.as_array().unwrap();
    assert_eq!(contacts.len(), 2, "{contacts:?}");
    let first = Uuid::parse_str(contacts[0]["id"].as_str().unwrap()).unwrap();
    if let Some(rep1) = contracting.first() {
        assert_eq!(first, *rep1, "the contracting parents come first");
    }
    let anna_contact = contacts
        .iter()
        .find(|contact| contact["id"] == anna_relation.to_string())
        .expect("the mother's relation is a contact of the new request");
    assert_eq!(anna_contact["name"], "Anna Muster");
    assert_eq!(anna_contact["relation"], "mother");
    assert_eq!(anna_contact["email"], "anna.muster@example.com");
    assert_eq!(anna_contact["birth_date"], "1985-03-02");
    let row: (String, Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT role, first_name, last_name, street FROM lead_representatives WHERE lead_id=$1 AND contact_id=$2",
    )
    .bind(repeat)
    .bind(anna_relation)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        row,
        (
            "legal_representative".to_string(),
            Some("Anna".into()),
            Some("Muster".into()),
            Some("Musterweg 1".into())
        )
    );
    let repeat_custody: Option<String> =
        sqlx::query_scalar("SELECT custody FROM lead_gwg_declarations WHERE lead_id=$1")
            .bind(repeat)
            .fetch_optional(pool)
            .await
            .unwrap()
            .flatten();
    assert_eq!(repeat_custody, custody);
}

/// Owner decision 2026-10-19: the parent(s) with custody are the minor's
/// contracting party. Conversion stores the custody and their relations on
/// the patient, so a parent without custody is no Auftraggeber; trusted
/// contacts are no emergency contacts by themselves; the paying parent is
/// the default payer also when linked to a patient record of her own. The
/// father, who never had a login on the child's request, is linked to the
/// child when his own request is converted (same e-mail, his patronymic on
/// one side only, the same birth date).
#[tokio::test]
async fn converting_a_minor_stores_the_custodial_parents_as_contracting_party() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let lead_email = format!("mia-{}@example.com", Uuid::new_v4().simple());
    let lead_id = seed_minor_lead_with_parents(&app, &lead_email, anna, ben, None).await;
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    declare_mother_as_payer_and_sign(&app, lead_id, artifacts.order_id).await;
    // The mother is a patient herself; the contact points to her record.
    let anna_patient: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,email,created_by)
           VALUES($1,'Anna','Muster',DATE '1985-03-02','female','anna.muster@example.com',$2)
           RETURNING id"#,
    )
    .bind(format!("P-{}", Uuid::new_v4()))
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE leads SET trusted_contacts=(SELECT jsonb_agg(CASE WHEN c->>'id'=$2::text
             THEN c || jsonb_build_object('related_patient_id',$3::uuid) ELSE c END ORDER BY n)
         FROM jsonb_array_elements(trusted_contacts) WITH ORDINALITY entries(c,n)) WHERE id=$1",
    )
    .bind(lead_id)
    .bind(anna)
    .bind(anna_patient)
    .execute(pool)
    .await
    .unwrap();
    // The mother alone has custody: the father stays a relation only.
    sqlx::query("UPDATE lead_gwg_declarations SET custody='sole_parent' WHERE lead_id=$1")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();
    let child = convert_ready_lead(&app, lead_id).await;

    let relations: Vec<(Uuid, String, Option<Uuid>, bool, bool)> = sqlx::query_as(
        r#"SELECT id, related_name, related_patient_id, is_default_payer, is_emergency_contact
           FROM patient_relations WHERE patient_id = $1 ORDER BY related_name"#,
    )
    .bind(child)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(relations.len(), 2, "{relations:?}");
    let (anna_relation, name, linked, default_payer, emergency) = relations[0].clone();
    assert_eq!(name, "Anna Muster");
    assert_eq!(linked, Some(anna_patient));
    assert!(
        default_payer,
        "the paying parent with a patient record is the default payer"
    );
    assert!(!emergency);
    let (ben_relation, name, _, default_payer, emergency) = relations[1].clone();
    assert_eq!(name, "Ben Muster");
    assert!(!default_payer);
    assert!(!emergency);
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action='set_default_payer_on_conversion' AND entity_id=$1",
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);

    let (custody, contracting): (Option<String>, Vec<Uuid>) =
        sqlx::query_as("SELECT custody, contracting_relation_ids FROM patients WHERE id=$1")
            .bind(child)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(custody.as_deref(), Some("sole_parent"));
    assert_eq!(contracting, vec![anna_relation]);
    let audit: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action='set_contracting_party_on_conversion' AND entity_id=$1",
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audit["lead_id"], lead_id.to_string());
    assert_eq!(audit["custody"], "sole_parent");
    let mut conn = pool.acquire().await.unwrap();
    let representatives = gmed_server::services::contracting_party::load_representatives(
        &mut conn,
        child,
        &[],
        gmed_server::app_time::today(),
    )
    .await
    .unwrap();
    assert_eq!(
        representatives
            .iter()
            .map(|person| person.relation_id)
            .collect::<Vec<_>>(),
        vec![anna_relation],
        "the father without custody is no contracting party"
    );
    // An explicit choice on an order or contract still names whom it names.
    let named = gmed_server::services::contracting_party::load_representatives(
        &mut conn,
        child,
        &[ben_relation],
        gmed_server::app_time::today(),
    )
    .await
    .unwrap();
    assert_eq!(named.len(), 1);
    assert_eq!(named[0].relation_id, ben_relation);
    drop(conn);

    // The father's own request, converted later: his record is linked to
    // the child's relation by itself.
    let father_lead: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, street_address, city, zip_code,
                primary_concern_text, requested_specialties,
                qualification_status, compliance_status,
                consent_healthcare, consent_privacy_practices,
                intake_source, intake_model, created_by
           ) VALUES (
                'Ben Petrovych', 'Muster', 'ben.muster@example.com', '+4915112345670', 'DE', 'de',
                DATE '1983-04-06', 'male', 'Vaterweg 2', 'Berlin', '10115',
                'Chronic knee pain', '["orthopedics"]'::jsonb,
                'qualified', 'signed', true, true,
                'staff_wizard', 'patient_first', $1
           ) RETURNING id"#,
    )
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let (ben_patient, _) = wizard_prospect(&app, father_lead).await;
    seed_complete_lead_onboarding(&app, father_lead).await;
    wizard_convert(&app, father_lead).await;
    let linked: Option<Uuid> =
        sqlx::query_scalar("SELECT related_patient_id FROM patient_relations WHERE id=$1")
            .bind(ben_relation)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(linked, Some(ben_patient));
    let contacts: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id=$1")
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap();
    let ben_contact = contacts
        .as_array()
        .unwrap()
        .iter()
        .find(|contact| contact["id"] == ben.to_string())
        .unwrap();
    assert_eq!(ben_contact["related_patient_id"], ben_patient.to_string());
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action='link_parent_relation_by_email' AND entity_id=$1",
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);
    // The mother's relation, linked before, is untouched.
    let anna_linked: Option<Uuid> =
        sqlx::query_scalar("SELECT related_patient_id FROM patient_relations WHERE id=$1")
            .bind(anna_relation)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(anna_linked, Some(anna_patient));
}

#[tokio::test]
async fn minor_conversion_explicitly_links_both_guardians_and_never_the_child_login() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let lead = seed_minor_lead_with_parents(&app, "anna.muster@example.com", anna, ben, None).await;
    let child = seed_user(pool, "converted-child", "patient").await;
    sqlx::query("UPDATE leads SET portal_user_id=$2 WHERE id=$1")
        .bind(lead)
        .bind(child)
        .execute(pool)
        .await
        .unwrap();
    let mut parents = Vec::new();
    for (contact, email, name) in [
        (anna, "anna.muster@example.com", "Anna Muster"),
        (ben, "ben.muster@example.com", "Ben Muster"),
    ] {
        let user: Uuid=sqlx::query_scalar("INSERT INTO users(email,password_hash,name,role) VALUES($1,'synthetic',$2,'patient') RETURNING id")
            .bind(email).bind(name).fetch_one(pool).await.unwrap();
        sqlx::query("INSERT INTO lead_portal_access(lead_id,user_id,kind,trusted_contact_id,created_by) VALUES($1,$2,'guardian',$3,$4)")
            .bind(lead).bind(user).bind(contact).bind(app.patient_manager_id).execute(pool).await.unwrap();
        parents.push(user);
    }
    let artifacts = seed_complete_lead_onboarding(&app, lead).await;
    declare_mother_as_payer_and_sign(&app, lead, artifacts.order_id).await;
    let patient = convert_ready_lead(&app, lead).await;
    let roles: Vec<String> = sqlx::query_scalar(
        "SELECT relation_type FROM patient_relations WHERE patient_id=$1 ORDER BY relation_type",
    )
    .bind(patient)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(
        roles,
        vec!["father", "mother"],
        "Conversion must preserve each parent's explicit role"
    );
    for user in &parents {
        let assignments: i64=sqlx::query_scalar("SELECT count(*) FROM patient_assignments WHERE patient_id=$1 AND user_id=$2 AND revoked_at IS NULL AND source='lead_guardian'")
            .bind(patient).bind(user).fetch_one(pool).await.unwrap();
        assert_eq!(assignments, 1);
        let token = format!(
            "Bearer {}",
            jwt::issue_access_token(TEST_SECRET, *user, "patient", Uuid::new_v4()).unwrap()
        );
        let (status, me) = json_request(&app, "GET", "/api/v1/me/export", &token, None).await;
        assert_eq!(status, StatusCode::OK, "{me}");
        assert_eq!(me["patient"]["id"], json!(patient), "{me}");
        let (status, refused) = json_request(
            &app,
            "POST",
            &format!("/api/v1/me/lead-requests/{lead}/personal-data"),
            &token,
            Some(json!({"city":"Closed lead"})),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{refused}");
    }
    let child_links: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_assignments WHERE user_id=$1")
            .bind(child)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(child_links, 0);
    // A matching email must not implicitly grant access to a historical child login.
    sqlx::query("UPDATE patients SET email=(SELECT email FROM users WHERE id=$2) WHERE id=$1")
        .bind(patient)
        .bind(child)
        .execute(pool)
        .await
        .unwrap();
    let token = format!(
        "Bearer {}",
        jwt::issue_access_token(TEST_SECRET, child, "patient", Uuid::new_v4()).unwrap()
    );
    let (status, refused) = json_request(&app, "GET", "/api/v1/me/export", &token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{refused}");
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_portal_access WHERE lead_id=$1 AND revoked_at IS NULL",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        active, 2,
        "guardian history and intentional access retained"
    );
    let contexts: Vec<Value>=sqlx::query_scalar("SELECT context FROM audit_log WHERE action='link_lead_guardian_to_patient' AND entity_id=$1").bind(patient).fetch_all(pool).await.unwrap();
    assert_eq!(contexts.len(), 2);
    assert!(
        contexts
            .iter()
            .all(|c| c["reason"] == "guardian_of_converted_minor")
    );
}

#[tokio::test]
async fn converting_a_child_preserves_the_mothers_own_patient_and_links_the_same_person() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let lead = seed_minor_lead_with_parents(&app, "anna.muster@example.com", anna, ben, None).await;
    let mother: Uuid = sqlx::query_scalar("INSERT INTO users(email,password_hash,name,role) VALUES('anna.muster@example.com','parent-password-preserved','Anna Muster','patient') RETURNING id")
        .fetch_one(pool).await.unwrap();
    let own_patient: Uuid = sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,email,created_by) VALUES($1,'Anna','Muster','1985-03-02','female','anna.muster@example.com',$2) RETURNING id")
        .bind(format!("P-PARENT-{}",Uuid::new_v4())).bind(app.patient_manager_id).fetch_one(pool).await.unwrap();
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)")
        .bind(own_patient)
        .bind(mother)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO lead_portal_access(lead_id,user_id,kind,trusted_contact_id,created_by) VALUES($1,$2,'guardian',$3,$4)")
        .bind(lead).bind(mother).bind(anna).bind(app.patient_manager_id).execute(pool).await.unwrap();
    let child_login = seed_user(pool, "existing-child-login", "patient").await;
    sqlx::query("UPDATE leads SET portal_user_id=$2 WHERE id=$1")
        .bind(lead)
        .bind(child_login)
        .execute(pool)
        .await
        .unwrap();
    let session: Uuid =
        sqlx::query_scalar("INSERT INTO token_families(user_id) VALUES($1) RETURNING id")
            .bind(mother)
            .fetch_one(pool)
            .await
            .unwrap();
    let artifacts = seed_complete_lead_onboarding(&app, lead).await;
    declare_mother_as_payer_and_sign(&app, lead, artifacts.order_id).await;
    let child_patient = convert_ready_lead(&app, lead).await;
    let links: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT patient_id,source FROM patient_assignments WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(mother)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(
        links.contains(&(own_patient, "manual".to_string())),
        "{links:?}"
    );
    assert!(
        links.contains(&(child_patient, "lead_guardian".to_string())),
        "{links:?}"
    );
    let related: Uuid=sqlx::query_scalar("SELECT related_patient_id FROM patient_relations WHERE patient_id=$1 AND related_name='Anna Muster' AND relation_type='mother'")
        .bind(child_patient).fetch_one(pool).await.unwrap();
    assert_eq!(related, own_patient);
    let password: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(mother)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(password, "parent-password-preserved");
    let revoked: bool = sqlx::query_scalar("SELECT is_revoked FROM token_families WHERE id=$1")
        .bind(session)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!revoked);
    let child_links: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_assignments WHERE user_id=$1")
            .bind(child_login)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(child_links, 0);
}

#[tokio::test]
async fn two_children_keep_the_shared_guardian_portal_working() {
    let Some(app) = test_app().await else { return };
    let pm = app.auth_header("patient_manager");
    let mut children = Vec::new();
    let mut guardian = None;
    for index in 0..2 {
        let mother = Uuid::new_v4();
        let lead = seed_minor_lead_with_parents(
            &app,
            &format!("review-child-{index}@example.com"),
            mother,
            Uuid::new_v4(),
            None,
        )
        .await;
        let (status, issued) = json_request(
            &app,
            "POST",
            &format!("/api/v1/leads/{lead}/portal-guardians"),
            &pm,
            Some(json!({"trusted_contact_id": mother})),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{issued}");
        let user: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
        if let Some(previous) = guardian {
            assert_eq!(previous, user);
        }
        guardian = Some(user);
        let artifacts = seed_complete_lead_onboarding(&app, lead).await;
        declare_mother_as_payer_and_sign(&app, lead, artifacts.order_id).await;
        children.push(lead);
    }
    let guardian = guardian.unwrap();
    let token = format!(
        "Bearer {}",
        jwt::issue_access_token(TEST_SECRET, guardian, "patient", Uuid::new_v4()).unwrap()
    );
    let first = convert_ready_lead(&app, children[0]).await;
    let (before_status, before) =
        json_request(&app, "GET", "/api/v1/me/account-statement", &token, None).await;
    assert_eq!(before_status, StatusCode::OK, "{before}");
    let second = convert_ready_lead(&app, children[1]).await;
    assert_ne!(first, second);
    let (status, me) = json_request(&app, "GET", "/api/v1/me", &token, None).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    let patients = me["patients"].as_array().unwrap();
    assert_eq!(patients.len(), 2);
    for patient in [first, second] {
        assert!(
            patients
                .iter()
                .any(|entry| entry["id"] == patient.to_string())
        );
    }
    let (status, ambiguous) = json_request(&app, "GET", "/api/v1/me/export", &token, None).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "An explicit choice is required: {ambiguous}"
    );

    async fn selected_request(
        app: &TestApp,
        token: &str,
        patient: &str,
        path: &str,
    ) -> (StatusCode, Value) {
        let response = app
            .router()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("Authorization", token)
                    .header("X-Patient-Id", patient)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    for patient in [first, second] {
        support::seed_active_portal_subscription(&app.suite.pool, patient, app.ceo_id).await;
    }
    for patient in [first, second, first] {
        let selected = patient.to_string();
        let (status, exported) =
            selected_request(&app, &token, &selected, "/api/v1/me/export").await;
        assert_eq!(status, StatusCode::OK, "{exported}");
        assert_eq!(exported["patient"]["id"], json!(patient));
        for path in [
            "/api/v1/me/account-statement",
            "/api/v1/me/documents",
            "/api/v1/me/invoices",
            "/api/v1/me/appointments",
        ] {
            let (status, body) = selected_request(&app, &token, &selected, path).await;
            assert_eq!(status, StatusCode::OK, "{path}: {body}");
        }
    }
    let (status, foreign) = selected_request(
        &app,
        &token,
        &Uuid::new_v4().to_string(),
        "/api/v1/me/export",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{foreign}");
    let (status, invalid) = selected_request(&app, &token, "invalid", "/api/v1/me/export").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{invalid}");

    sqlx::query(
        "UPDATE patient_assignments SET revoked_at=now() WHERE user_id=$1 AND patient_id=$2",
    )
    .bind(guardian)
    .bind(first)
    .execute(&app.suite.pool)
    .await
    .unwrap();
    let (status, revoked) =
        selected_request(&app, &token, &first.to_string(), "/api/v1/me/export").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{revoked}");
    let (status, retained) =
        selected_request(&app, &token, &second.to_string(), "/api/v1/me/export").await;
    assert_eq!(status, StatusCode::OK, "{retained}");
    assert_eq!(retained["patient"]["id"], json!(second));
    let (status, me) = json_request(&app, "GET", "/api/v1/me", &token, None).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["patients"].as_array().unwrap().len(), 1);
    assert_eq!(me["patients"][0]["id"], json!(second));
}

#[tokio::test]
async fn guardian_candidates_include_adult_leads_without_creating_patients_or_access() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let mut adult = Uuid::nil();
    for (name, birth, status) in [
        ("Mother", "1985-05-01", "new"),
        ("Child", "2020-05-01", "new"),
        ("Archived", "1985-05-01", "archived"),
    ] {
        let id: Uuid = sqlx::query_scalar("INSERT INTO leads(first_name,last_name,email,date_of_birth,qualification_status,street_address,zip_code,city,country,created_by) VALUES($1,$2,$3,$4::text::date,$5,'Testweg 1','10115','Berlin','DE',$6) RETURNING id")
            .bind(name).bind(&tag).bind(format!("{name}-{tag}@example.test"))
            .bind(birth).bind(status).bind(app.patient_manager_id).fetch_one(pool).await.unwrap();
        if name == "Mother" {
            adult = id;
        }
    }
    let patient: Uuid = sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,created_by) VALUES($1,'Father',$2,'1980-01-01','male',$3) RETURNING id")
        .bind(format!("P-{tag}")).bind(&tag).bind(app.patient_manager_id).fetch_one(pool).await.unwrap();
    let path = format!("/api/v1/leads/guardian-candidates?search={tag}");
    let (status, found) = json_request(
        &app,
        "GET",
        &path,
        &app.auth_header("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{found}");
    let items = found.as_array().unwrap();
    assert_eq!(items.len(), 2, "Only active adults are candidates: {found}");
    let mother = items.iter().find(|row| row["id"] == json!(adult)).unwrap();
    assert_eq!(mother["source"], "lead");
    assert!(mother["patient_record_id"].is_null());
    assert_eq!(mother["email"], format!("Mother-{tag}@example.test"));
    assert_eq!(mother["address"], "Testweg 1, 10115, Berlin, DE");
    assert!(
        items
            .iter()
            .any(|row| row["patient_record_id"] == json!(patient))
    );
    let (status, excluded) = json_request(
        &app,
        "GET",
        &format!("{path}&exclude_lead_id={adult}"),
        &app.auth_header("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{excluded}");
    assert_eq!(excluded.as_array().unwrap().len(), 1);
    let (status, _) = json_request(&app, "GET", &path, &app.auth_header("billing"), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let links: i64 = sqlx::query_scalar("SELECT count(*) FROM lead_portal_access WHERE lead_id=$1")
        .bind(adult)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(links, 0, "Looking up a parent must never grant access");
}

/// Owner decision 2026-10-19: minors converted before the conversion stored
/// the contracting party get it from the backfill — custody and rep1/rep2
/// relations from the converted lead, audited; a second run changes nothing
/// and nothing stored is ever overwritten.
#[tokio::test]
async fn backfill_stores_the_contracting_party_of_an_old_converted_minor_once() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let lead_email = format!("mia-{}@example.com", Uuid::new_v4().simple());
    let lead_id = seed_minor_lead_with_parents(&app, &lead_email, anna, ben, None).await;
    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    declare_mother_as_payer_and_sign(&app, lead_id, artifacts.order_id).await;
    let child = convert_ready_lead(&app, lead_id).await;
    let expected: Vec<Uuid> =
        sqlx::query_scalar("SELECT contracting_relation_ids FROM patients WHERE id=$1")
            .bind(child)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(expected.len(), 2, "joint custody: both parents");
    // As converted before 2026-10-19: nothing stored on the patient.
    sqlx::query("UPDATE patients SET contracting_relation_ids='{}', custody=NULL WHERE id=$1")
        .bind(child)
        .execute(pool)
        .await
        .unwrap();

    let report = gmed_server::services::contracting_party_backfill::run(pool)
        .await
        .unwrap();
    assert_eq!(report.stored, 1, "{report:?}");
    assert_eq!(report.unresolved, 0, "{report:?}");
    let (custody, stored): (Option<String>, Vec<Uuid>) =
        sqlx::query_as("SELECT custody, contracting_relation_ids FROM patients WHERE id=$1")
            .bind(child)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(custody.as_deref(), Some("joint"));
    assert_eq!(stored, expected, "rep1 first, then rep2");
    let audit: Vec<Value> = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action='backfill_contracting_party' AND entity_id=$1",
    )
    .bind(child)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0]["lead_id"], lead_id.to_string());
    assert_eq!(audit[0]["custody"], "joint");

    // A second run changes nothing.
    let again = gmed_server::services::contracting_party_backfill::run(pool)
        .await
        .unwrap();
    assert_eq!(again.stored, 0, "{again:?}");
    let unchanged: Vec<Uuid> =
        sqlx::query_scalar("SELECT contracting_relation_ids FROM patients WHERE id=$1")
            .bind(child)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(unchanged, expected);
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action='backfill_contracting_party' AND entity_id=$1",
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);

    // An ambiguous mapping (two relations named like the father) is skipped
    // and keeps the fallback.
    sqlx::query("UPDATE patients SET contracting_relation_ids='{}', custody=NULL WHERE id=$1")
        .bind(child)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO patient_relations(patient_id,related_name,relation_type) VALUES($1,'Ben Muster','parent')",
    )
    .bind(child)
    .execute(pool)
    .await
    .unwrap();
    let skipped = gmed_server::services::contracting_party_backfill::run(pool)
        .await
        .unwrap();
    assert_eq!((skipped.stored, skipped.unresolved), (0, 1), "{skipped:?}");
    let (custody, stored): (Option<String>, Vec<Uuid>) =
        sqlx::query_as("SELECT custody, contracting_relation_ids FROM patients WHERE id=$1")
            .bind(child)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!((custody, stored), (None, Vec::new()));
}
