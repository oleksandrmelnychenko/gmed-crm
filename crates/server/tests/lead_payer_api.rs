//! Integration tests for the payer declaration of a lead ("Кто платит"),
//! several citizenships per person and the agency signature gate.
//! Synthetic data only.

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
    users: Vec<(&'static str, Uuid)>,
}

impl TestApp {
    fn bearer(&self, role: &str) -> String {
        let (_, user_id) = self
            .users
            .iter()
            .find(|(name, _)| *name == role)
            .unwrap_or_else(|| panic!("unexpected test role: {role}"));
        let token = jwt::issue_access_token(TEST_SECRET, *user_id, role, Uuid::new_v4()).unwrap();
        format!("Bearer {token}")
    }

    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }
}

async fn test_app() -> Option<TestApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let mut users = Vec::new();
    for role in ["sales", "patient_manager", "ceo", "concierge", "billing"] {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
        )
        .bind(format!("payer-{role}-{}@example.com", Uuid::new_v4().simple()))
        .bind(format!("{role} payer test"))
        .bind(role)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
        users.push((role, id));
    }
    Some(TestApp { suite, users })
}

async fn json_request(
    app: &TestApp,
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
    let response = app.suite.app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn seed_lead(pool: &PgPool) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, phone, date_of_birth, legal_sex,
                              street_address, city, zip_code, country, qualification_status,
                              compliance_status, intake_source)
           VALUES ('Mira', 'Beispiel', $1, '+4915100000000', DATE '1985-02-03', 'female',
                   'Teststr. 5', 'Berlin', '10115', 'DE', 'qualified', 'signed', 'staff_wizard')
           RETURNING id"#,
    )
    .bind(format!(
        "payer-lead-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A lead's framework contract (sent) and its order, both still unsigned.
async fn seed_lead_order(app: &TestApp, lead_id: Uuid) -> (Uuid, Uuid) {
    let pool = app.pool();
    let tag = Uuid::new_v4().simple().to_string();
    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (lead_id, contract_number, status, created_by)
           VALUES ($1, $2, 'sent', $3) RETURNING id"#,
    )
    .bind(lead_id)
    .bind(format!("FC-PAYER-{tag}"))
    .bind(app.suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, contract_id, source_lead_id, total_estimated, created_by)
           VALUES ($1, $2, $3, 119, $4) RETURNING id"#,
    )
    .bind(format!("A-PAYER-{tag}"))
    .bind(contract_id)
    .bind(lead_id)
    .bind(app.suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (contract_id, order_id)
}

fn third_party_payer() -> Value {
    json!({
        "payer_kind": "third_party",
        "acts_on_own_account": true,
        "source_of_funds": "business_income",
        "first_name": "Erika",
        "last_name": "Zahler",
        "date_of_birth": "1970-05-01",
        "street": "Ringstr. 9",
        "zip": "1010",
        "city": "Wien",
        "country": "at",
        "citizenships": ["AT", "de"],
        "relationship": "Tante",
        "email": "erika.zahler@example.org",
        "payer_informed": true
    })
}

fn has_reason(lead: &Value, reason: &str) -> bool {
    lead["readiness"]["blocking_reasons"]
        .as_array()
        .is_some_and(|reasons| reasons.iter().any(|value| value == reason))
}

#[tokio::test]
async fn payer_declaration_access_validation_and_audit() {
    let Some(app) = test_app().await else { return };
    let lead_id = seed_lead(app.pool()).await;
    let path = format!("/api/v1/leads/{lead_id}/payer-declaration");

    for role in ["concierge", "billing"] {
        let (status, _) = json_request(&app, "GET", &path, &app.bearer(role), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} must not read");
    }
    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &app.bearer("concierge"),
        Some(json!({"payer_kind": "self"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let sales = app.bearer("sales");
    let (status, empty) = json_request(&app, "GET", &path, &sales, None).await;
    assert_eq!(status, StatusCode::OK, "{empty}");
    assert!(empty["declaration"].is_null());
    assert_eq!(
        empty["status"]["missing"],
        json!(["payer_declaration_missing"])
    );
    let (_, lead) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &sales,
        None,
    )
    .await;
    assert!(has_reason(&lead, "Payer declaration is missing"), "{lead}");

    for (body, code) in [
        (json!({"payer_kind": "someone"}), "payer_kind_invalid"),
        (
            json!({"payer_kind": "self", "source_of_funds": "lottery"}),
            "source_of_funds_invalid",
        ),
        (
            json!({"payer_kind": "third_party", "country": "Austria"}),
            "payer_country_invalid",
        ),
        (
            json!({"payer_kind": "third_party", "citizenships": ["XX"]}),
            "payer_citizenships_invalid",
        ),
    ] {
        let (status, error) = json_request(&app, "POST", &path, &sales, Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["error"], code);
    }

    // An incomplete third-party payer may be saved; the status says what is missing.
    let (status, saved) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(json!({"payer_kind": "third_party", "first_name": "Erika", "source_of_funds": "savings"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["status"]["missing"],
        json!([
            "payer_identity_incomplete",
            "payer_not_informed",
            "cost_assumption_missing"
        ])
    );

    // Not on own account: the beneficial owner must be named.
    let (status, saved) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(
            json!({"payer_kind": "self", "acts_on_own_account": false, "source_of_funds": "other",
                    "source_of_funds_description": "Stipendium"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["status"]["missing"],
        json!(["payer_beneficial_owner_missing"])
    );
    assert!(
        saved["declaration"]["first_name"].is_null(),
        "third-party data dropped"
    );

    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'update_lead_payer_declaration' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(
        audited, 2,
        "every saved change is audited in its transaction"
    );
}

#[tokio::test]
async fn third_party_payer_pays_the_order_and_gmed_signs_last() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let (contract_id, order_id) = seed_lead_order(&app, lead_id).await;
    let pm = app.bearer("patient_manager");
    let path = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let commercial = format!("/api/v1/orders/{order_id}/commercial-basis");

    let (status, saved) = json_request(&app, "POST", &path, &pm, Some(third_party_payer())).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["declaration"]["country"], "AT");
    assert_eq!(saved["declaration"]["citizenships"], json!(["AT", "DE"]));
    assert!(saved["declaration"]["payer_informed_at"].is_string());
    assert_eq!(
        saved["status"]["missing"],
        json!(["cost_assumption_missing"])
    );

    // The third party became the payer of the lead's order (existing payer model).
    let payer: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT payer_contact_name, payer_role, payer_address_country FROM orders WHERE id = $1",
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        payer,
        (
            Some("Erika Zahler".into()),
            Some("cost_bearer".into()),
            Some("AT".into())
        )
    );

    // GMED may not confirm before the client and the payer.
    let (status, blocked) = json_request(
        &app,
        "POST",
        &commercial,
        &pm,
        Some(json!({"signed_agency": true})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{blocked}");
    assert_eq!(blocked["error"], "payer_gate_blocked");
    assert_eq!(
        blocked["reasons"],
        json!(["client_order_signature_missing", "cost_assumption_missing"])
    );
    let (status, signed) = json_request(
        &app,
        "POST",
        &commercial,
        &pm,
        Some(json!({"signed_patient": true})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/status"),
        &pm,
        Some(json!({"status": "signed"})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "contract waits for the payer too"
    );

    // The Kostenübernahmeerklärung of the lead names the order and the payer.
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &app.bearer("ceo"),
        Some(json!({
            "template_id": "cost_coverage_declaration",
            "lead_id": lead_id,
            "order_id": order_id,
            "language": "de",
            "status": "active"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    let document_id = Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap();
    let marker: Option<String> = sqlx::query_scalar(
        "SELECT generated_bindings ->> '_payer_identity_version' FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(marker.is_some(), "the document records the payer it names");
    // The e-signature composer suggests the declared payer as `payer` signer.
    let (status, candidates) = json_request(
        &app,
        "GET",
        &format!("/api/v1/signature-packages/candidates?document_id={document_id}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{candidates}");
    assert!(
        candidates["suggested_signers"]
            .as_array()
            .unwrap()
            .iter()
            .any(
                |signer| signer["role"] == "payer" && signer["email"] == "erika.zahler@example.org"
            ),
        "{candidates}"
    );

    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert!(
        has_reason(&lead, "Cost assumption declaration is not signed"),
        "{lead}"
    );
    let (status, blocked) = json_request(
        &app,
        "POST",
        &commercial,
        &pm,
        Some(json!({"signed_agency": true})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{blocked}");
    assert_eq!(blocked["reasons"], json!(["cost_assumption_unsigned"]));

    let (status, marked) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/mark-signed"),
        &pm,
        Some(json!({"compliance_kind": "cost_coverage_declaration"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{marked}");

    let (status, confirmed) = json_request(
        &app,
        "POST",
        &commercial,
        &pm,
        Some(json!({"signed_agency": true})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["signed_agency"], true);
    let (status, contract) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/status"),
        &pm,
        Some(json!({"status": "signed"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{contract}");

    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert!(!has_reason(&lead, "Payer declaration is missing"), "{lead}");
    assert!(
        !has_reason(&lead, "Cost assumption declaration is not signed"),
        "{lead}"
    );

    // Another payer: the signed declaration names someone else now.
    let mut other = third_party_payer();
    other["last_name"] = json!("Anders");
    let (status, changed) = json_request(&app, "POST", &path, &pm, Some(other)).await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(
        changed["status"]["missing"],
        json!(["cost_assumption_outdated"])
    );

    // The patient pays after all: the cost bearer is removed from the order.
    let (status, own) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({"payer_kind": "self", "source_of_funds": "employment"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{own}");
    assert_eq!(own["status"]["complete"], true);
    let role: Option<String> = sqlx::query_scalar("SELECT payer_role FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(role.is_none());
    let payer_audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'set_order_payer' AND entity_id = $1
           AND context->>'source' = 'lead_payer_declaration'",
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(payer_audits, 3);
}

#[tokio::test]
async fn payer_and_citizenship_countries_count_for_the_aml_risk() {
    let Some(app) = test_app().await else { return };
    let lead_id = seed_lead(app.pool()).await;
    let pm = app.bearer("patient_manager");
    let edd_passed = |lead: &Value| {
        lead["readiness"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "enhanced_due_diligence_document_generated")
            .map(|check| check["passed"] == true)
            .unwrap()
    };
    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert!(edd_passed(&lead), "{lead}");

    // A second citizenship in a high-risk country requires enhanced due diligence.
    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({"citizenships": ["de", "IR"]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(lead["citizenships"], json!(["DE", "IR"]));
    assert_eq!(lead["wizard_state"]["registration_country"], "DE");
    assert!(!edd_passed(&lead), "{lead}");

    // Back to a low-risk citizenship, but the third-party payer lives in Iran.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({"citizenships": ["DE"]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert!(edd_passed(&lead), "{lead}");
    let mut payer = third_party_payer();
    payer["country"] = json!("IR");
    let (status, saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &pm,
        Some(payer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["status"]["aml_countries"], json!(["DE", "IR", "AT"]));
    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert!(!edd_passed(&lead), "{lead}");

    let (status, error) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({"citizenships": ["Germany"]})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
}

#[tokio::test]
async fn new_lead_and_patient_card_keep_several_citizenships() {
    let Some(app) = test_app().await else { return };
    let pm = app.bearer("patient_manager");
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Lev",
            "last_name": "Mehrfach",
            "email": format!("lev-{}@example.com", Uuid::new_v4().simple()),
            "citizenships": ["ua", "PL", "UA"],
            "creation_key": Uuid::new_v4(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id = created["id"].as_str().unwrap().to_string();
    let (_, lead) = json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(lead["citizenships"], json!(["UA", "PL"]));
    assert_eq!(lead["wizard_state"]["registration_country"], "UA");
    let (status, list) = json_request(&app, "GET", "/api/v1/leads", &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    let listed = list
        .as_array()
        .or_else(|| list["items"].as_array())
        .unwrap()
        .iter()
        .find(|item| item["id"] == lead_id.as_str())
        .cloned()
        .unwrap();
    assert_eq!(listed["citizenships"], json!(["UA", "PL"]));

    let (status, error) = json_request(
        &app,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Bad",
            "last_name": "Code",
            "email": format!("bad-{}@example.com", Uuid::new_v4().simple()),
            "citizenships": ["XX"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");

    // The patient card edits several citizenships; nationality keeps the first.
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, nationality, created_by)
           VALUES ($1, 'Pia', 'Karte', DATE '1980-01-01', 'female', 'German', $2) RETURNING id"#,
    )
    .bind(format!("P-CIT-{}", Uuid::new_v4().simple()))
    .bind(app.suite.admin_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let ceo = app.bearer("ceo");
    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo,
        Some(json!({"citizenships": ["ch", "DE"]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["citizenships"], json!(["CH", "DE"]));
    assert_eq!(detail["nationality"], "CH");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo,
        Some(json!({"citizenships": ["Schweiz"]})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
