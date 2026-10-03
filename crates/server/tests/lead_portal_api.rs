//! Integration tests for the lead portal (owner decisions 2026-10-03): the
//! lead cabinet of a patient login, the step-1 intake, uploads under the
//! Art. 9 consent, "send to the manager" and the parents' access of a minor.
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
const PDF: &[u8] = b"%PDF-1.4\n% synthetic lead portal upload\n%%EOF\n";

struct TestApp {
    suite: support::TestSuiteContext,
    sales_id: Uuid,
    patient_manager_id: Uuid,
}

impl TestApp {
    fn staff(&self, role: &str) -> String {
        let user_id = match role {
            "sales" => self.sales_id,
            "patient_manager" => self.patient_manager_id,
            other => panic!("unexpected role {other}"),
        };
        bearer(user_id, role)
    }
}

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

async fn test_app() -> Option<TestApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let sales_id = seed_user(&suite.pool, "lead-portal", "sales").await;
    let patient_manager_id = seed_user(&suite.pool, "lead-portal", "patient_manager").await;
    Some(TestApp {
        suite,
        sales_id,
        patient_manager_id,
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

async fn upload(app: &axum::Router, path: &str, bearer: &str, bytes: &[u8]) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"befund.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
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

/// A manual lead with its patient login; returns (lead, login, bearer).
async fn lead_with_login(app: &TestApp, first_name: &str, email: &str) -> (Uuid, Uuid, String) {
    let (status, created) = json_request(
        &app.suite.app,
        "POST",
        "/api/v1/leads",
        &app.staff("patient_manager"),
        Some(json!({ "first_name": first_name, "last_name": "Portal", "email": email })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let user_id: Uuid = created["portal_account"]["user_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    // The one-time password was replaced (the gate is tested elsewhere).
    sqlx::query("UPDATE users SET password_reset_required = false WHERE id = $1")
        .bind(user_id)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    (lead_id, user_id, bearer(user_id, "patient"))
}

async fn give_consent(app: &axum::Router, lead_id: Uuid, bearer: &str, purpose: &str) {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/consent"),
        bearer,
        Some(json!({ "purpose": purpose, "version": CONSENT_VERSION, "language": "de" })),
    )
    .await;
    assert!(
        status == StatusCode::CREATED || status == StatusCode::OK,
        "{status} {body}"
    );
}

async fn audit_count(pool: &PgPool, action: &str, entity_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = $1 AND entity_id = $2")
        .bind(action)
        .bind(entity_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_lead_login_gets_only_the_lead_cabinet_until_it_is_a_patient() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let (_, user_id, patient) = lead_with_login(&app, "Lena", "lena.cabinet@example.com").await;

    let (status, me) = json_request(router, "GET", "/api/v1/me", &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["portal_mode"], "lead", "{me}");
    assert_eq!(me["lead_portal"]["requests"], 1, "{me}");

    let (status, requests) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{requests}");
    assert_eq!(
        requests["requests"][0]["personal_data"]["first_name"],
        "Lena"
    );
    assert_eq!(requests["requests"][0]["access_kind"], "self");

    // The rest of the patient portal is closed to a lead login.
    for path in [
        "/api/v1/me/documents",
        "/api/v1/me/appointments",
        "/api/v1/me/invoices",
        "/api/v1/me/next-actions",
        "/api/v1/notifications",
    ] {
        let (status, body) = json_request(router, "GET", path, &patient, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_eq!(body["code"], "lead_portal_only", "{path}: {body}");
    }
    let (status, _) = json_request(router, "GET", "/api/v1/me/profile", &patient, None).await;
    assert_eq!(status, StatusCode::OK);

    // Staff never use the patient endpoints.
    let (status, _) = json_request(
        router,
        "GET",
        "/api/v1/me/lead-requests",
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // With a patient record (after conversion) the normal portal is back.
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ('PT-LEAD-CABINET', 'Lena', 'Portal', '1990-01-01', 'female', $1)
           RETURNING id"#,
    )
    .bind(app.patient_manager_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(app.patient_manager_id)
    .execute(&app.suite.pool)
    .await
    .unwrap();
    let (_, me) = json_request(router, "GET", "/api/v1/me", &patient, None).await;
    assert_eq!(me["portal_mode"], "patient", "{me}");
    let (status, body) = json_request(router, "GET", "/api/v1/me/documents", &patient, None).await;
    assert_ne!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn a_patient_edits_only_the_own_step_one_fields() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_a, user_a, patient_a) =
        lead_with_login(&app, "Anna", "anna.intake@example.com").await;
    let (lead_b, _, _) = lead_with_login(&app, "Boris", "boris.intake@example.com").await;

    // Another person's request does not exist for this login.
    for path in [
        format!("/api/v1/me/lead-requests/{lead_b}"),
        format!("/api/v1/me/lead-requests/{lead_b}/personal-data"),
    ] {
        let method = if path.ends_with("personal-data") {
            "POST"
        } else {
            "GET"
        };
        let (status, body) = json_request(
            router,
            method,
            &path,
            &patient_a,
            Some(json!({ "city": "X" })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}: {body}");
    }
    // The e-mail is the login and stays with staff.
    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_a}/personal-data"),
        &patient_a,
        Some(json!({ "email": "other@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, saved) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_a}/personal-data"),
        &patient_a,
        Some(json!({
            "date_of_birth": "1988-05-01",
            "legal_sex": "female",
            "citizenships": ["ua", "DE"],
            "city": "Kyiv",
            "primary_language": "uk"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["personal_data"]["citizenships"], json!(["UA", "DE"]));
    assert_eq!(saved["progress"]["filled"], 7, "{saved}");

    let (citizenships, registration_country, legal_sex): (Vec<String>, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT citizenships, wizard_state->>'registration_country', legal_sex FROM leads WHERE id = $1",
        )
        .bind(lead_a)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(citizenships, vec!["UA".to_string(), "DE".to_string()]);
    assert_eq!(registration_country.as_deref(), Some("UA"));
    assert_eq!(legal_sex.as_deref(), Some("female"));
    assert_eq!(
        audit_count(pool, "lead_portal_update_personal_data", lead_a).await,
        1
    );

    // An own login never belongs to a minor.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_a}/personal-data"),
        &patient_a,
        Some(json!({ "date_of_birth": "2015-01-01" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "minor_needs_guardian");

    // Staff see which fields came from the patient, until they change one.
    let pm = app.staff("patient_manager");
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_a}/portal-intake"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["patient_fields"]["city"]["access_kind"], "self");
    assert!(intake["patient_fields"]["first_name"].is_null(), "{intake}");
    assert_eq!(intake["progress"]["filled"], 7);
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_a}/update"),
        &pm,
        Some(json!({ "city": "Lviv" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_a}/portal-intake"),
        &pm,
        None,
    )
    .await;
    assert!(intake["patient_fields"]["city"].is_null(), "{intake}");
    assert!(
        intake["patient_fields"]["legal_sex"].is_object(),
        "{intake}"
    );

    // "Who fills step 1" is kept in the wizard state, for every lead role.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_a}/portal-intake/fill-mode"),
        &app.staff("sales"),
        Some(json!({ "mode": "patient" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mode: Option<String> =
        sqlx::query_scalar("SELECT wizard_state->>'step1_fill_mode' FROM leads WHERE id = $1")
            .bind(lead_a)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(mode.as_deref(), Some("patient"));

    // The leads list carries the progress for the access row.
    let (status, list) = json_request(router, "GET", "/api/v1/leads", &pm, None).await;
    assert_eq!(status, StatusCode::OK);
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|lead| lead["id"] == json!(lead_a))
        .unwrap();
    assert_eq!(row["portal_intake"]["total"], 11, "{row}");
    let _ = user_a;
}

#[tokio::test]
async fn uploads_need_the_health_consent_and_can_be_withdrawn_until_review() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, user_id, patient) = lead_with_login(&app, "Uma", "uma.upload@example.com").await;
    let documents_path = format!("/api/v1/me/lead-requests/{lead_id}/documents");

    let (status, body) = upload(router, &documents_path, &patient, PDF).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "health_consent_required");

    give_consent(router, lead_id, &patient, "health_data_processing").await;
    let (consent_lead, version, text): (Option<Uuid>, Option<String>, Option<String>) =
        sqlx::query_as(
            r#"SELECT lead_id, context->>'text_version', context->>'text'
               FROM consent_records
               WHERE user_id = $1 AND consent_type = 'health_data_processing'"#,
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(consent_lead, Some(lead_id));
    assert_eq!(version.as_deref(), Some(CONSENT_VERSION));
    assert!(text.unwrap().contains("Art. 9"));

    let (status, request) = upload(router, &documents_path, &patient, PDF).await;
    assert_eq!(status, StatusCode::CREATED, "{request}");
    let document_id: Uuid = request["documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(request["documents"][0]["can_delete"], true);
    let (doc_lead, uploaded_by, is_medical, origin): (Option<Uuid>, Uuid, bool, Option<String>) =
        sqlx::query_as(
            "SELECT lead_id, uploaded_by, is_medical, ursprung FROM documents WHERE id = $1",
        )
        .bind(document_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(doc_lead, Some(lead_id));
    assert_eq!(uploaded_by, user_id);
    assert!(is_medical);
    assert_eq!(origin.as_deref(), Some("lead_portal"));
    assert_eq!(
        audit_count(pool, "lead_portal_upload_document", document_id).await,
        1
    );

    // Withdrawn before review.
    let (status, request) = json_request(
        router,
        "DELETE",
        &format!("{documents_path}/{document_id}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{request}");
    assert_eq!(request["documents"].as_array().unwrap().len(), 0);
    let deleted: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT file_deleted_at FROM documents WHERE id = $1")
            .bind(document_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(deleted.is_some());

    // After staff review the patient can no longer remove it.
    let (_, request) = upload(router, &documents_path, &patient, PDF).await;
    let document_id: Uuid = request["documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-intake/documents/{document_id}/review"),
        &app.staff("sales"),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "sales has no medical access: {body}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-intake/documents/{document_id}/review"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "DELETE",
        &format!("{documents_path}/{document_id}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "upload_reviewed");

    // Sales sees how many, not which documents.
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("sales"),
        None,
    )
    .await;
    assert_eq!(intake["progress"]["documents"], 1, "{intake}");
    assert_eq!(intake["uploads_hidden"], true);
    assert_eq!(intake["uploads"], json!([]));

    // Withdrawing the consent blocks further uploads.
    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/consent/revoke"),
        &patient,
        Some(json!({ "purpose": "health_data_processing" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = upload(router, &documents_path, &patient, PDF).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn sending_needs_the_data_and_the_request_consent_and_tells_the_managers() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Sofia", "sofia.submit@example.com").await;
    let submit = format!("/api/v1/me/lead-requests/{lead_id}/submit");

    let (status, body) = json_request(router, "POST", &submit, &patient, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "personal_data_incomplete");

    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/personal-data"),
        &patient,
        Some(json!({
            "date_of_birth": "1979-02-03",
            "legal_sex": "female",
            "citizenships": ["DE"],
            "street_address": "Musterstraße 1",
            "zip_code": "10115",
            "city": "Berlin",
            "country": "DE"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(router, "POST", &submit, &patient, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "inquiry_consent_required");

    give_consent(router, lead_id, &patient, "lead_inquiry_processing").await;
    let (status, body) = json_request(router, "POST", &submit, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["submitted_at"].is_string(), "{body}");
    assert_eq!(audit_count(pool, "lead_portal_submit", lead_id).await, 1);
    let notified: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'lead_portal_submitted' AND entity_id = $2"#,
    )
    .bind(app.patient_manager_id)
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(notified, 1);

    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert!(intake["submitted_at"].is_string(), "{intake}");
    assert!(
        intake["consents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|consent| consent["type"] == "lead_inquiry_processing"),
        "{intake}"
    );
}

/// A minor lead with a mother as trusted contact; returns (lead, contact id).
async fn minor_lead(app: &TestApp, child: &str, mother_email: &str) -> (Uuid, Uuid) {
    let contact_id = Uuid::new_v4();
    let (status, created) = json_request(
        &app.suite.app,
        "POST",
        "/api/v1/leads",
        &app.staff("patient_manager"),
        Some(json!({
            "first_name": child,
            "last_name": "Kind",
            "date_of_birth": "2016-04-05",
            "email": format!("{}.child@example.com", child.to_lowercase()),
            "trusted_contacts": [{
                "id": contact_id,
                "name": "Olga Kind",
                "relation": "mother",
                "email": mother_email
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert!(created["portal_account"].is_null(), "{created}");
    (created["id"].as_str().unwrap().parse().unwrap(), contact_id)
}

#[tokio::test]
async fn parents_get_one_login_for_their_minor_children_and_lose_it_with_the_last_request() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let pm = app.staff("patient_manager");
    let (first_child, first_contact) = minor_lead(&app, "Mila", "olga.kind@example.com").await;
    let (second_child, second_contact) = minor_lead(&app, "Max", "olga.kind@example.com").await;

    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{first_child}/portal-guardians"),
        &app.staff("sales"),
        Some(json!({ "trusted_contact_id": first_contact })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, issued) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{first_child}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": first_contact })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    assert_eq!(issued["created"], true);
    assert!(issued["one_time_password"].is_string());
    let guardian: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();

    // The same parent for the second child: the same login, no new password.
    let (status, reused) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{second_child}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": second_contact })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{reused}");
    assert_eq!(reused["user_id"], json!(guardian));
    assert_eq!(reused["reused"], true);
    assert!(reused["one_time_password"].is_null());

    sqlx::query("UPDATE users SET password_reset_required = false WHERE id = $1")
        .bind(guardian)
        .execute(pool)
        .await
        .unwrap();
    let parent = bearer(guardian, "patient");
    let (_, requests) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &parent, None).await;
    let requests = requests["requests"].as_array().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(
        requests
            .iter()
            .all(|request| request["access_kind"] == "guardian")
    );
    let (status, saved) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{first_child}/personal-data"),
        &parent,
        Some(json!({ "city": "Hamburg" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");

    // A contact whose address belongs to staff is refused with its owner.
    let staff_contact = Uuid::new_v4();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{first_child}/update"),
        &pm,
        Some(json!({ "trusted_contacts": [
            { "id": first_contact, "name": "Olga Kind", "relation": "mother", "email": "olga.kind@example.com" },
            { "id": staff_contact, "name": "Pavel Kind", "relation": "father", "email": "lead-portal-sales@example.com" }
        ] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{first_child}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": staff_contact })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "portal_email_taken");

    // An adult's request gets no parents' access.
    let (adult, _, _) = lead_with_login(&app, "Adult", "adult.guardian@example.com").await;
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{adult}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // Deleting one child's request keeps the login for the other one.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{first_child}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(guardian)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(active);
    let (_, requests) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &parent, None).await;
    assert_eq!(requests["requests"].as_array().unwrap().len(), 1);
    let (status, _) = json_request(
        router,
        "GET",
        &format!("/api/v1/me/lead-requests/{first_child}"),
        &parent,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // With the last request the login goes.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{second_child}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (active, email): (bool, String) =
        sqlx::query_as("SELECT is_active, email FROM users WHERE id = $1")
            .bind(guardian)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!active);
    assert!(!email.contains("olga"), "{email}");
    let open_links: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_portal_access WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(guardian)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(open_links, 0);
}

#[tokio::test]
async fn purging_a_lead_clears_the_portal_intake() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Petra", "petra.purge@example.com").await;
    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/personal-data"),
        &patient,
        Some(json!({ "city": "Bonn" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    give_consent(router, lead_id, &patient, "health_data_processing").await;
    let (status, _) = upload(
        router,
        &format!("/api/v1/me/lead-requests/{lead_id}/documents"),
        &patient,
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &app.staff("patient_manager"),
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (updates, uploads): (Value, i64) = sqlx::query_as(
        r#"SELECT portal_field_updates,
                  (SELECT count(*) FROM lead_portal_uploads WHERE lead_id = $1)
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(updates, json!({}));
    assert_eq!(uploads, 0);
    let (status, _) = json_request(router, "GET", "/api/v1/me/lead-requests", &patient, None).await;
    // The login itself is switched off with the lead.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
