//! Integration tests for the representation of a lead (owner spec
//! "Patientenformular (Lead-Link)", section 3): an adult's representative and
//! legal guardian, the legal representatives of a minor, their files, what
//! "send to the manager" needs of them, and what staff read and change.
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
const CONSENT_VERSION: &str = "2026-10-03";
const PDF: &[u8] = b"%PDF-1.4\n% synthetic representative document\n%%EOF\n";

struct TestApp {
    suite: support::TestSuiteContext,
    sales_id: Uuid,
    patient_manager_id: Uuid,
    concierge_id: Uuid,
}

impl TestApp {
    fn staff(&self, role: &str) -> String {
        let user_id = match role {
            "sales" => self.sales_id,
            "patient_manager" => self.patient_manager_id,
            "concierge" => self.concierge_id,
            other => panic!("unexpected role {other}"),
        };
        bearer(user_id, role)
    }
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "representation-{role}-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind(format!("{role} representation"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn test_app() -> Option<TestApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let sales_id = seed_user(&suite.pool, "sales").await;
    let patient_manager_id = seed_user(&suite.pool, "patient_manager").await;
    let concierge_id = seed_user(&suite.pool, "concierge").await;
    Some(TestApp {
        suite,
        sales_id,
        patient_manager_id,
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

async fn upload_file(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    file_name: &str,
    content_type: &str,
    bytes: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {content_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
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

/// A unique e-mail address of the test.
fn address(name: &str) -> String {
    format!("{name}.{}@example.com", Uuid::new_v4().simple())
}

/// An adult lead (Anna Muster) with its patient login and the given trusted
/// contacts; returns (lead, bearer).
async fn adult_lead(app: &TestApp, trusted_contacts: Value) -> (Uuid, String) {
    let (status, created) = json_request(
        &app.suite.app,
        "POST",
        "/api/v1/leads",
        &app.staff("patient_manager"),
        Some(json!({
            "first_name": "Anna",
            "last_name": "Muster",
            "date_of_birth": "1985-03-02",
            "email": address("anna.muster"),
            "trusted_contacts": trusted_contacts
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
    (lead_id, bearer(user_id, "patient"))
}

/// A minor lead (Mia Muster) with the given trusted contacts.
async fn minor_lead(app: &TestApp, trusted_contacts: Value) -> Uuid {
    let (status, created) = json_request(
        &app.suite.app,
        "POST",
        "/api/v1/leads",
        &app.staff("patient_manager"),
        Some(json!({
            "first_name": "Mia",
            "last_name": "Muster",
            "date_of_birth": "2016-04-05",
            "email": address("mia.muster"),
            "trusted_contacts": trusted_contacts
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert!(created["portal_account"].is_null(), "{created}");
    created["id"].as_str().unwrap().parse().unwrap()
}

/// Issues the parents' access for a trusted contact; returns the bearer.
async fn guardian_login(app: &TestApp, lead_id: Uuid, contact_id: Uuid) -> (Uuid, String) {
    let (status, issued) = json_request(
        &app.suite.app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-guardians"),
        &app.staff("patient_manager"),
        Some(json!({ "trusted_contact_id": contact_id })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let user_id: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    (user_id, bearer(user_id, "patient"))
}

async fn give_inquiry_consent(app: &axum::Router, lead_id: Uuid, bearer: &str) {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/consent"),
        bearer,
        Some(json!({
            "purpose": "lead_inquiry_processing",
            "version": CONSENT_VERSION,
            "language": "de"
        })),
    )
    .await;
    assert!(
        status == StatusCode::CREATED || status == StatusCode::OK,
        "{status} {body}"
    );
}

fn missing(body: &Value) -> Vec<String> {
    body["progress"]["missing_for_submit"]
        .as_array()
        .unwrap_or_else(|| panic!("no missing list: {body}"))
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

/// The representation keys of the missing list (with the two adult answers)
/// and, once the risk assessment runs, of follow-up block G (an adult's
/// representative or guardian, trigger flow 2026-10-07).
fn missing_representation(body: &Value) -> Vec<String> {
    let mut keys: Vec<String> = missing(body)
        .into_iter()
        .filter(|key| {
            ["rep1_", "rep2_", "agent_", "guardian_"]
                .iter()
                .any(|prefix| key.starts_with(prefix))
                || key == "has_representative"
                || key == "under_guardianship"
        })
        .collect();
    // Block G asks what the first step still misses once more: each key once.
    if let Some(block) = body["follow_up"]["missing"]["G"].as_array() {
        for key in block.iter().filter_map(Value::as_str) {
            if !keys.iter().any(|known| known == key) {
                keys.push(key.to_string());
            }
        }
    }
    keys
}

/// Starts the risk assessment of the lead (a reviewer's restart): from then
/// on an adult's representative is asked in follow-up block G.
async fn start_assessment(app: &TestApp, lead_id: Uuid) {
    let ceo = bearer(seed_user(&app.suite.pool, "ceo").await, "ceo");
    let (status, body) = json_request(
        &app.suite.app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/risk-assessment/restart"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

fn keys(slot: &str, fields: &[&str]) -> Vec<String> {
    fields
        .iter()
        .map(|field| format!("{slot}_{field}"))
        .collect()
}

// Staff enter the identity document data (trigger flow 2026-10-07).
const ADULT_FIELDS: [&str; 9] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "street",
    "zip",
    "city",
    "country",
    "id_upload",
    "authority_upload",
];

const MINOR_FIELDS: [&str; 12] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "birth_place",
    "citizenships",
    "street",
    "zip",
    "city",
    "country",
    "email",
    "phone",
    "id_upload",
];

fn representative(body: &Value, id: Uuid) -> Value {
    body["representation"]["representatives"]
        .as_array()
        .unwrap_or_else(|| panic!("no representatives: {body}"))
        .iter()
        .find(|person| person["id"] == json!(id))
        .cloned()
        .unwrap_or_else(|| panic!("no representative {id}: {body}"))
}

/// What the form sends for a complete adult representative.
fn complete_adult_person(role: &str) -> Value {
    json!({
        "role": role,
        "first_name": "Ben",
        "last_name": "Muster",
        "date_of_birth": "1984-07-09",
        "street": "Nebenweg 2",
        "zip": "80331",
        "city": "München",
        "country": "de"
    })
}

/// What the form sends for the rest of a complete legal representative of a
/// minor (name and contact apart).
fn complete_parent_details() -> Value {
    json!({
        "date_of_birth": "1985-03-02",
        "birth_place": "Berlin",
        "citizenships": ["de"],
        "street": "Musterweg 1",
        "zip": "10115",
        "city": "Berlin",
        "country": "DE",
        "phone": "+49 30 000000"
    })
}

async fn audit_contexts(pool: &PgPool, action: &str, lead_id: Uuid) -> Vec<Value> {
    sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = $1 AND entity_id = $2 ORDER BY created_at",
    )
    .bind(action)
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn an_adult_names_the_person_who_acts_for_him() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let aunt = Uuid::new_v4();
    let (lead_id, patient) = adult_lead(
        &app,
        json!([{ "id": aunt, "name": "Tante Muster", "relation": "aunt" }]),
    )
    .await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let agent = Uuid::new_v4();
    let agent_path = format!("{request}/representatives/{agent}");

    // Nothing is stated yet: both questions are open, nobody is asked for.
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["minor"], false, "{body}");
    assert_eq!(
        body["representation"],
        json!({
            "has_representative": null,
            "under_guardianship": null,
            "custody": null,
            "custody_stated": false,
            "representatives": [],
        }),
        "{body}"
    );
    // The guardianship question is asked again (owner 2026-10-10).
    assert_eq!(
        missing_representation(&body),
        vec!["has_representative", "under_guardianship"]
    );

    // A key that does not fit an adult, an unknown key and a value of another
    // type are refused with the key.
    for (refused, field) in [
        (json!({ "custody": "joint" }), "custody"),
        (json!({ "has_login": true }), "has_login"),
        (json!({ "has_representative": "yes" }), "has_representative"),
    ] {
        let (status, error) = json_request(
            router,
            "POST",
            &format!("{request}/representation"),
            &patient,
            Some(refused),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["code"], "invalid_field", "{error}");
        assert_eq!(error["field"], field, "{error}");
    }
    // Nobody is entered before the question is answered with yes.
    let (status, error) = json_request(
        router,
        "POST",
        &agent_path,
        &patient,
        Some(complete_adult_person("authorised_representative")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representation_not_declared", "{error}");

    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &patient,
        Some(json!({ "has_representative": true, "under_guardianship": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["representation"]["has_representative"], true);
    assert_eq!(body["representation"]["under_guardianship"], false);
    // The base form asks for the whole person but staff's identity data
    // (owner 2026-10-07: identified before sending).
    assert_eq!(
        missing_representation(&body),
        keys("agent", &ADULT_FIELDS),
        "{body}"
    );
    start_assessment(&app, lead_id).await;
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(body["follow_up"]["blocks"], json!(["G", "I"]), "{body}");
    assert_eq!(
        missing_representation(&body),
        keys("agent", &ADULT_FIELDS),
        "{body}"
    );

    // The role is needed, fits an adult, and a person has a last name.
    for (refused, code) in [
        (
            json!({ "last_name": "Muster" }),
            "representative_role_invalid",
        ),
        (
            json!({ "role": "legal_representative", "last_name": "Muster" }),
            "representative_role_invalid",
        ),
        (
            json!({ "role": "authorised_representative", "first_name": "Ben" }),
            "invalid_field",
        ),
        (
            json!({ "role": "authorised_representative", "last_name": "Muster", "mine": true }),
            "invalid_field",
        ),
    ] {
        let (status, error) =
            json_request(router, "POST", &agent_path, &patient, Some(refused)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["code"], code, "{error}");
    }
    // The legal guardian is not asked for: the lead is not under guardianship.
    let (status, error) = json_request(
        router,
        "POST",
        &agent_path,
        &patient,
        Some(complete_adult_person("legal_guardian")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representation_not_declared", "{error}");
    // The id of another trusted contact cannot become the representative.
    let (status, error) = json_request(
        router,
        "POST",
        &format!("{request}/representatives/{aunt}"),
        &patient,
        Some(complete_adult_person("authorised_representative")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representative_id_taken", "{error}");

    // The first save with the last name creates the person.
    let (status, body) = json_request(
        router,
        "POST",
        &agent_path,
        &patient,
        Some(json!({ "role": "authorised_representative", "last_name": " Muster " })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let person = representative(&body, agent);
    assert_eq!(person["slot"], "agent", "{person}");
    assert_eq!(person["role"], "authorised_representative", "{person}");
    assert_eq!(person["relation"], "representative", "{person}");
    assert_eq!(person["first_name"], "", "{person}");
    assert_eq!(person["last_name"], "Muster", "{person}");
    assert_eq!(person["mine"], false, "{person}");
    assert_eq!(person["email_locked"], false, "{person}");
    assert_eq!(person["can_remove"], true, "{person}");
    assert_eq!(person["citizenships"], json!([]), "{person}");
    assert_eq!(person["identity_documents"], json!([]), "{person}");
    assert_eq!(person["authority_documents"], json!([]), "{person}");
    // Nobody else can be entered for the same question.
    let (status, error) = json_request(
        router,
        "POST",
        &format!("{request}/representatives/{}", Uuid::new_v4()),
        &patient,
        Some(complete_adult_person("authorised_representative")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representative_limit", "{error}");

    // Values are validated like the lead's own; a refused save stores nothing.
    for (refused, code, field) in [
        (
            json!({ "date_of_birth": "2012-01-01" }),
            "invalid_field",
            "date_of_birth",
        ),
        (json!({ "country": "Germany" }), "invalid_field", "country"),
        (
            json!({ "id_valid_until": "2099-01-01" }),
            "staff_only",
            "id_valid_until",
        ),
        (
            json!({ "role": "legal_guardian" }),
            "representative_role_invalid",
            "role",
        ),
        (json!({ "last_name": "" }), "invalid_field", "last_name"),
    ] {
        let (status, error) =
            json_request(router, "POST", &agent_path, &patient, Some(refused)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["code"], code, "{error}");
        assert_eq!(error["field"], field, "{error}");
    }
    let (status, body) = json_request(
        router,
        "POST",
        &agent_path,
        &patient,
        Some(complete_adult_person("authorised_representative")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let person = representative(&body, agent);
    assert_eq!(person["first_name"], "Ben", "{person}");
    assert_eq!(person["date_of_birth"], "1984-07-09", "{person}");
    assert_eq!(person["country"], "DE", "{person}");
    assert!(person["id_valid_until"].is_null(), "{person}");
    assert_eq!(
        missing_representation(&body),
        vec!["agent_id_upload", "agent_authority_upload"],
        "{body}"
    );

    // The person is a trusted contact of the lead (the keys the wizard
    // writes) with a row for the rest; the aunt is untouched.
    let (contacts, legacy_name): (Value, Option<String>) =
        sqlx::query_as("SELECT trusted_contacts, trusted_contact_name FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(contacts.as_array().unwrap().len(), 2, "{contacts}");
    assert_eq!(contacts[0]["id"], json!(aunt), "{contacts}");
    assert_eq!(
        contacts[1],
        json!({
            "id": agent,
            "related_patient_id": null,
            "name": "Ben Muster",
            "email": null,
            "phone": null,
            "relation": "representative",
            "birth_date": "1984-07-09",
            "address": "Nebenweg 2, 80331 München, Deutschland",
        }),
        "{contacts}"
    );
    assert_eq!(legacy_name.as_deref(), Some("Tante Muster"));
    let (role, origin, city, updated_by_patient): (String, String, Option<String>, bool) =
        sqlx::query_as(
            r#"SELECT role, contact_origin, city, updated_by IS NOT NULL
               FROM lead_representatives WHERE lead_id = $1 AND contact_id = $2"#,
        )
        .bind(lead_id)
        .bind(agent)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        (role.as_str(), origin.as_str(), city.as_deref()),
        ("authorised_representative", "portal", Some("München"))
    );
    assert!(updated_by_patient);

    // The audit events name the changed fields, never what was entered.
    let events = audit_contexts(pool, "lead_portal_update_representative", lead_id).await;
    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(events[0]["created"], true, "{events:?}");
    assert_eq!(events[0]["fields"], json!(["last_name"]), "{events:?}");
    assert_eq!(events[1]["created"], false, "{events:?}");
    assert!(
        events[1]["fields"]
            .as_array()
            .unwrap()
            .contains(&json!("street")),
        "{events:?}"
    );
    let logged = serde_json::to_string(&events).unwrap();
    for value in ["Muster", "C01X00T47", "Nebenweg", "München"] {
        assert!(!logged.contains(value), "{value} in {logged}");
    }
    assert_eq!(
        audit_contexts(pool, "lead_portal_update_representation", lead_id)
            .await
            .last()
            .map(|event| event["fields"].clone()),
        Some(json!(["has_representative", "under_guardianship"]))
    );

    // The files need the request consent, like the lead's own identity
    // document, and a person who is a representative of this request.
    let identity_upload = format!("{agent_path}/identity-document");
    let authority_upload = format!("{agent_path}/authority-document");
    let (status, error) = upload_file(
        router,
        &identity_upload,
        &patient,
        "ausweis.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
    assert_eq!(error["code"], "inquiry_consent_required", "{error}");
    give_inquiry_consent(router, lead_id, &patient).await;
    for stranger in [aunt, Uuid::new_v4()] {
        let (status, error) = upload_file(
            router,
            &format!("{request}/representatives/{stranger}/identity-document"),
            &patient,
            "ausweis.pdf",
            "application/pdf",
            PDF,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    }
    let (status, error) = upload_file(
        router,
        &authority_upload,
        &patient,
        "vollmacht.txt",
        "text/plain",
        b"Vollmacht",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    let (status, body) = upload_file(
        router,
        &identity_upload,
        &patient,
        "ausweis.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (status, body) = upload_file(
        router,
        &authority_upload,
        &patient,
        "vollmacht.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let person = representative(&body, agent);
    let identity_file = &person["identity_documents"][0];
    assert_eq!(identity_file["file_name"], "ausweis.pdf", "{person}");
    assert_eq!(identity_file["uploaded_by_me"], true, "{person}");
    assert_eq!(identity_file["can_delete"], true, "{person}");
    assert_eq!(
        person["authority_documents"][0]["file_name"], "vollmacht.pdf",
        "{person}"
    );
    assert_eq!(
        missing_representation(&body),
        Vec::<String>::new(),
        "{body}"
    );

    // A representative's scan is never the lead's own identity document: the
    // lead's list stays empty, the lead's scan is still missing, the document
    // has a type of its own and cannot be confirmed as an identity document.
    assert_eq!(body["identity_documents"], json!([]), "{body}");
    assert_eq!(body["documents"], json!([]), "{body}");
    assert!(
        missing(&body).contains(&"id_document_upload".to_string()),
        "{body}"
    );
    let identity_document: Uuid = identity_file["id"].as_str().unwrap().parse().unwrap();
    // Kind, document type, category, medical, access category and person.
    let files: Value = sqlx::query_scalar(
        r#"SELECT jsonb_agg(
                      jsonb_build_array(u.kind, d.art, d.category, d.is_medical,
                                        d.access_category, u.representative_id)
                      ORDER BY u.created_at)
           FROM lead_portal_uploads u JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        files,
        json!([
            [
                "representative_identity",
                "representative_identity",
                "identity",
                false,
                "internal",
                agent
            ],
            [
                "representative_authority",
                "representative_authority",
                "administrative",
                false,
                "internal",
                agent
            ],
        ])
    );
    let (auto_name, lead_identity_on_file): (String, bool) = sqlx::query_as(
        r#"SELECT d.auto_name,
                  EXISTS (
                      SELECT 1 FROM documents own
                      WHERE own.lead_id = d.lead_id
                        AND own.file_deleted_at IS NULL
                        AND (own.compliance_kind = 'identity'
                             OR lower(own.art) IN ('identity', 'passport', 'passport_scan', 'reisepass'))
                  )
           FROM documents d WHERE d.id = $1"#,
    )
    .bind(identity_document)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(auto_name, "Ausweisdokument – Ben Muster");
    assert!(!lead_identity_on_file);
    let (status, refused) = json_request(
        router,
        "POST",
        &format!("/api/v1/documents/{identity_document}/mark-signed"),
        &app.staff("patient_manager"),
        Some(json!({ "compliance_kind": "identity" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");

    // Staff read the representation with the lead's statements; the
    // concierge, who sees only the service side of a lead, gets none of it.
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert!(intake["representation_updated_at"].is_string(), "{intake}");
    assert_eq!(intake["representation"]["has_representative"], true);
    assert_eq!(intake["representation"]["custody"], Value::Null);
    let staff_person = &intake["representation"]["representatives"][0];
    assert_eq!(staff_person["id"], json!(agent), "{intake}");
    assert_eq!(staff_person["slot"], "agent", "{intake}");
    assert_eq!(staff_person["has_login"], false, "{intake}");
    assert_eq!(staff_person["has_data"], true, "{intake}");
    assert_eq!(staff_person["contact_origin"], "portal", "{intake}");
    assert_eq!(staff_person["city"], "München", "{intake}");
    assert!(staff_person.get("mine").is_none(), "{intake}");
    assert!(staff_person.get("can_remove").is_none(), "{intake}");
    assert_eq!(
        staff_person["identity_documents"][0],
        json!({
            "id": identity_document,
            "file_name": "ausweis.pdf",
            "uploaded_at": staff_person["identity_documents"][0]["uploaded_at"],
            "reviewed": false,
        }),
        "{intake}"
    );
    assert_eq!(
        staff_person["authority_documents"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "{intake}"
    );
    // The representative's files are not the lead's identity document; "N
    // documents" counts every file of the cabinet (QA 2026-10-10).
    assert_eq!(intake["identity_documents"], json!([]), "{intake}");
    assert_eq!(intake["progress"]["documents"], 2, "{intake}");
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert!(intake["representation"].is_null(), "{intake}");
    assert!(intake["representation_updated_at"].is_null(), "{intake}");

    // The custody is a minor's; staff do not state it for an adult.
    let (status, error) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/representation"),
        &app.staff("patient_manager"),
        Some(json!({ "custody": "joint" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["code"], "custody_minor_only", "{error}");

    // Staff took the copy of the identity document over: "no" would remove
    // the person and the file with it, so it is refused and nothing changes.
    let (status, reviewed) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-intake/documents/{identity_document}/review"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reviewed}");
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(representative(&body, agent)["can_remove"], false, "{body}");
    for (method, path, body) in [
        (
            "POST",
            format!("{request}/representation"),
            Some(json!({ "has_representative": false })),
        ),
        ("DELETE", agent_path.clone(), None),
    ] {
        let (status, error) = json_request(router, method, &path, &patient, body).await;
        assert_eq!(status, StatusCode::CONFLICT, "{error}");
        assert_eq!(error["code"], "representative_in_use", "{error}");
    }
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(body["representation"]["has_representative"], true, "{body}");
    assert_eq!(representative(&body, agent)["last_name"], "Muster");
}

#[tokio::test]
async fn an_adult_under_guardianship_names_the_guardian_and_a_no_removes_the_person() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, patient) = adult_lead(&app, json!([])).await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let guardian = Uuid::new_v4();
    let guardian_path = format!("{request}/representatives/{guardian}");

    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &patient,
        Some(json!({ "has_representative": false, "under_guardianship": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    start_assessment(&app, lead_id).await;
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    // Asked in the first step and, once the assessment runs, in block G.
    assert_eq!(
        missing_representation(&body),
        keys("guardian", &ADULT_FIELDS),
        "{body}"
    );
    // The representative is not asked for.
    let (status, error) = json_request(
        router,
        "POST",
        &guardian_path,
        &patient,
        Some(complete_adult_person("authorised_representative")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representation_not_declared", "{error}");

    let mut betreuer = complete_adult_person("legal_guardian");
    betreuer["first_name"] = json!("Carla");
    betreuer["email"] = json!("Carla.Muster@Example.com");
    betreuer["phone"] = json!("+49 89 000000");
    betreuer["birth_place"] = json!("München");
    betreuer["citizenships"] = json!(["de", "AT", "DE"]);
    let (status, body) =
        json_request(router, "POST", &guardian_path, &patient, Some(betreuer)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let person = representative(&body, guardian);
    assert_eq!(person["slot"], "guardian", "{person}");
    assert_eq!(person["role"], "legal_guardian", "{person}");
    assert_eq!(person["relation"], "guardian", "{person}");
    assert_eq!(person["email"], "carla.muster@example.com", "{person}");
    assert_eq!(person["citizenships"], json!(["DE", "AT"]), "{person}");
    assert_eq!(person["can_remove"], true, "{person}");
    assert_eq!(
        missing_representation(&body),
        vec!["guardian_id_upload", "guardian_authority_upload"],
        "{body}"
    );
    // A save that changes nothing answers with the request and writes nothing.
    let saves = audit_contexts(pool, "lead_portal_update_representative", lead_id)
        .await
        .len();
    let (status, body) = json_request(
        router,
        "POST",
        &guardian_path,
        &patient,
        Some(json!({ "first_name": "Carla", "role": "legal_guardian" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        audit_contexts(pool, "lead_portal_update_representative", lead_id)
            .await
            .len(),
        saves
    );

    // The appointment deed and the copy of the identity document.
    give_inquiry_consent(router, lead_id, &patient).await;
    let mut uploaded = Vec::new();
    for part in ["identity-document", "authority-document"] {
        let (status, body) = upload_file(
            router,
            &format!("{guardian_path}/{part}"),
            &patient,
            "betreuer.pdf",
            "application/pdf",
            PDF,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{part}: {body}");
        let person = representative(&body, guardian);
        for list in ["identity_documents", "authority_documents"] {
            for file in person[list].as_array().unwrap() {
                let id: Uuid = file["id"].as_str().unwrap().parse().unwrap();
                if !uploaded.contains(&id) {
                    uploaded.push(id);
                }
            }
        }
    }
    assert_eq!(uploaded.len(), 2);

    // A file is withdrawn like any upload of the request.
    let (status, body) = json_request(
        router,
        "DELETE",
        &format!("{request}/documents/{}", uploaded[1]),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        representative(&body, guardian)["authority_documents"],
        json!([]),
        "{body}"
    );
    assert_eq!(
        missing_representation(&body),
        vec!["guardian_authority_upload"],
        "{body}"
    );

    // "No" after all: the person goes with the row, the trusted contact and
    // the remaining file.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &patient,
        Some(json!({ "under_guardianship": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["representation"]["under_guardianship"], false);
    assert_eq!(body["representation"]["representatives"], json!([]));
    assert_eq!(missing_representation(&body), Vec::<String>::new());
    let (contacts, rows, registered, stored): (Value, i64, i64, i64) = sqlx::query_as(
        r#"SELECT trusted_contacts,
                  (SELECT count(*) FROM lead_representatives WHERE lead_id = $1),
                  (SELECT count(*) FROM lead_portal_uploads WHERE lead_id = $1),
                  (SELECT count(*) FROM documents
                   WHERE id = ANY($2) AND (storage_key IS NOT NULL OR file_deleted_at IS NULL))
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(&uploaded)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(contacts, json!([]));
    assert_eq!((rows, registered, stored), (0, 0, 0));
    let removals = audit_contexts(pool, "lead_portal_remove_representative", lead_id).await;
    assert_eq!(removals.len(), 1, "{removals:?}");
    assert_eq!(removals[0]["representative_id"], json!(guardian));
    assert_eq!(removals[0]["documents_withdrawn"], 1, "{removals:?}");
    // The answer can be taken back; then it is open again.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &patient,
        Some(json!({ "under_guardianship": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The guardianship question is asked again (owner 2026-10-10).
    assert_eq!(
        missing_representation(&body),
        vec!["under_guardianship"],
        "{body}"
    );
}

#[tokio::test]
async fn both_parents_of_a_minor_are_asked_for_by_default() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let mother = Uuid::new_v4();
    let mother_email = address("anna.muster");
    let lead_id = minor_lead(
        &app,
        json!([{ "id": mother, "name": "Anna Muster", "relation": "mother",
                 "email": mother_email }]),
    )
    .await;
    let (_, parent) = guardian_login(&app, lead_id, mother).await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let mother_path = format!("{request}/representatives/{mother}");
    let father = Uuid::new_v4();
    let father_path = format!("{request}/representatives/{father}");

    // The mother, whose login it is, is the first representative; the second
    // parent is asked for as long as nobody says otherwise.
    let (status, body) = json_request(router, "GET", &request, &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["minor"], true, "{body}");
    assert_eq!(body["representation"]["has_representative"], Value::Null);
    assert_eq!(body["representation"]["custody"], "joint", "{body}");
    assert_eq!(body["representation"]["custody_stated"], false, "{body}");
    let first = representative(&body, mother);
    assert_eq!(first["slot"], "rep1", "{first}");
    assert_eq!(first["role"], "legal_representative", "{first}");
    assert_eq!(first["relation"], "mother", "{first}");
    assert_eq!(first["mine"], true, "{first}");
    assert_eq!(first["email_locked"], true, "{first}");
    assert_eq!(first["can_remove"], false, "{first}");
    assert_eq!(first["first_name"], "Anna", "{first}");
    assert_eq!(first["last_name"], "Muster", "{first}");
    assert_eq!(first["email"], json!(mother_email), "{first}");
    let mut expected = keys(
        "rep1",
        &MINOR_FIELDS
            .iter()
            .copied()
            .filter(|field| !["first_name", "last_name", "email"].contains(field))
            .collect::<Vec<_>>(),
    );
    expected.extend(keys("rep2", &MINOR_FIELDS));
    assert_eq!(missing_representation(&body), expected, "{body}");

    // The adult questions are not asked for a minor.
    let (status, error) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &parent,
        Some(json!({ "has_representative": false })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["field"], "has_representative", "{error}");

    // The mother completes her own data: the contact staff entered gets its
    // row. Her address is the login and stays with staff.
    let (status, error) = json_request(
        router,
        "POST",
        &mother_path,
        &parent,
        Some(json!({ "email": "andere.adresse@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["code"], "representative_email_is_login", "{error}");
    assert_eq!(error["field"], "email", "{error}");
    let (status, error) = json_request(
        router,
        "POST",
        &mother_path,
        &parent,
        Some(json!({ "role": "authorised_representative", "birth_place": "Berlin" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["code"], "representative_role_invalid", "{error}");
    let (status, body) = json_request(
        router,
        "POST",
        &mother_path,
        &parent,
        Some(complete_parent_details()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let first = representative(&body, mother);
    assert_eq!(first["birth_place"], "Berlin", "{first}");
    assert_eq!(first["citizenships"], json!(["DE"]), "{first}");
    assert_eq!(first["can_remove"], false, "{first}");
    let (origin, role): (String, String) = sqlx::query_as(
        "SELECT contact_origin, role FROM lead_representatives WHERE lead_id = $1 AND contact_id = $2",
    )
    .bind(lead_id)
    .bind(mother)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (origin.as_str(), role.as_str()),
        ("staff", "legal_representative")
    );
    let mut expected = vec!["rep1_id_upload".to_string()];
    expected.extend(keys("rep2", &MINOR_FIELDS));
    assert_eq!(missing_representation(&body), expected, "{body}");

    // She names the father. Two signers of one request need two addresses.
    let (status, error) = json_request(
        router,
        "POST",
        &father_path,
        &parent,
        Some(json!({
            "role": "legal_representative",
            "last_name": "Muster",
            "email": mother_email.to_uppercase()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["code"], "representative_email_duplicate", "{error}");
    assert_eq!(error["field"], "email", "{error}");
    let father_email = address("ben.muster");
    let mut second = complete_parent_details();
    second["role"] = json!("legal_representative");
    second["first_name"] = json!("Ben");
    second["last_name"] = json!("Muster");
    second["date_of_birth"] = json!("1984-07-09");
    second["email"] = json!(father_email);
    let (status, body) = json_request(router, "POST", &father_path, &parent, Some(second)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let other = representative(&body, father);
    assert_eq!(other["slot"], "rep2", "{other}");
    assert_eq!(other["relation"], "parent", "{other}");
    assert_eq!(other["mine"], false, "{other}");
    assert_eq!(other["email_locked"], false, "{other}");
    assert_eq!(other["can_remove"], true, "{other}");
    assert_eq!(
        missing_representation(&body),
        vec!["rep1_id_upload", "rep2_id_upload"],
        "{body}"
    );
    // Both places are taken.
    let (status, error) = json_request(
        router,
        "POST",
        &format!("{request}/representatives/{}", Uuid::new_v4()),
        &parent,
        Some(json!({ "role": "legal_representative", "last_name": "Muster" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representative_limit", "{error}");

    // The scans of both parents; the child's own identity document is still
    // asked for and is not one of them.
    give_inquiry_consent(router, lead_id, &parent).await;
    let mut body = Value::Null;
    for path in [&mother_path, &father_path] {
        let (status, uploaded) = upload_file(
            router,
            &format!("{path}/identity-document"),
            &parent,
            "ausweis.pdf",
            "application/pdf",
            PDF,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{uploaded}");
        body = uploaded;
    }
    assert_eq!(
        missing_representation(&body),
        Vec::<String>::new(),
        "{body}"
    );
    assert!(
        missing(&body).contains(&"id_document_upload".to_string()),
        "{body}"
    );
    assert_eq!(body["identity_documents"], json!([]), "{body}");

    // The father is a trusted contact like the mother: staff can issue his
    // access, and the payer form of the mother is prefilled with her name
    // parts as she entered them.
    assert_eq!(body["payer_self_template"]["first_name"], "Anna", "{body}");
    assert_eq!(body["payer_self_template"]["last_name"], "Muster", "{body}");
    // ... and with the citizenships and the address of her own row (QA
    // 2026-10-06).
    let template = &body["payer_self_template"];
    assert_eq!(template["citizenships"], json!(["DE"]), "{body}");
    assert_eq!(template["street"], "Musterweg 1", "{body}");
    assert_eq!(template["zip"], "10115", "{body}");
    assert_eq!(template["city"], "Berlin", "{body}");
    assert_eq!(template["country"], "DE", "{body}");
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    let people = intake["representation"]["representatives"]
        .as_array()
        .unwrap();
    assert_eq!(people.len(), 2, "{intake}");
    assert_eq!(people[0]["has_login"], true, "{intake}");
    assert_eq!(people[0]["contact_origin"], "staff", "{intake}");
    assert_eq!(people[1]["has_login"], false, "{intake}");
    assert_eq!(people[1]["contact_origin"], "portal", "{intake}");
    assert!(
        intake["guardians"]["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|candidate| candidate["trusted_contact_id"] == json!(father)),
        "{intake}"
    );

    // Removing: only a person the cabinet created, never the own login.
    let (status, error) = json_request(router, "DELETE", &mother_path, &parent, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representative_in_use", "{error}");
    let (status, error) = json_request(
        router,
        "DELETE",
        &format!("{request}/representatives/{}", Uuid::new_v4()),
        &parent,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    let (status, body) = json_request(router, "DELETE", &father_path, &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["representation"]["representatives"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "{body}"
    );
    assert_eq!(
        missing_representation(&body),
        keys("rep2", &MINOR_FIELDS),
        "{body}"
    );
    let (contacts, rows, uploads): (Value, i64, i64) = sqlx::query_as(
        r#"SELECT trusted_contacts,
                  (SELECT count(*) FROM lead_representatives WHERE lead_id = $1),
                  (SELECT count(*) FROM lead_portal_uploads WHERE lead_id = $1)
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(contacts.as_array().unwrap().len(), 1, "{contacts}");
    assert_eq!(contacts[0]["id"], json!(mother), "{contacts}");
    // What the mother entered is in her contact: the name, the phone, the
    // date of birth and the address in one line.
    assert_eq!(contacts[0]["name"], "Anna Muster", "{contacts}");
    assert_eq!(contacts[0]["relation"], "mother", "{contacts}");
    assert_eq!(contacts[0]["phone"], "+49 30 000000", "{contacts}");
    assert_eq!(contacts[0]["birth_date"], "1985-03-02", "{contacts}");
    assert_eq!(
        contacts[0]["address"], "Musterweg 1, 10115 Berlin, Deutschland",
        "{contacts}"
    );
    assert_eq!((rows, uploads), (1, 1));
}

#[tokio::test]
async fn one_parent_alone_or_a_guardian_represents_a_minor() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let pm = app.staff("patient_manager");
    let (mother, stepfather) = (Uuid::new_v4(), Uuid::new_v4());
    let lead_id = minor_lead(
        &app,
        json!([
            { "id": mother, "name": "Anna Muster", "relation": "mother",
              "email": address("anna.muster") },
        ]),
    )
    .await;
    let (_, parent) = guardian_login(&app, lead_id, mother).await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let custody = |value: Value| Some(json!({ "custody": value }));
    let father = Uuid::new_v4();
    let father_path = format!("{request}/representatives/{father}");

    // Staff may state the custody in the wizard; only the roles that work the
    // lead, only for a minor, and nobody is removed by it.
    let staff_path = format!("/api/v1/leads/{lead_id}/representation");
    let (status, _) = json_request(
        router,
        "POST",
        &staff_path,
        &app.staff("concierge"),
        custody(json!("joint")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, error) =
        json_request(router, "POST", &staff_path, &pm, custody(json!("both"))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["code"], "invalid_field", "{error}");
    let (status, error) = json_request(
        router,
        "POST",
        &staff_path,
        &pm,
        Some(json!({ "custody": "joint", "has_representative": true })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    let (status, stated) = json_request(
        router,
        "POST",
        &staff_path,
        &pm,
        custody(json!("sole_parent")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{stated}");
    assert_eq!(stated["representation"]["custody"], "sole_parent");
    assert_eq!(stated["representation"]["custody_stated"], true);
    assert_eq!(
        stated["representation"]["representatives"][0]["slot"], "rep1",
        "{stated}"
    );
    let events = audit_contexts(pool, "set_lead_custody", lead_id).await;
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0]["custody"], "sole_parent", "{events:?}");
    // The statements row is the lead's: staff's custody is no change of it.
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &pm,
        None,
    )
    .await;
    assert!(intake["identification_updated_at"].is_null(), "{intake}");
    assert!(intake["representation_updated_at"].is_null(), "{intake}");
    assert_eq!(intake["representation"]["custody"], "sole_parent");

    // One parent alone: only the first place is asked for.
    let (status, body) = json_request(router, "GET", &request, &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["representation"]["custody"], "sole_parent", "{body}");
    assert!(
        missing_representation(&body)
            .iter()
            .all(|key| key.starts_with("rep1_")),
        "{body}"
    );
    let (status, error) = json_request(
        router,
        "POST",
        &father_path,
        &parent,
        Some(json!({ "role": "legal_representative", "last_name": "Muster" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representative_limit", "{error}");

    // The mother says that both parents represent the child, and names the
    // father; the last statement stands.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &parent,
        custody(json!("joint")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["representation"]["custody"], "joint", "{body}");
    assert_eq!(body["representation"]["custody_stated"], true, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &father_path,
        &parent,
        Some(json!({ "role": "legal_representative", "first_name": "Ben", "last_name": "Muster" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(representative(&body, father)["slot"], "rep2", "{body}");
    // Staff enter a further contact with a parent's relation meanwhile.
    let (_, lead) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &pm,
        None,
    )
    .await;
    let mut contacts = lead["trusted_contacts"].as_array().unwrap().clone();
    contacts.push(json!({ "id": stepfather, "name": "Carl Muster", "relation": "Vater" }));
    let (status, saved) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "trusted_contacts": contacts })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (_, body) = json_request(router, "GET", &request, &parent, None).await;
    assert_eq!(representative(&body, stepfather)["slot"], Value::Null);
    assert_eq!(representative(&body, stepfather)["can_remove"], false);

    // Sole custody after all: the father the cabinet created goes, the
    // contact staff entered stays on file without a place in the form.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &parent,
        custody(json!("sole_parent")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let people = body["representation"]["representatives"]
        .as_array()
        .unwrap();
    assert_eq!(
        people
            .iter()
            .map(|person| (person["id"].clone(), person["slot"].clone()))
            .collect::<Vec<_>>(),
        vec![
            (json!(mother), json!("rep1")),
            (json!(stepfather), Value::Null),
        ],
        "{body}"
    );
    let events = audit_contexts(pool, "lead_portal_update_representation", lead_id).await;
    assert_eq!(
        events
            .last()
            .map(|event| event["removed_representatives"].clone()),
        Some(json!([father])),
        "{events:?}"
    );
    assert!(
        missing_representation(&body)
            .iter()
            .all(|key| key.starts_with("rep1_") && key != "rep1_authority_upload"),
        "{body}"
    );

    // A guardian (Vormund) needs the appointment deed.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &parent,
        custody(json!("guardian")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["representation"]["custody"], "guardian", "{body}");
    assert!(
        missing_representation(&body).contains(&"rep1_authority_upload".to_string()),
        "{body}"
    );
    give_inquiry_consent(router, lead_id, &parent).await;
    let (status, body) = upload_file(
        router,
        &format!("{request}/representatives/{mother}/authority-document"),
        &parent,
        "bestallung.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(
        !missing_representation(&body).contains(&"rep1_authority_upload".to_string()),
        "{body}"
    );
    // The file made the row of the contact staff entered.
    let origin: String = sqlx::query_scalar(
        "SELECT contact_origin FROM lead_representatives WHERE lead_id = $1 AND contact_id = $2",
    )
    .bind(lead_id)
    .bind(mother)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(origin, "staff");
    // The custody can be taken back: both parents by default again.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &parent,
        custody(Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["representation"]["custody"], "joint", "{body}");
    assert_eq!(body["representation"]["custody_stated"], false, "{body}");
    assert_eq!(representative(&body, stepfather)["slot"], "rep2", "{body}");
}

#[tokio::test]
async fn the_representation_is_reached_only_through_the_own_request() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let (lead_id, patient) = adult_lead(&app, json!([])).await;
    let (_, stranger) = adult_lead(&app, json!([])).await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let agent = Uuid::new_v4();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &patient,
        Some(json!({ "has_representative": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representatives/{agent}"),
        &patient,
        Some(json!({ "role": "authorised_representative", "last_name": "Muster" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // Another patient's request does not exist for the caller; a staff role
    // has no business on the patient's endpoints.
    let calls = [
        (
            "POST",
            format!("{request}/representation"),
            Some(json!({ "has_representative": false })),
        ),
        (
            "POST",
            format!("{request}/representatives/{agent}"),
            Some(json!({ "first_name": "Ben" })),
        ),
        ("DELETE", format!("{request}/representatives/{agent}"), None),
    ];
    for (method, path, body) in &calls {
        let (status, answer) = json_request(router, method, path, &stranger, body.clone()).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}: {answer}");
        for role in ["patient_manager", "sales"] {
            let (status, answer) =
                json_request(router, method, path, &app.staff(role), body.clone()).await;
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "{role} {method} {path}: {answer}"
            );
        }
    }
    for part in ["identity-document", "authority-document"] {
        let path = format!("{request}/representatives/{agent}/{part}");
        let (status, answer) =
            upload_file(router, &path, &stranger, "a.pdf", "application/pdf", PDF).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{part}: {answer}");
        let (status, answer) = upload_file(
            router,
            &path,
            &app.staff("patient_manager"),
            "a.pdf",
            "application/pdf",
            PDF,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{part}: {answer}");
    }
    // Nothing changed.
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(body["representation"]["has_representative"], true, "{body}");
    assert_eq!(representative(&body, agent)["first_name"], "", "{body}");

    // The staff endpoints are for staff who work the lead: not for the
    // patient, not for the concierge.
    let staff_remove = format!("/api/v1/leads/{lead_id}/representatives/{agent}");
    for bearer in [patient.clone(), app.staff("concierge")] {
        let (status, _) = json_request(router, "DELETE", &staff_remove, &bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = json_request(
            router,
            "POST",
            &format!("/api/v1/leads/{lead_id}/representation"),
            &bearer,
            Some(json!({ "custody": "joint" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    // Sales works the lead: the row goes, the trusted contact stays.
    let (status, removed) =
        json_request(router, "DELETE", &staff_remove, &app.staff("sales"), None).await;
    assert_eq!(status, StatusCode::OK, "{removed}");
    assert_eq!(
        removed["representation"]["representatives"],
        json!([]),
        "{removed}"
    );
    let contacts: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(contacts[0]["id"], json!(agent), "{contacts}");
    let audited = audit_contexts(&app.suite.pool, "remove_lead_representative", lead_id).await;
    assert_eq!(audited.len(), 1, "{audited:?}");
    assert_eq!(audited[0]["representative_id"], json!(agent));
    // The cabinet asks for the person again (the answer is still yes; the
    // second question was never answered) and cannot reuse the id of the
    // contact that stayed.
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    // The person's details are asked in the first step again.
    assert_eq!(
        missing_representation(&body),
        [
            keys("agent", &ADULT_FIELDS),
            vec!["under_guardianship".to_string()]
        ]
        .concat(),
        "{body}"
    );
    let (status, error) = json_request(
        router,
        "POST",
        &format!("{request}/representatives/{agent}"),
        &patient,
        Some(json!({ "role": "authorised_representative", "last_name": "Muster" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["code"], "representative_id_taken", "{error}");
}
