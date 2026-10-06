//! Integration tests for the lead portal (owner decisions 2026-10-03): the
//! lead cabinet of a patient login, the step-1 intake, uploads under the
//! Art. 9 consent, "send to the manager" and the parents' access of a minor;
//! since 2026-10-05 the lead's own statements for the GwG identification
//! sheet with a copy of the identity document. Synthetic data only.

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
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n synthetic identity document";

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
    let concierge_id = seed_user(&suite.pool, "lead-portal", "concierge").await;
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

async fn upload(app: &axum::Router, path: &str, bearer: &str, bytes: &[u8]) -> (StatusCode, Value) {
    upload_file(app, path, bearer, "befund.pdf", "application/pdf", bytes).await
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
    // The issued password is not forced to change (owner decision 2026-10-05):
    // the login uses the portal as it is.
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

/// The statements "send to the manager" needs for the identification.
fn complete_identification() -> Value {
    json!({
        "birth_place": "Kyiv",
        "birth_country": "UA",
        "id_document_type": "passport",
        "id_document_number": "AB123456",
        "id_issuing_authority": "Stadt Kyiv",
        "id_issuing_country": "UA",
        "id_valid_until": "2099-12-31",
        "pep_self": false,
        "pep_related": false,
        "high_risk_country": false,
        "sanctions_links": false
    })
}

/// Body of "send to the manager" with the confirmation that the information
/// is complete and true.
fn declared() -> Option<Value> {
    Some(json!({ "declared_correct": true }))
}

/// Where the invoice goes and how the patient pays (sections 7 and 8), as a
/// self-paying adult answers them.
fn complete_billing() -> Value {
    json!({
        "invoice_to": "self",
        "payment_method": "bank_transfer",
        "account_country": "DE",
        "account_holder": "Anna Muster",
        "bank_name": "Musterbank",
        "via_third_party": false
    })
}

/// Fills in everything "send to the manager" needs, as the cabinet does: the
/// personal data, who pays (the patient, in the own interest), where the
/// invoice goes and how the patient pays, the statements for the
/// identification, that nobody acts for the (adult) patient, the request
/// consent and a copy of the identity document. Returns the request as the
/// last save answered it.
async fn fill_in_complete_request(app: &axum::Router, lead_id: Uuid, bearer: &str) -> Value {
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    for (part, body) in [
        (
            "personal-data",
            json!({
                "date_of_birth": "1979-02-03",
                "legal_sex": "female",
                "citizenships": ["DE"],
                "street_address": "Musterstraße 1",
                "zip_code": "10115",
                "city": "Berlin",
                "country": "DE"
            }),
        ),
        (
            "payer",
            json!({ "payer_kind": "self", "acts_on_own_account": true }),
        ),
        ("billing", complete_billing()),
        ("identification", complete_identification()),
        (
            "representation",
            json!({ "has_representative": false, "under_guardianship": false }),
        ),
    ] {
        let (status, body) = json_request(
            app,
            "POST",
            &format!("{request}/{part}"),
            bearer,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{part}: {body}");
    }
    give_consent(app, lead_id, bearer, "lead_inquiry_processing").await;
    let (status, body) = upload_file(
        app,
        &format!("{request}/identity-document"),
        bearer,
        "pass.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["progress"]["missing_for_submit"], json!([]), "{body}");
    body
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
    assert_eq!(row["portal_intake"]["total"], 12, "{row}");
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
    assert_eq!(intake["can_review_uploads"], false);
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(intake["can_review_uploads"], true, "{intake}");
    assert!(
        intake["uploads"][0]["consent_given_at"].is_string(),
        "{intake}"
    );

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
    let (lead_id, user_id, patient) =
        lead_with_login(&app, "Sofia", "sofia.submit@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let submit = format!("{request}/submit");

    // Nothing is sent without the confirmation that the information is
    // complete and true (owner spec 2026-10-05).
    for body in [
        None,
        Some(json!({})),
        Some(json!({ "declared_correct": false })),
    ] {
        let (status, body) = json_request(router, "POST", &submit, &patient, body).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "declaration_required", "{body}");
    }
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "personal_data_incomplete");

    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/personal-data"),
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
    // Who pays (owner request 2026-10-05), the statements for the GwG
    // identification, whether somebody acts for the patient, and where the
    // invoice goes and how the patient pays (phase 2) are part of what the
    // manager needs, in form order.
    let still_missing = json!([
        "payer_kind",
        "birth_place",
        "birth_country",
        "id_document_type",
        "id_document_number",
        "id_issuing_authority",
        "id_issuing_country",
        "id_valid_until",
        "id_document_upload",
        "has_representative",
        "under_guardianship",
        "payer_own_account",
        "invoice_to",
        "payment_method",
        "via_third_party",
        "pep_self",
        "pep_related",
        "high_risk_country",
        "sanctions_links"
    ]);
    assert_eq!(
        body["progress"]["missing_for_submit"], still_missing,
        "{body}"
    );
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "personal_data_incomplete");
    assert_eq!(body["missing"], still_missing, "{body}");

    // Who pays alone does not say in whose interest the patient acts.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        &patient,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let missing = body["progress"]["missing_for_submit"].as_array().unwrap();
    assert!(!missing.contains(&json!("payer_kind")), "{body}");
    assert!(missing.contains(&json!("payer_own_account")), "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        &patient,
        Some(json!({ "payer_kind": "self", "acts_on_own_account": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(complete_identification()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["progress"]["missing_for_submit"],
        json!([
            "id_document_upload",
            "has_representative",
            "under_guardianship",
            "invoice_to",
            "payment_method",
            "via_third_party"
        ]),
        "{body}"
    );
    // An adult says whether somebody acts for him and whether he is under
    // legal guardianship; "no" to both asks for nobody else.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/representation"),
        &patient,
        Some(json!({ "has_representative": false, "under_guardianship": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["progress"]["missing_for_submit"],
        json!([
            "id_document_upload",
            "invoice_to",
            "payment_method",
            "via_third_party"
        ]),
        "{body}"
    );
    // Where the invoice goes and how the patient pays (phase 2).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/billing"),
        &patient,
        Some(complete_billing()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["progress"]["missing_for_submit"],
        json!(["id_document_upload"]),
        "{body}"
    );
    assert!(
        body["identification"]["declared_correct_at"].is_null(),
        "{body}"
    );
    give_consent(router, lead_id, &patient, "lead_inquiry_processing").await;
    let (status, body) = upload(
        router,
        &format!("{request}/identity-document"),
        &patient,
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["progress"]["missing_for_submit"], json!([]), "{body}");

    // The request consent can be withdrawn; without it nothing is sent.
    let (status, _) = json_request(
        router,
        "POST",
        &format!("{request}/consent/revoke"),
        &patient,
        Some(json!({ "purpose": "lead_inquiry_processing" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "inquiry_consent_required");

    give_consent(router, lead_id, &patient, "lead_inquiry_processing").await;
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["submitted_at"].is_string(), "{body}");
    // The confirmation is recorded with the statements: when, and by whom.
    assert!(
        body["identification"]["declared_correct_at"].is_string(),
        "{body}"
    );
    let (declared_with_the_send, declared_by): (bool, Option<Uuid>) = sqlx::query_as(
        r#"SELECT g.declared_correct_at = l.portal_submitted_at, g.declared_correct_by
           FROM lead_gwg_declarations g JOIN leads l ON l.id = g.lead_id
           WHERE g.lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(declared_with_the_send);
    assert_eq!(declared_by, Some(user_id));
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

    // Nothing changed since sending: there is nothing to send again.
    assert_eq!(body["changed_since_submit"], false, "{body}");
    assert_eq!(intake["changed_since_submit"], false, "{intake}");

    // The insurance block of wizard step 1 is the patient's to fill in too.
    let personal_data = format!("/api/v1/me/lead-requests/{lead_id}/personal-data");
    let (status, insured) = json_request(
        router,
        "POST",
        &personal_data,
        &patient,
        Some(json!({
            "has_insurance": "yes",
            "insurance_type": "private",
            "insurance_provider": "Allianz Care",
            "insurance_number": "A-123",
            "insurance_covers_germany": "not_sure"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{insured}");
    assert_eq!(insured["personal_data"]["has_insurance"], true, "{insured}");
    assert_eq!(
        insured["personal_data"]["insurance_provider"],
        "Allianz Care"
    );
    assert_eq!(insured["progress"]["total"], 12);
    // A change after sending is what "send again" is for.
    assert_eq!(insured["changed_since_submit"], true, "{insured}");
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(
        intake["patient_fields"]["insurance_provider"]["access_kind"], "self",
        "{intake}"
    );
    // Staff see that the answers shown were changed after sending (QA
    // 2026-10-06, A X2) — every role that reads the intake.
    assert_eq!(intake["changed_since_submit"], true, "{intake}");
    let (status, sales_intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sales_intake}");
    assert_eq!(sales_intake["changed_since_submit"], true, "{sales_intake}");

    let (status, self_payer) = json_request(
        router,
        "POST",
        &personal_data,
        &patient,
        Some(json!({ "has_insurance": "no" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{self_payer}");
    assert_eq!(self_payer["personal_data"]["has_insurance"], false);
    assert_eq!(self_payer["personal_data"]["insurance_type"], "self_pay");
    assert!(self_payer["personal_data"]["insurance_provider"].is_null());
    let stored: (Option<bool>, Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT has_insurance, insurance_type, insurance_provider, insurance_covers_germany FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        (Some(false), Some("self_pay".to_string()), None, None)
    );

    let (status, body) = json_request(
        router,
        "POST",
        &personal_data,
        &patient,
        Some(json!({ "insurance_type": "gold" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["field"], "insurance_type");

    let (status, resent) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{resent}");
    assert_eq!(resent["changed_since_submit"], false, "{resent}");

    // A changed statement after sending is a reason to send again as well;
    // the earlier confirmation keeps its time until then.
    let confirmed_at = resent["identification"]["declared_correct_at"].clone();
    let (status, changed) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(json!({ "former_names": "Sofia Beispiel" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["changed_since_submit"], true, "{changed}");
    assert_eq!(
        changed["identification"]["declared_correct_at"], confirmed_at,
        "{changed}"
    );
}

/// A minor lead with a mother as trusted contact; returns (lead, contact id).
async fn screening_queued_at(
    pool: &PgPool,
    lead_id: Uuid,
) -> Option<chrono::DateTime<chrono::Utc>> {
    sqlx::query_scalar(
        "SELECT queued_at FROM sanctions_screening_queue WHERE subject_type = 'lead' AND subject_id = $1",
    )
    .bind(lead_id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

async fn clear_screening_queue(pool: &PgPool, lead_id: Uuid) {
    sqlx::query(
        "DELETE FROM sanctions_screening_queue WHERE subject_type = 'lead' AND subject_id = $1",
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn the_cabinet_states_who_pays_and_every_person_goes_to_the_sanctions_screening() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, user_id, patient) =
        lead_with_login(&app, "Petra", "petra.payer@example.com").await;
    let (other_lead, _, _) = lead_with_login(&app, "Olga", "olga.payer@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let payer = format!("{request}/payer");
    let manager = app.staff("patient_manager");

    // Nothing is stated yet.
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["payer"].is_null(), "{body}");
    assert!(
        body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("payer_kind")),
        "{body}"
    );

    // The patient's own name and citizenships from the cabinet are screened.
    clear_screening_queue(pool, lead_id).await;
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/personal-data"),
        &patient,
        Some(json!({ "citizenships": ["UA", "DE"], "country": "DE" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        screening_queued_at(pool, lead_id).await.is_some(),
        "a cabinet edit of the citizenships queues the lead for screening"
    );

    // Staff recorded the GwG part before; the cabinet must not lose it.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &manager,
        Some(json!({
            "payer_kind": "self",
            "acts_on_own_account": true,
            "source_of_funds": "savings"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Another person's request does not exist for this login.
    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{other_lead}/payer"),
        &patient,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Staff do not use the patient endpoint.
    let (status, _) = json_request(
        router,
        "POST",
        &payer,
        &manager,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Wrong values name the field; unknown keys (the staff part) are refused.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "third_party", "date_of_birth": "2999-01-01" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "payer_date_of_birth_invalid", "{body}");
    assert_eq!(body["field"], "payer_date_of_birth", "{body}");
    let (status, _) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self", "source_of_funds": "other" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A third party pays: name and citizenships are the least to send, with
    // the relationship to the patient and the consent to contact the payer.
    // Without a payer type it is a person (older clients).
    clear_screening_queue(pool, lead_id).await;
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "third_party", "first_name": " Viktor " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["payer_kind"], "third_party", "{body}");
    assert_eq!(body["payer"]["payer_type"], "person", "{body}");
    assert_eq!(body["payer"]["first_name"], "Viktor", "{body}");
    let missing = body["progress"]["missing_for_submit"].as_array().unwrap();
    assert!(missing.contains(&json!("payer_last_name")), "{body}");
    assert!(missing.contains(&json!("payer_citizenships")), "{body}");
    assert!(
        missing.contains(&json!("payer_relationship_kind")),
        "{body}"
    );
    assert!(missing.contains(&json!("payer_contact_consent")), "{body}");
    assert!(!missing.contains(&json!("payer_first_name")), "{body}");
    assert!(
        screening_queued_at(pool, lead_id).await.is_some(),
        "the payer named in the cabinet queues the lead for screening"
    );

    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({
            "payer_kind": "third_party",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "date_of_birth": "1970-05-06",
            "citizenships": ["ua", "DE", "UA"],
            "street": "Zahlweg 5",
            "zip": "80331",
            "city": "München",
            "country": "de",
            "relationship_kind": "relative",
            "email": "viktor.zahler@example.com",
            "phone": "+49 89 000000",
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["citizenships"], json!(["UA", "DE"]), "{body}");
    assert_eq!(body["payer"]["country"], "DE", "{body}");
    assert_eq!(body["payer"]["relationship_kind"], "relative", "{body}");
    assert!(body["payer"]["contact_consent_at"].is_string(), "{body}");
    // The consent to pass the cost estimate on has an endpoint of its own
    // (phase 3b); until it is given it is the only payer key missing (the
    // background of the payment is a question of the GwG step).
    assert_eq!(
        missing_for_the_payer(&body),
        ["payer_cost_estimate_consent", "payment_background"],
        "{body}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{payer}/cost-estimate-consent"),
        &patient,
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["payer"]["cost_estimate_consent_at"].is_string(),
        "{body}"
    );
    assert!(
        !body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field
                .as_str()
                .is_some_and(|field| field.starts_with("payer"))),
        "{body}"
    );
    // The cabinet does not see the staff part.
    assert!(body["payer"].get("source_of_funds").is_none(), "{body}");

    // It is the lead's one declaration: staff see the same payer, the GwG
    // answers they gave are kept, and the change is audited as the patient's.
    let (status, declaration) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{declaration}");
    let stored = &declaration["declaration"];
    assert_eq!(stored["payer_kind"], "third_party", "{declaration}");
    assert_eq!(stored["last_name"], "Zahler", "{declaration}");
    assert_eq!(stored["citizenships"], json!(["UA", "DE"]), "{declaration}");
    assert_eq!(stored["source_of_funds"], "savings", "{declaration}");
    assert_eq!(stored["acts_on_own_account"], true, "{declaration}");
    // Staff answered the own-account question; the cabinet shows that answer.
    assert_eq!(stored["own_account_answered"], true, "{declaration}");
    assert_eq!(body["payer"]["acts_on_own_account"], true, "{body}");
    assert!(body["payer"]["beneficial_owner"].is_null(), "{body}");
    assert!(stored["payer_informed_at"].is_null(), "{declaration}");
    let updated_by: Option<Uuid> =
        sqlx::query_scalar("SELECT updated_by FROM lead_payer_declarations WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(updated_by, Some(user_id));
    assert_eq!(
        audit_count(pool, "lead_portal_update_payer_declaration", lead_id).await,
        2
    );
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &manager,
        None,
    )
    .await;
    assert_eq!(intake["patient_payer"]["access_kind"], "self", "{intake}");
    assert!(intake["patient_payer"]["at"].is_string(), "{intake}");

    // The same answer again changes nothing.
    let (status, _) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({
            "payer_kind": "third_party",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "date_of_birth": "1970-05-06",
            "citizenships": ["UA", "DE"],
            "street": "Zahlweg 5",
            "zip": "80331",
            "city": "München",
            "country": "DE",
            "relationship_kind": "relative",
            "email": "viktor.zahler@example.com",
            "phone": "+49 89 000000",
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        audit_count(pool, "lead_portal_update_payer_declaration", lead_id).await,
        2
    );

    // Staff confirm that the payer was informed (Art. 14 DSGVO). A corrected
    // address keeps the confirmation; another person named as payer loses it.
    // The lead's consent to contact the payer is read-only for staff.
    assert!(stored["contact_consent_at"].is_string(), "{declaration}");
    let mut confirmed = stored.clone();
    confirmed["payer_informed"] = json!(true);
    // The lead's keys of sections 7 and 8 are not staff's to send (the two
    // tax fields are).
    for key in [
        "payer_informed_at",
        "payer_informed_by",
        "contact_consent_at",
        "own_account_answered",
        "patient_id",
        "created_at",
        "updated_at",
        "invoice_to",
        "invoice_name",
        "invoice_street",
        "invoice_zip",
        "invoice_city",
        "invoice_country",
        "invoice_email",
        "payment_method",
        "payment_method_details",
        "account_country",
        "account_holder",
        "bank_name",
        "via_third_party",
        "via_third_party_details",
        "identity_adopted_at",
        "contact_consent_required",
        "cost_estimate_consent_at",
        "cost_estimate_consent_required",
    ] {
        confirmed.as_object_mut().unwrap().remove(key);
    }
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &manager,
        Some(confirmed),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["declaration"]["payer_informed_at"].is_string(),
        "{body}"
    );
    // Staff changed the record: it is no longer "as the patient entered it".
    let informed =
        |declaration: &Value| declaration["declaration"]["payer_informed_at"].is_string();
    let portal_payer = |last_name: &str, street: &str| {
        json!({
            "payer_kind": "third_party",
            "first_name": "Viktor",
            "last_name": last_name,
            "date_of_birth": "1970-05-06",
            "citizenships": ["UA", "DE"],
            "street": street,
            "zip": "80331",
            "city": "München",
            "country": "DE"
        })
    };
    let (status, _) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(portal_payer("Zahler", "Zahlweg 7")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, declaration) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &manager,
        None,
    )
    .await;
    assert!(informed(&declaration), "{declaration}");
    assert_eq!(
        declaration["declaration"]["street"], "Zahlweg 7",
        "{declaration}"
    );
    // The consent to contact this payer stays as well: neither the staff
    // save nor a cabinet save without the checkbox key removed it.
    assert_eq!(
        declaration["declaration"]["contact_consent_at"], stored["contact_consent_at"],
        "{declaration}"
    );
    let (status, _) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(portal_payer("Anders", "Zahlweg 7")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, declaration) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &manager,
        None,
    )
    .await;
    assert!(!informed(&declaration), "{declaration}");
    assert!(
        declaration["declaration"]["contact_consent_at"].is_null(),
        "the consent was given for the payer named before: {declaration}"
    );
    assert_eq!(
        declaration["declaration"]["source_of_funds"], "savings",
        "{declaration}"
    );

    // "I pay myself" removes the other person's data (data minimisation).
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["payer_kind"], "self", "{body}");
    assert!(body["payer"]["last_name"].is_null(), "{body}");
    assert_eq!(body["payer"]["citizenships"], json!([]), "{body}");
    let names: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT first_name, last_name FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(names, (None, None));
}

#[tokio::test]
async fn the_cabinet_answers_the_own_economic_interest() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Greta", "greta.interest@example.com").await;
    let payer = format!("/api/v1/me/lead-requests/{lead_id}/payer");
    let missing = |body: &Value, key: &str| {
        body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!(key))
    };

    // "I pay myself" does not answer the question: nobody was asked yet.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["payer"]["acts_on_own_account"].is_null(), "{body}");
    assert!(missing(&body, "payer_own_account"), "{body}");

    // "No" needs the person in whose interest the patient acts.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self", "acts_on_own_account": false, "beneficial_owner": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["acts_on_own_account"], false, "{body}");
    assert!(!missing(&body, "payer_own_account"), "{body}");
    assert!(missing(&body, "payer_beneficial_owner"), "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({
            "payer_kind": "self",
            "acts_on_own_account": false,
            "beneficial_owner": " Viktor Zahler, 06.05.1970 in Wien, Zahlweg 5, 80331 München "
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["payer"]["beneficial_owner"],
        "Viktor Zahler, 06.05.1970 in Wien, Zahlweg 5, 80331 München",
        "{body}"
    );
    assert!(!missing(&body, "payer_beneficial_owner"), "{body}");

    // It is the lead's one declaration: staff read the answer there.
    let declaration = |pool: PgPool| async move {
        sqlx::query_as::<_, (bool, bool, Option<String>)>(
            r#"SELECT acts_on_own_account, own_account_answered, beneficial_owner_name
               FROM lead_payer_declarations WHERE lead_id = $1"#,
        )
        .bind(lead_id)
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(
        declaration(pool.clone()).await,
        (
            false,
            true,
            Some("Viktor Zahler, 06.05.1970 in Wien, Zahlweg 5, 80331 München".to_string())
        )
    );
    let (status, staff) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    assert_eq!(
        staff["declaration"]["acts_on_own_account"], false,
        "{staff}"
    );
    assert_eq!(
        staff["declaration"]["own_account_answered"], true,
        "{staff}"
    );

    // A save without the answer (an older cabinet) keeps it.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["acts_on_own_account"], false, "{body}");
    assert!(body["payer"]["beneficial_owner"].is_string(), "{body}");

    // "Yes": nobody else is named any more.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self", "acts_on_own_account": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["acts_on_own_account"], true, "{body}");
    assert!(body["payer"]["beneficial_owner"].is_null(), "{body}");
    assert_eq!(declaration(pool.clone()).await, (true, true, None));

    // A text beyond the limit names its field.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({
            "payer_kind": "self",
            "acts_on_own_account": false,
            "beneficial_owner": "x".repeat(2001)
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["field"], "payer_beneficial_owner", "{body}");
}

#[tokio::test]
async fn the_lead_states_the_identification_and_staff_read_it() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, user_id, patient) =
        lead_with_login(&app, "Ida", "ida.identification@example.com").await;
    let (other_lead, _, _) = lead_with_login(&app, "Otto", "otto.identification@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let identification = format!("{request}/identification");
    let manager = app.staff("patient_manager");

    // Nothing is stated yet: every key is there, empty.
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let empty = &body["identification"];
    assert_eq!(empty.as_object().unwrap().len(), 22, "{body}");
    assert!(empty["birth_place"].is_null(), "{body}");
    assert!(empty["pep_self"].is_null(), "{body}");
    assert_eq!(empty["contact_channels"], json!([]), "{body}");
    assert!(empty["declared_correct_at"].is_null(), "{body}");
    assert_eq!(body["identity_documents"], json!([]), "{body}");

    // Another person's request does not exist for this login; staff do not
    // use the patient endpoint.
    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{other_lead}/identification"),
        &patient,
        Some(json!({ "birth_place": "Kyiv" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = json_request(
        router,
        "POST",
        &identification,
        &manager,
        Some(json!({ "birth_place": "Kyiv" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The confirmation is the server's to set; unknown keys are refused.
    for body in [
        json!({ "declared_correct_at": "2026-10-05T09:20:00Z" }),
        json!({ "first_name": "Ida" }),
    ] {
        let (status, _) = json_request(router, "POST", &identification, &patient, Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    // A wrong value names its field; an expired document has its own code.
    for (body, field, code) in [
        (json!({ "salutation": "dr" }), "salutation", "invalid_field"),
        (
            json!({ "birth_country": "Ukraine" }),
            "birth_country",
            "invalid_field",
        ),
        (
            json!({ "contact_channels": ["fax"] }),
            "contact_channels",
            "invalid_field",
        ),
        (
            json!({ "id_document_type": "driving_licence" }),
            "id_document_type",
            "invalid_field",
        ),
        (
            json!({ "id_document_number": "1".repeat(61) }),
            "id_document_number",
            "invalid_field",
        ),
        (
            json!({ "id_issued_on": "2999-01-01" }),
            "id_issued_on",
            "invalid_field",
        ),
        (
            json!({ "id_valid_until": "2020-01-01" }),
            "id_valid_until",
            "id_document_expired",
        ),
    ] {
        let (status, error) =
            json_request(router, "POST", &identification, &patient, Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["code"], code, "{error}");
        assert_eq!(error["field"], field, "{error}");
    }
    assert_eq!(
        audit_count(pool, "lead_portal_update_identification", lead_id).await,
        0
    );

    // The autosave sends what changed; the server stores it normalised.
    let (status, saved) = json_request(
        router,
        "POST",
        &identification,
        &patient,
        Some(json!({
            "salutation": "ms",
            "former_names": "  Ida   Beispiel ",
            "birth_place": "Kyiv",
            "birth_country": "ua",
            "habitual_residence_country": "at",
            "contact_channels": ["phone", "email", "phone"],
            "id_document_type": "passport",
            "id_document_number": " AB  123456 ",
            "id_issuing_authority": "Stadt Kyiv",
            "id_issuing_country": "ua",
            "id_issued_on": "2021-02-01",
            "id_valid_until": "2099-12-31",
            "pep_self": false,
            "pep_related": true,
            "pep_related_details": " Bruder,\nMinister ",
            "high_risk_country": true,
            "high_risk_country_code": "ir",
            "sanctions_links": false,
            "sanctions_links_details": "stray text"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let stated = &saved["identification"];
    assert_eq!(stated["salutation"], "ms", "{saved}");
    assert_eq!(stated["former_names"], "Ida Beispiel", "{saved}");
    assert_eq!(stated["birth_country"], "UA", "{saved}");
    assert_eq!(stated["habitual_residence_country"], "AT", "{saved}");
    assert_eq!(stated["contact_channels"], json!(["email", "phone"]));
    assert_eq!(stated["id_document_number"], "AB 123456", "{saved}");
    assert_eq!(stated["id_issued_on"], "2021-02-01", "{saved}");
    assert_eq!(stated["id_valid_until"], "2099-12-31", "{saved}");
    assert_eq!(stated["pep_self"], false, "{saved}");
    assert_eq!(stated["pep_related_details"], "Bruder,\nMinister");
    assert_eq!(stated["high_risk_country_code"], "IR", "{saved}");
    // Details belong to a "yes" only.
    assert!(stated["sanctions_links_details"].is_null(), "{saved}");
    let missing = saved["progress"]["missing_for_submit"].as_array().unwrap();
    assert!(!missing.contains(&json!("birth_place")), "{saved}");
    assert!(missing.contains(&json!("id_document_upload")), "{saved}");

    // The audit event names the changed fields, never what was entered.
    let (audited_by, context): (Option<Uuid>, Value) = sqlx::query_as(
        r#"SELECT user_id, context FROM audit_log
           WHERE action = 'lead_portal_update_identification' AND entity_id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audited_by, Some(user_id));
    assert_eq!(context["access_kind"], "self", "{context}");
    let fields = context["fields"].as_array().unwrap();
    assert!(fields.contains(&json!("id_document_number")), "{context}");
    assert!(fields.contains(&json!("pep_related_details")), "{context}");
    assert!(!fields.contains(&json!("sanctions_links_details")));
    let audited = context.to_string();
    assert!(!audited.contains("AB 123456") && !audited.contains("Minister"));
    let (updated_by, marked): (Option<Uuid>, bool) = sqlx::query_as(
        r#"SELECT g.updated_by, l.portal_field_updates ? 'identification'
           FROM lead_gwg_declarations g JOIN leads l ON l.id = g.lead_id
           WHERE g.lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(updated_by, Some(user_id));
    assert!(marked);

    // The same values again change nothing.
    let (status, _) = json_request(
        router,
        "POST",
        &identification,
        &patient,
        Some(json!({ "birth_country": "UA", "pep_self": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        audit_count(pool, "lead_portal_update_identification", lead_id).await,
        1
    );

    // An empty text or `null` clears; "no" drops the details of the "yes".
    let (status, cleared) = json_request(
        router,
        "POST",
        &identification,
        &patient,
        Some(json!({ "former_names": "", "salutation": null, "pep_related": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert!(cleared["identification"]["former_names"].is_null());
    assert!(cleared["identification"]["salutation"].is_null());
    assert!(cleared["identification"]["pep_related_details"].is_null());
    assert_eq!(cleared["identification"]["birth_place"], "Kyiv");
    assert_eq!(
        audit_count(pool, "lead_portal_update_identification", lead_id).await,
        2
    );

    // Staff read the statements where they read the payer declaration; the
    // concierge, who sees only the service side of a lead, gets none of it.
    for role in ["patient_manager", "sales"] {
        let (status, intake) = json_request(
            router,
            "GET",
            &format!("/api/v1/leads/{lead_id}/portal-intake"),
            &app.staff(role),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{role}: {intake}");
        assert_eq!(intake["identification"]["birth_place"], "Kyiv", "{role}");
        assert_eq!(
            intake["identification"]["high_risk_country"], true,
            "{role}"
        );
        assert!(intake["identification_updated_at"].is_string(), "{role}");
        assert_eq!(intake["identification_hidden"], false, "{role}");
        assert_eq!(intake["identity_documents"], json!([]), "{role}");
    }
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["identification_hidden"], true, "{intake}");
    assert!(
        intake["identification"]["birth_place"].is_null(),
        "{intake}"
    );
    assert!(intake["identification_updated_at"].is_null(), "{intake}");

    // A lead that entered nothing has no time of a last change.
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{other_lead}/portal-intake"),
        &manager,
        None,
    )
    .await;
    assert!(intake["identification"].is_object(), "{intake}");
    assert!(intake["identification_updated_at"].is_null(), "{intake}");
}

#[tokio::test]
async fn the_identity_document_needs_the_request_consent_and_is_not_a_medical_document() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, user_id, patient) =
        lead_with_login(&app, "Paula", "paula.pass@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let identity_document = format!("{request}/identity-document");

    // Staff do not use the patient endpoint; the lead needs the consent to
    // process the request data first.
    let (status, _) = upload(
        router,
        &identity_document,
        &app.staff("patient_manager"),
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = upload(router, &identity_document, &patient, PDF).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "inquiry_consent_required", "{body}");
    // The Art. 9 consent is for medical documents; it does not cover this.
    give_consent(router, lead_id, &patient, "health_data_processing").await;
    let (status, body) = upload(router, &identity_document, &patient, PDF).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    give_consent(router, lead_id, &patient, "lead_inquiry_processing").await;
    // A photo or a scan: PDF, JPG or PNG.
    let (status, body) = upload_file(
        router,
        &identity_document,
        &patient,
        "pass.txt",
        "text/plain",
        b"not a scan",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "unsupported_file_type", "{body}");
    let (status, body) = upload_file(
        router,
        &identity_document,
        &patient,
        "pass.png",
        "image/png",
        PNG,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // It is listed apart from the medical documents and is not one of them.
    assert_eq!(body["documents"], json!([]), "{body}");
    let listed = &body["identity_documents"][0];
    assert_eq!(listed["file_name"], "pass.png", "{body}");
    assert_eq!(listed["mime_type"], "image/png", "{body}");
    assert_eq!(listed["uploaded_by_me"], true, "{body}");
    assert_eq!(listed["reviewed"], false, "{body}");
    assert_eq!(listed["can_delete"], true, "{body}");
    assert!(
        !body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("id_document_upload")),
        "{body}"
    );
    let document_id: Uuid = listed["id"].as_str().unwrap().parse().unwrap();
    let (art, is_medical, access, origin, uploaded_by, kind): (
        String,
        bool,
        String,
        String,
        Uuid,
        String,
    ) = sqlx::query_as(
        r#"SELECT d.art, d.is_medical, COALESCE(d.access_category, ''),
                  COALESCE(d.ursprung, ''), d.uploaded_by, u.kind
           FROM documents d JOIN lead_portal_uploads u ON u.document_id = d.id
           WHERE d.id = $1 AND d.lead_id = $2"#,
    )
    .bind(document_id)
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    // The type the identity check of the wizard recognises.
    assert_eq!(art, "identity");
    assert!(!is_medical);
    assert_ne!(access, "medical");
    assert_eq!(origin, "lead_portal");
    assert_eq!(uploaded_by, user_id);
    assert_eq!(kind, "identity");
    assert_eq!(
        audit_count(pool, "lead_portal_upload_document", document_id).await,
        1
    );

    // A medical document goes to the other list.
    let (status, body) = upload(router, &format!("{request}/documents"), &patient, PDF).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["documents"].as_array().unwrap().len(), 1, "{body}");
    assert_eq!(
        body["identity_documents"].as_array().unwrap().len(),
        1,
        "{body}"
    );

    // Staff: the copy of the identity document is listed with the lead's
    // statements also for Sales (it is not medical); "N documents" still
    // counts the medical ones.
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["uploads_hidden"], true, "{intake}");
    assert_eq!(intake["progress"]["documents"], 1, "{intake}");
    assert_eq!(
        intake["identity_documents"],
        json!([{
            "id": document_id,
            "file_name": "pass.png",
            "uploaded_at": listed["uploaded_at"],
            "reviewed": false
        }]),
        "{intake}"
    );
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(intake["uploads"].as_array().unwrap().len(), 1, "{intake}");
    assert_ne!(intake["uploads"][0]["document_id"], json!(document_id));
    let (_, list) = json_request(
        router,
        "GET",
        "/api/v1/leads",
        &app.staff("patient_manager"),
        None,
    )
    .await;
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|lead| lead["id"] == json!(lead_id))
        .unwrap();
    assert_eq!(row["portal_intake"]["documents"], 1, "{row}");

    // The lead withdraws it like any own upload.
    let (status, body) = json_request(
        router,
        "DELETE",
        &format!("{request}/documents/{document_id}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["identity_documents"], json!([]), "{body}");
    assert_eq!(body["documents"].as_array().unwrap().len(), 1, "{body}");
    assert!(
        body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("id_document_upload")),
        "{body}"
    );
    assert_eq!(
        audit_count(pool, "lead_portal_withdraw_document", document_id).await,
        1
    );

    // Once staff confirmed the copy as the identity document, it stays.
    let (status, body) = upload(router, &identity_document, &patient, PDF).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let document_id: Uuid = body["identity_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let (status, marked) = json_request(
        router,
        "POST",
        &format!("/api/v1/documents/{document_id}/mark-signed"),
        &app.staff("patient_manager"),
        Some(json!({ "compliance_kind": "identity" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{marked}");
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(body["identity_documents"][0]["reviewed"], true, "{body}");
    assert_eq!(body["identity_documents"][0]["can_delete"], false, "{body}");
    let (status, body) = json_request(
        router,
        "DELETE",
        &format!("{request}/documents/{document_id}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "upload_reviewed", "{body}");
}

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

    // A parent's login is not stopped by a forced password change either.
    let forced: bool =
        sqlx::query_scalar("SELECT password_reset_required FROM users WHERE id = $1")
            .bind(guardian)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!forced);
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
    // The whole request with the GwG statements, a copy of the identity
    // document and the confirmation, as sent to the manager.
    fill_in_complete_request(router, lead_id, &patient).await;
    let (status, sent) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    let identity_document: Uuid = sent["identity_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let statements: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lead_gwg_declarations WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(statements, 1);

    // Somebody acts for the patient after all: the person, the copy of that
    // person's identity document and the power of attorney are part of what
    // the request holds.
    let representative = Uuid::new_v4();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/representation"),
        &patient,
        Some(json!({ "has_representative": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/representatives/{representative}"),
        &patient,
        Some(json!({
            "role": "authorised_representative",
            "first_name": "Ben",
            "last_name": "Muster",
            "citizenships": ["DE"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    for part in ["identity-document", "authority-document"] {
        let (status, body) = upload_file(
            router,
            &format!("/api/v1/me/lead-requests/{lead_id}/representatives/{representative}/{part}"),
            &patient,
            "vertreter.pdf",
            "application/pdf",
            PDF,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{part}: {body}");
    }
    let representative_documents: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT u.document_id FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1 AND u.representative_id = $2 AND d.storage_key IS NOT NULL"#,
    )
    .bind(lead_id)
    .bind(representative)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(representative_documents.len(), 2);

    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &app.staff("patient_manager"),
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (updates, uploads, statements, payer, documents): (Value, i64, i64, i64, i64) =
        sqlx::query_as(
            r#"SELECT portal_field_updates,
                      (SELECT count(*) FROM lead_portal_uploads WHERE lead_id = $1),
                      (SELECT count(*) FROM lead_gwg_declarations WHERE lead_id = $1),
                      (SELECT count(*) FROM lead_payer_declarations WHERE lead_id = $1),
                      (SELECT count(*) FROM documents
                       WHERE id = $2 AND storage_key IS NOT NULL)
               FROM leads WHERE id = $1"#,
        )
        .bind(lead_id)
        .bind(identity_document)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(updates, json!({}));
    assert_eq!(uploads, 0);
    // The lead's own statements, the payer answer and the copy of the
    // identity document go with the lead.
    assert_eq!(statements, 0);
    assert_eq!(payer, 0);
    assert_eq!(documents, 0);
    // So does what the request held about the representative: the row, the
    // trusted contact and both files.
    let (representatives, contacts, files): (i64, Value, i64) = sqlx::query_as(
        r#"SELECT (SELECT count(*) FROM lead_representatives WHERE lead_id = $1),
                  trusted_contacts,
                  (SELECT count(*) FROM documents
                   WHERE id = ANY($2) AND storage_key IS NOT NULL)
           FROM leads WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(&representative_documents)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(representatives, 0);
    assert_eq!(contacts, json!([]));
    assert_eq!(files, 0);
    let (status, _) = json_request(router, "GET", "/api/v1/me/lead-requests", &patient, None).await;
    // The login itself is switched off with the lead.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// The payer keys of `progress.missing_for_submit`, with the reason why the
/// third party pays.
fn missing_for_the_payer(body: &Value) -> Vec<&str> {
    body["progress"]["missing_for_submit"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .filter(|key| key.starts_with("payer") || *key == "payment_background")
        .collect()
}

#[tokio::test]
async fn an_organisation_pays_and_the_lead_agrees_that_gmed_contacts_it() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) =
        lead_with_login(&app, "Paula", "paula.organisation@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let payer = format!("{request}/payer");
    let submit = format!("{request}/submit");
    let declaration = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let manager = app.staff("patient_manager");
    // The rest of the request is complete: only the payer block decides.
    fill_in_complete_request(router, lead_id, &patient).await;
    // The company as the cabinet sends it; `extra` adds or replaces keys.
    let company = |extra: Value| {
        let mut body = json!({
            "payer_kind": "third_party",
            "payer_type": "company",
            "organisation_name": " Beispiel GmbH ",
            "street": "Ringstr. 9",
            "zip": "1010",
            "city": "Wien",
            "email": "kosten@example.com"
        });
        for (key, value) in extra.as_object().unwrap() {
            body[key.as_str()] = value.clone();
        }
        body
    };

    // A refused value names its field.
    for (extra, code, field) in [
        (
            json!({ "payer_type": "club" }),
            "payer_type_invalid",
            "payer_type",
        ),
        (
            json!({ "organisation_name": "x".repeat(201) }),
            "payer_organisation_name_too_long",
            "payer_organisation_name",
        ),
        (
            json!({ "relationship_kind": "neighbour" }),
            "payer_relationship_kind_invalid",
            "payer_relationship_kind",
        ),
    ] {
        let (status, body) =
            json_request(router, "POST", &payer, &patient, Some(company(extra))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], code, "{body}");
        assert_eq!(body["field"], field, "{body}");
    }

    // A company pays: its name instead of a person. What the form still
    // carries of a person is dropped, not even checked.
    clear_screening_queue(pool, lead_id).await;
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(company(json!({
            "first_name": "Viktor",
            "last_name": "Zahler",
            "date_of_birth": "2999-01-01",
            "citizenships": ["AT"]
        }))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["payer_type"], "company", "{body}");
    assert_eq!(
        body["payer"]["organisation_name"], "Beispiel GmbH",
        "{body}"
    );
    for key in ["first_name", "last_name", "date_of_birth"] {
        assert!(body["payer"][key].is_null(), "{key}: {body}");
    }
    assert_eq!(body["payer"]["citizenships"], json!([]), "{body}");
    assert!(body["payer"]["contact_consent_at"].is_null(), "{body}");
    assert_eq!(
        missing_for_the_payer(&body),
        [
            "payer_relationship_kind",
            "payer_country",
            "payer_contact_consent",
            "payer_cost_estimate_consent",
            "payment_background"
        ],
        "{body}"
    );
    assert!(
        screening_queued_at(pool, lead_id).await.is_some(),
        "an organisation named in the cabinet queues the lead for screening"
    );

    // The relationship is chosen from a list; "other" asks for the words,
    // and the words belong to "other" only.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(company(
            json!({ "country": "at", "relationship_kind": "other" }),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["country"], "AT", "{body}");
    assert_eq!(
        missing_for_the_payer(&body),
        [
            "payer_relationship",
            "payer_contact_consent",
            "payer_cost_estimate_consent",
            "payment_background"
        ],
        "{body}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(company(json!({
            "country": "AT",
            "relationship_kind": "other",
            "relationship": " Stiftung der Familie "
        }))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["relationship_kind"], "other", "{body}");
    assert_eq!(
        body["payer"]["relationship"], "Stiftung der Familie",
        "{body}"
    );
    let employer = json!({
        "country": "AT",
        "relationship_kind": "employer",
        "relationship": "Stiftung der Familie"
    });
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(company(employer.clone())),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["relationship_kind"], "employer", "{body}");
    assert!(body["payer"]["relationship"].is_null(), "{body}");

    // Why the company pays is one of the lead's statements.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(json!({ "payment_background": "Mein Arbeitgeber übernimmt die Kosten." })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["progress"]["missing_for_submit"],
        json!(["payer_contact_consent", "payer_cost_estimate_consent"]),
        "{body}"
    );

    // Without the consents of the lead nothing is sent.
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "personal_data_incomplete", "{body}");
    assert_eq!(
        body["missing"],
        json!(["payer_contact_consent", "payer_cost_estimate_consent"]),
        "{body}"
    );

    // The consent is recorded once: the same answer again, or a save that
    // leaves the checkbox out, keeps its time.
    let mut agreed = employer.clone();
    agreed["contact_consent"] = json!(true);
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(company(agreed.clone())),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let consent_at = body["payer"]["contact_consent_at"].clone();
    assert!(consent_at.is_string(), "{body}");
    assert_eq!(
        body["progress"]["missing_for_submit"],
        json!(["payer_cost_estimate_consent"]),
        "{body}"
    );
    // The consent to pass the cost estimate on to the company (phase 3b).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{payer}/cost-estimate-consent"),
        &patient,
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["progress"]["missing_for_submit"], json!([]), "{body}");
    let audited = audit_count(pool, "lead_portal_update_payer_declaration", lead_id).await;
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(company(agreed.clone())),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["contact_consent_at"], consent_at, "{body}");
    assert_eq!(
        audit_count(pool, "lead_portal_update_payer_declaration", lead_id).await,
        audited,
        "the same answer changes nothing"
    );
    let mut moved = employer.clone();
    moved["street"] = json!("Ringstr. 11");
    let (status, body) = json_request(router, "POST", &payer, &patient, Some(company(moved))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["street"], "Ringstr. 11", "{body}");
    assert_eq!(body["payer"]["contact_consent_at"], consent_at, "{body}");

    // Staff read the consent and the new answers. Their form may leave the
    // new keys out (older clients): everything stays, the consent too. They
    // cannot set the consent themselves.
    let (status, stored) = json_request(router, "GET", &declaration, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{stored}");
    assert_eq!(stored["declaration"]["payer_type"], "company", "{stored}");
    assert!(
        stored["declaration"]["contact_consent_at"].is_string(),
        "{stored}"
    );
    let staff_form = json!({
        "payer_kind": "third_party",
        "acts_on_own_account": true,
        "source_of_funds": "business_income",
        "street": "Ringstr. 11",
        "zip": "1010",
        "city": "Wien",
        "country": "AT",
        "email": "kosten@example.com",
        "payer_informed": true
    });
    let (status, saved) = json_request(
        router,
        "POST",
        &declaration,
        &manager,
        Some(staff_form.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let kept = &saved["declaration"];
    assert_eq!(kept["payer_type"], "company", "{saved}");
    assert_eq!(kept["organisation_name"], "Beispiel GmbH", "{saved}");
    assert_eq!(kept["relationship_kind"], "employer", "{saved}");
    assert_eq!(kept["source_of_funds"], "business_income", "{saved}");
    assert_eq!(
        kept["contact_consent_at"], stored["declaration"]["contact_consent_at"],
        "{saved}"
    );
    let mut with_consent = staff_form;
    with_consent["contact_consent_at"] = json!("2026-10-05T09:20:00Z");
    let (status, _) =
        json_request(router, "POST", &declaration, &manager, Some(with_consent)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // With the consent the request goes to the manager.
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["submitted_at"].is_string(), "{body}");
    assert_eq!(body["payer"]["contact_consent_at"], consent_at, "{body}");

    // The lead can take the consent back; it is then missing again.
    let mut withdrawn = employer.clone();
    withdrawn["street"] = json!("Ringstr. 11");
    withdrawn["contact_consent"] = json!(false);
    let (status, body) =
        json_request(router, "POST", &payer, &patient, Some(company(withdrawn))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["payer"]["contact_consent_at"].is_null(), "{body}");
    assert_eq!(
        missing_for_the_payer(&body),
        ["payer_contact_consent"],
        "{body}"
    );
    let (status, body) =
        json_request(router, "POST", &payer, &patient, Some(company(agreed))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["payer"]["contact_consent_at"].is_string(), "{body}");

    // Another payer is named and the checkbox is not sent: the consent was
    // given for the company, not for this person.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({
            "payer_kind": "third_party",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "citizenships": ["AT"],
            "relationship_kind": "friend"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["payer_type"], "person", "{body}");
    assert!(body["payer"]["organisation_name"].is_null(), "{body}");
    assert!(body["payer"]["contact_consent_at"].is_null(), "{body}");
    // Both consents of the lead were given for the company.
    assert!(
        body["payer"]["cost_estimate_consent_at"].is_null(),
        "{body}"
    );
    assert_eq!(
        missing_for_the_payer(&body),
        ["payer_contact_consent", "payer_cost_estimate_consent"],
        "{body}"
    );

    // "I pay myself": nothing of the third party stays.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self", "contact_consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for key in [
        "payer_type",
        "organisation_name",
        "relationship_kind",
        "contact_consent_at",
        "cost_estimate_consent_at",
    ] {
        assert!(body["payer"][key].is_null(), "{key}: {body}");
    }
    let cleared: (Option<String>, Option<String>, Option<String>, bool) = sqlx::query_as(
        "SELECT payer_type, organisation_name, relationship_kind, contact_consent_at IS NULL
         FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(cleared, (None, None, None, true));
}

#[tokio::test]
async fn a_parent_who_pays_is_prefilled_from_the_own_trusted_contact() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pm = app.staff("patient_manager");

    // The lead's own login has nobody to prefill.
    let (adult, _, patient) = lead_with_login(&app, "Tom", "tom.template@example.com").await;
    let (status, body) = json_request(
        router,
        "GET",
        &format!("/api/v1/me/lead-requests/{adult}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["access_kind"], "self", "{body}");
    assert!(body["payer_self_template"].is_null(), "{body}");

    // A minor with two parents; the mother gets the login.
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    let (status, created) = json_request(
        router,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Lena",
            "last_name": "Kind",
            "date_of_birth": "2016-04-05",
            "email": "lena.child@example.com",
            "trusted_contacts": [
                {
                    "id": mother,
                    "name": "Olga Maria Kind",
                    "relation": "mother",
                    "email": "olga.template@example.com",
                    "phone": "+49 30 000000",
                    "birth_date": "1985-03-04",
                    "address": "Musterweg 1, 10115 Berlin"
                },
                {
                    "id": father,
                    "name": "Pavel Kind",
                    "relation": "father",
                    "email": "pavel.template@example.com",
                    "phone": "+49 30 111111",
                    "birth_date": "1983-01-02"
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let child: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let (status, issued) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": mother })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let guardian: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let parent = bearer(guardian, "patient");
    let request = format!("/api/v1/me/lead-requests/{child}");

    // The template is the contact the login was issued for: name split at
    // the last space, date of birth, e-mail and phone; citizenships and
    // address only from the parent's own representative row (none yet).
    // Never the contact's free-text address, and nothing of the other
    // parent.
    let (status, body) = json_request(router, "GET", &request, &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["access_kind"], "guardian", "{body}");
    let template = body["payer_self_template"].clone();
    assert_eq!(
        template,
        json!({
            "first_name": "Olga Maria",
            "last_name": "Kind",
            "date_of_birth": "1985-03-04",
            "email": "olga.template@example.com",
            "phone": "+49 30 000000",
            "citizenships": [],
            "street": null,
            "zip": null,
            "city": null,
            "country": null
        }),
        "{body}"
    );
    let (_, list) = json_request(router, "GET", "/api/v1/me/lead-requests", &parent, None).await;
    assert_eq!(
        list["requests"][0]["payer_self_template"], template,
        "{list}"
    );

    // "I pay (as a parent)" is an ordinary third-party answer made of the
    // template; nothing else is stored for it. The parent is the payer: no
    // consent to contact somebody else is asked (QA 2026-10-06).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        &parent,
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "relationship_kind": "parent",
            "first_name": template["first_name"],
            "last_name": template["last_name"],
            "date_of_birth": template["date_of_birth"],
            "email": template["email"],
            "phone": template["phone"],
            "citizenships": ["DE"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["relationship_kind"], "parent", "{body}");
    assert_eq!(body["payer"]["first_name"], "Olga Maria", "{body}");
    assert_eq!(body["payer"]["last_name"], "Kind", "{body}");
    assert_eq!(body["payer"]["date_of_birth"], "1985-03-04", "{body}");
    assert!(body["payer"]["street"].is_null(), "{body}");
    assert!(body["payer"]["contact_consent_at"].is_null(), "{body}");
    assert_eq!(body["payer"]["answered_by_payer"], false, "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "guardian", "{body}");
    assert_eq!(body["payer_self_template"], template, "{body}");
    assert!(
        !missing_for_the_payer(&body)
            .iter()
            .any(|key| key.starts_with("payer_") && *key != "payer_own_account"),
        "{body}"
    );

    // The contact is gone from the lead: the login still reaches the request,
    // but there is nobody to prefill (never the other parent).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/update"),
        &pm,
        Some(json!({ "trusted_contacts": [
            { "id": father, "name": "Pavel Kind", "relation": "father", "email": "pavel.template@example.com" }
        ] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(router, "GET", &request, &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["access_kind"], "guardian", "{body}");
    assert!(body["payer_self_template"].is_null(), "{body}");
}

/// The keys of sections 7 and 8 in `progress.missing_for_submit`.
fn missing_for_the_billing(body: &Value) -> Vec<&str> {
    body["progress"]["missing_for_submit"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .filter(|key| {
            key.starts_with("invoice_")
                || key.starts_with("payment_method")
                || key.starts_with("account_")
                || *key == "bank_name"
                || key.starts_with("via_third_party")
        })
        .collect()
}

#[tokio::test]
async fn the_cabinet_states_where_the_invoice_goes_and_how_the_patient_pays() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, user_id, patient) =
        lead_with_login(&app, "Anna", "anna.billing@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let billing = format!("{request}/billing");
    let payer = format!("{request}/payer");
    let intake = format!("/api/v1/leads/{lead_id}/portal-intake");
    let declaration = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let manager = app.staff("patient_manager");

    // The request object always carries the sections; without an answer who
    // pays the patient is asked, and nothing can be patched yet.
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["billing"],
        json!({
            "invoice_to": null, "invoice_name": null, "invoice_street": null, "invoice_zip": null,
            "invoice_city": null, "invoice_country": null, "invoice_email": null,
            "payer_declared": false,
            "payment_route_by": "patient",
            "payment_method": null, "payment_method_details": null, "account_country": null,
            "account_holder": null, "bank_name": null, "via_third_party": null,
            "via_third_party_details": null,
            "account_holder_suggestion": "Anna Portal"
        }),
        "{body}"
    );
    assert_eq!(
        missing_for_the_billing(&body),
        ["invoice_to", "payment_method", "via_third_party"],
        "{body}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "invoice_to": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payer_not_declared", "{body}");
    // Staff do not use the patient endpoint; another person's request does
    // not exist for this login.
    let (status, _) = json_request(
        router,
        "POST",
        &billing,
        &manager,
        Some(json!({ "invoice_to": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (other_lead, _, _) = lead_with_login(&app, "Olga", "olga.billing@example.com").await;
    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{other_lead}/billing"),
        &patient,
        Some(json!({ "invoice_to": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The patient pays himself: "to the payer" is no answer, the rest is.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self", "acts_on_own_account": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["payer_declared"], false, "{body}");
    for (body, field) in [
        (json!({ "invoice_to": "payer" }), "invoice_to"),
        (json!({ "invoice_to": "somewhere" }), "invoice_to"),
        (json!({ "invoice_country": "Germany" }), "invoice_country"),
        (json!({ "invoice_email": "no-at-sign" }), "invoice_email"),
        (json!({ "invoice_zip": "x".repeat(21) }), "invoice_zip"),
        (json!({ "payment_method": "cheque" }), "payment_method"),
        (json!({ "account_country": "Austria" }), "account_country"),
        (json!({ "via_third_party": "yes" }), "via_third_party"),
        (json!({ "invoice_vat_id": "DE123" }), "invoice_vat_id"),
        (json!({ "payer_kind": "self" }), "payer_kind"),
    ] {
        let (status, refused) = json_request(router, "POST", &billing, &patient, Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert_eq!(refused["code"], "invalid_field", "{refused}");
        assert_eq!(refused["field"], field, "{refused}");
    }
    let before = audit_count(pool, "lead_portal_update_billing", lead_id).await;
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({
            "invoice_to": "other",
            "invoice_name": " Anna  Muster ",
            "invoice_street": "Musterweg 1",
            "invoice_zip": "10115",
            "invoice_city": "Berlin",
            "invoice_email": "rechnung@example.com",
            "payment_method": "bank_transfer",
            "account_country": "de",
            "account_holder": "Anna Muster",
            "via_third_party": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let shown = &body["billing"];
    assert_eq!(shown["invoice_to"], "other", "{body}");
    assert_eq!(shown["invoice_name"], "Anna Muster", "{body}");
    assert_eq!(shown["account_country"], "DE", "{body}");
    assert_eq!(shown["via_third_party"], true, "{body}");
    assert_eq!(shown["payment_route_by"], "patient", "{body}");
    assert_eq!(
        missing_for_the_billing(&body),
        ["invoice_country", "bank_name", "via_third_party_details"],
        "{body}"
    );
    assert_eq!(
        audit_count(pool, "lead_portal_update_billing", lead_id).await,
        before + 1
    );
    // The audit event names the fields, never the values.
    let (audited_by, context): (Option<Uuid>, Value) = sqlx::query_as(
        r#"SELECT user_id, context FROM audit_log
           WHERE action = 'lead_portal_update_billing' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audited_by, Some(user_id));
    assert_eq!(context["access_kind"], "self", "{context}");
    assert!(
        context["fields"]
            .as_array()
            .unwrap()
            .contains(&json!("account_holder")),
        "{context}"
    );
    assert!(!context.to_string().contains("Musterweg"), "{context}");
    // The same values again change nothing.
    let (status, _) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "invoice_to": "other", "account_country": "DE" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        audit_count(pool, "lead_portal_update_billing", lead_id).await,
        before + 1
    );

    // Staff see the answers, the flags and when the lead entered them; the
    // "who pays — from the patient" marker is untouched by it.
    let (status, staff) = json_request(router, "GET", &intake, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    assert_eq!(staff["patient_payer"]["access_kind"], "self", "{staff}");
    assert!(staff["billing_updated_at"].is_string(), "{staff}");
    let seen = &staff["billing"];
    assert_eq!(seen["invoice_to"], "other", "{staff}");
    assert_eq!(seen["invoice_name"], "Anna Muster", "{staff}");
    assert_eq!(seen["invoice_email"], "rechnung@example.com", "{staff}");
    assert_eq!(seen["payment_method"], "bank_transfer", "{staff}");
    assert_eq!(seen["payment_route_by"], "patient", "{staff}");
    assert_eq!(seen["compliance_flags"], json!(["third_party_payment"]));
    assert!(seen["invoice_vat_id"].is_null(), "{staff}");
    assert!(seen.get("payer_declared").is_none(), "{staff}");
    assert!(seen.get("account_holder_suggestion").is_none(), "{staff}");
    let (status, concierge) =
        json_request(router, "GET", &intake, &app.staff("concierge"), None).await;
    assert_eq!(status, StatusCode::OK, "{concierge}");
    assert!(concierge["billing"].is_null(), "{concierge}");
    assert!(concierge["billing_updated_at"].is_null(), "{concierge}");

    // Cash and crypto are flagged; "to me" drops the other address and keeps
    // the e-mail; `null` clears; "no" drops the description.
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({
            "invoice_to": "self",
            "payment_method": "crypto",
            "via_third_party": false,
            "via_third_party_details": "stray text"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let shown = &body["billing"];
    assert!(shown["invoice_name"].is_null(), "{body}");
    assert!(shown["invoice_street"].is_null(), "{body}");
    assert_eq!(shown["invoice_email"], "rechnung@example.com", "{body}");
    assert!(shown["account_country"].is_null(), "{body}");
    assert!(shown["account_holder"].is_null(), "{body}");
    assert!(shown["via_third_party_details"].is_null(), "{body}");
    assert!(missing_for_the_billing(&body).is_empty(), "{body}");
    let (_, staff) = json_request(router, "GET", &intake, &manager, None).await;
    assert_eq!(
        staff["billing"]["compliance_flags"],
        json!(["crypto_payment"]),
        "{staff}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "payment_method": "cash", "invoice_email": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["billing"]["invoice_email"].is_null(), "{body}");
    let (_, staff) = json_request(router, "GET", &intake, &manager, None).await;
    assert_eq!(
        staff["billing"]["compliance_flags"],
        json!(["cash_payment"]),
        "{staff}"
    );

    // Staff add the tax fields; the lead's answers survive their save, and
    // the marker says the sections are still the lead's.
    let (status, stored) = json_request(router, "GET", &declaration, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{stored}");
    assert_eq!(stored["declaration"]["payment_method"], "cash", "{stored}");
    let (status, saved) = json_request(
        router,
        "POST",
        &declaration,
        &manager,
        Some(json!({
            "payer_kind": "self",
            "acts_on_own_account": true,
            "source_of_funds": "savings",
            "invoice_vat_id": " DE123456789 ",
            "invoice_tax_number": "12/345/67890"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["declaration"]["invoice_to"], "self", "{saved}");
    assert_eq!(saved["declaration"]["payment_method"], "cash", "{saved}");
    assert_eq!(saved["declaration"]["invoice_vat_id"], "DE123456789");
    assert_eq!(saved["declaration"]["invoice_tax_number"], "12/345/67890");
    let (_, staff) = json_request(router, "GET", &intake, &manager, None).await;
    assert_eq!(staff["billing"]["invoice_vat_id"], "DE123456789", "{staff}");
    assert!(
        staff["billing_updated_at"].is_string(),
        "the tax fields are not the lead's: {staff}"
    );
    assert_eq!(staff["patient_payer"]["access_kind"], "self", "{staff}");

    // A third party pays: the cabinet's answers of section 8 belonged to the
    // patient as payer and go; where the invoice goes stays, "to the payer"
    // is offered, and the third party answers the route itself — the lead
    // is not asked, and may not answer for it.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({
            "payer_kind": "third_party",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "citizenships": ["AT"],
            "relationship_kind": "friend",
            "email": "viktor.zahler@example.com",
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let shown = &body["billing"];
    assert_eq!(shown["invoice_to"], "self", "{body}");
    assert_eq!(shown["payer_declared"], true, "{body}");
    assert_eq!(shown["payment_route_by"], "payer", "{body}");
    assert!(shown["payment_method"].is_null(), "{body}");
    assert!(shown["via_third_party"].is_null(), "{body}");
    assert!(shown["account_holder_suggestion"].is_null(), "{body}");
    assert!(missing_for_the_billing(&body).is_empty(), "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "invoice_to": "payer", "payment_method": "bank_transfer" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payment_route_by_payer", "{body}");
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(
        body["billing"]["invoice_to"], "self",
        "nothing saved: {body}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "invoice_to": "payer", "invoice_email": "rechnung@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["invoice_to"], "payer", "{body}");
    assert!(
        body["billing"]["invoice_email"].is_null(),
        "the payer's own e-mail is used: {body}"
    );
    let (_, staff) = json_request(router, "GET", &intake, &manager, None).await;
    assert_eq!(staff["billing"]["payment_route_by"], "payer", "{staff}");
    assert_eq!(staff["billing"]["compliance_flags"], json!([]), "{staff}");
    assert_eq!(staff["billing"]["invoice_vat_id"], "DE123456789", "{staff}");

    // Back to "I pay myself": "to the payer" is no answer any more.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["billing"]["invoice_to"].is_null(), "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "patient", "{body}");
    assert_eq!(
        missing_for_the_billing(&body),
        ["invoice_to", "payment_method", "via_third_party"],
        "{body}"
    );
    let stored: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT invoice_to, payment_method, invoice_vat_id FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(stored, (None, None, Some("DE123456789".to_string())));
}

#[tokio::test]
async fn a_paying_parent_states_the_payment_route_and_the_other_parent_does_not() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pm = app.staff("patient_manager");
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    let (status, created) = json_request(
        router,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Mia",
            "last_name": "Muster",
            "date_of_birth": "2016-04-05",
            "email": "mia.route@example.com",
            "trusted_contacts": [
                { "id": mother, "name": "Anna Muster", "relation": "mother",
                  "email": "anna.route@example.com", "birth_date": "1985-03-02" },
                { "id": father, "name": "Ben Muster", "relation": "father",
                  "email": "ben.route@example.com", "birth_date": "1983-01-02" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let child: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let mut logins = Vec::new();
    for contact in [mother, father] {
        let (status, issued) = json_request(
            router,
            "POST",
            &format!("/api/v1/leads/{child}/portal-guardians"),
            &pm,
            Some(json!({ "trusted_contact_id": contact })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{issued}");
        let user: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
        logins.push(bearer(user, "patient"));
    }
    let (anna, ben) = (&logins[0], &logins[1]);
    let request = format!("/api/v1/me/lead-requests/{child}");
    let billing = format!("{request}/billing");
    let intake = format!("/api/v1/leads/{child}/portal-intake");

    // The mother pays (as a parent): the cabinet asks her for the route and
    // pre-fills her name; the father is not asked and may not answer for her.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        anna,
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "relationship_kind": "parent",
            "first_name": "Anna",
            "last_name": "Muster",
            "date_of_birth": "1985-03-02",
            "email": "Anna.Route@example.com",
            "citizenships": ["DE"],
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "guardian", "{body}");
    assert_eq!(body["billing"]["payer_declared"], true, "{body}");
    assert_eq!(
        body["billing"]["account_holder_suggestion"], "Anna Muster",
        "{body}"
    );
    assert_eq!(
        missing_for_the_billing(&body),
        ["invoice_to", "payment_method", "via_third_party"],
        "{body}"
    );
    // Why "another person" pays is not asked of the paying parent's own
    // login (QA 2026-10-06, B4); the other parent's login still asks it.
    let asks_background = |body: &Value| {
        body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .iter()
            .any(|key| key == "payment_background")
    };
    assert!(!asks_background(&body), "{body}");
    let (status, body) = json_request(router, "GET", &request, ben, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(asks_background(&body), "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "payer", "{body}");
    assert!(
        body["billing"]["account_holder_suggestion"].is_null(),
        "{body}"
    );
    assert_eq!(missing_for_the_billing(&body), ["invoice_to"], "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        ben,
        Some(json!({ "via_third_party": false })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payment_route_by_payer", "{body}");
    // Where the invoice goes is the request's answer: either parent.
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        ben,
        Some(json!({ "invoice_to": "payer" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["invoice_to"], "payer", "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        anna,
        Some(json!({
            "payment_method": "card",
            "account_country": "DE",
            "account_holder": "Anna Muster",
            "via_third_party": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "guardian", "{body}");
    assert!(missing_for_the_billing(&body).is_empty(), "{body}");
    let (_, body) = json_request(router, "GET", &request, ben, None).await;
    assert!(missing_for_the_billing(&body).is_empty(), "{body}");
    // Section 8 is the paying parent's own answer: the other parent sees none
    // of it (phase 3a).
    assert!(body["billing"]["payment_method"].is_null(), "{body}");
    assert!(body["billing"]["account_holder"].is_null(), "{body}");

    // Staff: the cabinet asked the paying parent, so the answers are shown.
    let (status, staff) = json_request(router, "GET", &intake, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    assert_eq!(staff["billing"]["payment_route_by"], "patient", "{staff}");
    assert_eq!(staff["billing"]["payment_method"], "card", "{staff}");
    assert_eq!(staff["billing"]["account_holder"], "Anna Muster", "{staff}");
    assert!(staff["billing_updated_at"].is_string(), "{staff}");
    // The payer is a parent with a login: nobody else's contact data are
    // passed on, so no consent for it is needed (QA 2026-10-06).
    let declaration = format!("/api/v1/leads/{child}/payer-declaration");
    let (status, declared) = json_request(router, "GET", &declaration, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{declared}");
    assert_eq!(
        declared["status"]["contact_consent_required"], false,
        "{declared}"
    );
    assert_eq!(
        declared["declaration"]["contact_consent_required"], false,
        "{declared}"
    );

    // The father pays instead: the route belonged to the mother and goes; the
    // father is asked now, the mother no longer.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        ben,
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "relationship_kind": "parent",
            "first_name": "Ben",
            "last_name": "Muster",
            "date_of_birth": "1983-01-02",
            "email": "ben.route@example.com",
            "citizenships": ["DE"],
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "guardian", "{body}");
    assert_eq!(body["billing"]["invoice_to"], "payer", "{body}");
    assert!(body["billing"]["payment_method"].is_null(), "{body}");
    assert_eq!(
        body["billing"]["account_holder_suggestion"], "Ben Muster",
        "{body}"
    );
    let (_, body) = json_request(router, "GET", &request, anna, None).await;
    assert_eq!(body["billing"]["payment_route_by"], "payer", "{body}");
}

/// A request of the payer's own link: token and session in their headers.
async fn payer_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: &str,
    session: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("X-Payer-Link", token)
        .header("X-Payer-Session", session)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
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

async fn payer_upload(
    app: &axum::Router,
    path: &str,
    token: &str,
    session: &str,
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"pass.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
    );
    body.extend_from_slice(PDF);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("X-Payer-Link", token)
        .header("X-Payer-Session", session)
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

/// A verified link of the lead's third party with the privacy notice
/// acknowledged, as the code would leave it (no e-mail needed): returns the
/// token and the session.
async fn seed_payer_session(pool: &PgPool, lead_id: Uuid, sent_by: Uuid) -> (String, String) {
    let token = "a1".repeat(32);
    let session = "b2".repeat(32);
    let link_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lead_payer_links
               (lead_id, token_hash, email, language, payer_key, sent_by, expires_at,
                verified_at, session_hash, session_expires_at)
           SELECT d.lead_id, $2, d.email, 'de',
                  jsonb_build_array(d.payer_type, d.organisation_name, d.first_name,
                                    d.last_name, d.date_of_birth),
                  $3, now() + interval '30 days', now(), $4, now() + interval '1 hour'
           FROM lead_payer_declarations d WHERE d.lead_id = $1
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(gmed_server::auth::tokens::hash_token(&token))
    .bind(sent_by)
    .bind(gmed_server::auth::tokens::hash_token(&session))
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO lead_payer_statements
               (lead_id, source, link_id, confirmed_email, email_confirmed_at,
                privacy_ack_at, privacy_text_version)
           SELECT lead_id, 'link', $2, email, now(), now(), 'payer-privacy-2026-10-06'
           FROM lead_payer_declarations WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(link_id)
    .execute(pool)
    .await
    .unwrap();
    (token, session)
}

/// Phase 3a, risks 3 and 4: what the payer states through its own link —
/// the payment route and the files without an uploader — never reaches the
/// lead's cabinet, and the rows without an uploader break none of the
/// readers (cabinet, staff intake, withdrawal, purge).
#[tokio::test]
async fn the_payers_files_and_payment_route_stay_out_of_the_leads_cabinet() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Mia", "mia.payer-files@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        &patient,
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "date_of_birth": "1970-05-01",
            "citizenships": ["AT"],
            "relationship_kind": "friend",
            "email": "viktor.zahler@example.com",
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (token, session) = seed_payer_session(pool, lead_id, app.patient_manager_id).await;

    // The payer states the payment route and uploads its identity document.
    let (status, body) = payer_request(
        router,
        "POST",
        "/api/v1/public/payer-link/questionnaire",
        &token,
        &session,
        Some(json!({
            "payment_method": "card",
            "account_country": "AT",
            "account_holder": "Viktor Zahler",
            "via_third_party": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payment_route"]["payment_method"], "card", "{body}");
    let (status, body) = payer_upload(
        router,
        "/api/v1/public/payer-link/identity-document",
        &token,
        &session,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let document_id: Uuid = body["identity_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let uploader: Option<Uuid> =
        sqlx::query_scalar("SELECT uploaded_by FROM lead_portal_uploads WHERE document_id = $1")
            .bind(document_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(uploader.is_none());

    // The lead's cabinet: nothing of the payer's route or file.
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "payer", "{body}");
    for key in [
        "payment_method",
        "account_country",
        "account_holder",
        "via_third_party",
    ] {
        assert!(body["billing"][key].is_null(), "{key}: {body}");
    }
    assert!(
        !body.to_string().contains(&document_id.to_string()),
        "{body}"
    );
    assert!(body["payer_questionnaire"].is_null(), "{body}");
    let (status, list) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");

    // Staff read the intake; the file is no identity document of the lead.
    let manager = app.staff("patient_manager");
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["identity_documents"], json!([]), "{intake}");
    assert_eq!(intake["payer_link"]["mode"], "link", "{intake}");
    assert_eq!(intake["payer_link"]["status"], "verified", "{intake}");

    // The lead cannot remove the payer's file.
    let (status, _) = json_request(
        router,
        "DELETE",
        &format!("{request}/documents/{document_id}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The purge takes the rows without an uploader too.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &manager,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let left: (i64, i64, i64) = sqlx::query_as(
        r#"SELECT (SELECT count(*) FROM lead_portal_uploads WHERE lead_id = $1),
                  (SELECT count(*) FROM lead_payer_statements WHERE lead_id = $1),
                  (SELECT count(*) FROM lead_payer_links WHERE lead_id = $1)"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(left, (0, 0, 0));
}

/// Phase 3a, D5: a parent with a cabinet login who pays gets no link; the
/// payer's questions are a section of that parent's cabinet, with the
/// person and identity data of the representative's row.
#[tokio::test]
async fn a_paying_parent_answers_the_payer_questions_in_the_own_cabinet() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let pm = app.staff("patient_manager");
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    let (status, created) = json_request(
        router,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Mia",
            "last_name": "Muster",
            "date_of_birth": "2016-04-05",
            "email": "mia.questionnaire@example.com",
            "trusted_contacts": [
                { "id": mother, "name": "Anna Muster", "relation": "mother",
                  "email": "anna.questionnaire@example.com", "birth_date": "1985-03-02" },
                { "id": father, "name": "Ben Muster", "relation": "father",
                  "email": "ben.questionnaire@example.com", "birth_date": "1983-01-02" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let child: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let mut logins = Vec::new();
    for contact in [mother, father] {
        let (status, issued) = json_request(
            router,
            "POST",
            &format!("/api/v1/leads/{child}/portal-guardians"),
            &pm,
            Some(json!({ "trusted_contact_id": contact })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{issued}");
        let user: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
        logins.push((user, bearer(user, "patient")));
    }
    let ((anna_id, anna), (_, ben)) = (&logins[0], &logins[1]);
    let request = format!("/api/v1/me/lead-requests/{child}");
    let section = format!("{request}/payer-questionnaire");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        anna,
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "relationship_kind": "parent",
            "first_name": "Anna",
            "last_name": "Muster",
            "date_of_birth": "1985-03-02",
            "email": "anna.questionnaire@example.com",
            "citizenships": ["DE"],
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    sqlx::query("UPDATE leads SET portal_submitted_at = now() WHERE id = $1")
        .bind(child)
        .execute(pool)
        .await
        .unwrap();

    // No link for her: the section of her cabinet.
    let link = format!("/api/v1/leads/{child}/payer-link");
    let (status, info) = json_request(router, "GET", &link, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{info}");
    assert_eq!(info["mode"], "cabinet", "{info}");
    assert_eq!(info["blocked_reason"], "payer_has_cabinet_login", "{info}");
    assert_eq!(info["can_send"], false);
    let (status, refused) = json_request(router, "POST", &link, &pm, Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_has_cabinet_login");
    let (_, body) = json_request(router, "GET", &request, anna, None).await;
    assert_eq!(body["payer_questionnaire"]["available"], true, "{body}");
    assert!(body["payer_questionnaire"]["submitted_at"].is_null());
    assert!(
        body["payer_questionnaire"]["missing_count"]
            .as_u64()
            .unwrap()
            > 0
    );
    let (_, body) = json_request(router, "GET", &request, ben, None).await;
    assert!(body["payer_questionnaire"].is_null(), "{body}");
    let (status, _) = json_request(router, "GET", &section, ben, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = json_request(router, "GET", &section, &pm, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = json_request(router, "GET", &section, anna, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["source"], "cabinet", "{body}");
    assert_eq!(body["payment_route"]["asked"], false);
    assert_eq!(body["answers"]["first_name"], "Anna");
    assert_eq!(body["answers"]["date_of_birth"], "1985-03-02");
    assert_eq!(body["email"], "anna.questionnaire@example.com");
    let missing = body["missing_for_submit"].as_array().unwrap();
    assert_eq!(missing[0], "privacy_ack", "{body}");
    assert!(missing.contains(&json!("birth_place")), "{body}");
    assert!(missing.contains(&json!("id_document_upload")), "{body}");
    assert!(!missing.contains(&json!("payment_method")), "{body}");

    let (status, body) = json_request(
        router,
        "POST",
        &section,
        anna,
        Some(json!({ "occupation": "Lehrerin" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "payer_consent_required");
    let informed = move || async move {
        sqlx::query_as::<_, (Option<chrono::DateTime<chrono::Utc>>, Option<Uuid>)>(
            "SELECT payer_informed_at, payer_informed_by FROM lead_payer_declarations WHERE lead_id = $1",
        )
        .bind(child)
        .fetch_one(pool)
        .await
        .unwrap()
    };
    assert_eq!(informed().await, (None, None));
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{section}/consent"),
        anna,
        Some(json!({ "acknowledged": true, "contact_channels": ["email"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["privacy"]["acknowledged_at"].is_string(), "{body}");
    // Her acknowledgement informs the payer (QA 2026-10-06), recorded once
    // with her login, audited with the consent.
    let (informed_at, informed_by) = informed().await;
    assert!(informed_at.is_some());
    assert_eq!(informed_by, Some(*anna_id));
    let consent_context: Value = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'payer_questionnaire_consent' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        consent_context["payer_informed_recorded"], true,
        "{consent_context}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{section}/consent"),
        anna,
        Some(json!({ "acknowledged": true, "contact_channels": ["email", "phone"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(informed().await, (informed_at, informed_by), "kept");
    // A staff save that leaves the checkbox out keeps the record.
    let (status, stored) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{child}/payer-declaration"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{stored}");
    let current = &stored["declaration"];
    let mut form = serde_json::Map::new();
    for key in [
        "payer_kind",
        "acts_on_own_account",
        "payer_type",
        "first_name",
        "last_name",
        "date_of_birth",
        "citizenships",
        "relationship_kind",
        "email",
    ] {
        form.insert(key.to_string(), current[key].clone());
    }
    form.insert("phone".into(), json!("+49 30 1234567"));
    let (status, saved) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/payer-declaration"),
        &pm,
        Some(Value::Object(form)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["declaration"]["phone"], "+49 30 1234567", "{saved}");
    assert_eq!(informed().await, (informed_at, informed_by), "{saved}");
    for (key, value) in [
        ("first_name", json!("Annette")),
        ("payment_method", json!("card")),
        ("citizenships", json!(["AT"])),
    ] {
        let (status, refused) =
            json_request(router, "POST", &section, anna, Some(json!({ key: value }))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert_eq!(refused["field"], key, "{refused}");
    }
    let (status, body) = json_request(
        router,
        "POST",
        &section,
        anna,
        Some(json!({
            "salutation": "ms",
            "occupation": "Lehrerin",
            "funds_sources": ["employment"],
            "pep_self": false,
            "pep_related": false,
            "high_risk_country": false,
            "sanctions_links": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["answers"]["occupation"], "Lehrerin");
    let (audited_by, context): (Option<Uuid>, Value) = sqlx::query_as(
        r#"SELECT user_id, context FROM audit_log
           WHERE action = 'payer_questionnaire_update' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audited_by, Some(*anna_id));
    assert_eq!(context["access_kind"], "guardian", "{context}");

    // Her proof of funds: hers to remove, not the other parent's, and never
    // a document of the request.
    let (status, body) = upload_file(
        router,
        &format!("{section}/funds-proof"),
        anna,
        "konto.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        body["funds_proof_documents"][0]["can_delete"], true,
        "{body}"
    );
    let proof = body["funds_proof_documents"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (_, request_body) = json_request(router, "GET", &request, anna, None).await;
    assert!(!request_body.to_string().contains(&proof), "{request_body}");
    let (status, _) = json_request(
        router,
        "DELETE",
        &format!("{request}/documents/{proof}"),
        ben,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{child}/portal-intake"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["payer_link"]["mode"], "cabinet", "{intake}");
    let (status, _) = json_request(
        router,
        "DELETE",
        &format!("{request}/documents/{proof}"),
        anna,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = json_request(router, "GET", &section, anna, None).await;
    assert_eq!(body["funds_proof_documents"], json!([]), "{body}");

    // The representative's data are still missing: no submit yet.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{section}/submit"),
        anna,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "questionnaire_incomplete");
    assert!(
        body["missing"]
            .as_array()
            .unwrap()
            .contains(&json!("id_document_upload")),
        "{body}"
    );
}
