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
    // The staff form always states the own-account answer, also the default.
    assert_eq!(saved["declaration"]["acts_on_own_account"], true, "{saved}");
    assert_eq!(
        saved["declaration"]["own_account_answered"], true,
        "{saved}"
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

#[tokio::test]
async fn the_gwg_identification_sheet_is_filled_from_the_lead_and_its_payer() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let ceo = app.bearer("ceo");
    let generate = |subject: Option<&str>| {
        let mut body = json!({
            "template_id": "gwg_identification",
            "lead_id": lead_id,
            "language": "de",
            "status": "active"
        });
        if let Some(subject) = subject {
            body["bindings"] = json!({ "gwg_identification": { "subject": subject } });
        }
        body
    };

    // Sales may work the lead but does not create its legal documents.
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &app.bearer("sales"),
        Some(generate(None)),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The patient's sheet needs nothing typed: it is read from the lead.
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate(None)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    let document_id = Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap();
    let (template, art, lead): (Option<String>, String, Option<Uuid>) =
        sqlx::query_as("SELECT generated_template_id, art, lead_id FROM documents WHERE id = $1")
            .bind(document_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(template.as_deref(), Some("gwg_identification"));
    assert_eq!(art, "gwg_identification");
    assert_eq!(lead, Some(lead_id));

    // The lead's own statements from the cabinet (place of birth, identity
    // document, the legal questions) are read into the sheet as well.
    sqlx::query(
        r#"INSERT INTO lead_gwg_declarations (
               lead_id, birth_place, birth_country, id_document_type, id_document_number,
               id_issuing_authority, id_issuing_country, id_issued_on, id_valid_until,
               pep_self, pep_related, pep_related_details, high_risk_country, sanctions_links)
           VALUES ($1, 'Kyiv', 'UA', 'passport', 'AB123456', 'Stadt Kyiv', 'UA',
                   DATE '2021-02-01', DATE '2031-02-01', false, true, 'Bruder, Minister',
                   false, false)"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, regenerated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate(None)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{regenerated}");

    // Without a third-party payer there is no payer sheet.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate(Some("payer"))),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &ceo,
        Some(third_party_payer()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate(Some("payer"))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    let payer_document = Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap();
    assert_ne!(payer_document, document_id);
}

/// A company as the payer. The body still carries a person, as a form does
/// after the payer type was switched.
fn organisation_payer() -> Value {
    json!({
        "payer_kind": "third_party",
        "payer_type": "company",
        "organisation_name": " Beispiel GmbH ",
        "acts_on_own_account": true,
        "source_of_funds": "business_income",
        "first_name": "Erika",
        "last_name": "Zahler",
        "date_of_birth": "1970-05-01",
        "place_of_birth": "Wien",
        "citizenships": ["AT"],
        "street": "Ringstr. 9",
        "zip": "1010",
        "city": "Wien",
        "country": "at",
        "relationship_kind": "employer",
        "relationship": "Arbeitgeberin",
        "email": "kosten@example.org",
        "payer_informed": true
    })
}

/// Name, role, country and relationship of the payer on an order.
async fn order_payer(
    pool: &PgPool,
    order_id: Uuid,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    sqlx::query_as(
        "SELECT payer_contact_name, payer_role, payer_address_country, payer_contact_relationship
         FROM orders WHERE id = $1",
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn an_organisation_pays_under_its_name_and_staff_keep_what_their_form_leaves_out() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let (_, order_id) = seed_lead_order(&app, lead_id).await;
    let pm = app.bearer("patient_manager");
    let ceo = app.bearer("ceo");
    let path = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let generate = |template: &str, subject: Option<&str>| {
        let mut body = json!({
            "template_id": template,
            "lead_id": lead_id,
            "language": "de",
            "status": "active"
        });
        if template == "cost_coverage_declaration" {
            body["order_id"] = json!(order_id);
        }
        if let Some(subject) = subject {
            body["bindings"] = json!({ "gwg_identification": { "subject": subject } });
        }
        body
    };

    for (key, value, code) in [
        ("payer_type", "club", "payer_type_invalid"),
        (
            "relationship_kind",
            "neighbour",
            "payer_relationship_kind_invalid",
        ),
    ] {
        let mut body = organisation_payer();
        body[key] = json!(value);
        let (status, error) = json_request(&app, "POST", &path, &pm, Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["error"], code);
    }
    // Only the lead agrees in the cabinet that GMED contacts the payer.
    let mut body = organisation_payer();
    body["contact_consent_at"] = json!("2026-10-05T09:20:00Z");
    let (status, _) = json_request(&app, "POST", &path, &pm, Some(body)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A company is named by its name and its seat; nothing of a natural
    // person is kept, and the words of the relationship belong to "other".
    let (status, saved) = json_request(&app, "POST", &path, &pm, Some(organisation_payer())).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let declaration = &saved["declaration"];
    assert_eq!(declaration["payer_type"], "company", "{saved}");
    assert_eq!(declaration["organisation_name"], "Beispiel GmbH", "{saved}");
    assert_eq!(declaration["relationship_kind"], "employer", "{saved}");
    for key in [
        "first_name",
        "last_name",
        "date_of_birth",
        "place_of_birth",
        "relationship",
        "contact_consent_at",
    ] {
        assert!(declaration[key].is_null(), "{key}: {saved}");
    }
    assert_eq!(declaration["citizenships"], json!([]), "{saved}");
    assert_eq!(declaration["country"], "AT", "{saved}");
    assert!(declaration["payer_informed_at"].is_string(), "{saved}");
    assert_eq!(
        saved["status"]["missing"],
        json!(["cost_assumption_missing"]),
        "name and seat complete the identity of an organisation"
    );
    assert_eq!(saved["status"]["aml_countries"], json!(["AT"]), "{saved}");
    let person: (Option<String>, Option<String>, Vec<String>) = sqlx::query_as(
        "SELECT first_name, last_name, citizenships FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(person, (None, None, Vec::new()));

    // The organisation is the payer of the lead's order, under its name.
    assert_eq!(
        order_payer(pool, order_id).await,
        (
            Some("Beispiel GmbH".into()),
            Some("cost_bearer".into()),
            Some("AT".into()),
            Some("Arbeitgeber".into())
        )
    );

    // The Kostenübernahmeerklärung names it without a date of birth.
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate("cost_coverage_declaration", None)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    let (_, current) = json_request(&app, "GET", &path, &pm, None).await;
    assert_eq!(
        current["status"]["missing"],
        json!(["cost_assumption_unsigned"]),
        "{current}"
    );

    // The identification sheet is the form for natural persons: none for the
    // company, the patient's own as before.
    let (status, refused) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate("gwg_identification", Some("payer"))),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(
        refused["code"], "payer_is_not_a_natural_person",
        "{refused}"
    );
    assert_eq!(
        refused["error"], "payer_is_not_a_natural_person",
        "{refused}"
    );
    let (status, sheet) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate("gwg_identification", None)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sheet}");

    // The staff form of an older client sends none of the new keys: the
    // type, the name and the relationship stay.
    let mut older_form = organisation_payer();
    for key in ["payer_type", "organisation_name", "relationship_kind"] {
        older_form.as_object_mut().unwrap().remove(key);
    }
    older_form["street"] = json!("Ringstr. 11");
    let (status, kept) = json_request(&app, "POST", &path, &pm, Some(older_form)).await;
    assert_eq!(status, StatusCode::OK, "{kept}");
    let declaration = &kept["declaration"];
    assert_eq!(declaration["payer_type"], "company", "{kept}");
    assert_eq!(declaration["organisation_name"], "Beispiel GmbH", "{kept}");
    assert_eq!(declaration["relationship_kind"], "employer", "{kept}");
    assert_eq!(declaration["street"], "Ringstr. 11", "{kept}");
    assert!(declaration["first_name"].is_null(), "{kept}");
    assert_eq!(
        kept["status"]["missing"],
        json!(["cost_assumption_outdated"]),
        "another seat: the generated declaration names another payer"
    );

    // Another name is another payer, on the order as well.
    let mut renamed = organisation_payer();
    renamed["organisation_name"] = json!("Beispiel Holding GmbH");
    renamed["payer_type"] = json!("organisation");
    let (status, changed) = json_request(&app, "POST", &path, &pm, Some(renamed)).await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(
        changed["declaration"]["payer_type"], "organisation",
        "{changed}"
    );
    assert_eq!(
        order_payer(pool, order_id).await.0.as_deref(),
        Some("Beispiel Holding GmbH")
    );

    // A person after all: the name of the organisation goes, the person's
    // data count again, and the payer gets an identification sheet.
    let mut person = organisation_payer();
    person["payer_type"] = json!("person");
    let (status, changed) = json_request(&app, "POST", &path, &pm, Some(person)).await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    let declaration = &changed["declaration"];
    assert_eq!(declaration["payer_type"], "person", "{changed}");
    assert!(declaration["organisation_name"].is_null(), "{changed}");
    assert_eq!(declaration["first_name"], "Erika", "{changed}");
    assert_eq!(declaration["citizenships"], json!(["AT"]), "{changed}");
    assert_eq!(
        order_payer(pool, order_id).await.0.as_deref(),
        Some("Erika Zahler")
    );
    let (status, sheet) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(generate("gwg_identification", Some("payer"))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sheet}");

    // The patient pays: nothing of the third party stays.
    let (status, own) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({"payer_kind": "self", "source_of_funds": "employment"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{own}");
    let cleared: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT payer_type, organisation_name, relationship_kind
         FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(cleared, (None, None, None));
}

/// The lead's answers of sections 7 and 8 as the cabinet stores them: the
/// invoice to another address, paid by card from a German account through a
/// payment service.
async fn seed_billing_answers(pool: &PgPool, lead_id: Uuid) {
    sqlx::query(
        r#"UPDATE lead_payer_declarations
           SET invoice_to = 'other', invoice_name = 'Beispiel GmbH', invoice_street = 'Ringstr. 9',
               invoice_zip = '1010', invoice_city = 'Wien', invoice_country = 'AT',
               invoice_email = 'rechnung@example.com',
               payment_method = 'card', account_country = 'DE', account_holder = 'Erika Zahler',
               bank_name = 'Musterbank', via_third_party = true,
               via_third_party_details = 'Zahlungsdienst Beispiel'
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
}

/// The 16 keys of sections 7 and 8 of a declaration as the API shows them.
fn billing_keys(declaration: &Value) -> Value {
    let mut keys = serde_json::Map::new();
    for key in [
        "invoice_to",
        "invoice_name",
        "invoice_street",
        "invoice_zip",
        "invoice_city",
        "invoice_country",
        "invoice_email",
        "invoice_vat_id",
        "invoice_tax_number",
        "payment_method",
        "payment_method_details",
        "account_country",
        "account_holder",
        "bank_name",
        "via_third_party",
        "via_third_party_details",
    ] {
        keys.insert(key.to_string(), declaration[key].clone());
    }
    Value::Object(keys)
}

#[tokio::test]
async fn a_staff_save_keeps_the_leads_invoice_recipient_and_payment_route() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let ceo = app.bearer("ceo");
    let path = format!("/api/v1/leads/{lead_id}/payer-declaration");

    // Staff declared the third party; the lead answered sections 7 and 8 in
    // the cabinet. The staff GET shows all 16 keys.
    let (status, body) = json_request(&app, "POST", &path, &ceo, Some(third_party_payer())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let empty = billing_keys(&body["declaration"]);
    assert!(
        empty.as_object().unwrap().values().all(Value::is_null),
        "{body}"
    );
    seed_billing_answers(pool, lead_id).await;
    let (status, body) = json_request(&app, "GET", &path, &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let answered = billing_keys(&body["declaration"]);
    assert_eq!(answered["invoice_to"], "other", "{body}");
    assert_eq!(answered["invoice_name"], "Beispiel GmbH", "{body}");
    assert_eq!(answered["payment_method"], "card", "{body}");
    assert_eq!(answered["via_third_party"], true, "{body}");
    assert!(answered["invoice_vat_id"].is_null(), "{body}");

    // The staff form of an older client (none of the keys) wipes nothing;
    // the audit row is written as before.
    let mut corrected = third_party_payer();
    corrected["street"] = json!("Ringstr. 11");
    let (status, body) = json_request(&app, "POST", &path, &ceo, Some(corrected)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["declaration"]["street"], "Ringstr. 11", "{body}");
    assert_eq!(billing_keys(&body["declaration"]), answered, "{body}");

    // The lead's keys are not staff's; the two tax fields are: sent they are
    // stored, absent they stay, `null` clears.
    let mut not_theirs = third_party_payer();
    not_theirs["invoice_to"] = json!("self");
    let (status, _) = json_request(&app, "POST", &path, &ceo, Some(not_theirs)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let mut taxed = third_party_payer();
    taxed["invoice_vat_id"] = json!(" ATU12345678 ");
    taxed["invoice_tax_number"] = json!("12/345/67890");
    let (status, body) = json_request(&app, "POST", &path, &ceo, Some(taxed)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["declaration"]["invoice_vat_id"], "ATU12345678",
        "{body}"
    );
    assert_eq!(
        body["declaration"]["invoice_tax_number"], "12/345/67890",
        "{body}"
    );
    assert_eq!(body["declaration"]["payment_method"], "card", "{body}");
    let (status, body) = json_request(&app, "POST", &path, &ceo, Some(third_party_payer())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["declaration"]["invoice_vat_id"], "ATU12345678",
        "{body}"
    );
    let mut cleared = third_party_payer();
    cleared["invoice_vat_id"] = json!(null);
    cleared["invoice_tax_number"] = json!("");
    let (status, body) = json_request(&app, "POST", &path, &ceo, Some(cleared)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["declaration"]["invoice_vat_id"].is_null(), "{body}");
    assert!(
        body["declaration"]["invoice_tax_number"].is_null(),
        "{body}"
    );
    let mut too_long = third_party_payer();
    too_long["invoice_vat_id"] = json!("x".repeat(21));
    let (status, body) = json_request(&app, "POST", &path, &ceo, Some(too_long)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "invoice_vat_id_too_long", "{body}");

    // Another payer named by staff: the payment route was the first payer's
    // answer and goes; where the invoice goes stays.
    let mut renamed = third_party_payer();
    renamed["last_name"] = json!("Anders");
    let (status, body) = json_request(&app, "POST", &path, &ceo, Some(renamed)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let after = billing_keys(&body["declaration"]);
    assert_eq!(after["invoice_to"], "other", "{body}");
    assert_eq!(after["invoice_name"], "Beispiel GmbH", "{body}");
    assert!(after["payment_method"].is_null(), "{body}");
    assert!(after["account_holder"].is_null(), "{body}");
    assert!(after["via_third_party"].is_null(), "{body}");
    assert!(after["via_third_party_details"].is_null(), "{body}");

    // The patient pays himself: "to the payer" would be no answer; another
    // address still is.
    seed_billing_answers(pool, lead_id).await;
    sqlx::query(
        r#"UPDATE lead_payer_declarations
           SET invoice_to = 'payer', invoice_name = NULL, invoice_street = NULL,
               invoice_zip = NULL, invoice_city = NULL, invoice_country = NULL,
               invoice_email = NULL
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &ceo,
        Some(json!({
            "payer_kind": "self",
            "acts_on_own_account": true,
            "source_of_funds": "savings"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let own = billing_keys(&body["declaration"]);
    assert!(own["invoice_to"].is_null(), "{body}");
    assert!(own["payment_method"].is_null(), "{body}");
    let stored: (Option<String>, Option<String>, Option<bool>) = sqlx::query_as(
        "SELECT invoice_to, payment_method, via_third_party FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(stored, (None, None, None));
}

async fn payer_informed(
    pool: &PgPool,
    lead_id: Uuid,
) -> (Option<chrono::DateTime<chrono::Utc>>, Option<Uuid>) {
    sqlx::query_as(
        "SELECT payer_informed_at, payer_informed_by FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Phase 3a, risk 5: the invitation of the payer's own link records that the
/// payer was informed; a staff save without the checkbox (an older client
/// above all) keeps that record for the same payer, and only for it.
#[tokio::test]
async fn a_staff_save_keeps_the_payer_informed_by_the_payers_link() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let manager = app.bearer("patient_manager");
    let (_, manager_id) = *app
        .users
        .iter()
        .find(|(role, _)| *role == "patient_manager")
        .unwrap();
    let path = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let mut unticked = third_party_payer();
    unticked.as_object_mut().unwrap().remove("payer_informed");
    let (status, body) = json_request(&app, "POST", &path, &manager, Some(unticked.clone())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["declaration"]["payer_informed_at"].is_null(), "{body}");

    // The link was mailed to this payer, and its invitation recorded that
    // the payer was informed (as `POST /leads/{id}/payer-link` does).
    let link_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lead_payer_links (lead_id, token_hash, email, language, payer_key, sent_by,
                                         expires_at)
           SELECT lead_id, $2, email, 'de',
                  jsonb_build_array(payer_type, organisation_name, first_name, last_name,
                                    date_of_birth),
                  $3, now() + interval '30 days'
           FROM lead_payer_declarations WHERE lead_id = $1
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind("c3".repeat(32))
    .bind(manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO lead_payer_link_emails
               (lead_id, link_id, kind, recipient, language, status, provider_message_id, sent_by)
           VALUES ($1, $2, 'invitation', 'erika.zahler@example.org', 'de', 'sent', 'email_1', $3)"#,
    )
    .bind(lead_id)
    .bind(link_id)
    .bind(manager_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE lead_payer_declarations
           SET payer_informed_at = now() - interval '1 day', payer_informed_by = $2
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(manager_id)
    .execute(pool)
    .await
    .unwrap();
    let informed = payer_informed(pool, lead_id).await;
    assert_eq!(informed.1, Some(manager_id));

    // A correction without the checkbox keeps it.
    let mut corrected = unticked.clone();
    corrected["street"] = json!("Ringstr. 11");
    let (status, body) = json_request(&app, "POST", &path, &manager, Some(corrected)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["declaration"]["street"], "Ringstr. 11", "{body}");
    assert_eq!(payer_informed(pool, lead_id).await, informed);
    let revoked: Option<String> =
        sqlx::query_scalar("SELECT revoked_reason FROM lead_payer_links WHERE id = $1")
            .bind(link_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(revoked.is_none(), "the same payer keeps the link");

    // Another payer was not informed by that link, and the link ends.
    let mut other = unticked;
    other["first_name"] = json!("Anna");
    let (status, body) = json_request(&app, "POST", &path, &manager, Some(other)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(payer_informed(pool, lead_id).await, (None, None));
    let revoked: Option<String> =
        sqlx::query_scalar("SELECT revoked_reason FROM lead_payer_links WHERE id = $1")
            .bind(link_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(revoked.as_deref(), Some("payer_changed"));
}

/// A converted patient (adult, full address) whose lead declared `payer`,
/// as the conversion leaves them: the lead converted, the declaration
/// linked to the patient.
async fn seed_converted_patient(app: &TestApp, payer_kind: &str, third_party: bool) -> Uuid {
    let pool = app.pool();
    let tag = Uuid::new_v4().simple().to_string();
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by,
                                 email, phone_primary, languages, residence_country,
                                 address_street, address_zip, address_city, address_country)
           VALUES ($1, 'Ben', 'Muster', DATE '1980-05-05', 'male', $2, $3, '+49 30 1', '{de}',
                   'DE', 'Patientenweg 3', '10117', 'Berlin', 'DE')
           RETURNING id"#,
    )
    .bind(format!("P-CONV-{tag}"))
    .bind(app.suite.admin_id)
    .bind(format!("ben-{tag}@example.com"))
    .fetch_one(pool)
    .await
    .unwrap();
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, date_of_birth, legal_sex,
                              qualification_status, compliance_status, intake_source,
                              converted_patient_id, status_changed_at)
           VALUES ('Ben', 'Muster', $1, DATE '1980-05-05', 'male', 'converted', 'signed',
                   'staff_wizard', $2, now() - interval '1 hour')
           RETURNING id"#,
    )
    .bind(format!("ben-lead-{tag}@example.com"))
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO lead_payer_declarations (
               lead_id, patient_id, payer_kind, payer_type, first_name, last_name, date_of_birth,
               street, zip, city, country, citizenships, relationship_kind, email, phone,
               source_of_funds, payer_informed_at)
           VALUES ($1, $2, $3,
                   CASE WHEN $4 THEN 'person' END, CASE WHEN $4 THEN 'Viktor' END,
                   CASE WHEN $4 THEN 'Zahler' END, CASE WHEN $4 THEN DATE '1970-05-01' END,
                   CASE WHEN $4 THEN 'Ringstr. 9' END, CASE WHEN $4 THEN '1010' END,
                   CASE WHEN $4 THEN 'Wien' END, CASE WHEN $4 THEN 'AT' END,
                   CASE WHEN $4 THEN '{AT}'::text[] ELSE '{}'::text[] END,
                   CASE WHEN $4 THEN 'relative' END,
                   CASE WHEN $4 THEN 'viktor.zahler@example.com' END,
                   CASE WHEN $4 THEN '+43 1 0000000' END,
                   'employment', CASE WHEN $4 THEN now() END)"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(payer_kind)
    .bind(third_party)
    .execute(pool)
    .await
    .unwrap();
    patient_id
}

/// Name, role, e-mail, relationship, city, country and relation of an
/// order's payer.
type OrderPayerRow = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<Uuid>,
);

/// The payer of an order as the card and the dialog read it.
async fn full_order_payer(pool: &PgPool, order_id: Uuid) -> Value {
    let row: OrderPayerRow = sqlx::query_as(
        r#"SELECT payer_contact_name, payer_role, payer_contact_email, payer_contact_relationship,
                  payer_address_city, payer_address_country, payer_patient_relation_id
           FROM orders WHERE id = $1"#,
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap();
    json!({
        "name": row.0,
        "role": row.1,
        "email": row.2,
        "relationship": row.3,
        "city": row.4,
        "country": row.5,
        "relation_id": row.6,
    })
}

async fn order_payer_audit(pool: &PgPool, order_id: Uuid) -> Vec<Value> {
    sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'set_order_payer' AND entity_id = $1
         ORDER BY created_at, id",
    )
    .bind(order_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_new_order_of_a_converted_patient_starts_with_the_declared_third_party() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let ceo = app.bearer("ceo");
    let declared = seed_converted_patient(&app, "third_party", true).await;
    let viktor = json!({
        "name": "Viktor Zahler",
        "role": "cost_bearer",
        "email": "viktor.zahler@example.com",
        "relationship": "Verwandte/r",
        "city": "Wien",
        "country": "AT",
        "relation_id": null,
    });

    // POST /orders for the patient: the declared payer, audited with its
    // source.
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &ceo,
        Some(json!({ "patient_id": declared, "needs_description": "Nachsorge" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let order_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    assert_eq!(full_order_payer(pool, order_id).await, viktor);
    let audits = order_payer_audit(pool, order_id).await;
    assert_eq!(audits.len(), 1, "{audits:?}");
    assert_eq!(audits[0]["source"], "patient_payer_declaration");
    assert_eq!(audits[0]["patient_id"], declared.to_string());
    assert!(audits[0]["lead_id"].is_string(), "{audits:?}");

    // The patient order wizard pre-sets the same payer in its transaction.
    let request_id = Uuid::new_v4();
    let (status, intake) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{declared}/order-intakes"),
        &ceo,
        Some(json!({ "request_id": request_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(full_order_payer(pool, request_id).await, viktor);
    assert_eq!(order_payer_audit(pool, request_id).await.len(), 1);

    // A self-payer sets nothing.
    let own = seed_converted_patient(&app, "self", false).await;
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &ceo,
        Some(json!({ "patient_id": own, "needs_description": "Nachsorge" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let order_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    assert!(full_order_payer(pool, order_id).await["name"].is_null());
    assert!(order_payer_audit(pool, order_id).await.is_empty());

    // A default payer relation set by staff wins over the declaration: the
    // order starts without a payer and the invoice takes the relation.
    let with_default = seed_converted_patient(&app, "third_party", true).await;
    sqlx::query(
        r#"INSERT INTO patient_relations (patient_id, related_name, relation_type, is_default_payer,
                                          address_street, address_zip, address_city, address_country)
           VALUES ($1, 'Olga Zahler', 'sibling', true, 'Nebenweg 2', '10115', 'Berlin', 'DE')"#,
    )
    .bind(with_default)
    .execute(pool)
    .await
    .unwrap();
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &ceo,
        Some(json!({ "patient_id": with_default, "needs_description": "Nachsorge" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let order_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    assert!(full_order_payer(pool, order_id).await["name"].is_null());
    assert!(order_payer_audit(pool, order_id).await.is_empty());
}
